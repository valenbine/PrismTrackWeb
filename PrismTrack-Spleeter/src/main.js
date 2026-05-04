const form = document.querySelector("#upload-form");
const input = document.querySelector("#audio-file");
const dropZone = document.querySelector("#drop-zone");
const fileMeta = document.querySelector("#file-meta");
const separateButton = document.querySelector("#separate-button");
const downloadAllButton = document.querySelector("#download-all-button");
const modelSelect = document.querySelector("#model-select");
const separationModeSelect = document.querySelector("#separation-mode");
const modelHint = document.querySelector("#model-hint");
const stemCards = Array.from(document.querySelectorAll(".stem-card"));

const TRACK_MODELS = {
  two: ["spleeter:2stems"],
  four: ["spleeter:4stems"],
  six: ["spleeter:5stems"],
};
const STEMS_BY_MODE = {
  vocals: ["vocals", "other"],
  four: ["vocals", "drums", "bass", "other"],
  six: ["vocals", "drums", "bass", "other", "piano"],
};
const statusTitle = document.querySelector("#status-title");
const statusCopy = document.querySelector("#status-copy");
const statusPill = document.querySelector("#status-pill");
const progressBar = document.querySelector("#progress-bar");
const fileName = document.querySelector("#file-name");
const fileDuration = document.querySelector("#file-duration");
const modelUsed = document.querySelector("#model-used");
const pollDebug = document.querySelector("#poll-debug");
const pollDebugLine = document.querySelector("#poll-debug-line");
const pollDebugToggle = document.querySelector("#poll-debug-toggle");
const stemsLoadStatus = document.querySelector("#stems-load-status");
const masterProgress = document.querySelector("#master-progress");
const USE_BUFFER_PLAYBACK = true;
let debugPollingEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

let selectedFile = null;
let currentJobId = null;
let availableStemNames = [];
let stemAudios = {};
let stemGains = {};
let stemSources = {};
let stemBuffers = {};
let stemLoadState = {};
let masterGain = null;
let allPlaying = false;
let isAllMuted = false;
let audioContext = null;
let syncIntervalId = null;
let timeTickerId = null;
let transport = {
  isPlaying: false,
  startedAtCtxTime: 0,
  pausedOffsetSec: 0,
  durationSec: 0,
};
let soloStem = null;
let isSeeking = false;
let stemControlState = {};
let playbackState = "idle";
let stemWaveformCache = {};
let stemBufferPromiseCache = {};

function initAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

checkHealth();
loadModels();
setupDebugPanel();

if (pollDebugToggle) {
  pollDebugToggle.addEventListener("click", () => {
    debugPollingEnabled = !debugPollingEnabled;
    setupDebugPanel();
  });
}

separationModeSelect.addEventListener("change", () => {
  applyModelModeRules("mode");
});

modelSelect.addEventListener("change", () => {
  applyModelModeRules("model");
  updateModelHint();
});

input.addEventListener("change", () => {
  setSelectedFile(input.files?.[0] || null);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0] || null;
  if (file) {
    input.files = event.dataTransfer.files;
    setSelectedFile(file);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFile || !modelSelect.value) {
    return;
  }
  await startSeparation();
});

downloadAllButton.addEventListener("click", () => {
  if (!currentJobId) return;
  window.location.href = `/api/download/${currentJobId}/all`;
});

document.getElementById("play-all-btn").addEventListener("click", playAllStems);
document.getElementById("stop-all-btn").addEventListener("click", stopAllStems);
document.getElementById("mute-all-btn").addEventListener("click", toggleMuteAll);
masterProgress.addEventListener("pointerdown", () => {
  isSeeking = true;
});
masterProgress.addEventListener("pointerup", () => {
  isSeeking = false;
  seekToProgress();
});
masterProgress.addEventListener("change", () => {
  seekToProgress();
});

document.querySelectorAll(".stem-mute").forEach((btn) => {
  btn.addEventListener("click", () => toggleMute(btn.dataset.stem));
});

document.querySelectorAll(".stem-volume").forEach((slider) => {
  slider.addEventListener("input", (e) => {
    setVolume(e.target.dataset.stem, e.target.value / 100);
  });
});

document.querySelectorAll(".stem-play").forEach((btn) => {
  btn.addEventListener("click", () => toggleStemPlayback(btn.dataset.stem));
});

