/* Verifies the arithmetic that ships inside tools/tone.html. The module is
   lifted straight out of the page, so this checks the code users actually
   run, not a copy of it. Node built-ins only.

   A tone at the wrong pitch or noise with the wrong slope sounds perfectly
   plausible, so every check here is against a known answer or a measured
   spectrum. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'tone.html'), 'utf8');

const start = page.indexOf('var TONE = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the TONE module in tools/tone.html');
  process.exit(1);
}
const TONE = new Function(page.slice(start, end + 6) + '\nreturn TONE;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- 1. the pitch slider ----
{
  ok(TONE.fromSlider(0) === 20, `slider left end is ${TONE.fromSlider(0)} Hz, not 20`);
  ok(TONE.fromSlider(TONE.STEPS) === 20000, `slider right end is ${TONE.fromSlider(TONE.STEPS)} Hz, not 20,000`);
  ok(TONE.fromSlider(500) === 632, `slider middle is ${TONE.fromSlider(500)} Hz, not 632 (the geometric middle)`);
  // Every stretch of slider is the same ratio of pitch: 100 steps is 1000^(1/10), just under an octave.
  const ratio = Math.pow(1000, 0.1);
  for (const x of [0, 300, 600, 900]) {
    const r = TONE.fromSlider(x + 100) / TONE.fromSlider(x);
    ok(near(r, ratio, 0.003), `slider ${x} → ${x + 100} multiplies the pitch by ${r.toFixed(4)}, not ${ratio.toFixed(4)}`);
  }
  let prev = 0, worst = 0;
  for (let x = 0; x <= TONE.STEPS; x++) {
    const f = TONE.fromSlider(x);
    ok(f >= prev, `slider goes down at step ${x}`);
    prev = f;
    worst = Math.max(worst, Math.abs(TONE.toSlider(f) - x));
  }
  ok(worst <= 1, `slider position drifts by ${worst} steps on the way back`);
  ok(TONE.toSlider(1) === 0 && TONE.toSlider(22000) === TONE.STEPS, 'slider does not pin out-of-range pitches to its ends');
  ok(TONE.fromSlider(37) === Math.round(TONE.fromSlider(37) * 10) / 10, 'slider below 100 Hz is not in tenths');
  ok(Number.isInteger(TONE.fromSlider(700)), 'slider above 100 Hz is not in whole hertz');
  console.log('slider: ends, middle, octaves and the way back checked');
}

// ---- 2. fine adjustment ----
{
  let f = 440;
  for (let i = 0; i < 10; i++) f = TONE.nudge(f, 0.1);
  ok(f === 441, `ten nudges of 0.1 Hz from 440 land on ${f}, not 441`);
  for (let i = 0; i < 10; i++) f = TONE.nudge(f, -0.1);
  ok(f === 440, `and ten back land on ${f}`);
  ok(TONE.nudge(440, 1) === 441 && TONE.nudge(440, -1) === 439, 'nudge by 1 Hz is wrong');
  ok(TONE.nudge(1, -1) === TONE.MIN && TONE.nudge(1.05, -0.1) === TONE.MIN, 'nudge goes below the lowest pitch');
  ok(TONE.nudge(TONE.MAX, 1) === TONE.MAX, 'nudge goes above the highest pitch');
  ok(TONE.valid(1) && TONE.valid(22000) && !TONE.valid(0.5) && !TONE.valid(22001) && !TONE.valid(NaN),
    'the range of pitches that can be typed is wrong');
  console.log('nudge: steps add up exactly and stop at the ends');
}

// ---- 3. notes ----
{
  const cases = [
    [440, 'A4', 0], [261.63, 'C4', 0], [27.5, 'A0', 0], [4186.01, 'C8', 0],
    [466.16, 'A♯4', 0], [445, 'A4', 20], [435, 'A4', -20], [1000, 'B5', 21], [20, 'D♯0', 49]
  ];
  for (const [f, name, cents] of cases) {
    const n = TONE.note(f);
    ok(n.name === name && n.cents === cents, `${f} Hz is ${n.name} ${n.cents} cents, not ${name} ${cents}`);
  }
  ok(TONE.hz(440) === '440 Hz' && TONE.hz(20000) === '20,000 Hz' && TONE.hz(440.1) === '440.1 Hz' &&
     TONE.hz(1.006) === '1.01 Hz', `hertz are written oddly: ${TONE.hz(20000)}, ${TONE.hz(440.1)}`);
  console.log(`notes: ${cases.length} pitches named`);
}

// ---- 4. sweeps follow Web Audio's ramps ----
{
  const log = (t) => TONE.sweepAt(20, 20000, 10, 'log', t);
  ok(log(0) === 20 && near(log(10), 20000, 1e-9), 'log sweep does not start and end where it should');
  ok(near(log(5), Math.sqrt(20 * 20000), 1e-9), `log sweep is at ${log(5)} halfway, not the geometric middle`);
  // An equal time for every octave.
  const perOctave = 10 / Math.log2(1000);
  ok(near(log(perOctave), 40, 1e-9) && near(log(2 * perOctave), 80, 1e-9), 'log sweep does not spend equal time per octave');
  const lin = (t) => TONE.sweepAt(20, 20000, 10, 'linear', t);
  ok(lin(5) === 10010 && lin(2.5) === 5015, `linear sweep is at ${lin(5)} halfway, not 10,010`);
  ok(log(-1) === 20 && near(log(11), 20000, 1e-9) && lin(99) === 20000, 'sweep runs past its ends');
  const down = TONE.sweepAt(8000, 100, 4, 'log', 2);
  ok(near(down, Math.sqrt(8000 * 100), 1e-9), 'downward log sweep is wrong');
  ok(TONE.sweepAt(1000, 1000, 3, 'log', 1) === 1000, 'a sweep with equal ends does not hold still');
  console.log('sweep: log and linear match the ramp formulas, both directions');
}

// ---- 5. volume and warnings ----
{
  ok(TONE.level(0) === 0 && TONE.level(100) === 1 && near(TONE.level(20), 0.04, 1e-12), 'volume curve is not squared');
  ok(TONE.DEFAULTS.f === 440 && TONE.DEFAULTS.ch === 'both', 'defaults have moved');
  for (const w of ['sine', 'square', 'triangle', 'sawtooth']) {
    ok(TONE.TRIM[w] > 0 && TONE.TRIM[w] <= 1, `${w} has no level`);
  }
  const base = { ...TONE.DEFAULTS };
  ok(TONE.warn(base, 20) === '', 'a quiet 440 Hz tone is warned about');
  ok(TONE.warn(base, 61) === 'loud', 'a loud tone is not warned about');
  ok(TONE.warn({ ...base, f: 30 }, 20) === 'range', 'a 30 Hz tone is not warned about');
  ok(TONE.warn({ ...base, f: 16000 }, 20) === 'range', 'a 16 kHz tone is not warned about');
  ok(TONE.warn({ ...base, mode: 'sweep' }, 20) === 'range', 'a full-range sweep is not warned about');
  ok(TONE.warn({ ...base, mode: 'sweep', from: 200, to: 2000 }, 20) === '', 'a mid-range sweep is warned about');
  ok(TONE.warn({ ...base, mode: 'noise' }, 20) === '' && TONE.warn({ ...base, mode: 'noise' }, 80) === 'loud',
    'noise warnings are wrong');
  console.log('volume: curve and warnings checked');
}

// ---- 6. the address ----
{
  const D = TONE.DEFAULTS;
  const same = (a, b) => Object.keys(D).every((k) => a[k] === b[k]);
  ok(same(TONE.decode(''), D) && same(TONE.decode('#'), D), 'an empty address does not give the defaults');
  const tone = { ...D, f: 1234.5, wave: 'square', ch: 'left' };
  ok(TONE.encode(tone) === '#tone=1234.5&wave=square&ch=left', `tone address is ${TONE.encode(tone)}`);
  ok(same(TONE.decode(TONE.encode(tone)), tone), 'a tone does not survive its own address');
  const sweep = { ...D, mode: 'sweep', from: 10000, to: 50, secs: 30, scale: 'linear', wave: 'triangle', ch: 'right' };
  ok(TONE.encode(sweep) === '#sweep=10000-50&time=30&scale=linear&wave=triangle&ch=right', `sweep address is ${TONE.encode(sweep)}`);
  ok(same(TONE.decode(TONE.encode(sweep)), sweep), 'a sweep does not survive its own address');
  const noise = { ...D, mode: 'noise', noise: 'white' };
  ok(TONE.encode(noise) === '#noise=white&ch=both', `noise address is ${TONE.encode(noise)}`);
  ok(same(TONE.decode(TONE.encode(noise)), noise), 'noise does not survive its own address');
  ok(!/vol/.test(TONE.encode(tone) + TONE.encode(sweep) + TONE.encode(noise)), 'volume leaked into the address');

  // Anything odd is ignored rather than played.
  const bad = ['#tone=0', '#tone=99999', '#tone=1e5', '#tone=-5', '#tone=abc', '#tone=',
    '#wave=organ', '#ch=middle', '#sweep=20', '#sweep=20-0', '#time=0', '#time=601', '#scale=wobbly',
    '#noise=brown', '#tone=%E0%A4%A', '#vol=100', '#&&=&'];
  for (const h of bad) ok(same(TONE.decode(h), D), `${h} changed the settings`);
  ok(TONE.decode('#tone=50&ch=nope').f === 50 && TONE.decode('#tone=50&ch=nope').ch === 'both', 'one bad value spoils the rest');
  ok(TONE.decode('#ch=right').mode === 'tone' && TONE.decode('#ch=right').ch === 'right', 'channel alone is not kept');
  console.log(`address: three round trips and ${bad.length} bad addresses checked`);
}

// ---- 7. noise ----
// A seeded generator, so a failure can be reproduced.
function mulberry(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Power in each octave band, by Welch's method: Hann-windowed 4096-point FFTs, averaged.
function octaves(x, rate, centres) {
  const N = 4096, win = new Float64Array(N), psd = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N);
  let segs = 0;
  for (let off = 0; off + N <= x.length; off += N / 2, segs++) {
    for (let i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
  }
  return centres.map((fc) => {
    let p = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = k * rate / N;
      if (f >= fc / Math.SQRT2 && f < fc * Math.SQRT2) p += psd[k];
    }
    return 10 * Math.log10(p / segs);
  });
}
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
        re[q] = re[p] - tr; im[q] = im[p] - ti;
        re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

{
  const rate = 48000, n = rate * 8;
  const centres = [125, 250, 500, 1000, 2000, 4000, 8000];
  for (const kind of ['white', 'pink']) {
    const x = TONE.noise(kind, n, mulberry(kind === 'pink' ? 7 : 11));
    ok(x.length === n && x instanceof Float32Array, `${kind} noise is the wrong length or type`);
    let sum = 0, peak = 0, head = 0;
    const m = 4096;
    for (let i = 0; i < n; i++) { sum += x[i] * x[i]; peak = Math.max(peak, Math.abs(x[i])); if (i < m) head += x[i] * x[i]; }
    const rms = Math.sqrt(sum / n);
    ok(near(rms, TONE.NOISE_RMS, 1e-4), `${kind} noise is at ${rms.toFixed(4)} average, not ${TONE.NOISE_RMS}`);
    ok(peak < 1, `${kind} noise peaks at ${peak.toFixed(3)} and would clip`);
    // The cross-faded start of the loop is as loud as the rest, not a dip or a bump.
    const headRms = Math.sqrt(head / m);
    ok(near(headRms / rms, 1, 0.1), `${kind} noise loop seam is ${(headRms / rms).toFixed(2)}× the level of the rest`);

    const bands = octaves(x, rate, centres);
    const steps = bands.slice(1).map((b, i) => b - bands[i]);
    // White: equal power per hertz, so each octave (twice as many hertz) is 3 dB up.
    // Pink: equal power per octave, so each step is 0 dB.
    const want = kind === 'white' ? 10 * Math.log10(2) : 0;
    steps.forEach((d, i) => ok(near(d, want, 0.6),
      `${kind} noise: ${centres[i]} → ${centres[i + 1]} Hz changes by ${d.toFixed(2)} dB, not ${want.toFixed(2)}`));
    const span = bands[bands.length - 1] - bands[0];
    ok(near(span, want * steps.length, 1), `${kind} noise tilts by ${span.toFixed(2)} dB over 125 Hz to 8 kHz`);
    console.log(`${kind} noise: level, seam and slope ${(span / steps.length).toFixed(2)} dB per octave`);
  }
  const a = TONE.noise('pink', 1000, mulberry(3)), b = TONE.noise('pink', 1000, mulberry(3));
  ok(a.every((v, i) => v === b[i]), 'noise is not determined by its random source');
}

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log('\nall tone checks passed');
