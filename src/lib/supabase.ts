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

export type { User, Session } from '@supabase/supabase-js';
