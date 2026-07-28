#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS } from '../dist/config.js';
import { deriveVolumeConfigVersion } from '../dist/engine/volume/config.js';
import {
  VOLUME_PUBLIC_REST_BASE_URL,
  VOLUME_PUBLIC_SOURCE_ID,
  VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
  VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS,
  assessVolumeStrategyObservationSource,
  buildVolumeStrategyObservation,
  inspectVolumeStrategyObservation,
  validateVolumeStrategyObservation,
} from '../dist/engine/volume/strategyObservation.js';
import {
  VOLUME_CURRENT_CONDITIONAL_PROXY,
  assessVolumeEconomics,
  createSyntheticVolumeEconomics,
  validateVolumeEconomics,
} from '../dist/engine/volume/strategyEconomics.js';
import {
  buildVolumeValidateOnlyObservationProposal,
  createVolumeStrategySlice,
  evaluateVolumeStrategy,
  reconcileVolumeStrategyLocal,
  replayVolumeStrategyEvaluation,
  validateVolumeStrategyEvaluation,
  validateVolumeValidateOnlyObservationProposal,
  validateVolumeStrategyLocalReconciliation,
  validateVolumeValidateOnlyPlan,
} from '../dist/engine/volume/strategySlice.js';
import {
  VOLUME_STRATEGY_CONFIG_KEY,
  VOLUME_STRATEGY_EVALUATED_EVENT_KIND,
  VOLUME_STRATEGY_RECONCILED_EVENT_KIND,
  VolumeStrategyLedgerAdapter,
  createVolumeStrategyLedgerCoordinator,
  decodeVolumeStrategyCheckpoint,
  encodeVolumeStrategyCheckpoint,
} from '../dist/engine/volume/strategyLedger.js';
import { VolumeRuntime } from '../dist/services/volumeRuntime.js';

const NOW_MS = 1_900_000_000_000;

