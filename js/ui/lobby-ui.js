/**
 * Caro Arena — Lobby Home Screen, Cosmetics Storefront, Daily Puzzle & Career Card
 */
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
window.launchDailyPuzzle = launchDailyPuzzle;
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
