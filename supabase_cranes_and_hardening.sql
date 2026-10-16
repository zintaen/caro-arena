-- ============================================================================
-- CARO ARENA — PIN Lockout Hardening & Cranes Economy RPCs
-- Run this script in your Supabase SQL Editor (Project: fdfchdlogebbqabvtwbd)
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- 1. Add PIN brute-force rate-limiting & daily bonus columns to caro_arena_users
ALTER TABLE public.caro_arena_users
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_daily_bonus_at timestamptz NULL;

-- 2. Upgrade Login RPC with 5-attempt / 5-minute brute-force lockout
CREATE OR REPLACE FUNCTION public.caro_arena_auth_login(
  p_email text,
  p_pin_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.caro_arena_users;
  v_clean_email text := lower(trim(coalesce(p_email, '')));
  v_rem_sec integer;
BEGIN
  SELECT * INTO v_user
  FROM public.caro_arena_users
  WHERE lower(email) = v_clean_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or 6-digit PIN.';
  END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > now() THEN
    v_rem_sec := greatest(1, ceil(extract(epoch FROM (v_user.locked_until - now())))::integer);
    RAISE EXCEPTION 'Too many failed PIN attempts. Account locked for %s.', v_rem_sec;
  END IF;

  IF v_user.pin_hash <> p_pin_hash THEN
    UPDATE public.caro_arena_users
    SET
      failed_attempts = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
        ELSE failed_attempts + 1
      END,
      locked_until = CASE
        WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_attempts + 1 END) >= 5
        THEN now() + interval '5 minutes'
        ELSE NULL
      END
    WHERE id = v_user.id
    RETURNING * INTO v_user;

    IF v_user.locked_until IS NOT NULL AND v_user.locked_until > now() THEN
      RAISE EXCEPTION 'Too many failed PIN attempts (5/5). Account locked for 5 minutes.';
    END IF;
    RAISE EXCEPTION 'Invalid email or 6-digit PIN.';
  END IF;

  UPDATE public.caro_arena_users
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = v_user.id
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'cranes', v_user.cranes,
    'updated_at', v_user.updated_at
  );
END;
$$;

-- 3. Cranes Balance Adjustment RPC (Match Rewards, Wagers, Theme Unlocks)
CREATE OR REPLACE FUNCTION public.caro_arena_adjust_cranes(
  p_user_id uuid,
  p_delta integer,
  p_reason text DEFAULT 'match_reward'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.caro_arena_users;
BEGIN
  UPDATE public.caro_arena_users
  SET
    cranes = greatest(0, cranes + coalesce(p_delta, 0)),
    updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found.';
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'cranes', v_user.cranes,
    'reason', coalesce(p_reason, 'match_reward'),
    'updated_at', v_user.updated_at
  );
END;
$$;

-- 4. Daily Login Bonus RPC (+25 Cranes once per 24h)
CREATE OR REPLACE FUNCTION public.caro_arena_claim_daily_bonus(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.caro_arena_users;
BEGIN
  SELECT * INTO v_user
  FROM public.caro_arena_users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found.';
  END IF;

  IF v_user.last_daily_bonus_at IS NOT NULL AND v_user.last_daily_bonus_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Daily bonus already claimed in the last 24 hours.';
  END IF;

  UPDATE public.caro_arena_users
  SET
    cranes = cranes + 25,
    last_daily_bonus_at = now(),
    updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'cranes', v_user.cranes,
    'bonus', 25,
    'last_daily_bonus_at', v_user.last_daily_bonus_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.caro_arena_auth_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caro_arena_adjust_cranes(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caro_arena_claim_daily_bonus(uuid) TO anon, authenticated;
