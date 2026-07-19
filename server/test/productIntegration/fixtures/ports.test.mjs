import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createCapitalRiskVerdictFixture,
  createComponentLifecycleFixture,
  createDashboardClientFixture,
  createDashboardDonorBridgeFixture,
  createExecutionReconciliationFixture,
  createL14ControlPersistenceFixture,
  createL14DurableControlFixture,
  createMemoryLedgerPersistenceFixture,
  createMemoryMutationJournalCasFixture,
  createOpportunityAuthorityFixture,
  createOperatorCommandFixture,
  createOperatorEventStreamFixture,
  createOutcomeFeedbackFixture,
  createPositionRecoveryFixture,
  createQAssessmentFixture,
  createRuntimeComponentFixture,
  createStrategySnapshotFixture,
  createSupervisorProjectionFixture,
  createUnavailablePrivateTruthFixture,
  OPERATOR_EVENT_FIXTURE,
  PRODUCT_FIXTURE_NOW_MS,
  Q_ABSTAIN_ASSESSMENT_FIXTURE,
  Q_ABSTAIN_VALIDATION_RECEIPT,
} from '../../../dist/productIntegration/fixtures/index.js';
import { buildProductSupervisorProjection } from '../../../dist/productIntegration/supervisor/index.js';
import { projectQAssessmentReference } from '../../../dist/productIntegration/adapters/index.js';
import { canonicalProductJson } from '../../../dist/productIntegration/contracts/index.js';

function l06Digest(prefix, value) {
  return `${prefix}${createHash('sha256').update(canonicalProductJson(value)).digest('hex')}`;
}

function l14Event(draft) {
  const eventId = l06Digest('l14evt_', { schema: 'LIVE_EDGE_CONTROL_EVENT_ID_V1', event: draft });
  return { ...draft, eventId, contentDigest: l06Digest('sha256:', { ...draft, eventId }) };
}

function l14Append(event, expectedJournalVersion, previousHeadDigest) {
  const nextHeadDigest = l06Digest('l14head_', { schema: 'LIVE_EDGE_CONTROL_HEAD_V1', previousHeadDigest, journalVersion: expectedJournalVersion + 1, eventId: event.eventId, contentDigest: event.contentDigest });
  const base = { ownerTarget: 'SYSTEM_INTEGRATION_LEDGER', event, idempotencyKey: `l14:${event.commandId}:${event.kind}`, expectedJournalVersion, previousHeadDigest, nextHeadDigest, externalActionAuthorization: 'NONE' };
  return { ...base, appendRequestDigest: l06Digest('sha256:', { schema: 'LIVE_EDGE_CONTROL_APPEND_REQUEST_V1', ...base }) };
}

function l06Request({ journalVersion = 1, previousHeadDigest = null, observationSeed = '1', kind = 'TELEMETRY_DEGRADED', payload = { subsystem: 'TRACE', reasonCode: 'SYNTHETIC_ONLY' } } = {}) {
  const mutationId = `l06mut_${'a'.repeat(64)}`;
  const observationId = `l06obs_${observationSeed.repeat(64).slice(0, 64)}`;
  const entryCore = {
    schema: 'LIVE_EDGE_MUTATION_ENTRY_V1', version: 1, mutationId, observationId, kind,
    occurredAtMs: PRODUCT_FIXTURE_NOW_MS, receivedAtMs: PRODUCT_FIXTURE_NOW_MS, sourceRevision: 'fixture-source:1', payload,
  };
  const contentRevision = l06Digest('l06content_', entryCore);
  const entryId = l06Digest('l06entry_', { mutationId, journalVersion, previousHeadDigest, observationId, contentRevision });
  const entry = { schema: entryCore.schema, version: 1, entryId, mutationId, observationId, journalVersion, previousHeadDigest, kind: entryCore.kind, occurredAtMs: entryCore.occurredAtMs, receivedAtMs: entryCore.receivedAtMs, sourceRevision: entryCore.sourceRevision, payload, contentRevision };
  const nextHeadDigest = l06Digest('l06head_', { previous: previousHeadDigest, journalVersion, entryId, contentRevision });
  const base = {
    schema: 'LIVE_EDGE_MUTATION_APPEND_REQUEST_V1', version: 1, ownerTarget: 'SYSTEM_INTEGRATION_LEDGER', mutationId, entryId,
    idempotencyKey: `l06append:${mutationId}:${journalVersion}`, expectedJournalVersion: journalVersion - 1, nextJournalVersion: journalVersion,
    previousHeadDigest, entry, nextHeadDigest, nextOutcomeRevision: `l06outcome_${'c'.repeat(64)}`, entryContentRevision: contentRevision,
    externalActionAuthorization: 'NONE',
  };
  return { ...base, appendRequestDigest: l06Digest('l06append_', base) };
}

