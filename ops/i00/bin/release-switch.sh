#!/bin/bash -p
# I00 adapter: validate final release and canonical blockers, then delegate the
# actual immutable install/switch to the accepted L15 deploy owner.
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
  *) printf 'I00_OPS_BLOCKED: release-switch requires an explicit script path\n' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: release-switch script directory is unavailable\n' >&2; exit 1; }
unset _I00_ENTRY_DIR
I00_ROOT="$(cd -P -- "$SCRIPT_DIR/.." && builtin pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"
FIRST_HOST_SENTINEL=NO_PRIOR_RELEASE_FIRST_HOST

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

SEEN_OPTIONS=""
mark_seen() {
  case " $SEEN_OPTIONS " in
    *" $1 "*) blocked "duplicate singleton argument $1" ;;
  esac
  SEEN_OPTIONS="$SEEN_OPTIONS $1"
}
require_value() {
  [ "$#" -eq 2 ] && [ -n "$2" ] && [ "${2#--}" = "$2" ] \
    || blocked "$1 needs one non-empty value"
}

RELEASE="" ENV_FILE="" RUNTIME_ENV="" HOST="" SUPERVISOR="" SQLITE=""
AUTHORIZATION="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" EVIDENCE_ROOT=""
NOW="" SIMULATION_ROOT="" SIMULATION_PROBE="" SIMULATION_SYSTEMCTL_READBACK=""
SIMULATION_EVIDENCE_ROOT_SWAP_TO="" SIMULATION=0
PROVENANCE_MODE="" PROVENANCE_ROOT=""
OPERATOR="" CONFIG_VERSION="" DEPLOYMENT_RISK="" ACTION_PREVIEW="" AUTHORIZATION_CONSUMPTION_ROOT=""
RECOVERY_TARGET="" ACCOUNT="" TARGET_HOST="" TARGET_ENVIRONMENT="" BACKUP_RESERVE_BYTES=""
FIRST_HOST_EVIDENCE_DIR="" PREPARE_FIRST_HOST_EVIDENCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) mark_seen "$1"; require_value "$1" "${2-}"; RELEASE="$2"; shift 2 ;;
    --env-file) mark_seen "$1"; require_value "$1" "${2-}"; ENV_FILE="$2"; shift 2 ;;
    --runtime-env) mark_seen "$1"; require_value "$1" "${2-}"; RUNTIME_ENV="$2"; shift 2 ;;
    --host) mark_seen "$1"; require_value "$1" "${2-}"; HOST="$2"; shift 2 ;;
    --supervisor) mark_seen "$1"; require_value "$1" "${2-}"; SUPERVISOR="$2"; shift 2 ;;
    --sqlite) mark_seen "$1"; require_value "$1" "${2-}"; SQLITE="$2"; shift 2 ;;
    --recovery-target) mark_seen "$1"; require_value "$1" "${2-}"; RECOVERY_TARGET="$2"; shift 2 ;;
    --account) mark_seen "$1"; require_value "$1" "${2-}"; ACCOUNT="$2"; shift 2 ;;
    --target-host) mark_seen "$1"; require_value "$1" "${2-}"; TARGET_HOST="$2"; shift 2 ;;
    --environment) mark_seen "$1"; require_value "$1" "${2-}"; TARGET_ENVIRONMENT="$2"; shift 2 ;;
    --backup-reserve-bytes) mark_seen "$1"; require_value "$1" "${2-}"; BACKUP_RESERVE_BYTES="$2"; shift 2 ;;
    --first-host-evidence-dir) mark_seen "$1"; require_value "$1" "${2-}"; FIRST_HOST_EVIDENCE_DIR="$2"; shift 2 ;;
    --prepare-first-host-evidence) mark_seen "$1"; PREPARE_FIRST_HOST_EVIDENCE=1; shift ;;
    --authorization) mark_seen "$1"; require_value "$1" "${2-}"; AUTHORIZATION="$2"; shift 2 ;;
    --operator) mark_seen "$1"; require_value "$1" "${2-}"; OPERATOR="$2"; shift 2 ;;
    --config-version) mark_seen "$1"; require_value "$1" "${2-}"; CONFIG_VERSION="$2"; shift 2 ;;
    --deployment-risk) mark_seen "$1"; require_value "$1" "${2-}"; DEPLOYMENT_RISK="$2"; shift 2 ;;
    --action-preview) mark_seen "$1"; require_value "$1" "${2-}"; ACTION_PREVIEW="$2"; shift 2 ;;
    --authorization-consumption-root) mark_seen "$1"; require_value "$1" "${2-}"; AUTHORIZATION_CONSUMPTION_ROOT="$2"; shift 2 ;;
    --result-receipt) mark_seen "$1"; require_value "$1" "${2-}"; RESULT_RECEIPT="$2"; shift 2 ;;
    --reconciliation-receipt) mark_seen "$1"; require_value "$1" "${2-}"; RECONCILIATION_RECEIPT="$2"; shift 2 ;;
    --evidence-root) mark_seen "$1"; require_value "$1" "${2-}"; EVIDENCE_ROOT="$2"; shift 2 ;;
    --now) mark_seen "$1"; require_value "$1" "${2-}"; NOW="$2"; shift 2 ;;
    --simulation-root) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_ROOT="$2"; shift 2 ;;
    --simulation-probe) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_PROBE="$2"; shift 2 ;;
    --simulation-systemctl-readback) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_SYSTEMCTL_READBACK="$2"; shift 2 ;;
    --simulation-evidence-root-swap-to) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_EVIDENCE_ROOT_SWAP_TO="$2"; shift 2 ;;
    --provenance-mode) mark_seen "$1"; require_value "$1" "${2-}"; PROVENANCE_MODE="$2"; shift 2 ;;
    --provenance-root) mark_seen "$1"; require_value "$1" "${2-}"; PROVENANCE_ROOT="$2"; shift 2 ;;
    --simulation) mark_seen "$1"; SIMULATION=1; shift ;;
    *) blocked "unknown argument $1" ;;
  esac
done
if [ -z "$PROVENANCE_MODE" ]; then
  [ "$SIMULATION" = 1 ] && PROVENANCE_MODE=TEST || PROVENANCE_MODE=SYSTEM
fi
case "$PROVENANCE_MODE" in
  SYSTEM)
    [ "$SIMULATION" = 0 ] && [ -z "$PROVENANCE_ROOT" ] \
      || blocked "SYSTEM wrapper provenance rejects simulation and --provenance-root"
    ;;
  TEST)
    [ "$SIMULATION" = 1 ] \
      || blocked "TEST wrapper provenance requires --simulation"
    if [ -z "$PROVENANCE_ROOT" ]; then PROVENANCE_ROOT="$SIMULATION_ROOT"; fi
    [ -n "$SIMULATION_ROOT" ] && [ "$PROVENANCE_ROOT" = "$SIMULATION_ROOT" ] \
      || blocked "TEST wrapper provenance root must equal the marked simulation root"
    ;;
  STAGING)
    blocked "release-switch wrapper forbids STAGING effects and receipt publication"
    ;;
  *) blocked "--provenance-mode must be SYSTEM or TEST for release-switch" ;;
