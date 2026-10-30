#!/usr/bin/env bash
# Rebuild the code layer of the knowledge graph (graphify-out/graph.json).
# AST only: no LLM, no tokens. Docs/ADR concepts are refreshed from Claude Code with
# `/graphify . --update`.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify is not installed. See README.md → Knowledge graph." >&2
  exit 1
fi

graphify update . "$@"
