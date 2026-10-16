/**
 * Caro Arena — In-Browser Client Game Engine & Decision Models
 * Provides 100% standalone client-side execution for GitHub Pages / static hosting.
 */

const DIRECTIONS = [
  [0, 1],   // Horizontal
  [1, 0],   // Vertical
  [1, 1],   // Main diagonal \
  [1, -1],  // Anti-diagonal /
];

const PLAYERS = ["A", "B", "C", "D", "E"];

class CaroBoard {
  constructor(playerSymbolsOrSize, rule, maybeSymbols) {
    const symbols = Array.isArray(playerSymbolsOrSize)
      ? playerSymbolsOrSize
      : (Array.isArray(maybeSymbols) ? maybeSymbols : PLAYERS.slice(0, 4));
    this.playerSymbols = symbols.length >= 2 ? symbols.slice(0, PLAYERS.length) : PLAYERS.slice(0, 4);
    this.stones = new Map(); // "r,c" -> playerSymbol
    this.moves = [];
    this.eliminatedPlayers = [];
    this.placements = [];
    this.isDraw = false;
    this.currentPlayerIdx = 0;
  }

  get currentPlayer() {
    return this.playerSymbols[this.currentPlayerIdx];
  }

  getActivePlayers() {
    return this.playerSymbols.filter(p => !this.eliminatedPlayers.includes(p));
  }

  advanceTurn() {
    const active = this.getActivePlayers();
    if (!active.length) return;
    const n = this.playerSymbols.length;
    let idx = this.currentPlayerIdx;
    for (let i = 0; i < n; i++) {
      idx = (idx + 1) % n;
      if (active.includes(this.playerSymbols[idx])) {
        this.currentPlayerIdx = idx;
        break;
      }
    }
  }

  getOpponents(player) {
    return this.playerSymbols.filter(p => p !== player && !this.eliminatedPlayers.includes(p));
  }

  getCell(r, c) {
    return this.stones.get(`${r},${c}`) || ".";
  }

  isGameOver() {
    const total = this.playerSymbols.length;
    return this.placements.length >= total || this.isDraw || this.getActivePlayers().length <= 1;
  }

  isLegalMove(r, c) {
    if (this.isGameOver()) return false;
    return !this.stones.has(`${r},${c}`);
  }

  makeMove(r, c, player, metadata) {
    r = r || 0;
    c = c || 0;
    if (!this.isLegalMove(r, c)) return false;
    const current = player || this.currentPlayer;
    this.stones.set(`${r},${c}`, current);

    const moveRecord = {
      move_number: this.moves.length + 1,
      player: current,
      row: r,
      col: c,
      metadata: metadata || {}
    };
    this.moves.push(moveRecord);

    const winResult = this.checkWin(r, c, current);
    if (winResult.win) {
      const rank = this.placements.length + 1;
      this.placements.push({
        player: current,
        rank: rank,
        move_number: this.moves.length,
        winning_line: winResult.line
      });
      this.eliminatedPlayers.push(current);

      const active = this.getActivePlayers();
      if (active.length === 1) {
        const lastPlayer = active[0];
        this.placements.push({
          player: lastPlayer,
          rank: rank + 1,
          move_number: this.moves.length,
          winning_line: null
        });
        this.eliminatedPlayers.push(lastPlayer);
      }
    }

    if (!this.isGameOver()) {
      this.advanceTurn();
    }
    return true;
  }

  checkWin(r, c, player) {
    for (const [dr, dc] of DIRECTIONS) {
      const line = [[r, c]];

      let step = 1;
      while (true) {
        const nr = r + dr * step, nc = c + dc * step;
        if (this.getCell(nr, nc) === player) {
          line.push([nr, nc]);
          step++;
        } else {
          break;
        }
      }

      step = 1;
      while (true) {
        const nr = r - dr * step, nc = c - dc * step;
        if (this.getCell(nr, nc) === player) {
          line.unshift([nr, nc]);
          step++;
        } else {
          break;
        }
      }

      if (line.length >= 5) {
        return { win: true, line: line };
      }
    }
    return { win: false, line: null };
  }

