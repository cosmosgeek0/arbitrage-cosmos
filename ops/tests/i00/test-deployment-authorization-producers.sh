#!/bin/bash -p
set -euo pipefail

if [ "$(/usr/bin/uname -s)" = Linux ] \
    && { [ "${DF32_ACTUAL_ONLY:-0}" = 1 ] \
      || [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; }; then
  PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export PATH
  [ -f /usr/bin/node ] && [ ! -L /usr/bin/node ] && [ -x /usr/bin/node ] \
    || { printf 'NOT OK: Linux proof bootstrap requires fixed /usr/bin/node\n' >&2; exit 1; }
  node() {
    /usr/bin/node "$@"
  }
  if [ "${DF32_ACTUAL_ONLY:-0}" = 1 ]; then
    case "${DF32_STAGING_ROOT:-}" in
      /var/tmp/cosmos-df32-proof-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
      *)
        printf 'NOT OK: Linux actual proof bootstrap requires one exact staging root\n' >&2
        exit 1
        ;;
    esac
    I00_TEST_TMP_OVERRIDE="$DF32_STAGING_ROOT/test-tmp"
    export I00_TEST_TMP_OVERRIDE
  elif [ -n "${DF32_STAGING_ROOT:-}" ]; then
    printf 'NOT OK: Linux runtime fixture proof rejects a staging-root claim\n' >&2
    exit 1
  fi
fi

. "$(dirname "$0")/helpers.sh"

CONTRACT="$I00_ROOT/deployment-authorization-contract.mjs"
FIXTURE="$TEST_DIR/fixtures/make-deployment-authorization-fixture.mjs"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
PREVIEW_PRODUCER="$I00_ROOT/bin/produce-deployment-action-preview.mjs"
AUTH_VALIDATOR="$I00_ROOT/bin/validate-authorization.mjs"
EXECUTABLE_INSPECTOR="$I00_ROOT/bin/inspect-executable.mjs"
SQLITE_VERSION_VERIFIER="$I00_ROOT/bin/verify-sqlite-version.mjs"
OUTCOME_RECORDER="$I00_ROOT/bin/record-authorized-action-outcome.mjs"
BACKUP_INSPECTOR="$I00_ROOT/bin/inspect-backup-source.mjs"
FIXED_GATE_LAUNCHER="$I00_ROOT/bin/run-fixed-node-gate.sh"
APP_UNIT_UNSET_ENVIRONMENT='NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy'
CLASSES=(
  OPS_BUNDLE_INSTALL
  SERVICE_RELEASE_SWITCH
  SERVICE_ROLLBACK
  BACKUP_CREATE
  ISOLATED_RESTORE
  SECRET_MATERIALIZATION
)
ACTUAL_POSITIVE_CLASSES=(
  OPS_BUNDLE_INSTALL
  SERVICE_RELEASE_SWITCH
  BACKUP_CREATE
  ISOLATED_RESTORE
)
ACTUAL_PROOF_PORT=8080
ACTUAL_PROOF_START_LEAD_SECONDS=600
FIXTURE_TARGET_SHA=0123456789abcdef0123456789abcdef01234567
FIXTURE_CURRENT_SHA=1111111111111111111111111111111111111111
FIXTURE_TARGET_RELEASE=""
FIXTURE_CURRENT_RELEASE=""
FIXTURE_ROLLBACK_TARGET_RELEASE=""
FIXTURE_ROLLBACK_CURRENT_RELEASE=""
FIXTURE_TRUST_KEY=""
if [ "$(uname -s)" = Linux ]; then
  CANONICAL_NODE=/usr/bin/node
  [ -f "$CANONICAL_NODE" ] && [ ! -L "$CANONICAL_NODE" ] && [ -x "$CANONICAL_NODE" ] \
    || fail_test "Linux producer proof requires fixed /usr/bin/node"
