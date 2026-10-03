import type { Db } from '../db.ts';
import { checkRateLimit } from './rateLimit.ts';

// New guest games per client IP per day. Guest ids are free to mint, so this
// bounds how many session rows one network can create (cleanup_stale_rows
// deletes old guest rows daily).
const GUEST_SESSIONS_PER_IP_PER_DAY = 50;

/** The client IP as forwarded by the gateway (nginx sets it from CF-Connecting-IP). */
export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Counts one new guest session for this IP; false once the daily cap is hit. */
export async function guestSessionAllowed(db: Db, ip: string): Promise<boolean> {
  const { allowed } = await checkRateLimit(db, `guest-new-session:ip:${ip}`, GUEST_SESSIONS_PER_IP_PER_DAY, 86400);
  return allowed;
}
