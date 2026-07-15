import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  adaptFixture,
  parseExtensionDescriptor,
  reverseFixture,
  runFixtureLoad,
  validateCanonicalAdapterMap,
  validateInsertionRequest,
  validateResourceRateCompatibility,
} from '../../dock/src/index.mjs';
import {
  assessVenueMeshHealth,
  assertObservationBoundary,
  buildFixturePreview,
  buildSourceIndependenceGraph,
  compareInstrumentIdentity,
  compareRestAndStream,
  compareVenueQuotes,
  createContextFixture,
  createFixtureTransport,
  createInstrumentDescriptor,
  createVenueMeshFacetRuntime,
  decimalToMantissa,
  detectIdentityCollisions,
  evaluateContextInformationSet,
  evaluateFixtureLeadership,
  evaluateFreshness,
  evaluateSequence,
  evaluateSourceCard,
  makeFacetRequest,
  mapInstrumentIdentity,
  materializeDerivedFeatureAdapterFixture,
  materializeEvidenceAdapterFixture,
  materializeReviewOnlySourceCard,
  normalizeCoinbaseFixture,
  normalizeCoinbaseTradeFixture,
  normalizeDeribitFixture,
  normalizeKrakenBookFixture,
  normalizeKrakenFixture,
  normalizeTimestamp,
  PAYLOAD_FIELDS_BY_KIND,
  projectSourceHealthCanonicalState,
  simulateRateBudget,
  validateMarketEvidenceEnvelope,
  validateFeatureValueV1,
} from '../src/index.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, ROOT), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const code = (expected) => (error) => error?.code === expected;

const registry = read('fixtures/asset-registry.v1.json').entries;
const coinbaseFixture = read('fixtures/venues/coinbase-btc-usd.v1.json');
const krakenFixture = read('fixtures/venues/kraken-xbt-usd.v1.json');
const deribitFixture = read('fixtures/venues/deribit-btc-perpetual.v1.json');
const ownerMap = read('../dock/contracts/v1/canonical-owner-map.json');

function normalizeBase() {
  return {
    coinbase: normalizeCoinbaseFixture({ ...clone(coinbaseFixture), assetRegistry: clone(registry) }),
    kraken: normalizeKrakenFixture({ ...clone(krakenFixture), assetRegistry: clone(registry) }),
    deribit: normalizeDeribitFixture({ ...clone(deribitFixture), assetRegistry: clone(registry) }),
  };
}

function comparisonInput(overrides = {}) {
  const { coinbase, kraken } = normalizeBase();
  return {
    buyEvidence: coinbase.observation,
    sellEvidence: kraken.observation,
    buyIdentity: coinbase.identity,
    sellIdentity: kraken.identity,
    costs: { buyFeeBps: '5', sellFeeBps: '5', tickRoundingBps: '1', latencyBps: '2', depthImpactBps: '8' },
    intendedBaseSize: '1',
    asOfMs: 1_784_144_401_000,
    freshnessBoundsMs: { buy: 1_000, sell: 1_000 },
    sourceEligibility: { buy: true, sell: true },
    ...overrides,
  };
}

test('Coinbase, Kraken, and Deribit normalize deterministically without network authority', () => {
  const first = normalizeBase();
  const second = normalizeBase();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ['coinbase', 'deribit', 'kraken']);
  for (const result of [first.coinbase, first.kraken]) {
    assert.equal(result.networkMode, 'FIXTURE_ONLY');
    assert.equal(result.authorityClass, 'NO_AUTHORITY');
    assert.equal(result.networkOpened, false);
    assert.equal(result.canonicalStateWritten, false);
    validateMarketEvidenceEnvelope(result.observation);
  }
  assert.equal(first.deribit.identity.identityState, 'PARTIAL');
  assert.equal(first.deribit.identity.canonicalProduct, null);
  assert(first.deribit.identity.reasonCodes.includes('SETTLEMENT_SEMANTICS_UNSUPPORTED'));
  assert.equal(first.deribit.observation.status, 'UNAVAILABLE');
  assert.equal(first.deribit.availability.state, 'UNAVAILABLE');
  assert.deepEqual(first.deribit.metrics.map((row) => row.payloadKind), ['MARK', 'INDEX', 'FUNDING', 'OPEN_INTEREST']);
  assert(first.deribit.metrics.every((row) => row.status === 'UNAVAILABLE' && row.value === null));
  assert(first.deribit.metrics.every((row) => row.reasonCodes.includes('SETTLEMENT_SEMANTICS_UNSUPPORTED')));
  assert.equal(first.deribit.networkOpened, false);
});

test('same ticker text with different asset identity is a collision', () => {
  const { coinbase } = normalizeBase();
  const collision = { ...clone(coinbase.identity), identityId: 'vm-identity-other', baseCanonicalAssetId: 'asset:wrapped-bitcoin' };
  const rows = detectIdentityCollisions([coinbase.identity, collision]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'COLLISION');
  assert.deepEqual(rows[0].canonicalAssetIds, ['asset:bitcoin', 'asset:wrapped-bitcoin']);
});

test('quote mismatch blocks comparison rather than applying implicit conversion', () => {
  const input = comparisonInput();
  const mismatched = { ...clone(input.sellIdentity), quoteCanonicalAssetId: 'currency:eur' };
  const result = compareVenueQuotes({ ...input, sellIdentity: mismatched });
  assert.equal(result.state, 'DATA_INVALID');
  assert(result.reasonCodes.includes('QUOTE_CURRENCY_MISMATCH'));
  assert.equal(result.featureValue.value, null);
  const wrongLeg = compareVenueQuotes({ ...input, sellIdentity: input.buyIdentity });
  assert.equal(wrongLeg.state, 'DATA_INVALID');
  assert(wrongLeg.reasonCodes.some((reason) => reason.startsWith('SELL_EVIDENCE_')));
});

test('contract multiplier mismatch blocks derivative comparison', () => {
  const { deribit } = normalizeBase();
  const other = { ...clone(deribit.identity), identityId: 'vm-identity-contract-2', contractMultiplier: '1' };
  const result = compareInstrumentIdentity(deribit.identity, other);
  assert.equal(result.comparable, false);
  assert(result.reasonCodes.includes('CONTRACT_MULTIPLIER_MISMATCH'));
});

test('spot and derivative identity never become fungible comparison legs', () => {
  const { coinbase, deribit } = normalizeBase();
  const result = compareInstrumentIdentity(coinbase.identity, deribit.identity);
  assert.equal(result.comparable, false);
  assert(result.reasonCodes.includes('SPOT_DERIVATIVE_IDENTITY_MISMATCH'));
  assert(result.reasonCodes.includes('PRODUCT_FAMILY_MISMATCH'));
});

