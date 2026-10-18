const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preload: only Electron's permitted module, with no generic IPC.
contextBridge.exposeInMainWorld("steam", {
  async unlockAchievement(apiName) {
    try {
      return (await ipcRenderer.invoke("steam:unlock-achievement", apiName)) === true;
    } catch {
      return false;
    }
  },
});
