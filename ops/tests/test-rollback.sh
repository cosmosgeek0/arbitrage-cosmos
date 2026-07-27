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

note "1a. an exact prestart PENDING barrier permits only fix-forward deployment"
PENDING_CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
PENDING_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK")"
PENDING_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
json_write "$JOURNAL" \
  dataSchema=1 rollbackFloor=2 \
  updatedAtUtc=2026-07-27T00:00:00Z \
  updatedBy=deploy.sh.prestart-barrier
PENDING_SNAPSHOT="$(journal_state_snapshot "$JOURNAL")"
ASSERTIONS=$((ASSERTIONS + 1))
case "$PENDING_SNAPSHOT" in
  PENDING\|1\|2\|*) ;;
  *) fail "exact prestart barrier did not classify as PENDING: $PENDING_SNAPSHOT" ;;
esac
set +e
PENDING_ROLLBACK_OUTPUT="$(bash "$ROLLBACK" --to rel-H 2>&1)"
PENDING_ROLLBACK_RC=$?
set -e
assert_eq "$PENDING_ROLLBACK_RC" 5 \
  "rollback is absolutely refused while a prestart barrier is pending"
ASSERTIONS=$((ASSERTIONS + 1))
case "$PENDING_ROLLBACK_OUTPUT" in
  *"rollback is refused while a prestart barrier is pending"*) ;;
  *) fail "PENDING rollback refusal omitted fix-forward proof: $PENDING_ROLLBACK_OUTPUT" ;;
esac
assert_link_target "$CURRENT_LINK" "$PENDING_CURRENT_TARGET" \
  "PENDING rollback refusal leaves current unchanged"
assert_link_target "$PREVIOUS_LINK" "$PENDING_PREVIOUS_TARGET" \
  "PENDING rollback refusal leaves previous unchanged"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$PENDING_SYSTEMCTL_BYTES" "PENDING rollback refusal does not restart"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
json_write "$JOURNAL" \
  dataSchema=2 rollbackFloor=2 \
  updatedAtUtc=2026-07-27T00:00:01Z updatedBy=deploy.sh

note "1b. rollback-floor operands refuse before any rollback mutation"
FLOOR_INJECTION_MARKER="$SANDBOX/rollback-floor-injection-ran"
FLOOR_SCHEMA_INJECTION_MARKER="$SANDBOX/rollback-schema-injection-ran"
FLOOR_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
printf '%s\n' AMBIGUOUS > "$SANDBOX/exposure"

write_floor_journal() { # missing|missing-schema-floor|value|barrier-value|raw-value|raw-barrier|raw-data-schema|invalid-schema-barrier|relation|raw-root [value]
  case "$1" in
    missing) json_write "$JOURNAL" dataSchema=2 ;;
    missing-schema-floor) printf '{"rollbackFloor":%s}\n' "$2" > "$JOURNAL" ;;
    value) json_write "$JOURNAL" dataSchema=2 "rollbackFloor=$2" ;;
    barrier-value) json_write "$JOURNAL" "dataSchema=$2" "rollbackFloor=$2" ;;
    raw-value) printf '{"dataSchema":2,"rollbackFloor":%s}\n' "$2" > "$JOURNAL" ;;
    raw-barrier) printf '{"dataSchema":%s,"rollbackFloor":%s}\n' "$2" "$2" > "$JOURNAL" ;;
    raw-data-schema) printf '{"dataSchema":%s,"rollbackFloor":0}\n' "$2" > "$JOURNAL" ;;
    invalid-schema-barrier) printf '{"dataSchema":null,"rollbackFloor":7}\n' > "$JOURNAL" ;;
    relation) printf '{"dataSchema":3,"rollbackFloor":7}\n' > "$JOURNAL" ;;
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

assert_rollback_floor_case barrier-value 7 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "rollback refused: exposure=AMBIGUOUS"
assert_rollback_floor_case missing "" 6 \
  "rollback refused: exposure=AMBIGUOUS" \
  "journal document or rollbackFloor is invalid"
