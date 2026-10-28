'use strict';

// Voice-reactive robot. The app streams the mic level (0..1) over
// Server-Sent Events from /events. On top of the talking mouth, a small
// gesture engine blends timed moves (tilts, turns, nods, shrugs, brushing
// a shoulder) with a cheer that raises both arms while the voice is loud.
//
// Test switches: ?demo=1 fakes speech, ?level=0.7 holds a level,
// ?gesture=shrug&at=0.5 freezes a gesture, ?cheer=1 holds the cheer.

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const fixedLevel = params.has('level') ? Number(params.get('level')) : null;
const frozenGesture = params.get('gesture');
const frozenAt = Number(params.get('at') ?? 0.5);
const forceCheer = params.has('cheer');
if (params.has('preview')) document.body.classList.add('preview');

// ---- layout: portrait shows the torso, wide frames just the head ----------
function layout() {
  const wide = innerWidth / innerHeight > 1.2;
  $('stage').setAttribute('viewBox', wide ? '-71 95 1102 620' : '0 0 960 1280');
  $('torso').style.display = wide ? 'none' : '';
}
addEventListener('resize', layout);
layout();

// ---- mouth: LED equalizer bars ---------------------------------------------
const BARS = 9;
const BAR_W = 22;
const GAP = 12;
const MOUTH_Y = 500;
const bars = [];
{
  const total = BARS * BAR_W + (BARS - 1) * GAP;
  const x0 = 480 - total / 2;
  for (let i = 0; i < BARS; i += 1) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x0 + i * (BAR_W + GAP));
    r.setAttribute('width', BAR_W);
    r.setAttribute('rx', 8);
    r.setAttribute('fill', 'url(#bar)');
    $('mouth').append(r);
    bars.push({ el: r, h: 8 });
  }
}

// ---- level input -------------------------------------------------------------
let target = 0;
let lastData = 0;
if (!demo && fixedLevel === null) {
  const connect = () => {
    const es = new EventSource('/events');
    es.onmessage = (e) => {
      try {
        target = Math.max(0, Math.min(1, JSON.parse(e.data).l || 0));
        lastData = performance.now();
      } catch {
        // ignore malformed frames
      }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, 2000);
    };
  };
  connect();
}

function demoLevel(t) {
  // Bursts of "words" with pauses, and a shout every few phrases.
  const phrase = Math.sin(t * 0.45) > -0.2 ? 1 : 0;
  const syllable = Math.max(0, Math.sin(t * 9.3) * 0.6 + Math.sin(t * 5.1) * 0.4);
  const shout = Math.sin(t * 0.21) > 0.93 ? 1.6 : 1;
  return Math.min(1, phrase * syllable * (0.55 + 0.45 * Math.sin(t * 1.7) ** 2) * shout);
}

// ---- gestures ----------------------------------------------------------------
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// Ease in, hold, ease out.
const hold = (p, a = 0.25, b = 0.25) => (p < a ? smooth(p / a) : p > 1 - b ? smooth((1 - p) / b) : 1);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Each returns pose offsets for progress p in 0..1. Angles in degrees; for
// the shoulders, + swings the left arm outward and - swings the right arm
// outward. turn is -1 (looking left) to 1 (looking right).
const GESTURES = {
  tilt: { dur: 1800, pose: (p, s) => ({ tilt: 9 * s * hold(p) }) },
  turn: { dur: 2400, pose: (p, s) => ({ turn: 0.9 * s * hold(p, 0.3, 0.3), tilt: 2 * s * hold(p) }) },
  nod: { dur: 900, pose: (p) => ({ nod: Math.sin(p * Math.PI * 2) * 9 * (1 - p) }) },
  shrug: {
    dur: 1500,
    pose: (p) => {
      const h = hold(p, 0.3, 0.35);
      // Elbows down, forearms up and out, palms up.
      return { lift: 32 * h, shL: 10 * h, shR: -10 * h, elL: 140 * h, elR: -140 * h, nod: 8 * h, tilt: 4 * h };
    },
  },
  // One hand comes up to the same-side shoulder and brushes it off, with
  // the head turned to look at it, then flicks away.
  brush: {
    dur: 2800,
    pose: (p, s) => {
      const h = hold(p, 0.2, 0.18);
      const strokes = p > 0.24 && p < 0.78 ? Math.sin(((p - 0.24) / 0.54) * Math.PI * 6) * 14 : 0;
      const flick = p > 0.78 && p < 0.92 ? Math.sin(((p - 0.78) / 0.14) * Math.PI) * 30 : 0;
      // Upper arm down and out, forearm folded back so the hand lands on top
      // of the shoulder joint.
      const sh = (30 + flick) * h;
      const el = (-185 + strokes + flick * 1.5) * h;
      return s > 0
        ? { shL: sh, elL: el, turn: -0.8 * h, tilt: -7 * h }
        : { shR: -sh, elR: -el, turn: 0.8 * h, tilt: 7 * h };
    },
  },
};

