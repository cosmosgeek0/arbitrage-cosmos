#!/usr/bin/env bash
# ops/tests/test-deploy.sh — full deploy lifecycle in a local sandbox.
#
# A fake loopback app serves health from $CURRENT_LINK/runtime-behavior.env
# (re-read per request), so an atomic symlink switch observably changes the
# served release. systemctl is mocked; no systemd, no network beyond loopback.
. "$(dirname "$0")/helpers.sh"
. "$BIN/common.sh"

export COSMOS_ROOT="$SANDBOX/opt"
export RELEASES_DIR="$COSMOS_ROOT/releases"
export CURRENT_LINK="$COSMOS_ROOT/current"
export PREVIOUS_LINK="$COSMOS_ROOT/previous"
export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export APP_UNIT=cosmos-app.service
APP_PORT="$(pick_port)"
PROBE_PORT="$(pick_port)"
export PROBE_PORT
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
export READINESS_GATE_PATHS="/health/live /health/ready"
export POST_SWITCH_GATE_PATHS="/health/live /health/ready"
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
# Probe boots the fake app against the candidate's probe-behavior.env.
export PROBE_CMD='BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node '"$FIXTURES"'/fake-app.mjs'

DEPLOY="$BIN/deploy.sh"
ROLLBACK="$BIN/rollback.sh"
MAKE_RELEASE="$FIXTURES/make-release.sh"
SRC="$SANDBOX/src"
JOURNAL="$DATA_DIR/journal-compat.json"

# One long-lived fake app on the production port; behavior follows `current`.
start_fake_app "$APP_PORT" "$CURRENT_LINK/runtime-behavior.env" >/dev/null

