#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

INSPECTOR="$I00_ROOT/bin/inspect-app-unit.mjs"
PREVIEW_VERIFIER="$I00_ROOT/bin/verify-app-unit-action-binding.mjs"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
PREVIEW_PRODUCER="$I00_ROOT/bin/produce-deployment-action-preview.mjs"
AUTHORIZATION_VALIDATOR="$I00_ROOT/bin/validate-authorization.mjs"
AUTHORIZATION_FIXTURE="$TEST_DIR/fixtures/make-deployment-authorization-fixture.mjs"
CONTRACT="$I00_ROOT/deployment-authorization-contract.mjs"
FAKE_MANAGER="$TEST_DIR/fixtures/unit-contract1-systemctl.mjs"
ROOT="$TEST_TMP/ip-ops-i00-sim-unit-contract1"
OPS_HELPER_TESTED_SHA='0123456789abcdef0123456789abcdef01234567'
NODE_BIN="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')"
ENV_BIN="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/usr/bin/env"))')"
SYSTEMCTL="$ROOT/bin/systemctl"
CONFIG="$ROOT/manager.json"
APP_FRAGMENT="$ROOT/etc/systemd/system/cosmos-app.service"
APP_SOURCE="$ROOT/accepted-donor/systemd/cosmos-app.service"
DROP_IN_ROOT="$ROOT/etc/systemd/system/cosmos-app.service.d"
RUNTIME_DROP_IN="$DROP_IN_ROOT/80-runtime-contract.conf"
PROVIDER_DROP_IN="$DROP_IN_ROOT/90-provider-contract.conf"
LOGGING_DROP_IN="$DROP_IN_ROOT/95-logging-contract.conf"
EXTRA_DROP_IN="$DROP_IN_ROOT/99-extra.conf"
PROVIDER_FRAGMENT="$ROOT/etc/systemd/system/cosmos-secrets-provider.service"
RUNTIME_ENV="$ROOT/etc/cosmos/cosmos-app.env"
I00_ENV="$ROOT/etc/cosmos/cosmos-i00.env"
PROVIDER_RISK="$ROOT/authorization/SECRET_MATERIALIZATION.risk.json"
PROVIDER_PREVIEW="$ROOT/authorization/SECRET_MATERIALIZATION.preview.json"
PROVIDER_CONSUMPTION_ROOT="$ROOT/consumption"
PENDING_RISK="$ROOT/var/lib/cosmos-deployment-authorization/pending-release-risk.json"
PENDING_PREVIEW="$ROOT/var/lib/cosmos-deployment-authorization/pending-release-preview.json"
PROVIDER_TEMPLATE="$REPO_ROOT/ops/templates/i00/systemd/cosmos-secrets-provider.service.template"
APP_PROVIDER_TEMPLATE="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-i00.conf.template"
APP_RUNTIME_TEMPLATE="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-runtime.conf.template"
APP_LOGGING_TEMPLATE="$REPO_ROOT/ops/templates/logging/systemd/95-cosmos-app-logging.conf.template"
UNSET_ENVIRONMENT='NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy'

OPS_HELPER_TREE_SHA256="$(node --input-type=module - "$I00_ROOT/lib.mjs" "$I00_ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const [libraryPath, root] = process.argv.slice(2);
const { typedTreeDigest } = await import(pathToFileURL(libraryPath).href);
process.stdout.write(typedTreeDigest(root, {
  excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
}));
NODE
)"
OPS_HELPER_ROOT="$(node --input-type=module - "$I00_ROOT/ops-helper-root.mjs" \
  "$OPS_HELPER_TREE_SHA256" "$OPS_HELPER_TESTED_SHA" <<'NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [modulePath, digest, testedSha] = process.argv.slice(2);
const { deriveOpsHelperBinding } = await import(pathToFileURL(modulePath).href);
assert.throws(
  () => deriveOpsHelperBinding({
    testedSha: '0'.repeat(40),
    i00EnforcementTreeDigestSha256: digest,
    rootMode: 'SYSTEM',
  }),
  /requires one resolved full lowercase tested SHA/u,
  'all-zero tested SHA must be rejected by the canonical ops helper binding',
);
process.stdout.write(deriveOpsHelperBinding({
  testedSha,
  i00EnforcementTreeDigestSha256: digest,
  rootMode: 'SYSTEM',
}).root);
NODE
)"
OPS_HELPER_APP_ENTRYPOINT="$OPS_HELPER_ROOT/bin/app-entrypoint.mjs"
OPS_HELPER_SECRET_MATERIALIZATION="$OPS_HELPER_ROOT/bin/secret-materialization.mjs"

