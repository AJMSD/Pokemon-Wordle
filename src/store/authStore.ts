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

const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  stats: null,
  isLoading: true,
  isGuest: true,
  pendingPasswordRecovery: false,
  pendingEmail: null,

  initialize: async () => {
    set({ isLoading: true });

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Apply cached profile/stats immediately for instant display
        try {
          const cached = localStorage.getItem('wurmple_user_cache');
          if (cached) {
            const cachedData = JSON.parse(cached);
            if (cachedData.userId === session.user.id) {
              set({ profile: cachedData.profile ?? null, stats: cachedData.stats ?? null });
            }
          }
        } catch { /* ignore malformed cache */ }

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        set({
          user: session.user,
          session,
          profile: profile ?? null,
          isGuest: false,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('Auth init failed:', err);
      set({ isLoading: false });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        set({ pendingPasswordRecovery: true });
        return;
      }
      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        set({
          user: session.user,
          session,
          profile: profile ?? null,
          isGuest: false,
          pendingEmail: null,
        });
      } else {
        set({ user: null, session: null, profile: null, stats: null, isGuest: true, pendingEmail: null });
      }
    });
  },

  signUp: async (email, password, username) => {
    // Validate email against disposable blocklist first
    try {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL) as string;
      const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;
      const validateRes = await fetch(`${supabaseUrl}/functions/v1/validate-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
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
    await supabase.auth.signOut({ scope: 'local' });
    localStorage.removeItem('wurmple_user_cache');
    useGameStore.getState().resetGame();
    await useGameStore.getState().initializeGame();
    set({ user: null, session: null, profile: null, stats: null, isGuest: true, pendingEmail: null });
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0],
    });
    return { error: error?.message ?? null };
  },

  confirmPasswordReset: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
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

    try {
      const res = await fetch(`${base}/functions/v1/update-profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        set({ profile: prevProfile });
        const d = await res.json().catch(() => ({}));
        return { error: d.error ?? "Couldn't update your Trainer avatar. Try again." };
      }

      const d = await res.json();
      set(state => ({
        profile: state.profile ? { ...state.profile, avatar_config: d.avatar_config } : null,
      }));
      return { error: null };
    } catch {
      set({ profile: prevProfile });
      return { error: 'Connection lost. Check your signal and try again.' };
    }
  },

  fetchMe: async () => {
    const { session } = get();
    if (!session) return { error: null };

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-me`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (res.status === 401) return { error: "You're not signed in, Trainer." };
      if (res.status === 404) return { error: 'Trainer profile not found. Try signing in again.' };
      const data = await res.json();
      const { session: currentSession } = get();
      set(state => ({
        profile: state.profile && data.profile
          ? { ...state.profile, ...data.profile }
          : state.profile,
        stats: data.stats ?? null,
      }));
      // Write cache so profile/stats appear instantly on next load
      if (currentSession) {
        try {
          const { profile: updatedProfile, stats: updatedStats } = get();
          localStorage.setItem('wurmple_user_cache', JSON.stringify({
            userId: currentSession.user.id,
            profile: updatedProfile,
            stats: updatedStats,
          }));
        } catch { /* ignore quota errors */ }
      }
      return { error: null };
    } catch {
      return { error: "Couldn't load your Trainer data. Try again." };
    }
  },

  updateDisplayBall: async (ballId) => {
    const { session } = get();
    if (!session) return { error: "You're not signed in, Trainer." };

    const prevBall = get().profile?.display_ball;
    // Optimistic update before network call
    set(state => ({
      profile: state.profile ? { ...state.profile, display_ball: ballId } : null,
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
        // Revert on failure
        set(state => ({
          profile: state.profile ? { ...state.profile, display_ball: prevBall ?? 'poke-ball' } : null,
        }));
        return { error: data.error ?? null };
      }
      return { error: null };
    } catch {
      set(state => ({
        profile: state.profile ? { ...state.profile, display_ball: prevBall ?? 'poke-ball' } : null,
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
      return { error: null };
    } catch {
      return { error: "Couldn't save your Trainer name. Try again." };
    }
  },

  clearPasswordRecovery: () => set({ pendingPasswordRecovery: false }),
}));

export { useAuthStore };
export type { Profile, Stats };
export default useAuthStore;
