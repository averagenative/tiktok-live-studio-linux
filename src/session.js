'use strict';

// One TikTok LIVE from create to finish:
//   POST /webcast/room/create/        -> room + RTMP push URL
//   POST /webcast/room/ping/anchor/   every 5 s, status prepare(1) then living(2)
//   POST /webcast/room/ping/anchor/   status finish(4) to end it
// OBS does the actual capture and encoding; we only point it at the URL.

const { EventEmitter } = require('node:events');
const { RoomStatus, PingStatus, CreateStatus, summarizeRoom, apiMessage, maskKey } = require('./util');

const PING_MS = 5000;

class LiveSession extends EventEmitter {
  constructor({ api, obs, log = () => {} }) {
    super();
    this.api = api;
    this.obs = obs;
    this.log = log;
    this.state = 'idle';
    this.room = null;
    this.status = RoomStatus.default;
    this.startedAt = 0;
    this.error = '';
    this.timer = null;
    this.pingFailures = 0;
    this.savedObsService = null;
    this.prevProfile = null;
    this.driveObs = false;

    this.obs.on('stream', (d) => this._onObsStream(d));
  }

  snapshot() {
    const push = this.room?.push;
    return {
      state: this.state,
      status: this.status,
      startedAt: this.startedAt,
      error: this.error,
      driveObs: this.driveObs,
      room: this.room && {
        roomId: this.room.roomId,
        streamId: this.room.streamId,
        title: this.room.title,
        ownerHandle: this.room.ownerHandle,
        server: push?.server || '',
        keyMasked: maskKey(push?.key || ''),
      },
    };
  }

  streamKey() {
    return this.room?.push?.key || '';
  }

  _set(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit('state', this.snapshot());
  }

  async goLive({ title, hashtagId = 0, gameTagId = 0, vertical = true, driveObs = true, profile = null }) {
    if (this.state !== 'idle' && this.state !== 'ended' && this.state !== 'error') {
      throw new Error(`Already ${this.state}`);
    }
    this.driveObs = driveObs;
    this._set('creating', { error: '', room: null, status: RoomStatus.default });

    try {
      if (driveObs && !this.obs.connected) throw new Error('Connect to OBS first, or turn off "Drive OBS"');

      const body = await this.api.createRoom({
        title: title || 'LIVE',
        live_studio: 1,
        gen_replay: true,
        chat_auth: 1,
        gift_auth: 1,
        chat_l2: 1,
        star_comment_switch: true,
        cover_uri: '',
        close_room_when_close_stream: false,
        hashtag_id: hashtagId || 0,
        game_tag_id: gameTagId || 0,
        multi_stream_scene: 0,
        multi_stream_source: vertical ? 1 : 0,
      });

      if (body.status_code !== CreateStatus.success) {
        throw new Error(`TikTok refused to create the LIVE: ${apiMessage(body)} (status_code ${body.status_code})`);
      }
      const room = summarizeRoom(body.data);
      if (room?.pingRoomId) this.room = room;
      if (!room?.push) {
        throw new Error('TikTok created the room but sent no RTMP push URL OBS can use');
      }
      this.log('live', `room ${room.roomId} created, server ${room.push.server} key ${maskKey(room.push.key)}`);

      this.status = RoomStatus.prepare;
      this._startPing();
      this._set('preparing');

      if (driveObs) await this._startObs(profile);
    } catch (e) {
      this.log('error', e.message);
      // A room that exists but never went live should not sit there.
      if (this.room) await this._finishRoom().catch(() => {});
      this._stopPing();
      this._set('error', { error: e.message });
      throw e;
    }
  }

  // With a profile (the "TikTok Vertical" one the setup creates), switch to
  // it for the LIVE: it carries the 1080x1920 canvas and encoder settings,
  // and switching back afterwards restores everything, stream service
  // included. Without one, only the stream service is swapped and restored.
  async _startObs(profile) {
    const status = await this.obs.getStreamStatus().catch(() => ({}));
    if (status.outputActive) {
      throw new Error('OBS is already streaming somewhere else; stop that stream first');
    }
    this.prevProfile = null;
    if (profile) {
      const { currentProfileName, profiles = [] } = await this.obs.getProfiles().catch(() => ({}));
      if (!profiles.includes(profile)) {
        this.log('warn', `OBS has no "${profile}" profile; run "Set up TikTok scenes" or untick the profile option`);
      } else if (currentProfileName !== profile) {
        await this.obs.setProfile(profile);
        this.prevProfile = currentProfileName;
        this.log('obs', `switched OBS to profile "${profile}"`);
      }
    }
    if (!this.prevProfile) this.savedObsService = await this.obs.getStreamService().catch(() => null);
    await this.obs.setCustomRtmp(this.room.push.server, this.room.push.key);
    await this.obs.startStream();
    this.log('obs', 'StartStream sent');
  }

