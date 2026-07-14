#!/usr/bin/env bash
# ops/tests/fixtures/make-release.sh — build a release-source fixture.
#
# usage: make-release.sh DIR ID SCHEMA BARRIER [LIVE READY PROBE_LIVE PROBE_READY]
#   DIR      target directory (created)
#   ID       releaseId
#   SCHEMA   schemaVersion (integer)
#   BARRIER  true|false (rollbackBarrier)
#   LIVE/READY            runtime-behavior.env flags (default 1/1)
#   PROBE_LIVE/PROBE_READY probe-behavior.env flags (default 1/1)
set -euo pipefail
dir="$1"; id="$2"; schema="$3"; barrier="$4"
live="${5:-1}"; ready="${6:-1}"; plive="${7:-1}"; pready="${8:-1}"

mkdir -p "$dir/server/dist"
echo "// dummy release payload for ops tests: $id" > "$dir/server/dist/index.js"
cat > "$dir/release.json" <<EOF
{
  "releaseId": "$id",
  "gitSha": "0000000",
  "builtAtUtc": "2026-07-12T00:00:00Z",
  "schemaVersion": $schema,
  "rollbackBarrier": $barrier
}
EOF
printf 'RELEASE_ID=%s\nLIVE_OK=%s\nREADY_OK=%s\n' "$id" "$live" "$ready" > "$dir/runtime-behavior.env"
printf 'RELEASE_ID=%s\nLIVE_OK=%s\nREADY_OK=%s\n' "$id" "$plive" "$pready" > "$dir/probe-behavior.env"
