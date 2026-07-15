import {
  canonicalBytes,
  deepFreeze,
  omitFields,
  sha256,
} from '../../dock/src/canonical.mjs';
import { runFixtureLoad } from '../../dock/src/resources.mjs';
import {
  evaluatePortfolioCampaign,
  validatePortfolioCampaignReport,
} from './campaign.mjs';
import { SCENARIO_KINDS } from './contracts.mjs';
import { fail } from './errors.mjs';

export const RESOURCE_PROOF_PARAMETERS = Object.freeze({
  windowSizeMs: 1_000,
  maxEvents: 20,
  maxQueueDepth: 0,
  storageBytesPerEvent: 0,
  latencySamplesAtLimit: Object.freeze(new Array(20).fill(1)),
});

export const EXPECTED_RESOURCE_BUDGET_CLAIM_HASH = '0110558ff5668d254c2c19cf84b882061aaea1114e9fa42ceb98d4e0cdb5925c';
export const EXPECTED_MAX_SAFE_RATE_CLAIM_HASH = '535795a28f276a03c48223bc18070d418432331259f825c5a99d2f7ad40404b2';

function executeAcceptanceWorkload(snapshot, campaign) {
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  validatePortfolioCampaignReport(report);
  if (report.evaluationCount !== RESOURCE_PROOF_PARAMETERS.maxEvents
    || campaign.evaluationInputs.length !== RESOURCE_PROOF_PARAMETERS.maxEvents
    || campaign.mode !== 'DECLARED_GRID'
    || campaign.drawCount !== RESOURCE_PROOF_PARAMETERS.maxEvents) {
    fail('RESOURCE_WORKLOAD_CASE_COUNT_MISMATCH', 'resource proof requires the exact declared-grid 20-case PortfolioLab workload');
  }
  const scenarioKinds = campaign.evaluationInputs.map((row) => row.scenarioKind);
  if (scenarioKinds.length !== SCENARIO_KINDS.length
    || scenarioKinds.some((kind, index) => kind !== SCENARIO_KINDS[index])) {
    fail('RESOURCE_WORKLOAD_CORPUS_MISMATCH', 'resource proof requires the frozen Section 5 scenario order');
  }
  const workloadIdentity = {
    snapshotHash: snapshot.snapshotHash,
    campaignHash: campaign.campaignHash,
    evaluationHashes: campaign.evaluationInputs.map((row) => row.evaluationHash),
  };
  const canonicalSerializedBytes = {
    snapshot: canonicalBytes(snapshot).length,
    campaign: canonicalBytes(campaign).length,
    report: canonicalBytes(report).length,
  };
  const receipt = {
    schema: 'PortfolioLabWorkloadReceiptV1',
    workloadHash: sha256(workloadIdentity),
    snapshotHash: snapshot.snapshotHash,
    campaignHash: campaign.campaignHash,
    reportHash: report.reportHash,
    evaluationCount: report.evaluationCount,
    scenarioKinds,
    canonicalSerializedBytes,
    deterministicStepDefinition: 'ONE_SCENARIO_EVALUATION_EQUALS_ONE_DETERMINISTIC_FIXTURE_STEP',
    storageBytesPersisted: 0,
    fixtureCompatibilityOnly: true,
  };
  receipt.receiptHash = sha256(omitFields(receipt, ['receiptHash']));
  return {
    report,
    receipt,
  };
}

export function provePortfolioLabResourceEnvelope(
  resourceBudgetClaim,
  maxSafeRateClaim,
  { snapshot, campaign },
) {
  if (sha256(resourceBudgetClaim) !== EXPECTED_RESOURCE_BUDGET_CLAIM_HASH) {
    fail('RESOURCE_CLAIM_MISMATCH', 'resource proof requires the exact packet-local resource budget claim');
  }
  if (sha256(maxSafeRateClaim) !== EXPECTED_MAX_SAFE_RATE_CLAIM_HASH) {
    fail('MAX_SAFE_RATE_CLAIM_MISMATCH', 'resource proof requires the exact packet-local maximum safe rate claim');
  }
  const workload = executeAcceptanceWorkload(snapshot, campaign);
  const common = {
    resourceBudgetClaim,
    maxSafeRateClaim,
    windowSizeMs: RESOURCE_PROOF_PARAMETERS.windowSizeMs,
    storageBytesPerEvent: RESOURCE_PROOF_PARAMETERS.storageBytesPerEvent,
    networkBytes: 0,
    modelCalls: 0,
  };
  const atLimit = runFixtureLoad({
    ...common,
    offeredEvents: workload.report.evaluationCount,
    peakQueueDepth: RESOURCE_PROOF_PARAMETERS.maxQueueDepth,
    latencySamples: RESOURCE_PROOF_PARAMETERS.latencySamplesAtLimit,
  });
  const beyondLimit = runFixtureLoad({
    ...common,
    offeredEvents: RESOURCE_PROOF_PARAMETERS.maxEvents + 1,
    peakQueueDepth: RESOURCE_PROOF_PARAMETERS.maxQueueDepth,
    latencySamples: [...RESOURCE_PROOF_PARAMETERS.latencySamplesAtLimit, 1],
  });
  return deepFreeze({
    schema: 'PortfolioLabResourceProofV1',
    version: 1,
    workloadReceipt: workload.receipt,
    atLimit,
    beyondLimit,
    fixtureCompatibilityOnly: true,
    hostPerformanceMeasured: false,
    productionPerformanceClaimed: false,
    authorityClass: 'NO_AUTHORITY',
  });
}
