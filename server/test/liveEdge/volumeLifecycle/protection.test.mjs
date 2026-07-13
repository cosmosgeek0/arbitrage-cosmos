import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVolumeLifecycle,
  evaluateVolumeProtectionRevision,
  lossStopReached,
  lossStopReachedFromCostBasis,
  projectVolumeProtectionRevision,
  trailingStopReached,
  trailingStopReachedFromCostBasis,
  validateVolumeProtectionPolicy,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import { finalizeProjection } from '../../../dist/liveEdge/adapters/volumeLifecycle/validation.js';
import {
  lifecycleInput,
  NOW,
  openProbe,
  planProbe,
  protectionPolicy,
  twinForAction,
} from './fixtures.mjs';

test('fixed loss stop triggers inclusively at the exact directional BPS boundary', () => {
  assert.equal(lossStopReached('LONG', '100', '95', 500), true);
  assert.equal(lossStopReached('LONG', '100', '95.0001', 500), false);
  assert.equal(lossStopReached('SHORT', '100', '105', 500), true);
  assert.equal(lossStopReached('SHORT', '100', '104.9999', 500), false);
});

test('non-terminating weighted entry ratios use exact cost-basis products for loss and trailing protection', () => {
  const longBoundaryInsideExactStop = '95.3166666666666666666666665';
  assert.equal(
    lossStopReachedFromCostBasis('LONG', '3.01', '0.03', longBoundaryInsideExactStop, 500),
    true,
  );
  assert.equal(
    lossStopReached('LONG', '100.333333333333333333333333', longBoundaryInsideExactStop, 500),
    false,
  );

  const shortActivationInsideExactThreshold = '97.3233333333333333333333332';
  assert.equal(
    trailingStopReachedFromCostBasis(
      'SHORT',
      '3.01',
      '0.03',
      shortActivationInsideExactThreshold,
      '100',
      300,
      200,
    ),
    true,
  );
  assert.equal(
    trailingStopReached(
      'SHORT',
      '100.333333333333333333333333',
      shortActivationInsideExactThreshold,
      '100',
      300,
      200,
    ),
    false,
  );
});

test('lifecycle retains exact weighted entry cost and triggers LONG loss inside the truncated-average gap', () => {
  const capitalMaximumQuote = '16';
  const cuts = [
    { targetState: 'PROBE', cumulativeQuantity: '0.03', cumulativeNotionalQuote: '3.2', priceBound: '101' },
    { targetState: 'CONFIRM', cumulativeQuantity: '0.06', cumulativeNotionalQuote: '6.4', priceBound: '101' },
    { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '10.5', priceBound: '101' },
  ];
  const opened = openProbe({
    authority: { capitalMaximumQuote },
    sizing: { cuts },
  }, {
    asks: [
      { price: '100', quantity: '0.01' },
      { price: '100.5', quantity: '0.02' },
    ],
  });
  assert.equal(opened.settled.projection.entryCostBasisQuote, '3.01');
  assert.equal(opened.settled.projection.entryCostBasisQuantity, '0.03');
  assert.equal(opened.settled.projection.entryAveragePrice, '100.333333333333333333333333');

  const confirmPlan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    sizing: { cuts },
    authority: { riskActionClass: 'ADD', capitalMaximumQuote },
  }));
  const confirmed = evaluateVolumeLifecycle(lifecycleInput({
    current: confirmPlan.projection,
    sizing: { cuts },
    authority: { riskActionClass: 'ADD', capitalMaximumQuote },
    twinEvidence: twinForAction(confirmPlan.actionRequest, {
      asks: [{ price: '100', quantity: '0.03' }],
    }),
  }));
  assert.equal(confirmed.projection.entryCostBasisQuote, '6.01');
  assert.equal(confirmed.projection.entryCostBasisQuantity, '0.06');
  assert.equal(confirmed.projection.entryAveragePrice, '100.166666666666666666666666');

  const currentPrice = '95.1583333333333333333333332';
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: confirmed.projection,
    sizing: { cuts },
    authority: { riskActionClass: 'EXIT', capitalMaximumQuote },
    market: { currentPrice, riskReductionPriceBound: '95' },
    signals: { currentPrice },
  }));
  assert.equal(result.disposition, 'PLANNED');
  assert.equal(result.actionRequest.kind, 'EXIT');
  assert.ok(result.reasonCodes.includes('MAXIMUM_LOSS_REACHED'));
});

