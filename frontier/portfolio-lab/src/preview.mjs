import {
  canonicalBytes,
  cloneCanonical,
  deepFreeze,
  omitFields,
  sha256,
} from '../../dock/src/canonical.mjs';
import { validateFixtureOutput } from '../../dock/src/adapter.mjs';
import {
  MAX_CAMPAIGN_CASES,
  MAX_CAMPAIGN_DRAWS,
  validatePortfolioCampaignReport,
  validatePortfolioScenarioReport,
  validatePortfolioViews,
} from './campaign.mjs';
import { validateConcentrationMap, validateRelationshipGraph } from './analysis.mjs';
import {
  asRecord,
  assertCanonicalJson,
  assertNoForbiddenCapabilities,
  boundedString,
  exactFields,
  fail,
  requireFields,
  safeInteger,
  stringArray,
} from './errors.mjs';

const PREVIEW_LIMITATIONS = Object.freeze([
  'FIXTURE_PROJECTION_ONLY',
  'NO_MOUNT_OR_COCKPIT_MUTATION',
  'NO_HEALTH_RISK_CAPITAL_OR_EXECUTION_RECOMPUTATION',
  'NO_LIVE_SIZING_SUPPORT',
]);

export const MAX_PREVIEW_BYTES = 2_000_000;

