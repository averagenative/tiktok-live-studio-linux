'use strict';

// Pure helpers with no Electron dependency, so `node --test` can cover them.

const crypto = require('node:crypto');

// What LIVE Studio 1.38.0 sends as its client identity (see docs/PROTOCOL.md).
const CLIENT = Object.freeze({
  aid: 8311,
  appName: 'tiktok_live_studio',
  channel: 'studio',
  version: '1.38.0',
  liveMode: 6,
});

// Room status values the anchor reports through /webcast/room/ping/anchor/.
const RoomStatus = Object.freeze({ default: 0, prepare: 1, living: 2, pause: 3, finish: 4 });

// status_code values the ping endpoint answers with.
const PingStatus = Object.freeze({
  RoomHasFinished: 30003,
  RoomIsLiving: 4003150,
  RoomHasFinishedByOtherDevice: 0x1c9cf39,
});

// status_code values /webcast/room/create/ answers with.
const CreateStatus = Object.freeze({
  success: 0,
  notLoggedIn: 20003,
  suicide: 2403,
  punished: 10018,
  holdLiving: 30005,
  illegalAvatar: 30011,
  noLiveAuth: 20800,
});

function md5Hex(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

// Matches qs.stringify for flat objects: undefined/null are dropped,
// everything else is stringified.
function formEncode(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

function versionToSdk(version) {
  return Number(String(version).split('.').join(''));
}

function buildCommonParams({ language = 'en', deviceId = '0', installId = '0', platform = 'mac',
  region, timezone, screen } = {}) {
  const p = {
    aid: CLIENT.aid,
    app_name: CLIENT.appName,
    channel: CLIENT.channel,
    device_platform: platform,
    version_code: CLIENT.version,
    webcast_sdk_version: versionToSdk(CLIENT.version),
    live_mode: CLIENT.liveMode,
    language,
    app_language: language,
    webcast_language: language,
    device_id: deviceId,
    install_id: installId,
    timezone_name: timezone,
  };
  if (region) p.priority_region = region;
  if (screen) {
    p.screen_width = screen.width;
    p.screen_height = screen.height;
  }
  return p;
}

// TikTok hands back a full RTMP URL. OBS wants it split into server and key
// at the last path segment, the same split TikTok's own "stream key" page shows.
function splitPushUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^rtmps?:$/.test(u.protocol)) return null;
  const slash = url.lastIndexOf('/');
  if (slash <= u.protocol.length + 2) return null;
  const server = url.slice(0, slash + 1);
  const key = url.slice(slash + 1);
  if (!key) return null;
  return { server, key };
}