release_served() { curl -fsS "http://127.0.0.1:$APP_PORT/release" | node -e '
  let d = ""; process.stdin.on("data", (c) => d += c);
  process.stdin.on("end", () => process.stdout.write(JSON.parse(d).releaseId));
'; }

assert_no_path_entry() { # path label
  ASSERTIONS=$((ASSERTIONS + 1))
  if [ -e "$1" ] || [ -L "$1" ]; then
    fail "${2:-expected absent path entry}: $1"
  fi
}

assert_empty_file() { # path label
  ASSERTIONS=$((ASSERTIONS + 1))
  [ ! -s "$1" ] || fail "${2:-expected empty file}: $1"
}

note "1. first deploy: happy path, immutability, journal, restart, gate"
bash "$MAKE_RELEASE" "$SRC/A" rel-A 1 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/A"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-A" "current after A"
assert_eq "$(release_served)" rel-A "served release after A"
assert_grep 'restart cosmos-app.service' "$MOCK_SYSTEMCTL_LOG" "app restarted"
assert_eq "$(json_get "$JOURNAL" dataSchema)" 1 "journal dataSchema"
assert_eq "$(json_get "$JOURNAL" rollbackFloor)" 0 "journal rollbackFloor"
assert_grep '"result":"SUCCESS"' "$OPS_STATE_DIR/deploy-log.jsonl" "deploy logged"
assert_rc 1 touch "$RELEASES_DIR/rel-A/tamper" 2>/dev/null
assert_no_file "$PREVIOUS_LINK"

note "2. probe gate failure: candidate rejected BEFORE switch, current untouched"
bash "$MAKE_RELEASE" "$SRC/B" rel-B 1 false 1 1 1 0   # probe-ready fails
assert_rc 1 bash "$DEPLOY" --release "$SRC/B"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-A" "current still A"
assert_eq "$(release_served)" rel-A "served release unchanged"
assert_grep '"result":"REJECTED_BY_PROBE"' "$OPS_STATE_DIR/deploy-log.jsonl" "probe rejection logged"

note "3. second deploy: previous link maintained"
bash "$MAKE_RELEASE" "$SRC/C" rel-C 1 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/C"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "current after C"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-A" "previous after C"

note "4. post-switch failure with exposure=NONE pre-money: automatic rollback"
bash "$MAKE_RELEASE" "$SRC/D" rel-D 1 false 0 1   # runtime live fails, probe fine
assert_rc 3 bash "$DEPLOY" --release "$SRC/D"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "auto-rolled back to C"
assert_eq "$(release_served)" rel-C "served release after auto-rollback"
assert_grep '"result":"AUTO_ROLLBACK"' "$OPS_STATE_DIR/deploy-log.jsonl" "auto-rollback logged"
assert_no_file "$OPS_STATE_DIR/deploy-frozen.json"

note "5. post-switch failure with ACTIVE exposure: FREEZE, no rollback"
echo ACTIVE > "$SANDBOX/exposure"
bash "$MAKE_RELEASE" "$SRC/E" rel-E 1 false 0 1
assert_rc 2 bash "$DEPLOY" --release "$SRC/E"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
assert_eq "$(json_get "$OPS_STATE_DIR/deploy-frozen.json" exposure)" ACTIVE "frozen records exposure"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-E" "frozen state preserved (no flip)"
assert_grep 'critical DEPLOY_FROZEN' "$MOCK_ALERT_LOG" "freeze alerted"
# operator recovery: exposure cleared, manual rollback, marker cleared by hand
echo NONE > "$SANDBOX/exposure"
assert_rc 0 bash "$ROLLBACK"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "manual rollback to C"
rm -f "$OPS_STATE_DIR/deploy-frozen.json"

note "6. post-switch failure after money readiness: FREEZE even with exposure=NONE"
mkdir -p "$OPS_STATE_DIR" && touch "$MONEY_READY_MARKER"
bash "$MAKE_RELEASE" "$SRC/F" rel-F 1 false 0 1
assert_rc 2 bash "$DEPLOY" --release "$SRC/F"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
rm -f "$MONEY_READY_MARKER" "$OPS_STATE_DIR/deploy-frozen.json"
assert_rc 0 bash "$ROLLBACK"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "recovered to C"

note "7. concurrent deploy: lock refused quickly"
mkdir -p "$OPS_STATE_DIR/locks/deploy.lock"
echo "$$" > "$OPS_STATE_DIR/locks/deploy.lock/pid"
assert_rc 4 bash "$DEPLOY" --release "$SRC/A"
rm -rf "$OPS_STATE_DIR/locks/deploy.lock"

note "8. dirty target: pre-existing release dir refused unless --reinstall"
bash "$MAKE_RELEASE" "$SRC/G" rel-G 1 false
mkdir -p "$RELEASES_DIR/rel-G"
echo garbage > "$RELEASES_DIR/rel-G/leftover"
assert_rc 1 bash "$DEPLOY" --release "$SRC/G"
assert_rc 0 bash "$DEPLOY" --release "$SRC/G" --reinstall
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-G" "current after reinstall"
assert_no_file "$RELEASES_DIR/rel-G/leftover"

note "9. partial/invalid release sources refused"
mkdir -p "$SRC/nojson/server/dist" && touch "$SRC/nojson/server/dist/index.js"
assert_rc 1 bash "$DEPLOY" --release "$SRC/nojson"
bash "$MAKE_RELEASE" "$SRC/nodist" rel-nodist 1 false
chmod -R u+w "$SRC/nodist" && rm -rf "$SRC/nodist/server"
assert_rc 1 bash "$DEPLOY" --release "$SRC/nodist"
assert_rc 1 bash "$DEPLOY" --release "$SRC/does-not-exist"

note "10. dirty host: current exists as a real directory -> hard refuse"
mkdir -p "$SANDBOX/opt2/current"
assert_rc 1 env CURRENT_LINK="$SANDBOX/opt2/current" \
  RELEASES_DIR="$SANDBOX/opt2/releases" PREVIOUS_LINK="$SANDBOX/opt2/previous" \
  bash "$DEPLOY" --release "$SRC/A"

note "11. non-rollback barrier recorded; older schema then refused"
bash "$MAKE_RELEASE" "$SRC/H" rel-H 2 true
assert_rc 0 bash "$DEPLOY" --release "$SRC/H"
assert_eq "$(json_get "$JOURNAL" dataSchema)" 2 "journal dataSchema after barrier"
assert_eq "$(json_get "$JOURNAL" rollbackFloor)" 2 "journal rollbackFloor after barrier"
bash "$MAKE_RELEASE" "$SRC/I" rel-I 1 false
assert_rc 1 bash "$DEPLOY" --release "$SRC/I"
assert_grep '"result":"REFUSED_SCHEMA"' "$OPS_STATE_DIR/deploy-log.jsonl" "schema refusal logged"

note "12. stale lock from a crashed deploy (dead owner pid) is reclaimed"
mkdir -p "$OPS_STATE_DIR/locks/deploy.lock"
echo 999999 > "$OPS_STATE_DIR/locks/deploy.lock/pid"
bash "$MAKE_RELEASE" "$SRC/K" rel-K 2 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/K"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-K" "deployed through stale lock"
assert_no_file "$OPS_STATE_DIR/locks/deploy.lock"

note "13. auto-rollback itself failing escalates to FREEZE"
# dirty host: the previous release (rel-K's predecessor is now rel-K itself
# after this deploy) gets deleted from disk while still linked
chmod -R u+w "$RELEASES_DIR/rel-K" && rm -rf "$RELEASES_DIR/rel-K"
bash "$MAKE_RELEASE" "$SRC/J" rel-J 2 false 0 1   # runtime live fails
echo NONE > "$SANDBOX/exposure"
assert_rc 2 bash "$DEPLOY" --release "$SRC/J"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
assert_grep 'AUTOMATIC ROLLBACK ALSO FAILED' "$OPS_STATE_DIR/deploy-frozen.json" "escalation recorded"

note "14. first-host marker refuses every occupied current/previous path before mutation"
bash "$MAKE_RELEASE" "$SRC/FIRST-HOST-GUARD" rel-first-host-guard 1 false

assert_injected_path_unchanged() { # kind path target-or-marker
  local kind="$1" path="$2" witness="$3"
  case "$kind" in
    valid-symlink|dangling-symlink)
      assert_link_target "$path" "$witness" "$kind remains unchanged"
      ;;
    regular-file)
      assert_file "$path"
      assert_eq "$(sed -n '1p' "$path")" "$witness" "regular file remains unchanged"
      ;;
    directory)
      assert_dir "$path"
      assert_file "$path/$witness"
      ;;
    *) fail "unknown injected-path kind: $kind" ;;
  esac
}

