#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/i00/helpers.sh"

note "assemble one real simulation I00 release for the focused package bridge"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
TREE="$(git -C "$REPO_ROOT" rev-parse HEAD^{tree})"
SOURCE="$TEST_TMP/source"
DEPS="$TEST_TMP/deps"
TESTED="$TEST_TMP/tested.json"
I00_OUTPUT="$TEST_TMP/i00-output"
make_release_inputs "$SOURCE" "$DEPS" "$SHA" "$TESTED"
ASSEMBLY_RECEIPT="$(
  node "$I00_ROOT/bin/assemble-release.mjs" \
    --source-root "$SOURCE" \
    --runtime-deps "$DEPS" \
    --output-root "$I00_OUTPUT" \
    --tested-sha "$SHA" \
    --tested-receipt "$TESTED" \
    --built-at-utc 2026-07-30T00:00:00Z \
    --config-revision focused-package-bridge \
    --model-revision UNAVAILABLE \
    --simulation-source
)"
RELEASE="$I00_OUTPUT/i00-$SHA"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$ASSEMBLY_RECEIPT")" \
  RELEASE_ASSEMBLED_NOT_DEPLOYED
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).releaseId)' "$ASSEMBLY_RECEIPT")" \
  "i00-$SHA"

BUILD="$REPO_ROOT/ops/release-package/bin/build-i00-release-package.mjs"
PREFLIGHT="$REPO_ROOT/ops/release-package/bin/preflight-i00-release-package.mjs"
OUT_A="$TEST_TMP/package-a"
OUT_B="$TEST_TMP/package-b"
mkdir -m 0700 "$OUT_A" "$OUT_B"

RELEASE_JSON_BEFORE="$(shasum -a 256 "$RELEASE/release.json" | awk '{print $1}')"
ARTIFACT_BEFORE="$(shasum -a 256 "$RELEASE/artifact-manifest.json" | awk '{print $1}')"
TREE_BEFORE="$(
  node --input-type=module - "$REPO_ROOT/ops/release-package/lib/release-package.mjs" "$RELEASE" <<'NODE'
import { pathToFileURL } from 'node:url';
const { listTypedTree, typedTreeDigest } = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(typedTreeDigest(listTypedTree(process.argv[3])));
NODE
)"

note "build two byte-identical I00 packages from the same assembled release"
BUILD_A="$(
  umask 077
  node "$BUILD" \
    --source-root "$REPO_ROOT" \
    --input-sha "$SHA" \
    --release-root "$RELEASE" \
    --output-root "$OUT_A" \
    --target-arch x64 \
    --service-user cosmos \
    --service-group cosmos \
    --allow-simulation
)"
BUILD_B="$(
  umask 027
  node "$BUILD" \
    --source-root "$REPO_ROOT" \
    --input-sha "$SHA" \
    --release-root "$RELEASE" \
    --output-root "$OUT_B" \
    --target-arch x64 \
    --service-user cosmos \
    --service-group cosmos \
    --allow-simulation
)"
for receipt in "$BUILD_A" "$BUILD_B"; do
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$receipt")" \
    SIMULATION_I00_RELEASE_PACKAGE_BUILT_NOT_INSTALLABLE
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).validatorCohortMode)' "$receipt")" \
    EXACT_TRUSTED_COHORT
done
for suffix in tar manifest.json sha256; do
  assert_success cmp -s "$OUT_A/i00-$SHA.$suffix" "$OUT_B/i00-$SHA.$suffix"
done

note "preflight privately reconstructs and revalidates both direct I00 package roots"
for output in "$OUT_A" "$OUT_B"; do
  RECEIPT="$(
    node "$PREFLIGHT" \
      --archive "$output/i00-$SHA.tar" \
      --manifest "$output/i00-$SHA.manifest.json" \
      --digest "$output/i00-$SHA.sha256" \
      --expected-input-sha "$SHA" \
      --expected-target-arch x64 \
      --expected-service-user cosmos \
      --expected-service-group cosmos \
      --allow-simulation
  )"
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$RECEIPT")" \
    SIMULATION_I00_RELEASE_PACKAGE_PREFLIGHT_PASS_NO_TARGET_MUTATION
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).privateReconstruction)' "$RECEIPT")" \
    CLEANED
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).validatorCohortMode)' "$RECEIPT")" \
    EXACT_TRUSTED_COHORT
done

note "bridge preserved original I00 bytes, modes, and exact source package inputs"
assert_eq "$(shasum -a 256 "$RELEASE/release.json" | awk '{print $1}')" "$RELEASE_JSON_BEFORE"
assert_eq "$(shasum -a 256 "$RELEASE/artifact-manifest.json" | awk '{print $1}')" "$ARTIFACT_BEFORE"
TREE_AFTER="$(
  node --input-type=module - "$REPO_ROOT/ops/release-package/lib/release-package.mjs" "$RELEASE" <<'NODE'
import { pathToFileURL } from 'node:url';
const { listTypedTree, typedTreeDigest } = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(typedTreeDigest(listTypedTree(process.argv[3])));
NODE
)"
assert_eq "$TREE_AFTER" "$TREE_BEFORE"
assert_eq "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$SHA"
assert_eq "$(git -C "$REPO_ROOT" rev-parse HEAD^{tree})" "$TREE"
assert_eq "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ""

note "preliminary release-input metadata cannot masquerade as I00"
PRELIMINARY="$TEST_TMP/preliminary/i00-$SHA"
mkdir -p "$PRELIMINARY"
chmod 0700 "$PRELIMINARY"
printf '%s\n' \
  "{\"schema\":\"cosmos.release-input.v1\",\"inputSha\":\"$SHA\"}" \
  > "$PRELIMINARY/release.json"
printf '%s\n' \
  "{\"schemaVersion\":1,\"testedSha\":\"$SHA\",\"sourceTree\":\"$TREE\",\"files\":[]}" \
  > "$PRELIMINARY/artifact-manifest.json"
assert_failure_contains "I00 release.json has an unexpected key set" \
  node "$BUILD" \
    --source-root "$REPO_ROOT" \
    --input-sha "$SHA" \
    --release-root "$PRELIMINARY" \
    --output-root "$TEST_TMP" \
    --target-arch x64 \
    --service-user cosmos \
    --service-group cosmos \
    --allow-simulation

finish
