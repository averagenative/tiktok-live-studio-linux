'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { findObs, obsRunning, isThisComputer, launchEnv, obsArgs, launchObs } = require('../src/plugins/obs-process');

const exe = (files) => (f) => {
  if (!files.includes(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return { isFile: () => true, mode: 0o755 };
};

test('launchEnv drops what the AppImage and Electron added', () => {
  const env = launchEnv({
    HOME: '/home/me',
    APPDIR: '/tmp/.mount_live',
    APPIMAGE: '/home/me/Applications/live.AppImage',
    ARGV0: 'live',
    OWD: '/home/me',
    PATH: '/tmp/.mount_live/usr/bin:/usr/local/bin:/usr/bin',
    LD_LIBRARY_PATH: '/tmp/.mount_live/usr/lib',
    XDG_DATA_DIRS: '/tmp/.mount_live/usr/share:/usr/share',
    CHROME_DESKTOP: 'live.desktop',
    ELECTRON_RUN_AS_NODE: '1',
    ORIGINAL_XDG_CURRENT_DESKTOP: 'GNOME',
    XDG_CURRENT_DESKTOP: 'Unity',
    WAYLAND_DISPLAY: 'wayland-0',
  });
  assert.equal(env.PATH, '/usr/local/bin:/usr/bin');
  assert.equal(env.XDG_DATA_DIRS, '/usr/share');
  assert.equal(env.XDG_CURRENT_DESKTOP, 'GNOME');
  assert.equal(env.WAYLAND_DISPLAY, 'wayland-0');
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'LD_LIBRARY_PATH', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE', 'ORIGINAL_XDG_CURRENT_DESKTOP']) {
    assert.equal(k in env, false, k);
  }
});

test('launchEnv leaves a normal environment alone', () => {
  const env = { PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/cuda/lib64', HOME: '/home/me' };
  assert.deepEqual(launchEnv(env), env);
});

test('findObs lists the packaged OBS, then the Flatpak', () => {
  const env = { PATH: '/usr/bin' };
  const both = findObs({
    env, home: '/home/me', statSync: exe(['/usr/bin/obs', '/usr/bin/flatpak']),
    existsSync: (d) => d === '/home/me/.local/share/flatpak/app/com.obsproject.Studio',
  });
  assert.deepEqual(both.map((i) => [i.kind, i.cmd, i.args]), [
    ['native', '/usr/bin/obs', []],
    ['flatpak', '/usr/bin/flatpak', ['run', 'com.obsproject.Studio']],
  ]);
  const none = findObs({ env, home: '/home/me', statSync: exe(['/usr/bin/flatpak']), existsSync: () => false });
  assert.deepEqual(none, []);
});

test('findObs ignores an obs inside the AppImage', () => {
  const env = { PATH: '/tmp/.mount_x/usr/bin:/usr/bin', APPDIR: '/tmp/.mount_x' };
  assert.deepEqual(findObs({ env, home: '/h', statSync: exe(['/tmp/.mount_x/usr/bin/obs']), existsSync: () => false }), []);
});

test('obsRunning looks for a process named obs', () => {
  const procs = { 1: 'systemd\n', 200: 'gnome-shell\n', 4242: 'obs\n' };
  const fake = (list) => ({
    readdirSync: () => ['self', ...Object.keys(list)],
    readFileSync: (f) => {
      const pid = f.split('/')[2];
      if (!(pid in list)) throw new Error('gone');
      return list[pid];
    },
  });
  assert.equal(obsRunning(fake(procs)), true);
  assert.equal(obsRunning(fake({ 1: 'systemd\n', 9: 'obs-ffmpeg-mux\n' })), false);
});

test('obsArgs passes the profile, scene collection, and tray options', () => {
  assert.deepEqual(obsArgs({ profile: 'TikTok Vertical', collection: 'TikTok Vertical', minimized: true }),
    ['--profile', 'TikTok Vertical', '--collection', 'TikTok Vertical', '--minimize-to-tray']);
  assert.deepEqual(obsArgs(), []);
});

test('launchObs starts OBS detached and reports a failed start', async () => {
  const calls = [];
  const spawnOk = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.pid = 99;
    child.unref = () => { child.unrefed = true; };
    setImmediate(() => child.emit('spawn'));
    calls.child = child;
    return child;
  };
  const r = await launchObs({ cmd: '/usr/bin/flatpak', args: ['run', 'com.obsproject.Studio'] }, { minimized: true },
    { spawnFn: spawnOk, env: { PATH: '/usr/bin', APPDIR: '/tmp/a' } });
  assert.deepEqual(r.args, ['run', 'com.obsproject.Studio', '--minimize-to-tray']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
  assert.equal('APPDIR' in calls[0].opts.env, false);
  assert.equal(calls.child.unrefed, true);

  const spawnBad = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('error', new Error('spawn obs ENOENT')));
    return child;
  };
  await assert.rejects(launchObs({ cmd: 'obs', args: [] }, {}, { spawnFn: spawnBad, env: {} }), /ENOENT/);
});

test('isThisComputer knows loopback, its own addresses, and its own names', async () => {
  const opts = {
    interfaces: {
      lo: [{ address: '127.0.0.1' }, { address: '::1' }],
      wlp9s0: [{ address: '192.168.88.68' }, { address: 'fe80::1234' }],
      tailscale0: [{ address: '100.95.164.60' }],
    },
    hostname: 'behemoth',
    lookup: async (h) => {
      if (h === 'obs.lan') return [{ address: '192.168.88.68' }];
      if (h === 'other.lan') return [{ address: '192.168.88.70' }];
      throw new Error('ENOTFOUND');
    },
  };
  for (const h of ['', '127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]', '192.168.88.68', '100.95.164.60', 'behemoth', 'Behemoth.local', 'obs.lan']) {
    assert.equal(await isThisComputer(h, opts), true, h);
  }
  for (const h of ['192.168.88.70', '10.0.0.5', 'other.lan', 'nowhere.invalid']) {
    assert.equal(await isThisComputer(h, opts), false, h);
  }
});
