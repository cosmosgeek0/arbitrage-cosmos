#!/usr/bin/env bash
# ops/tests/test-watchdog.sh — external watchdog policy.
#
# Proves: bounded restarts on live failure, alert-only on ready failure
# (including TRADE_UNSAFE — the watchdog never takes trading action),
# tunnel supervision, deploy-lock deference, frozen-marker nagging, and
# backup staleness alarms. All health traffic is loopback; systemctl is a mock.
. "$(dirname "$0")/helpers.sh"
. "$BIN/common.sh"

export OPS_STATE_DIR="$SANDBOX/ops"
export APP_UNIT=df32-fixture-app.service
export TUNNEL_UNIT=df32-fixture-tunnel.service
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
export MOCK_ACTIVE_UNITS="$SANDBOX/active-units"
export ALERT_CMD="$FIXTURES/mock-alert.sh"
export MOCK_ALERT_LOG="$SANDBOX/alerts.log"
export LIVE_FAIL_THRESHOLD=2
export RESTART_WINDOW_SEC=3600
export MAX_RESTARTS_PER_WINDOW=1
export BACKUP_DIR=""

WATCHDOG="$BIN/watchdog.sh"
APP_PORT="$(pick_port)"
DEAD_PORT="$(pick_port)"

reset_scenario() { # state_dir
  export WATCHDOG_STATE_DIR="$SANDBOX/$1"
  : > "$MOCK_SYSTEMCTL_LOG"
  : > "$MOCK_ALERT_LOG"
}
restart_count() { grep -c "restart $APP_UNIT" "$MOCK_SYSTEMCTL_LOG" || true; }

printf '%s\n%s\n' "$APP_UNIT" "$TUNNEL_UNIT" > "$MOCK_ACTIVE_UNITS"
start_fake_app "$APP_PORT" "$SANDBOX/behavior.env" >/dev/null
printf 'LIVE_OK=1\nREADY_OK=1\n' > "$SANDBOX/behavior.env"

note "1. healthy pass: no alerts, no restarts, status recorded"
reset_scenario wd1
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
assert_rc 0 bash "$WATCHDOG"
assert_eq "$(restart_count)" 0 "no restart"
assert_eq "$(wc -l < "$MOCK_ALERT_LOG" | tr -d ' ')" 0 "no alerts"
assert_eq "$(json_get "$WATCHDOG_STATE_DIR/status.json" live)" true "status live"
assert_eq "$(json_get "$WATCHDOG_STATE_DIR/status.json" ready)" true "status ready"
assert_eq "$(json_get "$WATCHDOG_STATE_DIR/status.json" tunnel)" true "status tunnel"

note "2. live down: restart only after threshold, then budget exhausted"
reset_scenario wd2
export HEALTH_BASE="http://127.0.0.1:$DEAD_PORT"
assert_rc 0 bash "$WATCHDOG"                       # streak 1: no action yet
assert_eq "$(restart_count)" 0 "below threshold"
assert_rc 0 bash "$WATCHDOG"                       # streak 2: restart
assert_eq "$(restart_count)" 1 "restarted at threshold"
assert_grep 'critical APP_RESTARTED' "$MOCK_ALERT_LOG" "restart alerted"
assert_rc 0 bash "$WATCHDOG"                       # streak rebuilds
assert_rc 0 bash "$WATCHDOG"                       # threshold again, budget spent
assert_eq "$(restart_count)" 1 "budget enforced: still one restart"
assert_grep 'critical RESTART_BUDGET_EXHAUSTED' "$MOCK_ALERT_LOG" "budget alerted"

note "3. ready down (TRADE_UNSAFE): alert only, NEVER restart"
reset_scenario wd3
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
printf 'LIVE_OK=1\nREADY_OK=0\nREADY_DETAIL=TRADE_UNSAFE\n' > "$SANDBOX/behavior.env"
assert_rc 0 bash "$WATCHDOG"
assert_rc 0 bash "$WATCHDOG"
assert_rc 0 bash "$WATCHDOG"
assert_eq "$(restart_count)" 0 "no restart on degraded readiness"
assert_grep 'warning APP_NOT_READY' "$MOCK_ALERT_LOG" "degradation alerted"
assert_eq "$(json_get "$WATCHDOG_STATE_DIR/status.json" ready)" false "status ready false"
printf 'LIVE_OK=1\nREADY_OK=1\n' > "$SANDBOX/behavior.env"

