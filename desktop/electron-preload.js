const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  getMeta: () => ipcRenderer.invoke("desktop:get-meta"),
  openFile: () => ipcRenderer.invoke("desktop:open-file"),
  saveFile: (payload) => ipcRenderer.invoke("desktop:save-file", payload),
  showDependencyAssistant: () => ipcRenderer.invoke("desktop:show-dependency-assistant"),
  chooseFfmpegPath: () => ipcRenderer.invoke("desktop:choose-ffmpeg-path"),
  setFfmpegPath: (filePath) => ipcRenderer.invoke("desktop:set-ffmpeg-path", filePath)
});
