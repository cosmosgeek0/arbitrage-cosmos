import {
  ASSURANCE_CASE_EVALUATION_VERSION,
  DIAGNOSTIC_EVIDENCE_REQUIREMENTS,
  INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES,
  PROHIBITED_ASSURANCE_COMMANDS,
  REQUIRED_MANDATORY_CLAIM_IDS,
  SCHEMA_LIMITS,
  capturePlainData,
  compareCanonical,
  deepFreeze,
  isFatalPacketIssue,
  isFatalS1ProjectionIssue,
  isValidUtcMillis,
  stableUnique,
  validateAssuranceCasePacket,
  validateS1AssumptionProjection,
} from '../contracts/index.mjs';

const statusFrom = (statuses) => {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
};

const minimumUtcMillis = (values) => {
  const valid = values.filter(isValidUtcMillis);
  return valid.length > 0 ? Math.min(...valid) : null;
};

const invalidResult = ({
  nowMs,
  status = 'UNKNOWN',
  reasonCodes,
  packetIssues = [],
  s1ProjectionIssues = [],
  mandatoryCoverage = null,
}) => deepFreeze({
  schemaVersion: ASSURANCE_CASE_EVALUATION_VERSION,
  evaluatedAtMs: isValidUtcMillis(nowMs) ? nowMs : null,
  status,
  truthLabel: 'SYNTHETIC_ONLY',
  authorityEffect: 'NONE',
  runtimeProjectionOwner: 'I08.machine-supervisor',
  machineResponseOwner: 'EXISTING_CANONICAL_OWNERS',
  reasonCodes: stableUnique(reasonCodes),
  packetIssues,
  s1ProjectionIssues,
  mandatoryCoverage: mandatoryCoverage ?? {
    requiredClaimIds: [...REQUIRED_MANDATORY_CLAIM_IDS],
    presentClaimIds: [],
    missingClaimIds: [...REQUIRED_MANDATORY_CLAIM_IDS],
    unexpectedClaimIds: [],
  },
  evidenceResults: [],
  assumptionResults: [],
  claimResults: [],
  invalidationPaths: [],
  invalidationTruncated: false,
  recommendations: [],
  diagnosticPlane: {
    posture: 'UNKNOWN',
    status: 'UNKNOWN',
    reasonCodes: ['PACKET_OR_INPUT_INVALID'],
    postureEvidenceIds: [],
    containmentEvidenceIds: [],
    permissionEvidenceIds: [],
    providerOutageEvidenceIds: [],
    privacyEvidenceIds: [],
    independentEvidenceIds: [],
  },
  recomputation: {
    applicable: false,
    originInvalidatedAtMs: null,
    logicalCompletedAtMs: isValidUtcMillis(nowMs) ? nowMs : null,
    assuranceSloMs: null,
    assuranceDueAtMs: null,
    completedWithinDeclaredSlo: false,
    affectedClaimDeadlines: [],
  },
  safetyBoundary: {
    readOnly: true,
    supportUsableForNewAction: false,
    doesNotBlockCanonicalRiskReduction: true,
    riskReductionAvailabilityOwner: 'EXISTING_CANONICAL_OWNERS',
    llmMayExplain: true,
    llmMayRestoreSupport: false,
    prohibitedCommands: [...PROHIBITED_ASSURANCE_COMMANDS],
    commandsIssued: 0,
  },
});

const domainIdentity = (domain) => `${domain.class}:${domain.id}`;
const sortedDomains = (domains) => [...domains].sort((left, right) => compareCanonical(domainIdentity(left), domainIdentity(right)));
const appliedAssumptionIdsForClaim = (claim, diagnosticPosture) => {
  if (diagnosticPosture !== 'NOT_CONFIGURED') return claim.assumptionIds;
  if (claim.claimId === 'PA-S4-CLAIM-013') return [];
  return claim.assumptionIds.filter((assumptionId) => assumptionId !== 'PA-S1-AS-009');
};

function freshnessFor(evidence, nowMs) {
  const timelineValid = isValidUtcMillis(evidence.createdAtMs)
    && isValidUtcMillis(evidence.lastVerifiedAtMs)
    && isValidUtcMillis(evidence.expiresAtMs)
    && Number.isSafeInteger(evidence.maximumAgeMs)
    && evidence.maximumAgeMs > 0
    && evidence.createdAtMs <= evidence.lastVerifiedAtMs
    && evidence.lastVerifiedAtMs <= evidence.expiresAtMs;
  const maxAgeBoundaryMs = timelineValid ? evidence.lastVerifiedAtMs + evidence.maximumAgeMs : null;
  const invalidAtMs = timelineValid ? Math.min(evidence.expiresAtMs, maxAgeBoundaryMs + 1) : null;
  let freshnessStatus = 'CURRENT';
  if (!timelineValid) freshnessStatus = 'INVALID_TIMELINE';
  else if (nowMs < evidence.createdAtMs) freshnessStatus = 'NOT_YET_VALID';
  else if (nowMs < evidence.lastVerifiedAtMs) freshnessStatus = 'INCOHERENT';
  else if (nowMs >= evidence.expiresAtMs || nowMs - evidence.lastVerifiedAtMs > evidence.maximumAgeMs) freshnessStatus = 'EXPIRED';
  return {
    freshnessStatus,
    invalidAtMs,
    ageMs: nowMs >= evidence.lastVerifiedAtMs ? nowMs - evidence.lastVerifiedAtMs : null,
  };
}

