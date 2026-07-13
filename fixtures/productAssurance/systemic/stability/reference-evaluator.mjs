/** Pure S8 reference evaluators. All time is caller-injected. */
import {
  ASSURANCE_RESULTS,
  STABILITY_SCHEMA_VERSION,
  deepFreeze,
  validateCancellationEvidence,
  validateRepairEvidence,
  validateRepairPolicy,
  validateResourceEvidenceBundle,
} from './contracts.mjs';

function validNow(nowMs) {
  return Number.isSafeInteger(nowMs) && nowMs >= 0;
}

function precedence(results) {
  if (results.includes('FAIL')) return 'FAIL';
  if (results.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function boundedSum(left, right) {
  if (left === null || right === null) return null;
  const sum = left + right;
  return Number.isFinite(sum) && Math.abs(sum) <= Number.MAX_SAFE_INTEGER ? sum : null;
}

function freshAt(observedAtMs, maxAgeMs, asOfMs) {
  return observedAtMs !== null
    && observedAtMs <= asOfMs
    && asOfMs - observedAtMs <= maxAgeMs;
}

function independentCircuitCloseProven(circuitEvidence, attempt) {
  if (circuitEvidence?.state !== 'CLOSED') return false;
  const baselineProven = circuitEvidence.baselineNeverOpenedEvidenceRef !== null
    && circuitEvidence.baselineEvidenceOwner !== null
    && circuitEvidence.baselineEvidenceFailureDomain !== null
    && circuitEvidence.baselineNeverOpenedEvidenceRef !== circuitEvidence.evidenceRef
    && circuitEvidence.baselineEvidenceOwner !== circuitEvidence.canonicalOwner
    && circuitEvidence.baselineEvidenceFailureDomain !== circuitEvidence.ownerFailureDomain
    && circuitEvidence.baselineEvidenceOwner !== attempt?.producerOwner
    && circuitEvidence.baselineEvidenceFailureDomain !== attempt?.producerFailureDomain;
  const transitionProven = circuitEvidence.openedAtMs !== null
    && circuitEvidence.halfOpenAtMs !== null
    && circuitEvidence.resetEligibleAtMs !== null
    && circuitEvidence.closedAtMs !== null
    && circuitEvidence.independentCloseEvidenceRef !== null
    && circuitEvidence.independentCloseOwner !== null
    && circuitEvidence.independentCloseFailureDomain !== null
    && circuitEvidence.openedAtMs <= circuitEvidence.halfOpenAtMs
    && circuitEvidence.halfOpenAtMs <= circuitEvidence.resetEligibleAtMs
    && circuitEvidence.resetEligibleAtMs <= circuitEvidence.closedAtMs
    && circuitEvidence.independentCloseEvidenceRef !== circuitEvidence.evidenceRef
    && circuitEvidence.independentCloseOwner !== circuitEvidence.canonicalOwner
    && circuitEvidence.independentCloseFailureDomain !== circuitEvidence.ownerFailureDomain
    && circuitEvidence.independentCloseOwner !== attempt?.producerOwner
    && circuitEvidence.independentCloseFailureDomain !== attempt?.producerFailureDomain;
  return baselineProven !== transitionProven && circuitEvidence.mayCloseOrReset === false;
}

function invalidAssessment(kind, nowMs, issues) {
  return deepFreeze({
    schemaVersion: STABILITY_SCHEMA_VERSION,
    assessmentKind: kind,
    evaluatedAtMs: nowMs,
    assuranceResult: 'FAIL',
    reasonCodes: ['CONTRACT_INVALID'],
    contractIssues: issues,
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  });
}

export function evaluateCancellationEvidence(record, nowMs) {
  if (!validNow(nowMs)) throw new TypeError('nowMs must be a non-negative safe integer from an injected clock');
  const issues = validateCancellationEvidence(record);
  if (issues.length > 0) return invalidAssessment('CANCELLATION_DEADLINE_LEASE', nowMs, issues);

  const reasons = [];
  const violations = [];
  const unknowns = [];
  let effectiveDeadlineAtMs = null;
  let deadlineEvidence = 'LEASE_GOVERNED';
  let leaseEvidence = 'NOT_APPLICABLE';
  let staleAuthorityRejected = false;
  let mayInitiateNewLocalEffects = true;

  if (nowMs < record.startedAtMs) violations.push('EVALUATION_PRECEDES_REQUEST');
  const observedTimes = [
    ['CANCEL_REQUEST_FROM_FUTURE', record.cancelRequestedAtMs],
    ['CANCEL_OBSERVATION_FROM_FUTURE', record.cancelObservedAtMs],
    ['EFFECT_INITIATION_FROM_FUTURE', record.effect.initiatedAtMs],
    ['EFFECT_COMMIT_FROM_FUTURE', record.effect.committedAtMs],
  ];
  for (const [code, observedAtMs] of observedTimes) if (observedAtMs !== null && observedAtMs > nowMs) violations.push(code);
  if (record.cancelRequestedAtMs !== null && record.cancelRequestedAtMs < record.startedAtMs) violations.push('CANCELLATION_REQUEST_PRECEDES_REQUEST_START');
  if (record.effect.initiatedAtMs !== null && record.effect.initiatedAtMs < record.startedAtMs) violations.push('EFFECT_PRECEDES_REQUEST_START');

  if (record.requestKind === 'BOUNDED_INTERNAL') {
    const budgetDeadline = record.startedAtMs + record.childBudgetMs;
    if (!Number.isSafeInteger(budgetDeadline)) violations.push('CHILD_BUDGET_OVERFLOW');
    effectiveDeadlineAtMs = Math.min(record.inheritedDeadlineAtMs, record.localDeadlineAtMs, budgetDeadline);
    deadlineEvidence = nowMs >= effectiveDeadlineAtMs ? 'EXPIRED' : 'ACTIVE';
    if (record.localDeadlineAtMs > record.inheritedDeadlineAtMs) violations.push('CHILD_DEADLINE_ESCAPES_PARENT');
    if (budgetDeadline > record.inheritedDeadlineAtMs) violations.push('CHILD_BUDGET_ESCAPES_PARENT');
    if (deadlineEvidence === 'EXPIRED') {
      reasons.push('DEADLINE_REACHED');
      mayInitiateNewLocalEffects = false;
    }
  } else {
    const leaseFromFuture = [record.lease.acquiredAtMs, record.lease.lastRenewedAtMs, record.lease.lastHeartbeatAtMs]
      .some((observedAtMs) => observedAtMs > nowMs);
    const heartbeatAgeMs = nowMs - record.lease.lastHeartbeatAtMs;
    if (record.lease.ownerId !== record.canonicalOwner) violations.push('LEASE_OWNER_NOT_CANONICAL_OWNER');
    if (leaseFromFuture) {
      leaseEvidence = 'FUTURE_EVIDENCE';
      staleAuthorityRejected = true;
      violations.push('LEASE_EVIDENCE_FROM_FUTURE');
    } else if (record.lease.fenceEpoch !== record.lease.activeFenceEpoch) {
      leaseEvidence = 'STALE_EPOCH';
      staleAuthorityRejected = true;
      violations.push('LEASE_EPOCH_NOT_CURRENT');
    } else if (nowMs >= record.lease.expiresAtMs) {
      leaseEvidence = 'EXPIRED';
      staleAuthorityRejected = true;
      violations.push('LEASE_EXPIRED');
    } else if (heartbeatAgeMs > record.lease.heartbeatMaxAgeMs) {
      leaseEvidence = 'STALE_HEARTBEAT';
      staleAuthorityRejected = true;
      violations.push('LEASE_HEARTBEAT_STALE');
    } else {
      leaseEvidence = 'CURRENT';
    }
    if (record.lease.completionEpoch !== null && record.lease.completionEpoch !== record.lease.activeFenceEpoch) {
      staleAuthorityRejected = record.lease.completionDisposition === 'REJECTED';
      if (record.lease.completionDisposition === 'APPLIED') violations.push('STALE_COMPLETION_APPLIED_AFTER_HANDOFF');
      else if (record.lease.completionDisposition === 'REJECTED') reasons.push('STALE_COMPLETION_REJECTED_AS_AUTHORITY');
    }
    if (leaseEvidence !== 'CURRENT') mayInitiateNewLocalEffects = false;
    const leasedEffectTimingViolation = (record.effect.initiatedAtMs !== null
        && (record.effect.initiatedAtMs < record.lease.acquiredAtMs || record.effect.initiatedAtMs >= record.lease.expiresAtMs))
      || (record.effect.committedAtMs !== null
        && (record.effect.committedAtMs < record.lease.acquiredAtMs || record.effect.committedAtMs >= record.lease.expiresAtMs));
    if (record.effect.initiatedAtMs !== null
      && record.effect.initiatedAtMs < record.lease.acquiredAtMs) violations.push('LEASED_EFFECT_INITIATED_BEFORE_ACQUISITION');
    if (record.effect.initiatedAtMs !== null
      && record.effect.initiatedAtMs >= record.lease.expiresAtMs) violations.push('LEASED_EFFECT_INITIATED_AT_OR_AFTER_EXPIRY');
    if (record.effect.committedAtMs !== null
      && record.effect.committedAtMs < record.lease.acquiredAtMs) violations.push('LEASED_EFFECT_COMMITTED_BEFORE_ACQUISITION');
    if (record.effect.committedAtMs !== null
      && record.effect.committedAtMs >= record.lease.expiresAtMs) violations.push('LEASED_EFFECT_COMMITTED_AT_OR_AFTER_EXPIRY');
    if (leasedEffectTimingViolation) mayInitiateNewLocalEffects = false;
  }

  const cancelIntentObserved = record.cancelObservedAtMs !== null;
  if (record.cancelRequestedAtMs !== null) {
    reasons.push('CANCELLATION_INTENT_REQUESTED');
    mayInitiateNewLocalEffects = false;
    if (!cancelIntentObserved) unknowns.push('CANCELLATION_PROPAGATION_UNPROVED');
  }
  if (record.cancelObservedAtMs !== null && record.cancelRequestedAtMs === null) {
    violations.push('CANCELLATION_OBSERVED_WITHOUT_REQUEST');
  }
  if (record.cancelObservedAtMs !== null && record.cancelRequestedAtMs !== null && record.cancelObservedAtMs < record.cancelRequestedAtMs) {
    violations.push('CANCELLATION_OBSERVED_BEFORE_REQUEST');
  }
  if (cancelIntentObserved) {
    reasons.push('CANCELLATION_INTENT_OBSERVED');
    mayInitiateNewLocalEffects = false;
    if (record.effect.kind === 'LOCAL' && record.effect.initiatedAtMs !== null && record.effect.initiatedAtMs >= record.cancelObservedAtMs) {
      violations.push('LOCAL_EFFECT_INITIATED_AFTER_CANCELLATION_OBSERVED');
    }
  }

  if (record.requestKind === 'BOUNDED_INTERNAL' && record.effect.initiatedAtMs !== null && record.effect.initiatedAtMs >= effectiveDeadlineAtMs) {
    violations.push('EFFECT_INITIATED_AT_OR_AFTER_DEADLINE');
  }

  const externalEffectPossible = record.effect.kind === 'EXTERNAL_OR_ALREADY_ACCEPTED';
  const authoritativeReconciliationRequired = externalEffectPossible
    || record.lateFact !== null
    || record.detachedRecovery?.reason === 'DURABLE_RECONCILIATION';
  if (externalEffectPossible && record.cancelRequestedAtMs !== null) reasons.push('CANCELLATION_INTENT_DOES_NOT_PROVE_MUTATION_ABSENCE');
  if (record.cancellationSupported === null) unknowns.push('CANCELLATION_SUPPORT_UNKNOWN');

  let detachedRecoveryContinuationRequired = false;
  if (record.detachedRecovery !== null) {
    const detached = record.detachedRecovery;
    const validDetach = detached.operationRegistered
      && detached.operationRegistryRef !== null
      && detached.canonicalOwner === record.canonicalOwner
      && detached.operationClass === record.operationClass
      && detached.fencedRecoveryContextId.length > 0
      && detached.leaseOwner === record.canonicalOwner
      && detached.fenceEpoch === detached.activeFenceEpoch
      && detached.fenceObservedAtMs <= nowMs
      && nowMs - detached.fenceObservedAtMs <= detached.fenceMaxAgeMs
      && nowMs < detached.leaseExpiresAtMs
      && (detached.reason !== 'ALREADY_AUTHORIZED_RISK_REDUCTION'
        || (detached.operationClass === 'RISK_REDUCING_RECOVERY'
          && detached.priorAuthorizationRef !== null));
    if (!validDetach) violations.push('DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED');
    else {
      detachedRecoveryContinuationRequired = true;
      reasons.push('REGISTERED_FENCED_RECOVERY_SURVIVES_INITIATOR_TIMEOUT');
    }
  }

  let lateFactDisposition = 'NOT_APPLICABLE';
  if (record.lateFact !== null) {
    lateFactDisposition = 'INGEST_DURABLY_AND_RECONCILE';
    reasons.push('LATE_EXTERNAL_TRUTH_RETAINED');
    if (record.lateFact.occurredAtMs > nowMs || record.lateFact.receivedAtMs > nowMs) violations.push('LATE_FACT_EVIDENCE_FROM_FUTURE');
    if (record.lateFact.sourceEpoch !== record.lateFact.activeEpoch) {
      staleAuthorityRejected = true;
      reasons.push('STALE_EPOCH_FACT_RETAINED_BUT_CANNOT_AUTHORIZE_NEW_WORK');
      if (record.lateFact.attemptedToAuthorizeNewWork) violations.push('STALE_EPOCH_FACT_ATTEMPTED_NEW_AUTHORITY');
    }
  }

  if (authoritativeReconciliationRequired
    && (record.reconciliationEvidence.required !== true
      || record.reconciliationEvidence.operationLookupRef === null
      || record.reconciliationEvidence.durableEvidenceRef === null)) {
    violations.push('AUTHORITATIVE_RECONCILIATION_EVIDENCE_MISSING');
  }

  if (record.restartEvidence.restoredFromCheckpoint
    && (!record.restartEvidence.preservedRequestId
      || !record.restartEvidence.preservedLateResultLaw
      || record.restartEvidence.stateDigestBeforeRestart !== record.restartEvidence.stateDigestAfterRestart
      || record.restartEvidence.restoredRequestId !== record.requestId
      || record.restartEvidence.restoredCancellationContextId !== record.cancellationContextId
      || record.restartEvidence.restoredLateResultLaw !== record.lateResultLaw
      || (authoritativeReconciliationRequired
        && record.restartEvidence.restoredReconciliationIdentityRef !== record.reconciliationEvidence.durableEvidenceRef))) {
    violations.push('RESTART_LOST_CANCELLATION_OR_LATE_RESULT_IDENTITY');
  }

  const assuranceResult = violations.length > 0 ? 'FAIL' : unknowns.length > 0 ? 'UNKNOWN' : 'PASS';
  return deepFreeze({
    schemaVersion: STABILITY_SCHEMA_VERSION,
    assessmentKind: 'CANCELLATION_DEADLINE_LEASE',
    recordId: record.recordId,
    requestId: record.requestId,
    operationId: record.operationId,
    canonicalOwner: record.canonicalOwner,
    lateResultLaw: record.lateResultLaw,
    evaluatedAtMs: nowMs,
    assuranceResult,
    effectiveDeadlineAtMs,
    deadlineEvidence,
    leaseEvidence,
    cancelIntentObserved,
    cancellationSupported: record.cancellationSupported,
    cancellationProvesMutationAbsence: false,
    mayInitiateNewLocalEffects,
    authoritativeReconciliationRequired,
    detachedRecoveryContinuationRequired,
    lateFactDisposition,
    staleAuthorityRejected,
    reasonCodes: sortedUnique([...reasons, ...violations, ...unknowns]),
    violationCodes: sortedUnique(violations),
    unknownCodes: sortedUnique(unknowns),
    contractIssues: [],
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  });
}

function progressDelta(direction, previous, current) {
  const delta = direction === 'INCREASE_IS_PROGRESS' ? current - previous : previous - current;
  return Number.isFinite(delta) && Math.abs(delta) <= Number.MAX_SAFE_INTEGER ? delta : null;
}

function containmentSufficient(containment, durableEvidenceRequired, expectedEscalationOwner) {
  if (containment.furtherAutomaticActuation !== false) return false;
  if (durableEvidenceRequired && containment.durableUnresolvedEvidenceRef === null) return false;
  const quarantined = containment.lifecycle === 'QUARANTINED';
  const escalated = containment.lifecycle === 'FAILED_ATTENTION_REQUIRED'
    && containment.escalationOwner === expectedEscalationOwner;
  const durablyUnresolved = containment.durableUnresolvedEvidenceRef !== null;
  if (containment.lifecycle === 'QUARANTINED') return quarantined;
  if (containment.lifecycle === 'FAILED_ATTENTION_REQUIRED') return escalated;
  return durablyUnresolved;
}

function oscillationEvidence(policy, attempts) {
  const stableFingerprintFields = policy.oscillationLaw.actionFingerprintFields
    .filter((field) => field !== 'actionDirection');
  const fingerprintGroups = new Map();
  for (const attempt of attempts) {
    const fingerprint = JSON.stringify(stableFingerprintFields.map((field) => field === 'resourceIds'
      ? [...attempt.resourceIds].sort()
      : attempt[field]));
    const group = fingerprintGroups.get(fingerprint) ?? [];
    group.push(attempt);
    fingerprintGroups.set(fingerprint, group);
  }
  let alternations = 0;
  let netProgress = null;
  let detected = false;
  for (const group of fingerprintGroups.values()) {
    const directional = group.filter((attempt) => ['INCREASE', 'DECREASE'].includes(attempt.actionDirection));
    let groupAlternations = 0;
    for (let index = 1; index < directional.length; index += 1) {
      if (directional[index].actionDirection !== directional[index - 1].actionDirection) groupAlternations += 1;
    }
    const groupProgress = directional.map((attempt) => attempt.progressValue).filter((value) => value !== null);
    const groupNetProgress = groupProgress.length >= 2
      ? progressDelta(policy.progressLaw.direction, groupProgress[0], groupProgress.at(-1))
      : 0;
    alternations = Math.max(alternations, groupAlternations);
    if (groupNetProgress !== null) {
      netProgress = netProgress === null ? groupNetProgress : Math.min(netProgress, groupNetProgress);
    }
    if (groupNetProgress !== null
      && groupAlternations >= policy.oscillationLaw.minimumAlternations
      && groupNetProgress < policy.oscillationLaw.minimumNetProgress) detected = true;
  }
  const conflictingControllersPresent = new Set(attempts.map((attempt) => attempt.controllerId)).size > 1
    || attempts.some((attempt) => policy.oscillationLaw.conflictingControllerIds.includes(attempt.controllerId));
  return { alternations, netProgress, detected, conflictingControllersPresent };
}

function progressEvidenceAt(policy, attempts, asOfMs) {
  const windowStartMs = asOfMs - policy.progressLaw.noProgressWindowMs;
  const windowAttempts = attempts.filter((attempt) => attempt.verifierObservedAtMs >= windowStartMs
    && attempt.verifierObservedAtMs <= asOfMs);
  let contradictoryCount = 0;
  let trailingNoProgress = 0;
  let previousProgress = null;
  let missingProgress = false;
  for (const attempt of windowAttempts) {
    if (attempt.progressValue === null) {
      missingProgress = true;
      previousProgress = null;
      continue;
    }
    if (previousProgress !== null) {
      const delta = progressDelta(policy.progressLaw.direction, previousProgress, attempt.progressValue);
      if (delta === null) {
        missingProgress = true;
        previousProgress = attempt.progressValue;
        continue;
      }
      if (delta >= policy.progressLaw.minimumDelta) trailingNoProgress = 0;
      else {
        trailingNoProgress += 1;
        if (delta <= -policy.progressLaw.minimumDelta) contradictoryCount += 1;
      }
    }
    previousProgress = attempt.progressValue;
  }
  return {
    windowStartMs,
    windowAttempts,
    trailingNoProgress,
    contradictoryCount,
    rollbackCount: windowAttempts.filter((attempt) => attempt.rollback !== 'NONE').length,
    missingProgress,
  };
}

function crossesHysteresisExit(policy, progressValue) {
  if (progressValue === null) return false;
  return policy.hysteresis.direction === 'INCREASE_IS_PROGRESS'
    ? progressValue >= policy.hysteresis.exitThreshold
    : progressValue <= policy.hysteresis.exitThreshold;
}

export function evaluateRepairLoop(policy, evidence, nowMs) {
  if (!validNow(nowMs)) throw new TypeError('nowMs must be a non-negative safe integer from an injected clock');
  const policyIssues = validateRepairPolicy(policy);
  const evidenceIssues = validateRepairEvidence(evidence);
  const combinedIssues = deepFreeze([
    ...policyIssues.map((entry) => ({ ...entry, path: `policy${entry.path.slice(1)}` })),
    ...evidenceIssues.map((entry) => ({ ...entry, path: `evidence${entry.path.slice(1)}` })),
  ]);
  if (combinedIssues.length > 0) return invalidAssessment('REPAIR_CONTROL_LOOP', nowMs, combinedIssues);

  const reasons = [];
  const violations = [];
  const unknowns = [];
  if (policy.policyId !== evidence.policyId) violations.push('POLICY_ID_MISMATCH');
  if (policy.policyRevision !== evidence.policyRevision) violations.push('POLICY_REVISION_MISMATCH');
  if (policy.failureFingerprintFields.length === 0 || evidence.failureFingerprint.length === 0) violations.push('FAILURE_FINGERPRINT_MISSING');
  if (policy.commandRegistration.state !== 'CONFIRMED_IN_SYNTHETIC_FIXTURE') {
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_UNCONFIRMED_COMMAND_MAPPING');
    else unknowns.push('COMMAND_MAPPING_OWNER_CONFIRMATION_REQUIRED');
  }
  if (evidence.diagnosticConfidence < policy.minimumDiagnosticConfidence) {
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_INSUFFICIENT_DIAGNOSTIC_CONFIDENCE');
    else unknowns.push('DIAGNOSTIC_CONFIDENCE_BELOW_POLICY');
  }
  if (nowMs < evidence.campaignStartedAtMs) violations.push('EVALUATION_PRECEDES_CAMPAIGN');

  const readinessFailures = Object.entries(evidence.readinessEvidence)
    .filter(([name, result]) => !['observedAtMs', 'maxAgeMs', 'evidenceRef'].includes(name) && result !== 'PASS')
    .map(([name, result]) => `${name.replace(/([A-Z])/g, '_$1').toUpperCase()}_${result}`);
  if (evidence.readinessEvidence.observedAtMs > nowMs) {
    violations.push('REPAIR_READINESS_EVIDENCE_FROM_FUTURE');
  } else if (nowMs - evidence.readinessEvidence.observedAtMs > evidence.readinessEvidence.maxAgeMs) {
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_STALE_REPAIR_READINESS');
    else unknowns.push('REPAIR_READINESS_EVIDENCE_STALE');
  }
  if (readinessFailures.length > 0) {
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_UNPROVED_REPAIR_READINESS');
    else unknowns.push('REPAIR_READINESS_UNPROVED', ...readinessFailures);
  }

  if (evidence.conflictGraphEvidence.graphRef !== policy.repairConflictGraph.graphRef) violations.push('CONFLICT_GRAPH_REF_MISMATCH');
  if (evidence.conflictGraphEvidence.observedAtMs > nowMs) {
    violations.push('CONFLICT_GRAPH_EVIDENCE_FROM_FUTURE');
  } else if (nowMs - evidence.conflictGraphEvidence.observedAtMs > evidence.conflictGraphEvidence.maxAgeMs) {
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_STALE_CONFLICT_GRAPH');
    else unknowns.push('CONFLICT_GRAPH_EVIDENCE_STALE');
  }
  const currentCampaignObservation = evidence.conflictGraphEvidence.observedCampaigns
    .find((campaign) => campaign.campaignId === evidence.campaignId);
  if (!currentCampaignObservation
    || currentCampaignObservation.failureFingerprint !== evidence.failureFingerprint
    || currentCampaignObservation.startedAtMs !== evidence.campaignStartedAtMs
    || currentCampaignObservation.completedAtMs !== null
    || currentCampaignObservation.resourceIds.join('|') !== policy.controlledState.resourceIds.join('|')
    || currentCampaignObservation.acquisitionDisposition !== 'ACQUIRED_ATOMICALLY') {
    violations.push('CURRENT_CAMPAIGN_ATOMIC_ACQUISITION_UNPROVED');
  }
  for (const campaign of evidence.conflictGraphEvidence.observedCampaigns) {
    if (campaign.startedAtMs > nowMs || (campaign.completedAtMs !== null && campaign.completedAtMs > nowMs)) violations.push('CONFLICT_GRAPH_EVIDENCE_FROM_FUTURE');
    if (campaign.campaignId === evidence.campaignId || campaign.acquisitionDisposition === 'REJECTED_CONFLICT') continue;
    const overlapsTime = campaign.completedAtMs === null || campaign.completedAtMs >= evidence.campaignStartedAtMs;
    const overlapsResource = campaign.resourceIds.some((resourceId) => policy.controlledState.resourceIds.includes(resourceId));
    if (overlapsTime && overlapsResource) violations.push('CONFLICTING_CAMPAIGN_ACQUIRED_SAME_RESOURCE');
  }

  const assumptionFailures = Object.entries(evidence.assumptions)
    .filter(([, result]) => result !== 'PASS')
    .map(([name, result]) => `${name.toUpperCase()}_${result}`);
  if (assumptionFailures.length > 0) {
    if (evidence.nextActuationRequested) {
      violations.push('ACTUATION_REQUESTED_WITH_UNPROVED_TERMINATION_ASSUMPTIONS');
    }
    else unknowns.push('TERMINATION_ASSUMPTIONS_UNPROVED', ...assumptionFailures);
  }

  if (evidence.assumptions.leaseFence === 'PASS' && evidence.lease === null) {
    violations.push('LEASE_EVIDENCE_MISSING');
  } else if (evidence.assumptions.leaseFence === 'PASS' && evidence.lease !== null) {
    const expectedResources = policy.controlledState.resourceIds.join('|');
    const observedResources = evidence.lease.resourceIds.join('|');
    if (observedResources !== expectedResources) violations.push('LEASE_RESOURCE_SET_MISMATCH');
    if (evidence.lease.fenceEpoch !== evidence.currentFenceEpoch) violations.push('LEASE_EPOCH_NOT_CURRENT');
    if (evidence.lease.ownerId !== policy.fencingOwner) violations.push('LEASE_OWNER_NOT_POLICY_FENCING_OWNER');
    if (evidence.lease.acquiredAtMs > evidence.campaignStartedAtMs) violations.push('CAMPAIGN_STARTED_BEFORE_EXCLUSIVE_LEASE_ACQUISITION');
    if ([evidence.lease.acquiredAtMs, evidence.lease.lastRenewedAtMs].some((time) => time > nowMs)) violations.push('LEASE_EVIDENCE_FROM_FUTURE');
    if (nowMs >= evidence.lease.expiresAtMs) violations.push('LEASE_EXPIRED');
  }

  const attempts = evidence.attempts;
  const policyProducerSignal = policy.observedSignals
    .find((signal) => signal.signalId === policy.successPredicate.producerSignalId);
  const policyVerifierSignal = policy.observedSignals
    .find((signal) => signal.signalId === policy.successPredicate.verifierSignalId);
  let retryExecutionTimeMs = 0;
  let rateUnits = 0;
  let resourceUnits = 0;
  let costUnits = 0;
  const actuationAvailableAtMs = boundedSum(evidence.campaignStartedAtMs, policy.actuationDelayMs);
  const convergenceDeadlineAtMs = boundedSum(evidence.campaignStartedAtMs, policy.budgets.convergenceWindowMs);
  if (actuationAvailableAtMs === null) violations.push('ACTUATION_DELAY_ARITHMETIC_OVERFLOW');
  if (convergenceDeadlineAtMs === null) violations.push('CONVERGENCE_DEADLINE_ARITHMETIC_OVERFLOW');
  const currentProgress = progressEvidenceAt(policy, attempts, nowMs);
  for (let index = 1; index < attempts.length; index += 1) {
    const previous = attempts[index - 1].progressValue;
    const current = attempts[index].progressValue;
    if (previous !== null && current !== null
      && progressDelta(policy.progressLaw.direction, previous, current) === null) {
      violations.push('PROGRESS_ARITHMETIC_OVERFLOW');
    }
  }
  const {
    windowStartMs: noProgressWindowStartMs,
    trailingNoProgress,
    contradictoryCount,
    rollbackCount,
  } = currentProgress;

  attempts.forEach((attempt, index) => {
    const executionTimeMs = attempt.completedAtMs - attempt.startedAtMs;
    const nextRetryExecutionTimeMs = boundedSum(retryExecutionTimeMs, executionTimeMs);
    const nextRateUnits = boundedSum(rateUnits, attempt.rateUnits);
    const nextResourceUnits = boundedSum(resourceUnits, attempt.resourceUnits);
    const nextCostUnits = boundedSum(costUnits, attempt.costUnits);
    if (nextRetryExecutionTimeMs === null && retryExecutionTimeMs !== null) violations.push('RETRY_EXECUTION_TIME_ARITHMETIC_OVERFLOW');
    if (nextRateUnits === null && rateUnits !== null) violations.push('RATE_BUDGET_ARITHMETIC_OVERFLOW');
    if (nextResourceUnits === null && resourceUnits !== null) violations.push('RESOURCE_BUDGET_ARITHMETIC_OVERFLOW');
    if (nextCostUnits === null && costUnits !== null) violations.push('COST_BUDGET_ARITHMETIC_OVERFLOW');
    retryExecutionTimeMs = nextRetryExecutionTimeMs;
    rateUnits = nextRateUnits;
    resourceUnits = nextResourceUnits;
    costUnits = nextCostUnits;
    if (attempt.commandIdentity !== policy.commandIdentity) violations.push('UNREGISTERED_COMMAND_IDENTITY');
    if (attempt.commandRegistryRef !== policy.commandRegistration.registryRef) violations.push('COMMAND_REGISTRY_REF_MISMATCH');
    if (attempt.policyRevision !== policy.policyRevision) violations.push('ATTEMPT_POLICY_REVISION_MISMATCH');
    if (attempt.failureFingerprint !== evidence.failureFingerprint) violations.push('ATTEMPT_FAILURE_FINGERPRINT_MISMATCH');
    if (attempt.producerOwner !== policyProducerSignal.sourceOwner
      || attempt.producerFailureDomain !== policyProducerSignal.failureDomain) {
      violations.push('ATTEMPT_PRODUCER_EVIDENCE_BINDING_MISMATCH');
    }
    if (attempt.verifierOwner !== policyVerifierSignal.sourceOwner) {
      violations.push('ATTEMPT_VERIFIER_EVIDENCE_BINDING_MISMATCH');
    }
    if (attempt.diagnosticConfidence < policy.minimumDiagnosticConfidence) unknowns.push('ATTEMPT_DIAGNOSTIC_CONFIDENCE_BELOW_POLICY');
    if (attempt.startedAtMs > nowMs || attempt.completedAtMs > nowMs
      || attempt.producerObservedAtMs > nowMs || attempt.verifierObservedAtMs > nowMs) {
      violations.push('ATTEMPT_EVIDENCE_FROM_FUTURE');
    }
    if ((attempt.startedAtMs - evidence.campaignStartedAtMs) % policy.evaluationCadenceMs !== 0) violations.push('EVALUATION_CADENCE_NOT_OBSERVED');
    if (nowMs - attempt.startedAtMs > policy.observationHorizonMs) violations.push('ATTEMPT_OUTSIDE_OBSERVATION_HORIZON');
    if (attempt.fenceEpoch !== evidence.currentFenceEpoch && attempt.completionApplied) violations.push('STALE_COMPLETION_APPLIED_AFTER_HANDOFF');
    if (evidence.assumptions.leaseFence === 'PASS' && evidence.lease !== null && attempt.completionApplied) {
      if (attempt.controllerId !== evidence.lease.ownerId) violations.push('ATTEMPT_CONTROLLER_NOT_LEASE_OWNER');
      if (attempt.startedAtMs < evidence.lease.acquiredAtMs) violations.push('ATTEMPT_STARTED_BEFORE_LEASE_ACQUISITION');
      if (attempt.startedAtMs >= evidence.lease.expiresAtMs) violations.push('ATTEMPT_STARTED_AT_OR_AFTER_LEASE_EXPIRY');
      if (attempt.completedAtMs >= evidence.lease.expiresAtMs) violations.push('COMPLETION_APPLIED_AT_OR_AFTER_LEASE_EXPIRY');
      if (attempt.resourceIds.join('|') !== evidence.lease.resourceIds.join('|')) violations.push('ATTEMPT_RESOURCE_SET_NOT_LEASED');
    }
    if (actuationAvailableAtMs !== null && attempt.startedAtMs < actuationAvailableAtMs) violations.push('ACTUATION_BEFORE_DELAY');
    if (convergenceDeadlineAtMs !== null && attempt.startedAtMs >= convergenceDeadlineAtMs) violations.push('ACTUATION_AT_OR_AFTER_CONVERGENCE_DEADLINE');
    if (convergenceDeadlineAtMs !== null && attempt.nextRetryAtMs !== null && attempt.nextRetryAtMs >= convergenceDeadlineAtMs) violations.push('RETRY_AT_OR_AFTER_CONVERGENCE_DEADLINE');

    const gate = attempt.actuationGateEvidence;
    if (gate.readinessEvidenceRef !== evidence.readinessEvidence.evidenceRef
      || gate.readinessObservedAtMs !== evidence.readinessEvidence.observedAtMs
      || gate.readinessMaxAgeMs !== evidence.readinessEvidence.maxAgeMs) {
      violations.push('ATTEMPT_READINESS_EVIDENCE_BINDING_MISMATCH');
    }
    if (gate.readinessObservedAtMs > attempt.startedAtMs) violations.push('ATTEMPT_READINESS_EVIDENCE_FROM_FUTURE');
    else if (attempt.startedAtMs - gate.readinessObservedAtMs > gate.readinessMaxAgeMs) violations.push('ATTEMPT_READINESS_EVIDENCE_STALE');
    if (gate.readinessObservedAtMs < evidence.campaignStartedAtMs) violations.push('ATTEMPT_READINESS_EVIDENCE_PRECEDES_CAMPAIGN');
    if (gate.conflictGraphObservedAtMs > attempt.startedAtMs) violations.push('ATTEMPT_CONFLICT_GRAPH_EVIDENCE_FROM_FUTURE');
    else if (attempt.startedAtMs - gate.conflictGraphObservedAtMs > gate.conflictGraphMaxAgeMs) violations.push('ATTEMPT_CONFLICT_GRAPH_EVIDENCE_STALE');
    if (gate.conflictGraphObservedAtMs < evidence.campaignStartedAtMs) violations.push('ATTEMPT_CONFLICT_GRAPH_EVIDENCE_PRECEDES_CAMPAIGN');
    if (gate.conflictGraphEvidenceRef !== evidence.conflictGraphEvidence.evidenceRef
      || gate.conflictGraphObservedAtMs !== evidence.conflictGraphEvidence.observedAtMs
      || gate.conflictGraphMaxAgeMs !== evidence.conflictGraphEvidence.maxAgeMs) {
      violations.push('ATTEMPT_CONFLICT_GRAPH_EVIDENCE_BINDING_MISMATCH');
    }

    const circuit = attempt.circuitEvidence;
    if (circuit.state !== attempt.circuitState) violations.push('ATTEMPT_CIRCUIT_STATE_EVIDENCE_MISMATCH');
    if (circuit.observedAtMs !== null) {
      if (circuit.observedAtMs > nowMs) violations.push('REPAIR_CIRCUIT_EVIDENCE_FROM_FUTURE');
      if (circuit.observedAtMs < attempt.completedAtMs) violations.push('REPAIR_CIRCUIT_EVIDENCE_PRECEDES_COMPLETION');
    }
    if (index > 0) {
      const priorCircuit = attempts[index - 1].circuitEvidence;
      if (circuit.state !== 'UNKNOWN' && circuit.priorEvidenceRef !== priorCircuit.evidenceRef) {
        violations.push('REPAIR_CIRCUIT_PRIOR_EVIDENCE_CHAIN_INVALID');
      }
      if (circuit.priorEvidenceRef === priorCircuit.evidenceRef) {
        if (circuit.canonicalOwner !== priorCircuit.canonicalOwner) {
          violations.push('REPAIR_CIRCUIT_OWNER_CHAIN_MISMATCH');
        }
        if (circuit.ownerFailureDomain !== priorCircuit.ownerFailureDomain) {
          violations.push('REPAIR_CIRCUIT_OWNER_FAILURE_DOMAIN_CHAIN_MISMATCH');
        }
        if (['openedAtMs', 'halfOpenAtMs', 'resetEligibleAtMs', 'closedAtMs']
          .some((field) => priorCircuit[field] !== null && circuit[field] !== priorCircuit[field])) {
          violations.push('REPAIR_CIRCUIT_TRANSITION_HISTORY_CHAIN_INVALID');
        }
      }
      if (priorCircuit.state === 'UNKNOWN') violations.push('NEXT_ATTEMPT_WITH_UNKNOWN_CIRCUIT');
      else {
        if (priorCircuit.observedAtMs > attempt.startedAtMs) violations.push('PRIOR_REPAIR_CIRCUIT_EVIDENCE_FROM_FUTURE');
        else if (!freshAt(priorCircuit.observedAtMs, priorCircuit.maxAgeMs, attempt.startedAtMs)) violations.push('PRIOR_REPAIR_CIRCUIT_EVIDENCE_STALE');
        if (priorCircuit.state === 'OPEN') violations.push('NEXT_ATTEMPT_WHILE_CIRCUIT_OPEN');
      }
    }
    if (circuit.state === 'CLOSED') {
      const usesBaseline = circuit.baselineNeverOpenedEvidenceRef !== null;
      const closeOwner = usesBaseline ? circuit.baselineEvidenceOwner : circuit.independentCloseOwner;
      const closeFailureDomain = usesBaseline
        ? circuit.baselineEvidenceFailureDomain
        : circuit.independentCloseFailureDomain;
      if (closeOwner === attempt.producerOwner) {
        violations.push('COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_OWNER_FORBIDDEN');
      }
      if (closeFailureDomain === attempt.producerFailureDomain) {
        violations.push('COMMON_MODE_REPAIR_CIRCUIT_CLOSE_PRODUCER_FAILURE_DOMAIN_FORBIDDEN');
      }
    }
    if (attempt.actionDirection !== 'HOLD'
      && attempt.controlErrorBefore >= policy.deadband.lowerInclusive
      && attempt.controlErrorBefore <= policy.deadband.upperInclusive) {
      violations.push('ACTUATION_INSIDE_DEADBAND');
    }
    if (attempt.stepMagnitude > policy.maximumStep.value) violations.push('MAXIMUM_STEP_EXCEEDED');
    const slewElapsedMs = index === 0
      ? attempt.startedAtMs - evidence.campaignStartedAtMs
      : attempt.startedAtMs - attempts[index - 1].completedAtMs;
    if (index > 0) {
      const priorObservationBoundaryMs = Math.max(
        attempts[index - 1].completedAtMs,
        attempts[index - 1].producerObservedAtMs,
        attempts[index - 1].verifierObservedAtMs,
      );
      const decisionElapsedMs = attempt.startedAtMs - priorObservationBoundaryMs;
      if (decisionElapsedMs < policy.cooldownMs) violations.push('COOLDOWN_NOT_OBSERVED');
      const backoffIndex = Math.min(index - 1, policy.budgets.backoffScheduleMs.length - 1);
      if (decisionElapsedMs < policy.budgets.backoffScheduleMs[backoffIndex]) violations.push('BACKOFF_SCHEDULE_NOT_OBSERVED');
    }
    if (attempt.nextRetryAtMs !== null) {
      const observationBoundaryMs = Math.max(attempt.completedAtMs, attempt.producerObservedAtMs, attempt.verifierObservedAtMs);
      const scheduledDelayMs = attempt.nextRetryAtMs - observationBoundaryMs;
      const backoffIndex = Math.min(index, policy.budgets.backoffScheduleMs.length - 1);
      if (scheduledDelayMs < policy.cooldownMs) violations.push('SCHEDULED_RETRY_VIOLATES_COOLDOWN');
      if (scheduledDelayMs < policy.budgets.backoffScheduleMs[backoffIndex]) violations.push('SCHEDULED_RETRY_VIOLATES_BACKOFF');
    }
    if (slewElapsedMs <= 0 && attempt.stepMagnitude > 0) violations.push('MAXIMUM_SLEW_EXCEEDED');
    else if (slewElapsedMs > 0 && attempt.stepMagnitude / slewElapsedMs > policy.maximumSlew.valuePerMs) violations.push('MAXIMUM_SLEW_EXCEEDED');
    if (attempt.producerEvidenceRef === attempt.verifierEvidenceRef
      || attempt.producerOwner === attempt.verifierOwner) violations.push('COMMON_MODE_VERIFIER_EVIDENCE');
    if (attempt.rollback === 'FAILED') reasons.push('ROLLBACK_FAILED');
    if (attempt.compensation === 'FAILED') reasons.push('COMPENSATION_FAILED');
    if (attempt.compensation === 'UNKNOWN') unknowns.push('COMPENSATION_RESULT_UNKNOWN');
    if (index < attempts.length - 1 && (attempt.rollback === 'FAILED' || ['FAILED', 'UNKNOWN'].includes(attempt.compensation))) {
      violations.push('ATTEMPT_AFTER_ROLLBACK_OR_COMPENSATION_FAILURE');
    }
  });

  for (let index = 0; index < attempts.length - 1; index += 1) {
    if (attempts[index].nextRetryAtMs !== attempts[index + 1].startedAtMs) violations.push('NEXT_RETRY_DOES_NOT_MATCH_NEXT_ATTEMPT');
  }
  const retryTimeMs = attempts.length === 0
    ? 0
    : Math.max(
      attempts.at(-1).completedAtMs,
      attempts.at(-1).producerObservedAtMs,
      attempts.at(-1).verifierObservedAtMs,
    ) - attempts[0].startedAtMs;

  if (currentProgress.missingProgress) unknowns.push('PROGRESS_METRIC_UNAVAILABLE');
  if (unknowns.includes('PROGRESS_METRIC_UNAVAILABLE') && evidence.nextActuationRequested) {
    violations.push('ACTUATION_REQUESTED_WITH_MISSING_PROGRESS_EVIDENCE');
  }

  const recentAttempts = attempts.filter((attempt) => nowMs - attempt.verifierObservedAtMs <= policy.oscillationLaw.windowMs);
  const oscillation = oscillationEvidence(policy, recentAttempts);
  const { alternations, netProgress, detected: oscillationDetected, conflictingControllersPresent } = oscillation;
  const historicalTriggerCodes = [];
  let firstHistoricalTriggerAtMs = null;
  let historicalMissingProgress = false;
  for (let index = 0; index < attempts.length; index += 1) {
    const prefix = attempts.slice(0, index + 1);
    const anchorAtMs = attempts[index].verifierObservedAtMs;
    const progress = progressEvidenceAt(policy, prefix, anchorAtMs);
    const oscillationWindow = prefix.filter((attempt) => attempt.verifierObservedAtMs >= anchorAtMs - policy.oscillationLaw.windowMs);
    const priorOscillation = oscillationEvidence(policy, oscillationWindow);
    const snapshotCodes = [];
    if (progress.trailingNoProgress >= policy.progressLaw.noProgressAttemptThreshold) snapshotCodes.push('NO_PROGRESS_THRESHOLD_REACHED');
    if (progress.contradictoryCount >= policy.progressLaw.contradictoryAttemptThreshold) snapshotCodes.push('CONTRADICTORY_PROGRESS_THRESHOLD_REACHED');
    if (progress.rollbackCount >= policy.progressLaw.repeatedRollbackThreshold) snapshotCodes.push('REPEATED_ROLLBACK_THRESHOLD_REACHED');
    if (priorOscillation.detected) snapshotCodes.push('OSCILLATION_SIGNATURE_DETECTED');
    if (priorOscillation.conflictingControllersPresent) snapshotCodes.push('CONFLICTING_CONTROLLERS_PRESENT');
    if (progress.missingProgress) historicalMissingProgress = true;
    if (progress.missingProgress && index < attempts.length - 1) violations.push('ATTEMPT_AFTER_MISSING_PROGRESS_EVIDENCE');
    if (snapshotCodes.length > 0) {
      historicalTriggerCodes.push(...snapshotCodes);
      if (firstHistoricalTriggerAtMs === null) firstHistoricalTriggerAtMs = anchorAtMs;
      if (index < attempts.length - 1) {
        violations.push('ATTEMPT_AFTER_HISTORICAL_TERMINATION_TRIGGER');
        if (snapshotCodes.some((code) => ['NO_PROGRESS_THRESHOLD_REACHED', 'CONTRADICTORY_PROGRESS_THRESHOLD_REACHED'].includes(code))) violations.push('ATTEMPT_AFTER_PROGRESS_TERMINATION_TRIGGER');
        if (snapshotCodes.includes('REPEATED_ROLLBACK_THRESHOLD_REACHED')) violations.push('ATTEMPT_AFTER_REPEATED_ROLLBACK_TRIGGER');
        if (snapshotCodes.some((code) => ['OSCILLATION_SIGNATURE_DETECTED', 'CONFLICTING_CONTROLLERS_PRESENT'].includes(code))) violations.push('ATTEMPT_AFTER_OSCILLATION_OR_CONTROLLER_CONFLICT_TRIGGER');
      }
    }
  }
  if (historicalMissingProgress && !unknowns.includes('PROGRESS_METRIC_UNAVAILABLE')) unknowns.push('PROGRESS_METRIC_UNAVAILABLE');
  if (historicalMissingProgress && evidence.nextActuationRequested
    && !violations.includes('ACTUATION_REQUESTED_WITH_MISSING_PROGRESS_EVIDENCE')) {
    violations.push('ACTUATION_REQUESTED_WITH_MISSING_PROGRESS_EVIDENCE');
  }
  const supportedFingerprintFields = ['commandIdentity', 'resourceIds', 'actionDirection'];
  if (policy.oscillationLaw.actionFingerprintFields.length !== supportedFingerprintFields.length
    || supportedFingerprintFields.some((field) => !policy.oscillationLaw.actionFingerprintFields.includes(field))) {
    violations.push('ACTION_FINGERPRINT_FIELDS_UNSUPPORTED');
  }
  const triggerCodes = [];
  triggerCodes.push(...historicalTriggerCodes);
  if (attempts.some((attempt) => attempt.rollback === 'FAILED')) triggerCodes.push('ROLLBACK_FAILED');
  if (attempts.some((attempt) => attempt.compensation === 'FAILED')) triggerCodes.push('COMPENSATION_FAILED');
  if (oscillationDetected) triggerCodes.push('OSCILLATION_SIGNATURE_DETECTED');
  if (conflictingControllersPresent) triggerCodes.push('CONFLICTING_CONTROLLERS_PRESENT');

  if (evidence.restartEvidence.restored) {
    const firstAfterRestart = attempts.findIndex((attempt) => attempt.afterRestart);
    const restartBoundary = firstAfterRestart < 0 ? attempts.length : firstAfterRestart;
    const attemptsBeforeRestart = attempts.slice(0, restartBoundary);
    const retryWallTimeBeforeRestart = attemptsBeforeRestart.length === 0
      ? 0
      : Math.max(
        attemptsBeforeRestart.at(-1).completedAtMs,
        attemptsBeforeRestart.at(-1).producerObservedAtMs,
        attemptsBeforeRestart.at(-1).verifierObservedAtMs,
      ) - attemptsBeforeRestart[0].startedAtMs;
    const boundedAttemptTotal = (field, overflowCode) => {
      let total = 0;
      for (const attempt of attemptsBeforeRestart) {
        const next = boundedSum(total, attempt[field]);
        if (next === null) {
          violations.push(overflowCode);
          return null;
        }
        total = next;
      }
      return total;
    };
    const rateBeforeRestart = boundedAttemptTotal('rateUnits', 'RESTART_RATE_ARITHMETIC_OVERFLOW');
    const resourceBeforeRestart = boundedAttemptTotal('resourceUnits', 'RESTART_RESOURCE_ARITHMETIC_OVERFLOW');
    const costBeforeRestart = boundedAttemptTotal('costUnits', 'RESTART_COST_ARITHMETIC_OVERFLOW');
    const priorAttempt = attemptsBeforeRestart.at(-1) ?? null;
    const restartCooldownUntilMs = priorAttempt === null
      ? evidence.campaignStartedAtMs
      : boundedSum(
        Math.max(priorAttempt.completedAtMs, priorAttempt.producerObservedAtMs, priorAttempt.verifierObservedAtMs),
        policy.cooldownMs,
      );
    if (priorAttempt !== null && restartCooldownUntilMs === null) violations.push('RESTART_COOLDOWN_ARITHMETIC_OVERFLOW');
    const expectedState = {
      localAttempts: attemptsBeforeRestart.length,
      globalAttempts: priorAttempt?.globalAttempt ?? 0,
      remainingRetryTimeMs: Math.max(0, policy.budgets.maximumRetryTimeMs - retryWallTimeBeforeRestart),
      remainingRateUnits: rateBeforeRestart === null ? null : Math.max(0, policy.budgets.rateUnits - rateBeforeRestart),
      remainingResourceUnits: resourceBeforeRestart === null ? null : Math.max(0, policy.budgets.resourceUnits - resourceBeforeRestart),
      remainingCostUnits: costBeforeRestart === null ? null : Math.max(0, policy.budgets.costUnits - costBeforeRestart),
      cooldownUntilMs: restartCooldownUntilMs,
      convergenceDeadlineAtMs,
      leaseId: evidence.lease?.leaseId ?? 'LEASE_UNAVAILABLE',
      fenceEpoch: evidence.currentFenceEpoch,
      lateResultLaw: policy.lateResultLaw,
    };
    const restartStateMatches = (candidate, expected) => candidate !== null
      && Object.keys(expected).every((field) => candidate[field] === expected[field]);
    if (!evidence.restartEvidence.preservedCampaignId
      || evidence.restartEvidence.restoredCampaignId !== evidence.campaignId
      || evidence.restartEvidence.attemptCountBeforeRestart !== evidence.restartEvidence.restoredAttemptCount
      || evidence.restartEvidence.remainingCostUnitsBeforeRestart !== evidence.restartEvidence.remainingCostUnitsAfterRestart
      || evidence.restartEvidence.stateDigestBeforeRestart !== evidence.restartEvidence.stateDigestAfterRestart
      || !restartStateMatches(evidence.restartEvidence.stateBeforeRestart, evidence.restartEvidence.stateAfterRestart)
      || !restartStateMatches(evidence.restartEvidence.stateBeforeRestart, expectedState)
      || evidence.restartEvidence.attemptCountBeforeRestart !== expectedState.localAttempts
      || evidence.restartEvidence.remainingCostUnitsBeforeRestart !== expectedState.remainingCostUnits) {
      violations.push('RESTART_RESET_CAMPAIGN_OR_BUDGET');
    }
    if (restartBoundary !== evidence.restartEvidence.restoredAttemptCount
      || attempts.slice(restartBoundary).some((attempt) => !attempt.afterRestart)) {
      violations.push('RESTART_ATTEMPT_BOUNDARY_INVALID');
    }
  } else if (attempts.some((attempt) => attempt.afterRestart)) {
    violations.push('AFTER_RESTART_ATTEMPT_WITHOUT_RESTORE_EVIDENCE');
  }

  const latest = attempts.at(-1) ?? null;
  const latestCircuit = latest?.circuitEvidence ?? null;
  const latestCircuitFresh = latestCircuit?.observedAtMs === null || latestCircuit === null
    ? false
    : freshAt(latestCircuit.observedAtMs, latestCircuit.maxAgeMs, nowMs);
  const latestIndependentCloseProven = independentCircuitCloseProven(latestCircuit, latest);
  const terminalContainmentDeclared = evidence.containment.lifecycle !== null
    || evidence.containment.durableUnresolvedEvidenceRef !== null;
  const repairFailureBlocksPromotion = attempts.some((attempt) => attempt.rollback === 'FAILED'
    || ['FAILED', 'UNKNOWN'].includes(attempt.compensation));
  if (latestCircuit?.state === 'OPEN') triggerCodes.push('REPAIR_CIRCUIT_OPEN');
  if (latestCircuit !== null && latestCircuit.state !== 'UNKNOWN' && latestCircuit.observedAtMs > nowMs) {
    violations.push('REPAIR_CIRCUIT_EVIDENCE_FROM_FUTURE');
  } else if (latestCircuit !== null && latestCircuit.state !== 'UNKNOWN' && !latestCircuitFresh) {
    unknowns.push('REPAIR_CIRCUIT_EVIDENCE_STALE');
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_STALE_REPAIR_CIRCUIT');
  }
  if (['HALF_OPEN', 'UNKNOWN'].includes(latestCircuit?.state)) {
    unknowns.push(`REPAIR_CIRCUIT_${latestCircuit.state}`);
    if (evidence.nextActuationRequested) violations.push('ACTUATION_REQUESTED_WITH_UNPROVED_CIRCUIT_STATE');
  }
  const postcondition = evidence.postconditionWindow;
  const quietPeriodObservedMs = postcondition.firstIndependentPassAtMs === null
    || postcondition.lastIndependentPassAtMs === null
    ? null
    : postcondition.lastIndependentPassAtMs - postcondition.firstIndependentPassAtMs;
  if (postcondition.firstIndependentPassAtMs !== null
    && (postcondition.firstIndependentPassAtMs > nowMs || postcondition.lastIndependentPassAtMs > nowMs)) {
    violations.push('POSTCONDITION_EVIDENCE_FROM_FUTURE');
  }
  const postconditionChronologyValid = latest !== null
    && postcondition.firstIndependentPassAtMs !== null
    && postcondition.firstIndependentPassAtMs >= Math.max(
      latest.completedAtMs,
      latest.producerObservedAtMs,
      latest.verifierObservedAtMs,
    );
  if (latest !== null && postcondition.firstIndependentPassAtMs !== null
    && !postconditionChronologyValid) {
    violations.push('POSTCONDITION_WINDOW_PRECEDES_LATEST_REPAIR_EVIDENCE');
  }
  const policyProducer = policyProducerSignal;
  const policyVerifier = policyVerifierSignal;
  const evidenceIndependent = latest !== null
    && latest.verifierIndependence === 'PASS'
    && postcondition.commonModeIndependence === 'PASS'
    && latest.producerOwner === policyProducer.sourceOwner
    && latest.verifierOwner === policyVerifier.sourceOwner
    && latest.producerOwner !== latest.verifierOwner
    && latest.producerEvidenceRef !== latest.verifierEvidenceRef
    && postcondition.producerOwner === latest.producerOwner
    && postcondition.verifierOwner === latest.verifierOwner
    && postcondition.producerEvidenceRef === latest.producerEvidenceRef
    && postcondition.verifierEvidenceRef === latest.verifierEvidenceRef;
  const hysteresisSatisfied = latest !== null
    && crossesHysteresisExit(policy, latest.progressValue)
    && quietPeriodObservedMs !== null
    && quietPeriodObservedMs >= policy.hysteresis.minimumDwellMs;
  const successWithinConvergenceWindow = postcondition.lastIndependentPassAtMs !== null
    && postcondition.lastIndependentPassAtMs <= evidence.campaignStartedAtMs + policy.budgets.convergenceWindowMs;
  const budgetArithmeticKnown = [retryExecutionTimeMs, rateUnits, resourceUnits, costUnits]
    .every((value) => value !== null);
  const withinHardBudgets = budgetArithmeticKnown
    && attempts.length <= policy.budgets.maximumLocalAttempts
    && attempts.every((attempt) => attempt.globalAttempt <= policy.budgets.maximumGlobalAttempts)
    && retryTimeMs <= policy.budgets.maximumRetryTimeMs
    && rateUnits <= policy.budgets.rateUnits
    && resourceUnits <= policy.budgets.resourceUnits
    && costUnits <= policy.budgets.costUnits
    && evidence.observedConcurrentActuations <= policy.budgets.maximumConcurrency;
  const independentPostconditionSatisfied = latest !== null
    && latest.producerPredicate === 'PASS'
    && latest.independentVerifier === 'PASS'
    && evidenceIndependent
    && postconditionChronologyValid
    && hysteresisSatisfied
    && quietPeriodObservedMs >= policy.successPredicate.quietPeriodMs
    && successWithinConvergenceWindow
    && latestCircuit.state === 'CLOSED'
    && latestCircuitFresh
    && latestIndependentCloseProven
    && latest.result === 'SUCCEEDED'
    && latest.completionApplied === true
    && latest.fenceEpoch === evidence.currentFenceEpoch
    && evidence.lease !== null
    && latest.controllerId === evidence.lease.ownerId
    && latest.resourceIds.join('|') === evidence.lease.resourceIds.join('|')
    && latest.startedAtMs >= evidence.lease.acquiredAtMs
    && latest.completedAtMs < evidence.lease.expiresAtMs
    && !terminalContainmentDeclared
    && !repairFailureBlocksPromotion
    && withinHardBudgets
    && triggerCodes.length === 0
    && violations.length === 0
    && unknowns.length === 0;
  if (independentPostconditionSatisfied
    && (evidence.nextActuationRequested || latest.nextRetryAtMs !== null)) {
    violations.push('FURTHER_ACTUATION_AFTER_INDEPENDENT_SUCCESS');
  }
  const independentSuccess = independentPostconditionSatisfied
    && !evidence.nextActuationRequested
    && latest.nextRetryAtMs === null;

  const budgetOverrunCodes = [];
  if (attempts.length > policy.budgets.maximumLocalAttempts) budgetOverrunCodes.push('LOCAL_ATTEMPT_BUDGET_OVERRUN');
  if (attempts.some((attempt) => attempt.globalAttempt > policy.budgets.maximumGlobalAttempts)) budgetOverrunCodes.push('GLOBAL_ATTEMPT_BUDGET_OVERRUN');
  if (retryTimeMs > policy.budgets.maximumRetryTimeMs) budgetOverrunCodes.push('RETRY_TIME_BUDGET_OVERRUN');
  if (rateUnits > policy.budgets.rateUnits) budgetOverrunCodes.push('RATE_BUDGET_OVERRUN');
  if (resourceUnits > policy.budgets.resourceUnits) budgetOverrunCodes.push('RESOURCE_BUDGET_OVERRUN');
  if (costUnits > policy.budgets.costUnits) budgetOverrunCodes.push('COST_BUDGET_OVERRUN');
  if (evidence.observedConcurrentActuations > policy.budgets.maximumConcurrency) budgetOverrunCodes.push('CONCURRENCY_BUDGET_OVERRUN');
  violations.push(...budgetOverrunCodes);
  if (!independentSuccess) {
    if (attempts.length >= policy.budgets.maximumLocalAttempts) triggerCodes.push('LOCAL_ATTEMPT_BUDGET_EXHAUSTED');
    if (attempts.some((attempt) => attempt.globalAttempt >= policy.budgets.maximumGlobalAttempts)) triggerCodes.push('GLOBAL_ATTEMPT_BUDGET_EXHAUSTED');
    if (retryTimeMs >= policy.budgets.maximumRetryTimeMs) triggerCodes.push('RETRY_TIME_BUDGET_EXHAUSTED');
    if (rateUnits >= policy.budgets.rateUnits) triggerCodes.push('RATE_BUDGET_EXHAUSTED');
    if (resourceUnits >= policy.budgets.resourceUnits) triggerCodes.push('RESOURCE_BUDGET_EXHAUSTED');
    if (costUnits >= policy.budgets.costUnits) triggerCodes.push('COST_BUDGET_EXHAUSTED');
    if (nowMs - evidence.campaignStartedAtMs >= policy.budgets.convergenceWindowMs) triggerCodes.push('CONVERGENCE_DEADLINE_REACHED');
  }
  if (evidence.promotionClaimed && !independentSuccess) violations.push('PROMOTION_CLAIM_WITHOUT_INDEPENDENT_QUIET_POSTCONDITION');
  if (latest !== null && latest.producerPredicate === 'PASS' && !independentSuccess) {
    reasons.push('PRODUCER_SELF_REPORT_CANNOT_PROVE_RECOVERY');
    if (!evidence.promotionClaimed && !terminalContainmentDeclared && !repairFailureBlocksPromotion) unknowns.push('INDEPENDENT_POSTCONDITION_UNPROVED');
  }

  const terminationTriggered = triggerCodes.length > 0;
  const contained = containmentSufficient(
    evidence.containment,
    policy.quarantineEscalation.durableUnresolvedEvidenceRequired,
    policy.quarantineEscalation.escalationOwner,
  );
  if (terminalContainmentDeclared) {
    reasons.push('DURABLE_TERMINAL_CONTAINMENT_ACTIVE');
    if (!contained) violations.push('TERMINAL_CONTAINMENT_EVIDENCE_INVALID');
  }
  if (terminationTriggered) {
    reasons.push(...triggerCodes);
    if (assumptionFailures.length === 0) {
      if (!contained) violations.push('TERMINATION_TRIGGER_WITHOUT_QUARANTINE_ESCALATION_OR_DURABLE_UNRESOLVED_EVIDENCE');
      else reasons.push('AUTOMATIC_ACTUATION_TERMINATED_WITH_DURABLE_CONTAINMENT_EVIDENCE');
    }
  }

  if ((terminationTriggered || terminalContainmentDeclared)
    && (evidence.containment.furtherAutomaticActuation || evidence.nextActuationRequested)) {
    violations.push('FURTHER_ACTUATION_AFTER_TERMINATION_TRIGGER');
  }
  if ((terminationTriggered || terminalContainmentDeclared) && latest !== null && latest.nextRetryAtMs !== null) violations.push('RETRY_SCHEDULED_AFTER_TERMINATION_TRIGGER');
  if (!terminationTriggered && !independentSuccess && !contained
    && assumptionFailures.length === 0 && readinessFailures.length === 0) {
    unknowns.push('TERMINATION_NOT_YET_PROVEN');
  }

  let assuranceResult;
  if (violations.length > 0) assuranceResult = 'FAIL';
  else if (unknowns.length > 0) assuranceResult = 'UNKNOWN';
  else assuranceResult = 'PASS';

  const terminationWithinDeclaredBudget = assumptionFailures.length > 0
    ? null
    : terminationTriggered || terminalContainmentDeclared
      ? contained && budgetOverrunCodes.length === 0 && budgetArithmeticKnown
      : independentSuccess
        ? true
        : null;
  return deepFreeze({
    schemaVersion: STABILITY_SCHEMA_VERSION,
    assessmentKind: 'REPAIR_CONTROL_LOOP',
    campaignId: evidence.campaignId,
    policyId: policy.policyId,
    canonicalOwner: policy.canonicalOwner,
    evaluatedAtMs: nowMs,
    assuranceResult,
    reasonCodes: sortedUnique([...reasons, ...violations, ...unknowns]),
    violationCodes: sortedUnique(violations),
    unknownCodes: sortedUnique(unknowns),
    triggerCodes: sortedUnique(triggerCodes),
    progressEvidence: deepFreeze({
      trailingNoProgress,
      contradictoryCount,
      rollbackCount,
      alternations,
      netProgress,
      noProgressWindowStartMs,
      missingProgress: historicalMissingProgress,
      conflictingControllersPresent,
      historicalTerminationTriggerDetected: historicalTriggerCodes.length > 0,
      firstHistoricalTriggerAtMs,
    }),
    budgetEvidence: deepFreeze({
      attempts: attempts.length,
      retryTimeMs,
      retryExecutionTimeMs,
      rateUnits,
      resourceUnits,
      costUnits,
      observedConcurrentActuations: evidence.observedConcurrentActuations,
    }),
    actuationGateBinding: deepFreeze({
      readinessEvidenceRef: evidence.readinessEvidence.evidenceRef,
      readinessObservedAtMs: evidence.readinessEvidence.observedAtMs,
      readinessMaxAgeMs: evidence.readinessEvidence.maxAgeMs,
      conflictGraphEvidenceRef: evidence.conflictGraphEvidence.evidenceRef,
      conflictGraphObservedAtMs: evidence.conflictGraphEvidence.observedAtMs,
      conflictGraphMaxAgeMs: evidence.conflictGraphEvidence.maxAgeMs,
    }),
    attemptEvidence: deepFreeze(attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      startedAtMs: attempt.startedAtMs,
      completedAtMs: attempt.completedAtMs,
      producerOwner: attempt.producerOwner,
      producerFailureDomain: attempt.producerFailureDomain,
      actuationGateEvidence: { ...attempt.actuationGateEvidence },
      circuitEvidence: { ...attempt.circuitEvidence },
    }))),
    circuitPosture: deepFreeze({
      state: latestCircuit?.state ?? 'UNKNOWN',
      evidenceFresh: latestCircuit === null ? null : latestCircuitFresh,
      independentCloseProven: latestCircuit === null ? null : latestIndependentCloseProven,
    }),
    containmentEvidenceSufficient: contained,
    containmentLifecycle: evidence.containment.lifecycle,
    durableUnresolvedEvidenceRef: evidence.containment.durableUnresolvedEvidenceRef,
    escalationOwner: evidence.containment.escalationOwner,
    terminationWithinDeclaredBudget,
    terminationClaim: assumptionFailures.length > 0
      ? 'UNKNOWN_UNBOUNDED'
      : terminationWithinDeclaredBudget === true
        ? 'BOUNDED_BY_DECLARED_EVIDENCE'
        : 'NOT_YET_PROVEN_WITHIN_DECLARED_BUDGET',
    promotionEvidence: independentSuccess
      ? 'INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD_PROVEN_FOR_OWNER_REVIEW'
      : 'NOT_PROVEN',
    requiredCanonicalResponse: terminationTriggered || terminalContainmentDeclared
      ? 'QUARANTINE_OR_ESCALATE_OR_DURABLY_RECORD_UNRESOLVED'
      : 'NONE',
    automaticActionIssued: false,
    contractIssues: [],
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  });
}

