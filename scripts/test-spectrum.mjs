/* Verifies the arithmetic that ships inside tools/spectrum.html. The module is
   lifted straight out of the page, so this checks the code users actually run,
   not a copy of it. Node built-ins only.

   The page reads AnalyserNode.getFloatFrequencyData, which is a Blackman
   window, an FFT scaled by 1/N, and dB. That is rebuilt here, so known tones
   go in and the peak that comes out can be checked against the frequency that
   went in. A peak a few hertz off looks exactly like a right one. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'spectrum.html'), 'utf8');

const start = page.indexOf('var FA = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the analyser module in tools/spectrum.html');
  process.exit(1);
}
const FA = new Function(page.slice(start, end + 6) + '\nreturn FA;')();

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL ' + msg); } };
const eq = (got, want, msg) => ok(got === want, `${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ---- what the browser's analyser does ----

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function analyse(samples) {
  const n = samples.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    re[i] = samples[i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x));
  }
  fft(re, im);
  const db = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n);
  return db;
}

// A small deterministic noise source, so a failure can be reproduced.
// mulberry32: a plain LCG has a pattern of its own that shows up as a peak.
let seed = 12345;
const rand = () => {
  let t = (seed = (seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};
const noise = () => (rand() + rand() + rand() - 1.5);

function signal(n, rate, tones, noiseLevel = 0) {
  const s = new Float64Array(n);
  for (const [hz, amp, phase = rand() * 2 * Math.PI] of tones)
    for (let i = 0; i < n; i++) s[i] += amp * Math.sin(2 * Math.PI * hz * i / rate + phase);
  if (noiseLevel) for (let i = 0; i < n; i++) s[i] += noiseLevel * noise();
  return s;
}

const read = (db, rate, n) => {
  const top = Math.min(FA.HI, rate / 2);
  const pk = FA.peak(db, rate, n, FA.LO, top);
  return { pk, heard: FA.heard(pk, FA.median(db, rate, n, FA.LO, top)) };
};

// ---- 1. a pure tone is found to well within a hertz ----
// Quick is not trusted below 60 Hz: its steps are 12 Hz wide there, and the
// tooltip says low notes are rough. The others are checked down to 25 Hz.
const SIZES = { Quick: 4096, Balanced: 16384, Detailed: 32768 };
const TONES = [25, 31.25, 50, 60, 100, 123.47, 261.63, 440, 997, 1000, 3150.7, 8000, 12345.6, 17000, 19500];
for (const rate of [44100, 48000]) {
  for (const [name, n] of Object.entries(SIZES)) {
    let worst = 0, worstAt = 0;
    for (const hz of TONES) {
      if (name === 'Quick' && hz < 60) continue;
      const db = analyse(signal(n, rate, [[hz, 0.3]]));
      const { pk, heard } = read(db, rate, n);
      ok(pk && heard, `${name} at ${rate} Hz did not hear ${hz} Hz`);
      if (!pk) continue;
      const err = Math.abs(pk.hz - hz);
      if (err > worst) { worst = err; worstAt = hz; }
      // within a twentieth of an FFT step, and never more than half a hertz
      ok(err < Math.min(0.5, 0.05 * rate / n), `${name} at ${rate} Hz read ${hz} Hz as ${pk.hz.toFixed(3)} Hz`);
    }
    console.log(`peak: ${name.padEnd(8)} ${rate} Hz, worst error ${worst.toFixed(3)} Hz (at ${worstAt} Hz), step ${(rate / n).toFixed(2)} Hz`);
  }
}

// ---- 2. the level is the tone's, not the bin's ----
{ // A tone between two bins reads lower in either bin; the parabola puts it back.
  const rate = 48000, n = 16384, bin = rate / n;
  const on = read(analyse(signal(n, rate, [[100 * bin, 0.5, 0]])), rate, n).pk.db;
  const off = read(analyse(signal(n, rate, [[100.5 * bin, 0.5, 0]])), rate, n).pk.db;
  ok(Math.abs(on - off) < 0.3, `a tone between bins read ${(on - off).toFixed(2)} dB quieter`);
  // full scale is 20 log10(0.5 * 0.42) below 0 for amplitude 1; at 0.5 it is 6 dB lower
  const want = 20 * Math.log10(0.5 * 0.42 * 0.5);
  ok(Math.abs(on - want) < 0.1, `level of a 0.5 tone: got ${on.toFixed(2)} want ${want.toFixed(2)}`);
}

// ---- 3. it names the loudest, and only when there is one ----
{
  const rate = 48000, n = 16384;
  // two tones: the louder wins, whichever side it is on
  let r = read(analyse(signal(n, rate, [[220, 0.1], [3000, 0.3]])), rate, n);
  ok(Math.abs(r.pk.hz - 3000) < 0.5, `louder of 220 and 3000 Hz: got ${r.pk.hz}`);
  r = read(analyse(signal(n, rate, [[220, 0.3], [3000, 0.1]])), rate, n);
  ok(Math.abs(r.pk.hz - 220) < 0.5, `louder of 220 and 3000 Hz: got ${r.pk.hz}`);

  // a hum in a room: a tone well above the hiss is found, within half a hertz
  r = read(analyse(signal(n, rate, [[50, 0.02]], 0.01)), rate, n);
  ok(r.heard && Math.abs(r.pk.hz - 50) < 0.5, `50 Hz hum in noise: heard ${r.heard}, at ${r.pk && r.pk.hz}`);

  // hiss alone, loud or quiet, names no pitch
  r = read(analyse(signal(n, rate, [], 0.05)), rate, n);
  ok(!r.heard, `loud hiss alone was named as ${r.pk && r.pk.hz} Hz`);
  r = read(analyse(signal(n, rate, [], 0.00001)), rate, n);
  ok(!r.heard, 'faint hiss alone was named');
  // a clear tone too faint to trust is not named either
  r = read(analyse(signal(n, rate, [[1000, 0.00002]])), rate, n);
  ok(!r.heard, `a tone at ${r.pk && r.pk.db.toFixed(0)} dB was named`);

  // silence is -Infinity in every bin
  const silent = new Float32Array(n / 2).fill(-Infinity);
  eq(FA.peak(silent, rate, n, 20, 20000), null, 'silence has no peak');
  eq(FA.heard(null, -Infinity), false, 'silence is not heard');
  // nothing below 20 Hz or above the top is picked, even if it is loudest
  r = read(analyse(signal(n, rate, [[10, 0.5], [1000, 0.05]])), rate, n);
  ok(Math.abs(r.pk.hz - 1000) < 0.5, `a 10 Hz rumble was picked over 1000 Hz: ${r.pk.hz}`);
  r = read(analyse(signal(n, rate, [[22000, 0.5], [1000, 0.05]])), rate, n);
  ok(Math.abs(r.pk.hz - 1000) < 0.5, `22 kHz was picked over 1000 Hz: ${r.pk.hz}`);
}
console.log('peak: louder tone wins, hiss and silence name nothing, out-of-range ignored');

// ---- 4. notes and cents ----
const name = (hz) => { const n = FA.note(hz); return `${n.name}${n.octave} ${n.cents}`; };
eq(name(440), 'A4 0', '440 Hz');
eq(name(261.6256), 'C4 0', 'middle C');
eq(name(27.5), 'A0 0', 'lowest piano key');
eq(name(4186.01), 'C8 0', 'highest piano key');
eq(name(466.1638), 'A♯4 0', 'A sharp 4');
eq(name(445), 'A4 20', '445 Hz is 20 cents sharp');
eq(name(435), 'A4 -20', '435 Hz is 20 cents flat');
eq(name(50), 'G1 35', 'European mains hum');
eq(name(60), 'B1 -49', 'American mains hum');
eq(name(440 * 2 ** (0.49 / 12)), 'A4 49', 'just under a quarter tone sharp');
eq(name(440 * 2 ** (0.51 / 12)), 'A♯4 -49', 'just over a quarter tone sharp');
eq(name(130.8128), 'C3 0', 'C3');
eq(name(123.4708), 'B2 0', 'B2 is in the octave below C3');
eq(FA.note(432, 432).cents, 0, 'another reference pitch');
eq(FA.tune(0), 'in tune', 'tune 0');
eq(FA.tune(1), '1 cent sharp', 'tune 1');
eq(FA.tune(-23), '23 cents flat', 'tune -23');
console.log('notes: names, octaves and cents checked against the piano');

// ---- 5. the axis and the pixel columns ----
for (const w of [300, 1234, 2560]) {
  ok(FA.x(20, w) === 0 && Math.abs(FA.x(20000, w) - w) < 1e-9, `axis ends at width ${w}`);
  ok(Math.abs(FA.x(632.456, w) - w / 2) < 0.01, `the middle of 20 Hz to 20 kHz is about 632 Hz at width ${w}`);
  for (const hz of [31, 440, 15000]) ok(Math.abs(FA.hzAt(FA.x(hz, w), w) - hz) < 1e-6, `round trip ${hz} Hz`);
}
for (const [rate, n] of [[48000, 4096], [44100, 32768]]) {
  for (const w of [320, 2400]) {
    for (const hz of [40, 440, 9000]) {
      const db = analyse(signal(n, rate, [[hz, 0.3]]));
      const c = FA.columns(db, rate / n, w);
      eq(c.length, w, 'one value per column');
      ok(c.every(Number.isFinite), 'columns are all finite');
      let at = 0;
      for (let i = 1; i < w; i++) if (c[i] > c[at]) at = i;
      // The curve tops out under the dot the readout puts there. Quick at 40 Hz
      // is a few hertz off, as section 1 allows, so the dot is what it must match.
      const dot = FA.x(read(db, rate, n).pk.hz, w);
      ok(Math.abs(at + 0.5 - dot) <= 2, `${hz} Hz drawn at column ${at}, the dot is at ${dot.toFixed(1)} (w ${w}, n ${n})`);
      if (n > 4096) ok(Math.abs(at + 0.5 - FA.x(hz, w)) <= 2, `${hz} Hz drawn at column ${at}, expected ${FA.x(hz, w).toFixed(1)} (w ${w}, n ${n})`);
      // the drawn top is the tone's level, not a dip between bins
      ok(c[at] > read(db, rate, n).pk.db - 1.5, `${hz} Hz drawn ${(read(db, rate, n).pk.db - c[at]).toFixed(1)} dB too low (w ${w}, n ${n})`);
    }
  }
}
{
  const silent = new Float32Array(2048).fill(-Infinity);
  ok(FA.columns(silent, 48000 / 4096, 500).every((v) => v === -200), 'silence draws at the floor');
  const held = Float32Array.from([1, 5, 3]);
  FA.hold(held, Float32Array.from([2, 4, 3]));
  eq(Array.from(held).join(), '2,5,3', 'hold keeps the loudest');
}
console.log('axis: log scale, columns land on the tone and keep its level');

// ---- 6. how numbers are written ----
eq(FA.formatHz(49.96), '50.0 Hz', 'low frequencies get a decimal');
eq(FA.formatHz(440.4), '440 Hz', 'mid frequencies round');
eq(FA.formatHz(12345.6), '12,346 Hz', 'thousands get a comma');

console.log(fails ? `\n${fails} of ${checks} checks failed` : `\nall ${checks} spectrum checks passed`);
process.exit(fails ? 1 : 0);
