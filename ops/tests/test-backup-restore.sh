#!/usr/bin/env bash
# ops/tests/test-backup-restore.sh — application-consistent backup + restore.
#
# Covers: online backup correctness with a HOT WAL (uncommitted-to-main-db
# frames captured), manifest integrity, retention pruning, staleness check,
# corruption detection, restore-onto-empty-box, and the production-path
# refusal ladder.
. "$(dirname "$0")/helpers.sh"
SANDBOX="$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' \
  "$SANDBOX")"
. "$BIN/common.sh"

export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export BACKUP_DIR="$SANDBOX/backups"
export BACKUP_RETENTION_COUNT=2
export BACKUP_MAX_AGE_HOURS=26
export APP_UNIT=cosmos-app.service
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
touch "$MOCK_SYSTEMCTL_LOG"
export MOCK_ACTIVE_UNITS="$SANDBOX/active-units"
touch "$MOCK_ACTIVE_UNITS"

BACKUP="$BIN/backup.sh"
RESTORE="$BIN/restore.sh"
DB="$DATA_DIR/cosmos.db"

note "setup: WAL-mode ledger with 5 events + journal-compat marker"
mkdir -p "$DATA_DIR"
sqlite3 "$DB" "
  PRAGMA journal_mode=WAL;
  CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, data TEXT);
  CREATE TABLE ledger_schema_compatibility(
    singleton INTEGER PRIMARY KEY,
    current_schema_version INTEGER NOT NULL,
    rollback_floor INTEGER NOT NULL
  );
  INSERT INTO ledger_schema_compatibility(
    singleton, current_schema_version, rollback_floor
  ) VALUES (1, 3, 3);
  PRAGMA user_version=3;
  INSERT INTO events(ts, kind) VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e');
"
json_write "$DATA_DIR/journal-compat.json" "dataSchema=3" "rollbackFloor=3" \
  "updatedAtUtc=2026-07-12T00:00:00Z" "updatedBy=test"
SOURCE_JOURNAL_SHA256="$(sha256_file "$DATA_DIR/journal-compat.json")"

note "1. first backup: manifest, sha, integrity, events count"
assert_rc 0 bash "$BACKUP"
B1="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T' | sort | tail -1)"
assert_file "$BACKUP_DIR/$B1/cosmos.db"
assert_file "$BACKUP_DIR/$B1/manifest.json"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" schemaVersion)" 2 \
  "backup manifest generation is explicit"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" eventsCount)" 5 "events in manifest"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" dataSchema)" 3 "dataSchema in manifest"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" rollbackFloor)" 3 \
  "rollbackFloor in manifest"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" journalState)" PRESENT \
  "manifest binds one steady journal state"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" sourceJournalSha256)" \
  "$SOURCE_JOURNAL_SHA256" "manifest binds the exact source journal bytes"
assert_eq "$(sha256_file "$BACKUP_DIR/$B1/cosmos.db")" \
  "$(json_get "$BACKUP_DIR/$B1/manifest.json" dbSha256)" "manifest sha matches file"
assert_eq "$(sqlite3 "$BACKUP_DIR/$B1/cosmos.db" 'PRAGMA integrity_check;')" ok "backup integrity"

note "1b. PENDING or moving compatibility state cannot publish a backup"
COMPLETED_BEFORE_REFUSALS="$(
  ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T'
)"
json_write "$DATA_DIR/journal-compat.json" \
  "dataSchema=2" "rollbackFloor=3" \
  "updatedAtUtc=2026-07-12T00:00:01Z" \
  "updatedBy=deploy.sh.prestart-barrier"
assert_rc 1 bash "$BACKUP"
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" \
  "$COMPLETED_BEFORE_REFUSALS" "PENDING backup publishes no completed directory"

json_write "$DATA_DIR/journal-compat.json" "dataSchema=3" "rollbackFloor=3" \
  "updatedAtUtc=2026-07-12T00:00:00Z" "updatedBy=test"
