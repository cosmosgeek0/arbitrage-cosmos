#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "all JSON templates and schemas parse"
JSON_COUNT=0
while IFS= read -r file; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file"
  JSON_COUNT=$((JSON_COUNT + 1))
done < <(find "$REPO_ROOT/ops/templates/i00" "$I00_ROOT/schemas" -type f \( -name '*.json' -o -name '*.json.template' \) | LC_ALL=C sort)
assert_eq "$JSON_COUNT" 15

note "systemd ordering, credential, loopback, and honest Q placeholder"
APP_DROPIN="$(cat "$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-i00.conf.template")"
PROVIDER_UNIT="$(cat "$REPO_ROOT/ops/templates/i00/systemd/cosmos-secrets-provider.service.template")"
Q_UNIT="$(cat "$REPO_ROOT/ops/templates/i00/systemd/cosmos-q.service.template")"
assert_contains "$APP_DROPIN" 'Requires=cosmos-secrets-provider.service'
assert_contains "$APP_DROPIN" 'After=cosmos-secrets-provider.service'
assert_contains "$APP_DROPIN" 'LoadCredential=app-secrets:/run/cosmos-secret-source/app-secrets.json'
assert_contains "$PROVIDER_UNIT" 'Before=cosmos-app.service'
assert_contains "$PROVIDER_UNIT" 'NoNewPrivileges=yes'
assert_contains "$Q_UNIT" 'ConditionPathExists=/opt/cosmos/current/REPLACE_ME_Q_ENTRYPOINT'
assert_contains "$Q_UNIT" '--bind 127.0.0.1'

note "Cloudflare Access, monitoring bounds, and exact IAM semantics"
CF="$(cat "$REPO_ROOT/ops/templates/i00/cloudflare/origin-access-overlay.yml.template")"
CW="$(cat "$REPO_ROOT/ops/templates/i00/aws/cloudwatch-agent.json.template")"
ALARMS="$(cat "$REPO_ROOT/ops/templates/i00/aws/cloudwatch-alarms.json.template")"
IAM="$(cat "$REPO_ROOT/ops/templates/i00/aws/iam-secrets-exact-policy.json.template")"
KMS="$(cat "$REPO_ROOT/ops/templates/i00/aws/iam-secrets-customer-kms-policy.json.template")"
ROTATE="$(cat "$REPO_ROOT/ops/templates/i00/logrotate/cosmos-ops")"
assert_contains "$CF" 'required: true'
assert_contains "$CF" 'noTLSVerify: false'
assert_contains "$CW" '"retention_in_days": 30'
assert_contains "$ALARMS" '"treatMissingData": "breaching"'
assert_contains "$ALARMS" 'canonical runtime supervisor; ops must not synthesize this metric'
assert_contains "$IAM" 'REPLACE_ME_EXACT_SECRET_ARN_WITH_SIX_CHARACTER_SUFFIX'
if printf '%s' "$IAM" | grep -F 'secret:*' >/dev/null; then fail_test 'secret IAM policy uses wildcard'; fi
pass_assertion
assert_contains "$KMS" 'kms:EncryptionContext:SecretARN'
assert_contains "$KMS" 'kms:ViaService'
assert_contains "$ROTATE" 'rotate 14'
assert_contains "$ROTATE" 'maxsize 10M'

note "deprecated and unsafe patterns are absent"
SCAN="$(find "$REPO_ROOT/ops/i00" "$REPO_ROOT/ops/templates/i00" -type f -print0 | xargs -0 cat)"
for forbidden in 'secretsmanager:KmsKeyId' 'kms:CustomerMasterKeySpec' 'nextSequenceToken' 'noTLSVerify: true' 'AWS_SECRET_ACCESS_KEY='; do
  if printf '%s' "$SCAN" | grep -F "$forbidden" >/dev/null; then fail_test "forbidden pattern present: $forbidden"; fi
  pass_assertion
done

