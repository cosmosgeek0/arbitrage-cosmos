import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
} from '../../../dist/systemIntegration/contracts/constants.js';
import {
  createSystemExecutionClock,
  ValidateOnlyOrchestrator,
} from '../../../dist/systemIntegration/verticalSlice/index.js';
import {
  createExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import {
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  InMemoryValidateOnlyPersistence,
  NOW,
  SYMBOL,
  buildValidateOnlyInput,
  clone,
  refreshSyntheticRiskIntentBindings,
  replaceApprovalConfigRevision,
  replaceCapitalApproval,
} from './fixtures.mjs';
import { installEgressTripwire } from '../fixtures/egress-tripwire.mjs';

async function run(input = buildValidateOnlyInput()) {
  const persistence = new InMemoryValidateOnlyPersistence();
  const result = await new ValidateOnlyOrchestrator(persistence).execute(input);
  return { result, persistence };
}

test('system execution deadline clock records timeout evidence at its declared deadline', async () => {
  let scheduled = null;
  const timer = {
    schedule(delayMs, task) {
      scheduled = { delayMs, task, cancelled: false };
      return { cancel: () => { scheduled.cancelled = true; } };
    },
  };
  const clock = createSystemExecutionClock(NOW, timer);
  const ports = paperPorts();
  let declaredDeadline = null;
  ports.preflight = async (_plan, context) => {
    declaredDeadline = context.deadlineAtMs;
    return new Promise(() => {});
  };
  const coordinator = createExecutionCoordinator({
    strategy: 'BASIS', direction: 'LONG_SPOT_SHORT_PERP', symbol: SYMBOL,
    proposal: { canonicalProposalId: 'cprop-system-clock-timeout', observedAtMs: NOW - 100, maxAgeMs: 10_000, expiresAtMs: NOW + 60_000 },
    attempt: 0, mode: 'PAPER', requiresApproval: false, maxNakedDurationMs: 5_000,
    spotQuantity: 1, perpQuantity: 1,
  }, clock, ports, { portTimeoutMs: 25 });
  const pending = coordinator.preflight();
  assert.equal(scheduled?.delayMs, 25);
  scheduled.task();
  const timedOut = await pending;
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.failure.code, 'PREFLIGHT_PORT_TIMEOUT');
  assert.equal(declaredDeadline, NOW + 25);
  assert.ok(timedOut.failure.occurredAt >= declaredDeadline);
});

test('[SC-11] stale account truth blocks before coordinator and never mutates owner reservation', async () => {
  const input = buildValidateOnlyInput();
  const reservationBefore = JSON.stringify(input.capital.reservation);
  input.riskEvidence.account.permissions.observedAt.sourceTimeMs = NOW - 10_000;
  input.riskEvidence.account.permissions.observedAt.receivedAtMs = NOW - 10_000;
  input.riskEvidence.account.permissions.observedAt.maxAgeMs = 100;
  const { result } = await run(input);
  assert.equal(result.ok, false, 'SC-11 invariant=STALE_ACCOUNT_BLOCKS');
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 1);
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  assert.equal(JSON.stringify(input.capital.reservation), reservationBefore, 'SC-11 invariant=RESERVATION_UNCHANGED');
});

test('recorded or live private/account evidence cannot be mislabeled SYNTHETIC_ONLY', async () => {
  for (const authority of ['RECORDED_REPLAY', 'LIVE_PRIVATE']) {
    const input = buildValidateOnlyInput();
    input.riskEvidence.account.permissions.observedAt.authority = authority;
    const { result } = await run(input);
    assert.equal(result.snapshot.disposition, 'INPUT_REJECTED', authority);
    assert.equal(result.snapshot.failure.code, 'SYNTHETIC_ONLY_EVIDENCE_REQUIRED', authority);
    assert.deepEqual(result.snapshot.truthLabels, ['UNAVAILABLE', 'SYNTHETIC_ONLY']);
    assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 0);
  }
});

