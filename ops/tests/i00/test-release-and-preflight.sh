#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

SHA=0123456789abcdef0123456789abcdef01234567
REAL_TMP="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-install-$$")"
cleanup_release_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_release_test EXIT
note "assemble SHA-keyed immutable release from tested inputs"
RELEASE="$(assemble_fixture_release "$TEST_TMP/release" "$SHA")"
assert_file "$RELEASE/release.json"
assert_file "$RELEASE/artifact-manifest.json"
assert_file "$RELEASE/server/dist/index.js"
assert_file "$RELEASE/web/dist/index.html"
assert_file "$RELEASE/node_modules/fake-runtime/package.json"
VALID="$(node "$I00_ROOT/bin/validate-release.mjs" --release "$RELEASE" --allow-simulation)"
assert_contains "$VALID" RELEASE_VALID_NOT_DEPLOYED
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$RELEASE"
assert_contains "$(cat "$RELEASE/release.json")" '"activationState": "NOT_DEPLOYED"'
assert_contains "$(cat "$RELEASE/release.json")" '"serverDistDigestSha256"'
assert_contains "$(cat "$RELEASE/release.json")" '"webDistDigestSha256"'
assert_contains "$(cat "$RELEASE/artifact-manifest.json")" '"testedBuildOutputs"'
assert_contains "$(cat "$RELEASE/release.json")" '"status": "SIMULATION_ONLY_NOT_ATTESTED"'
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.releaseId)' "$RELEASE/release.json")" "i00-$SHA"
INSTALLED_I00="$SIMULATION_ROOT/installed-i00"
INSTALL_OUT="$("$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE" --destination "$INSTALLED_I00" --simulation --simulation-root "$SIMULATION_ROOT")"
assert_contains "$INSTALL_OUT" OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION
assert_file "$INSTALLED_I00/bin/app-entrypoint.mjs"
assert_file "$INSTALLED_I00/accepted-ops-live/bin/deploy.sh"
assert_file "$INSTALLED_I00/install-receipt.json"
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.serviceMutationPerformed))' "$INSTALLED_I00/install-receipt.json")" false
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(v.acceptedDonorCommit)' "$INSTALLED_I00/install-receipt.json")" 2cec412927fa2f64f05a0b2774b18e45f8ce4fa5
assert_failure "$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE" --destination /usr/local/lib/cosmos-ops/i00 --simulation --simulation-root "$SIMULATION_ROOT"

note "production assembly requires and reverifies exact owner/CI Ed25519 provenance"
PROD_ROOT="$TEST_TMP/production-release"
make_release_inputs "$PROD_ROOT/source" "$PROD_ROOT/deps" "$SHA" "$PROD_ROOT/tested.json"
git -C "$PROD_ROOT/source" init -q
git -C "$PROD_ROOT/source" config user.name 'I00 fixture builder'
git -C "$PROD_ROOT/source" config user.email 'i00-fixture@example.invalid'
git -C "$PROD_ROOT/source" add .
git -C "$PROD_ROOT/source" commit -q -m 'fixture production source'
PROD_SHA="$(git -C "$PROD_ROOT/source" rev-parse HEAD)"
PROD_TREE="$(git -C "$PROD_ROOT/source" rev-parse 'HEAD^{tree}')"
node -e '
  const fs=require("fs"), path=process.argv[1], sha=process.argv[2], tree=process.argv[3];
  const value=JSON.parse(fs.readFileSync(path,"utf8"));
  value.testedSha=sha; value.sourceTree=tree;
  fs.writeFileSync(path,`${JSON.stringify(value,null,2)}\n`);
