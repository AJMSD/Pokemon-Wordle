-- Rename games_played to total_participations
ALTER TABLE public.user_stats
  RENAME COLUMN games_played TO total_participations;

-- Add missing stat columns
ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS total_losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS participation_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_participation_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_participation_date TEXT;
