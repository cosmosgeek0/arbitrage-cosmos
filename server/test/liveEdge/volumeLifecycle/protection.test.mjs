import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVolumeLifecycle,
  evaluateVolumeProtectionRevision,
  lossStopReached,
  projectVolumeProtectionRevision,
  trailingStopReached,
  validateVolumeProtectionPolicy,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
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
    currentPolicy,
    proposedPolicy,
    evaluatedAtMs: NOW,
  });
  assert.equal(projected.decision.state, 'ACCEPTED');
  assert.equal(projected.projection.policyRevision, proposedPolicy.policyRevision);
  assert.equal(projected.projection.favorableExtremePrice, '104');
  assert.equal(projected.projection.lastTransition.primaryReasonCode, 'PROTECTION_POLICY_REVISION_ADOPTED');
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