test('unknown account truth remains visibly unavailable after deterministic risk evaluation', async () => {
  const input = buildValidateOnlyInput();
  input.riskEvidence.account = null;
  const { result } = await run(input);
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.ok(result.snapshot.riskVerdict.checks.some((check) => check.status === 'UNKNOWN'));
  assert.equal(result.snapshot.riskVerdict.decision, 'NEEDS_REVIEW');
  assert.equal(result.snapshot.riskVerdict.allowed, false);
  assert.equal(result.snapshot.riskVerdict.requiredConfirmation, true);
  assert.equal(result.snapshot.riskVerdict.maxAllowedSize, null);
  assert.equal(result.snapshot.riskVerdict.correlationId, input.correlationId);
  assert.deepEqual(
    result.snapshot.riskVerdict.decisiveInputSnapshot.checks.map((check) => check.code),
    result.snapshot.riskVerdict.blockingCodes,
  );
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0, 'review can never override execution authority');
  assert.deepEqual(result.snapshot.truthLabels, ['UNAVAILABLE', 'SYNTHETIC_ONLY']);
});

test('[SC-12] cross-bound mandate and reservation are rejected before owner authority calls', async () => {
  const input = buildValidateOnlyInput();
  input.capital.reservation.considerationId = 'other-consideration';
  const { result } = await run(input);
  assert.equal(result.ok, false, 'SC-12 invariant=CROSS_BINDING_REJECTED');
  assert.equal(result.snapshot.disposition, 'INPUT_REJECTED');
  assert.equal(result.snapshot.ownerInvocations.approvalEvaluations, 0);
  assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 0);
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
});

test('an invalid Capital dialect is reported unavailable and never upgraded to wired truth', async () => {
  const input = buildValidateOnlyInput();
  input.capital.reservationDialect.owner = 'FORGED_OWNER';
  const { result } = await run(input);
  assert.equal(result.snapshot.disposition, 'INPUT_REJECTED');
  assert.equal(result.snapshot.capitalReservationDialect, 'UNAVAILABLE_OR_UNVALIDATED');
  assert.deepEqual(result.snapshot.truthLabels, ['UNAVAILABLE', 'SYNTHETIC_ONLY']);
  assert.ok(result.snapshot.releaseStatuses.includes('BLOCKED'));
  assert.equal(result.snapshot.releaseStatuses.includes('WIRED'), false);
});

test('[SC-13] exact scoped VALIDATE_ONLY approval reaches risk exactly once', async () => {
  const { result, persistence } = await run();
  assert.equal(result.ok, true, result.snapshot.failure?.code);
  assert.equal(result.snapshot.disposition, 'READY');
  assert.equal(result.snapshot.approvalDecision.mode, 'VALIDATE_ONLY');
  assert.equal(result.snapshot.approvalDecision.allowedForExternalRiskEvaluation, true);
  assert.equal(result.snapshot.approvalDecision.executionReady, false);
  assert.equal(result.snapshot.approvalDecision.requiresExternalExecutionOwner, false);
  assert.equal(result.snapshot.ownerInvocations.approvalEvaluations, 1);
  assert.equal(result.snapshot.ownerInvocations.approvalUseReductions, 1);
  assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 1, 'SC-13 invariant=RISK_CALLED_EXACTLY_ONCE');
  assert.equal(result.snapshot.approvalState.uses.length, 1);
  assert.equal(persistence.calls.length, 1, 'SC-13 invariant=TRACE_PERSISTED_ONCE');
  assert.equal([...persistence.records.values()][0].ownerInvocations.persistenceWrites, 1);
});

test('[SC-13] evidence payload cannot override integration-owned correlation, time, intent, proposal, or approval', async () => {
  const input = buildValidateOnlyInput();
  input.riskEvidence.correlationId = 'forged.risk.correlation';
  input.riskEvidence.nowMs = NOW + 999_999;
  input.riskEvidence.intent = null;
  input.riskEvidence.proposal = null;
  input.riskEvidence.approval = null;
  const { result } = await run(input);
  assert.equal(result.ok, true, result.snapshot.failure?.code);
  assert.equal(result.snapshot.riskVerdict.evaluatedAt, NOW);
  assert.equal(result.snapshot.riskVerdict.correlationId, input.correlationId);
  assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 1);
  assert.equal(
    result.snapshot.riskVerdict.checks.find((check) => check.code === 'APPROVAL_PRESENT')?.status,
    'PASS',
    'SC-13 invariant=RISK_AUTHORITY_FIELDS_DERIVED_BY_INTEGRATION',
  );
});

