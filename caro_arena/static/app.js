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

