const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const { startServer } = require("../app-server");

let serverHandle = null;
let debugLogPath = "";
const DESKTOP_MIME_TYPES = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".hdp": "image/vnd.ms-photo",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".jxr": "image/vnd.ms-photo",
  ".m4a": "audio/mp4",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".wdp": "image/vnd.ms-photo"
};

async function writeDebugLog(message) {
  try {
    if (!debugLogPath) {
      debugLogPath = path.join(app.getPath("userData"), "desktop-debug.log");
    }

    await fs.appendFile(debugLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch (_error) {
  }
}

async function injectRendererBootstrap(window) {
  try {
    const scriptPath = path.join(__dirname, "..", "public", "app.js");
    const source = await fs.readFile(scriptPath, "utf8");
    await window.webContents.executeJavaScript(source, true);
    await writeDebugLog("Main process injected renderer bootstrap.");
  } catch (error) {
    await writeDebugLog(`Renderer bootstrap injection failed: ${error.message}`);
  }
}

async function createMainWindow() {
  nativeTheme.themeSource = "light";
  serverHandle = await startServer({ port: 0 });
  await writeDebugLog(`Started local API server at ${serverHandle.url}`);

  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    backgroundColor: "#eef3fb",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.on("dom-ready", () => {
    writeDebugLog("Renderer dom-ready fired.").catch(() => {});
    injectRendererBootstrap(window).catch(() => {});
  });
  window.webContents.on("did-finish-load", () => {
    writeDebugLog("Renderer did-finish-load fired.").catch(() => {});
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeDebugLog(`Renderer did-fail-load: ${errorCode} ${errorDescription} ${validatedURL}`).catch(() => {});
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    writeDebugLog(`Renderer process gone: ${JSON.stringify(details)}`).catch(() => {});
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    writeDebugLog(`Renderer console [${level}] ${sourceId}:${line} ${message}`).catch(() => {});
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  await window.loadFile(path.join(__dirname, "..", "public", "index.html"));
  await writeDebugLog("Loaded local renderer HTML.");
}

ipcMain.handle("desktop:get-meta", () => ({
  isDesktop: true,
  platform: process.platform,
  apiBase: serverHandle?.url || ""
}));

ipcMain.handle("desktop:save-file", async (_event, payload) => {
  const { suggestedName, base64Data } = payload || {};
  const result = await dialog.showSaveDialog({
    title: "保存转换结果",
    defaultPath: suggestedName || "converted-file"
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, Buffer.from(String(base64Data || ""), "base64"));
  return {
    canceled: false,
    filePath: result.filePath
  };
});

ipcMain.handle("desktop:open-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择媒体文件",
    properties: ["openFile"],
    filters: [
      {
        name: "媒体文件",
        extensions: [
          "mp4", "mov", "mkv", "avi", "webm", "m4v",
          "mp3", "wav", "aac", "m4a", "ogg", "flac",
          "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "jxr", "wdp", "hdp"
        ]
      },
      {
        name: "所有文件",
        extensions: ["*"]
      }
    ]
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const fileBuffer = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();

  return {
    canceled: false,
    fileName,
    filePath,
    mimeType: DESKTOP_MIME_TYPES[extension] || "",
    base64Data: fileBuffer.toString("base64")
  };
});

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

app.on("before-quit", () => {
  if (serverHandle) {
    serverHandle.close().catch(() => {});
  }
});
