import {
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from '../../dock/src/index.mjs';
import {
  DIMENSION_KEYS,
  SELECTION_EVIDENCE_KINDS,
} from './constants.mjs';
import {
  capitalWaterfallProjection,
  validateEdgeMeterReport,
} from './report.mjs';

function validateReport(report) {
  try {
    validateEdgeMeterReport(report);
  } catch (error) {
    const cause = typeof error?.code === 'string' ? ` (${error.code})` : '';
    throw contractError(
      'EDGE_PREVIEW_REPORT_INVALID',
      `cockpit projection requires an intact deterministic EdgeMeterReportV1 fixture${cause}`,
    );
  }
}

function chooseRecord(report) {
  return report.records.find((record) => record.status === 'ATTRIBUTABLE')
    ?? report.records.find((record) => record.recordKind === 'MEASUREMENT')
    ?? null;
}

function waterfall(record) {
  const capital = capitalWaterfallProjection(record);
  if (capital === null) return null;
  return {
    canonicalNet: {
      amount: capital.canonicalNetKnown,
      estimatedRange: cloneCanonical(capital.canonicalNetEstimatedRange),
      sourceRef: cloneCanonical(capital.canonicalEconomicReportRef),
      recomputedByEdgeMeter: false,
    },
    signal: {
      grossPricePnl: cloneCanonical(capital.measures.grossPricePnl),
      basisContribution: cloneCanonical(capital.measures.basisContribution),
      directionalContribution: cloneCanonical(capital.measures.directionalContribution),
    },
    executionAndCosts: {
      executionCostBasis: capital.executionCostBasis,
      executionShortfall: cloneCanonical(capital.measures.executionShortfall),
      fees: cloneCanonical(capital.measures.fees),
      spread: cloneCanonical(capital.measures.spread),
      slippage: cloneCanonical(capital.measures.slippage),
      funding: cloneCanonical(capital.measures.funding),
      borrow: cloneCanonical(capital.measures.borrow),
      recovery: cloneCanonical(capital.measures.recovery),
      oneLegExposure: cloneCanonical(capital.measures.oneLegExposure),
    },
    residual: cloneCanonical(capital.measures.unexplainedResidual),
    totalsRecomputed: false,
  };
}

function timing(record) {
  if (record?.grossBridge?.state !== 'AVAILABLE') return null;
  return {
    decisionBenchmarkGross: record.grossBridge.decisionBenchmarkGross,
    timingEffect: record.grossBridge.timingEffect,
    executionDelta: record.grossBridge.executionDelta,
    bridgeResidual: record.grossBridge.bridgeResidual,
    actualGross: record.grossBridge.actualGross,
    latencyMs: record.grossBridge.latencyMs,
    pathRef: cloneCanonical(record.grossBridge.pathRef),
    horizonRef: cloneCanonical(record.grossBridge.horizonRef),
    latencyIsMonetary: false,
    identityProven: record.grossBridge.identityProven,
    includedInCapitalNet: false,
    methodRef: cloneCanonical(record.grossBridge.methodRef),
  };
}

function selection(record) {
  if (record?.qEvidence === null || record?.qEvidence === undefined) return null;
  return Object.fromEntries(SELECTION_EVIDENCE_KINDS.map((kind) => [kind, {
    ...cloneCanonical(record.qEvidence.selectionEvidenceProjection[kind]),
    authority: 'Q_REFERENCE_ONLY',
  }]));
}

function breakdownSummary(report) {
  return Object.fromEntries(DIMENSION_KEYS.map((dimension) => {
    const rows = report.breakdowns[dimension].rows;
    return [dimension, {
      groupCount: rows.length,
      unknownGroupCount: rows.filter((row) => row.dimensionState !== 'AVAILABLE').length,
      aggregateAmount: null,
      aggregationState: 'REFERENCE_ONLY_NO_LOCAL_PNL_TOTAL',
    }];
  }));
}

function productSurface(report, record) {
  const capital = capitalWaterfallProjection(record);
  const source = `frontier.edge-meter:EdgeMeterReportV1:${report.reportHash}`;
  const datum = (fieldId, label, value, unavailableReason = null) => ({
    fieldId,
    label,
    value,
    truthLabel: value === null ? 'MISSING' : 'SYNTHETIC_ONLY',
    canonicalSource: source,
    unavailableReason: value === null ? unavailableReason : null,
  });
  return {
    surfaceId: 'pnl',
    label: 'Edge Meter',
    bindingState: 'DIRECTOR_MOUNT_REQUIRED',
    truthLabel: 'SYNTHETIC_ONLY',
    canonicalSource: source,
    evaluatedAtMs: report.evaluatedAtMs,
    summary: `Fixture-only measurement posture: ${report.reportState}`,
    blocker: 'DIRECTOR_MOUNT_REQUIRED',
    controlIds: [],
    correlationId: null,
    evidence: [
      datum('measurement-state', 'measurement state', report.reportState),
      datum(
        'canonical-net',
        'canonical net',
        capital?.canonicalNetKnown === null || capital?.canonicalNetKnown === undefined
          ? null
          : `${capital.canonicalNetKnown} ${record.valuationAsset}`,
        capital === null ? 'CAPITAL_PROJECTION_UNAVAILABLE' : 'CAPITAL_NET_KNOWN_UNAVAILABLE',
      ),
      datum(
        'timing-bridge',
        'timing bridge',
        record?.grossBridge?.state ?? null,
        'GROSS_BRIDGE_UNAVAILABLE',
      ),
      datum(
        'uncertainty',
        'uncertainty',
        record?.qEvidence?.uncertaintyState ?? null,
        'Q_UNCERTAINTY_UNAVAILABLE',
      ),
    ],
  };
}

export function projectEdgeMeterCockpit(report) {
  validateReport(report);
  const record = chooseRecord(report);
  const payload = {
    schema: 'EdgeMeterCockpitProjectionV1',
    version: 1,
    truthClass: 'FIXTURE_PROJECTION',
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    surfaceId: 'pnl',
    moduleId: 'F8',
    extensionId: 'frontier.edge-meter',
    bindingState: 'DIRECTOR_MOUNT_REQUIRED',
    truthLabel: 'SYNTHETIC_ONLY',
    reportRef: {
      reportId: report.reportId,
      reportHash: report.reportHash,
      evaluatedAtMs: report.evaluatedAtMs,
    },
    measurementState: report.reportState,
    stateCounts: cloneCanonical(report.stateCounts),
    denominator: {
      inputRecordCount: report.inputRecordCount,
      uniqueMeasurementCount: report.uniqueMeasurementCount,
      duplicateIdenticalCount: report.duplicateIdenticalCount,
      identityConflictCount: report.identityConflictCount,
    },
    selectedMeasurement: record === null ? null : {
      measurementId: record.measurementId,
      status: record.status,
      reasonCodes: cloneCanonical(record.reasonCodes),
      labelKind: record.labelKind,
      cohort: record.cohort,
      informationCutoffMs: record.informationCutoffMs,
      horizon: cloneCanonical(record.horizon),
      valuationAsset: record.valuationAsset,
      comparabilitySignature: record.comparabilitySignature,
    },
    attributionWaterfall: waterfall(record),
    signalTimingBridge: timing(record),
    rejectDisposition: record?.decisionDisposition === null || record?.decisionDisposition === undefined
      ? null
      : {
        action: record.decisionDisposition.action,
        reasonCodes: cloneCanonical(record.decisionDisposition.reasonCodes),
        monetaryRejectEffect: null,
      },
    uncertainty: record?.qEvidence === null || record?.qEvidence === undefined
      ? null
      : {
        state: record.qEvidence.uncertaintyState,
        interval: cloneCanonical(record.qEvidence.uncertaintyInterval),
        unit: record.qEvidence.uncertaintyUnit,
        coverageState: record.qEvidence.coverageState,
        sourceRef: cloneCanonical(record.ownerRefs.uncertainty),
        recomputedByEdgeMeter: false,
      },
    calibration: record?.qEvidence === null || record?.qEvidence === undefined
      ? null
      : {
        state: record.qEvidence.calibrationState,
        sourceRef: cloneCanonical(record.ownerRefs.calibration),
        recalibratedByEdgeMeter: false,
      },
    selectionEvidence: selection(record),
    breakdowns: breakdownSummary(report),
    productSurfaceProjection: productSurface(report, record),
    controls: [],
    effectAllowed: false,
    measurementOnly: true,
    profitClaim: false,
    edgeProven: false,
    mounted: false,
    integrated: false,
    limitations: [
      'FIXTURE_ONLY',
      'SYNTHETIC_ONLY',
      'MEASUREMENT_ONLY',
      'NO_LOCAL_PNL_TOTAL',
      'NO_PROFIT_CLAIM',
      'UNWIRED',
    ],
  };
  return deepFreeze({ ...payload, projectionHash: sha256(payload) });
}
