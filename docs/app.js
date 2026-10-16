/**
 * Caro Arena — Battle Royale Frontend
 * N-Player Free-For-All with Leaderboard Tracking, Web Audio, Heatmap, and Championship Mode
 */

const canvas = document.getElementById("caro-canvas");
const ctx = canvas.getContext("2d");

let camera = { x: canvas.width / 2, y: canvas.height / 2, zoom: 1.0, baseCellSize: 38 };
let isDragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
let hasDragged = false, userInteractedWithCamera = false;
let hoverCoord = null;
let _lastAutoScaleMoveCount = -1;

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLAYER_COLORS = {
  laya:  { fill: "#0891b2", light: "#e0f7fa", name: "Laya",  ring: "#0891b2" },
  jev:   { fill: "#7c3aed", light: "#ede9fe", name: "Jev",   ring: "#7c3aed" },
  von:   { fill: "#059669", light: "#d1fae5", name: "Von",   ring: "#059669" },
  mojev: { fill: "#e11d48", light: "#ffe4e6", name: "MoJev", ring: "#e11d48" },
  human: { fill: "#d97706", light: "#fef3c7", name: "Human", ring: "#d97706" },
};

const STONE_STYLES = {
  laya:  { body: ["#0e7490", "#0891b2", "#06b6d4"], text: "#fff" },
  jev:   { body: ["#6d28d9", "#7c3aed", "#8b5cf6"], text: "#fff" },
  von:   { body: ["#047857", "#059669", "#10b981"], text: "#fff" },
  mojev: { body: ["#be123c", "#e11d48", "#f43f5e"], text: "#fff" },
  human: { body: ["#b45309", "#d97706", "#f59e0b"], text: "#fff" },
};

// Distinct palettes when multiple human players are in a match (e.g. Multiplayer)
const HUMAN_SLOT_PALETTES = [
  { fill: "#d97706", light: "#fef3c7", ring: "#d97706", body: ["#b45309", "#d97706", "#f59e0b"], text: "#fff" },
  { fill: "#2563eb", light: "#dbeafe", ring: "#2563eb", body: ["#1d4ed8", "#2563eb", "#3b82f6"], text: "#fff" },
  { fill: "#c026d3", light: "#fae8ff", ring: "#c026d3", body: ["#a21caf", "#c026d3", "#d946ef"], text: "#fff" },
  { fill: "#334155", light: "#f1f5f9", ring: "#334155", body: ["#0f172a", "#334155", "#475569"], text: "#fff" },
];

let symbolMap = {};
let gameState = null;
let cachedLeaderboard = null;
let cachedBattlesCount = 0;
let lastRenderedMoveCount = 0, lastRenderedGameId = null;
let isReplayMode = false, replayMoves = [], replayIndex = 0, replayPlayers = [], replayPlacements = [];
let showMoveNumbers = true, showCoords = false;
let showHeatmap = true, showLasers = true;
let socket = null, wsReconnectTimer = null;
let activeHistoryTab = "moves";
let lastWasHumanTurn = false;

let clientEngine = null;
let isServerAvailable = false;
let confettiEngine = null;

function useBackend() {
  return isServerAvailable && !isMultiplayerActive;
}

let backendSessionId = "";
try {
  const urlSession = new URLSearchParams(window.location.search).get("session");
  if (urlSession) {
    backendSessionId = urlSession.trim();
    sessionStorage.setItem("caro_backend_session", backendSessionId);
  } else {
    backendSessionId = sessionStorage.getItem("caro_backend_session") || "";
  }
} catch {}

function apiFetch(url, options = {}) {
  if (!backendSessionId) return fetch(url, options);
  const headers = Object.assign({}, options.headers || {}, { "X-Caro-Session": backendSessionId });
  return fetch(url, Object.assign({}, options, { headers }));
}

let isNonStop = false;
try {
  isNonStop = localStorage.getItem("caro_nonstop") === "true";
} catch {}

function setNonStop(val) {
  isNonStop = !!val;
  try { localStorage.setItem("caro_nonstop", isNonStop ? "true" : "false"); } catch {}
  const h = document.getElementById("toggle-nonstop");
  if (h) {
    h.checked = isNonStop;
    h.closest(".toggle-nonstop-wrap")?.classList.toggle("active", isNonStop);
  }
  const f = document.getElementById("toggle-nonstop-footer");
  if (f) f.checked = isNonStop;

  if (clientEngine) {
    clientEngine.nonStop = isNonStop;
  }
  if (useBackend() && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, delay_sec: 0.01, non_stop: isNonStop })
    }).catch(() => {});
  }
}

// Touch gestures
let touchStartDistance = 0, touchStartZoom = 1.0;

// Arena Config (Always fastest blitz speed: 10ms)
window.CaroSandboxConfig = {
  defenseWeight: 0.05,
  delaySec: 0.01,
  temperatures: {
    laya: 0.40,
    jev: 0.25,
    von: 0.35,
    mojev: 0.50
  }
};

// ─────────────────────────────────────────
// Init
// ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  loadSandboxConfig();
  setupEventListeners();
  if (typeof initMultiplayerIntegration === "function") {
    initMultiplayerIntegration();
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const confCanvas = document.getElementById("confetti-canvas");
  if (confCanvas) confettiEngine = new ConfettiEngine(confCanvas);

  // Check if backend API server is available (only probe on localhost / 127.0.0.1 to avoid 404 on static hosts like GitHub Pages)
  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isLocalHost) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1200);
      const r = await apiFetch("/api/health", { signal: ctrl.signal });
      clearTimeout(timeout);
      if (r.ok) isServerAvailable = true;
    } catch {
      isServerAvailable = false;
    }
  } else {
    isServerAvailable = false;
  }

  if (isServerAvailable) {
    connectWebSocket();
  } else if (window.CaroEngine) {
    console.log("Caro Arena: Running in standalone In-Browser Engine mode (GitHub Pages compatible)");
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => handleStateUpdate(state);
  }

  await fetchState();
  await fetchLeaderboard();
  await fetchBattleHistory();
  updateRosterCount();

  const urlParams = new URLSearchParams(window.location.search);
  const replayDataParam = urlParams.get("replay_data");
  if (replayDataParam) {
    startReplayFromData(replayDataParam);
    return;
  }
  const replayParam = urlParams.get("replay");
  if (replayParam) {
    await startReplay(replayParam);
    return;
  }
  if (urlParams.get("autoplay") === "1" || urlParams.get("autoplay") === "true") {
    setTimeout(() => toggleAutoPlay(), 300);
  }

  // Ensure initial game matches checked roster (4 AI models, 0 Human)
  const hasSavedMpRoom = (() => {
    try { return Boolean(sessionStorage.getItem("caro_active_room")); } catch { return false; }
  })();
  const selected = getSelectedRoster();
  const currentTypes = (gameState?.players || []).map(p => p.type).sort();
  const selectedSorted = [...selected].sort();
  if (!hasSavedMpRoom && !isMultiplayerActive && gameState && (gameState.board?.move_count === 0 || gameState.status === "ready") && JSON.stringify(currentTypes) !== JSON.stringify(selectedSorted)) {
    await newBattle();
  }
});

function resizeCanvas() {
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const w = canvas.clientWidth || 700;
  const h = canvas.clientHeight || 700;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (!userInteractedWithCamera) {
    camera.x = canvas.width / 2;
    camera.y = canvas.height / 2;
    autoScaleCamera(true);
  }
  renderBoard();
}

// ─────────────────────────────────────────
// WebSocket & Dual-Mode State Handler
// ─────────────────────────────────────────
let lastWsMessageAt = 0;
let backendPollTimer = null;
let isFetchingState = false;

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsQuery = backendSessionId ? `?session=${encodeURIComponent(backendSessionId)}` : "";
  try {
    socket = new WebSocket(`${protocol}//${location.host}/ws${wsQuery}`);
    socket.onopen = () => {
      lastWsMessageAt = Date.now();
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };
    socket.onmessage = (e) => {
      lastWsMessageAt = Date.now();
      if (isMultiplayerActive) return;
      try { handleStateUpdate(JSON.parse(e.data)); } catch {}
    };
    socket.onclose = () => {
      if (!wsReconnectTimer) wsReconnectTimer = setTimeout(connectWebSocket, 2000);
      ensureBackendSyncPolling();
    };
    socket.onerror = () => {
      ensureBackendSyncPolling();
    };
  } catch {
    ensureBackendSyncPolling();
  }
}

function shouldPollBackendState() {
  if (!useBackend() || isReplayMode || !gameState) return false;
  if (gameState.is_auto_playing) return true;
  if (gameState.has_human && !gameState.is_human_turn && gameState.status !== "finished") return true;
  return false;
}

function ensureBackendSyncPolling() {
  if (!shouldPollBackendState()) {
    if (backendPollTimer) {
      clearTimeout(backendPollTimer);
      backendPollTimer = null;
    }
    return;
  }
  if (backendPollTimer) return;

  const pollTick = async () => {
    backendPollTimer = null;
    if (!shouldPollBackendState()) return;
    const wsOpen = socket && socket.readyState === WebSocket.OPEN;
    const wsStale = !wsOpen || (Date.now() - lastWsMessageAt > 110);
    if (wsStale) {
      await fetchState();
    }
    if (shouldPollBackendState()) {
      const nextDelay = (socket && socket.readyState === WebSocket.OPEN) ? 90 : 40;
      backendPollTimer = setTimeout(pollTick, nextDelay);
    }
  };

  const initialDelay = (socket && socket.readyState === WebSocket.OPEN) ? 90 : 40;
  backendPollTimer = setTimeout(pollTick, initialDelay);
}

function handleStateUpdate(data) {
  if (isReplayMode || !data) return;
  const wasFinished = gameState?.status === "finished";
  const isNewGame = gameState?.game_id && data.game_id !== gameState.game_id;
  const prevMoveCount = isNewGame ? 0 : (gameState?.board?.moves?.length || 0);
  const newMoveCount = data?.board?.moves?.length || 0;
  const prevPlacementsCount = isNewGame ? 0 : (gameState?.board?.placements?.length || 0);
  const newPlacements = data?.board?.placements || [];

  gameState = data;
  if (isNewGame) userInteractedWithCamera = false;
  rebuildSymbolMap();
  updateUI();
  ensureBackendSyncPolling();
  if (typeof syncMultiplayerTurnTimer === "function") {
    syncMultiplayerTurnTimer();
  }

  // Audio feedback for remote server updates (clientEngine plays its own sounds in playMove)
  if (useBackend() && window.CaroAudio && newMoveCount > prevMoveCount) {
    const lastM = data.board.moves[newMoveCount - 1];
    const pInfo = data.players?.find(p => p.symbol === lastM.player);
    try { window.CaroAudio?.playStoneClick?.(pInfo?.type || "ai"); } catch {}
    if (newPlacements.length > prevPlacementsCount) {
      const latestPlacement = newPlacements[newPlacements.length - 1];
      if (latestPlacement?.winning_line) {
        try {
          window.CaroAudio?.playWinChime?.();
          window.CaroAudio?.playLaserSweep?.();
        } catch {}
      }
    }
  }

  // Human turn chime (only alert when it is the local player's turn)
  const isHumanTurn = isMultiplayerActive
    ? (data.current_player?.symbol === myMultiplayerSymbol && data.status !== "finished")
    : (data.is_human_turn && data.status !== "finished");
  if (isHumanTurn && !lastWasHumanTurn) {
    if (typeof window.CaroAudio?.playHumanTurnAlert === "function") {
      try {
        window.CaroAudio.playHumanTurnAlert();
      } catch (err) {
        console.warn("Audio chime failed:", err);
      }
    }
  }
  lastWasHumanTurn = isHumanTurn;

  if (data.status === "finished" && !wasFinished) {
    fetchLeaderboard();
    fetchBattleHistory();
    try { window.CaroAudio?.playChampionshipFanfare?.(); } catch {}
    if (confettiEngine) confettiEngine.launch(3000);
  }
}

function rebuildSymbolMap() {
  symbolMap = {};
  if (gameState?.players) {
    for (const p of gameState.players) {
      symbolMap[p.symbol] = p;
    }
  }
}

// ─────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────
function setupEventListeners() {
  document.getElementById("btn-auto").addEventListener("click", toggleAutoPlay);
  document.getElementById("btn-new")?.addEventListener("click", newBattle);
  document.getElementById("btn-reset").addEventListener("click", resetAll);

  // Non-stop toggles
  const nonstopToggle = document.getElementById("toggle-nonstop");
  const nonstopFooterToggle = document.getElementById("toggle-nonstop-footer");
  if (nonstopToggle) {
    nonstopToggle.checked = isNonStop;
    nonstopToggle.closest(".toggle-nonstop-wrap")?.classList.toggle("active", isNonStop);
    nonstopToggle.addEventListener("change", e => setNonStop(e.target.checked));
  }
  if (nonstopFooterToggle) {
    nonstopFooterToggle.checked = isNonStop;
    nonstopFooterToggle.addEventListener("change", e => setNonStop(e.target.checked));
  }

  // Sound toggle button
  const soundBtn = document.getElementById("btn-sound");
  if (soundBtn) {
    soundBtn.textContent = (window.CaroAudio && window.CaroAudio.enabled) ? "🔊" : "🔇";
    soundBtn.addEventListener("click", () => {
      if (!window.CaroAudio) return;
      const on = window.CaroAudio.toggle();
      soundBtn.textContent = on ? "🔊" : "🔇";
    });
  }

  // Fullscreen button
  const fsBtn = document.getElementById("btn-fullscreen");
  if (fsBtn) {
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Human Undo
  document.getElementById("btn-undo-move")?.addEventListener("click", undoHumanMove);

  // Viewport & Board Toggles
  document.getElementById("toggle-numbers")?.addEventListener("change", e => { showMoveNumbers = e.target.checked; renderBoard(); });
  document.getElementById("toggle-coords")?.addEventListener("change", e => { showCoords = e.target.checked; renderBoard(); });
  document.getElementById("toggle-heatmap")?.addEventListener("change", e => {
    showHeatmap = e.target.checked;
    renderBoard();
    if (showHeatmap || showLasers) startFxAnimation();
  });

  document.getElementById("btn-zoom-in")?.addEventListener("click", () => zoomCamera(1.2));
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => zoomCamera(0.833));
  document.getElementById("btn-recenter")?.addEventListener("click", recenterCamera);
  document.getElementById("btn-tab-moves")?.addEventListener("click", () => switchHistoryTab("moves"));
  document.getElementById("btn-tab-battles")?.addEventListener("click", () => switchHistoryTab("battles"));

  // Mouse controls
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mouseleave", () => {
    hoverCoord = null;
    const hud = document.getElementById("ghost-hud");
    if (hud) hud.style.display = "none";
    renderBoard();
  });

  // Touch gesture listeners (Pinch-to-zoom & Pan)
  setupTouchListeners();

  // Roster checkboxes
  document.querySelectorAll("#roster-config input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", onRosterChange);
  });

  // Replay keyboard shortcuts
  window.addEventListener("keydown", e => {
    if (isReplayMode) {
      if (e.key === "ArrowLeft") stepReplay(-1);
      else if (e.key === "ArrowRight") stepReplay(1);
      else if (e.key === "Escape") exitReplayMode();
    }
  });

  // Start real-time FX animation loop for heat shimmer & laser pulse
  if (showHeatmap || showLasers) {
    startFxAnimation();
  }
}