function observationInput(overrides = {}) {
  const proposal = {
    proposalId: 'volume-proposal-0001',
    proposalRevision: 7,
    proposalDigest: `vprop_${'a'.repeat(64)}`,
    configurationRevision: `volume-config:${'b'.repeat(24)}`,
    correlationId: 'volume-correlation-0001',
    symbol: 'BTCUSDT',
    direction: 'long',
    expiresAtMs: NOW_MS + 60_000,
    ...overrides.proposal,
  };
  const source = {
    sourceId: VOLUME_PUBLIC_SOURCE_ID,
    restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
    websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
    authentication: 'NONE',
    timeUnit: 'MILLISECOND',
    generation: 3,
    revision: 11,
    continuity: 'CONTIGUOUS',
    ...overrides.source,
  };
  const aggregateTrade = {
    symbol: proposal.symbol,
    aggregateTradeId: 100,
    firstTradeId: 200,
    lastTradeId: 202,
    eventTimeMs: NOW_MS - 4,
    tradeTimeMs: NOW_MS - 5,
    receivedAtMs: NOW_MS - 3,
    ...overrides.aggregateTrade,
  };
  const book = {
    symbol: proposal.symbol,
    bidPrice: '99990',
    askPrice: '100000',
    bidQuantity: '0.02',
    askQuantity: '0.015',
    sourceTimeMs: null,
    receivedAtMs: NOW_MS - 2,
    freshnessBasis: 'RECEIVE_TIME',
    numericFidelity: 'SOURCE_TEXT_EXACT',
    scope: 'SYNCHRONIZED_DEPTH',
    depth: {
      synchronization: {
        sourceGeneration: source.generation,
        sourceRevision: source.revision,
        snapshotLastUpdateId: 500,
        updateRanges: [{
          firstUpdateId: 501,
          finalUpdateId: 501,
          eventTimeMs: NOW_MS - 2,
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
    ...overrides.book,
  };
  return {
    proposal,
    source,
    aggregateTrade,
    book,
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW_MS,
  };
}

function deepMutationRejected(value, mutate) {
  const clone = structuredClone(value);
  mutate(clone);
  const inspected = inspectVolumeStrategyObservation(clone);
  assert.equal(inspected.observation, null);
  assert.ok(inspected.reasonCodes.length > 0);
}

function syntheticEconomicsInput(overrides = {}) {
  return {
    fixtureId: 'volume-strategy-slice-positive-0001',
    valuationAsset: 'USDT',
    grossEdgePer1000ValuationNotional: '5',
    accountFeeBpsPerSide: '10',
    slippageBpsPerSide: '5',
    liquidityCapacity: '5000',
    evaluatedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + 60_000,
    ...overrides,
  };
}

function proposalRiskCut(overrides = {}) {
  return {
    proposalId: 'volume-proposal-0001',
    proposalRevision: 7,
    proposalDigest: `vprop_${'a'.repeat(64)}`,
    configurationRevision: `volume-config:${'b'.repeat(24)}`,
    correlationId: 'volume-correlation-0001',
    symbol: 'BTCUSDT',
    direction: 'long',
    updatedTs: NOW_MS - 10,
    featureObservedAtMs: NOW_MS - 20,
    expiresAtMs: NOW_MS + 60_000,
    ...overrides,
  };
}

function verifiedKillSwitchDecision(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    ts: NOW_MS - 10,
    strategy: 'volume_spike',
    kind: 'reject',
    rejectCode: 'kill_switch_on',
    humanReason: 'Volume strategy kill switch is engaged; observation only.',
    correlationId: 'volume-correlation-0001',
    evidence: {
      direction: 'long',
      sourceId: VOLUME_PUBLIC_SOURCE_ID,
      authentication: 'NONE',
      publicOnly: true,
      observationDigest: `vobs_${'a'.repeat(64)}`,
    },
    ...overrides,
  };
}

function evaluationInput({
  proposal = proposalRiskCut(),
  observation = null,
  economics = null,
} = {}) {
  return {
    proposal,
    observation: observation ?? buildVolumeStrategyObservation(observationInput({
      proposal: {
        proposalId: proposal.proposalId,
        proposalRevision: proposal.proposalRevision,
        proposalDigest: proposal.proposalDigest,
        configurationRevision: proposal.configurationRevision,
        correlationId: proposal.correlationId,
        symbol: proposal.symbol,
        direction: proposal.direction,
        expiresAtMs: proposal.expiresAtMs,
      },
    })),
    economics: economics ?? createSyntheticVolumeEconomics(syntheticEconomicsInput()),
  };
}

function assertNoAuthority(evaluation) {
  assert.equal(evaluation.controls.killSwitchEngaged, true);
  assert.equal(evaluation.plan.killSwitchEngaged, true);
  assert.equal(evaluation.plan.mode, 'VALIDATE_ONLY');
  assert.equal(evaluation.plan.executionAuthority, 'NONE');
  assert.equal(evaluation.plan.submitAuthority, 'NONE');
  assert.equal(evaluation.plan.riskAuthority, 'NONE');
  assert.equal(evaluation.plan.externalAuthority, 'NONE');
  assert.equal(evaluation.plan.sendEligible, false);
  assert.equal(evaluation.plan.sends, 0);
  assert.equal(evaluation.plan.sideEffects, 0);
  assert.equal(evaluation.plan.submitPortPresent, false);
  assert.equal(evaluation.plan.publicOnly, true);
  assert.equal(evaluation.plan.privateCalls, false);
  assert.equal(evaluation.plan.signedCalls, false);
  assert.equal(evaluation.plan.providerCalls, false);
  for (const forbidden of [
    'apiKey',
    'secretKey',
    'credential',
    'order',
    'orderId',
    'client',
    'clientOrderId',
    'provider',
    'submit',
    'submitFn',
    'send',
    'sendFn',
  ]) {
    assert.equal(Object.hasOwn(evaluation.plan, forbidden), false, forbidden);
  }
}

function validatedEvaluation({
  proposalOverrides = {},
  economicsOverrides = {},
} = {}) {
  const proposal = proposalRiskCut(proposalOverrides);
  const economics = createSyntheticVolumeEconomics(syntheticEconomicsInput(economicsOverrides));
  const evaluation = evaluateVolumeStrategy(
    evaluationInput({ proposal, economics }),
    { enabled: true, killSwitchEngaged: true },
  );
  assert.equal(evaluation.disposition, 'VALIDATED_RECORD_ONLY');
  assert.equal(validateVolumeStrategyEvaluation(evaluation), true);
  return evaluation;
}

class FakeVolumeStrategyLedger {
  value = null;
  events = [];
  nextId = 1;
  casCalls = 0;
  readCalls = 0;
  mode = 'NORMAL';

  getConfigValue(key) {
    assert.equal(key, VOLUME_STRATEGY_CONFIG_KEY);
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
    assert.equal(key, VOLUME_STRATEGY_CONFIG_KEY);
    this.casCalls += 1;
    if (this.mode === 'DEADLINE_EXCEEDED') {
      return {
        committed: false,
        reason: 'DEADLINE_EXCEEDED',
        currentValue: this.value,
      };
    }
    if (this.mode === 'WINNER_SAME') {
      this.value = nextValue;
      return {
        committed: false,
        reason: 'VERSION_CONFLICT',
        currentValue: nextValue,
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

test('public observation is exact, immutable, millisecond-bound, and source-backed without authentication', () => {
  const observation = buildVolumeStrategyObservation(observationInput());

  assert.equal(observation.source.sourceId, 'binance.spot.public-unauthenticated-market-data');
  assert.equal(observation.source.authentication, 'NONE');
  assert.equal(observation.source.timeUnit, 'MILLISECOND');
  assert.equal(observation.source.restBaseUrl, 'https://api.binance.com');
  assert.equal(observation.source.websocketBaseUrl, 'wss://data-stream.binance.vision:443');
  assert.equal(observation.aggregateTrade.eventTimeMs, NOW_MS - 4);
  assert.equal(observation.aggregateTrade.tradeTimeMs, NOW_MS - 5);
  assert.equal(observation.aggregateTrade.receivedAtMs, NOW_MS - 3);
  assert.equal(observation.book.receivedAtMs, NOW_MS - 2);
  assert.equal(observation.book.numericFidelity, 'SOURCE_TEXT_EXACT');
  assert.deepEqual(observation.book.capacity, {
    side: 'BUY',
    basis: 'SYNCHRONIZED_CUMULATIVE',
    price: '100010',
    baseQuantity: '0.04',
    quoteNotional: '4000.25',
    levelCount: 2,
  });
  assert.match(observation.observationDigest, /^vobs_[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.proposal), true);
  assert.equal(Object.isFrozen(observation.source), true);
  assert.equal(Object.isFrozen(observation.aggregateTrade), true);
  assert.equal(Object.isFrozen(observation.book), true);
  assert.equal(Object.isFrozen(observation.book.capacity), true);
  assert.deepEqual(inspectVolumeStrategyObservation(observation), {
    observation,
    reasonCodes: [],
  });
  assert.deepEqual(assessVolumeStrategyObservationSource(observation), {
    accepted: true,
    reasonCodes: [],
  });
});

test('GAP, UNKNOWN, RECONNECTING, stale, expired, and top-of-book-only public cuts fail closed with named reasons', () => {
  const expectedContinuity = {
    GAP: 'VOLUME_SOURCE_CONTINUITY_GAP',
    UNKNOWN: 'VOLUME_SOURCE_CONTINUITY_UNKNOWN',
    RECONNECTING: 'VOLUME_SOURCE_RECONNECTING',
  };
  for (const [continuity, reason] of Object.entries(expectedContinuity)) {
    const observation = buildVolumeStrategyObservation(observationInput({
      source: { continuity },
    }));
    assert.deepEqual(assessVolumeStrategyObservationSource(observation), {
      accepted: false,
      reasonCodes: [reason],
    });
  }

  const topOnly = buildVolumeStrategyObservation(observationInput({
    book: {
      scope: 'TOP_OF_BOOK',
      depth: null,
      numericFidelity: 'NORMALIZED_FROM_PARSED_NUMBER',
    },
  }));
  assert.equal(topOnly.book.capacity.basis, 'BEST_LEVEL_ONLY');
  assert.deepEqual(assessVolumeStrategyObservationSource(topOnly), {
    accepted: false,
    reasonCodes: [
      'VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED',
      'VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY',
    ],
  });

  assert.throws(
    () => buildVolumeStrategyObservation(observationInput({
      aggregateTrade: {
        tradeTimeMs: NOW_MS - VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS - 1,
        eventTimeMs: NOW_MS - VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS - 1,
        receivedAtMs: NOW_MS - VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS - 1,
      },
    })),
    /VOLUME_OBSERVATION_STALE/,
  );
  assert.throws(
    () => buildVolumeStrategyObservation(observationInput({
      proposal: { expiresAtMs: NOW_MS },
    })),
    /VOLUME_OBSERVATION_EXPIRED/,
  );
});

test('observation boundary rejects deep mutation, hostile proxies/accessors, NaN, Infinity, and negative zero trap-free', () => {
  const observation = buildVolumeStrategyObservation(observationInput());
  deepMutationRejected(observation, (value) => {
    value.aggregateTrade.lastTradeId += 1;
  });
  deepMutationRejected(observation, (value) => {
    value.book.capacity.quoteNotional = '999999';
  });
  deepMutationRejected(observation, (value) => {
    value.proposal.proposalDigest = `vprop_${'c'.repeat(64)}`;
  });

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
    assert.throws(
      () => buildVolumeStrategyObservation(observationInput({
        aggregateTrade: { aggregateTradeId: invalid },
      })),
      /VOLUME_OBSERVATION_TRADE_CURSOR_INVALID/,
    );
    assert.throws(
      () => buildVolumeStrategyObservation(observationInput({
        evaluatedAtMs: invalid,
      })),
      /VOLUME_OBSERVATION_CLOCK_INVALID/,
    );
  }

  let trapCalls = 0;
  const proxy = new Proxy(observationInput(), {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not invoke proxy trap');
    },
  });
  assert.throws(
    () => buildVolumeStrategyObservation(proxy),
    /VOLUME_OBSERVATION_NOT_PLAIN_DATA/,
  );
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessor = observationInput();
  Object.defineProperty(accessor.book, 'askPrice', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not invoke getter');
    },
  });
  assert.throws(
    () => buildVolumeStrategyObservation(accessor),
    /VOLUME_OBSERVATION_NOT_PLAIN_DATA/,
  );
  assert.equal(getterCalls, 0);
});

test('capacity arithmetic overflow fails closed without throwing from inspectors', () => {
  const overflow = structuredClone(buildVolumeStrategyObservation(observationInput()));
  overflow.book.bidPrice = '8'.repeat(96);
  overflow.book.askPrice = '9'.repeat(96);
  overflow.book.bidQuantity = '9'.repeat(96);
  overflow.book.askQuantity = '9'.repeat(96);
  overflow.book.depth.bids = [{
    price: overflow.book.bidPrice,
    quantity: overflow.book.bidQuantity,
  }];
  overflow.book.depth.asks = [{
    price: overflow.book.askPrice,
    quantity: overflow.book.askQuantity,
  }];

  assert.deepEqual(inspectVolumeStrategyObservation(overflow), {
    observation: null,
    reasonCodes: ['VOLUME_OBSERVATION_CAPACITY_INVALID'],
  });
  assert.equal(validateVolumeStrategyObservation(overflow), false);
  assert.deepEqual(assessVolumeStrategyObservationSource(overflow), {
    accepted: false,
    reasonCodes: ['VOLUME_SOURCE_OBSERVATION_INVALID'],
  });
  assert.throws(
    () => buildVolumeStrategyObservation(observationInput({
      book: {
        bidPrice: '8'.repeat(96),
        askPrice: '9'.repeat(96),
        bidQuantity: '9'.repeat(96),
        askQuantity: '9'.repeat(96),
        depth: {
          synchronization: {
            sourceGeneration: 3,
            sourceRevision: 11,
            snapshotLastUpdateId: 500,
            updateRanges: [{
              firstUpdateId: 501,
              finalUpdateId: 501,
              eventTimeMs: NOW_MS - 2,
            }],
          },
          bids: [{
            price: '8'.repeat(96),
            quantity: '9'.repeat(96),
          }],
          asks: [{
            price: '9'.repeat(96),
            quantity: '9'.repeat(96),
          }],
        },
      },
    })),
    /VOLUME_OBSERVATION_CAPACITY_INVALID/,
  );
});

test('verified public kill-switch Decision derives a deterministic immutable validate-only proposal and rejects hostile variants', () => {
  const input = {
    decision: verifiedKillSwitchDecision(),
    configurationRevision: `volume-config:${'b'.repeat(24)}`,
    expiresAtMs: NOW_MS + 60_000,
  };
  const first = buildVolumeValidateOnlyObservationProposal(input);
  const replay = buildVolumeValidateOnlyObservationProposal(input);

  assert.deepEqual(replay, first);
  assert.equal(validateVolumeValidateOnlyObservationProposal(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.proposalKind, 'VOLUME_VALIDATE_ONLY_OBSERVATION');
  assert.equal(first.proposalRevision, 1);
  assert.equal(first.configurationRevision, input.configurationRevision);
  assert.equal(first.correlationId, input.decision.correlationId);
  assert.equal(first.symbol, input.decision.symbol);
  assert.equal(first.direction, input.decision.evidence.direction);
  assert.equal(first.updatedTs, input.decision.ts);
  assert.equal(first.featureObservedAtMs, input.decision.ts);
  assert.equal(first.expiresAtMs, input.expiresAtMs);
  assert.match(first.evidenceBindingDigest, /^vdecision_[0-9a-f]{64}$/);
  assert.match(first.proposalId, /^vvop_[0-9a-f]{64}$/);
  assert.match(first.proposalDigest, /^vvopd_[0-9a-f]{64}$/);

  const changedEvidence = buildVolumeValidateOnlyObservationProposal({
    ...input,
    decision: verifiedKillSwitchDecision({
      evidence: {
        ...input.decision.evidence,
        observationDigest: `vobs_${'b'.repeat(64)}`,
      },
    }),
  });
  assert.notEqual(changedEvidence.evidenceBindingDigest, first.evidenceBindingDigest);
  assert.notEqual(changedEvidence.proposalId, first.proposalId);
  assert.notEqual(changedEvidence.proposalDigest, first.proposalDigest);
  const firstEvaluation = evaluateVolumeStrategy(
    evaluationInput({ proposal: first }),
    { enabled: true, killSwitchEngaged: true },
  );
  const changedEvidenceEvaluation = evaluateVolumeStrategy(
    evaluationInput({ proposal: changedEvidence }),
    { enabled: true, killSwitchEngaged: true },
  );
  assert.equal(validateVolumeStrategyEvaluation(firstEvaluation), true);
  assert.equal(validateVolumeStrategyEvaluation(changedEvidenceEvaluation), true);
  assert.notEqual(changedEvidenceEvaluation.evaluationId, firstEvaluation.evaluationId);
  assert.notEqual(changedEvidenceEvaluation.plan.planId, firstEvaluation.plan.planId);

  for (const decision of [
    verifiedKillSwitchDecision({ kind: 'accept' }),
    verifiedKillSwitchDecision({ rejectCode: 'strategy_disabled' }),
    verifiedKillSwitchDecision({ strategy: 'basis' }),
    verifiedKillSwitchDecision({
      evidence: { ...input.decision.evidence, direction: 'sideways' },
    }),
  ]) {
    assert.throws(
      () => buildVolumeValidateOnlyObservationProposal({ ...input, decision }),
      /verified kill-switch Volume decision is invalid/,
    );
  }

  let trapCalls = 0;
  const hostile = new Proxy(input, {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not invoke proxy trap');
    },
  });
  assert.throws(
    () => buildVolumeValidateOnlyObservationProposal(hostile),
    /validate-only Volume observation proposal input is invalid/,
  );
  assert.equal(trapCalls, 0);
});

test('current conditional proxy is immutable reject-only evidence with exact negative and UNKNOWN limitations', () => {
  assert.equal(Object.isFrozen(VOLUME_CURRENT_CONDITIONAL_PROXY), true);
  assert.equal(validateVolumeEconomics(VOLUME_CURRENT_CONDITIONAL_PROXY).valid, true);
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.evidenceClass, 'CONDITIONAL_PROXY_ONLY');
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.admissibility, 'REJECT_ONLY');
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.applicability, 'UNKNOWN');
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.valuationAsset, 'USD');
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.productionAdmissible, false);
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.proposalEdgeInference, false);
  assert.equal(
    VOLUME_CURRENT_CONDITIONAL_PROXY.conditionalProxy.pointNetPnlUsdPer1000AggregateEntryNotional,
    '-2.962474',
  );
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.sourceNative.state, 'UNDEFINED');
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.sourceNative.netEdgePer1000ValuationNotional, null);
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.costs.accountActualFeeBpsPerSide, null);
  assert.equal(VOLUME_CURRENT_CONDITIONAL_PROXY.capacity.liquidityCapacity, null);
  assert.ok(VOLUME_CURRENT_CONDITIONAL_PROXY.limitations.includes('SOURCE_NATIVE_EDGE_UNDEFINED'));
  assert.ok(VOLUME_CURRENT_CONDITIONAL_PROXY.limitations.includes('ACCOUNT_ACTUAL_FEE_UNKNOWN'));
  assert.ok(VOLUME_CURRENT_CONDITIONAL_PROXY.limitations.includes('CAPACITY_UNKNOWN'));
  assert.ok(VOLUME_CURRENT_CONDITIONAL_PROXY.limitations.includes('NO_PROPOSAL_SPECIFIC_EDGE_INFERENCE'));

  const assessment = assessVolumeEconomics(VOLUME_CURRENT_CONDITIONAL_PROXY);
  assert.equal(assessment.disposition, 'REJECTED');
  assert.equal(assessment.applicability, 'UNKNOWN');
  assert.equal(assessment.valuationAsset, 'USD');
  assert.equal(assessment.sourceNativeGrossEdgePer1000ValuationNotional, null);
  assert.equal(assessment.sourceNativeNetEdgePer1000ValuationNotional, null);
  for (const reason of [
    'ECONOMICS_CONDITIONAL_PROXY_ONLY',
    'ECONOMICS_PROXY_APPLICABILITY_UNKNOWN',
    'ECONOMICS_SOURCE_NATIVE_EDGE_UNDEFINED',
    'ECONOMICS_CONDITIONAL_PROXY_NET_NEGATIVE',
    'ECONOMICS_ACCOUNT_FEE_UNKNOWN',
    'ECONOMICS_CAPACITY_UNKNOWN',
    'ECONOMICS_SOURCE_MAPPING_PARTIAL',
    'ECONOMICS_HISTORICAL_BOOK_COVERAGE_MISSING',
    'ECONOMICS_HISTORICAL_RAW_TAPE_COVERAGE_MISSING',
    'ECONOMICS_RUNTIME_STATE_UNKNOWN_OFFLINE',
    'ECONOMICS_MODEL_UNCERTAINTY_UNBOUNDED',
  ]) {
    assert.ok(assessment.rejectionCodes.includes(reason), reason);
  }
});

