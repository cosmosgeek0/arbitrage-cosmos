import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalize,
  createProviderFacetBinding,
  parseExtensionDescriptor,
  runFixtureLoad,
  sha256,
  validateInsertionRequest,
  validateMaxSafeRateClaim,
  validateResourceBudgetClaim,
} from '../../dock/src/index.mjs';
import {
  CAPITAL_MEASURE_KEYS,
  DIMENSION_KEYS,
  DOCK_SHA,
  FRONTIER_BASE_SHA,
  MAX_BATCH_ITEMS,
  MAX_REPORT_BYTES,
  OWNER_REFERENCE_KEYS,
  RECORD_STATES,
  addExactDecimals,
  assertExactDecimal,
  bindEdgeMeterFacet,
  capitalWaterfallProjection,
  compareExactDecimals,
  createEdgeMeterReport,
  edgeMeterInputHash,
  invokeEdgeMeterAdvisory,
  invokeEdgeMeterCockpitProjection,
  ownerProjectionHashes,
  parseEdgeMeterBatch,
  projectEdgeMeterCockpit,
  routeEdgeMeterReport,
  subtractExactDecimals,
  sumExactDecimals,
  validateEdgeMeterReport,
  validateEdgeMeterBatch,
  validateEdgeMeterInput,
  validateOwnerReference,
} from '../src/index.mjs';

const MODULE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(MODULE_ROOT, relativePath), 'utf8'));
}

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

function setPath(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  const leaf = parts.pop();
  let cursor = target;
  for (const part of parts) {
    cursor = /^(?:0|[1-9][0-9]*)$/.test(part) ? cursor[Number(part)] : cursor[part];
  }
  cursor[leaf] = clone(value);
}

function scenarioInput(scenarioId) {
  const scenario = patchMatrix.scenarios.find((row) => row.scenarioId === scenarioId);
  assert.ok(scenario, `missing fixture scenario ${scenarioId}`);
  const input = clone(baseFixture);
  input.reportId = `fixture-${scenarioId}`;
  for (const [dottedPath, value] of Object.entries(scenario.set)) setPath(input, dottedPath, value);
  return rebindOwnerProjections(input);
}

function rebindOwnerProjections(value) {
  const items = Array.isArray(value.items) ? value.items : [value];
  for (const item of items) {
    const hashes = ownerProjectionHashes(item);
    for (const key of OWNER_REFERENCE_KEYS) {
      item.ownerRefs[key].projectionContentHash = item.ownerRefs[key].state === 'AVAILABLE'
        ? hashes[key]
        : null;
    }
  }
  return value;
}

function rehashReport(value) {
  for (const record of value.records ?? []) {
    const recordPayload = clone(record);
    delete recordPayload.recordHash;
    record.recordHash = sha256(recordPayload);
  }
  const reportPayload = clone(value);
  delete reportPayload.reportHash;
  value.reportHash = sha256(reportPayload);
  return value;
}

function unavailableReference(reference, state, reasonCode) {
  return {
    ...reference,
    recordId: null,
    recordRevision: null,
    contentHash: null,
    projectionContentHash: null,
    eventTimeMs: null,
    availableAtMs: null,
    state,
    reasonCodes: [reasonCode],
  };
}

function sha256Bytes(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const baseFixture = readJson('fixtures/complete-real.v1.json');
const patchMatrix = readJson('fixtures/scenario-patches.v1.json');
const attributablePreview = readJson('preview/attributable.v1.json');
const rejectPreview = readJson('preview/reference-only-reject.v1.json');
const emptyPreview = readJson('preview/empty.v1.json');
const schema = readJson('contracts/v1/edge-meter-v1.schema.json');
const ownerReuseMap = readJson('contracts/v1/owner-reuse-map.v1.json');
const facetRefs = readJson('contracts/v1/facet-binding-refs.v1.json');
const resourceBudgetClaim = readJson('contracts/v1/resource-budget-claim.v1.json');
const maxSafeRateClaim = readJson('contracts/v1/max-safe-rate-claim.v1.json');
const sourceHashes = readJson('contracts/v1/source-hashes.v1.json');
const insertionRequest = readJson('contracts/v1/insertion-request.v1.json');
const dockOwnerMap = readRepoJson('frontier/dock/contracts/v1/canonical-owner-map.json');

function dockBinding(facetClass) {
  return dockOwnerMap.facets.find((binding) => binding.facetClass === facetClass);
}

test('01 complete REAL fixture is deterministic, immutable, and attributable', () => {
  assert.equal(validateEdgeMeterBatch(baseFixture), true);
  const first = createEdgeMeterReport(baseFixture);
  const second = createEdgeMeterReport(clone(baseFixture));
  assert.deepEqual(second, first);
  assert.equal(first.reportState, 'ATTRIBUTABLE');
  assert.equal(first.reportHash, '0281b383c780cdf65f949518837dad7c20c07d7fca7af1105c3cb888c959b099');
  assert.equal(first.stateCounts.ATTRIBUTABLE, 1);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.records[0].ownerRefs), true);
  assert.throws(() => { first.records[0].status = 'DIVERGENT'; });
});

test('02 parser clones and deep-freezes caller-owned fixture values', () => {
  const supplied = clone(baseFixture);
  const parsed = parseEdgeMeterBatch(supplied);
  supplied.items[0].measurementId = 'caller-mutated';
  assert.equal(parsed.items[0].measurementId, 'fixture-measurement-acted-001');
  assert.equal(Object.isFrozen(parsed.items[0].qEvidence.selectionEvidence), true);
});

test('03 all declared fixture scenarios reach their exact evidence state', () => {
  for (const scenario of patchMatrix.scenarios) {
    const report = createEdgeMeterReport(scenarioInput(scenario.scenarioId));
    assert.equal(report.reportState, scenario.expectedState, scenario.scenarioId);
    assert.equal(report.records[0].status, scenario.expectedState, scenario.scenarioId);
  }
});

test('04 empty input is explicit insufficient evidence, never a flat zero', () => {
  const report = createEdgeMeterReport({
    schema: 'EdgeMeterBatchInputV1',
    version: 1,
    reportId: 'fixture-empty',
    evaluatedAtMs: 170000,
    items: [],
  });
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.equal(report.inputRecordCount, 0);
  assert.equal(report.records.length, 0);
  assert.equal(Object.values(report.stateCounts).every((count) => count === 0), true);
  assert.deepEqual(projectEdgeMeterCockpit(report), emptyPreview);
});

test('05 Capital net and measures are projected exactly and are never recomputed', () => {
  const report = createEdgeMeterReport(baseFixture);
  const record = report.records[0];
  const waterfall = capitalWaterfallProjection(record);
  assert.equal(record.status, 'ATTRIBUTABLE');
  assert.equal(waterfall.canonicalNetKnown, '10.2');
  assert.equal(waterfall.totalsRecomputed, false);
  assert.equal(report.capitalNetRecomputed, false);
  assert.equal(report.breakdowns.strategy.rows[0].aggregateAmount, null);
  assert.equal(report.breakdowns.strategy.rows[0].rankingProduced, false);

  const tampered = clone(baseFixture);
  tampered.items[0].capitalProjection.netKnown = '999';
  assertCode(() => createEdgeMeterReport(tampered), 'EDGE_OWNER_PROJECTION_HASH_MISMATCH');
});

