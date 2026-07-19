#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

APP_UNIT_FILE="$REPO_ROOT/ops/live/systemd/cosmos-app.service"
WATCHDOG_UNIT="$REPO_ROOT/ops/live/systemd/cosmos-watchdog.service"
BACKUP_UNIT="$REPO_ROOT/ops/live/systemd/cosmos-backup.service"
DRILL_UNIT="$REPO_ROOT/ops/live/systemd/cosmos-restore-drill.service"
COMMON="$REPO_ROOT/ops/live/bin/common.sh"
DEPLOY="$REPO_ROOT/ops/live/bin/deploy.sh"
ROLLBACK="$REPO_ROOT/ops/live/bin/rollback.sh"
WATCHDOG="$REPO_ROOT/ops/live/bin/watchdog.sh"
BACKUP="$REPO_ROOT/ops/live/bin/backup.sh"
DEPLOY_ENV_T="$REPO_ROOT/ops/live/env/cosmos-deploy.env.template"
WATCHDOG_ENV_T="$REPO_ROOT/ops/live/env/cosmos-watchdog.env.template"
BACKUP_ENV_T="$REPO_ROOT/ops/live/env/cosmos-backup.env.template"
APP_ENV_T="$REPO_ROOT/ops/live/env/cosmos-app.env.template"

note "F-017: stop budget covers the drain budget"
assert_contains "$(cat "$APP_UNIT_FILE")" 'TimeoutStopSec=75'

note "Part 4 #11: every oneshot declares an explicit start budget"
assert_contains "$(cat "$WATCHDOG_UNIT")" 'TimeoutStartSec=300'
assert_contains "$(cat "$BACKUP_UNIT")" 'TimeoutStartSec=1800'
assert_contains "$(cat "$DRILL_UNIT")" 'TimeoutStartSec=3600'

note "F-040: scheduled units and alert hooks target the installed donor path"
assert_contains "$(cat "$WATCHDOG_UNIT")" 'ExecStart=/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/watchdog.sh'
assert_contains "$(cat "$BACKUP_UNIT")" 'ExecStart=/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/backup.sh'
assert_contains "$(cat "$DRILL_UNIT")" 'ExecStart=/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/restore-drill.sh'
assert_contains "$(cat "$DEPLOY_ENV_T")" 'ALERT_CMD=/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/alert-log.sh'
assert_contains "$(cat "$WATCHDOG_ENV_T")" 'ALERT_CMD=/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/alert-log.sh'
for f in "$WATCHDOG_UNIT" "$BACKUP_UNIT" "$DRILL_UNIT" "$DEPLOY_ENV_T" "$WATCHDOG_ENV_T"; do
  ASSERTIONS=$((ASSERTIONS + 1))
  if grep -v '^#' "$f" | grep -E '/usr/local/lib/cosmos-ops/bin/' >/dev/null; then
    fail_test "$(basename "$f") still references the never-created flat bin path"
  fi
  pass_assertion
done

note "F-025/F-043: complete require_cmd lists"
assert_contains "$(cat "$DEPLOY")" 'require_cmd "$NODE" "$CURL" "$SYSTEMCTL"'
assert_contains "$(cat "$ROLLBACK")" 'require_cmd "$NODE" "$CURL" "$SYSTEMCTL"'
assert_contains "$(cat "$WATCHDOG")" 'require_cmd "$NODE" "$CURL" "$SYSTEMCTL"'
assert_contains "$(cat "$BACKUP")" 'require_cmd "$NODE" "$SQLITE" tar'

note "F-026: gate_wait refuses an empty gate path list"
assert_contains "$(cat "$COMMON")" 'refusing an empty gate path list'

note "F-027: templates no longer claim only /api/health exists"
assert_eq "$(grep -c 'still exposes only /api/health' "$DEPLOY_ENV_T" || true)" "0"
assert_eq "$(grep -c 'only has /api/health' "$WATCHDOG_ENV_T" || true)" "0"
assert_contains "$(cat "$DEPLOY_ENV_T")" 'never downgrade this gate'

