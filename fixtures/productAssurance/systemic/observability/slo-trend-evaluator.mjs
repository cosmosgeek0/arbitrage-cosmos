import {
  assertArray,
  assertBoolean,
  assertBoundedString,
  assertClosedRecord,
  assertEnum,
  assertFiniteNumber,
  assertGitSha,
  assertSafeInteger,
  assertSha256,
  assertUnique,
  compareAscii,
  deepFreeze,
  roundedPercent,
  roundedRatio,
  sortedUniqueStrings,
  strongestResult,
} from './reference-helpers.mjs';
import {
  deriveSloDefinitionSha256,
  SLO_CATEGORIES,
  validateSloCatalog,
} from './slo-catalog-contract.mjs';

const SCHEMA_VERSION = 'slo-trend.v1';
const TRUTH_LABELS = ['LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN'];
const STATISTICS = ['P50', 'P95', 'P99', 'GOOD_EVENT_PERCENTAGE'];

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw new TypeError(`${path} is not a stable identifier`);
}

function definitionKey(value) {
  return `${value.sloId}@${value.version}`;
}

function windowIntervalKey(value) {
  return JSON.stringify([value.sloId, value.sloVersion, value.releaseSha, value.startMs, value.endMs]);
}

function validateDefinition(value, index) {
  const path = `definitions[${index}]`;
  assertClosedRecord(value, path, [
    'sloId', 'version', 'ownerId', 'category', 'criticality', 'unit', 'windowDurationMs',
    'maximumEvidenceAgeMs', 'minimumSampleCount', 'percentileMethod', 'evaluationStatistic',
    'comparator', 'threshold', 'objectivePercent', 'dependentCapabilityIds',
    'recommendedFailurePosture', 'effectPolicy',
  ]);
  assertIdentifier(value.sloId, `${path}.sloId`);
  assertSafeInteger(value.version, `${path}.version`, 1, 1_000_000);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertEnum(value.category, SLO_CATEGORIES, `${path}.category`);
  assertEnum(value.criticality, ['SAFETY_TRUTH', 'AVAILABILITY'], `${path}.criticality`);
  assertBoundedString(value.unit, `${path}.unit`, 1, 40);
  assertSafeInteger(value.windowDurationMs, `${path}.windowDurationMs`, 1, 2_592_000_000);
  assertSafeInteger(value.maximumEvidenceAgeMs, `${path}.maximumEvidenceAgeMs`, 1, 2_592_000_000);
  assertSafeInteger(value.minimumSampleCount, `${path}.minimumSampleCount`, 1, 2048);
  assertEnum(value.percentileMethod, ['NEAREST_RANK'], `${path}.percentileMethod`);
  assertEnum(value.evaluationStatistic, STATISTICS, `${path}.evaluationStatistic`);
  assertEnum(value.comparator, ['LTE', 'GTE'], `${path}.comparator`);
  assertFiniteNumber(value.threshold, `${path}.threshold`);
  assertFiniteNumber(value.objectivePercent, `${path}.objectivePercent`, Number.MIN_VALUE, 100);
  assertArray(value.dependentCapabilityIds, `${path}.dependentCapabilityIds`, 32);
  value.dependentCapabilityIds.forEach((entry, child) => assertIdentifier(entry, `${path}.dependentCapabilityIds[${child}]`));
  assertUnique(value.dependentCapabilityIds, (entry) => entry, `${path}.dependentCapabilityIds`);
  assertEnum(value.recommendedFailurePosture, ['DEGRADED', 'BLOCKED'], `${path}.recommendedFailurePosture`);
  assertClosedRecord(value.effectPolicy, `${path}.effectPolicy`, [
    'authority', 'mayMutateCapital', 'mayMutateControls', 'mayExecuteRepair', 'riskReductionMustRemainAvailable',
  ]);
  assertEnum(value.effectPolicy.authority, ['EVIDENCE_ONLY'], `${path}.effectPolicy.authority`);
  for (const key of ['mayMutateCapital', 'mayMutateControls', 'mayExecuteRepair', 'riskReductionMustRemainAvailable']) {
    assertBoolean(value.effectPolicy[key], `${path}.effectPolicy.${key}`);
  }
  if (value.effectPolicy.mayMutateCapital || value.effectPolicy.mayMutateControls || value.effectPolicy.mayExecuteRepair
      || !value.effectPolicy.riskReductionMustRemainAvailable) {
    throw new TypeError(`${path}.effectPolicy violates the evidence-only authority boundary`);
  }
}

