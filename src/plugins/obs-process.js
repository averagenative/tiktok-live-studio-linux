'use strict';

// Finding, checking on, and starting OBS on this computer.

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FLATPAK_ID = 'com.obsproject.Studio';

// Directories on a PATH-like variable, minus any inside the AppImage.
function pathDirs(value, appDir) {
  return String(value || '').split(':').filter((d) => d && !(appDir && (d === appDir || d.startsWith(`${appDir}/`))));
}

function isExecutable(file, { statSync = fs.statSync } = {}) {
  try {
    const st = statSync(file);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function which(name, env, opts) {
  for (const dir of pathDirs(env.PATH, env.APPDIR)) {
    const file = path.join(dir, name);
    if (isExecutable(file, opts)) return file;
  }
  return null;
}

// The OBS installs this computer has, packaged one first.
function findObs({ env = process.env, home = os.homedir(), existsSync = fs.existsSync, statSync = fs.statSync } = {}) {
  const found = [];
  const native = which('obs', env, { statSync });
  if (native) found.push({ kind: 'native', label: 'OBS (installed package)', cmd: native, args: [] });
  const flatpak = which('flatpak', env, { statSync });
  const installed = [
    path.join('/var/lib/flatpak/app', FLATPAK_ID),
    path.join(home, '.local/share/flatpak/app', FLATPAK_ID),
  ].some((d) => existsSync(d));
  if (flatpak && installed) found.push({ kind: 'flatpak', label: 'OBS (Flatpak)', cmd: flatpak, args: ['run', FLATPAK_ID] });
  return found;
}

// True when any process is named obs. Flatpak's OBS shows up the same way.
function obsRunning({ readdirSync = fs.readdirSync, readFileSync = fs.readFileSync, proc = '/proc' } = {}) {
  let entries;
  try {
    entries = readdirSync(proc);
  } catch {
    return false;
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (readFileSync(path.join(proc, pid, 'comm'), 'utf8').trim() === 'obs') return true;
    } catch {
      // the process exited while we looked
    }
  }
  return false;
}

// The environment for OBS: the user's own, without what the AppImage and
// Electron add for themselves. Inherited AppImage library paths can make OBS
// load the wrong Qt or fail to start.
function launchEnv(env = process.env) {
  const out = { ...env };
  const appDir = env.APPDIR;
  for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'QT_PLUGIN_PATH', 'GSETTINGS_SCHEMA_DIR', 'PYTHONPATH', 'PERLLIB']) {
    if (!(key in out)) continue;
    const kept = pathDirs(out[key], appDir);
    if (kept.length) out[key] = kept.join(':');
    else delete out[key];
  }
  for (const key of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'GIO_LAUNCHED_DESKTOP_FILE', 'GIO_LAUNCHED_DESKTOP_FILE_PID']) {
    delete out[key];
  }
  // Chromium can rewrite XDG_CURRENT_DESKTOP; put back what the session set.
  if (out.ORIGINAL_XDG_CURRENT_DESKTOP) out.XDG_CURRENT_DESKTOP = out.ORIGINAL_XDG_CURRENT_DESKTOP;
  delete out.ORIGINAL_XDG_CURRENT_DESKTOP;
  return out;
}

const isLoopback = (a) => a.startsWith('127.') || a === '::1' || a.startsWith('::ffff:127.');

// Whether an OBS host setting points at this computer: loopback, one of this
// computer's own addresses (a LAN or Tailscale IP), its hostname, or a name
// that resolves to one of those.
async function isThisComputer(host, {
  interfaces = os.networkInterfaces(),
  hostname = os.hostname(),
  lookup = (h) => dns.promises.lookup(h, { all: true }),
} = {}) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  const own = new Set(Object.values(interfaces).flat().filter(Boolean).map((i) => String(i.address).toLowerCase()));
  const mine = (a) => isLoopback(a) || own.has(a);
  if (net.isIP(h)) return mine(h);
  const name = String(hostname).toLowerCase();
  if (h === name || h === `${name}.local`) return true;
  try {
    return (await lookup(h)).some((r) => mine(String(r.address).toLowerCase()));
  } catch {
    return false;
  }
}

function obsArgs({ minimized = false, profile = '', collection = '' } = {}) {
  const args = [];
  if (profile) args.push('--profile', profile);
  if (collection) args.push('--collection', collection);
  if (minimized) args.push('--minimize-to-tray');
  return args;
}

// Starts OBS on its own, so it keeps running if this app quits. Resolves once
// the process exists, and rejects if it couldn't start (a missing binary).
function launchObs(install, options = {}, { spawnFn = spawn, env = process.env } = {}) {
  const args = [...install.args, ...obsArgs(options)];
  return new Promise((resolve, reject) => {
    const child = spawnFn(install.cmd, args, { detached: true, stdio: 'ignore', env: launchEnv(env), cwd: os.homedir() });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ cmd: install.cmd, args, pid: child.pid });
    });
  });
}

module.exports = { findObs, obsRunning, isThisComputer, launchEnv, obsArgs, launchObs, pathDirs, FLATPAK_ID };
