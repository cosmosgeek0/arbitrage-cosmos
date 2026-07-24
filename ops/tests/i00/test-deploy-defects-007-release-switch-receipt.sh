#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

RECORDER="$I00_ROOT/bin/record-release-switch-receipt.mjs"
SCHEMA="$I00_ROOT/schemas/release-switch-receipt.schema.json"
RECONCILIATION_SCHEMA="$I00_ROOT/schemas/release-switch-reconciliation.schema.json"
VALIDATOR="$I00_ROOT/bin/validate-receipt.mjs"
CHAIN_MAKER="$TEST_DIR/fixtures/make-release-switch-authorization-chain.mjs"
SHA=0123456789abcdef0123456789abcdef01234567
PRIOR_SHA=fedcba9876543210fedcba9876543210fedcba98
MANIFEST_SHA="$(printf 'a%.0s' {1..64})"
FIRST_HOST_SHA="$(printf 'c%.0s' {1..64})"
REAL_NODE="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')"
REAL_ENV="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$(command -v env)")"

normalize_fixture_release_modes() {
  node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const visit = (root) => {
  for (const name of fs.readdirSync(root)) {
    const target = path.resolve(root, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) process.exit(2);
    if (stat.isDirectory()) visit(target);
    else if (stat.isFile()) {
      fs.chmodSync(target, (stat.mode & 0o111) === 0 ? 0o444 : 0o555);
    } else process.exit(2);
  }
};
visit(process.argv[2]);
const manifestPath = path.resolve(process.argv[2], 'artifact-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const entry of manifest.files) {
  entry.mode = fs.lstatSync(path.resolve(process.argv[2], entry.path)).mode & 0o777;
}
fs.chmodSync(manifestPath, 0o600);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.chmodSync(manifestPath, 0o444);
NODE
}

note "DEPLOY-DEFECTS-007(2): Gate 5 has a closed release-switch receipt owner"
assert_file "$RECORDER"
assert_file "$SCHEMA"
assert_file "$RECONCILIATION_SCHEMA"
assert_file "$CHAIN_MAKER"
assert_contains "$(cat "$VALIDATOR")" "RELEASE_SWITCH: 'release-switch-receipt.schema.json'"

note "DEPLOY-DEFECTS-007(2): the receipt owner records one exact first-host switch"
CANONICAL_TEST_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$TEST_TMP")"
TARGET_ROOT="$CANONICAL_TEST_TMP/recorder-target"
RELEASE="$(assemble_fixture_release "$TARGET_ROOT/source-artifact" "$SHA")"
normalize_fixture_release_modes "$RELEASE"
RELEASES_DIR="$TARGET_ROOT/releases"
INSTALLED_RELEASE="$RELEASES_DIR/i00-$SHA"
CURRENT_LINK="$TARGET_ROOT/current"
PREVIOUS_LINK="$TARGET_ROOT/previous"
SANITIZED_ENV="$CANONICAL_TEST_TMP/sanitized-deploy.env"
FAKE_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-active"
INACTIVE_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-inactive"
FAKE_CURL="$CANONICAL_TEST_TMP/curl-healthy"
FAILED_CURL="$CANONICAL_TEST_TMP/curl-failed"
FAKE_NODE_ENDPOINT="$CANONICAL_TEST_TMP/node-substitution-endpoint"
PROOF_ROOT="$CANONICAL_TEST_TMP/ip-ops-i00-sim-release-switch"
node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$PROOF_ROOT" >/dev/null
RECEIPT_PARENT="$PROOF_ROOT/receipts"
RECORDED_RECEIPT="$RECEIPT_PARENT/first-host.json"
RECORDED_RECONCILIATION="$RECEIPT_PARENT/first-host-reconciliation.json"
PREEXISTING_RECEIPT="$RECEIPT_PARENT/preexisting.json"
PREEXISTING_RECONCILIATION="$RECEIPT_PARENT/preexisting-reconciliation.json"
INACTIVE_RECEIPT="$RECEIPT_PARENT/inactive.json"
FAILED_HEALTH_RECEIPT="$RECEIPT_PARENT/failed-health.json"
FAILED_DONOR_RECEIPT="$RECEIPT_PARENT/failed-donor.json"
COMPETING_RECEIPT="$RECEIPT_PARENT/competing.json"
MUTATED_LINK_RECEIPT="$RECEIPT_PARENT/mutated-link.json"
LATER_RECEIPT="$RECEIPT_PARENT/later.json"
FIXTURE_MANIFEST_SHA="$(
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(
      crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"),
    );
  ' "$RELEASE/artifact-manifest.json"
)"

