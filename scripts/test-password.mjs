/* Verifies the password generator that ships inside tools/password.html.
   The module is lifted straight out of the page, so this checks the code
   users actually run, not a copy of it. Node built-ins only.

   Two things here can be wrong in ways nobody would ever see: a biased
   draw from crypto, and an entropy figure that flatters the password.
   Both are checked against something independent. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'password.html'), 'utf8');

const start = page.indexOf('var PW = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the password module in tools/password.html');
  process.exit(1);
}
// The page exports only what it uses; the tests need the internals too.
const source = page.slice(start, end + 6)
  .replace('return { generate: generate, analyse: analyse, duration: duration, verdict: verdict,',
    'return { MIXES, randomInt, countPasswords, log2Big, satisfies, ' +
    'generate: generate, analyse: analyse, duration: duration, verdict: verdict,');
const PW = new Function(source + '\nreturn PW;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

// ---- 1. counting, against brute force ----
// Every string over a small alphabet, filtered by hand, versus the
// inclusion-exclusion the page uses.
function brute(n, sizes, len) {
  // classes take the first sizes[0] symbols, then the next sizes[1], and so on
  const bounds = [];
  let at = 0;
  for (const s of sizes) { bounds.push([at, at + s]); at += s; }
  let count = 0;
  const digits = new Array(len).fill(0);
  const total = n ** len;
  for (let i = 0; i < total; i++) {
    let x = i;
    for (let d = 0; d < len; d++) { digits[d] = x % n; x = Math.floor(x / n); }
    if (bounds.every(([lo, hi]) => digits.some((c) => c >= lo && c < hi))) count++;
  }
  return BigInt(count);
}
for (const [n, sizes, len] of [[5, [2], 3], [5, [2, 1], 4], [6, [1, 2, 1], 4], [4, [1, 1], 5], [7, [3, 2], 3]]) {
  const got = PW.countPasswords(n, sizes, len);
  const want = brute(n, sizes, len);
  ok(got === want, `count n=${n} sizes=${sizes} len=${len}: got ${got} want ${want}`);
}
// No constraints at all is just n^len.
ok(PW.countPasswords(57, [], 17) === 57n ** 17n, 'unconstrained count is n^len');
console.log('counting: 6 cases checked against brute force');

// ---- 2. counting the real alphabets, against a different algorithm ----
// Walks position by position tracking which required classes have been seen,
// which shares no arithmetic with inclusion-exclusion.
function dp(n, sizes, len) {
  const full = (1 << sizes.length) - 1;
  let state = new Array(full + 1).fill(0n);
  state[0] = 1n;
  const other = BigInt(n - sizes.reduce((a, b) => a + b, 0));
  for (let i = 0; i < len; i++) {
    const next = new Array(full + 1).fill(0n);
    for (let mask = 0; mask <= full; mask++) {
      if (state[mask] === 0n) continue;
      next[mask] += state[mask] * other;
      sizes.forEach((size, k) => { next[mask | (1 << k)] += state[mask] * BigInt(size); });
    }
    state = next;
  }
  return state[full];
}
for (const name of Object.keys(PW.MIXES)) {
  const m = PW.MIXES[name];
  const sizes = m.required.map((s) => s.length);
  for (const len of [6, 15, 17, 20, 64]) {
    const got = PW.countPasswords(m.chars.length, sizes, len);
    ok(got === dp(m.chars.length, sizes, len), `${name} count at length ${len} disagrees with the walk`);
    ok(got > 0n, `${name} count at length ${len} is not positive`);
  }
}
console.log('counting: 3 alphabets x 5 lengths cross-checked');

// ---- 3. log2 of a BigInt ----
for (const x of [1n, 2n, 3n, 255n, 256n, 1n << 40n, 10n ** 18n]) {
  const want = Math.log2(Number(x));
  ok(Math.abs(PW.log2Big(x) - want) < 1e-9, `log2Big(${x}): got ${PW.log2Big(x)} want ${want}`);
}
ok(Math.abs(PW.log2Big(1n << 400n) - 400) < 1e-9, 'log2Big past what a double can hold');
ok(PW.log2Big(0n) === -Infinity, 'log2Big(0) is -Infinity');
{ // the headline figure itself: 15 characters out of 57, minus the strings
  // that miss a capital or a digit
  const a = PW.analyse('standard', 3, 5);
  ok(a.alphabet === 57, `standard alphabet is ${a.alphabet}, expected 57`);
  ok(Math.abs(a.bits - Math.log2(Number(a.count))) < 1e-6, 'analyse bits disagree with its own count');
  ok(a.bits > 87 && a.bits < 88, `3 chunks of 5 should be about 87.3 bits, got ${a.bits}`);
  ok(a.bits < 15 * Math.log2(57), 'requiring a capital and a digit must lower the entropy, not raise it');
}
console.log('log2: 9 values checked');

// ---- 4. the draw is uniform ----
{
  const counts = new Array(7).fill(0);
  const N = 140000;
  for (let i = 0; i < N; i++) {
    const v = PW.randomInt(7);
    ok(Number.isInteger(v) && v >= 0 && v < 7, `randomInt(7) returned ${v}`);
    counts[v]++;
  }
  // chi-square, 6 degrees of freedom: 24.1 is p < 0.0005, so a fair draw
  // trips this about once in 2000 runs and a modulo bias trips it every time.
  const expect = N / 7;
  const chi = counts.reduce((a, c) => a + ((c - expect) ** 2) / expect, 0);
  ok(chi < 24.1, `randomInt(7) looks biased: chi-square ${chi.toFixed(1)}, counts ${counts}`);
  ok(PW.randomInt(1) === 0, 'randomInt(1) is always 0');
  console.log(`uniformity: ${N.toLocaleString('en-US')} draws, chi-square ${chi.toFixed(1)}`);
}

// ---- 5. the passwords themselves ----
let made = 0;
for (const name of Object.keys(PW.MIXES)) {
  const m = PW.MIXES[name];
  for (const [groups, per] of [[2, 3], [3, 5], [3, 6], [8, 8]]) {
    for (let i = 0; i < 120; i++) {
      const pw = PW.generate(name, groups, per);
      made++;
      const parts = pw.split('-');
      ok(parts.length === groups, `${name} ${groups}x${per}: ${parts.length} chunks in "${pw}"`);
      ok(parts.every((p) => p.length === per), `${name} ${groups}x${per}: wrong chunk length in "${pw}"`);
      const body = parts.join('');
      ok([...body].every((c) => m.chars.includes(c)), `${name}: stray character in "${pw}"`);
      ok(PW.satisfies(body, m.required), `${name}: "${pw}" misses a required character`);
    }
  }
}
console.log(`passwords: ${made} generated, all well formed`);

{ // two passwords in a row being equal would mean the randomness is stuck
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(PW.generate('standard', 3, 5));
  ok(seen.size === 500, `500 passwords produced only ${seen.size} distinct values`);
}

{ // the capital and the digit must not have favourite positions — a generator
  // that patches them in at a fixed spot passes every test above but leaks
  // exactly where to look.
  const positions = new Array(15).fill(0);
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const body = PW.generate('standard', 3, 5).split('-').join('');
    for (let p = 0; p < 15; p++) if (/[0-9]/.test(body[p])) positions[p]++;
  }
  const expect = positions.reduce((a, b) => a + b, 0) / 15;
  const chi = positions.reduce((a, c) => a + ((c - expect) ** 2) / expect, 0);
  ok(chi < 39.2, `digits favour a position: chi-square ${chi.toFixed(1)} over 14 df`);
  console.log(`placement: digits spread evenly across all 15 slots (chi-square ${chi.toFixed(1)})`);
}

// ---- 6. the words put on the numbers ----
const D = [
  [0, 'no time at all'], [0.4, 'less than a second'], [30, '30 seconds'],
  [300, '5 minutes'], [18000, '5 hours'], [432000, '5 days'],
  [7889400, '3 months'], [31557600 * 4, '4 years'], [31557600 * 4200, '4.2 thousand years'],
  [31557600 * 2e10, '20 billion years'], [31557600 * 1e22, 'longer than anyone has a word for']
];
for (const [s, want] of D) ok(PW.duration(s) === want, `duration(${s}): got "${PW.duration(s)}" want "${want}"`);
ok(PW.sci(10n ** 30n) === '1.00 x 10^30', `sci(10^30): got "${PW.sci(10n ** 30n)}"`);
ok(PW.sci(1234n) === '1,234', `sci(1234): got "${PW.sci(1234n)}"`);

// The verdict must never soften as the password gets better.
const RANK = { bad: 0, warn: 1, ok: 2 };
let last = -1;
for (let bits = 0; bits <= 200; bits++) {
  const r = RANK[PW.verdict(bits).tone];
  ok(r >= last, `verdict got weaker at ${bits} bits`);
  last = r;
}
ok(PW.verdict(PW.analyse('standard', 3, 5).bits).tone === 'ok', 'the default password is not rated safe');
ok(PW.verdict(PW.analyse('easy', 2, 3).bits).tone !== 'ok', 'the shortest password is rated safe');
console.log('wording: durations, scale and verdicts checked');

console.log(fails ? `\n${fails} failure(s)` : '\nall password tests passed');
process.exit(fails ? 1 : 0);
