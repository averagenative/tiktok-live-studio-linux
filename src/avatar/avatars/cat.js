'use strict';

// A ginger tabby with a pink nose and whiskers, dressed as a gamer: an
// angular headset with a boom mic, and a collar with a bell.
{
const ink = '#3d2617';
const mx = (x, side) => (side < 0 ? x : 960 - x);
const cup = (side) => {
  const pts = (list) => list.map(([x, y]) => `${mx(x, side)},${y}`).join(' ');
  return `<polygon points="${pts([[188, 368], [246, 368], [270, 404], [270, 540], [246, 576], [188, 576], [162, 540], [162, 404]])}"
          fill="#2c3240" stroke="#1b1f27" stroke-width="6" stroke-linejoin="round"/>
        <polygon points="${pts([[196, 392], [238, 392], [252, 416], [252, 528], [238, 552], [196, 552], [180, 528], [180, 416]])}"
          fill="#222833" stroke="#25f4ee" stroke-width="5" stroke-linejoin="round"/>
        <rect class="led" x="${mx(208, side) - 8}" y="430" width="16" height="84" rx="8" fill="#25f4ee"/>`;
};

window.AVATARS.cat = window.makeCritter({
  name: 'Cat',
  ears: 'cat',
  ink,
  fur: '#f0a04b',
  furLight: '#ffc27a',
  body: '#f0a04b',
  bodyDark: '#d98330',
  arm: '#eb9a45',
  belly: '#ffe7c7',
  paw: '#ffe7c7',
  pads: '#ff9fb0',
  earInner: '#ffb3c1',
  eye: '#2a1a10',
  eyeRx: 46,
  eyeRy: 54,
  nose: '#ff8fab',
  mouthIn: '#6b2433',
  whiskers: true,
  muzzle: '<ellipse cx="480" cy="548" rx="128" ry="82" fill="#ffe7c7"/>',
  extra: '<g stroke="#c9731f" stroke-width="16" stroke-linecap="round" fill="none"><path d="M438 258 L452 306"/><path d="M480 252 L480 304"/><path d="M522 258 L508 306"/></g>',
  // A suspension headband: a thin outer frame over a padded strap.
  headBack: `
        <path d="M234 440 Q234 128 480 128 Q726 128 726 440" fill="none" stroke="#3a4150" stroke-width="16" stroke-linecap="round"/>
        <path d="M268 380 Q268 194 480 194 Q692 194 692 380" fill="none" stroke="#2c3240" stroke-width="30" stroke-linecap="round"/>
        <path d="M330 232 Q480 186 630 232" fill="none" stroke="#25f4ee" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`,
  // The mic arm hangs off the left cup, so it slides with it.
  headTop: `
        <g id="cupL">${cup(-1)}
          <path d="M210 566 Q220 652 346 628" fill="none" stroke="#2c3240" stroke-width="14" stroke-linecap="round"/>
          <rect x="336" y="610" width="56" height="36" rx="18" fill="#1b1f27" stroke="#3a4150" stroke-width="4"/>
          <circle id="micLed" cx="381" cy="628" r="7" fill="#fe2c55"/></g>
        <g id="cupR">${cup(1)}</g>`,
  neck: `
        <path d="M384 742 Q480 784 576 742 L578 780 Q480 824 382 780 Z" fill="#fe2c55" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
        <g id="bell">
          <circle cx="480" cy="806" r="10" fill="none" stroke="#b8860b" stroke-width="5"/>
          <circle cx="480" cy="838" r="28" fill="#f6c445" stroke="${ink}" stroke-width="5"/>
          <path d="M453 834 L507 834 M480 850 L480 866" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
          <circle cx="480" cy="850" r="6" fill="${ink}"/>
          <circle cx="468" cy="824" r="6" fill="#fff6d0" opacity="0.85"/>
        </g>`,
  animate({ t, L, C, turn }, { $, setT }) {
    // The bell swings with the body and jingles while talking; the mic's
    // light shows the voice.
    const swing = Math.sin(t * 2.3) * 4 + L * 9 * Math.sin(t * 8.5) - turn * 14 + C * 10 * Math.sin(t * 9);
    setT('bell', `rotate(${swing.toFixed(2)} 480 800)`);
    $('micLed').setAttribute('opacity', (0.3 + L * 0.7).toFixed(2));
  },
});
}
