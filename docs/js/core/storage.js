/**
 * Caro Arena — Client Storage, Leaderboard, Puzzle Streaks & Career H2H Stats
 */

// ─────────────────────────────────────────
// Client Storage (localStorage)
// ─────────────────────────────────────────
class ClientStorage {
  static getBattles() {
    try {
      const raw = localStorage.getItem("caro_arena_battles");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static getBattleSummaries() {
    try {
      const raw = localStorage.getItem("caro_arena_battle_summaries");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
      // Initialize chronologically (oldest to newest) from existing battles if summaries not yet stored
      const existing = [...this.getBattles()].reverse();
      return existing.map(b => ({
        battle_id: b.battle_id,
        started_at: b.started_at,
        placements: (b.placements || []).map(p => ({ type: p.type, rank: p.rank }))
      }));
    } catch {
      return [];
    }
  }

  static getTotalBattlesCount() {
    return this.getBattleSummaries().length;
  }

  static getSupabaseClient() {
    try {
      return (typeof window !== "undefined" && window.CaroMultiplayer?.getClient)
        ? window.CaroMultiplayer.getClient()
        : null;
    } catch {
      return null;
    }
  }

  static isCloudSyncEnabled() {
    try {
      if (typeof window === "undefined") return false;
      if (window.CARO_DISABLE_CLOUD_STORAGE) return false;
      if (window.CARO_FORCE_CLOUD_SYNC) return Boolean(this.getSupabaseClient());
      if (typeof navigator !== "undefined" && navigator.webdriver) return false;
      return Boolean(this.getSupabaseClient());
    } catch {
      return false;
    }
  }

  static sanitizeBattle(battle) {
    if (!battle) return null;
    const rawMoves = battle.moves_data || battle.moves || [];
    const sanitizedMoves = rawMoves.map(m => ({
      row: m.row !== undefined ? m.row : m.r,
      col: m.col !== undefined ? m.col : m.c,
      player: m.player || m.p,
      move_number: m.move_number || m.n
    }));
    return {
      battle_id: battle.battle_id || ("b_" + Math.random().toString(36).substring(2, 8)),
      total_moves: battle.total_moves || sanitizedMoves.length,
      started_at: battle.started_at,
      ended_at: battle.ended_at,
      is_multiplayer: Boolean(battle.is_multiplayer),
      room_code: battle.room_code || null,
      player_order: battle.player_order || [],
      placements: (battle.placements || []).map(p => ({
        rank: p.rank,
        type: p.type,
        player: p.player,
        symbol: p.symbol || p.player,
        name: p.name,
        move_number: p.move_number || null,
        winning_line: p.winning_line ? p.winning_line.slice() : null
      })),
      moves_data: sanitizedMoves
    };
  }

  static saveBattle(battle) {
    try {
      const clean = this.sanitizeBattle(battle);
      if (!clean) return;

      // 1. Save lightweight summary chronologically so leaderboard never loses history past 20 battles
      const summaries = this.getBattleSummaries().filter(s => s.battle_id !== clean.battle_id);
      summaries.push({
        battle_id: clean.battle_id,
        started_at: clean.started_at,
        placements: (clean.placements || []).map(p => ({ type: p.type, rank: p.rank }))
      });
      try {
        localStorage.setItem("caro_arena_battle_summaries", JSON.stringify(summaries));
      } catch {}

      // 2. Save full replay record (keep maximum 20 battles to prevent localStorage quota bloat)
      let list = this.getBattles().filter(b => b.battle_id !== clean.battle_id);
      list.unshift(clean);

      if (list.length > 20) {
        list = list.slice(0, 20);
      }

      // Safe saving with progressive fallback if quota is exceeded
      let saved = false;
      while (list.length > 0 && !saved) {
        try {
          localStorage.setItem("caro_arena_battles", JSON.stringify(list));
          saved = true;
        } catch (e) {
          if (list.length <= 1) {
            try { localStorage.removeItem("caro_arena_battles"); } catch {}
            break;
          }
          list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
        }
      }

      this.updateLeaderboard();

      // 3. Persist to Supabase (`caro_arena_battles` + `caro_arena_leaderboard`) asynchronously
      if (this.isCloudSyncEnabled()) {
        this.syncBattleToSupabase(clean).catch(() => {});
      }
    } catch (e) {
      console.warn("ClientStorage: Failed to save battle without blocking game", e);
    }
  }

  static async syncBattleToSupabase(cleanBattle) {
    const client = this.getSupabaseClient();
    if (!client || !cleanBattle) return false;
    try {
      const row = {
        battle_id: cleanBattle.battle_id,
        started_at: Number(cleanBattle.started_at) || (Date.now() / 1000),
        ended_at: Number(cleanBattle.ended_at) || (Date.now() / 1000),
        total_moves: Number(cleanBattle.total_moves) || 0,
        is_multiplayer: Boolean(cleanBattle.is_multiplayer),
        room_code: cleanBattle.room_code || null,
        player_order: cleanBattle.player_order || [],
        placements: cleanBattle.placements || [],
        moves_data: cleanBattle.moves_data || []
      };
      await client.from("caro_arena_battles").upsert(row, { onConflict: "battle_id" });

      const lb = this.getLeaderboard();
      if (Array.isArray(lb) && lb.length > 0) {
        const lbRows = lb.map(item => ({
          player_type: item.player_type,
          total_points: Number(item.total_points) || 0,
          battles_played: Number(item.battles_played) || 0,
          wins: Number(item.wins) || 0,
          avg_placement: Number(item.avg_placement) || 0,
          best_streak: Number(item.best_streak) || 0,
          updated_at: new Date().toISOString()
        }));
        await client.from("caro_arena_leaderboard").upsert(lbRows, { onConflict: "player_type" });
      }
      return true;
    } catch (e) {
      console.warn("ClientStorage: Supabase sync error", e);
      return false;
    }
  }

  static async pullFromSupabase(limit = 20) {
    if (!this.isCloudSyncEnabled()) {
      return { battles: this.getBattles(), leaderboard: this.getLeaderboard() };
    }
    const client = this.getSupabaseClient();
    if (!client) {
      return { battles: this.getBattles(), leaderboard: this.getLeaderboard() };
    }
    try {
      const { data: remoteBattles, error: bErr } = await client
        .from("caro_arena_battles")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);

      if (!bErr && Array.isArray(remoteBattles) && remoteBattles.length > 0) {
        const localBattles = this.getBattles();
        const mergedMap = new Map();
        for (const b of localBattles) {
          if (b && b.battle_id) mergedMap.set(b.battle_id, b);
        }
        for (const rb of remoteBattles) {
          const clean = this.sanitizeBattle(rb);
          if (clean && clean.battle_id && !mergedMap.has(clean.battle_id)) {
            mergedMap.set(clean.battle_id, clean);
          }
        }
        const mergedList = Array.from(mergedMap.values())
          .sort((a, b) => (Number(b.started_at) || 0) - (Number(a.started_at) || 0))
          .slice(0, 20);
        try {
          localStorage.setItem("caro_arena_battles", JSON.stringify(mergedList));
        } catch {}

        // Merge into chronological summaries as well
        const summaries = this.getBattleSummaries();
        const sumMap = new Map();
        for (const s of summaries) {
          if (s && s.battle_id) sumMap.set(s.battle_id, s);
        }
        for (const rb of remoteBattles) {
          if (rb && rb.battle_id && !sumMap.has(rb.battle_id)) {
            sumMap.set(rb.battle_id, {
              battle_id: rb.battle_id,
              started_at: rb.started_at,
              placements: (rb.placements || []).map(p => ({ type: p.type, rank: p.rank }))
            });
          }
        }
        const mergedSummaries = Array.from(sumMap.values())
          .sort((a, b) => (Number(a.started_at) || 0) - (Number(b.started_at) || 0));
        try {
          localStorage.setItem("caro_arena_battle_summaries", JSON.stringify(mergedSummaries));
        } catch {}

        this.updateLeaderboard();
      } else if (this.getLeaderboard().length === 0) {
        // Fallback: if no battles in local storage yet, check caro_arena_leaderboard table
        const { data: remoteLb, error: lbErr } = await client
          .from("caro_arena_leaderboard")
          .select("*")
          .order("total_points", { ascending: false });
        if (!lbErr && Array.isArray(remoteLb) && remoteLb.length > 0) {
          try {
            localStorage.setItem("caro_arena_leaderboard", JSON.stringify(remoteLb));
          } catch {}
        }
      }
    } catch (e) {
      console.warn("ClientStorage: Failed to pull from Supabase", e);
    }
    return { battles: this.getBattles(), leaderboard: this.getLeaderboard() };
  }

  static async fetchBattleByIdFromSupabase(battleId) {
    if (!battleId) return null;
    const client = this.getSupabaseClient();
    if (!client) return null;
    try {
      const { data, error } = await client
        .from("caro_arena_battles")
        .select("*")
        .eq("battle_id", battleId)
        .maybeSingle();
      if (!error && data) {
        return this.sanitizeBattle(data);
      }
    } catch {}
    return null;
  }

  static deleteBattle(battleId) {
    if (!battleId) return;
    try {
      const list = this.getBattles().filter(b => b.battle_id !== battleId);
      localStorage.setItem("caro_arena_battles", JSON.stringify(list));
      const summaries = this.getBattleSummaries().filter(s => s.battle_id !== battleId);
      localStorage.setItem("caro_arena_battle_summaries", JSON.stringify(summaries));
      this.updateLeaderboard();
      if (this.isCloudSyncEnabled()) {
        const client = this.getSupabaseClient();
        if (client) {
          client.from("caro_arena_battles").delete().eq("battle_id", battleId).then(() => {}).catch(() => {});
        }
      }
    } catch {}
  }

  static getLeaderboard() {
    try {
      const raw = localStorage.getItem("caro_arena_leaderboard");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static updateLeaderboard() {
    try {
      const statsMap = {};
      // Iterate in chronological order (oldest -> newest) across all recorded battle summaries
      const summaries = this.getBattleSummaries();
      for (const b of summaries) {
        const placements = b.placements || [];
        const totalP = placements.length;
        const seenInBattle = new Set();
        const sortedPlacements = [...placements].sort((x, y) => (x.rank || 999) - (y.rank || 999));

        for (const pl of sortedPlacements) {
          const ptype = pl.type;
          if (!ptype || seenInBattle.has(ptype)) continue;
          seenInBattle.add(ptype);

          const rank = pl.rank;
          if (!statsMap[ptype]) {
            statsMap[ptype] = { points: 0, battles: 0, wins: 0, ranks_sum: 0, best_streak: 0, current_streak: 0 };
          }
          statsMap[ptype].battles++;
          statsMap[ptype].ranks_sum += rank;
          const pts = Math.max(1, totalP - rank + 1);
          statsMap[ptype].points += pts;
          if (rank === 1) {
            statsMap[ptype].wins++;
            statsMap[ptype].current_streak++;
            if (statsMap[ptype].current_streak > statsMap[ptype].best_streak) {
              statsMap[ptype].best_streak = statsMap[ptype].current_streak;
            }
          } else {
            statsMap[ptype].current_streak = 0;
          }
        }
      }

      const res = Object.entries(statsMap).map(([ptype, s]) => ({
        player_type: ptype,
        total_points: s.points,
        battles_played: s.battles,
        wins: s.wins,
        avg_placement: s.battles > 0 ? Math.round((s.ranks_sum / s.battles) * 10) / 10 : 0,
        best_streak: s.best_streak
      }));

      // Sort: points DESC, wins DESC, avg_placement ASC, battles DESC
      res.sort((a, b) => {
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.avg_placement !== b.avg_placement) return a.avg_placement - b.avg_placement;
        return b.battles_played - a.battles_played;
      });

      try {
        localStorage.setItem("caro_arena_leaderboard", JSON.stringify(res));
      } catch {}
    } catch (e) {
      console.warn("ClientStorage: Failed to update leaderboard", e);
    }
  }

  static getPuzzleStats() {
    try {
      const raw = localStorage.getItem("caro_arena_puzzle_stats");
      if (!raw) return { streak: 0, totalSolved: 0, lastSolvedDate: null, solvedIds: [] };
      const parsed = JSON.parse(raw);
      return {
        streak: Number(parsed.streak) || 0,
        totalSolved: Number(parsed.totalSolved) || 0,
        lastSolvedDate: parsed.lastSolvedDate || null,
        solvedIds: Array.isArray(parsed.solvedIds) ? parsed.solvedIds : []
      };
    } catch {
      return { streak: 0, totalSolved: 0, lastSolvedDate: null, solvedIds: [] };
    }
  }

  static recordPuzzleSolved(puzzleId) {
    try {
      const stats = this.getPuzzleStats();
      const today = new Date().toISOString().slice(0, 10);
      let isNewSolve = false;
      if (!stats.solvedIds.includes(puzzleId)) {
        stats.solvedIds.push(puzzleId);
        stats.totalSolved += 1;
        isNewSolve = true;
      }
      if (stats.lastSolvedDate !== today) {
        stats.streak += 1;
        stats.lastSolvedDate = today;
        isNewSolve = true;
      } else if (stats.streak === 0) {
        stats.streak = 1;
      }
      localStorage.setItem("caro_arena_puzzle_stats", JSON.stringify(stats));
      return { stats, isNewSolve, rewardCranes: 15 };
    } catch {
      return { stats: { streak: 1, totalSolved: 1, lastSolvedDate: null, solvedIds: [puzzleId] }, isNewSolve: true, rewardCranes: 15 };
    }
  }

  static getCareerStats() {
    const vsAi = {
      laya: { label: "Laya", wins: 0, losses: 0, played: 0 },
      jev: { label: "Jev", wins: 0, losses: 0, played: 0 },
      von: { label: "Von", wins: 0, losses: 0, played: 0 },
      mojev: { label: "MoJev", wins: 0, losses: 0, played: 0 }
    };
    let humanBattles = 0;
    let humanWins = 0;
    let fastestWinMoves = null;

    const battles = this.getBattles();
    const seenIds = new Set();

    const processBattle = (b) => {
      if (!b || !b.battle_id || seenIds.has(b.battle_id)) return;
      seenIds.add(b.battle_id);
      const placements = Array.isArray(b.placements) ? b.placements : [];
      const humanPl = placements.find(p => p && p.type === "human");
      if (!humanPl) return;
      humanBattles += 1;
      const humanRank = Number(humanPl.rank) || 99;
      if (humanRank === 1) {
        humanWins += 1;
        const mNum = Number(humanPl.move_number) || Number(b.total_moves) || 0;
        if (mNum > 0 && (fastestWinMoves === null || mNum < fastestWinMoves)) {
          fastestWinMoves = mNum;
        }
      }
      const seenAiInMatch = new Set();
      for (const pl of placements) {
        if (!pl || !vsAi[pl.type] || seenAiInMatch.has(pl.type)) continue;
        seenAiInMatch.add(pl.type);
        vsAi[pl.type].played += 1;
        const aiRank = Number(pl.rank) || 99;
        if (humanRank < aiRank) {
          vsAi[pl.type].wins += 1;
        } else if (aiRank < humanRank) {
          vsAi[pl.type].losses += 1;
        }
      }
    };

    for (const b of battles) processBattle(b);
    for (const s of this.getBattleSummaries()) processBattle(s);

    const puzzleStats = this.getPuzzleStats();
    const winRatePct = humanBattles > 0 ? Math.round((humanWins / humanBattles) * 100) : 0;
    const totalBattles = this.getTotalBattlesCount ? this.getTotalBattlesCount() : battles.length;
    const modelNames = { von: "Von", mojev: "MoJev", laya: "Laya", jev: "Jev" };
    for (const k of Object.keys(vsAi)) {
      vsAi[k].name = modelNames[k] || k;
    }
    return {
      totalBattles,
      humanBattles,
      humanMatches: humanBattles,
      humanWins,
      winRatePct,
      winRate: winRatePct,
      fastestWinMoves,
      vsAi,
      puzzleStreak: puzzleStats.streak,
      puzzlesSolved: puzzleStats.totalSolved
    };
  }

  static clearHistory() {
    try {
      localStorage.removeItem("caro_arena_battles");
      localStorage.removeItem("caro_arena_battle_summaries");
      localStorage.removeItem("caro_arena_leaderboard");
      if (this.isCloudSyncEnabled()) {
        const client = this.getSupabaseClient();
        if (client) {
          client.from("caro_arena_battles").delete().neq("battle_id", "").then(() => {}).catch(() => {});
          client.from("caro_arena_leaderboard").delete().neq("player_type", "").then(() => {}).catch(() => {});
        }
      }
    } catch {}
  }
}