// Prefer the plain RTMP fallback URL: the primary push_urls entries can use
// ByteDance's own transports (rtmpq, anchor-net) that OBS can't speak.
function pickPushUrl(streamUrl) {
  if (!streamUrl) return null;
  const candidates = [streamUrl.rtmp_push_url, ...(streamUrl.push_urls || [])];
  for (const c of candidates) {
    if (typeof c === 'string' && /^rtmps?:\/\//.test(c)) return c;
  }
  return null;
}

// obs-websocket v5 auth: base64(sha256(base64(sha256(password + salt)) + challenge))
function obsAuth(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 4)}${'*'.repeat(Math.min(24, key.length - 8))}${key.slice(-4)}`;
}

// LIVE Studio copies the tiktok.com login cookies onto the tiktokv.com API
// hosts and mirrors sessionid_ss into sessionid. We send them as an explicit
// Cookie header instead of copying them between domains.
function cookieHeader(cookies) {
  const byName = new Map();
  for (const c of cookies || []) {
    if (!c || !c.name) continue;
    byName.set(c.name, c.value ?? '');
  }
  if (!byName.has('sessionid') && byName.has('sessionid_ss')) {
    byName.set('sessionid', byName.get('sessionid_ss'));
  }
  return [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
}

function hasSession(cookies) {
  return (cookies || []).some((c) => (c.name === 'sessionid' || c.name === 'sessionid_ss') && c.value);
}

// Pull the bits we show from a /webcast/room/create/ response body.
function summarizeRoom(data) {
  if (!data) return null;
  const pushUrl = pickPushUrl(data.stream_url);
  return {
    roomId: data.id_str || (data.id != null ? String(data.id) : ''),
    pingRoomId: data.living_room_attrs?.room_id_str || data.id_str || '',
    streamId: data.stream_id_str || (data.stream_id != null ? String(data.stream_id) : ''),
    title: data.title || '',
    ownerHandle: data.owner?.display_id || '',
    createTime: data.create_time || 0,
    pushUrl,
    push: splitPushUrl(pushUrl),
  };
}

// The topic list shape isn't documented, so walk the response for objects
// that look like hashtags ({id, title}) instead of hard-coding a path.
function extractTopics(body, limit = 200) {
  const out = new Map();
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node) || out.size >= limit) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const id = node.id_str || node.id;
    const title = node.title || node.show_name || node.full_name;
    if (id && typeof title === 'string' && title && String(id) !== '0' && !out.has(String(id))) {
      out.set(String(id), title);
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(body?.data, 0);
  return [...out].map(([id, title]) => ({ id, title }));
}

// Accounts live in one data center (IDC), and the webcast API only accepts a
// logged-in session on that IDC's hosts. US accounts (TTP) are on separate
// *.tiktokv.us infrastructure. The official app learns the host from TTNet's
// dispatch config; we map the IDC cookie TikTok sets at login instead.
const WEBCAST_DEFAULT = 'https://webcast.tiktokv.com';
const WEBCAST_BY_IDC = Object.freeze({
  useast5: 'https://webcast16-normal-useast5.tiktokv.us',
  useast8: 'https://webcast16-normal-useast8.tiktokv.us',
  alisg: 'https://webcast16-normal-c-alisg.tiktokv.com',
  useast1a: 'https://webcast16-normal-c-useast1a.tiktokv.com',
  no1a: 'https://webcast16-normal-no1a.tiktokv.eu',
});
const IDC_ALIASES = Object.freeze({
  ttp: 'useast5', ttp2: 'useast8',
  sg: 'alisg', my: 'alisg',
  va: 'useast1a', maliva: 'useast1a',
  ie: 'no1a', eu: 'no1a', 'eu-ttp': 'no1a', 'eu-ttp2': 'no1a', gcp: 'no1a', useast2a: 'no1a',
});

function idcFromCookies(cookies) {
  const get = (n) => (cookies || []).find((c) => c.name === n && c.value)?.value;
  return (get('tt-target-idc') || get('store-idc') || '').toLowerCase();
}

function webcastHostForIdc(idc) {
  const key = String(idc || '').toLowerCase();
  return WEBCAST_BY_IDC[key] || WEBCAST_BY_IDC[IDC_ALIASES[key]] || null;
}

// Hosts to try, best guess first: explicit override, the IDC's host, then the
// rest of the known regional hosts, then the global default.
function candidateWebcastHosts(cookies, override) {
  const list = [];
  const add = (h) => {
    if (h && !list.includes(h)) list.push(h.replace(/\/+$/, ''));
  };
  add(override);
  add(webcastHostForIdc(idcFromCookies(cookies)));
  if ((cookies || []).some((c) => c.name === 'store-country-code' && /^us$/i.test(c.value))) {
    add(WEBCAST_BY_IDC.useast5);
    add(WEBCAST_BY_IDC.useast8);
  }
  for (const h of Object.values(WEBCAST_BY_IDC)) add(h);
  add(WEBCAST_DEFAULT);
  return list;
}

// /webcast/eco/check_access/ lists TikTok's LIVE Studio requirements as
// guidelines[].requirements[] with a pass flag. Field names for the text
// vary, so take the first string-looking one.
function studioRequirements(accessData) {
  const out = [];
  for (const g of accessData?.guidelines || []) {
    for (const r of g?.requirements || []) {
      const text = ['title', 'text', 'desc', 'description', 'name', 'content', 'requirement', 'key']
        .map((k) => r?.[k]).find((v) => typeof v === 'string' && v.trim());
      out.push({ text: text || 'Requirement', pass: !!r?.pass });
    }
  }
  return out;
}

const STUDIO_APPLY_URL = 'https://www.tiktok.com/falcon/live_g/live_studio_permission_apply/index.html';

// The official app opens this page (in the logged-in session) to apply.
function studioApplyUrl({ userId = '0', lang = 'en' } = {}) {
  const q = new URLSearchParams({ source: 'live_studio', aid: String(CLIENT.aid), user_id: userId || '0', lang, exp_group: 'v0' });
  return `${STUDIO_APPLY_URL}?${q}`;
}

// Accept "example.com/page" as well as full URLs; only http(s) pages.
function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

// A short, log-friendly view of a response's data: long arrays and strings cut down.
function summarize(value, max = 700) {
  const seen = new WeakSet();
  const trim = (v, depth) => {
    if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}...` : v;
    if (seen.has(v) || depth > 4) return '...';
    seen.add(v);
    if (Array.isArray(v)) return v.length > 4 ? [...v.slice(0, 4).map((x) => trim(x, depth + 1)), `+${v.length - 4} more`] : v.map((x) => trim(x, depth + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]));
  };
  const s = JSON.stringify(trim(value, 0));
  return s && s.length > max ? `${s.slice(0, max)}...` : s;
}

function apiMessage(body) {
  if (!body) return 'empty response';
  const d = body.data || {};
  return d.prompts || d.message || body.message || `status_code ${body.status_code}`;
}

module.exports = {
  CLIENT,
  RoomStatus,
  PingStatus,
  CreateStatus,
  md5Hex,
  formEncode,
  versionToSdk,
  buildCommonParams,
  splitPushUrl,
  pickPushUrl,
  obsAuth,
  maskKey,
  cookieHeader,
  hasSession,
  summarizeRoom,
  extractTopics,
  WEBCAST_DEFAULT,
  WEBCAST_BY_IDC,
  idcFromCookies,
  webcastHostForIdc,
  candidateWebcastHosts,
  summarize,
  normalizeUrl,
  studioRequirements,
  studioApplyUrl,
  apiMessage,
};
