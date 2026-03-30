const http = require("http");
const fs = require("fs");
const path = require("path");
const { MIME_TYPES, convertMedia, getJxrSupportStatus, resolveFfmpegPath } = require("./media-core");

const PUBLIC_DIR = path.join(__dirname, "public");

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function writeCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function getFfmpegInstallHint() {
  if (process.platform === "darwin") {
    return "Install FFmpeg with Homebrew (`brew install ffmpeg`), add it to PATH, or place `ffmpeg` in the local `bin` folder.";
  }

  if (process.platform === "win32") {
    return "Install FFmpeg and add it to PATH, or place `ffmpeg.exe` in the local `bin` folder.";
  }

  return "Install FFmpeg, add it to PATH, or place `ffmpeg` in the local `bin` folder.";
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 300 * 1024 * 1024) {
        reject(new Error("Uploaded file is too large for this app."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requestPath));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      json(res, error.code === "ENOENT" ? 404 : 500, {
        error: error.code === "ENOENT" ? "Not found" : "Failed to load asset"
      });
      return;
    }

    const extension = path.extname(fullPath).toLowerCase();
    writeCorsHeaders(res);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    res.end(data);
  });
}

async function handleStatus(res) {
  const ffmpegPath = await resolveFfmpegPath();
  const jxrStatus = await getJxrSupportStatus();
  const missingDependencies = [];

  if (!ffmpegPath) {
    missingDependencies.push("ffmpeg");
  }

  if (!jxrStatus.supported) {
    missingDependencies.push("jxrlib");
  }

  json(res, 200, {
    ready: Boolean(ffmpegPath),
    ffmpegPath,
    hint: ffmpegPath ? "FFmpeg is available." : getFfmpegInstallHint(),
    platform: process.platform,
    supportsJxr: jxrStatus.supported,
    jxrHint: jxrStatus.hint,
    missingDependencies
  });
}

async function handleConvert(req, res) {
  const body = await parseBody(req);
  const { fileName, mimeType, fileData, action, targetFormat, compressionPreset, width, ffmpegPath } = body;

  if (!fileName || !fileData || !action || !targetFormat) {
    json(res, 400, { error: "Missing required fields." });
    return;
  }

  try {
    const result = await convertMedia({
      fileName,
      mimeType,
      fileBuffer: Buffer.from(String(fileData), "base64"),
      action,
      targetFormat,
      compressionPreset,
      width,
      ffmpegPath
    });

    res.writeHead(200, {
      "Content-Type": result.contentType,
      "Content-Length": result.outputBuffer.length,
      "Content-Disposition": `attachment; filename="${result.outputFileName}"`
    });
    res.end(result.outputBuffer);
  } catch (error) {
    json(res, 500, { error: error.message || "Conversion failed." });
  }
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        writeCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/api/status")) {
        await handleStatus(res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/convert") {
        await handleConvert(req, res);
        return;
      }

      if (req.method === "GET") {
        serveStatic(req, res);
        return;
      }

      json(res, 405, { error: "Method not allowed" });
    } catch (error) {
      json(res, 500, { error: error.message || "Internal server error" });
    }
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve(address);
    });
  });
}

async function startServer({ port = 3000, host = "127.0.0.1" } = {}) {
  const server = createAppServer();
  const address = await listen(server, port, host);
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    host,
    port: actualPort,
    server,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

module.exports = {
  createAppServer,
  startServer
};
