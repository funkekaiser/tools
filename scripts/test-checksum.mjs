/* Verifies the hashes that ship inside tools/checksum.html. The module is lifted
   straight out of the page, so this checks the code users actually run, not a
   copy of it. Node built-ins only.

   A wrong checksum looks exactly like a right one, and would tell someone a good
   download is damaged. So every hash is checked against Node's own, across the
   sizes where padding changes and with the file cut into awkward pieces. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'checksum.html'), 'utf8');

const start = page.indexOf('var HASH = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the hash module in tools/checksum.html');
  process.exit(1);
}
const HASH = new Function(page.slice(start, end + 6) + '\nreturn HASH;')();

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const NODE = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };
const kinds = Object.keys(NODE);

function ours(bytes, cuts) {
  const h = HASH.all();
  let at = 0;
  for (const c of cuts) { h.update(bytes.subarray(at, c)); at = c; }
  h.update(bytes.subarray(at));
  return h.digest();
}
function check(bytes, cuts, label) {
  const got = ours(bytes, cuts);
  for (const k of kinds) {
    const want = createHash(NODE[k]).update(bytes).digest('hex');
    ok(got[k] === want, `${k} of ${label}: got ${got[k]}, want ${want}`);
  }
}

// The published test strings.
const enc = (s) => new TextEncoder().encode(s);
check(enc(''), [], 'nothing');
check(enc('abc'), [], '"abc"');
check(enc('The quick brown fox jumps over the lazy dog'), [], 'the fox');
ok(ours(enc('abc'), []).sha256 === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 of "abc" by hand');
ok(ours(enc(''), []).md5 === 'd41d8cd98f00b204e9800998ecf8427e', 'md5 of nothing by hand');

// Every length around the block edges, where the padding spills into another block.
for (let n = 0; n <= 300; n++) check(randomBytes(n), [], `${n} random bytes`);
for (const n of [1000, 4095, 4096, 65537, 1 << 20]) check(randomBytes(n), [], `${n} random bytes`);

// The page reads a file in pieces; how it is cut must not change the answer.
const big = randomBytes(5000);
check(big, [1, 2, 3, 63, 64, 65, 127, 128, 129, 1000, 4999], 'many small pieces');
check(big, [700, 701, 1900], 'uneven pieces');
for (let t = 0; t < 30; t++) {
  const cuts = Array.from({ length: 6 }, () => Math.floor(Math.random() * 5000)).sort((a, b) => a - b);
  check(big, cuts, `pieces at ${cuts.join(',')}`);
}
// A pass of all-ones bytes: the carries in SHA-512's 64-bit sums run all the way up.
check(new Uint8Array(1000).fill(0xff), [], 'all 0xff');

// Reading what people paste.
const bytes = enc('hello\n');
const d = ours(bytes, []);
const cmp = (text, name) => HASH.compare(d, text, name);
ok(cmp('', 'f').state === 'none', 'empty box says nothing');
ok(cmp('   \n', 'f').state === 'none', 'blank box says nothing');
ok(cmp(d.sha256, 'f').state === 'match', 'bare sha256 matches');
ok(cmp(d.sha256.toUpperCase(), 'f').state === 'match', 'capitals still match');
ok(cmp('  ' + d.sha512 + '  ', 'f').kind === 'sha512', 'sha512 recognised by length');
ok(cmp(d.sha1, 'f').kind === 'sha1', 'sha1 recognised by length');
ok(cmp(d.md5, 'f').kind === 'md5', 'md5 recognised by length');
ok(cmp(d.sha256 + '  hello.txt', 'hello.txt').state === 'match', 'sha256sum output matches');
ok(cmp(d.sha256 + ' *hello.txt', 'hello.txt').state === 'match', 'sha256sum binary-mode output matches');
ok(cmp(`SHA256 (hello.txt) = ${d.sha256}`, 'hello.txt').state === 'match', 'BSD-style line matches');
ok(cmp(`sha256:${d.sha256}`, 'f').state === 'match', 'sha256: prefix matches');
const other = createHash('sha256').update('other').digest('hex');
const list = `${other}  other.iso\n${d.sha256}  hello.txt\n`;
ok(cmp(list, 'hello.txt').state === 'match', 'finds its line in a list');
const r = cmp(`${other}  other.iso\n${'0'.repeat(64)}  hello.txt\n`, 'hello.txt');
ok(r.state === 'mismatch' && r.hex === '0'.repeat(64), 'a mismatch points at the line naming the file');
ok(cmp(other, 'f').state === 'mismatch', 'a different sha256 does not match');
ok(cmp(d.sha256.slice(0, 63) + '0', 'f').state === 'mismatch', 'one digit off does not match');
ok(cmp('not a checksum at all', 'f').state === 'unreadable', 'words are not a checksum');
ok(cmp(d.sha256.slice(0, 50), 'f').state === 'unreadable', 'a cut-off checksum is not read as one');
ok(cmp(d.sha256 + 'ab', 'f').state === 'unreadable', 'a 66-digit run is not a sha256');
ok(cmp(`SHA3-256: ${other}`, 'f').state === 'other', 'SHA-3 is not called a mismatch');
ok(cmp(`b2sum ${'a'.repeat(128)}`, 'f').state === 'other', 'BLAKE2 is not called a mismatch');
ok(HASH.read(`${d.md5} ${d.sha1}`).length === 2, 'two codes on one line are both read');

// How fast it goes, so a big download does not surprise anyone.
const mb = randomBytes(32 << 20), t0 = performance.now();
ours(mb, Array.from({ length: 15 }, (_, i) => (i + 1) * (2 << 20)));
const rate = 32 / ((performance.now() - t0) / 1000);
console.log(`all four hashes together: ${rate.toFixed(0)} MB/s`);

console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