function matrixRow(report) {
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

export function projectPortfolioLabCockpit(campaignReportInput, generatedAtMs) {
  validatePortfolioCampaignReport(campaignReportInput);
  safeInteger(generatedAtMs, 'PortfolioLabCockpitProjectionV1.generatedAtMs');
  if (generatedAtMs < campaignReportInput.generatedAtMs) fail('PREVIEW_TIME_ORDER_INVALID', 'preview generatedAtMs cannot precede its campaign report');
  const campaignReport = cloneCanonical(campaignReportInput);
  const projection = {
    schema: 'PortfolioLabCockpitProjectionV1',
    version: 1,
    sourceCampaignReport: campaignReport,
    projectionId: `portfolio-lab.${campaignReport.campaignId}`,
    generatedAtMs,
    sourceCampaignId: campaignReport.campaignId,
    sourceCampaignHash: campaignReport.campaignHash,
    sourceReportHash: campaignReport.reportHash,
    truthLabel: 'SYNTHETIC_ONLY',
    mountStatus: 'DIRECTOR_MOUNT_REQUIRED',
    mounted: false,
    controls: [],
    summary: {
      evaluationCount: campaignReport.evaluationCount,
      evaluatedCount: campaignReport.evaluatedCount,
      abstainCount: campaignReport.abstainCount,
      drawCount: campaignReport.drawCount,
      uniqueDrawnCaseCount: campaignReport.uniqueDrawnCaseCount,
    },
    scenarioMatrix: cloneCanonical(campaignReport.scenarioMatrix),
    drillDownEvidence: cloneCanonical(campaignReport.reports),
    concentration: cloneCanonical(campaignReport.concentration),
    relationshipGraph: cloneCanonical(campaignReport.relationshipGraph),
    portfolioViews: cloneCanonical(campaignReport.portfolioViews),
    advisoryFinding: cloneCanonical(campaignReport.finding),
    limitations: [...PREVIEW_LIMITATIONS],
    truthClass: 'FIXTURE_PROJECTION',
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
  projection.projectionHash = sha256(omitFields(projection, ['projectionHash']));
  if (canonicalBytes(projection).length > MAX_PREVIEW_BYTES) fail('PREVIEW_RESOURCE_BOUND_EXCEEDED', `preview exceeds ${MAX_PREVIEW_BYTES} canonical bytes`);
  return deepFreeze(projection);
}

export function validatePortfolioLabCockpitProjection(input) {
  const projection = asRecord(input, 'PortfolioLabCockpitProjectionV1');
  const fields = [
    'schema', 'version', 'sourceCampaignReport', 'projectionId', 'generatedAtMs', 'sourceCampaignId',
    'sourceCampaignHash', 'sourceReportHash', 'truthLabel', 'mountStatus',
    'mounted', 'controls', 'summary', 'scenarioMatrix', 'concentration',
    'drillDownEvidence', 'relationshipGraph', 'portfolioViews', 'advisoryFinding', 'limitations', 'truthClass',
    'authorityClass', 'networkMode', 'canonical', 'projectionHash',
  ];
  exactFields(projection, fields, 'PortfolioLabCockpitProjectionV1');
  requireFields(projection, fields, 'PortfolioLabCockpitProjectionV1');
  assertCanonicalJson(projection, 'PortfolioLabCockpitProjectionV1');
  assertNoForbiddenCapabilities(projection);
  if (projection.schema !== 'PortfolioLabCockpitProjectionV1' || projection.version !== 1) {
    fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioLabCockpitProjectionV1 version 1 is required');
  }
  validatePortfolioCampaignReport(projection.sourceCampaignReport);
  boundedString(projection.projectionId, 'PortfolioLabCockpitProjectionV1.projectionId', 256);
  boundedString(projection.sourceCampaignId, 'PortfolioLabCockpitProjectionV1.sourceCampaignId', 256);
  for (const field of ['sourceCampaignHash', 'sourceReportHash', 'projectionHash']) {
    if (!/^[a-f0-9]{64}$/.test(projection[field])) fail('PROJECTION_HASH_INVALID', `${field} must be SHA-256`);
  }
  safeInteger(projection.generatedAtMs, 'PortfolioLabCockpitProjectionV1.generatedAtMs');
  if (projection.truthLabel !== 'SYNTHETIC_ONLY' || projection.mountStatus !== 'DIRECTOR_MOUNT_REQUIRED'
    || projection.mounted !== false || !Array.isArray(projection.controls) || projection.controls.length !== 0) {
    fail('PREVIEW_MOUNT_BOUNDARY_INVALID', 'prestage cockpit projection must be synthetic, unmounted, and control-free');
  }
  asRecord(projection.summary, 'PortfolioLabCockpitProjectionV1.summary');
  const summaryFields = ['evaluationCount', 'evaluatedCount', 'abstainCount', 'drawCount', 'uniqueDrawnCaseCount'];
  exactFields(projection.summary, summaryFields, 'PortfolioLabCockpitProjectionV1.summary');
  requireFields(projection.summary, summaryFields, 'PortfolioLabCockpitProjectionV1.summary');
  safeInteger(projection.summary.evaluationCount, 'PortfolioLabCockpitProjectionV1.summary.evaluationCount', { minimum: 1, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(projection.summary.evaluatedCount, 'PortfolioLabCockpitProjectionV1.summary.evaluatedCount', { minimum: 0, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(projection.summary.abstainCount, 'PortfolioLabCockpitProjectionV1.summary.abstainCount', { minimum: 0, maximum: MAX_CAMPAIGN_CASES });
  safeInteger(projection.summary.drawCount, 'PortfolioLabCockpitProjectionV1.summary.drawCount', { minimum: 1, maximum: MAX_CAMPAIGN_DRAWS });
  safeInteger(projection.summary.uniqueDrawnCaseCount, 'PortfolioLabCockpitProjectionV1.summary.uniqueDrawnCaseCount', { minimum: 1, maximum: MAX_CAMPAIGN_CASES });
  if (!Array.isArray(projection.scenarioMatrix) || !Array.isArray(projection.drillDownEvidence)) fail('PROJECTION_MATRIX_INVALID', 'scenarioMatrix and drillDownEvidence must be arrays');
  if (projection.drillDownEvidence.length !== projection.summary.evaluationCount
    || projection.scenarioMatrix.length !== projection.summary.evaluationCount) {
    fail('PROJECTION_COUNT_MISMATCH', 'preview evaluation count must match matrix and drill-down evidence');
  }
  projection.drillDownEvidence.forEach(validatePortfolioScenarioReport);
  if (projection.summary.evaluatedCount !== projection.drillDownEvidence.filter((row) => row.status === 'EVALUATED_COMPARATIVE').length
    || projection.summary.abstainCount !== projection.drillDownEvidence.filter((row) => row.status === 'ABSTAIN_UNKNOWN').length
    || projection.summary.evaluatedCount + projection.summary.abstainCount !== projection.summary.evaluationCount) {
    fail('PROJECTION_COUNT_MISMATCH', 'preview status counts must match drill-down evidence');
  }
  const expectedMatrix = projection.drillDownEvidence.map(matrixRow);
  if (sha256(projection.scenarioMatrix) !== sha256(expectedMatrix)) fail('PROJECTION_MATRIX_BINDING_MISMATCH', 'preview matrix must exactly project its drill-down evidence');
  validateConcentrationMap(projection.concentration, projection.sourceCampaignReport.sourceSnapshot);
  validateRelationshipGraph(projection.relationshipGraph, projection.sourceCampaignReport.sourceSnapshot);
  const snapshotHashes = new Set(projection.drillDownEvidence.map((row) => row.snapshotHash));
  if (snapshotHashes.size !== 1 || !snapshotHashes.has(projection.concentration.snapshotHash)
    || !snapshotHashes.has(projection.relationshipGraph.snapshotHash)) {
    fail('PROJECTION_SNAPSHOT_BINDING_MISMATCH', 'preview evidence and analysis artifacts must bind one snapshot');
  }
  validatePortfolioViews(projection.portfolioViews, projection.drillDownEvidence, projection.relationshipGraph.graphHash);
  asRecord(projection.advisoryFinding, 'PortfolioLabCockpitProjectionV1.advisoryFinding');
  exactFields(projection.advisoryFinding, ['advisoryOnly', 'sizingSupported', 'noSizingReason', 'ownerAction'], 'PortfolioLabCockpitProjectionV1.advisoryFinding');
  requireFields(projection.advisoryFinding, ['advisoryOnly', 'sizingSupported', 'noSizingReason', 'ownerAction'], 'PortfolioLabCockpitProjectionV1.advisoryFinding');
  boundedString(projection.advisoryFinding.noSizingReason, 'PortfolioLabCockpitProjectionV1.advisoryFinding.noSizingReason', 2_048);
  if (projection.advisoryFinding.advisoryOnly !== true || projection.advisoryFinding.sizingSupported !== false
    || projection.advisoryFinding.ownerAction !== null) {
    fail('ADVISORY_FINDING_BOUNDARY_INVALID', 'preview finding must remain advisory with no sizing or owner action');
  }
  stringArray(projection.limitations, 'PortfolioLabCockpitProjectionV1.limitations', 64);
  if (sha256(projection.limitations) !== sha256(PREVIEW_LIMITATIONS)) fail('PREVIEW_LIMITATION_SET_INVALID', 'preview limitations must preserve every prestage boundary');
  if (projection.truthClass !== 'FIXTURE_PROJECTION' || projection.authorityClass !== 'NO_AUTHORITY'
    || projection.networkMode !== 'FIXTURE_ONLY' || projection.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'preview must remain fixture-only, non-canonical, and non-authoritative');
  }
  validateFixtureOutput(projection);
  if (canonicalBytes(projection).length > MAX_PREVIEW_BYTES) fail('PREVIEW_RESOURCE_BOUND_EXCEEDED', `preview exceeds ${MAX_PREVIEW_BYTES} canonical bytes`);
  if (projection.projectionHash !== sha256(omitFields(projection, ['projectionHash']))) {
    fail('PROJECTION_HASH_MISMATCH', 'projectionHash does not match canonical content');
  }
  const expectedProjection = projectPortfolioLabCockpit(projection.sourceCampaignReport, projection.generatedAtMs);
  if (sha256(projection) !== sha256(expectedProjection)) {
    fail('PROJECTION_SOURCE_BINDING_MISMATCH', 'preview must be exactly derived from its embedded campaign report');
  }
  return true;
}
