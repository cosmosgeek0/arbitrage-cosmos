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

note "1c. journal preflight precedes a live rollback-lock wait"
HELD_JOURNAL_LOCK="$OPS_STATE_DIR/locks/deploy.lock"
acquire_lock "$HELD_JOURNAL_LOCK" \
  || fail "could not create held lock for rollback journal preflight ordering"
HELD_JOURNAL_OWNER="$HELD_JOURNAL_LOCK/owner.json"
HELD_JOURNAL_OWNER_SHA="$(sha256_file "$HELD_JOURNAL_OWNER")"
remove_journal_endpoint
mkdir "$JOURNAL"
run_bounded_capture "$SANDBOX/rollback-journal-held-unsafe.out" 20 \
  env LOCK_TIMEOUT_SEC=30 \
    bash "$ROLLBACK" --to rel-H
assert_eq "$BOUNDED_RC" 1 \
  "unsafe rollback journal refuses before a held-lock wait"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BOUNDED_OUTPUT" in
  *"journal path is occupied by a non-regular or linked endpoint"*) ;;
  *) fail "unsafe rollback journal did not precede the held-lock gate: $BOUNDED_OUTPUT" ;;
esac
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "unsafe rollback journal leaves held-lock owner unchanged"
remove_journal_endpoint
for held_journal_case in invalid-floor invalid-data-schema invalid-relation; do
  HELD_JOURNAL_CASE_LOCK_TIMEOUT_SEC="$LOCK_TIMEOUT_SEC"
  case "$held_journal_case" in
    invalid-floor)
      printf '{"dataSchema":2,"rollbackFloor":null}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="journal document or rollbackFloor is invalid"
      HELD_JOURNAL_EXPECTED_RC=1
      HELD_JOURNAL_CASE_LOCK_TIMEOUT_SEC=30
      ;;
    invalid-data-schema)
      printf '{"dataSchema":null,"rollbackFloor":0}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="deploy lock busy"
      HELD_JOURNAL_EXPECTED_RC=4
      ;;
    invalid-relation)
      printf '{"dataSchema":1,"rollbackFloor":2}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="deploy lock busy"
      HELD_JOURNAL_EXPECTED_RC=4
      ;;
  esac
  run_bounded_capture "$SANDBOX/rollback-journal-held-$held_journal_case.out" 20 \
    env LOCK_TIMEOUT_SEC="$HELD_JOURNAL_CASE_LOCK_TIMEOUT_SEC" \
      bash "$ROLLBACK" --to rel-H
  assert_eq "$BOUNDED_RC" "$HELD_JOURNAL_EXPECTED_RC" \
    "$held_journal_case follows its rollback preflight policy"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$BOUNDED_OUTPUT" in
    *"$HELD_JOURNAL_REQUIRED"*) ;;
    *) fail "$held_journal_case omitted [$HELD_JOURNAL_REQUIRED]: $BOUNDED_OUTPUT" ;;
  esac
  assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
    "$held_journal_case leaves held rollback-lock owner unchanged"
done
remove_journal_endpoint
run_bounded_capture "$SANDBOX/rollback-journal-held-absent.out" 20 \
  bash "$ROLLBACK" --to rel-H
assert_eq "$BOUNDED_RC" 4 \
  "absent rollback journal reaches the held-lock gate"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BOUNDED_OUTPUT" in
  *"deploy lock busy"*) ;;
  *) fail "absent rollback journal did not reach the held-lock gate: $BOUNDED_OUTPUT" ;;
esac
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "absent rollback journal leaves held-lock owner unchanged"
write_floor_journal value 0
run_bounded_capture "$SANDBOX/rollback-journal-held-regular.out" 20 \
  bash "$ROLLBACK" --to rel-H
assert_eq "$BOUNDED_RC" 4 \
  "regular rollback journal reaches the held-lock gate"
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "regular rollback journal leaves held-lock owner unchanged"
release_lock "$HELD_JOURNAL_LOCK" \
  || fail "could not release held rollback journal-ordering lock"
assert_rc 1 test -e "$HELD_JOURNAL_LOCK"

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
assert_eq "$(sha256_file "$JOURNAL")" "$ROLLBACK_RELATION_SHA" \
  "forced rollback leaves relation-violating journal unchanged"
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

