import {
  CockpitContractError,
  SEMANTIC_SOURCE_STREAM_IDS,
  SOURCE_ROW_CATALOG,
  evaluatePanel,
} from './cockpit-view-model.mjs';
import {
  evaluateReleaseBoundExpectedManifest,
} from '../../observability/release-manifest-evaluator.mjs';
import { sha256CanonicalJson } from '../../observability/canonical-sha256.mjs';

export const RELEASE_BOUND_PANEL_EVALUATION_SCHEMA_VERSION = 'release-bound-panel-evaluation.v1';

export const RELEASE_BOUND_PANEL_REASON_CODES = Object.freeze([
  'PANEL_ACCEPTED_RELEASE_SHA_MISMATCH',
  'PANEL_COMPONENT_FACT_IDENTITY_SET_MISMATCH',
  'PANEL_COMPONENT_FACT_RELEASE_MISMATCH',
  'PANEL_COMPONENT_INVENTORY_NOT_PASS',
  'PANEL_CONTROL_COMMAND_BINDING_MISMATCH',
  'PANEL_CONTROL_COMMAND_ITEM_NOT_LIVE',
  'PANEL_CONTROL_COMMAND_ITEM_NOT_PASS',
  'PANEL_EXPECTED_MANIFEST_ITEM_DISABLED',
  'PANEL_EXPECTED_MANIFEST_ITEM_EVALUATION_MISSING',
  'PANEL_EXPECTED_MANIFEST_ITEM_KIND_MISMATCH',
  'PANEL_EXPECTED_MANIFEST_ITEM_MISSING',
  'PANEL_EXPECTED_MANIFEST_ITEM_NOT_BLOCKING',
  'PANEL_EXPECTED_MANIFEST_ITEM_NOT_LIVE',
  'PANEL_EXPECTED_MANIFEST_ITEM_NOT_PASS',
  'PANEL_EXPECTED_MANIFEST_ITEM_NOT_REQUIRED',
  'PANEL_MANIFEST_BINDING_NOT_PASS',
  'PANEL_MANIFEST_CANONICAL_DIGEST_NOT_PASS',
  'PANEL_MANIFEST_DENOMINATOR_COUNT_MISMATCH',
  'PANEL_MANIFEST_DENOMINATOR_EVIDENCE_COUNT_MISMATCH',
  'PANEL_MANIFEST_DENOMINATOR_NOT_PASS',
  'PANEL_MANIFEST_DENOMINATOR_PARTITION_MISMATCH',
  'PANEL_MANIFEST_DENOMINATOR_SOURCE_MISSING',
  'PANEL_MANIFEST_DENOMINATOR_UNKNOWN_NONZERO',
  'PANEL_MANIFEST_DIGEST_VERIFICATION_NOT_PASS',
  'PANEL_MANIFEST_ID_MISMATCH',
  'PANEL_MANIFEST_REVISION_MISMATCH',
  'PANEL_MANIFEST_REVIEW_NOT_PASS',
  'PANEL_MANIFEST_SHA256_MISMATCH',
  'PANEL_SOURCE_AGGREGATION_COVERAGE_MISMATCH',
  'PANEL_SOURCE_AGGREGATION_IDENTITY_MISMATCH',
  'PANEL_SOURCE_INVENTORY_NOT_PASS',
  'PANEL_SOURCE_PRODUCER_BINDING_MISMATCH',
]);

const REASON_CODE_SET = new Set(RELEASE_BOUND_PANEL_REASON_CODES);
const EXACT_SET_KEYS = Object.freeze([
  'components',
  'sources',
  'dependencies',
  'capitalPaths',
  'recoveryPaths',
  'commandPaths',
  'cockpitProjections',
  'sentinels',
]);
const DOWNGRADE_ORDER = Object.freeze(['MISSING', 'SILENT', 'STALE', 'SYNTHETIC', 'UNKNOWN']);

export class ReleaseBoundPanelEvaluationError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = 'ReleaseBoundPanelEvaluationError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new ReleaseBoundPanelEvaluationError(code, path, detail);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closed(value, keys, path) {
  if (!isRecord(value)) fail('OBJECT_REQUIRED', path, 'expected a plain object');
  const allowed = new Set(keys);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('FIELD_MISSING', `${path}.${key}`, 'required field missing');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('FIELD_UNKNOWN', `${path}.${key}`, 'field is not allowed');
  }
  return value;
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodePoints);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