function normalizeAssumptionResults(projection, nowMs) {
  const projectionCurrent = projection.evaluatedAtMs === nowMs;
  return projection.assumptionResults.map((record) => {
    const reasonCodes = [];
    let result = record.result;
    if (!projectionCurrent) {
      result = 'UNKNOWN';
      reasonCodes.push('S1_PROJECTION_NOT_CURRENT');
    }
    if (record.result === 'FAIL') {
      result = 'FAIL';
      reasonCodes.push(record.reasonCode, 'S1_ASSUMPTION_FAILED');
    } else if (record.result === 'UNKNOWN') {
      result = 'UNKNOWN';
      reasonCodes.push(record.reasonCode, 'S1_ASSUMPTION_UNKNOWN');
    } else if (record.freshnessStatus !== 'CURRENT') {
      result = 'UNKNOWN';
      reasonCodes.push(record.freshnessStatus, 'S1_ASSUMPTION_NOT_CURRENT');
    } else if (result === 'PASS') {
      reasonCodes.push(record.reasonCode, 'S1_ASSUMPTION_CURRENT');
    }
    const invalidatedAtMs = result === 'PASS'
      ? null
      : record.result === 'FAIL'
        ? record.evaluatedAtMs
        : record.freshnessStatus === 'EXPIRED' && isValidUtcMillis(record.staleAtMs)
          ? Math.min(record.staleAtMs, nowMs)
          : record.evaluatedAtMs;
    return deepFreeze({
      assumptionId: record.assumptionId,
      sourceOwnerId: record.sourceOwnerId,
      declaredResult: record.result,
      result,
      reasonCodes: stableUnique(reasonCodes),
      freshnessStatus: record.freshnessStatus,
      sourceEvaluatedAtMs: record.evaluatedAtMs,
      staleAtMs: record.staleAtMs,
      ageMs: nowMs >= record.evaluatedAtMs ? nowMs - record.evaluatedAtMs : null,
      invalidatedAtMs,
      supportUsableForNewAction: result === 'PASS' && projectionCurrent,
    });
  }).sort((left, right) => compareCanonical(left.assumptionId, right.assumptionId));
}