const active = [];
let nextIdle = performance.now() + rand(2500, 5000);
let talkingSince = 0;
let wasTalking = false;

function startGesture(name, sign, now) {
  if (active.some((g) => g.name === name)) return;
  active.push({ name, sign, start: now });
}

function schedule(now, L, cheer) {
  const talking = L > 0.2;
  if (talking && !wasTalking) talkingSince = now;
  // Right after a stretch of talking, sometimes shrug or tilt.
  if (!talking && wasTalking && now - talkingSince > 2000 && Math.random() < 0.35) {
    startGesture(Math.random() < 0.6 ? 'shrug' : 'tilt', Math.random() < 0.5 ? 1 : -1, now);
    nextIdle = now + rand(3000, 6000);
  }
  wasTalking = talking;
  if (now < nextIdle || cheer > 0.1 || active.some((g) => g.name !== 'nod')) return;
  const r = Math.random();
  const pick = talking
    ? (r < 0.35 ? 'tilt' : r < 0.6 ? 'nod' : r < 0.82 ? 'turn' : 'shrug')
    : (r < 0.3 ? 'turn' : r < 0.55 ? 'tilt' : r < 0.75 ? 'shrug' : 'brush');
  startGesture(pick, Math.random() < 0.5 ? 1 : -1, now);
  nextIdle = now + (talking ? rand(2500, 5000) : rand(5000, 10000));
}

function gesturePose(now) {
  const pose = { tilt: 0, turn: 0, nod: 0, lift: 0, shL: 0, shR: 0, elL: 0, elR: 0 };
  const add = (o) => { for (const k in o) pose[k] += o[k]; };
  if (frozenGesture && GESTURES[frozenGesture]) {
    add(GESTURES[frozenGesture].pose(frozenAt, 1));
    return pose;
  }
  for (let i = active.length - 1; i >= 0; i -= 1) {
    const g = active[i];
    const p = (now - g.start) / GESTURES[g.name].dur;
    if (p >= 1) active.splice(i, 1);
    else add(GESTURES[g.name].pose(p, g.sign));
  }
  return pose;
}

// ---- animation -----------------------------------------------------------------
let level = 0;
let cheer = 0;
let loudFor = 0;
let lastFrame = performance.now();
let nextBlink = performance.now() + 2500;
let blinkStart = -1;
const BLINK_MS = 150;
const noise = (t, i) => 0.5 + 0.5 * Math.sin(t * (7 + i * 1.3) + i * 2.1) * Math.sin(t * (3.1 + i * 0.7));
const setT = (id, v) => $(id).setAttribute('transform', v);