node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const [modulePath, root] = process.argv.slice(2);
const { createSimulationRoot } = await import(pathToFileURL(modulePath).href);
createSimulationRoot(root);
NODE
mkdir -p \
  "$ROOT/bin" \
  "$ROOT/accepted-donor/systemd" \
  "$ROOT/authorization" \
  "$ROOT/commands" \
  "$ROOT/config" \
  "$ROOT/consumption" \
  "$ROOT/credentials" \
  "$ROOT/etc/cosmos" \
  "$DROP_IN_ROOT" \
  "$ROOT/effects" \
  "$ROOT/receipts" \
  "$ROOT/usr/local/lib/cosmos-ops" \
  "$ROOT/var/lib/cosmos-deployment-authorization"
chmod 700 \
  "$ROOT/bin" \
  "$ROOT/accepted-donor" \
  "$ROOT/accepted-donor/systemd" \
  "$ROOT/authorization" \
  "$ROOT/commands" \
  "$ROOT/config" \
  "$ROOT/consumption" \
  "$ROOT/credentials" \
  "$ROOT/etc" \
  "$ROOT/etc/cosmos" \
  "$ROOT/etc/systemd" \
  "$ROOT/etc/systemd/system" \
  "$DROP_IN_ROOT" \
  "$ROOT/effects" \
  "$ROOT/receipts" \
  "$ROOT/var" \
  "$ROOT/var/lib" \
  "$ROOT/var/lib/cosmos-deployment-authorization"

cp "$REPO_ROOT/ops/live/systemd/cosmos-app.service" "$APP_SOURCE"
cp -R "$I00_ROOT" "$ROOT$OPS_HELPER_ROOT"
cp "$APP_SOURCE" "$APP_FRAGMENT"
cp "$APP_PROVIDER_TEMPLATE" "$PROVIDER_DROP_IN"
cp "$APP_RUNTIME_TEMPLATE" "$RUNTIME_DROP_IN"
node --input-type=module - "$RUNTIME_DROP_IN" "$ENV_BIN" "$NODE_BIN" "$I00_ENV" \
  "$OPS_HELPER_ROOT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [path, env, node, i00Env, opsHelperRoot] = process.argv.slice(2);
writeFileSync(
  path,
  readFileSync(path, 'utf8')
    .replace('/usr/bin/env', env)
    .replace('/usr/bin/node', node)
    .replace('REPLACE_ME_OPS_HELPER_ROOT', opsHelperRoot)
    .replace('/etc/cosmos/cosmos-i00.env', i00Env),
);
NODE
cp "$APP_LOGGING_TEMPLATE" "$LOGGING_DROP_IN"
printf '%s\n' '[Service]' 'Environment=UNIT_CONTRACT1_EXTRA=1' >"$EXTRA_DROP_IN"
printf '%s\n' 'HOST=127.0.0.1' 'PORT=8080' >"$RUNTIME_ENV"
printf '%s\n' "I00_DEPLOYED_SHA=$OPS_HELPER_TESTED_SHA" >"$I00_ENV"

cp "$NODE_BIN" "$ROOT/commands/node"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$ROOT/commands/aws"
chmod 500 "$ROOT/commands/node" "$ROOT/commands/aws"
AWS_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$ROOT/commands/aws")"
node "$AUTHORIZATION_FIXTURE" request "$CONTRACT" "$ROOT" \
  SECRET_MATERIALIZATION "$ROOT/authorization/SECRET_MATERIALIZATION.request.json"
node --input-type=module - \
  "$CONTRACT" "$ROOT/config/secrets-provider.json" "$ROOT/commands/aws" \
  "$AWS_SHA256" "$PROVIDER_CONSUMPTION_ROOT" <<'NODE'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, output, awsCliPath, awsCliSha256, consumptionRoot]
  = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath).href);
const root = consumptionRoot.slice(0, -'/consumption'.length);
writeFileSync(output, canonicalJsonBytes({
  schemaVersion: 2,
  secretArn:
    'arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd',
  region: 'ap-south-1',
  instanceRoleArn: 'arn:aws:iam::123456789012:role/cosmos-instance-role',
  awsCliPath,
  awsCliSha256,
  secretVersionId:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  targetHost: 'isolated-staging.internal',
  environment: 'isolated-staging',
  operator: 'isolated-staging-operator',
  deployedSha: '0123456789abcdef0123456789abcdef01234567',
  configVersion: 'config-fixture',
  deploymentRisk:
    '/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.risk.json',
  actionPreview:
    '/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.preview.json',
  authorizationConsumptionRoot: consumptionRoot,
  resultReceiptTarget:
    `${root}/receipts/SECRET_MATERIALIZATION.result.json`,
  reconciliationReceiptTarget:
    `${root}/receipts/SECRET_MATERIALIZATION.reconciliation.json`,
  requiredKeys: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
}), { mode: 0o600 });
NODE
node "$RISK_PRODUCER" \
  --request "$ROOT/authorization/SECRET_MATERIALIZATION.request.json" \
  --class SECRET_MATERIALIZATION \
  --provider-config "$ROOT/config/secrets-provider.json" \
  --credential-output "$ROOT/credentials/app-secrets.json" \
  --output "$PROVIDER_RISK" \
  --root-mode TEST --proof-root "$ROOT" \
  --simulation-clock --now 2026-07-23T00:00:00Z \
  --simulation-command-root "$ROOT/commands" \
  --nonce 9f2c712dba93ab3274f6f71be245a76761957cd7d7a557676354264138b8f10e \
  >/dev/null
