import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { evaluateConservationAccounting } from '../../../../fixtures/productAssurance/systemic/observability/conservation-evaluator.mjs';

const fixtureUrl = new URL('../../../../fixtures/productAssurance/systemic/observability/cases/conservation-replay-balanced.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function removeExport(record) {
  record.counts.exported = 0;
  record.transitions = record.transitions.filter((transition) => transition.state !== 'EXPORTED');
  record.transitions.forEach((transition, index) => { transition.sequence = index + 1; });
}

test('balanced accounting counts and reconciles duplicate replay without exactly-once claims', async () => {
  const input = await fixture();
  const output = evaluateConservationAccounting(input);
  assert.equal(output.overallResult, 'PASS');
  assert.equal(output.greenEligible, true);
  assert.equal(output.transportGuarantee, 'NOT_GLOBAL_EXACTLY_ONCE');
  assert.equal(output.denominatorCount, 2);
  assert.equal(output.accountedCount, 2);
  assert.equal(output.logicalDuplicateCount, 1);
  assert.equal(output.logicalReplayCount, 1);
  assert.equal(output.exportReplayCount, 0);
  assert.equal(Object.isFrozen(output), true);
  assert.deepEqual(output.reasonRegistry, {
    schemaVersion: 'reason-code-registry.v1',
    registryId: 's5-conservation-stage-reasons',
    registryRevision: 1,
    registrySha256: 'b7566667d11bd720663ede56d0f3405fbf45cd53b2c71abd8e231dc2fbe1bc68',
    codeCount: 6,
  });
});

test('unregistered or context-invalid reason codes are rejected while null remains valid', async () => {
  const unknownTransition = await fixture();
  unknownTransition.records[0].transitions[0].reasonCode = 'CALLER_INVENTED_REASON';
  assert.throws(
    () => evaluateConservationAccounting(unknownTransition),
    /not registered in s5-conservation-stage-reasons/,
  );

  const unknownDisposition = await fixture();
  unknownDisposition.records[0].disposition.reasonCode = 'CALLER_INVENTED_REASON';
  assert.throws(
    () => evaluateConservationAccounting(unknownDisposition),
    /not registered in s5-conservation-stage-reasons/,
  );

  const wrongContext = await fixture();
  wrongContext.records[0].disposition.reasonCode = 'DROP_CONFLICT';
  assert.throws(() => evaluateConservationAccounting(wrongContext), /not registered for DISPOSITION/);

  const nullReasons = await fixture();
  assert.equal(evaluateConservationAccounting(nullReasons).overallResult, 'PASS');
});

test('missing expected event-stage-window tuple is UNKNOWN, never an implicit zero or green', async () => {
  const input = await fixture();
  input.records.pop();
  const output = evaluateConservationAccounting(input);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
  assert.equal(output.denominatorCount, 2);
  assert.equal(output.missingTupleCount, 1);
  assert.ok(output.tuples.some((tuple) => tuple.reasonCodes.includes('EXPECTED_ACCOUNTING_TUPLE_MISSING')));
});

test('two accounting records for one expected tuple fail closed', async () => {
  const input = await fixture();
  input.records.push(structuredClone(input.records[0]));
  const output = evaluateConservationAccounting(input);
  assert.equal(output.overallResult, 'FAIL');
  assert.equal(output.duplicateAccountingTupleCount, 1);
  assert.equal(output.greenEligible, false);
});

test('unreconciled duplicate cannot hide behind a completed disposition', async () => {
  const input = await fixture();
  const record = input.records[1];
  record.disposition = { kind: 'COMPLETED', reasonCode: null, incidentId: null };
  record.transitions.at(-1).state = 'COMPLETED';
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.public-002'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('DUPLICATE_DISPOSITION_NOT_RECONCILED'));
});

test('cumulative counters must have matching retained transitions', async () => {
  const input = await fixture();
  input.records[0].counts.exported = 0;
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('EXPORTED_COUNTER_TRANSITION_MISMATCH'));
});