test('timestamp unit mismatch fails closed', () => {
  assert.throws(() => normalizeTimestamp({ raw: 1_784_144_400, unit: 'S', expectedUnit: 'MS', receiveTimeMs: 1_784_144_400_050 }), code('TIMESTAMP_UNIT_MISMATCH'));
});

test('future event clocks fail closed and cannot look fresh', () => {
  assert.throws(() => normalizeTimestamp({ raw: 1_784_144_401_000, unit: 'MS', receiveTimeMs: 1_784_144_400_000 }), code('TIMESTAMP_FUTURE_SKEW'));
  const freshness = evaluateFreshness({ eventTimeMs: 1_784_144_401_000, receiveTimeMs: 1_784_144_400_000, evaluatedAtMs: 1_784_144_400_500, maximumAgeMs: 1_000 });
  assert.equal(freshness.state, 'UNKNOWN');
  assert.equal(freshness.ageMs, null);
  const evidence = clone(normalizeBase().coinbase.observation);
  evidence.localReceiveTimeMs = 0;
  assert.throws(() => validateMarketEvidenceEnvelope(evidence), code('INTEGER_INVALID'));
});

test('one stale venue prevents an aggregate green', () => {
  const input = comparisonInput();
  const stale = clone(input.sellEvidence);
  stale.quality.freshness = 'STALE';
  const result = compareVenueQuotes({ ...input, sellEvidence: stale });
  assert.equal(result.state, 'STALE');
  assert.equal(result.netSpreadBps, null);
  const labeledFreshButOld = comparisonInput({ asOfMs: 1_784_144_500_000 });
  const recomputed = compareVenueQuotes(labeledFreshButOld);
  assert.equal(recomputed.state, 'STALE');
  assert(recomputed.reasonCodes.some((reason) => reason.endsWith('SOURCE_AGE_EXCEEDED')));
});

test('sequence gaps require a resnapshot', () => {
  const corpus = read('fixtures/transport/sequence-cases.v1.json');
  assert.deepEqual(corpus.cases.map((row) => row.caseId), ['contiguous', 'gap', 'reconnect-without-resnapshot', 'reconnect-with-resnapshot']);
  for (const fixtureCase of corpus.cases) {
    const { expectedState, caseId, ...input } = fixtureCase;
    assert.equal(evaluateSequence(input).state, expectedState, caseId);
  }
  const gap = evaluateSequence({ previousLast: 100, currentFirst: 103, currentLast: 103 });
  assert.equal(gap.state, 'GAP');
  assert.equal(gap.gapCount, 2);
  assert.equal(gap.resnapshotRequired, true);
  const reset = evaluateSequence({ previousLast: 100, currentFirst: 1, currentLast: 1, previousConnectionGeneration: 1, connectionGeneration: 2, resnapshotEstablished: true });
  assert.equal(reset.state, 'RESNAPSHOT_BASELINE');
  const overlap = evaluateSequence({ previousLast: 100, currentFirst: 99, currentLast: 101 });
  assert.equal(overlap.state, 'OVERLAP');
  assert.equal(overlap.coherent, false);
  assert.equal(overlap.resnapshotRequired, true);
  const contradictory = clone(coinbaseFixture);
  contradictory.source.sequence = 999;
  assert.throws(() => normalizeCoinbaseFixture({ ...contradictory, assetRegistry: clone(registry) }), code('SEQUENCE_PROVENANCE_CONTRADICTION'));
  const tradeFixture = read('fixtures/venues/coinbase-btc-usd-trade.v1.json');
  tradeFixture.source.sequence = 999;
  assert.throws(() => normalizeCoinbaseTradeFixture({ identity: normalizeBase().coinbase.identity, trade: tradeFixture.trade, clock: tradeFixture.clock, source: tradeFixture.source }), code('SEQUENCE_PROVENANCE_CONTRADICTION'));
});

test('reconnect without resnapshot remains incoherent', () => {
  const state = evaluateSequence({ previousLast: 100, currentFirst: 1, currentLast: 1, previousConnectionGeneration: 1, connectionGeneration: 2, resnapshotEstablished: false });
  assert.equal(state.state, 'RECONNECT_RESNAPSHOT_REQUIRED');
  assert.equal(state.coherent, false);
});

test('Kraken stateless snapshot does not fabricate a numeric sequence', () => {
  const { kraken } = normalizeBase();
  assert.equal(kraken.sequenceState.state, 'STATELESS_SNAPSHOT');
  assert.equal(kraken.observation.source.sequence, null);
  const bookFixture = read('fixtures/venues/kraken-xbt-usd-book.v1.json');
  bookFixture.source.sequence = 1;
  assert.throws(() => normalizeKrakenBookFixture({ identity: kraken.identity, book: bookFixture.book, clock: bookFixture.clock, source: bookFixture.source }), code('STATELESS_SEQUENCE_FIELD_FORBIDDEN'));
});

test('public trade and depth fixtures map into canonical evidence without schema conversion in Dock', () => {
  const base = normalizeBase();
  const tradeFixture = read('fixtures/venues/coinbase-btc-usd-trade.v1.json');
  const trade = normalizeCoinbaseTradeFixture({ identity: base.coinbase.identity, trade: tradeFixture.trade, clock: tradeFixture.clock, source: tradeFixture.source });
  assert.equal(trade.payloadKind, 'TRADE');
  assert.deepEqual(trade.payload, { makerSide: 'SELL', price: '100.2', size: '0.25', tradeId: '2001' });
  assert.deepEqual(Object.keys(trade.payload).sort(), [...PAYLOAD_FIELDS_BY_KIND.TRADE].sort());
  const bookFixture = read('fixtures/venues/kraken-xbt-usd-book.v1.json');
  const book = normalizeKrakenBookFixture({ identity: base.kraken.identity, book: bookFixture.book, clock: bookFixture.clock, source: bookFixture.source });
  assert.equal(book.payloadKind, 'BOOK_SNAPSHOT');
  assert.equal(book.payload.checksum, '3310070434');
  assert.equal(book.payload.integrityState, 'CHECKSUM_UNVERIFIED_FIXTURE');
  assert.equal(book.quality.completeness, 'PARTIAL');
  assert.equal(book.source.sequence, null);
  assert.deepEqual(Object.keys(book.payload).sort(), [...PAYLOAD_FIELDS_BY_KIND.BOOK_SNAPSHOT].sort());
  const crossed = clone(bookFixture);
  crossed.book.bids[0][0] = '101';
  assert.throws(() => normalizeKrakenBookFixture({ identity: base.kraken.identity, book: crossed.book, clock: crossed.clock, source: crossed.source }), code('BOOK_CROSSED'));
});

