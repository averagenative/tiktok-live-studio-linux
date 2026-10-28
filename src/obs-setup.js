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
  const { sceneCollections } = await obs.call('GetSceneCollectionList');
  if (sceneCollections.includes(COLLECTION)) {
    await obs.call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION });
    say(`scene collection "${COLLECTION}" already exists; switched to it and left it unchanged`);
    return { profile: PROFILE, collection: COLLECTION, created: false, warnings };
  }
  await obs.call('CreateSceneCollection', { sceneCollectionName: COLLECTION });
  say(`created scene collection "${COLLECTION}"`);

  const overlays = !!assetsDir;
  const layouts = sceneLayouts({ overlays, capture, handle: at });
  const sceneNames = Object.keys(layouts);
  const { scenes: initial } = await obs.call('GetSceneList');
  // OBS lists new scenes at the top, so create them last-to-first.
  for (const name of [...sceneNames].reverse()) await obs.call('CreateScene', { sceneName: name });

  // Source definitions: kind + settings. Created on first use, then reused.
  const file = (n) => `${assetsDir}/${n}`;
  const defs = {
    Background: overlays
      ? { kind: 'image_source', settings: { file: file('bg.png') } }
      : { kind: 'color_source_v3', settings: { color: abgr('#101218'), width: W, height: H } },
    'Frame: Camera': { kind: 'image_source', settings: { file: file('overlay-camera.png') } },
    'Frame: Screen + Camera': { kind: 'image_source', settings: { file: file('overlay-screen-camera.png') } },
    'Frame: Screen': { kind: 'image_source', settings: { file: file('overlay-screen.png') } },
    Webcam: { kind: 'v4l2_input', settings: {} },
    Screen: { kind: 'pipewire-screen-capture-source', settings: { ShowCursor: true } },
    'Title: Starting': { kind: 'text_ft2_source_v2', settings: textSettings('STARTING SOON') },
    'Subtitle: Starting': { kind: 'text_ft2_source_v2', settings: textSettings('LIVE in a moment', { face: 'Montserrat Medium', size: 44 }) },
    'Title: BRB': { kind: 'text_ft2_source_v2', settings: textSettings('BE RIGHT BACK') },
    'Title: Ending 1': { kind: 'text_ft2_source_v2', settings: textSettings('THANKS FOR') },
    'Title: Ending 2': { kind: 'text_ft2_source_v2', settings: textSettings('WATCHING') },
    Handle: { kind: 'text_ft2_source_v2', settings: textSettings(at, { face: 'Montserrat SemiBold', size: 52, color: CYAN }) },
    Follow: { kind: 'text_ft2_source_v2', settings: textSettings(`follow ${at}`, { face: 'Montserrat SemiBold', size: 52, color: CYAN }) },
  };

  const created = new Set();
  for (const sceneName of sceneNames) {
    for (const [sourceName, transform] of layouts[sceneName]) {
      let sceneItemId;
      if (!created.has(sourceName)) {
        const def = defs[sourceName];
        const res = await obs.call('CreateInput', {
          sceneName, inputName: sourceName, inputKind: def.kind, inputSettings: def.settings, sceneItemEnabled: true,
        });
        sceneItemId = res.sceneItemId;
        created.add(sourceName);
        if (sourceName === 'Webcam') await pickFirstCamera(obs, warnings, say);
        if (sourceName === 'Screen') say('screen capture added; pick the screen or window to share in the GNOME dialog');
      } else {
        ({ sceneItemId } = await obs.call('CreateSceneItem', { sceneName, sourceName, sceneItemEnabled: true }));
      }
      if (transform) {
        await obs.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: transform });
      }
    }
  }

  // Drop the empty default scene the new collection came with.
  for (const s of initial) {
    if (!sceneNames.includes(s.sceneName)) await obs.call('RemoveScene', { sceneName: s.sceneName }).catch(() => {});
  }
  await obs.call('SetCurrentProgramScene', { sceneName: sceneNames[0] });
  say(`added scenes: ${sceneNames.join(', ')}`);

  await tuneMic(obs, warnings, say);

  await obs.call('SetCurrentSceneTransition', { transitionName: 'Fade' }).catch(() => {});
  await obs.call('SetCurrentSceneTransitionDuration', { transitionDuration: 300 }).catch(() => {});

  for (const w of warnings) say(`warning: ${w}`);
  return { profile: PROFILE, collection: COLLECTION, created: true, scenes: sceneNames, warnings };
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
  const added = [];
  for (const [filterName, filterKind, filterSettings] of filters) {
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
