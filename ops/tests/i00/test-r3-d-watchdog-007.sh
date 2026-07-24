#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

BIN="$REPO_ROOT/ops/live/bin"
FIXTURES="$REPO_ROOT/ops/tests/fixtures"
WATCHDOG="$BIN/watchdog.sh"
COMMON="$BIN/common.sh"
NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
export NODE
hash -p "$NODE" node
OWNER_PIDS=""

cleanup_watchdog_test() {
  local pid
  for pid in $OWNER_PIDS; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  cleanup_test_tmp
}
trap cleanup_watchdog_test EXIT

forget_owner_pid() {
  local target="$1" pid kept=""
  for pid in $OWNER_PIDS; do
    [ "$pid" = "$target" ] || kept="$kept $pid"
  done
  OWNER_PIDS="$kept"
}

assert_process_gone() {
  local pid="$1" attempt=0
  OWNER_PIDS="$OWNER_PIDS $pid"
  while kill -0 "$pid" 2>/dev/null; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 40 ] || fail_test "alert descendant $pid survived process-group cleanup"
    sleep 0.05
  done
  pass_assertion
  forget_owner_pid "$pid"
}

export OPS_STATE_DIR="$TEST_TMP/ops"
export DEPLOY_LOCK="$OPS_STATE_DIR/locks/deploy.lock"
export APP_UNIT=df32-fixture-app.service
export TUNNEL_UNIT=df32-fixture-tunnel.service
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$TEST_TMP/systemctl.log"
export MOCK_ACTIVE_UNITS="$TEST_TMP/active-units"
export ALERT_CMD="$FIXTURES/mock-alert.sh"
export MOCK_ALERT_LOG="$TEST_TMP/external-alerts.log"
export HEALTH_BASE=http://127.0.0.1:9
export HTTP_TIMEOUT_SEC=1
export LIVE_FAIL_THRESHOLD=99
export BACKUP_DIR=""
export LOCK_OWNER_GRACE_SEC=5
printf '%s\n%s\n' "$APP_UNIT" "$TUNNEL_UNIT" > "$MOCK_ACTIVE_UNITS"

reset_scenario() {
  local name="$1"
  rm -rf "$DEPLOY_LOCK" "${DEPLOY_LOCK}.mutation"
  find "$(dirname "$DEPLOY_LOCK")" -maxdepth 1 -type d \
    -name "$(basename "$DEPLOY_LOCK").claim.*" -exec rm -rf {} + 2>/dev/null || true
  export WATCHDOG_STATE_DIR="$TEST_TMP/$name"
  : > "$MOCK_SYSTEMCTL_LOG"
  : > "$MOCK_ALERT_LOG"
}

run_watchdog() {
  assert_success bash "$WATCHDOG"
}

assert_checks_continued() {
  local expected_frozen="${1:-false}" expected_backup="${2:-unknown}"
  assert_eq "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write([v.live,v.ready,v.tunnel,v.skipped,v.deployFrozen,v.backupFresh,v.liveFailStreak].join("|"))' "$WATCHDOG_STATE_DIR/status.json")" "false|false|true|false|${expected_frozen}|${expected_backup}|1"
  assert_contains "$(cat "$MOCK_SYSTEMCTL_LOG")" "is-active $TUNNEL_UNIT"
}

assert_lock_retained() {
  [ -d "$DEPLOY_LOCK" ] || fail_test "watchdog mutated the deploy lock"
  pass_assertion
}

lock_state() {
  node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.deployLockState)' "$WATCHDOG_STATE_DIR/status.json"
}

lock_reason() {
  node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.deployLockReason)' "$WATCHDOG_STATE_DIR/status.json"
}

start_lock_owner() {
  local name="$1" ready="$TEST_TMP/$1-ready" stop="$TEST_TMP/$1-stop" attempt
  rm -f "$ready" "$stop"
  bash -c '
    set -eu
    . "$1"
    LOCK_TIMEOUT_SEC=2
    LOCK_OWNER_GRACE_SEC=5
    acquire_lock "$2" || exit 1
    : > "$3"
    while [ ! -e "$4" ]; do sleep 0.05; done
    release_lock "$2"
  ' _ "$COMMON" "$DEPLOY_LOCK" "$ready" "$stop" &
  LOCK_OWNER_PID=$!
  OWNER_PIDS="$OWNER_PIDS $LOCK_OWNER_PID"
  attempt=0
  while [ ! -e "$ready" ]; do
    kill -0 "$LOCK_OWNER_PID" 2>/dev/null || fail_test "lock owner exited before acquisition"
    attempt=$((attempt + 1))
    [ "$attempt" -lt 200 ] || fail_test "timed out waiting for lock owner"
    sleep 0.05
  done
  LOCK_OWNER_STOP="$stop"
}

