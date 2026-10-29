'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startAvatarServer, levelFromMeter, pickMic } = require('../src/avatar-server');
const fs = require('node:fs');
const path = require('node:path');
const { setAvatar, setAvatarUrl, HOLES } = require('../src/obs-setup');

test('levelFromMeter maps -50..-10 dBFS onto 0..1 using the loudest channel', () => {
  const db = (d) => 10 ** (d / 20);
  assert.equal(levelFromMeter([]), 0);
  assert.equal(levelFromMeter([[0, 0, 0]]), 0);
  assert.equal(levelFromMeter([[db(-60), 0, 0]]), 0);
  assert.equal(levelFromMeter([[db(-5), 0, 0]]), 1);
  assert.ok(Math.abs(levelFromMeter([[db(-30), 0, 0], [db(-40), 0, 0]]) - 0.5) < 1e-9);
});

test('pickMic prefers the configured name, then Mic, then Mic/Aux, then anything mic-like', () => {
  const ins = (...n) => n.map((inputName) => ({ inputName }));
  assert.equal(pickMic(ins('Desktop Audio', 'Mic', 'Headset'), 'Headset'), 'Headset');
  assert.equal(pickMic(ins('Desktop Audio', 'Mic/Aux', 'Mic')), 'Mic');
  assert.equal(pickMic(ins('Desktop Audio', 'Mic/Aux')), 'Mic/Aux');
  assert.equal(pickMic(ins('Desktop Audio', 'USB Microphone')), 'USB Microphone');
  assert.equal(pickMic(ins('Desktop Audio')), null);
});

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', reject);
});

test('avatar server serves the page and streams levels as SSE', async () => {
  const srv = startAvatarServer({ port: 47898 });
  try {
    assert.equal(await srv.ready, true);
    const page = await get('http://127.0.0.1:47898/avatar');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /engine\.js/);
    for (const p of ['/engine.js', '/avatars/robot.js', '/avatars/cat.js', '/avatar/avatars/fox.js', '/avatar/engine.js']) {
      const js = await get(`http://127.0.0.1:47898${p}`);
      assert.equal(js.status, 200, p);
      assert.match(js.type, /javascript/, p);
    }
    for (const p of ['/nope', '/main.js', '/avatars/../avatar-server.js', '/avatar/../main.js', '/avatar/index.html/']) {
      assert.equal((await get(`http://127.0.0.1:47898${p}`)).status, 404, p);
    }

    const frames = await new Promise((resolve, reject) => {
      const got = [];
      const req = http.get('http://127.0.0.1:47898/events', (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        res.on('data', (c) => {
          for (const m of String(c).matchAll(/data: (\{.*?\})/g)) got.push(JSON.parse(m[1]).l);
          if (got.length >= 2) {
            req.destroy();
            resolve(got);
          }
        });
        setTimeout(() => srv.push(0.75), 50);
      });
      req.on('error', (e) => (e.code === 'ECONNRESET' ? resolve(got) : reject(e)));
    });
    assert.equal(frames[0], 0, 'initial frame is the current level');
    assert.equal(frames[1], 0.75);
  } finally {
    srv.close();
  }
});

function fakeObs(extra = []) {
  const calls = [];
  const scenes = new Map([
    ['Camera', [{ sourceName: 'Background', sceneItemId: 1 }, { sourceName: 'Webcam', sceneItemId: 2 }, { sourceName: 'Frame: Camera', sceneItemId: 3 }]],
    ['Screen + Camera', [{ sourceName: 'Background', sceneItemId: 4 }, { sourceName: 'Webcam', sceneItemId: 5 }, { sourceName: 'Frame: Screen + Camera', sceneItemId: 6 }]],
  ]);
  const inputs = new Set(['Background', 'Webcam', 'Frame: Camera', 'Frame: Screen + Camera', ...extra]);
  const enabled = new Map();
  let next = 10;
  const h = {
    GetSceneList: () => ({ scenes: [...scenes.keys()].map((sceneName) => ({ sceneName })) }),
    GetInputList: () => ({ inputs: [...inputs].map((inputName) => ({ inputName })) }),
    GetSceneItemList: ({ sceneName }) => ({ sceneItems: scenes.get(sceneName).map((i, idx) => ({ ...i, sceneItemIndex: idx })) }),
    CreateInput: ({ sceneName, inputName }) => {
      inputs.add(inputName);
      const it = { sourceName: inputName, sceneItemId: ++next };
      scenes.get(sceneName).push(it);
      return { sceneItemId: it.sceneItemId };
    },
    CreateSceneItem: ({ sceneName, sourceName }) => {
      const it = { sourceName, sceneItemId: ++next };
      scenes.get(sceneName).push(it);
      return { sceneItemId: it.sceneItemId };
    },
    SetInputSettings: () => ({}),
    SetSceneName: ({ sceneName, newSceneName }) => {
      scenes.set(newSceneName, scenes.get(sceneName));
      scenes.delete(sceneName);
    },
    SetInputName: ({ inputName, newInputName }) => {
      inputs.delete(inputName);
      inputs.add(newInputName);
      for (const list of scenes.values()) for (const i of list) if (i.sourceName === inputName) i.sourceName = newInputName;
    },
    SetSceneItemTransform: () => ({}),
    SetSceneItemIndex: ({ sceneName, sceneItemId, sceneItemIndex }) => {
      const list = scenes.get(sceneName);
      const [it] = list.splice(list.findIndex((i) => i.sceneItemId === sceneItemId), 1);
      list.splice(sceneItemIndex, 0, it);
    },
    SetSceneItemEnabled: ({ sceneName, sceneItemId, sceneItemEnabled }) => {
      const name = scenes.get(sceneName).find((i) => i.sceneItemId === sceneItemId).sourceName;
      enabled.set(`${sceneName}/${name}`, sceneItemEnabled);
    },
  };
  return {
    calls, scenes, enabled,
    async call(type, data = {}) {
      calls.push([type, data]);
      if (!h[type]) throw new Error(`unexpected ${type}`);
      return h[type](data) || {};
    },
  };
}

