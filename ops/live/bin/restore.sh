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
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done
[ -n "$BACKUP_ARG" ] || die_code 1 "--backup is required (id, directory, or 'latest')"
[ -n "$TARGET" ] || die_code 1 "--target is required (explicit directory; no default)"

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${BACKUP_DIR:=/var/backups/cosmos}"
require_cmd "$NODE" "$SQLITE" tar

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
[ -e "$BACKUP_PATH/manifest.json" ] || die_code 1 "not a completed backup (no manifest.json): $BACKUP_PATH"
[ -e "$BACKUP_PATH/cosmos.db" ] || die_code 1 "backup has no cosmos.db: $BACKUP_PATH"

# --- production-path guard ------------------------------------------------------
# realpath(3) requires the full leaf to exist. For a new restore target, peel
# only genuinely missing trailing components from the raw path, resolve the
# deepest existing prefix with the filesystem, then append the safe suffix.
# Do not call path.resolve() first: lexical collapse of `alias/../child` does
# not match kernel traversal when alias is a symlink.
canonical_restore_path() {
  "$NODE" - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
try {
  if (typeof input !== 'string' || input.length === 0 || /[\0-\x1f\x7f]/.test(input)) {
    throw new Error('path is empty or contains control bytes');
  }
  const absolute = path.isAbsolute(input) ? input : `${process.cwd()}${path.sep}${input}`;
  const suffix = [];
  let ancestor = absolute;
  for (;;) {
    try {
      fs.lstatSync(ancestor);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      const component = path.basename(ancestor);
      if (component.length === 0 || component === '.' || component === '..') {
        throw new Error('missing path suffix contains dot traversal');
      }
      suffix.unshift(component);
      ancestor = parent;
    }
  }
  const resolvedAncestor = fs.realpathSync.native(ancestor);
  if (suffix.length > 0 && !fs.statSync(resolvedAncestor).isDirectory()) {
    throw new Error('deepest existing ancestor is not a directory');
  }
  process.stdout.write(path.join(resolvedAncestor, ...suffix));
} catch (error) {
  process.stderr.write(`cannot safely canonicalize restore path: ${error?.code ?? error?.message ?? 'UNKNOWN'}\n`);
  process.exit(1);
}
NODE
}
if ! TARGET_CANON="$(canonical_restore_path "$TARGET")"; then
  die_code 1 "cannot safely resolve restore target: $TARGET"
fi
if ! DATA_CANON="$(canonical_restore_path "$DATA_DIR")"; then
  die_code 1 "cannot safely resolve DATA_DIR: $DATA_DIR"
fi
IS_PRODUCTION=0
case "$TARGET_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*) IS_PRODUCTION=1 ;;
esac
if [ "$IS_PRODUCTION" = 1 ]; then
  [ "$ALLOW_PRODUCTION" = 1 ] \
    || die_code 2 "refusing to restore into the live state store ($DATA_CANON); use restore-drill.sh for verification, or pass --allow-production for incident recovery"
  [ "${RESTORE_CONFIRM:-}" = "RESTORE_PRODUCTION" ] \
    || die_code 2 "production restore additionally requires RESTORE_CONFIRM=RESTORE_PRODUCTION in the environment"
  set +e
  "$SYSTEMCTL" is-active "$APP_UNIT" >/dev/null 2>&1
  SYSTEMCTL_RC=$?
  set -e
  case "$SYSTEMCTL_RC" in
    0) die_code 2 "refusing production restore: $APP_UNIT is active; stop it first" ;;
    3) ;;
    *) die_code 2 "refusing production restore: cannot prove $APP_UNIT inactive (systemctl rc=$SYSTEMCTL_RC)" ;;
  esac
  ops_log "production restore authorized (flag + confirm + $APP_UNIT inactive)"
fi

# Canonical target state is checked without creating it. All validation below
# must be side-effect free with respect to this path.
TARGET="$TARGET_CANON"
if [ -e "$TARGET" ] && [ ! -d "$TARGET" ]; then
  die_code 1 "target exists and is not a directory: $TARGET"
fi
if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
  die_code 1 "target is not empty: $TARGET (pass --force to overwrite)"
fi

# --- immutable private snapshot ------------------------------------------------
umask 077
SNAPSHOT=""
cleanup_restore() {
  rc=$?
  trap - EXIT
  rm -rf "$SNAPSHOT" 2>/dev/null || true
  exit "$rc"
}
trap cleanup_restore EXIT

# A private snapshot must not itself mutate the live store, selected backup,
# or restore target. Resolve TMPDIR before mktemp and reject aliases into any
# protected tree.
if ! BACKUP_CANON="$(canonical_restore_path "$BACKUP_PATH")" || [ ! -d "$BACKUP_CANON" ]; then
  die_code 1 "cannot safely resolve backup directory: $BACKUP_PATH"
