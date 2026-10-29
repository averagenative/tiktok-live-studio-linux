'use strict';

// A red fox with a white face, dark ear tips, and a black nose, in
// streetwear: a backwards cap, retro foam headphones over it, and a hoodie.
{
const ink = '#33190d';
const hoodie = '#343947';
// Retro foam on-ear pads; the pad color takes the theme's first accent.
const pad = (side) => {
  const x = side < 0 ? 230 : 730;
  const dots = [[-18, -20], [14, -26], [-28, 8], [4, -2], [26, 4], [-10, 26], [20, 28]]
    .map(([dx, dy]) => `<circle cx="${x + dx}" cy="${476 + dy}" r="5"/>`).join('');
  return `<rect x="${x - 10}" y="400" width="20" height="34" rx="6" fill="#9aa3b5" stroke="${ink}" stroke-width="4"/>
        <circle cx="${x}" cy="476" r="56" fill="#25f4ee" stroke="${ink}" stroke-width="6"/>
        <g fill="${ink}" opacity="0.18">${dots}</g>`;
};

window.AVATARS.fox = window.makeCritter({
  name: 'Fox',
  ears: 'fox',
  ink,
  fur: '#e8692e',
  furLight: '#ff9353',
  body: hoodie,
  bodyDark: '#262a35',
  arm: hoodie,
  cuff: '#2a2e3a',
  belly: null,
  paw: '#3a2219',
  pads: '#5c3a2c',
  earInner: '#ffe1cc',
  earTip: '#3a2219',
  eye: '#1f120b',
  eyeRx: 42,
  eyeRy: 50,
  nose: '#1f120b',
  mouthIn: '#5c1d24',
  whiskers: true,
  muzzle: '<path d="M236 470 Q262 640 480 662 Q698 640 724 470 Q620 572 480 520 Q340 572 236 470 Z" fill="#fff3e6"/>',
  // The cap's opening and strap face forward. The brim peeks over the top.
  headBack: `<path d="M364 198 Q480 70 596 198 Q480 172 364 198 Z" fill="#fe2c55" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>`,
  headTop: `
        <path d="M316 318 C312 206 384 164 480 164 C576 164 648 206 644 318 Q480 284 316 318 Z" fill="#fe2c55" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
        <path d="M480 166 L480 248 M404 178 Q384 240 390 304 M556 178 Q576 240 570 304" fill="none" stroke="${ink}" stroke-width="4" opacity="0.3"/>
        <path d="M432 302 Q434 250 480 248 Q526 250 528 302 Z" fill="#ff9353" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
        <rect x="424" y="282" width="112" height="18" rx="9" fill="#25f4ee" stroke="${ink}" stroke-width="4"/>
        <circle cx="480" cy="166" r="13" fill="#25f4ee" stroke="${ink}" stroke-width="4"/>
        <path d="M230 470 Q230 178 480 178 Q730 178 730 470" fill="none" stroke="#9aa3b5" stroke-width="11" stroke-linecap="round"/>
        <path d="M230 470 Q230 178 480 178 Q730 178 730 470" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
        <g id="cupL">${pad(-1)}</g><g id="cupR">${pad(1)}</g>`,
  neck: `
        <path d="M300 776 Q480 868 660 776 Q676 812 642 840 Q480 922 318 840 Q284 812 300 776 Z" fill="#40465a" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M330 1124 Q480 1104 630 1124 L668 1266 L292 1266 Z" fill="#2f3441" stroke="#1d2029" stroke-width="5" stroke-linejoin="round"/>
        <g id="strings" stroke-linecap="round">
          <path id="stringL" d="M436 862 Q428 930 436 996" fill="none" stroke="#25f4ee" stroke-width="8"/>
          <path id="stringR" d="M524 862 Q532 930 524 996" fill="none" stroke="#25f4ee" stroke-width="8"/>
        </g>`,
  animate({ t, L, turn }, { setT }) {
    // The hoodie strings sway with the voice and head turns.
    const sway = Math.sin(t * 2) * 2 + L * 6 * Math.sin(t * 8) - turn * 6;
    setT('stringL', `rotate(${sway.toFixed(2)} 436 862)`);
    setT('stringR', `rotate(${(sway * 0.8).toFixed(2)} 524 862)`);
  },
});
}