test('private-truth fixture is explicitly unavailable until accepted L05 fan-in', () => {
  const result = createUnavailablePrivateTruthFixture(PRODUCT_FIXTURE_NOW_MS, 'fixture-private').readPrivateTruthProjection();
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'L05_PRIVATE_TRUTH_UNWIRED');
});

test('L06 CAS fixture binds version, identity, digests, idempotency and numeric ledger ACK', async () => {
  const port = createMemoryMutationJournalCasFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-journal', initialHeadDigest: null });
  const request = l06Request();
  const committed = await port.compareAndAppend(request);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.disposition, 'COMMITTED_NEW');
  assert.equal(committed.value.ledgerEventId, 1);
  const replay = await port.compareAndAppend(request);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.disposition, 'IDEMPOTENT_REPLAY');
  const conflict = await port.compareAndAppend(l06Request({ payload: { subsystem: 'TRACE', reasonCode: 'DIFFERENT_CONTENT' } }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failure.code, 'L06_IDEMPOTENCY_CONFLICT');
  const conflictPort = createMemoryMutationJournalCasFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-version', initialHeadDigest: `l06head_${'d'.repeat(64)}` });
  const versionConflict = await conflictPort.compareAndAppend(l06Request({ observationSeed: '2' }));
  assert.equal(versionConflict.ok, true);
  assert.equal(versionConflict.value.disposition, 'VERSION_CONFLICT');
  const invalidSubsystem = await conflictPort.compareAndAppend(l06Request({ payload: { subsystem: 'PRODUCT_INTEGRATION', reasonCode: 'SYNTHETIC_ONLY' } }));
  assert.equal(invalidSubsystem.ok, false);
  const unsupportedCreated = await conflictPort.compareAndAppend(l06Request({ kind: 'CREATED', payload: {} }));
  assert.equal(unsupportedCreated.ok, false);

  const bounded = createMemoryMutationJournalCasFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-capacity', initialHeadDigest: null, maximumEntries: 1 });
  const first = await bounded.compareAndAppend(request);
  const capacity = await bounded.compareAndAppend(l06Request({ journalVersion: 2, previousHeadDigest: first.value.committedHeadDigest, observationSeed: '3' }));
  assert.equal(capacity.ok, true);
  assert.equal(capacity.value.disposition, 'CAPACITY_EXHAUSTED');
});

test('ledger fixture is idempotent and rejects key reuse for another owner revision', async () => {
  const port = createMemoryLedgerPersistenceFixture(PRODUCT_FIXTURE_NOW_MS, 'fixture-ledger');
  const request = { recordType: 'ASSESSMENT', recordId: 'assessment-1', projectionRevision: 1, ownerRevision: 'model-1', idempotencyKey: 'persist-1', correlationId: 'trace-1', occurredAtMs: PRODUCT_FIXTURE_NOW_MS, payload: { state: 'ABSTAIN' } };
  const first = await port.appendProjection(request);
  const duplicate = await port.appendProjection(request);
  const conflict = await port.appendProjection({ ...request, ownerRevision: 'model-2' });
  const payloadConflict = await port.appendProjection({ ...request, payload: { state: 'USABLE' } });
  assert.equal(first.ok && first.value.duplicate, false);
  assert.equal(duplicate.ok && duplicate.value.duplicate, true);
  assert.equal(conflict.ok, false);
  assert.equal(payloadConflict.ok, false);
});

test('opportunity and dashboard fixtures preserve owner truth through typed ports', async () => {
  const opportunity = { opportunityId: 'opp-1', ownerId: 'basis-engine', revision: 'r1', status: 'REJECTED', correlationId: 'trace-1', authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 1_000 };
  const opportunityPort = createOpportunityAuthorityFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-opportunity', records: [opportunity] });
  assert.deepEqual(opportunityPort.readOpportunityReference('opp-1').value, opportunity);
  const supervisor = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: createRuntimeComponentFixture() });
  const dashboard = createDashboardClientFixture({ supervisor, events: OPERATOR_EVENT_FIXTURE, durableFloorCursor: 1 });
  assert.deepEqual((await dashboard.readSupervisor()).value, supervisor);
  assert.deepEqual((await dashboard.readEvents({ afterCursor: 40, limit: 10 })).value.events.map((event) => event.cursor), [41, 42, 43]);
  assert.equal((await dashboard.readEvents({ afterCursor: -1, limit: 10 })).ok, false);
});

