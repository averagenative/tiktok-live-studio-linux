'use strict';

const $ = (id) => document.getElementById(id);
const api = window.ls;

const view = {
  settings: {},
  obs: { connected: false },
  session: { state: 'idle' },
  account: { loggedIn: false },
};
let tick = null;

function show(el, on) {
  el.hidden = !on;
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    addLog({ t: Date.now(), kind: 'error', message: e.message });
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
    renderLive();
  }
}

// ---- account ---------------------------------------------------------------

function renderAccount() {
  const a = view.account;
  show($('account-out'), !a.loggedIn);
  show($('account-in'), a.loggedIn);
  if (a.loggedIn) {
    const acc = a.account || {};
    $('nickname').textContent = acc.nickname || 'Logged in';
    $('username').textContent = acc.username ? `@${acc.username}` : '';
    if (acc.avatar) $('avatar').src = acc.avatar;
    else $('avatar').removeAttribute('src');
    const ci = a.createInfo;
    const el = $('access');
    if (!ci) {
      el.textContent = 'Checking LIVE access...';
      el.className = 'status';
    } else if (ci.ok) {
      el.textContent = 'LIVE access: ready';
      el.className = 'status ok';
    } else {
      el.textContent = `LIVE access: ${ci.message || 'not available'}${ci.statusCode > 0 ? ` (status_code ${ci.statusCode})` : ''}`;
      el.className = 'status err';
    }
  }
  const st = a.studio;
  const se = $('studio-access');
  show(se, !!(a.loggedIn && st));
  show($('apply-studio'), !!(a.loggedIn && st?.known && !st.enabled && !st.localeRestricted));
  if (st && a.loggedIn) {
    if (!st.known) {
      se.textContent = `LIVE Studio access: unknown (${st.message})`;
      se.className = 'status small';
    } else if (st.enabled) {
      se.textContent = 'LIVE Studio access: granted';
      se.className = 'status small ok';
    } else if (st.localeRestricted) {
      se.textContent = 'LIVE Studio access: not available in your region';
      se.className = 'status small err';
    } else {
      const reqs = (st.requirements || []).map((r) => `${r.pass ? '\u2713' : '\u2717'} ${r.text}`).join('   ');
      se.textContent = `LIVE Studio access: not granted yet${st.calmPeriod ? ' (in a cooldown period)' : ''}. `
        + `This is separate from going LIVE in the phone app.${reqs ? ` TikTok's requirements: ${reqs}` : ''}`;
      se.className = 'status small err';
    }
  }
  const sel = $('topic');
  const current = sel.value || view.settings.lastTopicId || '';
  sel.replaceChildren(new Option('No topic', ''));
  const byTitle = (x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: 'base', numeric: true });
  for (const t of [...(a.topics || [])].sort(byTitle)) sel.add(new Option(t.title, t.id));
  sel.value = [...sel.options].some((o) => o.value === current) ? current : '';
  renderLive();
}

// ---- OBS -------------------------------------------------------------------

function renderObs() {
  const o = view.obs;
  $('obs-dot').className = `dot${o.connected ? ' on' : o.error ? ' err' : ''}`;
  $('obs-status').textContent = o.connected ? `connected (obs-websocket ${o.version})` : o.error ? o.error : 'not connected';
  show($('obs-connect'), !o.connected);
  show($('obs-disconnect'), o.connected);
  $('obs-setup').disabled = !o.connected;
  renderLive();
}

function renderPin(p) {
  view.pin = p || view.pin || { open: false };
  document.querySelectorAll('.x11-only').forEach((el) => show(el, !!view.pin.selfPin));
  if (view.pin.selfPin) {
    $('pin-hint').textContent = 'The window keeps itself on top. With click-through on, clicks go to the game underneath; '
      + 'turn it off here to move, resize, or scroll the window.';
  }
  show($('pin-open'), true);
  $('pin-open').textContent = view.pin.open ? 'Load page' : 'Open pinned window';
  show($('pin-close'), !!view.pin.open);
}

function renderSettings() {
  const s = view.settings;
  document.documentElement.dataset.theme = s.theme || 'dark';
  $('theme').value = s.theme || 'dark';
  $('obs-host').value = s.obsHost ?? '127.0.0.1';
  $('obs-port').value = s.obsPort ?? 4455;
  $('obs-pass').placeholder = s.hasObsPassword ? 'saved (type to change)' : 'none';
  $('drive-obs').checked = !!s.driveObs;
  $('use-profile').checked = !!s.useTikTokProfile;
  $('robot').checked = !!s.robotAvatar;
  $('pin-opacity').value = Math.round((s.pinOpacity ?? 0.85) * 100);
  $('pin-click').checked = !!s.pinClickThrough;
  $('pin-panel').checked = s.pinPanelOnly !== false;
  if (!$('pin-url').value) {
    const handle = view.account?.account?.username;
    $('pin-url').value = s.pinUrl || (handle ? `https://www.tiktok.com/@${handle}/live` : '');
  }
  $('vertical').checked = !!s.vertical;
  if (!$('title').value) $('title').value = s.lastTitle || '';
}

