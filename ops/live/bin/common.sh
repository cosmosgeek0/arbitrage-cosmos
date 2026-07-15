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

const [mode, lockDir, rawValue, secondaryValue] = process.argv.slice(2);
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

function classify() {
  const graceMs = Number(rawValue);
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30000) {
    emit('UNKNOWN', 'INVALID_GRACE');
    return;
  }
  let lockStat;
  try {
    lockStat = fs.lstatSync(lockDir);
  } catch (error) {
    emit(error?.code === 'ENOENT' ? 'ABSENT' : 'UNKNOWN',
      error?.code === 'ENOENT' ? 'LOCK_ABSENT' : 'LOCK_STAT_UNAVAILABLE');
    return;
  }
  if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
    emitObserved('MALFORMED', 'LOCK_PATH_UNSAFE');
    return;
  }
  function emitObserved(state, reason, pid = '') {
    try {
      const finalStat = fs.lstatSync(lockDir);
      if (!sameFile(lockStat, finalStat)
          || lockStat.mode !== finalStat.mode
          || lockStat.isDirectory() !== finalStat.isDirectory()
          || lockStat.isSymbolicLink() !== finalStat.isSymbolicLink()) {
        emit('UNKNOWN', 'LOCK_CHANGED_DURING_READ', pid);
        return;
      }
    } catch {
      emit('UNKNOWN', 'LOCK_CHANGED_DURING_READ', pid);
      return;
    }
    emit(state, reason, pid);
  }
  const fresh = lockAgeMs(lockStat) < graceMs;
  const pidFile = boundedRegular(path.join(lockDir, 'pid'), MAX_PID_BYTES);
  if (pidFile.status === 'MISSING') {
    emitObserved(fresh ? 'INITIALIZING' : 'MALFORMED',
      fresh ? 'PID_NOT_PUBLISHED' : 'PID_MISSING');
    return;
  }
  if (pidFile.status === 'UNSAFE' || pidFile.status === 'TOO_LARGE') {
    emitObserved('MALFORMED', pidFile.status === 'UNSAFE' ? 'PID_PATH_UNSAFE' : 'PID_TOO_LARGE');
    return;
  }
  if (pidFile.status !== 'OK') {
    emitObserved('UNKNOWN', 'PID_READ_UNAVAILABLE');
    return;
  }
  const pidText = pidFile.bytes.toString('utf8');
  if (!/^[1-9][0-9]{0,9}\n$/.test(pidText)) {
    emitObserved('MALFORMED', 'PID_FORMAT_INVALID');
    return;
  }
  const pid = Number(pidText.trim());
  if (!Number.isSafeInteger(pid) || pid > MAX_PID) {
    emitObserved('MALFORMED', 'PID_RANGE_INVALID');
    return;
  }
  const firstIdentity = inspectProcess(pid);
  if (firstIdentity.status === 'DEAD') {
    emitObserved('DEAD', 'OWNER_NOT_RUNNING', pid);
    return;
  }
  if (firstIdentity.status !== 'LIVE') {
    emitObserved('UNKNOWN', 'OWNER_IDENTITY_UNAVAILABLE', pid);
    return;
  }
  const ownerFile = boundedRegular(path.join(lockDir, 'owner.json'), MAX_OWNER_BYTES);
  if (ownerFile.status === 'MISSING') {
    emitObserved(fresh ? 'INITIALIZING' : 'UNKNOWN',
      fresh ? 'IDENTITY_NOT_PUBLISHED' : 'IDENTITY_MISSING', pid);
    return;
  }
  if (ownerFile.status === 'UNSAFE' || ownerFile.status === 'TOO_LARGE') {
    emitObserved('MALFORMED',
      ownerFile.status === 'UNSAFE' ? 'OWNER_PATH_UNSAFE' : 'OWNER_TOO_LARGE', pid);
    return;
  }
  if (ownerFile.status !== 'OK') {
    emitObserved('UNKNOWN', 'OWNER_READ_UNAVAILABLE', pid);
    return;
  }
  const owner = parseOwner(ownerFile.bytes, pid);
  if (!owner) {
    emitObserved('MALFORMED', 'OWNER_RECORD_INVALID', pid);
    return;
  }
  const finalIdentity = inspectProcess(pid);
  if (finalIdentity.status === 'DEAD') {
    emitObserved('DEAD', 'OWNER_NOT_RUNNING', pid);
    return;
  }
  if (finalIdentity.status !== 'LIVE'
      || finalIdentity.identityKind !== firstIdentity.identityKind
      || finalIdentity.identitySha256 !== firstIdentity.identitySha256) {
    emitObserved('UNKNOWN', 'OWNER_IDENTITY_CHANGED_DURING_READ', pid);
    return;
  }
  if (owner.identityKind !== finalIdentity.identityKind
      || owner.bootIdentitySha256 !== finalIdentity.bootIdentitySha256
      || owner.startIdentitySha256 !== finalIdentity.startIdentitySha256
      || owner.identitySha256 !== finalIdentity.identitySha256) {
    emitObserved('STALE', 'OWNER_IDENTITY_MISMATCH', pid);
    return;
  }
  emitObserved('LIVE', 'OWNER_IDENTITY_MATCH', pid);
}

function writeOwner() {
  const pid = Number(rawValue);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) throw new Error('invalid pid');
  const dirBefore = fs.lstatSync(lockDir);
  if (dirBefore.isSymbolicLink() || !dirBefore.isDirectory()) throw new Error('invalid lock directory');
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
    if (!sameFile(dirBefore, dirAfter) || afterIdentity.status !== 'LIVE'
        || afterIdentity.identitySha256 !== identity.identitySha256) {
      throw new Error('owner changed during publication');
    }
  } finally {
    try { fs.rmSync(pidTemp, { force: true }); } catch { /* acquisition cleanup */ }
    try { fs.rmSync(ownerTemp, { force: true }); } catch { /* acquisition cleanup */ }
  }
}

