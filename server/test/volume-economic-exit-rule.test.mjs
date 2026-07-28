#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
  VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS,
  VOLUME_ECONOMIC_EXIT_MODE,
  VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION,
  VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION,
  VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE,
  VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION,
  buildSyntheticVolumeEconomicExitPolicy,
  evaluateVolumeEconomicExit,
  validateVolumeEconomicExitDecision,
  validateVolumeEconomicExitPolicy,
  validateVolumeEconomicExitState,
  validateVolumeForwardExitSample,
} from '../dist/engine/volume/strategyEconomicExit.js';
import {
  canonicalJson,
  stableHash128Hex,
} from '../dist/foundation/contracts/index.js';
import {
  VOLUME_PUBLIC_REST_BASE_URL,
  VOLUME_PUBLIC_SOURCE_ID,
  VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
  buildVolumeStrategyObservation,
} from '../dist/engine/volume/strategyObservation.js';
import {
  createSyntheticVolumeEconomics,
} from '../dist/engine/volume/strategyEconomics.js';
import {
  evaluateVolumeStrategy,
  validateVolumeStrategyEvaluation,
} from '../dist/engine/volume/strategySlice.js';

const NOW_MS = 1_900_000_000_000;
const EXPIRY_MS = NOW_MS + 300_000;

function proposal(direction = 'long', overrides = {}) {
  return {
    proposalId: `volume-exit-proposal-${direction}`,
    proposalRevision: 7,
    proposalDigest: `vprop_${direction === 'long' ? 'a' : 'b'.repeat(64)}`,
    configurationRevision: `volume-config:${'c'.repeat(24)}`,
    correlationId: `volume-exit-correlation-${direction}`,
    symbol: 'BTCUSDT',
    direction,
    updatedTs: NOW_MS - 10,
    featureObservedAtMs: NOW_MS - 20,
    expiresAtMs: EXPIRY_MS,
    ...overrides,
  };
}

function normalizedProposal(direction = 'long', overrides = {}) {
  const value = proposal(direction, overrides);
  if (!/^vprop_[a-f0-9]{64}$/.test(value.proposalDigest)) {
    value.proposalDigest = `vprop_${direction === 'long' ? 'a'.repeat(64) : 'b'.repeat(64)}`;
  }
  return value;
}

function bookFor({
  evaluatedAtMs,
  direction = 'long',
  bidPrices = ['99990', '99980'],
  askPrices = ['100000', '100010'],
  quantities = ['0.02', '0.02'],
  sourceRevision = 11,
  continuity = 'CONTIGUOUS',
  numericFidelity = 'SOURCE_TEXT_EXACT',
  scope = 'SYNCHRONIZED_DEPTH',
}) {
  const proposalValue = normalizedProposal(direction);
  const depth = scope === 'SYNCHRONIZED_DEPTH'
    ? {
        synchronization: {
          sourceGeneration: 3,
          sourceRevision,
          snapshotLastUpdateId: 500 + sourceRevision,
          updateRanges: [{
            firstUpdateId: 501 + sourceRevision,
            finalUpdateId: 501 + sourceRevision,
            eventTimeMs: evaluatedAtMs - 2,
          }],
        },
        bids: bidPrices.map((price, index) => ({
          price,
          quantity: quantities[index],
        })),
        asks: askPrices.map((price, index) => ({
          price,
          quantity: quantities[index],
        })),
      }
    : null;
  return buildVolumeStrategyObservation({
    proposal: {
      proposalId: proposalValue.proposalId,
      proposalRevision: proposalValue.proposalRevision,
      proposalDigest: proposalValue.proposalDigest,
      configurationRevision: proposalValue.configurationRevision,
      correlationId: proposalValue.correlationId,
      symbol: proposalValue.symbol,
      direction: proposalValue.direction,
      expiresAtMs: proposalValue.expiresAtMs,
    },
    source: {
      sourceId: VOLUME_PUBLIC_SOURCE_ID,
      restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
      websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
      authentication: 'NONE',
      timeUnit: 'MILLISECOND',
      generation: 3,
      revision: sourceRevision,
      continuity,
    },
    aggregateTrade: {
      symbol: proposalValue.symbol,
      aggregateTradeId: 100 + sourceRevision,
      firstTradeId: 200 + sourceRevision,
      lastTradeId: 202 + sourceRevision,
      eventTimeMs: evaluatedAtMs - 4,
      tradeTimeMs: evaluatedAtMs - 5,
      receivedAtMs: evaluatedAtMs - 3,
    },
    book: {
      symbol: proposalValue.symbol,
      bidPrice: bidPrices[0],
      askPrice: askPrices[0],
      bidQuantity: quantities[0],
      askQuantity: quantities[0],
      sourceTimeMs: null,
      receivedAtMs: evaluatedAtMs - 2,
      freshnessBasis: 'RECEIVE_TIME',
      numericFidelity,
      scope,
      depth,
    },
    evaluatedAtMs,
  });
}

