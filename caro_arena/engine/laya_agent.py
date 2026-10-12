"""Laya Decision Model Agent for Unlimited Grid Caro.
Uses Convai Innovations' Laya System-1 non-autoregressive decision model
to evaluate tactical choices and produce calibrated move probabilities in ~30-50ms.
"""

import time
import random
from typing import Dict, Any, Tuple, Optional
from caro_arena.engine.board import CaroBoard, BLACK, WHITE
from caro_arena.engine.evaluator import TacticalEvaluator

try:
    from laya import Agent as LayaCoreAgent
except ImportError:
    LayaCoreAgent = None


_SHARED_LAYA_AGENT = None


def get_shared_laya_agent():
    global _SHARED_LAYA_AGENT
    if _SHARED_LAYA_AGENT is None and LayaCoreAgent is not None:
        try:
            _SHARED_LAYA_AGENT = LayaCoreAgent()
        except Exception as e:
            print(f"Warning: Failed to load Laya Agent: {e}")
            _SHARED_LAYA_AGENT = None
    return _SHARED_LAYA_AGENT


class LayaPlayer:
    def __init__(self, name: str = "Laya (System 1)"):
        self.name = name
        self.agent = get_shared_laya_agent()

    def choose_move(self, board: CaroBoard, player: str, top_k: int = 8) -> Dict[str, Any]:
        """Evaluates tactical candidates using Laya and returns the chosen move with stats."""
        start_time = time.time()
        opponent = WHITE if player == BLACK else BLACK

        # If board is empty, play at origin (0, 0)
        if not board.moves:
            latency = (time.time() - start_time) * 1000
            return {
                "row": 0,
                "col": 0,
                "player_color": player,
                "player_name": self.name,
                "probabilities": {"move_0_0": 1.0},
                "confidence": 1.0,
                "latency_ms": round(latency, 2),
                "model": "Laya (System 1 Decision)",
                "reasoning": "Opening origin (0, 0) control on unlimited grid",
                "candidates": [{
                    "row": 0,
                    "col": 0,
                    "probability": 1.0,
                    "summary": "First move at origin (0, 0)"
                }]
            }

        # Responding to opening stone, pick randomly among the 8 adjacent neighbors
        if len(board.moves) == 1:
            r0, c0 = board.moves[0]["row"], board.moves[0]["col"]
            opening_neighbors = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
            dr, dc = random.choice(opening_neighbors)
            chosen_r, chosen_c = r0 + dr, c0 + dc
            latency = (time.time() - start_time) * 1000
            cands_info = [
                {"row": r0 + r, "col": c0 + c, "probability": 0.125, "summary": f"Opening adjacent response at ({r0 + r}, {c0 + c})", "tactical_score": 10.0}
                for r, c in opening_neighbors
            ]
            return {
                "row": chosen_r,
                "col": chosen_c,
                "player_color": player,
                "player_name": self.name,
                "probabilities": {f"cand_{i}": 0.125 for i in range(8)},
                "confidence": 0.9,
                "latency_ms": round(latency, 2),
                "model": "Laya (System 1 Decision)",
                "reasoning": f"Symmetric opening response at ({chosen_r}, {chosen_c})",
                "candidates": cands_info
            }

        # Get top tactical candidates
        candidates = TacticalEvaluator.get_ranked_candidates(board, player, top_k=top_k)

        # Build candidate key mapping
        key_to_cand = {}
        criteria = {}
        for idx, c in enumerate(candidates):
            cid = f"cand_{idx}"
            key_to_cand[cid] = c
            criteria[cid] = f"Play at ({c['row']}, {c['col']}): {c['summary']}"

        # Build state representation
        recent_moves = board.moves[-8:]
        history_lines = [
            f"- Move {m['move_number']} ({m['player']}): ({m['row']}, {m['col']})"
            for m in recent_moves
        ]

        candidate_lines = [
            f"- {cid}: ({c['row']}, {c['col']}) -> {c['summary']} (Tactical score: {c['total_score']})"
            for cid, c in key_to_cand.items()
        ]

        bounds = board.get_bounds()
        state = (
            f"Game: Caro (Five in a Row) on an unlimited grid.\n"
            f"Rule: 5 in a row in any direction wins.\n"
            f"Active Area Bounds: rows [{bounds['min_r']}..{bounds['max_r']}], cols [{bounds['min_c']}..{bounds['max_c']}].\n"
            f"Turn: {len(board.moves) + 1}. Current Player: {player} to move. Opponent: {opponent}.\n"
            f"Recent Moves:\n" + "\n".join(history_lines) + "\n\n"
            f"Tactical Candidates:\n" + "\n".join(candidate_lines)
        )

        questions = {
            "best_move": {
                "type": "choice",
                "instructions": f"Select the most strategically advantageous move for player {player} in Caro.",
                "criteria": criteria
            }
        }

        probabilities = {}
        confidence = 0.5
        chosen_key = None

        if self.agent is not None:
            try:
                res = self.agent.predict(state, questions)
                ans = res["answers"]["best_move"]
                chosen_key = ans["choice"]
                raw_probs = ans.get("probabilities", {})
                probabilities = {cid: raw_probs.get(cid, 0.0) for cid in criteria.keys()}
                confidence = ans.get("confidence", 0.5)
            except Exception as e:
                print(f"Laya inference error: {e}")

        # Ensure probabilities exist
        if not probabilities:
            total_s = sum(max(1.0, c["total_score"]) for c in candidates)
            probabilities = {
                f"cand_{idx}": round(max(1.0, c["total_score"]) / total_s, 4)
                for idx, c in enumerate(candidates)
            }

        # Check for critical moves:
        # score >= 50,000 is immediate win (5 in a row)
        # score >= 20,000 is must-block opponent win
        is_critical = candidates and candidates[0].get("total_score", 0) >= 20000

        if is_critical:
            # Deterministically play the critical move - never blunder a win or loss!
            chosen_key = "cand_0"
        else:
            # Temperature sampling across calibrated candidate probabilities:
            # T=0.65 focuses on the top-probability move while enabling tactical branch exploration
            valid_keys = [k for k in criteria.keys() if k in key_to_cand]
            if valid_keys:
                temperature = 0.65
                weights = [max(1e-4, probabilities.get(k, 0.01)) ** (1.0 / temperature) for k in valid_keys]
                chosen_key = random.choices(valid_keys, weights=weights)[0]
            else:
                chosen_key = "cand_0"

        selected_cand = key_to_cand.get(chosen_key, candidates[0])
        chosen_row = selected_cand["row"]
        chosen_col = selected_cand["col"]
        chosen_summary = criteria.get(chosen_key, selected_cand.get("summary", ""))

        # Format candidates with probabilities
        formatted_candidates = []
        for idx, c in enumerate(candidates):
            cid = f"cand_{idx}"
            p = probabilities.get(cid, 0.0)
            formatted_candidates.append({
                "row": c["row"],
                "col": c["col"],
                "probability": p,
                "summary": c["summary"],
                "tactical_score": c["total_score"]
            })

        formatted_candidates.sort(key=lambda x: x["probability"], reverse=True)
        latency = (time.time() - start_time) * 1000

        return {
            "row": chosen_row,
            "col": chosen_col,
            "player_color": player,
            "player_name": self.name,
            "probabilities": probabilities,
            "confidence": round(confidence, 4),
            "latency_ms": round(latency, 2),
            "model": "Laya (System 1 Decision)",
            "reasoning": chosen_summary,
            "candidates": formatted_candidates
        }
