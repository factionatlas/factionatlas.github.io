/**
 * Faction Atlas search: a compact name index (titles, handles, aliases)
 * ranked above Pagefind full-text mentions.
 * Keep the scorer in sync with tools/score_names.py.
 */
const NAMES_URL = "/assets/names.json";
const PAGEFIND_URL = "/pagefind/pagefind.js";

function searchPath() {
  const raw = document.body && document.body.getAttribute("data-atlas-search-path");
  if (raw && raw.trim()) {
    return raw.endsWith("/") ? raw.trim() : raw.trim() + "/";
  }
  return "/search-test/";
}
const JR = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const TYPE_LABEL = { person: "Person", org: "Organization", faction: "Faction", issue: "Issue", page: "Page" };
const FILTERS = [
  { id: "all", label: "All" },
  { id: "issue", label: "Issues" },
  { id: "person", label: "People" },
  { id: "org", label: "Organizations" },
  { id: "faction", label: "Factions" },
  { id: "page", label: "Pages" },
];

let names = [];
let namesPromise = null;
let factionNames = new Set();
let pagefindMod = null;
let pagefindPromise = null;

function loadNames() {
  if (!namesPromise) {
    namesPromise = fetch(NAMES_URL)
      .then((r) => r.json())
      .then((rows) => {
        names = rows;
        const parenStrip = /\s*\([^)]*\)/g;
        for (const rec of names) {
          if (rec.k !== "faction") continue;
          factionNames.add(norm(rec.t));
          factionNames.add(norm(rec.t.replace(parenStrip, "")));
          for (const a of rec.a || []) factionNames.add(norm(a));
          if (rec.t.includes(" / ")) {
            for (const bit of rec.t.split(" / ")) {
              factionNames.add(norm(bit.replace(parenStrip, "")));
            }
          }
        }
        return names;
      });
  }
  return namesPromise;
}

function loadPagefind() {
  if (!pagefindPromise) {
    pagefindPromise = import(PAGEFIND_URL)
      .then((m) => {
        pagefindMod = m;
        return m;
      })
      .catch((err) => {
        console.warn("Pagefind failed to load", err);
        return null;
      });
  }
  return pagefindPromise;
}

