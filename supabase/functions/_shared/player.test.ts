import { describe, it, expect } from 'vitest';
import { identifyPlayer, ownerOf, rateLimitKey, targetSeed } from './player';

describe('identifyPlayer', () => {
  it('prefers the signed-in subject over a guest id', () => {
    expect(identifyPlayer('user-1', 'guest-abcdefgh')).toEqual({ kind: 'user', id: 'user-1' });
  });

  it('accepts a well-formed guest id without a user', () => {
    const id = '3f1c2a9e-0000-4000-8000-000000000001';
    expect(identifyPlayer(null, id)).toEqual({ kind: 'guest', id });
  });

  it('rejects missing or malformed guest ids', () => {
    expect(identifyPlayer(null, undefined)).toBeNull();
    expect(identifyPlayer(null, 'short')).toBeNull();
    expect(identifyPlayer(null, 'has spaces in it')).toBeNull();
    expect(identifyPlayer(null, 'x'.repeat(65))).toBeNull();
    expect(identifyPlayer(null, 12345678)).toBeNull();
  });
});

describe('player helpers', () => {
  const user = { kind: 'user' as const, id: 'u1' };
  const guest = { kind: 'guest' as const, id: 'g1234567' };

  it('maps owners to the right session column', () => {
    expect(ownerOf(user)).toEqual({ user_id: 'u1' });
    expect(ownerOf(guest)).toEqual({ guest_id: 'g1234567' });
  });

  it('namespaces guest target seeds away from user ids', () => {
    expect(targetSeed(user)).toBe('u1');
    expect(targetSeed(guest)).toBe('guest:g1234567');
    // A guest whose id equals a user id must not get that user's Pokémon.
    expect(targetSeed({ kind: 'guest', id: 'u1' })).not.toBe(targetSeed(user));
  });

  it('keeps rate-limit buckets separate per player kind', () => {
    expect(rateLimitKey('submit-guess', user)).toBe('submit-guess:user:u1');
    expect(rateLimitKey('submit-guess', guest)).toBe('submit-guess:guest:g1234567');
  });
});
