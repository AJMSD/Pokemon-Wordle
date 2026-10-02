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
