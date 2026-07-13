import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  deriveManifestSha256,
  evaluateReleaseBoundExpectedManifest,
  RELEASE_CAPITAL_PATH_CATALOG,
  RELEASE_COCKPIT_PROJECTION_IDS,
  RELEASE_COMMAND_PATH_CATALOG,
  RELEASE_COMPONENT_CATALOG,
  RELEASE_DEPENDENCY_CATALOG,
  RELEASE_RECOVERY_PATH_CATALOG,
  RELEASE_SOURCE_CATALOG,
} from '../../../../fixtures/productAssurance/systemic/observability/release-manifest-evaluator.mjs';
import {
  canonicalJson,
  sha256Hex,
} from '../../../../fixtures/productAssurance/systemic/observability/canonical-sha256.mjs';

const fixtureUrl = new URL('../../../../fixtures/productAssurance/systemic/observability/cases/release-manifest-healthy.json', import.meta.url);
const cockpitContractsUrl = new URL('../../../../fixtures/productAssurance/systemic/cockpit/fixtures/panel-contracts.v1.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function rebindManifest(input) {
  const manifestSha256 = deriveManifestSha256(input.manifest);
  input.manifest.manifestSha256 = manifestSha256;
  input.observation.manifestSha256 = manifestSha256;
  input.observation.manifestDigestVerification.verifiedManifestSha256 = manifestSha256;
}

test('packet-local canonical SHA-256 matches stable JSON and UTF-8 vectors', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(canonicalJson({ z: 1, a: ['✓', true] }), '{"a":["✓",true],"z":1}');
  assert.equal(
    sha256Hex('✓'),
    '1dabba21cdad44541f6b15796f8d22978fc7ea10c46aeceeeeb66c23b3ac7604',
  );
});

test('healthy synthetic manifest passes the contract without claiming live green', async () => {
  const input = await fixture();
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.binding.result, 'PASS');
  assert.equal(output.overallResult, 'PASS');
  assert.equal(output.greenEligible, true);
  assert.equal(output.liveGreenEligible, false);
  assert.equal(output.denominatorCount, 75);
  assert.equal(output.observabilityCoveragePercent, 100);
  assert.deepEqual(output.ids.missing, []);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.items), true);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
});

