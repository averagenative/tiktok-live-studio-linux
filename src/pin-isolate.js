'use strict';

// Page script for the pinned window: hide everything on a TikTok LIVE page
// except the side panel (viewers and comments) and stretch that panel over
// the whole window. Display only; it reads nothing from the page.
//
// The panel is found by shape, not by TikTok's class names (which change):
// the biggest tall column in the right part of the page. The page keeps its
// desktop layout in narrow windows and overflows sideways, so positions are
// measured against the page width rather than the window width.

const ISOLATE_SCRIPT = `(() => {
  if (window.__lslIsolate) return window.__lslIsolate();
  const style = document.createElement('style');
  style.textContent = \`
    html.lsl-iso body * { visibility: hidden !important; }
    html.lsl-iso .lsl-panel, html.lsl-iso .lsl-panel * { visibility: visible !important; }
    html.lsl-iso .lsl-panel { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
      z-index: 2147483647 !important; border-radius: 0 !important; }
    html.lsl-iso, html.lsl-iso body { overflow: hidden !important; }\`;
  document.documentElement.append(style);
  const findPanel = () => {
    const W = Math.max(window.innerWidth, document.documentElement.scrollWidth);
    const H = window.innerHeight;
    let best = null;
    let bestArea = 0;
    for (const el of document.body.querySelectorAll('div, aside, section')) {
      const r = el.getBoundingClientRect();
      const left = r.left + window.scrollX;
      if (left < W * 0.55 || r.width < W * 0.18 || r.width > W * 0.48 || r.height < H * 0.6) continue;
      if (r.width * r.height > bestArea) { best = el; bestArea = r.width * r.height; }
    }
    return best;
  };
  let panel = null;
  let queued = false;
  const apply = () => {
    if (panel && panel.isConnected) return true;
    document.querySelectorAll('.lsl-panel').forEach((e) => e.classList.remove('lsl-panel'));
    document.documentElement.classList.remove('lsl-iso');
    panel = findPanel();
    if (panel) {
      panel.classList.add('lsl-panel');
      document.documentElement.classList.add('lsl-iso');
      window.scrollTo(0, 0);
    }
    return !!panel;
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; apply(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.__lslIsolate = apply;
  return apply();
})()`;

// Only TikTok LIVE pages get the panel-only view.
function isTikTokLivePage(url) {
  try {
    const u = new URL(url);
    return /(^|\.)tiktok\.com$/.test(u.hostname) && /\/live(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

module.exports = { ISOLATE_SCRIPT, isTikTokLivePage };
