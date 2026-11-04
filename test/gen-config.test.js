'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, clientIdFrom, CLIENT_ID } = require('../scripts/gen-config');

test('parseEnv reads plain, exported, quoted, and commented lines', () => {
  const env = parseEnv([
    '# Twitch',
    'clientid=abc123def456ghi789jkl012mno345',
    'export TWITCH_CLIENT_ID="quoted0123456789quoted0123"',
    "OTHER='single # not a comment'",
    'TRAILING=value # a comment',
    'not a pair',
    '',
  ].join('\n'));
  assert.equal(env.clientid, 'abc123def456ghi789jkl012mno345');
  assert.equal(env.twitch_client_id, 'quoted0123456789quoted0123');
  assert.equal(env.other, 'single # not a comment');
  assert.equal(env.trailing, 'value');
  assert.equal(Object.keys(env).length, 4);
});

test('clientIdFrom takes the environment first, then .env names', () => {
  assert.equal(clientIdFrom({ clientid: 'a1' }), 'a1');
  assert.equal(clientIdFrom({ client_id: 'b2' }), 'b2');
  assert.equal(clientIdFrom({ clientid: 'a1' }, { TWITCH_CLIENT_ID: 'c3' }), 'c3');
  assert.equal(clientIdFrom({}), '');
  assert.ok(CLIENT_ID.test('abc123def456ghi789jkl012mno345'));
  assert.equal(CLIENT_ID.test('short'), false);
});
