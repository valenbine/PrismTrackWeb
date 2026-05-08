const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const isDev = !app.isPackaged;
const appRoot = isDev ? path.resolve(__dirname, "..") : process.resourcesPath;
const entryUrl = process.env.PRISMTRACK_DESKTOP_URL || "http://127.0.0.1:8000/";
const serverPort = Number(new URL(entryUrl).port || 8000);
const localRuntimeRoot = appRoot;
const localPythonPath = path.join(localRuntimeRoot, "python", "python.exe");
const localFfmpegPath = path.join(localRuntimeRoot, "ffmpeg.exe");
const localFfprobePath = path.join(localRuntimeRoot, "ffprobe.exe");
const localWrapperPath = path.join(localRuntimeRoot, "scripts", "spleeter_separate.py");

let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;
let serverStderrBuffer = "";

function resolveNodeCommand() {
  return process.execPath;
}

function buildServerEnv() {
  return {
    ...process.env,
    PORT: String(serverPort),
    APP_RUNTIME_DIR: path.join(app.getPath("userData"), ".runtime"),
    SPLEETER_MODEL_PATH: path.join(app.getPath("userData"), "pretrained_models"),
    SPLEETER_WRAPPER: localWrapperPath,
  };
}

function getWindowsRuntimeValidation() {
  const requiredFiles = [
    {
      label: "Python 运行时",
      relativePath: path.join("python", "python.exe"),
      absolutePath: localPythonPath,
    },
    {
      label: "ffmpeg",
      relativePath: "ffmpeg.exe",
      absolutePath: localFfmpegPath,
    },
    {
      label: "ffprobe",
      relativePath: "ffprobe.exe",
      absolutePath: localFfprobePath,
    },
    {
      label: "Spleeter 包装脚本",
      relativePath: path.join("scripts", "spleeter_separate.py"),
      absolutePath: localWrapperPath,
    },
  ];

  const missingFiles = requiredFiles.filter((item) => !fs.existsSync(item.absolutePath));
  return {
    ok: missingFiles.length === 0,
    missingFiles,
  };
}

function buildWindowsRuntimeErrorMessage(validation) {
  const missingList = validation.missingFiles
    .map((item) => `- ${item.label}: ${item.relativePath}`)
    .join("\n");

  return [
    "未检测到完整的 PrismTrack Windows 本地运行时，应用无法启动。",
    "",
    "缺失文件:",
    missingList,
    "",
    `当前检测目录: ${localRuntimeRoot}`,
    "",
    "请确认安装包内容完整，或在应用目录中补齐以下结构后重试:",
    "python/python.exe",
    "ffmpeg.exe",
    "ffprobe.exe",
    "scripts/spleeter_separate.py",
    "",
    "如果这是自行打包的版本，请先确认 electron-builder 已正确包含 extraFiles。",
  ].join("\n");
}

function hasVcRuntimeError(text) {
  if (!text) {
    return false;
  }

  return /vcruntime\d*\.dll|msvcp\d*\.dll|side-by-side configuration/i.test(text);
}

