#!/usr/bin/env bash
# Pulls origin/master and deploys whatever changed: frontend build, DB
# migrations, edge functions, and compose services. Safe to run from cron;
# does nothing when already up to date. Pass --force to redeploy anyway.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
selfhost="$repo/selfhost"
cd "$repo"

exec 9>"$selfhost/.deploy.lock"
flock -n 9 || { echo "deploy already running"; exit 0; }

git fetch -q origin master
old="$(git rev-parse HEAD)"
new="$(git rev-parse origin/master)"

if [[ "${1:-}" != "--force" ]] && git merge-base --is-ancestor "$new" "$old"; then
  exit 0 # up to date (or local checkout is ahead of origin)
fi

echo "[$(date -Is)] deploying $old -> $new"
git merge -q --ff-only origin/master

changed() {
  [[ "${1:-}" == "--force" || "$old" == "$new" ]] && return 0
  git diff --quiet "$old" "$new" -- "${@:2}" && return 1 || return 0
}

set -a; . "$selfhost/.env"; set +a

if changed "${1:-}" package-lock.json; then
  npm ci --no-audit --no-fund
fi

cd "$selfhost"
docker compose up -d --remove-orphans

if changed "${1:-}" supabase/migrations; then
  (cd "$repo" && npx supabase migration up \
    --db-url "postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:54322/postgres")
fi

if changed "${1:-}" selfhost/nginx.conf; then
  docker compose exec -T gateway nginx -s reload
fi

if changed "${1:-}" supabase/functions src/logic selfhost/functions-main; then
  docker compose restart functions
fi

if changed "${1:-}" src public index.html package-lock.json vite.config.ts tailwind.config.js postcss.config.js; then
  cd "$repo"
  VITE_SUPABASE_URL="$API_EXTERNAL_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
    npm run build -- --outDir "$selfhost/.build" --emptyOutDir
  mkdir -p "$selfhost/site"
  rsync -a --delete "$selfhost/.build/" "$selfhost/site/"
fi

echo "[$(date -Is)] deployed $new"
