"""Battle Royale Game Manager for Caro Arena.
Supports 2-5 players including human. Manages battles, step execution, AI agents.
"""

import uuid
import time
import random
from typing import Dict, Any, Optional, List
from caro_arena.engine.board import CaroBoard, PLAYERS
from caro_arena.engine.laya_agent import LayaPlayer
from caro_arena.engine.jev_agent import JevPlayer
from caro_arena.engine.von_agent import VonPlayer
from caro_arena.engine.mojev_agent import MoJevPlayer
from caro_arena.engine.storage import GameStorage


class GameManager:
    def __init__(self):
        self.storage = GameStorage()
        self.game_id = str(uuid.uuid4())[:8]
        self.started_at = time.time()
        self.ended_at: Optional[float] = None
        self.board: Optional[CaroBoard] = None
        self.players: List[Dict[str, Any]] = []

        self.status = "ready"
        self.is_auto_playing = False
        self.auto_delay_sec = 0.02
        self.last_move_details: Optional[Dict[str, Any]] = None
        self.is_thinking = False
        self.thinking_player = None

        self.battle_number = 1
        self.selected_player_types = ["laya", "jev", "von", "mojev"]

        self.new_game()

    def _create_agent(self, ptype: str, color_name: str) -> Optional[Any]:
        if ptype == "laya":
            return LayaPlayer(name=f"Laya ({color_name})")
        elif ptype == "jev":
            return JevPlayer(name=f"Jev ({color_name})")
        elif ptype == "von":
            return VonPlayer(name=f"Von ({color_name})")
        elif ptype == "mojev":
            return MoJevPlayer(name=f"MoJev ({color_name})")
        return None  # human or unknown → no agent

    def new_game(self, player_types: Optional[List[str]] = None) -> Dict[str, Any]:
        """Starts a fresh battle. Accepts optional player types list."""
        if player_types is not None:
            self.selected_player_types = player_types

        self.game_id = str(uuid.uuid4())[:8]
        self.started_at = time.time()
        self.ended_at = None

        types = self.selected_player_types[:]
        random.shuffle(types)

        n = len(types)
        symbols = PLAYERS[:n]

        self.players = []
        for i, ptype in enumerate(types):
            symbol = symbols[i]
            if ptype == "human":
                agent = None
                name = "Human"
            else:
                agent = self._create_agent(ptype, symbol)
                name = agent.name if agent else ptype.capitalize()
            self.players.append({
                "type": ptype,
                "name": name,
                "agent": agent,
                "symbol": symbol
            })

        self.board = CaroBoard(size=0, rule="standard", player_symbols=symbols)

        self.status = "ready"
        self.is_thinking = False
        self.thinking_player = None
        self.last_move_details = None

        return self.get_state()

    def get_player_name(self, symbol: str) -> str:
        for p in self.players:
            if p["symbol"] == symbol:
                return p["name"]
        return symbol

    def _get_current_player_info(self) -> Optional[Dict[str, Any]]:
        curr = self.board.current_player
        return next((p for p in self.players if p["symbol"] == curr), None)

    def is_human_turn(self) -> bool:
        if self.status == "finished" or self.board is None:
            return False
        info = self._get_current_player_info()
        return info is not None and info["type"] == "human"

    def has_human_player(self) -> bool:
        return any(p["type"] == "human" for p in self.players)

    def play_move(self, r: int, c: int, meta: Optional[Dict[str, Any]] = None) -> bool:
        curr = self.board.current_player
        success = self.board.make_move(r, c, curr, metadata=meta)
        if success:
            self.last_move_details = {
                "player": curr,
                "player_name": self.get_player_name(curr),
                "row": r,
                "col": c,
                "meta": meta or {}
            }
            if self.board.is_game_over():
                self.status = "finished"
                self.ended_at = time.time()
                self._persist_game()
            else:
                self.status = "playing"
        return success

    def undo_human_move(self) -> bool:
        """Undoes moves back to before the human's last stone."""
        if not self.board or not self.board.moves:
            return False
        human_idx = -1
        for i in range(len(self.board.moves) - 1, -1, -1):
            m = self.board.moves[i]
            p_info = next((p for p in self.players if p["symbol"] == m["player"]), None)
            if p_info and p_info["type"] == "human":
                human_idx = i
                break
        if human_idx == -1:
            return False

        keep_moves = self.board.moves[:human_idx]
        symbols = [p["symbol"] for p in self.players]
        self.board = CaroBoard(size=0, rule="standard", player_symbols=symbols)
        for m in keep_moves:
            self.board.make_move(m["row"], m["col"], m["player"], metadata=m.get("metadata"))
        self.status = "playing"
        self.last_move_details = keep_moves[-1] if keep_moves else None
        return True

    def human_move(self, r: int, c: int) -> Optional[Dict[str, Any]]:
        """Place a stone for the human player."""
        if not self.is_human_turn():
            return None
        meta = {"row": r, "col": c, "latency_ms": 0, "reasoning": "Human move"}
        success = self.play_move(r, c, meta=meta)
        if not success:
            return None
        return self.get_state()

    def step(self) -> Dict[str, Any]:
        """Executes one turn for the current AI player. Skips human turns."""
        if self.status == "finished":
            return self.get_state()

        if self.is_human_turn():
            return self.get_state()

        player_info = self._get_current_player_info()
        if not player_info or not player_info["agent"]:
            return self.get_state()

        agent = player_info["agent"]
        curr_symbol = player_info["symbol"]
        self.is_thinking = True
        self.thinking_player = player_info["name"]

        try:
            move_info = agent.choose_move(self.board, curr_symbol)
            r, c = move_info["row"], move_info["col"]
            self.play_move(r, c, meta=move_info)
        finally:
            self.is_thinking = False
            self.thinking_player = None

        return self.get_state()

    def _persist_game(self):
        player_order = [{"type": p["type"], "symbol": p["symbol"]} for p in self.players]

        placements = []
        for pl in self.board.placements:
            ptype = next((p["type"] for p in self.players if p["symbol"] == pl["player"]), "unknown")
            placements.append({
                "symbol": pl["player"],
                "type": ptype,
                "rank": pl["rank"],
                "move_number": pl["move_number"],
                "winning_line": pl.get("winning_line")
            })

        duration = (self.ended_at or time.time()) - self.started_at

        self.storage.save_battle(
            battle_id=self.game_id,
            started_at=self.started_at,
            ended_at=self.ended_at or time.time(),
            player_order=player_order,
            placements=placements,
            total_moves=len(self.board.moves),
            duration_sec=duration,
            moves_data=self.board.moves
        )

    def get_state(self) -> Dict[str, Any]:
        curr_symbol = self.board.current_player
        curr_player = next((p for p in self.players if p["symbol"] == curr_symbol), None)

        safe_players = []
        for p in self.players:
            safe_players.append({
                "type": p["type"],
                "name": p["name"],
                "symbol": p["symbol"]
            })

        return {
            "game_id": self.game_id,
            "status": self.status,
            "is_auto_playing": self.is_auto_playing,
            "auto_delay_sec": self.auto_delay_sec,
            "board": self.board.to_dict(),
            "players": safe_players,
            "current_player": {
                "type": curr_player["type"] if curr_player else None,
                "name": curr_player["name"] if curr_player else None,
                "symbol": curr_symbol
            },
            "is_thinking": self.is_thinking,
            "thinking_player": self.thinking_player,
            "last_move_details": self.last_move_details,
            "is_human_turn": self.is_human_turn(),
            "has_human": self.has_human_player(),
            "series": {
                "battle_number": self.battle_number
            }
        }
