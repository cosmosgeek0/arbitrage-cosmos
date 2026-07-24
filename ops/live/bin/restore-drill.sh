#!/bin/bash -p
# ops/live/bin/restore-drill.sh — staging-only isolated restore test (§24.2).
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
# No production action class exists; production paths and env-file dispatch
# fail before report or target creation.
#
# Usage: restore-drill.sh
# Exit:  0 drill passed;  1 drill failed (report written when possible)
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE
case "$0" in
  /*) _I00_SCRIPT_PATH="$0" ;;
  */*) _I00_SCRIPT_PATH="$PWD/$0" ;;
  *) printf '%s\n' "restore-drill.sh requires an explicit script path" >&2; exit 1 ;;
esac
SCRIPT_DIR="${_I00_SCRIPT_PATH%/*}"
[ "$SCRIPT_DIR" != "$_I00_SCRIPT_PATH" ] || SCRIPT_DIR=/
SCRIPT_DIR="$(cd -P -- "$SCRIPT_DIR" && pwd -P)" \
  || { printf '%s\n' "restore-drill.sh cannot bind its script directory" >&2; exit 1; }
unset _I00_SCRIPT_PATH
readonly SCRIPT_DIR
PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin
export PATH
readonly PATH
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

refuse_i00_effect_class
require_i00_effect_env_file_binding "$ENV_FILE"
load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
BACKUP_DIR="$(exact_existing_directory_path "$BACKUP_DIR")" \
  || die_code 1 "restore drill FAILED: BACKUP_DIR must be one exact raw canonical directory"
: "${DRILL_DIR:=$BACKUP_DIR/drills}"
DRILL_DIR="$(exact_raw_canonical_path "$DRILL_DIR")" \
  || die_code 1 "restore drill FAILED: DRILL_DIR must be one exact raw canonical path"
DATA_DIR="$(exact_existing_directory_path "$DATA_DIR")" \
  || die_code 1 "restore drill FAILED: DATA_DIR must be one exact raw canonical directory"

DRILL_TEMP_ROOT="${TMPDIR:-/tmp}"
DRILL_TEMP_ROOT="$(exact_existing_directory_path "$DRILL_TEMP_ROOT")" \
  || die_code 1 "restore drill FAILED: TMPDIR must be one exact raw canonical directory"
if any_path_effectively_intersects_protected_union \
    "$DATA_DIR" "$BACKUP_DIR" "$DRILL_DIR" "$DRILL_TEMP_ROOT"; then
  die_code 1 "direct production restore drill is unavailable without a ratified action class"
fi

require_cmd "$NODE" "$SQLITE"
configure_i00_bash

# Validate every write-capable path before report publication or mktemp. The
# shared canonicalizer uses raw component traversal and the captured guard
# interpreter, so symlink/.. aliases cannot be lexically collapsed first.
canonical_drill_path() {
  exact_raw_canonical_path "$1"
}
DRILL_TEMP_CANON="$DRILL_TEMP_ROOT"
[ -d "$DRILL_TEMP_CANON" ] \
  || die_code 1 "restore drill FAILED: TMPDIR is not an existing directory"
DRILL_CANON="$DRILL_DIR"
DATA_CANON="$DATA_DIR"
REPORT="$DRILL_DIR/drill-$(now_stamp).json"
if any_path_effectively_intersects_protected_union \
    "$DRILL_TEMP_CANON" "$DRILL_DIR" "$REPORT"; then
  die_code 1 "restore drill FAILED: a write path intersects a fixed production root"
fi
case "$DRILL_TEMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    die_code 1 "restore drill FAILED: TMPDIR is inside DATA_DIR"
    ;;
esac

