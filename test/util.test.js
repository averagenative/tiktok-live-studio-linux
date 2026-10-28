'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const u = require('../src/util');

test('md5Hex is lowercase hex like the x-ss-stub LIVE Studio sends', () => {
  assert.equal(u.md5Hex('title=hi&live_studio=1'), crypto.createHash('md5').update('title=hi&live_studio=1').digest('hex'));
  assert.match(u.md5Hex('x'), /^[0-9a-f]{32}$/);
});

test('formEncode drops null/undefined and stringifies the rest', () => {
  assert.equal(u.formEncode({ a: 1, b: true, c: undefined, d: null, e: 'x y&z' }), 'a=1&b=true&e=x%20y%26z');
  assert.equal(u.formEncode({}), '');
});

test('buildCommonParams carries the LIVE Studio identity', () => {
  const p = u.buildCommonParams({ language: 'en', platform: 'mac', region: 'US', screen: { width: 1920, height: 1080 } });
  assert.equal(p.aid, 8311);
  assert.equal(p.app_name, 'tiktok_live_studio');
  assert.equal(p.channel, 'studio');
  assert.equal(p.version_code, '1.38.0');
  assert.equal(p.webcast_sdk_version, 1380);
  assert.equal(p.live_mode, 6);
  assert.equal(p.device_id, '0');
  assert.equal(p.priority_region, 'US');
  assert.equal(p.screen_width, 1920);
});

test('splitPushUrl splits at the last path segment and keeps the query on the key', () => {
  const url = 'rtmp://push-rtmp-l11-va01.tiktokcdn.com/game/stream-123456789?expire=1793300000&sign=abc123';
  assert.deepEqual(u.splitPushUrl(url), {
    server: 'rtmp://push-rtmp-l11-va01.tiktokcdn.com/game/',
    key: 'stream-123456789?expire=1793300000&sign=abc123',
  });
  assert.equal(u.splitPushUrl('rtmpq://host/app/key'), null);
  assert.equal(u.splitPushUrl('rtmp://host/'), null);
  assert.equal(u.splitPushUrl('rtmp://host'), null);
  assert.equal(u.splitPushUrl(''), null);
  assert.equal(u.splitPushUrl('not a url'), null);
});

test('pickPushUrl prefers the plain RTMP fallback over ByteDance transports', () => {
  assert.equal(u.pickPushUrl({ rtmp_push_url: 'rtmp://a/b/c', push_urls: ['rtmpq://x/y/z'] }), 'rtmp://a/b/c');
  assert.equal(u.pickPushUrl({ push_urls: ['rtmpq://x/y/z', 'rtmps://s/t/u'] }), 'rtmps://s/t/u');
  assert.equal(u.pickPushUrl({ push_urls: ['rtmpq://x/y/z'] }), null);
  assert.equal(u.pickPushUrl(null), null);
});

test('obsAuth follows the obs-websocket v5 recipe', () => {
  const secret = crypto.createHash('sha256').update('pw' + 'salt').digest('base64');
  const expected = crypto.createHash('sha256').update(secret + 'chal').digest('base64');
  assert.equal(u.obsAuth('pw', 'salt', 'chal'), expected);
});

test('maskKey hides the middle of the key', () => {
  assert.equal(u.maskKey(''), '');
  assert.equal(u.maskKey('short'), '*****');
  const m = u.maskKey('stream-123456789?sign=abcdef');
  assert.ok(m.startsWith('stre') && m.endsWith('cdef') && m.includes('*'));
});

test('cookieHeader dedupes and mirrors sessionid_ss into sessionid', () => {
  const h = u.cookieHeader([
    { name: 'sessionid_ss', value: 'S1' },
    { name: 'tt_csrf_token', value: 'a' },
    { name: 'tt_csrf_token', value: 'b' },
  ]);
  assert.equal(h, 'sessionid_ss=S1; tt_csrf_token=b; sessionid=S1');
  assert.equal(u.cookieHeader([{ name: 'sessionid', value: 'X' }, { name: 'sessionid_ss', value: 'Y' }]), 'sessionid=X; sessionid_ss=Y');
  assert.ok(u.hasSession([{ name: 'sessionid_ss', value: 'Y' }]));
  assert.ok(!u.hasSession([{ name: 'sessionid', value: '' }]));
});

