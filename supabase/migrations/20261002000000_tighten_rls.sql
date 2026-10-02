-- Tighten row-level security.
--
-- Every write goes through edge functions using the service role, which
-- bypasses RLS. The "Service role ..." policies below were created without a
-- TO clause, so they applied to PUBLIC and let anyone holding the public
-- anon key insert rows directly (e.g. fake future puzzles, results, unlocks).
-- Clients only ever read their own profile directly; all other access is via
-- edge functions.

DROP POLICY IF EXISTS "Service role can insert ball unlocks" ON public.ball_unlocks;
DROP POLICY IF EXISTS "Service role can insert daily puzzles" ON public.daily_puzzles;
DROP POLICY IF EXISTS "Service role can insert results" ON public.daily_results;
DROP POLICY IF EXISTS "Service role can manage all sessions" ON public.daily_sessions;
DROP POLICY IF EXISTS "Service role manages rate limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Service role can upsert stats" ON public.user_stats;

-- Puzzle rows contain the answer; only edge functions need them.
DROP POLICY IF EXISTS "Authenticated users can read daily puzzles" ON public.daily_puzzles;

-- Sessions and profiles are only modified by validated edge functions
-- (submit-guess, create-profile, update-profile, set-display-ball, ...).
-- Direct updates would bypass guess validation and ball unlock checks.
DROP POLICY IF EXISTS "Users can update own sessions" ON public.daily_sessions;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Defense in depth: clients get read-only table privileges; RLS then limits
-- reads to the caller's own rows.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- Fix analytics views: daily_results.result stores 'won'/'lost', not 'win'/'loss'.
CREATE OR REPLACE VIEW analytics_daily_participation
WITH (security_invoker = false)
AS
SELECT
  puzzle_date_key,
  COUNT(*) FILTER (WHERE result = 'won') AS wins,
  COUNT(*) FILTER (WHERE result = 'lost') AS losses,
  COUNT(*) AS total_participants
FROM daily_results
GROUP BY puzzle_date_key
ORDER BY puzzle_date_key DESC;

CREATE OR REPLACE VIEW analytics_win_rate
WITH (security_invoker = false)
AS
SELECT
  COUNT(*) AS total_games,
  COUNT(*) FILTER (WHERE result = 'won') AS total_wins,
  ROUND(
    COUNT(*) FILTER (WHERE result = 'won')::numeric / NULLIF(COUNT(*), 0) * 100,
    2
  ) AS win_rate_percent
FROM daily_results;

REVOKE ALL ON analytics_daily_participation, analytics_win_rate, analytics_streak_distribution
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON analytics_daily_participation, analytics_win_rate, analytics_streak_distribution
  TO service_role;
