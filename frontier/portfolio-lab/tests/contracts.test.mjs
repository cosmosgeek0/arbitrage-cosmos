import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PortfolioLabContractError,
  createPortfolioSnapshot,
  createScenarioEvaluationInput,
  evaluateScenarioFixture,
  sumKnownMetrics,
  validatePortfolioSnapshot,
  validateScenarioEvaluationInput,
} from '../src/index.mjs';
import { OWNER_REFS, baseSnapshot, known, scenarioInput as fixtureScenarioInput, unknown } from './helpers.mjs';
import { omitFields, sha256 } from '../../dock/src/canonical.mjs';

function scenarioInput(snapshotHash) {
  const input = fixtureScenarioInput(snapshotHash);
  const lineageDisclosure = 'status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
  const reproducibilityDisclosure = 'scenario-definition-status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
  if (!input.scenarioReference.lineageRefs.includes(lineageDisclosure)) {
    input.scenarioReference.lineageRefs.push(lineageDisclosure);
  }
  if (!input.reproducibilityInputs.includes(reproducibilityDisclosure)) {
    input.reproducibilityInputs.push(reproducibilityDisclosure);
  }
  return input;
}

test('PortfolioSnapshotV1 is deterministic, immutable, and hash-bound', () => {
  const first = createPortfolioSnapshot(baseSnapshot());
  const second = createPortfolioSnapshot(baseSnapshot());
  assert.equal(validatePortfolioSnapshot(first), true);
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.positions[0]), true);
  assert.throws(() => { first.positions[0].assetId = 'MUTATED'; }, TypeError);
});

test('exact aggregation rejects sparse arrays instead of treating holes as zero', () => {
  const sparse = new Array(2);
  sparse[1] = known('7');
  assert.throws(
    () => sumKnownMetrics(sparse, 'USDT_MICRO', 'hostileSparseMetrics'),
    (error) => error.code === 'SPARSE_ARRAY',
  );
});

test('exact aggregation rejects rows beyond its public resource bound', () => {
  const overBound = Array.from({ length: 4_097 }, () => known('1'));
  assert.throws(
    () => sumKnownMetrics(overBound, 'USDT_MICRO', 'hostileOversizedMetrics'),
    (error) => error.code === 'ARRAY_BOUND_EXCEEDED',
  );
});

test('unknown exposure remains unknown and never becomes a fabricated zero', () => {
  const input = baseSnapshot();
  input.truthState = 'PARTIAL';
  input.missingDependencies = ['PROPOSAL_CAPACITY_UNAVAILABLE'];
  input.proposals[0].exposure = unknown('PROPOSAL_CAPACITY_UNAVAILABLE');
  const snapshot = createPortfolioSnapshot(input);
  assert.deepEqual(snapshot.proposals[0].exposure, unknown('PROPOSAL_CAPACITY_UNAVAILABLE'));
  assert.notEqual(snapshot.proposals[0].exposure.atoms, '0');
});

test('COMPLETE snapshots reject unknown exposure instead of publishing false completeness', () => {
  const input = baseSnapshot();
  input.proposals[0].exposure = unknown('PROPOSAL_CAPACITY_UNAVAILABLE');
  assert.throws(
    () => createPortfolioSnapshot(input),
    (error) => error instanceof PortfolioLabContractError && error.code === 'TRUTH_COMPLETENESS_CONTRADICTION',
  );
});

test('snapshot rejects unit drift, unsafe atoms, duplicate identities, and forbidden authority keys', () => {
  const unitDrift = baseSnapshot();
  unitDrift.positions[0].exposure.unit = 'USD_CENTS';
  assert.throws(() => createPortfolioSnapshot(unitDrift), (error) => error instanceof PortfolioLabContractError && error.code === 'REPORTING_UNIT_MISMATCH');

  const unsafeAtoms = baseSnapshot();
  unsafeAtoms.positions[0].exposure.atoms = '1.25';
  assert.throws(() => createPortfolioSnapshot(unsafeAtoms), (error) => error.code === 'EXACT_ATOMS_INVALID');

  const duplicate = baseSnapshot();
  duplicate.proposals[0].id = duplicate.positions[0].id;
  assert.throws(() => createPortfolioSnapshot(duplicate), (error) => error.code === 'SUBJECT_ID_DUPLICATE');

  const forbidden = baseSnapshot();
  forbidden.positions[0].orderRequest = { symbol: 'BTCUSDT' };
  assert.throws(() => createPortfolioSnapshot(forbidden), (error) => error.code === 'FORBIDDEN_CAPABILITY_FIELD');
});

