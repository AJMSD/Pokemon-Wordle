-- Validate the NOT VALID constraints added in 20261003110000_audit_fixes.sql.
-- Prod data was checked first (0 violating rows). On any other database a
-- violation only logs a NOTICE, so this never blocks a deploy.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND NOT convalidated
      AND conname IN (
        'profiles_username_length_chk',
        'profiles_display_ball_fkey',
        'daily_puzzles_date_key_chk',
        'daily_sessions_date_key_chk',
        'daily_sessions_guesses_len_chk',
        'daily_results_date_key_chk',
        'daily_results_guesses_len_chk',
        'user_stats_last_played_chk',
        'user_stats_last_particip_chk'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'not validating %: existing rows violate it', c.conname;
    END;
  END LOOP;
END $$;
