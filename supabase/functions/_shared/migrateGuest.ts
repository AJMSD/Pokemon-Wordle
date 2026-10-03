import { POKEMON_NAMES } from '../../../src/data/pokemonNames.ts';
import { normalizeName } from './letterMatch.ts';

export const MAX_GUESSES = 10;
export const HINT_THRESHOLDS = { ability: 3, generation: 6, type: 9 };

const POKEMON_NAME_SET: ReadonlySet<string> = new Set(POKEMON_NAMES);

export type CompletionState = 'playing' | 'won' | 'lost';
export interface HintFlags {
  ability: boolean;
  generation: boolean;
  type: boolean;
}

/** Hint flags unlocked by having made `guessCount` guesses, never un-set. */
export function hintFlagsFor(guessCount: number, previous?: Partial<HintFlags>): HintFlags {
  return {
    ability: !!previous?.ability || guessCount >= HINT_THRESHOLDS.ability,
    generation: !!previous?.generation || guessCount >= HINT_THRESHOLDS.generation,
    type: !!previous?.type || guessCount >= HINT_THRESHOLDS.type,
  };
}

export function isValidPokemonName(normalized: string): boolean {
  return POKEMON_NAME_SET.has(normalized);
}

export function completionFor(guesses: string[], targetName: string): CompletionState {
  const target = normalizeName(targetName);
  if (guesses.length > 0 && guesses[guesses.length - 1] === target) return 'won';
  return guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
}

export type ReplayResult =
  | { ok: true; guesses: string[]; hint_flags: HintFlags; completion_state: CompletionState }
  | { ok: false; error: string };

/**
 * Validates a guest's claimed guess list against the guest's (publicly
 * derivable) target and replays it into session fields. The server never
 * trusts client-supplied completion state or hint flags.
 */
export function replayGuestGuesses(input: unknown, targetName: string): ReplayResult {
  if (!Array.isArray(input)) return { ok: false, error: 'guesses must be an array' };
  if (input.length > MAX_GUESSES) return { ok: false, error: 'Too many guesses' };

  const target = normalizeName(targetName);
  const guesses: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 40) {
      return { ok: false, error: 'Invalid guess' };
    }
    if (guesses.length > 0 && guesses[guesses.length - 1] === target) {
      return { ok: false, error: 'Guesses after the game ended' };
    }
    const normalized = normalizeName(raw);
    if (!isValidPokemonName(normalized)) return { ok: false, error: 'Not a valid Pokémon name' };
    if (guesses.includes(normalized)) return { ok: false, error: 'Duplicate guess' };
    guesses.push(normalized);
  }

  return {
    ok: true,
    guesses,
    hint_flags: hintFlagsFor(guesses.length),
    completion_state: completionFor(guesses, targetName),
  };
}
