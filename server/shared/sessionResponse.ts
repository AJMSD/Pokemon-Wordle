import { getLetterMatchResult, type LetterResult } from './letterMatch.ts';

export interface SessionLike {
  guesses: string[];
  hint_flags: { ability?: boolean; generation?: boolean; type?: boolean };
  completion_state: string;
  version: number;
}

export interface TargetLike {
  pokemonId: number;
  name: string;
  data: { ability: string; generation: string; types: string[] };
}

/** Letters-only length of the target name (what the client draws tiles for). */
export function nameLength(name: string): number {
  return name.replace(/[^a-z]/gi, '').length;
}

/** Per-guess letter feedback, aligned with `guesses`. */
export function computeResults(guesses: string[], targetName: string): LetterResult[][] {
  return guesses.map((g) => getLetterMatchResult(g, targetName));
}

/**
 * Body shared by get-session, submit-guess, refresh-state and migrate-guest.
 * Never includes the answer while the game is still `playing`.
 */
export function buildSessionResponse(
  session: SessionLike,
  target: TargetLike,
  hints: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    guesses: session.guesses,
    results: computeResults(session.guesses, target.name),
    hint_flags: session.hint_flags,
    hints,
    completion_state: session.completion_state,
    version: session.version,
    name_length: nameLength(target.name),
    puzzle_metadata: { name_length: nameLength(target.name) },
  };
  if (session.completion_state !== 'playing') {
    body.pokemon_name = target.name;
    body.pokemon_id = target.pokemonId;
  }
  return body;
}
