#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"
TEST_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$TEST_TMP")"

if [ "${I00_MA4_RECORDER_HANG_ONLY:-0}" = 1 ]; then
  I00_MA4_TIME_ANCHOR_MS="$(node -e 'process.stdout.write(String(Math.floor(Date.now() / 1000) * 1000))')"
  I00_MA4_RISK_NOW="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) - 120000).toISOString().replace(".000Z", "Z"))' "$I00_MA4_TIME_ANCHOR_MS")"
  I00_MA4_APPROVED_AT="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) - 90000).toISOString().replace(".000Z", "Z"))' "$I00_MA4_TIME_ANCHOR_MS")"
  I00_MA4_STARTS_AT="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) - 60000).toISOString().replace(".000Z", "Z"))' "$I00_MA4_TIME_ANCHOR_MS")"
  I00_MA4_EXPIRES_AT="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) + 1800000).toISOString().replace(".000Z", "Z"))' "$I00_MA4_TIME_ANCHOR_MS")"
else
  I00_MA4_RISK_NOW='2026-07-13T00:00:00Z'
  I00_MA4_APPROVED_AT='2026-07-13T00:10:00Z'
  I00_MA4_STARTS_AT='2026-07-13T00:15:00Z'
  I00_MA4_EXPIRES_AT='2026-07-13T01:00:00Z'
fi
export I00_MA4_APPROVED_AT I00_MA4_EXPIRES_AT I00_MA4_RISK_NOW I00_MA4_STARTS_AT

REAL_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/tmp"))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-secrets-$$")"
cleanup_secrets_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_secrets_test EXIT
mkdir -p "$SIMULATION_ROOT/fakes" "$SIMULATION_ROOT/credentials" \
  "$SIMULATION_ROOT/config" "$SIMULATION_ROOT/tmp"
chmod 700 "$SIMULATION_ROOT/credentials" "$SIMULATION_ROOT/config" "$SIMULATION_ROOT/tmp"
PROVIDER_CONFIG_ROOT="$SIMULATION_ROOT/config"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$SIMULATION_ROOT/fakes/aws-fixture.sh"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$SIMULATION_ROOT/fakes/aws-wrong-role.sh"
chmod +x "$SIMULATION_ROOT/fakes/aws-fixture.sh" "$SIMULATION_ROOT/fakes/aws-wrong-role.sh"
if [ "${I00_MA4_RECORDER_HANG_ONLY:-0}" = 1 ]; then
  chmod 0555 "$SIMULATION_ROOT/fakes/aws-fixture.sh" "$SIMULATION_ROOT/fakes/aws-wrong-role.sh"
fi
node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$SIMULATION_ROOT" \
  --commands "$SIMULATION_ROOT/fakes/aws-fixture.sh,$SIMULATION_ROOT/fakes/aws-wrong-role.sh" >/dev/null
SIMULATION_AWS="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$SIMULATION_ROOT/fakes/aws-fixture.sh")"
SIMULATION_AWS_SHA256="$(node -e 'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$SIMULATION_AWS")"
SIMULATION_AWS_IDENTITY="$(node "$I00_ROOT/bin/inspect-executable.mjs" --path "$SIMULATION_AWS" \
  | node -e 'let value="";process.stdin.on("data",(chunk)=>value+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.parse(value).endpointIdentity));')"
INSTANCE_ROLE_ARN='arn:aws:iam::123456789012:role/cosmos-instance-role'
AUTH_ROOT="$SIMULATION_ROOT/authorization"
CLAIM_ROOT="$SIMULATION_ROOT/consumption"
RECEIPT_ROOT="$SIMULATION_ROOT/receipts"
EFFECT_ROOT="$SIMULATION_ROOT/effects"
mkdir -p "$AUTH_ROOT" "$CLAIM_ROOT" "$RECEIPT_ROOT" "$EFFECT_ROOT"
chmod 700 "$AUTH_ROOT" "$CLAIM_ROOT" "$RECEIPT_ROOT" "$EFFECT_ROOT"
AUTH_ROOT="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$AUTH_ROOT")"
CLAIM_ROOT="$SIMULATION_ROOT/consumption"
RESULT_RECEIPT="$RECEIPT_ROOT/auth-secret-materialization-20260713-001.result.json"
RECONCILIATION_RECEIPT="$RECEIPT_ROOT/auth-secret-materialization-20260713-001.reconciliation.json"
COMMAND_ROOT="$AUTH_ROOT/commands"
mkdir "$COMMAND_ROOT"
chmod 700 "$COMMAND_ROOT"
CANONICAL_NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
cp "$CANONICAL_NODE" "$COMMAND_ROOT/node"
chmod 755 "$COMMAND_ROOT/node"
hash -p "$COMMAND_ROOT/node" node
CREDENTIAL_OUTPUT="$SIMULATION_ROOT/credentials/app-secrets.json"
node --input-type=module - "$I00_ROOT/deployment-authorization-contract.mjs" \
  "$AUTH_ROOT/request.json" "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$AUTH_ROOT" \
  "$SIMULATION_AWS" "$SIMULATION_AWS_SHA256" "$CREDENTIAL_OUTPUT" \
  "$CLAIM_ROOT" "$RESULT_RECEIPT" "$RECONCILIATION_RECEIPT" <<'NODE'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const [
  requestOutput,
  providerOutput,
  root,
	  awsCliPath,
	  awsCliSha256,
	  credentialOutput,
	  authorizationConsumptionRoot,
	  resultReceiptTarget,
	  reconciliationReceiptTarget,
	] = process.argv.slice(3);
writeFileSync(requestOutput, canonicalJsonBytes({
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: 'auth-secret-materialization-20260713-001',
  operator: 'ops-owner-17',
  approver: 'ops-owner-17',
  approvalReference: 'approval-20260713-001',
  startsAtUtc: process.env.I00_MA4_STARTS_AT,
  expiresAtUtc: process.env.I00_MA4_EXPIRES_AT,
  receiptTargets: {
    result: resultReceiptTarget,
    reconciliation: reconciliationReceiptTarget,
  },
}), { mode: 0o600 });
writeFileSync(providerOutput, canonicalJsonBytes({
  schemaVersion: 2,
  secretArn: process.env.I00_MA4_RECORDER_HANG_ONLY === '1'
    ? 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/unmatched-Zz99Yy'
    : 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd',
  secretVersionId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  region: 'ap-south-1',
  instanceRoleArn: 'arn:aws:iam::123456789012:role/cosmos-instance-role',
  awsCliPath,
  awsCliSha256,
  targetHost: 'ip-10-0-0-10.internal',
  environment: 'production',
  operator: 'ops-owner-17',
  deployedSha: '0123456789abcdef0123456789abcdef01234567',
  configVersion: 'config-i00-production-17',
  deploymentRisk: `${root}/risk.json`,
  actionPreview: `${root}/preview.json`,
  authorizationConsumptionRoot,
  resultReceiptTarget,
  reconciliationReceiptTarget,
  requiredKeys: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
}), { mode: 0o600 });
NODE
node "$I00_ROOT/bin/produce-deployment-risk-version.mjs" \
  --request "$AUTH_ROOT/request.json" --class SECRET_MATERIALIZATION \
  --provider-config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --credential-output "$CREDENTIAL_OUTPUT" \
  --output "$AUTH_ROOT/risk.json" \
  --root-mode TEST --proof-root "$SIMULATION_ROOT" \
  --simulation-clock --now "$I00_MA4_RISK_NOW" \
  --simulation-command-root "$COMMAND_ROOT" \
  --nonce 9f2c712dba93ab3274f6f71be245a76761957cd7d7a557676354264138b8f10e >/dev/null
node "$I00_ROOT/bin/produce-deployment-action-preview.mjs" \
  --deployment-risk "$AUTH_ROOT/risk.json" \
  --consumption-root "$CLAIM_ROOT" --output "$AUTH_ROOT/preview.json" >/dev/null
node --input-type=module - "$I00_ROOT/deployment-authorization-contract.mjs" "$AUTH_ROOT" \
  "$AUTH_ROOT/auth.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const [root, authorizationOutput] = process.argv.slice(3);
const risk = JSON.parse(readFileSync(`${root}/risk.json`, 'utf8'));
const preview = JSON.parse(readFileSync(`${root}/preview.json`, 'utf8'));
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
writeFileSync(authorizationOutput, canonicalJsonBytes({
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
    approver: 'ops-owner-17',
    approvedAtUtc: process.env.I00_MA4_APPROVED_AT,
    reference: 'approval-20260713-001',
  },
  receiptTargets: action.receiptTargets,
}), { mode: 0o600 });
NODE

if [ "${I00_MA4_RECORDER_HANG_ONLY:-0}" = 1 ]; then
  [ "$(uname -s)" = Linux ] \
    || fail_test 'provider-to-wrapper recorder-hang proof requires Linux'
  RECORDER_HANG_MARKER="$TEST_TMP/ma4-recorder.entered"
  RECORDER_HANG_HOOK="$TEST_TMP/ma4-recorder-hang-hook.mjs"
  cat >"$RECORDER_HANG_HOOK" <<'NODE'
