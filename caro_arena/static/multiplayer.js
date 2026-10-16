/**
 * Caro Arena — Supabase Realtime Multiplayer, Lobby, Spectator & Simple PIN Auth Engine
 * - Locked to hosted Supabase project (`window.CARO_SUPABASE_URL` / `window.CARO_SUPABASE_KEY`)
 * - Global Active Rooms Lobby (`caro_arena_lobby`) with automatic empty-room cleanup
 * - Custom Room Name, Custom URL Slug (`?room=slug`), Public/Private visibility, Dynamic 2–4 Player Slots
 * - Spectator-first entry, Host-approved "Request to Join" & Mid-battle "Request Takeover"
 * - Simple Account Auth (`window.CaroAuth`) with Display Name, Email, 6-Digit PIN, and 🦢 Cranes balance
 */

(function () {
  let supabaseClient = null;
  let currentChannel = null;
  let lobbyChannel = null;

  let currentRoomId = null;
  let currentRoomName = "";
  let isRoomPublic = true;
  let myPlayerId = null;
  let myPlayerName = "Player";
  let isRoomHost = false;
  let hostPlayerId = null;
  let myAssignedSlot = -1; // -1 = spectator, 0..3 = player slot
  let myRole = "spectator"; // "host" | "player" | "spectator"
  let turnTimeoutSec = 30;
  let currentBattleNumber = 1;
  let currentEntryFee = 0;
  let roomJoinedAt = 0;
  let sessionScores = {}; // { [symbol]: { symbol, name, wins } }
  let lastScoredBattleNumber = 0;
  let roomActivityLog = []; // [{ id, ts, timeLabel, text, kind }]

  function normalizeTurnTimeoutSec(v) {
    if (v === 0 || v === "0" || v === false) return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 30;
  }

  const AI_MODELS = ["von", "mojev", "laya", "jev"];
  const AI_NAMES = {
    von: "Von (AI)",
    mojev: "MoJev (AI)",
    laya: "Laya (AI)",
    jev: "Jev (AI)"
  };

  // Dynamic room slots (2 to 4 players)
  let roomSlots = [
    { type: "human", name: "Host", id: null, ready: true },
    { type: "human", name: "Open human slot", id: null, ready: false },
    { type: "ai", model: "von", name: "Von (AI)", id: null, ready: true }
  ];
  let spectators = []; // [{ id, name, joinedAt }]
  let pendingRequests = []; // [{ requestId, kind: 'join'|'takeover', fromId, fromName, slotIndex, targetSymbol, createdAt }]
  let myPendingRequest = null;
  let lastRejectedAt = 0;
  let inGame = false;

  // Active rooms discovered on `caro_arena_lobby`
  const activeRoomsMap = new Map();
  const knownPeers = new Map();

  // Callbacks
  let onLobbyChangeCallback = null;
  let onActiveRoomsChangeCallback = null;
  let onGameStartCallback = null;
  let onRemoteMoveCallback = null;
  let onRemoteNextBattleCallback = null;
  let onRoomLeaveCallback = null;
  let onStatusMessageCallback = null;
  let onStateSyncCallback = null;
  let onHostMigratedCallback = null;
  let onRequestsChangeCallback = null;
  let onSlotTakeoverCallback = null;
  let onEmoteCallback = null;
  let onActivityLogChangeCallback = null;
  let getHostStateCallback = null;

  function pushActivityLog(text, kind = "info") {
    const clean = String(text || "").trim();
    if (!clean) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const entry = {
      id: "act_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      ts: Date.now(),
      timeLabel: `${hh}:${mm}:${ss}`,
      text: clean,
      kind
    };
    roomActivityLog.unshift(entry);
    if (roomActivityLog.length > 30) {
      roomActivityLog.length = 30;
    }
    if (onActivityLogChangeCallback) {
      try { onActivityLogChangeCallback(roomActivityLog.slice()); } catch {}
    }
  }

  function recordSessionWin(symbol, playerName, battleNum = null) {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return getSessionScores();
    const bNum = battleNum || currentBattleNumber || 1;
    if (lastScoredBattleNumber === bNum) return getSessionScores();
    lastScoredBattleNumber = bNum;
    const prev = sessionScores[sym] || { symbol: sym, name: playerName || sym, wins: 0 };
    sessionScores[sym] = {
      symbol: sym,
      name: playerName || prev.name || sym,
      wins: (prev.wins || 0) + 1
    };
    pushActivityLog(`${playerName || sym} (${sym}) won Battle #${bNum}.`, "victory");
    if (isRoomHost && currentChannel) {
      try {
        currentChannel.send({
          type: "broadcast",
          event: "session_score_update",
          payload: {
            sessionScores,
            battleNumber: bNum,
            winnerSymbol: sym,
            winnerName: playerName || prev.name || sym
          }
        });
      } catch {}
    }
    if (onLobbyChangeCallback) {
      try { onLobbyChangeCallback(getLobbyState()); } catch {}
    }
    return getSessionScores();
  }

  function getSessionScores() {
    const copy = {};
    for (const k of Object.keys(sessionScores)) {
      copy[k] = Object.assign({}, sessionScores[k]);
    }
    return copy;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Hosted Supabase Client Initialization (No Manual Setup UI Required)
  // ───────────────────────────────────────────────────────────────────────────
  function getSavedCredentials() {
    try {
      const url = window.CARO_SUPABASE_URL || localStorage.getItem("caro_supabase_url") || "";
      const key = window.CARO_SUPABASE_KEY || localStorage.getItem("caro_supabase_key") || "";
      return { url: String(url).trim(), key: String(key).trim() };
    } catch {
      return { url: "", key: "" };
    }
  }

  function isConfigured() {
    const creds = getSavedCredentials();
    return Boolean(creds.url && creds.key);
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    const creds = getSavedCredentials();
    if (!creds.url || !creds.key) return null;
    if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
      return null;
    }
    supabaseClient = window.supabase.createClient(creds.url, creds.key, {
      realtime: {
        params: {
          eventsPerSecond: 20
        }
      }
    });
    return supabaseClient;
  }

  function generateRoomCode() {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function sanitizeRoomSlug(raw) {
    if (!raw) return "";
    return String(raw)
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 24);
  }

  function normalizeRoomIdentifier(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return "";
    // If it contains hyphens or lowercase slug format > 6 chars, preserve lowercase slug; otherwise uppercase code
    if (trimmed.includes("-") || trimmed.length > 6) {
      return sanitizeRoomSlug(trimmed);
    }
    return trimmed.replace(/[^a-zA-Z0-9-]/g, "").toUpperCase().substring(0, 24);
  }

  function generatePlayerId() {
    return "p_" + Math.random().toString(36).substring(2, 9);
  }

  function updateBrowserUrlRoom(roomId) {
    try {
      if (typeof window === "undefined" || !window.history || !window.history.replaceState) return;
      const url = new URL(window.location.href);
      if (roomId) {
        url.searchParams.set("room", roomId);
      } else {
        url.searchParams.delete("room");
      }
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
  }

  /**
   * Fallback Realtime Adapter using BroadcastChannel API
   * Enables immediate multi-tab synchronization even when offline
   */
  class LocalBroadcastChannelAdapter {
    constructor(channelName, myId) {
      this.name = channelName;
      this.myPlayerId = myId;
      this.bc = new BroadcastChannel(`caro_bc_${channelName}`);
      this.presenceMap = new Map();
      this.listeners = {
        presence: {},
        broadcast: {}
      };
      this.myPresence = null;

      this.bc.onmessage = (event) => {
        const data = event.data;
        if (!data) return;

        if (data.type === "bc_track") {
          const { key, presence } = data;
          const isNew = !this.presenceMap.has(key);
          this.presenceMap.set(key, [presence]);
          if (this.listeners.presence["sync"]) {
            this.listeners.presence["sync"]();
          }
          if (isNew && this.listeners.presence["join"]) {
            this.listeners.presence["join"]({ key, newPresences: [presence] });
          }
        } else if (data.type === "bc_untrack") {
          const { key } = data;
          const left = this.presenceMap.get(key) || [];
          this.presenceMap.delete(key);
          if (this.listeners.presence["leave"]) {
            this.listeners.presence["leave"]({ key, leftPresences: left });
          }
          if (this.listeners.presence["sync"]) {
            this.listeners.presence["sync"]();
          }
        } else if (data.type === "bc_request_presence") {
          if (this.myPresence) {
            this.bc.postMessage({
              type: "bc_track",
              key: this.myPlayerId,
              presence: this.myPresence
            });
          }
        } else if (data.type === "bc_broadcast") {
          const cb = this.listeners.broadcast[data.event];
          if (cb) cb({ payload: data.payload });
        }
      };
    }

    on(type, filter, callback) {
      if (type === "presence") {
        this.listeners.presence[filter.event] = callback;
      } else if (type === "broadcast") {
        this.listeners.broadcast[filter.event] = callback;
      }
      return this;
    }

    async subscribe(callback) {
      this.bc.postMessage({ type: "bc_request_presence" });
      if (callback) {
        setTimeout(() => callback("SUBSCRIBED"), 5);
      }
      return this;
    }

    async track(presenceObj) {
      this.myPresence = presenceObj;
      this.presenceMap.set(this.myPlayerId, [presenceObj]);
      this.bc.postMessage({
        type: "bc_track",
        key: this.myPlayerId,
        presence: presenceObj
      });
      if (this.listeners.presence["sync"]) {
        this.listeners.presence["sync"]();
      }
    }

    async untrack() {
      this.myPresence = null;
      this.presenceMap.delete(this.myPlayerId);
      this.bc.postMessage({
        type: "bc_untrack",
        key: this.myPlayerId
      });
    }

    presenceState() {
      const res = {};
      for (const [k, v] of this.presenceMap.entries()) {
        res[k] = v;
      }
      return res;
    }

    send({ type, event, payload }) {
      if (type === "broadcast") {
        this.bc.postMessage({
          type: "bc_broadcast",
          event,
          payload
        });
      }
    }

    unsubscribe() {
      try {
        this.bc.postMessage({
          type: "bc_untrack",
          key: this.myPlayerId
        });
        this.bc.close();
      } catch {}
      this.presenceMap.clear();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Global Active Rooms Lobby (`caro_arena_lobby`)
  // ───────────────────────────────────────────────────────────────────────────
  function buildMyRoomSummary() {
    if (!isRoomHost || !currentRoomId) return null;
    const activeSlots = roomSlots.filter(s => s.type === "human" || s.type === "ai");
    const openHuman = activeSlots.filter(s => s.type === "human" && !s.id).length;
    const filledCount = activeSlots.filter(s => s.type === "ai" || (s.type === "human" && Boolean(s.id))).length;
    return {
      roomId: currentRoomId,
      roomName: currentRoomName || `${myPlayerName}'s Room`,
      hostId: myPlayerId,
      hostName: myPlayerName,
      isPublic: Boolean(isRoomPublic),
      entryFee: currentEntryFee || 0,
      turnTimeoutSec,
      status: inGame ? "playing" : "waiting",
      battleNumber: currentBattleNumber || 1,
      playerCount: filledCount,
      maxPlayers: activeSlots.length,
      openHumanSlots: openHuman,
      spectatorCount: spectators.length,
      updatedAt: Date.now()
    };
  }

  function syncActiveRoomsFromLobbyPresence() {
    if (!lobbyChannel || typeof lobbyChannel.presenceState !== "function") return;
    const state = lobbyChannel.presenceState();
    const seenRoomIds = new Set();

    for (const key in state) {
      const list = state[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && item.room && item.room.roomId) {
          const r = item.room;
          seenRoomIds.add(r.roomId);
          if (r.isPublic !== false) {
            activeRoomsMap.set(r.roomId, Object.assign({}, r, { updatedAt: Date.now() }));
          } else {
            activeRoomsMap.delete(r.roomId);
          }
        }
      }
    }

    // Remove any rooms whose host presence disappeared
    for (const [rid, info] of activeRoomsMap.entries()) {
      if (!seenRoomIds.has(rid) && Date.now() - (info.updatedAt || 0) > 15000) {
        activeRoomsMap.delete(rid);
      }
    }

    if (onActiveRoomsChangeCallback) {
      onActiveRoomsChangeCallback(getActiveRooms());
    }
  }

  let lobbySubscribedPromise = null;
  let isLobbySubscribing = false;

  async function ensureGlobalLobbySubscribed() {
    const client = getClient();
    if (lobbyChannel && lobbySubscribedPromise) {
      if (isLobbySubscribing) {
        return await lobbySubscribedPromise;
      }
      if (!client || !lobbyChannel.state || lobbyChannel.state === "joined" || lobbyChannel.state === "joining") {
        return lobbyChannel;
      }
      // Channel became closed/errored after initial subscription — clean up and recreate
      try {
        if (client && typeof client.removeChannel === "function") {
          await client.removeChannel(lobbyChannel);
        } else {
          lobbyChannel.unsubscribe();
        }
      } catch {}
      lobbyChannel = null;
      lobbySubscribedPromise = null;
    }
    const channelName = "caro_arena_lobby";

    if (client) {
      lobbyChannel = client.channel(channelName, {
        config: {
          broadcast: { self: false },
          presence: { key: myPlayerId }
        }
      });
    } else {
      lobbyChannel = new LocalBroadcastChannelAdapter(channelName, myPlayerId);
    }

    lobbyChannel.on("presence", { event: "sync" }, () => {
      syncActiveRoomsFromLobbyPresence();
    });

    lobbyChannel.on("presence", { event: "join" }, () => {
      syncActiveRoomsFromLobbyPresence();
    });

    lobbyChannel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      if (Array.isArray(leftPresences)) {
        for (const p of leftPresences) {
          if (p?.room?.roomId) {
            activeRoomsMap.delete(p.room.roomId);
          }
        }
      }
      for (const [rid, info] of activeRoomsMap.entries()) {
        if (info.hostId === key) {
          activeRoomsMap.delete(rid);
        }
      }
      syncActiveRoomsFromLobbyPresence();
    });

    lobbyChannel.on("broadcast", { event: "lobby_room_announce" }, ({ payload }) => {
      if (!payload || !payload.roomId) return;
      if (payload.isPublic === false) {
        activeRoomsMap.delete(payload.roomId);
      } else {
        activeRoomsMap.set(payload.roomId, Object.assign({}, payload, { updatedAt: Date.now() }));
      }
      if (onActiveRoomsChangeCallback) {
        onActiveRoomsChangeCallback(getActiveRooms());
      }
    });

    lobbyChannel.on("broadcast", { event: "lobby_room_closed" }, ({ payload }) => {
      if (payload?.roomId) {
        activeRoomsMap.delete(payload.roomId);
        if (onActiveRoomsChangeCallback) {
          onActiveRoomsChangeCallback(getActiveRooms());
        }
      }
    });

    lobbyChannel.on("broadcast", { event: "request_active_rooms" }, () => {
      if (isRoomHost && currentRoomId && lobbyChannel) {
        const latest = buildMyRoomSummary();
        if (latest) {
          try {
            lobbyChannel.send({
              type: "broadcast",
              event: "lobby_room_announce",
              payload: latest
            });
          } catch {}
        }
      }
    });

    isLobbySubscribing = true;
    lobbySubscribedPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          isLobbySubscribing = false;
          resolve(lobbyChannel);
        }
      };
      const timer = setTimeout(finish, 4000);
      lobbyChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          finish();
          publishRoomToGlobalLobby();
          try {
            lobbyChannel.send({
              type: "broadcast",
              event: "request_active_rooms",
              payload: { from: myPlayerId }
            });
          } catch {}
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          lobbyChannel = null;
          lobbySubscribedPromise = null;
          isLobbySubscribing = false;
          finish();
          if (isRoomHost && currentRoomId) {
            setTimeout(() => {
              publishRoomToGlobalLobby().catch(() => {});
            }, 300);
          }
        }
      });
    });

    await lobbySubscribedPromise;
    return lobbyChannel;
  }

  let lobbyTrackTimer = null;
  let lobbyAnnounceTimer = null;
  let isLobbyTrackInFlight = false;
  let pendingLobbyTrack = false;

  async function executeSerializedLobbyTrack() {
    if (isLobbyTrackInFlight) {
      pendingLobbyTrack = true;
      return;
    }
    if (!lobbyChannel || typeof lobbyChannel.track !== "function") return;
    isLobbyTrackInFlight = true;
    pendingLobbyTrack = false;
    try {
      const cur = buildMyRoomSummary();
      await lobbyChannel.track({
        id: myPlayerId,
        name: myPlayerName,
        room: cur,
        updatedAt: Date.now()
      });
    } catch {}
    isLobbyTrackInFlight = false;
    if (pendingLobbyTrack) {
      pendingLobbyTrack = false;
      if (lobbyTrackTimer) clearTimeout(lobbyTrackTimer);
      lobbyTrackTimer = setTimeout(executeSerializedLobbyTrack, 400);
    }
  }

  async function publishRoomToGlobalLobby(immediateBroadcast = false) {
    try {
      const summary = buildMyRoomSummary();
      if (summary) {
        if (summary.isPublic) {
          activeRoomsMap.set(summary.roomId, summary);
        } else {
          activeRoomsMap.delete(summary.roomId);
        }
      }
      if (onActiveRoomsChangeCallback) {
        onActiveRoomsChangeCallback(getActiveRooms());
      }

      await ensureGlobalLobbySubscribed();
      if (!lobbyChannel) return;

      const sendAnnounce = () => {
        const latest = buildMyRoomSummary();
        if (latest && lobbyChannel) {
          try {
            lobbyChannel.send({
              type: "broadcast",
              event: "lobby_room_announce",
              payload: latest
            });
          } catch {}
        }
      };

      if (immediateBroadcast) {
        if (lobbyAnnounceTimer) {
          clearTimeout(lobbyAnnounceTimer);
          lobbyAnnounceTimer = null;
        }
        sendAnnounce();
      } else {
        if (lobbyAnnounceTimer) clearTimeout(lobbyAnnounceTimer);
        lobbyAnnounceTimer = setTimeout(sendAnnounce, 120);
      }

      if (lobbyTrackTimer) clearTimeout(lobbyTrackTimer);
      lobbyTrackTimer = setTimeout(executeSerializedLobbyTrack, 250);
    } catch {}
  }

  function unpublishRoomFromGlobalLobby(roomId) {
    if (!roomId) return;
    activeRoomsMap.delete(roomId);
    try {
      if (lobbyChannel) {
        lobbyChannel.send({
          type: "broadcast",
          event: "lobby_room_closed",
          payload: { roomId, hostId: myPlayerId }
        });
        if (typeof lobbyChannel.track === "function") {
          lobbyChannel.track({
            id: myPlayerId,
            name: myPlayerName,
            room: null,
            updatedAt: Date.now()
          }).catch(() => {});
        }
      }
    } catch {}
    if (onActiveRoomsChangeCallback) {
      onActiveRoomsChangeCallback(getActiveRooms());
    }
  }

  function refreshActiveRooms() {
    ensureGlobalLobbySubscribed().then(() => {
      syncActiveRoomsFromLobbyPresence();
      if (lobbyChannel) {
        lobbyChannel.send({
          type: "broadcast",
          event: "request_active_rooms",
          payload: { from: myPlayerId }
        });
      }
    }).catch(() => {});
    return getActiveRooms();
  }

  function getActiveRooms() {
    const now = Date.now();
    const list = [];
    for (const [rid, info] of activeRoomsMap.entries()) {
      if (info.isPublic === false) continue;
      if (now - (info.updatedAt || 0) > 120000) continue;
      list.push(info);
    }
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Room Lifecycle: Create, Join (Spectator-First), Requests, Takeover & Auto-Close
  // ───────────────────────────────────────────────────────────────────────────
  function init() {
    try {
      myPlayerId = sessionStorage.getItem("caro_player_id");
      if (!myPlayerId) {
        myPlayerId = generatePlayerId();
        sessionStorage.setItem("caro_player_id", myPlayerId);
      }
      // Prefer logged-in user's display name if available
      const authRaw = localStorage.getItem("caro_arena_auth_session");
      if (authRaw) {
        const parsed = JSON.parse(authRaw);
        if (parsed && parsed.display_name) {
          myPlayerName = parsed.display_name;
        }
      }
      if (!myPlayerName || myPlayerName === "Player") {
        myPlayerName =
          sessionStorage.getItem("caro_player_name") ||
          localStorage.getItem("caro_player_name") ||
          "Player " + myPlayerId.substring(2, 6).toUpperCase();
      }
    } catch {
      myPlayerId = generatePlayerId();
      myPlayerName = "Player " + myPlayerId.substring(2, 6).toUpperCase();
    }
    setTimeout(() => {
      ensureGlobalLobbySubscribed().catch(() => {});
    }, 50);
  }

  async function createRoom(hostName, optionsOrSlots = null) {
    const preconfiguredSlots = (!currentRoomId && Array.isArray(roomSlots) && roomSlots.length >= 2)
      ? roomSlots.map(s => Object.assign({}, s))
      : null;
    leaveRoom(false);
    if (hostName && String(hostName).trim()) {
      myPlayerName = String(hostName).trim();
    }
    try {
      sessionStorage.setItem("caro_player_name", myPlayerName);
      localStorage.setItem("caro_player_name", myPlayerName);
    } catch {}

    let opts = {};
    if (Array.isArray(optionsOrSlots)) {
      opts = { initialSlots: optionsOrSlots };
    } else if (optionsOrSlots && typeof optionsOrSlots === "object") {
      opts = optionsOrSlots;
    }

    let customSlug = opts.roomSlug ? sanitizeRoomSlug(opts.roomSlug) : "";
    if (opts.roomSlug && customSlug.length < 2) {
      throw new Error("Custom URL slug must be at least 2 alphanumeric characters.");
    }
    if (customSlug) {
      // Check for active slug collision in lobby
      const existing = activeRoomsMap.get(customSlug) || activeRoomsMap.get(customSlug.toUpperCase());
      if (existing && existing.hostId && existing.hostId !== myPlayerId) {
        throw new Error(`Room URL "${customSlug}" is already active. Please choose another URL slug.`);
      }
      currentRoomId = customSlug;
    } else {
      currentRoomId = generateRoomCode();
    }

    currentRoomName = (opts.roomName || "").trim() || `${myPlayerName}'s Arena`;
    isRoomPublic = opts.isPublic !== undefined ? Boolean(opts.isPublic) : true;
    currentEntryFee = Math.max(0, Number(opts.entryFee) || 0);
    if (opts.turnTimeoutSec !== undefined) {
      turnTimeoutSec = normalizeTurnTimeoutSec(opts.turnTimeoutSec);
    }
    roomJoinedAt = Date.now();
    isRoomHost = true;
    hostPlayerId = myPlayerId;
    myAssignedSlot = 0;
    myRole = "host";
    currentBattleNumber = 1;
    sessionScores = {};
    lastScoredBattleNumber = 0;
    roomActivityLog = [];
    knownPeers.clear();
    spectators = [];
    pendingRequests = [];
    myPendingRequest = null;

    pushActivityLog(`Room "${currentRoomName}" opened (${currentRoomId}).`, "room");

    try {
      sessionStorage.setItem("caro_active_room", currentRoomId);
    } catch {}
    updateBrowserUrlRoom(currentRoomId);

    const chosenInitialSlots = Array.isArray(opts.initialSlots) && opts.initialSlots.length >= 2
      ? opts.initialSlots
      : preconfiguredSlots;

    if (Array.isArray(chosenInitialSlots) && chosenInitialSlots.length >= 2) {
      roomSlots = chosenInitialSlots
        .filter(s => s && s.type !== "closed")
        .slice(0, 4)
        .map((s, idx) => idx === 0
          ? { type: "human", name: myPlayerName, id: myPlayerId, ready: true }
          : Object.assign({}, s));
    } else {
      roomSlots = [
        { type: "human", name: myPlayerName, id: myPlayerId, ready: true },
        { type: "human", name: "Open human slot", id: null, ready: false },
        { type: "ai", model: "von", name: "Von (AI)", id: null, ready: true }
      ];
    }

    await ensureGlobalLobbySubscribed();
    await subscribeToRoom(currentRoomId);
    await publishRoomToGlobalLobby();
    return currentRoomId;
  }

  async function joinRoom(roomId, playerName, options = {}) {
    leaveRoom(false);
    currentRoomId = normalizeRoomIdentifier(roomId);
    if (!currentRoomId) throw new Error("Please enter a valid room code or URL slug.");

    if (playerName && String(playerName).trim()) {
      myPlayerName = String(playerName).trim();
    }
    try {
      sessionStorage.setItem("caro_player_name", myPlayerName);
      localStorage.setItem("caro_player_name", myPlayerName);
      sessionStorage.setItem("caro_active_room", currentRoomId);
    } catch {}
    updateBrowserUrlRoom(currentRoomId);

    isRoomHost = false;
    roomJoinedAt = Date.now();
    // Everyone joining an existing room starts as a Spectator until approved into a slot
    myAssignedSlot = -1;
    myRole = "spectator";
    sessionScores = {};
    lastScoredBattleNumber = 0;
    roomActivityLog = [];
    pendingRequests = [];
    myPendingRequest = null;

    pushActivityLog(`Entered room ${currentRoomId} as spectator.`, "room");

    await ensureGlobalLobbySubscribed();
    await subscribeToRoom(currentRoomId);
    return currentRoomId;
  }

  function broadcastGameStateIfActive(targetRequesterId = null) {
    if (!currentChannel || !inGame || typeof getHostStateCallback !== "function") return;
    const hostState = getHostStateCallback();
    if (!hostState || !hostState.roster) return;
    currentChannel.send({
      type: "broadcast",
      event: "game_state_sync",
      payload: Object.assign({}, hostState, {
        roomId: currentRoomId,
        roomName: currentRoomName,
        entryFee: currentEntryFee || 0,
        turnTimeoutSec,
        sessionScores,
        hostId: hostPlayerId || myPlayerId,
        spectators,
        targetId: targetRequesterId || null
      })
    });
  }

  function recomputeMyRoleAndSlot() {
    if (isRoomHost) {
      myRole = "host";
      myAssignedSlot = 0;
      return;
    }
    const idx = roomSlots.findIndex(s => s.type === "human" && s.id === myPlayerId);
    if (idx !== -1) {
      myAssignedSlot = idx;
      myRole = "player";
    } else {
      myAssignedSlot = -1;
      myRole = "spectator";
    }
  }

  async function subscribeToRoom(roomId) {
    const client = getClient();
    const channelName = `caro_arena_room_${roomId}`;

    if (client) {
      currentChannel = client.channel(channelName, {
        config: {
          broadcast: { self: false },
          presence: { key: myPlayerId }
        }
      });
    } else {
      currentChannel = new LocalBroadcastChannelAdapter(channelName, myPlayerId);
    }

    // 1. Presence tracking
    currentChannel.on("presence", { event: "sync" }, () => {
      if (!currentChannel) return;
      const state = currentChannel.presenceState();
      handlePresenceSync(state);
    });

    currentChannel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      if (newPresences) {
        newPresences.forEach(p => {
          if (p.isHost && p.id) {
            hostPlayerId = p.id;
          }
          if (p.name && p.id !== myPlayerId) {
            pushActivityLog(`${p.name} entered the room.`, "presence");
            if (onStatusMessageCallback) {
              onStatusMessageCallback(`${p.name} entered the room.`);
            }
          }
        });
      }
      if (currentChannel) {
        handlePresenceSync(currentChannel.presenceState());
      }
    });

    currentChannel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      if (leftPresences) {
        leftPresences.forEach(p => {
          if (p.name && p.id !== myPlayerId) {
            pushActivityLog(`${p.name} left the room.`, "presence");
            if (onStatusMessageCallback) {
              onStatusMessageCallback(`${p.name} left the room.`);
            }
          }
        });
      }
      const wasHost = (key && key === hostPlayerId) || Boolean(leftPresences && leftPresences.some(p => p.isHost));
      handleParticipantLeft(key);
      if (wasHost) {
        handleHostDisconnected(key);
      }
      if (currentChannel) {
        handlePresenceSync(currentChannel.presenceState());
      }
    });

    // 2. Broadcast events
    currentChannel.on("broadcast", { event: "peer_enter" }, ({ payload }) => {
      if (!isRoomHost || !payload?.id) return;
      if (payload.id !== myPlayerId) {
        knownPeers.set(payload.id, {
          id: payload.id,
          name: payload.name || "Spectator",
          joinedAt: Date.now()
        });
        // Check if this peer already owns a slot (e.g., tab refresh reconnect)
        const existingSlot = roomSlots.find(s => s.id === payload.id);
        if (existingSlot) {
          existingSlot.name = payload.name || existingSlot.name;
          existingSlot.ready = true;
        } else if (!spectators.some(sp => sp.id === payload.id)) {
          spectators.push({
            id: payload.id,
            name: payload.name || "Spectator",
            joinedAt: Date.now()
          });
        }
        broadcastLobbyUpdate();
        if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
      }
      if (inGame) {
        broadcastGameStateIfActive(payload.id);
      }
    });

    currentChannel.on("broadcast", { event: "request_lobby" }, ({ payload }) => {
      if (!isRoomHost) return;
      if (payload?.from && payload.from !== myPlayerId) {
        knownPeers.set(payload.from, {
          id: payload.from,
          name: payload.name || "Spectator",
          joinedAt: Date.now()
        });
        const existingSlot = roomSlots.find(s => s.id === payload.from);
        if (!existingSlot && !spectators.some(sp => sp.id === payload.from)) {
          spectators.push({
            id: payload.from,
            name: payload.name || "Spectator",
            joinedAt: Date.now()
          });
        }
      }
      broadcastLobbyUpdate();
      if (inGame) {
        broadcastGameStateIfActive(payload?.from);
      }
    });

    currentChannel.on("broadcast", { event: "join_request" }, ({ payload }) => {
      if (!isRoomHost || !payload?.fromId || !payload?.requestId) return;
      // Deduplicate active request from same user
      pendingRequests = pendingRequests.filter(r => r.fromId !== payload.fromId);
      const req = {
        requestId: payload.requestId,
        kind: payload.kind === "takeover" ? "takeover" : "join",
        fromId: payload.fromId,
        fromName: payload.fromName || "Spectator",
        slotIndex: typeof payload.slotIndex === "number" ? payload.slotIndex : null,
        targetSymbol: payload.targetSymbol || null,
        createdAt: Date.now()
      };
      pendingRequests.push(req);
      const label = req.kind === "takeover"
        ? `${req.fromName} requested to take over Slot ${req.targetSymbol || (req.slotIndex + 1)}.`
        : `${req.fromName} requested to join the match.`;
      pushActivityLog(label, "request");
      if (onStatusMessageCallback) {
        onStatusMessageCallback(label);
      }
      if (onRequestsChangeCallback) onRequestsChangeCallback(pendingRequests.slice());
      if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    });

    currentChannel.on("broadcast", { event: "request_resolved" }, ({ payload }) => {
      if (!payload || payload.targetId !== myPlayerId) return;
      myPendingRequest = null;
      if (payload.approved) {
        if (typeof payload.slotIndex === "number") {
          myAssignedSlot = payload.slotIndex;
          myRole = "player";
        }
        pushActivityLog(payload.message || "Host approved your request.", "request");
        if (onStatusMessageCallback) {
          onStatusMessageCallback(payload.message || "Host approved your request. You are now in the match.");
        }
      } else {
        lastRejectedAt = Date.now();
        pushActivityLog(payload.message || "Host declined your request.", "request");
        if (onStatusMessageCallback) {
          onStatusMessageCallback(payload.message || "Host declined your request.");
        }
      }
      if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    });

    currentChannel.on("broadcast", { event: "kicked_to_spectator" }, ({ payload }) => {
      if (!payload || payload.targetId !== myPlayerId) return;
      myAssignedSlot = -1;
      myRole = "spectator";
      pushActivityLog("Moved to spectator mode by host.", "request");
      if (onStatusMessageCallback) {
        onStatusMessageCallback("You were moved to Spectator mode by the Host.");
      }
      if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    });

    currentChannel.on("broadcast", { event: "slot_takeover" }, ({ payload }) => {
      if (!payload || !payload.symbol) return;
      if (payload.newPlayerId === myPlayerId) {
        myRole = "player";
        if (typeof payload.slotIndex === "number") {
          myAssignedSlot = payload.slotIndex;
        }
      } else if (payload.previousPlayerId === myPlayerId) {
        myRole = "spectator";
        myAssignedSlot = -1;
      }
      if (Array.isArray(payload.slots)) {
        roomSlots = payload.slots;
      }
      if (Array.isArray(payload.spectators)) {
        spectators = payload.spectators;
      }
      pushActivityLog(`${payload.newPlayerName || "Player"} took over Slot ${payload.symbol}.`, "takeover");
      if (onSlotTakeoverCallback) {
        onSlotTakeoverCallback(payload);
      }
      if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    });

    currentChannel.on("broadcast", { event: "room_closed" }, ({ payload }) => {
      if (onStatusMessageCallback) {
        onStatusMessageCallback(payload?.reason || "Room closed because all players left.");
      }
      leaveRoom(true);
    });

    currentChannel.on("broadcast", { event: "request_game_state" }, ({ payload }) => {
      if (!inGame) return;
      if (isRoomHost || (payload?.from && payload.from === hostPlayerId)) {
        broadcastGameStateIfActive(payload?.from);
      }
    });

    currentChannel.on("broadcast", { event: "game_state_sync" }, ({ payload }) => {
      if (!payload || !payload.roster) return;
      if (payload.hostId) hostPlayerId = payload.hostId;
      if (payload.roomName) currentRoomName = payload.roomName;
      if (payload.entryFee !== undefined) currentEntryFee = Math.max(0, Number(payload.entryFee) || 0);
      if (payload.turnTimeoutSec !== undefined) turnTimeoutSec = normalizeTurnTimeoutSec(payload.turnTimeoutSec);
      if (payload.sessionScores && typeof payload.sessionScores === "object") sessionScores = payload.sessionScores;
      if (Array.isArray(payload.spectators)) spectators = payload.spectators;
      inGame = true;
      recomputeMyRoleAndSlot();
      if (onStateSyncCallback) onStateSyncCallback(payload);
    });

    currentChannel.on("broadcast", { event: "session_score_update" }, ({ payload }) => {
      if (payload?.sessionScores && typeof payload.sessionScores === "object") {
        sessionScores = payload.sessionScores;
        if (payload.battleNumber) lastScoredBattleNumber = payload.battleNumber;
        if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
      }
    });

    currentChannel.on("broadcast", { event: "host_leave" }, ({ payload }) => {
      const leftId = payload?.hostId || hostPlayerId;
      if (leftId) {
        handleParticipantLeft(leftId);
        handleHostDisconnected(leftId);
      }
    });

    currentChannel.on("broadcast", { event: "host_migrated" }, ({ payload }) => {
      if (!payload?.newHostId) return;
      hostPlayerId = payload.newHostId;
      isRoomHost = (payload.newHostId === myPlayerId);
      recomputeMyRoleAndSlot();
      pushActivityLog(`${payload.newHostName || "Player"} became room host.`, "room");
      if (onHostMigratedCallback) {
        onHostMigratedCallback({
          newHostId: payload.newHostId,
          newHostName: payload.newHostName,
          leftHostId: payload.leftHostId,
          isMe: isRoomHost
        });
      }
      if (isRoomHost) {
        publishRoomToGlobalLobby();
      }
    });

    currentChannel.on("broadcast", { event: "lobby_update" }, ({ payload }) => {
      if (payload?.hostId) hostPlayerId = payload.hostId;
      if (payload?.roomName) currentRoomName = payload.roomName;
      if (payload?.isPublic !== undefined) isRoomPublic = Boolean(payload.isPublic);
      if (payload?.entryFee !== undefined) currentEntryFee = Math.max(0, Number(payload.entryFee) || 0);
      if (payload?.turnTimeoutSec !== undefined) turnTimeoutSec = normalizeTurnTimeoutSec(payload.turnTimeoutSec);
      if (payload?.sessionScores && typeof payload.sessionScores === "object") sessionScores = payload.sessionScores;
      if (!isRoomHost) {
        if (Array.isArray(payload?.slots)) {
          roomSlots = payload.slots;
        }
        if (Array.isArray(payload?.spectators)) {
          spectators = payload.spectators;
        }
        recomputeMyRoleAndSlot();
        if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
      }
    });

    currentChannel.on("broadcast", { event: "game_start" }, ({ payload }) => {
      inGame = true;
      currentBattleNumber = payload?.battleNumber || 1;
      if (payload?.hostId) hostPlayerId = payload.hostId;
      if (payload?.roomName) currentRoomName = payload.roomName;
      if (payload?.entryFee !== undefined) currentEntryFee = Math.max(0, Number(payload.entryFee) || 0);
      if (payload?.turnTimeoutSec !== undefined) turnTimeoutSec = normalizeTurnTimeoutSec(payload.turnTimeoutSec);
      if (payload?.sessionScores && typeof payload.sessionScores === "object") sessionScores = payload.sessionScores;
      if (Array.isArray(payload?.slots)) roomSlots = payload.slots;
      if (Array.isArray(payload?.spectators)) spectators = payload.spectators;
      recomputeMyRoleAndSlot();
      pushActivityLog(`Battle #${currentBattleNumber} started.`, "battle");
      if (onGameStartCallback) onGameStartCallback(payload);
    });

    currentChannel.on("broadcast", { event: "game_move" }, ({ payload }) => {
      if (onRemoteMoveCallback) onRemoteMoveCallback(payload);
    });

    currentChannel.on("broadcast", { event: "game_emote" }, ({ payload }) => {
      if (payload?.senderName && payload?.emoji) {
        pushActivityLog(`${payload.senderName} sent ${payload.emoji}`, "emote");
      }
      if (onEmoteCallback && payload) onEmoteCallback(payload);
    });

    currentChannel.on("broadcast", { event: "game_next" }, ({ payload }) => {
      currentBattleNumber = payload?.battleNumber || (currentBattleNumber + 1);
      pushActivityLog(`Battle #${currentBattleNumber} started.`, "battle");
      if (onRemoteNextBattleCallback) onRemoteNextBattleCallback(payload);
    });

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const timer = setTimeout(finish, 4000);
      currentChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          try {
            await currentChannel.track({
              id: myPlayerId,
              name: myPlayerName,
              isHost: isRoomHost,
              role: myRole,
              joinedAt: Date.now()
            });

            if (isRoomHost) {
              broadcastLobbyUpdate();
              await publishRoomToGlobalLobby();
            } else {
              currentChannel.send({
                type: "broadcast",
                event: "peer_enter",
                payload: { id: myPlayerId, name: myPlayerName }
              });
              currentChannel.send({
                type: "broadcast",
                event: "request_lobby",
                payload: { from: myPlayerId, name: myPlayerName }
              });
              currentChannel.send({
                type: "broadcast",
                event: "request_game_state",
                payload: { from: myPlayerId, name: myPlayerName }
              });
            }
          } catch {}
          finish();
        }
      });
    });
  }

  function requestStateSync() {
    if (!currentChannel) return;
    currentChannel.send({
      type: "broadcast",
      event: "request_game_state",
      payload: { from: myPlayerId, name: myPlayerName }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Spectator Requests ("Request to Join" & "Request Takeover") + Host Approval
  // ───────────────────────────────────────────────────────────────────────────
  function requestJoinSlot(preferredSlotIndex = null) {
    if (!currentChannel || isRoomHost) return false;
    if (myRole === "player") {
      if (onStatusMessageCallback) onStatusMessageCallback("You are already in a player slot.");
      return false;
    }
    const cooldownRem = 15000 - (Date.now() - lastRejectedAt);
    if (cooldownRem > 0) {
      if (onStatusMessageCallback) {
        onStatusMessageCallback(`Please wait ${Math.ceil(cooldownRem / 1000)}s before sending another request.`);
      }
      return false;
    }

    const req = {
      requestId: "req_" + Math.random().toString(36).substring(2, 9),
      kind: "join",
      fromId: myPlayerId,
      fromName: myPlayerName,
      slotIndex: typeof preferredSlotIndex === "number" ? preferredSlotIndex : null,
      targetSymbol: null
    };
    myPendingRequest = req;
    currentChannel.send({
      type: "broadcast",
      event: "join_request",
      payload: req
    });
    if (onStatusMessageCallback) {
      onStatusMessageCallback("Join request sent to the host — waiting for approval.");
    }
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function requestTakeover(targetSymbolOrSlot) {
    if (!currentChannel || isRoomHost) return false;
    const cooldownRem = 15000 - (Date.now() - lastRejectedAt);
    if (cooldownRem > 0) {
      if (onStatusMessageCallback) {
        onStatusMessageCallback(`Please wait ${Math.ceil(cooldownRem / 1000)}s before sending another request.`);
      }
      return false;
    }

    const symbols = ["A", "B", "C", "D"];
    let slotIndex = null;
    let targetSymbol = null;
    if (typeof targetSymbolOrSlot === "number") {
      slotIndex = targetSymbolOrSlot;
      targetSymbol = symbols[slotIndex] || "B";
    } else if (typeof targetSymbolOrSlot === "string") {
      targetSymbol = targetSymbolOrSlot.toUpperCase();
      slotIndex = symbols.indexOf(targetSymbol);
    }

    const req = {
      requestId: "req_" + Math.random().toString(36).substring(2, 9),
      kind: "takeover",
      fromId: myPlayerId,
      fromName: myPlayerName,
      slotIndex,
      targetSymbol
    };
    myPendingRequest = req;
    currentChannel.send({
      type: "broadcast",
      event: "join_request",
      payload: req
    });
    if (onStatusMessageCallback) {
      onStatusMessageCallback(`Takeover request for Slot ${targetSymbol || ""} sent to host.`);
    }
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function approveRequest(requestId) {
    if (!isRoomHost || !currentChannel) return false;
    const idx = pendingRequests.findIndex(r => r.requestId === requestId);
    if (idx === -1) return false;
    const req = pendingRequests.splice(idx, 1)[0];

    const symbols = ["A", "B", "C", "D"];

    if (req.kind === "takeover" || inGame) {
      // Mid-game or specific slot takeover
      let targetIdx = typeof req.slotIndex === "number" && req.slotIndex > 0 && req.slotIndex < roomSlots.length
        ? req.slotIndex
        : -1;
      if (targetIdx === -1 && req.targetSymbol) {
        const sIdx = symbols.indexOf(req.targetSymbol);
        if (sIdx > 0 && sIdx < roomSlots.length) targetIdx = sIdx;
      }
      if (targetIdx === -1) {
        // Find first open human slot, disconnected slot, or AI slot
        targetIdx = roomSlots.findIndex((s, i) => i > 0 && s.type === "human" && !s.id);
        if (targetIdx === -1) {
          targetIdx = roomSlots.findIndex((s, i) => i > 0 && s.type === "ai");
        }
        if (targetIdx === -1 && roomSlots.length > 1) targetIdx = 1;
      }

      if (targetIdx > 0 && targetIdx < roomSlots.length) {
        const prevSlot = roomSlots[targetIdx];
        const prevPlayerId = prevSlot.id || null;
        if (prevPlayerId && prevPlayerId !== req.fromId) {
          const prevPeer = knownPeers.get(prevPlayerId);
          if (prevPeer && !spectators.some(sp => sp.id === prevPlayerId)) {
            spectators.push({ id: prevPlayerId, name: prevSlot.name || prevPeer.name, joinedAt: Date.now() });
          }
        }
        roomSlots[targetIdx] = {
          type: "human",
          name: req.fromName,
          id: req.fromId,
          ready: true
        };
        spectators = spectators.filter(sp => sp.id !== req.fromId);
        const sym = symbols[targetIdx] || "B";

        pushActivityLog(`Approved ${req.fromName} for Slot #${targetIdx + 1} (${sym}).`, "request");

        currentChannel.send({
          type: "broadcast",
          event: "request_resolved",
          payload: {
            requestId: req.requestId,
            targetId: req.fromId,
            approved: true,
            slotIndex: targetIdx,
            symbol: sym,
            message: `Host approved. You are now playing as Slot #${targetIdx + 1} (${sym}).`
          }
        });

        const takeoverPayload = {
          roomId: currentRoomId,
          slotIndex: targetIdx,
          symbol: sym,
          newPlayerId: req.fromId,
          newPlayerName: req.fromName,
          previousPlayerId: prevPlayerId,
          slots: roomSlots,
          spectators
        };
        currentChannel.send({
          type: "broadcast",
          event: "slot_takeover",
          payload: takeoverPayload
        });
        if (onSlotTakeoverCallback) {
          onSlotTakeoverCallback(takeoverPayload);
        }
        broadcastLobbyUpdate();
        if (inGame) {
          broadcastGameStateIfActive();
        }
      }
    } else {
      // Pre-game lobby join request
      let targetIdx = (typeof req.slotIndex === "number" && req.slotIndex > 0 && req.slotIndex < roomSlots.length && roomSlots[req.slotIndex].type === "human" && !roomSlots[req.slotIndex].id)
        ? req.slotIndex
        : roomSlots.findIndex((s, i) => i > 0 && s.type === "human" && !s.id);

      if (targetIdx === -1 && roomSlots.length < 4) {
        roomSlots.push({ type: "human", name: req.fromName, id: req.fromId, ready: true });
        targetIdx = roomSlots.length - 1;
      } else if (targetIdx === -1) {
        // Convert an AI slot if available
        const aiIdx = roomSlots.findIndex((s, i) => i > 0 && s.type === "ai");
        if (aiIdx !== -1) {
          targetIdx = aiIdx;
        }
      }

      if (targetIdx !== -1) {
        roomSlots[targetIdx] = {
          type: "human",
          name: req.fromName,
          id: req.fromId,
          ready: true
        };
        spectators = spectators.filter(sp => sp.id !== req.fromId);
        pushActivityLog(`Approved ${req.fromName} into Slot #${targetIdx + 1}.`, "request");
        currentChannel.send({
          type: "broadcast",
          event: "request_resolved",
          payload: {
            requestId: req.requestId,
            targetId: req.fromId,
            approved: true,
            slotIndex: targetIdx,
            symbol: symbols[targetIdx] || "B",
            message: `Host approved. You joined Slot #${targetIdx + 1}.`
          }
        });
        broadcastLobbyUpdate();
      }
    }

    if (onRequestsChangeCallback) onRequestsChangeCallback(pendingRequests.slice());
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function rejectRequest(requestId) {
    if (!isRoomHost || !currentChannel) return false;
    const idx = pendingRequests.findIndex(r => r.requestId === requestId);
    if (idx === -1) return false;
    const req = pendingRequests.splice(idx, 1)[0];

    pushActivityLog(`Declined request from ${req.fromName}.`, "request");
    currentChannel.send({
      type: "broadcast",
      event: "request_resolved",
      payload: {
        requestId: req.requestId,
        targetId: req.fromId,
        approved: false,
        message: "Host declined your request."
      }
    });
    if (onRequestsChangeCallback) onRequestsChangeCallback(pendingRequests.slice());
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Dynamic Slot & Room Customization (Host)
  // ───────────────────────────────────────────────────────────────────────────
  function setRoomMeta({ roomName, isPublic, entryFee, turnTimeoutSec: nextTimeout } = {}) {
    if (!isRoomHost) return;
    if (roomName !== undefined && String(roomName).trim()) {
      currentRoomName = String(roomName).trim().substring(0, 32);
    }
    if (isPublic !== undefined) {
      isRoomPublic = Boolean(isPublic);
    }
    if (entryFee !== undefined && !inGame) {
      currentEntryFee = Math.max(0, Number(entryFee) || 0);
    }
    if (nextTimeout !== undefined && !inGame) {
      turnTimeoutSec = normalizeTurnTimeoutSec(nextTimeout);
    }
    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  function addSlot(type = "human", model = "von") {
    if ((!isRoomHost && currentRoomId) || roomSlots.length >= 4) return false;
    if (type === "ai") {
      const m = AI_MODELS.includes(model) ? model : "von";
      roomSlots.push({
        type: "ai",
        model: m,
        name: AI_NAMES[m] || "AI",
        id: null,
        ready: true
      });
    } else {
      roomSlots.push({
        type: "human",
        name: "Open human slot",
        id: null,
        ready: false
      });
    }
    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function removeSlot(index) {
    if (!isRoomHost && currentRoomId) return false;
    if (index <= 0 || index >= roomSlots.length || roomSlots.length <= 2) return false;

    const removed = roomSlots[index];
    if (removed && removed.type === "human" && removed.id) {
      if (!spectators.some(sp => sp.id === removed.id)) {
        spectators.push({ id: removed.id, name: removed.name || "Spectator", joinedAt: Date.now() });
      }
      if (currentChannel) {
        currentChannel.send({
          type: "broadcast",
          event: "kicked_to_spectator",
          payload: { targetId: removed.id }
        });
      }
    }

    if (inGame) {
      // Mid-game: convert removed human slot to AI bot so board symbols A..D remain intact
      roomSlots[index] = {
        type: "ai",
        model: "von",
        name: "Von (AI)",
        id: null,
        ready: true
      };
      const symbols = ["A", "B", "C", "D"];
      const takeoverPayload = {
        roomId: currentRoomId,
        slotIndex: index,
        symbol: symbols[index] || "B",
        newPlayerId: null,
        newPlayerName: "Von (AI)",
        isAiReplacement: true,
        aiModel: "von",
        previousPlayerId: removed?.id || null,
        slots: roomSlots,
        spectators
      };
      if (currentChannel) {
        currentChannel.send({
          type: "broadcast",
          event: "slot_takeover",
          payload: takeoverPayload
        });
      }
      if (onSlotTakeoverCallback) onSlotTakeoverCallback(takeoverPayload);
    } else {
      roomSlots.splice(index, 1);
    }

    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function kickPlayerToSpectator(index) {
    if (!isRoomHost || index <= 0 || index >= roomSlots.length) return false;
    const slot = roomSlots[index];
    if (!slot || slot.type !== "human" || !slot.id) return false;
    const kickedId = slot.id;
    const kickedName = slot.name || "Spectator";

    if (!spectators.some(sp => sp.id === kickedId)) {
      spectators.push({ id: kickedId, name: kickedName, joinedAt: Date.now() });
    }
    if (currentChannel) {
      currentChannel.send({
        type: "broadcast",
        event: "kicked_to_spectator",
        payload: { targetId: kickedId }
      });
    }

    if (inGame) {
      roomSlots[index] = {
        type: "ai",
        model: "von",
        name: "Von (AI)",
        id: null,
        ready: true
      };
      const symbols = ["A", "B", "C", "D"];
      const takeoverPayload = {
        roomId: currentRoomId,
        slotIndex: index,
        symbol: symbols[index] || "B",
        newPlayerId: null,
        newPlayerName: "Von (AI)",
        isAiReplacement: true,
        aiModel: "von",
        previousPlayerId: kickedId,
        slots: roomSlots,
        spectators
      };
      if (currentChannel) {
        currentChannel.send({
          type: "broadcast",
          event: "slot_takeover",
          payload: takeoverPayload
        });
      }
      if (onSlotTakeoverCallback) onSlotTakeoverCallback(takeoverPayload);
    } else {
      roomSlots[index] = {
        type: "human",
        name: "Open human slot",
        id: null,
        ready: false
      };
    }

    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    return true;
  }

  function updateSlot(index, slotConfig) {
    if (!isRoomHost) return;
    if (index <= 0 || index >= roomSlots.length) return;

    const prev = roomSlots[index];
    if (slotConfig.type === "closed") {
      removeSlot(index);
      return;
    }
    if (prev && prev.type === "human" && prev.id && slotConfig.type !== "human") {
      if (!spectators.some(sp => sp.id === prev.id)) {
        spectators.push({ id: prev.id, name: prev.name || "Spectator", joinedAt: Date.now() });
      }
      if (currentChannel) {
        currentChannel.send({
          type: "broadcast",
          event: "kicked_to_spectator",
          payload: { targetId: prev.id }
        });
      }
    }
    roomSlots[index] = Object.assign({}, roomSlots[index], slotConfig);
    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Presence Sync, Host Migration & Empty-Room Auto-Close
  // ───────────────────────────────────────────────────────────────────────────
  function handleHostDisconnected(leftHostId) {
    if (isRoomHost) return;

    const hostState = typeof getHostStateCallback === "function" ? getHostStateCallback() : null;
    const activeRoster = hostState?.roster || [];
    let candidateIds = [];

    if (activeRoster.length > 0) {
      candidateIds = activeRoster
        .filter(r => r.type === "human" && r.playerId && r.playerId !== leftHostId)
        .map(r => r.playerId);
    }
    if (candidateIds.length === 0) {
      candidateIds = roomSlots
        .filter(s => s.type === "human" && s.id && s.id !== leftHostId)
        .map(s => s.id);
    }

    if (currentChannel && typeof currentChannel.presenceState === "function") {
      const pState = currentChannel.presenceState();
      const presentKeys = new Set(Object.keys(pState));
      if (presentKeys.size > 0) {
        candidateIds = candidateIds.filter(id => presentKeys.has(id));
      }
    }

    // If no active human players remain in the room at all, auto-close the room!
    if (candidateIds.length === 0) {
      if (onStatusMessageCallback) {
        onStatusMessageCallback("Room closed because all active players left.");
      }
      leaveRoom(true);
      return;
    }

    const nextHostId = candidateIds[0];
    if (nextHostId === myPlayerId) {
      isRoomHost = true;
      hostPlayerId = myPlayerId;
      myRole = "host";
      pushActivityLog(`${myPlayerName} became room host.`, "room");
      if (currentChannel && typeof currentChannel.track === "function") {
        currentChannel.track({
          id: myPlayerId,
          name: myPlayerName,
          isHost: true,
          role: "host",
          joinedAt: Date.now()
        }).catch(() => {});
      }
      if (currentChannel) {
        currentChannel.send({
          type: "broadcast",
          event: "host_migrated",
          payload: {
            roomId: currentRoomId,
            newHostId: myPlayerId,
            newHostName: myPlayerName,
            leftHostId
          }
        });
      }
      if (onStatusMessageCallback) {
        onStatusMessageCallback(`Host left — ${myPlayerName} is now Room Host.`);
      }
      if (onHostMigratedCallback) {
        onHostMigratedCallback({
          newHostId: myPlayerId,
          newHostName: myPlayerName,
          leftHostId,
          isMe: true
        });
      }
      publishRoomToGlobalLobby();
      if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
    }
  }

  function handlePresenceSync(presenceState) {
    const presentUsers = [];
    for (const key in presenceState) {
      const presences = presenceState[key];
      if (presences && presences.length > 0) {
        presentUsers.push(presences[0]);
      }
    }

    let seenHostInPresence = false;
    for (const u of presentUsers) {
      if (u && u.isHost && u.id) {
        hostPlayerId = u.id;
        seenHostInPresence = true;
      }
    }

    // Self-healing Host Migration: if host disconnected ungracefully without sending host_leave
    if (
      !isRoomHost &&
      hostPlayerId &&
      presentUsers.length > 0 &&
      !seenHostInPresence &&
      Date.now() - roomJoinedAt > 2500
    ) {
      const hostStillPresent = presentUsers.some(u => u && u.id === hostPlayerId);
      if (!hostStillPresent) {
        const missingHostId = hostPlayerId;
        handleParticipantLeft(missingHostId);
        handleHostDisconnected(missingHostId);
        return;
      }
    }

    if (isRoomHost) {
      roomSlots[0].name = myPlayerName;
      roomSlots[0].id = myPlayerId;
      roomSlots[0].ready = true;

      const presentSet = new Set(presentUsers.map(u => u.id));
      const slottedIds = new Set(roomSlots.filter(s => s.type === "human" && s.id).map(s => s.id));

      // Keep spectators list synchronized with present non-slotted users
      for (const u of presentUsers) {
        if (u && u.id && u.id !== myPlayerId && !slottedIds.has(u.id)) {
          const existingSp = spectators.find(sp => sp.id === u.id);
          if (existingSp) {
            existingSp.name = u.name || existingSp.name;
          } else {
            spectators.push({
              id: u.id,
              name: u.name || "Spectator",
              joinedAt: u.joinedAt || Date.now()
            });
          }
        }
      }
      if (presentSet.size > 0) {
        spectators = spectators.filter(sp => presentSet.has(sp.id) && !slottedIds.has(sp.id));
      }

      broadcastLobbyUpdate();
    }

    recomputeMyRoleAndSlot();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  function handleParticipantLeft(playerId) {
    if (!playerId) return;
    knownPeers.delete(playerId);
    spectators = spectators.filter(sp => sp.id !== playerId);
    pendingRequests = pendingRequests.filter(r => r.fromId !== playerId);

    if (isRoomHost) {
      const slotIdx = roomSlots.findIndex((s, i) => i > 0 && s.id === playerId);
      if (slotIdx !== -1) {
        if (!inGame) {
          roomSlots[slotIdx].id = null;
          roomSlots[slotIdx].name = "Open human slot";
          roomSlots[slotIdx].ready = false;
        }
      }
      broadcastLobbyUpdate();
      if (onRequestsChangeCallback) onRequestsChangeCallback(pendingRequests.slice());
    }
  }

  function broadcastLobbyUpdate() {
    if (!currentChannel || !isRoomHost) return;
    currentChannel.send({
      type: "broadcast",
      event: "lobby_update",
      payload: {
        roomId: currentRoomId,
        roomName: currentRoomName,
        isPublic: isRoomPublic,
        entryFee: currentEntryFee || 0,
        turnTimeoutSec,
        sessionScores,
        slots: roomSlots,
        spectators,
        hostName: myPlayerName,
        hostId: myPlayerId
      }
    });
    publishRoomToGlobalLobby();
  }

  function startGame() {
    if (!isRoomHost || !currentChannel) return;

    // Auto-approve pending join requests into any open human slots before starting
    for (let i = 1; i < roomSlots.length; i++) {
      if (roomSlots[i].type === "human" && !roomSlots[i].id) {
        const pendingJoin = pendingRequests.find(r => r.kind === "join");
        if (pendingJoin) {
          approveRequest(pendingJoin.requestId);
        } else if (spectators.length > 0) {
          // If host starts game with an open human slot and a spectator waiting, seat the spectator
          const sp = spectators.shift();
          roomSlots[i].id = sp.id;
          roomSlots[i].name = sp.name;
          roomSlots[i].ready = true;
        }
      }
    }

    const activeSlots = roomSlots.filter(s => s.type === "human" || s.type === "ai");
    if (activeSlots.length < 2) {
      throw new Error("Need at least 2 players to start a battle.");
    }

    const unreadyHuman = activeSlots.find((s, idx) => idx > 0 && s.type === "human" && !s.id);
    if (unreadyHuman) {
      throw new Error("An open Human Slot is still empty. Approve a spectator, switch it to AI, or remove the slot.");
    }

    const symbols = ["A", "B", "C", "D"];
    const roster = activeSlots.map((s, idx) => ({
      slotIndex: idx,
      type: s.type === "human" ? "human" : s.model,
      name: s.name,
      symbol: symbols[idx],
      isLocalHuman: (s.type === "human" && s.id === myPlayerId),
      isAi: s.type === "ai",
      playerId: s.id,
      isHost: idx === 0
    }));

    inGame = true;
    currentBattleNumber = 1;
    hostPlayerId = myPlayerId;
    pushActivityLog("Battle #1 started.", "battle");

    const startPayload = {
      roomId: currentRoomId,
      roomName: currentRoomName,
      entryFee: currentEntryFee || 0,
      turnTimeoutSec,
      sessionScores,
      hostId: myPlayerId,
      roster,
      slots: roomSlots,
      spectators,
      battleNumber: 1
    };

    currentChannel.send({
      type: "broadcast",
      event: "game_start",
      payload: startPayload
    });
    publishRoomToGlobalLobby();

    if (onGameStartCallback) {
      onGameStartCallback(startPayload);
    }
  }

  function sendMove(row, col, playerType, symbol, moveNum) {
    if (!currentChannel) return;
    currentChannel.send({
      type: "broadcast",
      event: "game_move",
      payload: {
        row,
        col,
        playerType,
        symbol,
        moveNum,
        senderId: myPlayerId
      }
    });
  }

  function sendEmote(emoji) {
    const cleanEmoji = String(emoji || "👏").trim().substring(0, 8);
    const payload = {
      emoji: cleanEmoji,
      senderId: myPlayerId,
      senderName: myPlayerName,
      role: myRole,
      slotIndex: myAssignedSlot,
      timestamp: Date.now()
    };
    pushActivityLog(`${myPlayerName} sent ${cleanEmoji}`, "emote");
    if (currentChannel) {
      currentChannel.send({
        type: "broadcast",
        event: "game_emote",
        payload
      });
    }
    if (onEmoteCallback) {
      onEmoteCallback(payload);
    }
  }

  function sendNextBattle(battleNum) {
    if (!currentChannel || !isRoomHost) return;
    currentBattleNumber = battleNum;
    pushActivityLog(`Battle #${battleNum} started.`, "battle");
    currentChannel.send({
      type: "broadcast",
      event: "game_next",
      payload: {
        battleNumber: battleNum
      }
    });
    publishRoomToGlobalLobby();
  }

  function leaveRoom(userInitiated = true) {
    const leavingRoomId = currentRoomId;
    const wasHost = isRoomHost;

    if (currentChannel) {
      try {
        if (wasHost && leavingRoomId) {
          // Check if any other human players are seated in slots
          const otherSeatedHumans = roomSlots.filter((s, idx) => idx > 0 && s.type === "human" && s.id && s.id !== myPlayerId);
          if (otherSeatedHumans.length === 0) {
            currentChannel.send({
              type: "broadcast",
              event: "room_closed",
              payload: { roomId: leavingRoomId, reason: "Host left and closed the room." }
            });
            unpublishRoomFromGlobalLobby(leavingRoomId);
          } else {
            currentChannel.send({
              type: "broadcast",
              event: "host_leave",
              payload: { hostId: myPlayerId, roomId: leavingRoomId }
            });
            unpublishRoomFromGlobalLobby(leavingRoomId);
          }
        }
        currentChannel.unsubscribe();
      } catch {}
      currentChannel = null;
    }

    knownPeers.clear();
    spectators = [];
    pendingRequests = [];
    myPendingRequest = null;
    currentRoomId = null;
    currentRoomName = "";
    currentEntryFee = 0;
    sessionScores = {};
    lastScoredBattleNumber = 0;
    roomActivityLog = [];
    isRoomHost = false;
    hostPlayerId = null;
    myAssignedSlot = -1;
    myRole = "spectator";
    inGame = false;

    if (userInitiated) {
      try { sessionStorage.removeItem("caro_active_room"); } catch {}
      updateBrowserUrlRoom(null);
      if (onRoomLeaveCallback) onRoomLeaveCallback();
    }
  }

  function getLobbyState() {
    return {
      roomId: currentRoomId,
      roomName: currentRoomName || (currentRoomId ? `Room ${currentRoomId}` : ""),
      isPublic: isRoomPublic,
      entryFee: currentEntryFee || 0,
      turnTimeoutSec,
      sessionScores: getSessionScores(),
      activityLog: roomActivityLog.slice(),
      isHost: isRoomHost,
      hostId: hostPlayerId,
      isOnline: Boolean(getClient()),
      myPlayerId,
      myPlayerName,
      myAssignedSlot,
      myRole,
      slots: roomSlots,
      spectators,
      pendingRequests,
      myPendingRequest,
      inGame,
      shareUrl: currentRoomId ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}` : ""
    };
  }

  function setCallbacks(callbacks = {}) {
    if (callbacks.onLobbyChange) onLobbyChangeCallback = callbacks.onLobbyChange;
    if (callbacks.onActiveRoomsChange) onActiveRoomsChangeCallback = callbacks.onActiveRoomsChange;
    if (callbacks.onGameStart) onGameStartCallback = callbacks.onGameStart;
    if (callbacks.onRemoteMove) onRemoteMoveCallback = callbacks.onRemoteMove;
    if (callbacks.onRemoteNextBattle) onRemoteNextBattleCallback = callbacks.onRemoteNextBattle;
    if (callbacks.onRoomLeave) onRoomLeaveCallback = callbacks.onRoomLeave;
    if (callbacks.onStatusMessage) onStatusMessageCallback = callbacks.onStatusMessage;
    if (callbacks.onStateSync) onStateSyncCallback = callbacks.onStateSync;
    if (callbacks.onHostMigrated) onHostMigratedCallback = callbacks.onHostMigrated;
    if (callbacks.onRequestsChange) onRequestsChangeCallback = callbacks.onRequestsChange;
    if (callbacks.onSlotTakeover) onSlotTakeoverCallback = callbacks.onSlotTakeover;
    if (callbacks.onEmote) onEmoteCallback = callbacks.onEmote;
    if (callbacks.onActivityLogChange) onActivityLogChangeCallback = callbacks.onActivityLogChange;
    if (callbacks.getHostState) getHostStateCallback = callbacks.getHostState;
  }

  function syncPlayerNameEverywhere(newName) {
    if (!newName || !String(newName).trim()) return;
    myPlayerName = String(newName).trim().substring(0, 20);
    try {
      sessionStorage.setItem("caro_player_name", myPlayerName);
      localStorage.setItem("caro_player_name", myPlayerName);
    } catch {}
    if (isRoomHost && roomSlots[0]) {
      roomSlots[0].name = myPlayerName;
      broadcastLobbyUpdate();
    } else if (currentChannel) {
      const idx = roomSlots.findIndex(s => s.id === myPlayerId);
      if (idx !== -1) roomSlots[idx].name = myPlayerName;
      currentChannel.track({
        id: myPlayerId,
        name: myPlayerName,
        isHost: isRoomHost,
        role: myRole,
        joinedAt: Date.now()
      }).catch(() => {});
      currentChannel.send({
        type: "broadcast",
        event: "peer_enter",
        payload: { id: myPlayerId, name: myPlayerName }
      });
    }
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  // Export Multiplayer API
  window.CaroMultiplayer = {
    init,
    getClient,
    isConfigured,
    getSavedCredentials,
    generateRoomCode,
    sanitizeRoomSlug,
    createRoom,
    joinRoom,
    leaveRoom,
    setRoomMeta,
    addSlot,
    removeSlot,
    kickPlayerToSpectator,
    updateSlot,
    requestJoinSlot,
    requestTakeover,
    approveRequest,
    rejectRequest,
    refreshActiveRooms,
    getActiveRooms,
    startGame,
    sendMove,
    sendEmote,
    sendNextBattle,
    requestStateSync,
    broadcastGameStateIfActive,
    broadcastAuthoritativeState: broadcastGameStateIfActive,
    getLobbyState,
    getActivityLog: () => roomActivityLog.slice(),
    pushActivityLog,
    recordSessionWin,
    getSessionScores,
    setCallbacks,
    get isHost() { return isRoomHost; },
    get hostId() { return hostPlayerId; },
    get isOnline() { return Boolean(getClient()); },
    get roomId() { return currentRoomId; },
    get roomName() { return currentRoomName; },
    get isPublic() { return isRoomPublic; },
    get entryFee() { return currentEntryFee; },
    get inGame() { return inGame; },
    get myId() { return myPlayerId; },
    get myAssignedSlot() { return myAssignedSlot; },
    get myRole() { return myRole; },
    get spectators() { return spectators; },
    get pendingRequests() { return pendingRequests; },
    get myName() { return myPlayerName; },
    set myName(v) { syncPlayerNameEverywhere(v); },
    get turnTimeoutSec() { return turnTimeoutSec; },
    set turnTimeoutSec(v) { turnTimeoutSec = normalizeTurnTimeoutSec(v); }
  };

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

  init();
})();