note "non-secret environment validator rejects placeholders, public bind, and secrets"
cat > "$TEST_TMP/runtime.env" <<'ENV'
HOST=127.0.0.1
PORT=8080
DATA_DIR=/var/lib/cosmos/data
EVIDENCE_DIR=/var/lib/cosmos/evidence
MODEL_DIR=/var/lib/cosmos/models
BACKUP_DIR=/var/backups/cosmos
CONTROL_ROOM_OPERATOR_EMAIL=operator@private.invalid
CF_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com
CF_ACCESS_AUD=audience_12345678
I00_TESTED_SHA=0123456789abcdef0123456789abcdef01234567
I00_CONFIG_REVISION=config-1
I00_MODEL_REVISION=UNAVAILABLE
I00_PUBLIC_SOURCE_STARTUP_EGRESS=1
ENV
assert_success node "$I00_ROOT/bin/validate-config.mjs" --env "$TEST_TMP/runtime.env"
sed 's/HOST=127.0.0.1/HOST=0.0.0.0/' "$TEST_TMP/runtime.env" > "$TEST_TMP/public.env"
assert_failure node "$I00_ROOT/bin/validate-config.mjs" --env "$TEST_TMP/public.env"
cp "$TEST_TMP/runtime.env" "$TEST_TMP/secret.env"
printf 'BINANCE_API_SECRET=FAKE_BUT_FORBIDDEN_HERE\n' >> "$TEST_TMP/secret.env"
assert_failure node "$I00_ROOT/bin/validate-config.mjs" --env "$TEST_TMP/secret.env"