RACE_SQLITE="$SANDBOX/sqlite-journal-race"
REAL_SQLITE="$(command -v sqlite3)"
cat > "$RACE_SQLITE" <<'SH'
#!/usr/bin/env bash
set -eu
case "${2:-}" in
  .backup\ *)
    "$REAL_SQLITE" "$@"
    if [ ! -e "$RACE_ONCE" ]; then
      printf '%s\n' \
        '{"dataSchema":2,"rollbackFloor":3,"updatedAtUtc":"2026-07-12T00:00:02Z","updatedBy":"deploy.sh.prestart-barrier"}' \
        > "$RACE_JOURNAL"
      : > "$RACE_ONCE"
    fi
    exit 0
    ;;
esac
exec "$REAL_SQLITE" "$@"
SH
chmod 0755 "$RACE_SQLITE"
assert_rc 1 env \
  SQLITE="$RACE_SQLITE" REAL_SQLITE="$REAL_SQLITE" \
  RACE_JOURNAL="$DATA_DIR/journal-compat.json" \
  RACE_ONCE="$SANDBOX/sqlite-journal-race.once" \
  bash "$BACKUP"
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" \
  "$COMPLETED_BEFORE_REFUSALS" \
  "journal movement during database capture publishes no completed directory"
json_write "$DATA_DIR/journal-compat.json" "dataSchema=3" "rollbackFloor=3" \
  "updatedAtUtc=2026-07-12T00:00:00Z" "updatedBy=test"

sqlite3 "$DB" \
  'INSERT INTO ledger_schema_compatibility(singleton,current_schema_version,rollback_floor) VALUES(2,3,3);'
assert_rc 1 bash "$BACKUP"
sqlite3 "$DB" 'DELETE FROM ledger_schema_compatibility WHERE singleton=2;'
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" \
  "$COMPLETED_BEFORE_REFUSALS" \
  "extra compatibility row publishes no completed directory"

sqlite3 "$DB" "
  ALTER TABLE ledger_schema_compatibility RENAME TO compatibility_original;
  CREATE TABLE ledger_schema_compatibility(
    singleton TEXT,
    current_schema_version INTEGER,
    rollback_floor INTEGER
  );
  INSERT INTO ledger_schema_compatibility VALUES('1',3,3);
"
assert_rc 1 bash "$BACKUP"
sqlite3 "$DB" "
  DROP TABLE ledger_schema_compatibility;
  ALTER TABLE compatibility_original RENAME TO ledger_schema_compatibility;
"
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" \
  "$COMPLETED_BEFORE_REFUSALS" \
  "text singleton compatibility row publishes no completed directory"

sqlite3 "$DB" "
  UPDATE ledger_schema_compatibility
  SET current_schema_version=0, rollback_floor=0
  WHERE singleton=1;
  PRAGMA user_version=0;
"
json_write "$DATA_DIR/journal-compat.json" "dataSchema=0" "rollbackFloor=0" \
  "updatedAtUtc=2026-07-12T00:00:03Z" "updatedBy=test"
assert_rc 1 bash "$BACKUP"
sqlite3 "$DB" "
  UPDATE ledger_schema_compatibility
  SET current_schema_version=3, rollback_floor=3
  WHERE singleton=1;
  PRAGMA user_version=3;
"
json_write "$DATA_DIR/journal-compat.json" "dataSchema=3" "rollbackFloor=3" \
  "updatedAtUtc=2026-07-12T00:00:00Z" "updatedBy=test"
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" \
  "$COMPLETED_BEFORE_REFUSALS" \
  "schema-zero compatibility row publishes no completed directory"

note "2. hot WAL: open reader blocks checkpoint; backup still captures all rows"
FIFO="$SANDBOX/holdfifo"
mkfifo "$FIFO"
sqlite3 "$DB" < "$FIFO" &
HOLDER=$!
register_pid "$HOLDER"
exec 9>"$FIFO"
printf 'BEGIN;\nSELECT COUNT(*) FROM events;\n' >&9
sleep 0.5
sqlite3 "$DB" "
  PRAGMA wal_autocheckpoint=0;
  WITH RECURSIVE cte(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cte WHERE x<100)
  INSERT INTO events(ts, kind) SELECT x, 'bulk' FROM cte;
