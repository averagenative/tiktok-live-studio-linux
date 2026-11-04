'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PluginHost } = require('../src/plugins/host');
const rtmp = require('../src/plugins/twitch/multi-rtmp');
const twitchPlugin = require('../src/plugins/twitch');
const launchPlugin = require('../src/plugins/launch-obs');

const settle = async (n = 3) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

function memoryStore() {
  const s = { enabled: {}, data: {}, secrets: {} };
  return {
    s,
    enabled: (id) => s.enabled[id],
    setEnabled: (id, on) => { s.enabled[id] = on; },
    data: (id) => s.data[id] || {},
    setData: (id, obj) => { s.data[id] = obj; },
    secret: (id, name) => s.secrets[id]?.[name] || '',
    setSecret: (id, name, v) => { s.secrets[id] = { ...(s.secrets[id] || {}), [name]: v || undefined }; },
  };
}

// A stand-in OBS: answers the requests the plugins make.
function fakeObs({ current = 'TikTok Vertical', profiles = ['TikTok Vertical', 'Untitled'], streaming = false } = {}) {
  const obs = new EventEmitter();
  obs.connected = true;
  obs.state = { current, profiles, streaming, output: null };
  obs.calls = [];
  obs.call = async (type, data = {}) => {
    obs.calls.push([type, data]);
    switch (type) {
      case 'GetProfileList': return { currentProfileName: obs.state.current, profiles: obs.state.profiles };
      case 'SetCurrentProfile': obs.state.current = data.profileName; return {};
      case 'GetStreamStatus': return { outputActive: obs.state.streaming };
      case 'GetOutputStatus':
        if (!obs.state.output) throw new Error('OBS GetOutputStatus failed: No output was found');
        return obs.state.output;
      default: return {};
    }
  };
  return obs;
}

function setup(t, { obs = fakeObs(), settings = {}, running = false, data = {}, tokens = null, plugin = 'twitch' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-plug-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const profileDir = path.join(dir, 'basic', 'profiles', 'TikTok_Vertical');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'basic.ini'), '[General]\nName=TikTok Vertical\n');
  fs.writeFileSync(path.join(dir, 'user.ini'), '[Basic]\nProfile=TikTok Vertical\n');
  const files = {
    ...rtmp,
    configDirs: () => [dir],
    locateProfile: (name) => {
      const p = rtmp.findProfileDir(dir, name);
      return p ? { configDir: dir, profileDir: p } : null;
    },
    pluginInstalled: () => true,
  };
  const fetchCalls = [];
  const fetch = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), opts });
    if (String(url).includes('/validate')) return { status: 200, text: async () => JSON.stringify({ login: 'me', user_id: '42' }) };
    return { status: 204, text: async () => '' };
  };
  const live = new EventEmitter();
  live.snapshot = () => ({ state: live.state || 'idle', room: live.room || null });
  const pinCalls = [];
  const store = memoryStore();
  store.s.enabled[plugin] = true;
  store.s.data[plugin] = data;
  if (tokens) store.s.secrets.twitch = { tokens: JSON.stringify(tokens) };
  const launches = [];
  const plugins = plugin === 'twitch'
    ? [twitchPlugin.create({ fetch, running: () => running, files, isLocal: async (h) => ['127.0.0.1', '192.168.88.68'].includes(h) })]
    : [launchPlugin.create({
      find: () => [{ kind: 'native', label: 'OBS (installed package)', cmd: '/usr/bin/obs', args: [] }],
      running: () => running,
      launch: async (install, o) => { launches.push(o); return { cmd: install.cmd, args: [] }; },
    })];
  const connects = [];
  const host = new PluginHost({
    plugins,
    store,
    log: () => {},
    deps: {
      obs,
      live,
      obsConnect: async () => { connects.push(1); },
      obsState: () => ({ connected: obs.connected }),
      app: {
        starting: () => !!settings.starting,
        settings: () => ({ obsHost: '127.0.0.1', useTikTokProfile: true, ...settings }),
        profileForLive: () => ((settings.useTikTokProfile ?? true) ? 'TikTok Vertical' : null),
        openExternal: async (url) => { pinCalls.push(['open', url]); },
        pin: { setExtra: (x) => pinCalls.push(['extra', x]), open: () => pinCalls.push(['show']), state: () => ({}) },
      },
    },
  });
  t.after(() => host.stop());
  const card = () => host.cards()[plugin];
  const find = (items, id) => {
    for (const it of items || []) {
      if (it.id === id) return it;
      const inner = find(it.items, id);
      if (inner) return inner;
    }
    return null;
  };
  const texts = () => JSON.stringify(card());
  return { host, obs, live, store, profileDir, card, item: (id) => find(card()?.items, id), texts, fetchCalls, pinCalls, launches, connects };
}

