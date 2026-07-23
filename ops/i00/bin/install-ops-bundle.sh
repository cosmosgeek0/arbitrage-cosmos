#!/usr/bin/env bash
# Installs the hashed I00 helper bundle from an already validated release.
# It does not install units, restart services, or contact any external system.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
I00_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
RELEASE="" DESTINATION="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT="" TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT="" SIMULATION=0
OPERATOR="" CONFIG_VERSION="" RISK_VERSION="" AUTHORIZATION_NONCE="" SERVER_PREVIEW_DIGEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --destination) DESTINATION="${2:?--destination needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --operator) OPERATOR="${2:?--operator needs a value}"; shift 2 ;;
    --config-version) CONFIG_VERSION="${2:?--config-version needs a value}"; shift 2 ;;
    --risk-version) RISK_VERSION="${2:?--risk-version needs a value}"; shift 2 ;;
    --authorization-nonce) AUTHORIZATION_NONCE="${2:?--authorization-nonce needs a value}"; shift 2 ;;
    --server-preview-digest) SERVER_PREVIEW_DIGEST="${2:?--server-preview-digest needs a value}"; shift 2 ;;
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
[ -n "$RELEASE" ] && [ -n "$DESTINATION" ] \
  || { printf 'I00_OPS_BLOCKED: --release and --destination are required\n' >&2; exit 1; }

