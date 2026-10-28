'use strict';

// Minimal client for the webcast endpoints LIVE Studio uses to run a LIVE.
// It sends the logged-in user's own cookies and nothing else: no request
// signing, no device registration. See docs/PROTOCOL.md.

const {
  CLIENT, md5Hex, formEncode, buildCommonParams, cookieHeader, apiMessage, candidateWebcastHosts, WEBCAST_DEFAULT,
} = require('./util');

const WEBCAST = WEBCAST_DEFAULT;
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
    this.webcastBase = WEBCAST;
  }

  async _cookies() {
    const cookies = (await this.getCookies()) || [];
    const region = cookies.find((c) => c.name === 'store-country-code')?.value;
    return { header: cookieHeader(cookies), region };
  }

  async request(method, path, { params = {}, form, base, common = true } = {}) {
    const { header, region } = await this._cookies();
    const lang = this.getLanguage();
    const url = new URL(path, base || this.webcastBase);
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

    let res;
    try {
      res = await fetch(url, { method, headers, body, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    } catch (e) {
      const why = e.name === 'TimeoutError' ? 'timed out after 20 s' : e.message;
      this.log('api', `${method} ${url.host}${url.pathname} -> ${why}`);
      throw new ApiError(`${url.pathname} ${why}`);
    }
    const logId = res.headers.get('x-tt-logid') || '';
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    this.log('api', `${method} ${url.host}${url.pathname} -> HTTP ${res.status}`
      + `${json && json.status_code !== undefined ? ` status_code=${json.status_code}` : ''}`
      + `${logId ? ` logid=${logId}` : ''}`);
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (snippet) this.log('api', `HTTP ${res.status} body: ${snippet}`);
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
  getCreateInfo(extra = {}, base) {
    return this.request('GET', '/webcast/room/create_info/', { base, params: { live_studio: 1, ...extra } });
  }

  // Find the webcast host for this account's data center by asking each
  // candidate for the go-live precheck, and keep the first one that knows
  // the session. Returns that host and its create_info response.
  async detectWebcastHost(override) {
    const candidates = candidateWebcastHosts(await this.getCookies(), override);
    let lastBody = null;
    let lastErr = null;
    for (const base of candidates) {
      try {
        const body = await this.getCreateInfo({}, base);
        if (body.status_code !== 20003) {
          this.webcastBase = base;
          this.log('api', `using webcast host ${new URL(base).host}`);
          return { base, body };
        }
        lastBody = body;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastBody) return { base: null, body: lastBody };
    throw lastErr || new Error('No webcast host answered');
  }

  // LIVE Studio access is a separate grant from going LIVE in the phone app.
  // live_podcast carries live_scenario.enable_live_studio and the
  // live_studio_permission_status the official app shows.
  getStudioPermission() {
    return this.request('GET', '/webcast/room/live_podcast/');
  }

  checkStudioAccess() {
    return this.request('GET', '/webcast/eco/check_access/', { params: { permission_type: 1 } });
  }

  getStudioApplyInfo() {
    return this.request('GET', '/webcast/room/live_permission/apply_info/', { params: { permission_name: 'live_studio' } });
  }

  // The official app's "Apply" button: asks TikTok to grant LIVE Studio access.
  applyStudioPermission() {
    return this.request('POST', '/webcast/room/live_permission/apply/', { form: { permission_name: 'live_studio' } });
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
