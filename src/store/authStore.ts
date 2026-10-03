import { create } from 'zustand';
import {
  apiUrl,
  bearer,
  clearStoredSession,
  readBody,
  readPersistedSessionUserId,
  readStoredSession,
  writeStoredSession,
} from '../lib/api';
import { isJsonEqual, removeCacheKey, removeCacheKeysByPrefix } from '../lib/cache';
import { migrateLegacyUserCache, readProfileCache, writeCachedAvatar, writeProfileCache } from '../lib/profileCache';
import { useGameStore, setAccessTokenProvider } from './gameStore';
import type { Session, User } from '../lib/api';
import type { AvatarConfig } from '../utils/avatarUtils';

export const BALL_NAMES: Record<string, string> = {
  'poke-ball': 'Poké Ball',
  'great-ball': 'Great Ball',
  'ultra-ball': 'Ultra Ball',
  'master-ball': 'Master Ball',
  'quick-ball': 'Quick Ball',
  'timer-ball': 'Timer Ball',
  'luxury-ball': 'Luxury Ball',
  'net-ball': 'Net Ball',
  'heal-ball': 'Heal Ball',
};

interface Profile {
  id: string;
  username: string;
  avatar_config: AvatarConfig;
  display_ball: string;
  tier_prompt_dismissed_forever?: boolean;
  created_at?: string;
}

interface Stats {
  current_streak: number;
  max_streak: number;
  total_participations: number;
  total_wins: number;
  win_rate: number;
  avg_guesses: number;
  participation_streak: number;
  max_participation_streak: number;
  total_losses: number;
  guess_distribution: Record<string, number>;
  best_guess_summary: string | null;
}

interface CachedAvatar {
  src: string;
  dataUrl: string;
}

/** Cached display data for the persisted session, shown while auth is still resolving. */
interface BootProfile {
  userId: string;
  profile: Profile;
  stats: Stats | null;
  avatar: CachedAvatar | null;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  stats: Stats | null;
  hasResolvedProfile: boolean;
  isProfileHydrating: boolean;
  displayBallSync: {
    inFlight: boolean;
    pendingBallId: string | null;
    requestId: number;
  };
  isLoading: boolean;
  isGuest: boolean;
  pendingPasswordRecovery: boolean;
  pendingEmail: string | null;
  bootProfile: BootProfile | null;
  cachedAvatar: CachedAvatar | null;
  /** One-off message for the player (e.g. an expired email link); App shows it as a toast. */
  authNotice: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  markSignInTimedOut: () => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  confirmPasswordReset: (password: string) => Promise<{ error: string | null }>;
  resendVerification: () => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  updateAvatar: (config: Partial<AvatarConfig>) => Promise<{ error: string | null }>;
  fetchMe: () => Promise<{ error: string | null }>;
  updateDisplayBall: (ballId: string) => Promise<{ error: string | null }>;
  dismissTierPromptForever: () => Promise<{ error: string | null }>;
  setupUsername: (username: string) => Promise<{ error: string | null }>;
  clearPasswordRecovery: () => void;
  clearAuthNotice: () => void;
  cacheAvatar: (src: string, dataUrl: string) => void;
}

interface MeResponse {
  user: User;
  profile: Profile | null;
  stats: Stats | null;
}

let fetchMeInFlight: { token: string; promise: Promise<{ error: string | null }> } | null = null;
let passwordResetInFlight: Promise<{ error: string | null }> | null = null;
let authInitInFlight: Promise<void> | null = null;
let authSessionEpoch = 0;
let signInAttemptCounter = 0;
let lastStartedSignInAttemptId: number | null = null;
let timedOutSignInAttemptId: number | null = null;
// Token from a ?reset= link, held until the new password is submitted.
let pendingResetToken: string | null = null;

