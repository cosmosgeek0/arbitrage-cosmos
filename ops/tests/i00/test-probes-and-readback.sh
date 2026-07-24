#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

cat > "$TEST_TMP/snapshot.json" <<'JSON'
{
  "source":"CANONICAL_SUPERVISOR_READBACK",
  "observedAtUtc":"2026-07-13T00:00:00Z",
  "dependencies":[{"id":"ledger","required":true,"state":"READY"},{"id":"q","required":false,"state":"NOT_CONFIGURED"}],
  "readiness":{"state":"READY","blockers":[],"observedAtUtc":"2026-07-13T00:00:00Z"},
  "tradeReadiness":{"state":"BLOCKED","blockers":["PRIVATE_TRUTH_NOT_CONFIGURED"],"observedAtUtc":"2026-07-13T00:00:00Z"},
  "recoveryReadiness":{"state":"READY","blockers":[],"observedAtUtc":"2026-07-13T00:00:00Z"}
}
JSON
note "independent dependency/readiness/trade/recovery probes"
PROBE=(--input "$TEST_TMP/snapshot.json" --simulation-clock --now 2026-07-13T00:00:30Z --max-age-sec 60)
assert_success node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind dependency
assert_success node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind readiness
assert_failure node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind trade-readiness
assert_success node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind recovery-readiness
probe_with_input() {
  node "$I00_ROOT/bin/probe.mjs" --input "$1" \
    --simulation-clock --now 2026-07-13T00:00:30Z \
    --max-age-sec 60 --kind readiness
}
note "supervisor probe input rejects raw path aliases"
assert_failure_contains 'absolute lexical canonical path' \
  probe_with_input snapshot.json
assert_failure_contains 'absolute lexical canonical path' \
  probe_with_input "$TEST_TMP/./snapshot.json"
ln -s "$TEST_TMP/snapshot.json" "$TEST_TMP/snapshot-leaf-alias"
assert_failure_contains 'single-link regular file' \
  probe_with_input "$TEST_TMP/snapshot-leaf-alias"
mkdir -p "$TEST_TMP/snapshot-real-parent"
cp "$TEST_TMP/snapshot.json" "$TEST_TMP/snapshot-real-parent/snapshot.json"
ln -s "$TEST_TMP/snapshot-real-parent" "$TEST_TMP/snapshot-parent-alias"
assert_failure_contains 'not physically canonical' \
  probe_with_input "$TEST_TMP/snapshot-parent-alias/snapshot.json"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.dependencies[0].state="STALE";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/snapshot.json"
assert_failure node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind dependency
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.dependencies[0].state="READY";v.dependencies[0].required="true";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/snapshot.json"
assert_failure node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind dependency
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.dependencies[0].required=true;v.observedAtUtc="2026-07-12T23:00:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/snapshot.json"
assert_failure node "$I00_ROOT/bin/probe.mjs" "${PROBE[@]}" --kind dependency

note "artifact-only deployment readback remains honestly blocked"
EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567
ALTERNATE_SHA=1111111111111111111111111111111111111111
cat > "$TEST_TMP/readback.json" <<'JSON'
{
  "testedSha":"0123456789abcdef0123456789abcdef01234567",
  "deployedSha":null,
  "releaseId":null,
  "schemaRevision":"UNKNOWN",
  "configRevision":"UNKNOWN",
  "modelRevision":"UNAVAILABLE",
  "services":[{"id":"cosmos-app","state":"NOT_CONFIGURED","source":"NOT_CONFIGURED"}],
  "origin":{"state":"NOT_CONFIGURED","source":"NOT_CONFIGURED"},
  "tunnel":{"state":"NOT_CONFIGURED","source":"NOT_CONFIGURED"},
  "access":{"state":"NOT_CONFIGURED","source":"NOT_CONFIGURED"},
  "watchdog":{"state":"NOT_CONFIGURED","source":"NOT_CONFIGURED"},
  "lastBackup":null,
  "lastRestoreDrill":null,
  "rollbackCandidate":null,
  "currentDeploymentBlocker":"EXTERNAL_AUTHORIZATION_AND_TARGET_INPUTS_ABSENT",
  "observedAtUtc":"2026-07-13T00:00:00Z"
}
JSON
READBACK_ARGS=(--input "$TEST_TMP/readback.json" --expected-sha "$EXPECTED_SHA" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z)
assert_success node "$I00_ROOT/bin/verify-readback.mjs" "${READBACK_ARGS[@]}"
verify_readback_with_input() {
  node "$I00_ROOT/bin/verify-readback.mjs" --input "$1" \
    --expected-sha "$EXPECTED_SHA" --max-age-sec 60 \
    --simulation-clock --now 2026-07-13T00:00:30Z
}
note "deployment readback input rejects raw path aliases"
assert_failure_contains 'absolute lexical canonical path' \
  verify_readback_with_input readback.json
assert_failure_contains 'absolute lexical canonical path' \
  verify_readback_with_input "$TEST_TMP/./readback.json"
ln -s "$TEST_TMP/readback.json" "$TEST_TMP/readback-leaf-alias"
assert_failure_contains 'single-link regular file' \
  verify_readback_with_input "$TEST_TMP/readback-leaf-alias"
mkdir -p "$TEST_TMP/readback-real-parent"
cp "$TEST_TMP/readback.json" "$TEST_TMP/readback-real-parent/readback.json"
ln -s "$TEST_TMP/readback-real-parent" "$TEST_TMP/readback-parent-alias"
assert_failure_contains 'not physically canonical' \
  verify_readback_with_input "$TEST_TMP/readback-parent-alias/readback.json"
