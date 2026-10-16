import unittest
import tempfile
import os
from pathlib import Path
from fastapi.testclient import TestClient
from caro_arena.engine.board import CaroBoard
from caro_arena.engine.evaluator import TacticalEvaluator
from caro_arena.engine.laya_agent import LayaPlayer
from caro_arena.engine.jev_agent import JevPlayer
from caro_arena.engine.von_agent import VonPlayer
from caro_arena.engine.mojev_agent import MoJevPlayer
from caro_arena.engine.game_manager import GameManager
from caro_arena.engine.storage import GameStorage
from caro_arena.main import app, manager


class TestCaroArenaEdgeCases(unittest.TestCase):
    def setUp(self):
        self.board = CaroBoard()
        self._tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp_db.close()
        self.db_path = self._tmp_db.name

    def tearDown(self):
        if os.path.exists(self.db_path):
            try:
                os.remove(self.db_path)
            except OSError:
                pass

    def test_default_roster(self):
        gm = GameManager(storage=GameStorage(db_path=self.db_path))
        # Default roster must only contain the 4 AI models; Human is opt-in
        self.assertEqual(gm.selected_player_types, ["laya", "jev", "von", "mojev"])
        self.assertNotIn("human", gm.selected_player_types)
        self.assertFalse(gm.has_human_player())

    def test_infinite_grid_coordinates(self):
        # Support arbitrary negative and positive coordinates
        coords = [(-100, -200), (0, 0), (100, 500)]
        for r, c in coords:
            success = self.board.make_move(r, c, "A")
            self.assertTrue(success)
            self.assertEqual(self.board.get_cell(r, c), "A")
            self.assertFalse(self.board.is_legal_move(r, c))

    def test_five_in_a_row_detection(self):
        # Test horizontal 5-in-a-row
        for c in range(4):
            self.board.make_move(10, c, "A")
        # 5th stone
        self.board.make_move(10, 4, "A")
        self.assertTrue(len(self.board.placements) >= 1)
        self.assertEqual(self.board.placements[0]["player"], "A")
        self.assertEqual(len(self.board.placements[0]["winning_line"]), 5)

        # Overline (6-in-a-row) preserves full winning_line coordinates
        b2 = CaroBoard()
        for c in range(4):
            b2.make_move(0, c, "B")
        for c in range(5, 9):
            b2.make_move(0, c, "B")
        b2.make_move(0, 4, "B")
        self.assertEqual(len(b2.placements[0]["winning_line"]), 9)

    def test_tactical_evaluator_candidates_and_multiplayer_block(self):
        self.board.make_move(0, 0, "A")
        candidates = self.board.get_candidate_moves(max_distance=2)
        self.assertTrue(len(candidates) > 0)
        self.assertNotIn((0, 0), candidates)

        ranked = TacticalEvaluator.get_ranked_candidates(self.board, "A")
        self.assertTrue(len(ranked) > 0)
        self.assertIn("total_score", ranked[0])

        # In 4-player FFA, blocking an opponent's immediate 5-in-a-row threat must be critical (>= 20000)
        b_ffa = CaroBoard(player_symbols=["A", "B", "C", "D"])
        for c in range(4):
            b_ffa.make_move(0, c, "B")
        res = TacticalEvaluator.evaluate_move(b_ffa, 0, 4, "A")
        self.assertTrue(res["is_critical"])
        self.assertGreaterEqual(res["total_score"], 20000.0)

        # AI agents must prioritize blocking an immediate 5-in-a-row threat in 4-player FFA
        for agent in [LayaPlayer("Laya"), JevPlayer("Jev"), VonPlayer("Von"), MoJevPlayer("MoJev")]:
            choice = agent.choose_move(b_ffa, "A")
            self.assertIn((choice["row"], choice["col"]), [(0, 4), (0, -1)])

    def test_agent_move_selection(self):
        agents = [
            LayaPlayer("Laya"),
            JevPlayer("Jev"),
            VonPlayer("Von"),
            MoJevPlayer("MoJev")
        ]
        for agent in agents:
            b = CaroBoard()
            b.make_move(0, 0, "A")
            decision = agent.choose_move(b, "B")
            r = decision["row"]
            c = decision["col"]
            self.assertIsInstance(r, int)
            self.assertIsInstance(c, int)
            self.assertTrue(b.is_legal_move(r, c))

    def test_sequential_elimination_placements(self):
        # 3-player battle royale: A, B, C
        board = CaroBoard(player_symbols=["A", "B", "C"])
        self.assertEqual(len(board.get_active_players()), 3)

        # A completes 5-in-a-row
        for c in range(5):
            board.make_move(0, c, "A")
        self.assertEqual(len(board.placements), 1)
        self.assertEqual(board.placements[0]["player"], "A")
        self.assertEqual(board.placements[0]["rank"], 1)
        self.assertNotIn("A", board.get_active_players())
        self.assertFalse(board.is_game_over())

        # B completes 5-in-a-row
        for c in range(5):
            board.make_move(5, c, "B")
        # With 2 out of 3 placed, C automatically receives 3rd place and game ends
        self.assertTrue(board.is_game_over())
        self.assertEqual(len(board.placements), 3)
        self.assertEqual(board.placements[1]["player"], "B")
        self.assertEqual(board.placements[1]["rank"], 2)
        self.assertEqual(board.placements[2]["player"], "C")
        self.assertEqual(board.placements[2]["rank"], 3)

    def test_storage_and_leaderboard_scoring(self):
        storage = GameStorage(db_path=self.db_path)
        # Battle 1 (started_at=100): jev=1st, laya=2nd, von=3rd, mojev=4th
        storage.save_battle(
            battle_id="b1",
            started_at=100.0,
            ended_at=105.0,
            player_order=[{"type": "jev"}, {"type": "laya"}, {"type": "von"}, {"type": "mojev"}],
            placements=[
                {"type": "jev", "name": "Jev", "rank": 1, "symbol": "A"},
                {"type": "laya", "name": "Laya", "rank": 2, "symbol": "B"},
                {"type": "von", "name": "Von", "rank": 3, "symbol": "C"},
                {"type": "mojev", "name": "MoJev", "rank": 4, "symbol": "D"},
            ],
            total_moves=1,
            duration_sec=5.0,
            moves_data=[{"move_number": 1, "player": "A", "row": 0, "col": 0}]
        )
        # Battle 2 (started_at=200): laya=1st, jev=2nd, von=3rd, mojev=4th
        storage.save_battle(
            battle_id="b2",
            started_at=200.0,
            ended_at=205.0,
            player_order=[{"type": "laya"}, {"type": "jev"}, {"type": "von"}, {"type": "mojev"}],
            placements=[
                {"type": "laya", "name": "Laya", "rank": 1, "symbol": "A"},
                {"type": "jev", "name": "Jev", "rank": 2, "symbol": "B"},
                {"type": "von", "name": "Von", "rank": 3, "symbol": "C"},
                {"type": "mojev", "name": "MoJev", "rank": 4, "symbol": "D"},
            ],
            total_moves=1,
            duration_sec=5.0,
            moves_data=[{"move_number": 1, "player": "A", "row": 0, "col": 0}]
        )

        leaderboard = storage.get_leaderboard()
        self.assertEqual(len(leaderboard), 4)
        # Both jev and laya have 7 pts, 1 win, 1.5 avg placement, 2 battles played;
        # jev won first chronologically (b1 at t=100) so jev must rank #1
        self.assertEqual(leaderboard[0]["player_type"], "jev")
        self.assertEqual(leaderboard[1]["player_type"], "laya")
        self.assertEqual(leaderboard[0]["total_points"], 7)

        # Multi-human battle deduplication: only best placement per player_type per battle counts
        storage.save_battle(
            battle_id="b3",
            started_at=300.0,
            ended_at=305.0,
            player_order=[{"type": "human"}, {"type": "human"}],
            placements=[
                {"type": "human", "name": "Host", "rank": 1, "symbol": "A"},
                {"type": "human", "name": "Guest", "rank": 2, "symbol": "B"},
            ],
            total_moves=9,
            duration_sec=5.0,
            moves_data=[]
        )
        lb2 = storage.get_leaderboard()
        human_stat = next(p for p in lb2 if p["player_type"] == "human")
        self.assertEqual(human_stat["battles_played"], 1)
        self.assertEqual(human_stat["wins"], 1)

    def test_undo_human_move_and_finished_battle_cleanup(self):
        storage = GameStorage(db_path=self.db_path)
        gm = GameManager(storage=storage)
        gm.new_game(player_types=["human", "von"])
        # Force human to be symbol A and von to be symbol B for deterministic sequence
        gm.players = [
            {"symbol": "A", "type": "human", "name": "Human", "agent": None},
            {"symbol": "B", "type": "von", "name": "Von", "agent": VonPlayer("Von")},
        ]
        gm.board = CaroBoard(player_symbols=["A", "B"])

        # Play 4 moves for A and 4 moves for B, then B wins on 5th move
        for i in range(4):
            gm.human_move(0, i)
            gm.play_move(1, i, meta={"row": 1, "col": i, "latency_ms": 5})
        gm.human_move(5, 5)
        # B makes winning 5th move
        gm.play_move(1, 4, meta={"row": 1, "col": 4, "latency_ms": 5})
        self.assertEqual(gm.status, "finished")
        self.assertEqual(len(storage.get_battle_history()), 1)

        # Undoing human move reopens game and deletes the finished battle record
        undone = gm.undo_human_move()
        self.assertTrue(undone)
        self.assertEqual(gm.status, "playing")
        self.assertEqual(len(storage.get_battle_history()), 0)
        self.assertIsInstance(gm.last_move_details, dict)
        self.assertEqual(gm.last_move_details["player"], "B")
        self.assertIn("meta", gm.last_move_details)

    def test_api_validation_and_csrf_protection(self):
        orig_storage = manager.storage
        try:
            manager.storage = GameStorage(db_path=self.db_path)
            client = TestClient(app)

            # GET /api/history/clear must be rejected (405 Method Not Allowed)
            r_get = client.get("/api/history/clear")
            self.assertEqual(r_get.status_code, 405)

            # POST /api/history/clear must succeed
            r_post = client.post("/api/history/clear")
            self.assertEqual(r_post.status_code, 200)

            # Invalid rosters must return HTTP 400
            r_empty = client.post("/api/battle/new", json={"players": []})
            self.assertEqual(r_empty.status_code, 400)

            r_one = client.post("/api/battle/new", json={"players": ["laya"]})
            self.assertEqual(r_one.status_code, 400)

            r_six = client.post("/api/battle/new", json={"players": ["laya", "jev", "von", "mojev", "human", "laya"]})
            self.assertEqual(r_six.status_code, 400)

            r_unknown = client.post("/api/battle/new", json={"players": ["laya", "invalid_bot"]})
            self.assertEqual(r_unknown.status_code, 400)

            # Valid roster succeeds
            r_valid = client.post("/api/battle/new", json={"players": ["laya", "jev"]})
            self.assertEqual(r_valid.status_code, 200)
        finally:
            manager.storage = orig_storage

    def test_static_assets_synchronized(self):
        root = Path(__file__).resolve().parent.parent.parent
        docs = root / "docs"
        static = root / "caro_arena" / "static"
        assets = [
            "index.html",
            "app.js",
            "engine.js",
            "multiplayer.js",
            "audio.js",
            "style.css",
            "supabase-config.js",
            "manifest.json",
            "icon.svg",
        ]
        for name in assets:
            root_bytes = (root / name).read_bytes()
            docs_bytes = (docs / name).read_bytes()
            static_bytes = (static / name).read_bytes()
            self.assertEqual(root_bytes, docs_bytes, f"docs/{name} is out of sync with root/{name}")
            self.assertEqual(root_bytes, static_bytes, f"caro_arena/static/{name} is out of sync with root/{name}")

    def test_per_session_backend_isolation(self):
        orig_storage = manager.storage
        try:
            manager.storage = GameStorage(db_path=self.db_path)
            client = TestClient(app)

            # Session A starts a 2-player battle (laya vs jev)
            r_a = client.post(
                "/api/battle/new",
                headers={"X-Caro-Session": "session_alpha"},
                json={"players": ["laya", "jev"]},
            )
            self.assertEqual(r_a.status_code, 200)
            state_a = r_a.json()
            self.assertEqual(len(state_a["players"]), 2)

            # Session B starts a 3-player battle (von vs mojev vs human)
            r_b = client.post(
                "/api/battle/new",
                headers={"X-Caro-Session": "session_beta"},
                json={"players": ["von", "mojev", "human"]},
            )
            self.assertEqual(r_b.status_code, 200)
            state_b = r_b.json()
            self.assertEqual(len(state_b["players"]), 3)
            self.assertNotEqual(state_a["game_id"], state_b["game_id"])

            # Verify Session A's state was NOT overwritten by Session B
            curr_a = client.get("/api/battle/current", headers={"X-Caro-Session": "session_alpha"}).json()
            curr_b = client.get("/api/battle/current?session=session_beta").json()
            self.assertEqual(curr_a["game_id"], state_a["game_id"])
            self.assertEqual(len(curr_a["players"]), 2)
            self.assertEqual(curr_b["game_id"], state_b["game_id"])
            self.assertEqual(len(curr_b["players"]), 3)
        finally:
            manager.storage = orig_storage


if __name__ == "__main__":
    unittest.main()