// The per-user profile and balls caches are kept on sign-out (LRU, public display data only).
const APP_STORAGE_KEYS_TO_CLEAR_ON_SIGNOUT = [
  'wurmple_avatar_pokemon_list',
  'tier_prompt_dismissed',
  // Left by the previous auth client.
  'wurmple_recovery_pending_user_id',
  'wurmple_signed_out',
] as const;
const APP_STORAGE_PREFIXES_TO_CLEAR_ON_SIGNOUT = [
  'pokemon_list_cache_',
  'pokemon_detail_cache_',
] as const;

// Query params the API's emails and Google redirect bring the player back with.
const AUTH_URL_PARAMS = ['verify', 'reset', 'login', 'auth_error'] as const;
type AuthUrlParams = Partial<Record<(typeof AUTH_URL_PARAMS)[number], string>>;

function readAuthUrlParams(): AuthUrlParams {
  if (typeof window === 'undefined') return {};
  const search = new URLSearchParams(window.location.search);
  const params: AuthUrlParams = {};
  AUTH_URL_PARAMS.forEach(key => {
    const value = search.get(key);
    if (value) params[key] = value;
  });
  return params;
}

/** Removes one-time auth params so a reload or shared URL can't replay them. */
function clearAuthUrlParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  AUTH_URL_PARAMS.forEach(key => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

const AUTH_ERROR_NOTICES: Record<string, string> = {
  google: "Google sign-in didn't work. Please try again.",
  google_disabled: "Google sign-in isn't available right now.",
};

async function resetToFreshGuestGameState(logLabel: string) {
  const gameStore = useGameStore.getState();
  gameStore.setStorageScope(null);
  gameStore.clearScopedProgress(null);
  gameStore.invalidateServerSessionSync();
  try {
    await gameStore.initializeGame();
    await gameStore.loadGuestServerSession();
  } catch (err) {
    console.error(logLabel, err);
  }
}

function readCachedAvatar(userId: string): CachedAvatar | null {
  const entry = readProfileCache(userId);
  return entry?.avatarSrc && entry.avatarDataUrl
    ? { src: entry.avatarSrc, dataUrl: entry.avatarDataUrl }
    : null;
}

function clearAppStorageOnSignOut() {
  APP_STORAGE_KEYS_TO_CLEAR_ON_SIGNOUT.forEach(removeCacheKey);
  removeCacheKeysByPrefix([...APP_STORAGE_PREFIXES_TO_CLEAR_ON_SIGNOUT]);
}

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? bearer(token) : {}) },
    body: JSON.stringify(body),
  });
}

/** Reads a {token, user} auth response into a session, or null. */
async function sessionFrom(res: Response): Promise<Session | null> {
  if (!res.ok) return null;
  const data = await readBody<{ token: string; user: User }>(res);
  return typeof data.token === 'string' && data.user ? { access_token: data.token, user: data.user } : null;
}

async function loadMe(token: string): Promise<{ status: number; data: MeResponse | null }> {
  const res = await fetch(apiUrl('/v1/get-me'), { headers: bearer(token) });
  if (!res.ok) return { status: res.status, data: null };
  return { status: res.status, data: await res.json() as MeResponse };
}

function revokeToken(token: string) {
  void postJson('/v1/auth/logout', {}, token).catch(() => {});
}

// A profile created in the last few minutes belongs to a brand-new account.
const FRESH_PROFILE_WINDOW_MS = 15 * 60 * 1000;
function isFreshProfile(profile: Profile): boolean {
  const createdAt = Date.parse(String(profile.created_at ?? ''));
  return Number.isFinite(createdAt) && Date.now() - createdAt < FRESH_PROFILE_WINDOW_MS;
}

/** True when the game session may start loading before auth hydration finishes. */
export function canPrefetchGameSession(_userId: string): boolean {
  // A reset or sign-in link is about to replace the session.
  const params = readAuthUrlParams();
  return !params.reset && !params.verify && !params.login;
}