function entryFixture(direction = 'long') {
  const proposalValue = normalizedProposal(direction);
  const observation = bookFor({ evaluatedAtMs: NOW_MS, direction });
  const economics = createSyntheticVolumeEconomics({
    fixtureId: `volume-economic-exit-entry-${direction}`,
    valuationAsset: 'USDT',
    grossEdgePer1000ValuationNotional: '5',
    accountFeeBpsPerSide: '0',
    slippageBpsPerSide: '0',
    liquidityCapacity: '5000',
    evaluatedAtMs: NOW_MS,
    expiresAtMs: EXPIRY_MS,
  });
  const evaluation = evaluateVolumeStrategy({
    proposal: proposalValue,
    observation,
    economics,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(evaluation.disposition, 'VALIDATED_RECORD_ONLY');
  assert.equal(validateVolumeStrategyEvaluation(evaluation), true);
  return { proposal: proposalValue, observation, evaluation };
}

function syntheticPolicy(overrides = {}) {
  return buildSyntheticVolumeEconomicExitPolicy({
    fixtureId: 'volume-economic-exit-policy-0001',
    modeledBaseQuantity: '0.04',
    accountFeeBpsPerSide: '0',
    slippageBpsPerSide: '0',
    netLiquidationStopLossPer1000: '100',
    trailingDrawdownPer1000: '100',
    netLiquidationReversalLossPer1000: '100',
    evaluatedAtMs: NOW_MS,
    expiresAtMs: EXPIRY_MS,
    ...overrides,
  });
}

function evaluateAt({
  direction = 'long',
  elapsedMs,
  entry = entryFixture(direction),
  current = null,
  policy = syntheticPolicy(),
  previousSample = null,
}) {
  const evaluatedAtMs = NOW_MS + elapsedMs;
  const currentObservation = current ?? bookFor({
    evaluatedAtMs,
    direction,
    bidPrices: direction === 'long' ? ['100020', '100010'] : ['99960', '99950'],
    askPrices: direction === 'long' ? ['100030', '100040'] : ['99970', '99980'],
    sourceRevision: 12 + Math.floor(elapsedMs / 1_000),
  });
  return evaluateVolumeEconomicExit({
    entryEvaluation: entry.evaluation,
    entryObservation: entry.observation,
    currentObservation,
    policy,
    previousSample,
    evaluatedAtMs,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
}

function identity(prefix, namespace, semantic) {
  return `${prefix}_${stableHash128Hex(`${namespace}|${canonicalJson(semantic)}`)}`;
}

function resignSample(sample, overrides = {}) {
  const {
    sampleId: _sampleId,
    sampleDigest: _sampleDigest,
    ...semantic
  } = structuredClone(sample);
  Object.assign(semantic, overrides);
  return {
    sampleId: identity('vfes', 'volume.forward-exit.sample-id.v1', semantic),
    sampleDigest: identity('vfesd', 'volume.forward-exit.sample-digest.v1', semantic),
    ...semantic,
  };
}

function resignTerms(terms, overrides = {}) {
  const { termsId: _termsId, ...semantic } = structuredClone(terms);
  Object.assign(semantic, overrides);
  return {
    termsId: identity('vexitterms', 'volume.economic-exit.terms.v1', semantic),
    ...semantic,
  };
}

function resignDecision(
  decision,
  {
    decision: decisionOverrides = {},
    plan: planOverrides,
    terms: termsOverrides,
  } = {},
) {
  const snapshot = structuredClone(decision);
  let planCore = null;
  if (planOverrides !== null && snapshot.exitPlan !== null) {
    const {
      planId: _planId,
      decisionId: _planDecisionId,
      ...semantic
    } = snapshot.exitPlan;
    const terms = semantic.terms === null
      ? null
      : resignTerms(semantic.terms, termsOverrides ?? {});
    planCore = { ...semantic, ...(planOverrides ?? {}), terms };
  }
  const base = {
    schemaVersion: snapshot.schemaVersion,
    sampleId: snapshot.sampleId,
    evaluatedAtMs: snapshot.evaluatedAtMs,
    lifecyclePhase: snapshot.lifecyclePhase,
    disposition: snapshot.disposition,
    primaryReason: snapshot.primaryReason,
    reasonCodes: snapshot.reasonCodes,
    ...decisionOverrides,
  };
  const semantic = { decision: base, exitPlan: planCore };
  const decisionId = identity(
    'vexitdecision',
    'volume.economic-exit.decision-id.v1',
    semantic,
  );
  const decisionDigest = identity(
    'vexitdecisiond',
    'volume.economic-exit.decision-digest.v1',
    semantic,
  );
  const exitPlan = planCore === null
    ? null
    : {
        planId: identity(
          'vexitplan',
          'volume.economic-exit.plan.v1',
          { decisionId, ...planCore },
        ),
        decisionId,
        ...planCore,
      };
  return { decisionId, decisionDigest, ...base, exitPlan };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertNoAuthority(plan) {
  assert.equal(plan.mode, 'SHADOW_VALIDATE_ONLY');
  assert.equal(plan.validation, 'REJECTED');
  assert.equal(plan.killSwitchEngaged, true);
  assert.equal(plan.executionAuthority, 'NONE');
  assert.equal(plan.submitAuthority, 'NONE');
  assert.equal(plan.riskAuthority, 'NONE');
  assert.equal(plan.externalAuthority, 'NONE');
  assert.equal(plan.sendEligible, false);
  assert.equal(plan.sends, 0);
  assert.equal(plan.sideEffects, 0);
  assert.equal(plan.submitPortPresent, false);
  assert.equal(plan.queryPortPresent, false);
  assert.equal(plan.publicOnly, true);
  assert.equal(plan.privateCalls, false);
  assert.equal(plan.signedCalls, false);
  assert.equal(plan.providerCalls, false);
  assert.equal(plan.exchangeQueries, 0);
}

test('current exit policy is immutable reject-only UNKNOWN evidence and defaults remain OFF/KILL-ON safe', () => {
  assert.equal(VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION, 'VOLUME_ECONOMIC_EXIT_RULE_V1');
  assert.equal(VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION, 'VOLUME_FORWARD_EXIT_SAMPLE_V1');
  assert.equal(VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION, 'VOLUME_ECONOMIC_EXIT_POLICY_V1');
  assert.equal(VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS, 60_000);
  assert.equal(VOLUME_ECONOMIC_EXIT_MODE, 'SHADOW_VALIDATE_ONLY');
  assert.deepEqual(VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE, [
    'SOURCE_DEGRADED',
    'MAX_HOLD_REACHED',
    'NET_LIQUIDATION_STOP_REACHED',
    'TRAILING_DRAWDOWN_REACHED',
    'NET_LIQUIDATION_REVERSAL_LOSS_REACHED',
    'NO_EXIT_TRIGGER',
  ]);
  assert.equal(validateVolumeEconomicExitPolicy(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY), true);
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.evidenceClass, 'UNVALIDATED_CURRENT');
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.admissibility, 'REJECT_ONLY');
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.applicability, 'UNKNOWN');
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.productionAdmissible, false);
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.continuationOnly, true);
  assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY.fadeEnabled, false);
  for (const field of [
    'modeledBaseQuantity',
    'accountFeeBpsPerSide',
    'slippageBpsPerSide',
    'netLiquidationStopLossPer1000',
    'trailingDrawdownPer1000',
    'netLiquidationReversalLossPer1000',
  ]) assert.equal(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY[field], null, field);
  assertDeepFrozen(VOLUME_CURRENT_ECONOMIC_EXIT_POLICY);

  const entry = entryFixture();
  const input = {
    entryEvaluation: entry.evaluation,
    entryObservation: entry.observation,
    currentObservation: bookFor({ evaluatedAtMs: NOW_MS + 1_000, sourceRevision: 12 }),
    policy: VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
    previousSample: null,
    evaluatedAtMs: NOW_MS + 1_000,
  };
  const defaultOff = evaluateVolumeEconomicExit(input);
  assert.equal(defaultOff.sample, null);
  assert.deepEqual(defaultOff.decision.reasonCodes, ['EXIT_RULE_DISABLED']);

  const enabled = evaluateVolumeEconomicExit(input, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(enabled.sample, null);
  assert.equal(enabled.decision.disposition, 'REJECTED');
  for (const code of [
    'EXIT_POLICY_REJECT_ONLY',
    'EXIT_POLICY_THRESHOLDS_UNKNOWN',
    'EXIT_ECONOMICS_UNKNOWN',
    'EXIT_ACCOUNT_FEE_UNKNOWN',
    'EXIT_SLIPPAGE_UNKNOWN',
    'EXIT_ENTRY_FILL_UNPROVEN',
  ]) assert.ok(enabled.decision.reasonCodes.includes(code), code);
  assert.equal(validateVolumeEconomicExitDecision(enabled.decision), true);
  assertDeepFrozen(enabled);
});

