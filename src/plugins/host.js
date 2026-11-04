'use strict';

// Runs the plugins that ship with the app. Each plugin is a module like:
//
//   module.exports = {
//     id: 'launch-obs', name: 'Launch OBS', description: '...', defaultEnabled: true,
//     activate(ctx) { ...; return { action(id, value) {}, deactivate() {} }; },
//   };
//
// Plugins run in the main process. Only built-in plugins load: there is no
// folder that users drop code into, because the main process holds the
// TikTok session and the OBS password.
//
// A plugin draws its card by handing ctx.ui.set() plain data (see
// renderer/plugins.js for the item types). The renderer builds the DOM
// itself, so plugin code never runs in the app window and its CSP stays as
// strict as it is. Clicks and edits come back through action(id, value).
//
// Timers and listeners registered through ctx are removed when the plugin is
// turned off, so a plugin only has to clean up what it made by other means.

const { EventEmitter } = require('node:events');

class PluginHost extends EventEmitter {
  // plugins: the built-in plugin modules.
  // store: { enabled(id), setEnabled(id, on), data(id), setData(id, obj),
  //          secret(id, name), setSecret(id, name, value) }.
  // deps: what plugins can reach in the app (see makeContext).
  constructor({ plugins, store, deps, log = () => {} }) {
    super();
    this.plugins = new Map(plugins.map((p) => [p.id, p]));
    this.store = store;
    this.deps = deps;
    this.log = log;
    this.running = new Map(); // id -> { instance, cleanups, card }
    this.errors = new Map();
    this.queued = false;
  }

  isEnabled(id) {
    const on = this.store.enabled(id);
    return on === undefined ? !!this.plugins.get(id)?.defaultEnabled : !!on;
  }

  async start() {
    for (const id of this.plugins.keys()) {
      if (this.isEnabled(id)) await this._activate(id);
    }
    this._changed();
  }

  list() {
    return [...this.plugins.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      enabled: this.isEnabled(p.id),
      error: this.errors.get(p.id) || '',
    }));
  }

  cards() {
    const out = {};
    for (const [id, r] of this.running) if (r.card) out[id] = r.card;
    return out;
  }

  snapshot() {
    return { plugins: this.list(), cards: this.cards() };
  }

  async setEnabled(id, on) {
    if (!this.plugins.has(id)) throw new Error(`No plugin named ${id}`);
    this.store.setEnabled(id, !!on);
    if (on) await this._activate(id);
    else await this._deactivate(id);
    this._changed();
    return this.snapshot();
  }

  async action(id, actionId, value) {
    const r = this.running.get(id);
    if (!r) throw new Error(`The ${this.plugins.get(id)?.name || id} plugin is off`);
    if (typeof r.instance?.action !== 'function') return undefined;
    return r.instance.action(String(actionId), value);
  }

  // App-wide events for plugins: 'obs' (connection state), 'settings', 'privacy'.
  broadcast(event, payload) {
    this.emit(`app:${event}`, payload);
  }

  async stop() {
    for (const id of [...this.running.keys()]) await this._deactivate(id);
  }

  async _activate(id) {
    if (this.running.has(id)) return;
    const plugin = this.plugins.get(id);
    const record = { instance: null, cleanups: [], card: null };
    this.running.set(id, record);
    this.errors.delete(id);
    try {
      record.instance = (await plugin.activate(this._context(plugin, record))) || {};
      this.log('plugin', `${plugin.name} on`);
    } catch (e) {
      this.errors.set(id, e.message);
      this.log('error', `${plugin.name} failed to start: ${e.message}`);
      await this._deactivate(id, { quiet: true });
    }
  }

  async _deactivate(id, { quiet = false } = {}) {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    try {
      await r.instance?.deactivate?.();
    } catch (e) {
      this.log('warn', `${this.plugins.get(id).name}: ${e.message}`);
    }
    for (const fn of r.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // already gone
      }
    }
    if (!quiet) this.log('plugin', `${this.plugins.get(id).name} off`);
  }

  // Coalesces bursts of card updates into one push to the renderer.
  _changed() {
    if (this.queued) return;
    this.queued = true;
    setImmediate(() => {
      this.queued = false;
      this.emit('change', this.snapshot());
    });
  }

  _context(plugin, record) {
    const { id } = plugin;
    const { deps, store } = this;
    const alive = () => this.running.get(id) === record;
    const track = (fn) => {
      record.cleanups.push(fn);
      return fn;
    };
    const listen = (emitter, event, fn) => {
      const handler = (...args) => {
        if (!alive()) return;
        try {
          const r = fn(...args);
          if (r && typeof r.catch === 'function') r.catch((e) => this.log('warn', `${plugin.name}: ${e.message}`));
        } catch (e) {
          this.log('warn', `${plugin.name}: ${e.message}`);
        }
      };
      emitter.on(event, handler);
      return track(() => emitter.removeListener(event, handler));
    };

    return {
      id,
      log: (message, kind = id) => this.log(kind, message),
      alive,
      data: {
        get: () => ({ ...(store.data(id) || {}) }),
        set: (patch) => store.setData(id, { ...(store.data(id) || {}), ...patch }),
      },
      secrets: {
        get: (name) => store.secret(id, name),
        set: (name, value) => store.setSecret(id, name, value),
      },
      ui: {
        set: (card) => {
          if (!alive()) return;
          record.card = card;
          this._changed();
        },
      },
      every: (ms, fn) => {
        const t = setInterval(() => {
          if (alive()) Promise.resolve().then(fn).catch((e) => this.log('warn', `${plugin.name}: ${e.message}`));
        }, ms);
        return track(() => clearInterval(t));
      },
      after: (ms, fn) => {
        const t = setTimeout(() => {
          if (alive()) Promise.resolve().then(fn).catch((e) => this.log('warn', `${plugin.name}: ${e.message}`));
        }, ms);
        return track(() => clearTimeout(t));
      },
      on: (event, fn) => listen(this, `app:${event}`, fn),
      obs: {
        get connected() {
          return deps.obs.connected;
        },
        call: (type, data, opts) => deps.obs.call(type, data, opts),
        on: (event, fn) => listen(deps.obs, event, fn),
        connect: () => deps.obsConnect(),
        state: () => deps.obsState(),
      },
      live: {
        snapshot: () => deps.live.snapshot(),
        on: (event, fn) => listen(deps.live, event, fn),
      },
      app: deps.app,
    };
  }
}

module.exports = { PluginHost };
