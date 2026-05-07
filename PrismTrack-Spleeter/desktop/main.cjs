const { app, BrowserWindow, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");

const APP_PORT = 8000;
const isPackaged = app.isPackaged;
const appArgs = process.argv;
const prismDebugEnabled = appArgs.includes("--prism-debug");

let mainWindow = null;
let serverModulePromise = null;
let serverModule = null;
let logFilePath = null;

function getAppUrl() {
  return `http://127.0.0.1:${APP_PORT}${prismDebugEnabled ? "/?debug=1" : ""}`;
}

function appendLog(level, args) {
  if (!logFilePath) {
    return;
  }
  try {
    const line = `${new Date().toISOString()} [${level}] ${args.map(formatLogArg).join(" ")}\n`;
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch {}
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

function setupLogging() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, "desktop.log");

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    appendLog("INFO", args);
    originalLog(...args);
  };

  console.error = (...args) => {
    appendLog("ERROR", args);
    originalError(...args);
  };

  console.log(`[Desktop] Logging to ${logFilePath}`);
  console.log(`[Desktop] prism debug: ${prismDebugEnabled ? "enabled" : "disabled"}`);
}

function getAppRoot() {
  return isPackaged ? app.getAppPath() : path.join(__dirname, "..");
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(`${url}/api/health`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      request.on("error", retry);
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("PrismTrack server startup timed out."));
        return;
      }
      setTimeout(probe, 500);
    };

    probe();
  });
}

async function startServer() {
  if (serverModulePromise) {
    return serverModulePromise;
  }

  const appRoot = getAppRoot();
  const appRuntimeDir = isPackaged ? path.join(app.getPath("userData"), "runtime") : path.join(appRoot, ".runtime");
  const serverScript = path.join(appRoot, "server.js");
  const pythonRoot = path.join(process.resourcesPath, "vendor", "python");
  const pythonExecutable = process.platform === "win32"
    ? path.join(pythonRoot, "python.exe")
    : path.join(pythonRoot, "bin", "python3");
  const ffmpegRoot = path.join(process.resourcesPath, "vendor", "ffmpeg", "bin");
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    NODE_ENV: isPackaged ? "production" : "development",
    APP_RUNTIME_DIR: appRuntimeDir,
  };

  if (isPackaged) {
    env.SPLEETER_PYTHON = pythonExecutable;
    env.FFMPEG_BINARY = path.join(ffmpegRoot, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    env.PATH = `${pythonRoot}${path.delimiter}${ffmpegRoot}${path.delimiter}${process.env.PATH || ""}`;
    env.MODEL_PATH = path.join(process.resourcesPath, "pretrained_models");
    env.TF_ENABLE_ONEDNN_OPTS = "0";
    env.TF_CPP_MIN_LOG_LEVEL = "2";
    env.OMP_NUM_THREADS = "1";
    env.TF_NUM_INTRAOP_THREADS = "1";
    env.TF_NUM_INTEROP_THREADS = "1";
    env.GITHUB_HOST = "https://github.com";
    env.GITHUB_REPOSITORY = "deezer/spleeter";
    env.GITHUB_RELEASE = "v1.4.0";
  }

  Object.assign(process.env, env);
  serverModulePromise = import(pathToFileURL(serverScript).href).then((module) => {
    serverModule = module;
    return module;
  });
  return serverModulePromise;
}

async function createWindow() {
  const appUrl = getAppUrl();
  await startServer();
  await waitForServer("http://127.0.0.1:8000");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#07111d",
    icon: path.join(app.getAppPath(), "build", "icons", "prismtrack.ico"),
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
    if (!url.startsWith(`http://127.0.0.1:${APP_PORT}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(appUrl);
}

app.whenReady().then(() => {
  setupLogging();
  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error(error);
        app.quit();
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverModule?.server?.listening) {
    serverModule.server.close();
  }
});
