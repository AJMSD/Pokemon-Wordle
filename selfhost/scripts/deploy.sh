#!/usr/bin/env bash
# Pulls origin/master and deploys whatever changed: frontend build, DB
# migrations, the API server, and compose services. Safe to run from cron;
# does nothing when already up to date. Pass --force to redeploy anyway.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
selfhost="$repo/selfhost"
cd "$repo"

exec 9>"$selfhost/.deploy.lock"
flock -n 9 || { echo "deploy already running"; exit 0; }

# Read KEY=VALUE lines from .env WITHOUT executing it (no `source`): values may
# contain $, backticks, quotes or spaces (e.g. SMTP passwords). Compose parses
# the same file itself, so one layer of surrounding quotes is stripped to match.
load_env() {
  local line key val
  local dq_re='^"(.*)"$' sq_re="^'(.*)'\$"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$val" =~ $dq_re ]] || [[ "$val" =~ $sq_re ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    export "$key=$val"
  done < "$1"
}
load_env "$selfhost/.env"

# Once a day (even when the repo is up to date) purge stale rate-limit and
# guest rows. Best effort: a failure is logged and never aborts the deploy.
# The stamp is only written on success, so a failure is retried next run.
stamp="$selfhost/.cleanup-stamp"
today="$(date +%F)"
if [[ "$(cat "$stamp" 2>/dev/null || true)" != "$today" ]]; then
  if docker compose -f "$selfhost/docker-compose.yml" exec -T postgres \
      psql -U postgres -d wurmple -v ON_ERROR_STOP=1 -qtc \
      "select cleanup_stale_rows();" >/dev/null 2>&1; then
    echo "$today" > "$stamp"
    echo "[$(date -Is)] cleanup_stale_rows ok"
  else
    echo "[$(date -Is)] cleanup_stale_rows failed (ignored)"
  fi
fi

git fetch -q origin master
old="$(git rev-parse HEAD)"
new="$(git rev-parse origin/master)"

if [[ "${1:-}" != "--force" ]] && git merge-base --is-ancestor "$new" "$old"; then
  exit 0 # up to date (or local checkout is ahead of origin)
fi

echo "[$(date -Is)] deploying $old -> $new"
git merge -q --ff-only origin/master

# If any later step fails, put the checkout back on the previous commit so the
# next cron run sees "not up to date" and retries, instead of silently leaving
# new code on disk with old containers or an unmigrated schema.
rollback() {
  local rc=$?
  if [[ $rc -ne 0 && "$old" != "$new" ]]; then
    echo "[$(date -Is)] deploy FAILED (exit $rc); resetting checkout to $old for retry"
    git -C "$repo" reset -q --hard "$old" || true
  fi
}
trap rollback EXIT

changed() {
  [[ "${1:-}" == "--force" || "$old" == "$new" ]] && return 0
  # Paths are repo-relative; run from the repo root regardless of cwd.
  git -C "$repo" diff --quiet "$old" "$new" -- "${@:2}" && return 1 || return 0
}

if changed "${1:-}" package-lock.json; then
  npm ci --no-audit --no-fund
fi

cd "$selfhost"

# Migrate BEFORE (re)starting anything, so new API code never runs against
# the old schema and a failed migration stops the deploy with old code live.
if changed "${1:-}" db/migrations; then
  docker compose up -d --wait postgres
  docker compose run --rm api run --config=server/deno.json --frozen \
    --allow-net --allow-env --allow-sys --allow-read=/app server/migrate.ts
fi

docker compose up -d --remove-orphans

# Reload nginx before anything depends on new routes/listeners.
if changed "${1:-}" selfhost/nginx; then
  docker compose exec -T gateway nginx -t
  docker compose exec -T gateway nginx -s reload
fi

if changed "${1:-}" server src/logic src/data db; then
  docker compose restart api
fi

if changed "${1:-}" src public index.html package-lock.json vite.config.ts tailwind.config.js postcss.config.js; then
  cd "$repo"
  VITE_API_URL="$API_URL" \
    npm run build -- --outDir "$selfhost/.build" --emptyOutDir
  mkdir -p "$selfhost/site"
  rsync -a --delete "$selfhost/.build/" "$selfhost/site/"
fi

echo "[$(date -Is)] deployed $new"
