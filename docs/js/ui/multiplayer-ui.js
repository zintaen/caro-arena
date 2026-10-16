/**
 * Caro Arena — Multiplayer Room Modal, HUD, Active Rooms Browser, Emotes & Rematch UI
 */
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
