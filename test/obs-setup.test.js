'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTikTok, abgr, sceneLayouts, TEXT_SOURCES } = require('../src/obs-setup');

// A fake obs-websocket that keeps just enough state to answer the setup.
function fakeObs({ profiles = ['Untitled'], collections = ['Untitled'], special = {}, at = 10 } = {}) {
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
        sceneItemTransform: { positionX: at, positionY: at, scaleX: 1, scaleY: 1, rotation: 0, boundsType: 'OBS_BOUNDS_NONE' }, ...i,
      })),
    }),
    CreateInput: ({ sceneName, inputName, inputKind }) => { st.inputs.set(inputName, inputKind); return addItem(sceneName, inputName); },
    CreateSceneItem: ({ sceneName, sourceName }) => addItem(sceneName, sourceName),
    SetSceneName: ({ sceneName, newSceneName }) => {
      st.scenes.set(newSceneName, st.scenes.get(sceneName));
      st.scenes.delete(sceneName);
    },
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
  assert.deepEqual([...obs.st.scenes.keys()].sort(), Object.keys(sceneLayouts({ art: true, capture: true, handle: '@x' })).sort());

  const inputs = obs.calls.filter((c) => c[0] === 'CreateInput').map(([, d]) => d.inputName);
  assert.equal(new Set(inputs).size, inputs.length, 'each source is created once and reused');
  assert.equal(inputs.at(-1), 'Game Window', 'game capture is created last');
  const screen = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Game Window');
  assert.equal(screen[1].inputKind, 'pipewire-window-capture-source');
  assert.equal(screen[2].timeoutMs, 90000, 'the GNOME picker gets time to answer');
  assert.equal(obs.st.inputs.get('Background'), 'image_source');
  assert.ok(obs.calls.some((c) => c[0] === 'SetInputSettings' && c[1].inputSettings.device_id === '/dev/video0'));

  assert.deepEqual(order(obs, 'Screen + Camera').slice(0, 4), ['Background', 'Game Window', 'Webcam', 'Frame: Screen + Camera']);
  for (const scene of obs.st.scenes.keys()) {
    assert.ok(order(obs, scene).includes(`Frame: ${scene}`), `frame in ${scene}`);
    assert.ok(!order(obs, scene).some((n) => TEXT_SOURCES.includes(n)), `no text sources in ${scene}: the frame has the text`);
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
  assert.deepEqual(sc.slice(0, 4), ['Background', 'Game Window', 'Webcam', 'Frame: Screen + Camera']);
  assert.ok(sc.includes('My Overlay'), 'user source kept');
  assert.ok(sc.indexOf('My Overlay') > sc.indexOf('Frame: Screen + Camera'), 'user source stays above ours');
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
    if (type === 'CreateInput' && data.inputName === 'Game Window') throw new Error('OBS CreateInput timed out');
    return orig(type, data, opts);
  };
  const res = await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  assert.ok(res.warnings.some((w) => w.includes('Window Capture (PipeWire)')));
  assert.ok(!obs.st.scenes.has('Scene'), 'the rest of the setup still finished');
});

test('with the avatar URL, Screen + Avatar puts the game on top and the full avatar below', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', avatarUrl: 'http://127.0.0.1:47812/avatar' });
  assert.ok(obs.st.scenes.has('Screen + Avatar'));
  assert.deepEqual(order(obs, 'Screen + Avatar').slice(0, 4), ['Background', 'Game Window', 'Frame: Screen + Avatar', 'Avatar (full)']);
  const robot = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Avatar (full)')[1];
  assert.equal(robot.inputKind, 'browser_source');
  assert.equal(robot.inputSettings.url, 'http://127.0.0.1:47812/avatar');
  assert.equal(robot.inputSettings.width, 1080);
  assert.equal(robot.inputSettings.height, 1130);
  const t = obs.calls.find((c) => c[0] === 'SetSceneItemTransform' && c[1].sceneName === 'Screen + Avatar'
    && c[1].sceneItemTransform.positionY === 790);
  assert.ok(t, 'avatar sits under the game window');
});

test('without the avatar URL there is no avatar scene', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  assert.ok(!obs.st.scenes.has('Screen + Avatar'));
});

test('setup refuses to run while OBS is streaming', async () => {
  const obs = fakeObs();
  obs.call = async (type) => (type === 'GetStreamStatus' ? { outputActive: true } : {});
  await assert.rejects(setupTikTok(obs, {}), /Stop streaming/);
});

test('a hand-added Game Window at the default spot gets our layout; moved items are left alone', async () => {
  const obs = fakeObs({ profiles: ['Untitled', 'TikTok Vertical'], collections: ['Untitled', 'TikTok Vertical'] });
  const fresh = { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, boundsType: 'OBS_BOUNDS_NONE' };
  obs.st.scenes.set('Screen + Camera', [{ sourceName: 'Game Window', sceneItemId: 700, sceneItemTransform: fresh }]);
  obs.st.scenes.set('Camera', [{ sourceName: 'Webcam', sceneItemId: 701,
    sceneItemTransform: { ...fresh, positionX: 300, positionY: 900 } }]);
  obs.st.inputs.set('Game Window', 'pipewire-screen-capture-source');
  obs.st.inputs.set('Webcam', 'v4l2_input');
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a' });
  const t = (id) => obs.calls.filter((c) => c[0] === 'SetSceneItemTransform' && c[1].sceneItemId === id);
  assert.equal(t(700).length, 1, 'default-placed Game Window is laid out');
  assert.equal(t(700)[0][1].sceneItemTransform.boundsType, 'OBS_BOUNDS_SCALE_OUTER');
  assert.equal(t(701).length, 0, 'moved Webcam is not touched');
  assert.ok(order(obs, 'Screen').includes('Game Window'), 'existing capture is added to the other scene');
});