test('unknown or changed raw bundle schema fails closed', () => {
  const fixture = clone(coinbaseFixture);
  fixture.version = 2;
  assert.throws(() => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) }), code('RAW_FIXTURE_SCHEMA_INVALID'));
});

test('REST-versus-stream disagreement preserves both observations and chooses no winner', () => {
  const { coinbase } = normalizeBase();
  const rest = clone(coinbase.observation);
  rest.evidenceId = 'vm.ev.rest.fixture';
  rest.source.streamClass = 'REST_BOOK_TICKER_FIXTURE';
  const stream = clone(coinbase.observation);
  stream.evidenceId = 'vm.ev.stream.disagreement';
  stream.source.streamClass = 'STREAM_BOOK_TICKER_FIXTURE';
  stream.payload.bidPrice = '99';
  const comparisonBounds = { asOfMs: 1_784_144_401_000, maximumAgeMsByPath: { rest: 1_000, stream: 1_000 }, maximumObservationSkewMs: 1_000 };
  const result = compareRestAndStream({ rest, stream, toleranceBps: '1', ...comparisonBounds });
  assert.equal(result.state, 'DIVERGED');
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map((row) => row.path), ['REST', 'STREAM']);
  assert.equal(result.observations[0].source.streamClass, 'REST_BOOK_TICKER_FIXTURE');
  assert.equal(result.observations[1].source.streamClass, 'STREAM_BOOK_TICKER_FIXTURE');
  assert.equal(result.winnerSelected, false);
  assert.equal(result.averageFabricated, false);
  const wrongAsset = clone(stream);
  wrongAsset.instrumentGraph.canonicalAsset = 'asset:wrapped-bitcoin';
  assert.throws(() => compareRestAndStream({ rest, stream: wrongAsset, toleranceBps: '1', ...comparisonBounds }), code('DISAGREEMENT_IDENTITY_MISMATCH'));
  const stale = compareRestAndStream({ rest, stream, toleranceBps: '1', ...comparisonBounds, asOfMs: 1_784_144_500_000 });
  assert.equal(stale.state, 'STALE');
  const gapped = clone(stream);
  gapped.quality.gapCount = 1;
  const incoherent = compareRestAndStream({ rest, stream: gapped, toleranceBps: '1', ...comparisonBounds });
  assert.equal(incoherent.state, 'INCOHERENT');
  const wrongPath = clone(rest);
  wrongPath.source.streamClass = 'WEBSOCKET_TICKER_FIXTURE';
  assert.throws(() => compareRestAndStream({ rest: wrongPath, stream, toleranceBps: '1', ...comparisonBounds }), code('DISAGREEMENT_PATH_CLASS_INVALID'));
});

test('delisted or suspended instruments are unavailable, never zero', () => {
  const fixture = clone(coinbaseFixture);
  fixture.product.status = 'delisted';
  fixture.product.trading_disabled = true;
  const result = normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) });
  assert.equal(result.availability.state, 'UNAVAILABLE');
  assert.equal(result.observation.status, 'UNAVAILABLE');
  assert.equal(result.observation.value, null);
  const onlineButSuspended = clone(coinbaseFixture);
  onlineButSuspended.product.status = 'online';
  onlineButSuspended.product.trading_disabled = true;
  const suspended = normalizeCoinbaseFixture({ ...onlineButSuspended, assetRegistry: clone(registry) });
  assert.equal(suspended.availability.state, 'UNAVAILABLE');
  assert(suspended.availability.reasonCodes.includes('TRADING_DISABLED'));
});

test('maintenance and rate pressure degrade source health explicitly', () => {
  const { coinbase, kraken } = normalizeBase();
  const health = assessVenueMeshHealth({
    results: [coinbase, kraken],
    evaluatedAtMs: 1_784_144_401_000,
    maximumAgeMsByVenue: { COINBASE: 1_000, KRAKEN: 1_000 },
    maintenanceByVenue: { COINBASE: 'MAINTENANCE', KRAKEN: 'NORMAL' },
    rateBudgetByVenue: { COINBASE: 'WITHIN_BUDGET', KRAKEN: 'RATE_LIMITED' },
  });
  assert.equal(health.aggregateState, 'ALL_FIXTURES_UNAVAILABLE_OR_DEGRADED');
  const coinbaseHealth = health.rows.find((row) => row.venue === 'COINBASE');
  const krakenHealth = health.rows.find((row) => row.venue === 'KRAKEN');
  assert(coinbaseHealth.reasonCodes.includes('MAINTENANCE_WINDOW'));
  assert.equal(coinbaseHealth.reasonCodes.includes('RATE_LIMITED'), false);
  assert(krakenHealth.reasonCodes.includes('RATE_LIMITED'));
  assert.equal(krakenHealth.reasonCodes.includes('MAINTENANCE_WINDOW'), false);
  assert.equal(health.canonicalProductHealthWritten, false);
  const degradedProjection = projectSourceHealthCanonicalState(health);
  for (const projected of degradedProjection.rows) {
    const source = health.rows.find((row) => row.venue === projected.venue);
    assert.equal(projected.extensionFixtureState, source.state);
    assert.deepEqual(projected.reasonCodes, source.reasonCodes);
    assert.equal(projected.extensionEvidenceId, source.evidenceId);
    assert.equal(projected.extensionFreshness, source.freshness);
    assert.equal(projected.extensionCompleteness, source.completeness);
    assert.equal(projected.canonicalObservedState, 'STOPPED');
  }
  const old = assessVenueMeshHealth({ results: [coinbase], evaluatedAtMs: 1_784_144_500_000, maximumAgeMsByVenue: { COINBASE: 1_000 }, maintenanceByVenue: { COINBASE: 'NORMAL' }, rateBudgetByVenue: { COINBASE: 'WITHIN_BUDGET' } });
  assert.equal(old.aggregateState, 'ALL_FIXTURES_UNAVAILABLE_OR_DEGRADED');
  assert(old.rows[0].reasonCodes.includes('SOURCE_AGE_EXCEEDED'));
  const suspendedFixture = clone(coinbaseFixture);
  suspendedFixture.product.trading_disabled = true;
  const suspended = normalizeCoinbaseFixture({ ...suspendedFixture, assetRegistry: clone(registry) });
  const unavailable = assessVenueMeshHealth({
    results: [suspended],
    evaluatedAtMs: 1_784_144_401_000,
    maximumAgeMsByVenue: { COINBASE: 1_000 },
    maintenanceByVenue: { COINBASE: 'NORMAL' },
    rateBudgetByVenue: { COINBASE: 'WITHIN_BUDGET' },
    disagreements: [{ venue: 'COINBASE', state: 'DIVERGED' }],
  });
  assert.equal(unavailable.rows[0].state, 'FIXTURE_UNAVAILABLE');
  const canonicalProjection = projectSourceHealthCanonicalState(unavailable);
  assert.equal(canonicalProjection.rows[0].canonicalObservedState, 'STOPPED');
  assert.equal(canonicalProjection.rows[0].extensionFixtureState, 'FIXTURE_UNAVAILABLE');
  assert.equal(canonicalProjection.canonicalStateWritten, false);
  const unknown = assessVenueMeshHealth({ results: [coinbase], evaluatedAtMs: 1_784_144_401_000, maximumAgeMsByVenue: {} });
  assert(unknown.rows[0].reasonCodes.includes('FRESHNESS_BOUND_UNKNOWN'));
  assert(unknown.rows[0].reasonCodes.includes('MAINTENANCE_STATE_UNKNOWN'));
  assert(unknown.rows[0].reasonCodes.includes('RATE_BUDGET_UNKNOWN'));
  const unknownProjection = projectSourceHealthCanonicalState(unknown).rows[0];
  assert.deepEqual(unknownProjection.reasonCodes, unknown.rows[0].reasonCodes);
  assert.equal(unknownProjection.extensionFixtureState, 'FIXTURE_DEGRADED');
});

