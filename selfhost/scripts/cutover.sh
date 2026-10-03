#!/usr/bin/env bash
# One-time move from the old stack (supabase/postgres + GoTrue + PostgREST +
# edge runtime) to plain Postgres + the Deno API server.
#
#   cutover.sh --dry-run    Rehearsal. Exports the live data into a throwaway
#                           copy of the new stack (compose project
#                           "<project>-dryrun", separate git worktree), migrates,
#                           imports and checks row counts, then deletes it.
#                           The live checkout and containers are not touched.
#   cutover.sh              The real thing (~1 minute of API downtime). Rolls
#                           back to the old stack automatically on any failure.
#   cutover.sh --finalize   After the new stack is confirmed working: deletes
#                           the old database volume, backups of .env/site, and
#                           the old images.
#
# The new stack is built, migrated and loaded from a separate git worktree;
# the live checkout only moves forward once the old API is stopped and the
# data is in. Old containers' bind-mounted files therefore never disappear
# while they run, and nothing ever docker-cp's into an old container.
#
# Env: REPO (default ~/Code/Pokemon-Wordle), CUTOVER_REF (default origin/no-supabase),
#      CUTOVER_PROJECT (compose project, default wurmple; for rehearsals).
set -euo pipefail

mode="${1:-run}"
case "$mode" in --dry-run|run|--finalize) ;; *) echo "usage: $0 [--dry-run|--finalize]" >&2; exit 2 ;; esac

repo="${REPO:-$HOME/Code/Pokemon-Wordle}"
ref="${CUTOVER_REF:-origin/no-supabase}"
project="${CUTOVER_PROJECT:-wurmple}"
selfhost="$repo/selfhost"
marker="$selfhost/.cutover-done"
ts="$(date +%Y%m%d_%H%M%S)"
work="$(mktemp -d "/tmp/wurmple-cutover.XXXXXX")"
log="$selfhost/cutover.log"

exec > >(tee -a "$log") 2>&1
say() { echo "[$(date -Is)] $*"; }
die() { say "ERROR: $*"; exit 1; }

say "=== cutover $mode (project $project, ref $ref) ==="
cd "$repo"

# Containers of the live compose project, by service name.
container_of() {
  docker ps -aq --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

# ---------------------------------------------------------------- finalize --
if [[ "$mode" == "--finalize" ]]; then
  [[ -f "$marker" ]] || die "no $marker: run the cutover first"
  for svc in db auth rest functions; do
    [[ -z "$(container_of "$svc")" ]] || die "old '$svc' container still exists; is the old stack running?"
  done
  docker volume rm "${project}_db-data" "${project}_db-config" "${project}_deno-cache" 2>/dev/null || true
  rm -rf "$selfhost/.env.old-stack.bak" "$selfhost/site.old-stack.bak"
  for image in supabase/postgres:17.6.1.136 supabase/gotrue:v2.196.0 supabase/edge-runtime:v1.76.2 postgrest/postgrest:v14.17; do
    docker image rm "$image" 2>/dev/null && say "removed image $image" || true
  done
  say "finalized. Remaining $project volumes:"
  docker volume ls --format '{{.Name}}' | grep "^${project}_" || true
  exit 0
fi

# --------------------------------------------------------------- preflight --
[[ ! -f "$marker" ]] || die "already cut over ($marker exists)"
[[ -f "$selfhost/.env" ]] || die "missing $selfhost/.env"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "live checkout has local changes; fix them first"
old_db="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=db")"
[[ -n "$old_db" ]] || die "old db container is not running"
[[ "$(docker inspect -f '{{.Config.Image}}' "$old_db")" == supabase/postgres:* ]] || die "db container is not the old supabase/postgres image"
avail_kb="$(df -Pk "$selfhost" | awk 'NR==2 {print $4}')"
(( avail_kb > 2*1024*1024 )) || die "less than 2 GB free disk"

# Hold the deploy lock so cron deploys skip while we work.
exec 9>"$selfhost/.deploy.lock"
flock -n 9 || die "a deploy is running; try again in a minute"

git fetch -q origin
git rev-parse -q --verify "$ref^{commit}" >/dev/null || die "unknown ref $ref"
old_commit="$(git rev-parse HEAD)"
new_commit="$(git rev-parse "$ref")"
git merge-base --is-ancestor "$old_commit" "$new_commit" || die "$ref does not contain the current checkout ($old_commit)"
say "old commit $old_commit, new commit $new_commit"

