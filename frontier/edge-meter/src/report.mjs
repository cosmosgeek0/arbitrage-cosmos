import {
  canonicalize,
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from '../../dock/src/index.mjs';
import {
  CAPITAL_MEASURE_KEYS,
  DIMENSION_KEYS,
  MAX_BATCH_ITEMS,
  MAX_REPORT_BYTES,
  OWNER_REFERENCE_KEYS,
  POST_HORIZON_REFERENCE_KEYS,
  PRE_DECISION_REFERENCE_KEYS,
  RECORD_STATES,
  SELECTION_EVIDENCE_KINDS,
} from './constants.mjs';
import {
  edgeMeterInputHash,
  ownerReferenceHash,
  parseEdgeMeterBatch,
} from './contracts.mjs';
import {
  compareExactDecimals,
  sumExactDecimals,
} from './exact-decimal.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validText(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u001f]/.test(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function add(set, code) {
  set.add(code);
}

function requiredReferenceKeys(item) {
  const shared = [
    'assessment',
    'outcome',
    'evidence',
    'calibration',
    'abstention',
    'partition',
    'embargo',
    'pointInTimeJoin',
    'uncertainty',
    'multiplicity',
    'deflatedPerformance',
    'selectionPressure',
  ];
  if (item.cohort === 'ACTED') return ['proposal', ...shared, 'economicReport', 'fills', 'costs', 'liabilities'];
  if (item.cohort === 'CONTROL') return shared;
  return ['proposal', ...shared];
}

function evaluateReferences(item, evaluatedAtMs, reasons) {
  const states = {
    divergent: false,
    nonComparable: false,
    insufficient: false,
  };
  for (const key of OWNER_REFERENCE_KEYS) {
    const reference = item.ownerRefs[key];
    if (reference.state === 'DIVERGENT') {
      states.divergent = true;
      add(reasons, `REFERENCE_DIVERGENT:${key.toUpperCase()}`);
    }
    if (reference.state === 'AVAILABLE' && reference.availableAtMs > evaluatedAtMs) {
      states.divergent = true;
      add(reasons, `REFERENCE_AVAILABLE_AFTER_EVALUATION:${key.toUpperCase()}`);
    }
    if (PRE_DECISION_REFERENCE_KEYS.includes(key)
      && reference.state === 'AVAILABLE'
      && reference.availableAtMs > item.informationCutoffMs) {
      states.nonComparable = true;
      add(reasons, `POINT_IN_TIME_CUTOFF_VIOLATION:${key.toUpperCase()}`);
    }
    if (POST_HORIZON_REFERENCE_KEYS.includes(key)
      && reference.state === 'AVAILABLE'
      && reference.eventTimeMs < item.horizon.endMs) {
      states.divergent = true;
      add(reasons, `POST_HORIZON_REFERENCE_PREMATURE:${key.toUpperCase()}`);
    }
  }
  for (const key of requiredReferenceKeys(item)) {
    const state = item.ownerRefs[key].state;
    if (state === 'MISSING' || state === 'UNKNOWN' || state === 'NOT_APPLICABLE') {
      states.insufficient = true;
      add(reasons, `REQUIRED_REFERENCE_${state}:${key.toUpperCase()}`);
    }
  }
  return states;
}

