import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { EgressTripwire } from '../fixtures/egress-tripwire.mjs';
import {
  assertExactlyOnce,
  assertNoDuplicateKeys,
  assertScenario,
  assertScenarioDeepEqual,
  assertScenarioEqual,
  scenarioTestName,
} from '../fixtures/assertions.mjs';

let world;
let egress;
const registeredScenarioIds = new Set();

before(async () => {
  egress = new EgressTripwire({ maximumAttempts: 256 }).install();
  world = await import('./world.mjs');
});

after(() => {
  let failure = null;
  try {
    assert.equal(registeredScenarioIds.size, 30, 'acceptance harness must register exactly 30 scenarios');
    assert.deepEqual(
      [...registeredScenarioIds].sort((left, right) => left - right),
      Array.from({ length: 30 }, (_, index) => index + 1),
      'acceptance harness must register SC-01 through SC-30 exactly once',
    );
    egress.assertNoAttempts('system-integration 30-scenario acceptance harness');
  } catch (error) {
    failure = error;
  } finally {
    egress?.restore();
  }
  if (failure) throw failure;
});

function scenario(number, title, run) {
  if (registeredScenarioIds.has(number)) throw new Error(`duplicate acceptance scenario SC-${number}`);
  registeredScenarioIds.add(number);
  test(scenarioTestName(number, title), { concurrency: false }, run);
}

scenario(1, 'clean cold start reaches managed readiness in dependency order', async () => {
  const persistence = world.createPersistenceWorld(1_800_000_000_000, { correlationId: 'sc01.persistence.load' });
  assertScenario('SC-01', 'PERSISTENCE_SHELL_LOADED', persistence.loaded.ok === true);
  const startup = persistence.adapter.persistStartup({
    startedAtMs: 1_800_000_000_000,
    correlationId: 'sc01.persistence.startup',
  });
  assertScenario('SC-01', 'PERSISTENCE_SHELL_STARTED_FIRST', startup.ok === true);

  const composed = world.createCompositionWorld();
  const started = await world.startCompositionReady(composed);
  assertScenario('SC-01', 'COMPOSITION_START_ACCEPTED', started.ok === true);
  assertScenarioEqual('SC-01', 'SUPERVISOR_RUNNING', composed.composition.read().supervisor.phase, 'RUNNING');
  assertScenarioDeepEqual('SC-01', 'DEPENDENCY_ORDER', composed.log.slice(0, 11), [
    'validate:market', 'validate:intelligence-runtime', 'validate:market-intelligence',
    'validate:basis', 'validate:volume',
    'init:market', 'start:market', 'start:intelligence-runtime', 'start:market-intelligence',
    'start:basis', 'start:volume',
  ]);
  assertScenarioDeepEqual('SC-01', 'MANAGED_COMPONENT_ORDER', composed.composition.read().componentOrder, [
    'market-universe', 'intelligence-runtime', 'market-intelligence', 'basis-engine', 'volume-engine',
  ]);
  assertScenarioEqual('SC-01', 'ONE_DRIVER', composed.scheduler.snapshot().activeTaskCount, 1);
});

scenario(2, 'public Spot unavailable while Futures remains live', () => {
  const spot = world.sourceProbe('public-spot-source', null);
  const futures = world.sourceProbe('public-usdm-source', world.sourceReading('usdm-public-source'));
  assertScenario('SC-02', 'BOTH_PROJECTIONS_EXIST', spot.ok && futures.ok);
  assertScenarioEqual('SC-02', 'SPOT_BLOCKED', spot.value.component.readiness, 'BLOCKED');
  assertScenarioEqual('SC-02', 'FUTURES_REMAINS_READY', futures.value.component.readiness, 'READY');
});

scenario(3, 'public Futures unavailable while Spot remains live', () => {
  const spot = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source'));
  const futures = world.sourceProbe('public-usdm-source', null);
  assertScenario('SC-03', 'BOTH_PROJECTIONS_EXIST', spot.ok && futures.ok);
  assertScenarioEqual('SC-03', 'SPOT_REMAINS_READY', spot.value.component.readiness, 'READY');
  assertScenarioEqual('SC-03', 'FUTURES_BLOCKED', futures.value.component.readiness, 'BLOCKED');
});

scenario(4, 'socket open but silent becomes degraded and stale', () => {
  for (const observedState of ['SILENT', 'STALE']) {
    const result = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source', {
      source: world.runtimeSource('spot-public-source', {
        observedState,
        lastMessageSourceTimeMs: world.NOW - 5_000,
        lastMessageReceiveTimeMs: world.NOW - 4_900,
        lastProcessedTimeMs: world.NOW - 4_800,
        messageAgeMs: 4_900,
      }),
    }));
    assertScenario('SC-04', `${observedState}_PROJECTED`, result.ok === true);
    assertScenarioEqual('SC-04', `${observedState}_DEGRADED`, result.value.component.readiness, 'DEGRADED');
    assertScenarioEqual('SC-04', `${observedState}_STALE`, result.value.component.freshness.state, 'STALE');
  }
});

