// SERVER ONLY. Never import this (or anything that reads TARGET_SALT) from src/.
import { affinePick } from '../../../src/logic/dailyTarget.ts';
import { deriveSeeds } from './hmacSeeds.ts';

function targetSalt(): string {
  const salt = Deno.env.get('TARGET_SALT') ?? Deno.env.get('JWT_SECRET');
  if (!salt) throw new Error('TARGET_SALT (or JWT_SECRET) must be set');
  return salt;
}

/** Salted per-user dex id (1-based) for `dateKey`; unguessable without the server salt. */
export async function getSecretDailyPokemonId(dateKey: string, userId: string): Promise<number> {
  const { aSeed, bSeed } = await deriveSeeds(targetSalt(), userId);
  return affinePick(dateKey, aSeed, bSeed);
}
