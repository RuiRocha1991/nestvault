#!/usr/bin/env bash
# Drops the Postgres volume (all data) after confirmation and starts the stack again.
set -euo pipefail
cd "$(dirname "$0")/.."

read -r -p "This deletes ALL local database data. Type 'reset' to continue: " answer
[ "$answer" = "reset" ] || { echo "Aborted."; exit 1; }

docker compose down --volumes
docker compose --env-file .env.local up -d --wait
echo "Database recreated."
