import { arrayValue, asRecord, deepFreeze, safeInteger, stableSort } from './guards.mjs';
import { assertObservationBoundary } from './boundary.mjs';

export function buildFixturePreview({ generatedAtMs, health, dislocations, sourceReviews, contextInformationSet }) {
  safeInteger(generatedAtMs, 'preview.generatedAtMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  asRecord(health, 'preview.health');
  arrayValue(dislocations, 'preview.dislocations', { maximum: 1_000 });
  arrayValue(sourceReviews, 'preview.sourceReviews', { maximum: 1_000 });
  asRecord(contextInformationSet, 'preview.contextInformationSet');
  const rows = stableSort(dislocations.map((projection) => ({
    projectionId: projection.projectionId,
    state: projection.state,
    rawSpreadBps: projection.rawSpreadBps,
    netSpreadBps: projection.netSpreadBps,
    economicState: projection.economicState,
    action: null,
  })), (row) => row.projectionId);
  const preview = {
    schema: 'VenueMeshFixturePreviewV1',
    version: 1,
    generatedAtMs,
    banner: 'FIXTURE_ONLY · NON_AUTHORITATIVE · NOT LIVE · NO EXECUTION',
    previewClass: 'ISOLATED_MODULE_PREVIEW',
    cockpitProjectionClaimed: false,
    canonicalProductHealthClaimed: false,
    sourceHealth: {
      aggregateState: health.aggregateState,
      coherentCount: health.coherentCount,
      totalCount: health.totalCount,
      rows: health.rows,
    },
    dislocations: rows,
    sourceEligibility: stableSort(sourceReviews.map((review) => ({
      sourceId: review.sourceId,
      status: review.status,
      termsExpired: review.termsExpired,
      retentionEligible: review.marketDataRetentionEligible,
    })), (row) => row.sourceId),
    context: {
      eligibleIndependentFamilyCount: contextInformationSet.eligibleIndependentFamilyCount,
      excludedCount: contextInformationSet.excludedCount,
    },
    limitations: [
      'DOCUMENTATION-DERIVED SYNTHETIC FIXTURES ONLY',
      'NO LIVE TRANSPORT OR CREDENTIAL PATH',
      'NO CANONICAL SOURCE, FEATURE, HEALTH, OR COCKPIT WRITE',
      'NO EXECUTABILITY OR PROFITABILITY CLAIM',
    ],
    truthClass: 'FIXTURE_DESCRIPTION',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    networkMode: 'FIXTURE_ONLY',
  };
  assertObservationBoundary(preview);
  return deepFreeze(preview);
}
