#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOLUME_PUBLIC_REST_BASE_URL,
  VOLUME_PUBLIC_SOURCE_ID,
  VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
  buildVolumeStrategyObservation,
  validateVolumeStrategyObservation,
} from '../dist/engine/volume/strategyObservation.js';
import {
  createSyntheticVolumeEconomics,
} from '../dist/engine/volume/strategyEconomics.js';
import {
  evaluateVolumeStrategy,
  validateVolumeStrategyEvaluation,
} from '../dist/engine/volume/strategySlice.js';
import {
  buildSyntheticVolumeEconomicExitPolicy,
  evaluateVolumeEconomicExit,
  validateVolumeEconomicExitDecision,
  validateVolumeForwardExitSample,
} from '../dist/engine/volume/strategyEconomicExit.js';
import {
  VOLUME_ECONOMIC_EXIT_CONFIG_KEY,
  VOLUME_ECONOMIC_EXIT_RECONCILED_EVENT_KIND,
  VOLUME_ECONOMIC_EXIT_SAMPLED_EVENT_KIND,
  VolumeEconomicExitLedgerAdapter,
  createVolumeEconomicExitLedgerCoordinator,
  decodeVolumeEconomicExitCheckpoint,
  encodeVolumeEconomicExitCheckpoint,
  reconcileVolumeEconomicExitLocal,
  validateVolumeEconomicExitLocalReconciliation,
} from '../dist/engine/volume/strategyEconomicExitLedger.js';

const NOW_MS = 1_900_000_000_000;

function proposal(tag = 'a') {
  return {
    proposalId: `volume-proposal-${tag}`,
    proposalRevision: 7,
    proposalDigest: `vprop_${tag.repeat(64)}`,
    configurationRevision: `volume-config:${tag.repeat(24)}`,
    correlationId: `volume-correlation-${tag}`,
    symbol: 'BTCUSDT',
    direction: 'long',
    updatedTs: NOW_MS - 10,
    featureObservedAtMs: NOW_MS - 20,
    expiresAtMs: NOW_MS + 120_000,
  };
}

function observationInput(boundProposal, evaluatedAtMs, sourceRevision) {
  return {
    proposal: {
      proposalId: boundProposal.proposalId,
      proposalRevision: boundProposal.proposalRevision,
      proposalDigest: boundProposal.proposalDigest,
      configurationRevision: boundProposal.configurationRevision,
      correlationId: boundProposal.correlationId,
      symbol: boundProposal.symbol,
      direction: boundProposal.direction,
      expiresAtMs: boundProposal.expiresAtMs,
    },
    source: {
      sourceId: VOLUME_PUBLIC_SOURCE_ID,
      restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
      websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
      authentication: 'NONE',
      timeUnit: 'MILLISECOND',
      generation: 3,
      revision: sourceRevision,
      continuity: 'CONTIGUOUS',
    },
    aggregateTrade: {
      symbol: boundProposal.symbol,
      aggregateTradeId: sourceRevision * 10,
      firstTradeId: sourceRevision * 10 + 1,
      lastTradeId: sourceRevision * 10 + 2,
      eventTimeMs: evaluatedAtMs - 4,
      tradeTimeMs: evaluatedAtMs - 5,
      receivedAtMs: evaluatedAtMs - 3,
    },
    book: {
      symbol: boundProposal.symbol,
      bidPrice: '99990',
      askPrice: '100000',
      bidQuantity: '0.02',
      askQuantity: '0.015',
      sourceTimeMs: null,
      receivedAtMs: evaluatedAtMs - 2,
      freshnessBasis: 'RECEIVE_TIME',
      numericFidelity: 'SOURCE_TEXT_EXACT',
      scope: 'SYNCHRONIZED_DEPTH',
      depth: {
        synchronization: {
          sourceGeneration: 3,
          sourceRevision,
          snapshotLastUpdateId: sourceRevision * 100,
          updateRanges: [{
            firstUpdateId: sourceRevision * 100 + 1,
            finalUpdateId: sourceRevision * 100 + 1,
            eventTimeMs: evaluatedAtMs - 2,
          }],
        },
        bids: [
          { price: '99990', quantity: '0.02' },
          { price: '99980', quantity: '0.03' },
        ],
        asks: [
          { price: '100000', quantity: '0.015' },
          { price: '100010', quantity: '0.025' },
        ],
      },
    },
    evaluatedAtMs,
  };
}

