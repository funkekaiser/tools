# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

**tools** is a small collection of everyday web utilities — the kind you search for and
then have to fight through ads to use. Free, no tracking, nothing uploaded.
Lives at <https://tools.jof.dev>, deployed by Cloudflare Pages.

Tagline: **No ads. No tracking. Free forever.**

## The rules

The spirit is: keep it as simple as possible, and add nothing else.

1. **One file per tool.** `tools/<slug>.html` holds the markup, the styles, the script,
   and a small JSON metadata block. There is no second file for a tool.
2. **Nothing is fetched at runtime.** No ads, no trackers, no analytics, no CDNs, no web
   fonts, no third-party anything. Everything runs on the visitor's device and nothing
   they type ever leaves it. This is the entire point of the project — it is not
   negotiable, and it is not a performance preference.
3. **The build inlines the shared files.** Author a tool against
   `../shared/base.css` and `../shared/shell.js` so the source opens straight in a
   browser; `node scripts/build.mjs` swaps those two tags for the real contents and
   writes `dist/<slug>/index.html`. The published page is genuinely one file.
4. **Every tool can be kept.** `shell.js` provides a Save button that hands the visitor
   the page itself — one file that works with no internet, forever, even if this site
   goes away. Include the `.savebar` block and shell.js wires it up.
5. **Plain language.** Write for someone who does not know what "error correction level"
   means. Explain things in the interface; put the jargon behind a *Technical details*
   toggle. Being small and single-file is a nice property, not the pitch.
6. **Vanilla everything.** No framework, no bundler, no TypeScript, no dependencies.
   `scripts/build.mjs` is the only build step and uses Node built-ins only.
7. **Accessible by default.** Keyboard reachable, real `<label>`s on real controls,
   visible focus, sensible headings. Respect `prefers-color-scheme` and
   `prefers-reduced-motion`.
8. **Test what you cannot see.** A tool with real algorithmic content gets a test, because
   a wrong answer looks exactly like a right one. A tool that is only interface does not.

## Deliberately not here

Earlier drafts had a 50 KB gzipped budget per tool, a size printed in each footer, and a
line limit on the build script. They are gone on purpose. The budget number was arbitrary,
enforcing it meant a size-check script, and printing the size meant the build had to gzip,
stamp and re-gzip each file until the number stopped changing. All of that was machinery
in service of a rule nobody needed. Keep tools small because small is good, not because
something fails the build. Do not reintroduce any of it.

## Design decisions

These choices are settled and recorded so they are not quietly undone later.

- **Nothing is explained by hover alone.** Control explanations live in a `data-tip`
  attribute. On pointer devices shell.js shows them as a tooltip on hover and on keyboard
  focus. Where `(hover: none)` matches — touch screens — shell.js prints the same text onto
  the page as a `.tip-inline` paragraph instead. A tooltip is never the only way to read
  something.
- **Grouped choices share one explanation line.** A container marked `data-tip-anchor` (like
  the toughness buttons) gets a single inline line that follows whichever option is
  selected, rather than one paragraph per button.
- **Buttons are named after what you get, not what you might do with it.** "Download PNG"
  and "Download SVG", not "Download for printing". The use case belongs in the tooltip; the
  button says what the file is.
- **The save bar sits between `</main>` and `<footer>`.** It was inside the tool originally
  and read as "save the QR code" rather than "save this page". It is page furniture, not a
  tool control, so it lives outside the tool.
- **One column width per page.** Everything shares the `--max` container. A narrower reading
  column was tried for the front page and reverted — it looked worse. The intro paragraph
  must span the full column; capping it to a short measure makes it read as accidentally
  indented.
- **Headings use `text-wrap: balance`, body copy uses `text-wrap: pretty`.** Stops
  unbalanced headings and paragraphs that end on a single stranded word.
- **System fonts only.** Sans for prose and controls, monospace only for actual data. This
  follows from the no-network rule — a web font would be a request — but it is also the
  friendlier choice for a general audience.
- **The tool's name travels between pages.** base.css opts into cross-document view
  transitions with `@view-transition { navigation: auto; }`. Each tool's `<h1>` carries
  `view-transition-name: tool-<slug>`, matching the name build.mjs puts on that tool's card
  title on the front page, so the title animates from the card into the heading. This
  requires the `<h1>` text to be identical to the tool's `title` in its metadata block,
  otherwise the morph reads as two different things crossfading. Browsers without support
  just navigate normally. Disabled under `prefers-reduced-motion`.
- **A tool page is about the tool.** The site's promises — no ads, nothing uploaded, free
  forever — belong on the front page and in the footer, not in the header and intro of every
  tool. Say it once, put it out of the way, and give the space back to the thing the visitor
  came to use.
- **Every page ends with the same footer.** The privacy promise, "Free and open source.", the
  theme button and the source link, in that order, byte-for-byte identical on the front page and
  on every tool. Tool sources carry the markup themselves so they still open in a browser; the
  `FOOTER` constant in build.mjs is the copy the front page uses, and the build refuses to
  publish a tool whose footer has drifted from it. Tool pages do not repeat an "All tools" link
  down there — the header crumb already goes home.
- **Jargon goes behind a "Technical details" toggle.** The main interface uses plain words;
  the exact version, mask and mode stay available for people who want them, collapsed by
  default.

## Layout

```
tools/<slug>.html          a whole tool: markup, styles, script, metadata block
shared/base.css            the look, inlined into every tool by the build
shared/shell.js            theme + Save button, inlined into every tool by the build
scripts/build.mjs          tools/ -> dist/, and writes the front page
scripts/test-qr.mjs        checks the QR encoder inside tools/qr.html
scripts/test-password.mjs  checks the generator inside tools/password.html
dist/                      generated, gitignored, what Cloudflare serves
drafts/                    unfinished experiments, not published
```

The metadata block inside each tool is
`<script type="application/json" id="tool">` holding `{ title, blurb, tags, keywords }`.
`title` and `blurb` show on the front page; `tags` and `keywords` only feed its search box.

## Commands

```sh
node scripts/build.mjs                 # build dist/
node scripts/test-qr.mjs               # verify the QR encoder
node scripts/test-password.mjs         # verify the password generator
python3 -m http.server 8000 -d dist    # serve the built site
```

You can also open `tools/qr.html` directly in a browser while working — the `../shared/`
links resolve, so there is nothing to run.

## Adding a tool

Copy `tools/qr.html`. Keep its head, its `../shared/` links, its metadata block, its
`.savebar`, and its label and heading conventions; replace the rest. Then run the build.

Do not scaffold tools nobody asked for.

## Deployment

Cloudflare Pages runs `node scripts/build.mjs` and serves `dist/`, giving
`tools.jof.dev/<slug>/`. `_headers` is copied into `dist/` and sets a CSP with
`default-src 'none'` and `connect-src 'none'`, so rule 2 is enforced by the browser
rather than merely promised: a tool that tried to phone home would be blocked.
