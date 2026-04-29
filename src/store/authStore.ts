import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useGameStore } from './gameStore';
import type { User, Session } from '../lib/supabase';
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

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  stats: Stats | null;
  displayBallSync: {
    inFlight: boolean;
    pendingBallId: string | null;
    requestId: number;
  };
  isLoading: boolean;
  isGuest: boolean;
  pendingPasswordRecovery: boolean;
  pendingEmail: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  confirmPasswordReset: (password: string) => Promise<{ error: string | null }>;
  resendVerification: () => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  updateAvatar: (config: Partial<AvatarConfig>) => Promise<{ error: string | null }>;
  fetchMe: () => Promise<{ error: string | null }>;
  updateDisplayBall: (ballId: string) => Promise<{ error: string | null }>;
  setupUsername: (username: string) => Promise<{ error: string | null }>;
  clearPasswordRecovery: () => void;
}

let fetchMeInFlight: { token: string; promise: Promise<{ error: string | null }> } | null = null;
const RECOVERY_PENDING_USER_KEY = 'wurmple_recovery_pending_user_id';

function readRecoveryPendingUserId() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(RECOVERY_PENDING_USER_KEY);
  } catch {
    return null;
  }
}

function markRecoveryRequiredForUser(userId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECOVERY_PENDING_USER_KEY, userId);
  } catch {
    // Ignore storage write failures (quota/private mode)
  }
}

function clearRecoveryRequirement() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RECOVERY_PENDING_USER_KEY);
  } catch {
    // Ignore storage write failures (quota/private mode)
  }
}

function isRecoveryRequiredForUser(userId: string) {
  return readRecoveryPendingUserId() === userId;
}

async function resetToFreshGuestGameState(logLabel: string) {
  const gameStore = useGameStore.getState();
  gameStore.invalidateServerSessionSync();
  localStorage.removeItem('gameState');
  localStorage.removeItem('lastPlayedDate');
  try {
    await gameStore.initializeGame();
  } catch (err) {
    console.error(logLabel, err);
  }
}

function getRecoveryContextFromUrl() {
  if (typeof window === 'undefined') return { isRecovery: false, hasAuthToken: false };

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);

  const type = hashParams.get('type') ?? searchParams.get('type');
  const hasAuthToken = Boolean(
    hashParams.get('access_token')
    || hashParams.get('refresh_token')
    || searchParams.get('access_token')
    || searchParams.get('refresh_token'),
  );

  return {
    isRecovery: type === 'recovery',
    hasAuthToken,
  };
}

function clearRecoveryUrlParams() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const searchKeys = ['type', 'access_token', 'refresh_token', 'expires_in', 'token_type', 'recovery'];
  searchKeys.forEach(key => url.searchParams.delete(key));

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  searchKeys.forEach(key => hashParams.delete(key));
  url.hash = hashParams.toString();

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function writeUserCache(userId: string, profile: Profile | null, stats: Stats | null) {
  try {
    localStorage.setItem('wurmple_user_cache', JSON.stringify({
      userId,
      profile,
      stats,
    }));
  } catch {
    // Ignore cache write failures (quota/private mode)
  }
}

function clearUserCache() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('wurmple_user_cache');
  } catch {
    // Ignore cache remove failures (quota/private mode)
  }
}

function writeUserCacheFromState(
  state: Pick<AuthState, 'session' | 'profile' | 'stats'>,
  expectedUserId?: string,
) {
  if (!state.session) return;
  if (expectedUserId && state.session.user.id !== expectedUserId) return;
  writeUserCache(state.session.user.id, state.profile, state.stats);
}

