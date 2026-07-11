import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';
import { projectActivePosition } from '../../../dist/capitalFoundation/positions/index.js';

const NOW = 1_800_000_000_000;

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'lane-f-position-test',
      ...(overrides.source ?? {}),
    },
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
    requiredValuePresent: overrides.requiredValuePresent ?? true,
    divergent: overrides.divergent ?? false,
    reasons: overrides.reasons ?? [],
    revision: overrides.revision ?? 'r1',
  });
}

function thesis(strategy = 'BASIS') {
  return {
    id: `thesis-${strategy}`,
    revision: 1,
    strategy,
    proposalId: `proposal-${strategy}`,
    originalEvidenceIds: ['evidence-original'],
    intelligenceThesisPacketId: 'thesis-packet-1',
    openedAtMs: NOW - 10_000,
    expectedHorizonMs: 60_000,
    maximumHoldingHorizonMs: 120_000,
    targetConditions: ['converge'],
    invalidationConditions: ['diverge'],
    stopAddingConditions: ['stale'],
    configRevision: 'cfg-1',
  };
}

function leg(id, side, exposure = '100', overrides = {}) {
  return {
    id,
    instrumentId: id,
    symbol: 'BTCUSDT',
    side,
    quantity: exposure === '0' ? '0' : '1',
    quoteExposure: exposure,
    valuationAsset: 'USDT',
    externalLifecycle: exposure === '0' ? 'CANCELLED' : 'FILLED',
    truth: truth(),
    ...overrides,
  };
}

function execution(lifecycle = 'HEDGED_OPEN', overrides = {}) {
  return {
    externalPlanId: 'plan-1',
    correlationId: 'cor-1',
    lifecycle,
    observedAtMs: NOW - 50,
    sequence: 10,
    revision: 'exec-r1',
    truth: truth(),
    ...overrides,
  };
}

function reconciliation(status = 'EXACT', overrides = {}) {
  return {
    externalPlanId: 'plan-1',
    correlationId: 'cor-1',
    status,
    observedAtMs: NOW - 40,
    sequence: 11,
    revision: 'recon-r1',
    reasonCodes: [],
    truth: truth({ divergent: status === 'DIVERGED' }),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    revision: 1,
    mandateId: 'mandate-1',
    thesis: thesis(),
    sourceState: 'ACTIVE',
    sourceCapitalLifecycle: 'ACTIVE',
    legs: [leg('spot', 'LONG'), leg('perp', 'SHORT')],
    oneLegSinceMs: null,
    executionState: execution(),
    reconciliationState: reconciliation(),
    outstandingActionIntentIds: [],
    openedAtMs: NOW - 10_000,
    lastTransitionAtMs: NOW - 1_000,
    truth: truth(),
    projectedAtMs: NOW,
    ...overrides,
  };
}

test('position projection is deterministic and derives exact exposure without floats', () => {
  const first = projectActivePosition(input());
  const second = projectActivePosition(input());
  assert.deepEqual(first, second, 'same input and injected time must replay byte-equivalently');
  assert.equal(first.position.totalGrossExposure, '200');
  assert.equal(first.position.netDirectionalExposure, '0');
  assert.equal(first.position.hedgeRatio, '1');
  assert.equal(first.position.oneLegExposure, '0');
  assert.equal(first.position.state, 'ACTIVE');
  assert.equal(first.supervisionPriority, 'EXPOSED_CAPITAL');
});

test('emitted leg truth is re-aged at the injected projection clock', () => {
  const previouslyFresh = truth({
    source: { sourceTimeMs: NOW - 10_000, receivedAtMs: NOW - 9_990, maxAgeMs: 1_000 },
    evaluatedAtMs: NOW - 9_500,
  });
  assert.equal(previouslyFresh.completeness, 'COMPLETE');
  const result = projectActivePosition(input({
    legs: [leg('spot', 'LONG', '100', { truth: previouslyFresh }), leg('perp', 'SHORT')],
  }));
  const projectedLeg = result.position.legs.find((item) => item.id === 'spot');
  assert.equal(projectedLeg.truth.evaluatedAtMs, NOW);
  assert.equal(projectedLeg.truth.freshness.evaluatedAt, NOW);
  assert.equal(projectedLeg.truth.completeness, 'STALE');
});

