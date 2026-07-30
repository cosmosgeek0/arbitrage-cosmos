#!/bin/bash -p
# I00 adapter: enforce final rollback preflight, then delegate to L15 rollback.
set -euo pipefail
umask 077

unset BASH_ENV ENV CDPATH GLOBIGNORE I00_EFFECT_CLASS NODE_OPTIONS NODE_PATH \
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
  *) printf 'I00_OPS_BLOCKED: rollback-switch requires an explicit script path\n' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: rollback-switch script directory is unavailable\n' >&2; exit 1; }
unset _I00_ENTRY_DIR
I00_ROOT="$(cd -P -- "$SCRIPT_DIR/.." && builtin pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"

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

RELEASE="" ENV_FILE="" RUNTIME_ENV="" HOST="" SUPERVISOR="" AUTHORIZATION="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" EVIDENCE_ROOT="" NOW="" SIMULATION_ROOT="" SIMULATION=0 FINALIZE_ONLY=0
PROVENANCE_MODE="" PROVENANCE_ROOT=""
OPERATOR="" CONFIG_VERSION="" DEPLOYMENT_RISK="" ACTION_PREVIEW="" AUTHORIZATION_CONSUMPTION_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --runtime-env) RUNTIME_ENV="${2:?--runtime-env needs a value}"; shift 2 ;;
    --host) HOST="${2:?--host needs a value}"; shift 2 ;;
    --supervisor) SUPERVISOR="${2:?--supervisor needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --operator) OPERATOR="${2:?--operator needs a value}"; shift 2 ;;
    --config-version) CONFIG_VERSION="${2:?--config-version needs a value}"; shift 2 ;;
    --deployment-risk) DEPLOYMENT_RISK="${2:?--deployment-risk needs a value}"; shift 2 ;;
    --action-preview) ACTION_PREVIEW="${2:?--action-preview needs a value}"; shift 2 ;;
    --authorization-consumption-root) AUTHORIZATION_CONSUMPTION_ROOT="${2:?--authorization-consumption-root needs a value}"; shift 2 ;;
    --result-receipt) RESULT_RECEIPT="${2:?--result-receipt needs a value}"; shift 2 ;;
    --reconciliation-receipt) RECONCILIATION_RECEIPT="${2:?--reconciliation-receipt needs a value}"; shift 2 ;;
    --evidence-root) EVIDENCE_ROOT="${2:?--evidence-root needs a value}"; shift 2 ;;
    --now) NOW="${2:?--now needs a value}"; shift 2 ;;
    --simulation-root) SIMULATION_ROOT="${2:?--simulation-root needs a value}"; shift 2 ;;
    --provenance-mode) PROVENANCE_MODE="${2:?--provenance-mode needs a value}"; shift 2 ;;
    --provenance-root) PROVENANCE_ROOT="${2:?--provenance-root needs a value}"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    --finalize-only) FINALIZE_ONLY=1; shift ;;
    *) printf 'I00_OPS_BLOCKED: unknown argument %s\n' "$1" >&2; exit 1 ;;
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
    blocked "rollback-switch wrapper forbids STAGING effects and receipt publication"
    ;;
  *) blocked "--provenance-mode must be SYSTEM or TEST for rollback-switch" ;;
esac
[ -n "$RELEASE" ] && [ -n "$ENV_FILE" ] \
  && [ -n "$AUTHORIZATION" ] && [ -n "$DEPLOYMENT_RISK" ] \
  && [ -n "$ACTION_PREVIEW" ] && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] \
  && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
  && [ -n "$EVIDENCE_ROOT" ] \
  || blocked "rollback requires the exact release, deploy env, four-document authorization chain, receipt targets, and evidence root"
[ -n "$RUNTIME_ENV" ] \
  || blocked "rollback requires the exact runtime environment binding"
if [ "$FINALIZE_ONLY" != 1 ]; then
  [ -n "$HOST" ] && [ -n "$SUPERVISOR" ] && [ -n "$OPERATOR" ] \
    && [ -n "$CONFIG_VERSION" ] \
    || blocked "initial rollback requires host, supervisor, operator, and revision inputs"
fi
[ -x "$DONOR_ROOT/bin/rollback.sh" ] || { printf 'I00_OPS_BLOCKED: effective L15 rollback.sh is unavailable\n' >&2; exit 1; }
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

