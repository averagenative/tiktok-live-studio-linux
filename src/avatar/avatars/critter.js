'use strict';

// A builder for the animal avatars: a round head with ears, big eyes, a nose
// and a mouth that opens with the voice, and a round body whose arms sit on
// the robot's skeleton (so every gesture works). Each animal brings its own
// outfit as SVG layers, drawn in this order:
//   back      behind the neck
//   neck      over the body, under the arms (collars, ties, hoodie details)
//   headBack  behind the ears and head (headphone bands)
//   faceTop   on the face, so it turns with it (glasses)
//   headTop   over the whole head (cups, hats)
// Parts in #25f4ee and #fe2c55 take the scene theme's colors. Headphone cups
// with ids cupL and cupR slide with head turns, elements with class "led"
// pulse, and animate(pose, { $, setT }) moves anything else.
window.makeCritter = function makeCritter(o) {
  const ink = o.ink;
  const eyeAt = [[385, 445], [575, 445]];

  const ears = {
    // Pointed cat ears with a pink inside.
    cat: (side) => {
      const m = (x) => (side < 0 ? x : 960 - x);
      return `<path d="M${m(270)} 370 L${m(238)} 128 Q${m(242)} 112 ${m(258)} 120 L${m(440)} 268 Z" fill="${o.fur}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
        <path d="M${m(292)} 330 L${m(268)} 176 L${m(398)} 268 Z" fill="${o.earInner}"/>`;
    },
    // Tall fox ears with dark tips.
    fox: (side) => {
      const m = (x) => (side < 0 ? x : 960 - x);
      return `<path d="M${m(262)} 390 L${m(205)} 78 Q${m(210)} 62 ${m(226)} 70 L${m(448)} 262 Z" fill="${o.fur}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
        <path d="M${m(288)} 345 L${m(244)} 150 L${m(402)} 268 Z" fill="${o.earInner}"/>
        <path d="M${m(214)} 128 L${m(205)} 78 Q${m(210)} 62 ${m(226)} 70 L${m(298)} 132 Q${m(250)} 116 ${m(214)} 128 Z" fill="${o.earTip}"/>`;
    },
    // Round panda ears.
    panda: (side) => {
      const x = side < 0 ? 292 : 668;
      return `<circle cx="${x}" cy="262" r="86" fill="${o.patch}" stroke="${ink}" stroke-width="6"/>
        <circle cx="${x}" cy="266" r="42" fill="${o.earInner}"/>`;
    },
  };

  const eye = ([cx, cy], i) => {
    const patch = o.patches
      ? `<ellipse cx="${cx + (i ? 12 : -12)}" cy="${cy + 6}" rx="78" ry="98" transform="rotate(${i ? 22 : -22} ${cx} ${cy})" fill="${o.patch}"/>`
      : '';
    const white = o.patches ? `<circle cx="${cx}" cy="${cy}" r="${o.eyeRy + 8}" fill="#ffffff"/>` : '';
    return `${patch}<g id="eye${i ? 'R' : 'L'}">${white}
        <ellipse cx="${cx}" cy="${cy}" rx="${o.eyeRx}" ry="${o.eyeRy}" fill="${o.eye}"/>
        <circle cx="${cx - 13}" cy="${cy - 18}" r="13" fill="#ffffff"/>
        <circle cx="${cx + 12}" cy="${cy + 14}" r="6" fill="#ffffff" opacity="0.8"/></g>`;
  };

  // The mouth: an upper lip line, and an opening (with a tongue) below it
  // that grows with the level.
  const mouth = `
        <ellipse id="mouthOpen" cx="480" cy="560" rx="26" ry="2" fill="${o.mouthIn}" stroke="${ink}" stroke-width="5" opacity="0"/>
        <ellipse id="tongue" cx="480" cy="570" rx="14" ry="6" fill="#ff8fa3" opacity="0"/>
        <path d="M480 532 L480 548 M440 548 Q460 572 480 548 Q500 572 520 548" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

  const whiskers = o.whiskers
    ? `<g stroke="${ink}" stroke-width="4" stroke-linecap="round" opacity="0.55">
          <path d="M365 520 L250 500 M365 538 L246 540 M368 556 L256 580"/>
          <path d="M595 520 L710 500 M595 538 L714 540 M592 556 L704 580"/></g>`
    : '';

  const arm = (side) => {
    const x = side < 0 ? 150 : 810;
    const id = side < 0 ? 'L' : 'R';
    return `<g id="arm${id}">
        <rect x="${x - 42}" y="860" width="84" height="245" rx="42" fill="${o.arm}" stroke="${ink}" stroke-width="6"/>
        <circle cx="${x}" cy="888" r="54" fill="${o.arm}" stroke="${ink}" stroke-width="6"/>
        <g id="fore${id}">
          <rect x="${x - 38}" y="1068" width="76" height="205" rx="38" fill="${o.arm}" stroke="${ink}" stroke-width="6"/>
          ${o.cuff ? `<rect x="${x - 42}" y="1196" width="84" height="36" rx="16" fill="${o.cuff}" stroke="${ink}" stroke-width="6"/>` : ''}
          <circle cx="${x}" cy="1270" r="46" fill="${o.paw}" stroke="${ink}" stroke-width="6"/>
          <g fill="${o.pads}"><ellipse cx="${x}" cy="1282" rx="17" ry="13"/><circle cx="${x - 22}" cy="1252" r="8"/>
          <circle cx="${x}" cy="1244" r="8"/><circle cx="${x + 22}" cy="1252" r="8"/></g>
        </g>
      </g>`;
  };

  const svg = `
    <defs>
      <radialGradient id="headFur" cx="0.45" cy="0.35" r="0.75">
        <stop offset="0" stop-color="${o.furLight}"/><stop offset="1" stop-color="${o.fur}"/>
      </radialGradient>
      <clipPath id="headShape"><ellipse cx="480" cy="455" rx="247" ry="212"/></clipPath>
      <linearGradient id="bodyFur" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${o.body}"/><stop offset="1" stop-color="${o.bodyDark}"/>
      </linearGradient>
    </defs>
    <g id="critter">
      <g id="torso">
        ${o.back || ''}
        <rect x="392" y="600" width="176" height="220" rx="70" fill="${o.fur}" stroke="${ink}" stroke-width="6"/>
        <path d="M150 1280 L150 965 Q150 800 330 772 L630 772 Q810 800 810 965 L810 1280 Z" fill="url(#bodyFur)" stroke="${ink}" stroke-width="6"/>
        ${o.belly ? `<ellipse cx="480" cy="1090" rx="190" ry="215" fill="${o.belly}"/>` : ''}
        ${o.neck || ''}
        ${arm(-1)}
        ${arm(1)}
      </g>
      <g id="head"><g transform="translate(0 36)">
        ${o.headBack || ''}
        <g id="earL">${ears[o.ears](-1)}</g>
        <g id="earR">${ears[o.ears](1)}</g>
        <ellipse cx="480" cy="455" rx="250" ry="215" fill="url(#headFur)" stroke="${ink}" stroke-width="6"/>
        ${o.extra || ''}
        <g clip-path="url(#headShape)"><g id="muzzle">${o.muzzle}</g></g>
        <g id="face">
          ${eye(eyeAt[0], 0)}
          ${eye(eyeAt[1], 1)}
          <ellipse id="cheekL" cx="322" cy="548" rx="38" ry="22" fill="#ff8fab" opacity="0.35"/>
          <ellipse id="cheekR" cx="638" cy="548" rx="38" ry="22" fill="#ff8fab" opacity="0.35"/>
          ${whiskers}
          <path d="M456 506 Q480 496 504 506 Q494 528 480 532 Q466 528 456 506 Z" fill="${o.nose}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>
          ${mouth}
          ${o.faceTop || ''}
        </g>
        ${o.headTop || ''}
      </g></g>
    </g>`;

  return {
    name: o.name,
    wide: '-91 84 1142 660',
    faceShift: 26,
    svg,
    init({ $ }) {
      this.leds = document.querySelectorAll('.led');
      this.mouthOpen = $('mouthOpen');
      this.tongue = $('tongue');
    },
    apply(p, { $, setT }) {
      const { t, L, C, turn } = p;
      // The muzzle moves with the face but stays inside the head's outline.
      setT('muzzle', $('face').getAttribute('transform'));
      // Blinks and squints squash the eyes around their centers.
      const s = Math.max(0.08, Math.min(1.1, p.open * Math.min(1.1, p.squint)));
      eyeAt.forEach(([cx, cy], i) => {
        setT(i ? 'eyeR' : 'eyeL', `translate(${cx} ${cy}) scale(1 ${s.toFixed(3)}) translate(${-cx} ${-cy})`);
      });

      const ry = 2 + L ** 0.7 * 36;
      const open = this.mouthOpen;
      open.setAttribute('ry', ry.toFixed(1));
      open.setAttribute('rx', (24 + L * 16).toFixed(1));
      open.setAttribute('cy', (552 + ry * 0.9).toFixed(1));
      open.setAttribute('opacity', ry > 6 ? '1' : '0');
      this.tongue.setAttribute('cy', (552 + ry * 1.45).toFixed(1));
      this.tongue.setAttribute('ry', (ry * 0.4).toFixed(1));
      this.tongue.setAttribute('rx', (12 + L * 8).toFixed(1));
      this.tongue.setAttribute('opacity', ry > 14 ? '1' : '0');

      // Ears flick while talking and perk up in the cheer.
      const flick = L * 5 * Math.sin(t * 9) + turn * 4;
      setT('earL', `rotate(${(-flick - C * 8).toFixed(2)} 330 330)`);
      setT('earR', `rotate(${(flick + C * 8).toFixed(2)} 630 330)`);
      setT('cupL', `translate(${(turn * 10).toFixed(1)} 0)`);
      setT('cupR', `translate(${(turn * 10).toFixed(1)} 0)`);
      for (const c of ['cheekL', 'cheekR']) $(c).setAttribute('opacity', (0.25 + L * 0.45 + C * 0.25).toFixed(2));
      this.leds.forEach((e) => e.setAttribute('opacity', (0.5 + p.pulse * 0.3 + L * 0.2).toFixed(2)));
      o.animate?.(p, { $, setT });
    },
  };
};
