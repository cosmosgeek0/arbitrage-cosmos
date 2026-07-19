#!/usr/bin/env bash
# ops/live/bin/common.sh — shared helpers for the cosmos deployment artifacts.
#
# Contract for every script that sources this file:
#   - bash 3.2 compatible (macOS test hosts) and Linux/systemd production hosts;
#   - zero network access except loopback health probes driven by the caller;
#   - every side-effecting external command is injectable via environment
#     (SYSTEMCTL, CURL, NODE, SQLITE) so ops/tests can exercise the full logic
#     on a laptop with mocks — never against real systemd/AWS/Cloudflare;
#   - no secrets are ever read, printed, or logged by these helpers.

if [ -n "${_COSMOS_COMMON_LOADED:-}" ]; then return 0; fi
_COSMOS_COMMON_LOADED=1

set -u

: "${NODE:=node}"
: "${CURL:=curl}"
: "${SYSTEMCTL:=systemctl}"
: "${SQLITE:=sqlite3}"
: "${OPS_LOG_TAG:=cosmos-ops}"
: "${HTTP_TIMEOUT_SEC:=5}"
: "${LOCK_TIMEOUT_SEC:=30}"
: "${LOCK_OWNER_GRACE_SEC:=5}"

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_epoch() { date -u +%s; }
now_stamp() { date -u +%Y%m%dT%H%M%SZ; }

ops_log() { printf '%s [%s] %s\n' "$(now_utc)" "$OPS_LOG_TAG" "$*" >&2; }
ops_die() { ops_log "FATAL: $*"; exit "${_DIE_CODE:-1}"; }
die_code() { _DIE_CODE="$1"; shift; ops_die "$@"; }

# Load shell-safe KEY=VALUE lines from an env file. Missing --env-file is an
# error (a typo must not silently fall back to defaults); no argument is fine.
load_env_file() {
  local f="${1:-}"
  [ -n "$f" ] || return 0
  [ -f "$f" ] || die_code 1 "env file not found: $f"
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die_code 1 "required command missing: $c"
  done
}

# Shared filesystem layout. Every path is overridable so tests run in a
# sandbox and so a future host relayout is a config change, not a code edit.
cosmos_layout_defaults() {
  : "${COSMOS_ROOT:=/opt/cosmos}"
  : "${RELEASES_DIR:=$COSMOS_ROOT/releases}"
  : "${CURRENT_LINK:=$COSMOS_ROOT/current}"
  : "${PREVIOUS_LINK:=$COSMOS_ROOT/previous}"
  : "${DATA_DIR:=/var/lib/cosmos/data}"
  : "${OPS_STATE_DIR:=/var/lib/cosmos/ops}"
  : "${APP_UNIT:=cosmos-app.service}"
  : "${TUNNEL_UNIT:=cloudflared.service}"
  : "${HEALTH_BASE:=http://127.0.0.1:8080}"
  : "${DEPLOY_LOCK:=$OPS_STATE_DIR/locks/deploy.lock}"
  : "${DEPLOY_LOG:=$OPS_STATE_DIR/deploy-log.jsonl}"
  : "${FROZEN_MARKER:=$OPS_STATE_DIR/deploy-frozen.json}"
  : "${MONEY_READY_MARKER:=$OPS_STATE_DIR/money-ready}"
  JOURNAL_FILE="$DATA_DIR/journal-compat.json"
}

# --- locking (mkdir-based; flock(1) does not exist on macOS test hosts) -----
# A numeric PID is not an identity: it can be recycled, and kill -0 alone can
# succeed for a zombie. Canonical locks therefore publish a boot/start-bound
# owner record. The classifier is read-only and never follows an untrusted PID
# path; watchdog.sh may use it without taking ownership of deployer mutation.
_lock_owner_tool() {
  "$NODE" - "$@" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [mode, suppliedLockDir, rawValue, secondaryValue, tertiaryValue] = process.argv.slice(2);
const lockDir = path.resolve(suppliedLockDir);
const OWNER_SCHEMA = 'cosmos-lock-owner.v1';
const MAX_PID = 2147483647;
const MAX_PID_BYTES = 32;
const MAX_OWNER_BYTES = 1024;
const HASH_RE = /^[0-9a-f]{64}$/;
const IDENTITY_KINDS = new Set(['linux-proc-v1', 'portable-ps-v1']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function emit(state, reason, pid = '') {
  process.stdout.write(`${state}|${reason}|${pid}\n`);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return 'LIVE';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'DEAD';
    return 'UNKNOWN';
  }
}

function buildIdentity(kind, bootToken, startToken) {
  const bootIdentitySha256 = sha256(String(bootToken));
  const startIdentitySha256 = sha256(String(startToken));
  return Object.freeze({
    identityKind: kind,
    bootIdentitySha256,
    startIdentitySha256,
    identitySha256: sha256(`${kind}\0${bootIdentitySha256}\0${startIdentitySha256}`),
  });
}

function linuxIdentity(pid) {
  try {
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(bootId)) {
      return { status: 'UNKNOWN' };
    }
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(') ');
    if (close < 2) return { status: 'UNKNOWN' };
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const state = fields[0];
    const startTimeTicks = fields[19];
    if (!/^[A-Zx]$/.test(state ?? '') || !/^[1-9][0-9]*$/.test(startTimeTicks ?? '')) {
      return { status: 'UNKNOWN' };
    }
    if (state === 'Z' || state === 'X' || state === 'x') return { status: 'DEAD' };
    return { status: 'LIVE', ...buildIdentity('linux-proc-v1', bootId, startTimeTicks) };
  } catch (error) {
    const existence = processExists(pid);
    return { status: existence === 'DEAD' ? 'DEAD' : 'UNKNOWN' };
  }
}