function setupTouchListeners() {
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isDragging = true; hasDragged = false;
      const t = e.touches[0];
      dragStartX = t.clientX; dragStartY = t.clientY;
      camStartX = camera.x; camStartY = camera.y;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistance = Math.hypot(dx, dy);
      touchStartZoom = camera.zoom;
      userInteractedWithCamera = true;
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const scX = canvas.width / rect.width, scY = canvas.height / rect.height;
      const dx = (t.clientX - dragStartX) * scX, dy = (t.clientY - dragStartY) * scY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { hasDragged = true; userInteractedWithCamera = true; }
      camera.x = camStartX + dx; camera.y = camStartY + dy;
      renderBoard();
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (touchStartDistance > 0) {
        const factor = dist / touchStartDistance;
        camera.zoom = Math.max(0.2, Math.min(4.0, touchStartZoom * factor));
        renderBoard();
      }
    }
  }, { passive: true });

  canvas.addEventListener("touchend", (e) => {
    if (isDragging && !hasDragged && e.changedTouches.length === 1) {
      if (isLocalHumanAllowedToMove()) {
        const t = e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        const scX = canvas.width / rect.width, scY = canvas.height / rect.height;
        const sx = (t.clientX - rect.left) * scX, sy = (t.clientY - rect.top) * scY;
        const coord = screenToBoard(sx, sy);
        const moves = gameState?.board?.moves || [];
        const occupied = moves.some(m => m.row === coord.r && m.col === coord.c);
        if (!occupied) sendHumanMove(coord.r, coord.c);
      }
    }
    isDragging = false;
  }, { passive: true });
}

// ─────────────────────────────────────────
// Roster Selection
// ─────────────────────────────────────────
function getSelectedRoster() {
  const selected = [];
  document.querySelectorAll("#roster-config .roster-toggle").forEach(label => {
    const cb = label.querySelector("input");
    if (cb && cb.checked) {
      selected.push(label.dataset.model);
    }
  });
  return selected;
}

function updateRosterCount() {
  const count = getSelectedRoster().length;
  const badge = document.getElementById("roster-count");
  const autoBtn = document.getElementById("btn-auto");
  const newBtn = document.getElementById("btn-new");

  if (badge) {
    if (count < 2) {
      badge.textContent = `${count} player${count !== 1 ? "s" : ""} (min 2)`;
      badge.style.color = "#e11d48";
    } else {
      badge.textContent = `${count} player${count !== 1 ? "s" : ""}`;
      badge.style.color = "";
    }
  }
  if (autoBtn) autoBtn.disabled = count < 2;
  if (newBtn) newBtn.disabled = count < 2;
}

function onRosterChange() {
  if (isMultiplayerActive) return;
  const roster = getSelectedRoster();
  updateRosterCount();
  if (roster.length >= 2) {
    if (!gameState || gameState.board?.move_count === 0 || gameState.status === "finished" || gameState.status === "ready") {
      newBattle();
    }
  }
}

// ─────────────────────────────────────────
// API Calls (Dual-Mode: Backend or In-Browser Engine)
// ─────────────────────────────────────────
async function fetchState() {
  if (useBackend()) {
    if (isFetchingState) return;
    isFetchingState = true;
    try {
      const r = await apiFetch("/api/battle/current");
      if (r.ok) handleStateUpdate(await r.json());
    } catch {} finally {
      isFetchingState = false;
    }
  } else if (clientEngine) {
    handleStateUpdate(clientEngine.getState());
  }
}

async function fetchLeaderboard() {
  if (useBackend()) {
    try {
      const r = await apiFetch("/api/leaderboard");
      cachedLeaderboard = await r.json();
      renderLeaderboard();
    } catch {}
  } else if (window.CaroEngine) {
    cachedLeaderboard = window.CaroEngine.ClientStorage.getLeaderboard();
    renderLeaderboard();
  }
}

async function fetchBattleHistory() {
  if (useBackend()) {
    try {
      const r = await apiFetch("/api/battles?limit=50");
      const battles = await r.json();
      cachedBattlesCount = Array.isArray(battles) ? battles.length : 0;
      renderBattleHistory(battles);
      renderLeaderboard();
    } catch {}
  } else if (window.CaroEngine) {
    const storage = window.CaroEngine.ClientStorage;
    const battles = storage.getBattles();
    cachedBattlesCount = storage.getTotalBattlesCount
      ? storage.getTotalBattlesCount()
      : (Array.isArray(battles) ? battles.length : 0);
    renderBattleHistory(battles);
    renderLeaderboard();

    if (storage.isCloudSyncEnabled && storage.isCloudSyncEnabled()) {
      storage.pullFromSupabase(20).then(({ battles: syncedBattles, leaderboard: syncedLb }) => {
        cachedLeaderboard = syncedLb || storage.getLeaderboard();
        cachedBattlesCount = storage.getTotalBattlesCount
          ? storage.getTotalBattlesCount()
          : (Array.isArray(syncedBattles) ? syncedBattles.length : 0);
        renderBattleHistory(syncedBattles);
        renderLeaderboard();
      }).catch(() => {});
    }
  }
}

async function toggleAutoPlay() {
  try { window.CaroAudio?.ensureContext?.(); } catch {}
  if (isReplayMode) exitReplayMode();

  // If in multiplayer and battle finished:
  if (isMultiplayerActive) {
    if (window.CaroMultiplayer?.isHost && gameState?.status === "finished") {
      startNextMultiplayerBattle();
    }
    return;
  }

  // If battle is finished, this single button starts the next battle!
  if (gameState?.status === "finished") {
    await newBattle();
    if (useBackend()) {
      try {
        await apiFetch("/api/battle/auto-play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, delay_sec: 0.01, non_stop: isNonStop })
        });
        await fetchState();
        ensureBackendSyncPolling();
      } catch {}
    } else if (clientEngine) {
      clientEngine.nonStop = isNonStop;
      clientEngine.toggleAutoPlay(true, 0.01);
    }
    return;
  }

  const currentlyPlaying = gameState?.is_auto_playing;
  const targetState = !currentlyPlaying;
  const delaySec = 0.01;

  if (useBackend()) {
    try {
      await apiFetch("/api/battle/auto-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: targetState, delay_sec: delaySec, non_stop: isNonStop })
      });
      await fetchState();
      ensureBackendSyncPolling();
    } catch {}
  } else if (clientEngine) {
    clientEngine.nonStop = isNonStop;
    clientEngine.toggleAutoPlay(targetState, delaySec);
  }
}

async function newBattle() {
  try { window.CaroAudio?.ensureContext?.(); } catch {}
  if (isReplayMode) exitReplayMode();
  if (isMultiplayerActive) {
    if (window.CaroMultiplayer?.isHost) {
      startNextMultiplayerBattle();
    }
    return;
  }
  const selected = getSelectedRoster();
  if (selected.length < 2) return;

  if (useBackend()) {
    try {
      const res = await apiFetch("/api/battle/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: selected })
      });
      if (res.ok) {
        handleStateUpdate(await res.json());
        userInteractedWithCamera = false;
        autoScaleCamera(true);
        renderBoard();
      }
    } catch {}
  } else if (clientEngine) {
    const nextState = clientEngine.newGame(selected);
    userInteractedWithCamera = false;
    autoScaleCamera(true);
    handleStateUpdate(nextState);
    if (clientEngine.isAutoPlaying) clientEngine.scheduleNextStep();
  }
}

async function resetAll() {
  if (confirm("Reset arena history, leaderboards, and battle series to #1?")) {
    if (isReplayMode) exitReplayMode();
    if (useBackend()) {
      try { await apiFetch("/api/history/clear", { method: "POST" }); } catch {}
    } else if (window.CaroEngine) {
      window.CaroEngine.ClientStorage.clearHistory();
      if (clientEngine) {
        if (isMultiplayerActive && multiplayerRoster.length >= 2) {
          const playerTypes = multiplayerRoster.map(p => p.type);
          clientEngine.battleNumber = 1;
          clientEngine.newGame(playerTypes, false, multiplayerRoster);
        } else {
          clientEngine.newGame(getSelectedRoster());
        }
      }
    }
    userInteractedWithCamera = false;
    await fetchState();
    await fetchLeaderboard();
    await fetchBattleHistory();
    autoScaleCamera(true);
    renderBoard();
  }
}

async function sendHumanMove(r, c) {
  try { window.CaroAudio?.ensureContext?.(); } catch {}
  if (isMultiplayerActive) {
    if (!myMultiplayerSymbol) {
      myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
    }
    if (!myMultiplayerSymbol) return;

    const currSymbol = gameState?.current_player?.symbol;
    if (currSymbol !== myMultiplayerSymbol) {
      const p = getPlayerMeta(currSymbol);
      updateMultiplayerHudStatus(`Waiting for ${p?.name || "opponent"} to move...`);
      return;
    }

    if (clientEngine) {
      const nextState = clientEngine.humanMove(r, c);
      if (nextState) {
        handleStateUpdate(nextState);
        if (window.CaroMultiplayer) {
          window.CaroMultiplayer.sendMove(r, c, "human", myMultiplayerSymbol, nextState.board.moves.length);
        }
        scheduleHostAiMoveIfNeeded();
      }
    }
    return;
  }

  if (useBackend()) {
    try {
      const res = await apiFetch("/api/battle/human-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: r, col: c })
      });
      if (res.ok) {
        handleStateUpdate(await res.json());
        ensureBackendSyncPolling();
      }
    } catch {}
  } else if (clientEngine) {
    const nextState = clientEngine.humanMove(r, c);
    if (nextState) handleStateUpdate(nextState);
  }
}

async function undoHumanMove() {
  if (isReplayMode || isMultiplayerActive) return;
  if (useBackend()) {
    try {
      const r = await apiFetch("/api/battle/undo", { method: "POST" });
      if (r.ok) {
        handleStateUpdate(await r.json());
        await fetchLeaderboard();
        await fetchBattleHistory();
      }
    } catch {}
  } else if (clientEngine) {
    clientEngine.undoHumanMove();
    await fetchLeaderboard();
    await fetchBattleHistory();
  }
}

// ─────────────────────────────────────────
// UI Updates
// ─────────────────────────────────────────
function updateUI() {
  if (!gameState) return;
  updateTurnBanner();
  updateAutoPlayButton();
  updateHumanTurnBar();
  renderPlayerLegend();
  renderBattleRoster();
  renderBoard();
  updateMoveHistory();
}

function getPlayerMeta(symbol) {
  const info = symbolMap[symbol];
  if (!info) {
    return {
      type: "unknown",
      name: symbol || "?",
      color: "#94a3b8",
      fill: "#94a3b8",
      light: "#f1f5f9",
      body: ["#64748b", "#94a3b8", "#cbd5e1"],
      text: "#fff"
    };
  }
  if (info.type === "human") {
    const activePlayers = isReplayMode ? replayPlayers : (gameState?.players || []);
    const humans = activePlayers.filter(p => p.type === "human");
    if (humans.length > 1 || isMultiplayerActive) {
      const hIdx = Math.max(0, humans.findIndex(p => p.symbol === symbol));
      const pal = HUMAN_SLOT_PALETTES[hIdx % HUMAN_SLOT_PALETTES.length];
      const displayName = (info.name && info.name !== "Human") ? info.name : `Human (${symbol})`;
      return {
        type: "human",
        name: displayName,
        color: pal.fill,
        fill: pal.fill,
        light: pal.light,
        body: pal.body,
        text: pal.text
      };
    }
    const base = PLAYER_COLORS.human;
    const style = STONE_STYLES.human;
    return {
      type: "human",
      name: info.name || base.name,
      color: base.fill,
      fill: base.fill,
      light: base.light,
      body: style.body,
      text: style.text
    };
  }
  const colors = PLAYER_COLORS[info.type] || { fill: "#94a3b8", light: "#f1f5f9", name: info.type };
  const style = STONE_STYLES[info.type] || STONE_STYLES.laya;
  return {
    type: info.type,
    name: info.name || colors.name,
    color: colors.fill,
    fill: colors.fill,
    light: colors.light,
    body: style.body,
    text: style.text
  };
}

function isLocalHumanAllowedToMove() {
  if (isReplayMode || !gameState || gameState.status === "finished") return false;
  if (isMultiplayerActive) {
    myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
    return Boolean(myMultiplayerSymbol && gameState.current_player?.symbol === myMultiplayerSymbol);
  }
  return Boolean(gameState.is_human_turn);
}

function updateHumanTurnBar() {
  const bar = document.getElementById("human-turn-bar");
  if (!bar) return;
  const undoBtn = document.getElementById("btn-undo-move");
  const promptText = bar.querySelector(".human-prompt-text");

  if (isReplayMode) {
    bar.classList.remove("active");
    bar.style.display = "none";
    return;
  }

  if (isMultiplayerActive) {
    myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
    const isMyTurn = Boolean(myMultiplayerSymbol && gameState?.current_player?.symbol === myMultiplayerSymbol && gameState?.status !== "finished");
    if (undoBtn) undoBtn.style.display = "none";
    if (promptText) promptText.textContent = "Your Turn — Click any empty intersection to place your stone";
    bar.classList.toggle("active", isMyTurn);
    bar.style.display = isMyTurn ? "flex" : "none";
    return;
  }

  const humanSymbols = new Set((gameState?.players || []).filter(p => p.type === "human").map(p => p.symbol));
  const hasHuman = humanSymbols.size > 0 || Boolean(gameState?.has_human) || Boolean(clientEngine && clientEngine.hasHumanPlayer());
  const humanMovesCount = (gameState?.board?.moves || []).filter(m => humanSymbols.has(m.player)).length;
  const isMyTurn = hasHuman && Boolean(gameState?.is_human_turn) && gameState?.status !== "finished";
  const canUndoAfterFinish = hasHuman && gameState?.status === "finished" && humanMovesCount > 0;
  const showBar = isMyTurn || canUndoAfterFinish;

  if (undoBtn) {
    undoBtn.style.display = "inline-flex";
    undoBtn.disabled = humanMovesCount === 0;
  }
  if (promptText) {
    promptText.textContent = canUndoAfterFinish
      ? "Match finished — Undo your last move to continue playing"
      : "Your Turn — Click any empty intersection to place your stone";
  }

  bar.classList.toggle("active", showBar);
  bar.style.display = showBar ? "flex" : "none";
}