document.querySelectorAll(".stem-download").forEach((btn) => {
  btn.addEventListener("click", () => downloadStem(btn.dataset.stem));
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (health.ok) {
      setStatus("服务可用", "Ready", health.message, 0);
    } else {
      setStatus("服务不可用", "Error", health.message, 0, true);
    }
  } catch {
    setStatus("后端未连接", "Error", "无法连接到后端服务。", 0, true);
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const data = await response.json();
    if (data.models && data.models.length > 0) {
      modelSelect.innerHTML = data.models
        .map((m) => `<option value="${m.id}">${m.name}</option>`)
        .join("");
      applyModelModeRules("mode");
    }
  } catch (e) {
    console.error("Failed to load models:", e);
  }
}

function applyModelModeRules(trigger = "mode") {
  const is5StemsModel = modelSelect.value === "spleeter:5stems";

  Array.from(separationModeSelect.options).forEach((option) => {
    if (is5StemsModel && option.value === "four") {
      option.disabled = true;
    } else {
      option.disabled = false;
    }
  });

  if (is5StemsModel && separationModeSelect.value === "four") {
    separationModeSelect.value = trigger === "model" ? "six" : "vocals";
  }

  const mode = separationModeSelect.value;
  const allowed = mode === "vocals" ? TRACK_MODELS.two : mode === "six" ? TRACK_MODELS.six : TRACK_MODELS.four;
  const options = Array.from(modelSelect.options);

  options.forEach((option) => {
    option.disabled = !allowed.includes(option.value);
  });

  if (!allowed.includes(modelSelect.value)) {
    modelSelect.value = allowed[0] || "spleeter:2stems";
  }

  updateStemVisibility(separationModeSelect.value, availableStemNames);
  updateModelHint();
}

function updateModelHint() {
  const mode = separationModeSelect.value;

  if (mode === "six") {
    modelHint.textContent = "5轨模式仅支持 spleeter:5stems。";
    return;
  }

  if (mode === "vocals") {
    modelHint.textContent = "2轨模式输出人声与伴奏(accompaniment)。";
    return;
  }

  modelHint.textContent = "4轨模式输出人声、鼓、贝斯、其他。";
}

function setSelectedFile(file) {
  selectedFile = file;
  currentJobId = null;
  resetStemStates();

  if (!file) {
    fileMeta.hidden = true;
    separateButton.disabled = true;
    fileName.textContent = "--";
    fileDuration.textContent = "0:00";
    modelUsed.textContent = "--";
    return;
  }

  fileMeta.hidden = false;
  fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  fileName.textContent = truncateFileName(file.name);
  separateButton.disabled = false;
  modelUsed.textContent = modelSelect.options[modelSelect.selectedIndex]?.text.split(" ")[0] || "spleeter:2stems";

  loadAudioPreview(file);
  setStatus("音频已选择", "Ready", "点击开始分轨后将使用选中的模型进行分离。", 0);
}

async function loadAudioPreview(file) {
  try {
    const ctx = initAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    fileDuration.textContent = formatTime(audioBuffer.duration);
    drawEmptyWaveforms();
  } catch (e) {
    console.error("Failed to load audio preview:", e);
    fileDuration.textContent = "Error";
  }
}

function drawEmptyWaveforms() {
  const stems = new Set([...STEMS_BY_MODE.four, ...STEMS_BY_MODE.six]);
  stems.forEach((stem) => {
    const canvas = document.getElementById(`canvas-${stem}`);
    if (canvas) {
      drawWaveform(canvas, new Array(100).fill(0.1));
    }
  });
}

function drawWaveform(canvas, data) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const barWidth = width / data.length;
  const maxValue = Math.max(...data, 0.01);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, width, height);

  data.forEach((value, index) => {
    const normalized = value / maxValue;
    const barHeight = normalized * (height - 10);
    const x = index * barWidth;
    const y = (height - barHeight) / 2;

    const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
    gradient.addColorStop(0, "#86efac");
    gradient.addColorStop(1, "#4338ca");

    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth - 1, barHeight);
  });
}