test('06 non-zero Capital unexplained residual cannot produce attributable output', () => {
  const input = clone(baseFixture);
  input.items[0].capitalProjection.measures.unexplainedResidual.knownAmount = '0.01';
  rebindOwnerProjections(input);
  const report = createEdgeMeterReport(input);
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(report.records[0].reasonCodes.includes('CAPITAL_UNRESOLVED_RESIDUAL_NON_ZERO'));
});

test('07 divergent Capital residual dominates all weaker evidence states', () => {
  const input = scenarioInput('abstain-unknown');
  const residual = input.items[0].capitalProjection.measures.unexplainedResidual;
  residual.status = 'DIVERGENT';
  residual.knownAmount = null;
  residual.reasonCodes = ['OWNER_COMPONENT_DIVERGENT'];
  rebindOwnerProjections(input);
  const report = createEdgeMeterReport(input);
  assert.equal(report.reportState, 'DIVERGENT');
  assert.ok(report.records[0].reasonCodes.includes('CAPITAL_UNRESOLVED_RESIDUAL_DIVERGENT'));
});

test('08 gross timing bridge is a separate non-accounting identity', () => {
  const record = createEdgeMeterReport(baseFixture).records[0];
  assert.equal(record.grossBridge.identityProven, true);
  assert.equal(record.grossBridge.aggregationRole, 'NON_ACCOUNTING_SIGNAL_TIMING_BRIDGE');
  assert.equal(record.grossBridge.includedInCapitalNet, false);
  assert.equal(record.grossBridge.latencyIsMonetary, false);
});

test('09 gross bridge mismatch is divergent and bridge residual is explicit', () => {
  const divergent = createEdgeMeterReport(scenarioInput('bridge-identity-divergent'));
  assert.equal(divergent.reportState, 'DIVERGENT');
  assert.ok(divergent.records[0].reasonCodes.includes('GROSS_BRIDGE_IDENTITY_MISMATCH'));

  const residual = clone(baseFixture);
  residual.items[0].grossBridge.bridgeResidual = '0.1';
  residual.items[0].grossBridge.timingEffect = '-2.1';
  rebindOwnerProjections(residual);
  const report = createEdgeMeterReport(residual);
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(report.records[0].reasonCodes.includes('GROSS_BRIDGE_RESIDUAL_NON_ZERO'));
});

test('10 Q values are reference-only and never recomputed or recalibrated', () => {
  const report = createEdgeMeterReport(baseFixture);
  const projection = report.records[0].qEvidence.selectionEvidenceProjection;
  assert.equal(projection.MULTIPLE_TESTING.displayValue, 'PBO=0.12');
  assert.equal(projection.DEFLATED_PERFORMANCE.displayValue, 'DSR=0.71');
  assert.equal(projection.SELECTION_PRESSURE.displayValue, 'TRIAL_COUNT=24');
  assert.equal(Object.values(projection).every((row) => row.recomputedByEdgeMeter === false), true);
  assert.equal(report.qStatisticsRecomputed, false);
  assert.equal(report.calibrationPerformed, false);
  assert.equal(report.modelSelectionPerformed, false);
});

test('11 Q abstention is preserved and suppresses attributable status', () => {
  const report = createEdgeMeterReport(scenarioInput('abstain-unknown'));
  assert.equal(report.reportState, 'ABSTAIN_UNKNOWN');
  assert.deepEqual(report.records[0].reasonCodes, ['Q_ABSTAIN:COVERAGE_COLLAPSED']);
  assert.equal(report.records[0].comparabilitySignature, null);
});

test('12 historical fit and failed point-in-time controls are non-comparable', () => {
  const historical = createEdgeMeterReport(scenarioInput('historical-fit-non-comparable'));
  assert.equal(historical.reportState, 'NON_COMPARABLE');
  assert.ok(historical.records[0].reasonCodes.includes('HISTORICAL_FIT_NOT_FORWARD_EVIDENCE'));

  const input = clone(baseFixture);
  input.items[0].qEvidence.pointInTimeJoinState = 'UNPROVEN';
  rebindOwnerProjections(input);
  const pointInTime = createEdgeMeterReport(input);
  assert.equal(pointInTime.reportState, 'NON_COMPARABLE');
  assert.ok(pointInTime.records[0].reasonCodes.includes('Q_POINT_IN_TIME_JOIN_UNPROVEN'));
});

test('13 pre-decision references arriving after cutoff are non-comparable', () => {
  const report = createEdgeMeterReport(scenarioInput('point-in-time-cutoff-violation'));
  assert.equal(report.reportState, 'NON_COMPARABLE');
  assert.ok(report.records[0].reasonCodes.includes('POINT_IN_TIME_CUTOFF_VIOLATION:ASSESSMENT'));
});

test('14 premature outcome projections and future-arriving references diverge', () => {
  const immature = createEdgeMeterReport(scenarioInput('outcome-not-mature'));
  assert.equal(immature.reportState, 'DIVERGENT');
  assert.ok(immature.records[0].reasonCodes.includes('OUTCOME_HORIZON_NOT_MATURE'));
  assert.ok(immature.records[0].reasonCodes.includes('POST_HORIZON_REFERENCE_PREMATURE:OUTCOME'));

  const input = clone(baseFixture);
  input.items[0].ownerRefs.outcome.availableAtMs = 180000;
  rebindOwnerProjections(input);
  const future = createEdgeMeterReport(input);
  assert.equal(future.reportState, 'DIVERGENT');
  assert.ok(future.records[0].reasonCodes.includes('REFERENCE_AVAILABLE_AFTER_EVALUATION:OUTCOME'));
});

test('15 missing required owner evidence remains insufficient, not zero', () => {
  const report = createEdgeMeterReport(scenarioInput('missing-required-cost-reference'));
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(report.records[0].reasonCodes.includes('REQUIRED_REFERENCE_MISSING:COSTS'));
  assert.equal(report.records[0].dimensions.turnover.value, null);
  assert.equal(report.records[0].dimensions.capacity.value, null);
});

test('16 unknown breakdowns remain explicit and produce no local monetary totals', () => {
  const report = createEdgeMeterReport(scenarioInput('unknown-capacity-breakdown'));
  const row = report.breakdowns.capacity.rows[0];
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.equal(row.dimensionState, 'UNKNOWN');
  assert.equal(row.aggregateAmount, null);
  assert.equal(row.aggregationState, 'REFERENCE_ONLY_NO_LOCAL_PNL_TOTAL');
});

