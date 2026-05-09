const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const isDev = !app.isPackaged;
const codeRoot = isDev ? path.resolve(__dirname, "..") : app.getAppPath();
const entryUrl = process.env.PRISMTRACK_DESKTOP_URL || "http://127.0.0.1:8000/";
const serverPort = Number(new URL(entryUrl).port || 8000);
const installRoot = isDev ? codeRoot : path.dirname(process.execPath);
const DESKTOP_RUNTIME_CHECK_REV = "runtime-check-r5-20260509";

let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;
let serverStderrBuffer = "";
let logFilePath = "";

function resolveNodeCommand() {
  return process.execPath;
}

function formatLogArg(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendLog(level, ...args) {
  if (!logFilePath) {
    return;
  }

  try {
    const line = `${new Date().toISOString()} [${level}] ${args.map(formatLogArg).join(" ")}\n`;
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch {}
}

function logInfo(...args) {
  appendLog("INFO", ...args);
}

function logError(...args) {
  appendLog("ERROR", ...args);
}

function setupLogging() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, "desktop.log");

  logInfo("--- PrismTrack desktop start ---");
  logInfo("runtime check revision", DESKTOP_RUNTIME_CHECK_REV);
  logInfo("isPackaged", app.isPackaged);
  logInfo("process.execPath", process.execPath);
  logInfo("process.resourcesPath", process.resourcesPath);
  logInfo("app.getAppPath", app.getAppPath());
  logInfo("logFilePath", logFilePath);
  logInfo("codeRoot", codeRoot);
  logInfo("installRoot", installRoot);
  logInfo("entryUrl", entryUrl);
  logInfo("serverPort", serverPort);
}

