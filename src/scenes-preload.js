'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then((r) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
});

contextBridge.exposeInMainWorld('scenes', {
  state: () => call('scenes:state'),
  apply: (payload) => call('scenes:apply', payload),
  onObs: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('obs', handler);
    return () => ipcRenderer.removeListener('obs', handler);
  },
});