run_first_host_occupied_case() { # current|previous kind
  local which="$1" kind="$2"
  local case_id="$which-$kind"
  local case_root="$SANDBOX/first-host-guard/$case_id/root"
  local case_releases="$case_root/releases"
  local case_current="$case_root/current"
  local case_previous="$case_root/previous"
  local case_data="$SANDBOX/first-host-guard/$case_id/data"
  local case_ops="$SANDBOX/first-host-guard/$case_id/ops"
  local case_systemctl="$SANDBOX/first-host-guard/$case_id/systemctl.log"
  local case_probe="$SANDBOX/first-host-guard/$case_id/probe-ran"
  local injected="$case_current" other="$case_previous" witness=""

  mkdir -p "$case_root" "$(dirname "$case_systemctl")"
  : > "$case_systemctl"
  if [ "$which" = previous ]; then
    injected="$case_previous"
    other="$case_current"
  fi
  case "$kind" in
    valid-symlink)
      witness="$case_root/injected-target"
      mkdir -p "$witness"
      ln -s "$witness" "$injected"
      ;;
    dangling-symlink)
      witness="$case_root/missing-target"
      ln -s "$witness" "$injected"
      ;;
    regular-file)
      witness="FIRST_HOST_INJECTED_REGULAR_FILE"
      printf '%s\n' "$witness" > "$injected"
      ;;
    directory)
      witness="FIRST_HOST_INJECTED_DIRECTORY_MARKER"
      mkdir -p "$injected"
      : > "$injected/$witness"
      ;;
    *) fail "unknown first-host occupied-path kind: $kind" ;;
  esac

  assert_rc 1 env \
    COSMOS_ROOT="$case_root" RELEASES_DIR="$case_releases" \
    CURRENT_LINK="$case_current" PREVIOUS_LINK="$case_previous" \
    DATA_DIR="$case_data" OPS_STATE_DIR="$case_ops" \
    MOCK_SYSTEMCTL_LOG="$case_systemctl" \
    GUARD_PROBE_MARKER="$case_probe" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD"
  assert_injected_path_unchanged "$kind" "$injected" "$witness"
  assert_no_path_entry "$other" "uninjected peer link remains absent"
  assert_no_path_entry "$case_releases" "release root is not installed"
  assert_no_path_entry "$case_probe" "probe is not invoked"
  assert_empty_file "$case_systemctl" "systemctl is not invoked"
  assert_no_path_entry "$case_ops/locks/deploy.lock" "deploy lock is cleaned"
}

