import {
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from '../../dock/src/index.mjs';
import {
  CAPITAL_ACCOUNTING_CONFIDENCE,
  CAPITAL_ACCOUNTING_STATUSES,
  CAPITAL_IDENTITY_EQUATION,
  CAPITAL_MEASURE_KEYS,
  CAPITAL_MEASURE_STATUSES,
  CAPITAL_TRUTH_STATES,
  COHORTS,
  DIMENSION_KEYS,
  DIMENSION_STATES,
  EDGE_METER_SCHEMA_VERSION,
  EXECUTION_COST_BASES,
  GROSS_BRIDGE_EQUATION,
  GROSS_BRIDGE_STATES,
  LABEL_KINDS,
  MAX_ARRAY_ITEMS,
  MAX_BATCH_ITEMS,
  MAX_STRING_LENGTH,
  OWNER_CLASSES,
  OWNER_REFERENCE_KEYS,
  PRICE_PNL_BASES,
  Q_ABSTENTION_ACTIONS,
  Q_ABSTENTION_REASONS,
  Q_AVAILABILITY_STATES,
  Q_COVERAGE_STATES,
  Q_HOLDOUT_STATES,
  Q_PARTITION_CLASSES,
  Q_PROOF_STATES,
  Q_REFERENCE_KEYS,
  REFERENCE_STATES,
  SELECTION_EVIDENCE_KINDS,
} from './constants.mjs';
import {
  assertExactDecimal,
  compareExactDecimals,
  exactDecimalInRange,
} from './exact-decimal.mjs';

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,255}$/;
const CAPITAL_SCOPE_KINDS = Object.freeze(['PROPOSAL', 'MANDATE', 'STAGE', 'LEG', 'POSITION', 'CLOSED_OUTCOME']);

function fail(code, message, path = null) {
  const suffix = path === null ? '' : ` (${path})`;
  throw contractError(code, `${message}${suffix}`);
}

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('EDGE_RECORD_REQUIRED', 'expected an object', path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('EDGE_RECORD_PROTOTYPE_FORBIDDEN', 'custom object prototypes are forbidden', path);
  }
  return value;
}

function exactKeys(value, keys, path) {
  const object = record(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const missing = expected.filter((key) => !actual.includes(key));
    const unknown = actual.filter((key) => !expected.includes(key));
    fail('EDGE_RECORD_FIELDS_INVALID', `missing=[${missing.join(',')}] unknown=[${unknown.join(',')}]`, path);
  }
  return object;
}

function text(value, path, maximum = MAX_STRING_LENGTH) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail('EDGE_STRING_INVALID', `expected a trimmed non-empty string of at most ${maximum} characters`, path);
  }
  return value;
}

function nullableText(value, path, maximum = MAX_STRING_LENGTH) {
  if (value === null) return null;
  return text(value, path, maximum);
}

function enumeration(value, allowed, path) {
  if (!allowed.includes(value)) fail('EDGE_ENUM_INVALID', `unsupported value ${String(value)}`, path);
  return value;
}

function exactBoolean(value, path) {
  if (typeof value !== 'boolean') fail('EDGE_BOOLEAN_INVALID', 'expected a boolean', path);
  return value;
}

function safeTime(value, path) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    fail('EDGE_TIME_INVALID', 'expected a non-negative safe UTC-millisecond integer', path);
  }
  return value;
}

function nullableTime(value, path) {
  if (value === null) return null;
  return safeTime(value, path);
}

function sortedUniqueTextArray(value, path, { reasons = false, maximum = MAX_ARRAY_ITEMS } = {}) {
  if (!Array.isArray(value) || value.length > maximum) fail('EDGE_ARRAY_INVALID', `expected an array of at most ${maximum} values`, path);
  value.forEach((entry, index) => {
    text(entry, `${path}[${index}]`);
    if (reasons && !REASON_CODE_PATTERN.test(entry)) fail('EDGE_REASON_CODE_INVALID', 'reason code must be stable upper snake text', `${path}[${index}]`);
  });
  if (new Set(value).size !== value.length) fail('EDGE_ARRAY_DUPLICATE', 'array values must be unique', path);
  const sorted = [...value].sort();
  if (value.some((entry, index) => entry !== sorted[index])) fail('EDGE_ARRAY_ORDER_INVALID', 'array values must be sorted', path);
  return value;
}

function qAbstentionReasons(value, path) {
  if (!Array.isArray(value) || value.length > Q_ABSTENTION_REASONS.length) {
    fail('EDGE_Q_ABSTENTION_REASONS_INVALID', `expected at most ${Q_ABSTENTION_REASONS.length} canonical Q reasons`, path);
  }
  const indexes = value.map((entry, index) => {
    text(entry, `${path}[${index}]`);
    const precedence = Q_ABSTENTION_REASONS.indexOf(entry);
    if (precedence < 0) fail('EDGE_Q_ABSTENTION_REASON_INVALID', 'reason is not in accepted Q AbstentionReason', `${path}[${index}]`);
    return precedence;
  });
  if (new Set(indexes).size !== indexes.length) fail('EDGE_ARRAY_DUPLICATE', 'Q abstention reasons must be unique', path);
  if (indexes.some((precedence, index) => index > 0 && precedence <= indexes[index - 1])) {
    fail('EDGE_Q_ABSTENTION_REASON_ORDER_INVALID', 'Q abstention reasons must follow accepted frozen precedence', path);
  }
  return value;
}

