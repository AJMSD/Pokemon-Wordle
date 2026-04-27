-- Phase 14: Analytics views (read-only, no table changes)

CREATE OR REPLACE VIEW analytics_daily_participation
WITH (security_invoker = false)
AS
SELECT
  puzzle_date_key,
  COUNT(*) FILTER (WHERE result = 'win') AS wins,
  COUNT(*) FILTER (WHERE result = 'loss') AS losses,
  COUNT(*) AS total_participants
FROM daily_results
GROUP BY puzzle_date_key
ORDER BY puzzle_date_key DESC;

REVOKE ALL ON analytics_daily_participation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON analytics_daily_participation TO service_role;

---

CREATE OR REPLACE VIEW analytics_win_rate
WITH (security_invoker = false)
AS
SELECT
  COUNT(*) AS total_games,
  COUNT(*) FILTER (WHERE result = 'win') AS total_wins,
  ROUND(
    COUNT(*) FILTER (WHERE result = 'win')::numeric / NULLIF(COUNT(*), 0) * 100,
    2
  ) AS win_rate_percent
FROM daily_results;

REVOKE ALL ON analytics_win_rate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON analytics_win_rate TO service_role;

---

CREATE OR REPLACE VIEW analytics_streak_distribution
WITH (security_invoker = false)
AS
SELECT
  current_streak,
  COUNT(*) AS user_count
FROM user_stats
GROUP BY current_streak
ORDER BY current_streak ASC;

REVOKE ALL ON analytics_streak_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON analytics_streak_distribution TO service_role;
