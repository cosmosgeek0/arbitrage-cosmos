#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "validator cohort bridge admits only exact current or one content-pinned legacy tuple"
COUNT="$(node --input-type=module - "$I00_ROOT/cohort-compatibility.mjs" <<'NODE'
import { pathToFileURL } from 'node:url';
const {
  EXACT_TRUSTED_COHORT,
  PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256,
  PINNED_LEGACY_VALIDATION_ONLY,
  PINNED_LEGACY_VALIDATION_TUPLE,
  classifyValidatorCohort,
  pinnedLegacyL15ContractCompatibility,
  provePinnedLegacyValidatorCohort,
  recoveryTargetValidatorCohortAllowed,
  selectExpectedL15AmendmentContractSha256,
} = await import(pathToFileURL(process.argv[2]).href);
let assertions = 0;
const check = (condition) => {
  if (!condition) process.exit(1);
  assertions += 1;
};
const currentDigest = 'f'.repeat(64);
check(classifyValidatorCohort({
  trustedI00EnforcementTreeDigestSha256: currentDigest,
  releaseI00EnforcementTreeDigestSha256: currentDigest,
}) === EXACT_TRUSTED_COHORT);
check(provePinnedLegacyValidatorCohort({
  trustedI00EnforcementTreeDigestSha256: currentDigest,
  releaseI00EnforcementTreeDigestSha256: currentDigest,
}) === null);
const legacy = {
  trustedI00EnforcementTreeDigestSha256: currentDigest,
  ...PINNED_LEGACY_VALIDATION_TUPLE,
};
check(classifyValidatorCohort(legacy) === PINNED_LEGACY_VALIDATION_ONLY);
check(recoveryTargetValidatorCohortAllowed(EXACT_TRUSTED_COHORT) === true);
check(recoveryTargetValidatorCohortAllowed(PINNED_LEGACY_VALIDATION_ONLY) === true);
check(recoveryTargetValidatorCohortAllowed('UNTRUSTED_COHORT') === false);
const legacyProof = provePinnedLegacyValidatorCohort(legacy);
check(legacyProof !== null && Object.isFrozen(legacyProof));
const legacyL15Compatibility = pinnedLegacyL15ContractCompatibility(legacyProof);
check(legacyL15Compatibility !== null && Object.isFrozen(legacyL15Compatibility));
check(legacyL15Compatibility.amendmentContractSha256
  === PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256);
check(legacyL15Compatibility.requiresAuthorizedEffectRuntime === false);
check(legacyL15Compatibility.requiresBoundFileMode === false);
check(pinnedLegacyL15ContractCompatibility({}) === null);
for (const [key, value] of Object.entries(PINNED_LEGACY_VALIDATION_TUPLE)) {
  const replacement = value.length === 40 ? 'e'.repeat(40) : 'e'.repeat(64);
  check(classifyValidatorCohort({ ...legacy, [key]: replacement }) === null);
}
check(classifyValidatorCohort({
  ...legacy,
  trustedI00EnforcementTreeDigestSha256: 'not-a-digest',
}) === null);
check(classifyValidatorCohort({
  ...legacy,
  trustedI00EnforcementTreeDigestSha256: PINNED_LEGACY_VALIDATION_TUPLE.releaseI00EnforcementTreeDigestSha256,
  releaseI00EnforcementTreeDigestSha256: 'not-a-digest',
}) === null);
const nextTrustedAmendment = 'e'.repeat(64);
check(PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256
  === 'd60fdff586c1af91bfd92727ba49403bc0fd57210c4e76f1f5ee99391ee52581');
