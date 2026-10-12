"""Von Decision Model Agent for Caro Arena.
Uses the Von SDK (ModernBERT + OptionMarker) for ultra-fast (<15ms) typed decisions.
Falls back to tactical scoring if Von SDK is unavailable.
"""

import time
import random
from typing import Dict, Any, Optional
from caro_arena.engine.board import CaroBoard, BLACK, WHITE
from caro_arena.engine.evaluator import TacticalEvaluator

try:
    import von
except ImportError:
    von = None


class VonPlayer:
    def __init__(self, name: str = "Von"):
        self.name = name

    def choose_move(self, board: CaroBoard, player: str, top_k: int = 8) -> Dict[str, Any]:
        start_time = time.time()
        opponent = WHITE if player == BLACK else BLACK

        # Empty board → origin
        if not board.moves:
            latency = (time.time() - start_time) * 1000
            return self._opening_move(0, 0, player, latency, "Origin (0, 0) opening")

        # Second move → random adjacent
        if len(board.moves) == 1:
            r0, c0 = board.moves[0]["row"], board.moves[0]["col"]
            neighbors = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
            dr, dc = random.choice(neighbors)
            r, c = r0 + dr, c0 + dc
            latency = (time.time() - start_time) * 1000
            return self._opening_move(r, c, player, latency, f"Opening response at ({r}, {c})")

        candidates = TacticalEvaluator.get_ranked_candidates(board, player, top_k=top_k)

        # Critical threat → play immediately
        if candidates and candidates[0].get("total_score", 0) >= 20000:
            latency = (time.time() - start_time) * 1000
            c = candidates[0]
            return self._build_result(c, candidates, player, latency, is_fallback=False)

        # Build state and criteria
        key_to_cand = {}
        criteria = {}
        for idx, c in enumerate(candidates):
            cid = f"cand_{idx}"
            key_to_cand[cid] = c
            criteria[cid] = f"Play at ({c['row']}, {c['col']}): {c['summary']}"

        recent = board.moves[-8:]
        history = "\n".join(
            f"- Move {m['move_number']} ({m['player']}): ({m['row']}, {m['col']})"
            for m in recent
        )
        cand_lines = "\n".join(
            f"- {cid}: ({c['row']}, {c['col']}) -> {c['summary']} (score: {c['total_score']})"
            for cid, c in key_to_cand.items()
        )
        bounds = board.get_bounds()
        state = (
            f"Game: Caro (Five in a Row) on unlimited grid.\n"
            f"Active Bounds: rows [{bounds['min_r']}..{bounds['max_r']}], "
            f"cols [{bounds['min_c']}..{bounds['max_c']}].\n"
            f"Turn: {len(board.moves) + 1}. Player: {player}. Opponent: {opponent}.\n"
            f"Recent Moves:\n{history}\n\n"
            f"Tactical Candidates:\n{cand_lines}"
        )

        probabilities = {}
        confidence = 0.5
        chosen_key = None
        is_fallback = False

        if von is not None:
            try:
                options = list(criteria.values())
                result = von.choose(
                    state=state,
                    question=f"Select the best move for {player} in Caro.",
                    options=options,
                )
                # Map chosen option back to candidate key
                chosen_text = result.choice
                for cid, desc in criteria.items():
                    if desc == chosen_text:
                        chosen_key = cid
                        break

                # Extract probabilities if available
                if hasattr(result, "probabilities") and result.probabilities:
                    for i, (cid, _) in enumerate(criteria.items()):
                        if i < len(result.probabilities):
                            probabilities[cid] = float(result.probabilities[i])

                confidence = getattr(result, "confidence", 0.8)
            except Exception as e:
                print(f"Von inference error: {e}")
                is_fallback = True
        else:
            is_fallback = True

        # Fallback probabilities
        if not probabilities:
            total_s = sum(max(1.0, c["total_score"]) for c in candidates)
            probabilities = {
                f"cand_{i}": round(max(1.0, c["total_score"]) / total_s, 4)
                for i, c in enumerate(candidates)
            }

        # Temperature sampling if no clear choice
        if not chosen_key or chosen_key not in key_to_cand:
            valid_keys = list(key_to_cand.keys())
            temperature = 0.5
            weights = [max(1e-4, probabilities.get(k, 0.01)) ** (1.0 / temperature) for k in valid_keys]
            chosen_key = random.choices(valid_keys, weights=weights)[0]

        selected = key_to_cand[chosen_key]
        formatted = [{
            "row": c["row"], "col": c["col"],
            "probability": probabilities.get(f"cand_{i}", 0.0),
            "summary": c["summary"], "tactical_score": c["total_score"]
        } for i, c in enumerate(candidates)]

        latency = (time.time() - start_time) * 1000
        fallback_tag = " (Tactical Fallback)" if is_fallback else ""

        return {
            "row": selected["row"],
            "col": selected["col"],
            "player_color": player,
            "player_name": self.name,
            "probabilities": probabilities,
            "confidence": round(confidence, 4),
            "latency_ms": round(latency, 2),
            "model": f"Von (ModernBERT){fallback_tag}",
            "reasoning": criteria.get(chosen_key, selected.get("summary", "")),
            "candidates": formatted,
            "is_fallback": is_fallback,
        }

    def _opening_move(self, r, c, player, latency, reason):
        return {
            "row": r, "col": c,
            "player_color": player, "player_name": self.name,
            "probabilities": {"move_0": 1.0}, "confidence": 1.0,
            "latency_ms": round(latency, 2), "model": "Von (ModernBERT)",
            "reasoning": reason,
            "candidates": [{"row": r, "col": c, "probability": 1.0,
                            "summary": reason, "tactical_score": 10.0}],
            "is_fallback": False,
        }

    def _build_result(self, chosen, candidates, player, latency, is_fallback):
        total_s = sum(max(1.0, c["total_score"]) for c in candidates)
        probs = {f"cand_{i}": round(max(1.0, c["total_score"]) / total_s, 4)
                 for i, c in enumerate(candidates)}
        formatted = [{
            "row": c["row"], "col": c["col"],
            "probability": probs.get(f"cand_{i}", 0.0),
            "summary": c["summary"], "tactical_score": c["total_score"]
        } for i, c in enumerate(candidates)]
        return {
            "row": chosen["row"], "col": chosen["col"],
            "player_color": player, "player_name": self.name,
            "probabilities": probs, "confidence": 0.95,
            "latency_ms": round(latency, 2),
            "model": "Von (ModernBERT) (Critical Override)",
            "reasoning": chosen["summary"], "candidates": formatted,
            "is_fallback": is_fallback,
        }
