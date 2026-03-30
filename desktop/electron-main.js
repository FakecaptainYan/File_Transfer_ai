const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const { startServer } = require("../app-server");
const { getJxrSupportStatus, resolveFfmpegPath, validateFfmpegPath } = require("../media-core");

let serverHandle = null;
let debugLogPath = "";
let desktopSettings = {
  ffmpegPath: ""
};
let dependencyPromptOpen = false;
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

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function applySavedEnvironment() {
  const savedPath = String(desktopSettings.ffmpegPath || "").trim();
  if (savedPath) {
    process.env.FFMPEG_PATH = savedPath;
  } else {
    delete process.env.FFMPEG_PATH;
  }
}

async function loadDesktopSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    desktopSettings = {
      ffmpegPath: typeof parsed.ffmpegPath === "string" ? parsed.ffmpegPath : ""
    };
  } catch (_error) {
    desktopSettings = {
      ffmpegPath: ""
    };
  }

  applySavedEnvironment();
}

async function saveDesktopSettings() {
  await fs.writeFile(getSettingsPath(), JSON.stringify(desktopSettings, null, 2), "utf8");
}

async function setSavedFfmpegPath(filePath) {
  desktopSettings.ffmpegPath = String(filePath || "").trim();
  applySavedEnvironment();
  await saveDesktopSettings();
}

function getSavedFfmpegPath() {
  return String(desktopSettings.ffmpegPath || "").trim();
}

function escapeOsaScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function runCommand(command, args, options = {}) {
  const { spawn } = require("child_process");

  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(command, args, {
      windowsHide: true,
      ...options
    });

    child.stdout?.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(output.join("\n"));
        return;
      }

      reject(new Error(output.join("\n") || `${command} exited with code ${code}`));
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function findMacBrewPath() {
  const preferredPaths = [
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew"
  ];

  for (const candidate of preferredPaths) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  try {
    const whichOutput = await runCommand("/usr/bin/which", ["brew"]);
    const candidate = whichOutput.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return candidate || "";
  } catch (_error) {
    return "";
  }
}

async function openTerminalWithCommand(command) {
  const escapedCommand = escapeOsaScriptString(command);
  await runCommand("/usr/bin/osascript", [
    "-e", 'tell application "Terminal"',
    "-e", "activate",
    "-e", `do script "${escapedCommand}"`,
    "-e", "end tell"
  ]);
}

async function getDependencySnapshot() {
  const ffmpegPath = await resolveFfmpegPath(getSavedFfmpegPath());
  const brewPath = process.platform === "darwin" ? await findMacBrewPath() : "";
  const jxrStatus = await getJxrSupportStatus();

  return {
    ffmpegPath,
    brewPath,
    jxrStatus
  };
}

function getMissingDependencies(snapshot, { includeOptional = true } = {}) {
  const missing = [];

  if (!snapshot.ffmpegPath) {
    missing.push("ffmpeg");
  }

  if (includeOptional && !snapshot.jxrStatus?.supported) {
    missing.push("jxrlib");
  }

  return missing;
}

function getMacInstallLabel(snapshot, missingDependencies) {
  const label = missingDependencies.map((name) => (name === "jxrlib" ? "JXR 支持" : "FFmpeg")).join(" + ");

  if (!missingDependencies.length) {
    return "安装依赖";
  }

  if (!snapshot.brewPath) {
    return `安装 Homebrew + ${label}`;
  }

  return `安装 ${label}`;
}

function buildMacInstallCommand(snapshot, missingDependencies) {
  const packages = missingDependencies.filter((name) => ["ffmpeg", "jxrlib"].includes(name));

  if (!packages.length) {
    return "";
  }

  if (snapshot.brewPath) {
    return `export PATH="${path.dirname(snapshot.brewPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; "${snapshot.brewPath}" install ${packages.join(" ")}`;
  }

  return `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" && brew install ${packages.join(" ")}`;
}

function getDependencyMessage(snapshot, missingDependencies) {
  const hasFfmpeg = missingDependencies.includes("ffmpeg");
  const hasJxr = missingDependencies.includes("jxrlib");

  if (hasFfmpeg && hasJxr) {
    return {
      message: "当前没有检测到可用的 FFmpeg，并且 JXR 解码器也还没有安装。",
      detail: "你可以一键安装 FFmpeg 和 jxrlib，也可以先手动选择本机已有的 FFmpeg。安装完成后，macOS 就能直接转换 JXR / WDP / HDP。"
    };
  }

  if (hasFfmpeg) {
    return {
      message: "当前没有检测到可用的 FFmpeg。",
      detail: "你可以一键启动安装流程，或者手动选择本机已有的 FFmpeg 可执行文件。"
    };
  }

  if (hasJxr) {
    return {
      message: "当前还没有检测到 JXR 解码器（JxrDecApp）。",
      detail: "安装 jxrlib 后，macOS 就可以直接转换 JXR / WDP / HDP。"
    };
  }

  return {
    message: "当前没有检测到缺失依赖。",
    detail: "应用已经具备当前平台的运行依赖。"
  };
}

