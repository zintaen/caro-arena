/**
 * Caro Arena — Camera Pan/Zoom Interpolation, Coordinate Transforms & Pointer/Touch Input
 */
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

