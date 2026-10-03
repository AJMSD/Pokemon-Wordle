// Wurmple API server. One process serves every route under /v1.
// Behind the nginx gateway (selfhost/nginx/default.conf), which applies
// per-IP rate limits and forwards the client IP in X-Forwarded-For.
import { corsHeadersFor, jsonResponder } from './shared/cors.ts';
import type { Handler } from './http.ts';
import { getSession } from './routes/get-session.ts';
import { submitGuess } from './routes/submit-guess.ts';
import { migrateGuest } from './routes/migrate-guest.ts';
import { getMe } from './routes/get-me.ts';
import { getBalls, setDisplayBall } from './routes/balls.ts';
import { createProfile, dismissTierPrompt, health, updateProfile } from './routes/profile.ts';
import * as auth from './auth/routes.ts';
import { googleCallback, googleExchange, googleStart } from './auth/google.ts';

export const routes: Record<string, Partial<Record<string, Handler>>> = {
  '/v1/health': { GET: health },
  '/v1/get-session': { GET: getSession },
  '/v1/submit-guess': { POST: submitGuess },
  '/v1/migrate-guest': { POST: migrateGuest },
  '/v1/get-me': { GET: getMe },
  '/v1/get-balls': { GET: getBalls },
  '/v1/set-display-ball': { PATCH: setDisplayBall },
  '/v1/create-profile': { POST: createProfile },
  '/v1/update-profile': { PATCH: updateProfile },
  '/v1/dismiss-tier-prompt': { PATCH: dismissTierPrompt },
  '/v1/auth/signup': { POST: auth.signup },
  '/v1/auth/verify': { POST: auth.verify },
  '/v1/auth/login': { POST: auth.login },
  '/v1/auth/logout': { POST: auth.logout },
  '/v1/auth/resend': { POST: auth.resend },
  '/v1/auth/recover': { POST: auth.recover },
  '/v1/auth/reset': { POST: auth.reset },
  '/v1/auth/google/start': { GET: googleStart },
  '/v1/auth/google/callback': { GET: googleCallback },
  '/v1/auth/google/exchange': { POST: googleExchange },
};

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const json = jsonResponder(req);
  const route = routes[url.pathname];

  if (!route) return json({ error: 'Not found' }, 404);
  // Preflight: answered here so browsers cache it for a day (see cors.ts).
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });

  const handler = route[req.method];
  if (!handler) return json({ error: 'Method not allowed' }, 405);

  const start = Date.now();
  let status = 500;
  try {
    const res = await handler({ req, url, json });
    status = res.status;
    return res;
  } catch (err) {
    console.error(JSON.stringify({ fn: url.pathname, error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  } finally {
    if (url.pathname !== '/v1/health') {
      console.log(JSON.stringify({ fn: url.pathname, method: req.method, status, duration_ms: Date.now() - start }));
    }
  }
}

if (import.meta.main) {
  const port = Number(Deno.env.get('PORT') ?? 8000);
  Deno.serve({ port, hostname: '0.0.0.0' }, handle);
}
