#!/usr/bin/env bash
# Copies auth users/identities and all app data from hosted Supabase into the
# self-hosted database. Read-only against hosted (Management API SQL endpoint).
# Re-runnable: local copies of these tables are replaced on every run.
#
# Usage (token on stdin so it never appears in process args):
#   printf %s "$SUPABASE_ACCESS_TOKEN" | selfhost/scripts/import-from-hosted.sh [project-ref]
set -euo pipefail

ref="${1:-fhzyxavhfjhwqvaibyeg}"
token="$(cat)"
selfhost="$(cd "$(dirname "$0")/.." && pwd)"
dump_dir="$selfhost/dumps/$(date +%Y%m%d_%H%M%S)"
umask 077
mkdir -p "$dump_dir"

# Order only matters for readability; FK/trigger checks are disabled on import.
tables=(
  auth.users
  auth.identities
  public.ball_catalog
  public.daily_puzzles
  public.profiles
  public.user_stats
  public.daily_sessions
  public.daily_results
  public.ball_unlocks
)

for t in "${tables[@]}"; do
  body=$(python3 -c 'import json,sys; print(json.dumps({"query": f"select coalesce(json_agg(t), \x27[]\x27::json) as rows from {sys.argv[1]} t"}))' "$t")
  curl -fsS -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$body" \
    | python3 -c 'import json,sys; rows=json.load(sys.stdin)[0]["rows"]; json.dump(rows, open(sys.argv[1],"w")); print(f"{sys.argv[2]}: {len(rows)} rows")' "$dump_dir/$t.json" "$t"
done

sql="$dump_dir/import.sql"
{
  echo '\set ON_ERROR_STOP on'
  echo 'begin;'
  echo "set session_replication_role = replica;"
  echo 'truncate auth.users, public.daily_puzzles, public.ball_catalog cascade;'
  echo 'create temp table _import(ord int, tbl text, data jsonb);'
  i=0
  for t in "${tables[@]}"; do
    i=$((i + 1))
    echo "\\set content \`cat /dumps/$t.json\`"
    echo "insert into _import values ($i, '$t', :'content'::jsonb);"
  done
  cat <<'SQL'
do $$
declare r record; cols text; n int;
begin
  for r in select tbl, data from _import order by ord loop
    select string_agg(quote_ident(a.attname), ',' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = r.tbl::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and exists (select 1 from jsonb_array_elements(r.data) e where e ? a.attname);
    if cols is null then continue; end if;
    execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)',
                   r.tbl, cols, cols, r.tbl) using r.data;
    get diagnostics n = row_count;
    raise notice '% imported: %', r.tbl, n;
  end loop;
end $$;
commit;
SQL
} > "$sql"

cd "$selfhost"
docker compose cp "$dump_dir/." db:/dumps >/dev/null
docker compose exec -T db psql -q -U supabase_admin -d postgres -f /dumps/import.sql
docker compose exec -T db rm -rf /dumps
echo "Import complete. Raw JSON kept in $dump_dir (contains password hashes; mode 700)."
