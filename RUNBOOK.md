# Runbook

Operational procedures for the self-hosted Wurmple backend on ajmsd. All
commands run from `~/Code/Pokemon-Wordle/selfhost` unless noted.

---

## Status and logs

```bash
docker compose ps
docker stats --no-stream | grep wurmple
docker compose logs --tail 100 functions   # edge functions (structured JSON)
docker compose logs --tail 100 auth        # sign-in, email sending
docker compose logs --tail 100 gateway     # requests, 429s
tail -50 deploy.log backup.log
```

Edge functions log JSON with `fn`, `method`, `user_id`, `status`, `duration_ms`.

## Restart

```bash
docker compose restart <service>   # db | auth | rest | functions | gateway
docker compose up -d               # recreate anything whose config changed
```

The tunnel runs as the `cloudflared-ajmsd-ops` systemd service
(config: `/etc/cloudflared/config.yml`).

---

## Rate limits

| Layer | Scope | Limit |
|---|---|---|
| nginx | any API call, per client IP | 10 req/s, burst 40; 30 concurrent connections |
| nginx | `/auth/v1/*`, per IP | 2 req/s, burst 20 |
| nginx | signup / recover / otp / magiclink / resend, per IP | 5 req/min, burst 5 |
| nginx | `submit-guess`, per IP | 2 req/s, burst 10 |
| nginx | static site, per IP | 20 req/s, burst 100 |
| GoTrue | auth emails, global | 12/hour (Brevo free tier is 300/day) |
| app (`rate_limits` table) | `submit-guess` | 10/min per user, 30/min per guest IP |
| app | `get-session`, `get-stats`, `refresh-state` | 30/min |
| app | `update-profile`, `set-display-ball` | 10/min |
| app | `dismiss-tier-prompt` | 20/min |
| app | `create-profile`, `migrate-guest` | 5/hour |
| app | `validate-email` | 10/min per IP |

Client IPs come from Cloudflare's `CF-Connecting-IP` (only reachable via the
tunnel, so it can't be spoofed). App-level hits log
`{"fn":"rateLimit","event":"rate_limited",...}`; nginx rejections show as 429
in the gateway log.

**Excessive limiting:** find the key in function logs. A single user/IP is
likely abuse; many distinct keys suggests a limit is too tight. App limits are
the `checkRateLimit(...)` calls in each function; nginx limits are in
`selfhost/nginx/default.conf`.

**Ban a user:**
```bash
docker compose exec -T db psql -U supabase_admin -d postgres \
  -c "update auth.users set banned_until = 'infinity' where email = 'x@example.com';"
```

---

## Auth and email

- SMTP is Brevo (`smtp-relay.brevo.com:587`, login `…@smtp-brevo.com`). Brevo
  IP blocking is disabled because ajmsd's home IP changes.
- **Emails not arriving:** `docker compose logs auth | grep -i smtp`. Check the
  Brevo dashboard (Transactional → Logs) and the 300/day quota.
- **Google sign-in fails:** the OAuth client must list redirect URI
  `https://wurmple-api.ajmsd.space/auth/v1/callback` and origin
  `https://wurmple.ajmsd.space`.
- **User cannot log in:** check `auth.users.email_confirmed_at` and
  `banned_until`.

---

## Backups and restore

Nightly at 03:30 (cron) `scripts/backup.sh` dumps the `auth` and `public`
schemas to `selfhost/backups/` (14 days kept) and prunes old rate-limit rows.

Manual backup: `scripts/backup.sh`

Restore into the running DB (destructive — replaces current data):

```bash
gunzip -c backups/wurmple_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T db psql -U supabase_admin -d postgres
```

Copy backups off the machine periodically (e.g. to Google Drive).

---

## Uptime monitoring

Point UptimeRobot (free, 5-minute HTTP check) at
`https://wurmple-api.ajmsd.space/functions/v1/health`. It returns 200 when
healthy and 503 when the DB is unreachable.