function buildGraphEvaluator(packet, assumptionResults, nowMs) {
  const claimById = new Map(packet.claims.map((claim) => [claim.claimId, claim]));
  const evidenceById = new Map(packet.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const assumptionById = new Map(assumptionResults.map((entry) => [entry.assumptionId, entry]));
  const claimCache = new Map();
  const evidenceCache = new Map();
  const active = new Set();
  let evaluateClaim;
  let evaluateEvidence;

  const diagnosticContributions = (claim) => {
    if (claim.requirementKey !== 'DIAGNOSTIC_PLANE_POSTURE') {
      return { statuses: [], reasonCodes: [], invalidators: [], invalidatedAtMs: null };
    }
    const statuses = [];
    const reasonCodes = [];
    const invalidators = [];
    const invalidatedTimes = [];
    const boundEvidenceIds = new Set([...claim.supportingEvidenceIds, ...claim.counterEvidenceIds]);
    for (const field of Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS)) {
      const required = field === 'postureEvidenceIds' || packet.diagnosticPlane.posture !== 'NOT_CONFIGURED';
      const ids = packet.diagnosticPlane[field];
      if (required && ids.length === 0) {
        statuses.push('UNKNOWN');
        reasonCodes.push(`DIAGNOSTIC_${field.replace(/EvidenceIds$/, '').toUpperCase()}_EVIDENCE_MISSING`);
        invalidators.push(`MISSING:${field}`);
      }
      for (const evidenceId of ids) {
        if (!boundEvidenceIds.has(evidenceId)) {
          statuses.push('UNKNOWN');
          reasonCodes.push('DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM');
          invalidators.push(evidenceId);
          continue;
        }
        const result = evaluateEvidence(evidenceId);
        statuses.push(result?.result ?? 'UNKNOWN');
        if (!result || result.result !== 'PASS') {
          invalidators.push(evidenceId);
          if (isValidUtcMillis(result?.invalidatedAtMs)) invalidatedTimes.push(result.invalidatedAtMs);
        }
      }
    }
    if (packet.diagnosticPlane.posture === 'NOT_CONFIGURED' && statuses.every((status) => status === 'PASS')) {
      reasonCodes.push('DIAGNOSTIC_NOT_CONFIGURED_VALID');
    } else if (packet.diagnosticPlane.posture !== 'NOT_CONFIGURED' && statuses.every((status) => status === 'PASS')) {
      reasonCodes.push('DIAGNOSTIC_CONFIGURED_EVIDENCE_COMPLETE');
    }
    return {
      statuses,
      reasonCodes: stableUnique(reasonCodes),
      invalidators: stableUnique(invalidators),
      invalidatedAtMs: minimumUtcMillis(invalidatedTimes),
    };
  };

  evaluateEvidence = (evidenceId) => {
    if (evidenceCache.has(evidenceId)) return evidenceCache.get(evidenceId);
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return null;
    const nodeKey = `evidence:${evidenceId}`;
    if (active.has(nodeKey)) return null;
    active.add(nodeKey);

    const freshness = freshnessFor(evidence, nowMs);
    const producerDomains = new Set(evidence.producer.failureDomains.map(domainIdentity));
    const verifierDomains = new Set(evidence.verifier.failureDomains.map(domainIdentity));
    const sharedFailureDomains = stableUnique([...producerDomains].filter((identity) => verifierDomains.has(identity)));
    const producerDomainClasses = new Set(evidence.producer.failureDomains.map((domain) => domain.class));
    const verifierDomainClasses = new Set(evidence.verifier.failureDomains.map((domain) => domain.class));
    const requiredDomainClasses = INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES[evidence.independence.declaredClass] ?? [];
    const missingProducerDomainClasses = requiredDomainClasses.filter((entry) => !producerDomainClasses.has(entry));
    const missingVerifierDomainClasses = requiredDomainClasses.filter((entry) => !verifierDomainClasses.has(entry));

    const derivedClaimResults = evidence.derivedFromClaimIds.map(evaluateClaim);
    const derivedEvidenceResults = evidence.derivedFromEvidenceIds.map(evaluateEvidence);
    const basisResults = evidence.independence.basisEvidenceIds.map(evaluateEvidence);
    const dependencyStatuses = [...derivedClaimResults, ...derivedEvidenceResults].map((entry) => entry?.result ?? 'UNKNOWN');
    const dependencyStatus = statusFrom(dependencyStatuses);
    const dependencyInvalidatedAtMs = minimumUtcMillis(
      [...derivedClaimResults, ...derivedEvidenceResults].map((entry) => entry?.invalidatedAtMs),
    );

    const localIndependenceReasons = [];
    if (evidence.producer.actorId === evidence.verifier.actorId) localIndependenceReasons.push('PRODUCER_VERIFIER_NOT_INDEPENDENT');
    if (evidence.producer.ownerId === evidence.verifier.ownerId) localIndependenceReasons.push('PRODUCER_VERIFIER_OWNER_COMMON_MODE');
    if (sharedFailureDomains.length > 0) localIndependenceReasons.push('COMMON_MODE_FAILURE_DOMAIN');
    if (evidence.independence.commonModeDependencyIds.length > 0) localIndependenceReasons.push('DECLARED_COMMON_MODE_DEPENDENCY');
    if (missingProducerDomainClasses.length > 0) localIndependenceReasons.push('PRODUCER_FAILURE_DOMAIN_COVERAGE_MISSING');
    if (missingVerifierDomainClasses.length > 0) localIndependenceReasons.push('VERIFIER_FAILURE_DOMAIN_COVERAGE_MISSING');
    const independenceReasons = [...localIndependenceReasons];
    if (evidence.purpose !== 'INDEPENDENCE_BASIS') {
      if (evidence.independence.required !== true || evidence.independence.basisEvidenceIds.length === 0) independenceReasons.push('INDEPENDENCE_UNPROVEN');
      if (basisResults.some((entry) => entry === null)) independenceReasons.push('INDEPENDENCE_BASIS_MISSING');
      if (basisResults.some((entry) => entry?.result === 'FAIL')) independenceReasons.push('INDEPENDENCE_BASIS_FAILED');
      if (basisResults.some((entry) => entry?.result === 'UNKNOWN')) independenceReasons.push('INDEPENDENCE_BASIS_UNKNOWN');
    }
    const independenceStatus = independenceReasons.length === 0 ? 'PROVEN' : 'UNKNOWN';

    const reasonCodes = [];
    let result = evidence.result;
    if (evidence.result === 'FAIL') {
      result = 'FAIL';
      reasonCodes.push(evidence.reasonCode, 'DECLARED_EVIDENCE_FAILURE');
    } else {
      if (evidence.result === 'UNKNOWN') reasonCodes.push(evidence.reasonCode, 'DECLARED_EVIDENCE_UNKNOWN');
      if (freshness.freshnessStatus !== 'CURRENT') {
        result = 'UNKNOWN';
        reasonCodes.push(freshness.freshnessStatus);
      }
      if (dependencyStatus === 'FAIL') {
        result = 'FAIL';
        reasonCodes.push('DERIVED_DEPENDENCY_FAILED');
      } else if (dependencyStatus === 'UNKNOWN' && result !== 'FAIL') {
        result = 'UNKNOWN';
        reasonCodes.push('DERIVED_DEPENDENCY_UNKNOWN');
      }
      if (independenceStatus !== 'PROVEN' && result !== 'FAIL') {
        result = 'UNKNOWN';
        reasonCodes.push(...independenceReasons);
      }
      if (result === 'PASS') reasonCodes.push(evidence.reasonCode, 'CURRENT_INDEPENDENT_EVIDENCE');
    }

    const basisInvalidatedAtMs = minimumUtcMillis(basisResults.map((entry) => entry?.invalidatedAtMs));
    const observedEvidenceBoundaryMs = Math.min(evidence.lastVerifiedAtMs, nowMs);
    const localInvalidatedAtMs = minimumUtcMillis([
      evidence.result !== 'PASS' ? observedEvidenceBoundaryMs : null,
      freshness.freshnessStatus === 'EXPIRED' ? freshness.invalidAtMs : null,
      freshness.freshnessStatus !== 'CURRENT' && freshness.freshnessStatus !== 'EXPIRED' ? observedEvidenceBoundaryMs : null,
      localIndependenceReasons.length > 0 ? observedEvidenceBoundaryMs : null,
    ]);
    const invalidatedAtMs = result === 'PASS' ? null : minimumUtcMillis([
      localInvalidatedAtMs,
      dependencyStatus !== 'PASS' ? dependencyInvalidatedAtMs : null,
      basisResults.some((entry) => entry?.result !== 'PASS') ? basisInvalidatedAtMs : null,
    ]);
    const primitiveInvalidator = result !== 'PASS' && isValidUtcMillis(localInvalidatedAtMs);
    const evaluated = deepFreeze({
      evidenceId: evidence.evidenceId,
      role: evidence.role,
      purpose: evidence.purpose,
      kind: evidence.kind,
      statement: evidence.statement,
      claimBinding: evidence.claimBinding,
      capitalCritical: evidence.capitalCritical,
      declaredResult: evidence.result,
      result,
      reasonCodes: stableUnique(reasonCodes),
      sourceIdentity: evidence.sourceIdentity,
      validator: evidence.validator,
      producerId: evidence.producer.actorId,
      producerOwnerId: evidence.producer.ownerId,
      producerFailureDomains: sortedDomains(evidence.producer.failureDomains),
      verifierId: evidence.verifier.actorId,
      verifierOwnerId: evidence.verifier.ownerId,
      verifierFailureDomains: sortedDomains(evidence.verifier.failureDomains),
      independenceStatus,
      independenceClass: evidence.independence.declaredClass,
      independenceBasisEvidenceIds: stableUnique(evidence.independence.basisEvidenceIds),
      sharedFailureDomains,
      commonModeDependencyIds: stableUnique(evidence.independence.commonModeDependencyIds),
      requiredFailureDomainClasses: stableUnique(requiredDomainClasses),
      missingProducerFailureDomainClasses: stableUnique(missingProducerDomainClasses),
      missingVerifierFailureDomainClasses: stableUnique(missingVerifierDomainClasses),
      derivedFromClaimIds: stableUnique(evidence.derivedFromClaimIds),
      derivedFromEvidenceIds: stableUnique(evidence.derivedFromEvidenceIds),
      certifiesEvidenceIds: stableUnique(evidence.certifiesEvidenceIds),
      freshnessStatus: freshness.freshnessStatus,
      createdAtMs: evidence.createdAtMs,
      lastVerifiedAtMs: evidence.lastVerifiedAtMs,
      expiresAtMs: evidence.expiresAtMs,
      maximumAgeMs: evidence.maximumAgeMs,
      ageMs: freshness.ageMs,
      invalidAtMs: freshness.invalidAtMs,
      localInvalidatedAtMs,
      invalidatedAtMs,
      primitiveInvalidator,
      supportUsableForNewAction: result === 'PASS',
    });
    active.delete(nodeKey);
    evidenceCache.set(evidenceId, evaluated);
    return evaluated;
  };

  evaluateClaim = (claimId) => {
    if (claimCache.has(claimId)) return claimCache.get(claimId);
    const claim = claimById.get(claimId);
    if (!claim) return null;
    const nodeKey = `claim:${claimId}`;
    if (active.has(nodeKey)) return null;
    active.add(nodeKey);

    const evidenceResults = [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds].map(evaluateEvidence);
    const appliedAssumptionIds = appliedAssumptionIdsForClaim(claim, packet.diagnosticPlane.posture);
    const appliedAssumptionResults = appliedAssumptionIds.map((assumptionId) => assumptionById.get(assumptionId) ?? null);
    const subclaimResults = claim.subclaimIds.map(evaluateClaim);
    const invalidatingCounterEvidenceIds = claim.counterEvidenceIds.filter((evidenceId, position) => (
      evidenceResults[claim.supportingEvidenceIds.length + position]?.result !== 'PASS'
    ));
    const evidenceOnlyComponentResults = claim.componentDrillDown.map((component) => {
      const supportResults = component.supportingEvidenceIds.map(evaluateEvidence);
      const componentResult = statusFrom(supportResults.map((entry) => entry?.result ?? 'UNKNOWN'));
      return {
        componentId: component.componentId,
        componentScope: component.componentScope,
        canonicalOwnerId: component.canonicalOwnerId,
        supportingEvidenceIds: stableUnique(component.supportingEvidenceIds),
        result: componentResult,
        invalidatingEvidenceIds: stableUnique([
          ...component.supportingEvidenceIds.filter((evidenceId, position) => supportResults[position]?.result !== 'PASS'),
          ...invalidatingCounterEvidenceIds,
        ]),
      };
    });
    const diagnostic = diagnosticContributions(claim);
    const reasonCodes = [...diagnostic.reasonCodes];
    const invalidatingEvidenceIds = [];
    const invalidatingAssumptionIds = [];
    const invalidatingSubclaimIds = [];
    for (let position = 0; position < evidenceResults.length; position += 1) {
      const evidenceId = [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds][position];
      const result = evidenceResults[position];
      if (!result || result.result !== 'PASS') invalidatingEvidenceIds.push(evidenceId);
      if (!result) reasonCodes.push('EVIDENCE_REFERENCE_MISSING');
      else if (result.result === 'FAIL') reasonCodes.push('EVIDENCE_FAILED');
      else if (result.result === 'UNKNOWN') reasonCodes.push('EVIDENCE_UNKNOWN');
    }
    for (let position = 0; position < appliedAssumptionResults.length; position += 1) {
      const assumptionId = appliedAssumptionIds[position];
      const result = appliedAssumptionResults[position];
      if (!result || result.result !== 'PASS') invalidatingAssumptionIds.push(assumptionId);
      if (!result) reasonCodes.push('S1_ASSUMPTION_REFERENCE_MISSING');
      else if (result.result === 'FAIL') reasonCodes.push('S1_ASSUMPTION_FAILED');
      else if (result.result === 'UNKNOWN') reasonCodes.push('S1_ASSUMPTION_UNKNOWN');
    }
    for (let position = 0; position < subclaimResults.length; position += 1) {
      const subclaimId = claim.subclaimIds[position];
      const result = subclaimResults[position];
      if (!result || result.result !== 'PASS') invalidatingSubclaimIds.push(subclaimId);
      if (!result) reasonCodes.push('SUBCLAIM_REFERENCE_MISSING');
      else if (result.result === 'FAIL') reasonCodes.push('SUBCLAIM_FAILED');
      else if (result.result === 'UNKNOWN') reasonCodes.push('SUBCLAIM_UNKNOWN');
    }
    invalidatingEvidenceIds.push(...diagnostic.invalidators.filter((id) => !id.startsWith('MISSING:')));
    const result = statusFrom([
      ...evidenceResults.map((entry) => entry?.result ?? 'UNKNOWN'),
      ...appliedAssumptionResults.map((entry) => entry?.result === 'PASS' ? 'PASS' : 'UNKNOWN'),
      ...subclaimResults.map((entry) => entry?.result ?? 'UNKNOWN'),
      ...diagnostic.statuses,
    ]);
    const sharedComponentDependencyStatuses = [
      ...evidenceResults
        .slice(claim.supportingEvidenceIds.length)
        .map((entry) => entry?.result ?? 'UNKNOWN'),
      ...appliedAssumptionResults.map((entry) => entry?.result === 'PASS' ? 'PASS' : 'UNKNOWN'),
      ...subclaimResults.map((entry) => entry?.result ?? 'UNKNOWN'),
      ...diagnostic.statuses,
    ];
    const componentResults = evidenceOnlyComponentResults.map((component) => {
      const componentResult = statusFrom([component.result, ...sharedComponentDependencyStatuses]);
      return deepFreeze({
        ...component,
        result: componentResult,
        supportUsableForNewAction: componentResult === 'PASS' && result === 'PASS',
      });
    }).sort((left, right) => compareCanonical(left.componentId, right.componentId));
    if (result === 'PASS') reasonCodes.push('ALL_REQUIRED_SUPPORT_CURRENT');
    const invalidatedAtMs = result === 'PASS' ? null : minimumUtcMillis([
      ...evidenceResults.map((entry) => entry?.invalidatedAtMs),
      ...appliedAssumptionResults.map((entry) => entry?.invalidatedAtMs),
      ...subclaimResults.map((entry) => entry?.invalidatedAtMs),
      diagnostic.invalidatedAtMs,
    ]);
    const evaluated = deepFreeze({
      claimId: claim.claimId,
      requirementKey: claim.requirementKey,
      statement: claim.statement,
      scope: claim.scope,
      capitalCritical: claim.capitalCritical,
      validator: claim.validator,
      result,
      reasonCodes: stableUnique(reasonCodes),
      subclaimIds: stableUnique(claim.subclaimIds),
      assumptionIds: stableUnique(claim.assumptionIds),
      appliedAssumptionIds: stableUnique(appliedAssumptionIds),
      supportingEvidenceIds: stableUnique(claim.supportingEvidenceIds),
      counterEvidenceIds: stableUnique(claim.counterEvidenceIds),
      invalidatingEvidenceIds: stableUnique(invalidatingEvidenceIds),
      invalidatingAssumptionIds: stableUnique(invalidatingAssumptionIds),
      invalidatingSubclaimIds: stableUnique(invalidatingSubclaimIds),
      invalidatedAtMs,
      propagationSloMs: claim.propagationSloMs,
      assuranceSloMs: claim.assuranceSloMs,
      canonicalOwner: claim.canonicalOwner,
      resultConsumerOwner: claim.resultConsumerOwner,
      invariantProjection: claim.invariantProjection,
      cockpitProjection: claim.cockpitProjection,
      componentResults,
      supportUsableForNewAction: result === 'PASS',
    });
    active.delete(nodeKey);
    claimCache.set(claimId, evaluated);
    return evaluated;
  };

  for (const claim of packet.claims) evaluateClaim(claim.claimId);
  for (const evidence of packet.evidence) evaluateEvidence(evidence.evidenceId);
  return {
    claimResults: [...claimCache.values()].sort((left, right) => compareCanonical(left.claimId, right.claimId)),
    evidenceResults: [...evidenceCache.values()].sort((left, right) => compareCanonical(left.evidenceId, right.evidenceId)),
  };
}

