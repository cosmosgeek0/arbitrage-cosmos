#!/usr/bin/env bash
# Installs the hashed I00 helper bundle from an already validated release.
# It does not install units, restart services, or contact any external system.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
RELEASE="" DESTINATION="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT="" TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT="" SIMULATION=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --destination) DESTINATION="${2:?--destination needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
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
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --allow-simulation >/dev/null
else
  [ -n "$AUTHORIZATION" ] && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
    || { printf 'I00_OPS_BLOCKED: real install requires exact authorization, account, host, environment, and receipt targets\n' >&2; exit 1; }
  CANDIDATE_SHA="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.testedSha)' "$RELEASE/release.json")"
  MANIFEST_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE/artifact-manifest.json")"
  TRUSTED_BUILD_KEY_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}")"
  AUTH_BASE=(--input "$AUTHORIZATION" --class OPS_BUNDLE_INSTALL --command install-ops-bundle --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-ops-bundle-install --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 ops bundle" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission filesystem:InstallImmutableOpsBundle --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "install one exact immutable ops bundle without service mutation")
  for endpoint in "release-sha:$CANDIDATE_SHA" "artifact-manifest-sha256:$MANIFEST_SHA" "trusted-builder-public-key-sha256:$TRUSTED_BUILD_KEY_SHA" "destination:$(cd "$(dirname "$DESTINATION")" && pwd -P)/$(basename "$DESTINATION")"; do
    node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-endpoint "$endpoint" >/dev/null
  done
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" >/dev/null
fi

node "$SCRIPT_DIR/verify-donor.mjs" --contract "$RELEASE/ops/i00/donor-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$RELEASE/ops/i00/donor-contract.json" --root "$RELEASE/ops/live" >/dev/null
[ ! -e "$DESTINATION" ] || { printf 'I00_OPS_BLOCKED: destination already exists; replacement requires a new reviewed release procedure\n' >&2; exit 1; }
mkdir -p "$(dirname "$DESTINATION")"
STAGING="$DESTINATION.partial.$$"
trap 'rm -rf "$STAGING"' EXIT
cp -R "$RELEASE/ops/i00" "$STAGING"
mkdir "$STAGING/accepted-ops-live"
cp -R "$RELEASE/ops/live/." "$STAGING/accepted-ops-live/"
node "$STAGING/bin/verify-donor.mjs" --contract "$STAGING/donor-contract.json" --contract-only >/dev/null
node "$STAGING/bin/verify-donor-root.mjs" --contract "$STAGING/donor-contract.json" --root "$STAGING/accepted-ops-live" >/dev/null
node --input-type=module -e '
  import {writeFileSync} from "node:fs";
  import {resolve} from "node:path";
  const [lib, root, releaseJson] = process.argv.slice(1);
  const {treeDigest} = await import(new URL(`file://${resolve(lib)}`));
  const release = JSON.parse(await (await import("node:fs/promises")).readFile(releaseJson, "utf8"));
  writeFileSync(resolve(root, "install-receipt.json"), JSON.stringify({
    schemaVersion: 1,
    testedSha: release.testedSha,
    sourceReleaseId: release.releaseId,
    installedTreeDigestSha256: treeDigest(root),
    acceptedDonorRoot: "accepted-ops-live",
    acceptedDonorCommit: "2cec412927fa2f64f05a0b2774b18e45f8ce4fa5",
    serviceMutationPerformed: false
  }, null, 2) + "\n", {mode: 0o600});
' "$RELEASE/ops/i00/lib.mjs" "$STAGING" "$RELEASE/release.json"
chmod -R a-w "$STAGING"
mv "$STAGING" "$DESTINATION"
trap - EXIT
printf '{"status":"OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION","destination":"%s"}\n' "$DESTINATION"
