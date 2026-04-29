import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
// Support both key names — dashboard shows PUBLISHABLE_KEY, common convention is ANON_KEY
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set — authenticated features disabled');
}

// Avoid throwing at module import time in environments (e.g., CI tests) where env vars are absent.
const safeSupabaseUrl = supabaseUrl || 'https://placeholder.supabase.co';
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

export type { User, Session } from '@supabase/supabase-js';