scenario(5, 'sequence gap invalidates focused book and requests resync', () => {
  const result = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source', {
    source: world.runtimeSource('spot-public-source', {
      observedState: 'DEGRADED', sequenceGapCount: 1, completeness: 'PARTIAL',
    }),
    queue: { depth: 1, capacity: 100, dropped: 0, coalesced: 0, observedAtMs: world.NOW, resyncRequired: true },
    observation: world.observation({
      focusedBooks: [{
        sourceId: 'spot-depth-btc', symbol: 'BTCUSDT', sequenceComplete: false,
        pendingResyncRequestId: 'resync-btc-1', reasonCode: 'SEQUENCE_GAP',
      }],
    }),
  }));
  assertScenario('SC-05', 'GAP_PROJECTED', result.ok === true);
  assertScenarioEqual('SC-05', 'RESYNC_REQUIRED', result.value.resyncRequired, true);
  assertScenario('SC-05', 'NAMED_GAP_BLOCKER', result.value.component.blockerCodes.includes('SEQUENCE_GAP'));
  assertScenarioEqual('SC-05', 'BOOK_INVALIDATED', result.value.observation.focusedBooks[0].sequenceComplete, false);
  assertScenarioEqual('SC-05', 'RESYNC_ID_RETAINED', result.value.observation.focusedBooks[0].pendingResyncRequestId, 'resync-btc-1');
});

scenario(6, 'quiet symbol remains in the universe', () => {
  const result = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source', {
    observation: world.observation({
      retainedSymbols: [
        { symbol: 'BTCUSDT', lastActivityAtMs: world.NOW - 100 },
        { symbol: 'QUIETUSDT', lastActivityAtMs: null },
      ],
    }),
  }));
  assertScenario('SC-06', 'SOURCE_PROJECTED', result.ok === true);
  const quiet = result.value.observation.retainedSymbols.find((entry) => entry.symbol === 'QUIETUSDT');
  assertScenario('SC-06', 'QUIET_SYMBOL_RETAINED', quiet !== undefined);
  assertScenarioEqual('SC-06', 'NO_FABRICATED_ACTIVITY', quiet.lastActivityAtMs, null);
});

scenario(7, 'dormant-to-active evidence promotes bounded focus', () => {
  const result = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source', {
    observation: world.observation({
      retainedSymbols: [{ symbol: 'DORMANTUSDT', lastActivityAtMs: world.NOW - 10 }],
      focus: {
        capacity: 2,
        requestedSymbols: ['DORMANTUSDT'],
        readySymbols: ['DORMANTUSDT'],
        promotionCorrelationIds: ['cor-dormant-wakeup'],
      },
    }),
  }));
  assertScenario('SC-07', 'FOCUS_PROJECTED', result.ok === true);
  assertScenarioDeepEqual('SC-07', 'DORMANT_PROMOTED', result.value.observation.focus.readySymbols, ['DORMANTUSDT']);
  assertScenario(
    'SC-07',
    'FOCUS_CAPACITY_RESPECTED',
    result.value.observation.focus.readySymbols.length <= result.value.observation.focus.capacity,
  );
});

scenario(8, 'one-print noise is rejected', () => {
  const result = world.sourceProbe('public-spot-source', world.sourceReading('spot-public-source', {
    observation: world.observation({
      rejectedSignals: [{ correlationId: 'cor-one-print', symbol: 'NOISEUSDT', code: 'ONE_PRINT_SPIKE' }],
      proposalIds: [],
    }),
  }));
  assertScenario('SC-08', 'NOISE_PROJECTED', result.ok === true);
  assertScenarioEqual('SC-08', 'ONE_PRINT_REJECTED', result.value.observation.rejectedSignals[0].code, 'ONE_PRINT_SPIKE');
  assertScenarioDeepEqual('SC-08', 'ZERO_PROPOSALS', result.value.observation.proposalIds, []);
});

scenario(9, 'Basis proposal preserves engine identity and revision', () => {
  const basis = world.captureEngine('BASIS', {
    readRecordRevision: (kind, ownerId) => `${kind.toLowerCase()}-${ownerId}-rev-3`,
  });
  assertScenario('SC-09', 'BASIS_CAPTURED', basis.ok === true);
  const combined = world.canonicalReadModelFromCaptures({ basis: basis.value, volume: null });
  assertScenario('SC-09', 'READ_MODEL_BUILT', combined.ok === true);
  const proposal = combined.value.view.basis.proposals[0];
  const alias = basis.value.identities.find((entry) => entry.ownerId === 'basis-proposal-id');
  assertScenarioEqual('SC-09', 'SOURCE_ID_EXACT', proposal.sourceId, 'basis-proposal-id');
  assertScenarioEqual('SC-09', 'CONFIG_REVISION_EXACT', proposal.configVersion, 'basis-config-v9');
  assertScenarioEqual('SC-09', 'OWNER_REVISION_EXACT', alias.revisionDigest, 'proposal-basis-proposal-id-rev-3');
  assertScenarioEqual('SC-09', 'CORRELATION_EXACT', combined.value.view.correlationId, 'cor-acceptance-adapters');
});

