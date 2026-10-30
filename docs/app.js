(() => {
  "use strict";
  const W = 4785, H = 4300;
  const SVGNS = "http://www.w3.org/2000/svg";
  const books = (window.BOOKS || []).map((b, i) => Object.assign(b, geom(b.poly), { i }));
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), world = $("world"), shelf = $("shelf");
  const hits = $("hits"), matchesG = $("matches");
  const card = $("card"), leader = $("leader"), leaderLine = $("leaderLine");
  const anchorDot = $("anchorDot"), anchorRing = $("anchorRing");

  const view = { s: 0.2, tx: 0, ty: 0 };
  let minS = 0.05, maxS = 4;
  let active = -1, pinned = false, hideT = 0, anim = 0;
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

  /* ---------- image: start small, swap to full resolution ---------- */
  const full = new Image();
  full.decoding = "async";
  full.onload = () => { shelf.src = full.src; $("liftImg").setAttribute("href", full.src); };
  shelf.decode().catch(() => {}).finally(() => { full.src = "img/shelf.webp"; intro(); });

  /* ---------- hit polygons ---------- */
  const frag = document.createDocumentFragment();
  for (const b of books) {
    const p = document.createElementNS(SVGNS, "polygon");
    p.setAttribute("points", pts(b.poly));
    p.dataset.i = b.i;
    frag.appendChild(p);
  }
  hits.appendChild(frag);

  const rated = books.filter((b) => b.rating > 0);
  const avg = rated.length ? rated.reduce((a, b) => a + b.rating, 0) / rated.length : 0;
  $("stat").textContent = `${books.length} Bücher · ${rated.length} auf Goodreads · Ø ${avg.toFixed(2)} ★`;

  /* ---------- view transform ---------- */
  function vp() { return { w: stage.clientWidth, h: stage.clientHeight }; }
  function fitScale() {
    const { w, h } = vp();
    return Math.min(w / W, (h - 110) / H);
  }
  function clampView() {
    const { w, h } = vp();
    view.s = clamp(view.s, minS, maxS);
    const sw = W * view.s, sh = H * view.s, m = 60;
    view.tx = sw < w ? (w - sw) / 2 : clamp(view.tx, w - sw - m, m);
    view.ty = sh <= h - 110 ? (h - sh) / 2 : clamp(view.ty, h - sh - m - 50, m + 50);
  }
  function render() {
    world.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    if (active >= 0) placeCard(false);
    minimap();
  }
  function fit() {
    minS = fitScale() * 0.85;
    view.s = fitScale();
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

  function flyTo(target, done) {
    cancelAnimationFrame(anim);
    const from = { ...view }, t0 = performance.now(), dur = 750;
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
  function flyToBook(i) {
    const b = books[i], { w, h } = vp();
    const wide = w > 720;
    const s = clamp(Math.min((h * (wide ? 0.45 : 0.32)) / b.h, (w * (wide ? 0.3 : 0.7)) / b.w), fitScale(), 2.2);
    const tx = (wide ? w * 0.38 : w / 2) - b.cx * s;
    const ty = (wide ? h / 2 : h * 0.3) - b.cy * s;
    unhover(true);
    flyTo({ s, tx, ty }, () => { activate(i); pinned = true; card.classList.add("pinned"); });
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
      const el = $(id);
      el.style.transformOrigin = origin;
      el.style.setProperty("--lift", lift);
    }
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
    $("dim").setAttribute("d", `M-2000 -2000H${W + 2000}V${H + 2000}H-2000Z M${lp.map((p) => p.join(" ")).join("L")}Z`);

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
  function fillCard(b) {
    const known = b.conf !== "unknown" && b.title;
    $("cTag").textContent = b.id;
    const [ct, cc] = CONF[b.conf] || CONF.unknown;
    const cConf = $("cConf");
    cConf.textContent = ct; cConf.className = `tag ${cc || "dim"}`;
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
  }
  function scramble(el, text) {
    const glyphs = "▮▯░▒ABCDEFGHJKLMNOPRSTUVXYZ0123456789#%&";
    const total = Math.round(Math.min(26, 10 + text.length / 2));
    let f = 0;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._t);
    el.textContent = text.replace(/\S/g, "▯");
    const step = () => {
      const k = (f / total) * text.length;
      let out = "";
      for (let j = 0; j < text.length; j++) out += j < k || text[j] === " " ? text[j] : glyphs[(Math.random() * glyphs.length) | 0];
      el.textContent = out;
      if (f++ < total) el._raf = requestAnimationFrame(step); else el.textContent = text;
    };
    el._t = setTimeout(step, 520);
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
    const el = document.elementFromPoint(x, y);
    return el && el.parentNode === hits ? +el.dataset.i : -1;
  };

  hits.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || drag?.moved || pinned) return;
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
    if (e.target.closest("#card")) return;
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
    $("readout").textContent = `X ${String(Math.round(clamp(wx, 0, W))).padStart(4, "0")} · Y ${String(Math.round(clamp(wy, 0, H))).padStart(4, "0")} · ${Math.round(view.s * 100)}%`;
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
    const k = e.ctrlKey ? 0.01 : 0.0018;
    zoomAt(Math.exp(-e.deltaY * k), e.clientX, e.clientY);
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => { if (bookAt(e.clientX, e.clientY) < 0) zoomAt(1.8, e.clientX, e.clientY); });

  const centerZoom = (f) => { const { w, h } = vp(); zoomAt(f, w / 2, h / 2); };
  $("zIn").onclick = () => centerZoom(1.5);
  $("zOut").onclick = () => centerZoom(1 / 1.5);
  $("zFit").onclick = () => { deactivate(); const s = fitScale(); const { w, h } = vp(); flyTo({ s, tx: (w - W * s) / 2, ty: (h - H * s) / 2 }); };

  window.addEventListener("keydown", (e) => {
    if (e.target === q) return;
    if (e.key === "Escape") deactivate();
    else if (e.key === "+" || e.key === "=") centerZoom(1.4);
    else if (e.key === "-") centerZoom(1 / 1.4);
    else if (e.key === "0") $("zFit").click();
    else if (e.key === "/") { e.preventDefault(); q.focus(); }
  });
  window.addEventListener("resize", () => { minS = fitScale() * 0.85; clampView(); render(); });

  /* ---------- minimap ---------- */
  const mm = $("minimap"), mmView = $("mmView");
  function minimap() {
    const { w, h } = vp();
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(w, h);
    const cx0 = clamp(x0, 0, W), cy0 = clamp(y0, 0, H), cx1 = clamp(x1, 0, W), cy1 = clamp(y1, 0, H);
    Object.assign(mmView.style, { left: `${(cx0 / W) * 100}%`, top: `${(cy0 / H) * 100}%`, width: `${((cx1 - cx0) / W) * 100}%`, height: `${((cy1 - cy0) / H) * 100}%` });
  }
  mm.addEventListener("click", (e) => {
    const r = mm.getBoundingClientRect(), { w, h } = vp();
    const wx = ((e.clientX - r.left) / r.width) * W, wy = ((e.clientY - r.top) / r.height) * H;
    flyTo({ s: view.s, tx: w / 2 - wx * view.s, ty: h / 2 - wy * view.s });
  });

  /* ---------- search ---------- */
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
    $("dim").setAttribute("d", `M-2000 -2000H${W + 2000}V${H + 2000}H-2000Z` + found.map((b) => `M${b.poly.map((p) => p.join(" ")).join("L")}Z`).join(""));
  }
  function drawResults() {
    results.replaceChildren();
    if (!found.length) {
      const li = document.createElement("li"); li.className = "empty"; li.textContent = "Kein Treffer im Regal";
      results.appendChild(li);
    }
    found.slice(0, 60).forEach((b, k) => {
      const li = document.createElement("li");
      li.textContent = b.title;
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
      p.style.animationDelay = `${(b.cy / H) * 1.9}s`;
      p.classList.add("flash");
    }
    setTimeout(() => { for (const p of hits.children) { p.classList.remove("flash"); p.style.animationDelay = ""; } }, 3400);
  }

  if (isTouch) $("hint").textContent = "Buch antippen · Pinch zoomt · Ziehen verschiebt";
  fit();
})();
