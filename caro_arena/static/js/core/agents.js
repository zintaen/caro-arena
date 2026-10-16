/**
 * Caro Arena — AI Decision Agents (Laya, Jev, Von, MoJev) & Daily Tactical Puzzles
 */

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