scenario(10, 'Volume proposal remains advisory under restricted policy', () => {
  const volume = world.captureEngine('VOLUME');
  assertScenario('SC-10', 'VOLUME_CAPTURED', volume.ok === true);
  assertScenarioEqual('SC-10', 'ADVISORY_ONLY', volume.value.maximumActionAuthority, 'ADVISORY');
  assertScenarioEqual('SC-10', 'NO_RESERVATION_AUTHORITY', volume.value.capitalReservationAuthority, 'NONE');
  assertScenarioEqual('SC-10', 'NO_EXECUTION_AUTHORITY', volume.value.executionAuthority, 'NONE');
});

scenario(11, 'insufficient or stale account truth blocks capital reservation', () => {
  const terminal = world.runCapitalScenario('CS-04');
  assertScenario('SC-11', 'CAPITAL_TERMINAL_VISIBLE', terminal.capitalDecision.length > 0);
  assertScenario(
    'SC-11',
    'STALE_TRUTH_BLOCK_RETAINED',
    terminal.capitalDecision.every((decision) => decision.blockingReasons.some((reason) => reason.startsWith('SNAPSHOT_TRUTH_'))),
  );
  assertScenarioEqual('SC-11', 'NO_CAPITAL_GRANTED', terminal.capitalDecision[0].grantedAmount, '0');
});

scenario(12, 'competing opportunities cannot double-reserve capital', () => {
  const proof = world.competingReservationTruth();
  assertScenarioEqual('SC-12', 'FIRST_RESERVATION_APPLIED', proof.first.mutation.status, 'APPLIED');
  assertScenarioEqual('SC-12', 'COMPETING_RESERVATION_REJECTED', proof.second.mutation.status, 'REJECTED');
  assertScenario('SC-12', 'DUPLICATE_REASON_NAMED', proof.second.mutation.reasonCodes.includes('ALLOCATION_ALREADY_RESERVED'));
  assertScenarioEqual('SC-12', 'ONE_RESERVATION_ONLY', proof.second.book.reservations.length, 1);
});

scenario(13, 'scoped approval reaches VALIDATE_ONLY risk evaluation', async () => {
  const run = await world.runValidateOnly();
  assertScenario('SC-13', 'VERTICAL_SLICE_READY', run.result.ok === true, run.result.snapshot.failure?.code);
  assertScenarioEqual('SC-13', 'DISPOSITION_READY', run.result.snapshot.disposition, 'READY');
  assertScenarioEqual('SC-13', 'RISK_CALLED_ONCE', run.result.snapshot.ownerInvocations.riskEvaluations, 1);
  assertScenarioEqual('SC-13', 'APPROVAL_USED_ONCE', run.result.snapshot.ownerInvocations.approvalUseReductions, 1);
  assertScenarioEqual('SC-13', 'ZERO_SUBMISSION_CALLS', run.result.snapshot.venueAudit.submissionCalls, 0);
  assertScenario('SC-13', 'TRACE_DURABLY_PERSISTED', run.result.snapshot.persistenceId !== null);
});

