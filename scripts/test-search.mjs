/* Verifies the front-page search in scripts/build.mjs. The matcher is lifted
   straight out of the build script, which puts it into the page as written, and
   is run against the real metadata of every tool in tools/. Node built-ins only.

   A search that misses looks exactly like a site without the tool. Each query
   here is something a person might type, with the tools it should find. */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const build = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8');

const start = build.indexOf('function matches(text, query) {');
const end = build.indexOf('\n}\n', start);
if (start < 0 || end < 0) {
  console.error('could not find the matcher in scripts/build.mjs');
  process.exit(1);
}
const matches = new Function(build.slice(start, end + 2) + '\nreturn matches;')();

const tools = readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.html')).map((f) => {
  const page = readFileSync(join(root, 'tools', f), 'utf8');
  const m = JSON.parse(page.match(/<script type="application\/json" id="tool">([\s\S]*?)<\/script>/)[1]);
  return { slug: f.replace(/\.html$/, ''), text: [m.title, m.blurb, ...m.tags, ...m.keywords].join(' ') };
});
const slugs = new Set(tools.map((t) => t.slug));

let fails = 0, checks = 0;
const find = (q) => tools.filter((t) => matches(t.text, q)).map((t) => t.slug).sort();

// Each listed tool must be found. Tools that are not in tools/ right now are
// skipped, so this keeps passing while a tool is on a branch of its own.
const FINDS = [
  ['word count', ['words']],
  ['count words', ['words']],
  ['character counter', ['words']],
  ['coin flip', ['random']],
  ['flip coin', ['random']],
  ['flipping coins', ['random']],
  ['roll dice', ['random']],
  ['pick a name', ['random']],
  ['password generator', ['password']],
  ['generate password', ['password']],
  ['strong password', ['password']],
  ['memorable password', ['passphrase']],
  ['diceware', ['passphrase']],
  ['correct horse battery staple', ['passphrase']],
  ['resize image', ['photo']],
  ['shrink photo', ['photo']],
  ['make photo smaller', ['photo']],
  ['compress picture', ['photo']],
  ['remove location from photo', ['photo']],
  ['wifi qr', ['qr']],
  ['qr wifi', ['qr']],
  ['wifi password', ['qr']],
  ['Wi-Fi', ['qr']],
  ['test my speakers', ['spectrum', 'surround', 'tone']],
  ['check headphones', ['surround']],
  ['hearing test', ['tone']],
  ['5.1', ['surround']],
  ['guitar tuner', ['spectrum']],
  ['tune guitar', ['spectrum']],
  ['dead pixels', ['screen']],
  ['monitor test', ['screen']],
  ['refresh rate', ['screen']],
  ['passw', ['password']],          // still typing
  ['QR', ['qr']],
];

// Exactly these, nothing else: the old search matched letters inside words.
const EXACT = [
  ['', [...slugs]],
  ['   ', [...slugs]],
  ['my', [...slugs]],               // only little words: show everything
  ['ip', ['screen']],               // "ips glow", not "tips" or "description"
  ['ink', []],                      // not "pink" or "thinking"
  ['colour', []],
  ['spreadsheet', []],
];

for (const [q, want] of FINDS) {
  const got = find(q);
  for (const slug of want.filter((s) => slugs.has(s))) {
    checks++;
    if (!got.includes(slug)) { fails++; console.log(`FAIL "${q}" should find ${slug}, found ${got.join(', ') || 'nothing'}`); }
  }
}
for (const [q, want] of EXACT) {
  checks++;
  const w = want.filter((s) => slugs.has(s)).sort();
  const got = find(q);
  if (got.join() !== w.join()) { fails++; console.log(`FAIL "${q}" found ${got.join(', ') || 'nothing'}, want ${w.join(', ') || 'nothing'}`); }
}

console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