function validateWindow(value, index) {
  const path = `windows[${index}]`;
  assertClosedRecord(value, path, [
    'windowId', 'sloId', 'sloVersion', 'releaseSha', 'startMs', 'endMs',
    'evidenceObservedAtMs', 'sourceTruthLabel', 'canonicalEvidenceRefs', 'samples',
  ]);
  assertIdentifier(value.windowId, `${path}.windowId`);
  assertIdentifier(value.sloId, `${path}.sloId`);
  assertSafeInteger(value.sloVersion, `${path}.sloVersion`, 1, 1_000_000);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertSafeInteger(value.startMs, `${path}.startMs`);
  assertSafeInteger(value.endMs, `${path}.endMs`);
  if (value.startMs >= value.endMs) throw new TypeError(`${path} must have startMs < endMs`);
  assertSafeInteger(value.evidenceObservedAtMs, `${path}.evidenceObservedAtMs`);
  assertEnum(value.sourceTruthLabel, TRUTH_LABELS, `${path}.sourceTruthLabel`);
  assertClosedRecord(value.canonicalEvidenceRefs, `${path}.canonicalEvidenceRefs`, [
    'invariantResultId', 'materialEventId', 'evidenceIds', 'correlationId', 'incidentId',
  ]);
  assertIdentifier(value.canonicalEvidenceRefs.invariantResultId, `${path}.canonicalEvidenceRefs.invariantResultId`);
  assertIdentifier(value.canonicalEvidenceRefs.materialEventId, `${path}.canonicalEvidenceRefs.materialEventId`);
  assertArray(value.canonicalEvidenceRefs.evidenceIds, `${path}.canonicalEvidenceRefs.evidenceIds`, 32);
  if (value.canonicalEvidenceRefs.evidenceIds.length === 0) {
    throw new TypeError(`${path}.canonicalEvidenceRefs.evidenceIds must not be empty`);
  }
  value.canonicalEvidenceRefs.evidenceIds.forEach((entry, child) => (
    assertIdentifier(entry, `${path}.canonicalEvidenceRefs.evidenceIds[${child}]`)
  ));
  assertUnique(value.canonicalEvidenceRefs.evidenceIds, (entry) => entry, `${path}.canonicalEvidenceRefs.evidenceIds`);
  assertIdentifier(value.canonicalEvidenceRefs.correlationId, `${path}.canonicalEvidenceRefs.correlationId`);
  if (value.canonicalEvidenceRefs.incidentId !== null) {
    assertIdentifier(value.canonicalEvidenceRefs.incidentId, `${path}.canonicalEvidenceRefs.incidentId`);
  }
  assertArray(value.samples, `${path}.samples`, 2048);
  value.samples.forEach((sample, child) => {
    const samplePath = `${path}.samples[${child}]`;
    assertClosedRecord(sample, samplePath, ['sampleId', 'observedAtMs', 'value', 'good']);
    assertIdentifier(sample.sampleId, `${samplePath}.sampleId`);
    assertSafeInteger(sample.observedAtMs, `${samplePath}.observedAtMs`);
    assertFiniteNumber(sample.value, `${samplePath}.value`);
    assertBoolean(sample.good, `${samplePath}.good`);
  });
  assertUnique(value.samples, (sample) => sample.sampleId, `${path}.samples`);
}

