// Faction Atlas map: Ben's style layer (publisher-owned). Hooks Mac's atlas-map.js through window.atlasMap (v2 API).
// v2 (2026-11-19, descent tree): Mac's page owns the layout, labels, box styling and the phone sheet. This layer only adds
// line-shape cues so relation levels differ by more than colour (hostile: tee at both ends; feuding: tee at the middle;
// alliance: round caps), in the line's own level colour, matching the legend swatches in atlas-map-ben.css.
// Legacy (v1 force map only, atlasMap.layout !== "tree"): box separation (deOverlap) and dot clearance (dotPass).
// Both are skipped for the tree. Removed in v2: label culling, node text-max-width and :parent overrides, cy "select" pan hook.
(() => {
  const LABEL_PX = 12.5, TITLE_PX = 14, WRAP_PX = 150, WRAP_PX_NARROW = 112, GAP_PX = 10, BOX_PAD = 16;
  let cy = null, hooked = false, busy = false, added = false, tree = true;
  const narrow = () => cy.width() < 560;
  const wrapPx = () => (narrow() ? WRAP_PX_NARROW : WRAP_PX);
  const font = () => getComputedStyle(document.documentElement).getPropertyValue("--f-ui").trim() || "system-ui, sans-serif";
  const ctx = document.createElement("canvas").getContext("2d");
  function textBox(text, px, maxW, bold) {   // on-screen size of a wrapped label, in px (legacy layout only)
    ctx.font = `${bold ? 600 : 400} ${px}px ${font()}`;
    const words = String(text || "").split(/\s+/); let line = "", w = 0, lines = 0;
    for (const wd of words) { const t = line ? line + " " + wd : wd;
      if (ctx.measureText(t).width > maxW && line) { w = Math.max(w, ctx.measureText(line).width); lines++; line = wd; } else line = t; }
    if (line) { w = Math.max(w, ctx.measureText(line).width); lines++; }
    return { w: Math.min(w, maxW), h: lines * px * 1.25 };
  }

  // ---------- legacy (v1 only): overlap removal ----------
  function leafRect(n, z, withLabel) {   // dot as drawn (Mac keeps main dots >= 18px on screen); label only if asked
    const p = n.position(), main = (n.hasClass("layer-coalition") || n.hasClass("layer-alignment")) && !n.hasClass("hist") && !n.hasClass("retired");
    const r = Math.max(n.data("size") || 20, (main ? 18 : 8) / z) / 2;
    const R = { x1: p.x - r, x2: p.x + r, y1: p.y - r, y2: p.y + r };
    if (withLabel && n.data("label")) { const t = textBox(n.data("label"), LABEL_PX, wrapPx(), false);
      R.x1 = Math.min(R.x1, p.x - t.w / 2 / z); R.x2 = Math.max(R.x2, p.x + t.w / 2 / z); R.y2 += (3 + t.h) / z; }
    return R;
  }
  function union(rs) { return rs.reduce((a, r) => ({ x1: Math.min(a.x1, r.x1), y1: Math.min(a.y1, r.y1), x2: Math.max(a.x2, r.x2), y2: Math.max(a.y2, r.y2) }),
    { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }); }
  function shift(n, dx, dy) { (n.isParent() ? n.descendants().filter(d => !d.isParent()) : n).forEach(l => { const p = l.position(); l.position({ x: p.x + dx, y: p.y + dy }); }); }
  let ASPECT = 1;   // >1 on wide canvases: prefer sideways pushes so the map fills the frame
  function separate(items, gap) {   // items: {n, r}; deterministic pairwise push along the smaller overlap axis
    items.sort((a, b) => (a.n.id() < b.n.id() ? -1 : 1));
    for (let it = 0; it < 300; it++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i].r, b = items[j].r;
        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap, oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const acx = (a.x1 + a.x2) / 2, bcx = (b.x1 + b.x2) / 2, acy = (a.y1 + a.y2) / 2, bcy = (b.y1 + b.y2) / 2;
        let dx = 0, dy = 0;
        if (ox < oy * ASPECT) dx = (bcx >= acx ? 1 : -1) * ox / 2; else dy = (bcy >= acy ? 1 : -1) * oy / 2;
        for (const [k, s] of [[i, -1], [j, 1]]) { const r = items[k].r; r.x1 += s * dx; r.x2 += s * dx; r.y1 += s * dy; r.y2 += s * dy; items[k].dx += s * dx; items[k].dy += s * dy; }
      }
      if (!moved) break;
    }
    for (const t of items) if (t.dx || t.dy) shift(t.n, t.dx, t.dy);
  }
  function rectOf(n, z) {   // full footprint of a node or a parent box (children + padding + title), model units
    if (!n.isParent()) return leafRect(n, z, n.parent().nonempty());   // inside a box: keep its own label clear too
    const kids = n.children().map(k => rectOf(k, z)), u = union(kids);
    u.x1 -= BOX_PAD; u.x2 += BOX_PAD; u.y1 -= BOX_PAD; u.y2 += BOX_PAD;
    const t = textBox(n.data("label"), TITLE_PX, wrapPx(), true), cx = (u.x1 + u.x2) / 2;
    if (n.hasClass("inbox")) u.y2 += (3 + t.h) / z; else u.y1 -= (3 + t.h) / z;
    u.x1 = Math.min(u.x1, cx - t.w / 2 / z); u.x2 = Math.max(u.x2, cx + t.w / 2 / z);
    return u;
  }
  function settle(n, z) {   // bottom-up: separate each box's children, then the box's siblings
    const kids = n ? n.children() : cy.nodes().orphans();
    kids.forEach(k => { if (k.isParent()) settle(k, z); });
    separate(kids.map(k => ({ n: k, r: rectOf(k, z), dx: 0, dy: 0 })), GAP_PX / z);
  }
  function fitZoom() {
    const bb = cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false }), pad = Math.min(60, cy.width() * 0.08);
    return Math.max(cy.minZoom(), Math.min(cy.maxZoom(), (cy.width() - 2 * pad) / Math.max(bb.w, 1), (cy.height() - 2 * pad) / Math.max(bb.h, 1)));
  }
  function deOverlap() {
    if (tree || !cy.nodes().length) return;
    const leaves = cy.nodes().filter(n => !n.isParent()), start = new Map(leaves.map(n => [n.id(), { ...n.position() }]));
    // Footprints are geometry (dots, box padding, box titles); leaf labels are not reserved, because labels keep a fixed
    // screen size and reserving room for them makes the layout grow without limit (zoom falls, labels grow, repeat).
    ASPECT = Math.max(0.6, Math.min(2.2, cy.width() / Math.max(cy.height(), 1)));
    const z0 = fitZoom(); settle(null, z0);
    const z1 = fitZoom();
    if (z1 < z0 * 0.8) { const z = Math.max(Math.sqrt(z0 * z1), z0 * 0.5); leaves.forEach(n => n.position(start.get(n.id()))); settle(null, z); }
  }
  function refit() {
    const bb = cy.nodes().boundingBox({ includeLabels: false, includeOverlays: false }), z = fitZoom();
    cy.viewport({ zoom: z, pan: { x: cy.width() / 2 - z * (bb.x1 + bb.w / 2), y: cy.height() / 2 - z * (bb.y1 + bb.h / 2) } });
  }

  // ---------- legacy (v1 only): dot clearance: minimum-size dots keep clear of boxes they are not in (after refit / zoom) ----------
  // Dots have a minimum on-screen size, so when the map zooms out they grow in model units and can touch a neighbouring box.
  // Bounded and drift-free: every pass starts again from the "home" positions set at the last rebuild, moves only offending
  // minimum-size dots (never their boxes, never anything else) by the smallest clear displacement for the current zoom, and
  // only reruns when zoom moved > 10% or the offending set changed. Same zoom in, same positions out.
  let home = null, dotZ = 0, dotKey = "", dotTimer = 0, moving = false;
  const MAIN = n => (n.hasClass("layer-coalition") || n.hasClass("layer-alignment")) && !n.hasClass("hist") && !n.hasClass("retired");
  const atMin = (n, z) => (MAIN(n) ? 18 : 8) / z >= (n.data("size") || 20) * 0.999;
  const bbOf = e => e.boundingBox({ includeLabels: false, includeOverlays: false });
  const hits = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  function setHome() { home = new Map(cy.nodes().filter(n => !n.isParent()).map(n => [n.id(), { ...n.position() }])); dotZ = 0; dotKey = ""; }
  function offenders(z, boxes) {
    return cy.nodes().filter(n => !n.isParent() && atMin(n, z)).filter(n => {
      const d = bbOf(n), anc = n.ancestors();
      return boxes.some(b => !anc.has(b.n) && hits(d, b.r));
    }).map(n => n.id()).sort();
  }
  function dotPass(force) {
    if (!cy || tree || busy || !home) return;
    const z = cy.zoom();
    const P = cy.nodes(":parent");
    if (!P.length) return;
    // zoom barely changed (<= 10%) and nothing touches at the current positions: keep them (no churn, no re-run)
    if (!force && dotZ && Math.abs(z - dotZ) / dotZ <= 0.1 && !offenders(z, P.map(b => ({ n: b, r: bbOf(b) }))).length) return;
    // offending set measured at home positions
    moving = true;
    cy.batch(() => home.forEach((p, id) => { const n = cy.getElementById(id); if (n.nonempty()) { const q = n.position(); if (q.x !== p.x || q.y !== p.y) n.position(p); } }));
    let boxes = P.map(b => ({ n: b, r: bbOf(b) }));
    const off = offenders(z, boxes), key = off.join("|");
    dotZ = z; dotKey = key;
    const gap = 3 / z;
    for (let round = 0; round < 4 && off.length; round++) {
      let movedAny = false;
      for (const id of off) {
        const n = cy.getElementById(id), anc = n.ancestors(), d = bbOf(n);
        const foreign = boxes.filter(b => !anc.has(b.n));
        const hit = foreign.filter(b => hits(d, b.r));
        if (!hit.length) continue;
        // candidate moves: clear every box it touches along one axis; prefer the smallest that lands clear of all foreign boxes
        const cands = [];
        const L = Math.max(...hit.map(b => d.x2 - b.r.x1)), R = Math.max(...hit.map(b => b.r.x2 - d.x1));
        const U = Math.max(...hit.map(b => d.y2 - b.r.y1)), D = Math.max(...hit.map(b => b.r.y2 - d.y1));
        cands.push([-(L + gap), 0], [R + gap, 0], [0, -(U + gap)], [0, D + gap]);
        const clear = ([dx, dy]) => !foreign.some(b => hits({ x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy }, b.r));
        cands.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        const mv = cands.find(clear) || cands[0];
        const p = n.position(); n.position({ x: p.x + mv[0], y: p.y + mv[1] }); movedAny = true;
      }
      if (!movedAny) break;
      boxes = P.map(b => ({ n: b, r: bbOf(b) }));   // a dot inside its own box may have grown that box
      const still = offenders(z, boxes); if (!still.length) break; off.splice(0, off.length, ...still);
    }
    moving = false;
  }
  // throttle, not debounce: cy "resize" can fire repeatedly (page reflow under the canvas) and a debounce would never run
  const scheduleDots = () => { if (dotTimer) return; dotTimer = setTimeout(() => { dotTimer = 0; dotPass(false); }, 160); };

  // ---------- relation line shapes (both layouts) ----------
  function addStyles() {
    cy.style()
      .selector("edge.rel-hostile").style({ "source-arrow-shape": "tee", "target-arrow-shape": "tee", "source-arrow-color": "data(col)", "target-arrow-color": "data(col)", "arrow-scale": 1.1 })
      .selector("edge.rel-feuding").style({ "mid-target-arrow-shape": "tee", "mid-target-arrow-color": "data(col)", "arrow-scale": 0.9 })
      .selector("edge.rel-alliance").style({ "line-cap": "round" })
      .update();
  }

  function afterRebuild() { if (tree) return; busy = true; try { deOverlap(); } finally { busy = false; } setHome(); scheduleDots(); }
  function hook(api, late) {
    if (hooked || !api || !api.cy) return; hooked = true; cy = api.cy;
    tree = api.layout === "tree";
    addStyles();
    if (!tree) {   // legacy force map: separate after every rebuild, clear dots after refit/zoom
      cy.on("add", () => { added = true; });
      const batch = cy.batch.bind(cy);
      cy.batch = fn => { added = false; const r = batch(fn); if (added) { added = false; afterRebuild(); } return r; };
      cy.on("viewport", () => { if (!moving) scheduleDots(); });
      cy.on("resize", scheduleDots);
      if (late) { afterRebuild(); refit(); }
    }
    window.atlasMapBen = { tree, deOverlap, dotPass, version: "2026-11-19-tree" };
  }
  document.addEventListener("atlasmap:init", e => hook(e.detail, false));
  document.addEventListener("atlasmap:ready", e => hook(e.detail, true));
  if (window.atlasMap && window.atlasMap.cy) hook(window.atlasMap, true);
})();
