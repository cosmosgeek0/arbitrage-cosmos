#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

SHA_A=abcdef0123456789abcdef0123456789abcdef01
SHA_B=bcdef0123456789abcdef0123456789abcdef012
CLOCK_JSON="$(node -e '
  const base=Math.floor(Date.now()/1000)*1000;
  const utc=(offset)=>new Date(base+offset).toISOString().replace(".000Z","Z");
  process.stdout.write(JSON.stringify({
    risk:utc(-10_000),
    start:utc(-5_000),
    effect:utc(0),
    finalize:utc(60_000),
    stale:utc(301_000),
    expires:utc(3_590_000),
    supervisorObserved:utc(-5_000),
    supervisorValid:utc(600_000),
  }));
')"
clock_value() {
  node -e 'process.stdout.write(JSON.parse(process.argv[1])[process.argv[2]])' \
    "$CLOCK_JSON" "$1"
}
RISK_NOW="$(clock_value risk)"
REQUEST_START="$(clock_value start)"
EFFECT_NOW="$(clock_value effect)"
FINALIZE_NOW="$(clock_value finalize)"
STALE_NOW="$(clock_value stale)"
AUTH_EXPIRES="$(clock_value expires)"
SUPERVISOR_OBSERVED="$(clock_value supervisorObserved)"
SUPERVISOR_VALID="$(clock_value supervisorValid)"
CONTRACT="$I00_ROOT/deployment-authorization-contract.mjs"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
PREVIEW_PRODUCER="$I00_ROOT/bin/produce-deployment-action-preview.mjs"
RELEASE_A="$(assemble_fixture_release "$TEST_TMP/release-a" "$SHA_A")"
RELEASE_B="$(assemble_fixture_release "$TEST_TMP/release-b" "$SHA_B")"
REAL_TMP="$(node -e 'process.stdout.write(require("fs").realpathSync("/tmp"))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-delegation-$$")"
cleanup_delegation_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_delegation_test EXIT
INSTALLED_I00="$SIMULATION_ROOT/installed-i00"
"$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE_A" --destination "$INSTALLED_I00" --simulation --simulation-root "$SIMULATION_ROOT" >/dev/null
assert_file "$INSTALLED_I00/accepted-ops-live/bin/deploy.sh"
assert_not_file "$INSTALLED_I00/.git"
FAKE_ROOT="$SIMULATION_ROOT/fakes"
mkdir -p "$FAKE_ROOT" "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/data-dir-leases" \
  "$SIMULATION_ROOT/evidence" "$SIMULATION_ROOT/models" "$SIMULATION_ROOT/backups" \
  "$SIMULATION_ROOT/ops-state" "$SIMULATION_ROOT/cosmos/releases"

cat > "$FAKE_ROOT/systemctl" <<SH
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "$SIMULATION_ROOT/systemctl.log"
case "\$1:\$2" in
  show:cosmos-app.service)
    [ "\$3" = --no-pager ] && [ "\$4" = --all ] || exit 9
    shift 4
    [ "\$#" -gt 0 ] || exit 9
    for argument in "\$@"; do
      case "\$argument" in --property=*) ;; *) exit 9 ;; esac
    done
    runtime_env=
    IFS= read -r runtime_env < "$SIMULATION_ROOT/app-runtime-path"
    [ -n "\$runtime_env" ] || exit 9
    while IFS= read -r line || [ -n "\$line" ]; do
      case "\$line" in
        EnvironmentFiles=)
          printf 'EnvironmentFiles=%s (ignore_errors=no)\n' "\$runtime_env"
          ;;
        ExecStart=)
          printf 'ExecStart={ path=$FAKE_ROOT/env ; argv[]=$FAKE_ROOT/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $FAKE_ROOT/node server/dist/index.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\n'
          ;;
        ExecStartEx=)
          printf 'ExecStartEx={ path=$FAKE_ROOT/env ; argv[]=$FAKE_ROOT/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $FAKE_ROOT/node server/dist/index.js ; flags= ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\n'
          ;;
        *) printf '%s\n' "\$line" ;;
      esac
    done < "$SIMULATION_ROOT/systemctl-show"
    ;;
  restart:cosmos-app.service)
    [ "\$#" -eq 2 ] || exit 9
    ;;
  *) exit 9 ;;
esac
SH
cp "$FAKE_ROOT/systemctl" "$FAKE_ROOT/systemctl.sh"
cat > "$FAKE_ROOT/systemctl-inactive" <<SH
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$SIMULATION_ROOT/systemctl.log"
[ "\$*" = 'is-active cosmos-app.service' ] || exit 9
printf 'inactive\n'
exit 3
SH
cat > "$FAKE_ROOT/curl" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$FAKE_ROOT/curl.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$FAKE_ROOT/probe.sh" <<'SH'
#!/usr/bin/env bash
trap 'exit 0' TERM INT
while :; do sleep 1; done
SH
cat > "$FAKE_ROOT/exposure.sh" <<'SH'
#!/usr/bin/env bash
printf 'NONE\n'
SH
cat > "$FAKE_ROOT/sqlite-safe.sh" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = --version ] || exit 9
printf '3.53.3 fixture-safe\n'
SH
cat > "$FAKE_ROOT/systemctl-inactive.sh" <<SH
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$SIMULATION_ROOT/systemctl.log"
[ "\$*" = 'is-active cosmos-app.service' ] || exit 9
printf 'inactive\n'
exit 3
SH
cp "$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')" \
  "$FAKE_ROOT/node"