function portableIdentity(pid) {
  const existence = processExists(pid);
  if (existence !== 'LIVE') return { status: existence };
  const fixedEnv = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC',
  };
  const ps = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat=', '-o', 'lstart='], {
    encoding: 'utf8', env: fixedEnv, timeout: 1000, maxBuffer: 4096,
  });
  const sysctl = spawnSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], {
    encoding: 'utf8', env: fixedEnv, timeout: 1000, maxBuffer: 4096,
  });
  if (ps.status !== 0 || sysctl.status !== 0 || ps.error || sysctl.error) {
    return { status: processExists(pid) === 'DEAD' ? 'DEAD' : 'UNKNOWN' };
  }
  const processMatch = ps.stdout.match(/^\s*(\S+)\s+(.+?)\s*$/);
  const bootMatch = sysctl.stdout.match(/sec\s*=\s*([0-9]+)\s*,\s*usec\s*=\s*([0-9]+)/);
  if (!processMatch || !bootMatch) return { status: 'UNKNOWN' };
  if (processMatch[1].startsWith('Z')) return { status: 'DEAD' };
  return {
    status: 'LIVE',
    ...buildIdentity('portable-ps-v1', `${bootMatch[1]}:${bootMatch[2]}`, processMatch[2]),
  };
}

function inspectProcess(pid) {
  return process.platform === 'linux' ? linuxIdentity(pid) : portableIdentity(pid);
}

function sameFile(left, right) {
  return left['dev'] === right['dev'] && left['ino'] === right['ino'];
}

function directoryToken(directory) {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe lock directory');
  return `${stat['dev']}:${stat['ino']}`;
}

function boundedRegular(file, maxBytes) {
  let before;
  try {
    before = fs.lstatSync(file);
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'MISSING' : 'UNKNOWN' };
  }
  if (before.isSymbolicLink() || !before.isFile()) return { status: 'UNSAFE' };
  if (before.size > maxBytes) return { status: 'TOO_LARGE' };
  let fd;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonblock = fs.constants.O_NONBLOCK ?? 0;
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonblock);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameFile(before, opened) || opened.size > maxBytes) {
      return { status: 'UNSAFE' };
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { status: 'TOO_LARGE' };
    const after = fs.lstatSync(file);
    if (!after.isFile() || after.isSymbolicLink() || !sameFile(opened, after)
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      return { status: 'UNKNOWN' };
    }
    return { status: 'OK', bytes: buffer.subarray(0, bytesRead) };
  } catch (error) {
    if (error?.code === 'ELOOP') return { status: 'UNSAFE' };
    return { status: 'UNKNOWN' };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* read-only classifier cleanup */ }
    }
  }
}

function lockAgeMs(stat) {
  const created = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
    ? stat.birthtimeMs
    : Math.min(stat.ctimeMs, stat.mtimeMs);
  return Math.max(0, Date.now() - created);
}

