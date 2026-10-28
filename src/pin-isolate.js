'use strict';

// Page script for the pinned window: on a TikTok LIVE page, hide the layout
// beside the side panel (viewers and comments), stretch that panel over the
// whole window on a translucent backing, and leave the page's pop-up menus
// and dialogs working. Display only; it reads nothing from the page.

const ISOLATE_SCRIPT = `(() => {
  if (window.__lslAlpha !== undefined) document.documentElement.style.setProperty('--lsl-alpha', String(window.__lslAlpha));
  if (window.__lslIsolate) return window.__lslIsolate();
  const style = document.createElement('style');
  style.textContent = \`
    .lsl-hide { visibility: hidden !important; }
    html.lsl-iso, html.lsl-iso body, html.lsl-iso .lsl-anc { background: transparent !important; box-shadow: none !important;
      border-color: transparent !important; }
    html.lsl-iso, html.lsl-iso body { overflow: hidden !important; }
    html.lsl-iso .lsl-panel { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
      z-index: 0 !important; border-radius: 0 !important; background: rgba(14, 16, 22, var(--lsl-alpha, 0.6)) !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 1px rgba(0, 0, 0, 0.9); }
    html.lsl-iso .lsl-panel *:not(input):not(textarea):not(button):not(img):not(video):not(svg):not(path) {
      background-color: transparent !important; }
    html.lsl-iso .lsl-panel ::-webkit-scrollbar { width: 6px; height: 6px; }
    html.lsl-iso .lsl-panel ::-webkit-scrollbar-track { background: transparent; }
    html.lsl-iso .lsl-panel ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); border-radius: 3px; }\`;
  document.documentElement.append(style);

  // 1. The panel, by the test labels TikTok puts on it (data-e2e). These are
  //    made for automation and change far less often than layout or class
  //    names.
  const byLabel = () => {
    for (const label of ['public-screen-container', 'public-screen-live-chat-slot']) {
      const el = document.querySelector('[data-e2e="' + label + '"]');
      if (el && el.getBoundingClientRect().height > 0) return el;
    }
    // Or the nearest element holding both the chat list and the comment box.
    const chat = document.querySelector('[data-e2e="live-chat-container"]');
    const input = document.querySelector('[data-e2e="live-chat-input-container"]');
    if (chat && input) {
      for (let p = chat.parentElement; p && p !== document.body; p = p.parentElement) if (p.contains(input)) return p;
    }
    return null;
  };
  // 2. Fallback if TikTok drops those labels: the biggest tall column on the
  //    right of the layout.
  const byShape = () => {
    const H = window.innerHeight;
    let W = window.innerWidth;
    const tall = [];
    for (const el of document.body.querySelectorAll('div, aside, section')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height < H * 0.6) continue;
      tall.push([el, r]);
      W = Math.max(W, r.right + window.scrollX);
    }
    let best = null;
    let bestArea = 0;
    for (const [el, r] of tall) {
      const left = r.left + window.scrollX;
      if (left < W * 0.55 || r.width < W * 0.18 || r.width > W * 0.48) continue;
      if (r.width * r.height > bestArea) { best = el; bestArea = r.width * r.height; }
    }
    return best;
  };

  // Hide everything beside the panel that exists when the view applies.
  // Anything TikTok adds later (its menus, dialogs, and tooltips, like the
  // Viewers gear's moderator menu) stays visible: nothing is guessed from
  // names or shapes.
  let panel = null;
  let info = null;
  let queued = false;
  const reset = () => {
    document.querySelectorAll('.lsl-panel, .lsl-anc, .lsl-hide').forEach((e) => e.classList.remove('lsl-panel', 'lsl-anc', 'lsl-hide'));
    document.documentElement.classList.remove('lsl-iso');
  };
  const apply = () => {
    if (panel && panel.isConnected) return info;
    reset();
    let how = 'label';
    panel = byLabel();
    if (!panel) { panel = byShape(); how = 'shape'; }
    if (!panel) return false;
    const r = panel.getBoundingClientRect();
    info = { found: how, width: Math.round(r.width), height: Math.round(r.height) };
    for (let node = panel; node && node !== document.documentElement; node = node.parentElement) {
      if (node !== panel) node.classList.add('lsl-anc');
      const parent = node.parentElement;
      if (!parent) break;
      for (const sib of parent.children) {
        if (sib === node || /^(SCRIPT|STYLE|LINK|META|HEAD)$/.test(sib.tagName)) continue;
        if (!sib.childElementCount && !sib.textContent.trim()) continue;
        sib.classList.add('lsl-hide');
      }
    }
    panel.classList.add('lsl-panel');
    document.documentElement.classList.add('lsl-iso');
    window.scrollTo(0, 0);
    return info;
  };
  // Re-apply if TikTok replaces the panel (it re-renders when a LIVE starts).
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; if (!panel || !panel.isConnected) apply(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.__lslIsolate = apply;
  return apply();
})()`;

// Layout numbers only (no page content), logged when the panel can't be found.
const DIAG_SCRIPT = `(() => {
  const els = [...document.body.querySelectorAll('div, aside, section')];
  let right = 0;
  const tall = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    right = Math.max(right, r.right + window.scrollX);
    if (r.height >= window.innerHeight * 0.6 && r.width > 0) tall.push([Math.round(r.left + window.scrollX), Math.round(r.width)]);
  }
  tall.sort((a, b) => b[0] - a[0]);
  return {
    inner: [window.innerWidth, window.innerHeight],
    scroll: [document.documentElement.scrollWidth, document.body.scrollWidth],
    layoutRight: Math.round(right),
    elements: els.length,
    tallRightmost: tall.slice(0, 6),
  };
})()`;

// Panel backing alpha (0 = fully see-through, 1 = solid), then isolate.
function alphaScript(alpha) {
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `window.__lslAlpha = ${a}; document.documentElement.style.setProperty('--lsl-alpha', '${a}'); true`;
}

function isolateScript(alpha) {
  return `${alphaScript(alpha)};\n${ISOLATE_SCRIPT}`;
}

// Only TikTok LIVE pages get the panel-only view.
function isTikTokLivePage(url) {
  try {
    const u = new URL(url);
    return /(^|\.)tiktok\.com$/.test(u.hostname) && /\/live(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

module.exports = { ISOLATE_SCRIPT, DIAG_SCRIPT, isolateScript, alphaScript, isTikTokLivePage };