note "4. tunnel down: alert; optional bounded restart"
reset_scenario wd4
echo "$APP_UNIT" > "$MOCK_ACTIVE_UNITS"     # tunnel no longer active
assert_rc 0 bash "$WATCHDOG"
assert_grep 'critical TUNNEL_DOWN' "$MOCK_ALERT_LOG" "tunnel down alerted"
assert_eq "$(grep -c "restart $TUNNEL_UNIT" "$MOCK_SYSTEMCTL_LOG" || true)" 0 "no tunnel restart by default"
WATCHDOG_RESTART_TUNNEL=1 bash "$WATCHDOG"
assert_eq "$(grep -c "restart $TUNNEL_UNIT" "$MOCK_SYSTEMCTL_LOG" || true)" 1 "tunnel restarted when enabled"
printf '%s\n%s\n' "$APP_UNIT" "$TUNNEL_UNIT" > "$MOCK_ACTIVE_UNITS"

note "5. deploy in progress: watchdog stands down entirely"
reset_scenario wd5
mkdir -p "$OPS_STATE_DIR/locks/deploy.lock"
assert_rc 0 bash "$WATCHDOG"
assert_eq "$(json_get "$WATCHDOG_STATE_DIR/status.json" skipped)" true "skipped recorded"
assert_eq "$(wc -l < "$MOCK_ALERT_LOG" | tr -d ' ')" 0 "no alerts while deploying"
rm -rf "$OPS_STATE_DIR/locks/deploy.lock"

note "6. frozen deployment keeps alerting until an operator acts"
reset_scenario wd6
echo '{"reason":"test freeze"}' > "$OPS_STATE_DIR/deploy-frozen.json"
assert_rc 0 bash "$WATCHDOG"
assert_grep 'critical DEPLOY_FROZEN' "$MOCK_ALERT_LOG" "frozen nagged"
rm -f "$OPS_STATE_DIR/deploy-frozen.json"

note "7. backup freshness: stale and missing alarms (§23 backup stale)"
reset_scenario wd7
export BACKUP_DIR="$SANDBOX/backups"
mkdir -p "$BACKUP_DIR/20200101T000000Z"
node -e '
  require("fs").writeFileSync(process.argv[1],
    JSON.stringify({ backupId: "20200101T000000Z", createdAtUtc: "2020-01-01T00:00:00Z" }));
' "$BACKUP_DIR/20200101T000000Z/manifest.json"
HOSTILE_INVENTORY_BIN="$SANDBOX/hostile-inventory-bin"
HOSTILE_INVENTORY_WITNESS="$SANDBOX/hostile-inventory-witness"
mkdir "$HOSTILE_INVENTORY_BIN"
for utility in ls grep sort head tail; do
  printf '#!/bin/sh\nprintf invoked >> "%s"\nexit 97\n' \
    "$HOSTILE_INVENTORY_WITNESS" > "$HOSTILE_INVENTORY_BIN/$utility"
  chmod 700 "$HOSTILE_INVENTORY_BIN/$utility"
done
assert_rc 0 env PATH="$HOSTILE_INVENTORY_BIN:/usr/bin:/bin" bash "$WATCHDOG"
assert_no_file "$HOSTILE_INVENTORY_WITNESS"
assert_grep 'warning BACKUP_STALE' "$MOCK_ALERT_LOG" "stale backup alerted"
reset_scenario wd8
export BACKUP_DIR="$SANDBOX/backups-none"
assert_rc 0 bash "$WATCHDOG"
assert_grep 'warning BACKUP_MISSING' "$MOCK_ALERT_LOG" "missing backup alerted"

finish
