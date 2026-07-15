import { asRecord, cloneCanonical, deepFreeze } from './guards.mjs';
import { validateMarketEvidenceEnvelope, validateVenueUnavailableObservation } from './evidence.mjs';
import { validateVenueDislocationProjection } from './comparison.mjs';
import { fail } from './errors.mjs';

export function materializeEvidenceAdapterFixture(normalizationResult) {
  asRecord(normalizationResult, 'normalizationResult');
  if (normalizationResult.schema !== 'VenueNormalizationResultV1') fail('EVIDENCE_ADAPTER_SOURCE_INVALID', 'evidence adapter requires a VenueNormalizationResultV1');
  if (normalizationResult.observation.schema === 'VenueUnavailableObservationV1') {
    validateVenueUnavailableObservation(normalizationResult.observation);
    return deepFreeze({
      schema: 'VenueUnavailableEvidenceAdapterResultV1',
      canonicalEvidence: null,
      unavailableObservation: cloneCanonical(normalizationResult.observation),
      availability: cloneCanonical(normalizationResult.availability),
      canonicalStateWritten: false,
      authorityClass: 'NO_AUTHORITY',
      canonical: false,
      networkMode: 'FIXTURE_ONLY',
    });
  }
  validateMarketEvidenceEnvelope(normalizationResult.observation);
  return deepFreeze(cloneCanonical(normalizationResult.observation));
}

export function materializeDerivedFeatureAdapterFixture(projection) {
  asRecord(projection, 'projection');
  validateVenueDislocationProjection(projection);
  return deepFreeze(cloneCanonical(projection.featureValue));
}
