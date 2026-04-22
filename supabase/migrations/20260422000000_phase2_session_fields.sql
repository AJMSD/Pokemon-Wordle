-- Add puzzle_id FK
ALTER TABLE public.daily_sessions
  ADD COLUMN puzzle_id UUID REFERENCES public.daily_puzzles(id) ON DELETE CASCADE;

-- Extend completion_state to include 'missed'
ALTER TABLE public.daily_sessions
  DROP CONSTRAINT daily_sessions_completion_state_check;

ALTER TABLE public.daily_sessions
  ADD CONSTRAINT daily_sessions_completion_state_check
  CHECK (completion_state IN ('playing', 'won', 'lost', 'missed'));

-- Index for puzzle_id lookups
CREATE INDEX idx_daily_sessions_puzzle_id ON public.daily_sessions(puzzle_id);
