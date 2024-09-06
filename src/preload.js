const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onRelayerAddresses: (callback) => ipcRenderer.on('relayer-addresses', (_event, value) => callback(value)),
})