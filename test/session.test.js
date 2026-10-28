'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LiveSession } = require('../src/session');
const { RoomStatus, PingStatus } = require('../src/util');

const ROOM = {
  id_str: '7400000000000000001',
  stream_id_str: '1800000000000000002',
  title: 'test',
  owner: { display_id: 'me' },
  living_room_attrs: { room_id_str: '7400000000000000001' },
  stream_url: { rtmp_push_url: 'rtmp://push.example/live/stream-1?sign=z' },
};

function fakeApi({ createBody = { status_code: 0, data: ROOM }, pingCode = 0 } = {}) {
  const calls = { create: [], ping: [] };
  return {
    calls,
    async createRoom(fields) {
      calls.create.push(fields);
      return createBody;
    },
    async pingAnchor(p) {
      calls.ping.push(p);
      return { status_code: typeof pingCode === 'function' ? pingCode(p) : pingCode };
    },
  };
}

function fakeObs() {
  const obs = new EventEmitter();
  obs.connected = true;
  obs.calls = [];
  const rec = (name, value = {}) => async (...args) => {
    obs.calls.push([name, ...args]);
    return value;
  };
  obs.getStreamStatus = rec('GetStreamStatus', { outputActive: false });
  obs.getStreamService = rec('GetStreamServiceSettings', { streamServiceType: 'rtmp_common', streamServiceSettings: { service: 'Twitch' } });
  obs.setCustomRtmp = rec('SetCustomRtmp');
  obs.setStreamService = rec('SetStreamServiceSettings');
  obs.getVideoSettings = rec('GetVideoSettings', { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 });
  obs.setVideoSettings = rec('SetVideoSettings');
  obs.startStream = rec('StartStream');
  obs.stopStream = rec('StopStream');
  return obs;
}

const tick = () => new Promise((r) => setImmediate(r));

test('full LIVE: create, drive OBS, go living on stream start, finish and restore OBS', async () => {
  const api = fakeApi();
  const obs = fakeObs();
  const s = new LiveSession({ api, obs });

  await s.goLive({ title: 'hi', hashtagId: 5, setCanvas: true });
  assert.equal(s.state, 'preparing');
  assert.equal(api.calls.create[0].title, 'hi');
  assert.equal(api.calls.create[0].live_studio, 1);
  assert.equal(api.calls.create[0].hashtag_id, 5);
  assert.deepEqual(obs.calls.find((c) => c[0] === 'SetCustomRtmp').slice(1), ['rtmp://push.example/live/', 'stream-1?sign=z']);
  assert.deepEqual(obs.calls.find((c) => c[0] === 'SetVideoSettings')[1], { baseWidth: 1080, baseHeight: 1920, outputWidth: 1080, outputHeight: 1920 });
  assert.ok(obs.calls.some((c) => c[0] === 'StartStream'));

  await tick();
  assert.equal(api.calls.ping[0].status, RoomStatus.prepare);
  assert.equal(api.calls.ping[0].roomId, ROOM.living_room_attrs.room_id_str);

  obs.emit('stream', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
  await tick();
  assert.equal(s.state, 'live');
  assert.equal(api.calls.ping.at(-1).status, RoomStatus.living);

  await s.endLive();
  assert.equal(s.state, 'ended');
  assert.equal(api.calls.ping.at(-1).status, RoomStatus.finish);
  assert.ok(obs.calls.some((c) => c[0] === 'StopStream'));
  const restore = obs.calls.filter((c) => c[0] === 'SetStreamServiceSettings').at(-1);
  assert.deepEqual(restore.slice(1), ['rtmp_common', { service: 'Twitch' }]);
  assert.deepEqual(obs.calls.filter((c) => c[0] === 'SetVideoSettings').at(-1)[1],
    { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 });
  assert.equal(s.timer, null);
});

test('create refusal surfaces TikTok message and never touches OBS', async () => {
  const api = fakeApi({ createBody: { status_code: 4003110, data: { prompts: 'You are not eligible to go LIVE' } } });
  const obs = fakeObs();
  const s = new LiveSession({ api, obs });
  await assert.rejects(s.goLive({ title: 'x' }), /not eligible/);
  assert.equal(s.state, 'error');
  assert.ok(!obs.calls.some((c) => c[0] === 'StartStream'));
  assert.equal(api.calls.ping.length, 0);
});

test('room without an RTMP URL is finished right away', async () => {
  const data = { ...ROOM, stream_url: { push_urls: ['rtmpq://only/bytedance/proto'] } };
  const api = fakeApi({ createBody: { status_code: 0, data } });
  const s = new LiveSession({ api, obs: fakeObs() });
  await assert.rejects(s.goLive({ title: 'x' }), /no RTMP push URL/);
  assert.equal(api.calls.ping.at(-1).status, RoomStatus.finish);
});

test('manual mode waits for the user, then pings living', async () => {
  const api = fakeApi();
  const obs = fakeObs();
  obs.connected = false;
  const s = new LiveSession({ api, obs });
  await s.goLive({ title: 'x', driveObs: false });
  assert.equal(s.state, 'preparing');
  assert.equal(obs.calls.length, 0);
  s.markStreaming();
  await tick();
  assert.equal(s.state, 'live');
  assert.equal(api.calls.ping.at(-1).status, RoomStatus.living);
  await s.endLive();
  assert.equal(obs.calls.length, 0);
});

test('drive mode requires an OBS connection', async () => {
  const obs = fakeObs();
  obs.connected = false;
  const s = new LiveSession({ api: fakeApi(), obs });
  await assert.rejects(s.goLive({ title: 'x' }), /Connect to OBS/);
});

test('server-side finish stops OBS and ends the session', async () => {
  const api = fakeApi({ pingCode: (p) => (p.status === RoomStatus.living ? PingStatus.RoomHasFinished : 0) });
  const obs = fakeObs();
  const s = new LiveSession({ api, obs });
  await s.goLive({ title: 'x' });
  obs.emit('stream', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
  await tick();
  await tick();
  assert.equal(s.state, 'ended');
  assert.ok(obs.calls.some((c) => c[0] === 'StopStream'));
});

test('OBS stopping the stream ends the LIVE', async () => {
  const api = fakeApi();
  const obs = fakeObs();
  const s = new LiveSession({ api, obs });
  await s.goLive({ title: 'x' });
  obs.emit('stream', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
  await tick();
  obs.emit('stream', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
  await tick();
  await tick();
  assert.equal(s.state, 'ended');
  assert.equal(api.calls.ping.at(-1).status, RoomStatus.finish);
});
