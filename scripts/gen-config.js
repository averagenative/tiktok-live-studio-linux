#!/usr/bin/env node
'use strict';

// Writes build-time settings from .env into a file the app packages, so a
// release can ship the project's Twitch app client ID without it being in
// git. Both .env and the generated file are git-ignored.
//
//   clientid=<Twitch app client ID>      (TWITCH_CLIENT_ID works too)
//
// The TWITCH_CLIENT_ID environment variable wins over .env. Without either,
// the generated file is removed and the app asks each user for a client ID.
// A public client ID isn't a secret: it ends up inside every AppImage.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'plugins', 'twitch', 'client-id.json');
const CLIENT_ID = /^[a-z0-9]{20,40}$/i;

// KEY=value lines, with optional `export`, quotes, and # comments.
// Keys come back lowercased.
function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    out[m[1].toLowerCase()] = value;
  }
  return out;
}

function clientIdFrom(env, processEnv = {}) {
  return (processEnv.TWITCH_CLIENT_ID || env.clientid || env.client_id || env.twitch_client_id || '').trim();
}

function main() {
  let env = {};
  try {
    env = parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const id = clientIdFrom(env, process.env);
  if (id && !CLIENT_ID.test(id)) {
    console.error("gen-config: the Twitch client ID in .env doesn't look like one (20 to 40 letters and digits)");
    process.exit(1);
  }
  if (id) {
    fs.writeFileSync(OUT, `${JSON.stringify({ clientId: id })}\n`);
    console.log('gen-config: built-in Twitch client ID set');
  } else {
    fs.rmSync(OUT, { force: true });
    console.log('gen-config: no Twitch client ID; users paste their own');
  }
}

if (require.main === module) main();

module.exports = { parseEnv, clientIdFrom, CLIENT_ID };
