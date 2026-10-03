# API Reference

All endpoints are Deno edge functions, self-hosted on ajmsd at:
`https://wurmple-api.ajmsd.space/functions/v1/<function-name>`

Requests are rate limited per client IP at the gateway and per user/IP in each
function; see RUNBOOK.md. Exceeding a limit returns HTTP 429 (function-level
limits also send `Retry-After` and `retry_after` in the body).

All responses are JSON. All endpoints support CORS preflight.

---

## Authentication

Pass `Authorization: Bearer <access_token>` for authenticated requests.
Guests send the anon key as the bearer and identify themselves with `guest_id` on the game endpoints.

---

## Endpoints

### GET /get-me

Returns the authenticated user's profile and stats.

**Auth:** Required

**Response 200**
```json
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "profile": {
    "username": "Trainer",
    "display_ball": "poke-ball",
    "avatar_config": {}
  },
  "stats": {
    "current_streak": 3,
    "max_streak": 7,
    "total_participations": 20,
    "total_wins": 15,
    "win_rate": 75,
    "avg_guesses": 4.2,
    "participation_streak": 5,
    "max_participation_streak": 12,
    "total_losses": 5,
    "guess_distribution": { "1": 0, "2": 2, "3": 5, "4": 6, "5": 2 },
    "best_guess_summary": "Solved in 4 guesses: 6 times"
  }
}
```

**Errors:** 401 (missing/invalid token), 404 (profile not found)

**Rate limit:** 30 req/min per user

---

### PATCH /update-profile

Updates the authenticated user's avatar configuration.

**Auth:** Required

**Request body** (all fields optional)
```json
{
  "avatar_mode": "pokemon",
  "avatar_pokemon_id": 25,
  "avatar_form_id": null,
  "avatar_is_shiny": false
}
```

**Response 200**
```json
{
  "avatar_config": {
    "avatar_mode": "pokemon",
    "avatar_pokemon_id": 25,
    "avatar_is_shiny": false
  }
}
```

**Errors:** 400 (invalid field values), 401, 404 (profile not found)

**Rate limit:** 10 req/min per user

---

### POST /set-display-ball

Sets which Poké Ball displays on the user's profile.

**Auth:** Required

**Request body**
```json
{ "ball_id": "great-ball" }
```

**Response 200**
```json
{ "ok": true }
```

**Errors:** 400 (ball not in collection or invalid id), 401

**Rate limit:** 10 req/min per user

---

### GET /get-balls

Returns the full list of balls and which ones the user has unlocked.

**Auth:** Required

**Response 200**
```json
{
  "balls": [
    { "id": "poke-ball", "name": "Poké Ball", "unlocked": true },
    { "id": "great-ball", "name": "Great Ball", "unlocked": false }
  ]
}
```

**Errors:** 401

**Rate limit:** 30 req/min per user

---

### GET /get-session

Loads (or creates) today's session. The answer never leaves the server while
the game is in progress; the client gets per-guess `results` instead.

**Auth:** Bearer access token for signed-in players. Guests send the anon key
as the bearer plus `guest_id` (from the per-user start date; earlier shared-puzzle
days are played locally by guests).

**Query params**
- `puzzle_date_key` (required) — today's JST date, e.g. `2026-10-06`
- `guest_id` (guests only) — `^[A-Za-z0-9_-]{8,64}$`

**Response 200**
```json
{
  "guesses": ["pikachu", "bulbasaur"],
  "results": [["absent","correct","absent","absent","absent","absent","absent"], ["..."]],
  "name_length": 7,
  "hint_flags": { "ability": false, "generation": false, "type": false },
  "hints": {},
  "completion_state": "playing",
  "version": 3,
  "puzzle_metadata": { "name_length": 7 }
}
```

When `completion_state` is `won` or `lost`, `pokemon_name` and `pokemon_id` are also included.

**Errors:** 400 (missing params / not today), 401 (no valid user token or guest id),
429 (rate limit, or more than 50 new guest games per IP per day)

**Rate limit:** 30 req/min per player

---

### POST /submit-guess

Submits a guess for today's puzzle.

**Auth:** as `/get-session` (guests put `guest_id` in the body)

**Request body**
```json
{
  "guess": "charizard",
  "session_version": 3,
  "puzzle_date_key": "2026-10-06",
  "guest_id": "guests only"
}
```

**Response 200** — same shape as `/get-session`, plus `newly_unlocked_balls`
(always empty for guests and unverified users).

**Errors:**
- 400 — duplicate guess, invalid Pokémon name, game already complete, not today
- 401 — no valid user token or guest id
- 409 — `stale_session` (client version mismatch); reload with `/get-session`
- 429 — rate limit

**Rate limit:** 10 req/min per player

---

### POST /refresh-state

Re-syncs a signed-in player's session after a 409. Does not create a session.

**Auth:** Required

**Request body**
```json
{ "puzzle_date_key": "2026-10-06" }
```

**Response 200** — same shape as `/get-session`

---

### POST /migrate-guest

Moves today's guest game onto a newly signed-in account (only if the account
has no session today). Never credits stats.

- Per-user days: the guest's server session is reassigned to the user.
- Shared-puzzle days: the guest played locally, so `guesses` are replayed
  against the shared target to compute hints and completion.

**Auth:** Required

**Request body**
```json
{
  "guest_id": "guest-uuid",
  "puzzle_date_key": "2026-10-06",
  "guesses": ["shared-puzzle days only"]
}
```

**Response 200** — session (same shape as `/get-session`) plus `migrated: boolean`
(`false` when the user already had a session today; that one is returned).

**Errors:** 400 `{code}` (`missing_fields`, `invalid_guest_id`, `wrong_date`,
`invalid_guesses`), 401, 404 `{code: 'no_guest_session'}`, 429

**Rate limit:** 5 req/hour per user

---

### POST /create-profile

Creates a username/profile for a newly registered user.

**Auth:** Required

**Request body**
```json
{ "username": "Trainer42" }
```

Rules: 3–20 characters, letters/numbers/underscores only, must start and end with alphanumeric.

**Response 200**
```json
{ "ok": true }
```

**Errors:** 400 (invalid username format), 401, 409 (username taken)

**Rate limit:** 5 req/hour per user

---

### POST /validate-email

Checks whether an email domain is disposable/temporary.

**Auth:** Not required

**Request body**
```json
{ "email": "user@mailinator.com" }
```

**Response 200**
```json
{ "valid": false, "reason": "Disposable email addresses are not allowed" }
```

Or for a valid email:
```json
{ "valid": true }
```

**Errors:** 400 (malformed email)

**Rate limit:** 10 req/min per IP

---

### GET /get-stats

Returns detailed stats for the authenticated, verified user.

**Auth:** Required (email must be verified)

**Response 200**
```json
{
  "total_participations": 20,
  "games_won": 15,
  "total_losses": 5,
  "current_streak": 3,
  "max_streak": 7,
  "participation_streak": 5,
  "max_participation_streak": 12,
  "guess_distribution": { "1": 0, "2": 2, "3": 5, "4": 6, "5": 2 },
  "win_rate_percent": 75,
  "avg_guesses_to_win": 4.2,
  "best_guess_summary": "Solved in 4 guesses: 6 times"
}
```

**Errors:** 401, 403 (email not verified), 404 (stats not found)

**Rate limit:** 30 req/min per user
