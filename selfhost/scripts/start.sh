#!/usr/bin/env bash
# Brings the compose stack up at boot (crontab: @reboot). Containers already use
# `restart: unless-stopped`, but that skips any that were stopped or removed
# before the reboot; this makes sure the whole stack is running.
set -euo pipefail

selfhost="$(cd "$(dirname "$0")/.." && pwd)"
cd "$selfhost"

# Docker may still be starting right after boot.
for _ in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 5
done

echo "[$(date -Is)] boot: docker compose up -d"
docker compose up -d --remove-orphans
