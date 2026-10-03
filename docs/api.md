# API Reference

One Deno server (`server/main.ts`), self-hosted on ajmsd at:
`https://wurmple-api.ajmsd.space/v1/<endpoint>`

Requests are rate limited per client IP at the gateway and per user/IP/email
in the API; see RUNBOOK.md. Exceeding a limit returns HTTP 429 with
`Retry-After` and `{"error": "Rate limit exceeded", "retry_after": <seconds>}`.

All responses are JSON (except the Google redirects). CORS is allowed for the
site origin and `localhost:5173` / `localhost:4173`; preflights are cached for a day.

---

## Authentication

Signed-in requests send `Authorization: Bearer <token>`, where the token comes
from `/v1/auth/login`, `/v1/auth/verify`, `/v1/auth/reset` or
`/v1/auth/google/exchange`. Tokens are opaque, last 30 days from last use, and
end at `/v1/auth/logout` or a password reset.

Guests send **no** Authorization header and identify themselves with
`guest_id` on the game endpoints. A request that sends an unknown or expired
token gets 401.

The `user` object returned by the auth endpoints and `/v1/get-me`:

```json
{ "id": "uuid", "email": "ash@example.com", "email_confirmed_at": "2026-10-01T00:00:00.000Z" }
```

---

## Accounts

None of these endpoints reveal whether an email is registered.

### POST /v1/auth/signup

```json
{ "email": "ash@example.com", "password": "at least 8 chars", "username": "AshK" }
```

Creates an unconfirmed account and emails a confirmation link
(`SITE_URL/?verify=<token>`, valid 24 hours). No session is created yet.
Signing up again before confirming replaces the password and invalidates
earlier links.

**200** `{ "ok": true }` (also for an already-registered address; nothing is sent)
**400** invalid email, disposable email domain, password under 8 characters, bad Trainer name
**409** Trainer name already taken

### POST /v1/auth/verify

`{ "token": "<from the email link>" }` → **200** `{ token, user }`; creates the
profile from the signup Trainer name (if it was taken meanwhile, `get-me`
returns `profile: null` and the app asks for another). **400**
`{ code: "invalid_token" }` for unknown, used or expired links.

### POST /v1/auth/login

`{ "email", "password" }` → **200** `{ token, user }`.
**400** `Invalid login credentials`. **403** `{ code: "email_not_verified" }`.

### POST /v1/auth/logout

Bearer token → **200**; the token stops working.

### POST /v1/auth/resend

`{ "email" }` → **200** always; re-sends the confirmation link if the account
exists and is unconfirmed.

### POST /v1/auth/recover

`{ "email" }` → **200** always; emails `SITE_URL/?reset=<token>` (valid 1 hour)
if the account exists.

### POST /v1/auth/reset

`{ "token", "password" }` → **200** `{ token, user }`. Sets the password,
confirms the email, and signs out all other sessions. **400** weak password or
`{ code: "invalid_token" }`.

### Google sign-in

1. `GET /v1/auth/google/start?origin=<site origin>` → 302 to Google (state and
   PKCE verifier in a short-lived signed cookie).
2. Google → `GET /v1/auth/google/callback` → 302 to `<origin>/?login=<code>`
   (or `?auth_error=google` / `google_disabled`). The account is matched by
   Google id, else linked by verified email, else created (no profile yet).
3. `POST /v1/auth/google/exchange` `{ "token": "<code>" }` → **200**
   `{ token, user }`. Codes are single-use and expire after 60 seconds.

The Google OAuth client's authorized redirect URI must be
`https://wurmple-api.ajmsd.space/v1/auth/google/callback`.

---

## Profile

### GET /v1/get-me

**Auth:** required

```json
{
  "user": { "id": "uuid", "email": "ash@example.com", "email_confirmed_at": "…" },
  "profile": {
    "id": "uuid",
    "username": "AshK",
    "display_ball": "poke-ball",
    "avatar_config": {},
    "tier_prompt_dismissed_forever": false,
    "created_at": "…"
  },
  "stats": {
    "current_streak": 3,
    "max_streak": 7,
    "total_participations": 20,
    "total_wins": 15,
    "win_rate": 0.75,
    "avg_guesses": 4.2,
    "participation_streak": 5,
    "max_participation_streak": 12,
    "total_losses": 5,
    "guess_distribution": { "2": 2, "3": 5, "4": 6 },
    "best_guess_summary": "Solved in 2 guesses: 2 times"
  }
}
```

