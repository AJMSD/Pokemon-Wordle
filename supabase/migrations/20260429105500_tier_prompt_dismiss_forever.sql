-- Persist tier prompt dismissal per account
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tier_prompt_dismissed_forever BOOLEAN NOT NULL DEFAULT FALSE;
