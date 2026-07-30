#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

CONTRACT="$I00_ROOT/deployment-authorization-contract.mjs"
FIXTURE="$TEST_DIR/fixtures/make-deployment-authorization-fixture.mjs"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
PREVIEW_PRODUCER="$I00_ROOT/bin/produce-deployment-action-preview.mjs"
AUTH_VALIDATOR="$I00_ROOT/bin/validate-authorization.mjs"
OUTCOME_RECORDER="$I00_ROOT/bin/record-authorized-action-outcome.mjs"
SANITIZER="$I00_ROOT/bin/sanitize-donor-env.mjs"

CURRENT_SHA=1111111111111111111111111111111111111111
TARGET_SHA=2222222222222222222222222222222222222222
ISSUED_AT=2026-07-24T00:09:00Z
AUTH_START=2026-07-24T00:10:00Z
STAGED_AT=2026-07-24T00:10:00Z
CONSUMED_AT=2026-07-24T00:11:00Z
COMPLETED_AT=2026-07-24T00:12:00Z
FINALIZED_AT=2026-07-24T00:13:00Z
AUTH_EXPIRES=2026-07-24T00:20:00Z

json_value() {
  node -e '
    const fs = require("node:fs");
    let value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const key of process.argv[2].split(".")) value = value[key];
    process.stdout.write(String(value));
  ' "$1" "$2"
}

preview_endpoint() {
  node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const marker = `${process.argv[2]}:`;
    const matches = value.action.allowedEndpoints
      .filter((entry) => entry.startsWith(marker));
    if (matches.length !== 1 || matches[0].length === marker.length) process.exit(2);
    process.stdout.write(matches[0].slice(marker.length));
  ' "$1" "$2"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

canonical_path() {
  node -e '
    const fs = require("node:fs");
    process.stdout.write(fs.realpathSync(process.argv[1]));
  ' "$1"
}

sha256_file() {
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    process.stdout.write(
      crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"),
    );
  ' "$1"
}

install_fixture_release() {
  local source_root="$1" sha="$2" source_release destination
  umask 022
  source_release="$(assemble_fixture_release "$source_root" "$sha")" \
    || fail_test "fixture release assembly failed"
  [ -d "$source_release" ] || fail_test "fixture release assembly produced no release"
  destination="$RELEASES_DIR/i00-$sha"
  cp -R "$source_release" "$destination"
  chmod -R a-w "$destination"
  printf '%s' "$destination"
}

install_alternate_same_id_release() {
  local source_root="$1" sha="$2" destination
  umask 022
  make_release_inputs \
    "$source_root/source" \
    "$source_root/deps" \
    "$sha" \
    "$source_root/tested.json"
  printf 'console.log("alternate fixture tree");\n' \
    >"$source_root/source/server/dist/index.js"
  node "$I00_ROOT/bin/assemble-release.mjs" \
    --source-root "$source_root/source" \
    --runtime-deps "$source_root/deps" \
    --output-root "$source_root/releases" \
    --tested-sha "$sha" \
    --tested-receipt "$source_root/tested.json" \
    --built-at-utc "$ISSUED_AT" \
    --config-revision config-fixture \
    --model-revision UNAVAILABLE \
    --simulation-source >/dev/null \
    || fail_test "alternate fixture release assembly failed"
  destination="$source_root/releases/i00-$sha"
  [ -d "$destination" ] || fail_test "alternate fixture release is absent"
  chmod -R a-w "$destination"
  printf '%s' "$destination"
}

set_release_links() {
  local current_target="$1" previous_target="$2"
  node - "$CURRENT_LINK" "$PREVIOUS_LINK" "$current_target" "$previous_target" <<'NODE'
const fs = require('node:fs');
const [current, previous, currentTarget, previousTarget] = process.argv.slice(2);
const nextCurrent = `${current}.next`;
const nextPrevious = `${previous}.next`;
for (const path of [nextCurrent, nextPrevious]) {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
fs.symlinkSync(previousTarget, nextPrevious);
fs.renameSync(nextPrevious, previous);
fs.symlinkSync(currentTarget, nextCurrent);
fs.renameSync(nextCurrent, current);
NODE
}

risk_args() {
  local request="$1" release="$2" evidence_root="$3" output="$4" nonce="$5"
  RISK_ARGS=(
    --request "$request"
    --class SERVICE_ROLLBACK
    --output "$output"
    --simulation-clock
    --now "$ISSUED_AT"
    --simulation-publication-now "$ISSUED_AT"
    --nonce "$nonce"
    --simulation-command-root "$COMMAND_ROOT"
    --simulation-donor-root "$DONOR_ROOT"
    --root-mode TEST
    --proof-root "$ROOT"
    --release "$release"
    --trusted-build-public-key "$TRUST_KEY"
    --host-readback "$HOST_READBACK"
    --host-evidence "$HOST_EVIDENCE"
    --runtime-env "$RUNTIME_ENV"
    --deploy-env "$DEPLOY_ENV"
    --rollback-evidence-root "$ROOT/rollback-evidence"
  )
}

produce_scenario() {
  local root="$1" nonce="$2" scenario request canonical_risk canonical_preview
  local risk preview authorization
  mkdir -m 700 "$root"
  scenario="$(basename "$root")"
  request="$ROOT/authorization/$scenario.request.json"
  canonical_risk="$ROOT/authorization/SERVICE_ROLLBACK.risk.json"
  canonical_preview="$ROOT/authorization/SERVICE_ROLLBACK.preview.json"
  risk="$ROOT/authorization/$scenario.risk.json"
  preview="$ROOT/authorization/$scenario.preview.json"
  authorization="$ROOT/authorization/$scenario.authorization.json"
  node "$FIXTURE" request "$CONTRACT" "$ROOT" SERVICE_ROLLBACK "$request"
  node --input-type=module - \
    "$CONTRACT" "$request" "$scenario" "$ROOT/receipts" \
    "$AUTH_START" "$AUTH_EXPIRES" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [
  contractPath, requestPath, scenario, receipts, startsAtUtc, expiresAtUtc,
] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)));
const value = JSON.parse(readFileSync(requestPath, 'utf8'));
value.authorizationId = `isolated-staging-service-rollback-${scenario}`
  .replaceAll(/[^a-z0-9-]/gu, '-');
value.startsAtUtc = startsAtUtc;
value.expiresAtUtc = expiresAtUtc;
value.receiptTargets = {
  result: resolve(receipts, `${scenario}.result.json`),
  reconciliation: resolve(receipts, `${scenario}.reconciliation.json`),
};
writeFileSync(requestPath, canonicalJsonBytes(value), { mode: 0o600 });
NODE
  risk_args \
    "$request" \
    "$TARGET_RELEASE" \
    "$ROOT/rollback-evidence" \
    "$canonical_risk" \
    "$nonce"
  node "$RISK_PRODUCER" "${RISK_ARGS[@]}" \
    >"$root/SERVICE_ROLLBACK.risk.out"
  node "$PREVIEW_PRODUCER" \
    --deployment-risk "$canonical_risk" \
    --consumption-root "$ROOT/consumption" \
    --output "$canonical_preview" \
    >"$root/SERVICE_ROLLBACK.preview.out"
  node "$FIXTURE" authorization "$CONTRACT" "$ROOT" SERVICE_ROLLBACK "$authorization"
  mv "$canonical_risk" "$risk"
  mv "$canonical_preview" "$preview"
}

set_scenario_args() {
  local root="$1" scenario claim_key
  scenario="$(basename "$root")"
  claim_key="$(json_value "$ROOT/authorization/$scenario.preview.json" singleUse.claimKey)"
  SCENARIO_ROOT="$root"
  SCENARIO_RISK="$ROOT/authorization/$scenario.risk.json"
  SCENARIO_PREVIEW="$ROOT/authorization/$scenario.preview.json"
  SCENARIO_AUTH="$ROOT/authorization/$scenario.authorization.json"
  SCENARIO_CLAIMS="$ROOT/consumption"
  SCENARIO_EVIDENCE_ROOT="$ROOT/rollback-evidence"
  SCENARIO_CLAIM_DIR="$SCENARIO_EVIDENCE_ROOT/$claim_key"
  SCENARIO_RESULT="$ROOT/receipts/$scenario.result.json"
  SCENARIO_RECONCILIATION="$ROOT/receipts/$scenario.reconciliation.json"
  ROLLBACK_BASE=(
    --class SERVICE_ROLLBACK
    --deployment-risk "$SCENARIO_RISK"
    --action-preview "$SCENARIO_PREVIEW"
    --result-receipt "$SCENARIO_RESULT"
    --reconciliation-receipt "$SCENARIO_RECONCILIATION"
    --primary-path "$TARGET_RELEASE"
    --env-file "$SANITIZED_ENV"
    --evidence-root "$SCENARIO_EVIDENCE_ROOT"
  )
}

set_validator_args() {
  local endpoint permission
  VALIDATOR_ARGS=(
    --input "$SCENARIO_AUTH"
    --class SERVICE_ROLLBACK
    --command "$(json_value "$SCENARIO_PREVIEW" action.command)"
    --expected-operator "$(json_value "$SCENARIO_PREVIEW" binding.operator)"
    --expected-deployed-sha "$(json_value "$SCENARIO_PREVIEW" binding.deployedSha)"
    --expected-config-version "$(json_value "$SCENARIO_PREVIEW" binding.configVersion)"
    --deployment-risk "$SCENARIO_RISK"
    --action-preview "$SCENARIO_PREVIEW"
    --consumption-root "$SCENARIO_CLAIMS"
    --expected-host "$(json_value "$SCENARIO_PREVIEW" binding.host)"
    --expected-environment "$(json_value "$SCENARIO_PREVIEW" binding.environment)"
    --expected-scope "$(json_value "$SCENARIO_PREVIEW" action.scope)"
    --expected-account "$(json_value "$SCENARIO_PREVIEW" binding.account)"
    --expected-product "$(json_value "$SCENARIO_PREVIEW" action.allowedProducts.0)"
    --expected-credential-type \
      "$(json_value "$SCENARIO_PREVIEW" action.allowedCredentials.types.0)"
    --expected-result-receipt "$SCENARIO_RESULT"
    --expected-reconciliation-receipt "$SCENARIO_RECONCILIATION"
    --expected-maximum-capital \
      "$(json_value "$SCENARIO_PREVIEW" action.maximumEffect.capital)"
    --expected-maximum-notional \
      "$(json_value "$SCENARIO_PREVIEW" action.maximumEffect.notional)"
    --expected-maximum-effect \
      "$(json_value "$SCENARIO_PREVIEW" action.maximumEffect.operational)"
    --simulation-clock
    --now "$CONSUMED_AT"
  )
  while IFS= read -r endpoint; do
    VALIDATOR_ARGS+=(--expected-endpoint "$endpoint")
  done < <(node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const endpoint of value.action.allowedEndpoints) console.log(endpoint);
  ' "$SCENARIO_PREVIEW")
  while IFS= read -r permission; do
    VALIDATOR_ARGS+=(--expected-permission "$permission")
  done < <(node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const permission of value.action.allowedCredentials.permissions) {
      console.log(permission);
    }
  ' "$SCENARIO_PREVIEW")
}

consume_scenario_authorization() {
  set_validator_args
  "$COMMAND_ROOT/node" "$AUTH_VALIDATOR" "${VALIDATOR_ARGS[@]}" \
    >"$SCENARIO_ROOT/SERVICE_ROLLBACK.validation.json"
  SCENARIO_CONSUMPTION="$(
    json_value \
      "$SCENARIO_ROOT/SERVICE_ROLLBACK.validation.json" \
      authorizationConsumptionPath
  )"
}

authorized_args() {
  AUTHORIZED_ARGS=(
    "${ROLLBACK_BASE[@]}"
    --authorization "$SCENARIO_AUTH"
    --authorization-consumption "$SCENARIO_CONSUMPTION"
  )
}

