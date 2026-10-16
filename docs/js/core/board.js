/**
 * Caro Arena — Core Board & Rule Variants (Freestyle, Blocked-Ends, Exact-5)
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

