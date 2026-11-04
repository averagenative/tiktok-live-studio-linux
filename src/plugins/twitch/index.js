'use strict';

// Twitch: stream to Twitch alongside the TikTok LIVE, and help with the
// Twitch side of it.
//
// - Stream to Twitch: OBS sends the second stream through the obs-multi-rtmp
//   plugin. This edits that plugin's Twitch target (stream key, on/off) in
//   the OBS profile used for the LIVE, and shows the Twitch output's health
//   while streaming.
// - Title and category: log in to Twitch (device code), then the TikTok title
//   and a chosen category go to Twitch when the LIVE starts.
// - Chat: the pinned window can show Twitch chat under the TikTok comments,
//   or on its own.

const { TwitchApi } = require('./api');
const rtmp = require('./multi-rtmp');
const { obsRunning, isThisComputer } = require('../obs-process');

// The project's registered Twitch app (client type Public). Empty means each
// user registers their own and pastes its client ID into the card.
const TWITCH_CLIENT_ID = '';

// 'tiktok' means no Twitch chat: the pinned window shows only TikTok's comments.
const CHAT_MODES = [
  { value: 'tiktok', label: 'Off' },
  { value: 'split', label: 'Under the TikTok comments' },
  { value: 'twitch', label: 'Instead of the TikTok comments' },
];
const TARGET_POLL_MS = 10000;
const OUTPUT_POLL_MS = 2000;
const VALIDATE_MS = 60 * 60 * 1000;
const LIVE_STATES = new Set(['creating', 'preparing', 'live', 'ending']);

