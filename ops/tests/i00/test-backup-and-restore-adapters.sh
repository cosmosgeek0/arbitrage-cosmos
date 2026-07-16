#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

materialize_effective_l15 "$TEST_TMP/donor"
chmod -R a-w "$TEST_TMP/donor/ops/live"
chmod +x "$TEST_DIR/fixtures/fake-sqlite-safe.sh" "$TEST_DIR/fixtures/fake-systemctl-inactive.sh"
REAL_TMP="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-backup-$$")"
cleanup_backup_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_backup_test EXIT
mkdir -p "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/backups" "$SIMULATION_ROOT/ops-state" "$SIMULATION_ROOT/evidence-src" "$SIMULATION_ROOT/model-src"
printf 'evidence-fixture\n' > "$SIMULATION_ROOT/evidence-src/evidence.txt"
printf 'model-fixture\n' > "$SIMULATION_ROOT/model-src/model.txt"
sqlite3 "$SIMULATION_ROOT/data/cosmos.db" 'PRAGMA journal_mode=WAL; CREATE TABLE events(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO events(payload) VALUES ("fixture-a"),("fixture-b");'
cat > "$TEST_TMP/backup.env" <<EOF
DATA_DIR=$SIMULATION_ROOT/data
BACKUP_DIR=$SIMULATION_ROOT/backups
OPS_STATE_DIR=$SIMULATION_ROOT/ops-state
BACKUP_RETENTION_COUNT=3
BACKUP_MAX_AGE_HOURS=26
EVIDENCE_PATHS=$SIMULATION_ROOT/evidence-src:$SIMULATION_ROOT/model-src
EVIDENCE_MISSING_POLICY=fail
SQLITE=$TEST_DIR/fixtures/fake-sqlite-safe.sh
SYSTEMCTL=$TEST_DIR/fixtures/fake-systemctl-inactive.sh
APP_UNIT=cosmos-app.service
EOF

note "L15 online backup plus I00 full integrity/FK gates"
COMMON=(--simulation --simulation-root "$SIMULATION_ROOT")
assert_failure env DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/backup-verify.sh" --env-file "$TEST_TMP/backup.env"
mkdir -p "$SIMULATION_ROOT/backups/20990101T000000Z"
printf 'sentinel\n' > "$SIMULATION_ROOT/backups/20990101T000000Z/not-a-backup"
OUT="$(DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/backup-verify.sh" --env-file "$TEST_TMP/backup.env" "${COMMON[@]}")"
assert_contains "$OUT" BACKUP_VERIFIED
BACKUP_PATH="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(v.backupPath)' <<<"$OUT")"
assert_file "$BACKUP_PATH/cosmos.db"
assert_eq "$(sqlite3 "$BACKUP_PATH/cosmos.db" 'PRAGMA integrity_check;')" ok
assert_eq "$(sqlite3 "$BACKUP_PATH/cosmos.db" 'SELECT COUNT(*) FROM events;')" 2
assert_eq "$(sqlite3 "$BACKUP_PATH/cosmos.db" 'PRAGMA foreign_key_check;')" ''
assert_file "$SIMULATION_ROOT/backups/20990101T000000Z/not-a-backup"

note "isolated restore preserves donor output and performs no production swap"
RESTORE_OUT="$(DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/restore-drill-verify.sh" --backup "$BACKUP_PATH" --target "$SIMULATION_ROOT/restore-target" --env-file "$TEST_TMP/backup.env" "${COMMON[@]}")"
assert_contains "$RESTORE_OUT" ISOLATED_RESTORE_VERIFIED_NO_PRODUCTION_MUTATION
assert_eq "$(sqlite3 "$SIMULATION_ROOT/restore-target/cosmos.db" 'SELECT COUNT(*) FROM events;')" 2
assert_file "$SIMULATION_ROOT/restore-target/restore-report.json"
assert_file "$SIMULATION_ROOT/restore-target/evidence/evidence-src/evidence.txt"
assert_file "$SIMULATION_ROOT/restore-target/evidence/model-src/model.txt"
assert_eq "$(cat "$SIMULATION_ROOT/restore-target/evidence/evidence-src/evidence.txt")" evidence-fixture
assert_eq "$(cat "$SIMULATION_ROOT/restore-target/evidence/model-src/model.txt")" model-fixture

note "live DATA_DIR and nonempty targets fail before mutation"
assert_failure env DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/restore-drill-verify.sh" --backup "$BACKUP_PATH" --target "$SIMULATION_ROOT/data" --env-file "$TEST_TMP/backup.env" "${COMMON[@]}"
assert_failure env DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/restore-drill-verify.sh" --backup "$BACKUP_PATH" --target "$SIMULATION_ROOT/restore-target" --env-file "$TEST_TMP/backup.env" "${COMMON[@]}"
ln -s "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/data-alias"
assert_failure_contains 'restore verification target must be isolated from DATA_DIR' env DONOR_ROOT="$TEST_TMP/donor/ops/live" "$I00_ROOT/bin/restore-drill-verify.sh" --backup "$BACKUP_PATH" --target "$SIMULATION_ROOT/data-alias/absent-child" --env-file "$TEST_TMP/backup.env" "${COMMON[@]}"
assert_not_file "$SIMULATION_ROOT/data/absent-child/cosmos.db"
finish
