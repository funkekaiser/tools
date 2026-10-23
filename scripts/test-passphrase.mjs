/* Verifies the passphrase generator that ships inside tools/passphrase.html.
   The word list and the module are lifted straight out of the page, so this
   checks the code users actually run, not a copy of it. Node built-ins only.

   The entropy figure is only honest if two different sets of choices can
   never make the same text, and if the count really is a floor. Both are
   checked by enumerating every phrase a tiny list can produce. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'passphrase.html'), 'utf8');

const listAt = page.indexOf('var WORDLIST = "');
const start = page.indexOf('var PP = (function () {');
const end = page.indexOf('\n})();', start);
if (listAt < 0 || start < 0 || end < 0) {
  console.error('could not find the word list or the passphrase module in tools/passphrase.html');
  process.exit(1);
}
const listLine = page.slice(listAt, page.indexOf('\n', listAt));
// The page exports only what it uses; the tests need the internals too.
const moduleSource = page.slice(start, end + 6)
  .replace('return { generate: generate, analyse: analyse, duration: duration, verdict: verdict,',
    'return { WORDS, EXTRAS, MIN_LEN, SEPS, randomInt, pickDistinct, choose, countPhrases, log2Big, ' +
    'generate: generate, analyse: analyse, duration: duration, verdict: verdict,');
const load = (list) => new Function('var WORDLIST = ' + JSON.stringify(list) + ';\n' + moduleSource + '\nreturn PP;')();
const PP = new Function(listLine + '\n' + moduleSource + '\nreturn PP;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

// ---- 1. the list ----
ok(PP.WORDS.length === 17576, `list has ${PP.WORDS.length} words, expected 17,576`);
ok(new Set(PP.WORDS).size === PP.WORDS.length, 'list has duplicates');
ok(PP.WORDS.every((w) => /^[a-z]{3,}$/.test(w)), 'list has a word that is not 3+ small letters');
ok(PP.MIN_LEN === 3, `shortest word is ${PP.MIN_LEN} letters, expected 3`);
ok(![...PP.EXTRAS].some((c) => /[a-z01]/i.test(c)), 'an extra character could pass for a letter');
console.log(`list: ${PP.WORDS.length.toLocaleString('en-US')} distinct words`);

// ---- 2. the count, against every phrase a tiny list can make ----
// Separators, and capitals in their place, must keep every choice distinct.
// With all words the same length the floor is exact, so the sizes must match;
// with mixed lengths there must be at least as many phrases as claimed.
function enumerate(words, count, extras, symbols, sep) {
  const out = new Set();
  const seqs = [[]];
  for (let i = 0; i < count; i++) {
    const next = [];
    for (const s of seqs) for (const w of words) next.push([...s, w]);
    seqs.splice(0, seqs.length, ...next);
  }
  const subsets = (n, k, from = 0) => k === 0 ? [[]] :
    Array.from({ length: n - from }, (_, i) => from + i)
      .flatMap((i) => subsets(n, k - 1, i + 1).map((r) => [i, ...r]));
  for (const seq of seqs) {
    for (const sub of subsets(count, extras)) {
      let variants = [seq];
      for (const idx of sub) {
        const grown = [];
        for (const v of variants) {
          const w = v[idx];
          for (let at = 1; at < w.length; at++) for (const c of symbols) {
            const copy = v.slice(); copy[idx] = w.slice(0, at) + c + w.slice(at); grown.push(copy);
          }
        }
        variants = grown;
      }
      for (const v of variants) {
        const words = sep.caps ? v.map((w) => w[0].toUpperCase() + w.slice(1)) : v;
        out.add(words.join(sep.join));
      }
    }
  }
  return out;
}
let cases = 0;
for (const sepName of Object.keys(PP.SEPS)) {
  for (const [words, count, extras] of [
    [['cat', 'dog', 'owl'], 2, 0], [['cat', 'dog', 'owl'], 3, 1], [['cat', 'dog', 'owl'], 3, 2],
    [['cat', 'dog', 'owl'], 2, 2], [['ab', 'ba'], 3, 3], [['ant', 'tan'], 3, 2],
    [['cat', 'horse', 'emu'], 2, 1], [['ant', 'antelope'], 3, 1]
  ]) {
    const symbols = '2#';
    const got = enumerate(words, count, extras, symbols, PP.SEPS[sepName]).size;
    const minLen = Math.min(...words.map((w) => w.length));
    const floor = Number(PP.countPhrases(words.length, count, extras, symbols.length, minLen));
    const even = words.every((w) => w.length === minLen);
    // Capitals with no separator: "ant"+"antelope" and "antelope"+"ant" stay
    // distinct because the capitals mark where each word starts.
    if (even) ok(got === floor, `${sepName} ${words} x${count} +${extras}: ${got} phrases, count says ${floor}`);
    else ok(got >= floor, `${sepName} ${words} x${count} +${extras}: ${got} phrases, below the floor ${floor}`);
    cases++;
  }
}
console.log(`counting: ${cases} small cases enumerated in full`);

ok(PP.choose(6, 0) === 1n && PP.choose(6, 2) === 15n && PP.choose(10, 3) === 120n, 'choose is wrong');
{
  const a = PP.analyse(6, 'dash', 0);
  ok(Math.abs(a.bits - 6 * Math.log2(17576)) < 1e-9, `6 words should be ${6 * Math.log2(17576)} bits, got ${a.bits}`);
  const b = PP.analyse(6, 'dash', 1);
  const want = 6 * Math.log2(17576) + Math.log2(6) + Math.log2(PP.EXTRAS.length) + Math.log2(2);
  ok(Math.abs(b.bits - want) < 1e-9, `6 words and one extra should be ${want} bits, got ${b.bits}`);
  ok(PP.analyse(3, 'dash', 3).extras === 3 && PP.analyse(3, 'dash', 5).extras === 3, 'extras not capped at the word count');
}

// ---- 3. the draw is uniform ----
{
  const counts = new Array(7).fill(0);
  const N = 140000;
  for (let i = 0; i < N; i++) counts[PP.randomInt(7)]++;
  // chi-square, 6 degrees of freedom: 24.1 is p < 0.0005.
  const expect = N / 7;
  const chi = counts.reduce((a, c) => a + ((c - expect) ** 2) / expect, 0);
  ok(chi < 24.1, `randomInt(7) looks biased: chi-square ${chi.toFixed(1)}, counts ${counts}`);
  console.log(`uniformity: ${N.toLocaleString('en-US')} draws, chi-square ${chi.toFixed(1)}`);
}
{ // every pair out of 5 should come up equally often
  const seen = new Map();
  const N = 50000;
  for (let i = 0; i < N; i++) {
    const k = PP.pickDistinct(5, 2).sort().join();
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  ok(seen.size === 10, `pickDistinct(5, 2) made ${seen.size} different pairs, expected 10`);
  const expect = N / 10;
  const chi = [...seen.values()].reduce((a, c) => a + ((c - expect) ** 2) / expect, 0);
  ok(chi < 27.9, `pickDistinct favours some pairs: chi-square ${chi.toFixed(1)} over 9 df`);
}

// ---- 4. the phrases themselves ----
const inList = new Set(PP.WORDS);
const extraClass = '[' + PP.EXTRAS.replace(/[\\\]^-]/g, '\\$&') + ']';
const extraRe = new RegExp(extraClass), extraAll = new RegExp(extraClass, 'g');
let made = 0;
for (const sepName of Object.keys(PP.SEPS)) {
  for (const count of [3, 6, 10]) {
    for (const extras of [0, 1, 3]) {
      for (let i = 0; i < 100; i++) {
        const p = PP.generate(count, sepName, extras);
        made++;
        const parts = sepName === 'caps' ? p.match(/[A-Z][^A-Z]*/g) : p.split(PP.SEPS[sepName].join);
        ok(parts && parts.length === count, `${sepName} ${count}: wrong word count in "${p}"`);
        if (!parts) continue;
        const marked = parts.filter((w) => extraRe.test(w));
        ok(marked.length === Math.min(extras, count), `${sepName}: ${marked.length} words carry extras in "${p}", expected ${extras}`);
        for (const w of parts) {
          const hits = w.match(extraAll) || [];
          ok(hits.length <= 1, `two extras in one word in "${p}"`);
          ok(!extraRe.test(w[0]) && !extraRe.test(w[w.length - 1]), `extra at the edge of a word in "${p}"`);
          ok(inList.has(w.replace(extraAll, '').toLowerCase()), `"${w}" is not from the list in "${p}"`);
        }
      }
    }
  }
}
console.log(`phrases: ${made} generated, all well formed`);

{ // with a tiny list, every word and every place for the extra must turn up
  const tiny = load('cat dog owl');
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(tiny.generate(1, 'dash', 1));
  ok(seen.size === 3 * 2 * tiny.EXTRAS.length, `one tiny word with an extra made ${seen.size} phrases, expected ${3 * 2 * tiny.EXTRAS.length}`);
}

// ---- 5. the words put on the numbers ----
const RANK = { bad: 0, warn: 1, ok: 2 };
let last = -1;
for (let bits = 0; bits <= 200; bits++) {
  const r = RANK[PP.verdict(bits).tone];
  ok(r >= last, `verdict got weaker at ${bits} bits`);
  last = r;
}
ok(PP.verdict(PP.analyse(6, 'dash', 0).bits).tone === 'ok', 'the default passphrase is not rated safe');
ok(PP.verdict(PP.analyse(3, 'dash', 0).bits).tone !== 'ok', 'three words are rated safe');
ok(PP.sci(10n ** 30n) === '1.00 x 10^30', `sci(10^30): got "${PP.sci(10n ** 30n)}"`);
console.log('wording: scale and verdicts checked');

console.log(fails ? `\n${fails} failure(s)` : '\nall passphrase tests passed');
process.exit(fails ? 1 : 0);
