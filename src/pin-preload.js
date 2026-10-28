'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinShell', {
  close: () => ipcRenderer.send('pinshell:close'),
  reload: () => ipcRenderer.send('pinshell:reload'),
  size: () => ipcRenderer.invoke('pinshell:size'),
  resize: (width, height) => ipcRenderer.send('pinshell:resize', { width, height }),
});