mkdir -p "$RELEASES_DIR"
cp -R "$RELEASE" "$INSTALLED_RELEASE"
chmod -R a-w "$INSTALLED_RELEASE"
ln -s "$INSTALLED_RELEASE" "$CURRENT_LINK"
cat > "$SANITIZED_ENV" <<EOF
RELEASES_DIR='$RELEASES_DIR'
CURRENT_LINK='$CURRENT_LINK'
PREVIOUS_LINK='$PREVIOUS_LINK'
APP_UNIT='cosmos-app.service'
HEALTH_BASE='http://127.0.0.1:8080'
POST_SWITCH_GATE_PATHS='/health/live /health/ready'
EOF
chmod 600 "$SANITIZED_ENV"
cat > "$FAKE_SYSTEMCTL" <<'SH'
#!/usr/bin/env bash
[ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = cosmos-app.service ] || exit 9
printf 'active\n'
SH
cat > "$INACTIVE_SYSTEMCTL" <<'SH'
#!/usr/bin/env bash
[ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = cosmos-app.service ] || exit 9
printf 'inactive\n'
exit 3
SH
cat > "$FAKE_CURL" <<'SH'
#!/usr/bin/env bash
printf '200'
SH
cat > "$FAILED_CURL" <<'SH'
#!/usr/bin/env bash
printf '503'
exit 22
SH
cat > "$FAKE_NODE_ENDPOINT" <<'SH'
#!/usr/bin/env bash
exit 97
SH
chmod 500 "$FAKE_SYSTEMCTL" "$INACTIVE_SYSTEMCTL" "$FAKE_CURL" "$FAILED_CURL" \
  "$FAKE_NODE_ENDPOINT"

chain_value() {
  node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value[process.argv[2]]));' "$1" "$2"
}

make_chain() {
  local fixture_id="$1" result="$2" reconciliation="$3" first_host_sha="${4:-NONE}"
  local chain_systemctl="${5:-$FAKE_SYSTEMCTL}" chain_curl="${6:-$FAKE_CURL}"
  local chain_node="${7:-$REAL_NODE}" chain_env="${8:-$REAL_ENV}" chain
  local chain_proof_root="${9:-$PROOF_ROOT}"
  chain="$(
    node "$CHAIN_MAKER" "$I00_ROOT/deployment-authorization-contract.mjs" \
      "$chain_proof_root" "$fixture_id" "$RELEASE" "$SHA" \
      "$FIXTURE_MANIFEST_SHA" "$result" "$reconciliation" \
      "$chain_systemctl" "$chain_curl" "$chain_node" "$chain_env" \
      "$SANITIZED_ENV" "$first_host_sha"
  )"
  CHAIN_RECONCILIATION="$reconciliation"
  CHAIN_RISK="$(chain_value "$chain" risk)"
  CHAIN_PREVIEW="$(chain_value "$chain" preview)"
  CHAIN_RECORDER_ARGS=(
    --output "$result"
    --reconciliation-output "$reconciliation"
    --release "$RELEASE"
    --env "$SANITIZED_ENV"
    --authorization "$(chain_value "$chain" authorization)"
    --authorization-sha256 "$(chain_value "$chain" authorizationSha256)"
    --deployment-risk "$CHAIN_RISK"
    --action-preview "$CHAIN_PREVIEW"
    --authorization-consumption "$(chain_value "$chain" consumption)"
    --artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA"
    --curl "$chain_curl"
    --donor-exit-code 0
    --effect-start-evidence "$(chain_value "$chain" effectStart)"
    --effect-finish-evidence "$(chain_value "$chain" effectFinish)"
    --simulation-clock
    --now 2026-07-23T00:15:01Z
  )
  CHAIN_VALIDATOR_ARGS=(
    --input "$result"
    --reconciliation "$reconciliation"
    --kind RELEASE_SWITCH
    --expected-sha "$SHA"
    --expected-artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA"
    --expected-authorization-id "$(chain_value "$chain" authorizationId)"
    --expected-authorization-sha256 "$(chain_value "$chain" authorizationSha256)"
    --expected-risk-version "$(chain_value "$chain" riskVersion)"
    --expected-risk-document-sha256 "$(chain_value "$chain" riskSha256)"
    --expected-server-preview-digest "$(chain_value "$chain" serverPreviewDigest)"
    --expected-preview-document-sha256 "$(chain_value "$chain" previewSha256)"
    --expected-authorization-consumption-sha256 "$(chain_value "$chain" consumptionSha256)"
    --expected-authorization-claim-key "$(chain_value "$chain" claimKey)"
  )
  if [ "$first_host_sha" != NONE ]; then
    CHAIN_RECORDER_ARGS+=(
      --recovery-target NO_PRIOR_RELEASE_FIRST_HOST
      --first-host-evidence-sha256 "$first_host_sha"
    )
    CHAIN_VALIDATOR_ARGS+=(
      --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST
      --expected-first-host-evidence-sha256 "$first_host_sha"
    )
  fi
}

make_chain recorded "$RECORDED_RECEIPT" "$RECORDED_RECONCILIATION" "$FIRST_HOST_SHA"
note "DEPLOY-PORTABILITY-008: TEST app-unit proof is one exact closed group"
assert_success node --input-type=module - \
  "$I00_ROOT/deployment-authorization-contract.mjs" "$CHAIN_RISK" <<'NODE'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, riskPath] = process.argv.slice(2);