export function evaluateResourceEvidence(bundle, nowMs) {
  if (!validNow(nowMs)) throw new TypeError('nowMs must be a non-negative safe integer from an injected clock');
  const issues = validateResourceEvidenceBundle(bundle);
  if (issues.length > 0) return invalidAssessment('RESOURCE_COST_CIRCUIT_EVIDENCE', nowMs, issues);

  const rows = bundle.rows.map((row) => {
    const reasons = [];
    const results = [];
    if (nowMs < row.observedAtMs) {
      results.push('FAIL');
      reasons.push('MEASUREMENT_FROM_FUTURE');
    } else if (nowMs - row.observedAtMs > row.maxAgeMs) {
      results.push('UNKNOWN');
      reasons.push('MEASUREMENT_STALE');
    }
    const burnBudgetUnknown = row.burn.value === null
      || row.budget.limit === null
      || row.budget.remaining === null;
    const forecastUnknown = row.forecast.value === null
      || row.forecast.horizonMs === null
      || row.budget.remaining === null;
    if (burnBudgetUnknown || forecastUnknown) {
      results.push('UNKNOWN');
      reasons.push('BURN_BUDGET_OR_FORECAST_UNKNOWN');
    }
    if (!burnBudgetUnknown) {
      if (row.burn.value >= row.budget.limit || row.budget.remaining === 0) {
        results.push('FAIL');
        reasons.push('RESOURCE_BUDGET_EXHAUSTED');
      } else results.push('PASS');
    }
    if (!forecastUnknown) {
      if (row.forecast.value >= row.budget.remaining) {
        results.push('FAIL');
        reasons.push('PROJECTED_RESOURCE_EXHAUSTION');
      } else results.push('PASS');
    }
    if (row.topConsumers.length === 0 || row.topConsumers.some((consumer) => consumer.amount === null)) {
      results.push('UNKNOWN');
      reasons.push('TOP_CONSUMERS_UNPROVED');
    }
    const protectionResults = Object.values(row.protections);
    results.push(precedence(protectionResults));
    if (protectionResults.includes('FAIL')) reasons.push('PROTECTED_TRUTH_OR_RISK_REDUCTION_VIOLATED');
    if (protectionResults.includes('UNKNOWN')) reasons.push('PROTECTED_TRUTH_OR_RISK_REDUCTION_UNKNOWN');
    if (row.throttling.observed === 'UNKNOWN') {
      results.push('UNKNOWN');
      reasons.push('THROTTLING_EVIDENCE_UNKNOWN');
    } else if (row.throttling.observedAtMs > nowMs) {
      results.push('FAIL');
      reasons.push('THROTTLING_EVIDENCE_FROM_FUTURE');
    } else if (nowMs - row.throttling.observedAtMs > row.throttling.maxAgeMs) {
      results.push('UNKNOWN');
      reasons.push('THROTTLING_EVIDENCE_STALE');
    }
    if (row.circuit.state === 'UNKNOWN') {
      results.push('UNKNOWN');
      reasons.push('CIRCUIT_STATE_UNKNOWN');
    } else {
      const futureCircuitTransition = [
        row.circuit.observedAtMs,
        row.circuit.openedAtMs,
        row.circuit.halfOpenAtMs,
        row.circuit.resetEligibleAtMs,
        row.circuit.closedAtMs,
      ].some((time) => time !== null && time > nowMs);
      if (futureCircuitTransition) {
        results.push('FAIL');
        reasons.push('CIRCUIT_EVIDENCE_FROM_FUTURE');
      } else if (nowMs - row.circuit.observedAtMs > row.circuit.maxAgeMs) {
        results.push('UNKNOWN');
        reasons.push('CIRCUIT_EVIDENCE_STALE');
      }
      if (row.circuit.state === 'OPEN') {
        results.push('FAIL');
        reasons.push('RESOURCE_CIRCUIT_OPEN');
      } else if (row.circuit.state === 'HALF_OPEN') {
        results.push('UNKNOWN');
        reasons.push('RESOURCE_CIRCUIT_HALF_OPEN');
      }
    }
    if (row.canonicalResponse.kind === 'UNKNOWN') {
      results.push('UNKNOWN');
      reasons.push('CANONICAL_RESPONSE_UNKNOWN');
    }
    const rowResultBeforeResponseFallback = precedence(results);
    let canonicalResponse = { ...row.canonicalResponse };
    if (rowResultBeforeResponseFallback !== 'PASS' && row.canonicalResponse.kind === 'NONE') {
      results.push('UNKNOWN');
      reasons.push('CANONICAL_RESPONSE_UNAVAILABLE_FOR_ATTENTION');
      canonicalResponse = {
        kind: 'UNKNOWN',
        referenceId: null,
        owner: row.canonicalResponse.owner,
        wiringState: 'UNAVAILABLE',
        unknownReason: 'canonical owner response evidence is unavailable for this resource attention state',
      };
    }
    return deepFreeze({
      rowId: row.rowId,
      resourceFamily: row.resourceFamily,
      canonicalOwner: row.canonicalOwner,
      observedAtMs: row.observedAtMs,
      maxAgeMs: row.maxAgeMs,
      provenance: row.provenance,
      assuranceResult: precedence(results),
      reasonCodes: sortedUnique(reasons),
      currentBurn: row.burn.value,
      budgetLimit: row.budget.limit,
      budgetRemaining: row.budget.remaining,
      forecast: row.forecast.value,
      forecastHorizonMs: row.forecast.horizonMs,
      unknownReason: row.burn.unknownReason ?? row.budget.unknownReason ?? row.forecast.unknownReason,
      unknownReasons: {
        burn: row.burn.unknownReason,
        budget: row.budget.unknownReason,
        forecast: row.forecast.unknownReason,
      },
      topConsumers: row.topConsumers.map((consumer) => ({ ...consumer })),
      throttlingEvidence: { ...row.throttling },
      circuitEvidence: { ...row.circuit },
      canonicalResponse,
      protections: { ...row.protections },
      throttleDecision: null,
      commands: [],
    });
  });
  return deepFreeze({
    schemaVersion: STABILITY_SCHEMA_VERSION,
    assessmentKind: 'RESOURCE_COST_CIRCUIT_EVIDENCE',
    bundleId: bundle.bundleId,
    evaluatedAtMs: nowMs,
    assuranceResult: precedence(rows.map((row) => row.assuranceResult)),
    rows,
    loadSheddingOrder: [...bundle.loadSheddingOrder],
    mayThrottle: false,
    mayExecute: false,
    mayCloseOrResetCircuit: false,
    controllerOwner: null,
    throttleDecision: null,
    commands: [],
    contractIssues: [],
    dataAuthority: 'SYNTHETIC_TEST',
    effectAuthority: 'NONE',
  });
}

export function isAssuranceResult(value) {
  return ASSURANCE_RESULTS.includes(value);
}
