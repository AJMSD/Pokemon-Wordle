-- Initial schema for Pokémon Wordle backend

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_config JSONB DEFAULT '{}',
  display_ball TEXT DEFAULT 'poke-ball',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- DAILY PUZZLES
-- ============================================================
CREATE TABLE public.daily_puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puzzle_date_key TEXT UNIQUE NOT NULL, -- YYYY-MM-DD in JST
  pokemon_id INTEGER NOT NULL,
  pokemon_name TEXT NOT NULL,
  pokemon_data JSONB NOT NULL, -- ability, generation, types cached
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.daily_puzzles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read daily puzzles"
  ON public.daily_puzzles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert daily puzzles"
  ON public.daily_puzzles FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- DAILY SESSIONS
-- ============================================================
CREATE TABLE public.daily_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_id TEXT, -- UUID stored by guests in localStorage
  puzzle_date_key TEXT NOT NULL,
  guesses TEXT[] DEFAULT '{}',
  hint_flags JSONB DEFAULT '{"ability": false, "generation": false, "type": false}',
  completion_state TEXT DEFAULT 'playing' CHECK (completion_state IN ('playing', 'won', 'lost')),
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT session_owner CHECK (
    (user_id IS NOT NULL AND guest_id IS NULL) OR
    (user_id IS NULL AND guest_id IS NOT NULL)
  ),
  UNIQUE (user_id, puzzle_date_key),
  UNIQUE (guest_id, puzzle_date_key)
);

ALTER TABLE public.daily_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sessions"
  ON public.daily_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON public.daily_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all sessions"
  ON public.daily_sessions FOR ALL
  WITH CHECK (true);

-- ============================================================
-- DAILY RESULTS
-- ============================================================
CREATE TABLE public.daily_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  puzzle_date_key TEXT NOT NULL,
  pokemon_name TEXT NOT NULL,
  guesses TEXT[] NOT NULL,
  guess_count INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('won', 'lost')),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, puzzle_date_key)
);

ALTER TABLE public.daily_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own results"
  ON public.daily_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert results"
  ON public.daily_results FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- USER STATS
-- ============================================================
CREATE TABLE public.user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  max_streak INTEGER DEFAULT 0,
  last_played_date TEXT, -- YYYY-MM-DD in JST
  guess_distribution JSONB DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0,"10":0}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own stats"
  ON public.user_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can upsert stats"
  ON public.user_stats FOR ALL
  WITH CHECK (true);

-- ============================================================
-- BALL CATALOG
-- ============================================================
CREATE TABLE public.ball_catalog (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('standard', 'achievement')),
  unlock_condition JSONB DEFAULT '{}'
);

ALTER TABLE public.ball_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ball catalog"
  ON public.ball_catalog FOR SELECT
  USING (true);

-- Seed ball catalog
INSERT INTO public.ball_catalog (id, display_name, description, category) VALUES
  ('poke-ball',   'Poké Ball',   'Standard Poké Ball.',                             'standard'),
  ('great-ball',  'Great Ball',  'Higher catch rate than Poké Ball.',               'standard'),
  ('ultra-ball',  'Ultra Ball',  'Higher catch rate than Great Ball.',              'standard'),
  ('master-ball', 'Master Ball', 'Always catches Pokémon.',                         'standard'),
  ('safari-ball', 'Safari Ball', 'Used in the Safari Zone.',                        'achievement'),
  ('sport-ball',  'Sport Ball',  'Used in the Bug-Catching Contest.',               'achievement'),
  ('fast-ball',   'Fast Ball',   'Better odds against fast Pokémon.',               'achievement'),
  ('heavy-ball',  'Heavy Ball',  'Better odds against heavy Pokémon.',              'achievement'),
  ('love-ball',   'Love Ball',   'Better odds against same-species Pokémon.',       'achievement');

-- ============================================================
-- BALL UNLOCKS
-- ============================================================
CREATE TABLE public.ball_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ball_id TEXT NOT NULL REFERENCES public.ball_catalog(id),
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, ball_id)
);

ALTER TABLE public.ball_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ball unlocks"
  ON public.ball_unlocks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert ball unlocks"
  ON public.ball_unlocks FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- RATE LIMITS
-- ============================================================
CREATE TABLE public.rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role reads/writes rate limits
CREATE POLICY "Service role manages rate limits"
  ON public.rate_limits FOR ALL
  WITH CHECK (true);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER daily_sessions_updated_at
  BEFORE UPDATE ON public.daily_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- TRIGGER: create profile + stats on new user signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_stats (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
