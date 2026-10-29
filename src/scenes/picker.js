'use strict';

// The scene theme picker: shows every theme's scenes, drawn by scenes/art.js
// the same way as the files OBS gets, and applies the chosen one.

const $ = (id) => document.getElementById(id);
const api = window.scenes;
const { W, H, SCENES, ROBOT_FULL, BG_FILE, frameFile } = SceneLayout;
const { THEMES, byId } = SceneThemes;

let state = null;
let current = null;
let busy = false;

const pct = (v, total) => `${(v / total) * 100}%`;
// The robot lays itself out by its frame's shape (portrait or wide).
const robotSrc = (theme) => `${state.avatarUrl}?demo=1&c1=${theme.robot.c1.slice(1)}&c2=${theme.robot.c2.slice(1)}`;

// A canvas drawn in scene space at its on-screen size.
function sceneCanvas(cssWidth, draw) {
  const c = document.createElement('canvas');
  const k = (cssWidth * devicePixelRatio) / W;
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  draw(ctx);
  return c;
}

// What the preview shows in place of the handle: while private info is
// hidden, a placeholder instead of the real one.
const previewHandle = () => (state.handle && state.privacy ? '@yourhandle' : state.handle);

// ---- theme cards ----------------------------------------------------------------

async function renderThemes() {
  const box = $('themes');
  const start = SCENES[0];
  for (const t of THEMES) {
    await SceneArt.loadFonts(t);
    const label = document.createElement('label');
    label.className = 'theme-card';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.value = t.id;
    input.addEventListener('change', () => select(t.id));
    const thumb = sceneCanvas(54, (ctx) => {
      SceneArt.drawBackground(ctx, t);
      SceneArt.drawFrame(ctx, t, start, { handle: previewHandle() });
    });
    thumb.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.name;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = t.description;
    text.append(name, document.createElement('br'), desc);
    label.append(input, thumb, text);
    box.append(label);
  }
}

// ---- scene previews ---------------------------------------------------------------

function standIn(kind, box, theme) {
  let el;
  if (kind === 'robot') {
    el = document.createElement('iframe');
    el.src = robotSrc(theme);
    el.title = 'Robot avatar';
    el.tabIndex = -1;
    // Full size in scene pixels; renderScenes scales it down to the stage.
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  } else {
    el = document.createElement('div');
    el.className = `ph ${kind}`;
    const tag = document.createElement('span');
    tag.textContent = kind === 'game' ? 'Game window' : 'Webcam';
    el.append(tag);
  }
  el.style.left = pct(box.x, W);
  el.style.top = pct(box.y, H);
  if (kind !== 'robot') {
    el.style.width = pct(box.w, W);
    el.style.height = pct(box.h, H);
  }
  return el;
}

function renderScenes(theme) {
  const box = $('scenes');
  box.replaceChildren();
  const scenes = SCENES.filter((s) => !s.robot || state.local);
  for (const scene of scenes) {
    const fig = document.createElement('figure');
    fig.className = 'scene';
    const stage = document.createElement('div');
    stage.className = 'stage';
    fig.append(stage);
    const cap = document.createElement('figcaption');
    cap.textContent = scene.name;
    fig.append(cap);
    box.append(fig);

    const width = stage.clientWidth || 150;
    stage.append(sceneCanvas(width, (ctx) => SceneArt.drawBackground(ctx, theme)));
    const robots = [];
    for (const h of scene.holes) {
      // Sources overhang their window by 4 px, as in OBS.
      const slot = { x: h.x - 4, y: h.y - 4, w: h.w + 8, h: h.h + 8 };
      const kind = h.shows === 'game' ? 'game' : state.robot ? 'robot' : 'cam';
      const el = standIn(kind, slot, theme);
      stage.append(el);
      if (kind === 'robot') robots.push(el);
    }
    stage.append(sceneCanvas(width, (ctx) => SceneArt.drawFrame(ctx, theme, scene, { handle: previewHandle() })));
    if (scene.robot) {
      const el = standIn('robot', ROBOT_FULL, theme);
      stage.append(el);
      robots.push(el);
    }
    // Robot pages render at full size and scale down to the stage.
    for (const el of robots) el.style.transform = `scale(${width / W})`;
  }
}

async function select(id) {
  current = byId(id);
  document.querySelectorAll('input[name="theme"]').forEach((i) => { i.checked = i.value === current.id; });
  $('theme-name').textContent = current.name;
  $('theme-desc').textContent = current.description;
  await SceneArt.loadFonts(current);
  renderScenes(current);
}

// ---- apply --------------------------------------------------------------------------

async function exportArt(theme, handle) {
  await SceneArt.loadFonts(theme);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const png = () => new Promise((resolve, reject) => canvas.toBlob((b) => {
    if (!b) reject(new Error('Could not draw the scene artwork'));
    else b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
  }, 'image/png'));
  const files = {};
  SceneArt.drawBackground(ctx, theme);
  files[BG_FILE] = await png();
  for (const scene of SCENES) {
    ctx.clearRect(0, 0, W, H);
    SceneArt.drawFrame(ctx, theme, scene, { handle });
    files[frameFile(scene.name)] = await png();
  }
  return files;
}

function renderApply() {
  const btn = $('apply');
  btn.disabled = busy || !state.obs.connected;
  let note = 'Apply sets up the "TikTok Vertical" profile and scenes in OBS with this theme. Your other profiles and scenes stay as they are.';
  if (!state.obs.connected) note = 'Connect to OBS in the main window to apply a theme. You can browse the themes without it.';
  else if (!state.local) note = 'OBS runs on another machine, so Apply sets up plain scenes without the theme artwork.';
  $('apply-note').textContent = note;
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text;
  el.className = `status small ${kind}`;
}

async function apply() {
  if (busy || !current) return;
  busy = true;
  renderApply();
  try {
    setStatus(`Drawing the ${current.name} artwork...`);
    const files = state.local ? await exportArt(current, state.handle) : {};
    setStatus('Setting up OBS... if GNOME asks, pick the window or screen to share.');
    const r = await api.apply({ theme: current.id, files });
    const what = r.created ? `Set up OBS with the ${current.name} theme.` : `Applied the ${current.name} theme to your TikTok Vertical scenes.`;
    setStatus(r.warnings.length ? `${what} Check: ${r.warnings.join('; ')}` : `${what} All set.`, r.warnings.length ? 'err' : 'ok');
    state.theme = current.id;
  } catch (e) {
    setStatus(`Setup failed: ${e.message}`, 'err');
  } finally {
    busy = false;
    renderApply();
  }
}

async function init() {
  state = await api.state();
  document.documentElement.dataset.theme = state.appTheme || 'dark';
  if (!state.handle) $('handle-note').textContent = 'Log in to put your @handle on the scenes.';
  else if (state.privacy) $('handle-note').textContent = 'Your handle shows as @yourhandle here while private info is hidden.';
  $('apply').addEventListener('click', apply);
  $('close').addEventListener('click', () => window.close());
  api.onObs((o) => {
    state.obs = { ...state.obs, ...o };
    renderApply();
  });
  renderApply();
  await renderThemes();
  await select(state.theme);
  let resizeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderScenes(current), 150);
  });
}

init();
