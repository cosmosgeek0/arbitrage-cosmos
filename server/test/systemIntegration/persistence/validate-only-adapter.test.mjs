import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SystemIntegrationLedgerAdapter,
  createInitialCheckpointState,
  encodeSystemCheckpoint,
  persistenceDigest,
} from '../../../dist/systemIntegration/persistence/index.js';
import { buildSystemTraceIndex } from '../../../dist/systemIntegration/supervisor/index.js';
import { ValidateOnlyOrchestrator } from '../../../dist/systemIntegration/verticalSlice/index.js';
import { NOW, buildValidateOnlyInput } from '../verticalSlice/fixtures.mjs';

async function captureRecord(input) {
  let captured = null;
  const result = await new ValidateOnlyOrchestrator({
    async loadValidateOnlyApprovalState() { return null; },
    async persistValidateOnly(record) {
      captured = JSON.parse(JSON.stringify(record));
      return { persistenceId: `capture:${record.recordId}` };
    },
  }).execute(input);
  assert.notEqual(captured, null);
  return { result, record: captured };
}

async function assertDurableRiskDecision(record, expectedDecision) {
  const dataDir = mkdtempSync(path.join(tmpdir(), `cosmos-risk-${expectedDecision.toLowerCase()}-audit-`));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(persistence.load(NOW - 100, `validate.risk.${expectedDecision.toLowerCase()}.load`).ok, true);
    await persistence.persistValidateOnly(record);
    const event = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND)
      .find((entry) => entry.data?.trace?.kind === 'RISK');
    assert.notEqual(event, undefined);
    assert.deepEqual(Object.keys(event.data.riskDecision).sort(), ['recordId', 'schema', 'verdict']);
    assert.equal(event.data.riskDecision.schema, 'cosmos.foundation.risk-verdict.audit.v1');
    assert.equal(event.data.riskDecision.recordId, record.recordId);
    assert.equal(event.data.riskDecision.verdict.decision, expectedDecision);
    assert.deepEqual(event.data.riskDecision.verdict, record.riskVerdict);
    assert.equal(event.data.trace.correlationId, record.riskVerdict.correlationId);
    assert.equal(event.data.trace.referenceIds.includes(record.recordId), true);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('production persistence port commits one bounded VALIDATE_ONLY run and replays it exactly once', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-validate-only-ledger-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(persistence.load(NOW - 100, 'validate.persistence.load').ok, true);
    assert.equal(persistence.persistStartup({
      startedAtMs: NOW - 50,
      correlationId: 'validate.persistence.start',
    }).ok, true);
    const orchestrator = new ValidateOnlyOrchestrator(persistence);
    const first = await orchestrator.execute(buildValidateOnlyInput());
    assert.equal(first.ok, true, first.snapshot.failure?.code);
    assert.match(first.snapshot.persistenceId, /^ledger-checkpoint:/);
    assert.equal(first.snapshot.venueAudit.submissionCalls, 0);
    assert.equal(first.snapshot.venueAudit.lookupCalls, 0);
    assert.equal(first.snapshot.venueAudit.reconciliationCalls, 0);
    assert.equal(first.snapshot.ownerInvocations.persistenceReads, 1);
    const latestApproval = await persistence.loadValidateOnlyApprovalState(first.snapshot.approvalId);
    assert.deepEqual(latestApproval, first.snapshot.approvalState);
    const trace = persistence.queryTrace({ correlationId: first.snapshot.rootCorrelationId, limit: 20 });
    assert.equal(trace.ok, true);
    const riskTrace = trace.value.events.find(({ event }) => event.kind === 'RISK');
    assert.equal(first.snapshot.riskVerdict.correlationId, first.snapshot.rootCorrelationId);
    assert.equal(riskTrace.event.correlationId, first.snapshot.riskVerdict.correlationId);
    assert.equal(riskTrace.event.referenceIds.includes(first.snapshot.boundRiskDecision.decisionId), true);
    assert.deepEqual(
      trace.value.events.map(({ event }) => [event.kind, event.componentId]),
      [
        ['CAPITAL', 'capital-supervision'],
        ['RISK', 'multileg-risk'],
        ['EXECUTION', 'execution-coordinator-validate-only'],
        ['RECONCILIATION', 'reconciliation'],
        ['EXECUTION', 'execution-coordinator-validate-only'],
        ['PERSISTENCE', 'ledger-persistence'],
      ],
    );
    assert.equal(first.snapshot.ownerInvocations.recoveryEvaluations, 1);
    assert.deepEqual(first.snapshot.recoveryRecommendations.map((entry) => entry.action), ['NO_ACTION']);
    assert.equal(trace.value.events.at(-2).event.domainLifecycle, 'RECOVERY:NO_ACTION');
    assert.equal(trace.value.events.at(-1).event.truthLabel, 'RECORDED_REPLAY');
    assert.deepEqual(trace.value.events.at(-1).event.releaseStatuses, ['WIRED']);
    assert.equal(new Set(trace.value.events.map(({ ledgerEventId }) => ledgerEventId)).size, 6);
    const atomicAuditRows = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND)
      .filter((event) => event.data.correlationId === first.snapshot.rootCorrelationId);
    assert.equal(atomicAuditRows.length, 6);
    assert.equal(new Set(atomicAuditRows.map((event) => event.data.checkpointRevision)).size, 1);
    assert.equal(new Set(atomicAuditRows.map((event) => event.data.checkpointChecksum)).size, 1);
    const durableRisk = atomicAuditRows.find((event) => event.data.trace?.kind === 'RISK');
    assert.deepEqual(durableRisk.data.riskDecision.verdict, first.snapshot.riskVerdict);
    assert.equal(durableRisk.data.riskDecision.verdict.decision, 'APPROVED');
    const eventCount = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length;

    const replayInput = buildValidateOnlyInput();
    replayInput.capital.approvalState = first.snapshot.approvalState;
    const replay = await new ValidateOnlyOrchestrator(persistence).execute(replayInput);
    assert.equal(replay.ok, true, replay.snapshot.failure?.code);
    assert.equal(replay.snapshot.persistenceId, first.snapshot.persistenceId);
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);

    const state = persistence.currentState().value;
    assert.equal(state.dryRunExecutions.length, 1);
    assert.equal(state.dryRunExecutions[0].dryRun, true);
    assert.equal(state.dryRunExecutions[0].requiresReconciliation, false);
    assert.equal(state.reconciliations.length, 1);
    assert.equal(state.reconciliations[0].domainStatus, 'EXACT');
    assert.equal(state.reconciliations[0].allowsNewExposure, true);

    const forgedSameRevision = JSON.parse(JSON.stringify(first.snapshot));
    delete forgedSameRevision.persistenceId;
    forgedSameRevision.recordId = 'forged-same-revision-approval-history';
    forgedSameRevision.approvalState.uses[0].idempotencyKey = 'forged.approval.use.0001';
    await assert.rejects(
      () => persistence.persistValidateOnly(forgedSameRevision),
      /compare-and-set conflict/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);
    assert.deepEqual(await persistence.loadValidateOnlyApprovalState(first.snapshot.approvalId), first.snapshot.approvalState);

    const restarted = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(restarted.load(NOW + 1, 'validate.persistence.restart').ok, true);
    assert.deepEqual(await restarted.loadValidateOnlyApprovalState(first.snapshot.approvalId), first.snapshot.approvalState);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Ledger risk projection preserves review evidence and rejects every forged semantic field before write', async () => {
  const unknownInput = buildValidateOnlyInput();
  unknownInput.riskEvidence.market = null;
  const unknown = await captureRecord(unknownInput);
  assert.equal(unknown.result.snapshot.disposition, 'RISK_REJECTED');
  assert.equal(unknown.record.riskVerdict.decision, 'NEEDS_REVIEW');
  assert.equal(unknown.record.riskVerdict.allowed, false);
  assert.equal(unknown.record.riskVerdict.requiredConfirmation, true);
  assert.equal(unknown.record.riskVerdict.maxAllowedSize, null);
  assert.equal(unknown.record.riskVerdict.correlationId, unknown.record.rootCorrelationId);
  assert.deepEqual(
    unknown.record.riskVerdict.decisiveInputSnapshot.checks.map((check) => check.code),
    unknown.record.riskVerdict.blockingCodes,
  );
  assert.equal(
    unknown.record.riskVerdict.decisiveInputSnapshot.checks.some((check) => check.observed === null),
    true,
  );

  const ready = await captureRecord(buildValidateOnlyInput());
  const rejectedInput = buildValidateOnlyInput();
  rejectedInput.riskEvidence.killSwitch.engaged = true;
  rejectedInput.riskEvidence.killSwitch.reason = 'hostile known rejection';
  const rejected = await captureRecord(rejectedInput);
  assert.equal(rejected.record.riskVerdict.decision, 'REJECTED');
  await assertDurableRiskDecision(unknown.record, 'NEEDS_REVIEW');
  await assertDurableRiskDecision(rejected.record, 'REJECTED');
  const forgeries = [
    (record) => { delete record.riskVerdict.decision; },
    (record) => { record.riskVerdict.unreviewedField = true; },
    (record) => { record.riskVerdict.correlationId = 'forged.correlation'; },
    (record) => { record.riskVerdict.requiredConfirmation = true; },
    (record) => { record.riskVerdict.maxAllowedSize = 999; },
    (record) => { record.riskVerdict.maxAllowedSize = -1; },
    (record) => {
      record.riskVerdict.decision = 'REJECTED';
      record.riskVerdict.allowed = false;
      record.riskVerdict.maxAllowedSize = 0;
      record.riskVerdict.decisiveInputSnapshot.checks = [];
    },
    (record) => { record.riskVerdict.decisiveInputSnapshot.checks.reverse(); },
    (record) => { record.boundRiskDecision.unreviewedField = true; },
    (record) => { record.boundRiskDecision.mandateRevision += 1; },
    (record) => { record.boundRiskDecision.verdict.maxAllowedSize = '999'; },
  ];
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-risk-projection-forgery-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(persistence.load(NOW - 100, 'validate.risk-forgery.load').ok, true);
    for (const forge of forgeries) {
      const record = JSON.parse(JSON.stringify(ready.record));
      forge(record);
      await assert.rejects(
        () => persistence.persistValidateOnly(record),
        /risk verdict projection is invalid|execution plan is invalid/i,
      );
    }
    const whitespaceReason = JSON.parse(JSON.stringify(unknown.record));
    const decisive = whitespaceReason.riskVerdict.decisiveInputSnapshot.checks[0];
    const matchingCheck = whitespaceReason.riskVerdict.checks.find((check) => check.code === decisive.code);
    assert.ok(matchingCheck, 'self-consistent whitespace hostile requires its full canonical check');
    decisive.detail = '   ';
    matchingCheck.detail = '   ';
    await assert.rejects(
      () => persistence.persistValidateOnly(whitespaceReason),
      /risk verdict projection is invalid/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, 0);
    assert.equal(persistence.currentState().value.revision, 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('validate-only persistence rejects any run claiming a reached venue action seam without a Ledger write', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-validate-only-tripwire-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    persistence.load(NOW - 100, 'validate.tripwire.load');
    const memoryRecord = {};
    const result = await new ValidateOnlyOrchestrator({
      async loadValidateOnlyApprovalState() { return null; },
      async persistValidateOnly(record) {
        Object.assign(memoryRecord, JSON.parse(JSON.stringify(record)));
        return { persistenceId: 'captured:validate-only' };
      },
    }).execute(buildValidateOnlyInput());
    assert.equal(result.ok, true);
    memoryRecord.venueAudit.submissionCalls = 1;
    const before = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length;
    await assert.rejects(
      () => persistence.persistValidateOnly(memoryRecord),
      /out-of-process action seam/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, before);
    assert.equal(persistence.currentState().value.revision, 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('validate-only persistence rejects forged recovery output and impossible owner invocation counts without a Ledger write', async () => {
  const captured = await captureRecord(buildValidateOnlyInput());
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-validate-only-recovery-forgery-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(persistence.load(NOW - 100, 'validate.recovery-forgery.load').ok, true);
    const forgedRecovery = JSON.parse(JSON.stringify(captured.record));
    forgedRecovery.executionState.lifecycle = 'RECOVERY_REQUIRED';
    await assert.rejects(
      () => persistence.persistValidateOnly(forgedRecovery),
      /differs from the canonical owner projection/i,
    );
    const impossibleCount = JSON.parse(JSON.stringify(captured.record));
    impossibleCount.ownerInvocations.riskEvaluations = 2;
    await assert.rejects(
      () => persistence.persistValidateOnly(impossibleCount),
      /owner invocation evidence is malformed/i,
    );
    const malformedFailure = JSON.parse(JSON.stringify(captured.record));
    malformedFailure.failure = { stage: 'risk', code: 'FORGED' };
    await assert.rejects(
      () => persistence.persistValidateOnly(malformedFailure),
      /structured failure is invalid/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, 0);
    assert.equal(persistence.currentState().value.revision, 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('final supervision projection persists and replays exactly while unknown fields and risk-plan drift fail closed', async () => {
  const prior = await captureRecord(buildValidateOnlyInput());
  assert.equal(prior.result.ok, true);
  const input = buildValidateOnlyInput();
  input.riskEvidence.killSwitch.engaged = true;
  input.riskEvidence.killSwitch.reason = 'persistence supervision containment';
  input.supervision = {
    rootCorrelationId: 'prior.persistence.supervision',
    state: JSON.parse(JSON.stringify(prior.result.snapshot.executionState)),
    truthLabel: 'SYNTHETIC_ONLY',
    executionAuthority: 'NONE',
  };
  const captured = await captureRecord(input);
  assert.equal(captured.result.snapshot.disposition, 'RISK_REJECTED');
  assert.notEqual(captured.record.supervision, null);
  assert.equal(captured.record.riskPlanBinding, null, 'supervision-only records cannot borrow the current-plan binding');

  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-supervision-ledger-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    persistence.load(NOW - 100, 'supervision.persistence.load');
    const orchestrator = new ValidateOnlyOrchestrator(persistence);
    const first = await orchestrator.execute(input);
    assert.equal(first.snapshot.disposition, 'RISK_REJECTED');
    assert.notEqual(first.snapshot.persistenceId, null, first.snapshot.failure?.code);
    const eventCount = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length;
    input.capital.approvalState = first.snapshot.approvalState;
    const replay = await new ValidateOnlyOrchestrator(persistence).execute(input);
    assert.equal(replay.snapshot.persistenceId, first.snapshot.persistenceId);
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);
    const durable = persistence.currentState().value;
    assert.ok(durable.reconciliations.some((entry) => entry.planId === first.snapshot.supervision.planId));
    assert.equal(durable.reconciliations.find((entry) => entry.planId === first.snapshot.supervision.planId).allowsNewExposure, false);

    const topLevelUnknown = { ...captured.record, unreviewedField: true };
    await assert.rejects(
      () => persistence.persistValidateOnly(topLevelUnknown),
      /missing or unknown fields/i,
    );
    const nestedUnknown = JSON.parse(JSON.stringify(captured.record));
    nestedUnknown.supervision.unreviewedField = true;
    await assert.rejects(
      () => persistence.persistValidateOnly(nestedUnknown),
      /supervision projection is invalid/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);

    const ready = await captureRecord(buildValidateOnlyInput());
    const missingBinding = JSON.parse(JSON.stringify(ready.record));
    missingBinding.riskPlanBinding = null;
    await assert.rejects(
      () => persistence.persistValidateOnly(missingBinding),
      /execution plan is invalid/i,
    );
    const driftedBinding = JSON.parse(JSON.stringify(ready.record));
    driftedBinding.riskPlanBinding.foundationTermsFingerprint = 'drifted-foundation-fingerprint';
    await assert.rejects(
      () => persistence.persistValidateOnly(driftedBinding),
      /execution plan is invalid/i,
    );
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('mode-blocked denial persists no domain-stage wiring claim while the real Ledger receipt stays explicit', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-mode-denial-ledger-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    persistence.load(NOW - 100, 'mode.denial.load');
    const input = buildValidateOnlyInput();
    input.requestedMode = 'EXECUTION_LIVE';
    const result = await new ValidateOnlyOrchestrator(persistence).execute(input);
    assert.equal(result.snapshot.disposition, 'MODE_BLOCKED');
    assert.notEqual(result.snapshot.persistenceId, null, result.snapshot.failure?.code);
    assert.deepEqual(result.snapshot.truthLabels, ['UNAVAILABLE', 'SYNTHETIC_ONLY']);
    assert.equal(result.snapshot.capitalReservationDialect, 'UNAVAILABLE_OR_UNVALIDATED');
    assert.equal(result.snapshot.releaseStatuses.includes('WIRED'), false);
    const trace = persistence.queryTrace({ correlationId: result.snapshot.rootCorrelationId });
    assert.equal(trace.ok, true);
    assert.equal(trace.value.events.length, 1);
    assert.equal(trace.value.events[0].event.kind, 'PERSISTENCE');
    assert.equal(trace.value.events[0].event.truthLabel, 'RECORDED_REPLAY');
    assert.equal(trace.value.events[0].event.machinePhase, 'RUNNING');
    assert.deepEqual(trace.value.events[0].event.releaseStatuses, ['WIRED']);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('maximum bounded correlation keeps every reached trace visible to supervisor and Product operator readback', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-validate-only-max-correlation-'));
  const ledger = new Ledger(dataDir);
  try {
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    const input = buildValidateOnlyInput();
    const correlationId = `c${'x'.repeat(127)}`;
    input.correlationId = correlationId;
    input.capital.sourceProposal.sourceCorrelationId = correlationId;
    assert.equal(persistence.load(NOW - 100, 'validate.max-correlation.load').ok, true);
    const result = await new ValidateOnlyOrchestrator(persistence).execute(input);
    assert.equal(result.ok, true, result.snapshot.failure?.code);
    const trace = persistence.queryTrace({ correlationId, limit: 20 });
    assert.equal(trace.ok, true);
    assert.equal(trace.value.events.length, 6);
    assert.equal(trace.value.events.every(({ event }) => event.id.length <= 160), true);
    const supervisor = buildSystemTraceIndex(trace.value.events.map(({ event }) => event), NOW);
    assert.equal(supervisor.entries.find((entry) => entry.correlationId === correlationId).snapshot.events.length, 6);
    const product = ledger.readProductOperatorEventPage('0', 20);
    assert.equal(product.items.filter((entry) => entry.event.correlationId === correlationId).length, 5);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('v2 recovery evidence never conflicts with a durable legacy v1 validate-only receipt', async () => {
  const input = buildValidateOnlyInput();
  const captured = await captureRecord(input);
  const legacyRecord = JSON.parse(JSON.stringify(captured.record));
  legacyRecord.schema = 'cosmos.system-integration.validate-only.v1';
  delete legacyRecord.recoveryRecommendations;
  delete legacyRecord.ownerInvocations.recoveryEvaluations;
  const legacyKey = `validate-only:${persistenceDigest(legacyRecord.recordId).slice(0, 64)}`;
  const initial = createInitialCheckpointState(NOW - 200, 'validate.legacy.initial');
  const legacyState = {
    ...initial,
    revision: 1,
    idempotencyReceipts: [{
      idempotencyKey: legacyKey,
      requestDigest: persistenceDigest(legacyRecord),
      correlationId: legacyRecord.rootCorrelationId,
      recordedAtMs: legacyRecord.evaluatedAtMs,
      checkpointRevision: 1,
      receipt: { kind: 'VALIDATE_ONLY_RUN', record: legacyRecord },
    }],
  };
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-validate-only-v1-upgrade-'));
  const ledger = new Ledger(dataDir);
  try {
    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, encodeSystemCheckpoint(legacyState));
    const persistence = new SystemIntegrationLedgerAdapter(ledger);
    assert.equal(persistence.load(NOW, 'validate.legacy.load').ok, true);
    const result = await new ValidateOnlyOrchestrator(persistence).execute(buildValidateOnlyInput());
    assert.equal(result.snapshot.disposition, 'APPROVAL_REJECTED');
    assert.notEqual(result.snapshot.disposition, 'PERSISTENCE_FAILED');
    assert.notEqual(result.snapshot.persistenceId, null);
    const keys = persistence.currentState().value.idempotencyReceipts.map((entry) => entry.idempotencyKey);
    assert.equal(keys.includes(legacyKey), true);
    assert.equal(keys.some((key) => key.startsWith('validate-only:v2:')), true);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