function collectInvalidationPaths(packet, claimResults, evidenceResults, assumptionResults, nowMs) {
  const claimResultById = new Map(claimResults.map((entry) => [entry.claimId, entry]));
  const evidenceResultById = new Map(evidenceResults.map((entry) => [entry.evidenceId, entry]));
  const parents = new Map();
  const addParent = (child, parent) => {
    if (!parents.has(child)) parents.set(child, []);
    parents.get(child).push(parent);
  };
  for (const claim of packet.claims) {
    for (const child of claim.subclaimIds) addParent(`claim:${child}`, `claim:${claim.claimId}`);
    for (const child of [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds]) addParent(`evidence:${child}`, `claim:${claim.claimId}`);
    const appliedAssumptions = appliedAssumptionIdsForClaim(claim, packet.diagnosticPlane.posture);
    for (const child of appliedAssumptions) addParent(`assumption:${child}`, `claim:${claim.claimId}`);
  }
  for (const evidence of packet.evidence) {
    for (const child of evidence.derivedFromClaimIds) addParent(`claim:${child}`, `evidence:${evidence.evidenceId}`);
    for (const child of [...evidence.derivedFromEvidenceIds, ...evidence.independence.basisEvidenceIds]) {
      addParent(`evidence:${child}`, `evidence:${evidence.evidenceId}`);
    }
  }
  const diagnosticEvidenceIds = stableUnique(Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).flatMap((field) => packet.diagnosticPlane[field]));
  for (const evidenceId of diagnosticEvidenceIds) addParent(`evidence:${evidenceId}`, 'claim:PA-S4-CLAIM-013');
  const diagnosticClaimResult = claimResultById.get('PA-S4-CLAIM-013');
  const diagnosticMissingReasons = stableUnique((diagnosticClaimResult?.reasonCodes ?? []).filter((reasonCode) => (
    reasonCode.endsWith('_EVIDENCE_MISSING') || reasonCode === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
  )));
  for (const reasonCode of diagnosticMissingReasons) addParent(`diagnostic:${reasonCode}`, 'claim:PA-S4-CLAIM-013');
  for (const [child, values] of parents) parents.set(child, stableUnique(values));

  const nodeResult = (node) => {
    const [type, ...rest] = node.split(':');
    const id = rest.join(':');
    if (type === 'claim') return claimResultById.get(id)?.result ?? 'UNKNOWN';
    if (type === 'evidence') return evidenceResultById.get(id)?.result ?? 'UNKNOWN';
    return 'UNKNOWN';
  };
  const displayNode = (node) => {
    const [type, ...rest] = node.split(':');
    const id = rest.join(':');
    return type === 'claim' ? id : `${type.toUpperCase()}:${id}`;
  };
  const origins = evidenceResults
    .filter((entry) => entry.primitiveInvalidator === true)
    .map((evidence) => ({
      originType: 'EVIDENCE',
      originId: evidence.evidenceId,
      originResult: evidence.result,
      originDetails: {
        ageMs: evidence.ageMs,
        freshnessStatus: evidence.freshnessStatus,
        invalidatedAtMs: evidence.localInvalidatedAtMs,
      },
    }));
  const missingEvidenceIds = stableUnique([
    ...packet.claims.flatMap((claim) => [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds]),
    ...diagnosticEvidenceIds,
  ].filter((evidenceId) => !evidenceResultById.has(evidenceId)));
  origins.push(...missingEvidenceIds.map((evidenceId) => ({
        originType: 'EVIDENCE',
        originId: evidenceId,
        originResult: 'UNKNOWN',
        originDetails: { ageMs: null, freshnessStatus: 'EVIDENCE_MISSING', invalidatedAtMs: null },
      })));
  origins.push(...assumptionResults
    .filter((entry) => entry.result !== 'PASS')
    .map((assumption) => ({
        originType: 'ASSUMPTION',
        originId: assumption.assumptionId,
        originResult: assumption.result,
        originDetails: {
          ageMs: assumption.ageMs,
          freshnessStatus: assumption.freshnessStatus,
          invalidatedAtMs: assumption.invalidatedAtMs,
        },
      })));
  origins.push(...diagnosticMissingReasons.map((reasonCode) => ({
        originType: 'DIAGNOSTIC',
        originId: reasonCode,
        originResult: 'UNKNOWN',
        originDetails: { ageMs: null, freshnessStatus: 'UNKNOWN', invalidatedAtMs: null },
      })));
  origins.sort((left, right) => compareCanonical(left.originType, right.originType) || compareCanonical(left.originId, right.originId));

  const paths = [];
  const seen = new Set();
  const maximumSteps = SCHEMA_LIMITS.maxInvalidationPaths * SCHEMA_LIMITS.maxInvalidationPathLength;
  let traversalSteps = 0;
  let truncated = false;
  const sortedParents = (node) => [...(parents.get(node) ?? [])].sort();
  const signatureFor = (origin, claimId, path) => (
    `${origin.originType}|${origin.originId}|${claimId}|${path.join('>')}`
  );
  const appendPath = (origin, claimId, path) => {
    const claimResult = claimResultById.get(claimId);
    if (!claimResult) return true;
    const signature = signatureFor(origin, claimId, path);
    if (seen.has(signature)) return true;
    if (paths.length >= SCHEMA_LIMITS.maxInvalidationPaths) {
      truncated = true;
      return false;
    }
    const dueAtMs = isValidUtcMillis(origin.originDetails.invalidatedAtMs)
      ? origin.originDetails.invalidatedAtMs + claimResult.propagationSloMs
      : null;
    seen.add(signature);
    paths.push(deepFreeze({
      originType: origin.originType,
      originId: origin.originId,
      originResult: origin.originResult,
      originAgeMs: origin.originDetails.ageMs ?? null,
      originFreshnessStatus: origin.originDetails.freshnessStatus ?? 'UNKNOWN',
      originInvalidAtMs: origin.originDetails.invalidatedAtMs ?? null,
      dependentClaimId: claimId,
      dependentResult: claimResult.result,
      path,
      observedAtMs: nowMs,
      projectionDueAtMs: isValidUtcMillis(dueAtMs) ? dueAtMs : null,
      propagationSloMs: claimResult.propagationSloMs,
      propagationSloMet: isValidUtcMillis(dueAtMs) ? nowMs <= dueAtMs : null,
      ownerId: claimResult.resultConsumerOwner.ownerId,
      supportUsableForNewAction: false,
    }));
    return true;
  };

  // Reserve one deterministic path per non-PASS claim before bounded expansion.
  // This prevents an early high-fanout origin from hiding a later invalid claim.
  const pathFromOriginToClaim = (origin, targetClaimId) => {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const queue = [{ node: start, path: [`${origin.originType}:${origin.originId}`] }];
    const visited = new Set([start]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current.path.length >= SCHEMA_LIMITS.maxInvalidationPathLength) continue;
      for (const parent of sortedParents(current.node)) {
        if (nodeResult(parent) === 'PASS') continue;
        const nextPath = [...current.path, displayNode(parent)];
        if (parent === `claim:${targetClaimId}`) return nextPath;
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push({ node: parent, path: nextPath });
        }
      }
    }
    return null;
  };
  const nonPassClaimIds = claimResults
    .filter((claim) => claim.result !== 'PASS')
    .map((claim) => claim.claimId)
    .sort();
  for (const claimId of nonPassClaimIds) {
    for (const origin of origins) {
      const path = pathFromOriginToClaim(origin, claimId);
      if (path) {
        appendPath(origin, claimId, path);
        break;
      }
    }
  }

  const addOrigin = (origin) => {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const walk = (node, path, visited) => {
      if (visited.has(node)) return;
      const eligibleParents = sortedParents(node).filter((parent) => nodeResult(parent) !== 'PASS');
      if (
        traversalSteps >= maximumSteps
        || path.length >= SCHEMA_LIMITS.maxInvalidationPathLength
      ) {
        if (eligibleParents.length > 0) truncated = true;
        return;
      }
      traversalSteps += 1;
      for (const parent of eligibleParents) {
        const nextPath = [...path, displayNode(parent)];
        if (parent.startsWith('claim:')) {
          const claimId = parent.slice('claim:'.length);
          if (!appendPath(origin, claimId, nextPath)) return;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(node);
        walk(parent, nextPath, nextVisited);
        if (truncated) return;
      }
    };
    walk(start, [`${origin.originType}:${origin.originId}`], new Set());
  };
  for (const origin of origins) {
    addOrigin(origin);
    if (truncated) break;
  }

  const undeterminedClaimIds = new Set();
  for (const origin of origins.filter((entry) => !isValidUtcMillis(entry.originDetails.invalidatedAtMs))) {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const queue = [start];
    const visited = new Set([start]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const parent of sortedParents(queue[cursor])) {
        if (nodeResult(parent) === 'PASS' || visited.has(parent)) continue;
        visited.add(parent);
        if (parent.startsWith('claim:')) undeterminedClaimIds.add(parent.slice('claim:'.length));
        queue.push(parent);
      }
    }
  }

  return {
    paths: paths.sort((left, right) => (
      compareCanonical(left.originType, right.originType)
      || compareCanonical(left.originId, right.originId)
      || compareCanonical(left.path.join('>'), right.path.join('>'))
    )),
    truncated,
    traversalSteps,
    undeterminedClaimIds: stableUnique([...undeterminedClaimIds]),
  };
}