assert_rollback_floor_case value 0 6 \
  "rollback refused: exposure=AMBIGUOUS" \
  "journal document or rollbackFloor is invalid"
for invalid_floor in "" null '"7"' "not-a-number" \
  "0; : > $FLOOR_INJECTION_MARKER" -1 3.5 9223372036854775808; do
  assert_rollback_floor_case value "$invalid_floor" 1 \
    "journal document or rollbackFloor is invalid" \
    "rollback refused: exposure=AMBIGUOUS"
done
for precision_edge_floor in 1.0000000000000001 9007199254740990.5 \
  9007199254740991.1 1e-4000 -0 9007199254740992; do
  assert_rollback_floor_case raw-value "$precision_edge_floor" 1 \
    "journal document or rollbackFloor is invalid" \
    "rollback refused: exposure=AMBIGUOUS"
done
assert_rollback_floor_case raw-barrier 9007199254740991 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "journal document or rollbackFloor is invalid"
assert_rollback_floor_case relation "" 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "journal dataSchema is not a nonnegative integer"
for invalid_data_schema in null '"2"' -1 2.5 9007199254740992; do
  assert_rollback_floor_case raw-data-schema "$invalid_data_schema" 6 \
    "rollback refused: exposure=AMBIGUOUS" \
    "journal dataSchema is not a nonnegative integer"
done
assert_rollback_floor_case invalid-schema-barrier "" 5 \
  "rollback to rel-H refused: schemaVersion 2 is behind the non-rollback barrier" \
  "journal dataSchema is not a nonnegative integer"
assert_rollback_floor_case missing-schema-floor 1 6 \
  "rollback refused: exposure=AMBIGUOUS" \
  "journal dataSchema is not a nonnegative integer"
set +e
ROLLBACK_MISSING_SCHEMA_SNAPSHOT="$(journal_state_snapshot "$JOURNAL")"
ROLLBACK_MISSING_SCHEMA_SNAPSHOT_RC=$?
set -e
assert_eq "$ROLLBACK_MISSING_SCHEMA_SNAPSHOT_RC" 8 \
  "missing dataSchema with a positive floor is a relation violation"
ASSERTIONS=$((ASSERTIONS + 1))
case "$ROLLBACK_MISSING_SCHEMA_SNAPSHOT" in
  PRESENT\|0\|1\|*) ;;
  *) fail "missing dataSchema relation snapshot omitted its bound token" ;;
esac
for invalid_root in null '[]' 0 '"journal"'; do
  assert_rollback_floor_case raw-root "$invalid_root" 1 \
    "journal document or rollbackFloor is invalid" \
    "rollback refused: exposure=AMBIGUOUS"
done

remove_journal_endpoint() {
  if [ -d "$JOURNAL" ] && [ ! -L "$JOURNAL" ]; then
    rmdir "$JOURNAL"
  else
    rm -f -- "$JOURNAL"
  fi
}

FLOOR_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK")"
remove_journal_endpoint
set +e
FLOOR_ABSENT_OUTPUT="$(bash "$ROLLBACK" --to rel-H 2>&1)"
FLOOR_ABSENT_RC=$?
set -e
assert_eq "$FLOOR_ABSENT_RC" 6 \
  "absent rollback journal keeps the documented zero default"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_ABSENT_OUTPUT" in
  *"rollback refused: exposure=AMBIGUOUS"*) ;;
  *) fail "absent rollback journal did not reach the later exposure gate" ;;
esac
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "absent rollback journal leaves current unchanged"
assert_link_target "$PREVIOUS_LINK" "$FLOOR_PREVIOUS_TARGET" \
  "absent rollback journal leaves previous unchanged"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

