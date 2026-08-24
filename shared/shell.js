/* tools — shared shell.
   Progressive enhancement only: every page works fully without this file.
   Wires the footer theme control and one keyboard shortcut. No network, ever. */

(function () {
  "use strict";

  var KEY = "tools:theme";
  var ORDER = ["auto", "light", "dark"];
  var root = document.documentElement;

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return ORDER.indexOf(v) > -1 ? v : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function apply(mode) {
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }

  var mode = read();
  apply(mode);

  function wireTheme() {
    var btn = document.getElementById("theme");
    if (!btn) return;
    btn.hidden = false;

    function label() {
      btn.textContent = "theme: " + mode;
      btn.setAttribute("aria-label", "Colour theme: " + mode + ". Activate to change.");
    }

    btn.addEventListener("click", function () {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      apply(mode);
      label();
      try {
        localStorage.setItem(KEY, mode);
      } catch (e) {
        /* private mode — the choice just does not persist */
      }
    });

    label();
  }

  function wireSlash() {
    var target = document.querySelector("[data-primary]");
    if (!target) return;
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (a && a.isContentEditable) return;
      e.preventDefault();
      target.focus();
      if (target.select) target.select();
    });
  }

  function init() {
    wireTheme();
    wireSlash();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