test('synthetic policy alone exercises the exact 59,999/60,000 millisecond boundary', () => {
  const firstPolicy = syntheticPolicy();
  const replayPolicy = syntheticPolicy();
  assert.deepEqual(replayPolicy, firstPolicy);
  assert.equal(firstPolicy.evidenceClass, 'SYNTHETIC_TEST');
  assert.equal(firstPolicy.admissibility, 'VALIDATE_ONLY_TEST');
  assert.equal(firstPolicy.applicability, 'SYNTHETIC_TEST_ONLY');
  assert.equal(firstPolicy.maxHoldMs, 60_000);
  assert.equal(firstPolicy.continuationOnly, true);
  assert.equal(firstPolicy.fadeEnabled, false);
  assert.equal(validateVolumeEconomicExitPolicy(firstPolicy), true);
  assertDeepFrozen(firstPolicy);

  const before = evaluateAt({ elapsedMs: 59_999, policy: firstPolicy });
  assert.notEqual(before.sample, null, JSON.stringify(before.decision));
  assert.equal(before.sample.holdAgeMs, 59_999);
  assert.equal(before.decision.disposition, 'HOLD_SHADOW');
  assert.equal(before.decision.lifecyclePhase, 'HOLDING');
  assert.equal(before.decision.primaryReason, 'NO_EXIT_TRIGGER');
  assert.equal(before.decision.exitPlan, null);

  const boundary = evaluateAt({ elapsedMs: 60_000, policy: firstPolicy });
  assert.equal(boundary.sample.holdAgeMs, 60_000);
  assert.equal(boundary.decision.disposition, 'EXIT_SHADOW');
  assert.equal(boundary.decision.lifecyclePhase, 'TERMINAL_EXIT');
  assert.equal(boundary.decision.primaryReason, 'MAX_HOLD_REACHED');
  assert.ok(boundary.decision.exitPlan);
  assert.equal(validateVolumeForwardExitSample(boundary.sample), true);
  assert.equal(validateVolumeEconomicExitDecision(boundary.decision), true);
});

