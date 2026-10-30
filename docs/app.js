(() => {
  "use strict";
  const SC = window.SCENE, META = window.DIGITAL_META || { x0: 6285, gap: 1500, counts: {} };
  const W = SC.W, H = SC.H, X0 = META.x0, WW = X0 + W, GAP = META.gap;
  const HF = H * 1.08; // framed height: the shelf plus a strip of floor
  const ZONES = [
    { x: 0, no: "01", name: "Analog", sub: "" },
    { x: X0, no: "02", name: "Digital", sub: "" },
  ];
  const SVGNS = "http://www.w3.org/2000/svg";
  const physical = (window.BOOKS || []).map((b) => Object.assign(b, { zone: 0 }));
  const digital = (window.DIGITAL || []).map((b) => Object.assign(b, { zone: 1, conf: "high" }));
  const books = physical.concat(digital).map((b, i) => Object.assign(b, geom(b.poly), { i }));
  const byId = new Map(books.map((b) => [b.id, b]));
  for (const d of digital) if (d.twin && byId.has(d.twin)) byId.get(d.twin).twin = d.id;

  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), world = $("world"), shelf = $("shelf");
  const hits = $("hits"), matchesG = $("matches");
  const card = $("card"), leader = $("leader"), leaderLine = $("leaderLine");
  const anchorDot = $("anchorDot"), anchorRing = $("anchorRing");

  const view = { s: 0.2, tx: 0, ty: 0 };
  let minS = 0.05, maxS = 4;
  let active = -1, pinned = false, hideT = 0, anim = 0, zone = -1, photo = false;
  const isTouch = matchMedia("(hover: none)").matches;

  function geom(poly) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = xs.reduce((a, b) => a + b, 0) / poly.length, cy = ys.reduce((a, b) => a + b, 0) / poly.length;
    return { x0, x1, y0, y1, cx, cy, w: x1 - x0, h: y1 - y0 };
  }
  const pts = (poly) => poly.map((p) => p.join(",")).join(" ");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  for (const id of ["drawn", "overlay"]) {
    $(id).setAttribute("viewBox", `0 0 ${WW} ${H}`);
    $(id).setAttribute("width", WW); $(id).setAttribute("height", H);
  }
  world.style.width = `${WW}px`; world.style.height = `${H}px`;

  /* ---------- drawn shelf: the real one, rebuilt from the panorama ---------- */
  // title (and author surname) along the spine's long axis; returns true for upright books
  function spineText(g, b, ink) {
    const [p0, p1, p2] = b.poly;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1]], e2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    const [ax, len, thick] = l1 >= l2 ? [e1, l1, l2] : [e2, l2, l1];
    let ang = (Math.atan2(ax[1], ax[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
    const vertical = Math.abs(ang) > 45;
    if (vertical && Math.abs(Math.abs(ang) - 90) < 4) ang = b.lang === "en" ? 90 : -90; // English spines read top-down
    const title = (b.title || "").replace(/\s*[:(].*$/, "");
    if (!title || b.conf === "unknown") return vertical;
    const h = hash(b.id);
    const style = h % 20 < 12 ? "o" : h % 20 < 17 ? "p" : "g";
    const fam = { o: "Oswald, sans-serif", p: "'Playfair Display', serif", g: "'Space Grotesk', sans-serif" }[style];
    const withAuthor = len > thick * 5.5 && b.author;
    const fs = Math.min(thick * (style === "o" ? 0.5 : 0.42), 46);
    const room = len * (withAuthor ? 0.66 : 0.86);
    const txt = style === "o" ? title.toUpperCase() : title;
    const est = txt.length * fs * (style === "o" ? 0.5 : 0.56);
    const t = el("text", {
      transform: `translate(${b.cx} ${b.cy}) rotate(${ang}) translate(${withAuthor ? -len * 0.12 : 0} 0)`,
      "font-size": fs.toFixed(1), "font-family": fam, fill: ink, class: "sp",
    }, g);
    if (est > room) { t.setAttribute("textLength", room.toFixed(0)); t.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
    t.textContent = txt;
    if (withAuthor) {
      const sur = b.author.split(",")[0].trim().split(" ").pop().toUpperCase();
      const fa = fs * 0.62, ra = len * 0.22;
      const a = el("text", {
        transform: `translate(${b.cx} ${b.cy}) rotate(${ang}) translate(${len * 0.36} 0)`,
        "font-size": fa.toFixed(1), "font-family": "'Space Grotesk', sans-serif", fill: ink, class: "sp sp-a",
      }, g);
      if (sur.length * fa * 0.6 > ra) { a.setAttribute("textLength", ra.toFixed(0)); a.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
      a.textContent = sur;
    }
    return vertical;
  }

  function buildAnalog() {
    const g = $("analog");
    const back = el("g", {}, g), frame = el("g", {}, g), shadows = el("g", {}, g), spines = el("g", {}, g), front = el("g", {}, g);
    const B = SC.board;
    for (const c of SC.comps) {
      el("rect", { x: c.x, y: c.y, width: c.w, height: c.h, fill: "url(#gBack)" }, back);
      el("rect", { x: c.x, y: c.y, width: c.w, height: 70, fill: "url(#gUnder)" }, back);
      el("rect", { x: c.x - 6, y: c.y + c.h, width: c.w + 12, height: B, fill: "url(#gBoard)" }, front);
      el("rect", { x: c.x - 6, y: c.y + c.h, width: c.w + 12, height: 3, fill: "#3a3940" }, front);
    }
    // top boards, side panels, plinth
    const bottoms = {};
    for (const c of SC.comps) bottoms[c.id[0]] = Math.max(bottoms[c.id[0]] || 0, c.y + c.h + B);
    for (const col of SC.cols) {
      const top = Math.min(...SC.comps.filter((c) => c.id[0] === col.id).map((c) => c.y));
      const y0 = Math.max(0, top - B);
      if (top > 0) el("rect", { x: col.x0 - 34, y: top - B, width: col.x1 - col.x0 + 68, height: B, fill: "url(#gBoard)" }, front);
      el("rect", { x: col.x0 - 34, y: y0, width: 34, height: SC.floor - y0, fill: "url(#gSide)" }, frame);
      el("rect", { x: col.x1, y: y0, width: 34, height: SC.floor - y0, fill: "url(#gSide)" }, frame);
      const bot = bottoms[col.id];
      el("rect", { x: col.x0 - 34, y: bot, width: col.x1 - col.x0 + 68, height: SC.floor - bot, fill: "#0b0a0d" }, front);
      if (col.id === "L") {
        // the cabinet under the left column: one door and a stack of drawers
        const cy0 = bot + 30, cy1 = SC.floor - 40, split = col.x0 + (col.x1 - col.x0) * 0.62;
        el("rect", { x: col.x0 + 8, y: cy0, width: split - col.x0 - 20, height: cy1 - cy0, rx: 6, fill: "#111015", stroke: "#25242a", "stroke-width": 4 }, front);
        el("rect", { x: split - 70, y: cy0 + 80, width: 12, height: 220, rx: 6, fill: "#2c2b33" }, front);
        const n = 4, dh = (cy1 - cy0) / n;
        for (let k = 0; k < n; k++) {
          el("rect", { x: split, y: cy0 + k * dh + 6, width: col.x1 - split - 8, height: dh - 12, rx: 6, fill: "#121116", stroke: "#25242a", "stroke-width": 4 }, front);
          el("rect", { x: split + (col.x1 - split) / 2 - 90, y: cy0 + k * dh + 50, width: 170, height: 12, rx: 6, fill: "#2c2b33" }, front);
        }
      } else {
        el("rect", { x: col.x0 - 34, y: SC.floor - 70, width: col.x1 - col.x0 + 68, height: 70, fill: "#08070a" }, front);
      }
    }
    for (const b of physical) {
      const [fill, ink] = SC.colors[b.id] || ["#444", "#ddd"];
      el("polygon", { points: pts(b.poly.map(([x, y]) => [x + 12, y + 4])), fill: "#000", "fill-opacity": ".5" }, shadows);
      const bg = el("g", { id: `bk-${b.i}`, class: "bk" }, spines);
      el("polygon", { points: pts(b.poly), fill, stroke: "#000", "stroke-opacity": ".55", "stroke-width": 3, "stroke-linejoin": "round" }, bg);
      const shade = el("polygon", { points: pts(b.poly) }, bg);
      const vert = spineText(bg, b, ink);
      shade.setAttribute("fill", vert ? "url(#gSpineV)" : "url(#gSpineH)");
      if (hash(b.id) % 3 === 0 && b.h > b.w * 3) { // decorative bands on some tall spines
        for (const f of [0.07, 0.93]) el("rect", { x: b.x0 + 2, y: b.y0 + b.h * f - 5, width: b.w - 4, height: 10, fill: ink, "fill-opacity": ".45" }, bg);
      }
    }
  }

  /* ---------- digital shelf: same compartments, clearly made of light ---------- */
  function buildDigital() {
    const g = $("digital"), B = SC.board;
    const r = $("clipDigRect");
    for (const [k, v] of Object.entries({ x: X0 - 60, y: 0, width: W + 120, height: SC.floor })) r.setAttribute(k, v);
    el("rect", { x: X0 - 60, y: 0, width: W + 120, height: SC.floor, fill: "url(#gDigBack)" }, g);
    el("rect", { x: X0 - 60, y: 0, width: W + 120, height: SC.floor, fill: "url(#pGrid)" }, g);
    const frame = el("g", {}, g), items = el("g", {}, g), fx = el("g", { "clip-path": "url(#clipDig)" }, g);
    const count = {};
    for (const d of digital) { const c = d.id.slice(1, 3); count[c] = (count[c] || 0) + 1; }
    for (const c0 of SC.comps) {
      const c = { ...c0, x: c0.x + X0 };
      el("rect", { x: c.x, y: c.y, width: c.w, height: c.h, rx: 14, class: "dcomp" }, frame);
      el("rect", { x: c.x - 10, y: c.y + c.h + B * 0.2, width: c.w + 20, height: B * 0.6, rx: 14, class: "dboard-glow" }, frame);
      el("rect", { x: c.x - 4, y: c.y + c.h + B * 0.38, width: c.w + 8, height: B * 0.24, rx: 6, class: "dboard" }, frame);
      const L = 46;
      el("path", { d: `M${c.x} ${c.y + L}V${c.y}H${c.x + L}M${c.x + c.w - L} ${c.y}H${c.x + c.w}V${c.y + L}`, class: "dcorner" }, frame);
      const lbl = el("text", { x: c.x + 26, y: c.y + 56, class: "dlabel" }, frame);
      lbl.textContent = `${c.id} // ${String(count[c.id] || 0).padStart(2, "0")}`;
      if (!count[c.id]) {
        const t = el("text", { x: c.x + c.w / 2, y: c.y + c.h / 2, class: "dempty" }, frame);
        t.textContent = "— NO DATA —";
      }
    }
    for (const d of digital) {
      const col = d.color || `hsl(${hash(d.title) % 360} 70% 62%)`;
      const bg = el("g", { id: `bk-${d.i}`, class: `bk dk${d.sample ? " sample" : ""}`, style: `--c:${col}` }, items);
      el("rect", { x: d.x0, y: d.y0, width: d.w, height: d.h, rx: 9, class: "dspine" }, bg);
      el("rect", { x: d.x0, y: d.y0, width: d.w, height: d.h, rx: 9, fill: "url(#gDigSpine)" }, bg);
      // read state as a progress bar, kind as a small glyph, a dot when the book also stands in the real shelf
      el("rect", { x: d.x0 + 8, y: d.y1 - 22, width: d.w - 16, height: 8, rx: 4, class: d.read ? "dbar on" : "dbar" }, bg);
      const glyph = d.kinds.includes("audio") ? "♪" : d.kinds.includes("kindle") ? (d.kinds.length > 1 ? "K+" : "K") : "DOC";
      const gt = el("text", { x: d.cx, y: d.y1 - 40, class: "dglyph", "font-size": Math.min(d.w * 0.42, 22).toFixed(1) }, bg);
      gt.textContent = glyph;
      if (d.twin) el("circle", { cx: d.cx, cy: d.y0 + 24, r: Math.min(9, d.w * 0.18), class: "dtwin" }, bg);
      const title = (d.title || "").replace(/\s*[:(].*$/, "").toUpperCase();
      const fs = Math.min(d.w * 0.44, 30), room = d.h - 130;
      const tx = el("text", { transform: `translate(${d.cx} ${d.y0 + 46 + room / 2}) rotate(90)`, class: "dtitle", "font-size": fs.toFixed(1) }, bg);
      if (title.length * fs * 0.62 > room) { tx.setAttribute("textLength", room.toFixed(0)); tx.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
      tx.textContent = title;
    }
    el("rect", { x: X0 - 1400, y: -200, width: 900, height: SC.floor + 400, fill: "url(#gShimmer)", class: "shimmer" }, fx);
    const t = el("text", { x: X0 + W / 2, y: -50, class: "dhead" }, g);
    t.textContent = "DIGITAL ARCHIVE";
  }

  function buildCorridor() {
    const g = $("corridor"), mx = W + GAP / 2;
    el("rect", { x: mx - 246, y: 260, width: 492, height: SC.floor - 260, class: "gate-field" }, g);
    for (const dx of [-260, 260]) el("rect", { x: mx + dx - 14, y: 260, width: 28, height: SC.floor - 260, rx: 14, class: "gate" }, g);
    for (let k = 0; k < 3; k++) {
      const t = el("text", { x: mx, y: 1900 + k * 260, class: "gate-chev", style: `animation-delay:${k * 0.25}s` }, g);
      t.textContent = "›››";
    }
    const lab = el("text", { x: mx, y: 190, class: "gate-label" }, g);
    lab.textContent = "SYNC";
  }

  buildAnalog();
  buildCorridor();
  buildDigital();

  /* ---------- photo (lazy): small first, then full resolution ---------- */
  let photoLoaded = false;
  function loadPhoto() {
    if (photoLoaded) return;
    photoLoaded = true;
    shelf.src = "img/shelf-2400.webp";
    $("liftImg").setAttribute("href", "img/shelf-2400.webp");
    const full = new Image();
    full.decoding = "async";
    full.onload = () => { shelf.src = full.src; $("liftImg").setAttribute("href", full.src); };
    shelf.decode().catch(() => {}).finally(() => { full.src = "img/shelf.webp"; });
  }
  function setPhoto(on) {
    photo = on;
    if (on) loadPhoto();
    stage.classList.toggle("photo", on);
    $("photo").setAttribute("aria-pressed", on);
    if (active >= 0) { const i = active, p = pinned; active = -1; activate(i); pinned = p; }
  }
  $("photo").onclick = () => setPhoto(!photo);

  /* ---------- hit polygons ---------- */
  const frag = document.createDocumentFragment();
  for (const b of books) {
    const p = document.createElementNS(SVGNS, "polygon");
    p.setAttribute("points", pts(b.poly));
    p.dataset.i = b.i;
    frag.appendChild(p);
  }
  hits.appendChild(frag);

  const rated = physical.filter((b) => b.rating > 0);
  const avg = rated.length ? rated.reduce((a, b) => a + b.rating, 0) / rated.length : 0;
  const n = META.counts || {};
  ZONES[0].sub = `${physical.length} Bücher · Ø ${avg.toFixed(2)} ★`;
  ZONES[1].sub = `${n.kindle || 0} Kindle · ${n.doc || 0} Dokumente · ${n.audio || 0} Hörbücher`;
  ZONES[0].stat = `${physical.length} Bücher · ${rated.length} auf Goodreads · Ø ${avg.toFixed(2)} ★`;
  ZONES[1].stat = `${digital.length} Titel · ${n.kindle || 0} Kindle · ${n.doc || 0} Dok. · ${n.audio || 0} Audio`;

  /* ---------- view transform ---------- */
  function vp() { return { w: stage.clientWidth, h: stage.clientHeight }; }
  function fitScale() {
    const { w, h } = vp();
    return Math.min(w / W, (h - 110) / HF);
  }
  function clampView() {
    const { w, h } = vp();
    view.s = clamp(view.s, minS, maxS);
    const sw = WW * view.s, sh = H * view.s, m = Math.max(60, w * 0.3);
    view.tx = sw < w ? (w - sw) / 2 : clamp(view.tx, w - sw - m, m);
    view.ty = sh * 1.08 <= h - 110 ? (h - sh * 1.08) / 2 : clamp(view.ty, h - sh - 60 - 50, 60 + 50);
  }
  function render() {
    world.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    if (active >= 0) placeCard(false);
    minimap();
    background();
    zoneCheck();
  }
  function zoneView(z) {
    const s = fitScale(), { w, h } = vp();
    return { s, tx: (w - W * s) / 2 - ZONES[z].x * s, ty: (h - HF * s) / 2 };
  }
  function fit() {
    minS = fitScale() * 0.5;
    Object.assign(view, zoneView(0));
    clampView(); render();
  }
  function zoomAt(f, sx, sy) {
    const ns = clamp(view.s * f, minS, maxS);
    const wx = (sx - view.tx) / view.s, wy = (sy - view.ty) / view.s;
    view.s = ns; view.tx = sx - wx * ns; view.ty = sy - wy * ns;
    clampView(); render();
  }
  function toWorld(sx, sy) { return [(sx - view.tx) / view.s, (sy - view.ty) / view.s]; }
  function toScreen(x, y) { return [x * view.s + view.tx, y * view.s + view.ty]; }

  function flyTo(target, done, dur = 750) {
    cancelAnimationFrame(anim);
    const from = { ...view }, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      view.s = from.s + (target.s - from.s) * e;
      view.tx = from.tx + (target.tx - from.tx) * e;
      view.ty = from.ty + (target.ty - from.ty) * e;
      render();
      if (t < 1) anim = requestAnimationFrame(step); else { clampView(); render(); done && done(); }
    };
    anim = requestAnimationFrame(step);
  }
  function flyToZone(z) {
    deactivate();
    const t = zoneView(z);
    flyTo(t, null, Math.abs(t.tx - view.tx) > vp().w ? 1300 : 750);
  }
  function flyToBook(i) {
    const b = books[i], { w, h } = vp();
    const wide = w > 720;
    const s = clamp(Math.min((h * (wide ? 0.45 : 0.32)) / b.h, (w * (wide ? 0.3 : 0.7)) / b.w), fitScale(), 2.2);
    const tx = (wide ? w * 0.38 : w / 2) - b.cx * s;
    const ty = (wide ? h / 2 : h * 0.3) - b.cy * s;
    unhover(true);
    flyTo({ s, tx, ty }, () => { activate(i); pinned = true; card.classList.add("pinned"); }, Math.abs(tx - view.tx) > w * 1.5 ? 1300 : 750);
  }

  /* ---------- zones: banner, stat line, walk buttons ---------- */
  function camX() { return toWorld(vp().w / 2, 0)[0]; }
  function zoneCheck() {
    const cx = camX(), z = cx < W + GAP / 2 ? 0 : 1;
    $("trackDot").style.left = `${clamp(cx / WW, 0, 1) * 100}%`;
    if (z === zone) return;
    const first = zone < 0;
    zone = z;
    document.body.classList.toggle("in-digital", z === 1);
    $("stat").textContent = ZONES[z].stat;
    $("goL").classList.toggle("show", z === 1);
    $("goR").classList.toggle("show", z === 0);
    for (const bt of $("track").querySelectorAll("button")) bt.classList.toggle("on", +bt.dataset.z === z);
    if (first) return;
    const zb = $("zoneBanner");
    $("zbNo").textContent = `ZONE ${ZONES[z].no}`;
    $("zbName").textContent = ZONES[z].name;
    $("zbSub").textContent = ZONES[z].sub;
    zb.classList.remove("go"); void zb.offsetWidth; zb.classList.add("go");
  }
  $("goL").onclick = () => flyToZone(0);
  $("goR").onclick = () => flyToZone(1);
  for (const bt of $("track").querySelectorAll("button")) bt.onclick = () => flyToZone(+bt.dataset.z);

  // screen-space backdrop: wall behind the shelves and a perspective floor that scrolls with the camera
  const bg = $("bg"), bgx = bg.getContext("2d");
  let bgW = 0, bgH = 0, dpr = 1;
  function sizeBg() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = vp();
    bgW = w; bgH = h;
    bg.width = w * dpr; bg.height = h * dpr;
  }
  function background() {
    const c = bgx, w = bgW, h = bgH;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [, fy] = toScreen(0, SC.floor);
    const [mx] = toScreen(W + GAP / 2, 0);
    // wall: warm on the analog side, deep violet on the digital side
    const wall = c.createLinearGradient(mx - w * 0.6, 0, mx + w * 0.6, 0);
    wall.addColorStop(0, "#120f0d"); wall.addColorStop(0.45, "#0b0b10"); wall.addColorStop(1, "#060719");
    c.fillStyle = wall; c.fillRect(0, 0, w, h);
    // digital wall: dot grid with parallax
    const [dx0] = toScreen(X0 - 300, 0);
    if (dx0 < w) {
      const step = 48, ox = ((view.tx * 0.4) % step + step) % step, oy = ((view.ty * 0.4) % step + step) % step;
      c.fillStyle = "rgba(124,108,255,.22)";
      for (let x = ox; x < w; x += step) {
        if (x < dx0) continue;
        for (let y = oy; y < Math.min(fy, h); y += step) c.fillRect(x, y, 2, 2);
      }
    }
    if (fy >= h) return;
    // floor: wooden planks on the analog side, a neon grid on the digital side
    const fl = c.createLinearGradient(mx - w * 0.4, 0, mx + w * 0.4, 0);
    fl.addColorStop(0, "#2b1c11"); fl.addColorStop(0.5, "#131013"); fl.addColorStop(1, "#070822");
    c.fillStyle = fl; c.fillRect(0, fy, w, h - fy);
    const depth = h - fy, vpx = w / 2, spread = 3.2;
    const sp = 260, x0w = toWorld(-w * 0.6, 0)[0], x1w = toWorld(w * 1.6, 0)[0];
    for (let x = Math.floor(x0w / sp) * sp; x < x1w; x += sp) {
      const [sx] = toScreen(x, 0), dig = x > W + GAP / 2;
      c.strokeStyle = dig ? "rgba(70,240,225,.38)" : "rgba(150,104,62,.35)";
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(sx, fy); c.lineTo(vpx + (sx - vpx) * spread, fy + depth * 1.2); c.stroke();
    }
    for (let k = 1; k < 10; k++) {
      const y = fy + depth * Math.pow(k / 10, 1.7);
      const g = c.createLinearGradient(mx - 60, 0, mx + 60, 0);
      g.addColorStop(0, "rgba(150,104,62,.22)"); g.addColorStop(1, "rgba(70,240,225,.25)");
      c.strokeStyle = g;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    const shade = c.createLinearGradient(0, fy, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,.6)"); shade.addColorStop(0.5, "rgba(0,0,0,.1)"); shade.addColorStop(1, "rgba(0,0,0,.45)");
    c.fillStyle = shade; c.fillRect(0, fy, w, h - fy);
    if (mx < w) { c.fillStyle = "rgba(70,240,225,.7)"; c.fillRect(Math.max(0, mx), fy - 1, w, 2); }
  }

  /* ---------- active book ---------- */
  function activate(i) {
    clearTimeout(hideT);
    if (i === active) return;
    active = i;
    const b = books[i];
    const lift = Math.min(1.25, 1.08 + 4 / Math.max(8, Math.min(b.w, b.h)));
    const origin = `${b.cx}px ${b.cy}px`;
    for (const id of ["lifted", "liftedFx"]) {
      const e = $(id);
      e.style.transformOrigin = origin;
      e.style.setProperty("--lift", lift);
    }
    const fromPhoto = photo && b.zone === 0;
    $("liftImg").style.display = fromPhoto ? "" : "none";
    $("liftUse").style.display = fromPhoto ? "none" : "";
    $("liftUse").setAttribute("href", `#bk-${i}`);
    const P = pts(b.poly);
    $("clipPoly").setAttribute("points", P);
    const ol = $("outline");
    ol.setAttribute("points", P);
    ol.setAttribute("pathLength", "100");
    ol.style.setProperty("--per", 100);

    const pad = 3, L = Math.max(6, Math.min(b.w, b.h) * 0.28);
    const x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
    $("brackets").setAttribute("d",
      `M${x0} ${y0 + L}V${y0}H${x0 + L}M${x1 - L} ${y0}H${x1}V${y0 + L}` +
      `M${x1} ${y1 - L}V${y1}H${x1 - L}M${x0 + L} ${y1}H${x0}V${y1 - L}`);
    const scan = $("scan"), sh = Math.max(20, b.h * 0.3);
    scan.setAttribute("x", b.x0); scan.setAttribute("y", b.y0 - sh);
    scan.setAttribute("width", b.w); scan.setAttribute("height", sh);
    scan.style.setProperty("--scanH", `${b.h + sh}px`);

    const lp = b.poly.map(([x, y]) => [b.cx + (x - b.cx) * lift, b.cy + (y - b.cy) * lift]);
    $("dim").setAttribute("d", `M-2000 -2000H${WW + 2000}V${H + 2000}H-2000Z M${lp.map((p) => p.join(" ")).join("L")}Z`);

    fillCard(b);
    // restart the CSS entry animations for the new target
    stage.classList.remove("has-active"); card.classList.remove("open"); leader.classList.remove("on");
    void stage.offsetWidth;
    stage.classList.add("has-active");
    card.hidden = false;
    placeCard(true);
    card.classList.add("open"); leader.classList.add("on");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $("cStars").style.width = b.rating ? `${(b.rating / 5) * 100}%` : "0";
    }));
  }
  function deactivate() {
    active = -1; pinned = false;
    stage.classList.remove("has-active");
    card.classList.remove("open", "pinned"); leader.classList.remove("on");
    card.hidden = true;
    searchDim();
  }
  function unhover(now) {
    if (pinned && !now) return;
    clearTimeout(hideT);
    if (now) deactivate(); else hideT = setTimeout(deactivate, 260);
  }

  const CONF = { high: ["erkannt", ""], medium: ["wahrscheinlich", ""], low: ["unsicher", "warn"], unknown: ["nicht lesbar", "warn"] };
  const KIND = { kindle: "Kindle", doc: "Dokument", audio: "Hörbuch" };
  function fillCard(b) {
    const known = b.conf !== "unknown" && b.title;
    const dig = b.zone === 1;
    card.classList.toggle("digital", dig);
    leader.classList.toggle("digital", dig);
    $("cTag").textContent = b.id;
    const cConf = $("cConf");
    if (dig) {
      cConf.textContent = b.kinds.map((k) => KIND[k]).join(" + ") + (b.sample ? " · Leseprobe" : "");
      cConf.className = "tag dim";
    } else {
      const [ct, cc] = CONF[b.conf] || CONF.unknown;
      cConf.textContent = ct; cConf.className = `tag ${cc || "dim"}`;
    }
    $("cRead").hidden = !(dig && b.read);
    scramble($("cTitle"), known ? b.title : "Unbekanntes Buch");
    $("cAuthor").textContent = known ? b.author : "Buchrücken nicht eindeutig lesbar";
    $("cSeries").textContent = b.series || (b.grTitle && norm(b.grTitle) !== norm(b.title) ? b.grTitle : "");
    const r = $("cRating");
    r.classList.toggle("none", !b.rating);
    $("cStars").style.width = "0";
    $("cRatingNum").textContent = b.rating ? b.rating.toFixed(2) : "";
    $("cCount").textContent = b.rating ? `${b.ratings.toLocaleString("de-DE")} Bewertungen auf Goodreads` : known ? "Kein Goodreads-Rating gefunden" : "";
    const wrap = $("cCoverWrap"), img = $("cCover");
    wrap.classList.remove("has-img");
    img.onload = () => wrap.classList.add("has-img");
    if (b.cover) img.src = b.cover; else img.removeAttribute("src");
    const gr = $("cGr"), amz = $("cAmz");
    gr.hidden = !b.gr; if (b.gr) gr.href = b.gr;
    amz.hidden = !b.amazon; if (b.amazon) amz.href = b.amazon;
    const tw = $("cTwin"), other = b.twin && byId.get(b.twin);
    tw.hidden = !other;
    if (other) {
      tw.textContent = dig ? `◀  Steht auch im Regal · ${other.id}` : `Auch digital · ${other.id}  ▶`;
      tw.onclick = () => flyToBook(other.i);
    }
  }
  function scramble(e, text) {
    const glyphs = "▮▯░▒ABCDEFGHJKLMNOPRSTUVXYZ0123456789#%&";
    const total = Math.round(Math.min(26, 10 + text.length / 2));
    let f = 0;
    cancelAnimationFrame(e._raf);
    clearTimeout(e._t);
    e.textContent = text.replace(/\S/g, "▯");
    const step = () => {
      const k = (f / total) * text.length;
      let out = "";
      for (let j = 0; j < text.length; j++) out += j < k || text[j] === " " ? text[j] : glyphs[(Math.random() * glyphs.length) | 0];
      e.textContent = out;
      if (f++ < total) e._raf = requestAnimationFrame(step); else e.textContent = text;
    };
    e._t = setTimeout(step, 520);
  }

  /* card + leader line placement in screen space */
  function placeCard(fresh) {
    if (active < 0) return;
    const b = books[active], { w, h } = vp();
    const lift = parseFloat($("lifted").style.getPropertyValue("--lift")) || 1.12;
    const hw = (b.w * lift) / 2, hh = (b.h * lift) / 2;
    const [sl, st] = toScreen(b.cx - hw, b.cy - hh), [sr, sb] = toScreen(b.cx + hw, b.cy + hh);
    const scx = (sl + sr) / 2, scy = (st + sb) / 2;
    const cw = card.offsetWidth, ch = card.offsetHeight || 220, gap = 64, top = 64, bottom = 64;
    let ax, ay, cx, cy, line;
    if (sr + gap + cw < w - 12) {
      ax = sr; ay = clamp(scy, 40, h - 40); cx = sr + gap; cy = clamp(ay - 40, top, h - ch - bottom);
      const ly = clamp(ay - 20, cy + 18, cy + ch - 18);
      line = [[ax, ay], [cx - 18, ly], [cx, ly]];
    } else if (sl - gap - cw > 12) {
      ax = sl; ay = clamp(scy, 40, h - 40); cx = sl - gap - cw; cy = clamp(ay - 40, top, h - ch - bottom);
      const ly = clamp(ay - 20, cy + 18, cy + ch - 18);
      line = [[ax, ay], [cx + cw + 18, ly], [cx + cw, ly]];
    } else {
      // narrow screens: card below (or above) the book
      cx = clamp(scx - cw / 2, 12, w - cw - 12);
      if (sb + 40 + ch < h - 12) { ax = scx; ay = sb; cy = sb + 40; line = [[ax, ay], [ax, cy]]; }
      else { ax = scx; ay = st; cy = Math.max(top, st - 40 - ch); line = [[ax, ay], [ax, cy + ch]]; }
    }
    card.style.setProperty("--x", `${Math.round(cx)}px`);
    card.style.setProperty("--y", `${Math.round(cy)}px`);
    anchorDot.setAttribute("cx", ax); anchorDot.setAttribute("cy", ay);
    anchorRing.setAttribute("cx", ax); anchorRing.setAttribute("cy", ay);
    leaderLine.setAttribute("points", line.map((p) => p.join(",")).join(" "));
    if (fresh) {
      let len = 0;
      for (let k = 1; k < line.length; k++) len += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
      leaderLine.style.setProperty("--len", Math.ceil(len) + 2);
    }
  }

  /* ---------- pointer handling: hover, click, drag, pinch ---------- */
  const ptrs = new Map();
  let drag = null, pinch = null;
  const bookAt = (x, y) => {
    const e = document.elementFromPoint(x, y);
    return e && e.parentNode === hits ? +e.dataset.i : -1;
  };

  hits.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || drag?.moved || pinned || walking) return;
    activate(+e.target.dataset.i);
  });
  hits.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const to = e.relatedTarget;
    if (to && to.parentNode === hits) return;
    unhover(false);
  });
  card.addEventListener("pointerenter", () => clearTimeout(hideT));
  card.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") unhover(false); });
  $("cClose").addEventListener("click", () => deactivate());

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#card, .walk")) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    cancelAnimationFrame(anim);
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, tx: view.tx, ty: view.ty };
      drag && (drag.moved = true);
    }
  });
  window.addEventListener("pointermove", (e) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    $("readout").textContent = `X ${String(Math.round(clamp(wx, 0, WW))).padStart(5, "0")} · Y ${String(Math.round(clamp(wy, 0, H))).padStart(4, "0")} · ${Math.round(view.s * 100)}%`;
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const ns = clamp(pinch.s * (d / pinch.d), minS, maxS);
      const wx0 = (pinch.mx - pinch.tx) / pinch.s, wy0 = (pinch.my - pinch.ty) / pinch.s;
      view.s = ns; view.tx = mx - wx0 * ns; view.ty = my - wy0 * ns;
      clampView(); render();
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; stage.classList.add("dragging"); if (!pinned) unhover(true); }
      if (drag.moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; clampView(); render(); }
    }
  });
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) {
      const wasDrag = drag && drag.moved;
      drag = null; stage.classList.remove("dragging");
      if (!wasDrag && e.type === "pointerup") click(e.clientX, e.clientY);
    }
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);

  function click(x, y) {
    const i = bookAt(x, y);
    if (i >= 0) {
      if (pinned && i === active) { deactivate(); return; }
      pinned = false;
      activate(i);
      pinned = true; card.classList.add("pinned");
    } else if (active >= 0) deactivate();
    closeResults();
  }

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { // trackpad sideways swipe walks
      view.tx -= e.deltaX; clampView(); render(); return;
    }
    const k = e.ctrlKey ? 0.01 : 0.0018;
    zoomAt(Math.exp(-e.deltaY * k), e.clientX, e.clientY);
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => { if (bookAt(e.clientX, e.clientY) < 0) zoomAt(1.8, e.clientX, e.clientY); });

  const centerZoom = (f) => { const { w, h } = vp(); zoomAt(f, w / 2, h / 2); };
  $("zIn").onclick = () => centerZoom(1.5);
  $("zOut").onclick = () => centerZoom(1 / 1.5);
  $("zFit").onclick = () => flyToZone(zone < 0 ? 0 : zone);

  /* ---------- walking: hold ←/→ (A/D), ↑/↓ (W/S) when zoomed in, Shift runs ---------- */
  const held = new Set();
  const DIRS = { ArrowLeft: "l", a: "l", A: "l", ArrowRight: "r", d: "r", D: "r", ArrowUp: "u", w: "u", W: "u", ArrowDown: "d", s: "d", S: "d" };
  let vx = 0, vy = 0, walkRaf = 0, lastT = 0, walking = false;
  function walkTick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
    lastT = t;
    const dx = (held.has("r") ? 1 : 0) - (held.has("l") ? 1 : 0);
    const dy = (held.has("d") ? 1 : 0) - (held.has("u") ? 1 : 0);
    const max = (held.has("run") ? 2.4 : 1) * Math.max(650, vp().w * 0.8);
    const acc = max * 4, fr = Math.pow(0.002, dt);
    vx = dx ? clamp(vx + dx * acc * dt, -max, max) : vx * fr;
    vy = dy ? clamp(vy + dy * acc * dt, -max, max) : vy * fr;
    if (!dx && !dy && Math.abs(vx) < 5 && Math.abs(vy) < 5) {
      vx = vy = 0; walkRaf = 0; walking = false; stage.classList.remove("walking"); return;
    }
    const ptx = view.tx;
    view.tx -= vx * dt; view.ty -= vy * dt;
    clampView(); render();
    if (dx && view.tx === ptx) vx = 0; // bumped into the end of the world
    walkRaf = requestAnimationFrame(walkTick);
  }
  function startWalk() {
    if (walkRaf) return;
    cancelAnimationFrame(anim);
    if (!pinned) unhover(true);
    walking = true; stage.classList.add("walking");
    lastT = performance.now();
    walkRaf = requestAnimationFrame(walkTick);
  }

  window.addEventListener("keydown", (e) => {
    if (e.target === q) return;
    if (e.shiftKey) held.add("run"); else held.delete("run");
    if (DIRS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); held.add(DIRS[e.key]); startWalk(); return; }
    if (e.key === "Escape") deactivate();
    else if (e.key === "+" || e.key === "=") centerZoom(1.4);
    else if (e.key === "-") centerZoom(1 / 1.4);
    else if (e.key === "0") $("zFit").click();
    else if (e.key === "1" || e.key === "2") flyToZone(+e.key - 1);
    else if (e.key === "f" || e.key === "F") setPhoto(!photo);
    else if (e.key === "/") { e.preventDefault(); q.focus(); }
  });
  window.addEventListener("keyup", (e) => {
    if (DIRS[e.key]) held.delete(DIRS[e.key]);
    if (e.key === "Shift") held.delete("run");
  });
  window.addEventListener("blur", () => held.clear());
  window.addEventListener("resize", () => { sizeBg(); minS = fitScale() * 0.5; clampView(); render(); });

  /* ---------- minimap: both shelves drawn from the book polygons ---------- */
  const mm = $("minimap"), mmView = $("mmView"), mmc = $("mmCanvas");
  (function drawMinimap() {
    const mw = 240, mh = Math.round((mw * H) / WW), k = mw / WW, r = 2;
    mmc.width = mw * r; mmc.height = mh * r;
    mmc.style.height = `${mh}px`;
    const c = mmc.getContext("2d");
    c.scale(r * k, r * k);
    c.fillStyle = "#0c0b0f"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#070820"; c.fillRect(X0 - 60, 0, W + 120, H);
    for (const cp of SC.comps) {
      c.fillStyle = "#1b1a20"; c.fillRect(cp.x, cp.y, cp.w, cp.h);
      c.strokeStyle = "rgba(124,108,255,.7)"; c.lineWidth = 18; c.strokeRect(cp.x + X0, cp.y, cp.w, cp.h);
    }
    for (const b of books) {
      c.fillStyle = b.zone ? b.color || "#46f0e1" : (SC.colors[b.id] || ["#555"])[0];
      c.beginPath(); b.poly.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y))); c.fill();
    }
  })();
  function minimap() {
    const { w, h } = vp();
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h);
    const cx0 = clamp(x0, 0, WW), cy0 = clamp(y0, 0, H), cx1 = clamp(x1, 0, WW), cy1 = clamp(y1, 0, H);
    Object.assign(mmView.style, { left: `${(cx0 / WW) * 100}%`, top: `${(cy0 / H) * 100}%`, width: `${((cx1 - cx0) / WW) * 100}%`, height: `${((cy1 - cy0) / H) * 100}%` });
  }
  mm.addEventListener("click", (e) => {
    const r = mm.getBoundingClientRect(), { w, h } = vp();
    const wx = ((e.clientX - r.left) / r.width) * WW, wy = ((e.clientY - r.top) / r.height) * H;
    flyTo({ s: view.s, tx: w / 2 - wx * view.s, ty: h / 2 - wy * view.s }, null, 900);
  });

  /* ---------- search (both shelves) ---------- */
  const q = $("q"), results = $("results");
  let found = [], sel = -1;
  const hay = books.map((b) => norm([b.title, b.author, b.series, b.grTitle].filter(Boolean).join(" ")));
  q.addEventListener("input", () => {
    const toks = norm(q.value).split(/\s+/).filter(Boolean);
    matchesG.replaceChildren();
    if (!toks.length) { found = []; closeResults(); stage.classList.remove("searching"); return; }
    found = books.filter((b) => b.conf !== "unknown" && toks.every((t) => hay[b.i].includes(t)));
    sel = found.length ? 0 : -1;
    const frag = document.createDocumentFragment();
    for (const b of found) {
      const p = document.createElementNS(SVGNS, "polygon");
      p.setAttribute("points", pts(b.poly));
      frag.appendChild(p);
    }
    matchesG.appendChild(frag);
    stage.classList.toggle("searching", found.length > 0);
    searchDim();
    drawResults();
  });
  function searchDim() {
    if (!found.length) return;
    $("dim").setAttribute("d", `M-2000 -2000H${WW + 2000}V${H + 2000}H-2000Z` + found.map((b) => `M${b.poly.map((p) => p.join(" ")).join("L")}Z`).join(""));
  }
  function drawResults() {
    results.replaceChildren();
    if (!found.length) {
      const li = document.createElement("li"); li.className = "empty"; li.textContent = "Kein Treffer in den Regalen";
      results.appendChild(li);
    }
    found.slice(0, 60).forEach((b, k) => {
      const li = document.createElement("li");
      const z = document.createElement("span");
      z.className = `zt${b.zone ? " d" : ""}`; z.textContent = b.zone ? "DIGITAL" : "REGAL";
      li.append(z, document.createTextNode(b.title));
      const sm = document.createElement("small");
      sm.textContent = `${b.author}${b.rating ? `  ·  ★ ${b.rating.toFixed(2)}` : ""}`;
      li.appendChild(sm);
      li.classList.toggle("sel", k === sel);
      li.onclick = () => { closeResults(); flyToBook(b.i); };
      results.appendChild(li);
    });
    results.hidden = false;
  }
  function closeResults() { results.hidden = true; }
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!found.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + Math.min(60, found.length)) % Math.min(60, found.length);
      drawResults();
    } else if (e.key === "Enter" && sel >= 0) { closeResults(); flyToBook(found[sel].i); q.blur(); }
    else if (e.key === "Escape") { q.value = ""; q.dispatchEvent(new Event("input")); q.blur(); }
  });
  q.addEventListener("focus", () => { if (q.value) drawResults(); });

  /* ---------- intro scan ---------- */
  function intro() {
    $("sweepBar").classList.add("go");
    for (const p of hits.children) {
      const b = books[+p.dataset.i];
      if (b.zone) continue;
      p.style.animationDelay = `${(b.cy / H) * 1.9}s`;
      p.classList.add("flash");
    }
    setTimeout(() => { for (const p of hits.children) { p.classList.remove("flash"); p.style.animationDelay = ""; } }, 3400);
  }

  if (isTouch) $("hint").textContent = "Buch antippen · Wischen geht · Pinch zoomt";
  sizeBg();
  fit();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(intro, 150));
})();