cp "$TEST_TMP/readback.json" "$TEST_TMP/readback-extra-field.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p,"utf8"));v.unexpected=true;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback-extra-field.json"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" --input "$TEST_TMP/readback-extra-field.json" --expected-sha "$EXPECTED_SHA" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z
cp "$TEST_TMP/readback.json" "$TEST_TMP/readback-service-extra-field.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p,"utf8"));v.services[0].unexpected=true;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback-service-extra-field.json"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" --input "$TEST_TMP/readback-service-extra-field.json" --expected-sha "$EXPECTED_SHA" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" --input "$TEST_TMP/readback.json" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z
cp "$TEST_TMP/readback.json" "$TEST_TMP/readback-alternate-tested.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p,"utf8"));v.testedSha=process.argv[2];fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback-alternate-tested.json" "$ALTERNATE_SHA"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" --input "$TEST_TMP/readback-alternate-tested.json" --expected-sha "$EXPECTED_SHA" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z
cp "$TEST_TMP/readback.json" "$TEST_TMP/readback-alternate-deployed.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p,"utf8")),sha=process.argv[2];v.testedSha=sha;v.deployedSha=sha;v.releaseId=`i00-${sha}`;v.currentDeploymentBlocker=null;v.services=[{id:"cosmos-app",state:"READY",source:"READBACK"}];for(const [field,state] of Object.entries({origin:"PRIVATE",tunnel:"HEALTHY",access:"ENFORCED",watchdog:"HEALTHY"}))v[field]={state,source:"READBACK"};v.lastBackup={status:"BACKUP_VERIFIED",recordedAtUtc:"2026-07-13T00:00:00Z",receiptSha256:"a".repeat(64)};v.lastRestoreDrill={status:"ISOLATED_DRILL_PASS",recordedAtUtc:"2026-07-13T00:00:00Z",receiptSha256:"b".repeat(64)};v.rollbackCandidate="f".repeat(40);fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback-alternate-deployed.json" "$ALTERNATE_SHA"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" --input "$TEST_TMP/readback-alternate-deployed.json" --expected-sha "$EXPECTED_SHA" --max-age-sec 60 --simulation-clock --now 2026-07-13T00:00:30Z
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.currentDeploymentBlocker=null;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback.json"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" "${READBACK_ARGS[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.currentDeploymentBlocker="BLOCKED";v.services[0]={id:"cosmos-app",state:"READY",source:"NOT_CONFIGURED"};fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/readback.json"
assert_failure node "$I00_ROOT/bin/verify-readback.mjs" "${READBACK_ARGS[@]}"

note "Cloudflare boundary validator requires both outer and origin proof"
cat > "$TEST_TMP/cloudflare.json" <<'JSON'
{"source":"CLOUDFLARE_OWNER_READBACK","account":"cf-account-123","hostname":"control.private.invalid","tunnelId":"tunnel-123","accessApplicationId":"access-app-123","originHost":"127.0.0.1:8080","evidenceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tunnelState":"HEALTHY","directOriginReachable":false,"unauthenticatedAccessStatus":302,"authenticatedAccessStatus":200,"originRejectedMissingJwt":true,"originValidatedJwt":true,"stableEgressRequired":true,"expectedEgressIp":"192.0.2.10","observedEgressIp":"192.0.2.10","observedAtUtc":"2026-07-13T00:00:00Z"}
JSON
CF_ARGS=(--input "$TEST_TMP/cloudflare.json" --max-age-sec 60 --expected-hostname control.private.invalid --expected-account cf-account-123 --simulation-clock --now 2026-07-13T00:00:30Z)
assert_success node "$I00_ROOT/bin/verify-cloudflare-readback.mjs" "${CF_ARGS[@]}"
verify_cloudflare_with_input() {
  node "$I00_ROOT/bin/verify-cloudflare-readback.mjs" --input "$1" \
    --max-age-sec 60 --expected-hostname control.private.invalid \
    --expected-account cf-account-123 \
    --simulation-clock --now 2026-07-13T00:00:30Z
}
note "Cloudflare boundary input rejects raw path aliases"
assert_failure_contains 'absolute lexical canonical path' \
  verify_cloudflare_with_input cloudflare.json
assert_failure_contains 'absolute lexical canonical path' \
  verify_cloudflare_with_input "$TEST_TMP/./cloudflare.json"
ln -s "$TEST_TMP/cloudflare.json" "$TEST_TMP/cloudflare-leaf-alias"
assert_failure_contains 'single-link regular file' \
  verify_cloudflare_with_input "$TEST_TMP/cloudflare-leaf-alias"
mkdir -p "$TEST_TMP/cloudflare-real-parent"
cp "$TEST_TMP/cloudflare.json" "$TEST_TMP/cloudflare-real-parent/cloudflare.json"
ln -s "$TEST_TMP/cloudflare-real-parent" "$TEST_TMP/cloudflare-parent-alias"
assert_failure_contains 'not physically canonical' \
  verify_cloudflare_with_input "$TEST_TMP/cloudflare-parent-alias/cloudflare.json"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.originRejectedMissingJwt=false;fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/cloudflare.json"
assert_failure node "$I00_ROOT/bin/verify-cloudflare-readback.mjs" "${CF_ARGS[@]}"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.originRejectedMissingJwt=true;v.observedAtUtc="2026-07-12T23:00:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/cloudflare.json"
assert_failure node "$I00_ROOT/bin/verify-cloudflare-readback.mjs" "${CF_ARGS[@]}"
finish
