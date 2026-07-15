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

# Validate the temp root before mktemp. A TMPDIR symlinked inside DATA_DIR
# would otherwise make the supposedly isolated drill mutate production before
# it had performed its isolation check.
canonical_drill_path() {
  "$NODE" - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
try {
  if (typeof input !== 'string' || input.length === 0 || /[\0-\x1f\x7f]/.test(input)) {
    throw new Error('unsafe path');
  }
  const absolute = path.isAbsolute(input) ? input : `${process.cwd()}${path.sep}${input}`;
  const suffix = [];
  let ancestor = absolute;
  for (;;) {
    try { fs.lstatSync(ancestor); break; } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const component = path.basename(ancestor);
      if (!component || component === '.' || component === '..') throw new Error('dot traversal');
      suffix.unshift(component);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const resolved = fs.realpathSync.native(ancestor);
  if (suffix.length > 0 && !fs.statSync(resolved).isDirectory()) throw new Error('bad ancestor');
  process.stdout.write(path.join(resolved, ...suffix));
} catch (error) {
  process.stderr.write(`cannot safely canonicalize drill path: ${error?.code ?? error?.message}\n`);
  process.exit(1);
}
NODE
}
DRILL_TEMP_ROOT="${TMPDIR:-/tmp}"
DRILL_TEMP_CANON="$(canonical_drill_path "$DRILL_TEMP_ROOT")" \
  || die_code 1 "restore drill FAILED: cannot safely resolve TMPDIR"
[ -d "$DRILL_TEMP_CANON" ] \
  || die_code 1 "restore drill FAILED: TMPDIR is not an existing directory"
DATA_CANON="$(canonical_drill_path "$DATA_DIR")" \
  || die_code 1 "restore drill FAILED: cannot safely resolve DATA_DIR"
case "$DRILL_TEMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    die_code 1 "restore drill FAILED: TMPDIR is inside DATA_DIR"
    ;;
esac

TMP="$(mktemp -d "$DRILL_TEMP_CANON/cosmos-restore-drill.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Defense in depth: the drill target must be disjoint from the live state store.
TMP_CANON="$(canonical_drill_path "$TMP")"
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
  add_check eventsCount false "restore failed before an immutable events-count comparison could complete"
  add_check evidenceArchives false "restore failed before an immutable archive-count comparison could complete"
  add_check archiveIntegrity false "restore failed before archive hash, size, and member-inventory verification completed"
  if [ ! -e "$TMP/restore" ] && [ ! -L "$TMP/restore" ]; then
    add_check targetAbsentAfterFailure true "failed restore did not create its isolated target"
  else
    add_check targetAbsentAfterFailure false "failed restore mutated or created its isolated target"
  fi
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

  if DECLARED_ARCHIVES="$(json_get "$TMP/restore/restore-report.json" declaredEvidenceArchives)" \
      && RESTORED_ARCHIVES="$(json_get "$TMP/restore/restore-report.json" evidenceArchives)"; then
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

  if VERIFIED_ARCHIVES="$(json_get "$TMP/restore/restore-report.json" verifiedEvidenceArchives)" \
      && ARCHIVE_VERIFICATION="$(json_get "$TMP/restore/restore-report.json" archiveVerification)" \
      && [ "$ARCHIVE_VERIFICATION" = "EXACT_MANIFEST_INVENTORY_HASH_SIZE_MEMBER_VERIFIED" ] \
      && [ -n "${RESTORED_ARCHIVES:-}" ] \
      && [ "$VERIFIED_ARCHIVES" = "$RESTORED_ARCHIVES" ]; then
    add_check archiveIntegrity true "exact manifest inventory plus immutable archive hashes, sizes, and member inventories verified for $VERIFIED_ARCHIVES archives"
  else
    add_check archiveIntegrity false "restore report did not prove exact archive inventory, hashes, sizes, and members"
    FAILED=1
  fi

  WANT_COUNT="$(json_get "$TMP/restore/restore-report.json" declaredEventsCount || echo -1)"
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
