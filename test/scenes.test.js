'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../src/scenes/layout');
const T = require('../src/scenes/themes');
const A = require('../src/scenes/art');

test('every scene has its own frame file, and the windows fit the canvas', () => {
  const files = L.artFiles();
  assert.equal(new Set(files).size, files.length);
  assert.equal(files.length, L.SCENES.length + 1);
  assert.equal(L.frameFile('Screen + Camera'), 'frame-screen-camera.png');
  for (const h of Object.values(L.HOLES)) {
    assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= L.W && h.y + h.h <= L.H, JSON.stringify(h));
  }
});

test('themes are complete and use only bundled fonts', () => {
  const hex = /^#[0-9a-f]{6}$/i;
  assert.equal(new Set(T.THEMES.map((t) => t.id)).size, T.THEMES.length);
  assert.ok(T.THEMES.some((t) => t.id === T.DEFAULT_THEME));
  for (const t of T.THEMES) {
    assert.ok(t.name && t.description, t.id);
    assert.ok(hex.test(t.avatar.c1) && hex.test(t.avatar.c2), `${t.id} avatar colors`);
    assert.ok(t.bg.gradient.length >= 2, `${t.id} background`);
    assert.ok(['glow', 'pixel', 'soft', 'line'].includes(t.frame.style), `${t.id} frame style`);
    for (const role of ['title', 'subtitle', 'handle']) {
      const font = T.FONTS[t.text[role].font];
      assert.ok(font, `${t.id} ${role} font`);
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'scenes', 'fonts', font.file)), font.file);
    }
    for (const from of Object.keys(t.copy || {})) {
      assert.ok(L.SCENES.some((s) => s.text.some((l) => l.text === from)), `${t.id} copy "${from}" matches a scene line`);
    }
  }
  assert.equal(T.byId('nope').id, T.DEFAULT_THEME);
});

test('scene text uses the theme words and drops handle lines without a handle', () => {
  const ending = L.SCENES.find((s) => s.name === 'Ending');
  assert.deepEqual(A.sceneLines(T.byId('neon'), ending, '@me').map((l) => l.text), ['THANKS FOR', 'WATCHING', 'follow @me']);
  assert.deepEqual(A.sceneLines(T.byId('arcade'), ending, '').map((l) => l.text), ['GAME OVER', 'THANKS FOR PLAYING']);
});

test('the seeded random source repeats', () => {
  const a = A.rng(3);
  const b = A.rng(3);
  for (let i = 0; i < 5; i += 1) assert.equal(a(), b());
});