preview_endpoint() {
  "$GUARD_NODE_PATH" - "$ACTION_PREVIEW" "$1" <<'NODE'
const fs = require('fs');
const [input, prefix] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(input, 'utf8'));
const marker = `${prefix}:`;
const matches = value?.action?.allowedEndpoints
  ?.filter((entry) => typeof entry === 'string' && entry.startsWith(marker)) ?? [];
if (matches.length !== 1 || matches[0].length === marker.length) process.exit(2);
process.stdout.write(matches[0].slice(marker.length));
NODE
}

if [ "$SIMULATION" = 1 ]; then
  NODE_PATH="$(preview_endpoint node-path)" \
    || blocked "TEST action preview has no exact Node path"
  BASH_PATH="$(preview_endpoint bash-path)" \
    || blocked "TEST action preview has no exact Bash path"
  ENV_PATH="$(preview_endpoint env-path)" \
    || blocked "TEST action preview has no exact env path"
  SYSTEMCTL_PATH="$(preview_endpoint systemctl-path)" \
    || blocked "TEST action preview has no exact systemctl path"
  CURL_PATH="$(preview_endpoint curl-path)" \
    || blocked "TEST action preview has no exact curl path"
  for effect_command in \
    "$NODE_PATH" "$BASH_PATH" "$ENV_PATH" "$SYSTEMCTL_PATH" "$CURL_PATH"; do
    "$GUARD_NODE_PATH" "$SCRIPT_DIR/verify-simulation-command.mjs" \
      --root "$SIMULATION_ROOT" --command "$effect_command" >/dev/null \
      || blocked "TEST action preview command is outside the marked root"
  done
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" \
    --path "$NODE_PATH" >/dev/null \
    || blocked "TEST action-bound Node executable is unavailable"
fi

node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
DONOR_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DONOR_ROOT")"
[ -x "$DONOR_ROOT/bin/rollback.sh" ] || blocked "canonical effective L15 rollback.sh is unavailable"
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
RELEASE_CANONICAL="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$RELEASE")"
if [ "$SIMULATION" != 1 ]; then
  [ "$RELEASE" = "$RELEASE_CANONICAL" ] \
    || blocked "--release must name the exact canonical installed release path"
fi
RELEASE="$RELEASE_CANONICAL"
CANDIDATE_SHA="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.testedSha)' "$RELEASE/release.json")"
if [ "$SIMULATION" = 1 ]; then
  node "$SCRIPT_DIR/validate-config.mjs" --env "$RUNTIME_ENV" --expected-sha "$CANDIDATE_SHA" >/dev/null
fi
if [ "$SIMULATION" = 1 ]; then
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --allow-simulation \
    --require-recovery-target-cohort >/dev/null
else
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --installed-immutable \
    --require-recovery-target-cohort \
    --trusted-build-public-key "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}" >/dev/null
fi
if [ "$FINALIZE_ONLY" != 1 ]; then
  node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.sqliteVersion)' "$HOST")" >/dev/null
fi

require_effect_executable_identities() {
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$NODE_PATH")" = "$NODE_INITIAL" ] \
    || blocked "Node executable identity changed around rollback effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$BASH_PATH")" = "$BASH_INITIAL" ] \
    || blocked "Bash executable identity changed around rollback effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$SYSTEMCTL_PATH")" = "$SYSTEMCTL_INITIAL" ] \
    || blocked "systemctl executable identity changed around rollback effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$CURL_PATH")" = "$CURL_INITIAL" ] \
    || blocked "curl executable identity changed around rollback effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$ENV_PATH")" = "$ENV_INITIAL" ] \
    || blocked "env executable identity changed around rollback effect"
  [ "$("$NODE_PATH" "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
      --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
      --root "$DONOR_ROOT" --require-immutable)" = "$EFFECTIVE_DONOR_VERIFICATION_INITIAL" ] \
    || blocked "effective donor tree changed around rollback effect"
  [ "$(donor_root_identity)" = "$EFFECTIVE_DONOR_IDENTITY_ENDPOINT" ] \
    || blocked "effective donor root identity changed around rollback effect"
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
    || blocked "application unit binding changed around rollback effect"
}

