import {
  assertArray,
  assertBoundedString,
  assertClosedRecord,
  assertEnum,
  assertGitSha,
  assertSafeInteger,
  assertUnique,
  compareAscii,
  deepFreeze,
  sortedUniqueStrings,
  strongestResult,
} from './reference-helpers.mjs';
import {
  assertReasonCodeMembership,
  reasonCodeRegistryMetadata,
} from './reason-code-registry.mjs';

const SCHEMA_VERSION = 'conservation-accounting.v1';
const EVIDENCE_CLASSES = [
  'ROUTINE_PUBLIC', 'LEDGER_AUDIT', 'MONEY_MUTATION', 'AMBIGUOUS_RESPONSE',
  'RECONCILIATION', 'INVARIANT_FAILURE', 'OWNER_AUTHORIZATION', 'REPAIR', 'INCIDENT',
];
const MATERIAL_EVIDENCE_CLASSES = new Set(EVIDENCE_CLASSES.filter((value) => value !== 'ROUTINE_PUBLIC'));
const TRANSITION_STATES = [
  'ACCEPTED', 'REFUSED', 'QUEUED', 'PROCESSING', 'EXPORTED', 'DROPPED', 'COALESCED',
  'IN_FLIGHT', 'LATE', 'QUARANTINED', 'UNRESOLVED', 'REPLAYED', 'RECONCILED', 'COMPLETED',
];
const DISPOSITIONS = [
  'COMPLETED', 'REFUSED', 'DROPPED', 'COALESCED', 'IN_FLIGHT', 'LATE',
  'QUARANTINED', 'UNRESOLVED_INCIDENT_BOUND', 'DUPLICATED_REPLAYED_RECONCILED',
];
const FINAL_TRANSITION = Object.freeze({
  COMPLETED: 'COMPLETED',
  REFUSED: 'REFUSED',
  DROPPED: 'DROPPED',
  COALESCED: 'COALESCED',
  IN_FLIGHT: 'IN_FLIGHT',
  LATE: 'LATE',
  QUARANTINED: 'QUARANTINED',
  UNRESOLVED_INCIDENT_BOUND: 'UNRESOLVED',
  DUPLICATED_REPLAYED_RECONCILED: 'RECONCILED',
});
const TRANSITION_REASON_TARGETS = Object.freeze({
  DROP_CONFLICT: Object.freeze(['DROPPED']),
  DUPLICATE_REPLAY: Object.freeze(['REPLAYED']),
  DUPLICATE_RECONCILED: Object.freeze(['RECONCILED']),
  MATERIAL_DROP_ATTEMPT: Object.freeze(['DROPPED', 'COALESCED']),
  PROCESSING_LATE: Object.freeze(['LATE']),
  UNRESOLVED_EXPORT_ACK: Object.freeze(['UNRESOLVED']),
});
const DISPOSITION_REASON_TARGETS = Object.freeze({
  DUPLICATE_RECONCILED: Object.freeze(['DUPLICATED_REPLAYED_RECONCILED']),
  MATERIAL_DROP_ATTEMPT: Object.freeze(['DROPPED', 'COALESCED']),
  PROCESSING_LATE: Object.freeze(['LATE']),
  UNRESOLVED_EXPORT_ACK: Object.freeze(['UNRESOLVED_INCIDENT_BOUND']),
});

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw new TypeError(`${path} is not a stable identifier`);
}

function assertNullableIdentifier(value, path) {
  if (value !== null) assertIdentifier(value, path);
}

function assertNullableTimestamp(value, path) {
  if (value !== null) assertSafeInteger(value, path);
}

function tupleInternalKey(value) {
  return JSON.stringify([value.stableLogicalEventId, value.stageId, value.window.windowId]);
}

function tupleDisplayKey(value) {
  return `${value.stableLogicalEventId}|${value.stageId}|${value.window.windowId}`;
}

