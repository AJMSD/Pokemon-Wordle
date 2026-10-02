import { createClient, User } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * User id from a Bearer token without a round trip. Only for starting work
 * early: the gateway (functions-main, VERIFY_JWT) has checked the signature,
 * but callers must still await getAuthUser() before trusting the identity.
 */
export function jwtSubject(authHeader: string | null): string | null {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json);
    return claims.role === 'authenticated' && typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

/** The signed-in user for a request, or null for anon/guest tokens. */
export async function getAuthUser(authHeader: string | null): Promise<User | null> {
  if (!authHeader) return null;
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseUser.auth.getUser();
  return user ?? null;
}