test('explicit SYNTHETIC_TEST economics is deterministic validate-only evidence and never production-admissible', () => {
  const first = createSyntheticVolumeEconomics(syntheticEconomicsInput());
  const replay = createSyntheticVolumeEconomics(syntheticEconomicsInput());
  assert.deepEqual(replay, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.sourceNative), true);
  assert.equal(first.evidenceClass, 'SYNTHETIC_TEST');
  assert.equal(first.admissibility, 'VALIDATE_ONLY_TEST');
  assert.equal(first.applicability, 'SYNTHETIC_TEST_ONLY');
  assert.equal(first.valuationAsset, 'USDT');
  assert.equal(first.productionAdmissible, false);
  assert.equal(first.proposalEdgeInference, false);
  assert.equal(first.syntheticFixture.roundTripModeledCostPer1000ValuationNotional, '3');
  assert.equal(first.sourceNative.grossEdgePer1000ValuationNotional, '5');
  assert.equal(first.sourceNative.netEdgePer1000ValuationNotional, '2');
  assert.equal(first.capacity.liquidityCapacity, '5000');
  assert.equal(validateVolumeEconomics(first).valid, true);

  const assessment = assessVolumeEconomics(first);
  assert.equal(assessment.disposition, 'SYNTHETIC_VALIDATE_ONLY');
  assert.equal(assessment.valuationAsset, 'USDT');
  assert.equal(assessment.productionAdmissible, false);
  assert.equal(assessment.proposalEdgeInference, false);
  assert.deepEqual(assessment.rejectionCodes, []);
  assert.equal(assessment.sourceNativeGrossEdgePer1000ValuationNotional, '5');
  assert.equal(assessment.sourceNativeNetEdgePer1000ValuationNotional, '2');
  assert.equal(assessment.accountActualFeeBpsPerSide, '10');
  assert.equal(assessment.liquidityCapacity, '5000');
});