function nullableExactDecimal(value, path) {
  if (value === null) return null;
  try {
    return assertExactDecimal(value);
  } catch (error) {
    fail(error.code ?? 'EDGE_DECIMAL_INVALID', error.message, path);
  }
}

function estimateRange(value, path) {
  if (value === null) return null;
  const range = exactKeys(value, ['low', 'high'], path);
  if (range.low === null || range.high === null) fail('EDGE_ESTIMATE_RANGE_BOUND_REQUIRED', 'estimate range bounds cannot be null', path);
  nullableExactDecimal(range.low, `${path}.low`);
  nullableExactDecimal(range.high, `${path}.high`);
  if (compareExactDecimals(range.low, range.high) > 0) fail('EDGE_ESTIMATE_RANGE_REVERSED', 'estimate low exceeds high', path);
  return range;
}

export function validateOwnerReference(input, path = 'OwnerReferenceV1') {
  const value = exactKeys(input, [
    'schema',
    'version',
    'refId',
    'ownerClass',
    'canonicalOwner',
    'repositoryPath',
    'commitSha',
    'contractId',
    'contractVersion',
    'recordId',
    'recordRevision',
    'contentHash',
    'projectionContentHash',
    'eventTimeMs',
    'availableAtMs',
    'state',
    'reasonCodes',
  ], path);
  if (value.schema !== 'OwnerReferenceV1' || value.version !== EDGE_METER_SCHEMA_VERSION) {
    fail('EDGE_REFERENCE_VERSION_INVALID', 'owner reference must be V1', path);
  }
  text(value.refId, `${path}.refId`, 256);
  enumeration(value.ownerClass, OWNER_CLASSES, `${path}.ownerClass`);
  text(value.canonicalOwner, `${path}.canonicalOwner`);
  text(value.repositoryPath, `${path}.repositoryPath`);
  if (value.repositoryPath.startsWith('/')
    || value.repositoryPath.includes('\\')
    || value.repositoryPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('EDGE_REFERENCE_PATH_UNSAFE', 'repository path must be a normalized relative repository path', `${path}.repositoryPath`);
  }
  if (!GIT_SHA_PATTERN.test(value.commitSha)) fail('EDGE_REFERENCE_COMMIT_INVALID', 'commit SHA must be exact lowercase full Git SHA', `${path}.commitSha`);
  text(value.contractId, `${path}.contractId`);
  text(value.contractVersion, `${path}.contractVersion`, 256);
  enumeration(value.state, REFERENCE_STATES, `${path}.state`);
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`, { reasons: true });

  if (value.state === 'AVAILABLE') {
    text(value.recordId, `${path}.recordId`);
    text(value.recordRevision, `${path}.recordRevision`, 512);
    if (!CONTENT_HASH_PATTERN.test(value.contentHash ?? '')) fail('EDGE_REFERENCE_HASH_INVALID', 'available reference requires SHA-256 content hash', `${path}.contentHash`);
    if (!CONTENT_HASH_PATTERN.test(value.projectionContentHash ?? '')) fail('EDGE_REFERENCE_PROJECTION_HASH_INVALID', 'available reference requires SHA-256 projection content hash', `${path}.projectionContentHash`);
    safeTime(value.eventTimeMs, `${path}.eventTimeMs`);
    safeTime(value.availableAtMs, `${path}.availableAtMs`);
    if (value.availableAtMs < value.eventTimeMs) fail('EDGE_REFERENCE_TIME_ORDER_INVALID', 'availability precedes event time', path);
    if (value.reasonCodes.length !== 0) fail('EDGE_AVAILABLE_REFERENCE_HAS_REASON', 'available reference cannot carry missing/divergent reasons', path);
  } else {
    for (const field of ['recordId', 'recordRevision', 'contentHash', 'projectionContentHash', 'eventTimeMs', 'availableAtMs']) {
      if (value[field] !== null) fail('EDGE_UNAVAILABLE_REFERENCE_HAS_RECORD', `non-available reference must use null ${field}`, `${path}.${field}`);
    }
    if (value.reasonCodes.length === 0) fail('EDGE_UNAVAILABLE_REFERENCE_REASON_REQUIRED', 'non-available reference requires a reason', path);
  }
  return true;
}

function ownerProjectionEnvelope(input, refKey, data) {
  const reference = input.ownerRefs[refKey];
  const referenceIdentity = cloneCanonical(reference);
  delete referenceIdentity.projectionContentHash;
  return {
    schema: 'EdgeMeterOwnerProjectionBindingV1',
    version: 1,
    refKey,
    reference: referenceIdentity,
    data: cloneCanonical(data),
  };
}

/**
 * Narrow, deterministic fixture projections selected from owner records.
 * These are adapter bindings, not substitute canonical contracts. Their hashes
 * prevent sibling Capital/Q/dimension values from changing under unchanged
 * owner reference identity.
 */
export function ownerProjectionPayloads(input) {
  const selection = Object.fromEntries(input.qEvidence.selectionEvidence.map((entry) => [entry.kind, entry]));
  const payloads = {
    proposal: ownerProjectionEnvelope(input, 'proposal', {
      strategy: input.dimensions.strategy,
      symbol: input.dimensions.symbol,
      informationCutoffMs: input.informationCutoffMs,
    }),
    assessment: ownerProjectionEnvelope(input, 'assessment', {
      regime: input.dimensions.regime,
      decisionBenchmarkGross: input.grossBridge.decisionBenchmarkGross,
    }),
    outcome: ownerProjectionEnvelope(input, 'outcome', {
      labelKind: input.labelKind,
      cohort: input.cohort,
      horizon: input.horizon,
      valuationAsset: input.valuationAsset,
      decisionDisposition: input.decisionDisposition,
    }),
    economicReport: ownerProjectionEnvelope(input, 'economicReport', {
      capitalProjection: input.capitalProjection,
    }),
    accountingPolicy: ownerProjectionEnvelope(input, 'accountingPolicy', {
      policyRefKey: input.capitalProjection.policyRefKey,
      pricePnlBasis: input.capitalProjection.pricePnlBasis,
      executionCostBasis: input.capitalProjection.executionCostBasis,
      identityEquation: input.capitalProjection.identityEquation,
    }),
    fills: ownerProjectionEnvelope(input, 'fills', {
      venue: input.dimensions.venue,
      actualGross: input.grossBridge.actualGross,
      executionDelta: input.grossBridge.executionDelta,
      latencyMs: input.grossBridge.latencyMs,
    }),
    costs: ownerProjectionEnvelope(input, 'costs', {
      turnover: input.dimensions.turnover,
      capacity: input.dimensions.capacity,
    }),
    liabilities: ownerProjectionEnvelope(input, 'liabilities', {
      referenceClass: 'ACCOUNT_CAPITAL_PROJECTION',
    }),
    evidence: ownerProjectionEnvelope(input, 'evidence', {
      evidenceClass: 'POST_HORIZON_OUTCOME',
      venue: input.dimensions.venue,
    }),
    calibration: ownerProjectionEnvelope(input, 'calibration', {
      calibrationState: input.qEvidence.calibrationState,
    }),
    abstention: ownerProjectionEnvelope(input, 'abstention', {
      abstentionAction: input.qEvidence.abstentionAction,
      abstentionReasonCodes: input.qEvidence.abstentionReasonCodes,
    }),
    partition: ownerProjectionEnvelope(input, 'partition', {
      partitionClass: input.qEvidence.partitionClass,
    }),
    embargo: ownerProjectionEnvelope(input, 'embargo', {
      holdoutState: input.qEvidence.holdoutState,
      embargoState: input.qEvidence.embargoState,
    }),
    pointInTimeJoin: ownerProjectionEnvelope(input, 'pointInTimeJoin', {
      pointInTimeJoinState: input.qEvidence.pointInTimeJoinState,
      informationCutoffMs: input.informationCutoffMs,
    }),
    uncertainty: ownerProjectionEnvelope(input, 'uncertainty', {
      uncertaintyState: input.qEvidence.uncertaintyState,
      coverageState: input.qEvidence.coverageState,
      uncertaintyInterval: input.qEvidence.uncertaintyInterval,
      uncertaintyUnit: input.qEvidence.uncertaintyUnit,
    }),
    multiplicity: ownerProjectionEnvelope(input, 'multiplicity', selection.MULTIPLE_TESTING),
    deflatedPerformance: ownerProjectionEnvelope(input, 'deflatedPerformance', selection.DEFLATED_PERFORMANCE),
    selectionPressure: ownerProjectionEnvelope(input, 'selectionPressure', selection.SELECTION_PRESSURE),
  };
  return deepFreeze(cloneCanonical(payloads));
}

export function ownerProjectionHashes(input) {
  return deepFreeze(Object.fromEntries(
    Object.entries(ownerProjectionPayloads(input)).map(([key, payload]) => [key, sha256(payload)]),
  ));
}

function validateOwnerProjectionBindings(input, path) {
  const hashes = ownerProjectionHashes(input);
  for (const key of OWNER_REFERENCE_KEYS) {
    const reference = input.ownerRefs[key];
    if (reference.state === 'AVAILABLE' && reference.projectionContentHash !== hashes[key]) {
      fail('EDGE_OWNER_PROJECTION_HASH_MISMATCH', `${key} projection changed under its immutable owner reference`, `${path}.ownerRefs.${key}.projectionContentHash`);
    }
  }
}

function validateDimension(input, path) {
  const value = exactKeys(input, ['schema', 'version', 'state', 'value', 'ownerRefKey', 'reasonCodes'], path);
  if (value.schema !== 'EdgeMeterDimensionV1' || value.version !== 1) fail('EDGE_DIMENSION_VERSION_INVALID', 'dimension must be V1', path);
  enumeration(value.state, DIMENSION_STATES, `${path}.state`);
  enumeration(value.ownerRefKey, OWNER_REFERENCE_KEYS, `${path}.ownerRefKey`);
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`, { reasons: true });
  if (value.state === 'AVAILABLE') {
    text(value.value, `${path}.value`, 512);
    if (value.reasonCodes.length !== 0) fail('EDGE_AVAILABLE_DIMENSION_HAS_REASON', 'available dimension cannot carry reasons', path);
  } else {
    if (value.value !== null) fail('EDGE_UNKNOWN_DIMENSION_HAS_VALUE', 'unknown/not-applicable dimension value must be null', path);
    if (value.reasonCodes.length === 0) fail('EDGE_DIMENSION_REASON_REQUIRED', 'unknown/not-applicable dimension requires a reason', path);
  }
}

