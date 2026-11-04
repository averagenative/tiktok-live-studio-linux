'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TwitchApi, TITLE_MAX } = require('../src/plugins/twitch/api');

// Scripted fetch: each route returns the next response for that URL.
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const key = `${opts.method || 'GET'} ${u.origin}${u.pathname}`;
    calls.push({ key, url: u, opts, form: opts.body && !String(opts.headers?.['Content-Type']).includes('json') ? new URLSearchParams(opts.body) : null });
    const queue = routes[key];
    if (!queue || !queue.length) throw new Error(`unexpected ${key}`);
    const [status, body] = queue.shift();
    return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  return { fetch, calls };
}

function client(routes, tokens = null) {
  const store = { tokens };
  const { fetch, calls } = fakeFetch(routes);
  const api = new TwitchApi({ clientId: 'cid123', fetch, getTokens: () => store.tokens, setTokens: (t) => { store.tokens = t; } });
  return { api, calls, store };
}

const VALIDATE_OK = [200, { client_id: 'cid123', login: 'averagenative', user_id: '42', scopes: ['channel:manage:broadcast'], expires_in: 14000 }];

test('device login: code, pending, slow down, then tokens and who it is', async () => {
  const { api, calls, store } = client({
    'POST https://id.twitch.tv/oauth2/device': [[200, { device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCDEFGH', interval: 5, expires_in: 1800 }]],
    'POST https://id.twitch.tv/oauth2/token': [
      [400, { status: 400, message: 'authorization_pending' }],
      [400, { status: 400, message: 'slow_down' }],
      [200, { access_token: 'at1', refresh_token: 'rt1', scope: ['channel:manage:broadcast'], token_type: 'bearer', expires_in: 14000 }],
    ],
    'GET https://id.twitch.tv/oauth2/validate': [VALIDATE_OK],
  });
  const d = await api.startDeviceLogin();
  assert.deepEqual(d, { deviceCode: 'dev', userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate?device-code=ABCDEFGH', interval: 5, expiresIn: 1800 });
  assert.equal(calls[0].form.get('scopes'), 'channel:manage:broadcast');
  assert.equal(calls[0].form.get('client_id'), 'cid123');
  assert.equal(await api.pollDeviceLogin('dev'), 'pending');
  assert.equal(await api.pollDeviceLogin('dev'), 'slow_down');
  assert.equal(await api.pollDeviceLogin('dev'), 'done');
  assert.equal(calls[1].form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(calls[1].form.get('device_code'), 'dev');
  assert.deepEqual(store.tokens, { access: 'at1', refresh: 'rt1', login: 'averagenative', userId: '42' });
  assert.equal(calls.at(-1).opts.headers.Authorization, 'OAuth at1');
});

test('device login: an expired or refused code is an error', async () => {
  const { api } = client({ 'POST https://id.twitch.tv/oauth2/token': [[400, { status: 400, message: 'invalid device code' }]] });
  await assert.rejects(api.pollDeviceLogin('dev'), /invalid device code/);
});

test('helix refreshes an expired token once and saves the new pair', async () => {
  const { api, calls, store } = client({
    'PATCH https://api.twitch.tv/helix/channels': [[401, { message: 'Invalid OAuth token' }], [204]],
    'POST https://id.twitch.tv/oauth2/token': [[200, { access_token: 'at2', refresh_token: 'rt2' }]],
  }, { access: 'at1', refresh: 'rt1', login: 'me', userId: '42' });
  assert.equal(await api.setChannel('42', { title: 'hello', gameId: '509658' }), true);
  const [first, refresh, second] = calls;
  assert.equal(first.url.searchParams.get('broadcaster_id'), '42');
  assert.equal(first.opts.headers['Client-Id'], 'cid123');
  assert.equal(refresh.form.get('grant_type'), 'refresh_token');
  assert.equal(refresh.form.get('refresh_token'), 'rt1');
  assert.equal(refresh.form.get('client_secret'), null, 'public clients send no secret');
  assert.equal(second.opts.headers.Authorization, 'Bearer at2');
  assert.deepEqual(JSON.parse(second.opts.body), { title: 'hello', game_id: '509658' });
  assert.deepEqual(store.tokens, { access: 'at2', refresh: 'rt2', login: 'me', userId: '42' });
});

test('a refresh Twitch refuses logs you out', async () => {
  const { api, store } = client({
    'GET https://id.twitch.tv/oauth2/validate': [[401, { status: 401, message: 'invalid access token' }]],
    'POST https://id.twitch.tv/oauth2/token': [[400, { status: 400, message: 'Invalid refresh token' }]],
  }, { access: 'old', refresh: 'used', login: 'me', userId: '42' });
  assert.equal(await api.validate(), null);
  assert.equal(store.tokens, null);
});

test('setChannel trims long titles and skips empty updates', async () => {
  const { api, calls } = client({ 'PATCH https://api.twitch.tv/helix/channels': [[204]] }, { access: 'a', refresh: 'r' });
  assert.equal(await api.setChannel('42', { title: '   ' }), false);
  assert.equal(calls.length, 0);
  await api.setChannel('42', { title: `  ${'x'.repeat(200)}  ` });
  assert.equal(JSON.parse(calls[0].opts.body).title.length, TITLE_MAX);
});

test('searchCategories returns ids and names', async () => {
  const { api, calls } = client({
    'GET https://api.twitch.tv/helix/search/categories': [[200, { data: [{ id: 509658, name: 'Just Chatting', box_art_url: 'x' }] }]],
  }, { access: 'a', refresh: 'r' });
  assert.deepEqual(await api.searchCategories('just'), [{ id: '509658', name: 'Just Chatting' }]);
  assert.equal(calls[0].url.searchParams.get('query'), 'just');
  assert.deepEqual(await api.searchCategories('  '), []);
});

test('revoke forgets the tokens even if Twitch is unreachable', async () => {
  const store = { tokens: { access: 'a', refresh: 'r' } };
  const api = new TwitchApi({ clientId: 'c', fetch: async () => { throw new Error('offline'); }, getTokens: () => store.tokens, setTokens: (t) => { store.tokens = t; } });
  await api.revoke();
  assert.equal(store.tokens, null);
});