node "$PREVIEW_PRODUCER" \
  --deployment-risk "$PROVIDER_RISK" \
  --consumption-root "$PROVIDER_CONSUMPTION_ROOT" \
  --output "$PROVIDER_PREVIEW" >/dev/null
node "$AUTHORIZATION_FIXTURE" authorization "$CONTRACT" "$ROOT" \
  SECRET_MATERIALIZATION \
  "$ROOT/authorization/SECRET_MATERIALIZATION.authorization.json"
AUTHORIZATION_ARGS=(
  --input "$ROOT/authorization/SECRET_MATERIALIZATION.authorization.json"
  --class SECRET_MATERIALIZATION
  --simulation-clock --now 2026-07-23T00:05:00Z
  --command secrets-provider
  --expected-operator isolated-staging-operator
  --expected-deployed-sha 0123456789abcdef0123456789abcdef01234567
  --expected-config-version config-fixture
  --deployment-risk "$PROVIDER_RISK"
  --action-preview "$PROVIDER_PREVIEW"
  --consumption-root "$PROVIDER_CONSUMPTION_ROOT"
  --expected-host isolated-staging.internal
  --expected-environment isolated-staging
  --expected-scope cosmos-production-secret-materialization
  --expected-account aws:123456789012
  --expected-product "AWS Secrets Manager"
  --expected-credential-type AWS_INSTANCE_PROFILE_ROLE
  --expected-permission secretsmanager:GetSecretValue
  --expected-permission sts:GetCallerIdentity
  --expected-result-receipt "$ROOT/receipts/SECRET_MATERIALIZATION.result.json"
  --expected-reconciliation-receipt \
    "$ROOT/receipts/SECRET_MATERIALIZATION.reconciliation.json"
  --expected-maximum-capital ZERO
  --expected-maximum-notional ZERO
  --expected-maximum-effect \
    "read one exact secret version into one exact 0600 runtime credential"
)
while IFS= read -r endpoint; do
  AUTHORIZATION_ARGS+=(--expected-endpoint "$endpoint")
done < <(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const endpoint of v.action.allowedEndpoints)console.log(endpoint)' "$PROVIDER_PREVIEW")
"$ROOT/commands/node" "$AUTHORIZATION_VALIDATOR" \
  "${AUTHORIZATION_ARGS[@]}" >/dev/null

node --input-type=module - \
  "$PROVIDER_TEMPLATE" "$PROVIDER_FRAGMENT" "$ROOT" "$OPS_HELPER_ROOT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [source, output, root, opsHelperRoot] = process.argv.slice(2);
const replacements = new Map([
  ['REPLACE_ME_OPS_HELPER_ROOT', opsHelperRoot],
  ['REPLACE_ME_DEPLOYMENT_RISK_DOCUMENT', 'SECRET_MATERIALIZATION.risk'],
  ['REPLACE_ME_ACTION_PREVIEW_DOCUMENT', 'SECRET_MATERIALIZATION.preview'],
  ['/REPLACE_ME_EXACT_AUTHORIZATION_CONSUMPTION_PARENT', `${root}/consumption`],
  ['/REPLACE_ME_EXACT_RECEIPT_PARENT', `${root}/receipts`],
  ['/REPLACE_ME_EXACT_EFFECT_EVIDENCE_PARENT', `${root}/effects`],
]);
let text = readFileSync(source, 'utf8');
for (const [placeholder, value] of replacements) {
  if (typeof value !== 'string') throw new Error(`missing value for ${placeholder}`);
  if (text.split(placeholder).length !== 2) throw new Error(`bad placeholder ${placeholder}`);
  text = text.replace(placeholder, value);
}
if (text.includes('REPLACE_ME_')) throw new Error('provider template is not fully rendered');
writeFileSync(output, text);
NODE