test('the avatar goes right above the webcam, hides it, and toggles back', async () => {
  const obs = fakeObs();
  await setAvatar(obs, { enabled: true, url: 'http://127.0.0.1:47812/avatar' });
  assert.deepEqual(obs.scenes.get('Camera').map((i) => i.sourceName), ['Background', 'Webcam', 'Avatar', 'Frame: Camera']);
  assert.deepEqual(obs.scenes.get('Screen + Camera').map((i) => i.sourceName), ['Background', 'Webcam', 'Avatar (wide)', 'Frame: Screen + Camera']);
  assert.equal(obs.enabled.get('Camera/Avatar'), true);
  assert.equal(obs.enabled.get('Camera/Webcam'), false);
  const created = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Avatar')[1];
  assert.equal(created.inputKind, 'browser_source');
  assert.equal(created.inputSettings.width, HOLES.camera.w + 8);
  assert.equal(created.inputSettings.url, 'http://127.0.0.1:47812/avatar');

  const before = obs.calls.filter((c) => c[0] === 'CreateInput').length;
  await setAvatar(obs, { enabled: false, url: 'http://127.0.0.1:47812/avatar' });
  assert.equal(obs.calls.filter((c) => c[0] === 'CreateInput').length, before, 'toggling off creates nothing');
  assert.equal(obs.enabled.get('Camera/Avatar'), false);
  assert.equal(obs.enabled.get('Camera/Webcam'), true);
  assert.equal(obs.enabled.get('Screen + Camera/Webcam'), true);
});

test('the avatar needs the TikTok scenes', async () => {
  const obs = { call: async (t) => (t === 'GetSceneList' ? { scenes: [{ sceneName: 'Scene' }] } : {}) };
  await assert.rejects(setAvatar(obs, { enabled: true, url: 'x' }), /Set up TikTok scenes/);
});

test('a 0.1.0 Robot source is renamed and reused, and switching avatars repoints every source', async () => {
  const old = fakeObs(['Robot (wide)']);
  old.scenes.get('Screen + Camera').splice(2, 0, { sourceName: 'Robot (wide)', sceneItemId: 51 });
  assert.deepEqual(await setAvatarUrl(old, 'u'), ['Avatar (wide)'], 'switching alone also renames');

  const obs = fakeObs(['Robot']);
  obs.scenes.get('Camera').splice(2, 0, { sourceName: 'Robot', sceneItemId: 50 });
  await setAvatar(obs, { enabled: true, url: 'http://127.0.0.1:47812/avatar?avatar=fox' });
  assert.deepEqual(obs.scenes.get('Camera').map((i) => i.sourceName), ['Background', 'Webcam', 'Avatar', 'Frame: Camera']);
  assert.ok(!obs.calls.some((c) => c[0] === 'CreateInput' && c[1].inputName === 'Avatar'), 'renamed, not recreated');
  const switched = await setAvatarUrl(obs, 'http://127.0.0.1:47812/avatar?avatar=panda');
  assert.deepEqual(switched.sort(), ['Avatar', 'Avatar (wide)']);
  assert.ok(obs.calls.some((c) => c[0] === 'SetInputSettings' && c[1].inputName === 'Avatar (wide)' && c[1].inputSettings.url.endsWith('panda')));
});

test('every avatar in the menu has a file that registers it, and the page loads it', () => {
  const dir = path.join(__dirname, '..', 'src');
  const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
  const page = read('avatar', 'index.html');
  const menu = read('renderer', 'index.html').split('<select id="avatar-kind"')[1].split('</select>')[0];
  const kinds = [...menu.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['robot', 'cat', 'fox', 'panda']);
  assert.ok(read('main.js').includes(`const AVATARS = [${kinds.map((k) => `'${k}'`).join(', ')}];`), 'main.js knows the same avatars');
  for (const k of kinds) {
    const src = read('avatar', 'avatars', `${k}.js`);
    assert.ok(src.includes(`window.AVATARS.${k} =`) || src.includes(`(window.AVATARS = window.AVATARS || {}).${k} =`), `${k}.js registers itself`);
    assert.ok(page.includes(`<script src="avatars/${k}.js"></script>`), `the page loads ${k}.js`);
  }
  assert.ok(page.indexOf('avatars/critter.js') < page.indexOf('avatars/cat.js'), 'the builder loads before the animals');
  assert.ok(page.indexOf('engine.js') > page.indexOf('avatars/panda.js'), 'the engine loads last');
});