async function saveSetting(patch) {
  view.settings = await api.setSettings(patch);
  renderSettings();
  renderLive();
}

// ---- live ------------------------------------------------------------------

function renderLive() {
  const s = view.session;
  const st = s.state;
  const idle = st === 'idle';
  show($('live-idle'), idle);
  show($('live-busy'), st === 'creating' || st === 'ending');
  show($('live-on'), st === 'preparing' || st === 'live');
  show($('live-done'), st === 'ended' || st === 'error');

  if (idle) {
    let hint = '';
    if (!view.account.loggedIn) hint = 'Log in first.';
    else if (view.account.createInfo && !view.account.createInfo.ok) hint = 'TikTok says this account cannot go LIVE right now.';
    else if (view.account.studio?.known && !view.account.studio.enabled) hint = "TikTok hasn't granted LIVE Studio access to this account yet.";
    else if (view.settings.driveObs && !view.obs.connected) hint = 'Connect to OBS, or turn off "Drive OBS".';
    $('go-hint').textContent = hint;
    $('go').disabled = !view.account.loggedIn || (view.settings.driveObs && !view.obs.connected);
  }

  $('busy-text').textContent = st === 'creating' ? 'Creating your LIVE room...' : 'Ending your LIVE...';

  if (st === 'preparing' || st === 'live') {
    const badge = $('live-badge');
    badge.textContent = st === 'live' ? 'LIVE' : 'PREPARING';
    badge.className = `badge${st === 'live' ? ' live' : ''}`;
    $('live-title').textContent = s.room?.title || '';
    $('server').textContent = s.room?.server || '';
    $('key').textContent = s.room?.keyMasked || '';
    $('room').textContent = s.room?.roomId || '';
    const manual = !s.driveObs;
    show($('manual-hint'), manual && st === 'preparing');
    show($('mark'), manual && st === 'preparing');
    const handle = s.room?.ownerHandle || view.account.account?.username;
    show($('open-live'), st === 'live' && !!handle);
    $('open-live').dataset.url = handle ? `https://www.tiktok.com/@${handle}/live` : '';
    if (st === 'live' && !tick) {
      tick = setInterval(() => {
        $('elapsed').textContent = fmtElapsed(Date.now() - (view.session.startedAt || Date.now()));
      }, 1000);
    }
    if (st !== 'live') $('elapsed').textContent = s.driveObs ? 'waiting for OBS...' : '';
  }
  if (st !== 'live' && tick) {
    clearInterval(tick);
    tick = null;
  }

  if (st === 'ended') {
    $('done-text').textContent = s.error ? `LIVE ended: ${s.error}` : 'LIVE ended.';
    $('done-text').className = 'status ok';
  } else if (st === 'error') {
    $('done-text').textContent = s.error || 'Something went wrong.';
    $('done-text').className = 'status err';
  }
}

// ---- log -------------------------------------------------------------------

function addLog(entry) {
  const li = document.createElement('li');
  li.className = `k-${entry.kind}`;
  li.textContent = `${new Date(entry.t).toLocaleTimeString()} [${entry.kind}] ${entry.message}`;
  const ol = $('log');
  ol.append(li);
  while (ol.children.length > 500) ol.firstChild.remove();
  ol.scrollTop = ol.scrollHeight;
}

// ---- wiring ----------------------------------------------------------------