function updateTurnBanner() {
  const dot = document.getElementById("turn-dot");
  const text = document.getElementById("turn-text");
  if (!dot || !text) return;

  if (isReplayMode) {
    dot.style.background = "#94a3b8";
    text.textContent = `Replay ${replayIndex} / ${replayMoves.length}`;
    return;
  }

  const bn = gameState.series?.battle_number || gameState.battle_number || 1;
  if (gameState.status === "finished") {
    const placements = gameState.board?.placements || [];
    if (placements.length > 0) {
      const winner = getPlayerMeta(placements[0].player);
      dot.style.background = winner.color;
      text.textContent = `Battle #${bn} · ${winner.name} wins!`;
      if (isMultiplayerActive) updateMultiplayerHudStatus(`Battle finished · ${winner.name} wins!`);
    } else {
      dot.style.background = "#94a3b8";
      text.textContent = `Battle #${bn} · Draw`;
      if (isMultiplayerActive) updateMultiplayerHudStatus(`Battle finished · Draw`);
    }
  } else if (isMultiplayerActive) {
    const currSymbol = gameState.current_player?.symbol;
    const curr = getPlayerMeta(currSymbol);
    dot.style.background = curr.color;
    const moveNum = (gameState.board?.move_count || 0) + 1;
    if (myMultiplayerSymbol && currSymbol === myMultiplayerSymbol) {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · Your Turn!`;
      updateMultiplayerHudStatus(`Your turn! Click empty cell to place stone`);
    } else if (!myMultiplayerSymbol) {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · Spectating (${curr.name})`;
      updateMultiplayerHudStatus(`👁️ Spectating · ${curr.name}'s turn`);
    } else if (curr.type === "human") {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name}'s turn`;
      updateMultiplayerHudStatus(`Waiting for ${curr.name}...`);
    } else {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name} (AI) thinking...`;
      updateMultiplayerHudStatus(`${curr.name} (AI) thinking...`);
    }
  } else if (gameState.is_human_turn) {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color || "#d97706";
    text.textContent = `Battle #${bn} · Your turn!`;
  } else if (gameState.is_thinking) {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color;
    text.textContent = `Battle #${bn} · ${gameState.thinking_player || curr.name} thinking...`;
  } else {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color;
    const moveNum = (gameState.board?.move_count || 0) + 1;
    text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name}`;
  }
}

function updateAutoPlayButton() {
  const btn = document.getElementById("btn-auto");
  if (!btn) return;
  const isPlaying = Boolean(gameState?.is_auto_playing);
  const isFinished = gameState?.status === "finished";
  const hasStarted = (gameState?.board?.move_count || 0) > 0;
  const modeKey = isPlaying ? "pause" : isFinished ? "next" : hasStarted ? "resume" : "battle";

  if (btn.dataset.btnMode === modeKey) return;
  btn.dataset.btnMode = modeKey;

  if (isPlaying) {
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 3h3v10H4V3zm5 0h3v10H9V3z"/></svg><span>Pause</span>`;
    btn.classList.add("btn-active");
  } else if (isFinished) {
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5V2.5z"/></svg><span>Next battle</span>`;
    btn.classList.remove("btn-active");
  } else {
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5V2.5z"/></svg><span>${hasStarted ? "Resume" : "Battle"}</span>`;
    btn.classList.remove("btn-active");
  }
}

function renderLeaderboard() {
  const tbody = document.getElementById("leaderboard-body");
  const badge = document.getElementById("total-battles-badge");
  if (!tbody) return;

  const data = cachedLeaderboard || [];
  const maxPlayerBattles = data.reduce((max, r) => Math.max(max, r.battles_played || 0), 0);
  const storageTotal = (!useBackend() && window.CaroEngine?.ClientStorage?.getTotalBattlesCount)
    ? window.CaroEngine.ClientStorage.getTotalBattlesCount()
    : 0;
  const totalBattles = Math.max(maxPlayerBattles, cachedBattlesCount, storageTotal);
  if (badge) badge.textContent = `${totalBattles} battle${totalBattles !== 1 ? "s" : ""}`;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No matches recorded</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map((r, i) => {
    const meta = PLAYER_COLORS[r.player_type] || { fill: "#94a3b8", name: r.player_type };
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
    const isLeader = i === 0 && totalBattles > 0;
    return `<tr class="${isLeader ? "leader" : ""}">
      <td class="rank-cell">${medal}</td>
      <td><span class="model-dot" style="background:${escapeHtml(meta.fill)}"></span>${escapeHtml(meta.name)}</td>
      <td class="mono"><strong>${escapeHtml(r.total_points)}</strong></td>
      <td class="mono muted">${escapeHtml(r.wins)}</td>
      <td class="mono muted">${escapeHtml(r.avg_placement)}</td>
      <td class="mono muted">${escapeHtml(r.battles_played)}</td>
    </tr>`;
  }).join("");
}

function renderBattleRoster() {
  const el = document.getElementById("battle-roster");
  const bnBadge = document.getElementById("battle-number-badge");
  if (!el || !gameState) return;

  const bn = gameState.series?.battle_number || 1;
  if (bnBadge) bnBadge.textContent = isReplayMode ? "Replay Mode" : `Battle #${bn}`;

  const players = isReplayMode ? replayPlayers : (gameState.players || []);
  const placements = isReplayMode
    ? (replayPlacements || []).filter(pl => !pl.move_number || pl.move_number <= replayIndex)
    : (gameState.board?.placements || []);
  const eliminated = isReplayMode
    ? placements.map(pl => pl.player)
    : (gameState.board?.eliminated_players || []);
  const activeMoves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState.board?.moves || []);
  const current = isReplayMode ? null : gameState.current_player?.symbol;
  const isSpectatorInMp = isMultiplayerActive && !isReplayMode && window.CaroMultiplayer?.myRole === "spectator" && gameState.status !== "finished";

  el.innerHTML = players.map((p, idx) => {
    const meta = getPlayerMeta(p.symbol);
    const placement = placements.find(pl => pl.player === p.symbol);
    const isElim = eliminated.includes(p.symbol);
    const isCurrent = !isReplayMode && current === p.symbol && gameState.status !== "finished";
    const isThinking = !isReplayMode && gameState.is_thinking && isCurrent;
    const isHumanWaiting = !isReplayMode && p.type === "human" && isCurrent && (isMultiplayerActive ? p.symbol === myMultiplayerSymbol : gameState.is_human_turn);

    let statusText = "";
    let statusClass = "";
    if (placement) {
      const rank = placement.rank;
      statusText = rank === 1 ? "🥇 1st" : rank === 2 ? "🥈 2nd" : rank === 3 ? "🥉 3rd" : `${rank}th`;
      statusClass = rank === 1 ? "winner" : "eliminated";
    } else if (isHumanWaiting) {
      statusText = "Your turn!";
      statusClass = "active";
    } else if (isThinking) {
      statusText = "Thinking...";
      statusClass = "thinking";
    } else if (isCurrent) {
      statusText = "Turn";
      statusClass = "active";
    } else if (isElim) {
      statusText = "Out";
      statusClass = "eliminated";
    } else {
      statusText = isReplayMode ? "Replay" : "Waiting";
      statusClass = "";
    }

    const moveCount = activeMoves.filter(m => m.player === p.symbol).length;
    const canRequestTakeover = isSpectatorInMp && idx > 0 && !isElim;
    const takeoverBtn = canRequestTakeover
      ? `<button class="btn btn-xs btn-ghost btn-roster-takeover" data-symbol="${escapeHtml(p.symbol)}" title="Request Host approval to take over this player slot">⚡ Takeover</button>`
      : "";

    return `<div class="roster-slot ${statusClass}" style="--pc: ${escapeHtml(meta.fill)}">
      <div class="roster-ident">
        <span class="roster-dot" style="background: ${escapeHtml(meta.fill)}"></span>
        <span class="roster-name">${escapeHtml(meta.name)}</span>
        <span class="roster-symbol">${escapeHtml(p.symbol)}</span>
      </div>
      <div class="roster-stats">
        ${takeoverBtn}
        <span class="roster-moves">${moveCount} moves</span>
        <span class="roster-status ${statusClass}">${escapeHtml(statusText)}</span>
      </div>
    </div>`;
  }).join("");

  if (isSpectatorInMp) {
    el.querySelectorAll(".btn-roster-takeover").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const sym = e.currentTarget.dataset.symbol;
        if (sym && window.CaroMultiplayer?.requestTakeover) {
          window.CaroMultiplayer.requestTakeover(sym);
        }
      });
    });
  }
}

function renderPlayerLegend() {
  const el = document.getElementById("player-legend");
  const players = isReplayMode ? replayPlayers : gameState?.players;
  if (!el || !players) return;
  el.innerHTML = players.map(p => {
    const meta = getPlayerMeta(p.symbol);
    return `<div class="legend-item"><span class="legend-swatch" style="background:${escapeHtml(meta.fill)}"></span>${escapeHtml(meta.name)} (${escapeHtml(p.symbol)})</div>`;
  }).join("");
}

// ─────────────────────────────────────────
// History Tabs
// ─────────────────────────────────────────
function switchHistoryTab(tab) {
  activeHistoryTab = tab;
  document.getElementById("btn-tab-moves").classList.toggle("active", tab === "moves");
  document.getElementById("btn-tab-battles").classList.toggle("active", tab === "battles");
  document.getElementById("view-moves").classList.toggle("active", tab === "moves");
  document.getElementById("view-battles").classList.toggle("active", tab === "battles");
  if (tab === "battles") fetchBattleHistory();
}

