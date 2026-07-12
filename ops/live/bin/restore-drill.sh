#!/usr/bin/env bash
# ops/live/bin/restore-drill.sh — periodic isolated restore test (§24.2).
#
# Restores the newest completed backup into a throwaway temp directory,
# verifies it, writes a drill report, and deletes the temp copy. The
# production state store is never a target: the drill passes no production
# flags to restore.sh, and additionally asserts that its temp directory is
# disjoint from DATA_DIR before doing anything.
#
# A drill FAILURE is loud (nonzero exit + report with ok:false) — a backup
# you cannot restore is not a backup, and §23 treats stale/unverified
# backups as an alarm condition.
#
# Usage: restore-drill.sh [--env-file <file>]
# Exit:  0 drill passed;  1 drill failed (report written when possible)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-restore-drill

ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
: "${DRILL_DIR:=$BACKUP_DIR/drills}"
require_cmd "$NODE" "$SQLITE"

REPORT="$DRILL_DIR/drill-$(now_stamp).json"
write_report() { # ok reason checksRaw backupId
  json_write "$REPORT" "ts=$(now_utc)" "ok=$1" "reason=$2" "backupId=$4" "checks=$3"
}

LATEST="$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort | tail -1 || true)"
if [ -z "$LATEST" ]; then
  write_report false "NO_BACKUP" "[]" "none"
  die_code 1 "restore drill FAILED: no completed backup exists in $BACKUP_DIR"
fi
BACKUP_PATH="$BACKUP_DIR/$LATEST"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cosmos-restore-drill.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Defense in depth: the drill target must be disjoint from the live state store.
TMP_CANON="$(canonical_path "$TMP")"
DATA_CANON="$(canonical_path "$DATA_DIR")"
case "$TMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    write_report false "DRILL_TARGET_NOT_ISOLATED" "[]" "$LATEST"
    die_code 1 "restore drill target $TMP_CANON is inside DATA_DIR — refusing"
    ;;
esac

CHECKS="[]"
add_check() { # name ok detail
  CHECKS="$("$NODE" -e '
    const arr = JSON.parse(process.argv[1]);
    arr.push({ name: process.argv[2], ok: process.argv[3] === "true", detail: process.argv[4] });
    process.stdout.write(JSON.stringify(arr));
  ' "$CHECKS" "$1" "$2" "$3")"
}

FAILED=0
set -- --backup "$BACKUP_PATH" --target "$TMP/restore"
[ -n "$ENV_FILE" ] && set -- "$@" --env-file "$ENV_FILE"
if "$SCRIPT_DIR/restore.sh" "$@"; then
  add_check restore true "restore.sh succeeded into isolated target"
else
  add_check restore false "restore.sh exited nonzero"
  FAILED=1
fi

if [ "$FAILED" = 0 ]; then
  INTEGRITY="$("$SQLITE" "$TMP/restore/cosmos.db" 'PRAGMA integrity_check;' 2>/dev/null || echo error)"
  if [ "$INTEGRITY" = "ok" ]; then
    add_check integrity true "PRAGMA integrity_check ok on restored copy"
  else
    add_check integrity false "integrity_check: $INTEGRITY"
    FAILED=1
  fi

  WANT_COUNT="$(json_get "$BACKUP_PATH/manifest.json" eventsCount || echo -1)"
  GOT_COUNT="$("$SQLITE" "$TMP/restore/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -2)"
  if [ "$WANT_COUNT" = "-1" ]; then
    add_check eventsCount true "manifest recorded no events table; skipped"
  elif [ "$WANT_COUNT" = "$GOT_COUNT" ]; then
    add_check eventsCount true "restored events count $GOT_COUNT matches manifest"
  else
    add_check eventsCount false "manifest says $WANT_COUNT events, restored copy has $GOT_COUNT"
    FAILED=1
  fi
fi

if [ "$FAILED" = 0 ]; then
  write_report true "DRILL_PASSED" "$CHECKS" "$LATEST"
  ops_log "restore drill PASSED for backup $LATEST (report: $REPORT)"
  exit 0
fi
write_report false "DRILL_FAILED" "$CHECKS" "$LATEST"
die_code 1 "restore drill FAILED for backup $LATEST (report: $REPORT)"