test('long and short shadow exits recompute opposite-side synchronized-depth capacity', () => {
  const longResult = evaluateAt({ elapsedMs: 60_000, direction: 'long' });
  const longTerms = longResult.decision.exitPlan.terms;
  assert.equal(longTerms.exitSide, 'SELL');
  assert.equal(longTerms.limitPrice, '100010');
  assert.equal(longTerms.baseQuantity, '0.04');
  assert.equal(longTerms.quoteNotional, '4000.6');
  assert.equal(longTerms.capacityBasis, 'SYNCHRONIZED_CUMULATIVE');
  assert.equal(longTerms.levelCount, 2);
  assert.notEqual(
    longResult.sample.exitQuoteNotional,
    longResult.sample.entryQuoteNotional,
    'current opposite-side liquidation must not reuse entry-side capacity',
  );

  const shortResult = evaluateAt({ elapsedMs: 60_000, direction: 'short' });
  const shortTerms = shortResult.decision.exitPlan.terms;
  assert.equal(shortTerms.exitSide, 'BUY');
  assert.equal(shortTerms.limitPrice, '99980');
  assert.equal(shortTerms.baseQuantity, '0.04');
  assert.equal(shortTerms.quoteNotional, '3999');
  assert.equal(shortTerms.capacityBasis, 'SYNCHRONIZED_CUMULATIVE');
  assert.equal(shortTerms.levelCount, 2);
  assert.notEqual(shortResult.sample.exitQuoteNotional, shortResult.sample.entryQuoteNotional);
});

