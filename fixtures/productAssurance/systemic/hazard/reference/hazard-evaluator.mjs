import {
  REQUIRED_UNACCEPTABLE_LOSS_IDS,
  validateHazardAssurancePacket,
} from '../contracts/index.mjs';

const MIN_UTC_MS = 1_262_304_000_000;
const MAX_UTC_MS = 4_102_444_800_000;

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const cloneJson = (value) => {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
};

const validClock = (nowMs) => (
  Number.isSafeInteger(nowMs) && nowMs >= MIN_UTC_MS && nowMs <= MAX_UTC_MS
);
const stableUnique = (values) => Object.freeze([...new Set(values)].sort());
const statusFrom = (statuses) => {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
};

const emptyRegistryCoverage = () => ({
  referencedAssumptionIds: [],
  registeredAssumptionIds: [],
  unregisteredAssumptionIds: [],
  unboundCriticalConsumerIds: [],
  orphanedCriticalAssumptionIds: [],
});

const invalidPacketResult = (nowMs, reasonCode, packetIssues = []) => deepFreeze({
  schemaVersion: 'pa.s1.hazard-evaluation.v1',
  evaluatedAtMs: validClock(nowMs) ? nowMs : null,
  status: 'UNKNOWN',
  authorityEffect: 'NONE',
  machineResponseOwner: 'CANONICAL_I00_DOMAIN_OWNERS',
  reasonCodes: [reasonCode],
  packetIssues: cloneJson(packetIssues),
  registryCoverage: emptyRegistryCoverage(),
  lossFamilyCoverage: {
    requiredLossFamilyIds: [...REQUIRED_UNACCEPTABLE_LOSS_IDS],
    referencedLossFamilyIds: [],
    uncoveredLossFamilyIds: [...REQUIRED_UNACCEPTABLE_LOSS_IDS],
  },
  assumptionResults: [],
  consumerResults: [],
  hazardResults: [],
  invalidatedConsumers: [],
  invalidatedAssuranceClaimIds: [],
});

export function evaluateAssumptionAt(assumption, nowMs) {
  const record = assumption && typeof assumption === 'object' ? assumption : {};
  const assumptionId = typeof record.assumptionId === 'string' ? record.assumptionId : 'UNKNOWN_ASSUMPTION';
  const capitalCritical = record.capitalCritical === true;
  const invalidClock = !validClock(nowMs);
  const timelineValid = Number.isSafeInteger(record.firstValidAtMs)
    && Number.isSafeInteger(record.lastVerifiedAtMs)
    && Number.isSafeInteger(record.expiresAtMs)
    && Number.isSafeInteger(record.maximumAgeMs)
    && record.maximumAgeMs > 0
    && record.firstValidAtMs <= record.lastVerifiedAtMs
    && record.lastVerifiedAtMs <= record.expiresAtMs;
  const evidencePresent = Array.isArray(record.supportingSourceIds)
    && record.supportingSourceIds.length > 0
    && Array.isArray(record.evidenceIds)
    && record.evidenceIds.length > 0;

  let freshnessStatus = 'CURRENT';
  if (invalidClock) freshnessStatus = 'CLOCK_INVALID';
  else if (!evidencePresent) freshnessStatus = 'EVIDENCE_MISSING';
  else if (!timelineValid) freshnessStatus = 'INVALID_TIMELINE';
  else if (nowMs < record.firstValidAtMs) freshnessStatus = 'NOT_YET_VALID';
  else if (nowMs < record.lastVerifiedAtMs) freshnessStatus = 'INCOHERENT';
  else if (
    nowMs >= record.expiresAtMs
    || nowMs - record.lastVerifiedAtMs > record.maximumAgeMs
  ) freshnessStatus = 'EXPIRED';

  const declaredResult = ['PASS', 'FAIL', 'UNKNOWN'].includes(record.result) ? record.result : 'UNKNOWN';
  const declaredReasonCode = typeof record.reasonCode === 'string' ? record.reasonCode : 'MISSING';
  let result = declaredResult;
  let reasonCode = declaredReasonCode;

  if (invalidClock) {
    result = 'UNKNOWN';
    reasonCode = 'CLOCK_INVALID';
  } else if (declaredResult === 'FAIL') {
    // A known contradiction remains a failure even after its observation becomes stale.
    result = 'FAIL';
  } else if (freshnessStatus !== 'CURRENT') {
    result = 'UNKNOWN';
    reasonCode = freshnessStatus === 'EVIDENCE_MISSING' ? 'MISSING' : freshnessStatus;
  }

  const staleAtMs = timelineValid
    ? Math.min(record.expiresAtMs, record.lastVerifiedAtMs + record.maximumAgeMs)
    : null;
  const ageMs = validClock(nowMs) && Number.isSafeInteger(record.lastVerifiedAtMs) && nowMs >= record.lastVerifiedAtMs
    ? nowMs - record.lastVerifiedAtMs
    : null;

  return deepFreeze({
    assumptionId,
    capitalCritical,
    declaredResult,
    declaredReasonCode,
    result,
    reasonCode,
    freshnessStatus,
    evaluatedAtMs: validClock(nowMs) ? nowMs : null,
    ageMs,
    staleAtMs,
    invalidatesCriticalDependents: capitalCritical && result !== 'PASS',
    consequence: cloneJson(record.consequence ?? null),
    requiredOwnerResponse: typeof record.requiredOwnerResponse === 'string' ? record.requiredOwnerResponse : 'Canonical owner review required.',
    residualRisk: typeof record.residualRisk === 'string' ? record.residualRisk : 'Residual risk is unknown.',
  });
}