const { validateDeploymentRiskVersion } = await import(pathToFileURL(contractPath).href);
const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
validateDeploymentRiskVersion(risk);
for (const [prefix, value] of [
  ['app-unit-proof-absent-sentinel', '/tmp/not-the-absent-proof-sentinel'],
  ['app-unit-proof-drop-in-sha256', 'NONE'],
]) {
  const hostile = structuredClone(risk);
  const index = hostile.action.allowedEndpoints.findIndex(
    (entry) => entry.startsWith(`${prefix}:`),
  );
  if (index < 0) process.exit(1);
  hostile.action.allowedEndpoints[index] = `${prefix}:${value}`;
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
assert_not_file "$RECORDED_RECEIPT"
assert_not_file "$RECORDED_RECONCILIATION"
assert_failure_contains 'unexpected argument --check-only' \
  node "$RECORDER" --check-only yes --output "$RECORDED_RECEIPT"
assert_not_file "$RECORDED_RECEIPT"
assert_not_file "$RECORDED_RECONCILIATION"

RECORDED="$(
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
)"
assert_contains "$RECORDED" RELEASE_SWITCH_RECEIPTS_RECORDED
assert_file "$RECORDED_RECEIPT"
assert_file "$RECORDED_RECONCILIATION"
assert_eq "$(
  node -e '
    const fs = require("fs");
    process.stdout.write((fs.statSync(process.argv[1]).mode & 0o777).toString(8));
  ' "$RECORDED_RECEIPT"
)" 600
assert_success node "$VALIDATOR" "${CHAIN_VALIDATOR_ARGS[@]}"
RECORDED_VALIDATOR_ARGS=("${CHAIN_VALIDATOR_ARGS[@]}")
MISSING_EFFECT_RECEIPT="$TEST_TMP/missing-authorized-effect.json"
node --input-type=module - \
  "$I00_ROOT/deployment-authorization-contract.mjs" \
  "$RECORDED_RECEIPT" "$MISSING_EFFECT_RECEIPT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [contractPath, source, target] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(contractPath).href);
const receipt = JSON.parse(readFileSync(source));
delete receipt.authorizedEffect;
writeFileSync(target, canonicalJsonBytes(receipt), { mode: 0o600 });
NODE
MISSING_EFFECT_ARGS=("${RECORDED_VALIDATOR_ARGS[@]}")
for index in "${!MISSING_EFFECT_ARGS[@]}"; do
  if [ "${MISSING_EFFECT_ARGS[$index]}" = --input ]; then
    MISSING_EFFECT_ARGS[$((index + 1))]="$MISSING_EFFECT_RECEIPT"
  fi
done
assert_failure_contains 'authorizedEffect' \
  node "$VALIDATOR" "${MISSING_EFFECT_ARGS[@]}"

make_chain preexisting "$PREEXISTING_RECEIPT" \
  "$RECEIPT_PARENT/preexisting-marker.json" "$FIRST_HOST_SHA"
printf 'preserve-me\n' > "$PREEXISTING_RECEIPT"
chmod 600 "$PREEXISTING_RECEIPT"
assert_failure_contains '--output must be absent' node "$RECORDER" \
  "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_eq "$(cat "$PREEXISTING_RECEIPT")" preserve-me

RECON_TARGET_RESULT="$RECEIPT_PARENT/preexisting-marker-result.json"
make_chain preexisting-marker "$RECON_TARGET_RESULT" \
  "$PREEXISTING_RECONCILIATION" "$FIRST_HOST_SHA"
printf 'preserve-marker\n' > "$PREEXISTING_RECONCILIATION"
chmod 600 "$PREEXISTING_RECONCILIATION"
assert_failure_contains '--reconciliation-output must be absent' node "$RECORDER" \
  "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$RECON_TARGET_RESULT"
assert_eq "$(cat "$PREEXISTING_RECONCILIATION")" preserve-marker

INACTIVE_RECONCILIATION="$RECEIPT_PARENT/inactive-reconciliation.json"
SUBSTITUTED_RECEIPT="$RECEIPT_PARENT/substituted-systemctl.json"
SUBSTITUTED_RECONCILIATION="$RECEIPT_PARENT/substituted-systemctl-reconciliation.json"
make_chain substituted-systemctl "$SUBSTITUTED_RECEIPT" \
  "$SUBSTITUTED_RECONCILIATION" "$FIRST_HOST_SHA"
assert_failure_contains 'differs from the authorized preview binding' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$INACTIVE_SYSTEMCTL"
assert_not_file "$SUBSTITUTED_RECEIPT"
assert_not_file "$SUBSTITUTED_RECONCILIATION"
make_chain inactive "$INACTIVE_RECEIPT" "$INACTIVE_RECONCILIATION" \
  "$FIRST_HOST_SHA" "$INACTIVE_SYSTEMCTL" "$FAKE_CURL"
