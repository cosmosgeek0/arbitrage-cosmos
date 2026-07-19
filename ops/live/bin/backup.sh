#!/usr/bin/env bash
# ops/live/bin/backup.sh — application-consistent backup of the state store.
#
# §24.2: application-consistent DB backup + model/evidence path backup policy.
#
# The SQLite ledger ($DATA_DIR/cosmos.db, WAL mode) is captured with the
# SQLite online backup API (`.backup`), which is safe against a live writer
# and produces a single consistent file including WAL content — never `cp`.
# Every backup is integrity-checked before it is published: the working
# directory is `.partial-*` and is renamed to its final name only after all
# checks pass, so a half-written backup can never be mistaken for a real one.
#
# Usage:
#   backup.sh [--env-file <file>]            run one backup + retention prune
#   backup.sh --verify-latest [--env-file f] exit 1 if newest backup is stale
#             (this powers the §23 "backup stale" alarm via the watchdog)
#
# Layout:  $BACKUP_DIR/<utc-stamp>/{cosmos.db,manifest.json,evidence-N.tar.gz}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-backup

ENV_FILE="" VERIFY_LATEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --verify-latest) VERIFY_LATEST=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
: "${BACKUP_RETENTION_COUNT:=14}"
: "${BACKUP_MAX_AGE_HOURS:=26}"
: "${EVIDENCE_PATHS:=}"
: "${EVIDENCE_MISSING_POLICY:=fail}"
: "${BACKUP_LOCK:=$BACKUP_DIR/.lock}"
require_cmd "$NODE" "$SQLITE" tar

# Completed backups are directories named by UTC stamp; anything starting
# with "." (.partial-*, .lock) is never a completed backup.
latest_completed() {
  ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort | tail -1 || true
}

# --- staleness verification (read-only; no lock) -------------------------------
if [ "$VERIFY_LATEST" = 1 ]; then
  latest="$(latest_completed)"
  [ -n "$latest" ] || die_code 1 "no completed backup found in $BACKUP_DIR"
  created="$(json_get "$BACKUP_DIR/$latest/manifest.json" createdAtUtc)" \
    || die_code 1 "latest backup $latest has no readable manifest"
  age_hours="$("$NODE" -e '
    const created = Date.parse(process.argv[1]);
    if (Number.isNaN(created)) process.exit(1);
    process.stdout.write(String((Date.now() - created) / 3600000));
  ' "$created")" || die_code 1 "latest backup $latest has an unparseable createdAtUtc"
  if "$NODE" -e 'process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 1 : 0)' \
      "$age_hours" "$BACKUP_MAX_AGE_HOURS"; then
    ops_log "latest backup $latest is fresh (${age_hours%.*}h old, limit ${BACKUP_MAX_AGE_HOURS}h)"
    exit 0
  fi
  die_code 1 "latest backup $latest is STALE (${age_hours%.*}h old, limit ${BACKUP_MAX_AGE_HOURS}h)"
fi

# --- one backup run -------------------------------------------------------------
DB="$DATA_DIR/cosmos.db"
[ -f "$DB" ] || die_code 1 "state store not found: $DB"
mkdir -p "$BACKUP_DIR"

acquire_lock "$BACKUP_LOCK" || die_code 4 "backup lock busy: $BACKUP_LOCK"
BACKUP_ID="$(now_stamp)"
[ -e "$BACKUP_DIR/$BACKUP_ID" ] && BACKUP_ID="$BACKUP_ID-$$"
WORK="$BACKUP_DIR/.partial-$BACKUP_ID"
cleanup() { rm -rf "$WORK"; release_lock "$BACKUP_LOCK"; }
trap cleanup EXIT
mkdir -p "$WORK"

# F-106: $WORK is embedded inside a single-quoted SQL literal below; a quote,
# backslash, or newline in BACKUP_DIR would silently corrupt the .backup
# command. Refuse such paths loudly.
BACKUP_DIR_NL="$(printf '\nx')"; BACKUP_DIR_NL="${BACKUP_DIR_NL%x}"
case "$BACKUP_DIR" in
  (*"'"*|*"\\"*|*"$BACKUP_DIR_NL"*) die_code 1 "BACKUP_DIR must not contain quotes, backslashes, or newlines: $BACKUP_DIR" ;;
esac

