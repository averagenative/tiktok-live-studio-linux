'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, session, clipboard, shell, screen, safeStorage } = require('electron');
const { TikTokApi } = require('./tiktok');
const { ObsClient } = require('./obs');
const { LiveSession } = require('./session');
const { setupTikTok, setRobotAvatar, PROFILE: OBS_PROFILE } = require('./obs-setup');
const { startAvatarServer, levelFromMeter, pickMic } = require('./avatar-server');
const { hasSession, extractTopics, apiMessage, idcFromCookies, summarize, studioRequirements, studioApplyUrl, normalizeUrl } = require('./util');

app.setName('LIVE Studio for Linux');

// GNOME only lets X11 windows keep themselves on top, which the pinned window
// needs, so run through XWayland. LSL_WAYLAND=1 opts out.
// Chromium's default GL under XWayland crashes the GPU process on hybrid
// Intel/NVIDIA laptops; EGL works.
if (process.platform === 'linux' && !process.env.LSL_WAYLAND) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('use-gl', 'egl');
}

const PARTITION = 'persist:tiktok';
const LOGIN_URL = 'https://www.tiktok.com/login';
const LOG_MAX = 500;

// A plain Chrome-on-Linux UA for the login page; TikTok's login is happiest
// in something that looks like a normal browser.
const BROWSER_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

let mainWin = null;
let loginWin = null;
const logs = [];
let account = null;
let createInfo = null;
let topics = [];
let studio = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---- settings -------------------------------------------------------------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  theme: 'dark',
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPasswordEnc: '',
  driveObs: true,
  useTikTokProfile: true,
  robotAvatar: false,
  pinUrl: '',
  pinOpacity: 0.85,
  pinClickThrough: false,
  pinBounds: null,
  avatarMic: '',
  vertical: true,
  platform: 'mac',
  language: 'en',
  lastTitle: '',
  lastTopicId: '',
  webcastHost: '',
};
let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}

