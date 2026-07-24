#!/usr/bin/env bash
# ops/tests/test-restore-drill.sh — the periodic drill restores into an
# isolated target, verifies, reports, and never touches production state.
. "$(dirname "$0")/helpers.sh"
. "$BIN/common.sh"

TMPDIR="$(cd -P -- "${TMPDIR:-/tmp}" && pwd -P)"
export TMPDIR

export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export BACKUP_DIR="$SANDBOX/backups"
export BACKUP_RETENTION_COUNT=5
export APP_UNIT=cosmos-app.service
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
touch "$MOCK_SYSTEMCTL_LOG"

DRILL="$BIN/restore-drill.sh"
DB="$DATA_DIR/cosmos.db"

note "setup: ledger with 7 events + one backup"
mkdir -p "$DATA_DIR"
sqlite3 "$DB" "
  PRAGMA journal_mode=WAL;
  CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL);
  INSERT INTO events(ts, kind) VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e'),(6,'f'),(7,'g');
"
assert_rc 0 bash "$BIN/backup.sh"

note "1. drill passes; report written; production untouched"
SHA_BEFORE="$(sha256_file "$DB")"
assert_rc 0 bash "$DRILL"
assert_eq "$(sha256_file "$DB")" "$SHA_BEFORE" "production db untouched by drill"
REPORT="$(ls -1 "$BACKUP_DIR/drills" | sort | tail -1)"
assert_file "$BACKUP_DIR/drills/$REPORT"
assert_eq "$(json_get "$BACKUP_DIR/drills/$REPORT" ok)" true "drill report ok"
assert_eq "$(node -e '
  const r = require(process.argv[1]);
  console.log(r.checks.find((c) => c.name === "eventsCount").ok);
' "$BACKUP_DIR/drills/$REPORT")" true "count check recorded"

note "2. tampered manifest count makes the drill FAIL loudly"
LATEST="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T' | sort | tail -1)"
node -e '
  const fs = require("fs");
  const p = process.argv[1] + "/manifest.json";
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.eventsCount = 9999;
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
' "$BACKUP_DIR/$LATEST"
assert_rc 1 bash "$DRILL"
REPORT2="$(ls -1 "$BACKUP_DIR/drills" | sort | tail -1)"
assert_eq "$(json_get "$BACKUP_DIR/drills/$REPORT2" ok)" false "failed drill reported"
assert_eq "$(node -e '
  const r = require(process.argv[1]);
  console.log(r.checks.find((c) => c.name === "eventsCount").ok);
' "$BACKUP_DIR/drills/$REPORT2")" false "count mismatch recorded"

note "3. no backups at all: drill fails with NO_BACKUP report"
EMPTY_BACKUPS="$SANDBOX/empty-backups"
mkdir -p "$EMPTY_BACKUPS"
assert_rc 1 env BACKUP_DIR="$EMPTY_BACKUPS" bash "$DRILL"
REPORT3="$(ls -1 "$EMPTY_BACKUPS/drills" | sort | tail -1)"
assert_eq "$(json_get "$EMPTY_BACKUPS/drills/$REPORT3" reason)" NO_BACKUP "reason recorded"

finish
