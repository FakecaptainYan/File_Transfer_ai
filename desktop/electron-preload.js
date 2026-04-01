const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  getMeta: () => ipcRenderer.invoke("desktop:get-meta"),
  openFile: () => ipcRenderer.invoke("desktop:open-file"),
  openFiles: () => ipcRenderer.invoke("desktop:open-files"),
  saveFile: (payload) => ipcRenderer.invoke("desktop:save-file", payload),
  saveFileToDirectory: (payload) => ipcRenderer.invoke("desktop:save-file-to-directory", payload),
  pickOutputDirectory: () => ipcRenderer.invoke("desktop:pick-output-directory"),
  showDependencyAssistant: () => ipcRenderer.invoke("desktop:show-dependency-assistant"),
  chooseFfmpegPath: () => ipcRenderer.invoke("desktop:choose-ffmpeg-path"),
  setFfmpegPath: (filePath) => ipcRenderer.invoke("desktop:set-ffmpeg-path", filePath)
});
