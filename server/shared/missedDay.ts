import type { Db } from '../db.ts';
import { missedStatsUpdate } from './missedStats.ts';

export async function markMissedSessions(
  db: Db,
  userId: string,
  todayKey: string,
  isVerified: boolean = false
): Promise<void> {
  const staleSessions = await db<{ id: string; puzzle_date_key: string; version: number; guesses: string[] | null }[]>`
    select id, puzzle_date_key, version, guesses from daily_sessions
    where user_id = ${userId} and completion_state = 'playing' and puzzle_date_key < ${todayKey}`;

  if (staleSessions.length === 0) return;

  // One statement for all of them. The version bump only has to invalidate
  // clients still holding a stale copy, so a common value above every row's
  // current version does the job.
  const nextVersion = Math.max(...staleSessions.map((s) => s.version)) + 1;
  await db`
    update daily_sessions set completion_state = 'missed', version = ${nextVersion}
    where id = any(${staleSessions.map((s) => s.id)}::uuid[]) and completion_state = 'playing'`;

  if (isVerified) {
    const update = missedStatsUpdate(staleSessions);
    await db`update user_stats set ${db(update)} where user_id = ${userId}`;
  }
}