test('accepted/refused canonical ingress count is bound to seen-count accounting', async () => {
  const input = await fixture();
  const record = input.records[0];
  record.counts.accepted = 2;
  record.transitions.splice(1, 0, { sequence: 2, state: 'ACCEPTED', atMs: 1101, reasonCode: null });
  record.transitions.forEach((transition, index) => { transition.sequence = index + 1; });
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('CANONICAL_INGRESS_COUNT_NOT_EXACTLY_ONE'));
  assert.ok(tuple.reasonCodes.includes('SEEN_COUNT_INGRESS_ACCOUNTING_MISMATCH'));
});

test('completed terminal disposition cannot also retain dropped work', async () => {
  const input = await fixture();
  const record = input.records[0];
  record.counts.dropped = 1;
  record.transitions.splice(-1, 0, { sequence: 5, state: 'DROPPED', atMs: 1135, reasonCode: 'DROP_CONFLICT' });
  record.transitions.forEach((transition, index) => { transition.sequence = index + 1; });
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('COMPLETED_TERMINAL_DISPOSITION_NOT_EXCLUSIVE'));
});

test('material evidence cannot terminate as dropped or coalesced', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.counts.dropped = 1;
  record.transitions.at(-1).state = 'DROPPED';
  record.transitions.at(-1).reasonCode = 'MATERIAL_DROP_ATTEMPT';
  record.disposition = { kind: 'DROPPED', reasonCode: 'MATERIAL_DROP_ATTEMPT', incidentId: null };
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('MATERIAL_EVIDENCE_TERMINAL_DROP_FORBIDDEN'));
});

test('queue depth and availability-to-processing order are bounded', async () => {
  const input = await fixture();
  input.records[0].queue.depth = 11;
  input.records[0].queue.capacity = 10;
  input.records[0].times.processingStartedAtMs = input.records[0].times.availableAtMs - 1;
  const output = evaluateConservationAccounting(input);
  const reasons = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001')).reasonCodes;
  assert.ok(reasons.includes('QUEUE_DEPTH_EXCEEDS_CAPACITY'));
  assert.ok(reasons.includes('PROCESS_START_BEFORE_AVAILABILITY'));
});

test('availability, processing, and transition timestamps fail closed when future or outside the accounting window', async () => {
  const futureInput = await fixture();
  futureInput.records[0].times.availableAtMs = 4000;
  futureInput.records[0].times.processingStartedAtMs = 5000;
  futureInput.records[0].times.processingEndedAtMs = 6000;
  const futureTuple = evaluateConservationAccounting(futureInput).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(futureTuple.result, 'FAIL');
  assert.ok(futureTuple.reasonCodes.includes('AVAILABILITY_TIME_FROM_FUTURE'));
  assert.ok(futureTuple.reasonCodes.includes('PROCESS_START_TIME_FROM_FUTURE'));
  assert.ok(futureTuple.reasonCodes.includes('PROCESS_END_TIME_FROM_FUTURE'));
  assert.ok(futureTuple.reasonCodes.includes('AVAILABILITY_OUTSIDE_ACCOUNTING_WINDOW'));
  assert.ok(futureTuple.reasonCodes.includes('PROCESS_START_OUTSIDE_ACCOUNTING_WINDOW'));
  assert.ok(futureTuple.reasonCodes.includes('PROCESS_END_OUTSIDE_ACCOUNTING_WINDOW'));

  const transitionInput = await fixture();
  transitionInput.records[0].transitions.at(-1).atMs = transitionInput.nowMs + 1;
  const transitionTuple = evaluateConservationAccounting(transitionInput).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(transitionTuple.result, 'FAIL');
  assert.ok(transitionTuple.reasonCodes.includes('TRANSITION_TIME_FROM_FUTURE'));
  assert.ok(transitionTuple.reasonCodes.includes('TRANSITION_OUTSIDE_ACCOUNTING_WINDOW'));
});

