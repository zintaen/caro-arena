/**
 * Caro Arena — Battle Royale Frontend
 * N-Player Free-For-All with Leaderboard Tracking, Web Audio, Heatmap, and Championship Mode
 */

const canvas = document.getElementById("caro-canvas");
const ctx = canvas.getContext("2d");

let camera = { x: canvas.width / 2, y: canvas.height / 2, zoom: 1.0, baseCellSize: 38 };
let cameraTarget = { x: canvas.width / 2, y: canvas.height / 2, zoom: 1.0, active: false };
let isDragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
let hasDragged = false, userInteractedWithCamera = false;
let hoverCoord = null;
let highlightedMoveCoord = null;
let _lastAutoScaleMoveCount = -1;

// Gameplay motion & particle FX state
const stoneSpawnTimes = new Map(); // "r,c" -> performance.now()
let boardRipples = []; // { row, col, color, createdAt, duration }
let boardSparks = [];  // { row, col, vx, vy, color, size, createdAt, duration }
const _reducedMotionQuery = (typeof window !== "undefined" && typeof window.matchMedia === "function")
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

function prefersReducedMotion() {
  return Boolean(_reducedMotionQuery && _reducedMotionQuery.matches);
}

function triggerStonePlacementFx(r, c, symbol) {
  if (prefersReducedMotion()) return;
  const now = performance.now();
  stoneSpawnTimes.set(`${r},${c}`, now);
  if (stoneSpawnTimes.size > 160) {
    const oldestKey = stoneSpawnTimes.keys().next().value;
    if (oldestKey !== undefined) stoneSpawnTimes.delete(oldestKey);
  }
  const meta = getPlayerMeta(symbol);
  boardRipples.push({
    row: r,
    col: c,
    color: meta.color || "#d97706",
    createdAt: now,
    duration: 460
  });
  if (boardRipples.length > 24) boardRipples.shift();
  startFxAnimation();
}

function triggerWinningLineBurstFx(winningLine, symbol) {
  if (prefersReducedMotion() || !Array.isArray(winningLine) || winningLine.length === 0) return;
  const now = performance.now();
  const meta = getPlayerMeta(symbol);
  const baseColor = meta.color || "#f59e0b";
  const palette = [baseColor, "#fbbf24", "#ffffff", "#f59e0b"];
  for (const [wr, wc] of winningLine) {
    boardRipples.push({
      row: wr,
      col: wc,
      color: "#fbbf24",
      createdAt: now,
      duration: 620
    });
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.35;
      const speed = 0.7 + Math.random() * 1.45;
      boardSparks.push({
        row: wr,
        col: wc,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: palette[i % palette.length],
        size: 2.2 + Math.random() * 2.0,
        createdAt: now,
        duration: 540 + Math.random() * 220
      });
    }
  }
  if (boardSparks.length > 160) boardSparks.splice(0, boardSparks.length - 160);
  startFxAnimation();
}

function hasActiveStoneSpring(now = performance.now()) {
  if (prefersReducedMotion() || stoneSpawnTimes.size === 0) return false;
  for (const t of stoneSpawnTimes.values()) {
    if (now - t < 290) return true;
  }
  return false;
}

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

const BOARD_THEMES_PALETTES = {
  classic: {
    bgStops: ["#f9dfb0", "#ecc483", "#dba65a"],
    grid: "rgba(70, 38, 14, 0.68)",
    star: "rgba(55, 28, 10, 0.85)",
    coord: "rgba(80, 48, 20, 0.55)",
    swatch: "linear-gradient(135deg, #f9dfb0, #dba65a)"
  },
  obsidian: {
    bgStops: ["#334155", "#1e293b", "#0f172a"],
    grid: "rgba(148, 163, 184, 0.42)",
    star: "rgba(226, 232, 240, 0.85)",
    coord: "rgba(148, 163, 184, 0.65)",
    swatch: "linear-gradient(135deg, #334155, #0f172a)"
  },
  jade: {
    bgStops: ["#d1fae5", "#a7f3d0", "#6ee7b7"],
    grid: "rgba(6, 78, 59, 0.52)",
    star: "rgba(4, 120, 87, 0.88)",
    coord: "rgba(6, 95, 70, 0.60)",
    swatch: "linear-gradient(135deg, #d1fae5, #34d399)"
  },
  cyber: {
    bgStops: ["#1e1b4b", "#0f172a", "#020617"],
    grid: "rgba(56, 189, 248, 0.42)",
    star: "rgba(34, 211, 238, 0.92)",
    coord: "rgba(56, 189, 248, 0.68)",
    swatch: "linear-gradient(135deg, #312e81, #020617)"
  }
};

let symbolMap = {};
let gameState = null;
let cachedLeaderboard = null;
let cachedBattlesCount = 0;
let lastRenderedMoveCount = 0, lastRenderedGameId = null;
let isReplayMode = false, replayMoves = [], replayIndex = 0, replayPlayers = [], replayPlacements = [];
let showMoveNumbers = true, showCoords = false;
let showTrail = true, showMinimap = true;
let showReplayHints = false;
let showHeatmap = true, showLasers = true;
let isTwoTapConfirm = false;
let pendingConfirmCoord = null;
let isOnLobbyStartScreen = true;
let currentMatchWagerPot = 0;
let _sessionWinRecordedForGameId = null;
let cachedRecentBattles = [];
let socket = null, wsReconnectTimer = null;
let activeHistoryTab = "moves";
let lastWasHumanTurn = false;

let clientEngine = null;
let isServerAvailable = false;
let useClientEngineOverride = false;
let currentRuleVariant = "freestyle";
let currentSeriesTarget = 1;
let _seriesChampionRecordedForGameId = null;
let _puzzleSolvedRecordedForGameId = null;
let confettiEngine = null;

function showArenaToast(message) {
  const container = document.getElementById("arena-toast-container");
  if (!container || !message) return;
  while (container.children.length >= 1) {
    container.firstElementChild.remove();
  }
  const toast = document.createElement("div");
  toast.className = "arena-toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2400);
}

function showLobbyHomeScreen() {
  isOnLobbyStartScreen = true;
  pendingConfirmCoord = null;

  // Pause background auto-play if running in solo mode
  if (!isMultiplayerActive && clientEngine?.isAutoPlaying) {
    clientEngine.toggleAutoPlay(false, 0.01);
  }
  if (!isMultiplayerActive && isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }

  const lobbyScreen = document.getElementById("lobby-home-screen");
  const arenaMain = document.getElementById("arena-main-layout");
  const headerControls = document.getElementById("header-arena-controls");
  const dot = document.getElementById("turn-dot");
  const text = document.getElementById("turn-text");

  if (lobbyScreen) lobbyScreen.style.display = "flex";
  if (arenaMain) arenaMain.style.display = "none";
  if (headerControls) headerControls.style.display = "none";
  if (dot) dot.style.background = "#10b981";
  if (text) text.textContent = "Lobby";

  window.CaroMultiplayer?.refreshActiveRooms();
  renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  if (typeof renderLobbyHomeWalletAndThemes === "function") {
    renderLobbyHomeWalletAndThemes();
  }
  if (typeof renderCareerStats === "function") {
    renderCareerStats();
  }
  if (typeof renderDailyPuzzleBadge === "function") {
    renderDailyPuzzleBadge();
  }
}

function enterArenaBattleground() {
  isOnLobbyStartScreen = false;
  const lobbyScreen = document.getElementById("lobby-home-screen");
  const arenaMain = document.getElementById("arena-main-layout");
  const headerControls = document.getElementById("header-arena-controls");

  if (lobbyScreen) lobbyScreen.style.display = "none";
  if (arenaMain) arenaMain.style.display = "grid";
  if (headerControls) headerControls.style.display = "inline-flex";

  setTimeout(() => {
    resizeCanvas();
    updateUI();
  }, 10);
}

