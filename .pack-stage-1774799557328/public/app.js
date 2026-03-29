const elements = {
  runtimeStatus: document.getElementById("runtime-status"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  selectedFile: document.getElementById("selected-file"),
  categoryTag: document.getElementById("category-tag"),
  fileSize: document.getElementById("file-size"),
  previewSurface: document.getElementById("preview-surface"),
  actionSelect: document.getElementById("action-select"),
  formatSelect: document.getElementById("format-select"),
  presetSelect: document.getElementById("preset-select"),
  widthInput: document.getElementById("width-input"),
  ffmpegPath: document.getElementById("ffmpeg-path"),
  desktopOpenButton: document.getElementById("desktop-open-button"),
  convertButton: document.getElementById("convert-button"),
  progressCard: document.getElementById("progress-card"),
  messageCard: document.getElementById("message-card")
};

const desktopBridge = window.desktopBridge || null;
let desktopMeta = null;

const optionMap = {
  video: {
    actions: [
      { value: "convert", label: "视频格式转换" },
      { value: "compress", label: "视频压缩" },
      { value: "extract-audio", label: "提取音频" }
    ],
    formats: {
      convert: ["mp4", "mov", "webm", "gif"],
      compress: ["mp4", "webm"],
      "extract-audio": ["mp3", "wav", "aac", "m4a", "ogg"]
    }
  },
  audio: {
    actions: [
      { value: "convert", label: "音频格式转换" },
      { value: "compress", label: "音频压缩" }
    ],
    formats: {
      convert: ["mp3", "wav", "aac", "m4a", "ogg", "flac"],
      compress: ["mp3", "aac", "m4a", "ogg"]
    }
  },
  image: {
    actions: [
      { value: "convert", label: "图片格式转换" },
      { value: "compress", label: "图片压缩" }
    ],
    formats: {
      convert: ["jpg", "png", "webp", "gif", "bmp", "tiff"],
      compress: ["jpg", "png", "webp", "gif", "bmp", "tiff"]
    }
  }
};

let selectedFile = null;

function getBaseName(fileName) {
  const parts = String(fileName || "output").split(".");
  if (parts.length <= 1) {
    return parts[0] || "output";
  }
  parts.pop();
  return parts.join(".") || "output";
}

function buildDownloadName(fileName, targetFormat, action) {
  const suffix = action === "compress" ? "-compressed" : action === "extract-audio" ? "-audio" : "-converted";
  return `${getBaseName(fileName)}${suffix}.${targetFormat}`;
}

function shouldUseAnimatedWebpFallback(file, targetFormat, errorMessage) {
  if (!file || !String(file.name).toLowerCase().endsWith(".webp") || targetFormat !== "gif") {
    return false;
  }

  return isAnimatedWebpDecodeError(errorMessage);
}

function isAnimatedWebpDecodeError(errorMessage) {
  return /ANIM|ANMF|unsupported chunk|webp_pipe|image data not found|Could not find codec parameters/i.test(
    String(errorMessage || "")
  );
}

function isJxrFile(file) {
  return /\.(jxr|wdp|hdp)$/i.test(String(file?.name || ""));
}

function getSupportedRecordingMimeType() {
  if (!window.MediaRecorder) {
    return "";
  }

  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

function sampleCanvasHash(context, width, height) {
  const sampleWidth = Math.max(1, Math.min(32, width));
  const sampleHeight = Math.max(1, Math.min(32, height));
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  let hash = 2166136261;

  for (let index = 0; index < data.length; index += 16) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 1];
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 2];
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 3];
    hash = Math.imul(hash, 16777619);
  }

  return `${hash >>> 0}`;
}

async function recordAnimatedWebpAsWebm(file, preferredWidth) {
  const recordingMimeType = getSupportedRecordingMimeType();
  if (!recordingMimeType) {
    throw new Error("当前浏览器不支持媒体录制回退，无法处理这个动画 WebP。");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("浏览器无法读取这个 WebP 文件。"));
      img.src = objectUrl;
    });

    const naturalWidth = image.naturalWidth || image.width || 720;
    const naturalHeight = image.naturalHeight || image.height || 720;
    const maxWidth = Number(preferredWidth) > 0 ? Math.min(Number(preferredWidth), naturalWidth) : Math.min(960, naturalWidth);
    const width = Math.max(1, Math.round(maxWidth));
    const height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width));
    const fps = 12;
    const maxDurationMs = 8000;
    const minLoopDurationMs = 900;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("浏览器无法初始化 WebP 回退画布。");
    }

    canvas.width = width;
    canvas.height = height;

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: recordingMimeType,
      videoBitsPerSecond: 4_000_000
    });
    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    return await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let firstHash = "";
      let previousHash = "";
      let changedFrames = 0;
      let frameCount = 0;
      let stopped = false;
      let timer = null;

      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        if (timer) {
          clearInterval(timer);
        }
        recorder.stop();
      };

      recorder.onerror = () => {
        if (timer) {
          clearInterval(timer);
        }
        stream.getTracks().forEach((track) => track.stop());
        reject(new Error("浏览器动画 WebP 回退录制失败。"));
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!chunks.length) {
          reject(new Error("动画 WebP 回退录制没有生成可用内容。"));
          return;
        }

        const blob = new Blob(chunks, { type: recordingMimeType });
        const fallbackFile = new File(
          [blob],
          `${getBaseName(file.name)}-animated-fallback.webm`,
          { type: "video/webm" }
        );
        resolve(fallbackFile);
      };

      recorder.start(200);

      const drawFrame = () => {
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        frameCount += 1;

        if (frameCount % 2 === 0) {
          const hash = sampleCanvasHash(context, width, height);
          if (!firstHash) {
            firstHash = hash;
          } else {
            if (hash !== previousHash) {
              changedFrames += 1;
            }

            const elapsed = performance.now() - startedAt;
            if (
              elapsed >= minLoopDurationMs &&
              changedFrames >= 3 &&
              hash === firstHash
            ) {
              stop();
              return;
            }
          }
          previousHash = hash;
        }

        if (performance.now() - startedAt >= maxDurationMs) {
          stop();
        }
      };

      drawFrame();
      timer = setInterval(drawFrame, Math.round(1000 / fps));
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function submitConversion(payload) {
  const response = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "转换失败。" }));
    throw new Error(error.error || "转换失败。");
  }

  return response;
}