function writeUserCacheFromState(
  state: Pick<AuthState, 'session' | 'profile' | 'stats'>,
  expectedUserId?: string,
) {
  if (!state.session) return;
  if (expectedUserId && state.session.user.id !== expectedUserId) return;
  writeProfileCache(state.session.user.id, state.profile, state.stats);
}

/** Synchronously builds the boot profile from the persisted session and the profile cache. */
export function readBootProfile(): BootProfile | null {
  migrateLegacyUserCache();
  const userId = readPersistedSessionUserId();
  if (!userId) return null;
  const entry = readProfileCache(userId);
  if (!entry?.profile) return null;
  return {
    userId,
    profile: entry.profile,
    stats: entry.stats ?? null,
    avatar: readCachedAvatar(userId),
  };
}

const initialBootProfile = readBootProfile();

function getGuestAuthState(): Pick<
  AuthState,
  'user'
  | 'session'
  | 'profile'
  | 'stats'
  | 'hasResolvedProfile'
  | 'isProfileHydrating'
  | 'displayBallSync'
  | 'isGuest'
  | 'pendingEmail'
  | 'pendingPasswordRecovery'
  | 'bootProfile'
  | 'cachedAvatar'
> {
  return {
    user: null,
    session: null,
    profile: null,
    stats: null,
    hasResolvedProfile: false,
    isProfileHydrating: false,
    displayBallSync: { inFlight: false, pendingBallId: null, requestId: 0 },
    isGuest: true,
    pendingEmail: null,
    pendingPasswordRecovery: false,
    bootProfile: null,
    cachedAvatar: null,
  };
}

