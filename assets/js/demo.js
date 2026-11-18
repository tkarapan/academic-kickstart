// Thought–brain demo. Runs entirely in the browser:
//   16 answers -> small neural network -> weights of 5 brain gradients -> brain pattern
//   -> correlation with NeuroQuery word maps (precomputed per gradient) -> words.
(function () {
  "use strict";

  const root = document.querySelector(".demo");
  if (!root) return;

  // ---------------------------------------------------------------- content
  const QUESTIONS = [
    "I was absorbed in the contents of my thoughts",
    "My thoughts involved other people",
    "I was thinking about solutions to problems (or goals)",
    "My thoughts involved words",
    "My thoughts involved sounds",
    "My thoughts involved images",
    "My thoughts involved past events",
    "My thoughts were distracting me from what I was doing",
    "My thoughts were focused on an external task or activity",
    "My thoughts were intrusive",
    "My thoughts were deliberate",
    "My thoughts were detailed and specific",
    "My thoughts involved future events",
    "The emotion of my thoughts was",
    "My thoughts involved myself",
    "My thoughts contained information I already knew (e.g., knowledge or memories)",
  ];
  const EMOTION = 13; // 1 = negative, 10 = positive
  // Example moments (illustrative answers, same order as QUESTIONS).
  // Example moments: plausible answers for each moment, chosen so the
  // resulting words are easy to interpret (same order as QUESTIONS).
  const PRESETS = {
    "Daydreaming on the bus": [10, 4, 2, 5, 5, 10, 7, 8, 3, 3, 2, 6, 5, 9, 6, 5],
    "Reading a book": [10, 5, 2, 10, 2, 8, 3, 1, 7, 3, 8, 6, 4, 8, 3, 6],
    "Doing a maths test": [9, 2, 8, 3, 3, 4, 2, 3, 10, 1, 8, 7, 4, 7, 3, 10],
    "Planning your day": [6, 7, 7, 4, 2, 5, 2, 3, 6, 2, 10, 9, 10, 5, 7, 6],
  };
  const DEFAULT = Object.values(PRESETS)[0]; // start on the first example moment
  const N_WORDS = 10, N_WORDS_PINNED = 6, MAX_SOFTENED = 2, MIN_R = 0.05;

  // Colour scale (display value -1..1 -> rgb), percentile and gamma used to make the map vivid.
  const STOPS = [[-1, [8, 40, 150]], [-0.6, [25, 100, 230]], [-0.25, [120, 175, 245]], [0, [226, 226, 230]],
    [0.25, [252, 180, 120]], [0.6, [245, 85, 25]], [1, [185, 5, 30]]];
  const PCT = 0.98, GAMMA = 0.6;
  const LIGHTING = { ambient: 0.6, diffuse: 0.65, specular: 0.12, roughness: 0.6, fresnel: 0,
    vertexnormalsepsilon: 0, facenormalsepsilon: 0 };
  const CAMERA = { eye: { x: -1.6, y: 0, z: 0.1 }, up: { x: 0, y: 0, z: 1 } };
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- analytics (only if the visitor accepted cookies)
  function track(name, params) {
    try {
      if (window.analyticsLoaded && typeof window.gtag === "function") window.gtag("event", name, params || {});
    } catch (e) { /* never break the demo */ }
  }

  // ---------------------------------------------------------------- data
  const base = root.dataset.base;
  const el = (sel, ctx) => (ctx || root).querySelector(sel);
  const nowPanel = el(".demo-panel-now"), pinPanel = el(".demo-panel-pin");
  const state = { answers: DEFAULT.slice(), pinned: null, data: null, shown: null };

  async function load() {
    const get = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(f); return r; });
    const man = await (await get("manifest.json")).json();
    const [v, f, g, terms, model] = await Promise.all([
      get(man.files.vertices).then((r) => r.arrayBuffer()),
      get(man.files.faces).then((r) => r.arrayBuffer()),
      get(man.files.gradients).then((r) => r.arrayBuffer()),
      get(man.files.terms).then((r) => r.json()),
      get(man.files.model).then((r) => r.json()),
    ]);
    const nV = man.n_vertices, nG = man.n_gradients;
    const vi = new Int16Array(v), x = new Float32Array(nV), y = new Float32Array(nV), z = new Float32Array(nV);
    for (let k = 0; k < nV; k++) { x[k] = vi[3 * k] / man.vertex_scale; y[k] = vi[3 * k + 1] / man.vertex_scale; z[k] = vi[3 * k + 2] / man.vertex_scale; }
    const fi = new Uint16Array(f), nF = man.n_faces;
    const I = new Int32Array(nF), J = new Int32Array(nF), K = new Int32Array(nF);
    for (let k = 0; k < nF; k++) { I[k] = fi[3 * k]; J[k] = fi[3 * k + 1]; K[k] = fi[3 * k + 2]; }
    const gi = new Int16Array(g), grads = new Float32Array(nV * nG), cortex = new Uint8Array(nV);
    for (let k = 0; k < nV * nG; k++) grads[k] = gi[k] / man.gradient_scale;
    let nC = 0;
    for (let k = 0; k < nV; k++) { for (let j = 0; j < nG; j++) if (gi[k * nG + j] !== 0) { cortex[k] = 1; nC++; break; } }
    return { nV, nG, nC, x, y, z, I, J, K, grads, cortex, terms, model };
  }

  // ---------------------------------------------------------------- model + maths
  function predict(model, answers) {
    let h = answers.map((a) => (a - model.input_center) / model.input_scale);
    model.layers.forEach((L, li) => {
      const out = L.b.slice();
      for (let i = 0; i < h.length; i++) { const hi = h[i], Wi = L.W[i]; for (let j = 0; j < out.length; j++) out[j] += hi * Wi[j]; }
      h = li < model.layers.length - 1 ? out.map((o) => (o > 0 ? o : 0)) : out;
    });
    return h; // 5 gradient weights
  }

  function displayValues(d, w) {
    const m = new Float32Array(d.nV), abs = new Float32Array(d.nC);
    for (let k = 0, c = 0; k < d.nV; k++) {
      if (!d.cortex[k]) continue;
      let s = 0;
      for (let j = 0; j < d.nG; j++) s += d.grads[k * d.nG + j] * w[j];
      m[k] = s / d.nG;
      abs[c++] = Math.abs(m[k]);
    }
    abs.sort();
    const lim = abs[Math.floor(PCT * (abs.length - 1))] || 1;
    for (let k = 0; k < d.nV; k++) {
      const t = Math.max(-1, Math.min(1, m[k] / lim));
      m[k] = Math.sign(t) * Math.pow(Math.abs(t), GAMMA);
    }
    return m;
  }

  function colour(x) {
    let i = 1;
    while (i < STOPS.length - 1 && x > STOPS[i][0]) i++;
    const [x0, c0] = STOPS[i - 1], [x1, c1] = STOPS[i];
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    return "rgb(" + Math.round(c0[0] + (c1[0] - c0[0]) * t) + "," + Math.round(c0[1] + (c1[1] - c0[1]) * t) + "," + Math.round(c0[2] + (c1[2] - c0[2]) * t) + ")";
  }
  const colours = (vals) => Array.from(vals, colour);
  // Same colours as colour(), as 0..1 floats (rounded to whole 0..255 steps like the strings).
  function colourRGB(x, out, o) {
    let i = 1;
    while (i < STOPS.length - 1 && x > STOPS[i][0]) i++;
    const [x0, c0] = STOPS[i - 1], [x1, c1] = STOPS[i];
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(c0[c] + (c1[c] - c0[c]) * t) / 255;
  }

  // Recolouring through Plotly rebuilds the whole 65,000-triangle mesh (~100 ms).
  // Instead, write the new colours straight into the existing GPU colour buffer
  // (a few ms); Plotly's stored colours are synced once a change has finished, so
  // a later resize redraws the same thing. Falls back to Plotly if anything differs.
  function paint(div, vals) {
    const d = state.data;
    try {
      const scene = div._fullLayout.scene._scene, mesh = scene.glplot.objects[0];
      if (!mesh || !mesh.triangleColors || mesh.triangleCount !== d.I.length) throw new Error("mesh");
      let rgb = div.__rgb, buf = div.__buf;
      if (!rgb || rgb.length !== d.nV * 3) rgb = div.__rgb = new Float32Array(d.nV * 3);
      if (!buf || buf.length !== d.I.length * 12) buf = div.__buf = new Float32Array(d.I.length * 12);
      for (let k = 0; k < d.nV; k++) colourRGB(vals[k], rgb, 3 * k);
      // The mesh stores each triangle's corners in reverse order (k, j, i), as RGBA.
      const put = (v, o) => { buf[o] = rgb[v]; buf[o + 1] = rgb[v + 1]; buf[o + 2] = rgb[v + 2]; buf[o + 3] = 1; };
      for (let t = 0, o = 0; t < d.I.length; t++, o += 12) {
        put(3 * d.K[t], o); put(3 * d.J[t], o + 4); put(3 * d.I[t], o + 8);
      }
      mesh.triangleColors.update(buf);
      scene.glplot.redraw();
      div.__pending = vals;
    } catch (e) {
      window.Plotly.restyle(div, { vertexcolor: [colours(vals)] }, [0]);
      div.__pending = null;
    }
  }
  function syncStored(div) { // keep Plotly's own copy in line with what is shown
    if (!div.__pending) return;
    const cols = colours(div.__pending);
    div.__pending = null;
    if (div.data && div.data[0]) div.data[0].vertexcolor = cols;
    if (div._fullData && div._fullData[0]) div._fullData[0].vertexcolor = cols;
  }

  // Exact correlation of the brain map with each word map: r = (w.c) / (sqrt(w'Sw) * sd)
  function topWords(T, w, n) {
    let wSw = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) wSw += w[i] * T.S[i][j] * w[j];
    const denom = Math.sqrt(wSw) || 1;
    const r = T.c.map((c, k) => (c[0] * w[0] + c[1] * w[1] + c[2] * w[2] + c[3] * w[3] + c[4] * w[4]) / (denom * T.sd[k]));
    const order = r.map((_, k) => k);
    const pick = (sign) => {
      const seen = new Set(), out = []; let soft = 0;
      order.slice().sort((a, b) => sign * (r[b] - r[a])).some((k) => {
        if (sign * r[k] < MIN_R || out.length === n) return true;
        const lab = T.labels[k];
        if (seen.has(lab)) return false;
        if (T.groups[k] === "softened") { if (soft >= MAX_SOFTENED) return false; soft++; }
        seen.add(lab); out.push([lab, r[k]]);
        return false;
      });
      return out;
    };
    return [pick(1), pick(-1)];
  }

  // ---------------------------------------------------------------- rendering
  function newPlot(div, vals) {
    const d = state.data;
    return window.Plotly.newPlot(div, [{
      type: "mesh3d", x: d.x, y: d.y, z: d.z, i: d.I, j: d.J, k: d.K, vertexcolor: colours(vals),
      hoverinfo: "skip", lighting: LIGHTING, lightposition: { x: -1e5, y: 1e4, z: 1e5 },
    }], {
      margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)",
      scene: { xaxis: { visible: false }, yaxis: { visible: false }, zaxis: { visible: false },
        aspectmode: "data", camera: CAMERA, bgcolor: "rgba(0,0,0,0)" },
    }, { displayModeBar: false, responsive: true });
  }

  function renderWords(div, words, scale) {
    const [pos, neg] = words;
    div.textContent = "";
    // Sizes spread across the full range within each colour: the closest red and
    // the closest blue match are largest, the weakest smallest ("bigger = closer match").
    const range = (list) => { const a = list.map(([, r]) => Math.abs(r)); return [Math.min(...a), Math.max(...a)]; };
    const ranges = { "w-pos": range(pos), "w-neg": range(neg) };
    [...pos.map((p) => [p, "w-pos"]), ...neg.map((p) => [p, "w-neg"])].forEach(([[label, r], cls], k) => {
      const [lo, hi] = ranges[cls];
      const s = document.createElement("span");
      s.className = "demo-word " + cls;
      s.textContent = label;
      s.title = "match r = " + (r >= 0 ? "+" : "") + r.toFixed(2);
      const t = hi > lo ? (Math.abs(r) - lo) / (hi - lo) : 0.5;
      s.style.fontSize = (scale * (12 + 34 * Math.pow(t, 1.4))).toFixed(0) + "px";
      s.style.animationDelay = 40 * k + "ms";
      div.appendChild(s);
    });
  }

  let morphTimer = null;
  function morphTo(target) {
    const div = el(".demo-plot", nowPanel);
    const start = state.shown;
    state.shown = target;
    if (morphTimer) cancelAnimationFrame(morphTimer);
    if (!start || REDUCED_MOTION) { paint(div, target); syncStored(div); return; }
    const DUR = 500, t0 = performance.now();
    const cur = new Float32Array(target.length);
    const tick = () => {
      const a = Math.min(1, (performance.now() - t0) / DUR);
      const e = a < 0.5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2) / 2;
      for (let k = 0; k < target.length; k++) cur[k] = start[k] + (target[k] - start[k]) * e;
      paint(div, a < 1 ? cur : target);
      if (a < 1) morphTimer = requestAnimationFrame(tick); else { morphTimer = null; syncStored(div); }
    };
    tick();
  }

  function momentName(a) {
    for (const [name, vals] of Object.entries(PRESETS)) if (vals.every((v, k) => v === a[k])) return name;
    return "Your own answers";
  }

  function update() {
    const d = state.data;
    const w = predict(d.model, state.answers);
    morphTo(displayValues(d, w));
    const pinned = !!state.pinned;
    renderWords(el(".demo-words", nowPanel), topWords(d.terms, w, pinned ? N_WORDS_PINNED : N_WORDS), pinned ? 0.8 : 1);
    const name = momentName(state.answers);
    el(".demo-panel-title", nowPanel).textContent = "Now: " + name;
    root.querySelectorAll(".demo-preset").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === name)));
  }

  let pending = false;
  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; update(); });
  }

  // ---------------------------------------------------------------- controls
  function buildControls() {
    const presets = el(".demo-presets");
    Object.keys(PRESETS).forEach((name) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "demo-preset"; b.textContent = name; b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        setAnswers(PRESETS[name]); update();
        track("demo_moment", { moment: name });
      });
      presets.appendChild(b);
    });

    const box = el(".demo-questions");
    QUESTIONS.forEach((q, k) => {
      const [lo, hi] = k === EMOTION ? ["Negative", "Positive"] : ["Not at all", "Completely"];
      const wrap = document.createElement("div");
      wrap.className = "demo-q";
      wrap.innerHTML = '<label for="demo-q' + k + '"></label><input type="range" id="demo-q' + k + '" min="1" max="10" step="1" value="5">' +
        '<div class="demo-q-ends" aria-hidden="true"><span></span><span></span></div>';
      wrap.querySelector("label").textContent = q;
      const ends = wrap.querySelectorAll(".demo-q-ends span");
      ends[0].textContent = lo; ends[1].textContent = hi;
      const input = wrap.querySelector("input");
      input.setAttribute("aria-valuetext", "5 out of 10");
      input.addEventListener("input", () => {
        state.answers[k] = +input.value;
        input.setAttribute("aria-valuetext", input.value + " out of 10");
        scheduleUpdate();
        trackSliders();
      });
      box.appendChild(wrap);
    });

    el(".demo-pin").addEventListener("click", pin);
    el(".demo-unpin").addEventListener("click", unpin);
  }

  let sliderTimer = null;
  function trackSliders() { // one anonymous event per burst of slider use (no values are sent)
    clearTimeout(sliderTimer);
    sliderTimer = setTimeout(() => track("demo_sliders", {}), 3000);
  }

  function setAnswers(vals) {
    state.answers = vals.slice();
    root.querySelectorAll(".demo-q input").forEach((inp, k) => {
      inp.value = vals[k]; inp.setAttribute("aria-valuetext", vals[k] + " out of 10");
    });
  }

  function pin() {
    const d = state.data;
    const w = predict(d.model, state.answers);
    state.pinned = state.answers.slice();
    pinPanel.hidden = false;
    el(".demo-panels").classList.add("is-pinned");
    el(".demo-panel-title", pinPanel).textContent = "Pinned: " + momentName(state.answers);
    newPlot(el(".demo-plot", pinPanel), displayValues(d, w));
    renderWords(el(".demo-words", pinPanel), topWords(d.terms, w, N_WORDS_PINNED), 0.8);
    window.Plotly.Plots.resize(el(".demo-plot", nowPanel));
    update();
    track("demo_pin", { moment: momentName(state.answers) });
  }

  function unpin() {
    state.pinned = null;
    window.Plotly.purge(el(".demo-plot", pinPanel));
    pinPanel.hidden = true;
    el(".demo-panels").classList.remove("is-pinned");
    window.Plotly.Plots.resize(el(".demo-plot", nowPanel));
    update();
  }

  // ---------------------------------------------------------------- idle rotation
  function idleRotation() {
    if (REDUCED_MOTION) return;
    const SPEED = 0.3;      // radians per second at full speed (about 21 s per turn)
    const IDLE_MS = 6000;   // wait after any interaction with the demo before rotating
    const EASE_MS = 2500;   // then ease in gently
    let visible = true, hold = false, lastActive = performance.now(), last = 0;
    const touch = () => { lastActive = performance.now(); };
    ["pointerdown", "pointermove", "wheel", "keydown", "input", "touchstart", "touchmove"].forEach((ev) =>
      root.addEventListener(ev, touch, { passive: true }));
    [nowPanel, pinPanel].forEach((panel) => {
      panel.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hold = true; touch(); } });
      panel.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hold = false; touch(); } });
    });
    if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(nowPanel);
    // The live camera (what is on screen, including any dragging), not Plotly's stored layout.
    const cameraOf = (p) => {
      try { return p._fullLayout.scene._scene.getCamera(); } catch (e) { return p._fullLayout.scene.camera; }
    };
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = last ? Math.min(250, now - last) : 0; // capped so a hidden or stalled tab does not jump
      if (now - last < 33) return; // ~30 updates a second is smooth enough and cheap
      last = now;
      const idle = now - lastActive - IDLE_MS;
      if (hold || idle <= 0 || !visible || document.hidden || morphTimer) return;
      const ease = Math.min(1, idle / EASE_MS);
      const step = (SPEED * dt / 1000) * ease * ease;
      [...root.querySelectorAll(".demo-plot")].filter((p) => p._fullLayout && p.offsetParent).forEach((p) => {
        const eye = cameraOf(p).eye;
        const theta = Math.atan2(eye.y, eye.x) + step;
        const r = Math.hypot(eye.x, eye.y) || 1.6;
        window.Plotly.relayout(p, { "scene.camera.eye": { x: r * Math.cos(theta), y: r * Math.sin(theta), z: eye.z } });
      });
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start
  function whenPlotly() {
    return new Promise((resolve, reject) => {
      let n = 0;
      (function check() { if (window.Plotly) resolve(); else if (n++ > 200) reject(new Error("plotly")); else setTimeout(check, 50); })();
    });
  }

  buildControls();
  setAnswers(DEFAULT);
  Promise.all([load(), whenPlotly()]).then(([d]) => {
    state.data = d;
    const w = predict(d.model, state.answers);
    state.shown = displayValues(d, w);
    return newPlot(el(".demo-plot", nowPanel), state.shown);
  }).then(() => {
    update();
    el(".demo-pin").disabled = false;
    idleRotation();
    track("demo_ready", {});
  }).catch(() => {
    el(".demo-panel-title", nowPanel).textContent = "Sorry, the demo could not load. Please refresh the page.";
  });
})();