async function startSeparation() {
  if (!selectedFile) return;

  setBusy(true);
  if (debugPollingEnabled && pollDebugLine) {
    pollDebugLine.textContent = "任务已创建，准备开始轮询";
  }
  currentJobId = null;
  modelUsed.textContent = modelSelect.options[modelSelect.selectedIndex]?.text.split(" ")[0] || "spleeter:2stems";
  resetStemStates();
  setStatus("正在上传", "Uploading", "正在上传音频文件到服务器...", 5);

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("model", modelSelect.value);
    formData.append("separationMode", separationModeSelect.value);

    const response = await fetch("/api/stems", {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "分轨任务创建失败。");
    }

    currentJobId = data.jobId;
    setStatus("处理中", "Processing", "分轨任务已创建，正在等待服务器处理...", 10);
    pollJobStatus(data.jobId);
  } catch (error) {
    setStatus("创建任务失败", "Error", error.message, 0, true);
    setBusy(false);
  }
}

async function pollJobStatus(jobId) {
  const maxAttempts = 300;
  let attempts = 0;

  const poll = async () => {
    if (attempts >= maxAttempts) {
      setStatus("处理超时", "Error", "分轨处理时间过长，请稍后重试。", 0, true);
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`/api/status/${jobId}`);
      const status = await response.json();

      if (status.status === "completed") {
        updateDebugPolling(status, attempts + 1);
        handleCompletion(jobId, status);
        return;
      }

      if (status.status === "error") {
        updateDebugPolling(status, attempts + 1);
        setStatus("处理失败", "Error", status.error || "分轨处理失败。", 0, true);
        setBusy(false);
        return;
      }

      if (status.status === "queued") {
        updateDebugPolling(status, attempts + 1);
        setStatus("排队中", "Queued", "当前任务正在排队，稍后会自动开始处理。", 6);
        attempts++;
        setTimeout(poll, 1200);
        return;
      }

      updateDebugPolling(status, attempts + 1);
      const progress = Math.min(status.progress || 10, 95);
      setStatus("处理中", "Processing", `正在使用 ${status.model || "spleeter:2stems"} 模型分离音轨...`, progress);
      attempts++;
      setTimeout(poll, 1000);
    } catch (e) {
      attempts++;
      setTimeout(poll, 2000);
    }
  };

  poll();
}

function handleCompletion(jobId, status) {
  const hasStems = status.stems && Object.keys(status.stems).length > 0;
  const availableStems = hasStems ? Object.keys(status.stems) : [];
  availableStemNames = availableStems;
  updateStemVisibility(status.separationMode, availableStems);

  if (hasStems) {
    setStatus("分轨完成", "Completed", "音轨已生成，正在加载播放缓存...", 100);
    prepareStemsForPlayback(jobId, status.stems);
    downloadAllButton.disabled = false;
    document.getElementById("play-all-btn").disabled = true;
    document.getElementById("stop-all-btn").disabled = false;
  } else {
    setStatus("分离完成", "Warning", "未能获取部分音轨文件，请刷新重试。", 100, true);
  }

  setBusy(false);
}

