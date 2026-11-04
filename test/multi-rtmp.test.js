'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('../src/plugins/twitch/multi-rtmp');

function tmpObsConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-obs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const profile = (folder, name) => {
    const p = path.join(dir, 'basic', 'profiles', folder);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'basic.ini'), `[General]\nName=${name}\n\n[Video]\nBaseCX=1080\n`);
    return p;
  };
  return { dir, profile };
}

// The plugin's own fields for a target it made in its dock.
const youtube = {
  id: '111', name: 'YouTube', protocol: 'RTMP',
  'service-param': { server: 'rtmp://a.rtmp.youtube.com/live2', key: 'yt-key' },
  'output-param': {}, 'sync-start': false, 'sync-stop': false, enabled: true,
};

test('parseIni reads sections and keys', () => {
  const ini = m.parseIni('[General]\nName=TikTok Vertical\n; comment\n[Basic]\nProfile=TikTok Vertical\nProfileDir=TikTok_Vertical\n');
  assert.equal(ini.General.Name, 'TikTok Vertical');
  assert.equal(ini.Basic.ProfileDir, 'TikTok_Vertical');
});

test('findProfileDir matches the profile name, not the folder name', (t) => {
  const { dir, profile } = tmpObsConfig(t);
  profile('Untitled', 'Untitled');
  const tv = profile('TikTok_Vertical', 'TikTok Vertical');
  assert.equal(m.findProfileDir(dir, 'TikTok Vertical'), tv);
  assert.equal(m.findProfileDir(dir, 'Nope'), null);
  assert.equal(m.findProfileDir(path.join(dir, 'missing'), 'TikTok Vertical'), null);
});

test('currentProfile reads user.ini, then global.ini', (t) => {
  const { dir } = tmpObsConfig(t);
  fs.writeFileSync(path.join(dir, 'global.ini'), '[Basic]\nProfile=Old\n');
  assert.equal(m.currentProfile(dir), 'Old');
  fs.writeFileSync(path.join(dir, 'user.ini'), '[General]\nFirstRun=true\n\n[Basic]\nProfile=TikTok Vertical\n');
  assert.equal(m.currentProfile(dir), 'TikTok Vertical');
});

test('upsertTwitch adds a target with its own 2-second-keyframe encoder', () => {
  const cfg = m.upsertTwitch({ targets: [youtube], video_configs: [], audio_configs: [] }, { key: ' live_123_abc ' }, () => 0.25);
  assert.equal(cfg.targets.length, 2);
  const t = m.findTwitchTarget(cfg);
  assert.equal(t.name, 'Twitch');
  assert.equal(t['service-param'].server, m.TWITCH_SERVER);
  assert.equal(t['service-param'].key, 'live_123_abc');
  assert.equal(t['sync-start'], true);
  assert.equal(t['sync-stop'], true);
  assert.equal('audio-config' in t, false, "no audio-config means sharing OBS's audio encoder");
  const venc = cfg.video_configs.find((v) => v.id === t['video-config']);
  assert.equal(venc.encoder, 'obs_nvenc_h264_tex');
  assert.equal(venc.param.keyint_sec, 2);
  assert.notEqual(venc.id, t.id);
  assert.deepEqual(cfg.targets[0], youtube, 'other targets stay as they were');
  assert.deepEqual(m.twitchState(cfg), { exists: true, enabled: true, hasKey: true, ownEncoder: true, keyintSec: 2, syncStart: true });
});

test('upsertTwitch edits an existing Twitch target in place', () => {
  const mine = {
    id: '222', name: 'My Twitch', protocol: 'RTMP',
    'service-param': { server: 'rtmp://jfk.contribute.live-video.net/app', key: 'old' },
    'sync-start': false, 'sync-stop': false, enabled: false,
  };
  const before = { targets: [youtube, mine], video_configs: [], audio_configs: [] };
  const off = m.upsertTwitch(before, { key: 'new-key-123' });
  assert.equal(off.targets.length, 2);
  assert.equal(off.targets[1]['service-param'].key, 'new-key-123');
  assert.equal(off.targets[1]['service-param'].server, 'rtmp://jfk.contribute.live-video.net/app');
  assert.equal(off.targets[1].enabled, false);
  assert.equal(before.targets[1]['service-param'].key, 'old', 'the input is not changed');
  const on = m.upsertTwitch(off, { enabled: true });
  assert.equal(on.targets[1].enabled, true);
  assert.equal(on.targets[1]['sync-start'], true);
  assert.equal(m.twitchState(on).ownEncoder, false);
});

test('findTwitchTarget knows Twitch ingest servers and a target named Twitch', () => {
  const t = (server, name = 'x') => ({ targets: [{ id: '1', name, 'service-param': { server } }], video_configs: [], audio_configs: [] });
  assert.ok(m.findTwitchTarget(t('rtmp://live.twitch.tv/app')));
  assert.ok(m.findTwitchTarget(t('rtmps://live.twitch.tv:443/app')));
  assert.ok(m.findTwitchTarget(t('rtmp://ingest.global-contribute.live-video.net/app')));
  assert.ok(m.findTwitchTarget(t('rtmp://example.com/app', 'Twitch')));
  assert.equal(m.findTwitchTarget(t('rtmp://nottwitch.tv.example.com/app')), null);
  assert.equal(m.findTwitchTarget(t('rtmp://a.rtmp.youtube.com/live2')), null);
});

test('readConfig and writeConfig round-trip, owner-only, with no temp file left', (t) => {
  const { profile } = tmpObsConfig(t);
  const p = profile('TikTok_Vertical', 'TikTok Vertical');
  assert.deepEqual(m.readConfig(p), { targets: [], video_configs: [], audio_configs: [] });
  const cfg = m.upsertTwitch(m.readConfig(p), { key: 'k-12345678' });
  m.writeConfig(p, cfg);
  assert.deepEqual(m.readConfig(p), cfg);
  assert.equal(fs.statSync(path.join(p, m.FILE)).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(p).sort(), ['basic.ini', m.FILE]);
  // The OBS plugin writes its file with a byte order mark.
  fs.writeFileSync(path.join(p, m.FILE), `\uFEFF${JSON.stringify(cfg)}`);
  assert.deepEqual(m.readConfig(p), cfg);
  fs.writeFileSync(path.join(p, m.FILE), '{ not json');
  assert.throws(() => m.readConfig(p), SyntaxError);
});

test('reloadProfile hops to another profile and back', async () => {
  const calls = [];
  const obs = {
    call: async (type, data) => {
      calls.push([type, data?.profileName]);
      return type === 'GetProfileList' ? { profiles: ['TikTok Vertical', 'Untitled'] } : {};
    },
  };
  assert.equal(await m.reloadProfile(obs, 'TikTok Vertical'), true);
  assert.deepEqual(calls.slice(1), [['SetCurrentProfile', 'Untitled'], ['SetCurrentProfile', 'TikTok Vertical']]);
  const lonely = { call: async () => ({ profiles: ['TikTok Vertical'] }) };
  assert.equal(await m.reloadProfile(lonely, 'TikTok Vertical'), false);
});