function validateInput(input) {
  assertClosedRecord(input, 'input', [
    'schemaVersion', 'nowMs', 'releaseSha', 'catalogVerificationMaximumAgeMs',
    'catalogDigestVerification', 'definitions', 'windows',
  ]);
  assertEnum(input.schemaVersion, [SCHEMA_VERSION], 'input.schemaVersion');
  assertSafeInteger(input.nowMs, 'input.nowMs');
  assertGitSha(input.releaseSha, 'input.releaseSha');
  assertSafeInteger(input.catalogVerificationMaximumAgeMs, 'input.catalogVerificationMaximumAgeMs', 1, 2_592_000_000);
  assertClosedRecord(input.catalogDigestVerification, 'input.catalogDigestVerification', [
    'result', 'verifiedCatalogSha256', 'verifiedCatalogId', 'verifiedCatalogRevision',
    'verifiedReleaseSha', 'verifierOwnerId', 'verifierReferenceId', 'verifiedAtMs',
  ]);
  const verification = input.catalogDigestVerification;
  assertEnum(verification.result, ['PASS', 'FAIL', 'UNKNOWN'], 'input.catalogDigestVerification.result');
  assertSha256(verification.verifiedCatalogSha256, 'input.catalogDigestVerification.verifiedCatalogSha256');
  assertIdentifier(verification.verifiedCatalogId, 'input.catalogDigestVerification.verifiedCatalogId');
  assertSafeInteger(verification.verifiedCatalogRevision, 'input.catalogDigestVerification.verifiedCatalogRevision', 1, 1_000_000);
  assertGitSha(verification.verifiedReleaseSha, 'input.catalogDigestVerification.verifiedReleaseSha');
  assertIdentifier(verification.verifierOwnerId, 'input.catalogDigestVerification.verifierOwnerId');
  assertIdentifier(verification.verifierReferenceId, 'input.catalogDigestVerification.verifierReferenceId');
  assertSafeInteger(verification.verifiedAtMs, 'input.catalogDigestVerification.verifiedAtMs');
  assertArray(input.definitions, 'input.definitions', 128);
  if (input.definitions.length === 0) throw new TypeError('input.definitions must not be empty');
  input.definitions.forEach(validateDefinition);
  assertUnique(input.definitions, definitionKey, 'input.definitions');
  assertArray(input.windows, 'input.windows', 512);
  input.windows.forEach(validateWindow);
  assertUnique(input.windows, (value) => value.windowId, 'input.windows');
  assertUnique(input.windows, windowIntervalKey, 'input.windows semantic intervals');
}