test('[SC-14] expiry, revocation, and binding revision mismatch stop before risk', async (t) => {
  const cases = [
    ['expired', (input) => replaceCapitalApproval(input, { expiresAtMs: NOW })],
    ['revoked', (input) => replaceCapitalApproval(input, {
      revokedAtMs: NOW - 1,
      revocationReasonReference: 'synthetic-revocation',
    })],
    ['mandate revision mismatch', (input) => replaceCapitalApproval(input, {
      mandateRevision: input.capital.approval.mandateRevision + 1,
    })],
    ['proposal revision mismatch', (input) => replaceCapitalApproval(input, {
      proposalRevision: 'forged-revision',
    })],
    ['config revision mismatch', (input) => replaceApprovalConfigRevision(input, 'cfg_forged_mismatch')],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const input = buildValidateOnlyInput();
      mutate(input);
      const { result } = await run(input);
      assert.equal(result.ok, false, `SC-14 invariant=${name}:REJECTED`);
      assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 0, `SC-14 invariant=${name}:RISK_NOT_CALLED`);
      assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
      assert.equal(result.snapshot.venueAudit.submissionCalls, 0);
    });
  }
});

test('malformed approval scope or posture is persistently rejected instead of escaping the boundary', async (t) => {
  const cases = [
    ['duplicate instrument', (input) => { input.approvalUse.instrumentIds.push(input.approvalUse.instrumentIds[0]); }],
    ['forged action class', (input) => { input.approvalUse.actionClass = 'FORGED_ACTION'; }],
    ['malformed control posture', (input) => { input.capital.controlPosture = {}; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const input = buildValidateOnlyInput();
      mutate(input);
      const { result, persistence } = await run(input);
      assert.equal(result.ok, false);
      assert.equal(result.snapshot.disposition, 'APPROVAL_REJECTED');
      assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 0);
      assert.equal(result.snapshot.ownerInvocations.persistenceWrites, 1);
      assert.equal(persistence.calls.length, 1);
    });
  }
});

test('[SC-15] canonical risk rejection creates no coordinator and performs zero submission calls', async () => {
  const input = buildValidateOnlyInput();
  input.riskEvidence.policy.minNetEdgePct = 0.9;
  const { result } = await run(input);
  assert.equal(result.ok, false, 'SC-15 invariant=RISK_REJECTED');
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.equal(result.snapshot.riskVerdict.allowed, false);
  assert.ok(result.snapshot.riskVerdict.blockingCodes.includes('NET_EDGE'));
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  assert.equal(result.snapshot.venueAudit.submissionCalls, 0, 'SC-15 invariant=ZERO_SUBMISSION_CALLS');
});