function parseOwner(bytes, pid) {
  let owner;
  try {
    owner = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  const keys = Object.keys(owner ?? {}).sort();
  const expected = [
    'bootIdentitySha256', 'identityKind', 'identitySha256', 'pid', 'schema',
    'startIdentitySha256',
  ];
  if (!owner || Array.isArray(owner) || keys.length !== expected.length
      || keys.some((key, index) => key !== expected[index])
      || owner.schema !== OWNER_SCHEMA || owner.pid !== pid
      || !IDENTITY_KINDS.has(owner.identityKind)
      || !HASH_RE.test(owner.bootIdentitySha256)
      || !HASH_RE.test(owner.startIdentitySha256)
      || !HASH_RE.test(owner.identitySha256)) {
    return null;
  }
  const expectedIdentity = sha256(
    `${owner.identityKind}\0${owner.bootIdentitySha256}\0${owner.startIdentitySha256}`,
  );
  return owner.identitySha256 === expectedIdentity ? owner : null;
}

function classifyDirectory(directory, graceMs) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30000) {
    return { state: 'UNKNOWN', reason: 'INVALID_GRACE', pid: '' };
  }
  let lockStat;
  try {
    lockStat = fs.lstatSync(directory);
  } catch (error) {
    return {
      state: error?.code === 'ENOENT' ? 'ABSENT' : 'UNKNOWN',
      reason: error?.code === 'ENOENT' ? 'LOCK_ABSENT' : 'LOCK_STAT_UNAVAILABLE',
      pid: '',
    };
  }
  function observed(state, reason, pid = '') {
    try {
      const finalStat = fs.lstatSync(directory);
      if (!sameFile(lockStat, finalStat)
          || lockStat.mode !== finalStat.mode
          || lockStat.isDirectory() !== finalStat.isDirectory()
          || lockStat.isSymbolicLink() !== finalStat.isSymbolicLink()) {
        return { state: 'UNKNOWN', reason: 'LOCK_CHANGED_DURING_READ', pid };
      }
    } catch {
      return { state: 'UNKNOWN', reason: 'LOCK_CHANGED_DURING_READ', pid };
    }
    return { state, reason, pid };
  }
  if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
    return observed('MALFORMED', 'LOCK_PATH_UNSAFE');
  }
  const fresh = lockAgeMs(lockStat) < graceMs;
  const pidFile = boundedRegular(path.join(directory, 'pid'), MAX_PID_BYTES);
  if (pidFile.status === 'MISSING') {
    return observed(fresh ? 'INITIALIZING' : 'MALFORMED',
      fresh ? 'PID_NOT_PUBLISHED' : 'PID_MISSING');
  }
  if (pidFile.status === 'UNSAFE' || pidFile.status === 'TOO_LARGE') {
    return observed('MALFORMED',
      pidFile.status === 'UNSAFE' ? 'PID_PATH_UNSAFE' : 'PID_TOO_LARGE');
  }
  if (pidFile.status !== 'OK') {
    return observed('UNKNOWN', 'PID_READ_UNAVAILABLE');
  }
  const pidText = pidFile.bytes.toString('utf8');
  if (!/^[1-9][0-9]{0,9}\n$/.test(pidText)) {
    return observed('MALFORMED', 'PID_FORMAT_INVALID');
  }
  const pid = Number(pidText.trim());
  if (!Number.isSafeInteger(pid) || pid > MAX_PID) {
    return observed('MALFORMED', 'PID_RANGE_INVALID');
  }
  const firstIdentity = inspectProcess(pid);
  if (firstIdentity.status === 'DEAD') {
    return observed('DEAD', 'OWNER_NOT_RUNNING', pid);
  }
  if (firstIdentity.status !== 'LIVE') {
    return observed('UNKNOWN', 'OWNER_IDENTITY_UNAVAILABLE', pid);
  }
  const ownerFile = boundedRegular(path.join(directory, 'owner.json'), MAX_OWNER_BYTES);
  if (ownerFile.status === 'MISSING') {
    return observed(fresh ? 'INITIALIZING' : 'UNKNOWN',
      fresh ? 'IDENTITY_NOT_PUBLISHED' : 'IDENTITY_MISSING', pid);
  }
  if (ownerFile.status === 'UNSAFE' || ownerFile.status === 'TOO_LARGE') {
    return observed('MALFORMED',
      ownerFile.status === 'UNSAFE' ? 'OWNER_PATH_UNSAFE' : 'OWNER_TOO_LARGE', pid);
  }
  if (ownerFile.status !== 'OK') {
    return observed('UNKNOWN', 'OWNER_READ_UNAVAILABLE', pid);
  }
  const owner = parseOwner(ownerFile.bytes, pid);
  if (!owner) {
    return observed('MALFORMED', 'OWNER_RECORD_INVALID', pid);
  }
  const finalIdentity = inspectProcess(pid);
  if (finalIdentity.status === 'DEAD') {
    return observed('DEAD', 'OWNER_NOT_RUNNING', pid);
  }
  if (finalIdentity.status !== 'LIVE'
      || finalIdentity.identityKind !== firstIdentity.identityKind
      || finalIdentity.identitySha256 !== firstIdentity.identitySha256) {
    return observed('UNKNOWN', 'OWNER_IDENTITY_CHANGED_DURING_READ', pid);
  }
  if (owner.identityKind !== finalIdentity.identityKind
      || owner.bootIdentitySha256 !== finalIdentity.bootIdentitySha256
      || owner.startIdentitySha256 !== finalIdentity.startIdentitySha256
      || owner.identitySha256 !== finalIdentity.identitySha256) {
    return observed('STALE', 'OWNER_IDENTITY_MISMATCH', pid);
  }
  return observed('LIVE', 'OWNER_IDENTITY_MATCH', pid);
}

