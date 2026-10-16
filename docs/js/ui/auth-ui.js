/**
 * Caro Arena — Account Sign-In/Create/Profile Modal & Cranes Activity Ledger UI
 */
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



