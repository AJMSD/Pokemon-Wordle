# Runbook

Operational procedures for the self-hosted Wurmple backend on ajmsd. All
commands run from `~/Code/Pokemon-Wordle/selfhost` unless noted.

`psql` shorthand used below:

```bash
alias wpsql='docker compose exec -T postgres psql -U postgres -d wurmple'
```

---

## Status and logs

```bash
docker compose ps
docker stats --no-stream | grep wurmple
docker compose logs --tail 100 api       # API (structured JSON, incl. email sending)
docker compose logs --tail 100 gateway   # requests, 429s
tail -50 deploy.log backup.log
```

The API logs one JSON line per request with `fn` (path), `method`, `status`,
`duration_ms`, plus events such as `rate_limited`, `mailer … failed`, and
`google login_failed` (with a reason).

## Restart

```bash
docker compose restart <service>   # postgres | api | gateway
docker compose up -d               # recreate anything whose config changed
```

After changing `selfhost/nginx/*` by hand, run `docker compose exec gateway
nginx -t` and then **restart** the gateway (a reload that changes a rate-limit
zone is refused and the old config silently stays live).

The tunnel runs as the `cloudflared-ajmsd-ops` systemd service
(config: `/etc/cloudflared/config.yml`).

### On boot
The server is a laptop (lid close ignored in `/etc/systemd/logind.conf`).
At boot: the `docker`, `cloudflared-ajmsd-ops` and `cron` services are enabled,
containers use `restart: unless-stopped`, and the crontab runs
`scripts/start.sh` (`docker compose up -d`) so containers that were stopped or
removed before the reboot also come back:

```
@reboot $HOME/Code/Pokemon-Wordle/selfhost/scripts/start.sh >> $HOME/Code/Pokemon-Wordle/selfhost/start.log 2>&1
```

---

## Rate limits

| Layer | Scope | Limit |
|---|---|---|
| nginx | any API call, per client IP | 10 req/s, burst 40; 30 concurrent connections |
| nginx | `/v1/auth/*`, per IP | 2 req/s, burst 20 |
| nginx | `/v1/auth/signup`, `recover`, `resend`, per IP | 5 req/min, burst 5 |
| nginx | `/v1/submit-guess`, per IP | 2 req/s, burst 10 |
| nginx | static site, per IP | 20 req/s, burst 100 |
| app | account emails, global | 250/day (Brevo free tier is 300/day) |
| app | signup | 10/hour per IP |
| app | emails per address (signup, resend, recover) | 5/hour; 10/hour per IP |
| app | login | 30/10 min per IP, 10/10 min per email |
| app | verify, reset, Google exchange | 30/10 min per IP |
| app (`rate_limits` table) | `submit-guess` | 10/min per player |
| app | `get-session` | 30/min per player |
| app | new guest games | 50/day per IP |
| app | `update-profile`, `set-display-ball` | 10/min |
| app | `dismiss-tier-prompt` | 20/min |
| app | `create-profile`, `migrate-guest` | 5/hour |

