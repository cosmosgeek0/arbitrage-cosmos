#!/usr/bin/env bash
# ops/tests/test-rollback.sh — rollback policy: schema barrier is absolute,
# exposure gates automation, forced rollback is an explicit recorded act.
. "$(dirname "$0")/helpers.sh"
. "$BIN/common.sh"

export COSMOS_ROOT="$SANDBOX/opt"
export RELEASES_DIR="$COSMOS_ROOT/releases"
export CURRENT_LINK="$COSMOS_ROOT/current"
export PREVIOUS_LINK="$COSMOS_ROOT/previous"
export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export APP_UNIT=df32-fixture-app.service
APP_PORT="$(pick_port)"
PROBE_PORT="$(pick_port)"
export PROBE_PORT
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
export READINESS_GATE_PATHS="/health/live"
export POST_SWITCH_GATE_PATHS="/health/live"
export GATE_TIMEOUT_SEC=4
export LOCK_TIMEOUT_SEC=2
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
touch "$MOCK_SYSTEMCTL_LOG"
export ALERT_CMD="$FIXTURES/mock-alert.sh"
export MOCK_ALERT_LOG="$SANDBOX/alerts.log"
touch "$MOCK_ALERT_LOG"
export EXPOSURE_CMD="cat $SANDBOX/exposure"
echo NONE > "$SANDBOX/exposure"
export MONEY_READY_MARKER="$OPS_STATE_DIR/money-ready"
export PROBE_CMD='BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node '"$FIXTURES"'/fake-app.mjs'

DEPLOY="$BIN/deploy.sh"
ROLLBACK="$BIN/rollback.sh"
MAKE_RELEASE="$FIXTURES/make-release.sh"
SRC="$SANDBOX/src"
JOURNAL="$DATA_DIR/journal-compat.json"

start_fake_app "$APP_PORT" "$CURRENT_LINK/runtime-behavior.env" >/dev/null

note "setup: A(schema1) -> C(schema1) -> H(schema2, barrier) -> I(schema2)"
bash "$MAKE_RELEASE" "$SRC/A" rel-A 1 false
bash "$MAKE_RELEASE" "$SRC/C" rel-C 1 false
bash "$MAKE_RELEASE" "$SRC/H" rel-H 2 true
bash "$MAKE_RELEASE" "$SRC/I" rel-I 2 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/A"
assert_rc 0 bash "$DEPLOY" --release "$SRC/C"
assert_rc 0 bash "$DEPLOY" --release "$SRC/H"
assert_rc 0 bash "$DEPLOY" --release "$SRC/I"

note "1. rollback behind the barrier is refused absolutely (rc5)"
assert_rc 5 bash "$ROLLBACK" --to rel-A
assert_rc 5 bash "$ROLLBACK" --to rel-C
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" "current unchanged"

note "1a. rollback-floor operands refuse before any rollback mutation"
FLOOR_INJECTION_MARKER="$SANDBOX/rollback-floor-injection-ran"
FLOOR_SCHEMA_INJECTION_MARKER="$SANDBOX/rollback-schema-injection-ran"
FLOOR_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
printf '%s\n' AMBIGUOUS > "$SANDBOX/exposure"

write_floor_journal() { # missing|value|raw-value|raw-root [value]
  case "$1" in
    missing) json_write "$JOURNAL" dataSchema=2 ;;
    value) json_write "$JOURNAL" dataSchema=2 "rollbackFloor=$2" ;;
    raw-value) printf '{"dataSchema":2,"rollbackFloor":%s}\n' "$2" > "$JOURNAL" ;;
    raw-root) printf '%s\n' "$2" > "$JOURNAL" ;;
    *) fail "unknown rollback-floor journal fixture kind: $1" ;;
  esac
}

assert_rollback_floor_case() { # kind value rc required-fragment forbidden-fragment
  local kind="$1" value="$2" expected_rc="$3"
  local required="$4" forbidden="$5" output rc
  write_floor_journal "$kind" "$value"
  set +e
  output="$(bash "$ROLLBACK" --to rel-H 2>&1)"
  rc=$?
  set -e
  assert_eq "$rc" "$expected_rc" "rollback-floor rollback refusal code"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "rollback output omitted rollback-floor proof [$required]: $output" ;;
  esac
  if [ -n "$forbidden" ]; then
    ASSERTIONS=$((ASSERTIONS + 1))
    case "$output" in
      *"$forbidden"*) fail "rollback reached forbidden later gate [$forbidden]: $output" ;;
      *) ;;
    esac
  fi
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
    "rollback-floor refusal leaves current unchanged"
  assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
}