test('apparent spread dies after the complete synthetic cost stack', () => {
  const result = compareVenueQuotes(comparisonInput());
  assert.equal(result.rawSpreadBps, '19.98001998002');
  assert.equal(result.costStackBps, '21');
  assert.equal(result.netSpreadBps, '-1.01998001998');
  assert.equal(result.economicState, 'NON_VIABLE_AFTER_COSTS');
  assert.equal(result.action, null);
});

test('unknown fee, latency, tick, impact, or depth blocks economic output', () => {
  for (const field of ['buyFeeBps', 'sellFeeBps', 'tickRoundingBps', 'latencyBps', 'depthImpactBps']) {
    const input = comparisonInput();
    input.costs[field] = null;
    const result = compareVenueQuotes(input);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.featureValue.value, null);
  }
  const input = comparisonInput();
  const missingDepth = clone(input.buyEvidence);
  missingDepth.payload.askSize = null;
  missingDepth.quality.completeness = 'PARTIAL';
  const result = compareVenueQuotes({ ...input, buyEvidence: missingDepth });
  assert.equal(result.state, 'UNKNOWN');
});

test('insufficient depth blocks the projection', () => {
  const result = compareVenueQuotes(comparisonInput({ intendedBaseSize: '10' }));
  assert.equal(result.state, 'UNKNOWN');
  assert(result.reasonCodes.includes('EXECUTABLE_DEPTH_INSUFFICIENT'));
});

test('source cards use the exact Q gate order and fail closed on unproven retention', () => {
  const cardInput = read('fixtures/source-cards/review-inputs.v1.json').cards[0];
  const envelope = materializeReviewOnlySourceCard(clone(cardInput));
  assert.deepEqual(envelope.dataSourceCard.gates.map((gate) => gate.gate), [
    'OFFICIAL_OR_LICENSED_ACCESS',
    'STABLE_IDENTITY_MAPPING',
    'TIMESTAMP_SEQUENCE_SEMANTICS',
    'RETENTION_PERMISSION',
    'RESOURCE_RATE_BUDGET',
    'EXPLICIT_HYPOTHESIS_VALUE',
    'CANONICAL_PRODUCER_OWNERSHIP',
    'OBSERVABLE_FAILURE_STATE',
  ]);
  const review = evaluateSourceCard(envelope, { expectedCanonicalProducerOwner: 'server.intelligenceRuntime', evaluatedAtMs: cardInput.evaluatedAtMs });
  assert.equal(review.status, 'INELIGIBLE');
  assert(review.failedGateCodes.includes('RETENTION_PERMISSION'));
  assert.equal(review.marketDataRetentionEligible, false);
});

test('terms revision and review expiry invalidate cached fixture eligibility', () => {
  const cardInput = read('fixtures/source-cards/review-inputs.v1.json').cards[1];
  const envelope = materializeReviewOnlySourceCard(clone(cardInput));
  const changed = evaluateSourceCard(envelope, { expectedCanonicalProducerOwner: 'server.intelligenceRuntime', evaluatedAtMs: cardInput.evaluatedAtMs, observedTermsContentSha256: '0'.repeat(64) });
  assert.equal(changed.termsChanged, true);
  assert.equal(changed.documentationFixtureEligibility, 'INELIGIBLE');
  const expired = evaluateSourceCard(envelope, { expectedCanonicalProducerOwner: 'server.intelligenceRuntime', evaluatedAtMs: cardInput.sourcePolicy.nextReviewAtMs });
  assert.equal(expired.termsExpired, true);
  assert.equal(expired.documentationFixtureEligibility, 'INELIGIBLE');
  const backdated = evaluateSourceCard(envelope, { expectedCanonicalProducerOwner: 'server.intelligenceRuntime', evaluatedAtMs: cardInput.evaluatedAtMs - 1 });
  assert.equal(backdated.evaluatedBeforeReview, true);
  assert.equal(backdated.status, 'INELIGIBLE');
  assert.equal(backdated.documentationFixtureEligibility, 'INELIGIBLE');
});

test('copied and mirrored sources count as one independence family', () => {
  const fixture = read('fixtures/context/point-in-time.v1.json');
  const graph = buildSourceIndependenceGraph(fixture.sources);
  const family = graph.families.find((row) => row.sourceIds.includes('coinbase-official'));
  assert.deepEqual(family.sourceIds, ['coinbase-mirror', 'coinbase-official']);
  assert.equal(family.confirmationWeight, 1);
  assert.equal(graph.independentFamilyCount, 2);
});

test('unknown upstream origin is not counted as independent confirmation', () => {
  const fixture = read('fixtures/context/point-in-time.v1.json');
  const graph = buildSourceIndependenceGraph(fixture.sources);
  const unknown = graph.families.find((row) => row.sourceIds.includes('project-blog'));
  assert.equal(unknown.confirmationWeight, 0);
  assert.equal(unknown.dependenceState, 'UNKNOWN_NOT_COUNTED');
});

test('copy cycles are rejected', () => {
  assert.throws(() => buildSourceIndependenceGraph([
    { sourceId: 'a', upstreamOriginId: 'o', vendorFamilyId: 'v', copiedFromSourceId: 'b', relationship: 'MIRROR' },
    { sourceId: 'b', upstreamOriginId: 'o', vendorFamilyId: 'v', copiedFromSourceId: 'a', relationship: 'MIRROR' },
  ]), code('SOURCE_COPY_CYCLE'));
  assert.throws(() => buildSourceIndependenceGraph([
    { sourceId: 'orphan', upstreamOriginId: 'claimed-origin', vendorFamilyId: 'claimed-vendor', copiedFromSourceId: null, relationship: 'MIRROR' },
  ]), code('SOURCE_DEPENDENCE_PROVENANCE_INCOMPLETE'));
});

