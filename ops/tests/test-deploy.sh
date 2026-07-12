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

finish
