import { readJsonCache, removeCacheKey, writeJsonCache } from './cache';
import type { Profile, Stats } from '../store/authStore';

// Per-user cache of public display data (profile, stats, avatar image) so the
// header can paint a returning trainer instantly. Never store tokens or emails here.
export const PROFILE_CACHE_PREFIX = 'wurmple_profile_cache:';
export const PROFILE_CACHE_INDEX_KEY = 'wurmple_profile_cache_index';
export const LEGACY_USER_CACHE_KEY = 'wurmple_user_cache';
export const BALLS_CACHE_PREFIX = 'wurmple_balls_cache:';
export const MAX_CACHED_PROFILES = 3;

export interface ProfileCacheEntry {
  profile: Profile | null;
  stats: Stats | null;
  /** Network URL the data URL was made from; the data URL is only valid while they match. */
  avatarSrc: string | null;
  avatarDataUrl: string | null;
  updatedAt: number;
}

interface LegacyUserCache {
  userId?: string;
  profile?: Profile | null;
  stats?: Stats | null;
}

function entryKey(userId: string) {
  return `${PROFILE_CACHE_PREFIX}${userId}`;
}

function readIndex(): string[] {
  const index = readJsonCache<unknown>(PROFILE_CACHE_INDEX_KEY);
  return Array.isArray(index) ? index.filter((id): id is string => typeof id === 'string') : [];
}

/** Moves userId to the front of the LRU index and evicts anything past the limit. */
function touchIndex(userId: string) {
  const next = [userId, ...readIndex().filter(id => id !== userId)];
  next.slice(MAX_CACHED_PROFILES).forEach(evicted => {
    removeCacheKey(entryKey(evicted));
    removeCacheKey(`${BALLS_CACHE_PREFIX}${evicted}`);
  });
  writeJsonCache(PROFILE_CACHE_INDEX_KEY, next.slice(0, MAX_CACHED_PROFILES));
}

export function readProfileCache(userId: string): ProfileCacheEntry | null {
  const entry = readJsonCache<ProfileCacheEntry>(entryKey(userId));
  return entry && typeof entry === 'object' ? entry : null;
}

export function writeProfileCache(userId: string, profile: Profile | null, stats: Stats | null) {
  const prev = readProfileCache(userId);
  writeJsonCache<ProfileCacheEntry>(entryKey(userId), {
    profile,
    stats,
    avatarSrc: prev?.avatarSrc ?? null,
    avatarDataUrl: prev?.avatarDataUrl ?? null,
    updatedAt: Date.now(),
  });
  touchIndex(userId);
}

export function writeCachedAvatar(userId: string, avatarSrc: string, avatarDataUrl: string) {
  const prev = readProfileCache(userId);
  if (!prev) return;
  writeJsonCache<ProfileCacheEntry>(entryKey(userId), { ...prev, avatarSrc, avatarDataUrl, updatedAt: Date.now() });
}

/** One-time move of the old single-user cache into the per-user LRU cache. */
export function migrateLegacyUserCache() {
  const legacy = readJsonCache<LegacyUserCache>(LEGACY_USER_CACHE_KEY);
  if (!legacy) return;
  if (legacy.userId && !readProfileCache(legacy.userId)) {
    writeProfileCache(legacy.userId, legacy.profile ?? null, legacy.stats ?? null);
  }
  removeCacheKey(LEGACY_USER_CACHE_KEY);
}

const avatarFetchesInFlight = new Set<string>();

/** Fetches a sprite and returns it as a data URL (null on any failure). */
export async function fetchAsDataUrl(src: string): Promise<string | null> {
  if (avatarFetchesInFlight.has(src) || typeof FileReader === 'undefined') return null;
  avatarFetchesInFlight.add(src);
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  } finally {
    avatarFetchesInFlight.delete(src);
  }
}
