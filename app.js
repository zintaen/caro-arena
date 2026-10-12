/**
 * Caro Arena — Battle Royale Frontend
 * N-Player Free-For-All with Leaderboard Tracking
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
let socket = null, wsReconnectTimer = null;
let activeHistoryTab = "moves";

let clientEngine = null;
let isServerAvailable = false;

// ─────────────────────────────────────────
// Init
// ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

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
// WebSocket
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
  const isNewGame = gameState?.game_id && data.game_id !== gameState.game_id;
  gameState = data;
  if (isNewGame) userInteractedWithCamera = false;
  rebuildSymbolMap();
  updateUI();
  if (data.status === "finished" && !wasFinished) {
    fetchLeaderboard();
    fetchBattleHistory();
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
  document.getElementById("toggle-numbers").addEventListener("change", e => { showMoveNumbers = e.target.checked; renderBoard(); });
  document.getElementById("toggle-coords").addEventListener("change", e => { showCoords = e.target.checked; renderBoard(); });
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomCamera(1.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomCamera(0.833));
  document.getElementById("btn-recenter").addEventListener("click", recenterCamera);
  document.getElementById("btn-tab-moves").addEventListener("click", () => switchHistoryTab("moves"));
  document.getElementById("btn-tab-battles").addEventListener("click", () => switchHistoryTab("battles"));
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mouseleave", () => { hoverCoord = null; renderBoard(); });

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
    // If game hasn't started moves yet or is finished/ready, immediately update board with new roster
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
      const r = await fetch("/api/battles");
      renderBattleHistory(await r.json());
    } catch {}
  } else if (window.CaroEngine) {
    renderBattleHistory(window.CaroEngine.ClientStorage.getBattles());
  }
}

async function checkHealth() {
  if (isServerAvailable) {
    try {
      const r = await fetch("/api/health");
      await r.json();
    } catch {}
  }
}

async function toggleAutoPlay() {
  if (isReplayMode) return;
  const willEnable = !(gameState?.is_auto_playing);

  if (willEnable) {
    // Ensure the battle being run matches the roster checkboxes in the UI!
    const selected = getSelectedRoster();
    const currentTypes = (gameState?.players || []).map(p => p.type).sort();
    const selectedSorted = [...selected].sort();
    const rosterMismatch = JSON.stringify(currentTypes) !== JSON.stringify(selectedSorted);

    if (rosterMismatch || !gameState || gameState.status === "finished" || (gameState.board?.move_count === 0)) {
      await newBattle();
    }
  }

  if (isServerAvailable) {
    try {
      await fetch("/api/battle/auto-play", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: willEnable, delay_sec: 0.02 })
      });
      if (gameState) gameState.is_auto_playing = willEnable;
      updateAutoPlayButton();
    } catch {}
  } else if (clientEngine) {
    clientEngine.toggleAutoPlay(willEnable, 0.02);
    if (gameState) gameState.is_auto_playing = willEnable;
    updateAutoPlayButton();
  }
}

async function newBattle() {
  if (isReplayMode) exitReplayMode();
  const roster = getSelectedRoster();
  if (roster.length < 2) return;
  userInteractedWithCamera = false;

  if (isServerAvailable) {
    try {
      const r = await fetch("/api/battle/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: roster })
      });
      handleStateUpdate(await r.json());
    } catch {}
  } else if (clientEngine) {
    handleStateUpdate(clientEngine.newGame(roster));
  }

  autoScaleCamera(true);
  renderBoard();
}

async function resetAll() {
  if (isReplayMode) exitReplayMode();
  try {
    if (gameState) gameState.is_auto_playing = false;
    updateAutoPlayButton();

    // Reset checkboxes to default: Laya, Jev, Von, MoJev checked; Human unchecked
    document.querySelectorAll("#roster-config .roster-toggle").forEach(label => {
      const cb = label.querySelector("input");
      if (cb) {
        cb.checked = (label.dataset.model !== "human");
      }
    });
    updateRosterCount();

    if (isServerAvailable) {
      await fetch("/api/history/clear", { method: "POST" });
    } else if (clientEngine) {
      window.CaroEngine.ClientStorage.clearHistory();
      clientEngine.battleNumber = 1;
      clientEngine.selectedPlayerTypes = ["laya", "jev", "von", "mojev"];
      clientEngine.newGame(["laya", "jev", "von", "mojev"]);
    }

    userInteractedWithCamera = false;
    await fetchState();
    await fetchLeaderboard();
    await fetchBattleHistory();
    autoScaleCamera(true);
    renderBoard();
  } catch {}
}

async function sendHumanMove(r, c) {
  if (isServerAvailable) {
    try {
      const res = await fetch("/api/battle/human-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: r, col: c })
      });
      if (res.ok) {
        handleStateUpdate(await res.json());
      }
    } catch {}
  } else if (clientEngine) {
    const nextState = clientEngine.humanMove(r, c);
    if (nextState) {
      handleStateUpdate(nextState);
    }
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
  bar.style.display = (gameState?.is_human_turn && gameState?.status !== "finished") ? "flex" : "none";
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
      const suffix = gameState.is_auto_playing ? " · Next in 3s" : "";
      text.textContent = `Battle #${bn} · ${winner.name} wins!${suffix}`;
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

// ─────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────
function renderLeaderboard() {
  const tbody = document.getElementById("leaderboard-body");
  const badge = document.getElementById("total-battles-badge");
  if (!tbody || !cachedLeaderboard) return;

  const totalBattles = cachedLeaderboard.length > 0 ? cachedLeaderboard[0].battles_played : 0;
  if (badge) badge.textContent = `${totalBattles} battle${totalBattles !== 1 ? "s" : ""}`;

  if (cachedLeaderboard.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No battles yet</td></tr>`;
    return;
  }

  tbody.innerHTML = cachedLeaderboard.map((p, i) => {
    const meta = PLAYER_COLORS[p.player_type] || { fill: "#94a3b8", name: p.player_type };
    const rankIcon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
    return `<tr class="${i === 0 ? "leader" : ""}">
      <td class="rank-cell">${rankIcon}</td>
      <td><span class="model-dot" style="background:${meta.fill}"></span>${meta.name}</td>
      <td class="mono">${p.total_points}</td>
      <td class="mono">${p.wins}</td>
      <td class="mono">${p.avg_placement.toFixed(1)}</td>
      <td class="mono muted">${p.battles_played}</td>
    </tr>`;
  }).join("");
}

// ─────────────────────────────────────────
// Battle Roster (current battle status)
// ─────────────────────────────────────────
function renderBattleRoster() {
  const el = document.getElementById("battle-roster");
  const badge = document.getElementById("battle-number-badge");
  if (!el || !gameState) return;

  if (badge) badge.textContent = `Battle #${gameState.series?.battle_number || 1}`;

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
      const total = players.length;
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

  if (gameState?.game_id !== lastRenderedGameId) {
    lastRenderedGameId = gameState?.game_id;
    list.innerHTML = "";
    lastRenderedMoveCount = 0;
    _lastAutoScaleMoveCount = -1;
    userInteractedWithCamera = false;
    autoScaleCamera(true);
  }

  if (!moves || moves.length === 0) {
    if (lastRenderedMoveCount !== 0 || !list.children.length) {
      list.innerHTML = `<li class="empty-state">No moves yet.</li>`;
      lastRenderedMoveCount = 0;
    }
    return;
  }

  if (lastRenderedMoveCount === 0 || list.querySelector(".empty-state")) {
    list.innerHTML = "";
    lastRenderedMoveCount = 0;
  }
  if (moves.length < lastRenderedMoveCount) {
    list.innerHTML = "";
    lastRenderedMoveCount = 0;
  }

  if (moves.length > lastRenderedMoveCount) {
    const frag = document.createDocumentFragment();
    for (let i = lastRenderedMoveCount; i < moves.length; i++) {
      const m = moves[i];
      const meta = getPlayerMeta(m.player);
      const li = document.createElement("li");
      li.className = "move-item";
      const lat = m.metadata?.latency_ms ? `${Math.round(m.metadata.latency_ms)}ms` : "";
      li.innerHTML = `<span style="color:${meta.color};font-weight:600">#${m.move_number}</span>
        <span>${meta.name}</span>
        <span class="mono">(${m.row},${m.col})</span>
        <span class="muted">${lat}</span>`;
      frag.appendChild(li);
    }
    list.appendChild(frag);
    list.scrollTop = list.scrollHeight;
    lastRenderedMoveCount = moves.length;
  }
}

// ─────────────────────────────────────────
// Canvas: Camera, Pan, Zoom
// ─────────────────────────────────────────
function zoomCamera(factor) {
  userInteractedWithCamera = true;
  const newZ = Math.max(0.2, Math.min(4.0, camera.zoom * factor));
  const cx = canvas.width / 2, cy = canvas.height / 2;
  camera.x = cx - (cx - camera.x) * (newZ / camera.zoom);
  camera.y = cy - (cy - camera.y) * (newZ / camera.zoom);
  camera.zoom = newZ;
  renderBoard();
}
function recenterCamera() { userInteractedWithCamera = false; autoScaleCamera(true); renderBoard(); }
function autoScaleCamera(force) {
  if (isDragging && !force) return;
  if (userInteractedWithCamera && !force) return;
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves;
  const moveCount = moves?.length || 0;
  if (!force && moveCount === _lastAutoScaleMoveCount) return;
  _lastAutoScaleMoveCount = moveCount;
  if (!moves || !moves.length) { camera.zoom = 1.0; camera.x = canvas.width / 2; camera.y = canvas.height / 2; return; }
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  moves.forEach(m => { minR = Math.min(minR, m.row); maxR = Math.max(maxR, m.row); minC = Math.min(minC, m.col); maxC = Math.max(maxC, m.col); });
  const pad = 3, rSpan = Math.max(13, maxR - minR + 1 + 2 * pad), cSpan = Math.max(13, maxC - minC + 1 + 2 * pad);
  const maxSpan = Math.max(rSpan, cSpan);
  const avail = Math.min(canvas.width, canvas.height) - 40;
  camera.zoom = Math.max(0.22, Math.min(1.05, avail / maxSpan / camera.baseCellSize));
  const cs = camera.baseCellSize * camera.zoom;
  camera.x = canvas.width / 2 - ((minC + maxC) / 2) * cs;
  camera.y = canvas.height / 2 - ((minR + maxR) / 2) * cs;
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
    camera.x = camStartX + dx; camera.y = camStartY + dy; renderBoard();
  } else {
    if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) {
      hoverCoord = screenToBoard(sx, sy);
      canvas.style.cursor = gameState?.is_human_turn ? "pointer" : "crosshair";
    } else { hoverCoord = null; }
    renderBoard();
  }
}
function onMouseUp(e) {
  if (isDragging) {
    isDragging = false;
    canvas.style.cursor = gameState?.is_human_turn ? "pointer" : "crosshair";

    // Human click-to-play: if we didn't drag and not in replay, treat as a click
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
// Board Rendering
// ─────────────────────────────────────────
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

  const o = boardToScreen(0, 0);
  ctx.strokeStyle = "rgba(55, 28, 10, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(o.x - 6, o.y); ctx.lineTo(o.x + 6, o.y); ctx.moveTo(o.x, o.y - 6); ctx.lineTo(o.x, o.y + 6); ctx.stroke();

  if (showCoords && camera.zoom >= 0.5) {
    ctx.fillStyle = "rgba(80, 48, 20, 0.55)";
    ctx.font = `600 ${Math.round(9 * Math.min(1.3, Math.max(0.8, camera.zoom)))}px var(--font-mono, monospace)`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const step = camera.zoom > 0.85 ? 2 : 4;
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      if (r % step === 0 && c % step === 0) { const pt = boardToScreen(r, c); ctx.fillText(`${r},${c}`, pt.x + 12 * camera.zoom, pt.y - 8 * camera.zoom); }
    }
  }

  // Draw stones
  const moves = isReplayMode ? replayMoves.slice(0, replayIndex) : gameState?.board?.moves || [];
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  moves.forEach(m => drawStone(m.row, m.col, m.player, cs, m.move_number));

  // Human hover ghost
  if (hoverCoord && gameState?.is_human_turn && gameState?.status !== "finished") {
    const occupied = moves.some(m => m.row === hoverCoord.r && m.col === hoverCoord.c);
    if (!occupied) {
      const pt = boardToScreen(hoverCoord.r, hoverCoord.c);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#d97706";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, cs * 0.38, 0, Math.PI * 2);
      ctx.fill();
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

      // 3. Floating Winner Badge above the winning row
      const midCoord = pl.winning_line[Math.floor(pl.winning_line.length / 2)];
      const midPt = boardToScreen(midCoord[0], midCoord[1]);
      const badgeY = midPt.y - cs * 0.70;
      const rankText = pl.rank === 1 ? `🥇 ${meta.name} · 5 in a row` : `#${pl.rank} ${meta.name} · 5 in a row`;

      ctx.save();
      ctx.font = `700 ${Math.max(10, Math.round(11 * camera.zoom))}px var(--font-sans, sans-serif)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const metrics = ctx.measureText(rankText);
      const bgW = metrics.width + Math.max(14, 18 * camera.zoom);
      const bgH = Math.max(18, Math.round(22 * camera.zoom));

      // Badge pill background
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(midPt.x - bgW / 2, badgeY - bgH / 2, bgW, bgH, 999);
      } else {
        ctx.rect(midPt.x - bgW / 2, badgeY - bgH / 2, bgW, bgH);
      }
      ctx.fill();

      // Badge border in gold
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.5 * camera.zoom;
      ctx.stroke();

      // Text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(rankText, midPt.x, badgeY);
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
// Replay
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
  updateUI();
}

window.startReplay = startReplay;
window.exitReplayMode = exitReplayMode;
window.stepReplay = stepReplay;
