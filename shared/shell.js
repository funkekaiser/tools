/* tools — shared behaviour, inlined into every tool by the build.
   Two jobs: the colour theme, and letting people keep a copy of the tool.
   Nothing here talks to a network. */

(function () {
  "use strict";

  var root = document.documentElement;
  var KEY = "tools:theme";
  var ORDER = ["auto", "light", "dark"];

  /* ---- theme: follows the operating system unless told otherwise ---- */

  var mode = "auto";
  try {
    var saved = localStorage.getItem(KEY);
    if (ORDER.indexOf(saved) > -1) mode = saved;
  } catch (e) { /* private browsing */ }

  function apply() {
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }
  apply();

  /* ---- save: hand the visitor this page, exactly as it is ----
     Captured before anything is edited, so the copy opens clean. Because the
     build inlines every style and script, the saved file is the whole tool —
     it keeps working with no internet, and after this site is long gone. */

  var source = null;
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

  function filename() {
    var slug = location.pathname.replace(/\/+$/, "").split("/").pop();
    if (!slug || slug.indexOf(".") > -1) slug = (document.title || "tool").split(/[\s—-]/)[0];
    return (slug || "tool").toLowerCase() + ".html";
  }

  function save(btn) {
    if (!source) return;
    var url = URL.createObjectURL(new Blob([source], { type: "text/html" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    if (!btn) return;
    var was = btn.textContent;
    btn.textContent = "Saved";
    btn.classList.add("done");
    setTimeout(function () {
      btn.textContent = was;
      btn.classList.remove("done");
    }, 1600);
  }

  /* ---- tooltips: hover or keyboard focus, one shared element ---- */

  var tip = null, tipFor = null;

  function showTip(el) {
    var text = el.getAttribute("data-tip");
    if (!text) return;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tip";
      tip.id = "tooltip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.classList.add("on");
    el.setAttribute("aria-describedby", "tooltip");
    tipFor = el;

    var anchor = el.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    var top = anchor.top - box.height - 8;
    if (top < 8) top = anchor.bottom + 8;
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }

  function hideTip() {
    if (tip) tip.classList.remove("on");
    if (tipFor) tipFor.removeAttribute("aria-describedby");
    tipFor = null;
  }

  function wireTips() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tip]"), function (el) {
      el.addEventListener("mouseenter", function () { showTip(el); });
      el.addEventListener("focus", function () { showTip(el); });
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("blur", hideTip);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });
    window.addEventListener("scroll", hideTip, true);
  }

  function init() {
    source = "<!DOCTYPE html>\n" + root.outerHTML;

    var theme = document.getElementById("theme");
    if (theme) {
      theme.hidden = false;
      var label = function () {
        theme.textContent = mode === "auto" ? "Theme: automatic" : "Theme: " + mode;
      };
      theme.addEventListener("click", function () {
        mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
        apply();
        label();
        try { localStorage.setItem(KEY, mode); } catch (e) { /* not persisted */ }
      });
      label();
    }

    var key = document.getElementById("savekey");
    if (key) key.textContent = isMac ? "⌘ S" : "Ctrl + S";

    var btn = document.getElementById("save");
    if (btn) btn.addEventListener("click", function () { save(btn); });

    wireTips();

    var focusTarget = document.querySelector("[data-primary]");
    if (focusTarget) {
      document.addEventListener("keydown", function (e) {
        if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
        var el = document.activeElement;
        if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
        e.preventDefault();
        focusTarget.focus();
        if (focusTarget.select) focusTarget.select();
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