function classify() {
  const result = classifyDirectory(lockDir, Number(rawValue));
  emit(result.state, result.reason, result.pid);
}

function writeOwner() {
  const pid = Number(rawValue);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) throw new Error('invalid pid');
  const dirBefore = fs.lstatSync(lockDir);
  if (dirBefore.isSymbolicLink() || !dirBefore.isDirectory()) throw new Error('invalid lock directory');
  if (directoryToken(lockDir) !== secondaryValue) throw new Error('lock identity changed before publication');
  const identity = inspectProcess(pid);
  if (identity.status !== 'LIVE') throw new Error('owner identity unavailable');
  const owner = {
    schema: OWNER_SCHEMA,
    pid,
    identityKind: identity.identityKind,
    bootIdentitySha256: identity.bootIdentitySha256,
    startIdentitySha256: identity.startIdentitySha256,
    identitySha256: identity.identitySha256,
  };
  const suffix = `${process.pid}`;
  const pidTemp = path.join(lockDir, `.pid.${suffix}`);
  const ownerTemp = path.join(lockDir, `.owner.${suffix}`);
  try {
    fs.writeFileSync(pidTemp, `${pid}\n`, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(ownerTemp, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(pidTemp, path.join(lockDir, 'pid'));
    fs.renameSync(ownerTemp, path.join(lockDir, 'owner.json'));
    const dirAfter = fs.lstatSync(lockDir);
    const afterIdentity = inspectProcess(pid);
    if (!sameFile(dirBefore, dirAfter) || directoryToken(lockDir) !== secondaryValue
        || afterIdentity.status !== 'LIVE'
        || afterIdentity.identitySha256 !== identity.identitySha256) {
      throw new Error('owner changed during publication');
    }
  } finally {
    try { fs.rmSync(pidTemp, { force: true }); } catch { /* acquisition cleanup */ }
    try { fs.rmSync(ownerTemp, { force: true }); } catch { /* acquisition cleanup */ }
  }
}

function validateToken(value) {
  if (!/^[0-9]+:[0-9]+$/.test(value ?? '')) throw new Error('invalid lock token');
  return value;
}

function claimPathForToken(token) {
  validateToken(token);
  return `${lockDir}.claim.${token.replace(':', '-')}`;
}

function tokenFromClaimPath(claimed) {
  const prefix = `${lockDir}.claim.`;
  if (!claimed.startsWith(prefix)) throw new Error('claim outside lock family');
  const match = claimed.slice(prefix.length).match(/^([0-9]+)-([0-9]+)$/);
  if (!match) throw new Error('invalid claim generation');
  return `${match[1]}:${match[2]}`;
}

function requireAbsent(target, label) {
  try {
    fs.lstatSync(target);
    throw new Error(`${label} exists`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function moveCanonicalToClaim(expectedToken) {
  validateToken(expectedToken);
  if (directoryToken(lockDir) !== expectedToken) throw new Error('lock identity changed');
  const claimed = claimPathForToken(expectedToken);
  requireAbsent(claimed, 'lock claim destination');
  fs.renameSync(lockDir, claimed);
  const actualToken = directoryToken(claimed);
  if (actualToken !== expectedToken) {
    throw new Error('claimed lock identity changed');
  }
  return claimed;
}

function deleteExactClaim(claimed, expectedToken) {
  if (directoryToken(claimed) !== validateToken(expectedToken)) {
    throw new Error('refusing to delete a replaced lock claim');
  }
  fs.rmSync(claimed, { recursive: true });
}

function listClaimPaths() {
  const parent = path.dirname(lockDir);
  const prefix = `${path.basename(lockDir)}.claim.`;
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const claims = entries.filter((entry) => entry.name.startsWith(prefix));
  if (claims.length > 8) throw new Error('too many lock mutation claims');
  return claims.map((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe lock mutation claim');
    const claimed = path.join(parent, entry.name);
    tokenFromClaimPath(claimed);
    const stat = fs.lstatSync(claimed);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe lock mutation claim');
    return claimed;
  }).sort();
}

function legacyGuardObservation() {
  const legacy = `${lockDir}.mutation`;
  let stat;
  try {
    stat = fs.lstatSync(legacy);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { state: 'UNKNOWN', reason: 'MUTATION_GUARD_STAT_UNAVAILABLE', pid: '' };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { state: 'MALFORMED', reason: 'MUTATION_GUARD_PATH_UNSAFE', pid: '' };
  }
  let entries;
  try { entries = fs.readdirSync(legacy); } catch {
    return { state: 'UNKNOWN', reason: 'MUTATION_GUARD_READ_UNAVAILABLE', pid: '' };
  }
  if (entries.length === 0) {
    return { state: 'MALFORMED', reason: 'ORPHANED_MUTATION_GUARD', pid: '' };
  }
  return { state: 'UNKNOWN', reason: 'LEGACY_MUTATION_GUARD_UNVERIFIED', pid: '' };
}

function migrateLegacyGuard(graceMs) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30000) {
    throw new Error('invalid legacy mutation grace');
  }
  const legacy = `${lockDir}.mutation`;
  let stat;
  try {
    stat = fs.lstatSync(legacy);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe legacy mutation guard');
  const entries = fs.readdirSync(legacy).sort();
  if (entries.length === 0) {
    if (lockAgeMs(stat) < graceMs) throw new Error('legacy mutation guard is still within grace');
    try { fs.rmdirSync(legacy); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return;
  }
  if (entries.length !== 1 || entries[0] !== 'claimed') {
    throw new Error('legacy mutation guard has unknown contents');
  }
  requireAbsent(lockDir, 'canonical lock generation');
  const oldClaim = path.join(legacy, 'claimed');
  const token = directoryToken(oldClaim);
  const claimed = claimPathForToken(token);
  requireAbsent(claimed, 'migrated lock claim destination');
  fs.renameSync(oldClaim, claimed);
  if (directoryToken(claimed) !== token) throw new Error('migrated lock claim identity changed');
  fs.rmdirSync(legacy);
}

function classifyFamily() {
  const graceMs = Number(rawValue);
  const canonical = classifyDirectory(lockDir, graceMs);
  const legacy = legacyGuardObservation();
  const claims = listClaimPaths();
  if (legacy) {
    if (claims.length > 0) return emit('UNKNOWN', 'LEGACY_AND_GENERATION_CLAIMS_PRESENT');
    if (canonical.state === 'ABSENT') return emit(legacy.state, legacy.reason, legacy.pid);
    return emit('UNKNOWN', `LEGACY_MUTATION_GUARD_WITH_${canonical.state}`, canonical.pid);
  }
  if (claims.length === 0) return emit(canonical.state, canonical.reason, canonical.pid);
  if (claims.length !== 1 || canonical.state !== 'ABSENT') {
    return emit('UNKNOWN', 'LOCK_GENERATION_CONFLICT');
  }
  const claimed = claims[0];
  const expectedToken = tokenFromClaimPath(claimed);
  const actualToken = directoryToken(claimed);
  if (actualToken !== expectedToken) return emit('UNKNOWN', 'MUTATION_CLAIM_TOKEN_MISMATCH');
  const result = classifyDirectory(claimed, graceMs);
  return emit(result.state, `MUTATION_CLAIM_${result.reason}`, result.pid);
}

function recoverMutationFamily() {
  migrateLegacyGuard(Number(rawValue));
  const claims = listClaimPaths();
  if (claims.length > 0 && classifyDirectory(lockDir, 0).state !== 'ABSENT') {
    throw new Error('canonical and claimed lock generations conflict');
  }
  for (const claimed of claims) {
    const expectedToken = tokenFromClaimPath(claimed);
    const actualToken = directoryToken(claimed);
    if (actualToken !== expectedToken) {
      throw new Error('lock mutation claim token mismatch');
    }
    const result = classifyDirectory(claimed, 0);
    if (result.state === 'DEAD' || result.state === 'STALE') {
      deleteExactClaim(claimed, expectedToken);
      continue;
    }
    throw new Error(`lock mutation claim is ${result.state}`);
  }
  process.stdout.write('MUTATION_FAMILY_RECOVERED\n');
}

function assertMutationFenceClear() {
  if (legacyGuardObservation() || listClaimPaths().length > 0) {
    throw new Error('lock mutation residue appeared during acquisition');
  }
  process.stdout.write('MUTATION_FENCE_CLEAR\n');
}

function discardCreatedLock() {
  const token = validateToken(rawValue);
  const claimed = moveCanonicalToClaim(token);
  deleteExactClaim(claimed, token);
  process.stdout.write('DISCARDED\n');
}

function claimForReclamation() {
  const expectedToken = validateToken(rawValue);
  const expectedState = secondaryValue;
  if (expectedState !== 'DEAD' && expectedState !== 'STALE') {
    throw new Error('invalid reclaim state');
  }
  const claimed = moveCanonicalToClaim(expectedToken);
  const result = classifyDirectory(claimed, 0);
  if (result.state !== 'DEAD' && result.state !== 'STALE') {
    throw new Error('lock owner became consequential during reclamation');
  }
  deleteExactClaim(claimed, expectedToken);
  process.stdout.write('RECLAIMED\n');
}

function releaseOwnedLock() {
  const pid = Number(rawValue);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) throw new Error('invalid release pid');
  const before = classifyDirectory(lockDir, 0);
  if (before.state === 'ABSENT') {
    const claims = listClaimPaths();
    if (claims.length !== 1) throw new Error('release claim is unavailable');
    const existingClaim = claims[0];
    const existingToken = tokenFromClaimPath(existingClaim);
    if (directoryToken(existingClaim) !== existingToken) {
      throw new Error('release claim token mismatch');
    }
    const existingOwner = classifyDirectory(existingClaim, 0);
    if (existingOwner.state !== 'LIVE' || existingOwner.pid !== pid) {
      throw new Error('release claim owner identity mismatch');
    }
    deleteExactClaim(existingClaim, existingToken);
    process.stdout.write('RELEASED\n');
    return;
  }
  if (before.state !== 'LIVE' || before.pid !== pid) {
    throw new Error('release owner identity mismatch');
  }
  const token = directoryToken(lockDir);
  const claimed = moveCanonicalToClaim(token);
  const after = classifyDirectory(claimed, 0);
  if (after.state !== 'LIVE' || after.pid !== pid) {
    throw new Error('release owner changed during claim');
  }
  deleteExactClaim(claimed, token);
  process.stdout.write('RELEASED\n');
}

try {
  if (mode === 'classify') classify();
  else if (mode === 'family') classifyFamily();
  else if (mode === 'write') writeOwner();
  else if (mode === 'token') process.stdout.write(`${directoryToken(lockDir)}\n`);
  else if (mode === 'recover') recoverMutationFamily();
  else if (mode === 'fence') assertMutationFenceClear();
  else if (mode === 'discard') discardCreatedLock();
  else if (mode === 'claim') claimForReclamation();
  else if (mode === 'release') releaseOwnedLock();
  else throw new Error('invalid mode');
} catch {
  if (mode === 'classify' || mode === 'family') emit('UNKNOWN', 'CLASSIFIER_FAILURE');
  else process.exitCode = 1;
}
NODE
}

classify_lock() {
  local dir="$1" grace="${LOCK_OWNER_GRACE_SEC:-5}" out rest
  LOCK_STATE=UNKNOWN
  LOCK_REASON=CLASSIFIER_FAILURE
  LOCK_OWNER_PID=""
  case "$grace" in
    0|[1-9]|[1-2][0-9]|30) ;;
    *) return 0 ;;
  esac
  if out="$(_lock_owner_tool classify "$dir" "$((10#$grace * 1000))")"; then
    LOCK_STATE="${out%%|*}"
    rest="${out#*|}"
    LOCK_REASON="${rest%%|*}"
    LOCK_OWNER_PID="${rest#*|}"
  fi
  case "$LOCK_STATE" in
    ABSENT|LIVE|INITIALIZING|DEAD|STALE|MALFORMED|UNKNOWN) ;;
    *) LOCK_STATE=UNKNOWN; LOCK_REASON=INVALID_CLASSIFIER_OUTPUT; LOCK_OWNER_PID="" ;;
  esac
}

