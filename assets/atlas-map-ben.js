// Faction Atlas map chrome — Ben overlay (2026-11-25).
// Theme-following toolbar, search, buttons, panel, legend and table styles
// live in atlas-map-ben.css. This script adds pinch zoom, double-tap zoom
// on empty canvas, and on-map +/- buttons.
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
}

if (window.atlasMap) attach(window.atlasMap);
document.addEventListener("atlasmap:init", ev => attach(ev.detail));
document.addEventListener("atlasmap:ready", ev => attach(ev.detail));
