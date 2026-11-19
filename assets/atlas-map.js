// Faction Atlas: interactive faction map (/map/), one view: the descent tree. ES module, no third-party requests.
// Data: map/graph.json (v2). Library: assets/vendor/cytoscape.min.js. The browser draws every box and line from the data.
// The drawing rules are a port of the layered faction chart: rows are generations (one below the deepest parent),
// columns are bands (left, center, outside, historical, the right), a faction's wings are packed inside its box in a
// compact grid, lines run with right-angle turns through the gaps between boxes (routed in the browser, see "line routing"),
// colours are the chart's branch colours.
const ROOT = document.getElementById("atlas-map");
const SITE = new URL(ROOT.dataset.root || "../", location.href);
const VENDOR = new URL("./vendor/", import.meta.url);
const LIBS = ["cytoscape.min.js"];
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const $ = (s, el = ROOT) => el.querySelector(s);
const $$ = (s, el = ROOT) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const status = $("#map-status");
const LAYER_WORD = { coalition: "Coalition", alignment: "Alignment", organization: "Organization", other: "Other" };
const SPEC_WORD = { left: "Left", "center-left": "Center-left", center: "Center", "center-right": "Center-right", right: "Right",
  outside_right: "Outside left, center and right", historical: "Pre-1900 camp", nonpolitical: "Non-political", none: "Not recorded" };
const LEVEL_WORD = { alliance: "Alliance", friendly: "Friendly", neutral: "Neutral", feuding: "Feuding", hostile: "Hostile" };
const LEVEL_COLOR = { alliance: "#2e7d32", friendly: "#43a047", neutral: "#8a8a8a", feuding: "#e67e22", hostile: "#c62828" };

// ---------- chart geometry (model units: chart units x 100) ----------
const BW = 120, BH = 70, PADX = 20, TH = 40, PADB = 20, VG = 28, HG = 28, UG = 60, GUT = 80, SIDEW = 320, BANDGAP = 40;
const BANDS = ["left", "center", "out", "hist", "right"];
const BAND_WORD = { left: "Left", center: "Center", out: "Outside left, center and right", hist: "Historical camps",
  right: "The right (a label for several movements, not one parent)" };
const ZONE_FILL = { left: "#c5d4e8", center: "#d5e4d0", out: "#d9d9d9", hist: "#d5cfc0", right: "#f4eedd" };
const CHART_BG = "#fbf6e9", SPC = "#c2189b", COQ = "#2b2b2b";

let G = null, byId = new Map(), cy = null, names = null;
const kidsT = new Map();      // tree children (expand and collapse): nodes whose tp is this node
const lparents = new Map();   // lineage parents over every link (primary, second, other, recorded ancestor)
const lkids = new Map();
let expanded = new Set(), defaultExpanded = new Set();
let sel = null;               // {kind: "node", id} | {kind: "edge", key} | {kind: "trace", a, b}
let relOn = new Set(), Z = 1, sortKey = "label", sortDir = 1, lastLayout = null;

function stateWord(n) { return n.hist ? "Historical" : n.prov ? "Active (provisional)" : "Active"; }
function pageUrl(n) { return new URL(n.url, SITE).href; }
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.async = false;
    s.onload = ok; s.onerror = () => bad(new Error("could not load " + src)); document.head.appendChild(s); });
}
function lum(hex) { const v = parseInt(hex.slice(1), 16); return (0.3 * (v >> 16) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255)) / 255; }
function shade(hex, k) { const v = parseInt(hex.slice(1), 16); const c = [v >> 16, (v >> 8) & 255, v & 255].map(x => Math.round(x * k));
  return "#" + c.map(x => x.toString(16).padStart(2, "0")).join(""); }
function wrap(text, width, maxLines) {   // chart nm(): drop parentheses, wrap at 17 characters, at most 3 lines
  // a word longer than a line breaks after its hyphens ("Democratic-" / "Republican")
  const t = String(text).replace(/\s*\(.*?\)/g, "").trim(), toks = [];
  for (const w of t.split(/\s+/)) {
    if (w.length > width && w.includes("-")) w.split(/(?<=-)/).forEach((p, k) => toks.push({ s: p, glue: k > 0 }));
    else toks.push({ s: w, glue: false });
  }
  const out = []; let line = "";
  for (const { s, glue } of toks) { const sep = glue ? "" : " ";
    if (line && (line + sep + s).length > width) { out.push(line); line = s; } else line = line ? line + sep + s : s; }
  if (line) out.push(line);
  return out.length > maxLines ? out.slice(0, maxLines).join("\n") + "…" : out.join("\n");
}
// font size that fits every line of a box label inside the box (very long single words shrink a little)
const FONT = 13, FONTMIN = 8.5, TEXTW = BW - 10;
let measureCtx = null, uiFont = null;
function labelWidth(label, n, fs) {
  if (!measureCtx) { measureCtx = document.createElement("canvas").getContext("2d");
    uiFont = getComputedStyle(document.documentElement).getPropertyValue("--f-ui").trim() || "system-ui, sans-serif"; }
  measureCtx.font = `${n.hist ? "italic " : ""}${n.row === 0 ? 700 : 400} ${fs}px ${uiFont}`;
  return Math.max(...label.split("\n").map(l => measureCtx.measureText(l).width));
}
function fitLabel(n, extra) {   // box label: wrap by measured width, break a long word after its hyphens, shrink only when needed
  const t = String(n.label).replace(/\s*\(.*?\)/g, "").trim();
  let out = null;
  for (let fs = FONT; fs >= FONTMIN && !out; fs -= 0.5) {
    const toks = [], lines = []; let line = "";
    for (const w of t.split(/\s+/)) {
      if (w.includes("-") && labelWidth(w, n, fs) > TEXTW) w.split(/(?<=-)/).forEach((p, k) => toks.push({ s: p, glue: k > 0 }));
      else toks.push({ s: w, glue: false });
    }
    for (const { s, glue } of toks) { const c = line ? line + (glue ? "" : " ") + s : s;
      if (line && labelWidth(c, n, fs) > TEXTW) { lines.push(line); line = s; } else line = c; }
    if (line) lines.push(line);
    const n2 = lines.length + (extra ? 1 : 0);
    const ok = lines.length <= (extra ? 3 : 4) && lines.every(l => labelWidth(l, n, fs) <= TEXTW) && n2 * 1.05 * fs <= BH - 8;
    if (ok || fs - 0.5 < FONTMIN) out = { text: lines.slice(0, extra ? 3 : 4).join("\n") + (lines.length > (extra ? 3 : 4) ? "…" : "") + (extra ? "\n" + extra : ""), fs };
  }
  return out;
}

// ---------- graph helpers ----------
const isLineage = e => e.type !== "relation";
function closure(id, map) { const seen = new Set(), st = [id]; while (st.length) for (const x of map.get(st.pop()) || []) if (!seen.has(x)) { seen.add(x); st.push(x); } return seen; }
const ancestorsOf = id => closure(id, lparents), descendantsOf = id => closure(id, lkids);
function treeSize(id) { let n = 0; for (const k of kidsT.get(id) || []) n += 1 + treeSize(k); return n; }
function edgeKey(e) { return e.type === "relation" ? `r|${e.s}|${e.t}|${e.level}` : `l|${e.s}|${e.t}`; }
function reveal(id) { for (let x = byId.get(id).tp; x; x = byId.get(x).tp) expanded.add(x); }

function visibleSet() {
  const V = new Set(), st = G.nodes.filter(n => !n.tp).map(n => n.id);
  while (st.length) { const x = st.pop(); V.add(x); if (expanded.has(x)) for (const k of kidsT.get(x) || []) st.push(k); }
  return V;
}