stop_lock_owner() {
  : > "$LOCK_OWNER_STOP"
  wait "$LOCK_OWNER_PID"
  forget_owner_pid "$LOCK_OWNER_PID"
}

launch_competing_owner() {
  local name="$1" ready="$TEST_TMP/$1-ready" stop="$TEST_TMP/$1-stop"
  rm -f "$ready" "$stop"
  bash -c '
    set -eu
    . "$1"
    LOCK_TIMEOUT_SEC=10
    LOCK_OWNER_GRACE_SEC="${LOCK_OWNER_GRACE_SEC:-5}"
    acquire_lock "$2" || exit 1
    : > "$3"
    while [ ! -e "$4" ]; do sleep 0.05; done
    release_lock "$2"
  ' _ "$COMMON" "$DEPLOY_LOCK" "$ready" "$stop" &
  COMPETING_PID=$!
  OWNER_PIDS="$OWNER_PIDS $COMPETING_PID"
}

note "R3-D-WATCHDOG-007 exact dead-PID lock alerts and cannot suppress checks"
reset_scenario dead
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
run_watchdog
assert_eq "$(lock_state)" DEAD
assert_eq "$(lock_reason)" OWNER_NOT_RUNNING
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_DEAD'
assert_checks_continued
assert_lock_retained
assert_eq "$(cat "$DEPLOY_LOCK/pid")" 999999

note "dead owner cannot suppress frozen-deploy or missing-backup evidence"
reset_scenario full-checks
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
printf '{}\n' > "$OPS_STATE_DIR/deploy-frozen.json"
export BACKUP_DIR="$TEST_TMP/missing-backups"
run_watchdog
assert_eq "$(lock_state)" DEAD
assert_checks_continued true false
assert_contains "$(cat "$WATCHDOG_STATE_DIR/alerts.jsonl")" '"code":"DEPLOY_FROZEN"'
assert_contains "$(cat "$WATCHDOG_STATE_DIR/alerts.jsonl")" '"code":"BACKUP_MISSING"'
assert_lock_retained
export BACKUP_DIR=""
rm -f "$OPS_STATE_DIR/deploy-frozen.json"

note "proven live identity skips silently even when directory timestamps are old"
reset_scenario live
start_lock_owner live
touch -t 200001010000 "$DEPLOY_LOCK"
run_watchdog
assert_eq "$(lock_state)" LIVE
assert_eq "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(v.skipped))' "$WATCHDOG_STATE_DIR/status.json")" true
assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" 0
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" 0
assert_lock_retained
assert_failure bash -c '
  set -eu
  . "$1"
  LOCK_TIMEOUT_SEC=1
  release_lock "$2"
' _ "$COMMON" "$DEPLOY_LOCK"
assert_lock_retained
stop_lock_owner

note "concurrent stale reclaimers cannot delete the newly live winning owner"
reset_scenario concurrent-reclaim
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
launch_competing_owner contender-a
CONTENDER_A_PID=$COMPETING_PID
launch_competing_owner contender-b
CONTENDER_B_PID=$COMPETING_PID
attempt=0
while [ ! -e "$TEST_TMP/contender-a-ready" ] && [ ! -e "$TEST_TMP/contender-b-ready" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 200 ] || fail_test "timed out waiting for the winning reclaimer"
  sleep 0.05
done
sleep 2
if [ -e "$TEST_TMP/contender-a-ready" ] && [ -e "$TEST_TMP/contender-b-ready" ]; then
  fail_test "both reclaimers acquired the same live lock"
fi
pass_assertion
run_watchdog
assert_eq "$(lock_state)" LIVE
assert_lock_retained
if [ -e "$TEST_TMP/contender-a-ready" ]; then
  WINNER_PID=$CONTENDER_A_PID
  LOSER_PID=$CONTENDER_B_PID
  WINNER_STOP="$TEST_TMP/contender-a-stop"
  LOSER_READY="$TEST_TMP/contender-b-ready"
  LOSER_STOP="$TEST_TMP/contender-b-stop"
