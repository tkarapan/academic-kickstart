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
  // Mobile browsers fire resize when the address bar shows or hides while
  // scrolling; only redraw when the width actually changes.
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
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
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(drawAll, 150);
  });
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
  // Radial co-author map. The site owner is at the centre. Collaborators are
  // grouped by who they publish with (Louvain community detection on the
  // co-authorship graph), each group taking its own slice of the circle and
  // colour. Distance from the centre shrinks with the number of joint papers.
  const svg = document.querySelector(".network-svg");
  const source = document.getElementById("network-data");
  if (!svg || !source) return;
  const panel = document.querySelector(".network-panel");
  const NS = "http://www.w3.org/2000/svg";
  const pubs = JSON.parse(source.textContent);

  // People and co-authorship weights (large author lists count for less).
  const people = new Map();
  const W = new Map();
  const link = (a, b, w) => {
    if (!W.has(a)) W.set(a, new Map());
    W.get(a).set(b, (W.get(a).get(b) || 0) + w);
  };
  pubs.forEach((p, i) => {
    const names = p.a.filter((n) => n !== "admin");
    names.forEach((name) => {
      if (!people.has(name)) people.set(name, { name, papers: [], first: p.y });
      const person = people.get(name);
      person.papers.push(i);
      person.first = Math.min(person.first, p.y);
      if (!W.has(name)) W.set(name, new Map());
    });
    for (let x = 0; x < names.length; x++)
      for (let y = x + 1; y < names.length; y++) {
        link(names[x], names[y], 1 / (names.length - 1));
        link(names[y], names[x], 1 / (names.length - 1));
      }
  });
  const order = [...people.values()].sort((a, b) => b.papers.length - a.papers.length || (a.name < b.name ? -1 : 1)).map((p) => p.name);

  function louvain(nodes, graph, gamma) {
    const mapping = new Map(nodes.map((n) => [n, n]));
    let level = nodes.slice();
    let G = new Map(nodes.map((n) => [n, new Map(graph.get(n))]));
    for (;;) {
      const deg = new Map(level.map((n) => [n, [...G.get(n).values()].reduce((s, w) => s + w, 0)]));
      const m2 = [...deg.values()].reduce((s, w) => s + w, 0) || 1;
      const c = new Map(level.map((n) => [n, n]));
      const tot = new Map(deg);
      let improved = true, movedAny = false;
      while (improved) {
        improved = false;
        for (const n of level) {
          const cur = c.get(n);
          tot.set(cur, tot.get(cur) - deg.get(n));
          const links = new Map();
          for (const [m, w] of G.get(n)) if (m !== n) links.set(c.get(m), (links.get(c.get(m)) || 0) + w);
          let best = cur, bestGain = (links.get(cur) || 0) - (gamma * tot.get(cur) * deg.get(n)) / m2;
          for (const cc of [...links.keys()].sort()) {
            const gain = links.get(cc) - (gamma * tot.get(cc) * deg.get(n)) / m2;
            if (gain > bestGain + 1e-12) { best = cc; bestGain = gain; }
          }
          c.set(n, best);
          tot.set(best, tot.get(best) + deg.get(n));
          if (best !== cur) { improved = true; movedAny = true; }
        }
      }
      if (!movedAny) break;
      const next = new Map();
      for (const n of level) {
        const cn = c.get(n);
        if (!next.has(cn)) next.set(cn, new Map());
        for (const [m, w] of G.get(n)) next.get(cn).set(c.get(m), (next.get(cn).get(c.get(m)) || 0) + w);
      }
      for (const [o, cur] of mapping) mapping.set(o, c.get(cur));
      level = [...new Set(c.values())].sort();
      G = new Map(level.map((n) => [n, next.get(n) || new Map()]));
    }
    return mapping;
  }

  const community = louvain(order, W, 1.5);
  const groupsMap = new Map();
  order.forEach((name) => {
    const g = community.get(name);
    if (!groupsMap.has(g)) groupsMap.set(g, []);
    groupsMap.get(g).push(people.get(name));
  });
  let groups = [...groupsMap.values()];
  const weightOf = (g) => g.reduce((s, p) => s + p.papers.length, 0);
  // Order groups so that strongly connected groups sit next to each other.
  const between = (g, h) => g.reduce((s, p) => s + h.reduce((t, q) => t + (W.get(p.name).get(q.name) || 0), 0), 0);
  groups.sort((a, b) => weightOf(b) - weightOf(a));
  const ordered = [groups.shift()];
  while (groups.length) {
    const last = ordered[ordered.length - 1];
    groups.sort((a, b) => between(last, b) - between(last, a) || weightOf(b) - weightOf(a));
    ordered.push(groups.shift());
  }
  const palette = getComputedStyle(document.documentElement).getPropertyValue("--net-groups").split(",").map((c) => c.trim()).filter(Boolean);

  // Angles: each group gets a slice proportional to its size, with gaps between.
  const total = ordered.reduce((s, g) => s + g.length, 0);
  const gap = 0.05;
  const span = Math.PI * 2 - gap * ordered.length;
  const spread = (m) => {
    const out = [];
    for (let k = 0; out.length < m; k++) {
      let x = 0, f = 0.5, i = k;
      while (i) { if (i & 1) x += f; i >>= 1; f /= 2; }
      const slot = Math.floor(x * m);
      if (!out.includes(slot)) out.push(slot);
    }
    return out;
  };
  const list = [];
  const arcs = [];
  let angle = -Math.PI / 2 + gap / 2;
  ordered.forEach((group, gi) => {
    const width = (group.length / total) * span;
    const colour = gi < palette.length && group.length > 2 ? palette[gi] : "var(--muted)";
    arcs.push({ start: angle, end: angle + width, colour });
    const sorted = group.slice().sort((a, b) => b.papers.length - a.papers.length || (a.name < b.name ? -1 : 1));
    const slots = new Array(sorted.length);
    spread(sorted.length).forEach((slot, k) => { slots[slot] = sorted[k]; });
    slots.forEach((p, k) => {
      p.angle = angle + ((k + 0.5) / sorted.length) * width;
      p.colour = colour;
      list.push(p);
    });
    angle += width + gap;
  });

  const max = Math.max(...list.map((p) => p.papers.length));
  const R = 430, inner = 120;
  list.forEach((p, i) => {
    const n = p.papers.length;
    const closeness = Math.log(n) / Math.log(max);
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

  // Group arcs around the edge.
  const arcLayer = el("g", { class: "net-arcs" }, svg);
  const arcR = R + 26;
  arcs.forEach((a) => {
    const x1 = Math.cos(a.start) * arcR, y1 = Math.sin(a.start) * arcR;
    const x2 = Math.cos(a.end) * arcR, y2 = Math.sin(a.end) * arcR;
    el("path", { d: `M ${x1} ${y1} A ${arcR} ${arcR} 0 ${a.end - a.start > Math.PI ? 1 : 0} 1 ${x2} ${y2}`, stroke: a.colour }, arcLayer);
  });

  const extra = el("g", { class: "net-extra" }, svg);
  const spokes = el("g", { class: "net-spokes" }, svg);
  const nodes = el("g", { class: "net-nodes" }, svg);

  list.forEach((p) => {
    const n = p.papers.length;
    p.spoke = el("line", { x1: 0, y1: 0, x2: p.x, y2: p.y, stroke: p.colour, "stroke-width": 0.6 + Math.log2(n) * 0.9, "stroke-opacity": Math.min(0.85, 0.18 + n / max) }, spokes);
    const g = el("g", { class: "net-node", tabindex: 0, role: "button", "aria-label": `${p.name}, ${n} joint paper${n > 1 ? "s" : ""}` }, nodes);
    el("circle", { cx: p.x, cy: p.y, r: p.size + 6, class: "net-hit" }, g);
    p.dot = el("circle", { cx: p.x, cy: p.y, r: p.size, fill: p.colour }, g);
    p.group = g;
    g.addEventListener("mouseenter", () => select(p, false));
    g.addEventListener("focus", () => select(p, false));
    g.addEventListener("click", () => select(p, true));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p, true); } });
  });

  // Name tooltip, shown for the hovered or selected person.
  const tip = el("g", { class: "net-tip", visibility: "hidden" }, svg);
  const tipBox = el("rect", { rx: 8, ry: 8 }, tip);
  const tipText = el("text", { "dominant-baseline": "middle" }, tip);
  function showTip(p) {
    if (!p) { tip.setAttribute("visibility", "hidden"); return; }
    tipText.textContent = p.name;
    const w = tipText.getComputedTextLength() + 24, h = 34;
    const right = Math.cos(p.angle) >= 0;
    // Prefer the side away from the centre, but keep the label inside the
    // drawing so it is never cut off at the screen edge.
    const limit = 515;
    let x = right ? p.x + p.size + 8 : p.x - p.size - 8 - w;
    let y = p.y - h / 2;
    if (x < -limit || x + w > limit) {
      x = Math.max(-limit, Math.min(limit - w, p.x - w / 2));
      y = p.y < 0 ? p.y + p.size + 8 : p.y - p.size - 8 - h;
    }
    y = Math.max(-limit, Math.min(limit - h, y));
    tipBox.setAttribute("x", x); tipBox.setAttribute("y", y);
    tipBox.setAttribute("width", w); tipBox.setAttribute("height", h);
    tipText.setAttribute("x", x + 12); tipText.setAttribute("y", y + h / 2 + 1);
    tip.setAttribute("visibility", "visible");
  }

  // Clickable list of all co-authors, sorted by surname.
  const listEl = document.querySelector(".network-names");
  const buttons = new Map();
  if (listEl) {
    const multi = JSON.parse(listEl.dataset.surnames || "[]");
    const split = (n) => {
      const m = multi.find((s) => n.endsWith(" " + s));
      const last = m || n.split(" ").slice(-1)[0];
      return [last, n.slice(0, n.length - last.length).trim()];
    };
    const key = (n) => split(n).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    [...people.values()].sort((a, b) => key(a.name).localeCompare(key(b.name))).forEach((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="dot" style="background:${p.colour}"></span>${escapeHtml(split(p.name)[0])}${split(p.name)[1] ? ", " + escapeHtml(split(p.name)[1]) : ""} <span class="n">${p.papers.length}</span>`;
      b.addEventListener("click", () => {
        if (locked !== p) select(p, true);
        svg.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      b.addEventListener("mouseenter", () => select(p, false));
      b.addEventListener("mouseleave", () => { if (!locked) select(null, false); });
      li.appendChild(b); listEl.appendChild(li); buttons.set(p.name, b);
    });
    const filter = document.querySelector(".network-filter");
    if (filter) {
      filter.hidden = false;
      filter.addEventListener("input", () => {
        const q = filter.value.toLowerCase().trim();
        buttons.forEach((b, name) => { b.parentElement.hidden = q && !name.toLowerCase().includes(q); });
      });
    }
  }

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
    extra.replaceChildren();
    showTip(active);
    list.forEach((q) => {
      const on = !!active && q === active;
      q.group.classList.toggle("is-active", on);
      q.group.classList.remove("is-related");
      q.spoke.classList.toggle("is-active", on);
      const b = buttons.get(q.name);
      if (b) b.classList.toggle("is-active", on);
    });
    if (!active) { panel.innerHTML = '<p class="network-hint">Select a collaborator to see our joint papers.</p>'; return; }
    const shared = new Set();
    active.papers.forEach((i) => pubs[i].a.forEach((name) => { if (name !== "admin" && name !== active.name) shared.add(name); }));
    shared.forEach((name) => {
      const q = people.get(name);
      el("line", { x1: active.x, y1: active.y, x2: q.x, y2: q.y, stroke: active.colour }, extra);
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