note "8. second pointer failure is terminal rc3 after the current switch"
POST_SWITCH_FROZEN="$OPS_STATE_DIR/deploy-frozen.json"
POST_SWITCH_LOG="$OPS_STATE_DIR/deploy-log.jsonl"
rm -f "$POST_SWITCH_FROZEN"
assert_rc 0 bash "$ROLLBACK" --to rel-H
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "post-switch fixtures start from healthy H"
SECOND_POINTER_PREVIOUS="$(readlink "$PREVIOUS_LINK")"
SECOND_POINTER_BIN="$SANDBOX/rollback-second-pointer-bin"
mkdir -p "$SECOND_POINTER_BIN"
cp "$BIN/common.sh" "$BIN/rollback.sh" "$SECOND_POINTER_BIN/"
"$NODE" - "$SECOND_POINTER_BIN/common.sh" <<'NODE' \
  || fail "could not inject the second-pointer failure fixture"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'atomic_symlink() {\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(
  needle,
  needle
    + '  if [ "${ROLLBACK_TEST_FAIL_LINK:-}" = "$2" ]; then\n'
    + '    return 1\n'
    + '  fi\n',
));
NODE
run_bounded_capture "$SANDBOX/rollback-second-pointer.out" 20 \
  env ROLLBACK_TEST_FAIL_LINK="$PREVIOUS_LINK" \
    bash "$SECOND_POINTER_BIN/rollback.sh" --to rel-I
assert_eq "$BOUNDED_RC" 3 \
  "second pointer failure retains the post-switch terminal code"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "second pointer failure leaves the selected target current"
assert_link_target "$PREVIOUS_LINK" "$SECOND_POINTER_PREVIOUS" \
  "second pointer failure reports rather than inventing a previous update"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"currentSwitched": true' "$POST_SWITCH_FROZEN" \
  "second pointer failure records the completed current switch"
assert_grep '"previousUpdateState": "PENDING"' "$POST_SWITCH_FROZEN" \
  "second pointer failure records the incomplete previous update"
assert_grep 'previous pointer update failed' "$MOCK_ALERT_LOG" \
  "second pointer failure reaches the critical alert"
assert_grep 'previous pointer update failed' "$POST_SWITCH_LOG" \
  "second pointer failure reaches the critical audit"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
rm -f "$POST_SWITCH_FROZEN"
assert_rc 0 bash "$ROLLBACK" --to rel-H
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "second pointer failure recovery restores healthy H"

note "9. marker, nested alert exit, and audit failures cannot suppress terminal rc3"
EVIDENCE_OLD_CURRENT="$(readlink "$CURRENT_LINK")"
EVIDENCE_LOG_BACKUP="$OPS_STATE_DIR/deploy-log.before-evidence-failure.jsonl"
EVIDENCE_ALERT_BYTES="$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')"
EVIDENCE_FAILURE_BIN="$SANDBOX/rollback-evidence-failure-bin"
mkdir -p "$EVIDENCE_FAILURE_BIN"
cp "$BIN/common.sh" "$BIN/rollback.sh" "$EVIDENCE_FAILURE_BIN/"
"$NODE" - "$EVIDENCE_FAILURE_BIN/common.sh" <<'NODE' \
  || fail "could not inject the explicit alert-exit fixture"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'alert() {\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, `${needle}  exit 91\n`));
NODE
mv "$POST_SWITCH_LOG" "$EVIDENCE_LOG_BACKUP"
mkdir "$POST_SWITCH_LOG" "$POST_SWITCH_FROZEN"
run_bounded_capture "$SANDBOX/rollback-evidence-failure.out" 20 \
  bash "$EVIDENCE_FAILURE_BIN/rollback.sh" --to rel-S
assert_eq "$BOUNDED_RC" 3 \
  "independent rollback evidence failures retain terminal rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-S" \
  "evidence failures do not conceal the completed current switch"
assert_link_target "$PREVIOUS_LINK" "$EVIDENCE_OLD_CURRENT" \
  "evidence failures retain the completed previous update"