test('[SC-16] risk acceptance creates deterministic VALIDATE_ONLY legs and stops coordinator at READY', async () => {
  const tripwire = installEgressTripwire();
  const leftInput = buildValidateOnlyInput();
  const rightInput = buildValidateOnlyInput();
  let left;
  let right;
  try {
    left = await run(leftInput);
    right = await run(rightInput);
    tripwire.assertNoAttempts('SC-16 invariant=ZERO_NETWORK_EGRESS');
  } finally {
    tripwire.restore();
  }
  for (const { result } of [left, right]) {
    assert.equal(result.ok, true, result.snapshot.failure?.code);
    assert.equal(result.snapshot.executionPlan.mode, 'VALIDATE_ONLY');
    assert.equal(result.snapshot.executionState.lifecycle, 'READY');
    assert.equal(result.snapshot.executionState.preflight.status, 'PASSED');
    assert.equal(result.snapshot.executionPlan.openingLegs.SPOT.side, 'BUY');
    assert.equal(result.snapshot.executionPlan.openingLegs.PERP.side, 'SELL');
    assert.equal(result.snapshot.executionAuthority, 'NONE');
    assert.equal(result.snapshot.liveExecutionPermitted, false);
    assert.deepEqual(result.snapshot.truthLabels, ['DRY_RUN', 'SYNTHETIC_ONLY']);
    assert.equal(result.snapshot.venueAudit.sealed, true);
    assert.equal(result.snapshot.venueAudit.preflightCalls, 1);
    assert.equal(result.snapshot.venueAudit.validationCalls, 2);
    assert.equal(result.snapshot.venueAudit.submissionCalls, 0, 'SC-16 invariant=ZERO_SUBMISSION_CALLS');
  }
  assert.equal(left.result.snapshot.executionPlan.planId, right.result.snapshot.executionPlan.planId);
  assert.equal(left.result.snapshot.executionPlan.termsFingerprint, right.result.snapshot.executionPlan.termsFingerprint);
  assert.equal(left.result.snapshot.boundRiskDecision.mandateDigest, leftInput.capital.mandate.digest);
  assert.equal(left.result.snapshot.boundRiskDecision.externalPlanId, left.result.snapshot.executionPlan.planId);
  assert.equal(left.result.snapshot.boundRiskDecision.correlationId, left.result.snapshot.executionPlan.correlationId);
  assert.equal(left.result.snapshot.riskPlanBinding.planId, left.result.snapshot.executionPlan.planId);
  assert.equal(left.result.snapshot.riskPlanBinding.riskDecisionId, left.result.snapshot.boundRiskDecision.decisionId);
  assert.equal(left.result.snapshot.riskPlanBinding.foundationTermsFingerprint, left.result.snapshot.executionPlan.termsFingerprint);
  assert.equal(left.result.snapshot.riskPlanBinding.mandateDigest, leftInput.capital.mandate.digest);
});

test('integration binding distinguishes price/margin terms that Foundation plan geometry cannot encode', async () => {
  const baseInput = buildValidateOnlyInput();
  const changedInput = buildValidateOnlyInput();
  changedInput.executionTerms.spot.intendedPrice = 50;
  changedInput.executionTerms.spot.quoteNotional = '50';
  changedInput.executionTerms.perpetual.intendedPrice = 50;
  changedInput.executionTerms.perpetual.quoteNotional = '50';
  for (const leg of changedInput.riskEvidence.market.legs) leg.referencePrice = 50;
  changedInput.riskEvidence.account.liquidations[0].markPrice = 50;
  changedInput.riskEvidence.account.liquidations[0].liquidationPrice = 75;
  refreshSyntheticRiskIntentBindings(changedInput);
  const base = await run(baseInput);
  const changed = await run(changedInput);
  assert.equal(base.result.ok, true, base.result.snapshot.failure?.code);
  assert.equal(changed.result.ok, true, changed.result.snapshot.failure?.code);
  assert.equal(base.result.snapshot.executionPlan.planId, changed.result.snapshot.executionPlan.planId);
  assert.equal(base.result.snapshot.executionPlan.termsFingerprint, changed.result.snapshot.executionPlan.termsFingerprint);
  assert.notEqual(base.result.snapshot.riskPlanBinding.riskIntentDigest, changed.result.snapshot.riskPlanBinding.riskIntentDigest);
  assert.notEqual(base.result.snapshot.riskPlanBinding.executionTermsDigest, changed.result.snapshot.riskPlanBinding.executionTermsDigest);
});

test('persistence acknowledgement failure fail-closes an otherwise READY validation trace', async () => {
  const persistence = {
    async loadValidateOnlyApprovalState() { return null; },
    async persistValidateOnly() { throw new Error('synthetic durable-store failure'); },
  };
  const result = await new ValidateOnlyOrchestrator(persistence).execute(buildValidateOnlyInput());
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.disposition, 'PERSISTENCE_FAILED');
  assert.equal(result.snapshot.failure.code, 'PERSISTENCE_FAILED');
  assert.equal(result.snapshot.executionState.lifecycle, 'READY');
  assert.equal(result.snapshot.ownerInvocations.persistenceWrites, 1);
  assert.equal(result.snapshot.venueAudit.submissionCalls, 0);
  assert.ok(result.snapshot.releaseStatuses.includes('BLOCKED'));
  assert.equal(result.snapshot.releaseStatuses.includes('WIRED'), false);
});