function obsPassword() {
  if (!settings.obsPasswordEnc) return '';
  try {
    const buf = Buffer.from(settings.obsPasswordEnc, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return '';
  }
}

function setObsPassword(pw) {
  if (!pw) {
    settings.obsPasswordEnc = '';
    return;
  }
  settings.obsPasswordEnc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(pw).toString('base64')
    : Buffer.from(pw, 'utf8').toString('base64');
}

function publicSettings() {
  const { obsPasswordEnc, ...rest } = settings;
  return { ...rest, hasObsPassword: !!obsPasswordEnc };
}

// ---- logging / push to renderer ------------------------------------------

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

function log(kind, message) {
  const entry = { t: Date.now(), kind, message };
  logs.push(entry);
  if (logs.length > LOG_MAX) logs.shift();
  send('log', entry);
  if (!app.isPackaged) console.log(`[${kind}] ${message}`);
}

// ---- TikTok / OBS / session ----------------------------------------------

const tkSession = () => session.fromPartition(PARTITION);
const getCookies = () => tkSession().cookies.get({ domain: 'tiktok.com' });

const api = new TikTokApi({
  getCookies,
  getLanguage: () => settings.language,
  getScreen: () => screen.getPrimaryDisplay().size,
  platform: DEFAULTS.platform,
  log,
});
const obs = new ObsClient({ log });
const live = new LiveSession({ api, obs, log });

live.on('state', (s) => send('session', s));
obs.on('disconnected', (code) => {
  log('obs', `disconnected (code ${code})`);
  avatar?.push(0);
  send('obs', obsState());
});

// The robot avatar's mouth follows the mic level from OBS's own meters.
let avatar = null;
obs.on('event', (type, data) => {
  if (type !== 'InputVolumeMeters' || !avatar) return;
  const mic = pickMic(data.inputs, settings.avatarMic);
  const input = mic && data.inputs.find((i) => i.inputName === mic);
  avatar.push(input ? levelFromMeter(input.inputLevelsMul) : 0);
});

function obsState(error = '') {
  return { connected: obs.connected, version: obs.obsVersion, error };
}

async function refreshAccount() {
  const cookies = await getCookies();
  if (!hasSession(cookies)) {
    account = null;
    createInfo = null;
    topics = [];
    send('account', accountState());
    return accountState();
  }
  const country = cookies.find((c) => c.name === 'store-country-code')?.value || 'unknown';
  log('auth', `session found; data center ${idcFromCookies(cookies) || 'unknown'}, country ${country}`);
  try {
    account = await api.getAccountInfo();
  } catch (e) {
    log('warn', `account info: ${e.message}`);
    account = { userId: '', username: '', nickname: 'Logged in', avatar: '' };
  }
  try {
    const { body } = await api.detectWebcastHost(settings.webcastHost);
    createInfo = { ok: body.status_code === 0, statusCode: body.status_code, message: body.status_code === 0 ? '' : apiMessage(body) };
    topics = extractTopics(body);
    if (body.status_code === 0) {
      try {
        const tags = await api.getHashtags();
        const more = extractTopics(tags);
        const ids = new Set(topics.map((t) => t.id));
        for (const t of more) if (!ids.has(t.id)) topics.push(t);
      } catch (e) {
        log('warn', `topic list: ${e.message}`);
      }
    }
  } catch (e) {
    createInfo = { ok: false, statusCode: -1, message: e.message };
  }
  studio = await refreshStudioAccess();
  send('account', accountState());
  return accountState();
}

// Phone LIVE access doesn't imply LIVE Studio access; TikTok grants that
// separately. Logs what TikTok says so a refusal can be explained.
async function refreshStudioAccess() {
  try {
    const body = await api.getStudioPermission();
    const d = body.data || {};
    log('api', `LIVE Studio permission: ${summarize({
      enable_live_studio: d.live_scenario?.enable_live_studio,
      live_studio_permission_status: d.live_studio_permission_status,
      show_live_studio: d.show_live_studio,
      golive_locale_restricted: d.golive_locale_restricted,
      can_be_live_podcast: d.can_be_live_podcast,
    })}`);
    let access = null;
    try {
      const r = await api.checkStudioAccess();
      log('api', `LIVE Studio access check: status_code ${r.status_code} ${summarize(r.data, 1500)}`);
      if (r.status_code === 0) access = r.data;
    } catch (e) {
      log('warn', `LIVE Studio access check: ${e.message}`);
    }
    if (body.status_code !== 0) return { known: false, message: apiMessage(body) };
    return {
      known: true,
      enabled: !!d.live_scenario?.enable_live_studio,
      localeRestricted: !!d.golive_locale_restricted,
      calmPeriod: !!access?.in_calm_period,
      requirements: studioRequirements(access),
    };
  } catch (e) {
    log('warn', `LIVE Studio permission: ${e.message}`);
    return { known: false, message: e.message };
  }
}

function accountState() {
  return { loggedIn: !!account, account, createInfo, topics, studio };
}

function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 520,
    height: 760,
    parent: mainWin,
    title: 'Log in to TikTok',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loginWin.webContents.setUserAgent(BROWSER_UA);
  loginWin.webContents.setWindowOpenHandler(({ url }) => {
    // Keep OAuth popups (Google/Apple/etc.) inside the same login session.
    if (/^https:\/\//.test(url)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PARTITION } } };
    return { action: 'deny' };
  });

  const ses = tkSession();
  const onCookie = async (_e, cookie, _cause, removed) => {
    if (removed || !/^sessionid(_ss)?$/.test(cookie.name) || !cookie.value) return;
    ses.cookies.removeListener('changed', onCookie);
    log('auth', 'TikTok session cookie received');
    setTimeout(() => {
      if (loginWin && !loginWin.isDestroyed()) loginWin.close();
    }, 1500);
    await refreshAccount();
  };
  ses.cookies.on('changed', onCookie);
  loginWin.on('closed', () => {
    ses.cookies.removeListener('changed', onCookie);
    loginWin = null;
  });
  loginWin.loadURL(LOGIN_URL);
}

async function logout() {
  if (live.state === 'live' || live.state === 'preparing') await live.endLive();
  await tkSession().clearStorageData();
  account = null;
  createInfo = null;
  topics = [];
  log('auth', 'logged out');
  send('account', accountState());
}

// ---- IPC -----------------------------------------------------------------

function wrap(fn) {
  return async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
}

ipcMain.handle('state:get', wrap(async () => ({
  pin: pinState(),
  settings: publicSettings(),
  obs: obsState(),
  session: live.snapshot(),
  logs,
  account: accountState(),
  versions: { app: app.getVersion(), electron: process.versions.electron },
})));

ipcMain.handle('settings:set', wrap(async (patch) => {
  const allowed = ['theme', 'obsHost', 'obsPort', 'driveObs', 'useTikTokProfile', 'robotAvatar', 'vertical', 'language', 'lastTitle', 'lastTopicId', 'pinUrl'];
  for (const k of allowed) if (k in patch) settings[k] = patch[k];
  if ('obsPassword' in patch) setObsPassword(patch.obsPassword);
  saveSettings();
  return publicSettings();
}));

ipcMain.handle('auth:login', wrap(async () => openLogin()));
ipcMain.handle('auth:logout', wrap(logout));
ipcMain.handle('account:refresh', wrap(refreshAccount));
// TikTok's own LIVE Studio application page, in the logged-in session.
// Refresh the account when it closes, since access may have changed.
let applyWin = null;
ipcMain.handle('account:apply-studio', wrap(async () => {
  if (applyWin && !applyWin.isDestroyed()) {
    applyWin.focus();
    return;
  }
  applyWin = new BrowserWindow({
    width: 480, height: 860, parent: mainWin, title: 'Apply for LIVE Studio access', autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  applyWin.webContents.setUserAgent(BROWSER_UA);
  applyWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//.test(url)) applyWin.loadURL(url);
    return { action: 'deny' };
  });
  const url = studioApplyUrl({ userId: account?.userId, lang: settings.language });
  log('auth', `opened TikTok's LIVE Studio application page`);
  applyWin.on('closed', () => {
    applyWin = null;
    refreshAccount().catch((e) => log('warn', e.message));
  });
  applyWin.loadURL(url);
}));

ipcMain.handle('obs:connect', wrap(async () => {
  try {
    await obs.connect({ host: settings.obsHost, port: Number(settings.obsPort) || 4455, password: obsPassword() });
    send('obs', obsState());
    return obsState();
  } catch (e) {
    log('obs', e.message);
    send('obs', obsState(e.message));
    throw e;
  }
}));
ipcMain.handle('obs:disconnect', wrap(async () => {
  obs.disconnect();
  send('obs', obsState());
  return obsState();
}));

// OBS's "Show Connect Info" offers the LAN address, which is still this machine.
function isThisMachine(host) {
  const h = String(host || '').trim().toLowerCase();
  if (['127.0.0.1', 'localhost', '::1', os.hostname().toLowerCase()].includes(h)) return true;
  return Object.values(os.networkInterfaces()).flat().some((a) => a && a.address.toLowerCase() === h);
}

// Copy the scene artwork somewhere OBS can read it (the app's own files may
// sit inside an AppImage mount or asar archive).
function exportObsAssets() {
  const src = path.join(__dirname, 'obs-assets');
  const dest = path.join(app.getPath('userData'), 'obs-assets');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.png')) fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(src, f)));
  }
  return dest;
}

