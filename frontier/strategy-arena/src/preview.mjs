import {
  cloneCanonical,
  deepFreeze,
  sha256,
  validateFixtureOutput,
} from '../../dock/src/index.mjs';
import { FIXED_LIMITATIONS } from './constants.mjs';
import { fail } from './validation.mjs';
import { validateStrategyArenaReport } from './tournament.mjs';

function validateArenaReport(report, campaign, ownerResolver) {
  try {
    validateStrategyArenaReport(report, campaign, ownerResolver);
  } catch (error) {
    if (error?.code !== undefined) throw error;
    fail('ARENA_REPORT_REQUIRED', 'cockpit preview requires a validated hypothetical StrategyArenaReportV1 advisory');
  }
}

export function createProductSurfaceProjection(report, campaign, ownerResolver) {
  const boundReport = deepFreeze(cloneCanonical(report));
  const boundCampaign = deepFreeze(cloneCanonical(campaign));
  validateArenaReport(boundReport, boundCampaign, ownerResolver);
  const datum = (fieldId, label, value, canonicalSource, { truthLabel = 'SYNTHETIC_ONLY', unavailableReason = null } = {}) => deepFreeze({
    fieldId,
    label,
    value,
    truthLabel,
    canonicalSource,
    unavailableReason,
  });
  return deepFreeze({
    surfaceId: 'control-room',
    label: 'StrategyArena research comparison',
    bindingState: 'DIRECTOR_MOUNT_REQUIRED',
    truthLabel: 'SYNTHETIC_ONLY',
    canonicalSource: 'frontier/strategy-arena/preview/tournament-scorecard.v1.json',
    evaluatedAtMs: boundReport.fixtureClock.evaluationCutoffMs,
    summary: `${boundReport.scorecards.length} frozen strategy packages; selection pressure unavailable; final holdout not implemented`,
    blocker: 'FRONTIER_PRESTAGE_UNMOUNTED',
    controlIds: [],
    correlationId: boundReport.reportHash,
    evidence: [
      datum('campaign-hash', 'campaign hash', boundReport.campaignHash, 'frontier/strategy-arena/fixtures/tournament-campaign.v1.json#campaignHash'),
      datum('report-hash', 'report hash', boundReport.reportHash, 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#reportHash'),
      datum('q-authority-hash', 'Q authority projection hash', boundReport.qAuthorityHash, 'frontier/strategy-arena/fixtures/q-validation-authority.v1.json#qAuthorityHash'),
      datum('scorecard-hashes', 'scorecard hashes', boundReport.scorecards.map((card) => card.scorecardHash).join(','), 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#scorecards'),
      datum('selection-pressure-state', 'whole-strategy selection pressure', boundReport.strategyTrialEvidenceState, 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#strategyTrialEvidenceState', {
        truthLabel: 'MISSING',
        unavailableReason: 'CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING',
      }),
      datum('final-holdout-state', 'whole-strategy final holdout', boundCampaign.qValidationAuthority.holdoutAccessState, 'frontier/strategy-arena/fixtures/q-validation-authority.v1.json#holdoutAccessState', {
        truthLabel: 'MISSING',
        unavailableReason: 'NEW_Q_WHOLE_STRATEGY_GRANT_AND_REPLAY_BUNDLE_REQUIRED',
      }),
    ],
  });
}

export function projectArenaCockpit(report, campaign, ownerResolver) {
  const boundReport = deepFreeze(cloneCanonical(report));
  const boundCampaign = deepFreeze(cloneCanonical(campaign));
  validateArenaReport(boundReport, boundCampaign, ownerResolver);
  const projection = {
    schema: 'StrategyArenaCockpitProjectionV1',
    version: 1,
    campaignId: boundReport.campaignId,
    campaignHash: boundReport.campaignHash,
    reportHash: boundReport.reportHash,
    readOnly: true,
    mounted: false,
    controls: [],
    sections: [
      { id: 'packages', state: 'SYNTHETIC_ONLY', rows: boundReport.scorecards.map((card) => ({ snapshotId: card.snapshotId, strategyRef: card.canonicalStrategyRef, strategyHash: card.canonicalStrategyHash, snapshotHash: card.strategySnapshotHash, comparability: card.comparability })) },
      { id: 'walk-forward-scorecards', state: 'SYNTHETIC_ONLY', rows: cloneCanonical(boundReport.scorecards) },
      { id: 'same-event-comparison', state: 'SYNTHETIC_ONLY', value: cloneCanonical(boundReport.sameEventComparison) },
      { id: 'opportunity-overlap-contention', state: 'SYNTHETIC_ONLY', value: cloneCanonical(boundReport.opportunityOverlapAndContention) },
      { id: 'pareto-ranking', state: 'ADVISORY_ONLY', value: cloneCanonical(boundReport.ranking) },
      { id: 'selection-pressure', state: 'UNAVAILABLE', value: { strategyTrialEvidenceState: boundReport.strategyTrialEvidenceState, strategyRecordedTrialCount: boundReport.strategyRecordedTrialCount, strategySelectionPressureRefs: cloneCanonical(boundReport.strategySelectionPressureRefs), reasonCodes: cloneCanonical(boundReport.selectionPressureReasonCodes) } },
      { id: 'costs-non-action-recovery', state: 'SYNTHETIC_ONLY', rows: boundReport.scorecards.map((card) => ({ snapshotId: card.snapshotId, comparability: card.comparability, unknownReasons: cloneCanonical(card.unknownReasons), costs: cloneCanonical(card.costs), nonActionQuality: cloneCanonical(card.nonActionQuality), falsePositiveCount: card.falsePositiveCount, missedOpportunityCount: card.missedOpportunityCount, ambiguityCount: card.ambiguityCount, capacityConstraintCount: card.capacityConstraintCount })) },
      { id: 'evidence-drill-down', state: 'SYNTHETIC_ONLY', value: cloneCanonical(boundReport.evidenceIndex) },
      { id: 'retirement-demotion-review', state: 'ADVISORY_ONLY', rows: cloneCanonical(boundReport.lifecycleAdvisories) },
      { id: 'meta-allocation-review', state: 'ADVISORY_ONLY', value: cloneCanonical(boundReport.metaAllocationAdvisory) },
      { id: 'source-dependence', state: boundReport.sourceDependenceWarnings.length === 0 ? 'MISSING' : 'SYNTHETIC_ONLY', rows: cloneCanonical(boundReport.sourceDependenceWarnings) },
      { id: 'limitations', state: 'UNAVAILABLE', rows: [...FIXED_LIMITATIONS] },
    ],
    limitations: [...FIXED_LIMITATIONS],
    productSurfaceProjection: createProductSurfaceProjection(boundReport, boundCampaign, ownerResolver),
    truthClass: 'FIXTURE_PROJECTION',
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    promotionAuthorized: false,
    allocationAuthorized: false,
    executionAuthorized: false,
  };
  projection.projectionHash = sha256(projection);
  validateFixtureOutput(projection);
  return deepFreeze(projection);
}
