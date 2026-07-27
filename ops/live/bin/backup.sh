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
  VERIFY_PROOF="$(
    i00_guard_node - \
      "$BACKUP_EFFECT_DIR/$latest/manifest.json" \
      "$BACKUP_EFFECT_DIR/$latest/cosmos.db" "$latest" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [manifestPath, databasePath, expectedBackupId] = process.argv.slice(2);
const exactKeys = (value, expected) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};
const readExactRegular = (file, maxBytes, expectedBytes = null) => {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size < 1n || before.size > BigInt(maxBytes)
      || (expectedBytes !== null && before.size !== BigInt(expectedBytes))) {
    throw new Error('unsafe backup file');
  }
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs
        || opened.ctimeNs !== before.ctimeNs) throw new Error('backup file changed');
    const digest = crypto.createHash('sha256');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0n;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, count));
      digest.update(chunk);
      if (maxBytes <= 1024 * 1024) chunks.push(chunk);
      total += BigInt(count);
      if (total > BigInt(maxBytes)) throw new Error('backup file grew');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(file, { bigint: true });
    if (total !== before.size || after.dev !== before.dev || after.ino !== before.ino
        || after.size !== before.size || after.mtimeNs !== before.mtimeNs
        || after.ctimeNs !== before.ctimeNs || named.dev !== before.dev
        || named.ino !== before.ino || named.size !== before.size
        || named.mtimeNs !== before.mtimeNs || named.ctimeNs !== before.ctimeNs) {
      throw new Error('backup file changed');
    }
    return { bytes: Buffer.concat(chunks), sha256: digest.digest('hex') };
  } finally {
    fs.closeSync(descriptor);
  }
};
const manifestRead = readExactRegular(manifestPath, 1024 * 1024);
const manifestText = manifestRead.bytes.toString('utf8');
const manifest = JSON.parse(manifestText);
const keys = [
  'schemaVersion', 'backupId', 'createdAtUtc', 'dbFile', 'dbSha256',
  'dbBytes', 'eventsCount', 'journalState', 'dataSchema', 'rollbackFloor',
  'sourceJournalSha256', 'integrityCheck', 'evidence',
];
if (!exactKeys(manifest, keys)
    || manifest.schemaVersion !== 2
    || manifest.backupId !== expectedBackupId
    || manifest.dbFile !== 'cosmos.db'
    || !/^[0-9a-f]{64}$/u.test(manifest.dbSha256)
    || !Number.isSafeInteger(manifest.dbBytes) || manifest.dbBytes <= 0
    || !Number.isSafeInteger(manifest.eventsCount) || manifest.eventsCount < 0
    || manifest.journalState !== 'PRESENT'
    || !Number.isSafeInteger(manifest.dataSchema) || manifest.dataSchema < 1
    || !Number.isSafeInteger(manifest.rollbackFloor) || manifest.rollbackFloor < 0
    || manifest.rollbackFloor > manifest.dataSchema
    || !/^[0-9a-f]{64}$/u.test(manifest.sourceJournalSha256)
    || manifest.integrityCheck !== 'ok'
    || typeof manifest.createdAtUtc !== 'string'
    || !Number.isFinite(Date.parse(manifest.createdAtUtc))
    || !Array.isArray(manifest.evidence)
    || manifest.evidence.length > 10000
    || manifestText !== `${JSON.stringify(canonical(manifest), null, 2)}\n`) {
  throw new Error('latest manifest is not one exact restorable v2 backup');
}
for (let index = 0; index < manifest.evidence.length; index += 1) {
  const item = manifest.evidence[index];
  if (typeof item?.source !== 'string' || item.source.length === 0
      || /[\0-\x1f\x7f]/u.test(item.source)
      || !(item.missing === true
        ? exactKeys(item, ['source', 'missing'])
        : exactKeys(item, ['source', 'archive', 'sha256'])
          && item.archive === `evidence-${index + 1}.tar.gz`
          && /^[0-9a-f]{64}$/u.test(item.sha256))) {
    throw new Error('latest manifest evidence is invalid');
  }
}
const database = readExactRegular(
  databasePath,
  Number.MAX_SAFE_INTEGER,
  manifest.dbBytes,
);
if (database.sha256 !== manifest.dbSha256) throw new Error('latest database digest differs');
process.stdout.write([
  manifest.createdAtUtc, manifest.eventsCount, manifest.dataSchema,
  manifest.rollbackFloor,
].join('|'));
NODE
  )" || die_code 1 "latest backup $latest is not one exact restorable v2 generation"
  IFS='|' read -r \
    created VERIFY_EVENTS_COUNT VERIFY_DATA_SCHEMA VERIFY_ROLLBACK_FLOOR \
    <<EOF
