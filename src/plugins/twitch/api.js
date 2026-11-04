'use strict';

// A small Twitch client: device-code login for a public client (no client
// secret), token refresh and validation, and the two Helix calls the Twitch
// plugin needs (set the channel's title and category, search categories).
//
// Public clients get one-time-use refresh tokens, so every refresh saves the
// new pair through setTokens. Twitch asks apps to validate the token at start
// and hourly after that; the plugin does.

const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const SCOPES = ['channel:manage:broadcast'];
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const TITLE_MAX = 140;

class TwitchError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function readBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

class TwitchApi {
  // getTokens() returns { access, refresh, login, userId } or null;
  // setTokens(tokens | null) saves them.
  constructor({ clientId, fetch = globalThis.fetch, getTokens, setTokens }) {
    this.clientId = clientId;
    this.fetch = fetch;
    this.getTokens = getTokens;
    this.setTokens = setTokens;
  }

  async _form(url, params) {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, body: await readBody(res) };
  }

  // Step 1: ask Twitch for a code the user enters at twitch.tv/activate.
  async startDeviceLogin() {
    const { status, body } = await this._form(`${ID}/device`, { client_id: this.clientId, scopes: SCOPES.join(' ') });
    if (status !== 200) throw new TwitchError(`Twitch login: ${body.message || `HTTP ${status}`}`, status);
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      interval: Number(body.interval) || 5,
      expiresIn: Number(body.expires_in) || 1800,
    };
  }

  // Step 2, repeated every `interval` seconds: 'pending' until the user
  // approves, 'slow_down' if we asked too often, 'done' once tokens are saved.
  async pollDeviceLogin(deviceCode) {
    const { status, body } = await this._form(`${ID}/token`, {
      client_id: this.clientId,
      scopes: SCOPES.join(' '),
      device_code: deviceCode,
      grant_type: DEVICE_GRANT,
    });
    if (status === 200 && body.access_token) {
      this.setTokens({ access: body.access_token, refresh: body.refresh_token || '', login: '', userId: '' });
      const who = await this.validate();
      if (!who) throw new TwitchError('Twitch login: the new token did not validate');
      return 'done';
    }
    const msg = String(body.message || '');
    if (msg === 'authorization_pending') return 'pending';
    if (msg === 'slow_down') return 'slow_down';
    throw new TwitchError(`Twitch login: ${msg || `HTTP ${status}`}`, status);
  }

  async refresh() {
    const t = this.getTokens();
    if (!t?.refresh) throw new TwitchError('Not logged in to Twitch', 401);
    const { status, body } = await this._form(`${ID}/token`, {
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refresh,
    });
    if (status !== 200 || !body.access_token) {
      this.setTokens(null);
      throw new TwitchError('Your Twitch login expired. Log in to Twitch again.', status || 401);
    }
    this.setTokens({ ...t, access: body.access_token, refresh: body.refresh_token || t.refresh });
    return true;
  }

  // Who the token belongs to, refreshing once if it has expired. Null when
  // logged out or the login can't be renewed.
  async validate({ retried = false } = {}) {
    const t = this.getTokens();
    if (!t?.access) return null;
    const res = await this.fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${t.access}` } });
    const body = await readBody(res);
    if (res.status === 200) {
      const who = { login: body.login || '', userId: body.user_id || '', scopes: body.scopes || [], expiresIn: Number(body.expires_in) || 0 };
      this.setTokens({ ...this.getTokens(), login: who.login, userId: who.userId });
      return who;
    }
    if (res.status === 401 && !retried) {
      try {
        await this.refresh();
      } catch {
        return null;
      }
      return this.validate({ retried: true });
    }
    throw new TwitchError(`Twitch: ${body.message || `HTTP ${res.status}`}`, res.status);
  }

  async helix(method, pathname, { query = {}, body, retried = false } = {}) {
    const t = this.getTokens();
    if (!t?.access) throw new TwitchError('Not logged in to Twitch', 401);
    const url = new URL(`${HELIX}${pathname}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await this.fetch(url.toString(), {
      method,
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${t.access}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await this.refresh();
      return this.helix(method, pathname, { query, body, retried: true });
    }
    const out = await readBody(res);
    if (res.status < 200 || res.status >= 300) throw new TwitchError(`Twitch: ${out.message || `HTTP ${res.status}`}`, res.status);
    return out;
  }

  // Sets the stream title and, if given, the category. Twitch caps titles
  // at 140 characters and refuses an empty one.
  async setChannel(broadcasterId, { title, gameId } = {}) {
    const body = {};
    const clean = String(title || '').trim().slice(0, TITLE_MAX);
    if (clean) body.title = clean;
    if (gameId) body.game_id = String(gameId);
    if (!Object.keys(body).length) return false;
    await this.helix('PATCH', '/channels', { query: { broadcaster_id: broadcasterId }, body });
    return true;
  }

  async searchCategories(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const out = await this.helix('GET', '/search/categories', { query: { query: q, first: 10 } });
    return (out.data || []).map((c) => ({ id: String(c.id), name: String(c.name) }));
  }

  async revoke() {
    const t = this.getTokens();
    this.setTokens(null);
    if (t?.access) await this._form(`${ID}/revoke`, { client_id: this.clientId, token: t.access }).catch(() => {});
  }
}

module.exports = { TwitchApi, TwitchError, SCOPES, TITLE_MAX };