check(selectExpectedL15AmendmentContractSha256(
  EXACT_TRUSTED_COHORT,
  nextTrustedAmendment,
) === nextTrustedAmendment);
check(selectExpectedL15AmendmentContractSha256(
  PINNED_LEGACY_VALIDATION_ONLY,
  nextTrustedAmendment,
) === PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256);
check(selectExpectedL15AmendmentContractSha256(
  PINNED_LEGACY_VALIDATION_ONLY,
  nextTrustedAmendment,
) !== nextTrustedAmendment);
check(selectExpectedL15AmendmentContractSha256(
  PINNED_LEGACY_VALIDATION_ONLY,
  'not-a-digest',
) === null);
check(selectExpectedL15AmendmentContractSha256(
  'UNTRUSTED_COHORT',
  nextTrustedAmendment,
) === null);
process.stdout.write(String(assertions));
NODE
)"
assert_eq "$COUNT" 30

note "legacy bridge is exact-tuple recovery-target-only and cannot be selected by caller input"
SOURCE="$(cat "$I00_ROOT/bin/validate-release.mjs")"
assert_contains "$SOURCE" "classifyValidatorCohort"
assert_contains "$SOURCE" "provePinnedLegacyValidatorCohort"
assert_contains "$SOURCE" "recoveryTargetValidatorCohortAllowed"
assert_contains "$SOURCE" "selectExpectedL15AmendmentContractSha256"
assert_contains "$SOURCE" "validation-only legacy cohort compatibility cannot authorize a release effect"
assert_contains "$SOURCE" "pinned legacy rollback target must be an installed immutable release"
L15_SOURCE="$(cat "$I00_ROOT/l15-amendment.mjs")"
assert_contains "$L15_SOURCE" "pinnedLegacyL15ContractCompatibility"
assert_contains "$L15_SOURCE" "requiresAuthorizedEffectRuntime"
assert_contains "$L15_SOURCE" "requiresBoundFileMode"
if printf '%s' "$SOURCE" | grep -Eq -- '--(allow-legacy|cohort-mode|compatibility-mode)'; then
  fail_test "validator exposes a caller-selectable legacy bridge"
fi
pass_assertion
INSTALL_SOURCE="$(cat "$I00_ROOT/bin/install-ops-bundle.sh")"
assert_contains "$INSTALL_SOURCE" "EXACT_TRUSTED_COHORT"
assert_contains "$INSTALL_SOURCE" "cannot authorize installation"
for caller in install-ops-bundle.sh release-switch.sh; do
  assert_contains "$(cat "$I00_ROOT/bin/$caller")" "--require-exact-cohort"
  assert_failure grep -F -- "--require-recovery-target-cohort" "$I00_ROOT/bin/$caller"
done
ROLLBACK_SOURCE="$(cat "$I00_ROOT/bin/rollback-switch.sh")"
assert_contains "$ROLLBACK_SOURCE" "--require-recovery-target-cohort"
assert_contains "$ROLLBACK_SOURCE" "--installed-immutable"
assert_failure grep -F -- "--require-exact-cohort" "$I00_ROOT/bin/rollback-switch.sh"
assert_failure_contains "mutually exclusive" node "$I00_ROOT/bin/validate-release.mjs" \
  --release /nonexistent \
  --require-exact-cohort \
  --require-recovery-target-cohort

note "recorded acceptance Node provenance is lexical and host-neutral"
NODE_CASES="$(node --input-type=module - "$I00_ROOT/complete-acceptance-receipt.mjs" <<'NODE'
import { pathToFileURL } from 'node:url';
const { recordedNodeExecutableValid } = await import(pathToFileURL(process.argv[2]).href);
const cases = new Map([
  ['/opt/acceptance/bin/node', true],
  ['C:\\acceptance\\node.exe', true],
  ['relative/node', false],
  ['/opt/acceptance/../node', false],
  [' /opt/acceptance/node', false],
  ['/bin/sh', false],
]);
let passed = 0;
for (const [value, expected] of cases) {
  if (recordedNodeExecutableValid(value) !== expected) process.exit(1);
  passed += 1;
}
process.stdout.write(String(passed));
NODE
)"
assert_eq "$NODE_CASES" 6

finish