// ---------- layout (port of the chart's band, row, flow and box packing) ----------
function layout(V) {
  const aspect = cy ? Math.max(0.45, Math.min(2.4, cy.width() / Math.max(cy.height(), 1))) : 1.6;
  const nested = id => (kidsT.get(id) || []).filter(k => V.has(k) && byId.get(k).nest === id && expanded.has(id))
    .sort((a, b) => byId.get(a).ox - byId.get(b).ox || byId.get(a).label.localeCompare(byId.get(b).label));
  const SZ = new Map();
  function flow(items, lim, gap) {
    const L = [[]]; let w = 0;
    for (const it of items) { if (L[L.length - 1].length && w + gap + it.w > lim) { L.push([]); w = 0; } w += (L[L.length - 1].length ? gap : 0) + it.w; L[L.length - 1].push(it); }
    return L.filter(l => l.length);
  }
  function size(f, lim) {
    const ks = nested(f);
    if (!ks.length) { const s = { w: BW, h: BH }; SZ.set(f, s); return s; }
    const it = ks.map(g => ({ id: g, ...size(g, lim - 2 * PADX) }));
    const A = it.reduce((a, i) => a + (i.w + HG) * (i.h + VG), 0);
    const tw = Math.max(Math.max(...it.map(i => i.w)), BW * 1.6, Math.sqrt(A * 1.8));   // compact grid, about 1.8:1 (chart)
    const L = flow(it, Math.min(lim - 2 * PADX, tw), HG);
    const w = Math.max(BW * 1.6, Math.max(...L.map(l => l.reduce((a, i) => a + i.w, 0) + HG * (l.length - 1)))) + 2 * PADX;
    const h = TH + L.reduce((a, l) => a + Math.max(...l.map(i => i.h)), 0) + VG * (L.length - 1) + PADB;
    const s = { w, h, L }; SZ.set(f, s); return s;
  }
  const P = new Map(), BOX = new Map();
  function place(f, x0, yt) {
    const s = SZ.get(f);
    if (!s.L) { P.set(f, { x: x0 + BW / 2, y: yt + BH / 2 }); return; }
    BOX.set(f, { x0, yt, w: s.w, h: s.h });
    let yy = yt + TH;
    s.L.forEach((l, k) => {
      const lw = l.reduce((a, i) => a + i.w, 0) + HG * (l.length - 1); let xx = x0 + (s.w - lw) / 2; yy += k ? VG : 0;
      for (const i of l) { place(i.id, xx, yy); xx += i.w + HG; }
      yy += Math.max(...l.map(i => i.h));
    });
  }
  const tops = [...V].filter(id => !byId.get(id).nest || !V.has(byId.get(id).nest));
  const bandsUsed = BANDS.filter(b => tops.some(id => byId.get(id).band === b));
  // capacity of the right band: wide enough that the whole drawing roughly matches the canvas shape
  const rightTops = tops.filter(id => byId.get(id).band === "right");
  let area = 0; for (const id of rightTops) { const s = size(id, 1e9); area += (s.w + UG) * (s.h + GUT); }
  const maxW = Math.max(BW, ...rightTops.map(id => SZ.get(id).w));
  const sideW = bandsUsed.filter(b => b !== "right").length * (SIDEW + BANDGAP);
  // first guess from the area, then widen until the drawing's shape is close to the canvas shape (rows are fixed by
  // generation, so a tall drawing needs a wider right band, not more rows)
  // never wider than the widest generation laid out on one line
  const natural = Math.max(maxW, ...[...new Set(rightTops.map(id => byId.get(id).row))].map(r => {
    const ws = rightTops.filter(id => byId.get(id).row === r).map(id => SZ.get(id).w); return ws.reduce((a, w) => a + w, 0) + UG * (ws.length - 1); }));
  let CAP = Math.max(maxW, Math.min(natural, 6000, Math.sqrt(area * aspect)));
  for (let it = 0; it < 4; it++) {
    const H = passHeight(CAP);
    const want = Math.max(maxW, Math.min(natural, 6000, H * aspect - sideW - 2 * PADX));
    if (Math.abs(want - CAP) < 0.08 * CAP) break;
    CAP = want;
  }
  return pass(CAP);
  function passHeight(cap) { return pass(cap).bottom; }
  function pass(CAP) {
  P.clear(); BOX.clear();
  const X0 = {}; let x = 0;
  for (const b of bandsUsed) { X0[b] = x; x += (b === "right" ? CAP + 2 * PADX : SIDEW) + BANDGAP; }
  const rows = [...new Set(tops.map(id => byId.get(id).row))].sort((a, b) => a - b);
  const rowY = []; let y = 60;
  for (const r of rows) {
    const inRow = tops.filter(id => byId.get(id).row === r);
    let bottom = y + BH;
    for (const b of bandsUsed) {
      const ns = inRow.filter(id => byId.get(id).band === b).sort((p, q) => byId.get(p).ox - byId.get(q).ox || byId.get(p).label.localeCompare(byId.get(q).label));
      if (!ns.length) continue;
      if (b !== "right") {   // two-column grid inside a side band (chart _side)
        ns.forEach((id, k) => { size(id, SIDEW); const cx = X0[b] + SIDEW * (k % 2 ? 0.73 : 0.27), cyy = y + Math.floor(k / 2) * (BH + 26) + BH / 2;
          P.set(id, { x: cx, y: cyy }); bottom = Math.max(bottom, cyy + BH / 2); });
        continue;
      }
      const L = flow(ns.map(id => ({ id, ...size(id, CAP) })), CAP, UG); let yy = y;
      for (const l of L) {
        const lw = l.reduce((a, i) => a + i.w, 0) + UG * (l.length - 1);
        const g = l.length > 1 ? Math.min(80, (CAP - lw) / (l.length + 1)) : 0;
        let xx = X0.right + PADX + (CAP - lw - g * (l.length - 1)) / 2;
        for (const i of l) { place(i.id, xx, yy); xx += i.w + UG + g; }
        yy += Math.max(...l.map(i => i.h)) + 45;
      }
      bottom = Math.max(bottom, yy - 45);
    }
    rowY.push({ r, y }); y = bottom + GUT;
  }
  return { P: new Map(P), BOX: new Map(BOX), X0, CAP, bandsUsed, rowY, bottom: y, width: x - BANDGAP };
  }
}

