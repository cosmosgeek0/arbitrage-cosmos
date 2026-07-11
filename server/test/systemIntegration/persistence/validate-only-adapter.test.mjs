import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SystemIntegrationLedgerAdapter,
} from '../../../dist/systemIntegration/persistence/index.js';
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

test('mode-blocked denial persists unavailable truth without WIRED or dry-run claims', async () => {
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
    assert.equal(trace.value.events.at(-1).event.truthLabel, 'UNAVAILABLE');
    assert.equal(trace.value.events.at(-1).event.releaseStatuses.includes('WIRED'), false);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