function setMessage(title, text, isError = false) {
  elements.messageCard.innerHTML = `
    <strong>${title}</strong>
    <p style="color:${isError ? "#c4374b" : ""}">${text}</p>
  `;
}

function humanSize(size) {
  if (!size) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function inferCategory(file) {
  if (!file) return "unknown";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["mp4", "mov", "mkv", "avi", "webm", "m4v"].includes(extension)) return "video";
  if (["mp3", "wav", "aac", "m4a", "ogg", "flac"].includes(extension)) return "audio";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "jxr", "wdp", "hdp"].includes(extension)) return "image";
  return "unknown";
}

function buildPreview(file, category) {
  elements.previewSurface.innerHTML = "";
  const objectUrl = URL.createObjectURL(file);

  if (category === "image") {
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = file.name;
    elements.previewSurface.appendChild(image);
    return;
  }

  if (category === "video") {
    const video = document.createElement("video");
    video.src = objectUrl;
    video.controls = true;
    video.playsInline = true;
    elements.previewSurface.appendChild(video);
    return;
  }

  if (category === "audio") {
    const audio = document.createElement("audio");
    audio.src = objectUrl;
    audio.controls = true;
    elements.previewSurface.appendChild(audio);
    return;
  }

  elements.previewSurface.innerHTML = "<p>暂不支持该类型的预览。</p>";
}

function updateFormatOptions() {
  const category = inferCategory(selectedFile);
  const action = elements.actionSelect.value;
  const formats = optionMap[category]?.formats[action] || [];
  elements.formatSelect.innerHTML = "";
  formats.forEach((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format.toUpperCase();
    elements.formatSelect.appendChild(option);
  });
}

function updateActionOptions(category) {
  const config = optionMap[category];
  elements.actionSelect.innerHTML = "";
  elements.formatSelect.innerHTML = "";

  if (!config) {
    elements.convertButton.disabled = true;
    return;
  }

  config.actions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    elements.actionSelect.appendChild(option);
  });

  updateFormatOptions();
}

function applySmartDefaults(file, category) {
  if (!file || category !== "image") {
    return;
  }

  if (String(file.name).toLowerCase().endsWith(".webp")) {
    elements.actionSelect.value = "convert";
    updateFormatOptions();
    elements.formatSelect.value = "gif";
    return;
  }

  if (isJxrFile(file)) {
    elements.actionSelect.value = "convert";
    updateFormatOptions();
    elements.formatSelect.value = "png";
  }
}

function selectFile(file) {
  const category = inferCategory(file);
  selectedFile = file;
  elements.selectedFile.textContent = file.name;
  elements.categoryTag.textContent = category === "unknown" ? "未知类型" : category.toUpperCase();
  elements.fileSize.textContent = humanSize(file.size);
  buildPreview(file, category);
  updateActionOptions(category);
  applySmartDefaults(file, category);
  elements.convertButton.disabled = category === "unknown";

  if (category === "unknown") {
    setMessage("文件类型暂不支持", "请换成常见视频、音频或图片文件。", true);
    return;
  }

  let specialHint = "已加载文件，可以开始转换或压缩。";
  if (file.name.toLowerCase().endsWith(".webp")) {
    specialHint = "已识别为 WebP 图片，已为你默认切换到 GIF 输出。";
  } else if (isJxrFile(file)) {
    specialHint = "已识别为 JXR 图片，已为你默认切换到 PNG 输出。";
  }
  setMessage("文件已就绪", specialHint);
}

async function toBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToFile(base64Data, fileName, mimeType = "") {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType });
}

async function openFileFromDesktop() {
  if (!desktopBridge?.openFile) {
    elements.fileInput.click();
    return;
  }

  const result = await desktopBridge.openFile();
  if (result?.canceled || !result?.base64Data) {
    return;
  }

  const file = base64ToFile(result.base64Data, result.fileName, result.mimeType);
  selectFile(file);
}