function buildVcRuntimeErrorMessage(details = "") {
  return [
    "检测到 Windows VC Runtime 运行库缺失或损坏，PrismTrack 无法正常调用本地 Python 运行时。",
    "",
    "请在系统中安装或修复 Microsoft Visual C++ Redistributable（建议 x64 版本）。",
    "",
    "常见缺失文件包括：VCRUNTIME140.dll、VCRUNTIME140_1.dll、MSVCP140.dll",
    details ? "" : null,
    details ? `诊断信息: ${details}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatStderrSnippet(maxLength = 1600) {
  const text = (serverStderrBuffer || "").trim();
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(-maxLength);
}

function buildStartupFailureMessage(baseMessage, diagnostics = {}) {
  const lines = [baseMessage];
  const healthStatus = diagnostics.healthStatusCode;
  const healthMessage = diagnostics.healthMessage;
  const runtimeSummary = diagnostics.runtimeSummary;
  const stderrSnippet = diagnostics.stderrSnippet;

  if (healthStatus || healthMessage || runtimeSummary) {
    lines.push("");
    lines.push("健康检查诊断:");
    if (healthStatus) {
      lines.push(`- HTTP 状态码: ${healthStatus}`);
    }
    if (healthMessage) {
      lines.push(`- 服务消息: ${healthMessage}`);
    }
    if (runtimeSummary) {
      lines.push(`- 运行时: ${runtimeSummary}`);
    }
  }

  if (stderrSnippet) {
    lines.push("");
    lines.push("服务错误输出(末尾片段):");
    lines.push(stderrSnippet);
  }

  return lines.join("\n");
}

function assertRuntimeReady() {
  if (process.platform !== "win32") {
    return;
  }

  const validation = getWindowsRuntimeValidation();
  if (!validation.ok) {
    throw new Error(buildWindowsRuntimeErrorMessage(validation));
  }
}

function ensureUserDirectories() {
  const runtimeDir = path.join(app.getPath("userData"), ".runtime");
  const modelDir = path.join(app.getPath("userData"), "pretrained_models");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
}

function startServer() {
  if (serverProcess) {
    return;
  }

  ensureUserDirectories();
  serverStderrBuffer = "";

  const serverScript = path.join(appRoot, "server.js");
  serverProcess = spawn(resolveNodeCommand(), [serverScript], {
    cwd: appRoot,
    env: buildServerEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[desktop-server] ${chunk}`);
  });

  serverProcess.stderr?.on("data", (chunk) => {
    serverStderrBuffer += chunk.toString();
    if (serverStderrBuffer.length > 24000) {
      serverStderrBuffer = serverStderrBuffer.slice(-24000);
    }
    process.stderr.write(`[desktop-server] ${chunk}`);
  });

  serverProcess.on("exit", (code) => {
    const crashedUnexpectedly = !shuttingDown && code !== 0;
    serverProcess = null;
    if (crashedUnexpectedly) {
      const message = hasVcRuntimeError(serverStderrBuffer)
        ? buildVcRuntimeErrorMessage(`本地服务进程异常退出，退出码: ${code}`)
        : buildStartupFailureMessage(`本地服务进程异常退出，退出码: ${code}`, {
            stderrSnippet: formatStderrSnippet(),
          });
      dialog.showErrorBox("PrismTrack 启动失败", message);
      app.quit();
    }
  });
}

function requestHealth(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}api/health`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          resolve({ statusCode: response.statusCode, payload });
        } catch {
          resolve({ statusCode: response.statusCode, payload: null });
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(3000, () => {
      request.destroy(new Error("health 请求超时"));
    });
  });
}

async function assertWindowsHealthRuntime(url) {
  if (process.platform !== "win32") {
    return;
  }

  const { payload } = await requestHealth(url);
  const spleeterError = payload?.checks?.spleeter?.error || "";
  const ffmpegError = payload?.checks?.ffmpeg?.error || "";
  const ffprobeError = payload?.checks?.ffprobe?.error || "";
  const joinedErrors = [spleeterError, ffmpegError, ffprobeError].filter(Boolean).join("\n");

  if (hasVcRuntimeError(joinedErrors)) {
    throw new Error(buildVcRuntimeErrorMessage("来自 /api/health 的运行时诊断"));
  }
}

function summarizeRuntime(payload) {
  const runtime = payload?.runtime;
  if (!runtime) {
    return "";
  }

  const python = runtime.python?.command || "unknown";
  const ffmpeg = runtime.ffmpeg?.command || "unknown";
  const ffprobe = runtime.ffprobe?.command || "unknown";
  return `python=${python}, ffmpeg=${ffmpeg}, ffprobe=${ffprobe}`;
}

async function collectStartupDiagnostics(url) {
  const diagnostics = {
    stderrSnippet: formatStderrSnippet(),
  };

  try {
    const { statusCode, payload } = await requestHealth(url);
    diagnostics.healthStatusCode = statusCode || null;
    diagnostics.healthMessage = payload?.message || "";
    diagnostics.runtimeSummary = summarizeRuntime(payload);
  } catch {
    // Ignore health probe errors and rely on stderr diagnostics.
  }

  return diagnostics;
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`${url}api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retryOrFail();
      });

      request.on("error", retryOrFail);
      request.setTimeout(2000, () => {
        request.destroy();
        retryOrFail();
      });
    };

    const retryOrFail = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("等待本地服务启动超时"));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

async function createWindow() {
  assertRuntimeReady();
  startServer();
  await waitForServer(entryUrl);
  await assertWindowsHealthRuntime(entryUrl);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(entryUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(entryUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function stopServer() {
  shuttingDown = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    const diagnostics = await collectStartupDiagnostics(entryUrl);
    const isVcRuntime = hasVcRuntimeError(`${error.message}\n${diagnostics.stderrSnippet || ""}`);
    const message = isVcRuntime
      ? buildVcRuntimeErrorMessage(error.message)
      : buildStartupFailureMessage(error.message, diagnostics);
    dialog.showErrorBox("PrismTrack 启动失败", message);
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopServer();
});