# SQLite online backup API: consistent snapshot even with a live WAL writer.
"$SQLITE" "$DB" ".backup '$WORK/cosmos.db'"
INTEGRITY="$("$SQLITE" "$WORK/cosmos.db" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || die_code 1 "integrity_check failed on fresh backup: $INTEGRITY"
EVENTS_COUNT="$("$SQLITE" "$WORK/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
# F-105: an unreadable events count means the fresh backup cannot be verified
# against expectations; publishing it as result=SUCCESS with eventsCount=-1
# buried the failure. Fail loudly instead.
[ "$EVENTS_COUNT" != "-1" ] || die_code 1 "events count unreadable on fresh backup; refusing to publish an unverifiable backup"

# Evidence/model paths (colon-separated). Policy decides whether a missing
# path fails the backup (default) or is recorded and skipped.
EVIDENCE_ARGS=""
i=0
if [ -n "$EVIDENCE_PATHS" ]; then
  OLD_IFS="$IFS"; IFS=':'
  for p in $EVIDENCE_PATHS; do
    IFS="$OLD_IFS"
    [ -n "$p" ] || { IFS=':'; continue; }
    if [ -e "$p" ]; then
      i=$((i + 1))
      arch="evidence-$i.tar.gz"
      tar -czf "$WORK/$arch" -C "$(dirname "$p")" "$(basename "$p")"
      EVIDENCE_ARGS="$EVIDENCE_ARGS
$p|$arch|$(sha256_file "$WORK/$arch")"
    else
      case "$EVIDENCE_MISSING_POLICY" in
        skip)
          ops_log "evidence path missing, skipped by policy: $p"
          EVIDENCE_ARGS="$EVIDENCE_ARGS
$p|MISSING|"
          ;;
        *) die_code 1 "evidence path missing: $p (EVIDENCE_MISSING_POLICY=$EVIDENCE_MISSING_POLICY)" ;;
      esac
    fi
    IFS=':'
  done
  IFS="$OLD_IFS"
fi

DATA_SCHEMA="null"
if [ -f "$JOURNAL_FILE" ]; then
  DATA_SCHEMA="$(json_get "$JOURNAL_FILE" dataSchema || echo null)"
fi
DB_SHA="$(sha256_file "$WORK/cosmos.db")"
DB_BYTES="$(wc -c < "$WORK/cosmos.db" | tr -d ' ')"

"$NODE" -e '
  const fs = require("fs");
  const [work, backupId, createdAtUtc, dbSha256, dbBytes, eventsCount, dataSchema, evidenceRaw] = process.argv.slice(1);
  const evidence = evidenceRaw.split("\n").filter(Boolean).map((line) => {
    const [source, archive, sha256] = line.split("|");
    return archive === "MISSING"
      ? { source, missing: true }
      : { source, archive, sha256 };
  });
  const manifest = {
    backupId, createdAtUtc,
    dbFile: "cosmos.db",
    dbSha256,
    dbBytes: Number(dbBytes),
    eventsCount: Number(eventsCount),
    dataSchema: dataSchema === "null" ? null : Number(dataSchema),
    integrityCheck: "ok",
    evidence,
  };
  fs.writeFileSync(work + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
' "$WORK" "$BACKUP_ID" "$(now_utc)" "$DB_SHA" "$DB_BYTES" "$EVENTS_COUNT" "$DATA_SCHEMA" "$EVIDENCE_ARGS"

# Publish: rename is the completeness marker.
"$NODE" -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$WORK" "$BACKUP_DIR/$BACKUP_ID"
WORK="$BACKUP_DIR/.partial-$BACKUP_ID-gone"   # cleanup() must not delete the published dir
ops_log "backup $BACKUP_ID published (events=$EVENTS_COUNT, sha256=$DB_SHA)"

# Retention: keep the newest $BACKUP_RETENTION_COUNT completed backups.
COMPLETED="$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort)"
N="$(printf '%s\n' "$COMPLETED" | grep -c . || true)"
if [ "$N" -gt "$BACKUP_RETENTION_COUNT" ]; then
  printf '%s\n' "$COMPLETED" | head -n $((N - BACKUP_RETENTION_COUNT)) | while read -r old; do
    [ -n "$old" ] || continue
    ops_log "retention: pruning old backup $old"
    rm -rf "$BACKUP_DIR/$old"
  done
fi
# Stale partials (crashed runs) older than 12h are garbage-collected.
find "$BACKUP_DIR" -maxdepth 1 -name '.partial-*' -mmin +720 -exec rm -rf {} + 2>/dev/null || true

jsonl_append "$OPS_STATE_DIR/backup-log.jsonl" "ts=$(now_utc)" "tool=backup" \
  "backupId=$BACKUP_ID" "result=SUCCESS" "eventsCount=$EVENTS_COUNT" "dbSha256=$DB_SHA"
exit 0