assert_not_file "$INACTIVE_RECEIPT"
assert_failure_contains 'application unit is not exactly active after the switch' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$INACTIVE_SYSTEMCTL"
assert_not_file "$INACTIVE_RECEIPT"
assert_not_file "$INACTIVE_RECONCILIATION"

FAILED_HEALTH_RECONCILIATION="$RECEIPT_PARENT/failed-health-reconciliation.json"
SUBSTITUTED_CURL_RECEIPT="$RECEIPT_PARENT/substituted-curl.json"
SUBSTITUTED_CURL_RECONCILIATION="$RECEIPT_PARENT/substituted-curl-reconciliation.json"
make_chain substituted-curl "$SUBSTITUTED_CURL_RECEIPT" \
  "$SUBSTITUTED_CURL_RECONCILIATION" "$FIRST_HOST_SHA"
SUBSTITUTED_CURL_COMMON=("${CHAIN_RECORDER_ARGS[@]}")
for index in "${!SUBSTITUTED_CURL_COMMON[@]}"; do
  if [ "${SUBSTITUTED_CURL_COMMON[$index]}" = --curl ]; then
    SUBSTITUTED_CURL_COMMON[$((index + 1))]="$FAILED_CURL"
  fi
done
assert_failure_contains 'differs from the authorized preview binding' \
  node "$RECORDER" "${SUBSTITUTED_CURL_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$SUBSTITUTED_CURL_RECEIPT"
assert_not_file "$SUBSTITUTED_CURL_RECONCILIATION"

SUBSTITUTED_NODE_RECEIPT="$RECEIPT_PARENT/substituted-node.json"
SUBSTITUTED_NODE_RECONCILIATION="$RECEIPT_PARENT/substituted-node-reconciliation.json"
make_chain substituted-node "$SUBSTITUTED_NODE_RECEIPT" \
  "$SUBSTITUTED_NODE_RECONCILIATION" "$FIRST_HOST_SHA" \
  "$FAKE_SYSTEMCTL" "$FAKE_CURL" "$FAKE_NODE_ENDPOINT"
assert_failure_contains 'differs from the authorized preview binding' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$SUBSTITUTED_NODE_RECEIPT"
assert_not_file "$SUBSTITUTED_NODE_RECONCILIATION"

make_chain failed-health "$FAILED_HEALTH_RECEIPT" \
  "$FAILED_HEALTH_RECONCILIATION" "$FIRST_HOST_SHA" "$FAKE_SYSTEMCTL" "$FAILED_CURL"
assert_not_file "$FAILED_HEALTH_RECEIPT"
FAILED_HEALTH_COMMON=("${CHAIN_RECORDER_ARGS[@]}")
assert_failure_contains 'Gate-5 loopback health failed' \
  node "$RECORDER" "${FAILED_HEALTH_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$FAILED_HEALTH_RECEIPT"
assert_not_file "$FAILED_HEALTH_RECONCILIATION"

FAILED_DONOR_RECONCILIATION="$RECEIPT_PARENT/failed-donor-reconciliation.json"
make_chain failed-donor "$FAILED_DONOR_RECEIPT" \
  "$FAILED_DONOR_RECONCILIATION" "$FIRST_HOST_SHA"
FAILED_DONOR_COMMON=("${CHAIN_RECORDER_ARGS[@]}")
for index in "${!FAILED_DONOR_COMMON[@]}"; do
  if [ "${FAILED_DONOR_COMMON[$index]}" = --donor-exit-code ]; then
    FAILED_DONOR_COMMON[$((index + 1))]=1
  fi
done
assert_not_file "$FAILED_DONOR_RECEIPT"
assert_failure_contains 'runner exit code differs from the authorized effect terminal' \
  node "$RECORDER" "${FAILED_DONOR_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$FAILED_DONOR_RECEIPT"
assert_not_file "$FAILED_DONOR_RECONCILIATION"

note "DEPLOY-PORTABILITY-008: Gate-5 binds and rechecks the exact sanitized donor env"
MISMATCH_ENV="$CANONICAL_TEST_TMP/sanitized-deploy-mismatch.env"
cp "$SANITIZED_ENV" "$MISMATCH_ENV"
printf "UNEXPECTED='bound-digest-mismatch'\n" >> "$MISMATCH_ENV"
chmod 600 "$MISMATCH_ENV"
MISMATCH_ENV_RECEIPT="$RECEIPT_PARENT/mismatched-env.json"
MISMATCH_ENV_RECONCILIATION="$RECEIPT_PARENT/mismatched-env-reconciliation.json"
make_chain mismatched-env "$MISMATCH_ENV_RECEIPT" \
  "$MISMATCH_ENV_RECONCILIATION" "$FIRST_HOST_SHA"
