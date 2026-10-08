/* Verifies the QR encoder and the payload builders that ship inside
   tools/qr.html. Both are lifted straight out of the page, so this checks the
   code that users actually run, not a copy of it. Node built-ins only. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'qr.html'), 'utf8');

const start = page.indexOf('var QR = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the QR encoder in tools/qr.html');
  process.exit(1);
}
// The page exports only encode(); the tests need the internals too.
const source = page.slice(start, end + 6)
  .replace('return { encode: encode };',
    'return { encode, ECC_PER_BLOCK, NUM_BLOCKS, ECL_BITS, totalCodewords, dataCodewords,' +
    ' alignPositions, countBits, payloadBits, MASKS, utf8, segment, segmentBits };');
const QR = new Function(source + '\nreturn QR;')();


let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };

// ---- 1. format information strings (ISO/IEC 18004 Table C.1) ----
const FORMAT = {
 L:['111011111000100','111001011110011','111110110101010','111100010011101','110011000101111','110001100011000','110110001000001','110100101110110'],
 M:['101010000010010','101000100100101','101111001111100','101101101001011','100010111111001','100000011001110','100111110010111','100101010100000'],
 Q:['011010101011111','011000001101000','011111100110001','011101000000110','010010010110100','010000110000011','010111011011010','010101111101101'],
 H:['001011010001001','001001110111110','001110011100111','001100111010000','000011101100010','000001001010101','000110100001100','000100000111011']};
for (const ecl of ['L','M','Q','H']) for (let mask=0; mask<8; mask++) {
  const data = (QR.ECL_BITS[ecl]<<3)|mask; let rem = data;
  for (let i=0;i<10;i++) rem = (rem<<1) ^ ((rem>>>9)*0x537);
  const bits = ((data<<10)|rem) ^ 0x5412;
  const s = bits.toString(2).padStart(15,'0');
  ok(s === FORMAT[ecl][mask], `format ${ecl}/${mask}: got ${s} want ${FORMAT[ecl][mask]}`);
}
console.log('format information: 32 strings checked');

// ---- 2. version information (ISO/IEC 18004 Table D.1) ----
const VER = {7:'000111110010010100',8:'001000010110111100',9:'001001101010011001',40:'101000110001101001'};
for (const [v,want] of Object.entries(VER)) {
  let rem = +v; for (let i=0;i<12;i++) rem = (rem<<1) ^ ((rem>>>11)*0x1F25);
  const s = (((+v)<<12)|rem).toString(2).padStart(18,'0');
  ok(s === want, `version ${v}: got ${s} want ${want}`);
}
{ // BCH(18,6) must have minimum Hamming distance 8 across all 34 codewords
  const words = [];
  for (let v=7; v<=40; v++) { let rem=v; for(let i=0;i<12;i++) rem=(rem<<1)^((rem>>>11)*0x1F25); words.push((v<<12)|rem); }
  let min = 99;
  for (let i=0;i<words.length;i++) for (let j=i+1;j<words.length;j++) {
    let x = words[i]^words[j], d=0; while(x){ d+=x&1; x>>>=1; }
    min = Math.min(min,d);
  }
  ok(min === 8, `version info minimum distance is ${min}, expected 8`);
}
console.log('version information: 4 published strings + minimum-distance check');

// ---- 3. capacity table sanity against published byte capacities ----
const BYTECAP = { 1:{L:17,M:14,Q:11,H:7}, 10:{L:271,M:213,Q:151,H:119}, 40:{L:2953,M:2331,Q:1663,H:1273} };
for (const [v,levels] of Object.entries(BYTECAP)) for (const [ecl,cap] of Object.entries(levels)) {
  const bits = QR.dataCodewords(+v,ecl)*8 - 4 - QR.countBits('byte',+v);
  ok(Math.floor(bits/8) === cap, `byte capacity v${v}-${ecl}: got ${Math.floor(bits/8)} want ${cap}`);
}
console.log('capacity table: 12 published byte capacities checked');

// ---- 4. round-trip decoder: read the finished matrix back out ----
const EXP=new Uint8Array(512), LOG=new Uint8Array(256);
{ let x=1; for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;} for(let i=255;i<512;i++)EXP[i]=EXP[i-255]; }
const gmul=(a,b)=>(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];

function decode(res) {
  const size = res.size, m = res.modules.map(r => Uint8Array.from(r));
  // rebuild the function-module map independently of the encoder
  const f = Array.from({length:size},()=>new Uint8Array(size));
  const mark=(r,c)=>{ if(r>=0&&c>=0&&r<size&&c<size) f[r][c]=1; };
  for(let i=0;i<size;i++){ mark(6,i); mark(i,6); }
  for(const [pr,pc] of [[3,3],[3,size-4],[size-4,3]])
    for(let dr=-4;dr<=4;dr++) for(let dc=-4;dc<=4;dc++) mark(pr+dr,pc+dc);
  const ap = QR.alignPositions(res.version), n=ap.length;
  for(let i=0;i<n;i++) for(let j=0;j<n;j++){
    if((i===0&&j===0)||(i===0&&j===n-1)||(i===n-1&&j===0)) continue;
    for(let y=-2;y<=2;y++) for(let x=-2;x<=2;x++) mark(ap[i]+y, ap[j]+x);
  }
  for(let i=0;i<=8;i++){ mark(8,i); mark(i,8); }
  for(let i=0;i<8;i++){ mark(8,size-1-i); mark(size-1-i,8); }
  mark(size-8,8);
  if(res.version>=7) for(let i=0;i<18;i++){ const a=size-11+i%3,c=Math.floor(i/3); mark(c,a); mark(a,c); }

  // read format info copy #1 and recover ecl + mask
  let fb=0;
  const rd=(r,c)=>m[r][c];
  const seq=[];
  for(let i=0;i<=5;i++) seq.push(rd(i,8));
  seq.push(rd(7,8), rd(8,8), rd(8,7));
  for(let i=9;i<15;i++) seq.push(rd(8,14-i));
  for(let i=14;i>=0;i--) fb=(fb<<1)|seq[i];
  fb ^= 0x5412;
  const fdata = fb>>>10;
  const ecl = Object.keys(QR.ECL_BITS).find(k=>QR.ECL_BITS[k]===(fdata>>3));
  const mask = fdata & 7;
  if (ecl !== res.ecl || mask !== res.mask) return {err:`format readback ${ecl}/${mask}`};
  // check the BCH remainder of what we read is self-consistent
  { let r=fdata; for(let i=0;i<10;i++) r=(r<<1)^((r>>>9)*0x537); if((((fdata<<10)|r)) !== fb) return {err:'format BCH mismatch'}; }

  // unmask
  const fn = QR.MASKS[mask];
  for(let r=0;r<size;r++) for(let c=0;c<size;c++) if(!f[r][c] && fn(r,c)) m[r][c]^=1;

  // read codewords in the reverse zigzag
  const total = QR.totalCodewords(res.version);
  const bits=[];
  for (let right=size-1; right>=1; right-=2) {
    if (right===6) right=5;
    for (let vert=0; vert<size; vert++) for (let j=0;j<2;j++) {
      const c=right-j, upward=((right+1)&2)===0, r=upward?size-1-vert:vert;
      if(!f[r][c] && bits.length < total*8) bits.push(m[r][c]);
    }
  }
  const cw = new Uint8Array(total);
  bits.forEach((b,i)=>{ cw[i>>>3] |= b<<(7-(i&7)); });

  // de-interleave
  const nb=QR.NUM_BLOCKS[ecl][res.version-1], el=QR.ECC_PER_BLOCK[ecl][res.version-1];
  const sbl=Math.floor(total/nb), sdl=sbl-el, ns=nb-total%nb;
  const blocks=Array.from({length:nb},(_,j)=>new Array(sdl+(j<ns?0:1)+el));
  let p=0;
  for(let i=0;i<sdl+1+el;i++) for(let j=0;j<nb;j++){
    if(i===sdl && j<ns) continue;
    const idx = (j<ns && i>sdl) ? i-1 : i;
    blocks[j][idx]=cw[p++];
  }
  // syndromes must all be zero for an uncorrupted block
  for(const b of blocks) for(let s=0;s<el;s++){
    let acc=0, xp=1;
    for(let i=b.length-1;i>=0;i--){ acc^=gmul(b[i],xp); xp=gmul(xp,EXP[s]); }
    if(acc!==0) return {err:`nonzero syndrome S${s}`};
  }
  // reassemble data stream and parse
  const data=[];
  for(let j=0;j<nb;j++) for(let i=0;i<blocks[j].length-el;i++) data.push(blocks[j][i]);
  let bp=0;
  const take=k=>{ let v=0; for(let i=0;i<k;i++,bp++) v=(v<<1)|((data[bp>>>3]>>(7-(bp&7)))&1); return v; };
  // A code may hold several segments, each with its own mode; a mode of 0
  // (the terminator) or running out of room ends the data.
  let text='';
  const modes=[];
  const AL="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  while (bp + 4 <= data.length*8) {
    const mode=take(4);
    if (mode===0) break;
    const modeName={1:'numeric',2:'alnum',4:'byte'}[mode];
    if(!modeName) return {err:'bad mode '+mode};
    modes.push(modeName);
    const len=take(QR.countBits(modeName,res.version));
    if(modeName==='byte'){ const by=[]; for(let i=0;i<len;i++) by.push(take(8)); text+=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(by)); }
    else if(modeName==='numeric'){ let i=0; while(i+3<=len){ text+=String(take(10)).padStart(3,'0'); i+=3; }
      if(len-i===2) text+=String(take(7)).padStart(2,'0'); else if(len-i===1) text+=String(take(4)); }
    else { let i=0; while(i+2<=len){ const v=take(11); text+=AL[Math.floor(v/45)]+AL[v%45]; i+=2; }
      if(len-i===1) text+=AL[take(6)]; }
  }
  return {text, modes};
}

const cases = [
  'HELLO WORLD', 'https://tools.jof.dev', '1', '0123456789', 'a',
  'Grüße aus Wien — äöüß ✓', '日本語のテキスト', 'x'.repeat(300),
  '9'.repeat(1000), 'HTTPS://EXAMPLE.COM/PATH', 'The quick brown fox jumps over 13 lazy dogs.',
  'z'.repeat(2900), '7'.repeat(50), 'MIXED case text 123 with symbols !@#$%^&*()',
  'A'.repeat(4296), 'HTTPS://TOOLS.JOF.DEV/qr/', 'HTTPS://EXAMPLE.COM/menu?table=12345678901234',
  'abc123456789012345678901234567890def', 'Grüße 2026 AUS WIEN 0043660123456', '1'.repeat(4000) + 'x'
];
let n = 0;
for (const t of cases) for (const ecl of ['L','M','Q','H']) {
  let res; try { res = QR.encode(t, {ecl}); } catch (e) {
    if (/too long/.test(e.message)) continue; throw e;
  }
  const d = decode(res);
  ok(!d.err, `${ecl} v${res.version} "${t.slice(0,18)}" -> ${d.err}`);
  ok(d.text === t, `${ecl} v${res.version} roundtrip mismatch for "${t.slice(0,18)}" (got "${String(d.text).slice(0,18)}")`);
  n++;
}
console.log(`round-trip: ${n} encode/decode pairs across versions and levels`);

// every version, forced, byte mode
let vn = 0;
for (let v = 1; v <= 40; v++) for (const ecl of ['L','M','Q','H']) {
  const cap = Math.floor((QR.dataCodewords(v,ecl)*8 - 4 - QR.countBits('byte',v))/8);
  const t = Array.from({length:cap},(_,i)=>String.fromCharCode(97+(i*7+v)%26)).join('');
  const res = QR.encode(t,{ecl,minVersion:v,maxVersion:v});
  ok(res.version===v, `forced version ${v}-${ecl} became ${res.version}`);
  const d = decode(res);
  ok(!d.err && d.text===t, `full-capacity v${v}-${ecl}: ${d.err||'text mismatch'}`);
  vn++;
}
console.log(`full-capacity: all ${vn} version/level combinations encode and decode`);


// ---- 4b. mixed modes: the split must be the cheapest one there is ----
// The reference tries every way of cutting the text into pieces and every mode
// for each piece, which is exact and needs nothing from the encoder but the bit
// count of a segment. Short strings over a small alphabet still cover every
// kind of boundary: digit runs inside capitals, capitals inside lowercase, and
// characters only byte mode can carry.
{
  const MODES = ['numeric', 'alnum', 'byte'];
  const can = (m, t) => m === 'byte' || (m === 'alnum' ? /^[0-9A-Z $%*+\-.\/:]+$/.test(t) : /^[0-9]+$/.test(t));
  const best = (chars, ver) => {
    const cost = [0];
    for (let j = 1; j <= chars.length; j++) {
      cost[j] = Infinity;
      for (let i = 0; i < j; i++) for (const m of MODES) {
        const t = chars.slice(i, j).join('');
        if (can(m, t)) cost[j] = Math.min(cost[j], cost[i] + QR.segmentBits([{mode: m, text: t}], ver));
      }
    }
    return cost[chars.length];
  };
  const ALPHA = ['1', 'A', 'a', '/', 'é'];
  let tried = 0, rnd = 7;
  const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648);
  for (let k = 0; k < 2000; k++) {
    const len = 1 + next() % 30;
    const chars = Array.from({length: len}, () => ALPHA[next() % ALPHA.length]);
    // long digit and capital runs, where switching starts to pay
    if (k % 3 === 0) chars.splice(next() % len, 0, ...'1234567890123'.split('').slice(0, 1 + next() % 13));
    if (k % 4 === 0) chars.splice(next() % len, 0, ...'ABCDEFGHIJKLM'.split('').slice(0, 1 + next() % 13));
    for (const ver of [1, 10, 27]) {
      const segs = QR.segment(chars.join(''), ver);
      ok(segs.map(g => g.text).join('') === chars.join(''), `split of "${chars.join('')}" lost characters`);
      const got = QR.segmentBits(segs, ver), want = best(chars, ver);
      ok(got === want, `split of "${chars.join('')}" at v${ver} takes ${got} bits, ${want} is possible`);
      tried++;
    }
  }
  // and what that buys for a real link
  const lower = QR.encode('https://tools.jof.dev/qr/', {ecl: 'L'});
  const caps = QR.encode('HTTPS://TOOLS.JOF.DEV/qr/', {ecl: 'L'});
  ok(caps.mode === 'alnum+byte', `a capitalised site name with a lowercase path: ${caps.mode}`);
  ok(caps.bits < lower.bits, 'capitals in the site name take fewer bits');
  const v = (t, ecl) => QR.encode(t, {ecl}).version;
  ok(v('https://tools.jof.dev', 'L') === 2 && v('HTTPS://TOOLS.JOF.DEV', 'L') === 1,
    'a site name in capitals drops a size');
  const long = 'restaurant-zum-goldenen-hirschen.at/speisekarte';
  ok(v('https://' + long, 'M') === 4 && v('HTTPS://' + long.toUpperCase(), 'M') === 3,
    'a whole link in capitals drops a size');
  console.log(`mixed modes: ${tried} splits match the cheapest possible`);
}

// ---- 5. tables checked against an independent copy (guards against edits to the page) ----
{
  const ECC = {
    L: [7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    M: [10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    Q: [13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    H: [17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  };
  const NB = {
    L: [1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    M: [1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    Q: [1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    H: [1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  };
  for (const ecl of ['L','M','Q','H']) {
    ok(JSON.stringify(QR.ECC_PER_BLOCK[ecl]) === JSON.stringify(ECC[ecl]), `ECC_PER_BLOCK.${ecl} changed`);
    ok(JSON.stringify(QR.NUM_BLOCKS[ecl]) === JSON.stringify(NB[ecl]), `NUM_BLOCKS.${ecl} changed`);
    ok(QR.ECC_PER_BLOCK[ecl].length === 40 && QR.NUM_BLOCKS[ecl].length === 40, `${ecl} rows must cover 40 versions`);
  }
  console.log('tables: 8 rows checked against an independent copy');
}

// ---- 6. payload builders: the strings that make a scanner do something ----
// Lifted out of the page the same way the encoder is, so these are the builders
// the tool actually runs. A payload that is subtly wrong looks exactly like one
// that is right: the code scans, and the phone quietly does nothing useful.
const pstart = page.indexOf('var PAYLOAD = (function () {');
const pend = page.indexOf('\n})();', pstart);
if (pstart < 0 || pend < 0) {
  console.error('could not find the payload builders in tools/qr.html');
  process.exit(1);
}
const PAYLOAD = new Function(page.slice(pstart, pend + 6) + '\nreturn PAYLOAD;')();

// Refusals are part of the interface: every one must arrive as a sentence a
// person can act on, never as a raw exception.
const refuses = (fn, what) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  if (msg === null) { fails++; console.log('FAIL ' + what + ' was accepted'); return; }
  ok(/^[A-Z]/.test(msg) && /\.$/.test(msg) && !/undefined|NaN|\[object/.test(msg),
    `${what}: unhelpful message "${msg}"`);
};

{ // Wi-Fi
  const w = PAYLOAD.wifi;
  ok(w({ssid:'Cafe', pass:'letmein', security:'WPA'}) === 'WIFI:T:WPA;S:Cafe;P:letmein;;', 'wifi: plain');
  ok(w({ssid:'Old box', pass:'12345', security:'WEP'}) === 'WIFI:T:WEP;S:Old box;P:12345;;', 'wifi: WEP');
  ok(w({ssid:'Guest', security:'nopass'}) === 'WIFI:T:nopass;S:Guest;;', 'wifi: open network omits P:');
  ok(w({ssid:'Guest', pass:'stale', security:'nopass'}) === 'WIFI:T:nopass;S:Guest;;',
    'wifi: an open network drops a password left in the box');
  ok(w({ssid:'Cafe', pass:'x', security:'WPA', hidden:true}) === 'WIFI:T:WPA;S:Cafe;P:x;H:true;;',
    'wifi: hidden flag before the closing semicolons');
  ok(w({ssid:'a;b,c:d"e\\f', pass:'p;q,r:s"t\\u', security:'WPA'}) ===
    'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;q\\,r\\:s\\"t\\\\u;;', 'wifi: escaping of \\ ; , : and "');
  ok(w({ssid:'Cafe', pass:'  spaces  ', security:'WPA'}) === 'WIFI:T:WPA;S:Cafe;P:  spaces  ;;',
    'wifi: a password is stored exactly as typed');
  refuses(() => w({ssid:'', pass:'x', security:'WPA'}), 'a network with no name');
  refuses(() => w({ssid:'Cafe', pass:'', security:'WPA'}), 'a protected network with no password');
  console.log('wifi: 9 checks');
}

{ // contact card
  const v = PAYLOAD.vcard;
  const card = v({first:'Ada', last:'Lovelace'});
  ok(card === 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\nEND:VCARD',
    'vcard: a name-only card is five lines and nothing else');
  ok(!/[^\r]\n/.test(card), 'vcard: lines end CRLF');
  const full = v({first:'A', last:'B', org:'Acme, Inc.', title:'Head; of things',
    phone:'+43 1 234', mobile:'+43 660 1', email:'a@b.de', url:'https://b.de',
    street:'Main St; 5', zip:'1010', city:'Wien', country:'Austria', note:'first\nsecond'});
  ok(full.includes('ORG:Acme\\, Inc.'), 'vcard: comma escaped');
  ok(full.includes('TITLE:Head\\; of things'), 'vcard: semicolon escaped');
  ok(full.includes('NOTE:first\\nsecond'), 'vcard: newline becomes \\n');
  ok(v({first:'A', note:'back\\slash'}).includes('NOTE:back\\\\slash'), 'vcard: backslash doubled');
  ok(full.includes('ADR;TYPE=WORK:;;Main St\\; 5;Wien;;1010;Austria'),
    'vcard: address components in the order the format defines');
  ok(full.includes('TEL;TYPE=WORK,VOICE:+43 1 234') && full.includes('TEL;TYPE=CELL,VOICE:+43 660 1'),
    'vcard: the two phone numbers are typed differently');
  ok(!/TITLE|ORG|TEL|EMAIL|URL|NOTE|ADR/.test(card), 'vcard: empty fields are left out entirely');
  ok(!v({first:'A', last:'B', city:''}).includes('ADR'), 'vcard: no address, no ADR line');
  ok(v({org:'Acme'}).includes('FN:Acme'), 'vcard: a company with no person still gets a full name');
  refuses(() => v({}), 'a contact card with nothing in it');
  console.log('contact card: 11 checks');
}

{ // email
  const m = PAYLOAD.email;
  ok(m({to:'a@b.de'}) === 'mailto:a@b.de', 'mailto: address only');
  ok(m({to:'a@b.de', subject:'Hello & welcome!'}) === 'mailto:a@b.de?subject=Hello%20%26%20welcome%21',
    'mailto: subject percent-encoded, exclamation mark included');
  ok(m({to:'a@b.de', subject:'S', body:'one\ntwo three'}) === 'mailto:a@b.de?subject=S&body=one%0D%0Atwo%20three',
    'mailto: a line break in the body becomes %0D%0A');
  ok(m({to:'a@b.de', body:'a+b=c/d?e#f'}) === 'mailto:a@b.de?body=a%2Bb%3Dc%2Fd%3Fe%23f',
    'mailto: reserved characters in the body');
  ok(m({to:'a@b.de', body:'Grüße'}) === 'mailto:a@b.de?body=Gr%C3%BC%C3%9Fe', 'mailto: UTF-8 body');
  ok(m({to:'a@b.de', body:'   '}) === 'mailto:a@b.de', 'mailto: a blank body is left out');
  refuses(() => m({to:''}), 'an email with no address');
  refuses(() => m({to:'not an address'}), 'an email address with a space in it');
  refuses(() => m({to:'a@b'}), 'an email address with no dot after the @');
  console.log('email: 9 checks');
}

{ // text message and phone call
  ok(PAYLOAD.sms({number:'+43 (660) 123-4567', message:'On my way'}) === 'SMSTO:+436601234567:On my way',
    'sms: brackets, spaces and dashes are dropped from the number');
  ok(PAYLOAD.sms({number:'0043660123', message:''}) === 'SMSTO:0043660123:', 'sms: an empty message');
  ok(PAYLOAD.sms({number:'0043660123', message:'a:b:c'}) === 'SMSTO:0043660123:a:b:c',
    'sms: colons in the message are left alone');
  ok(PAYLOAD.tel({number:'+43 1 234 5678'}) === 'tel:+4312345678', 'tel: normalised number');
  refuses(() => PAYLOAD.tel({number:'call me'}), 'a phone number with letters in it');
  refuses(() => PAYLOAD.tel({number:'12'}), 'a phone number too short to be one');
  refuses(() => PAYLOAD.sms({number:''}), 'a text message with no number');
  console.log('text message and call: 7 checks');
}

{ // IBAN: the country-length table and the mod-97 check
  const VALID = ['GB82WEST12345698765432','DE89370400440532013000','FR1420041010050500013M02606',
    'AT611904300234573201','NL91ABNA0417164300','CH9300762011623852957','MT84MALT011000012345MTLCAST001S',
    'NO9386011117947','BE68539007547034','ES9121000418450200051332','IT60X0542811101000000123456',
    'PL61109010140000071219812874','SE4550000000058398257466','GR1601101250000000012300695',
    'PT50000201231234567890154','IE29AIBK93115212345678','FI2112345600000785','DK5000400440116243',
    'LU280019400644750000','CZ6508000000192000145399','HU42117730161111101800000000',
    'RO49AAAA1B31007593840000','HR1210010051863000160','SI56263300012039086','SK3112000000198742637541',
    'BG80BNBG96611020345678','LT121000011101001000','LV80BANK0000435195001','EE382200221020145685',
    'CY17002001280000001200527600','MC5811222000010123456789030','SM86U0322509800000000270100',
    'AD1200012030200359100100','LI21088100002324013AA','IS140159260076545510730339',
    'TR330006100519786457841326','XK051212012345678906'];
  let bad = 0;
  for (const iban of VALID) {
    ok(PAYLOAD.ibanOk(iban), `iban: ${iban} should be accepted`);
    // Changing one character in the body always changes the remainder, so every
    // one of these mutations must be caught.
    const at = 8, c = iban[at];
    const alt = /[0-9]/.test(c)
      ? String((Number(c) + 1) % 10)
      : String.fromCharCode(((c.charCodeAt(0) - 65 + 1) % 26) + 65);
    ok(!PAYLOAD.ibanOk(iban.slice(0, at) + alt + iban.slice(at + 1)),
      `iban: a typo in ${iban} should be caught`);
    bad++;
  }
  ok(PAYLOAD.ibanOk('at61 1904 3002 3457 3201'), 'iban: lower case and spaces are accepted');
  ok(PAYLOAD.ibanOk('AT61-1904-3002-3457-3201'), 'iban: dashes are accepted');
  ok(PAYLOAD.ibanOk('ZZ44AAAA1234567890'),
    'iban: a country not in the length table passes on its check digits alone');
  ok(!PAYLOAD.ibanOk('DE8937040044053201300'), 'iban: one character short for Germany');
  ok(!PAYLOAD.ibanOk('DE893704004405320130000'), 'iban: one character long for Germany');
  ok(!PAYLOAD.ibanOk('AT6119043002345732011'), 'iban: one character long for Austria');
  ok(!PAYLOAD.ibanOk('DE89370400440532013O00'), 'iban: a letter O where a zero belongs');
  ok(!PAYLOAD.ibanOk('DE89 3704 0044 0532 0130 0!'), 'iban: a punctuation mark');
  ok(!PAYLOAD.ibanOk('DE89370400440532010300'), 'iban: two transposed digits');
  ok(!PAYLOAD.ibanOk('D893704004405320130001'), 'iban: a one-letter country code');
  ok(!PAYLOAD.ibanOk('1289370400440532013000'), 'iban: digits where the country belongs');
  ok(!PAYLOAD.ibanOk('DEX9370400440532013000'), 'iban: a letter among the check digits');
  ok(!PAYLOAD.ibanOk('NO938601111794'), 'iban: shorter than any IBAN in the registry');
  ok(!PAYLOAD.ibanOk(''), 'iban: nothing at all');
  ok(!PAYLOAD.ibanOk(null), 'iban: no value at all');
  console.log(`iban: ${VALID.length} real IBANs accepted, ${bad} typos and 14 malformed ones refused`);
}

{ // bank transfer — EPC069-12
  const p = PAYLOAD.sepa;
  const IBAN = 'AT61 1904 3002 3457 3201', FLAT = 'AT611904300234573201';
  const basic = p({name:'Franz Huber', iban:IBAN, amount:'12.50', text:'Invoice 42'});
  const L = basic.split('\n');
  ok(L.length === 12, `epc: twelve lines, got ${L.length}`);
  ok(basic.indexOf('\r') < 0, 'epc: separated by line feeds only');
  ok(L[0] === 'BCD' && L[1] === '002' && L[2] === '1' && L[3] === 'SCT',
    'epc: service tag, version 002, UTF-8, SEPA credit transfer');
  ok(L[4] === '', 'epc: the BIC may be left out in version 002');
  ok(L[5] === 'Franz Huber', 'epc: who is being paid, line 6');
  ok(L[6] === FLAT, 'epc: the IBAN is stored without its spaces, line 7');
  ok(L[7] === 'EUR12.50', 'epc: the amount carries its currency, line 8');
  ok(L[8] === '' && L[9] === '' && L[10] === 'Invoice 42' && L[11] === '',
    'epc: purpose, reference, message, note to the payer');
  ok(p({name:'A', iban:FLAT, amount:'7'}).split('\n')[7] === 'EUR7.00', 'epc: a round number gets two decimals');
  ok(p({name:'A', iban:FLAT, amount:'1234,5'}).split('\n')[7] === 'EUR1234.50', 'epc: a comma reads as the decimal point');
  ok(p({name:'A', iban:FLAT, amount:'0.01'}).split('\n')[7] === 'EUR0.01', 'epc: the smallest allowed amount');
  ok(p({name:'A', iban:FLAT, amount:'999999999.99'}).split('\n')[7] === 'EUR999999999.99', 'epc: the largest allowed amount');
  ok(p({name:'A', iban:FLAT}).split('\n')[7] === '', 'epc: no amount, so the payer types one');
  ok(p({name:'A', iban:FLAT, bic:'gibaatwwxxx'}).split('\n')[4] === 'GIBAATWWXXX', 'epc: the BIC is upper-cased');
  const ref = p({name:'A', iban:FLAT, reference:'RF18539007547034'}).split('\n');
  ok(ref[9] === 'RF18539007547034' && ref[10] === '', 'epc: a reference goes on line 10 and leaves line 11 empty');
  refuses(() => p({name:'A', iban:FLAT, reference:'RF18', text:'hello'}),
    'a payment carrying both a reference and a message');
  refuses(() => p({name:'', iban:FLAT}), 'a payment to nobody');
  refuses(() => p({name:'A', iban:''}), 'a payment with no account number');
  refuses(() => p({name:'A', iban:'AT611904300234573202'}), 'a payment to an IBAN with a typo');
  refuses(() => p({name:'A', iban:FLAT, amount:'0'}), 'a payment of nothing');
  refuses(() => p({name:'A', iban:FLAT, amount:'1000000000'}), 'a payment over the maximum');
  refuses(() => p({name:'A', iban:FLAT, amount:'12.345'}), 'an amount with three decimals');
  refuses(() => p({name:'A', iban:FLAT, amount:'1,234.50'}), 'an amount with a thousands separator');
  refuses(() => p({name:'A', iban:FLAT, bic:'NOPE'}), 'a malformed BIC');
  refuses(() => p({name:'A', iban:FLAT, purpose:'GOODS'}), 'a purpose code over four characters');
  refuses(() => p({name:'x'.repeat(71), iban:FLAT}), 'a beneficiary name over 70 characters');
  refuses(() => p({name:'A', iban:FLAT, text:'x'.repeat(141)}), 'a message over 140 characters');
  refuses(() => p({name:'A', iban:FLAT, reference:'x'.repeat(36)}), 'a reference over 35 characters');
  refuses(() => p({name:'A', iban:FLAT, note:'x'.repeat(71)}), 'a note to the payer over 70 characters');

  // 331 bytes is the hard limit, and it counts bytes: an umlaut costs two.
  ok(PAYLOAD.bytes('ä') === 2 && PAYLOAD.bytes('abc') === 3 && PAYLOAD.bytes('😀') === 4,
    'epc: the length limit counts UTF-8 bytes');
  const brim = {name:'ä'.repeat(70), iban:FLAT, bic:'GIBAATWWXXX', amount:'999999999.99',
    purpose:'GDDS', text:'x'.repeat(140), note:'y'.repeat(70)};
  refuses(() => p(brim), 'a giro code longer than 331 bytes');
  const fits = Object.assign({}, brim, {name:'ä'.repeat(10), text:'x'.repeat(100), note:'y'.repeat(20)});
  const inside = p(fits);
  ok(PAYLOAD.bytes(inside) <= 331 && inside.split('\n').length === 12,
    `epc: a full code inside the limit is allowed (${PAYLOAD.bytes(inside)} bytes)`);
  console.log('bank transfer: 33 checks');
}

{ // calendar event
  const e = PAYLOAD.event;
  const allday = e({summary:'Spring fair', location:'Rathausplatz', allday:true,
    start:'2026-04-01', end:'2026-04-03'});
  ok(allday.includes('DTSTART;VALUE=DATE:20260401'), 'event: an all-day start is a bare date');
  ok(allday.includes('DTEND;VALUE=DATE:20260404'), 'event: an all-day end is the day after the last day');
  ok(!/DTSTART:[0-9]{8}T/.test(allday), 'event: an all-day event carries no time');
  ok(allday.includes('LOCATION:Rathausplatz'), 'event: the place');
  ok(e({summary:'x', allday:true, start:'2026-12-31'}).includes('DTEND;VALUE=DATE:20270101'),
    'event: a single all-day event ends the next morning, across new year');
  ok(e({summary:'x', allday:true, start:'2026-02-28'}).includes('DTEND;VALUE=DATE:20260301'),
    'event: the day after the 28th of February 2026');
  const timed = e({summary:'Team call', start:'2026-04-01', startTime:'09:30',
    end:'2026-04-01', endTime:'11:00'});
  ok(timed.includes('DTSTART:20260401T093000'), 'event: a timed start');
  ok(timed.includes('DTEND:20260401T110000'), 'event: a timed end');
  ok(!/[0-9]Z/.test(timed) && !/TZID/.test(timed), 'event: a timed event stores local time with no zone');
  ok(e({summary:'x', start:'2026-04-01', startTime:'23:30'}).includes('DTEND:20260402T003000'),
    'event: with no end given it lasts an hour, over midnight');
  ok(e({summary:'x', start:'2026-04-01', startTime:'09:00', end:'2026-04-02'}).includes('DTEND:20260402T090000'),
    'event: an end date with no end time keeps the starting time');
  const lines = timed.split('\r\n');
  ok(lines[0] === 'BEGIN:VEVENT' && lines[lines.length - 1] === 'END:VEVENT', 'event: wrapped in BEGIN and END');
  ok(!/[^\r]\n/.test(timed), 'event: lines end CRLF');
  ok(e({summary:'A, B; C', start:'2026-04-01', startTime:'10:00', description:'one\ntwo'})
    .includes('SUMMARY:A\\, B\\; C'), 'event: escaping in the summary');
  ok(e({summary:'x', start:'2026-04-01', startTime:'10:00', description:'one\ntwo'})
    .includes('DESCRIPTION:one\\ntwo'), 'event: a line break in the details');
  ok(!e({summary:'x', start:'2026-04-01', startTime:'10:00'}).includes('DESCRIPTION'),
    'event: empty fields are left out');
  refuses(() => e({summary:'', start:'2026-04-01', startTime:'10:00'}), 'an event with no name');
  refuses(() => e({summary:'x', start:''}), 'an event with no date');
  refuses(() => e({summary:'x', start:'2026-04-01'}), 'a timed event with no time');
  refuses(() => e({summary:'x', start:'2026-04-02', startTime:'10:00', end:'2026-04-01', endTime:'09:00'}),
    'an event that ends before it starts');
  refuses(() => e({summary:'x', allday:true, start:'2026-04-05', end:'2026-04-01'}),
    'an all-day event whose last day is before its first');
  console.log('calendar event: 21 checks');
}

{ // location
  const g = PAYLOAD.geo;
  ok(g({lat:'48.2082', lon:'16.3738'}) === 'geo:48.2082,16.3738', 'geo: a place');
  ok(g({lat:'-33,8688', lon:'151.2093'}) === 'geo:-33.8688,151.2093', 'geo: a comma decimal point and a minus');
  ok(g({lat:'0', lon:'0'}) === 'geo:0,0', 'geo: null island');
  ok(g({lat:'90', lon:'-180'}) === 'geo:90,-180', 'geo: the edges of both ranges');
  ok(g({lat:' 48.2082 ', lon:'+16.3738'}) === 'geo:48.2082,16.3738', 'geo: spaces and a leading plus');
  refuses(() => g({lat:'90.1', lon:'0'}), 'a latitude past the pole');
  refuses(() => g({lat:'-90.5', lon:'0'}), 'a latitude past the other pole');
  refuses(() => g({lat:'0', lon:'180.5'}), 'a longitude past the date line');
  refuses(() => g({lat:'north', lon:'0'}), 'a latitude that is not a number');
  refuses(() => g({lat:'', lon:'16'}), 'a missing latitude');
  refuses(() => g({lat:'48', lon:''}), 'a missing longitude');
  console.log('location: 11 checks');
}

{ // link and plain text
  const l = PAYLOAD.link;
  ok(l({url:'example.com', https:true}) === 'https://example.com', 'link: https:// is put in front');
  ok(l({url:'HTTP://Example.com/A'}) === 'HTTP://Example.com/A', 'link: an address with a scheme is left alone');
  ok(l({url:'mailto:a@b.de'}) === 'mailto:a@b.de', 'link: another kind of scheme is left alone');
  ok(l({url:'https://tools.jof.dev/qr/?a=1#b'}) === 'https://tools.jof.dev/qr/?a=1#b',
    'link: query and fragment survive');
  ok(l({url:'  example.com/menu  '}) === 'https://example.com/menu', 'link: surrounding spaces are trimmed');
  refuses(() => l({url:''}), 'an empty web address');
  refuses(() => l({url:'two words.com'}), 'a web address with a space in it');
  refuses(() => l({url:'notadomain'}), 'a word that is not a web address');
  refuses(() => l({url:'https://'}), 'a scheme with no site after it');
  refuses(() => l({url:'example.com', https:false}), 'a bare address when https is not wanted');
  ok(l({url:'tools.jof.dev/qr/?a=b', https:true, caps:'host'}) === 'HTTPS://TOOLS.JOF.DEV/qr/?a=b',
    'link: capitals for the site name leave the rest alone');
  ok(l({url:'http://Ada@Example.com:8080/Menu', caps:'host'}) === 'HTTP://Ada@EXAMPLE.COM:8080/Menu',
    'link: a user name before the @ keeps its case');
  ok(l({url:'tools.jof.dev/qr/?a=b#c', https:true, caps:'all'}) === 'HTTPS://TOOLS.JOF.DEV/QR/?A=B#C',
    'link: everything in capitals');
  ok(l({url:'straße.de/größe', https:true, caps:'all'}) === 'HTTPS://STRAßE.DE/GRößE',
    'link: letters outside a-z are left as they are');
  ok(l({url:'mailto:a@b.de', caps:'host'}) === 'mailto:a@b.de', 'link: other schemes are not touched');
  ok(l({url:'example.com', https:true, caps:'none'}) === 'https://example.com', 'link: no capitals when asked');
  ok(PAYLOAD.text({text:'  spaces kept  '}) === '  spaces kept  ', 'text: stored exactly as typed');
  refuses(() => PAYLOAD.text({text:'   '}), 'nothing but spaces');
  refuses(() => PAYLOAD.build('something else', {}), 'a kind of code that does not exist');
  console.log('link and text: 19 checks');
}

{ // and every one of them has to survive the encoder unchanged
  const samples = [
    ['link', {url:'tools.jof.dev/qr/', https:true}],
    ['link', {url:'tools.jof.dev/qr/?x=1', https:true, caps:'host'}],
    ['text', {text:'Grüße aus Wien — äöüß ✓'}],
    ['wifi', {ssid:'Kaffee & Kuchen; 1', pass:'a\\b:c,d"e', security:'WPA', hidden:true}],
    ['vcard', {first:'Ada', last:'Lovelace', org:'Analytical, Ltd.', title:'Programmer',
      phone:'+43 1 234', mobile:'+43 660 1', email:'ada@example.org', url:'https://example.org',
      street:'Hauptstraße 1', zip:'1010', city:'Wien', country:'Österreich', note:'met at the fair'}],
    ['email', {to:'ada@example.org', subject:'Grüße', body:'one\ntwo'}],
    ['sms', {number:'+43 660 123 4567', message:'On my way — 5 min'}],
    ['tel', {number:'+43 660 123 4567'}],
    ['sepa', {name:'Franz Hüber', iban:'AT61 1904 3002 3457 3201', bic:'GIBAATWWXXX',
      amount:'1234,50', purpose:'GDDS', text:'Rechnung 2026-04'}],
    ['event', {summary:'Frühlingsfest', location:'Rathausplatz, Wien', start:'2026-04-01',
      startTime:'18:30', end:'2026-04-01', endTime:'23:00', description:'Bring a coat'}],
    ['geo', {lat:'48.2082', lon:'16.3738'}]
  ];
  for (const [kind, v] of samples) for (const level of ['L', 'M', 'Q', 'H']) {
    const built = PAYLOAD.build(kind, v);
    const d = decode(QR.encode(built, {ecl: level}));
    ok(!d.err && d.text === built, `${kind} payload at level ${level}: ${d.err || 'came back changed'}`);
  }
  console.log(`payloads through the encoder: ${samples.length * 4} round trips`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nqr: all checks passed');
process.exit(fails ? 1 : 0);
