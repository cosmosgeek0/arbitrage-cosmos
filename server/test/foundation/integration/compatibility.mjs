#!/usr/bin/env node
/**
 * Section 20 lead-owned compatibility harness.
 *
 * The proof is deliberately test-only and uses fake ports, an injected clock,
 * synthetic evidence, and ledger-shaped values. It performs no I/O and wires
 * no production route or execution authority.
 */
import {
  LIVE_EXECUTION_BLOCK_CODE,
  validateStructuredFailure,
} from '../../../dist/foundation/contracts/index.js';
import {
  CONTROL_FAILURE_CODES,
  computeStartOrder,
} from '../../../dist/foundation/control/index.js';
import { buildCanonicalReadModel } from '../../../dist/foundation/readModel/index.js';
import {
  createExecutionCoordinator,
  recommendExecutionRecovery,
  restoreExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import { evaluateMultiLegRisk } from '../../../dist/foundation/risk/index.js';
import { reconcileExecutionState } from '../../../dist/foundation/reconciliation/index.js';
import { deriveDiagnostics } from '../../../dist/foundation/observability/index.js';
import {
  COMPAT_NOW,
  SECTION_20_FAILURE_KEYS,
  T0,
  FakeExecutionPorts,
  ManualClock,
  allowedRiskInput,
  boundaryFailure,
  canonicalReadModelInput,
  clone,
  createSupervisor,
  diagnosticsInput,
  engineDecision,
  engineProposal,
  engineSnapshot,
  exactReconciliationEvidence,
  executionPlanInput,
  issue,
  ledgerEventsFromExecution,
  managedComponent,
  section20FailureView,
} from '../fixtures/compatibility-fixtures.mjs';

const results = [];
const injections = new Set();
const surfacedFailures = [];

function check(name, pass, detail = '') {
  const ok = pass === true;
  results.push({ name, pass: ok });
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function requireOk(result, label) {
  if (!result.ok) throw new Error(`${label}: ${result.failure?.code ?? result.code ?? 'UNKNOWN_FAILURE'}`);
  return result.value ?? result.state ?? result;
}

function recordFailure(label, failure) {
  const issues = validateStructuredFailure(failure);
  check(`${label}: frozen StructuredFailure is valid`, issues.length === 0, issues.map((x) => `${x.path}:${x.code}`).join(','));
  const view = section20FailureView(failure);
  check(
    `${label}: section 20 fields are exact`,
    JSON.stringify(Object.keys(view)) === JSON.stringify(SECTION_20_FAILURE_KEYS),
    Object.keys(view).join(','),
  );
  check(`${label}: timestamp aliases occurredAt`, view.timestamp === failure.occurredAt);
  check(
    `${label}: safe state, action, and correlation are explicit`,
    typeof view.safeCurrentState === 'string'
      && view.safeCurrentState.length > 0
      && typeof view.recommendedOperatorAction === 'string'
      && view.recommendedOperatorAction.length > 0
      && typeof view.correlationId === 'string'
      && view.correlationId.length > 0,
  );
  surfacedFailures.push({ label, failure, view });
  return view;
}

function markInjection(number) {
  injections.add(number);
}

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalRandom = Math.random;
const originalSetTimeout = globalThis.setTimeout;
const originalSetInterval = globalThis.setInterval;
const originalSetImmediate = globalThis.setImmediate;
let networkAttempts = 0;
let timerAttempts = 0;
let randomAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error('network forbidden in compatibility proof');
};
Date.now = () => { throw new Error('wall clock forbidden in compatibility proof'); };
Math.random = () => {
  randomAttempts += 1;
  throw new Error('randomness forbidden in compatibility proof');
};
const forbidTimer = () => {
  timerAttempts += 1;
  throw new Error('timer forbidden in compatibility proof');
};
globalThis.setTimeout = forbidTimer;
globalThis.setInterval = forbidTimer;
globalThis.setImmediate = forbidTimer;

try {
  section('1. Happy path: control -> diagnostics');

  const market = managedComponent('marketData');
  const basis = managedComponent('basis', { dependsOn: ['marketData'] });
  const volume = managedComponent('volume', { dependsOn: ['marketData'] });
  const coordinatorReadiness = managedComponent('executionCoordinator', {
    dependsOn: ['basis', 'volume'],
  });
  const supervisor = createSupervisor({
    components: [coordinatorReadiness.component, volume.component, basis.component, market.component],
    gates: [
      { gate: 'config', blocking: true, run: () => ({ status: 'PASS', detail: 'synthetic config valid' }) },
      { gate: 'foundationPreflight', blocking: true, run: () => ({ status: 'PASS', detail: 'synthetic ports ready' }) },
    ],
  });
  const controlReceipt = issue(supervisor, 'START', 1, T0);
  check('control validation accepts the start command', controlReceipt.ok && controlReceipt.value.applied);
  check('control reaches observed RUNNING', supervisor.snapshot().phase === 'RUNNING');
  check('all control preflight gates pass', supervisor.snapshot().preflight.every((gate) => gate.status === 'PASS'));
  check(
    'dependency-ordered components validate and start once',
    [market, basis, volume, coordinatorReadiness].every(({ state }) => state.validateCalls === 1 && state.startCalls === 1),
  );

  const readResult = buildCanonicalReadModel(canonicalReadModelInput());
  check('Basis/Volume read model builds', readResult.ok);
  const readModel = requireOk(readResult, 'canonical read model');
  check(
    'Basis and Volume are independently ready',
    readModel.basis.freshness.state === 'FRESH'
      && readModel.volume.freshness.state === 'FRESH'
      && readModel.basis.presence === 'PRESENT'
      && readModel.volume.presence === 'PRESENT',
  );
  check('one canonical Basis proposal is available', readModel.basis.proposals.length === 1);
  const canonicalProposal = readModel.basis.proposals[0];
  check(
    'canonical proposal preserves Basis identity and authority',
    canonicalProposal.canonicalId.startsWith('cprop_')
      && canonicalProposal.source === 'BASIS'
      && canonicalProposal.observedAt.authority === 'SYNTHETIC_TEST',
  );

  const clock = new ManualClock(T0 + 100);
  const ports = new FakeExecutionPorts(clock);
  const coordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), clock, ports);
  const planned = coordinator.snapshot().plan;
  check('canonical proposal produces one deterministic PAPER plan', planned.mode === 'PAPER' && planned.proposal.canonicalProposalId === canonicalProposal.canonicalId);
  check('plan has independent SPOT and PERP opening legs', planned.openingLegs.SPOT.legId !== planned.openingLegs.PERP.legId);

  const riskInput = allowedRiskInput(planned, canonicalProposal);
  const riskVerdict = evaluateMultiLegRisk(riskInput);
  check('multi-leg risk verdict allows the synthetic plan', riskVerdict.allowed && riskVerdict.blockingCodes.length === 0);
  check(
    'risk verdict checks are bound to the exact plan',
    riskVerdict.checks.some((item) => item.code === 'APPROVAL_PRESENT' && item.observed === planned.planId),
  );
  const authorizeFakeRisk = (fakePorts, targetCoordinator, verdict = riskVerdict) => {
    fakePorts.authorizeRisk(targetCoordinator.snapshot().plan.planId, verdict);
  };
  authorizeFakeRisk(ports, coordinator);

  const executionPreflight = await coordinator.preflight();
  check('execution preflight is backed by the allowed risk verdict', executionPreflight.ok && coordinator.snapshot().preflight.status === 'PASSED' && ports.riskAuthorization?.verdict === riskVerdict && ports.riskAuthorization.planId === planned.planId);
  requireOk(coordinator.beginOpen(), 'begin open');
  const firstLeg = await coordinator.submitNextOpeningLeg();
  check(
    'simulated leg one fills before leg two',
    firstLeg.ok
      && coordinator.snapshot().openingLegs.SPOT.lifecycle === 'FILLED'
      && coordinator.snapshot().openingLegs.PERP.lifecycle === 'VALIDATED',
  );
  const secondLeg = await coordinator.submitNextOpeningLeg();
  check(
    'simulated leg two fills and aggregate becomes HEDGED_OPEN',
    secondLeg.ok
      && coordinator.snapshot().openingLegs.PERP.lifecycle === 'FILLED'
      && coordinator.snapshot().lifecycle === 'HEDGED_OPEN',
  );

  let reconciliationEvidence = null;
  let reconciliation = null;
  ports.reconciliationHandler = (state) => {
    reconciliationEvidence = exactReconciliationEvidence(state);
    reconciliation = reconcileExecutionState(
      state,
      reconciliationEvidence,
      COMPAT_NOW,
      { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 },
    );
    return reconciliation.status === 'EXACT'
      ? { kind: 'CLOSED' }
      : {
          kind: 'UNRESOLVED',
          failure: {
            code: 'RECONCILIATION_NOT_EXACT',
            message: 'Synthetic full reconciliation did not prove an exact close.',
            retryable: true,
            recommendedOperatorAction: 'Refresh synthetic evidence before closing the aggregate.',
          },
        };
  };
  const closeRequest = await coordinator.requestClose();
  check('close request is explicit before close submissions', closeRequest.ok && coordinator.snapshot().lifecycle === 'CLOSE_REQUESTED');
  const closeResult = await coordinator.close();
  check('simulated close reaches CLOSED', closeResult.ok && coordinator.snapshot().lifecycle === 'CLOSED');
  check(
    'all order-like calls remain PAPER and injected',
    ports.calls.filter((call) => call.method === 'submitPaper').length === 4
      && ports.calls.filter((call) => call.method === 'submitPaper').every((call) => call.request.mode === 'PAPER'),
  );

  const closedState = coordinator.snapshot();
  check('full reconciliation causally closes the coordinator', reconciliation !== null && reconciliation.status === 'EXACT' && reconciliation.recommendation === 'NO_ACTION' && ports.calls.some((call) => call.method === 'reconcile'));
  check('reconciliation carries data-only authority', reconciliation?.executionAuthority === 'NONE');

  const ledgerEvents = ledgerEventsFromExecution(closedState);
  check('execution stream projects to ledger-shaped events', ledgerEvents.length > 0 && ledgerEvents.every((event) => Number.isSafeInteger(event.id) && Number.isSafeInteger(event.ts) && typeof event.kind === 'string' && event.symbol === planned.symbol));
  check('ledger-shaped projection preserves event sequence', ledgerEvents.every((event, index) => event.data.sequence === index + 1));
  check('ledger-shaped projection preserves plan correlation', ledgerEvents.every((event) => event.data.correlationId === planned.correlationId));
  check('ledger-shaped projection preserves type-specific evidence', ledgerEvents.some((event) => event.kind === 'LEG_FILLED' && event.data.legKey === 'SPOT' && event.data.cumulativeFilledQuantity === 1));

  const diagnostics = deriveDiagnostics(diagnosticsInput(supervisor.snapshot(), readModel, ledgerEvents));
  check('diagnostic envelope derives from the completed chain', diagnostics.ok);
  const diagnosticEnvelope = requireOk(diagnostics, 'diagnostics');
  check('diagnostic snapshot is HEALTHY', diagnosticEnvelope.payload.overall.state === 'HEALTHY');
  check('diagnostics retain injected evaluation time', diagnosticEnvelope.createdAt === COMPAT_NOW && diagnosticEnvelope.payload.evaluatedAtMs === COMPAT_NOW);

  section('2. Injection matrix: dependency, freshness, timestamp, preflight, controls');

  markInjection(1);
  const orphan = managedComponent('orphan', { dependsOn: ['missingParent'] });
  let missingDependencyRejected = false;
  try {
    computeStartOrder([orphan.component]);
  } catch (error) {
    missingDependencyRejected = error instanceof TypeError;
  }
  check('1 missing dependency is rejected during control validation', missingDependencyRejected);
  recordFailure('1 missing dependency', boundaryFailure({
    component: 'foundation.control.plan',
    stage: 'validate-dependencies',
    code: 'MISSING_DEPENDENCY',
    message: 'A managed component references a dependency absent from the injected graph.',
    safeCurrentState: 'NOT_STARTED',
    recommendedOperatorAction: 'Provide the missing component or remove the invalid dependency edge.',
  }));

  markInjection(2);
  const staleReadResult = buildCanonicalReadModel(canonicalReadModelInput({
    nowMs: T0 + 10_000,
    basis: engineSnapshot('engine.basis.stale', {
      snapshotTimeMs: T0,
      receivedAtMs: T0,
      maxAgeMs: 100,
      decisions: [engineDecision()],
      proposals: [engineProposal()],
    }),
    volume: engineSnapshot('engine.volume.fresh', {
      snapshotTimeMs: T0 + 9_900,
      receivedAtMs: T0 + 9_950,
      maxAgeMs: 500,
      decisions: [engineDecision({ correlationId: 'cor_volume_still_fresh', direction: 'long' })],
    }),
  }));
  const staleRead = requireOk(staleReadResult, 'stale read-model injection');
  check('2 stale Basis is unavailable without hiding fresh Volume', staleRead.basis.freshness.state === 'STALE' && staleRead.basis.freshness.effectiveAuthority === 'UNAVAILABLE' && staleRead.volume.freshness.state === 'FRESH');
  recordFailure('2 stale market data', boundaryFailure({
    component: 'foundation.readModel',
    stage: 'freshness:basis',
    code: 'STALE_MARKET_DATA',
    message: 'Basis evidence exceeded its declared age budget.',
    retryable: true,
    safeCurrentState: 'BASIS_UNAVAILABLE_VOLUME_USABLE',
    recommendedOperatorAction: 'Refresh the Basis source before creating an execution plan.',
  }));

  markInjection(3);
  const malformedReadResult = buildCanonicalReadModel(canonicalReadModelInput({
    basis: engineSnapshot('engine.basis.malformed', {
      decisions: [engineDecision({ ts: T0 + 0.5 })],
      proposals: [],
    }),
  }));
  const malformedRead = requireOk(malformedReadResult, 'malformed timestamp injection');
  const malformedReject = malformedRead.basis.rejects.find((reject) => reject.code === 'MALFORMED_TIMESTAMP');
  check('3 malformed timestamp is rejected while Volume survives', malformedReject !== undefined && malformedRead.volume.decisions.length === 1);
  recordFailure('3 malformed timestamp', boundaryFailure({
    component: 'foundation.readModel',
    stage: 'canonicalize:basis-decision',
    code: malformedReject?.code ?? 'MALFORMED_TIMESTAMP',
    message: 'A source record supplied a non-integer UTC timestamp.',
    safeCurrentState: 'RECORD_REJECTED_OTHER_SOURCE_USABLE',
    recommendedOperatorAction: 'Correct the source timestamp and rebuild the read model.',
  }));

  markInjection(4);
  const timedWorker = managedComponent('timedWorker');
  const timedSupervisor = createSupervisor({
    components: [timedWorker.component],
    gateTimeoutMs: 4,
    gates: [{ gate: 'slowPreflight', blocking: true, run: () => ({ status: 'PENDING' }) }],
  });
  issue(timedSupervisor, 'START', 1, T0);
  timedSupervisor.tick(T0 + 4);
  const timeoutFailure = timedSupervisor.snapshot().lastError;
  check('4 preflight timeout blocks at the exact gate', timedSupervisor.snapshot().phase === 'BLOCKED' && timedSupervisor.snapshot().blockedAtGate === 'slowPreflight' && timeoutFailure?.code === CONTROL_FAILURE_CODES.PREFLIGHT_GATE_TIMEOUT);
  recordFailure('4 preflight timeout', timeoutFailure);

  markInjection(5);
  const riskyComponent = managedComponent('riskIncreasingWorker', { riskIncreasing: true });
  const killedSupervisor = createSupervisor({
    components: [riskyComponent.component],
    environment: { privateKeysAvailable: true, killSwitchEngaged: true, borrowTruthPresent: true },
  });
  issue(killedSupervisor, 'START', 1, T0);
  const killFailure = killedSupervisor.snapshot().lastError;
  check('5 kill switch blocks risk-increasing startup', killedSupervisor.snapshot().phase === 'BLOCKED' && riskyComponent.state.startCalls === 0 && killFailure?.code === CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED);
  recordFailure('5 kill switch', killFailure);

  section('3. Injection matrix: risk and leg outcomes');

  markInjection(6);
  const rejectedRiskInput = clone(riskInput);
  rejectedRiskInput.policy.maxGrossNotionalUsd = 100;
  const rejectedRisk = evaluateMultiLegRisk(rejectedRiskInput);
  check('6 risk rejection is fail-closed with named blockers', !rejectedRisk.allowed && rejectedRisk.blockingCodes.length > 0, rejectedRisk.blockingCodes.join(','));
  const rejectedRiskClock = new ManualClock(T0 + 100);
  const rejectedRiskPorts = new FakeExecutionPorts(rejectedRiskClock);
  const riskBlockedCoordinator = createExecutionCoordinator(
    executionPlanInput(canonicalProposal),
    rejectedRiskClock,
    rejectedRiskPorts,
  );
  authorizeFakeRisk(rejectedRiskPorts, riskBlockedCoordinator, rejectedRisk);
  const riskBlockedPreflight = await riskBlockedCoordinator.preflight();
  check(
    '6 rejected risk verdict blocks coordinator before submission',
    !riskBlockedPreflight.ok
      && riskBlockedPreflight.failure.code === 'RISK_REJECTED'
      && riskBlockedCoordinator.snapshot().lifecycle === 'FAILED'
      && !rejectedRiskPorts.calls.some((call) => call.method === 'submitPaper'),
  );
  check('6 risk preflight failure names final FAILED state', !riskBlockedPreflight.ok && riskBlockedPreflight.failure.safeCurrentState === riskBlockedCoordinator.snapshot().lifecycle);
  recordFailure('6 risk rejection', riskBlockedPreflight.failure);

  markInjection(7);
  const firstRejectClock = new ManualClock(T0 + 100);
  const firstRejectPorts = new FakeExecutionPorts(firstRejectClock).queueSubmission('OPEN:SPOT', {
    kind: 'REJECTED',
    failure: {
      code: 'FIRST_LEG_REJECTED',
      message: 'Synthetic first leg rejected.',
      retryable: false,
      recommendedOperatorAction: 'Inspect the validation evidence before replanning.',
    },
  });
  const firstRejectCoordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), firstRejectClock, firstRejectPorts);
  authorizeFakeRisk(firstRejectPorts, firstRejectCoordinator);
  requireOk(await firstRejectCoordinator.preflight(), 'first-leg rejection preflight');
  const firstRejected = await firstRejectCoordinator.open();
  check('7 first-leg rejection stops before the second leg', !firstRejected.ok && firstRejected.failure.code === 'FIRST_LEG_REJECTED' && firstRejectCoordinator.snapshot().lifecycle === 'FAILED' && !firstRejectPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));
  check('7 first-leg failure names final FAILED state', !firstRejected.ok && firstRejected.failure.safeCurrentState === firstRejectCoordinator.snapshot().lifecycle);
  recordFailure('7 first-leg rejection', firstRejected.failure);

  markInjection(8);
  const partialClock = new ManualClock(T0 + 100);
  const partialPorts = new FakeExecutionPorts(partialClock)
    .queueSubmission('OPEN:SPOT', {
      kind: 'PARTIALLY_FILLED',
      venueOrderId: 'paper-partial-spot',
      cumulativeFilledQuantity: 0.4,
    })
    .queueSubmission('OPEN:PERP', {
      kind: 'FILLED',
      venueOrderId: 'paper-scaled-perp',
      cumulativeFilledQuantity: 0.4,
    });
  const partialCoordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), partialClock, partialPorts);
  authorizeFakeRisk(partialPorts, partialCoordinator);
  requireOk(await partialCoordinator.preflight(), 'partial-fill preflight');
  const partialResult = await partialCoordinator.open();
  const partialRecovery = recommendExecutionRecovery(partialCoordinator.snapshot(), T0 + 100);
  check('8 first-leg partial fill never claims fully hedged completion', partialResult.ok && partialCoordinator.snapshot().lifecycle === 'ONE_LEG_EXPOSED');
  check('8 second leg is scaled to evidence-backed first fill', partialPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP' && call.request.leg.quantity === 0.4));
  check('8 partial remainder has explicit risk-reducing recovery', partialRecovery.some((item) => item.action === 'CANCEL_REMAINDER' || item.action === 'HEDGE_RESIDUAL'));

  markInjection(9);
  const secondRejectClock = new ManualClock(T0 + 100);
  const secondRejectPorts = new FakeExecutionPorts(secondRejectClock)
    .queueSubmission('OPEN:SPOT', { kind: 'FILLED', venueOrderId: 'paper-first-filled', cumulativeFilledQuantity: 1 })
    .queueSubmission('OPEN:PERP', {
      kind: 'REJECTED',
      failure: {
        code: 'SECOND_LEG_REJECTED',
        message: 'Synthetic second leg rejected.',
        retryable: false,
        recommendedOperatorAction: 'Use only an authorized risk-reducing recovery.',
      },
    });
  const secondRejectCoordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), secondRejectClock, secondRejectPorts);
  authorizeFakeRisk(secondRejectPorts, secondRejectCoordinator);
  requireOk(await secondRejectCoordinator.preflight(), 'second-leg rejection preflight');
  const secondRejected = await secondRejectCoordinator.open();
  check('9 second-leg rejection preserves first-leg exposure', !secondRejected.ok && secondRejected.failure.code === 'SECOND_LEG_REJECTED' && secondRejectCoordinator.snapshot().lifecycle === 'ONE_LEG_EXPOSED' && secondRejectCoordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1);
  check('9 second-leg failure names retained exposure state', !secondRejected.ok && secondRejected.failure.safeCurrentState === secondRejectCoordinator.snapshot().lifecycle);
  recordFailure('9 second-leg rejection', secondRejected.failure);

  markInjection(10);
  const ambiguousClock = new ManualClock(T0 + 100);
  const ambiguousPorts = new FakeExecutionPorts(ambiguousClock)
    .queueSubmission('OPEN:SPOT', {
      kind: 'AMBIGUOUS',
      failure: {
        code: 'ACKNOWLEDGEMENT_AMBIGUOUS',
        message: 'Synthetic acknowledgement was lost.',
        retryable: true,
        recommendedOperatorAction: 'Query by deterministic client-order ID; do not resubmit.',
      },
    })
    .queueLookup('OPEN:SPOT', {
      kind: 'UNRESOLVED',
      failure: {
        code: 'LOOKUP_UNRESOLVED',
        message: 'Synthetic lookup remains unresolved.',
        retryable: true,
        recommendedOperatorAction: 'Retry only the read-only lookup.',
      },
    });
  const ambiguousCoordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), ambiguousClock, ambiguousPorts);
  authorizeFakeRisk(ambiguousPorts, ambiguousCoordinator);
  requireOk(await ambiguousCoordinator.preflight(), 'ambiguous acknowledgement preflight');
  const ambiguousResult = await ambiguousCoordinator.open();
  check('10 ambiguous acknowledgement enters RECOVERY_REQUIRED', !ambiguousResult.ok && ambiguousCoordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && ambiguousCoordinator.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS');
  check('10 ambiguity blocks second risk-increasing submit', !ambiguousPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));
  check('10 ambiguity failure names final recovery state', !ambiguousResult.ok && ambiguousResult.failure.safeCurrentState === ambiguousCoordinator.snapshot().lifecycle);
  recordFailure('10 ambiguous acknowledgement', ambiguousResult.failure);

  section('4. Injection matrix: restart, deadlines, evidence, degraded intelligence, live block');

  markInjection(11);
  const restartClock = new ManualClock(T0 + 100);
  const restartPorts = new FakeExecutionPorts(restartClock);
  const beforeRestart = createExecutionCoordinator(executionPlanInput(canonicalProposal), restartClock, restartPorts);
  authorizeFakeRisk(restartPorts, beforeRestart);
  requireOk(await beforeRestart.preflight(), 'restart preflight');
  requireOk(beforeRestart.beginOpen(), 'restart begin open');
  requireOk(await beforeRestart.submitNextOpeningLeg(), 'restart first leg');
  const checkpoint = beforeRestart.checkpoint();
  const restoredResult = restoreExecutionCoordinator(checkpoint, restartClock, restartPorts);
  check('11 checkpoint restores the exact aggregate', restoredResult.ok && restoredResult.coordinator.snapshot().stateRevisionId === beforeRestart.snapshot().stateRevisionId);
  const restored = restoredResult.ok ? restoredResult.coordinator : null;
  const resumed = restored === null ? null : await restored.submitNextOpeningLeg();
  check('11 restart resumes at leg two without replaying leg one', resumed?.ok === true && restored.snapshot().lifecycle === 'HEDGED_OPEN' && restartPorts.calls.filter((call) => call.method === 'submitPaper' && call.request.leg.key === 'SPOT').length === 1);

  markInjection(12);
  const deadlineClock = new ManualClock(T0 + 100);
  const deadlinePorts = new FakeExecutionPorts(deadlineClock).queueSubmission('OPEN:SPOT', (request) => {
    deadlineClock.advance(1_000);
    return {
      kind: 'FILLED',
      venueOrderId: 'paper-delayed-first',
      cumulativeFilledQuantity: request.leg.quantity,
    };
  });
  const deadlineCoordinator = createExecutionCoordinator(executionPlanInput(canonicalProposal), deadlineClock, deadlinePorts);
  authorizeFakeRisk(deadlinePorts, deadlineCoordinator);
  requireOk(await deadlineCoordinator.preflight(), 'naked-duration preflight');
  const deadlineResult = await deadlineCoordinator.open();
  check('12 naked-duration exact expiry enters RECOVERY_REQUIRED', !deadlineResult.ok && deadlineResult.failure.code === 'NAKED_DURATION_EXPIRED' && deadlineCoordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED');
  check('12 deadline blocks second leg submission', !deadlinePorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));
  check('12 naked-duration failure names final recovery state', !deadlineResult.ok && deadlineResult.failure.safeCurrentState === deadlineCoordinator.snapshot().lifecycle);
  recordFailure('12 naked-duration expiry', deadlineResult.failure);

  markInjection(13);
  const incompleteEvidence = clone(reconciliationEvidence);
  incompleteEvidence.fills.metadata.completeness = 'PARTIAL';
  incompleteEvidence.fills.metadata.coverageStartMs = closedState.createdAtMs + 1;
  incompleteEvidence.fills.records[0].quantity = 0.4;
  const incompleteHistory = reconcileExecutionState(
    closedState,
    incompleteEvidence,
    COMPAT_NOW,
    { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 },
  );
  check('13 incomplete history is UNAVAILABLE, never exact', incompleteHistory.status === 'UNAVAILABLE' && incompleteHistory.recommendation === 'REFRESH' && incompleteHistory.reasons.some((reason) => reason.code === 'FILLS_HISTORY_INCOMPLETE'));
  recordFailure('13 incomplete history', boundaryFailure({
    component: 'foundation.reconciliation',
    stage: 'compare:fills-history',
    code: 'FILLS_HISTORY_INCOMPLETE',
    message: 'Observed fill history does not cover the execution aggregate horizon.',
    retryable: true,
    safeCurrentState: 'RECONCILIATION_UNAVAILABLE',
    recommendedOperatorAction: 'Refresh complete order, fill, and position history before acting.',
    correlationId: planned.correlationId,
  }));

  markInjection(14);
  const divergentEvidence = clone(reconciliationEvidence);
  divergentEvidence.positions.records[0].quantity = 0.25;
  divergentEvidence.positions.records[1].quantity = -0.25;
  const divergence = reconcileExecutionState(
    closedState,
    divergentEvidence,
    COMPAT_NOW,
    { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 },
  );
  check('14 reconciliation divergence is explicit and data-only', divergence.status === 'DIVERGED' && divergence.recommendation === 'CLOSE_POSITION' && divergence.executionAuthority === 'NONE');
  recordFailure('14 reconciliation divergence', boundaryFailure({
    component: 'foundation.reconciliation',
    stage: 'compare:positions',
    code: 'RECONCILIATION_DIVERGED',
    message: 'Observed venue position differs from the closed execution aggregate.',
    safeCurrentState: 'DIVERGED_NO_AUTOMATIC_ACTION',
    recommendedOperatorAction: 'Review the residual and authorize a separate risk-reducing action if appropriate.',
    correlationId: planned.correlationId,
  }));

  markInjection(15);
  const publicIntelligence = managedComponent('publicIntelligence');
  const privateEvidence = managedComponent('privateEvidence', { requiresPrivateKeys: true });
  const privateView = managedComponent('privateView', { dependsOn: ['privateEvidence'] });
  const keylessSupervisor = createSupervisor({
    components: [privateView.component, privateEvidence.component, publicIntelligence.component],
    environment: { privateKeysAvailable: false, killSwitchEngaged: false, borrowTruthPresent: true },
  });
  issue(keylessSupervisor, 'START', 1, T0);
  check('15 private data unavailable leaves intelligence usable', keylessSupervisor.snapshot().phase === 'RUNNING' && keylessSupervisor.startedComponents().join('|') === 'publicIntelligence');
  check('15 private component and dependent are explicitly excluded', keylessSupervisor.excludedComponents().has('privateEvidence') && keylessSupervisor.excludedComponents().has('privateView'));

  markInjection(16);
  const liveWorker = managedComponent('liveWorker');
  const liveSupervisor = createSupervisor({
    components: [liveWorker.component],
    runMode: 'EXECUTION_LIVE',
  });
  issue(liveSupervisor, 'START', 1, T0);
  const liveFailure = liveSupervisor.snapshot().lastError;
  check('16 live-execution attempt is blocked before component validation', liveSupervisor.snapshot().phase === 'BLOCKED' && liveSupervisor.snapshot().blockedAtGate === 'runMode' && liveFailure?.code === LIVE_EXECUTION_BLOCK_CODE && liveWorker.state.validateCalls === 0);
  recordFailure('16 live execution blocked', liveFailure);

  section('5. Cross-cutting compatibility and safety proof');

  const missingRiskClock = new ManualClock(T0 + 100);
  const missingRiskPorts = new FakeExecutionPorts(missingRiskClock);
  const missingRiskCoordinator = createExecutionCoordinator(
    executionPlanInput(canonicalProposal),
    missingRiskClock,
    missingRiskPorts,
  );
  const missingRisk = await missingRiskCoordinator.preflight();
  check('risk preflight fails closed when no verdict is supplied', !missingRisk.ok && missingRisk.failure.code === 'RISK_VERDICT_MISSING' && missingRisk.failure.safeCurrentState === 'FAILED' && !missingRiskPorts.calls.some((call) => call.method === 'submitPaper'));
  recordFailure('risk verdict missing', missingRisk.failure);

  const mismatchedRiskClock = new ManualClock(T0 + 100);
  const mismatchedRiskPorts = new FakeExecutionPorts(mismatchedRiskClock);
  const mismatchedRiskCoordinator = createExecutionCoordinator(
    executionPlanInput(canonicalProposal),
    mismatchedRiskClock,
    mismatchedRiskPorts,
  );
  mismatchedRiskPorts.authorizeRisk('plan_intentionally_mismatched', riskVerdict);
  const mismatchedRisk = await mismatchedRiskCoordinator.preflight();
  check('risk preflight rejects a verdict bound to another plan', !mismatchedRisk.ok && mismatchedRisk.failure.code === 'RISK_VERDICT_PLAN_MISMATCH' && mismatchedRisk.failure.safeCurrentState === 'FAILED' && !mismatchedRiskPorts.calls.some((call) => call.method === 'submitPaper'));
  recordFailure('risk verdict plan mismatch', mismatchedRisk.failure);

  const expiredRiskClock = new ManualClock(T0 + 100);
  const expiredRiskPorts = new FakeExecutionPorts(expiredRiskClock);
  const expiredRiskCoordinator = createExecutionCoordinator(
    executionPlanInput(canonicalProposal),
    expiredRiskClock,
    expiredRiskPorts,
  );
  authorizeFakeRisk(expiredRiskPorts, expiredRiskCoordinator, riskVerdict);
  expiredRiskClock.set(riskVerdict.expiresAt);
  const expiredRisk = await expiredRiskCoordinator.preflight();
  check('risk preflight rejects a verdict at its exact expiry', !expiredRisk.ok && expiredRisk.failure.code === 'RISK_VERDICT_EXPIRED' && expiredRisk.failure.occurredAt === expiredRiskClock.nowMs() && expiredRisk.failure.safeCurrentState === 'FAILED' && !expiredRiskPorts.calls.some((call) => call.method === 'submitPaper'));
  recordFailure('risk verdict expired', expiredRisk.failure);

  check('all 16 required injections executed', injections.size === 16 && [...injections].every((number, index) => number === index + 1), [...injections].join(','));
  check('all surfaced failures retain frozen contract form', surfacedFailures.length === 16 && surfacedFailures.every(({ failure }) => validateStructuredFailure(failure).length === 0));
  check('all surfaced failures expose section 20 timestamp view', surfacedFailures.every(({ failure, view }) => view.timestamp === failure.occurredAt && Object.keys(view).length === SECTION_20_FAILURE_KEYS.length));
  check('test attempted no network request', networkAttempts === 0);
  check('test attempted no wall-clock timer', timerAttempts === 0);
  check('test attempted no ambient randomness', randomAttempts === 0);
  check('fake execution boundary has no live order method', !Object.getOwnPropertyNames(FakeExecutionPorts.prototype).some((name) => /live|placeOrder|withdraw|transfer/i.test(name)));
  check('all order-like calls use submitPaper', [ports, rejectedRiskPorts, firstRejectPorts, partialPorts, secondRejectPorts, ambiguousPorts, restartPorts, deadlinePorts, missingRiskPorts, mismatchedRiskPorts, expiredRiskPorts].every((fake) => fake.calls.filter((call) => call.method.startsWith('submit')).every((call) => call.method === 'submitPaper')));
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  Math.random = originalRandom;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.setInterval = originalSetInterval;
  globalThis.setImmediate = originalSetImmediate;
}

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} compatibility checks passed`);
if (failed > 0) process.exit(1);