function buildRecommendations(claimResults) {
  return claimResults
    .filter((claim) => claim.result !== 'PASS')
    .map((claim) => deepFreeze({
      claimId: claim.claimId,
      result: claim.result,
      invariantId: claim.invariantProjection.invariantId,
      eventRecommendation: {
        type: claim.invariantProjection.eventRecommendationType,
        ownerId: claim.resultConsumerOwner.ownerId,
      },
      incidentRecommendation: {
        type: claim.invariantProjection.incidentRecommendationType,
        ownerId: claim.resultConsumerOwner.ownerId,
      },
      commandAuthority: 'NONE',
    }))
    .sort((left, right) => compareCanonical(left.claimId, right.claimId));
}

function coverageFrom(packet, claimResultById = new Map()) {
  const claims = Array.isArray(packet.claims) ? packet.claims : [];
  const declared = Array.isArray(packet.mandatoryClaimIds) ? packet.mandatoryClaimIds : [];
  const claimIds = new Set(claims.map((claim) => claim?.claimId).filter((id) => typeof id === 'string'));
  const declaredIds = new Set(declared);
  const presentClaimIds = stableUnique(REQUIRED_MANDATORY_CLAIM_IDS.filter((claimId) => (
    claimIds.has(claimId) && declaredIds.has(claimId) && (claimResultById.size === 0 || claimResultById.has(claimId))
  )));
  return {
    requiredClaimIds: [...REQUIRED_MANDATORY_CLAIM_IDS],
    presentClaimIds,
    missingClaimIds: stableUnique(REQUIRED_MANDATORY_CLAIM_IDS.filter((claimId) => !presentClaimIds.includes(claimId))),
    unexpectedClaimIds: stableUnique([
      ...declared.filter((claimId) => !REQUIRED_MANDATORY_CLAIM_IDS.includes(claimId)),
      ...claims.map((claim) => claim?.claimId).filter((claimId) => typeof claimId === 'string' && !REQUIRED_MANDATORY_CLAIM_IDS.includes(claimId)),
    ]),
  };
}