CORS preflights are not counted by nginx. Client IPs come from Cloudflare's
`CF-Connecting-IP` (only reachable via the tunnel, so it can't be spoofed).
App-level hits log `{"fn":"rateLimit","event":"rate_limited",...}`; nginx
rejections show as 429 in the gateway log and reach the browser as
`{"error":"Rate limit exceeded"}` with CORS headers.

**Excessive limiting:** find the key in the API log. A single user/IP is likely
abuse; many distinct keys suggests a limit is too tight. App limits are the
`checkRateLimit(...)` / `limit(...)` calls in `server/`; nginx limits are in
`selfhost/nginx/default.conf`.

**Remove a user** (signs them out everywhere; their games and stats go too):
```bash
wpsql -c "delete from users where lower(email) = 'x@example.com';"
```

**Sign a user out everywhere:**
```bash
wpsql -c "delete from auth_sessions where user_id = (select id from users where lower(email) = 'x@example.com');"
```

---

## Accounts and email

- Sessions are opaque bearer tokens; only their SHA-256 is stored in
  `auth_sessions`. They expire after 30 days without use.
- SMTP is Brevo (`smtp-relay.brevo.com:587`, login `…@smtp-brevo.com`). Brevo
  IP blocking is disabled because ajmsd's home IP changes.
- **Emails not arriving:** `docker compose logs api | grep mailer`. Check the
  Brevo dashboard (Transactional → Logs) and the 300/day quota. Links point at
  `SITE_URL/?verify=…` and `SITE_URL/?reset=…`.
- **Google sign-in fails:** `docker compose logs api | grep google`. The OAuth
  client (Google Cloud Console → Credentials) must list the authorized
  redirect URI `https://wurmple-api.ajmsd.space/v1/auth/google/callback`;
  `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID` and `GOOGLE_SECRET` must be set.
- **User cannot log in:** `wpsql -c "select email, email_verified_at, password_hash is not null as has_password, google_sub is not null as google from users where lower(email) = 'x@example.com';"`.
  Unconfirmed accounts get `Email not confirmed`; Google-only accounts have no
  password until they use "Forgot password". Unconfirmed signups are deleted
  after 7 days by `cleanup_stale_rows()`.

---

## Backups and restore

Nightly at 03:30 (cron) `scripts/backup.sh` writes a full custom-format dump to
`selfhost/backups/wurmple_*.dump` (14 days kept).

Manual backup: `scripts/backup.sh`

Restore (destructive — replaces current data):

```bash
docker compose stop api
docker compose exec -T postgres pg_restore -U postgres -d wurmple --clean --if-exists \
  < backups/wurmple_YYYYMMDD_HHMMSS.dump
docker compose start api
```

Copy backups off the machine periodically (e.g. to Google Drive).

---

## Uptime monitoring

Point UptimeRobot (free, 5-minute HTTP check) at
`https://wurmple-api.ajmsd.space/v1/health`. It returns 200 when healthy and
503 when the DB is unreachable.

---

## Analytics

```bash
wpsql -c "select * from analytics_win_rate;"
# also: analytics_daily_participation, analytics_streak_distribution
```

---

## Capacity check

```bash
node scripts/loadtest.mjs session 20 15
node scripts/loadtest.mjs guess 20 15
# then clean up:
wpsql -c "delete from daily_sessions where guest_id like 'loadtest-%'; delete from rate_limits where key like '%:ip:%';"
```

## Smoke test

```bash
node scripts/e2e.mjs     # from the repo root; creates and deletes a test account
```

---

## Secrets

- `TARGET_SALT` salts every player's daily Pokémon. **Never change it**; a new
  value changes everyone's target mid-game.
- `POSTGRES_PASSWORD`: rotate with
  `wpsql -c "alter role postgres password '<new>';"`, update `.env`, then
  `docker compose up -d` (recreates `api` with the new value).
- `GOOGLE_SECRET`: rotate in Google Cloud Console, update `.env`, `docker compose up -d api`.
- Sessions can be revoked in bulk with `wpsql -c "delete from auth_sessions;"`
  (everyone signs in again).

## Deploy script notes

- `.env` is parsed as plain `KEY=VALUE` lines (never sourced), so special
  characters in passwords are safe. Use no inline comments after values.
- Order: pull, `npm ci` (lockfile changed), migrations, `compose up -d`, nginx
  check + gateway restart, API restart, frontend build.
- If a step fails, the checkout is reset to the previous commit and the next
  cron run retries. Check `deploy.log`.
- Once a day the script runs `select cleanup_stale_rows();` (stale rate-limit
  rows, old guest games, expired sessions and tokens, week-old unconfirmed
  signups); stamp in `selfhost/.cleanup-stamp`. Failures are logged as
  `cleanup_stale_rows failed (ignored)` and retried on the next run.
- The server has Node 18.19.1, so the site builds with Vite 6 (Vite 7+ needs
  Node 20.19+). Tests (Vitest 5) need Node 22.12+ and run locally/CI only.

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