import childProcess from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const recorder = process.env.I00_MA4_OUTCOME_RECORDER;
const marker = process.env.I00_MA4_RECORDER_MARKER;
if (typeof recorder !== 'string' || typeof marker !== 'string') {
  throw new Error('recorder-hang hook requires exact recorder and marker paths');
}
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function guardedSpawnSync(command, arguments_, options) {
  if (command === process.execPath
      && Array.isArray(arguments_)
      && arguments_[0] === recorder) {
    writeFileSync(marker, 'RECORDER_ENTERED\n', { flag: 'wx', mode: 0o600 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    throw new Error('recorder-hang sentinel reached its safety deadline');
  }
  return Reflect.apply(originalSpawnSync, childProcess, [command, arguments_, options]);
};
syncBuiltinESMExports();
NODE
  chmod 600 "$RECORDER_HANG_HOOK"
  set +e
  node --input-type=module - \
    "$COMMAND_ROOT/node" \
    "$I00_ROOT/bin/secret-materialization.mjs" \
    "$I00_ROOT/bin/record-authorized-action-outcome.mjs" \
    "$RECORDER_HANG_HOOK" \
    "$RECORDER_HANG_MARKER" \
    "$AUTH_ROOT/auth.json" \
    "$AUTH_ROOT/risk.json" \
    "$AUTH_ROOT/preview.json" \
    "$CLAIM_ROOT" \
    "$CREDENTIAL_OUTPUT" \
    "$RESULT_RECEIPT" \
    "$RECONCILIATION_RECEIPT" <<'NODE'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync,
} from 'node:fs';

const [
  wrapperNode,
  wrapper,
  recorder,
  hook,
  marker,
  authorization,
  risk,
  preview,
  consumptionRoot,
  credential,
  resultReceipt,
  reconciliationReceipt,
] = process.argv.slice(2);
const child = spawn(wrapperNode, [
  '--import', hook,
  wrapper,
  '--authorization', authorization,
  '--deployment-risk', risk,
  '--action-preview', preview,
  '--authorization-consumption-root', consumptionRoot,
], {
  detached: true,
  env: {
    HOME: '/var/empty',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TZ: 'UTC',
    I00_MA4_OUTCOME_RECORDER: recorder,
    I00_MA4_RECORDER_MARKER: marker,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = Buffer.alloc(0);
let stderr = Buffer.alloc(0);
let spawnError;
let streamError;
child.once('error', (error) => {
  spawnError = error;
});
for (const [stream, assign] of [
  [child.stdout, (value) => { stdout = value; }],
  [child.stderr, (value) => { stderr = value; }],
]) {
  stream.on('data', (chunk) => {
    const current = stream === child.stdout ? stdout : stderr;
    if (current.length + chunk.length > 256 * 1024) {
      streamError = new Error('wrapper output exceeded the bounded proof buffer');
      return;
    }
    const next = Buffer.concat([current, chunk]);
    assign(next);
  });
}
const closed = new Promise((resolve) => {
  child.once('close', (code, signal) => resolve({ code, signal }));
});
const expected = Buffer.from(
  '{"status":"PRECREDENTIAL_PROVIDER_FAILURE","stage":"SECRET_FETCH",'
  + '"cause":"COMMAND_FAILED","credentialPublished":false,'
  + '"safeRetry":"REFUSED_REQUIRES_FRESH_AUTHORIZATION"}\n',
);
const waitForBlockedRecorder = new Promise((resolve, reject) => {
  let poll;
  const deadline = setTimeout(() => {
    clearInterval(poll);
    reject(new Error('wrapper did not expose its terminal before the recorder deadline'));
  }, 30_000);
  poll = setInterval(() => {
    if (spawnError !== undefined || streamError !== undefined) {
      clearTimeout(deadline);
      clearInterval(poll);
      reject(spawnError ?? streamError);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(deadline);
      clearInterval(poll);
      reject(new Error('wrapper exited before recorder-hang observation'));
      return;
    }
    if (existsSync(marker) && stdout.length >= expected.length) {
      clearTimeout(deadline);
      clearInterval(poll);
      resolve();
    }
  }, 5);
});

let closeResult;
try {
  await waitForBlockedRecorder;
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.deepEqual(stdout, expected);
  assert.deepEqual(stderr, Buffer.alloc(0));
  assert.equal(readFileSync(marker, 'utf8'), 'RECORDER_ENTERED\n');
  assert.equal(existsSync(credential), false);
  assert.equal(existsSync(resultReceipt), false);
  assert.equal(existsSync(reconciliationReceipt), false);
  assert.equal(readdirSync(consumptionRoot).length, 1);
  for (const forbidden of [
    'unmatched-Zz99Yy',
    'other-instance-role',
    'ROLEID',
    'assumed-role',
    'FAKE_API_KEY_123456',
    'FAKE_SECRET_123456',
    'PRECREDENTIAL_PROVIDER_TERMINAL ',
  ]) {
    assert.equal(Buffer.concat([stdout, stderr]).includes(Buffer.from(forbidden)), false);
  }
} finally {
  if (Number.isInteger(child.pid)
      && child.exitCode === null
      && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  closeResult = await Promise.race([
    closed,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), 1_000);
    }),
  ]);
  if (closeResult === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    closeResult = await closed;
  }
}
assert.equal(closeResult.code, null);
assert.ok(closeResult.signal === 'SIGTERM' || closeResult.signal === 'SIGKILL');
assert.deepEqual(stdout, expected);
NODE
  RECORDER_HANG_RC=$?
  set -e
  [ "$RECORDER_HANG_RC" -eq 0 ] \
    || fail_test 'provider-to-wrapper recorder-hang supervisor failed'
  pass_assertion
  finish
  exit 0
fi

note "provider modes and raw config/output paths fail closed before access"
STAGING_SENTINEL="$SIMULATION_ROOT/credentials/staging-never.json"
assert_failure_contains 'STAGING secret materialization is forbidden' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --provenance-mode STAGING --config "$TEST_TMP/missing-staging-config.json" \
  --output "$STAGING_SENTINEL"
assert_not_file "$STAGING_SENTINEL"
assert_failure_contains 'SYSTEM provider requires one verified authorized-effect handoff' \
  node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/generic-system-output.json"
assert_failure_contains 'SYSTEM provider requires one verified authorized-effect handoff' \
  node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config /etc/cosmos/secrets-provider.json \
  --output /run/cosmos-secret-source/app-secrets.json
assert_failure_contains 'SYSTEM provider rejects named config and output inputs' \
  node "$I00_ROOT/bin/secrets-provider.mjs" --authorized-effect \
  --config /etc/cosmos/secrets-provider.json \
  --output /run/cosmos-secret-source/app-secrets.json
assert_failure_contains 'SYSTEM provider requires the exact descriptor-only config and output contract' \
  node "$I00_ROOT/bin/secrets-provider.mjs" --authorized-effect \
  --config-fd 12 --output-parent-fd 15 --output-name alternate.json
assert_failure_contains 'TEST provider rejects SYSTEM descriptor selectors' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/test-descriptor-selector.json" \
  --config-fd 12 --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure_contains 'provider config must be one lexical-canonical non-root absolute path' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config provider.json --output "$SIMULATION_ROOT/credentials/relative-config.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure_contains 'provider config must be one lexical-canonical non-root absolute path' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/./secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/dot-config.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
mv "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.real.json"
ln -s "$PROVIDER_CONFIG_ROOT/secrets-provider.real.json" \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json"
assert_failure_contains 'TEST provider config must remain below the marked simulation root' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
rm "$PROVIDER_CONFIG_ROOT/secrets-provider.json"
mv "$PROVIDER_CONFIG_ROOT/secrets-provider.real.json" \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json"
assert_failure_contains 'credential output must be one lexical-canonical non-root absolute path' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output relative-output.json \
  --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure_contains 'credential output must be one lexical-canonical non-root absolute path' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/./dot-output.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
mv "$SIMULATION_ROOT/credentials" "$SIMULATION_ROOT/credentials-real"
ln -s "$SIMULATION_ROOT/credentials-real" "$SIMULATION_ROOT/credentials"
assert_failure_contains 'TEST credential output must remain below the marked simulation root' \
  env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
rm "$SIMULATION_ROOT/credentials"
mv "$SIMULATION_ROOT/credentials-real" "$SIMULATION_ROOT/credentials"

note "fake exact-ARN provider materializes without stdout disclosure"
AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$SIMULATION_ROOT/credentials/app-secrets.json" --simulation --simulation-root "$SIMULATION_ROOT" >"$PROVIDER_CONFIG_ROOT/provider.stdout" 2>"$PROVIDER_CONFIG_ROOT/provider.stderr"
OUT="$(cat "$PROVIDER_CONFIG_ROOT/provider.stdout")"
assert_contains "$OUT" SECRET_MATERIALIZED_WITHOUT_DISCLOSURE
assert_eq "$(
  grep -c '^PRECREDENTIAL_PROVIDER_TERMINAL ' "$PROVIDER_CONFIG_ROOT/provider.stderr" || true
)" 0
if cat "$PROVIDER_CONFIG_ROOT/provider.stdout" "$PROVIDER_CONFIG_ROOT/provider.stderr" | grep -F 'FAKE_SECRET_123456' >/dev/null; then fail_test 'provider disclosed the secret'; fi
pass_assertion
assert_file "$SIMULATION_ROOT/credentials/app-secrets.json"
assert_eq "$(stat -c '%a' "$SIMULATION_ROOT/credentials/app-secrets.json" 2>/dev/null || stat -f '%Lp' "$SIMULATION_ROOT/credentials/app-secrets.json")" 600
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(Object.keys(v).length))' "$SIMULATION_ROOT/credentials/app-secrets.json")" 2
rm "$SIMULATION_ROOT/credentials/app-secrets.json"

note "TEST helper TMPDIR is the exact marked-root tmp despite hostile ambient TMPDIR"
HOSTILE_TMPDIR="$TEST_TMP/hostile-tmpdir"
mkdir "$HOSTILE_TMPDIR"
chmod 777 "$HOSTILE_TMPDIR"
assert_success env TMPDIR="$HOSTILE_TMPDIR" AWS_CLI="$SIMULATION_AWS" \
  node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
assert_file "$SIMULATION_ROOT/credentials/app-secrets.json"
rm "$SIMULATION_ROOT/credentials/app-secrets.json"

note "credential publication rejects an output-parent pathname swap before provider access"
PROVIDER_PARENT_SWAP="$SIMULATION_ROOT/credentials"
PROVIDER_PARENT_DISPLACED="$SIMULATION_ROOT/credentials.displaced"
PROVIDER_PARENT_SWAP_HOOK="$PROVIDER_CONFIG_ROOT/provider-parent-swap-hook.mjs"
cat >"$PROVIDER_PARENT_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const target = process.env.DF32_PROVIDER_PARENT_SWAP_TARGET;
const displaced = process.env.DF32_PROVIDER_PARENT_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  const descriptor = originalOpenSync.call(this, path, flags, ...rest);
  if (!swapped
      && path === target
      && (Number(flags) & (fs.constants.O_DIRECTORY ?? 0)) !== 0) {
    swapped = true;
    fs.renameSync(target, displaced);
    fs.mkdirSync(target, { mode: 0o700 });
  }
  return descriptor;
};
syncBuiltinESMExports();
NODE
chmod 600 "$PROVIDER_PARENT_SWAP_HOOK"
assert_failure_contains 'credential output parent identity changed before publication' \
  env AWS_CLI="$SIMULATION_AWS" \
    DF32_PROVIDER_PARENT_SWAP_TARGET="$PROVIDER_PARENT_SWAP" \
    DF32_PROVIDER_PARENT_SWAP_DISPLACED="$PROVIDER_PARENT_DISPLACED" \
    node --import "$PROVIDER_PARENT_SWAP_HOOK" "$I00_ROOT/bin/secrets-provider.mjs" \
    --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
    --output "$PROVIDER_PARENT_SWAP/app-secrets.json" \
    --simulation --simulation-root "$SIMULATION_ROOT"
assert_eq "$(find "$PROVIDER_PARENT_SWAP" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
assert_eq "$(find "$PROVIDER_PARENT_DISPLACED" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
rmdir "$PROVIDER_PARENT_SWAP"
mv "$PROVIDER_PARENT_DISPLACED" "$PROVIDER_PARENT_SWAP"

