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

# An I00 action class is a verified descriptor capability, never an environment
# value. A bare marker is rejected before any external command or donor input is
# read. The closed handoff verifier derives the readonly class below.
if [ "${I00_EFFECT_CLASS+x}" = x ]; then
  unset I00_EFFECT_CLASS
  printf '%s\n' 'FATAL: bare I00_EFFECT_CLASS is not an authorization capability' >&2
  exit 1
fi
_I00_AUTHORIZED_EFFECT_PRESENT=0
_I00_AUTHORIZED_EFFECT_CLASS=""
_I00_AUTHORIZED_EFFECT_COMMAND=""
_I00_AUTHORIZED_EFFECT_CLAIM_KEY=""
_I00_EFFECT_OUTPUT_FD=""
_I00_AUTHORIZED_EFFECT_ROLE=""
_I00_AUTHORIZED_HANDOFF_JSON=""
_I00_AUTHORIZED_COMMON_READY=0
if [ "${I00_AUTHORIZED_EFFECT_FD+x}" = x ] \
    || [ "${I00_AUTHORIZED_ROLLBACK_HANDOFF_FD+x}" = x ]; then
  _I00_AUTHORIZED_EFFECT_PRESENT=1
fi
if [ "${RELEASE_SOURCE_IDENTITY_JSON+x}" = x ] \
    || [ "${RELEASE_SOURCE_TREE_SHA256+x}" = x ]; then
  unset RELEASE_SOURCE_IDENTITY_JSON RELEASE_SOURCE_TREE_SHA256
  printf '%s\n' 'FATAL: ambient release source bindings are not authorization capabilities' >&2
  exit 1
fi
_I00_AUTHORIZED_RELEASE_SOURCE_PRESENT=0
_I00_AUTHORIZED_RELEASE_SOURCE_PATH=""
_I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY=""
_I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256=""
unset I00_BASH I00_ENV
_I00_BASH_FROM_ENV_FILE=0
_I00_ENV_FROM_ENV_FILE=0

if [ "${NODE+x}" = x ]; then
  _I00_INHERITED_NODE_PRESENT=1
  _I00_INHERITED_NODE="$NODE"
else
  _I00_INHERITED_NODE_PRESENT=0
  _I00_INHERITED_NODE=""
fi
readonly _I00_INHERITED_NODE_PRESENT _I00_INHERITED_NODE

: "${NODE:=node}"
: "${CURL:=curl}"
: "${SYSTEMCTL:=systemctl}"
: "${SQLITE:=sqlite3}"
: "${OPS_LOG_TAG:=cosmos-ops}"
: "${HTTP_TIMEOUT_SEC:=5}"
: "${LOCK_TIMEOUT_SEC:=30}"
: "${LOCK_OWNER_GRACE_SEC:=5}"

# Guard-bootstrap failures occur before a trusted clock runtime exists. They
# receive an explicit unknown timestamp; successful initialization replaces
# these functions below with guard-runtime clock implementations.
now_utc() { printf '%s\n' UNKNOWN_TIME; }
now_epoch() { printf '%s\n' 0; }
now_stamp() { printf '%s\n' UNKNOWN_TIME; }

ops_log() { printf '%s [%s] %s\n' "$(now_utc)" "$OPS_LOG_TAG" "$*" >&2; }
ops_die() { ops_log "FATAL: $*"; exit "${_DIE_CODE:-1}"; }
die_code() { _DIE_CODE="$1"; shift; ops_die "$@"; }

# Path, unit, and lock guards must not move when a caller replaces NODE or
# prepends a look-alike to PATH. Select from one closed literal path set,
# require a canonical non-symlink leaf and trusted ancestor chain, then bind
# the full chain identity before accepting any caller-controlled path.
_i00_guard_node_identity() {
  local executable="$1"
  "$executable" - "$executable" <<'NODE'
const fs = require('fs');
const path = require('path');
const executable = process.argv[2];
const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
if (uid === null || !path.isAbsolute(executable)) process.exit(1);
const identity = [];
let cursor = executable;
let leaf = true;
for (;;) {
  let stat;
  try {
    stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink() || fs.realpathSync.native(cursor) !== cursor) process.exit(1);
  } catch {
    process.exit(1);
  }
  const mode = stat.mode & 0o7777n;
  if (stat.uid !== 0n && stat.uid !== uid) process.exit(1);
  if ((mode & 0o022n) !== 0n || (mode & 0o7000n) !== 0n) process.exit(1);
  if (leaf) {
    if (!stat.isFile() || (mode & 0o111n) === 0n) process.exit(1);
  } else if (!stat.isDirectory()) {
    process.exit(1);
  }
  identity.push(leaf ? [
    cursor, stat.dev.toString(), stat.ino.toString(), stat.mode.toString(),
    stat.nlink.toString(), stat.uid.toString(), stat.gid.toString(),
    stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString(),
  ] : [
    cursor, stat.dev.toString(), stat.ino.toString(), stat.mode.toString(),
    stat.uid.toString(), stat.gid.toString(),
  ]);
  if (cursor === path.parse(cursor).root) break;
  cursor = path.dirname(cursor);
  leaf = false;
}
process.stdout.write(JSON.stringify(identity));
NODE
}

_I00_GUARD_NODE=""
_I00_GUARD_NODE_IDENTITY=""
unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_ICU_DATA \
  NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_DEBUG NODE_DEBUG_NATIVE \
  OPENSSL_CONF SSL_CERT_FILE SSL_CERT_DIR \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH
if [ "${EUID:-0}" -eq 0 ]; then
  _I00_GUARD_NODE_CANDIDATES="/usr/bin/node"
