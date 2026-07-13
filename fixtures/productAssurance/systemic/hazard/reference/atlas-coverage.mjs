import {
  OPERATION_CLASSES,
  REQUIRED_FAILURE_FAMILY_IDS,
  computeAtlasDenominatorFingerprint,
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

const validClock = (nowMs) => (
  Number.isSafeInteger(nowMs) && nowMs >= MIN_UTC_MS && nowMs <= MAX_UTC_MS
);
const stableUnique = (values) => Object.freeze([...new Set(values)].sort());
const pairKey = (operationClass, failureFamilyId) => `${operationClass}|${failureFamilyId}`;
const roundedPercentage = (covered, expected) => (
  expected === 0 ? null : Math.round((covered * 10_000) / expected) / 100
);

function invalidResult(nowMs, reasonCode, packetIssues = []) {
  return deepFreeze({
    schemaVersion: 'pa.s1.failure-atlas-coverage.v1',
    evaluatedAtMs: validClock(nowMs) ? nowMs : null,
    status: 'UNKNOWN',
    authorityEffect: 'NONE',
    sourceBasis: 'EXPECTED_RELEASE_MANIFEST',
    reviewState: 'UNKNOWN',
    reasonCodes: [reasonCode],
    packetIssues,
    liveOperationClasses: [...OPERATION_CLASSES],
    declaredLiveOperationClasses: [],
    missingOperationClasses: [...OPERATION_CLASSES],
    requiredFailureFamilyIds: [...REQUIRED_FAILURE_FAMILY_IDS],
    registeredFailureFamilyIds: [],
    denominatorPairs: [],
    coveredPairs: [],
    missingDecisionPairs: [],
    duplicateDecisionPairs: [],
    missingAtlasPairs: [],
    duplicateAtlasPairs: [],
    unexpectedAtlasPairs: [],
    unrepresentedRequiredFailureFamilyIds: [...REQUIRED_FAILURE_FAMILY_IDS],
    operationCoverage: [],
    failureFamilyCoverage: [],
    expectedCount: 0,
    coveredCount: 0,
    coveragePercent: null,
    coverageComplete: null,
  });
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

export function evaluateFailureAtlasCoverage(packet, nowMs) {
  if (!validClock(nowMs)) return invalidResult(nowMs, 'CLOCK_INVALID');
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return invalidResult(nowMs, 'PACKET_INVALID');
  }

  const packetIssues = validateHazardAssurancePacket(packet);
  const manifest = packet.atlasManifest;
  if (!manifest || !Array.isArray(manifest.liveOperationClasses) || !Array.isArray(manifest.coverageDecisions)) {
    return invalidResult(nowMs, 'ATLAS_MANIFEST_INVALID', packetIssues);
  }
  if (!Array.isArray(packet.failureFamilies) || !Array.isArray(packet.atlasRows)) {
    return invalidResult(nowMs, 'ATLAS_INPUT_INVALID', packetIssues);
  }

  const liveOperationClasses = [...OPERATION_CLASSES];
  const declaredLiveOperationClasses = stableUnique(
    manifest.liveOperationClasses.filter((operationClass) => typeof operationClass === 'string'),
  );
  const missingOperationClasses = OPERATION_CLASSES.filter(
    (operationClass) => !declaredLiveOperationClasses.includes(operationClass),
  );
  const registeredFailureFamilyIds = stableUnique(
    packet.failureFamilies
      .map((family) => family?.failureFamilyId)
      .filter((failureFamilyId) => typeof failureFamilyId === 'string'),
  );
  const gridPairs = liveOperationClasses.flatMap((operationClass) => (
    registeredFailureFamilyIds.map((failureFamilyId) => pairKey(operationClass, failureFamilyId))
  )).sort();
  const gridPairSet = new Set(gridPairs);

  const validDecisions = manifest.coverageDecisions.filter((decision) => (
    decision
    && typeof decision.operationClass === 'string'
    && typeof decision.failureFamilyId === 'string'
    && gridPairSet.has(pairKey(decision.operationClass, decision.failureFamilyId))
  ));
  const decisionKeys = validDecisions.map((decision) => pairKey(decision.operationClass, decision.failureFamilyId));
  const decisionKeySet = new Set(decisionKeys);
  const missingDecisionPairs = gridPairs.filter((pair) => !decisionKeySet.has(pair));
  const duplicateDecisionPairs = duplicates(decisionKeys);
  const denominatorPairs = stableUnique(
    validDecisions
      .filter((decision) => decision.disposition === 'EXPECTED')
      .map((decision) => pairKey(decision.operationClass, decision.failureFamilyId)),
  );
  const denominatorSet = new Set(denominatorPairs);

  const releaseRows = packet.atlasRows.filter((row) => row?.releaseId === packet.release?.releaseId);
  const rowPairs = releaseRows
    .filter((row) => typeof row.operationClass === 'string' && typeof row.failureFamilyId === 'string')
    .map((row) => pairKey(row.operationClass, row.failureFamilyId));
  const duplicateAtlasPairs = duplicates(rowPairs.filter((pair) => denominatorSet.has(pair)));
  const rowPairSet = new Set(rowPairs);
  const coveredPairs = denominatorPairs.filter((pair) => rowPairSet.has(pair));
  const missingAtlasPairs = denominatorPairs.filter((pair) => !rowPairSet.has(pair));
  const unexpectedAtlasPairs = stableUnique(rowPairs.filter((pair) => !denominatorSet.has(pair)));

  const unrepresentedRequiredFailureFamilyIds = REQUIRED_FAILURE_FAMILY_IDS.filter((failureFamilyId) => (
    !denominatorPairs.some((pair) => pair.endsWith(`|${failureFamilyId}`))
  ));
  const missingRequiredFailureFamilyIds = REQUIRED_FAILURE_FAMILY_IDS.filter((failureFamilyId) => (
    !registeredFailureFamilyIds.includes(failureFamilyId)
  ));
  const operationWithoutDenominator = liveOperationClasses.filter((operationClass) => (
    !denominatorPairs.some((pair) => pair.startsWith(`${operationClass}|`))
  ));

  const reviewComplete = manifest.review?.state === 'OWNER_REVIEWED'
    && typeof manifest.review.reviewerId === 'string'
    && Number.isSafeInteger(manifest.review.reviewedAtMs)
    && manifest.review.reviewedAtMs <= nowMs
    && typeof manifest.review.evidenceId === 'string'
    && manifest.review.evidenceState !== 'UNTESTED'
    && manifest.denominatorFingerprint === computeAtlasDenominatorFingerprint(
      manifest.liveOperationClasses,
      manifest.coverageDecisions,
    )
    && manifest.review.reviewedManifestVersion === manifest.version
    && manifest.review.reviewedDenominatorFingerprint === manifest.denominatorFingerprint
    && manifest.review.reviewedOperationPolicyRevision === packet.release?.operationPolicyRevision
    && manifest.review.reviewedReleaseId === packet.release?.releaseId;
  const denominatorFinite = manifest.finiteDenominator === true && gridPairs.length > 0;
  const releaseAligned = manifest.releaseId === packet.release?.releaseId;

  const reasonCodes = [];
  if (!reviewComplete) reasonCodes.push('OWNER_REVIEW_MISSING_OR_INCOHERENT');
  if (!denominatorFinite) reasonCodes.push('FINITE_DENOMINATOR_MISSING');
  if (!releaseAligned) reasonCodes.push('RELEASE_ID_MISMATCH');
  if (missingOperationClasses.length > 0) reasonCodes.push('REQUIRED_OPERATION_CLASS_MISSING');
  if (missingRequiredFailureFamilyIds.length > 0) reasonCodes.push('REQUIRED_FAILURE_FAMILY_MISSING');
  if (missingDecisionPairs.length > 0) reasonCodes.push('EXPECTED_GRID_DECISION_MISSING');
  if (duplicateDecisionPairs.length > 0) reasonCodes.push('EXPECTED_GRID_DECISION_DUPLICATED');
  if (unrepresentedRequiredFailureFamilyIds.length > 0) reasonCodes.push('REQUIRED_FAILURE_FAMILY_NOT_IN_DENOMINATOR');
  if (operationWithoutDenominator.length > 0) reasonCodes.push('LIVE_OPERATION_CLASS_WITHOUT_DENOMINATOR');
  if (missingAtlasPairs.length > 0) reasonCodes.push('EXPECTED_ATLAS_ROW_MISSING');
  if (duplicateAtlasPairs.length > 0) reasonCodes.push('EXPECTED_ATLAS_ROW_DUPLICATED');
  if (unexpectedAtlasPairs.length > 0) reasonCodes.push('ATLAS_ROW_OUTSIDE_EXPECTED_DENOMINATOR');

  const severePacketIssues = packetIssues.filter((entry) => entry.code !== 'COVERAGE_PAIR_DUPLICATE');
  if (severePacketIssues.length > 0) reasonCodes.push('PACKET_INVALID');

  let status = 'PASS';
  if (!reviewComplete || !denominatorFinite || severePacketIssues.length > 0) status = 'UNKNOWN';
  else if (reasonCodes.length > 0) status = 'FAIL';
  if (status === 'PASS') reasonCodes.push('EXPECTED_ATLAS_DENOMINATOR_COVERED');

  const operationCoverage = liveOperationClasses.map((operationClass) => {
    const expectedPairs = denominatorPairs.filter((pair) => pair.startsWith(`${operationClass}|`));
    const unresolvedDecisionPairs = missingDecisionPairs.filter((pair) => pair.startsWith(`${operationClass}|`));
    const coveredForOperation = expectedPairs.filter((pair) => rowPairSet.has(pair));
    const expectedCount = expectedPairs.length + unresolvedDecisionPairs.length;
    return deepFreeze({
      operationClass,
      expectedCount,
      coveredCount: coveredForOperation.length,
      coveragePercent: unresolvedDecisionPairs.length > 0
        ? null
        : roundedPercentage(coveredForOperation.length, expectedPairs.length),
      missingPairs: expectedPairs.filter((pair) => !rowPairSet.has(pair)),
      unresolvedDecisionPairs,
    });
  });
  const failureFamilyCoverage = registeredFailureFamilyIds.map((failureFamilyId) => {
    const expectedPairs = denominatorPairs.filter((pair) => pair.endsWith(`|${failureFamilyId}`));
    const unresolvedDecisionPairs = missingDecisionPairs.filter((pair) => pair.endsWith(`|${failureFamilyId}`));
    const coveredForFamily = expectedPairs.filter((pair) => rowPairSet.has(pair));
    const expectedCount = expectedPairs.length + unresolvedDecisionPairs.length;
    return deepFreeze({
      failureFamilyId,
      expectedCount,
      coveredCount: coveredForFamily.length,
      coveragePercent: unresolvedDecisionPairs.length > 0
        ? null
        : roundedPercentage(coveredForFamily.length, expectedPairs.length),
      missingPairs: expectedPairs.filter((pair) => !rowPairSet.has(pair)),
      unresolvedDecisionPairs,
    });
  });

  const expectedCount = denominatorPairs.length + missingDecisionPairs.length;
  return deepFreeze({
    schemaVersion: 'pa.s1.failure-atlas-coverage.v1',
    evaluatedAtMs: nowMs,
    status,
    authorityEffect: 'NONE',
    sourceBasis: 'EXPECTED_RELEASE_MANIFEST',
    reviewState: reviewComplete ? 'OWNER_REVIEWED' : 'UNKNOWN',
    reasonCodes: stableUnique(reasonCodes),
    packetIssues,
    liveOperationClasses,
    declaredLiveOperationClasses,
    missingOperationClasses: Object.freeze(missingOperationClasses),
    requiredFailureFamilyIds: [...REQUIRED_FAILURE_FAMILY_IDS],
    registeredFailureFamilyIds,
    denominatorPairs,
    coveredPairs: stableUnique(coveredPairs),
    missingDecisionPairs: Object.freeze(missingDecisionPairs),
    duplicateDecisionPairs: Object.freeze(duplicateDecisionPairs),
    missingAtlasPairs: Object.freeze(missingAtlasPairs),
    duplicateAtlasPairs: Object.freeze(duplicateAtlasPairs),
    unexpectedAtlasPairs,
    unrepresentedRequiredFailureFamilyIds: Object.freeze(unrepresentedRequiredFailureFamilyIds),
    operationCoverage,
    failureFamilyCoverage,
    expectedCount,
    coveredCount: coveredPairs.length,
    coveragePercent: missingDecisionPairs.length > 0
      ? null
      : roundedPercentage(coveredPairs.length, denominatorPairs.length),
    coverageComplete: status === 'UNKNOWN' ? null : status === 'PASS',
  });
}