test('canonical manifest owns exact release-bound component, source, topology, control, capital, recovery, and cockpit sets', async () => {
  const input = await fixture();
  const contractSet = JSON.parse(await readFile(cockpitContractsUrl, 'utf8'));
  const expectedProjectionIds = contractSet.contracts
    .map((contract) => `cockpit-projection:${contract.contractId}`)
    .sort();
  const manifestProjectionIds = input.manifest.expectedItems
    .filter((item) => item.kind === 'COCKPIT_PROJECTION')
    .map((item) => item.expectedId)
    .sort();
  const manifestProjectionItems = input.manifest.expectedItems
    .filter((item) => item.kind === 'COCKPIT_PROJECTION');
  const observedProjectionIds = input.observation.items
    .filter((item) => item.expectedId.startsWith('cockpit-projection:'))
    .map((item) => item.expectedId)
    .sort();
  const commandPaths = input.manifest.expectedItems.filter((item) => item.kind === 'COMMAND_PATH');
  assert.equal(expectedProjectionIds.length, 25);
  assert.deepEqual(expectedProjectionIds, [...RELEASE_COCKPIT_PROJECTION_IDS].sort());
  assert.equal(manifestProjectionItems.length, 25);
  assert.equal(manifestProjectionItems.every((item) => item.required && item.enabled), true);
  assert.deepEqual(
    commandPaths.map((item) => item.expectedId).sort(),
    RELEASE_COMMAND_PATH_CATALOG.map((entry) => entry.expectedId).sort(),
  );
  assert.equal(commandPaths.length, 6);
  assert.equal(commandPaths.every((item) => item.required && item.enabled), true);
  assert.equal(RELEASE_COMMAND_PATH_CATALOG.every((entry) => {
    const item = commandPaths.find((candidate) => candidate.expectedId === entry.expectedId);
    const reporter = input.observation.items.find((candidate) => candidate.expectedId === entry.expectedId);
    return item.ownerId === 'SYSTEM_INTEGRATION'
      && item.dependentCapabilityIds.includes(`control-contract:${entry.contractId}`)
      && item.dependentCapabilityIds.includes(`backend-mutation:${entry.backendMutationId}`)
      && reporter.controlState === 'LIVE'
      && reporter.dataMode === 'SYNTHETIC';
  }), true);
  const assertOwnerCatalog = (kind, catalog) => {
    const items = input.manifest.expectedItems.filter((item) => item.kind === kind);
    assert.deepEqual(
      items.map((item) => item.expectedId).sort(),
      catalog.map((entry) => entry.expectedId).sort(),
      kind,
    );
    for (const entry of catalog) {
      const item = items.find((candidate) => candidate.expectedId === entry.expectedId);
      assert.equal(item.ownerId, entry.ownerId, entry.expectedId);
    }
  };
  assertOwnerCatalog('COMPONENT', RELEASE_COMPONENT_CATALOG);
  assertOwnerCatalog('SOURCE', RELEASE_SOURCE_CATALOG);
  assertOwnerCatalog('CAPITAL_PATH', RELEASE_CAPITAL_PATH_CATALOG);
  assertOwnerCatalog('RECOVERY_PATH', RELEASE_RECOVERY_PATH_CATALOG);
  const dependencies = input.manifest.expectedItems.filter((item) => item.kind === 'DEPENDENCY');
  assert.equal(dependencies.length, 22);
  assert.equal(dependencies.filter((item) => item.required && item.enabled).length, 18);
  for (const edge of RELEASE_DEPENDENCY_CATALOG) {
    const item = dependencies.find((candidate) => candidate.expectedId === edge.expectedId);
    assert.equal(item.ownerId, edge.ownerId, edge.expectedId);
    assert.equal(item.required, edge.required, edge.expectedId);
    assert.equal(item.enabled, true, edge.expectedId);
  }
  assert.deepEqual(manifestProjectionIds, expectedProjectionIds);
  assert.deepEqual(observedProjectionIds, expectedProjectionIds);
  assert.equal(input.manifest.manifestId, 'manifest.release.fixture-001');
  assert.equal(input.manifest.manifestRevision, 4);
  assert.equal(input.manifest.manifestSha256, 'a4a4b1f6a23bd32ad63138a20425184024a7165c2f47dd00c9a2a6b200a64abf');
  assert.equal(input.manifest.binding.acceptedReleaseSha, '9785c93102b00389847b77c2f9348c06abc4344b');
  for (const key of ['testedReleaseSha', 'runningReleaseSha', 'deployedReleaseSha']) {
    assert.equal(input.observation[key], '9785c93102b00389847b77c2f9348c06abc4344b');
  }
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 75);
  assert.equal(output.items.length, 79);
  assert.equal(output.items.filter((item) => item.expectedId.startsWith('cockpit-projection:')).length, 25);
  assert.equal(output.items.filter((item) => item.expectedId.startsWith('cockpit-projection:') && item.blocking).length, 25);
  assert.equal(output.controls.expected, 6);
  assert.equal(output.controls.live, 6);
  assert.equal(output.exactInventory.result, 'PASS');
  assert.match(output.evaluationEvidence.evidenceSha256, /^[a-f0-9]{64}$/);
  const setExpectations = [
    ['components', 13, 13],
    ['sources', 4, 4],
    ['dependencies', 22, 18],
    ['capitalPaths', 4, 4],
    ['recoveryPaths', 4, 4],
    ['commandPaths', 6, 6],
    ['cockpitProjections', 25, 25],
    ['sentinels', 1, 1],
  ];
  for (const [key, total, requiredEnabled] of setExpectations) {
    assert.equal(output[key].result, 'PASS', key);
    assert.equal(output[key].expectedCount, total, key);
    assert.equal(output[key].expectedRequiredEnabledCount, requiredEnabled, key);
    assert.equal(output[key].matchedCount, total, key);
    assert.equal(output[key].evaluationEvidenceSha256, output.evaluationEvidence.evidenceSha256, key);
    assert.match(output[key].identitySetSha256, /^[a-f0-9]{64}$/, key);
    assert.equal(output[key].flagMismatchIds.length, 0, key);
  }
  assert.equal(output.overallResult, 'PASS');
  assert.equal(output.greenEligible, true);
  assert.equal(output.liveGreenEligible, false);
});