FLOOR_ROLLBACK_LOG_BYTES="$(wc -c < "$OPS_STATE_DIR/deploy-log.jsonl" | tr -d ' ')"
FLOOR_ALERT_BYTES="$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')"
FLOOR_SYMLINK_TARGET="$SANDBOX/rollback-journal-symlink-target.json"
printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$FLOOR_SYMLINK_TARGET"
FLOOR_SYMLINK_TARGET_SHA="$(sha256_file "$FLOOR_SYMLINK_TARGET")"
FLOOR_HARDLINK_TARGET="$SANDBOX/rollback-journal-hardlink-target.json"
printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$FLOOR_HARDLINK_TARGET"
FLOOR_HARDLINK_TARGET_SHA="$(sha256_file "$FLOOR_HARDLINK_TARGET")"

assert_rollback_journal_endpoint_case() { # kind required
  local kind="$1" required="$2" output rc
  local endpoint_pid="" endpoint_deadline endpoint_sha=""
  remove_journal_endpoint
  case "$kind" in
    directory) mkdir "$JOURNAL" ;;
    fifo) mkfifo "$JOURNAL" ;;
    symlink) ln -s "$FLOOR_SYMLINK_TARGET" "$JOURNAL" ;;
    dangling-symlink) ln -s "$SANDBOX/missing-rollback-journal-target" "$JOURNAL" ;;
    hardlink) ln "$FLOOR_HARDLINK_TARGET" "$JOURNAL" ;;
    oversized)
      "$NODE" -e '
        require("node:fs").writeFileSync(process.argv[1], Buffer.alloc(1048577, 65));
      ' "$JOURNAL"
      endpoint_sha="$(sha256_file "$JOURNAL")"
      ;;
    socket)
      "$NODE" -e '
        const net = require("node:net");
        const path = require("node:path");
        const server = net.createServer();
        const endpoint = process.argv[1];
        process.chdir(path.dirname(endpoint));
        server.listen(path.basename(endpoint));
      ' "$JOURNAL" &
      endpoint_pid=$!
      register_pid "$endpoint_pid"
      endpoint_deadline=$(( $(date -u +%s) + 5 ))
      while [ ! -S "$JOURNAL" ]; do
        kill -0 "$endpoint_pid" 2>/dev/null \
          || fail "rollback journal socket fixture exited before binding"
        [ "$(date -u +%s)" -lt "$endpoint_deadline" ] \
          || fail "rollback journal socket fixture did not bind"
        sleep 0.1
      done
      ;;
    *) fail "unknown rollback journal endpoint kind: $kind" ;;
  esac
  run_bounded_capture "$SANDBOX/rollback-journal-$kind.out" 20 \
    bash "$ROLLBACK" --to rel-H
  output="$BOUNDED_OUTPUT"
  rc="$BOUNDED_RC"
  assert_eq "$rc" 1 "rollback journal endpoint $kind refusal code"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "rollback journal endpoint $kind omitted [$required]: $output" ;;
  esac
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"rollback refused: exposure=AMBIGUOUS"*)
      fail "rollback journal endpoint $kind reached the exposure gate: $output"
      ;;
    *) ;;
  esac
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
    "rollback journal endpoint $kind leaves current unchanged"
  assert_link_target "$PREVIOUS_LINK" "$FLOOR_PREVIOUS_TARGET" \
    "rollback journal endpoint $kind leaves previous unchanged"
  assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
  assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
    "$FLOOR_SYSTEMCTL_BYTES" "rollback journal endpoint $kind does not invoke systemctl"
  assert_eq "$(wc -c < "$OPS_STATE_DIR/deploy-log.jsonl" | tr -d ' ')" \
    "$FLOOR_ROLLBACK_LOG_BYTES" "rollback journal endpoint $kind does not append the deploy log"
  assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" \
    "$FLOOR_ALERT_BYTES" "rollback journal endpoint $kind does not alert"
  case "$kind" in
    directory)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -d "$JOURNAL" ] && [ ! -L "$JOURNAL" ] \
        || fail "rollback changed the journal directory endpoint"
      ;;
    fifo)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -p "$JOURNAL" ] || fail "rollback changed the journal FIFO endpoint"
      ;;
    symlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -L "$JOURNAL" ] || fail "rollback changed the journal symlink endpoint"
      assert_eq "$(sha256_file "$FLOOR_SYMLINK_TARGET")" \
        "$FLOOR_SYMLINK_TARGET_SHA" "rollback leaves journal symlink target unchanged"
      ;;
    dangling-symlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -L "$JOURNAL" ] \
        || fail "rollback changed the dangling journal symlink endpoint"
      ;;
    hardlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ "$JOURNAL" -ef "$FLOOR_HARDLINK_TARGET" ] \
        || fail "rollback changed the journal hardlink endpoint"
      assert_eq "$(sha256_file "$FLOOR_HARDLINK_TARGET")" \
        "$FLOOR_HARDLINK_TARGET_SHA" \
        "rollback leaves journal hardlink peer unchanged"
      ;;
    oversized)
      assert_file "$JOURNAL"
      assert_eq "$(sha256_file "$JOURNAL")" "$endpoint_sha" \
        "rollback leaves oversized journal bytes unchanged"
      ;;
    socket)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -S "$JOURNAL" ] || fail "rollback changed the journal socket endpoint"
      ;;
  esac
  if [ -n "$endpoint_pid" ]; then
    kill "$endpoint_pid" 2>/dev/null || true
    wait "$endpoint_pid" 2>/dev/null || true
    unregister_pid "$endpoint_pid"
  fi
  remove_journal_endpoint
}