test('economics boundary rejects mutation, negative/zero economics, hostile data, and non-canonical numbers', () => {
  const synthetic = createSyntheticVolumeEconomics(syntheticEconomicsInput());
  const mutated = structuredClone(synthetic);
  mutated.sourceNative.netEdgePer1000ValuationNotional = '2.1';
  assert.deepEqual(validateVolumeEconomics(mutated).reasonCodes, ['ECONOMICS_DIGEST_MISMATCH']);

  const nonPositive = createSyntheticVolumeEconomics(syntheticEconomicsInput({
    grossEdgePer1000ValuationNotional: '3',
  }));
  assert.deepEqual(assessVolumeEconomics(nonPositive).rejectionCodes, [
    'ECONOMICS_NET_EDGE_NOT_POSITIVE',
  ]);

  for (const invalid of [
    { evaluatedAtMs: Number.NaN },
    { evaluatedAtMs: Number.POSITIVE_INFINITY },
    { evaluatedAtMs: -0 },
    { grossEdgePer1000ValuationNotional: '-0' },
    { netEdgePer1000ValuationNotional: '2' },
    { liquidityCapacity: '0' },
  ]) {
    assert.throws(
      () => createSyntheticVolumeEconomics(syntheticEconomicsInput(invalid)),
      /fixture is invalid/,
    );
  }

  let trapCalls = 0;
  const proxy = new Proxy(syntheticEconomicsInput(), {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not invoke proxy trap');
    },
  });
  assert.throws(() => createSyntheticVolumeEconomics(proxy), /fixture is invalid/);
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessor = syntheticEconomicsInput();
  Object.defineProperty(accessor, 'fixtureId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not invoke getter');
    },
  });
  assert.throws(() => createSyntheticVolumeEconomics(accessor), /fixture is invalid/);
  assert.equal(getterCalls, 0);
});

test('default-OFF and current conditional proxy always produce an immutable named REJECTED plan', () => {
  const input = evaluationInput({ economics: VOLUME_CURRENT_CONDITIONAL_PROXY });
  const defaultSlice = createVolumeStrategySlice();
  assert.deepEqual(defaultSlice.controls, {
    enabled: false,
    killSwitchEngaged: true,
  });
  const defaultEvaluation = defaultSlice.evaluate(input);
  assert.equal(defaultEvaluation.disposition, 'REJECTED');
  assert.equal(defaultEvaluation.plan.validation, 'REJECTED');
  assert.equal(defaultEvaluation.plan.executionTerms, null);
  assert.ok(defaultEvaluation.rejectionCodes.includes('STRATEGY_DISABLED'));
  assertNoAuthority(defaultEvaluation);

  const enabled = createVolumeStrategySlice({ enabled: true });
  const first = enabled.evaluate(input);
  const replay = enabled.evaluate(input);
  assert.deepEqual(replay, first);
  assert.equal(first.disposition, 'REJECTED');
  assert.equal(first.economicsApplicability, 'UNKNOWN');
  assert.equal(first.plan.executionTerms, null);
  assert.equal(first.rejectionCodes.includes('STRATEGY_DISABLED'), false);
  for (const reason of [
    'ECONOMICS_REJECTED',
    'ECONOMICS_VALUATION_ASSET_MISMATCH',
    'ECONOMICS_CONDITIONAL_PROXY_ONLY',
    'ECONOMICS_PROXY_APPLICABILITY_UNKNOWN',
    'ECONOMICS_SOURCE_NATIVE_EDGE_UNDEFINED',
    'ECONOMICS_CONDITIONAL_PROXY_NET_NEGATIVE',
    'ECONOMICS_ACCOUNT_FEE_UNKNOWN',
    'ECONOMICS_CAPACITY_UNKNOWN',
  ]) {
    assert.ok(first.rejectionCodes.includes(reason), reason);
  }
  assert.equal(validateVolumeStrategyEvaluation(first), true);
  assert.equal(validateVolumeValidateOnlyPlan(first.plan), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.plan), true);
  assert.equal(Object.isFrozen(first.rejectionCodes), true);
  assertNoAuthority(first);
});

test('explicit SYNTHETIC_TEST fixture produces deterministic VALIDATED_RECORD_ONLY terms with no send surface', () => {
  const input = evaluationInput();
  const first = evaluateVolumeStrategy(input, {
    enabled: true,
    killSwitchEngaged: true,
  });
  const replay = evaluateVolumeStrategy(input, {
    enabled: true,
    killSwitchEngaged: true,
  });

  assert.deepEqual(replay, first);
  assert.equal(first.disposition, 'VALIDATED_RECORD_ONLY');
  assert.equal(first.economicsApplicability, 'SYNTHETIC_TEST_ONLY');
  assert.deepEqual(first.rejectionCodes, []);
  assert.equal(first.plan.validation, 'VALIDATED_RECORD_ONLY');
  assert.ok(first.plan.executionTerms);
  assert.deepEqual(first.plan.executionTerms, {
    termsId: first.plan.executionTerms.termsId,
    symbol: 'BTCUSDT',
    direction: 'long',
    entrySide: 'BUY',
    capacitySide: 'BUY',
    capacityBasis: 'SYNCHRONIZED_CUMULATIVE',
    price: '100010',
    baseQuantity: '0.04',
    quoteAsset: 'USDT',
    quoteNotional: '4000.25',
    levelCount: 2,
    economicsValuationAsset: 'USDT',
    liquidityCapacity: '5000',
    observationDigest: input.observation.observationDigest,
    economicsDigest: input.economics.economicsDigest,
  });
  assert.equal(first.observationDigest, input.observation.observationDigest);
  assert.equal(first.economicsDigest, input.economics.economicsDigest);
  assert.equal(first.evaluatedAtMs, input.observation.evaluatedAtMs);
  assert.match(first.evaluationId, /^vevaluation_[a-f0-9]{64}$/);
  assert.match(first.plan.planId, /^vplan_[a-f0-9]{64}$/);
  assert.match(first.plan.executionTerms.termsId, /^vterms_[a-f0-9]{64}$/);
  assert.equal(validateVolumeStrategyEvaluation(first), true);
  assert.equal(validateVolumeValidateOnlyPlan(first.plan), true);
  assert.deepEqual(replayVolumeStrategyEvaluation(first), {
    status: 'EXACT',
    evaluation: first,
    reasonCodes: [],
  });
  assert.equal(Object.isFrozen(first.plan.executionTerms), true);
  assertNoAuthority(first);
});