// ---------- line routing: right-angle lines through the gaps between boxes ----------
// After packing, every line is routed on a grid made of the edges of all boxes (pushed out by CLR) and their centres.
// A line may cross only the boxes that hold its own two ends; it leaves its upper end from a port on a box side and
// enters the other end through a port, with a small search that penalises turns and stretches already used by
// another line. Lines from different parents that share a stretch then get their own lanes a few units apart.
// Routes are kept per layout, so selecting things does not move lines; every expand or collapse routes again.
const CLR = 10, LANE = 5, LANEMAX = 10, BEND = 30, PORTPEN = 60, HW = 1.3;   // HW: a slightly greedy search, near-shortest and much faster
let ROUTER = null;
function boxRects(V, Lt) {
  const R = new Map();
  for (const id of V) {
    const box = Lt.BOX.get(id), p = Lt.P.get(id);
    if (!box && !p) continue;
    const r = box ? { x1: box.x0, y1: box.yt, x2: box.x0 + box.w, y2: box.yt + box.h } : { x1: p.x - BW / 2, y1: p.y - BH / 2, x2: p.x + BW / 2, y2: p.y + BH / 2 };
    const n = byId.get(id);
    r.id = id; r.parent = n.nest && V.has(n.nest) && Lt.BOX.has(n.nest) ? n.nest : null;
    r.cx = (r.x1 + r.x2) / 2; r.cy = (r.y1 + r.y2) / 2;
    R.set(id, r);
  }
  return R;
}
function makeRouter(V, Lt) {
  const R = boxRects(V, Lt), list = [...R.values()], oi = new Map(list.map((r, i) => [r.id, i]));
  const anc = id => { const out = []; for (let p = R.get(id) && R.get(id).parent; p; p = R.get(p).parent) out.push(p); return out; };
  const depth = new Map(list.map(r => [r.id, anc(r.id).length]));
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  const xr = [], yr = [];
  for (const r of list) { xr.push(r.x1 - CLR, r.x2 + CLR, r.cx); yr.push(r.y1 - CLR, r.y2 + CLR, r.cy);
    mnx = Math.min(mnx, r.x1); mny = Math.min(mny, r.y1); mxx = Math.max(mxx, r.x2); mxy = Math.max(mxy, r.y2); }
  xr.push(mnx - 60, mxx + 60); yr.push(mny - 60, mxy + 60);
  const uniq = a => { a.sort((p, q) => p - q); const o = []; for (const v of a) if (!o.length || v - o[o.length - 1] > 0.5) o.push(v); return o; };
  const xs = uniq(xr), ys = uniq(yr), NX = xs.length, NY = ys.length, N = NX * NY;
  const near = (a, v) => { let lo = 0, hi = a.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(a[lo - 1] - v) < Math.abs(a[lo] - v) ? lo - 1 : lo; };
  // innermost box over each grid point and each grid step (boxes nest or keep 2 x CLR apart, so one id is enough)
  // where the margins of two neighbouring boxes overlap (they are not nested), the one painted first is kept in a second layer
  const hIn = new Int16Array(N).fill(-1), vIn = new Int16Array(N).fill(-1), pIn = new Int16Array(N).fill(-1);
  const hIn2 = new Int16Array(N).fill(-1), vIn2 = new Int16Array(N).fill(-1), pIn2 = new Int16Array(N).fill(-1);
  const order = list.map((r, i) => i).sort((a, b) => depth.get(list[a].id) - depth.get(list[b].id));
  const ancIdx = list.map(r => new Set(anc(r.id).map(a => oi.get(a))));
  const G4 = list.map(r => ({ i1: near(xs, r.x1 - CLR), i2: near(xs, r.x2 + CLR), j1: near(ys, r.y1 - CLR), j2: near(ys, r.y2 + CLR) }));
  const paint = (A, A2, k, o) => { const c = A[k]; if (c >= 0 && !ancIdx[o].has(c)) A2[k] = c; A[k] = o; };
  for (const o of order) { const { i1, i2, j1, j2 } = G4[o];
    for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) { const k = j * NX + i, inJ = j > j1 && j < j2, inI = i > i1 && i < i2;
      if (inJ && i < i2) paint(hIn, hIn2, k, o); if (inI && j < j2) paint(vIn, vIn2, k, o); if (inI && inJ) paint(pIn, pIn2, k, o); } }
  const S = 4 * N, gS = new Float64Array(S), stamp = new Int32Array(S), prev = new Int32Array(S), done = new Int32Array(S);
  let epoch = 0;
  const usedH = new Int32Array(N).fill(-1), usedV = new Int32Array(N).fill(-1);   // grid step -> bundle that already runs there
  const bundleNo = new Map(), goalAt = new Int32Array(N).fill(-1), goalPort = [];
  const allowed = new Uint8Array(list.length);
  // heap of states by f
  let hf = [], hs = [];
  function push(f, s) { let i = hf.length; hf.push(f); hs.push(s); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hs[i] = hs[p]; i = p; } hf[i] = f; hs[i] = s; }
  function pop() { const s = hs[0], lf = hf.pop(), ls = hs.pop(); const n = hf.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[i] = hf[c]; hs[i] = hs[c]; i = c; } hf[i] = lf; hs[i] = ls; } return s; }
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  function ports(id, pref) {   // pref: preferred side ("bottom", "top" or null for any); dir = direction of travel away from the box
    const r = R.get(id), P = [];
    const add = (x, y, dirOut, side) => { const i = near(xs, x), j = near(ys, y); P.push({ i, j, dirOut, pen: pref && pref !== side ? PORTPEN : 0 }); };
    add(r.cx, r.y2 + CLR, 2, "bottom"); add(r.cx, r.y1 - CLR, 3, "top"); add(r.x1 - CLR, r.cy, 1, "left"); add(r.x2 + CLR, r.cy, 0, "right");
    return P.filter(p => { const k = p.j * NX + p.i, o = pIn[k], o2 = pIn2[k]; return (o < 0 || allowed[o]) && (o2 < 0 || allowed[o2]); });
  }
  function search(sId, tId, kind, bundleKey, win) {
    if (!bundleNo.has(bundleKey)) bundleNo.set(bundleKey, bundleNo.size);
    const bundle = bundleNo.get(bundleKey);
    allowed.fill(0);
    for (const a of anc(sId).concat(anc(tId))) allowed[oi.get(a)] = 1;
    const SP = ports(sId, kind === "rel" ? null : "bottom"), TP = ports(tId, kind === "rel" ? null : "top");
    if (!SP.length || !TP.length) return null;
    for (const k of goalPort) goalAt[k] = -1; goalPort.length = 0;
    TP.forEach((p, q) => { const k = p.j * NX + p.i; if (goalAt[k] < 0 || TP[goalAt[k]].pen > p.pen) { if (goalAt[k] < 0) goalPort.push(k); goalAt[k] = q; } });
    let i0 = 0, i1 = NX - 1, j0 = 0, j1 = NY - 1;
    if (win) { const a = R.get(sId), b = R.get(tId);
      i0 = near(xs, Math.min(a.x1, b.x1) - win); i1 = near(xs, Math.max(a.x2, b.x2) + win); j0 = near(ys, Math.min(a.y1, b.y1) - win); j1 = near(ys, Math.max(a.y2, b.y2) + win); }
    const h = (i, j) => { let m = Infinity; for (const p of TP) { const dx = Math.abs(xs[i] - xs[p.i]), dy = Math.abs(ys[j] - ys[p.j]);
      m = Math.min(m, dx + dy + p.pen + (dx > 0.5 && dy > 0.5 ? BEND : 0)); } return m; };   // not lined up: at least one turn
    epoch++; hf = []; hs = [];
    for (const p of SP) { const s = (p.j * NX + p.i) * 4 + p.dirOut; if (stamp[s] === epoch && gS[s] <= p.pen) continue; stamp[s] = epoch; gS[s] = p.pen; prev[s] = -1; push(p.pen + HW * h(p.i, p.j), s); }
    let best = Infinity, bestS = -1;
    while (hf.length) {
      if (hf[0] >= best) break;
      const s = pop(); if (done[s] === epoch) continue; done[s] = epoch;
      const k = s >> 2, d = s & 3, i = k % NX, j = (k - i) / NX, g = gS[s];
      const gp = goalAt[k] >= 0 ? TP[goalAt[k]] : null;
      if (gp) { const dIn = gp.dirOut ^ 1, tot = g + gp.pen + (d === dIn ? 0 : BEND); if (tot < best) { best = tot; bestS = s; } }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d ^ 1)) continue;
        const ni = i + DX[nd], nj = j + DY[nd]; if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
        let o, len, uk;
        let o2;
        if (nd === 0) { uk = k; o = hIn[uk]; o2 = hIn2[uk]; len = xs[ni] - xs[i]; } else if (nd === 1) { uk = k - 1; o = hIn[uk]; o2 = hIn2[uk]; len = xs[i] - xs[ni]; }
        else if (nd === 2) { uk = k; o = vIn[uk]; o2 = vIn2[uk]; len = ys[nj] - ys[j]; } else { uk = k - NX; o = vIn[uk]; o2 = vIn2[uk]; len = ys[j] - ys[nj]; }
        if ((o >= 0 && !allowed[o]) || (o2 >= 0 && !allowed[o2])) continue;
        const u = (nd < 2 ? usedH : usedV)[uk];
        const ng = g + len + (nd === d ? 0 : BEND) + (u >= 0 && u !== bundle ? 0.3 * len + 4 : 0);
        const ns = ((nj * NX + ni) << 2) | nd;
        if (stamp[ns] === epoch && gS[ns] <= ng) continue;
        stamp[ns] = epoch; gS[ns] = ng; prev[ns] = s; push(ng + HW * h(ni, nj), ns);
      }
    }
    if (bestS < 0) return null;
    const cells = []; for (let s = bestS; s >= 0; s = prev[s]) cells.push(s >> 2);
    cells.reverse();
    for (let q = 0; q < cells.length - 1; q++) { const a = cells[q], b = cells[q + 1];
      if (Math.abs(a - b) === 1) usedH[Math.min(a, b)] = bundle; else usedV[Math.min(a, b)] = bundle; }
    const pts = cells.map(k => ({ x: xs[k % NX], y: ys[Math.floor(k / NX)] }));
    const out = [pts[0]];
    for (let q = 1; q < pts.length - 1; q++) { const a = out[out.length - 1], b = pts[q], c = pts[q + 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue; out.push(b); }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    return out;
  }
  function route(sId, tId, kind, bundle) {
    if (!R.has(sId) || !R.has(tId) || sId === tId) return null;
    const a = R.get(sId), b = R.get(tId);
    const win = Math.max(300, 0.25 * (Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)));
    const pts = search(sId, tId, kind, bundle, win) || search(sId, tId, kind, bundle, 0);
    return pts && { pts, raw: pts, s: sId, t: tId, bundle, allow: new Set(anc(sId).concat(anc(tId))) };
  }
  // foreign boxes a polyline enters (inset by `inset`)
  function crossing(pts, allow, s, t, inset = 1) {
    const hit = [];
    for (const r of list) {
      if (allow.has(r.id) || r.id === s || r.id === t) continue;
      if (anc(r.id).includes(s) || anc(r.id).includes(t)) continue;
      for (let q = 0; q < pts.length - 1; q++) { const a = pts[q], b = pts[q + 1];
        if (Math.max(a.x, b.x) > r.x1 + inset && Math.min(a.x, b.x) < r.x2 - inset && Math.max(a.y, b.y) > r.y1 + inset && Math.min(a.y, b.y) < r.y2 - inset) { hit.push(r.id); break; } }
    }
    return hit;
  }
  // lanes: stretches shared by lines from different bundles get offsets
  function lanes(routes) {
    const segs = new Map();
    routes.forEach((rt, ri) => { for (let q = 0; q < rt.pts.length - 1; q++) { const a = rt.pts[q], b = rt.pts[q + 1], H = a.y === b.y;
      const key = (H ? "h" : "v") + (H ? a.y : a.x).toFixed(1);
      if (!segs.has(key)) segs.set(key, []);
      segs.get(key).push({ ri, q, lo: H ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: H ? Math.max(a.x, b.x) : Math.max(a.y, b.y), H, bundle: rt.bundle }); } });
    const off = routes.map(rt => new Array(rt.pts.length - 1).fill(0));
    for (const list of segs.values()) {
      list.sort((p, q) => p.lo - q.lo);
      let cl = [], hi = -Infinity;
      const flush = () => {
        const bs = [...new Set(cl.map(c => c.bundle))]; if (bs.length > 1) {
          const mid = b => { const m = cl.filter(c => c.bundle === b); return m.reduce((a, c) => a + c.lo + c.hi, 0) / m.length; };
          bs.sort((p, q) => mid(p) - mid(q) || String(p).localeCompare(String(q)));
          const sp = Math.min(LANE, (2 * LANEMAX) / (bs.length - 1));
          for (const c of cl) off[c.ri][c.q] = (bs.indexOf(c.bundle) - (bs.length - 1) / 2) * sp;
        }
        cl = []; hi = -Infinity; };
      for (const s of list) { if (cl.length && s.lo >= hi - 1) flush(); cl.push(s); hi = Math.max(hi, s.hi); }
      if (cl.length) flush();
    }
    routes.forEach((rt, ri) => {
      const o = off[ri]; if (!o.some(Boolean)) return;
      const p = rt.pts.map(q => ({ ...q }));
      for (let q = 0; q < o.length; q++) { if (!o[q]) continue; const H = rt.pts[q].y === rt.pts[q + 1].y;
        for (const k of [q, q + 1]) { if (H) p[k].y = rt.pts[q].y + o[q]; else p[k].x = rt.pts[q].x + o[q]; } }
      // ports must stay on their box side
      const okPort = (pt, id) => { const r = R.get(id); return (pt.x > r.x1 + 6 && pt.x < r.x2 - 6) || (pt.y > r.y1 + 6 && pt.y < r.y2 - 6); };
      if (okPort(p[0], rt.s) && okPort(p[p.length - 1], rt.t) && !crossing(p, rt.allow, rt.s, rt.t, -5).length) rt.pts = p;   // keep 5 units clear of box borders
    });
  }
  return { route, lanes, crossing, R, NX, NY };
}
// segment weights and distances (cytoscape "segments", edge-distances node-position) for absolute waypoints
function segData(pts, S, T, flip) {
  const vx = T.x - S.x, vy = T.y - S.y, L2 = vx * vx + vy * vy, L = Math.sqrt(L2); if (L < 1e-6) return null;
  const nx = -vy / L, ny = vx / L, w = [], d = [];
  for (const p of pts) { const dx = p.x - S.x, dy = p.y - S.y, t = (dx * vx + dy * vy) / L2; w.push(+t.toFixed(5)); d.push(+((dx * nx + dy * ny) * (flip ? -1 : 1)).toFixed(3)); }
  return { sw: w.join(" "), sd: d.join(" ") };
}
function touch(p, r) {   // where a line meets its box: the port moved back onto the box side, relative to the box centre
  const x = p.y > r.y2 ? p.x : p.y < r.y1 ? p.x : p.x < r.x1 ? r.x1 : r.x2, y = p.y > r.y2 ? r.y2 : p.y < r.y1 ? r.y1 : p.y;
  return `${(x - r.cx).toFixed(2)} ${(y - r.cy).toFixed(2)}`;
}
function routeAll(V, Lt, lineageEdges, relEdges) {
  const key = [...V].sort().join(",") + "|" + Math.round(Lt.CAP) + "|" + Math.round(Lt.bottom);
  if (!ROUTER || ROUTER.key !== key) {
    const T0 = performance.now(), r = makeRouter(V, Lt), routes = new Map(), T1 = performance.now();
    const order = lineageEdges.slice().sort((a, b) => (a.cls.includes("ln-primary") ? 0 : 1) - (b.cls.includes("ln-primary") ? 0 : 1));
    const list = [];
    for (const e of order) { const rt = r.route(e.source, e.target, "ln", e.source); if (rt) { routes.set(e.id, rt); list.push(rt); } }
    r.lanes(list);
    const bad = list.filter(rt => r.crossing(rt.pts, rt.allow, rt.s, rt.t, 1).length).length;
    ROUTER = { key, r, routes, rel: new Map(), stats: { nx: r.NX, ny: r.NY, grid_ms: Math.round(T1 - T0), route_ms: Math.round(performance.now() - T1), crossing: bad } };
  }
  for (const e of relEdges) if (!ROUTER.rel.has(e.id)) {
    const rt = ROUTER.r.route(e.source, e.target, "rel", e.id);
    ROUTER.rel.set(e.id, rt);
  }
  return id => ROUTER.routes.get(id) || ROUTER.rel.get(id) || null;
}