cat >"$SYSTEMCTL" <<EOF
#!/bin/sh
exec "$NODE_BIN" "$FAKE_MANAGER" "$CONFIG" "\$@"
EOF
chmod 700 "$SYSTEMCTL"
chmod 600 \
  "$APP_SOURCE" "$APP_FRAGMENT" "$RUNTIME_DROP_IN" "$PROVIDER_DROP_IN" \
  "$LOGGING_DROP_IN" "$EXTRA_DROP_IN" "$PROVIDER_FRAGMENT" "$RUNTIME_ENV" "$I00_ENV"

node --input-type=module - \
  "$CONFIG" "$APP_FRAGMENT" "$RUNTIME_DROP_IN" "$PROVIDER_DROP_IN" "$LOGGING_DROP_IN" \
  "$EXTRA_DROP_IN" \
  "$PROVIDER_FRAGMENT" "$RUNTIME_ENV" "$I00_ENV" "$NODE_BIN" "$ENV_BIN" \
  "$UNSET_ENVIRONMENT" "$OPS_HELPER_ROOT" "$OPS_HELPER_APP_ENTRYPOINT" \
  "$OPS_HELPER_SECRET_MATERIALIZATION" <<'NODE'
import { writeFileSync } from 'node:fs';
const [
  output, appFragment, runtimeDropIn, providerDropIn, loggingDropIn, extraDropIn,
  providerFragment,
  runtimeEnv, i00Env, node, env, unsetEnvironment, opsHelperRoot,
  opsHelperAppEntrypoint, opsHelperSecretMaterialization,
] = process.argv.slice(2);
writeFileSync(output, `${JSON.stringify({
  mode: 'normal',
  appFragment,
  runtimeDropIn,
  providerDropIn,
  loggingDropIn,
  extraDropIn,
  providerFragment,
  runtimeEnv,
  i00Env,
  node,
  env,
  unsetEnvironment,
  opsHelperRoot,
  opsHelperAppEntrypoint,
  opsHelperSecretMaterialization,
  deploymentRisk:
    '/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.risk.json',
  actionPreview:
    '/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.preview.json',
})}\n`);
NODE
chmod 600 "$CONFIG"

set_mode() {
  node --input-type=module - "$CONFIG" "$1" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [path, mode] = process.argv.slice(2);
const value = JSON.parse(readFileSync(path, 'utf8'));
value.mode = mode;
writeFileSync(path, `${JSON.stringify(value)}\n`);
NODE
}

set_provider_write_paths() {
  node --input-type=module - "$PROVIDER_FRAGMENT" "$@" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [path, ...writeRoots] = process.argv.slice(2);
const lines = readFileSync(path, 'utf8').split('\n');
const first = lines.findIndex((line) => line.startsWith('ReadWritePaths='));
if (first < 0 || writeRoots.length === 0) throw new Error('write roots are required');
const retained = lines.filter((line) => !line.startsWith('ReadWritePaths='));
retained.splice(first, 0, ...writeRoots.map((root) => `ReadWritePaths=${root}`));
writeFileSync(path, retained.join('\n'));
NODE
}

inspect() {
  node "$INSPECTOR" \
    --systemctl "$SYSTEMCTL" \
    --unit cosmos-app.service \
    --node "$NODE_BIN" \
    --env "$ENV_BIN" \
    --runtime-env "$RUNTIME_ENV" \
    --provenance-mode TEST \
    --expected-fragment-path "$APP_FRAGMENT" \
    --expected-fragment-source "$APP_SOURCE" \
    --test-provider-bound-root "$ROOT" \
    --ops-helper-root "$OPS_HELPER_ROOT" \
    --ops-helper-tree-sha256 "$OPS_HELPER_TREE_SHA256" \
    --ops-helper-app-entrypoint "$OPS_HELPER_APP_ENTRYPOINT" \
    "$@"
}

note "UNIT-CONTRACT1: SYSTEM provider policy uses NONE and one document-derived shared-receipt closure"
assert_success node --input-type=module - "$CONTRACT" "$INSPECTOR" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, inspectorPath] = process.argv.slice(2);
const {
  DEPLOYMENT_SYSTEM_ROOTS,
  providerMaterializationWriteRoots,
  systemEffectEvidenceRoot,
} = await import(pathToFileURL(contractPath).href);
const identity = 'device=1,inode=2,mode=700,uid=0,gid=0';
const policy = (proofRoot) => ({
  rootMode: 'SYSTEM',
  proofRoot,
  proofRootIdentity: 'NONE',
  authorizationRoot: DEPLOYMENT_SYSTEM_ROOTS.authorization,
  authorizationRootIdentity: identity,
  consumptionRoot: DEPLOYMENT_SYSTEM_ROOTS.consumption,
  consumptionRootIdentity: identity,
  receiptRoot: DEPLOYMENT_SYSTEM_ROOTS.receipts,
  receiptRootIdentity: identity,
  effectEvidenceRoot: systemEffectEvidenceRoot('SECRET_MATERIALIZATION'),
  effectEvidenceRootIdentity: identity,
});
assert.deepEqual(providerMaterializationWriteRoots(policy('NONE')), [
  '/run/cosmos-secret-source',
  '/var/lib/cosmos-authorization-consumption',
  '/var/lib/cosmos-action-receipts',
  '/var/lib/cosmos-action-receipts/effects',
]);
for (const invalid of [null, '', '/var/lib/cosmos-deployment-authorization']) {
  assert.throws(
    () => providerMaterializationWriteRoots(policy(invalid)),
    /SYSTEM artifact policy rejects a proof root/u,
  );
}
const inspector = readFileSync(inspectorPath, 'utf8');
assert.doesNotMatch(inspector, /artifactPolicy\.proofRoot !== null/u);
assert.match(inspector, /artifactPolicy\.proofRoot !== 'NONE'/u);
NODE

