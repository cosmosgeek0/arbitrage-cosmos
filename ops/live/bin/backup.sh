#!/bin/bash -p
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
#   backup.sh [--env-file <file>]            run one backup; staging-only
#                                              calls retain legacy pruning
#   backup.sh --verify-latest [--env-file f] exit 1 if newest backup is stale
#             (this powers the §23 "backup stale" alarm via the watchdog)
#
# Layout:  $BACKUP_DIR/<utc-stamp>/{cosmos.db,manifest.json,evidence-N.tar.gz}
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
readonly PATH
case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf '%s\n' 'FATAL: backup.sh requires an explicit script path' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf '%s\n' 'FATAL: backup.sh script directory is unavailable' >&2; exit 1; }
unset _I00_ENTRY_DIR
# shellcheck source=common.sh
if [ "${_I00_AUTHORIZED_COMMON_READY:-0}" != 1 ]; then
  . "$SCRIPT_DIR/common.sh"
fi
type require_i00_effect_class >/dev/null 2>&1 \
  || { printf '%s\n' 'FATAL: backup.sh common bootstrap is unavailable' >&2; exit 1; }
OPS_LOG_TAG=cosmos-backup

ENV_FILE="" ENV_DESCRIPTOR="" VERIFY_LATEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      [ -z "$ENV_FILE" ] && [ -z "$ENV_DESCRIPTOR" ] \
        || die_code 1 "named and descriptor environments are exclusive and single-use"
      ENV_FILE="${2:?--env-file needs a value}"
      shift 2
      ;;
    --i00-effect-environment-fd)
      [ -z "$ENV_FILE" ] && [ -z "$ENV_DESCRIPTOR" ] \
        || die_code 1 "named and descriptor environments are exclusive and single-use"
      [ "${2:-}" = 12 ] || die_code 1 "effect environment descriptor must be 12"
      ENV_DESCRIPTOR=12
      ENV_FILE=/proc/self/fd/12
      shift 2
      ;;
    --verify-latest) VERIFY_LATEST=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

if [ "$VERIFY_LATEST" = 1 ] && [ -n "$ENV_FILE" ]; then
  die_code 1 "--verify-latest does not accept an env file"