test('every canonical inventory kind rejects a rehashed self-authored omission or extra row', async () => {
  const cases = [
    ['components', 'COMPONENT', 'component:public-spot-source', 'component:unexpected'],
    ['sources', 'SOURCE', 'source-aggregation:spot-mini-ticker-universe', 'source-aggregation:unexpected'],
    ['dependencies', 'DEPENDENCY', 'dependency:ledger-persistence:public-spot-source', 'dependency:unexpected:unexpected'],
    ['capitalPaths', 'CAPITAL_PATH', 'capital-path:evidence-proposal-to-capital-mandate', 'capital-path:unexpected'],
    ['recoveryPaths', 'RECOVERY_PATH', 'recovery-path:kill-switch-risk-reduction', 'recovery-path:unexpected'],
    ['commandPaths', 'COMMAND_PATH', 'command-path:SET_KILL_SWITCH', 'command-path:UNEXPECTED'],
    ['cockpitProjections', 'COCKPIT_PROJECTION', 'cockpit-projection:PANEL_HEALTH_TRUTH_V1', 'cockpit-projection:UNEXPECTED'],
    ['sentinels', 'SENTINEL', 'independent-sentinel', 'independent-sentinel-extra'],
  ];
  for (const [outputKey, kind, canonicalId, extraId] of cases) {
    const omitted = await fixture();
    omitted.manifest.expectedItems = omitted.manifest.expectedItems
      .filter((item) => item.expectedId !== canonicalId);
    omitted.observation.items = omitted.observation.items
      .filter((item) => item.expectedId !== canonicalId);
    rebindManifest(omitted);
    const omittedOutput = evaluateReleaseBoundExpectedManifest(omitted);
    assert.equal(omittedOutput[outputKey].result, 'FAIL', `${kind} omission`);
    assert.ok(omittedOutput[outputKey].missingManifestIds.includes(canonicalId), `${kind} manifest omission`);
    assert.ok(omittedOutput[outputKey].missingObservedIds.includes(canonicalId), `${kind} reporter omission`);
    assert.equal(omittedOutput.greenEligible, false, `${kind} omission green`);

    const extra = await fixture();
    const expectedTemplate = structuredClone(
      extra.manifest.expectedItems.find((item) => item.kind === kind),
    );
    const observedTemplate = structuredClone(
      extra.observation.items.find((item) => item.expectedId === expectedTemplate.expectedId),
    );
    expectedTemplate.expectedId = extraId;
    observedTemplate.expectedId = extraId;
    extra.manifest.expectedItems.push(expectedTemplate);
    extra.observation.items.push(observedTemplate);
    rebindManifest(extra);
    const extraOutput = evaluateReleaseBoundExpectedManifest(extra);
    assert.equal(extraOutput[outputKey].result, 'FAIL', `${kind} extra`);
    assert.ok(extraOutput[outputKey].unexpectedManifestIds.includes(extraId), `${kind} manifest extra`);
    if (outputKey !== 'sentinels') {
      assert.ok(extraOutput[outputKey].unexpectedObservedIds.includes(extraId), `${kind} reporter extra`);
    }
    assert.equal(extraOutput.greenEligible, false, `${kind} extra green`);
  }
});

