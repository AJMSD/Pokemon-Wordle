import { getLetterMatchResult, normalizePokemonName } from '../utils/pokemonUtils';

// Share of the name's letters found in the right spot that lights each of the
// three small Pokédex lights (red, yellow, green).
export const LIGHT_THRESHOLDS = [0.25, 0.5, 0.75] as const;

/**
 * How many of the small lights glow: one per threshold the player has reached,
 * counting every position any guess has hit (so lights never switch back off).
 * Thresholds are inclusive (threshold <= share) and only ever compare a ratio,
 * so the lights say how close you are without spelling out the name's length.
 */
export function litLightCount(guesses: string[], targetName: string, won = false): number {
  if (won) return LIGHT_THRESHOLDS.length;
  const target = normalizePokemonName(targetName);
  if (!target) return 0;

  const found = new Set<number>();
  for (const guess of guesses) {
    getLetterMatchResult(guess, target).forEach((result, i) => {
      if (result === 'correct') found.add(i);
    });
  }
  const share = found.size / target.length;
  return LIGHT_THRESHOLDS.filter(threshold => threshold <= share).length;
}
