const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const APP_PORT = 8000;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const isPackaged = app.isPackaged;

let mainWindow = null;
let serverProcess = null;

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

function startServer() {
  const appRoot = getAppRoot();
  const nodeCommand = process.execPath;
  const serverScript = path.join(appRoot, "server.js");
  const pythonRoot = path.join(process.resourcesPath, "vendor", "python");
  const ffmpegRoot = path.join(process.resourcesPath, "vendor", "ffmpeg", "bin");
  const spleeterBin = process.platform === "win32"
    ? path.join(pythonRoot, "Scripts", "spleeter.exe")
    : path.join(pythonRoot, "bin", "spleeter");
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    NODE_ENV: isPackaged ? "production" : "development",
  };

  if (isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    env.SPLEETER = spleeterBin;
    env.FFMPEG_BINARY = path.join(ffmpegRoot, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    env.PATH = `${ffmpegRoot}${path.delimiter}${process.env.PATH || ""}`;
    env.MODEL_PATH = path.join(process.resourcesPath, "pretrained_models");
  }

  serverProcess = spawn(nodeCommand, [serverScript], {
    cwd: appRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  serverProcess.on("exit", () => {
    serverProcess = null;
  });
}

async function createWindow() {
  startServer();
  await waitForServer(APP_URL);

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
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(APP_URL);
}

app.whenReady().then(() => {
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
  if (serverProcess) {
    serverProcess.kill();
  }
});
