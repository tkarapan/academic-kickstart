// Site behaviour: theme toggle, publication filtering and the hero animation.
// Everything here is progressive enhancement; the site works without JavaScript.

(function themeToggle() {
  const button = document.querySelector(".theme-toggle");
  if (!button) return;
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.getAttribute("data-theme") || (systemDark.matches ? "dark" : "light");
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
  let visible = true, w = 0, h = 0, dpr = 1, wells = [], particles = [], running = false, frame = 0, colour = "13, 107, 110";

  function readColour() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--field").trim();
    if (v) colour = v;
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
    const n = Math.round(Math.min(420, Math.max(140, (w * h) / 3200)));
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

  const palette = ["94, 234, 212", "167, 139, 250"];

  function step() {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.055)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.1;
    for (let c = 0; c < palette.length; c++) {
      ctx.strokeStyle = `rgba(${palette[c]}, 0.5)`;
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
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColour(); layout(); });

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
