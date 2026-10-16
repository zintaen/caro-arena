/**
 * Caro Arena — Client Game Manager & Engine Barrel
 */

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