else
  WINNER_PID=$CONTENDER_B_PID
  LOSER_PID=$CONTENDER_A_PID
  WINNER_STOP="$TEST_TMP/contender-b-stop"
  LOSER_READY="$TEST_TMP/contender-a-ready"
  LOSER_STOP="$TEST_TMP/contender-a-stop"
fi
: > "$WINNER_STOP"
wait "$WINNER_PID"
forget_owner_pid "$WINNER_PID"
attempt=0
while [ ! -e "$LOSER_READY" ]; do
  kill -0 "$LOSER_PID" 2>/dev/null || fail_test "waiting reclaimer exited before acquiring released lock"
  attempt=$((attempt + 1))
  [ "$attempt" -lt 200 ] || fail_test "waiting reclaimer never acquired the released lock"
  sleep 0.05
done
pass_assertion
: > "$LOSER_STOP"
wait "$LOSER_PID"
forget_owner_pid "$LOSER_PID"

note "an orphaned mutation guard is loud, age-gated, and recoverable"
reset_scenario orphaned-mutation
mkdir -p "${DEPLOY_LOCK}.mutation"
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_eq "$(lock_reason)" ORPHANED_MUTATION_GUARD
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
export LOCK_OWNER_GRACE_SEC=1
rm -rf "${DEPLOY_LOCK}.mutation"
mkdir -p "${DEPLOY_LOCK}.mutation"
assert_failure bash -c '
  set -eu
  . "$1"
  LOCK_TIMEOUT_SEC=0
  acquire_lock "$2"
' _ "$COMMON" "$DEPLOY_LOCK"
[ -d "${DEPLOY_LOCK}.mutation" ] || fail_test "fresh legacy guard was retired inside grace"
pass_assertion
sleep 1
launch_competing_owner orphan-contender-a
ORPHAN_A_PID=$COMPETING_PID
launch_competing_owner orphan-contender-b
ORPHAN_B_PID=$COMPETING_PID
attempt=0
while [ ! -e "$TEST_TMP/orphan-contender-a-ready" ] && [ ! -e "$TEST_TMP/orphan-contender-b-ready" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 200 ] || fail_test "orphaned mutation guard was not recovered"
  sleep 0.05
done
sleep 2
if [ -e "$TEST_TMP/orphan-contender-a-ready" ] && [ -e "$TEST_TMP/orphan-contender-b-ready" ]; then
  fail_test "both orphan-guard contenders acquired the same live lock"
fi
pass_assertion
run_watchdog
assert_eq "$(lock_state)" LIVE
assert_lock_retained
if [ -e "$TEST_TMP/orphan-contender-a-ready" ]; then
  ORPHAN_WINNER_PID=$ORPHAN_A_PID
  ORPHAN_LOSER_PID=$ORPHAN_B_PID
  ORPHAN_WINNER_STOP="$TEST_TMP/orphan-contender-a-stop"
  ORPHAN_LOSER_READY="$TEST_TMP/orphan-contender-b-ready"
  ORPHAN_LOSER_STOP="$TEST_TMP/orphan-contender-b-stop"
else
  ORPHAN_WINNER_PID=$ORPHAN_B_PID
  ORPHAN_LOSER_PID=$ORPHAN_A_PID
  ORPHAN_WINNER_STOP="$TEST_TMP/orphan-contender-b-stop"
  ORPHAN_LOSER_READY="$TEST_TMP/orphan-contender-a-ready"
  ORPHAN_LOSER_STOP="$TEST_TMP/orphan-contender-a-stop"
fi
: > "$ORPHAN_WINNER_STOP"
wait "$ORPHAN_WINNER_PID"
forget_owner_pid "$ORPHAN_WINNER_PID"
attempt=0
while [ ! -e "$ORPHAN_LOSER_READY" ]; do
  kill -0 "$ORPHAN_LOSER_PID" 2>/dev/null \
    || fail_test "waiting orphan-guard contender exited before handoff"
  attempt=$((attempt + 1))
  [ "$attempt" -lt 200 ] || fail_test "orphan-guard contender never acquired after handoff"
  sleep 0.05