test('validation persistence is idempotent per approval use and permits a distinct later use on the same root trace', async () => {
  const persistence = new InMemoryValidateOnlyPersistence();
  const orchestrator = new ValidateOnlyOrchestrator(persistence);
  const firstInput = buildValidateOnlyInput();
  const first = await orchestrator.execute(firstInput);
  const replayInput = buildValidateOnlyInput();
  replayInput.capital.approvalState = first.snapshot.approvalState;
  const replay = await orchestrator.execute(replayInput);
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(first.snapshot.recordId, replay.snapshot.recordId);
  assert.equal(persistence.records.size, 1);

  const conflictingReplayInput = buildValidateOnlyInput();
  conflictingReplayInput.capital.approvalState = first.snapshot.approvalState;
  conflictingReplayInput.riskEvidence.policy.minNetEdgePct = 0.9;
  const conflictingReplay = await orchestrator.execute(conflictingReplayInput);
  assert.equal(conflictingReplay.snapshot.disposition, 'PERSISTENCE_FAILED');
  assert.equal(persistence.records.size, 1, 'same approval-use key must not acquire conflicting durable meaning');

  const staleLaterUseInput = buildValidateOnlyInput();
  staleLaterUseInput.approvalUse.idempotencyKey = 'approval-use-system-validate-2';
  const staleLaterUse = await orchestrator.execute(staleLaterUseInput);
  assert.equal(staleLaterUse.snapshot.disposition, 'APPROVAL_REJECTED');
  assert.equal(staleLaterUse.snapshot.failure.code, 'APPROVAL_STATE_STALE');
  assert.equal(staleLaterUse.snapshot.ownerInvocations.approvalEvaluations, 0);
  assert.equal(staleLaterUse.snapshot.ownerInvocations.riskEvaluations, 0);
  assert.equal(persistence.records.size, 2);

  const laterUseInput = buildValidateOnlyInput();
  laterUseInput.capital.approvalState = first.snapshot.approvalState;
  laterUseInput.approvalUse.idempotencyKey = 'approval-use-system-validate-3';
  laterUseInput.riskEvidence.policy.minNetEdgePct = 0.9;
  const laterUse = await orchestrator.execute(laterUseInput);
  assert.equal(laterUse.snapshot.disposition, 'APPROVAL_REJECTED');
  assert.equal(laterUse.snapshot.failure.code, 'APPROVAL_CONTEXT_ALREADY_USED');
  assert.equal(laterUse.snapshot.ownerInvocations.riskEvaluations, 0);
  assert.equal(persistence.records.size, 3, 'distinct approval attempts remain on the same root correlation without record collision');
});

test('[SC-17] every live/manual/autonomous spelling hard-blocks owners and persists one bounded denial', async () => {
  const modeSpellings = [
    ...BLOCKED_EXECUTION_MODE_REQUESTS,
    ' live ',
    'production-live',
    'manual',
    'manual execution',
    'autonomous_v2',
  ];
  for (const [index, mode] of modeSpellings.entries()) {
    const input = buildValidateOnlyInput();
    input.requestedMode = mode;
    if (index === 0) {
      input.canonicalProposal = null;
      input.capital = null;
    }
    const { result, persistence } = await run(input);
    assert.equal(result.ok, false, mode);
    assert.equal(result.snapshot.failure.code, LIVE_EXECUTION_NOT_IMPLEMENTED, mode);
    assert.equal(result.snapshot.ownerInvocations.approvalEvaluations, 0, mode);
    assert.equal(result.snapshot.ownerInvocations.riskEvaluations, 0, mode);
    assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0, mode);
    assert.equal(result.snapshot.ownerInvocations.persistenceWrites, 1, mode);
    assert.equal(result.snapshot.venueAudit.submissionCalls, 0, mode);
    assert.equal(persistence.calls.length, 1, `SC-17 invariant=${mode}:ONE_BOUNDED_DENIAL`);
    const persisted = [...persistence.records.values()][0];
    assert.equal(persisted.failure.code, LIVE_EXECUTION_NOT_IMPLEMENTED, mode);
    assert.equal(persisted.ownerInvocations.persistenceWrites, 1, mode);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'requestedMode'), false, `${mode}: raw hostile mode must not be persisted`);
    if (index === 0) {
      assert.equal(persisted.capitalReservationDialect, 'UNAVAILABLE_OR_UNVALIDATED');
      assert.deepEqual(persisted.truthLabels, ['UNAVAILABLE', 'SYNTHETIC_ONLY']);
      assert.ok(persisted.releaseStatuses.includes('BLOCKED'));
      assert.equal(persisted.releaseStatuses.includes('WIRED'), false);
      assert.equal(persisted.canonicalProposalId, 'unavailable-mode-blocked');
      assert.equal(persisted.reservationId, 'unavailable-mode-blocked');
      assert.equal(persisted.approvalId, 'unavailable-mode-blocked');
    }
  }
});