test('declared owner seams have deterministic typed fixtures with structured results', () => {
  const component = createRuntimeComponentFixture()[0];
  assert.deepEqual(createComponentLifecycleFixture(component).readComponentEvidence().value, component);

  const q = projectQAssessmentReference(Q_ABSTAIN_ASSESSMENT_FIXTURE, Q_ABSTAIN_VALIDATION_RECEIPT, PRODUCT_FIXTURE_NOW_MS - 50_000, 'SYNTHETIC_TEST');
  assert.deepEqual(createQAssessmentFixture([q]).readAssessmentReferences().value, [q]);

  const strategy = { strategy: 'BASIS', ownerId: 'basis-engine', decisionId: 'decision-1', proposalId: null, revision: 'r1', correlationId: 'trace-1', occurredAtMs: PRODUCT_FIXTURE_NOW_MS, verdict: 'NO_ACTION', reasonCodes: ['SYNTHETIC_ONLY'], authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 1_000 };
  assert.deepEqual(createStrategySnapshotFixture('BASIS', [strategy]).readDecisionReferences().value, [strategy]);
  const volume = { ...strategy, strategy: 'VOLUME', ownerId: 'volume-engine', decisionId: 'volume-decision-1' };
  assert.deepEqual(createStrategySnapshotFixture('VOLUME', [volume]).readDecisionReferences().value, [volume]);

  const verdict = { opportunityId: 'opp-1', capitalVerdictId: null, riskVerdictId: null, capitalVerdict: 'UNAVAILABLE', riskVerdict: 'UNAVAILABLE', evaluatedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: ['SYNTHETIC_ONLY'], authority: 'UNAVAILABLE' };
  const verdictPort = createCapitalRiskVerdictFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-verdict', records: [verdict] });
  assert.deepEqual(verdictPort.readCapitalRiskReference('opp-1').value, verdict);

  const execution = { ticketId: 'ticket-1', executionState: 'RECOVERY_REQUIRED', reconciliationState: 'AMBIGUOUS', positionIds: [], liabilityIds: [], recoveryCampaignIds: ['campaign-1'], blocksNewExposure: true, authority: 'SYNTHETIC_TEST', observedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: ['SYNTHETIC_ONLY'] };
  const executionPort = createExecutionReconciliationFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-execution', records: [execution] });
  assert.deepEqual(executionPort.readExecutionReference('ticket-1').value, execution);
  assert.deepEqual(createPositionRecoveryFixture([execution]).readPositionRecoveryReferences().value, [execution]);
});

test('outcome-feedback fixture is idempotent and rejects conflicting reuse', () => {
  const port = createOutcomeFeedbackFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-feedback' });
  const feedback = { outcomeId: 'outcome-1', assessmentId: 'assessment-1', dedupeKey: 'feedback-1', payloadHash: 'a'.repeat(64), reconciliationState: 'EXACT', completeness: 'COMPLETE' };
  const first = port.submitFeedbackProjection(feedback);
  const duplicate = port.submitFeedbackProjection(feedback);
  const conflict = port.submitFeedbackProjection({ ...feedback, payloadHash: 'b'.repeat(64) });
  assert.equal(first.ok && first.value.duplicate, false);
  assert.equal(duplicate.ok && duplicate.value.duplicate, true);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failure.code, 'OUTCOME_FEEDBACK_IDEMPOTENCY_CONFLICT');
  assert.equal(port.submitFeedbackProjection({ ...feedback, assessmentId: 'assessment-2' }).ok, false);
  const bounded = createOutcomeFeedbackFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-feedback-capacity', maximumRecords: 1 });
  assert.equal(bounded.submitFeedbackProjection(feedback).ok, true);
  const capacity = bounded.submitFeedbackProjection({ ...feedback, outcomeId: 'outcome-2', dedupeKey: 'feedback-2', payloadHash: 'c'.repeat(64) });
  assert.equal(capacity.ok, false);
  assert.equal(capacity.failure.code, 'OUTCOME_FEEDBACK_CAPACITY_EXHAUSTED');
});

