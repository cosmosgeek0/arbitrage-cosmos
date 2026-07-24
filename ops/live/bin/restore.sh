#!/bin/bash -p
# ops/live/bin/restore.sh — restore a backup into an explicit target directory.
#
# §24.2: periodic restore tests run against an ISOLATED copy, never the
# production state store. DF-32 removes the legacy production-restore bypass:
# every target inside DATA_DIR is unconditionally unavailable. The retained
# --allow-production argument fails closed so old operator invocations cannot
# silently acquire a different meaning.
#
# Backup integrity is verified from a private, stable snapshot BEFORE anything
# is written to the target. The manifest must declare the exact backup
# inventory; every database/archive byte is copied through a held no-follow
# descriptor and checked for stable identity, size, and digest. Archives are
# path-checked, extracted privately, and rejected if they produce links or
# special files. Only that verified staging tree can be published.
#
# Usage:
#   restore.sh --backup <id|dir|latest> --target <dir>
#              [--env-file <file>] [--allow-production] [--force]
#
# Exit codes:
#   0 restored;  1 bad arguments/backup/target;  2 production-path refusal
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE
case "$0" in
  /*) _I00_SCRIPT_PATH="$0" ;;
  */*) _I00_SCRIPT_PATH="$PWD/$0" ;;
  *) printf '%s\n' "restore.sh requires an explicit script path" >&2; exit 1 ;;
esac
SCRIPT_DIR="${_I00_SCRIPT_PATH%/*}"
[ "$SCRIPT_DIR" != "$_I00_SCRIPT_PATH" ] || SCRIPT_DIR=/
SCRIPT_DIR="$(cd -P -- "$SCRIPT_DIR" && pwd -P)" \
  || { printf '%s\n' "restore.sh cannot bind its script directory" >&2; exit 1; }
unset _I00_SCRIPT_PATH
readonly SCRIPT_DIR
PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin
export PATH
readonly PATH
# shellcheck source=common.sh
if [ "${_I00_AUTHORIZED_COMMON_READY:-0}" != 1 ]; then
  . "$SCRIPT_DIR/common.sh"
fi
type require_i00_effect_class >/dev/null 2>&1 \
  || { printf '%s\n' 'FATAL: restore.sh common bootstrap is unavailable' >&2; exit 1; }
OPS_LOG_TAG=cosmos-restore

BACKUP_ARG="" TARGET="" ENV_FILE="" ENV_DESCRIPTOR="" ALLOW_PRODUCTION=0 FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_ARG="${2:?--backup needs a value}"; shift 2 ;;
    --target) TARGET="${2:?--target needs a value}"; shift 2 ;;
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
    --allow-production) ALLOW_PRODUCTION=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done
[ -n "$BACKUP_ARG" ] || die_code 1 "--backup is required (id, directory, or 'latest')"
[ -n "$TARGET" ] || die_code 1 "--target is required (explicit directory; no default)"

if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_i00_effect_class ISOLATED_RESTORE
fi
require_i00_effect_env_file_binding "$ENV_FILE"
load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
BACKUP_DIR="$(exact_existing_directory_path "$BACKUP_DIR")" \
  || die_code 1 "backup root must be one exact raw canonical non-symlink directory"
DATA_DIR="$(exact_existing_directory_path "$DATA_DIR")" \
  || die_code 1 "DATA_DIR must be one exact raw canonical non-symlink directory"

