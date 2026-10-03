// Origins allowed to call the functions from a browser. Auth is a bearer
// header (not cookies), but there is no reason to let arbitrary sites in.
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://wurmple.ajmsd.space',
  'http://localhost:5173',
  'http://localhost:4173',
];

/** The origin to echo in Access-Control-Allow-Origin, or null if not allowed. */
export function allowedOrigin(origin: string | null | undefined): string | null {
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/** CORS headers for one request. Echoes the Origin only when allowlisted. */
export function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    // Browsers cache the preflight for a day instead of repeating it per call.
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const origin = allowedOrigin(req.headers.get('Origin'));
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  return null;
}

/** `json(body, status, extraHeaders)` that carries this request's CORS headers. */
export function jsonResponder(req: Request) {
  const cors = corsHeadersFor(req);
  return (body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', ...extraHeaders },
    });
}
