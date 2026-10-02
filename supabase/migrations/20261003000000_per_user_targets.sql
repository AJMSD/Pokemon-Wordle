-- Per-user daily targets (from PER_USER_START_DATE in src/logic/dailyTarget.ts).
-- Each session pins its own Pokémon when created; legacy days keep using the
-- shared daily_puzzles row via puzzle_id.
ALTER TABLE public.daily_sessions
  ADD COLUMN IF NOT EXISTS target_pokemon_id INTEGER,
  ADD COLUMN IF NOT EXISTS target_pokemon_name TEXT,
  ADD COLUMN IF NOT EXISTS target_pokemon_data JSONB;

-- PokéAPI facts per Pokémon (name, ability, generation, types), filled lazily
-- the first time a target needs them so hot paths never call PokéAPI twice.
CREATE TABLE IF NOT EXISTS public.pokemon_info (
  pokemon_id   INTEGER PRIMARY KEY,
  pokemon_name TEXT NOT NULL,
  pokemon_data JSONB NOT NULL
);

-- Service role only (it bypasses RLS); no policies for anon/authenticated.
ALTER TABLE public.pokemon_info ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