function evaluateQ(item, reasons) {
  const states = {
    abstain: item.qEvidence.abstentionAction === 'ABSTAIN_UNKNOWN',
    nonComparable: false,
    insufficient: false,
  };
  if (states.abstain) item.qEvidence.abstentionReasonCodes.forEach((reason) => add(reasons, `Q_ABSTAIN:${reason}`));
  if (item.qEvidence.abstentionAction === 'UNAVAILABLE') {
    states.insufficient = true;
    add(reasons, 'Q_ABSTENTION_UNAVAILABLE');
  }
  if (item.qEvidence.partitionClass !== 'FORWARD_ONLY') {
    states.nonComparable = true;
    add(reasons, 'HISTORICAL_FIT_NOT_FORWARD_EVIDENCE');
  }
  for (const [field, value] of [
    ['HOLDOUT', item.qEvidence.holdoutState],
    ['EMBARGO', item.qEvidence.embargoState],
    ['POINT_IN_TIME_JOIN', item.qEvidence.pointInTimeJoinState],
  ]) {
    if (value === 'NOT_GRANTED' || value === 'UNPROVEN') {
      states.nonComparable = true;
      add(reasons, `Q_${field}_${value}`);
    } else if (value === 'UNKNOWN') {
      states.insufficient = true;
      add(reasons, `Q_${field}_UNKNOWN`);
    }
  }
  for (const [field, value] of [
    ['CALIBRATION', item.qEvidence.calibrationState],
    ['UNCERTAINTY', item.qEvidence.uncertaintyState],
  ]) {
    if (value !== 'AVAILABLE') {
      states.insufficient = true;
      add(reasons, `Q_${field}_${value}`);
    }
  }
  if (item.qEvidence.coverageState !== 'AVAILABLE') {
    states.insufficient = true;
    add(reasons, `Q_COVERAGE_${item.qEvidence.coverageState}`);
  }
  item.qEvidence.selectionEvidence.forEach((entry) => {
    if (entry.state !== 'AVAILABLE') {
      states.insufficient = true;
      add(reasons, `Q_${entry.kind}_${entry.state}`);
    }
  });
  return states;
}

function bridgeIdentityProven(bridge) {
  if (bridge.state !== 'AVAILABLE') return false;
  const projected = sumExactDecimals([
    bridge.decisionBenchmarkGross,
    bridge.timingEffect,
    bridge.executionDelta,
    bridge.bridgeResidual,
  ]);
  return compareExactDecimals(projected, bridge.actualGross) === 0;
}