"
ASSERTIONS=$((ASSERTIONS + 1))
[ -s "$DB-wal" ] || fail "expected a non-empty WAL file next to the live db"
sleep 1.1   # distinct backup id (second-resolution stamps)
assert_rc 0 bash "$BACKUP"
B2="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T' | sort | tail -1)"
assert_ne "$B2" "$B1" "second backup id"
assert_eq "$(sqlite3 "$BACKUP_DIR/$B2/cosmos.db" 'SELECT COUNT(*) FROM events;')" 105 \
  "hot-WAL rows captured by online backup"
exec 9>&-
wait "$HOLDER" 2>/dev/null || true

note "3. retention prunes to BACKUP_RETENTION_COUNT completed backups"
sleep 1.1
assert_rc 0 bash "$BACKUP"
assert_eq "$(ls -1 "$BACKUP_DIR" | grep -cE '^[0-9]{8}T')" 2 "retention count"
assert_no_file "$BACKUP_DIR/$B1"

note "4. --verify-latest: fresh ok, stale fails, empty fails"
assert_rc 0 bash "$BACKUP" --verify-latest
STALE_DIR="$SANDBOX/backups-stale"
mkdir -p "$STALE_DIR/20200101T000000Z"
node -e '
  require("fs").writeFileSync(process.argv[1] + "/manifest.json",
    JSON.stringify({ backupId: "20200101T000000Z", createdAtUtc: "2020-01-01T00:00:00Z", dbSha256: "x" }));
' "$STALE_DIR/20200101T000000Z"
assert_rc 1 env BACKUP_DIR="$STALE_DIR" bash "$BACKUP" --verify-latest
assert_rc 1 env BACKUP_DIR="$SANDBOX/backups-none" bash "$BACKUP" --verify-latest

note "5. restore onto an empty box"
TARGET1="$SANDBOX/fresh-box/data"
assert_rc 0 bash "$RESTORE" --backup latest --target "$TARGET1"
assert_eq "$(sqlite3 "$TARGET1/cosmos.db" 'SELECT COUNT(*) FROM events;')" 105 "restored rows"
assert_eq "$(json_get "$TARGET1/journal-compat.json" dataSchema)" 3 \
  "restore reconstructs the bound dataSchema"
assert_eq "$(json_get "$TARGET1/journal-compat.json" rollbackFloor)" 3 \
  "restore reconstructs the bound rollbackFloor"
assert_eq "$(json_get "$TARGET1/journal-compat.json" updatedBy)" restore.sh \
  "restore publishes a steady compatibility marker"
assert_file "$TARGET1/restore-report.json"
assert_eq "$(json_get "$TARGET1/restore-report.json" production)" false "isolated restore recorded"
assert_eq "$(json_get "$TARGET1/restore-report.json" sourceJournalSha256)" \
  "$SOURCE_JOURNAL_SHA256" "restore report preserves source journal provenance"

note "5b. restore caller paths must already be lexical and physical canonical endpoints"
mkdir "$SANDBOX/restore-physical-parent"
ln -s "$SANDBOX/restore-physical-parent" "$SANDBOX/restore-parent-alias"
ln -s "$BACKUP_DIR" "$SANDBOX/backup-parent-alias"
assert_rc 1 bash "$RESTORE" --backup latest --target relative/restore-target
assert_rc 1 bash "$RESTORE" --backup latest \
  --target "$SANDBOX/restore-physical-parent/../restore-dot-target"
assert_rc 1 bash "$RESTORE" --backup latest \
  --target "$SANDBOX/restore-parent-alias/restore-alias-target"
assert_rc 1 bash "$RESTORE" --backup relative/backup \
  --target "$SANDBOX/backup-relative-target"
assert_rc 1 bash "$RESTORE" --backup "$BACKUP_DIR/$B2/." \
  --target "$SANDBOX/backup-dot-target"
