#!/bin/bash -p
# I00 verification adapter for the accepted L15 isolated restore owner.
# It never targets DATA_DIR and never performs a production database swap.
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS NODE_PATH \
  NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA \
  NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE \
  NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN \
  NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
  OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR \
  HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY \
  http_proxy https_proxy no_proxy all_proxy
INHERITED_NODE_DISCOVERED="$(command -v node 2>/dev/null || :)"
SAFE_PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
PATH="$SAFE_PATH"
export PATH
case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf 'I00_OPS_BLOCKED: restore verifier requires an explicit script path\n' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: restore verifier script directory is unavailable\n' >&2; exit 1; }
unset _I00_ENTRY_DIR
I00_ROOT="$(cd -P -- "$SCRIPT_DIR/.." && builtin pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"
EFFECT_IDENTITY_INSPECTOR="$SCRIPT_DIR/inspect-effect-identity.mjs"
BOUND_EFFECT_RUNNER="$SCRIPT_DIR/run-bound-effect.mjs"
RESTORE_COMPLETION_RESERVE_SECONDS=1800
RESTORE_RECEIPT_PUBLICATION_RESERVE_SECONDS=300
blocked() {
  printf 'I00_OPS_BLOCKED: %s\n' "$*" >&2
  exit 1
}
select_privileged_node() {
  local candidate path metadata owner mode trusted
  [ "$EUID" -eq 0 ] || blocked "production Node bootstrap requires root"
  [ -f /usr/bin/stat ] && [ ! -L /usr/bin/stat ] && [ -x /usr/bin/stat ] \
    && [ -O /usr/bin/stat ] \
    || blocked "fixed root-owned stat bootstrap is unavailable"
  [ -f "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ ! -L "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ -x "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ -O "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    || blocked "fixed I00 tree verifier is unavailable"
  for candidate in /usr/bin/node; do
    [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ] || continue
    trusted=1
    for path in / /usr /usr/bin "$candidate"; do
      metadata="$(/usr/bin/stat -c '%u:%a' -- "$path" 2>/dev/null)" \
        || { trusted=0; break; }
      owner="${metadata%%:*}"
      mode="${metadata#*:}"
      case "$owner:$mode" in
        0:[0-7][0-7][0-7]|0:[0-7][0-7][0-7][0-7]) ;;
        *) trusted=0; break ;;
      esac
      [ $((8#$mode & 8#22)) -eq 0 ] || { trusted=0; break; }
    done
    [ "$trusted" = 1 ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  blocked "fixed root-owned Node runtime is unavailable"
}
canonical_effect_command() {
  local command_name="$1" discovered
  discovered="$(PATH="$SAFE_PATH" command -v "$command_name")" \
    || blocked "required effect executable is unavailable: $command_name"
  "$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$discovered"
}
BACKUP="" TARGET="" ENV_FILE="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT="" TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT="" SIMULATION=0
OPERATOR="" DEPLOYED_SHA="" CONFIG_VERSION="" DEPLOYMENT_RISK="" ACTION_PREVIEW="" AUTHORIZATION_CONSUMPTION_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP="${2:?--backup needs a value}"; shift 2 ;;
    --target) TARGET="${2:?--target needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --operator) OPERATOR="${2:?--operator needs a value}"; shift 2 ;;
    --deployed-sha) DEPLOYED_SHA="${2:?--deployed-sha needs a value}"; shift 2 ;;
    --config-version) CONFIG_VERSION="${2:?--config-version needs a value}"; shift 2 ;;
    --deployment-risk) DEPLOYMENT_RISK="${2:?--deployment-risk needs a value}"; shift 2 ;;
    --action-preview) ACTION_PREVIEW="${2:?--action-preview needs a value}"; shift 2 ;;
    --authorization-consumption-root) AUTHORIZATION_CONSUMPTION_ROOT="${2:?--authorization-consumption-root needs a value}"; shift 2 ;;
    --host) TARGET_HOST="${2:?--host needs a value}"; shift 2 ;;
    --environment) TARGET_ENVIRONMENT="${2:?--environment needs a value}"; shift 2 ;;
    --account) TARGET_ACCOUNT="${2:?--account needs a value}"; shift 2 ;;
    --result-receipt) RESULT_RECEIPT="${2:?--result-receipt needs a value}"; shift 2 ;;
    --reconciliation-receipt) RECONCILIATION_RECEIPT="${2:?--reconciliation-receipt needs a value}"; shift 2 ;;
    --simulation-root) SIMULATION_ROOT="${2:?--simulation-root needs a value}"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    *) printf 'I00_OPS_BLOCKED: unknown argument %s\n' "$1" >&2; exit 1 ;;
  esac
done
[ -n "$BACKUP" ] && [ -n "$TARGET" ] && [ -n "$ENV_FILE" ] \
  || { printf 'I00_OPS_BLOCKED: --backup, --target, and --env-file are required\n' >&2; exit 1; }
