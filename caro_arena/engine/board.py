"""Unlimited (Infinite Grid) Caro Board Representation and Rules Engine.
Five consecutive stones in any direction (horizontal, vertical, diagonal) wins.
Coordinates are unbounded integers (r, c) in Z^2.
Supports 2-5 players with configurable roster.
"""

from typing import List, Tuple, Optional, Dict, Any

EMPTY = "."
BLACK = "X"  # Maintained for backward compatibility in agent files
WHITE = "O"  # Maintained for backward compatibility in agent files
PLAYERS = ["A", "B", "C", "D", "E"]

DIRECTIONS = [
    (0, 1),   # Horizontal
    (1, 0),   # Vertical
    (1, 1),   # Main diagonal \
    (1, -1),  # Anti-diagonal /
]


class CaroBoard:
    def __init__(self, size: int = 0, rule: str = "standard", player_symbols: Optional[List[str]] = None):
        self.size = size
        self.rule = "standard"
        self.player_symbols = player_symbols or PLAYERS[:]
        self.stones: Dict[Tuple[int, int], str] = {}
        self.moves: List[Dict[str, Any]] = []
        self.eliminated_players: List[str] = []
        self.placements: List[Dict[str, Any]] = []
        self.is_draw: bool = False
        self._current_player_idx = 0

    @property
    def current_player(self) -> str:
        return self.player_symbols[self._current_player_idx]

    def get_active_players(self) -> List[str]:
        return [p for p in self.player_symbols if p not in self.eliminated_players]

    def advance_turn(self):
        active = self.get_active_players()
        if not active:
            return
        idx = self._current_player_idx
        n = len(self.player_symbols)
        for _ in range(n):
            idx = (idx + 1) % n
            if self.player_symbols[idx] in active:
                self._current_player_idx = idx
                break

    def get_opponents(self, player: str) -> List[str]:
        return [p for p in self.player_symbols if p != player and p not in self.eliminated_players]

    def get_cell(self, r: int, c: int) -> str:
        return self.stones.get((r, c), EMPTY)

    def is_valid_coord(self, r: int, c: int) -> bool:
        return True

    def is_game_over(self) -> bool:
        total = len(self.player_symbols)
        return len(self.placements) >= total or self.is_draw or len(self.get_active_players()) <= 1

    def is_legal_move(self, r: int, c: int) -> bool:
        if self.is_game_over():
            return False
        return (r, c) not in self.stones

    def make_move(self, r: int, c: int, player: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Place a stone at (r, c). Returns True if valid and placed."""
        if not self.is_legal_move(r, c):
            return False

        current = player or self.current_player
        self.stones[(r, c)] = current

        move_record = {
            "move_number": len(self.moves) + 1,
            "player": current,
            "row": r,
            "col": c,
            "metadata": metadata or {}
        }
        self.moves.append(move_record)

        win, line = self.check_win(r, c, current)
        if win:
            rank = len(self.placements) + 1
            self.placements.append({
                "player": current,
                "rank": rank,
                "move_number": len(self.moves),
                "winning_line": line
            })
            self.eliminated_players.append(current)

            active = self.get_active_players()
            if len(active) == 1:
                # Auto-assign last place to the only remaining player
                last_player = active[0]
                self.placements.append({
                    "player": last_player,
                    "rank": rank + 1,
                    "move_number": len(self.moves),
                    "winning_line": None
                })
                self.eliminated_players.append(last_player)

        # No draw limit — on an infinite board, play continues
        # until n-1 players have achieved 5-in-a-row.

        if not self.is_game_over():
            self.advance_turn()

        return True

    def check_win(self, r: int, c: int, player: str) -> Tuple[bool, Optional[List[Tuple[int, int]]]]:
        """Checks if the move at (r, c) created an unbroken 5+ stone line for player."""
        for dr, dc in DIRECTIONS:
            line = [(r, c)]

            step = 1
            while True:
                nr, nc = r + dr * step, c + dc * step
                if self.stones.get((nr, nc)) == player:
                    line.append((nr, nc))
                    step += 1
                else:
                    break

            step = 1
            while True:
                nr, nc = r - dr * step, c - dc * step
                if self.stones.get((nr, nc)) == player:
                    line.insert(0, (nr, nc))
                    step += 1
                else:
                    break

            if len(line) >= 5:
                return True, line

        return False, None

    def get_candidate_moves(self, max_distance: int = 2) -> List[Tuple[int, int]]:
        if not self.stones:
            return [(0, 0)]
        candidates = set()
        for (r, c) in self.stones.keys():
            for dr in range(-max_distance, max_distance + 1):
                for dc in range(-max_distance, max_distance + 1):
                    cand = (r + dr, c + dc)
                    if cand not in self.stones:
                        candidates.add(cand)
        return sorted(list(candidates))

    def get_bounds(self) -> Dict[str, int]:
        if not self.stones:
            return {"min_r": -5, "max_r": 5, "min_c": -5, "max_c": 5}
        rows = [r for r, _ in self.stones.keys()]
        cols = [c for _, c in self.stones.keys()]
        return {
            "min_r": min(rows), "max_r": max(rows),
            "min_c": min(cols), "max_c": max(cols)
        }

    def to_dict(self) -> Dict[str, Any]:
        bounds = self.get_bounds()
        return {
            "size": 0,
            "rule": "standard",
            "is_unlimited": True,
            "bounds": bounds,
            "moves": self.moves,
            "stones": [{"row": r, "col": c, "player": p} for (r, c), p in self.stones.items()],
            "current_player": self.current_player,
            "placements": self.placements,
            "eliminated_players": self.eliminated_players,
            "active_players": self.get_active_players(),
            "is_draw": self.is_draw,
            "move_count": len(self.moves),
            "last_move": self.moves[-1] if self.moves else None,
            "player_count": len(self.player_symbols),
        }
