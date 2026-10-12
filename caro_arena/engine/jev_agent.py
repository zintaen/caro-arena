"""TypeSafe Jev Decision Model Agent for Unlimited Grid Caro.
Uses TypeSafe AI's Jev System-1 non-autoregressive decision model
to evaluate tactical choices and produce calibrated move probabilities.
Supports official typesafe-sdk, custom base URLs, and graceful tactical fallback.
"""

import os
import time
import random
from typing import Dict, Any, Tuple, Optional
from caro_arena.engine.board import CaroBoard, BLACK, WHITE
from caro_arena.engine.evaluator import TacticalEvaluator

try:
    from typesafe_sdk import TypeSafeClient, Choice
except ImportError:
    TypeSafeClient = None
    Choice = None


DEFAULT_JEV_MODEL = os.getenv("TYPESAFE_MODEL", os.getenv("JEV_MODEL", "jev-latest"))
DEFAULT_JEV_BASE_URL = os.getenv("TYPESAFE_BASE_URL", os.getenv("JEV_BASE_URL", "https://api.typesafe.ai"))


class JevPlayer:
    def __init__(self, name: str = "Jev (TypeSafe)", model: str = DEFAULT_JEV_MODEL, base_url: str = DEFAULT_JEV_BASE_URL):
        self.name = name
        self.model = model
        self.base_url = base_url
        self.api_key = os.getenv("TYPESAFE_API_KEY", os.getenv("JEV_API_KEY", ""))
        self.client: Optional[Any] = None

        if TypeSafeClient is not None and self.api_key:
            try:
                self.client = TypeSafeClient(
                    api_key=self.api_key,
                    base_url=self.base_url,
                    timeout=8.0
                )
            except Exception as e:
                print(f"Warning: Failed to initialize TypeSafeClient: {e}")
                self.client = None

    def is_available(self) -> bool:
        """Returns True if player is ready to make decisions."""
        return True

    def choose_move(self, board: CaroBoard, player: str, top_k: int = 8) -> Dict[str, Any]:
        """Evaluates tactical candidates using TypeSafe Jev and returns the chosen move with stats."""
        start_time = time.time()
        opponent = WHITE if player == BLACK else BLACK

        # If board is empty, standard center opening at origin (0, 0)
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
                "model": f"TypeSafe Jev ({self.model})",
                "reasoning": "Origin (0, 0) center control opening on unlimited grid",
                "candidates": [{
                    "row": 0,
                    "col": 0,
                    "probability": 1.0,
                    "summary": "First move at origin (0, 0)"
                }],
                "is_fallback": False
            }

        # Responding to opening stone, pick among adjacent neighbors
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
                "model": f"TypeSafe Jev ({self.model})",
                "reasoning": f"Symmetric opening response at ({chosen_r}, {chosen_c})",
                "candidates": cands_info,
                "is_fallback": False
            }

        # Get top tactical candidates from board evaluator
        candidates = TacticalEvaluator.get_ranked_candidates(board, player, top_k=top_k)

        # Build candidate key mapping & criteria dictionary
        key_to_cand = {}
        criteria = {}
        for idx, c in enumerate(candidates):
            cid = f"cand_{idx}"
            key_to_cand[cid] = c
            criteria[cid] = f"Play at ({c['row']}, {c['col']}): {c['summary']}"

        # Build prompt state representation
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
            f"Rule: 5 stones in a continuous line wins.\n"
            f"Active Bounds: rows [{bounds['min_r']}..{bounds['max_r']}], cols [{bounds['min_c']}..{bounds['max_c']}].\n"
            f"Turn: {len(board.moves) + 1}. Current Player: {player} to move. Opponent: {opponent}.\n"
            f"Recent Moves:\n" + "\n".join(history_lines) + "\n\n"
            f"Tactical Candidates:\n" + "\n".join(candidate_lines)
        )

        probabilities = {}
        confidence = 0.5
        chosen_key = None
        is_fallback = False
        token_usage = {"input_tokens": 0, "output_tokens": 0}

        if self.client is not None and Choice is not None:
            try:
                question = Choice(
                    type="choice",
                    instructions=f"Select the most strategically advantageous move for player {player} in Caro.",
                    criteria=criteria
                )
                response = self.client.system_one(
                    state=state,
                    questions={"best_move": question},
                    model=self.model
                )
                if response and hasattr(response, "answers") and "best_move" in response.answers:
                    ans = response.answers["best_move"]
                    chosen_key = getattr(ans, "choice", None)
                    raw_probs = getattr(ans, "probabilities", {}) or {}
                    probabilities = {cid: float(raw_probs.get(cid, 0.0)) for cid in criteria.keys()}
                    confidence = float(getattr(ans, "confidence", 0.5))

                if hasattr(response, "usage") and response.usage:
                    token_usage["input_tokens"] = getattr(response.usage, "input_tokens", 0)
                    token_usage["output_tokens"] = getattr(response.usage, "output_tokens", 0)
            except Exception as e:
                print(f"TypeSafe Jev inference error ({type(e).__name__}): {e}")
                is_fallback = True
        else:
            is_fallback = True

        # Fallback probability distribution if Jev API is unavailable
        if not probabilities:
            total_s = sum(max(1.0, c["total_score"]) for c in candidates)
            probabilities = {
                f"cand_{idx}": round(max(1.0, c["total_score"]) / total_s, 4)
                for idx, c in enumerate(candidates)
            }
            confidence = 0.75 if is_fallback else 0.5

        # Critical threat verification (score >= 20000 means must-win or must-block)
        is_critical = candidates and candidates[0].get("total_score", 0) >= 20000

        if is_critical:
            chosen_key = "cand_0"
        elif not chosen_key or chosen_key not in key_to_cand:
            # Temperature sampling across calibrated candidate probabilities (T=0.6)
            valid_keys = [k for k in criteria.keys() if k in key_to_cand]
            if valid_keys:
                temperature = 0.60
                weights = [max(1e-4, probabilities.get(k, 0.01)) ** (1.0 / temperature) for k in valid_keys]
                chosen_key = random.choices(valid_keys, weights=weights)[0]
            else:
                chosen_key = "cand_0"

        selected_cand = key_to_cand.get(chosen_key, candidates[0])
        chosen_row = selected_cand["row"]
        chosen_col = selected_cand["col"]
        chosen_summary = criteria.get(chosen_key, selected_cand.get("summary", ""))

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

        latency = (time.time() - start_time) * 1000

        fallback_note = " (Tactical Fallback)" if is_fallback and not self.client else ""
        return {
            "row": chosen_row,
            "col": chosen_col,
            "player_color": player,
            "player_name": self.name,
            "probabilities": probabilities,
            "confidence": round(confidence, 3),
            "latency_ms": round(latency, 2),
            "model": f"TypeSafe Jev ({self.model}){fallback_note}",
            "reasoning": chosen_summary,
            "candidates": formatted_candidates,
            "tokens": token_usage,
            "is_fallback": is_fallback
        }