ipcMain.handle('obs:setup', wrap(async () => {
  if (!obs.connected) throw new Error('Connect to OBS first');
  const local = isThisMachine(settings.obsHost);
  if (!local) log('warn', 'OBS is on another machine; using plain colors instead of the scene artwork');
  const result = await setupTikTok(obs, {
    handle: account?.username || '',
    assetsDir: local ? exportObsAssets() : null,
    avatarUrl: local ? avatar.url : null,
    log,
  });
  log('obs', result.created
    ? `setup done: profile "${result.profile}", scene collection "${result.collection}"`
    : `setup: repaired "${result.collection}" (${result.added} change(s))`);
  if (settings.robotAvatar) await setRobotAvatar(obs, { enabled: true, url: avatar.url, log }).catch((e) => result.warnings.push(e.message));
  return result;
}));

ipcMain.handle('obs:robot', wrap(async (enabled) => {
  settings.robotAvatar = !!enabled;
  saveSettings();
  if (!obs.connected) throw new Error('Connect to OBS first');
  if (!isThisMachine(settings.obsHost)) throw new Error('The robot avatar needs OBS on this machine');
  return setRobotAvatar(obs, { enabled: !!enabled, url: avatar.url, log });
}));

let previewWin = null;
ipcMain.handle('avatar:preview', wrap(async () => {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus();
    return;
  }
  previewWin = new BrowserWindow({
    width: 420, height: 560, parent: mainWin, title: 'Robot preview', autoHideMenuBar: true,
    backgroundColor: '#0d0f14', webPreferences: { contextIsolation: true, sandbox: true },
  });
  previewWin.loadURL(`${avatar.url}?preview=1`);
}));