test('trailing stop activates and triggers inclusively for LONG and SHORT while retaining direction', () => {
  assert.equal(trailingStopReached('LONG', '100', '104', '101.92', 300, 200), true);
  assert.equal(trailingStopReached('LONG', '100', '102.99', '100', 300, 200), false);
  assert.equal(trailingStopReached('SHORT', '100', '96', '97.92', 300, 200), true);
  assert.equal(trailingStopReached('SHORT', '100', '97.01', '100', 300, 200), false);
});

test('policy and projection APIs reject accessors and proxies without invoking them', () => {
  let hits = 0;
  const hostilePolicy = { ...protectionPolicy() };
  Object.defineProperty(hostilePolicy, 'maximumLossBps', {
    enumerable: true,
    get() { hits += 1; return 500; },
  });
  assert.throws(() => validateVolumeProtectionPolicy(hostilePolicy), /data properties/u);
  assert.equal(hits, 0);
  assert.throws(() => validateVolumeProtectionPolicy(new Proxy(protectionPolicy(), {})), /plain record/u);

  const outer = {
    current: protectionPolicy(), proposed: protectionPolicy(), evaluatedAtMs: NOW, positionActive: true,
  };
  Object.defineProperty(outer, 'current', { enumerable: true, get() { hits += 1; return protectionPolicy(); } });
  assert.throws(() => evaluateVolumeProtectionRevision(outer), /data properties/u);
  assert.equal(hits, 0);

  const opened = openProbe();
  const projectionInput = {
    projection: opened.settled.projection,
    occupancy: lifecycleInput({ current: opened.settled.projection }).occupancy,
    currentPolicy: protectionPolicy(), proposedPolicy: protectionPolicy(), evaluatedAtMs: NOW,
  };
  Object.defineProperty(projectionInput, 'projection', {
    enumerable: true, get() { hits += 1; return opened.settled.projection; },
  });
  assert.throws(() => projectVolumeProtectionRevision(projectionInput), /enumerable data/u);
  assert.equal(hits, 0);
});

test('terminal lifecycle policy lineage cannot be rewritten after feedback sealing', () => {
  const currentPolicy = protectionPolicy();
  const planned = planProbe({
    proposal: { proposalId: 'volume-proposal-terminal-policy-lineage' }, policy: currentPolicy,
  });
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-policy-lineage' }, policy: currentPolicy,
    current: planned.projection, twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  }));
  const proposedPolicy = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: currentPolicy.policyRevision,
    effectiveFromMs: terminal.projection.lastTransition.occurredAtMs,
    maximumLossBps: 400,
  });
  assert.throws(() => projectVolumeProtectionRevision({
    projection: terminal.projection,
    occupancy: lifecycleInput({
      current: terminal.projection,
      evaluatedAtMs: terminal.projection.lastTransition.occurredAtMs,
    }).occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs: terminal.projection.lastTransition.occurredAtMs,
  }), /cannot rewrite terminal lifecycle lineage/u);
});

test('maximum-loss equality produces a non-sendable EXIT request for an active lifecycle', () => {
  const opened = openProbe();
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    market: { currentPrice: '95', riskReductionPriceBound: '94' },
    signals: { currentPrice: '95' },
  }));
  assert.equal(result.disposition, 'PLANNED');
  assert.equal(result.actionRequest.kind, 'EXIT');
  assert.equal(result.primaryReasonCode, 'MAXIMUM_LOSS_REACHED');
  assert.equal(result.actionRequest.sendEligible, false);
});