test('slice rejects source, proposal, economics, capacity, and hostile-tamper boundaries by name', () => {
  const enabled = { enabled: true, killSwitchEngaged: true };
  for (const [continuity, reason] of [
    ['GAP', 'VOLUME_SOURCE_CONTINUITY_GAP'],
    ['UNKNOWN', 'VOLUME_SOURCE_CONTINUITY_UNKNOWN'],
    ['RECONNECTING', 'VOLUME_SOURCE_RECONNECTING'],
  ]) {
    const observation = buildVolumeStrategyObservation(observationInput({
      source: { continuity },
    }));
    const evaluation = evaluateVolumeStrategy(evaluationInput({ observation }), enabled);
    assert.equal(evaluation.disposition, 'REJECTED');
    assert.ok(evaluation.rejectionCodes.includes(reason));
    assert.ok(evaluation.rejectionCodes.includes('OBSERVATION_SOURCE_REJECTED'));
    assert.equal(evaluation.plan.executionTerms, null);
    assertNoAuthority(evaluation);
  }

  const topOnly = buildVolumeStrategyObservation(observationInput({
    book: {
      scope: 'TOP_OF_BOOK',
      depth: null,
      numericFidelity: 'NORMALIZED_FROM_PARSED_NUMBER',
    },
  }));
  const capacityRejected = evaluateVolumeStrategy(
    evaluationInput({ observation: topOnly }),
    enabled,
  );
  assert.ok(capacityRejected.rejectionCodes.includes(
    'VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY',
  ));
  assert.ok(capacityRejected.rejectionCodes.includes(
    'VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED',
  ));
  assert.equal(capacityRejected.plan.executionTerms, null);

  const nonUsdtProposal = proposalRiskCut({ symbol: 'ETHBTC' });
  const valuationMismatch = evaluateVolumeStrategy(
    evaluationInput({ proposal: nonUsdtProposal }),
    enabled,
  );
  assert.equal(valuationMismatch.disposition, 'REJECTED');
  assert.ok(valuationMismatch.rejectionCodes.includes(
    'ECONOMICS_VALUATION_ASSET_MISMATCH',
  ));
  assert.equal(valuationMismatch.plan.executionTerms, null);
  assertNoAuthority(valuationMismatch);

  const mismatchedProposal = proposalRiskCut({
    proposalDigest: `vprop_${'d'.repeat(64)}`,
  });
  const mismatch = evaluateVolumeStrategy({
    proposal: mismatchedProposal,
    observation: evaluationInput().observation,
    economics: createSyntheticVolumeEconomics(syntheticEconomicsInput()),
  }, enabled);
  assert.equal(mismatch.disposition, 'REJECTED');
  assert.ok(mismatch.rejectionCodes.includes('OBSERVATION_PROPOSAL_MISMATCH'));

  const nonPositive = createSyntheticVolumeEconomics(syntheticEconomicsInput({
    grossEdgePer1000ValuationNotional: '3',
  }));
  const economicsRejected = evaluateVolumeStrategy(
    evaluationInput({ economics: nonPositive }),
    enabled,
  );
  assert.equal(economicsRejected.disposition, 'REJECTED');
  assert.ok(economicsRejected.rejectionCodes.includes('ECONOMICS_REJECTED'));
  assert.ok(economicsRejected.rejectionCodes.includes('ECONOMICS_NET_EDGE_NOT_POSITIVE'));
  assert.equal(economicsRejected.plan.executionTerms, null);

  const valid = evaluateVolumeStrategy(evaluationInput(), enabled);
  const tamperedPlan = structuredClone(valid);
  tamperedPlan.plan.submitAuthority = 'LIVE';
  assert.equal(validateVolumeValidateOnlyPlan(tamperedPlan.plan), false);
  assert.equal(validateVolumeStrategyEvaluation(tamperedPlan), false);
  assert.equal(replayVolumeStrategyEvaluation(tamperedPlan).status, 'INVALID');

  const identityTamper = structuredClone(valid);
  identityTamper.evaluationId = `vevaluation_${'f'.repeat(64)}`;
  identityTamper.plan.evaluationId = identityTamper.evaluationId;
  assert.equal(replayVolumeStrategyEvaluation(identityTamper).status, 'DIVERGED');

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
    const poisoned = proposalRiskCut({ updatedTs: invalid });
    const rejected = evaluateVolumeStrategy(
      evaluationInput({ proposal: poisoned }),
      enabled,
    );
    assert.equal(rejected.disposition, 'REJECTED');
    assert.ok(rejected.rejectionCodes.includes('PROPOSAL_INVALID'));
    assertNoAuthority(rejected);
  }

  let trapCalls = 0;
  const hostile = new Proxy(evaluationInput(), {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not invoke proxy trap');
    },
  });
  const hostileRejected = evaluateVolumeStrategy(hostile, enabled);
  assert.equal(hostileRejected.disposition, 'REJECTED');
  assert.equal(trapCalls, 0);
  assertNoAuthority(hostileRejected);
});