write_runner_evidence() {
  local status="$1" exit_code="$2"
  SCENARIO_EFFECT_START="$(preview_endpoint "$SCENARIO_PREVIEW" effect-start-evidence)"
  SCENARIO_EFFECT_FINISH="$(preview_endpoint "$SCENARIO_PREVIEW" effect-finish-evidence)"
  node --input-type=module - \
    "$CONTRACT" "$I00_ROOT/authorized-effect-evidence.mjs" \
    "$I00_ROOT/bin/verify-authorized-effect-handoff.mjs" \
    "$SCENARIO_AUTH" "$SCENARIO_RISK" "$SCENARIO_PREVIEW" \
    "$SCENARIO_CONSUMPTION" "$SANITIZED_ENV" "$ROOT/tmp" \
    "$status" "$exit_code" "$CONSUMED_AT" "$COMPLETED_AT" <<'NODE'
import { createHash } from 'node:crypto';
import {
  lstatSync, readFileSync, writeFileSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
const [
  contractPath, effectModulePath, verifierPath, authorizationPath, riskPath,
  previewPath, consumptionPath, environmentPath, effectTemporaryRoot,
  status, exitCodeRaw, startedAtUtc, finishedAtUtc,
] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath));
const {
  authorizedEffectEvidenceBytes,
  authorizedEffectEvidenceSha256,
} = await import(pathToFileURL(effectModulePath));
const authorization = JSON.parse(readFileSync(authorizationPath, 'utf8'));
const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
const preview = JSON.parse(readFileSync(previewPath, 'utf8'));
const consumptionBytes = readFileSync(consumptionPath);
const consumption = JSON.parse(consumptionBytes);
const endpoints = Object.fromEntries(preview.action.allowedEndpoints.map((entry) => {
  const split = entry.indexOf(':');
  return [entry.slice(0, split), entry.slice(split + 1)];
}));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const endpointIdentity = (stat) => [
  ['device', stat.dev],
  ['inode', stat.ino],
  ['mode', stat.mode.toString(8)],
  ['size', stat.size],
  ['mtimeNs', stat.mtimeNs],
  ['ctimeNs', stat.ctimeNs],
].map(([key, value]) => `${key}=${value}`).join(',');
const fileBinding = (path) => {
  const stat = lstatSync(path, { bigint: true });
  return {
    path,
    sha256: digest(readFileSync(path)),
    identity: endpointIdentity(stat),
  };
};
const bound = (prefix) => ({
  path: endpoints[`${prefix}-path`],
  sha256: endpoints[`${prefix}-sha256`],
  identity: endpoints[`${prefix}-identity`],
});
const executableSlots = {
  node: 16, bash: 17, env: 18, systemctl: 19, curl: 20, exposure: 33, alert: 34,
};
const effectExecutables = Object.entries(executableSlots)
  .map(([name, fd]) => ({
    name,
    fd,
    binding: bound(name === 'exposure' ? 'exposure-helper'
      : name === 'alert' ? 'alert-helper' : name),
  }))
  .sort((left, right) => left.fd - right.fd);
const writeRoots = [
  ['cosmosRoot', 41, 'cosmos-root-path', 'cosmos-root-identity'],
  ['releasesDir', 42, 'releases-dir-path', 'releases-dir-identity'],
  ['currentLinkParent', 43, 'current-link-parent-path', 'current-link-parent-identity'],
  ['previousLinkParent', 44, 'previous-link-parent-path', 'previous-link-parent-identity'],
  ['opsStateDir', 45, 'ops-state-dir-path', 'ops-state-dir-identity'],
  ['rollbackEvidenceRoot', 48, 'rollback-evidence-root', 'rollback-evidence-root-identity'],
  ['dataDir', 49, 'data-dir-path', 'data-dir-identity'],
].map(([name, fd, pathKey, identityKey]) => ({
  name, fd, path: endpoints[pathKey], identity: endpoints[identityKey],
}));
const startEvidencePath = endpoints['effect-start-evidence'];
const finishEvidencePath = endpoints['effect-finish-evidence'];
const effectDirectoryPath =
  `${effectTemporaryRoot}/i00-bound-effect.${consumption.claimKey.slice(0, 16)}.ABC123`;
const primaryParentPrelude = [
  '[ -r "/proc/$PPID/cmdline" ] && [ -r "/proc/$PPID/status" ] || exit 125',
  'if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" = TEST ]; then',
  '  [ "/proc/$PPID/exe" -ef "$I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH" ] || exit 125',
  'else',
  '  [ "/proc/$PPID/exe" -ef /usr/bin/node ] || exit 125',
  'fi',
  '_i00_parent_uid= _i00_parent_euid=',
  'while IFS=" \t" read -r _i00_key _i00_real _i00_effective _i00_rest; do',
  '  if [ "$_i00_key" = "Uid:" ]; then _i00_parent_uid=$_i00_real; _i00_parent_euid=$_i00_effective; break; fi',
  'done < "/proc/$PPID/status"',
  '[ -n "$_i00_parent_uid" ] && [ -n "$_i00_parent_euid" ] || exit 125',
  'if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" != TEST ]; then [ "$_i00_parent_euid" = 0 ] || exit 125; fi',
  '_i00_parent_argv=()',
  'while IFS= read -r -d "" _i00_arg; do _i00_parent_argv[${#_i00_parent_argv[@]}]=$_i00_arg; done < "/proc/$PPID/cmdline"',
  '[ "${#_i00_parent_argv[@]}" -ge 12 ] || exit 125',
  '[ "${_i00_parent_argv[1]}" = "$I00_AUTHORIZED_EFFECT_RUNNER_PATH" ] || exit 125',
  '[ "${_i00_parent_argv[2]}" = --authorization ] || exit 125',
  '[ "${_i00_parent_argv[4]}" = --deployment-risk ] || exit 125',
  '[ "${_i00_parent_argv[6]}" = --action-preview ] || exit 125',
  '[ "${_i00_parent_argv[8]}" = --authorization-consumption ] || exit 125',
  '[ "${_i00_parent_argv[10]}" = -- ] || exit 125',
  '_I00_RUNNER_PARENT_VERIFIED=1',
  'readonly _I00_RUNNER_PARENT_VERIFIED',
  'unset _i00_parent_uid _i00_parent_euid _i00_key _i00_real _i00_effective _i00_rest _i00_arg _i00_parent_argv',
].join('\n');
const delegatedArgv = [
  '-p',
  '-c',
  `${primaryParentPrelude}\nsource /proc/self/fd/13; source /proc/self/fd/11`,
  endpoints['effect-script-path'],
  '--i00-effect-environment-fd',
  '12',
  '--to',
  endpoints['release-id'],
];
const start = {
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_START',
  status: 'AUTHORIZED_EFFECT_STARTED',
  actionClass: 'SERVICE_ROLLBACK',
  authorizationId: authorization.authorizationId,
  claimKey: consumption.claimKey,
  consumptionSha256: digest(consumptionBytes),
  riskVersion: risk.riskVersion,
  serverPreviewDigest: preview.serverPreviewDigest,
  effectUid: endpoints['effect-uid'],
  effectGid: endpoints['effect-gid'],
  program: bound('effect-program'),
  verifier: fileBinding(verifierPath),
  delegatedScript: bound('effect-script'),
  delegatedBootstrap: {
    kind: 'COMMON_SHELL',
    binding: bound('effect-common'),
  },
  delegatedEnvironment: {
    kind: 'SANITIZED_ENV',
    binding: fileBinding(environmentPath),
  },
  effectExecutables,
  delegatedArgv,
  effectDirectory: {
    kind: 'CLAIM_TEMPORARY_DIRECTORY',
    path: effectDirectoryPath,
    identity:
      `device=1,inode=1,mode=40700,uid=${endpoints['effect-uid']},gid=${endpoints['effect-gid']}`,
  },
  helperPolicy: {
    exposure: {
      program: 'node', script: 'exposure', argvShape: 'NO_ARGS', timeoutMs: 3000,
    },
    alert: {
      program: 'bash', script: 'alert', argvShape: 'SEVERITY_CODE_MESSAGE',
      timeoutMs: 5000,
    },
  },
  automaticRollback: {},
  writeRoots,
  readRoots: [{
    name: 'releaseSource',
    fd: 51,
    path: endpoints['release-path'],
    identity: endpoints['release-identity'],
    treeSha256: endpoints['release-tree-sha256'],
  }],
  observedRoots: [],
  effectOutputPolicy: {},
  authorizationExpiresAtUtc: authorization.expiresAtUtc,
  evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
  receiptPublicationReserveSeconds:
    Number(endpoints['receipt-publication-reserve-seconds']),
  startEvidencePath,
  finishEvidencePath,
  effectStartedAtUtc: startedAtUtc,
};
const completed = status === 'AUTHORIZED_EFFECT_COMPLETED';
const exitCode = exitCodeRaw === 'null' ? null : Number(exitCodeRaw);
const terminal = {
  ...start,
  kind: 'AUTHORIZED_EFFECT_TERMINAL',
  status,
  effectFinishedAtUtc: finishedAtUtc,
  startEvidenceSha256: authorizedEffectEvidenceSha256(start),
  exitCode,
  signal: null,
  forced: false,
  timedOut: false,
  automaticRollbackAcknowledged: false,
  automaticRollbackHandoffSha256: null,
  programBindingRetained: true,
  effectMayHaveMutated: !completed,
  successRecorderEligible: completed,
  effectOutput: { status: 'NOT_APPLICABLE' },
};
writeFileSync(startEvidencePath, authorizedEffectEvidenceBytes(start), {
  mode: 0o600,
  flag: 'wx',
});
writeFileSync(finishEvidencePath, authorizedEffectEvidenceBytes(terminal), {
  mode: 0o600,
  flag: 'wx',
});
if (!canonicalJsonBytes(start).equals(authorizedEffectEvidenceBytes(start))) process.exit(2);
NODE
  RUNNER_EVIDENCE_ARGS=(
    --effect-start-evidence "$SCENARIO_EFFECT_START"
    --effect-finish-evidence "$SCENARIO_EFFECT_FINISH"
  )
}

rewrite_runner_terminal() {
  local mode="$1"
  node --input-type=module - "$CONTRACT" "$SCENARIO_EFFECT_FINISH" "$mode" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, terminalPath, mode] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath));
const value = JSON.parse(readFileSync(terminalPath, 'utf8'));
if (mode === 'COMPLETED') {
  value.status = 'AUTHORIZED_EFFECT_COMPLETED';
  value.exitCode = 0;
  value.signal = null;
  value.forced = false;
  value.timedOut = false;
  value.programBindingRetained = true;
  value.effectMayHaveMutated = false;
  value.successRecorderEligible = true;
} else if (mode === 'MISMATCHED_CHAIN') {
  value.riskVersion =
    'i00-deployment-risk-v1:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
} else if (mode === 'SIGNAL') {
  value.status = 'AUTHORIZED_EFFECT_TERMINATED';
  value.exitCode = null;
  value.signal = 'SIGTERM';
  value.forced = false;
  value.timedOut = false;
  value.effectMayHaveMutated = true;
  value.successRecorderEligible = false;
} else if (mode === 'TIMEOUT') {
  value.status = 'AUTHORIZED_EFFECT_TERMINATED';
  value.exitCode = null;
  value.signal = 'SIGKILL';
  value.forced = true;
  value.timedOut = true;
  value.effectMayHaveMutated = true;
  value.successRecorderEligible = false;
} else if (mode === 'SIGNAL_WITH_EXIT') {
  value.status = 'AUTHORIZED_EFFECT_TERMINATED';
  value.signal = 'SIGTERM';
  value.forced = false;
  value.timedOut = false;
  value.effectMayHaveMutated = true;
  value.successRecorderEligible = false;
} else if (mode === 'TIMEOUT_WITH_EXIT') {
  value.status = 'AUTHORIZED_EFFECT_TERMINATED';
  value.signal = 'SIGKILL';
  value.forced = true;
  value.timedOut = true;
  value.effectMayHaveMutated = true;
  value.successRecorderEligible = false;
} else {
  process.exit(2);
}
writeFileSync(terminalPath, canonicalJsonBytes(value), { mode: 0o600 });
NODE
}

