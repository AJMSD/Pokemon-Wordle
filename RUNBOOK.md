# Runbook

Operational procedures for the PokAcmon Wordle backend.

---

## Apply Migrations Manually

```bash
npx supabase login --token <SUPABASE_ACCESS_TOKEN>
npx supabase link --project-ref fhzyxavhfjhwqvaibyeg
npx supabase db push
```

Check current state first:
```bash
npx supabase migration list
```

---

## Deploy Frontend Manually

```bash
npm run build
# Deploy dist/ to GitHub Pages or your hosting provider
```

CI/CD auto-deploys on every push to `master`.

---

## View Edge Function Logs

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/fhzyxavhfjhwqvaibyeg/functions)
2. Click on the function name
3. Select the "Logs" tab
4. Filter by time range or search for `"event":"rate_limited"` to find rate-limit hits

All functions emit structured JSON logs with `fn`, `method`, `user_id`, `status`, `duration_ms`.

---

## Handle Rate-Limit Alerts

Rate-limit hits are logged as:
```json
{"fn":"rateLimit","event":"rate_limited","key":"<key>","retryAfter":<seconds>}
```

**If rate limiting is excessive:**
1. Check logs for the affected `key` pattern (e.g., `submit-guess:user:<id>`)
2. Identify if it's a single user (abuse) or broad (misconfiguration)
3. For abuse: consider banning the user from Supabase Dashboard > Authentication > Users
4. Limits are set per-function in each `checkRateLimit` call

---

## Auth Troubleshooting

**User cannot log in:**
- Check Supabase Dashboard > Authentication > Users — verify email is confirmed
- Check edge function logs for `"status":401` on `get-me`

**Email verification not received:**
- Check Supabase Dashboard > Authentication > Email Templates
- Verify the SMTP provider is configured (Settings > Authentication > SMTP)

**Session expired errors:**
- Client should refresh the session using Supabase `auth.refreshSession()`
- `gameStore.ts` calls `getAuthSession()` which reads from localStorage

---

## Run Manual Backup

```bash
DB_URL="postgres://postgres:<password>@db.fhzyxavhfjhwqvaibyeg.supabase.co:5432/postgres" \
  ./scripts/backup.sh
```

Get the DB connection string from:
Supabase Dashboard > Settings > Database > Connection string > URI

Backups are saved to `backups/backup_YYYYMMDD_HHMMSS.sql`. The `backups/` directory is gitignored.

---

## Set Up Uptime Monitoring

1. Go to [UptimeRobot](https://uptimerobot.com) and create a free account
2. Add a new monitor:
   - Type: **HTTP(s)**
   - URL: `https://fhzyxavhfjhwqvaibyeg.supabase.co/functions/v1/health`
   - Interval: 5 minutes
3. Configure alert contacts (email, Slack, etc.)
4. The health endpoint returns HTTP 200 when healthy, HTTP 503 when DB is unreachable

---

## Query Analytics Views

From Supabase Dashboard > SQL Editor:

```sql
-- Daily participation
SELECT * FROM analytics_daily_participation LIMIT 30;

-- Overall win rate
SELECT * FROM analytics_win_rate;

-- Streak distribution
SELECT * FROM analytics_streak_distribution;
```

These views are accessible only to the service role (not anon or authenticated users).
