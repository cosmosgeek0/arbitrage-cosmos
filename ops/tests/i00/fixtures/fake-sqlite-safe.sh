#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '3.53.3 2026-06-26 fixture\n'
  exit 0
fi
exec sqlite3 "$@"
