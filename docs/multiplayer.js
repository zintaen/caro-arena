/**
 * Caro Arena — Supabase Realtime Multiplayer Engine
 * Up to 4 Players (Human vs Human with Optional AI Bots)
 * Real-time WebSocket synchronization using Supabase Broadcast & Presence
 */

(function () {
  let supabaseClient = null;
  let currentChannel = null;
  let currentRoomId = null;
  let myPlayerId = null;
  let myPlayerName = "Player";
  let isRoomHost = false;
  let myAssignedSlot = 0; // 0-indexed

  // Room state synchronized among peers
  let roomSlots = [
    { type: "human", name: "Host", id: null, ready: true },
    { type: "human", name: "Waiting...", id: null, ready: false },
    { type: "closed", name: "Closed", id: null, ready: false },
    { type: "closed", name: "Closed", id: null, ready: false },
  ];
  let inGame = false;

  // Callbacks
  let onLobbyChangeCallback = null;
  let onGameStartCallback = null;
  let onRemoteMoveCallback = null;
  let onRemoteNextBattleCallback = null;
  let onRoomLeaveCallback = null;
  let onStatusMessageCallback = null;

  function getSavedCredentials() {
    try {
      const url = localStorage.getItem("caro_supabase_url") || window.CARO_SUPABASE_URL || "";
      const key = localStorage.getItem("caro_supabase_key") || window.CARO_SUPABASE_KEY || "";
      return { url: url.trim(), key: key.trim() };
    } catch {
      return { url: "", key: "" };
    }
  }

  function isConfigured() {
    const creds = getSavedCredentials();
    return Boolean(creds.url && creds.key);
  }

  function saveCredentials(url, key) {
    try {
      localStorage.setItem("caro_supabase_url", (url || "").trim());
      localStorage.setItem("caro_supabase_key", (key || "").trim());
      supabaseClient = null; // Re-init on next use
      return true;
    } catch {
      return false;
    }
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    const creds = getSavedCredentials();
    if (!creds.url || !creds.key) return null;
    if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
      console.warn("Supabase JS SDK not loaded yet.");
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

  function generatePlayerId() {
    return "p_" + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Fallback Realtime Adapter using BroadcastChannel API
   * Enables immediate local multi-tab / side-by-side room testing without Supabase keys
   */
  class LocalBroadcastChannelAdapter {
    constructor(channelName, myPlayerId) {
      this.name = channelName;
      this.myPlayerId = myPlayerId;
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
          if (data.replyRequested && this.myPresence) {
            this.bc.postMessage({
              type: "bc_track",
              key: this.myPlayerId,
              presence: this.myPresence,
              replyRequested: false
            });
          }
        } else if (data.type === "bc_untrack") {
          const { key } = data;
          const old = this.presenceMap.get(key);
          this.presenceMap.delete(key);
          if (this.listeners.presence["leave"] && old) {
            this.listeners.presence["leave"]({ key, leftPresences: old });
          }
          if (this.listeners.presence["sync"]) {
            this.listeners.presence["sync"]();
          }
        } else if (data.type === "bc_broadcast") {
          const cb = this.listeners.broadcast[data.event];
          if (cb) {
            cb({ payload: data.payload });
          }
        }
      };
    }

    on(category, filter, callback) {
      if (category === "presence") {
        this.listeners.presence[filter.event] = callback;
      } else if (category === "broadcast") {
        this.listeners.broadcast[filter.event] = callback;
      }
      return this;
    }

    async subscribe(callback) {
      setTimeout(() => {
        if (callback) callback("SUBSCRIBED");
      }, 10);
      return this;
    }

    async track(presenceObj) {
      this.myPresence = presenceObj;
      this.presenceMap.set(this.myPlayerId, [presenceObj]);
      this.bc.postMessage({
        type: "bc_track",
        key: this.myPlayerId,
        presence: presenceObj,
        replyRequested: true
      });
      if (this.listeners.presence["sync"]) {
        this.listeners.presence["sync"]();
      }
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
      this.bc.postMessage({
        type: "bc_untrack",
        key: this.myPlayerId
      });
      this.bc.close();
      this.presenceMap.clear();
    }
  }

  function init() {
    myPlayerId = sessionStorage.getItem("caro_player_id");
    if (!myPlayerId) {
      myPlayerId = generatePlayerId();
      try { sessionStorage.setItem("caro_player_id", myPlayerId); } catch {}
    }
    myPlayerName = sessionStorage.getItem("caro_player_name") || localStorage.getItem("caro_player_name") || "Player " + myPlayerId.substring(2, 6).toUpperCase();
  }

  async function createRoom(hostName, initialSlots = null) {
    leaveRoom();
    myPlayerName = hostName || myPlayerName;
    try {
      sessionStorage.setItem("caro_player_name", myPlayerName);
      localStorage.setItem("caro_player_name", myPlayerName);
    } catch {}

    currentRoomId = generateRoomCode();
    isRoomHost = true;
    myAssignedSlot = 0;

    roomSlots = initialSlots || [
      { type: "human", name: myPlayerName, id: myPlayerId, ready: true },
      { type: "human", name: "Waiting for player...", id: null, ready: false },
      { type: "ai", model: "von", name: "Von (AI)", id: null, ready: true },
      { type: "closed", name: "Closed", id: null, ready: false },
    ];
    roomSlots[0] = { type: "human", name: myPlayerName, id: myPlayerId, ready: true };

    await subscribeToRoom(currentRoomId);
    return currentRoomId;
  }

  async function joinRoom(roomId, playerName) {
    leaveRoom();
    currentRoomId = (roomId || "").trim().toUpperCase();
    if (!currentRoomId) throw new Error("Invalid room code.");

    myPlayerName = playerName || myPlayerName;
    try {
      sessionStorage.setItem("caro_player_name", myPlayerName);
      localStorage.setItem("caro_player_name", myPlayerName);
    } catch {}
    isRoomHost = false;

    await subscribeToRoom(currentRoomId);
    return currentRoomId;
  }

  async function subscribeToRoom(roomId) {
    const client = getClient();
    const channelName = `caro_room_${roomId}`;

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

    // 1. Presence tracking (who is online)
    currentChannel.on("presence", { event: "sync" }, () => {
      const state = currentChannel.presenceState();
      handlePresenceSync(state);
    });

    currentChannel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      if (onStatusMessageCallback && newPresences) {
        newPresences.forEach(p => {
          if (p.name && p.name !== myPlayerName) {
            onStatusMessageCallback(`${p.name} joined the room.`);
          }
        });
      }
      // Re-sync lobby slots immediately when a new user arrives
      const state = currentChannel.presenceState();
      handlePresenceSync(state);
    });

    currentChannel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      if (onStatusMessageCallback && leftPresences) {
        leftPresences.forEach(p => {
          if (p.name) onStatusMessageCallback(`${p.name} left the room.`);
        });
      }
      handlePlayerLeft(key);
      const state = currentChannel.presenceState();
      handlePresenceSync(state);
    });

    // 2. Broadcast events
    currentChannel.on("broadcast", { event: "player_join" }, ({ payload }) => {
      if (!isRoomHost || !payload?.id) return;
      let slot = roomSlots.find(s => s.id === payload.id);
      if (!slot) {
        slot = roomSlots.find((s, idx) => idx > 0 && s.type === "human" && (!s.id || s.name.startsWith("Waiting")));
      }
      if (slot) {
        slot.id = payload.id;
        slot.name = payload.name || "Friend";
        slot.ready = true;
        broadcastLobbyUpdate();
        if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
      }
    });

    currentChannel.on("broadcast", { event: "lobby_update" }, ({ payload }) => {
      if (!isRoomHost && payload?.slots) {
        roomSlots = payload.slots;
        // Robust resolution of my assigned slot
        let myIndex = roomSlots.findIndex(s => s.id === myPlayerId);
        if (myIndex === -1 && myPlayerName) {
          myIndex = roomSlots.findIndex(s => s.type === "human" && s.name === myPlayerName);
        }
        if (myIndex === -1) {
          myIndex = roomSlots.findIndex((s, idx) => idx > 0 && s.type === "human");
        }
        if (myIndex !== -1) myAssignedSlot = myIndex;
        if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
      }
    });

    currentChannel.on("broadcast", { event: "game_start" }, ({ payload }) => {
      inGame = true;
      if (onGameStartCallback) onGameStartCallback(payload);
    });

    currentChannel.on("broadcast", { event: "game_move" }, ({ payload }) => {
      if (onRemoteMoveCallback) onRemoteMoveCallback(payload);
    });

    currentChannel.on("broadcast", { event: "game_next" }, ({ payload }) => {
      if (onRemoteNextBattleCallback) onRemoteNextBattleCallback(payload);
    });

    await currentChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await currentChannel.track({
          id: myPlayerId,
          name: myPlayerName,
          isHost: isRoomHost,
          joinedAt: Date.now()
        });

        if (isRoomHost) {
          broadcastLobbyUpdate();
        } else {
          // Send explicit join handshake to host
          currentChannel.send({
            type: "broadcast",
            event: "player_join",
            payload: { id: myPlayerId, name: myPlayerName }
          });
          currentChannel.send({
            type: "broadcast",
            event: "request_lobby",
            payload: { from: myPlayerId, name: myPlayerName }
          });
        }
      }
    });

    // Host listens for lobby state requests from new joiners
    if (isRoomHost) {
      currentChannel.on("broadcast", { event: "request_lobby" }, ({ payload }) => {
        if (payload?.from) {
          let slot = roomSlots.find(s => s.id === payload.from);
          if (!slot) {
            slot = roomSlots.find((s, idx) => idx > 0 && s.type === "human" && (!s.id || s.name.startsWith("Waiting")));
          }
          if (slot) {
            slot.id = payload.from;
            if (payload.name) slot.name = payload.name;
            slot.ready = true;
          }
        }
        broadcastLobbyUpdate();
      });
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

    if (isRoomHost) {
      // Slot 0 is strictly Host
      roomSlots[0].name = myPlayerName;
      roomSlots[0].id = myPlayerId;
      roomSlots[0].ready = true;

      // Assign remaining human slots to connected guests
      const guestUsers = presentUsers.filter(u => u.id !== myPlayerId);
      let guestIndex = 0;
      for (let i = 1; i < roomSlots.length; i++) {
        if (roomSlots[i].type === "human") {
          if (guestIndex < guestUsers.length) {
            const user = guestUsers[guestIndex];
            roomSlots[i].name = user.name;
            roomSlots[i].id = user.id;
            roomSlots[i].ready = true;
          } else {
            roomSlots[i].name = "Waiting for player...";
            roomSlots[i].id = null;
            roomSlots[i].ready = false;
          }
          guestIndex++;
        }
      }
      broadcastLobbyUpdate();
    }

    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  function handlePlayerLeft(playerId) {
    if (isRoomHost) {
      const slot = roomSlots.find(s => s.id === playerId);
      if (slot) {
        slot.id = null;
        slot.name = "Waiting for player...";
        slot.ready = false;
        broadcastLobbyUpdate();
      }
    }
  }

  function updateSlot(index, slotConfig) {
    if (!isRoomHost) return;
    if (index < 0 || index >= roomSlots.length) return;
    if (index === 0) return; // Slot 0 is always Host

    roomSlots[index] = Object.assign({}, roomSlots[index], slotConfig);
    broadcastLobbyUpdate();
    if (onLobbyChangeCallback) onLobbyChangeCallback(getLobbyState());
  }

  function broadcastLobbyUpdate() {
    if (!currentChannel || !isRoomHost) return;
    currentChannel.send({
      type: "broadcast",
      event: "lobby_update",
      payload: {
        roomId: currentRoomId,
        slots: roomSlots,
        hostName: myPlayerName
      }
    });
  }

  function startGame() {
    if (!isRoomHost || !currentChannel) return;

    // Ensure any open human slot is bound to a connected guest
    const presenceUsers = [];
    if (typeof currentChannel.presenceState === "function") {
      const ps = currentChannel.presenceState();
      for (const k in ps) {
        if (ps[k] && ps[k].length > 0) presenceUsers.push(ps[k][0]);
      }
    }
    const guestUsers = presenceUsers.filter(u => u.id !== myPlayerId);
    let guestIdx = 0;
    for (let i = 1; i < roomSlots.length; i++) {
      if (roomSlots[i].type === "human" && (!roomSlots[i].id || roomSlots[i].name.startsWith("Waiting"))) {
        if (guestIdx < guestUsers.length) {
          roomSlots[i].id = guestUsers[guestIdx].id;
          roomSlots[i].name = guestUsers[guestIdx].name || "Friend";
          roomSlots[i].ready = true;
          guestIdx++;
        }
      }
    }

    // Filter active players
    const activeSlots = roomSlots.filter(s => s.type === "human" || s.type === "ai");
    if (activeSlots.length < 2) {
      throw new Error("Need at least 2 players to start a battle.");
    }

    // Assign symbols: A, B, C, D
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
    currentChannel.send({
      type: "broadcast",
      event: "game_start",
      payload: {
        roomId: currentRoomId,
        roster,
        battleNumber: 1
      }
    });

    if (onGameStartCallback) {
      onGameStartCallback({ roomId: currentRoomId, roster, battleNumber: 1 });
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

  function sendNextBattle(battleNum) {
    if (!currentChannel || !isRoomHost) return;
    currentChannel.send({
      type: "broadcast",
      event: "game_next",
      payload: {
        battleNumber: battleNum
      }
    });
  }

  function leaveRoom() {
    if (currentChannel) {
      try {
        currentChannel.unsubscribe();
      } catch {}
      currentChannel = null;
    }
    currentRoomId = null;
    isRoomHost = false;
    inGame = false;
    if (onRoomLeaveCallback) onRoomLeaveCallback();
  }

  function getLobbyState() {
    return {
      roomId: currentRoomId,
      isHost: isRoomHost,
      isOnline: Boolean(getClient()),
      myPlayerId,
      myPlayerName,
      myAssignedSlot,
      slots: roomSlots,
      inGame,
      shareUrl: currentRoomId ? `${window.location.origin}${window.location.pathname}?room=${currentRoomId}` : ""
    };
  }

  // Registration of callbacks
  function setCallbacks(callbacks = {}) {
    if (callbacks.onLobbyChange) onLobbyChangeCallback = callbacks.onLobbyChange;
    if (callbacks.onGameStart) onGameStartCallback = callbacks.onGameStart;
    if (callbacks.onRemoteMove) onRemoteMoveCallback = callbacks.onRemoteMove;
    if (callbacks.onRemoteNextBattle) onRemoteNextBattleCallback = callbacks.onRemoteNextBattle;
    if (callbacks.onRoomLeave) onRoomLeaveCallback = callbacks.onRoomLeave;
    if (callbacks.onStatusMessage) onStatusMessageCallback = callbacks.onStatusMessage;
  }

  // Export to global scope
  window.CaroMultiplayer = {
    init,
    isConfigured,
    getSavedCredentials,
    saveCredentials,
    generateRoomCode,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSlot,
    startGame,
    sendMove,
    sendNextBattle,
    getLobbyState,
    setCallbacks,
    get isHost() { return isRoomHost; },
    get isOnline() { return Boolean(getClient()); },
    get roomId() { return currentRoomId; },
    get inGame() { return inGame; },
    get myId() { return myPlayerId; },
    get myName() { return myPlayerName; },
    set myName(v) { myPlayerName = v; try { sessionStorage.setItem("caro_player_name", v); localStorage.setItem("caro_player_name", v); } catch {} }
  };

  init();
})();
