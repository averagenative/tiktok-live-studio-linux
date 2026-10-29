'use strict';

// The robot: a visor face with LED eyes, an equalizer mouth, and glowing
// antenna, core, and joints. Accent colors are #25f4ee and #fe2c55.
(window.AVATARS = window.AVATARS || {}).robot = {
  name: 'Robot',
  wide: '-71 95 1102 620',
  svg: `
    <defs>
      <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a4150"/>
        <stop offset="0.45" stop-color="#232833"/>
        <stop offset="1" stop-color="#14171e"/>
      </linearGradient>
      <linearGradient id="metalSide" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#1a1e27"/>
        <stop offset="0.5" stop-color="#2c3240"/>
        <stop offset="1" stop-color="#1a1e27"/>
      </linearGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#25f4ee"/>
        <stop offset="1" stop-color="#fe2c55"/>
      </linearGradient>
      <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0a0f16"/>
        <stop offset="1" stop-color="#03050a"/>
      </linearGradient>
      <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#25f4ee"/>
        <stop offset="1" stop-color="#fe2c55"/>
      </linearGradient>
      <radialGradient id="coreGlow">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.25" stop-color="#25f4ee"/>
        <stop offset="1" stop-color="#25f4ee" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="tipGlow">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.35" stop-color="#fe2c55"/>
        <stop offset="1" stop-color="#fe2c55" stop-opacity="0"/>
      </radialGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="8" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="visorClip"><rect x="275" y="300" width="410" height="260" rx="60"/></clipPath>
    </defs>

    <g id="robot">
      <!-- Torso: only in view for the portrait layout. -->
      <g id="torso">
        <path d="M140 1280 L140 930 Q140 820 260 800 L700 800 Q820 820 820 930 L820 1280 Z" fill="url(#metal)" stroke="url(#rim)" stroke-width="4" stroke-opacity="0.55"/>
        <path d="M300 860 L660 860 Q690 860 690 890 L690 1060 Q690 1120 630 1140 L330 1140 Q270 1120 270 1060 L270 890 Q270 860 300 860 Z" fill="url(#metalSide)" stroke="#0b0d12" stroke-width="3"/>
        <circle id="coreHalo" cx="480" cy="990" r="120" fill="url(#coreGlow)" opacity="0.5"/>
        <circle cx="480" cy="990" r="58" fill="#071015" stroke="url(#rim)" stroke-width="6"/>
        <circle id="core" cx="480" cy="990" r="34" fill="#25f4ee" filter="url(#glow)"/>
        <g stroke="#0b0d12" stroke-width="4" stroke-linecap="round" opacity="0.8">
          <line x1="200" y1="900" x2="200" y2="1240"/><line x1="760" y1="900" x2="760" y2="1240"/>
        </g>
        <g fill="#25f4ee" opacity="0.6">
          <rect x="320" y="1180" width="40" height="10" rx="5"/><rect x="380" y="1180" width="40" height="10" rx="5"/>
          <rect x="540" y="1180" width="40" height="10" rx="5"/><rect x="600" y="1180" width="40" height="10" rx="5"/>
        </g>
        <!-- Neck -->
        <rect x="415" y="690" width="130" height="120" rx="18" fill="url(#metalSide)" stroke="#0b0d12" stroke-width="3"/>
        <g stroke="#0b0d12" stroke-width="5"><line x1="420" y1="725" x2="540" y2="725"/><line x1="420" y1="760" x2="540" y2="760"/></g>
        <!-- Arms: shoulder and elbow joints, in front of the torso -->
        <g id="armL">
          <rect x="114" y="870" width="72" height="230" rx="36" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.45"/>
          <circle cx="150" cy="880" r="46" fill="url(#metal)" stroke="url(#rim)" stroke-width="4" stroke-opacity="0.6"/>
          <circle cx="150" cy="880" r="14" fill="#25f4ee" opacity="0.6" class="earLed"/>
          <g id="foreL">
            <rect x="118" y="1080" width="64" height="190" rx="32" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.45"/>
            <g stroke="#0b0d12" stroke-width="5"><line x1="122" y1="1180" x2="178" y2="1180"/><line x1="122" y1="1205" x2="178" y2="1205"/></g>
            <circle cx="150" cy="1085" r="30" fill="url(#metal)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.6"/>
            <circle cx="150" cy="1275" r="34" fill="url(#metal)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.6"/>
            <circle cx="150" cy="1275" r="10" fill="#25f4ee" opacity="0.6" class="earLed"/>
          </g>
        </g>
        <g id="armR">
          <rect x="774" y="870" width="72" height="230" rx="36" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.45"/>
          <circle cx="810" cy="880" r="46" fill="url(#metal)" stroke="url(#rim)" stroke-width="4" stroke-opacity="0.6"/>
          <circle cx="810" cy="880" r="14" fill="#25f4ee" opacity="0.6" class="earLed"/>
          <g id="foreR">
            <rect x="778" y="1080" width="64" height="190" rx="32" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.45"/>
            <g stroke="#0b0d12" stroke-width="5"><line x1="782" y1="1180" x2="838" y2="1180"/><line x1="782" y1="1205" x2="838" y2="1205"/></g>
            <circle cx="810" cy="1085" r="30" fill="url(#metal)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.6"/>
            <circle cx="810" cy="1275" r="34" fill="url(#metal)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.6"/>
            <circle cx="810" cy="1275" r="10" fill="#25f4ee" opacity="0.6" class="earLed"/>
          </g>
        </g>
      </g>

      <g id="head">
        <!-- Antenna -->
        <line x1="480" y1="252" x2="480" y2="160" stroke="#2c3240" stroke-width="14" stroke-linecap="round"/>
        <circle id="tipHalo" cx="480" cy="140" r="60" fill="url(#tipGlow)" opacity="0.6"/>
        <circle id="tip" cx="480" cy="140" r="20" fill="#fe2c55" filter="url(#softGlow)"/>
        <!-- Ears -->
        <g id="earL">
          <rect x="180" y="390" width="60" height="160" rx="22" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.5"/>
          <circle cx="210" cy="470" r="12" fill="#25f4ee" opacity="0.7" class="earLed"/>
        </g>
        <g id="earR">
          <rect x="720" y="390" width="60" height="160" rx="22" fill="url(#metalSide)" stroke="url(#rim)" stroke-width="3" stroke-opacity="0.5"/>
          <circle cx="750" cy="470" r="12" fill="#25f4ee" opacity="0.7" class="earLed"/>
        </g>
        <!-- Head shell -->
        <rect x="230" y="250" width="500" height="440" rx="96" fill="url(#metal)" stroke="url(#rim)" stroke-width="5" stroke-opacity="0.8"/>
        <path d="M300 268 Q480 238 660 268" stroke="#ffffff" stroke-opacity="0.18" stroke-width="10" fill="none" stroke-linecap="round"/>
        <!-- Visor -->
        <rect x="275" y="300" width="410" height="260" rx="60" fill="url(#visor)" stroke="#25f4ee" stroke-opacity="0.35" stroke-width="3"/>
        <g clip-path="url(#visorClip)">
          <g id="scan" opacity="0.10">
            <rect x="275" y="300" width="410" height="3" fill="#25f4ee"/>
          </g>
          <g id="face">
          <g id="eyes" filter="url(#glow)">
            <rect id="eyeL" x="355" y="360" width="80" height="80" rx="36" fill="#25f4ee"/>
            <rect id="eyeR" x="525" y="360" width="80" height="80" rx="36" fill="#25f4ee"/>
          </g>
          <g id="mouth" filter="url(#softGlow)"></g>
          <circle id="cheekL" cx="318" cy="495" r="10" fill="#fe2c55" opacity="0.35"/>
          <circle id="cheekR" cx="642" cy="495" r="10" fill="#fe2c55" opacity="0.35"/>
          </g>
        </g>
        <path d="M300 320 Q330 304 380 302" stroke="#ffffff" stroke-opacity="0.14" stroke-width="8" fill="none" stroke-linecap="round"/>
        <!-- Chin grille -->
        <g stroke="#0b0d12" stroke-width="5" stroke-linecap="round">
          <line x1="400" y1="610" x2="560" y2="610"/><line x1="410" y1="635" x2="550" y2="635"/><line x1="425" y1="660" x2="535" y2="660"/>
        </g>
      </g>
    </g>
`,

  init({ $, NS }) {
    // Mouth: LED equalizer bars.
    const BARS = 9;
    const BAR_W = 22;
    const GAP = 12;
    const total = BARS * BAR_W + (BARS - 1) * GAP;
    const x0 = 480 - total / 2;
    this.bars = [];
    for (let i = 0; i < BARS; i += 1) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x0 + i * (BAR_W + GAP));
      r.setAttribute('width', BAR_W);
      r.setAttribute('rx', 8);
      r.setAttribute('fill', 'url(#bar)');
      $('mouth').append(r);
      this.bars.push({ el: r, h: 8 });
    }
    this.leds = document.querySelectorAll('.earLed');
  },

  apply(p, { $, setT }) {
    const { t, L, C, turn } = p;
    setT('earL', `translate(${(turn * 14).toFixed(1)} 0)`);
    setT('earR', `translate(${(turn * 14).toFixed(1)} 0)`);
    $('earL').setAttribute('opacity', (1 - Math.max(0, -turn) * 0.5).toFixed(2));
    $('earR').setAttribute('opacity', (1 - Math.max(0, turn) * 0.5).toFixed(2));

    const eyeH = Math.max(6, 80 * p.open * p.squint);
    for (const id of ['eyeL', 'eyeR']) {
      const e = $(id);
      e.setAttribute('height', eyeH.toFixed(1));
      e.setAttribute('y', (400 - eyeH / 2).toFixed(1));
      e.setAttribute('opacity', (0.75 + L * 0.25).toFixed(2));
    }

    // Mouth bars: a bell-shaped "spectrum" scaled by the level.
    const BARS = this.bars.length;
    const noise = (i) => 0.5 + 0.5 * Math.sin(t * (7 + i * 1.3) + i * 2.1) * Math.sin(t * (3.1 + i * 0.7));
    this.bars.forEach((b, i) => {
      const center = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
      const idle = 6 + 3 * Math.sin(t * 2 + i);
      const talk = L ** 0.6 * (40 + 85 * center) * (0.6 + 0.4 * noise(i));
      b.h += (Math.max(idle, talk) - b.h) * 0.5;
      b.el.setAttribute('height', b.h.toFixed(1));
      b.el.setAttribute('y', (500 - b.h / 2).toFixed(1));
      b.el.setAttribute('opacity', (0.55 + Math.min(1, b.h / 60) * 0.45).toFixed(2));
    });

    $('tipHalo').setAttribute('opacity', (0.35 + p.pulse * 0.2 + L * 0.45 + C * 0.2).toFixed(2));
    $('tip').setAttribute('r', (18 + L * 6 + C * 6).toFixed(1));
    $('coreHalo').setAttribute('opacity', (0.35 + p.pulse * 0.15 + L * 0.5).toFixed(2));
    $('core').setAttribute('r', (32 + L * 10 + p.pulse * 2).toFixed(1));
    for (const c of ['cheekL', 'cheekR']) $(c).setAttribute('opacity', (0.25 + L * 0.6).toFixed(2));
    this.leds.forEach((e) => e.setAttribute('opacity', (0.45 + p.pulse * 0.3 + L * 0.25).toFixed(2)));

    // Scan line sweeping down the visor.
    setT('scan', `translate(0 ${((t * 90) % 260).toFixed(1)})`);
  },
};
