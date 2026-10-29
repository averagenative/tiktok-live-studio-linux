'use strict';

// Draws a theme's scene artwork on a 2D canvas: the background, and for each
// scene a frame layer (the background with its windows cut out, the window
// borders, and the scene's text). The theme picker draws its previews with
// the same calls it uses to make the files OBS loads, so they match.
//
// Everything is drawn in the 1080x1920 scene space; scale the context to draw
// smaller. Shadow sizes are scaled by hand because canvas shadows ignore the
// transform.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./layout'), require('./themes'));
  else root.SceneArt = factory(root.SceneLayout, root.SceneThemes);
})(typeof self !== 'undefined' ? self : this, (L, T) => {
  const { W, H } = L;

  // A seeded random source, so stars and dots land in the same spots in the
  // preview and in the files.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgba(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  const scaleOf = (ctx) => Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;

  function shadow(ctx, s) {
    const k = scaleOf(ctx);
    ctx.shadowColor = s ? s.color : 'transparent';
    ctx.shadowBlur = s ? s.blur * k : 0;
    ctx.shadowOffsetX = s ? s.x * k : 0;
    ctx.shadowOffsetY = s ? s.y * k : 0;
  }

  function linear(ctx, x0, y0, x1, y1, colors) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
    return g;
  }

  // ---- background --------------------------------------------------------------

  const PATTERNS = {
    synthwave(ctx, p) {
      const hy = p.horizon;
      const rand = rng(7);
      for (let i = 0; i < p.stars; i += 1) {
        const x = rand() * W;
        const y = rand() * hy * 0.7;
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.25 + rand() * 0.6).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1 + rand() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // The sun sits on the horizon, drawn in bands so the sky shows through
      // stripes that widen toward the bottom.
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, hy, p.sunR, Math.PI, 0);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = linear(ctx, 0, hy - p.sunR, 0, hy, p.sun);
      let y = hy - p.sunR;
      for (let i = 0; i < 7; i += 1) {
        const gap = hy - p.sunR * 0.55 + p.sunR * 0.55 * (i / 7) ** 0.9;
        ctx.fillRect(0, y, W, gap - y);
        y = gap + 4 + i * 2.5;
      }
      ctx.fillRect(0, y, W, hy - y);
      ctx.restore();
      // Floor and its grid, converging on the middle of the horizon.
      ctx.fillStyle = linear(ctx, 0, hy, 0, H, p.floor);
      ctx.fillRect(0, hy, W, H - hy);
      ctx.save();
      shadow(ctx, { color: p.grid, blur: 12, x: 0, y: 0 });
      ctx.strokeStyle = p.grid;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, hy);
      ctx.lineTo(W, hy);
      for (let i = -12; i <= 12; i += 1) {
        ctx.moveTo(W / 2 + i * 18, hy);
        ctx.lineTo(W / 2 + i * 260, H);
      }
      for (let i = 1; i <= 9; i += 1) {
        const y = hy + (H - hy) * (i / 9) ** 2;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.restore();
    },

    arcade(ctx, p) {
      ctx.strokeStyle = p.grid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += p.cell) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 0; y <= H; y += p.cell) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
      // Lit squares on the grid.
      const rand = rng(11);
      for (let i = 0; i < p.pixels; i += 1) {
        const cx = Math.floor(rand() * (W / p.cell)) * p.cell;
        const cy = Math.floor(rand() * (H / p.cell)) * p.cell;
        ctx.fillStyle = rgba(p.colors[i % p.colors.length], 0.18 + rand() * 0.25);
        ctx.fillRect(cx + 2, cy + 2, p.cell - 4, p.cell - 4);
      }
      ctx.fillStyle = `rgba(0, 0, 0, ${p.scan})`;
      for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 3);
    },

    dots(ctx, p) {
      const rand = rng(5);
      ctx.fillStyle = p.color;
      for (let i = 0; i < p.count; i += 1) {
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, 6 + rand() * 22, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    vignette(ctx, p) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, `rgba(0, 0, 0, ${p.alpha})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  };

  function drawBackground(ctx, theme) {
    const bg = theme.bg;
    ctx.save();
    shadow(ctx, null);
    const sky = bg.pattern?.type === 'synthwave' ? bg.pattern.horizon : H;
    ctx.fillStyle = linear(ctx, 0, 0, 0, sky, bg.gradient);
    ctx.fillRect(0, 0, W, H);
    for (const g of bg.glows || []) {
      const rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      rg.addColorStop(0, rgba(g.color, g.alpha));
      rg.addColorStop(0.45, rgba(g.color, g.alpha * 0.7));
      rg.addColorStop(1, rgba(g.color, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    if (bg.pattern) PATTERNS[bg.pattern.type](ctx, bg.pattern);
    ctx.restore();
  }

  // ---- window frames -------------------------------------------------------------

  // The outline of a window grown by d pixels on every side, as a new path
  // or (begin false) added to the current one.
  function windowPath(ctx, h, frame, d = 0, begin = true) {
    const x = h.x - d;
    const y = h.y - d;
    const w = h.w + d * 2;
    const hh = h.h + d * 2;
    if (begin) ctx.beginPath();
    if (frame.style === 'pixel') {
      // Notched corners in steps, like a sprite's border.
      const s = frame.step;
      ctx.moveTo(x + s * 2, y);
      ctx.lineTo(x + w - s * 2, y);
      ctx.lineTo(x + w - s * 2, y + s);
      ctx.lineTo(x + w - s, y + s);
      ctx.lineTo(x + w - s, y + s * 2);
      ctx.lineTo(x + w, y + s * 2);
      ctx.lineTo(x + w, y + hh - s * 2);
      ctx.lineTo(x + w - s, y + hh - s * 2);
      ctx.lineTo(x + w - s, y + hh - s);
      ctx.lineTo(x + w - s * 2, y + hh - s);
      ctx.lineTo(x + w - s * 2, y + hh);
      ctx.lineTo(x + s * 2, y + hh);
      ctx.lineTo(x + s * 2, y + hh - s);
      ctx.lineTo(x + s, y + hh - s);
      ctx.lineTo(x + s, y + hh - s * 2);
      ctx.lineTo(x, y + hh - s * 2);
      ctx.lineTo(x, y + s * 2);
      ctx.lineTo(x + s, y + s * 2);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x + s * 2, y + s);
      ctx.closePath();
      return;
    }
    const r = Math.max(0, h.r * frame.round + d);
    ctx.roundRect(x, y, w, hh, r);
  }

  function drawBorder(ctx, theme, h) {
    const f = theme.frame;
    const grad = linear(ctx, 0, 0, W, H, f.colors);
    ctx.save();
    if (f.style === 'glow') {
      windowPath(ctx, h, f, 3);
      ctx.lineWidth = f.width;
      ctx.strokeStyle = grad;
      shadow(ctx, { color: rgba(f.colors[0], 0.9), blur: f.glow, x: 0, y: 0 });
      ctx.stroke();
      shadow(ctx, { color: rgba(f.colors[1], 0.7), blur: f.glow * 0.6, x: 0, y: 0 });
      ctx.stroke();
      shadow(ctx, null);
      ctx.stroke();
    } else if (f.style === 'pixel') {
      windowPath(ctx, h, f, f.width / 2 + 2);
      ctx.lineWidth = f.width;
      ctx.lineJoin = 'miter';
      shadow(ctx, { color: 'rgba(0, 0, 0, 0.6)', blur: 0, x: 8, y: 8 });
      ctx.strokeStyle = f.colors[0];
      ctx.stroke();
      shadow(ctx, null);
      windowPath(ctx, h, f, f.width + 8);
      ctx.lineWidth = 3;
      ctx.strokeStyle = f.colors[1];
      ctx.stroke();
    } else if (f.style === 'soft') {
      // A thick white border with a soft drop shadow outside the window only.
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      windowPath(ctx, h, f, 0, false);
      ctx.clip('evenodd');
      windowPath(ctx, h, f, f.width / 2);
      ctx.lineWidth = f.width;
      ctx.strokeStyle = f.colors[0];
      shadow(ctx, { color: f.shadow, blur: 34, x: 0, y: 12 });
      ctx.stroke();
      shadow(ctx, null);
      ctx.stroke();
    } else {
      windowPath(ctx, h, f, f.width / 2 + 1);
      ctx.lineWidth = f.width;
      ctx.strokeStyle = grad;
      ctx.stroke();
      if (f.outer) {
        windowPath(ctx, h, f, f.outer.gap);
        ctx.lineWidth = f.outer.width;
        ctx.globalAlpha = f.outer.alpha;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- text ---------------------------------------------------------------------------

  const fontCss = (style, size) => `${style.weight || 400} ${size}px "${T.FONTS[style.font].family}"`;

  function drawLine(ctx, text, y, style, maxWidth = 980) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${style.spacing || 0}px`;
    let size = style.size;
    ctx.font = fontCss(style, size);
    const width = ctx.measureText(text).width;
    if (width > maxWidth) {
      size = Math.floor((size * maxWidth) / width);
      ctx.font = fontCss(style, size);
    }
    const fill = style.gradient ? linear(ctx, 0, y - size / 2, 0, y + size / 2, style.gradient) : style.color;
    if (style.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = style.stroke.width;
      ctx.strokeStyle = style.stroke.color;
      shadow(ctx, style.shadow);
      ctx.strokeText(text, W / 2, y);
      shadow(ctx, null);
    } else {
      shadow(ctx, style.shadow);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  // The scene's text lines in this theme's words, with the handle filled in.
  function sceneLines(theme, scene, handle) {
    const out = [];
    for (const line of scene.text) {
      if (line.text.includes('{handle}') && !handle) continue;
      const words = theme.copy?.[line.text] ?? line.text;
      out.push({ role: line.role, y: line.y, text: words.replace('{handle}', handle) });
    }
    return out;
  }

  function drawFrame(ctx, theme, scene, { handle = '' } = {}) {
    if (scene.holes.length) {
      drawBackground(ctx, theme);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const h of scene.holes) {
        windowPath(ctx, h, theme.frame, 0);
        ctx.fill();
      }
      ctx.restore();
      for (const h of scene.holes) drawBorder(ctx, theme, h);
    }
    for (const line of sceneLines(theme, scene, handle)) drawLine(ctx, line.text, line.y, theme.text[line.role]);
  }

  // Load the bundled fonts a theme uses (browser only).
  async function loadFonts(theme, base = 'fonts/') {
    const used = new Set(Object.values(theme.text).map((s) => s.font));
    await Promise.all([...used].map(async (key) => {
      const f = T.FONTS[key];
      if (![...document.fonts].some((ff) => ff.family === f.family)) {
        const face = new FontFace(f.family, `url("${base}${f.file}")`, { weight: f.weight });
        document.fonts.add(face);
        await face.load();
      }
    }));
    await Promise.all(Object.values(theme.text).map((s) => document.fonts.load(fontCss(s, 40))));
  }

  return { drawBackground, drawFrame, sceneLines, loadFonts, fontCss, rng };
});