function strongest(results) {
  if (results.includes('FAIL')) return 'FAIL';
  if (results.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

function record(reasons, results, condition, reasonCode, result = 'FAIL') {
  if (condition) return;
  if (!REASON_CODE_SET.has(reasonCode)) fail('REASON_CODE_UNREGISTERED', '$.releaseManifestGate.reasonCodes', reasonCode);
  reasons.push(reasonCode);
  results.push(result);
}

function recordResult(reasons, results, actual, reasonCode) {
  if (actual === 'PASS') return;
  record(reasons, results, false, reasonCode, actual === 'FAIL' ? 'FAIL' : 'UNKNOWN');
}

function exactSetForSource(releaseEvaluation, source) {
  return EXACT_SET_KEYS
    .map((key) => releaseEvaluation[key])
    .find((set) => set?.source === source) ?? null;
}

function exactIds(values) {
  return sortedUnique(Array.isArray(values) ? values : []);
}

function duplicateIds(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareCodePoints);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function itemIsSynthetic(expected, observed) {
  return expected?.expectedDataMode === 'SYNTHETIC'
    || expected?.expectedReleaseStatuses?.includes('SYNTHETIC_ONLY')
    || observed?.dataMode === 'SYNTHETIC'
    || observed?.lifecycleAuthority?.truthLabel === 'SYNTHETIC_ONLY'
    || observed?.lifecycleAuthority?.authority === 'SYNTHETIC_TEST'
    || observed?.lifecycleAuthority?.releaseStatuses?.includes('SYNTHETIC_ONLY');
}

function exactSetBinding(set, itemEvaluationById) {
  if (set === null) {
    return {
      source: null,
      result: 'FAIL',
      identitySetSha256: null,
      evaluationEvidenceSha256: null,
      expectedRequiredEnabledCount: 0,
      expectedRequiredEnabledIds: [],
      manifestRequiredEnabledIds: [],
      observedIds: [],
      missingRequiredObservedIds: [],
      unexpectedObservedIds: [],
      nonPassingIds: [],
      nonLiveIds: [],
    };
  }
  const requiredIds = exactIds(set.expectedRequiredEnabledIds);
  return {
    source: set.source,
    result: set.result,
    identitySetSha256: set.identitySetSha256,
    evaluationEvidenceSha256: set.evaluationEvidenceSha256,
    expectedRequiredEnabledCount: set.expectedRequiredEnabledCount,
    expectedRequiredEnabledIds: requiredIds,
    manifestRequiredEnabledIds: exactIds(set.manifestRequiredEnabledIds),
    observedIds: exactIds(set.observedIds),
    missingRequiredObservedIds: exactIds(set.missingRequiredObservedIds),
    unexpectedObservedIds: exactIds(set.unexpectedObservedIds),
    nonPassingIds: requiredIds.filter((id) => itemEvaluationById.get(id)?.result !== 'PASS'),
    nonLiveIds: requiredIds.filter((id) => itemEvaluationById.get(id)?.liveEligible !== true),
  };
}

function rowBinding(rows, expectedIds, itemEvaluationById, releaseSha) {
  const values = Array.isArray(rows) ? rows : [];
  const rowIds = values.map((row) => row?.expectedManifestItemId).filter((value) => typeof value === 'string');
  const exactRowIds = exactIds(rowIds);
  const duplicates = duplicateIds(rowIds);
  const missingIds = expectedIds.filter((id) => !exactRowIds.includes(id));
  const unexpectedIds = exactRowIds.filter((id) => !expectedIds.includes(id));
  const releaseMismatchIds = values
    .filter((row) => row?.acceptedReleaseSha !== releaseSha || row?.runningReleaseSha !== releaseSha)
    .map((row) => row?.expectedManifestItemId)
    .filter((value) => typeof value === 'string')
    .sort(compareCodePoints);
  const nonPassingIds = expectedIds.filter((id) => {
    const evaluation = itemEvaluationById.get(id);
    return evaluation?.blocking !== true || evaluation.result !== 'PASS';
  });
  const nonLiveIds = expectedIds.filter((id) => itemEvaluationById.get(id)?.liveEligible !== true);
  return {
    exact: sameIds(exactRowIds, expectedIds)
      && duplicates.length === 0
      && releaseMismatchIds.length === 0
      && nonPassingIds.length === 0,
    rowIds: exactRowIds,
    duplicateIds: duplicates,
    missingIds,
    unexpectedIds,
    releaseMismatchIds,
    nonPassingIds,
    nonLiveIds,
  };
}

function sourceAggregationBinding(observation, sourceSet, componentSet, releaseInput, itemEvaluationById, releaseSha) {
  const rows = Array.isArray(observation.sourceRows) ? observation.sourceRows : [];
  const sourceIds = sourceSet.expectedRequiredEnabledIds;
  const coveredStreamIds = rows.flatMap((row) => Array.isArray(row?.semanticStreamIds)
    ? row.semanticStreamIds.map((id) => `source:${id}`)
    : []);
  const exactCoveredStreamIds = exactIds(coveredStreamIds);
  const duplicateStreamIds = duplicateIds(coveredStreamIds);
  const rowIds = rows.map((row) => row?.sourceId).filter((value) => typeof value === 'string');
  const expectedAggregationIds = exactIds(SOURCE_ROW_CATALOG.map((row) => row.sourceId));
  const componentIds = new Set(componentSet.expectedRequiredEnabledIds.map((id) => id.slice('component:'.length)));
  const producerMismatchRowIds = [];
  for (const [index, row] of rows.entries()) {
    const catalog = SOURCE_ROW_CATALOG[index];
    const boundComponentIds = Array.isArray(row?.componentIds) ? row.componentIds : [];
    const rawSourceItems = releaseInput.manifest.expectedItems
      .filter((item) => row?.semanticStreamIds?.some((id) => item.expectedId === `source:${id}`));
    const ownerMatches = rawSourceItems.length > 0
      && rawSourceItems.every((item) => item.ownerId === row?.ownerId);
    const componentsMatch = boundComponentIds.length > 0
      && boundComponentIds.every((id) => componentIds.has(id));
    const producerMatches = catalog !== undefined
      && row?.sourceId === catalog.sourceId
      && row?.expectedManifestItemId === catalog.expectedManifestItemId
      && JSON.stringify(row?.physicalProducerIds) === JSON.stringify(catalog.physicalProducerIds)
      && JSON.stringify(row?.componentIds) === JSON.stringify(catalog.componentIds)
      && JSON.stringify(row?.semanticStreamIds) === JSON.stringify(catalog.semanticStreamIds);
    const releasesMatch = row?.acceptedReleaseSha === releaseSha && row?.runningReleaseSha === releaseSha;
    if (row?.aggregationKind !== 'NAMED_AGGREGATION' || !producerMatches
        || !ownerMatches || !componentsMatch || !releasesMatch) {
      producerMismatchRowIds.push(row?.sourceId ?? 'UNKNOWN_SOURCE_ROW');
    }
  }
  const sourceRowsReleaseMismatch = rows
    .filter((row) => row?.acceptedReleaseSha !== releaseSha || row?.runningReleaseSha !== releaseSha)
    .map((row) => row?.sourceId)
    .filter((value) => typeof value === 'string');
  const nonPassingIds = sourceIds.filter((id) => {
    const evaluation = itemEvaluationById.get(id);
    return evaluation?.blocking !== true || evaluation.result !== 'PASS';
  });
  const nonLiveIds = sourceIds.filter((id) => itemEvaluationById.get(id)?.liveEligible !== true);
  const sourceDenominator = observation.sourceDenominator;
  const aggregationDenominator = observation.sourceAggregationDenominator;
  const streamDenominatorMatches = isRecord(sourceDenominator)
    && sourceDenominator.expectedCount === sourceIds.length
    && sourceDenominator.coveredCount === sourceIds.length
    && sourceDenominator.missingCount === 0
    && sourceDenominator.unknownCount === 0;
  const aggregationDenominatorMatches = isRecord(aggregationDenominator)
    && aggregationDenominator.expectedCount === rows.length
    && aggregationDenominator.rowCount === rows.length
    && aggregationDenominator.missingCount === 0
    && aggregationDenominator.unknownCount === 0;
  return {
    exact: rows.length > 0
      && sameIds(exactCoveredStreamIds, sourceIds)
      && duplicateStreamIds.length === 0
      && sameIds(exactIds(SEMANTIC_SOURCE_STREAM_IDS.map((id) => `source:${id}`)), sourceIds)
      && sameIds(exactIds(rowIds), expectedAggregationIds)
      && duplicateIds(rowIds).length === 0
      && producerMismatchRowIds.length === 0
      && sourceRowsReleaseMismatch.length === 0
      && nonPassingIds.length === 0
      && streamDenominatorMatches
      && aggregationDenominatorMatches,
    rowIds: exactIds(rowIds),
    coveredStreamIds: exactCoveredStreamIds,
    duplicateStreamIds,
    missingStreamIds: sourceIds.filter((id) => !exactCoveredStreamIds.includes(id)),
    unexpectedStreamIds: exactCoveredStreamIds.filter((id) => !sourceIds.includes(id)),
    producerMismatchRowIds: exactIds(producerMismatchRowIds),
    releaseMismatchRowIds: exactIds(sourceRowsReleaseMismatch),
    nonPassingIds,
    nonLiveIds,
    streamDenominatorMatches,
    aggregationDenominatorMatches,
  };
}

function mergeDowngrade(panelState, gateState) {
  if (gateState === null) return panelState;
  const panelIndex = DOWNGRADE_ORDER.indexOf(panelState);
  const gateIndex = DOWNGRADE_ORDER.indexOf(gateState);
  if (panelIndex === -1) return gateState;
  return panelIndex <= gateIndex ? panelState : gateState;
}

function gateDowngrade({
  liveGreenEligible,
  expectedItem,
  observedItem,
  denominatorBinding,
  gateResult,
}) {
  if (liveGreenEligible) return null;
  if (expectedItem === undefined) return 'MISSING';
  if (observedItem === undefined || observedItem.identityState === 'MISSING') return 'MISSING';
  if (observedItem.freshnessState === 'SILENT') return 'SILENT';
  if (observedItem.freshnessState === 'STALE') return 'STALE';
  if (itemIsSynthetic(expectedItem, observedItem) || denominatorBinding.nonLiveIds.length > 0) return 'SYNTHETIC';
  if (gateResult !== 'PASS') return 'UNKNOWN';
  return 'UNKNOWN';
}

function commandBinding(contract, releaseInput, releaseEvaluation, itemEvaluationById) {
  if (contract.panelKind !== 'CONTROL') {
    return {
      required: false,
      expectedManifestItemId: null,
      backendMutationId: null,
      result: 'PASS',
      liveEligible: true,
      reasonCodes: [],
    };
  }
  const backendCapability = `backend-mutation:${contract.controlBinding.backendMutationId}`;
  const contractCapability = `control-contract:${contract.contractId}`;
  const candidates = releaseInput.manifest.expectedItems.filter((item) => item.kind === 'COMMAND_PATH'
    && item.required && item.enabled
    && item.dependentCapabilityIds.includes(backendCapability)
    && item.dependentCapabilityIds.includes(contractCapability));
  const reasons = [];
  const results = [];
  record(reasons, results, candidates.length === 1, 'PANEL_CONTROL_COMMAND_BINDING_MISMATCH');
  const expected = candidates.length === 1 ? candidates[0] : undefined;
  const evaluated = expected === undefined ? undefined : itemEvaluationById.get(expected.expectedId);
  record(reasons, results, evaluated?.blocking === true && evaluated?.result === 'PASS', 'PANEL_CONTROL_COMMAND_ITEM_NOT_PASS', evaluated?.result === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL');
  const result = strongest(results);
  const liveEligible = result === 'PASS' && evaluated?.liveEligible === true;
  if (result === 'PASS' && !liveEligible) reasons.push('PANEL_CONTROL_COMMAND_ITEM_NOT_LIVE');
  return {
    required: true,
    expectedManifestItemId: expected?.expectedId ?? null,
    backendMutationId: contract.controlBinding.backendMutationId,
    result,
    liveEligible,
    reasonCodes: sortedUnique(reasons),
  };
}

/**
 * Pure composition gate for a panel and the canonical release-manifest evaluator.
 * The legacy observation MATCH field is never accepted as sufficient proof.
 */
export function evaluateReleaseBoundPanel(input) {
  const root = closed(input, [
    'contract', 'observation', 'stateRuleSet', 'evaluatedAtMs', 'releaseManifestInput',
  ], '$');
  if (!Number.isSafeInteger(root.evaluatedAtMs) || root.evaluatedAtMs < 0) {
    fail('INJECTED_CLOCK_INVALID', '$.evaluatedAtMs', 'expected a non-negative safe integer');
  }
  if (!isRecord(root.releaseManifestInput)
      || !Number.isSafeInteger(root.releaseManifestInput.nowMs)
      || root.releaseManifestInput.nowMs !== root.evaluatedAtMs) {
    fail('INJECTED_CLOCK_MISMATCH', '$.releaseManifestInput.nowMs', 'manifest and panel evaluators require the same injected clock');
  }

  let panel;
  try {
    panel = evaluatePanel(root.contract, root.observation, root.evaluatedAtMs, root.stateRuleSet);
  } catch (error) {
    if (error instanceof CockpitContractError) throw error;
    throw error;
  }
  const releaseEvaluation = evaluateReleaseBoundExpectedManifest(root.releaseManifestInput);
  const release = root.contract.releaseBinding;
  const itemEvaluationById = new Map(releaseEvaluation.items.map((item) => [item.expectedId, item]));
  const expectedItem = root.releaseManifestInput.manifest.expectedItems
    .find((item) => item.expectedId === release.expectedManifestItemId);
  const observedItem = root.releaseManifestInput.observation.items
    .find((item) => item.expectedId === release.expectedManifestItemId);
  const evaluatedItem = itemEvaluationById.get(release.expectedManifestItemId);
  const exactSet = exactSetForSource(releaseEvaluation, root.contract.denominatorLaw.expectedSource);
  const denominatorBinding = exactSetBinding(exactSet, itemEvaluationById);

  const reasons = [];
  const results = [];
  record(reasons, results, releaseEvaluation.manifestId === release.manifestId, 'PANEL_MANIFEST_ID_MISMATCH');
  record(reasons, results, releaseEvaluation.manifestRevision === release.manifestRevision, 'PANEL_MANIFEST_REVISION_MISMATCH');
  record(reasons, results, releaseEvaluation.manifestSha256 === release.manifestSha256, 'PANEL_MANIFEST_SHA256_MISMATCH');
  record(reasons, results, releaseEvaluation.acceptedReleaseSha === release.acceptedReleaseSha, 'PANEL_ACCEPTED_RELEASE_SHA_MISMATCH');
  recordResult(reasons, results, releaseEvaluation.canonicalManifestDigest.result, 'PANEL_MANIFEST_CANONICAL_DIGEST_NOT_PASS');
  recordResult(reasons, results, releaseEvaluation.manifestReview.result, 'PANEL_MANIFEST_REVIEW_NOT_PASS');
  recordResult(reasons, results, releaseEvaluation.binding.result, 'PANEL_MANIFEST_BINDING_NOT_PASS');
  recordResult(reasons, results, releaseEvaluation.manifestDigestVerification.result, 'PANEL_MANIFEST_DIGEST_VERIFICATION_NOT_PASS');
  recordResult(reasons, results, releaseEvaluation.denominator.result, 'PANEL_MANIFEST_DENOMINATOR_NOT_PASS');
  record(reasons, results, expectedItem !== undefined, 'PANEL_EXPECTED_MANIFEST_ITEM_MISSING');
  if (expectedItem !== undefined) {
    record(reasons, results, expectedItem.kind === 'COCKPIT_PROJECTION', 'PANEL_EXPECTED_MANIFEST_ITEM_KIND_MISMATCH');
    record(reasons, results, expectedItem.required === true, 'PANEL_EXPECTED_MANIFEST_ITEM_NOT_REQUIRED');
    record(reasons, results, expectedItem.enabled === true, 'PANEL_EXPECTED_MANIFEST_ITEM_DISABLED');
  }
  record(reasons, results, evaluatedItem !== undefined, 'PANEL_EXPECTED_MANIFEST_ITEM_EVALUATION_MISSING');
  if (evaluatedItem !== undefined) {
    record(reasons, results, evaluatedItem.blocking === true, 'PANEL_EXPECTED_MANIFEST_ITEM_NOT_BLOCKING');
    record(reasons, results, evaluatedItem.result === 'PASS', 'PANEL_EXPECTED_MANIFEST_ITEM_NOT_PASS', evaluatedItem.result === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL');
  }

  record(reasons, results, exactSet !== null, 'PANEL_MANIFEST_DENOMINATOR_SOURCE_MISSING');
  if (exactSet !== null) recordResult(reasons, results, exactSet.result, 'PANEL_MANIFEST_DENOMINATOR_NOT_PASS');
  const partitionCount = root.observation.denominator.visibleCount
    + root.observation.denominator.filteredCount
    + root.observation.denominator.hiddenCount;
  const expectedDenominatorCount = denominatorBinding.expectedRequiredEnabledCount;
  record(reasons, results,
    root.contract.denominatorLaw.expectedCount === expectedDenominatorCount
      && root.observation.denominator.expectedCount === expectedDenominatorCount,
    'PANEL_MANIFEST_DENOMINATOR_COUNT_MISMATCH');
  record(reasons, results, partitionCount === expectedDenominatorCount, 'PANEL_MANIFEST_DENOMINATOR_PARTITION_MISMATCH');
  record(reasons, results, root.observation.evidence.observedCount === expectedDenominatorCount, 'PANEL_MANIFEST_DENOMINATOR_EVIDENCE_COUNT_MISMATCH');
  record(reasons, results, root.observation.denominator.unknownCount === 0, 'PANEL_MANIFEST_DENOMINATOR_UNKNOWN_NONZERO', 'UNKNOWN');

  const componentRowsRequired = root.contract.componentFactsBinding?.required === true;
  const componentBinding = rowBinding(
    root.observation.componentFacts,
    exactIds(releaseEvaluation.components.expectedRequiredEnabledIds),
    itemEvaluationById,
    release.acceptedReleaseSha,
  );
  if (componentRowsRequired) {
    recordResult(reasons, results, releaseEvaluation.components.result, 'PANEL_COMPONENT_INVENTORY_NOT_PASS');
    record(reasons, results,
      componentBinding.missingIds.length === 0
        && componentBinding.unexpectedIds.length === 0
        && componentBinding.duplicateIds.length === 0,
      'PANEL_COMPONENT_FACT_IDENTITY_SET_MISMATCH');
    record(reasons, results, componentBinding.releaseMismatchIds.length === 0, 'PANEL_COMPONENT_FACT_RELEASE_MISMATCH');
    record(reasons, results, componentBinding.nonPassingIds.length === 0, 'PANEL_COMPONENT_INVENTORY_NOT_PASS');
  }

  const sourceRowsRequired = root.contract.contractId === 'PANEL_DASHBOARD_TRUTH_V1';
  const sourceBinding = sourceAggregationBinding(
    root.observation,
    exactSetBinding(releaseEvaluation.sources, itemEvaluationById),
    exactSetBinding(releaseEvaluation.components, itemEvaluationById),
    root.releaseManifestInput,
    itemEvaluationById,
    release.acceptedReleaseSha,
  );
  if (sourceRowsRequired) {
    recordResult(reasons, results, releaseEvaluation.sources.result, 'PANEL_SOURCE_INVENTORY_NOT_PASS');
    record(reasons, results,
      sourceBinding.missingStreamIds.length === 0
        && sourceBinding.unexpectedStreamIds.length === 0
        && sourceBinding.duplicateStreamIds.length === 0,
      'PANEL_SOURCE_AGGREGATION_COVERAGE_MISMATCH');
    record(reasons, results,
      sourceBinding.streamDenominatorMatches && sourceBinding.aggregationDenominatorMatches,
      'PANEL_SOURCE_AGGREGATION_IDENTITY_MISMATCH');
    record(reasons, results, sourceBinding.producerMismatchRowIds.length === 0, 'PANEL_SOURCE_PRODUCER_BINDING_MISMATCH');
    record(reasons, results, sourceBinding.nonPassingIds.length === 0, 'PANEL_SOURCE_INVENTORY_NOT_PASS');
  }

  const controlBinding = commandBinding(root.contract, root.releaseManifestInput, releaseEvaluation, itemEvaluationById);
  if (controlBinding.result !== 'PASS') {
    for (const reasonCode of controlBinding.reasonCodes) {
      if (reasonCode === 'PANEL_CONTROL_COMMAND_ITEM_NOT_LIVE') continue;
      reasons.push(reasonCode);
    }
    results.push(controlBinding.result);
  }

  const result = strongest(results);
  const greenEligible = result === 'PASS';
  const denominatorLive = denominatorBinding.nonLiveIds.length === 0;
  const componentLive = !componentRowsRequired || componentBinding.nonLiveIds.length === 0;
  const sourceLive = !sourceRowsRequired || sourceBinding.nonLiveIds.length === 0;
  const liveGreenEligible = greenEligible
    && evaluatedItem?.liveEligible === true
    && denominatorLive
    && componentLive
    && sourceLive
    && controlBinding.liveEligible;
  if (greenEligible && evaluatedItem?.liveEligible !== true) reasons.push('PANEL_EXPECTED_MANIFEST_ITEM_NOT_LIVE');
  if (controlBinding.required && !controlBinding.liveEligible) reasons.push('PANEL_CONTROL_COMMAND_ITEM_NOT_LIVE');

  const downgrade = gateDowngrade({
    liveGreenEligible,
    expectedItem,
    observedItem,
    denominatorBinding,
    gateResult: result,
  });
  const displayState = mergeDowngrade(panel.displayState, downgrade);
  const reasonCodes = sortedUnique(reasons);
  const evidencePayload = {
    schemaVersion: RELEASE_BOUND_PANEL_EVALUATION_SCHEMA_VERSION,
    evaluatedAtMs: root.evaluatedAtMs,
    contractId: root.contract.contractId,
    manifestId: releaseEvaluation.manifestId,
    manifestRevision: releaseEvaluation.manifestRevision,
    manifestSha256: releaseEvaluation.manifestSha256,
    acceptedReleaseSha: releaseEvaluation.acceptedReleaseSha,
    manifestEvaluationEvidenceSha256: releaseEvaluation.evaluationEvidence.evidenceSha256,
    manifestObservationSha256: releaseEvaluation.evaluationEvidence.observationSha256,
    denominatorIdentitySetSha256: denominatorBinding.identitySetSha256,
    expectedManifestItemId: release.expectedManifestItemId,
    result,
    greenEligible,
    liveGreenEligible,
    reasonCodes,
  };
  const releaseManifestGate = {
    result,
    greenEligible,
    liveGreenEligible,
    expectedManifestItemId: release.expectedManifestItemId,
    itemPresent: expectedItem !== undefined,
    itemKind: expectedItem?.kind ?? null,
    itemBlocking: evaluatedItem?.blocking ?? null,
    itemResult: evaluatedItem?.result ?? null,
    itemLiveEligible: evaluatedItem?.liveEligible ?? null,
    manifestId: releaseEvaluation.manifestId,
    manifestRevision: releaseEvaluation.manifestRevision,
    manifestSha256: releaseEvaluation.manifestSha256,
    acceptedReleaseSha: releaseEvaluation.acceptedReleaseSha,
    manifestEvaluationEvidenceSha256: releaseEvaluation.evaluationEvidence.evidenceSha256,
    manifestObservationSha256: releaseEvaluation.evaluationEvidence.observationSha256,
    gateEvidenceSha256: sha256CanonicalJson(evidencePayload),
    denominatorBinding: {
      ...denominatorBinding,
      contractExpectedCount: root.contract.denominatorLaw.expectedCount,
      observationExpectedCount: root.observation.denominator.expectedCount,
      observationPartitionCount: partitionCount,
      observationEvidenceCount: root.observation.evidence.observedCount,
      observationUnknownCount: root.observation.denominator.unknownCount,
    },
    componentBinding: {
      required: componentRowsRequired,
      identitySetSha256: releaseEvaluation.components.identitySetSha256,
      ...componentBinding,
    },
    sourceBinding: {
      required: sourceRowsRequired,
      identitySetSha256: releaseEvaluation.sources.identitySetSha256,
      ...sourceBinding,
    },
    controlBinding,
    reasonCodes,
  };
  const composedPanel = {
    ...panel,
    displayState,
    reasonCodes: sortedUnique([...panel.reasonCodes, ...reasonCodes]),
  };
  return deepFreeze({
    schemaVersion: RELEASE_BOUND_PANEL_EVALUATION_SCHEMA_VERSION,
    evaluatedAtMs: root.evaluatedAtMs,
    panel: composedPanel,
    releaseManifestGate,
  });
}
