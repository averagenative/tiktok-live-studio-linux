'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TikTokApi } = require('../src/tiktok');
const { md5Hex } = require('../src/util');

function stubFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const { status = 200, body } = handler(new URL(url), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'x-tt-logid': 'LOGID' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const cookies = [
  { name: 'sessionid', value: 'S' },
  { name: 'tt-target-idc', value: 'useast8' },
  { name: 'store-country-code', value: 'us' },
];

test('detectWebcastHost skips 403 and logged-out hosts and keeps the first that knows the session', async () => {
  const f = stubFetch((url) => {
    if (url.host === 'webcast16-normal-useast8.tiktokv.us') return { status: 403, body: '<html>Forbidden</html>' };
    if (url.host === 'webcast16-normal-useast5.tiktokv.us') return { body: { status_code: 20003, data: { message: "User doesn't login" } } };
    return { body: { status_code: 0, data: { hashtag: { id: 5, title: 'Gaming' } } } };
  });
  const logs = [];
  try {
    const api = new TikTokApi({ getCookies: async () => cookies, log: (k, m) => logs.push(m) });
    const { base, body } = await api.detectWebcastHost('');
    assert.equal(base, 'https://webcast16-normal-c-alisg.tiktokv.com');
    assert.equal(body.status_code, 0);
    assert.equal(api.webcastBase, base);
    assert.deepEqual(f.calls.map((c) => c.url.host).slice(0, 3),
      ['webcast16-normal-useast8.tiktokv.us', 'webcast16-normal-useast5.tiktokv.us', 'webcast16-normal-c-alisg.tiktokv.com']);
    assert.ok(logs.some((m) => m.includes('HTTP 403 body: <html>Forbidden</html>')));

    await api.pingAnchor({ status: 1, roomId: 'R', streamId: 'T' });
    const ping = f.calls.at(-1);
    assert.equal(ping.url.host, 'webcast16-normal-c-alisg.tiktokv.com');
    assert.equal(ping.init.headers['x-ss-stub'], md5Hex(ping.init.body));
    assert.equal(ping.init.headers.cookie, 'sessionid=S; tt-target-idc=useast8; store-country-code=us');
    assert.equal(ping.init.headers['x-tt-store-region'], 'us');
    assert.equal(ping.url.searchParams.get('aid'), '8311');
  } finally {
    f.restore();
  }
});

test('detectWebcastHost reports logged-out when every host says so', async () => {
  const f = stubFetch(() => ({ body: { status_code: 20003, data: { prompts: 'Please login first' } } }));
  try {
    const api = new TikTokApi({ getCookies: async () => cookies });
    const { base, body } = await api.detectWebcastHost('');
    assert.equal(base, null);
    assert.equal(body.status_code, 20003);
  } finally {
    f.restore();
  }
});

test('a request that never answers fails with a timeout instead of hanging', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  try {
    const api = new TikTokApi({ getCookies: async () => [] });
    await assert.rejects(api.getCreateInfo(), /timed out after 20 s/);
  } finally {
    globalThis.fetch = orig;
  }
});
