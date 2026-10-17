/**
 * Caro Arena — Replay Controller, Momentum Sparkline, Candidate Hints & Snapshot/Export
 */
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
// ─────────────────────────────────────────
// Replay Auto-Play & Speed Controls
// ─────────────────────────────────────────
let _replayAutoTimer = null;
let _replaySpeedMult = 1; // 1x, 2x, 4x
const REPLAY_SPEEDS = [1, 2, 4];

function stopReplayAutoPlay() {
  if (_replayAutoTimer) {
    clearInterval(_replayAutoTimer);
    _replayAutoTimer = null;
  }
  const btn = document.getElementById("btn-replay-autoplay");
  if (btn) {
    btn.classList.remove("btn-active");
    btn.textContent = "▶ Play";
  }
}

function toggleReplayAutoPlay() {
  if (!isReplayMode) return false;
  if (_replayAutoTimer) {
    stopReplayAutoPlay();
    return false;
  }
  if (replayIndex >= replayMoves.length) {
    replayIndex = 0;
    updateUI();
  }
  const btn = document.getElementById("btn-replay-autoplay");
  if (btn) {
    btn.classList.add("btn-active");
    btn.textContent = "⏸ Pause";
  }
  const intervalMs = Math.max(120, Math.round(640 / _replaySpeedMult));
  _replayAutoTimer = setInterval(() => {
    if (!isReplayMode || replayIndex >= replayMoves.length) {
      stopReplayAutoPlay();
      return;
    }
    stepReplay(1);
    if (replayIndex >= replayMoves.length) {
      stopReplayAutoPlay();
    }
  }, intervalMs);
  return true;
}

function cycleReplaySpeed() {
  const curIdx = REPLAY_SPEEDS.indexOf(_replaySpeedMult);
  _replaySpeedMult = REPLAY_SPEEDS[(curIdx + 1) % REPLAY_SPEEDS.length];
  const btn = document.getElementById("btn-replay-speed");
  if (btn) btn.textContent = `${_replaySpeedMult}x`;
  if (_replayAutoTimer) {
    stopReplayAutoPlay();
    toggleReplayAutoPlay();
  }
  return _replaySpeedMult;
}

// ─────────────────────────────────────────
// Share as Puzzle (?puzzle=...) Challenge Links
// ─────────────────────────────────────────
function encodePuzzlePayload(players, moves, title = "Community Challenge") {
  const compact = {
    t: String(title || "Community Challenge").slice(0, 40),
    p: (players || []).map(p => [p.symbol, p.type, p.name || p.type]),
    m: (moves || []).map(m => [m.row, m.col, m.player])
  };
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePuzzlePayload(encoded) {
  const b64 = String(encoded || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const compact = JSON.parse(new TextDecoder().decode(bytes));
  return {
    title: compact.t || "Community Challenge",
    players: (compact.p || []).map(([symbol, type, name]) => ({ symbol, type, name })),
    moves: (compact.m || []).map(([row, col, player], idx) => ({
      row: Number(row) || 0,
      col: Number(col) || 0,
      player: player || "A",
      move_number: idx + 1
    }))
  };
}

function getSharePuzzleUrl() {
  const players = isReplayMode ? replayPlayers : (gameState?.players || []);
  let moves = [];
  if (isReplayMode) {
    const cut = (replayIndex > 0 && replayIndex < replayMoves.length)
      ? replayIndex
      : Math.max(1, replayMoves.length - 1);
    moves = replayMoves.slice(0, cut);
  } else {
    const allMoves = gameState?.board?.moves || [];
    const cut = (gameState?.status === "finished" && allMoves.length > 1)
      ? allMoves.length - 1
      : allMoves.length;
    moves = allMoves.slice(0, cut);
  }
  const encoded = encodePuzzlePayload(players, moves, `Challenge at move #${moves.length}`);
  return `${window.location.origin}${window.location.pathname}?puzzle=${encoded}`;
}

function shareCurrentStateAsPuzzle() {
  const url = getSharePuzzleUrl();
  const btn = document.getElementById("btn-share-puzzle");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).catch(() => {});
  }
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
  showArenaToast("Copied interactive puzzle challenge link!");
  return url;
}

function launchCustomPuzzleFromPayload(encoded) {
  try {
    const data = decodePuzzlePayload(encoded);
    if (!data || !Array.isArray(data.moves)) return null;
    if (isReplayMode) exitReplayMode();
    if (!clientEngine && window.CaroEngine) {
      clientEngine = new window.CaroEngine.ClientGameManager();
      clientEngine.onStateChange = (state) => {
        if (!useBackend()) handleStateUpdate(state);
      };
    }
    if (!clientEngine) return null;
    useClientEngineOverride = true;
    enterArenaBattleground();

    const srcPlayers = data.players && data.players.length >= 2
      ? data.players
      : [{ symbol: "A", type: "human", name: "Human" }, { symbol: "B", type: "von", name: "Von" }];
    // Ensure whoever's turn is next is human-controllable so the solver can play immediately
    const nextIdx = data.moves.length % srcPlayers.length;
    const normalizedPlayers = srcPlayers.map((p, idx) => (
      idx === nextIdx ? { symbol: p.symbol, type: "human", name: "You (Challenger)" } : p
    ));

    const branchedState = clientEngine.branchFromMoves(normalizedPlayers, data.moves, currentRuleVariant);
    branchedState.puzzle = {
      id: "custom-puzzle",
      title: data.title || "Community Puzzle",
      objective: "Find the winning continuation from this position"
    };
    userInteractedWithCamera = false;
    autoScaleCamera(true);
    handleStateUpdate(branchedState);
    showArenaToast(`Puzzle Loaded: ${branchedState.puzzle.title}`);
    return branchedState;
  } catch (err) {
    console.warn("Invalid puzzle payload:", err);
    return null;
  }
}

window.encodeReplayPayload = encodeReplayPayload;
window.decodeReplayPayload = decodeReplayPayload;
window.getShareReplayUrl = getShareReplayUrl;
window.shareCurrentReplay = shareCurrentReplay;
window.toggleReplayHints = toggleReplayHints;
window.playFromReplayState = playFromReplayState;
window.copyMovesCoordinateNotation = copyMovesCoordinateNotation;
window.downloadBoardSnapshot = downloadBoardSnapshot;
window.toggleReplayAutoPlay = toggleReplayAutoPlay;
window.stopReplayAutoPlay = stopReplayAutoPlay;
window.cycleReplaySpeed = cycleReplaySpeed;
window.encodePuzzlePayload = encodePuzzlePayload;
window.decodePuzzlePayload = decodePuzzlePayload;
window.getSharePuzzleUrl = getSharePuzzleUrl;
window.shareCurrentStateAsPuzzle = shareCurrentStateAsPuzzle;
window.launchCustomPuzzleFromPayload = launchCustomPuzzleFromPayload;

function exitReplayMode() {
  stopReplayAutoPlay();
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
