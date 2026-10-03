#!/usr/bin/env bash
# Nightly backup of the whole database (custom format; restore with
# pg_restore, see RUNBOOK). Keeps 14 days.
set -euo pipefail

selfhost="$(cd "$(dirname "$0")/.." && pwd)"
backups="$selfhost/backups"
umask 077
mkdir -p "$backups"

cd "$selfhost"
docker compose exec -T postgres pg_dump -U postgres -d wurmple -Fc \
  > "$backups/wurmple_$(date +%Y%m%d_%H%M%S).dump"

find "$backups" -name 'wurmple_*.dump' -mtime +14 -delete
find "$backups" -name 'wurmple_*.sql.gz' -mtime +14 -delete