note "UNIT-CONTRACT1: provider-bound manager, complete drop-ins, provider implementation, and both environments bind"
BASELINE="$(inspect)"
assert_contains "$BASELINE" '"status":"APP_UNIT_BINDING_VERIFIED"'
assert_contains "$BASELINE" '"schemaVersion":4'
assert_contains "$BASELINE" '"dropInState":"EXACT_PROVIDER_BOUND"'
assert_contains "$BASELINE" '"environmentAuthorityState":"EXACT_PROVIDER_CREDENTIAL"'
assert_contains "$BASELINE" "\"dropInPaths\":[\"$RUNTIME_DROP_IN\",\"$PROVIDER_DROP_IN\",\"$LOGGING_DROP_IN\"]"
assert_contains "$BASELINE" '"role":"PRESERVED_RUNTIME"'
assert_contains "$BASELINE" '"role":"PROVIDER_BINDING"'
assert_contains "$BASELINE" '"role":"PRESERVED_LOGGING"'
assert_contains "$BASELINE" '"providerState":"ACTIVE_EXITED_SUCCESS"'
assert_contains "$BASELINE" '"providerDeploymentRiskPath":"/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.risk.json"'
assert_contains "$BASELINE" '"providerActionPreviewPath":"/var/lib/cosmos-deployment-authorization/SECRET_MATERIALIZATION.preview.json"'
assert_contains "$BASELINE" "\"path\":\"$I00_ENV\",\"optional\":false"
assert_contains "$BASELINE" 'ProviderBindingSha256='
BASELINE_BINDING="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bindingSha256)' "$BASELINE")"
assert_success inspect --expected-binding-sha256 "$BASELINE_BINDING"

note "UNIT-CONTRACT1: prior materialization documents and consumed claim are descriptor-bound"
PROVIDER_CONSUMPTION="$(
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(`${process.argv[2]}/${p.singleUse.claimKey}.json`)' \
    "$PROVIDER_PREVIEW" "$PROVIDER_CONSUMPTION_ROOT"
)"
mv "$PROVIDER_RISK" "$ROOT/provider-risk.saved"
assert_failure_contains 'provider deployment risk is missing or unsafe' inspect
mv "$ROOT/provider-risk.saved" "$PROVIDER_RISK"
mv "$PROVIDER_PREVIEW" "$ROOT/provider-preview.saved"
assert_failure_contains 'provider action preview is missing or unsafe' inspect
mv "$ROOT/provider-preview.saved" "$PROVIDER_PREVIEW"
mv "$PROVIDER_CONSUMPTION" "$ROOT/provider-consumption.saved"
assert_failure_contains 'provider authorization consumption is missing or unsafe' inspect
mv "$ROOT/provider-consumption.saved" "$PROVIDER_CONSUMPTION"

cp "$PROVIDER_PREVIEW" "$ROOT/provider-preview.accepted"
cp "$PROVIDER_RISK" "$PROVIDER_PREVIEW"
chmod 600 "$PROVIDER_PREVIEW"
assert_failure_contains 'deployment action preview schema rejected' inspect
cp "$ROOT/provider-preview.accepted" "$PROVIDER_PREVIEW"
chmod 600 "$PROVIDER_PREVIEW"

cp "$PROVIDER_CONSUMPTION" "$ROOT/provider-consumption.accepted"
node --input-type=module - "$CONTRACT" "$PROVIDER_CONSUMPTION" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, path] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath).href);
const value = JSON.parse(readFileSync(path, 'utf8'));
value.previewDocumentSha256 = 'f'.repeat(64);
writeFileSync(path, canonicalJsonBytes(value), { mode: 0o600 });
NODE
assert_failure_contains \
  'provider authorization consumption previewDocumentSha256 differs from the chain' \
  inspect
