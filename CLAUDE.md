# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

`tools` is a static site of small, self-contained reimplementations of common web
utilities — the kind that are elsewhere buried in ads, trackers, and upload forms.
Deploys to <https://tools.jof.dev> via Cloudflare Pages.

Tagline: **Small, single-file, no ads, no tracking, no upload.**

## House rules

These are hard rules. They are the reason the project exists — do not relax one for
convenience, and do not add a dependency without asking first.

1. **One directory per tool** under `tools/<slug>/`, containing exactly `index.html`
   and `meta.json`.
2. **`index.html` is fully self-contained** — markup, CSS, and JS in one file. Saving
   the page to disk with Cmd-S must leave a working, readable offline tool. All of a
   tool's own JavaScript and CSS is inline. The two shared files in rule 6 are linked
   for site consistency, never depended on: open each tool's `<style>` with a short
   fallback copy of the colour tokens, so a lone saved file still renders correctly.
3. **`meta.json`** is exactly `{ "title", "blurb", "tags": [], "keywords": [] }`.
   `title` is the display name, `blurb` one plain sentence, `tags` the few words shown
   on the index card, `keywords` the extra search terms that never render.
4. **No runtime network requests.** No CDN, no web fonts, no analytics, no third-party
   anything, no telemetry, no beacons. Everything runs client side. Nothing the user
   supplies ever leaves the tab. A tool that needs a remote service does not belong here.
5. **50 KB gzipped per tool**, measured on `index.html` alone. Each tool prints its own
   actual gzipped size in its footer, inside `<span data-gz>`; `build-index.mjs` stamps
   the real number there, because a page cannot measure itself without a request.
   CI fails the build if any tool exceeds the budget.
6. **No framework, no bundler.** `shared/base.css` and `shared/shell.js` are the only
   cross-tool files, linked with plain relative paths (`../../shared/base.css`).
   Nothing else is shared; duplication between tools is fine and expected.
7. **`scripts/build-index.mjs`** reads every `tools/*/meta.json` and writes the root
   `index.html`. Node built-ins only, no dependencies, under 100 lines. The root
   `index.html` is generated — edit the script or the metadata, never the output.
8. **Vanilla JS.** No TypeScript, no transpiler, no build step other than
   `build-index.mjs`.
9. **Accessible by default.** Everything reachable and operable by keyboard, real
   `<label>`s bound to real controls, visible focus, sensible headings, live regions for
   async results. Respect `prefers-color-scheme` and `prefers-reduced-motion`.
10. **Vendored code is allowed, fetched code is not.** If a tool needs an algorithm
    implementation, paste the source into the file with an attribution comment naming
    the origin and licence. Ask before vendoring anything non-trivial.

## Layout

```
tools/<slug>/index.html   the tool, self-contained
tools/<slug>/meta.json    { title, blurb, tags[], keywords[] }
shared/base.css           tokens, resets, controls — the only shared stylesheet
shared/shell.js           header/footer wiring, theme, gzipped-size readout
scripts/build-index.mjs   meta.json -> root index.html
index.html                generated, do not hand-edit
drafts/                   unfinished experiments; not published, not linted, not indexed
```

## Commands

```sh
node scripts/build-index.mjs      # regenerate the root index, stamp footer sizes
node scripts/check-size.mjs       # enforce the 50 KB gzipped budget, validate meta.json
node scripts/test-qr.mjs          # verify the QR encoder inside tools/qr/index.html
python3 -m http.server 8000       # serve locally; open http://localhost:8000
```

Run the first two after touching any tool. CI runs all three, then fails if the
generated output was not committed.

`test-qr.mjs` lifts the encoder out of the shipped page and checks it against the
published `HELLO WORLD` codeword vector, the format and version BCH strings, the
documented byte capacities, and a full encode/decode round trip over all 160
version/level combinations. A tool with real algorithmic content should get the same
treatment; a tool that is only UI does not need a test.

## Adding a tool

Copy `tools/qr/` — it is the reference implementation and every later tool starts as a
copy of it. Keep its document skeleton, its `shared/` links, its footer, and its keyboard
and label conventions; replace the tool-specific CSS and JS. Then write `meta.json` and
re-run `build-index.mjs`.

Do not scaffold tools nobody asked for.

## Deployment

Cloudflare Pages builds with `node scripts/build-index.mjs` and serves the repo root
(`wrangler.toml`), at <https://tools.jof.dev>. `_headers` sets a CSP with
`default-src 'none'` and `connect-src 'none'`, which makes rule 4 enforced rather than
merely intended: a tool that tried to fetch something would be blocked in production.
Note that serving the repo root also serves `README.md`, `scripts/` and `drafts/` — keep
nothing here that should not be public.