test('time stop triggers at equality using the injected event time and no timer', () => {
  const policy = protectionPolicy({ maximumHoldingMs: 81 });
  const opened = openProbe({ policy });
  assert.equal(NOW - opened.settled.projection.openedAtMs, 80);
  const result = evaluateVolumeLifecycle(lifecycleInput({
    evaluatedAtMs: NOW + 1,
    current: opened.settled.projection,
    policy,
    authority: { riskActionClass: 'EXIT' },
  }));
  assert.equal(result.disposition, 'PLANNED');
  assert.equal(result.actionRequest.kind, 'EXIT');
  assert.ok(result.reasonCodes.includes('TIME_STOP_REACHED'));
});

test('favorable extreme is monotonic and the exact trailing threshold plans EXIT', () => {
  const opened = openProbe();
  const favorable = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    market: { currentPrice: '104' },
    signals: { currentPrice: '104', confirmation: 'PENDING' },
  }));
  assert.equal(favorable.disposition, 'HOLD');
  assert.equal(favorable.projection.favorableExtremePrice, '104');

  const drawdown = evaluateVolumeLifecycle(lifecycleInput({
    current: favorable.projection,
    authority: { riskActionClass: 'EXIT' },
    market: { currentPrice: '101.92', riskReductionPriceBound: '101' },
    signals: { currentPrice: '101.92', confirmation: 'PENDING' },
  }));
  assert.equal(drawdown.disposition, 'PLANNED');
  assert.equal(drawdown.actionRequest.kind, 'EXIT');
  assert.ok(drawdown.reasonCodes.includes('TRAILING_STOP_REACHED'));
  assert.equal(drawdown.projection.favorableExtremePrice, '104');
});

test('pending ADD observations retain the favorable extreme and require recovery on the later trailing drawdown', () => {
  const opened = openProbe();
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
    market: { currentPrice: '110', intendedPriceBound: '112' },
    signals: { currentPrice: '110' },
  }));
  assert.equal(planned.disposition, 'PLANNED');
  assert.equal(planned.actionRequest.kind, 'ADD');
  assert.equal(planned.projection.favorableExtremePrice, '110');
  assert.equal(planned.actionRequest.projectionRevision, opened.settled.projection.projectionRevision);

  const pendingHigh = evaluateVolumeLifecycle(lifecycleInput({
    current: planned.projection,
    authority: { riskActionClass: 'ADD' },
    market: { currentPrice: '112', intendedPriceBound: '112' },
    signals: { currentPrice: '112' },
  }));
  assert.equal(pendingHigh.disposition, 'HOLD');
  assert.equal(pendingHigh.projection.favorableExtremePrice, '112');
  assert.equal(pendingHigh.projection.lastTransition.primaryReasonCode, 'MARKET_OBSERVATION_PROJECTED');
  assert.ok(pendingHigh.projection.lastTransition.occurredAtMs
    > planned.projection.lastTransition.occurredAtMs);
  assert.equal(pendingHigh.projection.pendingAction.actionKey, planned.actionRequest.actionKey);

  const drawdown = evaluateVolumeLifecycle(lifecycleInput({
    current: pendingHigh.projection,
    authority: { riskActionClass: 'ADD' },
    market: { currentPrice: '109', intendedPriceBound: '112' },
    signals: { currentPrice: '109' },
  }));
  assert.equal(drawdown.disposition, 'RECOVERY_REQUIRED');
  assert.equal(drawdown.projection.favorableExtremePrice, '112');
  assert.ok(drawdown.reasonCodes.includes('PENDING_ACTION_DURING_EXIT_TRIGGER'));
  assert.ok(drawdown.reasonCodes.includes('TRAILING_STOP_REACHED'));
});