note "published credential identity rejects concurrent named-file replacement"
RACE_DETECTED=0
for attempt in 1 2 3 4 5 6 7 8; do
  RACE_OUTPUT="$SIMULATION_ROOT/credentials/app-secrets.json"
  rm -f "$RACE_OUTPUT" "$RACE_OUTPUT.created"
  RACE_READY="$TEST_TMP/race-$attempt.ready"
  RACE_REPLACED="$TEST_TMP/race-$attempt.replaced"
  node - "$RACE_OUTPUT" "$RACE_READY" "$RACE_REPLACED" <<'NODE' &
const fs = require('node:fs');
const [target, ready, replaced] = process.argv.slice(2);
const held = `${target}.created`;
const deadline = Date.now() + 10_000;
fs.writeFileSync(ready, 'ready\n', { flag: 'wx', mode: 0o600 });
function replaceWhenPublished() {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isFile() && stat.size > 0) {
      const bytes = fs.readFileSync(target);
      fs.renameSync(target, held);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(replaced, 'replaced\n', { flag: 'wx', mode: 0o600 });
      process.exit(0);
    }
  } catch {}
  if (Date.now() >= deadline) process.exit(2);
  setImmediate(replaceWhenPublished);
}
replaceWhenPublished();
NODE
  RACE_WATCHER_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ -f "$RACE_READY" ] && break
    sleep 0.01
  done
  [ -f "$RACE_READY" ] || fail_test 'replacement watcher did not become ready'
  set +e
  AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
    --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$RACE_OUTPUT" \
    --simulation --simulation-root "$SIMULATION_ROOT" \
    >"$TEST_TMP/race-$attempt.stdout" 2>"$TEST_TMP/race-$attempt.stderr"
  RACE_PROVIDER_RC=$?
  wait "$RACE_WATCHER_PID"
  RACE_WATCHER_RC=$?
  set -e
  if [ "$RACE_WATCHER_RC" -eq 0 ] && [ -f "$RACE_REPLACED" ] \
      && [ "$RACE_PROVIDER_RC" -ne 0 ] \
      && grep -F 'credential output identity changed after publication' \
        "$TEST_TMP/race-$attempt.stderr" >/dev/null; then
    RACE_DETECTED=1
    break
  fi
  rm -f "$RACE_OUTPUT" "$RACE_OUTPUT.created"
done
assert_eq "$RACE_DETECTED" 1

note "published key set is exact and existing output is never replaced"
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(Object.keys(v).sort().join(","))' "$SIMULATION_ROOT/credentials/app-secrets.json")" \
  "BINANCE_API_KEY,BINANCE_API_SECRET"
OUTPUT_IDENTITY_BEFORE="$(node -e 'const fs=require("fs"),crypto=require("crypto"),s=fs.lstatSync(process.argv[1],{bigint:true});process.stdout.write([s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs,crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")].map(String).join(":"))' "$SIMULATION_ROOT/credentials/app-secrets.json")"
assert_failure env AWS_CLI="$SIMULATION_AWS" node "$I00_ROOT/bin/secrets-provider.mjs" \
  --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
  --simulation --simulation-root "$SIMULATION_ROOT"
OUTPUT_IDENTITY_AFTER="$(node -e 'const fs=require("fs"),crypto=require("crypto"),s=fs.lstatSync(process.argv[1],{bigint:true});process.stdout.write([s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs,crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")].map(String).join(":"))' "$SIMULATION_ROOT/credentials/app-secrets.json")"
assert_eq "$OUTPUT_IDENTITY_AFTER" "$OUTPUT_IDENTITY_BEFORE"
rm -f "$SIMULATION_ROOT/credentials/app-secrets.json" \
  "$SIMULATION_ROOT/credentials/app-secrets.json.created"

provider_config_failure() {
  local variant="$1" aws_cli="$2" expected="${3:-}"
  local canonical="$PROVIDER_CONFIG_ROOT/secrets-provider.json"
  local saved="$PROVIDER_CONFIG_ROOT/secrets-provider.saved.json"
  mv "$canonical" "$saved"
  cp "$variant" "$canonical"
  chmod 600 "$canonical"
  local provider_output provider_rc
  set +e
  provider_output="$(
    env AWS_CLI="$aws_cli" node "$I00_ROOT/bin/secrets-provider.mjs" \
      --config "$canonical" \
      --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
      --simulation --simulation-root "$SIMULATION_ROOT" 2>&1
  )"
  provider_rc=$?
  set -e
  rm "$canonical"
  mv "$saved" "$canonical"
  [ "$provider_rc" -ne 0 ] || fail_test 'provider config variant unexpectedly succeeded'
  if [ -n "$expected" ]; then assert_contains "$provider_output" "$expected"; fi
  assert_not_file "$SIMULATION_ROOT/credentials/app-secrets.json"
}

node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.requiredKeys=["BINANCE_API_KEY","BINANCE_API_SECRET","EXTRA_REQUIRED_KEY"];fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-missing-key.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-missing-key.json" "$SIMULATION_AWS"

note "exact CLI digest, safe executable, and STS role identity fail closed"
WRONG_ROLE_AWS="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$SIMULATION_ROOT/fakes/aws-wrong-role.sh")"
WRONG_ROLE_SHA256="$(node -e 'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$WRONG_ROLE_AWS")"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.awsCliPath=process.argv[3];v.awsCliSha256=process.argv[4];fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-wrong-role.json" "$WRONG_ROLE_AWS" "$WRONG_ROLE_SHA256"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-wrong-role.json" "$WRONG_ROLE_AWS" \
  'caller identity does not match the exact configured instance role'
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.awsCliSha256="0".repeat(64);fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-wrong-cli-digest.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-wrong-cli-digest.json" \
  "$SIMULATION_AWS" 'AWS CLI digest does not match'
UNSAFE_AWS="$TEST_TMP/aws-unsafe.sh"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$UNSAFE_AWS"
chmod 0775 "$UNSAFE_AWS"
UNSAFE_AWS="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$UNSAFE_AWS")"
UNSAFE_AWS_SHA256="$(node -e 'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$UNSAFE_AWS")"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.awsCliPath=process.argv[3];v.awsCliSha256=process.argv[4];fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-unsafe-cli.json" "$UNSAFE_AWS" "$UNSAFE_AWS_SHA256"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-unsafe-cli.json" "$UNSAFE_AWS" \
  'simulation AWS_CLI is outside the declared fake root'
UNTRUSTED_CLI_ROOT="$TEST_TMP/untrusted-cli"
mkdir -p "$UNTRUSTED_CLI_ROOT/bin"
chmod 0770 "$UNTRUSTED_CLI_ROOT"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$UNTRUSTED_CLI_ROOT/bin/aws"
chmod 0755 "$UNTRUSTED_CLI_ROOT/bin/aws"
UNTRUSTED_AWS="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$UNTRUSTED_CLI_ROOT/bin/aws")"
UNTRUSTED_AWS_SHA256="$(node -e 'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$UNTRUSTED_AWS")"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.awsCliPath=process.argv[3];v.awsCliSha256=process.argv[4];fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-untrusted-cli-ancestor.json" "$UNTRUSTED_AWS" "$UNTRUSTED_AWS_SHA256"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-untrusted-cli-ancestor.json" \
  "$UNTRUSTED_AWS" 'simulation AWS_CLI is outside the declared fake root'
ln -s "$SIMULATION_AWS" "$TEST_TMP/aws-provider-symlink.sh"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.awsCliPath=process.argv[3];fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-symlink-cli.json" "$TEST_TMP/aws-provider-symlink.sh"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-symlink-cli.json" \
  "$TEST_TMP/aws-provider-symlink.sh" \
  'simulation AWS_CLI is outside the declared fake root'

note "missing provider, ambient credentials, and wildcard ARN fail closed"
assert_failure node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$TEST_TMP/none.json" --simulation
assert_failure env AWS_ACCESS_KEY_ID=FORBIDDEN AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$SIMULATION_ROOT/credentials/app-secrets.json" --simulation --simulation-root "$SIMULATION_ROOT"
note "DEPLOY-PORTABILITY-008: every local Node helper spawn receives the closed environment"
assert_eq "$(
  grep -c '\.\.\.closedLocalEnvironment' "$I00_ROOT/bin/secrets-provider.mjs"
)" 3
assert_contains "$(cat "$I00_ROOT/bin/secrets-provider.mjs")" \
  'TMPDIR: simulationTmp'
assert_success env AWS_WEB_IDENTITY_TOKEN_FILE=/tmp/forbidden-web-identity \
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/forbidden-container \
  AWS_CONFIG_FILE=/tmp/forbidden-config \
  AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" \
  node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" \
  --output "$SIMULATION_ROOT/credentials/app-secrets.json" --simulation --simulation-root "$SIMULATION_ROOT"
rm "$SIMULATION_ROOT/credentials/app-secrets.json"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.region="eu-west-1";fs.writeFileSync(p,JSON.stringify(v));' "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-region-mismatch.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-region-mismatch.json" "$SIMULATION_AWS"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.unreviewed="forbidden";fs.writeFileSync(p,JSON.stringify(v));' "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-extra.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-extra.json" "$SIMULATION_AWS"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.schemaVersion=3;fs.writeFileSync(p,JSON.stringify(v));' "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-wrong-schema.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-wrong-schema.json" "$SIMULATION_AWS"
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);delete v.secretVersionId;fs.writeFileSync(p,JSON.stringify(v));' "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-missing-version.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-missing-version.json" \
  "$SIMULATION_AWS" 'config.secretVersionId is required'
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.secretVersionId="short";fs.writeFileSync(p,JSON.stringify(v));' "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-short-version.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-short-version.json" \
  "$SIMULATION_AWS" 'secretVersionId must bind one exact 32-64 character'
node -e 'const fs=require("fs");const s=process.argv[1],p=process.argv[2];const v=require(s);v.secretArn="arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/*";fs.writeFileSync(p,JSON.stringify(v));' \
  "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$PROVIDER_CONFIG_ROOT/provider-wildcard.json"
provider_config_failure "$PROVIDER_CONFIG_ROOT/provider-wildcard.json" "$SIMULATION_AWS"
assert_failure env AWS_CLI=/usr/local/bin/aws node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$SIMULATION_ROOT/credentials/app-secrets.json" --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure env AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$PROVIDER_CONFIG_ROOT/secrets-provider.json" --output "$TEST_TMP/outside.json" --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure node "$I00_ROOT/bin/create-simulation-root.mjs" --root /
ln -s "$SIMULATION_ROOT/fakes/aws-fixture.sh" "$SIMULATION_ROOT/fakes/aws-symlink.sh"
assert_failure node "$I00_ROOT/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_ROOT/fakes/aws-symlink.sh"
MALICIOUS_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-malicious-$$")"
printf '#!/usr/bin/env bash\nexec /usr/bin/systemctl "$@"\n' > "$MALICIOUS_ROOT/fake.sh"
chmod +x "$MALICIOUS_ROOT/fake.sh"
assert_failure node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$MALICIOUS_ROOT" --commands "$MALICIOUS_ROOT/fake.sh"
rm -rf "$MALICIOUS_ROOT"