note "F-028: exposure probe failures are legible"
assert_contains "$(cat "$DEPLOY_ENV_T")" 'exposure-from-app.mjs'
assert_eq "$(grep -c 'EXPOSURE_CMD 2>/dev/null' "$COMMON" || true)" "0"

note "Part 4 #5: reset-failed precedes restart; failed restart burns no budget"
assert_contains "$(cat "$WATCHDOG")" 'reset-failed "$APP_UNIT"'
assert_contains "$(cat "$WATCHDOG")" 'if "$SYSTEMCTL" restart "$APP_UNIT"; then'

note "Part 4 #6: json_get distinguishes absent (3) from unreadable (4)"
assert_contains "$(cat "$COMMON")" 'process.exit(4)'
assert_contains "$(cat "$DEPLOY")" 'refusing to assume a zero rollback floor'
assert_contains "$(cat "$ROLLBACK")" 'refusing to assume a zero rollback floor'
printf '{"dataSchema": 2, "rollbackFl' > "$TEST_TMP/truncated.json"
set +e
( . "$COMMON"; json_get "$TEST_TMP/truncated.json" rollbackFloor )
RC=$?
set -e
assert_eq "$RC" "4"
printf '{"a":1}\n' > "$TEST_TMP/present.json"
set +e
( . "$COMMON"; json_get "$TEST_TMP/present.json" missing )
RC=$?
set -e
assert_eq "$RC" "3"

note "Part 4 #7: unreadable streak file fails toward acting"
assert_contains "$(cat "$WATCHDOG")" 'WATCHDOG_STATE_UNREADABLE'

note "F-105/F-106: backup refuses unverifiable counts and quote-hostile paths"
assert_contains "$(cat "$BACKUP")" 'refusing to publish an unverifiable backup'
assert_contains "$(cat "$BACKUP")" 'BACKUP_DIR must not contain quotes'

note "F-044: backups cover the installed configuration"
assert_contains "$(cat "$BACKUP_ENV_T")" 'EVIDENCE_PATHS=/etc/cosmos'

note "F-108: --skip-probe refused on a first deploy; probe failures diagnosed"
assert_contains "$(cat "$DEPLOY")" '--skip-probe is refused on a first deploy'
assert_contains "$(cat "$DEPLOY")" 'probe diagnostic'

note "F-023: default probe boots production-shaped in a closed environment"
assert_contains "$(cat "$DEPLOY")" 'exec env -i PATH=/usr/local/bin:/usr/bin:/bin'
assert_contains "$(cat "$DEPLOY")" 'NODE_ENV=production DATA_DIR_LOGICAL_LEASE_ROOT="$probe_leases"'

note "F-107: direct deploy.sh is refused against the production root"
assert_contains "$(cat "$DEPLOY")" 'COSMOS_DEPLOY_VIA_I00_WRAPPER'

note "F-035: the app template passes the validator up to placeholders"
assert_contains "$(cat "$APP_ENV_T")" 'EVIDENCE_DIR=/var/lib/cosmos/evidence'
assert_contains "$(cat "$APP_ENV_T")" 'CONTROL_ROOM_OPERATOR_EMAIL=REPLACE_ME_OPERATOR_EMAIL'
OUT="$(node "$I00_ROOT/bin/validate-config.mjs" --env "$REPO_ROOT/ops/live/env/cosmos-app.env.template" 2>&1 || true)"
assert_contains "$OUT" 'missing or unresolved'
assert_eq "$(printf '%s' "$OUT" | grep -c 'required config EVIDENCE_DIR' || true)" "0"

note "F-111: the PrivatePIDs prohibition is recorded in the unit"
assert_contains "$(cat "$APP_UNIT_FILE")" 'Do NOT add PrivatePIDs='

finish
