#!/usr/bin/env bash
# ops/tests/test-backup-restore.sh — application-consistent backup + restore.
#
# Covers: online backup correctness with a HOT WAL (uncommitted-to-main-db
# frames captured), manifest integrity, retention pruning, staleness check,
# corruption detection, restore-onto-empty-box, and the production-path
# refusal ladder.
. "$(dirname "$0")/helpers.sh"
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
  INSERT INTO events(ts, kind) VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e');
"
json_write "$DATA_DIR/journal-compat.json" "dataSchema=3" "rollbackFloor=1" \
  "updatedAtUtc=2026-07-12T00:00:00Z" "updatedBy=test"

note "1. first backup: manifest, sha, integrity, events count"
assert_rc 0 bash "$BACKUP"
B1="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T' | sort | tail -1)"
assert_file "$BACKUP_DIR/$B1/cosmos.db"
assert_file "$BACKUP_DIR/$B1/manifest.json"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" eventsCount)" 5 "events in manifest"
assert_eq "$(json_get "$BACKUP_DIR/$B1/manifest.json" dataSchema)" 3 "dataSchema in manifest"
assert_eq "$(sha256_file "$BACKUP_DIR/$B1/cosmos.db")" \
  "$(json_get "$BACKUP_DIR/$B1/manifest.json" dbSha256)" "manifest sha matches file"
assert_eq "$(sqlite3 "$BACKUP_DIR/$B1/cosmos.db" 'PRAGMA integrity_check;')" ok "backup integrity"

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
assert_file "$TARGET1/restore-report.json"
assert_eq "$(json_get "$TARGET1/restore-report.json" production)" false "isolated restore recorded"

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

note "7. production-path refusal ladder"
assert_rc 2 bash "$RESTORE" --backup latest --target "$DATA_DIR"
assert_rc 2 bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production
echo cosmos-app.service > "$MOCK_ACTIVE_UNITS"
assert_rc 2 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production
: > "$MOCK_ACTIVE_UNITS"   # unit now inactive
assert_rc 1 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production   # non-empty, no --force

note "8. authorized production restore: db replaced, stale WAL sidecars removed"
# Plant a recognizable stale WAL: if restore failed to remove it, the restored
# db would be corrupted or the sentinel would survive. (macOS system SQLite
# keeps a persistent, freshly-created -wal after reads, so absence of the
# FILE is not the invariant — absence of the STALE content is.)
echo STALE_WAL_SENTINEL > "$DB-wal"
assert_rc 0 env RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash "$RESTORE" --backup latest --target "$DATA_DIR" --allow-production --force
assert_eq "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM events;')" 105 "production rows after restore"
ASSERTIONS=$((ASSERTIONS + 1))
if [ -e "$DB-wal" ] && grep -q STALE_WAL_SENTINEL "$DB-wal" 2>/dev/null; then
  fail "stale WAL sidecar survived the production restore"
fi

finish