test('ADD twin no-fill retains a trusted new high and the later trailing drawdown plans EXIT', () => {
  const proposal = { proposalId: 'volume-proposal-add-no-fill-extreme' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
    market: { currentPrice: '105', intendedPriceBound: '106' },
    signals: { currentPrice: '105' },
  }));
  assert.equal(planned.disposition, 'PLANNED');
  assert.equal(planned.actionRequest.kind, 'ADD');
  assert.equal(planned.projection.favorableExtremePrice, '105');

  const noFillAtHigh = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: planned.projection,
    authority: { riskActionClass: 'ADD' },
    market: { currentPrice: '110', intendedPriceBound: '111' },
    signals: { currentPrice: '110' },
    twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  }));
  assert.equal(noFillAtHigh.disposition, 'SETTLED');
  assert.equal(noFillAtHigh.projection.pendingAction, null);
  assert.equal(noFillAtHigh.projection.lastNoFill.action.actionKey, planned.actionRequest.actionKey);
  assert.equal(noFillAtHigh.projection.currentPrice, '110');
  assert.equal(noFillAtHigh.projection.favorableExtremePrice, '110');

  const drawdown = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: noFillAtHigh.projection,
    authority: { riskActionClass: 'EXIT' },
    market: { currentPrice: '107.8', riskReductionPriceBound: '107' },
    signals: { currentPrice: '107.8', confirmation: 'PENDING' },
  }));
  assert.equal(drawdown.disposition, 'PLANNED');
  assert.equal(drawdown.actionRequest.kind, 'EXIT');
  assert.ok(drawdown.reasonCodes.includes('TRAILING_STOP_REACHED'));
  assert.equal(drawdown.projection.favorableExtremePrice, '110');
});

test('an exact settled replay retains a fresh high and still permits the trailing EXIT', () => {
  const proposal = { proposalId: 'volume-proposal-settled-replay-extreme' };
  const opened = openProbe({ proposal });
  const replay = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    market: { currentPrice: '104', intendedPriceBound: '105' },
    signals: { currentPrice: '104', confirmation: 'PENDING' },
    twinEvidence: opened.twinEvidence,
  }));
  assert.equal(replay.disposition, 'NOOP_REPEAT');
  assert.equal(replay.actionRequest, null);
  assert.equal(replay.projection.currentPrice, '104');
  assert.equal(replay.projection.favorableExtremePrice, '104');

  const drawdown = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: replay.projection,
    authority: { riskActionClass: 'EXIT' },
    market: { currentPrice: '101.92', riskReductionPriceBound: '101' },
    signals: { currentPrice: '101.92', confirmation: 'PENDING' },
  }));
  assert.equal(drawdown.disposition, 'PLANNED');
  assert.equal(drawdown.actionRequest.kind, 'EXIT');
  assert.ok(drawdown.reasonCodes.includes('TRAILING_STOP_REACHED'));
  assert.equal(drawdown.projection.favorableExtremePrice, '104');
});

test('canonical recovery resolution retains a trusted new high for the later trailing drawdown', () => {
  const proposal = { proposalId: 'volume-proposal-recovery-resolution-extreme' };
  const opened = openProbe({ proposal });
  const recoveryAtMs = NOW + 20;
  const recovery = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: recoveryAtMs,
    current: opened.settled.projection,
    authority: { riskActionClass: 'RECOVERY' },
    market: { currentPrice: '104' },
    signals: { currentPrice: '103', confirmation: 'PENDING' },
  }));
  assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
  assert.ok(recovery.reasonCodes.includes('ACTIVE_MARKET_SIGNAL_PRICE_MISMATCH'));
  assert.equal(recovery.projection.favorableExtremePrice, opened.settled.projection.favorableExtremePrice);

  const resolutionAtMs = recoveryAtMs + 20;
  const resolved = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: resolutionAtMs,
    current: recovery.projection,
    authority: { riskActionClass: 'RECOVERY' },
    market: { currentPrice: '110' },
    signals: {
      currentPrice: '110',
      confirmation: 'PENDING',
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: 'volume-recovery-resolution-extreme-0001',
    },
  }));
  assert.equal(resolved.disposition, 'SETTLED');
  assert.deepEqual(resolved.reasonCodes, ['CANONICAL_RECOVERY_RESOLVED']);
  assert.equal(resolved.projection.currentPrice, '110');
  assert.equal(resolved.projection.favorableExtremePrice, '110');

  const drawdownAtMs = resolutionAtMs + 20;
  const drawdown = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: drawdownAtMs,
    current: resolved.projection,
    authority: { riskActionClass: 'EXIT' },
    market: { currentPrice: '107.8', riskReductionPriceBound: '107' },
    signals: { currentPrice: '107.8', confirmation: 'PENDING' },
  }));
  assert.equal(drawdown.disposition, 'PLANNED');
  assert.equal(drawdown.actionRequest.kind, 'EXIT');
  assert.ok(drawdown.reasonCodes.includes('TRAILING_STOP_REACHED'));
  assert.equal(drawdown.projection.favorableExtremePrice, '110');
});