---

## Analytics

```bash
docker compose exec -T db psql -U supabase_admin -d postgres -c "select * from analytics_win_rate;"
# also: analytics_daily_participation, analytics_streak_distribution
```

Views are readable only by the service role / admin.

---

## Capacity check

```bash
set -a; . ./.env; set +a
node scripts/loadtest.mjs puzzle 20 15
node scripts/loadtest.mjs guess 20 15
# then clean up:
docker compose exec -T db psql -U supabase_admin -d postgres -c \
  "delete from daily_sessions where guest_id like 'loadtest-%'; delete from rate_limits where key like '%:ip:%';"
```

---

## Key rotation

`ANON_KEY` and `SERVICE_ROLE_KEY` are long-lived JWTs (expiry ~2036) signed with
`JWT_SECRET`, so they cannot be revoked individually. To rotate:

1. `node selfhost/scripts/gen-keys.mjs` to generate a new `JWT_SECRET`,
   `ANON_KEY` and `SERVICE_ROLE_KEY`; put them in `selfhost/.env`.
2. `docker compose up -d` (recreates auth, rest, functions) and let the next
   deploy rebuild the frontend (the anon key is baked in at build time; use
   `selfhost/scripts/deploy.sh --force` to rebuild now).
3. All existing user sessions are invalidated; players sign in again.

**Rotating `JWT_SECRET` also changes every player's daily target Pokemon**,
because the per-user target is salted with it. To rotate the secret without
reshuffling targets, first pin the current value: set `TARGET_SALT` in
`selfhost/.env` to the OLD `JWT_SECRET` (or any fixed string used since the
per-user start date), then rotate. `TARGET_SALT`, when set, overrides the
JWT-derived salt. Never change `TARGET_SALT` mid-game for the same reason.

Rotate `POSTGRES_PASSWORD` by `ALTER ROLE ... PASSWORD` for postgres,
authenticator, supabase_auth_admin etc., then update `.env` and `up -d`.

## Deploy script notes

- `.env` is parsed as plain `KEY=VALUE` lines (never sourced), so special
  characters in passwords are safe. Use no inline comments after values.
- Order: pull, `npm ci` (lockfile changed), migrations, `compose up -d`, nginx
  reload (`nginx -t` first), functions restart, frontend build.
- If a step fails, the checkout is reset to the previous commit and the next
  cron run retries. Check `deploy.log`.
- Once a day the script runs `select public.cleanup_stale_rows();` (stale
  rate-limit and guest rows); stamp in `selfhost/.cleanup-stamp`. Failures are
  logged as `cleanup_stale_rows failed (ignored)` and retried on the next run.
- The build needs Node 20.19+ or 22.12+ (Vite 8); tests need Node 22.12+.

## Cloudflare tunnel (cloudflared)

TLS is terminated by Cloudflare, so there is no certificate to renew on the
server. `cloudflared` is not part of docker compose: it runs as the
`cloudflared-ajmsd-ops` systemd service (`Restart=always`, enabled at boot),
config in `/etc/cloudflared/config.yml` mapping `wurmple.ajmsd.space` to
`http://127.0.0.1:54380` and `wurmple-api.ajmsd.space` to
`http://127.0.0.1:54321`.

```bash
systemctl status cloudflared-ajmsd-ops
sudo systemctl restart cloudflared-ajmsd-ops
journalctl -u cloudflared-ajmsd-ops -n 50
```

The gateway trusts `CF-Connecting-IP`, which is safe only because the compose
ports bind to 127.0.0.1; never publish them on another interface.

## Security headers

The site server (`selfhost/nginx/security-headers.inc`) sets HSTS, CSP,
nosniff, X-Frame-Options, Referrer-Policy and Permissions-Policy. If the app
starts using a new third-party origin (fonts, images, API), add it to the CSP
there or the browser will block it.
