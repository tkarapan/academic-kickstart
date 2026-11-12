// Site behaviour: theme toggle, publication filtering and the hero animation.
// Everything here is progressive enhancement; the site works without JavaScript.

(function themeToggle() {
  const button = document.querySelector(".theme-toggle");
  if (!button) return;
  const root = document.documentElement;
  const current = () => root.getAttribute("data-theme") || "dark";
  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
    document.dispatchEvent(new CustomEvent("themechange"));
  });
})();

(function publicationFilter() {
  const panel = document.querySelector(".pub-filter");
  if (!panel) return;
  panel.hidden = false;
  const input = panel.querySelector("#pub-search");
  const buttons = panel.querySelectorAll("[data-filter]");
  const count = panel.querySelector(".filter-count");
  const items = Array.from(document.querySelectorAll(".pub"));
  const groups = Array.from(document.querySelectorAll(".pub-year-group"));
  const empty = document.querySelector(".no-results");
  let filter = "all";

  function apply() {
    const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    items.forEach((el) => {
      const text = el.dataset.search || "";
      const matchesFilter =
        filter === "all" ||
        (filter === "featured" ? el.dataset.featured === "true" : el.dataset.type === filter);
      const matchesText = terms.every((t) => text.includes(t));
      const visible = matchesFilter && matchesText;
      el.hidden = !visible;
      if (visible) shown++;
    });
    groups.forEach((g) => { g.hidden = !g.querySelector(".pub:not([hidden])"); });
    if (empty) empty.hidden = shown !== 0;
    count.textContent = shown === items.length ? "" : `Showing ${shown} of ${items.length}`;
  }

  input.addEventListener("input", apply);
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      apply();
    })
  );
})();