cp /bin/bash "$FAKE_ROOT/bash"
cp /usr/bin/env "$FAKE_ROOT/env"
cp "$FAKE_ROOT/sqlite-safe.sh" "$FAKE_ROOT/sqlite3"
chmod +x "$FAKE_ROOT"/*.sh
chmod 500 "$FAKE_ROOT/systemctl" "$FAKE_ROOT/systemctl-inactive" \
  "$FAKE_ROOT/curl" "$FAKE_ROOT/node" \
  "$FAKE_ROOT/bash" "$FAKE_ROOT/env" "$FAKE_ROOT/sqlite3"
touch "$SIMULATION_ROOT/systemctl.log"
node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$SIMULATION_ROOT" \
  --commands "$FAKE_ROOT/systemctl,$FAKE_ROOT/systemctl.sh,$FAKE_ROOT/systemctl-inactive,$FAKE_ROOT/systemctl-inactive.sh,$FAKE_ROOT/curl,$FAKE_ROOT/curl.sh,$FAKE_ROOT/probe.sh,$FAKE_ROOT/exposure.sh,$FAKE_ROOT/node,$FAKE_ROOT/bash,$FAKE_ROOT/env" >/dev/null
mkdir -m 700 "$SIMULATION_ROOT/authorization" "$SIMULATION_ROOT/consumption" \
  "$SIMULATION_ROOT/receipts" "$SIMULATION_ROOT/effects" \
  "$SIMULATION_ROOT/first-host-evidence" "$SIMULATION_ROOT/rollback-evidence"

HOST_JSON="$SIMULATION_ROOT/host.json"
HOST_EVIDENCE="$SIMULATION_ROOT/host-evidence.json"
SUPERVISOR_JSON="$SIMULATION_ROOT/supervisor.json"
RAW_ENV="$SIMULATION_ROOT/raw-deploy.env"
RUNTIME_ENV="$SIMULATION_ROOT/runtime.env"
RUNTIME_ENV_B="$SIMULATION_ROOT/runtime-b.env"
node - "$HOST_EVIDENCE" "$RISK_NOW" <<'NODE'
const fs = require('fs');
const [output, observedAtUtc] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({
  schemaVersion: 1,
  source: 'TEST_DELEGATION_HOST_EVIDENCE',
  observedAtUtc,
})}\n`, { mode: 0o600 });
NODE
HOST_EVIDENCE_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$HOST_EVIDENCE")"
node - "$HOST_JSON" "$HOST_EVIDENCE_SHA" "$RISK_NOW" <<'NODE'
const fs = require('fs');
const [output, evidenceSha256, observedAtUtc] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({
  source: 'TARGET_HOST_OWNER_READBACK',
  account: 'simulation-account',
  targetHost: 'fixture-host.internal',
  environment: 'simulation',
  freeBytes: 10000000,
  backupReserveBytes: 1000,
  sqliteVersion: '3.53.3',
  evidenceSha256,
  observedAtUtc,
})}\n`, { mode: 0o600 });
NODE
node - "$SUPERVISOR_JSON" "$SUPERVISOR_OBSERVED" "$SUPERVISOR_VALID" <<'NODE'
const fs = require('fs');
const [output, observedAtUtc, validUntilUtc] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({
  source: 'CANONICAL_SUPERVISOR_READBACK',
  observedAtUtc,
  validUntilUtc,
  deploymentFrozen: false,
  exposureState: 'NONE',
  ambiguityState: 'NONE',
  recoveryState: 'NONE',
  currentSchemaVersion: 1,
  rollbackFloor: 1,
})}\n`, { mode: 0o600 });
NODE
cat > "$RAW_ENV" <<EOF
COSMOS_ROOT=$SIMULATION_ROOT/cosmos
RELEASES_DIR=$SIMULATION_ROOT/cosmos/releases
CURRENT_LINK=$SIMULATION_ROOT/cosmos/current
PREVIOUS_LINK=$SIMULATION_ROOT/cosmos/previous
DATA_DIR=$SIMULATION_ROOT/data
OPS_STATE_DIR=$SIMULATION_ROOT/ops-state
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
GATE_TIMEOUT_SEC=60
HTTP_TIMEOUT_SEC=5
LOCK_TIMEOUT_SEC=30
I00_OPS_READBACK_TIMEOUT_MS=750
I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback
ALERT_CMD=
FROZEN_MARKER=$SIMULATION_ROOT/ops-state/deploy-frozen.json
MONEY_READY_MARKER=$SIMULATION_ROOT/ops-state/money-ready
EOF
cat > "$RUNTIME_ENV" <<EOF
HOST=127.0.0.1
PORT=8080
DATA_DIR=$SIMULATION_ROOT/data
DATA_DIR_LOGICAL_LEASE_ROOT=$SIMULATION_ROOT/data-dir-leases
EVIDENCE_DIR=$SIMULATION_ROOT/evidence
MODEL_DIR=$SIMULATION_ROOT/models
BACKUP_DIR=$SIMULATION_ROOT/backups
CONTROL_ROOM_OPERATOR_EMAIL=operator@private.invalid
CF_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com
CF_ACCESS_AUD=audience_12345678
I00_TESTED_SHA=abcdef0123456789abcdef0123456789abcdef01
I00_DEPLOYED_SHA=abcdef0123456789abcdef0123456789abcdef01
I00_CONFIG_REVISION=config-fixture
I00_MODEL_REVISION=UNAVAILABLE
I00_PUBLIC_SOURCE_STARTUP_EGRESS=1
EOF
chmod 600 "$HOST_JSON" "$HOST_EVIDENCE" "$SUPERVISOR_JSON" "$RAW_ENV" \
  "$RUNTIME_ENV"

TRUST_KEY="$SIMULATION_ROOT/fixture-trust-key.pem"
printf 'TEST DELEGATION FIXTURE TRUST MATERIAL ONLY\n' > "$TRUST_KEY"
chmod 600 "$TRUST_KEY"

APP_UNIT_UNSET_ENVIRONMENT='NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy'
mkdir -m 700 "$SIMULATION_ROOT/systemd" \
  "$SIMULATION_ROOT/systemd/cosmos-app.service.d" \
  "$SIMULATION_ROOT/runtime-systemd" \
  "$SIMULATION_ROOT/runtime-systemd/cosmos-app.service.d"
cp "$INSTALLED_I00/accepted-ops-live/systemd/cosmos-app.service" \
  "$SIMULATION_ROOT/systemd/cosmos-app.service"
chmod 600 "$SIMULATION_ROOT/systemd/cosmos-app.service"
ln -s "$SIMULATION_ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf" \
  "$SIMULATION_ROOT/runtime-systemd/cosmos-app.service.d/90-cosmos-app.conf"
cat > "$SIMULATION_ROOT/systemctl-show" <<EOF
Id=cosmos-app.service
Names=cosmos-app.service
Following=
LoadState=loaded
FragmentPath=$SIMULATION_ROOT/systemd/cosmos-app.service
DropInPaths=$SIMULATION_ROOT/runtime-systemd/cosmos-app.service.d/90-cosmos-app.conf
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
EnvironmentFiles=
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
ExecStart=
ExecStartEx=
ExecStartPost=
ExecReload=
ExecStop=
ExecStopPost=
EOF
chmod 600 "$SIMULATION_ROOT/systemctl-show"

configure_test_app_unit() {
  local runtime_env="$1"
  local current_runtime=""
  if [ -f "$SIMULATION_ROOT/app-runtime-path" ]; then
    IFS= read -r current_runtime < "$SIMULATION_ROOT/app-runtime-path"
  fi
  if [ "$current_runtime" = "$runtime_env" ] \
      && [ -f "$SIMULATION_ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf" ]; then
    return 0
  fi
  chmod 600 "$SIMULATION_ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf" \
    2>/dev/null || true
  cat > "$SIMULATION_ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf" <<EOF
[Unit]
ConditionPathExists=$SIMULATION_ROOT/.do-not-start-cosmos-app

[Service]
EnvironmentFile=
EnvironmentFile=$runtime_env
EOF
  chmod 400 "$SIMULATION_ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf"
  printf '%s\n' "$runtime_env" > "$SIMULATION_ROOT/app-runtime-path"
  chmod 600 "$SIMULATION_ROOT/app-runtime-path"
}
configure_test_app_unit "$RUNTIME_ENV"

prepare_bound_deploy_env() {
  local output="$SIMULATION_ROOT/sanitized/deploy.env"
  if [ -e "$output" ] || [ -L "$output" ]; then
    chmod 600 "$output" 2>/dev/null || true
    rm "$output"
  fi
  node "$INSTALLED_I00/bin/sanitize-donor-env.mjs" \
    --env "$RAW_ENV" \
    --output "$output" \
    --profile deploy \
    --node "$FAKE_ROOT/node" \
    --bash "$FAKE_ROOT/bash" \
    --env-bin "$FAKE_ROOT/env" \
    --systemctl "$FAKE_ROOT/systemctl" \
    --curl "$FAKE_ROOT/curl" \
    --provenance-mode TEST \
    --provenance-root "$SIMULATION_ROOT" \
    --require-effect-bindings >/dev/null
}

COMMON_ENV=(env SYSTEMCTL="$FAKE_ROOT/systemctl" CURL="$FAKE_ROOT/curl")
PREPARE_ENV=(env SYSTEMCTL="$FAKE_ROOT/systemctl" CURL="$FAKE_ROOT/curl")
SWITCH_COMMON=(--env-file "$RAW_ENV" --runtime-env "$RUNTIME_ENV" --host "$HOST_JSON" --supervisor "$SUPERVISOR_JSON" --sqlite "$FAKE_ROOT/sqlite3" --evidence-root "$SIMULATION_ROOT/first-host-evidence" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now "$EFFECT_NOW")
FIRST_HOST_BASE=(--env-file "$RAW_ENV" --runtime-env "$RUNTIME_ENV" --sqlite "$FAKE_ROOT/sqlite3" --recovery-target NO_PRIOR_RELEASE_FIRST_HOST --account simulation-account --target-host fixture-host.internal --environment simulation --backup-reserve-bytes 1 --evidence-root "$SIMULATION_ROOT/first-host-evidence" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh")
FIRST_HOST_PREPARE=("${FIRST_HOST_BASE[@]}" --prepare-first-host-evidence --simulation-systemctl-readback "$FAKE_ROOT/systemctl-inactive" --now "$RISK_NOW")

make_action_chain() {
  local action_class="$1" fixture_id="$2" release="$3" risk_runtime="$4"
  local deploy_source="$5" first_host_dir="${6:-}"
  local request="$SIMULATION_ROOT/authorization/$fixture_id.request.json"
  local risk="$SIMULATION_ROOT/authorization/$fixture_id.risk.json"
  local preview="$SIMULATION_ROOT/authorization/$fixture_id.preview.json"
  local authorization="$SIMULATION_ROOT/authorization/$fixture_id.authorization.json"
  local result="$SIMULATION_ROOT/receipts/$fixture_id.result.json"
  local reconciliation="$SIMULATION_ROOT/receipts/$fixture_id.reconciliation.json"
  local nonce
  local -a risk_args
  [[ "$fixture_id" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] \
    || fail_test "authorization fixture ID is invalid"
  configure_test_app_unit "$risk_runtime"
  node --input-type=module - \
    "$CONTRACT" "$request" "$fixture_id" "$result" "$reconciliation" \
    "$REQUEST_START" "$AUTH_EXPIRES" <<'NODE'
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [
  contractPath, requestPath, fixtureId, result, reconciliation,
  startsAtUtc, expiresAtUtc,
] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)));
writeFileSync(requestPath, canonicalJsonBytes({
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: `delegation-${fixtureId}`,
  operator: 'isolated-staging-operator',
  approver: 'isolated-staging-owner-fixture',
  approvalReference: `delegation-${fixtureId}`,
  startsAtUtc,
  expiresAtUtc,
  receiptTargets: { result, reconciliation },
}), { flag: 'wx', mode: 0o600 });
NODE
  nonce="$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.argv[1]).digest("hex"))' "$action_class:$fixture_id")"
  risk_args=(
    --request "$request"
    --class "$action_class"
    --output "$risk"
    --simulation-clock
    --now "$RISK_NOW"
    --simulation-publication-now "$RISK_NOW"
    --nonce "$nonce"
    --simulation-command-root "$FAKE_ROOT"
    --simulation-donor-root "$INSTALLED_I00/accepted-ops-live"
    --root-mode TEST
    --proof-root "$SIMULATION_ROOT"
    --release "$release"
    --trusted-build-public-key "$TRUST_KEY"
    --runtime-env "$risk_runtime"
    --deploy-env "$deploy_source"
  )
  case "$action_class" in
    SERVICE_RELEASE_SWITCH)
      risk_args+=(--sqlite "$FAKE_ROOT/sqlite3")
      if [ -n "$first_host_dir" ]; then
        risk_args+=(--first-host-evidence-dir "$first_host_dir")
      else
        risk_args+=(--host-readback "$HOST_JSON" --host-evidence "$HOST_EVIDENCE")
      fi
      ;;
    SERVICE_ROLLBACK)
      [ -z "$first_host_dir" ] \
        || fail_test "rollback authorization rejects first-host evidence"
      risk_args+=(
        --host-readback "$HOST_JSON"
        --host-evidence "$HOST_EVIDENCE"
        --rollback-evidence-root "$SIMULATION_ROOT/rollback-evidence"
      )
      ;;
    *) fail_test "unsupported delegation authorization class" ;;
  esac
  node "$RISK_PRODUCER" "${risk_args[@]}" >/dev/null
  node "$PREVIEW_PRODUCER" \
    --deployment-risk "$risk" \
    --consumption-root "$SIMULATION_ROOT/consumption" \
    --output "$preview" >/dev/null
  node --input-type=module - \
    "$CONTRACT" "$request" "$risk" "$preview" "$authorization" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, requestPath, riskPath, previewPath, output] =
  process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)));
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
const preview = JSON.parse(readFileSync(previewPath, 'utf8'));
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
writeFileSync(output, canonicalJsonBytes({
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
    approver: request.approver,
    approvedAtUtc: window.issuedAtUtc,
    reference: request.approvalReference,
  },
  receiptTargets: action.receiptTargets,
}), { flag: 'wx', mode: 0o600 });
NODE
  ACTION_AUTH_ARGS=(
    --authorization "$authorization"
    --operator isolated-staging-operator
    --config-version "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).binding.configVersion)' "$preview")"
    --deployment-risk "$risk"
    --action-preview "$preview"
    --authorization-consumption-root "$SIMULATION_ROOT/consumption"
    --result-receipt "$result"
    --reconciliation-receipt "$reconciliation"
  )
  ACTION_RESULT_RECEIPT="$result"
  ACTION_RECONCILIATION_RECEIPT="$reconciliation"
  ACTION_CONSUMPTION_RECEIPT="$SIMULATION_ROOT/consumption/$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).singleUse.claimKey)' "$preview").json"
}

note "the first-host wrapper interface is mutually exclusive and exact"
assert_failure_contains 'rejects caller-supplied --host and --supervisor' \
  "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}" --host "$HOST_JSON"
WRONG_TARGET_COMMON=("${FIRST_HOST_PREPARE[@]}")
for index in "${!WRONG_TARGET_COMMON[@]}"; do
  if [ "${WRONG_TARGET_COMMON[$index]}" = --recovery-target ]; then WRONG_TARGET_COMMON[$((index + 1))]=FIRST_HOST; fi
done
assert_failure_contains '--recovery-target must be exactly NO_PRIOR_RELEASE_FIRST_HOST' \
  "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${WRONG_TARGET_COMMON[@]}"
assert_failure_contains 'normal deploy requires --host and --supervisor' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  --env-file "$RAW_ENV" --runtime-env "$RUNTIME_ENV" --sqlite "$FAKE_ROOT/sqlite-safe.sh"
assert_failure_contains 'duplicate singleton argument --sqlite' \
  "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}" --sqlite "$FAKE_ROOT/sqlite-safe.sh"
assert_failure_contains 'first-host switch requires --first-host-evidence-dir' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_BASE[@]}" --now "$RISK_NOW"
assert_failure_contains 'prepare-first-host evidence rejects --first-host-evidence-dir' \
  "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}" \
  --first-host-evidence-dir "$SIMULATION_ROOT/first-host-evidence/not-used"
assert_failure_contains 'first-host preparation rejects authorization and receipt inputs' \
  "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}" \
  --result-receipt "$SIMULATION_ROOT/first-host-evidence/not-used.json"
for invalid_reserve in 01 1x not-a-number; do
  INVALID_RESERVE_COMMON=("${FIRST_HOST_PREPARE[@]}")
  for index in "${!INVALID_RESERVE_COMMON[@]}"; do
    if [ "${INVALID_RESERVE_COMMON[$index]}" = --backup-reserve-bytes ]; then
      INVALID_RESERVE_COMMON[$((index + 1))]="$invalid_reserve"
    fi
  done
  assert_failure_contains '--backup-reserve-bytes must be a canonical non-negative integer' \
    "${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${INVALID_RESERVE_COMMON[@]}"
done

EVIDENCE_PARENT_SWAP="$SIMULATION_ROOT/first-host-evidence"
EVIDENCE_PARENT_DISPLACED="$SIMULATION_ROOT/first-host-evidence.displaced"
EVIDENCE_SWAP_PREPARE=("${FIRST_HOST_PREPARE[@]}")
assert_failure_contains 'first-host evidence' \
  "${PREPARE_ENV[@]}" \
    "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
    --simulation-evidence-root-swap-to "$EVIDENCE_PARENT_DISPLACED" \
    "${EVIDENCE_SWAP_PREPARE[@]}"
assert_eq "$(
  find "$EVIDENCE_PARENT_SWAP" "$EVIDENCE_PARENT_DISPLACED" \
    -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
)" 1
assert_file "$SIMULATION_ROOT/sanitized/deploy.env"
rm "$SIMULATION_ROOT/sanitized/deploy.env"

note "first-host evidence is prepared and validated without mutation before authorization binding"
PREPARED_JSON="$("${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$PREPARED_JSON")" FIRST_HOST_EVIDENCE_PREPARED
FIRST_HOST_BUNDLE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).evidenceDir)' "$PREPARED_JSON")"
FIRST_HOST_EVIDENCE_SHA="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).firstHostEvidenceSha256)' "$PREPARED_JSON")"
assert_not_file "$SIMULATION_ROOT/cosmos/current"
assert_not_file "$SIMULATION_ROOT/cosmos/previous"
assert_file "$FIRST_HOST_BUNDLE/host.json"
assert_file "$FIRST_HOST_BUNDLE/supervisor.json"
assert_file "$FIRST_HOST_BUNDLE/collected-evidence.json"
assert_file "$FIRST_HOST_BUNDLE/sqlite-readback.json"
assert_eq "$FIRST_HOST_EVIDENCE_SHA" \
  "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_BUNDLE/collected-evidence.json")"

FIRST_HOST_SWITCH=("${FIRST_HOST_BASE[@]}" --first-host-evidence-dir "$FIRST_HOST_BUNDLE" --now "$EFFECT_NOW")
STALE_FIRST_HOST_SWITCH=("${FIRST_HOST_BASE[@]}" --first-host-evidence-dir "$FIRST_HOST_BUNDLE" --now "$STALE_NOW")
make_action_chain SERVICE_RELEASE_SWITCH first-host-tamper "$RELEASE_A" \
  "$RUNTIME_ENV" "$RAW_ENV" "$FIRST_HOST_BUNDLE"
TAMPER_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
make_action_chain SERVICE_RELEASE_SWITCH first-host-stale "$RELEASE_A" \
  "$RUNTIME_ENV" "$RAW_ENV" "$FIRST_HOST_BUNDLE"
STALE_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
make_action_chain SERVICE_RELEASE_SWITCH first-host-success "$RELEASE_A" \
  "$RUNTIME_ENV" "$RAW_ENV" "$FIRST_HOST_BUNDLE"
FIRST_HOST_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
FIRST_HOST_RESULT_RECEIPT="$ACTION_RESULT_RECEIPT"
FIRST_HOST_RECONCILIATION_RECEIPT="$ACTION_RECONCILIATION_RECEIPT"
FIRST_HOST_CONSUMPTION_RECEIPT="$ACTION_CONSUMPTION_RECEIPT"
make_action_chain SERVICE_RELEASE_SWITCH first-host-repeat "$RELEASE_A" \
  "$RUNTIME_ENV" "$RAW_ENV" "$FIRST_HOST_BUNDLE"
SECOND_FIRST_HOST_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
TAMPERED_FIRST_HOST_BUNDLE="$SIMULATION_ROOT/first-host-evidence/first-host-readback.TAMPER"
cp -R "$FIRST_HOST_BUNDLE" "$TAMPERED_FIRST_HOST_BUNDLE"
chmod 700 "$TAMPERED_FIRST_HOST_BUNDLE"
printf ' ' >> "$TAMPERED_FIRST_HOST_BUNDLE/collected-evidence.json"
TAMPERED_FIRST_HOST_SWITCH=("${FIRST_HOST_BASE[@]}" --first-host-evidence-dir "$TAMPERED_FIRST_HOST_BUNDLE" --now "$EFFECT_NOW")
SYSTEMCTL_BEFORE_TAMPER="$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')"
assert_failure_contains 'does not bind the retained collected evidence bytes' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  "${TAMPERED_FIRST_HOST_SWITCH[@]}" "${TAMPER_AUTH_ARGS[@]}"
assert_eq "$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')" "$SYSTEMCTL_BEFORE_TAMPER"
assert_not_file "$SIMULATION_ROOT/cosmos/current"

SYSTEMCTL_BEFORE_STALE="$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')"
assert_failure_contains 'host preflight is stale or future-dated' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  "${STALE_FIRST_HOST_SWITCH[@]}" "${STALE_AUTH_ARGS[@]}"
assert_eq "$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')" "$SYSTEMCTL_BEFORE_STALE"
assert_not_file "$SIMULATION_ROOT/cosmos/current"

note "installed I00 wrapper consumes the prepared evidence without invoking the producer"
EVIDENCE_DIR_COUNT="$(find "$SIMULATION_ROOT/first-host-evidence" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
# Condition-scoped sanctioned skip. Beyond this point the suite exercises the
# authorized-effect path, whose authorization document binds the privileged
# identity for this action class. The runtime check accepts the privileged
# account or the exact bound identity; since the bound identity IS the
# privileged one, both branches require privilege. An unprivileged account
# therefore cannot exercise this section by any lawful means. The section is
# exercised on the deployment target, which runs this path privileged, and that
# result is recorded as target evidence. Any environment that CAN run it still
# runs it in full - this is scoped to the exact incapability, never blanket.
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' \
    "--- SANCTIONED SKIP test-delegation-gates.sh (authorized-effect section requires the bound privileged identity; unavailable to an unprivileged account; exercised on the deployment target instead)"
  finish
  exit 0
fi
if [ "$(uname -s)" != Linux ]; then
  NON_LINUX_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log" || true)"
  assert_failure_contains 'authorized effects require Linux before authorization consumption' \
    "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
    "${FIRST_HOST_SWITCH[@]}" "${FIRST_HOST_AUTH_ARGS[@]}"
  assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log" || true)" \
    "$NON_LINUX_RESTARTS"
  assert_not_file "$SIMULATION_ROOT/cosmos/current"
  assert_not_file "$FIRST_HOST_CONSUMPTION_RECEIPT"
  assert_not_file "$FIRST_HOST_RESULT_RECEIPT"
  assert_not_file "$FIRST_HOST_RECONCILIATION_RECEIPT"
  finish
  exit 0
fi
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  "${FIRST_HOST_SWITCH[@]}" "${FIRST_HOST_AUTH_ARGS[@]}"
assert_eq "$(find "$SIMULATION_ROOT/first-host-evidence" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" "$EVIDENCE_DIR_COUNT"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
assert_not_file "$SIMULATION_ROOT/cosmos/previous"
assert_contains "$(cat "$SIMULATION_ROOT/systemctl.log")" 'restart cosmos-app.service'
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$FIRST_HOST_RESULT_RECEIPT")" RELEASE_SWITCH_PROVED
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$FIRST_HOST_RECONCILIATION_RECEIPT")" GATE_5_RECONCILED
assert_file "$FIRST_HOST_CONSUMPTION_RECEIPT"

note "a second first-host request refuses and leaves the established current release unchanged"
CURRENT_BEFORE_SECOND_FIRST_HOST="$(readlink "$SIMULATION_ROOT/cosmos/current")"
assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
  --release "$RELEASE_A" "${FIRST_HOST_SWITCH[@]}" \
  "${SECOND_FIRST_HOST_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$CURRENT_BEFORE_SECOND_FIRST_HOST"
assert_not_file "$SIMULATION_ROOT/cosmos/previous"

touch "$SIMULATION_ROOT/data/mutable-state"
assert_file "$SIMULATION_ROOT/data/mutable-state"
sed "s/$SHA_A/$SHA_B/" "$RUNTIME_ENV" > "$RUNTIME_ENV_B"
chmod 600 "$RUNTIME_ENV_B"
SWITCH_COMMON[3]="$RUNTIME_ENV_B"
note "a later canonical deployment preserves normal readback semantics and creates previous"
prepare_bound_deploy_env
CURRENT_RUNTIME_COMMON=("${SWITCH_COMMON[@]}")
CURRENT_RUNTIME_COMMON[3]="$RUNTIME_ENV"
make_action_chain SERVICE_RELEASE_SWITCH later-current-runtime "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
CURRENT_RUNTIME_CLAIM_KEY="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).singleUse.claimKey)' "$SIMULATION_ROOT/authorization/later-current-runtime.preview.json")"
CURRENT_RUNTIME_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")"
assert_failure_contains 'runtime config tested SHA does not match the candidate release' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${CURRENT_RUNTIME_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
assert_not_file "$SIMULATION_ROOT/consumption/$CURRENT_RUNTIME_CLAIM_KEY.json"
assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" \
  "$CURRENT_RUNTIME_RESTARTS"
make_action_chain SERVICE_RELEASE_SWITCH later-release-b "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
LATER_RESULT_RECEIPT="$ACTION_RESULT_RECEIPT"
LATER_RECONCILIATION_RECEIPT="$ACTION_RECONCILIATION_RECEIPT"
LATER_CONSUMPTION_RECEIPT="$ACTION_CONSUMPTION_RECEIPT"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${SWITCH_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_B"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/previous")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$LATER_RESULT_RECEIPT")" RELEASE_SWITCH_PROVED
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$LATER_RECONCILIATION_RECEIPT")" GATE_5_RECONCILED
assert_file "$LATER_CONSUMPTION_RECEIPT"

note "rollback delegates the exact preflighted release ID, not an implicit previous target"
ROLLBACK_TARGET="$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
ROLLBACK_COMMON=(--env-file "$RAW_ENV" --runtime-env "$RUNTIME_ENV" --host "$HOST_JSON" --supervisor "$SUPERVISOR_JSON" --evidence-root "$SIMULATION_ROOT/rollback-evidence" --simulation --simulation-root "$SIMULATION_ROOT")
make_action_chain SERVICE_ROLLBACK rollback-to-a "$ROLLBACK_TARGET" \
  "$RUNTIME_ENV" "$RAW_ENV"
ROLLBACK_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
ROLLBACK_RESULT_RECEIPT="$ACTION_RESULT_RECEIPT"
ROLLBACK_RECONCILIATION_RECEIPT="$ACTION_RECONCILIATION_RECEIPT"
ROLLBACK_CONSUMPTION_RECEIPT="$ACTION_CONSUMPTION_RECEIPT"
rm -rf "$TEST_TMP/outside-lock"
rm "$SIMULATION_ROOT/sanitized/deploy.env"
set +e
env DEPLOY_LOCK="$TEST_TMP/outside-lock" SYSTEMCTL="$FAKE_ROOT/systemctl" \
  CURL="$FAKE_ROOT/curl" "$INSTALLED_I00/bin/rollback-switch.sh" \
  --release "$ROLLBACK_TARGET" "${ROLLBACK_COMMON[@]}" \
  --now "$EFFECT_NOW" \
  "${ROLLBACK_AUTH_ARGS[@]}" >/dev/null 2>&1
ROLLBACK_PENDING_RC=$?
set -e
assert_eq "$ROLLBACK_PENDING_RC" 75
assert_not_file "$TEST_TMP/outside-lock"
assert_file "$ROLLBACK_CONSUMPTION_RECEIPT"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/rollback-switch.sh" --finalize-only \
  --release "$ROLLBACK_TARGET" "${ROLLBACK_COMMON[@]}" \
  --now "$FINALIZE_NOW" \
  "${ROLLBACK_AUTH_ARGS[@]}" >/dev/null
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$ROLLBACK_RESULT_RECEIPT")" ROLLED_BACK_PROVED
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$ROLLBACK_RECONCILIATION_RECEIPT")" RECONCILED

note "established current release is untouched by every canonical freeze input"
CURRENT_BEFORE="$(readlink "$SIMULATION_ROOT/cosmos/current")"
for mutation in exposure ambiguity recovery frozen; do
  node -e '
    const fs=require("fs"), p=process.argv[1], kind=process.argv[2], v=JSON.parse(fs.readFileSync(p,"utf8"));
    if (kind === "exposure") v.exposureState="ACTIVE";
    if (kind === "ambiguity") v.ambiguityState="AMBIGUOUS";
    if (kind === "recovery") v.recoveryState="RECOVERY_REQUIRED";
    if (kind === "frozen") v.deploymentFrozen=true;
    fs.writeFileSync(p,JSON.stringify(v));
  ' "$SUPERVISOR_JSON" "$mutation"
  make_action_chain SERVICE_RELEASE_SWITCH "freeze-$mutation" "$RELEASE_B" \
    "$RUNTIME_ENV_B" "$RAW_ENV"
  assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
    --release "$RELEASE_B" "${SWITCH_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
  assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$CURRENT_BEFORE"
  node - "$SUPERVISOR_JSON" "$SUPERVISOR_OBSERVED" "$SUPERVISOR_VALID" <<'NODE'
const fs = require('fs');
const [output, observedAtUtc, validUntilUtc] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({
  source: 'CANONICAL_SUPERVISOR_READBACK',
  observedAtUtc,
  validUntilUtc,
  deploymentFrozen: false,
  exposureState: 'NONE',
  ambiguityState: 'NONE',
  recoveryState: 'NONE',
  currentSchemaVersion: 1,
  rollbackFloor: 1,
})}\n`);
NODE
done

note "every release switch pins a canonical live SQLite identity and refuses ambient or divergent executables"
cat > "$FAKE_ROOT/sqlite-different-safe.sh" <<'SH'
#!/usr/bin/env bash
printf '3.51.3 safe-but-different\n'
SH
cat > "$FAKE_ROOT/sqlite-unsafe.sh" <<'SH'
#!/usr/bin/env bash
printf '3.45.1 unsafe-branch\n'
SH
cat > "$FAKE_ROOT/sqlite-malformed.sh" <<'SH'
#!/usr/bin/env bash
printf 'not-a-version\n'
SH
cat > "$FAKE_ROOT/sqlite-stderr.sh" <<'SH'
#!/usr/bin/env bash
printf 'unexpected\n' >&2
printf '3.53.3\n'
SH
cat > "$FAKE_ROOT/sqlite-nonzero.sh" <<'SH'
#!/usr/bin/env bash
printf '3.53.3\n'
exit 7
SH
cat > "$FAKE_ROOT/sqlite-timeout.sh" <<'SH'
#!/usr/bin/env bash
sleep 2
printf '3.53.3\n'
SH
cat > "$FAKE_ROOT/sqlite-changed.sh" <<'SH'
#!/usr/bin/env bash
printf '\n# changed during readback\n' >> "$0"
printf '3.53.3\n'
SH
cp "$FAKE_ROOT/sqlite-safe.sh" "$FAKE_ROOT/sqlite-nonexec.sh"
chmod 755 "$FAKE_ROOT"/sqlite-different-safe.sh "$FAKE_ROOT"/sqlite-unsafe.sh \
  "$FAKE_ROOT"/sqlite-malformed.sh "$FAKE_ROOT"/sqlite-stderr.sh \
  "$FAKE_ROOT"/sqlite-nonzero.sh "$FAKE_ROOT"/sqlite-timeout.sh "$FAKE_ROOT"/sqlite-changed.sh
chmod 644 "$FAKE_ROOT/sqlite-nonexec.sh"
ln -s "$FAKE_ROOT/sqlite-safe.sh" "$FAKE_ROOT/sqlite-symlink.sh"

assert_sqlite_refused() {
  local replacement="$1" index
  local -a hostile=("${SWITCH_COMMON[@]}")
  SQLITE_CASE=$((SQLITE_CASE + 1))
  for index in "${!hostile[@]}"; do
    if [ "${hostile[$index]}" = --sqlite ]; then hostile[$((index + 1))]="$replacement"; fi
  done
  make_action_chain SERVICE_RELEASE_SWITCH "sqlite-$SQLITE_CASE" "$RELEASE_B" \
    "$RUNTIME_ENV_B" "$RAW_ENV"
  assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
    --release "$RELEASE_B" "${hostile[@]}" "${ACTION_AUTH_ARGS[@]}"
}

SQLITE_CASE=0
SQLITE_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")"
assert_sqlite_refused "$FAKE_ROOT/sqlite-missing.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-symlink.sh"
assert_sqlite_refused "$FAKE_ROOT/../fakes/sqlite-safe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-nonexec.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-changed.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-malformed.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-stderr.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-unsafe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-different-safe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-timeout.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-nonzero.sh"
NO_SQLITE_COMMON=()
skip_next=0
for index in "${!SWITCH_COMMON[@]}"; do
  if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
  if [ "${SWITCH_COMMON[$index]}" = --sqlite ]; then skip_next=1; continue; fi
  NO_SQLITE_COMMON+=("${SWITCH_COMMON[$index]}")
done
make_action_chain SERVICE_RELEASE_SWITCH sqlite-ambient "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
assert_failure env SQLITE="$FAKE_ROOT/sqlite-safe.sh" \
  SYSTEMCTL="$FAKE_ROOT/systemctl" CURL="$FAKE_ROOT/curl" \
  "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${NO_SQLITE_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$CURRENT_BEFORE"
assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" \
  "$SQLITE_RESTARTS"

note "authorization endpoints and result evidence bind the exact live SQLite and first-host identities"
WRAPPER_SOURCE="$(cat "$INSTALLED_I00/bin/release-switch.sh")"
for binding in 'backup-reserve-bytes:' 'sqlite-path:' 'sqlite-sha256:' 'sqlite-version:' \
  'sqlite-identity:' 'recovery-target:' 'first-host-evidence-sha256:' 'donor-env-sha256:'; do
  assert_contains "$WRAPPER_SOURCE" "$binding"
done
assert_contains "$WRAPPER_SOURCE" '--kind RELEASE_SWITCH'
assert_contains "$WRAPPER_SOURCE" '--expected-authorization-sha256'
assert_contains "$WRAPPER_SOURCE" '--check-only --output "$RESULT_RECEIPT"'

note "a competing first-host current target is refused before authorization consumption"
RACE_TARGET="$SIMULATION_ROOT/race-target"
RACE_DATA="$SIMULATION_ROOT/race-data"
RACE_OPS="$SIMULATION_ROOT/race-ops"
RACE_EVIDENCE="$SIMULATION_ROOT/first-host-evidence"
mkdir -p "$RACE_TARGET/releases" "$RACE_DATA" "$RACE_OPS"
cat > "$SIMULATION_ROOT/race.env" <<EOF
COSMOS_ROOT=$RACE_TARGET
RELEASES_DIR=$RACE_TARGET/releases
CURRENT_LINK=$RACE_TARGET/current
PREVIOUS_LINK=$RACE_TARGET/previous
DATA_DIR=$RACE_DATA
OPS_STATE_DIR=$RACE_OPS
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
GATE_TIMEOUT_SEC=60
HTTP_TIMEOUT_SEC=5
LOCK_TIMEOUT_SEC=30
I00_OPS_READBACK_TIMEOUT_MS=750
I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback
ALERT_CMD=
FROZEN_MARKER=$RACE_OPS/deploy-frozen.json
MONEY_READY_MARKER=$RACE_OPS/money-ready
EOF
chmod 600 "$SIMULATION_ROOT/race.env"
RACE_FIRST_HOST_BASE=(--env-file "$SIMULATION_ROOT/race.env" --runtime-env "$RUNTIME_ENV" --sqlite "$FAKE_ROOT/sqlite3" --recovery-target NO_PRIOR_RELEASE_FIRST_HOST --account simulation-account --target-host fixture-host.internal --environment simulation --backup-reserve-bytes 1000 --evidence-root "$RACE_EVIDENCE" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh")
rm -f "$SIMULATION_ROOT/sanitized/deploy.env"
RACE_PREPARED_JSON="$("${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  "${RACE_FIRST_HOST_BASE[@]}" --prepare-first-host-evidence \
  --simulation-systemctl-readback "$FAKE_ROOT/systemctl-inactive" --now "$RISK_NOW")"
RACE_FIRST_HOST_BUNDLE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).evidenceDir)' "$RACE_PREPARED_JSON")"
RACE_FIRST_HOST=("${RACE_FIRST_HOST_BASE[@]}" --first-host-evidence-dir "$RACE_FIRST_HOST_BUNDLE" --now "$EFFECT_NOW")
make_action_chain SERVICE_RELEASE_SWITCH competing-current "$RELEASE_A" \
  "$RUNTIME_ENV" "$SIMULATION_ROOT/race.env" \
  "$RACE_FIRST_HOST_BUNDLE"
RACE_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
RACE_CLAIM_KEY="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).singleUse.claimKey)' "$SIMULATION_ROOT/authorization/competing-current.preview.json")"
mkdir -p "$SIMULATION_ROOT/competing-release" "$RACE_TARGET"
ln -s "$SIMULATION_ROOT/competing-release" "$RACE_TARGET/current"
RACE_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")"
assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
  --release "$RELEASE_A" "${RACE_FIRST_HOST[@]}" "${RACE_AUTH_ARGS[@]}"
assert_eq "$(readlink "$RACE_TARGET/current")" "$SIMULATION_ROOT/competing-release"
[ ! -e "$RACE_TARGET/previous" ] && [ ! -L "$RACE_TARGET/previous" ] \
  || fail_test "competing current invented previous"
pass_assertion
[ -d "$RACE_TARGET/releases" ] \
  && [ -z "$(find "$RACE_TARGET/releases" -mindepth 1 -maxdepth 1 -print -quit)" ] \
  || fail_test "competing current mutated the empty releases root"
pass_assertion
assert_not_file "$RACE_OPS/locks/deploy.lock"
assert_not_file "$SIMULATION_ROOT/consumption/$RACE_CLAIM_KEY.json"
assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" \
  "$RACE_RESTARTS"

note "a contained clean baseline reinstalls the same sealed release through one full authorization chain"
# ops/tests/test-deploy.sh owns the preceding post-switch-failure proof: frozen,
# alerted, stopped, and no invented rollback target. This installed-wrapper
# proof starts after that contained baseline and invokes no unreceipted effect.
CONTAINMENT_STOPS="$(grep -c '^stop cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log" || true)"
CONTAINMENT_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")"
CONTAINMENT_EVIDENCE_BEFORE=()
while IFS= read -r bundle; do CONTAINMENT_EVIDENCE_BEFORE+=("$bundle"); done \
  < <(find "$SIMULATION_ROOT/first-host-evidence" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
rm "$SIMULATION_ROOT/cosmos/current" "$SIMULATION_ROOT/cosmos/previous"
chmod -R u+w "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_B"
rm -rf "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_B"
rmdir "$SIMULATION_ROOT/cosmos/releases" "$SIMULATION_ROOT/cosmos"
chmod -R u+w "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/ops-state"
rm -rf "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/ops-state"

[ ! -e "$SIMULATION_ROOT/cosmos/current" ] && [ ! -L "$SIMULATION_ROOT/cosmos/current" ] \
  || fail_test "containment clean baseline retained current"
pass_assertion
[ ! -e "$SIMULATION_ROOT/cosmos/previous" ] && [ ! -L "$SIMULATION_ROOT/cosmos/previous" ] \
  || fail_test "containment clean baseline retained previous"
pass_assertion
assert_not_file "$SIMULATION_ROOT/cosmos"
assert_not_file "$SIMULATION_ROOT/data"
assert_not_file "$SIMULATION_ROOT/ops-state"

mkdir -p "$SIMULATION_ROOT/cosmos/releases" "$SIMULATION_ROOT/data" \
  "$SIMULATION_ROOT/ops-state"
rm -f "$SIMULATION_ROOT/sanitized/deploy.env"
CONTAINMENT_PREPARED_JSON="$("${PREPARE_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
  --release "$RELEASE_A" "${FIRST_HOST_PREPARE[@]}")"
CONTAINMENT_PREPARED_BUNDLE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).evidenceDir)' "$CONTAINMENT_PREPARED_JSON")"
CONTAINMENT_FIRST_HOST_SWITCH=("${FIRST_HOST_BASE[@]}" --first-host-evidence-dir "$CONTAINMENT_PREPARED_BUNDLE" --now "$EFFECT_NOW")
make_action_chain SERVICE_RELEASE_SWITCH containment-reinstall "$RELEASE_A" \
  "$RUNTIME_ENV" "$RAW_ENV" \
  "$CONTAINMENT_PREPARED_BUNDLE"
CONTAINMENT_AUTH_ARGS=("${ACTION_AUTH_ARGS[@]}")
CONTAINMENT_RESULT_RECEIPT="$ACTION_RESULT_RECEIPT"
CONTAINMENT_RECONCILIATION_RECEIPT="$ACTION_RECONCILIATION_RECEIPT"
CONTAINMENT_CONSUMPTION_RECEIPT="$ACTION_CONSUMPTION_RECEIPT"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
  --release "$RELEASE_A" "${CONTAINMENT_FIRST_HOST_SWITCH[@]}" \
  "${CONTAINMENT_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A"
[ ! -e "$SIMULATION_ROOT/cosmos/previous" ] && [ ! -L "$SIMULATION_ROOT/cosmos/previous" ] \
  || fail_test "containment reinstall invented previous"
pass_assertion
assert_file "$SIMULATION_ROOT/cosmos/releases/i00-$SHA_A/release.json"
assert_eq "$(grep -c '^stop cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" \
  "$CONTAINMENT_STOPS"
assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" "$((CONTAINMENT_RESTARTS + 1))"
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$CONTAINMENT_RESULT_RECEIPT")" RELEASE_SWITCH_PROVED
assert_eq "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status)' "$CONTAINMENT_RECONCILIATION_RECEIPT")" GATE_5_RECONCILED
assert_file "$CONTAINMENT_CONSUMPTION_RECEIPT"

CONTAINMENT_BUNDLE=""
while IFS= read -r bundle; do
  already_present=0
  for prior in "${CONTAINMENT_EVIDENCE_BEFORE[@]}"; do
    if [ "$bundle" = "$prior" ]; then already_present=1; break; fi
  done
  if [ "$already_present" = 0 ]; then
    [ -z "$CONTAINMENT_BUNDLE" ] || fail_test "containment reinstall created multiple evidence bundles"
    CONTAINMENT_BUNDLE="$bundle"
  fi
done < <(find "$SIMULATION_ROOT/first-host-evidence" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
[ -n "$CONTAINMENT_BUNDLE" ] || fail_test "containment reinstall did not retain a new evidence bundle"
pass_assertion
for evidence_name in host.json supervisor.json collected-evidence.json sqlite-readback.json; do
  assert_file "$CONTAINMENT_BUNDLE/$evidence_name"
done

note "mutable donor bytes and real command paths cannot enter simulation"
prepare_bound_deploy_env
cp -R "$INSTALLED_I00/accepted-ops-live" "$SIMULATION_ROOT/mutated-donor"
chmod u+w "$SIMULATION_ROOT/mutated-donor/bin/deploy.sh"
printf '\n# mutation\n' >> "$SIMULATION_ROOT/mutated-donor/bin/deploy.sh"
make_action_chain SERVICE_RELEASE_SWITCH mutated-donor "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
assert_failure env DONOR_ROOT="$SIMULATION_ROOT/mutated-donor" \
  SYSTEMCTL="$FAKE_ROOT/systemctl" CURL="$FAKE_ROOT/curl" \
  "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${SWITCH_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
make_action_chain SERVICE_RELEASE_SWITCH real-systemctl "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
assert_failure env SYSTEMCTL=/usr/bin/systemctl CURL="$FAKE_ROOT/curl" \
  "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${SWITCH_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/cosmos/current")" "$CURRENT_BEFORE"

note "raw shell input, inherited mutation paths, and post-seal command edits are rejected or ignored"
cp "$RAW_ENV" "$SIMULATION_ROOT/injected.env"
printf 'UNRELATED=$(touch %s)\n' "$TEST_TMP/escaped" >> "$SIMULATION_ROOT/injected.env"
INJECTED_COMMON=(--env-file "$SIMULATION_ROOT/injected.env" --runtime-env "$RUNTIME_ENV_B" --host "$HOST_JSON" --supervisor "$SUPERVISOR_JSON" --sqlite "$FAKE_ROOT/sqlite3" --evidence-root "$SIMULATION_ROOT/first-host-evidence" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now "$EFFECT_NOW")
make_action_chain SERVICE_RELEASE_SWITCH injected-env "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
assert_failure_contains 'simulation env key UNRELATED is not in the closed donor allowlist' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" \
  --release "$RELEASE_B" "${INJECTED_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
assert_not_file "$TEST_TMP/escaped"
cp "$RAW_ENV" "$SIMULATION_ROOT/effect-class.env"
printf 'I00_EFFECT_CLASS=SERVICE_RELEASE_SWITCH\n' >> "$SIMULATION_ROOT/effect-class.env"
EFFECT_CLASS_COMMON=(--env-file "$SIMULATION_ROOT/effect-class.env" --runtime-env "$RUNTIME_ENV_B" --host "$HOST_JSON" --supervisor "$SUPERVISOR_JSON" --sqlite "$FAKE_ROOT/sqlite3" --evidence-root "$SIMULATION_ROOT/first-host-evidence" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now "$EFFECT_NOW")
make_action_chain SERVICE_RELEASE_SWITCH injected-effect-class "$RELEASE_B" \
  "$RUNTIME_ENV_B" "$RAW_ENV"
assert_failure_contains 'simulation env key I00_EFFECT_CLASS is not in the closed donor allowlist' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" \
  "${EFFECT_CLASS_COMMON[@]}" "${ACTION_AUTH_ARGS[@]}"
chmod u+w "$FAKE_ROOT/curl.sh"
printf '\n# changed after sealing\n' >> "$FAKE_ROOT/curl.sh"
assert_failure node "$INSTALLED_I00/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$FAKE_ROOT/curl.sh"
printf 'FIRST_HOST_ARTIFACT_MANIFEST_SHA256=%s\n' \
  "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE_A/artifact-manifest.json")"
printf 'FIRST_HOST_EVIDENCE_SHA256=%s\n' \
  "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$CONTAINMENT_BUNDLE/collected-evidence.json")"
finish