elif [ "$_I00_INHERITED_NODE_PRESENT" = 1 ]; then
  case "$_I00_INHERITED_NODE" in
    /*) _I00_GUARD_NODE_CANDIDATES="$_I00_INHERITED_NODE" ;;
    *) die_code 1 "inherited NODE must be one absolute executable path" ;;
  esac
else
  _I00_GUARD_NODE_CANDIDATES="/usr/bin/node
/usr/bin/nodejs
/usr/local/bin/node
/opt/homebrew/bin/node"
fi
while IFS= read -r _I00_GUARD_NODE_CANDIDATE
do
  [ -n "$_I00_GUARD_NODE_CANDIDATE" ] || continue
  [ -f "$_I00_GUARD_NODE_CANDIDATE" ] \
    && [ ! -L "$_I00_GUARD_NODE_CANDIDATE" ] \
    && [ -x "$_I00_GUARD_NODE_CANDIDATE" ] \
    || continue
  if [ "${EUID:-0}" -eq 0 ]; then
    [ -O "$_I00_GUARD_NODE_CANDIDATE" ] || continue
    [ -f /usr/bin/stat ] && [ ! -L /usr/bin/stat ] \
      && [ -x /usr/bin/stat ] && [ -O /usr/bin/stat ] \
      || die_code 1 "fixed root stat boundary is unavailable"
    _I00_GUARD_NODE_MODE="$(
      /usr/bin/stat -c '%u:%a' "$_I00_GUARD_NODE_CANDIDATE" 2>/dev/null
    )" || continue
    [ "${_I00_GUARD_NODE_MODE%%:*}" = 0 ] || continue
    _I00_GUARD_NODE_MODE="${_I00_GUARD_NODE_MODE#*:}"
    case "$_I00_GUARD_NODE_MODE" in
      ""|*[!0-7]*) continue ;;
    esac
    _I00_GUARD_NODE_MODE_VALUE=$((8#$_I00_GUARD_NODE_MODE))
    [ $((_I00_GUARD_NODE_MODE_VALUE & 0022)) -eq 0 ] \
      && [ $((_I00_GUARD_NODE_MODE_VALUE & 07000)) -eq 0 ] \
      && [ $((_I00_GUARD_NODE_MODE_VALUE & 0111)) -ne 0 ] \
      || continue
  fi
  if _I00_GUARD_NODE_IDENTITY="$(
    _i00_guard_node_identity "$_I00_GUARD_NODE_CANDIDATE" 2>/dev/null
  )"; then
    _I00_GUARD_NODE="$_I00_GUARD_NODE_CANDIDATE"
    break
  fi
done <<EOF
$_I00_GUARD_NODE_CANDIDATES
EOF
[ -n "$_I00_GUARD_NODE" ] \
  || die_code 1 "trusted fixed-path guard Node executable is unavailable"
readonly _I00_GUARD_NODE _I00_GUARD_NODE_IDENTITY
unset _I00_GUARD_NODE_CANDIDATE _I00_GUARD_NODE_CANDIDATES \
  _I00_GUARD_NODE_MODE _I00_GUARD_NODE_MODE_VALUE
readonly -f _i00_guard_node_identity

i00_guard_node() {
  local current_identity
  if [ "${_I00_AUTHORIZED_COMMON_READY:-0}" = 1 ]; then
    "$_I00_EFFECT_NODE" "$@"
    return
  fi
  current_identity="$(_i00_guard_node_identity "$_I00_GUARD_NODE")" \
    || die_code 1 "trusted guard Node identity cannot be rechecked"
  [ "$current_identity" = "$_I00_GUARD_NODE_IDENTITY" ] \
    || die_code 1 "trusted guard Node identity changed"
  "$_I00_GUARD_NODE" "$@"
}
readonly -f i00_guard_node

if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  _I00_HANDOFF_ROLE=PRIMARY_EFFECT
  if [ "${I00_AUTHORIZED_ROLLBACK_SCRIPT_FD+x}" = x ] \
      || [ "${I00_AUTHORIZED_ROLLBACK_HANDOFF_FD+x}" = x ] \
      || [ "${I00_AUTHORIZED_ROLLBACK_ACK_FD+x}" = x ] \
      || [ "${I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH+x}" = x ]; then
    [ "${I00_AUTHORIZED_ROLLBACK_SCRIPT_FD:-}" = 35 ] \
      && [ "${I00_AUTHORIZED_ROLLBACK_HANDOFF_FD:-}" = 36 ] \
      && [ "${I00_AUTHORIZED_ROLLBACK_ACK_FD:-}" = 37 ] \
      && [ -n "${I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH:-}" ] \
      || die_code 1 "automatic rollback descriptor locators are incomplete"
    if [ "$0" = "$I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH" ]; then
      _I00_HANDOFF_ROLE=AUTOMATIC_ROLLBACK
    fi
  fi
  if [ "$_I00_HANDOFF_ROLE" = AUTOMATIC_ROLLBACK ]; then
    [ "${_I00_AUTO_PARENT_VERIFIED:-0}" = 1 ] \
      || die_code 1 "automatic rollback parent bootstrap is unverified"
  else
    [ "${_I00_RUNNER_PARENT_VERIFIED:-0}" = 1 ] \
      || die_code 1 "primary effect parent bootstrap is unverified"
  fi
  [ "${I00_AUTHORIZED_EFFECT_VERIFIER_FD:-}" = 38 ] \
    || die_code 1 "authorized effect verifier descriptor locator is invalid"
  _I00_AUTHORIZED_HANDOFF_JSON="$(
    /proc/self/fd/16 /proc/self/fd/38 --role "$_I00_HANDOFF_ROLE"
  )" || die_code 1 "authorized effect handoff verification failed"
  _I00_AUTHORIZED_HANDOFF_FIELDS="$(
    /proc/self/fd/16 - "$_I00_AUTHORIZED_HANDOFF_JSON" "$_I00_HANDOFF_ROLE" <<'NODE'
const path = require('node:path');
const value = JSON.parse(process.argv[2]);
const requestedRole = process.argv[3];
const exact = (object, keys) => {
  if (object === null || typeof object !== 'object' || Array.isArray(object)
      || Object.keys(object).sort().join('\0') !== [...keys].sort().join('\0')) {
    process.exit(1);
  }
};
const fd = (number) => `/proc/self/fd/${number}`;
exact(value, [
  'status', 'role', 'actionClass', 'command', 'environment', 'bootstrap',
  'directory', 'executables', 'hashPolicy', 'helperPolicy', 'automaticRollback',
  'writeRoots', 'observedRoots', 'readRoots', 'claimKey', 'effectOutput',
]);
if (value.status !== 'AUTHORIZED_EFFECT_HANDOFF_VERIFIED'
    || value.role !== requestedRole
    || !/^[0-9a-f]{64}$/u.test(value.claimKey)) process.exit(1);
const expectedCommand = {
  SERVICE_RELEASE_SWITCH: requestedRole === 'AUTOMATIC_ROLLBACK'
    ? 'automatic-rollback' : 'release-switch',
  SERVICE_ROLLBACK: 'rollback-switch',
  BACKUP_CREATE: 'backup-verify',
  ISOLATED_RESTORE: 'restore-drill-verify',
}[value.actionClass];
if (expectedCommand === undefined || value.command !== expectedCommand
    || (requestedRole === 'AUTOMATIC_ROLLBACK'
      && value.actionClass !== 'SERVICE_RELEASE_SWITCH')) process.exit(1);
exact(value.environment, ['kind', 'fd']);
if (value.environment.kind !== 'SANITIZED_ENV' || value.environment.fd !== fd(12)) {
  process.exit(1);
}
exact(value.bootstrap, ['kind', 'fd']);
if (value.bootstrap.kind !== 'COMMON_SHELL' || value.bootstrap.fd !== fd(13)) {
  process.exit(1);
}
exact(value.directory, ['kind', 'fd']);
if (value.directory.kind !== 'CLAIM_TEMPORARY_DIRECTORY'
    || value.directory.fd !== fd(15)) process.exit(1);
const executableMaps = {
  SERVICE_RELEASE_SWITCH: {
    node: fd(16), bash: fd(17), env: fd(18), systemctl: fd(19),
    curl: fd(20), sqlite: fd(21), exposure: fd(33), alert: fd(34),
  },
  SERVICE_ROLLBACK: {
    node: fd(16), bash: fd(17), env: fd(18), systemctl: fd(19), curl: fd(20),
    exposure: fd(33), alert: fd(34),
  },
  BACKUP_CREATE: {
    node: fd(16), bash: fd(17), env: fd(18), sqlite: fd(21), tar: fd(22),
    gzip: fd(39), hash: fd(23), id: fd(24), getent: fd(25), setpriv: fd(26),
  },
  ISOLATED_RESTORE: {
    node: fd(16), bash: fd(17), env: fd(18), sqlite: fd(21), tar: fd(22),
    gzip: fd(39), hash: fd(23), id: fd(24), getent: fd(25), setpriv: fd(26),
  },
};
exact(value.executables, Object.keys(executableMaps[value.actionClass]));
for (const [name, token] of Object.entries(executableMaps[value.actionClass])) {
  if (value.executables[name] !== token) process.exit(1);
}
const hashClass = ['BACKUP_CREATE', 'ISOLATED_RESTORE']
  .includes(value.actionClass);
if (hashClass) {
  exact(value.hashPolicy, ['program', 'argvShape']);
  if (value.hashPolicy.program !== fd(23)
      || !['FILE', 'A_256_FILE'].includes(value.hashPolicy.argvShape)) process.exit(1);
} else if (value.hashPolicy !== 'NONE') {
  process.exit(1);
}
const automaticRollbackPresent = value.automaticRollback !== null
  && typeof value.automaticRollback === 'object'
  && !Array.isArray(value.automaticRollback)
  && Object.keys(value.automaticRollback).length > 0;
const writeRootMaps = {
  OPS_BUNDLE_INSTALL: {
    destinationParent: 40,
  },
  SERVICE_RELEASE_SWITCH: {
    cosmosRoot: 41,
    releasesDir: 42,
    currentLinkParent: 43,
    previousLinkParent: 44,
    opsStateDir: 45,
    ...(automaticRollbackPresent ? { rollbackEvidenceRoot: 48 } : {}),
    dataDir: 49,
  },
  SERVICE_ROLLBACK: {
    cosmosRoot: 41,
    releasesDir: 42,
    currentLinkParent: 43,
    previousLinkParent: 44,
    opsStateDir: 45,
    rollbackEvidenceRoot: 48,
    dataDir: 49,
  },
  BACKUP_CREATE: {
    opsStateDir: 45,
    backupDir: 46,
  },
  ISOLATED_RESTORE: {
    isolatedTargetParent: 47,
  },
  SECRET_MATERIALIZATION: null,
};
const expectedWriteRoots = writeRootMaps[value.actionClass];
if (expectedWriteRoots === null) {
  exact(value.writeRoots, []);
} else {
  exact(value.writeRoots, Object.keys(expectedWriteRoots));
  for (const [name, descriptor] of Object.entries(expectedWriteRoots)) {
    const binding = value.writeRoots[name];
    exact(binding, ['fd', 'path', 'identity']);
    if (binding.fd !== fd(descriptor)
        || typeof binding.path !== 'string'
        || !path.isAbsolute(binding.path)
        || path.resolve(binding.path) !== binding.path
        || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u
          .test(binding.identity)) process.exit(1);
  }
}
const observedRootNames = value.actionClass === 'ISOLATED_RESTORE'
  ? ['dataDir', 'backupDir'] : null;
if (observedRootNames === null) {
  exact(value.observedRoots, []);
} else {
  exact(value.observedRoots, observedRootNames);
  for (const name of observedRootNames) {
    const binding = value.observedRoots[name];
    exact(binding, ['path', 'identity']);
    if (typeof binding.path !== 'string'
        || !path.isAbsolute(binding.path)
        || path.resolve(binding.path) !== binding.path
        || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u
          .test(binding.identity)) process.exit(1);
  }
}
const readRootMap = (() => {
  if (value.actionClass === 'BACKUP_CREATE') return { dataDir: 49 };
  if (value.actionClass === 'ISOLATED_RESTORE') return { backupSource: 50 };
  if (value.actionClass === 'SERVICE_ROLLBACK') return { releaseSource: 51 };
  if (value.actionClass === 'SERVICE_RELEASE_SWITCH') {
    return requestedRole === 'AUTOMATIC_ROLLBACK'
      ? { automaticRollbackSource: 52 }
      : { releaseSource: 51 };
  }
  return null;
})();
if (readRootMap === null) {
  exact(value.readRoots, []);
} else {
  exact(value.readRoots, Object.keys(readRootMap));
  for (const [name, descriptor] of Object.entries(readRootMap)) {
    const binding = value.readRoots[name];
    exact(binding, ['fd', 'path', 'identity', 'treeSha256']);
    const directoryIdentity =
      /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u;
    const endpointIdentity =
      /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u;
    if (binding.fd !== fd(descriptor)
        || typeof binding.path !== 'string'
        || !path.isAbsolute(binding.path)
        || path.resolve(binding.path) !== binding.path
        || !(name === 'dataDir'
          ? directoryIdentity.test(binding.identity)
          : endpointIdentity.test(binding.identity))
        || !(name === 'dataDir'
          ? binding.treeSha256 === null
          : /^[0-9a-f]{64}$/u.test(binding.treeSha256))) process.exit(1);
  }
}
const releaseClass = ['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK']
  .includes(value.actionClass);
let releaseBinding = null;
if (releaseClass) {
  const sourceName = requestedRole === 'AUTOMATIC_ROLLBACK'
    ? 'automaticRollbackSource' : 'releaseSource';
  releaseBinding = value.readRoots[sourceName];
}
const helperClass = ['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK']
  .includes(value.actionClass);
if (helperClass) {
  exact(value.helperPolicy, ['exposure', 'alert']);
  exact(value.helperPolicy.exposure, ['program', 'script', 'argvShape', 'timeoutMs']);
  exact(value.helperPolicy.alert, ['program', 'script', 'argvShape', 'timeoutMs']);
  if (value.helperPolicy.exposure.program !== fd(16)
      || value.helperPolicy.exposure.script !== fd(33)
      || value.helperPolicy.exposure.argvShape !== 'NO_ARGS'
      || value.helperPolicy.exposure.timeoutMs !== 3000
      || value.helperPolicy.alert.program !== fd(17)
      || value.helperPolicy.alert.script !== fd(34)
      || value.helperPolicy.alert.argvShape !== 'SEVERITY_CODE_MESSAGE'
      || value.helperPolicy.alert.timeoutMs !== 5000) process.exit(1);
} else if (value.helperPolicy !== 'NONE') {
  process.exit(1);
}
if (value.actionClass === 'SERVICE_RELEASE_SWITCH') {
  if (automaticRollbackPresent) {
    exact(value.automaticRollback, ['status', 'scriptFd', 'handoffFd', 'ackFd']);
    if (value.automaticRollback.status !== (
      requestedRole === 'AUTOMATIC_ROLLBACK' ? 'ACTIVE' : 'ARMED'
    )
        || value.automaticRollback.scriptFd !== fd(35)
        || value.automaticRollback.handoffFd !== fd(36)
        || value.automaticRollback.ackFd !== fd(37)) process.exit(1);
  } else {
    exact(value.automaticRollback, []);
    if (requestedRole !== 'PRIMARY_EFFECT') process.exit(1);
  }
} else {
  exact(value.automaticRollback, []);
}
if (value.actionClass === 'BACKUP_CREATE') {
  exact(value.effectOutput, ['fd', 'kind', 'maxBytes', 'schemaVersion']);
  if (value.effectOutput.fd !== fd(53)
      || value.effectOutput.kind !== 'I00_AUTHORIZED_EFFECT_OUTPUT'
      || value.effectOutput.maxBytes !== 4096
      || value.effectOutput.schemaVersion !== 1) process.exit(1);
} else {
  exact(value.effectOutput, []);
}
const names = [
  'node', 'bash', 'env', 'systemctl', 'curl', 'sqlite', 'tar', 'gzip', 'hash',
  'id', 'getent', 'setpriv',
];
const fields = [
  value.role,
  value.actionClass,
  value.command,
  value.environment.fd,
  ...names.map((name) => value.executables[name] ?? 'NONE'),
  hashClass ? value.hashPolicy.program : 'NONE',
  hashClass ? value.hashPolicy.argvShape : 'NONE',
  releaseClass ? releaseBinding.path : 'NONE',
  releaseClass ? releaseBinding.identity : 'NONE',
  releaseClass ? releaseBinding.treeSha256 : 'NONE',
  helperClass ? value.helperPolicy.exposure.program : 'NONE',
  helperClass ? value.helperPolicy.exposure.script : 'NONE',
  helperClass ? value.helperPolicy.alert.program : 'NONE',
  helperClass ? value.helperPolicy.alert.script : 'NONE',
  automaticRollbackPresent ? value.automaticRollback.status : 'NONE',
  automaticRollbackPresent ? value.automaticRollback.scriptFd : 'NONE',
  automaticRollbackPresent ? value.automaticRollback.handoffFd : 'NONE',
  automaticRollbackPresent ? value.automaticRollback.ackFd : 'NONE',
  value.claimKey,
  value.actionClass === 'BACKUP_CREATE' ? value.effectOutput.fd : 'NONE',
];
process.stdout.write(`${fields.join('\n')}\n`);
NODE
  )" || die_code 1 "authorized effect verifier output is invalid"
  _I00_HANDOFF_FIELD_INDEX=0
  while IFS= read -r _I00_HANDOFF_FIELD
  do
    _I00_HANDOFF_FIELD_INDEX=$((_I00_HANDOFF_FIELD_INDEX + 1))
    case "$_I00_HANDOFF_FIELD_INDEX" in
      1) _I00_AUTHORIZED_EFFECT_ROLE="$_I00_HANDOFF_FIELD" ;;
      2) _I00_AUTHORIZED_EFFECT_CLASS="$_I00_HANDOFF_FIELD" ;;
      3) _I00_AUTHORIZED_EFFECT_COMMAND="$_I00_HANDOFF_FIELD" ;;
      4) _I00_EFFECT_ENVIRONMENT="$_I00_HANDOFF_FIELD" ;;
      5) _I00_EFFECT_NODE="$_I00_HANDOFF_FIELD" ;;
      6) _I00_EFFECT_BASH="$_I00_HANDOFF_FIELD" ;;
      7) _I00_EFFECT_ENV="$_I00_HANDOFF_FIELD" ;;
      8) _I00_EFFECT_SYSTEMCTL="$_I00_HANDOFF_FIELD" ;;
      9) _I00_EFFECT_CURL="$_I00_HANDOFF_FIELD" ;;
      10) _I00_EFFECT_SQLITE="$_I00_HANDOFF_FIELD" ;;
      11) _I00_EFFECT_TAR="$_I00_HANDOFF_FIELD" ;;
      12) _I00_EFFECT_GZIP="$_I00_HANDOFF_FIELD" ;;
      13) _I00_EFFECT_HASH="$_I00_HANDOFF_FIELD" ;;
      14) _I00_EFFECT_ID="$_I00_HANDOFF_FIELD" ;;
      15) _I00_EFFECT_GETENT="$_I00_HANDOFF_FIELD" ;;
      16) _I00_EFFECT_SETPRIV="$_I00_HANDOFF_FIELD" ;;
      17) _I00_HASH_PROGRAM="$_I00_HANDOFF_FIELD" ;;
      18) _I00_HASH_ARGV_SHAPE="$_I00_HANDOFF_FIELD" ;;
      19) _I00_AUTHORIZED_RELEASE_SOURCE_PATH="$_I00_HANDOFF_FIELD" ;;
      20) _I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY="$_I00_HANDOFF_FIELD" ;;
      21) _I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256="$_I00_HANDOFF_FIELD" ;;
      22) _I00_EXPOSURE_PROGRAM="$_I00_HANDOFF_FIELD" ;;
      23) _I00_EXPOSURE_SCRIPT="$_I00_HANDOFF_FIELD" ;;
      24) _I00_ALERT_PROGRAM="$_I00_HANDOFF_FIELD" ;;
      25) _I00_ALERT_SCRIPT="$_I00_HANDOFF_FIELD" ;;
      26) _I00_AUTO_STATUS="$_I00_HANDOFF_FIELD" ;;
      27) _I00_AUTO_SCRIPT="$_I00_HANDOFF_FIELD" ;;
      28) _I00_AUTO_HANDOFF="$_I00_HANDOFF_FIELD" ;;
      29) _I00_AUTO_ACK="$_I00_HANDOFF_FIELD" ;;
      30) _I00_AUTHORIZED_EFFECT_CLAIM_KEY="$_I00_HANDOFF_FIELD" ;;
      31) _I00_EFFECT_OUTPUT_FD="$_I00_HANDOFF_FIELD" ;;
      *) die_code 1 "authorized effect verifier output has excess fields" ;;
    esac
  done <<EOF
$_I00_AUTHORIZED_HANDOFF_FIELDS
EOF
  [ "$_I00_HANDOFF_FIELD_INDEX" = 31 ] \
    || die_code 1 "authorized effect verifier output is incomplete"
  if [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PATH" != NONE ]; then
    _I00_AUTHORIZED_RELEASE_SOURCE_PRESENT=1
  else
    _I00_AUTHORIZED_RELEASE_SOURCE_PATH=""
    _I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY=""
    _I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256=""
  fi
  _I00_AUTHORIZED_COMMON_READY=1
  readonly _I00_AUTHORIZED_EFFECT_PRESENT _I00_AUTHORIZED_EFFECT_ROLE \
    _I00_AUTHORIZED_EFFECT_CLASS _I00_AUTHORIZED_EFFECT_COMMAND \
    _I00_AUTHORIZED_EFFECT_CLAIM_KEY _I00_EFFECT_OUTPUT_FD \
    _I00_AUTHORIZED_HANDOFF_JSON _I00_EFFECT_ENVIRONMENT \
    _I00_EFFECT_NODE _I00_EFFECT_BASH _I00_EFFECT_ENV \
    _I00_EFFECT_SYSTEMCTL _I00_EFFECT_CURL _I00_EFFECT_SQLITE \
    _I00_EFFECT_TAR _I00_EFFECT_GZIP _I00_EFFECT_HASH \
    _I00_EFFECT_ID _I00_EFFECT_GETENT \
    _I00_EFFECT_SETPRIV _I00_HASH_PROGRAM _I00_HASH_ARGV_SHAPE \
    _I00_AUTHORIZED_RELEASE_SOURCE_PRESENT \
    _I00_AUTHORIZED_RELEASE_SOURCE_PATH \
    _I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY \
    _I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256 \
    _I00_EXPOSURE_PROGRAM _I00_EXPOSURE_SCRIPT \
    _I00_ALERT_PROGRAM _I00_ALERT_SCRIPT _I00_AUTO_STATUS \
    _I00_AUTO_SCRIPT _I00_AUTO_HANDOFF _I00_AUTO_ACK \
    _I00_AUTHORIZED_COMMON_READY
  unset _I00_AUTHORIZED_HANDOFF_FIELDS _I00_HANDOFF_FIELD \
    _I00_HANDOFF_FIELD_INDEX _I00_HANDOFF_ROLE
else
  readonly _I00_AUTHORIZED_EFFECT_PRESENT _I00_AUTHORIZED_EFFECT_ROLE \
    _I00_AUTHORIZED_EFFECT_CLASS _I00_AUTHORIZED_EFFECT_COMMAND \
    _I00_AUTHORIZED_EFFECT_CLAIM_KEY _I00_EFFECT_OUTPUT_FD \
    _I00_AUTHORIZED_HANDOFF_JSON _I00_AUTHORIZED_COMMON_READY \
    _I00_AUTHORIZED_RELEASE_SOURCE_PRESENT \
    _I00_AUTHORIZED_RELEASE_SOURCE_PATH \
    _I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY \
    _I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256
fi

now_utc() {
  i00_guard_node -e '
    process.stdout.write(new Date().toISOString().replace(/[.][0-9]{3}Z$/, "Z"));
  '
}
now_epoch() {
  i00_guard_node -e 'process.stdout.write(`${Math.floor(Date.now() / 1000)}\n`)'
}
now_stamp() {
  i00_guard_node -e '
    process.stdout.write(new Date().toISOString()
      .replace(/[-:]/g, "").replace(/[.][0-9]{3}Z$/, "Z"));
  '
}

i00_effect_class_is() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    && [ "$_I00_AUTHORIZED_EFFECT_CLASS" = "$1" ]
}

require_i00_effect_class() {
  local expected="$1"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
    die_code 1 "production effect requires verified I00 action class $expected"
  fi
  [ "$_I00_AUTHORIZED_EFFECT_CLASS" = "$expected" ] \
    || die_code 1 "production effect class mismatch: expected $expected"
}

require_i00_effect_env_file_binding() {
  local env_file="${1:-}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    [ "$env_file" = "$_I00_EFFECT_ENVIRONMENT" ] \
      || die_code 1 "authorized effect requires descriptor-bound sanitized environment"
  fi
}

require_authorized_write_root_binding() {
  local name="${1:-}" expected_path="${2:-}"
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" "$expected_path" <<'NODE' \
    || die_code 1 "authorized write-root binding changed"
const fs = require('node:fs');
const document = JSON.parse(process.argv[2]);
const [name, expectedPath] = process.argv.slice(3);
const identity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `uid=${stat.uid}`,
  `gid=${stat.gid}`,
].join(',');
const verify = (binding, selectedPath) => {
  if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
      || Object.keys(binding).sort().join('\0') !== ['fd', 'identity', 'path'].join('\0')
      || (selectedPath !== '' && binding.path !== selectedPath)
      || !/^\/proc\/self\/fd\/(?:4[0-9])$/u.test(binding.fd)
      || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u
        .test(binding.identity)) process.exit(1);
  const descriptor = Number(binding.fd.slice('/proc/self/fd/'.length));
  const opened = fs.fstatSync(descriptor, { bigint: true });
  const named = fs.lstatSync(binding.path, { bigint: true, throwIfNoEntry: false });
  if (!opened.isDirectory() || !named?.isDirectory() || named.isSymbolicLink()
      || opened.dev !== named.dev || opened.ino !== named.ino
      || identity(opened) !== binding.identity || identity(named) !== binding.identity
      || fs.realpathSync.native(binding.path) !== binding.path) process.exit(1);
};
if (name === '*') {
  if (document.writeRoots === null || typeof document.writeRoots !== 'object'
      || Array.isArray(document.writeRoots)) process.exit(1);
  for (const binding of Object.values(document.writeRoots)) verify(binding, '');
} else {
  verify(document.writeRoots?.[name], expectedPath);
}
NODE
}

require_all_authorized_write_root_bindings() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  require_authorized_write_root_binding '*' ''
}

authorized_write_effect_path() {
  local name="${1:-}" named_path="${2:-}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
    printf '%s\n' "$named_path"
    return 0
  fi
  require_authorized_write_root_binding "$name" "$(
    i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" <<'NODE'
const value = JSON.parse(process.argv[2]);
const binding = value.writeRoots?.[process.argv[3]];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) process.exit(1);
process.stdout.write(binding.path);
NODE
  )"
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" "$named_path" <<'NODE' \
    || die_code 1 "effect path is outside its authorized write-root capability"
const path = require('node:path');
const value = JSON.parse(process.argv[2]);
const [name, selected] = process.argv.slice(3);
const binding = value.writeRoots?.[name];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || typeof selected !== 'string' || !path.isAbsolute(selected)
    || path.resolve(selected) !== selected
    || (selected !== binding.path && !selected.startsWith(`${binding.path}/`))) {
  process.exit(1);
}
const relative = path.relative(binding.path, selected);
if (relative !== '' && relative.split(path.sep).some((component) => (
  component === '' || component === '.' || component === '..'
))) process.exit(1);
process.stdout.write(relative === ''
  ? binding.fd
  : `${binding.fd}/${relative.split(path.sep).join('/')}`);
NODE
}

require_authorized_read_root_binding() {
  local name="${1:-}" expected_path="${2:-}"
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" "$expected_path" <<'NODE' \
    || die_code 1 "authorized read-root binding changed"
const fs = require('node:fs');
const value = JSON.parse(process.argv[2]);
const [name, expectedPath] = process.argv.slice(3);
const binding = value.readRoots?.[name];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join('\0')
      !== ['fd', 'identity', 'path', 'treeSha256'].join('\0')
    || binding.path !== expectedPath
    || !/^\/proc\/self\/fd\/(?:49|50|51|52)$/u.test(binding.fd)) process.exit(1);
const descriptor = Number(binding.fd.slice('/proc/self/fd/'.length));
const opened = fs.fstatSync(descriptor, { bigint: true });
const named = fs.lstatSync(expectedPath, { bigint: true, throwIfNoEntry: false });
const directoryIdentity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `uid=${stat.uid}`,
  `gid=${stat.gid}`,
].join(',');
const endpointIdentity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `size=${stat.size}`,
  `mtimeNs=${stat.mtimeNs}`,
  `ctimeNs=${stat.ctimeNs}`,
].join(',');
const expectedIdentity = name === 'dataDir'
  ? directoryIdentity(opened) : endpointIdentity(opened);
const namedIdentity = name === 'dataDir'
  ? directoryIdentity(named) : endpointIdentity(named);
if (!opened.isDirectory() || !named?.isDirectory() || named.isSymbolicLink()
    || opened.dev !== named.dev || opened.ino !== named.ino
    || expectedIdentity !== binding.identity || namedIdentity !== binding.identity
    || fs.realpathSync.native(expectedPath) !== expectedPath) process.exit(1);
NODE
}

authorized_read_effect_path() {
  local name="${1:-}" named_path="${2:-}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
    printf '%s\n' "$named_path"
    return 0
  fi
  require_authorized_read_root_binding "$name" "$(
    i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" <<'NODE'
const value = JSON.parse(process.argv[2]);
const binding = value.readRoots?.[process.argv[3]];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) process.exit(1);
process.stdout.write(binding.path);
NODE
  )"
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" "$named_path" <<'NODE' \
    || die_code 1 "read path is outside its authorized root capability"
const path = require('node:path');
const value = JSON.parse(process.argv[2]);
const [name, selected] = process.argv.slice(3);
const binding = value.readRoots?.[name];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || typeof selected !== 'string' || !path.isAbsolute(selected)
    || path.resolve(selected) !== selected
    || (selected !== binding.path && !selected.startsWith(`${binding.path}/`))) {
  process.exit(1);
}
const relative = path.relative(binding.path, selected);
if (relative !== '' && relative.split(path.sep).some((component) => (
  component === '' || component === '.' || component === '..'
))) process.exit(1);
process.stdout.write(relative === ''
  ? binding.fd
  : `${binding.fd}/${relative.split(path.sep).join('/')}`);
NODE
}

authorized_read_root_named_path() {
  local name="${1:-}"
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    || die_code 1 "named read-root lookup requires an authorized effect"
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" <<'NODE' \
    || die_code 1 "authorized read-root binding is missing"
const value = JSON.parse(process.argv[2]);
const binding = value.readRoots?.[process.argv[3]];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || typeof binding.path !== 'string') process.exit(1);
process.stdout.write(binding.path);
NODE
}

require_authorized_observed_root_binding() {
  local name="${1:-}" expected_path="${2:-}"
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  i00_guard_node - "$_I00_AUTHORIZED_HANDOFF_JSON" "$name" "$expected_path" <<'NODE' \
    || die_code 1 "authorized observed-root binding changed"
const fs = require('node:fs');
const value = JSON.parse(process.argv[2]);
const [name, expectedPath] = process.argv.slice(3);
const binding = value.observedRoots?.[name];
if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join('\0') !== ['identity', 'path'].join('\0')
    || binding.path !== expectedPath
    || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u
      .test(binding.identity)) process.exit(1);
const named = fs.lstatSync(expectedPath, { bigint: true, throwIfNoEntry: false });
const identity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `uid=${stat.uid}`,
  `gid=${stat.gid}`,
].join(',');
if (!named?.isDirectory() || named.isSymbolicLink()
    || identity(named) !== binding.identity
    || fs.realpathSync.native(expectedPath) !== expectedPath) process.exit(1);
NODE
}

refuse_i00_effect_class() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ] \
    || die_code 1 "this donor has no authorized production action class"
}

require_nonroot_direct_effect_or_i00_class() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] && return 0
  [ "${EUID:-0}" -ne 0 ] \
    || die_code 1 "direct donor effects are unavailable to root"
}

_i00_authorized_token_is_approved() {
  local candidate="${1:-}" token
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 1
  for token in \
    "$_I00_EFFECT_NODE" "$_I00_EFFECT_BASH" "$_I00_EFFECT_ENV" \
    "$_I00_EFFECT_SYSTEMCTL" "$_I00_EFFECT_CURL" "$_I00_EFFECT_SQLITE" \
    "$_I00_EFFECT_TAR" "$_I00_EFFECT_GZIP" "$_I00_EFFECT_HASH" "$_I00_EFFECT_ID" \
    "$_I00_EFFECT_GETENT" "$_I00_EFFECT_SETPRIV" \
    "$_I00_EXPOSURE_PROGRAM" "$_I00_EXPOSURE_SCRIPT" \
    "$_I00_ALERT_PROGRAM" "$_I00_ALERT_SCRIPT"
  do
    [ "$token" != NONE ] && [ "$candidate" = "$token" ] && return 0
  done
  return 1
}

# Authorized donors use only verifier-approved retained descriptors. Named
# canonical executable inspection is retained solely for direct contained
# staging and non-effect fixtures.
require_i00_effect_node_binding() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  [ "${NODE:-}" = "$_I00_EFFECT_NODE" ] \
    || die_code 1 "authorized donor NODE must equal its verified descriptor"
}

require_trusted_effect_executable() {
  local executable="${1:-}" label="${2:-effect executable}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    _i00_authorized_token_is_approved "$executable" \
      || die_code 1 "$label differs from the verified descriptor capability"
    return 0
  fi
  i00_guard_node - "$executable" <<'NODE' \
    || die_code 1 "$label must be one trusted canonical absolute executable"
const fs = require('fs');
const path = require('path');
const executable = process.argv[2];
const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
if (uid === null || !path.isAbsolute(executable)) process.exit(1);
let cursor = executable;
let leaf = true;
for (;;) {
  let stat;
  try {
    stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink() || fs.realpathSync.native(cursor) !== cursor) process.exit(1);
  } catch {
    process.exit(1);
  }
  const mode = stat.mode & 0o7777n;
  if (stat.uid !== 0n && stat.uid !== uid) process.exit(1);
  if ((mode & 0o022n) !== 0n || (mode & 0o7000n) !== 0n) process.exit(1);
  if (leaf) {
    if (!stat.isFile() || (mode & 0o111n) === 0n) process.exit(1);
  } else if (!stat.isDirectory()) {
    process.exit(1);
  }
  if (cursor === path.parse(cursor).root) break;
  cursor = path.dirname(cursor);
  leaf = false;
}
NODE
}

path_is_within() {
  local candidate="$1" root="$2"
  case "$candidate" in
    "$root"|"$root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

path_effectively_within() {
  local candidate root candidate_canonical root_canonical
  candidate="$1"
  root="$2"
  candidate_canonical="$(canonical_path "$candidate")" \
    || die_code 1 "cannot canonicalize effect path: $candidate"
  root_canonical="$(canonical_protected_root "$root")" \
    || die_code 1 "cannot canonicalize protected root: $root"
  path_is_within "$candidate_canonical" "$root_canonical"
}

canonical_path_intersects_protected_union() {
  local candidate_canonical="$1" protected_root root_canonical
  for protected_root in \
    /opt/cosmos \
    /var/lib/cosmos \
    /var/backups/cosmos \
    /etc/cosmos \
    /run/cosmos-app \
    /run/cosmos-secret-source \
    /usr/local/lib/cosmos-ops \
    /var/lib/cosmos-deployment-authorization \
    /var/lib/cosmos-authorization-consumption \
    /var/lib/cosmos-action-receipts
  do
    root_canonical="$(canonical_protected_root "$protected_root")" \
      || die_code 1 "cannot canonicalize protected root: $protected_root"
    if path_is_within "$candidate_canonical" "$root_canonical" \
        || path_is_within "$root_canonical" "$candidate_canonical"; then
      return 0
    fi
  done
  return 1
}

path_effectively_intersects_protected_union() {
  local candidate="$1" candidate_canonical
  candidate_canonical="$(canonical_path "$candidate")" \
    || die_code 1 "cannot canonicalize effect path: $candidate"
  canonical_path_intersects_protected_union "$candidate_canonical"
}

canonical_pointer_leaf() {
  i00_guard_node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const input = process.argv[2];
if (!input || /[\0-\x1f\x7f]/.test(input)) process.exit(1);
const absolute = path.isAbsolute(input) ? input : `${process.cwd()}${path.sep}${input}`;
let parent = path.dirname(absolute);
const name = path.basename(absolute);
if (!name || name === '.' || name === '..') process.exit(1);
const suffix = [];
for (;;) {
  try {
    fs.lstatSync(parent);
    break;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    const next = path.dirname(parent);
    if (next === parent) throw error;
    const component = path.basename(parent);
    if (!component || component === '.' || component === '..') process.exit(1);
    suffix.unshift(component);
    parent = next;
  }
}
const ancestor = fs.realpathSync.native(parent);
if (suffix.length > 0 && !fs.statSync(ancestor).isDirectory()) process.exit(1);
process.stdout.write(path.join(ancestor, ...suffix, name));
NODE
}

pointer_path_effectively_intersects_protected_union() {
  local candidate="$1" candidate_canonical
  candidate_canonical="$(canonical_pointer_leaf "$candidate")" \
    || die_code 1 "cannot canonicalize pointer effect path: $candidate"
  canonical_path_intersects_protected_union "$candidate_canonical"
}

any_path_effectively_intersects_protected_union() {
  local candidate
  for candidate in "$@"; do
    path_effectively_intersects_protected_union "$candidate" && return 0
  done
  return 1
}

require_exact_direct_child() {
  local candidate="$1" root="$2" expected_name="${3:-}" candidate_canonical root_canonical
  candidate_canonical="$(canonical_path "$candidate")" \
    || die_code 1 "cannot canonicalize direct-child candidate: $candidate"
  root_canonical="$(canonical_path "$root")" \
    || die_code 1 "cannot canonicalize direct-child root: $root"
  i00_guard_node - "$candidate_canonical" "$root_canonical" "$expected_name" <<'NODE' \
    || die_code 1 "effect target must be one exact direct child of its canonical root"
const path = require('path');
const [candidate, root, expected] = process.argv.slice(2);
if (candidate === root || path.dirname(candidate) !== root) process.exit(1);
const name = path.basename(candidate);
if (!name || name === '.' || name === '..') process.exit(1);
if (expected && name !== expected) process.exit(1);
process.stdout.write(candidate);
NODE
}

# Filesystem effect helpers intentionally execute through i00_guard_node.
# Authorized donors bind NODE to that same fixed runtime; staging donors gain
# the same PATH-independent behavior without adding mutable command lookups.
fs_mkdir_p() {
  i00_guard_node -e '
    const fs = require("fs");
    for (const target of process.argv.slice(1)) fs.mkdirSync(target, { recursive: true });
  ' "$@"
}

fs_mkdir_exclusive() {
  i00_guard_node -e '
    require("fs").mkdirSync(process.argv[1], { mode: 0o700 });
  ' "$1"
}

fs_remove_tree() {
  i00_guard_node -e '
    const fs = require("fs");
    for (const target of process.argv.slice(1)) fs.rmSync(target, { recursive: true, force: true });
  ' "$@"
}

fs_remove_file() {
  i00_guard_node -e '
    const fs = require("fs");
    for (const target of process.argv.slice(1)) fs.rmSync(target, { force: true });
  ' "$@"
}

fs_copy_tree() {
  i00_guard_node -e '
    require("fs").cpSync(process.argv[1], process.argv[2], {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    });
  ' "$1" "$2"
}

i00_release_tree_gate() { # MODE SOURCE DESTINATION EXPECTED_SOURCE_IDENTITY EXPECTED_TREE [DESTINATION_NAMED] [SOURCE_NAMED]
  i00_guard_node - "$1" "$2" "$3" "$4" "$5" "${6:-}" "${7:-}" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [
  mode, source, destination, expectedSourceIdentity, expectedTree,
  destinationNamed, sourceNamed,
] =
  process.argv.slice(2);
const fail = () => process.exit(1);
const DIGEST = /^[0-9a-f]{64}$/u;
const ENDPOINT_IDENTITY =
  /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u;
const MAX_ENTRIES = 100000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_TREE_BYTES = 8 * 1024 * 1024 * 1024;
if (!['inspect-source', 'inspect-tree', 'copy-source'].includes(mode)
    || !path.isAbsolute(source) || path.resolve(source) !== source
    || (sourceNamed !== ''
      && (!path.isAbsolute(sourceNamed) || path.resolve(sourceNamed) !== sourceNamed))
    || (mode === 'copy-source'
      ? (!path.isAbsolute(destination) || path.resolve(destination) !== destination
        || !path.isAbsolute(destinationNamed)
        || path.resolve(destinationNamed) !== destinationNamed)
      : destination !== '' || destinationNamed !== '')
    || !DIGEST.test(expectedTree)
    || (mode === 'inspect-tree'
      ? expectedSourceIdentity !== ''
      : !ENDPOINT_IDENTITY.test(expectedSourceIdentity))
    || typeof fs.constants.O_NOFOLLOW !== 'number') fail();
const sourcePhysical = sourceNamed === '' ? source : sourceNamed;

const endpointIdentity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `size=${stat.size}`,
  `mtimeNs=${stat.mtimeNs}`,
  `ctimeNs=${stat.ctimeNs}`,
].join(',');
const stableIdentity = (stat) => [
  stat.dev.toString(), stat.ino.toString(), stat.mode.toString(),
  stat.nlink.toString(), stat.uid.toString(), stat.gid.toString(),
  stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString(),
].join(':');
const sameStableIdentity = (left, right) =>
  stableIdentity(left) === stableIdentity(right);
const canonicalStat = (target, expectedPhysical = target) => {
  const descriptorRoot = /^\/proc\/self\/fd\/(?:4[0-9]|5[0-2])$/u.test(target);
  const stat = descriptorRoot
    ? fs.statSync(target, { bigint: true })
    : fs.lstatSync(target, { bigint: true });
  if ((!descriptorRoot && stat.isSymbolicLink())
      || fs.realpathSync.native(target) !== expectedPhysical) fail();
  return stat;
};
const readStableFile = (target, expected = null, expectedPhysical = target) => {
  const namedBefore = canonicalStat(target, expectedPhysical);
  if (!namedBefore.isFile() || namedBefore.nlink < 1n
      || namedBefore.size < 0n || namedBefore.size > BigInt(MAX_FILE_BYTES)) fail();
  const rawMode = namedBefore.mode & 0o7777n;
  if ((rawMode & 0o7000n) !== 0n) fail();
  const executable = rawMode & 0o111n;
  if (executable !== 0n && executable !== 0o111n) fail();
  if (expected !== null && stableIdentity(namedBefore) !== expected.identity) fail();
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const openedBefore = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStableIdentity(namedBefore, openedBefore)) fail();
    const bytes = fs.readFileSync(descriptor);
    const openedAfter = fs.fstatSync(descriptor, { bigint: true });
    const namedAfter = canonicalStat(target, expectedPhysical);
    if (!sameStableIdentity(openedBefore, openedAfter)
        || !sameStableIdentity(openedAfter, namedAfter)) fail();
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const gitMode = executable === 0o111n ? '100755' : '100644';
    if (expected !== null
        && (expected.sha256 !== sha256 || expected.gitMode !== gitMode)) fail();
    return {
      bytes,
      sha256,
      gitMode,
      identity: stableIdentity(openedAfter),
      mode: Number(rawMode & 0o777n),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};
const snapshot = (root, physicalRoot = root) => {
  const rootBefore = canonicalStat(root, physicalRoot);
  if (!rootBefore.isDirectory()) fail();
  const entries = [];
  let totalBytes = 0;
  const visit = (relative) => {
    const directory = relative ? path.join(root, relative) : root;
    const physicalDirectory = relative ? path.join(physicalRoot, relative) : physicalRoot;
    const directoryBefore = canonicalStat(directory, physicalDirectory);
    if (!directoryBefore.isDirectory()) fail();
    for (const name of fs.readdirSync(directory).sort()) {
      if (!name || name === '.' || name === '..' || name.includes('/')) fail();
      const next = relative ? `${relative}/${name}` : name;
      const absolute = path.join(root, next);
      const physicalAbsolute = path.join(physicalRoot, next);
      const stat = canonicalStat(absolute, physicalAbsolute);
      if (stat.isDirectory()) {
        entries.push({
          path: next,
          type: 'directory',
          identity: stableIdentity(stat),
          mode: Number(stat.mode & 0o777n),
        });
        visit(next);
      } else if (stat.isFile()) {
        const file = readStableFile(absolute, null, physicalAbsolute);
        totalBytes += file.bytes.length;
        if (totalBytes > MAX_TREE_BYTES) fail();
        entries.push({
          path: next,
          type: 'file',
          identity: file.identity,
          sha256: file.sha256,
          gitMode: file.gitMode,
          mode: file.mode,
        });
      } else {
        fail();
      }
      if (entries.length > MAX_ENTRIES) fail();
    }
    const directoryAfter = canonicalStat(directory, physicalDirectory);
    if (!sameStableIdentity(directoryBefore, directoryAfter)) fail();
  };
  visit('');
  const rootAfter = canonicalStat(root, physicalRoot);
  if (!sameStableIdentity(rootBefore, rootAfter)) fail();
  const digest = crypto.createHash('sha256');
  for (const entry of entries) {
    if (entry.type === 'directory') {
      digest.update('directory\0');
      digest.update(entry.path);
      digest.update('\n');
    } else {
      digest.update(entry.path);
      digest.update('\0');
      digest.update(entry.gitMode);
      digest.update('\0');
      digest.update(entry.sha256);
      digest.update('\n');
    }
  }
  return {
    entries,
    endpointIdentity: endpointIdentity(rootAfter),
    treeSha256: digest.digest('hex'),
  };
};
const logicalEntries = (entries) => entries.map((entry) => (
  entry.type === 'directory'
    ? { path: entry.path, type: entry.type }
    : {
        path: entry.path,
        type: entry.type,
        gitMode: entry.gitMode,
        sha256: entry.sha256,
      }
));
const sourceInitial = snapshot(source, sourcePhysical);
if (sourceInitial.treeSha256 !== expectedTree
    || (mode !== 'inspect-tree'
      && sourceInitial.endpointIdentity !== expectedSourceIdentity)) fail();

if (mode === 'copy-source') {
  const destinationParent = path.dirname(destination);
  const destinationNamedParent = path.dirname(destinationNamed);
  const parentStat = canonicalStat(destinationParent, destinationNamedParent);
  if (!parentStat.isDirectory()
      || fs.lstatSync(destination, { throwIfNoEntry: false }) !== undefined) fail();
  const sourceRootStat = canonicalStat(source, sourcePhysical);
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const entry of sourceInitial.entries) {
    const target = path.join(destination, entry.path);
    if (entry.type === 'directory') {
      // Keep every new directory owner-writable until all descendants exist.
      // The authorized source mode is applied bottom-up only after the exact
      // bytes have been copied.
      fs.mkdirSync(target, { mode: 0o700 });
      continue;
    }
    const file = readStableFile(
      path.join(source, entry.path),
      entry,
      path.join(sourcePhysical, entry.path),
    );
    fs.writeFileSync(target, file.bytes, {
      flag: 'wx',
      mode: entry.mode,
    });
    fs.chmodSync(target, entry.mode);
  }
  for (const entry of sourceInitial.entries.slice().reverse()) {
    if (entry.type === 'directory') {
      fs.chmodSync(path.join(destination, entry.path), entry.mode);
    }
  }
  fs.chmodSync(destination, Number(sourceRootStat.mode & 0o777n));
  const sourceFinal = snapshot(source, sourcePhysical);
  const destinationFinal = snapshot(destination, destinationNamed);
  if (sourceFinal.endpointIdentity !== expectedSourceIdentity
      || sourceFinal.treeSha256 !== expectedTree
      || JSON.stringify(sourceInitial.entries) !== JSON.stringify(sourceFinal.entries)
      || destinationFinal.treeSha256 !== expectedTree
      || JSON.stringify(logicalEntries(sourceInitial.entries))
        !== JSON.stringify(logicalEntries(destinationFinal.entries))) fail();
} else {
  const sourceFinal = snapshot(source, sourcePhysical);
  if (sourceFinal.treeSha256 !== expectedTree
      || (mode !== 'inspect-tree'
        && sourceFinal.endpointIdentity !== expectedSourceIdentity)
      || JSON.stringify(sourceInitial.entries) !== JSON.stringify(sourceFinal.entries)) fail();
}
NODE
}

authorized_release_source_binding_is_exact() {
  local source_name source_named source_effect
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  if [ "$_I00_AUTHORIZED_EFFECT_ROLE" = AUTOMATIC_ROLLBACK ]; then
    source_name=automaticRollbackSource
  else
    source_name=releaseSource
  fi
  source_named="$(authorized_read_root_named_path "$source_name")" || return 1
  source_effect="$(authorized_read_effect_path "$source_name" "$source_named")" || return 1
  [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PRESENT" = 1 ] \
    && [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PATH" = "$source_named" ] \
    && { [ "$1" = "$source_named" ] || [ "$1" = "$source_effect" ]; } \
    || return 1
  i00_release_tree_gate inspect-source "$source_effect" "" \
    "$_I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY" \
    "$_I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256" "" "$source_named"
}

require_authorized_release_source_binding() {
  authorized_release_source_binding_is_exact "$1" \
    || die_code 1 "authorized release source identity/tree binding changed"
}

authorized_release_source_effect_path() {
  local source_name source_named="${1:-}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
    printf '%s\n' "$source_named"
    return 0
  fi
  if [ "$_I00_AUTHORIZED_EFFECT_ROLE" = AUTOMATIC_ROLLBACK ]; then
    source_name=automaticRollbackSource
  else
    source_name=releaseSource
  fi
  [ "$source_named" = "$(authorized_read_root_named_path "$source_name")" ] \
    || die_code 1 "release source path differs from its authorized read root"
  authorized_read_effect_path "$source_name" "$source_named"
}

copy_authorized_release_source() {
  local source_named source_effect
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" != 1 ]; then
    fs_copy_tree "$1" "$2"
    return
  fi
  [ "$_I00_AUTHORIZED_EFFECT_ROLE" = PRIMARY_EFFECT ] \
    || die_code 1 "only the primary release effect may copy a release source"
  source_named="$(authorized_read_root_named_path releaseSource)"
  source_effect="$(authorized_read_effect_path releaseSource "$source_named")"
  [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PRESENT" = 1 ] \
    && [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PATH" = "$source_named" ] \
    && { [ "$1" = "$source_named" ] || [ "$1" = "$source_effect" ]; } \
    || die_code 1 "authorized release source identity/tree binding is missing"
  i00_release_tree_gate copy-source "$source_effect" "$2" \
    "$_I00_AUTHORIZED_RELEASE_SOURCE_IDENTITY" \
    "$_I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256" "${3:-$2}" "$source_named" \
    || die_code 1 "authorized release source changed during exact copy"
}

authorized_release_destination_tree_is_exact() {
  local destination_effect
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] || return 0
  [ "$_I00_AUTHORIZED_RELEASE_SOURCE_PRESENT" = 1 ] \
    || return 1
  destination_effect="$(authorized_write_effect_path releasesDir "$1")" || return 1
  i00_release_tree_gate inspect-tree "$destination_effect" "" "" \
    "$_I00_AUTHORIZED_RELEASE_SOURCE_TREE_SHA256" "" "$1"
}

require_authorized_release_destination_tree() {
  authorized_release_destination_tree_is_exact "$1" \
    || die_code 1 "installed release differs from the authorized source tree"
}

completed_backup_inventory() { # MODE BACKUP_ROOT [RETENTION_COUNT]
  i00_guard_node - "$1" "$2" "${3:-}" <<'NODE'
const fs = require('fs');
const path = require('path');
const [mode, root, retentionRaw] = process.argv.slice(2);
if (!['list', 'latest', 'has', 'prune'].includes(mode)
    || !path.isAbsolute(root) || path.resolve(root) !== root) process.exit(2);
const descriptorRoot = /^\/proc\/self\/fd\/(?:4[0-9]|5[0-2])$/u.test(root);
const rootStat = descriptorRoot
  ? fs.statSync(root, { bigint: true, throwIfNoEntry: false })
  : fs.lstatSync(root, { bigint: true, throwIfNoEntry: false });
if (rootStat === undefined) {
  if (mode === 'has') process.exit(1);
  if (mode === 'prune') process.exit(2);
  process.exit(0);
}
const rootPhysical = fs.realpathSync.native(root);
if (!rootStat.isDirectory()
    || (!descriptorRoot && (rootStat.isSymbolicLink() || rootPhysical !== root))) {
  process.exit(2);
}
const pattern = /^[0-9]{8}T[0-9]{6}Z(?:-[1-9][0-9]*)?$/u;
const names = [];
for (const name of fs.readdirSync(root).sort()) {
  if (!pattern.test(name)) continue;
  const target = path.join(root, name);
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync.native(target) !== path.join(rootPhysical, name)) process.exit(2);
  names.push(name);
}
if (mode === 'has') process.exit(names.length > 0 ? 0 : 1);
if (mode === 'latest') {
  if (names.length > 0) process.stdout.write(names[names.length - 1]);
  process.exit(0);
}
if (mode === 'list') {
  if (names.length > 0) process.stdout.write(`${names.join('\n')}\n`);
  process.exit(0);
}
if (!/^(?:0|[1-9][0-9]*)$/u.test(retentionRaw)) process.exit(2);
const retention = Number(retentionRaw);
if (!Number.isSafeInteger(retention) || retention < 1 || retention > 100000) process.exit(2);
const prune = names.slice(0, Math.max(0, names.length - retention));
for (const name of prune) {
  const target = path.join(root, name);
  const before = fs.lstatSync(target);
  if (!before.isDirectory() || before.isSymbolicLink()
      || fs.realpathSync.native(target) !== path.join(rootPhysical, name)) process.exit(2);
  fs.rmSync(target, { recursive: true });
}
if (prune.length > 0) process.stdout.write(`${prune.join('\n')}\n`);
NODE
}

fs_rename() {
  i00_guard_node -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$1" "$2"
}

fs_publish_directory_durable() { # WORK_DIRECTORY FINAL_DIRECTORY PARENT_DIRECTORY
  i00_guard_node - "$1" "$2" "$3" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [work, final, parent] = process.argv.slice(2);
const fail = () => process.exit(1);
const descriptorRoot = /^\/proc\/self\/fd\/([1-9][0-9]*)$/u.exec(parent);
if (!path.isAbsolute(work) || !path.isAbsolute(final) || !path.isAbsolute(parent)
    || path.dirname(work) !== parent || path.dirname(final) !== parent
    || work === final || path.basename(work) === '.' || path.basename(work) === '..'
    || path.basename(final) === '.' || path.basename(final) === '..'
    || path.basename(work).includes('\0') || path.basename(final).includes('\0')
    || (!descriptorRoot
      && (path.resolve(work) !== work
        || path.resolve(final) !== final
        || path.resolve(parent) !== parent))) fail();
let parentFd;
let closeParent = false;
let workFd;
try {
  if (descriptorRoot) {
    parentFd = Number(descriptorRoot[1]);
  } else {
    if (typeof fs.constants.O_DIRECTORY !== 'number'
        || typeof fs.constants.O_NOFOLLOW !== 'number') fail();
    parentFd = fs.openSync(
      parent,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    closeParent = true;
  }
  const parentBefore = fs.fstatSync(parentFd, { bigint: true });
  if (!parentBefore.isDirectory()) fail();
  const workBefore = fs.lstatSync(work, { bigint: true, throwIfNoEntry: false });
  if (!workBefore?.isDirectory() || workBefore.isSymbolicLink()
      || fs.lstatSync(final, { throwIfNoEntry: false }) !== undefined) fail();
  workFd = fs.openSync(
    work,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  const openedWork = fs.fstatSync(workFd, { bigint: true });
  if (openedWork.dev !== workBefore.dev || openedWork.ino !== workBefore.ino) fail();
  const openedWorkPath = process.platform === 'linux'
    ? `/proc/self/fd/${workFd}`
    : work;
  for (const name of fs.readdirSync(openedWorkPath).sort()) {
    if (name.length === 0 || name === '.' || name === '..'
        || name.includes('/') || name.includes('\0')) fail();
    const member = `${openedWorkPath}/${name}`;
    const before = fs.lstatSync(member, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail();
    const descriptor = fs.openSync(
      member,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
          || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs
          || opened.ctimeNs !== before.ctimeNs) fail();
      fs.fsyncSync(descriptor);
      const after = fs.fstatSync(descriptor, { bigint: true });
      if (after.dev !== opened.dev || after.ino !== opened.ino
          || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
          || after.ctimeNs !== opened.ctimeNs) fail();
    } finally {
      fs.closeSync(descriptor);
    }
  }
  fs.fsyncSync(workFd);
  fs.renameSync(work, final);
  fs.fsyncSync(parentFd);
  const openedAfter = fs.fstatSync(workFd, { bigint: true });
  const finalAfter = fs.lstatSync(final, { bigint: true, throwIfNoEntry: false });
  const parentAfter = fs.fstatSync(parentFd, { bigint: true });
  if (!finalAfter?.isDirectory() || finalAfter.isSymbolicLink()
      || openedAfter.dev !== openedWork.dev || openedAfter.ino !== openedWork.ino
      || finalAfter.dev !== openedAfter.dev || finalAfter.ino !== openedAfter.ino
      || parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino
      || fs.realpathSync.native(final)
        !== path.join(fs.realpathSync.native(parent), path.basename(final))) fail();
} catch {
  fail();
} finally {
  if (workFd !== undefined) {
    try { fs.closeSync(workFd); } catch {}
  }
  if (closeParent && parentFd !== undefined) {
    try { fs.closeSync(parentFd); } catch {}
  }
}
NODE
}

fs_seal_file_readonly() { # FILE PARENT_DIRECTORY
  i00_guard_node - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [target, parent] = process.argv.slice(2);
const fail = () => process.exit(1);
if (!path.isAbsolute(target) || path.resolve(target) !== target
    || !path.isAbsolute(parent) || path.resolve(parent) !== parent
    || path.dirname(target) !== parent) fail();
const sameObject = (left, right) => left.dev === right.dev && left.ino === right.ino;
const before = fs.lstatSync(target, { bigint: true, throwIfNoEntry: false });
if (!before?.isFile() || before.isSymbolicLink()) fail();
const noFollow = fs.constants.O_NOFOLLOW ?? 0;
const nonblock = fs.constants.O_NONBLOCK ?? 0;
let fileFd;
let parentFd;
let closeParent = false;
try {
  fileFd = fs.openSync(target, fs.constants.O_RDWR | noFollow | nonblock);
  const opened = fs.fstatSync(fileFd, { bigint: true });
  if (!opened.isFile() || !sameObject(before, opened)) fail();
  fs.fchmodSync(fileFd, 0o400);
  fs.fsyncSync(fileFd);
  const sealed = fs.fstatSync(fileFd, { bigint: true });
  if (!sealed.isFile() || !sameObject(opened, sealed)
      || Number(sealed.mode & 0o7777n) !== 0o400) fail();

  const descriptorRoot = /^\/proc\/self\/fd\/([1-9][0-9]*)$/u.exec(parent);
  if (descriptorRoot) {
    parentFd = Number(descriptorRoot[1]);
    if (!Number.isSafeInteger(parentFd)
        || !fs.fstatSync(parentFd, { bigint: true }).isDirectory()) fail();
  } else {
    const parentBefore = fs.lstatSync(parent, { bigint: true, throwIfNoEntry: false });
    if (!parentBefore?.isDirectory() || parentBefore.isSymbolicLink()
        || fs.realpathSync.native(parent) !== parent) fail();
    parentFd = fs.openSync(
      parent,
      fs.constants.O_RDONLY | noFollow | (fs.constants.O_DIRECTORY ?? 0),
    );
    closeParent = true;
    if (!sameObject(parentBefore, fs.fstatSync(parentFd, { bigint: true }))) fail();
  }
  fs.fsyncSync(parentFd);
  const namedAfter = fs.lstatSync(target, { bigint: true, throwIfNoEntry: false });
  if (!namedAfter?.isFile() || namedAfter.isSymbolicLink()
      || !sameObject(sealed, namedAfter)
      || Number(namedAfter.mode & 0o7777n) !== 0o400) fail();
} finally {
  if (fileFd !== undefined) fs.closeSync(fileFd);
  if (closeParent && parentFd !== undefined) fs.closeSync(parentFd);
}
NODE
}

fs_mkdtemp() {
  i00_guard_node -e 'process.stdout.write(require("fs").mkdtempSync(process.argv[1]))' "$1"
}

fs_adjust_tree_write_bits() {
  local target="$1" disposition="$2"
  i00_guard_node - "$target" "$disposition" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, disposition] = process.argv.slice(2);
if (!['owner-write', 'remove-write'].includes(disposition)) process.exit(1);
const visit = (target) => {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
  }
  const mode = stat.mode & 0o7777;
  const next = disposition === 'owner-write' ? mode | 0o200 : mode & ~0o222;
  fs.chmodSync(target, next);
};
visit(root);
NODE
}

fs_remove_release_staging() {
  i00_guard_node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
let entries = [];
try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) {
  if (error?.code === 'ENOENT') process.exit(0);
  throw error;
}
for (const entry of entries) {
  if (entry.name.startsWith('.staging-')) {
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
}
NODE
}

path_dirname() {
  i00_guard_node -e 'process.stdout.write(require("path").dirname(process.argv[1]))' "$1"
}

path_basename() {
  i00_guard_node -e 'process.stdout.write(require("path").basename(process.argv[1]))' "$1"
}

read_symlink() {
  i00_guard_node -e 'process.stdout.write(require("fs").readlinkSync(process.argv[1]))' "$1"
}

guard_sleep() {
  i00_guard_node -e '
    const seconds = Number(process.argv[1]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) process.exit(1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
  ' "$1"
}

# Authorized I00 wrappers bind the supervisor executable independently. A
# donor invoked without that inherited class is staging-only and may reach
# supervisor effects only through an exact user-owned mock. This closes unit
# aliases and real/root-owned systemctl paths without inventing a production
# authorization class for direct donor execution.
require_staging_supervisor_mock_or_i00_class() {
  local supervisor
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] && return 0
  [ "${EUID:-0}" -ne 0 ] \
    || die_code 1 "direct donor supervisor effects are unavailable to root"
  supervisor="${SYSTEMCTL:-}"
  i00_guard_node -e '
    const fs = require("fs"), path = require("path");
    try {
      const candidate = process.argv[1];
      const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
      if (uid === null || uid === 0n || !path.isAbsolute(candidate)
          || path.basename(candidate) !== "mock-systemctl.sh") process.exit(1);
      const stat = fs.lstatSync(candidate, { bigint: true });
      const mode = stat.mode & 0o7777n;
      if (!stat.isFile() || stat.isSymbolicLink()
          || fs.realpathSync.native(candidate) !== candidate
          || stat.uid !== uid
          || (mode & 0o111n) === 0n
          || (mode & 0o022n) !== 0n
          || (mode & 0o7000n) !== 0n) process.exit(1);
    } catch {
      process.exit(1);
    }
  ' "$supervisor" \
    || die_code 1 "direct donor supervisor effects require one canonical non-root staging mock"
}

require_staging_app_unit_or_i00_class() {
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] && return 0
  if ! [[ "${APP_UNIT:-}" =~ ^df32-fixture-[a-z0-9][a-z0-9-]*[.]service$ ]]; then
    die_code 1 "direct staging donor requires one exact df32 fixture application unit"
  fi
}

configure_i00_bash() {
  local canonical
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    [ "${I00_BASH:-}" = "$_I00_EFFECT_BASH" ] \
      && [ "${I00_ENV:-}" = "$_I00_EFFECT_ENV" ] \
      || die_code 1 "authorized Bash/env programs differ from verified descriptors"
    return 0
  elif [ "$_I00_BASH_FROM_ENV_FILE" != 1 ]; then
    # usr-merged distributions (Ubuntu 24.04 among them) ship /bin as a
    # symlink to usr/bin, so the literal /bin/bash is NOT canonical there and
    # the strict assert below would reject this module's own built-in default.
    # Canonicalize the DEFAULT only. Values supplied through an env file are
    # deliberately left untouched: they must already be canonical, exactly as
    # before, and are still rejected by the identical assert if they are not.
    I00_BASH="$(i00_guard_node -e '
      const fs = require("fs");
      process.stdout.write(fs.realpathSync(process.argv[1]));
    ' /bin/bash)" \
      || die_code 1 "default Bash program cannot be canonicalized"
  fi
  if [ "$_I00_ENV_FROM_ENV_FILE" != 1 ]; then
    I00_ENV=/usr/bin/env
  fi
  case "${I00_BASH:-}" in
    /*) : ;;
    *) die_code 1 "I00_BASH must be one canonical absolute executable path" ;;
  esac
  [ -x "$I00_BASH" ] \
    || die_code 1 "I00_BASH is not executable"
  canonical="$(i00_guard_node -e '
    const fs = require("fs");
    process.stdout.write(fs.realpathSync(process.argv[1]));
  ' "$I00_BASH")" \
    || die_code 1 "I00_BASH cannot be canonicalized"
  [ "$canonical" = "$I00_BASH" ] \
    || die_code 1 "I00_BASH must already be canonical"
  case "${I00_ENV:-}" in
    /*) : ;;
    *) die_code 1 "I00_ENV must be one canonical absolute executable path" ;;
  esac
  [ -x "$I00_ENV" ] \
    || die_code 1 "I00_ENV is not executable"
  canonical="$(i00_guard_node -e '
    const fs = require("fs");
    process.stdout.write(fs.realpathSync(process.argv[1]));
  ' "$I00_ENV")" \
    || die_code 1 "I00_ENV cannot be canonicalized"
  [ "$canonical" = "$I00_ENV" ] \
    || die_code 1 "I00_ENV must already be canonical"
}

run_authorized_automatic_rollback() {
  local bootstrap
  [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    && i00_effect_class_is SERVICE_RELEASE_SWITCH \
    && [ "$_I00_AUTHORIZED_EFFECT_ROLE" = PRIMARY_EFFECT ] \
    && [ "$_I00_AUTO_STATUS" = ARMED ] \
    && [ "$_I00_AUTO_SCRIPT" = /proc/self/fd/35 ] \
    && [ "$_I00_AUTO_HANDOFF" = /proc/self/fd/36 ] \
    && [ "$_I00_AUTO_ACK" = /proc/self/fd/37 ] \
    && [ "$I00_BASH" = /proc/self/fd/17 ] \
    && [ "$I00_ENV" = /proc/self/fd/18 ] \
    || die_code 1 "automatic rollback capability is unavailable"
  bootstrap='[ -r "/proc/$PPID/stat" ] && [ -r "/proc/$PPID/cmdline" ] || exit 125
[ "/proc/$PPID/exe" -ef /proc/self/exe ] || exit 125
IFS= read -r _i00_parent_stat < "/proc/$PPID/stat" || exit 125
_i00_parent_tail=${_i00_parent_stat##*) }
_i00_parent_tail=${_i00_parent_tail#* }
_i00_runner_pid=${_i00_parent_tail%% *}
case "$_i00_runner_pid" in ""|*[!0-9]*) exit 125 ;; esac
[ -r "/proc/$_i00_runner_pid/cmdline" ] || exit 125
if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" = TEST ]; then
  [ "/proc/$_i00_runner_pid/exe" -ef "$I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH" ] || exit 125
else
  [ "/proc/$_i00_runner_pid/exe" -ef /usr/bin/node ] || exit 125
fi
_i00_deploy_argv=()
while IFS= read -r -d "" _i00_arg; do _i00_deploy_argv[${#_i00_deploy_argv[@]}]=$_i00_arg; done < "/proc/$PPID/cmdline"
[ "${_i00_deploy_argv[0]}" = "$I00_AUTHORIZED_EFFECT_PROGRAM_PATH" ] || exit 125
_i00_runner_argv=()
while IFS= read -r -d "" _i00_arg; do _i00_runner_argv[${#_i00_runner_argv[@]}]=$_i00_arg; done < "/proc/$_i00_runner_pid/cmdline"
[ "${#_i00_runner_argv[@]}" -ge 12 ] || exit 125
[ "${_i00_runner_argv[1]}" = "$I00_AUTHORIZED_EFFECT_RUNNER_PATH" ] || exit 125
[ "${_i00_runner_argv[2]}" = --authorization ] || exit 125
[ "${_i00_runner_argv[4]}" = --deployment-risk ] || exit 125
[ "${_i00_runner_argv[6]}" = --action-preview ] || exit 125
[ "${_i00_runner_argv[8]}" = --authorization-consumption ] || exit 125
[ "${_i00_runner_argv[10]}" = -- ] || exit 125
_I00_AUTO_PARENT_VERIFIED=1
readonly _I00_AUTO_PARENT_VERIFIED
unset _i00_parent_stat _i00_parent_tail _i00_runner_pid _i00_deploy_argv _i00_runner_argv _i00_arg
source /proc/self/fd/13
source /proc/self/fd/35'
  "$I00_ENV" -i \
    HOME=/ LANG=C LC_ALL=C PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    TMPDIR=/proc/self/fd/15 TZ=UTC DEPLOY_LOCK_HELD=1 \
    I00_AUTHORIZED_EFFECT_FD=3 I00_AUTHORIZED_EFFECT_ACK_FD=4 \
    I00_AUTHORIZATION_FD=5 I00_DEPLOYMENT_RISK_FD=6 \
    I00_ACTION_PREVIEW_FD=7 I00_AUTHORIZATION_CONSUMPTION_FD=8 \
    I00_AUTHORIZATION_CONSUMPTION_ROOT_FD=9 \
    I00_AUTHORIZED_EFFECT_START_FD=10 I00_AUTHORIZED_EFFECT_SCRIPT_FD=11 \
    I00_AUTHORIZED_EFFECT_ENVIRONMENT_FD=12 \
    I00_AUTHORIZED_EFFECT_BOOTSTRAP_FD=13 \
    I00_AUTHORIZED_EFFECT_PROGRAM_FD=14 \
    I00_AUTHORIZED_EFFECT_DIRECTORY_FD=15 \
    I00_AUTHORIZED_EFFECT_ROOT_MODE="$I00_AUTHORIZED_EFFECT_ROOT_MODE" \
    I00_AUTHORIZED_EFFECT_RUNNER_PATH="$I00_AUTHORIZED_EFFECT_RUNNER_PATH" \
    I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH="$I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH" \
    I00_AUTHORIZED_EFFECT_PROGRAM_PATH="$I00_AUTHORIZED_EFFECT_PROGRAM_PATH" \
    I00_AUTHORIZED_EFFECT_VERIFIER_FD=38 \
    I00_AUTHORIZED_ROLLBACK_SCRIPT_FD=35 \
    I00_AUTHORIZED_ROLLBACK_HANDOFF_FD=36 \
    I00_AUTHORIZED_ROLLBACK_ACK_FD=37 \
    I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH="$I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH" \
    I00_EFFECT_EXEC_NODE_FD=16 I00_EFFECT_EXEC_BASH_FD=17 \
    I00_EFFECT_EXEC_ENV_FD=18 I00_EFFECT_EXEC_SYSTEMCTL_FD=19 \
    I00_EFFECT_EXEC_CURL_FD=20 I00_EFFECT_EXEC_SQLITE_FD=21 \
    I00_AUTHORIZED_EFFECT_EXPOSURE_FD=33 \
    I00_AUTHORIZED_EFFECT_ALERT_FD=34 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_COSMOS_ROOT_FD=41 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_RELEASES_DIR_FD=42 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_CURRENT_LINK_PARENT_FD=43 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_PREVIOUS_LINK_PARENT_FD=44 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_OPS_STATE_DIR_FD=45 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_ROLLBACK_EVIDENCE_ROOT_FD=48 \
    I00_AUTHORIZED_EFFECT_WRITE_ROOT_DATA_DIR_FD=49 \
    I00_AUTHORIZED_EFFECT_READ_ROOT_RELEASE_SOURCE_FD=51 \
    I00_AUTHORIZED_EFFECT_READ_ROOT_AUTOMATIC_ROLLBACK_SOURCE_FD=52 \
    "$I00_BASH" -p -c "$bootstrap" \
    "$I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH" \
    --auto --i00-effect-environment-fd 12
}

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
  if [ "${I00_EFFECT_CLASS+x}" = x ]; then
    unset I00_EFFECT_CLASS
    die_code 1 "env file may not assign I00_EFFECT_CLASS"
  fi
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    [ -z "${EXPOSURE_CMD:-}" ] && [ -z "${ALERT_CMD:-}" ] \
      || die_code 1 "authorized env rejects named exposure or alert commands"
    unset EXPOSURE_CMD ALERT_CMD
    NODE="$_I00_EFFECT_NODE"
    I00_BASH="$_I00_EFFECT_BASH"
    I00_ENV="$_I00_EFFECT_ENV"
    [ "$_I00_EFFECT_SYSTEMCTL" = NONE ] || SYSTEMCTL="$_I00_EFFECT_SYSTEMCTL"
    [ "$_I00_EFFECT_CURL" = NONE ] || CURL="$_I00_EFFECT_CURL"
    [ "$_I00_EFFECT_SQLITE" = NONE ] || SQLITE="$_I00_EFFECT_SQLITE"
    [ "$_I00_EFFECT_TAR" = NONE ] || TAR="$_I00_EFFECT_TAR"
    [ "$_I00_EFFECT_GZIP" = NONE ] || GZIP="$_I00_EFFECT_GZIP"
    [ "$_I00_EFFECT_HASH" = NONE ] || HASH="$_I00_EFFECT_HASH"
    if i00_effect_class_is SERVICE_RELEASE_SWITCH \
        || i00_effect_class_is SERVICE_ROLLBACK; then
      [ "${GATE_TIMEOUT_SEC:-}" = 60 ] \
        && [ "${HTTP_TIMEOUT_SEC:-}" = 5 ] \
        && [ "${LOCK_TIMEOUT_SEC:-}" = 30 ] \
        && [ "${I00_OPS_READBACK_TIMEOUT_MS:-}" = 750 ] \
        || die_code 1 "authorized deploy timeout policy differs from the verified contract"
    fi
  fi
  if [ "${I00_BASH+x}" = x ]; then
    _I00_BASH_FROM_ENV_FILE=1
  fi
  if [ "${I00_ENV+x}" = x ]; then
    _I00_ENV_FROM_ENV_FILE=1
  fi
}

require_cmd() {
  local c
  for c in "$@"; do
    if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
      _i00_authorized_token_is_approved "$c" \
        || die_code 1 "required command differs from verified descriptor"
    else
      command -v "$c" >/dev/null 2>&1 || die_code 1 "required command missing: $c"
    fi
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
  local mode="$1" supplied_lock="$2" canonical_lock
  shift 2
  canonical_lock="$(canonical_path "$supplied_lock")" || return 1
  i00_guard_node - "$mode" "$canonical_lock" "$@" <<'NODE'
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
  local dir grace="${LOCK_OWNER_GRACE_SEC:-5}" out rest
  dir="$(canonical_path "$1")" || {
    LOCK_STATE=UNKNOWN
    LOCK_REASON=LOCK_PATH_CANONICALIZATION_FAILED
    LOCK_OWNER_PID=""
    return 0
  }
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
  local dir grace="${LOCK_OWNER_GRACE_SEC:-5}" out rest
  dir="$(canonical_path "$1")" || {
    LOCK_STATE=UNKNOWN
    LOCK_REASON=LOCK_PATH_CANONICALIZATION_FAILED
    LOCK_OWNER_PID=""
    return 0
  }
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
  local dir grace="${LOCK_OWNER_GRACE_SEC:-5}"
  dir="$(canonical_path "$1")" || return 1
  case "$grace" in
    0|[1-9]|[1-2][0-9]|30) ;;
    *) return 1 ;;
  esac
  _lock_owner_tool recover "$dir" "$((10#$grace * 1000))"
}

acquire_lock() {
  local dir deadline created_token reclaim_state
  dir="$(canonical_path "$1")" || return 1
  deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  fs_mkdir_p "$(path_dirname "$dir")"
  while :; do
    if recover_lock_family "$dir" >/dev/null 2>&1; then
      if fs_mkdir_exclusive "$dir" 2>/dev/null; then
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
    guard_sleep 1
  done
}
release_lock() {
  local dir deadline
  dir="$(canonical_path "$1")" || return 1
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
    guard_sleep 1
  done
}

# --- hashing / JSON ----------------------------------------------------------
sha256_file() {
  local executable output digest
  if i00_effect_class_is BACKUP_CREATE \
      || i00_effect_class_is ISOLATED_RESTORE; then
    executable="${HASH:-}"
    [ "$executable" = /proc/self/fd/23 ] \
      && [ "$_I00_HASH_PROGRAM" = /proc/self/fd/23 ] \
      || die_code 1 "authorized HASH differs from descriptor 23"
    case "$_I00_HASH_ARGV_SHAPE" in
      FILE) output="$("$executable" "$1")" ;;
      A_256_FILE) output="$("$executable" -a 256 "$1")" ;;
      *) die_code 1 "authorized HASH argv policy is invalid" ;;
    esac
  elif command -v sha256sum >/dev/null 2>&1; then
    executable="$(command -v sha256sum)"
    output="$("$executable" "$1")"
  else
    executable="$(command -v shasum)" \
      || die_code 1 "no SHA-256 executable is available"
    output="$("$executable" -a 256 "$1")"
  fi
  digest="${output%%[	 ]*}"
  case "$digest" in
    ????????????????????????????????????????????????????????????????)
      case "$digest" in *[!0-9a-f]*) die_code 1 "SHA-256 output is malformed" ;; esac
      ;;
    *) die_code 1 "SHA-256 output is malformed" ;;
  esac
  printf '%s\n' "$digest"
}

# json_get FILE DOTTED.KEY — prints the scalar value; exits 3 when the key is
# missing, 4 when the file is unreadable or not valid JSON (Part 4 #6: the two
# conditions must be distinguishable at the call site - "key absent" may have
# a safe default, "journal unreadable" never does).
json_get() {
  i00_guard_node -e '
    const fs = require("fs");
    const [file, key] = process.argv.slice(1);
    let v;
    try {
      v = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      process.exit(4);
    }
    for (const part of key.split(".")) { v = v == null ? undefined : v[part]; }
    if (v === undefined || v === null) process.exit(3);
    process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
  ' "$1" "$2"
}

# json_get_nonnegative_safe_integer FILE DOTTED.KEY — prints one canonical
# base-10 JSON integer that Node and the shell can compare without precision
# loss. Exit 3 means the key is absent from a plain-object document; 4 means
# unreadable/invalid JSON; 5 means the document shape or value is null,
# wrong-typed, negative, fractional, non-canonical, or outside the exact integer
# range. Callers must never treat 4 or 5 as an absent optional field.
json_get_nonnegative_safe_integer() {
  i00_guard_node -e '
    const fs = require("fs");
    const [file, key] = process.argv.slice(1);
    const sourceByHolder = new WeakMap();
    let root;
    try {
      root = JSON.parse(fs.readFileSync(file, "utf8"), function (property, value, context) {
        if (context && typeof context.source === "string") {
          let properties = sourceByHolder.get(this);
          if (!properties) {
            properties = new Map();
            sourceByHolder.set(this, properties);
          }
          properties.set(property, context.source);
        }
        return value;
      });
    } catch {
      process.exit(4);
    }
    if (root === null || typeof root !== "object" || Array.isArray(root)) process.exit(5);
    const parts = key.split(".");
    if (parts.length === 0 || parts.some((part) => part.length === 0)) process.exit(5);
    let holder = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (holder === null || typeof holder !== "object" || Array.isArray(holder)) process.exit(5);
      if (!Object.prototype.hasOwnProperty.call(holder, part)) process.exit(3);
      holder = holder[part];
    }
    if (holder === null || typeof holder !== "object" || Array.isArray(holder)) process.exit(5);
    const property = parts[parts.length - 1];
    if (!Object.prototype.hasOwnProperty.call(holder, property)) process.exit(3);
    const value = holder[property];
    const source = sourceByHolder.get(holder)?.get(property);
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value < 0
        || typeof source !== "string"
        || !/^(?:0|[1-9][0-9]*)$/.test(source)) process.exit(5);
    const exact = BigInt(source);
    if (exact > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(value) !== exact) process.exit(5);
    process.stdout.write(source);
  ' "$1" "$2"
}

# json_write FILE KEY=VALUE...  VALUE is parsed as JSON when possible
# (numbers, booleans), otherwise stored as a string.
json_write() {
  local file="$1"; shift
  fs_mkdir_p "$(path_dirname "$file")"
  i00_guard_node -e '
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
  fs_mkdir_p "$(path_dirname "$file")"
  i00_guard_node -e '
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

# Resolve through the deepest existing ancestor, then append only genuinely
# missing trailing components. This preserves kernel traversal through an
# existing symlink instead of lexically collapsing it before the guard.
canonical_path() {
  i00_guard_node -e '
    const fs = require("fs"), path = require("path");
    const input = process.argv[1];
    if (typeof input !== "string" || input.length === 0 || /[\0-\x1f\x7f]/.test(input)) {
      throw new Error("path is empty or contains control bytes");
    }
    let cursor = path.isAbsolute(input) ? input : `${process.cwd()}${path.sep}${input}`;
    const suffix = [];
    for (;;) {
      try {
        fs.lstatSync(cursor);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
        const parent = path.dirname(cursor);
        if (parent === cursor) throw error;
        const component = path.basename(cursor);
        if (!component || component === "." || component === "..") throw new Error("unsafe missing suffix");
        suffix.unshift(component);
        cursor = parent;
      }
    }
    const ancestor = fs.realpathSync.native(cursor);
    if (suffix.length > 0 && !fs.statSync(ancestor).isDirectory()) {
      throw new Error("deepest existing ancestor is not a directory");
    }
    process.stdout.write(path.join(ancestor, ...suffix));
  ' "$1"
}

exact_raw_canonical_path() {
  local raw="${1:-}" canonical
  case "$raw" in
    /*) ;;
    *) return 1 ;;
  esac
  case "$raw" in
    /proc/*|/dev/fd/*) return 1 ;;
  esac
  case "$raw" in
    *[[:cntrl:]]*) return 1 ;;
  esac
  canonical="$(canonical_path "$raw")" || return 1
  [ "$canonical" = "$raw" ] || return 1
  printf '%s\n' "$canonical"
}

exact_existing_directory_path() {
  local exact
  exact="$(exact_raw_canonical_path "$1")" || return 1
  i00_guard_node - "$exact" <<'NODE' || return 1
const fs = require('node:fs');
const target = process.argv[2];
const stat = fs.lstatSync(target, { throwIfNoEntry: false });
if (!stat?.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(target) !== target) process.exit(1);
process.stdout.write(target);
NODE
}

exact_existing_nonsymlink_path() {
  local exact
  exact="$(exact_raw_canonical_path "$1")" || return 1
  i00_guard_node - "$exact" <<'NODE' || return 1
const fs = require('node:fs');
const target = process.argv[2];
const stat = fs.lstatSync(target, { throwIfNoEntry: false });
if (stat === undefined || stat.isSymbolicLink()
    || (!stat.isDirectory() && !stat.isFile())
    || fs.realpathSync.native(target) !== target) process.exit(1);
process.stdout.write(target);
NODE
}

exact_raw_canonical_pointer_path() {
  local raw="${1:-}" canonical
  case "$raw" in
    /*) ;;
    *) return 1 ;;
  esac
  case "$raw" in
    *[[:cntrl:]]*) return 1 ;;
  esac
  canonical="$(canonical_pointer_leaf "$raw")" || return 1
  [ "$canonical" = "$raw" ] || return 1
  printf '%s\n' "$canonical"
}

# Protected roots are fixed policy constants, not caller-selected effect
# targets. A non-root validation host may be unable to traverse a root-owned
# protected directory even when the candidate is an unrelated isolated path.
# For this operand only, retain ENOENT/ENOTDIR/EACCES/EPERM components as a
# lexical suffix under the deepest inspectable canonical directory. Candidate
# paths continue to use canonical_path above and must fully resolve through
# every existing ancestor, so an inaccessible production target still refuses.
canonical_protected_root() {
  i00_guard_node -e '
    const fs = require("fs"), path = require("path");
    let cursor = path.resolve(process.argv[1]);
    const suffix = [];
    const mayProject = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
    for (;;) {
      try {
        fs.lstatSync(cursor);
        const ancestor = fs.realpathSync(cursor);
        if (suffix.length > 0 && !fs.statSync(ancestor).isDirectory()) {
          throw new Error("deepest inspectable ancestor is not a directory");
        }
        process.stdout.write(path.join(ancestor, ...suffix));
        break;
      } catch (error) {
        if (!mayProject.has(error?.code)) throw error;
        const parent = path.dirname(cursor);
        if (parent === cursor) throw error;
        const component = path.basename(cursor);
        if (!component || component === "." || component === "..") {
          throw new Error("unsafe protected-root suffix");
        }
        suffix.unshift(component);
        cursor = parent;
      }
    }
  ' "$1"
}

# --- atomic symlink swap -----------------------------------------------------
# rename(2) replaces the destination link atomically and does not dereference
# it. BSD `mv` has no -T and would move INTO a dir symlink, so node does the
# rename portably (node is a hard dependency of the app anyway).
atomic_symlink() {
  i00_guard_node - "$1" "$2" "$$" <<'NODE'
const fs = require('fs');
const [target, link, pid] = process.argv.slice(2);
const temp = `${link}.tmp.${pid}`;
try { fs.rmSync(temp, { force: true }); } catch {}
try {
  fs.symlinkSync(target, temp);
  fs.renameSync(temp, link);
} catch (error) {
  try { fs.rmSync(temp, { force: true }); } catch {}
  throw error;
}
NODE
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
      guard_sleep 0.5
    done
    ops_log "gate: ${base}${p} healthy"
  done
}

# --- exposure state (§24.2 auto-rollback authority) --------------------------
# Authorized release/rollback uses only the verifier-approved Node and helper
# descriptors, no helper arguments, and the exact 3000 ms outer timeout.
# Contained direct fixtures retain the historical named-command seam.
get_exposure() {
  local out
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    if ! { i00_effect_class_is SERVICE_RELEASE_SWITCH \
        || i00_effect_class_is SERVICE_ROLLBACK; }; then
      echo UNKNOWN
      return 0
    fi
    if out="$(i00_guard_node - \
      "$_I00_EXPOSURE_PROGRAM" "$_I00_EXPOSURE_SCRIPT" \
      "$I00_OPS_READBACK_URL" "$I00_OPS_READBACK_TIMEOUT_MS" <<'NODE'
const { spawnSync } = require('node:child_process');
const [program, script, readbackUrl, readbackTimeout] = process.argv.slice(2);
if (program !== '/proc/self/fd/16' || script !== '/proc/self/fd/33'
    || readbackTimeout !== '750') process.exit(1);
const stdio = ['ignore', 'pipe', 'inherit'];
for (let descriptor = 3; descriptor <= 33; descriptor += 1) stdio[descriptor] = 'ignore';
stdio[16] = 16;
stdio[33] = 33;
const result = spawnSync(program, [script], {
  encoding: 'utf8',
  env: {
    HOME: '/',
    I00_OPS_READBACK_TIMEOUT_MS: readbackTimeout,
    I00_OPS_READBACK_URL: readbackUrl,
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TZ: 'UTC',
  },
  killSignal: 'SIGKILL',
  maxBuffer: 256,
  stdio,
  timeout: 3000,
});
if (result.error || result.signal || result.status !== 0
    || !/^(?:NONE|ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN)\n$/u
      .test(result.stdout ?? '')) process.exit(1);
process.stdout.write(result.stdout);
NODE
    )"; then
      echo UNKNOWN
      return 0
    fi
    case "$out" in
      NONE|ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN) echo "$out" ;;
      *) echo UNKNOWN ;;
    esac
    return 0
  fi
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
# Authorized release/rollback uses only verified Bash + local alert-log
# descriptors with the exact severity/code/message argv shape and 5000 ms
# timeout. Direct contained fixtures may still inject a named local mock.
alert() {
  local cmd="${ALERT_CMD:-}" timeout_sec="${ALERT_TIMEOUT_SEC:-5}"
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    i00_guard_node - \
      "$_I00_ALERT_PROGRAM" "$_I00_ALERT_SCRIPT" "$1" "$2" "$3" <<'NODE' \
      || ops_log "local descriptor alert failed or timed out for $2"
const { spawnSync } = require('node:child_process');
const [program, script, severity, code, message] = process.argv.slice(2);
if (program !== '/proc/self/fd/17' || script !== '/proc/self/fd/34'
    || !/^(?:info|warning|critical)$/u.test(severity)
    || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    || typeof message !== 'string' || message.length > 2048
    || /[\u0000-\u001f\u007f]/u.test(message)) process.exit(1);
const stdio = ['ignore', 'inherit', 'inherit'];
for (let descriptor = 3; descriptor <= 34; descriptor += 1) stdio[descriptor] = 'ignore';
stdio[17] = 17;
stdio[34] = 34;
const result = spawnSync(program, ['-p', script, severity, code, message], {
  env: {
    HOME: '/',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TZ: 'UTC',
  },
  killSignal: 'SIGKILL',
  stdio,
  timeout: 5000,
});
if (result.error || result.signal || result.status !== 0) process.exit(1);
NODE
    return 0
  fi
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