function evaluateCapitalAndBridge(item, reasons) {
  const states = { divergent: false, nonComparable: false, insufficient: false };
  if (item.cohort !== 'ACTED') {
    if (item.capitalProjection.state !== 'NOT_APPLICABLE') {
      states.nonComparable = true;
      add(reasons, 'NON_ACTED_CAPITAL_PNL_FORBIDDEN');
    }
    if (item.grossBridge.state !== 'NOT_APPLICABLE') {
      states.nonComparable = true;
      add(reasons, 'NON_ACTED_GROSS_BRIDGE_FORBIDDEN');
    }
    return states;
  }

  if (item.capitalProjection.state === 'DIVERGENT') {
    states.divergent = true;
    add(reasons, 'CAPITAL_PROJECTION_DIVERGENT');
  } else if (item.capitalProjection.state !== 'AVAILABLE') {
    states.insufficient = true;
    add(reasons, `CAPITAL_PROJECTION_${item.capitalProjection.state}`);
  } else {
    const capital = item.capitalProjection;
    if (item.labelKind === 'REAL' && capital.scopeKind !== 'CLOSED_OUTCOME') {
      states.nonComparable = true;
      add(reasons, 'REAL_ACTED_OUTCOME_NOT_CLOSED');
    }
    if (capital.accountingStatus === 'DIVERGENT' || capital.accountingTruthState === 'DIVERGENT') {
      states.divergent = true;
      add(reasons, 'CAPITAL_ACCOUNTING_DIVERGENT');
    }
    if (capital.accountingStatus !== 'COMPLETE'
      || capital.accountingTruthState !== 'COMPLETE'
      || capital.accountingIdentityProven !== true
      || capital.netKnown === null) {
      states.insufficient = true;
      add(reasons, 'CAPITAL_ACCOUNTING_IDENTITY_INCOMPLETE');
    }
    if (!['HIGH', 'MEDIUM'].includes(capital.accountingConfidence)) {
      states.insufficient = true;
      add(reasons, `CAPITAL_ACCOUNTING_CONFIDENCE_${capital.accountingConfidence}`);
    }
    if (capital.netEstimatedRange !== null) {
      states.insufficient = true;
      add(reasons, 'CAPITAL_NET_REMAINS_ESTIMATED');
    }
    if (capital.divergentReasons.length > 0) {
      states.divergent = true;
      add(reasons, 'CAPITAL_OWNER_DIVERGENT_REASONS_PRESENT');
    }
    for (const [measureKey, measure] of Object.entries(capital.measures)) {
      if (measure.status === 'DIVERGENT') {
        states.divergent = true;
        add(reasons, `CAPITAL_MEASURE_DIVERGENT:${measureKey.toUpperCase()}`);
      } else if (measure.status === 'MISSING' || measure.status === 'ESTIMATED') {
        states.insufficient = true;
        add(reasons, `CAPITAL_MEASURE_${measure.status}:${measureKey.toUpperCase()}`);
      }
    }
    const residual = capital.measures.unexplainedResidual;
    if (residual.status === 'DIVERGENT') {
      states.divergent = true;
      add(reasons, 'CAPITAL_UNRESOLVED_RESIDUAL_DIVERGENT');
    } else if (residual.status !== 'KNOWN' || residual.knownAmount === null) {
      states.insufficient = true;
      add(reasons, 'CAPITAL_UNRESOLVED_RESIDUAL_UNKNOWN');
    } else if (compareExactDecimals(residual.knownAmount, '0') !== 0) {
      states.insufficient = true;
      add(reasons, 'CAPITAL_UNRESOLVED_RESIDUAL_NON_ZERO');
    }
    const overlap = capital.includedComponentIds.filter((id) => capital.excludedComponentIds.includes(id));
    if (overlap.length > 0) {
      states.divergent = true;
      add(reasons, 'CAPITAL_INCLUDED_EXCLUDED_COMPONENT_CONFLICT');
    }
    const measureComponentIds = sorted(Object.values(capital.measures).flatMap((measure) => measure.componentIds));
    const dispositionComponentIds = sorted([...capital.includedComponentIds, ...capital.excludedComponentIds]);
    if (canonicalize(measureComponentIds) !== canonicalize(dispositionComponentIds)) {
      states.divergent = true;
      add(reasons, 'CAPITAL_COMPONENT_INVENTORY_MISMATCH');
    }
  }

  if (item.grossBridge.state === 'DIVERGENT') {
    states.divergent = true;
    add(reasons, 'GROSS_BRIDGE_DIVERGENT');
  } else if (item.grossBridge.state !== 'AVAILABLE') {
    states.insufficient = true;
    add(reasons, `GROSS_BRIDGE_${item.grossBridge.state}`);
  } else {
    if (!bridgeIdentityProven(item.grossBridge)) {
      states.divergent = true;
      add(reasons, 'GROSS_BRIDGE_IDENTITY_MISMATCH');
    }
    if (compareExactDecimals(item.grossBridge.bridgeResidual, '0') !== 0) {
      states.insufficient = true;
      add(reasons, 'GROSS_BRIDGE_RESIDUAL_NON_ZERO');
    }
    const capitalGross = item.capitalProjection.state === 'AVAILABLE'
      ? item.capitalProjection.measures.grossPricePnl
      : null;
    if (capitalGross?.status !== 'KNOWN' || capitalGross.knownAmount === null) {
      states.insufficient = true;
      add(reasons, 'GROSS_BRIDGE_CAPITAL_GROSS_UNAVAILABLE');
    } else if (compareExactDecimals(item.grossBridge.actualGross, capitalGross.knownAmount) !== 0) {
      states.divergent = true;
      add(reasons, 'GROSS_BRIDGE_CAPITAL_GROSS_MISMATCH');
    }
    const fillEventTimeMs = item.ownerRefs.fills.eventTimeMs;
    if (fillEventTimeMs < item.horizon.startMs || fillEventTimeMs > item.horizon.endMs) {
      states.divergent = true;
      add(reasons, 'GROSS_BRIDGE_FILL_OUTSIDE_HORIZON');
    }
  }
  return states;
}