done
pass_assertion
: > "$ORPHAN_LOSER_STOP"
wait "$ORPHAN_LOSER_PID"
forget_owner_pid "$ORPHAN_LOSER_PID"
[ ! -e "$DEPLOY_LOCK" ] || fail_test "orphan-guard handoff left the canonical lock"
pass_assertion
[ ! -e "${DEPLOY_LOCK}.mutation" ] || fail_test "orphan mutation guard survived recovery"
pass_assertion
if find "$(dirname "$DEPLOY_LOCK")" -maxdepth 1 -type d \
  -name "$(basename "$DEPLOY_LOCK").claim.*" -print -quit | grep -q .; then
  fail_test "orphan-guard handoff left a generation claim"
fi
pass_assertion
export LOCK_OWNER_GRACE_SEC=5

note "a dead crash claim is observable and recovered by the next acquirer"
reset_scenario dead-generation-claim
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
CLAIM_TOKEN="$(bash -c '. "$1"; _lock_owner_tool token "$2" ""' _ "$COMMON" "$DEPLOY_LOCK")"
CLAIM_PATH="${DEPLOY_LOCK}.claim.$(printf '%s' "$CLAIM_TOKEN" | tr : -)"
mv "$DEPLOY_LOCK" "$CLAIM_PATH"
run_watchdog
assert_eq "$(lock_state)" DEAD
assert_eq "$(lock_reason)" MUTATION_CLAIM_OWNER_NOT_RUNNING
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_DEAD'
assert_checks_continued
[ -d "$CLAIM_PATH" ] || fail_test "watchdog mutated a dead crash claim"
pass_assertion
start_lock_owner dead-claim-recovery
run_watchdog
assert_eq "$(lock_state)" LIVE
assert_lock_retained
stop_lock_owner
[ ! -e "$CLAIM_PATH" ] || fail_test "dead crash claim survived successful handoff"
pass_assertion

note "a live claim blocks contenders until its exact owner completes release"
reset_scenario live-generation-claim
start_lock_owner live-claim-release
CLAIM_TOKEN="$(bash -c '. "$1"; _lock_owner_tool token "$2" ""' _ "$COMMON" "$DEPLOY_LOCK")"
CLAIM_PATH="${DEPLOY_LOCK}.claim.$(printf '%s' "$CLAIM_TOKEN" | tr : -)"
mv "$DEPLOY_LOCK" "$CLAIM_PATH"
run_watchdog
assert_eq "$(lock_state)" LIVE
assert_eq "$(lock_reason)" MUTATION_CLAIM_OWNER_IDENTITY_MATCH
[ ! -e "$DEPLOY_LOCK" ] || fail_test "watchdog restored the claimed live generation"
pass_assertion
[ -d "$CLAIM_PATH" ] || fail_test "watchdog mutated the claimed live generation"
pass_assertion
launch_competing_owner live-claim-contender
LIVE_CLAIM_CONTENDER_PID=$COMPETING_PID
sleep 2
[ ! -e "$TEST_TMP/live-claim-contender-ready" ] \
  || fail_test "contender acquired while a proven live claim remained"
pass_assertion
stop_lock_owner
[ ! -e "$CLAIM_PATH" ] || fail_test "exact owner left its live release claim"
pass_assertion
attempt=0
while [ ! -e "$TEST_TMP/live-claim-contender-ready" ]; do
  kill -0 "$LIVE_CLAIM_CONTENDER_PID" 2>/dev/null \
    || fail_test "live-claim contender exited before owner handoff"
  attempt=$((attempt + 1))
  [ "$attempt" -lt 200 ] || fail_test "live-claim contender never acquired after owner release"
  sleep 0.05
done
pass_assertion
: > "$TEST_TMP/live-claim-contender-stop"
wait "$LIVE_CLAIM_CONTENDER_PID"
forget_owner_pid "$LIVE_CLAIM_CONTENDER_PID"
[ ! -e "$DEPLOY_LOCK" ] || fail_test "live-claim handoff left the canonical lock"
pass_assertion
if find "$(dirname "$DEPLOY_LOCK")" -maxdepth 1 -type d \
  -name "$(basename "$DEPLOY_LOCK").claim.*" -print -quit | grep -q .; then
  fail_test "live-claim handoff left a generation claim"