function useBackend() {
  return isServerAvailable && !isMultiplayerActive && !useClientEngineOverride && currentRuleVariant === "freestyle" && currentSeriesTarget <= 1;
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
  if (window.CaroEngine && !clientEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => {
      if (!useBackend()) handleStateUpdate(state);
    };
    gameState = clientEngine.getState();
    rebuildSymbolMap();
  }
  setupEventListeners();
  if (typeof initMultiplayerIntegration === "function") {
    initMultiplayerIntegration();
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const confCanvas = document.getElementById("confetti-canvas");
  if (confCanvas) confettiEngine = new ConfettiEngine(confCanvas);

  const urlParams = new URLSearchParams(window.location.search);
  const hasSavedMpRoom = (() => {
    try { return Boolean(sessionStorage.getItem("caro_active_room")); } catch { return false; }
  })();

  // Default Start Page is the Lobby Start Screen unless already in a multiplayer room or URL deep-link
  if (!hasSavedMpRoom && !urlParams.get("room") && !urlParams.get("replay_data") && !urlParams.get("replay") && !urlParams.get("autoplay") && !isMultiplayerActive) {
    showLobbyHomeScreen();
  }

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
  } else {
    console.log("Caro Arena: Running in standalone In-Browser Engine mode (GitHub Pages compatible)");
  }

  await fetchLeaderboard();
  await fetchBattleHistory();
  updateRosterCount();

  // Only overwrite gameState from initial fetch if the user hasn't already started a match or left the lobby
  if (isOnLobbyStartScreen || useBackend()) {
    await fetchState();
  }

  const replayDataParam = urlParams.get("replay_data");
  if (replayDataParam) {
    enterArenaBattleground();
    startReplayFromData(replayDataParam);
    return;
  }
  const replayParam = urlParams.get("replay");
  if (replayParam) {
    enterArenaBattleground();
    await startReplay(replayParam);
    return;
  }
  if (urlParams.get("autoplay") === "1" || urlParams.get("autoplay") === "true") {
    enterArenaBattleground();
    setTimeout(() => toggleAutoPlay(), 300);
    return;
  }

  // Ensure initial game matches checked roster (only if still on lobby or untouched initial state)
  const selected = getSelectedRoster();
  const currentTypes = (gameState?.players || []).map(p => p.type).sort();
  const selectedSorted = [...selected].sort();
  if (isOnLobbyStartScreen && !hasSavedMpRoom && !isMultiplayerActive && gameState && (gameState.board?.move_count === 0 || gameState.status === "ready") && JSON.stringify(currentTypes) !== JSON.stringify(selectedSorted)) {
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
      if (!useBackend()) return;
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

let _hasReceivedInitialState = false;
let _trackedGameId = null;
let _trackedMoveCount = 0;
let _trackedPlacementsCount = 0;
let _trackedFinished = false;

function handleStateUpdate(data) {
  if (isReplayMode || !data) return;
  const wasInitialFetch = !_hasReceivedInitialState;
  _hasReceivedInitialState = true;
  const wasFinished = _trackedFinished;
  const isNewGame = Boolean(_trackedGameId && data.game_id && data.game_id !== _trackedGameId);
  const prevMoveCount = isNewGame ? 0 : _trackedMoveCount;
  const newMoveCount = data?.board?.moves?.length || 0;
  const prevPlacementsCount = isNewGame ? 0 : _trackedPlacementsCount;
  const newPlacements = data?.board?.placements || [];

  _trackedGameId = data.game_id || _trackedGameId;
  _trackedMoveCount = newMoveCount;
  _trackedPlacementsCount = newPlacements.length;
  _trackedFinished = data.status === "finished";

  gameState = data;
  if (isNewGame) {
    userInteractedWithCamera = false;
    stoneSpawnTimes.clear();
    boardRipples = [];
    boardSparks = [];
    highlightedMoveCoord = null;
    pendingConfirmCoord = null;
  } else if (newMoveCount > prevMoveCount) {
    pendingConfirmCoord = null;
  }
  rebuildSymbolMap();

  // Trigger stone placement spring & shockwave ripple for newly played moves
  if (!wasInitialFetch && newMoveCount > prevMoveCount && Array.isArray(data.board?.moves)) {
    const startIdx = Math.max(prevMoveCount, newMoveCount - 2);
    for (let i = startIdx; i < newMoveCount; i++) {
      const m = data.board.moves[i];
      if (m) triggerStonePlacementFx(m.row, m.col, m.player);
    }
    const latestM = data.board.moves[newMoveCount - 1];
    if (latestM && userInteractedWithCamera && !isDragging && canvas) {
      const pt = boardToScreen(latestM.row, latestM.col);
      const margin = 36;
      if (pt.x < margin || pt.x > canvas.width - margin || pt.y < margin || pt.y > canvas.height - margin) {
        panCameraToCoord(latestM.row, latestM.col);
      }
    }
  }

  // Trigger winning line radial spark burst for newly achieved 5-in-a-row placements
  if (!wasInitialFetch && newPlacements.length > prevPlacementsCount) {
    for (let i = prevPlacementsCount; i < newPlacements.length; i++) {
      const pl = newPlacements[i];
      if (pl?.winning_line) {
        triggerWinningLineBurstFx(pl.winning_line, pl.symbol || pl.player);
      }
    }
  }

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

  // Human turn chime & board glow (only alert when it is the local player's turn)
  const isHumanTurn = isMultiplayerActive
    ? (data.current_player?.symbol === myMultiplayerSymbol && data.status !== "finished")
    : (data.is_human_turn && data.status !== "finished");
  const canvasWrap = document.getElementById("canvas-wrap") || canvas?.parentElement;
  if (canvasWrap) {
    canvasWrap.classList.toggle("human-turn-glow", Boolean(isHumanTurn));
  }
  if (isHumanTurn && !lastWasHumanTurn) {
    const turnBanner = document.getElementById("turn-banner");
    if (turnBanner && !prefersReducedMotion()) {
      turnBanner.classList.remove("turn-pulse");
      void turnBanner.offsetWidth;
      turnBanner.classList.add("turn-pulse");
    }
    if (typeof window.CaroAudio?.playHumanTurnAlert === "function") {
      try {
        window.CaroAudio.playHumanTurnAlert();
      } catch (err) {
        console.warn("Audio chime failed:", err);
      }
    }
  }
  lastWasHumanTurn = isHumanTurn;

  if (data.status === "finished" && (!wasFinished || isNewGame)) {
    fetchLeaderboard();
    fetchBattleHistory();
    try { window.CaroAudio?.playChampionshipFanfare?.(); } catch {}
    if (confettiEngine && !prefersReducedMotion()) confettiEngine.launch(3000);

    const placements = data.board?.placements || [];
    const firstPlace = placements.find(pl => pl.rank === 1) || placements[0];
    const winSym = firstPlace?.player || firstPlace?.symbol;

    if (isMultiplayerActive && winSym && window.CaroMultiplayer?.isHost && _sessionWinRecordedForGameId !== data.game_id) {
      _sessionWinRecordedForGameId = data.game_id;
      const winMeta = getPlayerMeta(winSym);
      const bn = data.series?.battle_number || data.battle_number || 1;
      window.CaroMultiplayer.recordSessionWin?.(winSym, winMeta.name, bn);
      updateMultiplayerHudBadges();
    }

    // Daily Puzzle completion reward
    if (data.puzzle && data.puzzle_solved && _puzzleSolvedRecordedForGameId !== data.game_id) {
      _puzzleSolvedRecordedForGameId = data.game_id;
      const pStats = window.CaroEngine?.ClientStorage?.recordPuzzleSolved?.(data.puzzle.id);
      if (window.CaroAuth?.adjustCranes) {
        window.CaroAuth.adjustCranes(15, "daily_puzzle_solved").then(() => {
          showArenaToast(`Puzzle solved: ${data.puzzle.title} — +15 Cranes (Streak: ${pStats?.streak || 1})`);
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        }).catch(() => {});
      }
      if (typeof renderDailyPuzzleBadge === "function") renderDailyPuzzleBadge();
    } else if (!wasInitialFetch && window.CaroAuth?.adjustCranes && winSym) {
      // Award Cranes for 1st-place victory when local human wins
      if (isMultiplayerActive && myMultiplayerSymbol && winSym === myMultiplayerSymbol) {
        const potBonus = Number(currentMatchWagerPot) || 0;
        const totalReward = 25 + potBonus;
        window.CaroAuth.adjustCranes(totalReward, "multiplayer_win_1st").then(() => {
          showArenaToast(`1st place — +${totalReward} Cranes awarded${potBonus > 0 ? ` (includes ${potBonus} pot)` : ""}`);
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        }).catch(() => {});
      } else if (!isMultiplayerActive && symbolMap[winSym]?.type === "human") {
        window.CaroAuth.adjustCranes(10, "solo_practice_win_1st").then(() => {
          showArenaToast("1st place — +10 Cranes awarded");
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        }).catch(() => {});
      }
    }

    // Series Champion bonus reward
    if (data.series?.series_champion && _seriesChampionRecordedForGameId !== data.game_id) {
      _seriesChampionRecordedForGameId = data.game_id;
      const champSym = data.series.series_champion;
      const champMeta = getPlayerMeta(champSym);
      if (symbolMap[champSym]?.type === "human" && window.CaroAuth?.adjustCranes) {
        window.CaroAuth.adjustCranes(15, "series_champion_bonus").then(() => {
          showArenaToast(`🏆 Series Champion: ${champMeta.name}! +15 bonus Cranes`);
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        }).catch(() => {});
      } else {
        showArenaToast(`🏆 Series Champion: ${champMeta.name}!`);
      }
    }

    if (typeof renderCareerStats === "function") {
      renderCareerStats();
    }
  }
}

function attemptHumanBoardMove(r, c) {
  const moves = gameState?.board?.moves || [];
  const occupied = moves.some(m => m.row === r && m.col === c);
  if (occupied) return;

  if (isTwoTapConfirm) {
    if (!pendingConfirmCoord || pendingConfirmCoord.r !== r || pendingConfirmCoord.c !== c) {
      pendingConfirmCoord = { r, c };
      hoverCoord = { r, c };
      const promptEl = document.getElementById("human-prompt-text") || document.querySelector(".human-prompt-text");
      if (promptEl) {
        promptEl.textContent = `Target (${r}, ${c}) selected — tap (${r}, ${c}) again to place stone`;
      }
      renderBoard();
      startFxAnimation();
      return;
    }
  }

  pendingConfirmCoord = null;
  sendHumanMove(r, c);
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

  // Lobby Start Screen & Practice Arena Navigation
  const goHomeToLobby = () => {
    if (isReplayMode) exitReplayMode();
    if (window.CaroMultiplayer?.roomId) {
      window.CaroMultiplayer.leaveRoom();
    }
    showLobbyHomeScreen();
  };
  document.getElementById("btn-home-lobby")?.addEventListener("click", goHomeToLobby);
  document.getElementById("brand-logo-home")?.addEventListener("click", goHomeToLobby);
  document.getElementById("btn-enter-practice-arena")?.addEventListener("click", () => {
    enterArenaBattleground();
  });

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
  const svgSoundOn = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
  const svgSoundOff = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
  if (soundBtn) {
    soundBtn.innerHTML = (window.CaroAudio && window.CaroAudio.enabled) ? svgSoundOn : svgSoundOff;
    soundBtn.addEventListener("click", () => {
      if (!window.CaroAudio) return;
      const on = window.CaroAudio.toggle();
      soundBtn.innerHTML = on ? svgSoundOn : svgSoundOff;
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
  document.getElementById("toggle-trail")?.addEventListener("change", e => { showTrail = e.target.checked; renderBoard(); });
  document.getElementById("toggle-coords")?.addEventListener("change", e => { showCoords = e.target.checked; renderBoard(); });
  document.getElementById("toggle-minimap")?.addEventListener("change", e => { showMinimap = e.target.checked; renderBoard(); });
  document.getElementById("toggle-heatmap")?.addEventListener("change", e => {
    showHeatmap = e.target.checked;
    renderBoard();
    if (showHeatmap || showLasers) startFxAnimation();
  });

  // Off-screen latest move pill click -> pan camera to latest move
  document.getElementById("offscreen-move-pill")?.addEventListener("click", (e) => {
    const r = Number(e.currentTarget.dataset.row);
    const c = Number(e.currentTarget.dataset.col);
    if (Number.isFinite(r) && Number.isFinite(c)) {
      panCameraToCoord(r, c);
    }
  });

  // Minimap click / drag to pan camera
  const minimapEl = document.getElementById("board-minimap");
  if (minimapEl) {
    let isMinimapDragging = false;
    const panFromMinimapEvent = (evt) => {
      if (!_lastMinimapBounds) return;
      const rect = minimapEl.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (evt.clientX - rect.left) / Math.max(1, rect.width)));
      const ny = Math.max(0, Math.min(1, (evt.clientY - rect.top) / Math.max(1, rect.height)));
      const targetC = Math.round(_lastMinimapBounds.minC + nx * _lastMinimapBounds.spanC);
      const targetR = Math.round(_lastMinimapBounds.minR + ny * _lastMinimapBounds.spanR);
      panCameraToCoord(targetR, targetC);
    };
    minimapEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      isMinimapDragging = true;
      panFromMinimapEvent(e);
    });
    window.addEventListener("mousemove", (e) => {
      if (isMinimapDragging) panFromMinimapEvent(e);
    });
    window.addEventListener("mouseup", () => {
      isMinimapDragging = false;
    });
  }

  // Precision 2-Tap Move Confirmation toggle
  const twoTapToggle = document.getElementById("toggle-twotap");
  if (twoTapToggle) {
    try { isTwoTapConfirm = localStorage.getItem("caro_twotap_confirm") === "true"; } catch {}
    twoTapToggle.checked = isTwoTapConfirm;
    twoTapToggle.addEventListener("change", e => {
      isTwoTapConfirm = Boolean(e.target.checked);
      pendingConfirmCoord = null;
      try { localStorage.setItem("caro_twotap_confirm", isTwoTapConfirm ? "true" : "false"); } catch {}
      updateHumanTurnBar();
      renderBoard();
    });
  }

  // Board Cosmetic Theme selector in board footer
  const themeSelect = document.getElementById("select-board-theme");
  if (themeSelect && window.CaroAuth) {
    themeSelect.value = window.CaroAuth.getSelectedTheme();
    themeSelect.addEventListener("change", async (e) => {
      const targetTheme = e.target.value;
      if (window.CaroAuth.isThemeUnlocked(targetTheme)) {
        window.CaroAuth.setSelectedTheme(targetTheme);
        if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        renderBoard();
      } else {
        try {
          await window.CaroAuth.unlockTheme(targetTheme);
          const meta = window.CaroAuth.BOARD_THEMES_CATALOG?.[targetTheme];
          showArenaToast(`Unlocked and equipped ${meta?.name || targetTheme}`);
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
          renderBoard();
        } catch (err) {
          showArenaToast(err.message);
          themeSelect.value = window.CaroAuth.getSelectedTheme();
        }
      }
    });
  }

  // Stone Cosmetic Finish selector in board footer
  const stoneSelect = document.getElementById("select-stone-style");
  if (stoneSelect && window.CaroAuth) {
    stoneSelect.value = window.CaroAuth.getSelectedStoneStyle();
    stoneSelect.addEventListener("change", async (e) => {
      const targetStyle = e.target.value;
      if (window.CaroAuth.isStoneStyleUnlocked(targetStyle)) {
        window.CaroAuth.setSelectedStoneStyle(targetStyle);
        if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
        renderBoard();
      } else {
        try {
          await window.CaroAuth.unlockStoneStyle(targetStyle);
          const meta = window.CaroAuth.STONE_STYLES_CATALOG?.[targetStyle];
          showArenaToast(`Unlocked and equipped ${meta?.name || targetStyle}`);
          if (typeof renderLobbyHomeWalletAndThemes === "function") renderLobbyHomeWalletAndThemes();
          renderBoard();
        } catch (err) {
          showArenaToast(err.message);
          stoneSelect.value = window.CaroAuth.getSelectedStoneStyle();
        }
      }
    });
  }

  // Synthesized Sound Pack selector in board footer (Feature 8)
  const soundPackSelect = document.getElementById("select-sound-pack");
  if (soundPackSelect && window.CaroAudio) {
    soundPackSelect.value = window.CaroAudio.getSoundPack?.() || "wood";
    soundPackSelect.addEventListener("change", (e) => {
      const pack = window.CaroAudio.setSoundPack?.(e.target.value) || e.target.value;
      try {
        window.CaroAudio.ensureContext?.();
        window.CaroAudio.playStoneClick?.("human");
      } catch {}
      const label = window.CaroAudio.SOUND_PACKS?.[pack]?.name || pack;
      showArenaToast(`Sound pack: ${label}`);
    });
  }

  // Rule Variant & Best-of-N Series selectors in Arena sidebar (Features 2 & 3)
  const ruleSelect = document.getElementById("select-rule-variant");
  if (ruleSelect) {
    ruleSelect.value = currentRuleVariant;
    ruleSelect.addEventListener("change", (e) => {
      setRuleVariantUI(e.target.value, true);
    });
  }

  const seriesSelect = document.getElementById("select-series-target");
  if (seriesSelect) {
    seriesSelect.value = String(currentSeriesTarget);
    seriesSelect.addEventListener("change", (e) => {
      setSeriesTargetUI(Number(e.target.value) || 1, true);
    });
  }

  // Keyboard Shortcuts Modal (Feature 10)
  const shortcutsModal = document.getElementById("modal-shortcuts");
  const openShortcutsBtn = document.getElementById("btn-open-shortcuts");
  const closeShortcutsBtn = document.getElementById("btn-close-shortcuts-modal");
  openShortcutsBtn?.addEventListener("click", () => {
    if (shortcutsModal) shortcutsModal.style.display = "flex";
  });
  closeShortcutsBtn?.addEventListener("click", () => {
    if (shortcutsModal) shortcutsModal.style.display = "none";
  });
  shortcutsModal?.addEventListener("click", (e) => {
    if (e.target.id === "modal-shortcuts") shortcutsModal.style.display = "none";
  });

  // Copy Move Coordinates button (Feature 10)
  document.getElementById("btn-copy-moves")?.addEventListener("click", copyMovesCoordinateNotation);

  // Post-Match Rematch Vote & Next Puzzle buttons (Features 4 & 7)
  document.getElementById("btn-rematch-vote")?.addEventListener("click", handleRematchAction);
  document.getElementById("btn-next-puzzle")?.addEventListener("click", () => {
    launchNextDailyPuzzle();
  });

  document.getElementById("btn-zoom-in")?.addEventListener("click", () => zoomCamera(1.2));
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => zoomCamera(0.833));
  document.getElementById("btn-recenter")?.addEventListener("click", recenterCamera);
  document.getElementById("btn-tab-moves")?.addEventListener("click", () => switchHistoryTab("moves"));
  document.getElementById("btn-tab-battles")?.addEventListener("click", () => switchHistoryTab("battles"));

  // Interactive Move History Hover & Click-to-Locate delegation
  const moveListEl = document.getElementById("move-list");
  if (moveListEl) {
    const activateMoveItemHighlight = (item) => {
      if (!item) return;
      const r = Number(item.dataset.row);
      const c = Number(item.dataset.col);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      const meta = getPlayerMeta(item.dataset.player);
      highlightedMoveCoord = {
        r,
        c,
        moveNumber: Number(item.dataset.move) || null,
        color: meta.color || "#f59e0b"
      };
      renderBoard();
      startFxAnimation();
    };
    const clearMoveItemHighlight = () => {
      if (!highlightedMoveCoord) return;
      highlightedMoveCoord = null;
      renderBoard();
    };
    moveListEl.addEventListener("mouseover", e => {
      const item = e.target.closest(".move-item[data-row]");
      if (item) activateMoveItemHighlight(item);
    });
    moveListEl.addEventListener("mouseout", e => {
      const related = e.relatedTarget?.closest?.(".move-item[data-row]");
      if (!related) clearMoveItemHighlight();
    });
    moveListEl.addEventListener("focusin", e => {
      const item = e.target.closest(".move-item[data-row]");
      if (item) activateMoveItemHighlight(item);
    });
    moveListEl.addEventListener("focusout", () => clearMoveItemHighlight());
    moveListEl.addEventListener("click", e => {
      const item = e.target.closest(".move-item[data-row]");
      if (!item) return;
      const r = Number(item.dataset.row);
      const c = Number(item.dataset.col);
      if (Number.isFinite(r) && Number.isFinite(c)) {
        activateMoveItemHighlight(item);
        panCameraToCoord(r, c);
        triggerStonePlacementFx(r, c, item.dataset.player);
      }
    });
    moveListEl.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        const item = e.target.closest(".move-item[data-row]");
        if (item) {
          e.preventDefault();
          item.click();
        }
      }
    });
  }

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

  // Keyboard shortcuts (Replay, Shortcuts Modal, & Accessible Board Navigation)
  window.addEventListener("keydown", e => {
    const tag = (e.target?.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) {
      return;
    }

    // ? key toggles Keyboard Shortcuts Modal anywhere outside inputs
    if (e.key === "?") {
      e.preventDefault();
      if (shortcutsModal) {
        const isVis = shortcutsModal.style.display === "flex";
        shortcutsModal.style.display = isVis ? "none" : "flex";
      }
      return;
    }

    // Escape closes Shortcuts Modal if open
    if (e.key === "Escape" && shortcutsModal && shortcutsModal.style.display === "flex") {
      e.preventDefault();
      shortcutsModal.style.display = "none";
      return;
    }

    // Ignore if any modal is open or on Lobby Start Screen
    const openModal = document.querySelector('.modal-backdrop[style*="display: flex"]');
    if (openModal || isOnLobbyStartScreen) return;

    if (isReplayMode) {
      if (e.key === "ArrowLeft") { e.preventDefault(); stepReplay(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepReplay(1); }
      else if (e.key === "Escape") { e.preventDefault(); exitReplayMode(); }
      return;
    }

    if (e.key === "z" || e.key === "Z" || e.key === "u" || e.key === "U") {
      e.preventDefault();
      undoHumanMove();
      return;
    }
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      document.getElementById("btn-sound")?.click();
      return;
    }
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      document.getElementById("btn-fullscreen")?.click();
      return;
    }

    const isCanvasFocused = document.activeElement === canvas;
    const canHumanMove = isLocalHumanAllowedToMove();

    if (isCanvasFocused || canHumanMove) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (!hoverCoord) {
          const moves = gameState?.board?.moves || [];
          const lastM = moves.length ? moves[moves.length - 1] : null;
          hoverCoord = lastM ? { r: lastM.row, c: lastM.col } : { r: 0, c: 0 };
        } else {
          if (e.key === "ArrowUp") hoverCoord = { r: hoverCoord.r - 1, c: hoverCoord.c };
          else if (e.key === "ArrowDown") hoverCoord = { r: hoverCoord.r + 1, c: hoverCoord.c };
          else if (e.key === "ArrowLeft") hoverCoord = { r: hoverCoord.r, c: hoverCoord.c - 1 };
          else if (e.key === "ArrowRight") hoverCoord = { r: hoverCoord.r, c: hoverCoord.c + 1 };
        }
        updateGhostHudForHoverCoord();
        renderBoard();
        startFxAnimation();
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && canHumanMove && hoverCoord && (isCanvasFocused || !e.target.closest("button, a, [role='button']"))) {
        e.preventDefault();
        attemptHumanBoardMove(hoverCoord.r, hoverCoord.c);
        return;
      }
    }

    if (isCanvasFocused) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomCamera(1.2); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomCamera(0.833); }
      else if (e.key === "0" || e.key === "c" || e.key === "C") { e.preventDefault(); recenterCamera(); }
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
        attemptHumanBoardMove(coord.r, coord.c);
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

async function newBattle(options = {}) {
  try { window.CaroAudio?.ensureContext?.(); } catch {}
  if (isReplayMode) exitReplayMode();
  if (isMultiplayerActive) {
    if (window.CaroMultiplayer?.isHost) {
      startNextMultiplayerBattle(options);
    }
    return;
  }
  useClientEngineOverride = Boolean(options.keepOverride);
  const selected = Array.isArray(options.customPlayerOrder) && options.customPlayerOrder.length >= 2
    ? options.customPlayerOrder
    : getSelectedRoster();
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
    if (isServerAvailable && gameState?.is_auto_playing) {
      apiFetch("/api/battle/auto-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
      }).catch(() => {});
    }
    clientEngine.setRuleVariant(currentRuleVariant);
    clientEngine.setSeriesTarget(currentSeriesTarget);
    const shouldShuffle = !(Array.isArray(options.customPlayerOrder) && options.customPlayerOrder.length >= 2);
    const nextState = clientEngine.newGame(selected, shouldShuffle);
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
        clientEngine.resetSeries();
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
function normalizeMovePattern(rawPat) {
  if (!rawPat) return null;
  if (typeof rawPat === "object" && rawPat.label) return rawPat;
  const label = String(rawPat);
  let tier = "info";
  if (label === "5-in-a-Row") tier = "win";
  else if (label === "4×3 Fork" || label === "Open-4" || label === "Double-3 Fork") tier = "critical";
  else if (label === "Block-4") tier = "defense";
  return { label, tier };
}

function ensureMovesHavePatterns(moves, players, ruleVariant = "freestyle") {
  if (!Array.isArray(moves) || moves.length === 0) return;
  if (!window.CaroEngine?.TacticalEvaluator?.detectMovePattern || !window.CaroEngine?.CaroBoard) return;
  const needsCompute = moves.some(m => !m.metadata || m.metadata.pattern === undefined || typeof m.metadata.pattern === "string");
  if (!needsCompute) return;
  const symbols = (players || []).map(p => p.symbol);
  const tempBoard = new window.CaroEngine.CaroBoard(symbols.length ? symbols : ["A", "B", "C", "D"], ruleVariant);
  for (const m of moves) {
    m.metadata = m.metadata || {};
    if (m.metadata.pattern === undefined) {
      const raw = window.CaroEngine.TacticalEvaluator.detectMovePattern(tempBoard, m.row, m.col, m.player);
      m.metadata.pattern = normalizeMovePattern(raw);
    } else if (typeof m.metadata.pattern === "string") {
      m.metadata.pattern = normalizeMovePattern(m.metadata.pattern);
    }
    tempBoard.makeMove(m.row, m.col, m.player, m.metadata);
  }
}

function updateUI() {
  if (!gameState) return;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState?.board?.moves || []);
  const players = isReplayMode ? replayPlayers : (gameState?.players || []);
  const ruleVariant = gameState?.board?.rule_variant || currentRuleVariant || "freestyle";
  ensureMovesHavePatterns(moves, players, ruleVariant);

  updateTurnBanner();
  updateSeriesAndRuleBadge();
  updateAutoPlayButton();
  updateHumanTurnBar();
  updateRematchBar();
  renderEvalPressureBar();
  renderPlayerLegend();
  renderBattleRoster();
  renderBoard();
  updateMoveHistory();
  renderTacticalMomentumGraph();
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
    if (gameState?.puzzle && gameState?.status !== "finished") {
      promptText.textContent = `Daily Puzzle: ${gameState.puzzle.title} — ${gameState.puzzle.objective}`;
    } else {
      promptText.textContent = canUndoAfterFinish
        ? "Match finished — Undo your last move to continue playing"
        : "Your Turn — Click any empty intersection to place your stone";
    }
  }

  bar.classList.toggle("active", showBar);
  bar.style.display = showBar ? "flex" : "none";
}

