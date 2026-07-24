#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

TOOL="$I00_ROOT/bin/create-private-temp.mjs"
CREATE_SIMULATION_ROOT="$I00_ROOT/bin/create-simulation-root.mjs"
VALIDATE_SIMULATION_ROOT="$I00_ROOT/bin/validate-simulation-root.mjs"

note "production private temporary roots ignore inherited TMPDIR"
ATTACKER_TMP="$TEST_TMP/attacker-controlled"
mkdir -p "$ATTACKER_TMP"
chmod 700 "$ATTACKER_TMP"
CREATED="$(TMPDIR="$ATTACKER_TMP" node "$TOOL" --prefix i00-df32-proof.)"
ASSERTIONS=$((ASSERTIONS + 1))
case "$CREATED" in
  "$ATTACKER_TMP"/*) fail_test "private temporary root honored inherited TMPDIR" ;;
esac
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$CREATED")" "$CREATED"
assert_eq "$(stat -c '%a' "$CREATED" 2>/dev/null || stat -f '%Lp' "$CREATED")" 700

note "marked roots use fixed physical /tmp despite hostile TMPDIR"
SIMULATION_BASE="$(TMPDIR="$ATTACKER_TMP" node "$CREATE_SIMULATION_ROOT" \
  --root "$TEST_TMP/ip-ops-i00-sim-private-temp-$$")"
assert_eq "$(TMPDIR="$ATTACKER_TMP" node "$VALIDATE_SIMULATION_ROOT" \
  --root "$SIMULATION_BASE")" "$SIMULATION_BASE"
case "$SIMULATION_BASE" in
  "$ATTACKER_TMP"/*) fail_test "marked simulation root honored inherited TMPDIR" ;;
  *) pass_assertion ;;
esac

note "simulation private temporary roots stay beneath one canonical marked base"
SIMULATION_CREATED="$(node "$TOOL" --base "$SIMULATION_BASE" --prefix i00-df32-simulation.)"
case "$SIMULATION_CREATED" in
  "$SIMULATION_BASE"/*) ASSERTIONS=$((ASSERTIONS + 1)) ;;
  *) fail_test "simulation private temporary root escaped its explicit base" ;;
esac
assert_eq "$(stat -c '%a' "$SIMULATION_CREATED" 2>/dev/null || stat -f '%Lp' "$SIMULATION_CREATED")" 700
chmod 755 "$SIMULATION_BASE"
assert_failure node "$TOOL" --base "$SIMULATION_BASE" --prefix i00-df32-refused.
chmod 700 "$SIMULATION_BASE"
ln -s "$SIMULATION_BASE" "$TEST_TMP/simulation-base-alias"
assert_failure node "$TOOL" --base "$TEST_TMP/simulation-base-alias" --prefix i00-df32-refused.
UNMARKED_BASE="$TEST_TMP/unmarked-base"
mkdir -m 700 "$UNMARKED_BASE"
assert_failure_contains 'available only for one canonical marked TEST root' \
  node "$TOOL" --base "$UNMARKED_BASE" --prefix i00-df32-refused.
assert_eq "$(find "$UNMARKED_BASE" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 0

note "private temporary prefixes are closed"
assert_failure node "$TOOL" --prefix ../escape.
assert_failure node "$TOOL" --prefix UPPER.
assert_failure node "$TOOL" --prefix missing-dot
assert_failure node "$TOOL" --prefix i00-ok. --extra value

note "all production effect wrappers use the trusted creator"
for wrapper in backup-verify.sh restore-drill-verify.sh release-switch.sh rollback-switch.sh; do
  WRAPPER_SOURCE="$(cat "$I00_ROOT/bin/$wrapper")"
  assert_contains "$WRAPPER_SOURCE" 'create-private-temp.mjs'
  while IFS= read -r base_line; do
    assert_contains "$base_line" 'SIMULATION_ROOT'
  done < <(printf '%s\n' "$WRAPPER_SOURCE" | grep -F -- '--base' || true)
done
assert_contains "$(cat "$TOOL")" 'protected production root union'
assert_contains "$(cat "$I00_ROOT/simulation-safety.mjs")" "const FIXED_TEMP_ROOT = '/tmp'"

rm -rf "$CREATED" "$SIMULATION_CREATED"
finish