fi
pass_assertion

note "an incomplete crash claim is loud and fails closed"
reset_scenario incomplete-generation-claim
mkdir -p "$DEPLOY_LOCK"
CLAIM_TOKEN="$(bash -c '. "$1"; _lock_owner_tool token "$2" ""' _ "$COMMON" "$DEPLOY_LOCK")"
CLAIM_PATH="${DEPLOY_LOCK}.claim.$(printf '%s' "$CLAIM_TOKEN" | tr : -)"
mv "$DEPLOY_LOCK" "$CLAIM_PATH"
export LOCK_OWNER_GRACE_SEC=0
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_eq "$(lock_reason)" MUTATION_CLAIM_PID_MISSING
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
assert_failure bash -c '
  set -eu
  . "$1"
  LOCK_TIMEOUT_SEC=0
  LOCK_OWNER_GRACE_SEC=0
  acquire_lock "$2"
' _ "$COMMON" "$DEPLOY_LOCK"
[ -d "$CLAIM_PATH" ] || fail_test "incomplete crash claim was guessed away"
pass_assertion
export LOCK_OWNER_GRACE_SEC=5

note "a recycled live PID with mismatched start identity is stale and cannot suppress checks"
reset_scenario stale
start_lock_owner stale
cp "$DEPLOY_LOCK/owner.json" "$TEST_TMP/stale-owner-original.json"
node -e '
  const crypto=require("crypto"), fs=require("fs"), path=process.argv[1];
  const owner=JSON.parse(fs.readFileSync(path,"utf8"));
  owner.startIdentitySha256="0".repeat(64);
  owner.identitySha256=crypto.createHash("sha256").update(
    `${owner.identityKind}\0${owner.bootIdentitySha256}\0${owner.startIdentitySha256}`
  ).digest("hex");
  fs.writeFileSync(path,`${JSON.stringify(owner)}\n`);
' "$DEPLOY_LOCK/owner.json"
run_watchdog
assert_eq "$(lock_state)" STALE
assert_eq "$(lock_reason)" OWNER_IDENTITY_MISMATCH
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_STALE'
assert_checks_continued
assert_lock_retained
cp "$TEST_TMP/stale-owner-original.json" "$DEPLOY_LOCK/owner.json"
stop_lock_owner

note "fresh unpublished lock gets bounded acquisition grace; aged missing PID is malformed"
reset_scenario initializing
mkdir -p "$DEPLOY_LOCK"
run_watchdog
assert_eq "$(lock_state)" INITIALIZING
assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" 0
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" 0
assert_lock_retained
export LOCK_OWNER_GRACE_SEC=0
: > "$MOCK_ALERT_LOG"
: > "$MOCK_SYSTEMCTL_LOG"
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_eq "$(lock_reason)" PID_MISSING
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
assert_lock_retained
export LOCK_OWNER_GRACE_SEC=5

check_malformed_pid() {
  local name="$1" content="$2"
  reset_scenario "$name"
  mkdir -p "$DEPLOY_LOCK"
  printf '%b' "$content" > "$DEPLOY_LOCK/pid"
  run_watchdog
  assert_eq "$(lock_state)" MALFORMED
  assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
  assert_checks_continued
  assert_lock_retained
}

note "malformed PID bytes are bounded, canonical, and never treated as an owner"
check_malformed_pid empty ''
check_malformed_pid alpha 'abc\n'
check_malformed_pid multiline '12\n34\n'
check_malformed_pid zero '0\n'
check_malformed_pid negative '-1\n'
check_malformed_pid leading-zero '00012\n'
reset_scenario oversized
mkdir -p "$DEPLOY_LOCK"
node -e 'require("fs").writeFileSync(process.argv[1],"9".repeat(1024))' "$DEPLOY_LOCK/pid"
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
assert_lock_retained

note "symlink and FIFO PID paths are rejected without following or blocking"
reset_scenario symlink
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$TEST_TMP/pid-target"
ln -s "$TEST_TMP/pid-target" "$DEPLOY_LOCK/pid"
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
assert_lock_retained
reset_scenario fifo
mkdir -p "$DEPLOY_LOCK"
mkfifo "$DEPLOY_LOCK/pid"
run_watchdog
assert_eq "$(lock_state)" MALFORMED
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_MALFORMED'
assert_checks_continued
assert_lock_retained

