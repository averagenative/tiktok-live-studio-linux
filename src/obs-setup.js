'use strict';

// Builds a ready-to-use vertical TikTok setup in OBS over obs-websocket:
// a "TikTok Vertical" profile (1080x1920, NVENC, TikTok-friendly bitrate)
// and a scene collection with styled scenes. It only ever creates new
// profiles/collections; it never edits the user's existing ones.

const PROFILE = 'TikTok Vertical';
const COLLECTION = 'TikTok Vertical';
const W = 1080;
const H = 1920;

// Windows cut into the overlay artwork (see scripts/make-obs-assets.sh).
// Sources sit under the overlay, sized a few pixels past each window.
const HOLES = {
  camera: { x: 60, y: 210, w: 960, h: 1280 },
  sc_cam: { x: 150, y: 170, w: 780, h: 439 },
  sc_screen: { x: 30, y: 650, w: 1020, h: 574 },
  screen: { x: 20, y: 560, w: 1040, h: 585 },
};

// OBS colors are 0xAABBGGRR.
const abgr = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const WHITE = abgr('#ffffff');
const CYAN = abgr('#25f4ee');

const ALIGN_CENTER = 0;
const ALIGN_TOP_LEFT = 5;

function textSettings(text, { face = 'Montserrat Black', size = 96, color = WHITE } = {}) {
  return {
    text,
    font: { face, style: 'Regular', size, flags: 0 },
    color1: color,
    color2: color,
    antialiasing: true,
    drop_shadow: true,
    outline: false,
  };
}

function slot({ x, y, w, h }, pad = 4) {
  return {
    positionX: x - pad,
    positionY: y - pad,
    alignment: ALIGN_TOP_LEFT,
    boundsType: 'OBS_BOUNDS_SCALE_OUTER',
    boundsWidth: w + pad * 2,
    boundsHeight: h + pad * 2,
    boundsAlignment: ALIGN_CENTER,
    cropToBounds: true,
  };
}

const FULL = { positionX: 0, positionY: 0, alignment: ALIGN_TOP_LEFT };
const centered = (y) => ({ positionX: W / 2, positionY: y, alignment: ALIGN_CENTER });

// Scene layouts, bottom layer first. Each entry is [sourceName, transform].
function sceneLayouts({ overlays, capture, handle }) {
  const at = (y) => (handle ? [['Handle', centered(y)]] : []);
  return {
    'Starting Soon': [['Background', FULL], ['Title: Starting', centered(820)], ...at(990), ['Subtitle: Starting', centered(1080)]],
    Camera: [
      ['Background', FULL],
      ...(capture ? [['Webcam', slot(HOLES.camera)]] : []),
      ...(overlays ? [['Frame: Camera', FULL]] : []),
      ...at(1570),
    ],
    'Screen + Camera': [
      ['Background', FULL],
      ...(capture ? [['Screen', slot(HOLES.sc_screen)], ['Webcam', slot(HOLES.sc_cam)]] : []),
      ...(overlays ? [['Frame: Screen + Camera', FULL]] : []),
      ...at(1300),
    ],
    Screen: [
      ['Background', FULL],
      ...(capture ? [['Screen', slot(HOLES.screen)]] : []),
      ...(overlays ? [['Frame: Screen', FULL]] : []),
      ...at(1240),
    ],
    'Be Right Back': [['Background', FULL], ['Title: BRB', centered(820)], ...at(990)],
    Ending: [
      ['Background', FULL], ['Title: Ending 1', centered(770)], ['Title: Ending 2', centered(880)],
      ...(handle ? [['Follow', centered(1040)]] : []),
    ],
  };
}

