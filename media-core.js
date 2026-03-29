const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const JXR_EXTENSIONS = new Set([".jxr", ".wdp", ".hdp"]);

const MIME_TYPES = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".jxr": "image/vnd.ms-photo",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
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

function sanitizeFileName(name) {
  return String(name || "output")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "output";
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const logs = [];
    let settled = false;
    const child = spawn(command, args, {
      windowsHide: true,
      ...options
    });

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const succeed = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    child.stdout?.on("data", (chunk) => logs.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk) => logs.push(chunk.toString("utf8")));
    child.once("error", fail);
    child.once("exit", (code) => {
      if (code === 0) {
        succeed(logs.join("\n"));
      } else {
        fail(new Error(logs.join("\n") || `${command} exited with code ${code}`));
      }
    });
  });
}

async function canExecute(filePath) {
  try {
    await runProcess(filePath, ["-version"]);
    return true;
  } catch (_error) {
    return false;
  }
}

function getLocalFfmpegCandidates() {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bin", exe));
  }

  if (process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), "bin", exe));
  }

  candidates.push(path.join(__dirname, "bin", exe));
  return uniq(candidates);
}

async function findInWindowsPath(commandName) {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const output = await runProcess("where.exe", [commandName], { stdio: ["ignore", "pipe", "pipe"] });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch (_error) {
    return null;
  }
}

async function findWingetFfmpegPath() {
  if (process.platform !== "win32") {
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const linksPath = path.join(localAppData, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  try {
    await fsp.access(linksPath);
    return linksPath;
  } catch (_error) {
  }

  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    const packageDirs = await fsp.readdir(packagesRoot, { withFileTypes: true });
    const ffmpegPackageDir = packageDirs.find(
      (entry) => entry.isDirectory() && entry.name.startsWith("Gyan.FFmpeg_")
    );

    if (!ffmpegPackageDir) {
      return null;
    }

    const packagePath = path.join(packagesRoot, ffmpegPackageDir.name);
    const children = await fsp.readdir(packagePath, { withFileTypes: true });

    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }

      const candidate = path.join(packagePath, child.name, "bin", "ffmpeg.exe");
      try {
        await fsp.access(candidate);
        return candidate;
      } catch (_error) {
      }
    }
  } catch (_error) {
  }

  return null;
}

async function collectFfmpegCandidates(overridePath) {
  const candidates = [
    overridePath,
    process.env.FFMPEG_PATH,
    ...getLocalFfmpegCandidates()
  ];

  if (process.platform === "win32") {
    candidates.push(await findInWindowsPath("ffmpeg.exe"));
    candidates.push(await findWingetFfmpegPath());
    candidates.push("ffmpeg.exe");
  } else {
    candidates.push(await findInWindowsPath("ffmpeg"));
    candidates.push("ffmpeg");
  }

  return uniq(candidates);
}

async function resolveFfmpegPath(overridePath) {
  const candidates = await collectFfmpegCandidates(overridePath);

  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isJxrFileName(fileName) {
  return JXR_EXTENSIONS.has(path.extname(fileName || "").toLowerCase());
}

function inferCategory(mimeType, fileName) {
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "image/vnd.ms-photo") return "image";

  const extension = path.extname(fileName || "").toLowerCase();
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"].includes(extension)) return "video";
  if ([".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"].includes(extension)) return "audio";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".jxr", ".wdp", ".hdp"].includes(extension)) return "image";
  return "unknown";
}

function buildOutputName(fileName, targetFormat, action) {
  const parsed = path.parse(fileName || "output");
  const base = sanitizeFileName(parsed.name || "output");
  const suffix = action === "compress" ? "-compressed" : action === "extract-audio" ? "-audio" : "-converted";
  return `${base}${suffix}.${targetFormat}`;
}

function buildArgs({ inputPath, outputPath, action, category, targetFormat, compressionPreset, width }) {
  const args = ["-y"];
  let deferredFilterComplex = null;

  if (action === "extract-audio") {
    args.push("-i", inputPath, "-vn");
  }

  if (category === "video") {
    if (action !== "extract-audio") {
      args.push("-i", inputPath);
    }

    if (targetFormat === "mp4") {
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k");
    } else if (targetFormat === "webm") {
      args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", compressionPreset === "heavy" ? "38" : compressionPreset === "balanced" ? "32" : "26", "-c:a", "libopus", "-b:a", "160k");
    } else if (targetFormat === "mov") {
      args.push("-c:v", "libx264", "-c:a", "aac");
    } else if (targetFormat === "gif") {
      const scale = width ? `scale=${width}:-1:flags=lanczos` : "scale=960:-1:flags=lanczos";
      deferredFilterComplex = `[0:v] fps=12,${scale},split [a][b];[a] palettegen=stats_mode=full [p];[b][p] paletteuse=dither=bayer`;
    } else {
      args.push("-c:v", "libx264", "-c:a", "aac");
    }

    if (action === "compress" && targetFormat !== "gif") {
      args.push("-crf", compressionPreset === "heavy" ? "34" : compressionPreset === "balanced" ? "28" : "22");
      args.push("-preset", compressionPreset === "heavy" ? "slow" : "medium");
    }

    if (width && targetFormat !== "gif") {
      args.push("-vf", `scale='min(${width},iw)':-2`);
    }
  }

  if (category === "audio" || action === "extract-audio") {
    if (category === "audio") {
      args.push("-i", inputPath);
    }

    if (targetFormat === "mp3") args.push("-c:a", "libmp3lame", "-b:a", compressionPreset === "heavy" ? "128k" : compressionPreset === "balanced" ? "192k" : "256k");
    if (targetFormat === "aac" || targetFormat === "m4a") args.push("-c:a", "aac", "-b:a", compressionPreset === "heavy" ? "128k" : compressionPreset === "balanced" ? "192k" : "256k");
    if (targetFormat === "ogg") args.push("-c:a", "libopus", "-b:a", compressionPreset === "heavy" ? "96k" : compressionPreset === "balanced" ? "160k" : "224k");
    if (targetFormat === "wav") args.push("-c:a", "pcm_s16le");
    if (targetFormat === "flac") args.push("-c:a", "flac");
  }

  if (category === "image") {
    args.push("-i", inputPath);

    if (targetFormat === "jpg" || targetFormat === "jpeg") {
      args.push("-q:v", compressionPreset === "heavy" ? "18" : compressionPreset === "balanced" ? "10" : "4");
    }

    if (targetFormat === "webp") {
      args.push("-compression_level", compressionPreset === "heavy" ? "6" : compressionPreset === "balanced" ? "4" : "2");
      args.push("-q:v", compressionPreset === "heavy" ? "55" : compressionPreset === "balanced" ? "72" : "88");
    }

    if (targetFormat === "gif") {
      const scale = width ? `scale=${width}:-1:flags=lanczos` : "scale=720:-1:flags=lanczos";
      deferredFilterComplex = `[0:v] fps=12,${scale},split [a][b];[a] palettegen=stats_mode=full [p];[b][p] paletteuse=dither=bayer`;
    } else if (width) {
      args.push("-vf", `scale='min(${width},iw)':-2`);
    }
  }

  if (deferredFilterComplex) {
    args.push("-filter_complex", deferredFilterComplex);
  }

  args.push(outputPath);
  return args;
}

