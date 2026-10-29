'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then((r) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
});

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('ls', {
  getState: () => call('state:get'),
  setSettings: (patch) => call('settings:set', patch),
  login: () => call('auth:login'),
  logout: () => call('auth:logout'),
  refreshAccount: () => call('account:refresh'),
  applyStudio: () => call('account:apply-studio'),
  obsConnect: () => call('obs:connect'),
  obsDisconnect: () => call('obs:disconnect'),
  openScenes: () => call('scenes:open'),
  setRobot: (enabled) => call('obs:robot', enabled),
  setAvatarKind: (kind) => call('avatar:kind', kind),
  previewRobot: () => call('avatar:preview'),
  pinOpen: (url) => call('pin:open', url),
  pinClose: () => call('pin:close'),
  pinSet: (opts) => call('pin:set', opts),
  goLive: (form) => call('live:start', form),
  endLive: () => call('live:end'),
  markStreaming: () => call('live:mark-streaming'),
  copy: (what) => call('live:copy', what),
  copyLog: () => call('log:copy'),
  openExternal: (url) => call('open:external', url),
  fit: (width, height) => ipcRenderer.send('window:fit', { width, height }),
  onLog: on('log'),
  onSession: on('session'),
  onObs: on('obs'),
  onAccount: on('account'),
  onPin: on('pin'),
  onSetup: on('setup'),
});