rewrite_runner_capability() {
  local mode="$1"
  node --input-type=module - \
    "$I00_ROOT/authorized-effect-evidence.mjs" \
    "$SCENARIO_EFFECT_START" "$SCENARIO_EFFECT_FINISH" "$mode" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [effectModulePath, startPath, terminalPath, mode] = process.argv.slice(2);
const {
  authorizedEffectEvidenceBytes,
  authorizedEffectEvidenceSha256,
} = await import(pathToFileURL(effectModulePath));
const start = JSON.parse(readFileSync(startPath, 'utf8'));
const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
let field;
if (mode === 'VERIFIER') {
  field = 'verifier';
  start.verifier.sha256 = 'f'.repeat(64);
} else if (mode === 'SCRIPT') {
  field = 'delegatedScript';
  start.delegatedScript.sha256 = 'f'.repeat(64);
} else if (mode === 'BOOTSTRAP') {
  field = 'delegatedBootstrap';
  start.delegatedBootstrap.binding.sha256 = 'f'.repeat(64);
} else if (mode === 'ENVIRONMENT') {
  field = 'delegatedEnvironment';
  start.delegatedEnvironment.binding.sha256 = 'f'.repeat(64);
} else if (mode === 'EXECUTABLE') {
  field = 'effectExecutables';
  start.effectExecutables[0].binding.sha256 = 'f'.repeat(64);
} else if (mode === 'ARGV') {
  field = 'delegatedArgv';
  start.delegatedArgv[start.delegatedArgv.length - 1] += '-hostile';
} else if (mode === 'DIRECTORY') {
  field = 'effectDirectory';
  start.effectDirectory.path =
    `/tmp/i00-bound-effect.${start.claimKey.slice(0, 16)}.hostile`;
} else if (mode === 'AUTOMATIC_ROLLBACK') {
  field = 'automaticRollback';
  start.automaticRollback = {
    status: 'ARMED',
    handoffNonce: 'f'.repeat(64),
    script: structuredClone(start.delegatedScript),
    delegatedArgv: ['--auto'],
    recovery: 'hostile synthetic recovery',
    scriptFd: 35,
    handoffFd: 36,
    acknowledgementFd: 37,
  };
} else if (mode === 'WRITE_ROOT') {
  field = 'writeRoots';
  start.writeRoots[0].path = start.writeRoots[1].path;
} else if (mode === 'READ_ROOT') {
  field = 'readRoots';
  start.readRoots[0].treeSha256 = 'f'.repeat(64);
} else if (mode === 'OBSERVED_ROOT') {
  field = 'observedRoots';
  const data = start.writeRoots.find((entry) => entry.name === 'dataDir');
  start.observedRoots = [{
    name: 'dataDir',
    path: data.path,
    identity: data.identity,
  }];
} else {
  process.exit(2);
}
terminal[field] = structuredClone(start[field]);
if (mode === 'AUTOMATIC_ROLLBACK') {
  terminal.automaticRollbackHandoffSha256 = 'f'.repeat(64);
}
terminal.startEvidenceSha256 = authorizedEffectEvidenceSha256(start);
writeFileSync(startPath, authorizedEffectEvidenceBytes(start), { mode: 0o600 });
writeFileSync(terminalPath, authorizedEffectEvidenceBytes(terminal), { mode: 0o600 });
NODE
}

write_final_evidence() {
  node --input-type=module - "$CONTRACT" "$SCENARIO_CLAIM_DIR" \
    "$CURRENT_SHA" "$TARGET_SHA" <<'NODE'
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, root, currentSha, targetSha] = process.argv.slice(2);
const { canonicalJsonBytes } =
  await import(pathToFileURL(resolve(contractPath)).href);
const documents = {
  'cloudflare-boundary.json': {
    status: 'CLOUDFLARE_BOUNDARY_VERIFIED',
    hostname: 'rollback-control.internal',
    observedAtUtc: '2026-07-24T00:12:00Z',
  },
  'watchdog.json': {
    status: 'WATCHDOG_HEALTHY',
    source: 'OWNER_READBACK',
    observedAtUtc: '2026-07-24T00:12:00Z',
  },
  'database-schema.json': {
    status: 'SCHEMA_COMPATIBLE',
    toSha: targetSha,
    observedAtUtc: '2026-07-24T00:12:00Z',
  },
  'backup.json': {
    kind: 'BACKUP',
    status: 'BACKUP_VERIFIED',
    sourceSha: currentSha,
    recordedAtUtc: '2026-07-24T00:10:00Z',
  },
  'recovery.json': {
    status: 'RECOVERY_READY',
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: '2026-07-24T00:12:00Z',
  },
  'reconciliation.json': {
    status: 'RECONCILED',
    deployedSha: targetSha,
    observedAtUtc: '2026-07-24T00:12:00Z',
  },
};
for (const [name, document] of Object.entries(documents)) {
  writeFileSync(resolve(root, name), canonicalJsonBytes(document), {
    mode: 0o600,
    flag: 'wx',
  });
}
NODE
}