test('saving the Twitch key writes the OBS profile and makes OBS reload it', async (t) => {
  const s = setup(t);
  await s.host.start();
  await settle();
  assert.match(s.texts(), /No Twitch target/);
  await s.host.action('twitch', 'key', 'live_123456789_abcdef');
  const cfg = rtmp.readConfig(s.profileDir);
  assert.equal(rtmp.findTwitchTarget(cfg)['service-param'].key, 'live_123456789_abcdef');
  const hops = s.obs.calls.filter(([c]) => c === 'SetCurrentProfile').map(([, d]) => d.profileName);
  assert.deepEqual(hops, ['Untitled', 'TikTok Vertical']);
  assert.match(s.texts(), /Ready: Twitch starts and stops with your TikTok stream/);
  assert.equal(s.item('enabled').checked, true);

  await s.host.action('twitch', 'enabled', false);
  assert.equal(rtmp.twitchState(rtmp.readConfig(s.profileDir)).enabled, false);
  assert.equal(s.item('enabled').checked, false);
});

test('a profile OBS does not have open is written without a hop', async (t) => {
  const s = setup(t, { obs: fakeObs({ current: 'Untitled' }) });
  await s.host.start();
  await s.host.action('twitch', 'key', 'live_123456789_abcdef');
  assert.equal(s.obs.calls.some(([c]) => c === 'SetCurrentProfile'), false);
  assert.ok(rtmp.twitchState(rtmp.readConfig(s.profileDir)).hasKey);
});

test('the Twitch target is left alone while streaming or when OBS would overwrite it', async (t) => {
  const busy = setup(t, { obs: fakeObs({ streaming: true }) });
  await busy.host.start();
  await assert.rejects(busy.host.action('twitch', 'key', 'live_123456789_abcdef'), /after the LIVE ends|after it stops/);

  const disconnected = fakeObs();
  disconnected.connected = false;
  const open = setup(t, { obs: disconnected, running: true });
  await open.host.start();
  await assert.rejects(open.host.action('twitch', 'key', 'live_123456789_abcdef'), /OBS is open but not connected/);
  assert.equal(fs.existsSync(path.join(open.profileDir, rtmp.FILE)), false);

  const lonely = setup(t, { obs: fakeObs({ profiles: ['TikTok Vertical'] }) });
  await lonely.host.start();
  await assert.rejects(lonely.host.action('twitch', 'key', 'live_123456789_abcdef'), /second profile/);

  const lan = setup(t, { settings: { obsHost: '192.168.88.68' } });
  await lan.host.start();
  await settle();
  assert.doesNotMatch(lan.texts(), /another computer/, "this computer's own LAN address counts as local");
  assert.ok(lan.item('key'), 'the key field shows');

  const remote = setup(t, { settings: { obsHost: '192.168.1.20' } });
  await remote.host.start();
  await settle();
  assert.match(remote.texts(), /OBS runs on another computer/);
});

test('while OBS streams, the card shows the Twitch output health', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const s = setup(t);
  rtmp.writeConfig(s.profileDir, rtmp.upsertTwitch(rtmp.readConfig(s.profileDir), { key: 'live_123456789_abcdef' }));
  await s.host.start();
  await settle();
  s.obs.state.output = { outputActive: true, outputReconnecting: false, outputBytes: 0, outputTotalFrames: 100, outputSkippedFrames: 0, outputCongestion: 0 };
  s.obs.state.streaming = true;
  s.obs.emit('stream', { outputActive: true });
  await settle();
  s.obs.state.output = { ...s.obs.state.output, outputBytes: 1500000, outputTotalFrames: 160 };
  t.mock.timers.tick(2000);
  await settle();
  assert.match(s.texts(), /Twitch: streaming, 6\.0 Mbps/);
  s.obs.state.output = { ...s.obs.state.output, outputReconnecting: true };
  t.mock.timers.tick(2000);
  await settle();
  assert.match(s.texts(), /Twitch: reconnecting/);
  s.obs.emit('stream', { outputActive: false });
  await settle();
  assert.doesNotMatch(s.texts(), /Twitch: (streaming|reconnecting)/);
});

test('going LIVE sends the TikTok title and category to Twitch', async (t) => {
  const s = setup(t, {
    settings: { lastTitle: ' Ranked grind ' },
    data: { syncTitle: true, categoryId: '509658', categoryName: 'Just Chatting', clientId: 'abcdefghij0123456789' },
    tokens: { access: 'at', refresh: 'rt', login: 'me', userId: '42' },
  });
  rtmp.writeConfig(s.profileDir, rtmp.upsertTwitch(rtmp.readConfig(s.profileDir), { key: 'live_123456789_abcdef' }));
  await s.host.start();
  await settle(6);
  s.live.state = 'preparing';
  s.live.room = { title: 'Ranked grind' };
  s.live.emit('state', s.live.snapshot());
  await settle(6);
  const patch = s.fetchCalls.find((c) => c.opts.method === 'PATCH');
  assert.ok(patch, 'PATCHed the channel');
  assert.match(patch.url, /broadcaster_id=42/);
  assert.deepEqual(JSON.parse(patch.opts.body), { title: 'Ranked grind', game_id: '509658' }, 'the typed title, trimmed');
});