  // Called when the user streams from OBS by hand (Drive OBS off).
  markStreaming() {
    if (this.state !== 'preparing') return;
    this._goLiving();
  }

  _goLiving() {
    this.status = RoomStatus.living;
    this.startedAt = Date.now();
    this._set('live');
    this._pingNow();
  }

  _onObsStream({ outputActive, outputState }) {
    if (!this.driveObs) return;
    if (outputActive && this.state === 'preparing') {
      this.log('obs', 'stream output is active');
      this._goLiving();
    } else if (!outputActive && this.state === 'live' && outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
      this.log('obs', 'OBS stopped streaming; ending the LIVE');
      this.endLive({ fromObs: true }).catch(() => {});
    }
  }

  _startPing() {
    this._stopPing();
    this.pingFailures = 0;
    const loop = async () => {
      await this._pingNow();
      if (this.timer !== null) this.timer = setTimeout(loop, PING_MS);
    };
    this.timer = setTimeout(loop, 0);
  }

  _stopPing() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async _pingNow() {
    if (!this.room) return;
    try {
      const body = await this.api.pingAnchor({
        status: this.status,
        roomId: this.room.pingRoomId,
        streamId: this.room.streamId,
      });
      this.pingFailures = 0;
      const code = body.status_code;
      if (code === PingStatus.RoomHasFinished || code === PingStatus.RoomHasFinishedByOtherDevice) {
        this.log('live', `TikTok says the room has finished (status_code ${code})`);
        this._stopPing();
        if (this.driveObs) await this.obs.stopStream().catch(() => {});
        await this._restoreObs();
        this._set('ended', { error: code === PingStatus.RoomHasFinishedByOtherDevice ? 'Ended from another device' : '' });
      } else if (code !== 0 && code !== PingStatus.RoomIsLiving) {
        this.log('warn', `ping: ${apiMessage(body)} (status_code ${code})`);
      }
    } catch (e) {
      this.pingFailures += 1;
      this.log('warn', `ping failed (${this.pingFailures}): ${e.message}`);
    }
  }

  async _finishRoom() {
    this.status = RoomStatus.finish;
    const body = await this.api.pingAnchor({
      status: RoomStatus.finish,
      roomId: this.room.pingRoomId,
      streamId: this.room.streamId,
    });
    this.log('live', `finish ping: status_code ${body.status_code}`);
  }

  async _restoreObs() {
    if (this.prevProfile) {
      // OBS won't switch profiles while the stream output is still stopping.
      for (let i = 0; i < 40; i += 1) {
        const s = await this.obs.getStreamStatus().catch(() => ({}));
        if (!s.outputActive) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await this.obs.setProfile(this.prevProfile)
        .then(() => this.log('obs', `switched OBS back to profile "${this.prevProfile}"`))
        .catch((e) => this.log('warn', `could not switch OBS back to "${this.prevProfile}": ${e.message}`));
    } else if (this.savedObsService?.streamServiceType) {
      await this.obs.setStreamService(this.savedObsService.streamServiceType,
        this.savedObsService.streamServiceSettings || {}).catch(() => {});
    }
    this.savedObsService = null;
    this.prevProfile = null;
  }

  async endLive({ fromObs = false } = {}) {
    if (!this.room || this.state === 'ending' || this.state === 'ended' || this.state === 'idle') return;
    this._set('ending');
    this._stopPing();
    if (this.driveObs && !fromObs) await this.obs.stopStream().catch((e) => this.log('warn', e.message));
    try {
      await this._finishRoom();
    } catch (e) {
      this.log('warn', `finish ping failed: ${e.message}; TikTok will end the room when pings stop`);
    }
    await this._restoreObs();
    this._set('ended');
  }
}

module.exports = { LiveSession, PING_MS };