assert_grep 'rollback frozen marker could not be published' \
  "$SANDBOX/rollback-evidence-failure.out" \
  "marker write failure reaches the terminal diagnostic"
assert_grep 'could not emit ROLLBACK_GATE_FAILED alert' \
  "$SANDBOX/rollback-evidence-failure.out" \
  "nested explicit alert exit is contained by terminal handling"
assert_grep 'could not append CRITICAL rollback audit event' \
  "$SANDBOX/rollback-evidence-failure.out" \
  "audit failure does not suppress terminal handling"
assert_grep 'rollback switched to rel-S but did not complete safely' \
  "$SANDBOX/rollback-evidence-failure.out" \
  "terminal handling continues after the nested explicit alert exit"
assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" \
  "$EVIDENCE_ALERT_BYTES" \
  "explicit alert exit cannot append a false successful alert"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
rmdir "$POST_SWITCH_LOG" "$POST_SWITCH_FROZEN"
mv "$EVIDENCE_LOG_BACKUP" "$POST_SWITCH_LOG"
assert_rc 0 bash "$ROLLBACK" --to rel-H
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "evidence failure recovery restores healthy H"

note "10. frozen marker seal failure still alerts, audits, and exits rc3"
SEAL_FAILURE_BIN="$SANDBOX/rollback-seal-failure-bin"
mkdir -p "$SEAL_FAILURE_BIN"
cp "$BIN/common.sh" "$BIN/rollback.sh" "$SEAL_FAILURE_BIN/"
"$NODE" - "$SEAL_FAILURE_BIN/common.sh" <<'NODE' \
  || fail "could not inject the frozen-marker seal failure fixture"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'fs_seal_file_readonly() { # FILE PARENT_DIRECTORY\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, `${needle}  return 1\n`));
NODE
SEAL_FAILURE_OLD_CURRENT="$(readlink "$CURRENT_LINK")"
run_bounded_capture "$SANDBOX/rollback-seal-failure.out" 20 \
  bash "$SEAL_FAILURE_BIN/rollback.sh" --to rel-S
assert_eq "$BOUNDED_RC" 3 \
  "frozen marker seal failure retains terminal rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-S" \
  "seal failure leaves the selected rollback target current"
assert_link_target "$PREVIOUS_LINK" "$SEAL_FAILURE_OLD_CURRENT" \
  "seal failure retains the completed previous update"
assert_file "$POST_SWITCH_FROZEN"
assert_grep 'FROZEN MARKER SEAL FAILED' \
  "$SANDBOX/rollback-seal-failure.out" \
  "seal failure reaches the terminal diagnostic"
assert_grep 'FROZEN MARKER SEAL FAILED' "$MOCK_ALERT_LOG" \
  "seal failure reaches the critical alert"
assert_grep 'FROZEN MARKER SEAL FAILED' "$POST_SWITCH_LOG" \
  "seal failure reaches the critical audit"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
rm -f "$POST_SWITCH_FROZEN"
assert_rc 0 bash "$ROLLBACK" --to rel-H
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "seal failure recovery restores healthy H"

note "11. healthy automatic rollback ignores only its failed success audit"
HEALTHY_AUDIT_BACKUP="$OPS_STATE_DIR/deploy-log.before-healthy-audit.jsonl"
mv "$POST_SWITCH_LOG" "$HEALTHY_AUDIT_BACKUP"
mkdir "$POST_SWITCH_LOG"
run_bounded_capture "$SANDBOX/rollback-healthy-audit-failure.out" 20 \
  bash "$ROLLBACK" --auto --to rel-I
assert_eq "$BOUNDED_RC" 0 \
  "healthy automatic rollback remains successful when success audit append fails"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "healthy automatic rollback applies the selected target"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-H" \
  "healthy automatic rollback records its previous target"
assert_grep 'could not append ROLLBACK_OK audit event' \
  "$SANDBOX/rollback-healthy-audit-failure.out" \
  "healthy audit failure is reported as non-critical"
assert_no_file "$POST_SWITCH_FROZEN"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"
rmdir "$POST_SWITCH_LOG"
mv "$HEALTHY_AUDIT_BACKUP" "$POST_SWITCH_LOG"