test('[SC-17] separate blocked attempts on one root receive distinct non-sensitive event IDs', async () => {
  const persistence = new InMemoryValidateOnlyPersistence();
  const orchestrator = new ValidateOnlyOrchestrator(persistence);
  const live = buildValidateOnlyInput();
  live.requestedMode = 'LIVE';
  const autonomous = buildValidateOnlyInput();
  autonomous.requestedMode = 'AUTONOMOUS';
  autonomous.nowMs = NOW + 1;
  const first = await orchestrator.execute(live);
  const second = await orchestrator.execute(autonomous);
  assert.equal(first.snapshot.disposition, 'MODE_BLOCKED');
  assert.equal(second.snapshot.disposition, 'MODE_BLOCKED');
  assert.notEqual(first.snapshot.recordId, second.snapshot.recordId);
  assert.equal(persistence.records.size, 2);
  for (const persisted of persistence.records.values()) {
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'requestedMode'), false);
  }
});

test('[SC-18] kill switch blocks risk-increasing validation before coordinator creation', async () => {
  const input = buildValidateOnlyInput();
  input.riskEvidence.killSwitch.engaged = true;
  input.riskEvidence.killSwitch.reason = 'synthetic containment';
  const { result } = await run(input);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.ok(result.snapshot.riskVerdict.blockingCodes.includes('KILL_SWITCH'));
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  assert.equal(result.snapshot.venueAudit.submissionCalls, 0, 'SC-18 invariant=KILL_BLOCKS_NEW_EXPOSURE');
});

