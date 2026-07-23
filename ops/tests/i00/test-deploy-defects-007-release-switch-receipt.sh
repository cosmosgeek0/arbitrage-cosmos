#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

RECORDER="$I00_ROOT/bin/record-release-switch-receipt.mjs"
SCHEMA="$I00_ROOT/schemas/release-switch-receipt.schema.json"
VALIDATOR="$I00_ROOT/bin/validate-receipt.mjs"
SHA=0123456789abcdef0123456789abcdef01234567
PRIOR_SHA=fedcba9876543210fedcba9876543210fedcba98
MANIFEST_SHA="$(printf 'a%.0s' {1..64})"
AUTH_SHA="$(printf 'b%.0s' {1..64})"
FIRST_HOST_SHA="$(printf 'c%.0s' {1..64})"

note "DEPLOY-DEFECTS-007(2): Gate 5 has a closed release-switch receipt owner"
assert_file "$RECORDER"
assert_file "$SCHEMA"
assert_contains "$(cat "$VALIDATOR")" "RELEASE_SWITCH: 'release-switch-receipt.schema.json'"

note "DEPLOY-DEFECTS-007(2): the receipt owner records one exact first-host switch"
CANONICAL_TEST_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$TEST_TMP")"
TARGET_ROOT="$CANONICAL_TEST_TMP/recorder-target"
RELEASE="$(assemble_fixture_release "$TARGET_ROOT/source-artifact" "$SHA")"
RELEASES_DIR="$TARGET_ROOT/releases"
INSTALLED_RELEASE="$RELEASES_DIR/i00-$SHA"
CURRENT_LINK="$TARGET_ROOT/current"
PREVIOUS_LINK="$TARGET_ROOT/previous"
SANITIZED_ENV="$CANONICAL_TEST_TMP/sanitized-deploy.env"
FAKE_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-active"
INACTIVE_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-inactive"
FAKE_CURL="$CANONICAL_TEST_TMP/curl-healthy"
FAILED_CURL="$CANONICAL_TEST_TMP/curl-failed"
RECEIPT_PARENT="$CANONICAL_TEST_TMP/release-switch-receipts"
RECORDED_RECEIPT="$RECEIPT_PARENT/first-host.json"
PREEXISTING_RECEIPT="$RECEIPT_PARENT/preexisting.json"
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
mkdir -m 700 "$RECEIPT_PARENT"
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
chmod 500 "$FAKE_SYSTEMCTL" "$INACTIVE_SYSTEMCTL" "$FAKE_CURL" "$FAILED_CURL"

RECORDER_COMMON=(
  --release "$RELEASE"
  --env "$SANITIZED_ENV"
  --authorization-sha256 "$AUTH_SHA"
  --artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA"
  --recovery-target NO_PRIOR_RELEASE_FIRST_HOST
  --first-host-evidence-sha256 "$FIRST_HOST_SHA"
  --curl "$FAKE_CURL"
  --donor-exit-code 0
  --started-at-utc 2026-07-23T00:00:00Z
  --simulation-clock
  --now 2026-07-23T00:00:01Z
)

assert_not_file "$RECORDED_RECEIPT"
CHECK_ONLY="$(node "$RECORDER" --check-only --output "$RECORDED_RECEIPT")"
assert_contains "$CHECK_ONLY" RELEASE_SWITCH_RECEIPT_TARGET_READY
assert_not_file "$RECORDED_RECEIPT"

RECORDED="$(
  node "$RECORDER" --output "$RECORDED_RECEIPT" \
    "${RECORDER_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
)"
assert_contains "$RECORDED" RELEASE_SWITCH_RECEIPT_RECORDED
assert_file "$RECORDED_RECEIPT"
assert_eq "$(
  node -e '
    const fs = require("fs");
    process.stdout.write((fs.statSync(process.argv[1]).mode & 0o777).toString(8));
  ' "$RECORDED_RECEIPT"
)" 600
assert_success node "$VALIDATOR" \
  --input "$RECORDED_RECEIPT" \
  --kind RELEASE_SWITCH \
  --expected-sha "$SHA" \
  --expected-artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA" \
  --expected-authorization-sha256 "$AUTH_SHA" \
  --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
  --expected-first-host-evidence-sha256 "$FIRST_HOST_SHA"

printf 'preserve-me\n' > "$PREEXISTING_RECEIPT"
chmod 600 "$PREEXISTING_RECEIPT"
assert_failure_contains '--output must be absent' node "$RECORDER" \
  --output "$PREEXISTING_RECEIPT" \
  "${RECORDER_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_eq "$(cat "$PREEXISTING_RECEIPT")" preserve-me

assert_not_file "$INACTIVE_RECEIPT"
assert_failure_contains 'application unit is not exactly active after the switch' \
  node "$RECORDER" --output "$INACTIVE_RECEIPT" \
    "${RECORDER_COMMON[@]}" --systemctl "$INACTIVE_SYSTEMCTL"