function installProcessLogHandlers() {
  process.on("uncaughtException", (error) => {
    logError("uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    logError("unhandled rejection", reason);
  });
}

function getLogPathMessage() {
  return logFilePath ? `启动日志: ${logFilePath}` : "启动日志尚未初始化";
}

function uniqPaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getRuntimeRoots() {
  if (isDev) {
    return [codeRoot];
  }

  // In packaged Windows app, extraFiles may land in install root,
  // while app code is usually under resources.
  return uniqPaths([process.resourcesPath, installRoot]);
}

function getAppRoots() {
  if (isDev) {
    return [codeRoot];
  }

  // Application files from build.files usually live under app.getAppPath(),
  // but keep fallback roots for safety across packaging layouts.
  return uniqPaths([codeRoot, process.resourcesPath, installRoot]);
}

function resolveFileFromRoots(relativePath, roots) {
  for (const root of roots) {
    const absolutePath = path.join(root, relativePath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return path.join(roots[0] || codeRoot, relativePath);
}

function resolveRuntimeFile(relativePath) {
  return resolveFileFromRoots(relativePath, getRuntimeRoots());
}

function resolveAppFile(relativePath) {
  return resolveFileFromRoots(relativePath, getAppRoots());
}

function buildServerEnv() {
  const wrapperPath = resolveAppFile(path.join("scripts", "spleeter_separate.py"));

  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(serverPort),
    APP_RUNTIME_DIR: path.join(app.getPath("userData"), ".runtime"),
    SPLEETER_MODEL_PATH: path.join(app.getPath("userData"), "pretrained_models"),
    SPLEETER_WRAPPER: wrapperPath,
  };
}

function getWindowsRuntimeValidation() {
  const localPythonPath = resolveRuntimeFile(path.join("python", "python.exe"));
  const localFfmpegPath = resolveRuntimeFile("ffmpeg.exe");
  const localFfprobePath = resolveRuntimeFile("ffprobe.exe");
  const localWrapperPath = resolveAppFile(path.join("scripts", "spleeter_separate.py"));

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
    roots: getRuntimeRoots(),
    appRoots: getAppRoots(),
    requiredFiles,
    missingFiles,
  };
}

function buildWindowsRuntimeErrorMessage(validation) {
  const missingList = validation.missingFiles
    .map((item) => `- ${item.label}: ${item.relativePath}`)
    .join("\n");

  return [
    "未检测到完整的 PrismTrack Windows 本地运行时，应用无法启动。",
    `构建校验标识: ${DESKTOP_RUNTIME_CHECK_REV}`,
    "",
    "缺失文件:",
    missingList,
    "",
    `运行时检测目录: ${validation.roots.join(" | ")}`,
    `应用文件检测目录: ${validation.appRoots.join(" | ")}`,
    "",
    "请确认安装包内容完整，或在应用目录中补齐以下结构后重试:",
    "python/python.exe",
    "ffmpeg.exe",
    "ffprobe.exe",
    "scripts/spleeter_separate.py",
    "",
    getLogPathMessage(),
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
    "",
    getLogPathMessage(),
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
  const lines = [baseMessage, `构建校验标识: ${DESKTOP_RUNTIME_CHECK_REV}`];
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

  lines.push("");
  lines.push(getLogPathMessage());

  return lines.join("\n");
}

function assertRuntimeReady() {
  if (process.platform !== "win32") {
    return;
  }

  const validation = getWindowsRuntimeValidation();
  logInfo("runtime validation", {
    ok: validation.ok,
    runtimeRoots: validation.roots,
    appRoots: validation.appRoots,
    requiredFiles: validation.requiredFiles.map((item) => ({
      label: item.label,
      relativePath: item.relativePath,
      absolutePath: item.absolutePath,
      exists: fs.existsSync(item.absolutePath),
    })),
    missingFiles: validation.missingFiles.map((item) => ({
      label: item.label,
      relativePath: item.relativePath,
      absolutePath: item.absolutePath,
    })),
  });

  if (!validation.ok) {
    logError("runtime validation failed", validation.missingFiles);
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

  const serverScript = path.join(codeRoot, "server.js");
  const serverEnv = buildServerEnv();
  logInfo("starting local server", {
    command: resolveNodeCommand(),
    args: [serverScript],
    cwd: codeRoot,
    electronRunAsNode: serverEnv.ELECTRON_RUN_AS_NODE,
    port: serverEnv.PORT,
    wrapper: serverEnv.SPLEETER_WRAPPER,
    modelPath: serverEnv.SPLEETER_MODEL_PATH,
    appRuntimeDir: serverEnv.APP_RUNTIME_DIR,
  });

  serverProcess = spawn(resolveNodeCommand(), [serverScript], {
    cwd: codeRoot,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout?.on("data", (chunk) => {
    logInfo("[desktop-server stdout]", chunk.toString().trimEnd());
    process.stdout.write(`[desktop-server] ${chunk}`);
  });

  serverProcess.stderr?.on("data", (chunk) => {
    serverStderrBuffer += chunk.toString();
    if (serverStderrBuffer.length > 24000) {
      serverStderrBuffer = serverStderrBuffer.slice(-24000);
    }
    logError("[desktop-server stderr]", chunk.toString().trimEnd());
    process.stderr.write(`[desktop-server] ${chunk}`);
  });

  serverProcess.on("error", (error) => {
    logError("local server process spawn error", error);
    dialog.showErrorBox("PrismTrack 启动失败", buildStartupFailureMessage("本地服务进程启动失败", {
      stderrSnippet: error.message,
    }));
    app.quit();
  });

  serverProcess.on("exit", (code, signal) => {
    logInfo("local server process exit", { code, signal, shuttingDown });
    const crashedUnexpectedly = !shuttingDown && code !== 0;
    serverProcess = null;
    if (crashedUnexpectedly) {
      const message = hasVcRuntimeError(serverStderrBuffer)
        ? buildVcRuntimeErrorMessage(`本地服务进程异常退出，退出码: ${code}`)
        : buildStartupFailureMessage(`本地服务进程异常退出，退出码: ${code}`, {
            stderrSnippet: formatStderrSnippet(),
          });
      logError("local server process crashed", message);
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
    logInfo("startup diagnostics health payload", { statusCode, payload });
  } catch (error) {
    logError("startup diagnostics health request failed", error);
  }

  return diagnostics;
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastFailure = "";

  return new Promise((resolve, reject) => {
    const attempt = () => {
      let completed = false;

      const failOnce = (reason) => {
        if (completed) {
          return;
        }
        completed = true;
        retryOrFail(reason);
      };

      const request = http.get(`${url}api/health`, (response) => {
        if (response.statusCode === 200) {
          completed = true;
          response.resume();
          logInfo("local server health check succeeded", { attempts, statusCode: response.statusCode });
          resolve();
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const snippet = body.trim().slice(0, 1000);
          failOnce(snippet ? `HTTP ${response.statusCode}: ${snippet}` : `HTTP ${response.statusCode}`);
        });
      });

      request.on("error", (error) => failOnce(error.message));
      request.setTimeout(2000, () => {
        request.destroy(new Error("health 请求超时"));
      });
    };

    const retryOrFail = (reason = "") => {
      attempts += 1;
      if (reason) {
        lastFailure = reason;
      }

      if (attempts === 1 || attempts % 10 === 0) {
        logInfo("waiting for local server", { attempts, elapsedMs: Date.now() - startedAt, lastFailure });
      }

      if (Date.now() - startedAt >= timeoutMs) {
        const message = lastFailure ? `等待本地服务启动超时，最后错误: ${lastFailure}` : "等待本地服务启动超时";
        logError("local server startup timed out", { attempts, lastFailure, stderr: formatStderrSnippet() });
        reject(new Error(message));
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
    logInfo("stopping local server process");
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    setupLogging();
    installProcessLogHandlers();
    await createWindow();
  } catch (error) {
    logError("desktop startup failed", error);
    const diagnostics = await collectStartupDiagnostics(entryUrl);
    const isVcRuntime = hasVcRuntimeError(`${error.message}\n${diagnostics.stderrSnippet || ""}`);
    const message = isVcRuntime
      ? buildVcRuntimeErrorMessage(error.message)
      : buildStartupFailureMessage(error.message, diagnostics);
    logError("showing startup failure dialog", message);
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