test('scenario input records every no-fake-precision disclosure and binds an F12 reference', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  assert.equal(validateScenarioEvaluationInput(evaluation), true);
  assert.equal(evaluation.scenarioReference.extensionProviderRef, 'F12');
  assert.equal(evaluation.outputMode, 'COMPARATIVE');
  assert.match(evaluation.whyNotLiveSizing, /cannot authorize/i);
  assert.deepEqual(evaluation.sweepInputs.map((row) => row.dimension), [
    'LIQUIDITY', 'CAPACITY', 'FUNDING', 'BORROW', 'FEE', 'SLIPPAGE', 'LATENCY',
  ]);
});

test('scenario input fails closed on missing disclosures, bad time, and self-provided scenario authority', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());

  const missingReason = scenarioInput(snapshot.snapshotHash);
  delete missingReason.whyNotLiveSizing;
  assert.throws(() => createScenarioEvaluationInput(missingReason), (error) => error.code === 'REQUIRED_FIELD_MISSING');

  const badTime = scenarioInput(snapshot.snapshotHash);
  badTime.horizon.endMs = badTime.horizon.startMs;
  assert.throws(() => createScenarioEvaluationInput(badTime), (error) => error.code === 'HORIZON_INVALID');

  const selfProvided = scenarioInput(snapshot.snapshotHash);
  selfProvided.scenarioReference.extensionProviderRef = 'F2';
  assert.throws(() => createScenarioEvaluationInput(selfProvided), (error) => error.code === 'SCENARIO_PROVIDER_INVALID');
});

test('arbitrary owner references cannot enter snapshots or scenario evaluation', () => {
  const unboundSnapshot = baseSnapshot();
  unboundSnapshot.positions[0].ownerSnapshotRef = 'fixture://portfolio-lab/owner-output/arbitrary';
  assert.throws(
    () => createPortfolioSnapshot(unboundSnapshot),
    (error) => error.code === 'SNAPSHOT_PROVENANCE_UNBOUND',
  );

  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const unboundEvaluation = scenarioInput(snapshot.snapshotHash);
  unboundEvaluation.sweepInputs[0].ownerRef = 'fixture://portfolio-lab/owner-output/arbitrary';
  assert.throws(
    () => createScenarioEvaluationInput(unboundEvaluation),
    (error) => error.code === 'OWNER_ATTRIBUTION_MISMATCH',
  );
});

test('coordinated reference replacement and stale owner claim hashes fail closed', () => {
  const coordinated = baseSnapshot();
  const outputMap = new Map(coordinated.ownerSnapshotRefs.map((ref, index) => [
    ref, `fixture://portfolio-lab/owner-output/arbitrary-${index}?sha256=${String(index + 1).repeat(64).slice(0, 64)}`,
  ]));
  const contractMap = new Map(coordinated.canonicalOwnerContractRefs.map((ref, index) => [
    ref, `git:${String.fromCharCode(98 + index).repeat(40)}:arbitrary-${index}.ts#Arbitrary${index}`,
  ]));
  coordinated.ownerSnapshotRefs = coordinated.ownerSnapshotRefs.map((ref) => outputMap.get(ref));
  coordinated.canonicalOwnerContractRefs = coordinated.canonicalOwnerContractRefs.map((ref) => contractMap.get(ref));
  for (const row of [
    ...coordinated.positions, ...coordinated.proposals, ...coordinated.liabilities,
    ...coordinated.collateral, ...coordinated.venueExposures,
  ]) {
    row.ownerSnapshotRef = outputMap.get(row.ownerSnapshotRef);
    row.canonicalOwnerRef = contractMap.get(row.canonicalOwnerRef);
  }
  coordinated.strategyClusters.forEach((row) => { row.sourceRef = outputMap.get(row.sourceRef); });
  coordinated.factorLinks.forEach((row) => { row.sourceRef = outputMap.get(row.sourceRef); });
  assert.throws(() => createPortfolioSnapshot(coordinated), { code: 'OWNER_REFERENCE_SET_MISMATCH' });

  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const staleSnapshotClaim = structuredClone(snapshot);
  staleSnapshotClaim.positions[0].exposure.atoms = '799999999';
  staleSnapshotClaim.snapshotHash = sha256(omitFields(staleSnapshotClaim, ['snapshotHash']));
  assert.throws(() => validatePortfolioSnapshot(staleSnapshotClaim), { code: 'OWNER_SNAPSHOT_CLAIM_MISMATCH' });

  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const staleScenarioClaim = structuredClone(evaluation);
  staleScenarioClaim.impacts[0].delta.atoms = '-119999999';
  staleScenarioClaim.evaluationHash = sha256(omitFields(staleScenarioClaim, ['evaluationHash']));
  assert.throws(() => validateScenarioEvaluationInput(staleScenarioClaim), { code: 'SCENARIO_OWNER_CLAIM_MISMATCH' });
});