// ---------- elements ----------
function nodeLabel(n) {
  return fitLabel(n, !expanded.has(n.id) && (kidsT.get(n.id) || []).length ? `+ ${treeSize(n.id)}` : "");
}
function relRep(id, V) { let x = id; while (x && !V.has(x)) x = byId.get(x).tp; return x; }
function elements(V, Lt) {
  const els = [];
  // bands (zones) and their headings, drawn behind everything and never tappable
  const top = 0, h = Lt.bottom + 40;
  for (const b of Lt.bandsUsed) {
    const w = b === "right" ? Lt.CAP + 2 * PADX : SIDEW;
    els.push({ group: "nodes", data: { id: "zone-" + b, label: BAND_WORD[b], w, h, fill: ZONE_FILL[b] }, position: { x: Lt.X0[b] + w / 2, y: top + h / 2 - 40 }, classes: "zone" });
  }
  for (const { r, y } of Lt.rowY) {
    const word = r === 0 ? "Root movements" : r === 1 ? "Children" : r === 2 ? "Grandchildren" : `Generation ${r + 1}`;
    const x0 = (Lt.X0.right ?? Lt.X0[Lt.bandsUsed[0]]) + 10;
    els.push({ group: "nodes", data: { id: "row-" + r, label: word }, position: { x: x0 + 70, y: y - 22 }, classes: "rowlabel" });
  }
  for (const id of V) {
    const n = byId.get(id), box = Lt.BOX.get(id);
    const cls = ["fac", `layer-${n.layer}`, `band-${n.band}`]; if (n.hist) cls.push("hist"); if (n.prov) cls.push("prov");
    if (n.row === 0) cls.push("root");
    const d = { id, col: n.col, ink: n.hist ? "#444" : (lum(n.band === "out" ? "#e6e6e6" : n.col) < 0.5 ? "#fff" : "#111"),
      fill: n.hist ? "#d1d1d1" : n.band === "out" ? "#e6e6e6" : n.col, edge: shade(n.col, 0.8) };
    if (n.nest && V.has(n.nest) && Lt.BOX.has(n.nest)) d.parent = n.nest;
    if (box) {
      d.label = wrap(n.label, 60, 1); d.fs = FONT;
      els.push({ group: "nodes", data: d, classes: cls.concat("box").join(" ") });
      els.push({ group: "nodes", data: { id: "frame-" + id, parent: id, w: box.w, h: box.h }, position: { x: box.x0 + box.w / 2, y: box.yt + box.h / 2 }, classes: "frame" });
    } else {
      const L = nodeLabel(n); d.label = L.text; d.fs = L.fs;
      els.push({ group: "nodes", data: d, position: Lt.P.get(id), classes: cls.join(" ") });
    }
  }
  const LE = [], RE = [];
  for (const e of G.edges) {
    if (!isLineage(e) || !V.has(e.s) || !V.has(e.t)) continue;
    const c = byId.get(e.s);
    if (c.nest === e.t && Lt.BOX.has(e.t)) continue;   // the box already shows it
    const cls = ["ln"];
    if (e.type === "ancestor") cls.push("ln-ancestor");
    else if (c.coeq && e.type !== "ancestor") cls.push("ln-coeq");
    else if (e.type === "parent") cls.push("ln-primary");
    else cls.push("ln-second");
    if (e.link === "wing") cls.push("ln-wing");
    LE.push({ id: edgeKey(e), source: e.t, target: e.s, col: c.col, cls });
  }
  const selRel = sel && sel.kind === "node" ? sel.id : null;
  for (const e of G.edges) {
    if (e.type !== "relation") continue;
    const mine = selRel && (e.s === selRel || e.t === selRel);
    if (!relOn.has(e.level) && !mine && !(sel && sel.kind === "edge" && sel.key === edgeKey(e)) && !(sel && sel.kind === "edges" && sel.keys.includes(edgeKey(e)))) continue;
    const a = relRep(e.s, V), b = relRep(e.t, V); if (!a || !b || a === b) continue;
    const cls = ["rel", `rel-${e.level}`]; if (a !== e.s || b !== e.t) cls.push("rel-via");
    RE.push({ id: edgeKey(e), source: a, target: b, col: LEVEL_COLOR[e.level] || "#888", cls });
  }
  const get = routeAll(V, Lt, LE, RE), R = ROUTER.r.R;
  for (const e of LE.concat(RE)) {
    const rt = get(e.id), d = { id: e.id, source: e.source, target: e.target, col: e.col };
    const sd = rt && segData(rt.pts, { x: R.get(e.source).cx, y: R.get(e.source).cy }, { x: R.get(e.target).cx, y: R.get(e.target).cy }, false);
    if (sd) { Object.assign(d, sd); d.p0 = rt.pts[0]; d.se = touch(rt.pts[0], R.get(e.source)); d.te = touch(rt.pts[rt.pts.length - 1], R.get(e.target)); e.cls.push("routed"); }
    else e.cls.push("unrouted");
    els.push({ group: "edges", data: d, classes: e.cls.join(" ") });
  }
  return els;
}

function styles() {
  const font = getComputedStyle(document.documentElement).getPropertyValue("--f-ui").trim() || "system-ui, sans-serif";
  const px = (m, minPx) => () => Math.max(m, minPx / Z);   // model width, but never thinner than minPx on screen
  return [
    { selector: "node", style: { "font-family": font, "events": "yes" } },
    { selector: "node.zone", style: { shape: "rectangle", width: "data(w)", height: "data(h)", "background-color": "data(fill)", "background-opacity": 0.7,
      "border-width": 0, label: "data(label)", "text-valign": "top", "text-halign": "center", "text-margin-y": 34, "font-size": 15, "font-weight": 700,
      color: "#555", "text-wrap": "wrap", "text-max-width": "data(w)", events: "no", "z-compound-depth": "bottom", "z-index": 0 } },
    { selector: "node.rowlabel", style: { shape: "rectangle", width: 1, height: 1, "background-opacity": 0, label: "data(label)", "font-size": 12,
      "font-style": "italic", color: "#777", "text-valign": "center", "text-halign": "right", events: "no", "z-index": 1 } },
    { selector: "node.fac", style: { shape: "round-rectangle", width: BW, height: BH, "background-color": "data(fill)", label: "data(label)",
      color: "data(ink)", "font-size": "data(fs)", "text-valign": "center", "text-halign": "center", "text-wrap": "wrap", "text-max-width": BW - 4,
      "line-height": 1.05, "border-width": 0.7, "border-color": "#333", "z-index": 20, "min-zoomed-font-size": 4 } },
    { selector: "node.fac.root", style: { "font-weight": 700 } },
    { selector: "node.fac.hist", style: { "font-style": "italic" } },
    { selector: "node.fac.prov", style: { "border-style": "dashed", "border-width": 1.6, "border-color": "#222" } },
    { selector: "node.box", style: { shape: "round-rectangle", "background-color": "data(col)", "background-opacity": 0.13, "border-width": 2.2,
      "border-color": "data(col)", color: "data(edge)", "font-weight": 700, "font-size": 13, "text-valign": "top", "text-halign": "center",
      "text-margin-y": 26, "text-wrap": "ellipsis", "text-max-width": e => (e.children(".frame").data("w") || 200) - 16, padding: 0,
      "compound-sizing-wrt-labels": "exclude", "z-index": 10 } },
    { selector: "node.box.prov", style: { "border-style": "dashed", "border-width": 2.2, "border-color": "data(col)" } },
    { selector: "node.frame", style: { shape: "rectangle", width: "data(w)", height: "data(h)", "background-opacity": 0, "border-width": 0, label: "", events: "no" } },
    { selector: "edge", style: { "curve-style": "taxi", "taxi-direction": "vertical", "taxi-turn": "50%", "taxi-turn-min-distance": 12,
      width: px(2.4, 1.2), "line-color": "data(col)", opacity: 0.85, "z-index": 15, "target-arrow-shape": "none" } },
    { selector: "edge.ln-primary", style: { width: px(3, 1.4) } },
    { selector: "edge.ln-wing", style: { width: px(1.5, 1), opacity: 0.6, "line-style": "dashed", "line-dash-pattern": [8, 4] } },
    { selector: "edge.ln-second", style: { "line-color": SPC, width: px(2, 1.2), "line-style": "dashed", "line-dash-pattern": [10, 4, 2, 4], opacity: 0.85 } },
    { selector: "edge.ln-coeq", style: { "line-color": COQ, width: px(3.2, 1.5), opacity: 0.95 } },
    { selector: "edge.ln-ancestor", style: { "line-color": "#3b3a35", width: px(2.4, 1.2), "line-style": "dotted", opacity: 0.9 } },
    { selector: "edge.rel", style: { "curve-style": "unbundled-bezier", "control-point-distances": [-80], "control-point-weights": [0.5],
      "line-color": "data(col)", width: px(3, 1.4), opacity: 0.8, "z-index": 16 } },
    { selector: "edge.rel-alliance", style: { width: px(5, 2.2) } },
    { selector: "edge.rel-neutral", style: { "line-style": "dotted" } },
    { selector: "edge.rel-feuding", style: { "line-style": "dashed", "line-dash-pattern": [8, 5] } },
    { selector: "edge.rel-hostile", style: { width: px(5, 2.2), "line-style": "dashed", "line-dash-pattern": [16, 6] } },
    { selector: "edge.rel-via", style: { opacity: 0.5 } },
    { selector: "edge.routed", style: { "curve-style": "segments", "edge-distances": "node-position", "segment-weights": e => e.data("sw"), "segment-distances": e => e.data("sd"), "source-endpoint": e => e.data("se"), "target-endpoint": e => e.data("te") } },
    // highlighting
    { selector: ".faded", style: { opacity: 0.16 } },
    { selector: "node.box.faded", style: { opacity: 1, "background-opacity": 0.04, "border-opacity": 0.25, "text-opacity": 0.3 } },
    { selector: "node.hl", style: { "underlay-color": "#ffbf00", "underlay-opacity": 0.55, "underlay-padding": 7, "underlay-shape": "round-rectangle" } },
    { selector: "node.pick", style: { "border-width": 4, "border-color": "#000", "border-style": "double", "underlay-color": "#ff8f00", "underlay-opacity": 0.8, "underlay-padding": 10 } },
    { selector: "node.box.hl", style: { "border-width": 6, "underlay-opacity": 0 } },
    { selector: "node.box.pick", style: { "border-color": "#ff8f00", "border-style": "solid", "underlay-opacity": 0 } },
    { selector: "edge.hl", style: { opacity: 1, width: px(6, 3), "z-index": 30, "underlay-color": "#ffbf00", "underlay-opacity": 0.6, "underlay-padding": 5 } },
    { selector: "edge.hover", style: { opacity: 1, width: px(6, 3), "z-index": 31, "underlay-color": "#4fc3f7", "underlay-opacity": 0.6, "underlay-padding": 5 } },
  ];
}