test('summarizeRoom pulls ids and the OBS-ready push target', () => {
  const r = u.summarizeRoom({
    id_str: '7400000000000000001',
    stream_id_str: '1800000000000000002',
    title: 'hello',
    owner: { display_id: 'someone' },
    living_room_attrs: { room_id_str: '7400000000000000001' },
    stream_url: { rtmp_push_url: 'rtmp://push.example/live/stream-1?sign=z' },
  });
  assert.equal(r.roomId, '7400000000000000001');
  assert.equal(r.pingRoomId, '7400000000000000001');
  assert.equal(r.streamId, '1800000000000000002');
  assert.equal(r.ownerHandle, 'someone');
  assert.deepEqual(r.push, { server: 'rtmp://push.example/live/', key: 'stream-1?sign=z' });
  assert.equal(u.summarizeRoom(null), null);
});

test('extractTopics finds {id,title} objects anywhere in the response', () => {
  const topics = u.extractTopics({
    data: {
      hashtag: { id: 5, title: 'Gaming' },
      hashtag_list: [{ id: 6, title: 'Music' }, { id: 0, title: 'none' }, { id_str: '7', show_name: 'Chat' }],
      other: { nested: [{ id: 6, title: 'Music dup' }] },
    },
  });
  assert.deepEqual(topics, [
    { id: '5', title: 'Gaming' },
    { id: '6', title: 'Music' },
    { id: '7', title: 'Chat' },
  ]);
  assert.deepEqual(u.extractTopics(null), []);
});

test('apiMessage prefers the human prompt', () => {
  assert.equal(u.apiMessage({ status_code: 20003, data: { message: "User doesn't login", prompts: 'Please login first' } }), 'Please login first');
  assert.equal(u.apiMessage({ status_code: 1 }), 'status_code 1');
  assert.equal(u.apiMessage(null), 'empty response');
});

test('webcastHostForIdc maps data centers and their aliases', () => {
  assert.equal(u.webcastHostForIdc('useast5'), 'https://webcast16-normal-useast5.tiktokv.us');
  assert.equal(u.webcastHostForIdc('TTP'), 'https://webcast16-normal-useast5.tiktokv.us');
  assert.equal(u.webcastHostForIdc('useast8'), 'https://webcast16-normal-useast8.tiktokv.us');
  assert.equal(u.webcastHostForIdc('maliva'), 'https://webcast16-normal-c-useast1a.tiktokv.com');
  assert.equal(u.webcastHostForIdc('my'), 'https://webcast16-normal-c-alisg.tiktokv.com');
  assert.equal(u.webcastHostForIdc('useast2a'), 'https://webcast16-normal-no1a.tiktokv.eu');
  assert.equal(u.webcastHostForIdc('mars'), null);
  assert.equal(u.webcastHostForIdc(''), null);
});

test('candidateWebcastHosts tries override, IDC host, US hosts, then the rest', () => {
  const us = [{ name: 'tt-target-idc', value: 'useast8' }, { name: 'store-country-code', value: 'us' }];
  const list = u.candidateWebcastHosts(us, 'https://custom.example/');
  assert.equal(list[0], 'https://custom.example');
  assert.equal(list[1], 'https://webcast16-normal-useast8.tiktokv.us');
  assert.equal(list[2], 'https://webcast16-normal-useast5.tiktokv.us');
  assert.equal(list.at(-1), 'https://webcast.tiktokv.com');
  assert.equal(new Set(list).size, list.length);
  assert.equal(u.candidateWebcastHosts([], '')[0], 'https://webcast16-normal-useast5.tiktokv.us');
  assert.equal(u.idcFromCookies([{ name: 'store-idc', value: 'ALISG' }]), 'alisg');
});

test('summarize trims long arrays and strings for the log', () => {
  const s = u.summarize({ a: [1, 2, 3, 4, 5, 6], b: 'x'.repeat(200), c: { d: true } });
  assert.match(s, /"\+2 more"/);
  assert.match(s, /x{120}\.\.\./);
  assert.match(s, /"d":true/);
  assert.ok(u.summarize({ big: 'y'.repeat(5000) }, 100).length <= 103);
});

test('studioRequirements reads the pass/fail checklist from check_access', () => {
  const reqs = u.studioRequirements({
    in_calm_period: false,
    guidelines: [{ requirements: [{ title: 'Be 18 or older', pass: true }, { desc: 'Have 1,000 followers', pass: false }, { pass: false }] }],
  });
  assert.deepEqual(reqs, [
    { text: 'Be 18 or older', pass: true },
    { text: 'Have 1,000 followers', pass: false },
    { text: 'Requirement', pass: false },
  ]);
  assert.deepEqual(u.studioRequirements(null), []);
});

test('studioApplyUrl builds the official application page URL', () => {
  const url = new URL(u.studioApplyUrl({ userId: '123', lang: 'en' }));
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/falcon/live_g/live_studio_permission_apply/index.html');
  assert.equal(url.searchParams.get('source'), 'live_studio');
  assert.equal(url.searchParams.get('aid'), '8311');
  assert.equal(url.searchParams.get('user_id'), '123');
});
