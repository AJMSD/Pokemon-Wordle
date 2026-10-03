import { getLetterMatchResult, normalizePokemonName } from '../utils/pokemonUtils';

// Share of the name's letters found in the right spot that fills each of the
// four dots under the Pokédex screen.
export const DOT_THRESHOLDS = [0.25, 0.5, 0.75, 1] as const;

/**
 * How many of the dots are filled: one per threshold the player has reached,
 * counting every position any guess has hit (so dots never empty again).
 * Thresholds are inclusive (threshold <= share) and only ever compare a ratio,
 * so the dots say how close you are without spelling out the name's length.
 */
export function filledDotCount(guesses: string[], targetName: string, won = false): number {
  if (won) return DOT_THRESHOLDS.length;
  const target = normalizePokemonName(targetName);
  if (!target) return 0;

  const found = new Set<number>();
  for (const guess of guesses) {
    getLetterMatchResult(guess, target).forEach((result, i) => {
      if (result === 'correct') found.add(i);
    });
  }
  const share = found.size / target.length;
  return DOT_THRESHOLDS.filter(threshold => threshold <= share).length;
}
