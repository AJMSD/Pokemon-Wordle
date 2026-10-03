// API base URL and the signed-in session kept in localStorage.
// The session is an opaque bearer token issued by the API (server/auth).

export interface User {
  id: string;
  email: string;
  email_confirmed_at: string | null;
}

export interface Session {
  access_token: string;
  user: User;
}

const AUTH_STORAGE_KEY = 'wurmple_auth';
// Session keys left behind by the previous auth client.
const LEGACY_AUTH_KEY_RE = /^sb-[a-z0-9]+-auth-token(-code-verifier)?$/;

if (!import.meta.env.VITE_API_URL) {
  console.warn('VITE_API_URL not set — server features disabled');
}

export function apiUrl(path: string): string {
  return `${(import.meta.env.VITE_API_URL as string | undefined) ?? ''}${path}`;
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function isUser(value: unknown): value is User {
  const u = value as Partial<User> | null;
  return !!u && typeof u.id === 'string' && !!u.id && typeof u.email === 'string';
}

/** The persisted session, or null. */
export function readStoredSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; user?: unknown } | null;
    if (typeof parsed?.token !== 'string' || !parsed.token || !isUser(parsed.user)) return null;
    return { access_token: parsed.token, user: parsed.user };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: Session) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: session.access_token, user: session.user }));
  } catch {
    // Storage full or blocked: the session still works for this page load.
  }
}

export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    const legacy: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && LEGACY_AUTH_KEY_RE.test(key)) legacy.push(key);
    }
    legacy.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures so logout flow still completes.
  }
}

/** User id of the persisted session, read synchronously at boot. */
export function readPersistedSessionUserId(): string | null {
  return readStoredSession()?.user.id ?? null;
}

/**
 * The persisted token of a confirmed user, so the game session can start
 * loading before auth hydration finishes. Null when absent or unconfirmed.
 */
export function readPersistedAccessToken(): { userId: string; accessToken: string } | null {
  const session = readStoredSession();
  if (!session || !session.user.email_confirmed_at) return null;
  return { userId: session.user.id, accessToken: session.access_token };
}

/** Body of a JSON response, or {} when it isn't JSON (e.g. a gateway error page). */
export async function readBody<T = Record<string, unknown>>(res: Response): Promise<Partial<T> & { error?: string; code?: string }> {
  return res.json().catch(() => ({})) as Promise<Partial<T> & { error?: string; code?: string }>;
}