MISMATCH_ENV_ARGS=("${CHAIN_RECORDER_ARGS[@]}")
for index in "${!MISMATCH_ENV_ARGS[@]}"; do
  if [ "${MISMATCH_ENV_ARGS[$index]}" = --env ]; then
    MISMATCH_ENV_ARGS[$((index + 1))]="$MISMATCH_ENV"
  fi
done
assert_failure_contains '--env digest differs from the consumed preview' \
  node "$RECORDER" "${MISMATCH_ENV_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$MISMATCH_ENV_RECEIPT"
assert_not_file "$MISMATCH_ENV_RECONCILIATION"

MUTATING_ENV_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-mutating-donor-env"
cat > "$MUTATING_ENV_SYSTEMCTL" <<SH
#!/usr/bin/env bash
[ "\$#" -eq 2 ] && [ "\$1" = is-active ] && [ "\$2" = cosmos-app.service ] || exit 9
/bin/cp "$SANITIZED_ENV" "$SANITIZED_ENV.next"
/bin/chmod 600 "$SANITIZED_ENV.next"
/bin/mv -f "$SANITIZED_ENV.next" "$SANITIZED_ENV"
printf 'active\\n'
SH
chmod 500 "$MUTATING_ENV_SYSTEMCTL"
MUTATING_ENV_RECEIPT="$RECEIPT_PARENT/mutating-env.json"
MUTATING_ENV_RECONCILIATION="$RECEIPT_PARENT/mutating-env-reconciliation.json"
make_chain mutating-env "$MUTATING_ENV_RECEIPT" \
  "$MUTATING_ENV_RECONCILIATION" "$FIRST_HOST_SHA" \
  "$MUTATING_ENV_SYSTEMCTL" "$FAKE_CURL"
assert_failure_contains '--env changed before Gate-5 receipt publication' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$MUTATING_ENV_SYSTEMCTL"
assert_not_file "$MUTATING_ENV_RECEIPT"
assert_not_file "$MUTATING_ENV_RECONCILIATION"

note "DEPLOY-PORTABILITY-008: Gate-5 executable identity changes fail closed"
MUTATING_EXEC_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-self-replacing"
cat > "$MUTATING_EXEC_SYSTEMCTL" <<'SH'
#!/usr/bin/env bash
[ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = cosmos-app.service ] || exit 9
/bin/cp "$0" "$0.next"
/bin/chmod 500 "$0.next"
/bin/mv -f "$0.next" "$0"
printf 'active\n'
SH
chmod 500 "$MUTATING_EXEC_SYSTEMCTL"
MUTATING_EXEC_SYSTEMCTL_RECEIPT="$RECEIPT_PARENT/mutating-systemctl.json"
MUTATING_EXEC_SYSTEMCTL_RECONCILIATION="$RECEIPT_PARENT/mutating-systemctl-reconciliation.json"
make_chain mutating-systemctl "$MUTATING_EXEC_SYSTEMCTL_RECEIPT" \
  "$MUTATING_EXEC_SYSTEMCTL_RECONCILIATION" "$FIRST_HOST_SHA" \
  "$MUTATING_EXEC_SYSTEMCTL" "$FAKE_CURL"
assert_failure_contains 'executable changed around Gate-5 use' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$MUTATING_EXEC_SYSTEMCTL"
assert_not_file "$MUTATING_EXEC_SYSTEMCTL_RECEIPT"
assert_not_file "$MUTATING_EXEC_SYSTEMCTL_RECONCILIATION"

MUTATING_EXEC_CURL="$CANONICAL_TEST_TMP/curl-self-replacing"
cat > "$MUTATING_EXEC_CURL" <<'SH'
#!/usr/bin/env bash
/bin/cp "$0" "$0.next"
/bin/chmod 500 "$0.next"
/bin/mv -f "$0.next" "$0"
printf '200'
SH
chmod 500 "$MUTATING_EXEC_CURL"
MUTATING_EXEC_CURL_RECEIPT="$RECEIPT_PARENT/mutating-curl.json"
MUTATING_EXEC_CURL_RECONCILIATION="$RECEIPT_PARENT/mutating-curl-reconciliation.json"
make_chain mutating-curl "$MUTATING_EXEC_CURL_RECEIPT" \
  "$MUTATING_EXEC_CURL_RECONCILIATION" "$FIRST_HOST_SHA" \
  "$FAKE_SYSTEMCTL" "$MUTATING_EXEC_CURL"
assert_failure_contains 'executable changed around Gate-5 use' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$MUTATING_EXEC_CURL_RECEIPT"
assert_not_file "$MUTATING_EXEC_CURL_RECONCILIATION"