test('blocked and HOLD paths while an active lifecycle awaits ADD retain each trusted new high', () => {
  const proposal = { proposalId: 'volume-proposal-blocked-hold-add-extreme' };
  const opened = openProbe({ proposal });
  const blocked = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'OPEN' },
    market: { currentPrice: '105', intendedPriceBound: '106' },
    signals: { currentPrice: '105' },
  }));
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('RISK_ACTION_CLASS_ADD_REQUIRED'));
  assert.equal(blocked.projection.currentPrice, '105');
  assert.equal(blocked.projection.favorableExtremePrice, '105');

  const held = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: blocked.projection,
    market: { currentPrice: '106', intendedPriceBound: '107' },
    signals: { currentPrice: '106', confirmation: 'PENDING' },
  }));
  assert.equal(held.disposition, 'HOLD');
  assert.deepEqual(held.reasonCodes, ['CONFIRMATION_PENDING']);
  assert.equal(held.projection.currentPrice, '106');
  assert.equal(held.projection.favorableExtremePrice, '106');
});

test('REDUCE target-already-reached HOLD retains a trusted new high', () => {
  const proposal = { proposalId: 'volume-proposal-reduce-target-extreme' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: planned.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
    twinEvidence: twinForAction(planned.actionRequest, {
      bids: [{ price: '100', quantity: '0.01' }],
    }),
  }));
  assert.equal(reduced.disposition, 'SETTLED');
  assert.equal(reduced.projection.positionQuantity, '0.01');

  const satisfied = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: reduced.projection,
    authority: { riskActionClass: 'REDUCE' },
    market: { currentPrice: '110' },
    signals: { currentPrice: '110', exhaustion: 'PRESENT' },
  }));
  assert.equal(satisfied.disposition, 'HOLD');
  assert.deepEqual(satisfied.reasonCodes, ['REDUCTION_TARGET_ALREADY_REACHED']);
  assert.equal(satisfied.projection.currentPrice, '110');
  assert.equal(satisfied.projection.favorableExtremePrice, '110');
  assert.equal(satisfied.projection.reductionEpisodeRevision, reduced.projection.reductionEpisodeRevision);
});