classify_lock_family() {
  local dir="$1" grace="${LOCK_OWNER_GRACE_SEC:-5}" out rest
  LOCK_STATE=UNKNOWN
  LOCK_REASON=CLASSIFIER_FAILURE
  LOCK_OWNER_PID=""
  case "$grace" in
    0|[1-9]|[1-2][0-9]|30) ;;
    *) return 0 ;;
  esac
  if out="$(_lock_owner_tool family "$dir" "$((10#$grace * 1000))")"; then
    LOCK_STATE="${out%%|*}"
    rest="${out#*|}"
    LOCK_REASON="${rest%%|*}"
    LOCK_OWNER_PID="${rest#*|}"
  fi
  case "$LOCK_STATE" in
    ABSENT|LIVE|INITIALIZING|DEAD|STALE|MALFORMED|UNKNOWN) ;;
    *) LOCK_STATE=UNKNOWN; LOCK_REASON=INVALID_CLASSIFIER_OUTPUT; LOCK_OWNER_PID="" ;;
  esac
}

recover_lock_family() {
  local dir="$1" grace="${LOCK_OWNER_GRACE_SEC:-5}"
  case "$grace" in
    0|[1-9]|[1-2][0-9]|30) ;;
    *) return 1 ;;
  esac
  _lock_owner_tool recover "$dir" "$((10#$grace * 1000))"
}