# ------------------------------------------------------------------ helpers --
old_psql() { docker exec -i "$old_db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

# Tables to copy, in import (foreign key) order, with the new schema's columns.
tables=(users ball_catalog daily_puzzles pokemon_info profiles daily_sessions daily_results user_stats ball_unlocks)
declare -A cols=(
  [users]="id, email, password_hash, email_verified_at, google_sub, signup_username, created_at"
  [ball_catalog]="id, display_name, description, category, unlock_condition"
  [daily_puzzles]="id, puzzle_date_key, pokemon_id, pokemon_name, pokemon_data, created_at"
  [pokemon_info]="pokemon_id, pokemon_name, pokemon_data"
  [profiles]="id, username, avatar_config, display_ball, created_at, updated_at, tier_prompt_dismissed_forever"
  [daily_sessions]="id, user_id, guest_id, puzzle_date_key, guesses, hint_flags, completion_state, version, created_at, updated_at, puzzle_id, target_pokemon_id, target_pokemon_name, target_pokemon_data"
  [daily_results]="id, user_id, puzzle_date_key, pokemon_name, guesses, guess_count, result, completed_at"
  [user_stats]="user_id, total_participations, games_won, current_streak, max_streak, last_played_date, guess_distribution, updated_at, total_losses, participation_streak, max_participation_streak, last_participation_date, water_bug_daily_wins, wins_after_loss_streak"
  [ball_unlocks]="id, user_id, ball_id, unlocked_at"
)

# Old-database query that yields each table's rows in the new shape.
export_query() {
  if [[ "$1" == users ]]; then
    cat <<'SQL'
select u.id,
       u.email,
       nullif(u.encrypted_password, '') as password_hash,
       u.email_confirmed_at as email_verified_at,
       (select i.provider_id from auth.identities i
         where i.user_id = u.id and i.provider = 'google'
         order by i.created_at limit 1) as google_sub,
       case when exists (select 1 from public.profiles p where p.id = u.id) then null
            else nullif(btrim(u.raw_user_meta_data->>'username'), '') end as signup_username,
       u.created_at
from auth.users u
SQL
  else
    echo "select ${cols[$1]} from public.$1"
  fi
}

# Copies every table out of the old database in one consistent snapshot.
# Files are streamed out with `docker exec cat` (never `docker cp`, which
# re-mounts the container's binds).
export_old() {
  local dir="$1" in=/tmp/cutover-export t
  docker exec -u root "$old_db" sh -c "rm -rf $in && mkdir -m 777 $in"
  {
    echo "begin isolation level repeatable read read only;"
    local counts=()
    for t in "${tables[@]}"; do
      echo "copy ($(export_query "$t")) to '$in/$t.csv' csv header;"
      counts+=("select '$t' as t, count(*) from ($(export_query "$t")) x")
    done
    echo "copy ($(printf '%s\nunion all\n' "${counts[@]}" | sed '$d')) to '$in/counts.csv' csv;"
    echo "commit;"
  } | old_psql -q
  mkdir -p "$dir"
  ( umask 077
    for t in "${tables[@]}" counts; do
      docker exec "$old_db" cat "$in/$t.csv" > "$dir/$t.csv"
    done )
  docker exec -u root "$old_db" rm -rf "$in"
  say "exported: $(tr '\n' ' ' < "$dir/counts.csv")"
}

# Imports the CSVs into the new database (one transaction) and checks counts.
import_new() {
  local dir="$1" in=/tmp/cutover-import pg t
  pg="$("${compose[@]}" ps -q postgres)"
  [[ -n "$pg" ]] || die "new postgres container not found"
  docker exec -u root "$pg" sh -c "rm -rf $in && mkdir -m 755 $in"
  docker cp -q "$dir/." "$pg:$in/"
  docker exec -u root "$pg" chmod -R a+r "$in"
  {
    echo "begin;"
    echo "copy users (${cols[users]}) from '$in/users.csv' csv header;"
    # The signup trigger made empty stats rows; the real ones are imported below.
    echo "delete from user_stats;"
    echo "delete from ball_catalog;"
    for t in "${tables[@]:1}"; do
      echo "copy $t (${cols[$t]}) from '$in/$t.csv' csv header;"
    done
    echo "commit;"
  } | docker exec -i "$pg" psql -U postgres -d wurmple -v ON_ERROR_STOP=1 -q
  docker exec -u root "$pg" rm -rf "$in"

  local bad=0 name want got odd
  while IFS=, read -r name want; do
    got="$(docker exec "$pg" psql -U postgres -d wurmple -tAc "select count(*) from $name")"
    if [[ "$got" == "$want" ]]; then say "  $name: $got rows ok"; else say "  $name: expected $want, got $got"; bad=1; fi
  done < "$dir/counts.csv"
  odd="$(docker exec "$pg" psql -U postgres -d wurmple -tAc \
    "select count(*) from users where password_hash is not null and password_hash !~ '^\\\$2[aby]\\\$'")"
  [[ "$odd" == 0 ]] || { say "  $odd password hashes are not bcrypt"; bad=1; }
  (( bad == 0 )) || die "imported data does not match the export"
}

# New .env from the old one: values copied verbatim, old-only keys dropped.
convert_env() {
  local old="$1" new="$2" line key have_salt=0
  grep -qE '^TARGET_SALT=.+' "$old" && have_salt=1
  ( umask 077
    {
      echo "# Converted from the old stack's .env by cutover.sh on $(date -I)."
      while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        key="${line%%=*}"
        case "$key" in
          POSTGRES_PASSWORD|SITE_URL|SMTP_ADMIN_EMAIL|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_SENDER_NAME|GOOGLE_ENABLED|GOOGLE_CLIENT_ID|GOOGLE_SECRET|MAIL_MODE|GATEWAY_API_PORT|GATEWAY_SITE_PORT)
            echo "$line" ;;
          TARGET_SALT) [[ $have_salt == 1 ]] && echo "$line" ;;
          # Per-user targets were salted with JWT_SECRET when TARGET_SALT was unset.
          JWT_SECRET) [[ $have_salt == 0 ]] && echo "TARGET_SALT=${line#JWT_SECRET=}" ;;
          API_EXTERNAL_URL) echo "API_URL=${line#API_EXTERNAL_URL=}" ;;
        esac
      done < "$old"
    } > "$new" )
  for key in POSTGRES_PASSWORD TARGET_SALT API_URL SITE_URL; do
    grep -qE "^$key=.+" "$new" || die "converted .env has no $key"
  done
}