esac
[ -z "$SIMULATION_EVIDENCE_ROOT_SWAP_TO" ] \
  || { [ "$SIMULATION" = 1 ] && [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; } \
  || blocked "--simulation-evidence-root-swap-to is test-only first-host preparation input"

[ -n "$RELEASE" ] && [ -n "$ENV_FILE" ] && [ -n "$RUNTIME_ENV" ] && [ -n "$SQLITE" ] \
  || blocked "--release, --env-file, --runtime-env, and explicit --sqlite are required"
case "$RELEASE" in
  /*) : ;;
  *) blocked "--release must be one absolute lexical path" ;;
esac

FIRST_HOST=0
if [ -n "$RECOVERY_TARGET" ]; then
  [ "$RECOVERY_TARGET" = "$FIRST_HOST_SENTINEL" ] \
    || blocked "--recovery-target must be exactly $FIRST_HOST_SENTINEL"
  FIRST_HOST=1
  [ -z "$HOST" ] && [ -z "$SUPERVISOR" ] \
    || blocked "first-host mode rejects caller-supplied --host and --supervisor JSON"
  [ -n "$ACCOUNT" ] && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] \
    && [ -n "$BACKUP_RESERVE_BYTES" ] && [ -n "$EVIDENCE_ROOT" ] \
    || blocked "first-host mode requires account, target host, environment, backup reserve, and evidence root"
  case "$BACKUP_RESERVE_BYTES" in
    0) : ;;
    0*|*[!0-9]*) blocked "--backup-reserve-bytes must be a canonical non-negative integer" ;;
    *) : ;;
  esac
  if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
    [ -z "$FIRST_HOST_EVIDENCE_DIR" ] \
      || blocked "prepare-first-host evidence rejects --first-host-evidence-dir"
  else
    [ -n "$FIRST_HOST_EVIDENCE_DIR" ] \
      || blocked "first-host switch requires --first-host-evidence-dir"
  fi
else
  [ -n "$HOST" ] && [ -n "$SUPERVISOR" ] \
    || blocked "normal deploy requires --host and --supervisor"
  [ -z "$ACCOUNT" ] && [ -z "$TARGET_HOST" ] && [ -z "$TARGET_ENVIRONMENT" ] \
    && [ -z "$BACKUP_RESERVE_BYTES" ] && [ -z "$SIMULATION_SYSTEMCTL_READBACK" ] \
    && [ -z "$FIRST_HOST_EVIDENCE_DIR" ] && [ "$PREPARE_FIRST_HOST_EVIDENCE" = 0 ] \
    || blocked "first-host owner inputs require the exact recovery target"
fi
if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
  [ -z "$AUTHORIZATION" ] && [ -z "$OPERATOR" ] && [ -z "$CONFIG_VERSION" ] \
    && [ -z "$DEPLOYMENT_RISK" ] && [ -z "$ACTION_PREVIEW" ] \
    && [ -z "$AUTHORIZATION_CONSUMPTION_ROOT" ] && [ -z "$RESULT_RECEIPT" ] \
    && [ -z "$RECONCILIATION_RECEIPT" ] \
    || blocked "first-host preparation rejects authorization and receipt inputs"
fi
[ -x "$DONOR_ROOT/bin/deploy.sh" ] || blocked "effective L15 deploy.sh is unavailable"
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
else
  NODE_DISCOVERED="$(select_privileged_node)"
  NODE_PATH="$NODE_DISCOVERED"
  NODE_INITIAL="$("$SCRIPT_DIR/run-fixed-node-gate.sh" inspect-executable.mjs --path "$NODE_PATH")"
  BASH_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/bin/bash"))')"
  BASH_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")"
  RUNNING_BASH_PATH="$("$NODE_PATH" -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$BASH")"
  [ "$RUNNING_BASH_PATH" = "$BASH_PATH" ] \
    || blocked "running Bash does not match the fixed interpreter"
  hash -p "$NODE_PATH" node
fi
if [ "$SIMULATION" = 1 ]; then
  GUARD_NODE_PATH="$SIMULATION_NODE_PATH"
else
  GUARD_NODE_PATH="$NODE_PATH"
fi
readonly GUARD_NODE_PATH

RELEASE="$("$GUARD_NODE_PATH" --input-type=module - "$RELEASE" <<'NODE'
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
const input = process.argv[2];
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input) {
  fail('--release must be one absolute lexical canonical path');
}
let stat;
try {
  stat = lstatSync(input);
} catch (error) {
  fail(`--release is unavailable: ${error.message}`);
}
if (stat.isSymbolicLink() || !stat.isDirectory()) {
  fail('--release must identify one non-symlink unpacked release directory');
}
let physical;
try {
  physical = realpathSync(input);
} catch (error) {
  fail(`--release cannot be canonicalized: ${error.message}`);
}
if (physical !== input) {
  fail('--release path or one of its ancestors is not physically canonical');
}
process.stdout.write(input);
NODE
)" || blocked "--release canonical endpoint validation failed"

node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
DONOR_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DONOR_ROOT")"
[ -x "$DONOR_ROOT/bin/deploy.sh" ] || blocked "canonical effective L15 deploy.sh is unavailable"
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
if [ "$SIMULATION" != 1 ]; then
  EFFECTIVE_DONOR_ROOT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).root)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
  EFFECTIVE_DONOR_IDENTITY_ENDPOINT="$(donor_root_identity)"
  EFFECTIVE_DONOR_TREE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).effectiveRootDigestSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
  DONOR_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).immutableDonorContractSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
  L15_AMENDMENT_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).amendmentContractSha256)' "$EFFECTIVE_DONOR_VERIFICATION_INITIAL")"
fi
CANDIDATE_SHA="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.testedSha)' "$RELEASE/release.json")"
node "$SCRIPT_DIR/validate-config.mjs" --env "$RUNTIME_ENV" --expected-sha "$CANDIDATE_SHA" >/dev/null
if [ "$SIMULATION" = 1 ]; then
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --allow-simulation --require-exact-cohort >/dev/null
else
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --require-exact-cohort \
    --trusted-build-public-key "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}" >/dev/null
fi

# Inspect one explicitly pinned SQLite executable without a shell or ambient
# command fallback. The complete identity and digest are re-read after the
# command. The same helper is called again after preflight, immediately before
# the donor delegation, to close path/binary replacement races.
inspect_sqlite() {
  node "$SCRIPT_DIR/inspect-executable.mjs" --path "$1" >/dev/null
  node --input-type=module - "$1" <<'NODE'
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
const requested = process.argv[2];
if (!requested || !isAbsolute(requested) || resolve(requested) !== requested) {
  fail('--sqlite must be one canonical absolute path');
}
const identity = (stat) => ({
  device: stat.dev.toString(), inode: stat.ino.toString(), mode: stat.mode.toString(8),
  size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
});
const inspect = () => {
  let stat;
  try { stat = lstatSync(requested, { bigint: true }); } catch (error) { fail(`SQLite executable is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111n) === 0n) {
    fail('SQLite path must be a non-symlink executable regular file');
  }
  if ((stat.mode & 0o022n) !== 0n) fail('SQLite executable must not be group/world writable');
  let canonical;
  try { canonical = realpathSync(requested); } catch (error) { fail(`SQLite path cannot be canonicalized: ${error.message}`); }
  if (canonical !== requested) fail('SQLite path or one of its ancestors is not canonical');
  let sha256;
  try { sha256 = createHash('sha256').update(readFileSync(requested)).digest('hex'); }
  catch (error) { fail(`SQLite executable cannot be hashed: ${error.message}`); }
  return { stat, sha256, identity: identity(stat) };
};
const before = inspect();
const result = spawnSync(requested, ['--version'], {
  encoding: 'utf8', timeout: 1000, maxBuffer: 4096, windowsHide: true,
  env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.error || result.signal || result.status !== 0) {
  fail(`SQLite --version execution failed or exceeded its bound: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
}
if (result.stderr !== '') fail('SQLite --version wrote unexpected stderr');
const raw = result.stdout;
if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096 || raw.includes('\0')) {
  fail('SQLite --version output is empty or malformed');
}
const match = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:[ \t][^\r\n]*)?\n?$/.exec(raw);
if (!match) fail('SQLite --version output is not one canonical x.y.z version line');
const version = match[1];
const after = inspect();
if (before.sha256 !== after.sha256 || JSON.stringify(before.identity) !== JSON.stringify(after.identity)) {
  fail('SQLite executable changed during live readback');
}
const endpointIdentity = Object.entries(before.identity).map(([key, value]) => `${key}=${value}`).join(',');
process.stdout.write(JSON.stringify({ path: requested, sha256: before.sha256, version, identity: before.identity, endpointIdentity }));
NODE
}

if [ "$SIMULATION" != 1 ]; then
  SYSTEMCTL_PATH="$(canonical_effect_command systemctl)"
  SYSTEMCTL_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SYSTEMCTL_PATH")"
  CURL_PATH="$(canonical_effect_command curl)"
  CURL_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$CURL_PATH")"
  ENV_PATH="$(canonical_effect_command env)"
  ENV_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")"
  NODE_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$NODE_INITIAL")"
  NODE_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$NODE_INITIAL")"
  BASH_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$BASH_INITIAL")"
  BASH_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$BASH_INITIAL")"
  SYSTEMCTL_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SYSTEMCTL_INITIAL")"
  SYSTEMCTL_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SYSTEMCTL_INITIAL")"
  CURL_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$CURL_INITIAL")"
  CURL_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$CURL_INITIAL")"
  ENV_SHA256="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$ENV_INITIAL")"
  ENV_IDENTITY_ENDPOINT="$("$NODE_PATH" -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$ENV_INITIAL")"
fi

require_effect_executable_identities() {
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$NODE_PATH")" = "$NODE_INITIAL" ] \
    || blocked "Node executable identity changed around release-switch effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")" = "$BASH_INITIAL" ] \
    || blocked "Bash executable identity changed around release-switch effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SYSTEMCTL_PATH")" = "$SYSTEMCTL_INITIAL" ] \
    || blocked "systemctl executable identity changed around release-switch effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$CURL_PATH")" = "$CURL_INITIAL" ] \
    || blocked "curl executable identity changed around release-switch effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")" = "$ENV_INITIAL" ] \
    || blocked "env executable identity changed around release-switch effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
      --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
      --root "$DONOR_ROOT" --require-immutable)" = "$EFFECTIVE_DONOR_VERIFICATION_INITIAL" ] \
    || blocked "effective donor tree changed around release-switch effect"
  [ "$(donor_root_identity)" = "$EFFECTIVE_DONOR_IDENTITY_ENDPOINT" ] \
    || blocked "effective donor root identity changed around release-switch effect"
}

require_app_unit_binding() {
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-app-unit.mjs" \
      --systemctl "$SYSTEMCTL_PATH" --unit "$APP_UNIT_ENDPOINT" \
      --node "$NODE_PATH" --env "$ENV_PATH" \
      --runtime-env "$RUNTIME_ENV" \
      --provenance-mode SYSTEM \
      --expected-fragment-path /etc/systemd/system/cosmos-app.service \
      --expected-fragment-source "$EFFECTIVE_DONOR_ROOT/systemd/cosmos-app.service" \
      --expected-binding-sha256 "$APP_UNIT_BINDING_SHA256")" = "$APP_UNIT_INITIAL" ] \
    || blocked "application unit binding changed around release-switch effect"
}

validate_simulation_executable() {
  node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$1" "$2" <<'NODE'
import { lstatSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [modulePath, rootInput, commandInput] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
let safety;
try { safety = await import(pathToFileURL(modulePath)); } catch (error) { fail(error.message); }
let root;
try { root = safety.validateSimulationRoot(rootInput); } catch (error) { fail(error.message); }
let stat;
try { stat = lstatSync(commandInput); } catch (error) { fail(`simulation executable is unavailable: ${error.message}`); }
if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
  fail('simulation readback executable must be an owner-controlled non-symlink executable regular file');
}
if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('simulation readback executable has the wrong owner');
let canonical;
try { canonical = realpathSync(commandInput); } catch (error) { fail(error.message); }
if (canonical !== commandInput) fail('simulation readback executable path must be canonical');
let inside = false;
try { inside = safety.isWithinSimulationRoot(root, canonical); } catch { inside = false; }
if (!inside) fail('simulation readback executable must remain below the marked simulation root');
process.stdout.write(canonical);
NODE
}

capture_evidence_identity() {
  node --input-type=module - "$1" "$2" <<'NODE'
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, parse, resolve, sep } from 'node:path';
const [input, label] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
if (!input || !isAbsolute(input) || resolve(input) !== input) fail(`${label} path must be canonical and absolute`);
const parsed = parse(input);
const parts = input.slice(parsed.root.length).split(sep).filter(Boolean);
let cursor = parsed.root;
for (const part of parts) {
  cursor = resolve(cursor, part);
  let stat;
  try { stat = lstatSync(cursor, { bigint: true }); } catch (error) { fail(`${label} path is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink()) fail(`${label} path must not traverse a symlink`);
  if (cursor !== input && !stat.isDirectory()) fail(`${label} path has a non-directory ancestor`);
}
const stat = lstatSync(input, { bigint: true });
if (!stat.isFile() || realpathSync(input) !== input) fail(`${label} must be one canonical real regular file`);
let bytes;
try { bytes = readFileSync(input); } catch (error) { fail(`${label} is unreadable: ${error.message}`); }
process.stdout.write(JSON.stringify({
  path: input,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  identity: {
    device: stat.dev.toString(), inode: stat.ino.toString(), mode: stat.mode.toString(8),
    size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
  },
}));
NODE
}

if [ "$SIMULATION" = 1 ]; then
  [ -n "$NOW" ] && [ -n "$SIMULATION_ROOT" ] && [ -n "$SIMULATION_PROBE" ] \
    && [ -n "${SYSTEMCTL:-}" ] && [ -n "${CURL:-}" ] \
    || blocked "simulation requires --now, --simulation-root, --simulation-probe, fake SYSTEMCTL, and fake CURL"
  if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
    [ -z "$AUTHORIZATION" ] && [ -z "$OPERATOR" ] && [ -z "$CONFIG_VERSION" ] \
      && [ -z "$DEPLOYMENT_RISK" ] && [ -z "$ACTION_PREVIEW" ] \
      && [ -z "$AUTHORIZATION_CONSUMPTION_ROOT" ] && [ -z "$RESULT_RECEIPT" ] \
      && [ -z "$RECONCILIATION_RECEIPT" ] \
      || blocked "first-host preparation rejects authorization and receipt inputs"
  else
    [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] \
      && [ -n "$DEPLOYMENT_RISK" ] && [ -n "$ACTION_PREVIEW" ] \
      && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] && [ -n "$RESULT_RECEIPT" ] \
      && [ -n "$RECONCILIATION_RECEIPT" ] && [ -n "$EVIDENCE_ROOT" ] \
      || blocked "simulation effect requires the full TEST authorization chain and exact receipt targets"
  fi
  SYSTEMCTL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SYSTEMCTL")"
  CURL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$CURL")"
  SIMULATION_PROBE="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_PROBE")"
  SYSTEMCTL_PATH="$SYSTEMCTL"
  CURL_PATH="$CURL"
  SIMULATION_COMMAND_ROOT="${SYSTEMCTL_PATH%/*}"
  [ "${CURL_PATH%/*}" = "$SIMULATION_COMMAND_ROOT" ] \
    || blocked "simulation effect command roots differ"
  SIMULATION_NODE_PATH="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" \
    --root "$SIMULATION_ROOT" --command "$SIMULATION_COMMAND_ROOT/node")"
  SIMULATION_BASH_PATH="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" \
    --root "$SIMULATION_ROOT" --command "$SIMULATION_COMMAND_ROOT/bash")"
  SIMULATION_ENV_PATH="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" \
    --root "$SIMULATION_ROOT" --command "$SIMULATION_COMMAND_ROOT/env")"
  hash -p "$SIMULATION_NODE_PATH" node
  SYSTEMCTL_INITIAL="$(node "$SCRIPT_DIR/inspect-executable.mjs" --path "$SYSTEMCTL_PATH")"
  SYSTEMCTL_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SYSTEMCTL_INITIAL")"
  SYSTEMCTL_IDENTITY_ENDPOINT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SYSTEMCTL_INITIAL")"
  SQLITE="$(validate_simulation_executable "$SIMULATION_ROOT" "$SQLITE")"
  if [ "$FIRST_HOST" = 1 ]; then
    if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
      [ -n "$SIMULATION_SYSTEMCTL_READBACK" ] \
        || blocked "first-host evidence preparation simulation requires --simulation-systemctl-readback"
      FIRST_HOST_SYSTEMCTL="$(validate_simulation_executable "$SIMULATION_ROOT" "$SIMULATION_SYSTEMCTL_READBACK")"
    else
      [ -z "$SIMULATION_SYSTEMCTL_READBACK" ] \
        || blocked "first-host switch rejects preparation-only --simulation-systemctl-readback"
    fi
  fi
  SANITIZED_DIR=""
  SIMULATION_ENV_PROOF="$SIMULATION_ROOT/release-switch-env-proof"
  node "$SCRIPT_DIR/validate-simulation-env.mjs" \
    --env "$ENV_FILE" --root "$SIMULATION_ROOT" --output "$SIMULATION_ENV_PROOF" >/dev/null
  SIMULATION_SANITIZED_DIR="$SIMULATION_ROOT/sanitized"
  "$GUARD_NODE_PATH" - "$SIMULATION_SANITIZED_DIR" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const before = fs.lstatSync(path, { throwIfNoEntry: false });
if (before === undefined) fs.mkdirSync(path, { mode: 0o700 });
const stat = fs.lstatSync(path);
if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(path) !== path
    || (stat.mode & 0o777) !== 0o700) process.exit(1);
NODE
  DELEGATE_ENV="$SIMULATION_SANITIZED_DIR/deploy.env"
  if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
    [ ! -e "$DELEGATE_ENV" ] && [ ! -L "$DELEGATE_ENV" ] \
      || blocked "prepared simulation donor env already exists"
    SIMULATION_SANITIZED_PROOF="$DELEGATE_ENV"
  else
    [ -f "$DELEGATE_ENV" ] && [ ! -L "$DELEGATE_ENV" ] \
      || blocked "simulation effect requires the producer-bound sanitized donor env"
    SIMULATION_SANITIZED_PROOF="$SIMULATION_ROOT/release-switch-env-sanitized-proof"
  fi
  SANITIZE_SIMULATION_ARGS=(
    --env "$SIMULATION_ENV_PROOF"
    --output "$SIMULATION_SANITIZED_PROOF"
    --profile deploy
    --provenance-mode TEST
    --provenance-root "$SIMULATION_ROOT"
    --node "$SIMULATION_NODE_PATH"
    --bash "$SIMULATION_BASH_PATH"
    --env-bin "$SIMULATION_ENV_PATH"
    --systemctl "$SYSTEMCTL_PATH"
    --curl "$CURL_PATH"
    --require-effect-bindings
  )
  if [ "$FIRST_HOST" = 1 ]; then
    SANITIZE_SIMULATION_ARGS+=(--require-first-host-no-current)
  fi
  "$SIMULATION_NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    "${SANITIZE_SIMULATION_ARGS[@]}" >/dev/null
  "$GUARD_NODE_PATH" - "$SIMULATION_ENV_PROOF" "$SIMULATION_SANITIZED_PROOF" \
    "$DELEGATE_ENV" "$PREPARE_FIRST_HOST_EVIDENCE" <<'NODE'
const fs = require('fs');
const [rawProof, sanitizedProof, delegated, preparation] = process.argv.slice(2);
const proofStat = fs.lstatSync(sanitizedProof);
if (!proofStat.isFile() || proofStat.isSymbolicLink()
    || fs.realpathSync.native(sanitizedProof) !== sanitizedProof
    || (proofStat.mode & 0o777) !== 0o600) process.exit(1);
if (preparation !== '1'
    && !fs.readFileSync(sanitizedProof).equals(fs.readFileSync(delegated))) process.exit(1);
fs.unlinkSync(rawProof);
if (preparation !== '1') fs.unlinkSync(sanitizedProof);
NODE
  if [ "$FIRST_HOST" = 1 ]; then
    "$GUARD_NODE_PATH" - "$DELEGATE_ENV" <<'NODE'
const fs = require('fs');
const lines = new Set(fs.readFileSync(process.argv[2], 'utf8').split('\n'));
if (!lines.has("I00_REQUIRE_FIRST_HOST_NO_CURRENT='1'")
    || !lines.has("COSMOS_DEPLOY_VIA_I00_WRAPPER='1'")) process.exit(1);
NODE
  fi
  "$GUARD_NODE_PATH" - "$SIMULATION_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
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
NODE
  EFFECTIVE_NOW="$NOW"
else
  [ -z "$NOW" ] || blocked "real switch does not accept a caller clock"
  [ -z "$SIMULATION_ROOT" ] && [ -z "$SIMULATION_PROBE" ] && [ -z "$SIMULATION_SYSTEMCTL_READBACK" ] \
    || blocked "real switch rejects simulation-only inputs"
  if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
    [ -z "$AUTHORIZATION" ] && [ -z "$OPERATOR" ] && [ -z "$CONFIG_VERSION" ] \
      && [ -z "$DEPLOYMENT_RISK" ] && [ -z "$ACTION_PREVIEW" ] && [ -z "$AUTHORIZATION_CONSUMPTION_ROOT" ] \
      && [ -z "$RESULT_RECEIPT" ] && [ -z "$RECONCILIATION_RECEIPT" ] \
      || blocked "prepare-first-host evidence rejects authorization and receipt inputs"
  else
    [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] && [ -n "$DEPLOYMENT_RISK" ] \
      && [ -n "$ACTION_PREVIEW" ] && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] && [ -n "$RESULT_RECEIPT" ] \
      && [ -n "$RECONCILIATION_RECEIPT" ] && [ -n "$EVIDENCE_ROOT" ] \
      || blocked "real switch requires authorization, independent operator/revision, producer evidence, consumption root, and exact receipt targets"
  fi
  EFFECTIVE_NOW="$("$NODE_PATH" -e '
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    process.stdout.write(now.toISOString().replace(".000Z", "Z"));
  ')"
  SANITIZED_DIR="$("$NODE_PATH" "$SCRIPT_DIR/create-private-temp.mjs" --prefix i00-release-switch.)"
  DELEGATE_ENV="$SANITIZED_DIR/deploy.env"
  if [ "$FIRST_HOST" = 1 ]; then
    "$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
      --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy --provenance-mode SYSTEM \
      --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
      --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
      --require-effect-bindings --require-first-host-no-current >/dev/null
    if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then FIRST_HOST_SYSTEMCTL="$SYSTEMCTL_PATH"; fi
  else
    "$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
      --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy --provenance-mode SYSTEM \
      --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
      --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
      --require-effect-bindings >/dev/null
  fi
fi
readonly SANITIZED_DIR
if [ "$SIMULATION" != 1 ]; then
  DATA_DIR_ENDPOINT="$(node -e '
    const fs=require("fs");
    const line=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).find((entry)=>entry.startsWith("DATA_DIR="));
    const quote=String.fromCharCode(39), prefix=`DATA_DIR=${quote}`;
    if(!line?.startsWith(prefix)||!line.endsWith(quote)||line.length<=prefix.length+1)process.exit(2);
    process.stdout.write(line.slice(prefix.length,-1));
  ' "$DELEGATE_ENV")" || blocked "sanitized donor env has no exact DATA_DIR"
  SANITIZED_ENV_PATH="$(node -e '
    const fs=require("fs");
    const line=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).find((entry)=>entry.startsWith("I00_ENV="));
    const quote=String.fromCharCode(39), prefix=`I00_ENV=${quote}`;
    if(!line?.startsWith(prefix)||!line.endsWith(quote)||line.length<=prefix.length+1)process.exit(2);
    process.stdout.write(line.slice(prefix.length,-1));
  ' "$DELEGATE_ENV")" || blocked "sanitized donor env has no exact I00_ENV"
  [ "$SANITIZED_ENV_PATH" = "$ENV_PATH" ] \
    || blocked "sanitized env executable binding changed"
  APP_UNIT_ENDPOINT="$(node -e '
    const fs=require("fs");
    const line=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).find((entry)=>entry.startsWith("APP_UNIT="));
    const quote=String.fromCharCode(39), prefix=`APP_UNIT=${quote}`;
    if(!line?.startsWith(prefix)||!line.endsWith(quote)||line.length<=prefix.length+1)process.exit(2);
    process.stdout.write(line.slice(prefix.length,-1));
  ' "$DELEGATE_ENV")" || blocked "sanitized donor env has no exact APP_UNIT"
  [ "$APP_UNIT_ENDPOINT" = cosmos-app.service ] \
    || blocked "sanitized application unit binding changed"
  APP_UNIT_INITIAL="$("$NODE_PATH" "$SCRIPT_DIR/inspect-app-unit.mjs" \
    --systemctl "$SYSTEMCTL_PATH" --unit "$APP_UNIT_ENDPOINT" \
    --node "$NODE_PATH" --env "$ENV_PATH" \
    --runtime-env "$RUNTIME_ENV" \
    --provenance-mode SYSTEM \
    --expected-fragment-path /etc/systemd/system/cosmos-app.service \
    --expected-fragment-source "$EFFECTIVE_DONOR_ROOT/systemd/cosmos-app.service")"
  app_unit_value() {
    "$NODE_PATH" -e '
      const value=JSON.parse(process.argv[1]);
      let cursor=value;
      for(const part of process.argv[2].split("."))cursor=cursor?.[part];
      if(typeof cursor!=="string")process.exit(2);
      process.stdout.write(cursor);
    ' "$APP_UNIT_INITIAL" "$1"
  }
  APP_UNIT_FRAGMENT_PATH="$(app_unit_value fragmentPath)" \
    || blocked "application unit fragment path is invalid"
  APP_UNIT_INSPECTION_MODE="$(app_unit_value inspectionMode)" \
    || blocked "application unit inspection mode is invalid"
  [ "$APP_UNIT_INSPECTION_MODE" = LIVE_SYSTEM_MANAGER ] \
    || blocked "production application unit must use live manager inspection"
  APP_UNIT_FRAGMENT_SHA256="$(app_unit_value fragmentSha256)" \
    || blocked "application unit fragment digest is invalid"
  APP_UNIT_FRAGMENT_IDENTITY="$(app_unit_value fragmentEndpointIdentity)" \
    || blocked "application unit fragment identity is invalid"
  APP_UNIT_FRAGMENT_SOURCE_PATH="$(app_unit_value fragmentSourcePath)" \
    || blocked "application unit fragment source path is invalid"
  APP_UNIT_FRAGMENT_SOURCE_SHA256="$(app_unit_value fragmentSourceSha256)" \
    || blocked "application unit fragment source digest is invalid"
  APP_UNIT_FRAGMENT_SOURCE_IDENTITY="$(app_unit_value fragmentSourceEndpointIdentity)" \
    || blocked "application unit fragment source identity is invalid"
  APP_UNIT_RUNTIME_ENV_PATH="$(app_unit_value runtimeEnvPath)" \
    || blocked "application unit runtime environment path is invalid"
  APP_UNIT_RUNTIME_ENV_SHA256="$(app_unit_value runtimeEnvSha256)" \
    || blocked "application unit runtime environment digest is invalid"
  APP_UNIT_RUNTIME_ENV_IDENTITY="$(app_unit_value runtimeEnvEndpointIdentity)" \
    || blocked "application unit runtime environment identity is invalid"
  APP_UNIT_USER="$(app_unit_value user)" \
    || blocked "application unit user is invalid"
  APP_UNIT_GROUP="$(app_unit_value group)" \
    || blocked "application unit group is invalid"
  APP_UNIT_WORKING_DIRECTORY="$(app_unit_value workingDirectory)" \
    || blocked "application unit working directory is invalid"
  APP_UNIT_UNSET_ENVIRONMENT_SHA256="$(app_unit_value unsetEnvironmentSha256)" \
    || blocked "application unit unset-environment digest is invalid"
  APP_UNIT_NAMESPACE_REMAP_STATE="$(app_unit_value namespaceRemapState)" \
    || blocked "application unit namespace remap state is invalid"
  APP_UNIT_AUTHORITY_CLOSURE_SHA256="$(app_unit_value authorityClosureSha256)" \
    || blocked "application unit authority-closure digest is invalid"
  APP_UNIT_EFFECT_REACHABILITY="$(app_unit_value effectReachability)" \
    || blocked "application unit effect reachability is invalid"
  APP_UNIT_EXEC_ENV_PATH="$(app_unit_value execStart.path)" \
    || blocked "application unit env executable is invalid"
  APP_UNIT_EXEC_NODE_PATH="$("$NODE_PATH" -e '
    const value=JSON.parse(process.argv[1]);
    const path=value?.execStart?.argv?.[2];
    if(typeof path!=="string")process.exit(2);
    process.stdout.write(path);
  ' "$APP_UNIT_INITIAL")" \
    || blocked "application unit Node executable is invalid"
  APP_UNIT_EXEC_SHA256="$(app_unit_value execStartSha256)" \
    || blocked "application unit ExecStart digest is invalid"
  APP_UNIT_BINDING_SHA256="$(app_unit_value bindingSha256)" \
    || blocked "application unit binding digest is invalid"
  "$NODE_PATH" -e '
    const value=JSON.parse(process.argv[1]);
    if(value.offlineUnitRoot!==null
      || value.systemdAnalyzePath!==null
      || value.systemdAnalyzeSha256!==null
      || value.systemdAnalyzeEndpointIdentity!==null
      || value.dropInState!=="NONE"
      || value.proofDropInPath!==null
      || value.proofDropInSha256!==null
      || value.proofDropInEndpointIdentity!==null
      || value.proofDropInOwner!=="NONE"
      || value.proofDropInRuntimeLinkPath!==null
      || value.proofDropInRuntimeLinkEndpointIdentity!==null
      || value.proofAbsentSentinel!==null)process.exit(1);
  ' "$APP_UNIT_INITIAL" \
    || blocked "production application unit unexpectedly retains staging proof authority"
fi

GATE_CLOCK_ARGS=()
FIRST_HOST_PROVENANCE_ARGS=(--provenance-mode SYSTEM)
AUTHORIZATION_CLOCK_ARGS=()
RECORDER_CLOCK_ARGS=()
if [ "$SIMULATION" = 1 ]; then
  GATE_CLOCK_ARGS=(
    --simulation-clock
    --simulation-root "$SIMULATION_ROOT"
    --now "$EFFECTIVE_NOW"
  )
  FIRST_HOST_PROVENANCE_ARGS=(
    --provenance-mode TEST
    --provenance-root "$SIMULATION_ROOT"
  )
  AUTHORIZATION_CLOCK_ARGS=(--simulation-clock --now "$EFFECTIVE_NOW")
  RECORDER_CLOCK_ARGS=(--simulation-clock)
fi

FIRST_HOST_DIR=""
FIRST_HOST_DIR_CREATED=0
FIRST_HOST_EVIDENCE_RETAIN=0
EVIDENCE_ROOT_IDENTITY=""
FIRST_HOST_DIR_IDENTITY=""
evidence_root_identity() {
  node --input-type=module - "$1" <<'NODE'
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
const [root] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
if (!root || root === '/' || !isAbsolute(root) || resolve(root) !== root) {
  fail('first-host evidence root must be one non-root canonical absolute path');
}
let stat;
try { stat = lstatSync(root, { bigint: true }); } catch {
  fail('first-host evidence root is unavailable');
}
const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root
    || (stat.mode & 0o7777n) !== 0o700n) {
  fail('first-host evidence root must be one canonical mode-0700 real directory');
}
if (invokingUid !== null && stat.uid !== invokingUid) {
  fail('first-host evidence root owner must be the invoking identity');
}
let cursor = dirname(root);
for (;;) {
  const ancestor = lstatSync(cursor, { bigint: true });
  const mode = ancestor.mode & 0o7777n;
  if (!ancestor.isDirectory() || ancestor.isSymbolicLink()
      || realpathSync(cursor) !== cursor) {
    fail('first-host evidence root has a non-canonical ancestor');
  }
  if (invokingUid !== null && ancestor.uid !== invokingUid && ancestor.uid !== 0n) {
    fail('first-host evidence root has an untrusted ancestor owner');
  }
  if ((mode & 0o022n) !== 0n
      && !(ancestor.uid === 0n && (mode & 0o1000n) !== 0n)) {
    fail('first-host evidence root has an unsafe writable ancestor');
  }
  const parent = dirname(cursor);
  if (parent === cursor) break;
  cursor = parent;
}
process.stdout.write(JSON.stringify({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
}));
NODE
}
evidence_child_identity() {
  node --input-type=module - "$1" "$2" <<'NODE'
import { lstatSync, realpathSync } from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
const [root, input] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
if (!input || !isAbsolute(input) || resolve(input) !== input || dirname(input) !== root
    || !/^first-host-readback\.[A-Za-z0-9]+$/.test(basename(input))) {
  fail('first-host evidence directory must be one canonical direct child of the evidence root');
}
let stat;
try { stat = lstatSync(input, { bigint: true }); } catch {
  fail('first-host evidence directory is unavailable');
}
if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(input) !== input
    || (stat.mode & 0o7777n) !== 0o700n) {
  fail('first-host evidence directory must be one canonical mode-0700 real directory');
}
if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
  fail('first-host evidence directory owner must be the invoking identity');
}
process.stdout.write(JSON.stringify({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
}));
NODE
}
require_evidence_root_binding() {
  [ "$(evidence_root_identity "$EVIDENCE_ROOT")" = "$EVIDENCE_ROOT_IDENTITY" ] \
    || blocked "first-host evidence root identity changed"
}
require_first_host_directory_binding() {
  require_evidence_root_binding
  [ -n "$FIRST_HOST_DIR" ] && [ -n "$FIRST_HOST_DIR_IDENTITY" ] \
    || blocked "first-host evidence directory binding is unavailable"
  [ "$(evidence_child_identity "$EVIDENCE_ROOT" "$FIRST_HOST_DIR")" = "$FIRST_HOST_DIR_IDENTITY" ] \
    || blocked "first-host evidence directory identity changed"
}
cleanup_delegate_env() {
  # A created evidence directory is a fail-closed private reservation. Because
  # Node has no conditional recursive unlink-at primitive, uncertain partials
  # are retained for owner reconciliation instead of deleting by pathname.
  if [ -n "${SANITIZED_DIR:-}" ]; then
    "$GUARD_NODE_PATH" - "$SANITIZED_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const directory = process.argv[2];
let stat;
try {
  stat = fs.lstatSync(directory);
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0);
  throw error;
}
const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
    || (stat.mode & 0o777) !== 0o700 || fs.realpathSync.native(directory) !== directory
    || !/^i00-release-switch\.[A-Za-z0-9_-]+$/u.test(path.basename(directory))) {
  process.exit(1);
}
fs.rmSync(directory, { recursive: true });
NODE
  fi
}
trap cleanup_delegate_env EXIT

SQLITE_INITIAL="$(inspect_sqlite "$SQLITE")"
SQLITE_PATH="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$SQLITE_INITIAL")"
SQLITE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SQLITE_INITIAL")"
SQLITE_VERSION="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version)' "$SQLITE_INITIAL")"
SQLITE_IDENTITY_ENDPOINT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SQLITE_INITIAL")"
node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$SQLITE_VERSION" >/dev/null

FIRST_HOST_EVIDENCE=""
FIRST_HOST_EVIDENCE_SHA256=""
FIRST_HOST_BUNDLE_IDENTITY=""
if [ "$FIRST_HOST" = 1 ]; then
  if [ "$SIMULATION" = 1 ]; then
    [ "$EVIDENCE_ROOT" = "$SIMULATION_ROOT/first-host-evidence" ] \
      || blocked "TEST first-host evidence root must be the canonical marked-root category"
  else
    [ "$EVIDENCE_ROOT" = /var/lib/cosmos-deployment-authorization/first-host-evidence ] \
      || blocked "SYSTEM first-host evidence root must be the canonical deployment-authorization category"
  fi
  # The retained bootstrap bundle must not create the residue it is meant to
  # prove absent. Require one canonical real evidence root disjoint from every
  # sanitized deploy/data/ops path, then exact-create a private child.
  EVIDENCE_ROOT_IDENTITY="$(evidence_root_identity "$EVIDENCE_ROOT")" \
    || blocked "first-host evidence root binding is invalid"
  node --input-type=module - "$EVIDENCE_ROOT" "$DELEGATE_ENV" <<'NODE'
import { readFileSync } from 'node:fs';
const [root, envPath] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
const values = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
  if (!match) fail('sanitized donor env is not canonical');
  values[match[1]] = match[2];
}
const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
for (const key of ['COSMOS_ROOT','RELEASES_DIR','CURRENT_LINK','PREVIOUS_LINK','DATA_DIR','OPS_STATE_DIR']) {
  if (!values[key] || overlap(root, values[key])) fail(`first-host evidence root overlaps sanitized ${key}`);
}
NODE
  if [ "$SIMULATION" = 1 ]; then
    node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$SIMULATION_ROOT" "$EVIDENCE_ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const [modulePath, root, evidence] = process.argv.slice(2);
const safety = await import(pathToFileURL(modulePath));
if (!safety.isWithinSimulationRoot(root, evidence)) {
  process.stderr.write('I00_OPS_BLOCKED: simulation evidence root must be below the marked simulation root\n');
  process.exit(1);
}
NODE
  fi
  require_evidence_root_binding
  if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
    FIRST_HOST_DIR="$(node --input-type=module - \
      "$EVIDENCE_ROOT" "$EVIDENCE_ROOT_IDENTITY" "$SIMULATION" \
      "$SIMULATION_EVIDENCE_ROOT_SWAP_TO" <<'NODE'
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync,
  mkdirSync, openSync, realpathSync, renameSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, join, resolve,
} from 'node:path';
const [root, expectedRaw, simulation, swapTo] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
let expected;
try { expected = JSON.parse(expectedRaw); } catch { fail('first-host evidence root binding is invalid'); }
const identity = (stat) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
if (typeof constants.O_DIRECTORY !== 'number' || typeof constants.O_NOFOLLOW !== 'number') {
  fail('first-host evidence creation lacks no-follow directory support');
}
let parentDescriptor;
let childDescriptor;
try {
  parentDescriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const openedParent = fstatSync(parentDescriptor, { bigint: true });
  const namedParent = lstatSync(root, { bigint: true });
  if (!openedParent.isDirectory() || namedParent.isSymbolicLink()
      || !same(identity(openedParent), expected)
      || !same(identity(namedParent), expected)
      || realpathSync(root) !== root) {
    fail('first-host evidence root changed before child creation');
  }
  let prefix;
  if (process.platform === 'linux') {
    const descriptorRoot = `/proc/self/fd/${parentDescriptor}`;
    if (realpathSync(descriptorRoot) !== root) {
      fail('first-host evidence root descriptor is not the bound directory');
    }
    prefix = `${descriptorRoot}/first-host-readback.`;
  } else {
    if (simulation !== '1') {
      fail('real first-host evidence creation requires Linux descriptor-relative creation');
    }
    prefix = join(root, 'first-host-readback.');
  }
  if (swapTo) {
    if (simulation !== '1' || !isAbsolute(swapTo) || resolve(swapTo) !== swapTo
        || dirname(swapTo) !== dirname(root)
        || !/^[A-Za-z0-9._-]+$/.test(basename(swapTo))) {
      fail('simulation evidence root swap target is invalid');
    }
    try {
      lstatSync(swapTo);
      fail('simulation evidence root swap target already exists');
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) throw error;
    }
    renameSync(root, swapTo);
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
  }
  const created = mkdtempSync(prefix);
  const leaf = basename(created);
  if (!/^first-host-readback\.[A-Za-z0-9]+$/.test(leaf)) {
    fail('first-host evidence child name is invalid');
  }
  const namedChild = join(root, leaf);
  chmodSync(created, 0o700);
  childDescriptor = openSync(
    created,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const openedChild = fstatSync(childDescriptor, { bigint: true });
  const namedChildStat = lstatSync(namedChild, { bigint: true });
  if (!openedChild.isDirectory() || namedChildStat.isSymbolicLink()
      || !same(identity(openedChild), identity(namedChildStat))
      || (openedChild.mode & 0o7777n) !== 0o700n
      || realpathSync(namedChild) !== namedChild) {
    fail('first-host evidence child identity is invalid');
  }
  if (typeof process.getuid === 'function'
      && openedChild.uid !== BigInt(process.getuid())) {
    fail('first-host evidence child owner changed');
  }
  fsyncSync(childDescriptor);
  fsyncSync(parentDescriptor);
  const finalParent = lstatSync(root, { bigint: true });
  if (finalParent.isSymbolicLink() || !same(identity(finalParent), expected)
      || realpathSync(root) !== root) {
    fail('first-host evidence root changed during child creation');
  }
  process.stdout.write(namedChild);
} catch (error) {
  if (error instanceof Error && error.message.startsWith('I00_OPS_BLOCKED:')) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`I00_OPS_BLOCKED: first-host evidence exact-create failed: ${error.message}\n`);
  }
  process.exit(1);
} finally {
  if (childDescriptor !== undefined) {
    try { closeSync(childDescriptor); } catch {}
  }
  if (parentDescriptor !== undefined) {
    try { closeSync(parentDescriptor); } catch {}
  }
}
NODE
)" || blocked "first-host evidence directory exact-create failed"
    FIRST_HOST_DIR_CREATED=1
    FIRST_HOST_DIR_IDENTITY="$(evidence_child_identity "$EVIDENCE_ROOT" "$FIRST_HOST_DIR")" \
      || blocked "created first-host evidence directory binding is invalid"
    require_first_host_directory_binding
    if [ "$SIMULATION" != 1 ]; then
      require_effect_executable_identities
      require_app_unit_binding
    fi
    node "$SCRIPT_DIR/first-host-readback.mjs" \
      --env "$DELEGATE_ENV" --release "$RELEASE" --output-dir "$FIRST_HOST_DIR" \
      --account "$ACCOUNT" --target-host "$TARGET_HOST" --environment "$TARGET_ENVIRONMENT" \
      --backup-reserve-bytes "$BACKUP_RESERVE_BYTES" --sqlite "$SQLITE_PATH" \
      --systemctl "$FIRST_HOST_SYSTEMCTL" --evidence-root "$EVIDENCE_ROOT" \
      "${FIRST_HOST_PROVENANCE_ARGS[@]}" "${GATE_CLOCK_ARGS[@]}" >/dev/null
    if [ "$SIMULATION" != 1 ]; then
      require_effect_executable_identities
      require_app_unit_binding
    fi
  else
    FIRST_HOST_DIR="$FIRST_HOST_EVIDENCE_DIR"
    FIRST_HOST_DIR_IDENTITY="$(evidence_child_identity "$EVIDENCE_ROOT" "$FIRST_HOST_DIR")" \
      || blocked "prepared first-host evidence directory binding is invalid"
    FIRST_HOST_EVIDENCE_RETAIN=1
  fi
  require_first_host_directory_binding
  HOST="$FIRST_HOST_DIR/host.json"
  SUPERVISOR="$FIRST_HOST_DIR/supervisor.json"
  FIRST_HOST_EVIDENCE="$FIRST_HOST_DIR/collected-evidence.json"
  PRODUCER_SQLITE="$FIRST_HOST_DIR/sqlite-readback.json"
  FIRST_HOST_EVIDENCE_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_EVIDENCE")"
  FIRST_HOST_READBACK_SYSTEMCTL_PATH="$(node -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const path=value?.baseline?.unit?.systemctlPath;
    if(typeof path!=="string"||path.length===0)process.exit(2);
    process.stdout.write(path);
  ' "$FIRST_HOST_EVIDENCE")" \
    || blocked "first-host evidence has no exact readback systemctl path"
  if [ "$SIMULATION" = 1 ]; then
    [ "$(validate_simulation_executable "$SIMULATION_ROOT" "$FIRST_HOST_READBACK_SYSTEMCTL_PATH")" \
        = "$FIRST_HOST_READBACK_SYSTEMCTL_PATH" ] \
      || blocked "first-host readback systemctl escaped the simulation root"
  else
    [ "$FIRST_HOST_READBACK_SYSTEMCTL_PATH" = "$SYSTEMCTL_PATH" ] \
      || blocked "production first-host readback used a different systemctl executable"
  fi
  FIRST_HOST_READBACK_SYSTEMCTL_INITIAL="$(
    node "$SCRIPT_DIR/inspect-executable.mjs" --path "$FIRST_HOST_READBACK_SYSTEMCTL_PATH"
  )"
  FIRST_HOST_READBACK_SYSTEMCTL_SHA256="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' \
      "$FIRST_HOST_READBACK_SYSTEMCTL_INITIAL"
  )"
  FIRST_HOST_READBACK_SYSTEMCTL_IDENTITY="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' \
      "$FIRST_HOST_READBACK_SYSTEMCTL_INITIAL"
  )"
  node - "$SQLITE_INITIAL" "$FIRST_HOST_READBACK_SYSTEMCTL_INITIAL" "$HOST" "$PRODUCER_SQLITE" \
    "$FIRST_HOST_EVIDENCE" "$FIRST_HOST_EVIDENCE_SHA256" \
    "$ACCOUNT" "$TARGET_HOST" "$TARGET_ENVIRONMENT" "$BACKUP_RESERVE_BYTES" <<'NODE'
const fs = require('fs');
const expected = JSON.parse(process.argv[2]);
const expectedSystemctl = JSON.parse(process.argv[3]);
const host = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const producer = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
const evidence = JSON.parse(fs.readFileSync(process.argv[6], 'utf8'));
const evidenceSha = process.argv[7];
const expectedOwner = {
  account: process.argv[8],
  targetHost: process.argv[9],
  environment: process.argv[10],
  backupReserveBytes: Number(process.argv[11]),
};
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(`${label} key set is not exact`);
};
exactKeys(producer, ['schemaVersion','source','observedAtUtc','path','sha256','version','identity'], 'producer SQLite readback');
exactKeys(producer.identity, ['device','inode','mode','size','mtimeNs','ctimeNs'], 'producer SQLite identity');
exactKeys(evidence.baseline.unit, [
  'systemctlPath','systemctlSha256','systemctlIdentity','unit','state','exitCode',
], 'producer systemctl readback');
exactKeys(evidence.baseline.unit.systemctlIdentity, [
  'device','inode','mode','size','mtimeNs','ctimeNs',
], 'producer systemctl identity');
if (producer.schemaVersion !== 1 || producer.source !== 'PINNED_SQLITE_EXECUTABLE_READBACK'
    || producer.observedAtUtc !== host.observedAtUtc) fail('producer SQLite source or observation time is invalid');
if (host.sqliteVersion !== expected.version) fail('first-host host JSON SQLite version differs from live wrapper readback');
if (host.evidenceSha256 !== evidenceSha) fail('first-host host JSON does not bind the retained collected evidence bytes');
if (host.account !== expectedOwner.account || host.targetHost !== expectedOwner.targetHost
    || host.environment !== expectedOwner.environment
    || host.backupReserveBytes !== expectedOwner.backupReserveBytes) {
  fail('prepared first-host evidence owner inputs differ from the switch request');
}
for (const key of ['path', 'sha256', 'version']) if (producer[key] !== expected[key]) fail(`producer SQLite ${key} differs from wrapper readback`);
if (JSON.stringify(producer.identity) !== JSON.stringify(expected.identity)) fail('producer SQLite identity differs from wrapper readback');
if (evidence.baseline.unit.systemctlPath !== expectedSystemctl.path
    || evidence.baseline.unit.systemctlSha256 !== expectedSystemctl.sha256
    || JSON.stringify(evidence.baseline.unit.systemctlIdentity)
      !== JSON.stringify(expectedSystemctl.identity)) {
  fail('producer systemctl identity differs from wrapper readback');
}
NODE
  FIRST_HOST_BUNDLE_IDENTITY="$(node - "$FIRST_HOST_DIR" <<'NODE'
const fs=require('fs'),c=require('crypto'),p=require('path');
const dir=process.argv[2], names=['collected-evidence.json','host.json','sqlite-readback.json','supervisor.json'];
const entries=fs.readdirSync(dir).sort();
if (JSON.stringify(entries)!==JSON.stringify(names)) { process.stderr.write('I00_OPS_BLOCKED: first-host bundle field set changed\n'); process.exit(1); }
const result={};
for (const name of names) {
  const file=p.join(dir,name), stat=fs.lstatSync(file,{bigint:true});
  if (stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777n)!==0o600n||fs.realpathSync(file)!==file) {
    process.stderr.write(`I00_OPS_BLOCKED: first-host bundle ${name} is not a canonical mode-0600 file\n`); process.exit(1);
  }
  result[name]={sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),device:stat.dev.toString(),inode:stat.ino.toString(),size:stat.size.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()};
}
process.stdout.write(JSON.stringify(result));
NODE
)"
  require_first_host_directory_binding
else
  node - "$HOST" "$SQLITE_VERSION" <<'NODE'
const fs = require('fs');
const host = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (host.sqliteVersion !== process.argv[3]) {
  process.stderr.write('I00_OPS_BLOCKED: claimed host SQLite version does not equal the normalized live SQLite version\n');
  process.exit(1);
}
NODE
fi

if [ "$FIRST_HOST" != 1 ]; then
  TARGET_HOST="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.targetHost)' "$HOST")"
  TARGET_ENVIRONMENT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.environment)' "$HOST")"
  ACCOUNT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.account)' "$HOST")"
  BACKUP_RESERVE_BYTES="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(v.backupReserveBytes))' "$HOST")"
fi

DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
if [ "$PREPARE_FIRST_HOST_EVIDENCE" = 1 ]; then
  require_first_host_directory_binding
  node "$SCRIPT_DIR/preflight.mjs" \
    --release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" --mode deploy \
    --max-host-age-sec 300 --max-supervisor-age-sec 300 \
    --required-supervisor-window-sec 300 --recovery-target "$FIRST_HOST_SENTINEL" \
    --first-host-evidence "$FIRST_HOST_EVIDENCE" --donor-env "$DELEGATE_ENV" \
    --systemctl-path "$FIRST_HOST_READBACK_SYSTEMCTL_PATH" \
    --systemctl-sha256 "$FIRST_HOST_READBACK_SYSTEMCTL_SHA256" \
    --systemctl-identity "$FIRST_HOST_READBACK_SYSTEMCTL_IDENTITY" \
    "${GATE_CLOCK_ARGS[@]}" >/dev/null
  SQLITE_FINAL="$(inspect_sqlite "$SQLITE_PATH")"
  [ "$SQLITE_FINAL" = "$SQLITE_INITIAL" ] \
    || blocked "SQLite executable identity changed during first-host evidence preparation"
  [ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
    || blocked "sanitized donor env changed during first-host evidence preparation"
  [ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_EVIDENCE")" = "$FIRST_HOST_EVIDENCE_SHA256" ] \
    || blocked "first-host evidence changed during preparation validation"
  [ "$(node - "$FIRST_HOST_DIR" <<'NODE'
const fs=require('fs'),c=require('crypto'),p=require('path');
const dir=process.argv[2], names=['collected-evidence.json','host.json','sqlite-readback.json','supervisor.json'], result={};
if (JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(names)) process.exit(1);
for (const name of names) { const file=p.join(dir,name),stat=fs.lstatSync(file,{bigint:true}); if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777n)!==0o600n||fs.realpathSync(file)!==file) process.exit(1); result[name]={sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),device:stat.dev.toString(),inode:stat.ino.toString(),size:stat.size.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()}; }
process.stdout.write(JSON.stringify(result));
NODE
)" = "$FIRST_HOST_BUNDLE_IDENTITY" ] || blocked "prepared first-host evidence bundle changed during validation"
  require_first_host_directory_binding
  FIRST_HOST_EVIDENCE_RETAIN=1
  node - "$FIRST_HOST_DIR" "$FIRST_HOST_EVIDENCE_SHA256" <<'NODE'
const [evidenceDir, firstHostEvidenceSha256] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  status: 'FIRST_HOST_EVIDENCE_PREPARED',
  evidenceDir,
  firstHostEvidenceSha256,
})}\n`);
NODE
  cleanup_delegate_env
  trap - EXIT
  exit 0
fi

AUTHORIZATION_IDENTITY=""
AUTHORIZATION_SHA256=""
DEPLOYMENT_RISK_IDENTITY=""
ACTION_PREVIEW_IDENTITY=""
AUTHORIZATION_CONSUMPTION=""
AUTHORIZATION_CONSUMPTION_IDENTITY=""
if [ "$PREPARE_FIRST_HOST_EVIDENCE" != 1 ]; then
  MANIFEST_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE/artifact-manifest.json")"
  AUTHORIZATION_IDENTITY="$(capture_evidence_identity "$AUTHORIZATION" authorization)"
  DEPLOYMENT_RISK_IDENTITY="$(capture_evidence_identity "$DEPLOYMENT_RISK" deployment-risk)"
  ACTION_PREVIEW_IDENTITY="$(capture_evidence_identity "$ACTION_PREVIEW" action-preview)"
  AUTH_BASE=(--input "$AUTHORIZATION" --class SERVICE_RELEASE_SWITCH --command release-switch --expected-operator "$OPERATOR" --expected-deployed-sha "$CANDIDATE_SHA" --expected-config-version "$CONFIG_VERSION" --deployment-risk "$DEPLOYMENT_RISK" --action-preview "$ACTION_PREVIEW" --consumption-root "$AUTHORIZATION_CONSUMPTION_ROOT" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-release-switch --expected-account "$ACCOUNT" --expected-product "Cosmos I00 immutable release" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission systemd:RestartExactCosmosAppUnit --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "install one exact immutable release and restart one exact application unit")
  AUTH_BASE+=("${AUTHORIZATION_CLOCK_ARGS[@]}")
  AUTH_ENDPOINTS=()
  AUTH_ENDPOINT_LINES="$("$GUARD_NODE_PATH" -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(!value.action||!Array.isArray(value.action.allowedEndpoints)
        ||value.action.allowedEndpoints.length===0)process.exit(2);
    for(const endpoint of value.action.allowedEndpoints)console.log(endpoint);
  ' "$ACTION_PREVIEW")" \
    || blocked "action preview endpoints could not be read"
  [ -n "$AUTH_ENDPOINT_LINES" ] \
    || blocked "action preview contains no endpoints"
  while IFS= read -r endpoint; do
    [ -n "$endpoint" ] || blocked "action preview contains an empty endpoint"
    AUTH_ENDPOINTS+=(--expected-endpoint "$endpoint")
  done <<< "$AUTH_ENDPOINT_LINES"
  unset AUTH_ENDPOINT_LINES
  AUTHORIZATION_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$AUTHORIZATION_IDENTITY")"
  DEPLOYMENT_RISK_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$DEPLOYMENT_RISK_IDENTITY")"
  ACTION_PREVIEW_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$ACTION_PREVIEW_IDENTITY")"
  AUTHORIZATION_ID="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).authorizationId)' "$AUTHORIZATION")"
  RISK_VERSION="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).riskVersion)' "$DEPLOYMENT_RISK")"
  SERVER_PREVIEW_DIGEST="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).serverPreviewDigest)' "$ACTION_PREVIEW")"
fi

if [ "$FIRST_HOST" = 1 ]; then
  require_first_host_directory_binding
  PREFLIGHT_ARGS=(--release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" --mode deploy --max-host-age-sec 300 --max-supervisor-age-sec 300 --required-supervisor-window-sec 300)
  PREFLIGHT_ARGS+=(--recovery-target "$FIRST_HOST_SENTINEL" --first-host-evidence "$FIRST_HOST_EVIDENCE" --donor-env "$DELEGATE_ENV")
  PREFLIGHT_ARGS+=(
    --systemctl-path "$FIRST_HOST_READBACK_SYSTEMCTL_PATH"
    --systemctl-sha256 "$FIRST_HOST_READBACK_SYSTEMCTL_SHA256"
    --systemctl-identity "$FIRST_HOST_READBACK_SYSTEMCTL_IDENTITY"
  )
else
  PREFLIGHT_ARGS=(--release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" --mode deploy --max-host-age-sec 120 --max-supervisor-age-sec 30 --required-supervisor-window-sec 300)
fi
PREFLIGHT_ARGS+=("${GATE_CLOCK_ARGS[@]}")
node "$SCRIPT_DIR/preflight.mjs" "${PREFLIGHT_ARGS[@]}" >/dev/null

SQLITE_FINAL="$(inspect_sqlite "$SQLITE_PATH")"
[ "$SQLITE_FINAL" = "$SQLITE_INITIAL" ] || blocked "SQLite executable identity changed after preflight"
[ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
  || blocked "sanitized donor env changed after validation"
if [ "$FIRST_HOST" = 1 ]; then
  [ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_EVIDENCE")" = "$FIRST_HOST_EVIDENCE_SHA256" ] \
    || blocked "first-host evidence changed after preflight"
  [ "$(node - "$FIRST_HOST_DIR" <<'NODE'
const fs=require('fs'),c=require('crypto'),p=require('path');
const dir=process.argv[2], names=['collected-evidence.json','host.json','sqlite-readback.json','supervisor.json'], result={};
if (JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(names)) process.exit(1);
for (const name of names) { const file=p.join(dir,name),stat=fs.lstatSync(file,{bigint:true}); if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777n)!==0o600n||fs.realpathSync(file)!==file) process.exit(1); result[name]={sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),device:stat.dev.toString(),inode:stat.ino.toString(),size:stat.size.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()}; }
process.stdout.write(JSON.stringify(result));
NODE
)" = "$FIRST_HOST_BUNDLE_IDENTITY" ] || blocked "prepared first-host evidence bundle changed after preflight"
  require_first_host_directory_binding
fi
if [ "$PREPARE_FIRST_HOST_EVIDENCE" != 1 ]; then
  [ "$(capture_evidence_identity "$AUTHORIZATION" authorization)" = "$AUTHORIZATION_IDENTITY" ] \
    || blocked "authorization changed before donor delegation"
  [ "$(capture_evidence_identity "$DEPLOYMENT_RISK" deployment-risk)" = "$DEPLOYMENT_RISK_IDENTITY" ] \
    || blocked "deployment risk changed before donor delegation"
  [ "$(capture_evidence_identity "$ACTION_PREVIEW" action-preview)" = "$ACTION_PREVIEW_IDENTITY" ] \
    || blocked "action preview changed before donor delegation"
  if [ "$SIMULATION" != 1 ]; then
    require_effect_executable_identities
    require_app_unit_binding
  fi
fi
if [ "$SIMULATION" = 1 ]; then
  # Revalidate every sealed effect command at the last possible wrapper point.
  SYSTEMCTL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SYSTEMCTL")"
  CURL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$CURL")"
  SIMULATION_PROBE="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_PROBE")"
fi
if [ "$FIRST_HOST" = 1 ]; then
  require_first_host_directory_binding
fi

if [ "$SIMULATION" = 1 ]; then
  NODE_BIN="$SIMULATION_NODE_PATH"
else
  NODE_BIN="$NODE_PATH"
fi

"$NODE_BIN" -e 'process.exit(process.platform === "linux" ? 0 : 1)' \
  || blocked "authorized effects require Linux before authorization consumption"

# The single-use claim is consumed only after every independent pre-effect
# check. Only extraction of validator-returned paths occurs before the bound
# runner.
AUTHORIZATION_VALIDATION="$("$NODE_BIN" "$SCRIPT_DIR/validate-authorization.mjs" \
  "${AUTH_BASE[@]}" "${AUTH_ENDPOINTS[@]}")"
AUTHORIZATION_CONSUMPTION="$("$NODE_BIN" -e '
  const value=JSON.parse(process.argv[1]);
  if(value.status!=="AUTHORIZATION_VALID"||value.consumptionStatus!=="AUTHORIZATION_CONSUMED"
    ||typeof value.authorizationConsumptionPath!=="string")process.exit(2);
  process.stdout.write(value.authorizationConsumptionPath);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return one consumption receipt"
EFFECT_START_EVIDENCE="$("$NODE_BIN" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectStartEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectStartEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return effect start evidence"
EFFECT_FINISH_EVIDENCE="$("$NODE_BIN" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectTerminalEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectTerminalEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return effect terminal evidence"

set +e
"$NODE_BIN" "$SCRIPT_DIR/run-bound-effect.mjs" \
  --authorization "$AUTHORIZATION" \
  --deployment-risk "$DEPLOYMENT_RISK" \
  --action-preview "$ACTION_PREVIEW" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  -- "$DONOR_ROOT/bin/deploy.sh" \
  --i00-effect-environment "$DELEGATE_ENV"
RESULT=$?
set -e
if [ "$PREPARE_FIRST_HOST_EVIDENCE" != 1 ]; then
  EFFECT_RESULT="$RESULT"
  RECEIPT_ARGS=(
    --output "$RESULT_RECEIPT"
    --reconciliation-output "$RECONCILIATION_RECEIPT"
    --release "$RELEASE"
    --env "$DELEGATE_ENV"
    --authorization "$AUTHORIZATION"
    --deployment-risk "$DEPLOYMENT_RISK"
    --action-preview "$ACTION_PREVIEW"
    --authorization-consumption "$AUTHORIZATION_CONSUMPTION"
    --authorization-sha256 "$AUTHORIZATION_SHA256"
    --artifact-manifest-sha256 "$MANIFEST_SHA"
    --systemctl "$SYSTEMCTL_PATH"
    --curl "$CURL_PATH"
    --donor-exit-code "$RESULT"
    --effect-start-evidence "$EFFECT_START_EVIDENCE"
    --effect-finish-evidence "$EFFECT_FINISH_EVIDENCE"
  )
  RECEIPT_ARGS+=("${RECORDER_CLOCK_ARGS[@]}")
  if [ "$FIRST_HOST" = 1 ]; then
    RECEIPT_ARGS+=(
      --recovery-target "$FIRST_HOST_SENTINEL"
      --first-host-evidence-sha256 "$FIRST_HOST_EVIDENCE_SHA256"
    )
  fi
  set +e
  "$NODE_BIN" "$SCRIPT_DIR/record-release-switch-receipt.mjs" \
    "${RECEIPT_ARGS[@]}" >/dev/null
  RECORDER_RESULT=$?
  set -e
  RESULT="$EFFECT_RESULT"
  [ "$RECORDER_RESULT" = 0 ] || RESULT=1
fi

if [ "$FIRST_HOST" = 1 ]; then
  require_first_host_directory_binding
fi
if [ "$PREPARE_FIRST_HOST_EVIDENCE" != 1 ]; then
  AUTHORIZATION_CONSUMPTION_IDENTITY="$(
    capture_evidence_identity "$AUTHORIZATION_CONSUMPTION" authorization-consumption
  )"
  AUTHORIZATION_CONSUMPTION_SHA256="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' \
      "$AUTHORIZATION_CONSUMPTION_IDENTITY"
  )"
  AUTHORIZATION_CLAIM_KEY="$(
    node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).claimKey)' \
      "$AUTHORIZATION_CONSUMPTION"
  )"
  if [ "$SIMULATION" != 1 ]; then
    require_effect_executable_identities
    require_app_unit_binding
  fi
  [ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
    || blocked "sanitized donor env changed during release-switch effect"
  [ "$(capture_evidence_identity "$AUTHORIZATION" authorization)" = "$AUTHORIZATION_IDENTITY" ] \
    || blocked "authorization changed during release-switch effect"
  [ "$(capture_evidence_identity "$DEPLOYMENT_RISK" deployment-risk)" = "$DEPLOYMENT_RISK_IDENTITY" ] \
    || blocked "deployment risk changed during release-switch effect"
  [ "$(capture_evidence_identity "$ACTION_PREVIEW" action-preview)" = "$ACTION_PREVIEW_IDENTITY" ] \
    || blocked "action preview changed during release-switch effect"
  [ "$(capture_evidence_identity "$AUTHORIZATION_CONSUMPTION" authorization-consumption)" = "$AUTHORIZATION_CONSUMPTION_IDENTITY" ] \
    || blocked "authorization consumption changed during release-switch effect"
  VALIDATE_RECEIPT_ARGS=(
    --input "$RESULT_RECEIPT"
    --kind RELEASE_SWITCH
    --expected-sha "$CANDIDATE_SHA"
    --expected-artifact-manifest-sha256 "$MANIFEST_SHA"
    --reconciliation "$RECONCILIATION_RECEIPT"
    --expected-authorization-id "$AUTHORIZATION_ID"
    --expected-authorization-sha256 "$AUTHORIZATION_SHA256"
    --expected-risk-version "$RISK_VERSION"
    --expected-risk-document-sha256 "$DEPLOYMENT_RISK_SHA256"
    --expected-server-preview-digest "$SERVER_PREVIEW_DIGEST"
    --expected-preview-document-sha256 "$ACTION_PREVIEW_SHA256"
    --expected-authorization-consumption-sha256 "$AUTHORIZATION_CONSUMPTION_SHA256"
    --expected-authorization-claim-key "$AUTHORIZATION_CLAIM_KEY"
  )
  if [ "$FIRST_HOST" = 1 ]; then
    VALIDATE_RECEIPT_ARGS+=(
      --expected-recovery-target "$FIRST_HOST_SENTINEL"
      --expected-first-host-evidence-sha256 "$FIRST_HOST_EVIDENCE_SHA256"
    )
  fi
  if [ "$EFFECT_RESULT" = 0 ] && [ "$RECORDER_RESULT" = 0 ]; then
    "$NODE_BIN" "$SCRIPT_DIR/validate-receipt.mjs" \
      "${VALIDATE_RECEIPT_ARGS[@]}" >/dev/null || RESULT=1
  fi
fi
cleanup_delegate_env
trap - EXIT
exit "$RESULT"
