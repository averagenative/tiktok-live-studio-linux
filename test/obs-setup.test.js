'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTikTok, abgr, sceneLayouts } = require('../src/obs-setup');

// A fake obs-websocket that keeps just enough state to answer the setup.
function fakeObs({ profiles = ['Untitled'], collections = ['Untitled'], special = {} } = {}) {
  const calls = [];
  const st = {
    profile: profiles[0], profiles: [...profiles], collections: [...collections],
    scenes: new Map([['Scene', []]]), inputs: new Map(), filters: new Map(), next: 0, special,
  };
  const addItem = (sceneName, sourceName) => {
    const sceneItemId = ++st.next;
    st.scenes.get(sceneName).push({ sourceName, sceneItemId });
    return { sceneItemId };
  };
  const handlers = {
    GetStreamStatus: () => ({ outputActive: false }),
    GetProfileList: () => ({ currentProfileName: st.profile, profiles: st.profiles }),
    CreateProfile: ({ profileName }) => { st.profiles.push(profileName); st.profile = profileName; },
    SetCurrentProfile: ({ profileName }) => { st.profile = profileName; },
    SetProfileParameter: () => ({}),
    GetVideoSettings: () => ({ baseWidth: 1080, baseHeight: 1920 }),
    GetSceneCollectionList: () => ({ sceneCollections: st.collections }),
    CreateSceneCollection: ({ sceneCollectionName }) => { st.collections.push(sceneCollectionName); },
    SetCurrentSceneCollection: () => ({}),
    GetSceneList: () => ({ scenes: [...st.scenes.keys()].map((sceneName) => ({ sceneName })) }),
    CreateScene: ({ sceneName }) => { st.scenes.set(sceneName, []); },
    RemoveScene: ({ sceneName }) => { st.scenes.delete(sceneName); },
    GetInputKindList: () => ({ inputKinds: ['pipewire-window-capture-source', 'pipewire-screen-capture-source', 'v4l2_input'] }),
    GetInputList: () => ({ inputs: [...st.inputs].map(([inputName, inputKind]) => ({ inputName, inputKind })) }),
    GetSpecialInputs: () => st.special,
    GetSceneItemList: ({ sceneName }) => ({
      sceneItems: st.scenes.get(sceneName).map((i) => ({
        sceneItemTransform: { positionX: 10, positionY: 10, scaleX: 1, scaleY: 1, rotation: 0, boundsType: 'OBS_BOUNDS_NONE' }, ...i,
      })),
    }),
    CreateInput: ({ sceneName, inputName, inputKind }) => { st.inputs.set(inputName, inputKind); return addItem(sceneName, inputName); },
    CreateSceneItem: ({ sceneName, sourceName }) => addItem(sceneName, sourceName),
    SetInputName: ({ inputName, newInputName }) => {
      st.inputs.set(newInputName, st.inputs.get(inputName));
      st.inputs.delete(inputName);
      for (const list of st.scenes.values()) for (const i of list) if (i.sourceName === inputName) i.sourceName = newInputName;
    },
    RemoveInput: ({ inputName }) => {
      st.inputs.delete(inputName);
      for (const [k, list] of st.scenes) st.scenes.set(k, list.filter((i) => i.sourceName !== inputName));
    },
    SetSceneItemIndex: ({ sceneName, sceneItemId, sceneItemIndex }) => {
      const list = st.scenes.get(sceneName);
      const at = list.findIndex((i) => i.sceneItemId === sceneItemId);
      const [it] = list.splice(at, 1);
      list.splice(sceneItemIndex, 0, it);
    },
    RemoveSceneItem: ({ sceneName, sceneItemId }) => {
      st.scenes.set(sceneName, st.scenes.get(sceneName).filter((i) => i.sceneItemId !== sceneItemId));
    },
    SetSceneItemTransform: () => ({}),
    GetInputPropertiesListPropertyItems: () => ({ propertyItems: [{ itemName: 'Integrated Camera', itemValue: '/dev/video0', itemEnabled: true }] }),
    SetInputSettings: () => ({}),
    SetCurrentProgramScene: () => ({}),
    GetSourceFilterKindList: () => ({ sourceFilterKinds: ['noise_suppress_filter_v2', 'compressor_filter', 'limiter_filter'] }),
    GetSourceFilterList: ({ sourceName }) => ({ filters: (st.filters.get(sourceName) || []).map((filterName) => ({ filterName })) }),
    CreateSourceFilter: ({ sourceName, filterName }) => { st.filters.set(sourceName, [...(st.filters.get(sourceName) || []), filterName]); },
    SetCurrentSceneTransition: () => ({}),
    SetCurrentSceneTransitionDuration: () => ({}),
  };
  return {
    calls,
    st,
    async call(type, data = {}, opts = {}) {
      calls.push([type, data, opts]);
      if (!handlers[type]) throw new Error(`unexpected request ${type}`);
      return handlers[type](data) || {};
    },
  };
}

