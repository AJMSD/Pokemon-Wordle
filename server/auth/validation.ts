import { DISPOSABLE_DOMAINS } from './disposableDomains.ts';

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt only uses the first 72 bytes.
export const MAX_PASSWORD_BYTES = 72;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'retard'];
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_]{1,18}[a-zA-Z0-9]$|^[a-zA-Z0-9]{3}$/;

/** Lower-cased, trimmed email, or null when it isn't a plausible address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(email.split('@')[1] ?? '');
}

/** Error message for an unacceptable password, or null. */
export function passwordError(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (new TextEncoder().encode(raw).length > MAX_PASSWORD_BYTES) {
    return 'Password is too long';
  }
  return null;
}

/** Error message for an unacceptable Trainer name, or null. */
export function usernameError(raw: unknown): string | null {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (username.length < 3 || username.length > 20) return 'Username must be 3–20 characters';
  if (!USERNAME_RE.test(username)) return 'Username may only contain letters, numbers, and underscores';
  const lower = username.toLowerCase();
  if (BLOCKED.some((w) => lower.includes(w))) return 'Username not allowed';
  return null;
}
