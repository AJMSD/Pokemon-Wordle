#!/usr/bin/env bash
# Usage: selfhost/scripts/set-secret.sh KEY
# Prompts for a value without echoing it and writes KEY=value into selfhost/.env.
set -euo pipefail

key="${1:?usage: set-secret.sh KEY}"
env_file="$(cd "$(dirname "$0")/.." && pwd)/.env"

read -rsp "$key: " value
echo

umask 077
touch "$env_file"
tmp="$(mktemp)"
grep -v "^${key}=" "$env_file" > "$tmp" || true
printf '%s=%s\n' "$key" "$value" >> "$tmp"
mv "$tmp" "$env_file"
chmod 600 "$env_file"
echo "Saved $key to $env_file"
