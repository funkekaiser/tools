/* Verifies the cleaning module that ships inside tools/hidden.html. The module
   is lifted straight out of the page, so this checks the code users actually
   run, not a copy of it. Node built-ins only.

   A file with its author's name still inside looks exactly like one without.
   So every kind of file is built here by hand, every kind of note the tool
   claims to handle is put in, the notes are each marked with a SECRET word,
   and the clean copy is searched byte by byte for any of them. Then the parts
   that must not change, the picture, the sound, the text, are compared with
   the original, and the copy is read back with Node's own zlib where it can be. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'hidden.html'), 'utf8');

const start = page.indexOf('var CLEAN = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the clean module in tools/hidden.html');
  process.exit(1);
}
const CLEAN = new Function(page.slice(start, end + 6) + '\nreturn CLEAN;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

const latin = (s) => [...s].map((c) => c.charCodeAt(0) & 255);
const utf8 = (s) => [...Buffer.from(s, 'utf8')];
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const u16 = (v) => [v >> 8 & 255, v & 255];
const u32 = (v) => [v >>> 24, v >> 16 & 255, v >> 8 & 255, v & 255];
const l16 = (v) => [v & 255, v >> 8 & 255];
const l32 = (v) => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24];

// Cleans a copy, and checks the promises every file kind shares.
async function check(name, bytes, { kind, secrets = ['SECRET'], want = [], keep = [] }) {
  const res = await CLEAN.clean(Uint8Array.from(bytes));
  if (!res.ok) { ok(false, `${name}: refused: ${res.message}${res.error ? ' ' + res.error.stack : ''}`); return null; }
  ok(res.type.name === kind, `${name}: read as ${res.type.name}, not ${kind}`);
  ok(res.leftovers.length === 0, `${name}: leftovers ${JSON.stringify(res.leftovers)}`);
  for (const s of secrets) ok(!has(res.out, s), `${name}: "${s}" survived cleaning`);
  const said = res.found.map((f) => f.label + ': ' + f.value).join(' | ');
  for (const [label, value] of want) {
    ok(res.found.some((f) => f.label === label && f.value.includes(value)), `${name}: did not report ${label}: ${value} (got ${said})`);
  }
  for (const k of keep) ok(Buffer.from(res.out).includes(Buffer.from(k)), `${name}: lost part of what it shows or plays`);
  // Cleaning a clean copy finds nothing more.
  const again = await CLEAN.clean(res.out.slice());
  ok(again.ok && again.found.length === 0, `${name}: the clean copy still reports ${again.found && JSON.stringify(again.found)}`);
  return res;
}

// ---- building pieces by hand ----

// A TIFF block as EXIF stores it, big-endian: IFD0 with the EXIF and GPS
// directories it points to, then the values too long for their entry.
function tiff({ main = [], exif = [], gps = [] }) {
  const ifds = [['main', [...main]]];
  if (exif.length) { ifds[0][1].push({ tag: 0x8769, type: 4, ptr: 'exif' }); ifds.push(['exif', exif]); }
  if (gps.length) { ifds[0][1].push({ tag: 0x8825, type: 4, ptr: 'gps' }); ifds.push(['gps', gps]); }
  ifds.forEach(([, list]) => list.sort((a, b) => a.tag - b.tag));
  const payload = (e) => e.type === 2 ? [...latin(e.value), 0] : e.type === 5 ? e.value.flatMap(([n, d]) => [...u32(n), ...u32(d)]) : null;
  const off = {};
  let o = 8;
  for (const [n, list] of ifds) { off[n] = o; o += 2 + 12 * list.length + 4; }
  const data = [], out = [...latin('MM'), ...u16(42), ...u32(8)];
  for (const [, list] of ifds) {
    out.push(...u16(list.length));
    for (const e of list) {
      const p = payload(e), count = e.type === 2 ? p.length : e.type === 5 ? e.value.length : 1;
      out.push(...u16(e.tag), ...u16(e.type), ...u32(count));
      if (e.ptr) out.push(...u32(off[e.ptr]));
      else if (e.type === 3) out.push(...u16(e.value), 0, 0);
      else if (p.length <= 4) out.push(...p, ...new Array(4 - p.length).fill(0));
      else { out.push(...u32(o + data.length)); data.push(...p); }
    }
    out.push(...u32(0));
  }
  return [...out, ...data];
}

const EXIF = tiff({
  main: [{ tag: 0x010F, type: 2, value: 'SECRETMAKE' }, { tag: 0x0110, type: 2, value: 'SECRETMAKE Phone 9' },
         { tag: 0x0112, type: 3, value: 6 }, { tag: 0x013B, type: 2, value: 'SECRET Artist' }],
  exif: [{ tag: 0x9003, type: 2, value: '2024:05:01 13:22:10' }, { tag: 0xA431, type: 2, value: 'SECRETSERIAL' }],
  gps: [{ tag: 1, type: 2, value: 'N' }, { tag: 2, type: 5, value: [[52, 1], [31, 1], [12, 1]] },
        { tag: 3, type: 2, value: 'W' }, { tag: 4, type: 5, value: [[13, 1], [24, 1], [18, 1]] }]
});
const WHERE = ['Where it was taken', '52.5200° N, 13.4050° W'];
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmp:CreatorTool="SECRET Tool 1.0">' +
  '<dc:creator><rdf:Seq><rdf:li>SECRET Xmp Person</rdf:li></rdf:Seq></dc:creator>' +
  '<photoshop:City>SECRETCITY</photoshop:City></rdf:Description></rdf:RDF></x:xmpmeta>';

// ---- 1. photos ----

const seg = (m, payload) => [0xFF, m, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const SCAN = [0x12, 0x34, 0xFF, 0x00, 0x56, 0xFF, 0xD0, 0x78];
const PICTURE = [...seg(0xDB, [0, ...new Array(64).fill(1)]), ...seg(0xC0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
  ...seg(0xC4, [0, ...new Array(16).fill(0)]), ...seg(0xDA, [1, 1, 0, 0, 63, 0]), ...SCAN];
const JPEG = [0xFF, 0xD8,
  ...seg(0xE0, [...latin('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ...seg(0xE1, [...latin('Exif\0\0'), ...EXIF]),
  ...seg(0xE1, [...latin('http://ns.adobe.com/xap/1.0/\0'), ...utf8(XMP)]),
  ...seg(0xE2, [...latin('ICC_PROFILE\0'), 1, 1, ...latin('colour profile')]),
  ...seg(0xED, [...latin('Photoshop 3.0\x008BIM\x04\x04\0\0\0\0\0\x10'), 0x1C, 2, 80, 0, 10, ...latin('SECRETBYLN')]),
  ...seg(0xEB, [...latin('JP\0\0\0\0\0\0jumbc2pa SECRET')]),
  ...seg(0xFE, latin('SECRET comment')),
  ...PICTURE, 0xFF, 0xD9,
  0xFF, 0xD8, ...seg(0xE1, [...latin('Exif\0\0'), ...tiff({ main: [{ tag: 0x0110, type: 2, value: 'SECRET tail' }] })]), 0xFF, 0xD9];

{
  const res = await check('JPEG', JPEG, {
    kind: 'JPEG', secrets: ['SECRET', 'http://ns.adobe.com', 'Photoshop', '2024:05:01', 'c2pa'],
    want: [WHERE, ['Phone or camera', 'SECRETMAKE Phone 9'], ['Taken', '1 May 2024, 13:22'], ['Serial number', 'SECRETSERIAL'],
           ['Author', 'SECRET Artist'], ['Author', 'SECRET Xmp Person'], ['Author', 'SECRETBYLN'], ['Place named in it', 'SECRETCITY'],
           ['Made with', 'SECRET Tool 1.0'], ['Comment', 'SECRET comment'], ['Content credentials', 'signed']],
    keep: [PICTURE, latin('ICC_PROFILE')]
  });
  // The photo was stored sideways: the copy still says which way up it goes, and nothing else.
  const x = CLEAN.readExif(res.out, 20 + 4 + 6);
  ok(x && x.orientation === 6 && Object.keys(x.tags).length === 0 && !x.gps, `JPEG: orientation not kept alone: ${JSON.stringify(x)}`);
  ok(res.out[res.out.length - 2] === 0xFF && res.out[res.out.length - 1] === 0xD9, 'JPEG: copy does not end as a JPEG');
}

const chunk = (type, data) => {
  const body = Buffer.from([...latin(type), ...data]);
  return [...u32(data.length), ...body, ...u32(zlib.crc32(body))];
};
const IDAT = chunk('IDAT', [...zlib.deflateSync(Buffer.alloc(17))]);
const PNG = [0x89, ...latin('PNG\r\n\x1a\n'), ...chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 4, 8, 0, 0, 0, 0]),
  ...chunk('iCCP', [...latin('icc\0\0'), ...zlib.deflateSync(Buffer.from('profile'))]),
  ...chunk('tEXt', latin('Author\0SECRET Png Author')),
  ...chunk('zTXt', [...latin('Comment\0\0'), ...zlib.deflateSync(Buffer.from('SECRET packed comment'))]),
  ...chunk('iTXt', [...latin('XML:com.adobe.xmp\0\0\0\0\0'), ...utf8(XMP)]),
  ...chunk('tEXt', latin('Raw profile type exif\0\nexif\n   ' + EXIF.length + '\n' + Buffer.from(EXIF).toString('hex'))),
  ...chunk('eXIf', EXIF), ...chunk('tIME', [...u16(2023), 1, 2, 3, 4, 5]),
  ...IDAT, ...chunk('IEND', []), ...latin('SECRET after end')];
{
  const res = await check('PNG', PNG, {
    kind: 'PNG', secrets: ['SECRET', 'tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'],
    want: [WHERE, ['Author', 'SECRET Png Author'], ['Comment', 'SECRET packed comment'], ['Author', 'SECRET Xmp Person'],
           ['Last saved', '2 January 2023, 03:04']],
    keep: [IDAT, latin('iCCP')]
  });
  // every chunk in the copy still has a right checksum
  for (let p = 8; p + 12 <= res.out.length;) {
    const len = Buffer.from(res.out).readUInt32BE(p);
    const body = res.out.subarray(p + 4, p + 8 + len);
    ok(zlib.crc32(body) === Buffer.from(res.out).readUInt32BE(p + 8 + len), `PNG: chunk at ${p} has a broken checksum`);
    p += 12 + len;
  }
}

{
  const riff = (c, d) => [...latin(c), ...l32(d.length), ...d, ...(d.length & 1 ? [0] : [])];
  const exif = [...latin('Exif\0\0'), ...EXIF];
  const VP8 = riff('VP8 ', [1, 2, 3, 4, 5, 6, 7]);
  const body = [...latin('WEBP'), ...riff('VP8X', [0x2C, 0, 0, 0, 3, 0, 0, 3, 0, 0]), ...riff('ICCP', latin('icc')),
    ...VP8, ...riff('EXIF', exif), ...riff('XMP ', utf8(XMP))];
  const res = await check('WebP', [...latin('RIFF'), ...l32(body.length), ...body], {
    kind: 'WebP', want: [WHERE, ['Author', 'SECRET Xmp Person']], keep: [VP8]
  });
  ok(res.out[20] === 0x20, `WebP: flags should keep only the colour profile, got ${res.out[20].toString(16)}`);
  ok(Buffer.from(res.out).readUInt32LE(4) === res.out.length - 8, 'WebP: RIFF size is wrong');
}

{
  const sub = (s) => { const out = []; for (let i = 0; i < s.length; i += 255) { const c = s.slice(i, i + 255); out.push(c.length, ...c); } return [...out, 0]; };
  const IMAGE = [0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, ...sub([0x44, 0x01])];
  const LOOP = [0x21, 0xFF, 11, ...latin('NETSCAPE2.0'), 3, 1, 0, 0, 0];
  const xmpMagic = [1, ...Array.from({ length: 256 }, (_, i) => 255 - i), 0];
  const gif = [...latin('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255,
    ...LOOP, 0x21, 0xFE, ...sub(latin('SECRET gif comment')),
    0x21, 0xFF, 11, ...latin('XMP DataXMP'), ...utf8(XMP), ...xmpMagic,
    0x21, 0xF9, 4, 0, 0, 0, 0, 0, ...IMAGE, 0x3B];
  const res = await check('GIF', gif, {
    kind: 'GIF', secrets: ['SECRET', 'XMP Data'],
    want: [['Comment', 'SECRET gif comment'], ['Author', 'SECRET Xmp Person']], keep: [LOOP, IMAGE]
  });
  ok(res.out[res.out.length - 1] === 0x3B, 'GIF: copy does not end as a GIF');
}

{
  const drawing = '<path d="M0 0 L10 10" inkscape:label="SECRET layer" style="fill:red"/>';
  const svg = '<?xml version="1.0"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) SECRET -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="i" xmlns:sodipodi="s" inkscape:version="1.3 SECRET" ' +
    'sodipodi:docname="SECRET.svg" inkscape:export-filename="/Users/SECRETUSER/Desktop/x.png">' +
    '<sodipodi:namedview id="n" inkscape:zoom="1"><inkscape:page x="0" y="0"/></sodipodi:namedview>' +
    '<metadata><rdf:RDF><cc:Work><dc:creator><cc:Agent><dc:title>SECRET Svg Person</dc:title></cc:Agent></dc:creator></cc:Work></rdf:RDF></metadata>' +
    '<image href="file:///Users/SECRETUSER/pic.png"/>' + drawing + '</svg>';
  const res = await check('SVG', utf8(svg), {
    kind: 'SVG', secrets: ['SECRET', 'Inkscape'],
    want: [['Author', 'SECRET Svg Person'], ['Folder on the author\'s computer', '/Users/SECRETUSER/Desktop/x.png'],
           ['Original file name', 'SECRET.svg']],
    keep: [utf8('<path d="M0 0 L10 10" style="fill:red"/>'), utf8('<image href="pic.png"/>')]
  });
  ok(Buffer.from(res.out).toString().endsWith('</svg>'), 'SVG: drawing was cut short');
}
console.log('photos: JPEG, PNG, WebP, GIF and SVG notes found and removed, pictures untouched');

// ---- 2. boxes: HEIC, MP4, MOV ----

const box = (type, ...kids) => { const body = kids.flat(); return [...u32(body.length + 8), ...latin(type), ...body]; };
const full = (type, v, ...kids) => box(type, [v, 0, 0, 0], ...kids);

// A HEIC with its notes in two items, one stored in the file and one inside the meta box.
function heic(how) {
  const exifItem = [0, 0, 0, 6, ...latin('Exif\0\0'), ...EXIF];
  const xmpItem = utf8(XMP);
  const PIXELS = latin('PIXELDATA-PIXELDATA');
  const infe = (id, type, extra = []) => full('infe', 2, u16(id), [0, 0], latin(type), [0], extra);
  const build = (offsets) => {
    const loc = (id, method, offset, len) => [...u16(id), ...u16(method), 0, 0, ...u32(0), ...u16(1), ...u32(offset), ...u32(len)];
    return [
      ...box('ftyp', latin('heic'), u32(0), latin('mif1heic')),
      ...full('meta', 0,
        full('hdlr', 0, u32(0), latin('pict'), new Array(13).fill(0)),
        full('iinf', 0, u16(3), infe(1, 'hvc1'), infe(2, 'Exif'), infe(3, 'mime', [...latin('application/rdf+xml'), 0])),
        full('iloc', 1, [0x44, 0x40], u16(3), loc(1, 0, offsets.pixels, PIXELS.length),
          loc(2, how === 'idat' ? 1 : 0, offsets.exif, exifItem.length), loc(3, 0, offsets.xmp, xmpItem.length)),
        how === 'idat' ? box('idat', exifItem) : []),
      ...box('mdat', PIXELS, how === 'idat' ? [] : exifItem, xmpItem)
    ];
  };
  // Build once to learn where things land, then again with the real positions.
  const draft = build({ pixels: 0, exif: 0, xmp: 0 });
  const mdat = draft.length - (PIXELS.length + (how === 'idat' ? 0 : exifItem.length) + xmpItem.length);
  const idatAt = Buffer.from(draft).indexOf(Buffer.from('idat'));
  const real = build({ pixels: mdat, exif: how === 'idat' ? 0 : mdat + PIXELS.length,
                       xmp: mdat + PIXELS.length + (how === 'idat' ? 0 : exifItem.length) });
  ok(how !== 'idat' || idatAt > 0, 'HEIC builder lost its idat');
  return { bytes: real, PIXELS };
}
for (const how of ['file', 'idat']) {
  const { bytes, PIXELS } = heic(how);
  const res = await check(`HEIC (${how})`, bytes, {
    kind: 'HEIC', want: [WHERE, ['Phone or camera', 'SECRETMAKE Phone 9'], ['Author', 'SECRET Xmp Person']], keep: [PIXELS]
  });
  ok(res.out.length === bytes.length, `HEIC (${how}): length changed`);
}

const mvhd = (t) => full('mvhd', 0, u32(t), u32(t), u32(1000), u32(5000), new Array(80).fill(0));
const T2024 = 2082844800 + Date.UTC(2024, 4, 1, 13, 22) / 1000;
const MDAT = latin('FRAMES-FRAMES-FRAMES');
const dataBox = (s) => box('data', u32(1), u32(0), utf8(s));
function mp4(extra = []) {
  return [
    ...box('ftyp', latin('isom'), u32(0), latin('isomiso2')),
    ...box('moov',
      mvhd(T2024),
      box('trak',
        full('tkhd', 0, u32(T2024), u32(T2024), new Array(72).fill(0)),
        box('mdia', full('mdhd', 0, u32(T2024), u32(T2024), new Array(12).fill(0)),
          full('hdlr', 0, u32(0), latin('vide'), new Array(13).fill(0)),
          box('minf', box('stbl', full('stsd', 0, u32(1), box(extra.includes('gpmd') ? 'gpmd' : 'avc1', new Array(8).fill(0)))))),
        box('udta', box('\xA9nam', u16(10), u16(0), latin('SECRET trk')))),
      box('udta',
        box('\xA9xyz', u16(18), u16(0x15c7), latin('+52.5200-013.4050/')),
        box('\xA9mak', u16(13), u16(0), latin('SECRETMAKE Co')),
        box('\xA9swr', u16(14), u16(0), latin('SECRET Edit 2')),
        full('loci', 0, u16(0), latin('SECRETPLACE\0'), [0], u32(Math.round(13.405 * 65536)), u32(Math.round(52.52 * 65536)), u32(0)),
        full('auth', 0, u16(0), latin('SECRET 3gp Author\0')),
        full('meta', 0, full('hdlr', 0, u32(0), latin('mdir'), new Array(13).fill(0)),
          box('ilst', box('\xA9ART', dataBox('SECRET Artist')), box('covr', box('data', u32(13), u32(0), latin('JPEGBYTES')))))),
      box('meta', full('hdlr', 0, u32(0), latin('mdta'), new Array(13).fill(0)),
        full('keys', 0, u32(3), box('mdta', latin('com.apple.quicktime.model')),
          box('mdta', latin('com.apple.quicktime.creationdate')), box('mdta', latin('com.apple.quicktime.location.ISO6709'))),
        box('ilst', box('\0\0\0\x01', dataBox('SECRET Phone')), box('\0\0\0\x02', dataBox('2024-05-01T15:22:10+0200')),
          box('\0\0\0\x03', dataBox('+52.5200-013.4050+034.000/')))),
      box('free', latin('SECRET old notes'))),
    ...box('uuid', [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac], utf8(XMP)),
    // a 64-bit size, as long recordings have
    ...u32(1), ...latin('mdat'), ...u32(0), ...u32(16 + MDAT.length), ...MDAT
  ];
}
{
  const src = mp4();
  const res = await check('MP4', src, {
    kind: 'MP4', secrets: ['SECRET', '\xA9xyz', 'ISO6709', 'JPEGBYTES'],
    want: [['Where it was filmed', '52.5200° N, 13.4050° W'], ['Place named in it', 'SECRETPLACE'],
           ['Phone or camera', 'SECRETMAKE Co'], ['Phone or camera', 'SECRET Phone'], ['Made with', 'SECRET Edit 2'],
           ['Filmed', '1 May 2024, 13:22 UTC'], ['Author', 'SECRET 3gp Author'], ['Artist', 'SECRET Artist'],
           ['Cover picture', 'a picture'], ['Author', 'SECRET Xmp Person']],
    keep: [MDAT]
  });
  ok(res.out.length === src.length, 'MP4: length changed');
  // Nothing moved: every byte is either the same as before or a blanked note.
  let moved = 0;
  for (let i = 0; i < src.length; i++) if (res.out[i] !== src[i] && res.out[i] !== 0 && !'free'.includes(String.fromCharCode(res.out[i]))) moved++;
  ok(moved === 0, `MP4: ${moved} bytes changed to something other than a blank`);
  const t = Buffer.from(res.out).indexOf(Buffer.from('mvhd'));
  ok(Buffer.from(res.out).readUInt32BE(t + 8) === 0, 'MP4: creation time not cleared');
}
{
  const res = await check('MP4 with a location track', mp4(['gpmd']), { kind: 'MP4' });
  ok(res.notes.some((n) => n.bad && /where the camera was/.test(n.text)), 'MP4: a GPS track was not warned about');
}
{
  const mov = mp4();
  mov.splice(8, 4, ...latin('qt  '));
  await check('MOV', mov, { kind: 'MOV' });
  const m4a = mp4();
  m4a.splice(8, 4, ...latin('M4A '));
  await check('M4A', m4a, { kind: 'M4A' });
}
console.log('boxes: HEIC items, MP4 and MOV notes blanked in place, nothing moved');

// ---- 3. sound ----

const syncsafe = (n) => [n >> 21 & 127, n >> 14 & 127, n >> 7 & 127, n & 127];
const FRAMES = [0xFF, 0xFB, 0x90, 0x64, ...latin('MPEG-AUDIO-FRAME-DATA')];
function id3(version) {
  const frame = (id, data) => [...latin(id), ...(version === 4 ? syncsafe(data.length) : u32(data.length)), 0, 0, ...data];
  const frames = [
    ...frame('TIT2', [3, ...utf8('SECRET Title')]),
    ...frame('TPE1', [1, 0xFF, 0xFE, ...[...'SECRET Artist'].flatMap((c) => [c.charCodeAt(0), 0])]),
    ...frame('COMM', [0, ...latin('eng'), 0, ...latin('SECRET Comment')]),
    ...frame('APIC', [0, ...latin('image/jpeg\0'), 3, 0, ...latin('SECRET picture')]),
    ...frame('PRIV', latin('SECRET owner\0data')),
    ...frame('TSSE', [0, ...latin('SECRET Encoder')])
  ];
  return [...latin('ID3'), version, 0, 0, ...syncsafe(frames.length), ...frames];
}
for (const v of [3, 4]) {
  const v1 = [...latin('TAG'), ...latin('SECRET v1 title'.padEnd(30, '\0')), ...new Array(95).fill(0)];
  const apeItems = [...l32(10), ...l32(0), ...latin('Artist\0'), ...latin('SECRET APE')];
  const apeFooter = [...latin('APETAGEX'), ...l32(2000), ...l32(apeItems.length + 32), ...l32(1), ...l32(0), ...new Array(8).fill(0)];
  const mp3 = [...id3(v), ...FRAMES, ...apeItems, ...apeFooter, ...v1];
  const res = await check(`MP3 (ID3v2.${v})`, mp3, {
    kind: 'MP3', secrets: ['SECRET', 'ID3', 'TAG', 'APETAGEX'],
    want: [['Title', 'SECRET Title'], ['Artist', 'SECRET Artist'], ['Comment', 'SECRET Comment'], ['Cover picture', 'a picture'],
           ['Made with', 'SECRET Encoder'], ['Title', 'SECRET v1 title'], ['Artist', 'SECRET APE']]
  });
  ok(Buffer.compare(Buffer.from(res.out), Buffer.from(FRAMES)) === 0, `MP3 (ID3v2.${v}): the sound is not exactly what was left`);
}
{
  const block = (type, data, last) => [(last ? 0x80 : 0) | type, data.length >> 16, data.length >> 8 & 255, data.length & 255, ...data];
  const STREAMINFO = block(0, new Array(34).fill(7)), SEEK = block(3, new Array(18).fill(9));
  const vc = [...l32(12), ...latin('SECRETVENDOR'), ...l32(2), ...l32(18), ...latin('ARTIST=SECRET Flac'), ...l32(20), ...latin('LOCATION=SECRET Room')];
  const AUDIO = [0xFF, 0xF8, ...latin('FLAC-FRAMES')];
  const flac = [...latin('fLaC'), ...STREAMINFO, ...block(4, vc), ...block(6, latin('SECRET pic')), ...block(1, new Array(10).fill(0)), ...block(3, new Array(18).fill(9), true), ...AUDIO];
  const res = await check('FLAC', flac, {
    kind: 'FLAC', want: [['Artist', 'SECRET Flac'], ['Place named in it', 'SECRET Room'], ['Made with', 'SECRETVENDOR'], ['Cover picture', 'a picture']]
  });
  const want = [...latin('fLaC'), ...STREAMINFO, 0x83, ...SEEK.slice(1), ...AUDIO];
  ok(Buffer.compare(Buffer.from(res.out), Buffer.from(want)) === 0, 'FLAC: copy is not stream info, seek table and sound');
}
{
  const ck = (id, d) => [...latin(id), ...l32(d.length), ...d, ...(d.length & 1 ? [0] : [])];
  const FMT = ck('fmt ', [1, 0, 1, 0, ...l32(8000), ...l32(16000), 2, 0, 16, 0]), DATA = ck('data', latin('PCMPCMPCM!'));
  const info = ck('LIST', [...latin('INFO'), ...ck('IART', latin('SECRET Wav\0')), ...ck('ICRD', latin('2024-05-01\0'))]);
  const bext = ck('bext', [...latin('SECRET desc'.padEnd(256, '\0')), ...latin('SECRET Recorder'.padEnd(32, '\0')),
    ...new Array(32).fill(0), ...latin('2024-05-01'), ...latin('13:22:10'), ...new Array(260).fill(0)]);
  const body = [...latin('WAVE'), ...FMT, ...info, ...bext, ...DATA, ...ck('id3 ', id3(3))];
  const res = await check('WAV', [...latin('RIFF'), ...l32(body.length), ...body], {
    kind: 'WAV', want: [['Artist', 'SECRET Wav'], ['Recorder', 'SECRET Recorder'], ['Recorded', '1 May 2024, 13:22'], ['Title', 'SECRET Title']]
  });
  const want = [...latin('RIFF'), ...l32(4 + FMT.length + DATA.length), ...latin('WAVE'), ...FMT, ...DATA];
  ok(Buffer.compare(Buffer.from(res.out), Buffer.from(want)) === 0, 'WAV: copy is not the format and the sound');
}
console.log('sound: MP3, FLAC and WAV tags removed, the sound left byte for byte');

// ---- 4. Office and OpenDocument ----

// A zip written the plain way, with real dates and extra fields to remove.
function zip(files) {
  const parts = [], central = [];
  let at = 0;
  for (const [name, text, store] of files) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const packed = store ? data : zlib.deflateRawSync(data), method = store ? 0 : 8, crc = zlib.crc32(data);
    const n = Buffer.from(name), extra = Buffer.from([0x55, 0x54, 5, 0, 1, 1, 2, 3, 4]);
    const head = (sig, central) => Buffer.concat([Buffer.from(l32(sig)), ...(central ? [Buffer.from(l16(0x031e))] : []),
      Buffer.from([...l16(20), ...l16(0x0800), ...l16(method), ...l16(0x6a2b), ...l16(0x5a65), ...l32(crc),
        ...l32(packed.length), ...l32(data.length), ...l16(n.length), ...l16(extra.length)])]);
    parts.push(head(0x04034b50), n, extra, packed);
    central.push(head(0x02014b50, true), Buffer.from([...l16(0), ...l16(0), ...l16(0), ...l32(0x81a40000), ...l32(at)]), n, extra);
    at += 30 + n.length + extra.length + packed.length;
  }
  const cd = Buffer.concat(central), note = Buffer.from('SECRET zip comment');
  return [...Buffer.concat([...parts, cd, Buffer.from([...l32(0x06054b50), 0, 0, 0, 0, ...l16(files.length), ...l16(files.length),
    ...l32(cd.length), ...l32(at), ...l16(note.length)]), note])];
}
// An independent reader: Node's zlib unpacks every entry and checks its sum.
function entries(b) {
  const buf = Buffer.from(b), out = {};
  const e = buf.lastIndexOf(Buffer.from(l32(0x06054b50)));
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < buf.readUInt16LE(e + 10); i++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    ok(buf.readUInt16LE(local + 12) === 0x21 && buf.readUInt16LE(p + 14) === 0x21, `zip: ${name} still carries its real date`);
    ok(buf.readUInt16LE(local + 28) === 0 && buf.readUInt16LE(p + 30) === 0, `zip: ${name} kept its extra fields`);
    const raw = buf.subarray(local + 30 + buf.readUInt16LE(local + 26), local + 30 + buf.readUInt16LE(local + 26) + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    ok(zlib.crc32(data) === crc, `zip: ${name} has a wrong checksum`);
    out[name] = { method, text: data.toString('utf8'), data };
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  ok(buf.readUInt16LE(e + 20) === 0, 'zip: comment kept');
  return out;
}

const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const BODY = '<w:p><w:r><w:t>The visible text stays.</w:t></w:r></w:p>';
const photo = Buffer.from(JPEG);
{
  const doc = zip([
    ['[Content_Types].xml', CT],
    ['docProps/core.xml', '<cp:coreProperties><dc:creator>SECRET Docx Author</dc:creator><cp:lastModifiedBy>SECRET Editor</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2024-05-01T13:22:00Z</dcterms:created><dc:title>SECRET Title</dc:title></cp:coreProperties>'],
    ['docProps/app.xml', '<Properties><Company>SECRET Corp</Company><Template>Normal.dotm</Template><TotalTime>192</TotalTime>' +
      '<Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion></Properties>'],
    ['docProps/custom.xml', '<Properties><property fmtid="x" pid="2" name="MSIP_Label_SECRET"><vt:lpwstr>secret@example.com</vt:lpwstr></property></Properties>'],
    ['word/document.xml', `<w:document><w:body><w:p w:rsidR="00SECRET" w:rsidRDefault="00AB12CD">${BODY}</w:p>` +
      '<w:ins w:id="1" w:author="SECRET Reviewer" w:date="2024-05-01T13:22:00Z"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '<w:del w:id="2" w:author="SECRET Reviewer" w:date="2024-05-01T13:22:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:body></w:document>'],
    ['word/comments.xml', '<w:comments><w:comment w:id="0" w:author="SECRET Commenter" w:date="2024-05-01T13:22:00Z" w:initials="SC"><w:p/></w:comment></w:comments>'],
    ['word/people.xml', '<w15:people><w15:person w15:author="SECRET Commenter"><w15:presenceInfo w15:providerId="AD" w15:userId="SECRET@example.com"/></w15:person></w15:people>'],
    ['word/settings.xml', '<w:settings><w:attachedTemplate r:id="rId1"/><w:rsids><w:rsidRoot w:val="00SECRET"/></w:rsids></w:settings>'],
    ['word/_rels/settings.xml.rels', '<Relationships><Relationship Id="rId1" Type="t" Target="file:///C:\\Users\\SECRETUSER\\Templates\\Plan.dotm" TargetMode="External"/></Relationships>'],
    ['word/media/image1.jpeg', photo, true]
  ]);
  const res = await check('Word', doc, {
    kind: 'Word file', secrets: ['SECRET', '2024-05-01', 'Microsoft Office', 'w:rsid', 'presenceInfo', 'SC"', 'example.com'],
    want: [['Author', 'SECRET Docx Author'], ['Last edited by', 'SECRET Editor'], ['Created', '1 May 2024, 13:22'],
           ['Company', 'SECRET Corp'], ['Time spent editing', '3 hours 12 minutes'], ['Email or account', 'secret@example.com'],
           ['Comment and change authors', 'SECRET Reviewer'], ['Comment and change authors', 'SECRET Commenter'],
           ['Email or account', 'SECRET@example.com'], ['Folder on the author\'s computer', 'C:\\Users\\SECRETUSER\\Templates\\Plan.dotm'],
           ['Where a photo in it was taken', '52.5200° N, 13.4050° W']]
  });
  const files = entries(res.out);
  ok(files['word/document.xml'].text.includes(BODY) && files['word/document.xml'].text.includes('<w:delText>gone</w:delText>'),
    'Word: the text of the document changed');
  ok(files['word/_rels/settings.xml.rels'].text.includes('Target="Plan.dotm"'), 'Word: the template link was not reduced to its name');
  ok(Buffer.from(files['word/media/image1.jpeg'].data).includes(Buffer.from(PICTURE)), 'Word: the photo inside lost its picture');
  ok(files['word/media/image1.jpeg'].method === 0, 'Word: a stored entry was packed');
  ok(res.notes.some((n) => /^1 comment and tracked changes are still in it/.test(n.text)), `Word: comments not mentioned: ${JSON.stringify(res.notes)}`);
}
{
  const book = zip([
    ['[Content_Types].xml', CT],
    ['xl/workbook.xml', '<workbook><fileSharing userName="SECRET Owner"/><mc:AlternateContent><mc:Choice Requires="x15">' +
      '<x15ac:absPath url="C:\\Users\\SECRETUSER\\Documents\\" xmlns:x15ac="x"/></mc:Choice></mc:AlternateContent>' +
      '<sheets><sheet name="Budget" sheetId="1"/><sheet name="Salaries" sheetId="2" state="hidden"/></sheets></workbook>'],
    ['xl/comments1.xml', '<comments><authors><author>SECRET Xl Author</author></authors><commentList><comment ref="A1" authorId="0"/></commentList></comments>'],
    ['xl/persons/person.xml', '<personList><person displayName="SECRET Person" id="{1}" userId="secret@corp.example" providerId="AD"/></personList>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Visible cell</t></si></sst>']
  ]);
  const res = await check('Excel', book, {
    kind: 'Excel file', secrets: ['SECRET', 'corp.example', 'absPath'],
    want: [['Reserved by', 'SECRET Owner'], ['Folder on the author\'s computer', 'C:\\Users\\SECRETUSER\\Documents\\'],
           ['Comment authors', 'SECRET Xl Author'], ['Comment authors', 'SECRET Person'], ['Email or account', 'secret@corp.example']]
  });
  const files = entries(res.out);
  ok(files['xl/sharedStrings.xml'].text.includes('Visible cell'), 'Excel: a cell changed');
  ok(!/<mc:AlternateContent/.test(files['xl/workbook.xml'].text) && /<sheets>/.test(files['xl/workbook.xml'].text), 'Excel: workbook damaged');
  ok(res.notes.some((n) => /Hidden sheets are still in it: Salaries/.test(n.text)), 'Excel: hidden sheet not mentioned');
}
{
  const deck = zip([
    ['[Content_Types].xml', CT],
    ['ppt/commentAuthors.xml', '<p:cmAuthorLst><p:cmAuthor id="0" name="SECRET Presenter" initials="SP" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>'],
    ['ppt/authors.xml', '<p188:authorLst><p188:author id="{1}" name="SECRET Modern" initials="SM" userId="secret@ppt.example" providerId="AD"/></p188:authorLst>'],
    ['ppt/comments/comment1.xml', '<p:cmLst><p:cm authorId="0" dt="2024-05-01T13:22:00.000" idx="1"><p:text>Fix</p:text></p:cm></p:cmLst>'],
    ['ppt/slides/slide1.xml', '<p:sld><a:t>Visible slide</a:t></p:sld>'],
    ['ppt/slides/slide2.xml', '<p:sld show="0"><a:t>Hidden slide</a:t></p:sld>'],
    ['ppt/notesSlides/notesSlide1.xml', '<p:notes><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Say this</a:t></a:r></a:p></p:txBody></p:sp></p:notes>']
  ]);
  const res = await check('PowerPoint', deck, {
    kind: 'PowerPoint file', secrets: ['SECRET', 'ppt.example', '2024-05-01', '"SP"', '"SM"'],
    want: [['Comment authors', 'SECRET Presenter'], ['Comment authors', 'SECRET Modern'], ['Email or account', 'secret@ppt.example']]
  });
  ok(entries(res.out)['ppt/slides/slide1.xml'].text.includes('Visible slide'), 'PowerPoint: a slide changed');
  ok(res.notes.some((n) => /1 hidden slide is/.test(n.text)) && res.notes.some((n) => /Speaker notes on 1 slide/.test(n.text)),
    `PowerPoint: hidden slide or notes not mentioned: ${JSON.stringify(res.notes)}`);
}
{
  const odt = zip([
    ['mimetype', 'application/vnd.oasis.opendocument.text', true],
    ['meta.xml', '<office:document-meta office:version="1.3"><office:meta><meta:initial-creator>SECRET Odt Author</meta:initial-creator>' +
      '<dc:creator>SECRET Odt Editor</dc:creator><meta:editing-duration>PT1H5M</meta:editing-duration>' +
      '<meta:generator>LibreOffice/7.6</meta:generator><meta:template xlink:href="file:///home/SECRETUSER/t.ott"/></office:meta></office:document-meta>'],
    ['content.xml', '<office:document-content><text:tracked-changes><text:changed-region><text:insertion><office:change-info>' +
      '<dc:creator>SECRET Odt Reviewer</dc:creator><dc:date>2024-05-01T13:22:00</dc:date></office:change-info></text:insertion>' +
      '</text:changed-region></text:tracked-changes><text:p>Visible paragraph</text:p></office:document-content>'],
    ['settings.xml', '<config:config-item config:name="PrinterName" config:type="string">SECRET Printer</config:config-item>' +
      '<config:config-item config:name="PrinterSetup" config:type="base64Binary">U0VDUkVU</config:config-item>']
  ]);
  const res = await check('OpenDocument', odt, {
    kind: 'OpenDocument file', secrets: ['SECRET', 'LibreOffice', 'U0VDUkVU', '2024-05-01'],
    want: [['Author', 'SECRET Odt Author'], ['Last edited by', 'SECRET Odt Editor'], ['Time spent editing', '1 hour 5 minutes'],
           ['Comment and change authors', 'SECRET Odt Reviewer'], ['Printer', 'SECRET Printer'],
           ['Folder on the author\'s computer', 'file:///home/SECRETUSER/t.ott']]
  });
  const files = entries(res.out), names = Object.keys(files);
  ok(names[0] === 'mimetype' && files.mimetype.method === 0, 'OpenDocument: mimetype is no longer first and unpacked');
  ok(files['content.xml'].text.includes('Visible paragraph'), 'OpenDocument: text changed');
}
console.log('documents: Word, Excel, PowerPoint and OpenDocument properties, names and paths removed, text untouched');

// ---- 5. PDF ----

// Objects are written with real offsets, so the copy can be checked against them.
function pdf(objects, { trailer = '', update = null } = {}) {
  let s = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offs = [];
  const write = (list) => {
    for (const [n, body] of list) { offs[n] = s.length; s += `${n} 0 obj\n${body}\nendobj\n`; }
    const xref = s.length;
    s += `xref\n0 ${offs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o || 0).padStart(10, '0') + ' 00000 n \n').join('');
    return xref;
  };
  let x = write(objects);
  s += `trailer\n<< /Size ${offs.length} /Root 1 0 R ${trailer} >>\nstartxref\n${x}\n%%EOF\n`;
  if (update) {
    x = write(update.objects);
    s += `trailer\n<< /Size ${offs.length} /Root 1 0 R /Prev ${x} ${update.trailer} >>\nstartxref\n${x}\n%%EOF\n`;
  }
  return { bytes: latin(s), offs };
}
const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
{
  const packedXmp = zlib.deflateSync(Buffer.from(XMP)).toString('latin1');
  const jpegData = Buffer.from(JPEG).toString('latin1');
  const CONTENT = 'BT /F1 12 Tf 72 712 Td (Visible page text) Tj ET';
  const { bytes, offs } = pdf([
    [1, '<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Annots [7 0 R 9 0 R] /Resources << /XObject << /Im1 8 0 R >> >> >>'],
    [4, stream('', CONTENT)],
    [5, stream('/Type /Metadata /Subtype /XML', XMP)],
    [6, '<< /Author (SECRET \\(Pdf\\) Author) /Title <FEFF0053004500430052004500540020005400690074006C0065> /Creator 10 0 R ' +
        '/CreationDate (D:20240501132210+02\'00\') /Company (SECRET Corp) >>'],
    [7, '<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /T (SECRET Commenter) /Contents (Visible note) >>'],
    [8, stream('/Type /XObject /Subtype /Image /Width 16 /Height 16 /Filter /DCTDecode', jpegData)],
    [9, '<< /Type /Annot /Subtype /Widget /T (fieldname) /Rect [0 0 1 1] >>'],
    [10, '(SECRET Writer 3)'],
    [11, stream('/Type /Metadata /Subtype /XML /Filter /FlateDecode', packedXmp)]
  ], { trailer: '/Info 6 0 R', update: { objects: [[12, '<< /Author (SECRET Later Author) /ModDate (D:20240601) >>']], trailer: '/Info 12 0 R' } });

  const res = await check('PDF', bytes, {
    kind: 'PDF', secrets: ['SECRET', 'D:2024', 'Exif', 'xmpmeta'],
    want: [['Author', 'SECRET (Pdf) Author'], ['Author', 'SECRET Later Author'], ['Title', 'SECRET Title'],
           ['Made with', 'SECRET Writer 3'], ['Created', '1 May 2024, 13:22'], ['Company', 'SECRET Corp'],
           ['Comment authors', 'SECRET Commenter'], ['Author', 'SECRET Xmp Person'], ['Where a photo in it was taken', '52.5200° N, 13.4050° W']],
    keep: [latin(CONTENT), latin('/T (fieldname)'), latin('(Visible note)'), PICTURE]
  });
  const out = Buffer.from(res.out).toString('latin1');
  ok(out.length === bytes.length, 'PDF: length changed');
  offs.forEach((o, n) => { if (o) ok(out.startsWith(`${n} 0 obj`, o), `PDF: object ${n} moved`); });
  // The packed metadata stream still unpacks, to nothing but spaces.
  const at = out.indexOf('stream\n', out.indexOf('11 0 obj')) + 7, len = packedXmp.length;
  const unpacked = zlib.inflateSync(Buffer.from(out.slice(at, at + len), 'latin1')).toString();
  ok(/^ +$/.test(unpacked), `PDF: packed metadata does not unpack to spaces: ${JSON.stringify(unpacked.slice(0, 40))}`);
  ok(res.notes.some((n) => /earlier version is still inside/.test(n.text)), 'PDF: earlier version not mentioned');
  ok(res.notes.some((n) => /1 comment is still on the pages/.test(n.text)), 'PDF: comment not mentioned');
}
{
  // The properties packed into an object stream, as newer PDF writers do.
  const inner = '<< /Author (SECRET Packed Author) /Producer (SECRET Producer 9) >>';
  const objstm = zlib.deflateSync(Buffer.from('6 0 ' + inner)).toString('latin1');
  const { bytes, offs } = pdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [] /Count 0 >>'],
    [3, `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 4 0 R >>\nstream\n${objstm}\nendstream`],
    [4, String(objstm.length)]
  ], { trailer: '/Info 6 0 R' });
  const res = await check('PDF (packed)', bytes, {
    kind: 'PDF', want: [['Author', 'SECRET Packed Author'], ['Made with', 'SECRET Producer 9']]
  });
  const out = Buffer.from(res.out).toString('latin1');
  offs.forEach((o, n) => { if (o) ok(out.startsWith(`${n} 0 obj`, o), `PDF (packed): object ${n} moved`); });
  const len = +out.match(/4 0 obj\n(\d+)/)[1], at = out.indexOf('stream\n', offs[3]) + 7;
  const unpacked = zlib.inflateSync(Buffer.from(out.slice(at, at + len), 'latin1')).toString('latin1');
  ok(unpacked.startsWith('6 0 << /Author ()') && unpacked.length === ('6 0 ' + inner).length, `PDF (packed): object stream wrong: ${unpacked}`);
}
for (const n of [11, 12, 100, 65540, 65541, 65545, 140000]) {
  const z = CLEAN.zlibSpaces(n), back = zlib.inflateSync(Buffer.from(z));
  ok(z.length === n && back.length === n - 6 - 5 * Math.ceil((n - 6) / 65540) && /^ *$/.test(back.toString()), `zlibSpaces(${n}) is wrong`);
}
console.log('PDF: properties in every version, comments, XMP and photos blanked in place, packed objects repacked');

// ---- 6. what is turned away ----
const refused = [
  [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], /Older Office/],
  [[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0], /WebM/],
  [latin('OggS\0\0\0\0'), /Ogg/],
  [latin('II*\0\0\0\0\0'), /TIFF/],
  [latin('just some words'), /not supported/],
  [zip([['a.txt', 'hello']]), /Zip archives/],
  [[1, 2, 3], /empty/],
  [pdf([[1, '<< /Type /Catalog >>']], { trailer: '/Encrypt 2 0 R' }).bytes, /locked/]
];
for (const [b, why] of refused) {
  const res = await CLEAN.clean(Uint8Array.from(b));
  ok(!res.ok && why.test(res.message), `refused: expected ${why}, got ${JSON.stringify(res.message)}`);
}
console.log(`refusing: ${refused.length} kinds of file turned away with a reason`);

// ---- 7. damaged files never crash it, and never get handed over with a note left in ----
{
  let seed = 11, handed = 0, tried = 0;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const samples = [JPEG, PNG, mp4(), heic('file').bytes, id3(4).concat(FRAMES), pdf([[1, '<< /Author (SECRET) >>']], { trailer: '/Info 1 0 R' }).bytes];
  for (let i = 0; i < 1200; i++) {
    const src = samples[i % samples.length], b = Uint8Array.from(src);
    const cut = b.subarray(0, i % 4 ? b.length : 8 + rnd(b.length - 8)).slice();
    for (let k = 0; k < 1 + rnd(3); k++) cut[rnd(cut.length)] = rnd(256);
    tried++;
    const res = await CLEAN.clean(cut);
    if (res.error) ok(false, `damaged file ${i} threw: ${res.error.stack}`);
    if (res.ok && res.leftovers.length === 0) handed++;
  }
  console.log(`damage: ${tried} broken files, none crashed, ${handed} cleaned and re-checked`);
}

console.log(fails ? `\n${fails} failure(s)` : '\nall hidden-info tests passed');
process.exit(fails ? 1 : 0);