function buildConsumers(packet) {
  const hazards = Array.isArray(packet?.hazards)
    ? packet.hazards.map((hazard) => ({
      consumerId: hazard.hazardId,
      kind: 'HAZARD',
      active: hazard.active,
      capitalCritical: hazard.capitalCritical,
      assumptionIds: Array.isArray(hazard.assumptionIds) ? hazard.assumptionIds : [],
    }))
    : [];
  const otherConsumers = Array.isArray(packet?.assumptionConsumers)
    ? packet.assumptionConsumers.map((consumer) => ({
      consumerId: consumer.consumerId,
      kind: consumer.kind,
      active: consumer.active,
      capitalCritical: consumer.capitalCritical,
      assumptionIds: Array.isArray(consumer.assumptionIds) ? consumer.assumptionIds : [],
    }))
    : [];
  return [...hazards, ...otherConsumers]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.consumerId.localeCompare(right.consumerId));
}

export function evaluateHazardAssurance(packet, nowMs) {
  if (!validClock(nowMs)) return invalidPacketResult(nowMs, 'CLOCK_INVALID');

  const packetIssues = validateHazardAssurancePacket(packet);
  if (packetIssues.some((entry) => entry.code === 'PLAIN_JSON_REQUIRED' || entry.code.startsWith('SCHEMA_'))) {
    return invalidPacketResult(nowMs, 'PACKET_INVALID', packetIssues);
  }
  const consumers = buildConsumers(packet);
  const activeConsumers = consumers.filter((consumer) => consumer.active);
  const activeCriticalConsumers = activeConsumers.filter((consumer) => consumer.capitalCritical);
  const activeCriticalConsumerIds = new Set(activeCriticalConsumers.map((consumer) => consumer.consumerId));
  const activeCriticalReferenceIds = new Set(activeCriticalConsumers.flatMap((consumer) => consumer.assumptionIds));
  const registryCoverageIssue = (entry) => {
    if (entry.code === 'ASSUMPTION_REFERENCE_UNKNOWN') return activeCriticalReferenceIds.has(entry.message);
    if (entry.code === 'CAPITAL_CRITICAL_CONSUMER_WITHOUT_ASSUMPTION') return activeCriticalConsumerIds.has(entry.message);
    if (entry.code === 'CAPITAL_CRITICAL_ASSUMPTION_ORPHANED') return true;
    return false;
  };
  if (packetIssues.length > 0 && !packetIssues.every(registryCoverageIssue)) {
    return invalidPacketResult(nowMs, 'PACKET_INVALID', packetIssues);
  }

  const assumptionResults = (packet.assumptions ?? [])
    .map((assumption) => evaluateAssumptionAt(assumption, nowMs))
    .sort((left, right) => left.assumptionId.localeCompare(right.assumptionId));
  const assumptionResultById = new Map(assumptionResults.map((entry) => [entry.assumptionId, entry]));
  const registeredAssumptionIds = stableUnique((packet.assumptions ?? []).map((entry) => entry.assumptionId));
  const referencedAssumptionIds = stableUnique(activeCriticalConsumers.flatMap((consumer) => consumer.assumptionIds));
  const unregisteredAssumptionIds = stableUnique(
    referencedAssumptionIds.filter((assumptionId) => !assumptionResultById.has(assumptionId)),
  );
  const unboundCriticalConsumerIds = stableUnique(
    activeCriticalConsumers.filter((consumer) => consumer.assumptionIds.length === 0).map((consumer) => consumer.consumerId),
  );
  const orphanedCriticalAssumptionIds = stableUnique(
    (packet.assumptions ?? [])
      .filter((assumption) => assumption.capitalCritical && !activeCriticalReferenceIds.has(assumption.assumptionId))
      .map((assumption) => assumption.assumptionId),
  );

  const consumerResults = activeConsumers.map((consumer) => {
    const missingRegistryBinding = consumer.assumptionIds.length === 0;
    const missingAssumptionIds = stableUnique(consumer.assumptionIds.filter((id) => !assumptionResultById.has(id)));
    const failedAssumptionIds = stableUnique(consumer.assumptionIds.filter((id) => assumptionResultById.get(id)?.result === 'FAIL'));
    const unknownAssumptionIds = stableUnique(consumer.assumptionIds.filter((id) => assumptionResultById.get(id)?.result === 'UNKNOWN'));
    const status = missingRegistryBinding || missingAssumptionIds.length > 0
      ? 'FAIL'
      : statusFrom([
        ...failedAssumptionIds.map(() => 'FAIL'),
        ...unknownAssumptionIds.map(() => 'UNKNOWN'),
      ]);
    return deepFreeze({
      consumerId: consumer.consumerId,
      kind: consumer.kind,
      capitalCritical: consumer.capitalCritical,
      status,
      missingRegistryBinding,
      assumptionIds: stableUnique(consumer.assumptionIds),
      missingAssumptionIds,
      failedAssumptionIds,
      unknownAssumptionIds,
    });
  }).sort((left, right) => left.kind.localeCompare(right.kind) || left.consumerId.localeCompare(right.consumerId));

  const hazardResultById = new Map(
    consumerResults.filter((entry) => entry.kind === 'HAZARD').map((entry) => [entry.consumerId, entry]),
  );
  const hazardResults = (packet.hazards ?? [])
    .filter((hazard) => hazard.active)
    .map((hazard) => {
      const result = hazardResultById.get(hazard.hazardId);
      return deepFreeze({
        hazardId: hazard.hazardId,
        capitalCritical: hazard.capitalCritical,
        status: result?.status ?? 'UNKNOWN',
        unacceptableLossIds: stableUnique(hazard.unacceptableLossIds),
        affectedBoundaries: stableUnique(hazard.affectedBoundaries),
        assumptionIds: stableUnique(hazard.assumptionIds),
        containmentRecoveryOwner: cloneJson(hazard.containmentRecoveryOwner),
        proofKind: hazard.proof.kind,
        proofAssertionLevel: hazard.proof.assertionLevel,
        cockpitProjection: cloneJson(hazard.cockpitProjection),
        ownerDisposition: cloneJson(hazard.ownerDisposition),
      });
    })
    .sort((left, right) => left.hazardId.localeCompare(right.hazardId));

  const invalidatedConsumers = consumerResults
    .filter((consumer) => consumer.status !== 'PASS')
    .map((consumer) => deepFreeze({
      consumerId: consumer.consumerId,
      kind: consumer.kind,
      status: consumer.status,
      invalidatingAssumptionIds: stableUnique([
        ...consumer.missingAssumptionIds,
        ...consumer.failedAssumptionIds,
        ...consumer.unknownAssumptionIds,
      ]),
      responseOwner: 'CANONICAL_I00_DOMAIN_OWNERS',
    }));

  const referencedLossFamilyIds = stableUnique(
    (packet.hazards ?? []).filter((hazard) => hazard.active).flatMap((hazard) => hazard.unacceptableLossIds),
  );
  const uncoveredLossFamilyIds = stableUnique(
    REQUIRED_UNACCEPTABLE_LOSS_IDS.filter((lossId) => !referencedLossFamilyIds.includes(lossId)),
  );
  const criticalStatuses = consumerResults
    .filter((consumer) => consumer.capitalCritical)
    .map((consumer) => consumer.status);
  const registryCoverageFailed = unregisteredAssumptionIds.length > 0
    || unboundCriticalConsumerIds.length > 0
    || orphanedCriticalAssumptionIds.length > 0;
  const status = registryCoverageFailed || uncoveredLossFamilyIds.length > 0
    ? 'FAIL'
    : statusFrom(criticalStatuses);
  const reasonCodes = [];
  if (unregisteredAssumptionIds.length > 0) reasonCodes.push('ASSUMPTION_REGISTRY_COVERAGE_FAILURE');
  if (unboundCriticalConsumerIds.length > 0) reasonCodes.push('ASSUMPTION_REGISTRY_BINDING_MISSING');
  if (orphanedCriticalAssumptionIds.length > 0) reasonCodes.push('CRITICAL_ASSUMPTION_ORPHANED');
  if (uncoveredLossFamilyIds.length > 0) reasonCodes.push('UNACCEPTABLE_LOSS_FAMILY_COVERAGE_FAILURE');
  if (consumerResults.some((consumer) => consumer.capitalCritical && consumer.failedAssumptionIds.length > 0)) reasonCodes.push('CRITICAL_ASSUMPTION_FAILED');
  if (consumerResults.some((consumer) => consumer.capitalCritical && consumer.unknownAssumptionIds.length > 0)) reasonCodes.push('CRITICAL_ASSUMPTION_UNKNOWN');
  if (status === 'PASS') reasonCodes.push('ALL_ACTIVE_CAPITAL_CRITICAL_ASSUMPTIONS_PASS');

  return deepFreeze({
    schemaVersion: 'pa.s1.hazard-evaluation.v1',
    evaluatedAtMs: nowMs,
    status,
    authorityEffect: 'NONE',
    machineResponseOwner: 'CANONICAL_I00_DOMAIN_OWNERS',
    reasonCodes: stableUnique(reasonCodes),
    packetIssues: cloneJson(packetIssues),
    registryCoverage: {
      referencedAssumptionIds,
      registeredAssumptionIds,
      unregisteredAssumptionIds,
      unboundCriticalConsumerIds,
      orphanedCriticalAssumptionIds,
    },
    lossFamilyCoverage: {
      requiredLossFamilyIds: [...REQUIRED_UNACCEPTABLE_LOSS_IDS],
      referencedLossFamilyIds,
      uncoveredLossFamilyIds,
    },
    assumptionResults,
    consumerResults,
    hazardResults,
    invalidatedConsumers,
    invalidatedAssuranceClaimIds: stableUnique(
      invalidatedConsumers.filter((entry) => entry.kind === 'ASSURANCE_CLAIM').map((entry) => entry.consumerId),
    ),
  });
}