test('post-cutoff context and unofficial claims are rejected from the information set', () => {
  const fixture = read('fixtures/context/point-in-time.v1.json');
  const entries = fixture.entries.map((entry) => createContextFixture(entry));
  const graph = buildSourceIndependenceGraph(fixture.sources);
  const set = evaluateContextInformationSet({ entries, cutoffMs: fixture.cutoffMs, independenceGraph: graph });
  assert(set.rows.find((row) => row.contextId.includes('after-cutoff')).reasonCodes.includes('POST_CUTOFF'));
  assert(set.rows.find((row) => row.contextId.includes('unofficial')).reasonCodes.includes('SOURCE_NOT_OFFICIAL_OR_LICENSED'));
  assert.equal(set.eligibleIndependentFamilyCount, 1);
  assert.equal(set.canonicalTruthWritten, false);
  const official = set.rows.find((row) => row.contextId === 'context.coinbase.status.1');
  assert.equal(official.receivedAtMs, 1_784_144_399_050);
  assert.equal(official.provenanceRef, 'fixture://venue-mesh/context/coinbase-status');
  const mirror = set.rows.find((row) => row.contextId === 'context.coinbase.mirror.1');
  assert(mirror.reasonCodes.includes('LICENSED_SOURCE_CARD_MISSING'));
  assert.throws(() => evaluateContextInformationSet({
    entries,
    cutoffMs: fixture.cutoffMs,
    independenceGraph: graph,
    sourceCardEnvelopes: [{ sourceId: 'coinbase-mirror', status: 'ELIGIBLE_FOR_LATER_REVIEW' }],
  }), code('REQUIRED_FIELD_MISSING'));
  const eligibleInput = clone(read('fixtures/source-cards/review-inputs.v1.json').cards[1]);
  eligibleInput.sourceId = 'coinbase-mirror';
  eligibleInput.evaluatedAtMs = fixture.cutoffMs - 1_000;
  eligibleInput.sourcePolicy.upstreamOrigin = 'coinbase-first-party';
  eligibleInput.sourcePolicy.reviewedAtMs = fixture.cutoffMs - 1_000;
  eligibleInput.sourcePolicy.nextReviewAtMs = fixture.cutoffMs + 10_000;
  eligibleInput.sourcePolicy.retentionPermission = 'PERMITTED';
  eligibleInput.gateEvidenceDigests.RETENTION_PERMISSION = [eligibleInput.sourcePolicy.documentationContentSha256];
  const eligibleCard = materializeReviewOnlySourceCard(eligibleInput);
  const admitted = evaluateContextInformationSet({ entries, cutoffMs: fixture.cutoffMs, independenceGraph: graph, sourceCardEnvelopes: [eligibleCard] });
  assert.equal(admitted.rows.find((row) => row.contextId === 'context.coinbase.mirror.1').state, 'IN_INFORMATION_SET');
  const wrongOriginCard = clone(eligibleCard);
  wrongOriginCard.sourcePolicy.upstreamOrigin = 'different-origin';
  const originRejected = evaluateContextInformationSet({ entries, cutoffMs: fixture.cutoffMs, independenceGraph: graph, sourceCardEnvelopes: [wrongOriginCard] });
  assert(originRejected.rows.find((row) => row.contextId === 'context.coinbase.mirror.1').reasonCodes.includes('LICENSED_SOURCE_ORIGIN_MISMATCH'));
  const expiredCard = clone(eligibleCard);
  expiredCard.sourcePolicy.nextReviewAtMs = fixture.cutoffMs;
  const expiredSet = evaluateContextInformationSet({ entries, cutoffMs: fixture.cutoffMs, independenceGraph: graph, sourceCardEnvelopes: [expiredCard] });
  assert(expiredSet.rows.find((row) => row.contextId === 'context.coinbase.mirror.1').reasonCodes.includes('LICENSED_SOURCE_REVIEW_INELIGIBLE'));
  const postCutoffReviewCard = clone(eligibleCard);
  postCutoffReviewCard.dataSourceCard.evaluatedAtMs = fixture.cutoffMs + 1;
  postCutoffReviewCard.sourcePolicy.reviewedAtMs = fixture.cutoffMs + 1;
  postCutoffReviewCard.sourcePolicy.nextReviewAtMs = fixture.cutoffMs + 10_000;
  const backdatedSet = evaluateContextInformationSet({ entries, cutoffMs: fixture.cutoffMs, independenceGraph: graph, sourceCardEnvelopes: [postCutoffReviewCard] });
  assert(backdatedSet.rows.find((row) => row.contextId === 'context.coinbase.mirror.1').reasonCodes.includes('LICENSED_SOURCE_REVIEW_INELIGIBLE'));
  const graphMisboundEntry = createContextFixture({ ...fixture.entries[0], upstreamOriginId: 'different-origin' });
  const graphMisbound = evaluateContextInformationSet({ entries: [graphMisboundEntry], cutoffMs: fixture.cutoffMs, independenceGraph: graph });
  assert(graphMisbound.rows[0].reasonCodes.includes('SOURCE_UPSTREAM_ORIGIN_MISMATCH'));
  const tampered = clone(entries[0]);
  tampered.summary = 'tampered after hash';
  assert.throws(() => evaluateContextInformationSet({ entries: [tampered], cutoffMs: fixture.cutoffMs, independenceGraph: graph }), code('CONTEXT_FIXTURE_HASH_MISMATCH'));
  for (const [field, value] of [['sourceId', 'other'], ['receivedAtMs', fixture.cutoffMs], ['provenanceRef', 'fixture://tampered'], ['sourceAuthority', 'LICENSED_VENDOR']]) {
    const changed = clone(entries[0]);
    changed[field] = value;
    assert.throws(() => evaluateContextInformationSet({ entries: [changed], cutoffMs: fixture.cutoffMs, independenceGraph: graph }), code('CONTEXT_FIXTURE_HASH_MISMATCH'));
  }
});

test('proved-missing context matrix never fabricates an admitted source', () => {
  const matrix = read('fixtures/context/capability-matrix.v1.json');
  assert.equal(matrix.rows.some((row) => row.status === 'ADMITTED'), false);
  assert(matrix.rows.some((row) => row.contextClass === 'BORROW_LENDING_CONDITION' && row.canonicalOwner === 'L_EXECUTABLE_SEMANTICS'));
  assert(matrix.rows.some((row) => row.contextClass === 'CANONICAL_NEWS_REFERENCE' && row.status === 'ALREADY_OWNED_ADAPTER_REQUIRED'));
  assert(matrix.rows.some((row) => row.contextClass === 'TOKENOMICS_EVENT' && row.status === 'UNAVAILABLE_NOT_ADMITTED'));
  assert(matrix.rows.some((row) => row.contextClass === 'VENUE_DEPOSIT_WITHDRAWAL_RESTRICTION' && row.status === 'UNAVAILABLE_NOT_ADMITTED'));
});

