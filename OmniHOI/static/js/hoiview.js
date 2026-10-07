/* HOIView: side-by-side 3D panels on one canvas, rotated and zoomed together.
 *
 * A bundle (tools/build_scenes.py) holds meshes and a list of panels; every
 * panel draws a subset of the meshes.  All panels share one orbit state, so
 * dragging any of them turns all of them.  With `shared_frame` the panels also
 * share the orbit centre (same coordinates, e.g. MANO vs robot hand); without
 * it each panel is centred and framed on its own content (reconstructions
 * from different methods live in different frames).
 *
 * Styling is left to the page: each panel gets a <div class="hv-panel"> behind
 * the transparent canvas, holding its label.
 */
(function () {
  "use strict";
  const T = window.THREE;
  const bundles = new Map();
  const swayStart = performance.now();
  const swayAmplitude = 0.32;
  const swaySpeed = 0.08; // Radians per second, shared by both viewers.

  function loadBundle(url) {
    if (!bundles.has(url)) {
      bundles.set(url, (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(url + ": " + res.status);
        const m = await res.json();
        const bin = url.slice(0, url.lastIndexOf("/") + 1) + m.bin;
        const buf = await (await fetch(bin)).arrayBuffer();
        if (buf.byteLength !== m.bytes) throw new Error(bin + ": truncated");
        return { m, buf };
      })());
    }
    return bundles.get(url);
  }

  function geometry(e, buf) {
    const n = e.vertices, q = new Int16Array(buf, e.position, n * 3), pos = new Float32Array(n * 3);
    for (let a = 0; a < 3; a++) {
      const lo = e.min[a], s = (e.max[a] - lo) / 65534;
      for (let i = a; i < n * 3; i += 3) pos[i] = lo + (q[i] + 32767) * s;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("normal", new T.BufferAttribute(new Int8Array(buf, e.normal, n * 3), 3, true));
    const I = e.index;
    g.setIndex(new T.BufferAttribute(I.u32 ? new Uint32Array(buf, I.offset, I.count) : new Uint16Array(buf, I.offset, I.count), 1));
    if (e.color != null) {
      const c = new Uint8Array(buf, e.color, n * 3), f = new Float32Array(n * 3), col = new T.Color();
      for (let i = 0; i < n; i++) {
        col.setRGB(c[3 * i] / 255, c[3 * i + 1] / 255, c[3 * i + 2] / 255, T.SRGBColorSpace);
        f[3 * i] = col.r; f[3 * i + 1] = col.g; f[3 * i + 2] = col.b;
      }
      g.setAttribute("color", new T.BufferAttribute(f, 3));
    }
    g.computeBoundingBox();
    return g;
  }

  function material(item, theme) {
    if (item.role === "anchors") {
      return new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.0, side: T.DoubleSide });
    }
    const m = new T.MeshStandardMaterial({
      color: new T.Color(item.color),
      roughness: item.role === "object" ? 0.72 : 0.46,
      metalness: 0.02,
      side: T.DoubleSide,
    });
    if (theme === "dark" && item.role === "object") m.color.offsetHSL(0, 0, -0.04);
    return m;
  }

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  class HOIView {
    constructor(el, opts = {}) {
      this.el = el;
      this.opts = Object.assign({
        aspect: 1,               // panel width / height
        gap: 12,                 // px between panels
        columns: (w, n) => (w < 560 ? Math.min(n, 2) : n),
        theme: "light",
        sway: true,              // gentle idle turn until the first touch
        panels: 1,               // expected panel count, sizes the host before loading
        viewScale: 1,            // distance factor applied to a saved camera position
        fit: 1.12,               // margin around the content when framing it
      }, opts);
      el.classList.add("hv");
      this.frames = document.createElement("div");
      this.frames.className = "hv-frames";
      this.canvas = document.createElement("canvas");
      this.canvas.className = "hv-canvas";
      this.status = document.createElement("div");
      this.status.className = "hv-status";
      el.append(this.frames, this.canvas, this.status);

      this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(0x000000, 0);

      this.panels = [];
      this.orbit = { theta: 0, phi: Math.PI / 2, zoom: 1, panX: 0, panY: 0 };
      this.touched = false;
      this.visible = false;
      this.xray = false;
      this.anchors = false;

      this._bindPointer();
      new ResizeObserver(() => this._layout()).observe(el);
      new IntersectionObserver((es) => {
        this.visible = es[0].isIntersecting;
        if (this.visible) this._kick();
      }).observe(el);
    }

    /* ---------- loading ---------- */

    async show(url) {
      this.current = url;
      this.el.classList.add("is-loading");
      this.status.textContent = "Loading 3D scene…";
      let data;
      try {
        data = await loadBundle(url);
      } catch (err) {
        this.status.textContent = "Could not load the 3D scene.";
        console.error(err);
        return;
      }
      if (this.current !== url) return;
      this._build(data.m, data.buf);
      this.el.classList.remove("is-loading");
      this.status.textContent = "";
    }

    _dispose() {
      for (const p of this.panels) {
        p.scene.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      }
      if (this.geoms) for (const g of this.geoms.values()) g.dispose();
      this.panels = [];
      this.frames.textContent = "";
    }

    _build(m, buf) {
      this._dispose();
      this.bundle = m;
      this.geoms = new Map();
      for (const [k, e] of Object.entries(m.meshes)) this.geoms.set(k, geometry(e, buf));
      const v = m.view || {};
      this.fov = v.fov || 30;

      const unionBox = (items, roles) => {
        const box = new T.Box3();
        for (const it of items) if (!roles || roles.includes(it.role)) box.union(this.geoms.get(it.mesh).boundingBox);
        return box;
      };
      let shared = null;
      if (m.shared_frame) {
        const all = m.panels.flatMap((p) => p.items);
        const box = unionBox(all, ["hand"]);
        shared = this._frame(box, v);
      }
      for (const pm of m.panels) {
        const scene = new T.Scene();
        const camera = new T.PerspectiveCamera(this.fov, 1, 0.005, 50);
        scene.add(camera);
        camera.add(new T.HemisphereLight(0xffffff, this.opts.theme === "dark" ? 0x2a2c33 : 0xb9bec8, 1.35));
        // Lights ride on the camera and aim along its view axis, so every panel
        // is lit the same way whatever the scale or placement of its content.
        const aim = new T.Object3D();
        aim.position.set(0, 0, -1);
        camera.add(aim);
        const light = (color, power, x, y, z) => {
          const l = new T.DirectionalLight(color, power);
          l.position.set(x, y, z - 1);
          l.target = aim;
          camera.add(l);
        };
        light(0xffffff, 2.1, -0.6, 0.9, 0.9);                                   // key, upper left
        light(0xdfe8ff, 0.55, 0.8, -0.2, 0.6);                                  // fill, right
        light(0xffffff, this.opts.theme === "dark" ? 0.9 : 0.35, 0.2, 0.5, -1.2); // rim, from behind
        for (const it of pm.items) {
          const mesh = new T.Mesh(this.geoms.get(it.mesh), material(it, this.opts.theme));
          mesh.userData.role = it.role;
          scene.add(mesh);
        }
        const frame = m.shared_frame ? shared : this._frame(unionBox(pm.items), v);
        const div = document.createElement("div");
        div.className = "hv-panel";
        div.dataset.key = pm.key;
        const label = document.createElement("span");
        label.className = "hv-label";
        label.textContent = pm.label;
        div.append(label);
        this.frames.append(div);
        this.panels.push({ scene, camera, frame, div });
      }
      this._applyMaterials();
      this.resetView(false);
      this._layout();
    }

    /* Orbit frame: centre, pole (up), reference direction, base distance. */
    _frame(box, v) {
      const center = box.getCenter(new T.Vector3());
      const radius = Math.max(box.getSize(new T.Vector3()).length() / 2, 1e-3);
      let target = center, dir, dist;
      if (v.position && v.target) {
        target = new T.Vector3(...v.target);
        const off = new T.Vector3(...v.position).sub(target);
        dist = off.length() * this.opts.viewScale;
        dir = off.normalize();
      } else {
        dir = new T.Vector3(...(v.direction || [0, 0, 1])).normalize();
        dist = null;  // fitted in _camera, needs the panel aspect
      }
      const pole = new T.Vector3(...(v.up || [0, 1, 0])).normalize();
      const phi0 = Math.acos(clamp(dir.dot(pole), -1, 1));
      const ex = dir.clone().addScaledVector(pole, -dir.dot(pole));
      if (ex.lengthSq() < 1e-8) ex.set(1, 0, 0);
      ex.normalize();
      const ey = new T.Vector3().crossVectors(pole, ex);
      return { target, radius, dist, pole, ex, ey, phi0 };
    }

    resetView(render = true) {
      const f = this.panels[0] && this.panels[0].frame;
      this.orbit = { theta: 0, phi: f ? f.phi0 : Math.PI / 2, zoom: 1, panX: 0, panY: 0 };
      this.swayBase = 0;
      if (render) this._kick();
    }

    setXray(on) { this.xray = on; this._applyMaterials(); this._kick(); }
    setAnchors(on) { this.anchors = on; this._applyMaterials(); this._kick(); }

    _applyMaterials() {
      for (const p of this.panels) {
        p.scene.traverse((o) => {
          if (!o.isMesh) return;
          const r = o.userData.role;
          if (r === "object") {
            o.material.transparent = this.xray;
            o.material.opacity = this.xray ? 0.3 : 1;
            o.material.depthWrite = !this.xray;
            o.renderOrder = this.xray ? 2 : 0;
            o.material.needsUpdate = true;
          }
          if (r === "anchors") o.visible = this.anchors;
        });
      }
    }

    hasAnchors() {
      return !!this.bundle && this.bundle.panels.some((p) => p.items.some((i) => i.role === "anchors"));
    }

    /* ---------- layout and drawing ---------- */

    _layout() {
      const n = this.panels.length || this.opts.panels || 1;
      const W = this.el.clientWidth;
      if (!W) return;
      const cols = this.opts.columns(W, n), rows = Math.ceil(n / cols), g = this.opts.gap;
      const pw = (W - (cols - 1) * g) / cols, ph = pw / this.opts.aspect;
      const H = Math.round(rows * ph + (rows - 1) * g);
      this.el.style.height = H + "px";
      this.renderer.setSize(W, H, false);
      this.rects = [];
      this.panels.forEach((p, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const rect = { x: c * (pw + g), y: r * (ph + g), w: pw, h: ph };
        this.rects.push(rect);
        Object.assign(p.div.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px" });
        p.camera.aspect = pw / ph;
        p.camera.updateProjectionMatrix();
      });
      this.H = H;
      this._kick();
    }

    _camera(p) {
      const f = p.frame, o = this.orbit, cam = p.camera;
      let dist = f.dist;
      if (dist == null) {
        const half = T.MathUtils.degToRad(this.fov) / 2;
        const hfov = Math.atan(Math.tan(half) * Math.min(cam.aspect, 1));
        dist = (f.radius * this.opts.fit) / Math.sin(hfov);
      }
      dist *= o.zoom;
      const s = Math.sin(o.phi);
      const dir = new T.Vector3()
        .addScaledVector(f.ex, s * Math.cos(o.theta))
        .addScaledVector(f.ey, s * Math.sin(o.theta))
        .addScaledVector(f.pole, Math.cos(o.phi));
      // pan in the view plane, in units of the orbit distance
      const right = new T.Vector3().crossVectors(f.pole, dir).normalize();
      const up = new T.Vector3().crossVectors(dir, right).normalize();
      const target = f.target.clone().addScaledVector(right, -o.panX * dist).addScaledVector(up, o.panY * dist);
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.up.copy(f.pole);
      cam.lookAt(target);
      cam.near = dist / 20;
      cam.far = dist * 10;
      cam.updateProjectionMatrix();
    }

    _draw(now = performance.now()) {
      const H = this.H;
      if (this.opts.sway && !this.touched) {
        const t = (now - swayStart) / 1000;
        const phase = (t * swaySpeed + swayAmplitude) % (4 * swayAmplitude);
        this.orbit.theta = swayAmplitude - Math.abs(phase - 2 * swayAmplitude);
      }
      this.renderer.setScissor(0, 0, this.el.clientWidth, H);
      this.renderer.setViewport(0, 0, this.el.clientWidth, H);
      this.renderer.clear();
      this.panels.forEach((p, i) => {
        const r = this.rects[i];
        if (!r) return;
        const y = H - r.y - r.h;
        this.renderer.setViewport(r.x, y, r.w, r.h);
        this.renderer.setScissor(r.x, y, r.w, r.h);
        this._camera(p);
        this.renderer.render(p.scene, p.camera);
      });
    }

    _kick() {
      if (this.raf || !this.panels.length) return;
      this.raf = requestAnimationFrame((now) => {
        this.raf = 0;
        if (!this.rects) return;
        this._draw(now);
        const animating = this.opts.sway && !this.touched;
        if (this.visible && animating && !document.hidden) this._kick();
      });
    }

    /* ---------- interaction ---------- */

    _bindPointer() {
      const c = this.canvas;
      const pts = new Map();
      let last = null, pinch = null;
      c.style.touchAction = "pan-y";
      c.addEventListener("pointerdown", (e) => {
        this.touched = true;
        this.engaged = true;
        c.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        last = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey };
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.orbit.zoom };
        }
        this.el.classList.add("is-dragging");
      });
      c.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.orbit.zoom = clamp(pinch.zoom * pinch.d / Math.max(d, 1), 0.25, 4);
          this._kick();
          return;
        }
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last.x = e.clientX; last.y = e.clientY;
        const h = this.rects && this.rects[0] ? this.rects[0].h : 300;
        if (last.button === 2 || last.shift) {
          this.orbit.panX += dx / h * 0.8;
          this.orbit.panY += dy / h * 0.8;
        } else {
          this.orbit.theta -= dx / h * 2.6;
          this.orbit.phi = clamp(this.orbit.phi - dy / h * 2.6, 0.05, Math.PI - 0.05);
        }
        this._kick();
      });
      const up = (e) => {
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
        if (!pts.size) this.el.classList.remove("is-dragging");
      };
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", up);
      c.addEventListener("contextmenu", (e) => e.preventDefault());
      c.addEventListener("dblclick", () => this.resetView());
      // The wheel zooms only once the viewer has been clicked, so that
      // scrolling the page past the viewer never gets captured.
      c.addEventListener("wheel", (e) => {
        if (!this.engaged && !e.ctrlKey) return;
        e.preventDefault();
        this.orbit.zoom = clamp(this.orbit.zoom * Math.exp(e.deltaY * 0.0012), 0.25, 4);
        this._kick();
      }, { passive: false });
      c.addEventListener("pointerleave", () => { if (!pts.size) this.engaged = false; });
    }
  }

  window.HOIView = HOIView;
})();