scenario(14, 'approval expiry revocation and config mismatch block progression', async () => {
  const cases = [
    ['EXPIRY', (input) => { input.capital.approval.expiresAtMs = world.NOW; }],
    ['REVOCATION', (input) => {
      input.capital.approval.revokedAtMs = world.NOW - 1;
      input.capital.approval.revocationReasonReference = 'acceptance-revocation';
    }],
    ['CONFIG_MISMATCH', (input) => { input.capital.approval.configRevision = 'cfg_acceptance_mismatch'; }],
  ];
  for (const [name, mutate] of cases) {
    const input = world.validateOnlyInput();
    mutate(input);
    const run = await world.runValidateOnly(input);
    assertScenario('SC-14', `${name}_REJECTED`, run.result.ok === false);
    assertScenarioEqual('SC-14', `${name}_RISK_NOT_CALLED`, run.result.snapshot.ownerInvocations.riskEvaluations, 0);
    assertScenarioEqual('SC-14', `${name}_COORDINATOR_NOT_CREATED`, run.result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  }
});

scenario(15, 'multi-leg risk reject stops before the coordinator', async () => {
  const input = world.validateOnlyInput();
  input.riskEvidence.policy.minNetEdgePct = 0.9;
  const run = await world.runValidateOnly(input);
  assertScenarioEqual('SC-15', 'RISK_REJECTED', run.result.snapshot.disposition, 'RISK_REJECTED');
  assertScenarioEqual('SC-15', 'COORDINATOR_NOT_CREATED', run.result.snapshot.ownerInvocations.coordinatorsCreated, 0);
  assertScenarioEqual('SC-15', 'ZERO_SUBMISSION_CALLS', run.result.snapshot.venueAudit.submissionCalls, 0);
});

scenario(16, 'accepted risk produces a deterministic dry-run plan only', async () => {
  const left = await world.runValidateOnly();
  const right = await world.runValidateOnly();
  for (const run of [left, right]) {
    assertScenarioEqual('SC-16', 'PLAN_VALIDATE_ONLY', run.result.snapshot.executionPlan.mode, 'VALIDATE_ONLY');
    assertScenarioEqual('SC-16', 'EXECUTION_AUTHORITY_NONE', run.result.snapshot.executionAuthority, 'NONE');
    assertScenarioEqual('SC-16', 'ZERO_SUBMISSION_CALLS', run.result.snapshot.venueAudit.submissionCalls, 0);
    assertScenarioDeepEqual('SC-16', 'DRY_SYNTHETIC_LABELS', run.result.snapshot.truthLabels, ['DRY_RUN', 'SYNTHETIC_ONLY']);
  }
  assertScenarioEqual('SC-16', 'PLAN_ID_DETERMINISTIC', left.result.snapshot.executionPlan.planId, right.result.snapshot.executionPlan.planId);
  assertScenarioEqual(
    'SC-16',
    'PLAN_TERMS_DETERMINISTIC',
    left.result.snapshot.executionPlan.termsFingerprint,
    right.result.snapshot.executionPlan.termsFingerprint,
  );
});

scenario(17, 'any attempted live mode remains mechanically blocked', async () => {
  for (const mode of world.BLOCKED_EXECUTION_MODE_REQUESTS) {
    const input = world.validateOnlyInput();
    input.requestedMode = mode;
    const run = await world.runValidateOnly(input);
    assertScenarioEqual('SC-17', `${mode}_BLOCK_CODE`, run.result.snapshot.failure.code, world.LIVE_EXECUTION_NOT_IMPLEMENTED);
    assertScenarioEqual('SC-17', `${mode}_ZERO_RISK_CALLS`, run.result.snapshot.ownerInvocations.riskEvaluations, 0);
    assertScenarioEqual('SC-17', `${mode}_ZERO_COORDINATORS`, run.result.snapshot.ownerInvocations.coordinatorsCreated, 0);
    assertScenarioEqual('SC-17', `${mode}_ZERO_SUBMISSIONS`, run.result.snapshot.venueAudit.submissionCalls, 0);
  }
});

scenario(18, 'kill switch blocks new and increasing activity', async () => {
  const input = world.validateOnlyInput();
  input.riskEvidence.killSwitch.engaged = true;
  input.riskEvidence.killSwitch.reason = 'acceptance containment';
  const run = await world.runValidateOnly(input);
  assertScenarioEqual('SC-18', 'RISK_REJECTED', run.result.snapshot.disposition, 'RISK_REJECTED');
  assertScenario('SC-18', 'KILL_SWITCH_NAMED', run.result.snapshot.riskVerdict.blockingCodes.includes('KILL_SWITCH'));
  assertScenarioEqual('SC-18', 'COORDINATOR_NOT_CREATED', run.result.snapshot.ownerInvocations.coordinatorsCreated, 0);
});

scenario(19, 'kill switch leaves supervision and reduction recommendations visible', () => {
  const terminal = world.runCapitalScenario('CS-14');
  const exit = terminal.positionActionIntent.find((intent) => intent.kind === 'REQUEST_EXIT');
  assertScenario('SC-19', 'EXIT_RECOMMENDATION_VISIBLE', exit !== undefined);
  assertScenarioEqual('SC-19', 'EXIT_IS_RISK_REDUCING', exit.riskEffect, 'RISK_REDUCING');
  assertScenario('SC-19', 'EXPOSED_POSITION_REMAINS_VISIBLE', terminal.topologyProjection.exposedPositionIds.includes(exit.positionId));
});

scenario(20, 'partial or one-leg fixture produces recovery-required truth', async () => {
  const result = await world.createOneLegExecutionTruth();
  assertScenarioEqual('SC-20', 'ONE_LEG_EXPOSED', result.state.lifecycle, 'ONE_LEG_EXPOSED');
  assertScenario('SC-20', 'EXPOSURE_TIMESTAMP_VISIBLE', result.state.exposedSinceMs !== null);
  assertScenarioEqual('SC-20', 'RECONCILIATION_EXPLICIT', result.reconciliation.status, 'EXACT');
  assertScenarioEqual('SC-20', 'RECONCILIATION_HAS_NO_AUTHORITY', result.reconciliation.executionAuthority, 'NONE');
  assertScenario(
    'SC-20',
    'RISK_REDUCING_RECOVERY_VISIBLE',
    result.recovery.some((entry) => entry.riskEffect === 'RISK_REDUCING' && entry.automatic === false),
  );
});

scenario(21, 'reconciliation divergence blocks new exposure', async () => {
  const input = world.validateOnlyInput();
  input.reconciliationEvidence.positions.records[0].quantity = 1;
  const run = await world.runValidateOnly(input);
  assertScenarioEqual('SC-21', 'RECONCILIATION_BLOCKED', run.result.snapshot.disposition, 'RECONCILIATION_BLOCKED');
  assertScenarioEqual('SC-21', 'DIVERGENCE_EXPLICIT', run.result.snapshot.reconciliation.status, 'DIVERGED');
  assertScenarioEqual('SC-21', 'NO_EXECUTION_AUTHORITY', run.result.snapshot.reconciliation.executionAuthority, 'NONE');
  assertScenarioEqual('SC-21', 'NEW_EXPOSURE_BLOCKED', run.result.snapshot.reconciliation.recommendation, 'HEDGE_RESIDUAL');
  const barrier = run.adapter.restartBarrier(world.NOW);
  assertScenario('SC-21', 'RESTART_BARRIER_READABLE', barrier.ok === true);
  assertScenarioEqual('SC-21', 'RESTART_BARRIER_BLOCKS_EXPOSURE', barrier.value.canOpenOrIncrease, false);
  assertScenario(
    'SC-21',
    'DIVERGENCE_DURABLY_REQUIRES_RECONCILIATION',
    barrier.value.reasonCodes.includes('RECONCILIATION_BLOCKS_NEW_EXPOSURE')
      && barrier.value.reconciliationRequiredPlanIds.includes(run.result.snapshot.executionPlan.planId),
  );
  const trace = run.adapter.queryTrace({ correlationId: run.result.snapshot.rootCorrelationId, limit: 20 });
  assertScenario('SC-21', 'BLOCKED_TRACE_READABLE', trace.ok === true);
  const reconciliationEvent = trace.value.events.find(({ event }) => event.kind === 'RECONCILIATION').event;
  const recoveryEvent = trace.value.events.find(({ event }) => event.domainLifecycle?.startsWith('RECOVERY:')).event;
  assertScenarioEqual(
    'SC-21',
    'RECONCILIATION_FAILURE_ATTRIBUTED_TO_OWNER',
    reconciliationEvent.failure?.code,
    'RECONCILIATION_TRUTH_BLOCKS_NEW_EXPOSURE',
  );
  assertScenarioEqual('SC-21', 'RECOVERY_OWNER_SUCCEEDED', recoveryEvent.failure, null);
});

scenario(22, 'production validate-only trace contains every reached owner transition exactly once', async () => {
  const run = await world.runValidateOnly();
  assertScenario('SC-22', 'VALIDATE_ONLY_READY', run.result.ok === true);
  assertScenarioEqual('SC-22', 'NO_VENUE_SUBMISSION', run.result.snapshot.venueAudit.submissionCalls, 0);
  const correlationId = run.result.snapshot.rootCorrelationId;
  const material = [
    ['CAPITAL', 'capital-supervision', 'READY'],
    ['RISK', 'multileg-risk', 'READY'],
    ['EXECUTION', 'execution-coordinator-validate-only', 'READY'],
    ['RECONCILIATION', 'reconciliation', 'READY'],
    ['EXECUTION', 'execution-coordinator-validate-only', 'RECOVERY:NO_ACTION'],
    ['PERSISTENCE', 'ledger-persistence', 'READY'],
  ];
  const query = run.adapter.queryTrace({ correlationId, limit: 20 });
  assertScenario('SC-22', 'TRACE_QUERY_SUCCEEDED', query.ok === true);
  assertScenarioEqual('SC-22', 'ALL_MATERIAL_TRANSITIONS_PRESENT', query.value.events.length, material.length);
  assertNoDuplicateKeys('SC-22', 'EACH_TRANSITION_EXACTLY_ONCE', query.value.events, (entry) => entry.event.id);
  assertScenarioDeepEqual(
    'SC-22',
    'ACTUAL_OWNER_CHAIN_ORDER',
    query.value.events.map(({ event }) => [event.kind, event.componentId, event.domainLifecycle]),
    material,
  );
  for (let index = 1; index < query.value.events.length; index += 1) {
    assertScenario(
      'SC-22',
      `PROVENANCE_LINK_${index}`,
      query.value.events[index].event.referenceIds.includes(query.value.events[index - 1].event.id),
    );
  }
});

scenario(23, 'restart before reservation restores safely', () => {
  const initial = world.createPersistenceWorld(world.NOW, { correlationId: 'sc23.empty' });
  assertScenario('SC-23', 'EMPTY_LOAD_SUCCEEDED', initial.loaded.ok === true);
  assertScenario('SC-23', 'STARTUP_PERSISTED', initial.adapter.persistStartup({
    startedAtMs: world.NOW,
    correlationId: 'sc23.startup',
  }).ok === true);
  initial.clock.advance(1);
  const restarted = new world.SystemLedgerPersistenceAdapter(initial.ledger);
  const loaded = restarted.load(initial.clock.nowMs(), 'sc23.reload');
  assertScenario('SC-23', 'RESTART_LOAD_SUCCEEDED', loaded.ok === true);
  assertScenarioEqual('SC-23', 'NO_PHANTOM_RESERVATION', loaded.state.reservations.length, 0);
  let barrier = restarted.restartBarrier(initial.clock.nowMs());
  assertScenarioEqual('SC-23', 'UNKNOWN_TRUTH_FAILS_CLOSED', barrier.value.canOpenOrIncrease, false);
  assertScenario('SC-23', 'SUPERVISION_CONTINUES', barrier.value.supervisionContinues === true);
  assertScenario('SC-23', 'FRESH_TRUTH_PERSISTED', restarted.persistRestartTruth({
    publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH',
    observedAtMs: initial.clock.nowMs(),
  }, 'sc23.truth').ok === true);
  barrier = restarted.restartBarrier(initial.clock.nowMs());
  assertScenarioEqual('SC-23', 'SAFE_RESTART_ADMITS_AFTER_TRUTH', barrier.value.canOpenOrIncrease, true);
});

scenario(24, 'restart after reservation does not allocate twice', () => {
  const persistence = world.createPersistenceWorld(world.NOW, { correlationId: 'sc24.empty' });
  persistence.adapter.persistStartup({ startedAtMs: world.NOW, correlationId: 'sc24.startup' });
  const input = {
    idempotencyKey: 'sc24.reservation.create.0001',
    requestDigest: 'a'.repeat(64),
    correlationId: 'sc24.reservation',
    occurredAtMs: world.NOW,
    traceEvent: world.persistenceTrace({
      id: 'sc24.reservation.persisted.1', sequence: 2, correlationId: 'sc24.reservation',
      occurredAtMs: world.NOW, kind: 'CAPITAL', componentId: 'capital-supervision', truthLabel: 'SYNTHETIC_ONLY',
    }),
    transition: (state) => ({
      nextState: world.upsertReservationReference(state, {
        reservationId: 'sc24-reservation-1', allocationKey: 'BTCUSDT:basis:budget-1',
        ownerRevision: 'capital-revision-1', domainState: 'RESERVED', blocksAllocation: true,
        correlationId: 'sc24.reservation', updatedAtMs: world.NOW,
      }),
      receipt: { reservationId: 'sc24-reservation-1', state: 'RESERVED' },
    }),
  };
  const first = persistence.adapter.applyIdempotentTransition(input);
  assertScenario('SC-24', 'FIRST_RESERVATION_COMMITTED', first.ok === true && first.value.replayed === false);
  const eventCount = persistence.ledger.countEvents(world.SYSTEM_PERSISTENCE_EVENT_KIND);
  const restarted = new world.SystemLedgerPersistenceAdapter(persistence.ledger);
  assertScenario('SC-24', 'RESTART_LOAD_SUCCEEDED', restarted.load(world.NOW, 'sc24.reload').ok === true);
  let transitionCalls = 0;
  const replay = restarted.applyIdempotentTransition({
    ...input,
    transition: () => {
      transitionCalls += 1;
      throw new Error('replayed reservation transition must not execute');
    },
  });
  assertScenario('SC-24', 'REPLAY_SUCCEEDED', replay.ok === true && replay.value.replayed === true);
  assertScenarioEqual('SC-24', 'TRANSITION_NOT_REEXECUTED', transitionCalls, 0);
  assertScenarioEqual('SC-24', 'ONE_RESERVATION_ONLY', restarted.currentState().value.reservations.length, 1);
  assertScenarioEqual('SC-24', 'NO_DUPLICATE_LEDGER_EVENT', persistence.ledger.countEvents(world.SYSTEM_PERSISTENCE_EVENT_KIND), eventCount);
});

scenario(25, 'restart after dry-run partial event requires reconciliation', () => {
  const persistence = world.createPersistenceWorld(world.NOW, { correlationId: 'sc25.empty' });
  persistence.adapter.persistStartup({ startedAtMs: world.NOW, correlationId: 'sc25.startup' });
  persistence.adapter.persistRestartTruth({
    publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: world.NOW,
  }, 'sc25.truth');
  const state = world.upsertDryRunExecutionReference(persistence.adapter.currentState().value, {
    planId: 'sc25-plan-1', checkpointDigest: 'a'.repeat(32), serializedCheckpoint: '{}',
    domainLifecycle: 'ONE_LEG_EXPOSED', dryRun: true, requiresReconciliation: true,
    correlationId: 'sc25.partial', updatedAtMs: world.NOW,
  });
  const committed = persistence.adapter.commitCheckpoint(state, {
    auditKind: 'TRANSITION', correlationId: 'sc25.partial', occurredAtMs: world.NOW,
    traceEvent: world.persistenceTrace({
      id: 'sc25.partial.1', sequence: state.revision, correlationId: 'sc25.partial',
      occurredAtMs: world.NOW, kind: 'EXECUTION', componentId: 'execution-coordinator-validate-only',
    }),
  });
  assertScenario('SC-25', 'PARTIAL_CHECKPOINT_COMMITTED', committed.ok === true);
  const restarted = new world.SystemLedgerPersistenceAdapter(persistence.ledger);
  assertScenario('SC-25', 'RESTART_LOAD_SUCCEEDED', restarted.load(world.NOW, 'sc25.reload').ok === true);
  const barrier = restarted.restartBarrier(world.NOW);
  assertScenario('SC-25', 'RESTART_BARRIER_READABLE', barrier.ok === true);
  assertScenarioEqual('SC-25', 'NEW_EXPOSURE_BLOCKED', barrier.value.canOpenOrIncrease, false);
  assertScenarioDeepEqual('SC-25', 'PLAN_REQUIRES_RECONCILIATION', barrier.value.reconciliationRequiredPlanIds, ['sc25-plan-1']);
  assertScenario('SC-25', 'SUPERVISION_CONTINUES', barrier.value.supervisionContinues === true);
});

scenario(26, 'optional enrichment failure does not kill broad observation', () => {
  const result = world.buildSupervisor(world.projectionInput({
    componentOverrides: {
      'market-intelligence': {
        readiness: 'DEGRADED',
        phase: 'DEGRADED',
        lastFailure: world.supervisorFailure('market-intelligence', 'OPTIONAL_ENRICHMENT_UNAVAILABLE'),
        blockerCodes: ['OPTIONAL_ENRICHMENT_UNAVAILABLE'],
        operatorAttentionRequired: true,
      },
    },
  }));
  assertScenario('SC-26', 'SUPERVISOR_PROJECTED', result.ok === true, result.failure?.code);
  assertScenarioEqual('SC-26', 'SPOT_BROAD_OBSERVATION_READY', result.value.components.find((c) => c.componentId === 'public-spot-source').readiness, 'READY');
  assertScenarioEqual('SC-26', 'FUTURES_BROAD_OBSERVATION_READY', result.value.components.find((c) => c.componentId === 'public-usdm-source').readiness, 'READY');
  assertScenarioEqual('SC-26', 'OPTIONAL_ENRICHMENT_DEGRADED', result.value.components.find((c) => c.componentId === 'market-intelligence').readiness, 'DEGRADED');
  assertScenario('SC-26', 'WHOLE_MACHINE_NOT_FAILED', result.value.overallPosture !== 'FAILED');
});

scenario(27, 'one engine failure does not erase the other', async () => {
  const composed = world.createCompositionWorld();
  await world.startCompositionReady(composed);
  composed.states.basis.fatalCode = 'BASIS_ACCEPTANCE_FATAL';
  await world.driveComposition(composed);
  const snapshot = composed.composition.read().supervisor;
  assertScenarioEqual('SC-27', 'WHOLE_MACHINE_DEGRADED', snapshot.phase, 'DEGRADED');
  assertScenarioEqual('SC-27', 'BASIS_DEGRADED', snapshot.components.find((row) => row.name === 'basis-engine').phase, 'DEGRADED');
  assertScenarioEqual('SC-27', 'VOLUME_REMAINS_RUNNING', snapshot.components.find((row) => row.name === 'volume-engine').phase, 'RUNNING');
  assertScenarioEqual('SC-27', 'VOLUME_NOT_STOPPED', composed.states.volume.stopCalls, 0);
});

scenario(28, 'root-cause graph identifies the first real blocker', () => {
  const result = world.buildSupervisor(world.projectionInput({
    componentOverrides: {
      'public-usdm-source': {
        readiness: 'FAILED', phase: 'FAILED', truthLabel: 'UNAVAILABLE', authority: 'UNAVAILABLE',
        completeness: 'UNAVAILABLE', releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'BLOCKED'],
        sourceTimestamp: null, freshness: null,
        lastFailure: world.supervisorFailure('public-usdm-source', 'USD_M_SOURCE_SILENT'),
        blockerCodes: ['USD_M_SOURCE_SILENT'], operatorAttentionRequired: true,
      },
      'basis-engine': {
        readiness: 'BLOCKED', phase: 'BLOCKED', blockerCodes: ['DEPENDENCY_BLOCKED'], operatorAttentionRequired: true,
      },
      'capital-supervision': {
        readiness: 'DEGRADED', phase: 'DEGRADED', blockerCodes: ['UPSTREAM_STRATEGY_DEGRADED'],
      },
    },
  }));
  assertScenario('SC-28', 'SUPERVISOR_PROJECTED', result.ok === true, result.failure?.code);
  assertScenarioEqual('SC-28', 'FIRST_ROOT_BLOCKER', result.value.firstRootBlockerComponentId, 'public-usdm-source');
  const edge = result.value.edges.find((candidate) => candidate.from === 'public-usdm-source' && candidate.to === 'basis-engine');
  assertScenarioEqual('SC-28', 'DEPENDENT_EDGE_BLOCKED', edge.state, 'BLOCKED');
  assertScenarioEqual('SC-28', 'EDGE_RETAINS_ROOT', edge.rootBlockerComponentId, 'public-usdm-source');
  const root = result.value.rootCauses.find((candidate) => candidate.componentId === 'public-usdm-source');
  assertScenario('SC-28', 'ORIGINAL_REASON_RETAINED', root.reasonCodes.includes('USD_M_SOURCE_SILENT'));
});