const useAuthStore = create<AuthState & AuthActions>((set, get) => {
  /** Adopts a session: persists it, then loads the profile and stats. */
  const applySession = async (session: Session) => {
    const sessionEpoch = ++authSessionEpoch;
    writeStoredSession(session);
    const gameStore = useGameStore.getState();
    gameStore.setStorageScope(session.user.id);
    // A guest who just signed up brings today's guesses along: hold the
    // server session load until they are imported (or we give up).
    const mayMigrateGuest = gameStore.hasGuestProgress();
    if (mayMigrateGuest) gameStore.beginMigrationGate();

    // Cached profile/stats for instant display while get-me runs.
    const cached = readProfileCache(session.user.id);
    const cachedProfile = cached?.profile ?? null;
    const cachedStats = cached?.stats ?? null;

    set({
      user: session.user,
      session,
      isGuest: false,
      isLoading: false,
      pendingEmail: null,
      hasResolvedProfile: false,
      isProfileHydrating: true,
      bootProfile: null,
      cachedAvatar: readCachedAvatar(session.user.id),
      ...(cached ? { profile: cachedProfile, stats: cachedStats } : {}),
    });

    try {
      const { status, data } = await loadMe(session.access_token);
      if (authSessionEpoch !== sessionEpoch) return;
      if (status === 401) {
        // Revoked or expired: back to guest.
        await get().signOut();
        return;
      }
      if (!data) throw new Error(`get-me failed: ${status}`);

      const fresh: Session = { access_token: session.access_token, user: data.user };
      writeStoredSession(fresh);
      // Only a brand-new account imports the guest game; a returning
      // player keeps their own session.
      if (mayMigrateGuest && data.profile && isFreshProfile(data.profile)) {
        await gameStore.migrateGuestProgress(session.access_token);
      }
      if (authSessionEpoch !== sessionEpoch) return;

      set({
        user: data.user,
        session: fresh,
        profile: data.profile,
        stats: data.stats ?? null,
        hasResolvedProfile: true,
        isProfileHydrating: false,
      });
      writeUserCacheFromState(get(), session.user.id);
    } catch (err) {
      if (authSessionEpoch !== sessionEpoch) return;
      console.error('Session hydration failed:', err);
      set(state => ({
        profile: cachedProfile ?? state.profile,
        stats: cachedStats ?? state.stats,
        hasResolvedProfile: Boolean(cachedProfile ?? state.profile),
        isProfileHydrating: false,
      }));
    } finally {
      if (mayMigrateGuest) gameStore.endMigrationGate();
    }
  };

  /** Drops the session locally (and on the server) and resets to a fresh guest game. */
  const dropSession = async (logLabel: string, revoke: boolean) => {
    const token = get().session?.access_token;
    authSessionEpoch += 1;
    fetchMeInFlight = null;
    useGameStore.getState().invalidateServerSessionSync();
    useGameStore.getState().setStorageScope(null);
    set({ ...getGuestAuthState(), isLoading: false });
    clearStoredSession();
    if (revoke && token) revokeToken(token);
    await resetToFreshGuestGameState(logLabel);
  };

  return {
    user: null,
    session: null,
    profile: null,
    stats: null,
    hasResolvedProfile: false,
    isProfileHydrating: false,
    displayBallSync: {
      inFlight: false,
      pendingBallId: null,
      requestId: 0,
    },
    isLoading: true,
    isGuest: true,
    pendingPasswordRecovery: false,
    pendingEmail: null,
    bootProfile: initialBootProfile,
    cachedAvatar: initialBootProfile?.avatar ?? null,
    authNotice: null,

    initialize: async () => {
      if (authInitInFlight) {
        return authInitInFlight;
      }

      const run = (async () => {
        set({ isLoading: true });
        try {
          const params = readAuthUrlParams();
          if (Object.keys(params).length > 0) clearAuthUrlParams();

          if (params.auth_error) {
            set({ authNotice: AUTH_ERROR_NOTICES[params.auth_error] ?? AUTH_ERROR_NOTICES.google });
          }
          if (params.reset) {
            pendingResetToken = params.reset;
            set({ pendingPasswordRecovery: true });
          }

          let session = readStoredSession();
          if (params.verify) {
            const verified = await sessionFrom(await postJson('/v1/auth/verify', { token: params.verify }));
            if (verified) {
              if (session && session.access_token !== verified.access_token) revokeToken(session.access_token);
              session = verified;
            } else {
              set({ authNotice: 'That confirmation link is invalid or has expired. Sign in to get a new one.' });
            }
          }
          if (params.login) {
            const exchanged = await sessionFrom(await postJson('/v1/auth/google/exchange', { token: params.login }));
            if (exchanged) {
              if (session && session.access_token !== exchanged.access_token) revokeToken(session.access_token);
              session = exchanged;
            } else {
              set({ authNotice: AUTH_ERROR_NOTICES.google });
            }
          }

          if (session) {
            await applySession(session);
          } else {
            useGameStore.getState().setStorageScope(null);
            authSessionEpoch += 1;
            set({ isLoading: false, hasResolvedProfile: false, isProfileHydrating: false, bootProfile: null, cachedAvatar: null });
          }
        } catch (err) {
          console.error('Auth init failed:', err);
          set({ isLoading: false, isProfileHydrating: false, bootProfile: null });
        }
      })();

      // Cleared after the assignment: the body may finish synchronously (guest path).
      authInitInFlight = run;
      void run.finally(() => {
        if (authInitInFlight === run) authInitInFlight = null;
      });
      return run;
    },

    signUp: async (email, password, username) => {
      try {
        const res = await postJson('/v1/auth/signup', { email, password, username });
        const data = await readBody(res);
        if (!res.ok) {
          if (res.status === 429) return { error: 'Too many sign-up attempts. Wait a moment and try again.' };
          return { error: data.error ?? "Couldn't register your Trainer Card. Try again." };
        }
      } catch {
        return { error: 'Connection lost. Check your signal and try again.' };
      }
      set({ pendingEmail: email });
      return { error: null };
    },

    signIn: async (email, password) => {
      const attemptId = ++signInAttemptCounter;
      lastStartedSignInAttemptId = attemptId;
      try {
        const res = await postJson('/v1/auth/login', { email, password });
        // The modal gave up on this attempt; don't sign in behind its back.
        if (timedOutSignInAttemptId === attemptId) {
          timedOutSignInAttemptId = null;
          const late = await sessionFrom(res);
          if (late) revokeToken(late.access_token);
          return { error: null };
        }
        if (!res.ok) {
          const data = await readBody(res);
          if (data.code === 'email_not_verified') {
            set({ pendingEmail: email });
            return { error: 'Confirm your email first. Check your inbox for the link.' };
          }
          if (res.status === 429) return { error: 'Too many sign-in attempts. Wait a few minutes and try again.' };
          return { error: data.error ?? "Couldn't sign in. Try again." };
        }
        const session = await sessionFrom(res);
        if (!session) return { error: "Couldn't sign in. Try again." };
        await applySession(session);
        return { error: null };
      } catch {
        return { error: 'Connection lost. Check your signal and try again.' };
      } finally {
        if (lastStartedSignInAttemptId === attemptId) lastStartedSignInAttemptId = null;
      }
    },

    markSignInTimedOut: async () => {
      if (lastStartedSignInAttemptId === null) {
        return;
      }
      timedOutSignInAttemptId = lastStartedSignInAttemptId;
      if (get().session) {
        await dropSession('Guest game init after sign-in timeout failed:', true);
      }
    },

    signOut: async () => {
      const userId = get().user?.id ?? null;
      timedOutSignInAttemptId = null;
      lastStartedSignInAttemptId = null;
      pendingResetToken = null;
      useGameStore.getState().clearScopedProgress(null);
      if (userId) {
        useGameStore.getState().clearScopedProgress(userId);
      }
      clearAppStorageOnSignOut();
      await dropSession('Guest game init after sign-out failed:', true);
    },

    sendPasswordReset: async (email) => {
      try {
        const res = await postJson('/v1/auth/recover', { email });
        if (res.status === 429) return { error: 'Too many emails requested. Wait a while and try again.' };
        if (!res.ok) return { error: (await readBody(res)).error ?? "Couldn't send the reset email. Try again." };
        return { error: null };
      } catch {
        return { error: 'Connection lost. Check your signal and try again.' };
      }
    },

    confirmPasswordReset: async (password) => {
      if (passwordResetInFlight) {
        return passwordResetInFlight;
      }

      const request = (async () => {
        try {
          if (!pendingResetToken) {
            return { error: 'Password reset link is invalid or expired. Request a new reset email and try again.' };
          }
          const res = await postJson('/v1/auth/reset', { token: pendingResetToken, password });
          if (!res.ok) {
            const data = await readBody(res);
            if (res.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' };
            return { error: data.error ?? 'Could not update password. Please try again.' };
          }
          const session = await sessionFrom(res);
          if (!session) return { error: 'Could not update password. Please try again.' };
          pendingResetToken = null;
          set({ pendingPasswordRecovery: false });
          const previous = get().session;
          if (previous && previous.access_token !== session.access_token) revokeToken(previous.access_token);
          await applySession(session);
          return { error: null };
        } catch (err) {
          console.error('Password reset failed unexpectedly:', err);
          return { error: 'Could not update password. Please try again.' };
        } finally {
          passwordResetInFlight = null;
        }
      })();

      passwordResetInFlight = request;
      return request;
    },

    resendVerification: async () => {
      const { user, pendingEmail } = get();
      const email = user?.email ?? pendingEmail;
      if (!email) return { error: 'No email on file. Please sign out and try again.' };
      try {
        const res = await postJson('/v1/auth/resend', { email });
        if (res.status === 429) return { error: 'Too many emails requested. Wait a while and try again.' };
        if (!res.ok) return { error: (await readBody(res)).error ?? "Couldn't resend the email. Try again." };
        return { error: null };
      } catch {
        return { error: 'Connection lost. Check your signal and try again.' };
      }
    },

    signInWithGoogle: async () => {
      const origin = encodeURIComponent(window.location.origin);
      window.location.assign(apiUrl(`/v1/auth/google/start?origin=${origin}`));
    },

    updateAvatar: async (config) => {
      const { session, profile } = get();
      if (!session) return { error: 'Sign in first, Trainer!' };

      const prevProfile = profile;

      set(state => ({
        profile: state.profile
          ? { ...state.profile, avatar_config: { ...state.profile.avatar_config, ...config } }
          : null,
      }));
      writeUserCacheFromState(get(), session.user.id);

      try {
        const res = await fetch(apiUrl('/v1/update-profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...bearer(session.access_token) },
          body: JSON.stringify(config),
        });

        if (!res.ok) {
          set({ profile: prevProfile });
          writeUserCacheFromState(get(), session.user.id);
          const d = await readBody(res);
          return { error: d.error ?? "Couldn't update your Trainer avatar. Try again." };
        }

        const d = await res.json();
        set(state => ({
          profile: state.profile ? { ...state.profile, avatar_config: d.avatar_config } : null,
        }));
        writeUserCacheFromState(get(), session.user.id);
        return { error: null };
      } catch {
        set({ profile: prevProfile });
        writeUserCacheFromState(get(), session.user.id);
        return { error: 'Connection lost. Check your signal and try again.' };
      }
    },

    fetchMe: async () => {
      const { session } = get();
      if (!session) return { error: null };

      const sessionToken = session.access_token;
      if (fetchMeInFlight && fetchMeInFlight.token === sessionToken) {
        return fetchMeInFlight.promise;
      }

      const request = (async () => {
        try {
          const { status, data } = await loadMe(sessionToken);
          if (status === 401) {
            if (get().session?.access_token === sessionToken) await get().signOut();
            return { error: "You're not signed in, Trainer." };
          }
          if (!data) return { error: "Couldn't load your Trainer data. Try again." };
          const currentState = get();
          const currentSession = currentState.session;
          if (!currentSession || currentSession.access_token !== sessionToken) {
            return { error: null };
          }

          const nextProfile = data.profile
            ? {
                ...(currentState.profile ?? data.profile),
                ...data.profile,
                display_ball: currentState.displayBallSync.inFlight
                  ? (currentState.displayBallSync.pendingBallId ?? currentState.profile?.display_ball ?? data.profile.display_ball)
                  : data.profile.display_ball,
              }
            : currentState.profile;
          const nextStats = data.stats ?? null;
          const profileChanged = !isJsonEqual(currentState.profile, nextProfile);
          const statsChanged = !isJsonEqual(currentState.stats, nextStats);

          if (!profileChanged && !statsChanged) {
            return { error: null };
          }

          set({
            profile: nextProfile,
            stats: nextStats,
          });
          // Write cache so profile/stats appear instantly on next load
          const { session: latestSession } = get();
          if (latestSession && latestSession.access_token === sessionToken) {
            writeProfileCache(latestSession.user.id, nextProfile, nextStats);
          }
          return { error: null };
        } catch {
          return { error: "Couldn't load your Trainer data. Try again." };
        } finally {
          if (fetchMeInFlight?.token === sessionToken) {
            fetchMeInFlight = null;
          }
        }
      })();

      fetchMeInFlight = { token: sessionToken, promise: request };
      return request;
    },

    updateDisplayBall: async (ballId) => {
      const { session } = get();
      if (!session) return { error: "You're not signed in, Trainer." };

      const prevBall = get().profile?.display_ball;
      const requestId = get().displayBallSync.requestId + 1;
      // Optimistic update before network call
      set(state => ({
        profile: state.profile ? { ...state.profile, display_ball: ballId } : null,
        displayBallSync: {
          inFlight: true,
          pendingBallId: ballId,
          requestId,
        },
      }));

      try {
        const res = await fetch(apiUrl('/v1/set-display-ball'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...bearer(session.access_token) },
          body: JSON.stringify({ ball_id: ballId }),
        });
        const data = await readBody(res);
        if (!res.ok) {
          if (get().displayBallSync.requestId !== requestId) {
            return { error: null };
          }
          // Revert on failure
          set(state => ({
            profile: state.profile ? { ...state.profile, display_ball: prevBall ?? 'poke-ball' } : null,
            displayBallSync: {
              inFlight: false,
              pendingBallId: null,
              requestId,
            },
          }));
          return { error: data.error ?? null };
        }

        if (get().displayBallSync.requestId !== requestId) {
          return { error: null };
        }

        set(state => ({
          profile: state.profile ? { ...state.profile, display_ball: ballId } : null,
          displayBallSync: {
            inFlight: false,
            pendingBallId: null,
            requestId,
          },
        }));
        const { profile: updatedProfile, stats: updatedStats } = get();
        writeProfileCache(session.user.id, updatedProfile, updatedStats);
        return { error: null };
      } catch {
        if (get().displayBallSync.requestId !== requestId) {
          return { error: null };
        }
        set(state => ({
          profile: state.profile ? { ...state.profile, display_ball: prevBall ?? 'poke-ball' } : null,
          displayBallSync: {
            inFlight: false,
            pendingBallId: null,
            requestId,
          },
        }));
        return { error: "Couldn't update your display ball. Try again." };
      }
    },

    dismissTierPromptForever: async () => {
      const { session } = get();
      if (!session) return { error: "You're not signed in, Trainer." };

      const previousProfile = get().profile;
      set(state => ({
        profile: state.profile
          ? { ...state.profile, tier_prompt_dismissed_forever: true }
          : null,
      }));

      try {
        const res = await fetch(apiUrl('/v1/dismiss-tier-prompt'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...bearer(session.access_token) },
        });
        const data = await readBody(res);
        if (!res.ok) {
          set({ profile: previousProfile });
          return { error: data.error ?? "Couldn't save this preference. Try again." };
        }

        set(state => ({
          profile: state.profile
            ? { ...state.profile, tier_prompt_dismissed_forever: true }
            : null,
        }));
        writeUserCacheFromState(get(), session.user.id);
        return { error: null };
      } catch {
        set({ profile: previousProfile });
        return { error: 'Connection lost. Check your signal and try again.' };
      }
    },

    setupUsername: async (username) => {
      const { session } = get();
      if (!session) return { error: "You're not signed in, Trainer." };

      try {
        const res = await postJson('/v1/create-profile', { username }, session.access_token);
        if (!res.ok) {
          const data = await readBody(res);
          return { error: data.error ?? "Couldn't save your Trainer name. Try again." };
        }

        const { data } = await loadMe(session.access_token);
        const profile = data?.profile ?? null;
        set({
          profile,
          stats: data?.stats ?? get().stats,
          hasResolvedProfile: true,
          isProfileHydrating: false,
        });
        writeUserCacheFromState(get(), session.user.id);
        if (!profile) {
          return { error: "Couldn't load your Trainer profile yet. Please try again." };
        }
        // Fallback signup path (name picked in the setup modal): import the
        // guest game now, then reload the server session.
        const game = useGameStore.getState();
        if (game.hasGuestProgress()) await game.migrateGuestProgress(session.access_token);
        return { error: null };
      } catch {
        return { error: "Couldn't save your Trainer name. Try again." };
      }
    },

    clearPasswordRecovery: () => {
      pendingResetToken = null;
      set({ pendingPasswordRecovery: false });
    },

    clearAuthNotice: () => set({ authNotice: null }),

    cacheAvatar: (src, dataUrl) => {
      const userId = get().session?.user.id;
      if (!userId) return;
      writeCachedAvatar(userId, src, dataUrl);
      set({ cachedAvatar: { src, dataUrl } });
    },
  };
});

// Queued guesses read the token when they are sent, not when they were typed.
setAccessTokenProvider(() => useAuthStore.getState().session?.access_token ?? null);

export { useAuthStore };
export type { Profile, Stats, BootProfile, CachedAvatar };
export default useAuthStore;