`profile` is `null` until the account has a Trainer name (see `/v1/create-profile`).

**Errors:** 401

### POST /v1/create-profile

`{ "username": "AshK" }` → **200** `{ "ok": true }`. Trainer names are 3–20
letters, digits or underscores (not at either end), unique ignoring case.
**400** invalid name, **409** taken. **Rate limit:** 5/hour per user.

### PATCH /v1/update-profile

All fields optional:

```json
{ "avatar_mode": "pokemon", "avatar_pokemon_id": 25, "avatar_form_id": null, "avatar_is_shiny": false }
```

→ **200** `{ "avatar_config": { … merged … } }`. **400** invalid values, **404**
no profile. **Rate limit:** 10/min per user.

### PATCH /v1/dismiss-tier-prompt

→ **200** `{ "tier_prompt_dismissed_forever": true }`. **Rate limit:** 20/min.

### GET /v1/get-balls

**Auth:** required (confirmed email)

```json
{
  "current_streak_tier": "great-ball",
  "display_ball": "great-ball",
  "balls": [
    { "id": "poke-ball", "display_name": "Poké Ball", "category": "standard", "status": "past_tier", "hint": null },
    { "id": "quick-ball", "display_name": "Quick Ball", "category": "achievement", "status": "locked", "hint": "Solve a puzzle in 1 or 2 guesses" }
  ]
}
```

Standard balls have `status` `past_tier` / `current_tier` / `future_tier`;
achievement balls `unlocked` / `locked`.

### PATCH /v1/set-display-ball

`{ "ball_id": "great-ball" }` → **200** `{ "display_ball": "great-ball" }`.
Allowed: the current streak tier's standard ball, or an unlocked achievement
ball. **400** unknown or unavailable ball. **Rate limit:** 10/min per user.

---

## Game

The answer never leaves the server while the game is in progress; the client
gets per-guess `results` instead.

### GET /v1/get-session

Loads (or creates) today's session.

**Query params**
- `puzzle_date_key` (required) — today's JST date, e.g. `2026-10-06`
- `guest_id` (guests only) — `^[A-Za-z0-9_-]{8,64}$`. Guests play on the server
  from the per-user start date; earlier shared-puzzle days are played locally.

**Response 200**
```json
{
  "guesses": ["pikachu", "bulbasaur"],
  "results": [["absent","correct","absent","absent","absent","absent","absent"], ["…"]],
  "name_length": 7,
  "hint_flags": { "ability": false, "generation": false, "type": false },
  "hints": {},
  "completion_state": "playing",
  "version": 3,
  "puzzle_metadata": { "name_length": 7 }
}
```

When `completion_state` is `won` or `lost`, `pokemon_name` and `pokemon_id` are
also included.

**Errors:** 400 (missing params / not today), 401 (bad token, or neither token
nor guest id), 429 (rate limit, or more than 50 new guest games per IP per day)

**Rate limit:** 30 req/min per player

### POST /v1/submit-guess

```json
{ "guess": "charizard", "session_version": 3, "puzzle_date_key": "2026-10-06", "guest_id": "guests only" }
```

**Response 200** — same shape as `/v1/get-session`, plus `newly_unlocked_balls`
(always empty for guests).

**Errors:**
- 400 — duplicate guess, invalid Pokémon name, game already complete, not today
- 401 — bad token, or neither token nor guest id
- 409 — `stale_session` (client version mismatch); reload with `/v1/get-session`
- 429 — rate limit

**Rate limit:** 10 req/min per player

### POST /v1/migrate-guest

Moves today's guest game onto a newly signed-in account (only if the account
has no session today). Never credits stats for guesses made as a guest.

- Per-user days: the guest's server session is reassigned to the user.
- Shared-puzzle days: the guest played locally, so `guesses` are replayed
  against the shared target to compute hints and completion.

**Auth:** required

```json
{ "guest_id": "guest-uuid", "puzzle_date_key": "2026-10-06", "guesses": ["shared-puzzle days only"] }
```

**Response 200** — session (same shape as `/v1/get-session`) plus
`migrated: boolean` (`false` when the user already had a session today; that
one is returned).

**Errors:** 400 `{code}` (`missing_fields`, `invalid_guest_id`, `wrong_date`,
`invalid_guesses`), 401, 404 `{code: 'no_guest_session'}`, 429

**Rate limit:** 5 req/hour per user

---

## GET /v1/health

No auth. **200** `{ "status": "healthy", "timestamp": "…", "db": { "puzzles_count": N } }`,
**503** when the database is unreachable.