cp "$ROOT/provider-consumption.accepted" "$PROVIDER_CONSUMPTION"
chmod 600 "$PROVIDER_CONSUMPTION"
chmod 644 "$PROVIDER_CONSUMPTION"
assert_failure_contains 'provider authorization consumption mode must be 0600' inspect
chmod 600 "$PROVIDER_CONSUMPTION"

mv "$PROVIDER_PREVIEW" "$ROOT/provider-preview.real"
ln -s "$ROOT/provider-preview.real" "$PROVIDER_PREVIEW"
assert_failure_contains 'provider action preview is missing or unsafe' inspect
rm "$PROVIDER_PREVIEW"
mv "$ROOT/provider-preview.real" "$PROVIDER_PREVIEW"

mv "$PROVIDER_RISK" "$ROOT/provider-risk.original"
cp "$ROOT/provider-risk.original" "$PROVIDER_RISK"
chmod 600 "$PROVIDER_RISK"
assert_failure_contains 'differs from the authorized binding' \
  inspect --expected-binding-sha256 "$BASELINE_BINDING"
rm "$ROOT/provider-risk.original"
BASELINE="$(inspect)"
BASELINE_BINDING="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bindingSha256)' "$BASELINE")"
assert_success inspect --expected-binding-sha256 "$BASELINE_BINDING"

note "UNIT-CONTRACT1: provider dependency, ordering, credential, and daemon state fail closed"
for mode in \
  app-missing-requires \
  app-missing-after \
  app-wrong-credential \
  app-extra-provider-edge \
  app-stale \
  app-extra-drop-in \
  provider-stale \
  provider-drop-in \
  provider-manager-exec-drift \
  provider-empty-environment-file-row \
  provider-restart \
  provider-inactive \
  provider-failed \
  provider-app-part-of
do
  set_mode "$mode"
  assert_failure inspect
done
set_mode normal

note "UNIT-CONTRACT1: provider-only overlay and rendered provider unit bytes remain exact"
cp "$PROVIDER_DROP_IN" "$ROOT/provider-drop-in.accepted"
printf '%s\n' 'ExecStart=/bin/false' >>"$PROVIDER_DROP_IN"
assert_failure_contains 'exactly one exact provider-only drop-in' inspect
cp "$ROOT/provider-drop-in.accepted" "$PROVIDER_DROP_IN"
chmod 600 "$PROVIDER_DROP_IN"

cp "$LOGGING_DROP_IN" "$ROOT/logging-drop-in.accepted"
printf '%s\n' 'LogRateLimitBurst=1' >>"$LOGGING_DROP_IN"
assert_failure_contains 'exactly one exact logging drop-in' inspect
cp "$ROOT/logging-drop-in.accepted" "$LOGGING_DROP_IN"
chmod 600 "$LOGGING_DROP_IN"

cp "$PROVIDER_FRAGMENT" "$ROOT/provider-fragment.accepted"
note "UNIT-CONTRACT1: provider write authority equals the deduplicated materialization document roots"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption/unit-contract" \
  "$ROOT/effects" \
  "$ROOT/receipts/result" \
  "$ROOT/receipts/reconciliation"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption" \
  "$ROOT/receipts"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption" \
  "$ROOT/receipts" \
  "$ROOT/effects" \
  "$ROOT/extra"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption" \
  "$ROOT/receipts" \
  "$ROOT/receipts" \
  "$ROOT/effects"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/receipts" \
  "$ROOT/consumption" \
  "$ROOT/effects"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption/other" \
  "$ROOT/receipts" \
  "$ROOT/effects"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption" \
  "$ROOT/receipts" \
  "$ROOT/effects/other"
assert_failure_contains 'write authority is not the exact document-derived four-path closure' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_provider_write_paths \
  /run/cosmos-secret-source \
  "$ROOT/consumption" \
  "$ROOT/receipts" \
  /var/lib
assert_failure_contains 'must not grant one broad production write root' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
set_mode provider-manager-write-root-drift
assert_failure_contains 'provider unit manager state differs from the exact rendered fragment' inspect
set_mode normal

node --input-type=module - "$PROVIDER_FRAGMENT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
writeFileSync(
  path,
  readFileSync(path, 'utf8').replace('\nRestart=no\n', '\nRestart=on-failure\n'),
);
NODE
assert_failure_contains 'Restart differs from the exact provider contract' inspect
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
chmod 600 "$PROVIDER_FRAGMENT"