async function loadDesktopMeta() {
  if (!desktopBridge?.getMeta) {
    return;
  }

  try {
    desktopMeta = await desktopBridge.getMeta();
  } catch (_error) {
    desktopMeta = null;
  }
}

async function refreshRuntimeStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (desktopMeta?.isDesktop) {
      elements.runtimeStatus.textContent = data.ready ? "桌面版 · FFmpeg 已就绪" : "桌面版 · 未检测到 FFmpeg";
    } else {
      elements.runtimeStatus.textContent = data.ready ? "FFmpeg 已就绪" : "未检测到 FFmpeg";
    }
    if (!data.ready) {
      setMessage("需要 FFmpeg", data.hint, true);
    }
  } catch (_error) {
    elements.runtimeStatus.textContent = "状态检测失败";
    setMessage("服务连接失败", "请确认本地服务已经启动。", true);
  }
}

async function saveOutput(blob, outputName) {
  if (desktopBridge?.saveFile) {
    const result = await desktopBridge.saveFile({
      suggestedName: outputName,
      base64Data: await blobToBase64(blob)
    });

    if (result?.canceled) {
      setMessage("已取消保存", "转换结果已经生成，但你取消了保存。");
      return false;
    }

    setMessage("转换完成", `文件已保存到：${result.filePath}`);
    return true;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = outputName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage("转换完成", `文件已生成并开始下载：${outputName}`);
  return true;
}

async function convertSelectedFile() {
  if (!selectedFile) return;

  elements.progressCard.classList.remove("hidden");
  elements.convertButton.disabled = true;
  setMessage("处理中", "正在调用本地 FFmpeg 执行转换。");

  try {
    let fileForUpload = selectedFile;
    let usedAnimatedWebpFallback = false;
    let payload = {
      fileName: selectedFile.name,
      mimeType: selectedFile.type,
      fileData: await toBase64(selectedFile),
      action: elements.actionSelect.value,
      targetFormat: elements.formatSelect.value,
      compressionPreset: elements.presetSelect.value,
      width: elements.widthInput.value,
      ffmpegPath: elements.ffmpegPath.value.trim()
    };

    let response;

    try {
      response = await submitConversion(payload);
    } catch (error) {
      if (shouldUseAnimatedWebpFallback(selectedFile, payload.targetFormat, error.message)) {
        setMessage("检测到动画 WebP", "FFmpeg 无法直接读取这个 WebP，正在使用浏览器回退重新转换。");

        fileForUpload = await recordAnimatedWebpAsWebm(selectedFile, elements.widthInput.value);
        usedAnimatedWebpFallback = true;
        payload = {
          ...payload,
          fileName: fileForUpload.name,
          mimeType: fileForUpload.type,
          fileData: await toBase64(fileForUpload),
          action: "convert",
          targetFormat: "gif",
          width: ""
        };
        response = await submitConversion(payload);
      } else if (
        String(selectedFile?.name || "").toLowerCase().endsWith(".webp") &&
        isAnimatedWebpDecodeError(error.message)
      ) {
        throw new Error("检测到动画 WebP。当前这个文件请把输出格式改成 GIF 后再试一次。");
      } else {
        throw error;
      }
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const nameMatch = disposition.match(/filename="([^"]+)"/i);
    const outputName =
      usedAnimatedWebpFallback
        ? buildDownloadName(selectedFile.name, elements.formatSelect.value, elements.actionSelect.value)
        : (nameMatch?.[1] || buildDownloadName(selectedFile.name, elements.formatSelect.value, elements.actionSelect.value));
    await saveOutput(blob, outputName);
  } catch (error) {
    setMessage("转换失败", error.message || "请检查 FFmpeg 路径与输入文件。", true);
  } finally {
    elements.progressCard.classList.add("hidden");
    elements.convertButton.disabled = inferCategory(selectedFile) === "unknown";
  }
}

elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("drag-over");
});
elements.dropzone.addEventListener("dragleave", () => {
  elements.dropzone.classList.remove("drag-over");
});
elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("drag-over");
  const [file] = event.dataTransfer.files;
  if (file) selectFile(file);
});
elements.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) selectFile(file);
});
elements.dropzone.addEventListener("click", (event) => {
  if (!desktopMeta?.isDesktop) {
    return;
  }

  event.preventDefault();
  openFileFromDesktop().catch((error) => {
    setMessage("打开文件失败", error.message || "请稍后再试。", true);
  });
});
elements.desktopOpenButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (desktopMeta?.isDesktop) {
    openFileFromDesktop().catch((error) => {
      setMessage("打开文件失败", error.message || "请稍后再试。", true);
    });
    return;
  }

  elements.fileInput.click();
});
elements.actionSelect.addEventListener("change", updateFormatOptions);
elements.convertButton.addEventListener("click", convertSelectedFile);

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  const [file] = event.dataTransfer?.files || [];
  if (file) {
    selectFile(file);
  }
});

loadDesktopMeta().finally(refreshRuntimeStatus);