write_frozen_marker() {
  local marker="$OPS_STATE_DIR/deploy-frozen.json"
  node - "$marker" "$TARGET_SHA" "$COMPLETED_AT" <<'NODE'
const fs = require('node:fs');
const [marker, targetSha, completedAtUtc] = process.argv.slice(2);
fs.writeFileSync(marker, `${JSON.stringify({
  ts: completedAtUtc,
  releaseId: `i00-${targetSha}`,
  exposure: 'NONE',
  reason: 'rollback: post-rollback health gate failed',
  operatorAction: 'required',
}, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
NODE
  printf '%s' "$marker"
}

run_lifecycle_to_verified() {
  local stage_output="$SCENARIO_ROOT/stage.json"
  local verify_output="$SCENARIO_ROOT/verify.json"
  node "$OUTCOME_RECORDER" \
    --stage-rollback \
    "${ROLLBACK_BASE[@]}" \
    --simulation-clock \
    --now "$STAGED_AT" >"$stage_output"
  assert_eq "$(json_value "$stage_output" status)" ROLLBACK_STAGE_READY_NOT_AUTHORIZED
  consume_scenario_authorization
  authorized_args
  node "$OUTCOME_RECORDER" \
    --verify-rollback-stage \
    "${AUTHORIZED_ARGS[@]}" \
    --simulation-clock \
    --now "$CONSUMED_AT" >"$verify_output"
  assert_eq "$(json_value "$verify_output" status)" ROLLBACK_STAGE_VERIFIED_FOR_EFFECT
}

run_positive_lifecycle_to_pending() {
  local effect_output="$SCENARIO_ROOT/effect.json"
  run_lifecycle_to_verified
  set_release_links "$TARGET_RELEASE" "$CURRENT_RELEASE"
  write_runner_evidence AUTHORIZED_EFFECT_COMPLETED 0
  node "$OUTCOME_RECORDER" \
    --record-rollback-terminal \
    "${AUTHORIZED_ARGS[@]}" \
    --systemctl "$SYSTEMCTL" \
    --curl "$CURL" \
    "${RUNNER_EVIDENCE_ARGS[@]}" \
    --simulation-clock \
    --now "$COMPLETED_AT" >"$effect_output"
  assert_eq \
    "$(json_value "$effect_output" status)" \
    ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION
  assert_eq "$(json_value "$effect_output" terminalDisposition)" COMPLETED
  write_final_evidence
}

CANONICAL_TEST_TMP="$(canonical_path "$TEST_TMP")"
ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$CANONICAL_TEST_TMP/ip-ops-i00-sim-authorized-rollback-lifecycle")"
COSMOS_ROOT="$ROOT/cosmos"
RELEASES_DIR="$COSMOS_ROOT/releases"
CURRENT_LINK="$COSMOS_ROOT/current"
PREVIOUS_LINK="$COSMOS_ROOT/previous"
DATA_DIR="$ROOT/data"
OPS_STATE_DIR="$ROOT/ops-state"
COMMAND_ROOT="$ROOT/bin"
DONOR_PARENT="$ROOT/effective-donor"
DONOR_ROOT="$DONOR_PARENT/ops/live"
TRUST_KEY="$ROOT/fixture-trust-key.pem"
HOST_EVIDENCE="$ROOT/host-evidence.json"
HOST_READBACK="$ROOT/host-readback.json"
RUNTIME_ENV="$ROOT/runtime.env"
DEPLOY_ENV="$ROOT/deploy.env"
SANITIZED_ENV="$ROOT/sanitized/deploy.env"
SYSTEMCTL="$COMMAND_ROOT/systemctl"
CURL="$COMMAND_ROOT/curl"
ENV_BIN="$COMMAND_ROOT/env"
APP_UNIT_FRAGMENT="$ROOT/systemd/cosmos-app.service"
APP_UNIT_DROP_IN="$ROOT/systemd/cosmos-app.service.d/90-cosmos-app.conf"
APP_UNIT_RUNTIME_DROP_IN="$ROOT/runtime-systemd/cosmos-app.service.d/90-cosmos-app.conf"

mkdir -m 700 "$COSMOS_ROOT" "$DATA_DIR" "$OPS_STATE_DIR" "$COMMAND_ROOT" \
  "$ROOT/evidence" "$ROOT/models" "$ROOT/backups" "$ROOT/authorization" \
  "$ROOT/consumption" "$ROOT/receipts" "$ROOT/effects" \
  "$ROOT/rollback-evidence" "$ROOT/sanitized" "$ROOT/runtime" \
  "$ROOT/systemd" "$ROOT/runtime-systemd" "$ROOT/tmp"
mkdir -m 700 "$RELEASES_DIR" "$OPS_STATE_DIR/locks"
mkdir -m 700 "$ROOT/systemd/cosmos-app.service.d" \
  "$ROOT/runtime-systemd/cosmos-app.service.d"
materialize_effective_l15 "$DONOR_PARENT"

cp "$(node -p 'process.execPath')" "$COMMAND_ROOT/node"
printf '%s\n' '#!/bin/bash' 'exit 0' >"$COMMAND_ROOT/bash"
printf '%s\n' '#!/bin/bash' "printf '200'" >"$CURL"
printf '%s\n' '#!/bin/bash' 'exit 0' >"$ENV_BIN"
cp "$DONOR_ROOT/systemd/cosmos-app.service" "$APP_UNIT_FRAGMENT"
chmod 600 "$APP_UNIT_FRAGMENT"
printf '%s\n' \
  '[Unit]' \
  "ConditionPathExists=$ROOT/.do-not-start-cosmos-app" \
  '' \
  '[Service]' \
  'EnvironmentFile=' \
  "EnvironmentFile=$RUNTIME_ENV" \
  >"$APP_UNIT_DROP_IN"
chmod 400 "$APP_UNIT_DROP_IN"
ln -s "$APP_UNIT_DROP_IN" "$APP_UNIT_RUNTIME_DROP_IN"
{
  printf '%s\n' '#!/bin/bash' 'set -eu'
  printf '%s\n' 'if [ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = cosmos-app.service ]; then'
  printf '%s\n' "  printf 'active\\n'" '  exit 0' 'fi'
  printf '%s\n' '[ "${1-}" = show ] && [ "${2-}" = cosmos-app.service ] || exit 91'
  printf '%s\n' "printf 'Id=cosmos-app.service\\n'"
  printf '%s\n' "printf 'Names=cosmos-app.service\\n'"
  printf '%s\n' "printf 'Following=\\n'"
  printf '%s\n' "printf 'LoadState=loaded\\n'"
  printf '%s\n' "printf 'FragmentPath=$APP_UNIT_FRAGMENT\\n'"
  printf '%s\n' "printf 'DropInPaths=$APP_UNIT_RUNTIME_DROP_IN\\n'"
  printf '%s\n' "printf 'NeedDaemonReload=no\\n'"
  printf '%s\n' "printf 'Requires=\\n'"
  printf '%s\n' "printf 'Wants=network-online.target\\n'"
  printf '%s\n' "printf 'Requisite=\\n'"
  printf '%s\n' "printf 'BindsTo=\\n'"
  printf '%s\n' "printf 'PartOf=\\n'"
  printf '%s\n' "printf 'After=network-online.target\\n'"
  printf '%s\n' "printf 'Before=\\n'"
  printf '%s\n' "printf 'Conflicts=\\n'"
  printf '%s\n' "printf 'OnFailure=\\n'"
  printf '%s\n' "printf 'OnSuccess=\\n'"
  printf '%s\n' "printf 'OnSuccessJobMode=replace\\n'"
  printf '%s\n' "printf 'OnFailureJobMode=replace\\n'"
  printf '%s\n' "printf 'PropagatesStopTo=\\n'"
  printf '%s\n' "printf 'StopPropagatedFrom=\\n'"
  printf '%s\n' "printf 'PropagatesReloadTo=\\n'"
  printf '%s\n' "printf 'ReloadPropagatedFrom=\\n'"
  printf '%s\n' "printf 'Upholds=\\n'"
  printf '%s\n' "printf 'JoinsNamespaceOf=\\n'"
  printf '%s\n' "printf 'RequiresMountsFor=\\n'"
  printf '%s\n' "printf 'WantsMountsFor=\\n'"
  printf '%s\n' "printf 'DefaultDependencies=yes\\n'"
  printf '%s\n' "printf 'SuccessAction=none\\n'"
  printf '%s\n' "printf 'FailureAction=none\\n'"
  printf '%s\n' "printf 'JobTimeoutAction=none\\n'"
  printf '%s\n' "printf 'StartLimitAction=none\\n'"
  printf '%s\n' "printf 'User=cosmos\\n'"
  printf '%s\n' "printf 'Group=cosmos\\n'"
  printf '%s\n' "printf 'WorkingDirectory=/opt/cosmos/current\\n'"
  printf '%s\n' "printf 'Environment=\\n'"
  printf '%s\n' "printf 'EnvironmentFiles=$RUNTIME_ENV (ignore_errors=no)\\n'"
  printf '%s\n' "printf 'PassEnvironment=\\n'"
  printf '%s\n' "printf 'UnsetEnvironment=NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy\\n'"
  printf '%s\n' "printf 'SetCredential=\\n'"
  printf '%s\n' "printf 'SetCredentialEncrypted=\\n'"
  printf '%s\n' "printf 'LoadCredential=\\n'"
  printf '%s\n' "printf 'LoadCredentialEncrypted=\\n'"
  printf '%s\n' "printf 'ImportCredential=\\n'"
  printf '%s\n' "printf 'SupplementaryGroups=\\n'"
  printf '%s\n' "printf 'DynamicUser=no\\n'"
  printf '%s\n' "printf 'PAMName=\\n'"
  printf '%s\n' "printf 'CapabilityBoundingSet=\\n'"
  printf '%s\n' "printf 'AmbientCapabilities=\\n'"
  printf '%s\n' "printf 'NoNewPrivileges=yes\\n'"
  printf '%s\n' "printf 'RootDirectory=\\n'"
  printf '%s\n' "printf 'RootImage=\\n'"
  printf '%s\n' "printf 'MountImages=\\n'"
  printf '%s\n' "printf 'ExtensionImages=\\n'"
  printf '%s\n' "printf 'ExtensionDirectories=\\n'"
  printf '%s\n' "printf 'ExecSearchPath=\\n'"
  printf '%s\n' "printf 'BindPaths=\\n'"
  printf '%s\n' "printf 'BindReadOnlyPaths=\\n'"
  printf '%s\n' "printf 'TemporaryFileSystem=\\n'"
  printf '%s\n' "printf 'ReadWritePaths=/var/lib/cosmos /run/cosmos-app\\n'"
  printf '%s\n' "printf 'ReadOnlyPaths=\\n'"
  printf '%s\n' "printf 'InaccessiblePaths=\\n'"
  printf '%s\n' "printf 'ExecPaths=\\n'"
  printf '%s\n' "printf 'NoExecPaths=\\n'"
  printf '%s\n' "printf 'RuntimeDirectory=cosmos-app\\n'"
  printf '%s\n' "printf 'RuntimeDirectoryMode=700\\n'"
  printf '%s\n' "printf 'RuntimeDirectoryPreserve=restart\\n'"
  printf '%s\n' "printf 'StateDirectory=\\n'"
  printf '%s\n' "printf 'StateDirectoryMode=755\\n'"
  printf '%s\n' "printf 'CacheDirectory=\\n'"
  printf '%s\n' "printf 'CacheDirectoryMode=755\\n'"
  printf '%s\n' "printf 'LogsDirectory=\\n'"
  printf '%s\n' "printf 'LogsDirectoryMode=755\\n'"
  printf '%s\n' "printf 'ConfigurationDirectory=\\n'"
  printf '%s\n' "printf 'ConfigurationDirectoryMode=755\\n'"
  printf '%s\n' "printf 'RootDirectoryStartOnly=no\\n'"
  printf '%s\n' "printf 'Type=simple\\n'"
  printf '%s\n' "printf 'StandardInput=null\\n'"
  printf '%s\n' "printf 'StandardOutput=journal\\n'"
  printf '%s\n' "printf 'StandardError=journal\\n'"
  printf '%s\n' "printf 'Sockets=\\n'"
  printf '%s\n' "printf 'BusName=\\n'"
  printf '%s\n' "printf 'PIDFile=\\n'"
  printf '%s\n' "printf 'NotifyAccess=none\\n'"
  printf '%s\n' "printf 'FileDescriptorStoreMax=0\\n'"
  printf '%s\n' "printf 'FileDescriptorStorePreserve=no\\n'"
  printf '%s\n' "printf 'ExecCondition=\\n'"
  printf '%s\n' "printf 'ExecStartPre=\\n'"
  printf '%s\n' \
    "printf 'ExecStart={ path=$ENV_BIN ; argv[]=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $COMMAND_ROOT/node server/dist/index.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'"
  printf '%s\n' \
    "printf 'ExecStartEx={ path=$ENV_BIN ; argv[]=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $COMMAND_ROOT/node server/dist/index.js ; flags= ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'"
  printf '%s\n' "printf 'ExecStartPost=\\n'"
  printf '%s\n' "printf 'ExecReload=\\n'"
  printf '%s\n' "printf 'ExecStop=\\n'"
  printf '%s\n' "printf 'ExecStopPost=\\n'"
} >"$SYSTEMCTL"
chmod 555 "$COMMAND_ROOT/node" "$COMMAND_ROOT/bash" "$SYSTEMCTL" "$CURL" "$ENV_BIN"

printf 'SIMULATION FIXTURE TRUST MATERIAL ONLY\n' >"$TRUST_KEY"
printf '{"status":"ISOLATED_HOST_EVIDENCE"}\n' >"$HOST_EVIDENCE"
chmod 600 "$TRUST_KEY" "$HOST_EVIDENCE"
node - "$HOST_EVIDENCE" "$HOST_READBACK" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [evidencePath, output] = process.argv.slice(2);
const evidence = fs.readFileSync(evidencePath);
const readback = {
  source: 'TARGET_HOST_OWNER_READBACK',
  account: 'aws:123456789012',
  targetHost: 'isolated-staging.internal',
  environment: 'isolated-staging',
  freeBytes: 1073741824,
  backupReserveBytes: 4096,
  sqliteVersion: '3.53.3',
  evidenceSha256: crypto.createHash('sha256').update(evidence).digest('hex'),
  observedAtUtc: '2026-07-24T00:09:00Z',
};
fs.writeFileSync(output, `${JSON.stringify(readback, null, 2)}\n`, { mode: 0o600 });
NODE

write_runtime_env() {
  local sha="$1"
  printf '%s\n' \
    'HOST=127.0.0.1' \
    'PORT=8080' \
    "DATA_DIR=$DATA_DIR" \
    "DATA_DIR_LOGICAL_LEASE_ROOT=$ROOT/leases" \
    "EVIDENCE_DIR=$ROOT/evidence" \
    "MODEL_DIR=$ROOT/models" \
    "BACKUP_DIR=$ROOT/backups" \
    'CONTROL_ROOM_OPERATOR_EMAIL=operator@isolated.test' \
    'CF_ACCESS_TEAM_DOMAIN=https://isolated-staging.cloudflareaccess.com' \
    'CF_ACCESS_AUD=isolated_staging_audience' \
    "I00_TESTED_SHA=$sha" \
    "I00_DEPLOYED_SHA=$sha" \
    'I00_CONFIG_REVISION=config-fixture' \
    'I00_MODEL_REVISION=UNAVAILABLE' \
    'I00_PUBLIC_SOURCE_STARTUP_EGRESS=1' >"$RUNTIME_ENV"
  chmod 600 "$RUNTIME_ENV"
}
write_runtime_env "$TARGET_SHA"

printf '%s\n' \
  "COSMOS_ROOT=$COSMOS_ROOT" \
  "RELEASES_DIR=$RELEASES_DIR" \
  "CURRENT_LINK=$CURRENT_LINK" \
  "PREVIOUS_LINK=$PREVIOUS_LINK" \
  "DATA_DIR=$DATA_DIR" \
  "OPS_STATE_DIR=$OPS_STATE_DIR" \
  'APP_UNIT=cosmos-app.service' \
  'HEALTH_BASE=http://127.0.0.1:8080' \
  'GATE_TIMEOUT_SEC=60' \
  'HTTP_TIMEOUT_SEC=5' \
  'LOCK_TIMEOUT_SEC=30' \
  'I00_OPS_READBACK_TIMEOUT_MS=750' \
  'I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback' \
  "DEPLOY_LOCK=$OPS_STATE_DIR/locks/deploy.lock" >"$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"

note "immutable rollback fixtures bind distinct installed releases"
CURRENT_RELEASE="$(install_fixture_release "$ROOT/current-source" "$CURRENT_SHA")"
TARGET_RELEASE="$(install_fixture_release "$ROOT/target-source" "$TARGET_SHA")"
ALTERNATE_SAME_ID_RELEASE="$(
  install_alternate_same_id_release "$ROOT/alternate-current-source" "$CURRENT_SHA"
)"
ln -s "$CURRENT_RELEASE" "$CURRENT_LINK"
ln -s "$TARGET_RELEASE" "$PREVIOUS_LINK"
assert_eq "$(readlink "$CURRENT_LINK")" "$CURRENT_RELEASE"
assert_eq "$(readlink "$PREVIOUS_LINK")" "$TARGET_RELEASE"
assert_eq "$(file_mode "$CURRENT_RELEASE")" 500
assert_eq "$(file_mode "$TARGET_RELEASE")" 500

node "$SANITIZER" \
  --env "$DEPLOY_ENV" \
  --output "$SANITIZED_ENV" \
  --profile deploy \
  --node "$COMMAND_ROOT/node" \
  --bash "$COMMAND_ROOT/bash" \
  --env-bin "$ENV_BIN" \
  --systemctl "$SYSTEMCTL" \
  --curl "$CURL" \
  --provenance-mode TEST \
  --provenance-root "$ROOT" \
  --require-effect-bindings >/dev/null
assert_eq "$(file_mode "$SANITIZED_ENV")" 600
assert_eq "$(grep -c "^I00_BASH='$COMMAND_ROOT/bash'\$" "$SANITIZED_ENV")" 1
assert_eq \
  "$(grep -c "^FROZEN_MARKER='$OPS_STATE_DIR/deploy-frozen.json'\$" "$SANITIZED_ENV")" \
  1

note "rollback producer rejects target-current aliasing and same-ID alternate trees"
write_runtime_env "$CURRENT_SHA"
NEGATIVE_ROOT="$ROOT/producer-negatives"
mkdir -m 700 "$NEGATIVE_ROOT"
NEGATIVE_REQUEST="$ROOT/authorization/producer-negative.request.json"
node "$FIXTURE" request "$CONTRACT" "$ROOT" SERVICE_ROLLBACK \
  "$NEGATIVE_REQUEST"
risk_args \
  "$NEGATIVE_REQUEST" \
  "$CURRENT_RELEASE" \
  "$ROOT/rollback-evidence" \
  "$ROOT/authorization/current-target.risk.json" \
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
assert_failure_contains 'must be distinct' \
  node "$RISK_PRODUCER" "${RISK_ARGS[@]}"
assert_not_file "$ROOT/authorization/current-target.risk.json"
risk_args \
  "$NEGATIVE_REQUEST" \
  "$ALTERNATE_SAME_ID_RELEASE" \
  "$ROOT/rollback-evidence" \
  "$ROOT/authorization/same-id-alternate.risk.json" \
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
assert_failure_contains 'must be distinct' \
  node "$RISK_PRODUCER" "${RISK_ARGS[@]}"
assert_not_file "$ROOT/authorization/same-id-alternate.risk.json"
write_runtime_env "$TARGET_SHA"

note "preexisting claim-directory symlink cannot redirect staged evidence"
CLAIM_SYMLINK_ROOT="$ROOT/claim-symlink"
produce_scenario \
  "$CLAIM_SYMLINK_ROOT" \
  a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1
set_scenario_args "$CLAIM_SYMLINK_ROOT"
CLAIM_SYMLINK_TARGET="$ROOT/claim-symlink-target"
mkdir -m 700 "$CLAIM_SYMLINK_TARGET"
printf 'sentinel\n' >"$CLAIM_SYMLINK_TARGET/sentinel"
ln -s "$CLAIM_SYMLINK_TARGET" "$SCENARIO_CLAIM_DIR"
assert_failure_contains 'rollback claim evidence directory must be absent before staging' \
  node "$OUTCOME_RECORDER" --stage-rollback "${ROLLBACK_BASE[@]}" \
    --simulation-clock --now "$STAGED_AT"
assert_eq \
  "$(find "$CLAIM_SYMLINK_TARGET" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" \
  1
assert_file "$CLAIM_SYMLINK_TARGET/sentinel"
assert_eq "$(readlink "$SCENARIO_CLAIM_DIR")" "$CLAIM_SYMLINK_TARGET"

note "stale receipts refuse before claim consumption or effect staging"
MAIN_ROOT="$ROOT/main"
produce_scenario \
  "$MAIN_ROOT" \
  cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
set_scenario_args "$MAIN_ROOT"
printf '{"kind":"ROLLBACK","schemaVersion":1,"status":"ROLLED_BACK_PROVED"}\n' \
  >"$SCENARIO_RESULT"
chmod 600 "$SCENARIO_RESULT"
assert_failure_contains 'must be absent before the authorized action' \
  node "$OUTCOME_RECORDER" --stage-rollback "${ROLLBACK_BASE[@]}" \
    --simulation-clock --now "$STAGED_AT"
assert_not_file "$SCENARIO_CLAIM_DIR"
assert_eq "$(find "$SCENARIO_CLAIMS" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 0
assert_eq "$(readlink "$CURRENT_LINK")" "$CURRENT_RELEASE"
rm "$SCENARIO_RESULT"

printf '{"kind":"AUTHORIZED_ACTION_RECONCILIATION","schemaVersion":1,"status":"RECONCILED"}\n' \
  >"$SCENARIO_RECONCILIATION"
chmod 600 "$SCENARIO_RECONCILIATION"
assert_failure_contains 'must be absent before the authorized action' \
  node "$OUTCOME_RECORDER" --stage-rollback "${ROLLBACK_BASE[@]}" \
    --simulation-clock --now "$STAGED_AT"
assert_not_file "$SCENARIO_CLAIM_DIR"
assert_eq "$(find "$SCENARIO_CLAIMS" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 0
assert_eq "$(readlink "$CURRENT_LINK")" "$CURRENT_RELEASE"
rm "$SCENARIO_RECONCILIATION"

note "test provenance requires injected clocks and ordered effect chronology"
assert_failure_contains 'requires --simulation-clock' \
  node "$OUTCOME_RECORDER" --stage-rollback "${ROLLBACK_BASE[@]}"
assert_not_file "$SCENARIO_CLAIM_DIR"
node "$OUTCOME_RECORDER" \
  --stage-rollback \
  "${ROLLBACK_BASE[@]}" \
  --simulation-clock \
  --now "$STAGED_AT" >"$MAIN_ROOT/stage.json"
assert_eq "$(json_value "$MAIN_ROOT/stage.json" status)" \
  ROLLBACK_STAGE_READY_NOT_AUTHORIZED
assert_file "$SCENARIO_CLAIM_DIR/pre-target-readback.json"
assert_eq "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"

consume_scenario_authorization
authorized_args
assert_eq "$(json_value "$MAIN_ROOT/SERVICE_ROLLBACK.validation.json" status)" \
  AUTHORIZATION_VALID
assert_file "$SCENARIO_CONSUMPTION"
assert_failure_contains 'requires --simulation-clock' \
  node "$OUTCOME_RECORDER" --verify-rollback-stage "${AUTHORIZED_ARGS[@]}"
node "$OUTCOME_RECORDER" \
  --verify-rollback-stage \
  "${AUTHORIZED_ARGS[@]}" \
  --simulation-clock \
  --now "$CONSUMED_AT" >"$MAIN_ROOT/verify.json"
assert_eq "$(json_value "$MAIN_ROOT/verify.json" status)" \
  ROLLBACK_STAGE_VERIFIED_FOR_EFFECT

STAGE_REFUSAL_ARGS=(
  --record-rollback-refusal
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  --refusal-phase STAGE_VERIFY_FAILED
  --simulation-clock
  --now "$COMPLETED_AT"
)
SCENARIO_EFFECT_START="$(preview_endpoint "$SCENARIO_PREVIEW" effect-start-evidence)"
SCENARIO_EFFECT_FINISH="$(preview_endpoint "$SCENARIO_PREVIEW" effect-finish-evidence)"
assert_failure_contains 'forbids effect evidence arguments' \
  node "$OUTCOME_RECORDER" "${STAGE_REFUSAL_ARGS[@]}" \
    --effect-start-evidence "$SCENARIO_EFFECT_START" \
    --effect-finish-evidence "$SCENARIO_EFFECT_FINISH"
write_runner_evidence AUTHORIZED_EFFECT_COMPLETED 0
assert_failure_contains 'requires absent authorized effect start evidence' \
  node "$OUTCOME_RECORDER" "${STAGE_REFUSAL_ARGS[@]}"
rm "$SCENARIO_EFFECT_START" "$SCENARIO_EFFECT_FINISH"

set_release_links "$TARGET_RELEASE" "$CURRENT_RELEASE"
assert_failure_contains 'effect-start-evidence' \
  node "$OUTCOME_RECORDER" \
    --record-rollback-effect \
    "${AUTHORIZED_ARGS[@]}" \
    --systemctl "$SYSTEMCTL" \
    --curl "$CURL" \
    --simulation-clock \
    --now "$COMPLETED_AT"
write_runner_evidence AUTHORIZED_EFFECT_COMPLETED 0
assert_failure_contains 'started-at-utc' \
  node "$OUTCOME_RECORDER" \
    --record-rollback-effect \
    "${AUTHORIZED_ARGS[@]}" \
    --systemctl "$SYSTEMCTL" \
    --curl "$CURL" \
    "${RUNNER_EVIDENCE_ARGS[@]}" \
    --simulation-clock \
    --now "$COMPLETED_AT" \
    --started-at-utc "$CONSUMED_AT"
assert_failure_contains 'chronology' \
  node "$OUTCOME_RECORDER" \
    --record-rollback-effect \
    "${AUTHORIZED_ARGS[@]}" \
    --systemctl "$SYSTEMCTL" \
    --curl "$CURL" \
    "${RUNNER_EVIDENCE_ARGS[@]}" \
    --simulation-clock \
    --now "$STAGED_AT"
assert_not_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
assert_not_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"

cp "$SCENARIO_EFFECT_START" "$MAIN_ROOT/runner.start.saved"
cp "$SCENARIO_EFFECT_FINISH" "$MAIN_ROOT/runner.terminal.saved"
for capability_mode in \
  VERIFIER SCRIPT BOOTSTRAP ENVIRONMENT EXECUTABLE ARGV DIRECTORY \
  AUTOMATIC_ROLLBACK WRITE_ROOT READ_ROOT OBSERVED_ROOT
do
  cp "$MAIN_ROOT/runner.start.saved" "$SCENARIO_EFFECT_START"
  cp "$MAIN_ROOT/runner.terminal.saved" "$SCENARIO_EFFECT_FINISH"
  chmod 600 "$SCENARIO_EFFECT_START" "$SCENARIO_EFFECT_FINISH"
  rewrite_runner_capability "$capability_mode"
  assert_failure \
    node "$OUTCOME_RECORDER" \
      --record-rollback-terminal \
      "${AUTHORIZED_ARGS[@]}" \
      --systemctl "$SYSTEMCTL" \
      --curl "$CURL" \
      "${RUNNER_EVIDENCE_ARGS[@]}" \
      --simulation-clock \
      --now "$COMPLETED_AT"
  assert_not_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
  assert_not_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
  assert_not_file "$SCENARIO_RESULT"
  assert_not_file "$SCENARIO_RECONCILIATION"
done
cp "$MAIN_ROOT/runner.start.saved" "$SCENARIO_EFFECT_START"
cp "$MAIN_ROOT/runner.terminal.saved" "$SCENARIO_EFFECT_FINISH"
chmod 600 "$SCENARIO_EFFECT_START" "$SCENARIO_EFFECT_FINISH"

node "$OUTCOME_RECORDER" \
  --record-rollback-terminal \
  "${AUTHORIZED_ARGS[@]}" \
  --systemctl "$SYSTEMCTL" \
  --curl "$CURL" \
  "${RUNNER_EVIDENCE_ARGS[@]}" \
  --simulation-clock >"$MAIN_ROOT/effect.json"
assert_eq "$(json_value "$MAIN_ROOT/effect.json" status)" \
  ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION
assert_eq "$(json_value "$MAIN_ROOT/effect.json" terminalDisposition)" COMPLETED
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" effect.startEvidencePath)" \
  "$SCENARIO_EFFECT_START"
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" effect.terminalEvidencePath)" \
  "$SCENARIO_EFFECT_FINISH"
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.status)" \
  AUTHORIZED_EFFECT_COMPLETED
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.exitCode)" 0
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" completedAtUtc)" \
  "$(json_value "$SCENARIO_EFFECT_FINISH" effectFinishedAtUtc)"
assert_eq "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 4
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"

note "finalization requires the exact nine-file semantic evidence inventory"
write_final_evidence
EVIDENCE_FILES=(
  pre-target-readback.json
  post-target-readback.json
  cloudflare-boundary.json
  watchdog.json
  database-schema.json
  backup.json
  recovery.json
  reconciliation.json
  authorization.json
)
for evidence_name in "${EVIDENCE_FILES[@]}"; do
  assert_file "$SCENARIO_CLAIM_DIR/$evidence_name"
done
assert_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
assert_eq "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 10

FINALIZE_ARGS=(
  --finalize-rollback
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  --simulation-clock
  --now "$FINALIZED_AT"
)
for evidence_name in "${EVIDENCE_FILES[@]}"; do
  held="$SCENARIO_ROOT/held-$evidence_name"
  mv "$SCENARIO_CLAIM_DIR/$evidence_name" "$held"
  assert_failure node "$OUTCOME_RECORDER" "${FINALIZE_ARGS[@]}"
  assert_not_file "$SCENARIO_RESULT"
  assert_not_file "$SCENARIO_RECONCILIATION"
  mv "$held" "$SCENARIO_CLAIM_DIR/$evidence_name"
done
printf '{"status":"UNEXPECTED"}\n' >"$SCENARIO_CLAIM_DIR/unexpected.json"
chmod 600 "$SCENARIO_CLAIM_DIR/unexpected.json"
assert_failure node "$OUTCOME_RECORDER" "${FINALIZE_ARGS[@]}"
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"
rm "$SCENARIO_CLAIM_DIR/unexpected.json"
assert_failure_contains 'requires --simulation-clock' \
  node "$OUTCOME_RECORDER" \
    --finalize-rollback \
    "${AUTHORIZED_ARGS[@]}" \
    --systemctl "$SYSTEMCTL" \
    --curl "$CURL"
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"

node "$OUTCOME_RECORDER" "${FINALIZE_ARGS[@]}" >"$MAIN_ROOT/finalize.json"
assert_eq "$(json_value "$MAIN_ROOT/finalize.json" status)" ROLLBACK_FINALIZED
assert_eq "$(json_value "$SCENARIO_RESULT" schemaVersion)" 2
assert_eq "$(json_value "$SCENARIO_RESULT" kind)" ROLLBACK
assert_eq "$(json_value "$SCENARIO_RESULT" status)" ROLLED_BACK_PROVED
assert_eq "$(json_value "$SCENARIO_RESULT" fromSha)" "$CURRENT_SHA"
assert_eq "$(json_value "$SCENARIO_RESULT" toSha)" "$TARGET_SHA"
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" kind)" \
  AUTHORIZED_ACTION_RECONCILIATION
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" actionClass)" SERVICE_ROLLBACK
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" status)" RECONCILED
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" disposition)" \
  ROLLBACK_SEMANTIC_PROOF_RECONCILED
assert_eq "$(file_mode "$SCENARIO_RESULT")" 600
assert_eq "$(file_mode "$SCENARIO_RECONCILIATION")" 600
assert_failure node "$OUTCOME_RECORDER" "${FINALIZE_ARGS[@]}"

note "pair publication fault remains fail-closed without a commit marker"
set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
FAULT_ROOT="$ROOT/fault"
produce_scenario \
  "$FAULT_ROOT" \
  dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
set_scenario_args "$FAULT_ROOT"
run_positive_lifecycle_to_pending
authorized_args
FAULT_FINALIZE_ARGS=(
  --finalize-rollback
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  --simulation-clock
  --now "$FINALIZED_AT"
  --test-fail-after-result
)
assert_failure_contains 'test fault after result publication' \
  node "$OUTCOME_RECORDER" "${FAULT_FINALIZE_ARGS[@]}"
assert_file "$SCENARIO_RESULT"
assert_file "$SCENARIO_RECONCILIATION"
assert_eq "$(file_mode "$SCENARIO_RESULT")" 600
assert_eq "$(file_mode "$SCENARIO_RECONCILIATION")" 600
assert_eq "$(json_value "$SCENARIO_RESULT" kind)" ROLLBACK
assert_eq "$(json_value "$SCENARIO_RESULT" status)" ROLLED_BACK_PROVED
assert_eq "$(wc -c <"$SCENARIO_RECONCILIATION" | tr -d ' ')" 0
FAULT_RESULT_SHA="$(sha256_file "$SCENARIO_RESULT")"
assert_failure node "$OUTCOME_RECORDER" "${FAULT_FINALIZE_ARGS[@]}"
assert_eq "$(sha256_file "$SCENARIO_RESULT")" "$FAULT_RESULT_SHA"
assert_eq "$(wc -c <"$SCENARIO_RECONCILIATION" | tr -d ' ')" 0

note "stage-verification refusal publishes no runner or effect evidence"
set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
STAGE_REFUSAL_ROOT="$ROOT/stage-refusal"
produce_scenario \
  "$STAGE_REFUSAL_ROOT" \
  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
set_scenario_args "$STAGE_REFUSAL_ROOT"
run_lifecycle_to_verified
STAGE_REFUSAL_ARGS=(
  --record-rollback-refusal
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  --refusal-phase STAGE_VERIFY_FAILED
  --simulation-clock
  --now "$COMPLETED_AT"
)
node "$OUTCOME_RECORDER" "${STAGE_REFUSAL_ARGS[@]}" \
  >"$STAGE_REFUSAL_ROOT/refusal.out.json"
assert_eq "$(json_value "$STAGE_REFUSAL_ROOT/refusal.out.json" status)" \
  ROLLBACK_REFUSED_NO_EFFECT_RECONCILED
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" refusalPhase)" \
  STAGE_VERIFY_FAILED
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" donorExitCode)" null
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" refusalClass)" \
  STAGE_VERIFY_FAILED
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" effect)" null
assert_not_file "$(preview_endpoint "$SCENARIO_PREVIEW" effect-start-evidence)"
assert_not_file "$(preview_endpoint "$SCENARIO_PREVIEW" effect-finish-evidence)"
assert_not_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
assert_not_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
assert_eq "$(json_value "$SCENARIO_RESULT" status)" ACTION_REFUSED_NO_EFFECT
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" disposition)" \
  ROLLBACK_REFUSED_NO_EFFECT_RECONCILED

note "donor pre-switch refusals terminate consumed authorization without effect claims"
REFUSAL_CODES=(1 4 5 6)
REFUSAL_CLASSES=(
  PRE_SWITCH_REFUSAL
  DEPLOY_LOCK_BUSY
  SCHEMA_INCOMPATIBLE
  POLICY_REFUSED
)
REFUSAL_NONCES=(
  1111111111111111111111111111111111111111111111111111111111111111
  4444444444444444444444444444444444444444444444444444444444444444
  5555555555555555555555555555555555555555555555555555555555555555
  6666666666666666666666666666666666666666666666666666666666666666
)
for refusal_index in 0 1 2 3; do
  set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
  refusal_code="${REFUSAL_CODES[$refusal_index]}"
  refusal_class="${REFUSAL_CLASSES[$refusal_index]}"
  refusal_root="$ROOT/refusal-$refusal_code"
  produce_scenario "$refusal_root" "${REFUSAL_NONCES[$refusal_index]}"
  set_scenario_args "$refusal_root"
  run_lifecycle_to_verified
  write_runner_evidence AUTHORIZED_EFFECT_TERMINATED "$refusal_code"
  REFUSAL_ARGS=(
    --record-rollback-refusal
    "${AUTHORIZED_ARGS[@]}"
    --systemctl "$SYSTEMCTL"
    --curl "$CURL"
    --refusal-phase DONOR_TERMINATED
    "${RUNNER_EVIDENCE_ARGS[@]}"
    --simulation-clock
    --now "$COMPLETED_AT"
  )
  TERMINAL_ARGS=(
    --record-rollback-terminal
    "${AUTHORIZED_ARGS[@]}"
    --systemctl "$SYSTEMCTL"
    --curl "$CURL"
    "${RUNNER_EVIDENCE_ARGS[@]}"
    --simulation-clock
    --now "$COMPLETED_AT"
  )
  if [ "$refusal_code" = 1 ]; then
    MISSING_EVIDENCE_REFUSAL_ARGS=(
      --record-rollback-refusal
      "${AUTHORIZED_ARGS[@]}"
      --systemctl "$SYSTEMCTL"
      --curl "$CURL"
      --refusal-phase DONOR_TERMINATED
      --simulation-clock
      --now "$COMPLETED_AT"
    )
    assert_failure_contains 'effect-start-evidence' \
      node "$OUTCOME_RECORDER" "${MISSING_EVIDENCE_REFUSAL_ARGS[@]}"
    assert_failure_contains 'donor-exit-code' \
      node "$OUTCOME_RECORDER" "${REFUSAL_ARGS[@]}" --donor-exit-code 1
    cp "$SCENARIO_EFFECT_FINISH" "$refusal_root/terminal.saved"
    rewrite_runner_terminal MISMATCHED_CHAIN
    assert_failure_contains 'terminal does not bind the exact start controls' \
      node "$OUTCOME_RECORDER" "${REFUSAL_ARGS[@]}"
    cp "$refusal_root/terminal.saved" "$SCENARIO_EFFECT_FINISH"
    chmod 600 "$SCENARIO_EFFECT_FINISH"
    rewrite_runner_terminal COMPLETED
    assert_failure_contains 'terminated' \
      node "$OUTCOME_RECORDER" "${REFUSAL_ARGS[@]}"
    cp "$refusal_root/terminal.saved" "$SCENARIO_EFFECT_FINISH"
    chmod 600 "$SCENARIO_EFFECT_FINISH"
    assert_eq \
      "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" \
      1
    assert_not_file "$SCENARIO_RESULT"
    assert_not_file "$SCENARIO_RECONCILIATION"
  fi
  node "$OUTCOME_RECORDER" "${TERMINAL_ARGS[@]}" \
    >"$refusal_root/refusal.out.json"
  assert_eq "$(json_value "$refusal_root/refusal.out.json" status)" \
    ROLLBACK_REFUSED_NO_EFFECT_RECONCILED
  assert_eq "$(json_value "$refusal_root/refusal.out.json" terminalDisposition)" \
    DONOR_REFUSAL
  assert_eq "$(json_value "$refusal_root/refusal.out.json" terminalExitCode)" \
    "$refusal_code"
  assert_eq "$(readlink "$CURRENT_LINK")" "$CURRENT_RELEASE"
  assert_eq "$(readlink "$PREVIOUS_LINK")" "$TARGET_RELEASE"
  assert_file "$SCENARIO_CLAIM_DIR/pre-target-readback.json"
  assert_file "$SCENARIO_CLAIM_DIR/refusal-readback.json"
  assert_file "$SCENARIO_CLAIM_DIR/authorization.json"
  assert_file "$SCENARIO_CLAIM_DIR/rollback-refusal.json"
  assert_not_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
  assert_not_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
  assert_not_file "$SCENARIO_CLAIM_DIR/frozen-marker.json"
  assert_eq \
    "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" \
    4
  assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" status)" \
    ROLLBACK_REFUSED_NO_EFFECT
  assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" refusalPhase)" \
    DONOR_TERMINATED
  assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" donorExitCode)" \
    "$refusal_code"
  assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" refusalClass)" \
    "$refusal_class"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" effect.startEvidencePath)" \
    "$SCENARIO_EFFECT_START"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" effect.terminalEvidencePath)" \
    "$SCENARIO_EFFECT_FINISH"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-refusal.json" retainedCurrent.testedSha)" \
    "$CURRENT_SHA"
  assert_eq "$(json_value "$SCENARIO_RESULT" status)" ACTION_REFUSED_NO_EFFECT
  assert_eq "$(json_value "$SCENARIO_RESULT" actionClass)" SERVICE_ROLLBACK
  assert_eq "$(json_value "$SCENARIO_RESULT" deployedSha)" "$CURRENT_SHA"
  assert_eq "$(json_value "$SCENARIO_RESULT" outcome.status)" \
    ROLLBACK_REFUSED_NO_EFFECT
  assert_eq "$(json_value "$SCENARIO_RESULT" outcome.primaryPath)" \
    "$SCENARIO_CLAIM_DIR/rollback-refusal.json"
  assert_eq "$(json_value "$SCENARIO_RESULT" outcome.evidenceSha256)" \
    "$(sha256_file "$SCENARIO_CLAIM_DIR/rollback-refusal.json")"
  assert_eq "$(json_value "$SCENARIO_RECONCILIATION" status)" RECONCILED
  assert_eq "$(json_value "$SCENARIO_RECONCILIATION" disposition)" \
    ROLLBACK_REFUSED_NO_EFFECT_RECONCILED
  assert_eq "$(json_value "$SCENARIO_RECONCILIATION" resultReceiptSha256)" \
    "$(sha256_file "$SCENARIO_RESULT")"
  assert_eq "$(file_mode "$SCENARIO_RESULT")" 600
  assert_eq "$(file_mode "$SCENARIO_RECONCILIATION")" 600
  assert_failure grep -E \
    'ROLLED_BACK_PROVED|ACTION_COMPLETED|ACCEPTED|PASS|SUCCESS' \
    "$refusal_root/refusal.out.json" "$SCENARIO_RESULT" \
    "$SCENARIO_RECONCILIATION" "$SCENARIO_CLAIM_DIR/rollback-refusal.json"
done

note "hostile rollback result symlink cannot redirect terminal refusal publication"
set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
HOSTILE_REFUSAL_ROOT="$ROOT/hostile-refusal"
produce_scenario \
  "$HOSTILE_REFUSAL_ROOT" \
  7777777777777777777777777777777777777777777777777777777777777777
set_scenario_args "$HOSTILE_REFUSAL_ROOT"
run_lifecycle_to_verified
write_runner_evidence AUTHORIZED_EFFECT_TERMINATED 1
HOSTILE_RESULT_TARGET="$ROOT/hostile-result-target"
printf 'sentinel\n' >"$HOSTILE_RESULT_TARGET"
ln -s "$HOSTILE_RESULT_TARGET" "$SCENARIO_RESULT"
HOSTILE_REFUSAL_ARGS=(
  --record-rollback-terminal
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  "${RUNNER_EVIDENCE_ARGS[@]}"
  --simulation-clock
  --now "$COMPLETED_AT"
)
assert_failure_contains 'must be absent before the authorized action' \
  node "$OUTCOME_RECORDER" "${HOSTILE_REFUSAL_ARGS[@]}"
assert_eq "$(<"$HOSTILE_RESULT_TARGET")" sentinel
assert_eq "$(readlink "$SCENARIO_RESULT")" "$HOSTILE_RESULT_TARGET"
assert_not_file "$SCENARIO_RECONCILIATION"
assert_not_file "$SCENARIO_CLAIM_DIR/rollback-refusal.json"
assert_not_file "$SCENARIO_CLAIM_DIR/refusal-readback.json"
assert_eq \
  "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" \
  1

note "donor exit 3 records a durable frozen post-effect failure"
set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
FROZEN_ROOT="$ROOT/frozen"
produce_scenario \
  "$FROZEN_ROOT" \
  eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
set_scenario_args "$FROZEN_ROOT"
run_lifecycle_to_verified
set_release_links "$TARGET_RELEASE" "$CURRENT_RELEASE"
write_runner_evidence AUTHORIZED_EFFECT_TERMINATED 3
assert_eq "$(json_value "$SCENARIO_EFFECT_FINISH" signal)" null
FROZEN_SOURCE="$(write_frozen_marker)"
FROZEN_SOURCE_SHA="$(sha256_file "$FROZEN_SOURCE")"
assert_file "$FROZEN_SOURCE"
assert_eq "$(file_mode "$FROZEN_SOURCE")" 600
FROZEN_EFFECT_ARGS=(
  --record-rollback-terminal
  "${AUTHORIZED_ARGS[@]}"
  --systemctl "$SYSTEMCTL"
  --curl "$CURL"
  "${RUNNER_EVIDENCE_ARGS[@]}"
  --simulation-clock
  --now "$COMPLETED_AT"
)
assert_failure node "$OUTCOME_RECORDER" "${FROZEN_EFFECT_ARGS[@]}"
assert_eq "$(json_value "$SCENARIO_EFFECT_FINISH" signal)" null
assert_eq "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1
assert_file "$SCENARIO_CLAIM_DIR/pre-target-readback.json"
assert_not_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
assert_not_file "$SCENARIO_CLAIM_DIR/frozen-marker.json"
assert_not_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
assert_not_file "$SCENARIO_RESULT"
assert_not_file "$SCENARIO_RECONCILIATION"
chmod 400 "$FROZEN_SOURCE"
assert_eq "$(file_mode "$FROZEN_SOURCE")" 400
node "$OUTCOME_RECORDER" "${FROZEN_EFFECT_ARGS[@]}" >"$FROZEN_ROOT/effect.json"
assert_eq "$(json_value "$FROZEN_ROOT/effect.json" status)" \
  ROLLBACK_SWITCHED_FROZEN_RECONCILED
assert_eq "$(json_value "$FROZEN_ROOT/effect.json" terminalDisposition)" FROZEN
assert_eq "$(json_value "$FROZEN_ROOT/effect.json" terminalExitCode)" 3
assert_eq "$(readlink "$CURRENT_LINK")" "$TARGET_RELEASE"
assert_eq "$(readlink "$PREVIOUS_LINK")" "$CURRENT_RELEASE"
assert_file "$SCENARIO_CLAIM_DIR/pre-target-readback.json"
assert_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
assert_file "$SCENARIO_CLAIM_DIR/frozen-marker.json"
assert_file "$SCENARIO_CLAIM_DIR/authorization.json"
assert_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
assert_eq "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 5
assert_eq "$(file_mode "$SCENARIO_CLAIM_DIR/frozen-marker.json")" 600
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" status)" \
  ROLLBACK_SWITCHED_FROZEN_PENDING_OWNER_ACTION
assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" donorExitCode)" 3
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" effect.startEvidencePath)" \
  "$SCENARIO_EFFECT_START"
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" effect.terminalEvidencePath)" \
  "$SCENARIO_EFFECT_FINISH"
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.status)" \
  AUTHORIZED_EFFECT_TERMINATED
assert_eq \
  "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" frozenMarkerSha256)" \
  "$(sha256_file "$SCENARIO_CLAIM_DIR/frozen-marker.json")"
assert_success node - "$FROZEN_SOURCE" "$SCENARIO_CLAIM_DIR/frozen-marker.json" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const captured = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
assert.deepStrictEqual(captured, source);
NODE
assert_file "$SCENARIO_RESULT"
assert_file "$SCENARIO_RECONCILIATION"
assert_eq "$(json_value "$SCENARIO_RESULT" status)" ACTION_FAILED_AFTER_EFFECT
assert_eq "$(json_value "$SCENARIO_RESULT" actionClass)" SERVICE_ROLLBACK
assert_eq "$(json_value "$SCENARIO_RESULT" outcome.status)" \
  ROLLBACK_SWITCHED_FROZEN_REQUIRES_OWNER_ACTION
assert_eq \
  "$(json_value "$SCENARIO_RESULT" outcome.evidenceSha256)" \
  "$(sha256_file "$SCENARIO_CLAIM_DIR/rollback-effect.json")"
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" status)" RECONCILED
assert_eq "$(json_value "$SCENARIO_RECONCILIATION" disposition)" \
  ROLLBACK_SWITCHED_FROZEN_REQUIRES_OWNER_ACTION
assert_eq \
  "$(json_value "$SCENARIO_RECONCILIATION" resultReceiptSha256)" \
  "$(sha256_file "$SCENARIO_RESULT")"
assert_eq "$(file_mode "$SCENARIO_RESULT")" 600
assert_eq "$(file_mode "$SCENARIO_RECONCILIATION")" 600
assert_failure grep -E \
  'ROLLED_BACK_PROVED|I00_OPS_OK|ACCEPTED|PASS|SUCCESS' \
  "$FROZEN_ROOT/effect.json" "$SCENARIO_RESULT" "$SCENARIO_RECONCILIATION" \
  "$SCENARIO_CLAIM_DIR/rollback-effect.json"
FROZEN_RESULT_SHA="$(sha256_file "$SCENARIO_RESULT")"
FROZEN_RECONCILIATION_SHA="$(sha256_file "$SCENARIO_RECONCILIATION")"
assert_failure node "$OUTCOME_RECORDER" \
  --finalize-rollback \
  "${AUTHORIZED_ARGS[@]}" \
  --systemctl "$SYSTEMCTL" \
  --curl "$CURL" \
  --simulation-clock \
  --now "$FINALIZED_AT"
assert_eq "$(sha256_file "$SCENARIO_RESULT")" "$FROZEN_RESULT_SHA"
assert_eq "$(sha256_file "$SCENARIO_RECONCILIATION")" "$FROZEN_RECONCILIATION_SHA"
assert_eq "$(sha256_file "$FROZEN_SOURCE")" "$FROZEN_SOURCE_SHA"
assert_eq "$(file_mode "$FROZEN_SOURCE")" 400

note "unmapped, null, signaled, and timed-out terminals publish ambiguous owner action"
AMBIGUOUS_CODES=(0 2 null null null 3 3)
AMBIGUOUS_MODES=(
  DIRECT DIRECT DIRECT SIGNAL TIMEOUT SIGNAL_WITH_EXIT TIMEOUT_WITH_EXIT
)
AMBIGUOUS_SIGNALS=(null null null SIGTERM SIGKILL SIGTERM SIGKILL)
AMBIGUOUS_FORCED=(false false false false true false true)
AMBIGUOUS_TIMEOUTS=(false false false false true false true)
AMBIGUOUS_NONCES=(
  8888888888888888888888888888888888888888888888888888888888888888
  9999999999999999999999999999999999999999999999999999999999999999
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  1212121212121212121212121212121212121212121212121212121212121212
  1313131313131313131313131313131313131313131313131313131313131313
)
for ambiguous_index in 0 1 2 3 4 5 6; do
  set_release_links "$CURRENT_RELEASE" "$TARGET_RELEASE"
  ambiguous_root="$ROOT/ambiguous-$ambiguous_index"
  produce_scenario "$ambiguous_root" "${AMBIGUOUS_NONCES[$ambiguous_index]}"
  set_scenario_args "$ambiguous_root"
  run_lifecycle_to_verified
  write_runner_evidence \
    AUTHORIZED_EFFECT_TERMINATED \
    "${AMBIGUOUS_CODES[$ambiguous_index]}"
  if [ "${AMBIGUOUS_MODES[$ambiguous_index]}" != DIRECT ]; then
    rewrite_runner_terminal "${AMBIGUOUS_MODES[$ambiguous_index]}"
  fi
  AMBIGUOUS_EFFECT_ARGS=(
    --record-rollback-terminal
    "${AUTHORIZED_ARGS[@]}"
    --systemctl "$SYSTEMCTL"
    --curl "$CURL"
    "${RUNNER_EVIDENCE_ARGS[@]}"
    --simulation-clock
    --now "$COMPLETED_AT"
  )
  node "$OUTCOME_RECORDER" "${AMBIGUOUS_EFFECT_ARGS[@]}" \
    >"$ambiguous_root/effect.json"
  assert_eq "$(json_value "$ambiguous_root/effect.json" status)" \
    ROLLBACK_EFFECT_AMBIGUOUS_RECONCILED
  assert_eq "$(json_value "$ambiguous_root/effect.json" terminalDisposition)" \
    AMBIGUOUS_EFFECT
  assert_eq "$(json_value "$ambiguous_root/effect.json" terminalExitCode)" \
    "${AMBIGUOUS_CODES[$ambiguous_index]}"
  assert_eq "$(readlink "$CURRENT_LINK")" "$CURRENT_RELEASE"
  assert_eq "$(readlink "$PREVIOUS_LINK")" "$TARGET_RELEASE"
  assert_file "$SCENARIO_CLAIM_DIR/pre-target-readback.json"
  assert_file "$SCENARIO_CLAIM_DIR/post-target-readback.json"
  assert_file "$SCENARIO_CLAIM_DIR/authorization.json"
  assert_file "$SCENARIO_CLAIM_DIR/rollback-effect.json"
  assert_not_file "$SCENARIO_CLAIM_DIR/frozen-marker.json"
  assert_eq \
    "$(find "$SCENARIO_CLAIM_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" \
    4
  assert_eq "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" status)" \
    ROLLBACK_EFFECT_AMBIGUOUS_PENDING_OWNER_ACTION
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.status)" \
    AUTHORIZED_EFFECT_TERMINATED
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.exitCode)" \
    "${AMBIGUOUS_CODES[$ambiguous_index]}"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.signal)" \
    "${AMBIGUOUS_SIGNALS[$ambiguous_index]}"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.forced)" \
    "${AMBIGUOUS_FORCED[$ambiguous_index]}"
  assert_eq \
    "$(json_value "$SCENARIO_CLAIM_DIR/rollback-effect.json" terminal.timedOut)" \
    "${AMBIGUOUS_TIMEOUTS[$ambiguous_index]}"
  assert_eq "$(json_value "$SCENARIO_RESULT" status)" ACTION_FAILED_AFTER_EFFECT
  assert_eq "$(json_value "$SCENARIO_RESULT" deployedSha)" "$CURRENT_SHA"
  assert_eq "$(json_value "$SCENARIO_RESULT" outcome.status)" \
    ROLLBACK_EFFECT_AMBIGUOUS_REQUIRES_OWNER_ACTION
  assert_eq "$(json_value "$SCENARIO_RECONCILIATION" disposition)" \
    ROLLBACK_EFFECT_AMBIGUOUS_REQUIRES_OWNER_ACTION
  assert_failure grep -E \
    'ROLLED_BACK_PROVED|ACTION_COMPLETED|ACCEPTED|PASS|SUCCESS' \
    "$ambiguous_root/effect.json" "$SCENARIO_RESULT" \
    "$SCENARIO_RECONCILIATION" "$SCENARIO_CLAIM_DIR/rollback-effect.json"
done

ROLLBACK_WRAPPER_SOURCE="$(cat "$I00_ROOT/bin/rollback-switch.sh")"
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--env-bin "$ENV_PATH"'
for env_endpoint in \
  'env-path:$ENV_PATH' \
  'env-sha256:$ENV_SHA256' \
  'env-identity:$ENV_IDENTITY_ENDPOINT'; do
  assert_contains "$ROLLBACK_WRAPPER_SOURCE" "$env_endpoint"
done
for app_unit_endpoint in \
  'app-unit-authority-closure-sha256:$APP_UNIT_AUTHORITY_CLOSURE_SHA256' \
  'app-unit-name:$APP_UNIT_ENDPOINT' \
  'app-unit-fragment-path:$APP_UNIT_FRAGMENT_PATH' \
  'app-unit-fragment-sha256:$APP_UNIT_FRAGMENT_SHA256' \
  'app-unit-fragment-identity:$APP_UNIT_FRAGMENT_IDENTITY' \
  'app-unit-environment-file-path:$APP_UNIT_RUNTIME_ENV_PATH' \
  'app-unit-environment-file-sha256:$APP_UNIT_RUNTIME_ENV_SHA256' \
  'app-unit-environment-file-identity:$APP_UNIT_RUNTIME_ENV_IDENTITY' \
  'app-unit-environment-file-optional:no' \
  'app-unit-user:$APP_UNIT_USER' \
  'app-unit-group:$APP_UNIT_GROUP' \
  'app-unit-working-directory:$APP_UNIT_WORKING_DIRECTORY' \
  'app-unit-unset-environment-sha256:$APP_UNIT_UNSET_ENVIRONMENT_SHA256' \
  'app-unit-namespace-remap-state:$APP_UNIT_NAMESPACE_REMAP_STATE' \
  'app-unit-staging-root:NONE' \
  'app-unit-drop-in-state:EXACT_PROVIDER_BOUND' \
  'app-unit-drop-in-set:$APP_UNIT_DROP_IN_SET' \
  'app-unit-environment-files-sha256:$APP_UNIT_ENVIRONMENT_FILES_SHA256' \
  'app-unit-provider-binding-sha256:$APP_UNIT_PROVIDER_BINDING_SHA256' \
  'app-unit-provider-unit:$APP_UNIT_PROVIDER_UNIT' \
  'app-unit-provider-fragment-path:$APP_UNIT_PROVIDER_FRAGMENT_PATH' \
  'app-unit-provider-fragment-sha256:$APP_UNIT_PROVIDER_FRAGMENT_SHA256' \
  'app-unit-provider-fragment-identity:$APP_UNIT_PROVIDER_FRAGMENT_IDENTITY' \
  'app-unit-provider-state:$APP_UNIT_PROVIDER_STATE' \
  'app-unit-provider-deployment-risk-path:$APP_UNIT_PROVIDER_DEPLOYMENT_RISK_PATH' \
  'app-unit-provider-action-preview-path:$APP_UNIT_PROVIDER_ACTION_PREVIEW_PATH' \
  'app-unit-need-daemon-reload:no' \
  'app-unit-exec-start-env-path:$APP_UNIT_EXEC_ENV_PATH' \
  'app-unit-exec-start-node-path:$APP_UNIT_EXEC_NODE_PATH' \
  'app-unit-exec-start-sha256:$APP_UNIT_EXEC_SHA256' \
  'app-unit-binding-sha256:$APP_UNIT_BINDING_SHA256'; do
  assert_contains "$ROLLBACK_WRAPPER_SOURCE" "$app_unit_endpoint"
done
assert_contains "$ROLLBACK_WRAPPER_SOURCE" 'inspect-app-unit.mjs'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--expected-binding-sha256'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" 'verify-app-unit-action-binding.mjs'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--deployment-risk "$DEPLOYMENT_RISK"'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--action-preview "$ACTION_PREVIEW"'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" \
  'inspect-executable.mjs" --path "$ENV_PATH")" = "$ENV_INITIAL"'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" \
  'unset BASH_ENV ENV CDPATH GLOBIGNORE I00_EFFECT_CLASS'
assert_failure grep -F -- '--class)' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F 'I00_EFFECT_CLASS=SERVICE_ROLLBACK' \
  "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F '"$ENV_PATH" -i' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F '"$BASH_PATH" -p "$DONOR_ROOT/bin/rollback.sh"' \
  "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F -- '--donor-exit-code' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F -- '--started-at-utc' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F 'DEPLOY_LOCK_ENDPOINT' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F 'FROZEN_MARKER' "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F 'flock' "$I00_ROOT/bin/rollback-switch.sh"
assert_eq "$(grep -c 'validate-authorization.mjs' "$I00_ROOT/bin/rollback-switch.sh")" 1
assert_eq "$(grep -c 'run-bound-effect.mjs' "$I00_ROOT/bin/rollback-switch.sh")" 1
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--refusal-phase STAGE_VERIFY_FAILED'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" '--record-rollback-terminal'
assert_failure grep -F -- '--refusal-phase DONOR_TERMINATED' \
  "$I00_ROOT/bin/rollback-switch.sh"
assert_failure grep -F -- '--record-rollback-effect' \
  "$I00_ROOT/bin/rollback-switch.sh"
assert_contains "$ROLLBACK_WRAPPER_SOURCE" \
  '--effect-start-evidence "$EFFECT_START_EVIDENCE"'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" \
  '--effect-finish-evidence "$EFFECT_FINISH_EVIDENCE"'
assert_contains "$ROLLBACK_WRAPPER_SOURCE" 'exit "$TERMINAL_EXIT_CODE"'
OUTCOME_RECORDER_SOURCE="$(cat "$OUTCOME_RECORDER")"
assert_contains "$OUTCOME_RECORDER_SOURCE" \
  '/proc/self/fd/${descriptor}/${basename(paths.claimDirectory)}'
assert_contains "$OUTCOME_RECORDER_SOURCE" \
  '/proc/self/fd/${parentDescriptor}/${basename(absolute)}'
assert_contains "$OUTCOME_RECORDER_SOURCE" \
  'production publication requires Linux descriptor-relative semantics'
assert_success node - "$I00_ROOT/bin/rollback-switch.sh" <<'NODE'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const inheritedNode = source.indexOf('INHERITED_NODE_DISCOVERED="$(command -v node');
const safePath = source.indexOf('PATH="$SAFE_PATH"', inheritedNode);
const simulationNode = source.indexOf('SIMULATION_NODE_PATH="$(', safePath);
const simulationInspection = source.indexOf(
  '"$SIMULATION_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs"',
  simulationNode,
);
const simulationHashPin = source.indexOf(
  'hash -p "$SIMULATION_NODE_PATH" node',
  simulationInspection,
);
const firstRawNode = source.indexOf(
  '\nnode "$SCRIPT_DIR/verify-donor.mjs"',
  simulationHashPin,
);
const stage = source.indexOf('--stage-rollback');
const validation = source.indexOf('AUTHORIZATION_VALIDATION="$(', stage);
const consumption = source.indexOf('AUTHORIZATION_CONSUMPTION="$(', validation);
const verify = source.indexOf('--verify-rollback-stage', consumption);
const runner = source.indexOf('run-bound-effect.mjs', verify);
const terminalRecord = source.indexOf('--record-rollback-terminal', runner);
const postRunExecutableCheck = source.indexOf(
  'require_effect_executable_identities',
  terminalRecord,
);
const postRunEnvCheck = source.indexOf(
  'sanitized donor env changed during rollback effect',
  terminalRecord,
);
const terminalClass = source.indexOf('TERMINAL_CLASS="$(', terminalRecord);
const terminalExit = source.indexOf('TERMINAL_EXIT_CODE="$(', terminalClass);
const donorRefusalExit = source.indexOf('exit "$TERMINAL_EXIT_CODE"', terminalExit);
const pending = source.indexOf(
  'rollback effect recorded; reconciliation required',
  donorRefusalExit,
);
const immediateRecorderSlice = source.slice(runner, terminalRecord);
if ([inheritedNode, safePath, simulationNode, simulationInspection,
  simulationHashPin, firstRawNode, stage, validation, consumption, verify,
  runner, terminalRecord, postRunExecutableCheck, postRunEnvCheck,
  terminalClass, terminalExit, donorRefusalExit, pending]
    .some((value) => value < 0)
    || !(inheritedNode < safePath && safePath < simulationNode
      && simulationNode < simulationInspection
      && simulationInspection < simulationHashPin
      && simulationHashPin < firstRawNode
      && stage < validation && validation < consumption && consumption < verify
      && verify < runner && runner < terminalRecord
      && terminalRecord < postRunExecutableCheck
      && postRunExecutableCheck < postRunEnvCheck
      && postRunEnvCheck < terminalClass && terminalClass < terminalExit
      && terminalExit < donorRefusalExit && donorRefusalExit < pending)
    || immediateRecorderSlice.includes('require_effect_executable_identities')
    || immediateRecorderSlice.includes('require_app_unit_binding')
    || immediateRecorderSlice.includes(
      'sanitized donor env changed during rollback effect',
    )
    || immediateRecorderSlice.includes('TERMINAL_CLASS')) {
  process.exit(1);
}
NODE

assert_success node - \
  "$I00_ROOT/bin/run-bound-effect.mjs" \
  "$OUTCOME_RECORDER" \
  "$0" <<'NODE'
const fs = require('node:fs');
const extract = (path, pattern) => {
  const source = fs.readFileSync(path, 'utf8');
  const match = source.match(pattern);
  if (match === null) process.exit(1);
  return match[1].split('\n').map((line) => line.trim()).join('\n');
};
const runner = extract(
  process.argv[2],
  /function primaryParentPrelude\(\) \{\n  return \[([\s\S]*?)\n  \]\.join\('\\n'\);\n\}/u,
);
const recorder = extract(
  process.argv[3],
  /function rollbackParentPrelude\(\) \{\n  return \[([\s\S]*?)\n  \]\.join\('\\n'\);\n\}/u,
);
const fixture = extract(
  process.argv[4],
  /const primaryParentPrelude = \[([\s\S]*?)\n\]\.join\('\\n'\);/u,
);
if (runner !== recorder || runner !== fixture) process.exit(1);
NODE

finish
