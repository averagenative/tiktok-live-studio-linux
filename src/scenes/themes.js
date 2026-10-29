'use strict';

// Scene themes for "Set up TikTok scenes". Each one is data for
// scenes/art.js: background, window frames, text styles, and the colors the
// avatar takes on. Fonts are bundled (OFL, see scenes/fonts) and drawn
// into the artwork, so OBS needs none of them installed. avatar.c1 and c2
// replace the avatar's cyan and pink accents.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SceneThemes = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const FONTS = {
    montserrat: { family: 'LSL Montserrat', file: 'Montserrat.ttf', weight: '100 900' },
    audiowide: { family: 'LSL Audiowide', file: 'Audiowide.ttf', weight: '400' },
    pressStart: { family: 'LSL Press Start 2P', file: 'PressStart2P.ttf', weight: '400' },
    fredoka: { family: 'LSL Fredoka', file: 'Fredoka.ttf', weight: '300 700' },
    spaceGrotesk: { family: 'LSL Space Grotesk', file: 'SpaceGrotesk.ttf', weight: '300 700' },
  };

  const DARK_SHADOW = { color: 'rgba(0, 0, 0, 0.55)', blur: 12, x: 0, y: 4 };

  const THEMES = [
    {
      id: 'neon',
      name: 'Neon',
      description: 'Cyan and pink glow on a dark gradient. The original look.',
      avatar: { c1: '#25f4ee', c2: '#fe2c55' },
      bg: {
        gradient: ['#11131a', '#0a0b10'],
        glows: [
          { color: '#25f4ee', x: 160, y: 260, r: 900, alpha: 0.2 },
          { color: '#fe2c55', x: 940, y: 1660, r: 950, alpha: 0.28 },
          { color: '#8a5cff', x: 980, y: 420, r: 640, alpha: 0.14 },
        ],
      },
      frame: { style: 'glow', width: 8, round: 1, colors: ['#25f4ee', '#fe2c55'], glow: 28 },
      text: {
        title: { font: 'montserrat', weight: 900, size: 96, color: '#ffffff', shadow: DARK_SHADOW },
        subtitle: { font: 'montserrat', weight: 500, size: 44, color: '#ffffff', shadow: DARK_SHADOW },
        handle: { font: 'montserrat', weight: 600, size: 52, color: '#25f4ee', shadow: DARK_SHADOW },
      },
    },
    {
      id: 'synthwave',
      name: 'Synthwave',
      description: 'A sunset sky, a striped neon sun, and a glowing grid floor.',
      avatar: { c1: '#ff2bd6', c2: '#ffb347' },
      bg: {
        gradient: ['#0d0221', '#2b0a4a', '#6a1361', '#d8446c'],
        glows: [{ color: '#ff2bd6', x: 540, y: 1500, r: 900, alpha: 0.3 }],
        pattern: { type: 'synthwave', horizon: 1520, sunR: 300, sun: ['#ffe66d', '#ff2bd6'], floor: ['#1a0533', '#07010f'], grid: '#ff2bd6', stars: 90 },
      },
      frame: { style: 'glow', width: 7, round: 0.6, colors: ['#ff2bd6', '#ffb347'], glow: 30 },
      text: {
        title: {
          font: 'audiowide', size: 96, gradient: ['#fff6d5', '#ffb347', '#ff2bd6'], stroke: { color: '#2b0a4a', width: 8 },
          shadow: { color: 'rgba(255, 43, 214, 0.75)', blur: 30, x: 0, y: 0 },
        },
        subtitle: { font: 'montserrat', weight: 500, size: 44, color: '#ffe6ff', shadow: DARK_SHADOW },
        handle: {
          font: 'audiowide', size: 50, color: '#ffb347', stroke: { color: '#2b0a4a', width: 8 },
          shadow: { color: 'rgba(255, 179, 71, 0.6)', blur: 18, x: 0, y: 0 },
        },
      },
    },
    {
      id: 'arcade',
      name: 'Arcade',
      description: 'Pixel lettering, scanlines, and chunky notched borders.',
      avatar: { c1: '#39ff14', c2: '#ffe600' },
      bg: {
        gradient: ['#0b0d2a', '#050614'],
        glows: [
          { color: '#3d2bff', x: 540, y: 260, r: 900, alpha: 0.2 },
          { color: '#39ff14', x: 540, y: 1900, r: 700, alpha: 0.1 },
        ],
        pattern: { type: 'arcade', cell: 40, grid: 'rgba(90, 130, 255, 0.10)', scan: 0.08, pixels: 70, colors: ['#39ff14', '#ffe600', '#ff2e63', '#3df2ff'] },
      },
      frame: { style: 'pixel', width: 8, step: 12, colors: ['#39ff14', '#ffe600'] },
      text: {
        title: { font: 'pressStart', size: 72, color: '#ffe600', shadow: { color: '#ff2e63', blur: 0, x: 6, y: 6 } },
        subtitle: { font: 'pressStart', size: 32, color: '#ffffff', shadow: { color: '#000000', blur: 0, x: 4, y: 4 } },
        handle: { font: 'pressStart', size: 38, color: '#39ff14', shadow: { color: '#000000', blur: 0, x: 4, y: 4 } },
      },
      copy: {
        'STARTING SOON': 'PRESS START',
        'LIVE in a moment': 'LIVE IN A MOMENT',
        'BE RIGHT BACK': 'PAUSED',
        'THANKS FOR': 'GAME OVER',
        WATCHING: 'THANKS FOR PLAYING',
      },
    },
    {
      id: 'cozy',
      name: 'Cozy',
      description: 'Soft pastels, rounded letters, and white photo-style borders.',
      avatar: { c1: '#ff7aa2', c2: '#7ec8e3' },
      bg: {
        gradient: ['#fff1e6', '#ffe1ec', '#e8e4ff'],
        glows: [
          { color: '#ffd6a5', x: 180, y: 300, r: 760, alpha: 0.6 },
          { color: '#bde0fe', x: 920, y: 560, r: 640, alpha: 0.5 },
          { color: '#caffbf', x: 940, y: 1560, r: 760, alpha: 0.4 },
        ],
        pattern: { type: 'dots', color: 'rgba(255, 255, 255, 0.6)', count: 70 },
      },
      frame: { style: 'soft', width: 18, round: 1.5, colors: ['#ffffff', '#ffffff'], shadow: 'rgba(120, 60, 90, 0.28)' },
      text: {
        title: { font: 'fredoka', weight: 700, size: 104, color: '#5b3a6b', shadow: { color: 'rgba(91, 58, 107, 0.18)', blur: 14, x: 0, y: 5 } },
        subtitle: { font: 'fredoka', weight: 500, size: 46, color: '#7d5a8c' },
        handle: { font: 'fredoka', weight: 600, size: 54, color: '#ff5f8f' },
      },
      copy: {
        'STARTING SOON': 'Starting soon',
        'BE RIGHT BACK': 'Be right back',
        'THANKS FOR': 'Thanks for',
        WATCHING: 'watching',
      },
    },
    {
      id: 'minimal',
      name: 'Minimal',
      description: 'Charcoal, thin white lines, and clean grotesque type.',
      avatar: { c1: '#ffffff', c2: '#ff5a5f' },
      bg: {
        gradient: ['#1a1a1d', '#0c0c0e'],
        glows: [{ color: '#ffffff', x: 540, y: 0, r: 1200, alpha: 0.05 }],
        pattern: { type: 'vignette', alpha: 0.4 },
      },
      frame: { style: 'line', width: 3, round: 0.5, colors: ['#ffffff', '#ffffff'], outer: { gap: 14, width: 1, alpha: 0.3 } },
      text: {
        title: { font: 'spaceGrotesk', weight: 700, size: 92, color: '#ffffff', spacing: 2 },
        subtitle: { font: 'spaceGrotesk', weight: 400, size: 40, color: '#a1a1aa' },
        handle: { font: 'spaceGrotesk', weight: 500, size: 48, color: '#ffffff', spacing: 1 },
      },
    },
  ];

  const DEFAULT_THEME = 'neon';
  const byId = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

  return { FONTS, THEMES, DEFAULT_THEME, byId };
});
