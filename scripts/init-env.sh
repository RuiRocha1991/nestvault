#!/usr/bin/env bash
# Creates .env.local from .env.example, replacing every __PLACEHOLDER__ with a random value.
# Refuses to overwrite an existing .env.local. Never prints the generated values.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -e .env.local ]; then
  echo ".env.local already exists; not touching it. Delete it first to regenerate." >&2
  exit 1
fi

umask 077
cp .env.example .env.local

# Passwords end up inside URLs, so use hex (URL-safe). Secrets use 32 random bytes in base64.
for name in $(grep -o '__[A-Z_]*__' .env.example | sort -u); do
  case "$name" in
    __POSTGRES_PORT__) value=5433 ;;
    __BETTER_AUTH_SECRET__ | __APP_ENCRYPTION_KEY__) value="$(openssl rand -base64 32)" ;;
    *) value="$(openssl rand -hex 24)" ;;
  esac
  # '|' is not in base64/hex output, so it is a safe sed delimiter.
  sed -i "s|$name|$value|g" .env.local
done

echo "Created .env.local (permissions 600). Next: pnpm db:up"
