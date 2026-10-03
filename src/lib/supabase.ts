import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_API_URL as string;
const supabaseAnonKey = import.meta.env.VITE_API_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('API env vars not set — authenticated features disabled');
}

// Avoid throwing at module import time in environments (e.g., CI tests) where env vars are absent.
const safeSupabaseUrl = supabaseUrl || 'https://api.placeholder.invalid';
const safeSupabaseAnonKey = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(safeSupabaseUrl, safeSupabaseAnonKey);

function getSupabaseProjectRefFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const [projectRef] = parsed.hostname.split('.');
    return projectRef || null;
  } catch {
    return null;
  }
}

function getSupabaseAuthStorageKeys(projectRef: string): string[] {
  // Supabase JS persists auth using these key shapes in localStorage.
  return [
    `sb-${projectRef}-auth-token`,
    `sb-${projectRef}-auth-token-code-verifier`,
  ];
}

/** Synchronously reads the user id from supabase-js's persisted session, if any. */
export function readPersistedSessionUserId(): string | null {
  if (typeof window === 'undefined') return null;
  const projectRef = getSupabaseProjectRefFromUrl(safeSupabaseUrl);
  if (!projectRef) return null;
  try {
    const raw = localStorage.getItem(getSupabaseAuthStorageKeys(projectRef)[0]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } } | null;
    const id = parsed?.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Synchronously reads a still-valid access token for a confirmed user from
 * supabase-js's persisted session, so the game session can start loading
 * before auth hydration finishes. Null when absent, expired or unconfirmed.
 */
export function readPersistedAccessToken(): { userId: string; accessToken: string } | null {
  if (typeof window === 'undefined') return null;
  const projectRef = getSupabaseProjectRefFromUrl(safeSupabaseUrl);
  if (!projectRef) return null;
  try {
    const raw = localStorage.getItem(getSupabaseAuthStorageKeys(projectRef)[0]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      access_token?: unknown;
      expires_at?: unknown;
      user?: { id?: unknown; email_confirmed_at?: unknown };
    } | null;
    const token = parsed?.access_token;
    const userId = parsed?.user?.id;
    const expiresAt = parsed?.expires_at;
    if (typeof token !== 'string' || !token || typeof userId !== 'string' || !userId) return null;
    if (!parsed?.user?.email_confirmed_at) return null;
    // Leave a margin so we never fire with a token about to lapse.
    if (typeof expiresAt !== 'number' || expiresAt * 1000 < Date.now() + 30_000) return null;
    return { userId, accessToken: token };
  } catch {
    return null;
  }
}

export function clearSupabaseAuthStorage() {
  if (typeof window === 'undefined') return;

  const projectRef = getSupabaseProjectRefFromUrl(safeSupabaseUrl);
  const expectedKeys = projectRef ? getSupabaseAuthStorageKeys(projectRef) : [];

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;

      const isExpectedProjectKey = expectedKeys.some(expected => key === expected);
      const isLegacyAuthTokenKey = key === 'supabase.auth.token';
      if (isExpectedProjectKey || isLegacyAuthTokenKey) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures so logout flow still completes.
  }
}

export type { AuthChangeEvent, User, Session } from '@supabase/supabase-js';
