#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

SHA=0123456789abcdef0123456789abcdef01234567
REAL_TMP="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-install-$$")"
cleanup_release_test() {
  local rc=$?
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp "$rc"
  return "$rc"
}
trap cleanup_release_test EXIT
note "assemble SHA-keyed immutable release from tested inputs"
RELEASE="$(assemble_fixture_release "$TEST_TMP/release" "$SHA")"
assert_file "$RELEASE/release.json"
assert_file "$RELEASE/artifact-manifest.json"
assert_file "$RELEASE/server/dist/index.js"
assert_file "$RELEASE/server/dist/ledger.js"
assert_file "$RELEASE/web/dist/index.html"
assert_file "$RELEASE/node_modules/fake-runtime/package.json"
VALID="$(node "$I00_ROOT/bin/validate-release.mjs" --release "$RELEASE" --allow-simulation)"
assert_contains "$VALID" RELEASE_VALID_NOT_DEPLOYED
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$RELEASE"
assert_contains "$(cat "$RELEASE/release.json")" '"activationState": "NOT_DEPLOYED"'
assert_contains "$(cat "$RELEASE/release.json")" '"serverDistDigestSha256"'
assert_contains "$(cat "$RELEASE/release.json")" '"webDistDigestSha256"'
assert_contains "$(cat "$RELEASE/artifact-manifest.json")" '"testedBuildOutputs"'
assert_contains "$(cat "$RELEASE/artifact-manifest.json")" '"ledgerCompatibility"'
assert_contains "$(cat "$RELEASE/release.json")" '"status": "SIMULATION_ONLY_NOT_ATTESTED"'
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.releaseId)' "$RELEASE/release.json")" "i00-$SHA"
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.schemaVersion))' "$RELEASE/release.json")" 1
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.rollbackFloor))' "$RELEASE/release.json")" 1
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.rollbackBarrier))' "$RELEASE/release.json")" true
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.compatibilitySource)' "$RELEASE/release.json")" server/dist/ledger.js
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.compatibilitySourceSha256)' "$RELEASE/release.json")" "$(shasum -a 256 "$RELEASE/server/dist/ledger.js" | awk '{print $1}')"
assert_failure_contains 'caller overrides are forbidden' node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/release/source" --runtime-deps "$TEST_TMP/release/deps" --output-root "$TEST_TMP/release/caller-override" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/release/tested.json" --built-at-utc 2026-07-13T00:00:00Z --schema-version 7 --config-revision c --model-revision m --simulation-source
INSTALLED_I00="$SIMULATION_ROOT/installed-i00"
INSTALL_OUT="$("$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE" --destination "$INSTALLED_I00" --simulation --simulation-root "$SIMULATION_ROOT")"
assert_contains "$INSTALL_OUT" OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION
note "DEPLOY-DEFECTS-007(3): installed root is immutable and searchable by service identities"
INSTALLED_ROOT_MODE="$(stat -c '%a' "$INSTALLED_I00" 2>/dev/null || stat -f '%Lp' "$INSTALLED_I00")"
assert_eq "$INSTALLED_ROOT_MODE" 511
assert_eq "$(node -e 'const mode=Number.parseInt(process.argv[1],8);process.stdout.write(String((mode&0o222)===0&&(mode&0o111)===0o111))' "$INSTALLED_ROOT_MODE")" true
assert_file "$INSTALLED_I00/bin/app-entrypoint.mjs"
assert_file "$INSTALLED_I00/accepted-ops-live/bin/deploy.sh"
assert_file "$INSTALLED_I00/install-receipt.json"
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.serviceMutationPerformed))' "$INSTALLED_I00/install-receipt.json")" false
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.schemaVersion))' "$INSTALLED_I00/install-receipt.json")" 2
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.effectiveOpsRoot)' "$INSTALLED_I00/install-receipt.json")" accepted-ops-live
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.immutableDonorCommit)' "$INSTALLED_I00/install-receipt.json")" 2cec412927fa2f64f05a0b2774b18e45f8ce4fa5
assert_eq "$(node -e '
  const installed=require(process.argv[1]), release=require(process.argv[2]);
  const actual={
    immutableDonorCommit:installed.immutableDonorCommit,
    immutableDonorLiveTree:installed.immutableDonorLiveTree,
    immutableDonorContractSha256:installed.immutableDonorContractSha256,
    amendmentContractSha256:installed.amendmentContractSha256,
    effectiveLiveTree:installed.effectiveLiveTree,
    effectiveRootDigestSha256:installed.effectiveRootDigestSha256,
    i00EnforcementTreeDigestSha256:installed.i00EnforcementTreeDigestSha256,
    findingIds:installed.authorizedCorrectionFindingIds,
  };
  process.stdout.write(String(JSON.stringify(actual)===JSON.stringify(release.l15OpsProvenance)));
' "$INSTALLED_I00/install-receipt.json" "$RELEASE/release.json")" true

note "post-validation release rewrites cannot self-approve staged enforcement bytes"
MUTABLE_RELEASE="$TEST_TMP/post-validation-mutable-release"
cp -R "$RELEASE" "$MUTABLE_RELEASE"
MUTATING_NODE_BIN="$TEST_TMP/mutating-node-bin"
mkdir "$MUTATING_NODE_BIN"
cp "$TEST_DIR/fixtures/mutate-release-after-validation.sh" "$MUTATING_NODE_BIN/node"
chmod 700 "$MUTATING_NODE_BIN/node"
MUTATION_FLAG="$TEST_TMP/post-validation-mutation-complete"
MUTABLE_DESTINATION="$SIMULATION_ROOT/post-validation-mutable-install"
assert_failure_contains 'staged I00 enforcement cohort differs from validated release' env \
  PATH="$MUTATING_NODE_BIN:$PATH" \
  REAL_NODE="$(command -v node)" \
  VALIDATE_RELEASE_PATH="$I00_ROOT/bin/validate-release.mjs" \
  MUTABLE_RELEASE="$MUTABLE_RELEASE" \
  TRUSTED_I00_LIB="$I00_ROOT/lib.mjs" \
  MUTATION_KIND=self-declared-cohort \
  MUTATION_FLAG="$MUTATION_FLAG" \
  "$I00_ROOT/bin/install-ops-bundle.sh" --release "$MUTABLE_RELEASE" \
  --destination "$MUTABLE_DESTINATION" --simulation --simulation-root "$SIMULATION_ROOT"
assert_file "$MUTATION_FLAG"
assert_not_file "$MUTABLE_DESTINATION"

