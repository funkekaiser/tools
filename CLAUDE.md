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
- **The promise is made twice, and briefly.** The header tagline on the front page and the
  one-sentence footer on every page say no ads, nothing uploaded, free forever. Nothing else
  does: not the intro of a tool, not a note beside its result, not a list of points on the
  front page. A three-point list there was tried and removed — it said what the tagline and
  footer already said, at four times the length. Give the space back to the tools.
- **Every page ends with the same footer.** The privacy promise, then "Free and open source."
  with *open source* as the link to the repository, then the theme button, byte-for-byte
  identical on the front page and on every tool. A separate "Source code" link was there too and
  went: it said open source twice on one line. Tool sources carry the markup themselves so they still open in a browser; the
  `FOOTER` constant in build.mjs is the copy the front page uses, and `template/tool.html` is the
  copy a new tool starts from. Nothing checks that they match — a build-time comparison was tried
  and removed as machinery for a rule nobody was breaking. Moving the header, save bar and footer
  into the build so they exist once was considered and rejected as well: the build would then be
  assembling pages, and `tools/<slug>.html` would no longer be a whole page you can open. That
  independence is worth more than the repetition costs. Tool pages do not repeat an "All tools"
  link down there — the header crumb already goes home.
- **The front page has no search box until it needs one.** build.mjs leaves the search out while
  there are fewer than six tools: a labelled input and a count above three cards you can see at a
  glance is apparatus. The markup and script are still there, waiting for the seventh tool.
- **The template lives outside `tools/`.** `template/tool.html` is a real page, not a
  skeleton: it opens in a browser and runs, so the conventions can be seen working rather
  than described. It sits in its own directory because the build publishes everything in
  `tools/`, and because it is not a draft — `drafts/` is for experiments that may never
  ship. Being one level deep keeps the `../shared/` links correct when it is copied.
- **QR toughness is a minimum, not a setting.** The code is the smallest size that fits at
  the chosen level, then gets the highest error correction that still fits that size. Spare
  room becomes toughness instead of padding, and a bigger code is never chosen just to be
  tougher. Picking the size directly was considered and rejected: the sizes that fit change
  as you type, so a chosen size would keep becoming impossible.
- **Jargon goes behind a "Technical details" toggle.** The main interface uses plain words;
  the exact version, mask and mode stay available for people who want them, collapsed by
  default. The password maker follows the same rule: the headline is the verdict word, not a
  number of bits, and what bits are is explained inside the toggle.

## Layout

```
tools/<slug>.html          a whole tool: markup, styles, script, metadata block
template/tool.html         the starting point for a new tool, not published
.claude/skills/new-tool/   how to build a tool the way the others are built (/new-tool)
shared/base.css            the look, inlined into every tool by the build
shared/shell.js            theme + Save button, inlined into every tool by the build
scripts/build.mjs          tools/ -> dist/, and writes the front page
scripts/test-qr.mjs        checks the QR encoder and the payload builders in tools/qr.html
scripts/test-password.mjs  checks the generator inside tools/password.html
scripts/test-screen.mjs    checks the test patterns inside tools/screen.html
dist/                      generated, gitignored, what Cloudflare serves
drafts/                    unfinished experiments, not published
```

The metadata block inside each tool is
`<script type="application/json" id="tool">` holding `{ title, blurb, tags, keywords }`.
`title` and `blurb` show on the front page; `tags` and `keywords` only feed its search box.

## Commands

```sh
node scripts/build.mjs                 # build dist/
node scripts/test-qr.mjs               # verify the encoder and the payload builders
node scripts/test-password.mjs         # verify the password generator
node scripts/test-screen.mjs           # verify the screen test patterns
python3 -m http.server 8000 -d dist    # serve the built site
```

You can also open `tools/qr.html` directly in a browser while working — the `../shared/`
links resolve, so there is nothing to run.

## Adding a tool

Run `/new-tool`. The skill in `.claude/skills/new-tool/SKILL.md` is the procedure, the shape
of a page and the wording rules, learned from the tools built so far. This file is the record
of why; the template is the conventions running in a browser. Keep the three in agreement:
when a decision changes here, the skill and the template change with it.

Keep the template working. Nothing verifies it, and it is the one file the build never
touches, so a change to `shared/` that breaks it will not surface until someone starts a
tool with it.

Do not scaffold tools nobody asked for.

## Deployment

Cloudflare Pages runs `node scripts/build.mjs` and serves `dist/`, giving
`tools.jof.dev/<slug>/`. `_headers` is copied into `dist/` and sets a CSP with
`default-src 'none'` and `connect-src 'none'`, so rule 2 is enforced by the browser
rather than merely promised: a tool that tried to phone home would be blocked.