note "DEPLOY-DEFECTS-007(2): competing output and link races fail without collateral deletion"
COMPETING_RECONCILIATION="$RECEIPT_PARENT/competing-reconciliation.json"
COMPETING_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-competing-output"
cat > "$COMPETING_SYSTEMCTL" <<SH
#!/usr/bin/env bash
[ "\$#" -eq 2 ] && [ "\$1" = is-active ] && [ "\$2" = cosmos-app.service ] || exit 9
printf 'competitor\\n' > "$COMPETING_RECEIPT"
chmod 600 "$COMPETING_RECEIPT"
printf 'active\\n'
SH
chmod 500 "$COMPETING_SYSTEMCTL"
make_chain competing "$COMPETING_RECEIPT" \
  "$COMPETING_RECONCILIATION" "$FIRST_HOST_SHA" "$COMPETING_SYSTEMCTL" "$FAKE_CURL"
assert_not_file "$COMPETING_RECEIPT"
assert_failure_contains '--output exact-create failed' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$COMPETING_SYSTEMCTL"
assert_eq "$(cat "$COMPETING_RECEIPT")" competitor
assert_not_file "$COMPETING_RECONCILIATION"

PARENT_SWAP_PROOF_ROOT="$CANONICAL_TEST_TMP/ip-ops-i00-sim-release-parent-swap"
node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$PARENT_SWAP_PROOF_ROOT" >/dev/null
PARENT_SWAP_ROOT="$PARENT_SWAP_PROOF_ROOT/receipts"
PARENT_SWAP_DISPLACED="$PARENT_SWAP_PROOF_ROOT/receipts.displaced"
mkdir "$PARENT_SWAP_ROOT"
chmod 700 "$PARENT_SWAP_ROOT"
PARENT_SWAP_RECEIPT="$PARENT_SWAP_ROOT/result.json"
PARENT_SWAP_RECONCILIATION="$PARENT_SWAP_ROOT/reconciliation.json"
PARENT_SWAP_HOOK="$CANONICAL_TEST_TMP/receipt-parent-swap-hook.mjs"
cat > "$PARENT_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const target = process.env.DF32_RECEIPT_PARENT_SWAP_TARGET;
const displaced = process.env.DF32_RECEIPT_PARENT_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
const originalRealpathSync = fs.realpathSync;
let parentDescriptor;
let swapped = false;
const swap = () => {
  if (swapped) return;
  swapped = true;
  fs.renameSync(target, displaced);
  fs.mkdirSync(target, { mode: 0o700 });
};
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  if (process.platform !== 'linux' && parentDescriptor !== undefined
      && typeof path === 'string' && path.startsWith(`${target}/`)
      && (Number(flags) & fs.constants.O_CREAT) !== 0) {
    swap();
  }
  const descriptor = originalOpenSync.call(this, path, flags, ...rest);
  if (path === target
      && (Number(flags) & (fs.constants.O_DIRECTORY ?? 0)) !== 0) {
    parentDescriptor = descriptor;
  }
  return descriptor;
};
fs.realpathSync = function guardedRealpathSync(path, ...rest) {
  const value = originalRealpathSync.call(this, path, ...rest);
  if (process.platform === 'linux' && parentDescriptor !== undefined
      && path === `/proc/self/fd/${parentDescriptor}`) {
    swap();
  }
  return value;
};
syncBuiltinESMExports();
NODE
chmod 600 "$PARENT_SWAP_HOOK"
make_chain parent-swap "$PARENT_SWAP_RECEIPT" \
  "$PARENT_SWAP_RECONCILIATION" "$FIRST_HOST_SHA" "$FAKE_SYSTEMCTL" "$FAKE_CURL" \
  "$REAL_NODE" "$REAL_ENV" "$PARENT_SWAP_PROOF_ROOT"
assert_failure_contains '--output exact-create failed' \
  env DF32_RECEIPT_PARENT_SWAP_TARGET="$PARENT_SWAP_ROOT" \
    DF32_RECEIPT_PARENT_SWAP_DISPLACED="$PARENT_SWAP_DISPLACED" \
    node --import "$PARENT_SWAP_HOOK" "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" \
      --systemctl "$FAKE_SYSTEMCTL"
if [ "$(uname -s)" = Linux ]; then
  assert_eq "$(find "$PARENT_SWAP_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
  assert_eq "$(find "$PARENT_SWAP_DISPLACED" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1
else
  assert_eq "$(find "$PARENT_SWAP_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1
  assert_eq "$(find "$PARENT_SWAP_DISPLACED" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
fi