test('fixture snapshots are bounded, reject duplicate IDs, and cannot be mutated through caller aliases', () => {
  const reasonCodes = ['SYNTHETIC_ONLY'];
  const strategy = { strategy: 'BASIS', ownerId: 'basis-engine', decisionId: 'decision-alias', proposalId: null, revision: 'r1', correlationId: 'trace-1', occurredAtMs: PRODUCT_FIXTURE_NOW_MS, verdict: 'NO_ACTION', reasonCodes, authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 1_000 };
  const port = createStrategySnapshotFixture('BASIS', [strategy]);
  reasonCodes.push('CALLER_MUTATION');
  strategy.verdict = 'PROPOSED';
  const snapshot = port.readDecisionReferences().value[0];
  assert.equal(snapshot.verdict, 'NO_ACTION');
  assert.deepEqual(snapshot.reasonCodes, ['SYNTHETIC_ONLY']);
  assert.equal(Object.isFrozen(snapshot.reasonCodes), true);
  assert.throws(() => createStrategySnapshotFixture('BASIS', [strategy, { ...strategy }]), /duplicate/);
  const oversized = Array.from({ length: 1_025 }, (_, index) => ({ ...strategy, decisionId: `decision-${index}` }));
  assert.throws(() => createStrategySnapshotFixture('BASIS', oversized), /at most 1024/);
});

test('command, supervisor, and standalone event fixtures exercise every local operator seam', async () => {
  const intent = {
    commandId: 'command-fixture', commandType: 'component.restart', targetComponentId: 'basis-engine', idempotencyKey: 'idem-fixture',
    requestDigest: '1'.repeat(32), createdAtMs: PRODUCT_FIXTURE_NOW_MS - 100, expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 1_000,
    correlationId: 'trace-fixture', authenticatedOperatorId: 'operator-fixture', reason: 'fixture restart',
    requiredAuthority: 'CONTROL_COMPONENT_RESTART', payload: { generation: 2 },
  };
  const before = { revision: 7, projectionDigest: '2'.repeat(32), state: { lifecycle: 'READY' } };
  const preview = { requestDigest: intent.requestDigest, previewDigest: before.projectionDigest, currentRevision: 7, expiresAtMs: intent.expiresAtMs, preview: before };
  const receipt = {
    commandId: intent.commandId, idempotencyKey: intent.idempotencyKey, requestDigest: intent.requestDigest, previewDigest: preview.previewDigest,
    canonicalResult: 'APPLIED', beforeRevision: 7, resultingRevision: 8, correlationId: intent.correlationId, ledgerReference: 'ledger-command-1',
    completedAtMs: PRODUCT_FIXTURE_NOW_MS, before, after: { revision: 8, projectionDigest: '3'.repeat(32), state: { lifecycle: 'STARTING' } },
  };
  const command = createOperatorCommandFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-command', intent, preview, receipt, effect: 'RESTART' });
  assert.throws(() => createOperatorCommandFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-command-mismatch', intent, preview: { ...preview, previewDigest: '8'.repeat(32) }, receipt, effect: 'RESTART' }), /not bound/);
  assert.equal((await command.preview(intent)).ok, true);
  const submitted = await command.submit({ ...intent, previewDigest: preview.previewDigest, expectedRevision: 7 });
  assert.equal(submitted.ok && submitted.value.canonicalResult, 'APPLIED');
  assert.equal((await command.preview({ ...intent, requestDigest: '9'.repeat(32) })).ok, false);
  const expiredCommand = createOperatorCommandFixture({ nowMs: intent.expiresAtMs, correlationId: 'fixture-command-expired', intent, preview, receipt, effect: 'RESTART' });
  assert.equal((await expiredCommand.preview(intent)).ok, false);

  const supervisor = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 3, components: createRuntimeComponentFixture() });
  const supervisorPort = createSupervisorProjectionFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-supervisor', projection: supervisor });
  assert.equal(supervisorPort.project(PRODUCT_FIXTURE_NOW_MS, 3).ok, true);
  assert.equal(supervisorPort.project(PRODUCT_FIXTURE_NOW_MS, 4).ok, false);
  const events = createOperatorEventStreamFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-events', events: OPERATOR_EVENT_FIXTURE, durableFloorCursor: 1 });
  assert.deepEqual((await events.readPage({ afterCursor: 40, limit: 10 })).value.events.map((event) => event.cursor), [41, 42, 43]);
  assert.equal((await events.readPage({ afterCursor: -1, limit: 10 })).ok, false);
});