test('VolumeRuntime direct public cut bypasses default empty engine allowlist only into one durable no-authority checkpoint', () => {
  const ledger = new FakeVolumeStrategyLedger();
  const runtimeConfig = structuredClone(DEFAULTS);
  let runtimeNow = NOW_MS;
  const runtime = new VolumeRuntime(
    ledger,
    () => runtimeConfig,
    () => [],
    null,
    () => runtimeNow,
  );
  const installFreshCut = (target, {
    generation,
    revision,
    aggregateTradeId,
    firstTradeId,
    lastTradeId,
    tradeReceivedAtMs,
    bookReceivedAtMs = null,
  }) => {
    const trade = Object.freeze({
      e: 'aggTrade',
      E: tradeReceivedAtMs - 2,
      s: 'BTCUSDT',
      a: aggregateTradeId,
      p: '100000',
      q: '0.01',
      f: firstTradeId,
      l: lastTradeId,
      T: tradeReceivedAtMs - 3,
      m: false,
    });
    target.generation = generation;
    target.strategyTradeCuts.set('BTCUSDT', Object.freeze({
      generation,
      revision,
      receivedAtMs: tradeReceivedAtMs,
      continuity: 'CONTIGUOUS',
      raw: trade,
    }));
    target.lastAggTradeId.set('BTCUSDT', aggregateTradeId);
    target.lastRawTradeId.set('BTCUSDT', lastTradeId);
    let book = null;
    if (bookReceivedAtMs === null) {
      target.strategyBookCuts.delete('BTCUSDT');
    } else {
      book = Object.freeze({
        symbol: 'BTCUSDT',
        bidPrice: '99990',
        askPrice: '100000',
        bidQuantity: '0.02',
        askQuantity: '0.015',
        receivedAtMs: bookReceivedAtMs,
      });
      target.strategyBookCuts.set('BTCUSDT', book);
    }
    return Object.freeze({ trade, book });
  };
  assert.equal(runtimeConfig.killSwitch, true);
  assert.deepEqual(runtimeConfig.allowedSymbols, []);
  runtime.applyDynamicConfig();
  assert.equal(runtime.engine.symbolAllowedByPolicy('BTCUSDT'), false);
  assert.deepEqual(runtime.engine.decisions(2_000), []);

  const tradeReceivedAtMs = NOW_MS - 1_000;
  const initialCut = installFreshCut(runtime, {
    generation: 1,
    revision: 1,
    aggregateTradeId: 100,
    firstTradeId: 200,
    lastTradeId: 202,
    tradeReceivedAtMs,
  });
  const rawTrade = initialCut.trade;

  runtime.evaluateStrategySlice();
  assert.equal(ledger.casCalls, 0);
  assert.equal(ledger.events.length, 0);
  assert.equal(runtime.strategySliceSnapshot().lifecycle.commitAttempts, 0);

  runtimeNow = NOW_MS + 1_000;
  const bookCut = installFreshCut(runtime, {
    generation: 1,
    revision: 1,
    aggregateTradeId: 100,
    firstTradeId: 200,
    lastTradeId: 202,
    tradeReceivedAtMs,
    bookReceivedAtMs: runtimeNow,
  }).book;
  runtime.evaluateStrategySlice();

  assert.equal(ledger.casCalls, 1);
  assert.equal(ledger.events.length, 2);
  assert.deepEqual(ledger.events.map((event) => event.kind), [
    VOLUME_STRATEGY_EVALUATED_EVENT_KIND,
    VOLUME_STRATEGY_RECONCILED_EVENT_KIND,
  ]);
  const firstSnapshot = runtime.strategySliceSnapshot();
  assert.deepEqual(firstSnapshot.controls, {
    enabled: false,
    killSwitchEngaged: true,
  });
  assert.equal(firstSnapshot.latestEvaluation?.disposition, 'REJECTED');
  assert.ok(firstSnapshot.latestEvaluation?.rejectionCodes.includes('STRATEGY_DISABLED'));
  assert.ok(firstSnapshot.latestEvaluation?.rejectionCodes.includes(
    'VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED',
  ));
  assert.ok(firstSnapshot.latestEvaluation?.rejectionCodes.includes(
    'VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY',
  ));
  assertNoAuthority(firstSnapshot.latestEvaluation);
  const expectedDecision = Object.freeze({
    symbol: 'BTCUSDT',
    ts: tradeReceivedAtMs,
    strategy: 'volume_spike',
    kind: 'reject',
    rejectCode: 'kill_switch_on',
    humanReason: 'public aggregate trade observed under default-OFF validate-only posture',
    correlationId: 'vroc:1:1:BTCUSDT:100',
    evidence: Object.freeze({
      direction: 'long',
      sourceId: VOLUME_PUBLIC_SOURCE_ID,
      authentication: 'NONE',
      publicOnly: true,
      transport: 'SPOT_AGG_TRADE',
      generation: 1,
      revision: 1,
      aggregateTradeId: 100,
      firstTradeId: 200,
      lastTradeId: 202,
      eventTimeMs: rawTrade.E,
      tradeTimeMs: rawTrade.T,
      receivedAtMs: tradeReceivedAtMs,
      continuity: 'CONTIGUOUS',
      buyerIsMaker: false,
    }),
  });
  const expectedProposal = buildVolumeValidateOnlyObservationProposal({
    decision: expectedDecision,
    configurationRevision: deriveVolumeConfigVersion(runtime.engine.cfg),
    expiresAtMs: tradeReceivedAtMs + runtime.engine.cfg.proposalTtlMs,
  });
  assert.deepEqual(firstSnapshot.latestEvaluation?.proposal, expectedProposal);
  assert.equal(expectedProposal.proposalKind, 'VOLUME_VALIDATE_ONLY_OBSERVATION');
  assert.match(expectedProposal.evidenceBindingDigest, /^vdecision_[0-9a-f]{64}$/);
  const expectedObservation = buildVolumeStrategyObservation({
    proposal: {
      proposalId: expectedProposal.proposalId,
      proposalRevision: expectedProposal.proposalRevision,
      proposalDigest: expectedProposal.proposalDigest,
      configurationRevision: expectedProposal.configurationRevision,
      correlationId: expectedProposal.correlationId,
      symbol: expectedProposal.symbol,
      direction: expectedProposal.direction,
      expiresAtMs: expectedProposal.expiresAtMs,
    },
    source: {
      sourceId: VOLUME_PUBLIC_SOURCE_ID,
      restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
      websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
      authentication: 'NONE',
      timeUnit: 'MILLISECOND',
      generation: 1,
      revision: 1,
      continuity: 'CONTIGUOUS',
    },
    aggregateTrade: {
      symbol: 'BTCUSDT',
      aggregateTradeId: 100,
      firstTradeId: 200,
      lastTradeId: 202,
      eventTimeMs: rawTrade.E,
      tradeTimeMs: rawTrade.T,
      receivedAtMs: tradeReceivedAtMs,
    },
    book: {
      symbol: bookCut.symbol,
      bidPrice: bookCut.bidPrice,
      askPrice: bookCut.askPrice,
      bidQuantity: bookCut.bidQuantity,
      askQuantity: bookCut.askQuantity,
      sourceTimeMs: null,
      receivedAtMs: bookCut.receivedAtMs,
      freshnessBasis: 'RECEIVE_TIME',
      numericFidelity: 'NORMALIZED_FROM_PARSED_NUMBER',
      scope: 'TOP_OF_BOOK',
      depth: null,
    },
    evaluatedAtMs: runtimeNow,
  });
  assert.equal(
    firstSnapshot.latestEvaluation?.observationDigest,
    expectedObservation.observationDigest,
  );
  assert.equal(expectedObservation.source.sourceId, VOLUME_PUBLIC_SOURCE_ID);
  assert.equal(expectedObservation.source.authentication, 'NONE');
  assert.equal(firstSnapshot.lifecycle.commitAttempts, 1);
  assert.equal(firstSnapshot.lifecycle.durablePublications, 1);
  assert.equal(firstSnapshot.lifecycle.persistence.status, 'AVAILABLE');
  assert.equal(firstSnapshot.lifecycle.directObservationMinIntervalMs, 3_600_000);
  const firstNextDirectObservationAtMs = runtimeNow + 3_600_000;
  assert.equal(
    firstSnapshot.lifecycle.nextDirectObservationAtMs,
    firstNextDirectObservationAtMs,
  );
  assert.deepEqual(runtime.engine.decisions(2_000), []);

  runtime.evaluateStrategySlice();
  for (let index = 2; index <= 13; index += 1) {
    runtimeNow += 1_000;
    installFreshCut(runtime, {
      generation: index,
      revision: index,
      aggregateTradeId: 100 + index,
      firstTradeId: 200 + (index * 2),
      lastTradeId: 201 + (index * 2),
      tradeReceivedAtMs: runtimeNow,
      bookReceivedAtMs: runtimeNow,
    });
    runtime.evaluateStrategySlice();
  }
  assert.equal(ledger.casCalls, 1);
  assert.equal(ledger.events.length, 2);
  assert.equal(runtime.strategySliceSnapshot().lifecycle.commitAttempts, 1);
  assert.equal(
    runtime.strategySliceSnapshot().lifecycle.nextDirectObservationAtMs,
    firstNextDirectObservationAtMs,
  );

  runtimeNow = firstNextDirectObservationAtMs;
  installFreshCut(runtime, {
    generation: 100,
    revision: 100,
    aggregateTradeId: 1_000,
    firstTradeId: 2_000,
    lastTradeId: 2_002,
    tradeReceivedAtMs: runtimeNow,
    bookReceivedAtMs: runtimeNow,
  });
  runtime.evaluateStrategySlice();
  assert.equal(ledger.casCalls, 2);
  assert.equal(ledger.events.length, 4);
  const boundarySnapshot = runtime.strategySliceSnapshot();
  assert.equal(boundarySnapshot.lifecycle.commitAttempts, 2);
  assert.equal(boundarySnapshot.lifecycle.durablePublications, 2);
  assert.equal(
    boundarySnapshot.lifecycle.nextDirectObservationAtMs,
    runtimeNow + 3_600_000,
  );
  assert.equal(
    boundarySnapshot.latestEvaluation?.proposal.correlationId,
    'vroc:100:100:BTCUSDT:1000',
  );

  runtime.evaluateStrategySlice();
  runtimeNow += 1_000;
  runtime.strategyBookCuts.set('BTCUSDT', Object.freeze({
    ...runtime.strategyBookCuts.get('BTCUSDT'),
    askQuantity: '0.02',
    receivedAtMs: runtimeNow,
  }));
  runtime.evaluateStrategySlice();
  assert.equal(ledger.casCalls, 2);
  assert.equal(ledger.events.length, 4);
  assert.equal(runtime.strategySliceSnapshot().lifecycle.commitAttempts, 2);

  const restoredRuntime = new VolumeRuntime(
    ledger,
    () => runtimeConfig,
    () => [],
    null,
    () => runtimeNow,
  );
  assert.doesNotThrow(() => restoredRuntime.restoreStrategySlice());
  const restoredSnapshot = restoredRuntime.strategySliceSnapshot();
  assert.equal(restoredSnapshot.lifecycle.persistence.status, 'AVAILABLE');
  assert.equal(
    restoredSnapshot.lifecycle.nextDirectObservationAtMs,
    boundarySnapshot.lifecycle.nextDirectObservationAtMs,
  );

  ledger.value = '{not-json';
  assert.doesNotThrow(() => runtime.restoreStrategySlice());
  const corruptSnapshot = runtime.strategySliceSnapshot();
  assert.equal(corruptSnapshot.latestEvaluation, null);
  assert.equal(corruptSnapshot.lifecycle.persistence.status, 'BLOCKED');
  assert.equal(corruptSnapshot.lifecycle.persistence.reasonCode, 'VOLUME_STRATEGY_LEDGER_CORRUPT');
  assert.doesNotThrow(() => runtime.evaluateStrategySlice());
  assert.equal(ledger.casCalls, 2);

  const unavailableLedger = new FakeVolumeStrategyLedger();
  unavailableLedger.mode = 'READ_UNAVAILABLE';
  const unavailableRuntime = new VolumeRuntime(
    unavailableLedger,
    () => ({}),
    () => [],
    null,
    () => runtimeNow,
  );
  assert.doesNotThrow(() => unavailableRuntime.restoreStrategySlice());
  const unavailableSnapshot = unavailableRuntime.strategySliceSnapshot();
  assert.equal(unavailableSnapshot.latestEvaluation, null);
  assert.equal(unavailableSnapshot.lifecycle.persistence.status, 'BLOCKED');
  assert.equal(
    unavailableSnapshot.lifecycle.persistence.reasonCode,
    'VOLUME_STRATEGY_LEDGER_UNAVAILABLE',
  );
  assert.equal(unavailableLedger.casCalls, 0);

  const failedLedger = new FakeVolumeStrategyLedger();
  failedLedger.mode = 'DEADLINE_EXCEEDED';
  let failedNow = NOW_MS;
  const failedRuntime = new VolumeRuntime(
    failedLedger,
    () => runtimeConfig,
    () => [],
    null,
    () => failedNow,
  );
  installFreshCut(failedRuntime, {
    generation: 1,
    revision: 1,
    aggregateTradeId: 500,
    firstTradeId: 700,
    lastTradeId: 702,
    tradeReceivedAtMs: failedNow,
    bookReceivedAtMs: failedNow,
  });
  assert.throws(
    () => failedRuntime.evaluateStrategySlice(),
    /volume strategy ledger commit failed: DEADLINE_EXCEEDED/,
  );
  assert.equal(failedLedger.casCalls, 1);
  assert.equal(failedLedger.events.length, 0);
  const failedSnapshot = failedRuntime.strategySliceSnapshot();
  assert.equal(failedSnapshot.latestEvaluation, null);
  assert.equal(failedSnapshot.lifecycle.persistence.status, 'BLOCKED');
  assert.equal(failedSnapshot.lifecycle.commitAttempts, 1);
  failedNow += 1_000;
  installFreshCut(failedRuntime, {
    generation: 2,
    revision: 2,
    aggregateTradeId: 501,
    firstTradeId: 703,
    lastTradeId: 705,
    tradeReceivedAtMs: failedNow,
    bookReceivedAtMs: failedNow,
  });
  assert.doesNotThrow(() => failedRuntime.evaluateStrategySlice());
  assert.equal(failedLedger.casCalls, 1);
  assert.equal(failedRuntime.strategySliceSnapshot().lifecycle.commitAttempts, 1);
});