# Caller-selected restore endpoints must already use their exact lexical and
# physical spelling. Missing leaves are projected through the deepest existing
# ancestor by canonical_path; dot traversal or a symlink-parent alias changes
# that spelling and is refused rather than silently normalized.
exact_restore_endpoint() {
  local raw_endpoint lexical_endpoint physical_endpoint
  raw_endpoint="$1"
  case "$raw_endpoint" in
    /*) ;;
    *) return 1 ;;
  esac
  lexical_endpoint="$(i00_guard_node -e '
    const path = require("node:path");
    process.stdout.write(path.resolve(process.argv[1]));
  ' "$raw_endpoint")" || return 1
  [ "$lexical_endpoint" = "$raw_endpoint" ] || return 1
  physical_endpoint="$(canonical_path "$raw_endpoint")" || return 1
  [ "$physical_endpoint" = "$raw_endpoint" ] || return 1
  printf '%s\n' "$physical_endpoint"
}
TARGET_CANON="$(exact_restore_endpoint "$TARGET")" \
  || die_code 1 "restore target must be one exact raw and physical canonical absolute path"
TARGET_PARENT="$(path_dirname "$TARGET_CANON")"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  TARGET_PARENT="$(exact_existing_directory_path "$TARGET_PARENT")" \
    || die_code 1 "restore target parent must be one exact raw canonical non-symlink directory"
else
  TARGET_PARENT="$(exact_raw_canonical_path "$TARGET_PARENT")" \
    || die_code 1 "restore target parent must be one exact raw canonical absolute path"
fi
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_all_authorized_write_root_bindings
  require_authorized_write_root_binding isolatedTargetParent "$TARGET_PARENT"
  require_authorized_observed_root_binding dataDir "$DATA_DIR"
  require_authorized_observed_root_binding backupDir "$BACKUP_DIR"
fi
TARGET_EFFECT_PARENT="$(authorized_write_effect_path \
  isolatedTargetParent "$TARGET_PARENT")"
TARGET_EFFECT_CANON="$TARGET_EFFECT_PARENT/$(path_basename "$TARGET_CANON")"

if path_effectively_within "$DATA_DIR" /var/lib/cosmos/data; then
  require_i00_effect_class ISOLATED_RESTORE
fi

if i00_effect_class_is ISOLATED_RESTORE; then
  [ "$NODE" = "$_I00_EFFECT_NODE" ] \
    || die_code 1 "ISOLATED_RESTORE NODE must match the bound guard interpreter"
  TAR_BIN="${TAR:-}"
  GZIP_BIN="${GZIP:-}"
  [ "$TAR_BIN" = /proc/self/fd/22 ] \
    && [ "$GZIP_BIN" = /proc/self/fd/39 ] \
    || die_code 1 "ISOLATED_RESTORE tar/gzip descriptors are invalid"
  require_trusted_effect_executable "$TAR_BIN" TAR
  require_trusted_effect_executable "$GZIP_BIN" GZIP
else
  TAR_BIN="$(command -v "${TAR:-tar}")" \
    || die_code 1 "required command missing: ${TAR:-tar}"
  TAR_BIN="$(i00_guard_node -e \
    'const fs=require("fs");process.stdout.write(fs.realpathSync.native(process.argv[1]))' \
    "$TAR_BIN")" \
    || die_code 1 "staging TAR cannot be canonicalized"
  GZIP_BIN=NONE
fi
require_cmd "$SQLITE" "$TAR_BIN"
if i00_effect_class_is ISOLATED_RESTORE; then
  require_cmd "$GZIP_BIN"
fi

# An isolated restore target is never allowed to intersect a fixed production
# tree, regardless of an overridable DATA_DIR. The shared guard resolves raw
# components through the deepest existing ancestor with its captured,
# identity-bound interpreter before comparing the complete protected union.
if path_effectively_intersects_protected_union "$TARGET_CANON"; then
  die_code 2 "isolated restore target intersects a fixed production root"
fi
if [ "${COSMOS_RESTORE_TEST_MODE:-0}" = 1 ]; then
  for restore_marker in \
    "${RESTORE_TEST_STAGE_READY_MARKER:-}" \
    "${RESTORE_TEST_STAGE_CONTINUE_MARKER:-}"
  do
    [ -z "$restore_marker" ] \
      || ! path_effectively_intersects_protected_union "$restore_marker" \
      || die_code 1 "restore test marker intersects a fixed production root"
  done
fi

# --- resolve the backup ---------------------------------------------------------
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  case "$BACKUP_ARG" in
    /*) ;;
    *) die_code 1 "authorized restore requires one risk-bound named backup path" ;;
  esac
fi
case "$BACKUP_ARG" in
  latest)
    latest="$(completed_backup_inventory latest "$BACKUP_DIR")" \
      || die_code 1 "completed backup inventory is unsafe"
    [ -n "$latest" ] || die_code 1 "no completed backup found in $BACKUP_DIR"
    BACKUP_PATH="$BACKUP_DIR/$latest"
    ;;
  /*)
    BACKUP_PATH="$BACKUP_ARG"
    ;;
  ""|.*|*[!A-Za-z0-9._-]*)
    die_code 1 "backup selector must be 'latest', one safe backup id, or one exact absolute path"
    ;;
  *)
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_ARG"
    ;;
esac
BACKUP_CANON="$(exact_restore_endpoint "$BACKUP_PATH")" \
  || die_code 1 "selected backup must be one exact raw and physical canonical absolute path"
[ -d "$BACKUP_CANON" ] || die_code 1 "selected backup is not one canonical directory"
BACKUP_PATH="$BACKUP_CANON"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_authorized_read_root_binding backupSource "$BACKUP_CANON"
fi
BACKUP_EFFECT_PATH="$(authorized_read_effect_path backupSource "$BACKUP_CANON")"
[ -e "$BACKUP_EFFECT_PATH/manifest.json" ] \
  || die_code 1 "not a completed backup (no manifest.json): $BACKUP_PATH"
[ -e "$BACKUP_EFFECT_PATH/cosmos.db" ] \
  || die_code 1 "backup has no cosmos.db: $BACKUP_PATH"

# --- production-path guard ------------------------------------------------------
# realpath(3) requires the full leaf to exist. For a new restore target, peel
# only genuinely missing trailing components from the raw path, resolve the
# deepest existing prefix with the filesystem, then append the safe suffix.
# Do not call path.resolve() first: lexical collapse of `alias/../child` does
# not match kernel traversal when alias is a symlink.
canonical_restore_path() {
  canonical_path "$1"
}
DATA_CANON="$DATA_DIR"
IS_PRODUCTION=0
case "$TARGET_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*) IS_PRODUCTION=1 ;;
esac
if path_is_within "$DATA_CANON" /var/lib/cosmos/data; then
  require_i00_effect_class ISOLATED_RESTORE
fi
if [ "$IS_PRODUCTION" = 1 ]; then
  die_code 2 "production restore is unavailable; ISOLATED_RESTORE cannot target DATA_DIR"
fi
if [ "$IS_PRODUCTION" != 1 ] && [ "$ALLOW_PRODUCTION" = 1 ]; then
  die_code 2 "--allow-production is unavailable"
fi

# Canonical target state is checked without creating it. All validation below
# must be side-effect free with respect to this path.
TARGET="$TARGET_CANON"
if [ -e "$TARGET_EFFECT_CANON" ] && [ ! -d "$TARGET_EFFECT_CANON" ]; then
  die_code 1 "target exists and is not a directory: $TARGET"
fi
TARGET_NONEMPTY=0
if [ -d "$TARGET_EFFECT_CANON" ]; then
  TARGET_NONEMPTY="$(i00_guard_node -e '
    const fs = require("fs");
    process.stdout.write(fs.readdirSync(process.argv[1]).length > 0 ? "1" : "0");
  ' "$TARGET_EFFECT_CANON")" \
    || die_code 1 "cannot inspect restore target inventory safely"
fi
if [ "$TARGET_NONEMPTY" = 1 ] && [ "$FORCE" != 1 ]; then
  die_code 1 "target is not empty: $TARGET (pass --force to overwrite)"
fi

# --- immutable private snapshot ------------------------------------------------
umask 077
SNAPSHOT=""
cleanup_restore() {
  rc=$?
  trap - EXIT
  if [ -n "$SNAPSHOT" ]; then
    i00_guard_node -e '
      const fs = require("fs");
      fs.rmSync(process.argv[1], { recursive: true, force: true });
    ' "$SNAPSHOT" 2>/dev/null || true
  fi
  exit "$rc"
}
trap cleanup_restore EXIT

# A private snapshot must not itself mutate the live store, selected backup,
# or restore target. Resolve TMPDIR before mktemp and reject aliases into any
# protected tree.
# The restore target and selected backup must be disjoint in both directions.
# Otherwise a forced restore could publish into the immutable input it just
# verified, or could replace an ancestor that still contains that input.
case "$TARGET_CANON" in
  "$BACKUP_CANON"|"$BACKUP_CANON"/*)
    die_code 1 "restore target and selected backup overlap: $TARGET_CANON"
    ;;
esac
case "$BACKUP_CANON" in
  "$TARGET_CANON"|"$TARGET_CANON"/*)
    die_code 1 "restore target and selected backup overlap: $TARGET_CANON"
    ;;
esac
TEMP_ROOT="${TMPDIR:-/tmp}"
if ! TEMP_CANON="$(canonical_restore_path "$TEMP_ROOT")" || [ ! -d "$TEMP_CANON" ]; then
  die_code 1 "cannot safely resolve TMPDIR: $TEMP_ROOT"
fi
if path_effectively_intersects_protected_union "$TEMP_CANON"; then
  die_code 1 "refusing TMPDIR that intersects a fixed production root"
fi
case "$TEMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*|"$TARGET_CANON"|"$TARGET_CANON"/*|"$BACKUP_CANON"|"$BACKUP_CANON"/*)
    die_code 1 "refusing unsafe TMPDIR inside DATA_DIR, target, or backup: $TEMP_CANON"
    ;;
esac

SNAPSHOT="$(i00_guard_node -e '
  const fs = require("fs"), path = require("path");
  const directory = fs.mkdtempSync(path.join(process.argv[1], "cosmos-restore."));
  fs.chmodSync(directory, 0o700);
  process.stdout.write(directory);
' "$TEMP_CANON")" \
  || die_code 1 "cannot create private restore snapshot"
if path_effectively_intersects_protected_union "$SNAPSHOT"; then
  die_code 1 "refusing restore snapshot that intersects a fixed production root"
fi
i00_guard_node -e '
  require("fs").mkdirSync(process.argv[1], { mode: 0o700 });
' "$SNAPSHOT/evidence" \
  || die_code 1 "cannot create private restore evidence directory"

# Copy the manifest and every declared payload through held descriptors. The
# source pathname must still name the same regular, single-link inode after
# the copy, and the directory inventory/identity must remain stable. Restore
# never consumes the mutable backup directory again after this step.
require_authorized_read_root_binding backupSource "$BACKUP_CANON"
if ! (cd -P -- "$BACKUP_EFFECT_PATH" && i00_guard_node - "$SNAPSHOT" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const snapshot = process.argv[2];
const backup = '.';
const constants = fs.constants;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_EVIDENCE_ITEMS = 10000;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_TOTAL_ARCHIVE_BYTES = 128 * 1024 * 1024 * 1024;

function fail(message) { throw new Error(message); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has unexpected keys`);
  }
}
function sameIdentity(left, right) {
  const { dev: leftDevice } = left;
  const { dev: rightDevice } = right;
  return leftDevice === rightDevice && left.ino === right.ino
    && left.size === right.size && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}
function namedRegular(file, opened) {
  const named = fs.lstatSync(file, { bigint: true });
  return named.isFile() && !named.isSymbolicLink() && named.nlink === 1n
    && sameIdentity(opened, named);
}
function copyRegular(name, destination, expectedSha, expectedBytes, maxBytes) {
  const source = path.join(backup, name);
  let input;
  let output;
  try {
    input = fs.openSync(source,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fs.fstatSync(input, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n) {
      fail(`${name} is not a private regular file`);
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${name} is too large`);
    if (maxBytes !== null && before.size > BigInt(maxBytes)) fail(`${name} exceeds its size limit`);
    if (expectedBytes !== null && before.size !== BigInt(expectedBytes)) {
      fail(`${name} size does not match manifest`);
    }

    output = fs.openSync(path.join(snapshot, destination),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copied = 0n;
    for (;;) {
      const bytesRead = fs.readSync(input, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        offset += fs.writeSync(output, buffer, offset, bytesRead - offset, null);
      }
      copied += BigInt(bytesRead);
    }
    fs.fsyncSync(output);
    const after = fs.fstatSync(input, { bigint: true });
    const destinationStat = fs.fstatSync(output, { bigint: true });
    if (!sameIdentity(before, after) || copied !== before.size
        || destinationStat.size !== copied || !namedRegular(source, before)) {
      fail(`${name} changed while it was snapshotted`);
    }
    const sha256 = hash.digest('hex');
    if (expectedSha !== null && sha256 !== expectedSha.toLowerCase()) {
      fail(`${name} sha256 does not match manifest`);
    }
    return { sha256, bytes: Number(copied) };
  } finally {
    if (output !== undefined) fs.closeSync(output);
    if (input !== undefined) fs.closeSync(input);
  }
}
function safeSource(source) {
  return typeof source === 'string' && source.length > 0
    && Buffer.byteLength(source) <= 4096 && !/[\0-\x1f\x7f]/.test(source);
}
function safeRoot(root) {
  return typeof root === 'string' && root.length > 0 && Buffer.byteLength(root) <= 255
    && root !== '.' && root !== '..' && !root.startsWith('-')
    && !/[\\/\0-\x1f\x7f]/.test(root);
}

if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
  fail('runtime lacks no-follow/nonblocking file snapshot support');
}
const directoryBefore = fs.statSync(backup, { bigint: true });
if (!directoryBefore.isDirectory()) fail('held backup cwd is not a directory');
const namesBefore = fs.readdirSync(backup).sort();
copyRegular('manifest.json', 'manifest.json', null, null, MAX_MANIFEST_BYTES);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
} catch {
  fail('manifest is not valid JSON');
}
exactKeys(manifest, [
  'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes', 'eventsCount',
  'dataSchema', 'integrityCheck', 'evidence',
], 'manifest');
if (typeof manifest.backupId !== 'string' || manifest.backupId.length === 0
    || manifest.backupId.length > 256 || /[\0-\x1f\x7f]/.test(manifest.backupId)) {
  fail('manifest backupId is invalid');
}
if (typeof manifest.createdAtUtc !== 'string' || !Number.isFinite(Date.parse(manifest.createdAtUtc))) {
  fail('manifest createdAtUtc is invalid');
}
if (manifest.dbFile !== 'cosmos.db' || !/^[0-9a-f]{64}$/i.test(manifest.dbSha256)) {
  fail('manifest database identity is invalid');
}
if (!Number.isSafeInteger(manifest.dbBytes) || manifest.dbBytes <= 0
    || !Number.isSafeInteger(manifest.eventsCount) || manifest.eventsCount < -1
    || !(manifest.dataSchema === null || Number.isSafeInteger(manifest.dataSchema))
    || manifest.integrityCheck !== 'ok') {
  fail('manifest database metadata is invalid');
}
if (!Array.isArray(manifest.evidence) || manifest.evidence.length > MAX_EVIDENCE_ITEMS) {
  fail('manifest evidence inventory is invalid');
}

const archives = [];
const expectedNames = new Set(['cosmos.db', 'manifest.json']);
// Opening a WAL-mode snapshot for backup-time integrity checks can leave these
// SQLite-owned, non-payload sidecars behind (notably on macOS). They are never
// restored, but if present they must still be bounded, stable regular files;
// no other undeclared top-level name is accepted.
const ignoredSidecars = ['cosmos.db-wal', 'cosmos.db-shm']
  .filter((name) => namesBefore.includes(name));
for (const sidecar of ignoredSidecars) expectedNames.add(sidecar);
const roots = new Set();
const portableRoots = new Set();
let archiveNumber = 0;
for (let index = 0; index < manifest.evidence.length; index += 1) {
  const item = manifest.evidence[index];
  const label = `manifest evidence[${index}]`;
  if (!safeSource(item?.source)) fail(`${label} source is invalid`);
  if (item.missing === true) {
    exactKeys(item, ['source', 'missing'], label);
    continue;
  }
  exactKeys(item, ['source', 'archive', 'sha256'], label);
  archiveNumber += 1;
  const expectedArchive = `evidence-${archiveNumber}.tar.gz`;
  if (item.archive !== expectedArchive || !/^[0-9a-f]{64}$/i.test(item.sha256)) {
    fail(`${label} archive identity is invalid`);
  }
  const sourceRoot = path.basename(item.source);
  const portableRoot = sourceRoot.normalize('NFC').toLocaleLowerCase('en-US');
  if (!safeRoot(sourceRoot) || roots.has(sourceRoot) || portableRoots.has(portableRoot)) {
    fail(`${label} source root is unsafe or duplicated`);
  }
  roots.add(sourceRoot);
  portableRoots.add(portableRoot);
  expectedNames.add(item.archive);
  archives.push({ archive: item.archive, sha256: item.sha256.toLowerCase(), sourceRoot });
}

const expectedInventory = [...expectedNames].sort();
if (namesBefore.length !== expectedInventory.length
    || namesBefore.some((name, index) => name !== expectedInventory[index])) {
  fail('backup top-level inventory does not exactly match the manifest');
}
const database = copyRegular('cosmos.db', 'cosmos.db', manifest.dbSha256, manifest.dbBytes, null);
for (const sidecar of ignoredSidecars) {
  copyRegular(sidecar, `ignored-${sidecar}`, null, null, 64 * 1024 * 1024);
}
let totalArchiveBytes = 0;
for (const archive of archives) {
  const copied = copyRegular(
    archive.archive, archive.archive, archive.sha256, null, MAX_ARCHIVE_BYTES,
  );
  archive.bytes = copied.bytes;
  totalArchiveBytes += copied.bytes;
  if (!Number.isSafeInteger(totalArchiveBytes) || totalArchiveBytes > MAX_TOTAL_ARCHIVE_BYTES) {
    fail('evidence archives exceed the aggregate compressed-size limit');
  }
}

const namesAfter = fs.readdirSync(backup).sort();
const directoryAfter = fs.statSync(backup, { bigint: true });
if (!sameIdentity(directoryBefore, directoryAfter)
    || namesAfter.length !== namesBefore.length
    || namesAfter.some((name, index) => name !== namesBefore[index])) {
  fail('backup directory changed while it was snapshotted');
}
fs.writeFileSync(path.join(snapshot, 'plan.json'), `${JSON.stringify({
  backupId: manifest.backupId,
  dbSha256: database.sha256,
  dbBytes: database.bytes,
  eventsCount: manifest.eventsCount,
  archives,
}, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
NODE
); then
  die_code 1 "backup integrity FAILED: unstable, unsafe, or manifest-inconsistent backup at $BACKUP_PATH"
fi
require_authorized_observed_root_binding backupDir "$BACKUP_DIR"
require_authorized_read_root_binding backupSource "$BACKUP_CANON"

BACKUP_ID="$(json_get "$SNAPSHOT/plan.json" backupId)" \
  || die_code 1 "private restore plan has no backupId"
WANT_SHA="$(json_get "$SNAPSHOT/plan.json" dbSha256)" \
  || die_code 1 "private restore plan has no dbSha256"
WANT_BYTES="$(json_get "$SNAPSHOT/plan.json" dbBytes)" \
  || die_code 1 "private restore plan has no dbBytes"
INTEGRITY="$("$SQLITE" "$SNAPSHOT/cosmos.db" 'PRAGMA integrity_check;' 2>/dev/null || echo error)"
[ "$INTEGRITY" = "ok" ] || die_code 1 "backup integrity FAILED: $INTEGRITY"
EVENTS_COUNT="$("$SQLITE" "$SNAPSHOT/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
DECLARED_EVENTS_COUNT="$(json_get "$SNAPSHOT/plan.json" eventsCount)" \
  || die_code 1 "private restore plan has no eventsCount"
[ "$DECLARED_EVENTS_COUNT" = -1 ] || [ "$EVENTS_COUNT" = "$DECLARED_EVENTS_COUNT" ] \
  || die_code 1 "backup integrity FAILED: manifest eventsCount=$DECLARED_EVENTS_COUNT, database eventsCount=$EVENTS_COUNT"
RESTORED_EVIDENCE="$(i00_guard_node -e \
  'process.stdout.write(String(require(process.argv[1]).archives.length))' \
  "$SNAPSHOT/plan.json")"

# --- private archive preflight -------------------------------------------------
# Both name and verbose/type listings are executed with hard timeout and output
# ceilings. Every archive in the cohort is fully preflighted before any archive
# is extracted. The logical inventory is then compared exactly with the
# normalized extracted inventory, including type and regular-file size.
if ! i00_guard_node - "$SNAPSHOT" "$TAR_BIN" "$GZIP_BIN" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [snapshot, tarBin, gzipBin] = process.argv.slice(2);
const descriptorCompression = gzipBin === '/proc/self/fd/39';
if (gzipBin !== 'NONE' && !descriptorCompression) {
  throw new Error('restore gzip capability is invalid');
}
const plan = JSON.parse(fs.readFileSync(path.join(snapshot, 'plan.json'), 'utf8'));
const HARD = Object.freeze({
  listBytes: 32 * 1024 * 1024,
  errorBytes: 1024 * 1024,
  membersPerArchive: 100000,
  membersTotal: 250000,
  memberBytes: 64 * 1024 * 1024 * 1024,
  archiveExpandedBytes: 128 * 1024 * 1024 * 1024,
  totalExpandedBytes: 256 * 1024 * 1024 * 1024,
  listTimeoutMs: 60000,
  extractTimeoutMs: 600000,
});

function fail(message) { throw new Error(message); }
function tightenedLimit(name, hard) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return hard;
  if (!/^[1-9][0-9]*$/.test(raw)) fail(`${name} must be a positive integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > hard) fail(`${name} exceeds its hard ceiling`);
  return parsed;
}
const limits = Object.freeze({
  membersPerArchive: tightenedLimit('RESTORE_MAX_ARCHIVE_MEMBERS', HARD.membersPerArchive),
  memberBytes: tightenedLimit('RESTORE_MAX_MEMBER_BYTES', HARD.memberBytes),
  archiveExpandedBytes: tightenedLimit(
    'RESTORE_MAX_ARCHIVE_EXPANDED_BYTES', HARD.archiveExpandedBytes,
  ),
  totalExpandedBytes: tightenedLimit(
    'RESTORE_MAX_TOTAL_EXPANDED_BYTES', HARD.totalExpandedBytes,
  ),
  listTimeoutMs: tightenedLimit('RESTORE_TAR_LIST_TIMEOUT_MS', HARD.listTimeoutMs),
  extractTimeoutMs: tightenedLimit('RESTORE_TAR_EXTRACT_TIMEOUT_MS', HARD.extractTimeoutMs),
});
const tarEnv = {
  ...(descriptorCompression ? {
    HOME: '/',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TZ: 'UTC',
  } : process.env),
  COPYFILE_DISABLE: '1',
  // C.UTF-8 keeps tar's metadata grammar deterministic without backslash-
  // escaping Unicode names; escaped display text cannot prove byte identity.
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TAR_OPTIONS: '',
};

function runTar(args, timeout, maxBuffer, label) {
  const stdio = ['ignore', 'pipe', 'pipe'];
  if (descriptorCompression) {
    for (let descriptor = 3; descriptor <= 39; descriptor += 1) {
      stdio[descriptor] = 'ignore';
    }
    stdio[22] = 22;
    stdio[39] = 39;
  }
  const result = spawnSync(tarBin, args, {
    encoding: 'buffer', env: tarEnv, maxBuffer, stdio, timeout, windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    const reason = result.error?.code ?? result.signal ?? `rc=${result.status}`;
    fail(`${label} failed within bounded tar execution (${reason})`);
  }
  return result.stdout;
}
function utf8Lines(buffer, label) {
  if (buffer.length === 0 || buffer.length > HARD.listBytes || buffer.includes(0)) {
    fail(`${label} is empty, oversized, or contains NUL`);
  }
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) fail(`${label} is not UTF-8`);
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
function portableKey(value) {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}
function normalizeMember(printed, expectedRoot) {
  if (printed.length === 0 || Buffer.byteLength(printed) > 4096
      || /[\\\0-\x1f\x7f]/.test(printed) || printed.startsWith('/')) {
    fail('archive member name is unsafe');
  }
  const withoutSlash = printed.endsWith('/') ? printed.slice(0, -1) : printed;
  const segments = withoutSlash.split('/');
  if (segments.some((part) => part.length === 0 || part === '.' || part === '..')) {
    fail('archive member escapes or contains dot traversal');
  }
  const normalized = segments.map((part) => part.normalize('NFC')).join('/');
  if (segments[0].normalize('NFC') !== expectedRoot.normalize('NFC')) {
    fail('archive member is outside its declared root');
  }
  return normalized;
}
function parseVerbose(line, listedName) {
  const type = line[0];
  if (type !== '-' && type !== 'd') {
    fail(`archive member type ${JSON.stringify(type)} is not regular-or-directory`);
  }
  if (!line.endsWith(listedName)) fail('verbose tar inventory disagrees with name inventory');
  const prefix = line.slice(0, line.length - listedName.length).trim();
  const fields = prefix.split(/\s+/);
  if (/[sStT]/.test(fields[0] ?? '')) fail('archive member has special mode bits');
  let rawSize;
  // bsdtar: mode links uid gid size Mon DD HH:MM name
  if (/^[0-9]+$/.test(fields[1] ?? '') && /^[0-9]+$/.test(fields[4] ?? '')) {
    rawSize = fields[4];
  // GNU tar: mode uid/gid size YYYY-MM-DD HH:MM name
  } else if (/^[0-9]+\/[0-9]+$/.test(fields[1] ?? '')
      && /^[0-9]+$/.test(fields[2] ?? '')) {
    rawSize = fields[2];
  } else {
    fail('verbose tar inventory has an unsupported bounded format');
  }
  const size = Number(rawSize);
  if (!Number.isSafeInteger(size) || size < 0) fail('archive member size is invalid');
  if (type === 'd' && size !== 0) fail('archive directory declares nonzero payload bytes');
  return { type: type === 'd' ? 'directory' : 'file', size };
}
function sameInventory(expected, actual) {
  if (expected.length !== actual.length) return false;
  return expected.every((item, index) => {
    const other = actual[index];
    return item.path === other.path && item.type === other.type
      && (item.type === 'directory' || item.size === other.size);
  });
}

const preflighted = [];
let totalMembers = 0;
let totalExpandedBytes = 0;
for (let index = 0; index < plan.archives.length; index += 1) {
  const archive = plan.archives[index];
  const archivePath = path.join(snapshot, archive.archive);
  const archiveStat = fs.lstatSync(archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink() || archiveStat.nlink !== 1
      || archiveStat.size !== archive.bytes) {
    fail(`${archive.archive} changed after the immutable snapshot`);
  }
  const names = utf8Lines(runTar(
    [
      ...(descriptorCompression ? ['--use-compress-program=/proc/self/fd/39'] : []),
      descriptorCompression ? '-tf' : '-tzf',
      archivePath,
    ],
    limits.listTimeoutMs, HARD.listBytes,
    `name listing for ${archive.archive}`,
  ), `name listing for ${archive.archive}`);
  const verbose = utf8Lines(runTar(
    [
      ...(descriptorCompression ? ['--use-compress-program=/proc/self/fd/39'] : []),
      '--numeric-owner',
      descriptorCompression ? '-tvf' : '-tvzf',
      archivePath,
    ],
    limits.listTimeoutMs, HARD.listBytes,
    `type listing for ${archive.archive}`,
  ), `type listing for ${archive.archive}`);
  if (names.length !== verbose.length || names.length === 0
      || names.length > limits.membersPerArchive) {
    fail(`${archive.archive} member count exceeds its closed limit or listings disagree`);
  }
  totalMembers += names.length;
  if (totalMembers > HARD.membersTotal) fail('restore campaign member count exceeds its hard limit');

  const exact = new Set();
  const portable = new Set();
  const inventory = [];
  let rootMetadata = null;
  let archiveExpandedBytes = 0;
  for (let memberIndex = 0; memberIndex < names.length; memberIndex += 1) {
    const memberPath = normalizeMember(names[memberIndex], archive.sourceRoot);
    const metadata = parseVerbose(verbose[memberIndex], names[memberIndex]);
    const key = portableKey(memberPath);
    if (exact.has(memberPath) || portable.has(key)) {
      fail(`${archive.archive} has duplicate, case-colliding, or Unicode-colliding members`);
    }
    exact.add(memberPath);
    portable.add(key);
    if (memberPath === archive.sourceRoot.normalize('NFC')) rootMetadata = metadata;
    if (metadata.type === 'file') {
      if (metadata.size > limits.memberBytes) fail(`${archive.archive} member exceeds size limit`);
      archiveExpandedBytes += metadata.size;
      totalExpandedBytes += metadata.size;
      if (!Number.isSafeInteger(archiveExpandedBytes)
          || archiveExpandedBytes > limits.archiveExpandedBytes
          || !Number.isSafeInteger(totalExpandedBytes)
          || totalExpandedBytes > limits.totalExpandedBytes) {
        fail('evidence archive resource limit exceeded before extraction');
      }
    }
    inventory.push({ path: memberPath, type: metadata.type, size: metadata.size });
  }
  if (rootMetadata === null) fail(`${archive.archive} omits its declared root`);
  inventory.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  preflighted.push({ ...archive, archivePath, inventory, rootType: rootMetadata.type });
}

for (let index = 0; index < preflighted.length; index += 1) {
  const archive = preflighted[index];
  const extractRoot = path.join(snapshot, `extract-${index + 1}`);
  fs.mkdirSync(extractRoot, { mode: 0o700 });
  runTar([
    ...(descriptorCompression ? ['--use-compress-program=/proc/self/fd/39'] : []),
    '--no-same-owner', '--no-same-permissions', '--no-xattrs', '--no-acls',
    descriptorCompression ? '-xf' : '-xzf', archive.archivePath, '-C', extractRoot,
  ], limits.extractTimeoutMs, HARD.errorBytes, `extraction for ${archive.archive}`);

  const topLevel = fs.readdirSync(extractRoot);
  if (topLevel.length !== 1
      || topLevel[0].normalize('NFC') !== archive.sourceRoot.normalize('NFC')) {
    fail(`${archive.archive} extracted top-level inventory disagrees with its manifest root`);
  }
  const actual = [];
  function walk(current, logical) {
    const stat = fs.lstatSync(current);
    const normalized = logical.split('/').map((part) => part.normalize('NFC')).join('/');
    if ((stat.mode & 0o7000) !== 0 || stat.isSymbolicLink()) {
      fail(`${archive.archive} extracted a link or special-mode member`);
    }
    if (stat.isDirectory()) {
      actual.push({ path: normalized, type: 'directory', size: 0 });
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) {
        if (name.length === 0 || /[\\\0-\x1f\x7f]/.test(name)
            || name === '.' || name === '..') {
          fail(`${archive.archive} extracted an unsafe member name`);
        }
        walk(path.join(current, name), `${logical}/${name}`);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      fail(`${archive.archive} extracted a link or special-file member`);
    }
    actual.push({ path: normalized, type: 'file', size: stat.size });
    fs.chmodSync(current, 0o600 | (stat.mode & 0o111));
  }
  walk(path.join(extractRoot, topLevel[0]), topLevel[0]);
  actual.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  if (!sameInventory(archive.inventory, actual)) {
    fail(`${archive.archive} logical and extracted inventories differ`);
  }
  fs.renameSync(
    path.join(extractRoot, topLevel[0]),
    path.join(snapshot, 'evidence', archive.sourceRoot),
  );
  fs.rmdirSync(extractRoot);
}
NODE
then
  die_code 1 "backup integrity FAILED: evidence archive preflight or extraction failed"
fi

# --- publish only the verified staging tree ------------------------------------
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
  fs_mkdir_p "$TARGET_PARENT"
  TARGET_PARENT="$(exact_existing_directory_path "$TARGET_PARENT")" \
    || die_code 1 "restore target parent could not be created safely"
fi
PROD_BOOL=false
[ "$IS_PRODUCTION" = 1 ] && PROD_BOOL=true
if ! i00_guard_node - "$SNAPSHOT" "$TARGET_CANON" "$TARGET_EFFECT_CANON" \
    "$DATA_CANON" "$FORCE" \
    "$IS_PRODUCTION" "$(now_utc)" "$BACKUP_ID" "$WANT_SHA" \
    "$WANT_BYTES" "$DECLARED_EVENTS_COUNT" "$EVENTS_COUNT" "$RESTORED_EVIDENCE" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [
  snapshot, target, targetEffect, dataDir, forceRaw, productionRaw, timestamp, backupId,
  dbSha256, dbBytesRaw, declaredEventsRaw, eventsRaw, evidenceRaw,
] = process.argv.slice(2);
const force = forceRaw === '1';
const production = productionRaw === '1';
const dbBytes = Number(dbBytesRaw);
const declaredEventsCount = Number(declaredEventsRaw);
const eventsCount = Number(eventsRaw);
const evidenceArchives = Number(evidenceRaw);
const ownedNames = ['cosmos.db', 'cosmos.db-wal', 'cosmos.db-shm', 'evidence', 'restore-report.json'];
const testMode = process.env.COSMOS_RESTORE_TEST_MODE === '1';
const failAfterPublish = testMode ? (process.env.RESTORE_TEST_FAIL_AFTER_PUBLISH ?? '') : '';
const stageReadyMarker = testMode ? (process.env.RESTORE_TEST_STAGE_READY_MARKER ?? '') : '';
const stageContinueMarker = testMode ? (process.env.RESTORE_TEST_STAGE_CONTINUE_MARKER ?? '') : '';
const MAX_EVIDENCE_PROOF_ENTRIES = 250001;
const MAX_EVIDENCE_PROOF_BYTES = 256n * 1024n * 1024n * 1024n;

if (!Number.isSafeInteger(dbBytes) || dbBytes <= 0) {
  fail('private restore plan database size is invalid');
}

function fail(message) { throw new Error(message); }
function identity(stat) {
  const { dev, ino, mode } = stat;
  return { dev, ino, mode, type: stat.isDirectory() ? 'd' : 'f' };
}
function sameIdentity(left, right) {
  const { dev: leftDevice } = left;
  const { dev: rightDevice } = right;
  return leftDevice === rightDevice && left.ino === right.ino
    && left.mode === right.mode && left.type === right.type;
}
function statIdentity(name) { return identity(fs.lstatSync(name, { bigint: true })); }
function stableMetadata(stat) {
  const {
    dev, ino, mode, nlink, size, mtimeNs, ctimeNs,
  } = stat;
  return {
    dev, ino, mode, nlink, size, mtimeNs, ctimeNs,
    type: stat.isDirectory() ? 'd' : stat.isFile() ? 'f' : 'other',
  };
}
function sameStableMetadata(left, right) {
  const { dev: leftDevice } = left;
  const { dev: rightDevice } = right;
  return leftDevice === rightDevice && left.ino === right.ino
    && left.mode === right.mode && left.nlink === right.nlink
    && left.size === right.size && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs && left.type === right.type;
}
function frameHash(hash, value) {
  const bytes = Buffer.from(String(value), 'utf8');
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}
function contentProof(root, options = {}) {
  const treeHash = crypto.createHash('sha256');
  const entries = [];
  const openFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    | fs.constants.O_NONBLOCK;
  if (typeof fs.constants.O_NOFOLLOW !== 'number'
      || typeof fs.constants.O_NONBLOCK !== 'number') {
    fail('runtime lacks stable no-follow content-proof support');
  }
  const expected = options.expected ?? null;
  const mismatchLabel = options.mismatchLabel ?? `${root} violates its bounded content proof`;
  const expectedByPath = new Map();
  const expectedChildren = new Map();
  if (expected !== null) {
    if (!Array.isArray(expected.entries) || expected.entries.length === 0) {
      fail(`${mismatchLabel}: expected proof is empty or malformed`);
    }
    for (const entry of expected.entries) {
      if (typeof entry?.path !== 'string' || expectedByPath.has(entry.path)) {
        fail(`${mismatchLabel}: expected proof has duplicate or malformed paths`);
      }
      expectedByPath.set(entry.path, entry);
      if (entry.path === '.') continue;
      const separator = entry.path.lastIndexOf('/');
      const parent = separator < 1 ? '.' : entry.path.slice(0, separator);
      const child = separator < 0 ? entry.path : entry.path.slice(separator + 1);
      if (child.length === 0) fail(`${mismatchLabel}: expected proof has an empty name`);
      const children = expectedChildren.get(parent) ?? [];
      children.push(child);
      expectedChildren.set(parent, children);
    }
    for (const children of expectedChildren.values()) children.sort();
  }
  const maxEntries = expected === null
    ? options.maxEntries
    : expected.entries.length;
  const maxTotalBytes = expected === null
    ? options.maxTotalBytes
    : expected.entries.reduce(
      (total, entry) => total + (entry.type === 'f' ? BigInt(entry.size) : 0n), 0n,
    );
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0
      || typeof maxTotalBytes !== 'bigint' || maxTotalBytes < 0n) {
    fail(`${mismatchLabel}: content-proof limits are invalid`);
  }
  let scheduledEntries = 1;
  let totalFileBytes = 0n;
  const tasks = [{ kind: 'visit', name: root, logical: '.' }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task.kind === 'finish-directory') {
      const namedAfter = fs.lstatSync(task.name, { bigint: true });
      if (!sameStableMetadata(task.beforeMetadata, stableMetadata(namedAfter))) {
        fail(`${mismatchLabel}: directory changed while its content was measured`);
      }
      continue;
    }
    const { name, logical } = task;
    if (entries.length >= maxEntries) {
      fail(`${mismatchLabel}: entry count exceeds its trusted bound`);
    }
    const namedBefore = fs.lstatSync(name, { bigint: true });
    const beforeMetadata = stableMetadata(namedBefore);
    const expectedEntry = expected === null ? null : expectedByPath.get(logical);
    if (expected !== null && !expectedEntry) {
      fail(`${mismatchLabel}: unexpected path ${logical}`);
    }
    if (expectedEntry) {
      const actualPermissions = Number(namedBefore.mode & 0o7777n);
      const rawExpectedMode = expectedEntry.permissions ?? expectedEntry.mode;
      const expectedPermissions = typeof rawExpectedMode === 'bigint'
        ? Number(rawExpectedMode & 0o7777n)
        : Number(rawExpectedMode) & 0o7777;
      if (beforeMetadata.type !== expectedEntry.type
          || actualPermissions !== expectedPermissions
          || (beforeMetadata.type === 'f' && namedBefore.size !== BigInt(expectedEntry.size))) {
        fail(`${mismatchLabel}: type, mode, or size changed at ${logical}`);
      }
    }
    if (namedBefore.isDirectory() && !namedBefore.isSymbolicLink()) {
      entries.push({ path: logical, ...beforeMetadata, sha256: null });
      frameHash(treeHash, 'directory');
      frameHash(treeHash, logical);
      frameHash(treeHash, Number(namedBefore.mode & 0o7777n));
      const trustedNames = expected === null ? null : (expectedChildren.get(logical) ?? []);
      const names = [];
      const directory = fs.opendirSync(name);
      try {
        for (;;) {
          const child = directory.readSync();
          if (child === null) break;
          if (scheduledEntries >= maxEntries
              || (trustedNames !== null && names.length >= trustedNames.length)) {
            fail(`${mismatchLabel}: directory entry count exceeds its trusted bound`);
          }
          names.push(child.name);
          scheduledEntries += 1;
        }
      } finally {
        directory.closeSync();
      }
      names.sort();
      if (trustedNames !== null
          && (names.length !== trustedNames.length
            || names.some((child, index) => child !== trustedNames[index]))) {
        fail(`${mismatchLabel}: directory inventory changed at ${logical}`);
      }
      frameHash(treeHash, names.length);
      tasks.push({ kind: 'finish-directory', name, beforeMetadata });
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const child = names[index];
        tasks.push({ kind: 'visit', name: path.join(name, child), logical: `${logical}/${child}` });
      }
      continue;
    }
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1n) {
      fail(`${mismatchLabel}: proof contains a link or special entry`);
    }
    totalFileBytes += namedBefore.size;
    if (namedBefore.size < 0n || totalFileBytes > maxTotalBytes) {
      fail(`${mismatchLabel}: file bytes exceed their trusted bound`);
    }
    const descriptor = fs.openSync(name, openFlags);
    let sha256;
    try {
      const openedBefore = fs.fstatSync(descriptor, { bigint: true });
      const openedBeforeMetadata = stableMetadata(openedBefore);
      if (!openedBefore.isFile() || openedBefore.nlink !== 1n
          || !sameStableMetadata(beforeMetadata, openedBeforeMetadata)) {
        fail(`${name} changed before its content proof was held`);
      }
      const fileHash = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let measured = 0n;
      while (measured < openedBefore.size) {
        const remaining = openedBefore.size - measured;
        const requested = remaining < BigInt(buffer.length) ? Number(remaining) : buffer.length;
        const count = fs.readSync(descriptor, buffer, 0, requested, null);
        if (count === 0) fail(`${mismatchLabel}: short read at ${logical}`);
        fileHash.update(buffer.subarray(0, count));
        measured += BigInt(count);
      }
      const overflow = Buffer.allocUnsafe(1);
      if (fs.readSync(descriptor, overflow, 0, 1, null) !== 0) {
        fail(`${mismatchLabel}: file grew beyond its trusted size at ${logical}`);
      }
      const openedAfter = fs.fstatSync(descriptor, { bigint: true });
      const namedAfter = fs.lstatSync(name, { bigint: true });
      if (measured !== openedBefore.size
          || !sameStableMetadata(openedBeforeMetadata, stableMetadata(openedAfter))
          || !sameStableMetadata(openedBeforeMetadata, stableMetadata(namedAfter))) {
        fail(`${mismatchLabel}: file changed while its content was measured at ${logical}`);
      }
      sha256 = fileHash.digest('hex');
      if (expectedEntry && typeof expectedEntry.sha256 === 'string'
          && sha256 !== expectedEntry.sha256) {
        fail(`${mismatchLabel}: file hash changed at ${logical}`);
      }
    } finally {
      fs.closeSync(descriptor);
    }
    entries.push({ path: logical, ...beforeMetadata, sha256 });
    frameHash(treeHash, 'file');
    frameHash(treeHash, logical);
    frameHash(treeHash, Number(namedBefore.mode & 0o7777n));
    frameHash(treeHash, namedBefore.size);
    frameHash(treeHash, sha256);
  }
  if (scheduledEntries !== entries.length
      || (expected !== null && entries.length !== expected.entries.length)) {
    fail(`${mismatchLabel}: measured inventory is incomplete`);
  }
  return { sha256: treeHash.digest('hex'), entries };
}
function sameProofMetadata(left, right, includeTimes) {
  if (left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index];
    const { dev: entryDevice } = entry;
    const { dev: otherDevice } = other;
    return entry.path === other.path && entry.type === other.type
      && entryDevice === otherDevice && entry.ino === other.ino
      && entry.mode === other.mode && entry.nlink === other.nlink
      && entry.size === other.size
      && (!includeTimes
        || (entry.mtimeNs === other.mtimeNs && entry.ctimeNs === other.ctimeNs));
  });
}
function sameExactProof(left, right) {
  return left.sha256 === right.sha256 && sameProofMetadata(left, right, true);
}
function assertExactProof(name, expected, label) {
  const mismatchLabel = `${label} content changed before publication`;
  const actual = contentProof(name, { expected, mismatchLabel });
  if (!sameExactProof(actual, expected)) fail(`${label} content changed before publication`);
  return actual;
}
function assertPublishedProof(name, expected, label) {
  const mismatchLabel = `${label} content changed during publication`;
  const actual = contentProof(name, { expected, mismatchLabel });
  if (actual.sha256 !== expected.sha256 || !sameProofMetadata(actual, expected, false)) {
    fail(`${label} content changed during publication`);
  }
  return actual;
}
function soleFileSha256(proof, label) {
  if (proof.entries.length !== 1 || proof.entries[0].type !== 'f'
      || typeof proof.entries[0].sha256 !== 'string') {
    fail(`${label} is not one proved regular file`);
  }
  return proof.entries[0].sha256;
}
function exists(name) {
  try { fs.lstatSync(name); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
function waitForTestStageMutation(databaseStage, stagedEvidence, stagedReport) {
  if (stageReadyMarker === '' && stageContinueMarker === '') return;
  if (!path.isAbsolute(stageReadyMarker) || !path.isAbsolute(stageContinueMarker)
      || stageReadyMarker === stageContinueMarker) {
    fail('restore test stage markers must be distinct absolute paths');
  }
  if (exists(stageReadyMarker) || exists(stageContinueMarker)) {
    fail('restore test stage markers must begin absent');
  }
  fs.writeFileSync(stageReadyMarker, [
    path.resolve(databaseStage),
    path.resolve(stagedEvidence),
    path.resolve(stagedReport),
    '',
  ].join('\n'), {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  const waiter = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 10_000;
  while (!exists(stageContinueMarker)) {
    if (Date.now() >= deadline) fail('restore test stage mutation barrier timed out');
    Atomics.wait(waiter, 0, 0, 10);
  }
  const marker = fs.lstatSync(stageContinueMarker);
  if (!marker.isFile() || marker.isSymbolicLink()) {
    fail('restore test stage continue marker is unsafe');
  }
}
function directoryIdentity(name) {
  const stat = fs.lstatSync(name, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${name} is not a real directory`);
  return identity(stat);
}
function assertNamedDirectory(expected, held, label) {
  const named = directoryIdentity(expected);
  if (!sameIdentity(named, held) || fs.realpathSync.native(expected) !== expected) {
    fail(`${label}: named path no longer denotes the held directory`);
  }
}
const createdTargetDirectories = [];
function enterTarget() {
  const namedParent = path.dirname(target);
  const effectParent = path.dirname(targetEffect);
  const component = path.basename(target);
  if (!component || component === '.' || component === '..'
      || path.basename(targetEffect) !== component) {
    fail('isolated target differs from its bound parent capability');
  }
  process.chdir(effectParent);
  const heldParent = directoryIdentity('.');
  assertNamedDirectory(namedParent, heldParent, 'target parent capability binding');
  if (exists(component)) {
    process.chdir(component);
  } else {
    fs.mkdirSync(component, { mode: 0o700 });
    process.chdir(component);
    const created = directoryIdentity('.');
    assertNamedDirectory(target, created, 'created target binding');
    createdTargetDirectories.push({
      path: target,
      component,
      identity: created,
    });
  }
  const held = directoryIdentity('.');
  assertNamedDirectory(target, held, 'isolated target binding');
  return held;
}

const heldTarget = enterTarget();
function assertHeld() {
  const current = directoryIdentity('.');
  if (!sameIdentity(current, heldTarget)) fail('restore cwd identity changed');
}
function assertTargetBound(label) {
  assertHeld();
  assertNamedDirectory(target, heldTarget, label);
  const inLiveTree = target === dataDir || target.startsWith(`${dataDir}${path.sep}`);
  if (inLiveTree !== production) fail(`${label}: production authorization boundary changed`);
}

assertTargetBound('pre-staging target binding');
const visible = fs.readdirSync('.');
if (visible.length > 0 && !force) fail('target became non-empty before staging');

const nonce = `${process.pid}.${crypto.randomBytes(12).toString('hex')}`;
const stages = new Map();
const stageProofs = new Map();
function rememberStage(name, expected, label) {
  const proof = contentProof(name, {
    expected,
    mismatchLabel: `${label} content does not match its trusted source`,
  });
  stages.set(name, statIdentity(name));
  stageProofs.set(name, proof);
  return proof;
}
function removeIfOurs(name, expected, errors) {
  if (!exists(name)) return;
  const actual = statIdentity(name);
  if (!sameIdentity(actual, expected)) {
    errors.push(`${name} no longer has its owned staging/published identity`);
    return;
  }
  try { fs.rmSync(name, { recursive: true, force: false }); } catch (error) {
    errors.push(`could not remove owned ${name}: ${error?.code ?? error?.message}`);
  }
}
function copyRegularExclusive(source, destination, mode) {
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output;
  try {
    const before = fs.fstatSync(input, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) fail(`${source} is not a private regular file`);
    output = fs.openSync(destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      mode);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copied = 0n;
    for (;;) {
      const count = fs.readSync(input, buffer, 0, buffer.length, null);
      if (count === 0) break;
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset, null);
      copied += BigInt(count);
    }
    fs.fsyncSync(output);
    const after = fs.fstatSync(input, { bigint: true });
    const { dev: beforeDevice } = before;
    const { dev: afterDevice } = after;
    if (beforeDevice !== afterDevice || before.ino !== after.ino
        || before.size !== after.size || copied !== before.size) {
      fail(`${source} changed while staging`);
    }
  } finally {
    if (output !== undefined) fs.closeSync(output);
    fs.closeSync(input);
  }
}
function copyEntry(source, destination) {
  const sourceStat = fs.lstatSync(source, { bigint: true });
  if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const name of fs.readdirSync(source)) {
      copyEntry(path.join(source, name), path.join(destination, name));
    }
    return;
  }
  if (sourceStat.isFile() && sourceStat.nlink === 1n) {
    copyRegularExclusive(source, destination, 0o600 | (Number(sourceStat.mode) & 0o111));
    return;
  }
  fail('staged evidence contains a link or special file');
}

const dbStage = `.cosmos.db.restore.${nonce}`;
const evidenceStage = `.evidence.restore.${nonce}`;
const reportStage = `.restore-report.${nonce}`;
const rollback = `.restore-rollback.${nonce}`;
const moved = new Map();
const published = new Map();
let commitStarted = false;
let commitComplete = false;
let rollbackCreated = false;
let failure;

try {
  const databaseSnapshotProof = contentProof(path.join(snapshot, 'cosmos.db'), {
    maxEntries: 1,
    maxTotalBytes: BigInt(dbBytes),
    mismatchLabel: 'private cosmos.db snapshot exceeds its verified bounds',
  });
  if (soleFileSha256(databaseSnapshotProof, 'private cosmos.db snapshot')
      !== dbSha256.toLowerCase()
      || databaseSnapshotProof.entries[0].size !== BigInt(dbBytes)) {
    fail('private cosmos.db snapshot does not match the verified database');
  }
  copyRegularExclusive(path.join(snapshot, 'cosmos.db'), dbStage, 0o600);
  const databaseStageProof = rememberStage(
    dbStage, databaseSnapshotProof, 'staged cosmos.db',
  );
  if (soleFileSha256(databaseStageProof, 'staged cosmos.db') !== dbSha256.toLowerCase()) {
    fail('staged cosmos.db content does not match the verified database');
  }
  const snapshotEvidenceProof = contentProof(path.join(snapshot, 'evidence'), {
    maxEntries: MAX_EVIDENCE_PROOF_ENTRIES,
    maxTotalBytes: MAX_EVIDENCE_PROOF_BYTES,
    mismatchLabel: 'private evidence snapshot exceeds its verified bounds',
  });
  fs.mkdirSync(evidenceStage, { mode: 0o700 });
  if (evidenceArchives > 0) {
    for (const name of fs.readdirSync(path.join(snapshot, 'evidence'))) {
      copyEntry(path.join(snapshot, 'evidence', name), path.join(evidenceStage, name));
    }
  }
  const snapshotEvidenceAfter = contentProof(path.join(snapshot, 'evidence'), {
    expected: snapshotEvidenceProof,
    mismatchLabel: 'private evidence snapshot changed while staging',
  });
  if (!sameExactProof(snapshotEvidenceAfter, snapshotEvidenceProof)) {
    fail('private evidence snapshot changed while staging');
  }
  const evidenceStageProof = rememberStage(
    evidenceStage, snapshotEvidenceProof, 'staged evidence',
  );
  if (evidenceStageProof.sha256 !== snapshotEvidenceProof.sha256) {
    fail('staged evidence content does not match the verified snapshot');
  }
  const report = {
    ts: timestamp,
    backupId,
    target,
    production,
    dbSha256,
    declaredEventsCount,
    eventsCount,
    declaredEvidenceArchives: evidenceArchives,
    evidenceArchives,
    verifiedEvidenceArchives: evidenceArchives,
    archiveVerification: 'EXACT_MANIFEST_INVENTORY_HASH_SIZE_MEMBER_VERIFIED',
  };
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  const expectedReportSha256 = crypto.createHash('sha256').update(reportBytes).digest('hex');
  const expectedReportProof = {
    entries: [{
      path: '.', type: 'f', permissions: 0o600,
      size: BigInt(Buffer.byteLength(reportBytes)), sha256: expectedReportSha256,
    }],
  };
  fs.writeFileSync(reportStage, reportBytes, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  const reportStageProof = rememberStage(
    reportStage, expectedReportProof, 'staged restore-report.json',
  );
  if (soleFileSha256(reportStageProof, 'staged restore report') !== expectedReportSha256) {
    fail('staged restore report content does not match its verified bytes');
  }
  assertTargetBound('post-staging target binding');
  waitForTestStageMutation(dbStage, evidenceStage, reportStage);

  const publications = [[dbStage, 'cosmos.db']];
  if (evidenceArchives > 0) publications.push([evidenceStage, 'evidence']);
  publications.push([reportStage, 'restore-report.json']);
  for (const [stage, name] of publications) {
    const expectedProof = stageProofs.get(stage);
    if (!expectedProof) fail(`missing owned staging content proof for ${name}`);
    assertExactProof(stage, expectedProof, `staged ${name}`);
  }

  fs.mkdirSync(rollback, { mode: 0o700 });
  rollbackCreated = true;
  commitStarted = true;
  for (const name of ownedNames) {
    assertTargetBound(`pre-move binding for ${name}`);
    if (!exists(name)) continue;
    const original = statIdentity(name);
    fs.renameSync(name, path.join(rollback, name));
    moved.set(name, original);
    const movedIdentity = statIdentity(path.join(rollback, name));
    if (!sameIdentity(original, movedIdentity)) fail(`moved original ${name} changed identity`);
  }

  for (const [stage, name] of publications) {
    assertTargetBound(`pre-publish binding for ${name}`);
    const stagedIdentity = stages.get(stage);
    if (!stagedIdentity) fail(`missing owned staging identity for ${name}`);
    const expectedProof = stageProofs.get(stage);
    if (!expectedProof) fail(`missing owned staging content proof for ${name}`);
    assertExactProof(stage, expectedProof, `staged ${name}`);
    fs.renameSync(stage, name);
    published.set(name, stagedIdentity);
    stages.delete(stage);
    stageProofs.delete(stage);
    const publishedIdentity = statIdentity(name);
    if (!sameIdentity(publishedIdentity, stagedIdentity)) fail(`published ${name} changed identity`);
    assertPublishedProof(name, expectedProof, `published ${name}`);
    if (failAfterPublish === name) fail(`injected restore test failure after publishing ${name}`);
  }
  if (evidenceArchives === 0) {
    const stagedEvidenceIdentity = stages.get(evidenceStage);
    const errors = [];
    removeIfOurs(evidenceStage, stagedEvidenceIdentity, errors);
    if (errors.length > 0) fail(errors.join('; '));
    stages.delete(evidenceStage);
    stageProofs.delete(evidenceStage);
  }
  assertTargetBound('post-publish target binding');
  commitComplete = true;
  try {
    fs.rmSync(rollback, { recursive: true, force: false });
    rollbackCreated = false;
  } catch (error) {
    process.stderr.write(`restore published but retained rollback directory ${rollback}: ${error?.code ?? error?.message}\n`);
  }
} catch (error) {
  failure = error;
}

if (!commitComplete) {
  const recoveryErrors = [];
  assertHeld();
  if (commitStarted) {
    for (const [name, publishedIdentity] of [...published.entries()].reverse()) {
      removeIfOurs(name, publishedIdentity, recoveryErrors);
    }
    for (const [name, originalIdentity] of [...moved.entries()].reverse()) {
      if (exists(name)) {
        recoveryErrors.push(`cannot restore original ${name}: destination is occupied`);
        continue;
      }
      const rollbackName = path.join(rollback, name);
      if (!exists(rollbackName) || !sameIdentity(statIdentity(rollbackName), originalIdentity)) {
        recoveryErrors.push(`cannot restore original ${name}: rollback identity is missing or changed`);
        continue;
      }
      if (testMode && process.env.RESTORE_TEST_FAIL_ROLLBACK_FOR === name) {
        recoveryErrors.push(`injected rollback failure for ${name}`);
        continue;
      }
      try {
        fs.renameSync(rollbackName, name);
        if (!sameIdentity(statIdentity(name), originalIdentity)) {
          recoveryErrors.push(`restored original ${name} changed identity`);
        }
      } catch (error) {
        recoveryErrors.push(`could not restore original ${name}: ${error?.code ?? error?.message}`);
      }
    }
    try { assertTargetBound('rollback target binding'); } catch (error) {
      recoveryErrors.push(error.message);
    }
  }
  for (const [name, stageIdentity] of stages) removeIfOurs(name, stageIdentity, recoveryErrors);
  if (rollbackCreated) {
    if (recoveryErrors.length === 0) {
      try { fs.rmSync(rollback, { recursive: true, force: false }); } catch (error) {
        recoveryErrors.push(`could not remove completed rollback directory: ${error?.code ?? error?.message}`);
      }
    }
    if (recoveryErrors.length > 0) {
      try {
        fs.writeFileSync(path.join(rollback, 'ROLLBACK_INCOMPLETE.txt'),
          `${recoveryErrors.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
      } catch { /* preserve whatever rollback evidence remains */ }
      process.stderr.write(`RESTORE ROLLBACK INCOMPLETE; preserved ${rollback}: ${recoveryErrors.join('; ')}\n`);
    }
  }
  if (recoveryErrors.length === 0 && createdTargetDirectories.length > 0) {
    process.chdir(path.dirname(targetEffect));
    for (const created of [...createdTargetDirectories].reverse()) {
      try {
        if (!exists(created.component)) continue;
        if (!sameIdentity(statIdentity(created.component), created.identity)) {
          recoveryErrors.push(`cannot remove created target directory ${created.path}: identity changed`);
          break;
        }
        if (fs.readdirSync(created.component).length !== 0) {
          recoveryErrors.push(`cannot remove created target directory ${created.path}: directory is not empty`);
          break;
        }
        fs.rmdirSync(created.component);
      } catch (error) {
        recoveryErrors.push(`cannot remove created target directory ${created.path}: ${error?.code ?? error?.message}`);
        break;
      }
    }
  }
  if (recoveryErrors.length > 0) {
    process.stderr.write(`RESTORE ROLLBACK INCOMPLETE: ${recoveryErrors.join('; ')}\n`);
  }
  process.stderr.write(`restore publish failed: ${failure?.message ?? 'UNKNOWN'}\n`);
  process.exit(1);
}
NODE
then
  die_code 1 "restore publication FAILED; inspect rollback evidence in the target if reported"
fi

require_all_authorized_write_root_bindings
require_authorized_observed_root_binding dataDir "$DATA_DIR"
require_authorized_observed_root_binding backupDir "$BACKUP_DIR"
require_authorized_read_root_binding backupSource "$BACKUP_CANON"
ops_log "restore of $BACKUP_ID into $TARGET_CANON complete (events=$EVENTS_COUNT)"
exit 0