test('only fresh matching market and signal observations can advance retained price protection truth', () => {
  const proposal = { proposalId: 'volume-proposal-observation-trust-extreme' };
  const opened = openProbe({ proposal });
  const trustedAtMs = NOW + 20;
  const trusted = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: trustedAtMs,
    current: opened.settled.projection,
    market: { currentPrice: '110' },
    signals: { currentPrice: '110', confirmation: 'PENDING' },
  }));
  assert.equal(trusted.disposition, 'HOLD');
  assert.equal(trusted.projection.currentPrice, '110');
  assert.equal(trusted.projection.favorableExtremePrice, '110');

  const assertPreserved = (result, reason) => {
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.ok(result.reasonCodes.includes(reason));
    assert.equal(result.projection.currentPrice, '110');
    assert.equal(result.projection.favorableExtremePrice, '110');
  };

  const staleAtMs = trustedAtMs + 6_000;
  const stale = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: staleAtMs,
    current: trusted.projection,
    market: {
      currentPrice: '120',
      observedAtMs: trustedAtMs,
      validUntilMs: trustedAtMs + 1_000,
    },
    signals: {
      currentPrice: '120',
      confirmation: 'PENDING',
      observedAtMs: trustedAtMs,
      validUntilMs: trustedAtMs + 1_000,
    },
  }));
  assertPreserved(stale, 'ACTIVE_MARKET_EVIDENCE_STALE');

  const futureAtMs = trustedAtMs + 20;
  const future = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: futureAtMs,
    current: trusted.projection,
    market: {
      currentPrice: '120',
      observedAtMs: futureAtMs + 1,
      validUntilMs: futureAtMs + 5_000,
    },
    signals: {
      currentPrice: '120',
      confirmation: 'PENDING',
      observedAtMs: futureAtMs + 1,
      validUntilMs: futureAtMs + 5_000,
    },
  }));
  assertPreserved(future, 'ACTIVE_MARKET_EVIDENCE_STALE');

  const mismatch = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: futureAtMs,
    current: trusted.projection,
    market: { currentPrice: '120' },
    signals: { currentPrice: '119', confirmation: 'PENDING' },
  }));
  assertPreserved(mismatch, 'ACTIVE_MARKET_SIGNAL_PRICE_MISMATCH');
});

test('projection validation rejects LONG and SHORT favorable extremes worse than retained current price', () => {
  const longProposal = { proposalId: 'volume-proposal-long-extreme-downgrade' };
  const longOpened = openProbe({ proposal: longProposal });
  const invalidLong = structuredClone(longOpened.settled.projection);
  invalidLong.favorableExtremePrice = '99';
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: longProposal,
    current: invalidLong,
  })), /favorable extreme cannot be worse than the retained current price/u);

  const shortProposal = {
    direction: 'SHORT',
    proposalId: 'volume-proposal-short-extreme-downgrade',
  };
  const shortOpened = openProbe({ proposal: shortProposal }, {
    bids: [{ price: '100', quantity: '0.02' }],
  });
  const invalidShort = structuredClone(shortOpened.settled.projection);
  invalidShort.favorableExtremePrice = '101';
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: shortProposal,
    current: invalidShort,
  })), /favorable extreme cannot be worse than the retained current price/u);
});

test('exhaustion reduces while reversal exits, and simultaneous triggers use fixed precedence', () => {
  const opened = openProbe();
  const exhausted = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  assert.equal(exhausted.actionRequest.kind, 'REDUCE');
  assert.equal(exhausted.actionRequest.requestedQuantity, '0.01');
  assert.equal(exhausted.primaryReasonCode, 'VOLUME_EXHAUSTION');

  const reversed = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { exhaustion: 'PRESENT', reversal: 'PRESENT', globalHalt: true },
  }));
  assert.equal(reversed.actionRequest.kind, 'EXIT');
  assert.deepEqual(reversed.reasonCodes.slice(0, 3), ['GLOBAL_HALT', 'VOLUME_REVERSAL', 'VOLUME_EXHAUSTION']);
});

for (const [name, signalOverride, reason] of [
  ['manual close', { manualClose: true }, 'MANUAL_CLOSE'],
  ['global halt', { globalHalt: true }, 'GLOBAL_HALT'],
  ['thesis invalidation', { thesisInvalidated: true }, 'THESIS_INVALIDATED'],
]) {
  test(`${name} remains visible but requires a current canonical EXIT recheck when Risk is blocked`, () => {
    const opened = openProbe();
    const result = evaluateVolumeLifecycle(lifecycleInput({
      current: opened.settled.projection,
      authority: { riskState: 'BLOCKED', approvalState: 'REVOKED' },
      signals: signalOverride,
    }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.equal(result.actionRequest, null);
    assert.equal(result.recoveryHandoff.kind, 'CANCEL_OR_REDUCE');
    assert.ok(result.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));
    assert.ok(result.reasonCodes.includes(reason));
  });
}

test('source degradation policy is revisioned and chooses REDUCE or EXIT exactly', () => {
  const reducePolicy = protectionPolicy({ sourceDegradationAction: 'REDUCE' });
  const reduceOpened = openProbe({ policy: reducePolicy });
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    current: reduceOpened.settled.projection,
    policy: reducePolicy,
    authority: { riskActionClass: 'REDUCE' },
    signals: { sourceState: 'STALE' },
  }));
  assert.equal(reduced.actionRequest.kind, 'REDUCE');
  assert.ok(reduced.reasonCodes.includes('SOURCE_DEGRADED_REDUCE'));

  const exitPolicy = protectionPolicy({ sourceDegradationAction: 'EXIT' });
  const exitOpened = openProbe({ policy: exitPolicy });
  const exited = evaluateVolumeLifecycle(lifecycleInput({
    current: exitOpened.settled.projection,
    policy: exitPolicy,
    authority: { riskActionClass: 'EXIT' },
    signals: { sourceState: 'STALE' },
  }));
  assert.equal(exited.actionRequest.kind, 'EXIT');
  assert.ok(exited.reasonCodes.includes('SOURCE_DEGRADED_EXIT'));
});

