// Who a game request is for. Pure (no Deno APIs) so it can be unit-tested.
//
// Signed-in players are identified by their session's user id. Guests send no
// Authorization header, only their client-generated guest id; their sessions
// and targets live on the server too, so the client never learns the answer early.

// Client guest ids are crypto.randomUUID() or a base36 fallback.
export const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type Player =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; id: string };

/** A signed-in subject wins; otherwise a well-formed guest id; otherwise null. */
export function identifyPlayer(userId: string | null, guestId: unknown): Player | null {
  if (userId) return { kind: 'user', id: userId };
  if (typeof guestId === 'string' && GUEST_ID_RE.test(guestId)) return { kind: 'guest', id: guestId };
  return null;
}

/**
 * Seed for the salted daily pick. Guests get their own namespace so a guest id
 * can never collide with (or reveal) a user's target.
 */
export function targetSeed(player: Player): string {
  return player.kind === 'user' ? player.id : `guest:${player.id}`;
}

export function rateLimitKey(fn: string, player: Player): string {
  return `${fn}:${player.kind}:${player.id}`;
}