ALTERNATE_RELEASE="$RELEASES_DIR/i00-$PRIOR_SHA"
PRIOR_SOURCE_RELEASE="$(assemble_fixture_release "$TARGET_ROOT/prior-source-artifact" "$PRIOR_SHA")"
normalize_fixture_release_modes "$PRIOR_SOURCE_RELEASE"
cp -R "$PRIOR_SOURCE_RELEASE" "$ALTERNATE_RELEASE"
chmod -R a-w "$ALTERNATE_RELEASE"
MUTATING_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-mutating-link"
cat > "$MUTATING_SYSTEMCTL" <<SH
#!/usr/bin/env bash
[ "\$#" -eq 2 ] && [ "\$1" = is-active ] && [ "\$2" = cosmos-app.service ] || exit 9
rm -f "$CURRENT_LINK"
ln -s "$ALTERNATE_RELEASE" "$CURRENT_LINK"
printf 'active\\n'
SH
chmod 500 "$MUTATING_SYSTEMCTL"
MUTATED_LINK_RECONCILIATION="$RECEIPT_PARENT/mutated-link-reconciliation.json"
make_chain mutated-link "$MUTATED_LINK_RECEIPT" \
  "$MUTATED_LINK_RECONCILIATION" "$FIRST_HOST_SHA" "$MUTATING_SYSTEMCTL" "$FAKE_CURL"
assert_not_file "$MUTATED_LINK_RECEIPT"
assert_failure_contains 'CURRENT_LINK target differs from the exact release' \
  node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$MUTATING_SYSTEMCTL"
assert_not_file "$MUTATED_LINK_RECEIPT"
assert_not_file "$MUTATED_LINK_RECONCILIATION"
assert_eq "$(readlink "$CURRENT_LINK")" "$ALTERNATE_RELEASE"
rm "$CURRENT_LINK"
ln -s "$INSTALLED_RELEASE" "$CURRENT_LINK"

note "DEPLOY-DEFECTS-007(2): later releases preserve one distinct direct rollback target"
ln -s "$ALTERNATE_RELEASE" "$PREVIOUS_LINK"
LATER_RECONCILIATION="$RECEIPT_PARENT/later-reconciliation.json"
make_chain later "$LATER_RECEIPT" "$LATER_RECONCILIATION"
assert_success node "$RECORDER" "${CHAIN_RECORDER_ARGS[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_success node "$VALIDATOR" "${CHAIN_VALIDATOR_ARGS[@]}"
LATER_VALIDATOR_ARGS=("${CHAIN_VALIDATOR_ARGS[@]}")
assert_failure node "$VALIDATOR" "${CHAIN_VALIDATOR_ARGS[@]}" \
  --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
  --expected-first-host-evidence-sha256 "$FIRST_HOST_SHA"

note "DEPLOY-DEFECTS-007(2): receipt chronology, nesting, and rollback identity are closed"
for mutation in previous-current previous-outside impossible-time reversed-time nested-extra noncanonical-link; do
  node - "$LATER_RECEIPT" "$TEST_TMP/$mutation.json" "$mutation" <<'NODE'
const fs = require('fs');
const [source, target, mutation] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
if (mutation === 'previous-current') receipt.previous.target = receipt.current.target;
else if (mutation === 'previous-outside') receipt.previous.target = `/tmp/i00-${'d'.repeat(40)}`;
else if (mutation === 'impossible-time') receipt.startedAtUtc = '2026-02-30T00:00:00Z';
else if (mutation === 'reversed-time') receipt.startedAtUtc = '2026-07-23T00:15:02Z';
else if (mutation === 'nested-extra') receipt.service.unexpected = true;
else if (mutation === 'noncanonical-link') receipt.current.link = receipt.current.link.replace('/current', '//current');
fs.writeFileSync(target, `${JSON.stringify(receipt)}\n`);
NODE
  MUTATION_VALIDATOR_ARGS=("${LATER_VALIDATOR_ARGS[@]}")
  for index in "${!MUTATION_VALIDATOR_ARGS[@]}"; do
    if [ "${MUTATION_VALIDATOR_ARGS[$index]}" = --input ]; then
      MUTATION_VALIDATOR_ARGS[$((index + 1))]="$TEST_TMP/$mutation.json"
    fi
  done
  assert_failure node "$VALIDATOR" "${MUTATION_VALIDATOR_ARGS[@]}"
done

note "DEPLOY-DEFECTS-007(2): later-gate facts are forbidden at Gate 5"
for field in cloudflareBoundary watchdog backup restore reconciliation; do
  node - "$RECORDED_RECEIPT" "$TEST_TMP/with-$field.json" "$field" <<'NODE'
const fs = require('fs');
const [source, target, field] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
receipt[field] = { status: 'NOT_A_GATE_5_FACT' };
fs.writeFileSync(target, JSON.stringify(receipt));
NODE
  MUTATION_VALIDATOR_ARGS=("${RECORDED_VALIDATOR_ARGS[@]}")
  for index in "${!MUTATION_VALIDATOR_ARGS[@]}"; do
    if [ "${MUTATION_VALIDATOR_ARGS[$index]}" = --input ]; then
      MUTATION_VALIDATOR_ARGS[$((index + 1))]="$TEST_TMP/with-$field.json"
    fi
  done
  assert_failure node "$VALIDATOR" "${MUTATION_VALIDATOR_ARGS[@]}"
done