async function prepareStemsForPlayback(jobId, stems) {
  const entries = Object.entries(stems || {});
  if (!entries.length) {
    return;
  }

  if (!USE_BUFFER_PLAYBACK) {
    entries.forEach(([stemName]) => {
      enableStemControls(stemName, jobId);
    });
    updatePlayAllAvailability();
    return;
  }

  initAudioContext();
  setStemLoadStatus(`正在加载音轨缓存 0/${entries.length}`);
  let loaded = 0;

  entries.forEach(([stemName]) => {
    stemLoadState[stemName] = "loading";
    enableStemButtons(stemName, false);
    markStemStatus(stemName, `加载中 0/${entries.length}`, "loading", 0);
  });

  for (const [stemName] of entries) {
    markStemStatus(stemName, `加载中 ${loaded}/${entries.length}`, "loading", (loaded / entries.length) * 100);
    try {
      const buffer = await loadStemBuffer(stemName, jobId);
      stemBuffers[stemName] = buffer;
      stemLoadState[stemName] = "ready";
      ensureStemGain(stemName);
      enableStemButtons(stemName, true);
      markStemStatus(stemName, "就绪", "ready", 100);
      loaded += 1;
      setStemLoadStatus(`正在加载音轨缓存 ${loaded}/${entries.length}`);
      markStemStatus(stemName, `就绪 ${loaded}/${entries.length}`, "ready", 100);
      loadWaveformData(stemName, buffer).then((data) => {
        const canvas = document.getElementById(`canvas-${stemName}`);
        if (canvas && data) {
          drawWaveform(canvas, data);
        }
      });
    } catch (error) {
      stemLoadState[stemName] = "error";
      enableStemButtons(stemName, false);
      markStemStatus(stemName, `加载失败 ${loaded}/${entries.length}`, "error", (loaded / entries.length) * 100);
      console.error(`Failed to prepare stem buffer: ${stemName}`, error);
    }
  }

  const readyCount = Object.values(stemLoadState).filter((state) => state === "ready").length;
  const totalCount = Object.keys(stemLoadState).length;
  const failedCount = Object.values(stemLoadState).filter((state) => state === "error").length;
  if (readyCount > 0) {
    if (failedCount > 0) {
      setStemLoadStatus(`音轨缓存完成 ${readyCount}/${totalCount}，失败 ${failedCount} 条`, true);
    } else {
      setStemLoadStatus(`音轨缓存完成 ${readyCount}/${totalCount}`);
    }
  } else {
    setStemLoadStatus("音轨缓存失败，无法播放。", true);
  }

  transport.durationSec = Math.max(...Object.values(stemBuffers).map((buffer) => buffer.duration || 0), 0);
  transport.pausedOffsetSec = 0;
  setPlaybackState("idle");
  masterProgress.value = "0";
  masterProgress.disabled = transport.durationSec <= 0;
  updateMasterTime();
  updatePlayAllAvailability();
}

function enableStemControls(stemName, jobId) {
  const playBtn = document.querySelector(`.stem-play[data-stem="${stemName}"]`);
  const downloadBtn = document.querySelector(`.stem-download[data-stem="${stemName}"]`);

  if (playBtn) playBtn.disabled = false;
  if (downloadBtn) downloadBtn.disabled = false;

  initAudioContext();

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0.8;
  const sourceNode = audioContext.createMediaElementSource(audio);

  audio.src = `/api/download/${jobId}/${stemName}`;
  sourceNode.connect(gainNode);
  gainNode.connect(masterGain);

  stemAudios[stemName] = audio;
  stemGains[stemName] = gainNode;
  stemSources[stemName] = sourceNode;

  loadWaveformData(stemName).then((data) => {
    const canvas = document.getElementById(`canvas-${stemName}`);
    if (canvas && data) {
      drawWaveform(canvas, data);
    }
  });

  audio.addEventListener("loadedmetadata", () => {
    updateMasterTime();
  });

  audio.addEventListener("timeupdate", updateMasterTime);
}