assert_not_file "$INACTIVE_RECEIPT"

assert_not_file "$FAILED_HEALTH_RECEIPT"
FAILED_HEALTH_COMMON=("${RECORDER_COMMON[@]}")
for index in "${!FAILED_HEALTH_COMMON[@]}"; do
  if [ "${FAILED_HEALTH_COMMON[$index]}" = --curl ]; then
    FAILED_HEALTH_COMMON[$((index + 1))]="$FAILED_CURL"
  fi
done
assert_failure_contains 'Gate-5 loopback health failed' \
  node "$RECORDER" --output "$FAILED_HEALTH_RECEIPT" \
  "${FAILED_HEALTH_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$FAILED_HEALTH_RECEIPT"

FAILED_DONOR_COMMON=("${RECORDER_COMMON[@]}")
for index in "${!FAILED_DONOR_COMMON[@]}"; do
  if [ "${FAILED_DONOR_COMMON[$index]}" = --donor-exit-code ]; then
    FAILED_DONOR_COMMON[$((index + 1))]=1
  fi
done
assert_not_file "$FAILED_DONOR_RECEIPT"
assert_failure_contains '--donor-exit-code must be exactly 0' \
  node "$RECORDER" --output "$FAILED_DONOR_RECEIPT" \
  "${FAILED_DONOR_COMMON[@]}" --systemctl "$FAKE_SYSTEMCTL"
assert_not_file "$FAILED_DONOR_RECEIPT"

note "DEPLOY-DEFECTS-007(2): competing output and link races fail without collateral deletion"
COMPETING_SYSTEMCTL="$CANONICAL_TEST_TMP/systemctl-competing-output"
cat > "$COMPETING_SYSTEMCTL" <<SH
#!/usr/bin/env bash
[ "\$#" -eq 2 ] && [ "\$1" = is-active ] && [ "\$2" = cosmos-app.service ] || exit 9
printf 'competitor\\n' > "$COMPETING_RECEIPT"
chmod 600 "$COMPETING_RECEIPT"
printf 'active\\n'
SH
chmod 500 "$COMPETING_SYSTEMCTL"
assert_not_file "$COMPETING_RECEIPT"
assert_failure_contains 'release-switch receipt exact-create failed' \
  node "$RECORDER" --output "$COMPETING_RECEIPT" \
  "${RECORDER_COMMON[@]}" --systemctl "$COMPETING_SYSTEMCTL"
assert_eq "$(cat "$COMPETING_RECEIPT")" competitor

ALTERNATE_RELEASE="$RELEASES_DIR/i00-$PRIOR_SHA"
PRIOR_SOURCE_RELEASE="$(assemble_fixture_release "$TARGET_ROOT/prior-source-artifact" "$PRIOR_SHA")"
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
assert_not_file "$MUTATED_LINK_RECEIPT"
assert_failure_contains 'CURRENT_LINK target differs from the exact release' \
  node "$RECORDER" --output "$MUTATED_LINK_RECEIPT" \
  "${RECORDER_COMMON[@]}" --systemctl "$MUTATING_SYSTEMCTL"
assert_not_file "$MUTATED_LINK_RECEIPT"
assert_eq "$(readlink "$CURRENT_LINK")" "$ALTERNATE_RELEASE"
rm "$CURRENT_LINK"
ln -s "$INSTALLED_RELEASE" "$CURRENT_LINK"

note "DEPLOY-DEFECTS-007(2): later releases preserve one distinct direct rollback target"
ln -s "$ALTERNATE_RELEASE" "$PREVIOUS_LINK"
LATER_COMMON=(
  --release "$RELEASE"
  --env "$SANITIZED_ENV"
  --authorization-sha256 "$AUTH_SHA"
  --artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA"
  --systemctl "$FAKE_SYSTEMCTL"
  --curl "$FAKE_CURL"
  --donor-exit-code 0
  --started-at-utc 2026-07-23T00:00:00Z
  --simulation-clock
  --now 2026-07-23T00:00:01Z
)
assert_success node "$RECORDER" --output "$LATER_RECEIPT" "${LATER_COMMON[@]}"
assert_success node "$VALIDATOR" \
  --input "$LATER_RECEIPT" \
  --kind RELEASE_SWITCH \
  --expected-sha "$SHA" \
  --expected-artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA" \
  --expected-authorization-sha256 "$AUTH_SHA"
assert_failure node "$VALIDATOR" \
  --input "$LATER_RECEIPT" \
  --kind RELEASE_SWITCH \
  --expected-sha "$SHA" \
  --expected-artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA" \
  --expected-authorization-sha256 "$AUTH_SHA" \
  --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
  --expected-first-host-evidence-sha256 "$FIRST_HOST_SHA"