function evaluateDimensions(item, reasons) {
  let insufficient = false;
  for (const key of DIMENSION_KEYS) {
    const state = item.dimensions[key].state;
    const permittedNonActedAbsence = item.cohort !== 'ACTED'
      && ['turnover', 'capacity'].includes(key)
      && state === 'NOT_APPLICABLE';
    if (state !== 'AVAILABLE' && !permittedNonActedAbsence) {
      insufficient = true;
      add(reasons, `BREAKDOWN_DIMENSION_${key.toUpperCase()}_${state}`);
    }
  }
  return insufficient;
}

function comparabilitySignature(item) {
  const dimensionAxes = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, {
    value: item.dimensions[key].value,
    refHash: ownerReferenceHash(item.ownerRefs[item.dimensions[key].ownerRefKey]),
  }]));
  const referenceAxes = Object.fromEntries([
    'proposal',
    'assessment',
    'partition',
    'embargo',
    'pointInTimeJoin',
    'calibration',
    'uncertainty',
  ].map((key) => [key, {
    recordRevision: item.ownerRefs[key].recordRevision,
    contentHash: item.ownerRefs[key].contentHash,
  }]));
  return sha256({
    schema: 'EdgeMeterComparabilitySignatureV1',
    labelKind: item.labelKind,
    cohort: item.cohort,
    valuationAsset: item.valuationAsset,
    horizonMs: item.horizon.endMs - item.horizon.startMs,
    partitionClass: item.qEvidence.partitionClass,
    capitalPolicy: item.capitalProjection.state === 'AVAILABLE' ? {
      policyRefHash: ownerReferenceHash(item.ownerRefs[item.capitalProjection.policyRefKey]),
      pricePnlBasis: item.capitalProjection.pricePnlBasis,
      executionCostBasis: item.capitalProjection.executionCostBasis,
    } : null,
    referenceAxes,
    dimensionAxes,
  });
}

function selectionEvidenceProjection(item) {
  return Object.fromEntries(SELECTION_EVIDENCE_KINDS.map((kind, index) => {
    const evidence = item.qEvidence.selectionEvidence[index];
    return [kind, {
      state: evidence.state,
      displayValue: evidence.displayValue,
      sourceRefKey: evidence.sourceRefKey,
      sourceRefHash: ownerReferenceHash(item.ownerRefs[evidence.sourceRefKey]),
      recomputedByEdgeMeter: false,
    }];
  }));
}

function resolvedDimensions(item) {
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [key, {
    ...cloneCanonical(item.dimensions[key]),
    ownerRef: cloneCanonical(item.ownerRefs[item.dimensions[key].ownerRefKey]),
  }]));
}

function resolvedGrossBridge(item) {
  return {
    ...cloneCanonical(item.grossBridge),
    methodRef: cloneCanonical(item.ownerRefs[item.grossBridge.methodRefKey]),
    pathRef: cloneCanonical(item.ownerRefs[item.grossBridge.pathRefKey]),
    horizonRef: cloneCanonical(item.ownerRefs[item.grossBridge.horizonRefKey]),
  };
}

function resolvedCapitalProjection(item) {
  return {
    ...cloneCanonical(item.capitalProjection),
    policyRef: cloneCanonical(item.ownerRefs[item.capitalProjection.policyRefKey]),
  };
}