function evaluateCaptured(packet, s1Projection, nowMs) {
  const packetIssues = validateAssuranceCasePacket(packet);
  const s1ProjectionIssues = validateS1AssumptionProjection(s1Projection);
  if (packetIssues.some((entry) => entry.code.startsWith('MANDATORY_'))) {
    return invalidResult({
      nowMs,
      status: 'FAIL',
      reasonCodes: ['MANDATORY_CLAIM_COVERAGE_FAILURE'],
      packetIssues,
      s1ProjectionIssues,
      mandatoryCoverage: coverageFrom(packet),
    });
  }
  if (packetIssues.some(isFatalPacketIssue)) {
    return invalidResult({ nowMs, reasonCodes: ['ASSURANCE_PACKET_INVALID'], packetIssues, s1ProjectionIssues });
  }
  if (s1ProjectionIssues.some(isFatalS1ProjectionIssue)) {
    return invalidResult({ nowMs, reasonCodes: ['S1_PROJECTION_INVALID'], packetIssues, s1ProjectionIssues });
  }
  if (packet.generatedAtMs > nowMs) {
    return invalidResult({ nowMs, reasonCodes: ['PACKET_GENERATED_IN_FUTURE'], packetIssues, s1ProjectionIssues });
  }
  if (s1Projection.evaluatedAtMs > nowMs) {
    return invalidResult({ nowMs, reasonCodes: ['S1_PROJECTION_FROM_FUTURE'], packetIssues, s1ProjectionIssues });
  }

  const assumptionResults = normalizeAssumptionResults(s1Projection, nowMs);
  const { evidenceResults, claimResults } = buildGraphEvaluator(packet, assumptionResults, nowMs);
  const claimResultById = new Map(claimResults.map((claim) => [claim.claimId, claim]));
  const baseStatus = statusFrom(REQUIRED_MANDATORY_CLAIM_IDS.map((claimId) => claimResultById.get(claimId)?.result ?? 'FAIL'));
  const invalidation = collectInvalidationPaths(packet, claimResults, evidenceResults, assumptionResults, nowMs);
  let status = invalidation.truncated && baseStatus === 'PASS' ? 'UNKNOWN' : baseStatus;
  const reasonCodes = [];
  if (status === 'PASS') reasonCodes.push('ALL_MANDATORY_DERIVED_CLAIMS_PASS');
  if (claimResults.some((claim) => claim.result === 'FAIL')) reasonCodes.push('DERIVED_CLAIM_FAILED');
  if (claimResults.some((claim) => claim.result === 'UNKNOWN')) reasonCodes.push('DERIVED_CLAIM_UNKNOWN');
  if (s1Projection.evaluatedAtMs !== nowMs) reasonCodes.push('S1_PROJECTION_NOT_CURRENT');
  if (packetIssues.length > 0) reasonCodes.push('EVALUATED_PACKET_ISSUES_PRESENT');
  if (invalidation.truncated) reasonCodes.push('INVALIDATION_PATHS_TRUNCATED');
  if (invalidation.paths.some((path) => path.propagationSloMet === false)) reasonCodes.push('PROPAGATION_SLO_MISSED');
  if (invalidation.paths.some((path) => path.propagationSloMet === null)) reasonCodes.push('PROPAGATION_SLO_UNDETERMINED');

  const affectedClaimDeadlines = claimResults
    .filter((claim) => claim.result !== 'PASS')
    .map((claim) => {
      const computedAssuranceDueAtMs = isValidUtcMillis(claim.invalidatedAtMs)
        ? claim.invalidatedAtMs + claim.assuranceSloMs
        : null;
      const assuranceDueAtMs = isValidUtcMillis(computedAssuranceDueAtMs)
        ? computedAssuranceDueAtMs
        : null;
      const completedWithinDeclaredSlo = !isValidUtcMillis(assuranceDueAtMs)
        ? null
        : nowMs > assuranceDueAtMs
          ? false
          : invalidation.undeterminedClaimIds.includes(claim.claimId)
            ? null
            : true;
      return deepFreeze({
        claimId: claim.claimId,
        invalidatedAtMs: claim.invalidatedAtMs,
        assuranceSloMs: claim.assuranceSloMs,
        assuranceDueAtMs,
        completedWithinDeclaredSlo,
      });
    })
    .sort((left, right) => compareCanonical(left.claimId, right.claimId));
  const earliestInvalidatedAtMs = minimumUtcMillis(affectedClaimDeadlines.map((entry) => entry.invalidatedAtMs));
  const recomputationApplicable = status !== 'PASS';
  const assuranceDueAtMs = recomputationApplicable
    ? minimumUtcMillis(affectedClaimDeadlines.map((entry) => entry.assuranceDueAtMs))
    : null;
  const completedWithinDeclaredSlo = !recomputationApplicable
    ? true
    : affectedClaimDeadlines.some((entry) => entry.completedWithinDeclaredSlo === false)
      ? false
      : affectedClaimDeadlines.length === 0 || affectedClaimDeadlines.some((entry) => entry.completedWithinDeclaredSlo === null)
        ? null
        : true;
  if (completedWithinDeclaredSlo === false) reasonCodes.push('ASSURANCE_SLO_MISSED');
  if (completedWithinDeclaredSlo === null) reasonCodes.push('ASSURANCE_SLO_UNDETERMINED');
  if (packetIssues.length > 0 && status === 'PASS') {
    status = 'UNKNOWN';
    reasonCodes.push('UNHANDLED_PACKET_ISSUE');
  }
  const diagnosticClaim = claimResultById.get('PA-S4-CLAIM-013');

  return deepFreeze({
    schemaVersion: ASSURANCE_CASE_EVALUATION_VERSION,
    evaluatedAtMs: nowMs,
    status,
    truthLabel: 'SYNTHETIC_ONLY',
    authorityEffect: 'NONE',
    runtimeProjectionOwner: 'I08.machine-supervisor',
    machineResponseOwner: 'EXISTING_CANONICAL_OWNERS',
    reasonCodes: stableUnique(reasonCodes),
    packetIssues,
    s1ProjectionIssues,
    mandatoryCoverage: coverageFrom(packet, claimResultById),
    evidenceResults,
    assumptionResults,
    claimResults,
    invalidationPaths: invalidation.paths,
    invalidationTruncated: invalidation.truncated,
    recommendations: buildRecommendations(claimResults),
    diagnosticPlane: {
      posture: packet.diagnosticPlane.posture,
      status: diagnosticClaim?.result ?? 'UNKNOWN',
      reasonCodes: diagnosticClaim?.reasonCodes ?? ['DIAGNOSTIC_CLAIM_MISSING'],
      ...Object.fromEntries(Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).map((field) => [
        field,
        stableUnique(packet.diagnosticPlane[field]),
      ])),
    },
    recomputation: {
      applicable: recomputationApplicable,
      originInvalidatedAtMs: earliestInvalidatedAtMs,
      logicalCompletedAtMs: nowMs,
      assuranceSloMs: packet.propagationPolicy.assuranceSloMs,
      assuranceDueAtMs: isValidUtcMillis(assuranceDueAtMs) ? assuranceDueAtMs : null,
      completedWithinDeclaredSlo,
      affectedClaimDeadlines,
    },
    safetyBoundary: {
      readOnly: true,
      supportUsableForNewAction: status === 'PASS' && packetIssues.length === 0 && !invalidation.truncated,
      doesNotBlockCanonicalRiskReduction: true,
      riskReductionAvailabilityOwner: 'EXISTING_CANONICAL_OWNERS',
      llmMayExplain: true,
      llmMayRestoreSupport: false,
      prohibitedCommands: [...PROHIBITED_ASSURANCE_COMMANDS],
      commandsIssued: 0,
    },
  });
}

export function evaluateAssuranceCase(packetInput, s1ProjectionInput, nowMs) {
  if (!isValidUtcMillis(nowMs)) return invalidResult({ nowMs, reasonCodes: ['CLOCK_INVALID'] });
  const packetCapture = capturePlainData(packetInput);
  if (!packetCapture.ok) return invalidResult({ nowMs, reasonCodes: ['ASSURANCE_PACKET_CAPTURE_FAILED'], packetIssues: packetCapture.issues });
  const s1Capture = capturePlainData(s1ProjectionInput);
  if (!s1Capture.ok) return invalidResult({ nowMs, reasonCodes: ['S1_PROJECTION_CAPTURE_FAILED'], s1ProjectionIssues: s1Capture.issues });
  try {
    return evaluateCaptured(packetCapture.value, s1Capture.value, nowMs);
  } catch {
    return invalidResult({ nowMs, reasonCodes: ['ASSURANCE_EVALUATION_FAILED_CLOSED'] });
  }
}