note "11a. healthy rollback contains an explicit exit from its success-audit helper"
HEALTHY_EXIT_BIN="$SANDBOX/rollback-healthy-audit-exit-bin"
HEALTHY_EXIT_ROLLBACK="$HEALTHY_EXIT_BIN/rollback.sh"
mkdir -p "$HEALTHY_EXIT_BIN"
cp "$BIN/common.sh" "$BIN/rollback.sh" "$HEALTHY_EXIT_BIN/"
chmod 0755 "$HEALTHY_EXIT_BIN/common.sh" "$HEALTHY_EXIT_ROLLBACK"
"$NODE" - "$HEALTHY_EXIT_ROLLBACK" <<'NODE' \
  || fail "could not inject the healthy success-audit explicit-exit fixture"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'log_event() { # RESULT DETAIL\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(
  needle,
  `${needle}  if [ "$1" = ROLLBACK_OK ]; then exit 91; fi\n`,
));
NODE
HEALTHY_EXIT_LOG_BYTES="$(wc -c < "$POST_SWITCH_LOG" | tr -d ' ')"
run_bounded_capture "$SANDBOX/rollback-healthy-audit-exit.out" 20 \
  bash "$HEALTHY_EXIT_ROLLBACK" --to rel-H
assert_eq "$BOUNDED_RC" 0 \
  "healthy rollback remains rc0 after an explicit success-audit exit"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "healthy rollback with an explicit audit exit applies the selected target"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-I" \
  "healthy rollback with an explicit audit exit records its previous target"
assert_grep 'could not append ROLLBACK_OK audit event' \
  "$SANDBOX/rollback-healthy-audit-exit.out" \
  "explicit success-audit exit is contained as non-critical"
assert_eq "$(wc -c < "$POST_SWITCH_LOG" | tr -d ' ')" \
  "$HEALTHY_EXIT_LOG_BYTES" \
  "explicit success-audit exit cannot append a false success event"
assert_no_file "$POST_SWITCH_FROZEN"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

prepare_terminal_rollback_case() { # CASE
  local case_name="$1"
  TERMINAL_ROLLBACK_DIR="$SANDBOX/terminal-rollback-$case_name"
  TERMINAL_ROLLBACK_BIN="$TERMINAL_ROLLBACK_DIR/bin"
  TERMINAL_ROLLBACK="$TERMINAL_ROLLBACK_BIN/rollback.sh"
  TERMINAL_ROLLBACK_COMMON="$TERMINAL_ROLLBACK_BIN/common.sh"
  TERMINAL_ROLLBACK_OUTPUT="$TERMINAL_ROLLBACK_DIR/result.out"
  TERMINAL_ROLLBACK_OTHER="$TERMINAL_ROLLBACK_DIR/other-current-target"
  mkdir -p "$TERMINAL_ROLLBACK_BIN" "$TERMINAL_ROLLBACK_OTHER"
  cp "$BIN/common.sh" "$BIN/rollback.sh" "$TERMINAL_ROLLBACK_BIN/"
  chmod 0755 "$TERMINAL_ROLLBACK_COMMON" "$TERMINAL_ROLLBACK"
  rm -f "$CURRENT_LINK" "$PREVIOUS_LINK" "$POST_SWITCH_FROZEN"
  ln -s "$RELEASES_DIR/rel-I" "$CURRENT_LINK"
  ln -s "$RELEASES_DIR/rel-H" "$PREVIOUS_LINK"
  write_floor_journal value 2
  printf '%s\n' NONE > "$SANDBOX/exposure"
}

terminal_rollback_run() { # ROLLBACK_SCRIPT [ENV=VALUE...]
  local rollback_script="$1"
  shift
  env "$@" bash "$rollback_script" --to rel-H
}

