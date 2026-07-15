import { invokeFacet, validateProviderFacetBinding } from '../../dock/src/index.mjs';
import { arrayValue, asRecord, cloneCanonical, deepFreeze, exactFields } from './guards.mjs';
import { validateMarketEvidenceEnvelope } from './evidence.mjs';
import { validateVenueDislocationProjection } from './comparison.mjs';
import { assertObservationBoundary } from './boundary.mjs';
import { fail } from './errors.mjs';

export const REQUIRED_F1_BINDINGS = Object.freeze({
  EVIDENCE: Object.freeze({
    operation: 'VALIDATE_FIXTURE',
    bindingHash: '69979efb8e2f01bee7d84d4e44cfeeb4116a268694112a44770da2b07460822d',
  }),
  DERIVED_FEATURE: Object.freeze({
    operation: 'EVALUATE_FIXTURE',
    bindingHash: '8f2768ad7eac3e2a273c457a05810cff19ac4ca174fd8fb77ddf70b3ec18ce86',
  }),
});

function validateBindings(bindings) {
  arrayValue(bindings, 'F1 bindings', { minimum: 2, maximum: 2 });
  const byClass = new Map();
  for (const binding of bindings) {
    validateProviderFacetBinding(binding);
    if (byClass.has(binding.facetClass)) fail('F1_FACET_DUPLICATE', `duplicate F1 facet ${binding.facetClass}`);
    byClass.set(binding.facetClass, binding);
  }
  for (const [facetClass, expected] of Object.entries(REQUIRED_F1_BINDINGS)) {
    const binding = byClass.get(facetClass);
    if (binding === undefined) fail('F1_FACET_MISSING', `F1 requires ${facetClass}`);
    if (binding.bindingStatus !== 'USABLE' || binding.operation !== expected.operation || binding.bindingHash !== expected.bindingHash) {
      fail('F1_FACET_PIN_MISMATCH', `${facetClass} does not match the frozen Dock binding`);
    }
  }
  return byClass;
}

function evidenceHandler(request) {
  const fixture = asRecord(request.fixture, 'EVIDENCE fixture');
  const records = Array.isArray(fixture.records)
    ? (exactFields(fixture, ['records'], 'EVIDENCE record container'), assertObservationBoundary(fixture), fixture.records)
    : [fixture];
  if (records.length === 0 || records.length > 10_000) fail('EVIDENCE_FIXTURE_COUNT_INVALID', 'evidence fixture must contain bounded records');
  for (const record of records) validateMarketEvidenceEnvelope(record);
  return {
    schema: 'FacetFixtureResponseV1',
    truthClass: 'FIXTURE_VALIDATION',
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    result: {
      valid: true,
      recordCount: records.length,
      evidenceIds: records.map((record) => record.evidenceId).sort(),
      canonicalStateWritten: false,
    },
  };
}

function derivedHandler(request) {
  const fixture = asRecord(request.fixture, 'DERIVED_FEATURE fixture');
  assertObservationBoundary(fixture);
  validateVenueDislocationProjection(fixture);
  return {
    schema: 'FacetFixtureResponseV1',
    truthClass: 'FIXTURE_PROJECTION',
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    result: {
      projectionId: fixture.projectionId,
      state: fixture.state,
      featureValue: cloneCanonical(fixture.featureValue),
      canonicalRegistryWritten: false,
      productionStreamOpened: false,
      trainingOrPromotionPerformed: false,
    },
  };
}

export function createVenueMeshFacetRuntime(bindings) {
  const byClass = validateBindings(bindings);
  const runtime = {
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    bindingHashes: Object.fromEntries([...byClass.entries()].sort().map(([facetClass, binding]) => [facetClass, binding.bindingHash])),
    validateEvidence(request) {
      return invokeFacet({
        binding: byClass.get('EVIDENCE'),
        requestFacetClass: 'EVIDENCE',
        operation: 'VALIDATE_FIXTURE',
        request,
        handler: evidenceHandler,
      });
    },
    evaluateDerivedFeature(request) {
      return invokeFacet({
        binding: byClass.get('DERIVED_FEATURE'),
        requestFacetClass: 'DERIVED_FEATURE',
        operation: 'EVALUATE_FIXTURE',
        request,
        handler: derivedHandler,
      });
    },
  };
  return Object.freeze(runtime);
}

export function makeFacetRequest(facetClass, fixture) {
  const expected = REQUIRED_F1_BINDINGS[facetClass];
  if (expected === undefined) fail('F1_FACET_FORBIDDEN', `${String(facetClass)} is not an F1 facet`);
  return deepFreeze({
    schema: 'FacetFixtureRequestV1',
    facetClass,
    operation: expected.operation,
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    fixture: cloneCanonical(fixture),
  });
}