fi
if [ "$VERIFY_LATEST" != 1 ] \
    && [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_i00_effect_class BACKUP_CREATE
fi
require_i00_effect_env_file_binding "$ENV_FILE"
load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
: "${BACKUP_RETENTION_COUNT:=14}"
: "${BACKUP_MAX_AGE_HOURS:=26}"
: "${EVIDENCE_PATHS:=}"
: "${EVIDENCE_MISSING_POLICY:=fail}"
: "${BACKUP_LOCK:=$BACKUP_DIR/.lock}"
: "${TAR:=tar}"
: "${GZIP:=gzip}"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    && [ -n "$EVIDENCE_PATHS" ]; then
  die_code 1 "authorized BACKUP_CREATE does not permit EVIDENCE_PATHS without an explicit retained read capability"
fi
DATA_DIR="$(exact_existing_directory_path "$DATA_DIR")" \
  || die_code 1 "DATA_DIR must be one exact raw canonical non-symlink directory"
OPS_STATE_DIR="$(exact_raw_canonical_path "$OPS_STATE_DIR")" \
  || die_code 1 "OPS_STATE_DIR must be one exact raw canonical absolute path"
BACKUP_DIR="$(exact_raw_canonical_path "$BACKUP_DIR")" \
  || die_code 1 "BACKUP_DIR must be one exact raw canonical absolute path"
BACKUP_LOCK="$(exact_raw_canonical_path "$BACKUP_LOCK")" \
  || die_code 1 "BACKUP_LOCK must be one exact raw canonical absolute path"
JOURNAL_FILE="$(exact_raw_canonical_path "$JOURNAL_FILE")" \
  || die_code 1 "JOURNAL_FILE must be one exact raw canonical absolute path"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_all_authorized_write_root_bindings
  require_authorized_write_root_binding opsStateDir "$OPS_STATE_DIR"
  require_authorized_write_root_binding backupDir "$BACKUP_DIR"
  require_authorized_read_root_binding dataDir "$DATA_DIR"
fi
OPS_EFFECT_STATE_DIR="$(authorized_write_effect_path opsStateDir "$OPS_STATE_DIR")"
BACKUP_EFFECT_DIR="$(authorized_write_effect_path backupDir "$BACKUP_DIR")"
BACKUP_EFFECT_LOCK="$(authorized_write_effect_path backupDir "$BACKUP_LOCK")"
DATA_EFFECT_DIR="$(authorized_read_effect_path dataDir "$DATA_DIR")"
JOURNAL_EFFECT_FILE="$(authorized_read_effect_path dataDir "$JOURNAL_FILE")"

if [ "$VERIFY_LATEST" != 1 ]; then
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
      || any_path_effectively_intersects_protected_union \
        "$DATA_DIR" "$OPS_STATE_DIR" "$BACKUP_DIR" "$BACKUP_LOCK"; then
    require_i00_effect_class BACKUP_CREATE
  fi
  require_nonroot_direct_effect_or_i00_class
  require_i00_effect_node_binding
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    require_trusted_effect_executable "$SQLITE" SQLITE
    require_trusted_effect_executable "$TAR" TAR
    require_trusted_effect_executable "$GZIP" GZIP
    require_trusted_effect_executable "$HASH" HASH
  fi
fi

require_cmd "$NODE" "$SQLITE" "$TAR"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_cmd "$GZIP"
fi

# Completed backups are directories named by UTC stamp; anything starting
# with "." (.partial-*, .lock) is never a completed backup.
latest_completed() {
  completed_backup_inventory latest "$BACKUP_EFFECT_DIR"
}

# --- staleness verification (read-only; no lock) -------------------------------
if [ "$VERIFY_LATEST" = 1 ]; then
  latest="$(latest_completed)"
  [ -n "$latest" ] || die_code 1 "no completed backup found in $BACKUP_DIR"
  created="$(json_get "$BACKUP_EFFECT_DIR/$latest/manifest.json" createdAtUtc)" \
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
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
  fs_mkdir_p "$BACKUP_DIR"
  BACKUP_DIR="$(exact_existing_directory_path "$BACKUP_DIR")" \
    || die_code 1 "BACKUP_DIR could not be created as one exact non-symlink directory"
fi
DB="$DATA_EFFECT_DIR/cosmos.db"
[ -f "$DB" ] || die_code 1 "state store not found: $DATA_DIR/cosmos.db"

acquire_lock "$BACKUP_EFFECT_LOCK" || die_code 4 "backup lock busy: $BACKUP_LOCK"
BACKUP_ID="$(now_stamp)"
[ -e "$BACKUP_EFFECT_DIR/$BACKUP_ID" ] && BACKUP_ID="$BACKUP_ID-$$"
WORK="$BACKUP_EFFECT_DIR/.partial-$BACKUP_ID"
WORK_OWNED=0
cleanup() {
  if [ "$WORK_OWNED" = 1 ]; then fs_remove_tree "$WORK"; fi
  release_lock "$BACKUP_EFFECT_LOCK"
}
trap cleanup EXIT
[ ! -e "$WORK" ] && [ ! -L "$WORK" ] \
  || die_code 1 "refusing pre-existing backup work path: $WORK"
fs_mkdir_exclusive "$WORK" || die_code 1 "cannot create private backup work path: $WORK"
WORK_OWNED=1

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
    p="$(exact_raw_canonical_path "$p")" \
      || die_code 1 "evidence input must be one exact raw canonical absolute path"
    if [ -e "$p" ]; then
      p="$(exact_existing_nonsymlink_path "$p")" \
        || die_code 1 "evidence input must be one exact non-symlink file or directory"
      i=$((i + 1))
      arch="evidence-$i.tar.gz"
      if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
        [ "$GZIP" = /proc/self/fd/39 ] \
          || die_code 1 "authorized backup gzip differs from descriptor 39"
        "$TAR" --use-compress-program=/proc/self/fd/39 \
          -cf "$WORK/$arch" -C "$(path_dirname "$p")" "$(path_basename "$p")"
      else
        "$TAR" -czf "$WORK/$arch" -C "$(path_dirname "$p")" "$(path_basename "$p")"
      fi
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
if [ -f "$JOURNAL_EFFECT_FILE" ]; then
  DATA_SCHEMA="$(json_get "$JOURNAL_EFFECT_FILE" dataSchema || echo null)"
fi
DB_SHA="$(sha256_file "$WORK/cosmos.db")"
DB_BYTES="$(i00_guard_node -e '
  process.stdout.write(String(require("fs").statSync(process.argv[1]).size));
' "$WORK/cosmos.db")"

i00_guard_node -e '
  const fs = require("fs");
  const [work, backupId, createdAtUtc, dbSha256, dbBytes, eventsCount, dataSchema, evidenceRaw] = process.argv.slice(1);
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  };
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
  fs.writeFileSync(
    work + "/manifest.json",
    JSON.stringify(canonical(manifest), null, 2) + "\n",
  );