else
  NODE_BOOTSTRAP="$(command -v node)" \
    || fail_test "producer proof requires one bootstrap Node executable"
  case "$NODE_BOOTSTRAP" in
    /*) ;;
    *) fail_test "producer proof Node bootstrap path must be absolute" ;;
  esac
  CANONICAL_NODE="$("$NODE_BOOTSTRAP" -e \
    'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')"
fi
node() {
  "$CANONICAL_NODE" "$@"
}

select_fixed_sqlite_path() {
  local explicit="$1" candidate
  shift
  if [ -n "$explicit" ]; then
    printf '%s\n' "$explicit"
    return 0
  fi
  for candidate in "$@"; do
    if [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

SQLITE_SELECTION_REGRESSION_ROOT="$TEST_TMP/sqlite-selection"
SQLITE_SELECTION_PRIVATE="$SQLITE_SELECTION_REGRESSION_ROOT/private/sqlite3"
SQLITE_SELECTION_DISTRO="$SQLITE_SELECTION_REGRESSION_ROOT/distro/sqlite3"
mkdir -p "$(dirname "$SQLITE_SELECTION_PRIVATE")" \
  "$(dirname "$SQLITE_SELECTION_DISTRO")"
printf '%s\n' '#!/bin/sh' "printf '3.53.3 private fixture\\n'" \
  >"$SQLITE_SELECTION_PRIVATE"
printf '%s\n' '#!/bin/sh' "printf '3.45.1 distro fixture\\n'" \
  >"$SQLITE_SELECTION_DISTRO"
chmod 500 "$SQLITE_SELECTION_PRIVATE" "$SQLITE_SELECTION_DISTRO"
assert_eq "$(
  select_fixed_sqlite_path \
    "$SQLITE_SELECTION_PRIVATE" "$SQLITE_SELECTION_DISTRO"
)" "$SQLITE_SELECTION_PRIVATE"
assert_success node "$SQLITE_VERSION_VERIFIER" \
  --version "$("$SQLITE_SELECTION_PRIVATE" --version)"
assert_failure node "$SQLITE_VERSION_VERIFIER" \
  --version "$("$SQLITE_SELECTION_DISTRO" --version)"

FIXED_SQLITE="$(
  select_fixed_sqlite_path "${DF32_SQLITE_BIN:-}" \
    /usr/bin/sqlite3 /bin/sqlite3 /usr/local/bin/sqlite3 \
    /opt/homebrew/bin/sqlite3
)" || FIXED_SQLITE=""
[ -n "$FIXED_SQLITE" ] || fail_test "producer proof requires SQLite at one fixed candidate path"
if [ -n "${DF32_SQLITE_BIN:-}" ]; then
  [ "$(uname -s)" = Linux ] && [ "$(id -u)" -eq 0 ] \
    || fail_test "DF32_SQLITE_BIN is accepted only by the root Linux proof"
  [ "$FIXED_SQLITE" = "$DF32_SQLITE_BIN" ] \
    || fail_test "DF32_SQLITE_BIN selection changed"
  [ "$(node -e \
    'const fs=require("fs");process.stdout.write(String(fs.lstatSync(process.argv[1]).uid))' \
    "$FIXED_SQLITE")" = 0 ] \
    || fail_test "DF32_SQLITE_BIN must be root-owned"
fi
FIXED_SQLITE_INSPECTION="$(node "$EXECUTABLE_INSPECTOR" --path "$FIXED_SQLITE")"
[ "$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).path)' \
  "$FIXED_SQLITE_INSPECTION")" = "$FIXED_SQLITE" ] \
  || fail_test "fixed SQLite canonical path changed"
FIXED_SQLITE_VERSION_OUTPUT="$("$FIXED_SQLITE" --version)" \
  || fail_test "fixed SQLite version readback failed"
FIXED_SQLITE_VERSION="${FIXED_SQLITE_VERSION_OUTPUT%%[[:space:]]*}"
[ "$(node "$EXECUTABLE_INSPECTOR" --path "$FIXED_SQLITE")" \
  = "$FIXED_SQLITE_INSPECTION" ] \
  || fail_test "fixed SQLite identity changed around version readback"
if [ -n "${DF32_SQLITE_BIN:-}" ]; then
  node "$SQLITE_VERSION_VERIFIER" \
    --version "$FIXED_SQLITE_VERSION_OUTPUT" >/dev/null \
    || fail_test "DF32_SQLITE_BIN does not have an accepted WAL-reset-safe version"
fi
FIXED_SQLITE_SHA256="$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).sha256)' \
  "$FIXED_SQLITE_INSPECTION")"
FIXED_SQLITE_IDENTITY="$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' \
  "$FIXED_SQLITE_INSPECTION")"

actual_proof_owner_values() {
  local suffix="$1"
  [[ "$suffix" =~ ^[0-9a-f]{4}$ ]] || return 1
  printf 'cosmos-df32-proof-%s.internal\tisolated-staging-%s\n' \
    "$suffix" "$suffix"
}

case "${DF32_ACTUAL_ONLY:-0}" in
  0|1) ;;
  *) fail_test "DF32_ACTUAL_ONLY must be exactly 0 or 1" ;;
esac
case "${DF32_RUNTIME_FOCUSED:-0}" in
  0|1) ;;
  *) fail_test "DF32_RUNTIME_FOCUSED must be exactly 0 or 1" ;;
esac
if [ "${DF32_ACTUAL_ONLY:-0}" = 1 ] && [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
  fail_test "actual-only and runtime-focused proof modes are mutually exclusive"
fi
if [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
  CLASSES=(SECRET_MATERIALIZATION)
fi
IFS=$'\t' read -r OWNER_REGRESSION_HOST OWNER_REGRESSION_ENVIRONMENT \
  <<<"$(actual_proof_owner_values abcd)"
assert_eq "$OWNER_REGRESSION_HOST" cosmos-df32-proof-abcd.internal
assert_eq "$OWNER_REGRESSION_ENVIRONMENT" isolated-staging-abcd
assert_failure actual_proof_owner_values abcG
assert_eq "$ACTUAL_PROOF_PORT" 8080
assert_eq "$ACTUAL_PROOF_START_LEAD_SECONDS" 600
ACTUAL_PROOF_TEST_SOURCE="$(cat "$0")"
assert_contains "$ACTUAL_PROOF_TEST_SOURCE" '`PORT=${appPort}`'
assert_contains "$ACTUAL_PROOF_TEST_SOURCE" \
  '`HEALTH_BASE=http://127.0.0.1:${appPort}`'
ACTUAL_STAGING_SYSTEMCTL_ASSIGNMENT="$(printf '%s%s' \
  'APP_UNIT_STAGING_SYSTEMCTL="$DF32_STAGING_ROOT/tools/' 'systemctl"')"
ACTUAL_STAGING_SYSTEMCTL_ARG="$(printf '%s%s' \
  '--systemctl "$APP_UNIT_STAGING_' 'SYSTEMCTL"')"
ACTUAL_STAGING_SYSTEMCTL_ENDPOINT="$(printf '%s%s' \
  '"systemctl-path:$APP_UNIT_STAGING_' 'SYSTEMCTL"')"
ACTUAL_START_LEAD_CONVERSION="$(printf '%s%s' \
  'Number(startLead' 'Seconds) * 1000')"
assert_contains "$ACTUAL_PROOF_TEST_SOURCE" "$ACTUAL_STAGING_SYSTEMCTL_ASSIGNMENT"
assert_eq "$(printf '%s' "$ACTUAL_PROOF_TEST_SOURCE" \
  | grep -F -- "$ACTUAL_STAGING_SYSTEMCTL_ARG" \
  | wc -l | tr -d '[:space:]')" 2
assert_contains "$ACTUAL_PROOF_TEST_SOURCE" "$ACTUAL_STAGING_SYSTEMCTL_ENDPOINT"
assert_contains "$ACTUAL_PROOF_TEST_SOURCE" "$ACTUAL_START_LEAD_CONVERSION"
if printf '%s' "$ACTUAL_PROOF_TEST_SOURCE" | grep -F "'PORT=86""01'" >/dev/null; then
  fail_test "actual proof runtime retains the superseded origin port"
fi
pass_assertion
if [ "${DF32_ACTUAL_ONLY:-0}" = 1 ]; then
  [ "$(uname -s)" = Linux ] || fail_test "actual-only acceptance requires Linux"
  [ -n "${DF32_RELEASE:-}" ] && [ -n "${DF32_TRUST_KEY:-}" ] \
    || fail_test "actual-only acceptance requires DF32_RELEASE and DF32_TRUST_KEY"
  [ -n "${DF32_TARGET_ACCOUNT:-}" ] && [ -n "${DF32_TARGET_HOST:-}" ] \
    || fail_test "actual-only acceptance requires DF32_TARGET_ACCOUNT and DF32_TARGET_HOST"
  [ -n "${DF32_STAGING_ROOT:-}" ] \
    || fail_test "actual-only acceptance requires DF32_STAGING_ROOT"
  [ -n "${DF32_APP_UNIT:-}" ] \
    || fail_test "actual-only acceptance requires DF32_APP_UNIT"
  [[ "$DF32_STAGING_ROOT" =~ ^/var/tmp/cosmos-df32-proof-([0-9a-f]{4})$ ]] \
    || fail_test "DF32_STAGING_ROOT must be one exact four-suffix proof root"
  DF32_PROOF_SUFFIX="${BASH_REMATCH[1]}"
  [ "$DF32_APP_UNIT" = "cosmos-df32-proof-$DF32_PROOF_SUFFIX.service" ] \
    || fail_test "DF32_APP_UNIT must match the exact proof-root suffix"
fi

release_tree_digest() {
  node --input-type=module - "$1" <<'NODE'
import { createHash } from 'node:crypto';
import {
  lstatSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
const root = realpathSync(process.argv[2]);
const hash = createHash('sha256');
const visit = (relative) => {
  const absolute = resolve(root, relative);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) process.exit(2);
  const label = relative || '.';
  if (stat.isDirectory()) {
    hash.update(`directory\0${label}\0${(stat.mode & 0o7777).toString(8)}\n`);
    for (const name of readdirSync(absolute).sort()) {
      visit(relative ? `${relative}/${name}` : name);
    }
    return;
  }
  if (!stat.isFile()) process.exit(2);
  const bytes = readFileSync(absolute);
  hash.update(`file\0${label}\0${(stat.mode & 0o7777).toString(8)}\0${bytes.length}\0`);
  hash.update(bytes);
  hash.update('\n');
};
visit('');
process.stdout.write(hash.digest('hex'));
NODE
}

if [ -n "${DF32_STAGING_ROOT:-}" ]; then
  node -e '
    const fs=require("fs"),p=require("path"),value=process.argv[1];
    if (!/^\/var\/tmp\/cosmos-df32-proof-[0-9a-f]{4}$/.test(value)
        || p.resolve(value)!==value) process.exit(1);
    const parent=fs.lstatSync("/var/tmp");
    if (!parent.isDirectory() || parent.isSymbolicLink()
        || fs.realpathSync("/var/tmp")!=="/var/tmp"
        || parent.uid!==0 || (parent.mode&0o1000)===0) process.exit(1);
    if (fs.existsSync(value)) {
      const target=fs.lstatSync(value);
      if (!target.isDirectory() || target.isSymbolicLink()
          || target.uid!==process.getuid()) process.exit(1);
    }
  ' "$DF32_STAGING_ROOT" \
    || fail_test "DF32_STAGING_ROOT is not one safe isolated staging directory"
  if [ ! -e "$DF32_STAGING_ROOT" ]; then
    (umask 077; mkdir "$DF32_STAGING_ROOT")
  fi
  chmod 700 "$DF32_STAGING_ROOT"
  PROOF_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DF32_STAGING_ROOT")"
  [ "$PROOF_ROOT" = "$DF32_STAGING_ROOT" ] \
    || fail_test "DF32_STAGING_ROOT canonical identity changed"
else
  PROOF_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
    --root "$TEST_TMP/ip-ops-i00-sim-df32-producers")"
fi
mkdir -p "$PROOF_ROOT/authorization" "$PROOF_ROOT/consumption" \
  "$PROOF_ROOT/receipts" "$PROOF_ROOT/effects" "$PROOF_ROOT/rollback-evidence"
chmod 700 "$PROOF_ROOT/authorization" "$PROOF_ROOT/consumption" \
  "$PROOF_ROOT/receipts" "$PROOF_ROOT/effects" "$PROOF_ROOT/rollback-evidence"

create_auxiliary_proof_root() {
  local suffix="$1"
  node "$I00_ROOT/bin/create-simulation-root.mjs" \
    --root "$PROOF_ROOT/ip-ops-i00-sim-$suffix"
}

json_value() {
  node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const path=process.argv[2].split(".");let out=value;for(const key of path)out=out[key];process.stdout.write(String(out));' "$1" "$2"
}

preview_endpoint() {
  node -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const marker=`${process.argv[2]}:`;
    const matches=value.action.allowedEndpoints.filter((entry)=>entry.startsWith(marker));
    if(matches.length!==1)process.exit(2);
    process.stdout.write(matches[0].slice(marker.length));
  ' "$1" "$2"
}

set_validator_args() {
  local root action_class validation_mode auth risk preview claims
  root="$1"
  action_class="$2"
  validation_mode="${3:-simulation}"
  auth="$root/authorization/$action_class.authorization.json"
  risk="$root/authorization/$action_class.risk.json"
  preview="$root/authorization/$action_class.preview.json"
  claims="$root/consumption"
  VALIDATOR_NODE="$(preview_endpoint "$preview" node-path)"
  VALIDATOR_ARGS=(
    --input "$auth"
    --class "$action_class"
    --command "$(json_value "$preview" action.command)"
    --expected-operator "$(json_value "$preview" binding.operator)"
    --expected-deployed-sha "$(json_value "$preview" binding.deployedSha)"
    --expected-config-version "$(json_value "$preview" binding.configVersion)"
    --deployment-risk "$risk"
    --action-preview "$preview"
    --consumption-root "$claims"
    --expected-host "$(json_value "$preview" binding.host)"
    --expected-environment "$(json_value "$preview" binding.environment)"
    --expected-scope "$(json_value "$preview" action.scope)"
    --expected-account "$(json_value "$preview" binding.account)"
    --expected-product "$(json_value "$preview" action.allowedProducts.0)"
    --expected-credential-type "$(json_value "$preview" action.allowedCredentials.types.0)"
    --expected-result-receipt "$(json_value "$preview" action.receiptTargets.result)"
    --expected-reconciliation-receipt "$(json_value "$preview" action.receiptTargets.reconciliation)"
    --expected-maximum-capital "$(json_value "$preview" action.maximumEffect.capital)"
    --expected-maximum-notional "$(json_value "$preview" action.maximumEffect.notional)"
    --expected-maximum-effect "$(json_value "$preview" action.maximumEffect.operational)"
  )
  while IFS= read -r permission; do
    VALIDATOR_ARGS+=(--expected-permission "$permission")
  done < <(node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const permission of value.action.allowedCredentials.permissions)console.log(permission);' "$preview")
  if [ "$validation_mode" = simulation ]; then
    if [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
      VALIDATOR_ARGS+=(--simulation-clock \
        --now "$(json_value "$preview" authorizationWindow.startsAtUtc)")
    else
      VALIDATOR_ARGS+=(--simulation-clock --now 2026-07-23T00:04:00Z)
    fi
  elif [ "$validation_mode" != real ]; then
    fail_test "unknown validator mode $validation_mode"
  fi
  while IFS= read -r endpoint; do
    VALIDATOR_ARGS+=(--expected-endpoint "$endpoint")
  done < <(node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const endpoint of value.action.allowedEndpoints)console.log(endpoint);' "$preview")
}

set_actual_validator_args() {
  local root action_class request auth risk preview claims
  local command scope product credential_type permission maximum_effect expected_sha config_version
  local release_root trust_key manifest_sha trust_sha donor_env_sha first_host_evidence_sha
  local endpoint_inventory endpoint
  local -a expected_endpoints donor_endpoints
  root="$1"
  action_class="$2"
  request="$root/authorization/$action_class.request.json"
  auth="$root/authorization/$action_class.authorization.json"
  risk="$root/authorization/$action_class.risk.json"
  preview="$root/authorization/$action_class.preview.json"
  claims="$root/consumption"
  VALIDATOR_NODE="$(preview_endpoint "$preview" node-path)"
  expected_sha="$(json_value "$DF32_RELEASE/release.json" testedSha)"
  config_version="$(json_value "$DF32_RELEASE/release.json" configRevision)"
  release_root="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DF32_RELEASE")"
  trust_key="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DF32_TRUST_KEY")"
  manifest_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$release_root/artifact-manifest.json")"
  trust_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$trust_key")"
  first_host_evidence_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_DIR/collected-evidence.json")"
  donor_endpoints=(
    "donor-contract-sha256:$DONOR_CONTRACT_SHA256"
    "effective-donor-identity:$EFFECTIVE_DONOR_IDENTITY"
    "effective-donor-root:$ACCEPTED_DONOR_ROOT"
    "effective-donor-tree-sha256:$EFFECTIVE_DONOR_TREE_SHA256"
    "l15-amendment-contract-sha256:$L15_AMENDMENT_CONTRACT_SHA256"
  )
  case "$action_class" in
    OPS_BUNDLE_INSTALL)
      command=install-ops-bundle
      scope=cosmos-production-ops-bundle-install
      product="Cosmos I00 ops bundle"
      credential_type=ROOT_LOCAL_OPERATOR_SESSION
      permission=filesystem:InstallImmutableOpsBundle
      maximum_effect="install one exact immutable ops bundle without service mutation"
      expected_endpoints=(
        "artifact-manifest-sha256:$manifest_sha"
        "bash-identity:$BASH_IDENTITY"
        "bash-path:$BASH_BIN"
        "bash-sha256:$BASH_SHA256"
        "chmod-identity:$CHMOD_IDENTITY"
        "chmod-path:$CHMOD_BIN"
        "chmod-sha256:$CHMOD_SHA256"
        "cp-identity:$CP_IDENTITY"
        "cp-path:$CP_BIN"
        "cp-sha256:$CP_SHA256"
        "destination:$root/install/i00"
        "mkdir-identity:$MKDIR_IDENTITY"
        "mkdir-path:$MKDIR_BIN"
        "mkdir-sha256:$MKDIR_SHA256"
        "mv-identity:$MV_IDENTITY"
        "mv-path:$MV_BIN"
        "mv-sha256:$MV_SHA256"
        "node-identity:$NODE_IDENTITY"
        "node-path:$NODE_BIN"
        "node-sha256:$NODE_SHA256"
        "release-sha:$expected_sha"
        "rm-identity:$RM_IDENTITY"
        "rm-path:$RM_BIN"
        "rm-sha256:$RM_SHA256"
        "trusted-builder-public-key-sha256:$trust_sha"
      )
      ;;
    SERVICE_RELEASE_SWITCH)
      command=release-switch
      scope=cosmos-production-release-switch
      product="Cosmos I00 immutable release"
      credential_type=ROOT_LOCAL_OPERATOR_SESSION
      permission=systemd:RestartExactCosmosAppUnit
      maximum_effect="install one exact immutable release and restart one exact application unit"
      donor_env_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_ENV")"
      expected_endpoints=(
        "artifact-manifest-sha256:$manifest_sha"
        "app-unit-authority-closure-sha256:$APP_UNIT_AUTHORITY_CLOSURE_SHA256"
        "app-unit-binding-sha256:$APP_UNIT_BINDING_SHA256"
        "app-unit-drop-in-state:EXACT_STAGING_PROOF"
        "app-unit-environment-file-identity:$APP_UNIT_RUNTIME_ENV_IDENTITY"
        "app-unit-environment-file-optional:no"
        "app-unit-environment-file-path:$STAGING_RUNTIME_ROOT/cosmos-app.env"
        "app-unit-environment-file-sha256:$APP_UNIT_RUNTIME_ENV_SHA256"
        "app-unit-exec-start-env-path:$ENV_BIN"
        "app-unit-exec-start-node-path:$NODE_BIN"
        "app-unit-exec-start-sha256:$APP_UNIT_EXEC_START_SHA256"
        "app-unit-fragment-identity:$APP_UNIT_FRAGMENT_IDENTITY"
        "app-unit-fragment-path:$APP_UNIT_FRAGMENT_PATH"
        "app-unit-fragment-sha256:$APP_UNIT_FRAGMENT_SHA256"
        "app-unit-group:cosmos"
        "app-unit-name:$DF32_APP_UNIT"
        "app-unit-namespace-remap-state:NONE"
        "app-unit-need-daemon-reload:not-applicable-offline"
        "app-unit-staging-root:$DF32_STAGING_ROOT"
        "app-unit-unset-environment-sha256:$APP_UNIT_UNSET_ENVIRONMENT_SHA256"
        "app-unit-user:cosmos"
        "app-unit-working-directory:/opt/cosmos/current"
        "backup-reserve-bytes:4096"
        "bash-identity:$BASH_IDENTITY"
        "bash-path:$BASH_BIN"
        "bash-sha256:$BASH_SHA256"
        "curl-identity:$CURL_IDENTITY"
        "curl-path:$CURL_BIN"
        "curl-sha256:$CURL_SHA256"
        "data-dir:$root/data"
        "${donor_endpoints[@]}"
        "donor-env-sha256:$donor_env_sha"
        "env-identity:$ENV_IDENTITY"
        "env-path:$ENV_BIN"
        "env-sha256:$ENV_SHA256"
        "first-host-account:$DF32_TARGET_ACCOUNT"
        "first-host-environment:$ACTUAL_PROOF_ENVIRONMENT"
        "first-host-evidence-sha256:$first_host_evidence_sha"
        "first-host-target-host:$ACTUAL_PROOF_HOST"
        "node-identity:$NODE_IDENTITY"
        "node-path:$NODE_BIN"
        "node-sha256:$NODE_SHA256"
        "recovery-target:NO_PRIOR_RELEASE_FIRST_HOST"
        "release-path:$release_root"
        "release-sha:$expected_sha"
        "sqlite-identity:$SQLITE_IDENTITY"
        "sqlite-path:$SQLITE_BIN"
        "sqlite-sha256:$SQLITE_SHA256"
        "sqlite-version:$SQLITE_VERSION"
        "systemctl-identity:$APP_UNIT_STAGING_SYSTEMCTL_IDENTITY"
        "systemctl-path:$APP_UNIT_STAGING_SYSTEMCTL"
        "systemctl-sha256:$APP_UNIT_STAGING_SYSTEMCTL_SHA256"
        "trusted-builder-public-key-sha256:$trust_sha"
      )
      ;;
    BACKUP_CREATE)
      command=backup-verify
      scope=cosmos-production-backup
      product="Cosmos I00 state backup"
      credential_type=ROOT_LOCAL_OPERATOR_SESSION
      permission=filesystem:CreateExactCosmosBackup
      maximum_effect="create and verify one exact database evidence and model backup"
      donor_env_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$BACKUP_SANITIZED_ENV")"
      expected_endpoints=(
        "backup-dir:$root/backups"
        "bash-identity:$BASH_IDENTITY"
        "bash-path:$BASH_BIN"
        "bash-sha256:$BASH_SHA256"
        "data-dir:$root/data"
        "${donor_endpoints[@]}"
        "donor-env-sha256:$donor_env_sha"
        "env-identity:$ENV_IDENTITY"
        "env-path:$ENV_BIN"
        "env-sha256:$ENV_SHA256"
        "hash-identity:$HASH_IDENTITY"
        "hash-path:$HASH_BIN"
        "hash-sha256:$HASH_SHA256"
        "node-identity:$NODE_IDENTITY"
        "node-path:$NODE_BIN"
        "node-sha256:$NODE_SHA256"
        "sqlite-identity:$SQLITE_IDENTITY"
        "sqlite-path:$SQLITE_BIN"
        "sqlite-sha256:$SQLITE_SHA256"
        "tar-identity:$TAR_IDENTITY"
        "tar-path:$TAR_BIN"
        "tar-sha256:$TAR_SHA256"
      )
      ;;
    ISOLATED_RESTORE)
      command=restore-drill-verify
      scope=cosmos-production-isolated-restore
      product="Cosmos I00 isolated restore drill"
      credential_type=ROOT_LOCAL_OPERATOR_SESSION
      permission=filesystem:CreateExactIsolatedRestore
      maximum_effect="restore and verify one exact backup into one exact isolated target"
      donor_env_sha="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$BACKUP_SANITIZED_ENV")"
      expected_endpoints=(
        "backup-database-sha256:$BACKUP_DATABASE_SHA256"
        "backup-identity:$BACKUP_IDENTITY"
        "backup-manifest-sha256:$BACKUP_MANIFEST_SHA256"
        "backup-path:$root/backups/exact"
        "bash-identity:$BASH_IDENTITY"
        "bash-path:$BASH_BIN"
        "bash-sha256:$BASH_SHA256"
        "data-dir:$root/data"
        "${donor_endpoints[@]}"
        "donor-env-sha256:$donor_env_sha"
        "env-identity:$ENV_IDENTITY"
        "env-path:$ENV_BIN"
        "env-sha256:$ENV_SHA256"
        "hash-identity:$HASH_IDENTITY"
        "hash-path:$HASH_BIN"
        "hash-sha256:$HASH_SHA256"
        "isolated-target:$root/restore"
        "node-identity:$NODE_IDENTITY"
        "node-path:$NODE_BIN"
        "node-sha256:$NODE_SHA256"
        "sqlite-identity:$SQLITE_IDENTITY"
        "sqlite-path:$SQLITE_BIN"
        "sqlite-sha256:$SQLITE_SHA256"
        "tar-identity:$TAR_IDENTITY"
        "tar-path:$TAR_BIN"
        "tar-sha256:$TAR_SHA256"
      )
      ;;
    *)
      fail_test "actual-input class is not a Block 25 positive gate: $action_class"
      ;;
  esac
  endpoint_inventory="$(node - "$risk" "$preview" "${expected_endpoints[@]}" <<'NODE'
const fs = require('node:fs');
const [riskPath, previewPath, ...independent] = process.argv.slice(2);
const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
const riskEndpoints = risk?.action?.allowedEndpoints;
const previewEndpoints = preview?.action?.allowedEndpoints;
if (!Array.isArray(riskEndpoints) || riskEndpoints.length === 0
    || JSON.stringify(previewEndpoints) !== JSON.stringify(riskEndpoints)
    || independent.some((endpoint) => !riskEndpoints.includes(endpoint))
    || riskEndpoints.some((endpoint) => (
      typeof endpoint !== 'string' || endpoint.includes('\n')
    ))) {
  process.exit(2);
}
process.stdout.write(riskEndpoints.join('\n'));
NODE
)" || fail_test "actual validator endpoint inventory differs from independent bindings"
  expected_endpoints=()
  while IFS= read -r endpoint; do
    [ -n "$endpoint" ] || fail_test "actual validator endpoint inventory contains an empty row"
    expected_endpoints+=("$endpoint")
  done <<<"$endpoint_inventory"
  assert_success node - "$request" <<'NODE'
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = [
  'approvalReference', 'approver', 'authorizationId', 'expiresAtUtc', 'kind',
  'operator', 'receiptTargets', 'schemaVersion', 'startsAtUtc', 'status',
].sort();
if (JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(expected)) process.exit(1);
NODE
  assert_eq "$(json_value "$request" operator)" isolated-staging-operator
  VALIDATOR_ARGS=(
    --input "$auth"
    --class "$action_class"
    --command "$command"
    --expected-operator isolated-staging-operator
    --expected-deployed-sha "$expected_sha"
    --expected-config-version "$config_version"
    --deployment-risk "$risk"
    --action-preview "$preview"
    --consumption-root "$claims"
    --expected-host "$ACTUAL_PROOF_HOST"
    --expected-environment "$ACTUAL_PROOF_ENVIRONMENT"
    --expected-scope "$scope"
    --expected-account "$DF32_TARGET_ACCOUNT"
    --expected-product "$product"
    --expected-credential-type "$credential_type"
    --expected-permission "$permission"
    --expected-result-receipt "$root/receipts/$action_class.result.json"
    --expected-reconciliation-receipt "$root/receipts/$action_class.reconciliation.json"
    --expected-maximum-capital ZERO
    --expected-maximum-notional ZERO
    --expected-maximum-effect "$maximum_effect"
  )
  for endpoint in "${expected_endpoints[@]}"; do
    VALIDATOR_ARGS+=(--expected-endpoint "$endpoint")
  done
}

prepare_fixture_inputs() {
  local root="$1"
  [ ! -e "$root/.fixture-inputs-ready" ] || return 0
  mkdir -p "$root/authorization" "$root/consumption" "$root/receipts" \
    "$root/effects" \
    "$root/bin" "$root/data" "$root/backups/exact" "$root/evidence" \
    "$root/models" "$root/ops-state" "$root/cosmos/releases" "$root/runtime" \
    "$root/config" "$root/credentials" "$root/install" \
    "$root/rollback-evidence" "$root/systemd/cosmos-app.service.d" \
    "$root/runtime-systemd/cosmos-app.service.d"
  chmod 700 "$root" "$root/authorization" "$root/consumption" "$root/receipts" \
    "$root/effects" \
    "$root/bin" "$root/data" "$root/backups" "$root/backups/exact" \
    "$root/evidence" "$root/models" "$root/ops-state" "$root/cosmos" \
    "$root/cosmos/releases" "$root/runtime" "$root/rollback-evidence" "$root/systemd" \
    "$root/config" "$root/credentials" "$root/install" \
    "$root/systemd/cosmos-app.service.d" "$root/runtime-systemd" \
    "$root/runtime-systemd/cosmos-app.service.d"
  if [ "$(uname -s)" = Darwin ]; then
    cp "$TEST_DIR/fixtures/fake-sqlite-safe.sh" "$root/bin/sqlite3"
  else
    cp "$FIXED_SQLITE" "$root/bin/sqlite3"
  fi
  cp "$CANONICAL_NODE" "$root/bin/node"
  for executable in bash env curl tar gzip sha256sum aws id getent setpriv \
    mkdir cp chmod mv rm; do
    cp "$TEST_DIR/fixtures/fake-sqlite-safe.sh" "$root/bin/$executable"
  done
  printf '%s\n' \
    '#!/bin/sh' \
    'if [ "${1:-}" = "-u" ] && [ "${2:-}" = cosmos ]; then printf "1000\n"; exit 0; fi' \
    'exit 64' >"$root/bin/id"
  printf '%s\n' \
    '#!/bin/sh' \
    'if [ "${1:-}" = group ] && [ "${2:-}" = cosmos ]; then printf "cosmos:x:1000:\n"; exit 0; fi' \
    'exit 64' >"$root/bin/getent"
  cp "$TEST_DIR/fixtures/fake-aws.sh" "$root/bin/aws"
  cp "$REPO_ROOT/ops/live/systemd/cosmos-app.service" \
    "$root/systemd/cosmos-app.service"
  printf '%s\n' \
    '[Unit]' \
    "ConditionPathExists=$root/.do-not-start-cosmos-app" \
    '' \
    '[Service]' \
    'EnvironmentFile=' \
    "EnvironmentFile=$root/runtime.env" \
    >"$root/systemd/cosmos-app.service.d/90-cosmos-app.conf"
  ln -s "$root/systemd/cosmos-app.service.d/90-cosmos-app.conf" \
    "$root/runtime-systemd/cosmos-app.service.d/90-cosmos-app.conf"
  chmod 600 "$root/systemd/cosmos-app.service"
  chmod 400 "$root/systemd/cosmos-app.service.d/90-cosmos-app.conf"
  cat >"$root/systemctl-show" <<EOF
Id=cosmos-app.service
Names=cosmos-app.service
Following=
LoadState=loaded
FragmentPath=$root/systemd/cosmos-app.service
DropInPaths=$root/runtime-systemd/cosmos-app.service.d/90-cosmos-app.conf
NeedDaemonReload=no
Requires=
Wants=network-online.target
Requisite=
BindsTo=
PartOf=
After=network-online.target
Before=
Conflicts=
OnFailure=
OnSuccess=
OnSuccessJobMode=replace
OnFailureJobMode=replace
PropagatesStopTo=
StopPropagatedFrom=
PropagatesReloadTo=
ReloadPropagatedFrom=
Upholds=
JoinsNamespaceOf=
RequiresMountsFor=
WantsMountsFor=
DefaultDependencies=yes
SuccessAction=none
FailureAction=none
JobTimeoutAction=none
StartLimitAction=none
User=cosmos
Group=cosmos
WorkingDirectory=/opt/cosmos/current
Environment=
PassEnvironment=
UnsetEnvironment=$APP_UNIT_UNSET_ENVIRONMENT
SetCredential=
SetCredentialEncrypted=
LoadCredential=
LoadCredentialEncrypted=
ImportCredential=
SupplementaryGroups=
DynamicUser=no
PAMName=
CapabilityBoundingSet=
AmbientCapabilities=
NoNewPrivileges=yes
RootDirectory=
RootImage=
MountImages=
ExtensionImages=
ExtensionDirectories=
ExecSearchPath=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
ReadWritePaths=/var/lib/cosmos /run/cosmos-app
ReadOnlyPaths=
InaccessiblePaths=
ExecPaths=
NoExecPaths=
RuntimeDirectory=cosmos-app
RuntimeDirectoryMode=700
RuntimeDirectoryPreserve=restart
StateDirectory=
StateDirectoryMode=755
CacheDirectory=
CacheDirectoryMode=755
LogsDirectory=
LogsDirectoryMode=755
ConfigurationDirectory=
ConfigurationDirectoryMode=755
RootDirectoryStartOnly=no
Type=simple
StandardInput=null
StandardOutput=journal
StandardError=journal
Sockets=
BusName=
PIDFile=
NotifyAccess=none
FileDescriptorStoreMax=0
FileDescriptorStorePreserve=no
ExecCondition=
ExecStartPre=
ExecStartPost=
ExecReload=
ExecStop=
ExecStopPost=
EOF
  chmod 600 "$root/systemctl-show"
  {
    printf '%s\n' '#!/bin/sh' 'set -eu'
    printf '%s\n' 'if [ "${1-}" = show ] && [ "${2-}" = cosmos-app.service ]; then'
    printf '%s\n' "  /bin/cat '$root/systemctl-show'"
    printf '%s\n' "  IFS= read -r runtime_env < '$root/app-runtime-path'"
    printf '%s\n' '  printf "EnvironmentFiles=%s (ignore_errors=no)\n" "$runtime_env"'
    printf '%s\n' "  printf 'ExecStart={ path=$root/bin/env ; argv[]=$root/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $root/bin/node server/dist/index.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'"
    printf '%s\n' "  printf 'ExecStartEx={ path=$root/bin/env ; argv[]=$root/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $root/bin/node server/dist/index.js ; flags= ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'"
    printf '%s\n' '  exit 0' 'fi'
    printf '%s\n' 'if [ "${1-}" = is-active ] && [ "${2-}" = cosmos-app.service ]; then exit 3; fi'
    printf '%s\n' 'exit 94'
  } >"$root/bin/systemctl"
  chmod 755 "$root/bin/sqlite3" "$root/bin/node" "$root/bin/bash" \
    "$root/bin/env" "$root/bin/systemctl" "$root/bin/curl" "$root/bin/tar" "$root/bin/gzip" "$root/bin/sha256sum" \
    "$root/bin/aws" "$root/bin/id" "$root/bin/getent" "$root/bin/setpriv" \
    "$root/bin/mkdir" "$root/bin/cp" "$root/bin/chmod" "$root/bin/mv" "$root/bin/rm"
  "$root/bin/sqlite3" "$root/backups/exact/cosmos.db" \
    'PRAGMA journal_mode=DELETE; CREATE TABLE events(id INTEGER PRIMARY KEY);'
  chmod 600 "$root/backups/exact/cosmos.db"
  node - "$root/backups/exact" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
const database = fs.readFileSync(path.join(directory, 'cosmos.db'));
const manifest = {
  backupId: path.basename(directory),
  createdAtUtc: '2026-07-23T00:00:00Z',
  dbFile: 'cosmos.db',
  dbSha256: crypto.createHash('sha256').update(database).digest('hex'),
  dbBytes: database.length,
  eventsCount: 0,
  dataSchema: null,
  integrityCheck: 'ok',
  evidence: [],
};
fs.writeFileSync(path.join(directory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
  ln -s "$FIXTURE_ROLLBACK_CURRENT_RELEASE" "$root/cosmos/current"
  node - "$root" "$FIXTURE_TARGET_SHA" "$FIXTURE_CURRENT_SHA" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [root, targetSha, currentSha] = process.argv.slice(2);
const hostEvidence = Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  source: 'ISOLATED_STAGING_HOST_EVIDENCE',
  observedAtUtc: '2026-07-23T00:00:00Z',
})}\n`);
fs.writeFileSync(path.join(root, 'host-evidence.json'), hostEvidence, { mode: 0o600 });
const host = {
  source: 'TARGET_HOST_OWNER_READBACK',
  account: 'aws:123456789012',
  targetHost: 'isolated-staging.internal',
  environment: 'isolated-staging',
  freeBytes: 1024 * 1024 * 1024,
  backupReserveBytes: 4096,
  sqliteVersion: '3.53.3',
  evidenceSha256: crypto.createHash('sha256').update(hostEvidence).digest('hex'),
  observedAtUtc: '2026-07-23T00:00:00Z',
};
fs.writeFileSync(path.join(root, 'host.json'), `${JSON.stringify(host, null, 2)}\n`, { mode: 0o600 });
const runtime = (sha) => [
  'HOST=127.0.0.1',
  'PORT=8080',
  `DATA_DIR=${root}/data`,
  `DATA_DIR_LOGICAL_LEASE_ROOT=${root}/leases`,
  `EVIDENCE_DIR=${root}/evidence`,
  `MODEL_DIR=${root}/models`,
  `BACKUP_DIR=${root}/backups`,
  'CONTROL_ROOM_OPERATOR_EMAIL=operator@isolated.test',
  'CF_ACCESS_TEAM_DOMAIN=https://isolated-staging.cloudflareaccess.com',
  'CF_ACCESS_AUD=isolated_staging_audience',
  `I00_TESTED_SHA=${sha}`,
  `I00_DEPLOYED_SHA=${sha}`,
  'I00_CONFIG_REVISION=config-fixture',
  'I00_MODEL_REVISION=UNAVAILABLE',
  'I00_PUBLIC_SOURCE_STARTUP_EGRESS=1',
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'runtime.env'), runtime(targetSha), { mode: 0o600 });
fs.writeFileSync(path.join(root, 'rollback-runtime.env'), runtime(currentSha), { mode: 0o600 });
fs.writeFileSync(path.join(root, 'app-runtime-path'), `${path.join(root, 'runtime.env')}\n`,
  { mode: 0o600 });
fs.writeFileSync(path.join(root, 'deploy.env'), [
  `COSMOS_ROOT=${root}/cosmos`,
  `RELEASES_DIR=${root}/cosmos/releases`,
  `CURRENT_LINK=${root}/cosmos/current`,
  `PREVIOUS_LINK=${root}/cosmos/previous`,
  `DATA_DIR=${root}/data`,
  `OPS_STATE_DIR=${root}/ops-state`,
  'APP_UNIT=cosmos-app.service',
  'HEALTH_BASE=http://127.0.0.1:8080',
  'GATE_TIMEOUT_SEC=60',
  'HTTP_TIMEOUT_SEC=5',
  'LOCK_TIMEOUT_SEC=30',
  'I00_OPS_READBACK_TIMEOUT_MS=750',
  'I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback',
  '',
].join('\n'), { mode: 0o600 });
fs.writeFileSync(path.join(root, 'backup.env'), [
  `DATA_DIR=${root}/data`,
  `BACKUP_DIR=${root}/backups`,
  `OPS_STATE_DIR=${root}/ops-state`,
  `SQLITE=${root}/bin/sqlite3`,
  '',
].join('\n'), { mode: 0o600 });
const awsPath = path.join(root, 'bin', 'aws');
const awsSha = crypto.createHash('sha256').update(fs.readFileSync(awsPath)).digest('hex');
fs.writeFileSync(path.join(root, 'config', 'secrets-provider.json'), `${JSON.stringify({
  schemaVersion: 2,
  secretArn: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd',
  region: 'ap-south-1',
  instanceRoleArn: 'arn:aws:iam::123456789012:role/cosmos-instance-role',
  awsCliPath: awsPath,
  awsCliSha256: awsSha,
  secretVersionId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  targetHost: 'isolated-staging.internal',
  environment: 'isolated-staging',
  operator: 'isolated-staging-operator',
  deployedSha: targetSha,
  configVersion: 'config-fixture',
  deploymentRisk: path.join(root, 'authorization', 'SECRET_MATERIALIZATION.risk.json'),
  actionPreview: path.join(root, 'authorization', 'SECRET_MATERIALIZATION.preview.json'),
  authorizationConsumptionRoot: path.join(root, 'consumption'),
  resultReceiptTarget: path.join(root, 'receipts', 'SECRET_MATERIALIZATION.result.json'),
  reconciliationReceiptTarget: path.join(
    root,
    'receipts',
    'SECRET_MATERIALIZATION.reconciliation.json',
  ),
  requiredKeys: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
}, null, 2)}\n`, { mode: 0o600 });
NODE
  printf 'ready\n' >"$root/.fixture-inputs-ready"
  chmod 600 "$root/.fixture-inputs-ready"
}

write_fixture_app_drop_in() {
  local root="$1" runtime_env="$2"
  chmod 600 "$root/systemd/cosmos-app.service.d/90-cosmos-app.conf"
  printf '%s\n' \
    '[Unit]' \
    "ConditionPathExists=$root/.do-not-start-cosmos-app" \
    '' \
    '[Service]' \
    'EnvironmentFile=' \
    "EnvironmentFile=$runtime_env" \
    >"$root/systemd/cosmos-app.service.d/90-cosmos-app.conf"
  chmod 400 "$root/systemd/cosmos-app.service.d/90-cosmos-app.conf"
}

assert_endpoint_family_inventory() {
  node - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const [riskPath, actionClass] = process.argv.slice(2);
const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
const familyList = (value) => value.trim().split(/\s+/u).sort();
const expected = {
  OPS_BUNDLE_INSTALL: familyList(`
    artifact-manifest-sha256 bash-identity bash-path bash-sha256
    chmod-identity chmod-path chmod-sha256 completion-reserve-seconds
    cp-identity cp-path cp-sha256 destination destination-parent-identity
    destination-parent-path effect-common-identity effect-common-path
    effect-common-sha256 effect-finish-evidence effect-gid
    effect-program-identity effect-program-path effect-program-sha256
    effect-script-identity effect-script-path effect-script-sha256
    effect-start-evidence effect-uid mkdir-identity mkdir-path mkdir-sha256
    mv-identity mv-path mv-sha256 node-identity node-path node-sha256
    receipt-publication-reserve-seconds release-identity release-path
    release-sha release-tree-sha256 rm-identity rm-path rm-sha256
    trusted-builder-public-key-sha256
  `),
  SERVICE_RELEASE_SWITCH: familyList(`
    alert-helper-argv-shape alert-helper-identity alert-helper-path
    alert-helper-sha256 alert-helper-timeout-ms
    app-unit-authority-closure-sha256 app-unit-binding-sha256
    app-unit-drop-in-state app-unit-effect-reachability
    app-unit-environment-file-identity app-unit-environment-file-optional
    app-unit-environment-file-path app-unit-environment-file-sha256
    app-unit-exec-start-env-path app-unit-exec-start-node-path
    app-unit-exec-start-sha256 app-unit-fragment-identity
    app-unit-fragment-path app-unit-fragment-sha256
    app-unit-fragment-source-identity app-unit-fragment-source-path
    app-unit-fragment-source-sha256 app-unit-group app-unit-inspection-mode
    app-unit-name app-unit-namespace-remap-state app-unit-need-daemon-reload
    app-unit-offline-unit-root app-unit-proof-absent-sentinel
    app-unit-proof-drop-in-identity app-unit-proof-drop-in-owner
    app-unit-proof-drop-in-path app-unit-proof-drop-in-runtime-link-identity
    app-unit-proof-drop-in-runtime-link-path app-unit-proof-drop-in-sha256
    app-unit-staging-root app-unit-unset-environment-sha256 app-unit-user
    app-unit-working-directory artifact-manifest-sha256 backup-reserve-bytes
    bash-identity bash-path bash-sha256 completion-reserve-seconds
    cosmos-root-identity cosmos-root-path curl-identity curl-path curl-sha256
    current-link-parent-identity current-link-parent-path data-dir
    data-dir-identity data-dir-path donor-contract-sha256 donor-env-sha256
    effect-common-identity effect-common-path effect-common-sha256
    effect-environment-fd-token effect-environment-sha256
    effect-environment-source-path effect-finish-evidence effect-gid
    effect-program-identity effect-program-path effect-program-sha256
    effect-script-identity effect-script-path effect-script-sha256
    effect-start-evidence effect-uid effective-donor-identity
    effective-donor-root effective-donor-tree-sha256 env-identity env-path
    env-sha256 exposure-helper-argv-shape exposure-helper-identity
    exposure-helper-path exposure-helper-sha256 exposure-helper-timeout-ms
    gate-timeout-sec http-timeout-sec l15-amendment-contract-sha256
    lock-timeout-sec node-identity node-path node-sha256
    ops-readback-timeout-ms ops-readback-url ops-state-dir-identity
    ops-state-dir-path previous-link-parent-identity previous-link-parent-path
    receipt-publication-reserve-seconds release-identity release-path
    release-sha release-tree-sha256 releases-dir-identity releases-dir-path
    sqlite-identity sqlite-path sqlite-sha256 sqlite-version
    systemctl-identity systemctl-path systemctl-sha256
    systemd-analyze-identity systemd-analyze-path systemd-analyze-sha256
    trusted-builder-public-key-sha256
  `),
  BACKUP_CREATE: familyList(`
    backup-dir backup-dir-identity bash-identity bash-path bash-sha256
    completion-reserve-seconds data-dir data-dir-identity data-dir-path
    donor-contract-sha256 donor-env-sha256 effect-common-identity
    effect-common-path effect-common-sha256 effect-environment-fd-token
    effect-environment-sha256 effect-environment-source-path
    effect-finish-evidence effect-gid effect-group effect-program-identity
    effect-program-path effect-program-sha256 effect-script-identity
    effect-script-path effect-script-sha256 effect-start-evidence effect-uid
    effect-unit-identity effect-unit-path effect-unit-sha256 effect-user
    effective-donor-identity effective-donor-root
    effective-donor-tree-sha256 env-identity env-path env-sha256
    getent-identity getent-path getent-sha256 gzip-argv-shape gzip-fd-token
    gzip-identity gzip-path gzip-sha256 hash-identity hash-path hash-sha256
    id-identity id-path id-sha256 l15-amendment-contract-sha256
    node-identity node-path node-sha256 ops-state-dir-identity
    ops-state-dir-path receipt-publication-reserve-seconds setpriv-identity
    setpriv-path setpriv-sha256 sqlite-identity sqlite-path sqlite-sha256
    tar-identity tar-path tar-sha256
  `),
  ISOLATED_RESTORE: familyList(`
    backup-archive-count backup-created-at-utc backup-data-schema
    backup-database-sha256 backup-dir backup-dir-identity backup-events-count
    backup-identity backup-manifest-sha256 backup-max-age-hours backup-path
    backup-tree-sha256 bash-identity bash-path bash-sha256
    completion-reserve-seconds data-dir data-dir-identity data-dir-path
    donor-contract-sha256 donor-env-sha256 effect-common-identity
    effect-common-path effect-common-sha256 effect-environment-fd-token
    effect-environment-sha256 effect-environment-source-path
    effect-finish-evidence effect-gid effect-group effect-program-identity
    effect-program-path effect-program-sha256 effect-script-identity
    effect-script-path effect-script-sha256 effect-start-evidence effect-uid
    effect-unit-identity effect-unit-path effect-unit-sha256 effect-user
    effective-donor-identity effective-donor-root
    effective-donor-tree-sha256 env-identity env-path env-sha256
    getent-identity getent-path getent-sha256 gzip-argv-shape gzip-fd-token
    gzip-identity gzip-path gzip-sha256 hash-identity hash-path hash-sha256
    id-identity id-path id-sha256 isolated-target
    isolated-target-parent-identity isolated-target-parent-path
    l15-amendment-contract-sha256 node-identity node-path node-sha256
    receipt-publication-reserve-seconds setpriv-identity setpriv-path
    setpriv-sha256 sqlite-identity sqlite-path sqlite-sha256
    tar-identity tar-path tar-sha256
  `),
};
if (!Object.hasOwn(expected, actionClass)) process.exit(2);
const endpoints = risk?.action?.allowedEndpoints;
if (!Array.isArray(endpoints) || endpoints.length === 0) process.exit(2);
const families = endpoints.map((endpoint) => {
  if (typeof endpoint !== 'string') process.exit(2);
  const split = endpoint.indexOf(':');
  if (split < 1) process.exit(2);
  const family = endpoint.slice(0, split);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(family)) process.exit(2);
  return family;
}).sort();
if (new Set(families).size !== families.length) process.exit(2);
if (actionClass === 'SERVICE_RELEASE_SWITCH') {
  const firstHostOnly = familyList(`
    first-host-account first-host-environment first-host-evidence-sha256
    first-host-target-host recovery-target
  `);
  const laterOnly = new Set(familyList(`
    automatic-rollback-script-identity automatic-rollback-script-path
    automatic-rollback-script-sha256 current-artifact-manifest-sha256
    current-release-identity current-release-path current-release-sha
    current-release-tree-sha256 rollback-evidence-root
    rollback-evidence-root-identity
  `));
  const firstHost = families.includes('first-host-account');
  if (firstHost) {
    expected[actionClass] = [
      ...expected[actionClass].filter((family) => !laterOnly.has(family)),
      ...firstHostOnly,
    ].sort();
  } else {
    expected[actionClass] = [
      ...expected[actionClass],
      ...laterOnly,
    ].sort();
  }
}
if (JSON.stringify(families) !== JSON.stringify(expected[actionClass])) {
  process.exit(2);
}
NODE
  [ "$?" -eq 0 ] || return 1
  pass_assertion
}

produce_class() {
  local root="$1" action_class="$2"
  local nonce request risk preview authorization risk_now
  local -a risk_args
  prepare_fixture_inputs "$root"
  request="$root/authorization/$action_class.request.json"
  risk="$root/authorization/$action_class.risk.json"
  preview="$root/authorization/$action_class.preview.json"
  authorization="$root/authorization/$action_class.authorization.json"
  risk_now=2026-07-23T00:00:00Z
  if [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
    risk_now="$(node -e '
      const value=Math.floor(Date.now()/1000)*1000-10_000;
      process.stdout.write(new Date(value).toISOString().replace(".000Z","Z"));
    ')"
  fi
  nonce="$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.argv[1]).digest("hex"))' "$action_class")"
  node "$FIXTURE" request "$CONTRACT" "$root" "$action_class" "$request"
  risk_args=(
    --request "$request" \
    --class "$action_class" \
    --output "$risk" \
    --simulation-clock --now "$risk_now" --nonce "$nonce" \
    --simulation-command-root "$root/bin" \
    --root-mode TEST --proof-root "$root"
  )
  case "$action_class" in
    OPS_BUNDLE_INSTALL)
      risk_args+=(--release "$FIXTURE_TARGET_RELEASE" \
        --trusted-build-public-key "$FIXTURE_TRUST_KEY" \
        --host-readback "$root/host.json" --host-evidence "$root/host-evidence.json" \
        --destination "$root/install/i00")
      ;;
    SERVICE_RELEASE_SWITCH)
      write_fixture_app_drop_in "$root" "$root/runtime.env"
      printf '%s\n' "$root/runtime.env" >"$root/app-runtime-path"
      risk_args+=(--release "$FIXTURE_TARGET_RELEASE" \
        --trusted-build-public-key "$FIXTURE_TRUST_KEY" \
        --host-readback "$root/host.json" --host-evidence "$root/host-evidence.json" \
        --runtime-env "$root/runtime.env" --deploy-env "$root/deploy.env" \
        --sqlite "$root/bin/sqlite3" --simulation-donor-root "$REPO_ROOT/ops/live")
      ;;
    SERVICE_ROLLBACK)
      write_fixture_app_drop_in "$root" "$root/runtime.env"
      printf '%s\n' "$root/runtime.env" >"$root/app-runtime-path"
      risk_args+=(--release "$FIXTURE_ROLLBACK_TARGET_RELEASE" \
        --trusted-build-public-key "$FIXTURE_TRUST_KEY" \
        --host-readback "$root/host.json" --host-evidence "$root/host-evidence.json" \
        --runtime-env "$root/runtime.env" --deploy-env "$root/deploy.env" \
        --rollback-evidence-root "$root/rollback-evidence" \
        --simulation-donor-root "$REPO_ROOT/ops/live")
      ;;
    BACKUP_CREATE)
      risk_args+=(--host-readback "$root/host.json" --host-evidence "$root/host-evidence.json" \
        --runtime-env "$root/runtime.env" --backup-env "$root/backup.env" \
        --simulation-donor-root "$REPO_ROOT/ops/live")
      ;;
    ISOLATED_RESTORE)
      risk_args+=(--host-readback "$root/host.json" --host-evidence "$root/host-evidence.json" \
        --runtime-env "$root/runtime.env" --backup-env "$root/backup.env" \
        --backup "$root/backups/exact" --target "$root/restore" \
        --simulation-donor-root "$REPO_ROOT/ops/live")
      ;;
    SECRET_MATERIALIZATION)
      risk_args+=(--provider-config "$root/config/secrets-provider.json" \
        --credential-output "$root/credentials/app-secrets.json")
      ;;
    *) fail_test "unsupported producer fixture class $action_class" ;;
  esac
  node "$RISK_PRODUCER" "${risk_args[@]}" >"$root/authorization/$action_class.risk.out"
  case "$action_class" in
    OPS_BUNDLE_INSTALL|SERVICE_RELEASE_SWITCH|BACKUP_CREATE|ISOLATED_RESTORE)
      assert_endpoint_family_inventory "$risk" "$action_class"
      ;;
  esac
  if [ "$action_class" = SERVICE_RELEASE_SWITCH ] || [ "$action_class" = SERVICE_ROLLBACK ]; then
    assert_success node - "$risk" <<'NODE'
const fs = require('node:fs');
const risk = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const endpoints = risk.action.allowedEndpoints;
const alertEndpoints = endpoints.filter((endpoint) => endpoint.startsWith('alert-helper-'));
const exactlyOne = (prefix) => alertEndpoints.filter(
  (endpoint) => endpoint.startsWith(prefix),
).length === 1;
if (alertEndpoints.length !== 5
    || !exactlyOne('alert-helper-identity:')
    || !exactlyOne('alert-helper-path:')
    || !exactlyOne('alert-helper-sha256:')
    || !alertEndpoints.includes('alert-helper-argv-shape:SEVERITY_CODE_MESSAGE')
    || !alertEndpoints.includes('alert-helper-timeout-ms:5000')) {
  process.exit(1);
}
NODE
  fi
  node "$PREVIEW_PRODUCER" \
    --deployment-risk "$risk" \
    --consumption-root "$root/consumption" \
    --output "$preview" \
    >"$root/authorization/$action_class.preview.out"
  node "$FIXTURE" authorization "$CONTRACT" "$root" "$action_class" "$authorization"
}

write_fixture_backup() {
  local root="$1" directory="$2" created="$3"
  mkdir "$directory"
  chmod 700 "$directory"
  "$root/bin/sqlite3" "$directory/cosmos.db" \
    'PRAGMA journal_mode=DELETE; CREATE TABLE events(id INTEGER PRIMARY KEY);'
  chmod 600 "$directory/cosmos.db"
  node - "$directory" "$created" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
const createdAtUtc = process.argv[3];
const database = fs.readFileSync(path.join(directory, 'cosmos.db'));
const manifest = {
  backupId: path.basename(directory),
  createdAtUtc,
  dbFile: 'cosmos.db',
  dbSha256: crypto.createHash('sha256').update(database).digest('hex'),
  dbBytes: database.length,
  eventsCount: 0,
  dataSchema: null,
  integrityCheck: 'ok',
  evidence: [],
};
fs.writeFileSync(path.join(directory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
}

materialize_fixture_installed_ops() {
  local destination="$1"
  mkdir "$destination"
  cp -R "$I00_ROOT/." "$destination/"
  mkdir "$destination/accepted-ops-live"
  cp -R "$REPO_ROOT/ops/live/." "$destination/accepted-ops-live/"
  node --input-type=module - \
    "$I00_ROOT/lib.mjs" "$I00_ROOT/l15-amendment.mjs" "$destination" \
    0123456789abcdef0123456789abcdef01234567 <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [libPath, amendmentModulePath, root, testedSha] = process.argv.slice(2);
const { treeDigest, typedTreeDigest } = await import(pathToFileURL(resolve(libPath)).href);
const { loadL15AmendmentContract } =
  await import(pathToFileURL(resolve(amendmentModulePath)).href);
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const donorContract = resolve(root, 'donor-contract.json');
const amendmentContract = resolve(root, 'l15-amendment-contract.json');
const donorContractSha = digest(donorContract);
const amendmentContractSha = digest(amendmentContract);
const loaded = loadL15AmendmentContract(amendmentContract, amendmentContractSha);
const immutable = loaded.contract.immutableDonor;
const effective = loaded.contract.effectiveLive;
const receipt = {
  schemaVersion: 2,
  testedSha,
  sourceReleaseId: `i00-${testedSha}`,
  installedTreeDigestSha256: treeDigest(root),
  effectiveOpsRoot: 'accepted-ops-live',
  immutableDonorCommit: immutable.acceptedCommit,
  immutableDonorLiveTree: immutable.acceptedLiveTree,
  immutableDonorContractSha256: donorContractSha,
  amendmentContractSha256: amendmentContractSha,
  effectiveLiveTree: effective.tree,
  effectiveRootDigestSha256: effective.rootDigestSha256,
  i00EnforcementTreeDigestSha256: typedTreeDigest(root, {
    excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
  }),
  authorizedCorrectionFindingIds: loaded.findingIds,
  serviceMutationPerformed: false,
};
writeFileSync(resolve(root, 'install-receipt.json'),
  `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE
  chmod -R a-w "$destination"
  chmod go+x "$destination"
}

if [ "${DF32_ACTUAL_ONLY:-0}" != 1 ]; then
if [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
  mkdir "$PROOF_ROOT/runtime-focused-release-placeholder"
  chmod 500 "$PROOF_ROOT/runtime-focused-release-placeholder"
  FIXTURE_TARGET_RELEASE="$PROOF_ROOT/runtime-focused-release-placeholder"
  FIXTURE_CURRENT_RELEASE="$PROOF_ROOT/runtime-focused-release-placeholder"
  FIXTURE_ROLLBACK_TARGET_RELEASE="$PROOF_ROOT/runtime-focused-release-placeholder"
  FIXTURE_ROLLBACK_CURRENT_RELEASE="$PROOF_ROOT/runtime-focused-release-placeholder"
else
FIXTURE_TARGET_RELEASE="$(assemble_fixture_release \
  "$PROOF_ROOT/target-release-fixture" "$FIXTURE_TARGET_SHA")"
FIXTURE_CURRENT_RELEASE="$(assemble_fixture_release \
  "$PROOF_ROOT/current-release-fixture" "$FIXTURE_CURRENT_SHA")"
mkdir "$PROOF_ROOT/rollback-installed-releases"
chmod 700 "$PROOF_ROOT/rollback-installed-releases"
cp -R "$FIXTURE_TARGET_RELEASE" "$PROOF_ROOT/rollback-installed-releases/target"
cp -R "$FIXTURE_CURRENT_RELEASE" "$PROOF_ROOT/rollback-installed-releases/current"
chmod -R a-w "$PROOF_ROOT/rollback-installed-releases/target" \
  "$PROOF_ROOT/rollback-installed-releases/current"
FIXTURE_ROLLBACK_TARGET_RELEASE="$PROOF_ROOT/rollback-installed-releases/target"
FIXTURE_ROLLBACK_CURRENT_RELEASE="$PROOF_ROOT/rollback-installed-releases/current"
fi
FIXTURE_TRUST_KEY="$PROOF_ROOT/fixture-trust-key.pem"
printf 'SIMULATION FIXTURE TRUST MATERIAL ONLY\n' >"$FIXTURE_TRUST_KEY"
chmod 600 "$FIXTURE_TRUST_KEY"

if [ "${DF32_RUNTIME_FOCUSED:-0}" != 1 ]; then
  note "backup risk rejects undelegated evidence archive read roots"
  BACKUP_EVIDENCE_HOSTILE="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
    --root "$TEST_TMP/ip-ops-i00-sim-df32-backup-evidence-hostile")"
  prepare_fixture_inputs "$BACKUP_EVIDENCE_HOSTILE"
  printf 'EVIDENCE_PATHS=%s\n' "$BACKUP_EVIDENCE_HOSTILE/evidence" \
    >>"$BACKUP_EVIDENCE_HOSTILE/backup.env"
  BACKUP_EVIDENCE_REQUEST="$BACKUP_EVIDENCE_HOSTILE/authorization/request.json"
  BACKUP_EVIDENCE_RISK="$BACKUP_EVIDENCE_HOSTILE/authorization/risk.json"
  node "$FIXTURE" request "$CONTRACT" "$BACKUP_EVIDENCE_HOSTILE" \
    BACKUP_CREATE "$BACKUP_EVIDENCE_REQUEST"
  assert_failure_contains 'rejects EVIDENCE_PATHS' \
    node "$RISK_PRODUCER" \
      --request "$BACKUP_EVIDENCE_REQUEST" \
      --class BACKUP_CREATE \
      --output "$BACKUP_EVIDENCE_RISK" \
      --simulation-clock --now 2026-07-23T00:00:00Z \
      --nonce "$(printf 'b%.0s' {1..64})" \
      --simulation-command-root "$BACKUP_EVIDENCE_HOSTILE/bin" \
      --root-mode TEST --proof-root "$BACKUP_EVIDENCE_HOSTILE" \
      --host-readback "$BACKUP_EVIDENCE_HOSTILE/host.json" \
      --host-evidence "$BACKUP_EVIDENCE_HOSTILE/host-evidence.json" \
      --runtime-env "$BACKUP_EVIDENCE_HOSTILE/runtime.env" \
      --backup-env "$BACKUP_EVIDENCE_HOSTILE/backup.env" \
      --simulation-donor-root "$REPO_ROOT/ops/live"
  assert_not_file "$BACKUP_EVIDENCE_RISK"
fi

note "executable inspector binds one canonical immutable executable identity"
INSPECT_ROOT="$PROOF_ROOT/executable-inspector"
mkdir "$INSPECT_ROOT"
chmod 700 "$INSPECT_ROOT"
cp "$TEST_DIR/fixtures/fake-sqlite-safe.sh" "$INSPECT_ROOT/sqlite-safe"
chmod 755 "$INSPECT_ROOT/sqlite-safe"
INSPECT_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$INSPECT_ROOT")"
INSPECTED="$(node "$EXECUTABLE_INSPECTOR" --path "$INSPECT_ROOT/sqlite-safe")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$INSPECTED")" EXECUTABLE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$INSPECTED")" "$INSPECT_ROOT/sqlite-safe"
assert_success node -e '
  const value=JSON.parse(process.argv[1]);
  if (!/^[0-9a-f]{64}$/.test(value.sha256)) process.exit(1);
  if (!/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/.test(value.endpointIdentity)) process.exit(1);
' "$INSPECTED"
ln -s "$INSPECT_ROOT/sqlite-safe" "$INSPECT_ROOT/sqlite-symlink"
assert_failure_contains 'non-symlink regular file' node "$EXECUTABLE_INSPECTOR" --path "$INSPECT_ROOT/sqlite-symlink"
cp "$INSPECT_ROOT/sqlite-safe" "$INSPECT_ROOT/sqlite-writable"
chmod 775 "$INSPECT_ROOT/sqlite-writable"
assert_failure_contains 'must not be group/world writable' node "$EXECUTABLE_INSPECTOR" --path "$INSPECT_ROOT/sqlite-writable"
cp "$INSPECT_ROOT/sqlite-safe" "$INSPECT_ROOT/sqlite-non-executable"
chmod 644 "$INSPECT_ROOT/sqlite-non-executable"
assert_failure_contains 'must have an executable mode' node "$EXECUTABLE_INSPECTOR" --path "$INSPECT_ROOT/sqlite-non-executable"
assert_failure node "$EXECUTABLE_INSPECTOR" --path "$INSPECT_ROOT/sqlite-safe --cmd"
assert_failure node "$EXECUTABLE_INSPECTOR" --path relative/sqlite3

note "risk and preview producers cover every closed action class"
assert_success node -e '
  const fs = require("node:fs");
  for (const path of process.argv.slice(1)) {
    const mode = fs.statSync(path).mode & 0o7777;
    if (mode !== 0o755) process.exit(1);
  }
' "$RISK_PRODUCER" "$PREVIEW_PRODUCER"
EXPECTED_CONSUMPTION_COUNT=0
for action_class in "${CLASSES[@]}"; do
  produce_class "$PROOF_ROOT" "$action_class"
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.risk.json" status)" BOUND_NOT_AUTHORIZED
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.risk.json" provenanceMode)" TEST_FIXTURE_INJECTED
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.preview.json" status)" PREVIEW_READY_NOT_AUTHORIZED
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.preview.json" provenanceMode)" TEST_FIXTURE_INJECTED
  if grep -Eq '"status": "(APPROVED|PASS|SAFE)"' \
    "$PROOF_ROOT/authorization/$action_class.risk.json" \
    "$PROOF_ROOT/authorization/$action_class.preview.json"; then
    fail_test "producer fabricated approval or safety status"
  fi
  pass_assertion
  set_validator_args "$PROOF_ROOT" "$action_class"
  "$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" \
    >"$PROOF_ROOT/authorization/$action_class.validation.json"
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.validation.json" status)" AUTHORIZATION_VALID
  assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.validation.json" consumptionStatus)" AUTHORIZATION_CONSUMED
  EXPECTED_CONSUMPTION_COUNT=$((EXPECTED_CONSUMPTION_COUNT + 1))
  assert_eq "$(find "$PROOF_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" \
    "$EXPECTED_CONSUMPTION_COUNT"
  assert_failure "$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}"
  assert_eq "$(find "$PROOF_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" \
    "$EXPECTED_CONSUMPTION_COUNT"
done

if [ "${DF32_RUNTIME_FOCUSED:-0}" != 1 ]; then
  note "actual endpoint-family inventory rejects omissions and additions"
  ENDPOINT_INVENTORY_MISSING="$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.inventory-missing.json"
  ENDPOINT_INVENTORY_EXTRA="$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.inventory-extra.json"
  node - "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
    "$ENDPOINT_INVENTORY_MISSING" "$ENDPOINT_INVENTORY_EXTRA" <<'NODE'
const fs = require('node:fs');
const [source, missingPath, extraPath] = process.argv.slice(2);
const original = JSON.parse(fs.readFileSync(source, 'utf8'));
const missing = structuredClone(original);
missing.action.allowedEndpoints = missing.action.allowedEndpoints.slice(1);
const extra = structuredClone(original);
extra.action.allowedEndpoints = [
  ...extra.action.allowedEndpoints,
  'unexpected-endpoint-family:FORBIDDEN',
].sort();
fs.writeFileSync(missingPath, `${JSON.stringify(missing, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(extraPath, `${JSON.stringify(extra, null, 2)}\n`, { mode: 0o600 });
NODE
  assert_failure assert_endpoint_family_inventory \
    "$ENDPOINT_INVENTORY_MISSING" OPS_BUNDLE_INSTALL
  assert_failure assert_endpoint_family_inventory \
    "$ENDPOINT_INVENTORY_EXTRA" OPS_BUNDLE_INSTALL
fi

if [ "${DF32_RUNTIME_FOCUSED:-0}" != 1 ]; then
note "release and rollback producers reject a current-release runtime for the target effect"
for action_class in SERVICE_RELEASE_SWITCH SERVICE_ROLLBACK; do
  case "$action_class" in
    SERVICE_RELEASE_SWITCH)
      runtime_hostile_suffix=release-switch
      runtime_hostile_release="$FIXTURE_TARGET_RELEASE"
      ;;
    SERVICE_ROLLBACK)
      runtime_hostile_suffix=rollback
      runtime_hostile_release="$FIXTURE_ROLLBACK_TARGET_RELEASE"
      ;;
  esac
  runtime_hostile_root="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
    --root "$TEST_TMP/ip-ops-i00-sim-df32-$runtime_hostile_suffix-current-runtime")"
  prepare_fixture_inputs "$runtime_hostile_root"
  runtime_hostile_request="$runtime_hostile_root/authorization/$action_class.request.json"
  runtime_hostile_risk="$runtime_hostile_root/authorization/$action_class.risk.json"
  node "$FIXTURE" request "$CONTRACT" "$runtime_hostile_root" \
    "$action_class" "$runtime_hostile_request"
  runtime_hostile_args=(
    --request "$runtime_hostile_request"
    --class "$action_class"
    --output "$runtime_hostile_risk"
    --simulation-clock --now 2026-07-23T00:00:00Z
    --nonce "$(printf 'c%.0s' {1..64})"
    --simulation-command-root "$runtime_hostile_root/bin"
    --root-mode TEST --proof-root "$runtime_hostile_root"
    --release "$runtime_hostile_release"
    --trusted-build-public-key "$FIXTURE_TRUST_KEY"
    --host-readback "$runtime_hostile_root/host.json"
    --host-evidence "$runtime_hostile_root/host-evidence.json"
    --runtime-env "$runtime_hostile_root/rollback-runtime.env"
    --deploy-env "$runtime_hostile_root/deploy.env"
    --simulation-donor-root "$REPO_ROOT/ops/live"
  )
  if [ "$action_class" = SERVICE_RELEASE_SWITCH ]; then
    runtime_hostile_args+=(--sqlite "$runtime_hostile_root/bin/sqlite3")
  else
    runtime_hostile_args+=(
      --rollback-evidence-root "$runtime_hostile_root/rollback-evidence"
    )
  fi
  assert_failure_contains 'runtime configuration validation failed' \
    node "$RISK_PRODUCER" "${runtime_hostile_args[@]}"
  assert_not_file "$runtime_hostile_risk"
done

note "exact staging app-unit proof requires its bound digest and sentinel group"
assert_success node --input-type=module - \
  "$CONTRACT" "$PROOF_ROOT/authorization/SERVICE_RELEASE_SWITCH.risk.json" <<'NODE'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, riskPath] = process.argv.slice(2);
const { validateDeploymentRiskVersion } = await import(pathToFileURL(contractPath).href);
const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
validateDeploymentRiskVersion(risk);
for (const prefix of [
  'app-unit-proof-absent-sentinel',
  'app-unit-proof-drop-in-sha256',
]) {
  const hostile = structuredClone(risk);
  const index = hostile.action.allowedEndpoints.findIndex(
    (entry) => entry.startsWith(`${prefix}:`),
  );
  if (index < 0) process.exit(1);
  hostile.action.allowedEndpoints[index] = `${prefix}:NONE`;
  try {
    validateDeploymentRiskVersion(hostile);
    process.exit(1);
  } catch (error) {
    if (!String(error).includes('exact staging app unit proof group is internally inconsistent')) {
      process.exit(1);
    }
  }
}
NODE
fi

if [ "${DF32_RUNTIME_FOCUSED:-0}" = 1 ]; then
  RUNTIME_CLASS=SECRET_MATERIALIZATION
  RUNTIME_NODE="$CANONICAL_NODE"
  if [ "$(uname -s)" = Linux ]; then
    RUNTIME_NODE="$PROOF_ROOT/bin/node"
  fi
  RUNTIME_CONSUMPTION="$(json_value \
    "$PROOF_ROOT/authorization/$RUNTIME_CLASS.validation.json" \
    authorizationConsumptionPath)"
  RUNTIME_SCRIPT="$(preview_endpoint \
    "$PROOF_ROOT/authorization/$RUNTIME_CLASS.preview.json" \
    effect-script-path)"
  RUNTIME_START="$(preview_endpoint \
    "$PROOF_ROOT/authorization/$RUNTIME_CLASS.preview.json" \
    effect-start-evidence)"
  RUNTIME_ARGS=(
    "$RUNTIME_NODE"
    "$I00_ROOT/bin/run-bound-effect.mjs"
    --authorization "$PROOF_ROOT/authorization/$RUNTIME_CLASS.authorization.json"
    --deployment-risk "$PROOF_ROOT/authorization/$RUNTIME_CLASS.risk.json"
    --action-preview "$PROOF_ROOT/authorization/$RUNTIME_CLASS.preview.json"
    --authorization-consumption "$RUNTIME_CONSUMPTION"
    --
    "$RUNTIME_SCRIPT"
  )
  if [ "$(uname -s)" = Darwin ]; then
    assert_failure_contains \
      'authorized effect descriptor execution requires Linux' \
      "${RUNTIME_ARGS[@]}"
    assert_not_file "$RUNTIME_START"
  else
    note "Linux runner accepts the exact four-document chain and verifier acknowledgement"
    RUNTIME_FINISH="$(preview_endpoint \
      "$PROOF_ROOT/authorization/$RUNTIME_CLASS.preview.json" \
      effect-finish-evidence)"
    RUNTIME_OUTPUT="$(preview_endpoint \
      "$PROOF_ROOT/authorization/$RUNTIME_CLASS.preview.json" \
      credential-output-path)"
    assert_success "${RUNTIME_ARGS[@]}"
    assert_file "$RUNTIME_START"
    assert_file "$RUNTIME_FINISH"
    assert_file "$RUNTIME_OUTPUT"
    assert_success "$RUNTIME_NODE" --input-type=module - \
      "$I00_ROOT/authorized-effect-evidence.mjs" \
      "$RUNTIME_START" "$RUNTIME_FINISH" <<'NODE'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [evidencePath, startPath, finishPath] = process.argv.slice(2);
const {
  authorizedEffectEvidenceSha256,
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} = await import(pathToFileURL(evidencePath).href);
const start = JSON.parse(readFileSync(startPath, 'utf8'));
const terminal = JSON.parse(readFileSync(finishPath, 'utf8'));
validateAuthorizedEffectStart(start);
validateAuthorizedEffectTerminal(terminal, start);
if (start.actionClass !== 'SECRET_MATERIALIZATION'
    || terminal.status !== 'AUTHORIZED_EFFECT_COMPLETED'
    || terminal.exitCode !== 0
    || terminal.programBindingRetained !== true
    || terminal.successRecorderEligible !== true
    || terminal.startEvidenceSha256 !== authorizedEffectEvidenceSha256(start)
    || start.writeRoots.length !== 0
    || start.readRoots.length !== 0
    || start.observedRoots.length !== 0
    || Object.keys(start.automaticRollback).length !== 0
    || terminal.writeRoots.length !== 0
    || terminal.readRoots.length !== 0
    || terminal.observedRoots.length !== 0
    || Object.keys(terminal.automaticRollback).length !== 0) {
  process.exit(1);
}
NODE
    runtime_file_sha256() {
      "$RUNTIME_NODE" -e '
        const fs=require("node:fs"),crypto=require("node:crypto");
        process.stdout.write(crypto.createHash("sha256")
          .update(fs.readFileSync(process.argv[1])).digest("hex"));
      ' "$1"
    }
    RUNTIME_TERMINAL_SHA="$(runtime_file_sha256 "$RUNTIME_FINISH")"
    note "Linux runner rejects replay after terminal evidence"
    assert_failure "${RUNTIME_ARGS[@]}"
    assert_eq "$(runtime_file_sha256 "$RUNTIME_FINISH")" \
      "$RUNTIME_TERMINAL_SHA"

    make_runtime_negative_chain() {
      local root="$1"
      mkdir -p "$root/authorization" "$root/consumption" "$root/receipts" \
        "$root/effects" "$root/rollback-evidence"
      chmod 700 "$root/authorization" "$root/consumption" "$root/receipts" \
        "$root/effects" "$root/rollback-evidence"
      produce_class "$root" SECRET_MATERIALIZATION
      set_validator_args "$root" SECRET_MATERIALIZATION
      "$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" \
        >"$root/authorization/SECRET_MATERIALIZATION.validation.json"
    }
    run_runtime_negative_chain() {
      local root="$1" node_path="${2:-$1/bin/node}"
      local validation="$root/authorization/SECRET_MATERIALIZATION.validation.json"
      local consumption script
      consumption="$(json_value "$validation" authorizationConsumptionPath)"
      script="$(preview_endpoint \
        "$root/authorization/SECRET_MATERIALIZATION.preview.json" \
        effect-script-path)"
      "$node_path" "$I00_ROOT/bin/run-bound-effect.mjs" \
        --authorization \
        "$root/authorization/SECRET_MATERIALIZATION.authorization.json" \
        --deployment-risk \
        "$root/authorization/SECRET_MATERIALIZATION.risk.json" \
        --action-preview \
        "$root/authorization/SECRET_MATERIALIZATION.preview.json" \
        --authorization-consumption "$consumption" \
        -- "$script"
    }
    mutate_runtime_document() {
      "$RUNTIME_NODE" --input-type=module - "$CONTRACT" "$1" "$2" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, path, kind] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath).href);
const value = JSON.parse(readFileSync(path, 'utf8'));
if (kind === 'authorization') {
  value.ownerApproval.approvedAtUtc = value.startsAtUtc;
} else if (kind === 'risk') {
  value.evidenceValidUntilUtc = value.authorizationWindow.expiresAtUtc;
} else if (kind === 'preview') {
  value.authorizationWindow.issuedAtUtc = value.authorizationWindow.startsAtUtc;
} else if (kind === 'consumption') {
  value.authorizationSha256 = 'f'.repeat(64);
} else {
  process.exit(2);
}
writeFileSync(path, canonicalJsonBytes(value));
NODE
    }

    for mutation in authorization risk preview consumption; do
      note "Linux runner rejects $mutation document digest mutation"
      MUTATION_ROOT="$(create_auxiliary_proof_root "runtime-negative-$mutation")"
      make_runtime_negative_chain "$MUTATION_ROOT"
      case "$mutation" in
        authorization|risk|preview)
          MUTATION_PATH="$MUTATION_ROOT/authorization/SECRET_MATERIALIZATION.$mutation.json"
          ;;
        consumption)
          MUTATION_PATH="$(json_value \
            "$MUTATION_ROOT/authorization/SECRET_MATERIALIZATION.validation.json" \
            authorizationConsumptionPath)"
          ;;
      esac
      mutate_runtime_document "$MUTATION_PATH" "$mutation"
      assert_failure run_runtime_negative_chain "$MUTATION_ROOT"
      assert_not_file "$(preview_endpoint \
        "$MUTATION_ROOT/authorization/SECRET_MATERIALIZATION.preview.json" \
        effect-start-evidence)"
    done

    ROOT_IDENTITY_ROOT="$(create_auxiliary_proof_root runtime-negative-root-identity)"
    note "Linux runner rejects output-root identity replacement"
    make_runtime_negative_chain "$ROOT_IDENTITY_ROOT"
    mv "$ROOT_IDENTITY_ROOT/credentials" \
      "$ROOT_IDENTITY_ROOT/credentials.original"
    mkdir "$ROOT_IDENTITY_ROOT/credentials"
    chmod 700 "$ROOT_IDENTITY_ROOT/credentials"
    assert_failure run_runtime_negative_chain "$ROOT_IDENTITY_ROOT"
    assert_not_file "$(preview_endpoint \
      "$ROOT_IDENTITY_ROOT/authorization/SECRET_MATERIALIZATION.preview.json" \
      effect-start-evidence)"

    ALTERNATE_NODE_ROOT="$(create_auxiliary_proof_root runtime-negative-alternate-node)"
    note "Linux runner rejects an alternate effect program executable"
    make_runtime_negative_chain "$ALTERNATE_NODE_ROOT"
    assert_failure run_runtime_negative_chain \
      "$ALTERNATE_NODE_ROOT" "$CANONICAL_NODE"
    assert_not_file "$(preview_endpoint \
      "$ALTERNATE_NODE_ROOT/authorization/SECRET_MATERIALIZATION.preview.json" \
      effect-start-evidence)"

    PROGRAM_REPLACEMENT_ROOT="$(create_auxiliary_proof_root runtime-negative-program-replacement)"
    note "Linux runner rejects a replaced named effect program"
    make_runtime_negative_chain "$PROGRAM_REPLACEMENT_ROOT"
    mv "$PROGRAM_REPLACEMENT_ROOT/bin/node" \
      "$PROGRAM_REPLACEMENT_ROOT/bin/node.original"
    cp /bin/false "$PROGRAM_REPLACEMENT_ROOT/bin/node"
    chmod 755 "$PROGRAM_REPLACEMENT_ROOT/bin/node"
    assert_failure run_runtime_negative_chain \
      "$PROGRAM_REPLACEMENT_ROOT" "$PROGRAM_REPLACEMENT_ROOT/bin/node.original"
    assert_not_file "$(preview_endpoint \
      "$PROGRAM_REPLACEMENT_ROOT/authorization/SECRET_MATERIALIZATION.preview.json" \
      effect-start-evidence)"

    EXECUTABLE_REPLACEMENT_ROOT="$(create_auxiliary_proof_root runtime-negative-executable-replacement)"
    note "Linux runner rejects a replaced inherited executable capability"
    make_runtime_negative_chain "$EXECUTABLE_REPLACEMENT_ROOT"
    cp /bin/false "$EXECUTABLE_REPLACEMENT_ROOT/bin/aws.next"
    chmod 755 "$EXECUTABLE_REPLACEMENT_ROOT/bin/aws.next"
    mv -f "$EXECUTABLE_REPLACEMENT_ROOT/bin/aws.next" \
      "$EXECUTABLE_REPLACEMENT_ROOT/bin/aws"
    assert_failure run_runtime_negative_chain "$EXECUTABLE_REPLACEMENT_ROOT"
    assert_not_file "$(preview_endpoint \
      "$EXECUTABLE_REPLACEMENT_ROOT/authorization/SECRET_MATERIALIZATION.preview.json" \
      effect-start-evidence)"
  fi
  finish
  exit 0
fi

note "isolated-restore risk production refuses the fixed production target union"
RESTORE_FIXED_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-df32-restore-fixed-root-risk")"
prepare_fixture_inputs "$RESTORE_FIXED_ROOT"
node "$FIXTURE" request "$CONTRACT" "$RESTORE_FIXED_ROOT" ISOLATED_RESTORE \
  "$RESTORE_FIXED_ROOT/request.json"
RESTORE_FIXED_INDEX=0
for protected_target in \
  /opt/cosmos/df32-restore-refusal \
  /var/lib/cosmos/state/df32-restore-refusal \
  /var/backups/cosmos/df32-restore-refusal \
  /etc/cosmos/df32-restore-refusal \
  /run/cosmos-app/df32-restore-refusal \
  /run/cosmos-secret-source/df32-restore-refusal \
  /usr/local/lib/cosmos-ops/df32-restore-refusal
do
  RESTORE_FIXED_INDEX=$((RESTORE_FIXED_INDEX + 1))
  assert_failure_contains 'isolated restore target intersects a fixed production root' \
    node "$RISK_PRODUCER" \
    --request "$RESTORE_FIXED_ROOT/request.json" \
    --class ISOLATED_RESTORE \
    --output "$RESTORE_FIXED_ROOT/authorization/restore-fixed-refused-$RESTORE_FIXED_INDEX.json" \
    --simulation-clock --now 2026-07-23T00:00:00Z \
    --nonce "$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.argv[1]).digest("hex"))' "$protected_target")" \
    --simulation-command-root "$RESTORE_FIXED_ROOT/bin" \
    --root-mode TEST \
    --proof-root "$RESTORE_FIXED_ROOT" \
    --host-readback "$RESTORE_FIXED_ROOT/host.json" \
    --host-evidence "$RESTORE_FIXED_ROOT/host-evidence.json" \
    --runtime-env "$RESTORE_FIXED_ROOT/runtime.env" \
    --backup-env "$RESTORE_FIXED_ROOT/backup.env" \
    --backup "$RESTORE_FIXED_ROOT/backups/exact" \
    --target "$protected_target" \
    --simulation-donor-root "$REPO_ROOT/ops/live"
  assert_not_file "$RESTORE_FIXED_ROOT/authorization/restore-fixed-refused-$RESTORE_FIXED_INDEX.json"
done
ln -s /var/lib "$RESTORE_FIXED_ROOT/fixed-var-lib-alias"
for protected_target in \
  "$RESTORE_FIXED_ROOT/fixed-var-lib-alias/cosmos/state/alias-refusal" \
  "$RESTORE_FIXED_ROOT/fixed-var-lib-alias/../lib/cosmos/ops/dot-alias-refusal"
do
  RESTORE_FIXED_INDEX=$((RESTORE_FIXED_INDEX + 1))
  RESTORE_ALIAS_EXPECTED='isolated restore target intersects a fixed production root'
  case "$protected_target" in
    */../*) RESTORE_ALIAS_EXPECTED='isolated restore target must be one raw canonical bounded absolute path' ;;
  esac
  assert_failure_contains "$RESTORE_ALIAS_EXPECTED" \
    node "$RISK_PRODUCER" \
    --request "$RESTORE_FIXED_ROOT/request.json" \
    --class ISOLATED_RESTORE \
    --output "$RESTORE_FIXED_ROOT/authorization/restore-fixed-refused-$RESTORE_FIXED_INDEX.json" \
    --simulation-clock --now 2026-07-23T00:00:00Z \
    --nonce "$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.argv[1]).digest("hex"))' "$protected_target")" \
    --simulation-command-root "$RESTORE_FIXED_ROOT/bin" \
    --root-mode TEST \
    --proof-root "$RESTORE_FIXED_ROOT" \
    --host-readback "$RESTORE_FIXED_ROOT/host.json" \
    --host-evidence "$RESTORE_FIXED_ROOT/host-evidence.json" \
    --runtime-env "$RESTORE_FIXED_ROOT/runtime.env" \
    --backup-env "$RESTORE_FIXED_ROOT/backup.env" \
    --backup "$RESTORE_FIXED_ROOT/backups/exact" \
    --target "$protected_target" \
    --simulation-donor-root "$REPO_ROOT/ops/live"
  assert_not_file "$RESTORE_FIXED_ROOT/authorization/restore-fixed-refused-$RESTORE_FIXED_INDEX.json"
done

note "authorization consumer binds its executing Node before the single-use claim"
NODE_SUBSTITUTION_ROOT="$(create_auxiliary_proof_root df32-node-substitution)"
produce_class "$NODE_SUBSTITUTION_ROOT" OPS_BUNDLE_INSTALL
set_validator_args "$NODE_SUBSTITUTION_ROOT" OPS_BUNDLE_INSTALL
assert_failure_contains 'validator Node executable differs from the authorized preview binding' \
  "$CANONICAL_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}"
assert_eq "$(find "$NODE_SUBSTITUTION_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

note "authorization consumer detects Node replacement around claim creation"
NODE_TOCTOU_ROOT="$(create_auxiliary_proof_root df32-node-toctou)"
produce_class "$NODE_TOCTOU_ROOT" OPS_BUNDLE_INSTALL
set_validator_args "$NODE_TOCTOU_ROOT" OPS_BUNDLE_INSTALL
NODE_REPLACEMENT="$NODE_TOCTOU_ROOT/bin/node-replacement"
printf '%s\n' '#!/bin/sh' 'exit 97' >"$NODE_REPLACEMENT"
chmod 500 "$NODE_REPLACEMENT"
NODE_MUTATION_HOOK="$NODE_TOCTOU_ROOT/node-mutation-hook.mjs"
cat >"$NODE_MUTATION_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const target = process.env.DF32_NODE_MUTATION_TARGET;
const replacement = process.env.DF32_NODE_MUTATION_REPLACEMENT;
const claimRoot = process.env.DF32_NODE_MUTATION_CLAIM_ROOT;
const originalOpenSync = fs.openSync;
let mutated = false;
function targetsClaimRoot(path) {
  if (typeof path !== 'string') return false;
  if (path.startsWith(`${claimRoot}/`)) return true;
  const anchored = /^\/proc\/self\/fd\/([0-9]+)\/[^/]+$/u.exec(path);
  if (anchored === null) return false;
  try {
    return fs.realpathSync(`/proc/self/fd/${anchored[1]}`) === fs.realpathSync(claimRoot);
  } catch {
    return false;
  }
}
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  if (!mutated
      && targetsClaimRoot(path)
      && (Number(flags) & fs.constants.O_CREAT) !== 0
      && (Number(flags) & fs.constants.O_EXCL) !== 0) {
    mutated = true;
    fs.renameSync(replacement, target);
  }
  return originalOpenSync.call(this, path, flags, ...rest);
};
syncBuiltinESMExports();
NODE
chmod 600 "$NODE_MUTATION_HOOK"
assert_failure_contains 'validator Node executable changed around authorization claim' \
  env DF32_NODE_MUTATION_TARGET="$VALIDATOR_NODE" \
    DF32_NODE_MUTATION_REPLACEMENT="$NODE_REPLACEMENT" \
    DF32_NODE_MUTATION_CLAIM_ROOT="$NODE_TOCTOU_ROOT/consumption" \
    "$VALIDATOR_NODE" --import "$NODE_MUTATION_HOOK" \
    "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}"
assert_eq "$(find "$NODE_TOCTOU_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1

note "authorization claim publication rejects a swapped parent identity"
PARENT_SWAP_ROOT="$(create_auxiliary_proof_root df32-parent-swap)"
produce_class "$PARENT_SWAP_ROOT" OPS_BUNDLE_INSTALL
set_validator_args "$PARENT_SWAP_ROOT" OPS_BUNDLE_INSTALL
PARENT_SWAP_HOOK="$PARENT_SWAP_ROOT/parent-swap-hook.mjs"
cat >"$PARENT_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const claimRoot = process.env.DF32_PARENT_SWAP_TARGET;
const displaced = process.env.DF32_PARENT_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  const descriptor = originalOpenSync.call(this, path, flags, ...rest);
  if (!swapped
      && path === claimRoot
      && (Number(flags) & (fs.constants.O_DIRECTORY ?? 0)) !== 0) {
    swapped = true;
    fs.renameSync(claimRoot, displaced);
    fs.mkdirSync(claimRoot, { mode: 0o700 });
  }
  return descriptor;
};
syncBuiltinESMExports();
NODE
chmod 600 "$PARENT_SWAP_HOOK"
PARENT_SWAP_CLAIMS="$PARENT_SWAP_ROOT/consumption"
PARENT_SWAP_DISPLACED="$PARENT_SWAP_ROOT/consumption.displaced"
assert_failure_contains 'authorization consumption parent path identity changed' \
  env DF32_PARENT_SWAP_TARGET="$PARENT_SWAP_CLAIMS" \
    DF32_PARENT_SWAP_DISPLACED="$PARENT_SWAP_DISPLACED" \
    "$VALIDATOR_NODE" --import "$PARENT_SWAP_HOOK" \
    "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}"
assert_eq "$(find "$PARENT_SWAP_CLAIMS" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
assert_eq "$(find "$PARENT_SWAP_DISPLACED" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

note "risk evidence is class-derived and descriptor-bound"
PROVIDER_CONFIG_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$PROOF_ROOT/config/secrets-provider.json")"
assert_success node - "$PROOF_ROOT/authorization/SECRET_MATERIALIZATION.risk.json" "$PROVIDER_CONFIG_SHA256" <<'NODE'
const fs = require('node:fs');
const [path, providerSha] = process.argv.slice(2);
const risk = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!risk.action.allowedEndpoints.includes(`provider-config-sha256:${providerSha}`)) process.exit(1);
if (JSON.stringify(risk.evidenceProvenance.sources)
    !== JSON.stringify([{ role: 'PROVIDER_CONFIG', sha256: providerSha }])) process.exit(1);
if (risk.enforcementProvenance.source !== 'EXECUTING_I00_ENFORCEMENT_TREE') process.exit(1);
NODE
assert_contains "$(cat "$CONTRACT")" 'constants.O_NOFOLLOW'
assert_contains "$(cat "$CONTRACT")" 'identity changed during descriptor read'
assert_contains "$(cat "$AUTH_VALIDATOR")" 'recheckCanonicalDeploymentDocument'
cp "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" "$PROOF_ROOT/group-writable-risk.json"
chmod 620 "$PROOF_ROOT/group-writable-risk.json"
assert_failure_contains 'mode must be 0600' node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/group-writable-risk.json" \
  --consumption-root "$PROOF_ROOT/consumption" \
  --output "$PROOF_ROOT/authorization/group-writable-preview.json"
ln "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" "$PROOF_ROOT/hardlinked-risk.json"
assert_failure_contains 'missing or unsafe' node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/hardlinked-risk.json" \
  --consumption-root "$PROOF_ROOT/consumption" \
  --output "$PROOF_ROOT/authorization/hardlinked-preview.json"
rm "$PROOF_ROOT/hardlinked-risk.json"

note "producer outputs are immutable and malformed or raw authority inputs fail closed"
OPS_RISK_INPUTS=(
  --class OPS_BUNDLE_INSTALL
  --simulation-clock --now 2026-07-23T00:00:00Z
  --nonce aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  --simulation-command-root "$PROOF_ROOT/bin"
  --root-mode TEST
  --proof-root "$PROOF_ROOT"
  --release "$FIXTURE_TARGET_RELEASE"
  --trusted-build-public-key "$FIXTURE_TRUST_KEY"
  --host-readback "$PROOF_ROOT/host.json"
  --host-evidence "$PROOF_ROOT/host-evidence.json"
  --destination "$PROOF_ROOT/install/i00"
)
node - "$PROOF_ROOT/host.json" "$PROOF_ROOT" <<'NODE'
const fs = require('node:fs');
const [source, root] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(source, 'utf8'));
for (const [name, observedAtUtc] of [
  ['host-stale.json', '2026-07-22T23:54:59Z'],
  ['host-future.json', '2026-07-23T00:00:01Z'],
  ['host-malformed-time.json', '2026-07-23 00:00:00'],
]) {
  fs.writeFileSync(`${root}/${name}`, `${JSON.stringify({ ...base, observedAtUtc }, null, 2)}\n`,
    { mode: 0o600 });
}
NODE
risk_with_host_time() {
  local host_path="$1" output="$2" index
  local -a inputs=("${OPS_RISK_INPUTS[@]}")
  for ((index = 0; index < ${#inputs[@]}; index += 1)); do
    if [ "${inputs[$index]}" = --host-readback ]; then
      inputs[$((index + 1))]="$host_path"
      break
    fi
  done
  node "$RISK_PRODUCER" \
    --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
    "${inputs[@]}" --output "$output"
}
assert_failure_contains 'host readback evidence is stale' \
  risk_with_host_time "$PROOF_ROOT/host-stale.json" "$PROOF_ROOT/authorization/host-stale-risk.json"
assert_failure_contains 'host readback observedAtUtc is in the future' \
  risk_with_host_time "$PROOF_ROOT/host-future.json" "$PROOF_ROOT/authorization/host-future-risk.json"
assert_failure_contains 'host readback observedAtUtc must be exact UTC seconds' \
  risk_with_host_time "$PROOF_ROOT/host-malformed-time.json" \
  "$PROOF_ROOT/authorization/host-malformed-time-risk.json"
assert_failure_contains 'verified deployment evidence expired during risk derivation' \
  node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  "${OPS_RISK_INPUTS[@]}" \
  --simulation-publication-now 2026-07-23T00:06:00Z \
  --output "$PROOF_ROOT/authorization/delayed-publication-risk.json"
assert_not_file "$PROOF_ROOT/authorization/delayed-publication-risk.json"
cp "$PROOF_ROOT/host-evidence.json" "$PROOF_ROOT/group-writable-host-evidence.json"
chmod 620 "$PROOF_ROOT/group-writable-host-evidence.json"
assert_failure_contains 'must not be group/world writable' node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  --class OPS_BUNDLE_INSTALL \
  --simulation-clock --now 2026-07-23T00:00:00Z \
  --nonce bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --simulation-command-root "$PROOF_ROOT/bin" \
  --root-mode TEST \
  --proof-root "$PROOF_ROOT" \
  --release "$FIXTURE_TARGET_RELEASE" \
  --trusted-build-public-key "$FIXTURE_TRUST_KEY" \
  --host-readback "$PROOF_ROOT/host.json" \
  --host-evidence "$PROOF_ROOT/group-writable-host-evidence.json" \
  --destination "$PROOF_ROOT/install/i00" \
  --output "$PROOF_ROOT/authorization/group-writable-evidence-risk.json"
assert_failure node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  "${OPS_RISK_INPUTS[@]}" --output "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json"
assert_failure node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  --consumption-root "$PROOF_ROOT/consumption" \
  --output "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json"
assert_failure_contains 'unsupported argument --risk-version' node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  "${OPS_RISK_INPUTS[@]}" --output "$PROOF_ROOT/authorization/raw-risk.json" \
  --risk-version caller-fabricated
assert_failure_contains 'unsupported argument --server-preview-digest' node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  --consumption-root "$PROOF_ROOT/consumption" \
  --output "$PROOF_ROOT/authorization/raw-preview.json" \
  --server-preview-digest caller-fabricated
assert_failure_contains 'duplicate argument --request' node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  "${OPS_RISK_INPUTS[@]}" \
  --request "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  --output "$PROOF_ROOT/authorization/duplicate-input.json"

node --input-type=module - "$CONTRACT" "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" "$PROOF_ROOT/request-extra.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const value = JSON.parse(readFileSync(process.argv[3], 'utf8'));
value.unreviewedAuthority = 'forbidden';
writeFileSync(process.argv[4], canonicalJsonBytes(value), { mode: 0o600 });
NODE
assert_failure node "$RISK_PRODUCER" \
  --request "$PROOF_ROOT/request-extra.json" \
  "${OPS_RISK_INPUTS[@]}" \
  --output "$PROOF_ROOT/authorization/request-extra-risk.json"

node --input-type=module - "$CONTRACT" "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" "$PROOF_ROOT/risk-tampered.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const value = JSON.parse(readFileSync(process.argv[3], 'utf8'));
value.riskVersion = `i00-deployment-risk-v1:sha256:${'f'.repeat(64)}`;
writeFileSync(process.argv[4], canonicalJsonBytes(value), { mode: 0o600 });
NODE
assert_failure node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/risk-tampered.json" \
  --consumption-root "$PROOF_ROOT/consumption" \
  --output "$PROOF_ROOT/authorization/risk-tampered-preview.json"

note "default-clock validation rechecks the live window immediately before claiming"
NEAR_EXPIRY_ROOT="$(create_auxiliary_proof_root near-expiry)"
produce_class "$NEAR_EXPIRY_ROOT" OPS_BUNDLE_INSTALL
cp "$NEAR_EXPIRY_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  "$NEAR_EXPIRY_ROOT/near-expiry-source-risk.json"
rm "$NEAR_EXPIRY_ROOT/authorization/OPS_BUNDLE_INSTALL.request.json" \
  "$NEAR_EXPIRY_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  "$NEAR_EXPIRY_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json" \
  "$NEAR_EXPIRY_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json"
node --input-type=module - \
  "$CONTRACT" "$NEAR_EXPIRY_ROOT/near-expiry-source-risk.json" "$NEAR_EXPIRY_ROOT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, sourceRiskPath, root] = process.argv.slice(2);
const {
  buildTestDeploymentActionPreview,
  buildTestDeploymentRiskVersion,
  canonicalJsonBytes,
  sha256Bytes,
} = await import(pathToFileURL(resolve(contractPath)).href);
const source = JSON.parse(readFileSync(sourceRiskPath, 'utf8'));
const request = {
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: 'near-expiry-hostile-proof',
  operator: source.binding.operator,
  approver: source.binding.approver,
  approvalReference: 'near-expiry-hostile-proof',
  startsAtUtc: '2026-07-23T00:00:00Z',
  expiresAtUtc: '2026-07-23T00:00:02Z',
  receiptTargets: {
    result: resolve(root, 'receipts', 'OPS_BUNDLE_INSTALL.result.json'),
    reconciliation: resolve(root, 'receipts', 'OPS_BUNDLE_INSTALL.reconciliation.json'),
  },
};
const evidence = {
  actionClass: source.binding.actionClass,
  deployedSha: source.binding.deployedSha,
  configVersion: source.binding.configVersion,
  account: source.binding.account,
  environment: source.binding.environment,
  host: source.binding.host,
  allowedEndpoints: source.action.allowedEndpoints,
  evidenceProvenance: source.evidenceProvenance,
  enforcementProvenance: source.enforcementProvenance,
};
const risk = buildTestDeploymentRiskVersion(request, evidence, {
  issuedAtUtc: '2026-07-23T00:00:00Z',
  evidenceValidUntilUtc: '2026-07-23T00:00:02Z',
  nonce: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  provenanceMode: 'TEST_FIXTURE_INJECTED',
  artifactPolicy: source.artifactPolicy,
});
const riskBytes = canonicalJsonBytes(risk);
const preview = buildTestDeploymentActionPreview(
  risk,
  sha256Bytes(riskBytes),
  resolve(root, 'consumption'),
);
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
const authorization = {
  schemaVersion: 2,
  authorizationId: binding.authorizationId,
  operator: binding.operator,
  status: 'APPROVED',
  actionClasses: [binding.actionClass],
  scope: action.scope,
  deployedSha: binding.deployedSha,
  configVersion: binding.configVersion,
  riskVersion: binding.riskVersion,
  nonce: binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: binding.account,
  environment: binding.environment,
  host: binding.host,
  issuedAtUtc: window.issuedAtUtc,
  startsAtUtc: window.startsAtUtc,
  expiresAtUtc: window.expiresAtUtc,
  allowedCommands: [action.command],
  allowedEndpoints: action.allowedEndpoints,
  allowedProducts: action.allowedProducts,
  allowedCredentials: action.allowedCredentials,
  preconditions: action.preconditions,
  maximumEffect: action.maximumEffect,
  rollback: action.rollback,
  recovery: action.recovery,
  ownerApproval: {
    approver: binding.approver,
    approvedAtUtc: window.issuedAtUtc,
    reference: binding.approvalReference,
  },
  receiptTargets: action.receiptTargets,
};
writeFileSync(
  resolve(root, 'authorization', 'OPS_BUNDLE_INSTALL.request.json'),
  canonicalJsonBytes(request),
  { mode: 0o600 },
);
writeFileSync(
  resolve(root, 'authorization', 'OPS_BUNDLE_INSTALL.risk.json'),
  riskBytes,
  { mode: 0o600 },
);
writeFileSync(
  resolve(root, 'authorization', 'OPS_BUNDLE_INSTALL.preview.json'),
  canonicalJsonBytes(preview),
  { mode: 0o600 },
);
writeFileSync(
  resolve(root, 'authorization', 'OPS_BUNDLE_INSTALL.authorization.json'),
  canonicalJsonBytes(authorization),
  { mode: 0o600 },
);
NODE
cat >"$NEAR_EXPIRY_ROOT/controlled-clock.mjs" <<'NODE'
const RealDate = globalThis.Date;
const instants = [
  '2026-07-23T00:00:01Z',
  '2026-07-23T00:00:02Z',
];
let index = 0;
globalThis.Date = class ControlledDate extends RealDate {
  constructor(...args) {
    if (args.length > 0) {
      super(...args);
      return;
    }
    super(instants[Math.min(index, instants.length - 1)]);
    index += 1;
  }
};
NODE
chmod 600 "$NEAR_EXPIRY_ROOT/controlled-clock.mjs"
assert_success node --input-type=module - "$AUTH_VALIDATOR" <<'NODE'
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[2], 'utf8');
const initial = source.indexOf('const initialEvaluationTime =');
const recheck = source.indexOf('recheckCanonicalDeploymentDocument(');
const finalClock = source.indexOf('consumedAtUtc =', recheck);
const claim = source.indexOf('consumptionEvidence = consumeAuthorization(', finalClock);
if (initial < 0 || recheck < initial || finalClock < recheck || claim < finalClock
    || !source.slice(finalClock, claim).includes(': currentUtcSecond();')) {
  process.exit(1);
}
NODE
assert_eq "$(find "$NEAR_EXPIRY_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

BAD_MODE_ROOT="$PROOF_ROOT/bad-mode-claims"
mkdir "$BAD_MODE_ROOT"
chmod 755 "$BAD_MODE_ROOT"
assert_failure node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  --consumption-root "$BAD_MODE_ROOT" \
  --output "$PROOF_ROOT/authorization/bad-mode-preview.json"
ln -s "$PROOF_ROOT/consumption" "$PROOF_ROOT/symlink-claims"
assert_failure node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  --consumption-root "$PROOF_ROOT/symlink-claims" \
  --output "$PROOF_ROOT/authorization/symlink-preview.json"

note "one concurrent authorization consumer wins the exact claim"
CONCURRENT_ROOT="$(create_auxiliary_proof_root df32-concurrent)"
produce_class "$CONCURRENT_ROOT" BACKUP_CREATE
set_validator_args "$CONCURRENT_ROOT" BACKUP_CREATE
set +e
"$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" >"$CONCURRENT_ROOT/one.out" 2>"$CONCURRENT_ROOT/one.err" &
PID_ONE=$!
"$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" >"$CONCURRENT_ROOT/two.out" 2>"$CONCURRENT_ROOT/two.err" &
PID_TWO=$!
wait "$PID_ONE"; RC_ONE=$?
wait "$PID_TWO"; RC_TWO=$?
set -e
assert_eq "$(( (RC_ONE == 0) + (RC_TWO == 0) ))" 1
assert_eq "$(find "$CONCURRENT_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1

note "outcome recorder rejects a forged single-use consumption claim before publication"
HOSTILE_OUTCOME_ROOT="$(create_auxiliary_proof_root df32-hostile-outcome)"
produce_class "$HOSTILE_OUTCOME_ROOT" OPS_BUNDLE_INSTALL
set_validator_args "$HOSTILE_OUTCOME_ROOT" OPS_BUNDLE_INSTALL
"$VALIDATOR_NODE" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" \
  >"$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.validation.json"
HOSTILE_CONSUMPTION="$(json_value \
  "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.validation.json" \
  consumptionReceipt)"
node --input-type=module - "$CONTRACT" "$HOSTILE_CONSUMPTION" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const value = JSON.parse(readFileSync(process.argv[3], 'utf8'));
value.authorizationId = 'forged-consumption-identity';
writeFileSync(process.argv[3], canonicalJsonBytes(value), { mode: 0o600 });
NODE
materialize_fixture_installed_ops "$HOSTILE_OUTCOME_ROOT/install/i00"
HOSTILE_EFFECT_START="$(preview_endpoint \
  "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json" \
  effect-start-evidence)"
HOSTILE_EFFECT_FINISH="$(preview_endpoint \
  "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json" \
  effect-finish-evidence)"
assert_failure_contains \
  'authorization consumption receipt is not the exact producer-bound claim' \
  node "$OUTCOME_RECORDER" \
  --class OPS_BUNDLE_INSTALL \
  --authorization "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" \
  --deployment-risk "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
  --action-preview "$HOSTILE_OUTCOME_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json" \
  --authorization-consumption "$HOSTILE_CONSUMPTION" \
  --result-receipt "$HOSTILE_OUTCOME_ROOT/receipts/OPS_BUNDLE_INSTALL.result.json" \
  --reconciliation-receipt "$HOSTILE_OUTCOME_ROOT/receipts/OPS_BUNDLE_INSTALL.reconciliation.json" \
  --primary-path "$HOSTILE_OUTCOME_ROOT/install/i00" \
  --evidence-file "$HOSTILE_OUTCOME_ROOT/install/i00/install-receipt.json" \
  --effect-start-evidence "$HOSTILE_EFFECT_START" \
  --effect-finish-evidence "$HOSTILE_EFFECT_FINISH" \
  --simulation-clock --now 2026-07-23T00:16:00Z
assert_not_file "$HOSTILE_OUTCOME_ROOT/receipts/OPS_BUNDLE_INSTALL.result.json"
assert_not_file "$HOSTILE_OUTCOME_ROOT/receipts/OPS_BUNDLE_INSTALL.reconciliation.json"

note "outcome SQLite verification is descriptor-bound against temporary-path substitution"
OUTCOME_SOURCE="$(cat "$OUTCOME_RECORDER")"
assert_contains "$OUTCOME_SOURCE" "realpathSync('/tmp')"
assert_contains "$OUTCOME_SOURCE" 'temporary base is not a trusted root-owned sticky boundary'
assert_contains "$OUTCOME_SOURCE" "'/proc/self/fd/3'"
assert_contains "$OUTCOME_SOURCE" "'/dev/fd/3'"
assert_contains "$OUTCOME_SOURCE" "stdio: ['ignore', 'pipe', 'pipe', database.descriptor]"
assert_contains "$OUTCOME_SOURCE" 'isolated database changed during SQLite verification'
if printf '%s' "$OUTCOME_SOURCE" | grep -F 'process.env.TMPDIR' >/dev/null; then
  fail_test "outcome SQLite verification retains a caller-controlled temporary base"
fi
pass_assertion

note "class registry and caller bindings are closed"
assert_contains "$(cat "$CONTRACT")" 'fsyncSync(parentDescriptor)'
assert_contains "$(cat "$AUTH_VALIDATOR")" 'producer provenance mode does not match'
assert_success node --input-type=module - "$CONTRACT" <<'NODE'
import { pathToFileURL } from 'node:url';
const { DEPLOYMENT_ACTION_CLASSES } = await import(pathToFileURL(process.argv[2]).href);
const expected = ['BACKUP_CREATE','ISOLATED_RESTORE','OPS_BUNDLE_INSTALL','SECRET_MATERIALIZATION','SERVICE_RELEASE_SWITCH','SERVICE_ROLLBACK'];
if (JSON.stringify([...DEPLOYMENT_ACTION_CLASSES].sort()) !== JSON.stringify(expected)) process.exit(1);
NODE
for caller in release-switch.sh rollback-switch.sh install-ops-bundle.sh backup-verify.sh restore-drill-verify.sh secret-materialization.mjs; do
  SOURCE="$(cat "$I00_ROOT/bin/$caller")"
  assert_contains "$SOURCE" --deployment-risk
  assert_contains "$SOURCE" --action-preview
  assert_contains "$SOURCE" --consumption-root
  for forbidden in --risk-version --authorization-nonce --server-preview-digest; do
    if printf '%s' "$SOURCE" | grep -F -- "$forbidden" >/dev/null; then
      fail_test "$caller retains removed raw authority option $forbidden"
    fi
    pass_assertion
  done
  assert_eq "$(grep -c 'validate-authorization\.mjs' "$I00_ROOT/bin/$caller")" 1
done
for caller in backup-verify.sh restore-drill-verify.sh secret-materialization.mjs; do
  SOURCE="$(cat "$I00_ROOT/bin/$caller")"
  assert_contains "$SOURCE" 'record-authorized-action-outcome.mjs'
  assert_contains "$SOURCE" --authorization-consumption
  assert_contains "$SOURCE" --effect-start-evidence
  assert_contains "$SOURCE" --effect-finish-evidence
  if printf '%s' "$SOURCE" | grep -F -- --preflight >/dev/null; then
    fail_test "$caller retains retired pre-effect outcome publication"
  fi
  pass_assertion
done
INSTALL_SOURCE="$(cat "$I00_ROOT/bin/install-ops-bundle.sh")"
assert_contains "$INSTALL_SOURCE" 'record-authorized-action-outcome.mjs'
assert_contains "$INSTALL_SOURCE" --authorization-consumption
assert_contains "$INSTALL_SOURCE" --effect-start-evidence
assert_contains "$INSTALL_SOURCE" --effect-finish-evidence
if printf '%s' "$INSTALL_SOURCE" | grep -F -- --preflight >/dev/null; then
  fail_test "install wrapper invokes the outcome recorder before a valid effect terminal"
fi
pass_assertion

note "backup and restore callers bind and recheck the exact SQLite executable"
for caller in backup-verify.sh restore-drill-verify.sh; do
  SOURCE="$(cat "$I00_ROOT/bin/$caller")"
  assert_contains "$SOURCE" 'inspect-executable.mjs'
  assert_contains "$SOURCE" 'sqlite-path:$SQLITE_PATH'
  assert_contains "$SOURCE" 'sqlite-sha256:$SQLITE_SHA256'
  assert_contains "$SOURCE" 'sqlite-identity:$SQLITE_IDENTITY_ENDPOINT'
  assert_contains "$SOURCE" '"$SQLITE_PATH" --version'
  assert_contains "$SOURCE" 'require_sqlite_identity'
  assert_contains "$SOURCE" 'require_delegate_env_identity'
  if printf '%s' "$SOURCE" | grep -F 'sqlite-command:' >/dev/null; then
    fail_test "$caller retains an executable command-string endpoint"
  fi
  pass_assertion
  if printf '%s' "$SOURCE" | grep -F '$($SQLITE ' >/dev/null; then
    fail_test "$caller executes an unquoted SQLite command string"
  fi
  pass_assertion
done
fi

if [ -n "${DF32_RELEASE:-}" ] || [ -n "${DF32_TRUST_KEY:-}" ]; then
  [ "$(uname -s)" = Linux ] || fail_test "actual-input acceptance requires Linux"
  [ -n "${DF32_RELEASE:-}" ] && [ -n "${DF32_TRUST_KEY:-}" ] \
    || fail_test "actual Linux proof requires both DF32_RELEASE and DF32_TRUST_KEY"
  [ -n "${DF32_TARGET_ACCOUNT:-}" ] && [ -n "${DF32_TARGET_HOST:-}" ] \
    || fail_test "actual Linux proof requires the accepted target account and host"
  [ -n "${DF32_STAGING_ROOT:-}" ] \
    || fail_test "actual Linux proof requires the guarded DF32_STAGING_ROOT"
  [ -n "${DF32_APP_UNIT:-}" ] \
    || fail_test "actual Linux proof requires the exact application unit"
  [[ "$DF32_STAGING_ROOT" =~ ^/var/tmp/cosmos-df32-proof-([0-9a-f]{4})$ ]] \
    || fail_test "DF32_STAGING_ROOT must be one exact four-suffix proof root"
  DF32_PROOF_SUFFIX="${BASH_REMATCH[1]}"
  [ "$DF32_APP_UNIT" = "cosmos-df32-proof-$DF32_PROOF_SUFFIX.service" ] \
    || fail_test "DF32_APP_UNIT must match the exact proof-root suffix"
  IFS=$'\t' read -r ACTUAL_PROOF_HOST ACTUAL_PROOF_ENVIRONMENT \
    <<<"$(actual_proof_owner_values "$DF32_PROOF_SUFFIX")"
  [ -n "$ACTUAL_PROOF_HOST" ] && [ -n "$ACTUAL_PROOF_ENVIRONMENT" ] \
    || fail_test "actual proof owner binding is unavailable"
  case "$I00_ROOT" in
    "$DF32_STAGING_ROOT"/*) ;;
    *) fail_test "actual Linux proof tooling must be inside the isolated staging root" ;;
  esac
  case "$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DF32_RELEASE")" in
    "$DF32_STAGING_ROOT"/*) ;;
    *) fail_test "actual Linux proof release must be inside the isolated staging root" ;;
  esac
  case "$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$DF32_TRUST_KEY")" in
    "$DF32_STAGING_ROOT"/*) ;;
    *) fail_test "actual Linux proof trust key must be inside the isolated staging root" ;;
  esac
  AWS_INVOCATION_MARKER="$PROOF_ROOT/aws-cli-invoked"
  GIT_INVOCATION_MARKER="$PROOF_ROOT/git-invoked"
  NO_AWS_BIN="$PROOF_ROOT/no-external-bin"
  mkdir "$NO_AWS_BIN"
  chmod 700 "$NO_AWS_BIN"
  printf '%s\n' '#!/bin/sh' \
    ': >"${DF32_AWS_INVOCATION_MARKER:?}"' \
    'exit 97' >"$NO_AWS_BIN/aws"
  printf '%s\n' '#!/bin/sh' \
    ': >"${DF32_GIT_INVOCATION_MARKER:?}"' \
    'exit 97' >"$NO_AWS_BIN/git"
  chmod 700 "$NO_AWS_BIN/aws" "$NO_AWS_BIN/git"
  export DF32_AWS_INVOCATION_MARKER="$AWS_INVOCATION_MARKER"
  export DF32_GIT_INVOCATION_MARKER="$GIT_INVOCATION_MARKER"
  PATH="$NO_AWS_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
  export PATH
  HOSTILE_NODE_MARKER="$PROOF_ROOT/hostile-node-options-loaded"
  HOSTILE_NODE_CACHE="$PROOF_ROOT/hostile-node-compile-cache"
  HOSTILE_NODE_HOOK="$PROOF_ROOT/hostile-node-options-hook.mjs"
  node - "$HOSTILE_NODE_HOOK" "$HOSTILE_NODE_MARKER" <<'NODE'
const fs = require('node:fs');
const [output, marker] = process.argv.slice(2);
fs.writeFileSync(output, [
  "import { writeFileSync } from 'node:fs';",
  `writeFileSync(${JSON.stringify(marker)}, 'LOADED\\n', { flag: 'wx', mode: 0o600 });`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
NODE
  run_fixed_gate() {
    /usr/bin/env \
      NODE_OPTIONS="--import=$HOSTILE_NODE_HOOK" \
      NODE_COMPILE_CACHE="$HOSTILE_NODE_CACHE" \
      "$FIXED_GATE_LAUNCHER" "$@"
  }
  RELEASE_TREE_BEFORE="$(release_tree_digest "$DF32_RELEASE")"
  RELEASE_CRITICAL_BEFORE="$(node -e 'const fs=require("fs"),c=require("crypto"),p=require("path");const r=process.argv[1];for(const f of ["release.json","artifact-manifest.json","receipts/complete-local-acceptance.json"]){process.stdout.write(c.createHash("sha256").update(fs.readFileSync(p.join(r,f))).digest("hex")+"\\n")}' "$DF32_RELEASE")"
  RELEASE_MANIFEST_BEFORE="$(node -e 'const fs=require("fs"),c=require("crypto"),p=require("path");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(p.join(process.argv[1],"artifact-manifest.json"))).digest("hex"))' "$DF32_RELEASE")"
  assert_not_file "$DF32_RELEASE/ops/i00/bin/produce-deployment-risk-version.mjs"
  assert_not_file "$DF32_RELEASE/ops/i00/bin/produce-deployment-action-preview.mjs"
  set +e
  node "$DF32_RELEASE/ops/i00/bin/validate-release.mjs" \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    >"$PROOF_ROOT/sealed-baseline-validator.out" \
    2>"$PROOF_ROOT/sealed-baseline-validator.err"
  SEALED_BASELINE_RC=$?
  set -e
  [ "$SEALED_BASELINE_RC" -ne 0 ] \
    || fail_test "sealed baseline validator unexpectedly accepted the host-portable receipt"
  if grep -Eq \
      'canonical complete acceptance validation failed: .*COMPLETE_RECEIPT_(PLAN|STEP_COMMAND)_INVALID' \
      "$PROOF_ROOT/sealed-baseline-validator.err"; then
    BASELINE_RED_STATUS=KNOWN_HOST_PORTABILITY_REJECTION
  elif grep -F \
      'L15 amendment contract.authorizedEffectRuntime is required' \
      "$PROOF_ROOT/sealed-baseline-validator.err" >/dev/null; then
    node - "$DF32_RELEASE/ops/i00/l15-amendment-contract.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (Object.hasOwn(value, 'authorizedEffectRuntime')) process.exit(1);
NODE
    BASELINE_RED_STATUS=KNOWN_PRE_DF32_L15_RUNTIME_BINDING_REJECTION
  else
    fail_test "sealed baseline validator did not expose one exact corrected DF32 rejection"
  fi
  ACCEPTED_DONOR_ROOT="$I00_ROOT/accepted-ops-live"
  [ ! -e "$ACCEPTED_DONOR_ROOT" ] \
    || fail_test "isolated tooling archive already contains an accepted donor root"
  mkdir "$ACCEPTED_DONOR_ROOT"
  cp -R "$REPO_ROOT/ops/live/." "$ACCEPTED_DONOR_ROOT/"
  chmod -R a-w "$ACCEPTED_DONOR_ROOT"
  DONOR_VERIFICATION="$(node "$I00_ROOT/bin/verify-donor-root.mjs" \
    --root "$ACCEPTED_DONOR_ROOT" --require-immutable)"
  DONOR_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).immutableDonorContractSha256)' "$DONOR_VERIFICATION")"
  L15_AMENDMENT_CONTRACT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).amendmentContractSha256)' "$DONOR_VERIFICATION")"
  EFFECTIVE_DONOR_TREE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).effectiveRootDigestSha256)' "$DONOR_VERIFICATION")"
  EFFECTIVE_DONOR_IDENTITY="$(node -e '
    const fs=require("fs");
    const s=fs.lstatSync(process.argv[1],{bigint:true});
    process.stdout.write([
      `device=${s.dev}`,`inode=${s.ino}`,`mode=${s.mode.toString(8)}`,
      `size=${s.size}`,`mtimeNs=${s.mtimeNs}`,`ctimeNs=${s.ctimeNs}`,
    ].join(","));
  ' "$ACCEPTED_DONOR_ROOT")"
  chown -R 0:0 "$I00_ROOT"
  chmod -R a-w "$I00_ROOT"
  run_fixed_gate validate-release.mjs \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    >"$PROOF_ROOT/actual-release-validation.json"
  assert_eq "$(json_value "$PROOF_ROOT/actual-release-validation.json" status)" RELEASE_VALID_NOT_DEPLOYED
  assert_eq "$(json_value "$PROOF_ROOT/actual-release-validation.json" validatorCohortMode)" PINNED_LEGACY_VALIDATION_ONLY
  assert_failure_contains 'validation-only legacy cohort compatibility cannot authorize a release effect' \
    run_fixed_gate validate-release.mjs \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    --require-exact-cohort
  assert_not_file "$HOSTILE_NODE_MARKER"
  assert_not_file "$HOSTILE_NODE_CACHE"

  ACTUAL_ROOT="$PROOF_ROOT/actual-bundle-producers"
  mkdir "$ACTUAL_ROOT"
  chmod 700 "$ACTUAL_ROOT"
  ACTUAL_EVIDENCE_ROOT="$PROOF_ROOT/evidence"
  mkdir "$ACTUAL_EVIDENCE_ROOT"
  chmod 700 "$ACTUAL_EVIDENCE_ROOT"
  SQLITE_BIN="$FIXED_SQLITE"
  SQLITE_VERSION="$FIXED_SQLITE_VERSION"
  SQLITE_INSPECTION="$(node "$I00_ROOT/bin/inspect-executable.mjs" --path "$SQLITE_BIN")"
  SQLITE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SQLITE_INSPECTION")"
  SQLITE_IDENTITY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SQLITE_INSPECTION")"
  [ "$SQLITE_SHA256" = "$FIXED_SQLITE_SHA256" ] \
    && [ "$SQLITE_IDENTITY" = "$FIXED_SQLITE_IDENTITY" ] \
    || fail_test "fixed SQLite binding changed before actual Linux proof"
  inspect_actual_executable() {
    local requested canonical inspection
    requested="$1"
    canonical="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$requested")"
    inspection="$(node "$EXECUTABLE_INSPECTOR" --path "$canonical")"
    node -e '
      const value=JSON.parse(process.argv[1]);
      process.stdout.write(`${value.path}\t${value.sha256}\t${value.endpointIdentity}`);
    ' "$inspection"
  }
  producer_fixed_command() {
    local name candidate
    name="$1"
    case "$name" in
      node) set -- /usr/bin/node /bin/node /usr/sbin/node /sbin/node /usr/local/bin/node ;;
      env) set -- /usr/bin/env /bin/env /usr/sbin/env /sbin/env /usr/local/bin/env ;;
      systemctl) set -- /usr/bin/systemctl /bin/systemctl /usr/sbin/systemctl /sbin/systemctl /usr/local/bin/systemctl ;;
      systemd-analyze) set -- /usr/bin/systemd-analyze /bin/systemd-analyze /usr/sbin/systemd-analyze /sbin/systemd-analyze /usr/local/bin/systemd-analyze ;;
      curl) set -- /usr/bin/curl /bin/curl /usr/sbin/curl /sbin/curl /usr/local/bin/curl ;;
      mkdir) set -- /usr/bin/mkdir /bin/mkdir /usr/sbin/mkdir /sbin/mkdir /usr/local/bin/mkdir ;;
      cp) set -- /usr/bin/cp /bin/cp /usr/sbin/cp /sbin/cp /usr/local/bin/cp ;;
      chmod) set -- /usr/bin/chmod /bin/chmod /usr/sbin/chmod /sbin/chmod /usr/local/bin/chmod ;;
      mv) set -- /usr/bin/mv /bin/mv /usr/sbin/mv /sbin/mv /usr/local/bin/mv ;;
      rm) set -- /usr/bin/rm /bin/rm /usr/sbin/rm /sbin/rm /usr/local/bin/rm ;;
      tar) set -- /usr/bin/tar /bin/tar /usr/sbin/tar /sbin/tar /usr/local/bin/tar ;;
      hash) set -- /usr/bin/sha256sum /bin/sha256sum /usr/sbin/sha256sum /sbin/sha256sum /usr/local/bin/sha256sum /usr/bin/shasum /bin/shasum /usr/sbin/shasum /sbin/shasum /usr/local/bin/shasum ;;
      *) fail_test "unknown producer fixed command $name" ;;
    esac
    for candidate in "$@"; do
      if [ -x "$candidate" ]; then
        node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$candidate"
        return 0
      fi
    done
    fail_test "producer fixed command is unavailable: $name"
  }
  IFS=$'\t' read -r NODE_BIN NODE_SHA256 NODE_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command node)")"
  IFS=$'\t' read -r ENV_BIN ENV_SHA256 ENV_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command env)")"
  IFS=$'\t' read -r SYSTEMD_ANALYZE_BIN SYSTEMD_ANALYZE_SHA256 SYSTEMD_ANALYZE_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command systemd-analyze)")"
  IFS=$'\t' read -r CURL_BIN CURL_SHA256 CURL_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command curl)")"
  IFS=$'\t' read -r MKDIR_BIN MKDIR_SHA256 MKDIR_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command mkdir)")"
  IFS=$'\t' read -r CP_BIN CP_SHA256 CP_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command cp)")"
  IFS=$'\t' read -r CHMOD_BIN CHMOD_SHA256 CHMOD_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command chmod)")"
  IFS=$'\t' read -r MV_BIN MV_SHA256 MV_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command mv)")"
  IFS=$'\t' read -r RM_BIN RM_SHA256 RM_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command rm)")"
  IFS=$'\t' read -r TAR_BIN TAR_SHA256 TAR_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command tar)")"
  IFS=$'\t' read -r HASH_BIN HASH_SHA256 HASH_IDENTITY \
    <<<"$(inspect_actual_executable "$(producer_fixed_command hash)")"
  IFS=$'\t' read -r BASH_BIN BASH_SHA256 BASH_IDENTITY \
    <<<"$(inspect_actual_executable /bin/bash)"
  STAGING_BACKUP_ROOT="$PROOF_ROOT/backups"
  STAGING_DATA_ROOT="$PROOF_ROOT/data"
  STAGING_RUNTIME_ROOT="$PROOF_ROOT/runtime"
  STAGING_EVIDENCE_DATA_ROOT="$PROOF_ROOT/evidence-data"
  STAGING_MODEL_ROOT="$PROOF_ROOT/models"
  STAGING_OPS_STATE_ROOT="$PROOF_ROOT/ops-state"
  STAGING_COSMOS_ROOT="$PROOF_ROOT/cosmos"
  STAGING_SANITIZED_ROOT="$PROOF_ROOT/sanitized"
  STAGING_FIRST_HOST_EVIDENCE_ROOT="$PROOF_ROOT/first-host-evidence"
  STAGING_FIRST_HOST_OFFLINE_ROOT="$PROOF_ROOT/first-host-offline-systemd"
  STAGING_INSTALL_ROOT="$PROOF_ROOT/install"
  mkdir -p "$STAGING_BACKUP_ROOT/exact" "$STAGING_DATA_ROOT" "$STAGING_RUNTIME_ROOT" \
    "$STAGING_EVIDENCE_DATA_ROOT" "$STAGING_MODEL_ROOT" "$STAGING_OPS_STATE_ROOT" \
    "$STAGING_COSMOS_ROOT/releases" "$STAGING_SANITIZED_ROOT" \
    "$STAGING_FIRST_HOST_EVIDENCE_ROOT" "$STAGING_FIRST_HOST_OFFLINE_ROOT" \
    "$STAGING_INSTALL_ROOT"
  chmod 700 "$STAGING_BACKUP_ROOT" "$STAGING_BACKUP_ROOT/exact" \
    "$STAGING_DATA_ROOT" "$STAGING_RUNTIME_ROOT" "$STAGING_EVIDENCE_DATA_ROOT" \
    "$STAGING_MODEL_ROOT" "$STAGING_OPS_STATE_ROOT" "$STAGING_COSMOS_ROOT" \
    "$STAGING_COSMOS_ROOT/releases" "$STAGING_SANITIZED_ROOT" \
    "$STAGING_FIRST_HOST_EVIDENCE_ROOT" "$STAGING_FIRST_HOST_OFFLINE_ROOT" \
    "$STAGING_INSTALL_ROOT"
  ALTERNATE_CALLER_BASH="$PROOF_ROOT/alternate-caller-bash"
  cp "$BASH_BIN" "$ALTERNATE_CALLER_BASH"
  chmod 500 "$ALTERNATE_CALLER_BASH"
  "$SQLITE_BIN" "$STAGING_BACKUP_ROOT/exact/cosmos.db" \
    'PRAGMA journal_mode=DELETE; CREATE TABLE events(id INTEGER PRIMARY KEY);'
  chmod 600 "$STAGING_BACKUP_ROOT/exact/cosmos.db"
  node - "$STAGING_BACKUP_ROOT/exact" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
const database = fs.readFileSync(path.join(directory, 'cosmos.db'));
const manifest = {
  backupId: path.basename(directory),
  createdAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  dbFile: 'cosmos.db',
  dbSha256: crypto.createHash('sha256').update(database).digest('hex'),
  dbBytes: database.length,
  eventsCount: 0,
  dataSchema: null,
  integrityCheck: 'ok',
  evidence: [],
};
fs.writeFileSync(path.join(directory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
  BACKUP_INSPECTION="$(node "$BACKUP_INSPECTOR" --path "$STAGING_BACKUP_ROOT/exact")"
  BACKUP_MANIFEST_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).manifestSha256)' "$BACKUP_INSPECTION")"
  BACKUP_DATABASE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).databaseSha256)' "$BACKUP_INSPECTION")"
  BACKUP_IDENTITY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$BACKUP_INSPECTION")"
  node --input-type=module - \
    "$CONTRACT" "$DF32_RELEASE" "$ACTUAL_ROOT" "$PROOF_ROOT" \
    "$SQLITE_BIN" "$DF32_APP_UNIT" "$ACTUAL_PROOF_PORT" \
    "$ACTUAL_PROOF_START_LEAD_SECONDS" <<'NODE'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [
  contractPath, releaseInput, rootInput, proofInput, sqliteInput, appUnit, appPort,
  startLeadSeconds,
] = process.argv.slice(2);
const startLeadMs = Number(startLeadSeconds) * 1000;
if (appPort !== '8080'
    || !Number.isSafeInteger(startLeadMs)
    || startLeadMs < 600_000) process.exit(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);
const releaseRoot = realpathSync(releaseInput);
const root = realpathSync(rootInput);
const proofRoot = realpathSync(proofInput);
const sqlite = realpathSync(sqliteInput);
const release = JSON.parse(readFileSync(resolve(releaseRoot, 'release.json'), 'utf8'));
writeFileSync(resolve(proofRoot, 'runtime', 'cosmos-app.env'), [
  'HOST=127.0.0.1',
  `PORT=${appPort}`,
  `DATA_DIR=${resolve(proofRoot, 'data')}`,
  `EVIDENCE_DIR=${resolve(proofRoot, 'evidence-data')}`,
  `MODEL_DIR=${resolve(proofRoot, 'models')}`,
  `BACKUP_DIR=${resolve(proofRoot, 'backups')}`,
  'CONTROL_ROOM_OPERATOR_EMAIL=operator@cosmos.local',
  'CF_ACCESS_TEAM_DOMAIN=https://df32.cloudflareaccess.com',
  'CF_ACCESS_AUD=df32proofaud',
  `I00_TESTED_SHA=${release.testedSha}`,
  `I00_DEPLOYED_SHA=${release.testedSha}`,
  `I00_CONFIG_REVISION=${release.configRevision}`,
  'I00_MODEL_REVISION=df32-proof-model',
  'I00_PUBLIC_SOURCE_STARTUP_EGRESS=1',
  '',
].join('\n'), { mode: 0o600 });
writeFileSync(resolve(root, 'deploy.env'), [
  `COSMOS_ROOT=${resolve(proofRoot, 'cosmos')}`,
  `RELEASES_DIR=${resolve(proofRoot, 'cosmos', 'releases')}`,
  `CURRENT_LINK=${resolve(proofRoot, 'cosmos', 'current')}`,
  `PREVIOUS_LINK=${resolve(proofRoot, 'cosmos', 'previous')}`,
  `DATA_DIR=${resolve(proofRoot, 'data')}`,
  `OPS_STATE_DIR=${resolve(proofRoot, 'ops-state')}`,
  `APP_UNIT=${appUnit}`,
  `HEALTH_BASE=http://127.0.0.1:${appPort}`,
  'GATE_TIMEOUT_SEC=60',
  'HTTP_TIMEOUT_SEC=5',
  'LOCK_TIMEOUT_SEC=30',
  'I00_OPS_READBACK_TIMEOUT_MS=750',
  '',
].join('\n'), { mode: 0o600 });
writeFileSync(resolve(root, 'backup.env'), [
  `DATA_DIR=${resolve(proofRoot, 'data')}`,
  `OPS_STATE_DIR=${resolve(proofRoot, 'ops-state')}`,
  `APP_UNIT=${appUnit}`,
  `BACKUP_DIR=${resolve(proofRoot, 'backups')}`,
  `SQLITE=${sqlite}`,
  '',
].join('\n'), { mode: 0o600 });
const now = Date.now();
const startsAtUtc = new Date(
  Math.ceil(now / 1000) * 1000 + startLeadMs,
).toISOString().replace('.000Z', 'Z');
const expiresAtUtc = new Date(Math.ceil(now / 1000) * 1000 + 3_300_000).toISOString().replace('.000Z', 'Z');
const common = {
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  operator: 'isolated-staging-operator',
  approver: 'isolated-staging-proof-owner',
  approvalReference: 'isolated-staging-proof-not-production-authorization',
  startsAtUtc,
  expiresAtUtc,
};
const positiveClasses = new Set([
  'OPS_BUNDLE_INSTALL',
  'SERVICE_RELEASE_SWITCH',
  'BACKUP_CREATE',
  'ISOLATED_RESTORE',
]);
const authorizationIds = {
  OPS_BUNDLE_INSTALL: 'isolated-staging-actual-ops-bundle-install',
  SERVICE_RELEASE_SWITCH: 'isolated-staging-actual-release-switch',
  BACKUP_CREATE: 'isolated-staging-actual-backup-create',
  ISOLATED_RESTORE: 'isolated-staging-actual-isolated-restore',
};
for (const actionClass of positiveClasses) {
  const ownerRequest = {
    ...common,
    authorizationId: authorizationIds[actionClass],
    receiptTargets: {
      result: resolve(proofRoot, 'receipts', `${actionClass}.result.json`),
      reconciliation: resolve(proofRoot, 'receipts', `${actionClass}.reconciliation.json`),
    },
  };
  writeFileSync(
    resolve(proofRoot, 'authorization', `${actionClass}.request.json`),
    canonicalJsonBytes(ownerRequest),
    { mode: 0o600 },
  );
}
NODE

  [ "$(id -u)" = 0 ] \
    || fail_test "actual Linux app-unit proof requires the root SSM identity"
  getent passwd cosmos >/dev/null \
    || fail_test "actual Linux app-unit proof requires the cosmos user"
  getent group cosmos >/dev/null \
    || fail_test "actual Linux app-unit proof requires the cosmos group"
  APP_UNIT_STEM="${DF32_APP_UNIT%.service}"
  APP_UNIT_PROOF_DROP_IN_NAME="90-$APP_UNIT_STEM.conf"
  mkdir "$DF32_STAGING_ROOT/systemd"
  chmod 700 "$DF32_STAGING_ROOT/systemd"
  APP_UNIT_FRAGMENT_PATH="$DF32_STAGING_ROOT/systemd/$DF32_APP_UNIT"
  APP_UNIT_FRAGMENT_SOURCE="$ACCEPTED_DONOR_ROOT/systemd/cosmos-app.service"
  cp "$APP_UNIT_FRAGMENT_SOURCE" "$APP_UNIT_FRAGMENT_PATH"
  chmod 400 "$APP_UNIT_FRAGMENT_PATH"
  APP_UNIT_PROOF_DROP_IN_DIR="$DF32_STAGING_ROOT/systemd/$DF32_APP_UNIT.d"
  APP_UNIT_PROOF_DROP_IN="$APP_UNIT_PROOF_DROP_IN_DIR/$APP_UNIT_PROOF_DROP_IN_NAME"
  APP_UNIT_PROOF_ABSENT_SENTINEL="$DF32_STAGING_ROOT/.do-not-start-$APP_UNIT_STEM"
  [ ! -e "$APP_UNIT_PROOF_ABSENT_SENTINEL" ] \
    || fail_test "isolated staging app unit start sentinel must be absent"
  mkdir "$APP_UNIT_PROOF_DROP_IN_DIR"
  chmod 700 "$APP_UNIT_PROOF_DROP_IN_DIR"
  printf '%s\n' \
    '[Unit]' \
    "ConditionPathExists=$APP_UNIT_PROOF_ABSENT_SENTINEL" \
    '' \
    '[Service]' \
    'EnvironmentFile=' \
    "EnvironmentFile=$STAGING_RUNTIME_ROOT/cosmos-app.env" \
    >"$APP_UNIT_PROOF_DROP_IN"
  chmod 400 "$APP_UNIT_PROOF_DROP_IN"
  APP_UNIT_STAGING_SYSTEMCTL="$DF32_STAGING_ROOT/tools/systemctl"
  APP_UNIT_STAGING_STATE="$STAGING_RUNTIME_ROOT/systemctl-state"
  mkdir "$DF32_STAGING_ROOT/tools"
  chmod 700 "$DF32_STAGING_ROOT/tools"
  printf 'inactive\n' >"$APP_UNIT_STAGING_STATE"
  {
    printf '%s\n' '#!/bin/sh' 'set -eu'
    printf '[ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = %s ] || exit 91\n' \
      "$DF32_APP_UNIT"
    printf 'state="$(/bin/cat %s)"\n' "$APP_UNIT_STAGING_STATE"
    printf '%s\n' \
      '[ "$state" = inactive ] || exit 92' \
      "printf 'inactive\\n'" \
      'exit 3'
  } >"$APP_UNIT_STAGING_SYSTEMCTL"
  chmod 600 "$APP_UNIT_STAGING_STATE"
  chmod 500 "$APP_UNIT_STAGING_SYSTEMCTL"
  IFS=$'\t' read -r APP_UNIT_STAGING_SYSTEMCTL_PATH \
    APP_UNIT_STAGING_SYSTEMCTL_SHA256 APP_UNIT_STAGING_SYSTEMCTL_IDENTITY \
    <<<"$(inspect_actual_executable "$APP_UNIT_STAGING_SYSTEMCTL")"
  [ "$APP_UNIT_STAGING_SYSTEMCTL_PATH" = "$APP_UNIT_STAGING_SYSTEMCTL" ] \
    || fail_test "staging systemctl canonical path changed"
  FIRST_HOST_ENV="$STAGING_SANITIZED_ROOT/deploy.env"
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
    --env "$ACTUAL_ROOT/deploy.env" \
    --output "$FIRST_HOST_ENV" \
    --profile deploy \
    --provenance-mode STAGING \
    --provenance-root "$DF32_STAGING_ROOT" \
    --node "$NODE_BIN" \
    --bash "$BASH_BIN" \
    --env-bin "$ENV_BIN" \
    --systemctl "$APP_UNIT_STAGING_SYSTEMCTL" \
    --curl "$CURL_BIN" \
    --require-effect-bindings \
    --require-first-host-no-current \
    >"$ACTUAL_ROOT/deploy-sanitize.out"
  if grep -q '^ALERT_CMD=' "$FIRST_HOST_ENV"; then
    fail_test "deploy sanitizer retained caller ALERT_CMD"
  fi
  pass_assertion
  BACKUP_SANITIZED_ENV="$STAGING_SANITIZED_ROOT/backup.env"
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
    --env "$ACTUAL_ROOT/backup.env" \
    --output "$BACKUP_SANITIZED_ENV" \
    --profile backup \
    --provenance-mode STAGING \
    --provenance-root "$DF32_STAGING_ROOT" \
    --node "$NODE_BIN" \
    --bash "$BASH_BIN" \
    --env-bin "$ENV_BIN" \
    --sqlite "$SQLITE_BIN" \
    --tar "$TAR_BIN" \
    --hash "$HASH_BIN" \
    --require-effect-bindings \
    --require-hash \
    >"$ACTUAL_ROOT/backup-sanitize.out"
  APP_UNIT_INSPECTION="$(run_fixed_gate inspect-app-unit.mjs \
    --systemctl "$APP_UNIT_STAGING_SYSTEMCTL" \
    --unit "$DF32_APP_UNIT" \
    --node "$NODE_BIN" \
    --env "$ENV_BIN" \
    --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env" \
    --provenance-mode STAGING \
    --expected-fragment-path "$APP_UNIT_FRAGMENT_PATH" \
    --expected-fragment-source "$APP_UNIT_FRAGMENT_SOURCE" \
    --staging-root "$DF32_STAGING_ROOT" \
    --offline-unit-root "$DF32_STAGING_ROOT/systemd" \
    --systemd-analyze "$SYSTEMD_ANALYZE_BIN" \
    --proof-drop-in "$APP_UNIT_PROOF_DROP_IN" \
    --proof-absent-sentinel "$APP_UNIT_PROOF_ABSENT_SENTINEL")"
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$APP_UNIT_INSPECTION")" \
    APP_UNIT_BINDING_VERIFIED
  APP_UNIT_BINDING_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bindingSha256)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_AUTHORITY_CLOSURE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).authorityClosureSha256)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_EXEC_START_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).execStartSha256)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_FRAGMENT_IDENTITY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).fragmentEndpointIdentity)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_FRAGMENT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).fragmentSha256)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_RUNTIME_ENV_IDENTITY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).runtimeEnvEndpointIdentity)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_RUNTIME_ENV_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).runtimeEnvSha256)' "$APP_UNIT_INSPECTION")"
  APP_UNIT_UNSET_ENVIRONMENT_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).unsetEnvironmentSha256)' "$APP_UNIT_INSPECTION")"
  case "$APP_UNIT_FRAGMENT_PATH" in
    "$DF32_STAGING_ROOT"/*) ;;
    *) fail_test "actual Linux proof app-unit fragment must be inside the isolated staging root" ;;
  esac
  FIRST_HOST_DIR="$STAGING_FIRST_HOST_EVIDENCE_ROOT/first-host-readback.$DF32_PROOF_SUFFIX"
  mkdir "$FIRST_HOST_DIR"
  chmod 700 "$FIRST_HOST_DIR"
  node "$I00_ROOT/bin/first-host-readback.mjs" \
    --env "$FIRST_HOST_ENV" \
    --release "$DF32_RELEASE" \
    --output-dir "$FIRST_HOST_DIR" \
    --evidence-root "$STAGING_FIRST_HOST_EVIDENCE_ROOT" \
    --provenance-mode STAGING \
    --provenance-root "$DF32_STAGING_ROOT" \
    --account "$DF32_TARGET_ACCOUNT" \
    --target-host "$ACTUAL_PROOF_HOST" \
    --environment "$ACTUAL_PROOF_ENVIRONMENT" \
    --backup-reserve-bytes 4096 \
    --sqlite "$SQLITE_BIN" \
    --offline-unit-root "$STAGING_FIRST_HOST_OFFLINE_ROOT" \
    >"$ACTUAL_ROOT/first-host-readback.out"
  assert_eq "$(json_value "$ACTUAL_ROOT/first-host-readback.out" status)" FIRST_HOST_READBACK_CREATED
  assert_eq "$(json_value "$FIRST_HOST_DIR/collected-evidence.json" baseline.unit.unit)" "$DF32_APP_UNIT"
  assert_eq "$(json_value "$FIRST_HOST_DIR/collected-evidence.json" baseline.unit.state)" INACTIVE

  assert_not_file "$PROOF_ROOT/authorization/SERVICE_ROLLBACK.request.json"
  assert_not_file "$PROOF_ROOT/authorization/SECRET_MATERIALIZATION.request.json"
  assert_not_file "$PROOF_ROOT/credentials/app-secrets.json"
  assert_not_file "$AWS_INVOCATION_MARKER"
  assert_not_file "$GIT_INVOCATION_MARKER"
  assert_eq "$(find "$PROOF_ROOT/authorization" -mindepth 1 -maxdepth 1 -type f -name '*.request.json' | wc -l | tr -d ' ')" 4
  printf '[Unit]\nDescription=hostile\n' \
    >"$STAGING_FIRST_HOST_OFFLINE_ROOT/$DF32_APP_UNIT"
  chmod 400 "$STAGING_FIRST_HOST_OFFLINE_ROOT/$DF32_APP_UNIT"
  assert_failure_contains 'first-host offline unit root differs from collected evidence' \
    run_fixed_gate produce-deployment-risk-version.mjs \
    --request "$PROOF_ROOT/authorization/SERVICE_RELEASE_SWITCH.request.json" \
    --class SERVICE_RELEASE_SWITCH \
    --root-mode STAGING \
    --proof-root "$PROOF_ROOT" \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env" \
    --deploy-env "$ACTUAL_ROOT/deploy.env" \
    --sqlite "$SQLITE_BIN" \
    --first-host-evidence-dir "$FIRST_HOST_DIR" \
    --isolated-staging-root "$DF32_STAGING_ROOT" \
    --app-unit-fragment "$APP_UNIT_FRAGMENT_PATH" \
    --output "$PROOF_ROOT/authorization/stale-offline-unit.risk.json"
  assert_not_file "$PROOF_ROOT/authorization/stale-offline-unit.risk.json"
  rm "$STAGING_FIRST_HOST_OFFLINE_ROOT/$DF32_APP_UNIT"
  FIRST_HOST_ORIGINAL="$ACTUAL_ROOT/first-host-original"
  mkdir "$FIRST_HOST_ORIGINAL"
  chmod 700 "$FIRST_HOST_ORIGINAL"
  cp -p "$FIRST_HOST_DIR"/*.json "$FIRST_HOST_ORIGINAL/"
  node - "$FIRST_HOST_DIR" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const evidencePath = path.resolve(root, 'collected-evidence.json');
const hostPath = path.resolve(root, 'host.json');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
evidence.derived.cleanBaseline = false;
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
const host = JSON.parse(fs.readFileSync(hostPath, 'utf8'));
host.evidenceSha256 = crypto.createHash('sha256').update(evidenceBytes).digest('hex');
fs.writeFileSync(evidencePath, evidenceBytes, { mode: 0o600 });
fs.writeFileSync(hostPath, `${JSON.stringify(host, null, 2)}\n`, { mode: 0o600 });
NODE
  assert_failure_contains 'first-host canonical semantic preflight failed' \
    run_fixed_gate produce-deployment-risk-version.mjs \
    --request "$PROOF_ROOT/authorization/SERVICE_RELEASE_SWITCH.request.json" \
    --class SERVICE_RELEASE_SWITCH \
    --root-mode STAGING \
    --proof-root "$PROOF_ROOT" \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env" \
    --deploy-env "$ACTUAL_ROOT/deploy.env" \
    --sqlite "$SQLITE_BIN" \
    --first-host-evidence-dir "$FIRST_HOST_DIR" \
    --isolated-staging-root "$DF32_STAGING_ROOT" \
    --app-unit-fragment "$APP_UNIT_FRAGMENT_PATH" \
    --output "$PROOF_ROOT/authorization/dirty-baseline.risk.json"
  assert_not_file "$PROOF_ROOT/authorization/dirty-baseline.risk.json"
  for evidence_name in collected-evidence.json host.json sqlite-readback.json supervisor.json; do
    cp -p "$FIRST_HOST_ORIGINAL/$evidence_name" "$FIRST_HOST_DIR/$evidence_name.next"
    mv -f "$FIRST_HOST_DIR/$evidence_name.next" "$FIRST_HOST_DIR/$evidence_name"
  done
  for action_class in "${ACTUAL_POSITIVE_CLASSES[@]}"; do
    ACTUAL_RISK_ARGS=()
    case "$action_class" in
      OPS_BUNDLE_INSTALL)
        ACTUAL_RISK_ARGS=(
          --release "$DF32_RELEASE"
          --trusted-build-public-key "$DF32_TRUST_KEY"
          --host-readback "$FIRST_HOST_DIR/host.json"
          --host-evidence "$FIRST_HOST_DIR/collected-evidence.json"
          --destination "$STAGING_INSTALL_ROOT/i00"
        )
        ;;
      SERVICE_RELEASE_SWITCH)
        ACTUAL_RISK_ARGS=(
          --release "$DF32_RELEASE"
          --trusted-build-public-key "$DF32_TRUST_KEY"
          --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env"
          --deploy-env "$ACTUAL_ROOT/deploy.env"
          --sqlite "$SQLITE_BIN"
          --first-host-evidence-dir "$FIRST_HOST_DIR"
          --isolated-staging-root "$DF32_STAGING_ROOT"
          --app-unit-fragment "$APP_UNIT_FRAGMENT_PATH"
        )
        ;;
      BACKUP_CREATE)
        ACTUAL_RISK_ARGS=(
          --host-readback "$FIRST_HOST_DIR/host.json"
          --host-evidence "$FIRST_HOST_DIR/collected-evidence.json"
          --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env"
          --backup-env "$ACTUAL_ROOT/backup.env"
        )
        ;;
      ISOLATED_RESTORE)
        ACTUAL_RISK_ARGS=(
          --host-readback "$FIRST_HOST_DIR/host.json"
          --host-evidence "$FIRST_HOST_DIR/collected-evidence.json"
          --runtime-env "$STAGING_RUNTIME_ROOT/cosmos-app.env"
          --backup-env "$ACTUAL_ROOT/backup.env"
          --backup "$STAGING_BACKUP_ROOT/exact"
          --target "$DF32_STAGING_ROOT/restore"
        )
        ;;
      *) fail_test "unexpected actual positive class $action_class" ;;
    esac
    run_fixed_gate produce-deployment-risk-version.mjs \
      --request "$PROOF_ROOT/authorization/$action_class.request.json" \
      --class "$action_class" \
      --root-mode STAGING \
      --proof-root "$PROOF_ROOT" \
      "${ACTUAL_RISK_ARGS[@]}" \
      --output "$PROOF_ROOT/authorization/$action_class.risk.json" \
      >"$ACTUAL_ROOT/$action_class.risk.out"
    assert_endpoint_family_inventory \
      "$PROOF_ROOT/authorization/$action_class.risk.json" "$action_class"
    run_fixed_gate produce-deployment-action-preview.mjs \
      --deployment-risk "$PROOF_ROOT/authorization/$action_class.risk.json" \
      --consumption-root "$PROOF_ROOT/consumption" \
      --output "$PROOF_ROOT/authorization/$action_class.preview.json" \
      >"$ACTUAL_ROOT/$action_class.preview.out"
    node --input-type=module - "$CONTRACT" "$PROOF_ROOT" "$action_class" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, root, actionClass] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);
const risk = JSON.parse(readFileSync(
  resolve(root, 'authorization', `${actionClass}.risk.json`),
  'utf8',
));
const preview = JSON.parse(readFileSync(
  resolve(root, 'authorization', `${actionClass}.preview.json`),
  'utf8',
));
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
writeFileSync(resolve(
  root,
  'authorization',
  `${actionClass}.authorization.json`,
), canonicalJsonBytes({
  schemaVersion: 2,
  authorizationId: binding.authorizationId,
  operator: binding.operator,
  status: 'APPROVED',
  actionClasses: [binding.actionClass],
  scope: action.scope,
  deployedSha: binding.deployedSha,
  configVersion: binding.configVersion,
  riskVersion: binding.riskVersion,
  nonce: binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: binding.account,
  environment: binding.environment,
  host: binding.host,
  issuedAtUtc: window.issuedAtUtc,
  startsAtUtc: window.startsAtUtc,
  expiresAtUtc: window.expiresAtUtc,
  allowedCommands: [action.command],
  allowedEndpoints: action.allowedEndpoints,
  allowedProducts: action.allowedProducts,
  allowedCredentials: action.allowedCredentials,
  preconditions: action.preconditions,
  maximumEffect: action.maximumEffect,
  rollback: action.rollback,
  recovery: action.recovery,
  ownerApproval: {
    approver: binding.approver,
    approvedAtUtc: risk.authorizationWindow.issuedAtUtc,
    reference: binding.approvalReference,
  },
  receiptTargets: action.receiptTargets,
}), { mode: 0o600 });
NODE
    assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.risk.json" status)" BOUND_NOT_AUTHORIZED
    assert_eq "$(json_value "$ACTUAL_ROOT/$action_class.risk.out" status)" BOUND_NOT_AUTHORIZED
    assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.preview.json" status)" PREVIEW_READY_NOT_AUTHORIZED
    assert_eq "$(json_value "$ACTUAL_ROOT/$action_class.preview.out" status)" PREVIEW_READY_NOT_AUTHORIZED
    assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.risk.json" provenanceMode)" STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE
    assert_eq "$(json_value "$PROOF_ROOT/authorization/$action_class.preview.json" provenanceMode)" STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE
    assert_eq "$(stat -c '%a' "$PROOF_ROOT/authorization/$action_class.risk.json")" 600
    assert_eq "$(stat -c '%a' "$PROOF_ROOT/authorization/$action_class.preview.json")" 600
    assert_success node - "$PROOF_ROOT/authorization/$action_class.risk.json" "$action_class" <<'NODE'
const fs = require('node:fs');
const risk = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const actionClass = process.argv[3];
const alertEndpoints = risk.action.allowedEndpoints.filter(
  (endpoint) => endpoint.startsWith('alert-helper-'),
);
const exactlyOne = (prefix) => alertEndpoints.filter(
  (endpoint) => endpoint.startsWith(prefix),
).length === 1;
const releaseAlertPolicy = alertEndpoints.length === 5
  && exactlyOne('alert-helper-identity:')
  && exactlyOne('alert-helper-path:')
  && exactlyOne('alert-helper-sha256:')
  && alertEndpoints.includes('alert-helper-argv-shape:SEVERITY_CODE_MESSAGE')
  && alertEndpoints.includes('alert-helper-timeout-ms:5000');
if ((actionClass === 'SERVICE_RELEASE_SWITCH' && !releaseAlertPolicy)
    || (actionClass !== 'SERVICE_RELEASE_SWITCH' && alertEndpoints.length !== 0)) {
  process.exit(1);
}
NODE
  done
  node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const delay=Math.max(0,Date.parse(v.startsAtUtc)-Date.now()+100);setTimeout(()=>{},delay);' "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json"
  set_actual_validator_args "$PROOF_ROOT" OPS_BUNDLE_INSTALL
  ACTUAL_NEAR_EXPIRY_HOOK="$ACTUAL_ROOT/default-clock-recheck.mjs"
  node - "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" \
    "$ACTUAL_NEAR_EXPIRY_HOOK" <<'NODE'
const fs = require('node:fs');
const [authorizationPath, output] = process.argv.slice(2);
const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
fs.writeFileSync(output, [
  'const RealDate = globalThis.Date;',
  `const instants = ${JSON.stringify([
    authorization.startsAtUtc,
    authorization.expiresAtUtc,
  ])};`,
  'let index = 0;',
  'globalThis.Date = class ControlledDate extends RealDate {',
  '  constructor(...args) {',
  '    if (args.length > 0) { super(...args); return; }',
  '    super(instants[Math.min(index, instants.length - 1)]);',
  '    index += 1;',
  '  }',
  '};',
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
NODE
  assert_failure_contains 'external authorization expired before single-use claim' \
    "$VALIDATOR_NODE" --import "$ACTUAL_NEAR_EXPIRY_HOOK" \
    "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}"
  assert_eq "$(find "$PROOF_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
  note "actual Linux install wrapper rejects an alternate outer Bash before claim consumption"
  assert_failure_contains 'running Bash differs from the risk-bound Bash endpoint' \
    "$ALTERNATE_CALLER_BASH" -p "$I00_ROOT/bin/install-ops-bundle.sh" \
    --release "$DF32_RELEASE" \
    --destination "$STAGING_INSTALL_ROOT/i00" \
    --authorization "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" \
    --operator "$(json_value "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" operator)" \
    --config-version "$(json_value "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" configVersion)" \
    --deployment-risk "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.risk.json" \
    --action-preview "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.preview.json" \
    --authorization-consumption-root "$PROOF_ROOT/consumption" \
    --host "$(json_value "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" host)" \
    --environment "$(json_value "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" environment)" \
    --account "$(json_value "$PROOF_ROOT/authorization/OPS_BUNDLE_INSTALL.authorization.json" account)" \
    --result-receipt "$PROOF_ROOT/receipts/OPS_BUNDLE_INSTALL.result.json" \
    --reconciliation-receipt "$PROOF_ROOT/receipts/OPS_BUNDLE_INSTALL.reconciliation.json" \
    --trusted-build-public-key "$DF32_TRUST_KEY"
  assert_eq "$(find "$PROOF_ROOT/consumption" \
    -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
  EXPECTED_ACTUAL_CONSUMPTION_COUNT=0
  for action_class in "${ACTUAL_POSITIVE_CLASSES[@]}"; do
    set_actual_validator_args "$PROOF_ROOT" "$action_class"
    run_fixed_gate validate-authorization.mjs \
      "${VALIDATOR_ARGS[@]}" >"$ACTUAL_ROOT/$action_class.validation.json"
    assert_eq "$(json_value "$ACTUAL_ROOT/$action_class.validation.json" status)" AUTHORIZATION_VALID
    assert_eq "$(json_value "$ACTUAL_ROOT/$action_class.validation.json" consumptionStatus)" AUTHORIZATION_CONSUMED
    EXPECTED_ACTUAL_CONSUMPTION_COUNT=$((EXPECTED_ACTUAL_CONSUMPTION_COUNT + 1))
    assert_eq "$(find "$PROOF_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" \
      "$EXPECTED_ACTUAL_CONSUMPTION_COUNT"
    assert_failure_contains EEXIST run_fixed_gate validate-authorization.mjs \
      "${VALIDATOR_ARGS[@]}"
    assert_eq "$(find "$PROOF_ROOT/consumption" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" \
      "$EXPECTED_ACTUAL_CONSUMPTION_COUNT"
  done

  run_fixed_gate validate-release.mjs \
    --release "$DF32_RELEASE" \
    --trusted-build-public-key "$DF32_TRUST_KEY" \
    >"$PROOF_ROOT/actual-release-validation-after.json"
  assert_eq "$(json_value "$PROOF_ROOT/actual-release-validation-after.json" status)" RELEASE_VALID_NOT_DEPLOYED
  RELEASE_TREE_AFTER="$(release_tree_digest "$DF32_RELEASE")"
  RELEASE_CRITICAL_AFTER="$(node -e 'const fs=require("fs"),c=require("crypto"),p=require("path");const r=process.argv[1];for(const f of ["release.json","artifact-manifest.json","receipts/complete-local-acceptance.json"]){process.stdout.write(c.createHash("sha256").update(fs.readFileSync(p.join(r,f))).digest("hex")+"\\n")}' "$DF32_RELEASE")"
  RELEASE_MANIFEST_AFTER="$(node -e 'const fs=require("fs"),c=require("crypto"),p=require("path");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(p.join(process.argv[1],"artifact-manifest.json"))).digest("hex"))' "$DF32_RELEASE")"
  assert_eq "$RELEASE_TREE_AFTER" "$RELEASE_TREE_BEFORE"
  assert_eq "$RELEASE_CRITICAL_AFTER" "$RELEASE_CRITICAL_BEFORE"
  assert_eq "$RELEASE_MANIFEST_AFTER" "$RELEASE_MANIFEST_BEFORE"
  INSTALL_SIM_PARENT="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
  INSTALL_SIM_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$INSTALL_SIM_PARENT/ip-ops-i00-sim-df32-$$")"
  assert_failure_contains 'validation-only legacy cohort compatibility cannot authorize a release effect' \
    env I00_TRUSTED_BUILD_PUBLIC_KEY="$DF32_TRUST_KEY" \
    "$I00_ROOT/bin/install-ops-bundle.sh" \
    --release "$DF32_RELEASE" \
    --destination "$INSTALL_SIM_ROOT/installed-ops" \
    --simulation --simulation-root "$INSTALL_SIM_ROOT"
  assert_not_file "$INSTALL_SIM_ROOT/installed-ops"
  chmod -R u+w "$INSTALL_SIM_ROOT"
  rm -rf "$INSTALL_SIM_ROOT"
  assert_not_file "$PROOF_ROOT/authorization/SERVICE_ROLLBACK.request.json"
  assert_not_file "$PROOF_ROOT/authorization/SERVICE_ROLLBACK.authorization.json"
  assert_not_file "$ACTUAL_ROOT/SERVICE_ROLLBACK.validation.json"
  assert_not_file "$PROOF_ROOT/authorization/SECRET_MATERIALIZATION.request.json"
  assert_not_file "$PROOF_ROOT/authorization/SECRET_MATERIALIZATION.authorization.json"
  assert_not_file "$ACTUAL_ROOT/SECRET_MATERIALIZATION.validation.json"
  assert_not_file "$PROOF_ROOT/authorization/WATCHDOG_ACTIVATION.request.json"
  assert_not_file "$PROOF_ROOT/authorization/WATCHDOG_ACTIVATION.authorization.json"
  assert_not_file "$ACTUAL_ROOT/WATCHDOG_ACTIVATION.validation.json"
  assert_not_file "$PROOF_ROOT/credentials/app-secrets.json"
  assert_not_file "$AWS_INVOCATION_MARKER"
  assert_not_file "$GIT_INVOCATION_MARKER"
  assert_not_file "$HOSTILE_NODE_MARKER"
  assert_not_file "$HOSTILE_NODE_CACHE"

  KEYLESS_MARKER="$ACTUAL_EVIDENCE_ROOT/keyless-negative.json"
  node - "$KEYLESS_MARKER" <<'NODE'
const fs = require('node:fs');
const output = process.argv[2];
const document = {
  status: 'KEYLESS_NEGATIVE_VERIFIED',
  secretRequest: 'ABSENT',
  credentialOutput: 'ABSENT',
  awsCliInvocation: 'NONE',
  secretProviderInvocation: 'NONE',
  rollbackRequest: 'ABSENT',
  rollbackInvocation: 'NONE',
};
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
NODE

  ACTUAL_PROOF_SUMMARY="$ACTUAL_EVIDENCE_ROOT/actual-linux-proof.json"
  node - "$PROOF_ROOT" "$ACTUAL_ROOT" "$ACTUAL_PROOF_SUMMARY" \
    "$RELEASE_TREE_BEFORE" "$RELEASE_TREE_AFTER" \
    "$RELEASE_MANIFEST_BEFORE" "$RELEASE_MANIFEST_AFTER" \
    "$BASELINE_RED_STATUS" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [
  proofRoot,
  diagnosticsRoot,
  output,
  treeBefore,
  treeAfter,
  manifestBefore,
  manifestAfter,
  baselineRed,
] = process.argv.slice(2);
const classes = [
  'OPS_BUNDLE_INSTALL',
  'SERVICE_RELEASE_SWITCH',
  'BACKUP_CREATE',
  'ISOLATED_RESTORE',
];
const readAuthority = (actionClass, suffix) => JSON.parse(fs.readFileSync(
  path.resolve(proofRoot, 'authorization', `${actionClass}.${suffix}.json`),
  'utf8',
));
const readValidation = (actionClass) => JSON.parse(fs.readFileSync(
  path.resolve(diagnosticsRoot, `${actionClass}.validation.json`),
  'utf8',
));
const rows = classes.map((actionClass) => ({
  actionClass,
  risk: readAuthority(actionClass, 'risk').status,
  preview: readAuthority(actionClass, 'preview').status,
  authorization: readValidation(actionClass).status,
  consumption: readValidation(actionClass).consumptionStatus,
  replay: 'REJECTED_SINGLE_USE',
}));
const document = {
  status: 'DF32_ACTUAL_LINUX_PROOF_ACCEPTED',
  redGreen: [
    {
      cohort: 'SEALED_BASELINE',
      validator: baselineRed,
      riskProducer: 'MISSING',
      previewProducer: 'MISSING',
      status: 'RED',
    },
    {
      cohort: 'DF32_FIXED',
      validator: 'ACCEPTED',
      producers: 'ACCEPTED',
      gitDependency: 'ABSENT',
      status: 'GREEN',
    },
  ],
  releaseValidator: 'RELEASE_VALID_NOT_DEPLOYED',
  validatorCohort: 'PINNED_LEGACY_VALIDATION_ONLY',
  classes: rows,
  negatives: [
    {
      actionClass: 'SERVICE_ROLLBACK',
      request: 'ABSENT',
      invocation: 'NONE',
    },
    {
      actionClass: 'SECRET_MATERIALIZATION',
      request: 'ABSENT',
      credentialOutput: 'ABSENT',
      awsCliInvocation: 'NONE',
      providerInvocation: 'NONE',
    },
    {
      actionClass: 'WATCHDOG_ACTIVATION',
      status: 'UNAVAILABLE_CLASS',
      request: 'ABSENT',
      invocation: 'NONE',
    },
  ],
  legacyInstall: {
    status: 'REJECTED_LEGACY_COHORT',
    destination: 'ABSENT',
  },
  sealedRelease: {
    treeDigestBeforeLast4: treeBefore.slice(-4),
    treeDigestAfterLast4: treeAfter.slice(-4),
    manifestDigestBeforeLast4: manifestBefore.slice(-4),
    manifestDigestAfterLast4: manifestAfter.slice(-4),
    status: treeBefore === treeAfter && manifestBefore === manifestAfter
      ? 'UNCHANGED'
      : 'CHANGED',
  },
};
if (document.sealedRelease.status !== 'UNCHANGED') process.exit(2);
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
NODE
  assert_eq "$(json_value "$KEYLESS_MARKER" status)" KEYLESS_NEGATIVE_VERIFIED
  assert_eq "$(json_value "$ACTUAL_PROOF_SUMMARY" status)" DF32_ACTUAL_LINUX_PROOF_ACCEPTED
  note "actual Linux proof evidence: $ACTUAL_PROOF_SUMMARY"
fi

finish
