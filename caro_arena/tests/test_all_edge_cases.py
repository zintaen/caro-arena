import unittest
import tempfile
import os
from caro_arena.engine.board import CaroBoard
from caro_arena.engine.evaluator import TacticalEvaluator
from caro_arena.engine.laya_agent import LayaPlayer
from caro_arena.engine.jev_agent import JevPlayer
from caro_arena.engine.von_agent import VonPlayer
from caro_arena.engine.mojev_agent import MoJevPlayer
from caro_arena.engine.game_manager import GameManager
from caro_arena.engine.storage import GameStorage

class TestCaroArenaEdgeCases(unittest.TestCase):
    def setUp(self):
        self.board = CaroBoard()

    def test_default_roster(self):
        gm = GameManager()
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

        # Diagonal 5-in-a-row
        b2 = CaroBoard()
        for i in range(4):
            b2.make_move(i, i, "B")
        b2.make_move(4, 4, "B")
        self.assertTrue(len(b2.placements) >= 1)
        self.assertEqual(b2.placements[0]["player"], "B")

    def test_tactical_evaluator_candidates(self):
        self.board.make_move(0, 0, "A")
        candidates = self.board.get_candidate_moves(max_distance=2)
        self.assertTrue(len(candidates) > 0)
        self.assertNotIn((0, 0), candidates)

        ranked = TacticalEvaluator.get_ranked_candidates(self.board, "A")
        self.assertTrue(len(ranked) > 0)
        self.assertIn("total_score", ranked[0])

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
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            db_path = tmp.name
        try:
            storage = GameStorage(db_path=db_path)
            # Record a match with 4 players: jev=1st, laya=2nd, von=3rd, mojev=4th
            placements = [
                {"type": "jev", "name": "Jev", "rank": 1, "symbol": "A"},
                {"type": "laya", "name": "Laya", "rank": 2, "symbol": "B"},
                {"type": "von", "name": "Von", "rank": 3, "symbol": "C"},
                {"type": "mojev", "name": "MoJev", "rank": 4, "symbol": "D"},
            ]
            moves = [{"move_number": 1, "player": "A", "row": 0, "col": 0}]
            storage.save_battle(
                battle_id="b1",
                started_at=100.0,
                ended_at=105.0,
                player_order=[{"type": "jev"}, {"type": "laya"}, {"type": "von"}, {"type": "mojev"}],
                placements=placements,
                total_moves=1,
                duration_sec=5.0,
                moves_data=moves
            )

            leaderboard = storage.get_leaderboard()
            self.assertEqual(len(leaderboard), 4)
            # N=4: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt
            jev_stat = next(p for p in leaderboard if p["player_type"] == "jev")
            self.assertEqual(jev_stat["total_points"], 4)
            self.assertEqual(jev_stat["wins"], 1)

            mojev_stat = next(p for p in leaderboard if p["player_type"] == "mojev")
            self.assertEqual(mojev_stat["total_points"], 1)
            self.assertEqual(mojev_stat["wins"], 0)
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)

if __name__ == "__main__":
    unittest.main()