test('17 reject projection preserves canonical reasons and forbids monetary counterfactuals', () => {
  const report = createEdgeMeterReport(scenarioInput('reference-only-reject'));
  const record = report.records[0];
  assert.equal(record.status, 'ATTRIBUTABLE');
  assert.equal(record.cohort, 'REJECTED');
  assert.deepEqual(record.decisionDisposition.reasonCodes, ['CAPITAL_POLICY_REJECTED']);
  assert.equal(record.decisionDisposition.monetaryRejectEffect, null);
  assert.equal(record.capitalProjection.state, 'NOT_APPLICABLE');
  assert.equal(record.grossBridge.state, 'NOT_APPLICABLE');
  assert.deepEqual(projectEdgeMeterCockpit(report), rejectPreview);
});

test('18 non-acted cohorts cannot carry Capital or gross monetary projections', () => {
  const input = clone(baseFixture);
  input.items[0].cohort = 'REJECTED';
  input.items[0].decisionDisposition.action = 'REJECTED';
  input.items[0].decisionDisposition.reasonCodes = ['RISK_REJECTED'];
  input.items[0].dimensions.venue.ownerRefKey = 'evidence';
  assertCode(() => validateEdgeMeterInput(input.items[0]), 'EDGE_NON_ACTED_OWNER_REFERENCE_FORBIDDEN');
});

test('19 reject monetary effect is structurally forbidden', () => {
  const input = scenarioInput('reference-only-reject');
  input.items[0].decisionDisposition.monetaryRejectEffect = '1';
  assertCode(() => validateEdgeMeterBatch(input), 'EDGE_REJECT_MONETARY_EFFECT_FORBIDDEN');
});

test('20 REAL, HYPOTHETICAL, and REPLAY identities remain distinct', () => {
  const signatures = new Set();
  const items = [];
  for (const labelKind of ['REAL', 'HYPOTHETICAL', 'REPLAY']) {
    const input = clone(baseFixture);
    input.reportId = `fixture-${labelKind.toLowerCase()}`;
    input.items[0].labelKind = labelKind;
    input.items[0].measurementId = `fixture-${labelKind.toLowerCase()}`;
    rebindOwnerProjections(input);
    const record = createEdgeMeterReport(input).records[0];
    assert.equal(record.labelKind, labelKind);
    signatures.add(record.comparabilitySignature);
    items.push(input.items[0]);
  }
  assert.equal(signatures.size, 3);
  const mixed = createEdgeMeterReport({ ...clone(baseFixture), reportId: 'fixture-mixed-labels', items });
  assert.deepEqual(mixed.breakdowns.strategy.rows.map((row) => row.labelKind), ['HYPOTHETICAL', 'REAL', 'REPLAY']);
  assert.equal(mixed.breakdowns.strategy.rows.every((row) => row.measurementIds.length === 1), true);
});

test('21 exact decimal arithmetic is bounded, canonical, and float-free', () => {
  assert.equal(addExactDecimals('0.1', '0.2'), '0.3');
  assert.equal(subtractExactDecimals('1000000000000000000000000.1', '0.1'), '1000000000000000000000000');
  assert.equal(sumExactDecimals(['15', '-2', '-0.5']), '12.5');
  assert.equal(compareExactDecimals('-0.01', '0'), -1);
  for (const invalid of ['-0', '1.0', '01', '1e3', '.1', '1.', '0.1234567890123456789', '9'.repeat(61)]) {
    assert.throws(() => assertExactDecimal(invalid), invalid);
  }
});

test('22 estimate range rejects null, reversed, and non-canonical bounds', () => {
  const nullBound = clone(baseFixture);
  nullBound.items[0].qEvidence.uncertaintyInterval.low = null;
  assertCode(() => validateEdgeMeterBatch(nullBound), 'EDGE_ESTIMATE_RANGE_BOUND_REQUIRED');

  const reversed = clone(baseFixture);
  reversed.items[0].qEvidence.uncertaintyInterval = { low: '12', high: '8' };
  assertCode(() => validateEdgeMeterBatch(reversed), 'EDGE_ESTIMATE_RANGE_REVERSED');

  const nonCanonical = clone(baseFixture);
  nonCanonical.items[0].qEvidence.uncertaintyInterval.low = '8.0';
  assertCode(() => validateEdgeMeterBatch(nonCanonical), 'EXACT_DECIMAL_NOT_CANONICAL');
});

test('23 owner references require exact commits, hashes, revisions, and time ordering', () => {
  const reference = clone(baseFixture.items[0].ownerRefs.proposal);
  reference.commitSha = 'abc';
  assertCode(() => validateOwnerReference(reference), 'EDGE_REFERENCE_COMMIT_INVALID');
  reference.commitSha = FRONTIER_BASE_SHA;
  reference.contentHash = 'abc';
  assertCode(() => validateOwnerReference(reference), 'EDGE_REFERENCE_HASH_INVALID');
  reference.contentHash = 'a'.repeat(64);
  reference.availableAtMs = reference.eventTimeMs - 1;
  assertCode(() => validateOwnerReference(reference), 'EDGE_REFERENCE_TIME_ORDER_INVALID');
});

test('24 owner reference repository paths cannot escape or become absolute', () => {
  for (const unsafe of ['/tmp/owner', '../owner', 'server/../owner', 'server\\owner', 'server//owner']) {
    const reference = clone(baseFixture.items[0].ownerRefs.proposal);
    reference.repositoryPath = unsafe;
    assertCode(() => validateOwnerReference(reference), 'EDGE_REFERENCE_PATH_UNSAFE');
  }
});

test('25 non-available references cannot smuggle record values', () => {
  const reference = unavailableReference(baseFixture.items[0].ownerRefs.proposal, 'MISSING', 'OWNER_MISSING');
  assert.equal(validateOwnerReference(reference), true);
  reference.contentHash = 'a'.repeat(64);
  assertCode(() => validateOwnerReference(reference), 'EDGE_UNAVAILABLE_REFERENCE_HAS_RECORD');
});

test('26 canonical owner classes and Q ownership are fail-closed', () => {
  const capitalSwap = clone(baseFixture.items[0]);
  capitalSwap.ownerRefs.economicReport.ownerClass = 'FOUNDATION';
  assertCode(() => validateEdgeMeterInput(capitalSwap), 'EDGE_REFERENCE_OWNER_INVALID');

  const qSwap = clone(baseFixture.items[0]);
  qSwap.ownerRefs.calibration.ownerClass = 'FOUNDATION';
  assertCode(() => validateEdgeMeterInput(qSwap), 'EDGE_Q_REFERENCE_OWNER_INVALID');
});

test('27 Q projections cannot claim available values without available owner refs', () => {
  const input = clone(baseFixture.items[0]);
  input.ownerRefs.uncertainty = unavailableReference(input.ownerRefs.uncertainty, 'MISSING', 'Q_UNCERTAINTY_MISSING');
  assertCode(() => validateEdgeMeterInput(input), 'EDGE_Q_PROJECTION_REFERENCE_UNAVAILABLE');

  const abstention = clone(baseFixture.items[0]);
  abstention.ownerRefs.abstention = unavailableReference(abstention.ownerRefs.abstention, 'UNKNOWN', 'Q_ABSTENTION_UNKNOWN');
  assertCode(() => validateEdgeMeterInput(abstention), 'EDGE_Q_ABSTENTION_REFERENCE_UNAVAILABLE');
});

