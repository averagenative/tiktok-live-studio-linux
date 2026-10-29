'use strict';

// Voice-reactive avatar. The app streams the mic level (0..1) over
// Server-Sent Events from /events. On top of the talking mouth, a small
// gesture engine blends timed moves (tilts, turns, nods, shrugs, brushing
// a shoulder) with a cheer that raises both arms while the voice is loud.
//
// Avatars (avatars/*.js) share one skeleton: a head that pivots at
// (480, 470), and arms with shoulders at (150, 880) and (810, 880) and
// elbows 205 below. The engine moves those parts; each avatar draws its own
// eyes, mouth, and glow from the same pose.
//
// URL options: ?avatar=robot|cat|fox|panda picks the avatar, and
// ?c1=rrggbb&c2=rrggbb replace its accent colors (#25f4ee and #fe2c55 in
// the artwork). Test switches: ?demo=1 fakes speech, ?level=0.7 holds a
// level, ?gesture=shrug&at=0.5 freezes a gesture, ?cheer=1 holds the cheer.

const NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const fixedLevel = params.has('level') ? Number(params.get('level')) : null;
const frozenGesture = params.get('gesture');
const frozenAt = Number(params.get('at') ?? 0.5);
const forceCheer = params.has('cheer');
if (params.has('preview')) document.body.classList.add('preview');

const AVATAR = window.AVATARS[params.get('avatar')] || window.AVATARS.robot;
document.title = `${AVATAR.name} avatar`;

// ---- the artwork ---------------------------------------------------------------
const svg = document.createElementNS(NS, 'svg');
svg.id = 'stage';
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
svg.innerHTML = AVATAR.svg;
document.body.prepend(svg);
const $ = (id) => document.getElementById(id);
const setT = (id, v) => {
  const el = $(id);
  if (el) el.setAttribute('transform', v);
};

// Theme colors.
{
  const swap = {};
  for (const [from, key] of [['#25f4ee', 'c1'], ['#fe2c55', 'c2']]) {
    if (/^[0-9a-f]{6}$/i.test(params.get(key) || '')) swap[from] = `#${params.get(key)}`;
  }
  for (const el of svg.querySelectorAll('[fill], [stroke], [stop-color]')) {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const to = swap[(el.getAttribute(attr) || '').toLowerCase()];
      if (to) el.setAttribute(attr, to);
    }
  }
}

// Portrait frames show the body; wide ones frame just the head.
function layout() {
  const wide = innerWidth / innerHeight > 1.2;
  svg.setAttribute('viewBox', wide ? AVATAR.wide : '0 0 960 1280');
  if ($('torso')) $('torso').style.display = wide ? 'none' : '';
}
addEventListener('resize', layout);
layout();
AVATAR.init?.({ $, NS });

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

  // Blinks, a happy squint when loud, wide eyes during the cheer.
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

  // Head: bob, tilt, nod, and a turn that slides the face sideways.
  const bob = Math.sin(t * 1.6) * 6 + L * 8 * Math.sin(t * 11);
  // Arms: idle sway, gestures, and the cheer (raised high with a wave). In
  // the cheer the elbows bend inward, so the hands end up beside the head.
  const sway = Math.sin(t * 1.1) * 1.5 + L * 5 * Math.sin(t * 4.7);
  const wave = Math.sin(t * 9) * 10 * C;
  const pose = {
    t,
    L,
    C,
    open,
    squint: (1 - L * 0.35) * (1 - C) + C * 1.1,
    pulse: 0.5 + 0.5 * Math.sin(t * 2.2),
    headY: bob + g.nod - C * 6,
    tilt: Math.sin(t * 0.9) * 1.4 + L * 1.5 * Math.sin(t * 6.3) + g.tilt,
    turn: Math.max(-1, Math.min(1, g.turn)),
    nod: g.nod,
    torsoY: bob * 0.35,
    shL: 2 + sway + g.shL + C * 160 + wave,
    shR: -2 - sway + g.shR - C * 160 - wave,
    elL: g.elL + C * 25 + Math.sin(t * 9 + 1) * 8 * C,
    elR: g.elR - C * 25 - Math.sin(t * 9 + 1) * 8 * C,
    lift: g.lift + C * 10,
  };

  setT('head', `translate(0 ${pose.headY.toFixed(2)}) rotate(${pose.tilt.toFixed(2)} 480 470)`);
  setT('face', `translate(${(pose.turn * (AVATAR.faceShift ?? 34)).toFixed(1)} ${(pose.nod * 0.4).toFixed(1)})`);
  setT('torso', `translate(0 ${pose.torsoY.toFixed(2)})`);
  setT('armL', `translate(0 ${(-pose.lift).toFixed(1)}) rotate(${pose.shL.toFixed(2)} 150 880)`);
  setT('armR', `translate(0 ${(-pose.lift).toFixed(1)}) rotate(${pose.shR.toFixed(2)} 810 880)`);
  setT('foreL', `rotate(${pose.elL.toFixed(2)} 150 1085)`);
  setT('foreR', `rotate(${pose.elR.toFixed(2)} 810 1085)`);
  AVATAR.apply(pose, { $, setT });

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
