import { jsonResponder } from './shared/cors.ts';

export type Json = ReturnType<typeof jsonResponder>;

export interface Ctx {
  req: Request;
  url: URL;
  json: Json;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

/** Parsed JSON object body, or null when the body is missing or not an object. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function rateLimited(json: Json, retryAfter = 60): Response {
  return json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429, { 'Retry-After': String(retryAfter) });
}

/** Today's puzzle key (YYYY-MM-DD, JST). */
export function todayKeyJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (value === undefined) throw new Error(`${name} must be set`);
  return value;
}