env_value() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -E "s/^['\"]|['\"]$//g"; }

migrate_new() {
  "${compose[@]}" run --rm -T api run --config=server/deno.json --frozen \
    --allow-net --allow-env --allow-sys --allow-read=/app server/migrate.ts
}

# Separate checkout of the new code; compose runs from it until the switch.
tree="$work/tree"
git worktree add -q --detach "$tree" "$new_commit"
trap 'git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1; rm -rf "$work"' EXIT
convert_env "$selfhost/.env" "$tree/selfhost/.env"
say "converted .env keys: $(cut -d= -f1 "$tree/selfhost/.env" | grep -v '^#' | tr '\n' ' ')"

# ----------------------------------------------------------------- dry run --
if [[ "$mode" == "--dry-run" ]]; then
  compose=(docker compose -p "$project-dryrun" -f "$tree/selfhost/docker-compose.yml")
  cleanup_dry() {
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup_dry EXIT

  export_old "$work/export"
  "${compose[@]}" up -d --wait postgres
  migrate_new
  import_new "$work/export"
  "${compose[@]}" up -d --wait api
  "${compose[@]}" exec -T api deno eval \
    "const r = await fetch('http://127.0.0.1:8000/v1/health'); console.log(r.status, await r.text()); Deno.exit(r.ok ? 0 : 1)"
  say "DRY RUN OK. Nothing live was changed; the rehearsal stack is being removed."
  exit 0
fi

# ---------------------------------------------------------------- real run --
compose=(docker compose -p "$project" -f "$tree/selfhost/docker-compose.yml")
stage="start"
# CUTOVER_FAIL_AT=<stage> injects a failure (rehearsals of the rollback).
enter_stage() {
  stage="$1"
  [[ "${CUTOVER_FAIL_AT:-}" != "$1" ]] || die "injected failure at '$1'"
}
switched=0   # live checkout moved to the new commit
stopped=()   # old containers we stopped

# Docker recreates missing bind sources as root-owned directories; hand any
# root-owned paths in the checkout back to its owner so git can rewrite them.
fix_ownership() {
  local uid gid
  uid="$(stat -c %u "$repo")"; gid="$(stat -c %g "$repo")"
  docker run --rm -v "$repo:/r" alpine sh -c "
    for f in /r/selfhost/volumes/db/jwt.sql /r/selfhost/volumes/db/roles.sql; do
      [ -d \"\$f\" ] && rm -rf \"\$f\"
    done
    find /r -path /r/node_modules -prune -o -path /r/.git -prune -o -path /r/selfhost/backups -prune \
      -o -user root -exec chown $uid:$gid {} +" || true
}

rollback() {
  local rc=$?
  trap - EXIT
  if (( rc == 0 )); then return; fi
  say "FAILED during '$stage' (exit $rc); rolling back to the old stack"
  set +e
  cd "$repo"
  # New-stack containers go; their volume (pgdata) is kept for inspection.
  for svc in api postgres; do
    c="$(container_of "$svc")"; [[ -z "$c" ]] || docker rm -f "$c" >/dev/null
  done
  if (( switched )); then
    [[ -f "$selfhost/.env.old-stack.bak" ]] && mv -f "$selfhost/.env.old-stack.bak" "$selfhost/.env"
    if [[ -d "$selfhost/site.old-stack.bak" ]]; then
      rsync -a --delete "$selfhost/site.old-stack.bak/" "$selfhost/site/" && rm -rf "$selfhost/site.old-stack.bak"
    fi
    fix_ownership
    git reset -q --hard "$old_commit" || say "git reset failed; fix the checkout by hand"
    # Recreate everything so no old container keeps a stale bind mount.
    docker compose -p "$project" -f "$selfhost/docker-compose.yml" up -d --remove-orphans --force-recreate
  else
    # Live checkout untouched: just bring back what we stopped.
    for c in "${stopped[@]}"; do docker start "$c" >/dev/null; done
  fi
  git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1
  say "rolled back to $old_commit. Check: curl -s http://127.0.0.1:54321/functions/v1/health"
  rm -rf "$work"
}
trap rollback EXIT

enter_stage "backup"
mkdir -p "$selfhost/backups"
docker exec "$old_db" pg_dump -U supabase_admin -d postgres -Fc > "$selfhost/backups/pre-cutover-$ts.dump"
chmod 600 "$selfhost/backups/pre-cutover-$ts.dump"
say "full backup: selfhost/backups/pre-cutover-$ts.dump ($(du -h "$selfhost/backups/pre-cutover-$ts.dump" | cut -f1))"

enter_stage "build"
ln -s "$repo/node_modules" "$tree/node_modules"
( cd "$tree" && VITE_API_URL="$(env_value API_URL "$tree/selfhost/.env")" \
    npm run build -- --outDir "$work/site" --emptyOutDir )

# A leftover new-database volume can only come from an earlier failed attempt.
enter_stage "fresh database"
docker volume rm "${project}_pgdata" >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait postgres
migrate_new

# From here the API is down: stop everything that writes to the old database.
enter_stage "stop old API"
for svc in functions auth rest; do
  c="$(container_of "$svc")"
  if [[ -n "$c" ]]; then docker stop "$c" >/dev/null; stopped+=("$c"); fi
done
say "old API stopped"

enter_stage "export"
export_old "$work/export"
enter_stage "import"
import_new "$work/export"

enter_stage "switch checkout"
cp -p "$selfhost/.env" "$selfhost/.env.old-stack.bak"
switched=1
git merge -q --ff-only "$new_commit"
cp -p "$tree/selfhost/.env" "$selfhost/.env"
chmod 600 "$selfhost/.env"
compose=(docker compose -p "$project" -f "$selfhost/docker-compose.yml")

enter_stage "start new stack"
"${compose[@]}" up -d --remove-orphans --wait postgres api
"${compose[@]}" up -d --force-recreate --wait gateway
api_local="http://127.0.0.1:$(env_value GATEWAY_API_PORT "$selfhost/.env" || true)"
[[ "$api_local" != *: ]] || api_local="http://127.0.0.1:54321"
curl -fsS "$api_local/v1/health" >/dev/null

enter_stage "site"
mkdir -p "$selfhost/site"
rsync -a --delete "$selfhost/site/" "$selfhost/site.old-stack.bak/"
rsync -a --delete "$work/site/" "$selfhost/site/"

enter_stage "smoke test"
today="$(TZ=Asia/Tokyo date +%F)"
curl -fsS "$api_local/v1/get-session?puzzle_date_key=$today&guest_id=cutover-smoke-$ts" | jq -e '.completion_state == "playing"' >/dev/null
"${compose[@]}" exec -T postgres psql -U postgres -d wurmple -qc "delete from daily_sessions where guest_id = 'cutover-smoke-$ts'"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$api_local/functions/v1/health")" == 404 ]]
say "smoke test ok"

touch "$marker"
trap - EXIT
git worktree remove --force "$tree" >/dev/null 2>&1 || true
rm -rf "$work"
cat <<EOF

[$(date -Is)] CUTOVER DONE. The old database volume, .env.old-stack.bak and
site.old-stack.bak are kept for rollback. Next:
  1. Check the site, sign in with an existing account.
  2. Rollback, if ever needed (data written after the cutover would be lost):
       cd $repo && git reset --hard $old_commit && mv selfhost/.env.old-stack.bak selfhost/.env &&
       rsync -a --delete selfhost/site.old-stack.bak/ selfhost/site/ &&
       docker compose -f selfhost/docker-compose.yml up -d --remove-orphans --force-recreate &&
       rm selfhost/.cutover-done
  3. Once happy: bash $0 --finalize
EOF