async function decodeJxrToPng(inputPath, outputPath) {
  if (process.platform !== "win32") {
    throw new Error("JXR input is currently supported on Windows only.");
  }

  const scriptPath = path.join(path.dirname(outputPath), "decode-jxr.ps1");
  const script = [
    "param(",
    "  [string]$inputPath,",
    "  [string]$outputPath",
    ")",
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName PresentationCore",
    "$inputStream = [System.IO.File]::OpenRead($inputPath)",
    "try {",
    "  $decoder = New-Object System.Windows.Media.Imaging.WmpBitmapDecoder($inputStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)",
    "  if (-not $decoder.Frames -or $decoder.Frames.Count -lt 1) {",
    "    throw 'No decodable frame was found in the JXR file.'",
    "  }",
    "  $frame = $decoder.Frames[0]",
    "  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder",
    "  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame))",
    "  $outputStream = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)",
    "  try {",
    "    $encoder.Save($outputStream)",
    "  } finally {",
    "    $outputStream.Dispose()",
    "  }",
    "} finally {",
    "  $inputStream.Dispose()",
    "}",
    "if (-not (Test-Path -LiteralPath $outputPath)) {",
    "  throw \"Decoded PNG was not created: $outputPath\"",
    "}"
  ].join("\r\n");

  await fsp.writeFile(scriptPath, script, "utf8");

  try {
    await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      inputPath,
      outputPath
    ]);
  } finally {
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }

  await fsp.access(outputPath).catch(() => {
    throw new Error(`Decoded JXR output was not created: ${outputPath}`);
  });
}

async function convertMedia({
  fileName,
  mimeType,
  fileBuffer,
  action,
  targetFormat,
  compressionPreset = "balanced",
  width,
  ffmpegPath: overridePath
}) {
  if (!fileName || !fileBuffer || !action || !targetFormat) {
    throw new Error("Missing required conversion fields.");
  }

  const category = inferCategory(mimeType, fileName);
  if (category === "unknown") {
    throw new Error("Unsupported input type.");
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "apple-media-converter-"));
  const inputExtension = path.extname(fileName) || "";
  const safeInputName = sanitizeFileName(path.basename(fileName, inputExtension)) + inputExtension;
  const normalizedTargetFormat = String(targetFormat).toLowerCase();
  const safeOutputName = buildOutputName(fileName, normalizedTargetFormat, action);
  const inputPath = path.join(tempDir, safeInputName);
  const outputPath = path.join(tempDir, safeOutputName);

  try {
    await fsp.writeFile(inputPath, fileBuffer);

    let workingInputPath = inputPath;

    if (isJxrFileName(fileName)) {
      const decodedPngPath = path.join(tempDir, `${sanitizeFileName(path.basename(fileName, inputExtension))}-decoded.png`);
      await decodeJxrToPng(inputPath, decodedPngPath);
      await fsp.access(decodedPngPath).catch(() => {
        throw new Error(`JXR decode failed to create the intermediate PNG: ${decodedPngPath}`);
      });
      workingInputPath = decodedPngPath;
    }

    const ffmpegPath = await resolveFfmpegPath(overridePath);
    if (!ffmpegPath) {
      throw new Error("FFmpeg was not found. Install it and add it to PATH, or place ffmpeg.exe in the local bin folder.");
    }

    const args = buildArgs({
      inputPath: workingInputPath,
      outputPath,
      action,
      category,
      targetFormat: normalizedTargetFormat,
      compressionPreset,
      width: Number(width) || 0
    });

    const executionLog = await runProcess(ffmpegPath, args);
    const outputBuffer = await fsp.readFile(outputPath);
    const extension = path.extname(outputPath).toLowerCase();

    return {
      outputBuffer,
      outputFileName: path.basename(outputPath),
      contentType: MIME_TYPES[extension] || "application/octet-stream",
      ffmpegPath,
      executionLog
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  MIME_TYPES,
  buildOutputName,
  convertMedia,
  inferCategory,
  isJxrFileName,
  resolveFfmpegPath
};
