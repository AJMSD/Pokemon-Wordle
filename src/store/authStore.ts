import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User, Session } from '../lib/supabase';
import type { AvatarConfig } from '../utils/avatarUtils';

interface Profile {
  id: string;
  username: string;
  avatar_config: AvatarConfig;
  display_ball: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  isGuest: boolean;
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
}

const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isGuest: true,

  initialize: async () => {
    set({ isLoading: true });

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

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

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        set({
          user: session.user,
          session,
          profile: profile ?? null,
          isGuest: false,
        });
      } else {
        set({ user: null, session: null, profile: null, isGuest: true });
      }
    });
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
      const validateData = await validateRes.json();
      if (!validateData.valid) {
        return { error: validateData.reason ?? 'Email address not allowed' };
      }
    } catch {
      // If validation endpoint is unreachable, allow signup to proceed
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });

    if (error) return { error: error.message };

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
      if (!res.ok) return { error: data.error ?? 'Failed to create profile' };
    }

    return { error: null };
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null, isGuest: true });
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  },

  confirmPasswordReset: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  },

  resendVerification: async () => {
    const { user } = get();
    if (!user?.email) return { error: 'No user email found' };
    const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
    return { error: error?.message ?? null };
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
  },

  updateAvatar: async (_config) => {
    // TODO Phase 8: call update-profile edge function
    return { error: null };
  },
}));

export { useAuthStore };
export type { Profile };
export default useAuthStore;
