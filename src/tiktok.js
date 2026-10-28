'use strict';

// Minimal client for the webcast endpoints LIVE Studio uses to run a LIVE.
// It sends the logged-in user's own cookies and nothing else: no request
// signing, no device registration. See docs/PROTOCOL.md.

const { CLIENT, md5Hex, formEncode, buildCommonParams, cookieHeader, apiMessage } = require('./util');

const WEBCAST = 'https://webcast.tiktokv.com';
const WWW = 'https://www.tiktok.com';

function defaultUserAgent() {
  const chrome = process.versions.chrome || '140.0.0.0';
  const electron = process.versions.electron || '38.0.0';
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) `
    + `TikTokLIVEStudio/${CLIENT.version} Chrome/${chrome} Electron/${electron} Safari/537.36`;
}

class ApiError extends Error {
  constructor(message, { statusCode, httpStatus, logId, body } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.httpStatus = httpStatus;
    this.logId = logId;
    this.body = body;
  }
}

class TikTokApi {
  constructor({ getCookies, getLanguage = () => 'en', getScreen = () => null, log = () => {},
    platform = 'mac', userAgent = defaultUserAgent() }) {
    this.getCookies = getCookies;
    this.getLanguage = getLanguage;
    this.getScreen = getScreen;
    this.log = log;
    this.platform = platform;
    this.userAgent = userAgent;
  }

  async _cookies() {
    const cookies = (await this.getCookies()) || [];
    const region = cookies.find((c) => c.name === 'store-country-code')?.value;
    return { header: cookieHeader(cookies), region };
  }

  async request(method, path, { params = {}, form, base = WEBCAST, common = true } = {}) {
    const { header, region } = await this._cookies();
    const lang = this.getLanguage();
    const url = new URL(path, base);
    const query = common
      ? {
        ...buildCommonParams({
          language: lang,
          platform: this.platform,
          region,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          screen: this.getScreen(),
        }),
        browser_language: lang,
        browser_platform: this.platform === 'mac' ? 'MacIntel' : 'Win32',
        browser_name: 'Mozilla',
        browser_version: this.userAgent.replace(/^Mozilla\//, ''),
        ...params,
      }
      : params;
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = {
      'user-agent': this.userAgent,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      sdk_aid: String(CLIENT.aid),
      referer: `${WWW}/`,
    };
    if (header) headers.cookie = header;
    if (region) headers['x-tt-store-region'] = region;

    let body;
    if (method === 'POST') {
      body = formEncode(form || {});
      headers['x-ss-stub'] = md5Hex(body);
    }

    const res = await fetch(url, { method, headers, body, redirect: 'follow' });
    const logId = res.headers.get('x-tt-logid') || '';
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    this.log('api', `${method} ${url.pathname} -> HTTP ${res.status}`
      + `${json && json.status_code !== undefined ? ` status_code=${json.status_code}` : ''}`
      + `${logId ? ` logid=${logId}` : ''}`);
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status} from ${url.pathname}`, { httpStatus: res.status, logId, body: text.slice(0, 500) });
    }
    if (!json) {
      throw new ApiError(`Non-JSON response from ${url.pathname}`, { httpStatus: res.status, logId, body: text.slice(0, 500) });
    }
    json.__logId = logId;
    return json;
  }

  // Passport account info on www.tiktok.com: who is logged in.
  async getAccountInfo() {
    const body = await this.request('GET', '/passport/web/account/info/', {
      base: WWW,
      common: false,
      params: { aid: CLIENT.aid, app_name: CLIENT.appName, device_platform: 'web_pc' },
    });
    const d = body?.data || {};
    if (!d.user_id_str && !d.user_id) {
      throw new ApiError(apiMessage(body), { statusCode: body?.status_code ?? d.error_code, body });
    }
    return {
      userId: d.user_id_str || String(d.user_id),
      username: d.username || '',
      nickname: d.screen_name || d.name || d.username || '',
      avatar: d.avatar_url || '',
    };
  }

  // Go-live precheck: tells us whether this account may start a LIVE and
  // carries the default title, topic and permission flags.
  getCreateInfo(extra = {}) {
    return this.request('GET', '/webcast/room/create_info/', { params: { live_studio: 1, ...extra } });
  }

  getHashtags() {
    return this.request('GET', '/webcast/room/hashtag/list/', { params: { live_studio: 1 } });
  }

  createRoom(fields) {
    return this.request('POST', '/webcast/room/create/', { form: fields });
  }

  pingAnchor({ status, roomId, streamId }) {
    return this.request('POST', '/webcast/room/ping/anchor/', {
      form: { status, room_id: roomId, stream_id: streamId },
    });
  }
}

module.exports = { TikTokApi, ApiError, defaultUserAgent, WEBCAST, WWW };