test('28 Capital and bridge references are pinned to their exact owner keys', () => {
  const capital = clone(baseFixture.items[0]);
  capital.capitalProjection.policyRefKey = 'costs';
  assertCode(() => validateEdgeMeterInput(capital), 'EDGE_CAPITAL_POLICY_REFERENCE_KEY_INVALID');

  const bridge = clone(baseFixture.items[0]);
  bridge.grossBridge.pathRefKey = 'evidence';
  assertCode(() => validateEdgeMeterInput(bridge), 'EDGE_GROSS_BRIDGE_REFERENCE_KEY_INVALID');
});

test('29 valuation asset mismatches fail before any projection', () => {
  const capital = clone(baseFixture.items[0]);
  capital.capitalProjection.valuationAsset = 'USD';
  assertCode(() => validateEdgeMeterInput(capital), 'EDGE_CAPITAL_VALUATION_ASSET_MISMATCH');

  const bridge = clone(baseFixture.items[0]);
  bridge.grossBridge.valuationAsset = 'USD';
  assertCode(() => validateEdgeMeterInput(bridge), 'EDGE_GROSS_BRIDGE_VALUATION_ASSET_MISMATCH');
});

test('30 Capital measure combinations follow the canonical Capital owner shape', () => {
  const reasonless = clone(baseFixture.items[0]);
  const missing = reasonless.capitalProjection.measures.fees;
  missing.status = 'MISSING';
  missing.knownAmount = null;
  missing.missingComponentKinds = ['FEE'];
  missing.reasonCodes = [];
  assertCode(() => validateEdgeMeterInput(reasonless), 'EDGE_MISSING_MEASURE_REASON_REQUIRED');

  const amount = clone(baseFixture.items[0]);
  amount.capitalProjection.measures.unrealizedPnl.knownAmount = '0';
  assertCode(() => validateEdgeMeterInput(amount), 'EDGE_NOT_APPLICABLE_MEASURE_HAS_AMOUNT');

  assert.deepEqual(baseFixture.items[0].capitalProjection.measures.unrealizedPnl.reasonCodes, []);
});

test('31 unknown fields and prototype-bearing records are rejected', () => {
  const unknown = clone(baseFixture.items[0]);
  unknown.orderSize = '1';
  assertCode(() => validateEdgeMeterInput(unknown), 'EDGE_RECORD_FIELDS_INVALID');

  const custom = Object.create({ inherited: true });
  Object.assign(custom, clone(baseFixture.items[0]));
  assertCode(() => validateEdgeMeterInput(custom), 'EDGE_RECORD_PROTOTYPE_FORBIDDEN');
});

test('32 batch bound is exact and over-limit input fails closed', () => {
  const atLimit = clone(baseFixture);
  atLimit.items = Array.from({ length: MAX_BATCH_ITEMS }, (_, index) => {
    const item = clone(baseFixture.items[0]);
    item.measurementId = `fixture-at-limit-${String(index).padStart(2, '0')}`;
    return item;
  });
  assert.equal(validateEdgeMeterBatch(atLimit), true);
  const report = createEdgeMeterReport(atLimit);
  assert.equal(report.records.length, MAX_BATCH_ITEMS);
  assert.ok(Buffer.byteLength(canonicalize(report), 'utf8') <= MAX_REPORT_BYTES);

  const beyond = clone(atLimit);
  const extra = clone(baseFixture.items[0]);
  extra.measurementId = 'fixture-over-limit';
  beyond.items.push(extra);
  assertCode(() => validateEdgeMeterBatch(beyond), 'EDGE_BATCH_LIMIT_EXCEEDED');
});

test('33 identical duplicates deduplicate deterministically without identity conflict', () => {
  const input = clone(baseFixture);
  input.items.push(clone(input.items[0]));
  const report = createEdgeMeterReport(input);
  assert.equal(report.inputRecordCount, 2);
  assert.equal(report.uniqueMeasurementCount, 1);
  assert.equal(report.duplicateIdenticalCount, 1);
  assert.equal(report.identityConflictCount, 0);
  assert.equal(report.records.length, 1);
});

test('34 same measurement identity with different content becomes divergent', () => {
  const input = clone(baseFixture);
  const conflicting = clone(input.items[0]);
  conflicting.dimensions.symbol.value = 'BTCUSDT';
  rebindOwnerProjections(conflicting);
  input.items.push(conflicting);
  const report = createEdgeMeterReport(input);
  assert.equal(report.reportState, 'DIVERGENT');
  assert.equal(report.identityConflictCount, 1);
  assert.equal(report.records[0].recordKind, 'IDENTITY_CONFLICT');
  assert.deepEqual(report.records[0].reasonCodes, ['DUPLICATE_IDENTITY_HASH_CONFLICT']);
  assert.equal(report.records[0].inputHashes.length, 2);
});

test('35 report ordering is deterministic across input order', () => {
  const first = clone(baseFixture.items[0]);
  const second = clone(baseFixture.items[0]);
  first.measurementId = 'measurement-z';
  second.measurementId = 'measurement-a';
  const left = createEdgeMeterReport({ ...clone(baseFixture), reportId: 'order-proof', items: [first, second] });
  const right = createEdgeMeterReport({ ...clone(baseFixture), reportId: 'order-proof', items: [second, first] });
  assert.deepEqual(left, right);
  assert.deepEqual(left.records.map((record) => record.measurementId), ['measurement-a', 'measurement-z']);
});

test('36 input hash changes on owner revision, content hash, or evidence class', () => {
  const item = baseFixture.items[0];
  const baseline = edgeMeterInputHash(item);
  for (const [mutate, rebind] of [
    [(value) => { value.ownerRefs.proposal.recordRevision = 'fixture-v2'; }, true],
    [(value) => { value.ownerRefs.proposal.contentHash = '1'.repeat(64); }, true],
    [(value) => { value.labelKind = 'REPLAY'; }, true],
  ]) {
    const changed = clone(item);
    mutate(changed);
    if (rebind) rebindOwnerProjections(changed);
    assert.notEqual(edgeMeterInputHash(changed), baseline);
  }
});