note "live but unverifiable legacy owner is loud and fails closed without deleting the lock"
reset_scenario unknown
sleep 30 &
LEGACY_PID=$!
OWNER_PIDS="$OWNER_PIDS $LEGACY_PID"
mkdir -p "$DEPLOY_LOCK"
printf '%s\n' "$LEGACY_PID" > "$DEPLOY_LOCK/pid"
export LOCK_OWNER_GRACE_SEC=0
run_watchdog
assert_eq "$(lock_state)" UNKNOWN
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_UNVERIFIED'
assert_eq "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(v.skipped))' "$WATCHDOG_STATE_DIR/status.json")" true
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" 0
assert_lock_retained
export LOCK_OWNER_GRACE_SEC=5
kill "$LEGACY_PID" 2>/dev/null || true
wait "$LEGACY_PID" 2>/dev/null || true
forget_owner_pid "$LEGACY_PID"

note "invalid grace is fail-closed without aborting status publication"
reset_scenario invalid-grace
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
export LOCK_OWNER_GRACE_SEC=008
run_watchdog
assert_eq "$(lock_state)" UNKNOWN
assert_eq "$(lock_reason)" CLASSIFIER_FAILURE
assert_contains "$(cat "$MOCK_ALERT_LOG")" 'critical DEPLOY_LOCK_UNVERIFIED'
assert_lock_retained
export LOCK_OWNER_GRACE_SEC=5

note "external alert failure or hang cannot erase local evidence or later checks"
reset_scenario local-alert
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
export ALERT_CMD=/usr/bin/false
run_watchdog
assert_eq "$(lock_state)" DEAD
assert_contains "$(cat "$WATCHDOG_STATE_DIR/alerts.jsonl")" '"code":"DEPLOY_LOCK_DEAD"'
assert_checks_continued
assert_lock_retained

reset_scenario hanging-alert
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
HANGING_ALERT="$TEST_TMP/hanging-alert.sh"
printf '%s\n' '#!/usr/bin/env bash' \
  'sleep 30 &' \
  'printf "%s\n" "$!" > "${HANG_CHILD_PID_FILE:?}"' \
  'wait' > "$HANGING_ALERT"
chmod 700 "$HANGING_ALERT"
export ALERT_CMD="$HANGING_ALERT"
export ALERT_TIMEOUT_SEC=1
export HANG_CHILD_PID_FILE="$TEST_TMP/hanging-alert-child.pid"
STARTED_AT_MS="$("$NODE" -e 'process.stdout.write(String(Date.now()))')"
run_watchdog
ELAPSED_MS=$(( $("$NODE" -e 'process.stdout.write(String(Date.now()))') - STARTED_AT_MS ))
[ "$ELAPSED_MS" -le 6000 ] \
  || fail_test "hanging alert hook exceeded its bounded watchdog allowance"
pass_assertion
assert_eq "$(lock_state)" DEAD
assert_contains "$(cat "$WATCHDOG_STATE_DIR/alerts.jsonl")" '"code":"DEPLOY_LOCK_DEAD"'
assert_checks_continued
assert_lock_retained
assert_process_gone "$(cat "$HANG_CHILD_PID_FILE")"

note "successful alert hook cannot orphan a background descendant"
reset_scenario exiting-alert
mkdir -p "$DEPLOY_LOCK"
printf '999999\n' > "$DEPLOY_LOCK/pid"
EXITING_ALERT="$TEST_TMP/exiting-alert.sh"
printf '%s\n' '#!/usr/bin/env bash' \
  'sleep 30 &' \
  'printf "%s\n" "$!" > "${EXIT_CHILD_PID_FILE:?}"' \
  'exit 0' > "$EXITING_ALERT"
chmod 700 "$EXITING_ALERT"
export ALERT_CMD="$EXITING_ALERT"
export EXIT_CHILD_PID_FILE="$TEST_TMP/exiting-alert-child.pid"
run_watchdog
assert_process_gone "$(cat "$EXIT_CHILD_PID_FILE")"
assert_contains "$(cat "$WATCHDOG_STATE_DIR/alerts.jsonl")" '"code":"DEPLOY_LOCK_DEAD"'
assert_checks_continued
assert_lock_retained

finish