function projectRecord(item, evaluatedAtMs) {
  const reasons = new Set();
  const refs = evaluateReferences(item, evaluatedAtMs, reasons);
  const q = evaluateQ(item, reasons);
  const capital = evaluateCapitalAndBridge(item, reasons);
  const dimensionsInsufficient = evaluateDimensions(item, reasons);
  let horizonNonComparable = false;
  let horizonInsufficient = false;
  if (item.horizon.startMs < item.informationCutoffMs) {
    horizonNonComparable = true;
    add(reasons, 'OUTCOME_HORIZON_PRECEDES_INFORMATION_CUTOFF');
  }
  if (item.horizon.endMs > evaluatedAtMs) {
    horizonInsufficient = true;
    add(reasons, 'OUTCOME_HORIZON_NOT_MATURE');
  }

  const divergent = refs.divergent || capital.divergent;
  const nonComparable = refs.nonComparable || q.nonComparable || capital.nonComparable || horizonNonComparable;
  const insufficient = refs.insufficient || q.insufficient || capital.insufficient || dimensionsInsufficient || horizonInsufficient;
  const status = divergent
    ? 'DIVERGENT'
    : nonComparable
      ? 'NON_COMPARABLE'
      : q.abstain
        ? 'ABSTAIN_UNKNOWN'
        : insufficient
          ? 'INSUFFICIENT_EVIDENCE'
          : 'ATTRIBUTABLE';
  const inputHash = edgeMeterInputHash(item);
  const payload = {
    schema: 'EdgeMeterRecordProjectionV1',
    version: 1,
    recordKind: 'MEASUREMENT',
    measurementId: item.measurementId,
    inputHash,
    inputHashes: [inputHash],
    status,
    reasonCodes: sorted(reasons),
    labelKind: item.labelKind,
    cohort: item.cohort,
    informationCutoffMs: item.informationCutoffMs,
    horizon: cloneCanonical(item.horizon),
    evaluatedAtMs,
    valuationAsset: item.valuationAsset,
    comparabilitySignature: status === 'ATTRIBUTABLE' ? comparabilitySignature(item) : null,
    ownerRefs: cloneCanonical(item.ownerRefs),
    qEvidence: {
      ...cloneCanonical(item.qEvidence),
      selectionEvidenceProjection: selectionEvidenceProjection(item),
      valuesRecomputedByEdgeMeter: false,
    },
    capitalProjection: resolvedCapitalProjection(item),
    grossBridge: {
      ...resolvedGrossBridge(item),
      identityProven: bridgeIdentityProven(item.grossBridge),
      aggregationRole: 'NON_ACCOUNTING_SIGNAL_TIMING_BRIDGE',
      includedInCapitalNet: false,
      latencyIsMonetary: false,
    },
    decisionDisposition: cloneCanonical(item.decisionDisposition),
    dimensions: resolvedDimensions(item),
    claimBoundary: {
      measurementOnly: true,
      realizedProfitClaim: false,
      profitableClaim: false,
      edgeProven: false,
      sizingAuthority: false,
      tradingAuthority: false,
      modelSelectionAuthority: false,
      calibrationAuthority: false,
      effectAllowed: false,
    },
  };
  return deepFreeze({ ...payload, recordHash: sha256(payload) });
}

function conflictRecord(measurementId, inputHashes, evaluatedAtMs) {
  const payload = {
    schema: 'EdgeMeterRecordProjectionV1',
    version: 1,
    recordKind: 'IDENTITY_CONFLICT',
    measurementId,
    inputHash: null,
    inputHashes: sorted(inputHashes),
    status: 'DIVERGENT',
    reasonCodes: ['DUPLICATE_IDENTITY_HASH_CONFLICT'],
    labelKind: null,
    cohort: null,
    informationCutoffMs: null,
    horizon: null,
    evaluatedAtMs,
    valuationAsset: null,
    comparabilitySignature: null,
    ownerRefs: null,
    qEvidence: null,
    capitalProjection: null,
    grossBridge: null,
    decisionDisposition: null,
    dimensions: null,
    claimBoundary: {
      measurementOnly: true,
      realizedProfitClaim: false,
      profitableClaim: false,
      edgeProven: false,
      sizingAuthority: false,
      tradingAuthority: false,
      modelSelectionAuthority: false,
      calibrationAuthority: false,
      effectAllowed: false,
    },
  };
  return deepFreeze({ ...payload, recordHash: sha256(payload) });
}

function emptyStateCounts() {
  return Object.fromEntries(RECORD_STATES.map((state) => [state, 0]));
}

function stateCounts(records) {
  const counts = emptyStateCounts();
  records.forEach((record) => { counts[record.status] += 1; });
  return counts;
}

function reportState(records) {
  if (records.length === 0) return 'INSUFFICIENT_EVIDENCE';
  for (const state of ['DIVERGENT', 'NON_COMPARABLE', 'ABSTAIN_UNKNOWN', 'INSUFFICIENT_EVIDENCE']) {
    if (records.some((record) => record.status === state)) return state;
  }
  return 'ATTRIBUTABLE';
}