function validateWindow(value, path) {
  assertClosedRecord(value, path, ['windowId', 'startMs', 'endMs']);
  assertIdentifier(value.windowId, `${path}.windowId`);
  assertSafeInteger(value.startMs, `${path}.startMs`);
  assertSafeInteger(value.endMs, `${path}.endMs`);
  if (value.startMs >= value.endMs) throw new TypeError(`${path} must have startMs < endMs`);
}

function validateExpectedTuple(value, index) {
  const path = `expectedTuples[${index}]`;
  assertClosedRecord(value, path, ['stableLogicalEventId', 'stageId', 'window', 'releaseSha', 'evidenceClass']);
  assertIdentifier(value.stableLogicalEventId, `${path}.stableLogicalEventId`);
  assertIdentifier(value.stageId, `${path}.stageId`);
  validateWindow(value.window, `${path}.window`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertEnum(value.evidenceClass, EVIDENCE_CLASSES, `${path}.evidenceClass`);
}

function validateCounts(value, path) {
  assertClosedRecord(value, path, ['accepted', 'refused', 'queued', 'processed', 'exported', 'dropped', 'inFlight']);
  for (const key of ['accepted', 'refused', 'queued', 'processed', 'exported', 'dropped', 'inFlight']) {
    assertSafeInteger(value[key], `${path}.${key}`);
  }
}

function validateTimes(value, path) {
  assertClosedRecord(value, path, ['eventAtMs', 'receiptAtMs', 'availableAtMs', 'processingStartedAtMs', 'processingEndedAtMs']);
  assertSafeInteger(value.eventAtMs, `${path}.eventAtMs`);
  assertSafeInteger(value.receiptAtMs, `${path}.receiptAtMs`);
  assertSafeInteger(value.availableAtMs, `${path}.availableAtMs`);
  assertNullableTimestamp(value.processingStartedAtMs, `${path}.processingStartedAtMs`);
  assertNullableTimestamp(value.processingEndedAtMs, `${path}.processingEndedAtMs`);
}

function validateRecord(value, index) {
  const path = `records[${index}]`;
  assertClosedRecord(value, path, [
    'stableLogicalEventId', 'stageId', 'window', 'serviceId', 'componentId', 'instanceId',
    'releaseSha', 'environment', 'authorityOwnerId', 'telemetrySchemaVersion', 'evidenceClass',
    'counts', 'queue', 'times', 'transitions', 'disposition', 'duplicateAccounting', 'sampling', 'exportRecovery',
  ]);
  for (const key of ['stableLogicalEventId', 'stageId', 'serviceId', 'componentId', 'instanceId', 'authorityOwnerId', 'telemetrySchemaVersion']) {
    assertIdentifier(value[key], `${path}.${key}`);
  }
  validateWindow(value.window, `${path}.window`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertEnum(value.environment, ['LOCAL_FIXTURE', 'TEST', 'SHADOW', 'PRODUCTION'], `${path}.environment`);
  assertEnum(value.evidenceClass, EVIDENCE_CLASSES, `${path}.evidenceClass`);
  validateCounts(value.counts, `${path}.counts`);
  assertClosedRecord(value.queue, `${path}.queue`, ['depth', 'ageMs', 'capacity']);
  assertSafeInteger(value.queue.depth, `${path}.queue.depth`);
  assertSafeInteger(value.queue.ageMs, `${path}.queue.ageMs`);
  assertSafeInteger(value.queue.capacity, `${path}.queue.capacity`);
  validateTimes(value.times, `${path}.times`);
  assertArray(value.transitions, `${path}.transitions`, 1024);
  if (value.transitions.length === 0) throw new TypeError(`${path}.transitions must not be empty`);
  value.transitions.forEach((transition, child) => {
    const childPath = `${path}.transitions[${child}]`;
    assertClosedRecord(transition, childPath, ['sequence', 'state', 'atMs', 'reasonCode']);
    assertSafeInteger(transition.sequence, `${childPath}.sequence`, 1, 1024);
    assertEnum(transition.state, TRANSITION_STATES, `${childPath}.state`);
    assertSafeInteger(transition.atMs, `${childPath}.atMs`);
    assertNullableIdentifier(transition.reasonCode, `${childPath}.reasonCode`);
    if (transition.reasonCode !== null) {
      assertReasonCodeMembership(transition.reasonCode, 'TRANSITION', `${childPath}.reasonCode`);
      if (!TRANSITION_REASON_TARGETS[transition.reasonCode]?.includes(transition.state)) {
        throw new TypeError(`${childPath}.reasonCode is incompatible with transition state ${transition.state}`);
      }
    }
  });
  assertClosedRecord(value.disposition, `${path}.disposition`, ['kind', 'reasonCode', 'incidentId']);
  assertEnum(value.disposition.kind, DISPOSITIONS, `${path}.disposition.kind`);
  assertNullableIdentifier(value.disposition.reasonCode, `${path}.disposition.reasonCode`);
  if (value.disposition.reasonCode !== null) {
    assertReasonCodeMembership(value.disposition.reasonCode, 'DISPOSITION', `${path}.disposition.reasonCode`);
    if (!DISPOSITION_REASON_TARGETS[value.disposition.reasonCode]?.includes(value.disposition.kind)) {
      throw new TypeError(`${path}.disposition.reasonCode is incompatible with disposition ${value.disposition.kind}`);
    }
  }
  assertNullableIdentifier(value.disposition.incidentId, `${path}.disposition.incidentId`);
  assertClosedRecord(value.duplicateAccounting, `${path}.duplicateAccounting`, ['seenCount', 'replayCount', 'reconciledDuplicateCount', 'canonicalEventId']);
  for (const key of ['seenCount', 'replayCount', 'reconciledDuplicateCount']) {
    assertSafeInteger(value.duplicateAccounting[key], `${path}.duplicateAccounting.${key}`);
  }
  assertIdentifier(value.duplicateAccounting.canonicalEventId, `${path}.duplicateAccounting.canonicalEventId`);
  assertClosedRecord(value.sampling, `${path}.sampling`, ['mode', 'budgetId']);
  assertEnum(value.sampling.mode, ['NONE', 'BUDGETED_ROUTINE_PUBLIC'], `${path}.sampling.mode`);
  assertNullableIdentifier(value.sampling.budgetId, `${path}.sampling.budgetId`);
  assertClosedRecord(value.exportRecovery, `${path}.exportRecovery`, [
    'state', 'budgetId', 'budgetExpiresAtMs', 'incidentId', 'bufferedCount', 'replayedCount',
  ]);
  assertEnum(value.exportRecovery.state, [
    'NOT_REQUIRED', 'BUFFERED_WITHIN_BUDGET', 'REPLAYED_WITHIN_BUDGET', 'EVIDENCE_GAP_INCIDENT_BOUND',
  ], `${path}.exportRecovery.state`);
  assertNullableIdentifier(value.exportRecovery.budgetId, `${path}.exportRecovery.budgetId`);
  assertNullableTimestamp(value.exportRecovery.budgetExpiresAtMs, `${path}.exportRecovery.budgetExpiresAtMs`);
  assertNullableIdentifier(value.exportRecovery.incidentId, `${path}.exportRecovery.incidentId`);
  assertSafeInteger(value.exportRecovery.bufferedCount, `${path}.exportRecovery.bufferedCount`);
  assertSafeInteger(value.exportRecovery.replayedCount, `${path}.exportRecovery.replayedCount`);
}

function validateInput(input) {
  assertClosedRecord(input, 'input', ['schemaVersion', 'nowMs', 'expectedTuples', 'records']);
  assertEnum(input.schemaVersion, [SCHEMA_VERSION], 'input.schemaVersion');
  assertSafeInteger(input.nowMs, 'input.nowMs');
  assertArray(input.expectedTuples, 'input.expectedTuples', 1024);
  if (input.expectedTuples.length === 0) throw new TypeError('input.expectedTuples must not be empty');
  input.expectedTuples.forEach(validateExpectedTuple);
  assertUnique(input.expectedTuples, tupleInternalKey, 'input.expectedTuples');
  assertArray(input.records, 'input.records', 2048);
  input.records.forEach(validateRecord);
}

function evaluateRecord(expected, record, nowMs) {
  const reasons = [];
  const disposition = record.disposition.kind;
  if (record.window.windowId !== expected.window.windowId
      || record.window.startMs !== expected.window.startMs
      || record.window.endMs !== expected.window.endMs) reasons.push('ACCOUNTING_WINDOW_MISMATCH');
  if (record.releaseSha !== expected.releaseSha) reasons.push('ACCOUNTING_RELEASE_MISMATCH');
  if (record.evidenceClass !== expected.evidenceClass) reasons.push('EVIDENCE_CLASS_MISMATCH');
  if (expected.window.endMs > nowMs) reasons.push('ACCOUNTING_WINDOW_NOT_CLOSED');

  const { counts, duplicateAccounting, times } = record;
  const duplicateCount = Math.max(duplicateAccounting.seenCount - 1, 0);
  if (duplicateAccounting.seenCount < 1) reasons.push('EVENT_SEEN_COUNT_ZERO');
  if (counts.accepted + counts.refused !== 1) reasons.push('CANONICAL_INGRESS_COUNT_NOT_EXACTLY_ONE');
  if (duplicateAccounting.seenCount !== counts.accepted + counts.refused + duplicateCount) {
    reasons.push('SEEN_COUNT_INGRESS_ACCOUNTING_MISMATCH');
  }
  if (duplicateAccounting.canonicalEventId !== record.stableLogicalEventId) reasons.push('CANONICAL_EVENT_ID_MISMATCH');
  if (duplicateAccounting.replayCount > duplicateCount) reasons.push('REPLAY_COUNT_EXCEEDS_DUPLICATES');
  if (duplicateAccounting.reconciledDuplicateCount > duplicateCount) reasons.push('RECONCILED_COUNT_EXCEEDS_DUPLICATES');
  if (duplicateCount === 0 && (duplicateAccounting.replayCount !== 0 || duplicateAccounting.reconciledDuplicateCount !== 0)) {
    reasons.push('DUPLICATE_ACCOUNTING_WITHOUT_DUPLICATE');
  }
  if (duplicateCount > 0 && disposition !== 'DUPLICATED_REPLAYED_RECONCILED') reasons.push('DUPLICATE_DISPOSITION_NOT_RECONCILED');
  if (disposition === 'DUPLICATED_REPLAYED_RECONCILED'
      && (duplicateCount === 0 || duplicateAccounting.replayCount === 0
        || duplicateAccounting.reconciledDuplicateCount !== duplicateCount)) {
    reasons.push('DUPLICATE_REPLAY_RECONCILIATION_INCOMPLETE');
  }

  const maximumAttemptCount = counts.accepted + duplicateAccounting.replayCount;
  if (counts.processed > maximumAttemptCount) reasons.push('PROCESSED_EXCEEDS_ACCEPTED_PLUS_REPLAY');
  if (counts.exported > counts.processed) reasons.push('EXPORTED_EXCEEDS_PROCESSED');
  if (counts.queued > maximumAttemptCount) reasons.push('QUEUED_EXCEEDS_ACCEPTED_PLUS_REPLAY');
  if (counts.dropped > maximumAttemptCount) reasons.push('DROPPED_EXCEEDS_ACCEPTED_PLUS_REPLAY');
  if (counts.inFlight > maximumAttemptCount) reasons.push('IN_FLIGHT_EXCEEDS_ACCEPTED_PLUS_REPLAY');
  if (disposition === 'REFUSED') {
    if (counts.refused < 1 || counts.accepted !== 0) reasons.push('REFUSED_DISPOSITION_COUNT_MISMATCH');
  } else if (counts.accepted < 1 || counts.refused !== 0) reasons.push('ACCEPTED_DISPOSITION_COUNT_MISMATCH');
  if (disposition === 'COMPLETED' && (counts.processed < 1 || counts.inFlight !== 0)) reasons.push('COMPLETED_DISPOSITION_COUNT_MISMATCH');
  if (disposition === 'COMPLETED' && counts.dropped !== 0) reasons.push('COMPLETED_TERMINAL_DISPOSITION_NOT_EXCLUSIVE');
  if ((disposition === 'DROPPED' || disposition === 'COALESCED') && counts.dropped < 1) reasons.push('DROP_DISPOSITION_COUNT_MISMATCH');
  if ((disposition === 'DROPPED' || disposition === 'COALESCED') && (counts.exported !== 0 || counts.inFlight !== 0)) {
    reasons.push('DROP_TERMINAL_DISPOSITION_NOT_EXCLUSIVE');
  }
  if ((disposition === 'IN_FLIGHT' || disposition === 'LATE') && counts.inFlight < 1) reasons.push('IN_FLIGHT_DISPOSITION_COUNT_MISMATCH');
  if ((disposition === 'IN_FLIGHT' || disposition === 'LATE') && counts.dropped !== 0) reasons.push('IN_FLIGHT_TERMINAL_DISPOSITION_NOT_EXCLUSIVE');
  if (disposition === 'REFUSED'
      && (counts.queued !== 0 || counts.processed !== 0 || counts.exported !== 0 || counts.dropped !== 0 || counts.inFlight !== 0)) {
    reasons.push('REFUSED_TERMINAL_DISPOSITION_NOT_EXCLUSIVE');
  }

  if (times.eventAtMs > times.receiptAtMs || times.receiptAtMs > times.availableAtMs) reasons.push('EVENT_RECEIPT_AVAILABILITY_TIME_ORDER_INVALID');
  if (times.receiptAtMs < expected.window.startMs || times.receiptAtMs > expected.window.endMs) reasons.push('RECEIPT_OUTSIDE_ACCOUNTING_WINDOW');
  if (times.eventAtMs > nowMs) reasons.push('EVENT_TIME_FROM_FUTURE');
  if (times.receiptAtMs > nowMs) reasons.push('RECEIPT_TIME_FROM_FUTURE');
  if (times.availableAtMs > nowMs) reasons.push('AVAILABILITY_TIME_FROM_FUTURE');
  if (times.availableAtMs < expected.window.startMs || times.availableAtMs > expected.window.endMs) {
    reasons.push('AVAILABILITY_OUTSIDE_ACCOUNTING_WINDOW');
  }
  if (times.processingEndedAtMs !== null && times.processingStartedAtMs === null) reasons.push('PROCESS_END_WITHOUT_START');
  if (times.processingStartedAtMs !== null && times.processingStartedAtMs > nowMs) reasons.push('PROCESS_START_TIME_FROM_FUTURE');
  if (times.processingEndedAtMs !== null && times.processingEndedAtMs > nowMs) reasons.push('PROCESS_END_TIME_FROM_FUTURE');
  if (times.processingStartedAtMs !== null
      && (times.processingStartedAtMs < expected.window.startMs || times.processingStartedAtMs > expected.window.endMs)) {
    reasons.push('PROCESS_START_OUTSIDE_ACCOUNTING_WINDOW');
  }
  if (times.processingEndedAtMs !== null
      && (times.processingEndedAtMs < expected.window.startMs || times.processingEndedAtMs > expected.window.endMs)) {
    reasons.push('PROCESS_END_OUTSIDE_ACCOUNTING_WINDOW');
  }
  if (record.queue.depth > record.queue.capacity) reasons.push('QUEUE_DEPTH_EXCEEDS_CAPACITY');
  if (times.processingStartedAtMs !== null && times.processingStartedAtMs < times.availableAtMs) reasons.push('PROCESS_START_BEFORE_AVAILABILITY');
  if (times.processingStartedAtMs !== null && times.processingEndedAtMs !== null
      && times.processingEndedAtMs < times.processingStartedAtMs) reasons.push('PROCESS_END_BEFORE_START');

  let previousSequence = 0;
  let previousAtMs = -1;
  for (const transition of record.transitions) {
    if (transition.sequence <= previousSequence) reasons.push('TRANSITION_SEQUENCE_NOT_STRICT');
    if (transition.atMs < previousAtMs) reasons.push('TRANSITION_TIME_NOT_MONOTONIC');
    if (transition.atMs < expected.window.startMs || transition.atMs > expected.window.endMs) reasons.push('TRANSITION_OUTSIDE_ACCOUNTING_WINDOW');
    if (transition.atMs > nowMs) reasons.push('TRANSITION_TIME_FROM_FUTURE');
    previousSequence = transition.sequence;
    previousAtMs = transition.atMs;
  }
  const finalTransition = record.transitions.at(-1).state;
  const finalTransitionAtMs = record.transitions.at(-1).atMs;
  if (finalTransition !== FINAL_TRANSITION[disposition]) reasons.push('DISPOSITION_TRANSITION_MISMATCH');
  const transitionCount = (state) => record.transitions.filter((transition) => transition.state === state).length;
  const ingressTransition = record.transitions.find((transition) => transition.state === 'ACCEPTED' || transition.state === 'REFUSED');
  if (ingressTransition !== undefined && ingressTransition.atMs !== times.receiptAtMs) {
    reasons.push('RECEIPT_TRANSITION_TIME_MISMATCH');
  }
  const processingTransitions = record.transitions.filter((transition) => transition.state === 'PROCESSING');
  if (processingTransitions.length > 0) {
    if (times.processingStartedAtMs === null) reasons.push('PROCESS_START_TIME_MISSING');
    else if (times.processingStartedAtMs !== processingTransitions[0].atMs) {
      reasons.push('PROCESS_START_TRANSITION_TIME_MISMATCH');
    }
  } else if (times.processingStartedAtMs !== null) reasons.push('PROCESS_START_WITHOUT_TRANSITION');
  if (times.processingEndedAtMs !== null) {
    const lastProcessingAtMs = processingTransitions.at(-1)?.atMs ?? null;
    if (lastProcessingAtMs !== null && times.processingEndedAtMs < lastProcessingAtMs) {
      reasons.push('PROCESS_END_BEFORE_LAST_PROCESSING_TRANSITION');
    }
    if (times.processingEndedAtMs > finalTransitionAtMs) reasons.push('PROCESS_END_AFTER_TERMINAL_TRANSITION');
  }
  if (['COMPLETED', 'DUPLICATED_REPLAYED_RECONCILED'].includes(disposition)
      && times.processingEndedAtMs === null) reasons.push('TERMINAL_PROCESS_END_TIME_MISSING');
  if (['IN_FLIGHT', 'LATE'].includes(disposition) && times.processingEndedAtMs !== null) {
    reasons.push('IN_FLIGHT_PROCESS_END_TIME_PRESENT');
  }
  if (transitionCount('ACCEPTED') !== counts.accepted) reasons.push('ACCEPTED_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('REFUSED') !== counts.refused) reasons.push('REFUSED_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('QUEUED') !== counts.queued) reasons.push('QUEUED_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('PROCESSING') !== counts.processed) reasons.push('PROCESSED_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('EXPORTED') !== counts.exported) reasons.push('EXPORTED_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('DROPPED') + transitionCount('COALESCED') !== counts.dropped) reasons.push('DROPPED_COUNTER_TRANSITION_MISMATCH');
  const expectedCurrentInFlight = disposition === 'IN_FLIGHT' || disposition === 'LATE' ? 1 : 0;
  if (counts.inFlight !== expectedCurrentInFlight) reasons.push('IN_FLIGHT_COUNTER_DISPOSITION_MISMATCH');
  if (transitionCount('REPLAYED') !== duplicateAccounting.replayCount) reasons.push('REPLAY_COUNTER_TRANSITION_MISMATCH');
  if (transitionCount('RECONCILED') !== duplicateAccounting.reconciledDuplicateCount) reasons.push('RECONCILED_COUNTER_TRANSITION_MISMATCH');

  const reasonRequired = ['REFUSED', 'DROPPED', 'COALESCED', 'LATE', 'QUARANTINED', 'UNRESOLVED_INCIDENT_BOUND', 'DUPLICATED_REPLAYED_RECONCILED'].includes(disposition);
  if (reasonRequired && record.disposition.reasonCode === null) reasons.push('DISPOSITION_REASON_REQUIRED');
  if (disposition === 'UNRESOLVED_INCIDENT_BOUND' && record.disposition.incidentId === null) reasons.push('UNRESOLVED_INCIDENT_REQUIRED');
  if (MATERIAL_EVIDENCE_CLASSES.has(record.evidenceClass) && record.sampling.mode !== 'NONE') reasons.push('MATERIAL_EVIDENCE_SAMPLING_FORBIDDEN');
  if (MATERIAL_EVIDENCE_CLASSES.has(record.evidenceClass)
      && (disposition === 'DROPPED' || disposition === 'COALESCED')) {
    reasons.push('MATERIAL_EVIDENCE_TERMINAL_DROP_FORBIDDEN');
  }
  if (record.sampling.mode === 'NONE' && record.sampling.budgetId !== null) reasons.push('SAMPLING_BUDGET_WITH_NONE');
  if (record.sampling.mode === 'BUDGETED_ROUTINE_PUBLIC'
      && (record.evidenceClass !== 'ROUTINE_PUBLIC' || record.sampling.budgetId === null)) {
    reasons.push('ROUTINE_SAMPLING_BUDGET_INVALID');
  }
  const exportGapCount = Math.max(counts.processed - counts.exported, 0);
  const recovery = record.exportRecovery;
  if (exportGapCount > 0) {
    let recoveryValid = false;
    if (recovery.state === 'BUFFERED_WITHIN_BUDGET') {
      recoveryValid = recovery.budgetId !== null && recovery.budgetExpiresAtMs !== null
        && recovery.budgetExpiresAtMs >= nowMs && recovery.incidentId === null
        && recovery.bufferedCount === exportGapCount && recovery.replayedCount === 0;
    } else if (recovery.state === 'REPLAYED_WITHIN_BUDGET') {
      recoveryValid = recovery.budgetId !== null && recovery.budgetExpiresAtMs !== null
        && recovery.budgetExpiresAtMs >= nowMs && recovery.incidentId === null
        && recovery.bufferedCount === 0 && recovery.replayedCount === exportGapCount;
    } else if (recovery.state === 'EVIDENCE_GAP_INCIDENT_BOUND') {
      recoveryValid = recovery.budgetId === null && recovery.budgetExpiresAtMs === null
        && recovery.incidentId !== null && recovery.bufferedCount === 0 && recovery.replayedCount === 0;
      if (recoveryValid) reasons.push('VISIBLE_EVIDENCE_GAP_INCIDENT');
    }
    if (!recoveryValid) reasons.push('EXPORT_GAP_UNBOUND');
  } else if (recovery.state !== 'NOT_REQUIRED'
      || recovery.budgetId !== null || recovery.budgetExpiresAtMs !== null || recovery.incidentId !== null
      || recovery.bufferedCount !== 0 || recovery.replayedCount !== 0) {
    reasons.push('EXPORT_RECOVERY_WITHOUT_GAP');
  }
  if (disposition === 'UNRESOLVED_INCIDENT_BOUND' && record.disposition.incidentId !== null) {
    reasons.push('VISIBLE_UNRESOLVED_INCIDENT');
  }

  const unknownReasons = new Set(['ACCOUNTING_WINDOW_NOT_CLOSED', 'ACCOUNTING_RELEASE_MISMATCH']);
  const hasFailure = reasons.some((reason) => !unknownReasons.has(reason));
  const hasUnknown = reasons.some((reason) => unknownReasons.has(reason));
  const result = hasFailure ? 'FAIL' : hasUnknown ? 'UNKNOWN' : 'PASS';
  return {
    tupleKey: tupleDisplayKey(expected),
    result,
    accounted: result === 'PASS',
    disposition,
    incidentId: record.disposition.incidentId ?? recovery.incidentId,
    duplicateCount,
    logicalReplayCount: duplicateAccounting.replayCount,
    exportReplayCount: recovery.replayedCount,
    reconciledDuplicateCount: duplicateAccounting.reconciledDuplicateCount,
    reasonCodes: sortedUniqueStrings(reasons),
  };
}

export function evaluateConservationAccounting(input) {
  validateInput(input);
  const expectedByKey = new Map(input.expectedTuples.map((tuple) => [tupleInternalKey(tuple), tuple]));
  const recordsByKey = new Map();
  for (const record of input.records) {
    const key = tupleInternalKey(record);
    const entries = recordsByKey.get(key) ?? [];
    entries.push(record);
    recordsByKey.set(key, entries);
  }

  const tupleEvaluations = [];
  for (const expected of input.expectedTuples) {
    const entries = recordsByKey.get(tupleInternalKey(expected)) ?? [];
    if (entries.length === 0) {
      tupleEvaluations.push({
        tupleKey: tupleDisplayKey(expected),
        result: 'UNKNOWN',
        accounted: false,
        disposition: null,
        incidentId: null,
        duplicateCount: null,
        logicalReplayCount: null,
        exportReplayCount: null,
        reconciledDuplicateCount: null,
        reasonCodes: ['EXPECTED_ACCOUNTING_TUPLE_MISSING'],
      });
    } else if (entries.length > 1) {
      tupleEvaluations.push({
        tupleKey: tupleDisplayKey(expected),
        result: 'FAIL',
        accounted: false,
        disposition: null,
        incidentId: null,
        duplicateCount: null,
        logicalReplayCount: null,
        exportReplayCount: null,
        reconciledDuplicateCount: null,
        reasonCodes: ['DUPLICATE_ACCOUNTING_TUPLE'],
      });
    } else {
      tupleEvaluations.push(evaluateRecord(expected, entries[0], input.nowMs));
    }
  }
  tupleEvaluations.sort((left, right) => compareAscii(left.tupleKey, right.tupleKey));

  const unexpectedRecordTupleKeys = sortedUniqueStrings(input.records
    .filter((record) => !expectedByKey.has(tupleInternalKey(record)))
    .map(tupleDisplayKey));
  const evaluatedResults = tupleEvaluations.map((entry) => entry.result);
  if (unexpectedRecordTupleKeys.length > 0) evaluatedResults.push('FAIL');
  const overallResult = strongestResult(evaluatedResults);
  const duplicateCount = tupleEvaluations.reduce((sum, entry) => sum + (entry.duplicateCount ?? 0), 0);
  const logicalReplayCount = tupleEvaluations.reduce((sum, entry) => sum + (entry.logicalReplayCount ?? 0), 0);
  const exportReplayCount = tupleEvaluations.reduce((sum, entry) => sum + (entry.exportReplayCount ?? 0), 0);
  const activeIncidentIds = sortedUniqueStrings(tupleEvaluations
    .map((entry) => entry.incidentId)
    .filter((value) => value !== null));

  return deepFreeze({
    schemaVersion: 'conservation-accounting-evaluation.v1',
    reasonRegistry: reasonCodeRegistryMetadata(),
    evaluatedAtMs: input.nowMs,
    transportGuarantee: 'NOT_GLOBAL_EXACTLY_ONCE',
    overallResult,
    greenEligible: overallResult === 'PASS',
    denominatorCount: input.expectedTuples.length,
    accountedCount: tupleEvaluations.filter((entry) => entry.accounted).length,
    missingTupleCount: tupleEvaluations.filter((entry) => entry.reasonCodes.includes('EXPECTED_ACCOUNTING_TUPLE_MISSING')).length,
    duplicateAccountingTupleCount: tupleEvaluations.filter((entry) => entry.reasonCodes.includes('DUPLICATE_ACCOUNTING_TUPLE')).length,
    logicalDuplicateCount: duplicateCount,
    logicalReplayCount,
    exportReplayCount,
    activeIncidentIds,
    unexpectedRecordTupleKeys,
    tuples: tupleEvaluations,
  });
}