function validateCapitalMeasure(input, path) {
  const value = exactKeys(input, [
    'status',
    'knownAmount',
    'estimatedRange',
    'componentIds',
    'missingComponentKinds',
    'reasonCodes',
  ], path);
  enumeration(value.status, CAPITAL_MEASURE_STATUSES, `${path}.status`);
  nullableExactDecimal(value.knownAmount, `${path}.knownAmount`);
  estimateRange(value.estimatedRange, `${path}.estimatedRange`);
  sortedUniqueTextArray(value.componentIds, `${path}.componentIds`);
  sortedUniqueTextArray(value.missingComponentKinds, `${path}.missingComponentKinds`, { reasons: true });
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`, { reasons: true });

  if (value.status === 'KNOWN') {
    if (value.knownAmount === null) fail('EDGE_KNOWN_MEASURE_AMOUNT_REQUIRED', 'known Capital measure requires knownAmount', path);
    if (value.estimatedRange !== null) fail('EDGE_MEASURE_RANGE_FORBIDDEN', 'known Capital measure cannot carry an estimate range', path);
    if (value.missingComponentKinds.length !== 0 || value.reasonCodes.length !== 0) {
      fail('EDGE_KNOWN_MEASURE_HAS_GAPS', 'known Capital measure cannot carry missing kinds or reasons', path);
    }
  }
  if (value.status === 'ESTIMATED') {
    if (value.estimatedRange === null) fail('EDGE_ESTIMATED_MEASURE_RANGE_REQUIRED', 'estimated Capital measure requires a range', path);
    if (value.missingComponentKinds.length !== 0 || value.reasonCodes.length !== 0) {
      fail('EDGE_ESTIMATED_MEASURE_HAS_GAPS', 'estimated Capital measure cannot carry missing kinds or reasons', path);
    }
  }
  if (value.status === 'MISSING'
    && (value.missingComponentKinds.length === 0 || value.reasonCodes.length === 0)) {
    fail('EDGE_MISSING_MEASURE_REASON_REQUIRED', 'missing Capital measure requires missing kinds and owner reasons', path);
  }
  if (value.status === 'DIVERGENT' && value.reasonCodes.length === 0) {
    fail('EDGE_DIVERGENT_MEASURE_REASON_REQUIRED', 'divergent Capital measure requires an owner reason', path);
  }
  if (value.status === 'NOT_APPLICABLE') {
    if (value.knownAmount !== null || value.estimatedRange !== null) {
      fail('EDGE_NOT_APPLICABLE_MEASURE_HAS_AMOUNT', 'not-applicable Capital measure cannot carry amounts', path);
    }
    if (value.missingComponentKinds.length !== 0 || value.reasonCodes.length !== 0) {
      fail('EDGE_NOT_APPLICABLE_MEASURE_HAS_GAPS', 'not-applicable Capital measure cannot carry missing kinds or reasons', path);
    }
  }
  if (value.knownAmount !== null && value.estimatedRange !== null && !exactDecimalInRange(value.knownAmount, value.estimatedRange)) {
    fail('EDGE_MEASURE_AMOUNT_OUTSIDE_RANGE', 'known portion is outside supplied estimate range', path);
  }
  if (['KNOWN', 'ESTIMATED'].includes(value.status) && value.componentIds.length === 0) {
    fail('EDGE_MEASURE_COMPONENT_PROVENANCE_REQUIRED', 'known/estimated Capital measure needs component IDs', path);
  }
}

function validateCapitalProjection(input, path) {
  const value = exactKeys(input, [
    'schema',
    'version',
    'state',
    'scopeKind',
    'valuationAsset',
    'policyRefKey',
    'pricePnlBasis',
    'executionCostBasis',
    'accountingStatus',
    'accountingConfidence',
    'accountingTruthState',
    'accountingIdentityProven',
    'identityEquation',
    'netKnown',
    'netEstimatedRange',
    'measures',
    'includedComponentIds',
    'excludedComponentIds',
    'divergentReasons',
    'reasonCodes',
  ], path);
  if (value.schema !== 'CapitalEconomicProjectionV1' || value.version !== 1) fail('EDGE_CAPITAL_PROJECTION_VERSION_INVALID', 'Capital projection must be V1', path);
  enumeration(value.state, REFERENCE_STATES, `${path}.state`);
  enumeration(value.policyRefKey, OWNER_REFERENCE_KEYS, `${path}.policyRefKey`);
  sortedUniqueTextArray(value.includedComponentIds, `${path}.includedComponentIds`);
  sortedUniqueTextArray(value.excludedComponentIds, `${path}.excludedComponentIds`);
  sortedUniqueTextArray(value.divergentReasons, `${path}.divergentReasons`);
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`, { reasons: true });

  if (value.state === 'AVAILABLE') {
    enumeration(value.scopeKind, CAPITAL_SCOPE_KINDS, `${path}.scopeKind`);
    text(value.valuationAsset, `${path}.valuationAsset`, 32);
    enumeration(value.pricePnlBasis, PRICE_PNL_BASES, `${path}.pricePnlBasis`);
    enumeration(value.executionCostBasis, EXECUTION_COST_BASES, `${path}.executionCostBasis`);
    enumeration(value.accountingStatus, CAPITAL_ACCOUNTING_STATUSES, `${path}.accountingStatus`);
    enumeration(value.accountingConfidence, CAPITAL_ACCOUNTING_CONFIDENCE, `${path}.accountingConfidence`);
    enumeration(value.accountingTruthState, CAPITAL_TRUTH_STATES, `${path}.accountingTruthState`);
    exactBoolean(value.accountingIdentityProven, `${path}.accountingIdentityProven`);
    if (value.identityEquation !== CAPITAL_IDENTITY_EQUATION) fail('EDGE_CAPITAL_IDENTITY_EQUATION_INVALID', 'Capital identity equation changed', `${path}.identityEquation`);
    nullableExactDecimal(value.netKnown, `${path}.netKnown`);
    estimateRange(value.netEstimatedRange, `${path}.netEstimatedRange`);
    const measures = exactKeys(value.measures, CAPITAL_MEASURE_KEYS, `${path}.measures`);
    for (const key of CAPITAL_MEASURE_KEYS) validateCapitalMeasure(measures[key], `${path}.measures.${key}`);
    if (value.reasonCodes.length !== 0) fail('EDGE_AVAILABLE_CAPITAL_HAS_REASON', 'available Capital projection cannot carry reference-state reasons', path);
  } else {
    for (const field of [
      'scopeKind', 'valuationAsset', 'pricePnlBasis', 'executionCostBasis', 'accountingStatus',
      'accountingConfidence', 'accountingTruthState', 'accountingIdentityProven', 'identityEquation',
      'netKnown', 'netEstimatedRange', 'measures',
    ]) {
      if (value[field] !== null) fail('EDGE_UNAVAILABLE_CAPITAL_HAS_VALUES', `non-available Capital projection must use null ${field}`, `${path}.${field}`);
    }
    if (value.includedComponentIds.length !== 0 || value.excludedComponentIds.length !== 0 || value.divergentReasons.length !== 0) {
      fail('EDGE_UNAVAILABLE_CAPITAL_HAS_COMPONENTS', 'non-available Capital projection cannot carry component accounting', path);
    }
    if (value.reasonCodes.length === 0) fail('EDGE_UNAVAILABLE_CAPITAL_REASON_REQUIRED', 'non-available Capital projection needs a reason', path);
  }
}