test('projected thesis and truth collections cannot be changed through caller aliases', () => {
  const mutableThesis = thesis();
  const mutablePositionTruth = { ...truth(), reasons: ['position-original'], evidenceReferences: ['position-evidence'] };
  const mutableLegTruth = { ...truth(), reasons: ['leg-original'], evidenceReferences: ['leg-evidence'] };
  const result = projectActivePosition(input({
    thesis: mutableThesis,
    truth: mutablePositionTruth,
    legs: [leg('spot', 'LONG', '100', { truth: mutableLegTruth }), leg('perp', 'SHORT')],
  }));

  mutableThesis.originalEvidenceIds.push('caller-mutation');
  mutableThesis.targetConditions.push('caller-mutation');
  mutableThesis.invalidationConditions.push('caller-mutation');
  mutableThesis.stopAddingConditions.push('caller-mutation');
  mutablePositionTruth.reasons.push('caller-mutation');
  mutablePositionTruth.evidenceReferences.push('caller-mutation');
  mutableLegTruth.reasons.push('caller-mutation');
  mutableLegTruth.evidenceReferences.push('caller-mutation');

  assert.deepEqual(result.position.thesis.originalEvidenceIds, ['evidence-original']);
  assert.deepEqual(result.position.thesis.targetConditions, ['converge']);
  assert.deepEqual(result.position.thesis.invalidationConditions, ['diverge']);
  assert.deepEqual(result.position.thesis.stopAddingConditions, ['stale']);
  assert.deepEqual(result.position.truth.reasons, ['leg-original', 'position-original']);
  assert.deepEqual(result.position.truth.evidenceReferences, ['leg-evidence', 'position-evidence']);
  assert.deepEqual(result.position.legs.find((item) => item.id === 'spot').truth.reasons, ['leg-original']);
  assert.deepEqual(result.position.legs.find((item) => item.id === 'spot').truth.evidenceReferences, ['leg-evidence']);
  for (const collection of [
    result.position.thesis.originalEvidenceIds,
    result.position.thesis.targetConditions,
    result.position.thesis.invalidationConditions,
    result.position.thesis.stopAddingConditions,
    result.position.truth.reasons,
    result.position.truth.evidenceReferences,
    result.position.legs.find((item) => item.id === 'spot').truth.reasons,
    result.position.legs.find((item) => item.id === 'spot').truth.evidenceReferences,
  ]) assert.equal(Object.isFrozen(collection), true);
});

test('Foundation execution and reconciliation slices become narrow deterministic references', () => {
  const result = projectActivePosition(input());
  assert.match(result.executionReference.id, /^cexec_/);
  assert.match(result.reconciliationReference.id, /^crecon_/);
  assert.equal(result.executionReference.lifecycle, 'HEDGED_OPEN');
  assert.equal(result.reconciliationReference.status, 'EXACT');
});

test('one-leg truth becomes partially exposed with exact naked amount and duration origin', () => {
  const result = projectActivePosition(input({
    legs: [leg('spot', 'LONG')],
    oneLegSinceMs: NOW - 500,
    executionState: execution('ONE_LEG_EXPOSED'),
  }));
  assert.equal(result.position.state, 'PARTIALLY_EXPOSED');
  assert.equal(result.position.capitalLifecycle, 'PARTIALLY_EXPOSED');
  assert.equal(result.position.oneLegExposure, '100');
  assert.equal(result.position.oneLegSinceMs, NOW - 500);
});

test('divergent reconciliation overrides optimistic source state and remains first-class', () => {
  const result = projectActivePosition(input({ reconciliationState: reconciliation('DIVERGED', { reasonCodes: ['QTY_MISMATCH'] }) }));
  assert.equal(result.position.state, 'RECOVERY_REQUIRED');
  assert.equal(result.position.capitalLifecycle, 'RECOVERY_REQUIRED');
  assert.equal(result.position.truth.completeness, 'DIVERGENT');
  assert.ok(result.issues.some((issue) => issue.code === 'RECONCILIATION_DIVERGED'));
});

