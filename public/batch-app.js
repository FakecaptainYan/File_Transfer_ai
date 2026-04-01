if (!window.__mediaConverterLabBooted) {
  window.__mediaConverterLabBooted = true;

  const elements = {
    runtimeStatus: document.getElementById("runtime-status"),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    selectedFile: document.getElementById("selected-file"),
    batchCount: document.getElementById("batch-count"),
    batchSummary: document.getElementById("batch-summary"),
    clearBatchButton: document.getElementById("clear-batch-button"),
    categoryTag: document.getElementById("category-tag"),
    fileSize: document.getElementById("file-size"),
    previewSurface: document.getElementById("preview-surface"),
    queueCaption: document.getElementById("queue-caption"),
    batchList: document.getElementById("batch-list"),
    actionSelect: document.getElementById("action-select"),
    formatSelect: document.getElementById("format-select"),
    presetSelect: document.getElementById("preset-select"),
    widthInput: document.getElementById("width-input"),
    ffmpegPath: document.getElementById("ffmpeg-path"),
    dependencyActions: document.getElementById("dependency-actions"),
    installDepsButton: document.getElementById("install-deps-button"),
    pickFfmpegButton: document.getElementById("pick-ffmpeg-button"),
    recheckStatusButton: document.getElementById("recheck-status-button"),
    jxrChip: document.getElementById("jxr-chip"),
    imageCapabilityCopy: document.getElementById("image-capability-copy"),
    desktopOpenButton: document.getElementById("desktop-open-button"),
    convertButton: document.getElementById("convert-button"),
    applyScope: document.getElementById("apply-scope"),
    progressCard: document.getElementById("progress-card"),
    progressTitle: document.getElementById("progress-title"),
    progressText: document.getElementById("progress-text"),
    messageCard: document.getElementById("message-card")
  };

  const desktopBridge = window.desktopBridge || null;
  const runtimeState = {
    platform: "",
    supportsJxr: true,
    ffmpegReady: false,
    jxrHint: "",
    missingDependencies: []
  };
  const batchState = {
    items: [],
    previewIndex: 0,
    isConverting: false
  };
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

  let desktopMeta = null;
  let apiBase = "";
  let activePreviewUrl = "";

  if (elements.runtimeStatus) {
    elements.runtimeStatus.textContent = "界面脚本已加载";
  }

  function renderMessageCard(title, text, isError = false) {
    if (!elements.messageCard) {
      return;
    }

    elements.messageCard.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    paragraph.style.color = isError ? "#c4374b" : "";
    elements.messageCard.append(strong, paragraph);
  }

  function setMessage(title, text, isError = false) {
    renderMessageCard(title, text, isError);
  }

  function setProgress(visible, title = "正在处理文件", text = "请稍候，转换完成后会自动保存或下载。") {
    elements.progressCard?.classList.toggle("hidden", !visible);
    if (elements.progressTitle) {
      elements.progressTitle.textContent = title;
    }
    if (elements.progressText) {
      elements.progressText.textContent = text;
    }
  }

  function showBootError(error) {
    const text = error?.message || String(error || "未知错误");
    if (elements.runtimeStatus) {
      elements.runtimeStatus.textContent = "界面脚本错误";
    }
    renderMessageCard("界面加载失败", text, true);
  }

  window.addEventListener("error", (event) => {
    showBootError(event.error || event.message);
  });

  function getCurrentPlatform() {
    return runtimeState.platform || desktopMeta?.platform || "";
  }

  function isJxrSupportedOnCurrentPlatform() {
    return runtimeState.supportsJxr !== false;
  }

  function getMissingDependencies() {
    return Array.isArray(runtimeState.missingDependencies) ? runtimeState.missingDependencies : [];
  }

  function isFfmpegMissing() {
    return getMissingDependencies().includes("ffmpeg");
  }

  function isJxrDecoderMissing() {
    return getMissingDependencies().includes("jxrlib");
  }

  function getSelectedCategory() {
    return batchState.items[0]?.category || "unknown";
  }

  function getSelectedFiles() {
    return batchState.items.map((item) => item.file);
  }

  function toggleDesktopClasses() {
    document.body.classList.toggle("desktop-shell", Boolean(desktopMeta?.isDesktop));
    document.body.classList.toggle("mac-desktop", getCurrentPlatform() === "darwin");
  }

  function syncQueueLayoutState() {
    document.body.classList.toggle("queue-has-files", batchState.items.length > 0);
  }

  function getFfmpegPlaceholder(platform) {
    if (platform === "darwin") {
      return "留空则使用 PATH、Homebrew 安装位置或本地 ./bin/ffmpeg";
    }

    if (platform === "win32") {
      return "留空则使用 PATH 或本地 ./bin/ffmpeg.exe";
    }

    return "留空则使用 PATH 或本地 ./bin/ffmpeg";
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

  function getInstallButtonLabel() {
    const platform = getCurrentPlatform();
    const hasFfmpeg = isFfmpegMissing();
    const hasJxr = isJxrDecoderMissing();

    if (platform === "darwin") {
      if (hasFfmpeg && hasJxr) return "一键安装 FFmpeg + JXR 支持";
      if (hasJxr) return "一键安装 JXR 支持";
      if (hasFfmpeg) return "一键安装 FFmpeg";
    }

    return "打开依赖向导";
  }

  function updateDependencyActions() {
    const shouldShow = Boolean(desktopMeta?.isDesktop) && getMissingDependencies().length > 0;
    elements.dependencyActions?.classList.toggle("hidden", !shouldShow);

    if (elements.installDepsButton) {
      elements.installDepsButton.textContent = getInstallButtonLabel();
    }

    elements.pickFfmpegButton?.classList.toggle("hidden", !isFfmpegMissing());
  }

  function applyPlatformCopy() {
    const platform = getCurrentPlatform();

    if (elements.ffmpegPath) {
      elements.ffmpegPath.placeholder = getFfmpegPlaceholder(platform);
    }

    if (elements.jxrChip) {
      elements.jxrChip.textContent = isJxrSupportedOnCurrentPlatform()
        ? "支持 JXR 输入"
        : (platform === "darwin" ? "JXR 需安装解码器" : "JXR 需先转 PNG/JPG");
    }

    if (elements.imageCapabilityCopy) {
      elements.imageCapabilityCopy.textContent = isJxrSupportedOnCurrentPlatform()
        ? "支持 jpg、png、webp、gif、bmp、tiff 常见互转，并支持 JXR 输入转换与 webp 转 gif。"
        : (
          platform === "darwin"
            ? "支持 jpg、png、webp、gif、bmp、tiff 常见互转与 webp 转 gif。安装 jxrlib 后，macOS 也可以直接导入 JXR / WDP / HDP。"
            : "支持 jpg、png、webp、gif、bmp、tiff 常见互转与 webp 转 gif。JXR / WDP / HDP 在当前系统需先转成 PNG 或 JPG。"
        );
    }

    toggleDesktopClasses();
  }

  function getJxrUnsupportedText() {
    if (runtimeState.jxrHint && !isJxrSupportedOnCurrentPlatform()) {
      return runtimeState.jxrHint;
    }

    if (getCurrentPlatform() === "darwin") {
      return "当前还没有检测到 JXR 解码器。安装 jxrlib 后，macOS 就可以直接处理 JXR / WDP / HDP。";
    }

    return "当前系统暂不支持直接解码 JXR / WDP / HDP。";
  }

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

  function getBatchCategoryLabel(category) {
    if (category === "video") return "视频";
    if (category === "audio") return "音频";
    if (category === "image") return "图片";
    return "未知";
  }

  function getQueueStatusLabel(status) {
    if (status === "processing") return "处理中";
    if (status === "success") return "已完成";
    if (status === "error") return "失败";
    return "待处理";
  }

  function revokeActivePreviewUrl() {
    if (activePreviewUrl) {
      URL.revokeObjectURL(activePreviewUrl);
      activePreviewUrl = "";
    }
  }

  function buildPreview(file, category) {
    revokeActivePreviewUrl();
    elements.previewSurface.innerHTML = "";

    if (!file) {
      elements.previewSurface.innerHTML = "<p>当前预览会显示在这里。批量模式下可点击下方队列切换预览文件。</p>";
      return;
    }

    if (isJxrFile(file)) {
      elements.previewSurface.innerHTML = "<p>JXR / WDP / HDP 预览依赖系统解码，当前界面不直接渲染预览。</p>";
      return;
    }

    activePreviewUrl = URL.createObjectURL(file);

    if (category === "image") {
      const image = document.createElement("img");
      image.src = activePreviewUrl;
      image.alt = file.name;
      elements.previewSurface.appendChild(image);
      return;
    }

    if (category === "video") {
      const video = document.createElement("video");
      video.src = activePreviewUrl;
      video.controls = true;
      video.playsInline = true;
      elements.previewSurface.appendChild(video);
      return;
    }

    if (category === "audio") {
      const audio = document.createElement("audio");
      audio.src = activePreviewUrl;
      audio.controls = true;
      elements.previewSurface.appendChild(audio);
      return;
    }

    elements.previewSurface.innerHTML = "<p>暂不支持该类型的预览。</p>";
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
          resolve(new File([blob], `${getBaseName(file.name)}-animated-fallback.webm`, { type: "video/webm" }));
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
              if (elapsed >= minLoopDurationMs && changedFrames >= 3 && hash === firstHash) {
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
    const response = await fetch(getApiUrl("/api/convert"), {
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

  function getApiUrl(resourcePath) {
    if (!apiBase) {
      return resourcePath;
    }

    return new URL(resourcePath, apiBase).toString();
  }

  function normalizeSelection(files) {
    const candidates = Array.from(files || []).map((file) => ({
      file,
      category: inferCategory(file)
    }));

    const firstUsable = candidates.find(({ file, category }) => (
      category !== "unknown" &&
      !(isJxrFile(file) && !isJxrSupportedOnCurrentPlatform())
    ));

    if (!firstUsable) {
      return {
        accepted: [],
        batchCategory: "unknown",
        skipped: candidates.map(({ file, category }) => ({
          name: file.name,
          reason: category === "unknown" ? "文件类型不受支持" : getJxrUnsupportedText()
        }))
      };
    }

    const accepted = [];
    const skipped = [];

    for (const { file, category } of candidates) {
      if (category === "unknown") {
        skipped.push({ name: file.name, reason: "文件类型不受支持" });
        continue;
      }

      if (category !== firstUsable.category) {
        skipped.push({ name: file.name, reason: "批量队列一次只支持同一媒体类型" });
        continue;
      }

      if (isJxrFile(file) && !isJxrSupportedOnCurrentPlatform()) {
        skipped.push({ name: file.name, reason: getJxrUnsupportedText() });
        continue;
      }

      accepted.push(file);
    }

    return {
      accepted,
      batchCategory: firstUsable.category,
      skipped
    };
  }

  function createBatchItems(files, category) {
    const timestamp = Date.now();
    return files.map((file, index) => ({
      id: `${timestamp}-${index}-${file.name}-${file.size}`,
      file,
      category,
      status: "ready",
      detail: "等待处理"
    }));
  }

  function updateFormatOptions() {
    const category = getSelectedCategory();
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
      syncConvertButton();
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

  function applySmartDefaults(files, category) {
    if (!files.length || category !== "image") {
      return;
    }

    const allWebp = files.every((file) => String(file.name).toLowerCase().endsWith(".webp"));
    const allJxr = files.every((file) => isJxrFile(file));

    if (allWebp) {
      elements.actionSelect.value = "convert";
      updateFormatOptions();
      elements.formatSelect.value = "gif";
      return;
    }

    if (allJxr && isJxrSupportedOnCurrentPlatform()) {
      elements.actionSelect.value = "convert";
      updateFormatOptions();
      elements.formatSelect.value = "png";
    }
  }

  function renderQueueList() {
    if (!elements.batchList) {
      return;
    }

    elements.batchList.replaceChildren();

    if (!batchState.items.length) {
      const empty = document.createElement("div");
      empty.className = "queue-empty";
      empty.textContent = "还没有文件进入批量队列。";
      elements.batchList.appendChild(empty);
      return;
    }

    batchState.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `queue-item status-${item.status}${index === batchState.previewIndex ? " active" : ""}`;

      const indexBadge = document.createElement("div");
      indexBadge.className = "queue-index";
      indexBadge.textContent = `${index + 1}`;

      const content = document.createElement("div");
      content.className = "queue-content";

      const title = document.createElement("strong");
      title.textContent = item.file.name;

      const detail = document.createElement("p");
      detail.textContent = item.detail || `${getBatchCategoryLabel(item.category)} · ${humanSize(item.file.size)}`;

      const status = document.createElement("div");
      status.className = "queue-status";
      status.textContent = getQueueStatusLabel(item.status);

      content.append(title, detail);
      button.append(indexBadge, content, status);
      button.addEventListener("click", () => {
        batchState.previewIndex = index;
        renderBatchState();
      });
      elements.batchList.appendChild(button);
    });
  }

  function renderBatchSummary() {
    const files = getSelectedFiles();
    const count = files.length;
    const category = getSelectedCategory();
    const label = getBatchCategoryLabel(category);
    const currentItem = batchState.items[batchState.previewIndex];

    syncQueueLayoutState();

    elements.batchCount.textContent = count ? `${count} 个文件` : "0 个文件";
    elements.clearBatchButton?.classList.toggle("hidden", count === 0);

    if (!count) {
      elements.batchSummary.textContent = "未选择文件。单次批量会共用同一组转换设置。";
      elements.selectedFile.textContent = "尚未选择文件";
      elements.categoryTag.textContent = "等待文件";
      elements.fileSize.textContent = "0 MB";
      elements.queueCaption.textContent = "最多建议一次处理同类型文件，批量体验会更顺手。";
      elements.applyScope.textContent = "当前设置会应用到本批次所有文件。";
      buildPreview(null, "unknown");
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const previewLabel = currentItem ? `${currentItem.file.name} · ${batchState.previewIndex + 1}/${count}` : `${count} 个文件`;

    elements.batchSummary.textContent = `当前批次为${label}文件，所有项目会使用同一套转换参数。`;
    elements.selectedFile.textContent = previewLabel;
    elements.categoryTag.textContent = count > 1 ? `${label.toUpperCase()} BATCH` : label.toUpperCase();
    elements.fileSize.textContent = currentItem ? humanSize(currentItem.file.size) : humanSize(totalSize);
    elements.queueCaption.textContent = count > 1
      ? `已载入 ${count} 个${label}文件。点击队列项可切换预览。`
      : `已载入 1 个${label}文件。`;
    elements.applyScope.textContent = count > 1
      ? `当前设置会连续应用到这 ${count} 个文件。`
      : "当前设置会应用到这个文件。";

    buildPreview(currentItem?.file || null, category);
  }

  function syncConvertButton() {
    const hasBatch = batchState.items.length > 0;
    const category = getSelectedCategory();
    const hasConfig = Boolean(optionMap[category]);
    const label = batchState.isConverting
      ? (batchState.items.length > 1 ? "正在批量转换..." : "正在转换...")
      : (batchState.items.length > 1 ? "开始批量转换" : "开始转换");

    if (elements.convertButton) {
      elements.convertButton.textContent = label;
      elements.convertButton.disabled = !hasBatch || !hasConfig || batchState.isConverting;
    }
  }

  function renderBatchState() {
    if (batchState.previewIndex >= batchState.items.length) {
      batchState.previewIndex = Math.max(0, batchState.items.length - 1);
    }

    renderBatchSummary();
    renderQueueList();
    syncConvertButton();
  }

  function applySelection(files) {
    const { accepted, batchCategory, skipped } = normalizeSelection(files);

    if (!accepted.length) {
      setMessage("没有可处理的文件", "请改选常见视频、音频或图片文件，并确保同一批次为同一媒体类型。", true);
      return;
    }

    batchState.items = createBatchItems(accepted, batchCategory);
    batchState.previewIndex = 0;

    updateActionOptions(batchCategory);
    applySmartDefaults(accepted, batchCategory);
    renderBatchState();

    if (skipped.length) {
      const previewSkipped = skipped.slice(0, 3).map((item) => `${item.name}：${item.reason}`).join("；");
      const suffix = skipped.length > 3 ? ` 等 ${skipped.length} 个文件已跳过。` : "。";
      setMessage("批量队列已更新", `${accepted.length} 个文件已加入队列，${previewSkipped}${suffix}`);
      return;
    }

    if (accepted.length > 1) {
      setMessage("批量文件已就绪", `已载入 ${accepted.length} 个${getBatchCategoryLabel(batchCategory)}文件，可以直接开始批量转换。`);
    } else if (accepted[0].name.toLowerCase().endsWith(".webp")) {
      setMessage("文件已就绪", "已识别为 WebP 图片，默认输出已切换为 GIF。");
    } else if (isJxrFile(accepted[0])) {
      setMessage("文件已就绪", "已识别为 JXR 图片，默认输出已切换为 PNG。");
    } else {
      setMessage("文件已就绪", "当前文件已载入，可以开始转换或压缩。");
    }
  }

  function clearBatchSelection() {
    batchState.items = [];
    batchState.previewIndex = 0;
    if (elements.fileInput) {
      elements.fileInput.value = "";
    }
    updateActionOptions("unknown");
    renderBatchState();
    setMessage("批量队列已清空", "可以重新拖入文件或点击选择文件。");
  }

  async function toBase64(file) {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
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

  async function openFilesFromDesktop() {
    if (desktopBridge?.openFiles) {
      const result = await desktopBridge.openFiles();
      if (result?.canceled || !Array.isArray(result.files) || !result.files.length) {
        return [];
      }

      return result.files.map((entry) => base64ToFile(entry.base64Data, entry.fileName, entry.mimeType));
    }

    if (desktopBridge?.openFile) {
      const result = await desktopBridge.openFile();
      if (result?.canceled || !result?.base64Data) {
        return [];
      }

      return [base64ToFile(result.base64Data, result.fileName, result.mimeType)];
    }

    elements.fileInput?.click();
    return [];
  }

  async function loadDesktopMeta() {
    if (!desktopBridge?.getMeta) {
      toggleDesktopClasses();
      return;
    }

    try {
      desktopMeta = await desktopBridge.getMeta();
      apiBase = desktopMeta?.apiBase || "";
      runtimeState.platform = desktopMeta?.platform || runtimeState.platform;
      if (elements.ffmpegPath && desktopMeta?.savedFfmpegPath) {
        elements.ffmpegPath.value = desktopMeta.savedFfmpegPath;
      }
      applyPlatformCopy();
      updateDependencyActions();
    } catch (_error) {
      desktopMeta = null;
      apiBase = "";
      toggleDesktopClasses();
    }
  }

  async function refreshRuntimeStatus() {
    try {
      const response = await fetch(getApiUrl("/api/status"));
      const data = await response.json();
      runtimeState.platform = data.platform || runtimeState.platform;
      runtimeState.supportsJxr = data.supportsJxr !== false;
      runtimeState.ffmpegReady = Boolean(data.ready);
      runtimeState.jxrHint = data.jxrHint || "";
      runtimeState.missingDependencies = Array.isArray(data.missingDependencies) ? data.missingDependencies : [];
      applyPlatformCopy();
      updateDependencyActions();

      const hasFfmpeg = isFfmpegMissing();
      const hasJxr = isJxrDecoderMissing();

      if (desktopMeta?.isDesktop) {
        if (!hasFfmpeg && !hasJxr) {
          elements.runtimeStatus.textContent = "桌面版 · 依赖已就绪";
        } else if (hasFfmpeg && hasJxr) {
          elements.runtimeStatus.textContent = "桌面版 · 缺少 FFmpeg 和 JXR 解码器";
        } else if (hasFfmpeg) {
          elements.runtimeStatus.textContent = "桌面版 · 未检测到 FFmpeg";
        } else {
          elements.runtimeStatus.textContent = "桌面版 · JXR 支持未启用";
        }
      } else if (!hasFfmpeg && !hasJxr) {
        elements.runtimeStatus.textContent = "依赖已就绪";
      } else if (hasFfmpeg && hasJxr) {
        elements.runtimeStatus.textContent = "缺少 FFmpeg 和 JXR 解码器";
      } else if (hasFfmpeg) {
        elements.runtimeStatus.textContent = "未检测到 FFmpeg";
      } else {
        elements.runtimeStatus.textContent = "JXR 支持未启用";
      }

      if (hasFfmpeg) {
        const detailParts = [data.hint];
        if (hasJxr && data.jxrHint) {
          detailParts.push(data.jxrHint);
        }

        const detail = desktopMeta?.isDesktop
          ? `${detailParts.join(" ")} 你也可以点击下方按钮一键安装，或手动选择本机的 FFmpeg。`
          : detailParts.join(" ");
        setMessage("需要依赖", detail, true);
      } else if (hasJxr) {
        const detail = desktopMeta?.isDesktop
          ? `${data.jxrHint} 你可以点击下方按钮一键安装 JXR 支持。`
          : data.jxrHint;
        setMessage("JXR 支持可启用", detail);
      }
    } catch (_error) {
      elements.runtimeStatus.textContent = "状态检测失败";
      runtimeState.ffmpegReady = false;
      runtimeState.supportsJxr = false;
      runtimeState.missingDependencies = ["ffmpeg"];
      updateDependencyActions();
      setMessage("服务连接失败", "请确认本地服务已经启动。", true);
    }
  }

  async function openDependencyAssistant() {
    if (!desktopBridge?.showDependencyAssistant) {
      return;
    }

    await desktopBridge.showDependencyAssistant();
  }

  async function chooseDesktopFfmpegPath() {
    if (!desktopBridge?.chooseFfmpegPath) {
      return;
    }

    const result = await desktopBridge.chooseFfmpegPath();
    if (result?.ok && result.filePath && elements.ffmpegPath) {
      elements.ffmpegPath.value = result.filePath;
    }
    await refreshRuntimeStatus();
  }

  async function persistDesktopFfmpegPath() {
    if (!desktopMeta?.isDesktop || !desktopBridge?.setFfmpegPath || !elements.ffmpegPath) {
      return;
    }

    const value = elements.ffmpegPath.value.trim();
    const result = await desktopBridge.setFfmpegPath(value);

    if (!result?.ok) {
      setMessage("FFmpeg 路径无效", result?.error || "请重新选择可用的 FFmpeg。", true);
      return;
    }

    await refreshRuntimeStatus();
  }

  async function saveOutput(blob, outputName) {
    if (desktopBridge?.saveFile) {
      const result = await desktopBridge.saveFile({
        suggestedName: outputName,
        base64Data: await blobToBase64(blob)
      });

      if (result?.canceled) {
        return { saved: false, canceled: true };
      }

      return { saved: true, filePath: result.filePath };
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { saved: true, filePath: outputName };
  }

  async function saveOutputToDirectory(blob, directoryPath, outputName) {
    if (!desktopBridge?.saveFileToDirectory) {
      return saveOutput(blob, outputName);
    }

    const result = await desktopBridge.saveFileToDirectory({
      directoryPath,
      fileName: outputName,
      base64Data: await blobToBase64(blob)
    });

    if (!result?.ok) {
      throw new Error(result?.error || "无法把结果保存到选定文件夹。");
    }

    return { saved: true, filePath: result.filePath };
  }

  async function requestOutputTarget() {
    if (!desktopMeta?.isDesktop || batchState.items.length <= 1 || !desktopBridge?.pickOutputDirectory) {
      return { mode: "interactive" };
    }

    const result = await desktopBridge.pickOutputDirectory();
    if (result?.canceled || !result?.directoryPath) {
      return null;
    }

    return { mode: "directory", directoryPath: result.directoryPath };
  }

  async function convertSingleFile(file) {
    let fileForUpload = file;
    let usedAnimatedWebpFallback = false;
    let payload = {
      fileName: file.name,
      mimeType: file.type,
      fileData: await toBase64(file),
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
      if (shouldUseAnimatedWebpFallback(file, payload.targetFormat, error.message)) {
        fileForUpload = await recordAnimatedWebpAsWebm(file, elements.widthInput.value);
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
      } else if (String(file?.name || "").toLowerCase().endsWith(".webp") && isAnimatedWebpDecodeError(error.message)) {
        throw new Error("检测到动画 WebP。当前这个文件请把输出格式改成 GIF 后再试一次。");
      } else {
        throw error;
      }
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const nameMatch = disposition.match(/filename=\"([^\"]+)\"/i);
    const outputName = usedAnimatedWebpFallback
      ? buildDownloadName(file.name, elements.formatSelect.value, elements.actionSelect.value)
      : (nameMatch?.[1] || buildDownloadName(file.name, elements.formatSelect.value, elements.actionSelect.value));

    return { blob, outputName };
  }

  function updateItemStatus(index, status, detail) {
    if (!batchState.items[index]) {
      return;
    }

    batchState.items[index] = {
      ...batchState.items[index],
      status,
      detail
    };
    renderQueueList();
  }

  async function convertBatch() {
    if (!batchState.items.length || batchState.isConverting) {
      return;
    }

    if (getSelectedCategory() === "unknown") {
      setMessage("批量队列不可用", "请先选择可处理的媒体文件。", true);
      return;
    }

    const outputTarget = await requestOutputTarget();
    if (!outputTarget) {
      setMessage("已取消批量转换", "你取消了输出文件夹选择，本次批量转换未开始。");
      return;
    }

    batchState.isConverting = true;
    batchState.items = batchState.items.map((item) => ({
      ...item,
      status: "ready",
      detail: "等待处理"
    }));
    renderBatchState();

    if (!desktopMeta?.isDesktop && batchState.items.length > 1) {
      setMessage("开始批量转换", "浏览器可能会询问是否允许连续下载多个文件。");
    } else {
      setMessage("开始处理", "正在调用本地 FFmpeg 连续处理当前批次。");
    }

    let successCount = 0;
    let failedCount = 0;
    let canceledCount = 0;
    let lastSavedPath = "";

    try {
      for (let index = 0; index < batchState.items.length; index += 1) {
        const item = batchState.items[index];
        const total = batchState.items.length;

        batchState.previewIndex = index;
        updateItemStatus(index, "processing", `正在处理 ${index + 1} / ${total}`);
        renderBatchSummary();
        setProgress(true, `正在处理 ${index + 1} / ${total}`, item.file.name);

        try {
          const result = await convertSingleFile(item.file);
          const saveResult = outputTarget.mode === "directory"
            ? await saveOutputToDirectory(result.blob, outputTarget.directoryPath, result.outputName)
            : await saveOutput(result.blob, result.outputName);

          if (!saveResult.saved && saveResult.canceled) {
            canceledCount += 1;
            updateItemStatus(index, "error", "用户取消了保存");
            continue;
          }

          successCount += 1;
          lastSavedPath = saveResult.filePath || lastSavedPath;
          updateItemStatus(index, "success", saveResult.filePath || result.outputName);
        } catch (error) {
          failedCount += 1;
          updateItemStatus(index, "error", error.message || "转换失败");
        }
      }
    } finally {
      batchState.isConverting = false;
      setProgress(false);
      renderBatchState();
    }

    if (successCount && !failedCount && !canceledCount) {
      const detail = outputTarget.mode === "directory"
        ? `本批次 ${successCount} 个文件已保存到：${outputTarget.directoryPath}`
        : `本批次 ${successCount} 个文件已全部完成。${lastSavedPath ? `最后一个输出：${lastSavedPath}` : ""}`;
      setMessage("批量转换完成", detail);
      return;
    }

    setMessage(
      "批量转换已结束",
      `成功 ${successCount} 个，失败 ${failedCount} 个，取消保存 ${canceledCount} 个。请查看下方队列了解每个文件的结果。`,
      failedCount > 0
    );
  }

  elements.dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("drag-over");
  });

  elements.dropzone?.addEventListener("dragleave", () => {
    elements.dropzone.classList.remove("drag-over");
  });

  elements.dropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("drag-over");
    if (event.dataTransfer?.files?.length) {
      applySelection(event.dataTransfer.files);
    }
  });

  elements.fileInput?.addEventListener("change", (event) => {
    if (event.target.files?.length) {
      applySelection(event.target.files);
    }
  });

  elements.dropzone?.addEventListener("click", (event) => {
    if (!desktopMeta?.isDesktop) {
      return;
    }

    event.preventDefault();
    openFilesFromDesktop()
      .then((files) => {
        if (files.length) {
          applySelection(files);
        }
      })
      .catch((error) => {
        setMessage("打开文件失败", error.message || "请稍后再试。", true);
      });
  });

  elements.desktopOpenButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (desktopMeta?.isDesktop) {
      openFilesFromDesktop()
        .then((files) => {
          if (files.length) {
            applySelection(files);
          }
        })
        .catch((error) => {
          setMessage("打开文件失败", error.message || "请稍后再试。", true);
        });
      return;
    }

    elements.fileInput?.click();
  });

  elements.clearBatchButton?.addEventListener("click", clearBatchSelection);
  elements.actionSelect?.addEventListener("change", updateFormatOptions);
  elements.convertButton?.addEventListener("click", convertBatch);
  elements.installDepsButton?.addEventListener("click", () => {
    openDependencyAssistant().catch((error) => {
      setMessage("无法打开依赖向导", error.message || "请稍后再试。", true);
    });
  });
  elements.pickFfmpegButton?.addEventListener("click", () => {
    chooseDesktopFfmpegPath().catch((error) => {
      setMessage("选择 FFmpeg 失败", error.message || "请稍后再试。", true);
    });
  });
  elements.recheckStatusButton?.addEventListener("click", () => {
    refreshRuntimeStatus().catch(() => {});
  });
  elements.ffmpegPath?.addEventListener("change", () => {
    persistDesktopFfmpegPath().catch((error) => {
      setMessage("保存 FFmpeg 路径失败", error.message || "请稍后再试。", true);
    });
  });

  window.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      applySelection(event.dataTransfer.files);
    }
  });

  applyPlatformCopy();
  renderBatchState();
  loadDesktopMeta().finally(refreshRuntimeStatus);
}