// ---- pinned window: any web page kept on top of everything -----------------

let pinWin = null;
let saveBoundsTimer = null;

function pinState() {
  return { open: !!(pinWin && !pinWin.isDestroyed()), opacity: settings.pinOpacity, clickThrough: settings.pinClickThrough };
}

function applyPinLook() {
  if (!pinWin || pinWin.isDestroyed()) return;
  pinWin.setOpacity(Math.min(1, Math.max(0.2, Number(settings.pinOpacity) || 1)));
  pinWin.setIgnoreMouseEvents(!!settings.pinClickThrough, { forward: true });
}

function openPin(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('Enter a web address, like tiktok.com/@you/live');
  settings.pinUrl = url;
  saveSettings();
  if (pinWin && !pinWin.isDestroyed()) {
    pinWin.loadURL(url);
    pinWin.showInactive();
    return pinState();
  }
  const area = screen.getPrimaryDisplay().workArea;
  const b = settings.pinBounds || { width: 380, height: 600, x: area.x + area.width - 400, y: area.y + 80 };
  pinWin = new BrowserWindow({
    ...b,
    minWidth: 220,
    minHeight: 160,
    title: 'Pinned - LIVE Studio for Linux',
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  pinWin.setAlwaysOnTop(true, 'screen-saver');
  pinWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pinWin.webContents.setUserAgent(BROWSER_UA);
  pinWin.webContents.setWindowOpenHandler(({ url: next }) => {
    if (/^https?:/.test(next)) pinWin.loadURL(next);
    return { action: 'deny' };
  });
  const remember = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (pinWin && !pinWin.isDestroyed()) {
        settings.pinBounds = pinWin.getBounds();
        saveSettings();
      }
    }, 500);
  };
  pinWin.on('move', remember);
  pinWin.on('resize', remember);
  pinWin.on('closed', () => {
    pinWin = null;
    send('pin', pinState());
  });
  applyPinLook();
  pinWin.loadURL(url);
  log('app', `pinned window: ${new URL(url).host}`);
  return pinState();
}

ipcMain.handle('pin:open', wrap(async (url) => openPin(url)));
ipcMain.handle('pin:close', wrap(async () => {
  if (pinWin && !pinWin.isDestroyed()) pinWin.close();
  return pinState();
}));
ipcMain.handle('pin:set', wrap(async ({ opacity, clickThrough } = {}) => {
  if (opacity !== undefined) settings.pinOpacity = Math.min(1, Math.max(0.2, Number(opacity)));
  if (clickThrough !== undefined) settings.pinClickThrough = !!clickThrough;
  saveSettings();
  applyPinLook();
  return pinState();
}));

