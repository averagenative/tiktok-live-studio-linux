'use strict';

// Launch OBS: a button that starts OBS (the packaged one or the Flatpak),
// optionally right into the TikTok Vertical profile and scenes, and then
// connects to it. Can also start OBS whenever this app starts.

const { findObs, obsRunning, launchObs } = require('../obs-process');
const { PROFILE, COLLECTION } = require('../../obs-setup');

const POLL_MS = 3000;
const LAUNCH_GRACE_MS = 30000;

function create({ find = findObs, running = obsRunning, launch = launchObs } = {}) {
  return {
    id: 'launch-obs',
    name: 'Launch OBS',
    description: 'Start OBS from here, and connect to it once it is up.',
    defaultEnabled: true,

    activate(ctx) {
      const installs = find();
      let isRunning = running();
      let launching = false;
      let stopGrace = null;

      const opts = () => ({ tiktokProfile: true, minimized: false, autoLaunch: false, install: '', ...ctx.data.get() });
      const chosen = () => installs.find((i) => i.kind === opts().install) || installs[0] || null;

      function status() {
        if (!installs.length) return { text: "Couldn't find OBS. Install it from your distribution's packages or from Flathub.", tone: 'err' };
        if (isRunning && ctx.obs.connected) return { text: 'OBS is running and connected.', tone: 'ok' };
        if (isRunning) return { text: 'OBS is running.', tone: 'ok' };
        if (launching) return { text: 'Starting OBS...' };
        return { text: "OBS isn't running." };
      }

      function render() {
        const o = opts();
        const st = status();
        ctx.ui.set({
          title: 'Launch OBS',
          dot: isRunning ? 'on' : 'off',
          items: [
            { type: 'text', text: st.text, tone: st.tone },
            installs.length > 1 && {
              type: 'select', id: 'install', label: 'Start', value: chosen().kind,
              options: installs.map((i) => ({ value: i.kind, label: i.label })),
            },
            {
              type: 'row',
              items: [{
                type: 'button', id: 'launch', style: 'primary',
                label: launching && !isRunning ? 'Starting OBS...' : 'Launch OBS',
                disabled: !installs.length || isRunning || launching,
              }],
            },
            { type: 'toggle', id: 'tiktokProfile', label: `Open the ${PROFILE} profile and scenes`, checked: !!o.tiktokProfile },
            { type: 'toggle', id: 'minimized', label: 'Start OBS minimized to the tray', checked: !!o.minimized },
            { type: 'toggle', id: 'autoLaunch', label: 'Launch OBS when LIVE Studio for Linux starts', checked: !!o.autoLaunch },
          ].filter(Boolean),
        });
      }

      async function start() {
        const install = chosen();
        if (!install) throw new Error("Couldn't find OBS to start");
        isRunning = running();
        if (isRunning) {
          render();
          return;
        }
        const o = opts();
        launching = true;
        render();
        try {
          const r = await launch(install, {
            minimized: !!o.minimized,
            profile: o.tiktokProfile ? PROFILE : '',
            collection: o.tiktokProfile ? COLLECTION : '',
          });
          ctx.log(`started ${install.label}: ${[r.cmd, ...r.args].join(' ')}`, 'obs');
        } catch (e) {
          launching = false;
          render();
          throw new Error(`Couldn't start OBS: ${e.message}`);
        }
        // The connection retries until OBS's WebSocket server answers.
        ctx.obs.connect().catch(() => {});
        stopGrace?.();
        stopGrace = ctx.after(LAUNCH_GRACE_MS, () => {
          launching = false;
          render();
        });
      }

      ctx.every(POLL_MS, () => {
        const now = running();
        if (now === isRunning) return;
        isRunning = now;
        if (now) launching = false;
        render();
      });
      ctx.on('obs', render);

      render();
      if (ctx.app.starting?.() && opts().autoLaunch && installs.length && !isRunning) {
        start().catch((e) => ctx.log(e.message, 'warn'));
      }

      return {
        async action(id, value) {
          if (id === 'launch') return start();
          if (id === 'install') ctx.data.set({ install: String(value) });
          else if (['tiktokProfile', 'minimized', 'autoLaunch'].includes(id)) ctx.data.set({ [id]: !!value });
          render();
          return undefined;
        },
      };
    },
  };
}

module.exports = create();
module.exports.create = create;
