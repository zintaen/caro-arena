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

let symbolMap = {};
let gameState = null;
let cachedLeaderboard = null;
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
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const confCanvas = document.getElementById("confetti-canvas");
  if (confCanvas) confettiEngine = new ConfettiEngine(confCanvas);

  // Check if backend API server is available
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch("/api/health", { signal: ctrl.signal });
    clearTimeout(timeout);
    if (r.ok) isServerAvailable = true;
  } catch {
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
  const replayParam = urlParams.get("replay");
  if (replayParam) {
    await startReplay(replayParam);
    return;
  }
  if (urlParams.get("autoplay") === "1" || urlParams.get("autoplay") === "true") {
    setTimeout(() => toggleAutoPlay(), 300);
  }

  // Ensure initial game matches checked roster (4 AI models, 0 Human)
  const selected = getSelectedRoster();
  const currentTypes = (gameState?.players || []).map(p => p.type).sort();
  const selectedSorted = [...selected].sort();
  if (gameState && (gameState.board?.move_count === 0 || gameState.status === "ready") && JSON.stringify(currentTypes) !== JSON.stringify(selectedSorted)) {
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
function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.onopen = () => { if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; } };
    socket.onmessage = (e) => { try { handleStateUpdate(JSON.parse(e.data)); } catch {} };
    socket.onclose = () => { if (!wsReconnectTimer) wsReconnectTimer = setTimeout(connectWebSocket, 2000); };
    socket.onerror = () => {};
  } catch {}
}

function handleStateUpdate(data) {
  if (isReplayMode) return;
  const wasFinished = gameState?.status === "finished";
  const wasPlaying = gameState?.status === "playing";
  const isNewGame = gameState?.game_id && data.game_id !== gameState.game_id;
  const prevMoveCount = gameState?.board?.moves?.length || 0;
  const newMoveCount = data?.board?.moves?.length || 0;

  gameState = data;
  if (isNewGame) userInteractedWithCamera = false;
  rebuildSymbolMap();
  updateUI();

  // Audio feedback for remote server updates
  if (isServerAvailable && window.CaroAudio && newMoveCount > prevMoveCount) {
    const lastM = data.board.moves[newMoveCount - 1];
    const pInfo = data.players.find(p => p.symbol === lastM.player);
    window.CaroAudio.playStoneClick(pInfo?.type || "ai");
  }

  // Human turn chime
  const isHumanTurn = data.is_human_turn && data.status !== "finished";
  if (isHumanTurn && !lastWasHumanTurn && window.CaroAudio) {
    window.CaroAudio.playHumanTurnAlert();
  }
  lastWasHumanTurn = isHumanTurn;

  if (data.status === "finished" && !wasFinished) {
    fetchLeaderboard();
    fetchBattleHistory();
    showWinnerModal(data);
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
  document.getElementById("btn-new").addEventListener("click", newBattle);
  document.getElementById("btn-reset").addEventListener("click", resetAll);

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

  // Battle Winner Modal confirmation actions
  document.getElementById("btn-next-battle")?.addEventListener("click", onConfirmNextBattle);
  document.getElementById("btn-inspect-board")?.addEventListener("click", closeWinnerModal);
  document.getElementById("winner-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "winner-modal") closeWinnerModal();
  });
  window.addEventListener("keydown", (e) => {
    const wm = document.getElementById("winner-modal");
    if (wm && wm.style.display !== "none") {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onConfirmNextBattle();
      } else if (e.key === "Escape") {
        closeWinnerModal();
      }
    }
  });

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
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const scX = canvas.width / rect.width, scY = canvas.height / rect.height;
      const sx = (t.clientX - rect.left) * scX, sy = (t.clientY - rect.top) * scY;
      const coord = screenToBoard(sx, sy);
      if (gameState?.is_human_turn && gameState?.status !== "finished") {
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
  if (isServerAvailable) {
    try { const r = await fetch("/api/battle/current"); handleStateUpdate(await r.json()); } catch {}
  } else if (clientEngine) {
    handleStateUpdate(clientEngine.getState());
  }
}

