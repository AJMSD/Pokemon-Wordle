// Daily target selection, shared by the client and the edge functions.
// Pure module: no imports, so Deno can load it straight from src/.

// National dex ids 1..POKEMON_COUNT. Never change this without a remap:
// every user's past and future targets are derived from it.
export const POKEMON_COUNT = 1025;

// First JST day on which each user gets their own Pokémon. Earlier days keep
// the single shared pick so games already in progress don't change target.
export const PER_USER_START_DATE = '2026-10-05';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` key (parsed as UTC). */
export function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isPerUserDate(dateKey: string): boolean {
  return dateKey >= PER_USER_START_DATE;
}

/** The original shared daily pick (0-based index). Kept bit-for-bit. */
export function legacySharedIndex(dateKey: string): number {
  const seed = dateKey + 'pokemonWordle';
  const PRIME1 = 7919;
  const PRIME2 = 6733;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) ^ (hash >> 7)) + seed.charCodeAt(i) * PRIME1;
    hash = (hash * PRIME2) & 0x7fffffff;
  }
  return hash % POKEMON_COUNT;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// POKEMON_COUNT = 1025 = 5^2 * 41, so a multiplier is invertible mod 1025
// exactly when it shares neither factor.
function isCoprimeToCount(a: number): boolean {
  return a % 5 !== 0 && a % 41 !== 0;
}

/**
 * Affine pick of a national dex id (1-based) for `dateKey`: `a*day + b mod 1025`
 * with `a` forced coprime to 1025, so one seed pair never repeats a Pokémon
 * within 1025 consecutive days. Pure; callers decide where the seeds come from
 * (public hash for guests, server-secret HMAC for users).
 */
export function affinePick(dateKey: string, aSeed: number, bSeed: number): number {
  let a = (aSeed >>> 0) % POKEMON_COUNT;
  while (!isCoprimeToCount(a)) a = (a + 1) % POKEMON_COUNT;
  const b = (bSeed >>> 0) % POKEMON_COUNT;

  // Both factors are < 1025, so the product stays far below 2^53.
  const d = ((dayNumber(dateKey) % POKEMON_COUNT) + POKEMON_COUNT) % POKEMON_COUNT;
  return ((a * d + b) % POKEMON_COUNT) + 1;
}

/**
 * National dex id (1-based) for `seedId` on `dateKey` using the PUBLIC seed
 * formula. Only for guests: signed-in users' targets are derived server-side
 * with a secret (server/shared/secretTarget.ts).
 */
export function getDailyPokemonId(dateKey: string, seedId: string): number {
  if (!isPerUserDate(dateKey)) return legacySharedIndex(dateKey) + 1;
  return affinePick(dateKey, fnv1a(`wurmple:a:${seedId}`), fnv1a(`wurmple:b:${seedId}`));
}

const GENERATION_LAST_IDS: Array<[number, string]> = [
  [151, 'generation-i'],
  [251, 'generation-ii'],
  [386, 'generation-iii'],
  [493, 'generation-iv'],
  [649, 'generation-v'],
  [721, 'generation-vi'],
  [809, 'generation-vii'],
  [905, 'generation-viii'],
  [1025, 'generation-ix'],
];

/** PokéAPI generation name for a national dex id (species id = dex id here). */
export function generationForId(id: number): string {
  return GENERATION_LAST_IDS.find(([last]) => id <= last)?.[1] ?? 'unknown';
}
