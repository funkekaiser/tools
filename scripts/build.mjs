#!/usr/bin/env node
/* build.mjs — turns the tools/ sources into the dist/ site.

   For each tools/<slug>.html it inlines shared/base.css and shared/shell.js and
   writes dist/<slug>/index.html. That is the whole point of the build: the file
   people can save is one file, with nothing left to fetch. It also writes the
   front page from the metadata block each tool carries.

   Node built-ins only. No dependencies, no watch mode, no configuration. */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const TAGLINE = "No ads. No tracking. Free forever.";

// The front page lists tools under these headings, in this order. A tool names its
// heading in the "group" field of its metadata block. Groups are by what you came to do,
// and a new one is worth adding only when it would hold more than one tool.
const GROUPS = ["Test your devices", "Passwords", "Everyday"];

// Every page ends the same way. Tool sources carry this markup themselves so they
// still open straight in a browser; this is the copy the front page uses.
const FOOTER = `<footer class="foot">
  <p class="promise">Everything happens on your device. Nothing you type is sent or saved anywhere.</p>
  <div class="links">
    <span>Free and <a href="https://github.com/funkekaiser/tools">open source</a>.</span>
    <span class="spacer"></span>
    <button type="button" id="theme" hidden>Theme</button>
  </div>
</footer>`;

// Three cards need no search box. It appears once there are more tools than a glance
// takes in, which is also when the "n of m" count starts meaning something.
const SEARCH_FROM = 6;
const SEARCH = `
  <div style="margin:28px 0 16px">
    <label for="q">Search</label>
    <input type="text" id="q" data-primary spellcheck="false" placeholder="What do you need to do?"
      aria-describedby="count">
    <p class="note" id="count" aria-live="polite" style="margin:8px 0 0"></p>
  </div>
`;
// Search scores each tool by the words you type, in any order: a word counts when it starts
// a word in the tool's title, blurb, tags or keywords, and half when it is one slip away from
// one (a letter missing, extra, wrong or swapped; five letters or more). Little words are
// skipped and common endings trimmed, so "flip coin", "coin flip" and "flipping coins" agree.
// The page shows the tools with the best score, so a sentence finds the tool that fits most
// of it. This function ships in the front page as written; scripts/test-search.mjs lifts it
// out of this file and checks it against queries people actually type.
function score(text, query) {
  var SKIP = " a an and are can do for from how i in is it me my need of on or the this to want with you your ";
  function words(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean);
  }
  function stem(w) {
    if (w.length > 3 && /[^s]s$/.test(w)) w = w.slice(0, -1);
    var m = w.match(/^(.{4,})(ing|ed|er|or|e)$/);
    return !m ? w : /([^aeiou])\1$/.test(m[1]) ? m[1].slice(0, -1) : m[1];
  }
  function slip(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) ||
      a.slice(i) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  var have = words(text).map(stem), total = 0, asked = 0;
  words(query).forEach(function (q) {
    if (SKIP.indexOf(" " + q + " ") > -1) return;
    asked++;
    q = stem(q);
    if (have.some(function (w) { return w.indexOf(q) === 0; })) total += 2;
    else if (q.length >= 5 && have.some(function (w) { return slip(q, w); })) total += 1;
  });
  return asked ? total : 1;
}

const SEARCH_SCRIPT = `
<script>
(function () {
  ${score}
  var q = document.getElementById("q"), count = document.getElementById("count");
  var items = Array.prototype.slice.call(document.querySelectorAll("#list li[data-k]"));
  var groups = Array.prototype.slice.call(document.querySelectorAll("#list .group"));
  function run() {
    var scores = items.map(function (li) { return score(li.getAttribute("data-k"), q.value); });
    var best = Math.max.apply(null, scores), shown = 0;
    items.forEach(function (li, i) {
      var hit = best > 0 && scores[i] === best;
      li.hidden = !hit;
      if (hit) shown++;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector("li[data-k]:not([hidden])"); });
    count.textContent = shown === items.length
      ? items.length + (items.length === 1 ? " tool" : " tools")
      : shown === 0 ? "No tools match" : shown + " of " + items.length;
  }
  q.addEventListener("input", run);
  run();
})();
</script>`;

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Keep inlined code from ending its own tag early.
const safe = (code) => code.replace(/<\/(script|style)/gi, "<\\/$1");