assert_rollback_floor_case value 7 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "rollback refused: exposure=AMBIGUOUS"
assert_rollback_floor_case missing "" 6 \
  "rollback refused: exposure=AMBIGUOUS" \
  "journal rollbackFloor is not a nonnegative integer"
assert_rollback_floor_case value 0 6 \
  "rollback refused: exposure=AMBIGUOUS" \
  "journal rollbackFloor is not a nonnegative integer"
for invalid_floor in "" null '"7"' "not-a-number" \
  "0; : > $FLOOR_INJECTION_MARKER" -1 3.5 9223372036854775808; do
  assert_rollback_floor_case value "$invalid_floor" 1 \
    "journal rollbackFloor is not a nonnegative integer" \
    "rollback refused: exposure=AMBIGUOUS"
done
for precision_edge_floor in 1.0000000000000001 9007199254740990.5 \
  9007199254740991.1 1e-4000 -0 9007199254740992; do
  assert_rollback_floor_case raw-value "$precision_edge_floor" 1 \
    "journal rollbackFloor is not a nonnegative integer" \
    "rollback refused: exposure=AMBIGUOUS"
done
assert_rollback_floor_case raw-value 9007199254740991 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "journal rollbackFloor is not a nonnegative integer"
for invalid_root in null '[]' 0 '"journal"'; do
  assert_rollback_floor_case raw-root "$invalid_root" 1 \
    "journal rollbackFloor is not a nonnegative integer" \
    "rollback refused: exposure=AMBIGUOUS"
done
assert_no_file "$FLOOR_INJECTION_MARKER"

FLOOR_BAD_TARGET="$RELEASES_DIR/rel-rollback-bad-schema"
bash "$MAKE_RELEASE" "$FLOOR_BAD_TARGET" rel-rollback-bad-schema \
  "\"0; : > $FLOOR_SCHEMA_INJECTION_MARKER\"" false
write_floor_journal value 0
set +e
FLOOR_BAD_SCHEMA_OUTPUT="$(
  bash "$ROLLBACK" --to rel-rollback-bad-schema 2>&1
)"
FLOOR_BAD_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_BAD_SCHEMA_RC" 1 "malformed rollback schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_BAD_SCHEMA_OUTPUT" in
  *"target release schemaVersion is not a nonnegative integer"*) ;;
  *) fail "malformed rollback schema omitted exact refusal: $FLOOR_BAD_SCHEMA_OUTPUT" ;;
esac
assert_no_file "$FLOOR_SCHEMA_INJECTION_MARKER"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "malformed rollback schema leaves current unchanged"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "rollback-floor cases do not invoke systemctl"

FLOOR_HUGE_TARGET="$RELEASES_DIR/rel-rollback-huge-schema"
bash "$MAKE_RELEASE" "$FLOOR_HUGE_TARGET" rel-rollback-huge-schema \
  9223372036854775808 false
set +e
FLOOR_HUGE_SCHEMA_OUTPUT="$(
  bash "$ROLLBACK" --to rel-rollback-huge-schema 2>&1
)"
FLOOR_HUGE_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_HUGE_SCHEMA_RC" 1 "oversized rollback schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_HUGE_SCHEMA_OUTPUT" in
  *"target release schemaVersion is not a nonnegative integer"*) ;;
  *) fail "oversized rollback schema omitted exact refusal: $FLOOR_HUGE_SCHEMA_OUTPUT" ;;
esac
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "oversized rollback schema leaves current unchanged"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "oversized rollback schema does not invoke systemctl"

FLOOR_STRING_TARGET="$RELEASES_DIR/rel-rollback-string-schema"
bash "$MAKE_RELEASE" "$FLOOR_STRING_TARGET" rel-rollback-string-schema \
  '"2"' false
set +e
FLOOR_STRING_SCHEMA_OUTPUT="$(
  bash "$ROLLBACK" --to rel-rollback-string-schema 2>&1
)"
FLOOR_STRING_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_STRING_SCHEMA_RC" 1 "numeric-string rollback schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_STRING_SCHEMA_OUTPUT" in
  *"target release schemaVersion is not a nonnegative integer"*) ;;
  *) fail "numeric-string rollback schema omitted exact refusal: $FLOOR_STRING_SCHEMA_OUTPUT" ;;