function scenario(tag = 'a') {
  const entryProposal = proposal(tag);
  const entryObservation = buildVolumeStrategyObservation(
    observationInput(entryProposal, NOW_MS, 11),
  );
  const economics = createSyntheticVolumeEconomics({
    fixtureId: `volume-economic-exit-ledger-${tag}`,
    valuationAsset: 'USDT',
    grossEdgePer1000ValuationNotional: '5',
    accountFeeBpsPerSide: '10',
    slippageBpsPerSide: '5',
    liquidityCapacity: '5000',
    evaluatedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + 120_000,
  });
  const entryEvaluation = evaluateVolumeStrategy({
    proposal: entryProposal,
    observation: entryObservation,
    economics,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(entryEvaluation.disposition, 'VALIDATED_RECORD_ONLY');
  assert.equal(validateVolumeStrategyEvaluation(entryEvaluation), true);
  assert.equal(
    validateVolumeStrategyEvaluation(structuredClone(entryEvaluation)),
    true,
    'entry evaluation must survive an ordinary data snapshot',
  );
  assert.equal(
    validateVolumeStrategyEvaluation(
      Object.assign(Object.create(null), structuredClone(entryEvaluation)),
    ),
    true,
    'entry evaluation must accept a null-prototype root snapshot',
  );
  assert.equal(validateVolumeStrategyObservation(entryObservation), true);
  assert.equal(
    validateVolumeStrategyObservation(structuredClone(entryObservation)),
    true,
    'entry observation must survive an ordinary data snapshot',
  );

  const policy = buildSyntheticVolumeEconomicExitPolicy({
    fixtureId: `volume-economic-exit-policy-${tag}`,
    modeledBaseQuantity: '0.01',
    accountFeeBpsPerSide: '10',
    slippageBpsPerSide: '5',
    netLiquidationStopLossPer1000: '100',
    trailingDrawdownPer1000: '100',
    netLiquidationReversalLossPer1000: '100',
    evaluatedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + 120_000,
  });
  return Object.freeze({
    entryProposal,
    entryObservation,
    entryEvaluation,
    policy,
  });
}

function exitPair(owner, {
  evaluatedAtMs,
  sourceRevision,
  previousSample = null,
}) {
  const currentObservation = buildVolumeStrategyObservation(
    observationInput(owner.entryProposal, evaluatedAtMs, sourceRevision),
  );
  const result = evaluateVolumeEconomicExit({
    entryEvaluation: owner.entryEvaluation,
    entryObservation: owner.entryObservation,
    currentObservation,
    policy: owner.policy,
    previousSample,
    evaluatedAtMs,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.ok(result.sample, JSON.stringify(result.decision));
  assert.equal(result.decision.sampleId, result.sample.sampleId);
  assert.equal(result.decision.disposition, 'HOLD_SHADOW');
  assert.equal(result.decision.lifecyclePhase, 'HOLDING');
  assert.equal(validateVolumeForwardExitSample(result.sample), true);
  assert.equal(validateVolumeEconomicExitDecision(result.decision), true);
  return result;
}

class FakeExitLedger {
  value = null;
  events = [];
  nextId = 1;
  casCalls = 0;
  readCalls = 0;
  mode = 'NORMAL';

  getConfigValue(key) {
    assert.equal(key, VOLUME_ECONOMIC_EXIT_CONFIG_KEY);
    this.readCalls += 1;
    if (this.mode === 'READ_UNAVAILABLE') throw new Error('simulated read outage');
    return this.value;
  }

  compareAndSetConfigValueAndLogEvents(
    key,
    expectedValue,
    nextValue,
    records,
    commitBeforeMs,
  ) {
    assert.equal(key, VOLUME_ECONOMIC_EXIT_CONFIG_KEY);
    this.casCalls += 1;
    if (this.mode === 'DEADLINE_EXCEEDED') {
      return {
        committed: false,
        reason: 'DEADLINE_EXCEEDED',
        currentValue: this.value,
      };
    }
    if (this.value !== expectedValue) {
      return {
        committed: false,
        reason: 'VERSION_CONFLICT',
        currentValue: this.value,
      };
    }
    this.value = nextValue;
    const ts = records[0]?.createdAt ?? NOW_MS;
    const committedEvents = records.map((record) => ({
      id: this.nextId++,
      ts,
      kind: record.kind,
      symbol: record.symbol ?? null,
      data: structuredClone(record.data ?? null),
      severity: record.severity ?? null,
      source: record.source ?? null,
      strategy: record.strategy ?? null,
      status: record.status ?? null,
      reason: record.reason ?? null,
      message: record.message ?? null,
      correlation: record.correlation ?? null,
      createdAt: record.createdAt ?? ts,
    }));
    this.events.push(...committedEvents);
    if (this.mode === 'THROW_AFTER_COMMIT') {
      throw new Error('simulated lost post-commit response');
    }
    if (this.mode === 'BAD_RECEIPT') {
      committedEvents[0].status = 'FORGED';
    }
    assert.equal(
      commitBeforeMs === undefined
        || (Number.isSafeInteger(commitBeforeMs) && commitBeforeMs >= 0),
      true,
    );
    return {
      committed: true,
      events: committedEvents,
    };
  }
}

function assertLocalOnly(reconciliation) {
  assert.equal(reconciliation.scope, 'LOCAL_LEDGER_ONLY');
  assert.equal(reconciliation.executionAuthority, 'NONE');
  assert.equal(reconciliation.exchangeReconciliation, false);
  assert.equal(reconciliation.positionReconciliation, false);
  assert.equal(reconciliation.actualFillReconciliation, false);
  assert.equal(reconciliation.flatnessProven, false);
  assert.equal(validateVolumeEconomicExitLocalReconciliation(reconciliation), true);
}

test('exit shadow CAS atomically records the sample plus local reconciliation and restores its checksum', () => {
  const owner = scenario();
  const pair = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 1_000,
    sourceRevision: 12,
  });
  const ledger = new FakeExitLedger();
  const adapter = new VolumeEconomicExitLedgerAdapter(ledger);
  const empty = adapter.load();
  assert.equal(empty.status, 'EMPTY');

  const committed = adapter.commit({
    expected: empty,
    sample: pair.sample,
    decision: pair.decision,
    commitBeforeMs: NOW_MS + 2_000,
  });
  assert.equal(committed.disposition, 'COMMITTED_NEW');
  assert.deepEqual(committed.eventIds, [1, 2]);
  assert.equal(committed.checkpoint.revision, 1);
  assert.equal(committed.checkpoint.latestSample.sampleId, pair.sample.sampleId);
  assert.equal(committed.checkpoint.latestDecision.decisionId, pair.decision.decisionId);
  assert.equal(Object.isFrozen(committed.checkpoint), true);
  assertLocalOnly(committed.checkpoint.localReconciliation);
  assert.equal(committed.checkpoint.localReconciliation.status, 'EXACT');

  assert.deepEqual(ledger.events.map(({ kind }) => kind), [
    VOLUME_ECONOMIC_EXIT_SAMPLED_EVENT_KIND,
    VOLUME_ECONOMIC_EXIT_RECONCILED_EVENT_KIND,
  ]);
  assert.equal(ledger.events[0].ts, ledger.events[1].ts);
  assert.equal(ledger.events[0].createdAt, pair.decision.evaluatedAtMs);
  assert.equal(ledger.events[1].createdAt, pair.decision.evaluatedAtMs);
  assert.equal(ledger.events[0].data.executionAuthority, 'NONE');
  assert.equal(ledger.events[0].data.sendEligible, false);
  assert.equal(ledger.events[0].data.sends, 0);
  assert.equal(ledger.events[0].data.sideEffects, 0);
  assert.equal(ledger.events[1].data.executionAuthority, 'NONE');
  assert.equal(ledger.events[1].data.exchangeReconciliation, false);
  assert.equal(ledger.events[1].data.positionReconciliation, false);
  assert.equal(ledger.events[1].data.actualFillReconciliation, false);
  assert.equal(ledger.events[1].data.flatnessProven, false);

  const serialized = encodeVolumeEconomicExitCheckpoint(committed.checkpoint);
  assert.equal(serialized, ledger.value);
  assert.deepEqual(
    decodeVolumeEconomicExitCheckpoint(serialized),
    committed.checkpoint,
  );
  const tampered = JSON.parse(serialized);
  tampered.revision += 1;
  assert.equal(
    decodeVolumeEconomicExitCheckpoint(JSON.stringify(tampered)),
    null,
  );

  const restarted = createVolumeEconomicExitLedgerCoordinator(ledger);
  const restored = restarted.restore();
  assert.equal(restored.status, 'RESTORED');
  assert.equal(restored.checkpoint.checksum, committed.checkpoint.checksum);
  assert.equal(restarted.snapshot().status, 'AVAILABLE');
  assertLocalOnly(restarted.snapshot().checkpoint.localReconciliation);
});

test('exact replay writes nothing and a same-revision fork fails before CAS', () => {
  const owner = scenario();
  const pair = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 1_000,
    sourceRevision: 12,
  });
  const fork = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 2_000,
    sourceRevision: 13,
  });
  assert.notEqual(fork.sample.sampleId, pair.sample.sampleId);
  assert.equal(fork.sample.sampleRevision, pair.sample.sampleRevision);
  assert.equal(fork.sample.entryEvaluationId, pair.sample.entryEvaluationId);
  assert.equal(fork.sample.policyDigest, pair.sample.policyDigest);

  const ledger = new FakeExitLedger();
  const adapter = new VolumeEconomicExitLedgerAdapter(ledger);
  assert.equal(adapter.commit({
    expected: adapter.load(),
    sample: pair.sample,
    decision: pair.decision,
  }).disposition, 'COMMITTED_NEW');
  const writesAfterFirst = ledger.casCalls;

  const replay = adapter.commit({
    expected: adapter.load(),
    sample: pair.sample,
    decision: pair.decision,
  });
  assert.equal(replay.disposition, 'ALREADY_COMMITTED');
  assert.deepEqual(replay.eventIds, []);
  assert.equal(ledger.casCalls, writesAfterFirst);
  assert.equal(ledger.events.length, 2);

  const forked = adapter.commit({
    expected: adapter.load(),
    sample: fork.sample,
    decision: fork.decision,
  });
  assert.equal(forked.disposition, 'IDENTITY_CONFLICT');
  assert.equal(
    forked.reasonCode,
    'VOLUME_EXIT_SHADOW_LEDGER_IDENTITY_CONFLICT',
  );
  assert.equal(ledger.casCalls, writesAfterFirst);
  assert.equal(ledger.events.length, 2);
});

