// CommonJS preload script for Electron sandbox compatibility
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentBoardDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '0.1.0',
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  minimize: () => ipcRenderer.invoke('desktop:minimize'),
  maximize: () => ipcRenderer.invoke('desktop:maximize'),
  close: () => ipcRenderer.invoke('desktop:close'),
});