inject_rollback_switch_termination() { # ROLLBACK_SCRIPT attempted-term|confirmed-term|confirmed-exit-zero
  "$NODE" - "$1" "$2" <<'NODE' \
    || fail "could not inject rollback switch termination fixture"
const fs = require('node:fs');
const [file, mode] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const attempted = [
  'ROLLBACK_SWITCH_ATTEMPTED=1',
  'if atomic_symlink "$TARGET_DIR" "$CURRENT_EFFECT_LINK"; then',
].join('\n');
const confirmed = [
  'if atomic_symlink "$TARGET_DIR" "$CURRENT_EFFECT_LINK"; then',
  '  ROLLBACK_CURRENT_SWITCHED=true ROLLBACK_SWITCHED=1',
  '  ROLLBACK_SWITCH_ATTEMPTED=0',
].join('\n');
let needle;
let replacement;
if (mode === 'attempted-term') {
  needle = attempted;
  replacement = attempted.replace(
    '\n',
    '\nkill -TERM "$$"\n',
  );
} else if (mode === 'confirmed-term' || mode === 'confirmed-exit-zero') {
  needle = confirmed;
  const action = mode === 'confirmed-term' ? '  kill -TERM "$$"' : '  exit 0';
  replacement = `${confirmed}\n${action}`;
} else {
  process.exit(1);
}
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, replacement));
NODE
}

inject_rollback_atomic_symlink_classifier() { # COMMON_SCRIPT
  "$NODE" - "$1" <<'NODE' \
    || fail "could not inject rollback atomic-symlink nonzero classifier"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'atomic_symlink() {\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
const injection = [
  '  if [ "${DF32_ATOMIC_SYMLINK_CASE:-}" != "" ] \\',
  '      && [ "$2" = "$CURRENT_LINK" ]; then',
  '    case "$DF32_ATOMIC_SYMLINK_CASE" in',
  '      preimage) return 91 ;;',
  '      candidate) test_atomic_target="$1" ;;',
  '      other) test_atomic_target="${DF32_ATOMIC_OTHER_TARGET:?}" ;;',
  '      *) return 92 ;;',
  '    esac',
  '    i00_guard_node - "$test_atomic_target" "$2" "$$" <<\'ATOMIC_NODE\'',
  'const fs = require("node:fs");',
  'const [target, link, pid] = process.argv.slice(2);',
  'const temporary = `${link}.test-atomic-${pid}`;',
  'try { fs.rmSync(temporary, { force: true }); } catch {}',
  'fs.symlinkSync(target, temporary);',
  'fs.renameSync(temporary, link);',
  'ATOMIC_NODE',
  '    return 91',
  '  fi',
].join('\n') + '\n';
fs.writeFileSync(file, source.replace(needle, needle + injection));
NODE
}

note "12. TERM during an attempted or confirmed rollback switch is bounded and freezes rc3"
prepare_terminal_rollback_case attempted-term
inject_rollback_switch_termination "$TERMINAL_ROLLBACK" attempted-term
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK"
assert_eq "$BOUNDED_RC" 3 \
  "TERM during the rollback switch attempt maps to terminal rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "attempted rollback TERM leaves the exact preimage current"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-H" \
  "attempted rollback TERM leaves previous unchanged"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"releaseId": "rel-H"' "$POST_SWITCH_FROZEN" \
  "attempted rollback TERM freezes the exact target release"
assert_grep '"currentSwitched": "UNKNOWN"' "$POST_SWITCH_FROZEN" \
  "attempted rollback TERM records unknown publication"
assert_grep 'publication is uncertain after an interrupted atomic switch' \
  "$POST_SWITCH_FROZEN" \
  "attempted rollback TERM records publication uncertainty"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

prepare_terminal_rollback_case confirmed-term
inject_rollback_switch_termination "$TERMINAL_ROLLBACK" confirmed-term
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK"
assert_eq "$BOUNDED_RC" 3 \
  "TERM after confirmed rollback publication maps to terminal rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "confirmed rollback TERM preserves the published target"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-H" \
  "confirmed rollback TERM occurs before the previous pointer update"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"releaseId": "rel-H"' "$POST_SWITCH_FROZEN" \
  "confirmed rollback TERM freezes the exact target release"
assert_grep '"currentSwitched": true' "$POST_SWITCH_FROZEN" \
  "confirmed rollback TERM records the completed current switch"
assert_grep 'unexpected failure after the current rollback switch' \
  "$POST_SWITCH_FROZEN" \
  "confirmed rollback TERM records the terminal freeze"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