// ---------- render ----------
function render({ fit = false, keep = null } = {}) {
  const V = visibleSet();
  const Lt = layout(V); lastLayout = Lt;
  let anchor = null;
  if (keep && cy.getElementById(keep).nonempty()) anchor = { id: keep, r: { ...cy.getElementById(keep).renderedPosition() } };
  cy.batch(() => { cy.elements().remove(); cy.add(elements(V, Lt)); });
  // cytoscape measures segment distances from one end or the other depending on the pair; check each line once
  const flip = cy.edges(".routed").filter(e => { const sp = e.segmentPoints(), w = e.data("p0"); return sp && sp.length && Math.hypot(sp[0].x - w.x, sp[0].y - w.y) > 1; });
  cy.batch(() => flip.forEach(e => e.data("sd", e.data("sd").split(" ").map(v => -v).join(" "))));
  applyHighlight();
  if (fit) doFit(cy.nodes(".fac"));
  else if (anchor && cy.getElementById(anchor.id).nonempty()) { const r = cy.getElementById(anchor.id).renderedPosition(); cy.panBy({ x: anchor.r.x - r.x, y: anchor.r.y - r.y }); }
  renderTable(); announce();
}
function fitView(eles, padPx) {
  const pad = padPx ?? Math.min(40, cy.width() * 0.05);
  const bb = eles.boundingBox({ includeLabels: false, includeOverlays: false });
  const w = Math.max(bb.w, 1), h = Math.max(bb.h, 1);
  const zoom = Math.max(cy.minZoom(), Math.min(1.6, Math.min((cy.width() - 2 * pad) / w, (cy.height() - 2 * pad) / h)));
  return { zoom, pan: { x: cy.width() / 2 - zoom * (bb.x1 + w / 2), y: cy.height() / 2 - zoom * (bb.y1 + h / 2) } };
}
function doFit(eles) { if (!eles || eles.empty()) return; const v = fitView(eles); if (REDUCED.matches) cy.viewport(v); else cy.animate({ zoom: v.zoom, pan: v.pan, duration: 350 }); }
function announce() {
  const n = cy.nodes(".fac").length, e = cy.edges().length;
  let extra = "";
  if (sel && sel.kind === "node") extra = ` Showing the line of descent of ${byId.get(sel.id).label}.`;
  if (sel && sel.kind === "trace") extra = " " + (sel.msg || "");
  if (sel && sel.kind === "edge") extra = " One line selected.";
  if (sel && sel.kind === "edges") extra = ` ${sel.keys.length} lines selected.`;
  status.textContent = `Showing ${n} of ${G.nodes.length} factions and ${e} lines.${extra}`;
}

// ---------- highlighting ----------
let HL = { nodes: new Set(), edges: new Set(), pick: new Set() };
function lineageEdgesWithin(set, test) {
  const out = new Set();
  for (const e of G.edges) if (isLineage(e) && set.has(e.s) && set.has(e.t) && (!test || test(e))) out.add(edgeKey(e));
  return out;
}
function computeHighlight() {
  HL = { nodes: new Set(), edges: new Set(), pick: new Set() };
  if (!sel) return;
  if (sel.kind === "node") {
    const id = sel.id, A = ancestorsOf(id), D = descendantsOf(id);
    const up = new Set([id, ...A]), down = new Set([id, ...D]);
    HL.nodes = new Set([...up, ...down]); HL.pick.add(id);
    HL.edges = new Set([...lineageEdgesWithin(up), ...lineageEdgesWithin(down)]);
    for (const e of G.edges) if (e.type === "relation" && (e.s === id || e.t === id)) { HL.edges.add(edgeKey(e)); HL.nodes.add(e.s === id ? e.t : e.s); }
  } else if (sel.kind === "edge") {
    const e = G.edges.find(x => edgeKey(x) === sel.key); if (!e) return;
    HL.edges.add(sel.key); HL.nodes = new Set([e.s, e.t]); HL.pick = new Set([e.s, e.t]);
  } else if (sel.kind === "edges") {
    for (const k of sel.keys) { const e = G.edges.find(x => edgeKey(x) === k); if (!e) continue; HL.edges.add(k); HL.nodes.add(e.s); HL.nodes.add(e.t); }
  } else if (sel.kind === "trace") {
    HL.nodes = new Set(sel.nodes); HL.edges = new Set(sel.edges); HL.pick = new Set([sel.a, sel.b]);
  }
}
function applyHighlight() {
  cy.batch(() => {
    cy.elements().removeClass("faded hl pick");
    if (!sel) return;
    cy.elements(".fac, edge").forEach(el => {
      const id = el.id();
      if (el.isNode()) {
        if (HL.pick.has(id)) el.addClass("pick hl"); else if (HL.nodes.has(id)) el.addClass("hl"); else el.addClass("faded");
      } else if (HL.edges.has(id)) el.addClass("hl"); else el.addClass("faded");
    });
  });
}

// ---------- descent path between two factions ----------
function trace(a, b) {
  const between = (x, y) => {   // y descends from x: every faction on some line from x down to y
    const D = descendantsOf(x); if (!D.has(y)) return null;
    const A = ancestorsOf(y), set = new Set([x, y]); for (const n of D) if (A.has(n)) set.add(n);
    return set;
  };
  let set = between(a, b), msg;
  const la = byId.get(a).label, lb = byId.get(b).label;
  if (set) msg = `${lb} descends from ${la}.`;
  else if ((set = between(b, a))) msg = `${la} descends from ${lb}.`;
  if (set) return { nodes: set, edges: lineageEdgesWithin(set), msg };
  const Aa = new Set([a, ...ancestorsOf(a)]), Ab = new Set([b, ...ancestorsOf(b)]);
  const common = [...Aa].filter(x => Ab.has(x));
  const low = common.filter(c => !common.some(o => o !== c && ancestorsOf(o).has(c)));
  if (!low.length) return { nodes: new Set([a, b]), edges: new Set(), msg: `No line of descent joins ${la} and ${lb}, and they share no recorded ancestor.` };
  const nodes = new Set(), edges = new Set();
  for (const c of low) for (const x of [a, b]) { const s = between(c, x) || new Set([c]); s.forEach(n => nodes.add(n)); lineageEdgesWithin(s).forEach(k => edges.add(k)); }
  return { nodes, edges, low, msg: `Neither descends from the other. Nearest shared ancestor${low.length > 1 ? "s" : ""}: ${low.map(c => byId.get(c).label).join(", ")}.` };
}
function runTrace(a, b) {
  if (!byId.has(a) || !byId.has(b) || a === b) { status.textContent = "Pick two different factions to trace."; return; }
  const r = trace(a, b);
  sel = { kind: "trace", a, b, nodes: [...r.nodes], edges: [...r.edges], msg: r.msg };
  for (const n of r.nodes) reveal(n);
  computeHighlight(); render(); doFit(cy.nodes(".fac").filter(n => r.nodes.has(n.id())));
  openTracePanel(r, a, b);
  $("#trace-a").value = byId.get(a).label; $("#trace-b").value = byId.get(b).label;
}

// ---------- panel ----------
function btn(id, text) { return `<button type="button" class="map-link" data-go="${esc(id)}">${esc(text ?? byId.get(id).label)}</button>`; }
const EDGE_WORD = e => e.type === "relation" ? `${LEVEL_WORD[e.level] || e.level} relation`
  : e.type === "ancestor" ? "Recorded ancestor (descent)"
  : (e.type === "parent" ? "Primary parent" : e.type === "second_parent" ? "Second parent" : "Also under") + (e.link ? ` · ${e.link}` : "") + (e.anc ? " · recorded ancestor" : "");
