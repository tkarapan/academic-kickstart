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
  const PRESETS = {
    "Daydreaming on the bus": [8, 4, 2, 3, 2, 8, 6, 6, 1, 3, 2, 4, 6, 7, 7, 5],
    "Doing a maths test": [8, 1, 10, 3, 1, 3, 1, 2, 10, 2, 10, 9, 2, 5, 2, 8],
    "Chatting with a friend": [7, 10, 3, 9, 7, 4, 5, 2, 8, 1, 6, 6, 4, 8, 5, 6],
    "Worrying about tomorrow": [9, 5, 6, 6, 2, 5, 3, 9, 2, 9, 2, 6, 10, 2, 9, 4],
    "Remembering a holiday": [8, 6, 1, 3, 5, 10, 10, 4, 1, 2, 6, 8, 1, 9, 7, 9],
    "Listening to music": [7, 2, 1, 4, 10, 6, 4, 3, 7, 1, 4, 5, 2, 8, 4, 6],
  };
  const DEFAULT = new Array(16).fill(5);
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
    [...pos.map((p) => [p, "w-pos"]), ...neg.map((p) => [p, "w-neg"])].forEach(([[label, r], cls], k) => {
      const s = document.createElement("span");
      s.className = "demo-word " + cls;
      s.textContent = label;
      s.title = "match r = " + (r >= 0 ? "+" : "") + r.toFixed(2);
      s.style.fontSize = (scale * (13 + 27 * Math.min(Math.abs(r), 0.7) / 0.7)).toFixed(0) + "px";
      s.style.animationDelay = 40 * k + "ms";
      div.appendChild(s);
    });
  }

  let morphTimer = null;
  function morphTo(target) {
    const div = el(".demo-plot", nowPanel);
    const start = state.shown;
    state.shown = target;
    if (!start || REDUCED_MOTION) { window.Plotly.restyle(div, { vertexcolor: [colours(target)] }, [0]); return; }
    const DUR = 500, t0 = performance.now();
    if (morphTimer) cancelAnimationFrame(morphTimer);
    const cur = new Float32Array(target.length);
    const tick = () => {
      const a = Math.min(1, (performance.now() - t0) / DUR);
      const e = a < 0.5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2) / 2;
      for (let k = 0; k < target.length; k++) cur[k] = start[k] + (target[k] - start[k]) * e;
      window.Plotly.restyle(div, { vertexcolor: [colours(cur)] }, [0]);
      if (a < 1) morphTimer = requestAnimationFrame(tick);
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
    const IDLE_MS = 20000, STEP_MS = 100, STEP_RAD = 0.02;
    let last = Date.now(), theta = null, visible = true;
    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, () => { last = Date.now(); theta = null; }, { passive: true }));
    if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(nowPanel);
    setInterval(() => {
      if (!visible || document.hidden || Date.now() - last < IDLE_MS) return;
      const plots = [...root.querySelectorAll(".demo-plot")].filter((p) => p._fullLayout && p.offsetParent);
      if (!plots.length) return;
      const eye = plots[0]._fullLayout.scene.camera.eye;
      if (theta === null) theta = Math.atan2(eye.y, eye.x);
      theta += STEP_RAD;
      const r = Math.hypot(eye.x, eye.y) || 1.6;
      plots.forEach((p) => window.Plotly.relayout(p, { "scene.camera.eye": { x: r * Math.cos(theta), y: r * Math.sin(theta), z: eye.z } }));
    }, STEP_MS);
  }

  // ---------------------------------------------------------------- start
  function whenPlotly() {
    return new Promise((resolve, reject) => {
      let n = 0;
      (function check() { if (window.Plotly) resolve(); else if (n++ > 200) reject(new Error("plotly")); else setTimeout(check, 50); })();
    });
  }

  buildControls();
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
