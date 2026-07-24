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