for first_host_link in current previous; do
  for first_host_kind in valid-symlink dangling-symlink regular-file directory; do
    run_first_host_occupied_case "$first_host_link" "$first_host_kind"
  done
done

note "15. any set marker other than exact 1 refuses before mutation"
run_wrong_first_host_marker_case() { # case-id marker-value
  local case_id="$1" marker_value="$2"
  local case_root="$SANDBOX/first-host-marker/$case_id/root"
  local case_releases="$case_root/releases"
  local case_current="$case_root/current"
  local case_previous="$case_root/previous"
  local case_data="$SANDBOX/first-host-marker/$case_id/data"
  local case_ops="$SANDBOX/first-host-marker/$case_id/ops"
  local case_systemctl="$SANDBOX/first-host-marker/$case_id/systemctl.log"
  local case_probe="$SANDBOX/first-host-marker/$case_id/probe-ran"

  mkdir -p "$case_root" "$(dirname "$case_systemctl")"
  : > "$case_systemctl"
  assert_rc 1 env \
    COSMOS_ROOT="$case_root" RELEASES_DIR="$case_releases" \
    CURRENT_LINK="$case_current" PREVIOUS_LINK="$case_previous" \
    DATA_DIR="$case_data" OPS_STATE_DIR="$case_ops" \
    MOCK_SYSTEMCTL_LOG="$case_systemctl" \
    GUARD_PROBE_MARKER="$case_probe" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT="$marker_value" \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD"
  assert_no_path_entry "$case_current" "wrong marker leaves current absent"
  assert_no_path_entry "$case_previous" "wrong marker leaves previous absent"
  assert_no_path_entry "$case_releases" "wrong marker does not install release"
  assert_no_path_entry "$case_probe" "wrong marker does not invoke probe"
  assert_empty_file "$case_systemctl" "wrong marker does not invoke systemctl"
  assert_no_path_entry "$case_ops/locks/deploy.lock" "wrong-marker lock is cleaned"
}

run_wrong_first_host_marker_case empty ""
run_wrong_first_host_marker_case zero 0
run_wrong_first_host_marker_case leading-zero 01
run_wrong_first_host_marker_case word true

