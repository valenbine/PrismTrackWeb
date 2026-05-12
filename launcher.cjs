// Compatible launcher for CommonJS
const { spawn } = require('node:child_process');
const { platform, arch } = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { appendFileSync, existsSync, mkdirSync } = require('node:fs');
const readline = require('node:readline');

const PORT = Number(process.env.PORT || 8010);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}/`;
const SERVER_SCRIPT = path.join(__dirname, "server.js");
const PYTHON_DIR = path.join(__dirname, "python");
const LOCAL_PYTHON = path.join(PYTHON_DIR, platform() === "win32" ? "python.exe" : "python");
const LOCAL_FFMPEG = path.join(__dirname, platform() === "win32" ? "ffmpeg.exe" : "ffmpeg");
const LOCAL_FFPROBE = path.join(__dirname, platform() === "win32" ? "ffprobe.exe" : "ffprobe");
const APP_DATA_DIR = process.env.PRISMTRACK_APP_DATA_DIR
  || (platform() === "win32" && process.env.APPDATA
    ? path.join(process.env.APPDATA, "prismtrack-spleeter")
    : path.join(__dirname, ".runtime"));
const LOG_DIR = process.env.PRISMTRACK_LOG_DIR || path.join(process.env.APPDATA || __dirname, "PrismTrackWeb", "logs");
const LOG_FILE = path.join(LOG_DIR, "launcher.log");
const MODEL_PATH = process.env.SPLEETER_MODEL_PATH || process.env.MODEL_PATH || path.join(APP_DATA_DIR, "pretrained_models");

let serverProcess = null;
let shuttingDown = false;

function log(level, ...args) {
  const time = new Date().toISOString();
  const message = `${time} [${level}] ${args.map(formatLogArg).join(" ")}`;
  console.log(message);
  writeLogFile(message);
}

function formatLogArg(arg) {
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function writeLogFile(message) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${message}\n`, "utf8");
  } catch {
    // Do not fail startup when the log file cannot be written.
  }
}

function printLogLocation() {
  log("INFO", `Log file: ${LOG_FILE}`);
}

function printBanner() {
  console.log();
  console.log("============================================================");
  console.log("PrismTrack Launcher");
  console.log("============================================================");
  console.log(`Platform: ${platform()} ${arch()}`);
  console.log(`Address:  ${BASE_URL}`);
  console.log("============================================================");
  console.log();
}

function resolvePythonCommand() {
  if (existsSync(LOCAL_PYTHON)) {
    return LOCAL_PYTHON;
  }
  return platform() === "win32" ? "python" : "python3";
}

function resolveFfmpegCommand() {
  if (existsSync(LOCAL_FFMPEG)) {
    return LOCAL_FFMPEG;
  }
  return "ffmpeg";
}

function resolveFfprobeCommand() {
  if (existsSync(LOCAL_FFPROBE)) {
    return LOCAL_FFPROBE;
  }
  return "ffprobe";
}

