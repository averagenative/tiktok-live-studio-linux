'use strict';

// Serves the robot avatar page to an OBS Browser source on 127.0.0.1 and
// streams the mic level to it as Server-Sent Events.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'avatar');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const FILES = { '/avatar': 'index.html', '/avatar/': 'index.html', '/robot.js': 'robot.js', '/avatar/robot.js': 'robot.js' };

// obs-websocket InputVolumeMeters gives per-channel [magnitude, peak, inputPeak]
// as linear multipliers. Map the loudest channel's magnitude from -50..-10 dBFS
// onto 0..1.
function levelFromMeter(inputLevelsMul, { floorDb = -50, ceilDb = -10 } = {}) {
  let mul = 0;
  for (const ch of inputLevelsMul || []) mul = Math.max(mul, Number(ch?.[0]) || 0);
  if (mul <= 0) return 0;
  const db = 20 * Math.log10(mul);
  return Math.max(0, Math.min(1, (db - floorDb) / (ceilDb - floorDb)));
}

// Pick the mic out of a meters payload: an explicit name, then the names our
// setup and OBS's defaults use, then anything that looks like a mic.
function pickMic(inputs, preferred) {
  const names = (inputs || []).map((i) => i.inputName);
  for (const n of [preferred, 'Mic', 'Mic/Aux']) if (n && names.includes(n)) return n;
  return names.find((n) => /mic/i.test(n)) || null;
}

function startAvatarServer({ port = 47812, log = () => {} } = {}) {
  const clients = new Set();
  let last = 0;
  let lastSent = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ l: last })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const file = FILES[url.pathname];
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    fs.readFile(path.join(DIR, file), (err, buf) => {
      if (err) {
        res.writeHead(500).end(String(err.message));
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store' }).end(buf);
    });
  });

  const ready = new Promise((resolve) => {
    server.on('error', (e) => {
      log('warn', `avatar server: ${e.message}`);
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      log('app', `robot avatar served at http://127.0.0.1:${port}/avatar`);
      resolve(true);
    });
  });

  // Called at OBS's meter rate (~20 Hz); also send a heartbeat so the page
  // knows we're alive during silence.
  function push(level) {
    last = level;
    const now = Date.now();
    if (now - lastSent < 30) return;
    lastSent = now;
    const frame = `data: ${JSON.stringify({ l: Number(level.toFixed(3)) })}\n\n`;
    for (const c of clients) c.write(frame);
  }
  const beat = setInterval(() => push(last), 500);

  return {
    url: `http://127.0.0.1:${port}/avatar`,
    ready,
    push,
    clientCount: () => clients.size,
    close: () => {
      clearInterval(beat);
      for (const c of clients) c.end();
      server.close();
    },
  };
}

module.exports = { startAvatarServer, levelFromMeter, pickMic };