ipcMain.handle('live:start', wrap(async ({ title, topicId }) => {
  settings.lastTitle = title || '';
  settings.lastTopicId = topicId || '';
  saveSettings();
  await live.goLive({
    title,
    hashtagId: topicId ? Number(topicId) : 0,
    vertical: settings.vertical,
    driveObs: settings.driveObs,
    profile: settings.useTikTokProfile ? OBS_PROFILE : null,
  });
  return live.snapshot();
}));
ipcMain.handle('live:end', wrap(async () => {
  await live.endLive();
  return live.snapshot();
}));
ipcMain.handle('live:mark-streaming', wrap(async () => {
  live.markStreaming();
  return live.snapshot();
}));
ipcMain.handle('live:copy', wrap(async (what) => {
  const push = live.room?.push;
  if (!push) throw new Error('No active LIVE');
  clipboard.writeText(what === 'key' ? push.key : push.server);
  return true;
}));
ipcMain.handle('log:copy', wrap(async () => {
  clipboard.writeText(logs.map((l) => `${new Date(l.t).toISOString()} [${l.kind}] ${l.message}`).join('\n'));
  return true;
}));
ipcMain.handle('open:external', wrap(async (url) => {
  if (/^https:\/\/(www\.)?(tiktok\.com|github\.com|obsproject\.com)\//.test(url)) await shell.openExternal(url);
}));

// ---- windows / lifecycle --------------------------------------------------

// The window starts hidden, the renderer reports how big its content is, and
// we grow the window to fit (within the work area) before showing it, so it
// opens without scrollbars. It keeps growing for taller views (the live panel)
// until the user resizes it by hand.
let lastFit = null;
let userResized = false;

function showMain() {
  if (mainWin && !mainWin.isDestroyed() && !mainWin.isVisible()) mainWin.show();
}

function fitWindow({ width, height }) {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (userResized || mainWin.isMaximized() || mainWin.isFullScreen()) {
    showMain();
    return;
  }
  const area = screen.getDisplayMatching(mainWin.getBounds()).workAreaSize;
  const [cw, ch] = mainWin.getContentSize();
  const [ow, oh] = mainWin.getSize();
  const w = Math.min(Math.max(cw, Math.ceil(width)), area.width - (ow - cw));
  const h = Math.min(Math.max(ch, Math.ceil(height)), area.height - (oh - ch));
  if (w !== cw || h !== ch) {
    lastFit = [w, h];
    mainWin.setContentSize(w, h);
  }
  showMain();
}

ipcMain.on('window:fit', (_e, size) => fitWindow(size || {}));

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    show: false,
    title: 'LIVE Studio for Linux (unofficial)',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('resize', () => {
    if (!lastFit || !mainWin.isVisible()) return;
    const [w, h] = mainWin.getContentSize();
    if (Math.abs(w - lastFit[0]) > 4 || Math.abs(h - lastFit[1]) > 4) userResized = true;
  });
  // Fallback in case the renderer never reports a size.
  setTimeout(showMain, 3000);

  // Dev aid: LSL_CAPTURE=/path/shot.png [LSL_THEME=light] saves the window and quits.
  if (process.env.LSL_CAPTURE) {
    mainWin.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await mainWin.webContents.capturePage();
      fs.writeFileSync(process.env.LSL_CAPTURE, img.toPNG());
      app.exit(0);
    }, 1500));
  }
}

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(async () => {
  loadSettings();
  if (process.env.LSL_CAPTURE && process.env.LSL_THEME) settings.theme = process.env.LSL_THEME;
  avatar = startAvatarServer({ port: Number(process.env.LSL_AVATAR_PORT) || 47812, log });
  createMainWindow();
  log('app', `started ${app.getVersion()} (Electron ${process.versions.electron})`);
  refreshAccount().catch((e) => log('warn', e.message));
  if (settings.driveObs) {
    obs.connect({ host: settings.obsHost, port: Number(settings.obsPort) || 4455, password: obsPassword() })
      .then(() => send('obs', obsState()))
      .catch((e) => {
        log('obs', `auto-connect: ${e.message}`);
        send('obs', obsState(e.message));
      });
  }
});

// End the LIVE cleanly before quitting so the room doesn't linger until
// TikTok notices the missing pings.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  if (live.state === 'live' || live.state === 'preparing') {
    e.preventDefault();
    quitting = true;
    live.endLive().finally(() => app.quit());
  }
});

app.on('window-all-closed', () => app.quit());