note "UNIT-CONTRACT1: preserved overlay, second environment, and provider fragment identities cannot drift after preview"
cp "$RUNTIME_DROP_IN" "$ROOT/runtime-drop-in.accepted"
printf '%s\n' '# drift' >>"$RUNTIME_DROP_IN"
assert_failure_contains 'exactly one exact runtime drop-in' inspect
cp "$ROOT/runtime-drop-in.accepted" "$RUNTIME_DROP_IN"
chmod 600 "$RUNTIME_DROP_IN"
printf '%s\n' 'DRIFT=1' >>"$I00_ENV"
assert_failure_contains 'differs from the authorized binding' \
  inspect --expected-binding-sha256 "$BASELINE_BINDING"
sed -i.bak '$d' "$I00_ENV"
rm "$I00_ENV.bak"
printf '%s\n' '# drift' >>"$PROVIDER_FRAGMENT"
assert_failure_contains 'differs from the authorized binding' \
  inspect --expected-binding-sha256 "$BASELINE_BINDING"
cp "$ROOT/provider-fragment.accepted" "$PROVIDER_FRAGMENT"
chmod 600 "$PROVIDER_FRAGMENT"
BASELINE="$(inspect)"
BASELINE_BINDING="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bindingSha256)' "$BASELINE")"
assert_success inspect --expected-binding-sha256 "$BASELINE_BINDING"

note "UNIT-CONTRACT1: action preview app endpoints must come from independent inspection"
node --input-type=module - "$BASELINE" "$PENDING_PREVIEW" \
  "$OPS_HELPER_ROOT" "$OPS_HELPER_TREE_SHA256" "$OPS_HELPER_APP_ENTRYPOINT" \
  "$OPS_HELPER_TESTED_SHA" <<'NODE'
import { writeFileSync } from 'node:fs';
const [raw, output, opsHelperRoot, opsHelperTreeSha256, opsHelperAppEntrypoint, testedSha]
  = process.argv.slice(2);
const value = JSON.parse(raw);
const endpoints = [
  `app-unit-authority-closure-sha256:${value.authorityClosureSha256}`,
  `app-unit-binding-sha256:${value.bindingSha256}`,
  `app-unit-drop-in-state:${value.dropInState}`,
  `app-unit-drop-in-set:${value.dropInSetEndpoint}`,
  `app-unit-effect-reachability:${value.effectReachability}`,
  `app-unit-environment-file-identity:${value.runtimeEnvEndpointIdentity}`,
  'app-unit-environment-file-optional:no',
  `app-unit-environment-file-path:${value.runtimeEnvPath}`,
  `app-unit-environment-file-sha256:${value.runtimeEnvSha256}`,
  `app-unit-exec-start-env-path:${value.execStart.path}`,
  `app-unit-exec-start-node-path:${value.execStart.argv[2]}`,
  `app-unit-exec-start-sha256:${value.execStartSha256}`,
  `app-unit-fragment-identity:${value.fragmentEndpointIdentity}`,
  `app-unit-fragment-path:${value.fragmentPath}`,
  `app-unit-fragment-sha256:${value.fragmentSha256}`,
  `app-unit-fragment-source-identity:${value.fragmentSourceEndpointIdentity}`,
  `app-unit-fragment-source-path:${value.fragmentSourcePath}`,
  `app-unit-fragment-source-sha256:${value.fragmentSourceSha256}`,
  `app-unit-group:${value.group}`,
  `app-unit-inspection-mode:${value.inspectionMode}`,
  `app-unit-name:${value.unit}`,
  `app-unit-namespace-remap-state:${value.namespaceRemapState}`,
  `app-unit-need-daemon-reload:${value.needDaemonReload}`,
  'app-unit-offline-unit-root:NONE',
  'app-unit-proof-absent-sentinel:NONE',
  'app-unit-proof-drop-in-identity:NONE',
  'app-unit-proof-drop-in-owner:NONE',
  'app-unit-proof-drop-in-path:NONE',
  'app-unit-proof-drop-in-runtime-link-identity:NONE',
  'app-unit-proof-drop-in-runtime-link-path:NONE',
  'app-unit-proof-drop-in-sha256:NONE',
  'app-unit-staging-root:NONE',
  `app-unit-unset-environment-sha256:${value.unsetEnvironmentSha256}`,
  `app-unit-user:${value.user}`,
  `app-unit-working-directory:${value.workingDirectory}`,
  `app-unit-environment-files-sha256:${value.environmentFilesSha256}`,
  `app-unit-provider-action-preview-path:${value.providerActionPreviewPath}`,
  `app-unit-provider-binding-sha256:${value.providerBindingSha256}`,
  `app-unit-provider-deployment-risk-path:${value.providerDeploymentRiskPath}`,
  `app-unit-provider-fragment-identity:${value.providerFragmentEndpointIdentity}`,
  `app-unit-provider-fragment-path:${value.providerFragmentPath}`,
  `app-unit-provider-fragment-sha256:${value.providerFragmentSha256}`,
  `app-unit-provider-state:${value.providerState}`,
  `app-unit-provider-unit:${value.providerUnit}`,
  `ops-helper-app-entrypoint-path:${opsHelperAppEntrypoint}`,
  `ops-helper-root:${opsHelperRoot}`,
  `ops-helper-tree-sha256:${opsHelperTreeSha256}`,
  `release-sha:${testedSha}`,
].sort();
writeFileSync(output, `${JSON.stringify({ action: { allowedEndpoints: endpoints } })}\n`);
NODE
assert_success bash -c \
  'printf "%s\n" "$1" | node "$2" --deployment-risk "$3" --action-preview "$4" --test-provider-bound-root "$5"' \
  bash "$BASELINE" "$PREVIEW_VERIFIER" "$PENDING_RISK" "$PENDING_PREVIEW" "$ROOT"