const order = (obs, scene) => obs.st.scenes.get(scene).map((i) => i.sourceName);

test('abgr converts #rrggbb to OBS 0xAABBGGRR', () => {
  assert.equal(abgr('#25f4ee'), 0xffeef425);
  assert.equal(abgr('#ffffff'), 0xffffffff);
});

test('setup creates the profile, reloads it, and builds every scene in layer order', async () => {
  const obs = fakeObs();
  const res = await setupTikTok(obs, { handle: 'yourhandle', assetsDir: '/tmp/a' });
  assert.equal(res.created, true);
  assert.deepEqual(res.warnings, []);

  const types = obs.calls.map((c) => c[0]);
  assert.ok(types.includes('CreateProfile'));
  assert.ok(!types.includes('SetVideoSettings'), 'SetVideoSettings hangs on OBS 32.1; must not be used');
  const params = Object.fromEntries(obs.calls.filter((c) => c[0] === 'SetProfileParameter')
    .map(([, d]) => [`${d.parameterCategory}.${d.parameterName}`, d.parameterValue]));
  assert.equal(params['Video.BaseCX'], '1080');
  assert.equal(params['Video.BaseCY'], '1920');
  assert.equal(params['SimpleOutput.StreamEncoder'], 'nvenc');
  const switches = obs.calls.filter((c) => c[0] === 'SetCurrentProfile').map(([, d]) => d.profileName);
  assert.deepEqual(switches, ['Untitled', 'TikTok Vertical'], 'profile is reloaded to apply the canvas');

  const created = obs.calls.filter((c) => c[0] === 'CreateScene').map(([, d]) => d.sceneName);
  assert.equal(created[0], 'Ending', 'scenes are created last-to-first so OBS lists them in order');
  assert.ok(!obs.st.scenes.has('Scene'), 'the empty default scene is removed');
  assert.deepEqual([...obs.st.scenes.keys()].sort(), Object.keys(sceneLayouts({ overlays: true, capture: true, handle: '@x' })).sort());

  const inputs = obs.calls.filter((c) => c[0] === 'CreateInput').map(([, d]) => d.inputName);
  assert.equal(new Set(inputs).size, inputs.length, 'each source is created once and reused');
  assert.equal(inputs.at(-1), 'Screen', 'screen capture is created last');
  const screen = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Screen');
  assert.equal(screen[1].inputKind, 'pipewire-window-capture-source');
  assert.equal(screen[2].timeoutMs, 90000, 'the GNOME picker gets time to answer');
  assert.equal(obs.st.inputs.get('Background'), 'image_source');
  assert.ok(obs.calls.some((c) => c[0] === 'SetInputSettings' && c[1].inputSettings.device_id === '/dev/video0'));

  assert.deepEqual(order(obs, 'Screen + Camera').slice(0, 5), ['Background', 'Screen', 'Webcam', 'Frame: Screen + Camera', 'Handle']);
  for (const scene of obs.st.scenes.keys()) {
    assert.ok(order(obs, scene).includes('Mic') && order(obs, scene).includes('Desktop Audio'), `audio in ${scene}`);
  }
  assert.deepEqual(obs.st.filters.get('Mic'), ['Noise Suppression', 'Compressor', 'Limiter']);
});

test('re-running repairs a half-built collection without touching user items', async () => {
  const obs = fakeObs({ profiles: ['Untitled', 'TikTok Vertical'], collections: ['Untitled', 'TikTok Vertical'] });
  // What the first, interrupted run left: color background, no screen, a leftover default scene.
  obs.st.scenes.set('Screen + Camera', []);
  obs.st.inputs.set('Background', 'color_source_v3');
  obs.st.scenes.get('Screen + Camera').push({ sourceName: 'Background', sceneItemId: 900 });
  obs.st.inputs.set('My Overlay', 'browser_source');
  obs.st.scenes.get('Screen + Camera').push({ sourceName: 'My Overlay', sceneItemId: 901 });

  const res = await setupTikTok(obs, { handle: 'yourhandle', assetsDir: '/tmp/a' });
  assert.equal(res.created, false);
  assert.ok(res.added > 0);
  assert.equal(obs.st.inputs.get('Background'), 'image_source', 'plain background swapped for the artwork');
  assert.ok(!obs.st.inputs.has('Background (old)'));
  const sc = order(obs, 'Screen + Camera');
  assert.deepEqual(sc.slice(0, 5), ['Background', 'Screen', 'Webcam', 'Frame: Screen + Camera', 'Handle']);
  assert.ok(sc.includes('My Overlay'), 'user source kept');
  assert.ok(sc.indexOf('My Overlay') > sc.indexOf('Handle'), 'user source stays above ours');
  assert.ok(!obs.st.scenes.has('Scene'));

  const again = await setupTikTok(obs, { handle: 'yourhandle', assetsDir: '/tmp/a' });
  assert.equal(again.added, 0, 'a third run has nothing left to add');
  assert.deepEqual(obs.st.filters.get('Mic'), ['Noise Suppression', 'Compressor', 'Limiter'], 'filters are not duplicated');
});

