#!/usr/bin/env bash
# Nightly logical backup of the auth + public schemas. Keeps 14 days.
set -euo pipefail

selfhost="$(cd "$(dirname "$0")/.." && pwd)"
backups="$selfhost/backups"
umask 077
mkdir -p "$backups"

cd "$selfhost"
docker compose exec -T db pg_dump -U supabase_admin -d postgres \
  --schema=auth --schema=public --no-owner \
  | gzip > "$backups/wurmple_$(date +%Y%m%d_%H%M%S).sql.gz"

find "$backups" -name 'wurmple_*.sql.gz' -mtime +14 -delete