test('retained processing timestamps must align with ingress, processing, and terminal transitions', async () => {
  const input = await fixture();
  const record = input.records[0];
  record.times.receiptAtMs += 1;
  record.times.processingStartedAtMs += 1;
  record.times.processingEndedAtMs = 1500;
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('RECEIPT_TRANSITION_TIME_MISMATCH'));
  assert.ok(tuple.reasonCodes.includes('PROCESS_START_TRANSITION_TIME_MISMATCH'));
  assert.ok(tuple.reasonCodes.includes('PROCESS_END_AFTER_TERMINAL_TRANSITION'));
});

test('legitimate late and in-flight dispositions retain a null processing end time', async () => {
  for (const disposition of ['IN_FLIGHT', 'LATE']) {
    const input = await fixture();
    const record = input.records[0];
    removeExport(record);
    record.counts.inFlight = 1;
    record.times.processingEndedAtMs = null;
    record.transitions.at(-1).state = disposition;
    record.transitions.at(-1).reasonCode = disposition === 'LATE' ? 'PROCESSING_LATE' : null;
    record.disposition = {
      kind: disposition,
      reasonCode: disposition === 'LATE' ? 'PROCESSING_LATE' : null,
      incidentId: null,
    };
    record.exportRecovery = {
      state: 'BUFFERED_WITHIN_BUDGET',
      budgetId: `budget-${disposition.toLowerCase()}`,
      budgetExpiresAtMs: 3500,
      incidentId: null,
      bufferedCount: 1,
      replayedCount: 0,
    };
    const tuple = evaluateConservationAccounting(input).tuples
      .find((entry) => entry.tupleKey.includes('event.material-001'));
    assert.equal(tuple.result, 'PASS', disposition);
    assert.equal(tuple.accounted, true, disposition);
    assert.equal(tuple.reasonCodes.includes('TERMINAL_PROCESS_END_TIME_MISSING'), false, disposition);
  }
});

test('export gap without buffer, replay budget, or incident is explicitly unbound', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('EXPORT_GAP_UNBOUND'));
});

test('export gap buffered within an injected bounded budget remains accounted', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.exportRecovery = {
    state: 'BUFFERED_WITHIN_BUDGET',
    budgetId: 'export-budget-1',
    budgetExpiresAtMs: 3500,
    incidentId: null,
    bufferedCount: 1,
    replayedCount: 0,
  };
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'PASS');
  assert.equal(tuple.accounted, true);
});

test('zero export gap rejects every invented recovery state, count, or evidence field', async () => {
  const hostileRecoveries = [
    {
      state: 'BUFFERED_WITHIN_BUDGET',
      budgetId: 'invented-buffer-budget',
      budgetExpiresAtMs: 3500,
      incidentId: null,
      bufferedCount: 1,
      replayedCount: 0,
    },
    {
      state: 'REPLAYED_WITHIN_BUDGET',
      budgetId: 'invented-replay-budget',
      budgetExpiresAtMs: 3500,
      incidentId: null,
      bufferedCount: 0,
      replayedCount: 1,
    },
    {
      state: 'EVIDENCE_GAP_INCIDENT_BOUND',
      budgetId: null,
      budgetExpiresAtMs: null,
      incidentId: 'invented-gap-incident',
      bufferedCount: 0,
      replayedCount: 0,
    },
    {
      state: 'NOT_REQUIRED',
      budgetId: 'invented-not-required-budget',
      budgetExpiresAtMs: 3500,
      incidentId: null,
      bufferedCount: 0,
      replayedCount: 0,
    },
  ];
  for (const exportRecovery of hostileRecoveries) {
    const input = await fixture();
    input.records[0].exportRecovery = exportRecovery;
    const output = evaluateConservationAccounting(input);
    const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
    assert.equal(tuple.result, 'FAIL', exportRecovery.state);
    assert.equal(tuple.accounted, false, exportRecovery.state);
    assert.ok(tuple.reasonCodes.includes('EXPORT_RECOVERY_WITHOUT_GAP'), exportRecovery.state);
    assert.equal(output.greenEligible, false, exportRecovery.state);
  }
});