assert_rc 1 bash "$RESTORE" --backup "$SANDBOX/backup-parent-alias/$B2" \
  --target "$SANDBOX/backup-alias-target"
assert_no_file "$SANDBOX/restore-dot-target"
assert_no_file "$SANDBOX/restore-physical-parent/restore-alias-target"
assert_no_file "$SANDBOX/backup-relative-target"
assert_no_file "$SANDBOX/backup-dot-target"
assert_no_file "$SANDBOX/backup-alias-target"

note "6. corrupted backup is refused (sha mismatch), target untouched"
LATEST="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T' | sort | tail -1)"
cp -R "$BACKUP_DIR/$LATEST" "$SANDBOX/corrupt"
node -e '
  const fs = require("fs");
  const p = process.argv[1] + "/cosmos.db";
  const b = fs.readFileSync(p); b[200] ^= 0xff; fs.writeFileSync(p, b);
' "$SANDBOX/corrupt"
assert_rc 1 bash "$RESTORE" --backup "$SANDBOX/corrupt" --target "$SANDBOX/never"
assert_no_file "$SANDBOX/never/cosmos.db"

cp -R "$BACKUP_DIR/$LATEST" "$SANDBOX/schema-mismatch"
node -e '
  const fs = require("fs");
  const path = process.argv[1] + "/manifest.json";
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  manifest.dataSchema = 2;
  fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
' "$SANDBOX/schema-mismatch"
assert_rc 1 bash "$RESTORE" --backup "$SANDBOX/schema-mismatch" \
  --target "$SANDBOX/schema-mismatch-target"
assert_no_file "$SANDBOX/schema-mismatch-target/cosmos.db"

note "7. production-path refusal ladder"
assert_rc 2 bash "$RESTORE" --backup latest --target "$DATA_DIR"
assert_rc 2 bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production
echo cosmos-app.service > "$MOCK_ACTIVE_UNITS"
assert_rc 2 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production
: > "$MOCK_ACTIVE_UNITS"   # unit now inactive
assert_rc 2 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production   # non-empty, no --force

note "8. production restore remains unavailable under legacy confirmation and force flags"
sqlite3 "$DB" "INSERT INTO events(ts, kind) VALUES (999,'must-survive-refusal');"
printf '%s\n' MUST_SURVIVE_REFUSAL > "$DATA_DIR/production-restore-must-not-touch"
assert_rc 2 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production --force
assert_eq "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM events;')" 106 "production rows unchanged after refusal"
assert_eq "$(cat "$DATA_DIR/production-restore-must-not-touch")" MUST_SURVIVE_REFUSAL \
  "production target marker unchanged after refusal"

note "9. fixed production roots refuse independently of staging DATA_DIR"
for protected_target in \
  /opt/cosmos/df32-restore-refusal \
  /var/lib/cosmos/state/df32-restore-refusal \
  /var/lib/cosmos/ops/df32-restore-refusal \
  /var/lib/cosmos/releases/df32-restore-refusal \
  /var/backups/cosmos/df32-restore-refusal \
  /etc/cosmos/df32-restore-refusal \
  /run/cosmos-app/df32-restore-refusal \
  /run/cosmos-secret-source/df32-restore-refusal \
  /usr/local/lib/cosmos-ops/df32-restore-refusal
do
  protected_rc=0
  bash "$RESTORE" --backup latest --target "$protected_target" || protected_rc=$?
  ASSERTIONS=$((ASSERTIONS + 1))
  [ "$protected_rc" -ne 0 ] \
    || fail "fixed production target unexpectedly accepted: $protected_target"
done
ln -s /var/lib "$SANDBOX/fixed-var-lib-alias"
assert_rc 1 bash "$RESTORE" --backup latest \
  --target "$SANDBOX/fixed-var-lib-alias/cosmos/state/alias-refusal"
assert_rc 1 bash "$RESTORE" --backup latest \
  --target "$SANDBOX/fixed-var-lib-alias/../lib/cosmos/ops/dot-alias-refusal"
assert_eq "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM events;')" 106 \
  "staging DATA_DIR remains unchanged after fixed-root refusals"

finish
