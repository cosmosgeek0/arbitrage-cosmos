import { sha256 } from '../../dock/src/index.mjs';
import { arrayValue, asRecord, boundedString, deepFreeze, enumValue, exactFields, safeInteger, stableSort } from './guards.mjs';
import { assertObservationBoundary } from './boundary.mjs';
import { buildSourceIndependenceGraph } from './source-independence.mjs';
import { evaluateSourceCard, validateSourceCardEnvelope } from './source-policy.mjs';
import { fail } from './errors.mjs';

export const CONTEXT_CLASSES = Object.freeze([
  'VENUE_STATUS',
  'LISTING_NOTICE',
  'TOKEN_UNLOCK',
  'TOKENOMICS_EVENT',
  'ONCHAIN_FLOW',
  'LIQUIDATION_SUMMARY',
  'BORROW_LENDING_CONDITION',
  'OFFICIAL_PROJECT_EVENT',
  'CANONICAL_NEWS_REFERENCE',
  'VENUE_DEPOSIT_WITHDRAWAL_RESTRICTION',
  'MACRO_CALENDAR',
]);

const CONTEXT_INPUT_FIELDS = Object.freeze(['contextClass', 'contextId', 'sourceId', 'upstreamOriginId', 'summary', 'provenanceRef', 'publishedAtMs', 'receivedAtMs', 'sourceAuthority']);

