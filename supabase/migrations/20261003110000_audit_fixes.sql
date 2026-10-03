-- Audit fixes (stream B). Idempotent: safe to re-run on an existing database.

-- B2: case-insensitive unique usernames + length check (existing rows not re-validated)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles GROUP BY lower(username) HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'profiles has case-insensitive duplicate usernames; skipping profiles_username_lower_key';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key ON public.profiles (lower(username));
  END IF;
END $$;

-- B2/B6: NOT VALID CHECK constraints (enforced for new/updated rows only)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('profiles',       'profiles_username_length_chk',   'CHECK (char_length(username) BETWEEN 3 AND 20)'),
    ('daily_puzzles',  'daily_puzzles_date_key_chk',     'CHECK (puzzle_date_key ~ ''^\d{4}-\d{2}-\d{2}$'')'),
    ('daily_sessions', 'daily_sessions_date_key_chk',    'CHECK (puzzle_date_key ~ ''^\d{4}-\d{2}-\d{2}$'')'),
    ('daily_results',  'daily_results_date_key_chk',     'CHECK (puzzle_date_key ~ ''^\d{4}-\d{2}-\d{2}$'')'),
    ('user_stats',     'user_stats_last_played_chk',     'CHECK (last_played_date ~ ''^\d{4}-\d{2}-\d{2}$'')'),
    ('user_stats',     'user_stats_last_particip_chk',   'CHECK (last_participation_date ~ ''^\d{4}-\d{2}-\d{2}$'')'),
    ('daily_sessions', 'daily_sessions_guesses_len_chk', 'CHECK (cardinality(guesses) <= 10)'),
    ('daily_results',  'daily_results_guesses_len_chk',  'CHECK (cardinality(guesses) <= 10)'),
    ('profiles',       'profiles_display_ball_fkey',     'FOREIGN KEY (display_ball) REFERENCES public.ball_catalog(id)')
  ) AS t(tbl, cname, def)
  LOOP
    IF to_regclass('public.' || c.tbl) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = c.cname AND conrelid = to_regclass('public.' || c.tbl)
       )
    THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.cname, c.def);
      EXCEPTION WHEN undefined_column THEN
        RAISE NOTICE 'skipping %: column missing', c.cname;
      END;
    END IF;
  END LOOP;
END $$;

-- B3: periodic cleanup (called by service_role / cron)
CREATE OR REPLACE FUNCTION public.cleanup_stale_rows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
  DELETE FROM public.daily_sessions
   WHERE user_id IS NULL
     AND puzzle_date_key < to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD');
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_rows() TO service_role;

-- B5: pin search_path on the SECURITY DEFINER signup trigger
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- B7: default privileges for objects created by supabase_admin
DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'skipping supabase_admin default privileges: %', SQLERRM;
END $$;