note "alternate interpreter is rejected before single-use authorization consumption"
assert_failure_contains 'executing Node differs from the producer chain' \
  "$CANONICAL_NODE" "$I00_ROOT/bin/secret-materialization.mjs" \
  --authorization "$AUTH_ROOT/auth.json" \
  --deployment-risk "$AUTH_ROOT/risk.json" \
  --action-preview "$AUTH_ROOT/preview.json" \
  --authorization-consumption-root "$CLAIM_ROOT"
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

note "alternate wrapper path is rejected before single-use authorization consumption"
ALTERNATE_I00="$SIMULATION_ROOT/alternate-wrapper-i00"
mkdir -p "$ALTERNATE_I00/bin"
chmod 700 "$ALTERNATE_I00" "$ALTERNATE_I00/bin"
cp "$I00_ROOT/bin/secret-materialization.mjs" \
  "$ALTERNATE_I00/bin/secret-materialization.mjs"
chmod 755 "$ALTERNATE_I00/bin/secret-materialization.mjs"
ln -s "$I00_ROOT/bin/inspect-executable.mjs" \
  "$ALTERNATE_I00/bin/inspect-executable.mjs"
ln -s "$I00_ROOT/deployment-authorization-contract.mjs" \
  "$ALTERNATE_I00/deployment-authorization-contract.mjs"
ln -s "$I00_ROOT/simulation-safety.mjs" \
  "$ALTERNATE_I00/simulation-safety.mjs"
assert_failure_contains 'executing wrapper differs from the producer chain' \
  "$COMMAND_ROOT/node" "$ALTERNATE_I00/bin/secret-materialization.mjs" \
  --authorization "$AUTH_ROOT/auth.json" \
  --deployment-risk "$AUTH_ROOT/risk.json" \
  --action-preview "$AUTH_ROOT/preview.json" \
  --authorization-consumption-root "$CLAIM_ROOT"
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