test('active protection revisions accept only tighten-only time/loss/trailing/cap changes', () => {
  const current = protectionPolicy();
  const tighter = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: current.policyRevision,
    effectiveFromMs: NOW,
    maximumHoldingMs: 50_000,
    maximumLossBps: 400,
    trailingActivationBps: 250,
    trailingDistanceBps: 150,
    maximumEvidenceAgeMs: 4_000,
    noRepeatWindowMs: 7_200_000,
    probeCumulativePpm: 150_000,
    confirmCumulativePpm: 400_000,
    fullCumulativePpm: 900_000,
    exhaustionReductionTargetPpm: 400_000,
    sourceDegradationAction: 'EXIT',
  });
  const accepted = evaluateVolumeProtectionRevision({
    current,
    proposed: tighter,
    evaluatedAtMs: NOW,
    positionActive: true,
  });
  assert.equal(accepted.state, 'ACCEPTED');
  assert.equal(accepted.favorableExtremeMustBePreserved, true);
  assert.equal(accepted.simulationAuthority, 'SYNTHETIC_FIXTURE');

  const wider = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: current.policyRevision,
    effectiveFromMs: NOW,
    maximumHoldingMs: 60_001,
    maximumLossBps: 501,
    trailingActivationBps: 301,
    trailingDistanceBps: 201,
    noRepeatWindowMs: 3_599_999,
    exhaustionReductionTargetPpm: 500_001,
  });
  const rejected = evaluateVolumeProtectionRevision({ current, proposed: wider, evaluatedAtMs: NOW, positionActive: true });
  assert.equal(rejected.state, 'REJECTED');
  for (const reason of [
    'TIME_STOP_WIDENED', 'LOSS_STOP_WIDENED', 'TRAILING_ACTIVATION_WIDENED',
    'TRAILING_DISTANCE_WIDENED', 'NO_REPEAT_WINDOW_NARROWED', 'EXHAUSTION_REDUCTION_WEAKENED',
  ]) assert.ok(rejected.reasonCodes.includes(reason), reason);
});

test('accepted policy revision projects onto the lifecycle without resetting the favorable extreme', () => {
  const currentPolicy = protectionPolicy();
  const opened = openProbe({ policy: currentPolicy });
  const favorable = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    policy: currentPolicy,
    market: { currentPrice: '104' },
    signals: { currentPrice: '104', confirmation: 'PENDING' },
  }));
  const proposedPolicy = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: currentPolicy.policyRevision,
    effectiveFromMs: NOW,
    maximumLossBps: 450,
  });
  const projected = projectVolumeProtectionRevision({
    projection: favorable.projection,
    occupancy: lifecycleInput({
      current: favorable.projection,
      evaluatedAtMs: favorable.projection.lastTransition.occurredAtMs,
    }).occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs: favorable.projection.lastTransition.occurredAtMs,
  });
  assert.equal(projected.decision.state, 'ACCEPTED');
  assert.equal(projected.projection.policyRevision, proposedPolicy.policyRevision);
  assert.equal(projected.projection.favorableExtremePrice, '104');
  assert.equal(projected.projection.lastTransition.primaryReasonCode, 'PROTECTION_POLICY_REVISION_ADOPTED');
});