for prior in "$PROVIDER_RISK" "$PROVIDER_PREVIEW"; do
  assert_failure_contains 'reuses prior provider provenance' bash -c \
    'printf "%s\n" "$1" | node "$2" --deployment-risk "$3" --action-preview "$4" --test-provider-bound-root "$5"' \
    bash "$BASELINE" "$PREVIEW_VERIFIER" "$prior" "$PENDING_PREVIEW" "$ROOT"
  prior_original="$prior.card3r-original"
  cp "$prior" "$prior_original"
  cp "$PENDING_PREVIEW" "$prior"
  assert_failure_contains 'reuses prior provider provenance' bash -c \
    'printf "%s\n" "$1" | node "$2" --deployment-risk "$3" --action-preview "$4" --test-provider-bound-root "$5"' \
    bash "$BASELINE" "$PREVIEW_VERIFIER" "$PENDING_RISK" "$prior" "$ROOT"
  mv "$prior_original" "$prior"
done
node --input-type=module - "$PENDING_PREVIEW" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
const value = JSON.parse(readFileSync(path, 'utf8'));
const index = value.action.allowedEndpoints.findIndex(
  (endpoint) => endpoint.startsWith('app-unit-binding-sha256:'),
);
value.action.allowedEndpoints[index] = `app-unit-binding-sha256:${'f'.repeat(64)}`;
value.action.allowedEndpoints.sort();
writeFileSync(path, `${JSON.stringify(value)}\n`);
NODE
assert_failure_contains 'differ from independent live inspection' bash -c \
  'printf "%s\n" "$1" | node "$2" --deployment-risk "$3" --action-preview "$4" --test-provider-bound-root "$5"' \
  bash "$BASELINE" "$PREVIEW_VERIFIER" "$PENDING_RISK" "$PENDING_PREVIEW" "$ROOT"

note "UNIT-CONTRACT1: rollback consumes the same independent provider/document verifier"
assert_contains "$(cat "$I00_ROOT/bin/rollback-switch.sh")" \
  'verify-app-unit-action-binding.mjs'
assert_contains "$(cat "$I00_ROOT/bin/rollback-switch.sh")" \
  '--deployment-risk "$DEPLOYMENT_RISK"'
assert_contains "$(cat "$I00_ROOT/bin/rollback-switch.sh")" \
  '--action-preview "$ACTION_PREVIEW" >/dev/null'

note "UNIT-CONTRACT1: both producers share the prior-provider path separation guard"
assert_contains "$(cat "$RISK_PRODUCER")" \
  'assertPendingProviderDocumentSeparation(evidence, [args.output])'
assert_contains "$(cat "$PREVIEW_PRODUCER")" \
  'assertPendingProviderDocumentSeparation('
assert_success node --input-type=module - "$CONTRACT" <<'NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { assertPendingProviderDocumentSeparation } = await import(
  pathToFileURL(process.argv[2]).href
);
const priorRisk = '/var/lib/cosmos-deployment-authorization/prior-risk.json';
const priorPreview = '/var/lib/cosmos-deployment-authorization/prior-preview.json';
const action = {
  allowedEndpoints: [
    `app-unit-provider-deployment-risk-path:${priorRisk}`,
    `app-unit-provider-action-preview-path:${priorPreview}`,
  ],
};
for (const path of [priorRisk, priorPreview]) {
  assert.throws(
    () => assertPendingProviderDocumentSeparation(action, [path]),
    /reuses prior provider provenance/u,
  );
}
assert.doesNotThrow(() => assertPendingProviderDocumentSeparation(
  action,
  ['/var/lib/cosmos-deployment-authorization/pending.json'],
));
assert.throws(() => assertPendingProviderDocumentSeparation({
  allowedEndpoints: [
    `app-unit-provider-deployment-risk-path:${priorRisk}`,
  ],
}, ['/var/lib/cosmos-deployment-authorization/pending.json']), /incomplete/u);
NODE

finish
