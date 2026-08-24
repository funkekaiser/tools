# tools

**No ads. No tracking. Free forever.**

Everyday web utilities — the kind you search for and then have to fight through ads to
use. These run entirely on your own device. Nothing you type is sent anywhere, nothing
about you is recorded, and every tool can be saved to your computer and used with no
internet at all.

Live at **<https://tools.jof.dev>**

## Tools

| Tool | What it does |
|---|---|
| [QR code maker](https://tools.jof.dev/qr/) | Turn a link, a Wi-Fi password, or any text into a QR code. Download as an image or for printing. |
| [Password maker](https://tools.jof.dev/password/) | A strong password in short readable chunks, with an honest measure of how hard it is to guess. |

More to come.

## How it works

Each tool is a single HTML file. The build inlines the shared stylesheet and script into
it, so what gets published is genuinely one self-contained file — that is what the **Save
this tool** button hands you, and why the saved copy keeps working offline, and after this
site is long gone.

The rules the project holds itself to:

- **Nothing is fetched at runtime.** No ads, no trackers, no analytics, no CDNs, no web
  fonts, no third-party anything. The `Content-Security-Policy` in `_headers` sets
  `default-src 'none'` and `connect-src 'none'`, so this is enforced by the browser rather
  than merely promised.
- **One file per tool**, holding its markup, styles, script and metadata.
- **No framework, no bundler, no dependencies.** `scripts/build.mjs` is the only build
  step and uses Node built-ins only.
- **Plain language.** Written for people who do not know the jargon; the jargon goes
  behind a *Technical details* toggle.
- **Keyboard accessible**, with real labels, and respects your system's light/dark and
  reduced-motion settings.

## Working on it locally

```sh
node scripts/build.mjs                 # build dist/
node scripts/test-qr.mjs               # verify the QR encoder
node scripts/test-password.mjs         # verify the password generator
python3 -m http.server 8000 -d dist    # serve it, then open http://localhost:8000
```

There is no install step and nothing to download — Node is used only to run those
scripts. You can also just open `tools/qr.html` in a browser while working on it.

## Adding a tool

Copy `template/tool.html` to `tools/<slug>.html`. It is a working page, so open it in a
browser first to see the conventions running. Fill in its metadata block, replace the
placeholder between the comment markers with the real tool, and run the build.

## Licence

MIT — see [LICENSE](LICENSE). Vendored third-party code carries its own attribution in the
file where it appears; the QR encoder credits [Project
Nayuki](https://www.nayuki.io/page/qr-code-generator-library), whose reference
implementation its Reed–Solomon and placement routines follow.
