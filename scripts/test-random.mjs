/* Verifies the picker that ships inside tools/random.html. The module is
   lifted straight out of the page, so this checks the code users actually
   run, not a copy of it. Node built-ins only.

   A biased pick looks exactly like a fair one, so every check here is
   either against a known answer or a chi-square test that the modulo
   shortcut would fail. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'random.html'), 'utf8');

const start = page.indexOf('var PICK = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the picker module in tools/random.html');
  process.exit(1);
}
const source = page.slice(start, end + 6);
// The module reads `crypto` when it draws, so a test can hand it a fake one.
const load = (cryptoImpl) => new Function('crypto', source + '\nreturn PICK;')(cryptoImpl);
const PICK = load(globalThis.crypto);

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

const TWO53 = 2 ** 53;

// chi-square of observed counts against equal expected counts
function chi(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  const e = n / counts.length;
  return counts.reduce((a, c) => a + ((c - e) ** 2) / e, 0);
}
// 0.9995 quantiles: a fair draw trips these about once in 2000 runs.
const CRIT = { 1: 12.1, 2: 15.2, 3: 17.7, 5: 22.1, 6: 24.1, 9: 29.7, 19: 45.0, 23: 51.2 };

// ---- 1. the rejection boundary, with a fake source ----
// Feeds exact 53-bit values so the accept/reject edge is checked to the unit.
function fakeFrom(values) {
  let i = 0;
  return {
    getRandomValues(buf) {
      const v = values[i++];
      if (v === undefined) throw new Error('fake source ran dry');
      buf[0] = Math.floor(v / 2 ** 32) * 2 ** 11;   // the module keeps the top 21 bits
      buf[1] = v % 2 ** 32;
      return buf;
    },
    used: () => i
  };
}
for (const n of [3, 7, 10, 1000, 2 ** 32 + 1, 3 * 2 ** 51]) {
  const limit = TWO53 - TWO53 % n;
  // The last accepted value, then the first rejected one followed by zero.
  let f = fakeFrom([limit - 1]);
  ok(load(f).below(n) === (limit - 1) % n, `below(${n}) rejected its last fair value`);
  f = fakeFrom([limit, 0]);
  const P = load(f);
  ok(P.below(n) === 0 && f.used() === 2, `below(${n}) kept a value it should have thrown away`);
  ok(P.thrown() === (limit < TWO53 ? 1 : 0), `below(${n}) counted ${P.thrown()} thrown away`);
  f = fakeFrom([TWO53 - 1, 5]);
  ok(load(f).below(n) === 5 % n, `below(${n}) kept the very top value`);
}
{ // a power of two divides 2^53, so nothing is ever thrown away
  const f = fakeFrom([TWO53 - 1]);
  ok(load(f).below(1024) === 1023, 'below(1024) threw away a value it did not need to');
}
console.log('boundary: accept and reject edges checked for 7 sizes');

// ---- 2. ranges include both ends ----
{
  const f = fakeFrom([0]);
  ok(load(f).between(5, 9) === 5, 'between(5, 9) cannot reach 5');
  const g = fakeFrom([TWO53 - TWO53 % 5 - 1]);   // largest accepted value, which is 4 mod 5
  ok(load(g).between(5, 9) === 9, 'between(5, 9) cannot reach 9');
  ok(load(fakeFrom([4])).between(9, 5) === 9, 'between(9, 5) does not accept the ends in either order');
  ok(PICK.between(7, 7) === 7, 'between(7, 7) is not 7');
  ok(PICK.between(-3, -3) === -3, 'between(-3, -3) is not -3');

  const seen = new Map();
  for (let i = 0; i < 4000; i++) {
    const v = PICK.between(-2, 2);
    ok(Number.isInteger(v) && v >= -2 && v <= 2, `between(-2, 2) returned ${v}`);
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  ok(seen.size === 5, `between(-2, 2) produced only ${[...seen.keys()]}`);

  const MAX = Number.MAX_SAFE_INTEGER;
  ok(PICK.between(0, MAX) !== null, 'between(0, 2^53 - 1) refused a range it can pick from');
  ok(PICK.between(1 - MAX, MAX) === null, 'between(-(2^53-1), 2^53-1) is too wide but was accepted');
  ok(PICK.between(0, MAX + 2) === null, 'between accepted a number past the safe range');
  ok(PICK.between(MAX, MAX) === MAX, 'between(MAX, MAX)');
  let threw = false;
  try { PICK.below(0); } catch { threw = true; }
  ok(threw, 'below(0) should refuse');
}
console.log('ends: both ends reachable, either order, widest ranges handled');

// ---- 3. no bias ----
{ // small n, every face
  const N = 140000, counts = new Array(7).fill(0);
  for (let i = 0; i < N; i++) counts[PICK.below(7)]++;
  const c = chi(counts);
  ok(c < CRIT[6], `below(7) looks biased: chi-square ${c.toFixed(1)}, counts ${counts}`);
  console.log(`uniformity: below(7) over ${N.toLocaleString('en-US')} draws, chi-square ${c.toFixed(1)}`);
}
{ // The case the modulo shortcut gets visibly wrong. n = 3 * 2^51 is three
  // quarters of 2^53, so v % n would land in the first third half the time
  // instead of a third. The fair draw has to split evenly.
  const n = 3 * 2 ** 51, third = n / 3;
  const N = 60000, counts = [0, 0, 0];
  for (let i = 0; i < N; i++) counts[Math.floor(PICK.below(n) / third)]++;
  const c = chi(counts);
  ok(c < CRIT[2], `below(3 * 2^51) leans: chi-square ${c.toFixed(1)}, thirds ${counts}`);
  // and the same test does catch the shortcut, so it is not toothless
  const naive = [0, 0, 0];
  const buf = new Uint32Array(2);
  for (let i = 0; i < N; i++) {
    crypto.getRandomValues(buf);
    naive[Math.floor((((buf[0] >>> 11) * 2 ** 32 + buf[1]) % n) / third)]++;
  }
  ok(chi(naive) > 1000, `the modulo shortcut should fail this test, got chi-square ${chi(naive).toFixed(1)}`);
  console.log(`uniformity: below(3 * 2^51) splits evenly (chi-square ${c.toFixed(1)}); the shortcut scores ${chi(naive).toFixed(0)}`);
}
{
  const N = 40000;
  let heads = 0;
  for (let i = 0; i < N; i++) {
    const s = PICK.coin();
    ok(s === 'Heads' || s === 'Tails', `coin() returned ${s}`);
    if (s === 'Heads') heads++;
  }
  const c = chi([heads, N - heads]);
  ok(c < CRIT[1], `coin leans: ${heads} heads in ${N}`);

  const faces = new Array(20).fill(0);
  for (let i = 0; i < 5000; i++) {
    const r = PICK.dice(4, 20);
    ok(r.length === 4, `dice(4, 20) gave ${r.length} dice`);
    for (const v of r) {
      ok(Number.isInteger(v) && v >= 1 && v <= 20, `a d20 showed ${v}`);
      faces[v - 1]++;
    }
  }
  ok(faces.every((x) => x > 0), 'a d20 never showed one of its faces');
  ok(chi(faces) < CRIT[19], `d20 leans: chi-square ${chi(faces).toFixed(1)}`);
  console.log(`uniformity: coin and d20 fair (chi-square ${c.toFixed(1)} and ${chi(faces).toFixed(1)})`);
}

// ---- 4. names ----
ok(JSON.stringify(PICK.names('  Ann \n\nBo\r\n \nCy\n')) === '["Ann","Bo","Cy"]', 'names() trimming and blank lines');
ok(PICK.names('A\nA').length === 2, 'names() must keep a name written twice');

{ // kept out: every draw is a full permutation, and all 24 orders of 4 names
  // are equally likely, which is what a correct Fisher–Yates gives and a
  // common off-by-one does not.
  const hat = ['a', 'b', 'c', 'd'];
  const counts = new Map();
  const N = 48000;
  for (let i = 0; i < N; i++) {
    const r = PICK.draw(hat, 4, false);
    const key = r.picked.join('');
    counts.set(key, (counts.get(key) || 0) + 1);
    ok(r.rest.length === 0, 'drawing everything should leave the hat empty');
  }
  ok(counts.size === 24, `only ${counts.size} of the 24 orders ever came up`);
  ok(chi([...counts.values()]) < CRIT[23], `orders lean: chi-square ${chi([...counts.values()]).toFixed(1)}`);
  ok(hat.join('') === 'abcd', 'draw() changed the hat it was given');
  console.log(`names: all 24 orders of 4 names equally likely (chi-square ${chi([...counts.values()]).toFixed(1)})`);
}
{ // drawing one at a time until the hat is empty gives each name exactly once
  const names = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus'];
  for (let t = 0; t < 200; t++) {
    let hat = names, out = [];
    while (hat.length) {
      const r = PICK.draw(hat, 2, false);
      ok(r.picked.length === Math.min(2, hat.length), 'drew the wrong number of names');
      ok(r.picked.length + r.rest.length === hat.length, 'names went missing from the hat');
      out = out.concat(r.picked);
      hat = r.rest;
    }
    ok(out.slice().sort().join() === names.slice().sort().join(), `kept out drew ${out}`);
  }
  // asking for more than are left takes what is there
  ok(PICK.draw(['x', 'y'], 5, false).picked.length === 2, 'drawing 5 from 2 should give 2');
  ok(PICK.draw([], 1, false).picked.length === 0, 'drawing from an empty hat should give nothing');
}
{ // put back: the hat never changes and repeats happen
  const hat = ['a', 'b', 'c'];
  const counts = { a: 0, b: 0, c: 0 };
  let repeats = 0;
  for (let i = 0; i < 30000; i++) {
    const r = PICK.draw(hat, 2, true);
    ok(r.picked.length === 2 && r.rest.length === 3, 'put back changed the hat');
    r.picked.forEach((x) => counts[x]++);
    if (r.picked[0] === r.picked[1]) repeats++;
  }
  ok(chi(Object.values(counts)) < CRIT[2], `put back leans: ${JSON.stringify(counts)}`);
  // a repeat within one draw has chance 1 in 3
  ok(Math.abs(repeats / 30000 - 1 / 3) < 0.02, `put back repeats ${repeats} times in 30000, expected about 10000`);
  console.log('names: kept out never repeats, put back stays fair');
}

console.log(fails ? `\n${fails} failure(s)` : '\nall random tests passed');
process.exit(fails ? 1 : 0);
