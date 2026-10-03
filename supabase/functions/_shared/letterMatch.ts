// Pure name helpers, kept identical to src/utils/pokemonUtils.ts
// (normalizePokemonName / getLetterMatchResult). Duplicated because that module
// imports client types and is not safe to load from Deno.

export type LetterResult = 'correct' | 'present' | 'absent';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(
      /-mega$|-gmax$|-alola$|-galar$|-hisui$|-paldea$|-green-plumage$|-incarnate$|-f$|-m$|-shield$|-single-strike$|-normal$|-plant$|-altered$|-land$|-red-striped$|-standard$|-ordinary$|-aria$|-male$|-average$|-50$|-baile$|-midday$|-solo$|-red-meteor$|-disguised$|-amped$|-full-belly$|-family-of-four$|-zero$|-curly$|-two-segment$|-ice$/,
      ''
    );
}

export function getLetterMatchResult(guess: string, target: string): LetterResult[] {
  if (!guess || !target) return [];

  const g = normalizeName(guess);
  const t = normalizeName(target);

  const remaining = new Map<string, number>();
  for (const letter of t) remaining.set(letter, (remaining.get(letter) || 0) + 1);

  const result: LetterResult[] = Array(g.length).fill('absent');

  for (let i = 0; i < g.length; i++) {
    if (i < t.length && g[i] === t[i]) {
      result[i] = 'correct';
      remaining.set(g[i], remaining.get(g[i])! - 1);
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] !== 'absent') continue;
    if ((remaining.get(g[i]) ?? 0) > 0) {
      result[i] = 'present';
      remaining.set(g[i], remaining.get(g[i])! - 1);
    }
  }
  return result;
}