function frame(now) {
  const t = now / 1000;
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  let want = fixedLevel !== null ? fixedLevel : demo ? demoLevel(t) : target;
  if (!demo && fixedLevel === null && now - lastData > 1500) want = 0;
  // Fast attack, slower release.
  level += (want - level) * (want > level ? 0.45 : 0.12);
  const L = level;

  // Cheer: arms go up once the voice stays loud for a moment, and come down
  // once it drops back.
  loudFor = L > 0.82 ? loudFor + dt : Math.max(0, loudFor - dt * 2);
  const cheerTarget = forceCheer || loudFor > 180 ? 1 : L < 0.6 ? 0 : cheer > 0.5 ? 1 : 0;
  cheer += (cheerTarget - cheer) * (cheerTarget > cheer ? 0.14 : 0.06);
  const C = frozenGesture ? 0 : cheer;

  if (!frozenGesture) schedule(now, L, C);
  const g = gesturePose(now);
  if (L > 0.35 && !frozenGesture) g.nod += L * 3 * Math.sin(t * 7.5);

  // Head: bob, tilt, nod, and a turn that slides the face across the visor.
  const bob = Math.sin(t * 1.6) * 6 + L * 8 * Math.sin(t * 11);
  const tilt = Math.sin(t * 0.9) * 1.4 + L * 1.5 * Math.sin(t * 6.3) + g.tilt;
  setT('head', `translate(0 ${(bob + g.nod - C * 6).toFixed(2)}) rotate(${tilt.toFixed(2)} 480 470)`);
  const turn = Math.max(-1, Math.min(1, g.turn));
  setT('face', `translate(${(turn * 34).toFixed(1)} ${(g.nod * 0.4).toFixed(1)})`);
  setT('earL', `translate(${(turn * 14).toFixed(1)} 0)`);
  setT('earR', `translate(${(turn * 14).toFixed(1)} 0)`);
  $('earL').setAttribute('opacity', (1 - Math.max(0, -turn) * 0.5).toFixed(2));
  $('earR').setAttribute('opacity', (1 - Math.max(0, turn) * 0.5).toFixed(2));
  setT('torso', `translate(0 ${(bob * 0.35).toFixed(2)})`);

  // Arms: idle sway, gestures, and the cheer (raised high with a wave).
  const sway = Math.sin(t * 1.1) * 1.5 + L * 5 * Math.sin(t * 4.7);
  const wave = Math.sin(t * 9) * 10 * C;
  // In the cheer the elbows bend inward, so the hands end up beside the head.
  const shL = 2 + sway + g.shL + C * 160 + wave;
  const shR = -2 - sway + g.shR - C * 160 - wave;
  const elL = g.elL + C * 25 + Math.sin(t * 9 + 1) * 8 * C;
  const elR = g.elR - C * 25 - Math.sin(t * 9 + 1) * 8 * C;
  const lift = g.lift + C * 10;
  setT('armL', `translate(0 ${(-lift).toFixed(1)}) rotate(${shL.toFixed(2)} 150 880)`);
  setT('armR', `translate(0 ${(-lift).toFixed(1)}) rotate(${shR.toFixed(2)} 810 880)`);
  setT('foreL', `rotate(${elL.toFixed(2)} 150 1085)`);
  setT('foreR', `rotate(${elR.toFixed(2)} 810 1085)`);

  // Eyes: random blinks, a happy squint when loud, wide during the cheer.
  if (blinkStart < 0 && now > nextBlink) blinkStart = now;
  let open = 1;
  if (blinkStart >= 0) {
    const p = (now - blinkStart) / BLINK_MS;
    open = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
    if (p >= 1) {
      blinkStart = -1;
      open = 1;
      nextBlink = now + 2200 + Math.random() * 3800;
    }
  }
  const squint = (1 - L * 0.35) * (1 - C) + C * 1.1;
  const eyeH = Math.max(6, 80 * open * squint);
  for (const id of ['eyeL', 'eyeR']) {
    const e = $(id);
    e.setAttribute('height', eyeH.toFixed(1));
    e.setAttribute('y', (400 - eyeH / 2).toFixed(1));
    e.setAttribute('opacity', (0.75 + L * 0.25).toFixed(2));
  }

  // Mouth bars: a bell-shaped "spectrum" scaled by the level.
  bars.forEach((b, i) => {
    const center = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
    const idle = 6 + 3 * Math.sin(t * 2 + i);
    const talk = L ** 0.6 * (40 + 85 * center) * (0.6 + 0.4 * noise(t, i));
    const h = Math.max(idle, talk);
    b.h += (h - b.h) * 0.5;
    b.el.setAttribute('height', b.h.toFixed(1));
    b.el.setAttribute('y', (MOUTH_Y - b.h / 2).toFixed(1));
    b.el.setAttribute('opacity', (0.55 + Math.min(1, b.h / 60) * 0.45).toFixed(2));
  });

  // Glows.
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  $('tipHalo').setAttribute('opacity', (0.35 + pulse * 0.2 + L * 0.45 + C * 0.2).toFixed(2));
  $('tip').setAttribute('r', (18 + L * 6 + C * 6).toFixed(1));
  $('coreHalo').setAttribute('opacity', (0.35 + pulse * 0.15 + L * 0.5).toFixed(2));
  $('core').setAttribute('r', (32 + L * 10 + pulse * 2).toFixed(1));
  for (const c of ['cheekL', 'cheekR']) $(c).setAttribute('opacity', (0.25 + L * 0.6).toFixed(2));
  document.querySelectorAll('.earLed').forEach((e) => e.setAttribute('opacity', (0.45 + pulse * 0.3 + L * 0.25).toFixed(2)));

  // Scan line sweeping down the visor.
  const scanY = 300 + ((t * 90) % 260);
  setT('scan', `translate(0 ${(scanY - 300).toFixed(1)})`);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