test('no source shares a name with a scene (OBS refuses duplicates across both)', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', avatarUrl: 'http://127.0.0.1:47812/avatar' });
  const scenes = new Set(obs.st.scenes.keys());
  for (const name of obs.st.inputs.keys()) assert.ok(!scenes.has(name), `source "${name}" collides with a scene`);
});

const settingsFor = (obs, inputName) => obs.calls.filter((c) => c[0] === 'SetInputSettings' && c[1].inputName === inputName).map((c) => c[1].inputSettings);

test('applying another theme repoints the artwork and avatar, and drops the old text sources', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/neon', avatarUrl: 'http://127.0.0.1:47812/avatar?c1=25f4ee' });
  const created = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Frame: Starting Soon')[1];
  assert.equal(created.inputSettings.file, '/tmp/neon/frame-starting-soon.png');
  // A setup from before themes: text sources on top of the scenes.
  obs.st.inputs.set('Title: Starting', 'text_ft2_source_v2');
  obs.st.scenes.get('Starting Soon').push({ sourceName: 'Title: Starting', sceneItemId: 800 });
  obs.st.inputs.set('Handle', 'text_ft2_source_v2');
  obs.st.scenes.get('Screen').push({ sourceName: 'Handle', sceneItemId: 801 });

  const res = await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/arcade', avatarUrl: 'http://127.0.0.1:47812/avatar?c1=39ff14' });
  assert.equal(res.added, 0);
  assert.ok(res.updated >= 8, 'background and every frame repointed');
  assert.equal(settingsFor(obs, 'Background').at(-1).file, '/tmp/arcade/bg.png');
  assert.equal(settingsFor(obs, 'Frame: Ending').at(-1).file, '/tmp/arcade/frame-ending.png');
  assert.equal(settingsFor(obs, 'Avatar (full)').at(-1).url, 'http://127.0.0.1:47812/avatar?c1=39ff14');
  assert.ok(!obs.st.inputs.has('Title: Starting') && !obs.st.inputs.has('Handle'), 'old text sources removed');
  assert.ok(!order(obs, 'Starting Soon').includes('Title: Starting'));
});

test('without artwork (OBS on another machine), scenes get a plain color and text sources', async () => {
  const obs = fakeObs();
  await setupTikTok(obs, { handle: 'x', assetsDir: null });
  assert.equal(obs.st.inputs.get('Background'), 'color_source_v3');
  assert.deepEqual(order(obs, 'Starting Soon').slice(0, 4), ['Background', 'Title: Starting', 'Handle', 'Subtitle: Starting']);
  assert.deepEqual(order(obs, 'Ending').slice(0, 4), ['Background', 'Title: Ending 1', 'Title: Ending 2', 'Follow']);
  assert.ok(order(obs, 'Screen').includes('Handle'));
  assert.ok(![...obs.st.inputs.keys()].some((n) => n.startsWith('Frame:')), 'no frames without artwork');
  const noHandle = fakeObs();
  await setupTikTok(noHandle, { handle: '', assetsDir: null });
  assert.ok(!noHandle.st.inputs.has('Handle') && !noHandle.st.inputs.has('Follow'), 'no handle lines without a handle');
});

test('a re-run counts no changes for full-canvas layers sitting at the default spot', async () => {
  // Real OBS reports 0,0 for items we placed at 0,0, the same as a fresh item.
  const obs = fakeObs({ at: 0 });
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', capture: false });
  const again = await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', capture: false });
  assert.equal(again.added, 0);
});

test('a 0.1.0 robot setup is renamed to Avatar in place, not rebuilt', async () => {
  const obs = fakeObs({ profiles: ['Untitled', 'TikTok Vertical'], collections: ['Untitled', 'TikTok Vertical'] });
  obs.st.scenes.set('Screen + Robot', [{ sourceName: 'Robot (full)', sceneItemId: 600 }, { sourceName: 'Frame: Screen + Robot', sceneItemId: 601 }]);
  obs.st.inputs.set('Robot (full)', 'browser_source');
  obs.st.inputs.set('Frame: Screen + Robot', 'image_source');
  await setupTikTok(obs, { handle: 'x', assetsDir: '/tmp/a', avatarUrl: 'http://127.0.0.1:47812/avatar?avatar=cat' });
  assert.ok(!obs.st.scenes.has('Screen + Robot') && obs.st.scenes.has('Screen + Avatar'));
  assert.ok(!obs.st.inputs.has('Robot (full)') && obs.st.inputs.get('Avatar (full)') === 'browser_source');
  assert.ok(!obs.calls.some((c) => c[0] === 'CreateInput' && c[1].inputName === 'Avatar (full)'), 'renamed, not recreated');
  assert.equal(settingsFor(obs, 'Avatar (full)').at(-1).url, 'http://127.0.0.1:47812/avatar?avatar=cat');
  assert.equal(settingsFor(obs, 'Frame: Screen + Avatar').at(-1).file, '/tmp/a/frame-screen-avatar.png');
});