  getCandidateMoves(maxDistance = 2) {
    if (this.stones.size === 0) return [[0, 0]];
    const candidates = new Set();
    for (const key of this.stones.keys()) {
      const [sr, sc] = key.split(",").map(Number);
      for (let dr = -maxDistance; dr <= maxDistance; dr++) {
        for (let dc = -maxDistance; dc <= maxDistance; dc++) {
          const candKey = `${sr + dr},${sc + dc}`;
          if (!this.stones.has(candKey)) {
            candidates.add(candKey);
          }
        }
      }
    }
    return Array.from(candidates).map(k => k.split(",").map(Number));
  }

  getBounds() {
    if (this.stones.size === 0) return { min_r: -5, max_r: 5, min_c: -5, max_c: 5 };
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const key of this.stones.keys()) {
      const [r, c] = key.split(",").map(Number);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    return { min_r: minR, max_r: maxR, min_c: minC, max_c: maxC };
  }

  toDict() {
    const stonesList = [];
    for (const [key, player] of this.stones.entries()) {
      const [r, c] = key.split(",").map(Number);
      stonesList.push({ row: r, col: c, player });
    }
    return {
      size: 0,
      rule: "standard",
      is_unlimited: true,
      bounds: this.getBounds(),
      moves: this.moves,
      stones: stonesList,
      current_player: this.currentPlayer,
      placements: this.placements,
      eliminated_players: this.eliminatedPlayers,
      active_players: this.getActivePlayers(),
      is_draw: this.isDraw,
      move_count: this.moves.length,
      last_move: this.moves.length ? this.moves[this.moves.length - 1] : null,
      player_count: this.playerSymbols.length
    };
  }
}

class TacticalEvaluator {
  static evaluateLinePattern(board, r, c, dr, dc, player) {
    let consecutive = 1;
    let posOpen = false;
    let step = 1;
    while (true) {
      const nr = r + dr * step, nc = c + dc * step;
      const cell = board.getCell(nr, nc);
      if (cell === player) { consecutive++; step++; }
      else if (cell === ".") { posOpen = true; break; }
      else break;
    }

    let negOpen = false;
    step = 1;
    while (true) {
      const nr = r - dr * step, nc = c - dc * step;
      const cell = board.getCell(nr, nc);
      if (cell === player) { consecutive++; step++; }
      else if (cell === ".") { negOpen = true; break; }
      else break;
    }

    const openEnds = (posOpen ? 1 : 0) + (negOpen ? 1 : 0);
    return { count: consecutive, open_ends: openEnds };
  }