' "$WORK" "$BACKUP_ID" "$(now_utc)" "$DB_SHA" "$DB_BYTES" "$EVENTS_COUNT" "$DATA_SCHEMA" "$EVIDENCE_ARGS"

# Publish only after every artifact and the working directory are durable. The
# retained parent directory is fsynced after the rename completeness marker.
fs_publish_directory_durable \
  "$WORK" "$BACKUP_EFFECT_DIR/$BACKUP_ID" "$BACKUP_EFFECT_DIR"
WORK_OWNED=0
WORK=""
require_all_authorized_write_root_bindings
require_authorized_read_root_binding dataDir "$DATA_DIR"
ops_log "backup $BACKUP_ID published (events=$EVENTS_COUNT, sha256=$DB_SHA)"

# BACKUP_CREATE authorizes exactly one new publication. It does not authorize
# deletion of any completed backup or any partial left by another invocation.
# Maintenance cleanup requires a separately ratified action class.
if ! i00_effect_class_is BACKUP_CREATE; then
  # Legacy/staging donor behavior: keep the newest configured count and clear
  # stale crashed-run partials.
  PRUNED_BACKUPS="$(
    completed_backup_inventory prune "$BACKUP_DIR" "$BACKUP_RETENTION_COUNT"
  )" || die_code 1 "completed backup retention inventory is unsafe"
  if [ -n "$PRUNED_BACKUPS" ]; then
    while IFS= read -r old; do
      [ -n "$old" ] || continue
      ops_log "retention: pruned old backup $old"
    done <<EOF
$PRUNED_BACKUPS
EOF
  fi
  i00_guard_node - "$BACKUP_DIR" <<'NODE' || true
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const cutoff = Date.now() - (720 * 60 * 1000);
for (const name of fs.readdirSync(root)) {
  if (!name.startsWith('.partial-')) continue;
  const target = path.join(root, name);
  let stat;
  try { stat = fs.lstatSync(target); } catch { continue; }
  if (stat.mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
}
NODE
fi

jsonl_append "$OPS_EFFECT_STATE_DIR/backup-log.jsonl" "ts=$(now_utc)" "tool=backup" \
  "backupId=$BACKUP_ID" "result=SUCCESS" "eventsCount=$EVENTS_COUNT" "dbSha256=$DB_SHA"
require_all_authorized_write_root_bindings
require_authorized_read_root_binding dataDir "$DATA_DIR"
if i00_effect_class_is BACKUP_CREATE; then
  [ "$_I00_EFFECT_OUTPUT_FD" = /proc/self/fd/53 ] \
    || die_code 1 "authorized backup effect-output descriptor is invalid"
  i00_guard_node - "$_I00_AUTHORIZED_EFFECT_CLAIM_KEY" "$BACKUP_ID" <<'NODE' \
    || die_code 1 "authorized backup effect-output publication failed"
const fs = require('node:fs');
const [claimKey, backupId] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/u.test(claimKey)
    || !/^[0-9]{8}T[0-9]{6}Z(?:-[1-9][0-9]*)?$/u.test(backupId)) {
  process.exit(1);
}
const output = {
  actionClass: 'BACKUP_CREATE',
  claimKey,
  kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',
  outputRelativePath: backupId,
  receiptRelativePath: `${backupId}/manifest.json`,
  schemaVersion: 1,
  status: 'OUTPUT_REPORTED',
  writeRootName: 'backupDir',
};
const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (bytes.length > 4096 || fs.writeSync(53, bytes) !== bytes.length) {
  process.exit(1);
}
NODE
  exec 53>&-
fi
exit 0