note "receipt validators require hashed external evidence and reject forged proof states"
EXPECTED_SHA='0123456789abcdef0123456789abcdef01234567'
ALTERNATE_SHA='1111111111111111111111111111111111111111'
cat > "$TEST_TMP/release-receipt.json" <<'JSON'
{"schemaVersion":1,"kind":"RELEASE","releaseId":"i00-0123456789abcdef0123456789abcdef01234567","testedSha":"0123456789abcdef0123456789abcdef01234567","artifactManifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"VALIDATED_NOT_DEPLOYED","recordedAtUtc":"2026-07-13T00:00:00Z"}
JSON
assert_success node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/release-receipt.json" --kind RELEASE

EVIDENCE_ROOT="$TEST_TMP/evidence"
mkdir -p "$EVIDENCE_ROOT/deployment" "$EVIDENCE_ROOT/rollback"
for file in release-manifest target-readback cloudflare-boundary watchdog backup restore reconciliation authorization; do
  printf '{"fixture":"deployment/%s"}\n' "$file" > "$EVIDENCE_ROOT/deployment/$file.json"
done
for file in pre-target-readback post-target-readback cloudflare-boundary watchdog database-schema backup recovery reconciliation authorization; do
  printf '{"fixture":"rollback/%s"}\n' "$file" > "$EVIDENCE_ROOT/rollback/$file.json"
done
node - "$EVIDENCE_ROOT" <<'NODE'
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[2];
const tested = '0123456789abcdef0123456789abcdef01234567';
const prior = 'fedcba9876543210fedcba9876543210fedcba98';
const write = (path, value) => writeFileSync(join(root, path), `${JSON.stringify(value)}\n`);
write('deployment/release-manifest.json', {releaseId:`i00-${tested}`,testedSha:tested,files:[{path:'server/dist/index.js',sha256:'a'.repeat(64)}]});
write('deployment/target-readback.json', {status:'DEPLOYMENT_READBACK_VALID',testedSha:tested,deployedSha:tested,releaseId:`i00-${tested}`,blocker:null,observedAtUtc:'2026-07-13T00:01:10Z'});
write('deployment/cloudflare-boundary.json', {status:'CLOUDFLARE_BOUNDARY_VERIFIED',hostname:'control.private.invalid',observedAtUtc:'2026-07-13T00:01:11Z'});
write('deployment/watchdog.json', {status:'WATCHDOG_HEALTHY',source:'OWNER_READBACK',observedAtUtc:'2026-07-13T00:01:12Z'});
write('deployment/backup.json', {kind:'BACKUP',status:'BACKUP_VERIFIED',sourceSha:tested,recordedAtUtc:'2026-07-13T00:01:13Z'});
write('deployment/restore.json', {kind:'RESTORE',status:'ISOLATED_DRILL_PASS',isolated:true,recordedAtUtc:'2026-07-13T00:01:14Z'});
write('deployment/reconciliation.json', {status:'RECONCILED',deployedSha:tested,observedAtUtc:'2026-07-13T00:01:15Z'});
write('deployment/authorization.json', {authorizationId:'auth-deploy-1',status:'APPROVED',actionClasses:['SERVICE_RELEASE_SWITCH']});
write('rollback/pre-target-readback.json', {status:'DEPLOYMENT_READBACK_VALID',deployedSha:prior,releaseId:`i00-${prior}`,blocker:null,observedAtUtc:'2026-07-13T00:03:10Z'});
write('rollback/post-target-readback.json', {status:'DEPLOYMENT_READBACK_VALID',deployedSha:tested,releaseId:`i00-${tested}`,blocker:null,observedAtUtc:'2026-07-13T00:04:10Z'});
write('rollback/cloudflare-boundary.json', {status:'CLOUDFLARE_BOUNDARY_VERIFIED',hostname:'control.private.invalid',observedAtUtc:'2026-07-13T00:04:11Z'});
write('rollback/watchdog.json', {status:'WATCHDOG_HEALTHY',source:'OWNER_READBACK',observedAtUtc:'2026-07-13T00:04:12Z'});
write('rollback/database-schema.json', {status:'SCHEMA_COMPATIBLE',toSha:tested});
write('rollback/backup.json', {kind:'BACKUP',status:'BACKUP_VERIFIED',sourceSha:prior,recordedAtUtc:'2026-07-13T00:03:20Z'});
write('rollback/recovery.json', {status:'RECOVERY_READY',source:'CANONICAL_SUPERVISOR_READBACK',observedAtUtc:'2026-07-13T00:04:13Z'});
write('rollback/reconciliation.json', {status:'RECONCILED',deployedSha:tested,observedAtUtc:'2026-07-13T00:04:14Z'});
write('rollback/authorization.json', {authorizationId:'auth-rollback-1',status:'APPROVED',actionClasses:['SERVICE_ROLLBACK']});
NODE

node - "$EVIDENCE_ROOT" "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/rollback-receipt.json" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [root, deploymentPath, rollbackPath] = process.argv.slice(2);
const reference = (path) => ({
  path,
  sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex'),
});
const testedSha = '0123456789abcdef0123456789abcdef01234567';
writeFileSync(deploymentPath, `${JSON.stringify({
  schemaVersion: 1,
  kind: 'DEPLOYMENT',
  releaseId: `i00-${testedSha}`,
  testedSha,
  deployedSha: testedSha,
  evidence: {
    releaseManifest: reference('deployment/release-manifest.json'),
    targetReadback: reference('deployment/target-readback.json'),
    cloudflareBoundary: reference('deployment/cloudflare-boundary.json'),
    watchdog: reference('deployment/watchdog.json'),
    backup: reference('deployment/backup.json'),
    restore: reference('deployment/restore.json'),
    reconciliation: reference('deployment/reconciliation.json'),
    authorization: reference('deployment/authorization.json'),
  },
  status: 'DEPLOYED_PROVED',
  startedAtUtc: '2026-07-13T00:00:00Z',
  completedAtUtc: '2026-07-13T00:01:00Z',
  recordedAtUtc: '2026-07-13T00:02:00Z',
})}\n`);
writeFileSync(rollbackPath, `${JSON.stringify({
  schemaVersion: 1,
  kind: 'ROLLBACK',
  fromSha: 'fedcba9876543210fedcba9876543210fedcba98',
  toSha: testedSha,
  evidence: {
    preTargetReadback: reference('rollback/pre-target-readback.json'),
    postTargetReadback: reference('rollback/post-target-readback.json'),
    cloudflareBoundary: reference('rollback/cloudflare-boundary.json'),
    watchdog: reference('rollback/watchdog.json'),
    databaseSchema: reference('rollback/database-schema.json'),
    backup: reference('rollback/backup.json'),
    recovery: reference('rollback/recovery.json'),
    reconciliation: reference('rollback/reconciliation.json'),
    authorization: reference('rollback/authorization.json'),
  },
  status: 'ROLLED_BACK_PROVED',
  startedAtUtc: '2026-07-13T00:03:00Z',
  completedAtUtc: '2026-07-13T00:04:00Z',
  recordedAtUtc: '2026-07-13T00:05:00Z',
})}\n`);
NODE

DEPLOYMENT_ARGS=(--kind DEPLOYMENT --evidence-root "$EVIDENCE_ROOT" --expected-sha "$EXPECTED_SHA")
assert_success node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-receipt.json" "${DEPLOYMENT_ARGS[@]}"
assert_success node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/rollback-receipt.json" --kind ROLLBACK --evidence-root "$EVIDENCE_ROOT"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-receipt.json" --kind DEPLOYMENT --evidence-root "$EVIDENCE_ROOT"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-receipt.json" --kind DEPLOYMENT --expected-sha "$EXPECTED_SHA"

note "deployment receipt rejects a self-consistent alternate SHA against the candidate anchor"
cp -R "$EVIDENCE_ROOT" "$TEST_TMP/evidence-alternate"
cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-alternate.json"
node - "$TEST_TMP/evidence-alternate" "$TEST_TMP/deploy-alternate.json" "$ALTERNATE_SHA" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [root, receiptPath, alternate] = process.argv.slice(2);
const releaseId = `i00-${alternate}`;
const rewrite = (relativePath, mutate) => {
  const path = join(root, relativePath);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
};
rewrite('deployment/release-manifest.json', (value) => {
  value.testedSha = alternate;
  value.releaseId = releaseId;
});
rewrite('deployment/target-readback.json', (value) => {
  value.testedSha = alternate;
  value.deployedSha = alternate;
  value.releaseId = releaseId;
});
rewrite('deployment/backup.json', (value) => { value.sourceSha = alternate; });
rewrite('deployment/reconciliation.json', (value) => { value.deployedSha = alternate; });
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
receipt.testedSha = alternate;
receipt.deployedSha = alternate;
receipt.releaseId = releaseId;
for (const reference of Object.values(receipt.evidence)) {
  reference.sha256 = createHash('sha256')
    .update(readFileSync(join(root, reference.path)))
    .digest('hex');
}
writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
NODE
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-alternate.json" --kind DEPLOYMENT --evidence-root "$TEST_TMP/evidence-alternate" --expected-sha "$EXPECTED_SHA"

cp "$EVIDENCE_ROOT/deployment/watchdog.json" "$TEST_TMP/watchdog-valid.json"
printf '{"fixture":"self-authored-but-hashed"}\n' > "$EVIDENCE_ROOT/deployment/watchdog.json"
cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-semantic-forgery.json"
node -e 'const c=require("crypto"),fs=require("fs"),p=process.argv[1],e=process.argv[2],v=JSON.parse(fs.readFileSync(p));v.evidence.watchdog.sha256=c.createHash("sha256").update(fs.readFileSync(e)).digest("hex");fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-semantic-forgery.json" "$EVIDENCE_ROOT/deployment/watchdog.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-semantic-forgery.json" "${DEPLOYMENT_ARGS[@]}"
mv "$TEST_TMP/watchdog-valid.json" "$EVIDENCE_ROOT/deployment/watchdog.json"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-hash-mismatch.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.evidence.backup.sha256="b".repeat(64);fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-hash-mismatch.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-hash-mismatch.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-missing-file.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.evidence.backup.path="deployment/missing.json";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-missing-file.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-missing-file.json" "${DEPLOYMENT_ARGS[@]}"

ln -s target-readback.json "$EVIDENCE_ROOT/deployment/target-readback-link.json"
cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-symlink.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.evidence.targetReadback.path="deployment/target-readback-link.json";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-symlink.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-symlink.json" "${DEPLOYMENT_ARGS[@]}"

printf '{"fixture":"outside"}\n' > "$TEST_TMP/outside-evidence.json"
cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-escape.json"
node -e 'const c=require("crypto"),fs=require("fs"),p=process.argv[1],outside=process.argv[2],v=JSON.parse(fs.readFileSync(p));v.evidence.releaseManifest={path:"../outside-evidence.json",sha256:c.createHash("sha256").update(fs.readFileSync(outside)).digest("hex")};fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-escape.json" "$TEST_TMP/outside-evidence.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-escape.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-legacy-booleans.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.serviceReadback={requiredServicesReady:true,reconciled:true};fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-legacy-booleans.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-legacy-booleans.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-failed-status.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.status="FAILED";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-failed-status.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-failed-status.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-bad-chronology.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.completedAtUtc="2026-07-13T00:03:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-bad-chronology.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-bad-chronology.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-missing-evidence.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));delete v.evidence.restore;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-missing-evidence.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-missing-evidence.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/deploy-receipt.json" "$TEST_TMP/deploy-duplicate-evidence.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.evidence.backup={...v.evidence.restore};fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/deploy-duplicate-evidence.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/deploy-duplicate-evidence.json" "${DEPLOYMENT_ARGS[@]}"

cp "$TEST_TMP/rollback-receipt.json" "$TEST_TMP/rollback-same-sha.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.fromSha=v.toSha;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/rollback-same-sha.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/rollback-same-sha.json" --kind ROLLBACK --evidence-root "$EVIDENCE_ROOT"

cp "$TEST_TMP/rollback-receipt.json" "$TEST_TMP/rollback-failed-status.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.status="FAILED";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/rollback-failed-status.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/rollback-failed-status.json" --kind ROLLBACK --evidence-root "$EVIDENCE_ROOT"

cp "$TEST_TMP/rollback-receipt.json" "$TEST_TMP/rollback-missing-evidence.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));delete v.evidence.databaseSchema;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/rollback-missing-evidence.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/rollback-missing-evidence.json" --kind ROLLBACK --evidence-root "$EVIDENCE_ROOT"

assert_success node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));if(s.properties.status.const!=="DEPLOYED_PROVED"||!s.required.includes("evidence")||s.properties.serviceReadback)process.exit(1);' "$I00_ROOT/schemas/deployment-receipt.schema.json"
assert_success node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));if(s.properties.status.const!=="ROLLED_BACK_PROVED"||!s.required.includes("evidence")||s.properties.schemaCompatible)process.exit(1);' "$I00_ROOT/schemas/rollback-receipt.schema.json"