  static evaluateMove(board, r, c, player, centroid) {
    board.stones.set(`${r},${c}`, player);
    const offPatterns = DIRECTIONS.map(([dr, dc]) => this.evaluateLinePattern(board, r, c, dr, dc, player));
    board.stones.delete(`${r},${c}`);

    let offScore = 0;
    const reasons = [];

    for (const p of offPatterns) {
      const cnt = p.count, ends = p.open_ends;
      if (cnt >= 5) { offScore += 500000; reasons.push("Immediate 5-in-a-row WIN"); }
      else if (cnt === 4 && ends === 2) { offScore += 50000; reasons.push("Creates Open 4 (unstoppable win)"); }
      else if (cnt === 4 && ends === 1) { offScore += 10000; reasons.push("Creates 4-in-a-row threat"); }
      else if (cnt === 3 && ends === 2) { offScore += 4000; reasons.push("Creates Open 3 attack"); }
      else if (cnt === 3 && ends === 1) { offScore += 800; reasons.push("Forms 3-in-a-row"); }
      else if (cnt === 2 && ends === 2) { offScore += 200; }
      else if (cnt === 2 && ends === 1) { offScore += 50; }
    }

    let defScore = 0;
    let hasImmediateBlock = false;
    let bestDefReasons = [];
    const opponents = board.getOpponents(player);

    for (const opp of opponents) {
      board.stones.set(`${r},${c}`, opp);
      const defPatterns = DIRECTIONS.map(([dr, dc]) => this.evaluateLinePattern(board, r, c, dr, dc, opp));
      board.stones.delete(`${r},${c}`);

      let oppDefScore = 0;
      let oppImmediate = false;
      const oppReasons = [];
      for (const p of defPatterns) {
        const cnt = p.count, ends = p.open_ends;
        if (cnt >= 5) { oppDefScore += 300000; oppImmediate = true; oppReasons.push("CRITICAL: Blocks opponent immediate 5-in-a-row"); }
        else if (cnt === 4 && ends >= 1) { oppDefScore += 40000; oppReasons.push("HIGH ALERT: Blocks opponent 4-in-a-row"); }
        else if (cnt === 3 && ends === 2) { oppDefScore += 15000; oppReasons.push("Defends against opponent Open 3 attack"); }
        else if (cnt === 3 && ends === 1) { oppDefScore += 600; oppReasons.push("Restricts opponent 3-stone line"); }
      }

      if (oppDefScore > defScore) {
        defScore = oppDefScore;
        hasImmediateBlock = oppImmediate;
        bestDefReasons = oppReasons;
      }
    }

    reasons.push(...bestDefReasons);

    const [cr, cc] = centroid;
    const dist = Math.sqrt((r - cr) ** 2 + (c - cc) ** 2);
    const posBonus = Math.max(0, 15.0 - dist * 1.5);

    // Multi-player (3+ players): weight defense (configurable via Sandbox, default 5%)
    // 2-player: full 100% defense
    const numOpponents = opponents.length || 1;
    const configuredWeight = (typeof window !== "undefined" && window.CaroSandboxConfig && typeof window.CaroSandboxConfig.defenseWeight === "number")
      ? window.CaroSandboxConfig.defenseWeight
      : 0.05;
    const defWeight = numOpponents >= 2 ? configuredWeight : 1.0;
    let weightedDef = defScore * defWeight;
    if (hasImmediateBlock && weightedDef < 30000) {
      weightedDef = 30000;
    }
    const totalScore = offScore + weightedDef + posBonus;

    let summary = "";
    if (!reasons.length) {
      summary = dist <= 2.5 ? "Clustered positional control" : "Expanding line scope";
    } else {
      summary = reasons.slice(0, 2).join("; ");
    }

    return {
      row: r, col: c,
      off_score: offScore, def_score: defScore,
      total_score: Math.round(totalScore * 10) / 10,
      summary: summary
    };
  }

  static findThreatLines(board) {
    // Detects dangerous 3-in-a-row and 4-in-a-row alignments for laser vectors and radar overlay
    const threats = [];
    const active = board.getActivePlayers();
    for (const [key, player] of board.stones.entries()) {
      if (!active.includes(player)) continue;
      const [r, c] = key.split(",").map(Number);
      for (const [dr, dc] of DIRECTIONS) {
        if (board.getCell(r - dr, c - dc) === player) continue; // Start of line only
        const line = [[r, c]];
        let step = 1;
        while (board.getCell(r + dr * step, c + dc * step) === player) {
          line.push([r + dr * step, c + dc * step]);
          step++;
        }
        if (line.length >= 3) {
          const frontOpen = board.getCell(r - dr, c - dc) === ".";
          const backOpen = board.getCell(r + dr * step, c + dc * step) === ".";
          const openEnds = (frontOpen ? 1 : 0) + (backOpen ? 1 : 0);
          const targets = [];
          if (frontOpen) targets.push([r - dr, c - dc]);
          if (backOpen) targets.push([r + dr * step, c + dc * step]);

          if (line.length >= 4 && openEnds >= 1) {
            threats.push({ player, line, count: line.length, severity: "critical", openEnds, targets, dr, dc });
          } else if (line.length === 3 && openEnds >= 1) {
            threats.push({ player, line, count: 3, severity: openEnds === 2 ? "warning" : "minor", openEnds, targets, dr, dc });
          } else if (line.length === 2 && openEnds === 2) {
            threats.push({ player, line, count: 2, severity: "tactical", openEnds, targets, dr, dc });
          }
        }
      }
    }
    return threats;
  }