function breakdownRows(records, dimension) {
  const groups = new Map();
  for (const record of records) {
    if (record.recordKind !== 'MEASUREMENT') continue;
    const value = record.dimensions[dimension];
    const refHash = ownerReferenceHash(value.ownerRef);
    // Evidence class, action cohort, and valuation unit are hard grouping axes.
    // This prevents a REAL row from absorbing HYPOTHETICAL/REPLAY counts even
    // though EdgeMeter intentionally produces no local monetary aggregate.
    const key = `${record.labelKind}\u0000${record.cohort}\u0000${record.valuationAsset}\u0000${value.state}\u0000${value.value ?? ''}\u0000${refHash}`;
    const group = groups.get(key) ?? {
      labelKind: record.labelKind,
      cohort: record.cohort,
      valuationAsset: record.valuationAsset,
      dimensionState: value.state,
      dimensionValue: value.value,
      sourceRefHash: refHash,
      measurementIds: [],
      statusCounts: emptyStateCounts(),
      canonicalEconomicReportRefIds: [],
    };
    group.measurementIds.push(record.measurementId);
    group.statusCounts[record.status] += 1;
    if (record.ownerRefs.economicReport.state === 'AVAILABLE') {
      group.canonicalEconomicReportRefIds.push(record.ownerRefs.economicReport.refId);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      measurementIds: sorted(group.measurementIds),
      canonicalEconomicReportRefIds: sorted(group.canonicalEconomicReportRefIds),
      aggregationState: 'REFERENCE_ONLY_NO_LOCAL_PNL_TOTAL',
      aggregateAmount: null,
      rankingProduced: false,
      noProfitClaim: true,
    }))
    .sort((left, right) => compareText(
      `${left.labelKind}:${left.cohort}:${left.valuationAsset}:${left.dimensionState}:${left.dimensionValue ?? ''}:${left.sourceRefHash}`,
      `${right.labelKind}:${right.cohort}:${right.valuationAsset}:${right.dimensionState}:${right.dimensionValue ?? ''}:${right.sourceRefHash}`,
    ));
}

function buildBreakdowns(records) {
  return Object.fromEntries(DIMENSION_KEYS.map((dimension) => [dimension, {
    dimension,
    rows: breakdownRows(records, dimension),
    aggregationAuthority: 'NONE',
    inferredByEdgeMeter: false,
  }]));
}

const REPORT_LIMITATIONS = Object.freeze([
  'FIXTURE_ONLY',
  'MEASUREMENT_ONLY',
  'NO_LOCAL_PNL_TOTAL',
  'NO_PROFIT_CLAIM',
  'NO_CAPITAL_RISK_Q_OR_EXECUTION_AUTHORITY',
  'UNWIRED',
]);

function buildReportPayload({
  reportId,
  evaluatedAtMs,
  inputRecordCount,
  uniqueMeasurementCount,
  duplicateIdenticalCount,
  identityConflictCount,
  records,
}) {
  return {
    schema: 'EdgeMeterReportV1',
    version: 1,
    reportId,
    evaluatedAtMs,
    truthClass: 'ADVISORY',
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    reportState: reportState(records),
    inputRecordCount,
    uniqueMeasurementCount,
    duplicateIdenticalCount,
    identityConflictCount,
    stateCounts: stateCounts(records),
    records,
    breakdowns: buildBreakdowns(records),
    capitalNetRecomputed: false,
    qStatisticsRecomputed: false,
    calibrationPerformed: false,
    modelSelectionPerformed: false,
    orderOrSizingEffect: false,
    profitClaim: false,
    limitations: [...REPORT_LIMITATIONS],
  };
}

