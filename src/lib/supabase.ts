import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
// Support both key names — dashboard shows PUBLISHABLE_KEY, common convention is ANON_KEY
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set — authenticated features disabled');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');

export type { User, Session } from '@supabase/supabase-js';
