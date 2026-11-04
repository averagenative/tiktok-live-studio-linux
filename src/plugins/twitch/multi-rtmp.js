'use strict';

// Reads and edits the obs-multi-rtmp plugin's per-profile config
// (<profile dir>/obs-multi-rtmp.json), where the Twitch target lives.
//
// The OBS plugin keeps that file in memory while OBS runs: it reloads it when
// the profile changes and writes its copy back when OBS exits. So an edit to
// the current profile's file only sticks if OBS reloads the profile right
// after (see reloadProfile), and should never happen while OBS runs without
// a connection to tell it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE = 'obs-multi-rtmp.json';
const TWITCH_SERVER = 'rtmp://live.twitch.tv/app';
// obs-multi-rtmp names every target's output this; obs-websocket can read it.
const OUTPUT_NAME = 'multi-output';

// Twitch wants a keyframe every 2 seconds. The TikTok Vertical profile uses
// OBS's Simple output mode, which leaves NVENC at 250 frames (8.3 s at 30 fps),
// so Twitch gets its own encoder instead of sharing OBS's.
const VIDEO_PARAMS = { rate_control: 'CBR', bitrate: 6000, keyint_sec: 2, preset: 'p5', profile: 'high' };
const VIDEO_ENCODER = 'obs_nvenc_h264_tex';

// Where OBS keeps its settings: the packaged OBS, then the Flatpak.
function configDirs({ env = process.env, home = os.homedir() } = {}) {
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(xdg, 'obs-studio'), path.join(home, '.var/app/com.obsproject.Studio/config/obs-studio')];
}

