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

// Only the explicit Steam depot channel changes persistence. Direct-download
// installers and development retain their existing local save behavior.
if (process.argv.includes("--tetrilaunch-steam-save")) {
  contextBridge.exposeInMainWorld("desktopSave", {
    open: (legacy) => ipcRenderer.invoke("steam:save-open", legacy),
    write: (values) => ipcRenderer.invoke("steam:save-write", values),
  });
}