function edgeSentence(e) {
  const s = byId.get(e.s).label, t = byId.get(e.t).label;
  if (e.type === "relation") return `${s} and ${t}: ${LEVEL_WORD[e.level] || e.level}.`;
  if (e.type === "ancestor") return `${t} is a recorded ancestor of ${s}.`;
  return `${s} sits under ${t}` + (e.link === "wing" ? " as a wing." : e.link === "descent" ? " by descent." : ".");
}
const NARROW = window.matchMedia("(max-width: 760px)");
const SHEET_MIN_MAP = 300;   // phone sheet: keep at least this much screen above it on short screens
function capSheet() {        // inline cap so a short phone keeps map above the bottom sheet (overrides the 55vh/60vh stylesheet caps only when lower)
  const p = $("#map-panel"); if (!p) return;
  if (!NARROW.matches) { p.style.maxHeight = ""; return; }
  const H = window.innerHeight, cap = Math.round(Math.max(200, Math.min(0.6 * H, H - SHEET_MIN_MAP)));
  p.style.maxHeight = cap < 0.6 * H - 1 ? cap + "px" : "";
}
window.addEventListener("resize", () => { const p = $("#map-panel"); if (p && !p.hidden) capSheet(); });
function setPanel(html) { const p = $("#map-panel"); p.innerHTML = `<button type="button" class="map-close" data-act="close" aria-label="Close details">×</button>` + html; capSheet(); p.hidden = false; }
function openPanel(id) {
  const n = byId.get(id);
  const A = ancestorsOf(id), D = descendantsOf(id), V = visibleSet();
  const hiddenD = [...D].filter(x => !V.has(x)).length;
  const parents = G.edges.filter(e => e.s === id && isLineage(e));
  const kids = (kidsT.get(id) || []).slice().sort((a, b) => byId.get(a).label.localeCompare(byId.get(b).label));
  const rels = G.edges.filter(e => e.type === "relation" && (e.s === id || e.t === id));
  const bits = [`<p class="kind">${esc(LAYER_WORD[n.layer])} · ${esc(stateWord(n))}</p>`, `<h2 id="map-panel-h">${esc(n.label)}</h2>`];
  const dl = [["Members", `${n.members.toLocaleString()} home` + (n.branch ? ` · ${n.branch.toLocaleString()} in branch` : "")]];
  if (n.era) dl.push(["Era", esc(n.era)]);
  dl.push(["Line", `${A.size} ancestor${A.size === 1 ? "" : "s"} · ${D.size} descendant${D.size === 1 ? "" : "s"}` + (hiddenD ? ` (${hiddenD} in closed branches)` : "")]);
  bits.push("<dl>" + dl.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") + "</dl>");
  if (parents.length) bits.push("<h3>Parents</h3><ul class=\"plain\">" + parents.map(e => `<li>${btn(e.t)} <span class="b-none">${esc(EDGE_WORD(e))}</span></li>`).join("") + "</ul>");
  if (kids.length) bits.push(`<h3>Beneath it (${kids.length})</h3><ul class="plain">` + kids.slice(0, 12).map(k => `<li>${btn(k)}</li>`).join("") +
    (kids.length > 12 ? `<li class="b-none">and ${kids.length - 12} more on the faction page</li>` : "") + "</ul>");
  if (rels.length) bits.push("<h3>Relations</h3><ul class=\"plain\">" + rels.map(e => { const o = e.s === id ? e.t : e.s;
    return `<li><span class="map-swatch rel-${esc(e.level)}" aria-hidden="true"></span> ${esc(LEVEL_WORD[e.level] || e.level)}: ${btn(o)}</li>`; }).join("") + "</ul>");
  const acts = [];
  if (kids.length) acts.push(`<button type="button" data-act="toggle" data-id="${esc(id)}">${expanded.has(id) ? "Close its branch" : "Open its branch"}</button>`);
  if (hiddenD) acts.push(`<button type="button" data-act="alldesc" data-id="${esc(id)}">Show every descendant</button>`);
  acts.push(`<button type="button" data-act="fitline">Fit the whole line</button>`);
  acts.push(`<button type="button" data-act="tracefrom" data-id="${esc(id)}">Trace a line from here</button>`);
  acts.push(`<a class="map-page-link" href="${esc(pageUrl(n))}">Open faction page</a>`);
  bits.push(`<p class="map-panel-acts">${acts.join(" ")}</p>`);
  setPanel(bits.join(""));
}
function openEdgePanel(e) {
  const via = cy.getElementById(edgeKey(e)).hasClass("rel-via");
  setPanel(`<p class="kind">Line</p><h2 id="map-panel-h">${esc(EDGE_WORD(e))}</h2><p>${esc(edgeSentence(e))}</p>` +
    (via ? `<p class="b-none">One end is in a closed branch, so the line is drawn to the box that holds it.</p>` : "") +
    `<ul class="plain"><li>${btn(e.s)}</li><li>${btn(e.t)}</li></ul>`);
}
function openTracePanel(r, a, b) {
  const steps = [...r.nodes].map(x => byId.get(x)).sort((p, q) => p.row - q.row || p.label.localeCompare(q.label));
  setPanel(`<p class="kind">Line of descent</p><h2 id="map-panel-h">${esc(byId.get(a).label)} and ${esc(byId.get(b).label)}</h2><p>${esc(r.msg)}</p>` +
    `<h3>On the line (${steps.length}), oldest generation first</h3><ol>` + steps.map(n => `<li>${btn(n.id)}</li>`).join("") + "</ol>" +
    `<p class="map-panel-acts"><button type="button" data-act="untrace">Clear</button></p>`);
}
function closePanel() { $("#map-panel").hidden = true; sel = null; computeHighlight(); applyHighlight(); announce(); }

function selectNode(id, { center = true, focusPanel = false } = {}) {
  if (!byId.has(id)) return;
  sel = { kind: "node", id };
  reveal(id); for (const a of ancestorsOf(id)) reveal(a);
  for (const e of G.edges) if (e.type === "relation" && (e.s === id || e.t === id)) { reveal(e.s); reveal(e.t); }
  computeHighlight(); render({ keep: center ? null : id });
  openPanel(id);
  const el = cy.getElementById(id); if (el.nonempty()) showClear(el, center);
  if (focusPanel) $("#map-panel").focus();
  document.dispatchEvent(new CustomEvent("atlasmap:select", { detail: { id } }));
}
function selectEdges(keys) {
  sel = { kind: "edges", keys }; computeHighlight(); render({ keep: null });
  const es = keys.map(k => G.edges.find(x => edgeKey(x) === k)).filter(Boolean);
  setPanel(`<p class="kind">Lines</p><h2 id="map-panel-h">${es.length} lines run here</h2><p class="b-none">They share this stretch of the drawing. Pick one.</p><ul class="plain">` +
    es.map(e => `<li><button type="button" class="map-link" data-edge="${esc(edgeKey(e))}">${esc(EDGE_WORD(e))}: ${esc(byId.get(e.s).label)} – ${esc(byId.get(e.t).label)}</button></li>`).join("") + "</ul>");
}
function selectEdge(key) {
  const e = G.edges.find(x => edgeKey(x) === key); if (!e) return;
  sel = { kind: "edge", key }; computeHighlight(); render({ keep: e.s }); openEdgePanel(e);
}
function showClear(el, center) {   // pan so the picked box is clear of the side panel or the phone's bottom sheet
  const panel = $("#map-panel"), wide = !NARROW.matches;
  let C = cy.container().getBoundingClientRect();
  if (!panel.hidden && !wide) {
    // phone: if only a sliver of map shows above the sheet, bring the canvas to the top of the screen first
    const top = () => panel.getBoundingClientRect().top;
    if (Math.min(C.bottom, top()) - Math.max(C.top, 0) < 140) {
      window.scrollTo({ top: window.scrollY + C.top - 8, behavior: "instant" });
      C = cy.container().getBoundingClientRect();
    }
  }
  const M = 12;
  let R = { x1: 0, x2: cy.width(), y1: 0, y2: cy.height() };
  if (!panel.hidden) {
    const pr = panel.getBoundingClientRect();
    if (wide) R.x2 = Math.max(80, pr.left - C.left - M);
    else { R.y1 = Math.max(0, -C.top) + M; R.y2 = Math.min(cy.height(), pr.top - C.top) - M; }
  }
  const box = () => el.renderedBoundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
  let b = box();
  const inside = b.x1 >= R.x1 && b.x2 <= R.x2 && b.y1 >= R.y1 && b.y2 <= R.y2;
  if (!center && inside) return;
  if (Z < 0.8 && center) { cy.zoom({ level: 1, renderedPosition: el.renderedPosition() }); b = box(); }
  const pan = cy.pan(), cx = (b.x1 + b.x2) / 2, cyy = (b.y1 + b.y2) / 2;
  const dy = b.h > R.y2 - R.y1 ? R.y1 - b.y1 : (R.y1 + R.y2) / 2 - cyy;   // taller than the gap: keep its top in view
  const to = { x: pan.x + (R.x1 + R.x2) / 2 - cx, y: pan.y + dy };
  if (REDUCED.matches) cy.pan(to); else cy.animate({ pan: to, duration: 300 });
}

// ---------- table ----------
function renderTable() {
  if ($("#map-bands") && cy) bandButtons();
  const rows = cy.nodes(".fac").map(n => byId.get(n.id()));
  const key = { label: n => n.label.toLowerCase(), layer: n => n.layer, state: n => stateWord(n), parent: n => n.parent ? byId.get(n.parent).label.toLowerCase() : "",
    members: n => n.members, branch: n => n.branch }[sortKey];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.label.localeCompare(b.label)) * sortDir; });
  $("#map-tbody").innerHTML = rows.map(n => `<tr><th scope="row"><a href="${esc(pageUrl(n))}">${esc(n.label)}</a></th><td>${esc(LAYER_WORD[n.layer])}</td>` +
    `<td>${esc(stateWord(n))}</td><td>${n.parent ? esc(byId.get(n.parent).label) : "—"}</td><td>${n.members.toLocaleString()}</td>` +
    `<td>${n.branch.toLocaleString()}</td><td><button type="button" data-show="${esc(n.id)}" aria-label="Show ${esc(n.label)} on the map">Show on map</button></td></tr>`).join("");
  $("#map-table-note").textContent = `${rows.length} of ${G.nodes.length} factions, the ones now open on the map. "Expand all" lists every faction.`;
  $$("th button[data-sort]").forEach(b => b.closest("th").setAttribute("aria-sort", b.dataset.sort === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"));
}

// ---------- search ----------
function searchIndex() {
  const recs = [];
  if (names) for (const r of names) {
    if (r.k !== "faction") continue;
    const m = /\/faction\/([^/]+)\//.exec(r.u || ""); if (!m || !byId.has(m[1])) continue;
    recs.push({ id: m[1], t: r.t, keys: [r.t, ...(r.a || [])].map(s => s.toLowerCase()) });
  }
  const seen = new Set(recs.map(r => r.id));
  for (const n of G.nodes) if (!seen.has(n.id)) recs.push({ id: n.id, t: n.label, keys: [n.label.toLowerCase()] });
  return recs;
}
let SEARCH = [], active = -1;
function findOne(q) {
  q = q.trim().toLowerCase(); if (!q) return null;
  const exact = G.nodes.find(n => n.label.toLowerCase() === q); if (exact) return exact.id;
  const hit = SEARCH.find(r => r.keys.some(k => k === q)) || SEARCH.find(r => r.keys.some(k => k.startsWith(q))) || SEARCH.find(r => r.keys.some(k => k.includes(q)));
  return hit ? hit.id : null;
}
function runSearch(q) {
  const list = $("#map-q-results"); q = q.trim().toLowerCase(); active = -1;
  if (q.length < 2) { list.hidden = true; list.innerHTML = ""; $("#map-q").setAttribute("aria-expanded", "false"); return; }
  const hits = SEARCH.map(r => { let s = 9; for (const k of r.keys) { if (k === q) s = Math.min(s, 0); else if (k.startsWith(q)) s = Math.min(s, 1);
      else if (k.includes(" " + q)) s = Math.min(s, 2); else if (k.includes(q)) s = Math.min(s, 3); } return [s, r]; })
    .filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].t.localeCompare(b[1].t)).slice(0, 8).map(([, r]) => r);
  list.innerHTML = hits.length ? hits.map((r, i) => { const n = byId.get(r.id);
    return `<li role="option" id="map-opt-${i}" data-go="${esc(r.id)}" aria-selected="false">${esc(r.t)} <span class="b-none">${esc(LAYER_WORD[n.layer])}${n.hist ? ", historical" : ""}</span></li>`; }).join("")
    : `<li class="b-none" aria-disabled="true">No faction matches</li>`;
  list.hidden = false; $("#map-q").setAttribute("aria-expanded", "true");
}
function moveActive(d) {
  const opts = $$("#map-q-results li[data-go]"); if (!opts.length) return;
  active = (active + d + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute("aria-selected", i === active ? "true" : "false"));
  $("#map-q").setAttribute("aria-activedescendant", opts[active].id);
}
function pick(id) { $("#map-q-results").hidden = true; $("#map-q").setAttribute("aria-expanded", "false"); selectNode(id, { focusPanel: true }); }

