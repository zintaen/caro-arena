/**
 * Caro Arena — Tactical Threat Evaluator, Pattern Detector & Win-Pressure Calculator
 */

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

  /**
   * Recognizes classic early-game Caro / Gomoku opening formations from the first 2-6 moves.
   */
  static detectOpeningName(moves) {
    if (!Array.isArray(moves) || moves.length < 2) return null;
    const early = moves.slice(0, Math.min(6, moves.length));
    const m0 = early[0];
    const m1 = early[1];
    const dr1 = Math.abs(m1.row - m0.row);
    const dc1 = Math.abs(m1.col - m0.col);

    // Check 4-player spread vs tight cluster if >= 4 moves
    if (early.length >= 4) {
      const uniquePlayers = new Set(early.slice(0, 4).map(m => m.player)).size;
      const rows = early.slice(0, 4).map(m => m.row);
      const cols = early.slice(0, 4).map(m => m.col);
      const span = Math.max(...rows) - Math.min(...rows) + (Math.max(...cols) - Math.min(...cols));
      if (uniquePlayers >= 3 && span >= 5) {
        return "Four-Corner Clash";
      }
    }

    if ((dr1 === 1 && dc1 === 2) || (dr1 === 2 && dc1 === 1)) {
      return "Knight's Approach";
    }
    if (dr1 === 1 && dc1 === 1) {
      if (early.length >= 3) {
        const m2 = early[2];
        const dr2 = Math.abs(m2.row - m0.row);
        const dc2 = Math.abs(m2.col - m0.col);
        if (dr2 === 1 && dc2 === 1) return "Diagonal Star Opening";
        if (dr2 + dc2 === 1) return "Slant Wedge";
      }
      return "Diagonal Star Opening";
    }
    if (dr1 + dc1 === 1) {
      if (early.length >= 3) {
        const m2 = early[2];
        const dr2 = Math.abs(m2.row - m0.row);
        const dc2 = Math.abs(m2.col - m0.col);
        if (dr2 + dc2 === 1) return "Direct Star Opening";
        if (dr2 === 1 && dc2 === 1) return "Direct Bridge";
      }
      return "Direct Star Opening";
    }
    if ((dr1 === 2 && dc1 === 0) || (dr1 === 0 && dc1 === 2)) {
      return "Long Bridge";
    }
    if (dr1 === 2 && dc1 === 2) {
      return "Cross-Wing";
    }
    return "Center Cluster";
  }
}