assert_rollback_journal_endpoint_case directory \
  "journal path is occupied by a non-regular or linked endpoint"
assert_rollback_journal_endpoint_case fifo \
  "journal path is occupied by a non-regular or linked endpoint"
assert_rollback_journal_endpoint_case symlink \
  "JOURNAL_FILE must be one exact raw canonical absolute path"
assert_rollback_journal_endpoint_case dangling-symlink \
  "JOURNAL_FILE must be one exact raw canonical absolute path"
assert_rollback_journal_endpoint_case hardlink \
  "journal path is occupied by a non-regular or linked endpoint"
assert_rollback_journal_endpoint_case oversized \
  "or exceeds the size limit"
assert_rollback_journal_endpoint_case socket \
  "journal path is occupied by a non-regular or linked endpoint"

note "1d. journal change after validation refuses before the rollback switch"
write_floor_journal value 0
ROLLBACK_SWITCH_CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
ROLLBACK_SWITCH_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK")"
ROLLBACK_SWITCH_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
ROLLBACK_SWITCH_MUTATOR="$SANDBOX/rollback-journal-switch-mutator.sh"
cat > "$ROLLBACK_SWITCH_MUTATOR" <<EOF
#!/bin/sh
printf '%s\n' '{"dataSchema":3,"rollbackFloor":0,"externalRevision":"before-switch"}' > "$JOURNAL"
printf '%s\n' NONE
EOF
chmod 0700 "$ROLLBACK_SWITCH_MUTATOR"
set +e
ROLLBACK_SWITCH_OUTPUT="$(
  env EXPOSURE_CMD="$ROLLBACK_SWITCH_MUTATOR" \
    bash "$ROLLBACK" --to rel-H 2>&1
)"
ROLLBACK_SWITCH_RC=$?
set -e
assert_eq "$ROLLBACK_SWITCH_RC" 1 \
  "journal change after validation refuses the rollback switch"
ASSERTIONS=$((ASSERTIONS + 1))
case "$ROLLBACK_SWITCH_OUTPUT" in
  *"journal changed after under-lock validation - refusing to switch releases"*) ;;
  *) fail "rollback pre-switch journal change omitted exact refusal: $ROLLBACK_SWITCH_OUTPUT" ;;
