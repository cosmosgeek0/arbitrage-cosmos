import fs from 'node:fs';
import {
  assessVenueMeshHealth,
  buildFixturePreview,
  buildSourceIndependenceGraph,
  compareVenueQuotes,
  createContextFixture,
  evaluateContextInformationSet,
  evaluateSourceCard,
  materializeReviewOnlySourceCard,
  normalizeCoinbaseFixture,
  normalizeKrakenFixture,
} from '../src/index.mjs';

const load = (relativePath) => JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
const registry = load('../fixtures/asset-registry.v1.json').entries;
const coinbaseFixture = load('../fixtures/venues/coinbase-btc-usd.v1.json');
const krakenFixture = load('../fixtures/venues/kraken-xbt-usd.v1.json');
const sourceInputs = load('../fixtures/source-cards/review-inputs.v1.json');
const contextFixture = load('../fixtures/context/point-in-time.v1.json');

const coinbase = normalizeCoinbaseFixture({ ...coinbaseFixture, assetRegistry: registry });
const kraken = normalizeKrakenFixture({ ...krakenFixture, assetRegistry: registry });
const sourceReviews = sourceInputs.cards.map((input) => {
  const envelope = materializeReviewOnlySourceCard(input);
  return evaluateSourceCard(envelope, {
    expectedCanonicalProducerOwner: 'server.intelligenceRuntime',
    evaluatedAtMs: input.evaluatedAtMs,
  });
});
const health = assessVenueMeshHealth({
  results: [coinbase, kraken],
  evaluatedAtMs: 1_784_144_401_000,
  maximumAgeMsByVenue: { COINBASE: 1_000, KRAKEN: 1_000 },
  maintenanceByVenue: { COINBASE: 'NORMAL', KRAKEN: 'NORMAL' },
  rateBudgetByVenue: { COINBASE: 'WITHIN_BUDGET', KRAKEN: 'WITHIN_BUDGET' },
});
const dislocation = compareVenueQuotes({
  buyEvidence: coinbase.observation,
  sellEvidence: kraken.observation,
  buyIdentity: coinbase.identity,
  sellIdentity: kraken.identity,
  costs: { buyFeeBps: '5', sellFeeBps: '5', tickRoundingBps: '1', latencyBps: '2', depthImpactBps: '8' },
  intendedBaseSize: '1',
  asOfMs: 1_784_144_401_000,
  freshnessBoundsMs: { buy: 1_000, sell: 1_000 },
  sourceEligibility: { buy: false, sell: false },
});
const independenceGraph = buildSourceIndependenceGraph(contextFixture.sources);
const contextInformationSet = evaluateContextInformationSet({
  entries: contextFixture.entries.map((entry) => createContextFixture(entry)),
  cutoffMs: contextFixture.cutoffMs,
  independenceGraph,
});
const preview = buildFixturePreview({
  generatedAtMs: 1_784_144_401_000,
  health,
  dislocations: [dislocation],
  sourceReviews,
  contextInformationSet,
});

process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
