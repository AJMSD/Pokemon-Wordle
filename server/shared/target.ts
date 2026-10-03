import { jsonb, type Db } from '../db.ts';
import {
  isPerUserDate,
  legacySharedIndex,
} from '../../src/logic/dailyTarget.ts';
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
export async function getPokemonInfo(db: Db, id: number): Promise<{ name: string; data: PokemonData }> {
  const [row] = await db<{ pokemon_name: string; pokemon_data: PokemonData }[]>`
    select pokemon_name, pokemon_data from pokemon_info where pokemon_id = ${id}`;
  if (row) return { name: row.pokemon_name, data: row.pokemon_data };

  const info = await fetchFromPokeAPI(id);
  await db`
    insert into pokemon_info (pokemon_id, pokemon_name, pokemon_data)
    values (${id}, ${info.name}, ${jsonb(info.data)})
    on conflict (pokemon_id) do nothing`;
  return info;
}

// Shared puzzle for days before per-user targets, created on first use.
async function getLegacyPuzzle(db: Db, dateKey: string): Promise<Target> {
  const select = () =>
    db<{ id: string; pokemon_id: number; pokemon_name: string; pokemon_data: PokemonData }[]>`
      select id, pokemon_id, pokemon_name, pokemon_data from daily_puzzles
      where puzzle_date_key = ${dateKey}`;

  let [puzzle] = await select();
  if (!puzzle) {
    const id = legacySharedIndex(dateKey) + 1;
    const info = await getPokemonInfo(db, id);
    await db`
      insert into daily_puzzles (puzzle_date_key, pokemon_id, pokemon_name, pokemon_data)
      values (${dateKey}, ${id}, ${info.name}, ${jsonb(info.data)})
      on conflict (puzzle_date_key) do nothing`;
    [puzzle] = await select();
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
  db: Db,
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
  if (!isPerUserDate(dateKey)) return getLegacyPuzzle(db, dateKey);

  // Salted with a server secret, so clients can't compute anyone's answer.
  const id = await getSecretDailyPokemonId(dateKey, seedId);
  const info = await getPokemonInfo(db, id);
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
  db: Db,
  session: SessionTargetFields,
  target: Target
): Promise<void> {
  if (target.puzzleId || session.target_pokemon_id || !session.id) return;
  await db`
    update daily_sessions set
      target_pokemon_id = ${target.pokemonId},
      target_pokemon_name = ${target.name},
      target_pokemon_data = ${jsonb(target.data)}
    where id = ${session.id}`;
  Object.assign(session, targetColumns(target));
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
