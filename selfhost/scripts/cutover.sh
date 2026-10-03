#!/usr/bin/env bash
# One-time move from the old stack (supabase/postgres + GoTrue + PostgREST +
# edge runtime) to plain Postgres + the Deno API server.
#
#   cutover.sh --dry-run    Rehearsal. Exports the live data into a throwaway
#                           copy of the new stack (compose project
#                           "wurmple-dryrun", separate git worktree), migrates,
#                           imports and checks row counts, then deletes it.
#                           The live checkout and containers are not touched.
#   cutover.sh              The real thing (~1 minute of API downtime). Rolls
#                           back to the old stack automatically on any failure.
#   cutover.sh --finalize   After the new stack is confirmed working: deletes
#                           the old database volume, backups of .env/site, and
#                           the old images.
#
# Env: REPO (default ~/Code/Pokemon-Wordle), CUTOVER_REF (default origin/no-supabase).
set -euo pipefail

mode="${1:-run}"
case "$mode" in --dry-run|run|--finalize) ;; *) echo "usage: $0 [--dry-run|--finalize]" >&2; exit 2 ;; esac

repo="${REPO:-$HOME/Code/Pokemon-Wordle}"
ref="${CUTOVER_REF:-origin/no-supabase}"
selfhost="$repo/selfhost"
marker="$selfhost/.cutover-done"
ts="$(date +%Y%m%d_%H%M%S)"
work="$(mktemp -d "/tmp/wurmple-cutover.XXXXXX")"
log="$selfhost/cutover.log"

exec > >(tee -a "$log") 2>&1
say() { echo "[$(date -Is)] $*"; }
die() { say "ERROR: $*"; exit 1; }

say "=== cutover $mode (ref $ref) ==="
cd "$repo"

