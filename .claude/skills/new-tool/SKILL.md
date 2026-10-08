---
name: new-tool
description: Build a new tool page for tools.jof.dev the way the existing ones are built — the procedure, the page shape, and the wording rules. Use when asked to add, start or scaffold a tool, or to bring an existing tool page in line with the others.
---

# Making a tool

One page, one job, nothing to read before you can use it. CLAUDE.md holds the rules and
the settled decisions; this is the order to do things in and the standard the page has to
meet. Read CLAUDE.md first if it is not already in context.

## The procedure

1. **Branch.** `git checkout -b <slug>` from `main`. The slug is the URL and the file name:
   one short lowercase word if possible (`qr`, `password`, `screen`).
2. **Copy the template.** `cp template/tool.html tools/<slug>.html`. Open it in a browser
   before changing anything, so you have seen the conventions working.
3. **Fill the head.** `<title>`, the `description` meta, and the metadata block: `title`,
   `blurb`, `tags`, `keywords`. The `<h1>` text must equal `title` exactly, and its
   `view-transition-name` must be `tool-<slug>`.
4. **Build the tool** between the comment markers in `<main>`. Leave the head, the
   `.savebar` and the footer exactly as copied.
5. **Test what you cannot see.** Anything algorithmic gets `scripts/test-<slug>.mjs`,
   written like the existing ones: it reads the tool's source, pulls the script out, and
   checks known answers. Pure interface needs no test.
6. **Build and look.** `node scripts/build.mjs`, serve `dist/`, and look at the page at
   desktop width and at a phone width. Headless Chrome will not go narrower than 500px, so
   use a real browser or device emulation for the phone check.
7. **Apply the first-screen test** below. Cut until it passes.
8. **Commit on the branch, merge into `main` with `--no-ff`.** Do not push unless asked.
9. **Add the test command** to the Commands list in CLAUDE.md and to the Layout tree.

## The shape of a page

Top to bottom, and nothing else:

- **Crumb.** `tools.jof.dev / <Title>`. The crumb goes home; there is no other navigation.
- **Heading and lede.** The `<h1>`, then one line that says what you get or what to do
  first. One line, not a paragraph. No mention of ads, tracking, privacy or being free:
  the footer says that, once.
- **The thing itself, first.** The result or the primary control is the first thing under
  the lede. In the password maker it is the password; in the QR maker it is the type
  chooser with the code beside it. Never a checklist, a legend, or a paragraph of
  instructions before the tool.
- **Controls on the left, result on the right** (`.split`), which stacks on a phone. A
  tool that is all result, like the screen test, uses sections of cards instead.
- **A verdict, then one sentence.** Where the tool judges something, the judgement is a
  word or two in the big style ("Very strong", "Strong, survives about 25% damage"), with
  at most one sentence of plain explanation under it.
- **Technical details**, collapsed, at the end of the result column. A `<dl class="facts">`
  of exact values, then at most one paragraph for the explanations that are true but not
  needed: what bits are, what the attacker model is, what version or mask was chosen.
- **Save bar, footer.** Copied from the template, never edited per tool.

## The first-screen test

Open the built page at 1280×760 in the default state. The heading, every control, the
result and the "Technical details" line should all be visible without scrolling, and
there should be no paragraph of running text anywhere above the fold except the lede.
If something does not fit, it is explanation, and explanation goes into a tooltip or
behind the toggle. The screen test is the one exception: it is a catalogue of patterns
and scrolls by design, but its intro still has to be short.

## Wording

Write for someone who does not know the field and does not want to.

- **Labels are questions or plain nouns.** "What should the code do?", "Chunks",
  "White border". Never the jargon name of the thing ("Error correction level").
- **Buttons are named after what you get.** "Download PNG", "Copy", "Make another". The
  reason you might want it goes in the tooltip, not the label.
- **Every control gets a `data-tip`,** one or two sentences, and nothing is explained
  only there: shell.js prints tips onto the page where there is no hover. A group of
  choices shares one line (`data-tip-anchor` on the container).
- **Explain once.** If the lede says it, the tooltip does not; if the footer says it, the
  page does not. Before adding a sentence, find the sentence that already covers it.
- **Prefer a sentence that tells you what to do** over one that tells you what the site
  does not do. "Copy it somewhere safe now. Close the page and it is gone." rather than
  "This is never stored anywhere."
- **Short sentences, no hedging, British spelling** (colour, grey), no exclamation marks,
  no "simply", no "just". Numbers only where they change what the reader does.
- **Verdict words are plain and ordered.** A scale reads weakest to strongest in words a
  stranger ranks correctly without a legend: Not safe, Weak, Fine for small things,
  Strong, Very strong.

## Style

- **Nothing in the tool's own `<style>` that base.css already does.** The template's
  `<style>` holds the few layout pieces every tool has needed; delete the ones you do not
  use and add only what is genuinely this tool's.
- **Shared pieces to reach for:** `.split`, `.field`, `.pair`, `.seg` (segmented choice
  with `aria-pressed`), `.actions`, `.note` (small dim text), `.facts`, `kbd`, `.panel`,
  `.mono`, `.sr` (visually hidden), `data-primary` (focused when someone presses `/`).
- **Colour means one thing.** `--ok`, `--warn`, `--bad` (in base.css, themed) for a
  verdict; `--acc` for the selected choice and links. Nothing else is coloured.
- **Monospace only for data** the visitor might copy: the password, the raw QR text, the
  facts list. Everything else is the system sans.
- **Motion:** a transition on a meter or a result is fine; anything else needs a reason,
  and all of it respects `prefers-reduced-motion`, which base.css already handles.

## What to leave out

Do not add: an "about" section, a "how it works" paragraph, a list of features, a
promise about privacy, a link back to the front page other than the crumb, a size or
byte count, a web font, an icon set, a framework, or a second file. Each of these has
been considered and the reasons are in CLAUDE.md under *Deliberately not here* and
*Design decisions*.