fi
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
case "$TEMP_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*|"$TARGET_CANON"|"$TARGET_CANON"/*|"$BACKUP_CANON"|"$BACKUP_CANON"/*)
    die_code 1 "refusing unsafe TMPDIR inside DATA_DIR, target, or backup: $TEMP_CANON"
    ;;
esac

SNAPSHOT="$(mktemp -d "$TEMP_CANON/cosmos-restore.XXXXXX")" \
  || die_code 1 "cannot create private restore snapshot"
chmod 700 "$SNAPSHOT"
mkdir "$SNAPSHOT/evidence"
chmod 700 "$SNAPSHOT/evidence"

# Copy the manifest and every declared payload through held descriptors. The
# source pathname must still name the same regular, single-link inode after
# the copy, and the directory inventory/identity must remain stable. Restore
# never consumes the mutable backup directory again after this step.
if ! (cd -P -- "$BACKUP_PATH" && "$NODE" - "$SNAPSHOT" <<'NODE'
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
  return left.dev === right.dev && left.ino === right.ino
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
  eventsCount: manifest.eventsCount,
  archives,
}, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
NODE
); then
  die_code 1 "backup integrity FAILED: unstable, unsafe, or manifest-inconsistent backup at $BACKUP_PATH"
fi

BACKUP_ID="$(json_get "$SNAPSHOT/plan.json" backupId)" \
  || die_code 1 "private restore plan has no backupId"
WANT_SHA="$(json_get "$SNAPSHOT/plan.json" dbSha256)" \
  || die_code 1 "private restore plan has no dbSha256"
INTEGRITY="$("$SQLITE" "$SNAPSHOT/cosmos.db" 'PRAGMA integrity_check;' 2>/dev/null || echo error)"
[ "$INTEGRITY" = "ok" ] || die_code 1 "backup integrity FAILED: $INTEGRITY"
EVENTS_COUNT="$("$SQLITE" "$SNAPSHOT/cosmos.db" 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo -1)"
DECLARED_EVENTS_COUNT="$(json_get "$SNAPSHOT/plan.json" eventsCount)" \
  || die_code 1 "private restore plan has no eventsCount"
[ "$DECLARED_EVENTS_COUNT" = -1 ] || [ "$EVENTS_COUNT" = "$DECLARED_EVENTS_COUNT" ] \
  || die_code 1 "backup integrity FAILED: manifest eventsCount=$DECLARED_EVENTS_COUNT, database eventsCount=$EVENTS_COUNT"
RESTORED_EVIDENCE="$("$NODE" -e \
  'process.stdout.write(String(require(process.argv[1]).archives.length))' \
  "$SNAPSHOT/plan.json")"

# --- private archive preflight -------------------------------------------------
# Both name and verbose/type listings are executed with hard timeout and output
# ceilings. Every archive in the cohort is fully preflighted before any archive
# is extracted. The logical inventory is then compared exactly with the
# normalized extracted inventory, including type and regular-file size.
TAR_BIN="$(command -v tar)"
if ! "$NODE" - "$SNAPSHOT" "$TAR_BIN" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [snapshot, tarBin] = process.argv.slice(2);
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
  ...process.env,
  COPYFILE_DISABLE: '1',
  // C.UTF-8 keeps tar's metadata grammar deterministic without backslash-
  // escaping Unicode names; escaped display text cannot prove byte identity.
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TAR_OPTIONS: '',
};