// ---------- events ----------
function toggle(id) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render({ keep: id }); if (sel && sel.kind === "node" && sel.id === id) openPanel(id); }
function wire() {
  $$('input[name="rel"]').forEach(i => i.addEventListener("change", () => {
    relOn = new Set($$('input[name="rel"]').filter(x => x.checked).map(x => x.value)); render({ keep: null }); }));
  ROOT.addEventListener("click", ev => {
    const t = ev.target.closest("[data-act],[data-go],[data-show],[data-sort],[data-edge],[data-band]"); if (!t) return;
    if (t.dataset.band) { const b = t.dataset.band; if (b === "right") { const c = cy.nodes(".fac.band-right.layer-coalition"); viewAt(c.nonempty() ? c : cy.nodes(".fac.band-right"), { top: true }); } else viewAt(cy.nodes(`.fac.band-${b}`), { top: true }); return; }
    if (t.dataset.edge) { selectEdge(t.dataset.edge); return; }
    if (t.dataset.go) { if (t.closest("#map-q-results")) pick(t.dataset.go); else selectNode(t.dataset.go, { focusPanel: true }); return; }
    if (t.dataset.show) { selectNode(t.dataset.show); $("#map-canvas").scrollIntoView({ block: "center", behavior: REDUCED.matches ? "auto" : "smooth" }); $("#map-panel").focus({ preventScroll: true }); return; }
    if (t.dataset.sort) { sortDir = sortKey === t.dataset.sort ? -sortDir : 1; sortKey = t.dataset.sort; renderTable(); return; }
    const a = t.dataset.act;
    if (a === "close") closePanel();
    else if (a === "fit") doFit(cy.nodes(".fac"));
    else if (a === "reset") { sel = null; expanded = new Set(defaultExpanded); $("#map-panel").hidden = true; computeHighlight(); render(); openingView(); }
    else if (a === "expandall") { for (const n of G.nodes) if ((kidsT.get(n.id) || []).length) expanded.add(n.id); render({ fit: true }); }
    else if (a === "toggle") toggle(t.dataset.id);
    else if (a === "fitline") doFit(cy.nodes(".fac").filter(n => HL.nodes.has(n.id())));
    else if (a === "alldesc") { const id = t.dataset.id; for (const d of [id, ...descendantsOf(id)]) { reveal(d); } for (const d of descendantsOf(id)) if ((kidsT.get(d) || []).length) expanded.add(d); expanded.add(id); render({ keep: id }); openPanel(id); }
    else if (a === "tracefrom") { $("#trace-a").value = byId.get(t.dataset.id).label; $("#trace-b").value = ""; $("#trace-b").focus(); status.textContent = `Tracing from ${byId.get(t.dataset.id).label}: pick the second faction in "To", or tap it on the map.`; traceFrom = t.dataset.id; }
    else if (a === "trace") { const x = findOne($("#trace-a").value), y = findOne($("#trace-b").value); if (x && y) runTrace(x, y); else status.textContent = "Could not find both factions to trace."; }
    else if (a === "untrace") { traceFrom = null; $("#trace-a").value = ""; $("#trace-b").value = ""; closePanel(); }
  });
  const q = $("#map-q");
  q.addEventListener("input", () => runSearch(q.value));
  q.addEventListener("keydown", ev => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); moveActive(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); moveActive(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); const o = $$("#map-q-results li[data-go]"); if (o.length) pick(o[Math.max(0, active)].dataset.go); }
    else if (ev.key === "Escape") { $("#map-q-results").hidden = true; }
  });
  for (const id of ["#trace-a", "#trace-b"]) $(id).addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); $('[data-act="trace"]').click(); } });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !$("#map-panel").hidden) closePanel(); });
}
let traceFrom = null;

// nearest line or box to a tap on empty canvas (thin lines are hard to hit with a finger)
function polyDist(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
function edgePoints(e) {
  const s = e.renderedSourceEndpoint(), t = e.renderedTargetEndpoint(); let mid = [];
  try {
    if (e.hasClass("rel")) { const c = e.renderedControlPoints() || []; if (c.length) { const q = c[0], pts = [];
      for (let k = 0; k <= 12; k++) { const u = k / 12; pts.push({ x: (1 - u) ** 2 * s.x + 2 * (1 - u) * u * q.x + u * u * t.x, y: (1 - u) ** 2 * s.y + 2 * (1 - u) * u * q.y + u * u * t.y }); } return pts; } }
    else mid = e.renderedSegmentPoints() || [];
  } catch (_) { mid = []; }
  return [s, ...mid, t];
}
function edgesAt(p, maxPx) {   // every line within reach; lines that share a trunk come back together
  const hits = []; cy.edges().forEach(e => { const d = polyDist(p, edgePoints(e)); if (d < maxPx) hits.push([d, e]); });
  if (!hits.length) return [];
  const best = Math.min(...hits.map(h => h[0]));
  return hits.filter(h => h[0] <= best + 2).sort((a, b) => a[0] - b[0]).map(h => h[1].id());
}
function leafAt(p) {   // the faction box (not a group box) under a model point
  const hit = cy.nodes(".fac").filter(n => { if (n.isParent()) return false; const b = n.boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
    return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2; });
  return hit.nonempty() ? hit.first() : null;
}
function tapLines(keys) { if (keys.length === 1) selectEdge(keys[0]); else if (keys.length) selectEdges(keys); }
function nearestEdge(p, maxPx) {
  let best = null, bd = maxPx;
  cy.edges().forEach(e => { const d = polyDist(p, edgePoints(e)); if (d < bd) { bd = d; best = e; } });
  return best;
}
const tip = $("#map-tip");
function showTip(e, p) {
  const d = G.edges.find(x => edgeKey(x) === e.id()); if (!d) return;
  tip.innerHTML = `<strong>${esc(EDGE_WORD(d))}</strong><br>${esc(edgeSentence(d))}`;
  tip.hidden = false; tip.style.left = Math.min(p.x + 14, cy.width() - 240) + "px"; tip.style.top = (p.y + 14) + "px";
}
function wireCy() {
  const tapNode = id => { if (traceFrom && traceFrom !== id) { const a = traceFrom; traceFrom = null; runTrace(a, id); return; } selectNode(id, { center: false }); };
  cy.on("tap", "node.fac", ev => {
    const id = ev.target.id();
    if (ev.target.isParent()) { const ks = edgesAt(ev.renderedPosition, 7); if (ks.length) { tapLines(ks); return; } }   // a line inside a group box
    tapNode(id);
  });
  cy.on("dbltap", "node.fac", ev => toggle(ev.target.id()));
  // a tap inside a faction box always means the faction, even when a line's tap area reaches over it
  cy.on("tap", "edge", ev => { const f = leafAt(ev.position); if (f) { tapNode(f.id()); return; }
    const ks = edgesAt(ev.renderedPosition, 6); tapLines(ks.length ? ks : [ev.target.id()]); });   // the nearest line wins (lanes are close)
  cy.on("tap", ev => {
    if (ev.target !== cy) return;
    const f = leafAt(ev.position); if (f) { tapNode(f.id()); return; }
    const ks = edgesAt(ev.renderedPosition, 14);
    if (ks.length) tapLines(ks); else if (sel) closePanel();
  });
  cy.on("mouseover", "edge", ev => { ev.target.addClass("hover"); showTip(ev.target, ev.renderedPosition); });
  cy.on("mousemove", "edge", ev => showTip(ev.target, ev.renderedPosition));
  cy.on("mouseout", "edge", ev => { ev.target.removeClass("hover"); tip.hidden = true; });
  let hovered = null;   // lines that cross a box: hover by distance, since the box is under the pointer
  cy.on("mousemove", "node.fac", ev => {
    if (!ev.target.isParent()) return;
    const e = nearestEdge(ev.renderedPosition, 6);
    if (hovered && (!e || e.id() !== hovered.id())) { hovered.removeClass("hover"); tip.hidden = true; hovered = null; }
    if (e) { hovered = e; e.addClass("hover"); showTip(e, ev.renderedPosition); }
  });
  cy.on("mouseout", "node.fac", () => { if (hovered) { hovered.removeClass("hover"); tip.hidden = true; hovered = null; } });
  cy.container().addEventListener("mouseleave", () => { tip.hidden = true; cy.edges(".hover").removeClass("hover"); hovered = null; });
  let raf = 0;
  cy.on("zoom", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { raf = 0; Z = cy.zoom(); cy.style().update(); }); });
}