note "DEPLOY-PORTABILITY-008: the Gate-5 reconciliation is the preview-bound commit marker"
assert_failure node "$VALIDATOR" "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$TEST_TMP/missing-reconciliation.json}"
assert_failure node "$VALIDATOR" "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$LATER_RECONCILIATION}"
assert_failure_contains 'canonical non-root absolute path' \
  node "$VALIDATOR" \
  "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/reconciliation.json}"
assert_failure_contains 'canonical non-root absolute path' \
  node "$VALIDATOR" \
  "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$RECEIPT_PARENT/./first-host-reconciliation.json}"
RECONCILIATION_LEAF_ALIAS="$TEST_TMP/reconciliation-leaf-alias.json"
ln -s "$RECORDED_RECONCILIATION" "$RECONCILIATION_LEAF_ALIAS"
assert_failure_contains 'single-link regular file' \
  node "$VALIDATOR" \
  "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$RECONCILIATION_LEAF_ALIAS}"
RECONCILIATION_REAL_PARENT="$TEST_TMP/reconciliation-real-parent"
RECONCILIATION_PARENT_ALIAS="$TEST_TMP/reconciliation-parent-alias"
mkdir "$RECONCILIATION_REAL_PARENT"
cp "$RECORDED_RECONCILIATION" \
  "$RECONCILIATION_REAL_PARENT/reconciliation.json"
ln -s "$RECONCILIATION_REAL_PARENT" "$RECONCILIATION_PARENT_ALIAS"
assert_failure_contains 'physically canonical' \
  node "$VALIDATOR" \
  "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$RECONCILIATION_PARENT_ALIAS/reconciliation.json}"
RECONCILIATION_HARDLINK="$TEST_TMP/reconciliation-hardlink.json"
RECONCILIATION_HARDLINK_SECOND="$TEST_TMP/reconciliation-hardlink-second.json"
cp "$RECORDED_RECONCILIATION" "$RECONCILIATION_HARDLINK"
ln "$RECONCILIATION_HARDLINK" "$RECONCILIATION_HARDLINK_SECOND"
assert_failure_contains 'single-link regular file' \
  node "$VALIDATOR" \
  "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$RECONCILIATION_HARDLINK}"
RECONCILIATION_SWAP_REPLACEMENT="$TEST_TMP/reconciliation-swap-replacement.json"
RECONCILIATION_SWAP_DISPLACED="$TEST_TMP/reconciliation-swap-displaced.json"
RECONCILIATION_SWAP_HOOK="$TEST_TMP/reconciliation-swap-hook.mjs"
cp "$RECORDED_RECONCILIATION" "$RECONCILIATION_SWAP_REPLACEMENT"
cat >"$RECONCILIATION_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const target = process.env.DF32_RECONCILIATION_SWAP_TARGET;
const replacement = process.env.DF32_RECONCILIATION_SWAP_REPLACEMENT;
const displaced = process.env.DF32_RECONCILIATION_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  if (!swapped && path === target) {
    swapped = true;
    fs.renameSync(target, displaced);
    fs.renameSync(replacement, target);
  }
  return originalOpenSync.call(this, path, flags, ...rest);
};
syncBuiltinESMExports();
NODE
assert_failure_contains 'identity changed before descriptor read' \
  env DF32_RECONCILIATION_SWAP_TARGET="$RECORDED_RECONCILIATION" \
    DF32_RECONCILIATION_SWAP_REPLACEMENT="$RECONCILIATION_SWAP_REPLACEMENT" \
    DF32_RECONCILIATION_SWAP_DISPLACED="$RECONCILIATION_SWAP_DISPLACED" \
    node --import "$RECONCILIATION_SWAP_HOOK" \
    "$VALIDATOR" "${RECORDED_VALIDATOR_ARGS[@]}"
mv "$RECORDED_RECONCILIATION" "$RECONCILIATION_SWAP_REPLACEMENT"
mv "$RECONCILIATION_SWAP_DISPLACED" "$RECORDED_RECONCILIATION"
TAMPERED_RECONCILIATION="$TEST_TMP/tampered-reconciliation.json"
node - "$RECORDED_RECONCILIATION" "$TAMPERED_RECONCILIATION" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
receipt.resultReceiptSha256 = '0'.repeat(64);
fs.writeFileSync(target, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
NODE
assert_failure node "$VALIDATOR" "${RECORDED_VALIDATOR_ARGS[@]/$RECORDED_RECONCILIATION/$TAMPERED_RECONCILIATION}"
assert_contains "$(cat "$RECORDER")" 'fsyncSync(parentFd)'
assert_contains "$(cat "$RECORDER")" 'GATE_5_RELEASE_SWITCH_PROVED_LATER_GATES_PENDING'

note "DEPLOY-DEFECTS-007(2): final deployment still retains every later fact"
DEPLOYMENT_SCHEMA="$(cat "$I00_ROOT/schemas/deployment-receipt.schema.json")"
for field in cloudflareBoundary watchdog backup restore reconciliation; do
  assert_contains "$DEPLOYMENT_SCHEMA" "\"$field\""
done

finish