cleanup_delegate_env() {
  local cleanup_rc=0
  "$GUARD_NODE_PATH" - "${DELEGATE_ENV:-}" "${SANITIZED_DIR:-}" \
    "${SIMULATION_ROOT:-}" <<'NODE' || cleanup_rc=1
const fs = require('fs');
const path = require('path');
const [envFile, privateDir, simulationRoot] = process.argv.slice(2);
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const removeBoundFile = (file) => {
  if (!file) return;
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const expectedParent = privateDir || (simulationRoot
    ? path.join(simulationRoot, 'sanitized')
    : '');
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o600 || (uid !== null && stat.uid !== uid)
      || fs.realpathSync.native(file) !== file || path.dirname(file) !== expectedParent
      || path.basename(file) !== 'deploy.env') {
    process.exit(1);
  }
  fs.rmSync(file);
};
removeBoundFile(envFile);
if (privateDir) {
  let stat;
  try {
    stat = fs.lstatSync(privateDir);
  } catch (error) {
    if (error?.code === 'ENOENT') process.exit(0);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || (stat.mode & 0o777) !== 0o700 || (uid !== null && stat.uid !== uid)
      || fs.realpathSync.native(privateDir) !== privateDir
      || !/^i00-rollback-switch\.[A-Za-z0-9_-]+$/u.test(path.basename(privateDir))
      || fs.readdirSync(privateDir).length !== 0) {
    process.exit(1);
  }
  fs.rmdirSync(privateDir);
}
NODE
  return "$cleanup_rc"
}

if [ "$SIMULATION" = 1 ]; then
  [ -n "$NOW" ] && [ -n "$SIMULATION_ROOT" ] \
    || blocked "TEST rollback requires --now and --simulation-root"
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/validate-simulation-root.mjs" \
    --root "$SIMULATION_ROOT" >/dev/null
  SIMULATION_PATH_VALIDATION_ENV="$SIMULATION_ROOT/rollback-path-validation.env"
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/validate-simulation-env.mjs" \
    --env "$ENV_FILE" --root "$SIMULATION_ROOT" \
    --output "$SIMULATION_PATH_VALIDATION_ENV" >/dev/null \
    || blocked "TEST rollback deploy paths are outside the marked root"
  "$GUARD_NODE_PATH" - "$SIMULATION_ROOT" "$SIMULATION_PATH_VALIDATION_ENV" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, file] = process.argv.slice(2);
const stat = fs.lstatSync(file);
const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== uid || (stat.mode & 0o777) !== 0o600
    || path.dirname(file) !== root
    || path.basename(file) !== 'rollback-path-validation.env'
    || fs.realpathSync.native(file) !== file) process.exit(1);
fs.rmSync(file);
NODE
  "$GUARD_NODE_PATH" - "$SIMULATION_ROOT/sanitized" <<'NODE'
const fs = require('fs');
const directory = process.argv[2];
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
let stat = fs.lstatSync(directory, { throwIfNoEntry: false });
if (stat === undefined) {
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  stat = fs.lstatSync(directory);
}
if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(directory) !== directory
    || (stat.mode & 0o777) !== 0o700
    || (uid !== null && stat.uid !== uid)
    || fs.readdirSync(directory).length !== 0) process.exit(1);
NODE
  DELEGATE_ENV="$SIMULATION_ROOT/sanitized/deploy.env"
  trap 'cleanup_delegate_env || :' EXIT
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy \
    --provenance-mode TEST --provenance-root "$SIMULATION_ROOT" \
    --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
    --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
    --require-effect-bindings >/dev/null
  EFFECTIVE_NOW="$NOW"
