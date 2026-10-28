'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTikTok, abgr, sceneLayouts } = require('../src/obs-setup');

// A fake obs-websocket that keeps just enough state to answer the setup.
function fakeObs({ profiles = ['Untitled'], collections = ['Untitled'] } = {}) {
  const calls = [];
  const st = { profile: profiles[0], profiles: [...profiles], collections: [...collections], scenes: ['Scene'], items: 0 };
  const handlers = {
    GetStreamStatus: () => ({ outputActive: false }),
    GetProfileList: () => ({ currentProfileName: st.profile, profiles: st.profiles }),
    CreateProfile: ({ profileName }) => { st.profiles.push(profileName); st.profile = profileName; },
    SetCurrentProfile: ({ profileName }) => { st.profile = profileName; },
    SetProfileParameter: () => ({}),
    GetVideoSettings: () => ({ baseWidth: 1080, baseHeight: 1920 }),
    GetSceneCollectionList: () => ({ sceneCollections: st.collections }),
    CreateSceneCollection: ({ sceneCollectionName }) => { st.collections.push(sceneCollectionName); st.scenes = ['Scene']; },
    SetCurrentSceneCollection: () => ({}),
    GetSceneList: () => ({ scenes: st.scenes.map((sceneName) => ({ sceneName })) }),
    CreateScene: ({ sceneName }) => { st.scenes.push(sceneName); },
    RemoveScene: ({ sceneName }) => { st.scenes = st.scenes.filter((s) => s !== sceneName); },
    CreateInput: () => ({ sceneItemId: ++st.items }),
    CreateSceneItem: () => ({ sceneItemId: ++st.items }),
    SetSceneItemTransform: () => ({}),
    GetInputPropertiesListPropertyItems: () => ({ propertyItems: [{ itemName: 'Integrated Camera', itemValue: '/dev/video0', itemEnabled: true }] }),
    SetInputSettings: () => ({}),
    SetCurrentProgramScene: () => ({}),
    GetSpecialInputs: () => ({ mic1: 'Mic/Aux' }),
    GetSourceFilterKindList: () => ({ sourceFilterKinds: ['noise_suppress_filter_v2', 'compressor_filter', 'limiter_filter'] }),
    CreateSourceFilter: () => ({}),
    SetCurrentSceneTransition: () => ({}),
    SetCurrentSceneTransitionDuration: () => ({}),
  };
  return {
    calls,
    st,
    async call(type, data = {}) {
      calls.push([type, data]);
      if (!handlers[type]) throw new Error(`unexpected request ${type}`);
      return handlers[type](data) || {};
    },
  };
}

test('abgr converts #rrggbb to OBS 0xAABBGGRR', () => {
  assert.equal(abgr('#25f4ee'), 0xffeef425);
  assert.equal(abgr('#ffffff'), 0xffffffff);
});

test('setup creates the profile, reloads it, and builds every scene once', async () => {
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
  assert.deepEqual(obs.st.scenes.slice().sort(), Object.keys(sceneLayouts({ overlays: true, capture: true, handle: '@x' })).sort());

  const inputs = obs.calls.filter((c) => c[0] === 'CreateInput').map(([, d]) => d.inputName);
  assert.equal(new Set(inputs).size, inputs.length, 'each source is created once and reused');
  for (const name of ['Background', 'Webcam', 'Screen', 'Frame: Camera', 'Handle', 'Follow']) assert.ok(inputs.includes(name), name);
  const bg = obs.calls.find((c) => c[0] === 'CreateInput' && c[1].inputName === 'Background')[1];
  assert.equal(bg.inputSettings.file, '/tmp/a/bg.png');
  assert.ok(obs.calls.some((c) => c[0] === 'SetInputSettings' && c[1].inputSettings.device_id === '/dev/video0'));

  const filters = obs.calls.filter((c) => c[0] === 'CreateSourceFilter').map(([, d]) => `${d.sourceName}:${d.filterKind}`);
  assert.deepEqual(filters, ['Mic/Aux:noise_suppress_filter_v2', 'Mic/Aux:compressor_filter', 'Mic/Aux:limiter_filter']);
});

test('setup never touches an existing TikTok collection', async () => {
  const obs = fakeObs({ profiles: ['Untitled', 'TikTok Vertical'], collections: ['Untitled', 'TikTok Vertical'] });
  const res = await setupTikTok(obs, { handle: '' });
  assert.equal(res.created, false);
  assert.ok(!obs.calls.some((c) => ['CreateScene', 'CreateInput', 'CreateSourceFilter'].includes(c[0])));
});

test('setup refuses to run while OBS is streaming', async () => {
  const obs = fakeObs();
  obs.call = async (type) => (type === 'GetStreamStatus' ? { outputActive: true } : {});
  await assert.rejects(setupTikTok(obs, {}), /Stop streaming/);
});