export function nearestRankPercentile(values, percentile) {
  assertArray(values, 'values', 2048);
  if (values.length === 0) return null;
  assertFiniteNumber(percentile, 'percentile', Number.MIN_VALUE, 100);
  const sorted = values.map((value, index) => {
    assertFiniteNumber(value, `values[${index}]`);
    return value;
  }).sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function compareThreshold(value, comparator, threshold) {
  return comparator === 'LTE' ? value <= threshold : value >= threshold;
}

function evaluateWindow(definition, window, releaseSha, nowMs) {
  const historicalReasons = [];
  const currentReasons = [];
  if (window.releaseSha !== releaseSha) historicalReasons.push('SLO_WINDOW_RELEASE_MISMATCH');
  if (window.sloVersion !== definition.version) historicalReasons.push('SLO_DEFINITION_VERSION_MISMATCH');
  if (window.endMs > nowMs) historicalReasons.push('SLO_WINDOW_NOT_CLOSED');
  if (window.endMs - window.startMs !== definition.windowDurationMs) historicalReasons.push('SLO_WINDOW_DURATION_MISMATCH');
  if (window.evidenceObservedAtMs > nowMs) historicalReasons.push('SLO_EVIDENCE_FROM_FUTURE');
  else if (nowMs - window.evidenceObservedAtMs > definition.maximumEvidenceAgeMs) currentReasons.push('SLO_EVIDENCE_EXPIRED');
  if (window.evidenceObservedAtMs < window.endMs) historicalReasons.push('SLO_EVIDENCE_BEFORE_WINDOW_END');
  const latestSampleAtMs = window.samples.length === 0
    ? null
    : Math.max(...window.samples.map((sample) => sample.observedAtMs));
  if (latestSampleAtMs !== null && window.evidenceObservedAtMs < latestSampleAtMs) {
    historicalReasons.push('SLO_EVIDENCE_BEFORE_LATEST_SAMPLE');
  }
  if (nowMs - window.endMs > definition.maximumEvidenceAgeMs) currentReasons.push('SLO_WINDOW_TOO_OLD_FOR_CURRENT');
  if (window.sourceTruthLabel === 'UNAVAILABLE' || window.sourceTruthLabel === 'UNKNOWN') {
    historicalReasons.push('SLO_SOURCE_TRUTH_UNAVAILABLE');
  }
  for (const sample of window.samples) {
    if (sample.observedAtMs < window.startMs || sample.observedAtMs > window.endMs) {
      historicalReasons.push('SLO_SAMPLE_OUTSIDE_WINDOW');
    }
  }
  if (window.samples.length < definition.minimumSampleCount) historicalReasons.push('SLO_INSUFFICIENT_SAMPLES');

  const values = window.samples.map((sample) => sample.value);
  const p50 = nearestRankPercentile(values, 50);
  const p95 = nearestRankPercentile(values, 95);
  const p99 = nearestRankPercentile(values, 99);
  const goodCount = window.samples.filter((sample) => sample.good).length;
  const totalCount = window.samples.length;
  const goodEventPercentage = roundedPercent(goodCount, totalCount);
  const measuredValue = definition.evaluationStatistic === 'P50' ? p50
    : definition.evaluationStatistic === 'P95' ? p95
      : definition.evaluationStatistic === 'P99' ? p99
        : goodEventPercentage;
  const actualBadRatio = totalCount === 0 ? null : (totalCount - goodCount) / totalCount;
  const allowedBadRatio = 1 - definition.objectivePercent / 100;
  const zeroErrorBudgetBreach = allowedBadRatio === 0 && actualBadRatio !== null && actualBadRatio > 0;
  const errorBudgetBurnRatio = actualBadRatio === null ? null
    : allowedBadRatio === 0 ? actualBadRatio === 0 ? 0 : null
      : roundedRatio(actualBadRatio, allowedBadRatio);

  const historicalUnknownReasonCodes = new Set([
    'SLO_WINDOW_RELEASE_MISMATCH', 'SLO_DEFINITION_VERSION_MISMATCH', 'SLO_WINDOW_NOT_CLOSED',
    'SLO_EVIDENCE_FROM_FUTURE', 'SLO_SOURCE_TRUTH_UNAVAILABLE', 'SLO_INSUFFICIENT_SAMPLES',
  ]);
  let historicalResult;
  if (historicalReasons.some((reason) => historicalUnknownReasonCodes.has(reason))) historicalResult = 'UNKNOWN';
  else if (historicalReasons.length > 0) historicalResult = 'FAIL';
  else if (measuredValue === null) {
    historicalReasons.push('SLO_MEASUREMENT_UNAVAILABLE');
    historicalResult = 'UNKNOWN';
  } else if (!compareThreshold(measuredValue, definition.comparator, definition.threshold)) {
    historicalReasons.push('SLO_THRESHOLD_BREACH');
    historicalResult = 'FAIL';
  } else if (zeroErrorBudgetBreach) {
    historicalReasons.push('SLO_ZERO_ERROR_BUDGET_BREACH');
    historicalResult = 'FAIL';
  } else if (errorBudgetBurnRatio !== null && errorBudgetBurnRatio > 1) {
    historicalReasons.push('SLO_ERROR_BUDGET_BURN');
    historicalResult = 'FAIL';
  } else historicalResult = 'PASS';

  const canonicalEvidenceComplete = historicalResult !== 'FAIL'
    || window.canonicalEvidenceRefs.incidentId !== null;
  if (!canonicalEvidenceComplete) historicalReasons.push('SLO_FAIL_INCIDENT_REF_MISSING');
  const currentResult = currentReasons.length > 0 ? 'UNKNOWN' : historicalResult;
  const reasonCodes = sortedUniqueStrings([...historicalReasons, ...currentReasons]);

  return {
    windowId: window.windowId,
    startMs: window.startMs,
    endMs: window.endMs,
    releaseSha: window.releaseSha,
    sourceTruthLabel: window.sourceTruthLabel,
    result: currentResult,
    currentResult,
    historicalResult,
    reasonCodes,
    currentReasonCodes: sortedUniqueStrings(currentReasons),
    historicalReasonCodes: sortedUniqueStrings(historicalReasons),
    truthReasonCodes: window.sourceTruthLabel === 'LIVE_PUBLIC' ? [] : [`NON_LIVE_TRUTH_${window.sourceTruthLabel}`],
    canonicalEvidenceComplete,
    canonicalEvidenceRefs: {
      invariantResultId: window.canonicalEvidenceRefs.invariantResultId,
      materialEventId: window.canonicalEvidenceRefs.materialEventId,
      evidenceIds: [...window.canonicalEvidenceRefs.evidenceIds].sort(compareAscii),
      correlationId: window.canonicalEvidenceRefs.correlationId,
      incidentId: window.canonicalEvidenceRefs.incidentId,
    },
    liveGreenEligible: currentResult === 'PASS'
      && canonicalEvidenceComplete
      && window.sourceTruthLabel === 'LIVE_PUBLIC',
    sampleCount: totalCount,
    goodEventCount: goodCount,
    goodEventPercentage,
    percentiles: { p50, p95, p99, method: 'NEAREST_RANK' },
    measuredStatistic: definition.evaluationStatistic,
    measuredValue,
    comparator: definition.comparator,
    threshold: definition.threshold,
    objectivePercent: definition.objectivePercent,
    errorBudgetBurnRatio,
    recommendedPosture: currentResult === 'FAIL' ? definition.recommendedFailurePosture
      : currentResult === 'UNKNOWN' ? 'CANONICAL_OWNER_REVIEW_REQUIRED'
        : 'PRESERVE_CURRENT_POSTURE',
    recommendedNoNewExposure: historicalResult === 'FAIL' && definition.criticality === 'SAFETY_TRUTH',
    authorityMutation: false,
    blocksRiskReduction: false,
  };
}

export function evaluateSloTrends(input, catalog) {
  validateInput(input);
  const catalogValidation = validateSloCatalog(catalog);
  const verification = input.catalogDigestVerification;
  const catalogBindingReasons = [];
  let catalogBindingResult = verification.result;
  if (verification.result === 'FAIL') catalogBindingReasons.push('SLO_CATALOG_DIGEST_VERIFICATION_FAILED');
  else if (verification.result === 'UNKNOWN') catalogBindingReasons.push('SLO_CATALOG_DIGEST_VERIFICATION_UNKNOWN');
  if (catalogValidation.derivedCatalogSha256 !== catalog.catalogSha256) {
    catalogBindingReasons.push('SLO_CATALOG_CANONICAL_DIGEST_MISMATCH');
    catalogBindingResult = 'FAIL';
  }
  if (verification.verifiedCatalogSha256 !== catalog.catalogSha256
      || verification.verifiedCatalogSha256 !== catalogValidation.derivedCatalogSha256) {
    catalogBindingReasons.push('SLO_CATALOG_VERIFIED_DIGEST_MISMATCH');
    catalogBindingResult = 'FAIL';
  }
  if (verification.verifiedCatalogId !== catalog.catalogId) {
    catalogBindingReasons.push('SLO_CATALOG_VERIFIED_ID_MISMATCH');
    catalogBindingResult = 'FAIL';
  }
  if (verification.verifiedCatalogRevision !== catalog.catalogRevision) {
    catalogBindingReasons.push('SLO_CATALOG_VERIFIED_REVISION_MISMATCH');
    catalogBindingResult = 'FAIL';
  }
  if (catalog.releaseSha !== input.releaseSha || verification.verifiedReleaseSha !== input.releaseSha) {
    catalogBindingReasons.push('SLO_CATALOG_RELEASE_MISMATCH');
    if (catalogBindingResult !== 'FAIL') catalogBindingResult = 'UNKNOWN';
  }
  if (verification.verifiedAtMs > input.nowMs) {
    catalogBindingReasons.push('SLO_CATALOG_VERIFICATION_FROM_FUTURE');
    if (catalogBindingResult !== 'FAIL') catalogBindingResult = 'UNKNOWN';
  } else if (input.nowMs - verification.verifiedAtMs > input.catalogVerificationMaximumAgeMs) {
    catalogBindingReasons.push('SLO_CATALOG_VERIFICATION_EXPIRED');
    if (catalogBindingResult !== 'FAIL') catalogBindingResult = 'UNKNOWN';
  }
  if (catalogValidation.missingCategories.length > 0) {
    catalogBindingReasons.push('SLO_CATALOG_CATEGORY_DENOMINATOR_INCOMPLETE');
    catalogBindingResult = 'FAIL';
  }
  if (catalogValidation.missingMetricFamilies.length > 0) {
    catalogBindingReasons.push('SLO_CATALOG_METRIC_REGISTRY_INCOMPLETE');
    catalogBindingResult = 'FAIL';
  }
  if (catalogValidation.metricBindingMismatches.length > 0) {
    catalogBindingReasons.push('SLO_CATALOG_METRIC_BINDING_MISMATCH');
    catalogBindingResult = 'FAIL';
  }

  const definitionByKey = new Map(input.definitions.map((definition) => [definitionKey(definition), definition]));
  const catalogByKey = new Map(catalog.slos.map((entry) => [definitionKey(entry), entry]));
  const catalogKeys = new Set(catalogByKey.keys());
  const missingCatalogSloKeys = catalog.slos
    .filter((entry) => !definitionByKey.has(definitionKey(entry)))
    .map(definitionKey)
    .sort(compareAscii);
  const extraDefinitionKeys = input.definitions
    .filter((definition) => !catalogKeys.has(definitionKey(definition)))
    .map(definitionKey)
    .sort(compareAscii);
  const definitionBindingMismatches = catalog.slos.flatMap((entry) => {
    const definition = definitionByKey.get(definitionKey(entry));
    if (definition === undefined) return [];
    const mismatches = [];
    if (definition.category !== entry.category) mismatches.push(`${definitionKey(entry)}|CATEGORY`);
    if (definition.ownerId !== entry.ownerId) mismatches.push(`${definitionKey(entry)}|OWNER`);
    if (deriveSloDefinitionSha256(definition) !== entry.definitionSha256) {
      mismatches.push(`${definitionKey(entry)}|DEFINITION_DIGEST`);
    }
    return mismatches;
  }).sort(compareAscii);
  const definitionBindingResult = extraDefinitionKeys.length > 0 || definitionBindingMismatches.length > 0
    ? 'FAIL'
    : missingCatalogSloKeys.length > 0 ? 'UNKNOWN'
      : 'PASS';
  const definitionBindingReasonCodes = [];
  if (missingCatalogSloKeys.length > 0) definitionBindingReasonCodes.push('CATALOG_SLO_DEFINITION_MISSING');
  if (extraDefinitionKeys.length > 0) definitionBindingReasonCodes.push('UNREGISTERED_SLO_DEFINITION');
  if (definitionBindingMismatches.length > 0) definitionBindingReasonCodes.push('CATALOG_SLO_DEFINITION_MISMATCH');

  const boundCatalogEntries = catalog.slos.filter((entry) => {
    const definition = definitionByKey.get(definitionKey(entry));
    return definition !== undefined
      && definition.category === entry.category
      && definition.ownerId === entry.ownerId
      && deriveSloDefinitionSha256(definition) === entry.definitionSha256;
  });
  const coveredCategories = SLO_CATEGORIES.filter((category) => (
    boundCatalogEntries.some((entry) => entry.category === category)
  ));
  const missingCategories = SLO_CATEGORIES.filter((category) => !coveredCategories.includes(category));
  const windowsByDefinition = new Map();
  for (const window of input.windows) {
    const key = `${window.sloId}@${window.sloVersion}`;
    const values = windowsByDefinition.get(key) ?? [];
    values.push(window);
    windowsByDefinition.set(key, values);
  }
  const unknownWindowIds = input.windows
    .filter((window) => !catalogKeys.has(`${window.sloId}@${window.sloVersion}`))
    .map((window) => window.windowId)
    .sort(compareAscii);

  const slos = catalog.slos.map((catalogEntry) => {
    const definition = definitionByKey.get(definitionKey(catalogEntry));
    const definitionMatches = definition !== undefined
      && definition.category === catalogEntry.category
      && definition.ownerId === catalogEntry.ownerId;
    if (!definitionMatches) {
      return {
        sloId: catalogEntry.sloId,
        version: catalogEntry.version,
        ownerId: catalogEntry.ownerId,
        category: catalogEntry.category,
        criticality: null,
        currentResult: 'UNKNOWN',
        latestHistoricalResult: 'UNKNOWN',
        reasonCodes: [definition === undefined ? 'CATALOG_SLO_DEFINITION_MISSING' : 'CATALOG_SLO_DEFINITION_MISMATCH'],
        historicalReasonCodes: [],
        latestWindowId: null,
        liveGreenEligible: false,
        historicalPassCount: 0,
        historicalBreachCount: 0,
        historicalUnknownCount: 0,
        historicalMetricBindings: catalogEntry.historicalMetricBindings.map((binding) => ({ ...binding })),
        windows: [],
        effectPolicy: null,
      };
    }
    const windows = (windowsByDefinition.get(definitionKey(definition)) ?? [])
      .map((window) => evaluateWindow(definition, window, input.releaseSha, input.nowMs))
      .sort((left, right) => left.endMs - right.endMs || compareAscii(left.windowId, right.windowId));
    if (windows.length === 0) {
      return {
        sloId: definition.sloId,
        version: definition.version,
        ownerId: definition.ownerId,
        category: definition.category,
        criticality: definition.criticality,
        currentResult: 'UNKNOWN',
        latestHistoricalResult: 'UNKNOWN',
        reasonCodes: ['EXPECTED_SLO_WINDOW_MISSING'],
        historicalReasonCodes: [],
        latestWindowId: null,
        liveGreenEligible: false,
        historicalPassCount: 0,
        historicalBreachCount: 0,
        historicalUnknownCount: 0,
        historicalMetricBindings: catalogEntry.historicalMetricBindings.map((binding) => ({ ...binding })),
        windows: [],
        effectPolicy: { ...definition.effectPolicy },
      };
    }
    const closedWindows = windows.filter((window) => window.endMs <= input.nowMs);
    const latestClosedWindow = closedWindows.at(-1) ?? null;
    return {
      sloId: definition.sloId,
      version: definition.version,
      ownerId: definition.ownerId,
      category: definition.category,
      criticality: definition.criticality,
      currentResult: latestClosedWindow?.result ?? 'UNKNOWN',
      latestHistoricalResult: latestClosedWindow?.historicalResult ?? 'UNKNOWN',
      reasonCodes: latestClosedWindow?.reasonCodes ?? ['EXPECTED_CLOSED_SLO_WINDOW_MISSING'],
      historicalReasonCodes: sortedUniqueStrings(closedWindows.flatMap((window) => window.historicalReasonCodes)),
      latestWindowId: latestClosedWindow?.windowId ?? null,
      liveGreenEligible: latestClosedWindow?.liveGreenEligible ?? false,
      historicalPassCount: closedWindows.filter((window) => window.historicalResult === 'PASS').length,
      historicalBreachCount: closedWindows.filter((window) => window.historicalResult === 'FAIL').length,
      historicalUnknownCount: closedWindows.filter((window) => window.historicalResult === 'UNKNOWN').length,
      historicalMetricBindings: catalogEntry.historicalMetricBindings.map((binding) => ({ ...binding })),
      windows,
      effectPolicy: { ...definition.effectPolicy },
    };
  }).sort((left, right) => compareAscii(`${left.sloId}@${left.version}`, `${right.sloId}@${right.version}`));

  let overallResult;
  if (catalogBindingResult === 'FAIL' || definitionBindingResult === 'FAIL' || unknownWindowIds.length > 0) {
    overallResult = 'FAIL';
  } else if (catalogBindingResult !== 'PASS' || definitionBindingResult !== 'PASS') {
    overallResult = 'UNKNOWN';
  } else overallResult = strongestResult(slos.map((slo) => slo.currentResult));
  return deepFreeze({
    schemaVersion: 'slo-trend-evaluation.v1',
    evaluatedAtMs: input.nowMs,
    releaseSha: input.releaseSha,
    overallResult,
    greenEligible: overallResult === 'PASS',
    liveGreenEligible: overallResult === 'PASS' && slos.every((slo) => slo.liveGreenEligible),
    catalogBinding: {
      result: catalogBindingResult,
      reasonCodes: sortedUniqueStrings(catalogBindingReasons),
      verificationMode: 'PACKET_LOCAL_CANONICAL_SHA256_WITH_EXTERNAL_OWNER_EVIDENCE',
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogReleaseSha: catalog.releaseSha,
      claimedCatalogSha256: catalog.catalogSha256,
      derivedCatalogSha256: catalogValidation.derivedCatalogSha256,
      verifiedCatalogSha256: verification.verifiedCatalogSha256,
      verifierOwnerId: verification.verifierOwnerId,
      verifierReferenceId: verification.verifierReferenceId,
      verifiedAtMs: verification.verifiedAtMs,
    },
    definitionBinding: {
      result: definitionBindingResult,
      reasonCodes: definitionBindingReasonCodes,
    },
    denominatorCount: catalog.slos.length,
    suppliedDefinitionCount: input.definitions.length,
    catalogDenominatorCount: catalog.slos.length,
    categoryDenominatorCount: SLO_CATEGORIES.length,
    coveredCategoryCount: coveredCategories.length,
    coveredCategories,
    missingCategories,
    missingCatalogSloKeys,
    extraDefinitionKeys,
    definitionBindingMismatches,
    metricBindingMismatches: catalogValidation.metricBindingMismatches,
    unknownWindowIds,
    authorityMutation: false,
    blocksRiskReduction: false,
    slos,
  });
}