async function fetchLeaderboard() {
  if (isServerAvailable) {
    try {
      const r = await fetch("/api/leaderboard");
      cachedLeaderboard = await r.json();
      renderLeaderboard();
    } catch {}
  } else if (window.CaroEngine) {
    cachedLeaderboard = window.CaroEngine.ClientStorage.getLeaderboard();
    renderLeaderboard();
  }
}

async function fetchBattleHistory() {
  if (isServerAvailable) {
    try {
      const r = await fetch("/api/battles?limit=50");
      renderBattleHistory(await r.json());
    } catch {}
  } else if (window.CaroEngine) {
    renderBattleHistory(window.CaroEngine.ClientStorage.getBattles());
  }
}

async function toggleAutoPlay() {
  if (isReplayMode) exitReplayMode();
  const currentlyPlaying = gameState?.is_auto_playing;
  const targetState = !currentlyPlaying;
  const delaySec = window.CaroSandboxConfig.delaySec || 0.02;

  if (isServerAvailable) {
    try {
      await fetch("/api/battle/auto-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: targetState, delay_sec: delaySec })
      });
      await fetchState();
    } catch {}
  } else if (clientEngine) {
    clientEngine.toggleAutoPlay(targetState, delaySec);
  }
}

async function newBattle() {
  if (isReplayMode) exitReplayMode();
  const selected = getSelectedRoster();
  if (selected.length < 2) return;

  if (isServerAvailable) {
    try {
      const res = await fetch("/api/battle/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: selected })
      });
      handleStateUpdate(await res.json());
      userInteractedWithCamera = false;
      autoScaleCamera(true);
      renderBoard();
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
    if (isServerAvailable) {
      try { await fetch("/api/history/clear", { method: "POST" }); } catch {}
    } else if (window.CaroEngine) {
      window.CaroEngine.ClientStorage.clearHistory();
      if (clientEngine) clientEngine.newGame(["laya", "jev", "von", "mojev"]);
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
  if (window.CaroAudio) window.CaroAudio.playStoneClick("human");

  if (isServerAvailable) {
    try {
      const res = await fetch("/api/battle/human-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: r, col: c })
      });
      if (res.ok) handleStateUpdate(await res.json());
    } catch {}
  } else if (clientEngine) {
    const nextState = clientEngine.humanMove(r, c);
    if (nextState) handleStateUpdate(nextState);
  }
}

async function undoHumanMove() {
  if (isReplayMode) return;
  if (isServerAvailable) {
    try {
      const r = await fetch("/api/battle/undo", { method: "POST" });
      if (r.ok) handleStateUpdate(await r.json());
    } catch {}
  } else if (clientEngine) {
    clientEngine.undoHumanMove();
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
  if (!info) return { type: "unknown", name: symbol, color: "#94a3b8" };
  const colors = PLAYER_COLORS[info.type] || { fill: "#94a3b8", name: info.type };
  return { type: info.type, name: colors.name, color: colors.fill, light: colors.light };
}

function updateHumanTurnBar() {
  const bar = document.getElementById("human-turn-bar");
  if (!bar) return;
  const hasHuman = Boolean(
    gameState?.players?.some(p => p.type === "human") ||
    gameState?.has_human ||
    (clientEngine && clientEngine.hasHumanPlayer())
  );
  const isHumanWaiting = hasHuman && Boolean(gameState?.is_human_turn) && gameState?.status !== "finished";
  bar.classList.toggle("active", isHumanWaiting);
  bar.style.display = isHumanWaiting ? "flex" : "none";
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

  const bn = gameState.series?.battle_number || 1;
  if (gameState.status === "finished") {
    const placements = gameState.board?.placements || [];
    if (placements.length > 0) {
      const winner = getPlayerMeta(placements[0].player);
      dot.style.background = winner.color;
      text.textContent = `Battle #${bn} · ${winner.name} wins!`;
    } else {
      dot.style.background = "#94a3b8";
      text.textContent = `Battle #${bn} · Draw`;
    }
  } else if (gameState.is_human_turn) {
    dot.style.background = "#d97706";
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
  const isPlaying = gameState?.is_auto_playing;
  if (isPlaying) {
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 3h3v10H4V3zm5 0h3v10H9V3z"/></svg><span>Pause</span>`;
    btn.classList.add("btn-active");
  } else {
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5V2.5z"/></svg><span>Battle</span>`;
    btn.classList.remove("btn-active");
  }
}

function renderLeaderboard() {
  const tbody = document.getElementById("leaderboard-body");
  const badge = document.getElementById("total-battles-badge");
  if (!tbody) return;

  const data = cachedLeaderboard || [];
  const totalBattles = data.reduce((max, r) => Math.max(max, r.battles_played || 0), 0);
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
      <td><span class="model-dot" style="background:${meta.fill}"></span>${meta.name}</td>
      <td class="mono"><strong>${r.total_points}</strong></td>
      <td class="mono muted">${r.wins}</td>
      <td class="mono muted">${r.avg_placement}</td>
      <td class="mono muted">${r.battles_played}</td>
    </tr>`;
  }).join("");
}

function renderBattleRoster() {
  const el = document.getElementById("battle-roster");
  const bnBadge = document.getElementById("battle-number-badge");
  if (!el || !gameState) return;

  const bn = gameState.series?.battle_number || 1;
  if (bnBadge) bnBadge.textContent = isReplayMode ? "Replay Mode" : `Battle #${bn}`;

  const players = gameState.players || [];
  const placements = gameState.board?.placements || [];
  const eliminated = gameState.board?.eliminated_players || [];
  const current = gameState.current_player?.symbol;

  el.innerHTML = players.map(p => {
    const meta = PLAYER_COLORS[p.type] || { fill: "#94a3b8", name: p.type };
    const placement = placements.find(pl => pl.player === p.symbol);
    const isElim = eliminated.includes(p.symbol);
    const isCurrent = current === p.symbol && gameState.status !== "finished";
    const isThinking = gameState.is_thinking && isCurrent;
    const isHumanWaiting = p.type === "human" && isCurrent && gameState.is_human_turn;

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
      statusText = "Waiting";
      statusClass = "";
    }

    const moveCount = (gameState.board?.moves || []).filter(m => m.player === p.symbol).length;

    return `<div class="roster-slot ${statusClass}" style="--pc: ${meta.fill}">
      <div class="roster-ident">
        <span class="roster-dot" style="background: ${meta.fill}"></span>
        <span class="roster-name">${meta.name}</span>
        <span class="roster-symbol">${p.symbol}</span>
      </div>
      <div class="roster-stats">
        <span class="roster-moves">${moveCount} moves</span>
        <span class="roster-status ${statusClass}">${statusText}</span>
      </div>
    </div>`;
  }).join("");
}

function renderPlayerLegend() {
  const el = document.getElementById("player-legend");
  if (!el || !gameState?.players) return;
  el.innerHTML = gameState.players.map(p => {
    const meta = PLAYER_COLORS[p.type] || { fill: "#94a3b8", name: p.type };
    return `<div class="legend-item"><span class="legend-swatch" style="background:${meta.fill}"></span>${meta.name} (${p.symbol})</div>`;
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
    const winnerHtml = winnerMeta ? `<span class="model-dot" style="background:${winnerMeta.fill}"></span>${winnerMeta.name}` : "Draw";
    return `<tr>
      <td class="mono">#${b.battle_id}</td>
      <td>${winnerHtml}</td>
      <td class="mono muted">${b.total_moves}</td>
      <td><button class="btn btn-xs" onclick="startReplay('${b.battle_id}')">Review</button></td>
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
      <span class="mono" style="color: ${meta.color}; font-weight: 600;">#${m.move_number}</span>
      <span style="font-weight: 600;">${meta.name}</span>
      <span class="mono">(${m.row}, ${m.col})</span>
      <span class="mono muted" style="margin-left: auto;">${lat}</span>
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
function screenToBoard(sx, sy) { const cs = camera.baseCellSize * camera.zoom; return { r: Math.round((sy - camera.y) / cs), c: Math.round((sx - camera.x) / cs) }; }

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
      canvas.style.cursor = gameState?.is_human_turn ? "pointer" : "crosshair";

      // Tactical Ghost HUD tooltip for human turn
      const hud = document.getElementById("ghost-hud");
      if (gameState?.is_human_turn && gameState?.status !== "finished" && hud && window.CaroEngine?.TacticalEvaluator) {
        const moves = gameState?.board?.moves || [];
        const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
        if (!occupied) {
          const boardObj = clientEngine ? clientEngine.board : reconstructBoardFromState(gameState);
          if (boardObj) {
            const humanSymbol = gameState.players.find(p => p.type === "human")?.symbol || "E";
            let sumR = 0, sumC = 0;
            for (const key of boardObj.stones.keys()) {
              const [kr, kc] = key.split(",").map(Number);
              sumR += kr; sumC += kc;
            }
            const centroid = boardObj.stones.size ? [sumR / boardObj.stones.size, sumC / boardObj.stones.size] : [0, 0];
            const evalRes = window.CaroEngine.TacticalEvaluator.evaluateMove(boardObj, hoverCoord.r, hoverCoord.c, humanSymbol, centroid);

            const scoreText = evalRes.total_score >= 20000 ? "🔥 WIN / BLOCK" : `Score: ${evalRes.total_score}`;
            hud.innerHTML = `<span class="score-badge">${scoreText}</span> ${evalRes.summary}`;
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
    canvas.style.cursor = gameState?.is_human_turn ? "pointer" : "crosshair";

    if (!hasDragged && !isReplayMode && gameState?.is_human_turn && gameState?.status !== "finished") {
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
function reconstructBoardFromState(state) {
  if (!window.CaroEngine?.CaroBoard || !state?.board) return null;
  const symbols = (state.players || []).map(p => p.symbol);
  const b = new window.CaroEngine.CaroBoard(0, "standard", symbols);
  for (const m of (state.board.moves || [])) {
    b.makeMove(m.row, m.col, m.player, m.metadata);
  }
  return b;
}

function drawThreatHeatmap(cs) {
  if (!window.CaroEngine?.TacticalEvaluator) return;
  const boardObj = clientEngine ? clientEngine.board : reconstructBoardFromState(gameState);
  if (!boardObj || boardObj.stones.size === 0) return;

  const currentSymbol = gameState?.board?.current_player || "A";
  const heatmap = window.CaroEngine.TacticalEvaluator.getThreatHeatmap(boardObj, currentSymbol);
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
  if (!window.CaroEngine?.TacticalEvaluator) return;
  const boardObj = clientEngine ? clientEngine.board : reconstructBoardFromState(gameState);
  if (!boardObj || boardObj.stones.size < 2) return;

  const threatLines = window.CaroEngine.TacticalEvaluator.findThreatLines(boardObj);
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
    if (showHeatmap || showLasers || (hoverCoord && gameState?.is_human_turn)) {
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
  if (hoverCoord && gameState?.is_human_turn && gameState?.status !== "finished") {
    const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
    if (!occupied) {
      const pt = boardToScreen(hoverCoord.r, hoverCoord.c);
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
      ctx.fillStyle = "#d97706";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, cs * 0.40, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing outer ring
      const pulseTime = Date.now() / 200;
      const ringRadius = cs * (0.42 + Math.sin(pulseTime) * 0.05);
      ctx.strokeStyle = "#fbbf24";
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
      const rankText = pl.rank === 1 ? `🥇 ${meta.name} · 5 in a row` : `#${pl.rank} ${meta.name} · 5 in a row`;

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
  const info = symbolMap[symbol];
  const ptype = info?.type || "laya";
  const style = STONE_STYLES[ptype] || STONE_STYLES.laya;

  ctx.save();
  ctx.shadowColor = "rgba(60, 30, 10, 0.35)";
  ctx.shadowBlur = 5 * camera.zoom;
  ctx.shadowOffsetX = 1.2 * camera.zoom;
  ctx.shadowOffsetY = 2.4 * camera.zoom;

  const stoneGrad = ctx.createRadialGradient(
    pt.x - radius * 0.35, pt.y - radius * 0.35, radius * 0.08,
    pt.x, pt.y, radius
  );
  stoneGrad.addColorStop(0, style.body[2]);
  stoneGrad.addColorStop(0.6, style.body[1]);
  stoneGrad.addColorStop(1, style.body[0]);
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
    ctx.fillStyle = style.text;
    ctx.font = `600 ${Math.round(radius * 0.72)}px var(--font-sans, sans-serif)`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(moveNumber.toString(), pt.x, pt.y);
  }
}

// ─────────────────────────────────────────
// Replay System
// ─────────────────────────────────────────
async function startReplay(battleId) {
  try {
    if (gameState?.is_auto_playing) await toggleAutoPlay();
    let b = null;
    if (isServerAvailable) {
      const r = await fetch(`/api/battles/${battleId}`);
      b = await r.json();
    } else if (window.CaroEngine) {
      const battles = window.CaroEngine.ClientStorage.getBattles();
      b = battles.find(x => x.battle_id === battleId);
    }
    if (!b) return;

    isReplayMode = true;
    replayMoves = b.moves_data || [];
    replayPlayers = b.player_order || [];
    replayPlacements = b.placements || [];
    replayIndex = replayMoves.length;

    symbolMap = {};
    for (const p of replayPlayers) {
      symbolMap[p.symbol] = p;
    }

    document.getElementById("replay-bar").style.display = "flex";
    document.getElementById("btn-auto").disabled = true;
    userInteractedWithCamera = false;
    autoScaleCamera(true);
    updateUI();
  } catch {}
}

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
  renderBoard();
  updateMoveHistory();
}

// ─────────────────────────────────────────
// Battle Flow & Winner Confirmation Modal
// ─────────────────────────────────────────
let lastWinnerModalGameId = null;

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

function showWinnerModal(data) {
  if (!data || data.status !== "finished") return;
  const gameKey = data.game_id || (data.series?.battle_number ? `battle_${data.series.battle_number}` : null);
  if (gameKey && gameKey === lastWinnerModalGameId) return;
  lastWinnerModalGameId = gameKey;

  const modal = document.getElementById("winner-modal");
  if (!modal) return;

  const bn = data.series?.battle_number || data.battle_number || 1;
  const placements = data.board?.placements || [];
  const headline = document.getElementById("winner-headline");
  const avatar = document.getElementById("winner-avatar");
  const name = document.getElementById("winner-name");
  const details = document.getElementById("winner-details");
  const totalMoves = data.board?.moves?.length || 0;

  if (placements.length > 0 && placements[0].winning_line) {
    const winnerMeta = getPlayerMeta(placements[0].player);
    if (headline) headline.textContent = `Battle #${bn} Finished!`;
    if (avatar) {
      avatar.style.color = winnerMeta.color;
      avatar.textContent = "●";
    }
    if (name) {
      name.textContent = winnerMeta.name;
      name.style.color = winnerMeta.color;
    }
    if (details) {
      details.textContent = `Claimed 5-in-a-row in ${totalMoves} moves`;
    }
  } else {
    if (headline) headline.textContent = `Battle #${bn} Ended`;
    if (avatar) {
      avatar.style.color = "#94a3b8";
      avatar.textContent = "⚖";
    }
    if (name) {
      name.textContent = "Draw Game";
      name.style.color = "var(--text-primary)";
    }
    if (details) {
      details.textContent = `Board reached draw after ${totalMoves} moves`;
    }
  }

  modal.style.display = "flex";

  if (window.CaroAudio) window.CaroAudio.playChampionshipFanfare();
  if (confettiEngine) confettiEngine.launch(3500);
}

function closeWinnerModal() {
  const modal = document.getElementById("winner-modal");
  if (modal) modal.style.display = "none";
}

function onConfirmNextBattle() {
  closeWinnerModal();
  newBattle();
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