// ---------- readable views: the opening view and the column jumps ----------
const READ_Z = () => (cy.width() < 560 ? 0.8 : 0.9);   // box labels about 10-12 px on screen
function viewAt(eles, { top = false } = {}) {   // readable zoom, centred on eles (or their top part when they are taller than the canvas)
  if (!eles || eles.empty()) return;
  const bb = eles.boundingBox({ includeLabels: false, includeOverlays: false });
  const fitZ = Math.min((cy.width() - 40) / Math.max(bb.w, 1), (cy.height() - 40) / Math.max(bb.h, 1));
  const z = Math.max(READ_Z(), Math.min(1.2, fitZ));
  const cx = bb.x1 + bb.w / 2, cyy = top && bb.h * z > cy.height() - 40 ? bb.y1 + (cy.height() / 2 - 30) / z : bb.y1 + bb.h / 2;
  const v = { zoom: z, pan: { x: cy.width() / 2 - z * cx, y: cy.height() / 2 - z * cyy } };
  if (REDUCED.matches || !cy.nodes().length) cy.viewport(v); else cy.animate({ zoom: v.zoom, pan: v.pan, duration: 350 });
  Z = cy.zoom();
}
function openingView() {
  // The right band, where most factions are: the window of rows (one canvas tall at reading zoom) that holds the most
  // living factions, centred on them. Panning or the column buttons reach the rest.
  const z = READ_Z(), winH = (cy.height() - 60) / z, winW = (cy.width() - 40) / z;
  const live = cy.nodes(".fac.band-right").filter(n => !n.hasClass("hist"));
  const pts = live.map(n => n.position()).sort((a, b) => a.y - b.y);
  let best = 0, bi = 0;
  for (let i = 0, j = 0; i < pts.length; i++) { while (pts[j].y < pts[i].y - winH) j++; if (i - j + 1 > best) { best = i - j + 1; bi = i; } }
  const yb = pts.length ? pts[bi].y : 0, inWin = pts.filter(p => p.y <= yb && p.y >= yb - winH);
  const xs = inWin.map(p => p.x).sort((a, b) => a - b), xm = xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  const ym = inWin.length ? (Math.min(...inWin.map(p => p.y)) + yb) / 2 : 0;
  cy.viewport({ zoom: z, pan: { x: cy.width() / 2 - z * xm, y: cy.height() / 2 - z * ym } }); Z = z; cy.style().update();
}
function bandButtons() {
  const used = BANDS.filter(b => cy.nodes(`.fac.band-${b}`).nonempty());
  const word = { left: "Left", center: "Center", out: "Outside", hist: "Historical", right: "The right" };
  $("#map-bands").innerHTML = `<span class="b-none">Jump to:</span> ` + used.map(b => `<button type="button" data-band="${b}">${word[b]}</button>`).join(" ");
}

// ---------- start ----------
async function start() {
  wire();
  try { const r = await fetch(new URL(ROOT.dataset.graph, location.href)); G = await r.json(); }
  catch (e) { status.textContent = "The map data could not be loaded."; return; }
  G.nodes.forEach(n => byId.set(n.id, n));
  for (const n of G.nodes) if (n.tp) { if (!kidsT.has(n.tp)) kidsT.set(n.tp, []); kidsT.get(n.tp).push(n.id); }
  for (const e of G.edges) if (isLineage(e)) {
    if (!lparents.has(e.s)) lparents.set(e.s, new Set()); lparents.get(e.s).add(e.t);
    if (!lkids.has(e.t)) lkids.set(e.t, new Set()); lkids.get(e.t).add(e.s);
  }
  // opening view: the roots, with every branch open down to the coalitions (each coalition visible, its own branch closed)
  for (const n of G.nodes) if (n.layer === "coalition") for (let x = n.tp; x; x = byId.get(x).tp) defaultExpanded.add(x);
  expanded = new Set(defaultExpanded);
  $("#trace-names").innerHTML = G.nodes.map(n => `<option value="${esc(n.label)}"></option>`).join("");
  fetch(new URL("assets/names.json", SITE)).then(r => r.ok ? r.json() : null).catch(() => null)
    .then(d => { names = Array.isArray(d) ? d : null; SEARCH = searchIndex(); });
  SEARCH = searchIndex();
  try { for (const l of LIBS) await loadScript(new URL(l, VENDOR).href); }
  catch (e) { if (!window.cytoscape) { status.textContent = "The interactive map could not be loaded in this browser."; return; } }
  try { await document.fonts.ready; } catch (_) {}   // label sizes are measured with the page font
  $("#map-canvas").style.background = CHART_BG;
  cy = window.cytoscape({ container: $("#map-canvas"), elements: [], style: styles(), layout: { name: "preset" },
    minZoom: 0.02, maxZoom: 3, wheelSensitivity: 0.3, boxSelectionEnabled: false, autoungrabify: true, autounselectify: true });
  window.atlasMap = { cy, graph: G, version: 2, layout: "tree", selectNode, selectEdge, trace: runTrace, render,
    expand: id => { expanded.add(id); render({ keep: id }); }, collapse: id => { expanded.delete(id); render({ keep: id }); },
    visible: () => [...visibleSet()], edgeKey, routeStats: () => ROUTER && ROUTER.stats, routeOf: id => ROUTER && (ROUTER.routes.get(id) || ROUTER.rel.get(id)) || null,
    // every faction's box label, closed and open, at the size it is drawn: [id, label, font px, widest line px, box text width]
    labelCheck: () => G.nodes.flatMap(n => [false, true].filter(p => !p || (kidsT.get(n.id) || []).length).map(p => {
      const L = fitLabel(n, p ? `+ ${treeSize(n.id)}` : ""), t = L.text, fs = L.fs;
      return [n.id, t, fs, +labelWidth(t, n, fs).toFixed(1), TEXTW, +(t.split("\n").length * 1.05 * fs).toFixed(1), BH]; }) ) };
  document.dispatchEvent(new CustomEvent("atlasmap:init", { detail: window.atlasMap }));
  wireCy();
  render({ fit: false });
  openingView(); bandButtons();
  const qs = new URLSearchParams(location.search);
  if (qs.get("expand") === "all") $('[data-act="expandall"]').click();
  for (const id of (qs.get("open") || "").split(",").filter(x => byId.has(x))) { reveal(id); expanded.add(id); }
  if (qs.get("open")) { render(); const ids = new Set(qs.get("open").split(",").flatMap(id => [id, ...(kidsT.get(id) || [])])); doFit(cy.nodes(".fac").filter(n => ids.has(n.id()))); }
  for (const l of (qs.get("rel") || "").split(",").filter(Boolean)) { const i = $(`input[name="rel"][value="${CSS.escape(l)}"]`); if (i) { i.checked = true; relOn.add(l); } }
  if (qs.get("rel")) render();
  if (qs.get("from") && qs.get("to")) runTrace(qs.get("from"), qs.get("to"));
  else if (qs.get("f") && byId.has(qs.get("f"))) { selectNode(qs.get("f")); if (qs.get("fit") === "line") setTimeout(() => $('[data-act="fitline"]').click(), 400);
    if (qs.get("fit") === "rel") setTimeout(() => doFit(cy.getElementById(qs.get("f")).union(cy.edges(".rel").connectedNodes())), 400); }
  else if (qs.get("e")) { const [s, t] = qs.get("e").split("~"); const e = G.edges.find(x => x.s === s && x.t === t && isLineage(x)) || G.edges.find(x => x.s === s && x.t === t);
    if (e) { reveal(s); reveal(t); render(); selectEdge(edgeKey(e)); doFit(cy.getElementById(edgeKey(e)).connectedNodes().union(cy.getElementById(edgeKey(e)))); } }
  document.dispatchEvent(new CustomEvent("atlasmap:ready", { detail: window.atlasMap }));
}
start();