test('existing global audio is reused instead of adding our own', async () => {
  const obs = fakeObs({ special: { mic1: 'Mic/Aux', desktop1: 'Desktop Audio' } });
  obs.st.inputs.set('Mic/Aux', 'pulse_input_capture');
  await setupTikTok(obs, { handle: '', assetsDir: '/tmp/a' });
  assert.ok(!obs.calls.some((c) => c[0] === 'CreateInput' && c[1].inputName === 'Mic'));
  assert.deepEqual(obs.st.filters.get('Mic/Aux'), ['Noise Suppression', 'Compressor', 'Limiter']);
});

test('a screen capture that never answers is a warning, not a failure', async () => {
  const obs = fakeObs();
  const orig = obs.call;
  obs.call = async (type, data, opts) => {
    if (type === 'CreateInput' && data.inputName === 'Screen') throw new Error('OBS CreateInput timed out');
    return orig(type, data, opts);
  };
  const res = await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  assert.ok(res.warnings.some((w) => w.includes('Window Capture (PipeWire)')));
  assert.ok(!obs.st.scenes.has('Scene'), 'the rest of the setup still finished');
});

test('with the avatar URL, Screen + Robot puts the game on top and the full robot below', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', avatarUrl: 'http://127.0.0.1:47812/avatar' });
  assert.ok(obs.st.scenes.has('Screen + Robot'));
  assert.deepEqual(order(obs, 'Screen + Robot').slice(0, 5), ['Background', 'Screen', 'Frame: Screen + Robot', 'Robot (full)', 'Handle']);
  const robot = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Robot (full)')[1];
  assert.equal(robot.inputKind, 'browser_source');
  assert.equal(robot.inputSettings.url, 'http://127.0.0.1:47812/avatar');
  assert.equal(robot.inputSettings.width, 1080);
  assert.equal(robot.inputSettings.height, 1130);
  const t = obs.calls.find((c) => c[0] === 'SetSceneItemTransform' && c[1].sceneName === 'Screen + Robot'
    && c[1].sceneItemTransform.positionY === 790);
  assert.ok(t, 'robot sits under the game window');
});

test('without the avatar URL there is no robot scene', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  assert.ok(!obs.st.scenes.has('Screen + Robot'));
});

test('setup refuses to run while OBS is streaming', async () => {
  const obs = fakeObs();
  obs.call = async (type) => (type === 'GetStreamStatus' ? { outputActive: true } : {});
  await assert.rejects(setupTikTok(obs, {}), /Stop streaming/);
});

test('a hand-added Screen at the default spot gets our layout; moved items are left alone', async () => {
  const obs = fakeObs({ profiles: ['Untitled', 'TikTok Vertical'], collections: ['Untitled', 'TikTok Vertical'] });
  const fresh = { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, boundsType: 'OBS_BOUNDS_NONE' };
  obs.st.scenes.set('Screen + Camera', [{ sourceName: 'Screen', sceneItemId: 700, sceneItemTransform: fresh }]);
  obs.st.scenes.set('Camera', [{ sourceName: 'Webcam', sceneItemId: 701,
    sceneItemTransform: { ...fresh, positionX: 300, positionY: 900 } }]);
  obs.st.inputs.set('Screen', 'pipewire-screen-capture-source');
  obs.st.inputs.set('Webcam', 'v4l2_input');
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  const t = (id) => obs.calls.filter((c) => c[0] === 'SetSceneItemTransform' && c[1].sceneItemId === id);
  assert.equal(t(700).length, 1, 'default-placed Screen is laid out');
  assert.equal(t(700)[0][1].sceneItemTransform.boundsType, 'OBS_BOUNDS_SCALE_OUTER');
  assert.equal(t(701).length, 0, 'moved Webcam is not touched');
  assert.ok(order(obs, 'Screen').includes('Screen'), 'existing Screen input is added to the other scene');
});
