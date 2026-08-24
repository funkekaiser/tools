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
  for (const key of ["title", "blurb", "tags", "keywords"]) {
    if (!(key in meta)) throw new Error(`${file} metadata is missing "${key}"`);
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

const cards = tools.map((t) => `      <li data-k="${
  esc([t.title, t.blurb, ...t.tags, ...t.keywords].join(" ").toLowerCase())}">
        <a href="${esc(t.slug)}/">
          <div class="t" style="view-transition-name:${vtName(t.slug)}">${esc(t.title)}</div>
          <div class="b">${esc(t.blurb)}</div>
        </a>
      </li>`).join("\n");

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

  <ul class="points">
    <li><b>Free forever</b>No ads, no accounts, no upsell, nothing to sign up for.</li>
    <li><b>Nothing leaves your device</b>Whatever you type stays in your browser. None of it is
      sent anywhere, and nothing about you is recorded.</li>
    <li><b>Yours to keep</b>Save any tool to your computer in one click. It keeps working with no
      internet at all.</li>
  </ul>

  <div style="margin:28px 0 16px">
    <label for="q">Search</label>
    <input type="text" id="q" data-primary spellcheck="false" placeholder="What do you need to do?"
      aria-describedby="count">
    <p class="note" id="count" aria-live="polite" style="margin:8px 0 0"></p>
  </div>

  <ul class="tools" id="list">
${cards}
  </ul>
</main>

<footer class="foot">
  <div class="links">
    <span>Free and open source.</span>
    <span class="spacer"></span>
    <button type="button" id="theme" hidden>Theme</button>
    <a href="https://github.com/funkekaiser/tools">Source code</a>
  </div>
</footer>

<script>
(function () {
  var q = document.getElementById("q"), count = document.getElementById("count");
  var items = Array.prototype.slice.call(document.querySelectorAll("#list li"));
  function run() {
    var v = q.value.trim().toLowerCase(), shown = 0;
    items.forEach(function (li) {
      var hit = !v || li.getAttribute("data-k").indexOf(v) > -1;
      li.hidden = !hit;
      if (hit) shown++;
    });
    count.textContent = shown === items.length
      ? items.length + (items.length === 1 ? " tool" : " tools")
      : shown + " of " + items.length;
  }
  q.addEventListener("input", run);
  run();
})();
</script>
</body>
</html>
`);

if (existsSync(join(root, "_headers"))) copyFileSync(join(root, "_headers"), join(dist, "_headers"));

console.log(`dist/ built — ${tools.length} tool(s): ${tools.map((t) => t.slug).join(", ")}`);
