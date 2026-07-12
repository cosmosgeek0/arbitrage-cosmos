#!/usr/bin/env bash
# ops/tests/run-all.sh — run the full ops artifact test suite.
# Local only: loopback HTTP, mock systemctl, sandboxed filesystem.
# Usage: bash ops/tests/run-all.sh
set -u
cd "$(dirname "$0")"

PASS=0
FAIL=0
FAILED=""
for t in test-*.sh; do
  echo "=== $t"
  if bash "$t"; then
    PASS=$((PASS + 1))
    echo "--- PASS $t"
  else
    FAIL=$((FAIL + 1))
    FAILED="$FAILED $t"
    echo "--- FAIL $t"
  fi
done

echo
echo "ops/tests summary: $PASS passed, $FAIL failed${FAILED:+ (${FAILED# })}"
[ "$FAIL" -eq 0 ]
