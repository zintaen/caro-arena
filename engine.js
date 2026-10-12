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
  constructor(playerSymbols) {
    this.playerSymbols = playerSymbols || PLAYERS.slice(0, 4);
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
    let bestDefReasons = [];
    const opponents = board.getOpponents(player);

    for (const opp of opponents) {
      board.stones.set(`${r},${c}`, opp);
      const defPatterns = DIRECTIONS.map(([dr, dc]) => this.evaluateLinePattern(board, r, c, dr, dc, opp));
      board.stones.delete(`${r},${c}`);

      let oppDefScore = 0;
      const oppReasons = [];
      for (const p of defPatterns) {
        const cnt = p.count, ends = p.open_ends;
        if (cnt >= 5) { oppDefScore += 300000; oppReasons.push("CRITICAL: Blocks opponent immediate 5-in-a-row"); }
        else if (cnt === 4 && ends >= 1) { oppDefScore += 40000; oppReasons.push("HIGH ALERT: Blocks opponent 4-in-a-row"); }
        else if (cnt === 3 && ends === 2) { oppDefScore += 15000; oppReasons.push("Defends against opponent Open 3 attack"); }
        else if (cnt === 3 && ends === 1) { oppDefScore += 600; oppReasons.push("Restricts opponent 3-stone line"); }
      }

      if (oppDefScore > defScore) {
        defScore = oppDefScore;
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
    const totalScore = offScore + defScore * defWeight + posBonus;

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
    // Detects dangerous 3-in-a-row and 4-in-a-row alignments for radar overlay
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
          if (line.length >= 4 && openEnds >= 1) {
            threats.push({ player, line, count: line.length, severity: "critical", openEnds });
          } else if (line.length === 3 && openEnds === 2) {
            threats.push({ player, line, count: 3, severity: "warning", openEnds });
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
    const scored = raw.map(([r, c]) => this.evaluateMove(board, r, c, player, centroid));
    const maxScore = Math.max(1, ...scored.map(s => s.total_score));

    return scored.map(s => ({
      row: s.row, col: s.col,
      total_score: s.total_score,
      intensity: Math.min(1.0, Math.max(0.12, s.total_score / (s.total_score >= 10000 ? s.total_score : Math.min(maxScore, 10000)))),
      isWinThreat: s.total_score >= 20000,
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
      return JSON.parse(localStorage.getItem("caro_arena_battles") || "[]");
    } catch { return []; }
  }

  static saveBattle(battle) {
    const list = this.getBattles();
    list.unshift(battle);
    if (list.length > 50) list.pop();
    localStorage.setItem("caro_arena_battles", JSON.stringify(list));
    this.updateLeaderboard(battle);
  }

  static getLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem("caro_arena_leaderboard") || "[]");
    } catch { return []; }
  }

  static updateLeaderboard(battle) {
    const statsMap = {};
    const battles = this.getBattles();
    for (const b of battles) {
      const placements = b.placements || [];
      const totalP = placements.length;
      for (const pl of placements) {
        const ptype = pl.type;
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

    localStorage.setItem("caro_arena_leaderboard", JSON.stringify(res));
  }

  static clearHistory() {
    localStorage.removeItem("caro_arena_battles");
    localStorage.removeItem("caro_arena_leaderboard");
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

  newGame(playerTypes) {
    if (playerTypes) this.selectedPlayerTypes = playerTypes;
    this.gameId = Math.random().toString(36).substring(2, 10);
    this.startedAt = Date.now();
    this.endedAt = null;

    const types = [...this.selectedPlayerTypes];
    // Shuffle
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }

    const symbols = PLAYERS.slice(0, types.length);
    this.players = types.map((ptype, i) => {
      const symbol = symbols[i];
      const agent = ptype === "human" ? null : this.createAgent(ptype, symbol);
      return {
        type: ptype,
        name: agent ? agent.name : (ptype === "human" ? "Human" : ptype.toUpperCase()),
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
    return info !== null && info.type === "human";
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

  undoHumanMove() {
    if (!this.board || this.board.moves.length === 0) return false;
    let lastHumanIdx = -1;
    for (let i = this.board.moves.length - 1; i >= 0; i--) {
      const m = this.board.moves[i];
      const p = this.players.find(pl => pl.symbol === m.player);
      if (p && p.type === "human") {
        lastHumanIdx = i;
        break;
      }
    }
    if (lastHumanIdx === -1) return false;

    const keepMoves = this.board.moves.slice(0, lastHumanIdx);
    const symbols = this.players.map(p => p.symbol);
    this.board = new CaroBoard(0, "standard", symbols);
    for (const m of keepMoves) {
      this.board.makeMove(m.row, m.col, m.player, m.metadata);
    }
    this.status = "playing";
    this.lastMoveDetails = keepMoves.length ? keepMoves[keepMoves.length - 1] : null;
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
    const playerOrder = this.players.map(p => ({ type: p.type, symbol: p.symbol }));
    const placements = this.board.placements.map(pl => {
      const ptype = this.players.find(p => p.symbol === pl.player)?.type || "unknown";
      return {
        symbol: pl.player,
        type: ptype,
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
  }

  toggleAutoPlay(enabled, delaySec = 0.02) {
    this.isAutoPlaying = enabled;
    this.autoDelaySec = Math.max(0.02, delaySec);
    if (this.autoPlayTimer) { clearTimeout(this.autoPlayTimer); this.autoPlayTimer = null; }

    if (enabled) {
      this.scheduleNextStep();
    }
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  scheduleNextStep() {
    if (!this.isAutoPlaying) return;
    if (this.status === "finished") {
      if (this.hasHumanPlayer()) {
        this.isAutoPlaying = false;
        if (this.onStateChange) this.onStateChange(this.getState());
        return;
      }
      // Auto-chain next battle after 3s
      this.autoPlayTimer = setTimeout(() => {
        if (!this.isAutoPlaying) return;
        this.battleNumber++;
        this.newGame();
        this.status = "playing";
        this.scheduleNextStep();
      }, 3000);
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