esac
assert_link_target "$CURRENT_LINK" "$ROLLBACK_SWITCH_CURRENT_TARGET" \
  "rollback pre-switch journal change leaves current unchanged"
assert_link_target "$PREVIOUS_LINK" "$ROLLBACK_SWITCH_PREVIOUS_TARGET" \
  "rollback pre-switch journal change leaves previous unchanged"
assert_eq "$(json_get "$JOURNAL" externalRevision)" before-switch \
  "rollback pre-switch refusal preserves newer journal bytes"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$ROLLBACK_SWITCH_SYSTEMCTL_BYTES" \
  "rollback pre-switch refusal does not invoke systemctl"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
write_floor_journal value 0

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
printf '{"dataSchema":null,"rollbackFloor":2}\n' > "$JOURNAL"
ROLLBACK_INVALID_SCHEMA_SHA="$(sha256_file "$JOURNAL")"
set +e
ROLLBACK_INVALID_SCHEMA_SNAPSHOT="$(journal_state_snapshot "$JOURNAL")"
ROLLBACK_INVALID_SCHEMA_SNAPSHOT_RC=$?
set -e
assert_eq "$ROLLBACK_INVALID_SCHEMA_SNAPSHOT_RC" 7 \
  "invalid dataSchema snapshot retains a rollback token"
ASSERTIONS=$((ASSERTIONS + 1))
case "$ROLLBACK_INVALID_SCHEMA_SNAPSHOT" in
  PRESENT\|INVALID\|2\|*) ;;
  *) fail "invalid dataSchema snapshot omitted its bound token" ;;
esac
assert_eq "${ROLLBACK_INVALID_SCHEMA_SNAPSHOT##*|}" \
  "$ROLLBACK_INVALID_SCHEMA_SHA" \
  "invalid dataSchema snapshot binds the exact journal bytes"
printf '%s\n' NONE > "$SANDBOX/exposure"

note "2. rollback uses a valid floor even when dataSchema is invalid"
assert_rc 0 bash "$ROLLBACK"        # previous -> rel-H (schema 2, at floor)
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" "rolled back to H"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-I" "previous now I"
assert_eq "$(sha256_file "$JOURNAL")" "$ROLLBACK_INVALID_SCHEMA_SHA" \
  "rollback leaves invalid dataSchema evidence unchanged"
assert_grep '"result":"ROLLBACK_OK"' "$OPS_STATE_DIR/deploy-log.jsonl" "rollback logged"

note "3. a floor/schema relation violation still reaches rollback policy"
printf '{"dataSchema":1,"rollbackFloor":2}\n' > "$JOURNAL"
ROLLBACK_RELATION_SHA="$(sha256_file "$JOURNAL")"
set +e
ROLLBACK_RELATION_SNAPSHOT="$(journal_state_snapshot "$JOURNAL")"
ROLLBACK_RELATION_SNAPSHOT_RC=$?
set -e
assert_eq "$ROLLBACK_RELATION_SNAPSHOT_RC" 8 \
  "floor/schema relation snapshot has its own status"
ASSERTIONS=$((ASSERTIONS + 1))
case "$ROLLBACK_RELATION_SNAPSHOT" in
  PRESENT\|1\|2\|*) ;;
  *) fail "floor/schema relation snapshot omitted its bound token" ;;
esac
assert_eq "${ROLLBACK_RELATION_SNAPSHOT##*|}" "$ROLLBACK_RELATION_SHA" \
  "floor/schema relation snapshot binds the exact journal bytes"
echo AMBIGUOUS > "$SANDBOX/exposure"
assert_rc 6 bash "$ROLLBACK" --to rel-I
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" "refusal left state alone"
assert_eq "$(sha256_file "$JOURNAL")" "$ROLLBACK_RELATION_SHA" \
  "policy refusal leaves relation-violating journal unchanged"

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
write_floor_journal value 2
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