function wire() {
  $('theme').addEventListener('change', (e) => saveSetting({ theme: e.target.value }));
  $('login').addEventListener('click', (e) => act(e.target, () => api.login()));
  $('logout').addEventListener('click', (e) => act(e.target, () => api.logout()));
  $('apply-studio').addEventListener('click', (e) => act(e.target, () => api.applyStudio()));
  $('refresh').addEventListener('click', (e) => act(e.target, async () => {
    view.account = await api.refreshAccount();
    renderAccount();
  }));

  const saveObsFields = () => {
    const patch = { obsHost: $('obs-host').value.trim() || '127.0.0.1', obsPort: Number($('obs-port').value) || 4455 };
    if ($('obs-pass').value) patch.obsPassword = $('obs-pass').value;
    return saveSetting(patch).then(() => { $('obs-pass').value = ''; });
  };
  $('obs-connect').addEventListener('click', (e) => act(e.target, async () => {
    await saveObsFields();
    view.obs = await api.obsConnect();
    renderObs();
  }));
  $('obs-disconnect').addEventListener('click', (e) => act(e.target, async () => {
    view.obs = await api.obsDisconnect();
    renderObs();
  }));
  $('drive-obs').addEventListener('change', (e) => saveSetting({ driveObs: e.target.checked }));
  $('use-profile').addEventListener('change', (e) => saveSetting({ useTikTokProfile: e.target.checked }));
  $('robot').addEventListener('change', (e) => act(null, async () => {
    try {
      await api.setRobot(e.target.checked);
      view.settings = { ...view.settings, robotAvatar: e.target.checked };
    } catch (err) {
      e.target.checked = !e.target.checked;
      throw err;
    }
  }));
  $('robot-preview').addEventListener('click', (e) => act(e.target, () => api.previewRobot()));
  $('pin-open').addEventListener('click', (e) => act(e.target, async () => renderPin(await api.pinOpen($('pin-url').value))));
  $('pin-close').addEventListener('click', (e) => act(e.target, async () => renderPin(await api.pinClose())));
  $('pin-opacity').addEventListener('input', (e) => act(null, async () => {
    view.settings = { ...view.settings, pinOpacity: Number(e.target.value) / 100 };
    renderPin(await api.pinSet({ opacity: Number(e.target.value) / 100 }));
  }));
  $('pin-panel').addEventListener('change', (e) => act(null, async () => {
    view.settings = { ...view.settings, pinPanelOnly: e.target.checked };
    renderPin(await api.pinSet({ panelOnly: e.target.checked }));
  }));
  $('pin-click').addEventListener('change', (e) => act(null, async () => {
    view.settings = { ...view.settings, pinClickThrough: e.target.checked };
    renderPin(await api.pinSet({ clickThrough: e.target.checked }));
  }));
  $('obs-setup').addEventListener('click', (e) => act(e.target, async () => {
    const el = $('setup-status');
    el.hidden = false;
    el.className = 'status small';
    el.textContent = 'Setting up OBS... if GNOME asks, pick the window or screen to share.';
    try {
      const r = await api.obsSetup();
      const what = r.created ? 'Created the TikTok Vertical profile and scenes.' : `Repaired the TikTok Vertical scenes (${r.added} change${r.added === 1 ? '' : 's'}).`;
      el.textContent = r.warnings.length ? `${what} Check: ${r.warnings.join('; ')}` : `${what} All set.`;
      el.className = `status small ${r.warnings.length ? 'err' : 'ok'}`;
    } catch (err) {
      el.textContent = `Setup failed: ${err.message}`;
      el.className = 'status small err';
      throw err;
    }
  }));
  $('vertical').addEventListener('change', (e) => saveSetting({ vertical: e.target.checked }));

  $('go').addEventListener('click', (e) => act(e.target, async () => {
    view.session = await api.goLive({ title: $('title').value.trim(), topicId: $('topic').value });
  }));
  $('end').addEventListener('click', (e) => act(e.target, async () => {
    view.session = await api.endLive();
  }));
  $('mark').addEventListener('click', (e) => act(e.target, async () => {
    view.session = await api.markStreaming();
  }));
  $('again').addEventListener('click', () => {
    view.session = { ...view.session, state: 'idle' };
    renderLive();
  });
  $('open-live').addEventListener('click', (e) => act(null, () => api.openExternal(e.target.dataset.url)));
  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', () => act(b, async () => {
      await api.copy(b.dataset.copy);
      const label = b.textContent;
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = label; }, 1200);
    }));
  });
  $('copy-log').addEventListener('click', (e) => act(e.target, () => api.copyLog()));

  api.onLog(addLog);
  api.onSession((s) => { view.session = s; renderLive(); });
  api.onObs((o) => { view.obs = o; renderObs(); });
  api.onAccount((a) => {
    view.account = a;
    renderAccount();
    if (!$('pin-url').value && a.account?.username) $('pin-url').value = `https://www.tiktok.com/@${a.account.username}/live`;
  });
  api.onPin(renderPin);
}

async function init() {
  wire();
  const st = await api.getState();
  view.settings = st.settings;
  view.obs = st.obs;
  view.session = st.session;
  view.account = st.account;
  renderPin(st.pin);
  renderSettings();
  renderAccount();
  renderObs();
  renderLive();
  for (const l of st.logs) addLog(l);
  $('footer').textContent = `v${st.versions.app} · Electron ${st.versions.electron} · not affiliated with TikTok`;
  watchContentSize();
}

// Ask the main process to grow the window whenever the content outgrows it.
function watchContentSize() {
  let queued = false;
  const report = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      api.fit(document.documentElement.scrollWidth, Math.ceil(document.body.getBoundingClientRect().height));
    });
  };
  new ResizeObserver(report).observe(document.body);
  report();
}

init();
