/* Open the folded Sources box when a [n] citation or #src-n hash is used. */
(function () {
  function openTo(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var fold = el.closest("details.sources-fold");
    if (fold && !fold.open) fold.open = true;
    requestAnimationFrame(function () {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
  function fromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (/^src-\d+$/.test(id)) openTo(id);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#src-"]');
    if (!a) return;
    var id = (a.getAttribute("href") || "").replace(/^#/, "");
    if (!/^src-\d+$/.test(id)) return;
    e.preventDefault();
    if (history.replaceState) history.replaceState(null, "", "#" + id);
    else location.hash = id;
    openTo(id);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fromHash);
  } else {
    fromHash();
  }
  window.addEventListener("hashchange", fromHash);
})();
