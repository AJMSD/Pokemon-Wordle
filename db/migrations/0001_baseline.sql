-- Baseline schema for Wurmple on plain Postgres.
-- Applied by server/migrate.ts; later changes go in new numbered files.

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL,
  password_hash     TEXT,                 -- bcrypt; NULL for Google-only accounts
  email_verified_at TIMESTAMPTZ,
  google_sub        TEXT UNIQUE,
  signup_username   TEXT,                 -- Trainer name chosen at signup, until the profile exists
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Bearer sessions. Only the SHA-256 of the token is stored.
CREATE TABLE auth_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

-- One-time tokens: email verification, password reset, Google login hand-off.
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('verify', 'reset', 'google_login')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX auth_tokens_user_kind_idx ON auth_tokens (user_id, kind);

-- ============================================================
-- BALL CATALOG
-- ============================================================
CREATE TABLE ball_catalog (
  id               TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('standard', 'achievement')),
  unlock_condition JSONB DEFAULT '{}'
);

INSERT INTO ball_catalog (id, display_name, description, category, unlock_condition) VALUES
  ('poke-ball',   'Poké Ball',   'Standard Poké Ball.',                        'standard',    '{}'),
  ('great-ball',  'Great Ball',  'Higher catch rate than Poké Ball.',          'standard',    '{}'),
  ('ultra-ball',  'Ultra Ball',  'Higher catch rate than Great Ball.',         'standard',    '{}'),
  ('master-ball', 'Master Ball', 'Always catches Pokémon.',                    'standard',    '{}'),
  ('quick-ball',  'Quick Ball',  'For trainers who strike fast.',              'achievement', '{"hint": "Solve a puzzle in 1 or 2 guesses"}'),
  ('timer-ball',  'Timer Ball',  'For trainers who never give up.',            'achievement', '{"hint": "Win on your very last guess (10th)"}'),
  ('luxury-ball', 'Luxury Ball', 'For trainers who have earned their place.',  'achievement', '{"hint": "Build a 7-day participation streak"}'),
  ('net-ball',    'Net Ball',    'For trainers who love Water and Bug types.', 'achievement', '{"hint": "Participate on 10 Water or Bug-type days"}'),
  ('heal-ball',   'Heal Ball',   'For trainers who bounce back.',              'achievement', '{"hint": "Win 3 times in a row after a loss"}');

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE profiles (
  id                            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username                      TEXT UNIQUE NOT NULL,
  avatar_config                 JSONB DEFAULT '{}',
  display_ball                  TEXT DEFAULT 'poke-ball',
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW(),
  tier_prompt_dismissed_forever BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT profiles_username_length_chk CHECK (char_length(username) BETWEEN 3 AND 20),
  CONSTRAINT profiles_display_ball_fkey FOREIGN KEY (display_ball) REFERENCES ball_catalog(id)
);
CREATE UNIQUE INDEX profiles_username_lower_key ON profiles (lower(username));

-- ============================================================
-- DAILY PUZZLES (shared targets for days before per-user targets)
-- ============================================================
CREATE TABLE daily_puzzles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puzzle_date_key TEXT UNIQUE NOT NULL, -- YYYY-MM-DD in JST
  pokemon_id      INTEGER NOT NULL,
  pokemon_name    TEXT NOT NULL,
  pokemon_data    JSONB NOT NULL,       -- ability, generation, types
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_puzzles_date_key_chk CHECK (puzzle_date_key ~ '^\d{4}-\d{2}-\d{2}$')
);

