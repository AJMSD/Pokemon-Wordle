-- Phase 4: Ball Progression System

-- Replace wrong achievement balls
DELETE FROM public.ball_catalog WHERE category = 'achievement';

INSERT INTO public.ball_catalog (id, display_name, description, category, unlock_condition) VALUES
  ('quick-ball',  'Quick Ball',  'For trainers who strike fast.',              'achievement', '{"hint": "Solve a puzzle in 1 or 2 guesses"}'),
  ('timer-ball',  'Timer Ball',  'For trainers who never give up.',            'achievement', '{"hint": "Win on your very last guess (10th)"}'),
  ('luxury-ball', 'Luxury Ball', 'For trainers who have earned their place.',  'achievement', '{"hint": "Build a 7-day participation streak"}'),
  ('net-ball',    'Net Ball',    'For trainers who love Water and Bug types.', 'achievement', '{"hint": "Participate on 10 Water or Bug-type days"}'),
  ('heal-ball',   'Heal Ball',   'For trainers who bounce back.',              'achievement', '{"hint": "Win 3 times in a row after a loss"}');

-- Add tracking columns to user_stats
ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS water_bug_daily_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins_after_loss_streak INTEGER NOT NULL DEFAULT 0;