function checkDependencies() {
  const missing = [];
  const python = resolvePythonCommand();
  const ffmpeg = resolveFfmpegCommand();
  const ffprobe = resolveFfprobeCommand();
  const nodeModules = path.join(__dirname, "node_modules");
  const archiverPackage = path.join(nodeModules, "archiver", "package.json");

  log("INFO", "Checking dependencies...");
  log("INFO", `  Python:     ${python}`);
  log("INFO", `  FFmpeg:     ${ffmpeg}`);
  log("INFO", `  FFprobe:    ${ffprobe}`);
  log("INFO", `  Server:     ${SERVER_SCRIPT}`);
  log("INFO", `  node_modules: ${nodeModules}`);

  if (!existsSync(SERVER_SCRIPT)) {
    missing.push(`server.js (${SERVER_SCRIPT})`);
  }

  if (!existsSync(archiverPackage)) {
    missing.push(`archiver (${archiverPackage})`);
  }

  if (missing.length > 0) {
    log("ERROR", "Missing required files:");
    missing.forEach((f) => log("ERROR", `  - ${f}`));
    log("ERROR", `Please send this log file when reporting the issue: ${LOG_FILE}`);
    return false;
  }

  return true;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const python = resolvePythonCommand();
    const ffmpeg = resolveFfmpegCommand();
    const ffprobe = resolveFfprobeCommand();

    const env = {
      ...process.env,
      PORT: String(PORT),
      HOST,
      FFMPEG: ffmpeg,
      FFPROBE: ffprobe,
      PRISMTRACK_APP_DATA_DIR: APP_DATA_DIR,
      APP_RUNTIME_DIR: path.join(APP_DATA_DIR, ".runtime"),
      SPLEETER_MODEL_PATH: MODEL_PATH,
    };

    if (existsSync(LOCAL_PYTHON)) {
      env.SPLEETER_PYTHON = LOCAL_PYTHON;
    }

    log("INFO", `Starting service process (PID: pending)...`);

    serverProcess = spawn(process.execPath, [SERVER_SCRIPT], {
      env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });

    serverProcess.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trimEnd();
      if (text) {
        log("SERVER", text);
      }
    });

    serverProcess.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trimEnd();
      if (text) {
        log("ERROR", text);
      }
    });

    serverProcess.on("error", (error) => {
      reject(new Error(`服务进程启动失败: ${error.message}`));
    });

    serverProcess.on("exit", (code, signal) => {
      if (!shuttingDown) {
        log("WARN", `Service process exited unexpectedly (code: ${code}, signal: ${signal})`);
      }
    });

    waitForServer(PORT, 30000)
      .then(() => {
        log("INFO", `服务进程就绪 (PID: ${serverProcess.pid})`);
        resolve();
      })
      .catch(reject);
  });
}

function waitForServer(port, timeoutMs) {
  const startedAt = Date.now();
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      attempts++;
      const request = http.get(`http://${HOST}:${port}/api/health`, (response) => {
        if (response.statusCode === 200) {
          response.resume();
          resolve();
          return;
        }
        retryOrFail();
      });

      request.on("error", () => retryOrFail());
      request.setTimeout(2000, () => request.destroy());
    };

    const retryOrFail = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Service startup timed out"));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function openBrowser() {
  const { exec } = require('node:child_process');
  let command;

  switch (platform()) {
    case "win32":
      command = `start "" "${BASE_URL}"`;
      break;
    case "darwin":
      command = `open "${BASE_URL}"`;
      break;
    default:
      command = `xdg-open "${BASE_URL}" || sensible-browser "${BASE_URL}" || firefox "${BASE_URL}" || google-chrome "${BASE_URL}"`;
      break;
  }

  log("INFO", `Opening default browser: ${BASE_URL}`);
  exec(command, (error) => {
    if (error) {
      log("WARN", `Failed to open browser automatically: ${error.message}`);
      console.log(`Open manually: ${BASE_URL}`);
    }
  });
}

function stopServer() {
  if (!serverProcess) {
    return;
  }

  shuttingDown = true;
  log("INFO", "Stopping service...");

  if (platform() === "win32") {
    spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    process.kill(-serverProcess.pid, "SIGTERM");
  }

  serverProcess = null;
  log("INFO", "Service stopped");
}

function setupGracefulShutdown() {
  const signals = ["SIGINT", "SIGTERM"];
  if (platform() === "win32") {
    signals.push("SIGHUP");
  }

  signals.forEach((signal) => {
    process.on(signal, () => {
      if (shuttingDown) {
        return;
      }
      log("INFO", `Received ${signal}; exiting...`);
      stopServer();
      setTimeout(() => process.exit(0), 1000);
    });
  });

  process.on("exit", (code) => {
    if (code === 0 && !shuttingDown) {
      stopServer();
    }
  });
}

async function main() {
  printBanner();
  printLogLocation();

  if (!checkDependencies()) {
    process.exit(1);
  }

  setupGracefulShutdown();

  try {
    await startServer();
    openBrowser();
  } catch (error) {
    console.error(`Startup failed: ${error.message}`);
    process.exit(1);
  }

  console.log("Service is running. Press Ctrl+C to stop.");
  console.log(`URL: ${BASE_URL}`);
  console.log();

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (input) => {
      const cmd = input.trim().toLowerCase();
      if (cmd === "q" || cmd === "quit" || cmd === "exit") {
        log("INFO", "Exit command received");
        stopServer();
        process.exit(0);
      } else if (cmd === "h" || cmd === "help") {
        console.log("Commands: q/quit/exit - stop, h/help - help");
      }
    });
  }
}

main();
