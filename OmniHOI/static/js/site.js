/* Page components shared by classic.html and modern.html.
 *
 * Each component builds its own DOM inside a host element and leaves all
 * visual styling to the page's stylesheet, so the two page styles differ
 * only in markup and CSS.  Hosts are found by data attributes:
 *
 *   [data-pair-player]   human video next to robot execution, task tabs
 *   [data-swap-cards]    robot clips; hover (tap) shows the human video
 *   [data-recon]         E018 reconstructions, four methods in 3D
 *   [data-retarget]      MANO hand vs kinematic vs contact-aware retargeting
 *   [data-chart]         transfer bar chart | recon table | e2e bars
 *   [data-copy]          copy the text of the referenced element
 *   [data-link]          buttons filled from <script id="page-links">
 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
  };

  function whenNear(el, fn, margin = "600px") {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: margin });
    io.observe(el);
  }
  function onVisible(el, fn, threshold = 0.25) {
    new IntersectionObserver((es) => fn(es[0].isIntersecting), { threshold }).observe(el);
  }
  const fetchJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
  const fmt = (v, d) => (v == null ? "—" : Number(v).toFixed(d));
  const isOurs = (name) => name === "OmniHOI" || /ours/i.test(name);

  /* ---------- links, BibTeX ---------- */

  function initLinks() {
    const node = $("#page-links");
    const cfg = node ? JSON.parse(node.textContent) : {};
    for (const a of $$("[data-link]")) {
      const url = cfg[a.dataset.link];
      if (url) {
        a.href = url;
        if (/^https?:/.test(url)) { a.target = "_blank"; a.rel = "noopener"; }
      } else {
        a.classList.add("is-soon");
        a.removeAttribute("href");
        a.setAttribute("aria-disabled", "true");
        a.title = "Coming soon";
      }
    }
  }

  function initCopy() {
    for (const b of $$("[data-copy]")) {
      b.addEventListener("click", async () => {
        const text = $(b.dataset.copy).textContent.trim();
        try { await navigator.clipboard.writeText(text); } catch (e) {
          const r = document.createRange(); r.selectNodeContents($(b.dataset.copy));
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy"); s.removeAllRanges();
        }
        const old = b.textContent;
        b.textContent = "Copied";
        b.classList.add("is-done");
        setTimeout(() => { b.textContent = old; b.classList.remove("is-done"); }, 1400);
      });
    }
  }

  /* Teaser wall and other plain looping videos: play only while visible. */
  function initAutoVideos() {
    for (const v of $$("video[data-autoplay]")) {
      v.muted = true;
      if (reduceMotion) continue;
      onVisible(v, (vis) => { if (vis) v.play().catch(() => {}); else v.pause(); }, 0.1);
    }
  }

  /* ---------- human / robot pair player ---------- */

  class PairPlayer {
    constructor(host, clips, base) {
      this.clips = clips;
      this.base = base;
      this.i = 0;
      this.userPaused = reduceMotion;
      const side = (cls, title) => {
        const v = h("video", { muted: true, playsinline: true, preload: "none", disablepictureinpicture: true });
        v.muted = true;
        const cap = h("figcaption", {}, h("span", { class: "pp-kind", text: title }), h("span", { class: "pp-time" }));
        return { fig: h("figure", { class: "pp-side " + cls }, h("div", { class: "pp-frame" }, v), cap), v, cap };
      };
      this.human = side("pp-human", host.dataset.humanLabel || "Human video");
      this.robot = side("pp-robot", host.dataset.robotLabel || "Robot execution");
      this.bar = h("div", { class: "pp-progress" }, h("i"));
      this.toggle = h("button", { class: "pp-toggle", type: "button", "aria-label": "Pause", onclick: () => this.togglePlay() });
      this.tabs = h("div", { class: "pp-tabs", role: "tablist" },
        clips.map((c, i) => h("button", { class: "pp-tab", type: "button", role: "tab", onclick: () => this.select(i, true) },
          h("span", { class: "pp-name", text: c.label }))));
      const stage = h("div", { class: "pp-stage" }, this.human.fig, h("div", { class: "pp-arrow", "aria-hidden": "true" }), this.robot.fig);
      host.append(
        stage,
        h("div", { class: "pp-controls" }, this.toggle, this.bar),
        this.tabs);
      if (host.classList.contains("hm-player")) {
        // Fit the rounded frame itself, not just the video inside a larger box.
        const fitFrames = () => {
          for (const s of [this.human, this.robot]) {
            const gap = parseFloat(getComputedStyle(s.cap).marginTop) || 0;
            const height = Math.max(0, s.fig.clientHeight - s.cap.getBoundingClientRect().height - gap);
            const aspect = s.v.videoWidth && s.v.videoHeight ? s.v.videoWidth / s.v.videoHeight : 4 / 3;
            const width = window.matchMedia("(max-height: 480px)").matches
              ? s.fig.clientWidth : Math.min(s.fig.clientWidth, height * aspect);
            Object.assign(s.v.parentElement.style, { width: width + "px", height: width / aspect + "px" });
            s.cap.style.width = width + "px";
          }
        };
        new ResizeObserver(fitFrames).observe(stage);
        for (const s of [this.human, this.robot]) s.v.addEventListener("loadedmetadata", fitFrames);
        document.fonts.ready.then(fitFrames);
      }
      this.robot.v.addEventListener("ended", () => this.select((this.i + 1) % clips.length, false));
      this.visible = false;
      onVisible(host, (vis) => { this.visible = vis; this._sync(); }, 0.2);
      whenNear(host, () => this.select(0, false));
      const tick = () => {
        const v = this.robot.v;
        if (v.duration) this.bar.firstChild.style.transform = `scaleX(${v.currentTime / v.duration})`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      this._icon();
    }

    select(i, byUser) {
      this.i = i;
      const c = this.clips[i];
      if (byUser) this.userPaused = false;
      $$(".pp-tab", this.tabs).forEach((t, k) => { t.classList.toggle("is-active", k === i); t.setAttribute("aria-selected", k === i); });
      for (const [s, kind] of [[this.human, "human"], [this.robot, "robot"]]) {
        s.v.poster = `${this.base}${c.slug}_${kind}.jpg`;
        s.v.src = `${this.base}${c.slug}_${kind}.mp4`;
        s.v.preload = "auto";
        s.cap.querySelector(".pp-time").textContent = c[kind].duration.toFixed(1) + " s";
      }
      this._sync();
      this._icon();
    }

    togglePlay() { this.userPaused = !this.userPaused; this._sync(); this._icon(); }

    _icon() {
      this.toggle.classList.toggle("is-paused", this.userPaused);
      this.toggle.setAttribute("aria-label", this.userPaused ? "Play" : "Pause");
    }

    _sync() {
      const run = this.visible && !this.userPaused && !document.hidden;
      for (const v of [this.human.v, this.robot.v]) {
        if (!v.src) continue;
        if (run) { if (!(v === this.human.v && v.ended)) v.play().catch(() => {}); } else v.pause();
      }
    }
  }

  /* ---------- robot clips that reveal the human video on hover ---------- */

  function swapCards(host, clips, base) {
    const note = host.dataset.note;
    for (const c of clips) {
      const robot = h("video", { muted: true, loop: true, playsinline: true, preload: "none", poster: `${base}${c.slug}_robot.jpg`, src: `${base}${c.slug}_robot.mp4` });
      const human = h("video", { class: "sc-human", muted: true, loop: true, playsinline: true, preload: "none", poster: `${base}${c.slug}_human.jpg`, src: `${base}${c.slug}_human.mp4` });
      robot.muted = human.muted = true;
      const card = h("figure", { class: "sc-card", tabindex: "0" },
        h("div", { class: "sc-frame" }, robot, human,
          h("span", { class: "sc-tag sc-tag-robot", text: "Robot" }), h("span", { class: "sc-tag sc-tag-human", text: "Human" })),
        h("figcaption", {}, h("span", { class: "sc-name", text: c.label }), h("span", { class: "sc-hint", text: "hover for the human video" })));
      host.append(card);
      const show = (on) => {
        card.classList.toggle("is-human", on);
        if (on) { human.currentTime = 0; human.play().catch(() => {}); } else human.pause();
      };
      card.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(true); });
      card.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") show(false); });
      card.addEventListener("click", () => show(!card.classList.contains("is-human")));
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(!card.classList.contains("is-human")); } });
      if (!reduceMotion) onVisible(card, (vis) => { if (vis) robot.play().catch(() => {}); else { robot.pause(); show(false); } }, 0.35);
    }
    if (note) host.append(h("p", { class: "cards-note" }, h("b", { text: "Hover to compare." }), note));
  }

  /* ---------- 3D: reconstruction comparison ---------- */

  function reconCompare(host, index, base, theme) {
    const input = h("img", { alt: "Input image", loading: "lazy" });
    const inputFigure = h("figure", { class: "rc-input" }, h("div", { class: "rc-input-frame" }, input), h("figcaption", { class: "hv-label", text: "Input image" }));
    const viewEl = h("div", { class: "rc-view" });
    const strip = h("div", { class: "rc-samples", role: "tablist" });
    host.append(
      strip,
      h("div", { class: "rc-main" },
        inputFigure,
        viewEl),
      h("p", { class: "viewer-hint" }, hint()));
    const view = new window.HOIView(viewEl, {
      aspect: 1, theme, gap: Number(host.dataset.gap || 12), panels: 4, fit: 0.98,
      columns: (w, n) => (window.matchMedia("(max-width: 720px)").matches && w < 520 ? 2 : n),
    });
    const sizeInput = () => {
      if (view.rects && view.rects[0]) inputFigure.style.width = view.rects[0].w + "px";
    };
    new ResizeObserver(sizeInput).observe(viewEl);
    const pick = (i) => {
      $$(".rc-sample", strip).forEach((b, k) => b.classList.toggle("is-active", k === i));
      input.src = base + index[i].image;
      input.alt = "Input image: " + index[i].title;
      view.show(base + index[i].json).then(sizeInput);
    };
    index.forEach((s, i) => strip.append(
      h("button", { class: "rc-sample", type: "button", title: s.title, onclick: () => pick(i) },
        h("img", { src: base + s.image, alt: "", loading: "lazy" }), h("span", { text: s.title }))));
    pick(0);
  }

  /* ---------- 3D: retargeting explorer ---------- */

  function retargetExplorer(host, index, base, theme) {
    const viewEl = h("div", { class: "rt-view" });
    const chips = h("div", { class: "rt-scenes", role: "tablist" });
    const xray = h("input", { type: "checkbox" });
    const anchors = h("input", { type: "checkbox", checked: true });
    const anchorsLabel = h("label", { class: "rt-toggle" }, anchors, h("span", { text: "Contact anchors" }));
    const meta = h("p", { class: "rt-meta" });
    host.append(
      chips,
      viewEl,
      h("div", { class: "rt-bar" },
        h("div", { class: "rt-toggles" },
          h("label", { class: "rt-toggle" }, xray, h("span", { text: "See-through objects" })), anchorsLabel),
        meta),
      h("p", { class: "viewer-hint" }, hint()));
    const view = new window.HOIView(viewEl, {
      aspect: 1, theme, gap: Number(host.dataset.gap || 12), panels: 3, viewScale: 1.45,
      columns: (w, n) => (w < 520 ? 1 : n),
    });
    xray.addEventListener("change", () => view.setXray(xray.checked));
    anchors.addEventListener("change", () => view.setAnchors(anchors.checked));
    const pick = async (i) => {
      $$(".rt-scene", chips).forEach((b, k) => b.classList.toggle("is-active", k === i));
      const s = index[i];
      meta.textContent = `${s.dataset} · ${s.title}`;
      await view.show(base + s.json);
      view.setXray(xray.checked);
      view.setAnchors(anchors.checked);
      anchorsLabel.hidden = !view.hasAnchors();
    };
    index.forEach((s, i) => chips.append(
      h("button", { class: "rt-scene", type: "button", onclick: () => pick(i) },
        s.image ? h("img", { src: base + s.image, alt: "", loading: "lazy" }) : null,
        h("span", { class: "rt-scene-text" }, h("b", { text: s.title }), h("small", { text: s.dataset })))));
    pick(0);
  }

  /* ---------- five-hand physics replay gallery ---------- */

  function transferVideos(host, data, base) {
    const buttons = h("div", { class: "seg tf-hands", role: "group", "aria-label": "Robot hand" });
    const grid = h("div", { class: "tf-grid", role: "region", "aria-label": "Physics replay videos" });
    host.append(buttons,
      h("p", { class: "transfer-video-note", text: "The translucent green overlays show the keyframe poses." }), grid);
    const load = (v) => { if (!v.getAttribute("src")) v.src = v.dataset.src; };
    const visible = new IntersectionObserver((entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (!isIntersecting) v.pause();
        else if (!document.hidden && !reduceMotion && v.dataset.userPaused !== "true") { load(v); v.play().catch(() => {}); }
      }
    }, { threshold: 0.15 });
    const pick = (index) => {
      visible.disconnect();
      for (const v of $$("video", grid)) { v.pause(); v.removeAttribute("src"); v.load(); }
      grid.replaceChildren();
      const hand = data.hands[index];
      grid.setAttribute("aria-label", hand.label + " physics replay videos");
      $$("button", buttons).forEach((b, i) => {
        b.classList.toggle("is-active", i === index);
        b.setAttribute("aria-pressed", String(i === index));
      });
      for (const task of data.tasks) {
        const stem = base + hand.id + "/" + task.id;
        const v = h("video", { muted: true, loop: true, playsinline: true, preload: "none", poster: stem + ".jpg",
          "data-src": stem + ".mp4", "aria-label": hand.label + ": " + task.title });
        v.muted = true;
        const toggle = h("button", { class: "pp-toggle tf-toggle is-paused", type: "button", "aria-label": "Play: " + task.title,
          onclick: () => {
            if (v.paused) { v.dataset.userPaused = "false"; load(v); v.play().catch(() => {}); }
            else { v.dataset.userPaused = "true"; v.pause(); }
          } });
        const icon = () => {
          toggle.classList.toggle("is-paused", v.paused);
          toggle.setAttribute("aria-label", (v.paused ? "Play: " : "Pause: ") + task.title);
        };
        v.addEventListener("play", icon);
        v.addEventListener("pause", icon);
        grid.append(h("figure", { class: "tf-card", "data-task": task.id },
          h("div", { class: "tf-frame" }, v, h("span", { class: "tf-dataset", text: task.dataset }), toggle),
          h("figcaption", { text: task.title })));
        visible.observe(v);
      }
      grid.scrollTop = 0;
    };
    data.hands.forEach((hand, i) => buttons.append(h("button", { type: "button", text: hand.label, onclick: () => pick(i) })));
    pick(Math.max(0, data.hands.findIndex((hand) => hand.id === data.defaultHand)));
    document.addEventListener("visibilitychange", () => {
      for (const v of $$("video", grid)) {
        if (document.hidden) v.pause();
        else { visible.unobserve(v); visible.observe(v); }
      }
    });
  }

  function hint() {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    return touch ? "Drag sideways to rotate · pinch to zoom · double-tap to reset"
      : "Drag to rotate · right-drag to pan · click, then scroll to zoom · double-click to reset";
  }

  /* ---------- charts ---------- */

  /* Grouped bars; series colours come from CSS (.bar-s0 ... .bar-ours). */
  function groupedBars(host, groups, methods, values, opt) {
    const W = 760, H = 300, m = { l: 44, r: 8, t: 12, b: 50 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = opt.max;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", "aria-label": opt.aria });
    for (const t of opt.ticks) {
      const y = m.t + ih - (t / max) * ih;
      s.append(svg("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "chart-grid" }));
      const lab = svg("text", { x: m.l - 8, y: y + 4, class: "chart-tick", "text-anchor": "end" });
      lab.textContent = t;
      s.append(lab);
    }
    const gw = iw / groups.length, pad = gw * 0.16, bw = (gw - 2 * pad) / methods.length;
    groups.forEach((g, gi) => {
      const x0 = m.l + gi * gw + pad;
      methods.forEach((name, mi) => {
        const v = values[mi][gi];
        const x = x0 + mi * bw;
        const cls = isOurs(name) ? "bar bar-ours" : `bar bar-s${mi}`;
        if (v == null) {
          const t = svg("text", { x: x + bw / 2, y: m.t + ih - 6, class: "chart-na", "text-anchor": "middle" });
          t.textContent = "n/a";
          s.append(t);
          return;
        }
        const bh = (Math.min(v, max) / max) * ih;
        const r = svg("rect", { x: x + 1.5, y: m.t + ih - bh, width: Math.max(bw - 3, 1), height: bh, rx: 2.5, class: cls });
        const title = svg("title");
        title.textContent = `${name} · ${g.name}: ${v}${opt.unit}`;
        r.append(title);
        s.append(r);
        if (isOurs(name) || opt.labelAll) {
          const t = svg("text", { x: x + bw / 2, y: m.t + ih - bh - 6, class: isOurs(name) ? "chart-val chart-val-ours" : "chart-val", "text-anchor": "middle" });
          t.textContent = v;
          s.append(t);
        }
      });
      const lab = svg("text", { x: m.l + gi * gw + gw / 2, y: H - m.b + 22, class: "chart-group", "text-anchor": "middle" });
      lab.textContent = g.name;
      const sub = svg("text", { x: m.l + gi * gw + gw / 2, y: H - m.b + 40, class: "chart-sub", "text-anchor": "middle" });
      sub.textContent = g.dof + " DoF";
      s.append(lab, sub);
    });
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: "chart-axis" }));
    host.replaceChildren(s);
  }

  function legend(methods) {
    return h("div", { class: "chart-legend" }, methods.map((name, i) =>
      h("span", { class: "chart-key" }, h("i", { class: isOurs(name) ? "bar-ours" : `bar-s${i}` }), name)));
  }

  function transferChart(host, R) {
    const T = R.transfer;
    const modes = [
      { key: "success", label: "Success rate", unit: "%", max: 100, ticks: [0, 25, 50, 75, 100], better: "higher is better" },
      { key: "trans", label: "Translation error", unit: " cm", max: 12, ticks: [0, 3, 6, 9, 12], better: "lower is better" },
      { key: "rot", label: "Rotation error", unit: "°", max: 60, ticks: [0, 15, 30, 45, 60], better: "lower is better" },
    ];
    const plot = h("div", { class: "chart-plot" });
    const note = h("span", { class: "chart-better" });
    const tabs = h("div", { class: "seg", role: "tablist" });
    const draw = (k) => {
      const md = modes[k];
      $$("button", tabs).forEach((b, i) => b.classList.toggle("is-active", i === k));
      note.textContent = md.better;
      groupedBars(plot, T.hands, T.methods, T[md.key], { max: md.max, ticks: md.ticks, unit: md.unit, aria: md.label + " per robot hand" });
    };
    modes.forEach((md, k) => tabs.append(h("button", { type: "button", text: md.label, onclick: () => draw(k) })));
    const time = h("div", { class: "chart-time" },
      h("span", { class: "chart-time-title", text: "Minutes per trajectory" }),
      T.methods.map((name, i) => h("span", { class: "chart-time-item" + (isOurs(name) ? " is-ours" : "") },
        h("b", { text: String(T.minutes[i]) }), " " + name.replace(" (ours)", ""))));
    host.append(h("div", { class: "chart-head" }, tabs, note), legend(T.methods), plot, time, h("p", { class: "chart-note", text: T.note }));
    draw(0);
  }

  function reconTable(host, R) {
    const C = R.recon;
    const tabs = h("div", { class: "seg", role: "tablist" });
    const table = h("table", { class: "rtable" });
    const draw = (split) => {
      $$("button", tabs).forEach((b) => b.classList.toggle("is-active", b.textContent === split));
      const rows = C.splits[split];
      const best = C.metrics.map((mt, j) => {
        const col = rows.map((r) => r[j]);
        return mt.better === "up" ? Math.max(...col) : Math.min(...col);
      });
      table.replaceChildren(
        h("thead", {}, h("tr", {}, h("th", { text: "Method" }),
          C.metrics.map((mt) => h("th", {}, mt.label, h("small", { text: (mt.unit ? mt.unit + " " : "") + (mt.better === "up" ? "↑" : "↓") }))))),
        h("tbody", {}, C.methods.map((name, i) => h("tr", { class: isOurs(name) ? "is-ours" : null },
          h("th", { scope: "row", text: name }),
          C.metrics.map((mt, j) => h("td", { class: rows[i][j] === best[j] ? "is-best" : null, text: fmt(rows[i][j], mt.digits) }))))));
    };
    Object.keys(C.splits).forEach((k) => tabs.append(h("button", { type: "button", text: k, onclick: () => draw(k) })));
    host.append(h("div", { class: "chart-head" }, tabs, h("span", { class: "chart-better", text: "best in bold" })),
      h("div", { class: "rtable-wrap" }, table), h("p", { class: "chart-note", text: C.note }));
    draw("Overall");
  }

  function e2eBars(host, R) {
    const E = R.e2e;
    const grid = h("div", { class: "e2e" });
    for (const mt of E.metrics) {
      grid.append(h("div", { class: "e2e-metric" },
        h("div", { class: "e2e-title" }, h("span", { text: mt.label }), h("small", { text: mt.better === "up" ? "higher is better" : "lower is better" })),
        E.methods.map((name, i) => h("div", { class: "e2e-row" + (isOurs(name) ? " is-ours" : "") },
          h("span", { class: "e2e-name", text: name }),
          h("span", { class: "e2e-track" }, h("i", { style: `width:${(100 * mt.values[i]) / mt.max}%` })),
          h("span", { class: "e2e-val", text: mt.values[i] + (mt.unit === "cm" ? " cm" : mt.unit) })))));
    }
    host.append(grid, h("p", { class: "chart-note", text: E.note }));
  }

  /* ---------- modern page: scroll-linked stage stepper ---------- */

  function initSteps() {
    const steps = $$("[data-step]");
    if (!steps.length) return;
    const figs = $$("[data-step-figure]");
    const set = (k) => {
      steps.forEach((s) => s.classList.toggle("is-active", s.dataset.step === k));
      figs.forEach((f) => f.classList.toggle("is-active", f.dataset.stepFigure === k));
    };
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) set(e.target.dataset.step);
    }, { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach((s) => io.observe(s));
    set(steps[0].dataset.step);
  }

  /* ---------- boot ---------- */

  function initReveal() {
    const els = $$("[data-reveal]");
    if (reduceMotion) { els.forEach((e) => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  }

  function boot() {
    initReveal();
    initLinks();
    initCopy();
    initAutoVideos();
    initSteps();
    const R = window.OMNIHOI_RESULTS;
    const theme = document.documentElement.dataset.viewerTheme || "light";
    for (const el of $$("[data-pair-player]")) {
      const url = el.dataset.pairPlayer, base = url.slice(0, url.lastIndexOf("/") + 1);
      fetchJSON(url).then((clips) => new PairPlayer(el, clips, base));
    }
    for (const el of $$("[data-swap-cards]")) {
      const url = el.dataset.swapCards, base = url.slice(0, url.lastIndexOf("/") + 1);
      fetchJSON(url).then((clips) => swapCards(el, clips, base));
    }
    for (const el of $$("[data-recon], [data-retarget]")) {
      whenNear(el, () => {
        const url = el.dataset.recon || el.dataset.retarget, base = url.slice(0, url.lastIndexOf("/") + 1);
        fetchJSON(url).then((idx) => (el.dataset.recon ? reconCompare(el, idx.recon, base, theme) : retargetExplorer(el, idx.retarget, base, theme)));
      });
    }
    for (const el of $$("[data-transfer-videos]")) {
      whenNear(el, () => {
        const url = el.dataset.transferVideos, base = url.slice(0, url.lastIndexOf("/") + 1);
        fetchJSON(url).then((data) => transferVideos(el, data, base)).catch((err) => {
          el.textContent = "Could not load the physics replay videos.";
          console.error(err);
        });
      });
    }
    for (const el of $$("[data-chart]")) {
      ({ transfer: transferChart, recon: reconTable, e2e: e2eBars })[el.dataset.chart](el, R);
    }
    const nav = $("[data-nav]");
    if (nav) {
      const hero = $(nav.dataset.nav);
      new IntersectionObserver((es) => nav.classList.toggle("is-solid", !es[0].isIntersecting), { rootMargin: "-64px 0px 0px 0px" }).observe(hero);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