test('owner, required-flag, and backend-command binding drift fail the exact-set evidence law', async () => {
  for (const [outputKey, expectedId] of [
    ['components', 'component:market-universe'],
    ['sources', 'source-aggregation:spot-aggregate-trades'],
    ['dependencies', 'dependency:market-universe:intelligence-runtime'],
    ['capitalPaths', 'capital-path:capital-mandate-to-risk'],
    ['recoveryPaths', 'recovery-path:reconciliation-divergence'],
    ['commandPaths', 'command-path:SET_KILL_SWITCH'],
    ['cockpitProjections', 'cockpit-projection:PANEL_DASHBOARD_TRUTH_V1'],
    ['sentinels', 'independent-sentinel'],
  ]) {
    const input = await fixture();
    input.manifest.expectedItems.find((item) => item.expectedId === expectedId).ownerId = 'DRIFTED_OWNER';
    rebindManifest(input);
    const output = evaluateReleaseBoundExpectedManifest(input);
    assert.equal(output[outputKey].result, 'FAIL', expectedId);
    assert.ok(output[outputKey].flagMismatchIds.includes(expectedId), expectedId);
    assert.equal(output.greenEligible, false, expectedId);
  }

  const dependency = await fixture();
  const optionalId = 'dependency:public-usdm-source:market-universe';
  dependency.manifest.expectedItems.find((item) => item.expectedId === optionalId).required = true;
  rebindManifest(dependency);
  const dependencyOutput = evaluateReleaseBoundExpectedManifest(dependency);
  assert.equal(dependencyOutput.dependencies.result, 'FAIL');
  assert.ok(dependencyOutput.dependencies.flagMismatchIds.includes(optionalId));

  const command = await fixture();
  const commandId = 'command-path:SET_SAFE_MODE';
  const commandItem = command.manifest.expectedItems.find((item) => item.expectedId === commandId);
  commandItem.dependentCapabilityIds = commandItem.dependentCapabilityIds
    .map((id) => id.startsWith('backend-mutation:') ? 'backend-mutation:SYSTEM_INTEGRATION.WRONG' : id);
  rebindManifest(command);
  const commandOutput = evaluateReleaseBoundExpectedManifest(command);
  assert.equal(commandOutput.commandPaths.result, 'FAIL');
  assert.ok(commandOutput.commandPaths.flagMismatchIds.includes(commandId));
  assert.equal(commandOutput.greenEligible, false);
});

test('missing optional dependency reporter degrades without failing the required release gate', async () => {
  const input = await fixture();
  const optionalId = 'dependency:public-usdm-source:market-universe';
  input.observation.items = input.observation.items
    .filter((item) => item.expectedId !== optionalId);
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 75);
  assert.equal(output.dependencies.result, 'UNKNOWN');
  assert.deepEqual(output.dependencies.missingRequiredObservedIds, []);
  assert.deepEqual(output.dependencies.missingOptionalObservedIds, [optionalId]);
  assert.deepEqual(output.dependencies.advisoryReasonCodes, ['CANONICAL_OPTIONAL_REPORTER_INVENTORY_MISSING']);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
  assert.equal(output.liveGreenEligible, false);
});

test('one missing cockpit projection reporter retains the manifest denominator and is non-green', async () => {
  const input = await fixture();
  const missingId = 'cockpit-projection:PANEL_HEALTH_TRUTH_V1';
  input.observation.items = input.observation.items.filter((item) => item.expectedId !== missingId);
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 75);
  assert.equal(output.counts.missing, 1);
  assert.deepEqual(output.ids.missing, [missingId]);
  assert.equal(output.overallResult, 'FAIL');
  assert.equal(output.greenEligible, false);
  assert.deepEqual(output.items.find((item) => item.expectedId === missingId).reasonCodes, ['EXPECTED_ITEM_MISSING']);
});