async function setupTikTok(obs, { handle = '', assetsDir = null, capture = true, fps = 30, log = () => {} } = {}) {
  const warnings = [];
  const say = (m) => log('obs', `setup: ${m}`);
  const at = handle ? `@${handle.replace(/^@/, '')}` : '';

  const status = await obs.call('GetStreamStatus');
  if (status.outputActive) throw new Error('Stop streaming in OBS before running the setup');

  // ---- profile --------------------------------------------------------------
  const { profiles } = await obs.call('GetProfileList');
  if (profiles.includes(PROFILE)) {
    await obs.call('SetCurrentProfile', { profileName: PROFILE });
    say(`switched to existing profile "${PROFILE}"`);
  } else {
    await obs.call('CreateProfile', { profileName: PROFILE });
    say(`created profile "${PROFILE}"`);
  }
  // SetVideoSettings hangs on OBS 32.1 (obs-websocket 5.7.3), so the canvas
  // goes into the profile too and a profile reload applies it.
  const params = [
    ['Video', 'BaseCX', String(W)],
    ['Video', 'BaseCY', String(H)],
    ['Video', 'OutputCX', String(W)],
    ['Video', 'OutputCY', String(H)],
    ['Video', 'FPSType', '0'],
    ['Video', 'FPSCommon', String(fps)],
    ['Output', 'Mode', 'Simple'],
    ['SimpleOutput', 'StreamEncoder', 'nvenc'],
    ['SimpleOutput', 'NVENCPreset2', 'p5'],
    ['SimpleOutput', 'VBitrate', '6000'],
    ['SimpleOutput', 'ABitrate', '160'],
    ['SimpleOutput', 'UseAdvanced', 'false'],
  ];
  for (const [parameterCategory, parameterName, parameterValue] of params) {
    await obs.call('SetProfileParameter', { parameterCategory, parameterName, parameterValue });
  }
  await reloadProfile(obs, PROFILE, warnings);
  const v = await obs.call('GetVideoSettings');
  if (v.baseWidth !== W || v.baseHeight !== H) {
    warnings.push(`canvas is ${v.baseWidth}x${v.baseHeight}; restart OBS to apply 1080x1920`);
  }
  say(`video 1080x1920 @ ${fps} fps, NVENC H.264 6000 kbps, AAC 160 kbps`);

  // ---- scene collection -----------------------------------------------------
  // Creating or re-running both converge on the same result: anything of ours
  // that's missing gets added, and anything the user added is left alone.
  const { sceneCollections } = await obs.call('GetSceneCollectionList');
  const existed = sceneCollections.includes(COLLECTION);
  if (existed) {
    await obs.call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION });
    say(`scene collection "${COLLECTION}" exists; filling in anything missing`);
  } else {
    await obs.call('CreateSceneCollection', { sceneCollectionName: COLLECTION });
    say(`created scene collection "${COLLECTION}"`);
  }

  const overlays = !!assetsDir;
  const layouts = sceneLayouts({ overlays, capture, handle: at });
  const sceneNames = Object.keys(layouts);
  const { scenes: before } = await obs.call('GetSceneList');
  const haveScene = new Set(before.map((x) => x.sceneName));
  // OBS lists new scenes at the top, so create them last-to-first.
  for (const name of [...sceneNames].reverse()) {
    if (!haveScene.has(name)) await obs.call('CreateScene', { sceneName: name });
  }

  const { inputKinds } = await obs.call('GetInputKindList', { unversioned: false });
  // For games, a window capture keeps notifications and other windows off stream.
  const captureKind = ['pipewire-window-capture-source', 'pipewire-screen-capture-source'].find((k) => inputKinds.includes(k));
  const file = (n) => `${assetsDir}/${n}`;
  const defs = {
    Background: overlays
      ? { kind: 'image_source', settings: { file: file('bg.png') } }
      : { kind: 'color_source_v3', settings: { color: abgr('#101218'), width: W, height: H } },
    'Frame: Camera': { kind: 'image_source', settings: { file: file('overlay-camera.png') } },
    'Frame: Screen + Camera': { kind: 'image_source', settings: { file: file('overlay-screen-camera.png') } },
    'Frame: Screen': { kind: 'image_source', settings: { file: file('overlay-screen.png') } },
    Webcam: { kind: 'v4l2_input', settings: {} },
    Screen: { kind: captureKind, settings: { ShowCursor: true } },
    'Title: Starting': { kind: 'text_ft2_source_v2', settings: textSettings('STARTING SOON') },
    'Subtitle: Starting': { kind: 'text_ft2_source_v2', settings: textSettings('LIVE in a moment', { face: 'Montserrat Medium', size: 44 }) },
    'Title: BRB': { kind: 'text_ft2_source_v2', settings: textSettings('BE RIGHT BACK') },
    'Title: Ending 1': { kind: 'text_ft2_source_v2', settings: textSettings('THANKS FOR') },
    'Title: Ending 2': { kind: 'text_ft2_source_v2', settings: textSettings('WATCHING') },
    Handle: { kind: 'text_ft2_source_v2', settings: textSettings(at, { face: 'Montserrat SemiBold', size: 52, color: CYAN }) },
    Follow: { kind: 'text_ft2_source_v2', settings: textSettings(`follow ${at}`, { face: 'Montserrat SemiBold', size: 52, color: CYAN }) },
    Mic: { kind: 'pulse_input_capture', settings: { device_id: 'default' } },
    'Desktop Audio': { kind: 'pulse_output_capture', settings: { device_id: 'default' } },
  };

  const { inputs } = await obs.call('GetInputList');
  const inputKind = new Map(inputs.map((i) => [i.inputName, i.inputKind]));

  // A first run without artwork left a plain color Background; swap in the image.
  if (inputKind.get('Background') && inputKind.get('Background') !== defs.Background.kind) {
    await obs.call('SetInputName', { inputName: 'Background', newInputName: 'Background (old)' });
    inputKind.delete('Background');
    inputKind.set('Background (old)', 'old');
  }

  // New collections don't get OBS's global Desktop Audio / Mic, so add our own
  // audio sources to every scene unless the collection already has them.
  const special = await obs.call('GetSpecialInputs');
  const audio = [];
  if (!special.mic1) audio.push('Mic');
  if (!special.desktop1) audio.push('Desktop Audio');

  const items = new Map();
  const itemsOf = async (sceneName) => {
    if (!items.has(sceneName)) {
      const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
      items.set(sceneName, sceneItems);
    }
    return items.get(sceneName);
  };

  const place = async (sceneName, sourceName, transform, timeoutMs) => {
    const present = (await itemsOf(sceneName)).find((i) => i.sourceName === sourceName);
    if (present) {
      // A source the user added by hand (e.g. their own "Screen" capture) still
      // sits at OBS's default spot; give it our layout. Anything moved stays put.
      if (transform && isDefaultTransform(present.sceneItemTransform)) {
        await obs.call('SetSceneItemTransform', { sceneName, sceneItemId: present.sceneItemId, sceneItemTransform: transform });
        return true;
      }
      return false;
    }
    let sceneItemId;
    if (!inputKind.has(sourceName)) {
      if (!defs[sourceName]?.kind) throw new Error(`no source kind for ${sourceName}`);
      const def = defs[sourceName];
      ({ sceneItemId } = await obs.call('CreateInput', {
        sceneName, inputName: sourceName, inputKind: def.kind, inputSettings: def.settings, sceneItemEnabled: true,
      }, { timeoutMs }));
      inputKind.set(sourceName, def.kind);
      if (sourceName === 'Webcam') await pickFirstCamera(obs, warnings, say);
    } else {
      ({ sceneItemId } = await obs.call('CreateSceneItem', { sceneName, sourceName, sceneItemEnabled: true }));
    }
    (await itemsOf(sceneName)).push({ sourceName, sceneItemId });
    if (transform) await obs.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: transform });
    return true;
  };

  let added = 0;
  for (const sceneName of sceneNames) {
    for (const [sourceName, transform] of layouts[sceneName]) {
      if (sourceName === 'Screen') continue;
      if (await place(sceneName, sourceName, transform)) added += 1;
    }
    for (const a of audio) if (await place(sceneName, a, null)) added += 1;
  }

  // Screen capture goes last: creating it opens GNOME's picker, which waits
  // for the user. If it doesn't finish, the rest of the setup still stands.
  if (capture && captureKind) {
    say('pick the game window (or screen) to share in the GNOME dialog');
    try {
      for (const sceneName of sceneNames) {
        const entry = layouts[sceneName].find(([n]) => n === 'Screen');
        if (entry && (await place(sceneName, 'Screen', entry[1], 90000))) added += 1;
      }
    } catch (e) {
      warnings.push(`screen capture wasn't added (${e.message}); in OBS add a "Window Capture (PipeWire)" source named Screen`);
    }
  } else if (capture) {
    warnings.push('this OBS has no PipeWire capture source');
  }

  // Keep our layers in layout order at the bottom; user-added items stay above.
  for (const sceneName of sceneNames) {
    const list = await itemsOf(sceneName);
    let index = 0;
    for (const [sourceName] of layouts[sceneName]) {
      const it = list.find((i) => i.sourceName === sourceName);
      if (!it) continue;
      await obs.call('SetSceneItemIndex', { sceneName, sceneItemId: it.sceneItemId, sceneItemIndex: index }).catch(() => {});
      index += 1;
    }
  }

  if (inputKind.has('Background (old)')) await removeEverywhere(obs, 'Background (old)');

  // Drop the empty default scene a new collection comes with.
  for (const sc of before) {
    if (sceneNames.includes(sc.sceneName)) continue;
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: sc.sceneName });
    if (sceneItems.length === 0) await obs.call('RemoveScene', { sceneName: sc.sceneName }).catch(() => {});
  }
  if (!existed) await obs.call('SetCurrentProgramScene', { sceneName: sceneNames[0] });
  say(existed ? `repaired: added ${added} missing item(s)` : `added scenes: ${sceneNames.join(', ')}`);

  await tuneMic(obs, warnings, say, special.mic1 || 'Mic');

  await obs.call('SetCurrentSceneTransition', { transitionName: 'Fade' }).catch(() => {});
  await obs.call('SetCurrentSceneTransitionDuration', { transitionDuration: 300 }).catch(() => {});

  for (const w of warnings) say(`warning: ${w}`);
  return { profile: PROFILE, collection: COLLECTION, created: !existed, added, scenes: sceneNames, warnings };
}