function runTar(args, timeout, maxBuffer, label) {
  const result = spawnSync(tarBin, args, {
    encoding: 'buffer', env: tarEnv, maxBuffer, timeout, windowsHide: true,
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
    ['-tzf', archivePath], limits.listTimeoutMs, HARD.listBytes,
    `name listing for ${archive.archive}`,
  ), `name listing for ${archive.archive}`);
  const verbose = utf8Lines(runTar(
    ['--numeric-owner', '-tvzf', archivePath], limits.listTimeoutMs, HARD.listBytes,
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
    '--no-same-owner', '--no-same-permissions', '--no-xattrs', '--no-acls',
    '-xzf', archive.archivePath, '-C', extractRoot,
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
PROD_BOOL=false
[ "$IS_PRODUCTION" = 1 ] && PROD_BOOL=true
if ! "$NODE" - "$SNAPSHOT" "$TARGET_CANON" "$DATA_CANON" "$FORCE" \
    "$IS_PRODUCTION" "$(now_utc)" "$BACKUP_ID" "$WANT_SHA" \
    "$DECLARED_EVENTS_COUNT" "$EVENTS_COUNT" "$RESTORED_EVIDENCE" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [
  snapshot, target, dataDir, forceRaw, productionRaw, timestamp, backupId,
  dbSha256, declaredEventsRaw, eventsRaw, evidenceRaw,
] = process.argv.slice(2);
const force = forceRaw === '1';
const production = productionRaw === '1';
const declaredEventsCount = Number(declaredEventsRaw);
const eventsCount = Number(eventsRaw);
const evidenceArchives = Number(evidenceRaw);
const ownedNames = ['cosmos.db', 'cosmos.db-wal', 'cosmos.db-shm', 'evidence', 'restore-report.json'];
const testMode = process.env.COSMOS_RESTORE_TEST_MODE === '1';
const failAfterPublish = testMode ? (process.env.RESTORE_TEST_FAIL_AFTER_PUBLISH ?? '') : '';

function fail(message) { throw new Error(message); }
function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode, type: stat.isDirectory() ? 'd' : 'f' };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.type === right.type;
}
function statIdentity(name) { return identity(fs.lstatSync(name, { bigint: true })); }
function exists(name) {
  try { fs.lstatSync(name); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
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
  const missing = [];
  let ancestor = target;
  for (;;) {
    try {
      directoryIdentity(ancestor);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const component = path.basename(ancestor);
      if (!component || component === '.' || component === '..') fail('unsafe missing target suffix');
      missing.unshift(component);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  process.chdir(ancestor);
  let held = directoryIdentity('.');
  assertNamedDirectory(ancestor, held, 'target ancestor binding');
  let expected = ancestor;
  for (const component of missing) {
    if (exists(component)) fail('target suffix appeared during its exclusive claim');
    fs.mkdirSync(component, { mode: 0o700 });
    process.chdir(component);
    held = directoryIdentity('.');
    expected = path.join(expected, component);
    assertNamedDirectory(expected, held, 'created target binding');
    createdTargetDirectories.push({ path: expected, identity: held });
  }
  if (missing.length === 0) {
    assertNamedDirectory(target, held, 'existing target binding');
  }
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
function rememberStage(name) { stages.set(name, statIdentity(name)); }
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
    if (before.dev !== after.dev || before.ino !== after.ino
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
  copyRegularExclusive(path.join(snapshot, 'cosmos.db'), dbStage, 0o600);
  rememberStage(dbStage);
  fs.mkdirSync(evidenceStage, { mode: 0o700 });
  if (evidenceArchives > 0) {
    for (const name of fs.readdirSync(path.join(snapshot, 'evidence'))) {
      copyEntry(path.join(snapshot, 'evidence', name), path.join(evidenceStage, name));
    }
  }
  rememberStage(evidenceStage);
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
  fs.writeFileSync(reportStage, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  rememberStage(reportStage);
  assertTargetBound('post-staging target binding');

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

  const publications = [[dbStage, 'cosmos.db']];
  if (evidenceArchives > 0) publications.push([evidenceStage, 'evidence']);
  publications.push([reportStage, 'restore-report.json']);
  for (const [stage, name] of publications) {
    assertTargetBound(`pre-publish binding for ${name}`);
    const stagedIdentity = stages.get(stage);
    if (!stagedIdentity) fail(`missing owned staging identity for ${name}`);
    fs.renameSync(stage, name);
    published.set(name, stagedIdentity);
    stages.delete(stage);
    const publishedIdentity = statIdentity(name);
    if (!sameIdentity(publishedIdentity, stagedIdentity)) fail(`published ${name} changed identity`);
    if (failAfterPublish === name) fail(`injected restore test failure after publishing ${name}`);
  }
  if (evidenceArchives === 0) {
    const stagedEvidenceIdentity = stages.get(evidenceStage);
    const errors = [];
    removeIfOurs(evidenceStage, stagedEvidenceIdentity, errors);
    if (errors.length > 0) fail(errors.join('; '));
    stages.delete(evidenceStage);
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
    process.chdir(path.parse(target).root);
    for (const created of [...createdTargetDirectories].reverse()) {
      try {
        if (!exists(created.path)) continue;
        if (!sameIdentity(statIdentity(created.path), created.identity)) {
          recoveryErrors.push(`cannot remove created target directory ${created.path}: identity changed`);
          break;
        }
        if (fs.readdirSync(created.path).length !== 0) {
          recoveryErrors.push(`cannot remove created target directory ${created.path}: directory is not empty`);
          break;
        }
        fs.rmdirSync(created.path);
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

ops_log "restore of $BACKUP_ID into $TARGET_CANON complete (events=$EVENTS_COUNT)"
exit 0