if [ "$SIMULATION" = 1 ]; then
  [ -n "$INHERITED_NODE_DISCOVERED" ] \
    || blocked "simulation Node executable is unavailable"
  case "$INHERITED_NODE_DISCOVERED" in
    /*) : ;;
    *) blocked "simulation Node executable must resolve to an absolute path" ;;
  esac
  SIMULATION_NODE_PATH="$("$INHERITED_NODE_DISCOVERED" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$INHERITED_NODE_DISCOVERED")"
  "$SIMULATION_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SIMULATION_NODE_PATH" >/dev/null
  hash -p "$SIMULATION_NODE_PATH" node
  [ -n "$SIMULATION_ROOT" ] || { printf 'I00_OPS_BLOCKED: simulation restore requires a marked --simulation-root\n' >&2; exit 1; }
  node "$SCRIPT_DIR/validate-simulation-root.mjs" --root "$SIMULATION_ROOT" >/dev/null
fi
[ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$DEPLOYED_SHA" ] && [ -n "$CONFIG_VERSION" ] \
  && [ -n "$DEPLOYMENT_RISK" ] && [ -n "$ACTION_PREVIEW" ] && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] \
  && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] \
  && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore requires exact independent authorization expectations, target identity, and receipt targets\n' >&2; exit 1; }
[ -x "$DONOR_ROOT/bin/restore.sh" ] || { printf 'I00_OPS_BLOCKED: effective L15 restore.sh is unavailable\n' >&2; exit 1; }
if [ "$SIMULATION" != 1 ]; then
  NODE_DISCOVERED="$(select_privileged_node)"
  NODE_PATH="$NODE_DISCOVERED"
  NODE_INITIAL="$("$SCRIPT_DIR/run-fixed-node-gate.sh" inspect-executable.mjs --path "$NODE_PATH")"
  BASH_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/bin/bash"))')"
  BASH_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")"
  ENV_PATH="$(canonical_effect_command env)"
  ENV_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")"
  ID_PATH="$(canonical_effect_command id)"
  ID_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ID_PATH")"
  GETENT_PATH="$(canonical_effect_command getent)"
  GETENT_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GETENT_PATH")"
  SETPRIV_PATH="$(canonical_effect_command setpriv)"
  SETPRIV_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SETPRIV_PATH")"
  RUNNING_BASH_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$BASH")"
  [ "$RUNNING_BASH_PATH" = "$BASH_PATH" ] \
    || blocked "running Bash does not match the fixed interpreter"
  hash -p "$NODE_PATH" node
else
  SIMULATION_COMMAND_ROOT="$SIMULATION_ROOT/bin"
  for command_name in node bash env tar gzip sha256sum id getent setpriv sqlite3; do
    command_path="$SIMULATION_COMMAND_ROOT/$command_name"
    [ -f "$command_path" ] && [ ! -L "$command_path" ] && [ -x "$command_path" ] \
      || blocked "simulation command set is incomplete"
    node "$SCRIPT_DIR/validate-simulation-path.mjs" \
      --root "$SIMULATION_ROOT" --path "$command_path" >/dev/null
  done
  NODE_PATH="$SIMULATION_COMMAND_ROOT/node"
  BASH_PATH="$SIMULATION_COMMAND_ROOT/bash"
  ENV_PATH="$SIMULATION_COMMAND_ROOT/env"
  TAR_PATH="$SIMULATION_COMMAND_ROOT/tar"
  GZIP_PATH="$SIMULATION_COMMAND_ROOT/gzip"
  HASH_COMMAND=sha256sum
  HASH_PATH="$SIMULATION_COMMAND_ROOT/sha256sum"
  ID_PATH="$SIMULATION_COMMAND_ROOT/id"
  GETENT_PATH="$SIMULATION_COMMAND_ROOT/getent"
  SETPRIV_PATH="$SIMULATION_COMMAND_ROOT/setpriv"
  SQLITE_PATH="$SIMULATION_COMMAND_ROOT/sqlite3"
  NODE_INITIAL="$("$SIMULATION_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$NODE_PATH")"
  BASH_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")"
  ENV_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")"
  TAR_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$TAR_PATH")"
  GZIP_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GZIP_PATH")"
  HASH_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$HASH_PATH")"
  ID_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ID_PATH")"
  GETENT_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GETENT_PATH")"
  SETPRIV_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SETPRIV_PATH")"
  SQLITE_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SQLITE_PATH")"
  hash -p "$NODE_PATH" node
fi
if [ "$SIMULATION" = 1 ]; then
  GUARD_NODE_PATH="$NODE_PATH"
else
  GUARD_NODE_PATH="$NODE_PATH"
fi
readonly GUARD_NODE_PATH
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
DONOR_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DONOR_ROOT")"
[ -x "$DONOR_ROOT/bin/restore.sh" ] || blocked "canonical effective L15 restore.sh is unavailable"
EFFECTIVE_DONOR_VERIFICATION_INITIAL="$(node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
  --root "$DONOR_ROOT" --require-immutable)"
donor_root_identity() {
  "$NODE_PATH" -e '
    const fs=require("fs");
    const s=fs.lstatSync(process.argv[1],{bigint:true});
    const identity={device:s.dev.toString(),inode:s.ino.toString(),mode:s.mode.toString(8),size:s.size.toString(),mtimeNs:s.mtimeNs.toString(),ctimeNs:s.ctimeNs.toString()};
    process.stdout.write(Object.entries(identity).map(([key,value])=>`${key}=${value}`).join(","));
  ' "$DONOR_ROOT"
}
EFFECTIVE_DONOR_ROOT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).root)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
EFFECTIVE_DONOR_IDENTITY_ENDPOINT="$(donor_root_identity)"
EFFECTIVE_DONOR_TREE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).effectiveRootDigestSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
DONOR_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).immutableDonorContractSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
L15_AMENDMENT_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).amendmentContractSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
EFFECT_UNIT_PATH="$DONOR_ROOT/systemd/cosmos-restore-drill.service"
EFFECT_IDENTITY_INITIAL="$("$NODE_PATH" "$EFFECT_IDENTITY_INSPECTOR" \
  --unit "$EFFECT_UNIT_PATH" --id "$ID_PATH" --getent "$GETENT_PATH" \
  --expected-user cosmos --expected-group cosmos)"
EFFECT_UNIT_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).unitSha256)' "$EFFECT_IDENTITY_INITIAL")"
EFFECT_UNIT_IDENTITY="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).unitIdentity)' "$EFFECT_IDENTITY_INITIAL")"
EFFECT_UID="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).uid)' "$EFFECT_IDENTITY_INITIAL")"
EFFECT_GID="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).gid)' "$EFFECT_IDENTITY_INITIAL")"
EFFECT_COMMON_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$DONOR_ROOT/bin/common.sh")"
EFFECT_SCRIPT_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$DONOR_ROOT/bin/restore.sh")"

if [ "$SIMULATION" = 1 ]; then
  SANITIZED_DIR="$SIMULATION_ROOT/sanitized"
  "$GUARD_NODE_PATH" - "$SIMULATION_ROOT" "$SANITIZED_DIR" <<'NODE' \
    || blocked "simulation sanitized environment parent is invalid"
const fs = require('fs');
const path = require('path');
const [root, sanitized] = process.argv.slice(2);
for (const name of ['home', 'tmp']) {
  const target = path.join(root, name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.chmodSync(target, 0o700);
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync.native(target) !== target || path.dirname(target) !== root) {
    process.exit(1);
  }
}
const sanitizedStat = fs.lstatSync(sanitized);
if (!sanitizedStat.isDirectory() || sanitizedStat.isSymbolicLink()
    || fs.realpathSync.native(sanitized) !== sanitized
    || path.dirname(sanitized) !== root || path.basename(sanitized) !== 'sanitized'
    || sanitizedStat.uid !== process.getuid() || (sanitizedStat.mode & 0o777) !== 0o700
    || fs.readdirSync(sanitized).length !== 0) process.exit(1);
NODE
else
  SANITIZED_DIR="$("$NODE_PATH" "$SCRIPT_DIR/create-private-temp.mjs" --prefix i00-restore-verify.)"
fi
readonly SANITIZED_DIR
DELEGATE_ENV="$SANITIZED_DIR/backup.env"
if [ "$SIMULATION" = 1 ]; then
  "$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile backup \
    --provenance-mode TEST --provenance-root "$SIMULATION_ROOT" \
    --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
    --sqlite "$SQLITE_PATH" --tar "$TAR_PATH" --hash "$HASH_PATH" \
    --require-effect-bindings --require-hash >/dev/null
else
  UNBOUND_ENV="$SANITIZED_DIR/unbound.env"
  node "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    --env "$ENV_FILE" --output "$UNBOUND_ENV" --profile backup \
    --provenance-mode SYSTEM >/dev/null
  # This first closed-profile parse is read-only and exists only to recover the
  # operator-pinned SQLite path before producing the final exact donor env.
  # shellcheck disable=SC1090
  . "$UNBOUND_ENV"
  [ -n "${SQLITE:-}" ] || blocked "sanitized donor env must pin SQLITE to one exact executable"
  SQLITE_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$SQLITE")"
  SQLITE_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SQLITE_PATH")"
  TAR_PATH="$(canonical_effect_command tar)"
  TAR_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$TAR_PATH")"
  GZIP_PATH="$(canonical_effect_command gzip)"
  GZIP_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GZIP_PATH")"
  if PATH="$SAFE_PATH" command -v sha256sum >/dev/null 2>&1; then
    HASH_COMMAND=sha256sum
  else
    PATH="$SAFE_PATH" command -v shasum >/dev/null 2>&1 \
      || blocked "required SHA-256 executable is unavailable"
    HASH_COMMAND=shasum
  fi
  HASH_PATH="$(canonical_effect_command "$HASH_COMMAND")"
  HASH_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$HASH_PATH")"
  "$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile backup --provenance-mode SYSTEM \
    --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
    --sqlite "$SQLITE_PATH" --tar "$TAR_PATH" --hash "$HASH_PATH" \
    --require-effect-bindings --require-hash >/dev/null
  "$NODE_PATH" - "$UNBOUND_ENV" "$SANITIZED_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const [file, parent] = process.argv.slice(2);
const stat = fs.lstatSync(file);
const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== uid || (stat.mode & 0o777) !== 0o600
    || fs.realpathSync.native(file) !== file || path.dirname(file) !== parent
    || path.basename(file) !== 'unbound.env') {
  process.exit(1);
}
fs.rmSync(file);
NODE
fi
NODE_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$NODE_INITIAL")"
NODE_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$NODE_INITIAL")"
BASH_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$BASH_INITIAL")"
BASH_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$BASH_INITIAL")"
ENV_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$ENV_INITIAL")"
ENV_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$ENV_INITIAL")"
TAR_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$TAR_INITIAL")"
TAR_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$TAR_INITIAL")"
GZIP_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$GZIP_INITIAL")"
GZIP_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$GZIP_INITIAL")"
HASH_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$HASH_INITIAL")"
HASH_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$HASH_INITIAL")"
ID_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$ID_INITIAL")"
ID_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$ID_INITIAL")"
GETENT_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$GETENT_INITIAL")"
GETENT_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$GETENT_INITIAL")"
SETPRIV_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SETPRIV_INITIAL")"
SETPRIV_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SETPRIV_INITIAL")"
EFFECT_COMMON_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$EFFECT_COMMON_INITIAL")"
EFFECT_COMMON_IDENTITY="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$EFFECT_COMMON_INITIAL")"
EFFECT_SCRIPT_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$EFFECT_SCRIPT_INITIAL")"
EFFECT_SCRIPT_IDENTITY="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$EFFECT_SCRIPT_INITIAL")"
ENV_SOURCE_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$ENV_FILE")"
# The sanitizer emits only single-quoted, closed-profile scalar assignments.
# shellcheck disable=SC1090
. "$DELEGATE_ENV"
[ -n "${SQLITE:-}" ] \
  || { printf 'I00_OPS_BLOCKED: sanitized donor env must pin SQLITE to one exact executable\n' >&2; exit 1; }
[ -z "${EVIDENCE_PATHS:-}" ] \
  || blocked "authorized restore rejects nonempty EVIDENCE_PATHS"
[ "$SQLITE" = "$SQLITE_PATH" ] \
  || blocked "sanitized SQLite binding differs from the fixed executable"
: "${NODE:=node}"
canonical_future_path() {
  "$GUARD_NODE_PATH" - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
try {
  if (typeof input !== 'string' || input.length === 0
      || !path.isAbsolute(input) || /[\0-\x1f\x7f]/u.test(input)) {
    throw new Error('unsafe absolute path');
  }
  let cursor = input;
  const suffix = [];
  for (;;) {
    try {
      fs.lstatSync(cursor);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      const component = path.basename(cursor);
      if (!component || component === '.' || component === '..') {
        throw new Error('unsafe missing suffix');
      }
      suffix.unshift(component);
      cursor = parent;
    }
  }
  const ancestor = fs.realpathSync.native(cursor);
  if (suffix.length > 0 && !fs.statSync(ancestor).isDirectory()) {
    throw new Error('deepest existing ancestor is not a directory');
  }
  process.stdout.write(path.join(ancestor, ...suffix));
} catch (error) {
  process.stderr.write(`cannot safely canonicalize restore path: ${error?.code ?? error?.message ?? 'UNKNOWN'}\n`);
  process.exit(1);
}
NODE
}
canonical_protected_root() {
  "$GUARD_NODE_PATH" - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
try {
  if (typeof input !== 'string' || input.length === 0
      || !path.isAbsolute(input) || /[\0-\x1f\x7f]/u.test(input)) {
    throw new Error('unsafe protected root');
  }
  let cursor = input;
  const suffix = [];
  const projectable = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);
  for (;;) {
    try {
      fs.lstatSync(cursor);
      const ancestor = fs.realpathSync.native(cursor);
      if (suffix.length > 0 && !fs.statSync(ancestor).isDirectory()) {
        throw new Error('deepest existing ancestor is not a directory');
      }
      process.stdout.write(path.join(ancestor, ...suffix));
      break;
    } catch (error) {
      if (!projectable.has(error?.code)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      const component = path.basename(cursor);
      if (!component || component === '.' || component === '..') {
        throw new Error('unsafe protected-root suffix');
      }
      suffix.unshift(component);
      cursor = parent;
    }
  }
} catch (error) {
  process.stderr.write(`cannot safely canonicalize protected root: ${error?.code ?? error?.message ?? 'UNKNOWN'}\n`);
  process.exit(1);
}
NODE
}
path_intersects_fixed_production_union() {
  local candidate="$1" protected_root root_canon
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
    root_canon="$(canonical_protected_root "$protected_root")" \
      || blocked "cannot canonicalize a fixed production root"
    case "$candidate" in
      "$root_canon"|"$root_canon"/*) return 0 ;;
    esac
    case "$root_canon" in
      "$candidate"|"$candidate"/*) return 0 ;;
    esac
  done
  return 1
}
BACKUP_CANON="$(cd "$BACKUP" && pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: backup source must exist and be canonicalizable\n' >&2; exit 1; }
DATA_CANON="$(canonical_future_path "$DATA_DIR")"
BACKUP_DIR_CANON="$(cd "$BACKUP_DIR" && pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: backup directory must exist and be canonicalizable\n' >&2; exit 1; }
if ! TARGET_CANON="$(canonical_future_path "$TARGET")"; then
  TARGET_PROJECTED="$(canonical_protected_root "$TARGET")" \
    || blocked "restore verification target cannot be canonicalized safely"
  if path_intersects_fixed_production_union "$TARGET_PROJECTED"; then
    printf 'I00_OPS_BLOCKED: restore verification target intersects a fixed production root\n' >&2
    exit 2
  fi
  blocked "restore verification target cannot be canonicalized safely"
fi
if path_intersects_fixed_production_union "$TARGET_CANON"; then
  printf 'I00_OPS_BLOCKED: restore verification target intersects a fixed production root\n' >&2
  exit 2
fi
case "$TARGET_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    printf 'I00_OPS_BLOCKED: restore verification target must be isolated from DATA_DIR\n' >&2
    exit 2
    ;;
esac
TARGET_PARENT="$("$GUARD_NODE_PATH" -e '
  const fs=require("fs"),path=require("path");
  const target=process.argv[1],parent=path.dirname(target);
  const stat=fs.lstatSync(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()
      ||fs.realpathSync.native(parent)!==parent||path.dirname(target)!==parent)process.exit(1);
  process.stdout.write(parent);
' "$TARGET_CANON")" \
  || blocked "isolated restore target parent must be one existing physical directory"
"$GUARD_NODE_PATH" - "$TARGET_CANON" <<'NODE' \
  || { printf 'I00_OPS_BLOCKED: isolated restore target must be absent or empty\n' >&2; exit 1; }
const fs = require('fs');
const target = process.argv[2];
let stat;
try {
  stat = fs.lstatSync(target);
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0);
  throw error;
}
if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(target) !== target
    || fs.readdirSync(target).length !== 0) {
  process.exit(1);
}
NODE
directory_identity() {
  "$NODE_PATH" -e '
    const fs=require("fs");
    const s=fs.lstatSync(process.argv[1],{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync.native(process.argv[1])!==process.argv[1])process.exit(1);
    process.stdout.write(`device=${s.dev},inode=${s.ino},mode=${s.mode.toString(8)},uid=${s.uid},gid=${s.gid}`);
  ' "$1"
}
DATA_DIR_IDENTITY="$(directory_identity "$DATA_CANON")"
BACKUP_DIR_IDENTITY="$(directory_identity "$BACKUP_DIR_CANON")"
TARGET_PARENT_IDENTITY="$(directory_identity "$TARGET_PARENT")"
BACKUP_INITIAL="$(node "$SCRIPT_DIR/inspect-backup-source.mjs" --path "$BACKUP_CANON")"
BACKUP_MANIFEST_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).manifestSha256)' "$BACKUP_INITIAL")"
BACKUP_DATABASE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).databaseSha256)' "$BACKUP_INITIAL")"
BACKUP_TREE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).treeSha256)' "$BACKUP_INITIAL")"
BACKUP_CREATED_AT_UTC="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).createdAtUtc)' "$BACKUP_INITIAL")"
BACKUP_EVENTS_COUNT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$BACKUP_INITIAL")"
BACKUP_DATA_SCHEMA="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).dataSchema))' "$BACKUP_INITIAL")"
BACKUP_ARCHIVE_COUNT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).archiveCount))' "$BACKUP_INITIAL")"
BACKUP_IDENTITY_ENDPOINT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$BACKUP_INITIAL")"
: "${BACKUP_MAX_AGE_HOURS:=26}"
require_backup_freshness() {
  "$GUARD_NODE_PATH" - "$BACKUP_INITIAL" "$BACKUP_MAX_AGE_HOURS" <<'NODE' \
    || blocked "backup source is stale or has a noncanonical freshness limit"
const inspected = JSON.parse(process.argv[2]);
const maximumHoursRaw = process.argv[3];
if (!/^[1-9][0-9]{0,3}$/u.test(maximumHoursRaw)) process.exit(1);
const maximumHours = Number(maximumHoursRaw);
const created = Date.parse(inspected.createdAtUtc);
const now = Date.now();
if (!Number.isSafeInteger(maximumHours) || maximumHours > 8_760
    || !Number.isFinite(created) || created > now
    || now - created > maximumHours * 60 * 60 * 1_000) {
  process.exit(1);
}
NODE
}
require_backup_freshness
require_backup_identity() {
  local current
  current="$(node "$SCRIPT_DIR/inspect-backup-source.mjs" --path "$BACKUP_CANON")"
  [ "$current" = "$BACKUP_INITIAL" ] \
    || { printf 'I00_OPS_BLOCKED: backup source identity changed around restore effect\n' >&2; exit 1; }
}
if [ "$SIMULATION" = 1 ]; then
  SQLITE_INITIAL="$(node "$SCRIPT_DIR/inspect-executable.mjs" --path "$SQLITE")"
  SQLITE_PATH="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$SQLITE_INITIAL")"
fi
SQLITE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SQLITE_INITIAL")"
SQLITE_IDENTITY_ENDPOINT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SQLITE_INITIAL")"
require_sqlite_identity() {
  local current
  current="$(node "$SCRIPT_DIR/inspect-executable.mjs" --path "$SQLITE_PATH")"
  [ "$current" = "$SQLITE_INITIAL" ] \
    || { printf 'I00_OPS_BLOCKED: SQLite executable identity changed around restore effect\n' >&2; exit 1; }
}
require_effect_executable_identities() {
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$NODE_PATH")" = "$NODE_INITIAL" ] \
    || blocked "Node executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")" = "$BASH_INITIAL" ] \
    || blocked "Bash executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")" = "$ENV_INITIAL" ] \
    || blocked "env executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$TAR_PATH")" = "$TAR_INITIAL" ] \
    || blocked "tar executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GZIP_PATH")" = "$GZIP_INITIAL" ] \
    || blocked "gzip executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$HASH_PATH")" = "$HASH_INITIAL" ] \
    || blocked "SHA-256 executable identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ID_PATH")" = "$ID_INITIAL" ] \
    || blocked "identity resolver executable changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$GETENT_PATH")" = "$GETENT_INITIAL" ] \
    || blocked "group resolver executable changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SETPRIV_PATH")" = "$SETPRIV_INITIAL" ] \
    || blocked "privilege-drop executable changed around restore effect"
  [ "$("$NODE_PATH" "$EFFECT_IDENTITY_INSPECTOR" \
      --unit "$EFFECT_UNIT_PATH" --id "$ID_PATH" --getent "$GETENT_PATH" \
      --expected-user cosmos --expected-group cosmos)" = "$EFFECT_IDENTITY_INITIAL" ] \
    || blocked "sealed restore effect identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$DONOR_ROOT/bin/common.sh")" = "$EFFECT_COMMON_INITIAL" ] \
    || blocked "delegated common library identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$DONOR_ROOT/bin/restore.sh")" = "$EFFECT_SCRIPT_INITIAL" ] \
    || blocked "delegated restore script identity changed around restore effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
      --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
      --root "$DONOR_ROOT" --require-immutable)" = "$EFFECTIVE_DONOR_VERIFICATION_INITIAL" ] \
    || blocked "effective donor tree changed around restore effect"
  [ "$(donor_root_identity)" = "$EFFECTIVE_DONOR_IDENTITY_ENDPOINT" ] \
    || blocked "effective donor root identity changed around restore effect"
}
delegate_env_sha256() {
  node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV"
}
DELEGATE_ENV_SHA="$(delegate_env_sha256)"
require_delegate_env_identity() {
  [ "$(delegate_env_sha256)" = "$DELEGATE_ENV_SHA" ] \
    || { printf 'I00_OPS_BLOCKED: sanitized donor env changed around restore effect\n' >&2; exit 1; }
}
if [ "$SIMULATION" = 1 ]; then
  for path in "$DATA_CANON" "$BACKUP_DIR_CANON" "$BACKUP_CANON" "$TARGET_CANON" "$TARGET_PARENT"; do
    "$NODE_PATH" "$SCRIPT_DIR/validate-simulation-path.mjs" \
      --root "$SIMULATION_ROOT" --path "$path" >/dev/null
  done
fi
risk_endpoint() {
  "$NODE_PATH" -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const marker=`${process.argv[2]}:`;
    const found=value.action.allowedEndpoints.filter((entry)=>entry.startsWith(marker));
    if(found.length!==1)process.exit(1);
    process.stdout.write(found[0].slice(marker.length));
  ' "$DEPLOYMENT_RISK" "$1"
}
EFFECT_START_EXPECTED="$(risk_endpoint effect-start-evidence)" \
  || blocked "deployment risk lacks one effect start evidence path"
EFFECT_FINISH_EXPECTED="$(risk_endpoint effect-finish-evidence)" \
  || blocked "deployment risk lacks one effect finish evidence path"
AUTH_BASE=(--input "$AUTHORIZATION" --class ISOLATED_RESTORE --command restore-drill-verify --expected-operator "$OPERATOR" --expected-deployed-sha "$DEPLOYED_SHA" --expected-config-version "$CONFIG_VERSION" --deployment-risk "$DEPLOYMENT_RISK" --action-preview "$ACTION_PREVIEW" --consumption-root "$AUTHORIZATION_CONSUMPTION_ROOT" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-isolated-restore --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 isolated restore drill" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission filesystem:CreateExactIsolatedRestore --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "restore and verify one exact backup into one exact isolated target")
EXPECTED_ENDPOINTS=(
  "backup-archive-count:$BACKUP_ARCHIVE_COUNT"
  "backup-created-at-utc:$BACKUP_CREATED_AT_UTC"
  "backup-data-schema:$BACKUP_DATA_SCHEMA"
  "backup-database-sha256:$BACKUP_DATABASE_SHA256"
  "backup-dir:$BACKUP_DIR_CANON"
  "backup-dir-identity:$BACKUP_DIR_IDENTITY"
  "backup-events-count:$BACKUP_EVENTS_COUNT"
  "backup-identity:$BACKUP_IDENTITY_ENDPOINT"
  "backup-manifest-sha256:$BACKUP_MANIFEST_SHA256"
  "backup-max-age-hours:$BACKUP_MAX_AGE_HOURS"
  "backup-path:$BACKUP_CANON"
  "backup-tree-sha256:$BACKUP_TREE_SHA256"
  "bash-identity:$BASH_IDENTITY_ENDPOINT"
  "bash-path:$BASH_PATH"
  "bash-sha256:$BASH_SHA256"
  "completion-reserve-seconds:$RESTORE_COMPLETION_RESERVE_SECONDS"
  "data-dir:$DATA_CANON"
  "data-dir-identity:$DATA_DIR_IDENTITY"
  "data-dir-path:$DATA_CANON"
  "donor-contract-sha256:$DONOR_CONTRACT_SHA256"
  "donor-env-sha256:$DELEGATE_ENV_SHA"
  "effect-common-identity:$EFFECT_COMMON_IDENTITY"
  "effect-common-path:$DONOR_ROOT/bin/common.sh"
  "effect-common-sha256:$EFFECT_COMMON_SHA256"
  "effect-environment-fd-token:/proc/self/fd/12"
  "effect-environment-sha256:$DELEGATE_ENV_SHA"
  "effect-environment-source-path:$ENV_SOURCE_PATH"
  "effect-finish-evidence:$EFFECT_FINISH_EXPECTED"
  "effect-gid:$EFFECT_GID"
  "effect-group:cosmos"
  "effect-program-identity:$BASH_IDENTITY_ENDPOINT"
  "effect-program-path:$BASH_PATH"
  "effect-program-sha256:$BASH_SHA256"
  "effect-script-identity:$EFFECT_SCRIPT_IDENTITY"
  "effect-script-path:$DONOR_ROOT/bin/restore.sh"
  "effect-script-sha256:$EFFECT_SCRIPT_SHA256"
  "effect-start-evidence:$EFFECT_START_EXPECTED"
  "effect-uid:$EFFECT_UID"
  "effect-unit-identity:$EFFECT_UNIT_IDENTITY"
  "effect-unit-path:$EFFECT_UNIT_PATH"
  "effect-unit-sha256:$EFFECT_UNIT_SHA256"
  "effect-user:cosmos"
  "effective-donor-identity:$EFFECTIVE_DONOR_IDENTITY_ENDPOINT"
  "effective-donor-root:$EFFECTIVE_DONOR_ROOT"
  "effective-donor-tree-sha256:$EFFECTIVE_DONOR_TREE_SHA256"
  "env-identity:$ENV_IDENTITY_ENDPOINT"
  "env-path:$ENV_PATH"
  "env-sha256:$ENV_SHA256"
  "getent-identity:$GETENT_IDENTITY_ENDPOINT"
  "getent-path:$GETENT_PATH"
  "getent-sha256:$GETENT_SHA256"
  "gzip-argv-shape:TAR_MANAGED"
  "gzip-fd-token:/proc/self/fd/39"
  "gzip-identity:$GZIP_IDENTITY_ENDPOINT"
  "gzip-path:$GZIP_PATH"
  "gzip-sha256:$GZIP_SHA256"
  "hash-identity:$HASH_IDENTITY_ENDPOINT"
  "hash-path:$HASH_PATH"
  "hash-sha256:$HASH_SHA256"
  "id-identity:$ID_IDENTITY_ENDPOINT"
  "id-path:$ID_PATH"
  "id-sha256:$ID_SHA256"
  "isolated-target:$TARGET_CANON"
  "isolated-target-parent-identity:$TARGET_PARENT_IDENTITY"
  "isolated-target-parent-path:$TARGET_PARENT"
  "l15-amendment-contract-sha256:$L15_AMENDMENT_CONTRACT_SHA256"
  "node-identity:$NODE_IDENTITY_ENDPOINT"
  "node-path:$NODE_PATH"
  "node-sha256:$NODE_SHA256"
  "receipt-publication-reserve-seconds:$RESTORE_RECEIPT_PUBLICATION_RESERVE_SECONDS"
  "setpriv-identity:$SETPRIV_IDENTITY_ENDPOINT"
  "setpriv-path:$SETPRIV_PATH"
  "setpriv-sha256:$SETPRIV_SHA256"
  "sqlite-identity:$SQLITE_IDENTITY_ENDPOINT"
  "sqlite-path:$SQLITE_PATH"
  "sqlite-sha256:$SQLITE_SHA256"
  "tar-identity:$TAR_IDENTITY_ENDPOINT"
  "tar-path:$TAR_PATH"
  "tar-sha256:$TAR_SHA256"
)
for endpoint in "${EXPECTED_ENDPOINTS[@]}"; do
  AUTH_BASE+=(--expected-endpoint "$endpoint")
done
if [ "$SIMULATION" = 1 ]; then
  TEST_VALIDATION_NOW="$("$NODE_PATH" -e \
    'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).authorizationWindow.startsAtUtc)' \
    "$DEPLOYMENT_RISK")"
  AUTH_BASE+=(--simulation-clock --now "$TEST_VALIDATION_NOW")
fi
"$NODE_PATH" -e 'process.exit(process.platform === "linux" ? 0 : 1)' \
  || blocked "authorized effects require Linux before authorization consumption"
AUTHORIZATION_VALIDATION="$("$NODE_PATH" "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}")"
AUTHORIZATION_CONSUMPTION="$("$NODE_PATH" -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.authorizationConsumptionPath)' "$AUTHORIZATION_VALIDATION")"
EFFECT_START_EVIDENCE="$("$NODE_PATH" -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.effectStartEvidence)' "$AUTHORIZATION_VALIDATION")"
EFFECT_FINISH_EVIDENCE="$("$NODE_PATH" -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.effectTerminalEvidence)' "$AUTHORIZATION_VALIDATION")"
[ "$EFFECT_START_EVIDENCE" = "$EFFECT_START_EXPECTED" ] \
  && [ "$EFFECT_FINISH_EVIDENCE" = "$EFFECT_FINISH_EXPECTED" ] \
  || blocked "validated effect evidence paths differ from the deployment risk"
require_sqlite_identity
SQLITE_VERSION="$("$SQLITE_PATH" --version)"
require_sqlite_identity
"$NODE_PATH" "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$SQLITE_VERSION" >/dev/null
cleanup_restore_wrapper() {
  "$GUARD_NODE_PATH" - "$SANITIZED_DIR" "$SIMULATION" "$SIMULATION_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [directory, simulation, simulationRoot] = process.argv.slice(2);
let stat;
try {
  stat = fs.lstatSync(directory);
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0);
  throw error;
}
const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
    || (stat.mode & 0o777) !== 0o700
    || fs.realpathSync.native(directory) !== directory) {
  process.exit(1);
}
const entries = fs.readdirSync(directory).sort();
if (simulation === '1') {
  if (directory !== path.join(simulationRoot, 'sanitized')
      || entries.some((name) => name !== 'backup.env')) process.exit(1);
} else if (!/^i00-restore-verify\.[A-Za-z0-9_-]+$/u.test(path.basename(directory))) {
  process.exit(1);
}
fs.rmSync(directory, { recursive: true });
NODE
}
trap 'cleanup_restore_wrapper || :' EXIT

record_authorized_outcome() {
  local primary_path="$1" source_path="$2" evidence_file="$3" expected_status="$4"
  local output status
  local -a recorder_args=(
    --class ISOLATED_RESTORE
    --authorization "$AUTHORIZATION"
    --deployment-risk "$DEPLOYMENT_RISK"
    --action-preview "$ACTION_PREVIEW"
    --authorization-consumption "$AUTHORIZATION_CONSUMPTION"
    --result-receipt "$RESULT_RECEIPT"
    --reconciliation-receipt "$RECONCILIATION_RECEIPT"
    --primary-path "$primary_path"
    --effect-start-evidence "$EFFECT_START_EVIDENCE"
    --effect-finish-evidence "$EFFECT_FINISH_EVIDENCE"
  )
  if [ -n "$source_path" ]; then
    recorder_args+=(--source-path "$source_path")
  fi
  if [ -n "$evidence_file" ]; then
    recorder_args+=(--evidence-file "$evidence_file")
  fi
  if [ "$SIMULATION" = 1 ]; then
    recorder_args+=(--simulation-clock)
  fi
  output="$("$NODE_PATH" "$SCRIPT_DIR/record-authorized-action-outcome.mjs" "${recorder_args[@]}")" \
    || blocked "authorized isolated restore outcome could not be recorded"
  status="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$output")" \
    || blocked "authorized isolated restore outcome status is invalid"
  [ "$status" = "$expected_status" ] \
    || blocked "authorized isolated restore outcome status is contradictory"
}
require_delegate_env_identity
require_sqlite_identity
require_backup_identity
require_effect_executable_identities
require_backup_freshness
set +e
"$NODE_PATH" "$BOUND_EFFECT_RUNNER" \
  --authorization "$AUTHORIZATION" \
  --deployment-risk "$DEPLOYMENT_RISK" \
  --action-preview "$ACTION_PREVIEW" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  -- "$DONOR_ROOT/bin/restore.sh" --i00-effect-environment "$DELEGATE_ENV"
DELEGATE_RC=$?
set -e
if [ "$DELEGATE_RC" != 0 ]; then
  record_authorized_outcome "$TARGET_CANON" "" "" AUTHORIZED_ACTION_FAILURE_RECORDED
  exit "$DELEGATE_RC"
fi
record_authorized_outcome "$TARGET_CANON" "$BACKUP_CANON" \
  "$TARGET_CANON/restore-report.json" AUTHORIZED_ACTION_OUTCOME_RECORDED
require_sqlite_identity
require_delegate_env_identity
require_backup_identity
require_effect_executable_identities
SQLITE_INTEGRITY="$("$SQLITE_PATH" "$TARGET_CANON/cosmos.db" 'PRAGMA integrity_check;')"
require_sqlite_identity
[ "$SQLITE_INTEGRITY" = "ok" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore integrity_check failed\n' >&2; exit 1; }
SQLITE_FOREIGN_KEYS="$("$SQLITE_PATH" "$TARGET_CANON/cosmos.db" 'PRAGMA foreign_key_check;')"
require_sqlite_identity
[ -z "$SQLITE_FOREIGN_KEYS" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore foreign_key_check failed\n' >&2; exit 1; }
require_backup_identity
require_effect_executable_identities
printf '{"status":"ISOLATED_RESTORE_VERIFIED_NO_PRODUCTION_MUTATION","target":"%s"}\n' "$TARGET_CANON"