  static getThreatHeatmap(board, player) {
    const raw = board.getCandidateMoves(2);
    if (!raw.length || board.stones.size === 0) return [];
    let sumR = 0, sumC = 0;
    for (const key of board.stones.keys()) {
      const [r, c] = key.split(",").map(Number);
      sumR += r; sumC += c;
    }
    const centroid = [sumR / board.stones.size, sumC / board.stones.size];
    const scored = raw.map(([r, c]) => {
      const evalRes = this.evaluateMove(board, r, c, player, centroid);
      // Raw tactical pressure combines total offensive + defensive stakes on this cell
      const pressure = evalRes.off_score + evalRes.def_score;
      return {
        row: r, col: c,
        pressure: pressure,
        off_score: evalRes.off_score,
        def_score: evalRes.def_score,
        summary: evalRes.summary
      };
    });

    // Filter to cells with meaningful tactical tension (at least 2-stone connection or threat)
    const threats = scored.filter(s => s.pressure >= 150);
    threats.sort((a, b) => b.pressure - a.pressure);

    // Keep top 10 hottest tactical zones
    const topThreats = threats.slice(0, 10);
    if (topThreats.length === 0) return [];

    const maxPressure = Math.max(200, topThreats[0].pressure);
    return topThreats.map((s, idx) => ({
      row: s.row, col: s.col,
      total_score: s.pressure,
      rank: idx + 1,
      intensity: Math.min(1.0, Math.max(0.25, Math.log10(s.pressure + 10) / Math.log10(maxPressure + 10))),
      isWinThreat: s.pressure >= 100000,
      isLethal: s.pressure >= 10000,
      isWarning: s.pressure >= 2000,
      summary: s.summary
    }));
  }

  static getRankedCandidates(board, player, topK = 8) {
    const raw = board.getCandidateMoves(2);
    if (!raw.length || board.stones.size === 0) {
      return [{ row: 0, col: 0, off_score: 0, def_score: 0, total_score: 10.0, summary: "Opening at origin (0, 0)" }];
    }

    let sumR = 0, sumC = 0;
    for (const key of board.stones.keys()) {
      const [r, c] = key.split(",").map(Number);
      sumR += r; sumC += c;
    }
    const centroid = [sumR / board.stones.size, sumC / board.stones.size];

    const scored = raw.map(([r, c]) => this.evaluateMove(board, r, c, player, centroid));
    scored.sort((a, b) => b.total_score - a.total_score);
    return scored.slice(0, topK);
  }
}

// ─────────────────────────────────────────
// Client Decision Model Agents
// ─────────────────────────────────────────
class BaseClientAgent {
  constructor(name, modelLabel) {
    this.name = name;
    this.modelLabel = modelLabel;
  }

  getOpeningResponse(board) {
    const neighbors = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    const [dr, dc] = neighbors[Math.floor(Math.random() * neighbors.length)];
    const m0 = board.moves[0];
    const r = m0.row + dr, c = m0.col + dc;
    return {
      row: r, col: c,
      latency_ms: Math.round(5 + Math.random() * 8),
      model: this.modelLabel,
      reasoning: `Opening adjacent response at (${r}, ${c})`,
      candidates: [{ row: r, col: c, probability: 1.0, summary: "Opening response" }]
    };
  }

  chooseMove(board, player) {
    const startTime = performance.now();
    if (board.moves.length === 0) {
      return {
        row: 0, col: 0,
        latency_ms: Math.round(4 + Math.random() * 6),
        model: this.modelLabel,
        reasoning: "Origin (0, 0) opening control",
        candidates: [{ row: 0, col: 0, probability: 1.0, summary: "Origin opening" }]
      };
    }
    if (board.moves.length === 1) {
      return this.getOpeningResponse(board);
    }

    const candidates = TacticalEvaluator.getRankedCandidates(board, player, 8);
    const isCritical = candidates.length && candidates[0].total_score >= 20000;

    let chosen = candidates[0];
    const totalScore = candidates.reduce((acc, c) => acc + Math.max(1, c.total_score), 0);
    const probs = candidates.map(c => Math.max(1, c.total_score) / totalScore);

    if (!isCritical && candidates.length > 1) {
      // Softmax sampling with temperature based on agent personality
      const temp = this.temperature || 0.45;
      const expWeights = probs.map(p => Math.pow(Math.max(1e-4, p), 1 / temp));
      const sumExp = expWeights.reduce((a, b) => a + b, 0);
      const normWeights = expWeights.map(w => w / sumExp);

      let rVal = Math.random();
      for (let i = 0; i < normWeights.length; i++) {
        rVal -= normWeights[i];
        if (rVal <= 0) {
          chosen = candidates[i];
          break;
        }
      }
    }

    const latency = performance.now() - startTime + (this.baseLatency || 12);
    return {
      row: chosen.row,
      col: chosen.col,
      latency_ms: Math.round(latency),
      model: this.modelLabel,
      reasoning: chosen.summary,
      candidates: candidates.map((c, i) => ({
        row: c.row, col: c.col,
        probability: Math.round(probs[i] * 100) / 100,
        summary: c.summary,
        tactical_score: c.total_score
      }))
    };
  }
}