test('evaluation evidence digest binds observation inventory, not only the release header', async () => {
  const healthy = evaluateReleaseBoundExpectedManifest(await fixture());
  const changedInput = await fixture();
  changedInput.observation.items = changedInput.observation.items
    .filter((item) => item.expectedId !== 'cockpit-projection:PANEL_HEALTH_TRUTH_V1');
  const changed = evaluateReleaseBoundExpectedManifest(changedInput);
  assert.equal(changed.evaluatedAtMs, healthy.evaluatedAtMs);
  assert.equal(changed.manifestSha256, healthy.manifestSha256);
  assert.equal(changed.acceptedReleaseSha, healthy.acceptedReleaseSha);
  assert.notEqual(changed.evaluationEvidence.observationSha256, healthy.evaluationEvidence.observationSha256);
  assert.notEqual(changed.evaluationEvidence.evidenceSha256, healthy.evaluationEvidence.evidenceSha256);
  assert.equal(healthy.overallResult, 'PASS');
  assert.equal(changed.overallResult, 'FAIL');
});

test('an unexpected reporter cannot enlarge the expected denominator', async () => {
  const input = await fixture();
  input.observation.items.push({
    ...structuredClone(input.observation.items.at(-1)),
    expectedId: 'self-added-reporter',
  });
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 75);
  assert.equal(output.counts.expected, 79);
  assert.equal(output.counts.discovered, 79);
  assert.equal(output.counts.instrumented, 79);
  assert.equal(output.observabilityCoveragePercent, 100);
  assert.deepEqual(output.ids.unexpectedObserved, ['self-added-reporter']);
  assert.deepEqual(output.observedInventoryIntegrity, {
    result: 'FAIL',
    reasonCodes: ['UNEXPECTED_OBSERVED_REPORTER'],
  });
  assert.equal(output.overallResult, 'FAIL');
  assert.equal(output.greenEligible, false);
  assert.equal(output.liveGreenEligible, false);
});

test('zero required and enabled denominator is UNKNOWN and never green', async () => {
  const input = await fixture();
  input.manifest.expectedItems.forEach((item) => {
    item.required = false;
    item.enabled = false;
  });
  rebindManifest(input);
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 0);
  assert.equal(output.observabilityCoveragePercent, null);
  assert.equal(output.denominator.result, 'UNKNOWN');
  assert.deepEqual(output.denominator.reasonCodes, ['EXPECTED_DENOMINATOR_EMPTY']);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
  assert.equal(output.liveGreenEligible, false);
});

test('manifest or tested/running/deployed release mismatch makes dependent completeness UNKNOWN', async () => {
  for (const field of ['manifestSha256', 'testedReleaseSha', 'runningReleaseSha', 'deployedReleaseSha']) {
    const input = await fixture();
    if (field === 'manifestSha256') input.observation[field] = 'f'.repeat(64);
    else input.observation[field] = '2'.repeat(40);
    const output = evaluateReleaseBoundExpectedManifest(input);
    assert.equal(output.binding.result, 'UNKNOWN', field);
    assert.equal(output.overallResult, 'UNKNOWN', field);
    assert.equal(output.greenEligible, false, field);
  }
});

test('orthogonal uninstrumented and unreconciled axes remain separately visible', async () => {
  const input = await fixture();
  const ledger = input.observation.items.find((item) => item.expectedId === 'component:ledger-persistence');
  ledger.telemetryState = 'UNINSTRUMENTED';
  ledger.reconciliationState = 'UNRECONCILED';
  ledger.telemetrySchemaVersion = null;
  ledger.lastTelemetryAtMs = null;
  const output = evaluateReleaseBoundExpectedManifest(input);
  const item = output.items.find((entry) => entry.expectedId === 'component:ledger-persistence');
  assert.equal(item.result, 'FAIL');
  assert.ok(item.reasonCodes.includes('EXPECTED_TELEMETRY_UNINSTRUMENTED'));
  assert.ok(item.reasonCodes.includes('RECONCILIATION_NOT_COMPLETE'));
  assert.equal(output.counts.instrumented, 78);
  assert.equal(output.counts.current, 79);
});

