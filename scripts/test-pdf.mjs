/* Verifies the PDF reader and writer that ship inside tools/pdf.html. The module
   is lifted straight out of the page, so this checks the code users actually run,
   not a copy of it. Node built-ins only.

   A PDF that is quietly missing a page, or shows the wrong one, looks fine until
   someone needs it. So the PDFs here are written in the ways real programs write
   them, every page carries its own label, and what comes out is read back by a
   separate reader written for this test, not by the tool's own. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'pdf.html'), 'utf8');

const start = page.indexOf('var PDF = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the PDF module in tools/pdf.html');
  process.exit(1);
}
const PDF = new Function(page.slice(start, end + 6) + '\nreturn PDF;')();

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const latin = (b) => Buffer.from(b).toString('latin1');
const bytes = (s) => new Uint8Array(Buffer.from(s, 'latin1'));

/* ---- writing test PDFs ---- */

// objs: { num: body } where body is the text between "obj" and "endobj", or
// { dict, data } for a stream. Writes a classic xref table unless packed.
function write(objs, { root = 1, extra = '', header = '%PDF-1.4' } = {}) {
  let out = header + '\n%\xe2\xe3\xcf\xd3\n';
  const off = {};
  for (const [n, body] of Object.entries(objs)) {
    off[n] = out.length;
    if (typeof body === 'string') out += `${n} 0 obj\n${body}\nendobj\n`;
    else out += `${n} 0 obj\n${body.dict.replace('LEN', body.data.length)}\nstream\n${body.data}\nendstream\nendobj\n`;
  }
  const max = Math.max(...Object.keys(objs).map(Number));
  const x = out.length;
  out += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) out += off[i] != null ? String(off[i]).padStart(10, '0') + ' 00000 n \n' : '0000000000 65535 f \n';
  out += `trailer\n<</Size ${max + 1} /Root ${root} 0 R${extra}>>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}
const content = (label) => `BT /F1 24 Tf 72 700 Td (${label}) Tj ET`;

// Three pages in a nested tree, with the font and page size written once on the
// tree rather than on each page, and a link on page 1 that jumps to page 3.
function simple(tag) {
  return write({
    1: '<</Type /Catalog /Pages 2 0 R /Outlines 20 0 R>>',
    2: `<</Type /Pages /Kids [3 0 R 6 0 R] /Count 3 /Resources <</Font <</F1 9 0 R>>>> /MediaBox [0 0 595 842]>>`,
    3: '<</Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 /Rotate 90>>',
    4: `<</Type /Page /Parent 3 0 R /Contents 10 0 R /Annots [<</Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest [6 0 R /Fit]>>]>>`,
    5: '<</Type /Page /Parent 3 0 R /Contents 11 0 R /MediaBox [0 0 300 300]>>',
    6: '<</Type /Page /Parent 2 0 R /Contents 12 0 R /Rotate 0>>',
    9: '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
    10: { dict: '<</Length LEN>>', data: content(`${tag}1`) },
    11: { dict: '<</Length 13 0 R>>', data: content(`${tag}2`) },
    12: { dict: '<</Length LEN>>', data: content(`${tag}3`) },
    13: String(content(`${tag}2`).length),
    20: '<</Type /Outlines /First 21 0 R /Last 21 0 R /Count 1>>',
    21: '<</Title (Old bookmark) /Parent 20 0 R /Dest [4 0 R /Fit]>>',
  });
}

// The same kind of document as a modern program writes it: most objects packed
// into a compressed object stream, found through a compressed xref stream.
function packed(tag, n) {
  const kids = Array.from({ length: n }, (_, i) => `${10 + i} 0 R`).join(' ');
  const inner = { 1: '<</Type /Catalog /Pages 2 0 R>>',
                  2: `<</Type /Pages /Kids [${kids}] /Count ${n} /MediaBox [0 0 612 792] /Resources <</Font <</F1 3 0 R>>>>>>`,
                  3: '<</Type /Font /Subtype /Type1 /BaseFont /Courier>>' };
  for (let i = 0; i < n; i++) inner[10 + i] = `<</Type /Page /Parent 2 0 R /Contents ${100 + i} 0 R>>`;
  let headNums = '', body = '';
  for (const [k, v] of Object.entries(inner)) { headNums += `${k} ${body.length} `; body += v + '\n'; }
  const stm = Buffer.concat([Buffer.from(headNums), Buffer.from(body)]);
  const z = deflateSync(stm);
  let out = '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n';
  const off = {};
  off[50] = out.length;
  out += `50 0 obj\n<</Type /ObjStm /N ${Object.keys(inner).length} /First ${headNums.length} /Filter /FlateDecode /Length ${z.length}>>\nstream\n${z.toString('latin1')}\nendstream\nendobj\n`;
  for (let i = 0; i < n; i++) {
    const data = deflateSync(Buffer.from(content(`${tag}${i + 1}`))).toString('latin1');
    off[100 + i] = out.length;
    out += `${100 + i} 0 obj\n<</Filter /FlateDecode /Length ${data.length}>>\nstream\n${data}\nendstream\nendobj\n`;
  }
  // The xref stream itself is not checked by the reader, which finds objects by
  // looking, so a minimal one is enough to carry the trailer.
  const x = out.length;
  out += `200 0 obj\n<</Type /XRef /Size 201 /Root 1 0 R /W [1 4 2] /Length 0>>\nstream\n\nendstream\nendobj\nstartxref\n${x}\n%%EOF\n`;
  return out;
}

// simple(), saved, then changed: page 2 is given new text in an update added
// to the end of the file, the way most editors save.
function updated(tag) {
  const base = simple(tag);
  const data = content(`${tag}2-new`);
  const add = `11 0 obj\n<</Length ${data.length}>>\nstream\n${data}\nendstream\nendobj\n` +
    `xref\n0 1\n0000000000 65535 f \ntrailer\n<</Size 22 /Root 1 0 R /Prev 0>>\nstartxref\n${base.length}\n%%EOF\n`;
  return base + add;
}

/* ---- reading what comes out, independently ---- */

function check(out, wantLabels, label) {
  const s = latin(out);
  ok(s.startsWith('%PDF-'), `${label}: starts like a PDF`);
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(s);
  ok(!!sx, `${label}: ends with startxref`);
  if (!sx) return;
  const x = +sx[1];
  ok(s.slice(x, x + 4) === 'xref', `${label}: startxref points at the table`);
  const hd = /^xref\n0 (\d+)\n/.exec(s.slice(x));
  const size = +hd[1], objs = {};
  for (let i = 1; i < size; i++) {
    const at = +s.substr(x + hd[0].length + 20 * i, 10);
    const m = /^(\d+) 0 obj\n/.exec(s.slice(at, at + 20));
    ok(m && +m[1] === i, `${label}: table entry ${i} points at object ${i}`);
    if (!m) continue;
    const e = s.indexOf('\nendobj\n', at);
    objs[i] = s.slice(at + m[0].length, e);
  }
  const refs = [...s.matchAll(/(\d+) 0 R\b/g)].map((m) => +m[1]);
  ok(refs.every((r) => objs[r] != null), `${label}: every pointer goes to an object that exists`);
  const tr = /trailer\n<<\/Size (\d+) \/Root (\d+) 0 R>>/.exec(s);
  ok(tr && +tr[1] === size, `${label}: trailer size matches the table`);
  const cat = objs[tr[2]];
  ok(/\/Type \/Catalog/.test(cat), `${label}: root is a catalog`);
  const pagesNum = +/\/Pages (\d+) 0 R/.exec(cat)[1];
  const kids = [...objs[pagesNum].match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((m) => +m[1]);
  ok(new RegExp(`/Count ${kids.length}>>`).test(objs[pagesNum]), `${label}: page count matches the list`);
  const got = kids.map((k) => {
    const p = objs[k];
    ok(new RegExp(`/Parent ${pagesNum} 0 R`).test(p), `${label}: page ${k} points back at the list`);
    ok(/\/MediaBox/.test(p), `${label}: page ${k} has a size`);
    ok(/\/Resources/.test(p), `${label}: page ${k} has its fonts`);
    const c = +/\/Contents (\d+) 0 R/.exec(p)[1];
    const body = objs[c], len = +/\/Length (\d+)/.exec(body)[1];
    const at = body.indexOf('stream\n') + 7;
    let data = Buffer.from(body.slice(at, at + len), 'latin1');
    ok(body.slice(at + len, at + len + 10) === '\nendstream', `${label}: stream length is exact`);
    if (/FlateDecode/.test(body)) data = require_inflate(data);
    return /\((.*)\) Tj/.exec(data.toString('latin1'))[1];
  });
  ok(JSON.stringify(got) === JSON.stringify(wantLabels), `${label}: pages are ${wantLabels.join(',')}, got ${got.join(',')}`);
  return { s, objs, kids };
}
import { inflateSync } from 'node:zlib';
function require_inflate(b) { return inflateSync(b); }

const open = (text) => PDF.open(bytes(text));
const all = (doc) => doc.pages.map((_, i) => ({ doc, page: i }));

/* ---- the checks ---- */

const a = await open(simple('A')), b = await open(simple('B'));
ok(a.pages.length === 3, 'nested tree: three pages found');

// Merging, and each page keeping what it inherited.
let r = check(PDF.build([...all(a), ...all(b)]), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'], 'merge two');
const firstPage = r.objs[r.kids[0]];
ok(/\/Rotate 90/.test(firstPage), 'page 1 keeps the turn it inherited');
ok(/\/MediaBox \[0 0 595 842\]/.test(firstPage), 'page 1 keeps the size it inherited');
ok(/\/MediaBox \[0 0 300 300\]/.test(r.objs[r.kids[1]]), 'page 2 keeps its own size over the inherited one');
ok(/\/Rotate 0/.test(r.objs[r.kids[2]]) && !/\/Rotate 90/.test(r.objs[r.kids[2]]), 'page 3 keeps its own turn');
ok(!/Old bookmark/.test(r.s), 'bookmarks of the old file are left behind');
ok(new RegExp(`/Dest \\[${r.kids[2]} 0 R`).test(firstPage), 'a link to page 3 points at the new page 3');

// Choosing pages.
r = check(PDF.build([{ doc: a, page: 0 }]), ['A1'], 'only page 1');
ok(/\/Dest \[null/.test(r.s), 'a link to a page left out points nowhere');
ok((r.s.match(/\/Type \/Page\b/g) || []).length === 1, 'pages left out are not dragged along by links');
check(PDF.build([{ doc: a, page: 2 }, { doc: a, page: 0 }, { doc: b, page: 1 }]), ['A3', 'A1', 'B2'], 'reordered across files');
r = check(PDF.build([{ doc: a, page: 1 }, { doc: a, page: 1 }]), ['A2', 'A2'], 'the same page twice');
ok(r.kids[0] !== r.kids[1], 'a page chosen twice gets two page entries');
ok((r.s.match(/\(A2\) Tj/g) || []).length === 1, 'and shares its contents rather than copying them');

// Packed objects and compressed streams.
const p = await open(packed('P', 4));
ok(p.pages.length === 4, 'object stream: four pages found');
ok(p.version === '1.5', 'object stream: version read');
check(PDF.build([...all(p), ...all(a)]), ['P1', 'P2', 'P3', 'P4', 'A1', 'A2', 'A3'], 'packed and plain together');
ok(latin(PDF.build(all(p))).startsWith('%PDF-1.5'), 'the newest version of the inputs is kept');

// A file changed after it was saved: the newer page 2 wins.
const u = await open(updated('U'));
check(PDF.build(all(u)), ['U1', 'U2-new', 'U3'], 'changed after saving');

// A stream whose stated length is wrong is still copied whole.
const wrong = simple('W').replace(/<<\/Length (\d+)>>\nstream\nBT \/F1 24 Tf 72 700 Td \(W1\)/, '<</Length 5>>\nstream\nBT /F1 24 Tf 72 700 Td (W1)');
check(PDF.build(all(await open(wrong))), ['W1', 'W2', 'W3'], 'wrong stream length');

// Refusals, in plain words.
async function refuses(text, words, label) {
  try { await open(text); ok(false, `${label}: should refuse`); }
  catch (e) { ok(e.plain && e.message.includes(words), `${label}: says "${words}", said "${e.message}"`); }
}
await refuses('hello, this is a text file', 'not a PDF', 'text file');
await refuses(simple('L').replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 30 0 R'), 'locked', 'locked PDF');
await refuses('%PDF-1.4\n1 0 obj\n<</Type /Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF', 'No pages', 'no pages');

// Page lists, as people type them.
const pk = (t, n = 10) => { const x = PDF.pick(t, n); return x.error ? 'error: ' + x.error : x.pages.map((i) => i + 1).join(','); };
const PICKS = [
  ['', '1,2,3,4,5,6,7,8,9,10'],
  ['all', '1,2,3,4,5,6,7,8,9,10'],
  ['1-3, 7', '1,2,3,7'],
  ['1 - 3 , 7', '1,2,3,7'],
  ['1–3', '1,2,3'],                       // en dash, as phones type it
  ['3-1', '3,2,1'],                       // backwards
  ['8-', '8,9,10'],
  ['-2', '1,2'],
  ['8-end', '8,9,10'],
  ['last', '10'],
  ['1 to 3 and 5', '1,2,3,5'],
  ['pages 2-4', '2,3,4'],
  ['p. 5', '5'],
  ['1 3 5', '1,3,5'],
  ['1,1', '1,1'],
  ['not 2', '1,3,4,5,6,7,8,9,10'],
  ['not 1-8', '9,10'],
  ['all but 10', '1,2,3,4,5,6,7,8,9'],
  ['except 2, 4-9', '1,3,10'],
  ['not 1-10', 'error: That leaves no pages.'],
  ['not', 'error: Which pages should be left out?'],
  ['11', 'error: There is no page 11: this PDF has 10 pages.'],
  ['5-12', 'error: There is no page 12: this PDF has 10 pages.'],
  ['0', 'error: Pages start at 1.'],
  ['abc', 'error: Type page numbers like 1-3, 7.'],
  ['-', 'error: Type page numbers like 1-3, 7.'],
  ['1.5', 'error: Type page numbers like 1-3, 7.'],
];
for (const [t, want] of PICKS) ok(pk(t) === want, `pages "${t}": want ${want}, got ${pk(t)}`);
ok(pk('2', 1) === 'error: There is no page 2: this PDF has 1 page.', 'one page, said in the singular');

// The ZIP of single pages, read back by hand.
const files = [{ name: 'eins.pdf', data: PDF.build([{ doc: a, page: 0 }]) },
               { name: 'zwei – ü.pdf', data: PDF.build([{ doc: a, page: 1 }]) }];
const z = PDF.zip(files), dv = new DataView(z.buffer, z.byteOffset);
const eocd = z.length - 22;
ok(dv.getUint32(eocd, true) === 0x06054b50, 'zip: ends with its directory');
ok(dv.getUint16(eocd + 10, true) === 2, 'zip: holds two files');
let cd = dv.getUint32(eocd + 16, true);
for (const f of files) {
  ok(dv.getUint32(cd, true) === 0x02014b50, `zip: directory entry for ${f.name}`);
  const nl = dv.getUint16(cd + 28, true), local = dv.getUint32(cd + 42, true);
  const name = new TextDecoder().decode(z.subarray(cd + 46, cd + 46 + nl));
  ok(name === f.name, `zip: name kept as ${f.name}, got ${name}`);
  const lnl = dv.getUint16(local + 26, true), size = dv.getUint32(local + 18, true);
  const data = z.subarray(local + 30 + lnl, local + 30 + lnl + size);
  ok(Buffer.compare(Buffer.from(data), Buffer.from(f.data)) === 0, `zip: ${f.name} stored exactly`);
  ok(dv.getUint32(cd + 16, true) === PDF.crc32(data), `zip: ${f.name} checksum`);
  cd += 46 + nl;
}
ok(PDF.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 of the standard test string');

console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