test('protection projection requires the exact occupancy head and closed occupancy chronology', () => {
  const currentPolicy = protectionPolicy();
  const opened = openProbe({ policy: currentPolicy });
  const projection = opened.settled.projection;
  const evaluatedAtMs = projection.lastTransition.occurredAtMs;
  const occupancy = lifecycleInput({ current: projection, evaluatedAtMs }).occupancy;
  const proposedPolicy = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: currentPolicy.policyRevision,
    effectiveFromMs: evaluatedAtMs,
    maximumLossBps: 450,
  });
  const { projectionRevision: _revision, ...material } = projection;
  const forged = finalizeProjection({ ...material, favorableExtremePrice: '101' });
  assert.throws(() => projectVolumeProtectionRevision({
    projection: forged,
    occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs,
  }), /exact canonical projection head/u);

  const action = opened.planned.actionRequest;
  const futureHistory = {
    ...occupancy,
    priorActions: [{
      actionKey: action.actionKey,
      intentKey: action.intentKey,
      lifecycleId: action.lifecycleId,
      proposalId: action.proposalId,
      assessmentId: action.assessmentId,
      symbol: action.symbol,
      direction: action.direction,
      kind: action.kind,
      state: 'APPLIED',
      recordedAtMs: evaluatedAtMs + 1,
    }],
  };
  assert.throws(() => projectVolumeProtectionRevision({
    projection,
    occupancy: futureHistory,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs,
  }), /occupancy history exceeds its observation chronology/u);

  assert.throws(() => projectVolumeProtectionRevision({
    projection,
    occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs,
    diagnosticOnly: true,
  }), /closed schema/u);
});

test('policy content revisions are immutable and tampering fails validation', () => {
  const policy = protectionPolicy();
  assert.equal(validateVolumeProtectionPolicy(policy).policyRevision, policy.policyRevision);
  assert.throws(() => validateVolumeProtectionPolicy({ ...policy, maximumLossBps: 999 }), /revision does not match/u);
});

test('policy revision evaluation cannot move lifecycle chronology backwards', () => {
  const currentPolicy = protectionPolicy();
  const opened = openProbe({ policy: currentPolicy });
  const proposedPolicy = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: currentPolicy.policyRevision,
    effectiveFromMs: opened.settled.projection.lastTransition.occurredAtMs,
    maximumLossBps: 450,
  });
  assert.throws(() => projectVolumeProtectionRevision({
    projection: opened.settled.projection,
    occupancy: lifecycleInput({
      current: opened.settled.projection,
      evaluatedAtMs: opened.settled.projection.lastTransition.occurredAtMs,
    }).occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs: opened.settled.projection.lastTransition.occurredAtMs - 1,
  }), /regresses lifecycle chronology/u);
});

test('policy revision cannot supersede a pending action or create a mixed-policy projection', () => {
  const currentPolicy = protectionPolicy();
  const pending = planProbe({ policy: currentPolicy });
  const proposedPolicy = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: currentPolicy.policyRevision,
    effectiveFromMs: pending.projection.lastTransition.occurredAtMs,
    maximumLossBps: 450,
    probeCumulativePpm: 150_000,
  });
  assert.throws(() => projectVolumeProtectionRevision({
    projection: pending.projection,
    occupancy: lifecycleInput({
      current: pending.projection,
      evaluatedAtMs: pending.projection.lastTransition.occurredAtMs,
    }).occupancy,
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs: pending.projection.lastTransition.occurredAtMs,
  }), /cannot supersede a pending action/u);

  const mixed = structuredClone(pending.projection);
  mixed.policyRevision = proposedPolicy.policyRevision;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    current: mixed,
    policy: proposedPolicy,
  })), /pending action policy/u);
});
