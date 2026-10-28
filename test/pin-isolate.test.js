'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ISOLATE_SCRIPT, isTikTokLivePage } = require('../src/pin-isolate');

test('panel-only view applies to TikTok LIVE pages only', () => {
  assert.ok(isTikTokLivePage('https://www.tiktok.com/@yourhandle/live'));
  assert.ok(isTikTokLivePage('https://tiktok.com/@someone/live?enter_from=x'));
  assert.ok(!isTikTokLivePage('https://www.tiktok.com/@yourhandle'));
  assert.ok(!isTikTokLivePage('https://example.com/live'));
  assert.ok(!isTikTokLivePage('https://tiktok.com.evil.example/@x/live'));
  assert.ok(!isTikTokLivePage('not a url'));
});

test('the page script is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(ISOLATE_SCRIPT));
});
