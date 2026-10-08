// Animate the photograph's own alpha boundary, starting from the saved ink mask.
// This renders one transparent photo surface; it does not cover a fixed cutout.
(() => {
  function distanceField(mask) {
    const width = Math.min(896, mask.naturalWidth);
    const height = Math.round(width * mask.naturalHeight / mask.naturalWidth);
    const padding = 32, w = width + padding * 2, h = height + padding * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(mask, padding, padding, width, height);
    const pixels = ctx.getImageData(0, 0, w, h);
    const inside = new Float32Array(w * h), outside = new Float32Array(w * h);
    for (let i = 0; i < inside.length; i++) {
      const filled = pixels.data[i * 4 + 3] >= 128;
      inside[i] = filled ? 1e6 : 0;
      outside[i] = filled ? 0 : 1e6;
    }
    // Two chamfer passes give a smooth distance to the existing ink boundary.
    const transform = field => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
        if (y) {
          field[i] = Math.min(field[i], field[i - w] + 1);
          if (x) field[i] = Math.min(field[i], field[i - w - 1] + Math.SQRT2);
          if (x < w - 1) field[i] = Math.min(field[i], field[i - w + 1] + Math.SQRT2);
        }
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x < w - 1) field[i] = Math.min(field[i], field[i + 1] + 1);
        if (y < h - 1) {
          field[i] = Math.min(field[i], field[i + w] + 1);
          if (x) field[i] = Math.min(field[i], field[i + w - 1] + Math.SQRT2);
          if (x < w - 1) field[i] = Math.min(field[i], field[i + w + 1] + Math.SQRT2);
        }
      }
    };
    transform(inside);
    transform(outside);
    const range = Math.hypot(w, h);
    let maximum = 0;
    for (let i = 0; i < inside.length; i++) {
      const distance = inside[i] - outside[i];
      maximum = Math.max(maximum, distance);
      const packed = Math.round((.5 + distance / (2 * range)) * 65535);
      pixels.data[i * 4] = packed >> 8;
      pixels.data[i * 4 + 1] = packed & 255;
      pixels.data[i * 4 + 2] = 0;
      pixels.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return { canvas, width, height, padding, range, maximum };
  }

  const fragmentShader = `
    uniform sampler2D photoTexture;
    uniform sampler2D inkTexture;
    uniform sampler2D distanceTexture;
    uniform vec2 fieldSize;
    uniform vec2 paddedSize;
    uniform float padding;
    uniform float distanceRange;
    uniform float maximumDistance;
    uniform float progress;
    uniform float clock;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
      vec2 cell = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
                 mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float result = 0.0, amplitude = .5;
      mat2 turn = mat2(.8, -.6, .6, .8);
      for (int i = 0; i < 4; i++) {
        result += amplitude * noise(p);
        p = turn * p * 2.03 + vec2(17.2, 9.1);
        amplitude *= .5;
      }
      return result;
    }
    void main() {
      vec4 photo = texture2D(photoTexture, vUv);
      float originalAlpha = texture2D(inkTexture, vUv).a;
      if (progress <= .0001) {
        gl_FragColor = vec4(photo.rgb, photo.a * originalAlpha);
        return;
      }
      vec2 p = vUv * vec2(fieldSize.x / fieldSize.y, 1.0) * 5.0;
      vec2 drift = vec2(clock * .16, -clock * .11);
      vec2 flow = vec2(fbm(p + drift), fbm(p + vec2(8.3, 3.1) - drift));
      vec2 curls = vec2(fbm(p * 1.8 + flow * 3.0 + drift),
                        fbm(p * 1.8 + flow * 3.0 + vec2(4.7, 9.2) - drift));
      float activity = smoothstep(0.0, .2, progress);
      vec2 warp = (curls - .47) * (18.0 + 60.0 * progress) * activity;
      vec2 uv = (vUv * fieldSize + padding + warp) / paddedSize;
      vec2 encoded = texture2D(distanceTexture, uv).rg;
      float distance = ((encoded.r * 65280.0 + encoded.g * 255.0) / 65535.0 - .5) * 2.0 * distanceRange;
      float cloud = fbm(p * 1.2 + flow * 3.0 + drift);
      float detail = fbm(p * 4.0 + curls * 2.0 - drift);
      float softness = mix(1.0, 22.0, smoothstep(.0, .7, progress));
      float edge = pow(progress, 1.25) * (maximumDistance + 55.0)
                   + (cloud - .47) * 55.0 * activity
                   + (detail - .47) * 15.0 * activity;
      float remaining = distance - edge;
      float alpha = smoothstep(-softness, softness, remaining);
      alpha = mix(originalAlpha, alpha, smoothstep(.0, .12, progress));
      // Color and transparency turn to mist only along the changing boundary.
      float mist = (1.0 - smoothstep(-softness, softness * 3.5, remaining))
                   * activity * (.55 + .4 * cloud);
      vec3 color = mix(photo.rgb, vec3(.9804, .9843, .9725), mist);
      alpha *= 1.0 - smoothstep(.88, 1.0, progress);
      gl_FragColor = vec4(color, photo.a * alpha);
    }
  `;

  window.createLivingInkMask = ({ photo, mask, depth, THREE }) => {
    let renderer, geometry, material, photoTexture, inkTexture, fieldTexture;
    let frame = 0, disposed = false, current = 0, elapsed = 0, lastTime;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      renderer?.domElement.remove();
      geometry?.dispose();
      material?.dispose();
      photoTexture?.dispose();
      inkTexture?.dispose();
      fieldTexture?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
    };
    try {
      const field = distanceField(mask);
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setClearColor(0, 0);
      renderer.setPixelRatio(1);
      const canvas = renderer.domElement;
      canvas.className = 'splash-photo living-ink-mask';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.aspectRatio = `${photo.naturalWidth} / ${photo.naturalHeight}`;
      canvas.dataset.active = 'false';
      depth.append(canvas);
      const texture = image => {
        const value = new THREE.Texture(image);
        value.minFilter = value.magFilter = THREE.LinearFilter;
        value.generateMipmaps = false;
        value.needsUpdate = true;
        return value;
      };
      photoTexture = texture(photo);
      inkTexture = texture(mask);
      fieldTexture = texture(field.canvas);
      const uniforms = {
        photoTexture: { value: photoTexture }, inkTexture: { value: inkTexture },
        distanceTexture: { value: fieldTexture },
        fieldSize: { value: new THREE.Vector2(field.width, field.height) },
        paddedSize: { value: new THREE.Vector2(field.canvas.width, field.canvas.height) },
        padding: { value: field.padding }, distanceRange: { value: field.range },
        maximumDistance: { value: field.maximum }, progress: { value: 0 }, clock: { value: 0 },
      };
      geometry = new THREE.PlaneGeometry(2, 2);
      material = new THREE.ShaderMaterial({
        uniforms, transparent: true, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
        fragmentShader,
      });
      const scene = new THREE.Scene(), camera = new THREE.Camera();
      scene.add(new THREE.Mesh(geometry, material));
      const draw = () => renderer.render(scene, camera);
      const animate = now => {
        frame = 0;
        if (disposed || current <= .0001 || current >= .9999 || document.hidden) {
          lastTime = undefined;
          return;
        }
        if (lastTime === undefined || now - lastTime >= 1000 / 30) {
          if (lastTime !== undefined) elapsed += Math.min(.1, (now - lastTime) / 1000);
          lastTime = now;
          uniforms.clock.value = elapsed;
          draw();
        }
        frame = requestAnimationFrame(animate);
      };
      const setProgress = value => {
        current = Math.max(0, Math.min(1, value));
        uniforms.progress.value = current;
        canvas.dataset.active = String(current > .0001 && current < .9999);
        canvas.style.opacity = current > .0001 && current < .9999 ? '1' : '0';
        if (current <= .0001) { elapsed = 0; uniforms.clock.value = 0; }
        if (current <= .0001 || current >= .9999) {
          cancelAnimationFrame(frame);
          frame = 0;
          lastTime = undefined;
        }
        draw();
        if (!frame && !document.hidden && current > .0001 && current < .9999) {
          frame = requestAnimationFrame(animate);
        }
      };
      const resize = width => {
        const pixels = Math.round(Math.min(innerWidth < 600 ? 900 : 1600, width * Math.min(devicePixelRatio, 1.5)));
        renderer.setSize(pixels, Math.round(pixels * photo.naturalHeight / photo.naturalWidth), false);
        draw();
      };
      const onVisibility = () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          frame = 0;
          lastTime = undefined;
        } else setProgress(current);
      };
      const release = dispose;
      resize(photo.getBoundingClientRect().width);
      if (renderer.info.programs.some(program => program.diagnostics?.runnable === false)) {
        throw new Error('Living ink shader could not compile');
      }
      setProgress(0);
      document.addEventListener('visibilitychange', onVisibility);
      return { canvas, setProgress, resize, dispose: () => {
        document.removeEventListener('visibilitychange', onVisibility);
        release();
      } };
    } catch (error) {
      dispose();
      throw error;
    }
  };
})();
