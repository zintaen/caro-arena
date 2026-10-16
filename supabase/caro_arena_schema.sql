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

-- =============================================================================
-- 4. User Accounts & Crane Currency Table: caro_arena_users
-- Protected via RLS + SECURITY DEFINER RPCs so pin_hash is never exposed to anon SELECT
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.caro_arena_users (
  user_id      TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  cranes       INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.caro_arena_users ENABLE ROW LEVEL SECURITY;

-- Register a new account (starts with 100 Cranes)
CREATE OR REPLACE FUNCTION public.caro_arena_auth_register(
  p_email TEXT,
  p_display_name TEXT,
  p_pin_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_name  TEXT := trim(p_display_name);
  v_uid   TEXT := 'u_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  v_user  public.caro_arena_users;
BEGIN
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Please enter a valid email address.';
  END IF;
  IF v_name = '' THEN
    v_name := split_part(v_email, '@', 1);
  END IF;
  IF EXISTS (SELECT 1 FROM public.caro_arena_users WHERE email = v_email) THEN
    RAISE EXCEPTION 'An account with this email already exists. Please sign in.';
  END IF;

  INSERT INTO public.caro_arena_users (user_id, email, display_name, pin_hash, cranes)
  VALUES (v_uid, v_email, v_name, p_pin_hash, 100)
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'user_id', v_user.user_id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'cranes', v_user.cranes,
    'updated_at', v_user.updated_at
  );
END;
$$;

-- Sign in with Email + 6-Digit PIN Hash
CREATE OR REPLACE FUNCTION public.caro_arena_auth_login(
  p_email TEXT,
  p_pin_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_user  public.caro_arena_users;
BEGIN
  SELECT * INTO v_user
  FROM public.caro_arena_users
  WHERE email = v_email AND pin_hash = p_pin_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or 6-digit PIN.';
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_user.user_id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'cranes', v_user.cranes,
    'updated_at', v_user.updated_at
  );
END;
$$;

-- Update Display Name, Email, or 6-Digit PIN
CREATE OR REPLACE FUNCTION public.caro_arena_auth_update(
  p_user_id TEXT,
  p_current_pin_hash TEXT,
  p_new_email TEXT,
  p_new_display_name TEXT,
  p_new_pin_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  public.caro_arena_users;
  v_email TEXT := lower(trim(p_new_email));
  v_name  TEXT := trim(p_new_display_name);
BEGIN
  SELECT * INTO v_user
  FROM public.caro_arena_users
  WHERE user_id = p_user_id AND pin_hash = p_current_pin_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current 6-digit PIN is incorrect.';
  END IF;

  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Please enter a valid email address.';
  END IF;

  IF v_email <> v_user.email AND EXISTS (
    SELECT 1 FROM public.caro_arena_users WHERE email = v_email AND user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'That email is already used by another account.';
  END IF;

  UPDATE public.caro_arena_users
  SET email        = v_email,
      display_name = CASE WHEN v_name <> '' THEN v_name ELSE display_name END,
      pin_hash     = COALESCE(NULLIF(p_new_pin_hash, ''), pin_hash),
      updated_at   = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'user_id', v_user.user_id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'cranes', v_user.cranes,
    'updated_at', v_user.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.caro_arena_auth_register(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caro_arena_auth_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caro_arena_auth_update(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