function updateTurnBanner() {
  const dot = document.getElementById("turn-dot");
  const text = document.getElementById("turn-text");
  if (!dot || !text) return;

  const activeMoves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState?.board?.moves || []);
  const lastMove = activeMoves.length > 0 ? activeMoves[activeMoves.length - 1] : null;
  const lastPat = normalizeMovePattern(lastMove?.metadata?.pattern);
  const lastPatternLabel = lastPat?.label ? ` · ${lastPat.label}` : "";

  if (isReplayMode) {
    dot.style.background = "#94a3b8";
    text.textContent = `Replay ${replayIndex} / ${replayMoves.length}${lastPatternLabel}`;
    return;
  }

  if (gameState.puzzle && gameState.status !== "finished") {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color || "#d97706";
    text.textContent = `Puzzle: ${gameState.puzzle.title} · Your turn!`;
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
      text.textContent = `Battle #${bn} · Turn ${moveNum} · Your Turn!${lastPatternLabel}`;
      updateMultiplayerHudStatus(`Your turn! Click empty cell to place stone`);
    } else if (!myMultiplayerSymbol) {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · Spectating (${curr.name})${lastPatternLabel}`;
      updateMultiplayerHudStatus(`Spectating · ${curr.name}'s turn`);
    } else if (curr.type === "human") {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name}'s turn${lastPatternLabel}`;
      updateMultiplayerHudStatus(`Waiting for ${curr.name}...`);
    } else {
      text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name} (AI) thinking...`;
      updateMultiplayerHudStatus(`${curr.name} (AI) thinking...`);
    }
  } else if (gameState.is_human_turn) {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color || "#d97706";
    text.textContent = `Battle #${bn} · Your turn!${lastPatternLabel}`;
  } else if (gameState.is_thinking) {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color;
    text.textContent = `Battle #${bn} · ${gameState.thinking_player || curr.name} thinking...`;
  } else {
    const curr = getPlayerMeta(gameState.current_player?.symbol);
    dot.style.background = curr.color;
    const moveNum = (gameState.board?.move_count || 0) + 1;
    text.textContent = `Battle #${bn} · Turn ${moveNum} · ${curr.name}${lastPatternLabel}`;
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
    const rankNum = i + 1;
    const isLeader = i === 0 && totalBattles > 0;
    return `<tr class="${isLeader ? "leader" : ""}">
      <td class="rank-cell mono">${rankNum}</td>
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
      statusText = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
      statusClass = rank === 1 ? "winner" : "eliminated";
    } else if (isHumanWaiting) {
      statusText = "Your turn";
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
      ? `<button class="btn btn-xs btn-ghost btn-roster-takeover" data-symbol="${escapeHtml(p.symbol)}" title="Request host approval to take over this player slot">Takeover</button>`
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

function renderLobbyHomeRecentBattles(battles) {
  const container = document.getElementById("lobby-home-recent-battles");
  const countBadge = document.getElementById("lobby-home-recent-count");
  const list = Array.isArray(battles) ? battles.slice(0, 3) : [];
  if (countBadge) {
    countBadge.textContent = `${list.length} recent`;
  }
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div class="mp-empty-rooms">No completed battles yet.</div>`;
    return;
  }
  container.innerHTML = "";
  list.forEach(b => {
    const p = b.placements || [];
    const winner = p.find(x => x.rank === 1) || p[0];
    const winnerMeta = winner ? (PLAYER_COLORS[winner.type] || { fill: "#94a3b8", name: winner.name || winner.type || "Winner" }) : null;
    const winnerName = winner?.name || winnerMeta?.name || "Draw";
    const winnerDot = winnerMeta
      ? `<span class="model-dot" style="background:${escapeHtml(winnerMeta.fill)}"></span>`
      : "";
    const safeBattleId = escapeHtml(b.battle_id);
    const totalMoves = Number(b.total_moves ?? (b.moves_data ? b.moves_data.length : 0)) || 0;

    const item = document.createElement("div");
    item.className = "lobby-recent-battle-item";
    item.innerHTML = `
      <div class="lobby-recent-battle-meta">
        <span class="mono" style="font-weight:700;color:var(--text-primary);">#${safeBattleId}</span>
        <span>${winnerDot}<strong>${escapeHtml(winnerName)}</strong></span>
        <span class="mono muted">· ${totalMoves} moves</span>
      </div>
      <button type="button" class="btn btn-secondary btn-xs btn-lobby-recent-replay" data-battle-id="${safeBattleId}">Replay</button>
    `;
    item.querySelector(".btn-lobby-recent-replay")?.addEventListener("click", () => {
      startReplay(b.battle_id);
    });
    container.appendChild(item);
  });
}

function renderBattleHistory(battles) {
  cachedRecentBattles = Array.isArray(battles) ? battles : [];
  renderLobbyHomeRecentBattles(cachedRecentBattles);
  if (typeof renderCareerStats === "function") {
    renderCareerStats();
  }
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

  const lastIdx = moves.length - 1;
  list.innerHTML = moves.map((m, idx) => {
    const meta = getPlayerMeta(m.player);
    const lat = m.metadata?.latency_ms ? `${m.metadata.latency_ms}ms` : "";
    const latestCls = idx === lastIdx ? " is-latest" : "";
    const pat = normalizeMovePattern(m.metadata?.pattern);
    const patHtml = (pat && pat.label)
      ? `<span class="move-pattern-badge tier-${escapeHtml(pat.tier || "info")}">${escapeHtml(pat.label)}</span>`
      : "";
    return `<li class="move-item${latestCls}" data-row="${escapeHtml(m.row)}" data-col="${escapeHtml(m.col)}" data-move="${escapeHtml(m.move_number)}" data-player="${escapeHtml(m.player)}" tabindex="0" role="button" title="Click to locate move #${escapeHtml(m.move_number)} at (${escapeHtml(m.row)}, ${escapeHtml(m.col)})">
      <span class="mono" style="color: ${escapeHtml(meta.color)}; font-weight: 600;">#${escapeHtml(m.move_number)}</span>
      <span style="font-weight: 600;">${escapeHtml(meta.name)}</span>
      <span class="mono">(${escapeHtml(m.row)}, ${escapeHtml(m.col)})</span>
      ${patHtml}
      <span class="mono muted" style="margin-left: auto;">${escapeHtml(lat)}</span>
    </li>`;
  }).join("");

  list.scrollTop = list.scrollHeight;
}

// ─────────────────────────────────────────
// Camera Controls & Smooth Interpolation
// ─────────────────────────────────────────
function zoomCamera(factor) {
  userInteractedWithCamera = true;
  cameraTarget.active = false;
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

function panCameraToCoord(r, c) {
  userInteractedWithCamera = true;
  const targetZoom = Math.max(camera.zoom, 0.9);
  const targetX = canvas.width / 2 - c * camera.baseCellSize * targetZoom;
  const targetY = canvas.height / 2 - r * camera.baseCellSize * targetZoom;
  if (prefersReducedMotion() || window._testInstantPan) {
    camera.x = targetX;
    camera.y = targetY;
    camera.zoom = targetZoom;
    cameraTarget.active = false;
    renderBoard();
  } else {
    cameraTarget = { x: targetX, y: targetY, zoom: targetZoom, active: true };
    startFxAnimation();
  }
}

function stepCameraInterpolation() {
  if (!cameraTarget.active) return;
  if (prefersReducedMotion()) {
    camera.x = cameraTarget.x;
    camera.y = cameraTarget.y;
    camera.zoom = cameraTarget.zoom;
    cameraTarget.active = false;
    return;
  }
  const dx = cameraTarget.x - camera.x;
  const dy = cameraTarget.y - camera.y;
  const dz = cameraTarget.zoom - camera.zoom;
  if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35 && Math.abs(dz) < 0.002) {
    camera.x = cameraTarget.x;
    camera.y = cameraTarget.y;
    camera.zoom = cameraTarget.zoom;
    cameraTarget.active = false;
  } else {
    camera.x += dx * 0.22;
    camera.y += dy * 0.22;
    camera.zoom += dz * 0.22;
  }
}

function autoScaleCamera(force = false) {
  if (userInteractedWithCamera && !force) return;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves || [];
  if (moves.length === 0) {
    camera.x = canvas.width / 2;
    camera.y = canvas.height / 2;
    camera.zoom = 1.0;
    cameraTarget.active = false;
    _lastAutoScaleMoveCount = 0;
    return;
  }

  if (!force && moves.length === _lastAutoScaleMoveCount) {
    stepCameraInterpolation();
    return;
  }
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

  if (force || prefersReducedMotion()) {
    camera.zoom = targetZoom;
    camera.x = targetX;
    camera.y = targetY;
    cameraTarget = { x: targetX, y: targetY, zoom: targetZoom, active: false };
  } else {
    cameraTarget = { x: targetX, y: targetY, zoom: targetZoom, active: true };
    stepCameraInterpolation();
    startFxAnimation();
  }
}

function boardToScreen(r, c) { const cs = camera.baseCellSize * camera.zoom; return { x: camera.x + c * cs, y: camera.y + r * cs }; }
function screenToBoard(sx, sy) { const cs = camera.baseCellSize * camera.zoom; return { r: Math.round((sy - camera.y) / cs) || 0, c: Math.round((sx - camera.x) / cs) || 0 }; }

function updateGhostHudForHoverCoord(clientX = null, clientY = null) {
  const hud = document.getElementById("ghost-hud");
  if (!hud) return;
  const isAllowedToMove = isLocalHumanAllowedToMove();
  if (!hoverCoord || !isAllowedToMove || !window.CaroEngine?.TacticalEvaluator) {
    hud.style.display = "none";
    return;
  }
  const moves = gameState?.board?.moves || [];
  const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
  if (occupied) {
    hud.style.display = "none";
    return;
  }
  const boardObj = (!useBackend() && clientEngine) ? clientEngine.board : reconstructBoardFromState(gameState);
  if (!boardObj) {
    hud.style.display = "none";
    return;
  }
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
  const rect = canvas.getBoundingClientRect();
  if (clientX !== null && clientY !== null) {
    hud.style.left = `${clientX - rect.left}px`;
    hud.style.top = `${clientY - rect.top}px`;
  } else {
    const pt = boardToScreen(hoverCoord.r, hoverCoord.c);
    const scX = rect.width / (canvas.width || 1);
    const scY = rect.height / (canvas.height || 1);
    hud.style.left = `${pt.x * scX}px`;
    hud.style.top = `${pt.y * scY}px`;
  }
}

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
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged = true;
      userInteractedWithCamera = true;
      cameraTarget.active = false;
    }
    camera.x = camStartX + dx; camera.y = camStartY + dy;
    renderBoard();
  } else {
    if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) {
      hoverCoord = screenToBoard(sx, sy);
      const isAllowedToMove = isLocalHumanAllowedToMove();
      canvas.style.cursor = isAllowedToMove ? "pointer" : "crosshair";
      updateGhostHudForHoverCoord(e.clientX, e.clientY);
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
          attemptHumanBoardMove(coord.r, coord.c);
        }
      }
    }
  }
}

