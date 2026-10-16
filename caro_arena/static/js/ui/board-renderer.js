/**
 * Caro Arena — Canvas 2D Board, Minimap, Heatmap, Laser & Particle Renderer
 */
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