# Containers of the live compose project, by service name.
container_of() {
  docker ps -aq --filter "label=com.docker.compose.project=wurmple" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

# ---------------------------------------------------------------- finalize --
if [[ "$mode" == "--finalize" ]]; then
  [[ -f "$marker" ]] || die "no $marker: run the cutover first"
  for svc in db auth rest functions; do
    [[ -z "$(container_of "$svc")" ]] || die "old '$svc' container still exists; is the old stack running?"
  done
  docker volume rm wurmple_db-data wurmple_db-config 2>/dev/null || true
  rm -rf "$selfhost/.env.supabase.bak" "$selfhost/site.supabase.bak"
  for image in supabase/postgres:17.6.1.136 supabase/gotrue:v2.196.0 supabase/edge-runtime:v1.76.2 postgrest/postgrest:v14.17; do
    docker image rm "$image" 2>/dev/null && say "removed image $image" || true
  done
  say "finalized. Remaining wurmple volumes:"
  docker volume ls --format '{{.Name}}' | grep '^wurmple' || true
  exit 0
fi

# --------------------------------------------------------------- preflight --
[[ ! -f "$marker" ]] || die "already cut over ($marker exists)"
[[ -f "$selfhost/.env" ]] || die "missing $selfhost/.env"
old_db="$(docker ps -q --filter "label=com.docker.compose.project=wurmple" --filter "label=com.docker.compose.service=db")"
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
git merge-base --is-ancestor "$old_commit" "$ref" || die "$ref does not contain the current checkout ($old_commit)"
say "old commit $old_commit, new commit $(git rev-parse "$ref")"

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
export_old() {
  local dir="$1" in=/tmp/cutover-export
  docker exec -u root "$old_db" sh -c "rm -rf $in && mkdir -m 777 $in"
  {
    echo "begin isolation level repeatable read read only;"
    local counts=() t
    for t in "${tables[@]}"; do
      echo "copy ($(export_query "$t")) to '$in/$t.csv' csv header;"
      counts+=("select '$t' as t, count(*) from ($(export_query "$t")) x")
    done
    local IFS=$'\n'
    echo "copy ($(printf '%s\nunion all\n' "${counts[@]}" | sed '$d')) to '$in/counts.csv' csv;"
    echo "commit;"
  } | old_psql -q
  mkdir -p "$dir"
  docker cp -q "$old_db:$in/." "$dir/"
  docker exec -u root "$old_db" rm -rf "$in"
  chmod 600 "$dir"/*.csv
  say "exported: $(tr '\n' ' ' < "$dir/counts.csv")"
}

# Imports the CSVs into the new database (one transaction) and checks counts.
import_new() {
  local dir="$1" in=/tmp/cutover-import pg t
  shift
  pg="$("${compose[@]}" ps -q postgres)"
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

  local bad=0 name want got
  while IFS=, read -r name want; do
    got="$(docker exec "$pg" psql -U postgres -d wurmple -tAc "select count(*) from $name")"
    if [[ "$got" == "$want" ]]; then say "  $name: $got rows ok"; else say "  $name: expected $want, got $got"; bad=1; fi
  done < "$dir/counts.csv"
  local odd
  odd="$(docker exec "$pg" psql -U postgres -d wurmple -tAc \
    "select count(*) from users where password_hash is not null and password_hash !~ '^\\\$2[aby]\\\$'")"
  [[ "$odd" == 0 ]] || { say "  $odd password hashes are not bcrypt"; bad=1; }
  (( bad == 0 )) || die "imported data does not match the export"
}

# New .env from the old one: values copied verbatim, old-only keys dropped.
convert_env() {
  local old="$1" new="$2" line key have_salt=0
  grep -qE '^TARGET_SALT=.+' "$old" && have_salt=1
  umask 077
  {
    echo "# Converted from the old stack's .env by cutover.sh on $(date -I)."
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      key="${line%%=*}"
      case "$key" in
        POSTGRES_PASSWORD|SITE_URL|SMTP_ADMIN_EMAIL|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_SENDER_NAME|GOOGLE_ENABLED|GOOGLE_CLIENT_ID|GOOGLE_SECRET|MAIL_MODE)
          echo "$line" ;;
        TARGET_SALT) [[ $have_salt == 1 ]] && echo "$line" ;;
        # Per-user targets were salted with JWT_SECRET when TARGET_SALT was unset.
        JWT_SECRET) [[ $have_salt == 0 ]] && echo "TARGET_SALT=${line#JWT_SECRET=}" ;;
        API_EXTERNAL_URL) echo "API_URL=${line#API_EXTERNAL_URL=}" ;;
      esac
    done < "$old"
  } > "$new"
  for key in POSTGRES_PASSWORD TARGET_SALT API_URL SITE_URL; do
    grep -qE "^$key=.+" "$new" || die "converted .env has no $key"
  done
}

migrate_new() {
  "${compose[@]}" run --rm -T api run --config=server/deno.json --frozen \
    --allow-net --allow-env --allow-sys --allow-read=/app server/migrate.ts
}

# ----------------------------------------------------------------- dry run --
if [[ "$mode" == "--dry-run" ]]; then
  tree="$work/tree"
  compose=(docker compose -p wurmple-dryrun -f "$tree/selfhost/docker-compose.yml")
  cleanup_dry() {
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup_dry EXIT

  git worktree add -q --detach "$tree" "$ref"
  convert_env "$selfhost/.env" "$tree/selfhost/.env"
  say "converted .env keys: $(cut -d= -f1 "$tree/selfhost/.env" | grep -v '^#' | tr '\n' ' ')"
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
compose=(docker compose -f "$selfhost/docker-compose.yml")
stage="start"

rollback() {
  local rc=$?
  trap - EXIT
  if (( rc == 0 )); then return; fi
  say "FAILED during '$stage' (exit $rc); rolling back to the old stack"
  set +e
  cd "$repo"
  "${compose[@]}" rm -sf api >/dev/null 2>&1
  if [[ -f "$selfhost/.env.supabase.bak" ]]; then mv -f "$selfhost/.env.supabase.bak" "$selfhost/.env"; fi
  if [[ -d "$selfhost/site.supabase.bak" ]]; then
    rsync -a --delete "$selfhost/site.supabase.bak/" "$selfhost/site/" && rm -rf "$selfhost/site.supabase.bak"
  fi
  git reset -q --hard "$old_commit"
  docker compose -f "$selfhost/docker-compose.yml" up -d --remove-orphans
  docker compose -f "$selfhost/docker-compose.yml" exec -T gateway nginx -s reload
  say "rolled back to $old_commit. The new database volume (wurmple_pgdata) was left for inspection; the next cutover attempt recreates it."
  rm -rf "$work"
}
trap rollback EXIT

stage="backup"
mkdir -p "$selfhost/backups"
docker exec "$old_db" pg_dump -U supabase_admin -d postgres -Fc > "$selfhost/backups/pre-cutover-$ts.dump"
chmod 600 "$selfhost/backups/pre-cutover-$ts.dump"
say "full backup: selfhost/backups/pre-cutover-$ts.dump ($(du -h "$selfhost/backups/pre-cutover-$ts.dump" | cut -f1))"

stage="checkout"
git merge -q --ff-only "$ref"
cp -p "$selfhost/.env" "$selfhost/.env.supabase.bak"
convert_env "$selfhost/.env.supabase.bak" "$selfhost/.env.new"
mv -f "$selfhost/.env.new" "$selfhost/.env"
chmod 600 "$selfhost/.env"
set -a; API_URL="$(grep -E '^API_URL=' "$selfhost/.env" | tail -1 | cut -d= -f2- | sed -E "s/^['\"]|['\"]$//g")"; set +a

stage="build"
VITE_API_URL="$API_URL" npm run build -- --outDir "$selfhost/.build" --emptyOutDir

# A leftover new-database volume can only come from an earlier failed attempt.
stage="fresh database"
"${compose[@]}" rm -sf postgres >/dev/null 2>&1 || true
docker volume rm wurmple_pgdata >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait postgres
migrate_new

# From here the API is down: stop everything that writes to the old database.
stage="stop old API"
for svc in functions auth rest; do
  c="$(container_of "$svc")"
  [[ -z "$c" ]] || docker stop "$c" >/dev/null
done
say "old API stopped"

stage="export"
export_old "$work/export"
stage="import"
import_new "$work/export"

stage="start new stack"
"${compose[@]}" up -d --remove-orphans --wait api
"${compose[@]}" up -d --force-recreate --wait gateway
api_port="$(grep -E '^GATEWAY_API_PORT=' "$selfhost/.env" | cut -d= -f2)"
api_local="http://127.0.0.1:${api_port:-54321}"
curl -fsS "$api_local/v1/health" >/dev/null

stage="site"
mkdir -p "$selfhost/site"
rsync -a --delete "$selfhost/site/" "$selfhost/site.supabase.bak/"
rsync -a --delete "$selfhost/.build/" "$selfhost/site/"

stage="smoke test"
today="$(TZ=Asia/Tokyo date +%F)"
curl -fsS "$api_local/v1/get-session?puzzle_date_key=$today&guest_id=cutover-smoke-$ts" | jq -e '.completion_state == "playing"' >/dev/null
"${compose[@]}" exec -T postgres psql -U postgres -d wurmple -qc "delete from daily_sessions where guest_id = 'cutover-smoke-$ts'"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$api_local/functions/v1/health")" == 404 ]]
say "smoke test ok"

touch "$marker"
trap - EXIT
rm -rf "$work"
cat <<EOF

[$(date -Is)] CUTOVER DONE. The old database volume, .env.supabase.bak and
site.supabase.bak are kept for rollback. Next:
  1. Check the site, sign in with an existing account.
  2. Rollback, if ever needed:
       cd $repo && git reset --hard $old_commit && mv selfhost/.env.supabase.bak selfhost/.env &&
       rsync -a --delete selfhost/site.supabase.bak/ selfhost/site/ &&
       docker compose -f selfhost/docker-compose.yml up -d --remove-orphans &&
       rm selfhost/.cutover-done
     (data written after the cutover would be lost)
  3. Once happy: bash $0 --finalize
EOF
