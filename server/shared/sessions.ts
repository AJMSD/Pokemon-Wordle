import { jsonb, type Db } from '../db.ts';
import type { Player } from './player.ts';
import type { PokemonData, Target } from './target.ts';
import type { CompletionState, HintFlags } from './migrateGuest.ts';

export interface SessionRow {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  puzzle_date_key: string;
  guesses: string[];
  hint_flags: HintFlags;
  completion_state: string;
  version: number;
  puzzle_id: string | null;
  target_pokemon_id: number | null;
  target_pokemon_name: string | null;
  target_pokemon_data: PokemonData | null;
}

function ownerFilter(db: Db, player: Player) {
  return player.kind === 'user' ? db`user_id = ${player.id}` : db`guest_id = ${player.id}`;
}

export async function findSession(db: Db, player: Player, dateKey: string): Promise<SessionRow | undefined> {
  const [row] = await db<SessionRow[]>`
    select * from daily_sessions where ${ownerFilter(db, player)} and puzzle_date_key = ${dateKey}`;
  return row;
}

interface NewSessionFields {
  guesses?: string[];
  hint_flags?: HintFlags;
  completion_state?: CompletionState;
}

/**
 * Inserts the player's session for `dateKey` pinned to `target`. Returns
 * undefined when a row already exists (a concurrent request created it).
 */
export async function insertSession(
  db: Db,
  player: Player,
  dateKey: string,
  target: Target,
  fields: NewSessionFields = {}
): Promise<SessionRow | undefined> {
  const pinned = !target.puzzleId;
  const [row] = await db<SessionRow[]>`
    insert into daily_sessions (
      user_id, guest_id, puzzle_date_key, puzzle_id,
      target_pokemon_id, target_pokemon_name, target_pokemon_data,
      guesses, hint_flags, completion_state, version
    ) values (
      ${player.kind === 'user' ? player.id : null},
      ${player.kind === 'guest' ? player.id : null},
      ${dateKey},
      ${target.puzzleId},
      ${pinned ? target.pokemonId : null},
      ${pinned ? target.name : null},
      ${pinned ? jsonb(target.data) : null},
      ${fields.guesses ?? []}::text[],
      ${jsonb(fields.hint_flags ?? { ability: false, generation: false, type: false })},
      ${fields.completion_state ?? 'playing'},
      1
    )
    on conflict do nothing
    returning *`;
  return row;
}

/** Today's session for the player, created (and pinned to `target`) on first use. */
export async function getOrCreateSession(
  db: Db,
  player: Player,
  dateKey: string,
  target: Target
): Promise<SessionRow> {
  const created = await insertSession(db, player, dateKey, target);
  if (created) return created;
  // Lost a create race with a concurrent request; use its row.
  const existing = await findSession(db, player, dateKey);
  if (!existing) throw new Error('session missing after insert conflict');
  return existing;
}