acquire_lock() {
  local dir="$1" deadline created_token reclaim_state
  deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  mkdir -p "$(dirname "$dir")"
  while :; do
    if recover_lock_family "$dir" >/dev/null 2>&1; then
      if (umask 077; mkdir "$dir") 2>/dev/null; then
        created_token=""
        if created_token="$(_lock_owner_tool token "$dir" "")" \
          && _lock_owner_tool write "$dir" "$$" "$created_token"; then
          if _lock_owner_tool fence "$dir" >/dev/null 2>&1; then
            return 0
          fi
          ops_log "lock generation claim appeared during owner publication: $dir"
          _lock_owner_tool release "$dir" "$$" >/dev/null 2>&1 || true
          continue
        fi
        ops_log "lock owner identity publication failed: $dir"
        if [ -n "${created_token:-}" ]; then
          _lock_owner_tool discard "$dir" "$created_token" >/dev/null 2>&1 || true
        fi
        return 1
      fi
      classify_lock "$dir"
      case "$LOCK_STATE" in
        DEAD|STALE)
          reclaim_state="$LOCK_STATE"
          if created_token="$(_lock_owner_tool token "$dir" "")" \
            && _lock_owner_tool claim "$dir" "$created_token" "$reclaim_state" >/dev/null; then
            ops_log "removed $reclaim_state lock $dir after claimed owner/inode revalidation"
            continue
          fi
          ;;
        ABSENT|LIVE|INITIALIZING|MALFORMED|UNKNOWN) : ;;
      esac
    fi
    if [ "$(now_epoch)" -ge "$deadline" ]; then
      return 1
    fi
    sleep 1
  done
}
release_lock() {
  local dir="$1" deadline
  deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  while :; do
    if _lock_owner_tool release "$dir" "$$" >/dev/null; then
      return 0
    fi
    recover_lock_family "$dir" >/dev/null 2>&1 || true
    if [ "$(now_epoch)" -ge "$deadline" ]; then
      ops_log "refusing to release lock not owned by this exact process generation: $dir"
      return 1
    fi
    sleep 1
  done
}

