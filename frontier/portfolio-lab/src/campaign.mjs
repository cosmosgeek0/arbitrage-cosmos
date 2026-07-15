import {
  canonicalBytes,
  cloneCanonical,
  deepFreeze,
  omitFields,
  sha256,
} from '../../dock/src/canonical.mjs';
import {
  IMPACT_CATEGORIES,
  SCENARIO_DEFINITION_STATUSES,
  SCENARIO_KINDS,
  SWEEP_DIMENSIONS,
  SWEEP_UNIT_REQUIREMENTS,
  createScenarioEvaluationInput,
  validatePortfolioSnapshot,
  validateScenarioCallerFact,
  validateScenarioEvaluationInput,
  validateUnacceptedScenarioReferenceBoundary,
} from './contracts.mjs';
import {
  buildConcentrationMap,
  buildRelationshipGraph,
  validateConcentrationMap,
  validateRelationshipGraph,
} from './analysis.mjs';
import { knownMetric, parseAtoms, validateExactMetric } from './exact.mjs';
import {
  asRecord,
  assertCanonicalJson,
  assertNoForbiddenCapabilities,
  boundedString,
  enumValue,
  exactFields,
  fail,
  requireFields,
  safeInteger,
  stringArray,
} from './errors.mjs';
import {
  BOOTSTRAP_ARCHIVE_EVIDENCE_STATUS,
  BOOTSTRAP_ARCHIVE_ROW_CLAIMS,
  BOOTSTRAP_ARCHIVE_SOURCE_REF,
  validateExactBootstrapArchiveMarkers,
} from './archive-evidence.mjs';

export { BOOTSTRAP_ARCHIVE_EVIDENCE_STATUS, BOOTSTRAP_ARCHIVE_SOURCE_REF };

export const CAMPAIGN_MODES = Object.freeze([
  'DECLARED_GRID',
  'ARCHIVED_FIXTURE_BOOTSTRAP',
  'SEEDED_SIMULATION_TABLE',
]);

export const MAX_CAMPAIGN_CASES = 64;
export const MAX_CAMPAIGN_DRAWS = 2_048;
export const MAX_CAMPAIGN_REPORT_BYTES = 2_000_000;

