#!/usr/bin/env bash
# ops/live/bin/restore.sh — restore a backup into an explicit target directory.
#
# §24.2: periodic restore tests run against an ISOLATED copy, never the
# production state store. This script therefore refuses the live DATA_DIR
# unless three independent things are all true:
#   1. the operator passed --allow-production;
#   2. the environment carries RESTORE_CONFIRM=RESTORE_PRODUCTION;
#   3. the app unit is NOT active (checked via $SYSTEMCTL).
# Routine restore verification should use restore-drill.sh, which always
# restores into a throwaway directory.
#
# Backup integrity (manifest sha256 + PRAGMA integrity_check) is verified
# BEFORE anything is written to the target. When overwriting an existing
# cosmos.db, stale -wal/-shm sidecars are removed in the same step — leaving
# them next to a restored db would corrupt it on first open.
#
# Usage:
#   restore.sh --backup <id|dir|latest> --target <dir>
#              [--env-file <file>] [--allow-production] [--force]
#
# Exit codes:
#   0 restored;  1 bad arguments/backup/target;  2 production-path refusal
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-restore

BACKUP_ARG="" TARGET="" ENV_FILE="" ALLOW_PRODUCTION=0 FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_ARG="${2:?--backup needs a value}"; shift 2 ;;
    --target) TARGET="${2:?--target needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --allow-production) ALLOW_PRODUCTION=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done
[ -n "$BACKUP_ARG" ] || die_code 1 "--backup is required (id, directory, or 'latest')"
[ -n "$TARGET" ] || die_code 1 "--target is required (explicit directory; no default)"

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
require_cmd "$NODE" "$SQLITE"

# --- resolve the backup ---------------------------------------------------------
if [ "$BACKUP_ARG" = "latest" ]; then
  latest="$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort | tail -1 || true)"
  [ -n "$latest" ] || die_code 1 "no completed backup found in $BACKUP_DIR"
  BACKUP_PATH="$BACKUP_DIR/$latest"
elif [ -d "$BACKUP_ARG" ]; then
  BACKUP_PATH="$BACKUP_ARG"
else
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_ARG"
fi
[ -f "$BACKUP_PATH/manifest.json" ] || die_code 1 "not a completed backup (no manifest.json): $BACKUP_PATH"
[ -f "$BACKUP_PATH/cosmos.db" ] || die_code 1 "backup has no cosmos.db: $BACKUP_PATH"

# --- verify integrity BEFORE touching the target --------------------------------
BACKUP_ID="$(json_get "$BACKUP_PATH/manifest.json" backupId || echo unknown)"
WANT_SHA="$(json_get "$BACKUP_PATH/manifest.json" dbSha256)" \
  || die_code 1 "manifest has no dbSha256: $BACKUP_PATH"
GOT_SHA="$(sha256_file "$BACKUP_PATH/cosmos.db")"
[ "$GOT_SHA" = "$WANT_SHA" ] \
  || die_code 1 "backup integrity FAILED: sha256 mismatch (corrupt or tampered) in $BACKUP_PATH"
INTEGRITY="$("$SQLITE" "$BACKUP_PATH/cosmos.db" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || die_code 1 "backup integrity FAILED: $INTEGRITY"

# --- production-path guard -------------------------------------------------------
TARGET_CANON="$(canonical_path "$TARGET")"
DATA_CANON="$(canonical_path "$DATA_DIR")"
IS_PRODUCTION=0
case "$TARGET_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*) IS_PRODUCTION=1 ;;
esac
if [ "$IS_PRODUCTION" = 1 ]; then
  [ "$ALLOW_PRODUCTION" = 1 ] \
    || die_code 2 "refusing to restore into the live state store ($DATA_CANON); use restore-drill.sh for verification, or pass --allow-production for incident recovery"
  [ "${RESTORE_CONFIRM:-}" = "RESTORE_PRODUCTION" ] \
    || die_code 2 "production restore additionally requires RESTORE_CONFIRM=RESTORE_PRODUCTION in the environment"
  if "$SYSTEMCTL" is-active "$APP_UNIT" >/dev/null 2>&1; then
    die_code 2 "refusing production restore: $APP_UNIT is active; stop it first"
  fi
  ops_log "production restore authorized (flag + confirm + $APP_UNIT inactive)"
fi

# --- write to the target ----------------------------------------------------------
mkdir -p "$TARGET"
if [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
  die_code 1 "target is not empty: $TARGET (pass --force to overwrite)"
fi
# Stale WAL/SHM sidecars from a previous life of this db would corrupt the
# restored file on first open — they must die with the old db.
rm -f "$TARGET/cosmos.db" "$TARGET/cosmos.db-wal" "$TARGET/cosmos.db-shm"
cp "$BACKUP_PATH/cosmos.db" "$TARGET/cosmos.db"

RESTORED_EVIDENCE=0
for arch in "$BACKUP_PATH"/evidence-*.tar.gz; do
  [ -f "$arch" ] || continue
  mkdir -p "$TARGET/evidence"
  tar -xzf "$arch" -C "$TARGET/evidence"
  RESTORED_EVIDENCE=$((RESTORED_EVIDENCE + 1))
done

EVENTS_COUNT="$("$SQLITE" "$TARGET/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
PROD_BOOL=false
[ "$IS_PRODUCTION" = 1 ] && PROD_BOOL=true
json_write "$TARGET/restore-report.json" "ts=$(now_utc)" "backupId=$BACKUP_ID" \
  "target=$TARGET_CANON" "production=$PROD_BOOL" "dbSha256=$WANT_SHA" \
  "eventsCount=$EVENTS_COUNT" "evidenceArchives=$RESTORED_EVIDENCE"
ops_log "restore of $BACKUP_ID into $TARGET_CANON complete (events=$EVENTS_COUNT)"
exit 0
