import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  isPerUserDate,
  legacySharedIndex,
} from '../../../src/logic/dailyTarget.ts';
import { getSecretDailyPokemonId } from './secretTarget.ts';

export interface PokemonData {
  ability: string;
  generation: string;
  types: string[];
}

export interface Target {
  pokemonId: number;
  name: string;
  data: PokemonData;
  // Set for legacy shared days; null for per-user targets.
  puzzleId: string | null;
}

interface SessionTargetFields {
  id?: string;
  puzzle_id?: string | null;
  target_pokemon_id?: number | null;
  target_pokemon_name?: string | null;
  target_pokemon_data?: PokemonData | null;
}

async function fetchFromPokeAPI(id: number): Promise<{ name: string; data: PokemonData }> {
  const pokemonRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal: AbortSignal.timeout(5000) });
  if (!pokemonRes.ok) throw new Error(`PokeAPI pokemon ${id}: ${pokemonRes.status}`);
  const pokemon = await pokemonRes.json();

  const speciesRes = await fetch(pokemon.species.url, { signal: AbortSignal.timeout(5000) });
  if (!speciesRes.ok) throw new Error(`PokeAPI species ${id}: ${speciesRes.status}`);
  const species = await speciesRes.json();

  return {
    name: pokemon.name,
    data: {
      ability: pokemon.abilities?.[0]?.ability?.name ?? 'unknown',
      generation: species.generation?.name ?? 'unknown',
      types: pokemon.types?.map((t: { type: { name: string } }) => t.type.name) ?? [],
    },
  };
}

/** Name and hint data for a dex id, from the pokemon_info cache or PokéAPI once. */
export async function getPokemonInfo(
  admin: SupabaseClient,
  id: number
): Promise<{ name: string; data: PokemonData }> {
  const { data: row } = await admin
    .from('pokemon_info')
    .select('pokemon_name, pokemon_data')
    .eq('pokemon_id', id)
    .maybeSingle();
  if (row) return { name: row.pokemon_name, data: row.pokemon_data };

  const info = await fetchFromPokeAPI(id);
  await admin
    .from('pokemon_info')
    .upsert(
      { pokemon_id: id, pokemon_name: info.name, pokemon_data: info.data },
      { onConflict: 'pokemon_id', ignoreDuplicates: true }
    );
  return info;
}

// Shared puzzle for days before per-user targets, created on first use.
async function getLegacyPuzzle(admin: SupabaseClient, dateKey: string): Promise<Target> {
  const select = () =>
    admin
      .from('daily_puzzles')
      .select('id, pokemon_id, pokemon_name, pokemon_data')
      .eq('puzzle_date_key', dateKey)
      .maybeSingle();

  let { data: puzzle } = await select();
  if (!puzzle) {
    const id = legacySharedIndex(dateKey) + 1;
    const info = await getPokemonInfo(admin, id);
    await admin
      .from('daily_puzzles')
      .upsert(
        { puzzle_date_key: dateKey, pokemon_id: id, pokemon_name: info.name, pokemon_data: info.data },
        { onConflict: 'puzzle_date_key', ignoreDuplicates: true }
      );
    ({ data: puzzle } = await select());
    if (!puzzle) throw new Error(`daily_puzzles row missing for ${dateKey}`);
  }

  return {
    pokemonId: puzzle.pokemon_id,
    name: puzzle.pokemon_name,
    data: puzzle.pokemon_data,
    puzzleId: puzzle.id,
  };
}

/**
 * The Pokémon a session plays against: the target pinned on the session if
 * any, else the seed's salted pick (from PER_USER_START_DATE; see
 * player.ts targetSeed for user vs guest seeds) or the shared legacy puzzle
 * (earlier days).
 */
export async function resolveTarget(
  admin: SupabaseClient,
  dateKey: string,
  seedId: string,
  session?: SessionTargetFields | null
): Promise<Target> {
  if (session?.target_pokemon_id && session.target_pokemon_name && session.target_pokemon_data) {
    return {
      pokemonId: session.target_pokemon_id,
      name: session.target_pokemon_name,
      data: session.target_pokemon_data,
      puzzleId: session.puzzle_id ?? null,
    };
  }
  if (!isPerUserDate(dateKey)) return getLegacyPuzzle(admin, dateKey);

  // Salted with a server secret, so clients can't compute anyone's answer.
  const id = await getSecretDailyPokemonId(dateKey, seedId);
  const info = await getPokemonInfo(admin, id);
  return { pokemonId: id, name: info.name, data: info.data, puzzleId: null };
}

/** daily_sessions columns that pin `target` to a session row. */
export function targetColumns(target: Target): Record<string, unknown> {
  return target.puzzleId
    ? { puzzle_id: target.puzzleId }
    : {
        target_pokemon_id: target.pokemonId,
        target_pokemon_name: target.name,
        target_pokemon_data: target.data,
      };
}

/** Pins a per-user target onto an existing session that doesn't have one yet. */
export async function ensureSessionTarget(
  admin: SupabaseClient,
  session: SessionTargetFields,
  target: Target
): Promise<void> {
  if (target.puzzleId || session.target_pokemon_id || !session.id) return;
  const columns = targetColumns(target);
  await admin.from('daily_sessions').update(columns).eq('id', session.id);
  Object.assign(session, columns);
}

/** Hint values a session has unlocked. */
export function revealedHints(
  flags: { ability?: boolean; generation?: boolean; type?: boolean },
  data: PokemonData
): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  if (flags.ability) hints.ability = data.ability;
  if (flags.generation) hints.generation = data.generation;
  if (flags.type) hints.types = data.types;
  return hints;
}
