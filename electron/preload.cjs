// CommonJS preload script for Electron sandbox compatibility
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentBoardDesktop', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  minimize: () => ipcRenderer.invoke('desktop:minimize'),
  maximize: () => ipcRenderer.invoke('desktop:maximize'),
  close: () => ipcRenderer.invoke('desktop:close'),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: (manual = false) => ipcRenderer.invoke('desktop:check-updates', !!manual),
  startUpdate: () => ipcRenderer.invoke('desktop:start-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateState: (callback) => {
    const handler = (_e, state) => callback(state);
    ipcRenderer.on('desktop:update-state', handler);
    return () => ipcRenderer.removeListener('desktop:update-state', handler);
  },
  onOpenRemoteControl: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('desktop:open-remote-control', handler);
    return () => ipcRenderer.removeListener('desktop:open-remote-control', handler);
  },
});