function validateGrossBridge(input, path) {
  const value = exactKeys(input, [
    'schema',
    'version',
    'state',
    'valuationAsset',
    'decisionBenchmarkGross',
    'timingEffect',
    'executionDelta',
    'bridgeResidual',
    'actualGross',
    'latencyMs',
    'methodRefKey',
    'pathRefKey',
    'horizonRefKey',
    'equation',
    'reasonCodes',
  ], path);
  if (value.schema !== 'GrossTimingBridgeV1' || value.version !== 1) fail('EDGE_GROSS_BRIDGE_VERSION_INVALID', 'gross bridge must be V1', path);
  enumeration(value.state, GROSS_BRIDGE_STATES, `${path}.state`);
  for (const key of ['methodRefKey', 'pathRefKey', 'horizonRefKey']) enumeration(value[key], OWNER_REFERENCE_KEYS, `${path}.${key}`);
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`, { reasons: true });
  if (value.state === 'AVAILABLE') {
    text(value.valuationAsset, `${path}.valuationAsset`, 32);
    for (const field of ['decisionBenchmarkGross', 'timingEffect', 'executionDelta', 'bridgeResidual', 'actualGross']) {
      nullableExactDecimal(value[field], `${path}.${field}`);
      if (value[field] === null) fail('EDGE_GROSS_BRIDGE_AMOUNT_REQUIRED', `available gross bridge requires ${field}`, `${path}.${field}`);
    }
    safeTime(value.latencyMs, `${path}.latencyMs`);
    if (value.equation !== GROSS_BRIDGE_EQUATION) fail('EDGE_GROSS_BRIDGE_EQUATION_INVALID', 'gross bridge equation changed', `${path}.equation`);
    if (value.reasonCodes.length !== 0) fail('EDGE_AVAILABLE_GROSS_BRIDGE_HAS_REASON', 'available gross bridge cannot carry reasons', path);
  } else {
    for (const field of ['valuationAsset', 'decisionBenchmarkGross', 'timingEffect', 'executionDelta', 'bridgeResidual', 'actualGross', 'latencyMs', 'equation']) {
      if (value[field] !== null) fail('EDGE_UNAVAILABLE_GROSS_BRIDGE_HAS_VALUES', `non-available gross bridge must use null ${field}`, `${path}.${field}`);
    }
    if (value.reasonCodes.length === 0) fail('EDGE_UNAVAILABLE_GROSS_BRIDGE_REASON_REQUIRED', 'non-available gross bridge needs a reason', path);
  }
}

function validateSelectionEvidence(input, expectedKind, path) {
  const value = exactKeys(input, ['kind', 'state', 'displayValue', 'sourceRefKey'], path);
  if (value.kind !== expectedKind) fail('EDGE_SELECTION_KIND_ORDER_INVALID', `expected ${expectedKind}`, `${path}.kind`);
  enumeration(value.state, Q_AVAILABILITY_STATES, `${path}.state`);
  enumeration(value.sourceRefKey, OWNER_REFERENCE_KEYS, `${path}.sourceRefKey`);
  if (value.state === 'AVAILABLE') {
    text(value.displayValue, `${path}.displayValue`, 512);
  } else if (value.displayValue !== null) {
    fail('EDGE_SELECTION_UNKNOWN_HAS_VALUE', 'unavailable selection evidence value must be null', path);
  }
}

function validateQEvidence(input, path) {
  const value = exactKeys(input, [
    'schema',
    'version',
    'partitionClass',
    'holdoutState',
    'embargoState',
    'pointInTimeJoinState',
    'abstentionAction',
    'abstentionReasonCodes',
    'calibrationState',
    'uncertaintyState',
    'coverageState',
    'uncertaintyInterval',
    'uncertaintyUnit',
    'selectionEvidence',
  ], path);
  if (value.schema !== 'QEvidenceProjectionV1' || value.version !== 1) fail('EDGE_Q_EVIDENCE_VERSION_INVALID', 'Q evidence projection must be V1', path);
  enumeration(value.partitionClass, Q_PARTITION_CLASSES, `${path}.partitionClass`);
  enumeration(value.holdoutState, Q_HOLDOUT_STATES, `${path}.holdoutState`);
  enumeration(value.embargoState, Q_PROOF_STATES, `${path}.embargoState`);
  enumeration(value.pointInTimeJoinState, Q_PROOF_STATES, `${path}.pointInTimeJoinState`);
  enumeration(value.abstentionAction, Q_ABSTENTION_ACTIONS, `${path}.abstentionAction`);
  qAbstentionReasons(value.abstentionReasonCodes, `${path}.abstentionReasonCodes`);
  enumeration(value.calibrationState, Q_AVAILABILITY_STATES, `${path}.calibrationState`);
  enumeration(value.uncertaintyState, Q_AVAILABILITY_STATES, `${path}.uncertaintyState`);
  enumeration(value.coverageState, Q_COVERAGE_STATES, `${path}.coverageState`);
  estimateRange(value.uncertaintyInterval, `${path}.uncertaintyInterval`);
  nullableText(value.uncertaintyUnit, `${path}.uncertaintyUnit`, 32);
  if (!Array.isArray(value.selectionEvidence) || value.selectionEvidence.length !== SELECTION_EVIDENCE_KINDS.length) {
    fail('EDGE_SELECTION_EVIDENCE_INCOMPLETE', 'Q selection evidence must contain exactly the three frozen reference classes', `${path}.selectionEvidence`);
  }
  value.selectionEvidence.forEach((entry, index) => validateSelectionEvidence(entry, SELECTION_EVIDENCE_KINDS[index], `${path}.selectionEvidence[${index}]`));
  if (value.abstentionAction === 'ABSTAIN_UNKNOWN' && value.abstentionReasonCodes.length === 0) {
    fail('EDGE_Q_ABSTENTION_REASON_REQUIRED', 'ABSTAIN_UNKNOWN must preserve Q reason codes', path);
  }
  if (value.abstentionAction === 'WATCH' && value.abstentionReasonCodes.length !== 0) {
    fail('EDGE_Q_WATCH_REASON_FORBIDDEN', 'WATCH cannot carry abstention reasons', path);
  }
  if (value.abstentionAction === 'UNAVAILABLE' && value.abstentionReasonCodes.length !== 0) {
    fail('EDGE_Q_UNAVAILABLE_REASON_FORBIDDEN', 'UNAVAILABLE is an F8 absence sentinel and cannot carry Q reasons', path);
  }
  if (value.uncertaintyState === 'AVAILABLE' && value.uncertaintyInterval === null) {
    fail('EDGE_Q_UNCERTAINTY_INTERVAL_REQUIRED', 'available uncertainty requires owner-supplied interval', path);
  }
  if (value.uncertaintyState !== 'AVAILABLE' && value.uncertaintyInterval !== null) {
    fail('EDGE_Q_UNCERTAINTY_INTERVAL_FORBIDDEN', 'unavailable uncertainty cannot carry an interval', path);
  }
  if (value.uncertaintyState === 'AVAILABLE' && value.uncertaintyUnit === null) {
    fail('EDGE_Q_UNCERTAINTY_UNIT_REQUIRED', 'available uncertainty requires an owner-supplied unit', path);
  }
  if (value.uncertaintyState !== 'AVAILABLE' && value.uncertaintyUnit !== null) {
    fail('EDGE_Q_UNCERTAINTY_UNIT_FORBIDDEN', 'unavailable uncertainty cannot carry a unit', path);
  }
}

function validateDecisionDisposition(input, cohort, path) {
  const value = exactKeys(input, ['action', 'reasonCodes', 'monetaryRejectEffect'], path);
  enumeration(value.action, COHORTS, `${path}.action`);
  if (value.action !== cohort) fail('EDGE_COHORT_DISPOSITION_MISMATCH', 'decision action must equal cohort', path);
  sortedUniqueTextArray(value.reasonCodes, `${path}.reasonCodes`);
  if (value.monetaryRejectEffect !== null) {
    fail('EDGE_REJECT_MONETARY_EFFECT_FORBIDDEN', 'reject attribution is reason/evidence only; monetary counterfactuals belong to DecisionLab', `${path}.monetaryRejectEffect`);
  }
  if (cohort !== 'ACTED' && value.reasonCodes.length === 0) fail('EDGE_NON_ACTED_REASON_REQUIRED', 'non-acted cohort needs a canonical reason', path);
}

export function validateEdgeMeterInput(input, path = 'EdgeMeterInputV1') {
  const value = exactKeys(input, [
    'schema',
    'version',
    'measurementId',
    'labelKind',
    'cohort',
    'informationCutoffMs',
    'horizon',
    'valuationAsset',
    'ownerRefs',
    'qEvidence',
    'capitalProjection',
    'grossBridge',
    'decisionDisposition',
    'dimensions',
  ], path);
  if (value.schema !== 'EdgeMeterInputV1' || value.version !== 1) fail('EDGE_INPUT_VERSION_INVALID', 'EdgeMeter input must be V1', path);
  text(value.measurementId, `${path}.measurementId`, 256);
  enumeration(value.labelKind, LABEL_KINDS, `${path}.labelKind`);
  enumeration(value.cohort, COHORTS, `${path}.cohort`);
  safeTime(value.informationCutoffMs, `${path}.informationCutoffMs`);
  const horizon = exactKeys(value.horizon, ['startMs', 'endMs'], `${path}.horizon`);
  safeTime(horizon.startMs, `${path}.horizon.startMs`);
  safeTime(horizon.endMs, `${path}.horizon.endMs`);
  if (horizon.endMs <= horizon.startMs) fail('EDGE_HORIZON_EMPTY_OR_REVERSED', 'horizon end must be strictly after start', `${path}.horizon`);
  text(value.valuationAsset, `${path}.valuationAsset`, 32);

  const refs = exactKeys(value.ownerRefs, OWNER_REFERENCE_KEYS, `${path}.ownerRefs`);
  for (const key of OWNER_REFERENCE_KEYS) validateOwnerReference(refs[key], `${path}.ownerRefs.${key}`);
  const fixedOwnerClasses = {
    proposal: 'ENGINE',
    outcome: 'LEDGER',
    economicReport: 'CAPITAL',
    accountingPolicy: 'CAPITAL',
    fills: 'L',
    costs: 'CAPITAL',
    liabilities: 'CAPITAL',
    evidence: 'INTELLIGENCE_FOUNDATION',
  };
  for (const [key, ownerClass] of Object.entries(fixedOwnerClasses)) {
    if (refs[key].ownerClass !== ownerClass) {
      fail('EDGE_REFERENCE_OWNER_INVALID', `${key} must remain ${ownerClass}-owned`, `${path}.ownerRefs.${key}`);
    }
  }
  for (const key of Q_REFERENCE_KEYS) {
    if (refs[key].ownerClass !== 'Q') fail('EDGE_Q_REFERENCE_OWNER_INVALID', `${key} must remain Q-owned`, `${path}.ownerRefs.${key}`);
  }
  if (value.cohort !== 'ACTED') {
    for (const key of ['economicReport', 'fills', 'costs', 'liabilities']) {
      if (refs[key].state !== 'NOT_APPLICABLE') {
        fail('EDGE_NON_ACTED_OWNER_REFERENCE_FORBIDDEN', `non-acted ${key} reference must be NOT_APPLICABLE`, `${path}.ownerRefs.${key}`);
      }
    }
  }
  validateQEvidence(value.qEvidence, `${path}.qEvidence`);
  validateCapitalProjection(value.capitalProjection, `${path}.capitalProjection`);
  validateGrossBridge(value.grossBridge, `${path}.grossBridge`);
  validateDecisionDisposition(value.decisionDisposition, value.cohort, `${path}.decisionDisposition`);

  const dimensions = exactKeys(value.dimensions, DIMENSION_KEYS, `${path}.dimensions`);
  const expectedDimensionRefs = {
    strategy: 'proposal',
    symbol: 'proposal',
    venue: value.cohort === 'ACTED' ? 'fills' : 'evidence',
    regime: 'assessment',
    turnover: 'costs',
    capacity: 'costs',
  };
  for (const key of DIMENSION_KEYS) {
    validateDimension(dimensions[key], `${path}.dimensions.${key}`);
    if (dimensions[key].ownerRefKey !== expectedDimensionRefs[key]) {
      fail('EDGE_DIMENSION_REFERENCE_KEY_INVALID', `${key} must bind ${expectedDimensionRefs[key]}`, `${path}.dimensions.${key}.ownerRefKey`);
    }
    const ref = refs[dimensions[key].ownerRefKey];
    if (dimensions[key].state === 'AVAILABLE' && ref.state !== 'AVAILABLE') {
      fail('EDGE_DIMENSION_REFERENCE_UNAVAILABLE', 'available dimension needs available owner reference', `${path}.dimensions.${key}`);
    }
  }

  const expectedSelectionRefs = {
    MULTIPLE_TESTING: 'multiplicity',
    DEFLATED_PERFORMANCE: 'deflatedPerformance',
    SELECTION_PRESSURE: 'selectionPressure',
  };
  for (const entry of value.qEvidence.selectionEvidence) {
    if (entry.sourceRefKey !== expectedSelectionRefs[entry.kind]) {
      fail('EDGE_SELECTION_REFERENCE_KEY_INVALID', `${entry.kind} must bind ${expectedSelectionRefs[entry.kind]}`, `${path}.qEvidence.selectionEvidence`);
    }
    const ref = refs[entry.sourceRefKey];
    if (ref.ownerClass !== 'Q') fail('EDGE_SELECTION_OWNER_INVALID', 'selection evidence must remain Q-owned', `${path}.ownerRefs.${entry.sourceRefKey}`);
    if (entry.state === 'AVAILABLE' && ref.state !== 'AVAILABLE') {
      fail('EDGE_SELECTION_REFERENCE_UNAVAILABLE', 'available selection value needs available Q reference', `${path}.qEvidence.selectionEvidence`);
    }
  }

  const expectedBridgeRefs = {
    methodRefKey: 'assessment',
    pathRefKey: 'fills',
    horizonRefKey: 'outcome',
  };
  for (const field of ['methodRefKey', 'pathRefKey', 'horizonRefKey']) {
    if (value.grossBridge[field] !== expectedBridgeRefs[field]) {
      fail('EDGE_GROSS_BRIDGE_REFERENCE_KEY_INVALID', `${field} must bind ${expectedBridgeRefs[field]}`, `${path}.grossBridge.${field}`);
    }
  }
  if (value.grossBridge.state === 'AVAILABLE') {
    for (const field of ['methodRefKey', 'pathRefKey', 'horizonRefKey']) {
      if (refs[value.grossBridge[field]].state !== 'AVAILABLE') {
        fail('EDGE_GROSS_BRIDGE_REFERENCE_REQUIRED', `available gross bridge requires available ${field}`, `${path}.grossBridge.${field}`);
      }
    }
  }

  if (value.capitalProjection.state === 'AVAILABLE' && value.capitalProjection.valuationAsset !== value.valuationAsset) {
    fail('EDGE_CAPITAL_VALUATION_ASSET_MISMATCH', 'Capital projection valuation asset differs from input', `${path}.capitalProjection.valuationAsset`);
  }
  if (value.grossBridge.state === 'AVAILABLE' && value.grossBridge.valuationAsset !== value.valuationAsset) {
    fail('EDGE_GROSS_BRIDGE_VALUATION_ASSET_MISMATCH', 'gross bridge valuation asset differs from input', `${path}.grossBridge.valuationAsset`);
  }
  if (value.capitalProjection.state === 'AVAILABLE' && refs.economicReport.state !== 'AVAILABLE') {
    fail('EDGE_CAPITAL_REPORT_REFERENCE_REQUIRED', 'available Capital projection needs available economicReport reference', path);
  }
  if (value.capitalProjection.policyRefKey !== 'accountingPolicy') {
    fail('EDGE_CAPITAL_POLICY_REFERENCE_KEY_INVALID', 'Capital projection must bind accountingPolicy', `${path}.capitalProjection.policyRefKey`);
  }
  if (value.capitalProjection.state === 'AVAILABLE') {
    const policyRef = refs[value.capitalProjection.policyRefKey];
    if (policyRef.state !== 'AVAILABLE' || policyRef.ownerClass !== 'CAPITAL') {
      fail('EDGE_CAPITAL_POLICY_REFERENCE_INVALID', 'available Capital projection needs available Capital policy reference', `${path}.capitalProjection.policyRefKey`);
    }
  }
  if (value.cohort !== 'ACTED'
    && (value.capitalProjection.state !== 'NOT_APPLICABLE' || value.grossBridge.state !== 'NOT_APPLICABLE')) {
    fail('EDGE_NON_ACTED_MONETARY_PROJECTION_FORBIDDEN', 'non-acted cohorts are reason/evidence projections only', path);
  }

  const requiredAvailableProjectionRefs = [
    ['calibrationState', 'calibration'],
    ['uncertaintyState', 'uncertainty'],
  ];
  for (const [stateField, refKey] of requiredAvailableProjectionRefs) {
    if (value.qEvidence[stateField] === 'AVAILABLE' && refs[refKey].state !== 'AVAILABLE') {
      fail('EDGE_Q_PROJECTION_REFERENCE_UNAVAILABLE', `${stateField} requires available ${refKey} owner reference`, `${path}.qEvidence.${stateField}`);
    }
  }
  if (value.qEvidence.abstentionAction !== 'UNAVAILABLE' && refs.abstention.state !== 'AVAILABLE') {
    fail('EDGE_Q_ABSTENTION_REFERENCE_UNAVAILABLE', 'Q abstention action requires its available owner reference', `${path}.qEvidence.abstentionAction`);
  }
  validateOwnerProjectionBindings(value, path);
  return true;
}

export function validateEdgeMeterBatch(input, path = 'EdgeMeterBatchInputV1') {
  const value = exactKeys(input, ['schema', 'version', 'reportId', 'evaluatedAtMs', 'items'], path);
  if (value.schema !== 'EdgeMeterBatchInputV1' || value.version !== 1) fail('EDGE_BATCH_VERSION_INVALID', 'EdgeMeter batch must be V1', path);
  text(value.reportId, `${path}.reportId`, 256);
  safeTime(value.evaluatedAtMs, `${path}.evaluatedAtMs`);
  if (!Array.isArray(value.items) || value.items.length > MAX_BATCH_ITEMS) {
    fail('EDGE_BATCH_LIMIT_EXCEEDED', `batch must contain at most ${MAX_BATCH_ITEMS} items`, `${path}.items`);
  }
  value.items.forEach((item, index) => validateEdgeMeterInput(item, `${path}.items[${index}]`));
  return true;
}

export function parseEdgeMeterBatch(input) {
  const cloned = cloneCanonical(input);
  validateEdgeMeterBatch(cloned);
  return deepFreeze(cloned);
}

export function edgeMeterInputHash(input) {
  validateEdgeMeterInput(input);
  return sha256(input);
}

export function ownerReferenceHash(reference) {
  validateOwnerReference(reference);
  return sha256(reference);
}

export function isAvailableReference(reference) {
  validateOwnerReference(reference);
  return reference.state === 'AVAILABLE';
}

export function cloneFrozen(value) {
  return deepFreeze(cloneCanonical(value));
}

export function nullableReferenceTime(reference) {
  validateOwnerReference(reference);
  return reference.availableAtMs;
}