test('Ledger CAS first commit is atomic, receipt-bound, locally reconciled, replay-safe, and restart-restorable', () => {
  const evaluation = validatedEvaluation();
  const ledger = new FakeVolumeStrategyLedger();
  const adapter = new VolumeStrategyLedgerAdapter(ledger);
  const empty = adapter.load();
  assert.equal(empty.status, 'EMPTY');

  const committed = adapter.commit({
    expected: empty,
    evaluation,
    commitBeforeMs: NOW_MS + 1_000,
  });
  assert.equal(committed.disposition, 'COMMITTED_NEW');
  assert.deepEqual(committed.eventIds, [1, 2]);
  assert.equal(committed.checkpoint.revision, 1);
  assert.equal(committed.checkpoint.lastEvaluation.evaluationId, evaluation.evaluationId);
  assert.equal(committed.checkpoint.lastPlan.planId, evaluation.plan.planId);
  assert.equal(committed.checkpoint.localReconciliation.scope, 'LOCAL_LEDGER_ONLY');
  assert.equal(committed.checkpoint.localReconciliation.status, 'EXACT');
  assert.equal(committed.checkpoint.localReconciliation.executionAuthority, 'NONE');
  assert.equal(committed.checkpoint.localReconciliation.exchangeReconciliation, false);
  assert.equal(committed.checkpoint.localReconciliation.flatnessProven, false);
  assert.equal(validateVolumeStrategyLocalReconciliation(
    committed.checkpoint.localReconciliation,
  ), true);
  assert.equal(Object.isFrozen(committed.checkpoint), true);

  assert.deepEqual(ledger.events.map(({ kind }) => kind), [
    VOLUME_STRATEGY_EVALUATED_EVENT_KIND,
    VOLUME_STRATEGY_RECONCILED_EVENT_KIND,
  ]);
  assert.equal(ledger.events[0].createdAt, evaluation.evaluatedAtMs);
  assert.equal(ledger.events[1].createdAt, evaluation.evaluatedAtMs);
  assert.equal(ledger.events[0].ts, ledger.events[1].ts);
  assert.equal(ledger.events[0].data.evaluationId, evaluation.evaluationId);
  assert.equal(ledger.events[0].data.planId, evaluation.plan.planId);
  assert.equal(ledger.events[0].data.executionAuthority, 'NONE');
  assert.equal(ledger.events[0].data.sendEligible, false);
  assert.equal(ledger.events[0].data.sends, 0);
  assert.equal(ledger.events[0].data.sideEffects, 0);
  assert.equal(ledger.events[1].data.status, 'EXACT');
  assert.equal(ledger.events[1].data.exchangeReconciliation, false);

  const serialized = encodeVolumeStrategyCheckpoint(committed.checkpoint);
  assert.equal(serialized, ledger.value);
  assert.deepEqual(decodeVolumeStrategyCheckpoint(serialized), committed.checkpoint);

  const replay = adapter.commit({
    expected: adapter.load(),
    evaluation,
  });
  assert.equal(replay.disposition, 'ALREADY_COMMITTED');
  assert.deepEqual(replay.eventIds, []);
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.casCalls, 1);

  const restarted = createVolumeStrategyLedgerCoordinator(ledger);
  const restored = restarted.restore();
  assert.equal(restored.status, 'RESTORED');
  assert.equal(restored.checkpoint.checksum, committed.checkpoint.checksum);
  assert.equal(restarted.snapshot().status, 'AVAILABLE');
  assert.equal(
    restarted.snapshot().checkpoint.lastEvaluation.evaluationId,
    evaluation.evaluationId,
  );
});

