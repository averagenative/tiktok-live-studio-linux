'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { keepObsConnected } = require('../src/obs');

// Stands in for ObsClient: each connect() takes the next scripted outcome.
class FakeObs extends EventEmitter {
  constructor(outcomes) {
    super();
    this.outcomes = outcomes;
    this.connected = false;
    this.calls = 0;
  }

  async connect() {
    this.calls += 1;
    const next = this.outcomes.shift();
    if (next instanceof Error) throw next;
    this.connected = true;
  }

  drop() {
    this.connected = false;
    this.emit('disconnected', 1006);
  }
}

const unreachable = () => new Error('Could not reach OBS at 127.0.0.1:4455. Is the WebSocket server enabled?');
const settle = () => new Promise((r) => setImmediate(r));

function setup(t, outcomes) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const obs = new FakeObs(outcomes);
  const states = [];
  const logs = [];
  const link = keepObsConnected(obs, {
    options: () => ({}),
    retryMs: 5000,
    onState: (error) => states.push(error),
    log: (_tag, msg) => logs.push(msg),
  });
  return { obs, link, states, logs };
}

test('keepObsConnected retries until OBS comes up, logging the failure once', async (t) => {
  const { obs, link, states, logs } = setup(t, [unreachable(), unreachable(), 'ok']);
  await assert.rejects(link.connect(), /Could not reach OBS/);
  assert.equal(link.retrying, true);

  t.mock.timers.tick(5000);
  await settle();
  assert.equal(obs.calls, 2);
  assert.equal(obs.connected, false);

  t.mock.timers.tick(5000);
  await settle();
  assert.equal(obs.calls, 3);
  assert.equal(obs.connected, true);
  assert.equal(link.retrying, false);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /retrying every 5s/);
  assert.equal(states.at(-1), '');
});

test('keepObsConnected stops retrying when OBS rejects the password', async (t) => {
  const bad = Object.assign(new Error('OBS rejected the WebSocket password'), { auth: true });
  const { obs, link, states } = setup(t, [bad]);
  await assert.rejects(link.connect(), /password/);
  assert.equal(link.retrying, false);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(obs.calls, 1);
  assert.equal(states.at(-1), 'OBS rejected the WebSocket password');
});

test('keepObsConnected reconnects after OBS goes away', async (t) => {
  const { obs, link } = setup(t, ['ok', 'ok']);
  await link.connect();
  obs.drop();
  assert.equal(link.retrying, true);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(obs.calls, 2);
  assert.equal(obs.connected, true);
});

test('keepObsConnected leaves OBS alone after stop()', async (t) => {
  const { obs, link } = setup(t, [unreachable(), 'ok']);
  await assert.rejects(link.connect());
  link.stop();
  assert.equal(link.retrying, false);
  obs.drop();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(obs.calls, 1);
});

test('keepObsConnected does nothing on a drop it was never asked to connect', async (t) => {
  const { obs, link } = setup(t, ['ok']);
  obs.drop();
  assert.equal(link.retrying, false);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(obs.calls, 0);
});