if [ "$SIMULATION" = 1 ]; then
  [ -n "$SIMULATION_ROOT" ] || { printf 'I00_OPS_BLOCKED: simulation requires --simulation-root\n' >&2; exit 1; }
  ROOT_CANON="$(node "$SCRIPT_DIR/validate-simulation-root.mjs" --root "$SIMULATION_ROOT")"
  DEST_PARENT="$(node -e 'const fs=require("fs"),p=require("path");let v=p.resolve(process.argv[1]);while(!fs.existsSync(v))v=p.dirname(v);process.stdout.write(fs.realpathSync(v))' "$DESTINATION")"
  case "$DEST_PARENT" in "$ROOT_CANON"|"$ROOT_CANON"/*) : ;; *) printf 'I00_OPS_BLOCKED: simulation destination is outside fake root\n' >&2; exit 1 ;; esac
  VALIDATION_JSON="$(node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --allow-simulation)"
else
  [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] && [ -n "$RISK_VERSION" ] \
    && [ -n "$AUTHORIZATION_NONCE" ] && [ -n "$SERVER_PREVIEW_DIGEST" ] && [ -n "$TARGET_HOST" ] \
    && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
    || { printf 'I00_OPS_BLOCKED: real install requires exact independent authorization expectations and target/receipt identity\n' >&2; exit 1; }
  VALIDATION_JSON="$(node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE")"
  CANDIDATE_SHA="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.testedSha)' "$VALIDATION_JSON")"
  MANIFEST_SHA="$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.artifactManifestSha256)' "$VALIDATION_JSON")"
  TRUSTED_BUILD_KEY_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}")"
  AUTH_BASE=(--input "$AUTHORIZATION" --class OPS_BUNDLE_INSTALL --command install-ops-bundle --expected-operator "$OPERATOR" --expected-deployed-sha "$CANDIDATE_SHA" --expected-config-version "$CONFIG_VERSION" --expected-risk-version "$RISK_VERSION" --expected-nonce "$AUTHORIZATION_NONCE" --expected-server-preview-digest "$SERVER_PREVIEW_DIGEST" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-ops-bundle-install --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 ops bundle" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission filesystem:InstallImmutableOpsBundle --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "install one exact immutable ops bundle without service mutation")
  node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" \
    --expected-endpoint "release-sha:$CANDIDATE_SHA" \
    --expected-endpoint "artifact-manifest-sha256:$MANIFEST_SHA" \
    --expected-endpoint "trusted-builder-public-key-sha256:$TRUSTED_BUILD_KEY_SHA" \
    --expected-endpoint "destination:$(cd "$(dirname "$DESTINATION")" && pwd -P)/$(basename "$DESTINATION")" >/dev/null
fi

EXPECTED_I00_ENFORCEMENT_DIGEST="$(node --input-type=module -e '
  import {resolve} from "node:path";
  const [lib,root]=process.argv.slice(1);
  const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
  process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
' "$I00_ROOT/lib.mjs" "$I00_ROOT")"
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$RELEASE/ops/i00/donor-contract.json" \
  --amendment-contract "$RELEASE/ops/i00/l15-amendment-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$RELEASE/ops/i00/donor-contract.json" \
  --amendment-contract "$RELEASE/ops/i00/l15-amendment-contract.json" \
  --root "$RELEASE/ops/live" >/dev/null
[ ! -e "$DESTINATION" ] || { printf 'I00_OPS_BLOCKED: destination already exists; replacement requires a new reviewed release procedure\n' >&2; exit 1; }
mkdir -p "$(dirname "$DESTINATION")"
STAGING="$DESTINATION.partial.$$"
if ! (umask 077; mkdir "$STAGING") 2>/dev/null; then
  printf 'I00_OPS_BLOCKED: could not claim private staging directory\n' >&2
  exit 1
fi
trap 'rm -rf "$STAGING"' EXIT
cp -R "$RELEASE/ops/i00/." "$STAGING/"
if [ ! -d "$STAGING" ] || [ -L "$STAGING" ]; then
  printf 'I00_OPS_BLOCKED: private staging root became unsafe\n' >&2
  exit 1
fi
for reserved in accepted-ops-live install-receipt.json; do
  if [ -e "$STAGING/$reserved" ] || [ -L "$STAGING/$reserved" ]; then
    printf 'I00_OPS_BLOCKED: staged I00 contains reserved installed-bundle path %s\n' "$reserved" >&2
    exit 1
  fi
done
mkdir "$STAGING/accepted-ops-live"
cp -R "$RELEASE/ops/live/." "$STAGING/accepted-ops-live/"
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$STAGING/donor-contract.json" \
  --amendment-contract "$STAGING/l15-amendment-contract.json" --contract-only >/dev/null
STAGED_L15_VERIFICATION="$(node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$STAGING/donor-contract.json" \
  --amendment-contract "$STAGING/l15-amendment-contract.json" \
  --root "$STAGING/accepted-ops-live")"
STAGED_I00_ENFORCEMENT_DIGEST="$(node --input-type=module -e '
  import {resolve} from "node:path";
  const [lib,root]=process.argv.slice(1);
  const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
  process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
' "$I00_ROOT/lib.mjs" "$STAGING")"
[ "$STAGED_I00_ENFORCEMENT_DIGEST" = "$EXPECTED_I00_ENFORCEMENT_DIGEST" ] \
  || { printf 'I00_OPS_BLOCKED: staged I00 enforcement cohort differs from validated release\n' >&2; exit 1; }
node --input-type=module -e '
  import {writeFileSync} from "node:fs";
  import {resolve} from "node:path";
  const [lib,root,validationJson,l15Json,i00Digest] = process.argv.slice(1);
  const {treeDigest} = await import(new URL(`file://${resolve(lib)}`));
  const validation=JSON.parse(validationJson);
  const l15=JSON.parse(l15Json);
  writeFileSync(resolve(root, "install-receipt.json"), JSON.stringify({
    schemaVersion: 2,
    testedSha: validation.testedSha,
    sourceReleaseId: validation.releaseId,
    installedTreeDigestSha256: treeDigest(root),
    effectiveOpsRoot: "accepted-ops-live",
    immutableDonorCommit: l15.immutableDonorCommit,
    immutableDonorLiveTree: l15.immutableDonorLiveTree,
    immutableDonorContractSha256: l15.immutableDonorContractSha256,
    amendmentContractSha256: l15.amendmentContractSha256,
    effectiveLiveTree: l15.effectiveLiveTree,
    effectiveRootDigestSha256: l15.effectiveRootDigestSha256,
    i00EnforcementTreeDigestSha256: i00Digest,
    authorizedCorrectionFindingIds: l15.findingIds,
    serviceMutationPerformed: false
  }, null, 2) + "\n", {mode: 0o600});
' "$I00_ROOT/lib.mjs" "$STAGING" "$VALIDATION_JSON" \
  "$STAGED_L15_VERIFICATION" "$EXPECTED_I00_ENFORCEMENT_DIGEST"
chmod -R a-w "$STAGING"
# DEPLOY-DEFECTS-007: the private staging claim starts at 0700, so removing
# every write bit would otherwise leave the installed root at 0500. Services
# execute known immutable paths below this root; grant search only, never list
# or write access. The invoking root owner and every frozen child stay
# unchanged, and the immutable verifiers run again below.
chmod go+x "$STAGING"
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$STAGING/donor-contract.json" \
  --amendment-contract "$STAGING/l15-amendment-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$STAGING/donor-contract.json" \
  --amendment-contract "$STAGING/l15-amendment-contract.json" \
  --root "$STAGING/accepted-ops-live" --require-immutable >/dev/null
FROZEN_I00_ENFORCEMENT_DIGEST="$(node --input-type=module -e '
  import {resolve} from "node:path";
  const [lib,root]=process.argv.slice(1);
  const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
  process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
' "$I00_ROOT/lib.mjs" "$STAGING")"
[ "$FROZEN_I00_ENFORCEMENT_DIGEST" = "$EXPECTED_I00_ENFORCEMENT_DIGEST" ] \
  || { printf 'I00_OPS_BLOCKED: frozen I00 enforcement cohort differs from validated release\n' >&2; exit 1; }
mv "$STAGING" "$DESTINATION"
trap - EXIT
printf '{"status":"OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION","destination":"%s"}\n' "$DESTINATION"
