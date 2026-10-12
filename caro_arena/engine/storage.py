import sqlite3
import json
from typing import Dict, Any, List, Optional
import os

DB_PATH = "arena.db"

class GameStorage:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_conn(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._get_conn() as conn:
            # Keep legacy games table for backward compatibility
            conn.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    game_id TEXT PRIMARY KEY,
                    started_at REAL,
                    ended_at REAL,
                    black_player TEXT,
                    white_player TEXT,
                    winner TEXT,
                    winning_line TEXT,
                    board_size INTEGER,
                    rule TEXT,
                    moves TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS battles (
                    battle_id TEXT PRIMARY KEY,
                    started_at REAL,
                    ended_at REAL,
                    player_order TEXT,
                    placements TEXT,
                    total_moves INTEGER,
                    duration_sec REAL,
                    moves_data TEXT
                )
            """)
            conn.commit()

    def save_battle(self, battle_id: str, started_at: float, ended_at: float, 
                    player_order: List[Dict], placements: List[Dict], 
                    total_moves: int, duration_sec: float, moves_data: List[Dict]):
        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO battles 
                (battle_id, started_at, ended_at, player_order, placements, total_moves, duration_sec, moves_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                battle_id, started_at, ended_at,
                json.dumps(player_order), json.dumps(placements),
                total_moves, duration_sec, json.dumps(moves_data)
            ))
            conn.commit()

    def get_battle_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT battle_id, started_at, ended_at, player_order, placements, total_moves, duration_sec
                FROM battles ORDER BY started_at DESC LIMIT ?
            """, (limit,)).fetchall()
            
            res = []
            for r in rows:
                res.append({
                    "battle_id": r["battle_id"],
                    "started_at": r["started_at"],
                    "ended_at": r["ended_at"],
                    "player_order": json.loads(r["player_order"]),
                    "placements": json.loads(r["placements"]),
                    "total_moves": r["total_moves"],
                    "duration_sec": r["duration_sec"]
                })
            return res

    def get_battle(self, battle_id: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM battles WHERE battle_id = ?", (battle_id,)).fetchone()
            if not row:
                return None
            return {
                "battle_id": row["battle_id"],
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "player_order": json.loads(row["player_order"]),
                "placements": json.loads(row["placements"]),
                "total_moves": row["total_moves"],
                "duration_sec": row["duration_sec"],
                "moves_data": json.loads(row["moves_data"])
            }

    def get_leaderboard(self) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT placements FROM battles").fetchall()
            
            stats = {}
            # Discover player types from battle data (no hardcoding)
            
            for row in rows:
                placements = json.loads(row["placements"])
                for pl in placements:
                    ptype = pl["type"]
                    rank = pl["rank"]
                    if ptype not in stats:
                        stats[ptype] = {"points": 0, "battles": 0, "wins": 0, "ranks_sum": 0, "best_streak": 0, "current_streak": 0}
                    
                    stats[ptype]["battles"] += 1
                    stats[ptype]["ranks_sum"] += rank
                    
                    total_p = len(placements)
                    pts = max(1, total_p - rank + 1)
                    stats[ptype]["points"] += pts
                    
                    if rank == 1:
                        stats[ptype]["wins"] += 1
                        stats[ptype]["current_streak"] += 1
                        if stats[ptype]["current_streak"] > stats[ptype]["best_streak"]:
                            stats[ptype]["best_streak"] = stats[ptype]["current_streak"]
                    else:
                        stats[ptype]["current_streak"] = 0
            
            res = []
            for ptype, s in stats.items():
                res.append({
                    "player_type": ptype,
                    "total_points": s["points"],
                    "battles_played": s["battles"],
                    "wins": s["wins"],
                    "avg_placement": round(s["ranks_sum"] / s["battles"], 2) if s["battles"] > 0 else 0,
                    "best_streak": s["best_streak"]
                })
            
            res.sort(key=lambda x: (-x["total_points"], -x["wins"], x["avg_placement"], -x["battles_played"]))
            return res

    def clear_history(self):
        with self._get_conn() as conn:
            conn.execute("DELETE FROM games")
            conn.execute("DELETE FROM battles")
            conn.commit()
