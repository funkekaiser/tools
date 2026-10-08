/* Verifies the photo module that ships inside tools/photo.html. The module is
   lifted straight out of the page, so this checks the code users actually
   run, not a copy of it. Node built-ins only.

   Two promises here can be broken without anyone noticing: that the copy no
   longer says where the photo was taken, and that it really is under the
   limit. A photo with its GPS position still inside looks exactly like one
   without. So the photos are built by hand, every kind of hidden note is put
   in, and the copy is searched byte by byte for anything that survived. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'photo.html'), 'utf8');

const start = page.indexOf('var PHOTO = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the photo module in tools/photo.html');
  process.exit(1);
}
const PHOTO = new Function(page.slice(start, end + 6) + '\nreturn PHOTO;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

const bytes = (s) => [...s].map((c) => c.charCodeAt(0));
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

// ---- building photos by hand ----

// A TIFF block as EXIF stores it: IFD0, then the EXIF and GPS directories it
// points to, then IFD1 (the preview picture), then the values too long to
// sit inside their entry.
function tiff(le, { main, exif = [], gps = [], thumb = false }) {
  const ifds = [['main', [...main]]];
  if (exif.length) { ifds[0][1].push({ tag: 0x8769, type: 4, ptr: 'exif' }); ifds.push(['exif', exif]); }
  if (gps.length) { ifds[0][1].push({ tag: 0x8825, type: 4, ptr: 'gps' }); ifds.push(['gps', gps]); }
  if (thumb) ifds.push(['thumb', [{ tag: 0x0103, type: 3, value: 6 }]]);
  ifds.forEach(([, list]) => list.sort((a, b) => a.tag - b.tag));

  const payload = (e) => {
    if (e.type === 2) return [...bytes(e.value), 0];
    if (e.type === 5) return e.value.flatMap(([n, d]) => [...u32(n), ...u32(d)]);
    return null;
  };
  const u16 = (v) => le ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const u32 = (v) => le ? [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24]
    : [v >>> 24, v >> 16 & 255, v >> 8 & 255, v & 255];

  const off = {};
  let o = 8;
  for (const [name, list] of ifds) { off[name] = o; o += 2 + 12 * list.length + 4; }
  const data = [];
  const out = [...bytes(le ? 'II' : 'MM'), ...u16(42), ...u32(8)];
  ifds.forEach(([name, list], k) => {
    out.push(...u16(list.length));
    for (const e of list) {
      const p = payload(e);
      const count = e.type === 2 ? p.length : e.type === 5 ? e.value.length : 1;
      out.push(...u16(e.tag), ...u16(e.type), ...u32(count));
      if (e.ptr) out.push(...u32(off[e.ptr]));
      else if (e.type === 3) out.push(...u16(e.value), 0, 0);
      else if (e.type === 4) out.push(...u32(e.value));
      else if (p.length <= 4) out.push(...p, ...new Array(4 - p.length).fill(0));
      else { out.push(...u32(o + data.length)); data.push(...p); }
    }
    // only IFD0 links on, and only to the preview
    out.push(...u32(name === 'main' && thumb ? off.thumb : 0));
  });
  return [...out, ...data];
}

const EXIF = (le) => tiff(le, {
  main: [
    { tag: 0x010F, type: 2, value: 'Canon' },
    { tag: 0x0110, type: 2, value: 'Canon EOS TEST' },
    { tag: 0x0112, type: 3, value: 6 },
    { tag: 0x0131, type: 2, value: 'Firmware 1.0' }
  ],
  exif: [
    { tag: 0x9003, type: 2, value: '2024:05:01 13:22:10' },
    { tag: 0xA434, type: 2, value: 'EF50mm f/1.8' }
  ],
  gps: [
    { tag: 1, type: 2, value: 'N' },
    { tag: 2, type: 5, value: [[52, 1], [31, 1], [1234, 100]] },
    { tag: 3, type: 2, value: 'E' },
    { tag: 4, type: 5, value: [[13, 1], [24, 1], [5678, 100]] }
  ],
  thumb: true
});

const seg = (m, payload) => [0xFF, m, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const SCAN1 = [0x12, 0x34, 0xFF, 0x00, 0x56, 0xFF, 0xD0, 0x78, 0x9A, 0xFF, 0xD1, 0xBC];
const SCAN2 = [0xDE, 0xFF, 0x00, 0xAD];
const PICTURE = [
  seg(0xDB, [0, ...new Array(64).fill(1)]),                    // quantisation table
  seg(0xC0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),                 // frame: 16 x 16, one channel
  seg(0xC4, [0, ...new Array(16).fill(0)]),                    // Huffman table
  seg(0xDA, [1, 1, 0, 0, 63, 0]), SCAN1,                       // first scan
  seg(0xC4, [0x10, ...new Array(16).fill(0)]),                 // progressive photos have more
  seg(0xDA, [1, 1, 0, 0, 63, 0]), SCAN2
];

function jpeg(le, { eoi = true, tail = true } = {}) {
  const parts = [
    [0xFF, 0xD8],
    seg(0xE0, [...bytes('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    seg(0xE1, [...bytes('Exif\0\0'), ...EXIF(le)]),
    seg(0xE1, bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>52,31.2N</exif:GPSLatitude></x:xmpmeta>')),
    seg(0xE2, [...bytes('ICC_PROFILE\0'), 1, 1, ...bytes('colour profile')]),
    seg(0xE2, [...bytes('MPF\0'), 0, 0, 0, 0]),
    seg(0xED, bytes('Photoshop 3.0\x008BIM caption SECRET-IPTC')),
    seg(0xEE, [...bytes('Adobe'), 0, 100, 0, 0, 0, 0, 1]),
    seg(0xFE, bytes('SECRET-COMMENT')),
    seg(0xE0, [...bytes('JFXX\0'), 0x10, 1, 2, 3]),
    seg(0xEA, bytes('SECRET-VENDOR')),
    ...PICTURE
  ];
  if (eoi) parts.push([0xFF, 0xD9]);
  // Phones store whole extra pictures after the end mark, each with its own EXIF.
  if (eoi && tail) parts.push([0xFF, 0xD8, ...seg(0xE1, [...bytes('Exif\0\0'), ...tiff(true, {
    main: [{ tag: 0x0110, type: 2, value: 'SECRET-TAIL' }]
  })]), 0xFF, 0xD9]);
  return new Uint8Array(parts.flat());
}

const SECRETS = ['Exif', 'http://ns.adobe.com', 'GPSLatitude', 'Photoshop', 'MPF', 'Canon', 'EOS TEST',
  'EF50mm', '2024:05:01', 'Firmware', 'SECRET', 'JFXX'];

// ---- 1. finding what a JPEG hides ----
for (const le of [true, false]) {
  const name = le ? 'little-endian' : 'big-endian';
  const info = PHOTO.inspect(jpeg(le));
  ok(info.type === 'jpeg', `${name}: type is ${info.type}`);
  ok(info.exif && info.exif.gps === true, `${name}: GPS not found`);
  ok(info.exif && info.exif.camera === 'Canon EOS TEST', `${name}: camera is "${info.exif && info.exif.camera}"`);
  ok(info.exif && info.exif.taken === '2024:05:01 13:22:10', `${name}: taken is "${info.exif && info.exif.taken}"`);
  ok(info.exif && info.exif.lens === 'EF50mm f/1.8', `${name}: lens is "${info.exif && info.exif.lens}"`);
  ok(info.exif && info.exif.orientation === 6, `${name}: orientation is ${info.exif && info.exif.orientation}`);
  ok(info.icc, `${name}: colour profile not noticed`);
  for (const x of ['XMP', 'extra images', 'IPTC', 'comment', 'JFIF thumbnail', 'other notes', 'small preview picture']) {
    ok(info.extras.includes(x), `${name}: "${x}" not reported, got ${info.extras}`);
  }
  ok(info.tail > 0, `${name}: data after the end mark not noticed`);
}
{ // a photo with nothing in it says so
  const plain = new Uint8Array([0xFF, 0xD8, ...seg(0xE0, [...bytes('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...PICTURE.flat(), 0xFF, 0xD9]);
  const info = PHOTO.inspect(plain);
  ok(!info.exif && info.extras.length === 0 && info.tail === 0, `plain JPEG reports ${JSON.stringify(info)}`);
  ok(PHOTO.leftovers(plain).length === 0, 'plain JPEG has leftovers');
  ok(PHOTO.removedText(info) === 'It had no hidden location or camera details to begin with.', 'plain JPEG wording');
}
console.log('reading: both byte orders, every kind of note found');

// ---- 2. stripping ----
for (const le of [true, false]) {
  const name = le ? 'little-endian' : 'big-endian';
  const src = jpeg(le);
  const out = PHOTO.strip(src);

  ok(out[0] === 0xFF && out[1] === 0xD8, `${name}: copy does not start as a JPEG`);
  ok(out[out.length - 2] === 0xFF && out[out.length - 1] === 0xD9, `${name}: copy does not end as a JPEG`);
  for (const s of SECRETS) ok(!has(out, s), `${name}: "${s}" survived stripping`);
  ok(PHOTO.leftovers(out).length === 0, `${name}: leftovers ${PHOTO.leftovers(out)}`);
  ok(PHOTO.leftovers(src).length > 0, `${name}: the original is not flagged`);

  const info = PHOTO.inspect(out);
  ok(!info.exif && info.extras.length === 0 && info.tail === 0, `${name}: copy reports ${JSON.stringify(info)}`);
  ok(info.icc, `${name}: the colour profile was lost`);
  ok(has(out, 'JFIF\0') && has(out, 'Adobe'), `${name}: JFIF header or Adobe colour flag was lost`);

  // The picture itself must come through byte for byte, scans and all.
  const pic = new Uint8Array(PICTURE.flat());
  ok(Buffer.from(out).includes(Buffer.from(pic)), `${name}: picture data changed`);
  ok(Buffer.compare(Buffer.from(PHOTO.strip(out)), Buffer.from(out)) === 0, `${name}: stripping twice changes it`);
}
{ // a file cut off before its end mark still comes out whole
  const out = PHOTO.strip(jpeg(true, { eoi: false }));
  ok(out[out.length - 2] === 0xFF && out[out.length - 1] === 0xD9, 'unterminated JPEG not closed');
  ok(PHOTO.leftovers(out).length === 0, 'unterminated JPEG has leftovers');
}
{ // something that is not a JPEG is refused, not passed through
  let threw = false;
  try { PHOTO.strip(new Uint8Array(bytes('\x89PNG\r\n\x1a\n'))); } catch (e) { threw = true; }
  ok(threw, 'strip accepted a PNG');
}
console.log(`stripping: ${SECRETS.length} secrets searched for in each copy, none found`);

// ---- 3. damaged files never crash the reader, and never smuggle a note out ----
{
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let stripped = 0;
  for (let i = 0; i < 3000; i++) {
    const b = jpeg(i & 1, { tail: !(i & 2) }).slice();
    const cut = b.subarray(0, i % 3 ? b.length : 2 + rnd(b.length - 2)).slice();
    for (let k = 0; k < 1 + rnd(4); k++) cut[rnd(cut.length)] = rnd(256);
    try { PHOTO.inspect(cut); PHOTO.leftovers(cut); } catch (e) { ok(false, `inspect threw on damaged file ${i}: ${e.message}`); }
    let out;
    try { out = PHOTO.strip(cut); } catch (e) { continue; }
    stripped++;
    let s;
    try { s = PHOTO.segments(out); } catch (e) { ok(false, `damaged file ${i}: the copy cannot be read back: ${e.message}`); continue; }
    ok(s.list.every((x) => x.m < 0xE0 || x.m > 0xEF || x.m === 0xE0 || x.m === 0xE2 || x.m === 0xEE),
      `damaged file ${i}: a note segment survived`);
    ok(s.list.every((x) => x.m !== 0xFE), `damaged file ${i}: a comment survived`);
    ok(s.tail === 0, `damaged file ${i}: data after the end mark survived`);
  }
  console.log(`damage: 3000 broken files read without crashing, ${stripped} stripped clean`);
}

// ---- 4. other kinds of photo ----
{
  const chunk = (type, data) => [0, 0, data.length >> 8, data.length & 255, ...bytes(type), ...data, 0, 0, 0, 0];
  const png = new Uint8Array([0x89, ...bytes('PNG\r\n\x1a\n'),
    ...chunk('IHDR', new Array(13).fill(0)), ...chunk('eXIf', EXIF(false)),
    ...chunk('iTXt', bytes('XML:com.adobe.xmp\0')), ...chunk('IEND', [])]);
  const p = PHOTO.inspect(png);
  ok(p.type === 'png' && p.exif && p.exif.gps, `PNG EXIF not read: ${JSON.stringify(p)}`);
  ok(p.extras.includes('XMP'), 'PNG XMP not found');

  const exif = [...bytes('Exif\0\0'), ...EXIF(true)];
  const body = [...bytes('WEBP'), ...bytes('VP8X'), 10, 0, 0, 0, ...new Array(10).fill(0),
    ...bytes('EXIF'), exif.length & 255, exif.length >> 8, 0, 0, ...exif, ...(exif.length & 1 ? [0] : [])];
  const webp = new Uint8Array([...bytes('RIFF'), body.length & 255, body.length >> 8, 0, 0, ...body]);
  const w = PHOTO.inspect(webp);
  ok(w.type === 'webp' && w.exif && w.exif.gps && w.exif.camera === 'Canon EOS TEST', `WebP EXIF not read: ${JSON.stringify(w)}`);

  // HEIC keeps EXIF in a box of its own; the block inside still starts the same way.
  const heic = new Uint8Array([0, 0, 0, 24, ...bytes('ftypheic'), ...new Array(300).fill(7), 0, 0, 0, 6, ...exif]);
  const h = PHOTO.inspect(heic);
  ok(h.type === 'other' && h.exif && h.exif.gps, `HEIC-like EXIF not found: ${JSON.stringify(h)}`);
  ok(PHOTO.leftovers(heic).length > 0, 'a HEIC file passes as a clean JPEG');
  console.log('other kinds: PNG, WebP and HEIC notes found');
}

// ---- 5. fitting the limit ----
// A stand-in for the browser's encoder: bytes grow with pixels and quality,
// with a deterministic wobble, because real JPEG sizes are not smooth.
function encoder(wobble) {
  const calls = [];
  const fn = (W, H, q) => {
    calls.push([W, H, q]);
    const jitter = wobble ? 1 + 0.04 * Math.sin(W * 12.9898 + H * 78.233 + q * 437.585) : 1;
    return Promise.resolve({ length: Math.round((600 + W * H * (0.08 + 1.4 * q ** 3)) * jitter) });
  };
  fn.calls = calls;
  return fn;
}

const PHOTOS = [[4032, 3024], [3024, 4032], [6000, 4000], [8000, 6000], [1200, 900], [500, 500], [12000, 300]];
const LIMITS = [20e3, 100e3, 250e3, 500e3, 1e6, 2e6, 5e6, 20e6];
const CAPS = [0, 2560, 1600, 1024];
let fits = 0, nones = 0;
for (const [w, h] of PHOTOS) {
  for (const limit of LIMITS) {
    for (const cap of CAPS) {
      const enc = encoder(true);
      const r = await PHOTO.fit(w, h, limit, cap, enc);
      const tag = `${w}x${h} under ${limit} capped at ${cap}`;
      ok(enc.calls.length <= 12 * 7, `${tag}: ${enc.calls.length} encodes`);
      if (!r) { nones++; ok(limit <= 100e3 && Math.min(w, h) <= 500, `${tag}: gave up`); continue; }
      fits++;
      ok(r.bytes.length <= limit, `${tag}: ${r.bytes.length} bytes is over the limit`);
      ok(r.width <= w && r.height <= h, `${tag}: made bigger, ${r.width}x${r.height}`);
      if (cap) ok(Math.max(r.width, r.height) <= cap, `${tag}: ${r.width}x${r.height} is over the cap`);
      ok(r.width * r.height <= PHOTO.MAXPIX * 1.001, `${tag}: ${r.width}x${r.height} is over the canvas ceiling`);
      ok(w >= h ? Math.abs(r.height - r.width * h / w) <= 1 : Math.abs(r.width - r.height * w / h) <= 1,
        `${tag}: shape changed to ${r.width}x${r.height}`);
      ok(r.quality >= PHOTO.QMIN && r.quality <= PHOTO.QMAX, `${tag}: quality ${r.quality}`);
      // the last thing encoded at the returned size and quality is what is returned
      ok(enc.calls.some(([W, H, q]) => W === r.width && H === r.height && q === r.quality), `${tag}: returned something never encoded`);
    }
  }
}
console.log(`fitting: ${fits + nones} cases, every result under its limit`);

{ // a limit no photo can meet is refused rather than missed
  ok(await PHOTO.fit(4032, 3024, 1000, 0, encoder(false)) === null, 'a 1000-byte limit was not refused');
}
{ // when the best is already small enough, nothing is given up for it
  const r = await PHOTO.fit(1200, 900, 5e6, 0, encoder(false));
  ok(r.width === 1200 && r.height === 900 && r.quality === PHOTO.QMAX, 'a photo that fits was still made worse');
}
{ // quality is given up before pixels are
  const enc = encoder(false);
  const fullTop = (await enc(4032, 3024, PHOTO.QMAX)).length, fullLow = (await enc(4032, 3024, PHOTO.QMIN)).length;
  const r = await PHOTO.fit(4032, 3024, Math.round((fullTop + fullLow) / 2), 0, encoder(false));
  ok(r.width === 4032 && r.quality > PHOTO.QMIN && r.quality < PHOTO.QMAX, `mid-size limit gave ${r.width}px at ${r.quality}`);
}
{ // a bigger allowance never buys a smaller picture
  let last = 0;
  for (let limit = 50e3; limit <= 8e6; limit *= 1.3) {
    const r = await PHOTO.fit(4032, 3024, limit, 0, encoder(false));
    const px = r.width * r.height;
    ok(px >= last, `limit ${Math.round(limit)} gave fewer pixels than a smaller limit`);
    last = px;
  }
}
console.log('fitting: quality first, pixels second, more room never means less picture');

// ---- 6. keeping the original pixels ----
{
  const jpg = (orientation) => ({ type: 'jpeg', exif: orientation === undefined ? null : { orientation }, extras: [] });
  ok(PHOTO.keepsPixels(jpg(), 900e3, 1e6, 4000, 3000, 0), 'a fitting JPEG is re-saved');
  ok(PHOTO.keepsPixels(jpg(1), 900e3, 1e6, 4000, 3000, 0), 'an upright fitting JPEG is re-saved');
  ok(!PHOTO.keepsPixels(jpg(6), 900e3, 1e6, 4000, 3000, 0), 'a sideways JPEG would lose its turn');
  ok(!PHOTO.keepsPixels(jpg(), 1.1e6, 1e6, 4000, 3000, 0), 'an oversized JPEG is kept');
  ok(!PHOTO.keepsPixels(jpg(), 900e3, 1e6, 4000, 3000, 2560), 'the size choice is ignored');
  ok(PHOTO.keepsPixels(jpg(), 900e3, 1e6, 2000, 1500, 2560), 'a JPEG already small enough is re-saved');
  ok(!PHOTO.keepsPixels({ type: 'png', exif: null, extras: [] }, 10e3, 1e6, 400, 300, 0), 'a PNG is passed through');
}
console.log('original pixels: kept only when that is safe');

// ---- 7. words ----
const S = [[512, '512 bytes'], [4321, '4.3 KB'], [999999, '999 KB'], [1e6, '1.0 MB'],
  [1999999, '1.9 MB'], [4312345, '4.3 MB'], [12.9e6, '12 MB']];
for (const [n, want] of S) ok(PHOTO.sizeText(n) === want, `sizeText(${n}): got "${PHOTO.sizeText(n)}" want "${want}"`);
ok(PHOTO.removedText(PHOTO.inspect(jpeg(true))) === 'It no longer says where it was taken, which camera took it or when.',
  `removedText: "${PHOTO.removedText(PHOTO.inspect(jpeg(true)))}"`);
ok(PHOTO.removedText({ exif: { gps: true }, extras: [] }) === 'It no longer says where it was taken.', 'removedText for GPS only');
ok(PHOTO.removedText({ exif: null, extras: ['XMP'] }) === 'Its hidden notes were removed.', 'removedText for XMP only');
console.log('wording: sizes and sentences checked');

console.log(fails ? `\n${fails} failure(s)` : '\nall photo tests passed');
process.exit(fails ? 1 : 0);