// A small INI reader: { section: { key: value } }.
function parseIni(text) {
  const out = {};
  let section = out;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      out[head[1]] = out[head[1]] || {};
      section = out[head[1]];
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) section[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function readIni(file, readFileSync = fs.readFileSync) {
  try {
    return parseIni(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The folder of the profile OBS calls `name`. Folder names drop spaces
// ("TikTok Vertical" lives in TikTok_Vertical), so match on basic.ini's Name.
function findProfileDir(configDir, name, { readdirSync = fs.readdirSync, readFileSync = fs.readFileSync } = {}) {
  const root = path.join(configDir, 'basic', 'profiles');
  let dirs;
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const ini = readIni(path.join(root, d, 'basic.ini'), readFileSync);
    if (ini?.General?.Name === name) return path.join(root, d);
  }
  return null;
}

// The first OBS config folder that has a profile called `name`.
function locateProfile(name, opts = {}) {
  for (const configDir of configDirs(opts)) {
    const dir = findProfileDir(configDir, name, opts);
    if (dir) return { configDir, profileDir: dir };
  }
  return null;
}

// The profile OBS last had open, from its own settings.
function currentProfile(configDir, readFileSync = fs.readFileSync) {
  for (const f of ['user.ini', 'global.ini']) {
    const ini = readIni(path.join(configDir, f), readFileSync);
    if (ini?.Basic?.Profile) return ini.Basic.Profile;
  }
  return '';
}

function pluginInstalled(configDir, { existsSync = fs.existsSync } = {}) {
  return [
    path.join(configDir, 'plugins', 'obs-multi-rtmp'),
    '/usr/lib64/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib/x86_64-linux-gnu/obs-plugins/obs-multi-rtmp.so',
    '/usr/local/lib/obs-plugins/obs-multi-rtmp.so',
    // Flatpak extension, system-wide or per user.
    '/var/lib/flatpak/runtime/com.obsproject.Studio.Plugin.MultiRTMP',
    path.join(os.homedir(), '.local/share/flatpak/runtime/com.obsproject.Studio.Plugin.MultiRTMP'),
  ].some((p) => existsSync(p));
}

const emptyConfig = () => ({ targets: [], video_configs: [], audio_configs: [] });

function readConfig(profileDir, readFileSync = fs.readFileSync) {
  let text;
  try {
    text = readFileSync(path.join(profileDir, FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return emptyConfig();
    throw e;
  }
  // The OBS plugin saves the file with a UTF-8 byte order mark.
  const cfg = JSON.parse(text.replace(/^\uFEFF/, ''));
  return {
    ...cfg,
    targets: Array.isArray(cfg.targets) ? cfg.targets : [],
    video_configs: Array.isArray(cfg.video_configs) ? cfg.video_configs : [],
    audio_configs: Array.isArray(cfg.audio_configs) ? cfg.audio_configs : [],
  };
}

// Same-directory temp file and rename, so OBS never reads half a file.
// Owner-only, because the file holds the stream key.
function writeConfig(profileDir, cfg, { writeFileSync = fs.writeFileSync, renameSync = fs.renameSync } = {}) {
  const file = path.join(profileDir, FILE);
  const tmp = `${file}.lsl-tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

// Twitch ingest is live.twitch.tv or a *.contribute.live-video.net server.
const isTwitchServer = (t) => /(^|[./])(twitch\.tv|live-video\.net)(\/|:|$)/i.test(String(t?.['service-param']?.server || ''));

// By server first, then a target the user named Twitch.
function findTwitchTarget(cfg) {
  return cfg.targets.find(isTwitchServer) || cfg.targets.find((t) => /^twitch$/i.test(String(t.name || '').trim())) || null;
}

function twitchState(cfg) {
  const t = findTwitchTarget(cfg);
  if (!t) return { exists: false, enabled: false, hasKey: false, ownEncoder: false, keyintSec: 0, syncStart: false };
  const venc = cfg.video_configs.find((v) => v.id === t['video-config']);
  return {
    exists: true,
    enabled: t.enabled !== false,
    hasKey: !!t['service-param']?.key,
    ownEncoder: !!venc,
    keyintSec: Number(venc?.param?.keyint_sec) || 0,
    syncStart: !!t['sync-start'],
  };
}

// Ids are random decimal strings, like the plugin's own; on a clash, the
// next free number.
function newId(cfg, random = Math.random) {
  const used = new Set([...cfg.targets, ...cfg.video_configs, ...cfg.audio_configs].map((x) => String(x.id)));
  let n = Math.floor(random() * 4294967295);
  while (used.has(String(n))) n = (n + 1) % 4294967296;
  return String(n);
}

// Returns a copy of cfg with the Twitch target updated, creating it (its own
// encoder, OBS's audio, starting and stopping with OBS's stream) if missing.
// Other targets are left as they are.
function upsertTwitch(cfg, { key, enabled } = {}, random) {
  const next = {
    ...cfg,
    targets: cfg.targets.map((t) => ({ ...t })),
    video_configs: cfg.video_configs.map((v) => ({ ...v })),
    audio_configs: [...cfg.audio_configs],
  };
  let t = findTwitchTarget(next);
  if (!t) {
    const vid = newId(next, random);
    next.video_configs.push({ id: vid, encoder: VIDEO_ENCODER, param: { ...VIDEO_PARAMS }, 'fps-denumerator': 1 });
    t = {
      id: newId(next, random),
      name: 'Twitch',
      protocol: 'RTMP',
      'service-param': { server: TWITCH_SERVER, key: '', use_auth: false, bwtest: false },
      'output-param': {},
      'sync-start': true,
      'sync-stop': true,
      enabled: true,
      'video-config': vid,
    };
    next.targets.push(t);
  }
  t['service-param'] = { ...t['service-param'] };
  if (key !== undefined) t['service-param'].key = String(key).trim();
  if (enabled !== undefined) {
    t.enabled = !!enabled;
    // Turning Twitch on means it should go out with the LIVE.
    if (enabled) {
      t['sync-start'] = true;
      t['sync-stop'] = true;
    }
  }
  return next;
}

// Makes OBS (and the plugin) re-read a profile by hopping to another
// profile and back. Returns false when there's no other profile to hop to.
async function reloadProfile(obs, name) {
  const { profiles } = await obs.call('GetProfileList');
  const other = (profiles || []).find((p) => p !== name);
  if (!other) return false;
  await obs.call('SetCurrentProfile', { profileName: other });
  await obs.call('SetCurrentProfile', { profileName: name });
  return true;
}

module.exports = {
  FILE, TWITCH_SERVER, OUTPUT_NAME, VIDEO_PARAMS, VIDEO_ENCODER,
  configDirs, parseIni, findProfileDir, locateProfile, currentProfile, pluginInstalled,
  readConfig, writeConfig, findTwitchTarget, twitchState, upsertTwitch, reloadProfile,
};