scenario(29, 'API and UI snapshot labels dry-run and synthetic truth correctly', () => {
  const syntheticTimestamp = {
    sourceTimeMs: world.SUPERVISOR_NOW - 100,
    receivedAtMs: world.SUPERVISOR_NOW - 80,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'acceptance.synthetic.spot',
  };
  const result = world.buildSupervisor(world.projectionInput({
    componentOverrides: {
      'public-spot-source': {
        authority: 'SYNTHETIC_TEST', truthLabel: 'SYNTHETIC_ONLY',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        sourceTimestamp: syntheticTimestamp,
        freshness: world.evaluateFreshness(syntheticTimestamp, world.SUPERVISOR_NOW),
      },
      'multileg-risk': {
        authority: 'SYNTHETIC_TEST', truthLabel: 'DRY_RUN',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
      },
      'execution-coordinator-validate-only': {
        authority: 'SYNTHETIC_TEST', truthLabel: 'DRY_RUN',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
      },
    },
    traceEvents: [
      world.supervisorTraceEvent({
        id: 'sc29.synthetic.source', kind: 'SOURCE', componentId: 'public-spot-source',
        truthLabel: 'SYNTHETIC_ONLY', releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
      }),
      world.supervisorTraceEvent({
        id: 'sc29.dry.execution', sequence: 2, kind: 'EXECUTION', componentId: 'execution-coordinator-validate-only',
        truthLabel: 'DRY_RUN', releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
      }),
    ],
  }));
  assertScenario('SC-29', 'SUPERVISOR_PROJECTED', result.ok === true, result.failure?.code);
  assertScenarioEqual('SC-29', 'SYNTHETIC_SOURCE_NOT_LIVE', result.value.components.find((c) => c.componentId === 'public-spot-source').truthLabel, 'SYNTHETIC_ONLY');
  assertScenarioEqual('SC-29', 'EXECUTION_DRY_RUN', result.value.components.find((c) => c.componentId === 'execution-coordinator-validate-only').truthLabel, 'DRY_RUN');
  assertScenarioEqual('SC-29', 'SUMMARY_DRY_RUN', result.value.summaries.execution.truthLabel, 'DRY_RUN');
  assertScenarioEqual('SC-29', 'LIVE_BARRIER_VISIBLE', result.value.summaries.execution.barrier, world.LIVE_EXECUTION_NOT_IMPLEMENTED);
  assertScenarioEqual('SC-29', 'WHOLE_MACHINE_DRY_RUN', result.value.truthLabel, 'DRY_RUN');
});

