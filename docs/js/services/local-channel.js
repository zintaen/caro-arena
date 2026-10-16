/**
 * Caro Arena — Local BroadcastChannel Fallback Adapter (`window.LocalBroadcastChannelAdapter`)
 * Zero-build service module extracted from `multiplayer.js`.
 */
(function () {
  "use strict";

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

  window.LocalBroadcastChannelAdapter = LocalBroadcastChannelAdapter;
})();