test('37 cockpit preview is an exact, inert, unmounted fixture projection', () => {
  const report = createEdgeMeterReport(baseFixture);
  const preview = projectEdgeMeterCockpit(report);
  assert.deepEqual(preview, attributablePreview);
  assert.equal(preview.bindingState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(preview.truthLabel, 'SYNTHETIC_ONLY');
  assert.deepEqual(preview.controls, []);
  assert.equal(preview.effectAllowed, false);
  assert.equal(preview.mounted, false);
  assert.equal(preview.integrated, false);
  assert.equal(preview.profitClaim, false);
  assert.equal(preview.edgeProven, false);
});

test('38 Dock facet bindings preserve the two exact usable classes and operations', () => {
  const advisory = bindEdgeMeterFacet(dockBinding('ADVISORY_ASSESSOR'));
  const cockpit = bindEdgeMeterFacet(dockBinding('COCKPIT_PROJECTION'));
  assert.equal(advisory.facetClass, 'ADVISORY_ASSESSOR');
  assert.equal(advisory.operation, 'EVALUATE_FIXTURE');
  assert.equal(advisory.bindingStatus, 'USABLE');
  assert.equal(cockpit.facetClass, 'COCKPIT_PROJECTION');
  assert.equal(cockpit.operation, 'PROJECT_FIXTURE');
  assert.equal(cockpit.bindingStatus, 'USABLE');
  assert.equal(advisory.extensionId, 'frontier.edge-meter');
  assert.equal(cockpit.extensionId, 'frontier.edge-meter');
});

test('39 Dock facet invocations remain cross-class firewalled and effect-free', () => {
  const report = invokeEdgeMeterAdvisory({
    dockBinding: dockBinding('ADVISORY_ASSESSOR'),
    batch: baseFixture,
  });
  assert.equal(report.reportState, 'ATTRIBUTABLE');
  const preview = invokeEdgeMeterCockpitProjection({
    dockBinding: dockBinding('COCKPIT_PROJECTION'),
    report,
  });
  assert.deepEqual(preview, attributablePreview);
  assertCode(() => invokeEdgeMeterAdvisory({
    dockBinding: dockBinding('COCKPIT_PROJECTION'),
    batch: baseFixture,
  }), 'FACET_CLASS_CROSSING');
  assert.deepEqual(routeEdgeMeterReport(report), {
    routed: true,
    destinationClass: 'FIXTURE_REPORT',
    effectAllowed: false,
  });
});

test('40 resource and maximum-rate claims pass Dock validation', () => {
  assert.equal(validateResourceBudgetClaim(resourceBudgetClaim), true);
  assert.equal(validateMaxSafeRateClaim(maxSafeRateClaim), true);
  assert.equal(resourceBudgetClaim.network.observed, 0);
  assert.equal(resourceBudgetClaim.modelUse.observed, 0);
  assert.equal(maxSafeRateClaim.eventsPerWindow, MAX_BATCH_ITEMS);
});

test('41 at-limit load stays bounded and beyond-limit load requests degradation', () => {
  const common = {
    resourceBudgetClaim,
    maxSafeRateClaim,
    windowSizeMs: 1000,
    storageBytesPerEvent: 128,
    networkBytes: 0,
    modelCalls: 0,
  };
  const atLimit = runFixtureLoad({
    ...common,
    offeredEvents: MAX_BATCH_ITEMS,
    peakQueueDepth: 8,
    latencySamples: Array(MAX_BATCH_ITEMS).fill(4),
  });
  assert.equal(atLimit.state, 'WITHIN_FIXTURE_ENVELOPE');
  assert.equal(atLimit.acceptedEvents, MAX_BATCH_ITEMS);
  assert.equal(atLimit.backpressureApplied, true);

  const beyond = runFixtureLoad({
    ...common,
    offeredEvents: MAX_BATCH_ITEMS + 1,
    peakQueueDepth: 9,
    latencySamples: Array(MAX_BATCH_ITEMS + 1).fill(13),
    storageBytesPerEvent: 512,
    networkBytes: 1,
    modelCalls: 1,
  });
  assert.equal(beyond.state, 'DEGRADATION_REQUESTED');
  assert.equal(beyond.acceptedEvents, 0);
  assert.equal(beyond.silentLoss, false);
  assert.equal(beyond.forgedGreen, false);
  assert.deepEqual([...beyond.exceeded].sort(), [
    'EVENT_RATE', 'MODEL_USE', 'NETWORK', 'P50_LATENCY', 'P95_LATENCY', 'P99_LATENCY', 'QUEUE', 'STORAGE_GROWTH',
  ]);
});

test('42 portable schema stays synchronized with frozen owner and dimension keys', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.$defs.OwnerReferences.required, OWNER_REFERENCE_KEYS);
  assert.deepEqual(schema.$defs.Dimensions.required, DIMENSION_KEYS);
  assert.deepEqual(schema.$defs.CapitalMeasures.required, CAPITAL_MEASURE_KEYS);
  assert.equal(schema.$defs.EdgeMeterBatchInputV1.properties.items.maxItems, MAX_BATCH_ITEMS);
  assert.deepEqual(schema.$defs.EdgeMeterReportV1.properties.reportState.enum, RECORD_STATES);
});

test('43 owner-reuse map pins exact accepted artifacts and the bounded F8 delta', () => {
  assert.equal(ownerReuseMap.frontierDirective.sha256, '4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad');
  assert.equal(ownerReuseMap.immutableBaseSha, FRONTIER_BASE_SHA);
  assert.equal(ownerReuseMap.dockContractSha, DOCK_SHA);
  assert.equal(ownerReuseMap.disposition, 'APPROVED_REAL_DELTA');
  assert.equal(ownerReuseMap.owners.some((owner) => owner.canonicalOwner === 'capitalFoundation economics'), true);
  assert.equal(ownerReuseMap.owners.some((owner) => owner.canonicalOwner === 'frozen Q lane'), true);
  assert.equal(ownerReuseMap.edgeMeterDelta.length, 6);
});

test('44 inherited directive, Dock maps, and facet receipts retain exact byte hashes', () => {
  assert.equal(sha256Bytes(path.join(REPO_ROOT, 'frontier/directives/Frontier.md')), ownerReuseMap.frontierDirective.sha256);
  assert.equal(sha256Bytes(path.join(REPO_ROOT, facetRefs.canonicalOwnerMap.path)), facetRefs.canonicalOwnerMap.sha256);
  assert.equal(sha256Bytes(path.join(REPO_ROOT, facetRefs.adapterRules.path)), facetRefs.adapterRules.sha256);
  for (const expected of facetRefs.requiredFacets) {
    const actual = dockBinding(expected.facetClass);
    assert.equal(actual.bindingHash, expected.bindingHash);
    assert.equal(actual.acceptedOwnerCommitSha, expected.acceptedOwnerCommitSha);
    assert.equal(actual.canonicalContractVersion, expected.canonicalContractVersion);
    assert.equal(actual.bindingStatus, 'USABLE');
  }
});

test('45 descriptor source identity matches every source file and aggregate row hash', () => {
  const rows = sourceHashes.files.map((entry) => {
    assert.equal(sha256Bytes(path.join(MODULE_ROOT, entry.path)), entry.sha256, entry.path);
    return `${entry.sha256}  ${entry.path}\n`;
  }).join('');
  const aggregate = createHash('sha256').update(rows).digest('hex');
  assert.equal(aggregate, sourceHashes.aggregateSourceSha);
  const descriptor = readJson('contracts/v1/extension-descriptor.v1.json');
  assert.equal(descriptor.sourceSha, aggregate);
});