test('source degradation and economic triggers follow one deterministic precedence', () => {
  const degradedCurrent = bookFor({
    evaluatedAtMs: NOW_MS + 60_000,
    sourceRevision: 72,
    continuity: 'GAP',
  });
  const degraded = evaluateAt({
    elapsedMs: 60_000,
    current: degradedCurrent,
  });
  assert.equal(degraded.sample.sourceDisposition, 'DEGRADED');
  assert.equal(degraded.decision.primaryReason, 'SOURCE_DEGRADED');

  const losingCurrent = bookFor({
    evaluatedAtMs: NOW_MS + 60_000,
    bidPrices: ['99000', '98990'],
    askPrices: ['99010', '99020'],
    sourceRevision: 72,
  });
  const maxBeforeStop = evaluateAt({
    elapsedMs: 60_000,
    current: losingCurrent,
    policy: syntheticPolicy({
      netLiquidationStopLossPer1000: '1',
      trailingDrawdownPer1000: '1',
      netLiquidationReversalLossPer1000: '1',
    }),
  });
  assert.equal(maxBeforeStop.decision.primaryReason, 'MAX_HOLD_REACHED');

  const stopBeforeOthers = evaluateAt({
    elapsedMs: 2_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 2_000,
      bidPrices: ['99000', '98990'],
      askPrices: ['99010', '99020'],
      sourceRevision: 14,
    }),
    policy: syntheticPolicy({
      netLiquidationStopLossPer1000: '1',
      trailingDrawdownPer1000: '1',
      netLiquidationReversalLossPer1000: '1',
    }),
  });
  assert.equal(stopBeforeOthers.decision.primaryReason, 'NET_LIQUIDATION_STOP_REACHED');

  const favorable = evaluateAt({
    elapsedMs: 1_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 1_000,
      bidPrices: ['101000', '100990'],
      askPrices: ['101010', '101020'],
      sourceRevision: 13,
    }),
    policy: syntheticPolicy({
      netLiquidationStopLossPer1000: '1000',
      trailingDrawdownPer1000: '1',
      netLiquidationReversalLossPer1000: '1',
    }),
  });
  assert.equal(favorable.decision.primaryReason, 'NO_EXIT_TRIGGER');
  const trailBeforeReversal = evaluateAt({
    elapsedMs: 2_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 2_000,
      bidPrices: ['99900', '99890'],
      askPrices: ['99910', '99920'],
      sourceRevision: 14,
    }),
    policy: syntheticPolicy({
      netLiquidationStopLossPer1000: '1000',
      trailingDrawdownPer1000: '1',
      netLiquidationReversalLossPer1000: '1',
    }),
    previousSample: favorable.sample,
  });
  assert.equal(trailBeforeReversal.decision.primaryReason, 'TRAILING_DRAWDOWN_REACHED');

  const economicReversalOnly = evaluateAt({
    elapsedMs: 2_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 2_000,
      bidPrices: ['99900', '99890'],
      askPrices: ['99910', '99920'],
      sourceRevision: 14,
    }),
    policy: syntheticPolicy({
      netLiquidationStopLossPer1000: '1000',
      trailingDrawdownPer1000: '1000',
      netLiquidationReversalLossPer1000: '1',
    }),
  });
  assert.equal(
    economicReversalOnly.decision.primaryReason,
    'NET_LIQUIDATION_REVERSAL_LOSS_REACHED',
  );
});

test('shadow LIMIT+IOC terms are inert, deeply frozen, and identity-bound', () => {
  const first = evaluateAt({ elapsedMs: 60_000 });
  const replay = evaluateAt({ elapsedMs: 60_000 });
  assert.deepEqual(replay, first);
  assert.match(first.sample.sampleId, /^vfes_[a-f0-9]{32}$/);
  assert.match(first.sample.sampleDigest, /^vfesd_[a-f0-9]{32}$/);
  assert.match(first.decision.decisionId, /^vexitdecision_[a-f0-9]{32}$/);
  assert.match(first.decision.decisionDigest, /^vexitdecisiond_[a-f0-9]{32}$/);
  assert.match(first.decision.exitPlan.planId, /^vexitplan_[a-f0-9]{32}$/);
  assert.match(first.decision.exitPlan.terms.termsId, /^vexitterms_[a-f0-9]{32}$/);
  assert.equal(first.decision.exitPlan.terms.orderType, 'LIMIT');
  assert.equal(first.decision.exitPlan.terms.timeInForce, 'IOC');
  assert.equal(
    first.decision.exitPlan.terms.unknownOutcomePolicy,
    'BLOCK_UNTIL_QUERY_RECONCILED',
  );
  assert.equal(
    first.decision.exitPlan.terms.partialFillPolicy,
    'RECONCILE_REMAINDER_BEFORE_NEXT_PLAN',
  );
  assert.equal(
    first.decision.exitPlan.terms.recoveryPolicy,
    'RESTORE_DURABLE_LATEST_BEFORE_REEVALUATION',
  );
  assertNoAuthority(first.decision.exitPlan);
  assertDeepFrozen(first);

  const changedSource = evaluateAt({
    elapsedMs: 60_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 60_000,
      bidPrices: ['100021', '100011'],
      askPrices: ['100031', '100041'],
      sourceRevision: 73,
    }),
  });
  assert.notEqual(changedSource.sample.sampleId, first.sample.sampleId);
  assert.notEqual(changedSource.decision.decisionId, first.decision.decisionId);
  assert.notEqual(
    changedSource.decision.exitPlan.terms.termsId,
    first.decision.exitPlan.terms.termsId,
  );

  const noCurrentSource = evaluateAt({
    elapsedMs: 1_000,
    current: null,
  });
  const explicitNoCurrent = evaluateVolumeEconomicExit({
    entryEvaluation: entryFixture().evaluation,
    entryObservation: entryFixture().observation,
    currentObservation: null,
    policy: syntheticPolicy(),
    previousSample: null,
    evaluatedAtMs: NOW_MS + 1_000,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(noCurrentSource.decision.disposition, 'HOLD_SHADOW');
  assert.equal(explicitNoCurrent.sample.sourceDisposition, 'DEGRADED');
  assert.equal(explicitNoCurrent.sample.netLiquidationPnlPer1000, null);
  assert.equal(explicitNoCurrent.decision.primaryReason, 'SOURCE_DEGRADED');
  assert.equal(explicitNoCurrent.decision.exitPlan.terms, null);
  assertNoAuthority(explicitNoCurrent.decision.exitPlan);

  const olderCurrent = evaluateAt({
    elapsedMs: 1_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS - 1,
      sourceRevision: 13,
    }),
  });
  assert.equal(olderCurrent.sample.sourceDisposition, 'DEGRADED');
  assert.equal(olderCurrent.sample.observedAtMs, NOW_MS - 1);
  assert.equal(validateVolumeEconomicExitState(olderCurrent), true);

  const futureCurrent = evaluateAt({
    elapsedMs: 1_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 1_001,
      sourceRevision: 14,
    }),
  });
  assert.equal(futureCurrent.sample, null);
  assert.equal(futureCurrent.decision.disposition, 'REJECTED');
  assert.deepEqual(futureCurrent.decision.reasonCodes, ['EXIT_SOURCE_CLOCK_INVALID']);
  assert.equal(validateVolumeEconomicExitDecision(futureCurrent.decision), true);
});

