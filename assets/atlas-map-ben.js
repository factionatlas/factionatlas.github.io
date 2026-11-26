// Faction Atlas map chrome — Ben overlay (2026-11-25).
// Theme-following toolbar, search, buttons, panel, legend and table styles
// live in atlas-map-ben.css. This script adds pinch zoom, double-tap zoom
// on empty canvas, and on-map +/- buttons, and makes post-1900 defunct
// factions visibly distinct from live ones.
//
// Why this lives here: Mac's atlas-map.js turns off Cytoscape panning so a
// drag on a faction box still pans, then treats a second finger as "cancel
// the drag". Combined with touch-action:none on the canvas, a pinch never
// zooms the map and the page cannot zoom either. Future Mac change: handle
// two-finger pinch in wireCy() instead of clearing the drag, and keep the
// node double-tap as "open or close this branch".

const STEP = 1.4;
const TAP_MS = 320;
const TAP_PX = 28;
let attached = false;

function clampZoom(cy, z) {
  return Math.max(cy.minZoom(), Math.min(cy.maxZoom(), z));
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function zoomTo(cy, level, renderedPosition) {
  const z = clampZoom(cy, level);
  if (reducedMotion()) cy.zoom({ level: z, renderedPosition });
  else cy.animate({ zoom: { level: z, renderedPosition }, duration: 180 });
}


function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function parseColor(c) {
  if (!c) return null;
  c = String(c).trim();
  if (c[0] === "#") {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = c.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

function rgbToHex({ r, g, b }) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// Wash a branch colour toward the canvas and desaturate it so a defunct
// box stays in its column but no longer looks like a living faction.
function wash(hex) {
  const paper = parseColor(token("--map-canvas", "#FBF8F2")) || { r: 251, g: 248, b: 242 };
  const src = parseColor(hex) || parseColor(token("--map-defunct-fill", "#B9B3A8")) || { r: 185, g: 179, b: 168 };
  const faded = mix(src, paper, 0.58);
  const gray = (faded.r + faded.g + faded.b) / 3;
  return rgbToHex(mix(faded, { r: gray, g: gray, b: gray }, 0.42));
}

function inkFor(hex) {
  const c = parseColor(hex) || { r: 180, g: 180, b: 180 };
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum < 0.45 ? token("--map-hist-ink", "#E9E4D8") : token("--text", "#1E2A2F");
}

function hatchUri(stroke) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke="${stroke}" stroke-width="1.3" opacity="0.45"/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function borderW(cy, minModel, minPx, maxModel) {
  return () => {
    const z = Math.max(cy.zoom(), 0.05);
    return Math.min(maxModel, Math.max(minModel, minPx / z));
  };
}

function applyDefunctStyle(cy) {
  const sheet = cy.style();
  const border = token("--map-defunct-border", token("--retired-fg", "#3B3A35"));
  const hatch = hatchUri(border);
  const fillOf = ele => wash(ele.data("fill") || ele.data("col") || token("--map-defunct-fill", "#B9B3A8"));
  sheet
    .selector("node.fac.defunct")
    .style({
      "background-color": fillOf,
      "background-image": hatch,
      "background-repeat": "repeat",
      "background-clip": "node",
      "background-width": 8,
      "background-height": 8,
      "background-image-opacity": 0.55,
      "background-opacity": 1,
      color: ele => inkFor(fillOf(ele)),
      "font-style": "italic",
      "text-opacity": 0.95,
      "border-style": "dotted",
      "border-width": borderW(cy, 2.2, 2.4, 7),
      "border-color": border,
      "border-opacity": 1,
    })
    .selector("node.box.defunct")
    .style({
      "background-color": ele => wash(ele.data("col") || token("--map-defunct-fill", "#B9B3A8")),
      "background-opacity": 0.28,
      "background-image": hatch,
      "background-repeat": "repeat",
      "background-clip": "node",
      "background-width": 8,
      "background-height": 8,
      "background-image-opacity": 0.4,
      "font-style": "italic",
      color: token("--muted", "#4F5B5F"),
      "border-style": "dotted",
      "border-width": borderW(cy, 2.6, 2.8, 8),
      "border-color": border,
      "border-opacity": 1,
    })
    .update();
}

function hookDefunctStyle(cy) {
  if (cy.scratch("_benDefunctHook")) return;
  cy.scratch("_benDefunctHook", true);
  const raw = cy.style.bind(cy);
  cy.style = function (...args) {
    const s = raw(...args);
    if (s && typeof s.fromJson === "function" && !s._benDefunct) {
      const orig = s.fromJson.bind(s);
      s.fromJson = function (json) {
        const ret = orig(json);
        applyDefunctStyle(cy);
        return ret;
      };
      s._benDefunct = true;
    }
    return s;
  };
}

function enhanceLegend() {
  const list = document.querySelector(".map-legend .map-legend-list");
  if (!list || list.querySelector(".map-box-defunct")) return;
  const li = document.createElement("li");
  li.innerHTML = '<span class="map-box map-box-defunct" aria-hidden="true"></span> Defunct: a movement that has ended, drawn in a muted, hatched colour with an italic name and a dotted outline';
  const first = list.querySelector("li");
  if (first && first.nextSibling) list.insertBefore(li, first.nextSibling);
  else list.appendChild(li);
}

function attach(api) {
  if (attached || !api || !api.cy) return;
  const cy = api.cy;
  const host = cy.container();
  if (!host) return;
  attached = true;

  const pts = new Map();
  let pinch = null;

  function modelAt(clientX, clientY) {
    const r = host.getBoundingClientRect();
    const pan = cy.pan(), z = cy.zoom();
    return { x: (clientX - r.left - pan.x) / z, y: (clientY - r.top - pan.y) / z };
  }
  function applyPinch(clientX, clientY, z) {
    if (!pinch) return;
    const r = host.getBoundingClientRect();
    const level = clampZoom(cy, z);
    cy.viewport({
      zoom: level,
      pan: {
        x: clientX - r.left - level * pinch.model.x,
        y: clientY - r.top - level * pinch.model.y,
      },
    });
  }
  function begin(from, dist, midX, midY) {
    if (pinch) return;
    pinch = { from, dist: dist || 1, zoom: cy.zoom(), model: modelAt(midX, midY) };
    for (const id of pts.keys()) {
      try { if (host.hasPointerCapture?.(id)) host.releasePointerCapture(id); } catch (_) {}
    }
  }
  function update(from, dist, midX, midY) {
    if (!pinch || pinch.from !== from) return;
    applyPinch(midX, midY, pinch.zoom * (dist / pinch.dist));
  }
  function end(from) {
    if (pinch && pinch.from === from) pinch = null;
  }

  host.addEventListener("pointerdown", ev => {
    if (ev.pointerType === "mouse") return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      begin("pointer", Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2, (a.y + b.y) / 2);
      ev.preventDefault();
    }
  }, { capture: true });
  host.addEventListener("pointermove", ev => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size >= 2 && pinch && pinch.from === "pointer") {
      const [a, b] = [...pts.values()];
      update("pointer", Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2, (a.y + b.y) / 2);
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, { capture: true });
  function endPtr(ev) {
    pts.delete(ev.pointerId);
    if (pts.size < 2) end("pointer");
  }
  host.addEventListener("pointerup", endPtr, { capture: true });
  host.addEventListener("pointercancel", endPtr, { capture: true });

  host.addEventListener("touchstart", ev => {
    if (ev.touches.length < 2) return;
    ev.preventDefault();
    const a = ev.touches[0], b = ev.touches[1];
    begin("touch", Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  }, { capture: true, passive: false });
  host.addEventListener("touchmove", ev => {
    if (ev.touches.length < 2 || !pinch || pinch.from !== "touch") return;
    const a = ev.touches[0], b = ev.touches[1];
    update("touch", Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    ev.preventDefault();
    ev.stopPropagation();
  }, { capture: true, passive: false });
  const endTouch = ev => { if (ev.touches.length < 2) end("touch"); };
  host.addEventListener("touchend", endTouch, { capture: true });
  host.addEventListener("touchcancel", endTouch, { capture: true });

  // Safari gesture events: stop the page scaling, and zoom the map if
  // pointer/touch pinch did not already start.
  host.addEventListener("gesturestart", ev => {
    ev.preventDefault();
    begin("gesture", 1, ev.clientX, ev.clientY);
  });
  host.addEventListener("gesturechange", ev => {
    ev.preventDefault();
    update("gesture", ev.scale, ev.clientX, ev.clientY);
  });
  host.addEventListener("gestureend", ev => {
    ev.preventDefault();
    end("gesture");
  });

  let lastTap = null;
  cy.on("tap", ev => {
    if (ev.target !== cy) { lastTap = null; return; }
    const rp = ev.renderedPosition || { x: cy.width() / 2, y: cy.height() / 2 };
    const now = performance.now();
    if (lastTap && now - lastTap.t <= TAP_MS && Math.hypot(rp.x - lastTap.x, rp.y - lastTap.y) <= TAP_PX) {
      lastTap = null;
      zoomTo(cy, cy.zoom() * STEP, rp);
    } else {
      lastTap = { t: now, x: rp.x, y: rp.y };
    }
  });

  const stage = host.closest(".map-stage") || host.parentElement;
  if (stage && !stage.querySelector(".map-zoom")) {
    const box = document.createElement("div");
    box.className = "map-zoom";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Zoom the map");
    box.innerHTML = '<button type="button" data-map-zoom="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-map-zoom="out" aria-label="Zoom out">−</button>';
    box.addEventListener("click", ev => {
      const btn = ev.target.closest("[data-map-zoom]");
      if (!btn) return;
      const factor = btn.getAttribute("data-map-zoom") === "out" ? 1 / STEP : STEP;
      zoomTo(cy, cy.zoom() * factor, { x: cy.width() / 2, y: cy.height() / 2 });
    });
    stage.appendChild(box);
  }

  hookDefunctStyle(cy);
  applyDefunctStyle(cy);
  enhanceLegend();
}

if (window.atlasMap) attach(window.atlasMap);
document.addEventListener("atlasmap:init", ev => attach(ev.detail));
document.addEventListener("atlasmap:ready", ev => attach(ev.detail));
