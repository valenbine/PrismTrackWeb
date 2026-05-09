// Compatible launcher for both CommonJS and ES Modules
const { spawn } = require('node:child_process');
const { platform, arch } = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { existsSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const readline = require('node:readline');

const __filename = fileURLToPath(import.meta.url || '');
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8010);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}/`;
const SERVER_SCRIPT = path.join(__dirname, "server.js");
const PYTHON_DIR = path.join(__dirname, "python");
const LOCAL_PYTHON = path.join(PYTHON_DIR, platform() === "win32" ? "python.exe" : "python");
const LOCAL_FFMPEG = path.join(__dirname, platform() === "win32" ? "ffmpeg.exe" : "ffmpeg");
const LOCAL_FFPROBE = path.join(__dirname, platform() === "win32" ? "ffprobe.exe" : "ffprobe");

let serverProcess = null;
let shuttingDown = false;

function log(level, ...args) {
  const time = new Date().toISOString();
  console.log(`${time} [${level}]`, ...args);
}

function printBanner() {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                  PrismTrack Launcher                     ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Platform: ${platform()} ${arch()}`.padEnd(62) + "║");
  console.log(`║  Address:  ${BASE_URL}`.padEnd(62) + "║");
  console.log("╚══════════════════════════════════════════════════════════╝");
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

  log("INFO", "检查依赖...");
  log("INFO", `  Python:     ${python}`);
  log("INFO", `  FFmpeg:     ${ffmpeg}`);
  log("INFO", `  FFprobe:    ${ffprobe}`);
  log("INFO", `  Server:     ${SERVER_SCRIPT}`);

  if (!existsSync(SERVER_SCRIPT)) {
    missing.push(`server.js (${SERVER_SCRIPT})`);
  }

  if (missing.length > 0) {
    console.error();
    console.error("缺少必要文件:");
    missing.forEach((f) => console.error(`  - ${f}`));
    console.error();
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
    };

    if (existsSync(LOCAL_PYTHON)) {
      env.SPLEETER_PYTHON = LOCAL_PYTHON;
    }

    log("INFO", `启动服务进程 (PID: pending)...`);

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
        log("WARN", `服务进程异常退出 (code: ${code}, signal: ${signal})`);
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
        reject(new Error("服务启动超时"));
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

  log("INFO", `打开系统默认浏览器: ${BASE_URL}`);
  exec(command, (error) => {
    if (error) {
      log("WARN", `自动打开浏览器失败: ${error.message}`);
      console.log(`请手动访问: ${BASE_URL}`);
    }
  });
}

function stopServer() {
  if (!serverProcess) {
    return;
  }

  shuttingDown = true;
  log("INFO", "正在停止服务...");

  if (platform() === "win32") {
    spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    process.kill(-serverProcess.pid, "SIGTERM");
  }

  serverProcess = null;
  log("INFO", "服务已停止");
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
      log("INFO", `收到 ${signal} 信号，准备退出...`);
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

  if (!checkDependencies()) {
    process.exit(1);
  }

  setupGracefulShutdown();

  try {
    await startServer();
    openBrowser();
  } catch (error) {
    console.error(`启动失败: ${error.message}`);
    process.exit(1);
  }

  console.log("服务运行中... 按 Ctrl+C 停止服务");
  console.log(`访问地址: ${BASE_URL}`);
  console.log();

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (input) => {
      const cmd = input.trim().toLowerCase();
      if (cmd === "q" || cmd === "quit" || cmd === "exit") {
        log("INFO", "用户输入退出命令");
        stopServer();
        process.exit(0);
      } else if (cmd === "h" || cmd === "help") {
        console.log("命令: q/quit/exit - 退出, h/help - 帮助");
      }
    });
  }
}

// Handle both ES Module and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  // CommonJS
  module.exports = { main };
  if (require.main === module) {
    main();
  }
} else {
  // ES Module
  main();
}