import sqlite3
import json
from contextlib import closing
from typing import Dict, Any, List, Optional
import os

DB_PATH = os.getenv("CARO_ARENA_DB", "arena.db")


class GameStorage:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.getenv("CARO_ARENA_DB", DB_PATH)
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        return closing(conn)

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

    @staticmethod
    def _compact_moves(moves_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        compact = []
        for m in (moves_data or []):
            meta = m.get("metadata") or {}
            slim_meta = {}
            for k in ("latency_ms", "model", "reasoning", "confidence", "is_fallback"):
                if k in meta:
                    slim_meta[k] = meta[k]
            compact.append({
                "move_number": m.get("move_number"),
                "player": m.get("player"),
                "row": m.get("row"),
                "col": m.get("col"),
                "metadata": slim_meta,
            })
        return compact

    def save_battle(self, battle_id: str, started_at: float, ended_at: float, 
                    player_order: List[Dict], placements: List[Dict], 
                    total_moves: int, duration_sec: float, moves_data: List[Dict]):
        compact_moves = self._compact_moves(moves_data)
        with self._get_conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO battles 
                (battle_id, started_at, ended_at, player_order, placements, total_moves, duration_sec, moves_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                battle_id, started_at, ended_at,
                json.dumps(player_order), json.dumps(placements),
                total_moves, duration_sec, json.dumps(compact_moves)
            ))
            conn.commit()

    def delete_battle(self, battle_id: str):
        with self._get_conn() as conn:
            conn.execute("DELETE FROM battles WHERE battle_id = ?", (battle_id,))
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
            rows = conn.execute("SELECT placements FROM battles ORDER BY started_at ASC").fetchall()
            
            stats = {}
            # Discover player types from battle data in chronological order
            for row in rows:
                placements = json.loads(row["placements"])
                total_p = len(placements)
                seen_in_battle = set()
                for pl in sorted(placements, key=lambda x: x.get("rank", 999)):
                    ptype = pl["type"]
                    if ptype in seen_in_battle:
                        continue
                    seen_in_battle.add(ptype)
                    rank = pl["rank"]
                    if ptype not in stats:
                        stats[ptype] = {"points": 0, "battles": 0, "wins": 0, "ranks_sum": 0, "best_streak": 0, "current_streak": 0}
                    
                    stats[ptype]["battles"] += 1
                    stats[ptype]["ranks_sum"] += rank
                    
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
            conn.execute("VACUUM")

