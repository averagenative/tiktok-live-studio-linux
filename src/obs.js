'use strict';

// Small obs-websocket v5 client (built into OBS 28+), enough to point OBS at
// TikTok's ingest and start/stop the stream. No external dependencies.

const { EventEmitter } = require('node:events');
const { obsAuth } = require('./util');

const OpCode = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const EventSubscription = { Outputs: 1 << 6 };

class ObsClient extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.identified = false;
    this.obsVersion = '';
  }

  get connected() {
    return this.identified;
  }

  connect({ host = '127.0.0.1', port = 4455, password = '' } = {}) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.disconnect();
          reject(err);
        } else {
          resolve({ obsVersion: this.obsVersion });
        }
      };
      const timer = setTimeout(() => done(new Error(`Timed out connecting to OBS at ${host}:${port}`)), 8000);

      let ws;
      try {
        ws = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json');
      } catch (e) {
        done(e);
        return;
      }
      this.ws = ws;

      ws.onerror = () => done(new Error(`Could not reach OBS at ${host}:${port}. Is the WebSocket server enabled?`));
      ws.onclose = (ev) => {
        const wasIdentified = this.identified;
        this.identified = false;
        for (const { reject: rej } of this.pending.values()) rej(new Error('OBS connection closed'));
        this.pending.clear();
        if (!settled) {
          const reason = ev.code === 4009 ? 'OBS rejected the WebSocket password' : `OBS closed the connection (code ${ev.code})`;
          done(new Error(reason));
        } else if (wasIdentified) {
          this.emit('disconnected', ev.code);
        }
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.op) {
          case OpCode.Hello: {
            this.obsVersion = msg.d.obsWebSocketVersion || '';
            const identify = { rpcVersion: 1, eventSubscriptions: EventSubscription.Outputs };
            if (msg.d.authentication) {
              if (!password) {
                done(new Error('OBS WebSocket needs a password; set it in the OBS panel'));
                return;
              }
              identify.authentication = obsAuth(password, msg.d.authentication.salt, msg.d.authentication.challenge);
            }
            ws.send(JSON.stringify({ op: OpCode.Identify, d: identify }));
            break;
          }
          case OpCode.Identified:
            this.identified = true;
            this.log('obs', `connected to obs-websocket ${this.obsVersion}`);
            done();
            break;
          case OpCode.Event:
            this.emit('event', msg.d.eventType, msg.d.eventData || {});
            if (msg.d.eventType === 'StreamStateChanged') this.emit('stream', msg.d.eventData || {});
            break;
          case OpCode.RequestResponse: {
            const p = this.pending.get(msg.d.requestId);
            if (!p) break;
            this.pending.delete(msg.d.requestId);
            const st = msg.d.requestStatus || {};
            if (st.result) p.resolve(msg.d.responseData || {});
            else p.reject(new Error(`OBS ${msg.d.requestType} failed: ${st.comment || `code ${st.code}`}`));
            break;
          }
          default:
            break;
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
    }
    this.ws = null;
    this.identified = false;
  }

  call(requestType, requestData = {}) {
    if (!this.identified || !this.ws) return Promise.reject(new Error('Not connected to OBS'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: OpCode.Request, d: { requestType, requestId, requestData } }));
      setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error(`OBS ${requestType} timed out`));
      }, 10000);
    });
  }

  getStreamService() {
    return this.call('GetStreamServiceSettings');
  }

  setStreamService(streamServiceType, streamServiceSettings) {
    return this.call('SetStreamServiceSettings', { streamServiceType, streamServiceSettings });
  }

  setCustomRtmp(server, key) {
    return this.setStreamService('rtmp_custom', { server, key, use_auth: false, bwtest: false });
  }

  getProfiles() {
    return this.call('GetProfileList');
  }

  setProfile(profileName) {
    return this.call('SetCurrentProfile', { profileName });
  }

  getStreamStatus() {
    return this.call('GetStreamStatus');
  }

  startStream() {
    return this.call('StartStream');
  }

  stopStream() {
    return this.call('StopStream');
  }
}

module.exports = { ObsClient };
