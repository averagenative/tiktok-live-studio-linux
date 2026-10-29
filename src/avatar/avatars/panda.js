'use strict';

// A panda: white face, black eye patches, round black ears and arms. It
// wears big padded studio headphones, round glasses, and a bow tie.
{
const ink = '#1c1c1f';
const cup = (side) => {
  const x = side < 0 ? 212 : 748;
  return `<circle cx="${x}" cy="476" r="74" fill="#2c3240" stroke="${ink}" stroke-width="6"/>
        <circle cx="${x}" cy="476" r="54" fill="#3a3f4d" stroke="#25f4ee" stroke-width="6"/>
        <circle cx="${x}" cy="476" r="22" fill="#2c3240"/>
        <circle class="led" cx="${x}" cy="476" r="9" fill="#fe2c55"/>`;
};
const wing = (side) => {
  const m = (x) => 480 + side * x;
  return `<path d="M${m(0)} 788 L${m(84)} 746 Q${m(100)} 788 ${m(84)} 830 Z" fill="#fe2c55" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
          <path d="M${m(64)} 766 L${m(30)} 782 M${m(64)} 810 L${m(30)} 794" stroke="${ink}" stroke-width="4" stroke-linecap="round" opacity="0.35"/>`;
};

window.AVATARS.panda = window.makeCritter({
  name: 'Panda',
  ears: 'panda',
  patches: true,
  ink,
  fur: '#f4f4f1',
  furLight: '#ffffff',
  patch: '#26262b',
  body: '#f4f4f1',
  bodyDark: '#dcdcd6',
  arm: '#26262b',
  belly: '#ffffff',
  paw: '#26262b',
  pads: '#4a4a52',
  earInner: '#3a3a42',
  eye: '#1c1c1f',
  eyeRx: 20,
  eyeRy: 24,
  nose: '#1c1c1f',
  mouthIn: '#5c1d24',
  whiskers: false,
  muzzle: '<ellipse cx="480" cy="548" rx="110" ry="74" fill="#ffffff"/>',
  // A steel band with a stitched cushion under it.
  headBack: `
        <path d="M220 470 Q220 138 480 138 Q740 138 740 470" fill="none" stroke="#2c3240" stroke-width="18" stroke-linecap="round"/>
        <path d="M322 214 Q480 128 638 214" fill="none" stroke="#3a3f4d" stroke-width="46" stroke-linecap="round"/>
        <path d="M330 206 Q480 124 630 206" fill="none" stroke="#25f4ee" stroke-width="4" stroke-dasharray="12 10" opacity="0.7"/>`,
  headTop: `<g id="cupL">${cup(-1)}</g><g id="cupR">${cup(1)}</g>`,
  faceTop: `
          <g fill="#ffffff" fill-opacity="0.08" stroke="#fe2c55" stroke-width="9">
            <circle cx="385" cy="445" r="64"/><circle cx="575" cy="445" r="64"/></g>
          <path d="M449 436 Q480 416 511 436 M321 432 L268 420 M639 432 L692 420" fill="none" stroke="#fe2c55" stroke-width="9" stroke-linecap="round"/>
          <g id="glint" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity="0.6">
            <path d="M350 408 Q362 394 382 390"/><path d="M540 408 Q552 394 572 390"/></g>`,
  neck: `
        <g id="bowtie">${wing(-1)}${wing(1)}
          <rect x="462" y="770" width="36" height="36" rx="12" fill="#fe2c55" stroke="${ink}" stroke-width="5"/></g>`,
  animate({ t, L, C, turn, pulse }, { $, setT }) {
    // The bow tie bounces with the voice; the glasses catch the light.
    const r = L * 7 * Math.sin(t * 8) + turn * 4 + C * 6 * Math.sin(t * 9);
    setT('bowtie', `rotate(${r.toFixed(2)} 480 788) translate(0 ${(-L * 4).toFixed(1)})`);
    $('glint').setAttribute('opacity', (0.35 + pulse * 0.35).toFixed(2));
  },
});
}