note "post-validation reserved receipt injection is rejected before receipt generation"
RESERVED_RELEASE="$TEST_TMP/post-validation-reserved-release"
cp -R "$RELEASE" "$RESERVED_RELEASE"
RESERVED_MUTATION_FLAG="$TEST_TMP/post-validation-reserved-mutation-complete"
RESERVED_DESTINATION="$SIMULATION_ROOT/post-validation-reserved-install"
assert_failure_contains 'staged I00 contains reserved installed-bundle path install-receipt.json' env \
  PATH="$MUTATING_NODE_BIN:$PATH" \
  REAL_NODE="$(command -v node)" \
  VALIDATE_RELEASE_PATH="$I00_ROOT/bin/validate-release.mjs" \
  MUTABLE_RELEASE="$RESERVED_RELEASE" \
  TRUSTED_I00_LIB="$I00_ROOT/lib.mjs" \
  MUTATION_KIND=reserved-receipt \
  MUTATION_FLAG="$RESERVED_MUTATION_FLAG" \
  "$I00_ROOT/bin/install-ops-bundle.sh" --release "$RESERVED_RELEASE" \
  --destination "$RESERVED_DESTINATION" --simulation --simulation-root "$SIMULATION_ROOT"
assert_file "$RESERVED_MUTATION_FLAG"
assert_not_file "$RESERVED_DESTINATION"

note "precreated staging symlink is refused without mutating its target"
STAGING_RACE_RELEASE="$TEST_TMP/post-validation-staging-race-release"
cp -R "$RELEASE" "$STAGING_RACE_RELEASE"
STAGING_RACE_FLAG="$TEST_TMP/post-validation-staging-race-complete"
STAGING_RACE_DESTINATION="$SIMULATION_ROOT/post-validation-staging-race-install"
STAGING_RACE_TARGET="$TEST_TMP/post-validation-staging-race-target"
mkdir "$STAGING_RACE_TARGET"
printf 'sentinel\n' > "$STAGING_RACE_TARGET/sentinel"
assert_failure_contains 'could not claim private staging directory' env \
  PATH="$MUTATING_NODE_BIN:$PATH" \
  REAL_NODE="$(command -v node)" \
  VALIDATE_RELEASE_PATH="$I00_ROOT/bin/validate-release.mjs" \
  MUTABLE_RELEASE="$STAGING_RACE_RELEASE" \
  TRUSTED_I00_LIB="$I00_ROOT/lib.mjs" \
  MUTATION_KIND=precreated-staging-symlink \
  MUTATION_FLAG="$STAGING_RACE_FLAG" \
  STAGING_DESTINATION="$STAGING_RACE_DESTINATION" \
  STAGING_TARGET="$STAGING_RACE_TARGET" \
  "$I00_ROOT/bin/install-ops-bundle.sh" --release "$STAGING_RACE_RELEASE" \
  --destination "$STAGING_RACE_DESTINATION" --simulation --simulation-root "$SIMULATION_ROOT"
assert_file "$STAGING_RACE_FLAG"
assert_file "$STAGING_RACE_TARGET/sentinel"
assert_eq "$(find "$STAGING_RACE_TARGET" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1
assert_not_file "$STAGING_RACE_DESTINATION"

assert_failure "$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE" --destination /usr/local/lib/cosmos-ops/i00 --simulation --simulation-root "$SIMULATION_ROOT"

note "release assembly refuses an incomplete effective-root verifier dependency closure"
assert_missing_release_dependency_refused() {
  local relative="$1" label="$2" source="$TEST_TMP/release/source" saved
  saved="$TEST_TMP/$label.saved"
  mv "$source/$relative" "$saved"
  assert_failure node "$I00_ROOT/bin/assemble-release.mjs" \
    --source-root "$source" --runtime-deps "$TEST_TMP/release/deps" \
    --output-root "$TEST_TMP/$label-output" --tested-sha "$SHA" \
    --tested-receipt "$TEST_TMP/release/tested.json" \
    --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m \
    --simulation-source
  mv "$saved" "$source/$relative"
}
assert_missing_release_dependency_refused ops/i00/bin/verify-donor.mjs missing-donor-verifier
assert_missing_release_dependency_refused ops/i00/lib.mjs missing-i00-library
assert_missing_release_dependency_refused test/i00/performance/protected-owner-directives.bundle.v1.json missing-owner-directive-bundle

note "packaged verifier inputs reject unsafe fixture destinations and release drift"
FIXTURE_SYMLINK_ROOT="$TEST_TMP/fixture-owner-symlink"
mkdir -p "$FIXTURE_SYMLINK_ROOT"
printf 'outside-sentinel\n' > "$TEST_TMP/fixture-owner-outside"
ln -s "$TEST_TMP/fixture-owner-outside" "$FIXTURE_SYMLINK_ROOT/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md"
assert_failure_contains 'protected directive destination unsafe' \
  node "$TEST_DIR/fixtures/make-complete-acceptance.mjs" \
  "$FIXTURE_SYMLINK_ROOT" "$TEST_TMP/fixture-owner-symlink.json" "$SHA" "$SHA"
assert_eq "$(cat "$TEST_TMP/fixture-owner-outside")" 'outside-sentinel'
FIXTURE_DRIFT_ROOT="$TEST_TMP/fixture-owner-drift"
mkdir -p "$FIXTURE_DRIFT_ROOT"
printf 'drift-sentinel\n' > "$FIXTURE_DRIFT_ROOT/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md"
assert_failure_contains 'protected directive drift' \
  node "$TEST_DIR/fixtures/make-complete-acceptance.mjs" \
  "$FIXTURE_DRIFT_ROOT" "$TEST_TMP/fixture-owner-drift.json" "$SHA" "$SHA"
assert_eq "$(cat "$FIXTURE_DRIFT_ROOT/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md")" 'drift-sentinel'
OWNER_BUNDLE="$TEST_TMP/release/source/test/i00/performance/protected-owner-directives.bundle.v1.json"
cp "$OWNER_BUNDLE" "$TEST_TMP/owner-directive-bundle.saved"
printf ' ' >> "$OWNER_BUNDLE"
assert_failure_contains 'PROTECTED_OWNER_DIRECTIVE_BUNDLE_HASH_MISMATCH' \
  node "$I00_ROOT/bin/assemble-release.mjs" \
  --source-root "$TEST_TMP/release/source" --runtime-deps "$TEST_TMP/release/deps" \
  --output-root "$TEST_TMP/tampered-owner-bundle-output" --tested-sha "$SHA" \
  --tested-receipt "$TEST_TMP/release/tested.json" \
  --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m \
  --simulation-source
mv "$TEST_TMP/owner-directive-bundle.saved" "$OWNER_BUNDLE"

