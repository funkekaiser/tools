/* Verifies the pattern definitions that ship inside tools/screen.html. The
   module is lifted straight out of the page, so this checks the numbers users
   actually see, not a copy of them. Node built-ins only.

   A test pattern is the one kind of picture nobody can proofread. A
   checkerboard with a flaw in it still looks like a checkerboard, and a
   shadow ladder missing a step still looks like a ladder — and either would
   quietly tell someone their screen is fine when it is not. So the tiles are
   checked pixel by pixel, and the ladders against arithmetic. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'screen.html'), 'utf8');

const start = page.indexOf('var PATTERNS = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the pattern module in tools/screen.html');
  process.exit(1);
}
const PATTERNS = new Function(page.slice(start, end + 6) + '\nreturn PATTERNS;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

// ---- 1. tiles, pixel by pixel ----
// Read as they are drawn: repeated from the origin, over an area big enough
// that a mistake at a tile boundary has somewhere to show itself.
const N = 16;
const at = (tile, x, y) => tile[y % tile.length][x % tile[0].length];
const each = (fn) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(x, y); };
const share = (tile) => {
  let lit = 0;
  each((x, y) => { lit += at(tile, x, y); });
  return lit / (N * N);
};

const { checker, lines, grid } = PATTERNS.TILES;

each((x, y) => {
  ok(at(checker, x, y) !== at(checker, x + 1, y), `checker: ${x},${y} matches the pixel beside it`);
  ok(at(checker, x, y) !== at(checker, x, y + 1), `checker: ${x},${y} matches the pixel below it`);
});
ok(share(checker) === 0.5, 'checker: not an even split of black and white');

each((x, y) => {
  ok(at(lines, x, y) === at(lines, x + 1, y), `lines: row ${y} changes along its length`);
  ok(at(lines, x, y) !== at(lines, x, y + 1), `lines: row ${y} matches the row below it`);
});
ok(share(lines) === 0.5, 'lines: not an even split of black and white');

// One black line every fourth pixel, one pixel wide, in both directions.
ok(grid.length === 4 && grid[0].length === 4, 'grid: tile is not 4 by 4');
each((x, y) => {
  const isLine = x % 4 === 0 || y % 4 === 0;
  ok(at(grid, x, y) === (isLine ? 0 : 1), `grid: wrong pixel at ${x},${y}`);
});
// Which leaves a 3 by 3 white square in each 4 by 4 cell.
ok(share(grid) === 9 / 16, 'grid: wrong proportion of white');

// ---- 2. greys, against the arithmetic ----
for (const [percent, code] of [[0, 0], [5, 13], [15, 38], [25, 64], [50, 128], [75, 191], [95, 242], [100, 255]]) {
  ok(PATTERNS.grey(percent) === code, `grey(${percent}) is ${PATTERNS.grey(percent)}, expected ${code}`);
  ok(Math.abs(PATTERNS.grey(percent) / 255 - percent / 100) <= 0.5 / 255, `grey(${percent}) is not the nearest code to that share of full brightness`);
}

// ---- 3. the ladders ----
// The page describes each of these in words as well ("Eleven strips…"), so a
// change of length here means the prose beside it needs changing too.
const { shadows, highlights, even } = PATTERNS.STEPS;
const ladders = { shadows, highlights, even };

for (const [name, codes] of Object.entries(ladders)) {
  ok(codes.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${name}: a code is outside 0-255`);
  ok(codes.every((v, i) => i === 0 || v > codes[i - 1]), `${name}: codes are not strictly increasing`);
}

ok(shadows.length === 11, `shadows: ${shadows.length} strips, the page says eleven`);
ok(shadows[0] === 0, 'shadows: does not start at black');
ok(shadows[shadows.length - 1] === 16, 'shadows: does not end at 16');
// The point of the pattern is the smallest steps a screen can be asked for.
ok(shadows.slice(0, 7).every((v, i) => v === i), 'shadows: the first seven are not 0 to 6, one code apart');

ok(highlights.length === 10, `highlights: ${highlights.length} strips, the page says ten`);
ok(highlights[0] === 239, 'highlights: does not start at 239');
ok(highlights[highlights.length - 1] === 255, 'highlights: does not end at white');

ok(even.length === 16, `even: ${even.length} steps, the page says sixteen`);
ok(even[0] === 0 && even[15] === 255, 'even: does not run from black to white');
const gaps = even.slice(1).map((v, i) => v - even[i]);
ok(gaps.every((g) => g === gaps[0]), 'even: the steps are not all the same size');

// ---- 4. every button is wired to something ----
// A button with a name nothing answers to would simply do nothing when pressed.
const registry = page.slice(page.indexOf('var TEST = {'), page.indexOf('\n  };', page.indexOf('var TEST = {')));
const drawn = new Set([...registry.matchAll(/^ {4}([a-z0-9]+):/gm)].map((m) => m[1]));
const shown = [...page.matchAll(/data-pat="([a-z0-9]+)"/g)].map((m) => m[1]);

ok(shown.length > 0 && drawn.size > 0, 'could not find the buttons or the drawings');
ok(new Set(shown).size === shown.length, 'the page has two buttons with the same name');
for (const id of shown) ok(drawn.has(id), `the "${id}" button has nothing to draw`);
for (const id of drawn) ok(shown.includes(id), `"${id}" is drawn but has no button`);

// Every button needs the sentence that appears over the pattern.
const missing = [...page.matchAll(/<button[^>]*data-pat="([a-z0-9]+)"(?![^>]*data-hint)[^>]*>/g)];
ok(missing.length === 0, `buttons with no data-hint: ${missing.map((m) => m[1]).join(', ')}`);

console.log(fails
  ? `\n${fails} check(s) failed`
  : `all checks passed — ${shown.length} patterns, ${Object.keys(ladders).length} ladders, 3 tiles`);
process.exit(fails ? 1 : 0);