function onWheel(e) {
  e.preventDefault();
  userInteractedWithCamera = true;
  cameraTarget.active = false;
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

function reconstructBoardFromState(state, movesOverride = null) {
  if (!window.CaroEngine?.CaroBoard || !state?.board) return null;
  const srcPlayers = (isReplayMode && replayPlayers.length >= 2) ? replayPlayers : (state.players || []);
  const symbols = srcPlayers.map(p => p.symbol);
  const b = new window.CaroEngine.CaroBoard(
    symbols.length ? symbols : ["A", "B"],
    state.rule_variant || currentRuleVariant || "freestyle"
  );
  const moves = Array.isArray(movesOverride) ? movesOverride : (state.board.moves || []);
  for (const m of moves) {
    b.makeMove(m.row, m.col, m.player, m.metadata);
  }
  return b;
}

function getBoardEvalCache() {
  if (!window.CaroEngine?.TacticalEvaluator || !gameState?.board) return null;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState.board.moves || []);
  const lastMove = moves.length ? moves[moves.length - 1] : null;
  const currentSymbol = gameState.board.current_player || "A";
  const key = `${gameState.game_id || ""}:${isReplayMode ? "R" + replayIndex : moves.length}:${lastMove ? `${lastMove.row},${lastMove.col}` : ""}:${currentSymbol}`;
  if (_cachedEvalState.key !== key) {
    const boardObj = (!isReplayMode && !useBackend() && clientEngine)
      ? clientEngine.board
      : reconstructBoardFromState(gameState, moves);
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
  const pulse = prefersReducedMotion() ? 0.5 : (Math.sin(now / 180) + 1) / 2;

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
  const reduced = prefersReducedMotion();
  const pulse = reduced ? 0.5 : (Math.sin(now / 150) + 1) / 2;
  const fastPulse = reduced ? 0.5 : (Math.sin(now / 70) + 1) / 2;

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

function drawBoardRipples(cs, now = performance.now()) {
  if (boardRipples.length === 0) return;
  ctx.save();
  const remaining = [];
  for (const rp of boardRipples) {
    const elapsed = now - rp.createdAt;
    if (elapsed < 0 || elapsed >= rp.duration) continue;
    remaining.push(rp);
    const t = elapsed / rp.duration;
    const easeOut = 1 - Math.pow(1 - t, 3);
    const pt = boardToScreen(rp.row, rp.col);

    // Primary expanding shockwave ring
    const r1 = cs * (0.42 + easeOut * 0.85);
    ctx.strokeStyle = rp.color;
    ctx.lineWidth = Math.max(1.2, (2.8 * (1 - t)) * camera.zoom);
    ctx.globalAlpha = Math.max(0, (1 - t) * 0.85);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r1, 0, Math.PI * 2);
    ctx.stroke();

    // Secondary trailing inner ring
    if (t > 0.12) {
      const t2 = (t - 0.12) / 0.88;
      const ease2 = 1 - Math.pow(1 - t2, 2);
      const r2 = cs * (0.40 + ease2 * 0.52);
      ctx.lineWidth = Math.max(1.0, (1.6 * (1 - t2)) * camera.zoom);
      ctx.globalAlpha = Math.max(0, (1 - t2) * 0.5);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  boardRipples = remaining;
  ctx.restore();
}

function drawBoardSparks(cs, now = performance.now()) {
  if (boardSparks.length === 0) return;
  ctx.save();
  const remaining = [];
  for (const sp of boardSparks) {
    const elapsed = now - sp.createdAt;
    if (elapsed < 0 || elapsed >= sp.duration) continue;
    remaining.push(sp);
    const t = elapsed / sp.duration;
    const ease = 1 - Math.pow(1 - t, 2);
    const origin = boardToScreen(sp.row, sp.col);
    const dist = ease * cs * 0.95;
    const x = origin.x + sp.vx * dist;
    const y = origin.y + sp.vy * dist;
    const radius = Math.max(0.8, sp.size * (1 - t * 0.7) * camera.zoom);

    ctx.fillStyle = sp.color;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.shadowColor = sp.color;
    ctx.shadowBlur = 6 * camera.zoom;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  boardSparks = remaining;
  ctx.restore();
}

function drawHighlightedMoveBeacon(cs, now = performance.now()) {
  if (!highlightedMoveCoord) return;
  const { r, c, moveNumber, color } = highlightedMoveCoord;
  const pt = boardToScreen(r, c);
  const pulse = prefersReducedMotion() ? 0.5 : (Math.sin(now / 140) + 1) / 2;

  ctx.save();
  ctx.strokeStyle = color || "#f59e0b";
  ctx.shadowColor = color || "#f59e0b";
  ctx.shadowBlur = 12 * camera.zoom;
  ctx.lineWidth = 2.6 * camera.zoom;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, cs * (0.52 + pulse * 0.08), 0, Math.PI * 2);
  ctx.stroke();

  // Outer dashed locator brackets
  ctx.setLineDash([4 * camera.zoom, 3 * camera.zoom]);
  ctx.lineWidth = 1.6 * camera.zoom;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, cs * (0.68 + pulse * 0.05), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Coordinate callout tag above stone
  const label = moveNumber ? `#${moveNumber} (${r}, ${c})` : `(${r}, ${c})`;
  ctx.font = `700 ${Math.max(10, Math.round(10.5 * camera.zoom))}px var(--font-mono, monospace)`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = 10 * camera.zoom;
  const w = ctx.measureText(label).width + padX;
  const h = Math.max(16, 18 * camera.zoom);
  const tagY = pt.y - cs * 0.85;

  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(pt.x - w / 2, tagY - h / 2, w, h, 999);
  } else {
    ctx.rect(pt.x - w / 2, tagY - h / 2, w, h);
  }
  ctx.fill();
  ctx.strokeStyle = color || "#fbbf24";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 0;
  ctx.fillText(label, pt.x, tagY);
  ctx.restore();
}

let fxAnimId = null;
function hasActiveBoardAnimations() {
  if (prefersReducedMotion()) {
    return Boolean(cameraTarget.active);
  }
  return Boolean(
    showHeatmap ||
    showLasers ||
    (hoverCoord && isLocalHumanAllowedToMove()) ||
    pendingConfirmCoord !== null ||
    cameraTarget.active ||
    boardRipples.length > 0 ||
    boardSparks.length > 0 ||
    highlightedMoveCoord !== null ||
    hasActiveStoneSpring()
  );
}

function startFxAnimation() {
  if (fxAnimId) return;
  function fxLoop() {
    if (hasActiveBoardAnimations()) {
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
  stepCameraInterpolation();
  const W = canvas.width, H = canvas.height, cs = camera.baseCellSize * camera.zoom;
  const nowPerf = performance.now();
  const themeId = window.CaroAuth?.getSelectedTheme() || "classic";
  const themePalette = BOARD_THEMES_PALETTES[themeId] || BOARD_THEMES_PALETTES.classic;

  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.85);
  grad.addColorStop(0, themePalette.bgStops[0]);
  grad.addColorStop(0.6, themePalette.bgStops[1]);
  grad.addColorStop(1, themePalette.bgStops[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const minC = Math.floor(-camera.x / cs) - 1, maxC = Math.ceil((W - camera.x) / cs) + 1;
  const minR = Math.floor(-camera.y / cs) - 1, maxR = Math.ceil((H - camera.y) / cs) + 1;
  ctx.strokeStyle = themePalette.grid;
  ctx.lineWidth = Math.max(1, 1.1 * camera.zoom);
  for (let r = minR; r <= maxR; r++) { const y = camera.y + r * cs; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let c = minC; c <= maxC; c++) { const x = camera.x + c * cs; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

  // Hoshi star points
  if (camera.zoom > 0.35) {
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      if (r % 4 === 0 && c % 4 === 0) {
        const pt = boardToScreen(r, c);
        ctx.fillStyle = themePalette.star;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (r === 0 && c === 0 ? 3.4 : 2.2) * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Origin marker
  const o = boardToScreen(0, 0);
  ctx.strokeStyle = themePalette.star;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(o.x - 6, o.y); ctx.lineTo(o.x + 6, o.y); ctx.moveTo(o.x, o.y - 6); ctx.lineTo(o.x, o.y + 6); ctx.stroke();

  // Coordinates
  if (showCoords && camera.zoom >= 0.5) {
    ctx.fillStyle = themePalette.coord;
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

  // Draw stones (with spring scale-pop for newly placed stones) & Recent Trail
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves || [];
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  const activePlayersList = isReplayMode ? replayPlayers : (gameState?.players || []);
  const trailSpan = Math.max(2, activePlayersList.length || 2);
  const recentTrailMoves = moves.slice(Math.max(0, moves.length - trailSpan));
  const recentTrailSet = new Set(recentTrailMoves.map(m => `${m.row},${m.col}`));

  if (showTrail && recentTrailMoves.length >= 2) {
    drawRecentMoveTrail(recentTrailMoves, cs, themeId);
  }

  moves.forEach(m => {
    const isRecent = recentTrailSet.has(`${m.row},${m.col}`);
    drawStone(m.row, m.col, m.player, cs, m.move_number, nowPerf, isRecent);
  });

  // Expanding stone placement shockwave ripples
  drawBoardRipples(cs, nowPerf);

  // Live Threat Lasers (renders dynamic active threat beams over stones)
  if (showLasers && !isReplayMode && gameState?.board) {
    drawActiveThreatLasers(cs);
  }

  // Replay Mode Candidate & Missed-Defense Overlay
  if (isReplayMode) {
    drawReplayCandidateHints(cs);
  } else {
    const analysisPill = document.getElementById("replay-analysis-pill");
    if (analysisPill) analysisPill.style.display = "none";
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
      const pulseTime = prefersReducedMotion() ? 0 : Date.now() / 200;
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

  // 2-Tap Precision Confirmation Reticle
  if (pendingConfirmCoord && isLocalHumanAllowedToMove()) {
    const pt = boardToScreen(pendingConfirmCoord.r, pendingConfirmCoord.c);
    const pulse = prefersReducedMotion() ? 0.5 : (Math.sin(nowPerf / 120) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = "#10b981";
    ctx.shadowColor = "#10b981";
    ctx.shadowBlur = 10 * camera.zoom;
    ctx.lineWidth = 2.6 * camera.zoom;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, cs * (0.48 + pulse * 0.06), 0, Math.PI * 2);
    ctx.stroke();

    const lbl = `Confirm (${pendingConfirmCoord.r}, ${pendingConfirmCoord.c})`;
    ctx.font = `700 ${Math.max(10, Math.round(10 * camera.zoom))}px var(--font-sans, sans-serif)`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(lbl).width + 14;
    const h = 20;
    const tagY = pt.y - cs * 0.85;
    ctx.fillStyle = "rgba(6, 78, 59, 0.94)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pt.x - w / 2, tagY - h / 2, w, h, 999);
    else ctx.rect(pt.x - w / 2, tagY - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 0;
    ctx.fillText(lbl, pt.x, tagY);
    ctx.restore();
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

  // Move-list hover/click locator beacon
  drawHighlightedMoveBeacon(cs, nowPerf);

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

      // 2. Bold, high-contrast laser strike-through line + travelling plasma orb
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

        // Travelling high-energy plasma pulse along the winning beam
        if (!prefersReducedMotion()) {
          const sweepPhase = (Math.sin(nowPerf / 260) + 1) / 2;
          const orbX = startX + (endX - startX) * sweepPhase;
          const orbY = startY + (endY - startY) * sweepPhase;
          const orbGrad = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 10 * camera.zoom);
          orbGrad.addColorStop(0, "rgba(255, 255, 255, 0.98)");
          orbGrad.addColorStop(0.45, "rgba(251, 191, 36, 0.85)");
          orbGrad.addColorStop(1, "rgba(245, 158, 11, 0)");
          ctx.fillStyle = orbGrad;
          ctx.beginPath();
          ctx.arc(orbX, orbY, 10 * camera.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
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
      const rankText = `#${pl.rank || 1} ${meta.name} · ${lineLen} in a row`;

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

  // Radial winning-line spark burst particles
  drawBoardSparks(cs, nowPerf);

  // Off-screen latest move edge pill & Minimap radar
  updateOffscreenMovePill(lastMove, W, H);
  renderBoardMinimap(moves, minR, maxR, minC, maxC, themePalette);
}

let _lastMinimapBounds = null;

function updateOffscreenMovePill(lastMove, W, H) {
  const pill = document.getElementById("offscreen-move-pill");
  if (!pill) return;
  if (!lastMove || !W || !H) {
    pill.style.display = "none";
    return;
  }
  const pt = boardToScreen(lastMove.row, lastMove.col);
  const pad = 18;
  const isOffscreen = pt.x < pad || pt.x > W - pad || pt.y < pad || pt.y > H - pad;
  if (!isOffscreen) {
    pill.style.display = "none";
    return;
  }
  pill.dataset.row = String(lastMove.row);
  pill.dataset.col = String(lastMove.col);
  pill.textContent = `Last move (${lastMove.row}, ${lastMove.col}) →`;
  pill.style.display = "inline-flex";
}

function renderBoardMinimap(moves, viewMinR, viewMaxR, viewMinC, viewMaxC, themePalette) {
  const mm = document.getElementById("board-minimap");
  if (!mm) return;
  if (!showMinimap || !Array.isArray(moves) || moves.length < 2) {
    mm.style.display = "none";
    _lastMinimapBounds = null;
    return;
  }
  mm.style.display = "block";
  const mCtx = mm.getContext("2d");
  const W = mm.width || 96;
  const H = mm.height || 96;

  let bMinR = 0, bMaxR = 0, bMinC = 0, bMaxC = 0;
  moves.forEach((m, i) => {
    if (i === 0) {
      bMinR = bMaxR = m.row;
      bMinC = bMaxC = m.col;
    } else {
      if (m.row < bMinR) bMinR = m.row;
      if (m.row > bMaxR) bMaxR = m.row;
      if (m.col < bMinC) bMinC = m.col;
      if (m.col > bMaxC) bMaxC = m.col;
    }
  });

  const pad = 6;
  bMinR = Math.min(bMinR - pad, viewMinR);
  bMaxR = Math.max(bMaxR + pad, viewMaxR);
  bMinC = Math.min(bMinC - pad, viewMinC);
  bMaxC = Math.max(bMaxC + pad, viewMaxC);

  const span = Math.max(16, bMaxR - bMinR + 1, bMaxC - bMinC + 1);
  const midR = (bMinR + bMaxR) / 2;
  const midC = (bMinC + bMaxC) / 2;
  const minR = midR - span / 2;
  const minC = midC - span / 2;
  _lastMinimapBounds = { minR, minC, spanR: span, spanC: span };

  mCtx.clearRect(0, 0, W, H);
  mCtx.fillStyle = themePalette?.bgStops?.[1] || "#ecc483";
  mCtx.fillRect(0, 0, W, H);

  // Subtle origin crosshair on minimap
  const ox = ((0 - minC) / span) * W;
  const oy = ((0 - minR) / span) * H;
  mCtx.strokeStyle = "rgba(120, 113, 108, 0.35)";
  mCtx.lineWidth = 1;
  mCtx.beginPath();
  mCtx.moveTo(ox, 0); mCtx.lineTo(ox, H);
  mCtx.moveTo(0, oy); mCtx.lineTo(W, oy);
  mCtx.stroke();

  // Draw stones
  moves.forEach((m, idx) => {
    const x = ((m.col - minC) / span) * W;
    const y = ((m.row - minR) / span) * H;
    const meta = getPlayerMeta(m.player);
    mCtx.fillStyle = meta.color || "#d97706";
    mCtx.beginPath();
    mCtx.arc(x, y, idx === moves.length - 1 ? 3.2 : 2.2, 0, Math.PI * 2);
    mCtx.fill();
    if (idx === moves.length - 1) {
      mCtx.strokeStyle = "#ffffff";
      mCtx.lineWidth = 1.2;
      mCtx.stroke();
    }
  });

  // Draw current viewport box
  const vx = Math.max(0, ((viewMinC - minC) / span) * W);
  const vy = Math.max(0, ((viewMinR - minR) / span) * H);
  const vw = Math.min(W - vx, ((viewMaxC - viewMinC) / span) * W);
  const vh = Math.min(H - vy, ((viewMaxR - viewMinR) / span) * H);
  mCtx.strokeStyle = "rgba(180, 83, 9, 0.9)";
  mCtx.lineWidth = 1.5;
  mCtx.strokeRect(vx, vy, Math.max(8, vw), Math.max(8, vh));
}

function drawRecentMoveTrail(recentMoves, cs, themeId) {
  if (!Array.isArray(recentMoves) || recentMoves.length < 2) return;
  ctx.save();
  const isDarkTheme = themeId === "obsidian" || themeId === "cyber";
  ctx.strokeStyle = isDarkTheme ? "rgba(226, 232, 240, 0.55)" : "rgba(41, 37, 36, 0.48)";
  ctx.lineWidth = Math.max(1.3, 1.8 * camera.zoom);
  ctx.setLineDash([4 * camera.zoom, 3 * camera.zoom]);
  ctx.beginPath();
  recentMoves.forEach((m, idx) => {
    const pt = boardToScreen(m.row, m.col);
    if (idx === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawStone(r, c, symbol, cs, moveNumber, nowPerf = performance.now(), isRecentTrail = false) {
  const pt = boardToScreen(r, c);
  let scale = 1.0;
  if (!prefersReducedMotion()) {
    const spawnedAt = stoneSpawnTimes.get(`${r},${c}`);
    if (spawnedAt !== undefined) {
      const elapsed = nowPerf - spawnedAt;
      const duration = 260;
      if (elapsed >= 0 && elapsed < duration) {
        const t = elapsed / duration;
        // Spring easeOutBack curve (overshoots slightly to ~1.13 then settles to 1.0)
        const c1 = 2.4;
        const c3 = c1 + 1;
        const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        scale = Math.max(0.25, 0.25 + 0.75 * eased);
      } else if (elapsed >= duration) {
        stoneSpawnTimes.delete(`${r},${c}`);
      }
    }
  }

  const radius = cs * 0.42 * scale;
  const meta = getPlayerMeta(symbol);
  const body = meta.body || STONE_STYLES.laya.body;
  const textCol = meta.text || "#fff";
  const stoneFinish = window.CaroAuth?.getSelectedStoneStyle?.() || "classic";

  ctx.save();
  ctx.shadowColor = "rgba(60, 30, 10, 0.35)";
  ctx.shadowBlur = (stoneFinish === "matte" ? 3 : 5) * camera.zoom * scale;
  ctx.shadowOffsetX = 1.2 * camera.zoom * scale;
  ctx.shadowOffsetY = 2.2 * camera.zoom * scale;

  if (stoneFinish === "matte") {
    // Velvet matte ceramic disc with soft inner bevel
    ctx.fillStyle = body[1];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
    ctx.lineWidth = Math.max(1, 1.4 * camera.zoom);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius * 0.84, 0, Math.PI * 2);
    ctx.stroke();
  } else if (stoneFinish === "shell") {
    // Shell & Slate with subtle concentric grain bands
    const stoneGrad = ctx.createRadialGradient(
      pt.x - radius * 0.25, pt.y - radius * 0.25, radius * 0.05,
      pt.x, pt.y, radius
    );
    stoneGrad.addColorStop(0, body[2]);
    stoneGrad.addColorStop(0.65, body[1]);
    stoneGrad.addColorStop(1, body[0]);
    ctx.fillStyle = stoneGrad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = Math.max(0.9, 1.1 * camera.zoom);
    for (const frac of [0.52, 0.76]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius * frac, -0.7, 1.8);
      ctx.stroke();
    }
  } else if (stoneFinish === "mono") {
    // High-contrast editorial ring finish
    ctx.fillStyle = body[0];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = Math.max(1.2, 1.8 * camera.zoom);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Classic 3D Glazed Stone
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
  }

  ctx.restore();

  const shouldDrawNumber = (showMoveNumbers || (showTrail && isRecentTrail)) && moveNumber !== null && camera.zoom > 0.38;
  if (shouldDrawNumber) {
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

// ─────────────────────────────────────────
// Post-Match & Replay Tactical Momentum Graph
// ─────────────────────────────────────────
let _cachedMomentumKey = null;
let _cachedMomentumData = null;

function computeTacticalMomentumSeries(moves, players, placements) {
  const symbols = (players || []).map(p => p.symbol);
  if (!symbols.length || !Array.isArray(moves) || moves.length === 0) {
    return { points: [], turningPoints: [] };
  }
  const winMovesByNumber = new Map();
  for (const pl of (placements || [])) {
    if (pl.move_number) winMovesByNumber.set(Number(pl.move_number), pl);
  }

  const grid = new Map();
  const scoresBySymbol = {};
  symbols.forEach(s => { scoresBySymbol[s] = 0; });
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const points = [];
  const turningPoints = [];

  moves.forEach((m, idx) => {
    const r = Number(m.row) || 0;
    const c = Number(m.col) || 0;
    const sym = m.player;
    const moveNum = m.move_number || (idx + 1);
    grid.set(`${r},${c}`, sym);

    let maxLen = 1;
    let openEndsForMax = 0;
    let totalGain = 10;

    for (const [dr, dc] of dirs) {
      let count = 1;
      let step = 1;
      while (grid.get(`${r + dr * step},${c + dc * step}`) === sym) { count++; step++; }
      const openPos = !grid.has(`${r + dr * step},${c + dc * step}`);
      step = 1;
      while (grid.get(`${r - dr * step},${c - dc * step}`) === sym) { count++; step++; }
      const openNeg = !grid.has(`${r - dr * step},${c - dc * step}`);
      const openEnds = (openPos ? 1 : 0) + (openNeg ? 1 : 0);

      if (count >= 5) totalGain += 450;
      else if (count === 4 && openEnds === 2) totalGain += 240;
      else if (count === 4 && openEnds === 1) totalGain += 120;
      else if (count === 3 && openEnds === 2) totalGain += 85;
      else if (count === 3 && openEnds === 1) totalGain += 30;
      else if (count === 2 && openEnds === 2) totalGain += 18;

      if (count > maxLen || (count === maxLen && openEnds > openEndsForMax)) {
        maxLen = count;
        openEndsForMax = openEnds;
      }
    }

    scoresBySymbol[sym] = (scoresBySymbol[sym] || 0) + totalGain;
    const snapshot = Object.assign({}, scoresBySymbol);
    points.push({
      moveNumber: moveNum,
      row: r,
      col: c,
      player: sym,
      gain: totalGain,
      maxLen,
      openEnds: openEndsForMax,
      scores: snapshot
    });

    const winPl = winMovesByNumber.get(moveNum);
    if (winPl || maxLen >= 5) {
      turningPoints.push({
        moveNumber: moveNum,
        row: r,
        col: c,
        player: sym,
        label: `#${moveNum} Win`,
        priority: 3
      });
    } else if (maxLen === 4 && openEndsForMax >= 1) {
      turningPoints.push({
        moveNumber: moveNum,
        row: r,
        col: c,
        player: sym,
        label: `#${moveNum} ${openEndsForMax === 2 ? "Open-4" : "Four"}`,
        priority: 2
      });
    } else if (maxLen === 3 && openEndsForMax === 2 && turningPoints.length < 4) {
      turningPoints.push({
        moveNumber: moveNum,
        row: r,
        col: c,
        player: sym,
        label: `#${moveNum} Open-3`,
        priority: 1
      });
    }
  });

  // Keep top 4 most critical turning points sorted by moveNumber
  const selectedTurning = turningPoints
    .sort((a, b) => b.priority - a.priority || a.moveNumber - b.moveNumber)
    .slice(0, 4)
    .sort((a, b) => a.moveNumber - b.moveNumber);

  return { points, turningPoints: selectedTurning };
}

function jumpToTacticalMove(moveNumber, row, col, playerSymbol) {
  const meta = getPlayerMeta(playerSymbol);
  if (isReplayMode) {
    replayIndex = Math.max(1, Math.min(replayMoves.length, Number(moveNumber) || 1));
    const lbl = document.getElementById("replay-label");
    if (lbl) lbl.textContent = `Move ${replayIndex} of ${replayMoves.length}`;
  }
  highlightedMoveCoord = { r: row, c: col, moveNumber, color: meta.color };
  panCameraToCoord(row, col);
  updateUI();
  startFxAnimation();
}

function renderTacticalMomentumGraph() {
  const bar = document.getElementById("tactical-graph-bar");
  const spCanvas = document.getElementById("tactical-sparkline-canvas");
  const tpContainer = document.getElementById("tactical-turning-points");
  if (!bar || !spCanvas) return;

  const isFinished = gameState?.status === "finished";
  const moves = isReplayMode ? replayMoves : (gameState?.board?.moves || []);
  const players = isReplayMode ? replayPlayers : (gameState?.players || []);
  const placements = isReplayMode ? replayPlacements : (gameState?.board?.placements || []);

  if ((!isReplayMode && !isFinished) || !Array.isArray(moves) || moves.length < 2) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  const cacheKey = `${isReplayMode ? "replay" : (gameState?.game_id || "live")}:${moves.length}:${(placements || []).length}`;
  if (_cachedMomentumKey !== cacheKey || !_cachedMomentumData) {
    _cachedMomentumKey = cacheKey;
    _cachedMomentumData = computeTacticalMomentumSeries(moves, players, placements);
  }

  const { points, turningPoints } = _cachedMomentumData;
  const sCtx = spCanvas.getContext("2d");
  const W = spCanvas.width || 240;
  const H = spCanvas.height || 34;
  sCtx.clearRect(0, 0, W, H);

  // Subtle baseline grid
  sCtx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  sCtx.lineWidth = 1;
  sCtx.beginPath();
  sCtx.moveTo(0, H / 2);
  sCtx.lineTo(W, H / 2);
  sCtx.stroke();

  let maxScore = 100;
  for (const pt of points) {
    for (const val of Object.values(pt.scores)) {
      if (val > maxScore) maxScore = val;
    }
  }

  const symbols = (players || []).map(p => p.symbol);
  const padX = 6;
  const padY = 4;
  const plotW = Math.max(10, W - padX * 2);
  const plotH = Math.max(10, H - padY * 2);

  // Draw momentum curve per player
  symbols.forEach(sym => {
    const meta = getPlayerMeta(sym);
    sCtx.save();
    sCtx.strokeStyle = meta.color || "#0891b2";
    sCtx.lineWidth = 1.8;
    sCtx.beginPath();
    points.forEach((pt, idx) => {
      const x = padX + (points.length > 1 ? (idx / (points.length - 1)) * plotW : plotW / 2);
      const ratio = Math.min(1, (pt.scores[sym] || 0) / maxScore);
      const y = padY + plotH * (1 - ratio);
      if (idx === 0) sCtx.moveTo(x, y);
      else sCtx.lineTo(x, y);
    });
    sCtx.stroke();
    sCtx.restore();
  });

  // Draw current replay cursor or highlighted move marker
  const activeMoveIdx = isReplayMode
    ? Math.max(0, Math.min(points.length - 1, replayIndex - 1))
    : (highlightedMoveCoord?.moveNumber ? highlightedMoveCoord.moveNumber - 1 : points.length - 1);
  if (points[activeMoveIdx]) {
    const curX = padX + (points.length > 1 ? (activeMoveIdx / (points.length - 1)) * plotW : plotW / 2);
    sCtx.save();
    sCtx.strokeStyle = "#f59e0b";
    sCtx.lineWidth = 1.5;
    sCtx.beginPath();
    sCtx.moveTo(curX, 0);
    sCtx.lineTo(curX, H);
    sCtx.stroke();
    sCtx.restore();
  }

  // Click sparkline to scrub to move
  if (!spCanvas.dataset.boundClick) {
    spCanvas.dataset.boundClick = "1";
    spCanvas.addEventListener("click", (e) => {
      if (!_cachedMomentumData?.points?.length) return;
      const rect = spCanvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const idx = Math.round(ratio * (_cachedMomentumData.points.length - 1));
      const target = _cachedMomentumData.points[idx];
      if (target) {
        jumpToTacticalMove(target.moveNumber, target.row, target.col, target.player);
      }
    });
  }

  // Turning point pills
  if (tpContainer) {
    tpContainer.innerHTML = "";
    turningPoints.forEach(tp => {
      const meta = getPlayerMeta(tp.player);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "turning-point-pill";
      btn.style.borderLeft = `3px solid ${meta.color || "#d97706"}`;
      btn.textContent = tp.label;
      btn.title = `${meta.name} at (${tp.row}, ${tp.col}) — Click to inspect`;
      btn.addEventListener("click", () => {
        jumpToTacticalMove(tp.moveNumber, tp.row, tp.col, tp.player);
      });
      tpContainer.appendChild(btn);
    });
  }
}

function applyReplayBattleObject(b) {
  if (!b) return false;
  if (isOnLobbyStartScreen) {
    enterArenaBattleground();
  }
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
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
  return url;
}

function toggleReplayHints() {
  showReplayHints = !showReplayHints;
  const btn = document.getElementById("btn-replay-hints");
  if (btn) {
    btn.classList.toggle("btn-active", showReplayHints);
    btn.textContent = showReplayHints ? "Hints: On" : "Hints";
  }
  renderBoard();
}

let _cachedReplayHintKey = null;
let _cachedReplayHintData = null;

function computeReplayMoveAnalysis() {
  if (!isReplayMode || !Array.isArray(replayMoves) || replayMoves.length === 0 || replayIndex < 1) {
    return null;
  }
  if (!window.CaroEngine?.TacticalEvaluator || !window.CaroEngine?.CaroBoard) {
    return null;
  }
  const actualMove = replayMoves[replayIndex - 1];
  if (!actualMove) return null;

  const key = `${replayMoves.length}:${replayIndex}:${actualMove.row},${actualMove.col}:${actualMove.player}`;
  if (_cachedReplayHintKey === key && _cachedReplayHintData) {
    return _cachedReplayHintData;
  }

  const symbols = (replayPlayers || []).map(p => p.symbol);
  const boardBefore = new window.CaroEngine.CaroBoard(symbols.length ? symbols : ["A", "B", "C", "D"]);
  for (let i = 0; i < replayIndex - 1; i++) {
    const m = replayMoves[i];
    boardBefore.makeMove(m.row, m.col, m.player, m.metadata);
  }

  let topCandidates = [];
  let actualEval = { total_score: 0, summary: "" };
  let missedCritical = false;

  if (boardBefore.stones.size === 0) {
    topCandidates = [{ row: 0, col: 0, total_score: 100, summary: "Center opening" }];
    actualEval = { total_score: actualMove.row === 0 && actualMove.col === 0 ? 100 : 50, summary: "Opening" };
  } else {
    topCandidates = window.CaroEngine.TacticalEvaluator.getRankedCandidates(boardBefore, actualMove.player, 3, 2) || [];
    actualEval = window.CaroEngine.TacticalEvaluator.evaluateMove(
      boardBefore,
      actualMove.row,
      actualMove.col,
      actualMove.player
    ) || { total_score: 0, summary: "" };
    const best = topCandidates[0];
    const bestScore = Number(best?.total_score ?? best?.score) || 0;
    const actualScore = Number(actualEval?.total_score ?? actualEval?.score) || 0;
    const playedBest = best && best.row === actualMove.row && best.col === actualMove.col;
    if (best && !playedBest && bestScore >= 15000 && (bestScore - actualScore) >= 6000) {
      missedCritical = true;
    }
  }

  _cachedReplayHintKey = key;
  _cachedReplayHintData = { actualMove, topCandidates, actualEval, missedCritical };
  return _cachedReplayHintData;
}

function drawReplayCandidateHints(cs) {
  const pill = document.getElementById("replay-analysis-pill");
  const analysis = computeReplayMoveAnalysis();
  if (!analysis) {
    if (pill) pill.style.display = "none";
    return;
  }

  const { actualMove, topCandidates, missedCritical } = analysis;
  const best = topCandidates[0];
  const bestScore = Number(best?.total_score ?? best?.score) || 0;

  if (pill) {
    if (missedCritical && best) {
      pill.style.display = "inline-flex";
      pill.className = "replay-analysis-pill missed";
      const kind = bestScore >= 80000 ? "win" : "defense";
      pill.textContent = `Missed ${kind} at (${best.row}, ${best.col})`;
    } else if (showReplayHints && best) {
      pill.style.display = "inline-flex";
      pill.className = "replay-analysis-pill";
      const matched = best.row === actualMove.row && best.col === actualMove.col;
      pill.textContent = matched
        ? `Best #1 played (${best.row}, ${best.col})`
        : `Best #1: (${best.row}, ${best.col}) · Played (${actualMove.row}, ${actualMove.col})`;
    } else {
      pill.style.display = "none";
    }
  }

  if (!showReplayHints || !Array.isArray(topCandidates) || topCandidates.length === 0) {
    return;
  }

  ctx.save();
  topCandidates.slice(0, 3).forEach((cand, idx) => {
    const rank = idx + 1;
    const pt = boardToScreen(cand.row, cand.col);
    const isRank1 = rank === 1;
    const strokeCol = (isRank1 && missedCritical)
      ? "#b91c1c"
      : (isRank1 ? "#047857" : "#b45309");

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = (isRank1 ? 2.2 : 1.5) * camera.zoom;
    ctx.setLineDash([4 * camera.zoom, 3 * camera.zoom]);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, cs * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small candidate rank tag (#1, #2, #3)
    const label = `#${rank}`;
    ctx.font = `700 ${Math.max(9, Math.round(10 * camera.zoom))}px var(--font-mono, monospace)`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tagW = Math.max(20, 22 * camera.zoom);
    const tagH = Math.max(14, 15 * camera.zoom);
    const tagX = pt.x + cs * 0.34;
    const tagY = pt.y - cs * 0.34;

    ctx.fillStyle = strokeCol;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tagX - tagW / 2, tagY - tagH / 2, tagW, tagH, 4);
    else ctx.rect(tagX - tagW / 2, tagY - tagH / 2, tagW, tagH);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, tagX, tagY);
  });
  ctx.restore();
}

function downloadBoardSnapshot() {
  if (!canvas) return null;
  renderBoard();

  const bn = gameState?.series?.battle_number || gameState?.battle_number || 1;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState?.board?.moves || []);
  const players = isReplayMode ? replayPlayers : (gameState?.players || []);
  const playerNames = players.map(p => getPlayerMeta(p.symbol).name).join(" vs ");

  const headerH = 38;
  const footerH = 30;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height + headerH + footerH;
  const oCtx = out.getContext("2d");

  oCtx.fillStyle = "#1c1917";
  oCtx.fillRect(0, 0, out.width, out.height);
  oCtx.drawImage(canvas, 0, headerH);

  // Header stamp
  oCtx.fillStyle = "#fafaf9";
  oCtx.font = "700 13px 'Plus Jakarta Sans', sans-serif";
  oCtx.textBaseline = "middle";
  oCtx.textAlign = "left";
  oCtx.fillText(`Caro Arena · ${isReplayMode ? `Replay (${moves.length} moves)` : `Battle #${bn}`}`, 14, headerH / 2);

  oCtx.fillStyle = "#d6d3d1";
  oCtx.font = "500 11px 'JetBrains Mono', monospace";
  oCtx.textAlign = "right";
  oCtx.fillText(playerNames || "Free-for-All", out.width - 14, headerH / 2);

  // Footer stamp
  const turnText = document.getElementById("turn-text")?.textContent || "";
  oCtx.fillStyle = "#a8a29e";
  oCtx.font = "500 11px 'JetBrains Mono', monospace";
  oCtx.textAlign = "left";
  oCtx.fillText(`${moves.length} moves · ${turnText}`, 14, headerH + canvas.height + footerH / 2);

  const dataUrl = out.toDataURL("image/png");
  window._lastBoardSnapshotDataUrl = dataUrl;

  try {
    const link = document.createElement("a");
    link.download = `caro-arena-battle-${bn}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {}

  showArenaToast("Saved board snapshot PNG");
  return dataUrl;
}

function playFromReplayState() {
  const sourceMoves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState?.board?.moves || []);
  const sourcePlayers = (isReplayMode && replayPlayers.length >= 2) ? replayPlayers : (gameState?.players || []);
  if (!sourcePlayers || sourcePlayers.length < 2) return null;

  if (isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }

  if (!clientEngine && window.CaroEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => {
      if (!useBackend()) handleStateUpdate(state);
    };
  }
  if (!clientEngine) return null;

  useClientEngineOverride = true;
  isReplayMode = false;
  replayMoves = [];
  replayIndex = 0;
  replayPlayers = [];
  replayPlacements = [];
  highlightedMoveCoord = null;

  const pill = document.getElementById("replay-analysis-pill");
  if (pill) pill.style.display = "none";
  const bar = document.getElementById("replay-bar");
  if (bar) bar.style.display = "none";
  const autoBtn = document.getElementById("btn-auto");
  if (autoBtn) autoBtn.disabled = false;

  const branchedState = clientEngine.branchFromMoves(sourcePlayers, sourceMoves, currentRuleVariant);

  // Sync sidebar checkboxes to match branched players
  const activeTypes = new Set((branchedState.players || []).map(p => p.type));
  document.querySelectorAll("#roster-config .roster-toggle").forEach(label => {
    const cb = label.querySelector("input");
    if (cb) cb.checked = activeTypes.has(label.dataset.model);
  });
  updateRosterCount();

  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(branchedState);
  showArenaToast(`Branched at move ${sourceMoves.length} — your turn!`);
  return branchedState;
}

function copyMovesCoordinateNotation() {
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState?.board?.moves || []);
  if (!Array.isArray(moves) || moves.length === 0) {
    showArenaToast("No moves to copy yet.");
    window._lastCopiedMovesText = "";
    return "";
  }
  const text = moves.map((m, idx) => `${m.move_number || (idx + 1)}. ${m.player}(${m.row},${m.col})`).join(" ");
  window._lastCopiedMovesText = text;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  const btn = document.getElementById("btn-copy-moves");
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }
  showArenaToast(`Copied ${moves.length} move coordinates`);
  return text;
}

function setRuleVariantUI(variant, startFreshIfIdle = true) {
  const valid = ["freestyle", "blocked_ends", "exact5"];
  const v = valid.includes(variant) ? variant : "freestyle";
  currentRuleVariant = v;

  ["select-rule-variant", "lobby-home-rule-select", "mp-room-rule-select"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== v) el.value = v;
  });

  if (clientEngine) {
    clientEngine.setRuleVariant(v);
  }
  if (isMultiplayerActive && window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
    window.CaroMultiplayer.setRoomMeta({ ruleVariant: v });
  }
  updateSeriesAndRuleBadge();

  if (!isMultiplayerActive && startFreshIfIdle) {
    const label = v === "blocked_ends" ? "Caro (Blocked Ends)" : v === "exact5" ? "Exact-5" : "Freestyle (5+)";
    showArenaToast(`Rule variant: ${label}`);
    if (!gameState || gameState.board?.move_count === 0 || gameState.status === "finished" || gameState.status === "ready") {
      newBattle();
    }
  }
}

function setSeriesTargetUI(targetWins, resetScores = true) {
  const t = Math.max(1, Math.min(5, Number(targetWins) || 1));
  currentSeriesTarget = t;

  ["select-series-target", "lobby-home-series-select", "mp-room-series-select"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== String(t)) el.value = String(t);
  });

  if (clientEngine) {
    clientEngine.setSeriesTarget(t);
    if (resetScores) clientEngine.resetSeries();
  }
  if (isMultiplayerActive && window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
    window.CaroMultiplayer.setRoomMeta({ seriesTargetWins: t });
  }
  updateSeriesAndRuleBadge();

  if (!isMultiplayerActive && resetScores) {
    const label = t === 2 ? "Best of 3 (First to 2)" : t === 3 ? "Best of 5 (First to 3)" : "Single Game";
    showArenaToast(`Series format: ${label}`);
    if (t > 1 && (!gameState || gameState.board?.move_count === 0 || gameState.status === "finished" || gameState.status === "ready")) {
      newBattle();
    }
  }
}

function updateSeriesAndRuleBadge() {
  const badge = document.getElementById("series-score-badge");
  if (!badge) return;

  const series = clientEngine?.getState()?.series || gameState?.series || {};
  const target = Number(series.series_target_wins || series.target_wins || currentSeriesTarget) || 1;
  const rule = currentRuleVariant || gameState?.board?.rule_variant || "freestyle";

  const parts = [];
  if (rule === "blocked_ends") parts.push("Blocked-Ends");
  else if (rule === "exact5") parts.push("Exact-5");

  if (target > 1) {
    const boLabel = target === 2 ? "Bo3" : target === 3 ? "Bo5" : `First to ${target}`;
    const scores = series.series_scores || series.scores || {};
    const players = (isReplayMode ? replayPlayers : gameState?.players) || [];
    const scoreItems = players.slice(0, 4).map(p => {
      const shortName = getPlayerMeta(p.symbol).name.replace(/\s*\(AI\)$/i, "").split(" ")[0];
      return `${shortName} ${scores[p.symbol] || 0}`;
    });
    const scoreText = scoreItems.length > 0 ? scoreItems.join("–") : "0–0";
    const champ = series.series_champion || series.champion;
    if (champ) {
      const champMeta = getPlayerMeta(champ);
      parts.push(`🏆 Champion: ${champMeta.name} (${boLabel} · ${scoreText})`);
    } else {
      parts.push(`${boLabel} · ${scoreText}`);
    }
  }

  if (parts.length > 0) {
    badge.style.display = "inline-flex";
    badge.textContent = parts.join(" · ");
  } else {
    badge.style.display = "none";
  }
}

function renderEvalPressureBar() {
  const bar = document.getElementById("eval-pressure-bar");
  const segContainer = document.getElementById("eval-pressure-track") || document.getElementById("eval-pressure-segments");
  const leaderLabel = document.getElementById("eval-pressure-label") || document.getElementById("eval-pressure-leader");
  if (!bar || !segContainer || !leaderLabel) return;

  if (!gameState || !window.CaroEngine?.TacticalEvaluator?.computeBoardPressure) {
    bar.style.display = "none";
    return;
  }

  // Hide during an active human turn in live play so it never spoils tactical calculation
  const isLiveHumanTurn = !isReplayMode && gameState.status !== "finished" && isLocalHumanAllowedToMove();
  if (isLiveHumanTurn) {
    bar.style.display = "none";
    return;
  }

  const players = (isReplayMode ? replayPlayers : gameState.players) || [];
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : (gameState.board?.moves || []);
  if (players.length < 2) {
    bar.style.display = "none";
    return;
  }

  const symbols = players.map(p => p.symbol);
  const rule = gameState.board?.rule_variant || currentRuleVariant || "freestyle";
  const tempBoard = new window.CaroEngine.CaroBoard(symbols, rule);
  for (const m of moves) {
    tempBoard.makeMove(m.row, m.col, m.player, m.metadata);
  }
  const pressure = window.CaroEngine.TacticalEvaluator.computeBoardPressure(tempBoard);
  const pctMap = pressure.percentages || pressure.shares || {};

  bar.style.display = "flex";
  segContainer.innerHTML = players.map(p => {
    const meta = getPlayerMeta(p.symbol);
    const pct = Math.max(4, Number(pctMap[p.symbol]) || Math.round(100 / players.length));
    return `<div class="eval-pressure-seg" style="width:${pct}%;background:${escapeHtml(meta.fill)}" title="${escapeHtml(meta.name)}: ${pct}%"></div>`;
  }).join("");

  if (moves.length === 0) {
    leaderLabel.textContent = "Eval · Even";
  } else {
    const leaderSym = pressure.leader || symbols[0];
    const leaderMeta = getPlayerMeta(leaderSym);
    const leaderPct = pctMap[leaderSym] ?? Math.round(100 / players.length);
    leaderLabel.textContent = `${leaderMeta.name} ${leaderPct}%`;
  }
}

function updateRematchBar() {
  const bar = document.getElementById("rematch-bar");
  const statusText = document.getElementById("rematch-status-text");
  const btnRematch = document.getElementById("btn-rematch-vote");
  const btnNextPuzzle = document.getElementById("btn-next-puzzle");
  if (!bar) return;

  if (isReplayMode || !gameState || gameState.status !== "finished") {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  if (gameState.puzzle) {
    if (statusText) {
      statusText.textContent = gameState.puzzle_solved
        ? `Puzzle solved: ${gameState.puzzle.title} (+15 Cranes)`
        : `Puzzle ended: ${gameState.puzzle.title}`;
    }
    if (btnRematch) btnRematch.textContent = "Retry puzzle";
    if (btnNextPuzzle) btnNextPuzzle.style.display = "inline-flex";
    return;
  }

  if (btnNextPuzzle) btnNextPuzzle.style.display = "none";

  if (isMultiplayerActive && window.CaroMultiplayer) {
    const lobby = window.CaroMultiplayer.getLobbyState();
    const votes = lobby.rematchVotes || {};
    const voteCount = Object.keys(votes).length;
    const humanCount = Math.max(1, (lobby.slots || []).filter(s => s.type === "human" && s.id).length);
    const myVoted = Boolean(window.CaroMultiplayer.myId && votes[window.CaroMultiplayer.myId]);
    if (statusText) {
      statusText.textContent = voteCount > 0
        ? `Rematch votes: ${voteCount}/${humanCount} ready`
        : "Match complete — ready for a rematch?";
    }
    if (btnRematch) {
      btnRematch.textContent = lobby.isHost
        ? (voteCount > 0 ? `Start Rematch (${voteCount}/${humanCount})` : "Rematch")
        : (myVoted ? `Voted (${voteCount}/${humanCount})` : "Vote Rematch");
    }
  } else {
    const placements = gameState.board?.placements || [];
    const winnerName = placements[0] ? getPlayerMeta(placements[0].player).name : "Draw";
    if (statusText) {
      statusText.textContent = `Match complete · ${winnerName} wins`;
    }
    if (btnRematch) {
      btnRematch.textContent = "Rematch";
    }
  }
}

async function handleRematchAction() {
  const swapSeats = Boolean(document.getElementById("toggle-swap-seats")?.checked);
  if (gameState?.puzzle) {
    launchDailyPuzzle(gameState.puzzle.id);
    return;
  }
  if (isMultiplayerActive && window.CaroMultiplayer) {
    window.CaroMultiplayer.voteRematch({ swapSeats });
    if (window.CaroMultiplayer.isHost) {
      startNextMultiplayerBattle({ swapSeats });
    } else {
      updateRematchBar();
      showArenaToast("Rematch vote sent to host");
    }
    return;
  }
  if (swapSeats && Array.isArray(gameState?.players) && gameState.players.length >= 2) {
    const rotated = gameState.players.map(p => p.type);
    rotated.push(rotated.shift());
    await newBattle({ keepOverride: true, customPlayerOrder: rotated });
    showArenaToast("Rematch started with swapped turn order");
  } else {
    await newBattle();
  }
}

let _currentPuzzleOffset = 0;

function launchDailyPuzzle(puzzleIdOrIndex = null) {
  if (!window.CaroEngine) return null;
  if (isReplayMode) exitReplayMode();
  if (isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }
  if (!clientEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => {
      if (!useBackend()) handleStateUpdate(state);
    };
  }
  useClientEngineOverride = true;
  enterArenaBattleground();
  const state = clientEngine.startDailyPuzzle(puzzleIdOrIndex);
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(state);
  if (state?.puzzle) {
    showArenaToast(`Daily Puzzle: ${state.puzzle.title} — ${state.puzzle.objective}`);
  }
  renderDailyPuzzleBadge();
  return state;
}

function launchNextDailyPuzzle() {
  const puzzles = window.CaroEngine?.DAILY_PUZZLES || [];
  if (puzzles.length === 0) return null;
  const curId = gameState?.puzzle?.id;
  const curIdx = puzzles.findIndex(p => p.id === curId);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % puzzles.length : (_currentPuzzleOffset++);
  return launchDailyPuzzle(nextIdx);
}

function renderDailyPuzzleBadge() {
  const badge = document.getElementById("daily-puzzle-streak-badge");
  if (!badge || !window.CaroEngine?.ClientStorage?.getPuzzleStats) return;
  const pStats = window.CaroEngine.ClientStorage.getPuzzleStats();
  const daily = window.CaroEngine.getDailyPuzzle?.();
  const solvedToday = daily && Array.isArray(pStats.solvedIds) && pStats.solvedIds.includes(daily.id);
  if (pStats.streak > 0) {
    badge.textContent = solvedToday ? `Solved · ${pStats.streak}🔥` : `${pStats.streak}🔥 streak`;
  } else {
    badge.textContent = "+15 Cranes";
  }
}

function renderCareerStats() {
  if (!window.CaroEngine?.ClientStorage?.getCareerStats) return;
  const stats = window.CaroEngine.ClientStorage.getCareerStats();
  const containers = [
    document.getElementById("lobby-career-stats"),
    document.getElementById("auth-career-stats")
  ].filter(Boolean);
  if (containers.length === 0) return;

  const fastestText = stats.fastestWinMoves ? `${stats.fastestWinMoves} moves` : "—";
  const h2hModels = ["von", "mojev", "laya", "jev"];
  const h2hHtml = h2hModels.map(m => {
    const rec = stats.vsAi?.[m] || { name: m, wins: 0, losses: 0 };
    return `<span class="career-h2h-pill">vs <strong>${escapeHtml(rec.name)}</strong> ${rec.wins}W–${rec.losses}L</span>`;
  }).join("");

  const html = `
    <div class="career-stats-grid">
      <div class="career-stat-box">
        <span class="career-stat-val">${stats.winRate}%</span>
        <span class="career-stat-lbl">Win Rate (${stats.humanWins}/${stats.humanMatches})</span>
      </div>
      <div class="career-stat-box">
        <span class="career-stat-val">${escapeHtml(fastestText)}</span>
        <span class="career-stat-lbl">Fastest Win</span>
      </div>
      <div class="career-stat-box">
        <span class="career-stat-val">${stats.puzzleStreak} 🔥</span>
        <span class="career-stat-lbl">Puzzle Streak (${stats.puzzlesSolved})</span>
      </div>
      <div class="career-stat-box">
        <span class="career-stat-val">${stats.totalBattles}</span>
        <span class="career-stat-lbl">Total Battles</span>
      </div>
    </div>
    <div class="career-h2h-row">${h2hHtml}</div>
  `;

  containers.forEach(el => {
    el.innerHTML = html;
  });
}

window.encodeReplayPayload = encodeReplayPayload;
window.decodeReplayPayload = decodeReplayPayload;
window.getShareReplayUrl = getShareReplayUrl;
window.shareCurrentReplay = shareCurrentReplay;
window.toggleReplayHints = toggleReplayHints;
window.playFromReplayState = playFromReplayState;
window.copyMovesCoordinateNotation = copyMovesCoordinateNotation;
window.downloadBoardSnapshot = downloadBoardSnapshot;
window.launchDailyPuzzle = launchDailyPuzzle;

function exitReplayMode() {
  isReplayMode = false;
  replayMoves = [];
  replayIndex = 0;
  replayPlayers = [];
  replayPlacements = [];
  highlightedMoveCoord = null;
  const pill = document.getElementById("replay-analysis-pill");
  if (pill) pill.style.display = "none";
  document.getElementById("replay-bar").style.display = "none";
  document.getElementById("btn-auto").disabled = false;
  userInteractedWithCamera = false;
  rebuildSymbolMap();
  autoScaleCamera(true);
  fetchState();
}

function stepReplay(delta) {
  if (!isReplayMode) return;
  const prevIdx = replayIndex;
  replayIndex = Math.max(0, Math.min(replayMoves.length, replayIndex + delta));
  if (delta > 0 && replayIndex > prevIdx) {
    const m = replayMoves[replayIndex - 1];
    if (m) triggerStonePlacementFx(m.row, m.col, m.player);
  }
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
    onEmote: handleMultiplayerEmote,
    onActivityLogChange: renderMultiplayerActivityLog,
    onSessionScoreChange: () => updateMultiplayerHudBadges(),
    onRematchVote: () => updateRematchBar(),
    getHostState: getMultiplayerHostState,
    onStatusMessage: (msg) => {
      updateMultiplayerHudStatus(msg);
    }
  });

  setupMultiplayerUI();
  setupAuthUI();
  setupLobbyHomeScreenUI();
  renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  renderLobbyHomeWalletAndThemes();
  renderCareerStats();
  renderDailyPuzzleBadge();
  checkUrlForRoomInvite();
}

function getMultiplayerHostState() {
  if (!isMultiplayerActive || !clientEngine) return null;
  return {
    inGame: true,
    roomId: window.CaroMultiplayer?.roomId,
    roomName: window.CaroMultiplayer?.roomName,
    entryFee: window.CaroMultiplayer?.entryFee || 0,
    turnTimeoutSec: window.CaroMultiplayer?.turnTimeoutSec ?? 30,
    ruleVariant: window.CaroMultiplayer?.ruleVariant || currentRuleVariant || "freestyle",
    seriesTargetWins: window.CaroMultiplayer?.seriesTargetWins || currentSeriesTarget || 1,
    sessionScores: window.CaroMultiplayer?.getSessionScores?.() || {},
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

let wagerDeductedForGameId = null;

function renderLobbyHomeWalletAndThemes() {
  if (!window.CaroAuth) return;
  const balance = window.CaroAuth.getCranesBalance();
  const dailyCheck = window.CaroAuth.canClaimDailyBonus();
  const canDaily = typeof dailyCheck === "object" ? Boolean(dailyCheck.canClaim) : Boolean(dailyCheck);

  const homeCranes = document.getElementById("lobby-home-cranes-count");
  if (homeCranes) homeCranes.textContent = String(balance);

  const authCranes = document.getElementById("auth-cranes-count");
  if (authCranes) authCranes.textContent = String(balance);

  const btnHomeDaily = document.getElementById("btn-lobby-home-daily-bonus");
  if (btnHomeDaily) {
    btnHomeDaily.disabled = !canDaily;
    btnHomeDaily.textContent = canDaily ? "Claim +25 daily" : "Claimed today";
  }

  const btnAuthDaily = document.getElementById("btn-auth-daily-bonus");
  if (btnAuthDaily) {
    btnAuthDaily.disabled = !canDaily;
    btnAuthDaily.textContent = canDaily ? "Claim +25 daily" : "Claimed today";
  }

  // Update header theme selector labels
  const themeSel = document.getElementById("select-board-theme");
  const selectedTheme = window.CaroAuth.getSelectedTheme();
  const catalogObj = window.CaroAuth.BOARD_THEMES_CATALOG || {};
  const catalog = Object.values(catalogObj);
  if (themeSel) {
    Array.from(themeSel.options).forEach(opt => {
      const item = catalog.find(t => t.id === opt.value);
      if (!item) return;
      const unlocked = window.CaroAuth.isThemeUnlocked(item.id);
      const shortName = item.name.replace(" Board", "");
      opt.textContent = unlocked
        ? `${shortName}`
        : `${shortName} (${item.cost} Cranes)`;
    });
    themeSel.value = selectedTheme;
  }

  // Render 2x2 cosmetics grid on Lobby Start Screen
  const grid = document.getElementById("lobby-home-themes-grid");
  if (grid) {
    grid.innerHTML = "";
    catalog.forEach(item => {
      const unlocked = window.CaroAuth.isThemeUnlocked(item.id);
      const isSelected = selectedTheme === item.id;
      const palette = BOARD_THEMES_PALETTES[item.id] || BOARD_THEMES_PALETTES.classic;
      const card = document.createElement("div");
      card.className = `theme-cosmetic-card ${isSelected ? "active-theme" : ""}`;
      card.dataset.themeId = item.id;
      card.innerHTML = `
        <div class="theme-cosmetic-top">
          <span class="theme-cosmetic-swatch" style="background: linear-gradient(135deg, ${palette.bgStops[0]}, ${palette.bgStops[2]});"></span>
          <div class="theme-cosmetic-text">
            <span class="theme-cosmetic-name">${escapeHtml(item.name)}</span>
            <span class="theme-cosmetic-desc">${escapeHtml(item.desc || item.description || "")}</span>
          </div>
        </div>
        <div class="theme-cosmetic-status ${isSelected ? "active" : (unlocked ? "unlocked" : "locked")}">
          ${isSelected ? "Equipped" : (unlocked ? "Equip" : `${item.cost} Cranes`)}
        </div>
      `;
      card.addEventListener("click", async () => {
        if (window.CaroAuth.isThemeUnlocked(item.id)) {
          window.CaroAuth.setSelectedTheme(item.id);
          renderLobbyHomeWalletAndThemes();
          renderBoard();
          showArenaToast(`Equipped ${item.name}`);
        } else {
          try {
            await window.CaroAuth.unlockTheme(item.id);
            renderLobbyHomeWalletAndThemes();
            renderBoard();
            showArenaToast(`Unlocked and equipped ${item.name}`);
          } catch (err) {
            showArenaToast(err.message);
          }
        }
      });
      grid.appendChild(card);
    });
  }

  // Update board footer Stone Finish selector & Lobby Stone Finishes grid
  const stoneSel = document.getElementById("select-stone-style");
  const selectedStone = window.CaroAuth.getSelectedStoneStyle?.() || "classic";
  const stoneCatalogObj = window.CaroAuth.STONE_STYLES_CATALOG || {};
  const stoneCatalog = Object.values(stoneCatalogObj);
  if (stoneSel && stoneCatalog.length > 0) {
    Array.from(stoneSel.options).forEach(opt => {
      const item = stoneCatalog.find(s => s.id === opt.value);
      if (!item) return;
      const unlocked = window.CaroAuth.isStoneStyleUnlocked(item.id);
      opt.textContent = unlocked
        ? `${item.name}`
        : `${item.name} (${item.cost} Cranes)`;
    });
    stoneSel.value = selectedStone;
  }

  const stoneGrid = document.getElementById("lobby-home-stones-grid");
  const stoneSwatchStyles = {
    classic: "radial-gradient(circle at 32% 32%, #38bdf8, #0891b2 65%, #0e7490)",
    matte: "linear-gradient(135deg, #059669, #047857)",
    shell: "repeating-radial-gradient(circle at 40% 40%, #f59e0b 0px, #d97706 4px, #b45309 8px)",
    mono: "radial-gradient(circle, #1c1917 45%, #fafaf9 47%, #fafaf9 62%, #1c1917 65%)"
  };
  if (stoneGrid && stoneCatalog.length > 0) {
    stoneGrid.innerHTML = "";
    stoneCatalog.forEach(item => {
      const unlocked = window.CaroAuth.isStoneStyleUnlocked(item.id);
      const isSelected = selectedStone === item.id;
      const card = document.createElement("div");
      card.className = `theme-cosmetic-card ${isSelected ? "active-theme" : ""}`;
      card.dataset.stoneStyleId = item.id;
      card.innerHTML = `
        <div class="theme-cosmetic-top">
          <span class="theme-cosmetic-swatch" style="border-radius: 50%; background: ${stoneSwatchStyles[item.id] || stoneSwatchStyles.classic};"></span>
          <div class="theme-cosmetic-text">
            <span class="theme-cosmetic-name">${escapeHtml(item.name)}</span>
            <span class="theme-cosmetic-desc">${escapeHtml(item.desc || "")}</span>
          </div>
        </div>
        <div class="theme-cosmetic-status ${isSelected ? "active" : (unlocked ? "unlocked" : "locked")}">
          ${isSelected ? "Equipped" : (unlocked ? "Equip" : `${item.cost} Cranes`)}
        </div>
      `;
      card.addEventListener("click", async () => {
        if (window.CaroAuth.isStoneStyleUnlocked(item.id)) {
          window.CaroAuth.setSelectedStoneStyle(item.id);
          renderLobbyHomeWalletAndThemes();
          renderBoard();
          showArenaToast(`Equipped ${item.name}`);
        } else {
          try {
            await window.CaroAuth.unlockStoneStyle(item.id);
            renderLobbyHomeWalletAndThemes();
            renderBoard();
            showArenaToast(`Unlocked and equipped ${item.name}`);
          } catch (err) {
            showArenaToast(err.message);
          }
        }
      });
      stoneGrid.appendChild(card);
    });
  }

  if (typeof renderAuthCranesLedger === "function") {
    renderAuthCranesLedger();
  }
}

async function launchPresetBattle(playerTypes, autoPlay = true) {
  if (!Array.isArray(playerTypes) || playerTypes.length < 2) return;
  const setTypes = new Set(playerTypes);
  document.querySelectorAll("#roster-config .roster-toggle").forEach(label => {
    const cb = label.querySelector("input");
    if (cb) {
      cb.checked = setTypes.has(label.dataset.model);
    }
  });
  updateRosterCount();
  enterArenaBattleground();
  await newBattle();
  if (autoPlay && !gameState?.is_auto_playing) {
    await toggleAutoPlay();
  }
}

function setupLobbyHomeScreenUI() {
  const hostNameInput = document.getElementById("lobby-home-host-name");
  const currentName = window.CaroAuth?.getCurrentUser()?.display_name || "";
  if (hostNameInput && !hostNameInput.value && currentName) {
    hostNameInput.value = currentName;
  }

  document.getElementById("btn-lobby-home-refresh")?.addEventListener("click", () => {
    window.CaroMultiplayer?.refreshActiveRooms();
    renderActiveRoomsLobby(window.CaroMultiplayer?.getActiveRooms() || []);
  });

  document.getElementById("btn-lobby-home-open-custom")?.addEventListener("click", () => {
    openMultiplayerModal("create");
  });

  document.getElementById("btn-lobby-home-account")?.addEventListener("click", () => {
    document.getElementById("btn-auth-profile")?.click();
  });

  // Quick-Start Solo Presets
  document.getElementById("btn-preset-1v1-von")?.addEventListener("click", () => {
    launchPresetBattle(["human", "von"], true);
  });
  document.getElementById("btn-preset-human-3ai")?.addEventListener("click", () => {
    launchPresetBattle(["human", "laya", "jev", "von"], true);
  });
  document.getElementById("btn-preset-4ai-watch")?.addEventListener("click", () => {
    launchPresetBattle(["laya", "jev", "von", "mojev"], true);
  });
  document.getElementById("btn-preset-daily-puzzle")?.addEventListener("click", () => {
    launchDailyPuzzle();
  });

  const handleDailyBonusClaim = async () => {
    if (!window.CaroAuth) return;
    try {
      const res = await window.CaroAuth.claimDailyBonus();
      const rewardAmt = res.reward || res.bonus || 25;
      renderLobbyHomeWalletAndThemes();
      showArenaToast(`+${rewardAmt} Cranes daily bonus claimed`);
    } catch (err) {
      showArenaToast(err.message);
    }
  };

  document.getElementById("btn-lobby-home-daily-bonus")?.addEventListener("click", handleDailyBonusClaim);
  document.getElementById("btn-auth-daily-bonus")?.addEventListener("click", handleDailyBonusClaim);

  document.getElementById("btn-lobby-home-join-code")?.addEventListener("click", async () => {
    const codeInput = document.getElementById("lobby-home-code-input") || document.getElementById("lobby-home-join-code");
    const code = codeInput?.value?.trim() || "";
    if (!code) {
      showArenaToast("Enter a room code or URL slug first.");
      return;
    }
    const myName = window.CaroAuth?.getCurrentUser()?.display_name ||
      document.getElementById("lobby-home-host-name")?.value?.trim() ||
      window.CaroMultiplayer?.myName ||
      "Player";
    const btn = document.getElementById("btn-lobby-home-join-code");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Joining..."; }
      await window.CaroMultiplayer.joinRoom(code, myName);
      enterArenaBattleground();
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
      openMultiplayerModal("create");
    } catch (err) {
      showArenaToast(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Join"; }
    }
  });

  document.getElementById("btn-lobby-home-create")?.addEventListener("click", async () => {
    const name = document.getElementById("lobby-home-host-name")?.value?.trim() ||
      window.CaroAuth?.getCurrentUser()?.display_name ||
      window.CaroMultiplayer?.myName ||
      "Host";
    const roomName = document.getElementById("lobby-home-room-name")?.value?.trim() || "";
    const roomSlug = document.getElementById("lobby-home-room-slug")?.value?.trim() || "";
    const wagerEl = document.getElementById("lobby-home-wager-select") || document.getElementById("lobby-home-wager");
    const entryFee = Number(wagerEl?.value) || 0;
    const timerEl = document.getElementById("lobby-home-timer-select");
    const turnTimeoutSec = timerEl ? Number(timerEl.value) : 30;
    const ruleVariant = document.getElementById("lobby-home-rule-select")?.value || "freestyle";
    const seriesTargetWins = Number(document.getElementById("lobby-home-series-select")?.value) || 1;
    const isPublic = document.getElementById("lobby-home-public")?.checked ?? true;

    if (entryFee > 0 && (window.CaroAuth?.getCranesBalance() || 0) < entryFee) {
      showArenaToast(`You need at least ${entryFee} Cranes to host this room.`);
      return;
    }

    const btn = document.getElementById("btn-lobby-home-create");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
      setRuleVariantUI(ruleVariant, false);
      setSeriesTargetUI(seriesTargetWins, false);
      await window.CaroMultiplayer.createRoom(name, { roomName, roomSlug, isPublic, entryFee, turnTimeoutSec, ruleVariant, seriesTargetWins });
      // Sync modal inputs as well
      const modalHostName = document.getElementById("mp-host-name-input");
      const modalRoomName = document.getElementById("mp-room-name-input");
      const modalSlug = document.getElementById("mp-room-slug-input");
      const modalWager = document.getElementById("mp-room-wager-select");
      const modalTimer = document.getElementById("mp-room-timer-select");
      const modalRule = document.getElementById("mp-room-rule-select");
      const modalSeries = document.getElementById("mp-room-series-select");
      if (modalHostName) modalHostName.value = name;
      if (modalRoomName) modalRoomName.value = window.CaroMultiplayer.roomName;
      if (modalSlug) modalSlug.value = window.CaroMultiplayer.roomId;
      if (modalWager) modalWager.value = String(entryFee);
      if (modalTimer) modalTimer.value = String(turnTimeoutSec);
      if (modalRule) modalRule.value = ruleVariant;
      if (modalSeries) modalSeries.value = String(seriesTargetWins);

      enterArenaBattleground();
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
      openMultiplayerModal("create");
    } catch (err) {
      showArenaToast(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Create and enter room"; }
    }
  });
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

  // Sync live room name / public toggle / wager / timer / rule / series changes when already hosting
  const roomNameInput = document.getElementById("mp-room-name-input");
  const roomPublicToggle = document.getElementById("mp-room-public-toggle");
  const roomWagerSelect = document.getElementById("mp-room-wager-select");
  const roomTimerSelect = document.getElementById("mp-room-timer-select");
  const roomRuleSelect = document.getElementById("mp-room-rule-select");
  const roomSeriesSelect = document.getElementById("mp-room-series-select");
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
  roomWagerSelect?.addEventListener("change", () => {
    if (window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
      window.CaroMultiplayer.setRoomMeta({ entryFee: Number(roomWagerSelect.value) || 0 });
    }
  });
  roomTimerSelect?.addEventListener("change", () => {
    if (window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.roomId) {
      window.CaroMultiplayer.setRoomMeta({ turnTimeoutSec: Number(roomTimerSelect.value) });
      mpTurnTimerKey = null;
      syncMultiplayerTurnTimer();
    }
  });
  roomRuleSelect?.addEventListener("change", () => {
    setRuleVariantUI(roomRuleSelect.value, false);
  });
  roomSeriesSelect?.addEventListener("change", () => {
    setSeriesTargetUI(roomSeriesSelect.value, false);
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
    const entryFee = Number(document.getElementById("mp-room-wager-select")?.value) || 0;
    const timerEl = document.getElementById("mp-room-timer-select");
    const turnTimeoutSec = timerEl ? Number(timerEl.value) : 30;
    const ruleVariant = document.getElementById("mp-room-rule-select")?.value || currentRuleVariant || "freestyle";
    const seriesTargetWins = Number(document.getElementById("mp-room-series-select")?.value) || currentSeriesTarget || 1;
    try {
      btnCreateRoom.disabled = true;
      btnCreateRoom.textContent = "Creating...";
      setRuleVariantUI(ruleVariant, false);
      setSeriesTargetUI(seriesTargetWins, false);
      await window.CaroMultiplayer.createRoom(name, { roomName, roomSlug, isPublic, entryFee, turnTimeoutSec, ruleVariant, seriesTargetWins });
      btnCreateRoom.disabled = false;
      btnCreateRoom.textContent = "Recreate room";
      if (btnStartMp) btnStartMp.style.display = "inline-flex";
      const shareBox = document.getElementById("mp-share-box");
      const shareUrl = document.getElementById("mp-share-url");
      if (shareBox) shareBox.style.display = "block";
      if (shareUrl) shareUrl.value = window.CaroMultiplayer.getLobbyState().shareUrl;
      enterArenaBattleground();
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
      renderMultiplayerActivityLog();
    } catch (err) {
      alert(err.message);
      btnCreateRoom.disabled = false;
      btnCreateRoom.textContent = "Create room";
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
      alert("Please enter a room code or URL slug.");
      return;
    }
    try {
      btnJoinRoom.disabled = true;
      btnJoinRoom.textContent = "Joining...";
      await window.CaroMultiplayer.joinRoom(code, name);
      btnJoinRoom.disabled = false;
      btnJoinRoom.textContent = "Enter room";
      enterArenaBattleground();
      showMultiplayerHud(window.CaroMultiplayer.roomId);
      updateMultiplayerHudBadges();
      switchMpTab("create");
    } catch (err) {
      alert(err.message);
      btnJoinRoom.disabled = false;
      btnJoinRoom.textContent = "Enter room";
    }
  });

  const copyHandler = (inputElem, btnElem) => {
    const val = inputElem?.value || window.CaroMultiplayer.getLobbyState().shareUrl;
    if (val && navigator.clipboard) {
      navigator.clipboard.writeText(val).then(() => {
        const orig = btnElem.textContent;
        btnElem.textContent = "Copied";
        setTimeout(() => { btnElem.textContent = orig; }, 2000);
      });
    }
  };

  btnCopyInvite?.addEventListener("click", () => copyHandler(document.getElementById("mp-share-url"), btnCopyInvite));
  btnHudCopy?.addEventListener("click", () => copyHandler(null, btnHudCopy));
  btnHudLeave?.addEventListener("click", () => {
    window.CaroMultiplayer.leaveRoom();
  });

  // Quick Emote Bar buttons
  document.querySelectorAll("#mp-emote-bar [data-emote]").forEach(btn => {
    btn.addEventListener("click", () => {
      const emoji = btn.dataset.emote;
      if (emoji && window.CaroMultiplayer) {
        window.CaroMultiplayer.sendEmote(emoji);
      }
    });
  });
}

function handleMultiplayerEmote(evt) {
  if (!evt || !evt.emoji) return;
  try { window.CaroAudio?.playTurnReadyChime?.(); } catch {}
  const layer = document.getElementById("mp-floating-emotes");
  if (!layer) return;

  const pill = document.createElement("div");
  pill.className = "floating-emote-pill";
  const senderName = evt.senderName || evt.fromName || "Player";
  const symbols = ["A", "B", "C", "D"];
  const sym = evt.fromSymbol || (typeof evt.slotIndex === "number" && evt.slotIndex >= 0 ? symbols[evt.slotIndex] : "");
  const symText = sym ? ` [${sym}]` : "";
  pill.innerHTML = `<span class="emote-icon">${escapeHtml(evt.emoji)}</span> <span>${escapeHtml(senderName)}${escapeHtml(symText)}</span>`;
  layer.appendChild(pill);
  setTimeout(() => {
    pill.remove();
  }, 2400);
}

function renderMultiplayerActivityLog(entries = null) {
  const listEl = document.getElementById("mp-activity-log-list");
  if (!listEl) return;
  const items = Array.isArray(entries)
    ? entries
    : (window.CaroMultiplayer?.getActivityLog?.() || []);
  if (items.length === 0) {
    listEl.innerHTML = `<div class="mp-empty-rooms">Room events will appear here.</div>`;
    return;
  }
  listEl.innerHTML = items.map(ev => {
    const dt = ev.ts ? new Date(ev.ts) : new Date();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `<div class="mp-activity-log-item">
      <span class="mp-activity-time">${hh}:${mm}:${ss}</span>
      <span>${escapeHtml(ev.text || "")}</span>
    </div>`;
  }).join("");
  listEl.scrollTop = listEl.scrollHeight;
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
  renderMultiplayerActivityLog();
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
      ? `Room: ${lobby.roomName} (${lobby.roomId})`
      : "Connected to Caro Arena live server";
  } else {
    banner.className = "mp-mode-banner local";
    text.textContent = lobby?.roomId
      ? `Room: ${lobby.roomName} (${lobby.roomId})`
      : "Local multi-tab realtime mode";
  }

  if (rolePill) {
    if (!lobby?.roomId) {
      rolePill.textContent = "";
      rolePill.style.display = "none";
    } else {
      rolePill.style.display = "inline-block";
      rolePill.textContent = lobby.isHost
        ? "Host"
        : (lobby.myRole === "player" ? `Player #${lobby.myAssignedSlot + 1}` : "Spectator");
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
  const countBadge = document.getElementById("lobby-home-room-count");
  if (countBadge) {
    countBadge.textContent = `${Array.isArray(rooms) ? rooms.length : 0} active`;
  }

  const targets = [
    document.getElementById("mp-active-rooms-list"),
    document.getElementById("lobby-home-rooms-list")
  ].filter(Boolean);

  targets.forEach(container => {
    const isHomeList = container.id === "lobby-home-rooms-list";
    const btnClass = isHomeList ? "btn-lobby-home-enter-room" : "btn-enter-active-room";

    if (!Array.isArray(rooms) || rooms.length === 0) {
      container.innerHTML = `<div class="mp-empty-rooms">No public rooms right now. Host a room on the right or launch a solo AI match.</div>`;
      return;
    }

    container.innerHTML = "";
    rooms.forEach(r => {
      const card = document.createElement("div");
      card.className = "mp-room-card";
      const isPlaying = r.status === "playing";
      const statusText = isPlaying ? `Battle #${r.battleNumber || 1}` : "Open";
      const isMyCurrentRoom = window.CaroMultiplayer?.roomId === r.roomId;
      const fee = Number(r.entryFee) || 0;
      const feeBadge = fee > 0
        ? `<span class="mp-slot-badge" style="background:#fef3c7;color:#b45309;">${fee} Entry</span>`
        : `<span class="mp-slot-badge">Free</span>`;

      card.innerHTML = `
        <div>
          <div class="mp-room-card-title">
            <span>${escapeHtml(r.roomName || r.roomId)}</span>
            <span class="mp-slot-badge ${isPlaying ? "" : "ready"}">${escapeHtml(statusText)}</span>
            ${feeBadge}
          </div>
          <div class="mp-room-card-meta">
            <span>Host: <strong>${escapeHtml(r.hostName || "Host")}</strong></span>
            <span>· ${Number(r.playerCount) || 1}/${Number(r.maxPlayers) || 2} players</span>
            <span>· ${Number(r.spectatorCount) || 0} watching</span>
            <span>· <code>?room=${escapeHtml(r.roomId)}</code></span>
          </div>
        </div>
        <div>
          <button class="btn ${isMyCurrentRoom ? "btn-secondary" : "btn-primary"} btn-xs ${btnClass}" data-room="${escapeHtml(r.roomId)}">
            ${isMyCurrentRoom ? "In room" : "Enter"}
          </button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll(`.${btnClass}`).forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const targetRoomId = e.currentTarget.dataset.room;
        if (!targetRoomId) return;
        if (window.CaroMultiplayer?.roomId === targetRoomId) {
          enterArenaBattleground();
          openMultiplayerModal("create");
          return;
        }
        const myName = window.CaroAuth?.getCurrentUser()?.display_name ||
          document.getElementById("lobby-home-host-name")?.value?.trim() ||
          window.CaroMultiplayer?.myName ||
          "Spectator";
        try {
          await window.CaroMultiplayer.joinRoom(targetRoomId, myName);
          enterArenaBattleground();
          showMultiplayerHud(targetRoomId);
          updateMultiplayerHudBadges();
          openMultiplayerModal("create");
        } catch (err) {
          alert(err.message);
        }
      });
    });
  });
}

function handleMultiplayerLobbyUpdate(lobbyState) {
  updateMultiplayerModeBadge();
  renderMultiplayerSlots();
  renderSpectatorsAndRequests();
  renderHostApprovalBar();
  renderMultiplayerActivityLog();
  updateMultiplayerHudBadges();

  const shareBox = document.getElementById("mp-share-box");
  const shareUrl = document.getElementById("mp-share-url");
  const btnStartMp = document.getElementById("btn-action-start-mp");
  const btnCreateRoom = document.getElementById("btn-action-create-room");
  const slugInput = document.getElementById("mp-room-slug-input");
  const roomNameInput = document.getElementById("mp-room-name-input");
  const wagerSelect = document.getElementById("mp-room-wager-select");
  const timerSelect = document.getElementById("mp-room-timer-select");
  const ruleSelect = document.getElementById("mp-room-rule-select");
  const seriesSelect = document.getElementById("mp-room-series-select");

  if (lobbyState.roomId) {
    if (shareBox) shareBox.style.display = "block";
    if (shareUrl) shareUrl.value = lobbyState.shareUrl;
    if (slugInput && !slugInput.value) slugInput.value = lobbyState.roomId;
    if (roomNameInput && !roomNameInput.value && lobbyState.roomName) roomNameInput.value = lobbyState.roomName;
    if (wagerSelect && lobbyState.entryFee !== undefined) wagerSelect.value = String(lobbyState.entryFee || 0);
    if (timerSelect && lobbyState.turnTimeoutSec !== undefined) timerSelect.value = String(lobbyState.turnTimeoutSec);
    if (lobbyState.ruleVariant) {
      if (ruleSelect) ruleSelect.value = lobbyState.ruleVariant;
      currentRuleVariant = lobbyState.ruleVariant;
      if (clientEngine?.setRuleVariant) clientEngine.setRuleVariant(lobbyState.ruleVariant);
      const arenaRule = document.getElementById("select-rule-variant");
      if (arenaRule) arenaRule.value = lobbyState.ruleVariant;
    }
    if (lobbyState.seriesTargetWins !== undefined) {
      const st = Number(lobbyState.seriesTargetWins) || 1;
      if (seriesSelect) seriesSelect.value = String(st);
      currentSeriesTarget = st;
      if (clientEngine?.setSeriesTarget) clientEngine.setSeriesTarget(st);
      const arenaSeries = document.getElementById("select-series-target");
      if (arenaSeries) arenaSeries.value = String(st);
    }
    if (btnStartMp) {
      btnStartMp.style.display = lobbyState.isHost ? "inline-flex" : "none";
      btnStartMp.textContent = lobbyState.inGame ? "Restart match" : "Start match";
    }
    if (btnCreateRoom) {
      btnCreateRoom.style.display = lobbyState.isHost ? "inline-flex" : "none";
      btnCreateRoom.textContent = "New room";
    }
    showMultiplayerHud(lobbyState.roomId);
  } else {
    if (shareBox) shareBox.style.display = "none";
    if (btnStartMp) btnStartMp.style.display = "none";
    if (btnCreateRoom) {
      btnCreateRoom.style.display = "inline-flex";
      btnCreateRoom.textContent = "Create room";
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
    const names = specs.map(s => s.name || "Spectator").join(", ");
    specLabel.textContent = specs.length > 0
      ? `Spectators (${specs.length}): ${names}`
      : `Spectators (0): None`;
  }

  // Spectator "Request to Join" button
  if (btnReqJoin) {
    if (!lobby.isHost && lobby.myRole === "spectator") {
      btnReqJoin.style.display = "inline-flex";
      if (lobby.myPendingRequest) {
        btnReqJoin.textContent = "Request pending...";
        btnReqJoin.disabled = true;
      } else {
        btnReqJoin.textContent = lobby.inGame ? "Request takeover" : "Request to join match";
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
          ? `<strong>${escapeHtml(r.fromName)}</strong> wants to take over Slot ${escapeHtml(r.targetSymbol || ("#" + ((r.slotIndex || 1) + 1)))}`
          : `<strong>${escapeHtml(r.fromName)}</strong> wants to join the match`;
        row.innerHTML = `
          <span>${desc}</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary btn-xs btn-approve-req" data-req="${escapeHtml(r.requestId)}">Approve</button>
            <button class="btn btn-ghost btn-xs btn-reject-req" data-req="${escapeHtml(r.requestId)}">Reject</button>
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
    ? `<strong>${escapeHtml(r.fromName)}</strong> requests to take over Slot ${escapeHtml(r.targetSymbol || ("#" + ((r.slotIndex || 1) + 1)))}`
    : `<strong>${escapeHtml(r.fromName)}</strong> requests to join the match`;

  bar.style.display = "flex";
  bar.innerHTML = `
    <div>${desc} ${reqs.length > 1 ? `<span class="mp-req-pill">+${reqs.length - 1} more</span>` : ""}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-xs" id="btn-hud-approve-req">Approve</button>
      <button class="btn btn-ghost btn-xs" id="btn-hud-reject-req">Reject</button>
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
    titleEl.textContent = `Player roster (${slots.length}/4)`;
  }

  list.innerHTML = "";
  slots.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "mp-slot-item";

    const isSlotHost = idx === 0;
    const sym = symbols[idx] || "";
    const safeName = escapeHtml(s.name || "Open human slot");

    let controlsHtml = "";
    if (isSlotHost) {
      controlsHtml = `<span class="mp-slot-badge ready">Host (${sym})</span>`;
    } else if (isHost || !lobby.roomId) {
      const hasSeatedHuman = s.type === "human" && Boolean(s.id);
      const kickBtn = hasSeatedHuman
        ? `<button class="btn btn-ghost btn-xs btn-kick-slot" data-slot="${idx}" title="Move player to spectator">Kick</button>`
        : "";
      const removeBtn = (slots.length > 2 && !lobby.inGame)
        ? `<button class="btn btn-ghost btn-xs btn-remove-slot" data-slot="${idx}" title="Remove slot">Remove</button>`
        : "";
      controlsHtml = `
        <select class="mp-slot-select" data-slot="${idx}">
          <option value="human" ${s.type === "human" ? "selected" : ""}>${hasSeatedHuman ? safeName : "Open human slot"}</option>
          <option value="von" ${s.type === "ai" && s.model === "von" ? "selected" : ""}>Von (AI)</option>
          <option value="mojev" ${s.type === "ai" && s.model === "mojev" ? "selected" : ""}>MoJev (AI)</option>
          <option value="laya" ${s.type === "ai" && s.model === "laya" ? "selected" : ""}>Laya (AI)</option>
          <option value="jev" ${s.type === "ai" && s.model === "jev" ? "selected" : ""}>Jev (AI)</option>
        </select>
        ${kickBtn}
        ${removeBtn}
      `;
    } else {
      const actionBtn = isSpectator
        ? (s.type === "human" && !s.id && !lobby.inGame
          ? `<button class="btn btn-primary btn-xs btn-req-slot" data-slot="${idx}">Request slot</button>`
          : `<button class="btn btn-ghost btn-xs btn-takeover-slot" data-slot="${idx}">Takeover</button>`)
        : "";
      controlsHtml = `
        <span class="mp-slot-badge ${s.ready ? "ready" : ""}">${s.id === lobby.myPlayerId ? "You (" + sym + ")" : safeName}</span>
        ${actionBtn}
      `;
    }

    item.innerHTML = `
      <div class="mp-slot-left">
        <span class="mp-slot-num">${sym}</span>
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
        window.CaroMultiplayer.updateSlot(slotIdx, { type: "human", name: "Open human slot", id: null, ready: false });
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

function applyRoomWagerForMatch(entryFee, gameId) {
  const fee = Math.max(0, Number(entryFee) || 0);
  const humanParticipants = Math.max(1, (multiplayerRoster || []).filter(r => r.type === "human").length);
  currentMatchWagerPot = fee * humanParticipants;

  const walletId = window.CaroAuth?.getCurrentUser?.()?.user_id || "guest";
  const paidKey = `caro_wager_paid_${walletId}_${gameId}`;
  let alreadyPaidInWallet = false;
  try {
    alreadyPaidInWallet = localStorage.getItem(paidKey) === "1";
  } catch {}

  if (fee > 0 && myMultiplayerSymbol && wagerDeductedForGameId !== gameId && !alreadyPaidInWallet) {
    wagerDeductedForGameId = gameId;
    try { localStorage.setItem(paidKey, "1"); } catch {}
    if (window.CaroAuth?.adjustCranes) {
      window.CaroAuth.adjustCranes(-fee, "Match entry fee").then(() => {
        renderLobbyHomeWalletAndThemes();
        showArenaToast(`-${fee} Cranes entry fee staked (Pot: ${currentMatchWagerPot} Cranes)`, "info");
      }).catch(() => {});
    }
  }
}

function handleMultiplayerGameStart(data) {
  if (isServerAvailable && gameState?.is_auto_playing) {
    apiFetch("/api/battle/auto-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, delay_sec: 0.01, non_stop: false })
    }).catch(() => {});
  }

  enterArenaBattleground({ startFreshPractice: false });
  isMultiplayerActive = true;
  useClientEngineOverride = false;
  setSidebarRosterDisabled(true);
  multiplayerRoster = data.roster || [];
  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);

  if (!clientEngine && window.CaroEngine) {
    clientEngine = new window.CaroEngine.ClientGameManager();
    clientEngine.onStateChange = (state) => handleStateUpdate(state);
  }

  const ruleV = data.ruleVariant || window.CaroMultiplayer?.ruleVariant || currentRuleVariant || "freestyle";
  const seriesT = Number(data.seriesTargetWins ?? window.CaroMultiplayer?.seriesTargetWins ?? currentSeriesTarget) || 1;
  currentRuleVariant = ruleV;
  currentSeriesTarget = seriesT;
  clientEngine.setRuleVariant(ruleV);
  clientEngine.setSeriesTarget(seriesT);
  clientEngine.resetSeries();

  const playerTypes = multiplayerRoster.map(p => p.type);
  clientEngine.selectedPlayerTypes = playerTypes;
  clientEngine.status = "ready";
  clientEngine.battleNumber = data.battleNumber || 1;
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);

  const fee = Number(data.entryFee ?? window.CaroMultiplayer?.entryFee) || 0;
  applyRoomWagerForMatch(fee, nextState.game_id);

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

  enterArenaBattleground({ startFreshPractice: false });
  isMultiplayerActive = true;
  useClientEngineOverride = false;
  setSidebarRosterDisabled(true);
  multiplayerRoster = payload.roster.map(r => Object.assign({}, r, {
    isLocalHuman: r.type === "human" && r.playerId === window.CaroMultiplayer?.myId
  }));
  myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);

  const fee = Number(payload.entryFee ?? window.CaroMultiplayer?.entryFee) || 0;
  const humanParticipants = Math.max(1, (multiplayerRoster || []).filter(r => r.type === "human").length);
  currentMatchWagerPot = fee * humanParticipants;

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

  const ruleV = payload.ruleVariant || window.CaroMultiplayer?.ruleVariant || currentRuleVariant || "freestyle";
  const seriesT = Number(payload.seriesTargetWins ?? window.CaroMultiplayer?.seriesTargetWins ?? currentSeriesTarget) || 1;
  currentRuleVariant = ruleV;
  currentSeriesTarget = seriesT;
  clientEngine.setRuleVariant(ruleV);
  clientEngine.setSeriesTarget(seriesT);

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

  // Authoritative validation: check turn order, slot ownership, and cell occupancy
  const isWrongTurn = Boolean(data.symbol && clientEngine.board?.currentPlayer && data.symbol !== clientEngine.board.currentPlayer);
  const slotEntry = multiplayerRoster.find(r => r.symbol === data.symbol);
  const hostId = window.CaroMultiplayer?.hostId;
  const isUnauthorizedSender = Boolean(
    slotEntry &&
    slotEntry.playerId &&
    data.senderId &&
    data.senderId !== slotEntry.playerId &&
    data.senderId !== hostId
  );
  const moves = clientEngine.board?.moves || [];
  const occupied = moves.some(m => m.row === data.row && m.col === data.col);

  if (isWrongTurn || isUnauthorizedSender || occupied) {
    // If we are the authoritative Host, broadcast state reconciliation snapshot to resync the peer
    if (window.CaroMultiplayer?.isHost && window.CaroMultiplayer?.broadcastAuthoritativeState) {
      window.CaroMultiplayer.broadcastAuthoritativeState(data.senderId);
    }
    return;
  }

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
  if (Array.isArray(data.roster) && data.roster.length >= 2) {
    multiplayerRoster = data.roster.map(r => Object.assign({}, r, {
      isLocalHuman: r.type === "human" && r.playerId === window.CaroMultiplayer?.myId
    }));
    myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
  }
  clientEngine.status = "ready";
  clientEngine.battleNumber = data.battleNumber || (clientEngine.battleNumber + 1);
  const playerTypes = multiplayerRoster.map(p => p.type);
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);
  const fee = Number(window.CaroMultiplayer?.entryFee) || 0;
  applyRoomWagerForMatch(fee, nextState.game_id);
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(nextState);
}

function handleMultiplayerRoomLeave() {
  isMultiplayerActive = false;
  myMultiplayerSymbol = null;
  multiplayerRoster = [];
  currentMatchWagerPot = 0;
  clearMultiplayerTurnTimer();
  setSidebarRosterDisabled(false);
  updateRosterCount();

  const hud = document.getElementById("multiplayer-hud");
  if (hud) hud.style.display = "none";
  const emoteBar = document.getElementById("mp-emote-bar");
  if (emoteBar) emoteBar.style.display = "none";
  const approvalBar = document.getElementById("mp-host-approval-bar");
  if (approvalBar) approvalBar.style.display = "none";

  // Return to the Lobby Start Screen when leaving a room
  showLobbyHomeScreen();
}

function showMultiplayerHud(roomId) {
  const hud = document.getElementById("multiplayer-hud");
  if (hud && roomId) {
    hud.style.display = "flex";
    const rm = document.getElementById("mp-hud-room");
    const rmName = document.getElementById("mp-hud-room-name");
    if (rm) rm.textContent = roomId;
    if (rmName) rmName.textContent = window.CaroMultiplayer?.roomName || "Room:";
    const emoteBar = document.getElementById("mp-emote-bar");
    if (emoteBar) emoteBar.style.display = "flex";
    updateMultiplayerHudBadges();
  }
}

function updateMultiplayerHudBadges() {
  if (!window.CaroMultiplayer) return;
  const lobby = window.CaroMultiplayer.getLobbyState();
  const roleBadge = document.getElementById("mp-hud-role");
  const specBadge = document.getElementById("mp-hud-spectators");
  const wagerBadge = document.getElementById("mp-hud-wager");
  const scoreBadge = document.getElementById("mp-hud-scoreboard");
  const reqJoinBtn = document.getElementById("btn-mp-hud-request-join");
  const reqCountBadge = document.getElementById("mp-hud-req-badge");
  const rmName = document.getElementById("mp-hud-room-name");

  if (rmName && lobby.roomName) {
    rmName.textContent = `${lobby.roomName}:`;
  }
  if (roleBadge) {
    if (lobby.isHost) {
      roleBadge.textContent = `Host (${myMultiplayerSymbol || "A"})`;
    } else if (myMultiplayerSymbol) {
      roleBadge.textContent = `Player ${myMultiplayerSymbol}`;
    } else {
      roleBadge.textContent = "Spectating";
    }
  }
  if (specBadge) {
    const count = (lobby.spectators || []).length;
    specBadge.textContent = `${count} watching`;
  }
  if (wagerBadge) {
    const fee = Number(lobby.entryFee) || 0;
    if (fee > 0) {
      wagerBadge.style.display = "inline-block";
      const pot = currentMatchWagerPot || fee * Math.max(1, (lobby.slots || []).filter(s => s.type === "human").length);
      wagerBadge.textContent = `Pot: ${pot} (${fee} Entry)`;
    } else {
      wagerBadge.style.display = "none";
    }
  }
  if (scoreBadge) {
    const scores = lobby.sessionScores || window.CaroMultiplayer.getSessionScores?.() || {};
    const slots = lobby.slots || [];
    if (lobby.roomId && slots.length >= 2) {
      const symbols = ["A", "B", "C", "D"];
      const parts = slots.map((s, idx) => {
        const sym = symbols[idx] || "A";
        const entry = scores[sym];
        const wins = (entry && typeof entry === "object") ? (Number(entry.wins) || 0) : (Number(entry) || 0);
        const rawName = (s.name && s.name !== "Open human slot") ? s.name : sym;
        const shortName = rawName.replace(/\s*\(AI\)$/i, "").split(" ")[0];
        return `${shortName} ${wins}`;
      });
      scoreBadge.style.display = "inline-block";
      scoreBadge.textContent = `Score: ${parts.join(" – ")}`;
    } else {
      scoreBadge.style.display = "none";
    }
  }
  if (reqJoinBtn) {
    if (!lobby.isHost && !myMultiplayerSymbol) {
      reqJoinBtn.style.display = "inline-flex";
      reqJoinBtn.textContent = lobby.myPendingRequest
        ? "Requested"
        : (lobby.inGame ? "Request takeover" : "Request to join");
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
  const bar = document.getElementById("mp-hud-timer-bar");
  if (bar) {
    bar.style.width = "0%";
    bar.classList.remove("warning", "danger");
  }
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
  const rawTimeout = Number(window.CaroMultiplayer?.turnTimeoutSec ?? 30);
  if (!isMultiplayerActive || isReplayMode || !gameState || gameState.status === "finished" || rawTimeout === 0) {
    clearMultiplayerTurnTimer();
    return;
  }
  const timeoutSec = Math.max(1, rawTimeout || 30);
  const currSymbol = gameState.current_player?.symbol || "";
  const moveCount = gameState.board?.move_count || 0;
  const turnKey = `${gameState.game_id || ""}:${moveCount}:${currSymbol}:${timeoutSec}`;

  if (turnKey !== mpTurnTimerKey) {
    mpTurnTimerKey = turnKey;
    mpTurnDeadline = Date.now() + timeoutSec * 1000;
    mpTurnAutoPlayedKey = null;
  }

  const updateTimerTick = () => {
    const currentTimeout = Number(window.CaroMultiplayer?.turnTimeoutSec ?? 30);
    if (!isMultiplayerActive || !gameState || gameState.status === "finished" || currentTimeout === 0) {
      clearMultiplayerTurnTimer();
      return;
    }
    const totalMs = Math.max(1000, currentTimeout * 1000);
    const remMs = Math.max(0, mpTurnDeadline - Date.now());
    const remSec = Math.ceil(remMs / 1000);
    const badge = document.getElementById("mp-hud-timer");
    if (badge) {
      badge.style.display = "inline-block";
      badge.textContent = `${remSec}s`;
      badge.style.color = remSec <= 5 ? "#ef4444" : "";
    }
    const bar = document.getElementById("mp-hud-timer-bar");
    if (bar) {
      const pct = Math.max(0, Math.min(100, (remMs / totalMs) * 100));
      bar.style.width = `${pct.toFixed(1)}%`;
      bar.classList.toggle("danger", remSec <= 5);
      bar.classList.toggle("warning", remSec > 5 && remSec <= 10);
    }

    if (remMs <= 0 && mpTurnAutoPlayedKey !== mpTurnTimerKey) {
      const activeSym = gameState.current_player?.symbol;
      if (isLocalHumanAllowedToMove()) {
        mpTurnAutoPlayedKey = mpTurnTimerKey;
        const autoCoord = chooseTacticalAutoMove(myMultiplayerSymbol);
        updateMultiplayerHudStatus("Shot clock expired — auto-played tactical move");
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

function startNextMultiplayerBattle(options = {}) {
  if (!isMultiplayerActive || !clientEngine) return;
  const swapSeats = Boolean(options.swapSeats);
  clientEngine.battleNumber += 1;
  const updatedRoster = window.CaroMultiplayer.sendNextBattle(clientEngine.battleNumber, { swapSeats });
  if (Array.isArray(updatedRoster) && updatedRoster.length >= 2) {
    multiplayerRoster = updatedRoster;
    myMultiplayerSymbol = resolveMyMultiplayerSymbol(multiplayerRoster);
  }
  const playerTypes = multiplayerRoster.map(p => p.type);
  const nextState = clientEngine.newGame(playerTypes, false, multiplayerRoster);
  const fee = Number(window.CaroMultiplayer?.entryFee) || 0;
  applyRoomWagerForMatch(fee, nextState.game_id);
  userInteractedWithCamera = false;
  autoScaleCamera(true);
  handleStateUpdate(nextState);
  scheduleHostAiMoveIfNeeded();
}

function checkUrlForRoomInvite() {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");

  try {
    const savedRoom = sessionStorage.getItem("caro_active_room");
    const savedName = window.CaroAuth?.getCurrentUser()?.display_name || sessionStorage.getItem("caro_player_name");
    if (savedRoom && (!roomFromUrl || roomFromUrl.toLowerCase() === savedRoom.toLowerCase()) && window.CaroMultiplayer) {
      enterArenaBattleground({ startFreshPractice: false });
      window.CaroMultiplayer.joinRoom(savedRoom, savedName || undefined).catch(() => {});
      return;
    }
  } catch {}

  if (roomFromUrl) {
    enterArenaBattleground({ startFreshPractice: false });
    openMultiplayerModal("join");
    const codeInput = document.getElementById("mp-join-code-input");
    if (codeInput) codeInput.value = roomFromUrl;
  }
}

// ─────────────────────────────────────────
// Simple Account & Cranes Auth Modal UI
// ─────────────────────────────────────────
function formatCranesLedgerReason(reason) {
  const r = String(reason || "activity");
  if (r === "daily_bonus") return "Daily bonus claimed";
  if (r === "daily_puzzle_solved") return "Daily tactical puzzle solved";
  if (r === "series_champion_bonus") return "Series championship bonus";
  if (r === "multiplayer_win_1st") return "1st place multiplayer victory";
  if (r === "solo_practice_win_1st") return "1st place practice victory";
  if (r === "Match entry fee") return "Room entry wager staked";
  if (r.startsWith("unlock_theme_")) {
    const id = r.replace("unlock_theme_", "");
    const item = window.CaroAuth?.BOARD_THEMES_CATALOG?.[id];
    return `Unlocked ${item?.name || id} board`;
  }
  if (r.startsWith("unlock_stone_")) {
    const id = r.replace("unlock_stone_", "");
    const item = window.CaroAuth?.STONE_STYLES_CATALOG?.[id];
    return `Unlocked ${item?.name || id} stones`;
  }
  return r.replace(/_/g, " ");
}

function renderAuthCranesLedger() {
  const listEl = document.getElementById("auth-cranes-ledger-list");
  if (!listEl || !window.CaroAuth) return;
  const ledger = window.CaroAuth.getCranesLedger?.() || [];
  if (ledger.length === 0) {
    listEl.innerHTML = `<div class="mp-empty-rooms">No Cranes activity yet.</div>`;
    return;
  }
  listEl.innerHTML = ledger.slice(0, 12).map(entry => {
    const delta = Number(entry.delta) || 0;
    const sign = delta >= 0 ? "+" : "";
    const cls = delta >= 0 ? "positive" : "negative";
    const label = formatCranesLedgerReason(entry.reason);
    return `<div class="cranes-ledger-item">
      <span class="cranes-ledger-reason">${escapeHtml(label)}</span>
      <span class="cranes-ledger-delta ${cls}">${sign}${delta}</span>
    </div>`;
  }).join("");
}

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

  const svgUser = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  const updateAuthHeaderBtn = (user) => {
    if (!btnOpenAuth) return;
    if (user && user.display_name) {
      const cranes = user.cranes ?? 100;
      btnOpenAuth.innerHTML = `${svgUser}<span>${cranes} Cranes · ${escapeHtml(user.display_name)}</span>`;
    } else {
      const guestCranes = window.CaroAuth.getCranesBalance();
      btnOpenAuth.innerHTML = `${svgUser}<span>${guestCranes} Cranes · Sign in</span>`;
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
    renderAuthCranesLedger();
    renderLobbyHomeWalletAndThemes();
    renderCareerStats();
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
    renderLobbyHomeWalletAndThemes();
    const hostHomeInput = document.getElementById("lobby-home-host-name");
    if (hostHomeInput && user?.display_name) hostHomeInput.value = user.display_name;
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
      showAuthMsg("auth-profile-msg", "Signed in.", false);
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
      showAuthMsg("auth-profile-msg", "Account created with 100 Cranes.", false);
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
      showAuthMsg("auth-profile-msg", "Profile updated.", false);
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