' "$PROD_ROOT/tested.json" "$PROD_SHA" "$PROD_TREE"
node --input-type=module - "$PROD_ROOT/tested.json" "$PROD_ROOT/build-attestation.json" "$PROD_ROOT/build-attestation.sig" "$PROD_ROOT/build-public.pem" "$PROD_ROOT/ephemeral-private.pem" <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [receiptPath, attestationPath, signaturePath, publicKeyPath, privateKeyPath] = process.argv.slice(2);
const receiptBytes = readFileSync(receiptPath);
const receipt = JSON.parse(receiptBytes);
const attestation = {
  schemaVersion: 1,
  attestationType: 'I00_PRODUCTION_BUILD_V1',
  testedSha: receipt.testedSha,
  sourceTree: receipt.sourceTree,
  testedReceiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
  packageLockSha256: receipt.packageLockSha256,
  runtimeDepsDigestSha256: receipt.runtimeDepsDigestSha256,
  serverDistDigestSha256: receipt.serverDistDigestSha256,
  webDistDigestSha256: receipt.webDistDigestSha256,
  requiredCommands: [
    { command: 'npm test', exitCode: 0 },
    { command: 'npm run test:all', exitCode: 0 },
    { command: 'bash ops/tests/i00/run-all.sh', exitCode: 0 },
  ],
  testsCompletedAtUtc: receipt.completedAtUtc,
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
PROD_ASSEMBLE=(node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/releases" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --schema-version 7 --config-revision config-fixture --model-revision UNAVAILABLE --build-attestation "$PROD_ROOT/build-attestation.json" --build-attestation-signature "$PROD_ROOT/build-attestation.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem")
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/missing-proof" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --schema-version 7 --config-revision c --model-revision m
assert_success "${PROD_ASSEMBLE[@]}"
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
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/forged-out" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --schema-version 7 --config-revision c --model-revision m --build-attestation "$PROD_ROOT/build-attestation.json" --build-attestation-signature "$PROD_ROOT/forged.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem"

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
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$PROD_ROOT/source" --runtime-deps "$PROD_ROOT/deps" --output-root "$PROD_ROOT/mismatch-out" --tested-sha "$PROD_SHA" --tested-receipt "$PROD_ROOT/tested.json" --built-at-utc 2026-07-13T00:01:00Z --schema-version 7 --config-revision c --model-revision m --build-attestation "$PROD_ROOT/mismatched-attestation.json" --build-attestation-signature "$PROD_ROOT/mismatched-attestation.sig" --build-attestation-public-key "$PROD_ROOT/build-public.pem"

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
cp -R "$RELEASE" "$TEST_TMP/mode-tampered"
chmod -x "$TEST_TMP/mode-tampered/ops/i00/bin/install-ops-bundle.sh"
assert_failure node "$I00_ROOT/bin/validate-release.mjs" --release "$TEST_TMP/mode-tampered" --allow-simulation
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.gitDirty=true;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/release/tested.json"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/release/source" --runtime-deps "$TEST_TMP/release/deps" --output-root "$TEST_TMP/dirty-out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/release/tested.json" --built-at-utc 2026-07-13T00:00:00Z --schema-version 7 --config-revision c --model-revision m --simulation-source

note "tested build-output digests reject post-receipt mutation before destination creation"
make_release_inputs "$TEST_TMP/server-mutation/source" "$TEST_TMP/server-mutation/deps" "$SHA" "$TEST_TMP/server-mutation/tested.json"
printf '\n// post-test mutation\n' >> "$TEST_TMP/server-mutation/source/server/dist/index.js"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/server-mutation/source" --runtime-deps "$TEST_TMP/server-mutation/deps" --output-root "$TEST_TMP/server-mutation/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/server-mutation/tested.json" --built-at-utc 2026-07-13T00:00:00Z --schema-version 7 --config-revision c --model-revision m --simulation-source
assert_not_file "$TEST_TMP/server-mutation/out/i00-$SHA"
make_release_inputs "$TEST_TMP/web-mutation/source" "$TEST_TMP/web-mutation/deps" "$SHA" "$TEST_TMP/web-mutation/tested.json"
printf '\n<!-- post-test mutation -->\n' >> "$TEST_TMP/web-mutation/source/web/dist/index.html"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/web-mutation/source" --runtime-deps "$TEST_TMP/web-mutation/deps" --output-root "$TEST_TMP/web-mutation/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/web-mutation/tested.json" --built-at-utc 2026-07-13T00:00:00Z --schema-version 7 --config-revision c --model-revision m --simulation-source
assert_not_file "$TEST_TMP/web-mutation/out/i00-$SHA"

note "deployment preflight freezes on disk, recovery, and migration ambiguity"
cat > "$TEST_TMP/host.json" <<'JSON'
{"source":"TARGET_HOST_OWNER_READBACK","account":"simulation-account","targetHost":"fixture-host.internal","environment":"simulation","freeBytes":10000000,"backupReserveBytes":1000,"sqliteVersion":"3.53.3","evidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","observedAtUtc":"2026-07-13T00:00:00Z"}
JSON
cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:00Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":7,"rollbackFloor":5}
JSON
PREFLIGHT=(node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --mode deploy --now 2026-07-13T00:01:00Z --max-host-age-sec 300 --max-supervisor-age-sec 120 --required-supervisor-window-sec 130)
assert_success "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.recoveryState="RECOVERY_REQUIRED";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.observedAtUtc="2026-07-12T23:00:00Z";v.validUntilUtc="2026-07-13T00:10:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.recoveryState="NONE";v.observedAtUtc="2026-07-13T00:00:00Z";v.rollbackFloor=8;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
PREFLIGHT[9]=rollback
assert_failure "${PREFLIGHT[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.rollbackFloor=5;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
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
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:00Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":7,"rollbackFloor":5}
JSON
done
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.validUntilUtc="2026-07-13T00:01:30Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/supervisor.json"
assert_failure "${PREFLIGHT[@]}"

note "unbound non-Git release source is refused without simulation marking"
make_release_inputs "$TEST_TMP/unbound/source" "$TEST_TMP/unbound/deps" "$SHA" "$TEST_TMP/unbound/tested.json"
assert_failure node "$I00_ROOT/bin/assemble-release.mjs" --source-root "$TEST_TMP/unbound/source" --runtime-deps "$TEST_TMP/unbound/deps" --output-root "$TEST_TMP/unbound/out" --tested-sha "$SHA" --tested-receipt "$TEST_TMP/unbound/tested.json" --built-at-utc 2026-07-13T00:00:00Z --schema-version 7 --config-revision c --model-revision m

note "WAL-reset-safe SQLite versions are exact"
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.53.3 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.51.3 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.50.7 fixture'
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.44.6 fixture'
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.51.0 fixture'
assert_failure node "$I00_ROOT/bin/verify-sqlite-version.mjs" --version '3.50.6 fixture'
finish