export function validateContextFixture(record) {
  asRecord(record, 'VenueContextFixtureV1');
  exactFields(record, [
    'schema', 'version', ...CONTEXT_INPUT_FIELDS, 'fixtureHash', 'truthClass',
    'authorityClass', 'canonical', 'networkMode',
  ], 'VenueContextFixtureV1');
  if (record.schema !== 'VenueContextFixtureV1' || record.version !== 1) fail('CONTEXT_FIXTURE_SCHEMA_INVALID', 'context fixture must be V1');
  enumValue(record.contextClass, CONTEXT_CLASSES, 'context.contextClass');
  for (const field of ['contextId', 'sourceId', 'upstreamOriginId', 'summary', 'provenanceRef']) boundedString(record[field], `context.${field}`, field === 'summary' ? 1_024 : 2_048);
  safeInteger(record.publishedAtMs, 'context.publishedAtMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  safeInteger(record.receivedAtMs, 'context.receivedAtMs', { minimum: record.publishedAtMs, maximum: 4_102_444_800_000 });
  enumValue(record.sourceAuthority, ['OFFICIAL_FIRST_PARTY', 'LICENSED_VENDOR', 'UNOFFICIAL_PROJECT_CLAIM', 'UNKNOWN'], 'context.sourceAuthority');
  if (record.truthClass !== 'EXTENSION_OBSERVATION' || record.authorityClass !== 'NO_AUTHORITY' || record.canonical !== false || record.networkMode !== 'FIXTURE_ONLY') {
    fail('CONTEXT_AUTHORITY_WIDENING', 'context fixture must remain a non-canonical fixture observation');
  }
  const hashInput = Object.fromEntries(CONTEXT_INPUT_FIELDS.map((field) => [field, record[field]]));
  if (record.fixtureHash !== sha256(hashInput)) fail('CONTEXT_FIXTURE_HASH_MISMATCH', 'context fixture hash does not match its exact input');
  assertObservationBoundary(record);
  return true;
}

export function createContextFixture(input) {
  asRecord(input, 'VenueContextFixtureV1');
  exactFields(input, CONTEXT_INPUT_FIELDS, 'VenueContextFixtureV1 input');
  assertObservationBoundary(input);
  enumValue(input.contextClass, CONTEXT_CLASSES, 'context.contextClass');
  for (const field of ['contextId', 'sourceId', 'upstreamOriginId', 'summary', 'provenanceRef']) boundedString(input[field], `context.${field}`, field === 'summary' ? 1_024 : 2_048);
  safeInteger(input.publishedAtMs, 'context.publishedAtMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  safeInteger(input.receivedAtMs, 'context.receivedAtMs', { minimum: input.publishedAtMs, maximum: 4_102_444_800_000 });
  enumValue(input.sourceAuthority, ['OFFICIAL_FIRST_PARTY', 'LICENSED_VENDOR', 'UNOFFICIAL_PROJECT_CLAIM', 'UNKNOWN'], 'context.sourceAuthority');
  const record = {
    schema: 'VenueContextFixtureV1',
    version: 1,
    contextClass: input.contextClass,
    contextId: input.contextId,
    sourceId: input.sourceId,
    upstreamOriginId: input.upstreamOriginId,
    summary: input.summary,
    provenanceRef: input.provenanceRef,
    publishedAtMs: input.publishedAtMs,
    receivedAtMs: input.receivedAtMs,
    sourceAuthority: input.sourceAuthority,
    fixtureHash: sha256(input),
    truthClass: 'EXTENSION_OBSERVATION',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    networkMode: 'FIXTURE_ONLY',
  };
  validateContextFixture(record);
  return deepFreeze(record);
}

export function evaluateContextInformationSet({ entries, cutoffMs, independenceGraph, sourceCardEnvelopes = [] }) {
  arrayValue(entries, 'context.entries', { maximum: 10_000 });
  safeInteger(cutoffMs, 'context.cutoffMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  asRecord(independenceGraph, 'context.independenceGraph');
  arrayValue(sourceCardEnvelopes, 'context.sourceCardEnvelopes', { maximum: 10_000 });
  if (independenceGraph.schema !== 'VenueSourceIndependenceGraphV1') fail('CONTEXT_INDEPENDENCE_GRAPH_INVALID', 'context requires a VenueSourceIndependenceGraphV1');
  const recomputedGraph = buildSourceIndependenceGraph(independenceGraph.sources);
  if (recomputedGraph.graphHash !== independenceGraph.graphHash) fail('CONTEXT_INDEPENDENCE_GRAPH_HASH_MISMATCH', 'context independence graph was not produced losslessly');
  const sourceCardById = new Map();
  for (const [index, envelope] of sourceCardEnvelopes.entries()) {
    validateSourceCardEnvelope(envelope);
    const sourceId = envelope.dataSourceCard.sourceId;
    if (sourceCardById.has(sourceId)) fail('CONTEXT_SOURCE_CARD_DUPLICATE', `duplicate source card for ${sourceId}`);
    const review = evaluateSourceCard(envelope, {
      expectedCanonicalProducerOwner: 'server.intelligenceRuntime',
      evaluatedAtMs: cutoffMs,
    });
    sourceCardById.set(sourceId, { envelope, review, index });
  }
  const graphSourceById = new Map(independenceGraph.sources.map((source) => [source.sourceId, source]));
  const familyBySource = new Map();
  for (const family of independenceGraph.families ?? []) {
    for (const sourceId of family.sourceIds) familyBySource.set(sourceId, family);
  }
  const rows = stableSort(entries.map((entry) => {
    validateContextFixture(entry);
    const reasons = [];
    const graphSource = graphSourceById.get(entry.sourceId) ?? null;
    if (graphSource === null) reasons.push('SOURCE_GRAPH_ENTRY_MISSING');
    else if (entry.upstreamOriginId !== graphSource.upstreamOriginId) reasons.push('SOURCE_UPSTREAM_ORIGIN_MISMATCH');
    if (entry.publishedAtMs > cutoffMs || entry.receivedAtMs > cutoffMs) reasons.push('POST_CUTOFF');
    if (!['OFFICIAL_FIRST_PARTY', 'LICENSED_VENDOR'].includes(entry.sourceAuthority)) reasons.push('SOURCE_NOT_OFFICIAL_OR_LICENSED');
    if (entry.sourceAuthority === 'LICENSED_VENDOR') {
      const binding = sourceCardById.get(entry.sourceId) ?? null;
      if (binding === null) reasons.push('LICENSED_SOURCE_CARD_MISSING');
      else {
        if (binding.envelope.sourcePolicy.upstreamOrigin !== entry.upstreamOriginId) reasons.push('LICENSED_SOURCE_ORIGIN_MISMATCH');
        if (binding.review.status !== 'ELIGIBLE_FOR_LATER_REVIEW') reasons.push('LICENSED_SOURCE_REVIEW_INELIGIBLE');
      }
    }
    const family = familyBySource.get(entry.sourceId) ?? null;
    if (family === null || family.confirmationWeight !== 1) reasons.push('SOURCE_INDEPENDENCE_UNKNOWN');
    return {
      contextId: entry.contextId,
      sourceId: entry.sourceId,
      contextClass: entry.contextClass,
      publishedAtMs: entry.publishedAtMs,
      receivedAtMs: entry.receivedAtMs,
      sourceAuthority: entry.sourceAuthority,
      provenanceRef: entry.provenanceRef,
      summary: entry.summary,
      state: reasons.length === 0 ? 'IN_INFORMATION_SET' : 'REJECTED',
      reasonCodes: reasons.sort(),
      familyId: family?.familyId ?? null,
      canonicalConfirmation: false,
    };
  }), (row) => row.contextId);
  const eligibleFamilies = [...new Set(rows.filter((row) => row.state === 'IN_INFORMATION_SET').map((row) => row.familyId).filter(Boolean))].sort();
  return deepFreeze({
    schema: 'VenueContextInformationSetV1',
    cutoffMs,
    rows,
    eligibleIndependentFamilyCount: eligibleFamilies.length,
    eligibleFamilyIds: eligibleFamilies,
    excludedCount: rows.filter((row) => row.state === 'REJECTED').length,
    canonicalTruthWritten: false,
    authorityClass: 'NO_AUTHORITY',
  });
}