async function chooseFfmpegExecutable(window) {
  const result = await dialog.showOpenDialog(window, {
    title: "选择 FFmpeg 可执行文件",
    properties: ["openFile"],
    buttonLabel: "使用这个 FFmpeg"
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  if (!(await validateFfmpegPath(filePath))) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "FFmpeg 路径无效",
      message: "你选择的文件不是可用的 FFmpeg 可执行文件。",
      detail: "请选择真正的 ffmpeg 或 ffmpeg.exe。"
    });
    return {
      canceled: false,
      ok: false,
      error: "invalid-ffmpeg-path"
    };
  }

  await setSavedFfmpegPath(filePath);
  await writeDebugLog(`Saved FFmpeg path override: ${filePath}`);
  return {
    canceled: false,
    ok: true,
    filePath
  };
}

async function showDependencyAssistant(window, { force = false, includeOptional = true } = {}) {
  if (dependencyPromptOpen) {
    return { action: "busy" };
  }

  const snapshot = await getDependencySnapshot();
  const missingDependencies = getMissingDependencies(snapshot, { includeOptional });

  if (!missingDependencies.length && !force) {
    return {
      action: "already-ready"
    };
  }

  dependencyPromptOpen = true;

  try {
    const isMac = process.platform === "darwin";
    const canAutoInstall = isMac && missingDependencies.length > 0;
    const canManualChooseFfmpeg = missingDependencies.includes("ffmpeg");
    const { message, detail } = getDependencyMessage(snapshot, missingDependencies);
    const buttons = [];

    if (canAutoInstall) {
      buttons.push(getMacInstallLabel(snapshot, missingDependencies));
    }

    if (canManualChooseFfmpeg) {
      buttons.push("手动选择 FFmpeg");
    }

    buttons.push("稍后再说");

    const result = await dialog.showMessageBox(window, {
      type: "warning",
      title: "缺少运行依赖",
      message,
      detail,
      buttons,
      cancelId: buttons.length - 1,
      defaultId: 0,
      noLink: true
    });

    const manualChoiceIndex = buttons.indexOf("手动选择 FFmpeg");
    const cancelIndex = buttons.length - 1;

    if (manualChoiceIndex >= 0 && result.response === manualChoiceIndex) {
      return chooseFfmpegExecutable(window);
    }

    if (result.response === cancelIndex) {
      return { action: "dismissed" };
    }

    if (isMac) {
      const command = buildMacInstallCommand(snapshot, missingDependencies);
      if (command) {
        await openTerminalWithCommand(command);
      }
      await dialog.showMessageBox(window, {
        type: "info",
        title: "安装流程已启动",
        message: "Terminal 已打开安装命令。",
        detail: "安装完成后回到应用，点击“重新检测”，或者重新打开应用即可。",
        buttons: ["知道了"]
      });
      return {
        action: "install-started"
      };
    }

    return { action: "unsupported-platform" };
  } finally {
    dependencyPromptOpen = false;
  }
}

async function createMainWindow() {
  nativeTheme.themeSource = "light";
  await loadDesktopSettings();
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
    showDependencyAssistant(window, { includeOptional: false }).catch((error) => {
      writeDebugLog(`Dependency assistant failed: ${error.message}`).catch(() => {});
    });
  });

  await window.loadFile(path.join(__dirname, "..", "public", "index.html"));
  await writeDebugLog("Loaded local renderer HTML.");
}

ipcMain.handle("desktop:get-meta", () => ({
  isDesktop: true,
  platform: process.platform,
  apiBase: serverHandle?.url || "",
  savedFfmpegPath: getSavedFfmpegPath(),
  dependencyAssistantAvailable: true
}));

ipcMain.handle("desktop:show-dependency-assistant", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return showDependencyAssistant(window, { force: true });
});

ipcMain.handle("desktop:choose-ffmpeg-path", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return chooseFfmpegExecutable(window);
});

ipcMain.handle("desktop:set-ffmpeg-path", async (_event, filePath) => {
  const normalizedPath = String(filePath || "").trim();

  if (!normalizedPath) {
    await setSavedFfmpegPath("");
    return {
      ok: true,
      cleared: true
    };
  }

  if (!(await validateFfmpegPath(normalizedPath))) {
    return {
      ok: false,
      error: "这个路径不是可用的 FFmpeg 可执行文件。"
    };
  }

  await setSavedFfmpegPath(normalizedPath);
  return {
    ok: true,
    filePath: normalizedPath
  };
});

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