note "16. deterministic TOCTOU: path created while donor waits for lock is refused"
RACE_ROOT="$SANDBOX/first-host-race/root"
RACE_RELEASES="$RACE_ROOT/releases"
RACE_CURRENT="$RACE_ROOT/current"
RACE_PREVIOUS="$RACE_ROOT/previous"
RACE_DATA="$SANDBOX/first-host-race/data"
RACE_OPS="$SANDBOX/first-host-race/ops"
RACE_LOCK="$RACE_OPS/locks/deploy.lock"
RACE_SYSTEMCTL_LOG="$SANDBOX/first-host-race/systemctl.log"
RACE_PROBE_MARKER="$SANDBOX/first-host-race/probe-ran"
RACE_LOCK_ATTEMPT="$SANDBOX/first-host-race/lock-attempt"
RACE_RC_FILE="$SANDBOX/first-host-race/deploy.rc"
RACE_OUTPUT="$SANDBOX/first-host-race/deploy.log"
RACE_NODE_WRAPPER="$SANDBOX/first-host-race/node-wrapper.sh"
RACE_REAL_NODE="$(command -v node)"
mkdir -p "$RACE_ROOT" "$(dirname "$RACE_SYSTEMCTL_LOG")"
: > "$RACE_SYSTEMCTL_LOG"
apply_race_node_wrapper() {
  local wrapper="$1"
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -u'
    printf '%s\n' 'if [ "${1:-}" = - ] && [ "${2:-}" = recover ] && [ "${3:-}" = "$RACE_LOCK" ]; then'
    printf '%s\n' '  : > "$RACE_LOCK_ATTEMPT"'
    printf '%s\n' 'fi'
    printf '%s\n' 'exec "$RACE_REAL_NODE" "$@"'
  } > "$wrapper"
  chmod +x "$wrapper"
}
apply_race_node_wrapper "$RACE_NODE_WRAPPER"
acquire_lock "$RACE_LOCK" || fail "test could not acquire deterministic race lock"
(
  set +e
  env \
    COSMOS_ROOT="$RACE_ROOT" RELEASES_DIR="$RACE_RELEASES" \
    CURRENT_LINK="$RACE_CURRENT" PREVIOUS_LINK="$RACE_PREVIOUS" \
    DATA_DIR="$RACE_DATA" OPS_STATE_DIR="$RACE_OPS" DEPLOY_LOCK="$RACE_LOCK" \
    MOCK_SYSTEMCTL_LOG="$RACE_SYSTEMCTL_LOG" \
    GUARD_PROBE_MARKER="$RACE_PROBE_MARKER" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
    NODE="$RACE_NODE_WRAPPER" RACE_LOCK="$RACE_LOCK" \
    RACE_LOCK_ATTEMPT="$RACE_LOCK_ATTEMPT" RACE_REAL_NODE="$RACE_REAL_NODE" \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD" \
    >"$RACE_OUTPUT" 2>&1
  printf '%s\n' "$?" > "$RACE_RC_FILE"
) &
RACE_DEPLOY_PID=$!
register_pid "$RACE_DEPLOY_PID"
RACE_DEADLINE=$(( $(date -u +%s) + 10 ))
while [ ! -f "$RACE_LOCK_ATTEMPT" ]; do
  kill -0 "$RACE_DEPLOY_PID" 2>/dev/null \
    || fail "racing deploy exited before attempting the held lock"
  [ "$(date -u +%s)" -lt "$RACE_DEADLINE" ] \
    || fail "timeout waiting for racing deploy to attempt the held lock"
  sleep 0.1
done
mkdir -p "$RACE_ROOT/injected-current-target"
ln -s "$RACE_ROOT/injected-current-target" "$RACE_CURRENT"
release_lock "$RACE_LOCK" || fail "test could not release deterministic race lock"
wait "$RACE_DEPLOY_PID" || true
assert_file "$RACE_RC_FILE"
assert_eq "$(sed -n '1p' "$RACE_RC_FILE")" 1 "racing deploy refuses injected current"
assert_link_target "$RACE_CURRENT" "$RACE_ROOT/injected-current-target" "racing current remains unchanged"
assert_no_path_entry "$RACE_PREVIOUS" "racing deploy leaves previous absent"
assert_no_path_entry "$RACE_RELEASES" "racing deploy does not install release"
assert_no_path_entry "$RACE_PROBE_MARKER" "racing deploy does not invoke probe"
assert_empty_file "$RACE_SYSTEMCTL_LOG" "racing deploy does not invoke systemctl"
assert_no_path_entry "$RACE_LOCK" "racing deploy lock is cleaned"

