-- Atomic rate-limit counter. Replaces the read-then-write in
-- supabase/functions/_shared/rateLimit.ts, which let concurrent requests slip
-- past the limit and cost two round trips per check.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_window_seconds INTEGER)
RETURNS TABLE (hit_count INTEGER, window_start TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.rate_limits AS r (key, count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN 1
      ELSE r.count + 1
    END,
    window_start = CASE
      WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN NOW()
      ELSE r.window_start
    END
  RETURNING r.count, r.window_start;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