cat > "$TEST_TMP/release-switch.json" <<JSON
{
  "schemaVersion": 1,
  "kind": "RELEASE_SWITCH",
  "releaseId": "i00-$SHA",
  "testedSha": "$SHA",
  "deployedSha": "$SHA",
  "artifactManifestSha256": "$MANIFEST_SHA",
  "authorizationSha256": "$AUTH_SHA",
  "recoveryTarget": "NO_PRIOR_RELEASE_FIRST_HOST",
  "firstHostEvidenceSha256": "$FIRST_HOST_SHA",
  "current": {
    "link": "/opt/cosmos/current",
    "target": "/opt/cosmos/releases/i00-$SHA",
    "releaseId": "i00-$SHA"
  },
  "previous": {
    "link": "/opt/cosmos/previous",
    "state": "ABSENT",
    "target": null
  },
  "service": {
    "unit": "cosmos-app.service",
    "state": "ACTIVE"
  },
  "postSwitchGate": {
    "base": "http://127.0.0.1:8080",
    "paths": ["/health/live", "/health/ready"],
    "status": "PASS"
  },
  "donorExitCode": 0,
  "status": "RELEASE_SWITCH_PROVED",
  "startedAtUtc": "2026-07-23T00:00:00Z",
  "completedAtUtc": "2026-07-23T00:00:01Z",
  "recordedAtUtc": "2026-07-23T00:00:01Z"
}
JSON

VALID_ARGS=(
  --input "$TEST_TMP/release-switch.json"
  --kind RELEASE_SWITCH
  --expected-sha "$SHA"
  --expected-artifact-manifest-sha256 "$MANIFEST_SHA"
  --expected-authorization-sha256 "$AUTH_SHA"
  --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST
  --expected-first-host-evidence-sha256 "$FIRST_HOST_SHA"
)
assert_success node "$VALIDATOR" "${VALID_ARGS[@]}"
assert_failure node "$VALIDATOR" \
  --input "$TEST_TMP/release-switch.json" \
  --kind RELEASE_SWITCH \
  --expected-sha "$SHA" \
  --expected-artifact-manifest-sha256 "$MANIFEST_SHA" \
  --expected-authorization-sha256 "$AUTH_SHA"

note "DEPLOY-DEFECTS-007(2): receipt chronology, nesting, and rollback identity are closed"
for mutation in previous-current previous-outside impossible-time reversed-time nested-extra noncanonical-link; do
  node - "$LATER_RECEIPT" "$TEST_TMP/$mutation.json" "$mutation" <<'NODE'
const fs = require('fs');
const [source, target, mutation] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
if (mutation === 'previous-current') receipt.previous.target = receipt.current.target;
else if (mutation === 'previous-outside') receipt.previous.target = `/tmp/i00-${'d'.repeat(40)}`;
else if (mutation === 'impossible-time') receipt.startedAtUtc = '2026-02-30T00:00:00Z';
else if (mutation === 'reversed-time') receipt.startedAtUtc = '2026-07-23T00:00:02Z';
else if (mutation === 'nested-extra') receipt.service.unexpected = true;
else if (mutation === 'noncanonical-link') receipt.current.link = receipt.current.link.replace('/current', '//current');
fs.writeFileSync(target, `${JSON.stringify(receipt)}\n`);
NODE
  assert_failure node "$VALIDATOR" \
    --input "$TEST_TMP/$mutation.json" \
    --kind RELEASE_SWITCH \
    --expected-sha "$SHA" \
    --expected-artifact-manifest-sha256 "$FIXTURE_MANIFEST_SHA" \
    --expected-authorization-sha256 "$AUTH_SHA"
done

note "DEPLOY-DEFECTS-007(2): later-gate facts are forbidden at Gate 5"
for field in cloudflareBoundary watchdog backup restore reconciliation; do
  node - "$TEST_TMP/release-switch.json" "$TEST_TMP/with-$field.json" "$field" <<'NODE'
const fs = require('fs');
const [source, target, field] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
receipt[field] = { status: 'NOT_A_GATE_5_FACT' };
fs.writeFileSync(target, JSON.stringify(receipt));
NODE
  assert_failure node "$VALIDATOR" --input "$TEST_TMP/with-$field.json" --kind RELEASE_SWITCH \
    --expected-sha "$SHA" --expected-artifact-manifest-sha256 "$MANIFEST_SHA" \
    --expected-authorization-sha256 "$AUTH_SHA" \
    --expected-recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
    --expected-first-host-evidence-sha256 "$FIRST_HOST_SHA"
done

note "DEPLOY-DEFECTS-007(2): final deployment still retains every later fact"
DEPLOYMENT_SCHEMA="$(cat "$I00_ROOT/schemas/deployment-receipt.schema.json")"
for field in cloudflareBoundary watchdog backup restore reconciliation; do
  assert_contains "$DEPLOYMENT_SCHEMA" "\"$field\""
done

finish