function isDefaultTransform(t) {
  if (!t) return false;
  return t.positionX === 0 && t.positionY === 0 && t.scaleX === 1 && t.scaleY === 1 && !t.rotation
    && (!t.boundsType || t.boundsType === 'OBS_BOUNDS_NONE');
}

// RemoveInput alone can leave the source in some scenes (seen on OBS 32.1),
// so take it out of every scene first.
async function removeEverywhere(obs, sourceName) {
  const { scenes } = await obs.call('GetSceneList');
  for (const sc of scenes) {
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: sc.sceneName });
    for (const it of sceneItems.filter((i) => i.sourceName === sourceName)) {
      await obs.call('RemoveSceneItem', { sceneName: sc.sceneName, sceneItemId: it.sceneItemId }).catch(() => {});
    }
  }
  await obs.call('RemoveInput', { inputName: sourceName }).catch(() => {});
}

// OBS only re-reads a profile's video settings when the profile is loaded,
// so hop to another profile and back.
async function reloadProfile(obs, name, warnings) {
  const { profiles } = await obs.call('GetProfileList');
  const other = profiles.find((p) => p !== name);
  if (!other) {
    warnings.push('only one OBS profile exists; restart OBS to apply the new video settings');
    return;
  }
  await obs.call('SetCurrentProfile', { profileName: other });
  await obs.call('SetCurrentProfile', { profileName: name });
}

