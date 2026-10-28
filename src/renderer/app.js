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
  const sel = $('topic');
  const current = sel.value || view.settings.lastTopicId || '';
  sel.replaceChildren(new Option('No topic', ''));
  for (const t of a.topics || []) sel.add(new Option(t.title, t.id));
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

function renderSettings() {
  const s = view.settings;
  document.documentElement.dataset.theme = s.theme || 'dark';
  $('theme').value = s.theme || 'dark';
  $('obs-host').value = s.obsHost ?? '127.0.0.1';
  $('obs-port').value = s.obsPort ?? 4455;
  $('obs-pass').placeholder = s.hasObsPassword ? 'saved (type to change)' : 'none';
  $('drive-obs').checked = !!s.driveObs;
  $('use-profile').checked = !!s.useTikTokProfile;
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
  $('obs-setup').addEventListener('click', (e) => act(e.target, () => api.obsSetup()));
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
  api.onAccount((a) => { view.account = a; renderAccount(); });
}

async function init() {
  wire();
  const st = await api.getState();
  view.settings = st.settings;
  view.obs = st.obs;
  view.session = st.session;
  view.account = st.account;
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