const ORIGINS = Object.freeze(['HYPOTHETICAL', 'SYNTHETIC']);
const TRUTH_STATES = Object.freeze(['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN', 'UNAVAILABLE']);
const UNCERTAINTY_STATES = Object.freeze(['KNOWN', 'UNKNOWN', 'UNAVAILABLE']);
const VIEW_DEFINITIONS = Object.freeze({
  drawdown: Object.freeze({
    viewId: 'portfolio-lab.drawdown-burden',
    kinds: Object.freeze([
      'BROAD_MARKET_GAP', 'SINGLE_SYMBOL_DISCONTINUITY',
      'SPREAD_WIDENING_DEPTH_EVAPORATION', 'STABLECOIN_DEPEG', 'COLLATERAL_HAIRCUT',
    ]),
  }),
  contagion: Object.freeze({
    viewId: 'portfolio-lab.contagion',
    kinds: Object.freeze([
      'CORRELATION_TO_ONE_CRISIS', 'CORRELATION_SIGN_FLIP',
      'SIMULTANEOUS_STRATEGY_CROWDING', 'SHARED_COLLATERAL_CONTENTION',
    ]),
  }),
  recoveryBurden: Object.freeze({
    viewId: 'portfolio-lab.recovery-burden',
    kinds: Object.freeze([
      'BORROW_RECALL_UNAVAILABLE', 'VENUE_OUTAGE', 'PARTIAL_FILL_REJECTED_HEDGE',
      'AMBIGUOUS_OPEN_ORDER', 'LIQUIDATION_DISTANCE_COMPRESSION',
      'RECOVERY_EXCEEDS_HOLDING_HORIZON',
    ]),
  }),
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function bootstrapArchiveClaim(evaluation) {
  return sha256({
    evaluationId: evaluation.evaluationId,
    scenarioKind: evaluation.scenarioKind,
    snapshotHash: evaluation.snapshotHash,
    scenarioReferenceHash: evaluation.scenarioReference.scenarioHash,
    scenarioDefinitionStatus: evaluation.scenarioDefinitionStatus,
    origin: evaluation.origin,
    seed: evaluation.seed,
    horizon: evaluation.horizon,
    assumptions: evaluation.assumptions,
    sweepInputs: evaluation.sweepInputs,
    impacts: evaluation.impacts,
    callerFacts: evaluation.callerFacts,
    stateChanges: evaluation.stateChanges,
    missingDependencies: evaluation.missingDependencies,
    uncertainty: evaluation.uncertainty,
    outputMode: evaluation.outputMode,
    whyNotLiveSizing: evaluation.whyNotLiveSizing,
    authorityClass: evaluation.authorityClass,
    networkMode: evaluation.networkMode,
  });
}

function validateBootstrapArchiveEvaluation(evaluation) {
  const expectedClaim = BOOTSTRAP_ARCHIVE_ROW_CLAIMS[evaluation.evaluationId];
  validateExactBootstrapArchiveMarkers(evaluation);
  if (expectedClaim === undefined || bootstrapArchiveClaim(evaluation) !== expectedClaim) {
    fail('BOOTSTRAP_ARCHIVE_INPUT_INVALID', 'archived fixture bootstrap requires an exact row claim from the hash-bound unaccepted fixture table');
  }
}

function sameCanonical(left, right) {
  return sha256(left) === sha256(right);
}

function scenarioMatrixRow(report) {
  return cloneCanonical({
    evaluationId: report.evaluationId,
    scenarioKind: report.scenarioKind,
    scenarioId: report.scenarioReference.scenarioId,
    status: report.status,
    comparativeImpact: report.comparativeImpact,
    knownImpactSubtotal: report.knownImpactSubtotal,
    uncertainty: report.callerSuppliedUncertainty,
    reasonCodes: report.reasonCodes,
    reportHash: report.reportHash,
  });
}

function portfolioViewRow(report) {
  return cloneCanonical({
    evaluationId: report.evaluationId,
    scenarioKind: report.scenarioKind,
    status: report.status,
    comparativeImpact: report.comparativeImpact,
    knownImpactSubtotal: report.knownImpactSubtotal,
    uncertainty: report.callerSuppliedUncertainty,
    horizon: report.horizon,
    stateChanges: report.stateChanges,
    reasonCodes: report.reasonCodes,
    reportHash: report.reportHash,
  });
}

function buildPortfolioViews(reports, relationshipGraphHash) {
  const select = (definition, extra = {}) => ({
    viewId: definition.viewId,
    viewClass: 'CALLER_SUPPLIED_COMPARATIVE_SCENARIO_VIEW',
    rows: reports.filter((report) => definition.kinds.includes(report.scenarioKind)).map(portfolioViewRow),
    advisoryOnly: true,
    sizingSupported: false,
    causal: false,
    limitations: ['NO_OWNER_RECOMPUTATION', 'NO_CAUSAL_OR_PROBABILITY_CLAIM', 'NO_LIVE_SIZING'],
    ...extra,
  });
  return {
    drawdown: select(VIEW_DEFINITIONS.drawdown),
    contagion: select(VIEW_DEFINITIONS.contagion, { relationshipGraphHash }),
    recoveryBurden: select(VIEW_DEFINITIONS.recoveryBurden),
  };
}

export function validatePortfolioViews(input, reports, relationshipGraphHash) {
  const views = asRecord(input, 'PortfolioViewsV1');
  exactFields(views, ['drawdown', 'contagion', 'recoveryBurden'], 'PortfolioViewsV1');
  requireFields(views, ['drawdown', 'contagion', 'recoveryBurden'], 'PortfolioViewsV1');
  if (!Array.isArray(reports) || reports.length === 0 || reports.length > MAX_CAMPAIGN_CASES) {
    fail('PORTFOLIO_VIEW_REPORT_SET_INVALID', 'portfolio views require a bounded non-empty scenario report set');
  }
  if (!/^[a-f0-9]{64}$/.test(relationshipGraphHash)) fail('GRAPH_HASH_INVALID', 'portfolio views require a relationship graph SHA-256');
  const expected = buildPortfolioViews(reports, relationshipGraphHash);
  if (!sameCanonical(views, expected)) {
    fail('PORTFOLIO_VIEW_BINDING_MISMATCH', 'portfolio views must be exact non-causal projections of validated scenario reports');
  }
  return true;
}

function hashBound(record, hashField) {
  const copy = cloneCanonical(record);
  delete copy[hashField];
  copy[hashField] = sha256(omitFields(copy, [hashField]));
  return copy;
}

function validateBoundHash(record, hashField, code) {
  if (record[hashField] !== sha256(omitFields(record, [hashField]))) fail(code, `${hashField} does not match canonical content`);
}

function subjectIds(snapshot) {
  return new Set([
    ...snapshot.positions.map((row) => row.id),
    ...snapshot.proposals.map((row) => row.id),
    ...snapshot.liabilities.map((row) => row.id),
    ...snapshot.collateral.map((row) => row.id),
    ...snapshot.venueExposures.map((row) => row.id),
  ]);
}

function aggregateImpacts(evaluation, reportingUnit) {
  const categories = new Map();
  let knownTotal = 0n;
  let knownLower = 0n;
  let knownUpper = 0n;
  let unknownCount = 0;
  for (const impact of evaluation.impacts) {
    for (const field of ['delta', 'lowerBound', 'upperBound']) {
      if (impact[field].unit !== reportingUnit) fail('IMPACT_REPORTING_UNIT_MISMATCH', `${impact.impactId}.${field} must use snapshot reporting unit`);
    }
    const row = categories.get(impact.category) ?? {
      category: impact.category,
      knownDelta: 0n,
      knownLower: 0n,
      knownUpper: 0n,
      unknownCount: 0,
      impactIds: [],
      ownerOutputRefs: [],
    };
    row.impactIds.push(impact.impactId);
    row.ownerOutputRefs.push(impact.ownerOutputRef);
    if (impact.delta.state === 'KNOWN') {
      const delta = parseAtoms(impact.delta.atoms, `${impact.impactId}.delta`);
      const lower = parseAtoms(impact.lowerBound.atoms, `${impact.impactId}.lowerBound`);
      const upper = parseAtoms(impact.upperBound.atoms, `${impact.impactId}.upperBound`);
      row.knownDelta += delta;
      row.knownLower += lower;
      row.knownUpper += upper;
      knownTotal += delta;
      knownLower += lower;
      knownUpper += upper;
    } else {
      row.unknownCount += 1;
      unknownCount += 1;
    }
    categories.set(impact.category, row);
  }
  const attribution = [...categories.values()].map((row) => ({
    category: row.category,
    comparativeDelta: row.unknownCount === 0 ? knownMetric(row.knownDelta, reportingUnit) : null,
    knownDeltaSubtotal: knownMetric(row.knownDelta, reportingUnit),
    lowerBound: row.unknownCount === 0 ? knownMetric(row.knownLower, reportingUnit) : null,
    upperBound: row.unknownCount === 0 ? knownMetric(row.knownUpper, reportingUnit) : null,
    unknownCount: row.unknownCount,
    impactIds: [...row.impactIds].sort(compareText),
    ownerOutputRefs: [...new Set(row.ownerOutputRefs)].sort(compareText),
    causalAttribution: false,
  })).sort((left, right) => compareText(left.category, right.category));
  return {
    knownTotal,
    knownLower,
    knownUpper,
    unknownCount,
    attribution,
  };
}

export function evaluateScenarioFixture(snapshotInput, evaluationInput) {
  validatePortfolioSnapshot(snapshotInput);
  validateScenarioEvaluationInput(evaluationInput);
  const snapshot = cloneCanonical(snapshotInput);
  const evaluation = cloneCanonical(evaluationInput);
  if (evaluation.snapshotHash !== snapshot.snapshotHash) fail('SNAPSHOT_BINDING_MISMATCH', 'evaluation does not bind the supplied portfolio snapshot');
  if (evaluation.snapshotOwnerClaimHash !== snapshot.ownerClaimHash) {
    fail('SNAPSHOT_OWNER_CLAIM_BINDING_MISMATCH', 'evaluation does not bind the supplied snapshot owner claim');
  }
  const ownerSnapshotRefs = new Set(snapshot.ownerSnapshotRefs);
  const consumedOwnerRefs = [
    ...evaluation.sweepInputs.map((row) => row.ownerRef),
    ...evaluation.impacts.map((row) => row.ownerOutputRef),
    ...evaluation.callerFacts.map((row) => row.ownerOutputRef),
    ...evaluation.stateChanges.map((row) => row.ownerOutputRef),
    ...evaluation.uncertainty.sourceRefs,
  ];
  if (consumedOwnerRefs.some((ref) => !ownerSnapshotRefs.has(ref))) {
    fail('SCENARIO_OWNER_OUTPUT_UNBOUND', 'scenario inputs must reference an immutable owner output declared by the snapshot');
  }
  for (const sweep of evaluation.sweepInputs) {
    if (['FUNDING', 'FEE', 'SLIPPAGE'].includes(sweep.dimension) && sweep.unit !== snapshot.reportingUnit) {
      fail('SWEEP_REPORTING_UNIT_MISMATCH', `${sweep.dimension} must use the snapshot reporting unit`);
    }
  }
  if (evaluation.uncertainty.unit !== snapshot.reportingUnit) {
    fail('UNCERTAINTY_REPORTING_UNIT_MISMATCH', 'scenario uncertainty must use the snapshot reporting unit');
  }
  const knownSubjects = subjectIds(snapshot);
  const danglingImpacts = evaluation.impacts.filter((impact) => !knownSubjects.has(impact.subjectId)).map((impact) => impact.impactId);
  const danglingChanges = evaluation.stateChanges.filter((change) => !knownSubjects.has(change.subjectId)).map((change) => change.subjectId);
  const danglingFacts = evaluation.callerFacts.filter((fact) => !knownSubjects.has(fact.subjectId)).map((fact) => fact.factId);
  if (danglingImpacts.length > 0 || danglingChanges.length > 0 || danglingFacts.length > 0) fail('SCENARIO_SUBJECT_DANGLING', 'scenario output references a subject absent from the immutable snapshot');

  const aggregate = aggregateImpacts(evaluation, snapshot.reportingUnit);
  const sweepUnknowns = evaluation.sweepInputs
    .filter((row) => row.state !== 'KNOWN')
    .map((row) => `SWEEP_${row.dimension}_${row.state}`);
  const uncertaintyUnknown = evaluation.uncertainty.state !== 'KNOWN'
    ? [`UNCERTAINTY_${evaluation.uncertainty.state}`]
    : [];
  const reasonCodes = [...new Set([
    ...(snapshot.truthState === 'COMPLETE' ? [] : [`SNAPSHOT_TRUTH_${snapshot.truthState}`, ...snapshot.missingDependencies]),
    ...evaluation.missingDependencies,
    ...sweepUnknowns,
    ...uncertaintyUnknown,
    ...(aggregate.unknownCount > 0 ? ['OWNER_IMPACT_UNKNOWN'] : []),
    ...(evaluation.scenarioKind === 'SCENARIO_INPUT_MISSING' ? ['SCENARIO_INPUT_MISSING'] : []),
  ])].sort(compareText);
  const abstain = reasonCodes.length > 0;

  const report = {
    schema: 'PortfolioScenarioReportV1',
    version: 1,
    sourceSnapshot: snapshot,
    sourceEvaluation: evaluation,
    reportId: `report.${evaluation.evaluationId}`,
    evaluationId: evaluation.evaluationId,
    evaluationHash: evaluation.evaluationHash,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    scenarioKind: evaluation.scenarioKind,
    scenarioReference: evaluation.scenarioReference,
    scenarioDefinitionStatus: evaluation.scenarioDefinitionStatus,
    origin: evaluation.origin,
    seed: evaluation.seed,
    horizon: evaluation.horizon,
    reproducibilityInputs: evaluation.reproducibilityInputs,
    assumptions: evaluation.assumptions,
    sweepInputs: evaluation.sweepInputs,
    outputMode: evaluation.outputMode,
    status: abstain ? 'ABSTAIN_UNKNOWN' : 'EVALUATED_COMPARATIVE',
    reasonCodes,
    comparativeImpact: abstain ? null : knownMetric(aggregate.knownTotal, snapshot.reportingUnit),
    knownImpactSubtotal: knownMetric(aggregate.knownTotal, snapshot.reportingUnit),
    impactInterval: abstain ? null : {
      state: 'KNOWN',
      unit: snapshot.reportingUnit,
      lowerAtoms: aggregate.knownLower.toString(),
      upperAtoms: aggregate.knownUpper.toString(),
      method: 'SUM_OF_CALLER_SUPPLIED_IMPACT_INTERVALS',
    },
    callerSuppliedUncertainty: evaluation.uncertainty,
    attribution: aggregate.attribution,
    callerFacts: evaluation.callerFacts,
    stateChanges: evaluation.stateChanges,
    snapshotMissingDependencies: snapshot.missingDependencies,
    scenarioMissingDependencies: evaluation.missingDependencies,
    finding: {
      findingCode: abstain ? 'ABSTAIN_UNKNOWN' : 'SCENARIO_COMPARISON_AVAILABLE',
      advisoryOnly: true,
      sizingSupported: false,
      whyNotLiveSizing: evaluation.whyNotLiveSizing,
      ownerAction: null,
    },
    evidenceQuality: {
      determinedBy: 'CALLER_SUPPLIED_ORIGIN_INPUT_QUALITY_AND_UNCERTAINTY',
      simulationCountImprovesEvidenceQuality: false,
      snapshotTruthState: snapshot.truthState,
    },
    truthClass: 'ADVISORY',
    shadowOnly: true,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
  report.reportHash = sha256(omitFields(report, ['reportHash']));
  return deepFreeze(report);
}

export function validateScenarioCampaign(input) {
  const campaign = asRecord(input, 'ScenarioCampaignV1');
  const fields = [
    'schema', 'version', 'campaignId', 'mode', 'seed', 'generatedAtMs', 'snapshotHash',
    'evaluationInputs', 'drawCount', 'objective', 'limitations', 'authorityClass',
    'networkMode', 'canonical', 'campaignHash',
  ];
  exactFields(campaign, fields, 'ScenarioCampaignV1');
  requireFields(campaign, fields, 'ScenarioCampaignV1');
  assertCanonicalJson(campaign, 'ScenarioCampaignV1');
  assertNoForbiddenCapabilities(campaign);
  if (campaign.schema !== 'ScenarioCampaignV1' || campaign.version !== 1) fail('CONTRACT_VERSION_UNSUPPORTED', 'ScenarioCampaignV1 version 1 is required');
  boundedString(campaign.campaignId, 'ScenarioCampaignV1.campaignId', 256);
  enumValue(campaign.mode, CAMPAIGN_MODES, 'ScenarioCampaignV1.mode');
  safeInteger(campaign.seed, 'ScenarioCampaignV1.seed', { minimum: 1, maximum: 0xffff_ffff });
  safeInteger(campaign.generatedAtMs, 'ScenarioCampaignV1.generatedAtMs');
  if (!/^[a-f0-9]{64}$/.test(campaign.snapshotHash)) fail('SNAPSHOT_REFERENCE_INVALID', 'campaign snapshotHash must be SHA-256');
  if (!Array.isArray(campaign.evaluationInputs) || campaign.evaluationInputs.length === 0 || campaign.evaluationInputs.length > MAX_CAMPAIGN_CASES) {
    fail('CAMPAIGN_CASE_BOUND_INVALID', `campaign must contain 1..${MAX_CAMPAIGN_CASES} evaluation inputs`);
  }
  campaign.evaluationInputs.forEach(validateScenarioEvaluationInput);
  const ids = campaign.evaluationInputs.map((row) => row.evaluationId);
  if (new Set(ids).size !== ids.length) fail('CAMPAIGN_EVALUATION_DUPLICATE', 'campaign evaluation identities must be unique');
  if (campaign.evaluationInputs.some((row) => row.snapshotHash !== campaign.snapshotHash)) fail('SNAPSHOT_BINDING_MISMATCH', 'all campaign evaluations must bind the same snapshot');
  const maximumHorizonEndMs = Math.max(...campaign.evaluationInputs.map((row) => row.horizon.endMs));
  if (campaign.generatedAtMs < maximumHorizonEndMs) {
    fail('CAMPAIGN_TIME_ORDER_INVALID', 'campaign generatedAtMs cannot precede any evaluated scenario horizon end');
  }
  safeInteger(campaign.drawCount, 'ScenarioCampaignV1.drawCount', { minimum: 1, maximum: MAX_CAMPAIGN_DRAWS });
  if (campaign.mode === 'DECLARED_GRID' && campaign.drawCount !== campaign.evaluationInputs.length) {
    fail('DECLARED_GRID_DRAW_COUNT_INVALID', 'declared grid draw count must equal the exact evaluation count');
  }
  if (campaign.mode === 'ARCHIVED_FIXTURE_BOOTSTRAP') {
    const expectedIds = Object.keys(BOOTSTRAP_ARCHIVE_ROW_CLAIMS);
    if (campaign.evaluationInputs.length !== expectedIds.length
      || campaign.evaluationInputs.some((row, index) => row.evaluationId !== expectedIds[index])) {
      fail('BOOTSTRAP_ARCHIVE_INPUT_INVALID', 'archived fixture bootstrap requires the exact ordered unaccepted mechanism-test table');
    }
    campaign.evaluationInputs.forEach(validateBootstrapArchiveEvaluation);
  } else if (campaign.evaluationInputs.some((row) => row.reproducibilityInputs.some((ref) => ref.startsWith('history-')))) {
    fail('BOOTSTRAP_ARCHIVE_MODE_REQUIRED', 'archive provenance markers are forbidden outside ARCHIVED_FIXTURE_BOOTSTRAP mode');
  }
  boundedString(campaign.objective, 'ScenarioCampaignV1.objective', 2_048);
  stringArray(campaign.limitations, 'ScenarioCampaignV1.limitations', 256);
  if (campaign.authorityClass !== 'NO_AUTHORITY' || campaign.networkMode !== 'FIXTURE_ONLY' || campaign.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'scenario campaign must remain fixture-only, non-canonical, and non-authoritative');
  }
  validateBoundHash(campaign, 'campaignHash', 'CAMPAIGN_HASH_MISMATCH');
  return true;
}

export function createScenarioCampaign(input) {
  assertCanonicalJson(input, 'ScenarioCampaignV1');
  assertNoForbiddenCapabilities(input);
  const record = cloneCanonical(input);
  if (!Array.isArray(record.evaluationInputs)) {
    fail('CAMPAIGN_CASE_BOUND_INVALID', `campaign must contain 1..${MAX_CAMPAIGN_CASES} evaluation inputs`);
  }
  record.evaluationInputs = record.evaluationInputs.map((row) => (
    Object.hasOwn(row, 'evaluationHash') ? row : createScenarioEvaluationInput(row)
  ));
  const hashed = hashBound(record, 'campaignHash');
  validateScenarioCampaign(hashed);
  return deepFreeze(hashed);
}

export function buildBootstrapSchedule(caseIds, seed, drawCount) {
  stringArray(caseIds, 'bootstrap.caseIds', MAX_CAMPAIGN_CASES);
  if (caseIds.length === 0) fail('BOOTSTRAP_CASES_REQUIRED', 'bootstrap needs at least one caller-supplied case');
  safeInteger(seed, 'bootstrap.seed', { minimum: 1, maximum: 0xffff_ffff });
  safeInteger(drawCount, 'bootstrap.drawCount', { minimum: 1, maximum: MAX_CAMPAIGN_DRAWS });
  let state = seed >>> 0;
  const schedule = [];
  for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    const sourceIndex = state % caseIds.length;
    schedule.push({ drawIndex, sourceIndex, evaluationId: caseIds[sourceIndex] });
  }
  return deepFreeze(schedule);
}

export function evaluatePortfolioCampaign(snapshotInput, campaignInput) {
  validatePortfolioSnapshot(snapshotInput);
  validateScenarioCampaign(campaignInput);
  const snapshot = cloneCanonical(snapshotInput);
  const campaign = cloneCanonical(campaignInput);
  if (campaign.snapshotHash !== snapshot.snapshotHash) fail('SNAPSHOT_BINDING_MISMATCH', 'campaign does not bind the supplied portfolio snapshot');
  if (campaign.generatedAtMs < snapshot.receivedAtMs) fail('CAMPAIGN_TIME_ORDER_INVALID', 'campaign generatedAtMs cannot precede the bound snapshot receivedAtMs');

  const reports = campaign.evaluationInputs.map((evaluation) => evaluateScenarioFixture(snapshot, evaluation));
  const reportById = new Map(reports.map((report) => [report.evaluationId, report]));
  const schedule = campaign.mode === 'DECLARED_GRID'
    ? campaign.evaluationInputs.map((row, drawIndex) => ({ drawIndex, sourceIndex: drawIndex, evaluationId: row.evaluationId }))
    : buildBootstrapSchedule(campaign.evaluationInputs.map((row) => row.evaluationId), campaign.seed, campaign.drawCount);
  const draws = schedule.map((draw) => {
    const report = reportById.get(draw.evaluationId);
    return {
      ...draw,
      reportHash: report.reportHash,
      status: report.status,
      origin: report.origin,
      callerSuppliedUncertainty: cloneCanonical(report.callerSuppliedUncertainty),
    };
  });
  const concentration = buildConcentrationMap(snapshot);
  const relationshipGraph = buildRelationshipGraph(snapshot);
  const portfolioViews = buildPortfolioViews(reports, relationshipGraph.graphHash);
  const matrix = reports.map(scenarioMatrixRow);
  const output = {
    schema: 'PortfolioCampaignReportV1',
    version: 1,
    sourceSnapshot: snapshot,
    sourceCampaign: campaign,
    reportId: `campaign-report.${campaign.campaignId}`,
    campaignId: campaign.campaignId,
    campaignHash: campaign.campaignHash,
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    generatedAtMs: campaign.generatedAtMs,
    mode: campaign.mode,
    seed: campaign.seed,
    objective: campaign.objective,
    limitations: campaign.limitations,
    evaluationCount: reports.length,
    drawCount: draws.length,
    uniqueDrawnCaseCount: new Set(draws.map((row) => row.evaluationId)).size,
    abstainCount: reports.filter((report) => report.status === 'ABSTAIN_UNKNOWN').length,
    evaluatedCount: reports.filter((report) => report.status === 'EVALUATED_COMPARATIVE').length,
    reports,
    scenarioMatrix: matrix,
    draws,
    concentration,
    relationshipGraph,
    portfolioViews,
    evidenceQuality: {
      simulationCountImprovesEvidenceQuality: false,
      uncertaintyNarrowedByDrawCount: false,
      originPreservedPerDraw: true,
      inputTableHash: sha256(campaign.evaluationInputs.map((row) => row.evaluationHash)),
    },
    finding: {
      advisoryOnly: true,
      sizingSupported: false,
      noSizingReason: 'PortfolioLab fixture campaigns aggregate caller-supplied owner outputs and cannot authorize live sizing.',
      ownerAction: null,
    },
    truthClass: 'ADVISORY',
    shadowOnly: true,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
  output.reportHash = sha256(omitFields(output, ['reportHash']));
  if (canonicalBytes(output).length > MAX_CAMPAIGN_REPORT_BYTES) {
    fail('CAMPAIGN_REPORT_RESOURCE_BOUND_EXCEEDED', `campaign report exceeds ${MAX_CAMPAIGN_REPORT_BYTES} canonical bytes`);
  }
  return deepFreeze(output);
}

export function validatePortfolioScenarioReport(input) {
  const report = asRecord(input, 'PortfolioScenarioReportV1');
  const fields = [
    'schema', 'version', 'sourceSnapshot', 'sourceEvaluation', 'reportId', 'evaluationId', 'evaluationHash', 'snapshotId',
    'snapshotHash', 'scenarioKind', 'scenarioReference', 'scenarioDefinitionStatus',
    'origin', 'seed', 'horizon', 'reproducibilityInputs', 'assumptions', 'sweepInputs', 'outputMode', 'status',
    'reasonCodes', 'comparativeImpact', 'knownImpactSubtotal', 'impactInterval',
    'callerSuppliedUncertainty', 'attribution', 'callerFacts', 'stateChanges', 'snapshotMissingDependencies',
    'scenarioMissingDependencies', 'finding', 'evidenceQuality', 'truthClass', 'shadowOnly',
    'authorityClass', 'networkMode', 'canonical', 'reportHash',
  ];
  exactFields(report, fields, 'PortfolioScenarioReportV1');
  requireFields(report, fields, 'PortfolioScenarioReportV1');
  assertCanonicalJson(report, 'PortfolioScenarioReportV1');
  assertNoForbiddenCapabilities(report);
  if (report.schema !== 'PortfolioScenarioReportV1' || report.version !== 1) {
    fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioScenarioReportV1 version 1 is required');
  }
  validatePortfolioSnapshot(report.sourceSnapshot);
  validateScenarioEvaluationInput(report.sourceEvaluation);
  for (const field of ['reportId', 'evaluationId', 'snapshotId']) boundedString(report[field], `PortfolioScenarioReportV1.${field}`, 256);
  for (const field of ['evaluationHash', 'snapshotHash', 'reportHash']) {
    if (!/^[a-f0-9]{64}$/.test(report[field])) fail('REPORT_HASH_INVALID', `${field} must be SHA-256`);
  }
  enumValue(report.scenarioKind, SCENARIO_KINDS, 'PortfolioScenarioReportV1.scenarioKind');
  enumValue(report.scenarioDefinitionStatus, SCENARIO_DEFINITION_STATUSES, 'PortfolioScenarioReportV1.scenarioDefinitionStatus');
  enumValue(report.origin, ORIGINS, 'PortfolioScenarioReportV1.origin');
  safeInteger(report.seed, 'PortfolioScenarioReportV1.seed', { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
  if (report.seed !== report.scenarioReference.seed) fail('SCENARIO_SEED_MISMATCH', 'scenario report seed must match its immutable reference');

  asRecord(report.horizon, 'PortfolioScenarioReportV1.horizon');
  exactFields(report.horizon, ['startMs', 'endMs'], 'PortfolioScenarioReportV1.horizon');
  requireFields(report.horizon, ['startMs', 'endMs'], 'PortfolioScenarioReportV1.horizon');
  safeInteger(report.horizon.startMs, 'PortfolioScenarioReportV1.horizon.startMs');
  safeInteger(report.horizon.endMs, 'PortfolioScenarioReportV1.horizon.endMs');
  if (report.horizon.endMs <= report.horizon.startMs) fail('HORIZON_INVALID', 'scenario report horizon end must follow start');

  asRecord(report.assumptions, 'PortfolioScenarioReportV1.assumptions');
  exactFields(report.assumptions, ['narrative', 'severity', 'liquidity', 'fills', 'exclusions'], 'PortfolioScenarioReportV1.assumptions');
  requireFields(report.assumptions, ['narrative', 'severity', 'liquidity', 'fills', 'exclusions'], 'PortfolioScenarioReportV1.assumptions');
  for (const field of ['narrative', 'severity', 'liquidity', 'fills']) boundedString(report.assumptions[field], `PortfolioScenarioReportV1.assumptions.${field}`);
  stringArray(report.assumptions.exclusions, 'PortfolioScenarioReportV1.assumptions.exclusions', 128);

  stringArray(report.reproducibilityInputs, 'PortfolioScenarioReportV1.reproducibilityInputs', 512);
  if (report.reproducibilityInputs.length === 0) fail('REPRODUCIBILITY_INPUT_REQUIRED', 'scenario report must preserve reproducibility inputs');
  validateUnacceptedScenarioReferenceBoundary(
    report.scenarioReference,
    report.scenarioDefinitionStatus,
    report.reproducibilityInputs,
  );
  if (!Array.isArray(report.sweepInputs) || report.sweepInputs.length !== 7) fail('SWEEP_DIMENSION_SET_INVALID', 'scenario report must preserve all seven sweep inputs');
  report.sweepInputs.forEach((row, index) => {
    const name = `PortfolioScenarioReportV1.sweepInputs[${index}]`;
    asRecord(row, name);
    exactFields(row, ['dimension', 'state', 'value', 'unit', 'ownerRef'], name);
    requireFields(row, ['dimension', 'state', 'value', 'unit', 'ownerRef'], name);
    if (row.dimension !== SWEEP_DIMENSIONS[index]) fail('SWEEP_DIMENSION_SET_INVALID', 'scenario report sweep inputs must retain frozen order');
    enumValue(row.state, UNCERTAINTY_STATES, `${name}.state`);
    boundedString(row.unit, `${name}.unit`, 64);
    boundedString(row.ownerRef, `${name}.ownerRef`, 8_192);
    const expectedUnit = SWEEP_UNIT_REQUIREMENTS[row.dimension];
    if (expectedUnit !== 'REPORTING_UNIT' && row.unit !== expectedUnit) fail('SWEEP_UNIT_INVALID', `${name}.unit must be ${expectedUnit}`);
    if (row.state === 'KNOWN') {
      const atoms = parseAtoms(row.value, `${name}.value`);
      if (row.unit === 'PPM' && (atoms < -1_000_000n || atoms > 1_000_000n)) fail('SWEEP_VALUE_OUT_OF_RANGE', `${name}.value exceeds PPM bounds`);
      if (row.unit === 'MILLISECONDS' && atoms < 0n) fail('SWEEP_VALUE_OUT_OF_RANGE', `${name}.value cannot be negative milliseconds`);
    } else if (row.value !== null) fail('SWEEP_UNKNOWN_SHAPE_INVALID', `${name}.value must be null when ${row.state}`);
  });
  enumValue(report.outputMode, ['COMPARATIVE'], 'PortfolioScenarioReportV1.outputMode');
  enumValue(report.status, ['EVALUATED_COMPARATIVE', 'ABSTAIN_UNKNOWN'], 'PortfolioScenarioReportV1.status');
  stringArray(report.reasonCodes, 'PortfolioScenarioReportV1.reasonCodes', 512);
  validateExactMetric(report.knownImpactSubtotal, null, 'PortfolioScenarioReportV1.knownImpactSubtotal');
  if (report.knownImpactSubtotal.state !== 'KNOWN') fail('KNOWN_SUBTOTAL_REQUIRED', 'knownImpactSubtotal must remain an exact known subtotal');
  const reportingUnit = report.knownImpactSubtotal.unit;
  for (const row of report.sweepInputs) {
    if (SWEEP_UNIT_REQUIREMENTS[row.dimension] === 'REPORTING_UNIT' && row.unit !== reportingUnit) {
      fail('SWEEP_REPORTING_UNIT_MISMATCH', `${row.dimension} must preserve the report unit`);
    }
  }

  const uncertainty = asRecord(report.callerSuppliedUncertainty, 'PortfolioScenarioReportV1.callerSuppliedUncertainty');
  exactFields(uncertainty, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method', 'sourceRefs'], 'PortfolioScenarioReportV1.callerSuppliedUncertainty');
  requireFields(uncertainty, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method', 'sourceRefs'], 'PortfolioScenarioReportV1.callerSuppliedUncertainty');
  enumValue(uncertainty.state, UNCERTAINTY_STATES, 'PortfolioScenarioReportV1.callerSuppliedUncertainty.state');
  if (uncertainty.unit !== reportingUnit) fail('UNCERTAINTY_REPORTING_UNIT_MISMATCH', 'caller uncertainty must preserve the report unit');
  boundedString(uncertainty.method, 'PortfolioScenarioReportV1.callerSuppliedUncertainty.method', 256);
  stringArray(uncertainty.sourceRefs, 'PortfolioScenarioReportV1.callerSuppliedUncertainty.sourceRefs', 128);
  if (uncertainty.sourceRefs.length === 0) fail('UNCERTAINTY_SOURCE_REQUIRED', 'caller uncertainty needs immutable source evidence');
  if (uncertainty.state === 'KNOWN') {
    const lower = parseAtoms(uncertainty.lowerAtoms, 'PortfolioScenarioReportV1.callerSuppliedUncertainty.lowerAtoms');
    const upper = parseAtoms(uncertainty.upperAtoms, 'PortfolioScenarioReportV1.callerSuppliedUncertainty.upperAtoms');
    if (lower > upper) fail('UNCERTAINTY_INTERVAL_INVALID', 'caller uncertainty lower must not exceed upper');
  } else if (uncertainty.lowerAtoms !== null || uncertainty.upperAtoms !== null) {
    fail('UNCERTAINTY_SHAPE_INVALID', 'unknown caller uncertainty bounds must be null');
  }

  if (!Array.isArray(report.attribution) || report.attribution.length === 0 || report.attribution.length > IMPACT_CATEGORIES.length) {
    fail('ATTRIBUTION_ARRAY_INVALID', 'scenario report needs a bounded non-empty attribution array');
  }
  let attributionSubtotal = 0n;
  let attributionLower = 0n;
  let attributionUpper = 0n;
  let attributionUnknownCount = 0;
  const attributionCategories = new Set();
  report.attribution.forEach((row, index) => {
    const name = `PortfolioScenarioReportV1.attribution[${index}]`;
    asRecord(row, name);
    exactFields(row, ['category', 'comparativeDelta', 'knownDeltaSubtotal', 'lowerBound', 'upperBound', 'unknownCount', 'impactIds', 'ownerOutputRefs', 'causalAttribution'], name);
    requireFields(row, ['category', 'comparativeDelta', 'knownDeltaSubtotal', 'lowerBound', 'upperBound', 'unknownCount', 'impactIds', 'ownerOutputRefs', 'causalAttribution'], name);
    enumValue(row.category, IMPACT_CATEGORIES, `${name}.category`);
    if (attributionCategories.has(row.category)) fail('ATTRIBUTION_CATEGORY_DUPLICATE', `${row.category} is duplicated`);
    attributionCategories.add(row.category);
    validateExactMetric(row.knownDeltaSubtotal, reportingUnit, `${name}.knownDeltaSubtotal`);
    if (row.knownDeltaSubtotal.state !== 'KNOWN') fail('KNOWN_SUBTOTAL_REQUIRED', `${name}.knownDeltaSubtotal must be known`);
    safeInteger(row.unknownCount, `${name}.unknownCount`, { minimum: 0, maximum: 4_096 });
    stringArray(row.impactIds, `${name}.impactIds`, 4_096);
    stringArray(row.ownerOutputRefs, `${name}.ownerOutputRefs`, 128);
    if (row.impactIds.length === 0 || row.ownerOutputRefs.length === 0) fail('ATTRIBUTION_PROVENANCE_REQUIRED', `${name} needs impact identities and immutable owner evidence`);
    if (row.causalAttribution !== false) fail('CAUSAL_ATTRIBUTION_FORBIDDEN', `${name} cannot claim causal attribution`);
    attributionSubtotal += parseAtoms(row.knownDeltaSubtotal.atoms, `${name}.knownDeltaSubtotal.atoms`);
    attributionUnknownCount += row.unknownCount;
    if (row.unknownCount === 0) {
      for (const field of ['comparativeDelta', 'lowerBound', 'upperBound']) {
        if (row[field] === null) fail('ATTRIBUTION_STATUS_CONTRADICTION', `${name}.${field} must be known when no impact is unknown`);
        validateExactMetric(row[field], reportingUnit, `${name}.${field}`);
        if (row[field].state !== 'KNOWN') fail('ATTRIBUTION_STATUS_CONTRADICTION', `${name}.${field} must be known`);
      }
      const delta = parseAtoms(row.comparativeDelta.atoms, `${name}.comparativeDelta.atoms`);
      const lower = parseAtoms(row.lowerBound.atoms, `${name}.lowerBound.atoms`);
      const upper = parseAtoms(row.upperBound.atoms, `${name}.upperBound.atoms`);
      if (row.comparativeDelta.atoms !== row.knownDeltaSubtotal.atoms || lower > delta || delta > upper) {
        fail('ATTRIBUTION_INTERVAL_INVALID', `${name} must preserve subtotal and lower <= delta <= upper`);
      }
      attributionLower += lower;
      attributionUpper += upper;
    } else if (row.comparativeDelta !== null || row.lowerBound !== null || row.upperBound !== null) {
      fail('ATTRIBUTION_UNKNOWN_FALSE_PRECISION', `${name} cannot publish final values with unknown impacts`);
    }
  });
  if (attributionSubtotal.toString() !== report.knownImpactSubtotal.atoms) fail('ATTRIBUTION_TOTAL_MISMATCH', 'attribution known subtotals must equal the report known subtotal');

  if (!Array.isArray(report.callerFacts) || report.callerFacts.length > 128) fail('REPORT_ARRAY_INVALID', 'PortfolioScenarioReportV1.callerFacts must be bounded');
  report.callerFacts.forEach((row, index) => validateScenarioCallerFact(row, `PortfolioScenarioReportV1.callerFacts[${index}]`));

  if (!Array.isArray(report.stateChanges) || report.stateChanges.length > 2_048) fail('REPORT_ARRAY_INVALID', 'PortfolioScenarioReportV1.stateChanges must be bounded');
  report.stateChanges.forEach((row, index) => {
    const name = `PortfolioScenarioReportV1.stateChanges[${index}]`;
    asRecord(row, name);
    exactFields(row, ['subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
    requireFields(row, ['subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
    for (const field of ['subjectId', 'category', 'before', 'after', 'ownerOutputRef']) boundedString(row[field], `${name}.${field}`, field === 'ownerOutputRef' ? 8_192 : 256);
  });
  stringArray(report.snapshotMissingDependencies, 'PortfolioScenarioReportV1.snapshotMissingDependencies', 512);
  stringArray(report.scenarioMissingDependencies, 'PortfolioScenarioReportV1.scenarioMissingDependencies', 512);

  const evidence = asRecord(report.evidenceQuality, 'PortfolioScenarioReportV1.evidenceQuality');
  exactFields(evidence, ['determinedBy', 'simulationCountImprovesEvidenceQuality', 'snapshotTruthState'], 'PortfolioScenarioReportV1.evidenceQuality');
  requireFields(evidence, ['determinedBy', 'simulationCountImprovesEvidenceQuality', 'snapshotTruthState'], 'PortfolioScenarioReportV1.evidenceQuality');
  if (evidence.determinedBy !== 'CALLER_SUPPLIED_ORIGIN_INPUT_QUALITY_AND_UNCERTAINTY'
    || evidence.simulationCountImprovesEvidenceQuality !== false) {
    fail('EVIDENCE_QUALITY_WIDENING', 'scenario evidence quality must remain caller-supplied and cannot improve with simulation count');
  }
  enumValue(evidence.snapshotTruthState, TRUTH_STATES, 'PortfolioScenarioReportV1.evidenceQuality.snapshotTruthState');
  if (evidence.snapshotTruthState === 'COMPLETE' && report.snapshotMissingDependencies.length > 0) fail('TRUTH_COMPLETENESS_CONTRADICTION', 'complete snapshot evidence cannot list missing dependencies');
  if (evidence.snapshotTruthState !== 'COMPLETE' && report.snapshotMissingDependencies.length === 0) fail('TRUTH_INCOMPLETENESS_UNEXPLAINED', 'non-complete snapshot evidence needs a missing dependency');

  const expectedReasons = [...new Set([
    ...(evidence.snapshotTruthState === 'COMPLETE' ? [] : [`SNAPSHOT_TRUTH_${evidence.snapshotTruthState}`, ...report.snapshotMissingDependencies]),
    ...report.scenarioMissingDependencies,
    ...report.sweepInputs.filter((row) => row.state !== 'KNOWN').map((row) => `SWEEP_${row.dimension}_${row.state}`),
    ...(uncertainty.state === 'KNOWN' ? [] : [`UNCERTAINTY_${uncertainty.state}`]),
    ...(attributionUnknownCount > 0 ? ['OWNER_IMPACT_UNKNOWN'] : []),
    ...(report.scenarioKind === 'SCENARIO_INPUT_MISSING' ? ['SCENARIO_INPUT_MISSING'] : []),
  ])].sort(compareText);
  if (!sameCanonical(report.reasonCodes, expectedReasons)) fail('SCENARIO_REASON_BINDING_MISMATCH', 'scenario reason codes must be exactly derived from preserved unknown and missing inputs');

  if (report.status === 'EVALUATED_COMPARATIVE') {
    if (report.reasonCodes.length !== 0 || report.comparativeImpact === null || report.impactInterval === null) {
      fail('SCENARIO_REPORT_STATUS_CONTRADICTION', 'evaluated scenario reports require numeric comparative output and no unknown reason codes');
    }
    validateExactMetric(report.comparativeImpact, reportingUnit, 'PortfolioScenarioReportV1.comparativeImpact');
    if (report.comparativeImpact.state !== 'KNOWN') fail('SCENARIO_REPORT_STATUS_CONTRADICTION', 'evaluated comparative output must be known');
    if (report.comparativeImpact.atoms !== report.knownImpactSubtotal.atoms || attributionUnknownCount !== 0) {
      fail('SCENARIO_REPORT_TOTAL_MISMATCH', 'evaluated comparative output must equal the known caller-supplied subtotal with no unknown impacts');
    }
    asRecord(report.impactInterval, 'PortfolioScenarioReportV1.impactInterval');
    exactFields(report.impactInterval, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method'], 'PortfolioScenarioReportV1.impactInterval');
    requireFields(report.impactInterval, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method'], 'PortfolioScenarioReportV1.impactInterval');
    if (report.impactInterval.state !== 'KNOWN' || report.impactInterval.unit !== reportingUnit) fail('IMPACT_INTERVAL_INVALID', 'impact interval must be known in the report unit');
    const lower = parseAtoms(report.impactInterval.lowerAtoms, 'PortfolioScenarioReportV1.impactInterval.lowerAtoms');
    const upper = parseAtoms(report.impactInterval.upperAtoms, 'PortfolioScenarioReportV1.impactInterval.upperAtoms');
    const delta = parseAtoms(report.comparativeImpact.atoms, 'PortfolioScenarioReportV1.comparativeImpact.atoms');
    if (lower > delta || delta > upper || lower !== attributionLower || upper !== attributionUpper) {
      fail('IMPACT_INTERVAL_INVALID', 'impact interval must equal attribution bounds and contain the comparative total');
    }
    boundedString(report.impactInterval.method, 'PortfolioScenarioReportV1.impactInterval.method', 256);
  } else if (report.reasonCodes.length === 0 || report.comparativeImpact !== null || report.impactInterval !== null) {
    fail('SCENARIO_REPORT_STATUS_CONTRADICTION', 'abstained scenario reports require reasons and null comparative output');
  }
  asRecord(report.finding, 'PortfolioScenarioReportV1.finding');
  exactFields(report.finding, ['findingCode', 'advisoryOnly', 'sizingSupported', 'whyNotLiveSizing', 'ownerAction'], 'PortfolioScenarioReportV1.finding');
  requireFields(report.finding, ['findingCode', 'advisoryOnly', 'sizingSupported', 'whyNotLiveSizing', 'ownerAction'], 'PortfolioScenarioReportV1.finding');
  const expectedFindingCode = report.status === 'ABSTAIN_UNKNOWN' ? 'ABSTAIN_UNKNOWN' : 'SCENARIO_COMPARISON_AVAILABLE';
  if (report.finding.findingCode !== expectedFindingCode) fail('FINDING_STATUS_MISMATCH', 'findingCode must match scenario report status');
  boundedString(report.finding.whyNotLiveSizing, 'PortfolioScenarioReportV1.finding.whyNotLiveSizing', 2_048);
  if (report.finding.advisoryOnly !== true || report.finding.sizingSupported !== false || report.finding.ownerAction !== null) {
    fail('ADVISORY_FINDING_BOUNDARY_INVALID', 'scenario finding must remain advisory with no sizing or owner action');
  }
  if (report.truthClass !== 'ADVISORY' || report.shadowOnly !== true || report.authorityClass !== 'NO_AUTHORITY'
    || report.networkMode !== 'FIXTURE_ONLY' || report.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'scenario reports must remain shadow-only advisory, fixture-only, non-canonical, and non-authoritative');
  }
  validateBoundHash(report, 'reportHash', 'SCENARIO_REPORT_HASH_MISMATCH');
  const expectedReport = evaluateScenarioFixture(report.sourceSnapshot, report.sourceEvaluation);
  if (!sameCanonical(report, expectedReport)) {
    fail('SCENARIO_REPORT_SOURCE_BINDING_MISMATCH', 'scenario report must be exactly derived from its embedded snapshot and evaluation');
  }
  return true;
}

export function validatePortfolioCampaignReport(input) {
  const report = asRecord(input, 'PortfolioCampaignReportV1');
  const fields = [
    'schema', 'version', 'sourceSnapshot', 'sourceCampaign', 'reportId', 'campaignId', 'campaignHash', 'snapshotId',
    'snapshotHash', 'generatedAtMs', 'mode', 'seed', 'objective', 'limitations',
    'evaluationCount', 'drawCount', 'uniqueDrawnCaseCount', 'abstainCount',
    'evaluatedCount', 'reports', 'scenarioMatrix', 'draws', 'concentration',
    'relationshipGraph', 'portfolioViews', 'evidenceQuality', 'finding', 'truthClass', 'shadowOnly',
    'authorityClass', 'networkMode', 'canonical', 'reportHash',
  ];
  exactFields(report, fields, 'PortfolioCampaignReportV1');
  requireFields(report, fields, 'PortfolioCampaignReportV1');
  assertCanonicalJson(report, 'PortfolioCampaignReportV1');
  assertNoForbiddenCapabilities(report);
  if (report.schema !== 'PortfolioCampaignReportV1' || report.version !== 1) {
    fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioCampaignReportV1 version 1 is required');
  }
  validatePortfolioSnapshot(report.sourceSnapshot);
  validateScenarioCampaign(report.sourceCampaign);
  for (const field of ['reportId', 'campaignId', 'snapshotId', 'objective']) {
    boundedString(report[field], `PortfolioCampaignReportV1.${field}`, field === 'objective' ? 2_048 : 256);
  }
  for (const field of ['campaignHash', 'snapshotHash', 'reportHash']) {
    if (!/^[a-f0-9]{64}$/.test(report[field])) fail('REPORT_HASH_INVALID', `${field} must be SHA-256`);
  }
  safeInteger(report.generatedAtMs, 'PortfolioCampaignReportV1.generatedAtMs');
  enumValue(report.mode, CAMPAIGN_MODES, 'PortfolioCampaignReportV1.mode');
  safeInteger(report.seed, 'PortfolioCampaignReportV1.seed', { minimum: 1, maximum: 0xffff_ffff });
  stringArray(report.limitations, 'PortfolioCampaignReportV1.limitations', 256);
  for (const field of ['reports', 'scenarioMatrix', 'draws']) {
    if (!Array.isArray(report[field])) fail('REPORT_ARRAY_INVALID', `PortfolioCampaignReportV1.${field} must be an array`);
  }
  safeInteger(report.evaluationCount, 'PortfolioCampaignReportV1.evaluationCount', { minimum: 1, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(report.drawCount, 'PortfolioCampaignReportV1.drawCount', { minimum: 1, maximum: MAX_CAMPAIGN_DRAWS });
  safeInteger(report.uniqueDrawnCaseCount, 'PortfolioCampaignReportV1.uniqueDrawnCaseCount', { minimum: 1, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(report.abstainCount, 'PortfolioCampaignReportV1.abstainCount', { minimum: 0, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(report.evaluatedCount, 'PortfolioCampaignReportV1.evaluatedCount', { minimum: 0, maximum: MAX_CAMPAIGN_CASES });
  if (report.evaluationCount !== report.reports.length || report.evaluationCount !== report.scenarioMatrix.length) {
    fail('REPORT_COUNT_MISMATCH', 'evaluation count must match reports and scenario matrix');
  }
  if (report.drawCount !== report.draws.length
    || report.abstainCount !== report.reports.filter((row) => row.status === 'ABSTAIN_UNKNOWN').length
    || report.evaluatedCount !== report.reports.filter((row) => row.status === 'EVALUATED_COMPARATIVE').length
    || report.abstainCount + report.evaluatedCount !== report.evaluationCount) {
    fail('REPORT_COUNT_MISMATCH', 'campaign status and draw counts must match their rows');
  }
  for (const row of report.reports) validatePortfolioScenarioReport(row);
  const reportById = new Map(report.reports.map((row) => [row.evaluationId, row]));
  if (reportById.size !== report.reports.length) fail('CAMPAIGN_REPORT_ID_DUPLICATE', 'campaign report contains duplicate scenario report identities');
  if (report.reports.some((row) => row.snapshotId !== report.snapshotId || row.snapshotHash !== report.snapshotHash)) {
    fail('SNAPSHOT_BINDING_MISMATCH', 'all scenario reports must bind the campaign report snapshot');
  }
  if (report.mode === 'ARCHIVED_FIXTURE_BOOTSTRAP') {
    report.reports.forEach((row) => validateBootstrapArchiveEvaluation(row.sourceEvaluation));
  }
  if (report.uniqueDrawnCaseCount !== new Set(report.draws.map((row) => row.evaluationId)).size) {
    fail('REPORT_COUNT_MISMATCH', 'uniqueDrawnCaseCount must match the draw schedule');
  }
  const expectedMatrix = report.reports.map(scenarioMatrixRow);
  if (!sameCanonical(report.scenarioMatrix, expectedMatrix)) {
    fail('SCENARIO_MATRIX_BINDING_MISMATCH', 'scenario matrix must be the exact bounded projection of scenario reports');
  }
  const expectedSchedule = report.mode === 'DECLARED_GRID'
    ? report.reports.map((row, drawIndex) => ({ drawIndex, sourceIndex: drawIndex, evaluationId: row.evaluationId }))
    : buildBootstrapSchedule(report.reports.map((row) => row.evaluationId), report.seed, report.drawCount);
  for (const [index, row] of report.draws.entries()) {
    const name = `PortfolioCampaignReportV1.draws[${index}]`;
    asRecord(row, name);
    exactFields(row, ['drawIndex', 'sourceIndex', 'evaluationId', 'reportHash', 'status', 'origin', 'callerSuppliedUncertainty'], name);
    requireFields(row, ['drawIndex', 'sourceIndex', 'evaluationId', 'reportHash', 'status', 'origin', 'callerSuppliedUncertainty'], name);
    safeInteger(row.drawIndex, `${name}.drawIndex`, { minimum: 0, maximum: MAX_CAMPAIGN_DRAWS - 1 });
    safeInteger(row.sourceIndex, `${name}.sourceIndex`, { minimum: 0, maximum: report.evaluationCount - 1 });
    boundedString(row.evaluationId, `${name}.evaluationId`, 256);
    if (!/^[a-f0-9]{64}$/.test(row.reportHash)) fail('REPORT_HASH_INVALID', `${name}.reportHash must be SHA-256`);
    enumValue(row.status, ['EVALUATED_COMPARATIVE', 'ABSTAIN_UNKNOWN'], `${name}.status`);
    enumValue(row.origin, ORIGINS, `${name}.origin`);
    const scheduled = expectedSchedule[index];
    const source = reportById.get(row.evaluationId);
    if (!scheduled || row.drawIndex !== scheduled.drawIndex || row.sourceIndex !== scheduled.sourceIndex
      || row.evaluationId !== scheduled.evaluationId || !source || row.reportHash !== source.reportHash || row.status !== source.status
      || row.origin !== source.origin || sha256(row.callerSuppliedUncertainty) !== sha256(source.callerSuppliedUncertainty)) {
      fail('DRAW_REPORT_BINDING_MISMATCH', `draws[${index}] does not preserve its source report`);
    }
  }

  validateConcentrationMap(report.concentration, report.sourceSnapshot);
  validateRelationshipGraph(report.relationshipGraph, report.sourceSnapshot);
  if (report.concentration.snapshotHash !== report.snapshotHash || report.relationshipGraph.snapshotHash !== report.snapshotHash) {
    fail('SNAPSHOT_BINDING_MISMATCH', 'campaign analysis artifacts must bind the report snapshot');
  }
  validatePortfolioViews(report.portfolioViews, report.reports, report.relationshipGraph.graphHash);

  const evidence = asRecord(report.evidenceQuality, 'PortfolioCampaignReportV1.evidenceQuality');
  exactFields(evidence, ['simulationCountImprovesEvidenceQuality', 'uncertaintyNarrowedByDrawCount', 'originPreservedPerDraw', 'inputTableHash'], 'PortfolioCampaignReportV1.evidenceQuality');
  requireFields(evidence, ['simulationCountImprovesEvidenceQuality', 'uncertaintyNarrowedByDrawCount', 'originPreservedPerDraw', 'inputTableHash'], 'PortfolioCampaignReportV1.evidenceQuality');
  if (evidence.simulationCountImprovesEvidenceQuality !== false
    || evidence.uncertaintyNarrowedByDrawCount !== false
    || evidence.originPreservedPerDraw !== true
    || evidence.inputTableHash !== sha256(report.reports.map((row) => row.evaluationHash))) {
    fail('EVIDENCE_QUALITY_WIDENING', 'campaign evidence must preserve input origins and cannot improve or narrow with draw count');
  }

  const finding = asRecord(report.finding, 'PortfolioCampaignReportV1.finding');
  exactFields(finding, ['advisoryOnly', 'sizingSupported', 'noSizingReason', 'ownerAction'], 'PortfolioCampaignReportV1.finding');
  requireFields(finding, ['advisoryOnly', 'sizingSupported', 'noSizingReason', 'ownerAction'], 'PortfolioCampaignReportV1.finding');
  boundedString(finding.noSizingReason, 'PortfolioCampaignReportV1.finding.noSizingReason', 2_048);
  if (finding.advisoryOnly !== true || finding.sizingSupported !== false || finding.ownerAction !== null) {
    fail('ADVISORY_FINDING_BOUNDARY_INVALID', 'campaign finding must remain advisory with no sizing or owner action');
  }
  if (report.truthClass !== 'ADVISORY' || report.shadowOnly !== true || report.authorityClass !== 'NO_AUTHORITY'
    || report.networkMode !== 'FIXTURE_ONLY' || report.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'campaign reports must remain advisory, fixture-only, non-canonical, and non-authoritative');
  }
  if (canonicalBytes(report).length > MAX_CAMPAIGN_REPORT_BYTES) {
    fail('CAMPAIGN_REPORT_RESOURCE_BOUND_EXCEEDED', `campaign report exceeds ${MAX_CAMPAIGN_REPORT_BYTES} canonical bytes`);
  }
  validateBoundHash(report, 'reportHash', 'CAMPAIGN_REPORT_HASH_MISMATCH');
  const expectedReport = evaluatePortfolioCampaign(report.sourceSnapshot, report.sourceCampaign);
  if (!sameCanonical(report, expectedReport)) {
    fail('CAMPAIGN_REPORT_SOURCE_BINDING_MISMATCH', 'campaign report must be exactly derived from its embedded snapshot and campaign');
  }
  return true;
}
