/* Verifies the arithmetic that ships inside tools/surround.html. The module is
   lifted straight out of the page, so this checks the code users actually
   run, not a copy of it. Node built-ins only.

   A sound sent to the wrong channel, or panned to the wrong side, sounds
   perfectly plausible until you notice the speaker is wired backwards, which
   is exactly what the tool is for. So every check here is against a known
   answer: the standard channel order and where each speaker sits. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(root, 'tools', 'surround.html'), 'utf8');

const start = page.indexOf('var SUR = (function () {');
const end = page.indexOf('\n})();', start);
if (start < 0 || end < 0) {
  console.error('could not find the SUR module in tools/surround.html');
  process.exit(1);
}
const SUR = new Function(page.slice(start, end + 6) + '\nreturn SUR;')();

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- 1. channel order ----
{
  // Web Audio's 5.1 order, and the WAVE / Windows order Chrome uses for 7.1.
  const want = {
    headphones: 'L R', stereo: 'L R',
    '5.1': 'L R C LFE SL SR',
    '7.1': 'L R C LFE BL BR SL SR'
  };
  for (const id of SUR.ORDER) {
    ok(SUR.order(id) === want[id], `${id} channel order is ${SUR.order(id)}, not ${want[id]}`);
    const L = SUR.LAYOUTS[id];
    const chs = L.speakers.map(s => s.ch).sort((a, b) => a - b);
    ok(chs.join() === [...Array(L.channels).keys()].join(), `${id} does not use every channel exactly once`);
    ok(L.speakers.length === L.channels, `${id} has ${L.speakers.length} speakers for ${L.channels} channels`);
  }
  // Left is left: every speaker named left sits to the left, and so on.
  for (const id of SUR.ORDER) {
    for (const s of SUR.LAYOUTS[id].speakers) {
      if (s.angle === null) { ok(s.id === 'Sub', `${id} ${s.id} has no place`); continue; }
      if (/left/i.test(s.name)) ok(s.angle < 0, `${id} ${s.name} is on the right`);
      if (/right/i.test(s.name)) ok(s.angle > 0, `${id} ${s.name} is on the left`);
      if (/back|surround/i.test(s.name)) ok(Math.abs(s.angle) > 90, `${id} ${s.name} is not behind`);
      if (/front|centre/i.test(s.name)) ok(Math.abs(s.angle) < 90, `${id} ${s.name} is not in front`);
    }
  }
  console.log('channels: order, coverage and sides checked for every layout');
}

// ---- 2. each in turn goes round the room ----
{
  for (const id of ['5.1', '7.1']) {
    const ring = SUR.LAYOUTS[id].speakers.filter(s => s.angle !== null);
    let last = -Infinity;
    for (const s of ring) {
      const a = SUR.wrap(s.angle + 30); // start at front left
      ok(a > last, `${id}: ${s.name} is out of turn going clockwise`);
      last = a;
    }
    const L = SUR.LAYOUTS[id].speakers;
    ok(L[L.length - 1].id === 'Sub', `${id}: the subwoofer is not last`);
  }
  ok(SUR.walkAt('5.1', 0) === 0 && SUR.walkAt('5.1', 1.99) === 0 && SUR.walkAt('5.1', 2) === 1,
    'each speaker does not get two seconds');
  ok(SUR.walkAt('5.1', 12) === 0 && SUR.walkAt('7.1', 15.9) === 7 && SUR.walkAt('7.1', 16) === 0,
    'each in turn does not start over after the last speaker');
  ok(SUR.walkAt('stereo', -1) === 0, 'a moment before the start is not the first speaker');
  console.log('each in turn: clockwise from front left, subwoofer last, two seconds each');
}

// ---- 3. panning ----
{
  const power = g => g.reduce((s, x) => s + x * x, 0);
  for (const id of SUR.ORDER) {
    const L = SUR.LAYOUTS[id];
    const sub = L.speakers.find(s => s.angle === null);
    let worst = 0;
    for (let a = -360; a <= 720; a += 0.5) {
      const g = SUR.gains(id, a);
      ok(g.length === L.channels, `${id} gives ${g.length} gains`);
      worst = Math.max(worst, Math.abs(power(g) - 1));
      ok(g.every(x => x >= -1e-12), `${id} at ${a}° has a negative gain`);
      ok(g.filter(x => x > 1e-9).length <= 2, `${id} at ${a}° uses more than two speakers`);
      if (sub) ok(g[sub.ch] === 0, `${id} sends the circling sound to the subwoofer at ${a}°`);
    }
    ok(worst < 1e-9, `${id} is not equally loud all the way round (off by ${worst})`);
  }
  // Exactly at a speaker, only that speaker plays.
  for (const id of ['5.1', '7.1']) {
    for (const s of SUR.LAYOUTS[id].speakers) {
      if (s.angle === null) continue;
      const g = SUR.gains(id, s.angle);
      ok(near(g[s.ch], 1, 1e-9), `${id} at ${s.name} (${s.angle}°) plays it at ${g[s.ch].toFixed(3)}, not 1`);
    }
    // Halfway between two neighbours, both play equally and nothing else.
    const ring = SUR.ring(id);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const mid = SUR.wrap(a.angle) + SUR.wrap(b.angle - a.angle) / 2;
      const g = SUR.gains(id, mid);
      ok(near(g[a.ch], Math.SQRT1_2, 1e-9) && near(g[b.ch], Math.SQRT1_2, 1e-9),
        `${id} halfway from ${a.id} to ${b.id} is ${g[a.ch].toFixed(3)} / ${g[b.ch].toFixed(3)}`);
    }
  }
  // Two speakers: centre is balanced, right is right, behind folds onto the front.
  const c = SUR.gains('stereo', 0), r = SUR.gains('stereo', 90), l = SUR.gains('stereo', -90);
  ok(near(c[0], c[1], 1e-9), 'two speakers: straight ahead is not balanced');
  ok(near(r[1], 1, 1e-9) && near(r[0], 0, 1e-9), 'two speakers: hard right is not the right channel alone');
  ok(near(l[0], 1, 1e-9) && near(l[1], 0, 1e-9), 'two speakers: hard left is not the left channel alone');
  ok(near(SUR.gains('stereo', 150)[1], SUR.gains('stereo', 30)[1], 1e-9), 'two speakers: behind right is not folded onto front right');
  console.log('panning: equal power all the way round, one speaker at its own place, never the subwoofer');
}

// ---- 4. going round ----
{
  ok(SUR.orbAngle(0, 8, 'cw') === 0 && SUR.orbAngle(2, 8, 'cw') === 90 && SUR.orbAngle(8, 8, 'cw') === 0,
    'clockwise does not pass the right side a quarter of the way round');
  ok(SUR.orbAngle(2, 8, 'ccw') === 270, 'anticlockwise does not pass the left side a quarter of the way round');
  const p = SUR.position(0), r = SUR.position(90), b = SUR.position(180);
  ok(near(p.x, 0, 1e-9) && near(p.z, -1, 1e-9), 'straight ahead is not in front of the listener (-z)');
  ok(near(r.x, 1, 1e-9) && near(r.z, 0, 1e-9), 'right is not +x');
  ok(near(b.z, 1, 1e-9), 'behind is not +z');
  const t = SUR.turn('7.1', 8, 'cw', 360);
  ok(t.length === 8 && t.every(c => c.length === 361), 'a turn is not 361 points per channel');
  ok(near(t[2][0], 1, 1e-6) && near(t[2][360], 1, 1e-6), 'a turn does not start and end on the centre speaker');
  ok(near(t[7][90], 1, 1e-6), 'a quarter turn clockwise is not the side right speaker');
  const back = SUR.turn('7.1', 8, 'ccw', 360);
  ok(near(back[6][90], 1, 1e-6), 'a quarter turn anticlockwise is not the side left speaker');
  console.log('going round: direction, quarter turns and the 3D position checked');
}

// ---- 5. the sounds ----
{
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rate = 48000, secs = 2;
  for (const kind of ['noise', 'bell', 'sub']) {
    const x = SUR.pulses(kind, rate, secs, rand);
    ok(x.length === rate * secs, `${kind}: ${x.length} samples`);
    ok(x.every(Number.isFinite), `${kind}: not every sample is a number`);
    const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    ok(peak < 1, `${kind}: peaks at ${peak.toFixed(2)}, which clips`);
    ok(peak > 0.2, `${kind}: peaks at only ${peak.toFixed(2)}`);
    // Silent at the start and the end, so the loop has no seam and every
    // beat starts cleanly.
    ok(Math.abs(x[0]) < 1e-3 && Math.abs(x[x.length - 1]) < 1e-3, `${kind}: the loop does not start and end silent`);
    const beat = rate * SUR.BEAT;
    for (let k = 0; k < secs / SUR.BEAT; k++) {
      ok(Math.abs(x[k * beat]) < 1e-3, `${kind}: beat ${k} does not start from silence`);
    }
    // Nothing jumps: the biggest step between samples stays small.
    let jump = 0;
    for (let i = 1; i < x.length; i++) jump = Math.max(jump, Math.abs(x[i] - x[i - 1]));
    jump = Math.max(jump, Math.abs(x[0] - x[x.length - 1]));
    if (kind !== 'noise') ok(jump < 0.5, `${kind}: jumps by ${jump.toFixed(2)} between samples`);
  }
  // The hiss is at its stated level while it sounds.
  const n = SUR.pulses('noise', rate, secs, rand);
  let sum = 0, count = 0;
  for (let i = 0; i < n.length; i++) {
    const t = (i % (rate * SUR.BEAT)) / rate;
    if (t >= 0.01 && t < 0.29) { sum += n[i] * n[i]; count++; }
  }
  const rms = Math.sqrt(sum / count);
  ok(near(rms, SUR.NOISE_RMS, 0.005), `hiss is at ${rms.toFixed(3)} while it sounds, not ${SUR.NOISE_RMS}`);
  // The subwoofer tone is the pitch it says.
  const s = SUR.pulses('sub', rate, secs, rand);
  let cross = 0;
  for (let i = Math.round(0.05 * rate); i < Math.round(0.25 * rate); i++) if (s[i - 1] < 0 && s[i] >= 0) cross++;
  ok(near(cross / 0.2, SUR.SUB_HZ, 5), `the subwoofer tone is about ${cross / 0.2} Hz, not ${SUR.SUB_HZ}`);
  console.log('sounds: silent seams, no clipping, hiss level and subwoofer pitch checked');
}

// ---- 6. the rest ----
{
  ok(SUR.suggest(2) === 'headphones' && SUR.suggest(6) === '5.1' && SUR.suggest(8) === '7.1' && SUR.suggest(16) === '7.1',
    'the starting layout does not follow the number of outputs');
  ok(SUR.level(0) === 0 && SUR.level(100) === 1 && SUR.level(50) === 0.25, 'volume is not squared');
}

if (fails) { console.log(`${fails} check(s) failed`); process.exit(1); }
console.log('all surround checks passed');
