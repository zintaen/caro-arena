/**
 * Caro Arena — Account Auth, Cranes Economy & Cosmetics (`window.CaroAuth`)
 * Zero-build service module extracted from `multiplayer.js`.
 */
(function () {
  "use strict";

  function getClient() {
    return window.CaroMultiplayer && typeof window.CaroMultiplayer.getClient === "function"
      ? window.CaroMultiplayer.getClient()
      : null;
  }

  function syncPlayerNameEverywhere(newName) {
    if (window.CaroMultiplayer) {
      window.CaroMultiplayer.myName = newName;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Simple Account Auth (`window.CaroAuth`) — Display Name, Email, 6-Digit PIN,
  // 5-Attempt Lockout, Cranes Economy, Activity Ledger, Board Themes & Stone Finishes
  // ───────────────────────────────────────────────────────────────────────────
  const AUTH_SESSION_KEY = "caro_arena_auth_session";
  const AUTH_LOCAL_USERS_KEY = "caro_arena_local_users";
  const AUTH_LOCKOUTS_KEY = "caro_arena_auth_lockouts";
  const GUEST_CRANES_KEY = "caro_arena_guest_cranes";
  const BOARD_THEME_KEY = "caro_arena_board_theme";
  const UNLOCKED_THEMES_KEY = "caro_arena_unlocked_themes";
  const STONE_STYLE_KEY = "caro_arena_stone_style";
  const UNLOCKED_STONES_KEY = "caro_arena_unlocked_stones";
  const CRANES_LEDGER_PREFIX = "caro_arena_cranes_ledger";
  const MAX_PIN_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  const BOARD_THEMES_CATALOG = {
    classic: { id: "classic", name: "Classic Kaya", cost: 0, desc: "Warm Kaya wood grain" },
    obsidian: { id: "obsidian", name: "Obsidian Slate", cost: 50, desc: "Dark slate with silver lines" },
    jade: { id: "jade", name: "Jade Pavilion", cost: 75, desc: "Celadon jade with gold lines" },
    cyber: { id: "cyber", name: "Cyber Grid", cost: 100, desc: "Dark grid with cyan lines" }
  };

  const STONE_STYLES_CATALOG = {
    classic: { id: "classic", name: "Glazed Stone", cost: 0, desc: "Polished dome with specular highlight" },
    matte: { id: "matte", name: "Matte Ceramic", cost: 40, desc: "Kiln-fired disc with recessed rim" },
    shell: { id: "shell", name: "Shell & Slate", cost: 60, desc: "Woven grain lines on warm stone" },
    mono: { id: "mono", name: "High-Contrast Rings", cost: 50, desc: "Crisp tournament rings with center pip" }
  };

  let authChangeCallbacks = [];

  function getCranesLedgerStorageKey() {
    const current = getCurrentUser();
    return `${CRANES_LEDGER_PREFIX}_${current?.user_id || "guest"}`;
  }

  function formatLedgerReason(reason) {
    const r = String(reason || "match_reward").trim();
    if (r === "daily_login_bonus") return "Daily check-in bonus";
    if (r === "match_reward" || r === "battle_victory") return "Battle victory reward";
    if (r === "wager_entry" || r.startsWith("wager_entry")) return "Room entry wager";
    if (r === "wager_pot_win" || r.startsWith("wager_pot")) return "Room wager pot won";
    if (r.startsWith("unlock_theme_")) {
      const tid = r.replace("unlock_theme_", "");
      return `Unlocked ${BOARD_THEMES_CATALOG[tid]?.name || tid} board`;
    }
    if (r.startsWith("unlock_stone_")) {
      const sid = r.replace("unlock_stone_", "");
      return `Unlocked ${STONE_STYLES_CATALOG[sid]?.name || sid} stones`;
    }
    return r.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
  }

  function getCranesLedger() {
    try {
      const raw = localStorage.getItem(getCranesLedgerStorageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return [
      {
        id: "led_starter",
        ts: Date.now(),
        delta: 100,
        reason: "starter_grant",
        label: "Starter balance",
        balanceAfter: getCranesBalance()
      }
    ];
  }

  function recordCranesLedger(delta, reason, balanceAfter) {
    try {
      const key = getCranesLedgerStorageKey();
      const raw = localStorage.getItem(key);
      let list = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      }
      if (list.length === 0) {
        list.push({
          id: "led_starter",
          ts: Date.now() - 1000,
          delta: 100,
          reason: "starter_grant",
          label: "Starter balance",
          balanceAfter: Math.max(0, (Number(balanceAfter) || 100) - (Number(delta) || 0))
        });
      }
      list.unshift({
        id: "led_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        ts: Date.now(),
        delta: Number(delta) || 0,
        reason: String(reason || "match_reward"),
        label: formatLedgerReason(reason),
        balanceAfter: Number(balanceAfter) || 0
      });
      if (list.length > 25) list.length = 25;
      localStorage.setItem(key, JSON.stringify(list));
    } catch {}
  }

  async function hashPin(pin) {
    const cleanPin = String(pin || "").trim();
    if (!/^\d{6}$/.test(cleanPin)) {
      throw new Error("PIN must be exactly 6 digits (0-9).");
    }
    const raw = `caro_arena_pin_v1:${cleanPin}`;
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }
    // Deterministic fallback hash if SubtleCrypto unavailable
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "fnv_" + (h >>> 0).toString(16);
  }

  function getLocalUsersMap() {
    try {
      const raw = localStorage.getItem(AUTH_LOCAL_USERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLocalUsersMap(map) {
    try {
      localStorage.setItem(AUTH_LOCAL_USERS_KEY, JSON.stringify(map));
    } catch {}
  }

  function getLockoutsMap() {
    try {
      const raw = localStorage.getItem(AUTH_LOCKOUTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLockoutsMap(map) {
    try {
      localStorage.setItem(AUTH_LOCKOUTS_KEY, JSON.stringify(map));
    } catch {}
  }

  function getLockoutStatus(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return { failedAttempts: 0, lockedUntil: 0, isLocked: false, remainingSec: 0 };
    const map = getLockoutsMap();
    const entry = map[cleanEmail] || { failed_attempts: 0, locked_until: 0 };
    const now = Date.now();
    if (entry.locked_until && now >= entry.locked_until) {
      // Lockout expired — reset counter
      delete map[cleanEmail];
      saveLockoutsMap(map);
      return { failedAttempts: 0, lockedUntil: 0, isLocked: false, remainingSec: 0 };
    }
    const isLocked = Boolean(entry.locked_until && now < entry.locked_until);
    const remainingSec = isLocked ? Math.ceil((entry.locked_until - now) / 1000) : 0;
    return {
      failedAttempts: entry.failed_attempts || 0,
      lockedUntil: entry.locked_until || 0,
      isLocked,
      remainingSec
    };
  }

  function recordFailedPinAttempt(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return;
    const map = getLockoutsMap();
    const prev = map[cleanEmail] || { failed_attempts: 0, locked_until: 0 };
    const now = Date.now();
    const baseAttempts = (prev.locked_until && now >= prev.locked_until) ? 0 : (prev.failed_attempts || 0);
    const nextAttempts = baseAttempts + 1;
    const lockedUntil = nextAttempts >= MAX_PIN_ATTEMPTS ? now + LOCKOUT_DURATION_MS : 0;
    map[cleanEmail] = {
      failed_attempts: nextAttempts,
      locked_until: lockedUntil
    };
    saveLockoutsMap(map);
    return { failedAttempts: nextAttempts, lockedUntil };
  }

  function clearLockoutForEmail(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return;
    const map = getLockoutsMap();
    if (map[cleanEmail]) {
      delete map[cleanEmail];
      saveLockoutsMap(map);
    }
  }

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.user_id ? parsed : null;
    } catch {
      return null;
    }
  }

  function setSessionUser(userObj) {
    try {
      if (userObj) {
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(userObj));
        if (userObj.display_name) {
          syncPlayerNameEverywhere(userObj.display_name);
        }
      } else {
        localStorage.removeItem(AUTH_SESSION_KEY);
      }
    } catch {}
    for (const cb of authChangeCallbacks) {
      try { cb(userObj); } catch {}
    }
  }

  async function register({ displayName, email, pin }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(displayName || "").trim();
    if (!cleanName) throw new Error("Please enter a display name.");
    if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Please enter a valid email address.");
    const pinHash = await hashPin(pin);

    const client = getClient();
    if (client) {
      const { data, error } = await client.rpc("caro_arena_auth_register", {
        p_email: cleanEmail,
        p_display_name: cleanName,
        p_pin_hash: pinHash
      });
      if (!error && data) {
        clearLockoutForEmail(cleanEmail);
        const users = getLocalUsersMap();
        users[cleanEmail] = Object.assign({}, data, { pin_hash: pinHash });
        saveLocalUsersMap(users);
        setSessionUser(data);
        return data;
      }
      if (error && !String(error.message || "").includes("Could not find the function")) {
        throw new Error(error.message || "Registration failed.");
      }
    }

    // Fallback to local storage account registry
    const users = getLocalUsersMap();
    if (users[cleanEmail]) {
      throw new Error("An account with this email already exists. Please sign in.");
    }
    const newUser = {
      user_id: "u_" + Math.random().toString(36).substring(2, 10),
      email: cleanEmail,
      display_name: cleanName,
      cranes: 100,
      updated_at: new Date().toISOString()
    };
    clearLockoutForEmail(cleanEmail);
    users[cleanEmail] = Object.assign({}, newUser, { pin_hash: pinHash });
    saveLocalUsersMap(users);
    setSessionUser(newUser);
    return newUser;
  }

  async function login({ email, pin }) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Please enter a valid email address.");

    // Check client-side 5-attempt lockout before hashing or calling RPC
    const lockStatus = getLockoutStatus(cleanEmail);
    if (lockStatus.isLocked) {
      throw new Error(`Too many failed PIN attempts. Account locked for ${lockStatus.remainingSec}s.`);
    }

    const pinHash = await hashPin(pin);

    const client = getClient();
    if (client) {
      const { data, error } = await client.rpc("caro_arena_auth_login", {
        p_email: cleanEmail,
        p_pin_hash: pinHash
      });
      if (!error && data) {
        clearLockoutForEmail(cleanEmail);
        const users = getLocalUsersMap();
        users[cleanEmail] = Object.assign({}, data, { pin_hash: pinHash });
        saveLocalUsersMap(users);
        setSessionUser(data);
        return data;
      }
      const errMsg = String(error?.message || "");
      const isSchemaOrMissingRpc =
        errMsg.includes("Could not find the function") ||
        errMsg.includes("has no field") ||
        errMsg.includes("does not exist");
      if (error && !isSchemaOrMissingRpc) {
        const lockAfter = recordFailedPinAttempt(cleanEmail);
        if (lockAfter && lockAfter.lockedUntil) {
          throw new Error("Too many failed PIN attempts (5/5). Account locked for 5 minutes.");
        }
        throw new Error(error.message || `Invalid email or 6-digit PIN (${MAX_PIN_ATTEMPTS - (lockAfter?.failedAttempts || 1)} attempts left).`);
      }
    }

    const users = getLocalUsersMap();
    const record = users[cleanEmail];
    if (!record || record.pin_hash !== pinHash) {
      const lockAfter = recordFailedPinAttempt(cleanEmail);
      if (lockAfter && lockAfter.lockedUntil) {
        throw new Error("Too many failed PIN attempts (5/5). Account locked for 5 minutes.");
      }
      throw new Error(`Invalid email or 6-digit PIN (${MAX_PIN_ATTEMPTS - (lockAfter?.failedAttempts || 1)} attempts left).`);
    }
    clearLockoutForEmail(cleanEmail);
    const sessionUser = {
      user_id: record.user_id,
      email: record.email,
      display_name: record.display_name,
      cranes: record.cranes ?? 100,
      updated_at: record.updated_at
    };
    setSessionUser(sessionUser);
    return sessionUser;
  }

  async function updateProfile({ displayName, email, currentPin, newPin }) {
    const current = getCurrentUser();
    if (!current) throw new Error("You must be signed in to update your profile.");
    const cleanEmail = String(email || current.email || "").trim().toLowerCase();
    const cleanName = String(displayName || current.display_name || "").trim();
    if (!cleanName) throw new Error("Display name cannot be empty.");
    if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Please enter a valid email address.");

    const currentPinHash = await hashPin(currentPin);
    const newPinHash = (newPin && String(newPin).trim() !== "") ? await hashPin(newPin) : null;

    const client = getClient();
    if (client) {
      const { data, error } = await client.rpc("caro_arena_auth_update", {
        p_user_id: current.user_id,
        p_current_pin_hash: currentPinHash,
        p_new_email: cleanEmail,
        p_new_display_name: cleanName,
        p_new_pin_hash: newPinHash
      });
      if (!error && data) {
        const users = getLocalUsersMap();
        if (current.email && current.email !== cleanEmail) {
          delete users[current.email];
        }
        users[cleanEmail] = Object.assign({}, data, { pin_hash: newPinHash || currentPinHash });
        saveLocalUsersMap(users);
        setSessionUser(data);
        return data;
      }
      if (error && !String(error.message || "").includes("Could not find the function")) {
        throw new Error(error.message || "Failed to update profile.");
      }
    }

    const users = getLocalUsersMap();
    const existing = users[current.email] || Object.values(users).find(u => u.user_id === current.user_id);
    if (!existing || existing.pin_hash !== currentPinHash) {
      throw new Error("Current 6-digit PIN is incorrect.");
    }
    if (cleanEmail !== current.email && users[cleanEmail]) {
      throw new Error("That email is already used by another account.");
    }
    if (current.email && cleanEmail !== current.email) {
      delete users[current.email];
    }
    const updatedUser = {
      user_id: current.user_id,
      email: cleanEmail,
      display_name: cleanName,
      cranes: existing.cranes ?? current.cranes ?? 100,
      updated_at: new Date().toISOString()
    };
    users[cleanEmail] = Object.assign({}, updatedUser, { pin_hash: newPinHash || currentPinHash });
    saveLocalUsersMap(users);
    setSessionUser(updatedUser);
    return updatedUser;
  }

  function getCranesBalance() {
    const current = getCurrentUser();
    if (current && typeof current.cranes === "number") {
      return current.cranes;
    }
    try {
      const guestVal = localStorage.getItem(GUEST_CRANES_KEY);
      return guestVal !== null ? Math.max(0, Number(guestVal) || 0) : 100;
    } catch {
      return 100;
    }
  }

  async function adjustCranes(delta, reason = "match_reward") {
    const numDelta = Math.round(Number(delta) || 0);
    if (numDelta === 0) return getCranesBalance();

    const current = getCurrentUser();
    if (current) {
      const nextCranes = Math.max(0, (Number(current.cranes) || 0) + numDelta);
      const updatedUser = Object.assign({}, current, {
        cranes: nextCranes,
        updated_at: new Date().toISOString()
      });

      const users = getLocalUsersMap();
      if (current.email && users[current.email]) {
        users[current.email].cranes = nextCranes;
        users[current.email].updated_at = updatedUser.updated_at;
        saveLocalUsersMap(users);
      }
      recordCranesLedger(numDelta, reason, nextCranes);
      setSessionUser(updatedUser);

      // Sync to Supabase RPC if deployed
      const client = getClient();
      if (client) {
        try {
          const { data, error } = await client.rpc("caro_arena_adjust_cranes", {
            p_user_id: current.user_id,
            p_delta: numDelta,
            p_reason: String(reason || "match_reward")
          });
          if (!error && data && typeof data.cranes === "number") {
            updatedUser.cranes = data.cranes;
            if (current.email && users[current.email]) {
              users[current.email].cranes = data.cranes;
              saveLocalUsersMap(users);
            }
            setSessionUser(updatedUser);
          }
        } catch {}
      }
      return updatedUser.cranes;
    }

    // Guest wallet fallback
    const curGuest = getCranesBalance();
    const nextGuest = Math.max(0, curGuest + numDelta);
    try {
      localStorage.setItem(GUEST_CRANES_KEY, String(nextGuest));
    } catch {}
    recordCranesLedger(numDelta, reason, nextGuest);
    for (const cb of authChangeCallbacks) {
      try { cb(null); } catch {}
    }
    return nextGuest;
  }

  function getDailyBonusStorageKey() {
    const current = getCurrentUser();
    return `caro_arena_daily_bonus_${current?.user_id || "guest"}`;
  }

  function canClaimDailyBonus() {
    try {
      const lastRaw = localStorage.getItem(getDailyBonusStorageKey());
      const lastTs = Number(lastRaw) || 0;
      const cooldownMs = 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - lastTs;
      if (!lastTs || elapsed >= cooldownMs) {
        return { canClaim: true, nextClaimInMs: 0 };
      }
      return { canClaim: false, nextClaimInMs: cooldownMs - elapsed };
    } catch {
      return { canClaim: true, nextClaimInMs: 0 };
    }
  }

  async function claimDailyBonus() {
    const check = canClaimDailyBonus();
    if (!check.canClaim) {
      const hrs = Math.ceil(check.nextClaimInMs / (60 * 60 * 1000));
      throw new Error(`Daily bonus already claimed! Next bonus in ~${hrs}h.`);
    }
    try {
      localStorage.setItem(getDailyBonusStorageKey(), String(Date.now()));
    } catch {}
    const newBalance = await adjustCranes(25, "daily_login_bonus");
    return { bonus: 25, cranes: newBalance };
  }

  function getUnlockedThemes() {
    try {
      const current = getCurrentUser();
      const key = `${UNLOCKED_THEMES_KEY}_${current?.user_id || "guest"}`;
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : ["classic"];
      if (!Array.isArray(parsed)) return ["classic"];
      if (!parsed.includes("classic")) parsed.unshift("classic");
      return parsed;
    } catch {
      return ["classic"];
    }
  }

  function isThemeUnlocked(themeId) {
    if (!themeId || themeId === "classic") return true;
    return getUnlockedThemes().includes(themeId);
  }

  function getSelectedTheme() {
    try {
      const saved = localStorage.getItem(BOARD_THEME_KEY) || "classic";
      return BOARD_THEMES_CATALOG[saved] && isThemeUnlocked(saved) ? saved : "classic";
    } catch {
      return "classic";
    }
  }

  function setSelectedTheme(themeId) {
    if (!BOARD_THEMES_CATALOG[themeId]) return "classic";
    if (!isThemeUnlocked(themeId)) return getSelectedTheme();
    try {
      localStorage.setItem(BOARD_THEME_KEY, themeId);
    } catch {}
    return themeId;
  }

  async function unlockTheme(themeId) {
    const entry = BOARD_THEMES_CATALOG[themeId];
    if (!entry) throw new Error("Unknown board theme.");
    if (isThemeUnlocked(themeId)) {
      setSelectedTheme(themeId);
      return { unlocked: true, themeId, cranes: getCranesBalance() };
    }
    const balance = getCranesBalance();
    if (balance < entry.cost) {
      throw new Error(`Need ${entry.cost} Cranes to unlock ${entry.name} (you have ${balance}).`);
    }
    const newBalance = await adjustCranes(-entry.cost, `unlock_theme_${themeId}`);
    try {
      const current = getCurrentUser();
      const key = `${UNLOCKED_THEMES_KEY}_${current?.user_id || "guest"}`;
      const unlocked = getUnlockedThemes();
      if (!unlocked.includes(themeId)) unlocked.push(themeId);
      localStorage.setItem(key, JSON.stringify(unlocked));
    } catch {}
    setSelectedTheme(themeId);
    return { unlocked: true, themeId, cranes: newBalance };
  }

  function getUnlockedStoneStyles() {
    try {
      const current = getCurrentUser();
      const key = `${UNLOCKED_STONES_KEY}_${current?.user_id || "guest"}`;
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : ["classic"];
      if (!Array.isArray(parsed)) return ["classic"];
      if (!parsed.includes("classic")) parsed.unshift("classic");
      return parsed;
    } catch {
      return ["classic"];
    }
  }

  function isStoneStyleUnlocked(styleId) {
    if (!styleId || styleId === "classic") return true;
    return getUnlockedStoneStyles().includes(styleId);
  }

  function getSelectedStoneStyle() {
    try {
      const saved = localStorage.getItem(STONE_STYLE_KEY) || "classic";
      return STONE_STYLES_CATALOG[saved] && isStoneStyleUnlocked(saved) ? saved : "classic";
    } catch {
      return "classic";
    }
  }

  function setSelectedStoneStyle(styleId) {
    if (!STONE_STYLES_CATALOG[styleId]) return "classic";
    if (!isStoneStyleUnlocked(styleId)) return getSelectedStoneStyle();
    try {
      localStorage.setItem(STONE_STYLE_KEY, styleId);
    } catch {}
    return styleId;
  }

  async function unlockStoneStyle(styleId) {
    const entry = STONE_STYLES_CATALOG[styleId];
    if (!entry) throw new Error("Unknown stone finish.");
    if (isStoneStyleUnlocked(styleId)) {
      setSelectedStoneStyle(styleId);
      return { unlocked: true, styleId, cranes: getCranesBalance() };
    }
    const balance = getCranesBalance();
    if (balance < entry.cost) {
      throw new Error(`Need ${entry.cost} Cranes to unlock ${entry.name} (you have ${balance}).`);
    }
    const newBalance = await adjustCranes(-entry.cost, `unlock_stone_${styleId}`);
    try {
      const current = getCurrentUser();
      const key = `${UNLOCKED_STONES_KEY}_${current?.user_id || "guest"}`;
      const unlocked = getUnlockedStoneStyles();
      if (!unlocked.includes(styleId)) unlocked.push(styleId);
      localStorage.setItem(key, JSON.stringify(unlocked));
    } catch {}
    setSelectedStoneStyle(styleId);
    return { unlocked: true, styleId, cranes: newBalance };
  }

  function logout() {
    setSessionUser(null);
  }

  function onAuthChange(cb) {
    if (typeof cb === "function") authChangeCallbacks.push(cb);
  }

  window.CaroAuth = {
    getCurrentUser,
    isLoggedIn: () => Boolean(getCurrentUser()),
    register,
    login,
    updateProfile,
    logout,
    onAuthChange,
    hashPin,
    getLockoutStatus,
    clearLockoutForEmail,
    getCranesBalance,
    adjustCranes,
    getCranesLedger,
    canClaimDailyBonus,
    claimDailyBonus,
    BOARD_THEMES_CATALOG,
    getUnlockedThemes,
    isThemeUnlocked,
    getSelectedTheme,
    setSelectedTheme,
    unlockTheme,
    STONE_STYLES_CATALOG,
    getUnlockedStoneStyles,
    isStoneStyleUnlocked,
    getSelectedStoneStyle,
    setSelectedStoneStyle,
    unlockStoneStyle
  };

})();
