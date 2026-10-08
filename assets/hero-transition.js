// One viewport: a flowing alpha mask, photo depth and text share scroll progress.
(() => {
  if (new URLSearchParams(location.search).get('preview') === '1') return;
  if (!CSS.supports('mask-image', 'linear-gradient(#000, #000)')) return;
  const assetBase = new URL('.', document.currentScript.src);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let pendingNavigation;
  const scrollRestoration = history.scrollRestoration;
  // Run in the head, before the body is painted. Keep the same viewport while
  // assets load. Gestures received before readiness must not become a delayed
  // scroll burst; only an explicit anchor click is retained.
  const holdScene = () => {
    const state = { hash: location.hash };
    const listeners = [];
    const listen = (target, type, callback, options) => {
      target.addEventListener(type, callback, options);
      listeners.push(() => target.removeEventListener(type, callback, options));
    };
    const ignored = event => event.ctrlKey || event.metaKey || event.altKey
      || event.target.closest?.('.wechat-card') || document.querySelector('.wechat-card:popover-open');
    history.scrollRestoration = 'manual';
    document.documentElement.classList.add('has-hero-scene');
    listen(window, 'wheel', event => {
      if (ignored(event)) return;
      event.preventDefault();
    }, { passive: false });
    listen(window, 'touchmove', event => {
      if (ignored(event) || event.touches.length !== 1) return;
      event.preventDefault();
    }, { passive: false });
    listen(document, 'keydown', event => {
      if (ignored(event) || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ' && event.target.closest('a, button')) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(event.key)) event.preventDefault();
    });
    listen(document, 'click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || ignored(event) || event.shiftKey) return;
      const hash = link.getAttribute('href');
      const target = document.getElementById(hash.slice(1));
      if (!target || (!target.matches('.hero, .second-page') && !target.closest('.profile-shell'))) return;
      event.preventDefault();
      state.hash = hash;
      if (location.hash !== hash) history.pushState(null, '', hash);
    });
    listen(window, 'hashchange', () => { state.hash = location.hash; });
    return { state, stop: () => listeners.forEach(remove => remove()) };
  };
  const finishLoading = (fallback = false) => {
    const navigation = pendingNavigation?.state;
    pendingNavigation?.stop();
    pendingNavigation = null;
    if (fallback && navigation) {
      history.scrollRestoration = scrollRestoration;
      document.documentElement.classList.remove('has-hero-scene');
      requestAnimationFrame(() => {
        if (document.documentElement.classList.contains('has-hero-scene')) return;
        const target = document.getElementById(navigation.hash.slice(1));
        const top = target ? target.getBoundingClientRect().top + scrollY : 0;
        window.scrollTo({ top, behavior: 'instant' });
      });
    }
    return navigation;
  };
  if (!motion.matches) {
    // A reload starts a new introduction, even after an in-page arrow/anchor.
    // Fresh navigation to a shared section URL still honors its hash.
    if (performance.getEntriesByType('navigation')[0]?.type === 'reload' && location.hash) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    pendingNavigation = holdScene();
  }
  function connect() {
    const hero = document.querySelector('.hero');
    const portrait = hero?.querySelector('.portrait');
    const photo = portrait?.querySelector('.splash-photo');
    const stage = document.querySelector('main');
    const sceneBackground = stage?.querySelector('.scene-background img');
    const header = hero?.querySelector('.site-header');
    const profile = document.querySelector('.second-page');
    const content = profile?.querySelector('.profile-shell');
    if (!photo || !content) { finishLoading(true); return; }
    const loaded = new Map();
    let cleanup = () => {}, generation = 0;
    const load = path => {
      if (!loaded.has(path)) loaded.set(path, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(path, assetBase);
        script.onload = resolve;
        script.onerror = () => {
          loaded.delete(path);
          script.remove();
          reject(new Error(`Could not load ${path}`));
        };
        document.head.append(script);
      }));
      return loaded.get(path);
    };
    const smooth = (start, end, value) => {
      const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
      return t * t * (3 - 2 * t);
    };
    async function initialize() {
      const token = ++generation;
      const dispose = cleanup;
      cleanup = () => {};
      dispose();
      if (motion.matches) { finishLoading(true); return; }
      if (!pendingNavigation) pendingNavigation = holdScene();
      profile.inert = true;
      const cue = hero.querySelector('.scroll-cue');
      const releases = [];
      let disposed = false, readinessTimer;
      const disposeScene = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(readinessTimer);
        for (const release of releases.reverse()) {
          try { release(); } catch (error) { console.warn('Hero fog cleanup:', error); }
        }
        document.documentElement.classList.remove('has-hero-scene');
        document.body.classList.remove('has-hero-fog');
        history.scrollRestoration = scrollRestoration;
        stage.style.removeProperty('--profile-y');
        stage.style.removeProperty('--hero-copy-y');
        stage.style.removeProperty('--background-reveal');
        profile.inert = header.inert = false;
        portrait.style.visibility = photo.style.opacity = '';
        if (cue) { cue.style.opacity = ''; cue.inert = false; }
      };
      cleanup = disposeScene;
      const listen = (target, type, callback) => {
        target.addEventListener(type, callback);
        releases.push(() => target.removeEventListener(type, callback));
      };
      try {
        const prepare = async () => {
          await Promise.all([
            load('vendor/three/three.min.js'),
            load('living-ink-mask.js'),
            load('vendor/gsap/gsap.min.js').then(() => load('vendor/gsap/ScrollTrigger.min.js')),
            photo.decode(),
            sceneBackground?.decode(),
          ]);
          const maskUrl = getComputedStyle(photo).maskImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
          if (!maskUrl) throw new Error('Photo mask is missing');
          const mask = new Image();
          mask.src = maskUrl;
          await mask.decode();
          return mask;
        };
        const mask = await Promise.race([
          prepare(),
          new Promise((_, reject) => {
            readinessTimer = setTimeout(() => reject(new Error('Hero assets took too long to load')), 15000);
          }),
        ]);
        clearTimeout(readinessTimer);
        if (token !== generation || motion.matches) return;
        // Scale a full-viewport wrapper so the photo's original crop/translation
        // stays intact, including the workbench's responsive photo positioning.
        const depth = document.createElement('div');
        depth.className = 'photo-depth';
        photo.before(depth);
        depth.append(photo);
        releases.push(() => depth.replaceWith(photo));
        const ink = createLivingInkMask({ photo, mask, depth, THREE });
        releases.push(() => ink.dispose());
        const state = { offset: 0 };
        let targetOffset = 0, viewport = innerHeight, transitionDistance = 0, maxOffset = 0;
        let movement;
        releases.push(() => movement?.kill());
        let rect;
        const measure = () => {
          const oldTransition = transitionDistance, oldMax = maxOffset;
          viewport = stage.clientHeight;
          transitionDistance = viewport * .95;
          maxOffset = transitionDistance + Math.max(0, content.offsetHeight - viewport);
          const remap = value => !oldTransition ? value : value <= oldTransition
            ? value / oldTransition * transitionDistance
            : transitionDistance + (value - oldTransition) / Math.max(1, oldMax - oldTransition) * (maxOffset - transitionDistance);
          movement?.kill();
          state.offset = Math.min(maxOffset, remap(state.offset));
          targetOffset = Math.min(maxOffset, remap(targetOffset));
          depth.style.transform = '';
          rect = photo.getBoundingClientRect();
          const parent = depth.getBoundingClientRect();
          depth.style.transformOrigin = `${rect.left + rect.width * .7 - parent.left}px ${rect.top + rect.height * .43 - parent.top}px`;
          ink.resize(rect.width);
        };
        const render = () => {
          if (!rect) return;
          const p = Math.min(1, state.offset / transitionDistance);
          const photoScale = 1 - .34 * smooth(0, .85, p);
          depth.style.transform = `scale(${photoScale})`;
          ink.setProgress(p);
          stage.style.setProperty('--background-reveal', smooth(.1, .85, p));
          // The image element supplies the resting view and fallback. During
          // motion the canvas draws the photo with its changing alpha contour.
          photo.style.opacity = p > .0001 ? '0' : '1';
          portrait.style.visibility = p >= .999 ? 'hidden' : '';
          const contentY = viewport * (1 - smooth(.18, .85, p)) - Math.max(0, state.offset - transitionDistance);
          stage.style.setProperty('--profile-y', `${contentY}px`);
          stage.style.setProperty('--hero-copy-y', `${-viewport * p * 1.1}px`);
          // Keep offscreen links out of the keyboard and accessibility focus order.
          profile.inert = p < .25;
          header.inert = p > .55;
          if (cue) {
            cue.style.opacity = 1 - smooth(0, .2, p);
            cue.inert = p > .2;
          }
        };
        const moveTo = (value, immediate = false, duration = .35) => {
          targetOffset = Math.max(0, Math.min(maxOffset, value));
          movement?.kill();
          if (immediate) { state.offset = targetOffset; render(); }
          else movement = gsap.to(state, {
            offset: targetOffset, duration,
            ease: duration > .35 ? 'power2.inOut' : 'power2.out', onUpdate: render,
          });
        };
        const navigate = (hash, immediate = false, duration = .35) => {
          if (!hash || hash === '#home') { moveTo(0, immediate, duration); return true; }
          const target = document.getElementById(hash.slice(1));
          if (target !== profile && !content.contains(target)) return false;
          const relativeTop = target === profile ? 0 : target.getBoundingClientRect().top - content.getBoundingClientRect().top;
          moveTo(transitionDistance + Math.max(0, relativeTop - 56), immediate, duration);
          return true;
        };
        const onAnchor = event => {
          const link = event.target.closest('a[href^="#"]');
          if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          const hash = link.getAttribute('href');
          if (navigate(hash, false, link.matches('.scroll-cue') ? 1.8 : .35)) {
            event.preventDefault();
            if (location.hash !== hash) history.pushState(null, '', hash);
          }
        };
        const onHash = () => navigate(location.hash);
        const onKey = event => {
          if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('.wechat-card:popover-open')) return;
          if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
          if (event.key === ' ' && event.target.closest('a, button')) return;
          const delta = { ArrowDown: 70, ArrowUp: -70, PageDown: viewport * .8, PageUp: -viewport * .8, ' ': viewport * (event.shiftKey ? -.8 : .8) }[event.key];
          if (delta !== undefined) { event.preventDefault(); moveTo(targetOffset + delta); }
          else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); moveTo(event.key === 'Home' ? 0 : maxOffset);
          }
        };
        const onFocus = event => {
          if (!content.contains(event.target)) return;
          const bounds = event.target.getBoundingClientRect();
          if (bounds.top < 24 || bounds.bottom > viewport - 24) {
            const top = bounds.top - content.getBoundingClientRect().top;
            moveTo(transitionDistance + Math.max(0, top - 56), true);
          }
        };
        const onResize = () => {
          measure();
          render();
          if (Math.abs(targetOffset - state.offset) > .5) moveTo(targetOffset);
        };
        window.scrollTo({ top: 0, behavior: 'instant' });
        measure();
        gsap.registerPlugin(ScrollTrigger);
        const observer = ScrollTrigger.observe({
          target: window, type: 'wheel,touch', preventDefault: true, allowClicks: true,
          tolerance: 1, dragMinimum: 3,
          ignore: [...document.querySelectorAll('.wechat-card, .wechat-card *')],
          ignoreCheck: event => event.ctrlKey || event.touches?.length > 1,
          onChangeY: self => {
            if (document.querySelector('.wechat-card:popover-open')) return;
            const delta = self.event.type === 'wheel' ? self.deltaY : -self.deltaY;
            moveTo(targetOffset + delta);
          },
        });
        releases.push(() => observer.kill());
        const resizeObserver = new ResizeObserver(onResize);
        releases.push(() => resizeObserver.disconnect());
        resizeObserver.observe(content);
        listen(window, 'resize', onResize);
        listen(window, 'hashchange', onHash);
        listen(document, 'click', onAnchor);
        listen(document, 'keydown', onKey);
        listen(document, 'focusin', onFocus);
        const navigation = finishLoading();
        if (!navigate(navigation?.hash || location.hash, true)) render();
        document.body.classList.add('has-hero-fog');
      } catch (error) {
        if (token !== generation) return;
        // Native scrolling and the original photo remain available without WebGL.
        disposeScene();
        finishLoading(true);
        console.warn('Hero fog could not initialize:', error);
      }
    }
    motion.addEventListener('change', initialize);
    initialize();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
})();