function inputFromRecordProjection(record) {
  const qEvidence = cloneCanonical(record.qEvidence);
  delete qEvidence.selectionEvidenceProjection;
  delete qEvidence.valuesRecomputedByEdgeMeter;
  const capitalProjection = cloneCanonical(record.capitalProjection);
  delete capitalProjection.policyRef;
  const grossBridge = cloneCanonical(record.grossBridge);
  for (const key of [
    'methodRef', 'pathRef', 'horizonRef', 'identityProven', 'aggregationRole',
    'includedInCapitalNet', 'latencyIsMonetary',
  ]) delete grossBridge[key];
  const dimensions = Object.fromEntries(Object.entries(record.dimensions).map(([key, value]) => {
    const dimension = cloneCanonical(value);
    delete dimension.ownerRef;
    return [key, dimension];
  }));
  return {
    schema: 'EdgeMeterInputV1',
    version: 1,
    measurementId: record.measurementId,
    labelKind: record.labelKind,
    cohort: record.cohort,
    informationCutoffMs: record.informationCutoffMs,
    horizon: cloneCanonical(record.horizon),
    valuationAsset: record.valuationAsset,
    ownerRefs: cloneCanonical(record.ownerRefs),
    qEvidence,
    capitalProjection,
    grossBridge,
    decisionDisposition: cloneCanonical(record.decisionDisposition),
    dimensions,
  };
}

function validatedRecordProjection(record, evaluatedAtMs) {
  try {
    if (record?.recordKind === 'MEASUREMENT') {
      const expected = projectRecord(inputFromRecordProjection(record), evaluatedAtMs);
      if (canonicalize(record) !== canonicalize(expected)) {
        fail('EDGE_REPORT_RECORD_INVALID', `measurement record ${String(record.measurementId)} does not match its deterministic projection`);
      }
      return expected;
    }
    if (record?.recordKind === 'IDENTITY_CONFLICT'
      && validText(record.measurementId, 256)
      && Array.isArray(record.inputHashes)
      && record.inputHashes.length >= 2
      && record.inputHashes.length <= MAX_BATCH_ITEMS
      && record.inputHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))) {
      const expected = conflictRecord(record.measurementId, record.inputHashes, evaluatedAtMs);
      if (canonicalize(record) !== canonicalize(expected)) {
        fail('EDGE_REPORT_RECORD_INVALID', `identity conflict ${String(record.measurementId)} is malformed`);
      }
      return expected;
    }
  } catch (error) {
    const cause = typeof error?.code === 'string' ? ` (${error.code})` : '';
    fail('EDGE_REPORT_RECORD_INVALID', `report record reconstruction failed${cause}`);
  }
  fail('EDGE_REPORT_RECORD_INVALID', 'report contains an unknown record projection');
}

export function validateEdgeMeterReport(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('EDGE_REPORT_INVALID', 'EdgeMeter report must be an object');
  }
  const report = cloneCanonical(input);
  if (Buffer.byteLength(canonicalize(report), 'utf8') > MAX_REPORT_BYTES) {
    fail('RESOURCE_ENVELOPE_EXCEEDED', `EdgeMeter report exceeds ${MAX_REPORT_BYTES} deterministic fixture bytes`);
  }
  if (!/^[a-f0-9]{64}$/.test(report.reportHash ?? '')) {
    fail('EDGE_REPORT_HASH_INVALID', 'EdgeMeter report requires an exact SHA-256 report hash');
  }
  const suppliedPayload = cloneCanonical(report);
  delete suppliedPayload.reportHash;
  if (sha256(suppliedPayload) !== report.reportHash) {
    fail('EDGE_REPORT_HASH_MISMATCH', 'EdgeMeter report hash does not match its payload');
  }
  if (report.schema !== 'EdgeMeterReportV1'
    || report.version !== 1
    || !validText(report.reportId, 256)
    || !validTime(report.evaluatedAtMs)
    || !Number.isSafeInteger(report.duplicateIdenticalCount)
    || report.duplicateIdenticalCount < 0
    || !Array.isArray(report.records)
    || report.records.length > MAX_BATCH_ITEMS) {
    fail('EDGE_REPORT_INVALID', 'EdgeMeter report header or record envelope is invalid');
  }
  const records = report.records.map((record) => validatedRecordProjection(record, report.evaluatedAtMs));
  const sortedIds = records.map((record) => record.measurementId);
  if (new Set(sortedIds).size !== sortedIds.length
    || sortedIds.some((value, index) => index > 0 && compareText(sortedIds[index - 1], value) >= 0)) {
    fail('EDGE_REPORT_RECORD_ORDER_INVALID', 'report measurement identities must be sorted and unique');
  }
  const identityConflictCount = records.filter((record) => record.recordKind === 'IDENTITY_CONFLICT').length;
  const inputRecordCount = records.reduce((count, record) => count + record.inputHashes.length, 0)
    + report.duplicateIdenticalCount;
  if (inputRecordCount > MAX_BATCH_ITEMS
    || (records.length === 0 && report.duplicateIdenticalCount !== 0)) {
    fail('EDGE_REPORT_INPUT_COUNT_INVALID', 'report reconstructed input count exceeds its deterministic batch envelope');
  }
  const expectedPayload = buildReportPayload({
    reportId: report.reportId,
    evaluatedAtMs: report.evaluatedAtMs,
    inputRecordCount,
    uniqueMeasurementCount: records.length,
    duplicateIdenticalCount: report.duplicateIdenticalCount,
    identityConflictCount,
    records,
  });
  const expected = { ...expectedPayload, reportHash: sha256(expectedPayload) };
  if (canonicalize(report) !== canonicalize(expected)) {
    fail('EDGE_REPORT_STRUCTURE_INVALID', 'EdgeMeter report counts, breakdowns, states, or boundaries are inconsistent');
  }
  return true;
}