async function loadStemBuffer(stemName, jobId) {
  const cacheKey = `${jobId}:${stemName}`;
  if (stemBufferPromiseCache[cacheKey]) {
    return stemBufferPromiseCache[cacheKey];
  }

  stemBufferPromiseCache[cacheKey] = (async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(`/api/download/${jobId}/${stemName}`);
        if (!response.ok) {
          throw new Error(`failed to fetch stem ${stemName}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return await audioContext.decodeAudioData(arrayBuffer);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
    throw lastError || new Error(`failed to decode stem ${stemName}`);
  })();

  return stemBufferPromiseCache[cacheKey];
}

function ensureStemGain(stemName) {
  if (!stemGains[stemName]) {
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.8;
    gainNode.connect(masterGain);
    stemGains[stemName] = gainNode;
  }

  if (!stemControlState[stemName]) {
    stemControlState[stemName] = {
      muted: false,
      volume: 0.8,
    };
  }
  applyStemGain(stemName);
}

function enableStemButtons(stemName, enabled) {
  const playBtn = document.querySelector(`.stem-play[data-stem="${stemName}"]`);
  const downloadBtn = document.querySelector(`.stem-download[data-stem="${stemName}"]`);
  const muteBtn = document.querySelector(`.stem-mute[data-stem="${stemName}"]`);
  const volumeSlider = document.querySelector(`.stem-volume[data-stem="${stemName}"]`);
  if (playBtn) playBtn.disabled = !enabled;
  if (downloadBtn) downloadBtn.disabled = !enabled;
  if (muteBtn) muteBtn.disabled = !enabled;
  if (volumeSlider) volumeSlider.disabled = !enabled;
}

function markStemStatus(stemName, text, level, progress = null) {
  const card = document.querySelector(`.stem-card[data-stem="${stemName}"]`);
  if (!card) return;
  card.dataset.loadState = level;
  if (progress === null || Number.isNaN(progress)) {
    delete card.dataset.loadProgress;
  } else {
    card.dataset.loadProgress = String(Math.max(0, Math.min(100, Math.round(progress))));
  }
  let el = card.querySelector(".stem-status");
  if (!el) {
    el = document.createElement("span");
    el.className = "stem-status";
    const title = card.querySelector("h3");
    if (title) {
      title.insertAdjacentElement("afterend", el);
    }
  }
  el.textContent = text;
  if (progress === null || Number.isNaN(progress)) {
    el.style.background = "rgba(255, 255, 255, 0.06)";
  } else {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    el.style.background = `linear-gradient(90deg, rgba(134,239,172,0.28) ${pct}%, rgba(255,255,255,0.06) ${pct}%)`;
  }
}

async function loadWaveformData(stemName, fromBuffer = null) {
  if (!audioContext || !currentJobId) return null;

  try {
    const cacheKey = `${currentJobId}:${stemName}`;
    if (stemWaveformCache[cacheKey]) {
      return stemWaveformCache[cacheKey];
    }

    const audioBuffer = fromBuffer || (await loadStemBuffer(stemName, currentJobId));

    const rawData = audioBuffer.getChannelData(0);
    const samples = 100;
    const blockSize = Math.floor(rawData.length / samples);
    const data = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[i * blockSize + j]);
      }
      data.push(sum / blockSize);
    }

    const maxVal = Math.max(...data);
    const normalized = data.map((v) => v / maxVal);
    stemWaveformCache[cacheKey] = normalized;
    return normalized;
  } catch (e) {
    console.error(`Failed to load waveform for ${stemName}:`, e);
    return null;
  }
}

function playAllStems() {
  if (!USE_BUFFER_PLAYBACK) {
    const entries = Object.entries(stemSources);
    if (entries.length === 0) return;
    allPlaying = true;
    updatePlayAllButton();
    return;
  }

  if (playbackState === "playing") {
    pauseAllStems();
    return;
  }

  const readyStems = Object.keys(stemBuffers);
  if (!readyStems.length) {
    return;
  }

  initAudioContext();
  const baseOffset = playbackState === "paused" ? transport.pausedOffsetSec : 0;
  const offset = Math.max(0, Math.min(baseOffset, Math.max(transport.durationSec - 0.02, 0)));
  startAllAt(offset);
  startTimeTicker();
  startSyncGuard();
  updatePlayAllButton();
}

function pauseAllStems() {
  if (!USE_BUFFER_PLAYBACK || !transport.isPlaying) {
    return;
  }
  const current = Math.max(0, audioContext.currentTime - transport.startedAtCtxTime);
  transport.pausedOffsetSec = Math.min(current, transport.durationSec || current);
  transport.isPlaying = false;
  stopCurrentSources();
  stopTimeTicker();
  setPlaybackState("paused");
  updateMasterTime();
  updatePlayAllButton();
}

function startAllAt(offsetSec) {
  const readyStems = Object.keys(stemBuffers);
  if (!readyStems.length) return;

  const when = audioContext.currentTime + 0.06;
  stopCurrentSources();

  readyStems.forEach((stemName) => {
    const source = audioContext.createBufferSource();
    source.buffer = stemBuffers[stemName];
    source.connect(stemGains[stemName]);
    source.onended = handleSourceEnded;
    stemSources[stemName] = source;
    source.start(when, offsetSec);
  });

  transport.isPlaying = true;
  transport.startedAtCtxTime = when - offsetSec;
  transport.pausedOffsetSec = offsetSec;
  setPlaybackState("playing");
}

function stopAllStems() {
  if (USE_BUFFER_PLAYBACK) {
    stopCurrentSources();
    transport.isPlaying = false;
    transport.pausedOffsetSec = 0;
    masterProgress.value = "0";
  }
  setPlaybackState("idle");
  stopSyncGuard();
  stopTimeTicker();
  updateMasterTime();
  updatePlayAllButton();
}

function toggleMuteAll() {
  isAllMuted = !isAllMuted;

  const muteBtn = document.getElementById("mute-all-btn");

  if (isAllMuted) {
    Object.keys(stemGains).forEach((stemName) => applyStemGain(stemName));
    muteBtn.classList.add("is-muted");
    muteBtn.querySelector(".btn-icon").textContent = "🔇";
    muteBtn.querySelector(".btn-text").textContent = "取消静音";

    document.querySelectorAll(".stem-mute").forEach((btn) => {
      btn.classList.add("is-muted");
      btn.textContent = "🔇";
    });
  } else {
    Object.keys(stemGains).forEach((stemName) => applyStemGain(stemName));
    muteBtn.classList.remove("is-muted");
    muteBtn.querySelector(".btn-icon").textContent = "🔊";
    muteBtn.querySelector(".btn-text").textContent = "静音";

    document.querySelectorAll(".stem-mute").forEach((btn) => {
      btn.classList.remove("is-muted");
      btn.textContent = "🔊";
    });
  }
}

function toggleMute(stemName) {
  const muteBtn = document.querySelector(`.stem-mute[data-stem="${stemName}"]`);
  if (!stemControlState[stemName]) return;

  stemControlState[stemName].muted = !stemControlState[stemName].muted;
  applyStemGain(stemName);

  if (stemControlState[stemName].muted) {
    muteBtn.classList.add("is-muted");
    muteBtn.textContent = "🔇";
  } else {
    muteBtn.classList.remove("is-muted");
    muteBtn.textContent = "🔊";
  }
}

function setVolume(stemName, value) {
  if (!stemControlState[stemName]) return;
  stemControlState[stemName].volume = Math.max(0, Math.min(1, value));
  applyStemGain(stemName);
}

function applyStemGain(stemName) {
  const gain = stemGains[stemName];
  const state = stemControlState[stemName];
  if (!gain || !state) return;

  let target = state.volume;
  if (isAllMuted || state.muted) {
    target = 0;
  }
  if (soloStem && soloStem !== stemName) {
    target = 0;
  }
  gain.gain.value = target;
}

function updatePlayAllButton() {
  const playBtn = document.getElementById("play-all-btn");
  if (playbackState === "playing") {
    playBtn.querySelector(".btn-icon").textContent = "⏸";
    playBtn.querySelector(".btn-text").textContent = "暂停";
    playBtn.classList.add("is-active");
  } else if (playbackState === "paused") {
    playBtn.querySelector(".btn-icon").textContent = "▶";
    playBtn.querySelector(".btn-text").textContent = "继续";
    playBtn.classList.add("is-active");
  } else {
    playBtn.querySelector(".btn-icon").textContent = "▶";
    playBtn.querySelector(".btn-text").textContent = "播放全部";
    playBtn.classList.remove("is-active");
  }
}

function updateMasterTime() {
  let currentTime = 0;
  let totalDuration = transport.durationSec || 0;

  if (USE_BUFFER_PLAYBACK) {
    if (transport.isPlaying) {
      currentTime = Math.max(0, audioContext.currentTime - transport.startedAtCtxTime);
      if (totalDuration > 0 && currentTime >= totalDuration) {
        currentTime = totalDuration;
        transport.isPlaying = false;
        transport.pausedOffsetSec = 0;
        stopCurrentSources();
        stopTimeTicker();
        setPlaybackState("ended");
        updatePlayAllButton();
      }
    } else {
      currentTime = transport.pausedOffsetSec;
    }
  }

  document.getElementById("master-time").textContent =
    `${formatTime(currentTime)} / ${formatTime(totalDuration)}`;

  if (!isSeeking && totalDuration > 0) {
    masterProgress.value = String(Math.round((currentTime / totalDuration) * 1000));
  }
}

function toggleStemPlayback(stemName) {
  if (!USE_BUFFER_PLAYBACK) {
    return;
  }
  if (!stemGains[stemName]) return;

  if (soloStem === stemName) {
    soloStem = null;
    Object.keys(stemGains).forEach((name) => applyStemGain(name));
  } else {
    soloStem = stemName;
    Object.keys(stemGains).forEach((name) => applyStemGain(name));
  }

  updatePlayButtons();
}

function updatePlayButtons() {
  document.querySelectorAll(".stem-play").forEach((btn) => {
    const stemName = btn.dataset.stem;
    if (soloStem === stemName) {
      btn.textContent = "取消独奏";
    } else {
      btn.textContent = "独奏";
    }
  });
}

function downloadStem(stemName) {
  if (!currentJobId) return;
  window.location.href = `/api/download/${currentJobId}/${stemName}`;
}

function resetStemStates() {
  stopSyncGuard();
  stopTimeTicker();
  stopCurrentSources();

  Object.values(stemGains).forEach((gain) => {
    if (gain) {
      gain.disconnect();
    }
  });

  Object.values(stemSources).forEach((source) => {
    if (source) {
      source.disconnect();
    }
  });

  stemGains = {};
  stemSources = {};
  stemBuffers = {};
  stemLoadState = {};
  stemAudios = {};
  stemControlState = {};
  stemWaveformCache = {};
  stemBufferPromiseCache = {};
  availableStemNames = [];
  transport = {
    isPlaying: false,
    startedAtCtxTime: 0,
    pausedOffsetSec: 0,
    durationSec: 0,
  };
  soloStem = null;
  allPlaying = false;
  isAllMuted = false;
  playbackState = "idle";

  document.querySelectorAll(".stem-play").forEach((btn) => {
    btn.disabled = true;
    btn.textContent = "独奏";
  });
  document.querySelectorAll(".stem-download").forEach((btn) => {
    btn.disabled = true;
  });

  document.querySelectorAll(".stem-mute").forEach((btn) => {
    btn.classList.remove("is-muted");
    btn.textContent = "🔊";
  });
  document.querySelectorAll(".stem-volume").forEach((slider) => {
    slider.value = 80;
    slider.disabled = true;
  });

  document.getElementById("play-all-btn").disabled = true;
  document.getElementById("stop-all-btn").disabled = true;
  const muteBtn = document.getElementById("mute-all-btn");
  muteBtn.classList.remove("is-muted");
  muteBtn.querySelector(".btn-icon").textContent = "🔊";
  muteBtn.querySelector(".btn-text").textContent = "静音";

  downloadAllButton.disabled = true;
  document.getElementById("master-time").textContent = "0:00 / 0:00";
  masterProgress.value = "0";
  masterProgress.disabled = true;
  setStemLoadStatus("");

  // Keep button label/icon in sync after state reset.
  updatePlayAllButton();

  updateStemVisibility(separationModeSelect.value, []);
}

function updatePlayAllAvailability() {
  const playAllBtn = document.getElementById("play-all-btn");
  const stemNames = Object.keys(stemLoadState).filter((stem) => stemLoadState[stem] === "ready");
  if (stemNames.length === 0) {
    playAllBtn.disabled = true;
    return;
  }

  playAllBtn.disabled = false;
}

function startSyncGuard() {
  if (!USE_BUFFER_PLAYBACK) return;
  stopSyncGuard();
  syncIntervalId = setInterval(() => {
    if (!transport.isPlaying) {
      return;
    }
    const entries = Object.entries(stemSources).filter(([, source]) => source && source.buffer);
    if (entries.length <= 1) {
      return;
    }

    updateMasterTime();
  }, 500);
}

function stopSyncGuard() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

function stopCurrentSources() {
  Object.entries(stemSources).forEach(([stem, source]) => {
    if (!source) return;
    try {
      source.onended = null;
      source.stop();
    } catch (e) {}
    try {
      source.disconnect();
    } catch (e) {}
    stemSources[stem] = null;
  });
}

function handleSourceEnded() {
  if (!transport.isPlaying) {
    return;
  }
  const current = audioContext.currentTime - transport.startedAtCtxTime;
  if (current >= transport.durationSec - 0.05) {
    transport.isPlaying = false;
    transport.pausedOffsetSec = 0;
    stopCurrentSources();
    stopTimeTicker();
    setPlaybackState("ended");
    updateMasterTime();
    updatePlayAllButton();
  }
}

function setPlaybackState(nextState) {
  playbackState = nextState;
  allPlaying = nextState === "playing";
}

function startTimeTicker() {
  stopTimeTicker();
  const tick = () => {
    updateMasterTime();
    if (transport.isPlaying) {
      timeTickerId = requestAnimationFrame(tick);
    }
  };
  timeTickerId = requestAnimationFrame(tick);
}

function stopTimeTicker() {
  if (timeTickerId) {
    cancelAnimationFrame(timeTickerId);
    timeTickerId = null;
  }
}

function setStemLoadStatus(message, isError = false) {
  if (!stemsLoadStatus) return;
  stemsLoadStatus.textContent = message;
  stemsLoadStatus.classList.toggle("is-error", isError);
  updateDebugCacheStatus(message, isError);
}

function updateDebugCacheStatus(message, isError = false) {
  if (!debugPollingEnabled || !pollDebugLine) {
    return;
  }
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const tag = isError ? "缓存错误" : "缓存状态";
  pollDebugLine.textContent = `${tag} | 时间=${time} | ${message}`;
}

function seekToProgress() {
  if (!USE_BUFFER_PLAYBACK || transport.durationSec <= 0) {
    return;
  }

  const ratio = Number(masterProgress.value) / 1000;
  const nextOffset = Math.max(0, Math.min(transport.durationSec, ratio * transport.durationSec));
  const wasPlaying = transport.isPlaying;

  if (wasPlaying) {
    startAllAt(nextOffset);
  } else {
    transport.pausedOffsetSec = nextOffset;
    if (nextOffset > 0) {
      setPlaybackState("paused");
      updatePlayAllButton();
    }
  }

  updateMasterTime();
}

function setBusy(isBusy) {
  separateButton.disabled = isBusy || !selectedFile;
  input.disabled = isBusy;
  modelSelect.disabled = isBusy;
  separationModeSelect.disabled = isBusy;
}

function setupDebugPanel() {
  if (!pollDebug || !pollDebugLine || !pollDebugToggle) {
    return;
  }
  if (debugPollingEnabled) {
    pollDebug.hidden = false;
    pollDebugToggle.textContent = "隐藏调试反馈";
    pollDebugLine.textContent = "调试模式已开启，等待轮询结果";
  } else {
    pollDebug.hidden = true;
    pollDebugToggle.textContent = "显示调试反馈";
  }
}

function updateDebugPolling(status, attempt) {
  if (!debugPollingEnabled || !pollDebugLine) {
    return;
  }
  const state = status?.status || "unknown";
  const progress = Number.isFinite(status?.progress) ? Math.max(0, Math.min(100, status.progress)) : 0;
  const message = status?.message || "无";
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  pollDebugLine.textContent = `状态=${state} | 进度=${progress}% | 轮询=${attempt} | 时间=${time} | 消息=${message}`;
}

function updateStemVisibility(mode, availableStems = []) {
  const expected = new Set(STEMS_BY_MODE[mode] || STEMS_BY_MODE.four);
  const available = new Set(availableStems);
  const vocalsMode = mode === "vocals";

  stemCards.forEach((card) => {
    const stem = card.dataset.stem;
    const shouldShow = expected.has(stem);
    card.hidden = !shouldShow;

    if (!shouldShow) {
      return;
    }

    const title = card.querySelector("h3");
    if (title && stem === "other") {
      title.textContent = vocalsMode ? "伴奏" : "其他";
    }

    const playBtn = card.querySelector(".stem-play");
    const downloadBtn = card.querySelector(".stem-download");
    const muteBtn = card.querySelector(".stem-mute");
    const slider = card.querySelector(".stem-volume");

    const stemExists = available.size !== 0 && available.has(stem);
    const isReady = stemLoadState[stem] === "ready";
    if (playBtn) playBtn.disabled = !(stemExists && isReady);
    if (downloadBtn) downloadBtn.disabled = !(stemExists && isReady);
    if (muteBtn) muteBtn.disabled = !(stemExists && isReady);
    if (slider) slider.disabled = !(stemExists && isReady);
    if (!stemExists) {
      markStemStatus(stem, "未生成", "idle");
    } else if (stemLoadState[stem] === "loading") {
      markStemStatus(stem, "加载中", "loading");
    } else if (stemLoadState[stem] === "error") {
      markStemStatus(stem, "加载失败", "error");
    }
  });

}

function setStatus(title, pill, copy, progress, isError = false) {
  statusTitle.textContent = title;
  statusPill.textContent = pill;
  statusCopy.textContent = copy;
  statusCopy.classList.toggle("is-error", isError);
  progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function truncateFileName(name, maxLength = 20) {
  if (name.length <= maxLength) return name;
  const ext = name.split(".").pop();
  const base = name.slice(0, name.length - ext.length - 1);
  return `${base.slice(0, maxLength - ext.length - 4)}...${ext}`;
}