test('missing external references never present exposed capital as reconciled', () => {
  const result = projectActivePosition(input({ executionState: null, reconciliationState: null }));
  assert.equal(result.position.state, 'UNKNOWN');
  assert.equal(result.position.truth.completeness, 'UNKNOWN');
  assert.deepEqual(result.issues.filter((issue) => issue.code.endsWith('_MISSING')).map((issue) => issue.code), [
    'EXECUTION_REFERENCE_MISSING',
    'RECONCILIATION_REFERENCE_MISSING',
  ]);
});

test('cross-plan execution/reconciliation correlation fails divergent', () => {
  const result = projectActivePosition(input({ reconciliationState: reconciliation('EXACT', { externalPlanId: 'plan-other' }) }));
  assert.equal(result.position.state, 'RECOVERY_REQUIRED');
  assert.equal(result.position.capitalLifecycle, 'RECOVERY_REQUIRED');
  assert.equal(result.position.truth.completeness, 'DIVERGENT');
  assert.ok(result.issues.some((issue) => issue.code === 'EXTERNAL_CORRELATION_MISMATCH'));
});

test('closed requires Foundation CLOSED plus exact reconciliation and zero exposure', () => {
  const result = projectActivePosition(input({
    sourceState: 'EXITING',
    sourceCapitalLifecycle: 'EXITING',
    legs: [leg('spot', 'LONG', '0'), leg('perp', 'SHORT', '0')],
    executionState: execution('CLOSED'),
  }));
  assert.equal(result.position.state, 'CLOSED');
  assert.equal(result.position.capitalLifecycle, 'CLOSED');
  assert.equal(result.position.totalGrossExposure, '0');
});

test('caller-supplied CLOSED cannot hide positive externally reported exposure', () => {
  const result = projectActivePosition(input({
    sourceState: 'CLOSED',
    sourceCapitalLifecycle: 'CLOSED',
    executionState: execution('CLOSED'),
  }));
  assert.equal(result.position.totalGrossExposure, '200');
  assert.equal(result.position.state, 'RECOVERY_REQUIRED');
  assert.equal(result.position.capitalLifecycle, 'RECOVERY_REQUIRED');
  assert.ok(result.issues.some((issue) => issue.code === 'SOURCE_STATE_OVERRIDDEN'));
});

test('different leg valuation assets fail closed before incomparable exposure is summed', () => {
  assert.throws(() => projectActivePosition(input({
    legs: [
      leg('spot', 'LONG', '100', { valuationAsset: 'BTC' }),
      leg('perp', 'SHORT', '100', { valuationAsset: 'USDT' }),
    ],
  })), /cannot combine different valuation assets/);
});

test('leg contradictions and stale source truth fail closed rather than becoming zero/fresh', () => {
  const contradictory = leg('spot', 'LONG', '100', { quantity: '0' });
  const result = projectActivePosition(input({
    legs: [contradictory, leg('perp', 'SHORT')],
    truth: truth({ source: { sourceTimeMs: NOW - 10_000 } }),
  }));
  assert.equal(result.position.truth.completeness, 'DIVERGENT');
  assert.ok(result.issues.some((issue) => issue.code === 'LEG_EXPOSURE_INCONSISTENT'));
});

test('canonical ordering removes duplicate outstanding intent IDs', () => {
  const result = projectActivePosition(input({
    legs: [leg('z-leg', 'SHORT'), leg('a-leg', 'LONG')],
    outstandingActionIntentIds: ['intent-b', 'intent-a', 'intent-b'],
  }));
  assert.deepEqual(result.position.legs.map((item) => item.id), ['a-leg', 'z-leg']);
  assert.deepEqual(result.position.outstandingActionIntentIds, ['intent-a', 'intent-b']);
});