# --- hashing / JSON ----------------------------------------------------------
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# json_get FILE DOTTED.KEY — prints the scalar value; exits 3 when missing.
json_get() {
  "$NODE" -e '
    const fs = require("fs");
    const [file, key] = process.argv.slice(1);
    let v = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const part of key.split(".")) { v = v == null ? undefined : v[part]; }
    if (v === undefined || v === null) process.exit(3);
    process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
  ' "$1" "$2"
}

# json_write FILE KEY=VALUE...  VALUE is parsed as JSON when possible
# (numbers, booleans), otherwise stored as a string.
json_write() {
  local file="$1"; shift
  mkdir -p "$(dirname "$file")"
  "$NODE" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const obj = {};
    for (const pair of process.argv.slice(2)) {
      const i = pair.indexOf("=");
      const k = pair.slice(0, i);
      const raw = pair.slice(i + 1);
      let v;
      try { v = JSON.parse(raw); } catch { v = raw; }
      obj[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  ' "$file" "$@"
}

# jsonl_append FILE KEY=VALUE... — one structured log line, appended.
jsonl_append() {
  local file="$1"; shift
  mkdir -p "$(dirname "$file")"
  "$NODE" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const obj = {};
    for (const pair of process.argv.slice(2)) {
      const i = pair.indexOf("=");
      let v; const raw = pair.slice(i + 1);
      try { v = JSON.parse(raw); } catch { v = raw; }
      obj[pair.slice(0, i)] = v;
    }
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  ' "$file" "$@"
}

# Resolve to a canonical absolute path even when the path is not on disk yet
# (falls back from realpath to path.resolve). Used for production-path guards.
canonical_path() {
  "$NODE" -e '
    const fs = require("fs"), path = require("path");
    const p = path.resolve(process.argv[1]);
    let out = p;
    try { out = fs.realpathSync(p); } catch { /* not on disk yet */ }
    process.stdout.write(out);
  ' "$1"
}

# --- atomic symlink swap -----------------------------------------------------
# rename(2) replaces the destination link atomically and does not dereference
# it. BSD `mv` has no -T and would move INTO a dir symlink, so node does the
# rename portably (node is a hard dependency of the app anyway).
atomic_symlink() {
  local target="$1" link="$2" tmp
  tmp="${link}.tmp.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp"
  "$NODE" -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$tmp" "$link" \
    || { rm -f "$tmp"; return 1; }
}

# Refuse to operate on a link path that exists but is not a symlink — a dirty
# host (leftover real directory at /opt/cosmos/current) must fail loudly
# before any mutation, never be silently replaced.
assert_link_sane() {
  local link="$1"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    die_code 1 "refusing: $link exists and is not a symlink (dirty target host)"
  fi
}

# --- loopback health gate ----------------------------------------------------
http_ok() { "$CURL" -fsS -m "$HTTP_TIMEOUT_SEC" -o /dev/null "$1" 2>/dev/null; }

# gate_wait BASE "PATH PATH..." TIMEOUT_SEC [GUARD_PID]
# Every path must answer 2xx before the deadline. If GUARD_PID dies first,
# fail fast instead of polling a corpse until timeout.
gate_wait() {
  local base="$1" paths="$2" timeout="$3" guard="${4:-}"
  # F-026: an empty path list would iterate zero times and return success,
  # silently passing every gate. Refuse it - an empty gate is a
  # misconfiguration, never a pass.
  [ -n "$paths" ] || { ops_log "gate: refusing an empty gate path list"; return 1; }
  local deadline=$(( $(now_epoch) + timeout )) p
  for p in $paths; do
    while ! http_ok "${base}${p}"; do
      if [ -n "$guard" ] && ! kill -0 "$guard" 2>/dev/null; then
        ops_log "gate: guarded process $guard exited before ${base}${p} became healthy"
        return 1
      fi
      if [ "$(now_epoch)" -ge "$deadline" ]; then
        ops_log "gate: timeout waiting for ${base}${p}"
        return 1
      fi
      sleep 0.5
    done
    ops_log "gate: ${base}${p} healthy"
  done
}

# --- exposure state (§24.2 auto-rollback authority) --------------------------
# EXPOSURE_CMD is an external command that prints one of:
#   NONE | ACTIVE | AMBIGUOUS | RECOVERY_REQUIRED | UNKNOWN
# Anything else, any failure, or no command configured collapses to UNKNOWN,
# which is the freeze-safe answer: automation may only act on literal NONE.
get_exposure() {
  local out
  if [ -z "${EXPOSURE_CMD:-}" ]; then echo UNKNOWN; return 0; fi
  # F-028: do not discard the exposure command's stderr - when the probe is
  # misconfigured the reason must reach the journal, because UNKNOWN silently
  # disables auto-rollback.
  if out="$($EXPOSURE_CMD)"; then
    case "$out" in
      NONE|ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN) echo "$out" ;;
      *) echo UNKNOWN ;;
    esac
  else
    echo UNKNOWN
  fi
}