cat > "$TEST_TMP/restore-receipt.json" <<'JSON'
{"schemaVersion":1,"kind":"RESTORE","backupId":"backup-1","isolated":true,"appInactive":false,"integrityCheck":"ok","foreignKeyViolations":0,"target":"/tmp/isolated","status":"ISOLATED_DRILL_PASS","authorizationReference":null,"recordedAtUtc":"2026-07-13T00:00:00Z"}
JSON
assert_success node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/restore-receipt.json" --kind RESTORE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.status="PRODUCTION_RESTORE_PROVED";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/restore-receipt.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/restore-receipt.json" --kind RESTORE
cat > "$TEST_TMP/incident-receipt.json" <<'JSON'
{"schemaVersion":1,"kind":"INCIDENT","incidentId":"incident-1","fingerprint":"watchdog:host-1","severity":"CRITICAL","rootCause":"canonical watchdog missed","capitalRelevance":"UNKNOWN","firstSeenUtc":"2026-07-13T00:00:00Z","lastSeenUtc":"2026-07-13T00:01:00Z","status":"OPEN","operatorAction":"inspect target readback","correlationIds":["corr-1"]}
JSON
assert_success node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/incident-receipt.json" --kind INCIDENT
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.severity="SEVERE";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/incident-receipt.json"
assert_failure node "$I00_ROOT/bin/validate-receipt.mjs" --input "$TEST_TMP/incident-receipt.json" --kind INCIDENT
finish