test('missing source value never becomes numeric zero', () => {
  for (const [venue, field, normalize] of [
    ['COINBASE', 'best_bid', (fixture) => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['COINBASE', 'best_ask', (fixture) => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['KRAKEN', 'bid', (fixture) => normalizeKrakenFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['KRAKEN', 'ask', (fixture) => normalizeKrakenFixture({ ...fixture, assetRegistry: clone(registry) })],
  ]) {
    const fixture = clone(venue === 'COINBASE' ? coinbaseFixture : krakenFixture);
    delete fixture.ticker[field];
    const result = normalize(fixture);
    assert.equal(result.availability.state, 'UNAVAILABLE');
    assert.deepEqual(result.availability.reasonCodes, ['BOOK_TICKER_PRICE_MISSING']);
    assert.equal(result.observation.status, 'UNAVAILABLE');
    assert.equal(result.observation.value, null);
  }
  for (const [venue, field, payloadField, normalize] of [
    ['COINBASE', 'best_bid_size', 'bidSize', (fixture) => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['COINBASE', 'best_ask_size', 'askSize', (fixture) => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['KRAKEN', 'bid_qty', 'bidSize', (fixture) => normalizeKrakenFixture({ ...fixture, assetRegistry: clone(registry) })],
    ['KRAKEN', 'ask_qty', 'askSize', (fixture) => normalizeKrakenFixture({ ...fixture, assetRegistry: clone(registry) })],
  ]) {
    const fixture = clone(venue === 'COINBASE' ? coinbaseFixture : krakenFixture);
    delete fixture.ticker[field];
    const result = normalize(fixture);
    assert.equal(result.availability.state, 'AVAILABLE');
    assert.equal(result.observation.quality.completeness, 'PARTIAL');
    assert.equal(result.observation.payload[payloadField], null);
  }
});

test('observation cannot become an order or mutation instruction', () => {
  assert.throws(() => assertObservationBoundary({ canonical: false, authorityClass: 'NO_AUTHORITY', networkMode: 'FIXTURE_ONLY', orderInstruction: { side: 'BUY' } }), code('OBSERVATION_EFFECT_FIELD_FORBIDDEN'));
  assert.throws(() => assertObservationBoundary({ canonical: true }), code('OBSERVATION_CANONICAL_FORBIDDEN'));
  const evidence = clone(normalizeBase().coinbase.observation);
  evidence.payload.orderInstruction = { side: 'BUY' };
  assert.throws(() => validateMarketEvidenceEnvelope(evidence), code('UNEXPECTED_FIELD'));
  const emptyPayload = clone(normalizeBase().coinbase.observation);
  emptyPayload.payload = {};
  assert.throws(() => validateMarketEvidenceEnvelope(emptyPayload), code('REQUIRED_FIELD_MISSING'));
  const alias = clone(normalizeBase().coinbase.observation);
  alias.payload.orderRequest = { side: 'BUY' };
  assert.throws(() => validateMarketEvidenceEnvelope(alias), code('UNEXPECTED_FIELD'));
  const extra = clone(normalizeBase().coinbase.observation);
  extra.surprise = true;
  assert.throws(() => validateMarketEvidenceEnvelope(extra), code('UNEXPECTED_FIELD'));
  const context = clone(read('fixtures/context/point-in-time.v1.json').entries[0]);
  context.transfer = { asset: 'BTC' };
  assert.throws(() => createContextFixture(context), (error) => ['UNEXPECTED_FIELD', 'OBSERVATION_EFFECT_FIELD_FORBIDDEN'].includes(error?.code));
  const projection = clone(compareVenueQuotes(comparisonInput()));
  projection.orderRequest = { side: 'BUY' };
  const runtime = createVenueMeshFacetRuntime(ownerMap.facets.slice(0, 2));
  assert.throws(() => runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', projection)), code('OBSERVATION_EFFECT_FIELD_FORBIDDEN'));
});

test('F1 accepts exactly the two frozen usable Dock facets', () => {
  const runtime = createVenueMeshFacetRuntime(ownerMap.facets.slice(0, 2));
  assert.deepEqual(runtime.bindingHashes, {
    DERIVED_FEATURE: '8f2768ad7eac3e2a273c457a05810cff19ac4ca174fd8fb77ddf70b3ec18ce86',
    EVIDENCE: '69979efb8e2f01bee7d84d4e44cfeeb4116a268694112a44770da2b07460822d',
  });
  assert.throws(() => createVenueMeshFacetRuntime(ownerMap.facets.slice(0, 1)), code('ARRAY_INVALID'));
  assert.throws(() => createVenueMeshFacetRuntime(ownerMap.facets.slice(0, 3)), code('ARRAY_INVALID'));
});

test('evidence and derived fixture calls stay on their frozen operations', () => {
  const runtime = createVenueMeshFacetRuntime(ownerMap.facets.slice(0, 2));
  const { coinbase } = normalizeBase();
  const evidence = runtime.validateEvidence(makeFacetRequest('EVIDENCE', coinbase.observation));
  assert.equal(evidence.truthClass, 'FIXTURE_VALIDATION');
  const projection = compareVenueQuotes(comparisonInput());
  const derived = runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', projection));
  assert.equal(derived.truthClass, 'FIXTURE_PROJECTION');
  const malformed = clone(projection);
  malformed.featureValue.value = null;
  assert.throws(() => runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', malformed)));
  const widenedIdentity = clone(projection);
  widenedIdentity.identityComparison.authorityClass = 'ROOT';
  assert.throws(() => runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', widenedIdentity)), code('PROJECTION_IDENTITY_COMPARISON_INVALID'));
  const falseCost = clone(projection);
  falseCost.costStackBps = '0';
  assert.throws(() => runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', falseCost)), code('PROJECTION_COST_SUM_MISMATCH'));
  const falseNet = clone(projection);
  falseNet.netSpreadBps = '1';
  falseNet.featureValue.value.mantissa = '1000000000000';
  falseNet.economicState = 'POSITIVE_SYNTHETIC_PROJECTION';
  falseNet.reasonCodes = [];
  assert.throws(() => runtime.evaluateDerivedFeature(makeFacetRequest('DERIVED_FEATURE', falseNet)), code('PROJECTION_NET_ARITHMETIC_MISMATCH'));
  const crossed = clone(makeFacetRequest('EVIDENCE', coinbase.observation));
  crossed.facetClass = 'DERIVED_FEATURE';
  assert.throws(() => runtime.validateEvidence(crossed), (error) => error?.code === 'FACET_REQUEST_BINDING_MISMATCH');
});

test('fixture transport is injected, closed, and refuses credentials or operations', () => {
  const transport = createFixtureTransport({ quote: { bid: '1', ask: '2' } });
  assert.deepEqual(transport.read({ operation: 'READ_FIXTURE', fixtureId: 'quote' }), { ask: '2', bid: '1' });
  assert.throws(() => transport.read({ operation: 'SUBSCRIBE', fixtureId: 'quote' }), code('FIXTURE_OPERATION_FORBIDDEN'));
  assert.throws(() => transport.read({ operation: 'READ_FIXTURE', fixtureId: 'quote', apiKey: 'trap' }), code('FIXTURE_REQUEST_AUTHORITY_WIDENING'));
});

test('rate budget applies bounded explicit backpressure with no silent loss', () => {
  const result = simulateRateBudget({
    windowStartMs: 1_784_144_400_000,
    intervalMs: 1_000,
    weightLimit: 2,
    queueCapacity: 1,
    requests: [
      { id: 'a', atMs: 1_784_144_400_001, weight: 1, queueDepth: 0 },
      { id: 'b', atMs: 1_784_144_400_002, weight: 2, queueDepth: 2 },
    ],
  });
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.silentLoss, false);
  assert.equal(result.backpressureApplied, true);
});

test('canonical adapter maps are identity-only, lossless, and fail on uncovered fields', () => {
  for (const [mapPath, fixturePath] of [
    ['contracts/v1/canonical-adapter-map.evidence.v1.json', 'fixtures/adapter/evidence-roundtrip.v1.json'],
    ['contracts/v1/canonical-adapter-map.derived-feature.v1.json', 'fixtures/adapter/derived-roundtrip.v1.json'],
  ]) {
    const map = read(mapPath);
    const fixture = read(fixturePath);
    validateCanonicalAdapterMap(map);
    assert(map.fieldMap.every((row) => row.transform === 'IDENTITY'));
    if (fixture.schema === 'MarketEvidenceEnvelopeV1') validateMarketEvidenceEnvelope(fixture);
    else validateFeatureValueV1(fixture);
    const adapted = adaptFixture(map, fixture);
    assert.deepEqual(adapted.mappedFields, fixture);
    assert.deepEqual(reverseFixture(adapted), fixture);
    assert.throws(() => adaptFixture(map, { ...fixture, surprise: 'unmapped' }), (error) => error?.code === 'ADAPTER_FIELD_COVERAGE_INCOMPLETE');
  }
  const base = normalizeBase();
  const evidenceMap = read('contracts/v1/canonical-adapter-map.evidence.v1.json');
  const liveEvidenceFixture = materializeEvidenceAdapterFixture(base.coinbase);
  assert.equal(liveEvidenceFixture.schema, 'MarketEvidenceEnvelopeV1');
  assert.deepEqual(liveEvidenceFixture, base.coinbase.observation);
  assert.deepEqual(reverseFixture(adaptFixture(evidenceMap, liveEvidenceFixture)), liveEvidenceFixture);
  const derivedMap = read('contracts/v1/canonical-adapter-map.derived-feature.v1.json');
  const projection = compareVenueQuotes(comparisonInput());
  const liveDerivedFixture = materializeDerivedFeatureAdapterFixture(projection);
  assert.deepEqual(liveDerivedFixture, projection.featureValue);
  assert.deepEqual(reverseFixture(adaptFixture(derivedMap, liveDerivedFixture)), liveDerivedFixture);
  const missingPrice = clone(coinbaseFixture);
  delete missingPrice.ticker.best_bid;
  const unavailableResult = normalizeCoinbaseFixture({ ...missingPrice, assetRegistry: clone(registry) });
  const unavailableAdapter = materializeEvidenceAdapterFixture(unavailableResult);
  assert.equal(unavailableAdapter.schema, 'VenueUnavailableEvidenceAdapterResultV1');
  assert.equal(unavailableAdapter.canonicalEvidence, null);
  assert.equal(unavailableAdapter.unavailableObservation.value, null);
  assert.throws(() => adaptFixture(evidenceMap, unavailableAdapter));
  const deribitUnavailableAdapter = materializeEvidenceAdapterFixture(base.deribit);
  assert.equal(deribitUnavailableAdapter.availability.state, 'UNAVAILABLE');
  assert.equal(deribitUnavailableAdapter.canonicalEvidence, null);
});

test('descriptor and insertion request validate against the inherited Dock contract', () => {
  const descriptor = parseExtensionDescriptor(read('contracts/v1/extension-descriptor.v1.json'));
  assert.equal(descriptor.immutableBaseSha, 'f0168cb37bd04d21bc90591ab2256770de3b75bc');
  assert.equal(descriptor.sourceSha, 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5');
  assert.equal(descriptor.buildState, 'PRESTAGE_READY');
  assert.equal(descriptor.disposition, 'ACTIVE');
  assert.deepEqual(descriptor.requestedCapabilities, ['VALIDATE_FIXTURE', 'EVALUATE_FIXTURE']);
  const insertion = read('contracts/v1/insertion-request.v1.json');
  assert.equal(validateInsertionRequest(insertion), true);
  assert.equal(insertion.mutationImplemented, false);
  assert(insertion.blockedFacetRequests.includes('CANONICAL_SOURCE_HEALTH_MAPPING_OWNER_REQUIRED'));
  for (const requiredRef of [
    'frontier/venue-mesh/fixtures/venues/coinbase-btc-usd-trade.v1.json',
    'frontier/venue-mesh/fixtures/venues/kraken-xbt-usd-book.v1.json',
    'frontier/venue-mesh/fixtures/source-cards/review-inputs.v1.json',
    'frontier/venue-mesh/fixtures/context/point-in-time.v1.json',
  ]) assert(descriptor.dataSourceRefs.includes(requiredRef), `descriptor missing ${requiredRef}`);
});

test('license and retention matrix authorizes no market-data retention or redistribution', () => {
  const matrix = read('fixtures/license-retention-matrix.v1.json');
  assert.equal(matrix.rows.length, 3);
  assert(matrix.rows.every((row) => row.retentionPermission === 'REVIEW_REQUIRED'));
  assert(matrix.rows.every((row) => row.redistributionPermission === 'REVIEW_REQUIRED'));
  assert.match(matrix.effectiveRule, /^NO_MARKET_DATA_RETENTION/);
});

test('fixture load proves the claimed envelope and degrades beyond it', () => {
  const resourceBudgetClaim = read('contracts/v1/resource-budget-claim.v1.json');
  const maxSafeRateClaim = read('contracts/v1/max-safe-rate-claim.v1.json');
  validateResourceRateCompatibility(resourceBudgetClaim, maxSafeRateClaim);
  const latency50 = Array.from({ length: 50 }, (_, index) => index < 25 ? 2 : index < 48 ? 4 : index === 48 ? 5 : 6);
  const within = runFixtureLoad({ resourceBudgetClaim, maxSafeRateClaim, windowSizeMs: 1_000, offeredEvents: 50, peakQueueDepth: 8, latencySamples: latency50, storageBytesPerEvent: 32, networkBytes: 0, modelCalls: 0 });
  assert.equal(within.state, 'WITHIN_FIXTURE_ENVELOPE');
  const beyond = runFixtureLoad({ resourceBudgetClaim, maxSafeRateClaim, windowSizeMs: 1_000, offeredEvents: 51, peakQueueDepth: 9, latencySamples: [...latency50, 6], storageBytesPerEvent: 32, networkBytes: 0, modelCalls: 0 });
  assert.equal(beyond.state, 'DEGRADATION_REQUESTED');
  assert.equal(beyond.acceptedEvents, 0);
  assert.equal(beyond.silentLoss, false);
});

test('unsupported option identity stays explicit and is never coerced to perpetual', () => {
  const fixture = clone(deribitFixture);
  fixture.instrument.instrument_name = 'BTC-30JUL26-100-C';
  fixture.ticker.instrument_name = fixture.instrument.instrument_name;
  fixture.instrument.kind = 'option';
  fixture.instrument.expiration_timestamp = 1_785_436_800_000;
  fixture.instrument.strike = '100';
  fixture.instrument.option_type = 'CALL';
  const result = normalizeDeribitFixture({ ...fixture, assetRegistry: clone(registry) });
  assert.equal(result.identity.canonicalProduct, null);
  assert(result.identity.reasonCodes.includes('CANONICAL_PRODUCT_UNSUPPORTED'));
  assert.equal(result.observation.status, 'UNAVAILABLE');
});

test('leadership projection is temporal-only and makes no causal or profit claim', () => {
  const result = evaluateFixtureLeadership({
    series: [
      { venue: 'COINBASE', instrumentKey: 'asset:bitcoin:SPOT:currency:usd', sourceEligible: true, eventTimeMs: 1_784_144_400_000, moveBps: '5' },
      { venue: 'KRAKEN', instrumentKey: 'asset:bitcoin:SPOT:currency:usd', sourceEligible: true, eventTimeMs: 1_784_144_400_250, moveBps: '4' },
    ],
    cutoffMs: 1_784_144_401_000,
    minimumLeadMs: 100,
    maximumAgeMs: 1_000,
  });
  assert.equal(result.state, 'OBSERVED_TEMPORAL_LEAD');
  assert.equal(result.leaderVenue, 'COINBASE');
  assert.equal(result.causalClaim, false);
  assert.equal(result.profitabilityClaim, false);
  const sameVenue = evaluateFixtureLeadership({
    series: [
      { venue: 'COINBASE', instrumentKey: 'asset:bitcoin:SPOT:currency:usd', sourceEligible: true, eventTimeMs: 1_784_144_400_000, moveBps: '5' },
      { venue: 'COINBASE', instrumentKey: 'asset:bitcoin:SPOT:currency:usd', sourceEligible: true, eventTimeMs: 1_784_144_400_250, moveBps: '4' },
    ],
    cutoffMs: 1_784_144_401_000,
    minimumLeadMs: 100,
    maximumAgeMs: 1_000,
  });
  assert.equal(sameVenue.state, 'UNKNOWN');
  assert(sameVenue.reasonCodes.includes('INSUFFICIENT_DISTINCT_VENUES'));
});

test('isolated preview never impersonates cockpit or canonical product health', () => {
  const base = normalizeBase();
  const health = assessVenueMeshHealth({
    results: [base.coinbase, base.kraken],
    evaluatedAtMs: 1_784_144_401_000,
    maximumAgeMsByVenue: { COINBASE: 1_000, KRAKEN: 1_000 },
    maintenanceByVenue: { COINBASE: 'NORMAL', KRAKEN: 'NORMAL' },
    rateBudgetByVenue: { COINBASE: 'WITHIN_BUDGET', KRAKEN: 'WITHIN_BUDGET' },
  });
  const card = materializeReviewOnlySourceCard(clone(read('fixtures/source-cards/review-inputs.v1.json').cards[0]));
  const review = evaluateSourceCard(card, { expectedCanonicalProducerOwner: 'server.intelligenceRuntime', evaluatedAtMs: card.dataSourceCard.evaluatedAtMs });
  const contextFixture = read('fixtures/context/point-in-time.v1.json');
  const graph = buildSourceIndependenceGraph(contextFixture.sources);
  const contextInformationSet = evaluateContextInformationSet({ entries: contextFixture.entries.map(createContextFixture), cutoffMs: contextFixture.cutoffMs, independenceGraph: graph });
  const preview = buildFixturePreview({ generatedAtMs: 1_784_144_401_000, health, dislocations: [compareVenueQuotes(comparisonInput())], sourceReviews: [review], contextInformationSet });
  assert.match(preview.banner, /FIXTURE_ONLY/);
  assert.equal(preview.cockpitProjectionClaimed, false);
  assert.equal(preview.canonicalProductHealthClaimed, false);
  assert(preview.limitations.every((row) => !row.includes('LIVE')) || preview.banner.includes('NOT LIVE'));
});

test('decimal precision beyond the frozen scale is rejected, never rounded silently', () => {
  assert.throws(() => decimalToMantissa('1.0000000000001', 'value'), code('DECIMAL_PRECISION_UNSUPPORTED'));
  const fixture = clone(coinbaseFixture);
  fixture.ticker.best_bid = 100;
  assert.throws(() => normalizeCoinbaseFixture({ ...fixture, assetRegistry: clone(registry) }), code('DECIMAL_STRING_REQUIRED'));
});

test('instrument source hash and explicit multiplier units are mandatory', () => {
  const { deribit } = normalizeBase();
  const input = clone(deribit.descriptor);
  delete input.schema;
  delete input.version;
  delete input.authorityClass;
  delete input.canonical;
  delete input.networkMode;
  input.contractMultiplierUnit = null;
  assert.throws(() => createInstrumentDescriptor(input), code('CONTRACT_MULTIPLIER_REQUIRED'));
  const mismatch = clone(coinbaseFixture);
  mismatch.product.base_currency = 'ETH';
  assert.throws(() => normalizeCoinbaseFixture({ ...mismatch, assetRegistry: clone(registry) }), code('COINBASE_INSTRUMENT_METADATA_MISMATCH'));
});