scenario(30, 'graceful shutdown closes transports and persists final checkpoints', async () => {
  const composed = world.createCompositionWorld();
  await world.startCompositionReady(composed);
  composed.log.length = 0;
  const drained = await composed.composition.drain();
  assertScenarioDeepEqual('SC-30', 'REVERSE_DEPENDENCY_SHUTDOWN', composed.log, [
    'stop:volume', 'stop:basis', 'stop:market-intelligence', 'stop:intelligence-runtime', 'stop:market',
  ]);
  assertScenarioEqual('SC-30', 'CLEAN_DRAIN', drained.drainOutcome, 'CLEAN');
  assertScenarioEqual('SC-30', 'DRIVER_STOPPED', drained.driverRunning, false);
  assertScenarioEqual('SC-30', 'SCHEDULER_CLOSED', composed.scheduler.snapshot().activeTaskCount, 0);
  assertScenario('SC-30', 'TRANSPORTS_CLOSED_ONCE', [
    composed.states.market.stopCalls,
    composed.states.intelligenceRuntime.stopCalls,
    composed.states.marketIntelligence.stopCalls,
    composed.states.basis.stopCalls,
    composed.states.volume.stopCalls,
  ].every((count) => count === 1));

  const persistence = world.createPersistenceWorld(world.NOW, { correlationId: 'sc30.empty' });
  persistence.adapter.persistStartup({ startedAtMs: world.NOW, correlationId: 'sc30.startup' });
  const shutdownInput = {
    stoppedAtMs: world.NOW,
    correlationId: 'sc30.final',
    clean: true,
    componentStates: [
      { componentId: 'market-universe', desiredState: 'STOPPED', generation: 1 },
      { componentId: 'intelligence-runtime', desiredState: 'STOPPED', generation: 1 },
      { componentId: 'market-intelligence', desiredState: 'STOPPED', generation: 1 },
      { componentId: 'basis-engine', desiredState: 'STOPPED', generation: 1 },
      { componentId: 'volume-engine', desiredState: 'STOPPED', generation: 1 },
    ],
  };
  const first = persistence.adapter.persistFinalShutdown(shutdownInput);
  assertScenario('SC-30', 'FINAL_CHECKPOINT_PERSISTED', first.ok === true);
  const eventCount = persistence.ledger.countEvents(world.SYSTEM_PERSISTENCE_EVENT_KIND);
  const replay = persistence.adapter.persistFinalShutdown(shutdownInput);
  assertScenario('SC-30', 'FINAL_CHECKPOINT_REPLAYED', replay.ok === true);
  assertScenarioDeepEqual('SC-30', 'FINAL_CHECKPOINT_IDEMPOTENT', replay.value, first.value);
  assertScenarioEqual('SC-30', 'FINAL_CHECKPOINT_EXACTLY_ONCE', persistence.ledger.countEvents(world.SYSTEM_PERSISTENCE_EVENT_KIND), eventCount);
  assertExactlyOnce(
    'SC-30',
    'CLEAN_SHUTDOWN_EVENT_EXACTLY_ONCE',
    persistence.ledger.events,
    (event) => event.data?.auditKind === 'SHUTDOWN',
  );
});