function renderBattleHistory(battles) {
  const tbody = document.getElementById("battles-table-body");
  if (!tbody) return;
  if (!battles || battles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No battles yet</td></tr>`;
    return;
  }
  tbody.innerHTML = battles.map(b => {
    const p = b.placements || [];
    const winner = p.find(x => x.rank === 1);
    const winnerMeta = winner ? (PLAYER_COLORS[winner.type] || { fill: "#94a3b8", name: winner.type }) : null;
    const winnerHtml = winnerMeta ? `<span class="model-dot" style="background:${escapeHtml(winnerMeta.fill)}"></span>${escapeHtml(winnerMeta.name)}` : "Draw";
    const safeBattleId = escapeHtml(b.battle_id);
    return `<tr>
      <td class="mono">#${safeBattleId}</td>
      <td>${winnerHtml}</td>
      <td class="mono muted">${escapeHtml(b.total_moves)}</td>
      <td><button class="btn btn-xs" onclick="startReplay('${safeBattleId}')">Review</button></td>
    </tr>`;
  }).join("");
}

function updateMoveHistory() {
  const list = document.getElementById("move-list");
  const counter = document.getElementById("history-counter");
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves;
  if (!list) return;

  if (counter) {
    const c = moves?.length || 0;
    counter.textContent = `${c} turn${c !== 1 ? "s" : ""}`;
  }

  if (!moves || moves.length === 0) {
    list.innerHTML = `<li class="empty-state">No moves yet.</li>`;
    return;
  }

  list.innerHTML = moves.map(m => {
    const meta = getPlayerMeta(m.player);
    const lat = m.metadata?.latency_ms ? `${m.metadata.latency_ms}ms` : "";
    return `<li class="move-item">
      <span class="mono" style="color: ${escapeHtml(meta.color)}; font-weight: 600;">#${escapeHtml(m.move_number)}</span>
      <span style="font-weight: 600;">${escapeHtml(meta.name)}</span>
      <span class="mono">(${escapeHtml(m.row)}, ${escapeHtml(m.col)})</span>
      <span class="mono muted" style="margin-left: auto;">${escapeHtml(lat)}</span>
    </li>`;
  }).join("");

  list.scrollTop = list.scrollHeight;
}

// ─────────────────────────────────────────
// Camera Controls
// ─────────────────────────────────────────
function zoomCamera(factor) {
  userInteractedWithCamera = true;
  const newZ = Math.max(0.2, Math.min(4.0, camera.zoom * factor));
  camera.x = canvas.width / 2 - (canvas.width / 2 - camera.x) * (newZ / camera.zoom);
  camera.y = canvas.height / 2 - (canvas.height / 2 - camera.y) * (newZ / camera.zoom);
  camera.zoom = newZ;
  renderBoard();
}

function recenterCamera() {
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  renderBoard();
}

function autoScaleCamera(force = false) {
  if (userInteractedWithCamera && !force) return;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves || [];
  if (moves.length === 0) {
    camera.x = canvas.width / 2;
    camera.y = canvas.height / 2;
    camera.zoom = 1.0;
    return;
  }

  if (!force && moves.length === _lastAutoScaleMoveCount) return;
  _lastAutoScaleMoveCount = moves.length;

  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const m of moves) {
    if (m.row < minR) minR = m.row;
    if (m.row > maxR) maxR = m.row;
    if (m.col < minC) minC = m.col;
    if (m.col > maxC) maxC = m.col;
  }

  const pad = 3;
  minR -= pad; maxR += pad; minC -= pad; maxC += pad;
  const spanR = Math.max(12, maxR - minR + 1), spanC = Math.max(12, maxC - minC + 1);
  const targetZoom = Math.max(0.4, Math.min(1.4, Math.min(canvas.width / (spanC * camera.baseCellSize), canvas.height / (spanR * camera.baseCellSize))));

  const centerR = (minR + maxR) / 2, centerC = (minC + maxC) / 2;
  const targetX = canvas.width / 2 - centerC * camera.baseCellSize * targetZoom;
  const targetY = canvas.height / 2 - centerR * camera.baseCellSize * targetZoom;

  if (force) {
    camera.zoom = targetZoom;
    camera.x = targetX;
    camera.y = targetY;
  } else {
    camera.zoom += (targetZoom - camera.zoom) * 0.15;
    camera.x += (targetX - camera.x) * 0.15;
    camera.y += (targetY - camera.y) * 0.15;
  }
}

function boardToScreen(r, c) { const cs = camera.baseCellSize * camera.zoom; return { x: camera.x + c * cs, y: camera.y + r * cs }; }
function screenToBoard(sx, sy) { const cs = camera.baseCellSize * camera.zoom; return { r: Math.round((sy - camera.y) / cs) || 0, c: Math.round((sx - camera.x) / cs) || 0 }; }

function onMouseDown(e) {
  if (e.button === 0) {
    isDragging = true; hasDragged = false;
    dragStartX = e.clientX; dragStartY = e.clientY;
    camStartX = camera.x; camStartY = camera.y;
    canvas.style.cursor = "grabbing";
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect(), scX = canvas.width / rect.width, scY = canvas.height / rect.height;
  const sx = (e.clientX - rect.left) * scX, sy = (e.clientY - rect.top) * scY;

  if (isDragging) {
    const dx = (e.clientX - dragStartX) * scX, dy = (e.clientY - dragStartY) * scY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { hasDragged = true; userInteractedWithCamera = true; }
    camera.x = camStartX + dx; camera.y = camStartY + dy;
    renderBoard();
  } else {
    if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) {
      hoverCoord = screenToBoard(sx, sy);
      const isAllowedToMove = isLocalHumanAllowedToMove();

      canvas.style.cursor = isAllowedToMove ? "pointer" : "crosshair";

      // Tactical Ghost HUD tooltip for human turn
      const hud = document.getElementById("ghost-hud");
      if (isAllowedToMove && hud && window.CaroEngine?.TacticalEvaluator) {
        const moves = gameState?.board?.moves || [];
        const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
        if (!occupied) {
          const boardObj = (!useBackend() && clientEngine) ? clientEngine.board : reconstructBoardFromState(gameState);
          if (boardObj) {
            const humanSymbol = isMultiplayerActive ? myMultiplayerSymbol : (gameState.players.find(p => p.type === "human")?.symbol || "E");
            let sumR = 0, sumC = 0;
            for (const key of boardObj.stones.keys()) {
              const [kr, kc] = key.split(",").map(Number);
              sumR += kr; sumC += kc;
            }
            const centroid = boardObj.stones.size ? [sumR / boardObj.stones.size, sumC / boardObj.stones.size] : [0, 0];
            const evalRes = window.CaroEngine.TacticalEvaluator.evaluateMove(boardObj, hoverCoord.r, hoverCoord.c, humanSymbol, centroid);

            const scoreText = evalRes.total_score >= 20000 ? "🔥 WIN / BLOCK" : `Score: ${evalRes.total_score}`;
            hud.innerHTML = `<span class="score-badge">${escapeHtml(scoreText)}</span> ${escapeHtml(evalRes.summary)}`;
            hud.style.display = "block";
            hud.style.left = `${e.clientX - rect.left}px`;
            hud.style.top = `${e.clientY - rect.top}px`;
          }
        } else {
          hud.style.display = "none";
        }
      }
    } else {
      hoverCoord = null;
      const hud = document.getElementById("ghost-hud");
      if (hud) hud.style.display = "none";
    }
    renderBoard();
  }
}

function onMouseUp(e) {
  if (isDragging) {
    isDragging = false;
    const isAllowedToMove = isLocalHumanAllowedToMove();

    canvas.style.cursor = isAllowedToMove ? "pointer" : "crosshair";

    if (!hasDragged && !isReplayMode && isAllowedToMove) {
      const rect = canvas.getBoundingClientRect();
      const scX = canvas.width / rect.width, scY = canvas.height / rect.height;
      const sx = (e.clientX - rect.left) * scX, sy = (e.clientY - rect.top) * scY;
      if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) {
        const coord = screenToBoard(sx, sy);
        const moves = gameState?.board?.moves || [];
        const occupied = moves.some(m => m.row === coord.r && m.col === coord.c);
        if (!occupied) {
          sendHumanMove(coord.r, coord.c);
        }
      }
    }
  }
}

function onWheel(e) {
  e.preventDefault(); userInteractedWithCamera = true;
  const rect = canvas.getBoundingClientRect(), scX = canvas.width / rect.width, scY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scX, my = (e.clientY - rect.top) * scY;
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  const newZ = Math.max(0.2, Math.min(4.0, camera.zoom * factor));
  camera.x = mx - (mx - camera.x) * (newZ / camera.zoom);
  camera.y = my - (my - camera.y) * (newZ / camera.zoom);
  camera.zoom = newZ;
  hoverCoord = screenToBoard(mx, my);
  renderBoard();
}

// ─────────────────────────────────────────
// Board Rendering & Threat Heatmap
// ─────────────────────────────────────────
let _cachedEvalState = { key: null, boardObj: null, heatmap: null, threatLines: null };

function reconstructBoardFromState(state) {
  if (!window.CaroEngine?.CaroBoard || !state?.board) return null;
  const symbols = (state.players || []).map(p => p.symbol);
  const b = new window.CaroEngine.CaroBoard(symbols);
  for (const m of (state.board.moves || [])) {
    b.makeMove(m.row, m.col, m.player, m.metadata);
  }
  return b;
}

function getBoardEvalCache() {
  if (!window.CaroEngine?.TacticalEvaluator || !gameState?.board) return null;
  const moves = gameState.board.moves || [];
  const lastMove = moves.length ? moves[moves.length - 1] : null;
  const currentSymbol = gameState.board.current_player || "A";
  const key = `${gameState.game_id || ""}:${moves.length}:${lastMove ? `${lastMove.row},${lastMove.col}` : ""}:${currentSymbol}`;
  if (_cachedEvalState.key !== key) {
    const boardObj = (!useBackend() && clientEngine) ? clientEngine.board : reconstructBoardFromState(gameState);
    const heatmap = (boardObj && boardObj.stones.size > 0)
      ? window.CaroEngine.TacticalEvaluator.getThreatHeatmap(boardObj, currentSymbol)
      : [];
    const threatLines = (boardObj && boardObj.stones.size >= 2)
      ? window.CaroEngine.TacticalEvaluator.findThreatLines(boardObj)
      : [];
    _cachedEvalState = { key, boardObj, heatmap, threatLines };
  }
  return _cachedEvalState;
}

function drawThreatHeatmap(cs) {
  const evalCache = getBoardEvalCache();
  const heatmap = evalCache?.heatmap;
  if (!heatmap || heatmap.length === 0) return;

  const now = Date.now();
  const pulse = (Math.sin(now / 180) + 1) / 2;

  ctx.save();
  for (const h of heatmap) {
    const pt = boardToScreen(h.row, h.col);
    const radius = cs * (0.55 + h.intensity * 0.45);
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);

    if (h.isWinThreat) {
      grad.addColorStop(0, `rgba(239, 68, 68, ${0.85 + pulse * 0.15})`);
      grad.addColorStop(0.40, "rgba(244, 63, 94, 0.55)");
      grad.addColorStop(0.75, "rgba(249, 115, 22, 0.25)");
      grad.addColorStop(1, "rgba(239, 68, 68, 0)");
    } else if (h.isLethal) {
      grad.addColorStop(0, `rgba(249, 115, 22, ${0.80 + pulse * 0.15})`);
      grad.addColorStop(0.45, "rgba(234, 179, 8, 0.50)");
      grad.addColorStop(0.80, "rgba(245, 158, 11, 0.20)");
      grad.addColorStop(1, "rgba(249, 115, 22, 0)");
    } else {
      // Warm solar gold / electric amber
      grad.addColorStop(0, `rgba(251, 191, 36, ${0.70 + pulse * 0.15})`);
      grad.addColorStop(0.50, "rgba(245, 158, 11, 0.35)");
      grad.addColorStop(0.85, "rgba(251, 191, 36, 0.12)");
      grad.addColorStop(1, "rgba(251, 191, 36, 0)");
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Hotspot border corner brackets for tactical arena feel
    const bSize = cs * 0.42;
    ctx.strokeStyle = h.isWinThreat
      ? `rgba(239, 68, 68, ${0.6 + pulse * 0.3})`
      : h.isLethal
        ? `rgba(249, 115, 22, ${0.5 + pulse * 0.3})`
        : `rgba(245, 158, 11, ${0.4 + pulse * 0.2})`;
    ctx.lineWidth = 1.4 * camera.zoom;
    const tick = cs * 0.14;
    ctx.beginPath();
    // Top-left
    ctx.moveTo(pt.x - bSize, pt.y - bSize + tick); ctx.lineTo(pt.x - bSize, pt.y - bSize); ctx.lineTo(pt.x - bSize + tick, pt.y - bSize);
    // Top-right
    ctx.moveTo(pt.x + bSize - tick, pt.y - bSize); ctx.lineTo(pt.x + bSize, pt.y - bSize); ctx.lineTo(pt.x + bSize, pt.y - bSize + tick);
    // Bottom-left
    ctx.moveTo(pt.x - bSize, pt.y + bSize - tick); ctx.lineTo(pt.x - bSize, pt.y + bSize); ctx.lineTo(pt.x - bSize + tick, pt.y + bSize);
    // Bottom-right
    ctx.moveTo(pt.x + bSize - tick, pt.y + bSize); ctx.lineTo(pt.x + bSize, pt.y + bSize); ctx.lineTo(pt.x + bSize, pt.y + bSize - tick);
    ctx.stroke();

    // Prominent tactical reticle on #1 hottest tension hotspot
    if (h.rank === 1) {
      ctx.save();
      const strokeCol = h.isWinThreat ? `rgba(239, 68, 68, ${0.85 + pulse * 0.15})` : `rgba(245, 158, 11, ${0.85 + pulse * 0.15})`;
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2.0 * camera.zoom;
      const arm = cs * 0.40;
      // Crosshair lines
      ctx.beginPath();
      ctx.moveTo(pt.x - arm, pt.y); ctx.lineTo(pt.x - cs * 0.15, pt.y);
      ctx.moveTo(pt.x + cs * 0.15, pt.y); ctx.lineTo(pt.x + arm, pt.y);
      ctx.moveTo(pt.x, pt.y - arm); ctx.lineTo(pt.x, pt.y - cs * 0.15);
      ctx.moveTo(pt.x, pt.y + cs * 0.15); ctx.lineTo(pt.x, pt.y + arm);
      ctx.stroke();

      // Outer focus ring
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, cs * (0.32 + pulse * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawActiveThreatLasers(cs) {
  const evalCache = getBoardEvalCache();
  const threatLines = evalCache?.threatLines;
  if (!threatLines || threatLines.length === 0) return;

  const now = Date.now();
  const pulse = (Math.sin(now / 150) + 1) / 2;
  const fastPulse = (Math.sin(now / 70) + 1) / 2;

  ctx.save();
  for (const t of threatLines) {
    if (!t.line || t.line.length < 2) continue;
    const meta = getPlayerMeta(t.player);
    const color = meta.color || "#06b6d4";
    const isCritical = t.severity === "critical";
    const isWarning = t.severity === "warning";
    const isTactical = t.severity === "tactical";

    const pFirst = boardToScreen(t.line[0][0], t.line[0][1]);
    const pLast = boardToScreen(t.line[t.line.length - 1][0], t.line[t.line.length - 1][1]);

    // 1. Draw glowing laser beam through the stones in this line
    ctx.save();
    ctx.lineCap = "round";

    // Outer Neon Glow
    ctx.shadowColor = color;
    const blur = isCritical ? (18 + fastPulse * 10) : isWarning ? (12 + pulse * 6) : 6;
    ctx.shadowBlur = blur * camera.zoom;
    ctx.strokeStyle = color;
    const lineW = isCritical ? 5.5 : isWarning ? 3.5 : 2.2;
    ctx.lineWidth = lineW * camera.zoom;
    ctx.globalAlpha = isCritical ? 0.95 : isWarning ? 0.80 : 0.60;
    ctx.beginPath();
    ctx.moveTo(pFirst.x, pFirst.y);
    ctx.lineTo(pLast.x, pLast.y);
    ctx.stroke();

    // Inner White-Hot Energy Core (for 3+ stone lines)
    if (!isTactical) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = (isCritical ? 2.2 : 1.4) * camera.zoom;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(pFirst.x, pFirst.y);
      ctx.lineTo(pLast.x, pLast.y);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Pulse energy rings around each stone in the active line
    for (const [sr, sc] of t.line) {
      const sp = boardToScreen(sr, sc);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = (isCritical ? 2.2 : 1.4) * camera.zoom;
      ctx.globalAlpha = isCritical ? (0.65 + fastPulse * 0.35) : isWarning ? (0.50 + pulse * 0.25) : 0.35;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, cs * (0.42 + (isCritical ? fastPulse : pulse) * 0.05), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Projected Strike Laser into open attack targets (empty cells)
    if (t.targets && t.targets.length > 0) {
      for (const [tr, tc] of t.targets) {
        const tp = boardToScreen(tr, tc);
        const dFirst = Math.hypot(tp.x - pFirst.x, tp.y - pFirst.y);
        const dLast = Math.hypot(tp.x - pLast.x, tp.y - pLast.y);
        const origin = dFirst < dLast ? pFirst : pLast;

        ctx.save();
        ctx.setLineDash(isTactical ? [3 * camera.zoom, 3 * camera.zoom] : [5 * camera.zoom, 4 * camera.zoom]);
        ctx.strokeStyle = isCritical ? `rgba(239, 68, 68, ${0.85 + fastPulse * 0.15})` : color;
        ctx.lineWidth = (isCritical ? 2.6 : isWarning ? 1.6 : 1.0) * camera.zoom;
        ctx.globalAlpha = isTactical ? 0.45 : 0.85;
        if (!isTactical) {
          ctx.shadowColor = isCritical ? "#ef4444" : color;
          ctx.shadowBlur = 8 * camera.zoom;
        }
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!isTactical) {
          const targetRadius = cs * (isCritical ? (0.34 + fastPulse * 0.08) : (0.24 + pulse * 0.05));
          ctx.strokeStyle = isCritical ? "#ef4444" : color;
          ctx.lineWidth = (isCritical ? 2.2 : 1.4) * camera.zoom;
          ctx.beginPath();
          ctx.moveTo(tp.x, tp.y - targetRadius);
          ctx.lineTo(tp.x + targetRadius, tp.y);
          ctx.lineTo(tp.x, tp.y + targetRadius);
          ctx.lineTo(tp.x - targetRadius, tp.y);
          ctx.closePath();
          ctx.stroke();

          if (isCritical) {
            ctx.fillStyle = "#ef4444";
            ctx.beginPath();
            ctx.arc(tp.x, tp.y, 2.5 * camera.zoom, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

let fxAnimId = null;
function startFxAnimation() {
  if (fxAnimId) return;
  function fxLoop() {
    if (showHeatmap || showLasers || (hoverCoord && isLocalHumanAllowedToMove())) {
      renderBoard();
      fxAnimId = requestAnimationFrame(fxLoop);
    } else {
      fxAnimId = null;
    }
  }
  fxAnimId = requestAnimationFrame(fxLoop);
}

function renderBoard() {
  autoScaleCamera();
  const W = canvas.width, H = canvas.height, cs = camera.baseCellSize * camera.zoom;

  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.85);
  grad.addColorStop(0, "#f9dfb0");
  grad.addColorStop(0.6, "#ecc483");
  grad.addColorStop(1, "#dba65a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const minC = Math.floor(-camera.x / cs) - 1, maxC = Math.ceil((W - camera.x) / cs) + 1;
  const minR = Math.floor(-camera.y / cs) - 1, maxR = Math.ceil((H - camera.y) / cs) + 1;
  ctx.strokeStyle = "rgba(70, 38, 14, 0.68)";
  ctx.lineWidth = Math.max(1, 1.1 * camera.zoom);
  for (let r = minR; r <= maxR; r++) { const y = camera.y + r * cs; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let c = minC; c <= maxC; c++) { const x = camera.x + c * cs; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

  // Hoshi star points
  if (camera.zoom > 0.35) {
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      if (r % 4 === 0 && c % 4 === 0) {
        const pt = boardToScreen(r, c);
        ctx.fillStyle = "rgba(55, 28, 10, 0.82)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (r === 0 && c === 0 ? 3.4 : 2.2) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Origin marker
  const o = boardToScreen(0, 0);
  ctx.strokeStyle = "rgba(55, 28, 10, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(o.x - 6, o.y); ctx.lineTo(o.x + 6, o.y); ctx.moveTo(o.x, o.y - 6); ctx.lineTo(o.x, o.y + 6); ctx.stroke();

  // Coordinates
  if (showCoords && camera.zoom >= 0.5) {
    ctx.fillStyle = "rgba(80, 48, 20, 0.55)";
    ctx.font = `600 ${Math.round(9 * Math.min(1.3, Math.max(0.8, camera.zoom)))}px var(--font-mono, monospace)`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const step = camera.zoom > 0.85 ? 2 : 4;
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      if (r % step === 0 && c % step === 0) { const pt = boardToScreen(r, c); ctx.fillText(`${r},${c}`, pt.x + 12 * camera.zoom, pt.y - 8 * camera.zoom); }
    }
  }

  // Live Threat Heatmap Layer (renders beneath stones)
  if (showHeatmap && !isReplayMode && gameState?.board) {
    drawThreatHeatmap(cs);
  }

  // Draw stones
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves || [];
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  moves.forEach(m => drawStone(m.row, m.col, m.player, cs, m.move_number));

  // Live Threat Lasers (renders dynamic active threat beams over stones)
  if (showLasers && !isReplayMode && gameState?.board) {
    drawActiveThreatLasers(cs);
  }

  // Human hover ghost with alignment guide crosshair
  if (hoverCoord && isLocalHumanAllowedToMove()) {
    const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
    if (!occupied) {
      const pt = boardToScreen(hoverCoord.r, hoverCoord.c);
      const ghostSymbol = isMultiplayerActive ? myMultiplayerSymbol : gameState?.current_player?.symbol;
      const ghostMeta = getPlayerMeta(ghostSymbol);
      const ghostColor = ghostMeta.color || "#d97706";
      ctx.save();
      // Thin alignment guides
      ctx.strokeStyle = "rgba(217, 119, 6, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pt.x, 0); ctx.lineTo(pt.x, H);
      ctx.moveTo(0, pt.y); ctx.lineTo(W, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ghost stone
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = ghostColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, cs * 0.40, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing outer ring
      const pulseTime = Date.now() / 200;
      const ringRadius = cs * (0.42 + Math.sin(pulseTime) * 0.05);
      ctx.strokeStyle = ghostColor;
      ctx.lineWidth = 2 * camera.zoom;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Last move ring
  if (lastMove) {
    const pt = boardToScreen(lastMove.row, lastMove.col);
    const meta = getPlayerMeta(lastMove.player);
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2.2 * camera.zoom;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, cs * 0.46, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y - cs * 0.46, 2 * camera.zoom, 0, Math.PI * 2); ctx.fill();
  }

  // Winning lines & highlights — draw for ALL placements with a winning line
  let placements = [];
  if (isReplayMode) {
    placements = (replayPlacements || []).filter(pl => !pl.move_number || pl.move_number <= replayIndex);
  } else {
    placements = gameState?.board?.placements || [];
  }

  for (const pl of placements) {
    if (pl.winning_line && pl.winning_line.length >= 2) {
      const symbol = pl.symbol || pl.player;
      const meta = getPlayerMeta(symbol);

      // 1. Highlight each stone in the winning line with bright glowing golden halo
      for (const [wr, wc] of pl.winning_line) {
        const pt = boardToScreen(wr, wc);
        ctx.save();
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 15 * camera.zoom;
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 3.5 * camera.zoom;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, cs * 0.48, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 1.6 * camera.zoom;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, cs * 0.44, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Bold, high-contrast laser strike-through line
      if (showLasers) {
        const firstCoord = pl.winning_line[0];
        const lastCoord = pl.winning_line[pl.winning_line.length - 1];
        const p1 = boardToScreen(firstCoord[0], firstCoord[1]);
        const p2 = boardToScreen(lastCoord[0], lastCoord[1]);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const extend = cs * 0.55;
        const startX = p1.x - Math.cos(angle) * extend;
        const startY = p1.y - Math.sin(angle) * extend;
        const endX = p2.x + Math.cos(angle) * extend;
        const endY = p2.y + Math.sin(angle) * extend;

        // Outer glow beam (Golden Amber)
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
        ctx.lineWidth = 9.0 * camera.zoom;
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 18 * camera.zoom;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Middle model-tinted beam
        ctx.strokeStyle = meta.color || "#fff";
        ctx.lineWidth = 5.0 * camera.zoom;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Core bright laser white beam
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5 * camera.zoom;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Floating Winner Badge above the winning row with rank-based offsets
      const midCoord = pl.winning_line[Math.floor(pl.winning_line.length / 2)];
      const midPt = boardToScreen(midCoord[0], midCoord[1]);
      const rank = pl.rank || 1;
      // Stagger vertical offsets and slight horizontal displacement by rank to prevent any collision
      const yOffsets = { 1: -0.80, 2: 0.85, 3: -1.55, 4: 1.55, 5: -2.3 };
      const xOffsets = { 1: 0, 2: 8 * camera.zoom, 3: -12 * camera.zoom, 4: 14 * camera.zoom, 5: 0 };
      const badgeY = midPt.y + (yOffsets[rank] || -0.80) * cs;
      const badgeX = midPt.x + (xOffsets[rank] || 0);
      const lineLen = pl.winning_line.length;
      const rankText = pl.rank === 1 ? `🥇 ${meta.name} · ${lineLen} in a row` : `#${pl.rank} ${meta.name} · ${lineLen} in a row`;

      ctx.save();
      ctx.font = `700 ${Math.max(10, Math.round(11 * camera.zoom))}px var(--font-sans, sans-serif)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const metrics = ctx.measureText(rankText);
      const bgW = metrics.width + Math.max(14, 18 * camera.zoom);
      const bgH = Math.max(18, Math.round(22 * camera.zoom));

      // Badge pill background
      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(badgeX - bgW / 2, badgeY - bgH / 2, bgW, bgH, 999);
      } else {
        ctx.rect(badgeX - bgW / 2, badgeY - bgH / 2, bgW, bgH);
      }
      ctx.fill();

      // Badge border with winner color
      ctx.strokeStyle = meta.color || "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(badgeX - bgW / 2, badgeY - bgH / 2, bgW, bgH, 999);
      } else {
        ctx.rect(badgeX - bgW / 2, badgeY - bgH / 2, bgW, bgH);
      }
      ctx.stroke();

      // Badge text
      ctx.fillStyle = "#ffffff";
      ctx.shadowBlur = 0;
      ctx.fillText(rankText, badgeX, badgeY);
      ctx.restore();
    }
  }
}

function drawStone(r, c, symbol, cs, moveNumber) {
  const pt = boardToScreen(r, c);
  const radius = cs * 0.42;
  const meta = getPlayerMeta(symbol);
  const body = meta.body || STONE_STYLES.laya.body;
  const textCol = meta.text || "#fff";

  ctx.save();
  ctx.shadowColor = "rgba(60, 30, 10, 0.35)";
  ctx.shadowBlur = 5 * camera.zoom;
  ctx.shadowOffsetX = 1.2 * camera.zoom;
  ctx.shadowOffsetY = 2.4 * camera.zoom;

  const stoneGrad = ctx.createRadialGradient(
    pt.x - radius * 0.35, pt.y - radius * 0.35, radius * 0.08,
    pt.x, pt.y, radius
  );
  stoneGrad.addColorStop(0, body[2]);
  stoneGrad.addColorStop(0.6, body[1]);
  stoneGrad.addColorStop(1, body[0]);
  ctx.fillStyle = stoneGrad;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
  ctx.fill();

  const sheen = ctx.createRadialGradient(
    pt.x - radius * 0.35, pt.y - radius * 0.35, 1,
    pt.x - radius * 0.35, pt.y - radius * 0.35, radius * 0.55
  );
  sheen.addColorStop(0, "rgba(255,255,255,0.32)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2); ctx.fill();

  ctx.restore();

  if (showMoveNumbers && moveNumber !== null && camera.zoom > 0.38) {
    ctx.fillStyle = textCol;
    ctx.font = `600 ${Math.round(radius * 0.72)}px var(--font-sans, sans-serif)`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(moveNumber.toString(), pt.x, pt.y);
  }
}

// ─────────────────────────────────────────
// Replay System & Stateless Shareable Links
// ─────────────────────────────────────────
function encodeReplayPayload(players, moves, placements) {
  const compact = {
    p: (players || []).map(p => [p.symbol, p.type, p.name || p.type]),
    m: (moves || []).map(m => [m.row, m.col, m.player, m.move_number]),
    w: (placements || []).map(pl => [
      pl.player || pl.symbol,
      pl.rank,
      pl.move_number || null,
      pl.winning_line || null,
      pl.type || "",
      pl.name || ""
    ])
  };
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeReplayPayload(encoded) {
  const b64 = String(encoded || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const compact = JSON.parse(new TextDecoder().decode(bytes));
  return {
    player_order: (compact.p || []).map(([symbol, type, name]) => ({ symbol, type, name })),
    moves_data: (compact.m || []).map(([row, col, player, move_number], idx) => ({
      row: Number(row) || 0,
      col: Number(col) || 0,
      player,
      move_number: move_number || (idx + 1)
    })),
    placements: (compact.w || []).map(([player, rank, move_number, winning_line, type, name]) => ({
      player,
      symbol: player,
      rank: Number(rank) || 1,
      move_number: move_number || null,
      winning_line: Array.isArray(winning_line) ? winning_line : null,
      type: type || "unknown",
      name: name || player
    }))
  };
}

function applyReplayBattleObject(b) {
  if (!b) return false;
  isReplayMode = true;
  replayMoves = b.moves_data || [];
  replayPlayers = b.player_order || [];
  replayPlacements = b.placements || [];
  replayIndex = replayMoves.length;

  symbolMap = {};
  for (const p of replayPlayers) {
    symbolMap[p.symbol] = p;
  }

  const lbl = document.getElementById("replay-label");
  if (lbl) lbl.textContent = `Move ${replayIndex} of ${replayMoves.length}`;
  const bar = document.getElementById("replay-bar");
  if (bar) bar.style.display = "flex";
  const autoBtn = document.getElementById("btn-auto");
  if (autoBtn) autoBtn.disabled = true;
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  updateUI();
  return true;
}

async function startReplay(battleId) {
  try {
    if (gameState?.is_auto_playing && !isMultiplayerActive) await toggleAutoPlay();
    let b = null;
    if (useBackend()) {
      const r = await apiFetch(`/api/battles/${encodeURIComponent(battleId)}`);
      if (r.ok) b = await r.json();
    } else if (window.CaroEngine) {
      const storage = window.CaroEngine.ClientStorage;
      const battles = storage.getBattles();
      b = battles.find(x => x.battle_id === battleId);
      if (!b && storage.fetchBattleByIdFromSupabase) {
        b = await storage.fetchBattleByIdFromSupabase(battleId);
      }
    }
    if (!b) return;
    applyReplayBattleObject(b);
  } catch {}
}

function startReplayFromData(encoded) {
  try {
    const b = decodeReplayPayload(encoded);
    if (!b || !Array.isArray(b.moves_data)) return false;
    return applyReplayBattleObject(b);
  } catch (err) {
    console.warn("Invalid replay_data parameter:", err);
    return false;
  }
}

function getShareReplayUrl() {
  const players = isReplayMode ? replayPlayers : (gameState?.players || []);
  const moves = isReplayMode ? replayMoves : (gameState?.board?.moves || []);
  const placements = isReplayMode ? replayPlacements : (gameState?.board?.placements || []);
  const encoded = encodeReplayPayload(players, moves, placements);
  return `${window.location.origin}${window.location.pathname}?replay_data=${encoded}`;
}

function shareCurrentReplay() {
  const url = getShareReplayUrl();
  const btn = document.getElementById("btn-share-replay");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).catch(() => {});
  }
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
  return url;
}

window.encodeReplayPayload = encodeReplayPayload;
window.decodeReplayPayload = decodeReplayPayload;
window.getShareReplayUrl = getShareReplayUrl;
window.shareCurrentReplay = shareCurrentReplay;

function exitReplayMode() {
  isReplayMode = false;
  replayMoves = [];
  replayIndex = 0;
  replayPlayers = [];
  replayPlacements = [];
  document.getElementById("replay-bar").style.display = "none";
  document.getElementById("btn-auto").disabled = false;
  userInteractedWithCamera = false;
  rebuildSymbolMap();
  autoScaleCamera(true);
  fetchState();
}

function stepReplay(delta) {
  if (!isReplayMode) return;
  replayIndex = Math.max(0, Math.min(replayMoves.length, replayIndex + delta));
  const lbl = document.getElementById("replay-label");
  if (lbl) lbl.textContent = `Move ${replayIndex} of ${replayMoves.length}`;
  updateUI();
}

// ─────────────────────────────────────────
// Arena Config & Storage
// ─────────────────────────────────────────
function loadSandboxConfig() {
  try {
    const saved = localStorage.getItem("caro_sandbox_config");
    if (saved) {
      const cfg = JSON.parse(saved);
      window.CaroSandboxConfig = Object.assign(window.CaroSandboxConfig, cfg);
    }
  } catch {}
  // Always lock to fastest blitz speed (10ms)
  window.CaroSandboxConfig.delaySec = 0.01;
}

function saveSandboxConfig() {
  try {
    localStorage.setItem("caro_sandbox_config", JSON.stringify(window.CaroSandboxConfig));
  } catch {}
}

// ─────────────────────────────────────────
// Lightweight Canvas Confetti Engine
// ─────────────────────────────────────────
class ConfettiEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.animId = null;
  }

  launch(durationMs = 4000) {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = "block";
    this.particles = [];
    const colors = ["#fbbf24", "#0891b2", "#7c3aed", "#e11d48", "#10b981", "#f59e0b", "#ec4899"];

    for (let i = 0; i < 150; i++) {
      this.particles.push({
        x: this.canvas.width / 2 + (Math.random() - 0.5) * 180,
        y: this.canvas.height / 2 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 18,
        vy: -Math.random() * 15 - 5,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 12,
        life: 1.0,
        decay: Math.random() * 0.007 + 0.004
      });
    }

    const start = performance.now();
    const frame = (now) => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      let alive = 0;
      for (const p of this.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38;
        p.rotation += p.vRot;
        p.life -= p.decay;

        if (p.life > 0 && p.y < this.canvas.height + 25) {
          alive++;
          this.ctx.save();
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate((p.rotation * Math.PI) / 180);
          this.ctx.globalAlpha = Math.max(0, p.life);
          this.ctx.fillStyle = p.color;
          this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
          this.ctx.restore();
        }
      }

      if (alive > 0 && now - start < durationMs) {
        this.animId = requestAnimationFrame(frame);
      } else {
        this.canvas.style.display = "none";
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(frame);
  }
}

// ─────────────────────────────────────────
// Multiplayer Integration (Supabase Realtime)
// ─────────────────────────────────────────
let isMultiplayerActive = false;
let myMultiplayerSymbol = null;
let multiplayerRoster = [];
let mpTurnTimerInterval = null;
let mpTurnTimerKey = null;
let mpTurnDeadline = 0;
let mpTurnAutoPlayedKey = null;

function initMultiplayerIntegration() {
  if (!window.CaroMultiplayer) return;

  window.CaroMultiplayer.setCallbacks({
    onLobbyChange: handleMultiplayerLobbyUpdate,
    onActiveRoomsChange: renderActiveRoomsLobby,
    onRequestsChange: handleMultiplayerRequestsUpdate,
    onSlotTakeover: handleMultiplayerSlotTakeover,
    onGameStart: handleMultiplayerGameStart,
    onRemoteMove: handleMultiplayerRemoteMove,
    onRemoteNextBattle: handleMultiplayerRemoteNextBattle,
    onRoomLeave: handleMultiplayerRoomLeave,
    onStateSync: handleMultiplayerStateSync,
    onHostMigrated: handleMultiplayerHostMigrated,
    getHostState: getMultiplayerHostState,
    onStatusMessage: (msg) => {
      updateMultiplayerHudStatus(msg);
    }
  });

  setupMultiplayerUI();
  setupAuthUI();
  checkUrlForRoomInvite();
}

function getMultiplayerHostState() {
  if (!isMultiplayerActive || !clientEngine) return null;
  return {
    inGame: true,
    roomId: window.CaroMultiplayer?.roomId,
    roomName: window.CaroMultiplayer?.roomName,
    roster: multiplayerRoster,
    battleNumber: clientEngine.battleNumber || 1,
    status: clientEngine.status || "playing",
    moves: (clientEngine.board?.moves || []).map(m => ({
      row: m.row,
      col: m.col,
      player: m.player,
      move_number: m.move_number,
      metadata: m.metadata
    }))
  };
}

function setupMultiplayerUI() {
  const btnMp = document.getElementById("btn-multiplayer");
  const modal = document.getElementById("modal-multiplayer");
  const btnClose = document.getElementById("btn-close-mp-modal");
  const btnCreateRoom = document.getElementById("btn-action-create-room");
  const btnStartMp = document.getElementById("btn-action-start-mp");
  const btnJoinRoom = document.getElementById("btn-action-join-room");
  const btnCopyInvite = document.getElementById("btn-copy-invite-link");
  const btnHudCopy = document.getElementById("btn-hud-copy-link");
  const btnHudLeave = document.getElementById("btn-hud-leave-room");
  const btnHudRoomDrawer = document.getElementById("btn-mp-hud-room-drawer");
  const btnHudRequestJoin = document.getElementById("btn-mp-hud-request-join");
  const btnModalRequestJoin = document.getElementById("btn-mp-request-join");
  const btnAddHuman = document.getElementById("btn-mp-add-human");
  const btnAddAi = document.getElementById("btn-mp-add-ai");
  const btnRefreshRooms = document.getElementById("btn-mp-refresh-rooms");
  const btnNewRoomFromLobby = document.getElementById("btn-mp-new-room-from-lobby");

  // Tabs
  const tabLobby = document.getElementById("mp-tab-btn-lobby");
  const tabCreate = document.getElementById("mp-tab-btn-create");
  const tabJoin = document.getElementById("mp-tab-btn-join");

  btnMp?.addEventListener("click", () => {
    const defaultTab = window.CaroMultiplayer?.roomId ? "create" : "lobby";
    openMultiplayerModal(defaultTab);
  });
  btnClose?.addEventListener("click", () => closeMultiplayerModal());
  btnHudRoomDrawer?.addEventListener("click", () => openMultiplayerModal("create"));
  btnHudRequestJoin?.addEventListener("click", () => {
    window.CaroMultiplayer?.requestJoinSlot();
  });
  btnModalRequestJoin?.addEventListener("click", () => {
    window.CaroMultiplayer?.requestJoinSlot();
  });

  modal?.addEventListener("click", (e) => {
    if (e.target.id === "modal-multiplayer") closeMultiplayerModal();
  });

  tabLobby?.addEventListener("click", () => switchMpTab("lobby"));
  tabCreate?.addEventListener("click", () => switchMpTab("create"));
  tabJoin?.addEventListener("click", () => switchMpTab("join"));

  btnRefreshRooms?.addEventListener("click", () => {
    window.CaroMultiplayer?.refreshActiveRooms();
    renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  });

  btnNewRoomFromLobby?.addEventListener("click", () => switchMpTab("create"));

  // Sync live room name / public toggle changes when already hosting
  const roomNameInput = document.getElementById("mp-room-name-input");
  const roomPublicToggle = document.getElementById("mp-room-public-toggle");
  const hostNameInput = document.getElementById("mp-host-name-input");

  roomNameInput?.addEventListener("change", () => {
    if (window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
      window.CaroMultiplayer.setRoomMeta({ roomName: roomNameInput.value });
    }
  });
  roomPublicToggle?.addEventListener("change", () => {
    if (window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
      window.CaroMultiplayer.setRoomMeta({ isPublic: roomPublicToggle.checked });
    }
  });
  hostNameInput?.addEventListener("change", () => {
    if (hostNameInput.value.trim() && window.CaroMultiplayer) {
      window.CaroMultiplayer.myName = hostNameInput.value.trim();
    }
  });

  btnAddHuman?.addEventListener("click", () => {
    if (!window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) return;
    window.CaroMultiplayer?.addSlot("human");
  });

  btnAddAi?.addEventListener("click", () => {
    if (!window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) return;
    window.CaroMultiplayer?.addSlot("ai", "von");
  });

  btnCreateRoom?.addEventListener("click", async () => {
    const name = document.getElementById("mp-host-name-input")?.value || window.CaroMultiplayer?.myName || "Host";
    const roomName = document.getElementById("mp-room-name-input")?.value || "";
    const roomSlug = document.getElementById("mp-room-slug-input")?.value || "";
    const isPublic = document.getElementById("mp-room-public-toggle")?.checked ?? true;
    try {
      btnCreateRoom.disabled = true;
      btnCreateRoom.textContent = "Creating...";
      await window.CaroMultiplayer.createRoom(name, { roomName, roomSlug, isPublic });
      btnCreateRoom.disabled = false;
      btnCreateRoom.textContent = "Recreate Room";
      if (btnStartMp) btnStartMp.style.display = "inline-flex";
      const shareBox = document.getElementById("mp-share-box");
      const shareUrl = document.getElementById("mp-share-url");
      if (shareBox) shareBox.style.display = "block";
      if (shareUrl) shareUrl.value = window.CaroMultiplayer.getLobbyState().shareUrl;
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
    } catch (err) {
      alert(err.message);
      btnCreateRoom.disabled = false;
      btnCreateRoom.textContent = "Create New Room";
    }
  });

  btnStartMp?.addEventListener("click", () => {
    try {
      window.CaroMultiplayer.startGame();
    } catch (err) {
      alert(err.message);
    }
  });

  btnJoinRoom?.addEventListener("click", async () => {
    const name = document.getElementById("mp-join-name-input")?.value || window.CaroMultiplayer?.myName || "Player";
    const code = document.getElementById("mp-join-code-input")?.value || "";
    if (!code.trim()) {
      alert("Please enter a room code or custom URL slug.");
      return;
    }
    try {
      btnJoinRoom.disabled = true;
      btnJoinRoom.textContent = "Entering Room...";
      await window.CaroMultiplayer.joinRoom(code, name);
      btnJoinRoom.disabled = false;
      btnJoinRoom.textContent = "Enter Room 👁️";
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
      switchMpTab("create");
    } catch (err) {
      alert(err.message);
      btnJoinRoom.disabled = false;
      btnJoinRoom.textContent = "Enter Room 👁️";
    }
  });

  const copyHandler = (inputElem, btnElem) => {
    const val = inputElem?.value || window.CaroMultiplayer.getLobbyState().shareUrl;
    if (val && navigator.clipboard) {
      navigator.clipboard.writeText(val).then(() => {
        const orig = btnElem.textContent;
        btnElem.textContent = "✓ Copied!";
        setTimeout(() => { btnElem.textContent = orig; }, 2000);
      });
    }
  };

  btnCopyInvite?.addEventListener("click", () => copyHandler(document.getElementById("mp-share-url"), btnCopyInvite));
  btnHudCopy?.addEventListener("click", () => copyHandler(null, btnHudCopy));
  btnHudLeave?.addEventListener("click", () => {
    window.CaroMultiplayer.leaveRoom();
  });
}

function openMultiplayerModal(forceTab = null) {
  const modal = document.getElementById("modal-multiplayer");
  if (!modal) return;
  modal.style.display = "flex";

  // Pre-fill display name from Auth or Multiplayer state
  const currentName = window.CaroAuth?.getCurrentUser()?.display_name || window.CaroMultiplayer?.myName || "Player";
  const hostInput = document.getElementById("mp-host-name-input");
  const joinInput = document.getElementById("mp-join-name-input");
  if (hostInput && (!hostInput.value || hostInput.value === "Player 1")) hostInput.value = currentName;
  if (joinInput && (!joinInput.value || joinInput.value === "Player 2")) joinInput.value = currentName;

  if (forceTab) switchMpTab(forceTab);
  window.CaroMultiplayer?.refreshActiveRooms();
  renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  renderMultiplayerSlots();
  renderSpectatorsAndRequests();
  updateMultiplayerModeBadge();
}

function updateMultiplayerModeBadge() {
  const banner = document.getElementById("mp-mode-banner");
  const text = document.getElementById("mp-mode-banner-text");
  const rolePill = document.getElementById("mp-role-pill");
  if (!banner || !text) return;

  const isOnline = window.CaroMultiplayer && window.CaroMultiplayer.isOnline;
  const lobby = window.CaroMultiplayer ? window.CaroMultiplayer.getLobbyState() : null;
  if (isOnline) {
    banner.className = "mp-mode-banner online";
    text.textContent = lobby?.roomId
      ? `🟢 Room: ${lobby.roomName} (${lobby.roomId})`
      : "🟢 Connected to Caro Arena Live Server";
  } else {
    banner.className = "mp-mode-banner local";
    text.textContent = lobby?.roomId
      ? `⚡ Room: ${lobby.roomName} (${lobby.roomId})`
      : "⚡ Local Multi-tab Realtime Mode";
  }

  if (rolePill) {
    if (!lobby?.roomId) {
      rolePill.textContent = "";
      rolePill.style.display = "none";
    } else {
      rolePill.style.display = "inline-block";
      rolePill.textContent = lobby.isHost
        ? "👑 Host"
        : (lobby.myRole === "player" ? `⚔️ Player #${lobby.myAssignedSlot + 1}` : "👁️ Spectator");
    }
  }
}

