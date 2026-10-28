'use strict';

// Page script for the pinned window: hide the page layout on a TikTok LIVE
// page except the side panel (viewers and comments), stretch that panel over
// the whole window on a translucent backing, and leave the page's pop-up
// menus and dialogs working. Display only; it reads nothing from the page.
//
// The panel is found by shape, not by TikTok's class names (which change):
// the biggest tall column in the right part of the page. The page keeps its
// desktop layout in narrow windows and overflows sideways, so positions are
// measured against the page width rather than the window width.

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
      background-color: transparent !important; }\`;
  document.documentElement.append(style);
  // The layout's real width: logged in, the page can overflow inside an
  // inner scrolling box rather than the document, so take the rightmost
  // edge of the layout itself.
  const layoutWidth = (els) => {
    let right = Math.max(window.innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) right = Math.max(right, r.right + window.scrollX);
    }
    return right;
  };
  let lastW = window.innerWidth;
  const pageSize = () => [lastW, window.innerHeight];
  const findPanel = () => {
    const els = [...document.body.querySelectorAll('div, aside, section')];
    const W = layoutWidth(els);
    const H = window.innerHeight;
    lastW = W;
    let best = null;
    let bestArea = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const left = r.left + window.scrollX;
      if (left < W * 0.55 || r.width < W * 0.18 || r.width > W * 0.48 || r.height < H * 0.6) continue;
      if (r.width * r.height > bestArea) { best = el; bestArea = r.width * r.height; }
    }
    return best;
  };
  // Menus, dialogs, and tooltips (the gear's moderator menu, for one) live in
  // their own small floating layers outside the panel: leave those visible
  // and hide only the big blocks of page layout.
  const OVERLAY_NAME = /modal|popup|popover|dropdown|tooltip|dialog|menu|portal|toast|tippy|floating|mask|drawer|sheet/i;
  const LAYOUT_NAME = /nav|sidebar|header|footer|banner/i;
  const isOverlay = (el, depth = 2) => {
    const role = el.getAttribute('role') || '';
    if (/dialog|menu|listbox|tooltip/.test(role) || el.getAttribute('aria-modal') === 'true') return true;
    const name = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + el.id;
    if (LAYOUT_NAME.test(name)) return false;
    if (OVERLAY_NAME.test(name)) return true;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') {
      const r = el.getBoundingClientRect();
      const [W, H] = pageSize();
      if (r.width * r.height < W * H * 0.25) return true;
    }
    // A plain container (a "portal") holding a pop-up counts as one.
    return depth > 0 && [...el.children].some((c) => isOverlay(c, depth - 1));
  };
  let panel = null;
  let chain = [];
  const hideLayout = () => {
    for (const node of [panel, ...chain]) {
      const parent = node.parentElement;
      if (!parent) continue;
      for (const sib of parent.children) {
        if (sib === node || chain.includes(sib) || sib.classList.contains('lsl-hide')) continue;
        if (/^(SCRIPT|STYLE|LINK|META)$/.test(sib.tagName)) continue;
        if (!sib.childElementCount && !sib.textContent.trim()) continue;
        if (isOverlay(sib)) continue;
        sib.classList.add('lsl-hide');
      }
    }
  };
  let queued = false;
  const apply = () => {
    if (!panel || !panel.isConnected) {
      document.querySelectorAll('.lsl-panel, .lsl-anc, .lsl-hide').forEach((e) => e.classList.remove('lsl-panel', 'lsl-anc', 'lsl-hide'));
      document.documentElement.classList.remove('lsl-iso');
      panel = findPanel();
      chain = [];
      if (!panel) return false;
      for (let p = panel.parentElement; p && p !== document.documentElement; p = p.parentElement) chain.push(p);
      panel.classList.add('lsl-panel');
      chain.forEach((p) => p.classList.add('lsl-anc'));
      document.documentElement.classList.add('lsl-iso');
      window.scrollTo(0, 0);
    }
    hideLayout();
    return true;
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; apply(); }, 250);
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