test('required unsupported or not-configured static manifest axes cannot pass', async () => {
  const input = await fixture();
  const expected = input.manifest.expectedItems[0];
  expected.supportState = 'UNSUPPORTED';
  expected.configurationState = 'NOT_CONFIGURED';
  rebindManifest(input);
  const output = evaluateReleaseBoundExpectedManifest(input);
  const item = output.items.find((entry) => entry.expectedId === expected.expectedId);
  assert.equal(item.result, 'FAIL');
  assert.ok(item.reasonCodes.includes('REQUIRED_ITEM_UNSUPPORTED'));
  assert.ok(item.reasonCodes.includes('REQUIRED_ITEM_NOT_CONFIGURED'));
  assert.equal(output.greenEligible, false);
});

test('required unavailable or blocked release posture cannot be green even when self-reported ready', async () => {
  const input = await fixture();
  input.manifest.expectedItems[0].expectedDataMode = 'UNAVAILABLE';
  input.manifest.expectedItems[0].expectedReleaseStatuses.push('BLOCKED');
  rebindManifest(input);
  input.observation.items[0].dataMode = 'UNAVAILABLE';
  input.observation.items[0].lifecycleAuthority.releaseStatuses.push('BLOCKED');
  const output = evaluateReleaseBoundExpectedManifest(input);
  const item = output.items.find((entry) => entry.expectedId === 'component:ledger-persistence');
  assert.equal(item.result, 'FAIL');
  assert.ok(item.reasonCodes.includes('EXPECTED_DATA_MODE_UNAVAILABLE'));
  assert.ok(item.reasonCodes.includes('EXPECTED_RELEASE_POSTURE_NON_GREEN'));
  assert.ok(item.reasonCodes.includes('OBSERVED_RELEASE_POSTURE_NON_GREEN'));
});

test('required static UNKNOWN stays UNKNOWN rather than passing', async () => {
  const input = await fixture();
  input.manifest.expectedItems[0].supportState = 'UNKNOWN';
  input.manifest.expectedItems[0].configurationState = 'UNKNOWN';
  rebindManifest(input);
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.items.find((entry) => entry.expectedId === 'component:ledger-persistence').result, 'UNKNOWN');
  assert.equal(output.overallResult, 'UNKNOWN');
});

test('claimed-current telemetry older than the injected age policy fails closed', async () => {
  const input = await fixture();
  input.observation.items[0].lastTelemetryAtMs = input.nowMs - input.manifest.observationMaximumAgeMs - 1;
  const output = evaluateReleaseBoundExpectedManifest(input);
  const item = output.items.find((entry) => entry.expectedId === 'component:ledger-persistence');
  assert.equal(item.result, 'FAIL');
  assert.ok(item.reasonCodes.includes('TELEMETRY_AGE_EXCEEDS_POLICY'));
});

test('required independent proof missing, future, or expired is UNKNOWN', async () => {
  const cases = [
    { value: null, code: 'INDEPENDENT_PROBE_TIMESTAMP_MISSING' },
    { value: 200001, code: 'INDEPENDENT_PROBE_TIMESTAMP_FROM_FUTURE' },
    { value: 198999, code: 'INDEPENDENT_PROBE_EVIDENCE_EXPIRED' },
  ];
  for (const scenario of cases) {
    const input = await fixture();
    input.observation.items[0].lastIndependentProbeAtMs = scenario.value;
    const output = evaluateReleaseBoundExpectedManifest(input);
    const item = output.items.find((entry) => entry.expectedId === 'component:ledger-persistence');
    assert.equal(item.result, 'UNKNOWN', scenario.code);
    assert.ok(item.reasonCodes.includes(scenario.code), scenario.code);
  }
});

test('global independent black-box FAIL or UNKNOWN prevents green', async () => {
  for (const result of ['FAIL', 'UNKNOWN']) {
    const input = await fixture();
    input.observation.lastIndependentBlackBoxProbe.result = result;
    const output = evaluateReleaseBoundExpectedManifest(input);
    assert.equal(output.independentBlackBoxProbe.result, result);
    assert.equal(output.overallResult, result);
    assert.equal(output.greenEligible, false);
  }
});