function stripDiacritics(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
function norm(s) {
  if (!s) return "";
  s = stripDiacritics(s).toLowerCase().replaceAll("@", " ");
  s = s.replace(/[/·•|,;:()[\]'’]+/g, " ");
  s = s.replace(/[^a-z0-9+#._-]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
function tokens(s) {
  return norm(s).split(/[.\s_-]+/).filter(Boolean);
}

function levenshtein(a, b, cap = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    let md = i + 1;
    for (let j = 0; j < b.length; j++) {
      const v = Math.min(cur[j] + 1, prev[j + 1] + 1, prev[j] + (a[i] !== b[j]));
      cur.push(v);
      if (v < md) md = v;
    }
    if (md > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

function typoCap(token) {
  if (token.length < 4) return 0;
  if (token.length < 8) return 1;
  return 2;
}

function tokenPrefixSeq(qt, ft) {
  let i = 0;
  for (const q of qt) {
    let found = false;
    while (i < ft.length) {
      if (ft[i].startsWith(q)) {
        found = true;
        i += 1;
        break;
      }
      i += 1;
    }
    if (!found) return false;
  }
  return true;
}

function fieldScore(qn, qt, field, isHandle, queryHasAt) {
  if (!field) return 0;
  const fn = norm(field);
  const ft = tokens(field);
  if (!fn || !ft.length) return 0;
  let s = 0;
  if (fn === qn) s = 10000;
  else if (fn.startsWith(qn) && (fn.length === qn.length || !/[a-z0-9]/.test(fn[qn.length] || ""))) s = 9000;
  else if (fn.startsWith(qn)) s = 8200;
  else if (qt.length === 1 && ft[ft.length - 1] === qt[0]) s = 9000;
  else if (qt.length >= 2 && ft[0].startsWith(qt[0])) {
    const lastFt = ft[ft.length - 1];
    let i = ft.length - 1;
    while (i >= 0 && JR.has(ft[i])) i -= 1;
    const lastSig = i >= 0 ? ft[i] : lastFt;
    if (lastSig === qt[qt.length - 1] || lastFt === qt[qt.length - 1]) {
      s = 9200;
      if (JR.has(lastFt) && !JR.has(qt[qt.length - 1])) s -= 80;
    } else if (qt[qt.length - 1].length >= 3 && lastSig.startsWith(qt[qt.length - 1])) {
      s = 8800;
      if (JR.has(lastFt) && !JR.has(qt[qt.length - 1])) s -= 80;
    } else if (tokenPrefixSeq(qt, ft)) s = 7500;
    else if (qt.every((t) => ft.some((w) => w.startsWith(t)))) s = 6500;
  } else if (tokenPrefixSeq(qt, ft)) s = 7500;
  else if (qt.length && qt.every((t) => ft.some((w) => w.startsWith(t)))) s = 6500;
  else if ((qt.length === 1 && ft.includes(qt[0])) || (qt.length && qt.every((t) => ft.includes(t)))) s = 6000;
  else {
    let ok = 0;
    let fuzzy = 0;
    for (const t of qt) {
      const cap = typoCap(t);
      let best = cap + 1;
      for (const w of ft) {
        if (w === t || w.startsWith(t)) {
          best = 0;
          break;
        }
        if (cap && Math.abs(w.length - t.length) <= (t.length >= 5 ? 1 : 0)) {
          const d = levenshtein(t, w, cap);
          if (d < best) best = d;
        }
      }
      if (best <= cap) {
        ok += 1;
        fuzzy += cap + 1 - best;
      }
    }
    if (ok === qt.length && fuzzy) s = 3000 + fuzzy * 200;
  }
  if (s && isHandle) {
    if (queryHasAt) s += 80;
    else if (fn === qn && s >= 10000) s = 9300;
  }
  return s;
}

function isFactionDuplicate(rec) {
  if (rec.k !== "person" && rec.k !== "org") return false;
  if (factionNames.has(norm(rec.t))) return true;
  if (rec.h && factionNames.has(norm(rec.h))) return true;
  return false;
}

function scoreRecord(q, rec) {
  const qt = tokens(q);
  if (!qt.length) return { s: 0, reason: "" };
  const qn = qt.join(" ");
  const queryHasAt = q.trim().startsWith("@");
  let best = 0;
  let reason = "";
  const fields = [["title", rec.t, false]];
  if (rec.h) {
    fields.push(["handle", rec.h, true]);
    fields.push(["handle@", "@" + rec.h, true]);
  }
  for (const a of rec.a || []) fields.push(["alias", a, false]);
  for (const [name, val, isH] of fields) {
    const s = fieldScore(qn, qt, val, isH, queryHasAt);
    if (s > best) {
      best = s;
      reason = name;
    }
  }
  if (!best) return { s: 0, reason: "" };
  if (reason === "alias") {
    for (const a of rec.a || []) {
      const an = norm(a);
      if (!an || an === qn) continue;
      if (!rec.t.toLowerCase().startsWith(a.toLowerCase()) && tokens(a).length <= 2) {
        const fs = fieldScore(qn, qt, a, false, queryHasAt);
        if (fs === best && fs >= 8000) {
          best = Math.min(best, 7200);
          break;
        }
      }
    }
  }
  if (rec.r) best -= 220;
  if (isFactionDuplicate(rec)) best -= 400;
  if (rec.k === "faction" && (reason === "title" || reason === "alias")) best += 25;
  if (best >= 3000 && best < 5000 && tokens(rec.t).length && qt.length) {
    const cap = typoCap(qt[0]);
    if (cap && levenshtein(qt[0], tokens(rec.t)[0], cap) <= cap) best += 80;
  }
  if (rec.k === "issue" && (reason === "title" || reason === "alias")) {
    const exactAlias = (rec.a || []).some((a) => norm(a) === qn) || norm(rec.t) === qn;
    if (exactAlias) best += 800;
    else if (norm(rec.t).startsWith(qn)) best += 400;
  }
  return { s: best, reason };
}

function retiredUrlSet() {
  const s = new Set();
  for (const rec of names) {
    if (rec.r) s.add(pathOnly(rec.u));
  }
  return s;
}

function searchNames(q, typ, limit, includeRetired) {
  const hits = [];
  for (const rec of names) {
    if (!typeMatches(rec, typ)) continue;
    const { s, reason } = scoreRecord(q, rec);
    if (s) hits.push({ s, reason, rec });
  }
  hits.sort((a, b) => (a.rec.r ? 1 : 0) - (b.rec.r ? 1 : 0) || b.s - a.s || a.rec.t.localeCompare(b.rec.t, "en", { sensitivity: "base" }) || a.rec.u.localeCompare(b.rec.u));
  const active = hits.filter((h) => !h.rec.r);
  const retired = hits.filter((h) => h.rec.r);
  const strongRetired = retired.filter((h) => h.s >= 9500);
  const weakRetired = retired.filter((h) => h.s < 9500);
  const shownRetired = includeRetired ? retired : strongRetired;
  const combined = [...active, ...shownRetired].slice(0, limit);
  return {
    hits: combined,
    hiddenRetired: includeRetired ? 0 : weakRetired.length,
    retiredTotal: retired.length,
  };
}

function typeMatches(rec, typ) {
  if (!typ || typ === "all") return true;
  if (typ === "issue") return rec.k === "issue" || rec.u === "/issues/" || rec.u.startsWith("/issues/#");
  return rec.k === typ;
}

function typeOfUrl(url) {
  const [path, hash] = (url || "").split("#");
  if (path.includes("/faction/")) return "faction";
  if (path.includes("/person/")) return "person";
  if (path.includes("/org/")) return "org";
  if ((path.replace(/\/index\.html$/, "").replace(/\/$/, "") === "/issues") && hash) return "issue";
  return "page";
}

function pathOnly(url) {
  if (!url) return "";
  let u = url.split("#")[0];
  u = u.replace(/index\.html$/, "");
  if (!u.endsWith("/")) u += "/";
  return u;
}

async function searchPagefind(q, typ, nameHits, includeRetired, limit) {
  const pf = await loadPagefind();
  if (!pf || !q.trim()) return [];
  const exclude = new Set();
  let hasIssueAnchor = false;
  for (const h of nameHits || []) {
    exclude.add(h.rec.u);
    exclude.add(pathOnly(h.rec.u));
    if (h.rec.u.startsWith("/issues/#")) hasIssueAnchor = true;
  }
  if (hasIssueAnchor) exclude.add("/issues/");
  const retired = includeRetired ? new Set() : retiredUrlSet();
  const res = await pf.search(q);
  const out = [];
  for (const r of res.results) {
    if (out.length >= limit) break;
    const d = await r.data();
    let url = d.url || "";
    try {
      url = new URL(url, location.origin).pathname;
    } catch {}
    if (!url.endsWith("/")) {
      url = url.replace(/index\.html$/, "");
      if (!url.endsWith("/")) url += "/";
    }
    if (exclude.has(url) || exclude.has(pathOnly(url))) continue;
    if (retired.has(pathOnly(url))) continue;
    const typU = typeOfUrl(url);
    if (typ && typ !== "all" && typU !== typ && !(typ === "issue" && pathOnly(url) === "/issues/")) continue;
    const title = ((d.meta && d.meta.title) || "").replace(/\s*·\s*Faction Atlas\s*$/, "");
    out.push({
      rec: { t: title || url, u: url, k: typU },
      excerpt: d.excerpt || "",
      mention: true,
    });
  }
  return out;
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function renderHit(hit, idx, prefix) {
  const rec = hit.rec;
  const typ = rec.k || typeOfUrl(rec.u);
  const li = el("li", { class: "atlas-hit", role: "option", id: `${prefix}-${idx}`, "data-url": rec.u });
  const a = el("a", { href: rec.u, tabindex: "-1" });
  a.append(el("span", { class: `atlas-badge atlas-badge-${typ}`, text: TYPE_LABEL[typ] || typ }));
  const title = el("span", { class: "atlas-title", text: rec.t });
  if (rec.r) title.append(el("span", { class: "atlas-flag", text: "Retired" }));
  else if (rec.x) title.append(el("span", { class: "atlas-flag", text: "Historical" }));
  a.append(title);
  const subBits = [];
  if (rec.h) subBits.push("@" + rec.h);
  if (hit.reason === "alias" && rec.a && rec.a.length) subBits.push("also " + rec.a[0]);
  if (hit.mention) subBits.push("in the page text");
  if (subBits.length) a.append(el("span", { class: "atlas-sub", text: subBits.join(" · ") }));
  if (hit.excerpt) {
    const ex = el("span", { class: "atlas-excerpt" });
    ex.innerHTML = hit.excerpt;
    a.append(ex);
  }
  li.append(a);
  return li;
}

function mount(root, opts = {}) {
  const mode = opts.mode || "page"; // page | hero | header
  const nameLimit = opts.nameLimit ?? (mode === "header" ? 6 : mode === "hero" ? 8 : 16);
  const mentionLimit = opts.mentionLimit ?? (mode === "header" ? 3 : mode === "hero" ? 5 : 10);
  const showFilters = opts.showFilters !== false && mode !== "header";
  const uid = "as-" + Math.random().toString(36).slice(2, 8);

  const form = mode === "header" ? root : el("form", { class: "atlas-search", role: "search", action: searchPath() });
  if (mode === "header") form.classList.add("atlas-search-enhanced");
  else root.replaceChildren();

  let input = form.querySelector('input[type="search"], input[name="q"]');
  if (!input) {
    const box = el("div", { class: "atlas-search-box" });
    input = el("input", {
      type: "search",
      name: "q",
      placeholder: "Search a name, handle, alias or faction",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
    });
    box.append(input);
    form.append(box);
    if (mode !== "header") root.append(form);
  }
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", uid + "-list");
  input.setAttribute("aria-expanded", "false");

  const filters = el("div", { class: "atlas-filters", role: "group", "aria-label": "Filter by page type", hidden: !showFilters });
  if (showFilters) {
    filters.append(el("span", { text: "Show" }));
    for (const f of FILTERS) {
      filters.append(
        el("button", { type: "button", "data-type": f.id, "aria-pressed": f.id === "all" ? "true" : "false", text: f.label })
      );
    }
    if (mode !== "header") form.append(filters);
  }
  const status = el("div", { class: "atlas-status", id: uid + "-status", "aria-live": "polite" });
  const list = el("ul", {
    class: "atlas-results" + (mode === "header" ? " atlas-dropdown" : ""),
    id: uid + "-list",
    role: "listbox",
    "aria-label": "Search results",
    "data-empty": "true",
  });
  form.append(status, list);

  let typ = "all";
  let showRetired = false;
  let active = -1;
  let current = [];
  let lastQ = "";
  let pfTimer = 0;
  let gen = 0;

  function setActive(i) {
    const items = [...list.querySelectorAll(".atlas-hit")];
    if (!items.length) {
      active = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    if (i < 0) i = items.length - 1;
    if (i >= items.length) i = 0;
    active = i;
    items.forEach((n, idx) => n.classList.toggle("is-active", idx === i));
    const sel = items[i];
    input.setAttribute("aria-activedescendant", sel.id);
    sel.scrollIntoView({ block: "nearest" });
  }

  function retiredToggle(hiddenRetired) {
    const li = el("li", { class: "atlas-retired-toggle", role: "presentation" });
    let label, action;
    if (hiddenRetired > 0) {
      label = hiddenRetired === 1 ? "Show 1 retired result" : `Show ${hiddenRetired} retired results`;
      action = "show";
    } else if (showRetired) {
      label = "Hide retired results";
      action = "hide";
    } else {
      return null;
    }
    li.append(el("button", { type: "button", "data-retired-toggle": action, text: label }));
    return li;
  }

  function paint(nameHits, mentionHits, q, pending, hiddenRetired) {
    hiddenRetired = hiddenRetired || 0;
    current = [...nameHits, ...mentionHits];
    list.replaceChildren();
    if (!current.length && hiddenRetired === 0) {
      list.dataset.empty = "true";
      input.setAttribute("aria-expanded", "false");
      status.textContent = q ? (pending ? "Searching…" : "No matches.") : "";
      return;
    }
    list.dataset.empty = "false";
    input.setAttribute("aria-expanded", "true");
    if (nameHits.length) {
      list.append(el("li", { class: "atlas-group", role: "presentation", text: "Names" }));
      nameHits.forEach((h, i) => list.append(renderHit(h, i, uid + "-n")));
    }
    const toggle = retiredToggle(hiddenRetired);
    if (toggle) list.append(toggle);
    if (mentionHits.length) {
      list.append(el("li", { class: "atlas-group", role: "presentation", text: "Mentions in page text" }));
      mentionHits.forEach((h, i) => list.append(renderHit(h, nameHits.length + i, uid + "-m")));
    }
    const n = nameHits.length;
    const m = mentionHits.length;
    const bits = [];
    if (n) bits.push(n === 1 ? "1 name" : n + " names");
    if (m) bits.push(m === 1 ? "1 mention" : m + " mentions");
    if (hiddenRetired) bits.push(hiddenRetired === 1 ? "1 retired hidden" : hiddenRetired + " retired hidden");
    status.textContent = (bits.join(" and ") || "No matches") + (pending ? "…" : "") + ".";
    active = -1;
  }

  async function run(q, withPagefind) {
    const my = ++gen;
    q = q.trim();
    lastQ = q;
    if (!q) {
      paint([], [], "", false, 0);
      return;
    }
    await loadNames();
    if (my !== gen) return;
    const found = searchNames(q, typ, nameLimit, showRetired);
    const nameHits = found.hits;
    paint(nameHits, [], q, true, found.hiddenRetired);
    if (!withPagefind) return;
    const mentionHits = await searchPagefind(q, typ, nameHits, showRetired, mentionLimit);
    if (my !== gen) return;
    paint(nameHits, mentionHits, q, false, found.hiddenRetired);
  }

  function schedule(q) {
    run(q, false);
    clearTimeout(pfTimer);
    pfTimer = setTimeout(() => run(q, true), 160);
  }

  input.addEventListener("input", () => schedule(input.value));
  input.addEventListener("focus", () => {
    if (input.value.trim() && list.dataset.empty === "true") schedule(input.value);
    else if (current.length) input.setAttribute("aria-expanded", "true");
  });
  form.addEventListener("submit", (e) => {
    const items = [...list.querySelectorAll(".atlas-hit")];
    const chosen = items[active] || (items.length === 1 ? items[0] : null);
    if (chosen) {
      e.preventDefault();
      location.href = chosen.dataset.url;
      return;
    }
    if (mode !== "page") {
      e.preventDefault();
      const q = input.value.trim();
      location.href = q ? searchPath() + "?q=" + encodeURIComponent(q) + (typ !== "all" ? "&type=" + typ : "") : searchPath();
    }
  });
  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll(".atlas-hit")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Home" && items.length && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && items.length && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === "Escape") {
      if (input.value && mode !== "page") {
        input.value = "";
        paint([], [], "", false);
      } else {
        input.removeAttribute("aria-activedescendant");
        list.dataset.empty = mode === "header" ? "true" : list.dataset.empty;
        input.setAttribute("aria-expanded", "false");
        input.blur();
      }
    }
  });
  filters.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-type]");
    if (!b) return;
    typ = b.getAttribute("data-type");
    for (const btn of filters.querySelectorAll("button[data-type]")) {
      btn.setAttribute("aria-pressed", btn === b ? "true" : "false");
    }
    if (lastQ) schedule(lastQ);
    if (mode === "page") syncUrl();
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-retired-toggle]");
    if (!b) return;
    e.preventDefault();
    showRetired = b.getAttribute("data-retired-toggle") === "show";
    if (lastQ) schedule(lastQ);
  });
  document.addEventListener("click", (e) => {
    if (mode === "header" && !form.contains(e.target)) {
      input.setAttribute("aria-expanded", "false");
      list.dataset.empty = "true";
    }
  });

  function syncUrl() {
    const url = new URL(location.href);
    if (lastQ) url.searchParams.set("q", lastQ);
    else url.searchParams.delete("q");
    if (typ && typ !== "all") url.searchParams.set("type", typ);
    else url.searchParams.delete("type");
    history.replaceState(null, "", url);
  }

  const params = new URLSearchParams(location.search);
  const initialQ = opts.query ?? (mode !== "header" ? params.get("q") : "") ?? "";
  const initialType = params.get("type");
  if (initialType && FILTERS.some((f) => f.id === initialType)) {
    typ = initialType;
    for (const btn of filters.querySelectorAll("button[data-type]")) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-type") === typ ? "true" : "false");
    }
  }
  if (initialQ) {
    input.value = initialQ;
    schedule(initialQ);
  }
  loadNames();
  loadPagefind();
  return { input, run, schedule };
}

function enhanceHeader() {
  const form = document.querySelector("form.head-search");
  if (!form || form.closest("#search") || form.dataset.atlas === "1") return;
  form.dataset.atlas = "1";
  form.setAttribute("action", searchPath());
  const input = form.querySelector("input");
  if (input) {
    input.setAttribute("placeholder", "Search a name, handle or faction");
    input.setAttribute("autocomplete", "off");
  }
  mount(form, { mode: "header", showFilters: false });
}

function boot() {
  const hero = document.querySelector("#search");
  if (hero) {
    const path = location.pathname.replace(/index\.html$/, "");
    const pageMode = document.body.classList.contains("atlas-search-page") || path.endsWith("/search/") || path.endsWith("/search-test/");
    mount(hero, { mode: pageMode ? "page" : "hero" });
  }
  // Header dropdown is opt-in so existing site pages stay unchanged if this script is loaded.
  if (document.querySelector("[data-atlas-header]")) enhanceHeader();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
    const input = document.querySelector(".atlas-search input[type=search], .head-search input[type=search]");
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