function claimExactDirectory(guardDir, expectedToken) {
  if (!/^[0-9]+:[0-9]+$/.test(expectedToken ?? '')) throw new Error('invalid lock token');
  const guardStat = fs.lstatSync(guardDir);
  if (!guardStat.isDirectory() || guardStat.isSymbolicLink()) throw new Error('unsafe reclaim guard');
  if (directoryToken(lockDir) !== expectedToken) throw new Error('lock identity changed');
  const claimed = path.join(guardDir, 'claimed');
  try {
    fs.lstatSync(claimed);
    throw new Error('reclaim destination exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  fs.renameSync(lockDir, claimed);
  if (directoryToken(claimed) !== expectedToken) throw new Error('claimed lock identity changed');
  fs.rmSync(claimed, { recursive: true });
}

function claimForReclamation() {
  claimExactDirectory(rawValue, secondaryValue);
  process.stdout.write('RECLAIMED\n');
}

function releaseOwnedLock() {
  const guardDir = rawValue;
  const pid = Number(secondaryValue);
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) throw new Error('invalid release pid');
  const pidFile = boundedRegular(path.join(lockDir, 'pid'), MAX_PID_BYTES);
  if (pidFile.status !== 'OK' || pidFile.bytes.toString('utf8') !== `${pid}\n`) {
    throw new Error('release pid does not own lock');
  }
  const ownerFile = boundedRegular(path.join(lockDir, 'owner.json'), MAX_OWNER_BYTES);
  if (ownerFile.status !== 'OK') throw new Error('release owner record unavailable');
  const owner = parseOwner(ownerFile.bytes, pid);
  if (!owner) throw new Error('release owner record invalid');
  const identity = inspectProcess(pid);
  if (identity.status !== 'LIVE'
      || owner.identityKind !== identity.identityKind
      || owner.bootIdentitySha256 !== identity.bootIdentitySha256
      || owner.startIdentitySha256 !== identity.startIdentitySha256
      || owner.identitySha256 !== identity.identitySha256) {
    throw new Error('release owner identity mismatch');
  }
  claimExactDirectory(guardDir, directoryToken(lockDir));
  process.stdout.write('RELEASED\n');
}

try {
  if (mode === 'classify') classify();
  else if (mode === 'write') writeOwner();
  else if (mode === 'token') process.stdout.write(`${directoryToken(lockDir)}\n`);
  else if (mode === 'claim') claimForReclamation();
  else if (mode === 'release') releaseOwnedLock();
  else throw new Error('invalid mode');
} catch {
  if (mode === 'classify') emit('UNKNOWN', 'CLASSIFIER_FAILURE');
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

acquire_lock() {
  local dir="$1" deadline guard created_token reclaim_state reclaimed
  deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  guard="${dir}.mutation"
  mkdir -p "$(dirname "$dir")"
  while :; do
    reclaimed=0
    if (umask 077; mkdir "$guard") 2>/dev/null; then
      if (umask 077; mkdir "$dir") 2>/dev/null; then
        created_token=""
        if created_token="$(_lock_owner_tool token "$dir" "")" \
          && _lock_owner_tool write "$dir" "$$"; then
          if rmdir "$guard" 2>/dev/null; then
            return 0
          fi
          ops_log "lock mutation guard could not be released after publication: $guard"
          _lock_owner_tool release "$dir" "$guard" "$$" >/dev/null 2>&1 || true
          rmdir "$guard" 2>/dev/null || true
          return 1
        fi
        ops_log "lock owner identity publication failed: $dir"
        if [ -n "${created_token:-}" ]; then
          _lock_owner_tool claim "$dir" "$guard" "$created_token" >/dev/null 2>&1 || true
        else
          rmdir "$dir" 2>/dev/null || true
        fi
        rmdir "$guard" 2>/dev/null || true
        return 1
      fi
      classify_lock "$dir"
      case "$LOCK_STATE" in
        DEAD|STALE)
          reclaim_state="$LOCK_STATE"
          if created_token="$(_lock_owner_tool token "$dir" "")" \
            && _lock_owner_tool claim "$dir" "$guard" "$created_token" >/dev/null; then
            reclaimed=1
          fi
          ;;
        ABSENT|LIVE|INITIALIZING|MALFORMED|UNKNOWN) : ;;
      esac
      rmdir "$guard" 2>/dev/null || true
      if [ "$reclaimed" = 1 ]; then
        ops_log "removed $reclaim_state lock $dir after guarded owner/inode revalidation"
        continue
      fi
    fi
    if [ "$(now_epoch)" -ge "$deadline" ]; then
      return 1
    fi
    sleep 1
  done
}
release_lock() {
  local dir="$1" guard deadline result
  guard="${dir}.mutation"
  deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  while :; do
    if (umask 077; mkdir "$guard") 2>/dev/null; then
      result=1
      if _lock_owner_tool release "$dir" "$guard" "$$" >/dev/null; then
        result=0
      else
        ops_log "refusing to release lock not owned by this exact process generation: $dir"
      fi
      rmdir "$guard" 2>/dev/null || {
        ops_log "lock mutation guard could not be released: $guard"
        return 1
      }
      return "$result"
    fi
    if [ "$(now_epoch)" -ge "$deadline" ]; then
      ops_log "timed out waiting to release guarded lock: $dir"
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
  if out="$($EXPOSURE_CMD 2>/dev/null)"; then
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
