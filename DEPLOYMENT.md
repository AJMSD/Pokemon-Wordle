# Deployment Guide

Wurmple is fully self-hosted on **ajmsd** (Ubuntu, Docker) and reached through
the `ajmsd-ops` Cloudflare tunnel. Nothing depends on Supabase's hosted service.

| Hostname | Serves | Local port |
|---|---|---|
| `wurmple.ajmsd.space` | Built frontend (nginx) | `127.0.0.1:54380` |
| `wurmple-api.ajmsd.space` | Auth, REST, edge functions (nginx gateway) | `127.0.0.1:54321` |
| — | Postgres (admin/psql only) | `127.0.0.1:54322` |

`ajmsd.github.io/Pokemon-Wordle` only serves a redirect to the new domain.

## Architecture

`selfhost/docker-compose.yml` runs a lean subset of Supabase:

| Service | Image | Memory cap | Role |
|---|---|---|---|
| `db` | `supabase/postgres` | 384 MB | Postgres 17 (tuned small) |
| `auth` | `supabase/gotrue` | 96 MB | Email/password + Google sign-in, Brevo SMTP |
| `rest` | `postgrest/postgrest` | 128 MB | Used by edge functions via supabase-js |
| `functions` | `supabase/edge-runtime` | 512 MB | Runs `supabase/functions/*` |
| `gateway` | `nginx` | 32 MB | Routes `/auth/v1`, `/rest/v1`, `/functions/v1`; serves the site; rate limits |

Realtime, Storage, Studio, analytics, imgproxy and the pooler are omitted. Idle
footprint is ~210 MB.

Edge functions call auth/rest through the gateway's internal listener
(`gateway:8001`), which is not published and not rate limited.

## Secrets

All secrets live only in `selfhost/.env` on ajmsd (mode 600, gitignored). See
`selfhost/.env.example` for the keys. To set one without echoing it:

```bash
selfhost/scripts/set-secret.sh SMTP_PASS
```

Generate fresh DB/JWT secrets for a brand-new install with
`node selfhost/scripts/gen-keys.mjs` (rotating `JWT_SECRET` signs everyone out).

## Continuous deployment

Cron on ajmsd runs `selfhost/scripts/deploy.sh` every 5 minutes. When
`origin/master` has moved it fast-forwards and redeploys only what changed:

- `selfhost/` → `docker compose up -d`, nginx reload
- `supabase/migrations/` → `supabase migration up` against the local DB
- `supabase/functions/`, `src/logic/` → restart edge functions
- frontend sources → `npm run build` into `selfhost/.build`, synced to `selfhost/site`

GitHub Actions (`.github/workflows/deploy.yml`) runs unit tests and the build
on every push and publishes the GitHub Pages redirect.

Deploy immediately, or redeploy everything:

```bash
ssh ajmsd
~/Code/Pokemon-Wordle/selfhost/scripts/deploy.sh          # if master moved
~/Code/Pokemon-Wordle/selfhost/scripts/deploy.sh --force  # everything
```

Logs: `selfhost/deploy.log`.

## Database migrations

Add a file to `supabase/migrations/` and push. The deploy applies it. Clients
only get read access to their own rows; all writes go through edge functions
using the service role, so new tables need no client write policies.

## Local development

```bash
npm install
cp .env.example .env.local   # point VITE_SUPABASE_URL at the API you want
npm run dev
```

## Health check

```bash
curl https://wurmple-api.ajmsd.space/functions/v1/health
```

Expected: `{"status":"healthy","timestamp":"...","db":{"puzzles_count":N}}`
