import {
  ACTION_EVIDENCE_AUTHORITY_EFFECT,
  ACTION_EVIDENCE_CLASSES,
  ACTION_EVIDENCE_RESULT_SCHEMA_VERSION,
  ACTION_EVIDENCE_TRUTH_LABEL,
  ACTION_EVIDENCE_USE_CLASS,
  ACTION_EVIDENCE_USE_SCHEMA_VERSION,
  REQUIRED_EVIDENCE_FAMILIES,
  deepFreeze,
  isPlainRecord,
  snapshotPlainData,
  validateActionEvidenceEnvelope,
  validateActionEvidenceResult,
} from '../contracts/index.mjs';

const UTC_MIN = 1_262_304_000_000;
const UTC_MAX = 4_102_444_800_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/u;

const USE_REQUEST_KEYS = [
  'canonicalOwnerDecisionIds', 'consumerId', 'purpose', 'recordId', 'schemaVersion',
];

function isDenseIdArray(value) {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
    const ownKeys = Object.getOwnPropertyNames(value).filter((key) => key !== 'length');
    if (ownKeys.length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string' || !ID.test(descriptor.value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function closedUseRequest(value) {
  if (!isPlainRecord(value)) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')
      || [...keys].sort().join('\n') !== USE_REQUEST_KEYS.join('\n')) return null;
    const result = {};
    for (const key of USE_REQUEST_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function isUtcMs(value) {
  return Number.isSafeInteger(value) && value >= UTC_MIN && value <= UTC_MAX;
}

function sortedUnique(values) {
  return Object.freeze([...new Set(values)].sort());
}

const PASS_OUTCOME_REASON_CODES = new Set([
  'ASSUMPTION_PASS',
  'CURRENT_SYNTHETIC_FIXTURE',
  'EVIDENCE_SATISFIED',
  'INVARIANT_PASS',
]);

function normalizedReasons(status, reasons) {
  return sortedUnique(status === 'PASS'
    ? reasons
    : reasons.filter((reason) => !PASS_OUTCOME_REASON_CODES.has(reason)));
}

function statusFrom(statuses) {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

function dependencyUnknownMasksContradiction(result) {
  return result.status === 'UNKNOWN' && result.reasonCodes.some((reason) => (
    /_(?:EXPIRED|INVALIDATED|NOT_YET_VALID|STALE)$/u.test(reason)
      || [
        'EVIDENCE_DEPENDENCY_CYCLE',
        'EVIDENCE_DEPENDENCY_UNKNOWN',
        'EVIDENCE_TIMELINE_INCOHERENT',
        'INDEPENDENT_VERIFIER_MISSING',
        'PRODUCER_VERIFIER_INDEPENDENCE_UNPROVEN',
        'RECORD_EXPIRED',
        'RECORD_STALE',
        'TEMPORAL_CLOCK_UNBOUNDED',
        'TEMPORAL_SEQUENCE_GAP',
        'TEMPORAL_SKEW_EXCEEDED',
        'TEMPORAL_TIMELINE_INCOHERENT',
        'UNKNOWN_UNBOUNDED',
      ].includes(reason)
  ));
}

function resultBase({
  recordId,
  actionClass,
  evaluatedAtMs,
  status,
  reasonCodes,
  familyResults,
  assumptionResults,
  invariantResults,
  invalidatedEvidenceIds,
  nextCurrentnessBoundaryAtMs,
}) {
  return deepFreeze({
    schemaVersion: ACTION_EVIDENCE_RESULT_SCHEMA_VERSION,
    recordId,
    actionClass,
    truthLabel: ACTION_EVIDENCE_TRUTH_LABEL,
    useClass: ACTION_EVIDENCE_USE_CLASS,
    authorityEffect: ACTION_EVIDENCE_AUTHORITY_EFFECT,
    evaluatedAtMs,
    status,
    reasonCodes: normalizedReasons(status, reasonCodes),
    familyResults,
    assumptionResults,
    invariantResults,
    invalidatedEvidenceIds: sortedUnique(invalidatedEvidenceIds),
    nextCurrentnessBoundaryAtMs,
    commandsIssued: 0,
    canonicalRiskReductionUnaffected: true,
  });
}

function safeOwnData(value, key) {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function safeEnvelopeBinding(envelope) {
  const record = safeOwnData(envelope, 'record');
  const recordId = safeOwnData(record, 'recordId');
  const actionClass = safeOwnData(record, 'actionClass');
  return {
    recordId: typeof recordId === 'string' ? recordId : null,
    actionClass: ACTION_EVIDENCE_CLASSES.includes(actionClass) ? actionClass : null,
  };
}

function invalidEnvelopeResult(envelope, nowMs, validation) {
  const binding = safeEnvelopeBinding(envelope);
  return resultBase({
    recordId: binding.recordId,
    actionClass: binding.actionClass,
    evaluatedAtMs: isUtcMs(nowMs) ? nowMs : null,
    status: 'UNKNOWN',
    reasonCodes: ['SCHEMA_INVALID', ...validation.issues.map((entry) => entry.code)],
    familyResults: Object.freeze([]),
    assumptionResults: Object.freeze([]),
    invariantResults: Object.freeze([]),
    invalidatedEvidenceIds: Object.freeze([]),
    nextCurrentnessBoundaryAtMs: null,
  });
}

function evaluateTemporalContext(context, nowMs) {
  const reasons = [];
  if (context.referenceTimeMs > nowMs || context.watermarkMs > context.referenceTimeMs) {
    reasons.push('TEMPORAL_TIMELINE_INCOHERENT');
  }
  if (nowMs >= context.referenceTimeMs
    && nowMs - context.referenceTimeMs > context.maximumReferenceAgeMs) {
    reasons.push('TEMPORAL_REFERENCE_STALE');
  }
  const eventTimes = [];
  for (const source of context.sources) {
    const ordered = source.eventAtMs <= source.receivedAtMs
      && source.receivedAtMs <= source.availableAtMs
      && source.availableAtMs <= source.processedAtMs
      && source.processedAtMs <= context.referenceTimeMs;
    if (!ordered) reasons.push('TEMPORAL_TIMELINE_INCOHERENT');
    if (nowMs < source.eventAtMs) reasons.push('TEMPORAL_SOURCE_NOT_YET_VALID');
    if (nowMs >= source.eventAtMs && nowMs - source.eventAtMs > source.maximumAgeMs) {
      reasons.push('TEMPORAL_SOURCE_STALE');
    }
    if (nowMs >= source.expiresAtMs) reasons.push('TEMPORAL_SOURCE_EXPIRED');
    if (source.sequenceGap !== 'NONE') reasons.push('TEMPORAL_SEQUENCE_GAP');
    if (source.clockQuality !== 'BOUNDED') reasons.push('TEMPORAL_CLOCK_UNBOUNDED');
    eventTimes.push(source.eventAtMs);
  }
  if (eventTimes.length > 1) {
    const skew = Math.max(...eventTimes) - Math.min(...eventTimes);
    if (skew > context.maximumPairwiseSkewMs) reasons.push('TEMPORAL_SKEW_EXCEEDED');
  }
  return sortedUnique(reasons);
}

function currentnessReasons(reference, nowMs, prefix) {
  const reasons = [];
  if (nowMs < reference.observedAtMs) reasons.push(`${prefix}_NOT_YET_VALID`);
  if (nowMs >= reference.expiresAtMs) reasons.push(`${prefix}_EXPIRED`);
  if (nowMs >= reference.observedAtMs
    && nowMs - reference.observedAtMs > reference.maximumAgeMs) reasons.push(`${prefix}_STALE`);
  return reasons;
}

function staleBoundary(startMs, maximumAgeMs) {
  const boundary = startMs + maximumAgeMs + 1;
  return isUtcMs(boundary) ? boundary : null;
}

function firstFuture(nowMs, candidates) {
  const future = candidates.filter((value) => isUtcMs(value) && value > nowMs);
  return future.length === 0 ? null : Math.min(...future);
}

function mergeFinding(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return {
    status: statusFrom([left.status, right.status]),
    reasonCodes: sortedUnique([...left.reasonCodes, ...right.reasonCodes]),
    invalidationIds: sortedUnique([
      ...(left.invalidationIds ?? []),
      ...(right.invalidationIds ?? []),
    ]),
  };
}

function actionFactFinding(record, familyName, nowMs) {
  const facts = record.actionFacts;
  const unknown = (reason) => ({ status: 'UNKNOWN', reasonCodes: [reason], invalidationIds: [] });
  const fail = (reason) => ({ status: 'FAIL', reasonCodes: [reason], invalidationIds: [] });
  let finding = null;

  const futureObservations = record.actionClass === 'ORDER_INTENT'
    ? [facts.signedAtMs, facts.acknowledgedAtMs]
    : record.actionClass === 'CANCELLATION'
      ? [
          facts.signedAtMs,
          facts.cancellationRequestedAtMs,
          facts.acknowledgedAtMs,
          facts.terminalAtMs,
          facts.latestFillAtMs,
        ]
      : [];
  if (futureObservations.some((value) => value !== null && value > nowMs)) {
    return unknown('ACTION_FACTS_NOT_YET_VALID');
  }

  if (familyName === 'ACTION_BINDING'
    && ['STALE', 'SUBJECT_MISMATCH', 'POLICY_MISMATCH', 'UNKNOWN'].includes(facts.ownerDecisionReferenceState)) {
    finding = unknown(`OWNER_DECISION_REFERENCE_${facts.ownerDecisionReferenceState}`);
  }
  if (familyName === 'MUTATION_INPUT_TRUTH' && facts.ownerTruthState === 'CHANGED_AFTER_PROPOSAL') {
    finding = unknown('OWNER_TRUTH_CHANGED_AFTER_PROPOSAL');
  } else if (familyName === 'MUTATION_INPUT_TRUTH' && facts.ownerTruthState === 'UNKNOWN') {
    finding = unknown('OWNER_TRUTH_UNKNOWN');
  }

  if (familyName === 'FENCING_AND_IDEMPOTENCY' && Object.hasOwn(facts, 'leaseState')) {
    if (facts.leaseState === 'UNKNOWN') finding = mergeFinding(finding, unknown('FENCING_LEASE_UNKNOWN'));
    if (facts.leaseState === 'LOST') {
      if (Object.hasOwn(facts, 'leaseLossObservedAtMs') && Object.hasOwn(facts, 'acknowledgedAtMs')) {
        const beforeAcknowledgement = facts.leaseLossObservedAtMs === null
          || facts.leaseLossObservedAtMs < facts.acknowledgedAtMs;
        finding = mergeFinding(
          finding,
          beforeAcknowledgement
            ? fail('LEASE_LOST_BEFORE_ACKNOWLEDGEMENT')
            : unknown('LEASE_LOST_AFTER_ACKNOWLEDGEMENT'),
        );
      } else {
        finding = mergeFinding(finding, fail('FENCING_LEASE_LOST'));
      }
    }
  }

  if (familyName === 'REGISTERED_RECOVERY_OR_REPAIR_PATH'
    && Object.hasOwn(facts, 'recoveryPathState')) {
    if (facts.recoveryPathState === 'MISSING') finding = mergeFinding(finding, fail('OWNER_REGISTERED_FALLBACK_MISSING'));
    if (facts.recoveryPathState === 'EXPIRED') finding = mergeFinding(finding, unknown('RECOVERY_PATH_EXPIRED'));
    if (facts.recoveryPathState === 'UNKNOWN') finding = mergeFinding(finding, unknown('RECOVERY_PATH_UNKNOWN'));
    if (facts.partialFillState === 'UNKNOWN') finding = mergeFinding(finding, unknown('PARTIAL_FILL_STATE_UNKNOWN'));
    const partial = ['PARTIALLY_FILLED', 'BOUNDED'].includes(facts.partialFillState)
      || (record.actionClass === 'CANCELLATION'
        && typeof facts.cumulativeFilledQuantity === 'string'
        && /[1-9]/u.test(facts.cumulativeFilledQuantity));
    if (partial && facts.rateLimitState === 'RATE_LIMITED') finding = mergeFinding(finding, fail('PARTIAL_FILL_RECOVERY_RATE_LIMITED'));
    if (facts.rateLimitState === 'UNKNOWN') finding = mergeFinding(finding, unknown('RECOVERY_RATE_LIMIT_UNKNOWN'));
  }

  if (record.actionClass === 'CANCELLATION') {
    if (familyName === 'LIFECYCLE_STATE_AND_OUTCOME') {
      if (['CANCEL_PENDING', 'AMBIGUOUS', 'UNKNOWN'].includes(facts.cancellationState)) finding = mergeFinding(finding, unknown('CANCEL_PENDING_NOT_TERMINAL'));
      if (facts.cancellationState === 'FILLED') finding = mergeFinding(finding, fail('CANCELLATION_TARGET_FILLED'));
    }
    if (familyName === 'CANCELLATION_AND_LATE_RESULT' && facts.latestFillAtMs !== null) {
      const boundaries = [facts.localTimeoutAtMs, facts.terminalAtMs]
        .filter((value) => value !== null);
      if (boundaries.length > 0 && facts.latestFillAtMs > Math.min(...boundaries)) {
        finding = mergeFinding(finding, fail('LATE_FILL_AFTER_CANCEL_TIMEOUT'));
      }
    }
  }

  if (record.actionClass === 'REPAIR_STEP'
    && ['LIFECYCLE_STATE_AND_OUTCOME', 'REGISTERED_RECOVERY_OR_REPAIR_PATH'].includes(familyName)) {
    if (['MISSING', 'UNKNOWN'].includes(facts.receiptState)) finding = mergeFinding(finding, unknown('REPAIR_RECEIPT_UNKNOWN'));
    if (nowMs >= facts.postconditionExpiresAtMs) return mergeFinding(finding, unknown('REPAIR_POSTCONDITION_EXPIRED'));
    if (nowMs < facts.postconditionObservedAtMs) return mergeFinding(finding, unknown('REPAIR_POSTCONDITION_NOT_YET_VALID'));
    if (['RESTARTED_UNRECONCILED', 'FAILED_OR_RECURRED'].includes(facts.postconditionState)) finding = mergeFinding(finding, fail('REPAIR_POSTCONDITION_NOT_RECONCILED'));
    if (['QUIET_PERIOD_INCOMPLETE', 'UNKNOWN'].includes(facts.postconditionState)) finding = mergeFinding(finding, unknown('REPAIR_POSTCONDITION_UNKNOWN'));
  }

  if (record.actionClass === 'HALT'
    && ['LIFECYCLE_STATE_AND_OUTCOME', 'OUTCOME_OBSERVABILITY_AND_SUPERVISION'].includes(familyName)) {
    if (['MISSING', 'UNKNOWN'].includes(facts.receiptState)) finding = mergeFinding(finding, unknown('HALT_RECEIPT_UNKNOWN'));
    if (nowMs >= facts.readbackExpiresAtMs) return mergeFinding(finding, unknown('HALT_READBACK_EXPIRED'));
    if (nowMs < facts.readbackObservedAtMs) return mergeFinding(finding, unknown('HALT_READBACK_NOT_YET_VALID'));
    if (facts.readbackState === 'NOT_HALTED') finding = mergeFinding(finding, fail('HALT_READBACK_NOT_HALTED'));
    if (['MISSING', 'UNKNOWN'].includes(facts.readbackState)) finding = mergeFinding(finding, unknown('HALT_READBACK_UNKNOWN'));
  }

  if (record.actionClass === 'RECOVERY_STEP') {
    if (familyName === 'LIFECYCLE_STATE_AND_OUTCOME') {
      if (facts.recommendationAutomatic === true) finding = mergeFinding(finding, fail('RECOVERY_RECOMMENDATION_AUTOMATION_FORBIDDEN'));
      if (['RECOMMENDATION_ONLY', 'AWARENESS_ONLY', 'MISSING'].includes(facts.executionBindingState)) finding = mergeFinding(finding, fail('RECOVERY_NOT_EXECUTION_BOUND'));
      if (facts.executionBindingState === 'UNKNOWN') finding = mergeFinding(finding, unknown('RECOVERY_EXECUTION_BINDING_UNKNOWN'));
    }
    if (familyName === 'CANCELLATION_AND_LATE_RESULT') {
      if (facts.lateResultState === 'FILL_AFTER_CANCEL') finding = mergeFinding(finding, fail('LATE_FILL_AFTER_CANCEL_TIMEOUT'));
      if (facts.lateResultState === 'UNKNOWN') finding = mergeFinding(finding, unknown('LATE_RESULT_UNKNOWN'));
    }
  }

  return finding;
}

function directFamilyResult(family, record, nowMs, activeInvalidations, temporalReasons) {
  const reasons = [];
  const recordTimelineValid = record.createdAtMs < record.expiresAtMs;
  const recordNotYetValid = nowMs < record.createdAtMs;
  const recordExpired = nowMs >= record.expiresAtMs;
  const recordStale = nowMs >= record.createdAtMs
    && nowMs - record.createdAtMs > record.maximumAgeMs;
  const familyTimelineValid = family.producedAtMs <= (family.verifiedAtMs ?? family.producedAtMs)
    && (family.verifiedAtMs ?? family.producedAtMs) < family.expiresAtMs;
  const familyNotYetValid = family.verifiedAtMs !== null && nowMs < family.verifiedAtMs;
  const familyExpired = nowMs >= family.expiresAtMs;
  const familyStale = family.verifiedAtMs !== null
    && nowMs >= family.verifiedAtMs
    && nowMs - family.verifiedAtMs > family.maximumAgeMs;
  const invalidations = family.evidenceIds.flatMap((evidenceId) => activeInvalidations.get(evidenceId) ?? []);

  for (const sourceReference of family.sourceRefs) {
    reasons.push(...currentnessReasons(sourceReference, nowMs, 'SOURCE_REFERENCE'));
  }
  if (family.family === 'ACTION_BINDING') {
    reasons.push(...currentnessReasons(record.actionReference, nowMs, 'ACTION_REFERENCE'));
    for (const ownerReference of record.ownerReferences) {
      reasons.push(...currentnessReasons(ownerReference, nowMs, 'OWNER_REFERENCE'));
    }
  }

  if (!recordTimelineValid || !familyTimelineValid) reasons.push('EVIDENCE_TIMELINE_INCOHERENT');
  if (recordNotYetValid || familyNotYetValid) reasons.push('EVIDENCE_NOT_YET_VALID');
  if (recordExpired) reasons.push('RECORD_EXPIRED');
  if (recordStale) reasons.push('RECORD_STALE');
  if (familyExpired) reasons.push('EVIDENCE_EXPIRED');
  if (familyStale) reasons.push('EVIDENCE_STALE');
  if (invalidations.length > 0) reasons.push('EVIDENCE_INVALIDATED');
  if (family.verifiedBy === null) reasons.push('INDEPENDENT_VERIFIER_MISSING');

  const nonCurrent = reasons.length > 0;
  if (nonCurrent) {
    if (family.family === 'ACTION_BINDING'
      && ['STALE', 'SUBJECT_MISMATCH', 'POLICY_MISMATCH', 'UNKNOWN']
        .includes(record.actionFacts.ownerDecisionReferenceState)) {
      reasons.push(`OWNER_DECISION_REFERENCE_${record.actionFacts.ownerDecisionReferenceState}`);
    }
    return {
      status: 'UNKNOWN',
      reasonCodes: sortedUnique(reasons),
      invalidationIds: sortedUnique(invalidations.map((entry) => entry.invalidationId)),
    };
  }

  if (family.producedBy.actorId === family.verifiedBy.actorId) {
    return {
      status: 'FAIL',
      reasonCodes: Object.freeze(['PRODUCER_VERIFIER_NOT_INDEPENDENT']),
      invalidationIds: Object.freeze([]),
    };
  }
  if (family.producedBy.independenceDomainId === family.verifiedBy.independenceDomainId
    || family.producedBy.ownerId === family.verifiedBy.ownerId) {
    return {
      status: 'UNKNOWN',
      reasonCodes: Object.freeze(['PRODUCER_VERIFIER_INDEPENDENCE_UNPROVEN']),
      invalidationIds: Object.freeze([]),
    };
  }

  if (family.family === 'FRESHNESS_AND_TEMPORAL_COHERENCE' && temporalReasons.length > 0) {
    return {
      status: 'UNKNOWN',
      reasonCodes: temporalReasons,
      invalidationIds: Object.freeze([]),
    };
  }

  if (family.family === 'EXPOSURE_AND_LIABILITY_BOUNDS') {
    const scenario = record.scenarioEnvelope;
    if (!scenario.bounded
      || scenario.maximumExposure === null
      || scenario.maximumLiability === null
      || scenario.maximumRecoveryCost === null) {
      return {
        status: 'UNKNOWN',
        reasonCodes: Object.freeze(['UNKNOWN_UNBOUNDED']),
        invalidationIds: Object.freeze([]),
      };
    }
    if (scenario.timeHeadroomMs === 0) {
      return {
        status: 'UNKNOWN',
        reasonCodes: Object.freeze(['SCENARIO_TIME_HEADROOM_EXHAUSTED']),
        invalidationIds: Object.freeze([]),
      };
    }
  }

  if (family.family === 'FENCING_AND_IDEMPOTENCY'
    && record.fencingContext.relevant
    && nowMs >= record.fencingContext.leaseExpiresAtMs) {
    return {
      status: 'UNKNOWN',
      reasonCodes: Object.freeze(['FENCING_LEASE_EXPIRED']),
      invalidationIds: Object.freeze([]),
    };
  }

  if (family.family === 'REGISTERED_RECOVERY_OR_REPAIR_PATH'
    && !record.scenarioEnvelope.rateLimitHeadroomKnown) {
    return {
      status: 'UNKNOWN',
      reasonCodes: Object.freeze(['RECOVERY_HEADROOM_UNKNOWN']),
      invalidationIds: Object.freeze([]),
    };
  }

  let finding;
  if (family.assertion === 'CONTRADICTED') {
    finding = {
      status: 'FAIL',
      reasonCodes: sortedUnique(['EVIDENCE_CONTRADICTED', ...family.reasonCodes]),
      invalidationIds: Object.freeze([]),
    };
  } else if (family.assertion === 'UNRESOLVED') {
    finding = {
      status: 'UNKNOWN',
      reasonCodes: sortedUnique(['EVIDENCE_UNRESOLVED', ...family.reasonCodes]),
      invalidationIds: Object.freeze([]),
    };
  } else {
    finding = {
      status: 'PASS',
      reasonCodes: sortedUnique(['EVIDENCE_SATISFIED', ...family.reasonCodes]),
      invalidationIds: Object.freeze([]),
    };
  }
  return mergeFinding(finding, actionFactFinding(record, family.family, nowMs));
}

export function evaluateActionEvidenceEnvelope(envelope, nowMs) {
  const snapshot = snapshotPlainData(envelope);
  const stableEnvelope = snapshot.ok ? snapshot.value : null;
  const validation = snapshot.ok
    ? validateActionEvidenceEnvelope(stableEnvelope)
    : {
        valid: false,
        issues: [{ code: snapshot.issueCode ?? 'PLAIN_DATA_SNAPSHOT_FAILED' }],
      };
  if (!isUtcMs(nowMs)) {
    const binding = safeEnvelopeBinding(stableEnvelope);
    return resultBase({
      recordId: binding.recordId,
      actionClass: binding.actionClass,
      evaluatedAtMs: null,
      status: 'UNKNOWN',
      reasonCodes: ['EVALUATION_TIME_INVALID'],
      familyResults: Object.freeze([]),
      assumptionResults: Object.freeze([]),
      invariantResults: Object.freeze([]),
      invalidatedEvidenceIds: Object.freeze([]),
      nextCurrentnessBoundaryAtMs: null,
    });
  }
  if (!validation.valid) return invalidEnvelopeResult(stableEnvelope, nowMs, validation);

  const record = stableEnvelope.record;
  const activeInvalidations = new Map();
  for (const invalidation of record.invalidations) {
    if (invalidation.invalidatedAtMs <= nowMs) {
      const entries = activeInvalidations.get(invalidation.evidenceId) ?? [];
      entries.push(invalidation);
      activeInvalidations.set(invalidation.evidenceId, entries);
    }
  }
  const temporalReasons = evaluateTemporalContext(record.temporalContext, nowMs);
  const evidenceToFamily = new Map();
  const familiesByName = new Map();
  for (const family of record.families) {
    familiesByName.set(family.family, family);
    for (const evidenceId of family.evidenceIds) evidenceToFamily.set(evidenceId, family.family);
  }

  const direct = new Map();
  for (const family of record.families) {
    direct.set(family.family, directFamilyResult(
      family,
      record,
      nowMs,
      activeInvalidations,
      temporalReasons,
    ));
  }

  const memo = new Map();
  const evaluateFamily = (familyName, stack = []) => {
    if (memo.has(familyName)) return memo.get(familyName);
    if (stack.includes(familyName)) {
      return {
        status: 'UNKNOWN',
        reasonCodes: Object.freeze(['EVIDENCE_DEPENDENCY_CYCLE']),
        invalidationIds: Object.freeze([]),
      };
    }
    const family = familiesByName.get(familyName);
    const own = direct.get(familyName);
    const dependencies = family.dependencyEvidenceIds.map((evidenceId) => (
      evaluateFamily(evidenceToFamily.get(evidenceId), [...stack, familyName])
    ));
    const uncertainty = own.status === 'UNKNOWN'
      || dependencies.some(dependencyUnknownMasksContradiction);
    const status = uncertainty
      ? 'UNKNOWN'
      : statusFrom([own.status, ...dependencies.map((entry) => entry.status)]);
    const retainedDependencies = uncertainty
      ? dependencies.filter((entry) => entry.status !== 'FAIL')
      : dependencies;
    const dependencyReasons = retainedDependencies.flatMap((entry) => entry.reasonCodes);
    const dependencyCodes = dependencies.flatMap((entry) => (
      entry.status === 'FAIL' && uncertainty ? []
        : entry.status === 'FAIL' ? ['EVIDENCE_DEPENDENCY_FAILED']
        : entry.status === 'UNKNOWN' ? ['EVIDENCE_DEPENDENCY_UNKNOWN'] : []
    ));
    const result = {
      status,
      reasonCodes: normalizedReasons(status, [
        ...(uncertainty && own.status === 'FAIL' ? [] : own.reasonCodes),
        ...dependencyReasons,
        ...dependencyCodes,
      ]),
      invalidationIds: sortedUnique([
        ...own.invalidationIds,
        ...dependencies.flatMap((entry) => entry.invalidationIds),
      ]),
    };
    memo.set(familyName, result);
    return result;
  };

  const familyResults = REQUIRED_EVIDENCE_FAMILIES[record.actionClass]
    .map((familyName) => {
      const family = familiesByName.get(familyName);
      const derived = evaluateFamily(familyName);
      return deepFreeze({
        family: familyName,
        status: derived.status,
        reasonCodes: derived.reasonCodes,
        evidenceIds: Object.freeze([...family.evidenceIds].sort()),
        dependencyEvidenceIds: Object.freeze([...family.dependencyEvidenceIds].sort()),
        invalidationIds: derived.invalidationIds,
        expiresAtMs: family.expiresAtMs,
      });
    })
    .sort((left, right) => left.family.localeCompare(right.family));

  const familyResultByEvidence = new Map();
  for (const familyResult of familyResults) {
    for (const evidenceId of familyResult.evidenceIds) familyResultByEvidence.set(evidenceId, familyResult);
  }
  const supportResult = (entry, kind) => {
    const timeKey = kind === 'ASSUMPTION' ? 'observedAtMs' : 'evaluatedAtMs';
    const ownReasons = currentnessReasons({
      observedAtMs: entry[timeKey],
      maximumAgeMs: entry.maximumAgeMs,
      expiresAtMs: entry.expiresAtMs,
    }, nowMs, kind);
    const invalidations = entry.evidenceIds.flatMap((evidenceId) => activeInvalidations.get(evidenceId) ?? []);
    if (invalidations.length > 0) ownReasons.push(`${kind}_EVIDENCE_INVALIDATED`);
    let ownStatus;
    if (ownReasons.length > 0) ownStatus = 'UNKNOWN';
    else if ((kind === 'ASSUMPTION' ? entry.state : entry.status) === 'CONTRADICTED'
      || (kind === 'INVARIANT' && entry.status === 'FAIL')) ownStatus = 'FAIL';
    else if ((kind === 'ASSUMPTION' ? entry.state : entry.status) === 'UNKNOWN') ownStatus = 'UNKNOWN';
    else ownStatus = 'PASS';
    const dependencies = entry.evidenceIds.map((evidenceId) => familyResultByEvidence.get(evidenceId));
    const uncertainty = ownStatus === 'UNKNOWN'
      || dependencies.some(dependencyUnknownMasksContradiction);
    const status = uncertainty
      ? 'UNKNOWN'
      : statusFrom([ownStatus, ...dependencies.map((dependency) => dependency.status)]);
    const retainedDependencies = uncertainty
      ? dependencies.filter((dependency) => dependency.status !== 'FAIL')
      : dependencies;
    const dependencyReasons = retainedDependencies.flatMap((dependency) => dependency.reasonCodes);
    const reasonCodes = normalizedReasons(status, [
      ...ownReasons,
      ...(uncertainty && ownStatus === 'FAIL'
        ? []
        : ownReasons.length === 0 ? [`${kind}_${ownStatus}`] : []),
      ...dependencyReasons,
      ...dependencies.flatMap((dependency) => (
        dependency.status === 'FAIL' && uncertainty ? []
          : dependency.status === 'FAIL' ? [`${kind}_DEPENDENCY_FAILED`]
          : dependency.status === 'UNKNOWN' ? [`${kind}_DEPENDENCY_UNKNOWN`] : []
      )),
    ]);
    return deepFreeze({
      [`${kind === 'ASSUMPTION' ? 'assumption' : 'invariant'}Id`]: kind === 'ASSUMPTION'
        ? entry.assumptionId : entry.invariantId,
      status,
      reasonCodes,
      evidenceIds: Object.freeze([...entry.evidenceIds].sort()),
      invalidationIds: sortedUnique(invalidations.map((invalidation) => invalidation.invalidationId)),
      expiresAtMs: entry.expiresAtMs,
    });
  };
  const assumptionResults = record.activeAssumptions
    .map((entry) => supportResult(entry, 'ASSUMPTION'))
    .sort((left, right) => left.assumptionId.localeCompare(right.assumptionId));
  const invariantResults = record.invariantResults
    .map((entry) => supportResult(entry, 'INVARIANT'))
    .sort((left, right) => left.invariantId.localeCompare(right.invariantId));

  const allStatuses = [
    ...familyResults.map((entry) => entry.status),
    ...assumptionResults.map((entry) => entry.status),
    ...invariantResults.map((entry) => entry.status),
  ];
  const status = statusFrom(allStatuses);

  const references = [
    record.actionReference,
    ...record.ownerReferences,
    ...record.families.flatMap((family) => family.sourceRefs),
  ];
  const nextCurrentnessBoundaryAtMs = firstFuture(nowMs, [
    record.createdAtMs,
    record.expiresAtMs,
    staleBoundary(record.createdAtMs, record.maximumAgeMs),
    record.temporalContext.referenceTimeMs,
    staleBoundary(record.temporalContext.referenceTimeMs, record.temporalContext.maximumReferenceAgeMs),
    ...record.temporalContext.sources.flatMap((source) => [
      source.eventAtMs,
      source.expiresAtMs,
      staleBoundary(source.eventAtMs, source.maximumAgeMs),
    ]),
    ...record.families.flatMap((family) => [
      family.verifiedAtMs,
      family.expiresAtMs,
      family.verifiedAtMs === null ? null : staleBoundary(family.verifiedAtMs, family.maximumAgeMs),
    ]),
    ...references.flatMap((reference) => [
      reference.observedAtMs,
      reference.expiresAtMs,
      staleBoundary(reference.observedAtMs, reference.maximumAgeMs),
    ]),
    ...record.activeAssumptions.flatMap((entry) => [
      entry.observedAtMs,
      entry.expiresAtMs,
      staleBoundary(entry.observedAtMs, entry.maximumAgeMs),
    ]),
    ...record.invariantResults.flatMap((entry) => [
      entry.evaluatedAtMs,
      entry.expiresAtMs,
      staleBoundary(entry.evaluatedAtMs, entry.maximumAgeMs),
    ]),
    ...(record.fencingContext.relevant ? [record.fencingContext.leaseExpiresAtMs] : []),
    ...record.invalidations.map((invalidation) => invalidation.invalidatedAtMs),
    ...(record.actionClass === 'REPAIR_STEP' ? [
      record.actionFacts.postconditionObservedAtMs,
      record.actionFacts.postconditionExpiresAtMs,
    ] : []),
    ...(record.actionClass === 'HALT' ? [
      record.actionFacts.readbackObservedAtMs,
      record.actionFacts.readbackExpiresAtMs,
    ] : []),
    ...(record.actionClass === 'ORDER_INTENT' ? [
      record.actionFacts.signedAtMs,
      record.actionFacts.acknowledgedAtMs,
    ] : []),
    ...(record.actionClass === 'CANCELLATION' ? [
      record.actionFacts.signedAtMs,
      record.actionFacts.cancellationRequestedAtMs,
      record.actionFacts.acknowledgedAtMs,
      record.actionFacts.localTimeoutAtMs,
      record.actionFacts.terminalAtMs,
      record.actionFacts.latestFillAtMs,
    ] : []),
  ]);
  return resultBase({
    recordId: record.recordId,
    actionClass: record.actionClass,
    evaluatedAtMs: nowMs,
    status,
    reasonCodes: [
      ...familyResults.flatMap((entry) => entry.reasonCodes),
      ...assumptionResults.flatMap((entry) => entry.reasonCodes),
      ...invariantResults.flatMap((entry) => entry.reasonCodes),
    ],
    familyResults: Object.freeze(familyResults),
    assumptionResults: Object.freeze(assumptionResults),
    invariantResults: Object.freeze(invariantResults),
    invalidatedEvidenceIds: [...activeInvalidations.keys()],
    nextCurrentnessBoundaryAtMs,
  });
}

function notAuthorityError() {
  const error = new TypeError('ACTION_EVIDENCE_NOT_AUTHORITY: only SUPPORTING_EVIDENCE_ONLY consumption is permitted');
  error.code = 'ACTION_EVIDENCE_NOT_AUTHORITY';
  return error;
}

export function projectSupportingEvidenceUse(envelope, nowMs, request) {
  let checkedRequest = closedUseRequest(request);
  if (checkedRequest === null) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: supporting-evidence request field set is closed');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  if (checkedRequest.purpose !== ACTION_EVIDENCE_USE_CLASS) throw notAuthorityError();
  const requestSnapshot = snapshotPlainData(request);
  checkedRequest = requestSnapshot.ok ? closedUseRequest(requestSnapshot.value) : null;
  if (checkedRequest === null) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: supporting-evidence request must be stable bounded plain data');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  if (checkedRequest.purpose !== ACTION_EVIDENCE_USE_CLASS) throw notAuthorityError();
  if (checkedRequest.schemaVersion !== ACTION_EVIDENCE_USE_SCHEMA_VERSION
    || typeof checkedRequest.consumerId !== 'string' || !ID.test(checkedRequest.consumerId)
    || typeof checkedRequest.recordId !== 'string' || !ID.test(checkedRequest.recordId)
    || !isDenseIdArray(checkedRequest.canonicalOwnerDecisionIds)
    || new Set(checkedRequest.canonicalOwnerDecisionIds).size !== checkedRequest.canonicalOwnerDecisionIds.length) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: supporting-evidence request is malformed');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  const envelopeSnapshot = snapshotPlainData(envelope);
  const stableEnvelope = envelopeSnapshot.ok ? envelopeSnapshot.value : null;
  if (!isUtcMs(nowMs) || !validateActionEvidenceEnvelope(stableEnvelope).valid) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: projection requires a valid envelope and injected UTC evaluation time');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  const evaluation = evaluateActionEvidenceEnvelope(stableEnvelope, nowMs);
  if (!validateActionEvidenceResult(evaluation).valid || evaluation.familyResults.length === 0) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: recomputed result failed its closed contract');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  if (evaluation.recordId !== checkedRequest.recordId) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: envelope evaluation is not bound to the requested record');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  const ownerReferenceState = stableEnvelope.record.actionFacts.ownerDecisionReferenceState;
  const ownerReferencesAreCurrentAndExact = stableEnvelope.record.ownerReferences.every((reference) => (
    nowMs >= reference.observedAtMs
      && nowMs < reference.expiresAtMs
      && nowMs - reference.observedAtMs <= reference.maximumAgeMs
      && reference.binding.subjectDigest === stableEnvelope.record.subjectDigest
      && reference.binding.releaseId === stableEnvelope.record.versions.releaseId
      && reference.binding.policyRevision === stableEnvelope.record.versions.policyRevision
      && reference.binding.authorityMapCommit === stableEnvelope.record.versions.authorityMapCommit
  ));
  if (!ownerReferencesAreCurrentAndExact
    || (stableEnvelope.record.ownerReferences.length > 0
      && ownerReferenceState !== undefined
      && ownerReferenceState !== 'CURRENT_EXACT_SUBJECT')) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: projected canonical owner decisions must be current and exactly record-bound');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  const suppliedOwnerDecisionIds = [...checkedRequest.canonicalOwnerDecisionIds].sort();
  const envelopeOwnerDecisionIds = Array.isArray(stableEnvelope?.record?.ownerReferences)
    ? stableEnvelope.record.ownerReferences.map((reference) => reference.referenceId).sort()
    : [];
  if (suppliedOwnerDecisionIds.join('\n') !== envelopeOwnerDecisionIds.join('\n')) {
    const error = new TypeError('ACTION_EVIDENCE_USE_INVALID: canonical owner decision IDs must resolve exactly to the envelope');
    error.code = 'ACTION_EVIDENCE_USE_INVALID';
    throw error;
  }
  return deepFreeze({
    schemaVersion: ACTION_EVIDENCE_USE_SCHEMA_VERSION,
    recordId: evaluation.recordId,
    consumerId: checkedRequest.consumerId,
    truthLabel: ACTION_EVIDENCE_TRUTH_LABEL,
    useClass: ACTION_EVIDENCE_USE_CLASS,
    authorityEffect: ACTION_EVIDENCE_AUTHORITY_EFFECT,
    evidenceStatus: evaluation.status,
    evaluatedAtMs: evaluation.evaluatedAtMs,
    nextCurrentnessBoundaryAtMs: evaluation.nextCurrentnessBoundaryAtMs,
    familyStatuses: evaluation.familyResults.map((entry) => Object.freeze({
      family: entry.family,
      status: entry.status,
    })),
    canonicalOwnerDecisionIds: Object.freeze(suppliedOwnerDecisionIds),
    commandsIssued: 0,
  });
}
