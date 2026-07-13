#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

PASS=0
FAIL=0
ASSERTIONS=0
FAILED=""
for test_file in test-*.sh; do
  printf '=== %s\n' "$test_file"
  LOG="$(mktemp "${TMPDIR:-/tmp}/i00-test-log.XXXXXX")"
  if bash "$test_file" >"$LOG" 2>&1; then
    cat "$LOG"
    COUNT="$(sed -n 's/^OK (\([0-9][0-9]*\) assertions)$/\1/p' "$LOG" | tail -1)"
    if [ -z "$COUNT" ] || [ "$COUNT" -le 0 ]; then
      FAIL=$((FAIL + 1))
      FAILED="$FAILED $test_file(no-assertion-footer)"
      printf '%s\n' "--- FAIL $test_file (missing positive assertion footer)"
      rm -f "$LOG"
      continue
    fi
    ASSERTIONS=$((ASSERTIONS + COUNT))
    PASS=$((PASS + 1))
    printf '%s\n' "--- PASS $test_file"
  else
    cat "$LOG"
    FAIL=$((FAIL + 1))
    FAILED="$FAILED $test_file"
    printf '%s\n' "--- FAIL $test_file"
  fi
  rm -f "$LOG"
done

printf '\nIP-OPS I00 summary: %s passed, %s failed, %s additive assertions%s\n' \
  "$PASS" "$FAIL" "$ASSERTIONS" "${FAILED:+ (${FAILED# })}"
[ "$FAIL" -eq 0 ]