test('Ledger rejects same-proposal forks and regressions before CAS, and resolves exact CAS winners', () => {
  const first = validatedEvaluation();
  const fork = validatedEvaluation({
    economicsOverrides: { fixtureId: 'volume-strategy-slice-positive-fork' },
  });
  assert.equal(fork.proposal.proposalId, first.proposal.proposalId);
  assert.equal(fork.proposal.proposalRevision, first.proposal.proposalRevision);
  assert.notEqual(fork.evaluationId, first.evaluationId);

  const ledger = new FakeVolumeStrategyLedger();
  const adapter = new VolumeStrategyLedgerAdapter(ledger);
  assert.equal(adapter.commit({ expected: adapter.load(), evaluation: first }).disposition, 'COMMITTED_NEW');
  const forked = adapter.commit({ expected: adapter.load(), evaluation: fork });
  assert.equal(forked.disposition, 'IDENTITY_CONFLICT');
  assert.equal(forked.reasonCode, 'VOLUME_STRATEGY_LEDGER_IDENTITY_CONFLICT');
  assert.equal(ledger.casCalls, 1);
  assert.equal(ledger.events.length, 2);

  const lowerRevision = validatedEvaluation({
    proposalOverrides: {
      proposalRevision: 6,
      proposalDigest: `vprop_${'6'.repeat(64)}`,
    },
  });
  const regressed = adapter.commit({
    expected: adapter.load(),
    evaluation: lowerRevision,
  });
  assert.equal(regressed.disposition, 'VERSION_CONFLICT');
  assert.equal(regressed.reasonCode, 'VOLUME_STRATEGY_LEDGER_TRANSITION_REGRESSION');
  assert.equal(ledger.casCalls, 1);

  const winnerLedger = new FakeVolumeStrategyLedger();
  winnerLedger.mode = 'WINNER_SAME';
  const winnerAdapter = new VolumeStrategyLedgerAdapter(winnerLedger);
  const winner = winnerAdapter.commit({
    expected: winnerAdapter.load(),
    evaluation: first,
  });
  assert.equal(winner.disposition, 'ALREADY_COMMITTED');
  assert.deepEqual(winner.eventIds, []);
  assert.equal(winner.checkpoint.lastEvaluation.evaluationId, first.evaluationId);
});

test('Ledger classifies stale CAS, deadline, corruption, unavailability, invalid receipt, and post-commit readback', () => {
  const evaluation = validatedEvaluation();

  const staleLedger = new FakeVolumeStrategyLedger();
  const staleAdapter = new VolumeStrategyLedgerAdapter(staleLedger);
  const staleExpected = staleAdapter.load();
  const other = validatedEvaluation({
    proposalOverrides: {
      proposalId: 'volume-proposal-other',
      correlationId: 'volume-correlation-other',
      proposalDigest: `vprop_${'e'.repeat(64)}`,
    },
  });
  assert.equal(
    staleAdapter.commit({ expected: staleExpected, evaluation: other }).disposition,
    'COMMITTED_NEW',
  );
  const staleResult = staleAdapter.commit({
    expected: staleExpected,
    evaluation,
  });
  assert.equal(staleResult.disposition, 'VERSION_CONFLICT');
  assert.equal(staleResult.reasonCode, 'VOLUME_STRATEGY_LEDGER_VERSION_CONFLICT');

  const deadlineLedger = new FakeVolumeStrategyLedger();
  deadlineLedger.mode = 'DEADLINE_EXCEEDED';
  const deadlineAdapter = new VolumeStrategyLedgerAdapter(deadlineLedger);
  const deadline = deadlineAdapter.commit({
    expected: deadlineAdapter.load(),
    evaluation,
    commitBeforeMs: NOW_MS,
  });
  assert.equal(deadline.disposition, 'DEADLINE_EXCEEDED');
  assert.equal(deadline.reasonCode, 'VOLUME_STRATEGY_LEDGER_DEADLINE_EXCEEDED');

  const corruptLedger = new FakeVolumeStrategyLedger();
  corruptLedger.value = '{"corrupt":true}';
  const corruptCoordinator = createVolumeStrategyLedgerCoordinator(corruptLedger);
  assert.equal(corruptCoordinator.restore().status, 'CORRUPT');
  assert.deepEqual(corruptCoordinator.snapshot(), {
    status: 'BLOCKED',
    checkpoint: null,
    reasonCode: 'VOLUME_STRATEGY_LEDGER_CORRUPT',
  });

  const unavailableLedger = new FakeVolumeStrategyLedger();
  unavailableLedger.mode = 'READ_UNAVAILABLE';
  const unavailableCoordinator = createVolumeStrategyLedgerCoordinator(unavailableLedger);
  assert.equal(unavailableCoordinator.restore().status, 'UNAVAILABLE');
  assert.deepEqual(unavailableCoordinator.snapshot(), {
    status: 'BLOCKED',
    checkpoint: null,
    reasonCode: 'VOLUME_STRATEGY_LEDGER_UNAVAILABLE',
  });

  const badReceiptLedger = new FakeVolumeStrategyLedger();
  badReceiptLedger.mode = 'BAD_RECEIPT';
  const badReceiptAdapter = new VolumeStrategyLedgerAdapter(badReceiptLedger);
  const badReceipt = badReceiptAdapter.commit({
    expected: badReceiptAdapter.load(),
    evaluation,
  });
  assert.equal(badReceipt.disposition, 'COMMIT_READBACK_INVALID');
  assert.equal(
    badReceipt.reasonCode,
    'VOLUME_STRATEGY_LEDGER_EVENT_READBACK_INVALID',
  );

  const lostResponseLedger = new FakeVolumeStrategyLedger();
  lostResponseLedger.mode = 'THROW_AFTER_COMMIT';
  const lostResponseAdapter = new VolumeStrategyLedgerAdapter(lostResponseLedger);
  const recovered = lostResponseAdapter.commit({
    expected: lostResponseAdapter.load(),
    evaluation,
  });
  assert.equal(recovered.disposition, 'ALREADY_COMMITTED');
  assert.equal(recovered.checkpoint.lastEvaluation.evaluationId, evaluation.evaluationId);
  assert.equal(lostResponseLedger.events.length, 2);
});

test('LOCAL_LEDGER_ONLY reconciliation distinguishes EXACT, STALE, UNAVAILABLE, AMBIGUOUS, and DIVERGED without authority', () => {
  const current = validatedEvaluation({
    proposalOverrides: {
      proposalRevision: 8,
      proposalDigest: `vprop_${'8'.repeat(64)}`,
    },
  });
  const prior = validatedEvaluation({
    proposalOverrides: {
      proposalRevision: 7,
      proposalDigest: `vprop_${'7'.repeat(64)}`,
    },
  });

  const divergedValue = validatedEvaluation({
    proposalOverrides: {
      proposalId: 'volume-proposal-0002',
      correlationId: 'volume-correlation-0002',
      proposalRevision: 8,
      proposalDigest: `vprop_${'9'.repeat(64)}`,
    },
  });
  const cases = [
    ['EXACT', reconcileVolumeStrategyLocal(current, current)],
    ['STALE', reconcileVolumeStrategyLocal(current, prior)],
    ['UNAVAILABLE', reconcileVolumeStrategyLocal(current, null)],
    ['AMBIGUOUS', reconcileVolumeStrategyLocal(current, {})],
    ['DIVERGED', reconcileVolumeStrategyLocal(current, divergedValue)],
  ];

  for (const [status, reconciliation] of cases) {
    assert.equal(reconciliation.status, status);
    assert.equal(reconciliation.scope, 'LOCAL_LEDGER_ONLY');
    assert.equal(reconciliation.executionAuthority, 'NONE');
    assert.equal(reconciliation.exchangeReconciliation, false);
    assert.equal(reconciliation.flatnessProven, false);
    assert.equal(validateVolumeStrategyLocalReconciliation(reconciliation), true);
    assert.equal(Object.isFrozen(reconciliation), true);
  }
});