test('re-signed forward samples reject every omitted field, time, decimal, null, and arithmetic invariant', () => {
  const first = evaluateAt({ elapsedMs: 1_000 });
  const chained = evaluateAt({
    elapsedMs: 2_000,
    previousSample: first.sample,
  });
  assert.equal(validateVolumeForwardExitSample(first.sample), true);
  assert.equal(validateVolumeForwardExitSample(chained.sample), true);
  assert.notEqual(chained.sample.priorFavorableExtremeNetPnlPer1000, null);

  const cases = [
    ['previousSampleId format', chained.sample, { previousSampleId: 'vfes_bad' }],
    ['entryEvaluationId', first.sample, { entryEvaluationId: '' }],
    ['entryPlanId', first.sample, { entryPlanId: '' }],
    ['entryProposalId', first.sample, { entryProposalId: ' bad' }],
    ['entryProposalDigest', first.sample, { entryProposalDigest: '' }],
    ['entryObservationDigest', first.sample, { entryObservationDigest: 'vobs_bad' }],
    ['currentObservationDigest', first.sample, { currentObservationDigest: 'vobs_bad' }],
    ['policyDigest', first.sample, { policyDigest: 'vexitpolicyd_bad' }],
    ['symbol', first.sample, { symbol: 'btcusdt' }],
    ['observedAtMs type', first.sample, { observedAtMs: '1900000000001' }],
    ['observedAtMs negative', first.sample, { observedAtMs: -1 }],
    ['observedAtMs future', first.sample, { observedAtMs: first.sample.evaluatedAtMs + 1 }],
    ['current digest without observed time', first.sample, { observedAtMs: null }],
    ['observed time without current digest', first.sample, { currentObservationDigest: null }],
    ['exitQuoteNotional canonical', first.sample, { exitQuoteNotional: '04000.6' }],
    ['exitQuoteNotional positive', first.sample, { exitQuoteNotional: '0' }],
    ['netLiquidationPnlPer1000 canonical', first.sample, { netLiquidationPnlPer1000: '-0' }],
    ['prior favorable canonical', chained.sample, { priorFavorableExtremeNetPnlPer1000: '-0' }],
    ['favorable canonical', first.sample, { favorableExtremeNetPnlPer1000: '01' }],
    ['drawdown nonnegative', first.sample, { drawdownFromFavorableExtremePer1000: '-1' }],
    ['exit notional and pnl co-presence', first.sample, { exitQuoteNotional: null }],
    ['pnl and exit notional co-presence', first.sample, { netLiquidationPnlPer1000: null }],
    ['accepted current digest required', first.sample, { currentObservationDigest: null, observedAtMs: null }],
    ['accepted favorable required', first.sample, { favorableExtremeNetPnlPer1000: null }],
    ['accepted drawdown required', first.sample, { drawdownFromFavorableExtremePer1000: null }],
    ['degraded disposition cannot retain net economics', first.sample, { sourceDisposition: 'DEGRADED' }],
    ['prior favorable maximum', chained.sample, { priorFavorableExtremeNetPnlPer1000: '999999' }],
    ['favorable maximum', chained.sample, { favorableExtremeNetPnlPer1000: '999999' }],
    ['drawdown arithmetic', chained.sample, { drawdownFromFavorableExtremePer1000: '999999' }],
  ];
  for (const [label, sample, overrides] of cases) {
    assert.equal(
      validateVolumeForwardExitSample(resignSample(sample, overrides)),
      false,
      label,
    );
  }
});