write_report() { # ok reason checksRaw backupId
  i00_guard_node - "$REPORT" "$(now_utc)" "$1" "$2" "$4" "$3" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [file, timestamp, okRaw, reason, backupId, checksRaw] = process.argv.slice(2);
const parent = path.dirname(file);
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
const checks = JSON.parse(checksRaw);
fs.writeFileSync(file, `${JSON.stringify({
  ts: timestamp,
  ok: okRaw === 'true',
  reason,
  backupId,
  checks,
}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
NODE
}

LATEST="$(completed_backup_inventory latest "$BACKUP_DIR")" \
  || die_code 1 "restore drill FAILED: completed backup inventory is unsafe"
if [ -z "$LATEST" ]; then
  write_report false "NO_BACKUP" "[]" "none"
  die_code 1 "restore drill FAILED: no completed backup exists in $BACKUP_DIR"
fi
BACKUP_PATH="$BACKUP_DIR/$LATEST"

TMP="$(i00_guard_node -e '
  const fs = require("fs"), path = require("path");
  const directory = fs.mkdtempSync(path.join(process.argv[1], "cosmos-restore-drill."));
  fs.chmodSync(directory, 0o700);
  process.stdout.write(directory);
' "$DRILL_TEMP_CANON")"
cleanup() {
  i00_guard_node -e '
    require("fs").rmSync(process.argv[1], { recursive: true, force: true });
  ' "$TMP"
}
trap cleanup EXIT

# Defense in depth: the drill target must be disjoint from the live state store.
TMP_CANON="$(canonical_drill_path "$TMP")"
RESTORE_TARGET_CANON="$(canonical_drill_path "$TMP/restore")"
if any_path_effectively_intersects_protected_union \
    "$TMP_CANON" "$RESTORE_TARGET_CANON"; then
  die_code 1 "restore drill FAILED: temporary target intersects a fixed production root"
fi
case "$TMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    write_report false "DRILL_TARGET_NOT_ISOLATED" "[]" "$LATEST"
    die_code 1 "restore drill target $TMP_CANON is inside DATA_DIR — refusing"
    ;;
esac

CHECKS="[]"
add_check() { # name ok detail
  CHECKS="$(i00_guard_node -e '
    const arr = JSON.parse(process.argv[1]);
    arr.push({ name: process.argv[2], ok: process.argv[3] === "true", detail: process.argv[4] });
    process.stdout.write(JSON.stringify(arr));
  ' "$CHECKS" "$1" "$2" "$3")"
}

FAILED=0
set -- --backup "$BACKUP_PATH" --target "$RESTORE_TARGET_CANON"
[ -n "$ENV_FILE" ] && set -- "$@" --env-file "$ENV_FILE"
if "$I00_BASH" -p "$SCRIPT_DIR/restore.sh" "$@"; then
  add_check restore true "restore.sh succeeded into isolated target"
else
  add_check restore false "restore.sh exited nonzero"
  add_check eventsCount false "restore failed before an immutable events-count comparison could complete"
  add_check evidenceArchives false "restore failed before an immutable archive-count comparison could complete"
  add_check archiveIntegrity false "restore failed before archive hash, size, and member-inventory verification completed"
  if [ ! -e "$RESTORE_TARGET_CANON" ] && [ ! -L "$RESTORE_TARGET_CANON" ]; then
    add_check targetAbsentAfterFailure true "failed restore did not create its isolated target"
  else
    add_check targetAbsentAfterFailure false "failed restore mutated or created its isolated target"
  fi
  FAILED=1
fi

if [ "$FAILED" = 0 ]; then
  INTEGRITY="$("$SQLITE" "$RESTORE_TARGET_CANON/cosmos.db" 'PRAGMA integrity_check;' 2>/dev/null || echo error)"
  if [ "$INTEGRITY" = "ok" ]; then
    add_check integrity true "PRAGMA integrity_check ok on restored copy"
  else
    add_check integrity false "integrity_check: $INTEGRITY"
    FAILED=1
  fi

  if DECLARED_ARCHIVES="$(json_get "$RESTORE_TARGET_CANON/restore-report.json" declaredEvidenceArchives)" \
      && RESTORED_ARCHIVES="$(json_get "$RESTORE_TARGET_CANON/restore-report.json" evidenceArchives)"; then
    if [ "$DECLARED_ARCHIVES" = "$RESTORED_ARCHIVES" ]; then
      add_check evidenceArchives true "restored $RESTORED_ARCHIVES declared evidence archives"
    else
      add_check evidenceArchives false "manifest declares $DECLARED_ARCHIVES archives, restore reported $RESTORED_ARCHIVES"
      FAILED=1
    fi
  else
    add_check evidenceArchives false "archive inventory or restore report was unreadable"
    FAILED=1
  fi

  if VERIFIED_ARCHIVES="$(json_get "$RESTORE_TARGET_CANON/restore-report.json" verifiedEvidenceArchives)" \
      && ARCHIVE_VERIFICATION="$(json_get "$RESTORE_TARGET_CANON/restore-report.json" archiveVerification)" \
      && [ "$ARCHIVE_VERIFICATION" = "EXACT_MANIFEST_INVENTORY_HASH_SIZE_MEMBER_VERIFIED" ] \
      && [ -n "${RESTORED_ARCHIVES:-}" ] \
      && [ "$VERIFIED_ARCHIVES" = "$RESTORED_ARCHIVES" ]; then
    add_check archiveIntegrity true "exact manifest inventory plus immutable archive hashes, sizes, and member inventories verified for $VERIFIED_ARCHIVES archives"
  else
    add_check archiveIntegrity false "restore report did not prove exact archive inventory, hashes, sizes, and members"
    FAILED=1
  fi

  WANT_COUNT="$(json_get "$RESTORE_TARGET_CANON/restore-report.json" declaredEventsCount || echo -1)"
  GOT_COUNT="$("$SQLITE" "$RESTORE_TARGET_CANON/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -2)"
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