(function heroField() {
  // Particles drifting around two attractor basins, drawn as fading trails.
  const canvas = document.querySelector(".hero-field");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = true, w = 0, h = 0, dpr = 1, wells = [], particles = [], running = false, frame = 0;
  let palette = ["255, 184, 77", "255, 94, 98"], mode = "lighter", alpha = 0.5;

  function readColour() {
    const css = getComputedStyle(document.documentElement);
    const a = css.getPropertyValue("--c1-rgb").trim(), b = css.getPropertyValue("--c2-rgb").trim();
    if (a && b) palette = [a, b];
    mode = css.getPropertyValue("--field-mode").trim() || "lighter";
    alpha = parseFloat(css.getPropertyValue("--field-alpha")) || 0.5;
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wide = w > 900;
    const s = Math.min(w, h);
    wells = wide
      ? [{ x: w * 0.68, y: h * 0.42, r: s * 0.26, spin: 1 }, { x: w * 0.9, y: h * 0.72, r: s * 0.2, spin: -1 }, { x: w * 0.38, y: h * 0.82, r: s * 0.16, spin: 1 }]
      : [{ x: w * 0.7, y: h * 0.22, r: s * 0.3, spin: 1 }, { x: w * 0.3, y: h * 0.78, r: s * 0.26, spin: -1 }];
    const n = Math.round(Math.min(520, Math.max(180, (w * h) / 2600)));
    particles = Array.from({ length: n }, spawn);
    ctx.clearRect(0, 0, w, h);
  }

  function spawn() {
    const wl = wells[Math.floor(Math.random() * wells.length)];
    const a = Math.random() * Math.PI * 2;
    const d = wl.r * (0.5 + Math.random() * 0.9);
    return { x: wl.x + Math.cos(a) * d, y: wl.y + Math.sin(a) * d, age: Math.random() * 400, c: Math.random() < 0.55 ? 0 : 1 };
  }

  function velocity(p) {
    let vx = 0, vy = 0;
    for (const wl of wells) {
      const dx = p.x - wl.x, dy = p.y - wl.y;
      const dist = Math.hypot(dx, dy) || 1;
      const g = Math.exp(-(dist * dist) / (2 * (wl.r * 1.6) ** 2));
      const radial = -(dist - wl.r) / wl.r;
      vx += g * (wl.spin * -dy / dist * 1.2 + radial * dx / dist * 0.6);
      vy += g * (wl.spin * dx / dist * 1.2 + radial * dy / dist * 0.6);
    }
    return [vx + (Math.random() - 0.5) * 0.35, vy + (Math.random() - 0.5) * 0.35];
  }

  function step() {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.045)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = mode;
    ctx.lineWidth = 1.35;
    for (let c = 0; c < palette.length; c++) {
      ctx.strokeStyle = `rgba(${palette[c]}, ${alpha})`;
      ctx.beginPath();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.c !== c) continue;
        const [vx, vy] = velocity(p);
        const nx = p.x + vx * 1.5, ny = p.y + vy * 1.5;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        p.x = nx; p.y = ny; p.age++;
        if (p.age > 520 || nx < -20 || ny < -20 || nx > w + 20 || ny > h + 20) particles[i] = spawn();
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function loop() {
    if (!running) return;
    step();
    frame = requestAnimationFrame(loop);
  }

  function start() { if (!running && !reduced) { running = true; frame = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(frame); }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) step();
  }

  readColour();
  layout();
  if (reduced) drawStatic();

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); if (reduced) drawStatic(); }, 150);
  });
  document.addEventListener("themechange", () => { readColour(); layout(); if (reduced) drawStatic(); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      visible && !document.hidden ? start() : stop();
    }).observe(canvas);
  } else {
    start();
  }
  document.addEventListener("visibilitychange", () => (document.hidden || !visible ? stop() : start()));
})();
(function tileArt() {
  // Deterministic line drawings for publication tiles without a figure.
  // Each title seeds a smooth vector field; lines trace trajectories through it.
  const canvases = document.querySelectorAll(".tile-art canvas[data-seed]");
  if (!canvases.length) return;

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function draw(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    const styles = getComputedStyle(document.documentElement);
    const a = styles.getPropertyValue("--tile-a").trim() || "255, 79, 26";
    const b = styles.getPropertyValue("--tile-b").trim() || "18, 18, 18";
    const rand = rng(hash(canvas.dataset.seed || "paper"));

    // Field: a few random rotational centres plus a gentle drift.
    const centres = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => ({
      x: w * (0.15 + rand() * 0.7), y: h * (0.15 + rand() * 0.7),
      s: (rand() < 0.5 ? -1 : 1) * (0.6 + rand()), r: Math.min(w, h) * (0.25 + rand() * 0.35),
    }));
    const drift = rand() * Math.PI * 2;
    function field(x, y) {
      let vx = Math.cos(drift) * 0.25, vy = Math.sin(drift) * 0.25;
      for (const c of centres) {
        const dx = x - c.x, dy = y - c.y, d2 = dx * dx + dy * dy;
        const g = Math.exp(-d2 / (2 * c.r * c.r));
        vx += -dy / c.r * c.s * g; vy += dx / c.r * c.s * g;
      }
      const m = Math.hypot(vx, vy) || 1;
      return [vx / m, vy / m];
    }

    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    const lines = 70;
    for (let i = 0; i < lines; i++) {
      let x = rand() * w, y = rand() * h;
      const accent = rand() < 0.28;
      ctx.strokeStyle = accent ? `rgba(${a}, ${0.55 + rand() * 0.35})` : `rgba(${b}, ${0.12 + rand() * 0.18})`;
      ctx.lineWidth = accent ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 90; s++) {
        const [vx, vy] = field(x, y);
        x += vx * 3; y += vy * 3;
        ctx.lineTo(x, y);
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) break;
      }
      ctx.stroke();
    }
    for (const c of centres) {
      ctx.fillStyle = `rgb(${a})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${a}, 0.35)`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.stroke();
    }
  }

  const drawAll = () => canvases.forEach(draw);
  drawAll();
  let timer;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(drawAll, 150); });
  document.addEventListener("themechange", drawAll);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);
})();