// "twitch.tv/name", "@name", or "name" -> "name".
function normalizeChannel(input) {
  let s = String(input || '').trim();
  const m = /twitch\.tv\/(?:popout\/)?([^/?#\s]+)/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(s) ? s : '';
}

const chatUrl = (channel) => `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=`;

// Makes Twitch's popout chat see-through like the TikTok pane: the page, the
// chat room, and the header lose their own backgrounds, and one backing
// follows the pinned window's Panel background slider (--lsl-alpha).
// Cards like Twitch's notices, and the message box, keep their colors so
// they stay readable. The leaderboard strip only has generated class names,
// so it's matched by what it holds.
const CHAT_CSS = `
html, body { background: transparent !important; }
body { background-color: rgba(14, 16, 22, var(--lsl-alpha, 0.6)) !important; }
.chat-room, .stream-chat, .stream-chat-header, .chat-shell, .chat-room__content,
[data-a-target="chat-scroller"], .chat-scrollable-area__message-container, .chat-list--default, .chat-list--other,
div:has(> * [class*="channelLeaderboard"]), [class*="channelLeaderboard"] {
  background: transparent !important;
  box-shadow: none !important;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); border-radius: 3px; }
`;

function create({ fetch = (...a) => globalThis.fetch(...a), running = obsRunning, files = rtmp, isLocal = isThisComputer } = {}) {
  return {
    id: 'twitch',
    name: 'Twitch',
    description: 'Stream to Twitch with your TikTok LIVE, sync the title, and show Twitch chat in the pinned window.',
    defaultEnabled: false,

    activate(ctx) {
      const opts = () => ({
        chatMode: 'tiktok', channel: '', syncTitle: true, categoryId: '', categoryName: '', clientId: '', ...ctx.data.get(),
      });
      const clientId = () => opts().clientId || TWITCH_CLIENT_ID;
      const tokens = () => {
        try {
          return JSON.parse(ctx.secrets.get('tokens') || 'null');
        } catch {
          return null;
        }
      };
      let api = null;
      const twitch = () => {
        if (!api || api.clientId !== clientId()) {
          api = new TwitchApi({
            clientId: clientId(),
            fetch,
            getTokens: tokens,
            setTokens: (t) => ctx.secrets.set('tokens', t ? JSON.stringify(t) : null),
          });
        }
        return api;
      };

      let target = null; // { profile, profileDir, configDir, state, plugin, error }
      let output = null; // { text, tone } while OBS streams
      let streaming = false; // OBS's main stream
      let liveState = ctx.live.snapshot().state;
      let login = { pending: null, error: '' };
      let categories = [];
      let busy = false;
      let stopOutputPoll = null;
      let stopLoginPoll = null;
      let lastBytes = null;

      const liveActive = () => streaming || LIVE_STATES.has(liveState);

      // ---- the OBS profile and its obs-multi-rtmp target ----------------------

      async function targetProfile() {
        const s = ctx.app.settings();
        if (!(await isLocal(s.obsHost))) {
          return { error: 'OBS runs on another computer, so set the Twitch key in OBS there (Docks, then Multiple output).' };
        }
        let name = ctx.app.profileForLive();
        if (!name && ctx.obs.connected) name = (await ctx.obs.call('GetProfileList')).currentProfileName;
        if (!name) name = files.configDirs().map((d) => files.currentProfile(d)).find(Boolean) || '';
        if (!name) return { error: "Couldn't tell which OBS profile you stream with. Open OBS once, then try again." };
        const loc = files.locateProfile(name);
        if (!loc) return { name, error: `OBS has no "${name}" profile yet. Use Set up TikTok scenes in the OBS panel first.` };
        return { name, ...loc };
      }

      async function refreshTarget() {
        let p;
        try {
          p = await targetProfile();
        } catch (e) {
          p = { error: e.message };
        }
        if (p.error) {
          target = { profile: p.name || '', error: p.error };
        } else {
          try {
            const cfg = files.readConfig(p.profileDir);
            target = {
              profile: p.name, profileDir: p.profileDir, configDir: p.configDir,
              state: files.twitchState(cfg), plugin: files.pluginInstalled(p.configDir), error: '',
            };
          } catch (e) {
            target = { profile: p.name, error: `Couldn't read OBS's ${files.FILE}: ${e.message}` };
          }
        }
        render();
      }

      async function applyTarget(change) {
        if (liveActive()) throw new Error('Change the Twitch stream settings after the LIVE ends.');
        const p = await targetProfile();
        if (p.error) throw new Error(p.error);
        let current = '';
        if (ctx.obs.connected) {
          const [{ currentProfileName, profiles = [] }, stream] = await Promise.all([
            ctx.obs.call('GetProfileList'), ctx.obs.call('GetStreamStatus'),
          ]);
          if (stream.outputActive) throw new Error('OBS is streaming. Change the Twitch stream settings after it stops.');
          current = currentProfileName;
          if (current === p.name && !profiles.some((x) => x !== p.name)) {
            throw new Error('OBS needs a second profile to pick up the change. Close OBS, then try again.');
          }
        } else if (running() && files.currentProfile(p.configDir) === p.name) {
          // OBS would write its own copy over ours when it closes.
          throw new Error('OBS is open but not connected. Connect to OBS, or close it, then try again.');
        }
        files.writeConfig(p.profileDir, files.upsertTwitch(files.readConfig(p.profileDir), change));
        if (ctx.obs.connected && current === p.name) await files.reloadProfile(ctx.obs, p.name);
        const what = change.key !== undefined ? 'saved the stream key' : `turned Twitch ${change.enabled ? 'on' : 'off'}`;
        ctx.log(`${what} in OBS profile "${p.name}"`);
        await refreshTarget();
      }

      function describeTarget() {
        const st = target?.state;
        if (!st) return null;
        if (!st.exists) return { text: `No Twitch target in the "${target.profile}" OBS profile yet. Paste your stream key to add one.` };
        if (!st.hasKey) return { text: 'Add your Twitch stream key.', tone: st.enabled ? 'err' : undefined };
        if (!st.enabled) return { text: `Twitch is off. Your key stays saved in the "${target.profile}" OBS profile.` };
        if (!st.ownEncoder) {
          return { text: "Twitch shares OBS's encoder, so it gets OBS's keyframe interval. Twitch wants one every 2 seconds.", tone: 'warn' };
        }
        if (!st.syncStart) return { text: "Twitch doesn't start with OBS's stream. Switch it off and on here to fix that.", tone: 'warn' };
        return {
          text: `Ready: Twitch starts and stops with your TikTok stream, from the "${target.profile}" OBS profile`
            + `${st.keyintSec ? `, with a keyframe every ${st.keyintSec} seconds` : ''}.`,
          tone: 'ok',
        };
      }

      // ---- Twitch output health while OBS streams -------------------------------

      async function pollOutput() {
        if (!ctx.obs.connected) return;
        const on = !!target?.state?.enabled;
        let s;
        try {
          s = await ctx.obs.call('GetOutputStatus', { outputName: rtmp.OUTPUT_NAME });
        } catch {
          output = { text: on ? 'Twitch: not streaming' : 'Twitch: off', tone: on ? 'err' : undefined };
          render();
          return;
        }
        const now = Date.now();
        const kbps = lastBytes && now > lastBytes.t ? ((s.outputBytes - lastBytes.bytes) * 8) / (now - lastBytes.t) : 0;
        lastBytes = { bytes: s.outputBytes, t: now };
        if (!s.outputActive) {
          output = { text: on ? 'Twitch: not streaming' : 'Twitch: off', tone: on ? 'err' : undefined };
        } else if (s.outputReconnecting) {
          output = { text: 'Twitch: reconnecting...', tone: 'err' };
        } else {
          const dropped = s.outputTotalFrames ? (100 * (s.outputSkippedFrames || 0)) / s.outputTotalFrames : 0;
          const parts = [`Twitch: streaming${kbps ? `, ${(kbps / 1000).toFixed(1)} Mbps` : ''}`];
          if (dropped >= 0.5) parts.push(`${dropped.toFixed(1)}% of frames dropped`);
          if ((s.outputCongestion || 0) > 0.25) parts.push('network congested');
          output = { text: parts.join(', '), tone: parts.length > 1 ? 'warn' : 'ok' };
        }
        render();
      }

      function watchOutput(active) {
        streaming = active;
        if (active && !stopOutputPoll) {
          lastBytes = null;
          stopOutputPoll = ctx.every(OUTPUT_POLL_MS, pollOutput);
          pollOutput();
        } else if (!active && stopOutputPoll) {
          stopOutputPoll();
          stopOutputPoll = null;
          output = null;
          refreshTarget();
        }
        render();
      }

      async function checkStream() {
        if (!ctx.obs.connected) return watchOutput(false);
        const s = await ctx.obs.call('GetStreamStatus').catch(() => ({}));
        return watchOutput(!!s.outputActive);
      }

      // ---- Twitch login, title, and category -------------------------------------

      async function startLogin() {
        if (!clientId()) throw new Error('Add a Twitch app client ID first.');
        stopLoginPoll?.();
        const d = await twitch().startDeviceLogin();
        login = { pending: { userCode: d.userCode, uri: d.verificationUri, expiresAt: Date.now() + d.expiresIn * 1000 }, error: '' };
        render();
        await ctx.app.openExternal(d.verificationUri).catch(() => {});
        let interval = d.interval;
        const tick = async () => {
          stopLoginPoll = null;
          if (!login.pending) return;
          if (Date.now() > login.pending.expiresAt) {
            login = { pending: null, error: 'The Twitch code expired. Log in again.' };
            render();
            return;
          }
          let r;
          try {
            r = await twitch().pollDeviceLogin(d.deviceCode);
          } catch (e) {
            login = { pending: null, error: e.message };
            render();
            return;
          }
          if (r === 'done') {
            login = { pending: null, error: '' };
            ctx.log(`logged in to Twitch as ${tokens()?.login || 'unknown'}`);
            applyChat();
            render();
            return;
          }
          if (r === 'slow_down') interval += 5;
          stopLoginPoll = ctx.after(interval * 1000, tick);
        };
        stopLoginPoll = ctx.after(interval * 1000, tick);
      }

      async function checkLogin() {
        if (!tokens() || !clientId()) return;
        try {
          const who = await twitch().validate();
          if (!who) ctx.log('your Twitch login expired; log in to Twitch again', 'warn');
        } catch (e) {
          ctx.log(e.message, 'warn');
        }
        render();
      }

      // Before OBS starts, so Twitch's "went live" notice carries the new title.
      // The title is what you typed: with none, TikTok names the room "LIVE",
      // which shouldn't replace your Twitch title.
      async function syncChannel() {
        const o = opts();
        const t = tokens();
        if (!t?.userId || !target?.state?.enabled || !target.state.hasKey) return;
        const title = o.syncTitle ? String(ctx.app.settings().lastTitle || '').trim() : '';
        if (!title && !o.categoryId) return;
        try {
          if (await twitch().setChannel(t.userId, { title, gameId: o.categoryId })) {
            ctx.log(`Twitch ${title ? `title set to "${title}"` : 'category set'}${title && o.categoryName ? `, category ${o.categoryName}` : ''}`);
          }
        } catch (e) {
          ctx.log(`couldn't update the Twitch title: ${e.message}`, 'warn');
        }
      }

      // ---- chat in the pinned window ---------------------------------------------

      const channel = () => tokens()?.login || opts().channel || '';

      function applyChat() {
        const o = opts();
        const ch = channel();
        if (o.chatMode === 'tiktok' || !ch) ctx.app.pin.setExtra(null);
        else ctx.app.pin.setExtra({ url: chatUrl(ch), partition: 'persist:twitch', mode: o.chatMode === 'twitch' ? 'only' : 'split', css: CHAT_CSS });
      }

      // ---- the card --------------------------------------------------------------

      function render() {
        const o = opts();
        const t = tokens();
        const st = target?.state;
        const locked = busy || liveActive();

        const stream = [{ type: 'heading', text: 'Stream to Twitch' }];
        if (target?.error) {
          stream.push({ type: 'text', text: target.error, tone: 'err', small: true });
        } else if (target) {
          if (!target.plugin) {
            stream.push({
              type: 'text', tone: 'err', small: true,
              text: "OBS doesn't have the obs-multi-rtmp plugin, which sends the Twitch stream. Install it from github.com/sorayuki/obs-multi-rtmp and restart OBS.",
            });
          }
          stream.push({ type: 'toggle', id: 'enabled', label: 'Also stream to Twitch when I go LIVE', checked: !!(st?.exists && st.enabled), disabled: locked });
          stream.push({
            type: 'input', id: 'key', label: 'Twitch stream key', secret: true, disabled: locked,
            placeholder: st?.hasKey ? 'saved (paste a new one to change it)' : 'paste it from your Twitch dashboard',
          });
          stream.push({ type: 'row', items: [{ type: 'button', id: 'openDashboard', label: 'Get my stream key' }] });
          const d = describeTarget();
          if (d) stream.push({ type: 'text', small: true, ...d });
        } else {
          stream.push({ type: 'text', text: 'Checking OBS...', small: true });
        }
        if (output) stream.push({ type: 'text', text: output.text, tone: output.tone });
        else if (liveActive() && st?.enabled) stream.push({ type: 'text', text: 'Twitch: waiting for OBS...', small: true });
        if (liveActive() && !(st?.enabled && st.hasKey) && !target?.error) {
          stream.push({
            type: 'text', small: true,
            text: 'To add Twitch to this LIVE, paste your key in OBS under Docks, then Multiple output, and click Start there. '
              + 'The settings here unlock when the LIVE ends.',
          });
        }

        const title = [{ type: 'heading', text: 'Title and category' }];
        if (!clientId()) {
          title.push(
            {
              type: 'text', small: true,
              text: 'Logging in to Twitch needs a Twitch app client ID. Register an app on the Twitch developer console '
                + '(category Application Integration, client type Public, OAuth redirect URL https://localhost, which the app never uses) and paste its client ID here.',
            },
            { type: 'input', id: 'clientId', label: 'Twitch app client ID', private: true, placeholder: 'client ID' },
            { type: 'row', items: [{ type: 'button', id: 'openConsole', label: 'Open the Twitch developer console' }] },
          );
        } else if (login.pending) {
          title.push(
            { type: 'text', text: 'Enter this code at twitch.tv/activate:', small: true },
            { type: 'code', text: login.pending.userCode, private: true },
            { type: 'row', items: [{ type: 'button', id: 'openActivate', label: 'Open twitch.tv/activate' }, { type: 'button', id: 'cancelLogin', label: 'Cancel' }] },
          );
        } else if (t?.login) {
          title.push(
            { type: 'text', text: `Logged in to Twitch as ${t.login}`, tone: 'ok', private: true },
            { type: 'row', items: [{ type: 'button', id: 'logout', label: 'Log out of Twitch' }] },
          );
        } else {
          title.push(
            { type: 'row', items: [{ type: 'button', id: 'login', label: 'Log in to Twitch', style: 'primary' }] },
            { type: 'text', small: true, text: 'Lets this app set your Twitch stream title and category. Twitch asks you to allow managing your broadcast settings.' },
          );
        }
        if (login.error) title.push({ type: 'text', text: login.error, tone: 'err', small: true });
        const loggedIn = !!t?.userId;
        title.push({ type: 'toggle', id: 'syncTitle', label: 'Use my TikTok title on Twitch when I go LIVE', checked: !!o.syncTitle, disabled: !loggedIn });
        const options = [{ value: '', label: "Don't change it" }];
        if (o.categoryId && !categories.some((c) => c.id === o.categoryId)) options.push({ value: o.categoryId, label: o.categoryName || o.categoryId });
        for (const c of categories) options.push({ value: c.id, label: c.name });
        title.push(
          {
            type: 'row',
            items: [
              { type: 'input', id: 'categoryQuery', label: 'Find a category', placeholder: 'like Just Chatting', disabled: !loggedIn, submit: 'searchCategory' },
              { type: 'button', id: 'searchCategory', label: 'Search', valueFrom: 'categoryQuery', disabled: !loggedIn || busy },
            ],
          },
          { type: 'select', id: 'category', label: 'Twitch category', value: o.categoryId, options, disabled: !loggedIn },
        );

        const chat = [
          { type: 'heading', text: 'Chat' },
          { type: 'select', id: 'chatMode', label: 'Twitch chat in the pinned window', value: o.chatMode, options: CHAT_MODES },
        ];
        if (!t?.login) {
          chat.push({ type: 'input', id: 'channel', label: 'Twitch channel', value: o.channel, placeholder: 'your Twitch username', private: true });
        }
        chat.push({ type: 'row', items: [{ type: 'button', id: 'openChat', label: 'Open Twitch chat', style: 'primary', disabled: !channel() }] });
        chat.push({
          type: 'text', small: true,
          text: !channel() ? 'Log in to Twitch or enter your Twitch channel to show its chat.'
            : o.chatMode === 'twitch' ? 'To chat, log in to Twitch inside the chat pane.'
              : 'To chat, log in to Twitch inside the chat pane. Drag the line between the panes to resize them.',
        });

        const live = output?.tone === 'ok' || output?.tone === 'warn';
        ctx.ui.set({
          title: 'Twitch',
          wide: true,
          dot: live ? 'on' : output?.tone === 'err' ? 'err' : 'off',
          items: [{ type: 'group', items: stream }, { type: 'group', items: title }, { type: 'group', items: chat }],
        });
      }

      async function withBusy(fn) {
        busy = true;
        render();
        try {
          return await fn();
        } finally {
          busy = false;
          render();
        }
      }

      // ---- wiring ------------------------------------------------------------------

      ctx.obs.on('stream', ({ outputActive }) => watchOutput(!!outputActive));
      ctx.on('obs', () => {
        checkStream().catch(() => {});
        refreshTarget();
      });
      ctx.on('settings', () => refreshTarget());
      ctx.live.on('state', (s) => {
        const prev = liveState;
        liveState = s.state;
        if (s.state === 'preparing' && prev !== 'preparing') syncChannel();
        render();
      });
      ctx.every(TARGET_POLL_MS, () => (liveActive() ? undefined : refreshTarget()));
      ctx.every(VALIDATE_MS, checkLogin);

      render();
      refreshTarget();
      checkStream().catch(() => {});
      checkLogin();
      applyChat();

      return {
        async action(id, value) {
          switch (id) {
            case 'enabled':
              return withBusy(() => applyTarget({ enabled: !!value })).finally(render);
            case 'key': {
              const key = String(value || '').trim();
              if (!key) return undefined;
              if (/\s/.test(key) || key.length < 8) throw new Error("That doesn't look like a Twitch stream key.");
              return withBusy(() => applyTarget({ key }));
            }
            case 'openDashboard':
              return ctx.app.openExternal('https://dashboard.twitch.tv/settings/stream');
            case 'openConsole':
              return ctx.app.openExternal('https://dev.twitch.tv/console/apps/create');
            case 'clientId': {
              const v = String(value || '').trim();
              if (v && !/^[a-z0-9]{20,40}$/i.test(v)) throw new Error("That doesn't look like a Twitch client ID.");
              ctx.data.set({ clientId: v });
              break;
            }
            case 'login':
              return withBusy(startLogin);
            case 'openActivate':
              if (login.pending) return ctx.app.openExternal(login.pending.uri);
              break;
            case 'cancelLogin':
              stopLoginPoll?.();
              stopLoginPoll = null;
              login = { pending: null, error: '' };
              break;
            case 'logout':
              await twitch().revoke();
              ctx.log('logged out of Twitch');
              applyChat();
              break;
            case 'syncTitle':
              ctx.data.set({ syncTitle: !!value });
              break;
            case 'searchCategory':
              return withBusy(async () => {
                categories = await twitch().searchCategories(value);
                if (!categories.length) ctx.log(`no Twitch categories match "${value}"`);
              });
            case 'category': {
              const v = String(value || '');
              const name = categories.find((c) => c.id === v)?.name || (v === opts().categoryId ? opts().categoryName : '');
              ctx.data.set({ categoryId: v, categoryName: v ? name : '' });
              break;
            }
            case 'chatMode':
              if (CHAT_MODES.some((m) => m.value === value)) ctx.data.set({ chatMode: value });
              applyChat();
              break;
            case 'channel': {
              const ch = normalizeChannel(value);
              if (String(value || '').trim() && !ch) throw new Error("That doesn't look like a Twitch channel name.");
              ctx.data.set({ channel: ch });
              applyChat();
              break;
            }
            case 'categoryQuery':
              break;
            case 'openChat':
              if (!channel()) throw new Error('Log in to Twitch or enter your Twitch channel first.');
              // With Twitch chat off, the button turns it on under the TikTok comments.
              if (opts().chatMode === 'tiktok') ctx.data.set({ chatMode: 'split' });
              applyChat();
              await ctx.app.pin.open();
              break;
            default:
              break;
          }
          render();
          return undefined;
        },
        deactivate() {
          ctx.app.pin.setExtra(null);
        },
      };
    },
  };
}

module.exports = create();
module.exports.create = create;
module.exports.normalizeChannel = normalizeChannel;
module.exports.chatUrl = chatUrl;