test('export replay within budget is independent from logical duplicate replay', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.exportRecovery = {
    state: 'REPLAYED_WITHIN_BUDGET',
    budgetId: 'export-replay-budget-1',
    budgetExpiresAtMs: 3500,
    incidentId: null,
    bufferedCount: 0,
    replayedCount: 1,
  };
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'PASS');
  assert.equal(tuple.logicalReplayCount, 0);
  assert.equal(tuple.exportReplayCount, 1);
  assert.equal(output.logicalReplayCount, 1);
  assert.equal(output.exportReplayCount, 1);
});

test('export replay without declared budget evidence fails closed', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.exportRecovery = {
    state: 'REPLAYED_WITHIN_BUDGET',
    budgetId: null,
    budgetExpiresAtMs: null,
    incidentId: null,
    bufferedCount: 0,
    replayedCount: 1,
  };
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('EXPORT_GAP_UNBOUND'));
});

test('export replay with expired budget evidence fails closed', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.exportRecovery = {
    state: 'REPLAYED_WITHIN_BUDGET',
    budgetId: 'export-replay-budget-expired',
    budgetExpiresAtMs: input.nowMs - 1,
    incidentId: null,
    bufferedCount: 0,
    replayedCount: 1,
  };
  const tuple = evaluateConservationAccounting(input).tuples
    .find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.ok(tuple.reasonCodes.includes('EXPORT_GAP_UNBOUND'));
});

test('evidence-gap incident remains visible, non-green, and carries incident identity', async () => {
  const input = await fixture();
  const record = input.records[0];
  removeExport(record);
  record.exportRecovery = {
    state: 'EVIDENCE_GAP_INCIDENT_BOUND',
    budgetId: null,
    budgetExpiresAtMs: null,
    incidentId: 'incident-export-gap-1',
    bufferedCount: 0,
    replayedCount: 0,
  };
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.equal(tuple.incidentId, 'incident-export-gap-1');
  assert.ok(tuple.reasonCodes.includes('VISIBLE_EVIDENCE_GAP_INCIDENT'));
  assert.deepEqual(output.activeIncidentIds, ['incident-export-gap-1']);
  assert.equal(output.greenEligible, false);
});

test('unresolved incident disposition remains visible and non-green', async () => {
  const input = await fixture();
  const record = input.records[0];
  record.transitions.at(-1).state = 'UNRESOLVED';
  record.transitions.at(-1).reasonCode = 'UNRESOLVED_EXPORT_ACK';
  record.disposition = {
    kind: 'UNRESOLVED_INCIDENT_BOUND',
    reasonCode: 'UNRESOLVED_EXPORT_ACK',
    incidentId: 'incident-unresolved-1',
  };
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'FAIL');
  assert.equal(tuple.incidentId, 'incident-unresolved-1');
  assert.ok(tuple.reasonCodes.includes('VISIBLE_UNRESOLVED_INCIDENT'));
  assert.deepEqual(output.activeIncidentIds, ['incident-unresolved-1']);
});

test('material evidence may never use routine sampling', async () => {
  const input = await fixture();
  input.records[0].sampling = { mode: 'BUDGETED_ROUTINE_PUBLIC', budgetId: 'debug-sampling' };
  const output = evaluateConservationAccounting(input);
  const reasons = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001')).reasonCodes;
  assert.ok(reasons.includes('MATERIAL_EVIDENCE_SAMPLING_FORBIDDEN'));
});

test('release mismatch is UNKNOWN and cannot render green', async () => {
  const input = await fixture();
  input.records[0].releaseSha = '2'.repeat(40);
  const output = evaluateConservationAccounting(input);
  const tuple = output.tuples.find((entry) => entry.tupleKey.includes('event.material-001'));
  assert.equal(tuple.result, 'UNKNOWN');
  assert.ok(tuple.reasonCodes.includes('ACCOUNTING_RELEASE_MISMATCH'));
  assert.equal(output.greenEligible, false);
});

test('evaluation is deterministic and does not mutate its input', async () => {
  const input = await fixture();
  const before = structuredClone(input);
  assert.deepEqual(evaluateConservationAccounting(input), evaluateConservationAccounting(input));
  assert.deepEqual(input, before);
});
