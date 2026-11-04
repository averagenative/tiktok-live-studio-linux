'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PluginHost } = require('../src/plugins/host');

function memoryStore() {
  const s = { enabled: {}, data: {}, secrets: {} };
  return {
    s,
    enabled: (id) => s.enabled[id],
    setEnabled: (id, on) => { s.enabled[id] = on; },
    data: (id) => s.data[id] || {},
    setData: (id, obj) => { s.data[id] = obj; },
    secret: (id, name) => s.secrets[id]?.[name] || '',
    setSecret: (id, name, value) => {
      s.secrets[id] = { ...(s.secrets[id] || {}) };
      if (value) s.secrets[id][name] = value;
      else delete s.secrets[id][name];
    },
  };
}

function fakeDeps() {
  const obs = new EventEmitter();
  obs.connected = true;
  obs.call = async (type) => ({ type });
  const live = new EventEmitter();
  live.snapshot = () => ({ state: 'idle' });
  return { obs, live, obsConnect: async () => {}, obsState: () => ({ connected: true }), app: { marker: 1 } };
}

const settle = () => new Promise((r) => setImmediate(r));

function host(plugins, store = memoryStore(), deps = fakeDeps()) {
  const logs = [];
  const h = new PluginHost({ plugins, store, deps, log: (kind, message) => logs.push([kind, message]) });
  return { h, store, deps, logs };
}

test('plugins follow defaultEnabled until the user picks', async () => {
  const started = [];
  const mk = (id, defaultEnabled) => ({ id, name: id, description: '', defaultEnabled, activate: () => { started.push(id); } });
  const { h, store } = host([mk('a', true), mk('b', false)]);
  await h.start();
  assert.deepEqual(started, ['a']);
  assert.deepEqual(h.list().map((p) => [p.id, p.enabled]), [['a', true], ['b', false]]);
  await h.setEnabled('b', true);
  await h.setEnabled('a', false);
  assert.deepEqual(store.s.enabled, { b: true, a: false });
  assert.deepEqual(started, ['a', 'b']);
});

test('turning a plugin off clears its timers and listeners and calls deactivate', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let ticks = 0;
  let streams = 0;
  let deactivated = 0;
  const plugin = {
    id: 'p', name: 'P', defaultEnabled: true,
    activate(ctx) {
      ctx.every(1000, () => { ticks += 1; });
      ctx.obs.on('stream', () => { streams += 1; });
      return { deactivate() { deactivated += 1; } };
    },
  };
  const { h, deps } = host([plugin]);
  await h.start();
  t.mock.timers.tick(2000);
  await settle();
  deps.obs.emit('stream', {});
  assert.equal(ticks, 2);
  assert.equal(streams, 1);
  await h.setEnabled('p', false);
  t.mock.timers.tick(5000);
  await settle();
  deps.obs.emit('stream', {});
  assert.equal(ticks, 2);
  assert.equal(streams, 1);
  assert.equal(deactivated, 1);
  assert.equal(deps.obs.listenerCount('stream'), 0);
});

test('actions reach the running plugin and fail clearly when it is off', async () => {
  const seen = [];
  const plugin = {
    id: 'p', name: 'Pinger', defaultEnabled: false,
    activate: () => ({ action: (id, value) => { seen.push([id, value]); } }),
  };
  const { h } = host([plugin]);
  await h.start();
  await assert.rejects(h.action('p', 'go', 1), /Pinger plugin is off/);
  await h.setEnabled('p', true);
  await h.action('p', 'go', 2);
  assert.deepEqual(seen, [['go', 2]]);
});

test('a plugin that throws on start is reported, not fatal', async () => {
  const bad = { id: 'bad', name: 'Bad', defaultEnabled: true, activate() { throw new Error('boom'); } };
  const good = { id: 'good', name: 'Good', defaultEnabled: true, activate: (ctx) => ctx.ui.set({ title: 'Good', items: [] }) };
  const { h, logs } = host([bad, good]);
  await h.start();
  assert.equal(h.list().find((p) => p.id === 'bad').error, 'boom');
  assert.ok(logs.some(([k, m]) => k === 'error' && /Bad failed to start: boom/.test(m)));
  assert.deepEqual(Object.keys(h.cards()), ['good']);
});

test('card updates are batched into one change event, and stop after turning off', async () => {
  let ctxRef;
  const plugin = { id: 'p', name: 'P', defaultEnabled: true, activate: (ctx) => { ctxRef = ctx; } };
  const { h } = host([plugin]);
  const changes = [];
  h.on('change', (snap) => changes.push(snap));
  await h.start();
  await settle();
  changes.length = 0;
  ctxRef.ui.set({ title: 'one', items: [] });
  ctxRef.ui.set({ title: 'two', items: [] });
  await settle();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cards.p.title, 'two');
  await h.setEnabled('p', false);
  ctxRef.ui.set({ title: 'late', items: [] });
  assert.equal(h.cards().p, undefined);
  assert.equal(ctxRef.alive(), false);
});

test('data and secrets are kept per plugin', async () => {
  let ctxRef;
  const plugin = { id: 'p', name: 'P', defaultEnabled: true, activate: (ctx) => { ctxRef = ctx; } };
  const { h, store } = host([plugin]);
  await h.start();
  ctxRef.data.set({ a: 1 });
  ctxRef.data.set({ b: 2 });
  ctxRef.secrets.set('token', 'xyz');
  assert.deepEqual(store.s.data.p, { a: 1, b: 2 });
  assert.equal(ctxRef.secrets.get('token'), 'xyz');
  ctxRef.secrets.set('token', null);
  assert.equal(ctxRef.secrets.get('token'), '');
});