const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  stats: null,
  displayBallSync: {
    inFlight: false,
    pendingBallId: null,
    requestId: 0,
  },
  isLoading: true,
  isGuest: true,
  pendingPasswordRecovery: false,
  pendingEmail: null,

  initialize: async () => {
    set({ isLoading: true });

    const applySession = async (session: Session, forcePasswordRecovery: boolean) => {
      let cachedProfile: Profile | null = null;
      let cachedStats: Stats | null = null;
      if (forcePasswordRecovery) {
        markRecoveryRequiredForUser(session.user.id);
      }
      const persistentlyRequired = isRecoveryRequiredForUser(session.user.id);

      // Apply cached profile/stats immediately for instant display
      try {
        const cached = localStorage.getItem('wurmple_user_cache');
        if (cached) {
          const cachedData = JSON.parse(cached);
          if (cachedData.userId === session.user.id) {
            cachedProfile = cachedData.profile ?? null;
            cachedStats = cachedData.stats ?? null;
            set({ profile: cachedProfile, stats: cachedStats });
          }
        }
      } catch { /* ignore malformed cache */ }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      set(state => ({
        user: session.user,
        session,
        profile: profile ?? null,
        stats: cachedStats ?? (state.user?.id === session.user.id ? state.stats : null),
        isGuest: false,
        isLoading: false,
        pendingEmail: null,
        pendingPasswordRecovery: forcePasswordRecovery || persistentlyRequired || state.pendingPasswordRecovery,
      }));
      writeUserCacheFromState(get(), session.user.id);
      void get().fetchMe();
    };

    try {
      supabase.auth.onAuthStateChange(async (event, session) => {
        const recoveryFromUrl = getRecoveryContextFromUrl();
        const recoveryFromEvent = event === 'PASSWORD_RECOVERY';
        const forcePasswordRecovery = recoveryFromEvent || (recoveryFromUrl.isRecovery && recoveryFromUrl.hasAuthToken);

        if (session) {
          await applySession(session, forcePasswordRecovery);
        } else {
          set({
            user: null,
            session: null,
            profile: null,
            stats: null,
            displayBallSync: { inFlight: false, pendingBallId: null, requestId: 0 },
            isGuest: true,
            pendingEmail: null,
            pendingPasswordRecovery: false,
          });
          clearUserCache();
          await resetToFreshGuestGameState('Guest game init after auth session loss failed:');
        }
      });

      const recoveryFromUrl = getRecoveryContextFromUrl();
      const { data: { session } } = await supabase.auth.getSession();
      const forcePasswordRecovery = recoveryFromUrl.isRecovery && recoveryFromUrl.hasAuthToken;

      if (session) {
        await applySession(session, forcePasswordRecovery);
      } else {
        clearUserCache();
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('Auth init failed:', err);
      set({ isLoading: false });
    }
  },

  signUp: async (email, password, username) => {
    // Validate email against disposable blocklist first
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL) as string;
      const validateRes = await fetch(`${supabaseUrl}/functions/v1/validate-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!validateRes.ok) {
        if (validateRes.status === 429) {
          return { error: "Too many sign-up attempts. Wait a moment and try again." };
        }
        // Validation endpoint unreachable — allow signup to proceed
      } else {
        const validateData = await validateRes.json();
        if (!validateData.valid) {
          return { error: validateData.reason ?? "That email isn't accepted by the Pokédex. Try another." };
        }
      }
    } catch {
      // If validation endpoint is unreachable, allow signup to proceed
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: 'https://ajmsd.github.io/Pokemon-Wordle',
      },
    });

    if (error) return { error: error.message };

    set({ pendingEmail: email });

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL) as string;
    const { data: { session: newSession } } = await supabase.auth.getSession();
    if (newSession) {
      const res = await fetch(`${supabaseUrl}/functions/v1/create-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newSession.access_token}`,
        },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? "Couldn't register your Trainer Card. Try again." };
    }

    return { error: null };
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    set({
      user: null,
      session: null,
      profile: null,
      stats: null,
      displayBallSync: { inFlight: false, pendingBallId: null, requestId: 0 },
      isGuest: true,
      pendingEmail: null,
      pendingPasswordRecovery: false,
    });
    clearUserCache();
    await resetToFreshGuestGameState('Guest game init after sign-out failed:');

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      console.warn('Supabase sign-out failed (local state already cleared):', err);
    }
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0],
    });
    return { error: error?.message ?? null };
  },

  confirmPasswordReset: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) {
      clearRecoveryRequirement();
      clearRecoveryUrlParams();
    }
    return { error: error?.message ?? null };
  },

  resendVerification: async () => {
    const { user, pendingEmail } = get();
    const email = user?.email ?? pendingEmail;
    if (!email) return { error: 'No email on file. Please sign out and try again.' };
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: 'https://ajmsd.github.io/Pokemon-Wordle' },
    });
    return { error: error?.message ?? null };
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
      },
    });
  },

  updateAvatar: async (config) => {
    const { session, profile } = get();
    if (!session) return { error: 'Sign in first, Trainer!' };

    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const prevProfile = profile;

    set(state => ({
      profile: state.profile
        ? { ...state.profile, avatar_config: { ...state.profile.avatar_config, ...config } }
        : null,
    }));
    writeUserCacheFromState(get(), session.user.id);

    try {
      const res = await fetch(`${base}/functions/v1/update-profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        set({ profile: prevProfile });
        writeUserCacheFromState(get(), session.user.id);
        const d = await res.json().catch(() => ({}));
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

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const request = (async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/get-me`, {
          headers: { 'Authorization': `Bearer ${sessionToken}` },
        });
        if (res.status === 401) return { error: "You're not signed in, Trainer." };
        if (res.status === 404) return { error: 'Trainer profile not found. Try signing in again.' };
        const data = await res.json();
        const { session: currentSession } = get();
        if (!currentSession || currentSession.access_token !== sessionToken) {
          return { error: null };
        }
        set(state => ({
          profile: data.profile
            ? {
                ...(state.profile ?? data.profile),
                ...data.profile,
                display_ball: state.displayBallSync.inFlight
                  ? (state.displayBallSync.pendingBallId ?? state.profile?.display_ball ?? data.profile.display_ball)
                  : data.profile.display_ball,
              }
            : state.profile,
          stats: data.stats ?? null,
        }));
        // Write cache so profile/stats appear instantly on next load
        const { profile: updatedProfile, stats: updatedStats, session: latestSession } = get();
        if (latestSession && latestSession.access_token === sessionToken) {
          writeUserCache(latestSession.user.id, updatedProfile, updatedStats);
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

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/set-display-ball`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ball_id: ballId }),
      });
      const data = await res.json();
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
      writeUserCache(session.user.id, updatedProfile, updatedStats);
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

  setupUsername: async (username) => {
    const { session } = get();
    if (!session) return { error: "You're not signed in, Trainer." };

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/create-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? "Couldn't save your Trainer name. Try again." };

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      set({ profile: profile ?? null });
      writeUserCacheFromState(get(), session.user.id);
      return { error: null };
    } catch {
      return { error: "Couldn't save your Trainer name. Try again." };
    }
  },

  clearPasswordRecovery: () => {
    clearRecoveryRequirement();
    set({ pendingPasswordRecovery: false });
  },
}));

export { useAuthStore };
export type { Profile, Stats };
export default useAuthStore;