# --- alerting ----------------------------------------------------------------
# alert SEVERITY CODE MESSAGE — routed through the injectable ALERT_CMD
# (default: structured stderr log). Alerting must never crash the caller.
alert() {
  local cmd="${ALERT_CMD:-}" timeout_sec="${ALERT_TIMEOUT_SEC:-5}"
  if [ -n "$cmd" ]; then
    case "$timeout_sec" in
      [1-9]|[1-2][0-9]|30) ;;
      *) timeout_sec=5 ;;
    esac
    "$NODE" -e '
      const {spawn}=require("child_process");
      const [command,severity,code,message,seconds]=process.argv.slice(1);
      const child=spawn(command,[severity,code,message],{
        detached:true, stdio:["ignore","inherit","inherit"]
      });
      let timedOut=false;
      const deadline=setTimeout(()=>{
        timedOut=true;
        try { process.kill(-child.pid,"SIGKILL"); } catch {}
      },Number(seconds)*1000);
      const hardStop=setTimeout(()=>process.exit(1),Number(seconds)*1000+2000);
      const finish=(ok)=>{
        clearTimeout(deadline);
        clearTimeout(hardStop);
        try { process.kill(-child.pid,"SIGKILL"); } catch {}
        process.exit(ok ? 0 : 1);
      };
      child.once("error",()=>finish(false));
      child.once("exit",codeValue=>finish(!timedOut && codeValue===0));
    ' "$cmd" "$1" "$2" "$3" "$timeout_sec" \
      || ops_log "alert command failed or timed out for $2"
  else
    ops_log "ALERT [$1] $2: $3"
  fi
}