const css = readFileSync(join(root, "shared", "base.css"), "utf8");
const js = readFileSync(join(root, "shared", "shell.js"), "utf8");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const tools = [];
for (const file of readdirSync(join(root, "tools")).sort()) {
  if (!file.endsWith(".html")) continue;
  const slug = file.replace(/\.html$/, "");
  let html = readFileSync(join(root, "tools", file), "utf8");

  const block = html.match(/<script type="application\/json" id="tool">([\s\S]*?)<\/script>/);
  if (!block) throw new Error(`${file} has no <script type="application/json" id="tool"> block`);
  const meta = JSON.parse(block[1]);
  for (const key of ["title", "blurb", "group", "tags", "keywords"]) {
    if (!(key in meta)) throw new Error(`${file} metadata is missing "${key}"`);
  }
  if (!GROUPS.includes(meta.group)) {
    throw new Error(`${file} has group "${meta.group}", which is not one of: ${GROUPS.join(", ")}`);
  }

  html = html
    .replace(/<link rel="stylesheet" href="\.\.\/shared\/base\.css">/,
      `<style>\n${safe(css)}</style>`)
    .replace(/<script src="\.\.\/shared\/shell\.js"><\/script>/,
      `<script>\n${safe(js)}</script>`);

  if (html.includes("../shared/")) throw new Error(`${file} still references shared/ after inlining`);
  const external = html.match(/(?:href|src)="(https?:\/\/(?!github\.com\/funkekaiser\/tools)[^"]+)"/);
  if (external) throw new Error(`${file} loads something from another site: ${external[1]}`);

  mkdirSync(join(dist, slug), { recursive: true });
  writeFileSync(join(dist, slug, "index.html"), html);
  tools.push({ slug, ...meta });
}

// Must match the view-transition-name on the tool page's own heading.
const vtName = (slug) => "tool-" + slug.replace(/[^a-z0-9]+/gi, "-");

const card = (t) => `      <li data-k="${esc([t.title, t.blurb, ...t.tags, ...t.keywords].join(" "))}">
        <a href="${esc(t.slug)}/">
          <div class="t" style="view-transition-name:${vtName(t.slug)}">${esc(t.title)}</div>
          <div class="b">${esc(t.blurb)}</div>
        </a>
      </li>`;

const sections = GROUPS.map((g, i) => [g, i, tools.filter((t) => t.group === g)])
  .filter(([, , list]) => list.length)
  .map(([g, i, list]) => `    <section class="group" aria-labelledby="g${i}">
      <h2 id="g${i}">${esc(g)}</h2>
      <ul class="tools">
${list.map(card).join("\n")}
      </ul>
    </section>`).join("\n");

// The last card is not a tool: it asks for the next one. It sits under the groups in a
// list of its own and stays put while searching, since an empty result is exactly when
// it is useful.
const SUGGEST = `    <ul class="tools suggest">
      <li>
        <a href="https://github.com/funkekaiser/tools/issues/new?template=tool-idea.md">
          <div class="t">Suggest a tool</div>
          <div class="b">Something you keep searching for? Ask for it on GitHub.</div>
        </a>
      </li>
    </ul>`;

const search = tools.length >= SEARCH_FROM;
writeFileSync(join(dist, "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tools</title>
<meta name="description" content="Simple, free tools that run on your own device. No ads, no tracking, nothing uploaded.">
<style>
${safe(css)}</style>
<script>
${safe(js)}</script>
</head>
<body>

<header class="topbar">
  <div class="crumb"><strong>tools</strong><span class="dom">.jof.dev</span></div>
  <div class="spacer"></div>
  <div class="tagline">${esc(TAGLINE)}</div>
</header>

<main>
  <h1>Tools that do one thing</h1>
  <p class="lede">The everyday utilities you search for and then have to fight through ads to use.</p>

${search ? SEARCH : ""}
  <div id="list">
${sections}
${SUGGEST}
  </div>
</main>

${FOOTER}
${search ? SEARCH_SCRIPT : ""}
</body>
</html>
`);

if (existsSync(join(root, "_headers"))) copyFileSync(join(root, "_headers"), join(dist, "_headers"));

console.log(`dist/ built — ${tools.length} tool(s): ${tools.map((t) => t.slug).join(", ")}`);