note "authorization scope and expiry are exact"
AUTH_CLOCK=(--simulation-clock --now 2026-07-13T00:30:00Z)
AUTH_BASE=(--input "$AUTH_ROOT/auth.json" --class SECRET_MATERIALIZATION "${AUTH_CLOCK[@]}" --command secrets-provider \
  --expected-operator ops-owner-17 \
  --expected-deployed-sha 0123456789abcdef0123456789abcdef01234567 \
  --expected-config-version config-i00-production-17 \
  --deployment-risk "$AUTH_ROOT/risk.json" \
  --action-preview "$AUTH_ROOT/preview.json" \
  --consumption-root "$CLAIM_ROOT" \
  --expected-host ip-10-0-0-10.internal \
  --expected-environment production \
  --expected-scope cosmos-production-secret-materialization \
  --expected-account aws:123456789012 \
  --expected-product "AWS Secrets Manager" \
  --expected-credential-type AWS_INSTANCE_PROFILE_ROLE \
  --expected-permission secretsmanager:GetSecretValue \
  --expected-permission sts:GetCallerIdentity \
  --expected-result-receipt "$RESULT_RECEIPT" \
  --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" \
  --expected-maximum-capital ZERO \
  --expected-maximum-notional ZERO \
  --expected-maximum-effect "read one exact secret version into one exact 0600 runtime credential")
while IFS= read -r endpoint; do
  AUTH_BASE+=(--expected-endpoint "$endpoint")
done < <(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const endpoint of v.action.allowedEndpoints) console.log(endpoint)' "$AUTH_ROOT/preview.json")
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$AUTH_ROOT/auth.json" --class SECRET_MATERIALIZATION "${AUTH_CLOCK[@]}" --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$AUTH_ROOT/auth.json" --class SERVICE_RELEASE_SWITCH "${AUTH_CLOCK[@]}" --command release-switch --expected-host ip-10-0-0-10.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$AUTH_ROOT/auth.json" --class SECRET_MATERIALIZATION --simulation-clock --now 2026-07-13T02:00:00Z --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$AUTH_ROOT/auth.json" --class SECRET_MATERIALIZATION "${AUTH_CLOCK[@]}" --command secrets-provider --expected-host other-host.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$AUTH_ROOT/auth.json" --class SECRET_MATERIALIZATION --now 2026-07-13T00:30:00Z --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production

note "authorization rejects missing, empty, placeholder, broadened, and reused scope"
mutate_auth() {
  local output="$1" expression="$2"
  node --input-type=module - "$I00_ROOT/deployment-authorization-contract.mjs" "$AUTH_ROOT/auth.json" "$output" "$expression" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { canonicalJsonBytes } = await import(pathToFileURL(process.argv[2]).href);
const [source, output, expression] = process.argv.slice(3);
const value = JSON.parse(readFileSync(source, 'utf8'));
new Function('value', expression)(value);
writeFileSync(output, canonicalJsonBytes(value), { mode: 0o600 });
NODE
}
replace_arg_value() {
  local target="$1" replacement="$2" found=0
  local -a replaced=()
  local index
  for ((index = 0; index < ${#AUTH_BASE[@]}; index += 1)); do
    if [ "${AUTH_BASE[$index]}" = "$target" ]; then
      replaced+=("$target" "$replacement")
      index=$((index + 1))
      found=$((found + 1))
    else
      replaced+=("${AUTH_BASE[$index]}")
    fi
  done
  [ "$found" = 1 ] || fail_test "expected one $target argument"
  assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${replaced[@]}"
}
replace_repeated_arg_value() {
  local target="$1" original="$2" replacement="$3" found=0
  local -a replaced=()
  local index
  for ((index = 0; index < ${#AUTH_BASE[@]}; index += 1)); do
    if [ "${AUTH_BASE[$index]}" = "$target" ] \
      && [ "${AUTH_BASE[$((index + 1))]}" = "$original" ]; then
      replaced+=("$target" "$replacement")
      index=$((index + 1))
      found=$((found + 1))
    else
      replaced+=("${AUTH_BASE[$index]}")
    fi
  done
  [ "$found" = 1 ] || fail_test "expected one exact $target value"
  assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${replaced[@]}"
}

note "authorization time refusals name the exact direction and bound values"
assert_timed_auth_failure() { # argument-name replacement expected-message
  local target="$1" replacement="$2" expected="$3" found=0
  local -a timed_args=("${AUTH_BASE[@]}")
  local index
  for ((index = 0; index < ${#timed_args[@]}; index += 1)); do
    if [ "${timed_args[$index]}" = "$target" ]; then
      timed_args[$((index + 1))]="$replacement"
      found=$((found + 1))
    fi
  done
  [ "$found" = 1 ] || fail_test "expected one $target timing argument"
  assert_failure_contains "$expected" \
    node "$I00_ROOT/bin/validate-authorization.mjs" "${timed_args[@]}"
}
mutate_auth "$AUTH_ROOT/auth-issued-after-start.json" \
  'value.issuedAtUtc="2026-07-13T00:16:00Z";'
assert_timed_auth_failure --input "$AUTH_ROOT/auth-issued-after-start.json" \
  'authorization time ordering must be issued <= start < expiry: issuedAtUtc 2026-07-13T00:16:00Z is AFTER startsAtUtc 2026-07-13T00:15:00Z'

mutate_auth "$AUTH_ROOT/auth-start-at-expiry.json" \
  'value.startsAtUtc="2026-07-13T01:00:00Z";'
assert_timed_auth_failure --input "$AUTH_ROOT/auth-start-at-expiry.json" \
  'authorization time ordering must be issued <= start < expiry: startsAtUtc 2026-07-13T01:00:00Z is not BEFORE expiresAtUtc 2026-07-13T01:00:00Z'

assert_timed_auth_failure --now 2026-07-13T00:14:59Z \
  'external authorization is not active yet: evaluation time 2026-07-13T00:14:59Z is BEFORE startsAtUtc 2026-07-13T00:15:00Z'

assert_timed_auth_failure --now 2026-07-13T01:00:00Z \
  'external authorization has expired: evaluation time 2026-07-13T01:00:00Z is AT OR AFTER expiresAtUtc 2026-07-13T01:00:00Z'

mutate_auth "$AUTH_ROOT/auth-approval-before-issue.json" \
  'value.ownerApproval.approvedAtUtc="2026-07-12T23:59:59Z";'
assert_timed_auth_failure --input "$AUTH_ROOT/auth-approval-before-issue.json" \
  'owner approval must occur at or after issue and no later than start: ownerApproval.approvedAtUtc 2026-07-12T23:59:59Z is BEFORE issuedAtUtc 2026-07-13T00:00:00Z'

mutate_auth "$AUTH_ROOT/auth-approval-after-start.json" \
  'value.ownerApproval.approvedAtUtc="2026-07-13T00:15:01Z";'
assert_timed_auth_failure --input "$AUTH_ROOT/auth-approval-after-start.json" \
  'owner approval must occur at or after issue and no later than start: ownerApproval.approvedAtUtc 2026-07-13T00:15:01Z is AFTER startsAtUtc 2026-07-13T00:15:00Z'

assert_eq \
  "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" \
  0

note "authorization time-guard split preserves every prior verdict"
assert_success node --input-type=module - \
  "$I00_ROOT/bin/validate-authorization.mjs" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const anchors = [
  'if (issuedAt > startsAt) {',
  'if (startsAt >= expiresAt) {',
  'if (Date.parse(initialEvaluationTime) < startsAt) {',
  'if (Date.parse(initialEvaluationTime) >= expiresAt) {',
  'if (approvedAt < issuedAt) {',
  'if (approvedAt > startsAt) {',
];
for (const anchor of anchors) {
  assert.equal(source.split(anchor).length - 1, 1);
}
const messages = [...source.matchAll(
  /fail\(`([^`]*(?:issuedAtUtc|startsAtUtc|expiresAtUtc|evaluation time)[^`]*)`\)/gu,
)].map((match) => match[1]);
assert.equal(messages.length, 6);
assert.equal(new Set(messages).size, 6);
for (const message of messages) {
  assert.match(message, /\b(?:AFTER|BEFORE|AT OR AFTER|not BEFORE)\b/u);
  assert.ok((message.match(/\$\{/gu) ?? []).length >= 2);
}

const oldDecide = (issued, starts, expires, now, approved) => {
  if (issued > starts || starts >= expires) return 'ORDERING';
  if (now < starts || now >= expires) return 'WINDOW';
  if (approved < issued || approved > starts) return 'APPROVAL';
  return 'ACCEPT';
};
const newDecide = (issued, starts, expires, now, approved) => {
  if (issued > starts) return 'ORDERING';
  if (starts >= expires) return 'ORDERING';
  if (now < starts) return 'WINDOW';
  if (now >= expires) return 'WINDOW';
  if (approved < issued) return 'APPROVAL';
  if (approved > starts) return 'APPROVAL';
  return 'ACCEPT';
};
const weakened = (issued, starts, expires, now, approved) => {
  if (issued > starts) return 'ORDERING';
  if (starts >= expires) return 'ORDERING';
  if (now < starts) return 'WINDOW';
  if (now >= expires) return 'WINDOW';
  if (approved < issued) return 'APPROVAL';
  return 'ACCEPT';
};

const domain = [0, 1, 2, 3, 4];
let cases = 0;
let mismatches = 0;
let accepted = 0;
let negativeControlDivergences = 0;
const outcomes = new Set();
for (const issued of domain) {
  for (const starts of domain) {
    for (const expires of domain) {
      for (const now of domain) {
        for (const approved of domain) {
          cases += 1;
          const prior = oldDecide(issued, starts, expires, now, approved);
          const current = newDecide(issued, starts, expires, now, approved);
          outcomes.add(current);
          if (current === 'ACCEPT') accepted += 1;
          if (prior !== current) mismatches += 1;
          if (prior !== weakened(issued, starts, expires, now, approved)) {
            negativeControlDivergences += 1;
          }
        }
      }
    }
  }
}
assert.equal(cases, 3_125);
assert.equal(mismatches, 0);
assert.deepEqual(
  [...outcomes].sort(),
  ['ACCEPT', 'APPROVAL', 'ORDERING', 'WINDOW'],
);
assert.equal(accepted, 56);
assert.equal(negativeControlDivergences, 98);
NODE

mutate_auth "$AUTH_ROOT/auth-missing.json" 'delete value.receiptTargets;'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-missing.json}"
mutate_auth "$AUTH_ROOT/auth-missing-start.json" 'delete value.startsAtUtc;'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-missing-start.json}"
for field in operator deployedSha configVersion riskVersion nonce serverPreviewDigest; do
  mutate_auth "$AUTH_ROOT/auth-missing-$field.json" "delete value.$field;"
  assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-missing-$field.json}"
done
mutate_auth "$AUTH_ROOT/auth-extra.json" 'value.unreviewedBinding="forbidden";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-extra.json}"
mutate_auth "$AUTH_ROOT/auth-short-sha.json" 'value.deployedSha="0123456789abcdef";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-short-sha.json}"
mutate_auth "$AUTH_ROOT/auth-short-nonce.json" 'value.nonce="deadbeef";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-short-nonce.json}"
mutate_auth "$AUTH_ROOT/auth-bad-preview.json" 'value.serverPreviewDigest="sha256:abcd";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-bad-preview.json}"
mutate_auth "$AUTH_ROOT/auth-empty.json" 'value.preconditions=[];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-empty.json}"
mutate_auth "$AUTH_ROOT/auth-placeholder.json" 'value.account="REPLACE_ME_ACCOUNT";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-placeholder.json}"
mutate_auth "$AUTH_ROOT/auth-broadened.json" 'value.actionClasses.push("SERVICE_RELEASE_SWITCH");'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-broadened.json}"
mutate_auth "$AUTH_ROOT/auth-wildcard.json" 'value.allowedCommands=["*"];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-wildcard.json}"
mutate_auth "$AUTH_ROOT/auth-secret-field.json" 'value.allowedCredentials.secretValue="forbidden";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-secret-field.json}"
mutate_auth "$AUTH_ROOT/auth-withdrawal.json" 'value.allowedCredentials.permissions=["exchange:Withdraw"];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-withdrawal.json}"
node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],JSON.stringify(v));' "$AUTH_ROOT/auth.json" "$AUTH_ROOT/auth-noncanonical.json"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-noncanonical.json}"
node -e 'const fs=require("fs");const v=fs.readFileSync(process.argv[1],"utf8");fs.writeFileSync(process.argv[2],v.replace(/\\{/, "{\"status\":\"APPROVED\","));' "$AUTH_ROOT/auth.json" "$AUTH_ROOT/auth-duplicate-key.json"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-duplicate-key.json}"
replace_arg_value --expected-account aws:999999999999
replace_arg_value --expected-operator another-operator
replace_arg_value --expected-deployed-sha fedcba9876543210fedcba9876543210fedcba98
replace_arg_value --expected-config-version config-i00-production-18
ALTERNATE_CLAIM_ROOT="$SIMULATION_ROOT/alternate-consumption"
mkdir "$ALTERNATE_CLAIM_ROOT"
chmod 700 "$ALTERNATE_CLAIM_ROOT"
replace_arg_value --deployment-risk "$AUTH_ROOT/alternate-risk.json"
replace_arg_value --action-preview "$AUTH_ROOT/alternate-preview.json"
replace_arg_value --consumption-root "$ALTERNATE_CLAIM_ROOT"
assert_failure_contains 'duplicate argument --expected-account' \
  node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-account aws:999999999999
MISSING_ENDPOINT_BASE=("${AUTH_BASE[@]}")
MISSING_ENDPOINT_BASE=()
for ((index = 0; index < ${#AUTH_BASE[@]}; index += 1)); do
  if [ "${AUTH_BASE[$index]}" = --expected-endpoint ] \
    && [ "${AUTH_BASE[$((index + 1))]}" = "$CREDENTIAL_OUTPUT" ]; then
    index=$((index + 1))
    continue
  fi
  MISSING_ENDPOINT_BASE+=("${AUTH_BASE[$index]}")
done
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${MISSING_ENDPOINT_BASE[@]}"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-endpoint arn:aws:secretsmanager:ap-south-1:123456789012:secret:some-other-secret
mutate_auth "$AUTH_ROOT/auth-extra-endpoint.json" 'value.allowedEndpoints.push("/unreviewed/path");'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$AUTH_ROOT\/auth.json/$AUTH_ROOT\/auth-extra-endpoint.json}"
replace_arg_value --expected-product "Cloudflare Tunnel"
replace_arg_value --expected-credential-type AWS_STATIC_ACCESS_KEY
replace_repeated_arg_value --expected-permission secretsmanager:GetSecretValue secretsmanager:PutSecretValue
replace_repeated_arg_value --expected-permission sts:GetCallerIdentity iam:GetRole
replace_repeated_arg_value --expected-endpoint "aws-cli-sha256:$SIMULATION_AWS_SHA256" "aws-cli-sha256:$(printf 'f%.0s' {1..64})"
replace_repeated_arg_value --expected-endpoint "aws-cli-identity:$SIMULATION_AWS_IDENTITY" \
  "aws-cli-identity:device=1,inode=2,mode=100555,size=3,mtimeNs=4,ctimeNs=5"
replace_repeated_arg_value --expected-endpoint "instance-role-arn:$INSTANCE_ROLE_ARN" \
  "instance-role-arn:arn:aws:iam::123456789012:role/other-instance-role"
replace_arg_value --expected-result-receipt /tmp/reused-result.json
replace_arg_value --expected-maximum-effect "read any secret"

note "authorization is consumed once after every binding passes"
assert_success node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}"
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}"

note "legacy external action callers retain their complete independent expectation sets"
for caller in release-switch.sh rollback-switch.sh install-ops-bundle.sh backup-verify.sh restore-drill-verify.sh; do
  SOURCE="$(cat "$I00_ROOT/bin/$caller")"
  for binding in --expected-operator --expected-deployed-sha --expected-config-version --deployment-risk --action-preview --consumption-root --expected-endpoint; do
    assert_contains "$SOURCE" "$binding"
  done
  assert_eq "$(grep -c 'validate-authorization\.mjs' "$I00_ROOT/bin/$caller")" 1
done
SECRETS_SOURCE="$(cat "$I00_ROOT/bin/secrets-provider.mjs")"
SECRET_WRAPPER_SOURCE="$(cat "$I00_ROOT/bin/secret-materialization.mjs")"
assert_eq "$(grep -c 'validate-authorization\\.mjs' "$I00_ROOT/bin/secrets-provider.mjs" || true)" 0
assert_eq "$(grep -c 'record-authorized-action-outcome\\.mjs' "$I00_ROOT/bin/secrets-provider.mjs" || true)" 0
assert_contains "$SECRETS_SOURCE" 'Array.from({ length: 51 }, (_, index) => index + 3)'
assert_contains "$SECRETS_SOURCE" 'const stdio = Array.from({ length: 54 }, () => '\''ignore'\'')'
assert_contains "$SECRETS_SOURCE" "const RETAINED_SECRET_EFFECT_FDS = new Set([12, 15, 32])"
assert_contains "$SECRETS_SOURCE" "result.hashPolicy !== 'NONE'"
for label in \
  'authorized secret effect write roots' \
  'authorized secret effect read roots' \
  'authorized secret effect observed roots' \
  'authorized secret effect automatic rollback'; do
  assert_contains "$SECRETS_SOURCE" "$label"
done
assert_contains "$SECRETS_SOURCE" 'authorized TEST provider requires the exact descriptor-only config and output contract'
assert_contains "$SECRETS_SOURCE" 'authorized provider does not accept an AWS_CLI override'
assert_contains "$SECRETS_SOURCE" "'--region', config.region, '--version-id', config.secretVersionId"
assert_contains "$SECRETS_SOURCE" "'sts', 'get-caller-identity'"
assert_contains "$SECRETS_SOURCE" "aws = '/proc/self/fd/32'"
assert_contains "$SECRETS_SOURCE" "readAuthorizedProviderConfig(rawConfig, 12)"
assert_contains "$SECRETS_SOURCE" "outputParentDescriptor = 15"
assert_contains "$SECRETS_SOURCE" "spawnSync('/proc/self/fd/14'"
assert_contains "$SECRETS_SOURCE" "'/proc/self/fd/13'"
note "authorized verifier receives only the exact bootstrap locator projection"
assert_success node --input-type=module - "$I00_ROOT/bin/secrets-provider.mjs" <<'NODE'
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const expected = [
  'I00_AUTHORIZED_EFFECT_ROOT_MODE',
  'I00_AUTHORIZED_EFFECT_RUNNER_PATH',
  'I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH',
  'I00_AUTHORIZED_EFFECT_PROGRAM_PATH',
];
const acceptsExactProjection = (candidate) => {
  const declaration = candidate.match(
    /const AUTHORIZED_EFFECT_BOOTSTRAP_LOCATORS = Object\.freeze\(\[([\s\S]*?)\]\);/u,
  );
  if (declaration === null) return false;
  const declared = [...declaration[1].matchAll(/'([^']+)'/gu)]
    .map((match) => match[1]);
  if (JSON.stringify(declared) !== JSON.stringify(expected)) return false;
  const constructorStart = candidate.indexOf('const verifierEnvironment = {');
  const constructorEnd = candidate.indexOf(
    "const verified = spawnSync('/proc/self/fd/14'",
    constructorStart,
  );
  if (constructorStart < 0 || constructorEnd < 0) return false;
  const constructor = candidate.slice(constructorStart, constructorEnd).trimEnd();
  return constructor === [
    'const verifierEnvironment = {',
    '    ...closedLocalEnvironment,',
    '    ...Object.fromEntries(descriptorEntries.map(',
    '      ([name, descriptor]) => [name, String(descriptor)],',
    '    )),',
    '    ...Object.fromEntries(bootstrapEntries),',
    '  };',
  ].join('\n');
};
if (!acceptsExactProjection(source)) process.exit(1);
for (const omitted of expected) {
  const hostile = source.replace(`  '${omitted}',\n`, '');
  if (hostile === source || acceptsExactProjection(hostile)) process.exit(1);
}
const hostile = source.replace(
  "  'I00_AUTHORIZED_EFFECT_PROGRAM_PATH',\n",
  "  'I00_AUTHORIZED_EFFECT_PROGRAM_PATH',\n  'NODE_OPTIONS',\n",
);
if (hostile === source || acceptsExactProjection(hostile)) process.exit(1);
const directHostile = source.replace(
  '    ...closedLocalEnvironment,\n',
  '    ...closedLocalEnvironment,\n'
    + '    NODE_OPTIONS: process.env.NODE_OPTIONS,\n',
);
if (directHostile === source || acceptsExactProjection(directHostile)) process.exit(1);
NODE

note "authorized effect handoff result binds one claim and no secret-class output"
assert_success node --input-type=module - "$I00_ROOT/bin/secrets-provider.mjs" <<'NODE'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const source = readFileSync(process.argv[2], 'utf8');
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const program = parse(source, { sourceType: 'module' }).program;
const declaration = program.body.find((node) => (
  node.type === 'FunctionDeclaration'
    && node.id?.name === 'validateAuthorizedEffectHandoffResult'
));
if (declaration === undefined) process.exit(1);
const functionSource = source.slice(declaration.start, declaration.end);
const fail = (message) => {
  throw new Error(message);
};
const requireExactKeys = (value, expected, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object`);
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
      || !actual.every((key, index) => key === sortedExpected[index])) {
    fail(`${label} has an unexpected field set`);
  }
};
const validate = new Function(
  'requireExactKeys',
  'fail',
  `${functionSource}\nreturn validateAuthorizedEffectHandoffResult;`,
)(requireExactKeys, fail);
const exact = Object.freeze({
  status: 'AUTHORIZED_EFFECT_HANDOFF_VERIFIED',
  role: 'PRIMARY_EFFECT',
  actionClass: 'SECRET_MATERIALIZATION',
  claimKey: 'a'.repeat(64),
  command: 'secrets-provider',
  environment: Object.freeze({ kind: 'PROVIDER_CONFIG', fd: '/proc/self/fd/12' }),
  bootstrap: Object.freeze({ kind: 'VERIFIER_SOURCE', fd: '/proc/self/fd/13' }),
  directory: Object.freeze({
    kind: 'CREDENTIAL_OUTPUT_PARENT',
    fd: '/proc/self/fd/15',
  }),
  executables: Object.freeze({ aws: '/proc/self/fd/32' }),
  writeRoots: Object.freeze({}),
  readRoots: Object.freeze({}),
  observedRoots: Object.freeze({}),
  helperPolicy: 'NONE',
  automaticRollback: Object.freeze({}),
  effectOutput: Object.freeze({}),
  hashPolicy: 'NONE',
});
validate(exact);
const missingClaim = { ...exact };
delete missingClaim.claimKey;
const missingOutput = { ...exact };
delete missingOutput.effectOutput;
for (const hostile of [
  missingClaim,
  missingOutput,
  { ...exact, claimKey: 'a'.repeat(63) },
  { ...exact, claimKey: 'A'.repeat(64) },
  { ...exact, effectOutput: { fd: '/proc/self/fd/53' } },
  { ...exact, effectOutput: [] },
]) {
  let rejected = false;
  try {
    validate(hostile);
  } catch {
    rejected = true;
  }
  if (!rejected) process.exit(1);
}
for (const field of [
  'writeRoots',
  'readRoots',
  'observedRoots',
  'automaticRollback',
]) {
  for (const value of [[], 'NONE', null, { unexpected: true }]) {
    let rejected = false;
    try {
      validate({ ...exact, [field]: value });
    } catch {
      rejected = true;
    }
    if (!rejected) process.exit(1);
  }
}
NODE

assert_contains "$SECRETS_SOURCE" "AWS_CONFIG_FILE: '/dev/null'"
assert_contains "$SECRETS_SOURCE" 'TMPDIR: simulationTmp'
assert_contains "$SECRETS_SOURCE" 'SYSTEM provider rejects named config and output inputs'
assert_contains "$SECRETS_SOURCE" "args['config-fd'] !== '12'"
assert_contains "$SECRETS_SOURCE" "args['output-parent-fd'] !== '15'"
assert_contains "$SECRETS_SOURCE" 'STAGING secret materialization is forbidden'
if grep -F 'tmpdir()' "$I00_ROOT/bin/secrets-provider.mjs" >/dev/null; then
  fail_test 'provider selected TEST TMPDIR from ambient process state'
fi
pass_assertion
assert_contains "$SECRETS_SOURCE" 'timeout: AWS_COMMAND_TIMEOUT_MS'
assert_contains "$SECRETS_SOURCE" 'timeout: HANDOFF_VERIFIER_TIMEOUT_MS'
assert_contains "$SECRETS_SOURCE" 'const closedLocalEnvironment = Object.freeze({'
assert_success node - "$I00_ROOT/bin/secrets-provider.mjs" <<'NODE'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const stagingReject = source.indexOf("if (provenanceMode === 'STAGING')");
const handoffStage = source.indexOf(
  "setPrepublicationFailure('HANDOFF_VERIFICATION', 'HANDOFF_REJECTED')",
);
const handoffVerify = source.indexOf('verifyAuthorizedEffectHandoff();', handoffStage);
const configRead = source.indexOf('readAuthorizedProviderConfig(rawConfig, 12)');
const stsEffect = source.indexOf('const caller = spawnAws([');
if (stagingReject < 0 || handoffStage < 0 || handoffVerify < 0
    || configRead < 0 || stsEffect < 0
    || stagingReject > handoffStage || handoffStage > handoffVerify
    || handoffVerify > configRead
    || configRead > stsEffect) process.exit(2);
NODE
assert_contains "$SECRETS_SOURCE" 'requireSameAuthorizedOutputParent(outputParent, outputParentDescriptor)'
assert_contains "$SECRETS_SOURCE" '`/proc/self/fd/${outputParentDescriptor}/${basename(output)}`'
assert_contains "$SECRETS_SOURCE" 'fsyncSync(outputParentDescriptor)'
assert_contains "$SECRETS_SOURCE" 'retainedCredentialDescriptor = outputDescriptor'
assert_contains "$SECRETS_SOURCE" 'retainedOutputParentDescriptor = outputParentDescriptor'
if grep -F -- '--key-count' "$I00_ROOT/bin/secrets-provider.mjs" >/dev/null; then
  fail_test 'provider supplied a caller-asserted secret key count'
fi
pass_assertion
assert_contains "$SECRETS_SOURCE" 'const createdOutputIdentity = fileIdentity(createdOutput)'
assert_contains "$SECRETS_SOURCE" 'fileIdentity(current) !== expectedIdentity'
assert_failure_contains 'secret materialization requires exactly four path-only controls' \
  node "$I00_ROOT/bin/secret-materialization.mjs"
assert_failure_contains 'must be one raw canonical non-root absolute path' \
  node "$I00_ROOT/bin/secret-materialization.mjs" \
  --authorization relative.json \
  --deployment-risk "$AUTH_ROOT/risk.json" \
  --action-preview "$AUTH_ROOT/preview.json" \
  --authorization-consumption-root "$CLAIM_ROOT"
assert_eq "$(grep -c 'runNode(VALIDATOR' "$I00_ROOT/bin/secret-materialization.mjs")" 1
assert_eq "$(grep -c 'runNode(RUNNER' "$I00_ROOT/bin/secret-materialization.mjs")" 1
assert_eq "$(grep -c 'runNode(OUTCOME_RECORDER' "$I00_ROOT/bin/secret-materialization.mjs")" 1
assert_contains "$SECRET_WRAPPER_SOURCE" "'--path', process.execPath"
assert_contains "$SECRET_WRAPPER_SOURCE" "actionEndpoint(action, 'node-sha256')"
assert_contains "$SECRET_WRAPPER_SOURCE" \
  "actionEndpoint(action, 'authorization-wrapper-path')"
assert_contains "$SECRET_WRAPPER_SOURCE" \
  "actionEndpoint(action, 'authorization-wrapper-sha256')"
assert_contains "$SECRET_WRAPPER_SOURCE" \
  "actionEndpoint(action, 'authorization-wrapper-identity')"
if printf '%s' "$SECRET_WRAPPER_SOURCE" \
    | grep -F "actionEndpoint(action, 'effect-script-" >/dev/null; then
  fail_test 'outer secret wrapper reused the inner provider effect-script binding'
fi
pass_assertion
assert_success node - "$I00_ROOT/bin/secret-materialization.mjs" <<'NODE'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const stagingReject = source.indexOf("assert(rootMode !== 'STAGING'");
const interpreterBinding = source.indexOf('const nodeInspection = readJsonOutput(');
const wrapperBinding = source.indexOf('const wrapperInspection = readJsonOutput(');
const validator = source.indexOf('runNode(VALIDATOR');
const runner = source.indexOf('runNode(RUNNER');
const recorder = source.indexOf('runNode(OUTCOME_RECORDER');
if (stagingReject < 0 || interpreterBinding < 0 || wrapperBinding < 0
    || validator < 0 || runner < 0 || recorder < 0
    || !(stagingReject < interpreterBinding
      && interpreterBinding < wrapperBinding
      && wrapperBinding < validator
      && validator < runner && runner < recorder)) {
  process.exit(2);
}
NODE
if printf '%s' "$SECRET_WRAPPER_SOURCE" | grep -F -- --preflight >/dev/null; then
  fail_test 'secret materialization wrapper runs an outcome preflight before consumption'
fi
pass_assertion
assert_contains "$SECRET_WRAPPER_SOURCE" "rootMode !== 'STAGING'"
assert_contains "$SECRET_WRAPPER_SOURCE" 'riskDocument.authorizationWindow.startsAtUtc'
assert_contains "$SECRET_WRAPPER_SOURCE" "'--simulation-clock', '--now', testTime"
assert_contains "$SECRET_WRAPPER_SOURCE" "'--authorization-consumption', consumption.absolute"
assert_contains "$SECRET_WRAPPER_SOURCE" "'--', PROVIDER"
assert_contains "$SECRET_WRAPPER_SOURCE" "'--effect-start-evidence', effectStartEvidence"
assert_contains "$SECRET_WRAPPER_SOURCE" "'--effect-finish-evidence', effectTerminalEvidence"
assert_contains "$SECRET_WRAPPER_SOURCE" "'AUTHORIZED_ACTION_OUTCOME_RECORDED'"
assert_contains "$SECRET_WRAPPER_SOURCE" "'AUTHORIZED_ACTION_FAILURE_RECORDED'"

note "F-016: entrypoint proceeds keyless; malformed present values still fail closed"
KEYLESS_ROOT="$SIMULATION_ROOT/keyless"
mkdir -p "$KEYLESS_ROOT/server/dist" "$KEYLESS_ROOT/creds"
printf 'console.log("stub-app-booted");\n' > "$KEYLESS_ROOT/server/dist/index.js"
printf '{}' > "$KEYLESS_ROOT/creds/app-secrets"
chmod 700 "$KEYLESS_ROOT" "$KEYLESS_ROOT/server" "$KEYLESS_ROOT/server/dist" \
  "$KEYLESS_ROOT/creds"
chmod 600 "$KEYLESS_ROOT/server/dist/index.js" "$KEYLESS_ROOT/creds/app-secrets"
run_entrypoint() {
  local credential_directory="$1"
  (
    cd "$KEYLESS_ROOT"
    CREDENTIALS_DIRECTORY="$credential_directory" \
      node "$I00_ROOT/bin/app-entrypoint.mjs"
  )
}

note "entrypoint accepts exact same-owner credential directory modes 0700 and 0500"
KEYLESS_OUT="$(run_entrypoint "$KEYLESS_ROOT/creds" 2>&1)"
assert_contains "$KEYLESS_OUT" 'stub-app-booted'
assert_contains "$KEYLESS_OUT" 'keyless posture'
chmod 400 "$KEYLESS_ROOT/creds/app-secrets"
chmod 500 "$KEYLESS_ROOT/creds"
KEYLESS_0500_OUT="$(run_entrypoint "$KEYLESS_ROOT/creds" 2>&1)"
assert_contains "$KEYLESS_0500_OUT" 'stub-app-booted'
assert_contains "$KEYLESS_0500_OUT" 'keyless posture'
chmod 700 "$KEYLESS_ROOT/creds"
chmod 600 "$KEYLESS_ROOT/creds/app-secrets"
printf '{"BINANCE_API_KEY":"x","BINANCE_API_SECRET":"y"}' > "$KEYLESS_ROOT/creds/app-secrets"
chmod 600 "$KEYLESS_ROOT/creds/app-secrets"
assert_failure_contains 'required credential field' \
  run_entrypoint "$KEYLESS_ROOT/creds"
printf '{}' > "$KEYLESS_ROOT/creds/app-secrets"
chmod 600 "$KEYLESS_ROOT/creds/app-secrets"

note "entrypoint rejects non-approved writable, group/world-accessible, and non-physical credential directories"
for unsafe_mode in 0400 0501 0510 0550 0600 0705 0770 0707; do
  chmod "$unsafe_mode" "$KEYLESS_ROOT/creds"
  assert_failure_contains 'mode-0500-or-0700 directory' \
    run_entrypoint "$KEYLESS_ROOT/creds"
done
chmod 700 "$KEYLESS_ROOT/creds"
assert_failure_contains 'absolute lexical canonical path' \
  run_entrypoint "$KEYLESS_ROOT/./creds"
ln -s "$KEYLESS_ROOT/creds" "$KEYLESS_ROOT/creds-alias"
assert_failure_contains 'mode-0500-or-0700 directory' \
  run_entrypoint "$KEYLESS_ROOT/creds-alias"
mv "$KEYLESS_ROOT/creds/app-secrets" "$KEYLESS_ROOT/creds/app-secrets.saved"
ln -s "$KEYLESS_ROOT/creds/app-secrets.saved" "$KEYLESS_ROOT/creds/app-secrets"
assert_failure_contains 'single-link regular file' \
  run_entrypoint "$KEYLESS_ROOT/creds"
rm "$KEYLESS_ROOT/creds/app-secrets"
mv "$KEYLESS_ROOT/creds/app-secrets.saved" "$KEYLESS_ROOT/creds/app-secrets"
mv "$KEYLESS_ROOT/server/dist/index.js" "$KEYLESS_ROOT/server/dist/index.saved.js"
ln -s "$KEYLESS_ROOT/server/dist/index.saved.js" "$KEYLESS_ROOT/server/dist/index.js"
assert_failure_contains 'single-link regular file' \
  run_entrypoint "$KEYLESS_ROOT/creds"
rm "$KEYLESS_ROOT/server/dist/index.js"
mv "$KEYLESS_ROOT/server/dist/index.saved.js" "$KEYLESS_ROOT/server/dist/index.js"
OUTSIDE_RELEASE="$TEST_TMP/entrypoint-outside-release"
mkdir -p "$OUTSIDE_RELEASE/server/dist"
cp "$KEYLESS_ROOT/server/dist/index.js" "$OUTSIDE_RELEASE/server/dist/index.js"
assert_failure_contains 'current link' bash -c \
  "cd '$OUTSIDE_RELEASE' && node '$I00_ROOT/bin/app-entrypoint.mjs'"

note "M-A3: hostile STS, secret fetch, and secret shape fail closed without disclosure"
# One driver for every hostile provider run so each case proves the same four things:
# the run refused, it refused with its own fixed wording, it published no credential, and
# it emitted exactly one refusal line. What the CLI said is then checked separately.
HOSTILE_PROVIDER_OUTPUT=
hostile_provider_failure() {
  local variant="$1" aws_cli="$2" expected="$3" expected_stage="$4" expected_cause="$5"
  local canonical="$PROVIDER_CONFIG_ROOT/secrets-provider.json"
  local saved="$PROVIDER_CONFIG_ROOT/secrets-provider.hostile-saved.json"
  local stdout_file="$TEST_TMP/ma3-provider.stdout"
  local stderr_file="$TEST_TMP/ma3-provider.stderr"
  local rc
  mv "$canonical" "$saved"
  cp "$variant" "$canonical"
  chmod 600 "$canonical"
  set +e
  env AWS_CLI="$aws_cli" node "$I00_ROOT/bin/secrets-provider.mjs" \
    --config "$canonical" \
    --output "$SIMULATION_ROOT/credentials/app-secrets.json" \
    --simulation --simulation-root "$SIMULATION_ROOT" \
    >"$stdout_file" 2>"$stderr_file"
  rc=$?
  set -e
  rm "$canonical"
  mv "$saved" "$canonical"
  HOSTILE_PROVIDER_OUTPUT="$(cat "$stderr_file")"
  [ "$rc" -ne 0 ] || fail_test 'hostile provider variant unexpectedly succeeded'
  pass_assertion
  [ ! -s "$stdout_file" ] || fail_test 'failed provider wrote to stdout'
  pass_assertion
  assert_contains "$HOSTILE_PROVIDER_OUTPUT" "$expected"
  assert_not_file "$SIMULATION_ROOT/credentials/app-secrets.json"
  assert_eq "$(
    grep -c '^PRECREDENTIAL_PROVIDER_TERMINAL ' "$stderr_file" || true
  )" 1
  assert_success node --input-type=module - \
    "$stderr_file" "$expected_stage" "$expected_cause" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bytes = readFileSync(process.argv[2]);
assert.equal(bytes.at(-1), 0x0a);
const prefix = 'PRECREDENTIAL_PROVIDER_TERMINAL ';
const terminals = bytes.toString('utf8').split('\n')
  .filter((line) => line.startsWith(prefix));
assert.equal(terminals.length, 1);
const terminal = JSON.parse(terminals[0].slice(prefix.length));
assert.deepEqual(Object.keys(terminal), [
  'status', 'stage', 'cause', 'credentialPublished', 'safeRetry',
]);
assert.equal(terminal.status, 'PRECREDENTIAL_PROVIDER_FAILURE');
assert.equal(terminal.stage, process.argv[3]);
assert.equal(terminal.cause, process.argv[4]);
assert.equal(terminal.credentialPublished, false);
assert.equal(terminal.safeRetry, 'REFUSED_REQUIRES_FRESH_AUTHORIZATION');
NODE
}
assert_undisclosed() {
  if printf '%s' "$HOSTILE_PROVIDER_OUTPUT" | grep -F -- "$1" >/dev/null; then
    fail_test "provider surfaced CLI-supplied text [$1]"
  fi
  pass_assertion
}
hostile_provider_config() {
  node --input-type=module - \
    "$PROVIDER_CONFIG_ROOT/secrets-provider.json" "$1" "$2" "${3:-}" "${4:-}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const [source, output, variant, first, second] = process.argv.slice(2);
const value = JSON.parse(readFileSync(source, 'utf8'));
if (variant === 'sts-role') {
  value.awsCliPath = first;
  value.awsCliSha256 = second;
} else if (variant === 'sts-account') {
  value.secretArn =
    'arn:aws:secretsmanager:ap-south-1:210987654321:secret:cosmos/read-only-Ab12Cd';
  value.instanceRoleArn = 'arn:aws:iam::210987654321:role/cosmos-instance-role';
} else if (variant === 'read-failure') {
  value.secretArn =
    'arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/unmatched-Zz99Yy';
} else if (variant === 'secret-shape') {
  value.requiredKeys = ['BINANCE_API_KEY', 'BINANCE_API_SECRET', 'EXTRA_REQUIRED_KEY'];
} else {
  process.exit(2);
}
writeFileSync(output, JSON.stringify(value));
NODE
}

# Hostile STS identity: the fixture answers with a role the configuration never approved.
hostile_provider_config "$PROVIDER_CONFIG_ROOT/provider-ma3-sts-role.json" \
  'sts-role' "$WRONG_ROLE_AWS" "$WRONG_ROLE_SHA256"
hostile_provider_failure "$PROVIDER_CONFIG_ROOT/provider-ma3-sts-role.json" \
  "$WRONG_ROLE_AWS" \
  'AWS STS caller identity does not match the exact configured instance role' \
  'CALLER_IDENTITY' 'IDENTITY_MISMATCH'
assert_undisclosed 'other-instance-role'
assert_undisclosed 'ROLEID'
assert_undisclosed 'assumed-role'

# Hostile STS shape: a well-formed answer that binds an account the secret never named.
hostile_provider_config "$PROVIDER_CONFIG_ROOT/provider-ma3-sts-account.json" \
  'sts-account'
hostile_provider_failure "$PROVIDER_CONFIG_ROOT/provider-ma3-sts-account.json" \
  "$SIMULATION_AWS" \
  'AWS STS caller account does not match the exact secret account' \
  'CALLER_IDENTITY' 'IDENTITY_MISMATCH'
assert_undisclosed '123456789012'
assert_undisclosed 'session-001'

# Hostile secret fetch: STS succeeds, the versioned read fails, and the CLI status is all
# the provider is allowed to learn from it.
hostile_provider_config "$PROVIDER_CONFIG_ROOT/provider-ma3-read-failure.json" \
  'read-failure'
hostile_provider_failure "$PROVIDER_CONFIG_ROOT/provider-ma3-read-failure.json" \
  "$SIMULATION_AWS" 'Secrets Manager provider failed without disclosing output' \
  'SECRET_FETCH' 'COMMAND_FAILED'
assert_undisclosed 'unmatched-Zz99Yy'

# Hostile secret shape: the read succeeds, so both real secret values are in the provider's
# memory when it refuses. Neither may appear in anything it prints.
hostile_provider_config "$PROVIDER_CONFIG_ROOT/provider-ma3-secret-shape.json" \
  'secret-shape'
hostile_provider_failure "$PROVIDER_CONFIG_ROOT/provider-ma3-secret-shape.json" \
  "$SIMULATION_AWS" 'required secret field EXTRA_REQUIRED_KEY is missing or malformed' \
  'SECRET_VALIDATION' 'RESPONSE_REJECTED'
assert_undisclosed 'FAKE_SECRET_123456'
assert_undisclosed 'FAKE_API_KEY_123456'

note "M-A3: the provider surfaces one terminal and never a spawned CLI error stream"
assert_eq "$(grep -c 'process\.stdout\.write' "$I00_ROOT/bin/secrets-provider.mjs")" 1
for stream in caller.stderr fetched.stderr checked.stderr; do
  if printf '%s' "$SECRETS_SOURCE" | grep -F -- "$stream" >/dev/null; then
    fail_test "provider referenced a spawned CLI error stream: $stream"
  fi
  pass_assertion
done
assert_success node --input-type=module - "$I00_ROOT/bin/secrets-provider.mjs" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const hook = source.indexOf("process.once('exit'");
const arguments_ = source.indexOf('const args = parseArgs');
const publication = source.indexOf('outputDescriptor = openSync(');
const publicationStarted = source.indexOf('credentialPublicationStarted = true', publication);
assert.ok(hook >= 0 && hook < arguments_);
assert.ok(publication >= 0 && publicationStarted > publication);
NODE

note "M-A3: the wrapper accepts only the redacted provider terminal and arms it before recording"
SECRET_WRAPPER="$I00_ROOT/bin/secret-materialization.mjs"
PROVIDER_UNIT_TEMPLATE="$REPO_ROOT/ops/templates/i00/systemd/cosmos-secrets-provider.service.template"
SECRET_WRAPPER_SOURCE="$(cat "$SECRET_WRAPPER")"
assert_eq "$(grep -c 'process\.once.*exit' "$SECRET_WRAPPER")" 1
assert_eq "$(grep -c 'emitTerminal(' "$SECRET_WRAPPER")" 3
assert_contains "$SECRET_WRAPPER_SOURCE" 'parseProviderTerminal(runner.stderr)'
assert_contains "$SECRET_WRAPPER_SOURCE" 'armProviderTerminal(providerTerminalLine'
if printf '%s' "$SECRET_WRAPPER_SOURCE" | grep -E \
    'writeSync\(1, runner|process\.stdout\.write\(runner' >/dev/null; then
  fail_test 'secret materialization relays raw runner output'
fi
pass_assertion
# The success terminal survives byte for byte.
assert_contains "$SECRET_WRAPPER_SOURCE" '{"status":"SECRET_MATERIALIZATION_COMPLETED_RECORDED"}'
assert_success node --input-type=module - "$SECRET_WRAPPER" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const runner = source.indexOf('const runner = runNode(RUNNER');
const arm = source.indexOf('armProviderTerminal(providerTerminalLine', runner);
const emission = source.indexOf('emitTerminal(pendingProviderTerminal)', arm);
const recorder = source.indexOf('const outcome = runNode(OUTCOME_RECORDER', runner);
const finalizer = source.indexOf("process.once('exit'");
assert.ok(runner >= 0 && arm > runner && emission > arm && recorder > emission);
assert.ok(finalizer >= 0 && finalizer < runner);
assert.match(
  source.slice(finalizer, runner),
  /!terminalEmitted && pendingProviderTerminal !== undefined/u,
);
NODE

note "M-A3: pre-recorder emission and exit fallback write the terminal exactly once"
assert_success node --input-type=module - "$SECRET_WRAPPER" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const begin = '// I00_PENDING_PROVIDER_TERMINAL_BEGIN';
const end = '// I00_PENDING_PROVIDER_TERMINAL_END';
const start = source.indexOf(begin);
const stop = source.indexOf(end);
assert.ok(start >= 0 && stop > start);
const region = source.slice(start + begin.length, stop);
function harness() {
  const writes = [];
  let onExit;
  const api = new Function(
    'blocked',
    'writeSync',
    'process',
    `${region}\nreturn { armProviderTerminal, emitTerminal };`,
  )(
    (message) => {
      throw new Error(message);
    },
    (descriptor, line) => writes.push([descriptor, line]),
    {
      once: (event, handler) => {
        assert.equal(event, 'exit');
        onExit = handler;
      },
    },
  );
  assert.equal(typeof onExit, 'function');
  return { ...api, writes, onExit };
}
const line =
  '{"status":"PRECREDENTIAL_PROVIDER_FAILURE","stage":"PROVIDER_EXECUTION",'
  + '"cause":"UNCLASSIFIED_FAILURE","credentialPublished":false,'
  + '"safeRetry":"REFUSED_REQUIRES_FRESH_AUTHORIZATION"}\n';
const exitFallback = harness();
exitFallback.armProviderTerminal(line);
exitFallback.onExit(1);
exitFallback.onExit(1);
assert.deepEqual(exitFallback.writes, [[1, line]]);

const preRecorder = harness();
preRecorder.armProviderTerminal(line);
preRecorder.emitTerminal(line);
preRecorder.onExit(1);
assert.deepEqual(preRecorder.writes, [[1, line]]);
NODE

note "M-A3: malformed provider diagnostics normalize to fixed fallback tokens"
assert_success node --input-type=module - "$SECRET_WRAPPER" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const begin = '// I00_PROVIDER_TERMINAL_CONTRACT_BEGIN';
const end = '// I00_PROVIDER_TERMINAL_CONTRACT_END';
const start = source.indexOf(begin);
const stop = source.indexOf(end);
assert.ok(start >= 0 && stop > start);
assert.equal(source.indexOf(begin, start + 1), -1);
assert.equal(source.indexOf(end, stop + 1), -1);
const region = source.slice(start + begin.length, stop);
const MARKER = 'HOSTILE_DIAGNOSTIC_MARKER';
const contract = new Function(
  `${region}\nreturn { parseProviderTerminal, fallbackProviderTerminal, providerTerminalLine };`,
)();
const prefix = 'PRECREDENTIAL_PROVIDER_TERMINAL ';
const valid = {
  status: 'PRECREDENTIAL_PROVIDER_FAILURE',
  stage: 'SECRET_FETCH',
  cause: 'COMMAND_FAILED',
  credentialPublished: false,
  safeRetry: 'REFUSED_REQUIRES_FRESH_AUTHORIZATION',
};
assert.deepEqual(contract.parseProviderTerminal(`${prefix}${JSON.stringify(valid)}\n`), valid);
for (const hostile of [
  '',
  MARKER,
  `${prefix}${MARKER}\n`,
  `${prefix}${JSON.stringify({ ...valid, stage: MARKER })}\n`,
  `${prefix}${JSON.stringify({ ...valid, extra: MARKER })}\n`,
  `${prefix}${JSON.stringify(valid)}\n${prefix}${JSON.stringify(valid)}\n`,
]) {
  assert.equal(contract.parseProviderTerminal(hostile), null);
}
assert.deepEqual(contract.fallbackProviderTerminal(
  { error: { code: 'ETIMEDOUT' } },
  false,
), {
  status: 'PRECREDENTIAL_PROVIDER_FAILURE',
  stage: 'PROVIDER_EXECUTION',
  cause: 'PROCESS_TIMEOUT',
  credentialPublished: false,
  safeRetry: 'REFUSED_REQUIRES_FRESH_AUTHORIZATION',
});
assert.equal(
  contract.fallbackProviderTerminal({ signal: 'SIGKILL' }, false).cause,
  'PROCESS_SIGNALLED',
);
assert.equal(
  contract.fallbackProviderTerminal({ status: 1 }, false).cause,
  'UNCLASSIFIED_FAILURE',
);
assert.equal(
  contract.fallbackProviderTerminal({ status: 1 }, 'UNKNOWN').credentialPublished,
  'UNKNOWN',
);
assert.equal(contract.providerTerminalLine(valid), `${JSON.stringify(valid)}\n`);
assert.equal(contract.providerTerminalLine(valid).includes(MARKER), false);
NODE

note "M-A4: provider-to-wrapper terminal is observable before a hanging recorder"
case "$(uname -s)" in
  Linux)
    assert_success env I00_TEST_TMP_OVERRIDE= I00_MA4_RECORDER_HANG_ONLY=1 bash "$0"
    ;;
  Darwin)
    note "Linux-only executable recorder-hang proof is not claimed on Darwin"
    ;;
  *)
    fail_test 'provider-to-wrapper recorder-hang proof supports only Linux or Darwin'
    ;;
esac

note "M-A4: the provider unit disables automatic restart and routes its terminal to the journal"
assert_success node --input-type=module - "$PROVIDER_UNIT_TEMPLATE" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = new Map();
let section = null;
for (const raw of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const line = raw.trim();
  if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
  if (line.startsWith('[') && line.endsWith(']')) {
    section = line;
    continue;
  }
  if (section !== '[Service]') continue;
  const separator = line.indexOf('=');
  assert.ok(separator > 0, line);
  const key = line.slice(0, separator);
  service.set(key, [...(service.get(key) ?? []), line.slice(separator + 1)]);
}
// Restart=no controls systemd's automatic process-exit policy only. An operator-requested
// start or restart remains possible; every invocation independently passes through the
// wrapper's single-use authorization validator.
assert.deepEqual(service.get('Type'), ['oneshot']);
assert.deepEqual(service.get('Restart'), ['no']);
// The wrapper's single terminal is what an operator reads, so where it lands is stated
// rather than inherited from whatever the host's default happens to be.
assert.deepEqual(service.get('StandardOutput'), ['journal']);
assert.deepEqual(service.get('StandardError'), ['journal']);
assert.deepEqual(service.get('SyslogIdentifier'), ['cosmos-secrets-provider']);
NODE

finish
