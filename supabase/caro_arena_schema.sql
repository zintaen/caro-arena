-- =============================================================================
-- CARO ARENA — Supabase Playground Schema (Prefixed with caro_arena_)
-- Project: https://lvnzcwjxreamelewdwql.supabase.co
-- =============================================================================

-- 1. Match History & Replay Table: caro_arena_battles
CREATE TABLE IF NOT EXISTS public.caro_arena_battles (
  battle_id      TEXT PRIMARY KEY,
  started_at     DOUBLE PRECISION NOT NULL,
  ended_at       DOUBLE PRECISION NOT NULL,
  total_moves    INTEGER NOT NULL DEFAULT 0,
  is_multiplayer BOOLEAN NOT NULL DEFAULT FALSE,
  room_code      TEXT,
  player_order   JSONB NOT NULL DEFAULT '[]'::jsonb,
  placements     JSONB NOT NULL DEFAULT '[]'::jsonb,
  moves_data     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caro_arena_battles_created_at
  ON public.caro_arena_battles (created_at DESC);

-- 2. Global Standings Table: caro_arena_leaderboard
CREATE TABLE IF NOT EXISTS public.caro_arena_leaderboard (
  player_type    TEXT PRIMARY KEY,
  total_points   INTEGER NOT NULL DEFAULT 0,
  battles_played INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  avg_placement  NUMERIC(5,2) NOT NULL DEFAULT 0,
  best_streak    INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Row Level Security (RLS) for Playground Anon Access
ALTER TABLE public.caro_arena_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caro_arena_leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caro_arena_battles_select" ON public.caro_arena_battles;
CREATE POLICY "caro_arena_battles_select"
  ON public.caro_arena_battles FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "caro_arena_battles_insert" ON public.caro_arena_battles;
CREATE POLICY "caro_arena_battles_insert"
  ON public.caro_arena_battles FOR INSERT
  TO anon, authenticated
  WITH CHECK (total_moves >= 1 AND jsonb_typeof(placements) = 'array');

DROP POLICY IF EXISTS "caro_arena_battles_delete" ON public.caro_arena_battles;
CREATE POLICY "caro_arena_battles_delete"
  ON public.caro_arena_battles FOR DELETE
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "caro_arena_leaderboard_select" ON public.caro_arena_leaderboard;
CREATE POLICY "caro_arena_leaderboard_select"
  ON public.caro_arena_leaderboard FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "caro_arena_leaderboard_upsert" ON public.caro_arena_leaderboard;
CREATE POLICY "caro_arena_leaderboard_upsert"
  ON public.caro_arena_leaderboard FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