$VERIFY_PROOF
EOF
  VERIFY_INTEGRITY="$(
    "$SQLITE" "$BACKUP_EFFECT_DIR/$latest/cosmos.db" \
      'PRAGMA integrity_check;' 2>/dev/null
  )" || die_code 1 "latest backup $latest database integrity is unreadable"
  [ "$VERIFY_INTEGRITY" = ok ] \
    || die_code 1 "latest backup $latest database integrity check failed"
  VERIFY_ACTUAL_EVENTS="$(
    "$SQLITE" "$BACKUP_EFFECT_DIR/$latest/cosmos.db" \
      'SELECT COUNT(*) FROM events;' 2>/dev/null
  )" || die_code 1 "latest backup $latest events count is unreadable"
  [ "$VERIFY_ACTUAL_EVENTS" = "$VERIFY_EVENTS_COUNT" ] \
    || die_code 1 "latest backup $latest events count differs from its manifest"
  VERIFY_USER_VERSION="$(
    "$SQLITE" "$BACKUP_EFFECT_DIR/$latest/cosmos.db" \
      'PRAGMA user_version;' 2>/dev/null
  )" || die_code 1 "latest backup $latest user_version is unreadable"
  VERIFY_COMPATIBILITY_RAW="$(
    "$SQLITE" "$BACKUP_EFFECT_DIR/$latest/cosmos.db" \
      'SELECT typeof(singleton), singleton, typeof(current_schema_version), current_schema_version, typeof(rollback_floor), rollback_floor FROM ledger_schema_compatibility ORDER BY singleton;' \
      2>/dev/null
  )" || die_code 1 "latest backup $latest compatibility row is unreadable"
  VERIFY_COMPATIBILITY="$(
    i00_guard_node -e '
      const [versionRaw, rowRaw] = process.argv.slice(1);
      const integer = /^(?:0|[1-9][0-9]*)$/u;
      const lines = rowRaw.split("\n");
      if (!/^[1-9][0-9]*$/u.test(versionRaw)
          || BigInt(versionRaw) > BigInt(Number.MAX_SAFE_INTEGER)
          || lines.length !== 1) process.exit(1);
      const fields = lines[0].split("|");
      if (fields.length !== 6
          || fields[0] !== "integer" || fields[1] !== "1"
          || fields[2] !== "integer" || fields[4] !== "integer"
          || !/^[1-9][0-9]*$/u.test(fields[3]) || !integer.test(fields[5])
          || BigInt(fields[3]) > BigInt(Number.MAX_SAFE_INTEGER)
          || BigInt(fields[5]) > BigInt(Number.MAX_SAFE_INTEGER)
          || fields[3] !== versionRaw || BigInt(fields[5]) > BigInt(fields[3])) {
        process.exit(1);
      }
      process.stdout.write(`${fields[3]}|${fields[5]}`);
    ' "$VERIFY_USER_VERSION" "$VERIFY_COMPATIBILITY_RAW"
  )" || die_code 1 "latest backup $latest compatibility row is malformed"
  [ "$VERIFY_COMPATIBILITY" = \
      "$VERIFY_DATA_SCHEMA|$VERIFY_ROLLBACK_FLOOR" ] \
    || die_code 1 "latest backup $latest schema/floor differs from its manifest"
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

# Bind the database copy to one exact, steady compatibility generation. The
# backup lock deliberately does not serialize deployment, so this snapshot is
# repeated after every source read below. PENDING is a committed-forward
# deployment state, not a restorable backup generation.
set +e
BACKUP_JOURNAL_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
BACKUP_JOURNAL_SNAPSHOT_RC=$?
set -e
case "$BACKUP_JOURNAL_SNAPSHOT_RC" in
  0) ;;
  5) die_code 1 "backup refused: journal document or rollbackFloor is invalid" ;;
  6) die_code 1 "backup refused: journal endpoint is not one bounded single-link regular file" ;;
  7) die_code 1 "backup refused: journal dataSchema is invalid" ;;
  8) die_code 1 "backup refused: journal rollbackFloor exceeds dataSchema" ;;
  *) die_code 1 "backup refused: journal is unreadable or unstable" ;;
esac
IFS='|' read -r \
  BACKUP_JOURNAL_STATE DATA_SCHEMA ROLLBACK_FLOOR \
  BACKUP_JOURNAL_DEV BACKUP_JOURNAL_INO BACKUP_JOURNAL_BYTES \
  BACKUP_JOURNAL_MTIME BACKUP_JOURNAL_CTIME BACKUP_JOURNAL_SHA256 \
  <<EOF
$BACKUP_JOURNAL_SNAPSHOT
EOF
[ "$BACKUP_JOURNAL_STATE" = PRESENT ] \
  || die_code 1 "backup refused: journal compatibility state is not steady PRESENT"