note "17. clean first-host post-switch failure freezes without inventing rollback"
FIRST_FAIL_ROOT="$SANDBOX/first-host-post-switch/root"
FIRST_FAIL_RELEASES="$FIRST_FAIL_ROOT/releases"
FIRST_FAIL_CURRENT="$FIRST_FAIL_ROOT/current"
FIRST_FAIL_PREVIOUS="$FIRST_FAIL_ROOT/previous"
FIRST_FAIL_DATA="$SANDBOX/first-host-post-switch/data"
FIRST_FAIL_OPS="$SANDBOX/first-host-post-switch/ops"
FIRST_FAIL_SYSTEMCTL_LOG="$SANDBOX/first-host-post-switch/systemctl.log"
FIRST_FAIL_ALERT_LOG="$SANDBOX/first-host-post-switch/alerts.log"
FIRST_FAIL_EXPOSURE="$SANDBOX/first-host-post-switch/exposure"
FIRST_FAIL_PROBE_MARKER="$SANDBOX/first-host-post-switch/probe-passed"
FIRST_FAIL_PORT="$(pick_port)"
mkdir -p "$FIRST_FAIL_ROOT" "$(dirname "$FIRST_FAIL_SYSTEMCTL_LOG")"
: > "$FIRST_FAIL_SYSTEMCTL_LOG"
: > "$FIRST_FAIL_ALERT_LOG"
printf '%s\n' NONE > "$FIRST_FAIL_EXPOSURE"
bash "$MAKE_RELEASE" "$SRC/FIRST-HOST-POST-SWITCH" rel-first-host-post-switch 1 false 0 1 1 1
start_fake_app "$FIRST_FAIL_PORT" "$FIRST_FAIL_CURRENT/runtime-behavior.env" >/dev/null
FIRST_FAIL_PROBE_CMD=': > "$FIRST_FAIL_PROBE_MARKER"; BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node '"$FIXTURES"'/fake-app.mjs'
assert_rc 2 env \
  COSMOS_ROOT="$FIRST_FAIL_ROOT" RELEASES_DIR="$FIRST_FAIL_RELEASES" \
  CURRENT_LINK="$FIRST_FAIL_CURRENT" PREVIOUS_LINK="$FIRST_FAIL_PREVIOUS" \
  DATA_DIR="$FIRST_FAIL_DATA" OPS_STATE_DIR="$FIRST_FAIL_OPS" \
  DEPLOY_LOCK="$FIRST_FAIL_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$FIRST_FAIL_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$FIRST_FAIL_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$FIRST_FAIL_OPS/money-ready" \
  HEALTH_BASE="http://127.0.0.1:$FIRST_FAIL_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$FIRST_FAIL_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$FIRST_FAIL_ALERT_LOG" \
  EXPOSURE_CMD="cat $FIRST_FAIL_EXPOSURE" \
  FIRST_FAIL_PROBE_MARKER="$FIRST_FAIL_PROBE_MARKER" \
  PROBE_CMD="$FIRST_FAIL_PROBE_CMD" \
  I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
  bash "$DEPLOY" --release "$SRC/FIRST-HOST-POST-SWITCH"
assert_file "$FIRST_FAIL_PROBE_MARKER"
assert_link_target "$FIRST_FAIL_CURRENT" "$FIRST_FAIL_RELEASES/rel-first-host-post-switch" "failed first-host candidate remains current"
assert_no_path_entry "$FIRST_FAIL_PREVIOUS" "failed first-host has no rollback target"
assert_file "$FIRST_FAIL_OPS/deploy-frozen.json"
assert_grep 'critical DEPLOY_FROZEN' "$FIRST_FAIL_ALERT_LOG" "first-host freeze alerted"
assert_grep 'restart cosmos-app.service' "$FIRST_FAIL_SYSTEMCTL_LOG" "first-host candidate restarted"
assert_grep '"result":"FROZEN"' "$FIRST_FAIL_OPS/deploy-log.jsonl" "first-host freeze logged"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FIRST_FAIL_OPS/deploy-log.jsonl" "first-host never auto-rolls back"
assert_no_path_entry "$FIRST_FAIL_OPS/locks/deploy.lock" "first-host failure lock is cleaned"

finish
