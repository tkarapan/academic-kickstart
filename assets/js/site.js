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

(function cookieConsent() {
  // Analytics cookies are only set after the visitor accepts.
  const banner = document.querySelector(".consent");
  if (!banner) return;
  const KEY = "analytics-consent";
  let choice = null;
  try { choice = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }

  function clearAnalyticsCookies() {
    const host = location.hostname;
    const domains = ["", host, "." + host, "." + host.replace(/^www\./, "")];
    document.cookie.split(";").map((c) => c.split("=")[0].trim())
      .filter((name) => /^_ga|^_gid|^_gat/.test(name))
      .forEach((name) => domains.forEach((d) => {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? "; domain=" + d : ""}`;
      }));
  }

  function save(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* storage unavailable */ }
    banner.hidden = true;
    if (value === "granted" && window.loadAnalytics) window.loadAnalytics();
    if (value === "denied") clearAnalyticsCookies();
  }

  banner.querySelectorAll("[data-consent]").forEach((b) => b.addEventListener("click", () => save(b.dataset.consent)));
  document.querySelectorAll("[data-consent-open]").forEach((b) => b.addEventListener("click", () => { banner.hidden = false; }));
  if (choice !== "granted" && choice !== "denied") banner.hidden = false;
})();

(function coauthorNetwork() {
  // Radial co-author map: the site owner at the centre, collaborators around.
  // Distance from the centre shrinks with the number of joint papers; angle
  // follows the year of the first joint paper (clockwise from the top).
  const svg = document.querySelector(".network-svg");
  const source = document.getElementById("network-data");
  if (!svg || !source) return;
  const panel = document.querySelector(".network-panel");
  const NS = "http://www.w3.org/2000/svg";
  const pubs = JSON.parse(source.textContent);

  const people = new Map();
  pubs.forEach((p, i) => {
    p.a.forEach((name) => {
      if (name === "admin") return;
      if (!people.has(name)) people.set(name, { name, papers: [], first: p.y });
      const person = people.get(name);
      person.papers.push(i);
      person.first = Math.min(person.first, p.y);
    });
  });
  // Order by year of first collaboration. Within a year, spread frequent
  // collaborators apart (van der Corput order) so their labels do not collide.
  const byYear = new Map();
  [...people.values()].forEach((p) => { if (!byYear.has(p.first)) byYear.set(p.first, []); byYear.get(p.first).push(p); });
  const spread = (m) => {
    const order = [];
    for (let k = 0; order.length < m; k++) {
      let x = 0, f = 0.5, i = k;
      while (i) { if (i & 1) x += f; i >>= 1; f /= 2; }
      const slot = Math.floor(x * m);
      if (!order.includes(slot)) order.push(slot);
    }
    return order;
  };
  const list = [];
  [...byYear.keys()].sort((a, b) => a - b).forEach((year) => {
    const group = byYear.get(year).sort((a, b) => b.papers.length - a.papers.length || a.name.localeCompare(b.name));
    const slots = new Array(group.length);
    spread(group.length).forEach((slot, k) => { slots[slot] = group[k]; });
    list.push(...slots);
  });
  const max = Math.max(...list.map((p) => p.papers.length));
  const R = 430, inner = 120;

  list.forEach((p, i) => {
    const n = p.papers.length;
    p.angle = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    const closeness = Math.log(n) / Math.log(max); // 0 for one paper, 1 for the most
    p.radius = inner + (R - inner) * (1 - closeness) * (n === 1 ? 1 : 0.92) - (n === 1 ? (i % 3) * 14 : 0);
    p.x = Math.cos(p.angle) * p.radius;
    p.y = Math.sin(p.angle) * p.radius;
    p.size = 3 + Math.sqrt(n) * 2.1;
  });

  const el = (tag, attrs, parent) => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  };

  // Year markers around the edge, at the first collaborator of each year.
  const years = el("g", { class: "net-years" }, svg);
  let lastYear = null;
  list.forEach((p) => {
    if (p.first === lastYear) return;
    lastYear = p.first;
    const x1 = Math.cos(p.angle) * (R + 22), y1 = Math.sin(p.angle) * (R + 22);
    const x2 = Math.cos(p.angle) * (R + 34), y2 = Math.sin(p.angle) * (R + 34);
    el("line", { x1, y1, x2, y2 }, years);
    const t = el("text", { x: Math.cos(p.angle) * (R + 52), y: Math.sin(p.angle) * (R + 52), "text-anchor": "middle", "dominant-baseline": "middle" }, years);
    t.textContent = p.first;
  });
  el("circle", { cx: 0, cy: 0, r: R + 22, class: "net-orbit" }, svg);

  const links = el("g", { class: "net-links" }, svg);
  const extra = el("g", { class: "net-extra" }, svg);
  const spokes = el("g", { class: "net-spokes" }, svg);
  const nodes = el("g", { class: "net-nodes" }, svg);
  const labels = el("g", { class: "net-labels" }, svg);

  list.forEach((p) => {
    const n = p.papers.length;
    p.spoke = el("line", { x1: 0, y1: 0, x2: p.x, y2: p.y, "stroke-width": 0.6 + Math.log2(n) * 0.9, "stroke-opacity": Math.min(0.85, 0.16 + n / max) }, spokes);
    const g = el("g", { class: "net-node", tabindex: 0, role: "button", "aria-label": `${p.name}, ${n} joint paper${n > 1 ? "s" : ""}` }, nodes);
    el("circle", { cx: p.x, cy: p.y, r: p.size + 6, class: "net-hit" }, g);
    p.dot = el("circle", { cx: p.x, cy: p.y, r: p.size }, g);
    p.group = g;
    if (n >= 4) {
      const deg = (p.angle * 180) / Math.PI;
      const flip = deg > 90 && deg < 270;
      const off = p.size + 6;
      const t = el("text", {
        x: p.x + Math.cos(p.angle) * off, y: p.y + Math.sin(p.angle) * off,
        transform: `rotate(${flip ? deg - 180 : deg} ${p.x + Math.cos(p.angle) * off} ${p.y + Math.sin(p.angle) * off})`,
        "text-anchor": flip ? "end" : "start", "dominant-baseline": "middle",
      }, labels);
      t.textContent = p.name.replace(/\s[A-Z]\s/, " ");
      p.label = t;
    }
    g.addEventListener("mouseenter", () => select(p, false));
    g.addEventListener("focus", () => select(p, false));
    g.addEventListener("click", () => select(p, true));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p, true); } });
  });

  // Centre: portrait.
  const clip = el("clipPath", { id: "net-centre-clip" }, el("defs", {}, svg));
  el("circle", { cx: 0, cy: 0, r: 46 }, clip);
  el("circle", { cx: 0, cy: 0, r: 52, class: "net-centre-ring" }, svg);
  el("image", { href: svg.dataset.centre, x: -46, y: -46, width: 92, height: 92, "clip-path": "url(#net-centre-clip)", preserveAspectRatio: "xMidYMid slice" }, svg);

  let locked = null;
  function select(p, lock) {
    if (locked && !lock) return;
    if (lock) locked = locked === p ? null : p;
    const active = lock ? locked : p;
    svg.classList.toggle("has-active", !!active);
    list.forEach((q) => {
      const on = active && (q === active);
      q.group.classList.toggle("is-active", !!on);
      q.spoke.classList.toggle("is-active", !!on);
      if (q.label) q.label.classList.toggle("is-active", !!on);
    });
    extra.replaceChildren();
    list.forEach((q) => q.group.classList.remove("is-related"));
    if (!active) { panel.innerHTML = '<p class="network-hint">Select a collaborator to see our joint papers.</p>'; return; }
    // Faint links to others on the same papers.
    const shared = new Set();
    active.papers.forEach((i) => pubs[i].a.forEach((name) => { if (name !== "admin" && name !== active.name) shared.add(name); }));
    shared.forEach((name) => {
      const q = people.get(name);
      el("line", { x1: active.x, y1: active.y, x2: q.x, y2: q.y }, extra);
      q.group.classList.add("is-related");
    });
    const n = active.papers.length;
    const items = active.papers.slice().sort((a, b) => pubs[b].y - pubs[a].y)
      .map((i) => `<li><a href="${pubs[i].u}">${escapeHtml(pubs[i].t)}</a> <span>${pubs[i].y}</span></li>`).join("");
    panel.innerHTML = `<h3>${escapeHtml(active.name)}</h3><p class="network-meta">${n} joint paper${n > 1 ? "s" : ""} · since ${active.first}</p><ul>${items}</ul>`;
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  svg.addEventListener("mouseleave", () => { if (!locked) select(null, false); });
  svg.addEventListener("click", (e) => { if (e.target === svg && locked) { locked = null; select(null, false); } });
})();
