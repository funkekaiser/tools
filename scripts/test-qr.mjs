/* Verifies the QR encoder that ships inside tools/qr.html.
   The encoder source is lifted straight out of the page, so this checks the
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
    ' alignPositions, countBits, payloadBits, MASKS, utf8, pickMode };');
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
  const mode=take(4);
  const modeName={1:'numeric',2:'alnum',4:'byte'}[mode];
  if(!modeName) return {err:'bad mode '+mode};
  const len=take(QR.countBits(modeName,res.version));
  let text='';
  const AL="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  if(modeName==='byte'){ const by=[]; for(let i=0;i<len;i++) by.push(take(8)); text=new TextDecoder().decode(Uint8Array.from(by)); }
  else if(modeName==='numeric'){ let i=0; while(i+3<=len){ text+=String(take(10)).padStart(3,'0'); i+=3; }
    if(len-i===2) text+=String(take(7)).padStart(2,'0'); else if(len-i===1) text+=String(take(4)); }
  else { let i=0; while(i+2<=len){ const v=take(11); text+=AL[Math.floor(v/45)]+AL[v%45]; i+=2; }
    if(len-i===1) text+=AL[take(6)]; }
  return {text, mode:modeName, len};
}

const cases = [
  'HELLO WORLD', 'https://tools.jof.dev', '1', '0123456789', 'a',
  'Grüße aus Wien — äöüß ✓', '日本語のテキスト', 'x'.repeat(300),
  '9'.repeat(1000), 'HTTPS://EXAMPLE.COM/PATH', 'The quick brown fox jumps over 13 lazy dogs.',
  'z'.repeat(2900), '7'.repeat(50), 'MIXED case text 123 with symbols !@#$%^&*()',
  'A'.repeat(4296)
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

console.log(fails ? `\n${fails} FAILURES` : '\nqr encoder: all checks passed');
process.exit(fails ? 1 : 0);
