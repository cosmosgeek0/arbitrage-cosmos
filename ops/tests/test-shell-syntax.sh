#!/usr/bin/env bash
# ops/tests/test-shell-syntax.sh — every shell script parses under bash -n
# (bash 3.2 on macOS, so bash-4-only syntax fails here by design) and every
# node script parses under node --check. Also: executables are executable.
. "$(dirname "$0")/helpers.sh"

note "bash -n on every shell script"
for f in "$BIN"/*.sh "$TESTS_DIR"/*.sh "$FIXTURES"/*.sh; do
  ASSERTIONS=$((ASSERTIONS + 1))
  bash -n "$f" || fail "bash syntax error: $f"
done

note "node --check on every mjs"
for f in "$BIN"/*.mjs "$FIXTURES"/*.mjs; do
  ASSERTIONS=$((ASSERTIONS + 1))
  node --check "$f" || fail "node syntax error: $f"
done

note "operational scripts are executable"
for f in "$BIN"/*.sh "$BIN"/*.mjs "$FIXTURES"/*.sh; do
  ASSERTIONS=$((ASSERTIONS + 1))
  [ -x "$f" ] || fail "not executable: $f"
done

finish