function closeMultiplayerModal() {
  const modal = document.getElementById("modal-multiplayer");
  if (modal) modal.style.display = "none";
}

function switchMpTab(tab) {
  const tLobby = document.getElementById("mp-tab-lobby");
  const tCreate = document.getElementById("mp-tab-create");
  const tJoin = document.getElementById("mp-tab-join");
  const bLobby = document.getElementById("mp-tab-btn-lobby");
  const bCreate = document.getElementById("mp-tab-btn-create");
  const bJoin = document.getElementById("mp-tab-btn-join");

  if (tLobby) tLobby.style.display = tab === "lobby" ? "block" : "none";
  if (tCreate) tCreate.style.display = tab === "create" ? "block" : "none";
  if (tJoin) tJoin.style.display = tab === "join" ? "block" : "none";

  bLobby?.classList.toggle("active", tab === "lobby");
  bCreate?.classList.toggle("active", tab === "create");
  bJoin?.classList.toggle("active", tab === "join");

  if (tab === "lobby") {
    window.CaroMultiplayer?.refreshActiveRooms();
    renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  }
}

function renderActiveRoomsLobby(rooms = []) {
  const container = document.getElementById("mp-active-rooms-list");
  if (!container) return;

  if (!Array.isArray(rooms) || rooms.length === 0) {
    container.innerHTML = `<div class="mp-empty-rooms">No public rooms active right now. Click <strong>+ Host Room</strong> to create one!</div>`;
    return;
  }

  container.innerHTML = "";
  rooms.forEach(r => {
    const card = document.createElement("div");
    card.className = "mp-room-card";
    const isPlaying = r.status === "playing";
    const statusText = isPlaying ? `⚔️ Battle #${r.battleNumber || 1}` : `🟢 Waiting`;
    const isMyCurrentRoom = window.CaroMultiplayer?.roomId === r.roomId;

    card.innerHTML = `
      <div>
        <div class="mp-room-card-title">
          <span>${escapeHtml(r.roomName || r.roomId)}</span>
          <span class="mp-slot-badge ${isPlaying ? "" : "ready"}">${escapeHtml(statusText)}</span>
        </div>
        <div class="mp-room-card-meta">
          <span>👑 Host: <strong>${escapeHtml(r.hostName || "Host")}</strong></span>
          <span>· 👥 ${Number(r.playerCount) || 1}/${Number(r.maxPlayers) || 2} Players</span>
          <span>· 👁️ ${Number(r.spectatorCount) || 0} Spectators</span>
          <span>· 🔗 <code>?room=${escapeHtml(r.roomId)}</code></span>
        </div>
      </div>
      <div>
        <button class="btn ${isMyCurrentRoom ? "btn-secondary" : "btn-primary"} btn-xs btn-enter-active-room" data-room="${escapeHtml(r.roomId)}">
          ${isMyCurrentRoom ? "In Room" : "👁️ Enter"}
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".btn-enter-active-room").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const targetRoomId = e.currentTarget.dataset.room;
      if (!targetRoomId) return;
      if (window.CaroMultiplayer?.roomId === targetRoomId) {
        switchMpTab("create");
        return;
      }
      const myName = window.CaroAuth?.getCurrentUser()?.display_name || window.CaroMultiplayer?.myName || "Spectator";
      try {
        await window.CaroMultiplayer.joinRoom(targetRoomId, myName);
        showMultiplayerHud(targetRoomId);
        updateMultiplayerHudBadges();
        switchMpTab("create");
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function handleMultiplayerLobbyUpdate(lobbyState) {
  updateMultiplayerModeBadge();
  renderMultiplayerSlots();
  renderSpectatorsAndRequests();
  renderHostApprovalBar();
  updateMultiplayerHudBadges();

  const shareBox = document.getElementById("mp-share-box");
  const shareUrl = document.getElementById("mp-share-url");
  const btnStartMp = document.getElementById("btn-action-start-mp");
  const btnCreateRoom = document.getElementById("btn-action-create-room");
  const slugInput = document.getElementById("mp-room-slug-input");
  const roomNameInput = document.getElementById("mp-room-name-input");

  if (lobbyState.roomId) {
    if (shareBox) shareBox.style.display = "block";
    if (shareUrl) shareUrl.value = lobbyState.shareUrl;
    if (slugInput && !slugInput.value) slugInput.value = lobbyState.roomId;
    if (roomNameInput && !roomNameInput.value && lobbyState.roomName) roomNameInput.value = lobbyState.roomName;
    if (btnStartMp) {
      btnStartMp.style.display = lobbyState.isHost ? "inline-flex" : "none";
      btnStartMp.textContent = lobbyState.inGame ? "Restart Battle ▶" : "Start Battle ▶";
    }
    if (btnCreateRoom) {
      btnCreateRoom.style.display = lobbyState.isHost ? "inline-flex" : "none";
      btnCreateRoom.textContent = "New Room";
    }
    showMultiplayerHud(lobbyState.roomId);
  } else {
    if (shareBox) shareBox.style.display = "none";
    if (btnStartMp) btnStartMp.style.display = "none";
    if (btnCreateRoom) {
      btnCreateRoom.style.display = "inline-flex";
      btnCreateRoom.textContent = "Create New Room";
    }
  }
}

function handleMultiplayerRequestsUpdate() {
  renderSpectatorsAndRequests();
  renderHostApprovalBar();
  updateMultiplayerHudBadges();
}

function renderSpectatorsAndRequests() {
  const lobby = window.CaroMultiplayer?.getLobbyState();
  const sec = document.getElementById("mp-spectators-section");
  const reqContainer = document.getElementById("mp-requests-container");
  const reqList = document.getElementById("mp-requests-list");
  const specLabel = document.getElementById("mp-spectators-label");
  const btnReqJoin = document.getElementById("btn-mp-request-join");
  if (!sec || !lobby) return;

  if (!lobby.roomId) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";

  const specs = lobby.spectators || [];
  if (specLabel) {
    const names = specs.map(s => s.name).join(", ");
    specLabel.textContent = specs.length > 0
      ? `👁️ Spectators (${specs.length}): ${names}`
      : `👁️ Spectators (0): None`;
  }

  // Spectator "Request to Join" button
  if (btnReqJoin) {
    if (!lobby.isHost && lobby.myRole === "spectator") {
      btnReqJoin.style.display = "inline-flex";
      if (lobby.myPendingRequest) {
        btnReqJoin.textContent = "⏳ Request Pending...";
        btnReqJoin.disabled = true;
      } else {
        btnReqJoin.textContent = lobby.inGame ? "⚡ Request Takeover" : "✋ Request to Join Match";
        btnReqJoin.disabled = false;
      }
    } else {
      btnReqJoin.style.display = "none";
    }
  }

  // Host Pending Requests queue
  const reqs = lobby.pendingRequests || [];
  if (reqContainer && reqList) {
    if (lobby.isHost && reqs.length > 0) {
      reqContainer.style.display = "block";
      reqList.innerHTML = "";
      reqs.forEach(r => {
        const row = document.createElement("div");
        row.className = "mp-request-item";
        const desc = r.kind === "takeover"
          ? `⚡ <strong>${escapeHtml(r.fromName)}</strong> wants to take over Slot ${escapeHtml(r.targetSymbol || ("#" + ((r.slotIndex || 1) + 1)))}`
          : `✋ <strong>${escapeHtml(r.fromName)}</strong> wants to join the match`;
        row.innerHTML = `
          <span>${desc}</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary btn-xs btn-approve-req" data-req="${escapeHtml(r.requestId)}">✓ Approve</button>
            <button class="btn btn-ghost btn-xs btn-reject-req" data-req="${escapeHtml(r.requestId)}">✕ Reject</button>
          </div>
        `;
        reqList.appendChild(row);
      });
      reqList.querySelectorAll(".btn-approve-req").forEach(b => {
        b.addEventListener("click", (e) => {
          window.CaroMultiplayer.approveRequest(e.currentTarget.dataset.req);
        });
      });
      reqList.querySelectorAll(".btn-reject-req").forEach(b => {
        b.addEventListener("click", (e) => {
          window.CaroMultiplayer.rejectRequest(e.currentTarget.dataset.req);
        });
      });
    } else {
      reqContainer.style.display = "none";
      reqList.innerHTML = "";
    }
  }
}

function renderHostApprovalBar() {
  const bar = document.getElementById("mp-host-approval-bar");
  if (!bar || !window.CaroMultiplayer) return;
  const lobby = window.CaroMultiplayer.getLobbyState();
  const reqs = lobby.pendingRequests || [];

  if (!lobby.isHost || reqs.length === 0) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }

  const r = reqs[0];
  const desc = r.kind === "takeover"
    ? `⚡ <strong>${escapeHtml(r.fromName)}</strong> requests to take over Slot ${escapeHtml(r.targetSymbol || ("#" + ((r.slotIndex || 1) + 1)))}`
    : `✋ <strong>${escapeHtml(r.fromName)}</strong> requests to join the match`;

  bar.style.display = "flex";
  bar.innerHTML = `
    <div>${desc} ${reqs.length > 1 ? `<span class="mp-req-pill">+${reqs.length - 1} more</span>` : ""}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-xs" id="btn-hud-approve-req">✓ Approve</button>
      <button class="btn btn-ghost btn-xs" id="btn-hud-reject-req">✕ Reject</button>
    </div>
  `;
  document.getElementById("btn-hud-approve-req")?.addEventListener("click", () => {
    window.CaroMultiplayer.approveRequest(r.requestId);
  });
  document.getElementById("btn-hud-reject-req")?.addEventListener("click", () => {
    window.CaroMultiplayer.rejectRequest(r.requestId);
  });
}

function renderMultiplayerSlots() {
  const list = document.getElementById("mp-slots-list");
  if (!list || !window.CaroMultiplayer) return;

  const lobby = window.CaroMultiplayer.getLobbyState();
  const slots = lobby.slots || [];
  const isHost = lobby.isHost;
  const isSpectator = !isHost && lobby.myRole === "spectator";
  const symbols = ["A", "B", "C", "D"];

  // Toggle +Human / +AI buttons visibility & disabled state
  const addBar = document.getElementById("mp-slot-add-bar");
  const btnAddHuman = document.getElementById("btn-mp-add-human");
  const btnAddAi = document.getElementById("btn-mp-add-ai");
  if (addBar) {
    addBar.style.display = (isHost || !lobby.roomId) ? "flex" : "none";
  }
  const canAddSlot = slots.length < 4 && !lobby.inGame;
  if (btnAddHuman) btnAddHuman.disabled = !canAddSlot;
  if (btnAddAi) btnAddAi.disabled = !canAddSlot;

  const titleEl = document.getElementById("mp-slots-title");
  if (titleEl) {
    titleEl.textContent = `Player Roster (${slots.length}/4 Players)`;
  }

  list.innerHTML = "";
  slots.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "mp-slot-item";

    const isSlotHost = idx === 0;
    const sym = symbols[idx] || "";
    const avatar = isSlotHost ? "👑" : (s.type === "human" ? "👤" : "🤖");
    const safeName = escapeHtml(s.name || "Open Human Slot");

    let controlsHtml = "";
    if (isSlotHost) {
      controlsHtml = `<span class="mp-slot-badge ready">Host (${sym})</span>`;
    } else if (isHost || !lobby.roomId) {
      const hasSeatedHuman = s.type === "human" && Boolean(s.id);
      const kickBtn = hasSeatedHuman
        ? `<button class="btn btn-ghost btn-xs btn-kick-slot" data-slot="${idx}" title="Move player to Spectator">Kick</button>`
        : "";
      const removeBtn = (slots.length > 2 && !lobby.inGame)
        ? `<button class="btn btn-ghost btn-xs btn-remove-slot" data-slot="${idx}" title="Remove slot">✕</button>`
        : "";
      controlsHtml = `
        <select class="mp-slot-select" data-slot="${idx}">
          <option value="human" ${s.type === "human" ? "selected" : ""}>👤 ${hasSeatedHuman ? safeName : "Open Human Slot"}</option>
          <option value="von" ${s.type === "ai" && s.model === "von" ? "selected" : ""}>🤖 Von (AI)</option>
          <option value="mojev" ${s.type === "ai" && s.model === "mojev" ? "selected" : ""}>🤖 MoJev (AI)</option>
          <option value="laya" ${s.type === "ai" && s.model === "laya" ? "selected" : ""}>🤖 Laya (AI)</option>
          <option value="jev" ${s.type === "ai" && s.model === "jev" ? "selected" : ""}>🤖 Jev (AI)</option>
        </select>
        ${kickBtn}
        ${removeBtn}
      `;
    } else {
      const actionBtn = isSpectator
        ? (s.type === "human" && !s.id && !lobby.inGame
          ? `<button class="btn btn-primary btn-xs btn-req-slot" data-slot="${idx}">✋ Request Slot</button>`
          : `<button class="btn btn-ghost btn-xs btn-takeover-slot" data-slot="${idx}">⚡ Takeover</button>`)
        : "";
      controlsHtml = `
        <span class="mp-slot-badge ${s.ready ? "ready" : ""}">${s.id === lobby.myPlayerId ? "You (" + sym + ")" : safeName}</span>
        ${actionBtn}
      `;
    }

    item.innerHTML = `
      <div class="mp-slot-left">
        <span class="mp-slot-num">${sym}</span>
        <span class="mp-slot-avatar">${avatar}</span>
        <span class="mp-slot-name">${safeName}</span>
      </div>
      <div class="mp-slot-right">
        ${controlsHtml}
      </div>
    `;

    list.appendChild(item);
  });

  list.querySelectorAll(".mp-slot-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const slotIdx = parseInt(e.target.dataset.slot, 10);
      const val = e.target.value;
      if (val === "human") {
        window.CaroMultiplayer.updateSlot(slotIdx, { type: "human", name: "Open Human Slot", id: null, ready: false });
      } else {
        const aiNames = { von: "Von (AI)", mojev: "MoJev (AI)", laya: "Laya (AI)", jev: "Jev (AI)" };
        window.CaroMultiplayer.updateSlot(slotIdx, { type: "ai", model: val, name: aiNames[val] || "AI", id: null, ready: true });
      }
    });
  });

  list.querySelectorAll(".btn-remove-slot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const slotIdx = parseInt(e.currentTarget.dataset.slot, 10);
      window.CaroMultiplayer.removeSlot(slotIdx);
    });
  });

  list.querySelectorAll(".btn-kick-slot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const slotIdx = parseInt(e.currentTarget.dataset.slot, 10);
      window.CaroMultiplayer.kickPlayerToSpectator(slotIdx);
    });
  });

  list.querySelectorAll(".btn-req-slot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const slotIdx = parseInt(e.currentTarget.dataset.slot, 10);
      window.CaroMultiplayer.requestJoinSlot(slotIdx);
    });
  });

  list.querySelectorAll(".btn-takeover-slot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const slotIdx = parseInt(e.currentTarget.dataset.slot, 10);
      window.CaroMultiplayer.requestTakeover(slotIdx);
    });
  });
}

function resolveMyMultiplayerSymbol(roster) {
  if (!roster || roster.length === 0) return null;
  const isHost = Boolean(window.CaroMultiplayer?.isHost);
  const myId = window.CaroMultiplayer?.myId;
  const myRole = window.CaroMultiplayer?.myRole;
  const assignedSlot = window.CaroMultiplayer?.myAssignedSlot;

  // 1. Match by exact playerId first (preserves symbol across reconnects, approvals, and takeovers)
  if (myId) {
    const slotById = roster.find(r => r.playerId && r.playerId === myId);
    if (slotById) return slotById.symbol;
  }

  // 2. Host owns slot 0 (A) unless another slot explicitly matched by playerId
  if (isHost) {
    return roster[0]?.symbol || "A";
  }

  // 3. Match by approved assignedSlot only if role is player
  if (myRole === "player" && typeof assignedSlot === "number" && assignedSlot >= 0 && assignedSlot < roster.length) {
    const slotByIndex = roster[assignedSlot];
    if (slotByIndex && slotByIndex.type === "human") return slotByIndex.symbol;
  }

  // Spectators strictly return null so they cannot place stones until approved!
  return null;
}

function setSidebarRosterDisabled(disabled) {
  document.querySelectorAll("#roster-config input[type=checkbox]").forEach(cb => {
    cb.disabled = Boolean(disabled);
  });
}

function handleMultiplayerGameStart(data) {
  if (isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }

  isMultiplayerActive = true;
  setSidebarRosterDisabled(true);
  multiplayerRoster = data.roster || [];
  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);

  if (!clientEngine && window.CaroEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => handleStateUpdate(state);
  }

  const playerTypes = multiplayerRoster.map(p => p.type);
  clientEngine.selectedPlayerTypes = playerTypes;
  clientEngine.status = "ready";
  clientEngine.battleNumber = data.battleNumber || 1;
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);

  closeMultiplayerModal();
  showMultiplayerHud(data.roomId);
  updateMultiplayerHudBadges();
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(nextState);
  fetchLeaderboard();
  fetchBattleHistory();

  if (window.CaroMultiplayer.isHost) {
    scheduleHostAiMoveIfNeeded();
  }
}

function handleMultiplayerSlotTakeover(payload) {
  if (!payload || !payload.symbol) return;
  const sym = payload.symbol;
  const rosterItem = multiplayerRoster.find(r => r.symbol === sym);

  if (payload.isAiReplacement) {
    const aiModel = payload.aiModel || "von";
    if (rosterItem) {
      rosterItem.type = aiModel;
      rosterItem.name = payload.newPlayerName || "Von (AI)";
      rosterItem.playerId = null;
      rosterItem.isAi = true;
      rosterItem.disconnected = false;
    }
    if (clientEngine?.players) {
      const p = clientEngine.players.find(pl => pl.symbol === sym);
      if (p) {
        p.type = aiModel;
        p.name = payload.newPlayerName || "Von (AI)";
        p.agent = clientEngine.createAgent(aiModel, sym);
      }
    }
  } else {
    if (rosterItem) {
      rosterItem.type = "human";
      rosterItem.name = payload.newPlayerName || "Player";
      rosterItem.playerId = payload.newPlayerId;
      rosterItem.isAi = false;
      rosterItem.disconnected = false;
      rosterItem.isLocalHuman = (payload.newPlayerId === window.CaroMultiplayer?.myId);
    }
    if (clientEngine?.players) {
      const p = clientEngine.players.find(pl => pl.symbol === sym);
      if (p) {
        p.type = "human";
        p.name = payload.newPlayerName || "Player";
        p.agent = null;
      }
    }
  }

  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
  if (clientEngine) {
    gameState = clientEngine.getState();
    rebuildSymbolMap();
  }
  updateMultiplayerHudBadges();
  updateUI();
  if (window.CaroMultiplayer?.isHost) {
    scheduleHostAiMoveIfNeeded();
  }
}

function handleMultiplayerStateSync(payload) {
  if (!payload || !Array.isArray(payload.roster) || payload.roster.length < 2) return;
  const incomingMoves = Array.isArray(payload.moves) ? payload.moves : [];
  const incomingBattleNum = payload.battleNumber || 1;

  isMultiplayerActive = true;
  setSidebarRosterDisabled(true);
  multiplayerRoster = payload.roster.map(r => Object.assign({}, r, {
    isLocalHuman: r.type === "human" && r.playerId === window.CaroMultiplayer?.myId
  }));
  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);

  if (
    clientEngine &&
    clientEngine.battleNumber === incomingBattleNum &&
    (clientEngine.board?.moves?.length || 0) >= incomingMoves.length &&
    clientEngine.players?.length === multiplayerRoster.length
  ) {
    // Update player names/types in place (e.g. after a takeover) without re-running moves
    for (const r of multiplayerRoster) {
      const p = clientEngine.players.find(pl => pl.symbol === r.symbol);
      if (p) {
        p.type = r.type;
        p.name = r.name;
        p.agent = r.type === "human" ? null : (p.agent || clientEngine.createAgent(r.type, r.symbol));
      }
    }
    gameState = clientEngine.getState();
    rebuildSymbolMap();
    updateMultiplayerHudBadges();
    updateUI();
    return;
  }

  if (isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }

  if (!clientEngine && window.CaroEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => handleStateUpdate(state);
  }

  const playerTypes = multiplayerRoster.map(p => p.type);
  clientEngine.selectedPlayerTypes = playerTypes;
  clientEngine.status = "ready";
  clientEngine.battleNumber = incomingBattleNum;
  clientEngine.newGame(playerTypes, false, multiplayerRoster);

  for (const m of incomingMoves) {
    const meta = m.metadata || { row: m.row, col: m.col, latency_ms: 0, reasoning: `Synced move (${m.player})` };
    clientEngine.playMove(m.row, m.col, meta);
  }

  closeMultiplayerModal();
  showMultiplayerHud(payload.roomId || window.CaroMultiplayer?.roomId || "");
  updateMultiplayerHudBadges();
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(clientEngine.getState());
  fetchLeaderboard();
  fetchBattleHistory();

  if (window.CaroMultiplayer?.isHost) {
    scheduleHostAiMoveIfNeeded();
  }
}

function handleMultiplayerHostMigrated(info) {
  if (!isMultiplayerActive) return;
  if (info?.leftHostId) {
    for (const r of multiplayerRoster) {
      if (r.playerId === info.leftHostId) {
        r.disconnected = true;
      }
      r.isHost = (r.playerId === info.newHostId);
    }
    if (clientEngine?.players && typeof clientEngine.createAgent === "function") {
      for (const r of multiplayerRoster) {
        if (r.disconnected) {
          const p = clientEngine.players.find(pl => pl.symbol === r.symbol);
          if (p && !p.agent) {
            p.agent = clientEngine.createAgent("von", r.symbol);
          }
        }
      }
    }
  }
  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
  updateMultiplayerHudBadges();
  updateUI();
  if (window.CaroMultiplayer?.isHost) {
    scheduleHostAiMoveIfNeeded();
  }
}

function handleMultiplayerRemoteMove(data) {
  if (!isMultiplayerActive || !clientEngine) return;
  if (data.senderId === window.CaroMultiplayer.myId) return;
  if (data.symbol && clientEngine.board?.currentPlayer && data.symbol !== clientEngine.board.currentPlayer) return;

  // Verify sender owns the slot or is the room host (for AI / shot-clock moves)
  const slotEntry = multiplayerRoster.find(r => r.symbol === data.symbol);
  const hostId = window.CaroMultiplayer?.hostId;
  if (
    slotEntry &&
    slotEntry.playerId &&
    data.senderId &&
    data.senderId !== slotEntry.playerId &&
    data.senderId !== hostId
  ) {
    return;
  }

  const moves = clientEngine.board?.moves || [];
  const occupied = moves.some(m => m.row === data.row && m.col === data.col);
  if (occupied) return;

  const meta = { row: data.row, col: data.col, latency_ms: 0, reasoning: `Remote move (${data.symbol || "remote"})` };
  const ok = clientEngine.playMove(data.row, data.col, meta);
  if (ok) {
    const nextState = clientEngine.getState();
    handleStateUpdate(nextState);
  }

  scheduleHostAiMoveIfNeeded();
}

function handleMultiplayerRemoteNextBattle(data) {
  if (!isMultiplayerActive || !clientEngine) return;
  clientEngine.status = "ready";
  clientEngine.battleNumber = data.battleNumber || (clientEngine.battleNumber + 1);
  const playerTypes = multiplayerRoster.map(p => p.type);
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(nextState);
}

function handleMultiplayerRoomLeave() {
  isMultiplayerActive = false;
  myMultiplayerSymbol = null;
  multiplayerRoster = [];
  clearMultiplayerTurnTimer();
  setSidebarRosterDisabled(false);
  updateRosterCount();

  const hud = document.getElementById("multiplayer-hud");
  if (hud) hud.style.display = "none";
  const approvalBar = document.getElementById("mp-host-approval-bar");
  if (approvalBar) approvalBar.style.display = "none";

  if (useBackend()) {
    fetchState();
    fetchLeaderboard();
    fetchBattleHistory();
  } else if (clientEngine) {
    const selected = getSelectedRoster();
    clientEngine.newGame(selected.length >= 2 ? selected : ["laya", "jev", "von", "mojev"]);
    fetchState();
    fetchLeaderboard();
    fetchBattleHistory();
  }
}

function showMultiplayerHud(roomId) {
  const hud = document.getElementById("multiplayer-hud");
  if (hud && roomId) {
    hud.style.display = "flex";
    const rm = document.getElementById("mp-hud-room");
    const rmName = document.getElementById("mp-hud-room-name");
    if (rm) rm.textContent = roomId;
    if (rmName) rmName.textContent = window.CaroMultiplayer?.roomName || "Room:";
    updateMultiplayerHudBadges();
  }
}

function updateMultiplayerHudBadges() {
  if (!window.CaroMultiplayer) return;
  const lobby = window.CaroMultiplayer.getLobbyState();
  const roleBadge = document.getElementById("mp-hud-role");
  const specBadge = document.getElementById("mp-hud-spectators");
  const reqJoinBtn = document.getElementById("btn-mp-hud-request-join");
  const reqCountBadge = document.getElementById("mp-hud-req-badge");
  const rmName = document.getElementById("mp-hud-room-name");

  if (rmName && lobby.roomName) {
    rmName.textContent = `${lobby.roomName}:`;
  }
  if (roleBadge) {
    if (lobby.isHost) {
      roleBadge.textContent = `👑 Host (${myMultiplayerSymbol || "A"})`;
    } else if (myMultiplayerSymbol) {
      roleBadge.textContent = `⚔️ Player ${myMultiplayerSymbol}`;
    } else {
      roleBadge.textContent = "👁️ Spectating";
    }
  }
  if (specBadge) {
    const count = (lobby.spectators || []).length;
    specBadge.textContent = `👁️ ${count}`;
  }
  if (reqJoinBtn) {
    if (!lobby.isHost && !myMultiplayerSymbol) {
      reqJoinBtn.style.display = "inline-flex";
      reqJoinBtn.textContent = lobby.myPendingRequest
        ? "⏳ Requested"
        : (lobby.inGame ? "⚡ Request Takeover" : "✋ Request to Join");
      reqJoinBtn.disabled = Boolean(lobby.myPendingRequest);
    } else {
      reqJoinBtn.style.display = "none";
    }
  }
  if (reqCountBadge) {
    const pendingCount = (lobby.pendingRequests || []).length;
    if (lobby.isHost && pendingCount > 0) {
      reqCountBadge.style.display = "inline-block";
      reqCountBadge.textContent = String(pendingCount);
    } else {
      reqCountBadge.style.display = "none";
    }
  }
}

function updateMultiplayerHudStatus(text) {
  const st = document.getElementById("mp-hud-status");
  if (st) st.textContent = text;
}

function clearMultiplayerTurnTimer() {
  if (mpTurnTimerInterval) {
    clearInterval(mpTurnTimerInterval);
    mpTurnTimerInterval = null;
  }
  mpTurnTimerKey = null;
  mpTurnAutoPlayedKey = null;
  const badge = document.getElementById("mp-hud-timer");
  if (badge) badge.style.display = "none";
}

function chooseTacticalAutoMove(symbol) {
  if (!clientEngine?.board || clientEngine.board.stones.size === 0) {
    return { r: 0, c: 0 };
  }
  if (window.CaroEngine?.TacticalEvaluator) {
    const ranked = window.CaroEngine.TacticalEvaluator.getRankedCandidates(clientEngine.board, symbol, 10, 2);
    if (ranked && ranked.length > 0) {
      return { r: ranked[0].row, c: ranked[0].col };
    }
  }
  const cands = clientEngine.board.getCandidateMoves(2);
  if (cands && cands.length > 0) {
    return { r: cands[0][0], c: cands[0][1] };
  }
  return { r: 0, c: 0 };
}

function syncMultiplayerTurnTimer() {
  if (!isMultiplayerActive || isReplayMode || !gameState || gameState.status === "finished") {
    clearMultiplayerTurnTimer();
    return;
  }
  const currSymbol = gameState.current_player?.symbol || "";
  const moveCount = gameState.board?.move_count || 0;
  const turnKey = `${gameState.game_id || ""}:${moveCount}:${currSymbol}`;

  if (turnKey !== mpTurnTimerKey) {
    mpTurnTimerKey = turnKey;
    const timeoutSec = Math.max(1, Number(window.CaroMultiplayer?.turnTimeoutSec) || 30);
    mpTurnDeadline = Date.now() + timeoutSec * 1000;
    mpTurnAutoPlayedKey = null;
  }

  const updateTimerTick = () => {
    if (!isMultiplayerActive || !gameState || gameState.status === "finished") {
      clearMultiplayerTurnTimer();
      return;
    }
    const remMs = Math.max(0, mpTurnDeadline - Date.now());
    const remSec = Math.ceil(remMs / 1000);
    const badge = document.getElementById("mp-hud-timer");
    if (badge) {
      badge.style.display = "inline-block";
      badge.textContent = `⏱ ${remSec}s`;
      badge.style.color = remSec <= 5 ? "#ef4444" : "";
    }

    if (remMs <= 0 && mpTurnAutoPlayedKey !== mpTurnTimerKey) {
      const activeSym = gameState.current_player?.symbol;
      if (isLocalHumanAllowedToMove()) {
        mpTurnAutoPlayedKey = mpTurnTimerKey;
        const autoCoord = chooseTacticalAutoMove(myMultiplayerSymbol);
        updateMultiplayerHudStatus("⏱ Shot clock expired — auto-played tactical move!");
        sendHumanMove(autoCoord.r, autoCoord.c);
      } else if (
        window.CaroMultiplayer?.isHost &&
        activeSym &&
        Date.now() - mpTurnDeadline >= 900 &&
        clientEngine
      ) {
        const activePlayer = clientEngine.players.find(p => p.symbol === activeSym);
        if (activePlayer && activePlayer.type === "human") {
          mpTurnAutoPlayedKey = mpTurnTimerKey;
          const autoCoord = chooseTacticalAutoMove(activeSym);
          const meta = { row: autoCoord.r, col: autoCoord.c, latency_ms: 0, reasoning: "Shot clock timeout auto-move" };
          if (clientEngine.playMove(autoCoord.r, autoCoord.c, meta)) {
            const nextState = clientEngine.getState();
            handleStateUpdate(nextState);
            window.CaroMultiplayer.sendMove(autoCoord.r, autoCoord.c, "human", activeSym, nextState.board.moves.length);
            scheduleHostAiMoveIfNeeded();
          }
        }
      }
    }
  };

  updateTimerTick();
  if (!mpTurnTimerInterval) {
    mpTurnTimerInterval = setInterval(updateTimerTick, 200);
  }
}

function isAiOrDisconnectedPlayer(playerObj) {
  if (!playerObj) return false;
  if (playerObj.type !== "human") return true;
  const rosterEntry = multiplayerRoster.find(r => r.symbol === playerObj.symbol);
  return Boolean(rosterEntry && rosterEntry.disconnected);
}

function scheduleHostAiMoveIfNeeded() {
  if (!isMultiplayerActive || !window.CaroMultiplayer || !window.CaroMultiplayer.isHost) return;
  if (!clientEngine || clientEngine.status === "finished") return;

  const currPlayer = clientEngine.players.find(p => p.symbol === clientEngine.board.currentPlayer);
  if (!isAiOrDisconnectedPlayer(currPlayer)) return;

  setTimeout(() => {
    if (!isMultiplayerActive || !window.CaroMultiplayer.isHost) return;
    if (clientEngine.status === "finished") return;
    const aiPlayer = clientEngine.players.find(p => p.symbol === clientEngine.board.currentPlayer);
    if (!isAiOrDisconnectedPlayer(aiPlayer)) return;

    if (!aiPlayer.agent && typeof clientEngine.createAgent === "function") {
      aiPlayer.agent = clientEngine.createAgent("von", aiPlayer.symbol);
    }

    clientEngine.step();
    const nextState = clientEngine.getState();
    handleStateUpdate(nextState);

    const moves = nextState.board.moves;
    if (moves && moves.length > 0) {
      const last = moves[moves.length - 1];
      window.CaroMultiplayer.sendMove(last.row, last.col, aiPlayer.type, last.player, moves.length);
    }

    scheduleHostAiMoveIfNeeded();
  }, 220);
}

function startNextMultiplayerBattle() {
  if (!isMultiplayerActive || !clientEngine) return;
  clientEngine.battleNumber += 1;
  const playerTypes = multiplayerRoster.map(p => p.type);
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(nextState);
  window.CaroMultiplayer.sendNextBattle(clientEngine.battleNumber);
  scheduleHostAiMoveIfNeeded();
}

function checkUrlForRoomInvite() {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");

  try {
    const savedRoom = sessionStorage.getItem("caro_active_room");
    const savedName = window.CaroAuth?.getCurrentUser()?.display_name || sessionStorage.getItem("caro_player_name");
    if (savedRoom && (!roomFromUrl || roomFromUrl.toLowerCase() === savedRoom.toLowerCase()) && window.CaroMultiplayer) {
      window.CaroMultiplayer.joinRoom(savedRoom, savedName || undefined).catch(() => {});
      return;
    }
  } catch {}

  if (roomFromUrl) {
    openMultiplayerModal("join");
    const codeInput = document.getElementById("mp-join-code-input");
    if (codeInput) codeInput.value = roomFromUrl;
  }
}

// ─────────────────────────────────────────
// Simple Account & Cranes Auth Modal UI
// ─────────────────────────────────────────
function setupAuthUI() {
  if (!window.CaroAuth) return;

  const btnOpenAuth = document.getElementById("btn-auth-profile");
  const modalAuth = document.getElementById("modal-auth");
  const btnCloseAuth = document.getElementById("btn-close-auth-modal");
  const tabBtnLogin = document.getElementById("auth-tab-btn-login");
  const tabBtnRegister = document.getElementById("auth-tab-btn-register");
  const btnSubmitLogin = document.getElementById("btn-auth-submit-login");
  const btnSubmitRegister = document.getElementById("btn-auth-submit-register");
  const btnSaveProfile = document.getElementById("btn-auth-save-profile");
  const btnLogout = document.getElementById("btn-auth-logout");

  const updateAuthHeaderBtn = (user) => {
    if (!btnOpenAuth) return;
    if (user && user.display_name) {
      const cranes = user.cranes ?? 100;
      btnOpenAuth.textContent = `🦢 ${cranes} · 👤 ${user.display_name}`;
    } else {
      btnOpenAuth.textContent = "👤 Sign In";
    }
  };

  const switchAuthTab = (mode) => {
    const tLogin = document.getElementById("auth-tab-login");
    const tReg = document.getElementById("auth-tab-register");
    const statusMsg = document.getElementById("auth-status-msg");
    if (statusMsg) statusMsg.style.display = "none";
    if (tLogin) tLogin.style.display = mode === "login" ? "block" : "none";
    if (tReg) tReg.style.display = mode === "register" ? "block" : "none";
    tabBtnLogin?.classList.toggle("active", mode === "login");
    tabBtnRegister?.classList.toggle("active", mode === "register");
  };

  const renderAuthModalView = () => {
    const user = window.CaroAuth.getCurrentUser();
    const guestView = document.getElementById("auth-view-guest");
    const profileView = document.getElementById("auth-view-profile");
    const statusMsg = document.getElementById("auth-status-msg");
    const profMsg = document.getElementById("auth-profile-msg");
    if (statusMsg) statusMsg.style.display = "none";
    if (profMsg) profMsg.style.display = "none";

    if (user) {
      if (guestView) guestView.style.display = "none";
      if (profileView) profileView.style.display = "block";
      const cranesEl = document.getElementById("auth-cranes-count");
      const nameEl = document.getElementById("auth-profile-name");
      const emailEl = document.getElementById("auth-profile-email");
      const currPinEl = document.getElementById("auth-profile-current-pin");
      const newPinEl = document.getElementById("auth-profile-new-pin");
      if (cranesEl) cranesEl.textContent = String(user.cranes ?? 100);
      if (nameEl) nameEl.value = user.display_name || "";
      if (emailEl) emailEl.value = user.email || "";
      if (currPinEl) currPinEl.value = "";
      if (newPinEl) newPinEl.value = "";
    } else {
      if (guestView) guestView.style.display = "block";
      if (profileView) profileView.style.display = "none";
      switchAuthTab("login");
    }
  };

  const showAuthMsg = (elId, text, isError = true) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.display = "block";
    el.className = `auth-status-msg ${isError ? "error" : "success"}`;
    el.textContent = text;
  };

  window.CaroAuth.onAuthChange((user) => {
    updateAuthHeaderBtn(user);
    renderAuthModalView();
  });

  updateAuthHeaderBtn(window.CaroAuth.getCurrentUser());

  btnOpenAuth?.addEventListener("click", () => {
    renderAuthModalView();
    if (modalAuth) modalAuth.style.display = "flex";
  });

  btnCloseAuth?.addEventListener("click", () => {
    if (modalAuth) modalAuth.style.display = "none";
  });

  modalAuth?.addEventListener("click", (e) => {
    if (e.target.id === "modal-auth") modalAuth.style.display = "none";
  });

  tabBtnLogin?.addEventListener("click", () => switchAuthTab("login"));
  tabBtnRegister?.addEventListener("click", () => switchAuthTab("register"));

  btnSubmitLogin?.addEventListener("click", async () => {
    const email = document.getElementById("auth-login-email")?.value || "";
    const pin = document.getElementById("auth-login-pin")?.value || "";
    try {
      btnSubmitLogin.disabled = true;
      await window.CaroAuth.login({ email, pin });
      showAuthMsg("auth-profile-msg", "Signed in!", false);
    } catch (err) {
      showAuthMsg("auth-status-msg", err.message, true);
    } finally {
      btnSubmitLogin.disabled = false;
    }
  });

  btnSubmitRegister?.addEventListener("click", async () => {
    const displayName = document.getElementById("auth-reg-name")?.value || "";
    const email = document.getElementById("auth-reg-email")?.value || "";
    const pin = document.getElementById("auth-reg-pin")?.value || "";
    try {
      btnSubmitRegister.disabled = true;
      await window.CaroAuth.register({ displayName, email, pin });
      showAuthMsg("auth-profile-msg", "Account created with 100 🦢 Cranes!", false);
    } catch (err) {
      showAuthMsg("auth-status-msg", err.message, true);
    } finally {
      btnSubmitRegister.disabled = false;
    }
  });

  btnSaveProfile?.addEventListener("click", async () => {
    const displayName = document.getElementById("auth-profile-name")?.value || "";
    const email = document.getElementById("auth-profile-email")?.value || "";
    const currentPin = document.getElementById("auth-profile-current-pin")?.value || "";
    const newPin = document.getElementById("auth-profile-new-pin")?.value || "";
    try {
      btnSaveProfile.disabled = true;
      await window.CaroAuth.updateProfile({ displayName, email, currentPin, newPin });
      showAuthMsg("auth-profile-msg", "✓ Profile updated!", false);
      const currPinEl = document.getElementById("auth-profile-current-pin");
      const newPinEl = document.getElementById("auth-profile-new-pin");
      if (currPinEl) currPinEl.value = "";
      if (newPinEl) newPinEl.value = "";
    } catch (err) {
      showAuthMsg("auth-profile-msg", err.message, true);
    } finally {
      btnSaveProfile.disabled = false;
    }
  });

  btnLogout?.addEventListener("click", () => {
    window.CaroAuth.logout();
  });
}