test('46 source layer has no transport, environment, timer, randomness, or product import', () => {
  const sourceRoot = path.join(MODULE_ROOT, 'src');
  const files = readdirSync(sourceRoot).filter((name) => name.endsWith('.mjs')).sort();
  assert.ok(files.length > 0);
  const forbiddenRuntime = /\b(?:fetch|WebSocket|EventSource|setTimeout|setInterval)\b|Math\.random|Date\.now|process\.env|node:(?:fs|net|http|https|tls|dgram|child_process)/;
  const forbiddenImport = /(?:from\s+|import\s*\()["'][^"']*(?:server\/src|web\/src|quant\/src|packages\/|ops\/|deployment\/)/;
  for (const file of files) {
    const contents = readFileSync(path.join(sourceRoot, file), 'utf8');
    assert.equal(forbiddenRuntime.test(contents), false, file);
    assert.equal(forbiddenImport.test(contents), false, file);
  }
});

test('47 output claim boundaries never grant execution, sizing, calibration, or profit authority', () => {
  const report = createEdgeMeterReport(baseFixture);
  const boundary = report.records[0].claimBoundary;
  assert.equal(boundary.measurementOnly, true);
  for (const field of [
    'realizedProfitClaim', 'profitableClaim', 'edgeProven', 'sizingAuthority', 'tradingAuthority',
    'modelSelectionAuthority', 'calibrationAuthority', 'effectAllowed',
  ]) assert.equal(boundary[field], false, field);
  assert.equal(report.orderOrSizingEffect, false);
  assert.equal(report.profitClaim, false);
});

test('48 future insertion request is exact, owner-gated, and mutation-free', () => {
  const seams = [...insertionRequest.intendedSharedSeams];
  assert.equal(validateInsertionRequest(insertionRequest, seams), true);
  assert.equal(insertionRequest.mutationImplemented, false);
  assert.equal(insertionRequest.authorityClass, 'NO_AUTHORITY');
  assert.equal(insertionRequest.networkMode, 'FIXTURE_ONLY');
  assert.deepEqual(insertionRequest.blockedFacetRequests, []);
  assertCode(() => validateInsertionRequest(insertionRequest, seams.slice(1)), 'INSERTION_SEAM_MISMATCH');
});

test('49 sealed extension descriptor is Dock-valid and remains fixture-only', () => {
  const descriptor = readJson('contracts/v1/extension-descriptor.v1.json');
  const parsed = parseExtensionDescriptor(descriptor);
  assert.equal(parsed.extensionId, 'frontier.edge-meter');
  assert.equal(parsed.immutableBaseSha, FRONTIER_BASE_SHA);
  assert.equal(parsed.buildState, 'PRESTAGE_READY');
  assert.equal(parsed.disposition, 'ACTIVE');
  assert.equal(parsed.authorityClass, 'NO_AUTHORITY');
  assert.equal(parsed.networkMode, 'FIXTURE_ONLY');
  assert.equal(parsed.secretMode, 'NONE');
  assert.deepEqual(parsed.resourceBudgetClaim, resourceBudgetClaim);
  assert.deepEqual(parsed.maxSafeRateClaim, maxSafeRateClaim);
});

test('50 immutable owner projection hashes reject altered sibling values', () => {
  for (const mutate of [
    (item) => { item.qEvidence.selectionEvidence[0].displayValue = 'PBO=0.99'; },
    (item) => { item.qEvidence.uncertaintyInterval.high = '13'; },
    (item) => { item.qEvidence.uncertaintyUnit = 'USD'; },
    (item) => { item.labelKind = 'REPLAY'; },
    (item) => { item.informationCutoffMs = 99999; },
    (item) => { item.dimensions.strategy.value = 'VOLUME'; },
    (item) => { item.dimensions.venue.value = 'OTHER'; },
  ]) {
    const item = clone(baseFixture.items[0]);
    mutate(item);
    assertCode(() => validateEdgeMeterInput(item), 'EDGE_OWNER_PROJECTION_HASH_MISMATCH');
  }

  const rejected = scenarioInput('reference-only-reject').items[0];
  rejected.decisionDisposition.reasonCodes = ['FORGED_REJECT_REASON'];
  assertCode(() => validateEdgeMeterInput(rejected), 'EDGE_OWNER_PROJECTION_HASH_MISMATCH');
});

test('51 unavailable Q abstention and missing liabilities remain insufficient', () => {
  const unavailableQ = clone(baseFixture);
  unavailableQ.items[0].qEvidence.abstentionAction = 'UNAVAILABLE';
  rebindOwnerProjections(unavailableQ);
  const qReport = createEdgeMeterReport(unavailableQ);
  assert.equal(qReport.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(qReport.records[0].reasonCodes.includes('Q_ABSTENTION_UNAVAILABLE'));

  const missingLiability = clone(baseFixture);
  missingLiability.items[0].ownerRefs.liabilities = unavailableReference(
    missingLiability.items[0].ownerRefs.liabilities,
    'MISSING',
    'LIABILITY_REFERENCE_MISSING',
  );
  rebindOwnerProjections(missingLiability);
  const liabilityReport = createEdgeMeterReport(missingLiability);
  assert.equal(liabilityReport.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(liabilityReport.records[0].reasonCodes.includes('REQUIRED_REFERENCE_MISSING:LIABILITIES'));
});

test('52 Capital confidence, partial measures, and divergence cannot appear attributable', () => {
  const lowConfidence = clone(baseFixture);
  lowConfidence.items[0].capitalProjection.accountingConfidence = 'LOW';
  rebindOwnerProjections(lowConfidence);
  const lowReport = createEdgeMeterReport(lowConfidence);
  assert.equal(lowReport.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(lowReport.records[0].reasonCodes.includes('CAPITAL_ACCOUNTING_CONFIDENCE_LOW'));

  const missingMeasure = clone(baseFixture);
  Object.assign(missingMeasure.items[0].capitalProjection.measures.fees, {
    status: 'MISSING',
    knownAmount: null,
    missingComponentKinds: ['FEE'],
    reasonCodes: ['MISSING_FEE'],
  });
  rebindOwnerProjections(missingMeasure);
  const missingReport = createEdgeMeterReport(missingMeasure);
  assert.equal(missingReport.reportState, 'INSUFFICIENT_EVIDENCE');
  assert.ok(missingReport.records[0].reasonCodes.includes('CAPITAL_MEASURE_MISSING:FEES'));

  const divergentMeasure = clone(baseFixture);
  divergentMeasure.items[0].capitalProjection.measures.fees.status = 'DIVERGENT';
  divergentMeasure.items[0].capitalProjection.measures.fees.reasonCodes = ['DIVERGENT_COMPONENT'];
  rebindOwnerProjections(divergentMeasure);
  const divergentMeasureReport = createEdgeMeterReport(divergentMeasure);
  assert.equal(divergentMeasureReport.reportState, 'DIVERGENT');
  assert.ok(divergentMeasureReport.records[0].reasonCodes.includes('CAPITAL_MEASURE_DIVERGENT:FEES'));

  const divergentOwner = clone(baseFixture);
  divergentOwner.items[0].capitalProjection.divergentReasons = ['DUPLICATE_COMPONENT_ID:same-id'];
  rebindOwnerProjections(divergentOwner);
  const divergentOwnerReport = createEdgeMeterReport(divergentOwner);
  assert.equal(divergentOwnerReport.reportState, 'DIVERGENT');
  assert.ok(divergentOwnerReport.records[0].reasonCodes.includes('CAPITAL_OWNER_DIVERGENT_REASONS_PRESENT'));

  const missingInventory = clone(baseFixture);
  missingInventory.items[0].capitalProjection.includedComponentIds = missingInventory.items[0]
    .capitalProjection.includedComponentIds.filter((id) => id !== 'cmp-fees');
  rebindOwnerProjections(missingInventory);
  const inventoryReport = createEdgeMeterReport(missingInventory);
  assert.equal(inventoryReport.reportState, 'DIVERGENT');
  assert.ok(inventoryReport.records[0].reasonCodes.includes('CAPITAL_COMPONENT_INVENTORY_MISMATCH'));

  const falseKnown = clone(baseFixture.items[0]);
  falseKnown.capitalProjection.measures.fees.missingComponentKinds = ['FEE'];
  falseKnown.capitalProjection.measures.fees.reasonCodes = ['MISSING_FEE'];
  assertCode(() => validateEdgeMeterInput(falseKnown), 'EDGE_KNOWN_MEASURE_HAS_GAPS');
});

test('53 gross bridge must anchor Capital gross and use fills inside the horizon', () => {
  const mismatch = clone(baseFixture);
  mismatch.items[0].grossBridge.decisionBenchmarkGross = '15.5';
  mismatch.items[0].grossBridge.actualGross = '13';
  rebindOwnerProjections(mismatch);
  const mismatchReport = createEdgeMeterReport(mismatch);
  assert.equal(mismatchReport.records[0].grossBridge.identityProven, true);
  assert.equal(mismatchReport.reportState, 'DIVERGENT');
  assert.ok(mismatchReport.records[0].reasonCodes.includes('GROSS_BRIDGE_CAPITAL_GROSS_MISMATCH'));

  for (const [eventTimeMs, availableAtMs] of [[99999, 121000], [160001, 160001]]) {
    const outside = clone(baseFixture);
    outside.items[0].ownerRefs.fills.eventTimeMs = eventTimeMs;
    outside.items[0].ownerRefs.fills.availableAtMs = availableAtMs;
    rebindOwnerProjections(outside);
    const report = createEdgeMeterReport(outside);
    assert.equal(report.reportState, 'DIVERGENT');
    assert.ok(report.records[0].reasonCodes.includes('GROSS_BRIDGE_FILL_OUTSIDE_HORIZON'));
  }
});

test('54 post-horizon outcome and evidence timestamps fail closed', () => {
  for (const refKey of ['outcome', 'evidence']) {
    const input = clone(baseFixture);
    input.items[0].ownerRefs[refKey].eventTimeMs = 159999;
    rebindOwnerProjections(input);
    const report = createEdgeMeterReport(input);
    assert.equal(report.reportState, 'DIVERGENT');
    assert.ok(report.records[0].reasonCodes.includes(`POST_HORIZON_REFERENCE_PREMATURE:${refKey.toUpperCase()}`));
  }
});

test('55 horizon and dimension ownership are strict even after synthetic rebinding', () => {
  const emptyHorizon = clone(baseFixture.items[0]);
  emptyHorizon.horizon.endMs = emptyHorizon.horizon.startMs;
  rebindOwnerProjections(emptyHorizon);
  assertCode(() => validateEdgeMeterInput(emptyHorizon), 'EDGE_HORIZON_EMPTY_OR_REVERSED');

  const preCutoff = clone(baseFixture);
  preCutoff.items[0].horizon.startMs = 99999;
  rebindOwnerProjections(preCutoff);
  const preCutoffReport = createEdgeMeterReport(preCutoff);
  assert.equal(preCutoffReport.reportState, 'NON_COMPARABLE');
  assert.ok(preCutoffReport.records[0].reasonCodes.includes('OUTCOME_HORIZON_PRECEDES_INFORMATION_CUTOFF'));

  const wrongOwner = clone(baseFixture.items[0]);
  wrongOwner.dimensions.venue.ownerRefKey = 'evidence';
  rebindOwnerProjections(wrongOwner);
  assertCode(() => validateEdgeMeterInput(wrongOwner), 'EDGE_DIMENSION_REFERENCE_KEY_INVALID');
});

test('56 report verifier rejects nested tampering and forged envelopes', () => {
  const valid = createEdgeMeterReport(baseFixture);
  assert.equal(validateEdgeMeterReport(valid), true);

  const staleHash = clone(valid);
  staleHash.records[0].capitalProjection.netKnown = '999';
  assertCode(() => projectEdgeMeterCockpit(staleHash), 'EDGE_PREVIEW_REPORT_INVALID');

  const attackerRehashed = rehashReport(clone(staleHash));
  assertCode(() => validateEdgeMeterReport(attackerRehashed), 'EDGE_REPORT_RECORD_INVALID');
  assertCode(() => projectEdgeMeterCockpit(attackerRehashed), 'EDGE_PREVIEW_REPORT_INVALID');

  const malformedRecord = clone(valid);
  malformedRecord.records[0].qEvidence = null;
  rehashReport(malformedRecord);
  assertCode(() => validateEdgeMeterReport(malformedRecord), 'EDGE_REPORT_RECORD_INVALID');

  const empty = createEdgeMeterReport({
    schema: 'EdgeMeterBatchInputV1',
    version: 1,
    reportId: 'fixture-empty-forgery',
    evaluatedAtMs: 170000,
    items: [],
  });
  const impossibleDuplicate = clone(empty);
  impossibleDuplicate.duplicateIdenticalCount = 1;
  impossibleDuplicate.inputRecordCount = 1;
  rehashReport(impossibleDuplicate);
  assertCode(() => validateEdgeMeterReport(impossibleDuplicate), 'EDGE_REPORT_INPUT_COUNT_INVALID');

  const oversized = clone(valid);
  oversized.reportId = 'x'.repeat(MAX_REPORT_BYTES);
  rehashReport(oversized);
  assertCode(() => validateEdgeMeterReport(oversized), 'RESOURCE_ENVELOPE_EXCEEDED');
});

test('57 altered and validly rehashed Dock bindings both fail closed', () => {
  const rawForgery = clone(dockBinding('ADVISORY_ASSESSOR'));
  rawForgery.canonicalOwnerRef = 'git:0000000000000000000000000000000000000000:forged';
  assertCode(() => bindEdgeMeterFacet(rawForgery), 'BINDING_HASH_MISMATCH');

  const record = clone(rawForgery);
  delete record.bindingHash;
  const validForgery = createProviderFacetBinding(record);
  assertCode(() => bindEdgeMeterFacet(validForgery), 'EDGE_DOCK_FACET_PIN_MISMATCH');
});

test('58 cockpit adapter preserves timing, uncertainty, and exact Product surface shape', () => {
  const preview = projectEdgeMeterCockpit(createEdgeMeterReport(baseFixture));
  assert.equal(preview.signalTimingBridge.pathRef.refId, 'ref-fills-001');
  assert.equal(preview.signalTimingBridge.horizonRef.refId, 'ref-outcome-001');
  assert.equal(preview.uncertainty.unit, 'USDT');
  assert.deepEqual(Object.keys(preview.productSurfaceProjection).sort(), [
    'bindingState', 'blocker', 'canonicalSource', 'controlIds', 'correlationId', 'evaluatedAtMs',
    'evidence', 'label', 'summary', 'surfaceId', 'truthLabel',
  ]);
  assert.equal(preview.productSurfaceProjection.surfaceId, 'pnl');
  assert.equal(preview.productSurfaceProjection.bindingState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.deepEqual(Object.keys(preview.productSurfaceProjection.evidence[0]).sort(), [
    'canonicalSource', 'fieldId', 'label', 'truthLabel', 'unavailableReason', 'value',
  ]);
});

test('59 fixture references exact existing Ledger, L, Capital, and Q contracts', () => {
  const refs = baseFixture.items[0].ownerRefs;
  assert.deepEqual([refs.outcome.ownerClass, refs.outcome.contractId, refs.outcome.repositoryPath], [
    'LEDGER', 'LedgerEvent', 'server/src/ledger.ts',
  ]);
  assert.deepEqual([refs.fills.ownerClass, refs.fills.contractId, refs.fills.repositoryPath], [
    'L', 'ExecutionEvent', 'server/src/foundation/execution/types.ts',
  ]);
  assert.deepEqual([refs.liabilities.ownerClass, refs.liabilities.contractId, refs.liabilities.repositoryPath], [
    'CAPITAL', 'AccountCapitalProjection', 'server/src/capitalFoundation/accountTruth/types.ts',
  ]);
  assert.deepEqual([refs.pointInTimeJoin.ownerClass, refs.pointInTimeJoin.contractId], ['Q', 'VisibleEvidenceRefV1']);
  assert.equal(refs.selectionPressure.contractId, 'TrialLedgerV1');
  assert.deepEqual(ownerReuseMap.admissionReceipt, {
    releaseCommitSha: '887221418345ad54d7b98881b359fab85a6188e6',
    path: 'frontier/coordinator/scouts/F8.json',
    byteSha256: 'fca83dc3e3fe1b47ec3a10a5e27f5f8494e66f47da47b90301d0b3fd2ab18002',
    embeddedContentHash: '1adcc68de1a732217ec0de015c296f73910fc24c9e120840bcf28c5a3ef775e9',
    decision: 'APPROVED_REAL_DELTA',
  });
});

test('60 portable output schemas are closed and pin every authority denial', () => {
  const reportSchema = schema.$defs.EdgeMeterReportV1;
  const cockpitSchema = schema.$defs.EdgeMeterCockpitProjectionV1;
  assert.equal(reportSchema.additionalProperties, false);
  assert.equal(cockpitSchema.additionalProperties, false);
  for (const key of [
    'evaluatedAtMs', 'truthClass', 'canonical', 'authorityClass', 'networkMode', 'stateCounts',
    'breakdowns', 'capitalNetRecomputed', 'qStatisticsRecomputed', 'calibrationPerformed',
    'modelSelectionPerformed', 'orderOrSizingEffect', 'profitClaim', 'limitations',
  ]) assert.ok(reportSchema.required.includes(key), key);
  assert.equal(reportSchema.properties.canonical.const, false);
  assert.equal(reportSchema.properties.orderOrSizingEffect.const, false);
  assert.equal(reportSchema.properties.profitClaim.const, false);
  for (const key of ['productSurfaceProjection', 'mounted', 'integrated', 'profitClaim', 'edgeProven']) {
    assert.ok(cockpitSchema.required.includes(key), key);
  }
  assert.equal(cockpitSchema.properties.mounted.const, false);
  assert.equal(cockpitSchema.properties.integrated.const, false);
  assert.equal(cockpitSchema.properties.profitClaim.const, false);
  assert.equal(cockpitSchema.properties.edgeProven.const, false);
  assert.ok(schema.$defs.OwnerReferenceV1.required.includes('projectionContentHash'));
  assert.equal(schema.$defs.GrossTimingBridgeV1.properties.pathRefKey.const, 'fills');
  assert.equal(schema.$defs.GrossTimingBridgeV1.properties.horizonRefKey.const, 'outcome');
});

test('61 Q abstention reasons preserve accepted enum and precedence', () => {
  const accepted = clone(baseFixture);
  accepted.items[0].qEvidence.abstentionAction = 'ABSTAIN_UNKNOWN';
  accepted.items[0].qEvidence.abstentionReasonCodes = ['EVIDENCE_STALE', 'CALIBRATION_UNAVAILABLE'];
  rebindOwnerProjections(accepted);
  assert.equal(createEdgeMeterReport(accepted).reportState, 'ABSTAIN_UNKNOWN');

  const reversed = clone(accepted.items[0]);
  reversed.qEvidence.abstentionReasonCodes = ['CALIBRATION_UNAVAILABLE', 'EVIDENCE_STALE'];
  rebindOwnerProjections(reversed);
  assertCode(() => validateEdgeMeterInput(reversed), 'EDGE_Q_ABSTENTION_REASON_ORDER_INVALID');

  const invented = clone(accepted.items[0]);
  invented.qEvidence.abstentionReasonCodes = ['LOW_COVERAGE'];
  rebindOwnerProjections(invented);
  assertCode(() => validateEdgeMeterInput(invented), 'EDGE_Q_ABSTENTION_REASON_INVALID');
});

test('62 cockpit marks unavailable known Capital net as missing without rendering null text', () => {
  const input = clone(baseFixture);
  input.items[0].capitalProjection.netKnown = null;
  rebindOwnerProjections(input);
  const report = createEdgeMeterReport(input);
  assert.equal(report.reportState, 'INSUFFICIENT_EVIDENCE');
  const preview = projectEdgeMeterCockpit(report);
  assert.equal(preview.attributionWaterfall.canonicalNet.amount, null);
  const datum = preview.productSurfaceProjection.evidence.find((row) => row.fieldId === 'canonical-net');
  assert.deepEqual([datum.value, datum.truthLabel, datum.unavailableReason], [
    null,
    'MISSING',
    'CAPITAL_NET_KNOWN_UNAVAILABLE',
  ]);
});