test('creators reject recomputed values and context outside the finite owner claim allowlists', () => {
  const changedSnapshotValue = baseSnapshot();
  changedSnapshotValue.positions[0].exposure.atoms = '799999999';
  assert.throws(
    () => createPortfolioSnapshot(changedSnapshotValue),
    { code: 'OWNER_SNAPSHOT_CLAIM_NOT_ALLOWLISTED' },
  );

  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const changedOwnerValue = scenarioInput(snapshot.snapshotHash);
  changedOwnerValue.impacts[0].delta.atoms = '-119999999';
  assert.throws(
    () => createScenarioEvaluationInput(changedOwnerValue),
    { code: 'OWNER_SCENARIO_CLAIM_NOT_ALLOWLISTED' },
  );

  const retargetedSnapshot = scenarioInput('f'.repeat(64));
  assert.throws(
    () => createScenarioEvaluationInput(retargetedSnapshot),
    { code: 'OWNER_SCENARIO_CLAIM_NOT_ALLOWLISTED' },
  );

  const retargetedScenario = scenarioInput(snapshot.snapshotHash);
  retargetedScenario.scenarioReference.scenarioId = 'f12.broad-market-gap-retargeted';
  assert.throws(
    () => createScenarioEvaluationInput(retargetedScenario),
    { code: 'OWNER_SCENARIO_CLAIM_NOT_ALLOWLISTED' },
  );
});

test('scenario origins cannot self-assert empirical or historical evidence', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  for (const origin of ['EMPIRICAL', 'HISTORICAL']) {
    const input = scenarioInput(snapshot.snapshotHash);
    input.origin = origin;
    assert.throws(() => createScenarioEvaluationInput(input), { code: 'ENUM_INVALID' });
  }
});

test('scenario inputs reject empty impacts, absolute output, and seed drift', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());

  const emptyImpacts = scenarioInput(snapshot.snapshotHash);
  emptyImpacts.impacts = [];
  assert.throws(
    () => createScenarioEvaluationInput(emptyImpacts),
    (error) => error.code === 'SCENARIO_IMPACT_REQUIRED',
  );

  const absoluteOutput = scenarioInput(snapshot.snapshotHash);
  absoluteOutput.outputMode = 'ABSOLUTE';
  assert.throws(
    () => createScenarioEvaluationInput(absoluteOutput),
    (error) => error.code === 'ENUM_INVALID',
  );

  const seedDrift = scenarioInput(snapshot.snapshotHash);
  seedDrift.seed += 1;
  assert.throws(
    () => createScenarioEvaluationInput(seedDrift),
    (error) => error.code === 'SCENARIO_SEED_MISMATCH',
  );
});

test('scenario evaluation rejects uncertainty in a unit other than the snapshot reporting unit', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const input = scenarioInput(snapshot.snapshotHash);
  input.uncertainty.unit = 'BANANAS';
  assert.throws(
    () => createScenarioEvaluationInput(input),
    (error) => error.code === 'UNCERTAINTY_REPORTING_UNIT_MISMATCH',
  );
});