note "13. a direct exit 0 after confirmed rollback publication cannot report success"
prepare_terminal_rollback_case confirmed-exit-zero
TERMINAL_ROLLBACK_LOG_BYTES="$(
  wc -c < "$POST_SWITCH_LOG" | tr -d ' '
)"
inject_rollback_switch_termination "$TERMINAL_ROLLBACK" confirmed-exit-zero
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK"
assert_eq "$BOUNDED_RC" 3 \
  "direct exit 0 after confirmed rollback publication maps to terminal rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "direct exit 0 preserves the published rollback target"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-H" \
  "direct exit 0 occurs before the previous pointer update"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"currentSwitched": true' "$POST_SWITCH_FROZEN" \
  "direct exit 0 records the completed current switch"
assert_grep 'unexpected failure after the current rollback switch' \
  "$POST_SWITCH_FROZEN" \
  "direct exit 0 records the terminal freeze"
ASSERTIONS=$((ASSERTIONS + 1))
if ! "$NODE" - "$POST_SWITCH_LOG" "$TERMINAL_ROLLBACK_LOG_BYTES" <<'NODE'
const fs = require('node:fs');
const [file, offsetRaw] = process.argv.slice(2);
if (!/^(?:0|[1-9][0-9]*)$/u.test(offsetRaw)) process.exit(1);
const offset = Number(offsetRaw);
const bytes = fs.readFileSync(file);
if (!Number.isSafeInteger(offset) || offset > bytes.length
    || bytes.subarray(offset).includes(Buffer.from('"result":"ROLLBACK_OK"'))) {
  process.exit(1);
}
NODE
then
  fail "direct exit 0 appended a false ROLLBACK_OK event"
fi
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

note "14. rollback atomic-symlink nonzero results use exact pointer-state classification"
prepare_terminal_rollback_case atomic-preimage
inject_rollback_atomic_symlink_classifier "$TERMINAL_ROLLBACK_COMMON"
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK" \
    DF32_ATOMIC_SYMLINK_CASE=preimage
assert_eq "$BOUNDED_RC" 1 \
  "rollback atomic-symlink nonzero with the preimage remains rc1"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-I" \
  "rollback preimage classification leaves current unchanged"
assert_no_file "$POST_SWITCH_FROZEN"
assert_grep 'current rollback pointer update failed before the switch' \
  "$TERMINAL_ROLLBACK_OUTPUT" \
  "rollback preimage classification reports the pre-switch refusal"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

prepare_terminal_rollback_case atomic-target
inject_rollback_atomic_symlink_classifier "$TERMINAL_ROLLBACK_COMMON"
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK" \
    DF32_ATOMIC_SYMLINK_CASE=candidate
assert_eq "$BOUNDED_RC" 3 \
  "rollback atomic-symlink nonzero after target publication freezes rc3"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "rollback target classification preserves the published target"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"currentSwitched": true' "$POST_SWITCH_FROZEN" \
  "rollback target classification records the completed switch"
assert_grep 'reported failure after publication' "$POST_SWITCH_FROZEN" \
  "rollback target classification records known publication"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

prepare_terminal_rollback_case atomic-other
inject_rollback_atomic_symlink_classifier "$TERMINAL_ROLLBACK_COMMON"
run_bounded_capture "$TERMINAL_ROLLBACK_OUTPUT" 30 \
  terminal_rollback_run "$TERMINAL_ROLLBACK" \
    DF32_ATOMIC_SYMLINK_CASE=other \
    DF32_ATOMIC_OTHER_TARGET="$TERMINAL_ROLLBACK_OTHER"
assert_eq "$BOUNDED_RC" 3 \
  "rollback atomic-symlink nonzero with a third pointer state freezes rc3"
assert_link_target "$CURRENT_LINK" "$TERMINAL_ROLLBACK_OTHER" \
  "rollback third-state classification preserves the observed pointer"
assert_file "$POST_SWITCH_FROZEN"
assert_grep '"currentSwitched": "UNKNOWN"' "$POST_SWITCH_FROZEN" \
  "rollback third-state classification records unknown publication"
assert_grep 'publication is uncertain' "$POST_SWITCH_FROZEN" \
  "rollback third-state classification records publication uncertainty"
assert_rc 1 test -e "$OPS_STATE_DIR/locks/deploy.lock"

finish
