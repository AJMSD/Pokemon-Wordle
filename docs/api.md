# API Reference

All endpoints are Supabase Edge Functions deployed at:
`https://<project-ref>.supabase.co/functions/v1/<function-name>`

All responses are JSON. All endpoints support CORS preflight.

---

## Authentication

Pass `Authorization: Bearer <access_token>` for authenticated requests.
Auth-optional endpoints fall back to guest mode when the header is omitted.

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

### GET /get-daily-puzzle

Returns today's puzzle metadata (never reveals the answer).

**Auth:** Not required

**Response 200**
```json
{
  "puzzle_date_key": "2026-04-26",
  "pokemon_name_length": 7,
  "hints_schema": {
    "ability": { "revealed_after_guess": 3 },
    "generation": { "revealed_after_guess": 6 },
    "type": { "revealed_after_guess": 9 }
  }
}
```

**Errors:** 500 (PokeAPI unreachable)

---

### GET /get-session

Loads (or creates) the current daily session for a user or guest.

**Auth:** Optional (Bearer token for users, `guest_id` query param for guests)

**Query params**
- `puzzle_date_key` (required) — e.g. `2026-04-26`
- `guest_id` (required if unauthenticated)

**Response 200**
```json
{
  "guesses": ["pikachu", "bulbasaur"],
  "hint_flags": { "ability": true, "generation": false, "type": false },
  "hints": { "ability": "static" },
  "completion_state": "playing",
  "version": 3,
  "puzzle_metadata": { "name_length": 7 }
}
```

When `completion_state` is `won` or `lost`, `pokemon_name` is also included.

**Errors:** 400 (missing params), 404 (puzzle not found)

**Rate limit:** 30 req/min per user/IP

---

### POST /submit-guess

Submits a Pokémon name guess for today's puzzle.

**Auth:** Optional

**Request body**
```json
{
  "guess": "charizard",
  "session_version": 3,
  "puzzle_date_key": "2026-04-26",
  "guest_id": "guest-uuid-optional"
}
```

**Response 200**
```json
{
  "guesses": ["pikachu", "bulbasaur", "charizard"],
  "hint_flags": { "ability": true, "generation": false, "type": false },
  "hints": { "ability": "blaze" },
  "completion_state": "playing",
  "version": 4,
  "newly_unlocked_balls": []
}
```

**Errors:**
- 400 — duplicate guess, invalid Pokémon name, game already complete
- 404 — puzzle not found
- 409 — `stale_session` (client version mismatch); call `/refresh-state` to re-sync

**Rate limit:** 10 req/min per user/IP

---

### POST /refresh-state

Re-syncs client state with the server after a 409 stale-session error. Does not create a new session.

**Auth:** Optional

**Request body**
```json
{
  "puzzle_date_key": "2026-04-26",
  "guest_id": "guest-uuid-optional"
}
```

**Response 200** — same shape as `/get-session`
```json
{
  "guesses": ["pikachu", "bulbasaur"],
  "hint_flags": { "ability": true, "generation": false, "type": false },
  "hints": { "ability": "static" },
  "completion_state": "playing",
  "version": 3,
  "puzzle_metadata": { "name_length": 7 }
}
```

**Errors:** 400 (missing params), 404 (session or puzzle not found)

**Rate limit:** 30 req/min per user/IP

---

### POST /migrate-guest

Migrates a guest session to an authenticated user account. Only today's session can be migrated. Fails if the user already has a session today.

**Auth:** Required

**Request body**
```json
{
  "guest_id": "guest-uuid",
  "puzzle_date_key": "2026-04-26"
}
```

**Response 200** — merged session state (same shape as `/get-session`)

**Errors:** 400 (not today's date, missing fields), 401, 404 (guest session not found), 409 (user already has a session today)

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