test('successor transitions are exact while stale writers, regressions, and failures stay contained', () => {
  const owner = scenario();
  const first = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 1_000,
    sourceRevision: 12,
  });
  const second = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 2_000,
    sourceRevision: 13,
    previousSample: first.sample,
  });
  assert.equal(second.sample.sampleRevision, 2);
  assert.equal(second.sample.previousSampleId, first.sample.sampleId);

  const ledger = new FakeExitLedger();
  const adapter = new VolumeEconomicExitLedgerAdapter(ledger);
  const staleExpected = adapter.load();
  assert.equal(adapter.commit({
    expected: staleExpected,
    sample: first.sample,
    decision: first.decision,
  }).disposition, 'COMMITTED_NEW');
  assert.equal(adapter.commit({
    expected: adapter.load(),
    sample: second.sample,
    decision: second.decision,
  }).disposition, 'COMMITTED_NEW');
  assert.equal(ledger.casCalls, 2);
  assert.equal(ledger.events.length, 4);

  const regressed = adapter.commit({
    expected: adapter.load(),
    sample: first.sample,
    decision: first.decision,
  });
  assert.equal(regressed.disposition, 'VERSION_CONFLICT');
  assert.equal(
    regressed.reasonCode,
    'VOLUME_EXIT_SHADOW_LEDGER_TRANSITION_REGRESSION',
  );
  assert.equal(ledger.casCalls, 2);

  const otherOwner = scenario('c');
  const other = exitPair(otherOwner, {
    evaluatedAtMs: NOW_MS + 2_500,
    sourceRevision: 12,
  });
  const staleWriter = adapter.commit({
    expected: staleExpected,
    sample: other.sample,
    decision: other.decision,
  });
  assert.equal(staleWriter.disposition, 'VERSION_CONFLICT');
  assert.equal(
    staleWriter.reasonCode,
    'VOLUME_EXIT_SHADOW_LEDGER_ACTIVE_HOLD_CONFLICT',
  );
  assert.equal(ledger.events.length, 4);

  const deadlineLedger = new FakeExitLedger();
  deadlineLedger.mode = 'DEADLINE_EXCEEDED';
  const deadlineAdapter = new VolumeEconomicExitLedgerAdapter(deadlineLedger);
  const deadline = deadlineAdapter.commit({
    expected: deadlineAdapter.load(),
    sample: first.sample,
    decision: first.decision,
    commitBeforeMs: NOW_MS,
  });
  assert.equal(deadline.disposition, 'DEADLINE_EXCEEDED');
  assert.equal(deadline.events, undefined);
  assert.equal(deadlineLedger.events.length, 0);

  const corruptLedger = new FakeExitLedger();
  corruptLedger.value = '{"corrupt":true}';
  const corruptCoordinator = createVolumeEconomicExitLedgerCoordinator(corruptLedger);
  assert.equal(corruptCoordinator.restore().status, 'CORRUPT');
  assert.deepEqual(corruptCoordinator.snapshot(), {
    status: 'BLOCKED',
    checkpoint: null,
    reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_CORRUPT',
  });

  const unavailableLedger = new FakeExitLedger();
  unavailableLedger.mode = 'READ_UNAVAILABLE';
  const unavailableCoordinator = createVolumeEconomicExitLedgerCoordinator(
    unavailableLedger,
  );
  assert.equal(unavailableCoordinator.restore().status, 'UNAVAILABLE');
  assert.deepEqual(unavailableCoordinator.snapshot(), {
    status: 'BLOCKED',
    checkpoint: null,
    reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_UNAVAILABLE',
  });

  const badReceiptLedger = new FakeExitLedger();
  badReceiptLedger.mode = 'BAD_RECEIPT';
  const badReceiptAdapter = new VolumeEconomicExitLedgerAdapter(badReceiptLedger);
  const badReceipt = badReceiptAdapter.commit({
    expected: badReceiptAdapter.load(),
    sample: first.sample,
    decision: first.decision,
  });
  assert.equal(badReceipt.disposition, 'COMMIT_READBACK_INVALID');
  assert.equal(
    badReceipt.reasonCode,
    'VOLUME_EXIT_SHADOW_LEDGER_EVENT_READBACK_INVALID',
  );

  const lostResponseLedger = new FakeExitLedger();
  lostResponseLedger.mode = 'THROW_AFTER_COMMIT';
  const lostResponseAdapter = new VolumeEconomicExitLedgerAdapter(
    lostResponseLedger,
  );
  const recovered = lostResponseAdapter.commit({
    expected: lostResponseAdapter.load(),
    sample: first.sample,
    decision: first.decision,
  });
  assert.equal(recovered.disposition, 'ALREADY_COMMITTED');
  assert.equal(recovered.checkpoint.latestSample.sampleId, first.sample.sampleId);
  assert.equal(lostResponseLedger.events.length, 2);
});