test('independent manifest digest evidence must pass with exact release-input digests and current time', async () => {
  const scenarios = [
    {
      mutate: (input) => { input.observation.manifestDigestVerification.result = 'FAIL'; },
      result: 'FAIL',
      code: 'MANIFEST_DIGEST_VERIFICATION_FAILED',
    },
    {
      mutate: (input) => { input.observation.manifestDigestVerification.verifiedManifestSha256 = 'f'.repeat(64); },
      result: 'FAIL',
      code: 'MANIFEST_DIGEST_VERIFICATION_SHA_MISMATCH',
    },
    {
      mutate: (input) => { input.observation.manifestDigestVerification.verifiedMissionCoverageSha256 = 'f'.repeat(64); },
      result: 'FAIL',
      code: 'MISSION_COVERAGE_DIGEST_VERIFICATION_MISMATCH',
    },
    {
      mutate: (input) => { input.observation.manifestDigestVerification.verifiedAtMs = null; },
      result: 'UNKNOWN',
      code: 'MANIFEST_DIGEST_VERIFICATION_TIME_MISSING',
    },
  ];
  for (const scenario of scenarios) {
    const input = await fixture();
    scenario.mutate(input);
    const output = evaluateReleaseBoundExpectedManifest(input);
    assert.equal(output.manifestDigestVerification.result, scenario.result, scenario.code);
    assert.ok(output.manifestDigestVerification.reasonCodes.includes(scenario.code), scenario.code);
    assert.equal(output.greenEligible, false, scenario.code);
  }
});

test('changing the expected manifest without changing its digest evidence fails binding', async () => {
  const input = await fixture();
  input.manifest.expectedItems.push({
    ...structuredClone(input.manifest.expectedItems.at(-1)),
    expectedId: 'digest-hidden-added-item',
  });
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.canonicalManifestDigest.result, 'FAIL');
  assert.notEqual(output.canonicalManifestDigest.derivedManifestSha256, input.manifest.manifestSha256);
  assert.deepEqual(output.canonicalManifestDigest.reasonCodes, ['MANIFEST_CANONICAL_DIGEST_MISMATCH']);
  assert.equal(output.binding.result, 'FAIL');
  assert.equal(output.overallResult, 'FAIL');
  assert.equal(output.greenEligible, false);
});

test('future manifest review time fails even with recomputed matching digest evidence', async () => {
  const input = await fixture();
  input.manifest.review.reviewedAtMs = input.nowMs + 1000;
  rebindManifest(input);
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.deepEqual(output.manifestReview, {
    result: 'FAIL',
    reviewerOwnerId: input.manifest.review.reviewerOwnerId,
    reviewEvidenceId: input.manifest.review.reviewEvidenceId,
    reviewedAtMs: input.nowMs + 1000,
    reasonCodes: ['MANIFEST_REVIEW_TIME_FROM_FUTURE'],
  });
  assert.equal(output.binding.result, 'FAIL');
  assert.ok(output.binding.reasonCodes.includes('MANIFEST_REVIEW_TIME_FROM_FUTURE'));
  assert.equal(output.overallResult, 'FAIL');
  assert.equal(output.greenEligible, false);
});

test('instrumented item telemetry schema must exactly match the expected manifest version', async () => {
  const input = await fixture();
  input.observation.items[0].telemetrySchemaVersion = 'telemetry.v2';
  const output = evaluateReleaseBoundExpectedManifest(input);
  const item = output.items.find((entry) => entry.expectedId === 'component:ledger-persistence');
  assert.equal(item.result, 'FAIL');
  assert.ok(item.reasonCodes.includes('TELEMETRY_SCHEMA_VERSION_MISMATCH'));
});

test('evaluation is deterministic and does not mutate its input', async () => {
  const input = await fixture();
  const before = structuredClone(input);
  const first = evaluateReleaseBoundExpectedManifest(input);
  const second = evaluateReleaseBoundExpectedManifest(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test('runtime contract rejects open shapes', async () => {
  const input = await fixture();
  input.manifest.unreviewedField = true;
  assert.throws(() => evaluateReleaseBoundExpectedManifest(input), /not allowed/);
});
