import { isUniqueViolation, jsonb, sql } from '../db.ts';
import { rateLimited, readJson, type Ctx } from '../http.ts';
import { requireUser } from '../auth/session.ts';
import { usernameError } from '../auth/validation.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';

// POST /v1/create-profile {username}
// Fallback when the Trainer name from signup couldn't be used (or Google sign-in).
export async function createProfile({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Invalid token' }, 401);

  const rateLimit = await checkRateLimit(sql, `create-profile:user:${user.id}`, 5, 3600);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const body = await readJson(req);
  const nameError = usernameError(body?.username);
  if (nameError) return json({ error: nameError }, 400);
  const username = String(body!.username).trim();

  try {
    await sql`
      insert into profiles (id, username, display_ball, tier_prompt_dismissed_forever)
      values (${user.id}, ${username}, 'poke-ball', false)`;
  } catch (err) {
    if (isUniqueViolation(err)) return json({ error: 'That Trainer name is already taken' }, 409);
    throw err;
  }
  await sql`update users set signup_username = null where id = ${user.id}`;

  return json({ ok: true }, 200);
}

// PATCH /v1/update-profile {avatar_mode?, avatar_pokemon_id?, avatar_form_id?, avatar_is_shiny?}
export async function updateProfile({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Invalid token' }, 401);

  const rateLimit = await checkRateLimit(sql, `update-profile:user:${user.id}`, 10, 60);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const body = await readJson(req);
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const { avatar_mode, avatar_pokemon_id, avatar_form_id, avatar_is_shiny } = body;

  if (avatar_mode !== undefined && avatar_mode !== 'default' && avatar_mode !== 'pokemon') {
    return json({ error: 'avatar_mode must be "default" or "pokemon"' }, 400);
  }

  if (avatar_pokemon_id !== undefined) {
    const id = Number(avatar_pokemon_id);
    if (!Number.isInteger(id) || id < 1 || id > 1025) {
      return json({ error: 'avatar_pokemon_id must be an integer between 1 and 1025' }, 400);
    }
  }

  if (
    avatar_form_id !== undefined &&
    avatar_form_id !== null &&
    !(typeof avatar_form_id === 'number' && Number.isInteger(avatar_form_id) && avatar_form_id >= 1 && avatar_form_id <= 10277)
  ) {
    return json({ error: 'avatar_form_id must be an integer between 1 and 10277, or null' }, 400);
  }

  if (avatar_is_shiny !== undefined && typeof avatar_is_shiny !== 'boolean') {
    return json({ error: 'avatar_is_shiny must be a boolean' }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (avatar_mode !== undefined) patch.avatar_mode = avatar_mode;
  if (avatar_pokemon_id !== undefined) patch.avatar_pokemon_id = Number(avatar_pokemon_id);
  if (avatar_form_id !== undefined) patch.avatar_form_id = avatar_form_id;
  if (avatar_is_shiny !== undefined) patch.avatar_is_shiny = avatar_is_shiny;

  // Merged in one statement so concurrent patches don't drop each other's keys.
  const [row] = await sql<{ avatar_config: Record<string, unknown> }[]>`
    update profiles set avatar_config = coalesce(avatar_config, '{}'::jsonb) || ${jsonb(patch)}::jsonb
    where id = ${user.id}
    returning avatar_config`;
  if (!row) return json({ error: 'Profile not found' }, 404);

  return json({ avatar_config: row.avatar_config }, 200);
}

// PATCH /v1/dismiss-tier-prompt
export async function dismissTierPrompt({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Invalid token' }, 401);

  const rateLimit = await checkRateLimit(sql, `dismiss-tier-prompt:user:${user.id}`, 20, 60);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const updated = await sql`
    update profiles set tier_prompt_dismissed_forever = true where id = ${user.id} returning id`;
  if (updated.length === 0) return json({ error: 'Profile not found' }, 404);

  return json({ tier_prompt_dismissed_forever: true }, 200);
}

// GET /v1/health
export async function health({ json }: Ctx): Promise<Response> {
  try {
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from daily_puzzles`;
    return json({ status: 'healthy', timestamp: new Date().toISOString(), db: { puzzles_count: count } }, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'health', error: String(err), status: 503 }));
    return json({ status: 'unhealthy', timestamp: new Date().toISOString(), error: 'Database unreachable' }, 503);
  }
}