class LayaAgent extends BaseClientAgent {
  constructor(name) { super(name, "Convai Laya (System 1)"); this.temperature = 0.40; this.baseLatency = 18; }
}
class JevAgent extends BaseClientAgent {
  constructor(name) { super(name, "TypeSafe Jev"); this.temperature = 0.25; this.baseLatency = 8; }
}
class VonAgent extends BaseClientAgent {
  constructor(name) { super(name, "Von (ModernBERT)"); this.temperature = 0.35; this.baseLatency = 14; }
}
class MoJevAgent extends BaseClientAgent {
  constructor(name) { super(name, "MoJev"); this.temperature = 0.50; this.baseLatency = 10; }
}

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
      player_order: battle.player_order || [],
      placements: (battle.placements || []).map(p => ({
        rank: p.rank,
        type: p.type,
        player: p.player,
        symbol: p.symbol || p.player,
        name: p.name,
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
    } catch (e) {
      console.warn("ClientStorage: Failed to save battle without blocking game", e);
    }
  }

  static deleteBattle(battleId) {
    if (!battleId) return;
    try {
      const list = this.getBattles().filter(b => b.battle_id !== battleId);
      localStorage.setItem("caro_arena_battles", JSON.stringify(list));
      const summaries = this.getBattleSummaries().filter(s => s.battle_id !== battleId);
      localStorage.setItem("caro_arena_battle_summaries", JSON.stringify(summaries));
      this.updateLeaderboard();
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

  static clearHistory() {
    try {
      localStorage.removeItem("caro_arena_battles");
      localStorage.removeItem("caro_arena_battle_summaries");
      localStorage.removeItem("caro_arena_leaderboard");
    } catch {}
  }
}

// ─────────────────────────────────────────
// Client Game Manager
// ─────────────────────────────────────────
class ClientGameManager {
  constructor() {
    this.gameId = Math.random().toString(36).substring(2, 10);
    this.startedAt = Date.now();
    this.endedAt = null;
    this.board = null;
    this.players = [];
    this.status = "ready";
    this.isAutoPlaying = false;
    this.nonStop = false;
    this.autoDelaySec = 0.02;
    this.battleNumber = 1;
    this.selectedPlayerTypes = ["laya", "jev", "von", "mojev"];
    this.isThinking = false;
    this.thinkingPlayer = null;
    this.lastMoveDetails = null;
    this.onStateChange = null;
    this.autoPlayTimer = null;

    this.newGame();
  }

  createAgent(ptype, colorName) {
    if (ptype === "laya") return new LayaAgent(`Laya (${colorName})`);
    if (ptype === "jev") return new JevAgent(`Jev (${colorName})`);
    if (ptype === "von") return new VonAgent(`Von (${colorName})`);
    if (ptype === "mojev") return new MoJevAgent(`MoJev (${colorName})`);
    return null;
  }

  newGame(playerTypes, shouldShuffle = true, playerConfigs = null) {
    if (this.status === "finished" && !playerConfigs) {
      this.battleNumber += 1;
    }
    if (playerTypes) this.selectedPlayerTypes = playerTypes;
    this.gameId = Math.random().toString(36).substring(2, 10);
    this.startedAt = Date.now();
    this.endedAt = null;

    const types = [...this.selectedPlayerTypes];
    if (shouldShuffle) {
      for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
      }
    }

    const symbols = PLAYERS.slice(0, types.length);
    this.players = types.map((ptype, i) => {
      const symbol = symbols[i];
      const agent = ptype === "human" ? null : this.createAgent(ptype, symbol);
      const cfg = playerConfigs ? playerConfigs.find(c => c.symbol === symbol || c.slotIndex === i) : null;
      const defaultName = agent ? agent.name : (ptype === "human" ? "Human" : ptype.toUpperCase());
      return {
        type: ptype,
        name: (cfg && cfg.name) ? cfg.name : defaultName,
        agent: agent,
        symbol: symbol
      };
    });

    this.board = new CaroBoard(symbols);
    this.status = "ready";
    this.isThinking = false;
    this.thinkingPlayer = null;
    this.lastMoveDetails = null;

    if (this.onStateChange) this.onStateChange(this.getState());
    return this.getState();
  }

  getCurrentPlayerInfo() {
    const curr = this.board.currentPlayer;
    return this.players.find(p => p.symbol === curr) || null;
  }

  isHumanTurn() {
    if (this.status === "finished" || !this.board) return false;
    const info = this.getCurrentPlayerInfo();
    return info !== null && info.type === "human" && !info.agent;
  }

  hasHumanPlayer() {
    return this.players.some(p => p.type === "human");
  }

  playMove(r, c, meta) {
    const curr = this.board.currentPlayer;
    const success = this.board.makeMove(r, c, curr, meta);
    if (success) {
      this.lastMoveDetails = {
        player: curr,
        player_name: this.players.find(p => p.symbol === curr)?.name || curr,
        row: r, col: c,
        meta: meta || {}
      };

      // Audio feedback
      const pInfo = this.players.find(p => p.symbol === curr);
      if (typeof window !== "undefined" && window.CaroAudio) {
        window.CaroAudio.playStoneClick(pInfo?.type || "ai");
        const newPl = this.board.placements[this.board.placements.length - 1];
        if (newPl && newPl.move_number === this.board.moves.length && newPl.winning_line) {
          window.CaroAudio.playWinChime(newPl.rank);
          window.CaroAudio.playLaserSweep();
        }
      }

      if (this.board.isGameOver()) {
        this.status = "finished";
        this.endedAt = Date.now();
        this.persistGame();
      } else {
        this.status = "playing";
      }
    }
    return success;
  }

  undoHumanMove(targetSymbol = null) {
    if (!this.board || this.board.moves.length === 0) return false;
    let lastHumanIdx = -1;
    for (let i = this.board.moves.length - 1; i >= 0; i--) {
      const m = this.board.moves[i];
      const p = this.players.find(pl => pl.symbol === m.player);
      if (p && p.type === "human" && (!targetSymbol || m.player === targetSymbol)) {
        lastHumanIdx = i;
        break;
      }
    }
    if (lastHumanIdx === -1) return false;

    if (this.status === "finished") {
      ClientStorage.deleteBattle(this.gameId);
    }

    const keepMoves = this.board.moves.slice(0, lastHumanIdx);
    const symbols = this.players.map(p => p.symbol);
    this.board = new CaroBoard(symbols);
    for (const m of keepMoves) {
      this.board.makeMove(m.row, m.col, m.player, m.metadata);
    }
    this.status = keepMoves.length ? "playing" : "ready";
    this.endedAt = null;
    if (keepMoves.length) {
      const last = keepMoves[keepMoves.length - 1];
      this.lastMoveDetails = {
        player: last.player,
        player_name: this.players.find(p => p.symbol === last.player)?.name || last.player,
        row: last.row,
        col: last.col,
        meta: last.metadata || {}
      };
    } else {
      this.lastMoveDetails = null;
    }
    if (this.onStateChange) this.onStateChange(this.getState());
    return true;
  }

  humanMove(r, c) {
    if (!this.isHumanTurn()) return null;
    const meta = { row: r, col: c, latency_ms: 0, reasoning: "Human move" };
    const success = this.playMove(r, c, meta);
    if (!success) return null;

    if (this.onStateChange) this.onStateChange(this.getState());

    // If game continues and next is AI, resume auto-play step
    if (this.status !== "finished" && !this.isHumanTurn() && this.isAutoPlaying) {
      this.scheduleNextStep();
    }
    return this.getState();
  }

  step() {
    if (this.status === "finished" || this.isHumanTurn()) return this.getState();
    const info = this.getCurrentPlayerInfo();
    if (!info || !info.agent) return this.getState();

    const agent = info.agent;
    const currSymbol = info.symbol;
    this.isThinking = true;
    this.thinkingPlayer = info.name;

    try {
      const moveInfo = agent.chooseMove(this.board, currSymbol);
      this.playMove(moveInfo.row, moveInfo.col, moveInfo);
    } finally {
      this.isThinking = false;
      this.thinkingPlayer = null;
    }

    if (this.onStateChange) this.onStateChange(this.getState());
    return this.getState();
  }

  persistGame() {
    try {
      const playerOrder = this.players.map(p => ({ type: p.type, symbol: p.symbol, name: p.name }));
      const placements = this.board.placements.map(pl => {
        const pObj = this.players.find(p => p.symbol === pl.player);
        const ptype = pObj?.type || "unknown";
        return {
          symbol: pl.player,
          type: ptype,
          name: pObj?.name || pl.player,
          rank: pl.rank,
          move_number: pl.move_number,
          winning_line: pl.winning_line
        };
      });

      const battleRecord = {
        battle_id: this.gameId,
        started_at: this.startedAt / 1000,
        ended_at: (this.endedAt || Date.now()) / 1000,
        player_order: playerOrder,
        placements: placements,
        total_moves: this.board.moves.length,
        duration_sec: ((this.endedAt || Date.now()) - this.startedAt) / 1000,
        moves_data: this.board.moves
      };

      ClientStorage.saveBattle(battleRecord);
    } catch (err) {
      console.warn("ClientGameManager: persistGame non-fatal error", err);
    }
  }

  toggleAutoPlay(enabled, delaySec = 0.01) {
    this.isAutoPlaying = enabled;
    this.autoDelaySec = 0.01; // Always fastest blitz speed (10ms)
    if (this.autoPlayTimer) { clearTimeout(this.autoPlayTimer); this.autoPlayTimer = null; }

    if (enabled) {
      this.scheduleNextStep();
    }
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  scheduleNextStep() {
    if (!this.isAutoPlaying) return;
    if (this.status === "finished") {
      this.isAutoPlaying = false;
      if (this.nonStop) {
        // In non-stop mode, wait 1.2s to show victory line then start next battle!
        this.autoPlayTimer = setTimeout(() => {
          this.newGame(this.selectedPlayerTypes);
          this.isAutoPlaying = true;
          this.scheduleNextStep();
          if (this.onStateChange) this.onStateChange(this.getState());
        }, 1200);
      } else {
        if (this.onStateChange) this.onStateChange(this.getState());
      }
      return;
    }

    if (this.isHumanTurn()) {
      // Waiting for human click
      return;
    }

    this.autoPlayTimer = setTimeout(() => {
      if (!this.isAutoPlaying) return;
      this.step();
      this.scheduleNextStep();
    }, this.autoDelaySec * 1000);
  }

  getState() {
    const currSymbol = this.board.currentPlayer;
    const currPlayer = this.players.find(p => p.symbol === currSymbol);
    return {
      game_id: this.gameId,
      status: this.status,
      is_auto_playing: this.isAutoPlaying,
      non_stop: this.nonStop,
      auto_delay_sec: this.autoDelaySec,
      board: this.board.toDict(),
      players: this.players.map(p => ({ type: p.type, name: p.name, symbol: p.symbol })),
      current_player: {
        type: currPlayer ? currPlayer.type : null,
        name: currPlayer ? currPlayer.name : null,
        symbol: currSymbol
      },
      is_thinking: this.isThinking,
      thinking_player: this.thinkingPlayer,
      last_move_details: this.lastMoveDetails,
      is_human_turn: this.isHumanTurn(),
      has_human: this.hasHumanPlayer(),
      series: {
        battle_number: this.battleNumber
      }
    };
  }
}

window.CaroEngine = {
  CaroBoard,
  TacticalEvaluator,
  ClientStorage,
  ClientGameManager
};