note "production assembly requires and reverifies exact owner/CI Ed25519 provenance"
PROD_ROOT="$TEST_TMP/production-release"
make_release_inputs "$PROD_ROOT/source" "$PROD_ROOT/deps" "$SHA" "$PROD_ROOT/tested.json"
git -C "$PROD_ROOT/source" init -q
git -C "$PROD_ROOT/source" config user.name 'I00 fixture builder'
git -C "$PROD_ROOT/source" config user.email 'i00-fixture@example.invalid'
git -C "$PROD_ROOT/source" add . \
  ':!test/i00/performance/evidence' \
  ':!I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md' \
  ':!IP_CONTROL.md' ':!IP_OPS.md' ':!IP_PROOF.md' ':!IP_RUNTIME.md'
git -C "$PROD_ROOT/source" commit -q -m 'fixture production source'
PROD_SHA="$(git -C "$PROD_ROOT/source" rev-parse HEAD)"
PROD_TREE="$(git -C "$PROD_ROOT/source" rev-parse 'HEAD^{tree}')"
node "$TEST_DIR/fixtures/make-complete-acceptance.mjs" "$PROD_ROOT/source" "$PROD_ROOT/tested.json" "$PROD_SHA" "$PROD_TREE" >/dev/null
node --input-type=module - "$PROD_ROOT/tested.json" "$PROD_ROOT/source" "$PROD_ROOT/deps" "$PROD_ROOT/build-attestation.json" "$PROD_ROOT/build-attestation.sig" "$PROD_ROOT/build-public.pem" "$PROD_ROOT/ephemeral-private.pem" <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [receiptPath, sourceRoot, depsRoot, attestationPath, signaturePath, publicKeyPath, privateKeyPath] = process.argv.slice(2);
const fileSha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const listFiles = (root, relative = '') => readdirSync(path.join(root, relative)).sort().flatMap((name) => {
  const next = relative ? `${relative}/${name}` : name;
  return lstatSync(path.join(root, next)).isDirectory() ? listFiles(root, next) : [next];
});
const treeDigest = (root) => {
  const hash = createHash('sha256');
  for (const file of listFiles(root)) hash.update(file).update('\0').update(fileSha(path.join(root, file))).update('\n');
  return hash.digest('hex');
};
const receiptBytes = readFileSync(receiptPath);
const receipt = JSON.parse(receiptBytes);
const attestation = {
  schemaVersion: 1,
  attestationType: 'I00_PRODUCTION_BUILD_V1',
  testedSha: receipt.source.headSha,
  sourceTree: receipt.source.treeSha,
  testedReceiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
  packageLockSha256: fileSha(path.join(sourceRoot, 'package-lock.json')),
  runtimeDepsDigestSha256: treeDigest(depsRoot),
  serverDistDigestSha256: treeDigest(path.join(sourceRoot, 'server/dist')),
  webDistDigestSha256: treeDigest(path.join(sourceRoot, 'web/dist')),
  requiredCommands: [
    { command: 'npm test', exitCode: 0 },
    { command: 'npm run test:all', exitCode: 0 },
    { command: 'bash ops/tests/i00/run-all.sh', exitCode: 0 },
  ],
  testsCompletedAtUtc: receipt.endedAtUtc,
  buildCompletedAtUtc: '2026-07-13T00:01:00Z',
  builderIdentity: 'ci://i00-fixture/release-builder',
};
const bytes = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(attestationPath, bytes, { mode: 0o600 });
writeFileSync(signaturePath, `${sign(null, bytes, privateKey).toString('base64')}\n`, { mode: 0o600 });
writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
NODE
PROD_ASSEMBLE=(node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/releases" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --config-revision config-fixture --model-revision UNAVAILABLE --build-attestation "$PROD_ROOT/build-attestation.json" --build-attestation-signature "$PROD_ROOT/build-attestation.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem")
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/missing-proof" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --config-revision c --model-revision m
set +e
PROD_ASSEMBLE_OUTPUT="$("${PROD_ASSEMBLE[@]}" 2>&1)"; PROD_ASSEMBLE_RC=$?
set -e
[ "$PROD_ASSEMBLE_RC" -eq 0 ] || fail_test "production assembly failed: $PROD_ASSEMBLE_OUTPUT"
pass_assertion
PROD_RELEASE="$PROD_ROOT/releases/i00-$PROD_SHA"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$PROD_RELEASE"
assert_success node "$I00_ROOT/bin/validate-release.mjs" --release "$PROD_RELEASE" --trusted-build-public-key "$PROD_ROOT/build-public.pem"
assert_file "$PROD_RELEASE/receipts/build-attestation.json"
assert_file "$PROD_RELEASE/receipts/build-attestation.sig"
assert_file "$PROD_RELEASE/receipts/build-attestation-public-key.pem"
assert_not_file "$PROD_RELEASE/receipts/ephemeral-private.pem"
assert_contains "$(cat "$PROD_RELEASE/release.json")" '"status": "VERIFIED_ED25519"'
assert_contains "$(cat "$PROD_RELEASE/artifact-manifest.json")" '"builderIdentity": "ci://i00-fixture/release-builder"'

node --input-type=module - "$PROD_ROOT/build-attestation.json" "$PROD_ROOT/forged.sig" "$PROD_ROOT/rogue-public.pem" <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const bytes = readFileSync(process.argv[2]);
writeFileSync(process.argv[3], `${sign(null, bytes, privateKey).toString('base64')}\n`);
writeFileSync(process.argv[4], publicKey.export({ type: 'spki', format: 'pem' }));
NODE
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$PROD_RELEASE" --trusted-build-public-key "$PROD_ROOT/rogue-public.pem"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/forged-out" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --config-revision c --model-revision m --build-attestation "$PROD_ROOT/build-attestation.json" --build-attestation-signature "$PROD_ROOT/forged.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem"

node --input-type=module - "$PROD_ROOT/build-attestation.json" "$PROD_ROOT/mismatched-attestation.json" "$PROD_ROOT/mismatched-attestation.sig" "$PROD_ROOT/ephemeral-private.pem" <<'NODE'
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [sourcePath, attestationPath, signaturePath, privateKeyPath] = process.argv.slice(2);
const value = JSON.parse(readFileSync(sourcePath, 'utf8'));
value.serverDistDigestSha256 = '0'.repeat(64);
const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const key = createPrivateKey(readFileSync(privateKeyPath, 'utf8'));
writeFileSync(attestationPath, bytes);
writeFileSync(signaturePath, `${sign(null, bytes, key).toString('base64')}\n`);
NODE
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/mismatch-out" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --config-revision c --model-revision m --build-attestation "$PROD_ROOT/mismatched-attestation.json" --build-attestation-signature "$PROD_ROOT/mismatched-attestation.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem"

cp -R "$PROD_RELEASE" "$PROD_ROOT/cryptographically-forged"
node -e '
  const crypto=require("crypto"),fs=require("fs"),path=require("path"),root=process.argv[1];
  const sigPath=path.join(root,"receipts/build-attestation.sig");
  fs.writeFileSync(sigPath,`${Buffer.alloc(64).toString("base64")}\n`);
  const digest=crypto.createHash("sha256").update(fs.readFileSync(sigPath)).digest("hex");
  const releasePath=path.join(root,"release.json"), manifestPath=path.join(root,"artifact-manifest.json");
  const release=JSON.parse(fs.readFileSync(releasePath,"utf8"));
  release.buildAttestation.signatureSha256=digest;
  fs.writeFileSync(releasePath,`${JSON.stringify(release,null,2)}\n`);
  const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
  manifest.buildAttestation.signatureSha256=digest;
  manifest.files.find((entry)=>entry.path==="receipts/build-attestation.sig").sha256=digest;
  manifest.files.find((entry)=>entry.path==="release.json").sha256=crypto.createHash("sha256").update(fs.readFileSync(releasePath)).digest("hex");
  fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`);
' "$PROD_ROOT/cryptographically-forged"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$PROD_ROOT/cryptographically-forged" --trusted-build-public-key "$PROD_ROOT/build-public.pem"

note "tamper and false-green receipts fail closed"
cp -R "$RELEASE" "$TEST_TMP/tampered"
printf '\n// tamper\n' >> "$TEST_TMP/tampered/server/dist/index.js"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/tampered" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/manifest-rewritten"
printf '\n// forged after assembly\n' >> "$TEST_TMP/manifest-rewritten/server/dist/index.js"
node -e '
  const crypto = require("crypto"), fs = require("fs"), path = require("path");
  const root = process.argv[1], payload = path.join(root, "server/dist/index.js"), manifestPath = path.join(root, "artifact-manifest.json");
  const fileSha = crypto.createHash("sha256").update(fs.readFileSync(payload)).digest("hex");
  const treeSha = crypto.createHash("sha256").update(`index.js\0${fileSha}\n`).digest("hex");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === "server/dist/index.js").sha256 = fileSha;
  manifest.testedBuildOutputs.serverDistDigestSha256 = treeSha;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$TEST_TMP/manifest-rewritten"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/manifest-rewritten" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/effective-l15-manifest-rewritten"
printf '\n# forged effective L15 bytes\n' >> "$TEST_TMP/effective-l15-manifest-rewritten/ops/live/README.md"
node -e '
  const crypto = require("crypto"), fs = require("fs"), path = require("path");
  const root = process.argv[1], relative = "ops/live/README.md";
  const manifestPath = path.join(root, "artifact-manifest.json");
  const fileSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === relative).sha256 = fileSha;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$TEST_TMP/effective-l15-manifest-rewritten"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" \
  --release "$TEST_TMP/effective-l15-manifest-rewritten" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/i00-enforcement-manifest-rewritten"
printf '\n// forged installed verifier bypass\n' \
  >> "$TEST_TMP/i00-enforcement-manifest-rewritten/ops/i00/bin/verify-donor-root.mjs"
node -e '
  const crypto = require("crypto"), fs = require("fs"), path = require("path");
  const root = process.argv[1], relative = "ops/i00/bin/verify-donor-root.mjs";
  const manifestPath = path.join(root, "artifact-manifest.json");
  const fileSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === relative).sha256 = fileSha;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$TEST_TMP/i00-enforcement-manifest-rewritten"
assert_failure_contains 'release ops/i00 enforcement cohort differs' \
  node "$I00_ROOT/bin/validate-release.mjs" \
  --release "$TEST_TMP/i00-enforcement-manifest-rewritten" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/i00-enforcement-empty-directory"
mkdir "$TEST_TMP/i00-enforcement-empty-directory/ops/i00/undeclared-empty"
assert_failure_contains 'release ops/i00 enforcement cohort differs' \
  node "$I00_ROOT/bin/validate-release.mjs" \
  --release "$TEST_TMP/i00-enforcement-empty-directory" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/mode-tampered"
chmod -x "$TEST_TMP/mode-tampered/ops/i00/bin/install-ops-bundle.sh"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/mode-tampered" --allow-simulation
cp -R "$RELEASE" "$TEST_TMP/donor-verifier-tampered"
printf '\n// post-assembly tamper\n' >> "$TEST_TMP/donor-verifier-tampered/test/i00/donor-equality.mjs"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/donor-verifier-tampered" --allow-simulation

assert_semantic_release_forgery() {
  local kind="$1" expected="$2" root="$TEST_TMP/semantic-release-forgery-$1"
  cp -R "$RELEASE" "$root"
  node --input-type=module - "$root" "$kind" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [root, kind] = process.argv.slice(2);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const write = (relative, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(path.join(root, relative), bytes);
  return { bytes, sha256: sha(bytes) };
};
const release = read('release.json');
const complete = read(release.testedReceipt);
const evidence = release.acceptanceEvidence;
const evidenceRelative = kind === 'browser' ? evidence.browserReceipt : evidence.performanceReceipt;
const document = read(evidenceRelative);
if (kind === 'browser') document.truthChecks.noFalseGreen = false;
else if (kind === 'performance-provenance') {
  document.source.branch = 'DETACHED';
  document.source.worktreeState = 'CLEAN_DETACHED_CANDIDATE_WITH_PACKAGED_OWNER_DIRECTIVES';
  for (const row of document.source.protectedOwnerDirectives) row.gitStatus = 'CANDIDATE_COMMITTED_VERIFIER_INPUT';
} else document.continuity.uncleanRecoveryProven = false;
const reboundEvidence = write(evidenceRelative, document);
const descriptor = kind === 'browser' ? complete.browserReceipt : complete.performanceReceipt;
descriptor.sha256 = reboundEvidence.sha256;
descriptor.byteLength = reboundEvidence.bytes.length;
if (kind === 'browser') {
  const entry = complete.sourceFreeze.evidence.entries.find((candidate) => candidate.relativePath === descriptor.relativePath);
  entry.sha256 = descriptor.sha256;
  entry.byteLength = descriptor.byteLength;
  complete.sourceFreeze.evidence.sha256 = sha(JSON.stringify(complete.sourceFreeze.evidence.entries));
  const browserStep = complete.steps.find((step) => step.id === 'browser_receipt');
  const sourceFreezeStep = complete.steps.find((step) => step.id === 'source_freeze');
  browserStep.stdoutSha256 = descriptor.sha256;
  browserStep.stdoutBytes = descriptor.byteLength;
  sourceFreezeStep.initialEvidence = structuredClone(complete.sourceFreeze.evidence);
  sourceFreezeStep.finalInitialEvidence = structuredClone(complete.sourceFreeze.evidence);
} else {
  const performanceEvidence = complete.steps.find((step) => step.id === 'source_freeze').performanceEvidence;
  performanceEvidence.entries[0].sha256 = descriptor.sha256;
  performanceEvidence.entries[0].byteLength = descriptor.byteLength;
  performanceEvidence.sha256 = sha(JSON.stringify(performanceEvidence.entries));
}
const reboundComplete = write(release.testedReceipt, complete);
release.testedReceiptSha256 = reboundComplete.sha256;
if (kind === 'browser') release.acceptanceEvidence.browserReceiptSha256 = reboundEvidence.sha256;
else release.acceptanceEvidence.performanceReceiptSha256 = reboundEvidence.sha256;
const releaseBytes = write('release.json', release);
const manifest = read('artifact-manifest.json');
manifest.acceptanceEvidence = structuredClone(release.acceptanceEvidence);
for (const [relative, digest] of [
  [release.testedReceipt, reboundComplete.sha256],
  [evidenceRelative, reboundEvidence.sha256],
  ['release.json', releaseBytes.sha256],
]) manifest.files.find((entry) => entry.path === relative).sha256 = digest;
write('artifact-manifest.json', manifest);
NODE
  assert_failure_contains "$expected" node "$I00_ROOT/bin/validate-release.mjs" --release "$root" --allow-simulation
}
assert_semantic_release_forgery browser 'canonical browser acceptance validation failed'
assert_semantic_release_forgery performance 'canonical performance acceptance validation failed'
assert_semantic_release_forgery performance-provenance 'PERFORMANCE_SOURCE_MODE_MISMATCH'

cat > "$TEST_TMP/label-exit-forgery.json" <<JSON
{"schemaVersion":1,"status":"PASS","testedSha":"$SHA","gitDirty":false,"commands":[{"command":"npm test","exitCode":0},{"command":"npm run test:all","exitCode":0},{"command":"bash ops/tests/i00/run-all.sh","exitCode":0},{"command":"npm run test:i00:complete","exitCode":0}]}
JSON
assert_failure_contains 'complete local-acceptance receipt' node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/release/source" --runtime-deps "$TEST_TMP/release/deps" --output-root "$TEST_TMP/label-forgery-out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/label-exit-forgery.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m --simulation-source

note "complete acceptance identity, exact step set, boundary, and evidence bindings reject hostile forgeries"
assert_acceptance_forgery() {
  local name="$1" mutation="$2" expected="$3" root="$TEST_TMP/acceptance-forgery-$1"
  make_release_inputs "$root/source" "$root/deps" "$SHA" "$root/tested.json"
  node -e "$mutation" "$root/tested.json" "$root/source"
  assert_failure_contains "$expected" node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$root/source" --runtime-deps "$root/deps" --output-root "$root/out" --tested-sha "$SHA" --tested-receipt "$root/tested.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m --simulation-source
  assert_not_file "$root/out/i00-$SHA"
}
assert_acceptance_forgery missing-step 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.steps.splice(3,1);fs.writeFileSync(p,JSON.stringify(v));' 'exactly 10 measured step results'
assert_acceptance_forgery command-label 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.steps.find((s)=>s.id==="root_test").command=["npm","run","looks-green"];fs.writeFileSync(p,JSON.stringify(v));' 'root_test command is invalid'
assert_acceptance_forgery candidate-sha 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.source.headSha="b".repeat(40);fs.writeFileSync(p,JSON.stringify(v));' 'candidate SHA/tree mismatch'
assert_acceptance_forgery external-boundary 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.externalBoundary.signedCalls="PASS";fs.writeFileSync(p,JSON.stringify(v));' 'external boundary truth is invalid'
assert_acceptance_forgery forged-uv-binary 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.uv.binarySha256="not-a-digest";fs.writeFileSync(p,JSON.stringify(v));' 'complete acceptance uv.binarySha256 must be a lowercase SHA-256'
assert_acceptance_forgery browser-bytes 'const fs=require("fs"),path=require("path"),p=process.argv[1],root=process.argv[2],v=JSON.parse(fs.readFileSync(p));fs.appendFileSync(path.join(root,v.browserReceipt.relativePath)," ");' 'browser acceptance bytes do not match'
assert_acceptance_forgery browser-artifact-count 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.browserReceipt.artifactCount=193;fs.writeFileSync(p,JSON.stringify(v));' 'browserReceipt.artifactCount is invalid'
assert_acceptance_forgery missing-owner-directive-hash 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));delete v.sourceFreeze.protectedOwnerDirectives[0].sha256;fs.writeFileSync(p,JSON.stringify(v));' 'sourceFreeze.protectedOwnerDirectives[0]'
assert_acceptance_forgery altered-owner-directive-hash 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.sourceFreeze.protectedOwnerDirectives[0].sha256="0".repeat(64);fs.writeFileSync(p,JSON.stringify(v));' 'sourceFreeze protected inputs do not match source truth'

note "release assembly requires the complete canonical validator dependency graph"
make_release_inputs "$TEST_TMP/missing-donor-verifier/source" "$TEST_TMP/missing-donor-verifier/deps" "$SHA" "$TEST_TMP/missing-donor-verifier/tested.json"
rm "$TEST_TMP/missing-donor-verifier/source/test/i00/donor-equality.mjs"
assert_failure_contains 'release input missing test/i00/donor-equality.mjs' node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/missing-donor-verifier/source" --runtime-deps "$TEST_TMP/missing-donor-verifier/deps" --output-root "$TEST_TMP/missing-donor-verifier/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/missing-donor-verifier/tested.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m --simulation-source
assert_not_file "$TEST_TMP/missing-donor-verifier/out/i00-$SHA"
make_release_inputs "$TEST_TMP/missing-verifier-helper/source" "$TEST_TMP/missing-verifier-helper/deps" "$SHA" "$TEST_TMP/missing-verifier-helper/tested.json"
rm "$TEST_TMP/missing-verifier-helper/source/test/i00/verify-scope.mjs"
assert_failure_contains 'release input missing test/i00/verify-scope.mjs' node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/missing-verifier-helper/source" --runtime-deps "$TEST_TMP/missing-verifier-helper/deps" --output-root "$TEST_TMP/missing-verifier-helper/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/missing-verifier-helper/tested.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m --simulation-source
assert_not_file "$TEST_TMP/missing-verifier-helper/out/i00-$SHA"

note "compiled Ledger is the sole release compatibility authority"
assert_bad_compatibility() {
  local name="$1" schema="$2" floor="$3" expected="$4" root="$TEST_TMP/compatibility-$1"
  make_release_inputs "$root/source" "$root/deps" "$SHA" "$root/tested.json"
  printf 'export const LEDGER_SCHEMA_VERSION = %s;\nexport const LEDGER_ROLLBACK_FLOOR = %s;\n' "$schema" "$floor" > "$root/source/server/dist/ledger.js"
  assert_failure_contains "$expected" node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$root/source" --runtime-deps "$root/deps" --output-root "$root/out" --tested-sha "$SHA" --tested-receipt "$root/tested.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m --simulation-source
  assert_not_file "$root/out/i00-$SHA"
}
assert_bad_compatibility floor-ahead 1 2 'compatibility range is invalid'
assert_bad_compatibility intermediate-floor 2 1 'not representable by the accepted donor contract'
assert_bad_compatibility unsafe-integer 9007199254740992 0 'exceeds Number.MAX_SAFE_INTEGER'
cp -R "$RELEASE" "$TEST_TMP/compatibility-rewritten"
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.rollbackFloor=0;v.rollbackBarrier=false;fs.writeFileSync(p,`${JSON.stringify(v,null,2)}\n`);' "$TEST_TMP/compatibility-rewritten/release.json"
assert_failure_contains 'does not match the tested compiled Ledger' node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/compatibility-rewritten" --allow-simulation

note "deployment preflight freezes on disk, recovery, and migration ambiguity"
cat > "$TEST_TMP/host.json" <<'JSON'
{"source":"TARGET_HOST_OWNER_READBACK","account":"simulation-account","targetHost":"fixture-host.internal","environment":"simulation","freeBytes":10000000,"backupReserveBytes":1000,"sqliteVersion":"3.53.3","evidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","observedAtUtc":"2026-07-13T00:00:00Z"}
JSON
cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:00Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":1,"rollbackFloor":1}
JSON
PREFLIGHT=(node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --mode deploy --now 2026-07-13T00:01:00Z --max-host-age-sec 300 --max-supervisor-age-sec 120 --required-supervisor-window-sec 130)
assert_success "${PREFLIGHT[@]}"

note "deploy/rollback preflight verifies release integrity, not just shape"
# A tampered payload must fail the operator-facing gate exactly as it fails
# validate-release.mjs — before the fix both preflights exited 0 on it.
cp -R "$RELEASE" "$TEST_TMP/preflight-tampered"
printf '\n// tampered\n' >> "$TEST_TMP/preflight-tampered/server/dist/index.js"
TAMPERED_PREFLIGHT=("${PREFLIGHT[@]}")
TAMPERED_PREFLIGHT[3]="$TEST_TMP/preflight-tampered"
assert_failure_contains 'artifact digest/mode mismatch' "${TAMPERED_PREFLIGHT[@]}"
TAMPERED_PREFLIGHT[9]=rollback
assert_failure_contains 'artifact digest/mode mismatch' "${TAMPERED_PREFLIGHT[@]}"
# A stub directory containing only a hand-written release.json must fail —
# before the fix a 192-byte stub with an invented key preflighted green.
mkdir -p "$TEST_TMP/preflight-stub"
cat > "$TEST_TMP/preflight-stub/release.json" <<'JSON'
{"releaseId":"i00-stub","schemaVersion":1,"rollbackFloor":1,"rollbackBarrier":true,"invented":true}
JSON
STUB_PREFLIGHT=("${PREFLIGHT[@]}")
STUB_PREFLIGHT[3]="$TEST_TMP/preflight-stub"
assert_failure_contains 'release.json.gitSha is required' "${STUB_PREFLIGHT[@]}"
STUB_PREFLIGHT[9]=rollback
assert_failure_contains 'release.json.gitSha is required' "${STUB_PREFLIGHT[@]}"
# An invented key on an otherwise complete release.json is also refused.
cp -R "$RELEASE" "$TEST_TMP/preflight-invented"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p,"utf8"));v.invented=true;fs.writeFileSync(p,JSON.stringify(v,null,2));' "$TEST_TMP/preflight-invented/release.json"
INVENTED_PREFLIGHT=("${PREFLIGHT[@]}")
INVENTED_PREFLIGHT[3]="$TEST_TMP/preflight-invented"
assert_failure_contains 'unexpected field set' "${INVENTED_PREFLIGHT[@]}"
# The green receipt now states its integrity claim explicitly and is
# cryptographically tied to the exact artifact manifest it verified.
PREFLIGHT_RECEIPT="$("${PREFLIGHT[@]}")"
assert_contains "$PREFLIGHT_RECEIPT" '"releaseIntegrity":"MANIFEST_VERIFIED"'
assert_contains "$PREFLIGHT_RECEIPT" '"artifactManifestSha256"'
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.callerAssertion=true;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure_contains 'unexpected field set' "${PREFLIGHT[@]}"
cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:00Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":1,"rollbackFloor":1}
JSON
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.recoveryState="RECOVERY_REQUIRED";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.observedAtUtc="2026-07-12T23:00:00Z";v.validUntilUtc="2026-07-13T00:10:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.recoveryState="NONE";v.observedAtUtc="2026-07-13T00:00:00Z";v.rollbackFloor=2;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
PREFLIGHT[9]=rollback
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.rollbackFloor=1;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.freeBytes=100;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/host.json"
PREFLIGHT[9]=deploy
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.freeBytes=10000000;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/host.json"
for mutation in exposure ambiguity frozen; do
  node -e '
    const fs=require("fs"), p=process.argv[1], kind=process.argv[2], v=JSON.parse(fs.readFileSync(p,"utf8"));
    if (kind === "exposure") v.exposureState="ACTIVE";
    if (kind === "ambiguity") v.ambiguityState="AMBIGUOUS";
    if (kind === "frozen") v.deploymentFrozen=true;
    fs.writeFileSync(p,JSON.stringify(v));
  ' "$TEST_TMP/supervisor.json" "$mutation"
  assert_failure "${PREFLIGHT[@]}"
  cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:00Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":1,"rollbackFloor":1}
JSON
done
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.validUntilUtc="2026-07-13T00:01:30Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"

note "first-host preflight accepts only the exact producer-bound clean baseline"
FIRST_HOST_ROOT="$SIMULATION_ROOT/preflight-first-host"
FIRST_HOST_COSMOS="$FIRST_HOST_ROOT/cosmos"
FIRST_HOST_DATA="$FIRST_HOST_ROOT/data"
FIRST_HOST_OPS="$FIRST_HOST_ROOT/ops"
FIRST_HOST_EVIDENCE_PARENT="$SIMULATION_ROOT/preflight-first-host-evidence"
FIRST_HOST_BUNDLE="$FIRST_HOST_EVIDENCE_PARENT/bundle"
FIRST_HOST_RELEASE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$RELEASE")"
FIRST_HOST_ENV="$FIRST_HOST_ROOT/deploy.env"
FIRST_HOST_SQLITE="$FIRST_HOST_ROOT/sqlite3"
FIRST_HOST_SYSTEMCTL="$FIRST_HOST_ROOT/systemctl"
mkdir -p "$FIRST_HOST_ROOT" "$FIRST_HOST_EVIDENCE_PARENT"
cat > "$FIRST_HOST_SQLITE" <<'SH'
#!/usr/bin/env bash
printf '3.53.3 fixture\n'
SH
cat > "$FIRST_HOST_SYSTEMCTL" <<'SH'
#!/usr/bin/env bash
printf 'inactive\n'
exit 3
SH
chmod 755 "$FIRST_HOST_SQLITE" "$FIRST_HOST_SYSTEMCTL"
cat > "$FIRST_HOST_ROOT/raw.env" <<EOF
COSMOS_ROOT=$FIRST_HOST_COSMOS
RELEASES_DIR=$FIRST_HOST_COSMOS/releases
CURRENT_LINK=$FIRST_HOST_COSMOS/current
PREVIOUS_LINK=$FIRST_HOST_COSMOS/previous
DATA_DIR=$FIRST_HOST_DATA
OPS_STATE_DIR=$FIRST_HOST_OPS
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:18080
EOF
node "$I00_ROOT/bin/sanitize-donor-env.mjs" --env "$FIRST_HOST_ROOT/raw.env" \
  --output "$FIRST_HOST_ENV" --profile deploy --require-first-host-no-current >/dev/null

produce_first_host_bundle() {
  local reserve="${1:-1000}"
  chmod -R u+rwx "$FIRST_HOST_COSMOS" "$FIRST_HOST_DATA" "$FIRST_HOST_OPS" 2>/dev/null || true
  rm -rf "$FIRST_HOST_COSMOS" "$FIRST_HOST_DATA" "$FIRST_HOST_OPS" "$FIRST_HOST_BUNDLE"
  mkdir "$FIRST_HOST_BUNDLE"
  chmod 700 "$FIRST_HOST_BUNDLE"
  node "$I00_ROOT/bin/first-host-readback.mjs" --env "$FIRST_HOST_ENV" --release "$FIRST_HOST_RELEASE" \
    --output-dir "$FIRST_HOST_BUNDLE" --account simulation-account \
    --target-host fixture-host.internal --environment simulation \
    --backup-reserve-bytes "$reserve" --sqlite "$FIRST_HOST_SQLITE" \
    --systemctl "$FIRST_HOST_SYSTEMCTL" --now 2026-07-13T00:00:00Z >/dev/null
}

first_host_preflight() {
  local mode="${1:-deploy}" target="${2:-NO_PRIOR_RELEASE_FIRST_HOST}" now="${3:-2026-07-13T00:01:00Z}"
  node "$I00_ROOT/bin/preflight.mjs" --release "$FIRST_HOST_RELEASE" \
    --host "$FIRST_HOST_BUNDLE/host.json" --supervisor "$FIRST_HOST_BUNDLE/supervisor.json" \
    --mode "$mode" --now "$now" --max-host-age-sec 300 --max-supervisor-age-sec 120 \
    --required-supervisor-window-sec 130 --recovery-target "$target" \
    --first-host-evidence "$FIRST_HOST_BUNDLE/collected-evidence.json" --donor-env "$FIRST_HOST_ENV" \
    "${@:4}"
}

first_host_preflight_without_token() {
  node "$I00_ROOT/bin/preflight.mjs" --release "$FIRST_HOST_RELEASE" \
    --host "$FIRST_HOST_BUNDLE/host.json" --supervisor "$FIRST_HOST_BUNDLE/supervisor.json" \
    --mode deploy --now 2026-07-13T00:01:00Z --max-host-age-sec 300 \
    --max-supervisor-age-sec 120 --required-supervisor-window-sec 130 \
    --first-host-evidence "$FIRST_HOST_BUNDLE/collected-evidence.json" --donor-env "$FIRST_HOST_ENV"
}

mutate_first_host_bundle() {
  node --input-type=module - "$FIRST_HOST_BUNDLE" "$1" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [root, kind] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const evidence = read('collected-evidence.json');
const supervisor = read('supervisor.json');
if (kind === 'short-lease') {
  evidence.validUntilUtc = '2026-07-13T00:01:30Z';
  supervisor.validUntilUtc = evidence.validUntilUtc;
} else if (kind === 'cross-owner') evidence.owner.account = 'different-account';
else if (kind === 'unit-unknown') {
  evidence.baseline.unit.state = 'UNKNOWN';
  evidence.baseline.unit.exitCode = 4;
} else if (kind === 'nonzero-floor') {
  evidence.derived.currentSchemaVersion = 1;
  evidence.derived.rollbackFloor = 1;
  supervisor.currentSchemaVersion = 1;
  supervisor.rollbackFloor = 1;
} else if (kind === 'frozen') {
  evidence.derived.deploymentFrozen = true;
  supervisor.deploymentFrozen = true;
} else if (kind === 'exposure') {
  evidence.derived.exposureState = 'ACTIVE';
  supervisor.exposureState = 'ACTIVE';
} else if (kind === 'ambiguity') {
  evidence.derived.ambiguityState = 'AMBIGUOUS';
  supervisor.ambiguityState = 'AMBIGUOUS';
} else if (kind === 'recovery') {
  evidence.derived.recoveryState = 'RECOVERY_REQUIRED';
  supervisor.recoveryState = 'RECOVERY_REQUIRED';
} else if (kind === 'wrong-source') supervisor.source = 'UNAUTHORIZED_BOOTSTRAP_READBACK';
else if (kind === 'env-digest') evidence.sanitizedDonorEnv.sha256 = '0'.repeat(64);
else if (kind === 'release-cross') evidence.release.releaseId = 'i00-different';
else if (kind === 'forged-huge-disk') {
  const blockSize = BigInt(evidence.disk.blockSize);
  const forgedFree = (BigInt(Number.MAX_SAFE_INTEGER) / blockSize) * blockSize;
  evidence.disk.availableBlocks = (forgedFree / blockSize).toString();
  evidence.disk.freeBytes = Number(forgedFree);
  evidence.owner.backupReserveBytes = 9000000000000000;
}
else throw new Error(`unknown mutation ${kind}`);
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
const host = read('host.json');
if (kind === 'forged-huge-disk') {
  host.freeBytes = evidence.disk.freeBytes;
  host.backupReserveBytes = evidence.owner.backupReserveBytes;
}
host.evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex');
writeFileSync(path.join(root, 'collected-evidence.json'), evidenceBytes);
write('host.json', host);
write('supervisor.json', supervisor);
NODE
}

produce_first_host_bundle
assert_success first_host_preflight
assert_failure_contains 'recovery target must be NO_PRIOR_RELEASE_FIRST_HOST' \
  first_host_preflight deploy WRONG_FIRST_HOST
assert_failure_contains 'recovery target must be NO_PRIOR_RELEASE_FIRST_HOST' \
  first_host_preflight_without_token
assert_failure_contains 'deploy-only' first_host_preflight rollback
assert_failure_contains 'canonical supervisor readback rejects first-host arguments' \
  "${PREFLIGHT[@]}" --recovery-target NO_PRIOR_RELEASE_FIRST_HOST
assert_failure_contains 'duplicate first-host argument' first_host_preflight deploy \
  NO_PRIOR_RELEASE_FIRST_HOST 2026-07-13T00:01:00Z --recovery-target NO_PRIOR_RELEASE_FIRST_HOST
assert_failure first_host_preflight deploy NO_PRIOR_RELEASE_FIRST_HOST 2026-07-12T23:59:00Z
produce_first_host_bundle
mutate_first_host_bundle wrong-source
assert_failure_contains 'supervisor source is not canonical readback' first_host_preflight
produce_first_host_bundle
cp "$FIRST_HOST_BUNDLE/host.json" "$FIRST_HOST_ROOT/caller-host.json"
cp "$FIRST_HOST_BUNDLE/supervisor.json" "$FIRST_HOST_ROOT/caller-supervisor.json"
assert_failure_contains 'must be the producer bundle files' node "$I00_ROOT/bin/preflight.mjs" \
  --release "$FIRST_HOST_RELEASE" --host "$FIRST_HOST_ROOT/caller-host.json" \
  --supervisor "$FIRST_HOST_ROOT/caller-supervisor.json" --mode deploy \
  --now 2026-07-13T00:01:00Z --max-host-age-sec 300 --max-supervisor-age-sec 120 \
  --required-supervisor-window-sec 130 --recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
  --first-host-evidence "$FIRST_HOST_BUNDLE/collected-evidence.json" --donor-env "$FIRST_HOST_ENV"

note "first-host preflight rejects every current and previous node type"
for link in current previous; do
  for kind in valid-symlink dangling-symlink file directory; do
    produce_first_host_bundle
    mkdir -p "$FIRST_HOST_COSMOS"
    case "$kind" in
      valid-symlink) ln -s "$FIRST_HOST_RELEASE" "$FIRST_HOST_COSMOS/$link" ;;
      dangling-symlink) ln -s "$FIRST_HOST_ROOT/absent-target" "$FIRST_HOST_COSMOS/$link" ;;
      file) printf 'residue\n' > "$FIRST_HOST_COSMOS/$link" ;;
      directory) mkdir "$FIRST_HOST_COSMOS/$link" ;;
    esac
    assert_failure first_host_preflight
  done
done

note "first-host preflight rejects ancestor ambiguity and every residual baseline family"
produce_first_host_bundle
mkdir "$FIRST_HOST_ROOT/cosmos-target"
ln -s "$FIRST_HOST_ROOT/cosmos-target" "$FIRST_HOST_COSMOS"
assert_failure first_host_preflight
rm -rf "$FIRST_HOST_COSMOS" "$FIRST_HOST_ROOT/cosmos-target"

for residual in cosmos releases release-destination data ops journal frozen money; do
  produce_first_host_bundle
  case "$residual" in
    cosmos) mkdir -p "$FIRST_HOST_COSMOS"; printf 'residue\n' > "$FIRST_HOST_COSMOS/residue" ;;
    releases) mkdir -p "$FIRST_HOST_COSMOS/releases"; printf 'residue\n' > "$FIRST_HOST_COSMOS/releases/residue" ;;
    release-destination)
      release_id="$(node -e 'process.stdout.write(require(process.argv[1]).releaseId)' "$FIRST_HOST_RELEASE/release.json")"
      mkdir -p "$FIRST_HOST_COSMOS/releases/$release_id"
      ;;
    data) mkdir -p "$FIRST_HOST_DATA"; printf 'residue\n' > "$FIRST_HOST_DATA/residue" ;;
    ops) mkdir -p "$FIRST_HOST_OPS"; printf 'residue\n' > "$FIRST_HOST_OPS/residue" ;;
    journal) mkdir -p "$FIRST_HOST_DATA"; printf '{corrupt\n' > "$FIRST_HOST_DATA/journal-compat.json" ;;
    frozen) mkdir -p "$FIRST_HOST_OPS"; printf '{}\n' > "$FIRST_HOST_OPS/deploy-frozen.json" ;;
    money) mkdir -p "$FIRST_HOST_OPS"; : > "$FIRST_HOST_OPS/money-ready" ;;
  esac
  assert_failure first_host_preflight
done

produce_first_host_bundle
mkdir -p "$FIRST_HOST_DATA"
chmod 000 "$FIRST_HOST_DATA"
assert_failure first_host_preflight
chmod 700 "$FIRST_HOST_DATA"

note "first-host evidence chronology, cross-bindings, clean derivation, and bytes fail closed"
for mutation in short-lease cross-owner unit-unknown nonzero-floor frozen exposure ambiguity recovery env-digest release-cross; do
  produce_first_host_bundle
  mutate_first_host_bundle "$mutation"
  assert_failure first_host_preflight
done
produce_first_host_bundle
printf ' ' >> "$FIRST_HOST_BUNDLE/collected-evidence.json"
assert_failure_contains 'not canonical JSON' first_host_preflight
produce_first_host_bundle
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.evidenceSha256="0".repeat(64);fs.writeFileSync(p,`${JSON.stringify(v,null,2)}\n`);' "$FIRST_HOST_BUNDLE/host.json"
assert_failure first_host_preflight
for malformed_digest in abc zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz; do
  produce_first_host_bundle
  node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.evidenceSha256=process.argv[2];fs.writeFileSync(p,`${JSON.stringify(v,null,2)}\n`);' \
    "$FIRST_HOST_BUNDLE/host.json" "$malformed_digest"
  assert_failure_contains 'host preflight is not exact owner readback evidence' first_host_preflight
done
produce_first_host_bundle
assert_failure first_host_preflight deploy NO_PRIOR_RELEASE_FIRST_HOST 2026-07-13T00:20:00Z
produce_first_host_bundle 9000000000000000
assert_failure_contains 'insufficient disk' first_host_preflight
produce_first_host_bundle
mutate_first_host_bundle forged-huge-disk
assert_failure_contains 'insufficient disk' first_host_preflight

note "unbound non-Git release source is refused without simulation marking"
make_release_inputs "$TEST_TMP/unbound/source" "$TEST_TMP/unbound/deps" "$SHA" "$TEST_TMP/unbound/tested.json"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/unbound/source" --runtime-deps "$TEST_TMP/unbound/deps" --output-root "$TEST_TMP/unbound/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/unbound/tested.json" --built-at-utc 2026-07-13T00:00:00Z --config-revision c --model-revision m

note "WAL-reset-safe SQLite versions are exact"
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.53.3 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.51.3 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.50.7 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.44.6 fixture'
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.51.0 fixture'
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.50.6 fixture'
# F-109: the allowlist is non-monotonic by design - these are NEWER than
# 3.44.6 and still rejected; the locked behaviour prevents a false floor.
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.45.1 fixture'
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.46.1 fixture'
assert_failure_contains 'NOT accepted even though they are newer' node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.45.1'
finish