else
  [ -n "$AUTHORIZATION" ] && [ -n "$DEPLOYMENT_RISK" ] \
    && [ -n "$ACTION_PREVIEW" ] && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] \
    && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
    && [ -n "$EVIDENCE_ROOT" ] \
    || { printf 'I00_OPS_BLOCKED: real rollback requires authorization, producer evidence, consumption root, and exact receipt targets\n' >&2; exit 1; }
  if [ "$FINALIZE_ONLY" != 1 ]; then
    [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] \
      || blocked "initial real rollback requires independent operator and revision"
  fi
  [ -z "$NOW" ] || { printf 'I00_OPS_BLOCKED: real rollback does not accept a caller clock\n' >&2; exit 1; }
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
  EFFECTIVE_NOW="$("$NODE_PATH" -e '
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    process.stdout.write(now.toISOString().replace(".000Z", "Z"));
  ')"
  MANIFEST_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE/artifact-manifest.json")"
  TRUSTED_BUILD_KEY_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}")"
  SANITIZED_DIR="$("$NODE_PATH" "$SCRIPT_DIR/create-private-temp.mjs" --prefix i00-rollback-switch.)"
  DELEGATE_ENV="$SANITIZED_DIR/deploy.env"
  trap 'cleanup_delegate_env || :' EXIT
  "$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs" \
    --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy --provenance-mode SYSTEM \
    --node "$NODE_PATH" --bash "$BASH_PATH" --env-bin "$ENV_PATH" \
    --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
    --require-effect-bindings >/dev/null
  sanitized_value() {
    "$NODE_PATH" -e '
    const fs=require("fs");
    const key=process.argv[2];
    const line=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).find((entry)=>entry.startsWith(`${key}=`));
    const quote=String.fromCharCode(39), prefix=`${key}=${quote}`;
    if(!line?.startsWith(prefix)||!line.endsWith(quote)||line.length<=prefix.length+1)process.exit(2);
    process.stdout.write(line.slice(prefix.length,-1));
  ' "$DELEGATE_ENV" "$1"
  }
  DATA_DIR_ENDPOINT="$(sanitized_value DATA_DIR)" \
    || blocked "sanitized donor env has no exact DATA_DIR"
  RELEASES_DIR_ENDPOINT="$(sanitized_value RELEASES_DIR)" \
    || blocked "sanitized donor env has no exact RELEASES_DIR"
  CURRENT_LINK_ENDPOINT="$(sanitized_value CURRENT_LINK)" \
    || blocked "sanitized donor env has no exact CURRENT_LINK"
  SANITIZED_ENV_PATH="$(sanitized_value I00_ENV)" \
    || blocked "sanitized donor env has no exact I00_ENV"
  [ "$SANITIZED_ENV_PATH" = "$ENV_PATH" ] \
    || blocked "sanitized env executable binding changed"
  APP_UNIT_ENDPOINT="$(sanitized_value APP_UNIT)" \
    || blocked "sanitized donor env has no exact APP_UNIT"
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
  DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
  TARGET_ID="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.releaseId)' "$RELEASE/release.json")"
  [ "$RELEASE" = "$RELEASES_DIR_ENDPOINT/$TARGET_ID" ] \
    || blocked "--release must equal the exact installed release child"

  release_identity() {
    "$NODE_PATH" -e '
      const fs=require("fs"),s=fs.lstatSync(process.argv[1],{bigint:true});
      process.stdout.write([["device",s.dev],["inode",s.ino],["mode",s.mode.toString(8)],["size",s.size],["mtimeNs",s.mtimeNs],["ctimeNs",s.ctimeNs]].map(([k,v])=>`${k}=${v}`).join(","));
    ' "$1"
  }
  release_tree_sha() {
    "$NODE_PATH" --input-type=module -e '
      import {pathToFileURL} from "node:url";
      const {typedTreeDigest}=await import(pathToFileURL(process.argv[1]).href);
      process.stdout.write(typedTreeDigest(process.argv[2]));
    ' "$I00_ROOT/lib.mjs" "$1"
  }
  artifact_manifest_sha() {
    "$NODE_PATH" -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1]+"/artifact-manifest.json")).digest("hex"))' "$1"
  }
  if [ "$FINALIZE_ONLY" != 1 ]; then
    CURRENT_RELEASE_PATH="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$CURRENT_LINK_ENDPOINT")"
    [ "$("$NODE_PATH" -e '
      process.stdout.write(require("path").dirname(process.argv[1]));
    ' "$CURRENT_RELEASE_PATH")" = "$RELEASES_DIR_ENDPOINT" ] \
      || blocked "current release is not one direct installed release child"
    [ "$CURRENT_RELEASE_PATH" != "$RELEASE" ] \
      || blocked "rollback current release must differ from the target"
    CURRENT_SHA="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.testedSha)' "$CURRENT_RELEASE_PATH/release.json")"
    [ "$CURRENT_SHA" != "$CANDIDATE_SHA" ] \
      || blocked "rollback current and target SHAs must be distinct"
    RELEASE_IDENTITY_ENDPOINT="$(release_identity "$RELEASE")"
    RELEASE_TREE_SHA256="$(release_tree_sha "$RELEASE")"
    CURRENT_RELEASE_IDENTITY_ENDPOINT="$(release_identity "$CURRENT_RELEASE_PATH")"
    CURRENT_RELEASE_TREE_SHA256="$(release_tree_sha "$CURRENT_RELEASE_PATH")"
    CURRENT_MANIFEST_SHA="$(artifact_manifest_sha "$CURRENT_RELEASE_PATH")"
    node "$SCRIPT_DIR/validate-config.mjs" --env "$RUNTIME_ENV" --expected-sha "$CANDIDATE_SHA" >/dev/null

    AUTH_ENDPOINTS=(
      --expected-endpoint "release-sha:$CANDIDATE_SHA"
      --expected-endpoint "artifact-manifest-sha256:$MANIFEST_SHA"
      --expected-endpoint "trusted-builder-public-key-sha256:$TRUSTED_BUILD_KEY_SHA"
      --expected-endpoint "release-path:$RELEASE"
      --expected-endpoint "release-identity:$RELEASE_IDENTITY_ENDPOINT"
      --expected-endpoint "release-tree-sha256:$RELEASE_TREE_SHA256"
      --expected-endpoint "current-release-path:$CURRENT_RELEASE_PATH"
      --expected-endpoint "current-release-sha:$CURRENT_SHA"
      --expected-endpoint "current-artifact-manifest-sha256:$CURRENT_MANIFEST_SHA"
      --expected-endpoint "current-release-identity:$CURRENT_RELEASE_IDENTITY_ENDPOINT"
      --expected-endpoint "current-release-tree-sha256:$CURRENT_RELEASE_TREE_SHA256"
      --expected-endpoint "rollback-evidence-root:$EVIDENCE_ROOT"
      --expected-endpoint "node-path:$NODE_PATH"
      --expected-endpoint "node-sha256:$NODE_SHA256"
      --expected-endpoint "node-identity:$NODE_IDENTITY_ENDPOINT"
      --expected-endpoint "bash-path:$BASH_PATH"
      --expected-endpoint "bash-sha256:$BASH_SHA256"
      --expected-endpoint "bash-identity:$BASH_IDENTITY_ENDPOINT"
      --expected-endpoint "effective-donor-root:$EFFECTIVE_DONOR_ROOT"
      --expected-endpoint "effective-donor-identity:$EFFECTIVE_DONOR_IDENTITY_ENDPOINT"
      --expected-endpoint "effective-donor-tree-sha256:$EFFECTIVE_DONOR_TREE_SHA256"
      --expected-endpoint "donor-contract-sha256:$DONOR_CONTRACT_SHA256"
      --expected-endpoint "l15-amendment-contract-sha256:$L15_AMENDMENT_CONTRACT_SHA256"
      --expected-endpoint "systemctl-path:$SYSTEMCTL_PATH"
      --expected-endpoint "systemctl-sha256:$SYSTEMCTL_SHA256"
      --expected-endpoint "systemctl-identity:$SYSTEMCTL_IDENTITY_ENDPOINT"
      --expected-endpoint "curl-path:$CURL_PATH"
      --expected-endpoint "curl-sha256:$CURL_SHA256"
      --expected-endpoint "curl-identity:$CURL_IDENTITY_ENDPOINT"
      --expected-endpoint "env-path:$ENV_PATH"
      --expected-endpoint "env-sha256:$ENV_SHA256"
      --expected-endpoint "env-identity:$ENV_IDENTITY_ENDPOINT"
      --expected-endpoint "app-unit-name:$APP_UNIT_ENDPOINT"
      --expected-endpoint "app-unit-inspection-mode:$APP_UNIT_INSPECTION_MODE"
      --expected-endpoint "app-unit-offline-unit-root:NONE"
      --expected-endpoint "systemd-analyze-path:NONE"
      --expected-endpoint "systemd-analyze-sha256:NONE"
      --expected-endpoint "systemd-analyze-identity:NONE"
      --expected-endpoint "app-unit-fragment-path:$APP_UNIT_FRAGMENT_PATH"
      --expected-endpoint "app-unit-fragment-sha256:$APP_UNIT_FRAGMENT_SHA256"
      --expected-endpoint "app-unit-fragment-identity:$APP_UNIT_FRAGMENT_IDENTITY"
      --expected-endpoint "app-unit-fragment-source-path:$APP_UNIT_FRAGMENT_SOURCE_PATH"
      --expected-endpoint "app-unit-fragment-source-sha256:$APP_UNIT_FRAGMENT_SOURCE_SHA256"
      --expected-endpoint "app-unit-fragment-source-identity:$APP_UNIT_FRAGMENT_SOURCE_IDENTITY"
      --expected-endpoint "app-unit-environment-file-path:$APP_UNIT_RUNTIME_ENV_PATH"
      --expected-endpoint "app-unit-environment-file-sha256:$APP_UNIT_RUNTIME_ENV_SHA256"
      --expected-endpoint "app-unit-environment-file-identity:$APP_UNIT_RUNTIME_ENV_IDENTITY"
      --expected-endpoint "app-unit-environment-file-optional:no"
      --expected-endpoint "app-unit-authority-closure-sha256:$APP_UNIT_AUTHORITY_CLOSURE_SHA256"
      --expected-endpoint "app-unit-effect-reachability:$APP_UNIT_EFFECT_REACHABILITY"
      --expected-endpoint "app-unit-user:$APP_UNIT_USER"
      --expected-endpoint "app-unit-group:$APP_UNIT_GROUP"
      --expected-endpoint "app-unit-working-directory:$APP_UNIT_WORKING_DIRECTORY"
      --expected-endpoint "app-unit-unset-environment-sha256:$APP_UNIT_UNSET_ENVIRONMENT_SHA256"
      --expected-endpoint "app-unit-namespace-remap-state:$APP_UNIT_NAMESPACE_REMAP_STATE"
      --expected-endpoint "app-unit-staging-root:NONE"
      --expected-endpoint "app-unit-drop-in-state:NONE"
      --expected-endpoint "app-unit-proof-drop-in-path:NONE"
      --expected-endpoint "app-unit-proof-drop-in-sha256:NONE"
      --expected-endpoint "app-unit-proof-drop-in-identity:NONE"
      --expected-endpoint "app-unit-proof-drop-in-owner:NONE"
      --expected-endpoint "app-unit-proof-drop-in-runtime-link-path:NONE"
      --expected-endpoint "app-unit-proof-drop-in-runtime-link-identity:NONE"
      --expected-endpoint "app-unit-proof-absent-sentinel:NONE"
      --expected-endpoint "app-unit-need-daemon-reload:no"
      --expected-endpoint "app-unit-exec-start-env-path:$APP_UNIT_EXEC_ENV_PATH"
      --expected-endpoint "app-unit-exec-start-node-path:$APP_UNIT_EXEC_NODE_PATH"
      --expected-endpoint "app-unit-exec-start-sha256:$APP_UNIT_EXEC_SHA256"
      --expected-endpoint "app-unit-binding-sha256:$APP_UNIT_BINDING_SHA256"
      --expected-endpoint "data-dir:$DATA_DIR_ENDPOINT"
      --expected-endpoint "donor-env-sha256:$DELEGATE_ENV_SHA"
    )
  fi
fi
if [ "$SIMULATION" = 1 ]; then
  DELEGATE_ENV_SHA="$("$GUARD_NODE_PATH" -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
fi
PREFLIGHT_CLOCK_ARGS=()
AUTHORIZATION_CLOCK_ARGS=()
RECORDER_CLOCK_ARGS=()
if [ "$SIMULATION" = 1 ]; then
  PREFLIGHT_CLOCK_ARGS=(
    --simulation-clock
    --simulation-root "$SIMULATION_ROOT"
    --now "$EFFECTIVE_NOW"
  )
  AUTHORIZATION_CLOCK_ARGS=(--simulation-clock --now "$EFFECTIVE_NOW")
  RECORDER_CLOCK_ARGS=(--simulation-clock --now "$EFFECTIVE_NOW")
fi
if [ "$FINALIZE_ONLY" != 1 ]; then
  node "$SCRIPT_DIR/preflight.mjs" --release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" \
    --mode rollback --max-host-age-sec 120 --max-supervisor-age-sec 30 \
    --required-supervisor-window-sec 300 "${PREFLIGHT_CLOCK_ARGS[@]}" >/dev/null
fi

# The validated release identity is the exact target delegated to L15.
TARGET_ID="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.releaseId)' "$RELEASE/release.json")"
if [ "$SIMULATION" != 1 ]; then
  require_effect_executable_identities
fi
[ "$("$GUARD_NODE_PATH" -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
  || blocked "sanitized donor env changed before rollback lifecycle"

ROLLBACK_OUTCOME_BASE=(
  --class SERVICE_ROLLBACK
  --deployment-risk "$DEPLOYMENT_RISK"
  --action-preview "$ACTION_PREVIEW"
  --result-receipt "$RESULT_RECEIPT"
  --reconciliation-receipt "$RECONCILIATION_RECEIPT"
  --primary-path "$RELEASE"
  --env-file "$DELEGATE_ENV"
  --evidence-root "$EVIDENCE_ROOT"
)

if [ "$FINALIZE_ONLY" = 1 ]; then
  AUTHORIZATION_CONSUMPTION="$("$GUARD_NODE_PATH" -e '
    const fs=require("fs"),path=require("path");
    const preview=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(preview.singleUse?.consumptionRoot!==process.argv[2]
      || !/^[0-9a-f]{64}$/.test(preview.singleUse?.claimKey??""))process.exit(2);
    process.stdout.write(path.resolve(process.argv[2],`${preview.singleUse.claimKey}.json`));
  ' "$ACTION_PREVIEW" "$AUTHORIZATION_CONSUMPTION_ROOT")" \
    || blocked "rollback consumption claim path is invalid"
  if [ "$SIMULATION" != 1 ]; then
    require_effect_executable_identities
    require_app_unit_binding
  fi
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/record-authorized-action-outcome.mjs" \
    --finalize-rollback "${ROLLBACK_OUTCOME_BASE[@]}" \
    --authorization "$AUTHORIZATION" \
    --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
    --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
    "${RECORDER_CLOCK_ARGS[@]}" >/dev/null
  if [ "$SIMULATION" != 1 ]; then
    require_effect_executable_identities
    require_app_unit_binding
  fi
  cleanup_delegate_env || blocked "rollback finalization cleanup failed"
  trap - EXIT
  printf 'I00_OPS_OK: rollback finalized\n'
  exit 0
fi

TARGET_HOST="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.targetHost)' "$HOST")"
TARGET_ENVIRONMENT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.environment)' "$HOST")"
TARGET_ACCOUNT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.account)' "$HOST")"
AUTH_BASE=(--input "$AUTHORIZATION" --class SERVICE_ROLLBACK --command rollback-switch --expected-operator "$OPERATOR" --expected-deployed-sha "$CANDIDATE_SHA" --expected-config-version "$CONFIG_VERSION" --deployment-risk "$DEPLOYMENT_RISK" --action-preview "$ACTION_PREVIEW" --consumption-root "$AUTHORIZATION_CONSUMPTION_ROOT" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-rollback --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 immutable release" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission systemd:RestartExactCosmosAppUnit --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "switch to one exact schema-compatible immutable rollback release and restart one exact application unit")

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

"$GUARD_NODE_PATH" -e 'process.exit(process.platform === "linux" ? 0 : 1)' \
  || blocked "authorized effects require Linux before authorization consumption"

# Staging is the last read-only rollback step before the one-time claim is
# consumed. A stage failure therefore leaves no consumed authorization.
"$GUARD_NODE_PATH" "$SCRIPT_DIR/record-authorized-action-outcome.mjs" \
  --stage-rollback "${ROLLBACK_OUTCOME_BASE[@]}" \
  "${RECORDER_CLOCK_ARGS[@]}" >/dev/null \
  || blocked "rollback pre-effect stage failed before authorization consumption"

AUTHORIZATION_VALIDATION="$("$GUARD_NODE_PATH" "$SCRIPT_DIR/validate-authorization.mjs" \
  "${AUTH_BASE[@]}" "${AUTH_ENDPOINTS[@]}" "${AUTHORIZATION_CLOCK_ARGS[@]}")" \
  || blocked "rollback authorization validation/consumption failed"
AUTHORIZATION_CONSUMPTION="$("$GUARD_NODE_PATH" -e '
  const path=require("path"),value=JSON.parse(process.argv[1]);
  if(value.status!=="AUTHORIZATION_VALID"
    ||value.consumptionStatus!=="AUTHORIZATION_CONSUMED"
    ||typeof value.authorizationConsumptionPath!=="string"
    ||path.resolve(value.authorizationConsumptionPath)!==value.authorizationConsumptionPath)process.exit(2);
  process.stdout.write(value.authorizationConsumptionPath);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "rollback authorization consumption receipt is invalid"
EFFECT_START_EVIDENCE="$("$GUARD_NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectStartEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectStartEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not bind effect start evidence"
EFFECT_FINISH_EVIDENCE="$("$GUARD_NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectTerminalEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectTerminalEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not bind effect terminal evidence"

if ! "$GUARD_NODE_PATH" "$SCRIPT_DIR/record-authorized-action-outcome.mjs" \
  --verify-rollback-stage "${ROLLBACK_OUTCOME_BASE[@]}" \
  --authorization "$AUTHORIZATION" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  "${RECORDER_CLOCK_ARGS[@]}" >/dev/null; then
  "$GUARD_NODE_PATH" "$SCRIPT_DIR/record-authorized-action-outcome.mjs" \
    --record-rollback-refusal "${ROLLBACK_OUTCOME_BASE[@]}" \
    --authorization "$AUTHORIZATION" \
    --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
    --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
    --refusal-phase STAGE_VERIFY_FAILED \
    "${RECORDER_CLOCK_ARGS[@]}" >/dev/null \
    || blocked "rollback stage verification failed and no terminal refusal could be recorded"
  cleanup_delegate_env || blocked "rollback stage-refusal cleanup failed"
  trap - EXIT
  printf 'I00_OPS_BLOCKED: rollback refused before effect\n' >&2
  exit 1
fi
if [ "$SIMULATION" != 1 ]; then
  require_effect_executable_identities
  require_app_unit_binding
fi
[ "$("$GUARD_NODE_PATH" -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
  || blocked "sanitized donor env changed before rollback effect"

set +e
"$NODE_PATH" "$SCRIPT_DIR/run-bound-effect.mjs" \
  --authorization "$AUTHORIZATION" \
  --deployment-risk "$DEPLOYMENT_RISK" \
  --action-preview "$ACTION_PREVIEW" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  -- "$DONOR_ROOT/bin/rollback.sh" \
  --i00-effect-environment "$DELEGATE_ENV"
RUNNER_RESULT=$?
set -e
TERMINAL_RECORDER_CLOCK_ARGS=()
if [ "$SIMULATION" = 1 ]; then
  TERMINAL_RECORDER_CLOCK_ARGS=(--simulation-clock)
fi
TERMINAL_RECORD="$("$GUARD_NODE_PATH" \
  "$SCRIPT_DIR/record-authorized-action-outcome.mjs" \
  --record-rollback-terminal "${ROLLBACK_OUTCOME_BASE[@]}" \
  --authorization "$AUTHORIZATION" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  --systemctl "$SYSTEMCTL_PATH" --curl "$CURL_PATH" \
  --effect-start-evidence "$EFFECT_START_EVIDENCE" \
  --effect-finish-evidence "$EFFECT_FINISH_EVIDENCE" \
  "${TERMINAL_RECORDER_CLOCK_ARGS[@]}")" \
  || blocked "rollback terminal outcome could not be recorded"

if [ "$SIMULATION" != 1 ]; then
  require_effect_executable_identities
  require_app_unit_binding
fi
[ "$("$GUARD_NODE_PATH" -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
  || blocked "sanitized donor env changed during rollback effect"

TERMINAL_CLASS="$("$GUARD_NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(!["COMPLETED","DONOR_REFUSAL","FROZEN","AMBIGUOUS_EFFECT"]
    .includes(value.terminalDisposition))process.exit(2);
  process.stdout.write(value.terminalDisposition);
' "$TERMINAL_RECORD")" \
  || blocked "recorded rollback terminal disposition is invalid"
TERMINAL_EXIT_CODE="$("$GUARD_NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(value.terminalExitCode===null)process.stdout.write("NONE");
  else if(Number.isSafeInteger(value.terminalExitCode)
      && value.terminalExitCode>=0 && value.terminalExitCode<=255)
    process.stdout.write(String(value.terminalExitCode));
  else process.exit(2);
' "$TERMINAL_RECORD")" \
  || blocked "recorded rollback terminal exit code is invalid"

cleanup_delegate_env || blocked "rollback outcome-record cleanup failed"
trap - EXIT
if [ "$TERMINAL_CLASS" = DONOR_REFUSAL ]; then
  printf 'I00_OPS_BLOCKED: rollback refused before switch; no effect reconciled\n' >&2
  exit "$TERMINAL_EXIT_CODE"
fi
if [ "$TERMINAL_CLASS" != COMPLETED ]; then
  printf 'I00_OPS_BLOCKED: rollback terminal failure reconciled\n' >&2
  if [ "$TERMINAL_EXIT_CODE" != NONE ] \
      && [ "$TERMINAL_EXIT_CODE" -gt 0 ]; then
    exit "$TERMINAL_EXIT_CODE"
  fi
  exit 1
fi
[ "$RUNNER_RESULT" = 0 ] \
  || blocked "rollback completed terminal disagrees with runner status"
printf 'I00_OPS_PENDING: rollback effect recorded; reconciliation required\n'
exit 75
