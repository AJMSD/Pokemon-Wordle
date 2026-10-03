# Deployment Guide

Wurmple is fully self-hosted on **ajmsd** (Ubuntu, Docker) and reached through
the `ajmsd-ops` Cloudflare tunnel. There is no third-party backend.

| Hostname | Serves | Local port |
|---|---|---|
| `wurmple.ajmsd.space` | Built frontend (nginx) | `127.0.0.1:54380` |
| `wurmple-api.ajmsd.space` | The API (`/v1/*`, nginx gateway) | `127.0.0.1:54321` |

Postgres is not published; use `docker compose exec postgres psql`.
`ajmsd.github.io/Pokemon-Wordle` only serves a redirect to the new domain.

## Architecture

`selfhost/docker-compose.yml`:

| Service | Image | Memory cap | Role |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 384 MB | Database (tuned small), volume `pgdata` |
| `api` | `denoland/deno` | 256 MB | `server/main.ts`: game routes and accounts |
| `gateway` | `nginx` | 32 MB | Per-IP rate limits, proxies `/v1/*` to `api`, serves the site |

The API (`server/`) is one Deno process using `npm:postgres`:

- `server/routes/*` – game and profile endpoints (`/v1/get-session`, `/v1/submit-guess`, …)
- `server/auth/*` – email + password accounts (bcrypt), email verification and
  password reset (Brevo SMTP), Google sign-in (OpenID Connect + PKCE), and
  opaque bearer sessions stored hashed in `auth_sessions`
- `server/shared/*` – game logic shared with the frontend via `src/logic/*`
- `db/migrations/*.sql` – plain SQL, applied in order by `server/migrate.ts`

Idle footprint is ~70 MB. See `docs/api.md` for the endpoints.

## Secrets

All secrets live only in `selfhost/.env` on ajmsd (mode 600, gitignored). See
`selfhost/.env.example` for the keys. To set one without echoing it:

```bash
selfhost/scripts/set-secret.sh SMTP_PASS
```

For a brand-new install, generate `POSTGRES_PASSWORD` and `TARGET_SALT` with
`node selfhost/scripts/gen-keys.mjs`. **Never change `TARGET_SALT` afterwards**:
it salts every player's daily Pokémon.

## Continuous deployment

Cron on ajmsd runs `selfhost/scripts/deploy.sh` every 5 minutes. When
`origin/master` has moved it fast-forwards and redeploys only what changed:

- `db/migrations/` → `server/migrate.ts` (in a one-off `api` container) before anything restarts
- `selfhost/` → `docker compose up -d`; nginx config → `nginx -t`, gateway restart
- `server/`, `src/logic/`, `src/data/`, `db/` → restart `api`
- frontend sources → `npm run build` into `selfhost/.build`, synced to `selfhost/site`

GitHub Actions (`.github/workflows/deploy.yml`) runs the unit tests, the
frontend build, and the API's type check and unit tests on every push, and
publishes the GitHub Pages redirect.

Deploy immediately, or redeploy everything:

```bash
ssh ajmsd
~/Code/Pokemon-Wordle/selfhost/scripts/deploy.sh          # if master moved
~/Code/Pokemon-Wordle/selfhost/scripts/deploy.sh --force  # everything
```

Logs: `selfhost/deploy.log`.

## Fresh install

```bash
cd ~/Code/Pokemon-Wordle/selfhost
node scripts/gen-keys.mjs > .env && chmod 600 .env   # then add the rest from .env.example
docker compose up -d --wait postgres
docker compose run --rm api run --config=server/deno.json --frozen \
  --allow-net --allow-env --allow-sys --allow-read=/app server/migrate.ts
scripts/deploy.sh --force
```

## Database migrations

Add the next numbered file to `db/migrations/` (e.g. `0002_add_x.sql`) and
push. The deploy applies it in a transaction before restarting the API.
Never edit a migration that has already run.

## Local development

```bash
npm install
cp .env.example .env.local      # VITE_API_URL: the API you want to use
npm run dev
```

To run the API locally against your own Postgres:

```bash
cd server
DATABASE_URL=postgres://postgres:pw@localhost:5432/wurmple deno task migrate
DATABASE_URL=postgres://postgres:pw@localhost:5432/wurmple \
  TARGET_SALT=dev MAIL_MODE=log SITE_URL=http://localhost:5173 API_URL=http://127.0.0.1:8000 deno task start
```

With `MAIL_MODE=log`, verification and reset links are printed to the API's
output instead of being emailed.

## Tests

```bash
npm test                 # frontend + shared logic (Vitest)
npm run test:server      # API unit tests (Deno)
DATABASE_URL=… deno test --config server/deno.json -A server/integration_test.ts   # API against a real DB
npm run test:e2e         # browser tests (mocked API)
```

## Health check

```bash
curl https://wurmple-api.ajmsd.space/v1/health
```

Expected: `{"status":"healthy","timestamp":"...","db":{"puzzles_count":N}}`
