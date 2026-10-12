"""Caro Tactical Pattern Evaluator and Candidate Move Generator for Unlimited Grid.
Analyzes lines, threats (Open 4, Blocked 4, Open 3, Double 3, 5-in-a-row)
and provides human/model-readable strategic descriptions.
"""

from typing import List, Tuple, Dict, Any, Optional
from caro_arena.engine.board import CaroBoard, EMPTY, BLACK, WHITE

DIRECTIONS = [
    (0, 1),   # Horizontal
    (1, 0),   # Vertical
    (1, 1),   # Main Diagonal \
    (1, -1),  # Anti-Diagonal /
]


class TacticalEvaluator:
    @staticmethod
    def evaluate_line_pattern(board: CaroBoard, r: int, c: int, dr: int, dc: int, player: str) -> Dict[str, Any]:
        """Examines the pattern along one direction passing through (r, c)."""
        consecutive = 1  # including the stone at (r, c)

        # Positive side
        pos_open = False
        step = 1
        while True:
            nr, nc = r + dr * step, c + dc * step
            cell = board.get_cell(nr, nc)
            if cell == player:
                consecutive += 1
                step += 1
            elif cell == EMPTY:
                pos_open = True
                break
            else:
                break

        # Negative side
        neg_open = False
        step = 1
        while True:
            nr, nc = r - dr * step, c - dc * step
            cell = board.get_cell(nr, nc)
            if cell == player:
                consecutive += 1
                step += 1
            elif cell == EMPTY:
                neg_open = True
                break
            else:
                break

        open_ends = (1 if pos_open else 0) + (1 if neg_open else 0)
        return {
            "count": consecutive,
            "open_ends": open_ends,
        }

    @classmethod
    def evaluate_move(cls, board: CaroBoard, r: int, c: int, player: str, centroid: Tuple[float, float]) -> Dict[str, Any]:
        """Calculates tactical value and creates a natural language description."""
        # Simulate move for player (offense)
        board.stones[(r, c)] = player
        off_patterns = [cls.evaluate_line_pattern(board, r, c, dr, dc, player) for dr, dc in DIRECTIONS]
        del board.stones[(r, c)]

        off_score = 0
        reasons = []

        # Check offensive patterns (5-in-a-row wins)
        for p in off_patterns:
            cnt, ends = p["count"], p["open_ends"]
            if cnt >= 5:
                off_score += 500000
                reasons.append("Immediate 5-in-a-row WIN")
            elif cnt == 4 and ends == 2:
                off_score += 50000
                reasons.append("Creates Open 4 (unstoppable win)")
            elif cnt == 4 and ends == 1:
                off_score += 10000
                reasons.append("Creates 4-in-a-row threat")
            elif cnt == 3 and ends == 2:
                off_score += 4000
                reasons.append("Creates Open 3 attack")
            elif cnt == 3 and ends == 1:
                off_score += 800
                reasons.append("Forms 3-in-a-row")
            elif cnt == 2 and ends == 2:
                off_score += 200
            elif cnt == 2 and ends == 1:
                off_score += 50

        # Defense logic: evaluate threats from all opponents
        def_score = 0
        best_def_reasons = []
        
        if hasattr(board, "get_opponents"):
            opponents = board.get_opponents(player)
        else:
            opponents = [WHITE if player == BLACK else BLACK]
            
        for opp in opponents:
            board.stones[(r, c)] = opp
            def_patterns = [cls.evaluate_line_pattern(board, r, c, dr, dc, opp) for dr, dc in DIRECTIONS]
            del board.stones[(r, c)]
            
            opp_def_score = 0
            opp_reasons = []
            
            for p in def_patterns:
                cnt, ends = p["count"], p["open_ends"]
                if cnt >= 5:
                    opp_def_score += 300000
                    opp_reasons.append("CRITICAL: Blocks opponent immediate 5-in-a-row")
                elif cnt == 4 and ends >= 1:
                    opp_def_score += 40000
                    opp_reasons.append("HIGH ALERT: Blocks opponent 4-in-a-row")
                elif cnt == 3 and ends == 2:
                    opp_def_score += 15000
                    opp_reasons.append("Defends against opponent Open 3 attack")
                elif cnt == 3 and ends == 1:
                    opp_def_score += 600
                    opp_reasons.append("Restricts opponent 3-stone line")
            
            if opp_def_score > def_score:
                def_score = opp_def_score
                best_def_reasons = opp_reasons
                
        reasons.extend(best_def_reasons)

        # Positional bonus
        cr, cc = centroid
        dist = ((r - cr) ** 2 + (c - cc) ** 2) ** 0.5
        pos_bonus = max(0.0, 15.0 - dist * 1.5)

        # Multi-player (3+ players): weight defense at 5% so agents prioritize creating
        # their own winning attacks while still defending immediate 5-in-a-row threats.
        # This produces tactical, decisive battles of ~80-180 moves across all models.
        # 2-player (1v1): full 100% defense.
        num_opponents = len(opponents) if opponents else 1
        def_weight = 0.05 if num_opponents >= 2 else 1.0
        total_score = off_score + def_score * def_weight + pos_bonus

        # Formulate concise strategic summary
        if not reasons:
            if dist <= 2.5:
                summary = "Clustered positional control and tactical connection"
            else:
                summary = "Supporting nearby stones and expanding line scope"
        else:
            summary = "; ".join(reasons[:2])

        return {
            "row": r,
            "col": c,
            "off_score": off_score,
            "def_score": def_score,
            "total_score": round(total_score, 1),
            "summary": summary
        }

    @classmethod
    def get_ranked_candidates(cls, board: CaroBoard, player: str, top_k: int = 8) -> List[Dict[str, Any]]:
        """Returns top_k candidate moves with tactical scores and strategic explanations."""
        raw_candidates = board.get_candidate_moves(max_distance=2)
        if not raw_candidates or not board.stones:
            return [{
                "row": 0,
                "col": 0,
                "off_score": 0,
                "def_score": 0,
                "total_score": 10.0,
                "summary": "First move at origin (0, 0) of unlimited board"
            }]

        # Compute centroid of stones
        rows = [r for r, _ in board.stones.keys()]
        cols = [c for _, c in board.stones.keys()]
        centroid = (sum(rows) / len(rows), sum(cols) / len(cols))

        scored = []
        for r, c in raw_candidates:
            eval_res = cls.evaluate_move(board, r, c, player, centroid)
            scored.append(eval_res)

        scored.sort(key=lambda x: x["total_score"], reverse=True)
        return scored[:top_k]