test('re-signed cumulative LIMIT terms remain conservative for both exit sides', () => {
  const longExit = evaluateAt({ elapsedMs: 60_000 });
  const shortExit = evaluateAt({ direction: 'short', elapsedMs: 60_000 });
  assert.equal(validateVolumeEconomicExitDecision(longExit.decision), true);
  assert.equal(validateVolumeEconomicExitDecision(shortExit.decision), true);

  const inflatedSellLimit = resignDecision(longExit.decision, {
    terms: { limitPrice: '999999999' },
  });
  const deflatedBuyLimit = resignDecision(shortExit.decision, {
    terms: { limitPrice: '0.00000001' },
  });
  const maximumCanonical = '9'.repeat(96);
  const wideBuyTerms = resignDecision(shortExit.decision, {
    terms: {
      limitPrice: maximumCanonical,
      baseQuantity: maximumCanonical,
      quoteNotional: maximumCanonical,
    },
  });
  assert.equal(validateVolumeEconomicExitDecision(inflatedSellLimit), false);
  assert.equal(validateVolumeEconomicExitDecision(deflatedBuyLimit), false);
  assert.equal(validateVolumeEconomicExitDecision(wideBuyTerms), true);
});

test('re-signed decisions enforce reason semantics instead of trusting their identities', () => {
  const hold = evaluateAt({ elapsedMs: 1_000 });
  const rejected = evaluateVolumeEconomicExit({
    entryEvaluation: null,
    entryObservation: null,
    currentObservation: null,
    policy: VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
    previousSample: null,
    evaluatedAtMs: NOW_MS,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(validateVolumeEconomicExitDecision(hold.decision), true);
  assert.equal(validateVolumeEconomicExitDecision(rejected.decision), true);

  for (const [label, decision, reasonCodes] of [
    ['unknown hold reason', hold.decision, ['NOT_A_REASON']],
    ['duplicate hold reason', hold.decision, ['NO_EXIT_TRIGGER', 'NO_EXIT_TRIGGER']],
    ['primary/reason mismatch', hold.decision, ['SOURCE_DEGRADED']],
    ['unknown rejected reason', rejected.decision, ['NOT_A_REJECTION']],
  ]) {
    assert.equal(
      validateVolumeEconomicExitDecision(resignDecision(decision, {
        decision: { reasonCodes },
      })),
      false,
      label,
    );
  }
});

test('durable state binds decision time, disposition, precedence, and hypothetical terms to its sample', () => {
  const hold = evaluateAt({ elapsedMs: 1_000 });
  const exit = evaluateAt({ elapsedMs: 60_000 });
  const degraded = evaluateAt({
    elapsedMs: 60_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 60_000,
      sourceRevision: 72,
      continuity: 'GAP',
    }),
  });
  const degradedBeforeMax = evaluateAt({
    elapsedMs: 1_000,
    current: bookFor({
      evaluatedAtMs: NOW_MS + 1_000,
      sourceRevision: 13,
      continuity: 'GAP',
    }),
  });
  for (const result of [hold, exit, degraded, degradedBeforeMax]) {
    assert.equal(
      validateVolumeEconomicExitState({
        sample: result.sample,
        decision: result.decision,
      }),
      true,
      result.decision.primaryReason,
    );
  }

  const crossInvalid = [
    ['decision/sample time', hold.sample, resignDecision(hold.decision, {
      decision: { evaluatedAtMs: hold.decision.evaluatedAtMs + 1 },
    })],
    ['HOLD at maximum age', exit.sample, resignDecision(hold.decision, {
      decision: {
        sampleId: exit.sample.sampleId,
        evaluatedAtMs: exit.sample.evaluatedAtMs,
      },
    })],
    ['accepted cannot claim SOURCE_DEGRADED', exit.sample, resignDecision(exit.decision, {
      decision: {
        primaryReason: 'SOURCE_DEGRADED',
        reasonCodes: ['SOURCE_DEGRADED'],
      },
    })],
    ['degraded must retain SOURCE_DEGRADED precedence', degraded.sample, resignDecision(
      degraded.decision,
      {
        decision: {
          primaryReason: 'MAX_HOLD_REACHED',
          reasonCodes: ['MAX_HOLD_REACHED'],
        },
      },
    )],
    ['degraded cannot HOLD', degradedBeforeMax.sample, resignDecision(
      degradedBeforeMax.decision,
      {
        decision: {
          lifecyclePhase: 'HOLDING',
          disposition: 'HOLD_SHADOW',
          primaryReason: 'NO_EXIT_TRIGGER',
          reasonCodes: ['NO_EXIT_TRIGGER'],
        },
        plan: null,
      },
    )],
    ['MAX before boundary', hold.sample, resignDecision(exit.decision, {
      decision: {
        sampleId: hold.sample.sampleId,
        evaluatedAtMs: hold.sample.evaluatedAtMs,
      },
      plan: { sampleId: hold.sample.sampleId },
      terms: {
        symbol: hold.sample.symbol,
        direction: hold.sample.direction,
        exitSide: hold.sample.direction === 'long' ? 'SELL' : 'BUY',
        baseQuantity: hold.sample.modeledBaseQuantity,
        quoteNotional: hold.sample.exitQuoteNotional,
        entryObservationDigest: hold.sample.entryObservationDigest,
        currentObservationDigest: hold.sample.currentObservationDigest,
      },
    })],
  ];
  for (const [label, sample, decision] of crossInvalid) {
    assert.equal(validateVolumeEconomicExitDecision(decision), true, `${label} decision`);
    assert.equal(validateVolumeForwardExitSample(sample), true, `${label} sample`);
    assert.equal(validateVolumeEconomicExitState({ sample, decision }), false, label);
  }

  for (const [label, terms] of [
    ['terms symbol', { symbol: 'ETHUSDT' }],
    ['terms quantity', { baseQuantity: '0.03' }],
    ['terms notional', { quoteNotional: '999999999' }],
    ['terms entry digest', { entryObservationDigest: `vobs_${'e'.repeat(64)}` }],
    ['terms current digest', { currentObservationDigest: `vobs_${'f'.repeat(64)}` }],
  ]) {
    const decision = resignDecision(exit.decision, { terms });
    assert.equal(validateVolumeEconomicExitDecision(decision), true, `${label} decision`);
    assert.equal(
      validateVolumeEconomicExitState({ sample: exit.sample, decision }),
      false,
      label,
    );
  }
});