test('a blank TikTok title leaves the Twitch title alone', async (t) => {
  const s = setup(t, {
    settings: { lastTitle: '' },
    data: { syncTitle: true, clientId: 'abcdefghij0123456789' },
    tokens: { access: 'at', refresh: 'rt', login: 'me', userId: '42' },
  });
  rtmp.writeConfig(s.profileDir, rtmp.upsertTwitch(rtmp.readConfig(s.profileDir), { key: 'live_123456789_abcdef' }));
  await s.host.start();
  await settle(6);
  s.live.state = 'preparing';
  s.live.room = { title: 'LIVE' };
  s.live.emit('state', s.live.snapshot());
  await settle(6);
  assert.equal(s.fetchCalls.some((c) => c.opts.method === 'PATCH'), false);
});

test('no title is sent when Twitch is off for this LIVE', async (t) => {
  const s = setup(t, { data: { clientId: 'abcdefghij0123456789' }, tokens: { access: 'at', refresh: 'rt', login: 'me', userId: '42' } });
  rtmp.writeConfig(s.profileDir, rtmp.upsertTwitch(rtmp.readConfig(s.profileDir), { key: 'live_123456789_abcdef', enabled: false }));
  await s.host.start();
  await settle(6);
  s.live.state = 'preparing';
  s.live.room = { title: 'x' };
  s.live.emit('state', s.live.snapshot());
  await settle(6);
  assert.equal(s.fetchCalls.some((c) => c.opts.method === 'PATCH'), false);
});

test('the chat layout drives the pinned window pane', async (t) => {
  const s = setup(t, { data: { chatMode: 'split', channel: 'averagenative' } });
  await s.host.start();
  await settle();
  const { css, ...pane } = s.pinCalls.find(([k]) => k === 'extra')[1];
  assert.deepEqual(pane, { url: 'https://www.twitch.tv/popout/averagenative/chat?popout=', partition: 'persist:twitch', mode: 'split' });
  assert.match(css, /--lsl-alpha/, 'the chat pane follows Panel background');
  await s.host.action('twitch', 'chatMode', 'twitch');
  assert.equal(s.pinCalls.filter(([k]) => k === 'extra').at(-1)[1].mode, 'only');
  await s.host.action('twitch', 'openChat');
  assert.deepEqual(s.pinCalls.at(-1), ['show']);
  await s.host.action('twitch', 'chatMode', 'tiktok');
  assert.equal(s.pinCalls.filter(([k]) => k === 'extra').at(-1)[1], null);
  // With Twitch chat off, Open Twitch chat turns it on under the TikTok comments.
  await s.host.action('twitch', 'openChat');
  assert.equal(s.pinCalls.filter(([k]) => k === 'extra').at(-1)[1].mode, 'split');
  assert.deepEqual(s.pinCalls.at(-1), ['show']);
  assert.equal(s.item('chatMode').value, 'split');
  await assert.rejects(s.host.action('twitch', 'channel', 'not a name!'), /channel name/);
  await s.host.action('twitch', 'channel', '');
  await assert.rejects(s.host.action('twitch', 'openChat'), /enter your Twitch channel first/);
  assert.equal(s.item('openChat').disabled, true);
  await s.host.setEnabled('twitch', false);
  assert.equal(s.pinCalls.at(-1)[1], null, 'turning the plugin off removes its pane');
});

test('normalizeChannel accepts links and @handles', () => {
  assert.equal(twitchPlugin.normalizeChannel('https://www.twitch.tv/AverageNative'), 'averagenative');
  assert.equal(twitchPlugin.normalizeChannel('@some_one'), 'some_one');
  assert.equal(twitchPlugin.normalizeChannel('twitch.tv/popout/abc_1/chat'), 'abc_1');
  assert.equal(twitchPlugin.normalizeChannel('bad name'), '');
});

test('Launch OBS starts OBS into the TikTok profile and connects', async (t) => {
  const s = setup(t, { plugin: 'launch-obs', data: { minimized: true } });
  await s.host.start();
  await settle();
  assert.match(s.texts(), /OBS isn't running/);
  await s.host.action('launch-obs', 'launch');
  assert.deepEqual(s.launches, [{ minimized: true, profile: 'TikTok Vertical', collection: 'TikTok Vertical' }]);
  assert.equal(s.connects.length, 1);
  assert.equal(s.item('launch').disabled, true);
});

test('Launch OBS only starts OBS on its own at app start', async (t) => {
  const later = setup(t, { plugin: 'launch-obs', data: { autoLaunch: true } });
  await later.host.start();
  await settle();
  assert.equal(later.launches.length, 0);
  const atStart = setup(t, { plugin: 'launch-obs', data: { autoLaunch: true, tiktokProfile: false }, settings: { starting: true } });
  await atStart.host.start();
  await settle();
  assert.deepEqual(atStart.launches, [{ minimized: false, profile: '', collection: '' }]);
  const already = setup(t, { plugin: 'launch-obs', data: { autoLaunch: true }, settings: { starting: true }, running: true });
  await already.host.start();
  await settle();
  assert.equal(already.launches.length, 0);
});
