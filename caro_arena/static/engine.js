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
  static normalizeRuleVariant(variant) {
    const v = String(variant || "freestyle").trim().toLowerCase();
    if (v === "blocked_ends" || v === "exact5") return v;
    return "freestyle";
  }

  constructor(playerSymbolsOrSize, rule = "freestyle", maybeSymbols) {
    const symbols = Array.isArray(playerSymbolsOrSize)
      ? playerSymbolsOrSize
      : (Array.isArray(maybeSymbols) ? maybeSymbols : PLAYERS.slice(0, 4));
    this.playerSymbols = symbols.length >= 2 ? symbols.slice(0, PLAYERS.length) : PLAYERS.slice(0, 4);
    this.rule = CaroBoard.normalizeRuleVariant(rule);
    this.stones = new Map(); // "r,c" -> playerSymbol
    this.moves = [];
    this.eliminatedPlayers = [];
    this.placements = [];
    this.isDraw = false;
    this.currentPlayerIdx = 0;
  }

  get ruleVariant() {
    return this.rule;
  }

  set ruleVariant(v) {
    this.rule = CaroBoard.normalizeRuleVariant(v);
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

    const pattern = TacticalEvaluator.detectMovePattern(this, r, c, current);
    const metaObj = Object.assign({}, metadata || {});
    if (pattern && !metaObj.pattern) {
      metaObj.pattern = pattern;
    }

    const moveRecord = {
      move_number: this.moves.length + 1,
      player: current,
      row: r,
      col: c,
      pattern: pattern || null,
      metadata: metaObj
    };
    this.moves.push(moveRecord);

    const winResult = this.checkWin(r, c, current);
    if (winResult.win) {
      moveRecord.pattern = "5-in-a-Row";
      moveRecord.metadata.pattern = "5-in-a-Row";
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
      const posEndCell = this.getCell(r + dr * step, c + dc * step);

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
      const negEndCell = this.getCell(r - dr * step, c - dc * step);

      if (this.rule === "blocked_ends") {
        // Vietnamese Caro (Chặn hai đầu): 5+ in a row wins only if NOT blocked at both ends by opponent stones
        const blockedBothEnds = posEndCell !== "." && negEndCell !== ".";
        if (line.length >= 5 && !blockedBothEnds) {
          return { win: true, line: line };
        }
      } else if (this.rule === "exact5") {
        if (line.length === 5) {
          return { win: true, line: line };
        }
      } else if (line.length >= 5) {
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
      rule: this.rule || "freestyle",
      rule_variant: this.rule || "freestyle",
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

    const openEnds = (posOpen ? 1 : 0) + (negOpen ? 0 : 0) + (negOpen ? 1 : 0);
    if (board.rule === "blocked_ends" && consecutive >= 5 && openEnds === 0) {
      return { count: 4, open_ends: 0 };
    }
    return { count: consecutive, open_ends: openEnds };
  }

  static detectMovePattern(board, r, c, player) {
    if (!board || !board.stones) return null;
    const wasSet = board.stones.get(`${r},${c}`);
    board.stones.set(`${r},${c}`, player);
    const patterns = DIRECTIONS.map(([dr, dc]) => this.evaluateLinePattern(board, r, c, dr, dc, player));

    let win5 = 0;
    let open4 = 0;
    let half4 = 0;
    let open3 = 0;

    for (const p of patterns) {
      if (p.count >= 5) win5++;
      else if (p.count === 4 && p.open_ends === 2) open4++;
      else if (p.count === 4 && p.open_ends === 1) half4++;
      else if (p.count === 3 && p.open_ends === 2) open3++;
    }

    // Check if this move blocked an opponent's lethal line
    let blockedWin = false;
    let blockedOpen3 = false;
    const opponents = board.getOpponents(player);
    for (const opp of opponents) {
      board.stones.set(`${r},${c}`, opp);
      for (const [dr, dc] of DIRECTIONS) {
        const dp = this.evaluateLinePattern(board, r, c, dr, dc, opp);
        if (dp.count >= 5) blockedWin = true;
        else if (dp.count === 4 && dp.open_ends === 2) blockedOpen3 = true;
      }
    }

    if (wasSet !== undefined) board.stones.set(`${r},${c}`, wasSet);
    else board.stones.delete(`${r},${c}`);

    if (win5 > 0) return "5-in-a-Row";
    if (open4 > 0 && (open4 + half4 >= 2)) return "Double-4";
    if ((open4 + half4 >= 1) && open3 >= 1) return "4×3 Fork";
    if (open4 > 0) return "Open-4";
    if (open3 >= 2) return "Double-3 Fork";
    if (half4 > 0) return "Blocked-4";
    if (blockedWin) return "Block-4";
    if (open3 === 1) return "Open-3";
    if (blockedOpen3) return "Block-3";
    return null;
  }

  static computeBoardPressure(board) {
    const symbols = board?.playerSymbols || ["A", "B"];
    const raw = {};
    symbols.forEach(s => { raw[s] = 100; });
    if (!board || !board.stones || board.stones.size === 0) {
      const eq = Math.round(100 / symbols.length);
      const shares = {};
      symbols.forEach(s => { shares[s] = eq; });
      return { shares, raw, leader: symbols[0] || "A" };
    }

    const firstWin = (board.placements || []).find(p => p.rank === 1);
    if (firstWin && firstWin.player) {
      const shares = {};
      symbols.forEach(s => {
        shares[s] = s === firstWin.player ? 88 : Math.round(12 / Math.max(1, symbols.length - 1));
      });
      return { shares, raw, leader: firstWin.player };
    }

    const threats = this.findThreatLines(board);
    for (const t of threats) {
      if (!raw[t.player]) continue;
      if (t.severity === "critical") raw[t.player] += t.openEnds >= 2 ? 1200 : 550;
      else if (t.severity === "warning") raw[t.player] += 240;
      else if (t.severity === "minor") raw[t.player] += 70;
      else raw[t.player] += 25;
    }

    let total = 0;
    for (const s of symbols) total += raw[s] || 100;
    const shares = {};
    let leader = symbols[0];
    let bestVal = -1;
    for (const s of symbols) {
      const val = raw[s] || 100;
      if (val > bestVal) { bestVal = val; leader = s; }
      shares[s] = Math.max(8, Math.round((val / Math.max(1, total)) * 100));
    }
    return { shares, raw, leader };
  }

  static evaluateMove(board, r, c, player, centroid = null) {
    if (!Array.isArray(centroid)) {
      if (board && board.stones && board.stones.size > 0) {
        let sumR = 0, sumC = 0;
        for (const key of board.stones.keys()) {
          const [sr, sc] = key.split(",").map(Number);
          sumR += sr; sumC += sc;
        }
        centroid = [sumR / board.stones.size, sumC / board.stones.size];
      } else {
        centroid = [0, 0];
      }
    }
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

// ─────────────────────────────────────────
// Curated Daily Tactical Puzzles
// ─────────────────────────────────────────
const DAILY_PUZZLES = [
  {
    id: "puzzle_double4_fork_01",
    title: "The Crossroads Fork",
    subtitle: "Play as A (Blue) — complete the 5-in-a-row or unstoppable 4×3 fork in 1 move.",
    objective: "Play as A — complete the 5-in-a-row in 1 move.",
    ruleVariant: "freestyle",
    presetMoves: [
      { row: 0, col: 0, player: "A" },
      { row: -1, col: 0, player: "B" },
      { row: 0, col: 1, player: "A" },
      { row: -1, col: 1, player: "B" },
      { row: 0, col: 2, player: "A" },
      { row: -1, col: 2, player: "B" },
      { row: 0, col: 3, player: "A" },
      { row: 2, col: -1, player: "B" }
    ],
    solutions: [[0, 4], [0, -1]]
  },
  {
    id: "puzzle_diag_strike_02",
    title: "Diagonal Spear",
    subtitle: "Play as A (Blue) — seize the open diagonal to win on the spot.",
    objective: "Play as A — seize the open diagonal to win on the spot.",
    ruleVariant: "freestyle",
    presetMoves: [
      { row: -2, col: -2, player: "A" },
      { row: -2, col: 0, player: "B" },
      { row: -1, col: -1, player: "A" },
      { row: -1, col: 1, player: "B" },
      { row: 0, col: 0, player: "A" },
      { row: 1, col: -1, player: "B" },
      { row: 1, col: 1, player: "A" },
      { row: 2, col: 0, player: "B" }
    ],
    solutions: [[2, 2], [-3, -3]]
  },
  {
    id: "puzzle_4x3_nexus_03",
    title: "Twin Axis Fork",
    subtitle: "Play as A (Blue) — place the pivot stone that creates an unstoppable Open-4.",
    objective: "Play as A — place the pivot stone that creates an unstoppable Open-4.",
    ruleVariant: "freestyle",
    presetMoves: [
      { row: 0, col: -1, player: "A" },
      { row: -2, col: -1, player: "B" },
      { row: 0, col: 1, player: "A" },
      { row: -2, col: 0, player: "B" },
      { row: 0, col: 2, player: "A" },
      { row: -2, col: 2, player: "B" },
      { row: 1, col: 0, player: "A" },
      { row: 2, col: -2, player: "B" }
    ],
    solutions: [[0, 0], [0, 3]]
  }
];

function getDailyPuzzle(overrideIndex = null) {
  let idx = 0;
  if (typeof overrideIndex === "number" && overrideIndex >= 0) {
    idx = overrideIndex % DAILY_PUZZLES.length;
  } else {
    const dayNumber = Math.floor(Date.now() / 86400000);
    idx = dayNumber % DAILY_PUZZLES.length;
  }
  return DAILY_PUZZLES[idx];
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
    this.ruleVariant = "freestyle";
    this.seriesTargetWins = 1;
    this.seriesScores = {};
    this.seriesChampion = null;
    this.activePuzzle = null;
    this.puzzleSolved = false;
    this.isBranchedReplay = false;
    this.isThinking = false;
    this.thinkingPlayer = null;
    this.lastMoveDetails = null;
    this.onStateChange = null;
    this.autoPlayTimer = null;

    this.newGame();
  }

  setRuleVariant(variant) {
    this.ruleVariant = CaroBoard.normalizeRuleVariant(variant);
    if (this.board && this.board.moves.length === 0) {
      this.board.ruleVariant = this.ruleVariant;
    }
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  setSeriesTarget(targetWins) {
    const t = Math.max(1, Math.min(5, Number(targetWins) || 1));
    if (t !== this.seriesTargetWins) {
      this.seriesTargetWins = t;
      this.seriesScores = {};
      this.seriesChampion = null;
    }
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  resetSeries() {
    this.seriesScores = {};
    this.seriesChampion = null;
    this.battleNumber = 1;
  }

  createAgent(ptype, colorName) {
    if (ptype === "laya") return new LayaAgent(`Laya (${colorName})`);
    if (ptype === "jev") return new JevAgent(`Jev (${colorName})`);
    if (ptype === "von") return new VonAgent(`Von (${colorName})`);
    if (ptype === "mojev") return new MoJevAgent(`MoJev (${colorName})`);
    return null;
  }

  newGame(playerTypes, shouldShuffle = true, playerConfigs = null, options = {}) {
    if (playerConfigs) {
      this.isAutoPlaying = false;
      if (this.autoPlayTimer) {
        clearTimeout(this.autoPlayTimer);
        this.autoPlayTimer = null;
      }
    }
    if (options.ruleVariant) {
      this.ruleVariant = CaroBoard.normalizeRuleVariant(options.ruleVariant);
    }
    if (options.seriesTargetWins !== undefined) {
      const nextTarget = Math.max(1, Math.min(5, Number(options.seriesTargetWins) || 1));
      if (nextTarget !== this.seriesTargetWins || options.resetSeries) {
        this.seriesTargetWins = nextTarget;
        this.seriesScores = {};
        this.seriesChampion = null;
      }
    } else if (options.resetSeries || this.seriesChampion) {
      this.seriesScores = {};
      this.seriesChampion = null;
    }

    if (this.status === "finished" && !playerConfigs && !options.resetSeries) {
      this.battleNumber += 1;
    } else if (options.resetSeries) {
      this.battleNumber = 1;
    }
    if (playerTypes) this.selectedPlayerTypes = playerTypes;
    const mpRoom = (playerConfigs && typeof window !== "undefined" && window.CaroMultiplayer?.inGame)
      ? window.CaroMultiplayer.roomId
      : null;
    this.gameId = mpRoom
      ? `mp_${mpRoom}_b${this.battleNumber || 1}`
      : Math.random().toString(36).substring(2, 10);
    this.startedAt = Date.now();
    this.endedAt = null;
    this.activePuzzle = null;
    this.puzzleSolved = false;
    this.isBranchedReplay = false;

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

    this.board = new CaroBoard(symbols, this.ruleVariant);
    this.status = "ready";
    this.isThinking = false;
    this.thinkingPlayer = null;
    this.lastMoveDetails = null;

    if (this.onStateChange) this.onStateChange(this.getState());
    return this.getState();
  }

  branchFromMoves(sourcePlayers, movesSlice, ruleVariant = null) {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    this.isAutoPlaying = false;
    this.activePuzzle = null;
    this.puzzleSolved = false;
    this.isBranchedReplay = true;
    if (ruleVariant) {
      this.ruleVariant = CaroBoard.normalizeRuleVariant(ruleVariant);
    }

    const rawPlayers = Array.isArray(sourcePlayers) && sourcePlayers.length >= 2
      ? sourcePlayers
      : [{ type: "human", symbol: "A", name: "Human" }, { type: "mojev", symbol: "B", name: "MoJev (B)" }];

    const symbols = rawPlayers.map((p, idx) => p.symbol || PLAYERS[idx]);
    const tempBoard = new CaroBoard(symbols, this.ruleVariant);
    for (const m of (movesSlice || [])) {
      tempBoard.makeMove(Number(m.row), Number(m.col), m.player, m.metadata || m.meta || {});
    }

    const nextTurnSymbol = tempBoard.currentPlayer;
    const hasHumanAlready = rawPlayers.some(p => p.type === "human");

    this.players = rawPlayers.map((p, idx) => {
      const symbol = symbols[idx];
      // Ensure the player whose turn it is at the branch point (or A) is human so user can immediately play
      const makeHuman = (!hasHumanAlready && symbol === nextTurnSymbol) || p.type === "human";
      const ptype = makeHuman ? "human" : (p.type || "jev");
      const agent = ptype === "human" ? null : this.createAgent(ptype, symbol);
      const name = makeHuman ? (p.type === "human" && p.name ? p.name : `You (${symbol})`) : (p.name || agent?.name || symbol);
      return { type: ptype, name, agent, symbol };
    });
    this.selectedPlayerTypes = this.players.map(p => p.type);
    this.board = tempBoard;
    this.gameId = `branch_${Math.random().toString(36).substring(2, 9)}`;
    this.startedAt = Date.now();
    this.endedAt = this.board.isGameOver() ? Date.now() : null;
    this.status = this.board.isGameOver() ? "finished" : (this.board.moves.length > 0 ? "playing" : "ready");

    if (this.board.moves.length > 0) {
      const last = this.board.moves[this.board.moves.length - 1];
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
    return this.getState();
  }

  startDailyPuzzle(overrideIndex = null) {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    this.isAutoPlaying = false;
    this.isBranchedReplay = false;
    const puzzle = getDailyPuzzle(overrideIndex);
    this.activePuzzle = puzzle;
    this.puzzleSolved = false;
    this.ruleVariant = CaroBoard.normalizeRuleVariant(puzzle.ruleVariant || "freestyle");
    this.selectedPlayerTypes = ["human", "mojev"];
    this.players = [
      { type: "human", name: "You (A)", agent: null, symbol: "A" },
      { type: "mojev", name: "MoJev (B)", agent: this.createAgent("mojev", "B"), symbol: "B" }
    ];
    this.board = new CaroBoard(["A", "B"], this.ruleVariant);
    for (const m of (puzzle.presetMoves || [])) {
      this.board.makeMove(m.row, m.col, m.player, { reasoning: "Puzzle setup", pattern: null });
    }
    this.gameId = `puzzle_${puzzle.id}_${Date.now().toString(36)}`;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.status = "playing";
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
    const moveMeta = meta ? { ...meta } : {};
    const success = this.board.makeMove(r, c, curr, moveMeta);
    if (success) {
      const latestMove = this.board.moves[this.board.moves.length - 1];
      const pattern = latestMove?.metadata?.pattern || null;
      this.lastMoveDetails = {
        player: curr,
        player_name: this.players.find(p => p.symbol === curr)?.name || curr,
        row: r, col: c,
        pattern: pattern,
        meta: latestMove?.metadata || moveMeta
      };

      // Check Daily Puzzle completion if active
      if (this.activePuzzle && curr === "A") {
        const isListedSol = (this.activePuzzle.solutions || []).some(([sr, sc]) => sr === r && sc === c);
        const patLabel = typeof pattern === "string" ? pattern : pattern?.label;
        const isWinningOrFork = Boolean(patLabel && ["5-in-a-Row", "Open-4", "4×3 Fork", "Double-3 Fork"].includes(patLabel));
        if (isListedSol || isWinningOrFork || this.board.isGameOver()) {
          this.puzzleSolved = true;
          this.status = "finished";
          this.endedAt = Date.now();
          if (typeof window !== "undefined" && window.CaroAudio) {
            window.CaroAudio.playWinChime(1);
          }
          return true;
        }
      }

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
        this.recordSeriesResult();
        this.persistGame();
      } else {
        this.status = "playing";
      }
    }
    return success;
  }

  recordSeriesResult(placementsOverride = null) {
    const placements = Array.isArray(placementsOverride) ? placementsOverride : (this.board?.placements || []);
    if (!Array.isArray(placements)) return;
    const firstPlace = placements.find(p => p.rank === 1);
    if (!firstPlace) return;
    const sym = firstPlace.player || firstPlace.symbol;
    if (!sym) return;
    this.seriesScores[sym] = (this.seriesScores[sym] || 0) + 1;
    if (this.seriesTargetWins > 1 && this.seriesScores[sym] >= this.seriesTargetWins) {
      this.seriesChampion = sym;
    }
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
    this.board = new CaroBoard(symbols, this.ruleVariant);
    for (const m of keepMoves) {
      this.board.makeMove(m.row, m.col, m.player, m.metadata);
    }
    this.status = keepMoves.length ? "playing" : "ready";
    this.endedAt = null;
    this.puzzleSolved = false;
    if (keepMoves.length) {
      const last = keepMoves[keepMoves.length - 1];
      this.lastMoveDetails = {
        player: last.player,
        player_name: this.players.find(p => p.symbol === last.player)?.name || last.player,
        row: last.row,
        col: last.col,
        pattern: last.metadata?.pattern || null,
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

    // If game continues and next is AI in solo mode, automatically step AI turns
    const isMp = Boolean(typeof window !== "undefined" && window.CaroMultiplayer?.inGame);
    if (this.status !== "finished" && !this.isHumanTurn() && (this.isAutoPlaying || !isMp)) {
      this.isAutoPlaying = true;
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
    if (this.activePuzzle) return; // Puzzles are tracked via recordPuzzleSolved
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

      const isMp = Boolean(typeof window !== "undefined" && window.CaroMultiplayer?.inGame);
      const battleRecord = {
        battle_id: this.gameId,
        started_at: this.startedAt / 1000,
        ended_at: (this.endedAt || Date.now()) / 1000,
        is_multiplayer: isMp,
        room_code: isMp ? (window.CaroMultiplayer?.roomId || null) : null,
        rule_variant: this.ruleVariant,
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
      rule_variant: this.ruleVariant,
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
      puzzle: this.activePuzzle,
      active_puzzle: this.activePuzzle,
      puzzle_solved: this.puzzleSolved,
      is_branched_replay: this.isBranchedReplay,
      series: {
        battle_number: this.battleNumber,
        target_wins: this.seriesTargetWins,
        series_target_wins: this.seriesTargetWins,
        scores: { ...this.seriesScores },
        series_scores: { ...this.seriesScores },
        champion: this.seriesChampion,
        series_champion: this.seriesChampion
      }
    };
  }
}

window.CaroEngine = {
  CaroBoard,
  TacticalEvaluator,
  ClientStorage,
  ClientGameManager,
  DAILY_PUZZLES,
  getDailyPuzzle
};


