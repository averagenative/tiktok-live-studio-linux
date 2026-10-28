'use strict';

// Voice-reactive robot. The app streams the mic level (0..1) over
// Server-Sent Events from /events; ?demo=1 fakes speech for previews.

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
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
if (!demo) {
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
  // Bursts of "words" with pauses, roughly like speech.
  const phrase = Math.sin(t * 0.45) > -0.2 ? 1 : 0;
  const syllable = Math.max(0, Math.sin(t * 9.3) * 0.6 + Math.sin(t * 5.1) * 0.4);
  return phrase * syllable * (0.55 + 0.45 * Math.sin(t * 1.7) ** 2);
}

// ---- animation -----------------------------------------------------------------
let level = 0;
let nextBlink = performance.now() + 2500;
let blinkStart = -1;
const BLINK_MS = 150;
const noise = (t, i) => 0.5 + 0.5 * Math.sin(t * (7 + i * 1.3) + i * 2.1) * Math.sin(t * (3.1 + i * 0.7));

function frame(now) {
  const t = now / 1000;
  let want = demo ? demoLevel(t) : target;
  if (!demo && now - lastData > 1500) want = 0;
  // Fast attack, slower release.
  level += (want - level) * (want > level ? 0.45 : 0.12);
  const L = level;

  // Head bob and tilt.
  const bob = Math.sin(t * 1.6) * 6 + L * 8 * Math.sin(t * 11);
  const tilt = Math.sin(t * 0.9) * 1.4 + L * 1.5 * Math.sin(t * 6.3);
  $('head').setAttribute('transform', `translate(0 ${bob.toFixed(2)}) rotate(${tilt.toFixed(2)} 480 470)`);
  $('torso').setAttribute('transform', `translate(0 ${(bob * 0.35).toFixed(2)})`);
  const sway = Math.sin(t * 1.1) * 1.5 + L * 5 * Math.sin(t * 4.7);
  $('armL').setAttribute('transform', `rotate(${(sway + 2).toFixed(2)} 150 880)`);
  $('armR').setAttribute('transform', `rotate(${(-sway - 2).toFixed(2)} 810 880)`);

  // Eyes: random blinks, a happy squint when loud.
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
  const squint = 1 - L * 0.35;
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
  $('tipHalo').setAttribute('opacity', (0.35 + pulse * 0.2 + L * 0.45).toFixed(2));
  $('tip').setAttribute('r', (18 + L * 6).toFixed(1));
  $('coreHalo').setAttribute('opacity', (0.35 + pulse * 0.15 + L * 0.5).toFixed(2));
  $('core').setAttribute('r', (32 + L * 10 + pulse * 2).toFixed(1));
  for (const c of ['cheekL', 'cheekR']) $(c).setAttribute('opacity', (0.25 + L * 0.6).toFixed(2));
  document.querySelectorAll('.earLed').forEach((e) => e.setAttribute('opacity', (0.45 + pulse * 0.3 + L * 0.25).toFixed(2)));

  // Scan line sweeping down the visor.
  const scanY = 300 + ((t * 90) % 260);
  $('scan').setAttribute('transform', `translate(0 ${(scanY - 300).toFixed(1)})`);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