test('[SC-19] kill switch keeps existing supervision and risk-reducing reconciliation visible', async () => {
  const supervised = await paperState();
  const evidence = syntheticEvidenceForState(supervised);
  evidence.positions.records[0].quantity += 1;
  const input = buildValidateOnlyInput();
  input.riskEvidence.killSwitch.engaged = true;
  input.riskEvidence.killSwitch.reason = 'synthetic containment';
  input.supervision = {
    rootCorrelationId: 'prior-supervision-root',
    state: supervised,
    truthLabel: 'SYNTHETIC_ONLY',
    executionAuthority: 'NONE',
  };
  input.reconciliationEvidence = evidence;
  const { result } = await run(input);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.ok(result.snapshot.riskVerdict.blockingCodes.includes('KILL_SWITCH'));
  assert.equal(result.snapshot.reconciliation, null, 'current rejected entry must not absorb prior-plan reconciliation');
  assert.equal(result.snapshot.executionState, null, 'current rejected entry has no execution state');
  assert.equal(result.snapshot.supervision.rootCorrelationId, 'prior-supervision-root');
  assert.equal(result.snapshot.supervision.planId, supervised.plan.planId);
  assert.equal(result.snapshot.supervision.reconciliation.status, 'DIVERGED');
  assert.equal(result.snapshot.supervision.reconciliation.recommendation, 'HEDGE_RESIDUAL');
  assert.equal(result.snapshot.supervision.reconciliation.executionAuthority, 'NONE');
  assert.equal(result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  assert.equal(result.snapshot.ownerInvocations.reconciliationEvaluations, 1);
  assert.equal(result.snapshot.venueAudit.submissionCalls, 0, 'SC-19 invariant=SUPERVISION_WITHOUT_SUBMISSION');
});

test('malformed prior execution state is not persisted as typed supervision truth', async () => {
  const supervised = await paperState();
  const malformed = clone(supervised);
  malformed.openingLegs = null;
  const input = buildValidateOnlyInput();
  input.riskEvidence.killSwitch.engaged = true;
  input.supervision = {
    rootCorrelationId: 'prior-supervision-root',
    state: malformed,
    truthLabel: 'SYNTHETIC_ONLY',
    executionAuthority: 'NONE',
  };
  input.reconciliationEvidence = syntheticEvidenceForState(supervised);
  const { result, persistence } = await run(input);
  assert.equal(result.snapshot.disposition, 'RISK_REJECTED');
  assert.equal(result.snapshot.failure.code, 'SUPERVISION_RECONCILIATION_INVALID');
  assert.equal(result.snapshot.supervision, null);
  assert.equal([...persistence.records.values()][0].supervision, null);
});

test('[SC-21] divergent observed exposure blocks new exposure with a risk-reducing recommendation', async () => {
  const input = buildValidateOnlyInput();
  input.reconciliationEvidence.positions.records[0].quantity = 1;
  const { result } = await run(input);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot.disposition, 'RECONCILIATION_BLOCKED');
  assert.equal(result.snapshot.reconciliation.status, 'DIVERGED');
  assert.equal(result.snapshot.reconciliation.recommendation, 'HEDGE_RESIDUAL');
  assert.equal(result.snapshot.reconciliation.executionAuthority, 'NONE');
  assert.equal(result.snapshot.executionState.lifecycle, 'READY');
  assert.equal(result.snapshot.venueAudit.submissionCalls, 0, 'SC-19 invariant=SUPERVISION_WITHOUT_SUBMISSION');
});

function paperPorts(overrides = {}) {
  const claims = new Map();
  const calls = [];
  return {
    calls,
    claimPlanIdentity(planId, fingerprint) {
      const prior = claims.get(planId);
      if (prior === undefined) { claims.set(planId, fingerprint); return 'CLAIMED'; }
      return prior === fingerprint ? 'EXISTING_SAME' : 'CONFLICT';
    },
    async preflight() { return { ok: true }; },
    async validateLeg() { return { ok: true }; },
    async submitPaper(request) {
      calls.push(`${request.phase}:${request.leg.key}`);
      const selected = overrides[`${request.phase}:${request.leg.key}`];
      if (selected) return selected;
      return { kind: 'FILLED', venueOrderId: `paper-${request.phase}-${request.leg.key}`, cumulativeFilledQuantity: request.leg.quantity };
    },
    async lookupByClientOrderId() {
      return { kind: 'UNRESOLVED', failure: { code: 'LOOKUP_UNRESOLVED', message: 'fixture', retryable: false, recommendedOperatorAction: 'inspect fixture' } };
    },
    async reconcile() { return { kind: 'UNRESOLVED', failure: { code: 'RECONCILIATION_UNRESOLVED', message: 'fixture', retryable: false, recommendedOperatorAction: 'inspect fixture' } }; },
  };
}

async function paperState(overrides = {}) {
  const ports = paperPorts(overrides);
  const coordinator = createExecutionCoordinator({
    strategy: 'BASIS', direction: 'LONG_SPOT_SHORT_PERP', symbol: SYMBOL,
    proposal: { canonicalProposalId: `cprop-paper-${Object.keys(overrides).join('-') || 'exact'}`, observedAtMs: NOW - 100, maxAgeMs: 10_000, expiresAtMs: NOW + 60_000 },
    attempt: 0, mode: 'PAPER', requiresApproval: false, maxNakedDurationMs: 5_000,
    spotQuantity: 1, perpQuantity: 1,
  }, {
    nowMs: () => NOW,
    schedule: (delayMs, task) => {
      const deadline = { delayMs, task, cancelled: false };
      return { cancel: () => { deadline.cancelled = true; } };
    },
  }, ports);
  assert.equal((await coordinator.preflight()).ok, true);
  await coordinator.open();
  return coordinator.snapshot();
}