esac
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "numeric-string rollback schema leaves current unchanged"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "numeric-string rollback schema does not invoke systemctl"

FLOOR_PRECISION_SCHEMA_INDEX=0
for precision_edge_schema in 1.0000000000000001 9007199254740990.5 1e-4000; do
  FLOOR_PRECISION_SCHEMA_INDEX=$((FLOOR_PRECISION_SCHEMA_INDEX + 1))
  FLOOR_PRECISION_TARGET="$RELEASES_DIR/rel-rollback-precision-schema-$FLOOR_PRECISION_SCHEMA_INDEX"
  bash "$MAKE_RELEASE" "$FLOOR_PRECISION_TARGET" \
    "rel-rollback-precision-schema-$FLOOR_PRECISION_SCHEMA_INDEX" \
    "$precision_edge_schema" false
  set +e
  FLOOR_PRECISION_SCHEMA_OUTPUT="$(
    bash "$ROLLBACK" \
      --to "rel-rollback-precision-schema-$FLOOR_PRECISION_SCHEMA_INDEX" 2>&1
  )"
  FLOOR_PRECISION_SCHEMA_RC=$?
  set -e
  assert_eq "$FLOOR_PRECISION_SCHEMA_RC" 1 \
    "precision-edge rollback schema refuses"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$FLOOR_PRECISION_SCHEMA_OUTPUT" in
    *"target release schemaVersion is not a nonnegative integer"*) ;;
    *) fail "precision-edge rollback schema omitted exact refusal: $FLOOR_PRECISION_SCHEMA_OUTPUT" ;;
  esac
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
    "precision-edge rollback schema leaves current unchanged"
  assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
  assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
    "$FLOOR_SYSTEMCTL_BYTES" "precision-edge rollback schema does not invoke systemctl"
done
write_floor_journal value 2
printf '%s\n' NONE > "$SANDBOX/exposure"

note "2. rollback to a schema-compatible release succeeds"
assert_rc 0 bash "$ROLLBACK"        # previous -> rel-H (schema 2, at floor)
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" "rolled back to H"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-I" "previous now I"
assert_grep '"result":"ROLLBACK_OK"' "$OPS_STATE_DIR/deploy-log.jsonl" "rollback logged"

note "3. manual rollback with exposure refused without --force-with-exposure"
echo AMBIGUOUS > "$SANDBOX/exposure"
assert_rc 6 bash "$ROLLBACK" --to rel-I
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" "refusal left state alone"

note "4. forced manual rollback with exposure is allowed and alerted"
assert_rc 0 bash "$ROLLBACK" --to rel-I --force-with-exposure
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" "forced rollback applied"
assert_grep 'critical ROLLBACK_FORCED' "$MOCK_ALERT_LOG" "forced rollback alerted"

note "5. --auto refuses exposure != NONE and money readiness"
assert_rc 6 bash "$ROLLBACK" --auto
echo NONE > "$SANDBOX/exposure"
mkdir -p "$OPS_STATE_DIR" && touch "$MONEY_READY_MARKER"
assert_rc 6 bash "$ROLLBACK" --auto
rm -f "$MONEY_READY_MARKER"
assert_rc 0 bash "$ROLLBACK" --auto
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" "auto rollback applied"

note "6. unknown/absent targets refused"
assert_rc 1 bash "$ROLLBACK" --to rel-nope
rm -f "$PREVIOUS_LINK"
assert_rc 1 bash "$ROLLBACK"

note "7. unhealthy rollback target: switched but gate fails -> CRITICAL rc3 + freeze"
bash "$MAKE_RELEASE" "$SRC/S" rel-S 2 false 0 1   # runtime live fails
# install it as a valid release first (probe passes; post-gate fails -> auto-rollback
# would loop, so install with exposure ACTIVE to freeze, then clear state)
echo ACTIVE > "$SANDBOX/exposure"
assert_rc 2 bash "$DEPLOY" --release "$SRC/S"
rm -f "$OPS_STATE_DIR/deploy-frozen.json"
echo NONE > "$SANDBOX/exposure"
assert_rc 0 bash "$ROLLBACK" --to rel-H
assert_rc 3 bash "$ROLLBACK" --to rel-S
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
assert_grep 'critical ROLLBACK_GATE_FAILED' "$MOCK_ALERT_LOG" "critical alert raised"

finish