test('accepted L14 fixture preserves NOOP/AWARENESS and all durable lookup states', async () => {
  const action = { type: 'HALT', scope: 'NEW_RISK', retainSupervision: true };
  const preview = {
    schema: 'LIVE_EDGE_CONTROL_PREVIEW_V1', version: 1, commandId: `cmd_${'1'.repeat(16)}`, action, actionDigest: `sha256:${'a'.repeat(64)}`,
    expectedConfigVersion: 4, expectedControlRevision: 9, actorBinding: `l14actor_${'2'.repeat(64)}`, reason: 'bounded fixture halt',
    generatedAtMs: PRODUCT_FIXTURE_NOW_MS - 100, expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 900, riskWitness: null,
    previewDigest: `sha256:${'b'.repeat(64)}`, authorizationTag: `l14tag_${'3'.repeat(64)}`, externalActionAuthorization: 'NONE',
  };
  const receipt = {
    schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1', version: 1, commandId: preview.commandId, previewDigest: preview.previewDigest,
    actionType: 'HALT', disposition: 'NOOP', reasonCode: 'CONTROL_NOOP', actorBinding: preview.actorBinding,
    expectedConfigVersion: 4, committedControlRevision: 10, applied: false, recordedAtMs: PRODUCT_FIXTURE_NOW_MS,
    ledgerEventIds: [51, 52], recoveryStateChanged: false, externalActionAuthorization: 'NONE',
  };
  const control = createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14', preview, receipt });
  const symbolAction = { ...action };
  symbolAction[Symbol('forgedAuthority')] = 'LIVE';
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-symbol', preview: { ...preview, action: symbolAction }, receipt }), /not bound|exact/);
  const inheritedAction = Object.assign(Object.create({ forgedAuthority: 'LIVE' }), action);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-prototype', preview: { ...preview, action: inheritedAction }, receipt }), /not bound|exact/);
  const accessorAction = { type: 'HALT', retainSupervision: true };
  Object.defineProperty(accessorAction, 'scope', { enumerable: true, get() { throw new Error('must not invoke'); } });
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-accessor', preview: { ...preview, action: accessorAction }, receipt }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-malformed', preview: { ...preview, action: { type: 'HALT', scope: 'WRONG_SCOPE', retainSupervision: false, injectedAuthority: 'LIVE' } }, receipt }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-risk', preview: { ...preview, riskWitness: { authority: 'FOUNDATION_RISK', injectedAuthority: 'LIVE' } }, receipt }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-receipt', preview, receipt: { ...receipt, disposition: 'GARBAGE', reasonCode: 'FAKE', ledgerEventIds: [-1, -2] } }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-reason', preview: { ...preview, reason: 'https://untrusted.example/x' }, receipt }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-awareness-wrong-action', preview, receipt: { ...receipt, disposition: 'AWARENESS_RECORDED', reasonCode: 'AWARENESS_RECORDED' } }), /not bound|exact/);
  const positionRef = { schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1', owner: 'CAPITAL_POSITIONS', id: 'position-1', revision: 'position-revision-1', digest: `sha256:${'c'.repeat(64)}` };
  const waitingRef = { schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1', owner: 'L08_RECOVERY', id: 'policy-1', revision: 'policy-revision-1', digest: `sha256:${'d'.repeat(64)}`, validation: 'WAITING_L08' };
  const riskBound = { measure: { schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1', owner: 'FOUNDATION_RISK', id: 'risk-1', revision: 'risk-revision-1', digest: `sha256:${'e'.repeat(64)}` }, maximumPostActionValue: '1.5' };
  const invalidReducePreview = { ...preview, action: { type: 'REDUCE', position: positionRef, reductionBps: 10_001, orderPolicy: waitingRef, riskBound } };
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-reduce', preview: invalidReducePreview, receipt: { ...receipt, actionType: 'REDUCE' } }), /not bound|exact/);
  const componentRef = { schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1', owner: 'FOUNDATION_CONTROL', id: 'component-1', revision: 'component-revision-1', digest: `sha256:${'f'.repeat(64)}` };
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-config', preview: { ...preview, action: { type: 'UPDATE_BOUNDED_CONFIGURATION', change: { setting: 'COMPONENT_STEP_TIMEOUT_MS', component: componentRef, valueMs: 99 } } }, receipt: { ...receipt, actionType: 'UPDATE_BOUNDED_CONFIGURATION' } }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-revoke', preview: { ...preview, action: { type: 'REVOKE', targetKind: 'RESERVATION', target: { ...positionRef, owner: 'CAPITAL_APPROVALS' } } }, receipt: { ...receipt, actionType: 'REVOKE' } }), /not bound|exact/);
  assert.throws(() => createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-risk-semantic', preview: { ...preview, riskWitness: { truthRevision: '', measureRevision: '', currentValue: 'NaN', maximumPostActionValue: '-1', evaluatedAtMs: PRODUCT_FIXTURE_NOW_MS, authority: 'FOUNDATION_RISK' } }, receipt }), /not bound|exact/);
  const previewRequest = { schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, action, expectedConfigVersion: 4, reason: preview.reason, ttlMs: 1_000 };
  assert.equal((await control.preview(previewRequest)).ok, true);
  assert.equal((await control.preview({ ...previewRequest, ttlMs: 999 })).ok, false);
  assert.equal((await control.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview })).value.disposition, 'NOOP');
  assert.equal((await control.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: { ...preview, previewDigest: 'c'.repeat(64) } })).ok, false);
  const awarenessAction = { type: 'ACKNOWLEDGE_RECOVERY', recovery: { schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1', owner: 'FOUNDATION_EXECUTION', id: 'recovery-1', revision: 'recovery-revision-1', digest: '7'.repeat(64) }, observedRecoveryRevision: 'recovery-revision-1', statement: 'AWARENESS_ONLY' };
  const awarenessPreview = { ...preview, commandId: `cmd_${'4'.repeat(16)}`, action: awarenessAction, actionDigest: `sha256:${'6'.repeat(64)}`, previewDigest: `sha256:${'5'.repeat(64)}` };
  const awarenessReceipt = { ...receipt, commandId: awarenessPreview.commandId, previewDigest: awarenessPreview.previewDigest, actionType: 'ACKNOWLEDGE_RECOVERY', disposition: 'AWARENESS_RECORDED', reasonCode: 'AWARENESS_RECORDED' };
  const awareness = createL14DurableControlFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-awareness', preview: awarenessPreview, receipt: awarenessReceipt });
  assert.equal((await awareness.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: awarenessPreview })).value.disposition, 'AWARENESS_RECORDED');
  const expired = createL14DurableControlFixture({ nowMs: preview.expiresAtMs, correlationId: 'fixture-l14-expired', preview, receipt });
  assert.equal((await expired.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview })).ok, false);

  const event = l14Event({ schema: 'LIVE_EDGE_CONTROL_EVENT_V1', version: 1, kind: 'CONTROL_APPLIED', commandId: preview.commandId, previewDigest: preview.previewDigest, actionType: 'HALT', actorBinding: preview.actorBinding, expectedConfigVersion: 4, expectedControlRevision: 9, occurredAtMs: PRODUCT_FIXTURE_NOW_MS, applied: false, reasonCode: 'CONTROL_NOOP', recoveryStateChanged: false, externalActionAuthorization: 'NONE' });
  const append = l14Append(event, 1, `l14head_${'f'.repeat(64)}`);
  const acknowledgement = { schema: 'LIVE_EDGE_CONTROL_EVENT_ACK_V1', version: 1, owner: 'SYSTEM_INTEGRATION_LEDGER', disposition: 'COMMITTED_NEW', commandId: preview.commandId, eventId: event.eventId, idempotencyKey: append.idempotencyKey, appendRequestDigest: append.appendRequestDigest, expectedJournalVersion: 1, committedJournalVersion: 2, previousHeadDigest: append.previousHeadDigest, committedHeadDigest: append.nextHeadDigest, appendedCount: 1, ledgerEventId: 52, committedAtMs: PRODUCT_FIXTURE_NOW_MS, currentConfigVersion: 4, currentControlRevision: 10, failureCode: null, externalActionAuthorization: 'NONE' };
  const rejection = { schema: 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1', version: 1, commandId: `cmd_${'7'.repeat(16)}`, previewDigest: `sha256:${'9'.repeat(64)}`, actionType: 'HALT', actorBinding: preview.actorBinding, reasonCode: 'OWNER_REJECTED', expectedConfigVersion: 4, committedControlRevision: 10, recordedAtMs: PRODUCT_FIXTURE_NOW_MS, ledgerEventIds: [61, 62], recoveryStateChanged: false, externalActionAuthorization: 'NONE' };
  const persistence = createL14ControlPersistenceFixture({
    nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-persistence', request: append, acknowledgement,
    lookups: {
      [`cmd_${'8'.repeat(16)}`]: { kind: 'PENDING', previewDigest: preview.previewDigest, actorBinding: preview.actorBinding, journalVersion: 1, headDigest: append.previousHeadDigest },
      [preview.commandId]: { kind: 'COMPLETED', previewDigest: preview.previewDigest, actorBinding: preview.actorBinding, journalVersion: 2, headDigest: append.nextHeadDigest, receipt },
      [rejection.commandId]: { kind: 'REJECTED', previewDigest: rejection.previewDigest, actorBinding: rejection.actorBinding, journalVersion: 2, headDigest: `l14head_${'8'.repeat(64)}`, rejection },
    },
  });
  assert.throws(() => createL14ControlPersistenceFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-event-invalid', request: { ...append, event: { ...event, injectedAuthority: 'LIVE' } }, acknowledgement, lookups: {} }), /exact closed/);
  const eventDraft = { ...event };
  delete eventDraft.eventId;
  delete eventDraft.contentDigest;
  const forgedCanonicalEvent = l14Event({ ...eventDraft, reasonCode: 'FAKE' });
  const forgedAppend = l14Append(forgedCanonicalEvent, 1, append.previousHeadDigest);
  assert.throws(() => createL14ControlPersistenceFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-event-semantic', request: forgedAppend, acknowledgement, lookups: {} }), /exact closed/);
  assert.throws(() => createL14ControlPersistenceFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-ack-invalid', request: append, acknowledgement: { ...acknowledgement, disposition: 'GARBAGE', ledgerEventId: null }, lookups: {} }), /exact closed/);
  assert.throws(() => createL14ControlPersistenceFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-l14-lookup-invalid', request: append, acknowledgement, lookups: { malformed: { kind: 'PENDING', journalVersion: -1, headDigest: null } } }), /exact closed/);
  assert.equal((await persistence.lookup('missing-command')).kind, 'NOT_FOUND');
  assert.equal((await persistence.lookup(`cmd_${'8'.repeat(16)}`)).kind, 'PENDING');
  assert.equal((await persistence.lookup(preview.commandId)).kind, 'COMPLETED');
  assert.equal((await persistence.lookup(rejection.commandId)).kind, 'REJECTED');
  assert.equal((await persistence.append(append)).disposition, 'COMMITTED_NEW');
  assert.equal((await persistence.append({ ...append, nextHeadDigest: '2'.repeat(64) })).disposition, 'FAILED');
});

test('accepted dashboard donor bridge preserves snapshot and before/after control receipt', async () => {
  const controlState = { revision: 2, generation: 1, safeMode: 'VALIDATE_ONLY', killSwitchEngaged: true, intakePaused: true, updatedAtMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'trace-dashboard' };
  const engineSummary = { truthLabel: 'SYNTHETIC_ONLY', heartbeatAtMs: null, candidateCount: null, proposalCount: null, cooldownCount: null, rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null, sourceRevision: null };
  const summaries = {
    sourceCoverage: { truthLabel: 'SYNTHETIC_ONLY', universeSymbols: null, spotCoveredSymbols: null, usdMCoveredSymbols: null, quietSymbolsRetained: null, materialGapCount: null, rateLimitedSourceCount: null, lastMaterialGapAtMs: null },
    strategies: { basis: engineSummary, volume: engineSummary },
    intelligence: { truthLabel: 'UNAVAILABLE', evidenceCount: null, attentionCount: null, focusRequestedCount: null, focusActiveCount: null, thesisCount: null, insufficientEvidenceCount: null, lastUpdateAtMs: null },
    capital: { truthLabel: 'UNAVAILABLE', accountTruthState: 'UNAVAILABLE', allocatableAmount: null, reservedAmount: null, activeExposureAmount: null, eligibleCount: null, reservationCount: null, stagedMandateCount: null, activeExposureCount: null, recoveryCount: null, checkpointRevision: null, blockerCodes: ['SYNTHETIC_ONLY'] },
    risk: { truthLabel: 'UNAVAILABLE', latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: null, latestVerdictId: null, correlationId: null, maxAllowedSize: null, requiredConfirmation: null, decisiveInputSnapshot: [], rejectionCount: null, reasonCodes: ['SYNTHETIC_ONLY'] },
    execution: { truthLabel: 'UNAVAILABLE', mode: 'UNAVAILABLE', barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED', planId: null, planLifecycle: null, coordinatorState: 'UNAVAILABLE', legCount: null, recoveryState: null, lastTransitionAtMs: null },
    reconciliation: { truthLabel: 'UNAVAILABLE', status: 'UNAVAILABLE', blocksNewExposure: true, recommendation: null, checkpointId: null, evaluatedAtMs: null, reasonCodes: ['SYNTHETIC_ONLY'] },
    ledger: { truthLabel: 'SYNTHETIC_ONLY', writable: true, lastEventId: null, lastPersistedAtMs: null, checkpointRevision: null, recentTraceCount: null, lastCleanShutdownAtMs: null },
  };
  const snapshot = { schemaVersion: 1, revision: 5, evaluatedAtMs: PRODUCT_FIXTURE_NOW_MS, phase: 'RUNNING', overallPosture: 'DEGRADED', truthLabel: 'SYNTHETIC_ONLY', runtimeGeneration: 1, controlGeneration: 1, control: controlState, components: [], edges: [], firstRootBlockerComponentId: null, rootBlockerComponentIds: [], operatorAttentionComponentIds: [], attentionQueue: [], summaries, recentCorrelatedDecisions: [] };
  const receipt = { applied: false, code: 'CONTROL_NOOP', before: controlState, after: controlState, ledgerEventId: 71 };
  const mutation = { command: 'SET_KILL_SWITCH', engaged: true };
  const bridge = createDashboardDonorBridgeFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-dashboard-donor', snapshot, mutation, receipt });
  assert.throws(() => createDashboardDonorBridgeFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-dashboard-malformed', snapshot: { ...snapshot, components: [{}], edges: [{}], attentionQueue: [{}], recentCorrelatedDecisions: [{}] }, mutation, receipt }), /invalid/);
  const approvedRisk = {
    ...summaries.risk,
    truthLabel: 'DRY_RUN', latestVerdict: 'APPROVE', latestVerdictAtMs: PRODUCT_FIXTURE_NOW_MS,
    latestVerdictId: 'risk-1', correlationId: 'corr-risk-1', maxAllowedSize: '1', requiredConfirmation: false,
    decisiveInputSnapshot: [{ code: 'MAX_GROSS_NOTIONAL', status: 'PASS', detail: 'Exact gross passed.', observed: '1', limit: '2', evidenceTimestamp: PRODUCT_FIXTURE_NOW_MS }],
    rejectionCount: 0, reasonCodes: [],
  };
  const withRisk = (risk) => ({ ...snapshot, summaries: { ...summaries, risk } });
  assert.doesNotThrow(() => createDashboardDonorBridgeFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: 'fixture-dashboard-risk-valid', snapshot: withRisk(approvedRisk), mutation, receipt }));
  for (const [index, hostileRisk] of [
    { ...approvedRisk, correlationId: null },
    { ...approvedRisk, correlationId: '-malformed' },
    { ...approvedRisk, correlationId: 123 },
    { ...approvedRisk, latestVerdict: ['APPROVE'] },
    { ...approvedRisk, maxAllowedSize: '1'.repeat(81) },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], code: ['MAX_GROSS_NOTIONAL'] }] },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], status: ['PASS'] }] },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], detail: '   ' }] },
    { ...approvedRisk, reasonCodes: [['MAX_GROSS_NOTIONAL']] },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], status: 'FAIL' }], reasonCodes: ['MAX_GROSS_NOTIONAL'] },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], observed: '' }] },
    { ...approvedRisk, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], limit: 'x'.repeat(301) }] },
    { ...approvedRisk, latestVerdict: 'NEEDS_REVIEW', maxAllowedSize: null, requiredConfirmation: true, decisiveInputSnapshot: [{ ...approvedRisk.decisiveInputSnapshot[0], status: 'UNKNOWN' }], reasonCodes: ['OTHER_CODE'] },
  ].entries()) {
    assert.throws(() => createDashboardDonorBridgeFixture({ nowMs: PRODUCT_FIXTURE_NOW_MS, correlationId: `fixture-dashboard-risk-hostile-${index}`, snapshot: withRisk(hostileRisk), mutation, receipt }), /invalid/);
  }
  assert.deepEqual(bridge.readSnapshot().value, snapshot);
  assert.deepEqual(bridge.readLastReceipt().value, receipt);
  assert.equal((await bridge.mutate({ mutation, reason: 'already safe' })).value.code, 'CONTROL_NOOP');
  assert.equal((await bridge.mutate({ mutation, reason: '' })).ok, false);
  assert.equal((await bridge.mutate({ mutation: { command: 'SET_KILL_SWITCH', engaged: false }, reason: 'unsafe mismatch' })).ok, false);
});