# SQLite online backup API: consistent snapshot even with a live WAL writer.
"$SQLITE" "$DB" ".backup '$WORK/cosmos.db'"
INTEGRITY="$("$SQLITE" "$WORK/cosmos.db" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || die_code 1 "integrity_check failed on fresh backup: $INTEGRITY"
EVENTS_COUNT="$("$SQLITE" "$WORK/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
# F-105: an unreadable events count means the fresh backup cannot be verified
# against expectations; publishing it as result=SUCCESS with eventsCount=-1
# buried the failure. Fail loudly instead.
[ "$EVENTS_COUNT" != "-1" ] || die_code 1 "events count unreadable on fresh backup; refusing to publish an unverifiable backup"
DB_USER_VERSION="$(
  "$SQLITE" "$WORK/cosmos.db" 'PRAGMA user_version;' 2>/dev/null
)" || die_code 1 "fresh backup user_version is unreadable"
DB_COMPATIBILITY_RAW="$(
  "$SQLITE" "$WORK/cosmos.db" \
    'SELECT typeof(singleton), singleton, typeof(current_schema_version), current_schema_version, typeof(rollback_floor), rollback_floor FROM ledger_schema_compatibility ORDER BY singleton;' \
    2>/dev/null
)" || die_code 1 "fresh backup compatibility row is unreadable"
DB_COMPATIBILITY="$(
  i00_guard_node -e '
    const [versionRaw, rowRaw] = process.argv.slice(1);
    const integer = /^(?:0|[1-9][0-9]*)$/u;
    if (!integer.test(versionRaw)
        || BigInt(versionRaw) > BigInt(Number.MAX_SAFE_INTEGER)) process.exit(1);
    const lines = rowRaw.split("\n");
    if (lines.length !== 1) process.exit(1);
    const fields = lines[0].split("|");
    if (fields.length !== 6
        || fields[0] !== "integer" || fields[1] !== "1"
        || fields[2] !== "integer" || fields[4] !== "integer"
        || !/^[1-9][0-9]*$/u.test(fields[3]) || !integer.test(fields[5])
        || BigInt(fields[3]) > BigInt(Number.MAX_SAFE_INTEGER)
        || BigInt(fields[5]) > BigInt(Number.MAX_SAFE_INTEGER)
        || fields[3] !== versionRaw || BigInt(fields[5]) > BigInt(fields[3])) {
      process.exit(1);
    }
    process.stdout.write(`${fields[3]}|${fields[5]}`);
  ' "$DB_USER_VERSION" "$DB_COMPATIBILITY_RAW"
)" || die_code 1 "fresh backup compatibility row is malformed or disagrees with user_version"
[ "$DB_COMPATIBILITY" = "$DATA_SCHEMA|$ROLLBACK_FLOOR" ] \
  || die_code 1 \
    "fresh backup schema/floor does not match the bound journal compatibility generation"

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

# Refuse publication if deployment changed the journal at any point after the
# first snapshot, including while the online database copy or evidence reads
# were in progress.
set +e
BACKUP_JOURNAL_SNAPSHOT_AFTER="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
BACKUP_JOURNAL_SNAPSHOT_AFTER_RC=$?
set -e
[ "$BACKUP_JOURNAL_SNAPSHOT_AFTER_RC" -eq 0 ] \
  && [ "$BACKUP_JOURNAL_SNAPSHOT_AFTER" = "$BACKUP_JOURNAL_SNAPSHOT" ] \
  || die_code 1 \
    "backup refused: journal compatibility generation changed during capture"
DB_SHA="$(sha256_file "$WORK/cosmos.db")"
DB_BYTES="$(i00_guard_node -e '
  process.stdout.write(String(require("fs").statSync(process.argv[1]).size));
' "$WORK/cosmos.db")"

i00_guard_node -e '
  const fs = require("fs");
  const [
    work, backupId, createdAtUtc, dbSha256, dbBytes, eventsCount,
    dataSchema, rollbackFloor, sourceJournalSha256, evidenceRaw,
  ] = process.argv.slice(1);
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
    schemaVersion: 2,
    backupId, createdAtUtc,
    dbFile: "cosmos.db",
    dbSha256,
    dbBytes: Number(dbBytes),
    eventsCount: Number(eventsCount),
    journalState: "PRESENT",
    dataSchema: Number(dataSchema),
    rollbackFloor: Number(rollbackFloor),
    sourceJournalSha256,
    integrityCheck: "ok",
    evidence,
  };
  fs.writeFileSync(
    work + "/manifest.json",
    JSON.stringify(canonical(manifest), null, 2) + "\n",
  );
' "$WORK" "$BACKUP_ID" "$(now_utc)" "$DB_SHA" "$DB_BYTES" "$EVENTS_COUNT" \
  "$DATA_SCHEMA" "$ROLLBACK_FLOOR" "$BACKUP_JOURNAL_SHA256" "$EVIDENCE_ARGS"

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