function syntheticEvidenceForState(state) {
  const metadata = {
    sourceId: 'paper.synthetic-reconciliation', authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE',
    sourceTimeMs: NOW, receivedAtMs: NOW, maxAgeMs: 5_000,
    coverageStartMs: state.createdAtMs, coverageEndMs: state.updatedAtMs,
  };
  const orders = [];
  const fills = [];
  for (const [phase, legs] of [['OPEN', state.openingLegs], ['CLOSE', state.closingLegs]]) {
    for (const key of ['SPOT', 'PERP']) {
      const leg = legs[key];
      if (leg.submittedQuantity <= 0 || leg.venueOrderId === null) continue;
      orders.push({
        venue: leg.definition.venue, symbol: state.plan.symbol, clientOrderId: leg.definition.clientOrderId,
        venueOrderId: leg.venueOrderId, side: leg.definition.side, originalQuantity: leg.submittedQuantity,
        cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
        status: leg.lifecycle === 'FILLED' ? 'FILLED' : leg.lifecycle === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED' : 'NEW',
        reduceOnly: leg.definition.reduceOnly, updatedAtMs: NOW,
      });
      if (leg.cumulativeFilledQuantity > 0) fills.push({
        venue: leg.definition.venue, symbol: state.plan.symbol, tradeId: `trade-${phase}-${key}`,
        clientOrderId: leg.definition.clientOrderId, venueOrderId: leg.venueOrderId, side: leg.definition.side,
        quantity: leg.cumulativeFilledQuantity, price: 100, occurredAtMs: NOW,
      });
    }
  }
  const signed = (side, qty) => side === 'BUY' ? qty : -qty;
  const delta = (key) => signed(state.openingLegs[key].definition.side, state.openingLegs[key].cumulativeFilledQuantity) +
    signed(state.closingLegs[key].definition.side, state.closingLegs[key].cumulativeFilledQuantity);
  return {
    orders: { metadata: clone(metadata), records: orders },
    fills: { metadata: clone(metadata), records: fills },
    positions: {
      metadata: { ...clone(metadata), coverageStartMs: null, coverageEndMs: null },
      records: [
        { venue: 'BINANCE_SPOT', symbol: state.plan.symbol, positionSide: 'NET', quantity: delta('SPOT'), baselineQuantity: 0, observedAtMs: NOW },
        { venue: 'BINANCE_USDM', symbol: state.plan.symbol, positionSide: 'BOTH', quantity: delta('PERP'), baselineQuantity: 0, observedAtMs: NOW },
      ],
    },
  };
}

test('synthetic helper coverage: partial and ambiguous states remain explicit data-only truth', async () => {
  const partial = await paperState({
    'OPEN:SPOT': { kind: 'PARTIALLY_FILLED', venueOrderId: 'paper-OPEN-SPOT', cumulativeFilledQuantity: 0.4 },
  });
  const partialResult = reconcileExecutionState(partial, syntheticEvidenceForState(partial), NOW, { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 });
  assert.equal(partialResult.status, 'DIVERGED');
  assert.equal(partialResult.executionAuthority, 'NONE');
  assert.notEqual(partialResult.recommendation, 'NO_ACTION', 'partial/one-leg truth must remain recovery-required');

  const ambiguous = await paperState({
    'OPEN:SPOT': {
      kind: 'AMBIGUOUS',
      failure: { code: 'RESPONSE_LOST', message: 'fixture', retryable: false, recommendedOperatorAction: 'inspect fixture' },
    },
  });
  const evidence = syntheticEvidenceForState(ambiguous);
  evidence.orders.records = [];
  evidence.fills.records = [];
  const ambiguousResult = reconcileExecutionState(ambiguous, evidence, NOW, { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 });
  assert.equal(ambiguousResult.status, 'AMBIGUOUS');
  assert.equal(ambiguousResult.recommendation, 'MANUAL_REVIEW');
  assert.equal(ambiguousResult.executionAuthority, 'NONE');
});
