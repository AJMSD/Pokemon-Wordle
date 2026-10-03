-- Session rows pin each player's answer (target_pokemon_*), and puzzle_id
-- leads to the shared answer. RLS limits reads to the caller's own rows but
-- not columns, so a signed-in player could read their own answer through
-- PostgREST. Only expose the non-secret columns; edge functions use the
-- service role and are unaffected.
REVOKE SELECT ON public.daily_sessions FROM anon, authenticated;

GRANT SELECT (
  id,
  user_id,
  guest_id,
  puzzle_date_key,
  guesses,
  hint_flags,
  completion_state,
  version,
  created_at,
  updated_at
) ON public.daily_sessions TO authenticated;

NOTIFY pgrst, 'reload schema';