async function pickFirstCamera(obs, warnings, say) {
  try {
    const { propertyItems } = await obs.call('GetInputPropertiesListPropertyItems', { inputName: 'Webcam', propertyName: 'device_id' });
    const cam = (propertyItems || []).find((i) => i.itemEnabled !== false && i.itemValue);
    if (!cam) {
      warnings.push('no webcam found; set the Webcam source device by hand');
      return;
    }
    await obs.call('SetInputSettings', { inputName: 'Webcam', inputSettings: { device_id: cam.itemValue } });
    say(`webcam: ${cam.itemName}`);
  } catch (e) {
    warnings.push(`could not pick a webcam: ${e.message}`);
  }
}

// Noise suppression, compressor and limiter on the mic, with kinds checked
// against what this OBS build offers.
async function tuneMic(obs, warnings, say, sourceName) {
  const mic1 = sourceName || (await obs.call('GetSpecialInputs')).mic1;
  if (!mic1) {
    warnings.push('no Mic/Aux input; skipped the mic filters');
    return;
  }
  const { sourceFilterKinds } = await obs.call('GetSourceFilterKindList');
  const kind = (...names) => names.find((n) => sourceFilterKinds.includes(n));
  const filters = [
    ['Noise Suppression', kind('noise_suppress_filter_v2', 'noise_suppress_filter'), { method: 'rnnoise' }],
    ['Compressor', kind('compressor_filter'), { ratio: 4, threshold: -18, attack_time: 6, release_time: 60, output_gain: 0 }],
    ['Limiter', kind('limiter_filter'), { threshold: -2, release_time: 60 }],
  ];
  const { filters: existing } = await obs.call('GetSourceFilterList', { sourceName: mic1 }).catch(() => ({ filters: [] }));
  const have = new Set((existing || []).map((f) => f.filterName));
  const added = [];
  for (const [filterName, filterKind, filterSettings] of filters) {
    if (have.has(filterName)) continue;
    if (!filterKind) {
      warnings.push(`filter ${filterName} isn't available in this OBS`);
      continue;
    }
    try {
      await obs.call('CreateSourceFilter', { sourceName: mic1, filterName, filterKind, filterSettings });
      added.push(filterName);
    } catch (e) {
      warnings.push(`${filterName}: ${e.message}`);
    }
  }
  if (added.length) say(`mic "${mic1}": ${added.join(', ')}`);
}

module.exports = { setupTikTok, tuneMic, sceneLayouts, abgr, PROFILE, COLLECTION, HOLES };
