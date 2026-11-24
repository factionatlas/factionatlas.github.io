// Issues explorer: vanilla JS, no framework. Reads a JSON file on this site only.
(function () {
  var root = document.getElementById("ix");
  if (!root) return;
  var DATA = null, PRE = root.getAttribute("data-root") || "../";
  var PAGE = 80;
  var view = "explorer";
  var pickA = null, pickB = null;
  var moreLimit = PAGE;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function personUrl(p) { return PRE + (p.k === "o" ? "org/" : "person/") + p.id + "/"; }
  function issueUrl(ax) { return ax.slug ? ax.slug + "/" : ""; }
  function facName(id) { return (DATA.factions[id] && DATA.factions[id].n) || id || ""; }
  function swatch(col) {
    if (!col || !/^#[0-9A-Fa-f]{3,8}$/.test(col)) return "";
    return '<span class="ix-swatch" style="background:' + col + '" aria-hidden="true"></span>';
  }
  function coalName(id) { return (DATA.coalitions[id] && DATA.coalitions[id].n) || id || ""; }
  function axisById(id) {
    for (var i = 0; i < DATA.axes.length; i++) if (DATA.axes[i].id === id) return DATA.axes[i];
    return null;
  }
  function groupOf(ax) { return ax.group || "Other"; }
  function groups() {
    var g = {}, i, name;
    for (i = 0; i < DATA.axes.length; i++) { name = groupOf(DATA.axes[i]); g[name] = (g[name] || 0) + 1; }
    var keys = Object.keys(g);
    keys.sort(function (a, b) {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    return keys;
  }
  function fillAxisSelect(sel, includeEmpty) {
    var gs = groups(), i, j, ax, g, og, opts = includeEmpty ? '<option value="">Choose an issue</option>' : "";
    for (i = 0; i < gs.length; i++) {
      g = gs[i];
      og = '<optgroup label="' + esc(g) + '">';
      for (j = 0; j < DATA.axes.length; j++) {
        ax = DATA.axes[j];
        if (groupOf(ax) !== g) continue;
        og += '<option value="' + esc(ax.id) + '">' + esc(ax.name) + (ax.n ? " (" + ax.n.toLocaleString() + ")" : "") + "</option>";
      }
      opts += og + "</optgroup>";
    }
    sel.innerHTML = opts;
  }
  function rowsFor(axisId) { return DATA.rows[axisId] || []; }
  function counts(axisId, pred) {
    var ax = axisById(axisId), rows = rowsFor(axisId), i, r, c;
    var out = [];
    if (!ax) return out;
    for (i = 0; i < ax.positions.length; i++) out.push(0);
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (pred && !pred(DATA.people[r[0]], r)) continue;
      c = r[1];
      if (c >= 0 && c < out.length) out[c] += 1;
    }
    return out;
  }
  function totalOf(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function noticeFor(axisId, n, countsArr) {
    var bits = [], top = 0, i, share;
    if (n === 0) return "No stances are recorded on this issue yet.";
    if (n < DATA.thin) bits.push("Only " + n.toLocaleString() + " recorded " + (n === 1 ? "stance" : "stances") + " — this issue is thinly coded.");
    if (n >= DATA.onesided.n) {
      for (i = 0; i < countsArr.length; i++) if (countsArr[i] > top) top = countsArr[i];
      share = top / n;
      if (share >= DATA.onesided.share) bits.push("This split is one-sided: " + Math.round(share * 100) + "% of recorded stances sit on one position. That is the coverage so far, not a claim that everyone agrees.");
    }
    return bits.join(" ");
  }
  function barsHtml(ax, countsArr) {
    var n = totalOf(countsArr), i, pct, html = '<div class="ix-barset" role="img" aria-label="Stance counts">';
    if (!n) return '<p class="b-none">No recorded stances in this filter.</p>';
    for (i = 0; i < ax.positions.length; i++) {
      pct = Math.round((countsArr[i] / n) * 100);
      html += '<div class="ix-barrow"><div class="ix-barlab">' + esc(ax.positions[i].n) +
        ' <span class="b-none">(' + countsArr[i].toLocaleString() + " · " + pct + "%)</span></div>" +
        '<div class="ix-bartrack"><div class="ix-barfill" style="width:' + pct + '%"></div></div></div>';
    }
    html += "</div>";
    return html;
  }
  function predFromFilters() {
    var coal = $("ix-coal").value, fac = $("ix-fac").value, q = ($("ix-q").value || "").trim().toLowerCase();
    if (q.charAt(0) === "@") q = q.slice(1);
    return function (p) {
      if (coal && p.c !== coal) return false;
      if (fac && p.f !== fac) return false;
      if (q) {
        var n = (p.n || "").toLowerCase(), h = (p.h || "").toLowerCase();
        if (n.indexOf(q) < 0 && h.indexOf(q) < 0) return false;
      }
      return true;
    };
  }
  function fillCoalFac(axisId) {
    var usedC = {}, usedF = {}, rows = rowsFor(axisId), i, p, coalSel = $("ix-coal"), facSel = $("ix-fac");
    var curC = coalSel.value, curF = facSel.value;
    for (i = 0; i < rows.length; i++) {
      p = DATA.people[rows[i][0]];
      if (p.c) usedC[p.c] = true;
      if (p.f) usedF[p.f] = true;
    }
    var cids = Object.keys(usedC).sort(function (a, b) { return coalName(a).localeCompare(coalName(b)); });
    var fids = Object.keys(usedF).sort(function (a, b) { return facName(a).localeCompare(facName(b)); });
    coalSel.innerHTML = '<option value="">All coalitions</option>' + cids.map(function (id) {
      return '<option value="' + esc(id) + '">' + esc(coalName(id)) + "</option>";
    }).join("");
    facSel.innerHTML = '<option value="">All factions</option>' + fids.map(function (id) {
      return '<option value="' + esc(id) + '">' + esc(facName(id)) + "</option>";
    }).join("");
    if (curC && usedC[curC]) coalSel.value = curC;
    if (curF && usedF[curF]) facSel.value = curF;
  }
  function sourceLink(ui) {
    if (ui == null || !DATA.urls[ui]) return "";
    var u = DATA.urls[ui], short = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (short.length > 40) short = short.slice(0, 38) + "…";
    return ' <a class="ext" href="' + esc(u) + '" rel="external noopener">Source</a>';
  }
  function renderExplorer() {
    var axisId = $("ix-axis").value, ax = axisById(axisId);
    if (!ax) return;
    fillCoalFac(axisId);
    var pred = predFromFilters();
    var cnt = counts(axisId, function (p) { return pred(p); });
    var nAll = (DATA.rows[axisId] || []).length;
    var n = totalOf(cnt);
    var note = noticeFor(axisId, nAll, counts(axisId));
    var el = $("ix-explorer-note");
    if (note) { el.hidden = false; el.textContent = note; } else { el.hidden = true; el.textContent = ""; }
    $("ix-bars").innerHTML = '<p class="b-none">' + n.toLocaleString() + " recorded " + (n === 1 ? "stance" : "stances") +
      (n !== nAll ? " in this filter, of " + nAll.toLocaleString() + " on the issue" : "") +
      '. <a href="' + esc(issueUrl(ax)) + '">Issue page</a>.</p>' + barsHtml(ax, cnt);
    var rows = rowsFor(axisId).filter(function (r) { return pred(DATA.people[r[0]]); });
    rows.sort(function (a, b) {
      return (DATA.people[a[0]].n || "").localeCompare(DATA.people[b[0]].n || "");
    });
    var shown = rows.slice(0, moreLimit);
    var html = '<table class="data"><caption class="sr">People recorded on this issue</caption><thead><tr>' +
      "<th>Name</th><th>Faction</th><th>Stance</th><th>Source</th></tr></thead><tbody>";
    for (var i = 0; i < shown.length; i++) {
      var r = shown[i], p = DATA.people[r[0]], st = ax.positions[r[1]] ? ax.positions[r[1]].n : "";
      html += "<tr><td><a href=\"" + esc(personUrl(p)) + "\">" + esc(p.n) + "</a>" +
        (p.h ? ' <span class="mono">@' + esc(p.h) + "</span>" : "") + "</td><td>" +
        esc(facName(p.f) || "—") + "</td><td>" + esc(st) + "</td><td>" + sourceLink(r[2]) + "</td></tr>";
    }
    html += "</tbody></table>";
    if (rows.length > shown.length) {
      html += '<p><button type="button" class="btn" id="ix-more">Show more</button> ' +
        '<span class="b-none">Showing ' + shown.length.toLocaleString() + " of " + rows.length.toLocaleString() + "</span></p>";
    } else if (rows.length) {
      html += '<p class="b-none">Showing ' + rows.length.toLocaleString() + " of " + rows.length.toLocaleString() + ".</p>";
    }
    $("ix-results").innerHTML = html;
    var more = $("ix-more");
    if (more) more.addEventListener("click", function () { moreLimit += PAGE; renderExplorer(); });
  }

  function renderCompare() {
    var a = axisById($("ix-axis-a").value), b = axisById($("ix-axis-b").value), out = $("ix-compare-out");
    if (!a || !b) { out.innerHTML = '<p class="b-none">Choose two issues.</p>'; return; }
    if (a.id === b.id) { out.innerHTML = '<p class="b-none">Pick two different issues.</p>'; return; }
    var mapA = {}, mapB = {}, i, r, p, both = [], onlyA = [], onlyB = [];
    var ra = rowsFor(a.id), rb = rowsFor(b.id);
    for (i = 0; i < ra.length; i++) mapA[ra[i][0]] = ra[i];
    for (i = 0; i < rb.length; i++) mapB[rb[i][0]] = rb[i];
    var seen = {};
    for (i in mapA) { if (Object.prototype.hasOwnProperty.call(mapA, i)) {
      if (mapB[i]) both.push(+i); else onlyA.push(+i);
      seen[i] = true;
    } }
    for (i in mapB) { if (Object.prototype.hasOwnProperty.call(mapB, i) && !seen[i]) onlyB.push(+i); }
    both.sort(function (x, y) { return DATA.people[x].n.localeCompare(DATA.people[y].n); });
    var html = barsHtml(a, counts(a.id)) + barsHtml(b, counts(b.id));
    html += '<p class="b-none">' + both.length.toLocaleString() + " recorded on both, " +
      onlyA.length.toLocaleString() + " only on the first, " + onlyB.length.toLocaleString() + " only on the second.</p>";
    if (both.length < 10) html += '<p class="note">The overlap is small, so this comparison rests on a thin slice of the data.</p>';
    html += '<h3>Recorded on both</h3>';
    if (!both.length) html += '<p class="b-none">No one is recorded on both issues.</p>';
    else {
      html += '<table class="data"><thead><tr><th>Name</th><th>' + esc(a.name) + "</th><th>" + esc(b.name) + "</th></tr></thead><tbody>";
      var cap = Math.min(both.length, 200);
      for (i = 0; i < cap; i++) {
        p = DATA.people[both[i]];
        html += "<tr><td><a href=\"" + esc(personUrl(p)) + "\">" + esc(p.n) + "</a></td><td>" +
          esc(a.positions[mapA[both[i]][1]].n) + sourceLink(mapA[both[i]][2]) + "</td><td>" +
          esc(b.positions[mapB[both[i]][1]].n) + sourceLink(mapB[both[i]][2]) + "</td></tr>";
      }
      html += "</tbody></table>";
      if (both.length > cap) html += '<p class="b-none">Showing the first ' + cap.toLocaleString() + " of " + both.length.toLocaleString() + ".</p>";
    }
    out.innerHTML = html;
  }

  function renderHeat() {
    var g = $("ix-hgroup").value, axes = DATA.axes.filter(function (ax) { return groupOf(ax) === g && ax.n; });
    var cids = Object.keys(DATA.coalitions).sort(function (a, b) { return coalName(a).localeCompare(coalName(b)); });
    var wrap = $("ix-heat");
    if (!axes.length) { wrap.innerHTML = '<p class="b-none">No recorded stances in this group.</p>'; return; }
    // Per coalition, counts per axis and total people coded in the group
    var cell = {}, i, j, r, p, ax, cid, n, html, thin;
    for (i = 0; i < axes.length; i++) {
      ax = axes[i];
      cell[ax.id] = {};
      for (j = 0; j < (DATA.rows[ax.id] || []).length; j++) {
        r = DATA.rows[ax.id][j]; p = DATA.people[r[0]]; cid = p.c || "";
        if (!cid) continue;
        if (!cell[ax.id][cid]) cell[ax.id][cid] = 0;
        cell[ax.id][cid] += 1;
      }
    }
    html = '<div class="ix-heat"><table class="data ix-heat-table"><caption class="sr">Recorded stance counts by coalition and issue</caption><thead><tr><th>Coalition</th>';
    for (i = 0; i < axes.length; i++) html += "<th>" + esc(axes[i].name) + "</th>";
    html += "</tr></thead><tbody>";
    for (i = 0; i < cids.length; i++) {
      cid = cids[i];
      var any = false, row = "";
      for (j = 0; j < axes.length; j++) { if ((cell[axes[j].id][cid] || 0) > 0) any = true; }
      if (!any) continue;
      row += "<tr><th scope=\"row\">" + swatch((DATA.coalitions[cid] && DATA.coalitions[cid].col) || "") + esc(coalName(cid)) + "</th>";
      for (j = 0; j < axes.length; j++) {
        n = cell[axes[j].id][cid] || 0;
        thin = n > 0 && n < DATA.thin;
        row += '<td class="' + (n === 0 ? "ix-empty" : thin ? "ix-thin" : "") + '">' +
          (n === 0 ? "—" : n.toLocaleString()) + (thin ? ' <span class="b-none">thin</span>' : "") + "</td>";
      }
      row += "</tr>";
      html += row;
    }
    html += "</tbody></table></div>";
    html += '<p class="b-none">A dash means no one in that coalition is recorded on that issue. Cells marked “thin” have fewer than ' + DATA.thin + " recorded stances. Counts are of people, not a score.</p>";
    wrap.innerHTML = html;
  }

  function searchPeople(q, limit) {
    q = (q || "").trim().toLowerCase();
    if (q.charAt(0) === "@") q = q.slice(1);
    if (q.length < 2) return [];
    var out = [], i, p, n, h;
    for (i = 0; i < DATA.people.length && out.length < (limit || 12); i++) {
      p = DATA.people[i]; n = (p.n || "").toLowerCase(); h = (p.h || "").toLowerCase();
      if (n.indexOf(q) >= 0 || h.indexOf(q) >= 0) out.push(p);
    }
    return out;
  }
  function personStances(pi) {
    var out = [], i, ax, rows, j;
    for (i = 0; i < DATA.axes.length; i++) {
      ax = DATA.axes[i]; rows = DATA.rows[ax.id] || [];
      for (j = 0; j < rows.length; j++) if (rows[j][0] === pi) { out.push({ ax: ax, row: rows[j] }); break; }
    }
    return out;
  }
  function renderPeopleCompare() {
    var out = $("ix-people-out");
    if (pickA == null || pickB == null) { out.innerHTML = '<p class="b-none">Choose two people from the suggestions.</p>'; return; }
    if (pickA === pickB) { out.innerHTML = '<p class="b-none">Pick two different people.</p>'; return; }
    var sa = personStances(pickA), sb = personStances(pickB), mapB = {}, i, rec, both = [], onlyA = [], onlyB = [];
    for (i = 0; i < sb.length; i++) mapB[sb[i].ax.id] = sb[i];
    for (i = 0; i < sa.length; i++) {
      if (mapB[sa[i].ax.id]) both.push({ ax: sa[i].ax, a: sa[i], b: mapB[sa[i].ax.id] });
      else onlyA.push(sa[i]);
    }
    for (i = 0; i < sb.length; i++) {
      var found = false, j;
      for (j = 0; j < sa.length; j++) if (sa[j].ax.id === sb[i].ax.id) { found = true; break; }
      if (!found) onlyB.push(sb[i]);
    }
    var pa = DATA.people[pickA], pb = DATA.people[pickB];
    var html = '<p><a href="' + esc(personUrl(pa)) + '">' + esc(pa.n) + "</a> and <a href=\"" +
      esc(personUrl(pb)) + '">' + esc(pb.n) + "</a> — " + both.length + " issue" + (both.length === 1 ? "" : "s") + " in common, " +
      sa.length + " and " + sb.length + " recorded in total.</p>";
    if (!both.length) html += '<p class="b-none">They have no recorded issue in common.</p>';
    else {
      html += '<table class="data"><thead><tr><th>Issue</th><th>' + esc(pa.n) + "</th><th>" + esc(pb.n) + "</th></tr></thead><tbody>";
      for (i = 0; i < both.length; i++) {
        rec = both[i];
        html += "<tr><td><a href=\"" + esc(issueUrl(rec.ax)) + "\">" + esc(rec.ax.name) + "</a></td><td>" +
          esc(rec.ax.positions[rec.a.row[1]].n) + sourceLink(rec.a.row[2]) + "</td><td>" +
          esc(rec.ax.positions[rec.b.row[1]].n) + sourceLink(rec.b.row[2]) + "</td></tr>";
      }
      html += "</tbody></table>";
    }
    out.innerHTML = html;
  }
  function bindSuggest(inputId, boxId, setter) {
    var inp = $(inputId), box = $(boxId);
    function paint(items) {
      if (!items.length) { box.hidden = true; box.innerHTML = ""; return; }
      box.hidden = false;
      box.innerHTML = "<ul>" + items.map(function (p) {
        var i = DATA.people.indexOf(p);
        return '<li><button type="button" data-i="' + i + '">' + esc(p.n) +
          (p.h ? " @" + esc(p.h) : "") + "</button></li>";
      }).join("") + "</ul>";
    }
    inp.addEventListener("input", function () {
      setter(null);
      paint(searchPeople(inp.value));
    });
    box.addEventListener("click", function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      var i = +b.getAttribute("data-i");
      setter(i);
      inp.value = DATA.people[i].n + (DATA.people[i].h ? " @" + DATA.people[i].h : "");
      box.hidden = true; box.innerHTML = "";
      renderPeopleCompare();
    });
  }
  function renderFingerprint() {
    var val = $("ix-fp").value, out = $("ix-fp-out");
    if (!val) { out.innerHTML = '<p class="b-none">Choose a faction or coalition.</p>'; return; }
    var kind = val.charAt(0), id = val.slice(2), i, ax, rows, pred, cnt, n, html = "", shown = 0;
    pred = function (p) { return kind === "c" ? p.c === id : p.f === id; };
    var members = 0;
    for (i = 0; i < DATA.people.length; i++) if (pred(DATA.people[i])) members++;
    html += '<p class="b-none">' + members.toLocaleString() + " recorded " + (members === 1 ? "person" : "people") +
      " with a stance, whose " + (kind === "c" ? "coalition is " + coalName(id) : "exclusive home is " + facName(id)) + ".</p>";
    for (i = 0; i < DATA.axes.length; i++) {
      ax = DATA.axes[i];
      cnt = counts(ax.id, pred);
      n = totalOf(cnt);
      if (!n) continue;
      shown++;
      html += "<h4>" + esc(ax.name) + ' <span class="b-none">(' + n.toLocaleString() + ")</span></h4>" + barsHtml(ax, cnt);
    }
    if (!shown) html += '<p class="b-none">No recorded stances for this selection.</p>';
    out.innerHTML = html;
  }

  function showView(name) {
    view = name;
    var tabs = ["explorer", "compare", "heatmap", "people"], i, tab, panel, on;
    for (i = 0; i < tabs.length; i++) {
      on = tabs[i] === name;
      tab = $("ix-tab-" + tabs[i]); panel = $("ix-panel-" + tabs[i]);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      panel.hidden = !on;
    }
    if (name === "explorer") renderExplorer();
    if (name === "compare") renderCompare();
    if (name === "heatmap") renderHeat();
    if (name === "people") { renderPeopleCompare(); renderFingerprint(); }
    writeHash();
  }
  function writeHash() {
    var parts = ["view=" + view];
    if (view === "explorer" && $("ix-axis").value) parts.push("axis=" + encodeURIComponent($("ix-axis").value));
    if (view === "people") {
      var fp = $("ix-fp").value;
      if (fp && fp.charAt(0) === "f") parts.push("faction=" + encodeURIComponent(fp.slice(2)));
      if (fp && fp.charAt(0) === "c") parts.push("coalition=" + encodeURIComponent(fp.slice(2)));
    }
    var h = parts.join("&");
    if (location.hash.replace(/^#/, "") !== h) history.replaceState(null, "", "#" + h);
  }
  function readHash() {
    var raw = (location.hash || "").replace(/^#/, ""), q = {}, i, kv;
    if (!raw) return q;
    raw.split("&").forEach(function (part) {
      kv = part.split("="); if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
    return q;
  }

  function ready() {
    root.hidden = false;
    var need = root.querySelector(".ix-needjs"); if (need) need.hidden = true;
    fillAxisSelect($("ix-axis"));
    fillAxisSelect($("ix-axis-a"));
    fillAxisSelect($("ix-axis-b"));
    var gs = groups(), i, g, hg = $("ix-hgroup");
    hg.innerHTML = gs.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + "</option>"; }).join("");
    var fp = $("ix-fp"), opts = '<option value="">Choose…</option><optgroup label="Coalitions">';
    var cids = Object.keys(DATA.coalitions).sort(function (a, b) { return coalName(a).localeCompare(coalName(b)); });
    var fids = Object.keys(DATA.factions).sort(function (a, b) { return facName(a).localeCompare(facName(b)); });
    for (i = 0; i < cids.length; i++) opts += '<option value="c:' + esc(cids[i]) + '">' + esc(coalName(cids[i])) + "</option>";
    opts += '</optgroup><optgroup label="Factions">';
    for (i = 0; i < fids.length; i++) opts += '<option value="f:' + esc(fids[i]) + '">' + esc(facName(fids[i])) + "</option>";
    opts += "</optgroup>";
    fp.innerHTML = opts;
    bindSuggest("ix-pa", "ix-psug-a", function (i) { pickA = i; });
    bindSuggest("ix-pb", "ix-psug-b", function (i) { pickB = i; });
    $("ix-axis").addEventListener("change", function () { moreLimit = PAGE; renderExplorer(); writeHash(); });
    $("ix-coal").addEventListener("change", function () { moreLimit = PAGE; renderExplorer(); });
    $("ix-fac").addEventListener("change", function () { moreLimit = PAGE; renderExplorer(); });
    $("ix-q").addEventListener("input", function () { moreLimit = PAGE; renderExplorer(); });
    $("ix-axis-a").addEventListener("change", renderCompare);
    $("ix-axis-b").addEventListener("change", renderCompare);
    $("ix-hgroup").addEventListener("change", renderHeat);
    $("ix-fp").addEventListener("change", function () { renderFingerprint(); writeHash(); });
    ["explorer", "compare", "heatmap", "people"].forEach(function (name) {
      $("ix-tab-" + name).addEventListener("click", function () { showView(name); });
    });
    var h = readHash();
    if (h.axis && axisById(h.axis)) $("ix-axis").value = h.axis;
    if (h.faction && DATA.factions[h.faction]) $("ix-fp").value = "f:" + h.faction;
    if (h.coalition && DATA.coalitions[h.coalition]) $("ix-fp").value = "c:" + h.coalition;
    if ($("ix-axis-b").options.length > 1) $("ix-axis-b").selectedIndex = Math.min(1, $("ix-axis-b").options.length - 1);
    showView(h.view || "explorer");
    window.addEventListener("hashchange", function () {
      var hh = readHash();
      if (hh.axis && axisById(hh.axis)) $("ix-axis").value = hh.axis;
      if (hh.faction && DATA.factions[hh.faction]) $("ix-fp").value = "f:" + hh.faction;
      if (hh.coalition && DATA.coalitions[hh.coalition]) $("ix-fp").value = "c:" + hh.coalition;
      showView(hh.view || "explorer");
    });
  }

  var src = root.getAttribute("data-src");
  if (!src) return;
  fetch(new URL(src, location.href)).then(function (r) {
    if (!r.ok) throw new Error("data");
    return r.json();
  }).then(function (d) { DATA = d; ready(); }).catch(function () {
    root.hidden = false;
    root.querySelector(".ix-needjs").textContent = "The interactive panel could not load. The topic list below is still available.";
  });
})();
