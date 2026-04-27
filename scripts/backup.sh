#!/usr/bin/env bash
# Backup Supabase Postgres database to backups/backup_TIMESTAMP.sql
#
# Requires DB_URL env var. Get it from:
#   Supabase Dashboard > Settings > Database > Connection string > URI
#   (use the "Session mode" / port 5432 URI)
#
# Usage:
#   DB_URL="postgres://postgres:password@db.xxx.supabase.co:5432/postgres" ./scripts/backup.sh

set -euo pipefail

if [ -z "${DB_URL:-}" ]; then
  echo "Error: DB_URL environment variable is not set." >&2
  echo "Get it from Supabase Dashboard > Settings > Database > Connection string (URI mode)." >&2
  exit 1
fi

mkdir -p backups

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTFILE="backups/backup_${TIMESTAMP}.sql"

echo "Dumping database to ${OUTFILE}..."
pg_dump "$DB_URL" > "$OUTFILE"

echo "Done. Backup saved to ${OUTFILE}"