test('local reconciliation distinguishes exact, stale, unavailable, ambiguous, and diverged without claims', () => {
  const owner = scenario();
  const first = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 1_000,
    sourceRevision: 12,
  });
  const second = exitPair(owner, {
    evaluatedAtMs: NOW_MS + 2_000,
    sourceRevision: 13,
    previousSample: first.sample,
  });
  const otherOwner = scenario('d');
  const other = exitPair(otherOwner, {
    evaluatedAtMs: NOW_MS + 1_500,
    sourceRevision: 12,
  });
  const current = Object.freeze({
    sample: second.sample,
    decision: second.decision,
  });
  const prior = Object.freeze({
    sample: first.sample,
    decision: first.decision,
  });
  const diverged = Object.freeze({
    sample: other.sample,
    decision: other.decision,
  });
  const cases = [
    ['EXACT', reconcileVolumeEconomicExitLocal(current, current)],
    ['STALE', reconcileVolumeEconomicExitLocal(current, prior)],
    ['UNAVAILABLE', reconcileVolumeEconomicExitLocal(current, null)],
    ['AMBIGUOUS', reconcileVolumeEconomicExitLocal(current, {})],
    ['DIVERGED', reconcileVolumeEconomicExitLocal(current, diverged)],
  ];

  for (const [status, reconciliation] of cases) {
    assert.equal(reconciliation.status, status);
    assertLocalOnly(reconciliation);
    assert.equal(Object.isFrozen(reconciliation), true);
  }
});