test('hostile and non-canonical inputs fail closed without invoking traps or exposing authority', () => {
  for (const invalid of [
    { evaluatedAtMs: Number.NaN },
    { evaluatedAtMs: Number.POSITIVE_INFINITY },
    { evaluatedAtMs: -0 },
  ]) {
    const input = {
      entryEvaluation: null,
      entryObservation: null,
      currentObservation: null,
      policy: VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
      previousSample: null,
      evaluatedAtMs: NOW_MS,
      ...invalid,
    };
    const result = evaluateVolumeEconomicExit(input, {
      enabled: true,
      killSwitchEngaged: true,
    });
    assert.equal(result.sample, null);
    assert.deepEqual(result.decision.reasonCodes, ['EXIT_INPUT_INVALID']);
    assert.equal(validateVolumeEconomicExitDecision(result.decision), true);
  }

  let proxyTraps = 0;
  const proxy = new Proxy({}, {
    ownKeys() {
      proxyTraps += 1;
      throw new Error('must not invoke proxy traps');
    },
  });
  const proxyResult = evaluateVolumeEconomicExit(proxy, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(proxyResult.sample, null);
  assert.deepEqual(proxyResult.decision.reasonCodes, ['EXIT_INPUT_INVALID']);
  assert.equal(proxyTraps, 0);

  let getterReads = 0;
  const accessor = {
    entryEvaluation: null,
    entryObservation: null,
    currentObservation: null,
    policy: VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
    previousSample: null,
    evaluatedAtMs: NOW_MS,
  };
  Object.defineProperty(accessor, 'policy', {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error('must not invoke accessors');
    },
  });
  const accessorResult = evaluateVolumeEconomicExit(accessor, {
    enabled: true,
    killSwitchEngaged: true,
  });
  assert.equal(accessorResult.sample, null);
  assert.deepEqual(accessorResult.decision.reasonCodes, ['EXIT_INPUT_INVALID']);
  assert.equal(getterReads, 0);

  const cycle = {};
  cycle.self = cycle;
  assert.throws(
    () => buildSyntheticVolumeEconomicExitPolicy(cycle),
    /policy is invalid/,
  );
  for (const invalid of [
    { modeledBaseQuantity: '01' },
    { netLiquidationStopLossPer1000: '-0' },
    { evaluatedAtMs: -0 },
    { extra: true },
  ]) {
    assert.throws(
      () => buildSyntheticVolumeEconomicExitPolicy({
        fixtureId: 'volume-exit-hostile',
        modeledBaseQuantity: '0.04',
        accountFeeBpsPerSide: '0',
        slippageBpsPerSide: '0',
        netLiquidationStopLossPer1000: '100',
        trailingDrawdownPer1000: '100',
        netLiquidationReversalLossPer1000: '100',
        evaluatedAtMs: NOW_MS,
        expiresAtMs: EXPIRY_MS,
        ...invalid,
      }),
      /invalid/,
    );
  }
});