export function createEdgeMeterReport(input) {
  const batch = parseEdgeMeterBatch(input);
  const identities = new Map();
  let duplicateIdenticalCount = 0;
  for (const item of batch.items) {
    const hash = edgeMeterInputHash(item);
    const entries = identities.get(item.measurementId) ?? new Map();
    if (entries.has(hash)) duplicateIdenticalCount += 1;
    else entries.set(hash, item);
    identities.set(item.measurementId, entries);
  }

  const records = [];
  let identityConflictCount = 0;
  for (const [measurementId, entries] of [...identities.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (entries.size > 1) {
      identityConflictCount += 1;
      records.push(conflictRecord(measurementId, [...entries.keys()], batch.evaluatedAtMs));
    } else {
      records.push(projectRecord([...entries.values()][0], batch.evaluatedAtMs));
    }
  }

  const payload = buildReportPayload({
    reportId: batch.reportId,
    evaluatedAtMs: batch.evaluatedAtMs,
    inputRecordCount: batch.items.length,
    uniqueMeasurementCount: identities.size,
    duplicateIdenticalCount,
    identityConflictCount,
    records,
  });
  const report = { ...payload, reportHash: sha256(payload) };
  if (Buffer.byteLength(canonicalize(report), 'utf8') > MAX_REPORT_BYTES) {
    fail('RESOURCE_ENVELOPE_EXCEEDED', `EdgeMeter report exceeds ${MAX_REPORT_BYTES} deterministic fixture bytes`);
  }
  validateEdgeMeterReport(report);
  return deepFreeze(report);
}

export function capitalWaterfallProjection(record) {
  if (record?.recordKind !== 'MEASUREMENT' || record.capitalProjection?.state !== 'AVAILABLE') return null;
  const measures = Object.fromEntries(CAPITAL_MEASURE_KEYS.map((key) => [key, cloneCanonical(record.capitalProjection.measures[key])]));
  return deepFreeze({
    canonicalEconomicReportRef: cloneCanonical(record.ownerRefs.economicReport),
    accountingPolicyRef: cloneCanonical(record.capitalProjection.policyRef),
    accountingStatus: record.capitalProjection.accountingStatus,
    accountingIdentityProven: record.capitalProjection.accountingIdentityProven,
    canonicalNetKnown: record.capitalProjection.netKnown,
    canonicalNetEstimatedRange: cloneCanonical(record.capitalProjection.netEstimatedRange),
    measures,
    executionCostBasis: record.capitalProjection.executionCostBasis,
    totalsRecomputed: false,
  });
}