-- ============================================================
-- DAILY SESSIONS
-- ============================================================
CREATE TABLE daily_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id            TEXT,
  puzzle_date_key     TEXT NOT NULL,
  guesses             TEXT[] DEFAULT '{}',
  hint_flags          JSONB DEFAULT '{"ability": false, "generation": false, "type": false}',
  completion_state    TEXT DEFAULT 'playing',
  version             INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  puzzle_id           UUID REFERENCES daily_puzzles(id) ON DELETE CASCADE,
  -- Per-user target pinned at creation (secret: never sent while playing).
  target_pokemon_id   INTEGER,
  target_pokemon_name TEXT,
  target_pokemon_data JSONB,
  CONSTRAINT daily_sessions_completion_state_check
    CHECK (completion_state IN ('playing', 'won', 'lost', 'missed')),
  CONSTRAINT session_owner CHECK (
    (user_id IS NOT NULL AND guest_id IS NULL) OR
    (user_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT daily_sessions_date_key_chk CHECK (puzzle_date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT daily_sessions_guesses_len_chk CHECK (cardinality(guesses) <= 10),
  UNIQUE (user_id, puzzle_date_key),
  UNIQUE (guest_id, puzzle_date_key)
);
CREATE INDEX idx_daily_sessions_puzzle_id ON daily_sessions (puzzle_id);

-- ============================================================
-- DAILY RESULTS
-- ============================================================
CREATE TABLE daily_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_date_key TEXT NOT NULL,
  pokemon_name    TEXT NOT NULL,
  guesses         TEXT[] NOT NULL,
  guess_count     INTEGER NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('won', 'lost')),
  completed_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_results_date_key_chk CHECK (puzzle_date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT daily_results_guesses_len_chk CHECK (cardinality(guesses) <= 10),
  UNIQUE (user_id, puzzle_date_key)
);

-- ============================================================
-- USER STATS
-- ============================================================
CREATE TABLE user_stats (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_participations     INTEGER DEFAULT 0,
  games_won                INTEGER DEFAULT 0,
  current_streak           INTEGER DEFAULT 0,
  max_streak               INTEGER DEFAULT 0,
  last_played_date         TEXT,
  guess_distribution       JSONB DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0,"10":0}',
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  total_losses             INTEGER NOT NULL DEFAULT 0,
  participation_streak     INTEGER NOT NULL DEFAULT 0,
  max_participation_streak INTEGER NOT NULL DEFAULT 0,
  last_participation_date  TEXT,
  water_bug_daily_wins     INTEGER NOT NULL DEFAULT 0,
  wins_after_loss_streak   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT user_stats_last_played_chk CHECK (last_played_date ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT user_stats_last_particip_chk CHECK (last_participation_date ~ '^\d{4}-\d{2}-\d{2}$')
);

-- ============================================================
-- BALL UNLOCKS
-- ============================================================
CREATE TABLE ball_unlocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ball_id     TEXT NOT NULL REFERENCES ball_catalog(id),
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, ball_id)
);

-- ============================================================
-- POKÉMON INFO (PokéAPI cache)
-- ============================================================
CREATE TABLE pokemon_info (
  pokemon_id   INTEGER PRIMARY KEY,
  pokemon_name TEXT NOT NULL,
  pokemon_data JSONB NOT NULL
);

-- ============================================================
-- RATE LIMITS
-- ============================================================
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW()
);

-- Atomic fixed-window counter: one upsert per check.
CREATE FUNCTION rate_limit_hit(p_key TEXT, p_window_seconds INTEGER)
RETURNS TABLE (hit_count INTEGER, window_start TIMESTAMPTZ)
LANGUAGE sql
AS $$
  INSERT INTO rate_limits AS r (key, count, window_start)
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

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER daily_sessions_updated_at
  BEFORE UPDATE ON daily_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Every account starts with a stats row.
CREATE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_stats (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_user_created
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- MAINTENANCE (called daily by selfhost/scripts/deploy.sh)
-- ============================================================
CREATE FUNCTION cleanup_stale_rows()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - interval '2 days';
  DELETE FROM daily_sessions
   WHERE user_id IS NULL
     AND puzzle_date_key < to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD');
  DELETE FROM auth_sessions WHERE expires_at < now();
  DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day';
  -- Signups never confirmed within a week.
  DELETE FROM users
   WHERE email_verified_at IS NULL
     AND created_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = users.id);
END;
$$;

-- ============================================================
-- ANALYTICS (read with psql)
-- ============================================================
CREATE VIEW analytics_daily_participation AS
SELECT
  puzzle_date_key,
  COUNT(*) FILTER (WHERE result = 'won') AS wins,
  COUNT(*) FILTER (WHERE result = 'lost') AS losses,
  COUNT(*) AS total_participants
FROM daily_results
GROUP BY puzzle_date_key
ORDER BY puzzle_date_key DESC;

CREATE VIEW analytics_win_rate AS
SELECT
  COUNT(*) AS total_games,
  COUNT(*) FILTER (WHERE result = 'won') AS total_wins,
  ROUND(
    COUNT(*) FILTER (WHERE result = 'won')::numeric / NULLIF(COUNT(*), 0) * 100,
    2
  ) AS win_rate_percent
FROM daily_results;

CREATE VIEW analytics_streak_distribution AS
SELECT
  current_streak,
  COUNT(*) AS user_count
FROM user_stats
GROUP BY current_streak
ORDER BY current_streak ASC;
