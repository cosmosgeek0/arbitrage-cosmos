import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPublicBasisOpportunityObservation,
} from '../../../dist/engine/basis/publicOpportunityObservation.js';
import {
  appendPublicOpportunityObservation,
  PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
  PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_STORE_RELEASE_STATE,
} from '../../../dist/engine/basis/publicOpportunityObservationStore.js';
import {
  BASIS_EDGE_PAGE_SIZE,
  PUBLIC_OBSERVED_PROXY_NOT_EXECUTED,
  readRolling24hEdgeStatistic,
  ROLLING_24H_MS,
} from '../../../dist/engine/basis/rolling24hEdgeStatistic.js';
import { Ledger } from '../../../dist/ledger.js';

const FIXED_AS_OF_MS = 2_000_000_000_000;

function nullProvenance() {
  return {
    authority: 'NONE',
    sourceId: null,
    revision: null,
    sourceEventAtMs: null,
    sourceTransactionAtMs: null,
    receivedAtMs: null,
    expiresAtMs: null,
    timeBasis: 'NOT_APPLICABLE',
  };
}

function receiptProvenance({
  authority,
  sourceId,
  revision,
  receivedAtMs,
  expiresAtMs = receivedAtMs + 60_000,
}) {
  return {
    authority,
    sourceId,
    revision,
    sourceEventAtMs: null,
    sourceTransactionAtMs: null,
    receivedAtMs,
    expiresAtMs,
    timeBasis: 'RECEIPT_TIME',
  };
}

function modeledCost(tag, evaluatedAtMs, valuePct = '0') {
  return {
    state: 'MODEL_ASSUMPTION',
    valuePct,
    provenance: receiptProvenance({
      authority: 'CONFIG_ASSUMPTION',
      sourceId: `fixture.cost.${tag}`,
      revision: `cost-rev-${tag}`,
      receivedAtMs: evaluatedAtMs,
    }),
    reasonCodes: [],
  };
}

function buildObservation({
  tag,
  observedAtMs,
  evaluatedAtMs = observedAtMs,
  opportunityId = `opp.${tag}`,
  opportunityCreatedAtMs = observedAtMs,
  correlationId = `corr.${tag}`,
  sourceCutId = `cut.${tag}`,
  direction = 'long_spot_short_perp',
  perpetualBidPrice = '101',
  perpetualAskPrice = '101.5',
  slippagePct = '0',
}) {
  const spotQuoteProvenance = receiptProvenance({
    authority: 'BINANCE_PUBLIC',
    sourceId: 'binance.spot.book-ticker',
    revision: `spot-rev-${tag}`,
    receivedAtMs: observedAtMs,
  });
  const perpetualQuoteProvenance = receiptProvenance({
    authority: 'BINANCE_PUBLIC',
    sourceId: 'binance.usdm.book-ticker',
    revision: `perp-rev-${tag}`,
    receivedAtMs: observedAtMs,
  });
  const borrowCost = direction === 'long_spot_short_perp'
    ? {
        state: 'NOT_REQUIRED',
        valuePct: '0',
        provenance: nullProvenance(),
        reasonCodes: [],
      }
    : {
        state: 'UNKNOWN',
        valuePct: null,
        provenance: {
          ...nullProvenance(),
          authority: 'UNKNOWN',
          timeBasis: 'UNKNOWN',
        },
        reasonCodes: ['PRIVATE_BORROW_UNKNOWN'],
      };

  return buildPublicBasisOpportunityObservation({
    opportunityId,
    opportunityCreatedAtMs,
    correlationId,
    sourceCutId,
    symbol: 'BTCUSDT',
    direction,
    ownerDecisionKind: 'proposal',
    observedAtMs,
    evaluatedAtMs,
    ownerReportedGrossEdgePct: null,
    ownerReportedNetEdgePct: null,
    quoteCut: {
      spot: {
        market: 'SPOT',
        bidPrice: '99.5',
        askPrice: '100',
        bidQuantity: '10',
        askQuantity: '10',
        state: 'OBSERVED_PUBLIC',
        provenance: spotQuoteProvenance,
        reasonCodes: [],
      },
      perpetual: {
        market: 'USD_M_PERPETUAL',
        bidPrice: perpetualBidPrice,
        askPrice: perpetualAskPrice,
        bidQuantity: '10',
        askQuantity: '10',
        state: 'OBSERVED_PUBLIC',
        provenance: perpetualQuoteProvenance,
        reasonCodes: [],
      },
      maxQuoteAgeMs: 1_000,
      maxReceiptSkewMs: 0,
    },
    costs: {
      spotOpenFee: modeledCost(`${tag}.spot-open`, evaluatedAtMs),
      spotCloseFee: modeledCost(`${tag}.spot-close`, evaluatedAtMs),
      perpetualOpenFee: modeledCost(`${tag}.perp-open`, evaluatedAtMs),
      perpetualCloseFee: modeledCost(`${tag}.perp-close`, evaluatedAtMs),
      slippage: modeledCost(`${tag}.slippage`, evaluatedAtMs, slippagePct),
      fundingCarry: modeledCost(`${tag}.funding`, evaluatedAtMs),
      borrowCost,
    },
  });
}

function openTemporaryLedger(t, label) {
  const dataDir = mkdtempSync(path.join(tmpdir(), `cosmos-basis-live-edge-${label}-`));
  const ledger = new Ledger(dataDir);
  t.after(() => {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, ledger };
}

function structuralLedger(initialRows, options = {}) {
  const rows = [...initialRows];
  const calls = [];
  let pageCallCount = 0;

  return {
    calls,
    rows,
    recentEvents(
      limit = 100,
      kind,
      symbol,
      q,
      since,
      beforeId,
      until,
      offset = 0,
      afterId,
    ) {
      const isPage = afterId !== undefined;
      calls.push({
        limit,
        kind,
        symbol,
        q,
        since,
        beforeId,
        until,
        offset,
        afterId,
      });
      if (!isPage && options.throwOnAnchor) throw new Error('anchor read failed');
      if (isPage) {
        pageCallCount += 1;
        options.beforePage?.({ rows, pageCallCount });
        if (options.throwOnPage === pageCallCount) throw new Error('page read failed');
      }

      const filtered = rows.filter((row) => {
        if (kind !== undefined && row.kind !== kind) return false;
        if (symbol !== undefined && row.symbol !== symbol) return false;
        if (since !== undefined && row.ts < since) return false;
        if (beforeId !== undefined && row.id >= beforeId) return false;
        if (until !== undefined && row.ts >= until) return false;
        if (afterId !== undefined && row.id <= afterId) return false;
        return true;
      });
      filtered.sort((left, right) => (
        afterId === undefined ? right.id - left.id : left.id - right.id
      ));
      return filtered.slice(offset, offset + limit);
    },
  };
}

function row(id, ts, observation, overrides = {}) {
  return {
    id,
    ts,
    kind: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
    symbol: observation.symbol,
    data: observation,
    ...overrides,
  };
}

test('every store call appends atomically and a throwing listener cannot counterfeit failure', (t) => {
  const { ledger } = openTemporaryLedger(t, 'append');
  const observedAtMs = Date.now() - 1_000;
  const observation = buildObservation({ tag: 'append', observedAtMs });
  let listenerCalls = 0;

  ledger.on('event', (event) => {
    listenerCalls += 1;
    event.data.opportunityId = 'listener-poison';
    throw new Error('listener failed after commit');
  });

  const results = [
    appendPublicOpportunityObservation(ledger, observation),
    appendPublicOpportunityObservation(ledger, observation),
    appendPublicOpportunityObservation(ledger, observation),
  ];
  assert.equal(PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_STORE_RELEASE_STATE, 'NOT_CONFIGURED');
  assert.equal(observation.releaseState, 'NOT_CONFIGURED');
  assert.equal(listenerCalls, 3);
  assert.deepEqual(results.map((result) => result.disposition), [
    'APPENDED',
    'APPENDED',
    'APPENDED',
  ]);
  assert.equal(new Set(results.map((result) => result.rawLedgerEventId)).size, 3);

  const persisted = ledger.recentEvents(
    10,
    PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
  );
  assert.equal(persisted.length, 3);
  assert.deepEqual(
    persisted.map((event) => event.id),
    results.map((result) => result.rawLedgerEventId).reverse(),
  );
  for (const event of persisted) {
    const result = results.find((candidate) => candidate.rawLedgerEventId === event.id);
    assert.equal(result.committedAtMs, event.ts);
    assert.deepEqual(event.data, observation);
    assert.equal(event.createdAt, observation.observedAtMs);
    assert.equal(event.severity, 'info');
    assert.equal(event.source, 'basis.public-opportunity-observation.v1');
    assert.equal(event.strategy, 'basis');
    assert.equal(event.status, 'OBSERVED');
    assert.equal(event.reason, 'PUBLIC_SOURCE_ONLY');
    assert.equal(event.correlation, observation.correlationId);
  }
});

test('store rejects invalid input and distinguishes append failure from invalid commit readback', () => {
  const observedAtMs = Date.now() - 1_000;
  const observation = buildObservation({ tag: 'store-failures', observedAtMs });

  assert.deepEqual(
    appendPublicOpportunityObservation(
      { logEventsAtomically: () => [] },
      { ...observation, symbol: 'ETHUSDT' },
    ),
    {
      disposition: 'REJECTED',
      rawLedgerEventId: null,
      semanticObservationId: null,
      committedAtMs: null,
      reasonCode: 'OBSERVATION_INVALID',
    },
  );
  assert.deepEqual(
    appendPublicOpportunityObservation(
      { logEventsAtomically: () => { throw new Error('disk unavailable'); } },
      observation,
    ),
    {
      disposition: 'PERSISTENCE_UNAVAILABLE',
      rawLedgerEventId: null,
      semanticObservationId: observation.observationId,
      committedAtMs: null,
      reasonCode: 'LEDGER_APPEND_FAILED',
    },
  );
  assert.deepEqual(
    appendPublicOpportunityObservation(
      {
        logEventsAtomically: ([record]) => [{
          id: 1,
          ts: observation.evaluatedAtMs - 1,
          kind: record.kind,
          symbol: record.symbol,
          data: record.data,
        }],
      },
      observation,
    ),
    {
      disposition: 'COMMIT_READBACK_INVALID',
      rawLedgerEventId: null,
      semanticObservationId: observation.observationId,
      committedAtMs: null,
      reasonCode: 'LEDGER_COMMIT_READBACK_INVALID',
    },
  );
});

test('a durably committed chronology-invalid row can never age into a false EMPTY projection', (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-basis-live-edge-chronology-'));
  let ledger = new Ledger(dataDir);
  t.after(() => {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const futureObservedAtMs = Date.now() + (ROLLING_24H_MS * 2);
  const futureObservation = buildObservation({
    tag: 'future-chronology',
    observedAtMs: futureObservedAtMs,
  });
  const append = appendPublicOpportunityObservation(ledger, futureObservation);
  assert.equal(append.disposition, 'COMMIT_READBACK_INVALID');
  assert.equal(
    ledger.recentEvents(10, PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND).length,
    1,
  );

  ledger.close();
  ledger = new Ledger(dataDir);
  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: futureObservedAtMs,
  });
  assert.equal(projection.state, 'UNKNOWN');
  assert.equal(projection.rawRowCount, 1);
  assert.equal(projection.uniqueObservationCount, 0);
  assert.equal(projection.malformedCount, 1);
  assert.equal(projection.highWaterReached, true);
  assert.ok(projection.reasonCodes.includes('OBSERVATION_PAYLOAD_MALFORMED'));
});

test('duplicate raw retries collapse semantically while one opportunity retains distinct revisions', (t) => {
  const { ledger } = openTemporaryLedger(t, 'retry-revision');
  const opportunityCreatedAtMs = Date.now() - 10_000;
  const first = buildObservation({
    tag: 'revision-one',
    observedAtMs: opportunityCreatedAtMs + 1_000,
    opportunityCreatedAtMs,
    opportunityId: 'opp.shared-revisions',
    correlationId: 'corr.shared-revisions',
    sourceCutId: 'cut.revision-one',
    perpetualBidPrice: '101',
    perpetualAskPrice: '101.5',
  });
  const second = buildObservation({
    tag: 'revision-two',
    observedAtMs: opportunityCreatedAtMs + 2_000,
    opportunityCreatedAtMs,
    opportunityId: 'opp.shared-revisions',
    correlationId: 'corr.shared-revisions',
    sourceCutId: 'cut.revision-two',
    perpetualBidPrice: '103',
    perpetualAskPrice: '103.5',
  });
  assert.notEqual(first.observationId, second.observationId);

  appendPublicOpportunityObservation(ledger, first);
  appendPublicOpportunityObservation(ledger, first);
  appendPublicOpportunityObservation(ledger, second);
  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: Date.now() + 60_000,
  });

  assert.equal(projection.label, PUBLIC_OBSERVED_PROXY_NOT_EXECUTED);
  assert.equal(projection.state, 'COMPLETE');
  assert.equal(projection.rawRowCount, 3);
  assert.equal(projection.uniqueObservationCount, 2);
  assert.equal(projection.duplicateRetryCount, 1);
  assert.equal(projection.conflictCount, 0);
  assert.equal(projection.distinctOpportunityIdCount, 1);
  assert.equal(projection.newOpportunityIdCount, 1);
  assert.deepEqual(projection.assumptionBoundPublicProxy, {
    knownObservationCount: 2,
    unknownObservationCount: 0,
    positiveObservationCount: 2,
    knownObservationRatio: '1',
    observationReasonCodes: [
      'ACCOUNT_EFFECTIVE_FEES_NOT_PUBLIC',
      'ACCOUNT_EFFECTIVE_SLIPPAGE_NOT_OBSERVED',
      'OBSERVATION_NOT_EXECUTION_OR_PNL',
    ],
  });
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: '2',
    bestNetEdgePct: '3',
    worstNetEdgePct: '1',
    meanNetEdgeUsdPerOneThousandNotional: '20',
  });
  assert.deepEqual(projection.reasonCodes, [
    'PUBLIC_PROXY_NET_EDGE_COMPLETE',
    'PUBLIC_PROXY_NET_EDGE_ASSUMPTION_BOUND',
    'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN',
    'DUPLICATE_RETRIES_COLLAPSED',
  ]);
});

test('payload time uses the exact closed [asOf-24h, asOf] boundary independently of commit time', () => {
  const windowStartMs = FIXED_AS_OF_MS - ROLLING_24H_MS;
  const before = buildObservation({
    tag: 'boundary-before',
    observedAtMs: windowStartMs - 1,
    opportunityCreatedAtMs: windowStartMs - 1,
    perpetualBidPrice: '102',
    perpetualAskPrice: '102.5',
  });
  const atStart = buildObservation({
    tag: 'boundary-start',
    observedAtMs: windowStartMs,
    opportunityCreatedAtMs: windowStartMs,
    perpetualBidPrice: '101',
    perpetualAskPrice: '101.5',
  });
  const atEnd = buildObservation({
    tag: 'boundary-end',
    observedAtMs: FIXED_AS_OF_MS,
    opportunityCreatedAtMs: FIXED_AS_OF_MS,
    perpetualBidPrice: '103',
    perpetualAskPrice: '103.5',
  });
  const afterEnd = buildObservation({
    tag: 'boundary-after',
    observedAtMs: FIXED_AS_OF_MS + 1,
    opportunityCreatedAtMs: FIXED_AS_OF_MS + 1,
    perpetualBidPrice: '104',
    perpetualAskPrice: '104.5',
  });
  const ledger = structuralLedger([
    row(1, FIXED_AS_OF_MS - 2, before),
    row(2, FIXED_AS_OF_MS - 1, atStart),
    row(3, FIXED_AS_OF_MS, atEnd),
    row(4, FIXED_AS_OF_MS + 1, afterEnd),
  ]);

  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: FIXED_AS_OF_MS,
  });
  assert.equal(projection.boundary, 'CLOSED_CLOSED');
  assert.equal(projection.windowStartMs, windowStartMs);
  assert.equal(projection.windowEndMs, FIXED_AS_OF_MS);
  assert.equal(projection.state, 'COMPLETE');
  assert.equal(projection.rawRowCount, 3);
  assert.equal(projection.uniqueObservationCount, 2);
  assert.equal(projection.outOfWindowCount, 1);
  assert.equal(projection.newOpportunityIdCount, 2);
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: '2',
    bestNetEdgePct: '3',
    worstNetEdgePct: '1',
    meanNetEdgeUsdPerOneThousandNotional: '20',
  });
  assert.ok(projection.reasonCodes.includes('OUT_OF_WINDOW_OBSERVATIONS_EXCLUDED'));
  assert.equal(ledger.calls[0].since, undefined);
  assert.equal(ledger.calls[0].until, FIXED_AS_OF_MS + 1);
});

test('mixed known and unknown public proxy observations are PARTIAL with exact known-only statistics', () => {
  const observedAtMs = FIXED_AS_OF_MS - 1_000;
  const knownOne = buildObservation({
    tag: 'partial-known-one',
    observedAtMs,
    perpetualBidPrice: '101',
    perpetualAskPrice: '101.5',
  });
  const knownThree = buildObservation({
    tag: 'partial-known-three',
    observedAtMs: observedAtMs + 1,
    perpetualBidPrice: '103',
    perpetualAskPrice: '103.5',
  });
  const unknown = buildObservation({
    tag: 'partial-unknown',
    observedAtMs: observedAtMs + 2,
    direction: 'short_spot_long_perp',
    perpetualBidPrice: '100.5',
    perpetualAskPrice: '101',
  });
  const ledger = structuralLedger([
    row(1, FIXED_AS_OF_MS - 900, knownOne),
    row(2, FIXED_AS_OF_MS - 800, knownThree),
    row(3, FIXED_AS_OF_MS - 700, unknown),
  ]);

  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: FIXED_AS_OF_MS,
  });
  assert.equal(projection.state, 'PARTIAL');
  assert.deepEqual(projection.assumptionBoundPublicProxy, {
    knownObservationCount: 2,
    unknownObservationCount: 1,
    positiveObservationCount: 2,
    knownObservationRatio: '2/3',
    observationReasonCodes: [
      'ACCOUNT_EFFECTIVE_FEES_NOT_PUBLIC',
      'ACCOUNT_EFFECTIVE_SLIPPAGE_NOT_OBSERVED',
      'OBSERVATION_NOT_EXECUTION_OR_PNL',
      'REVERSE_BASIS_BORROW_PRIVATE_UNKNOWN',
    ],
  });
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: '2',
    bestNetEdgePct: '3',
    worstNetEdgePct: '1',
    meanNetEdgeUsdPerOneThousandNotional: '20',
  });
  assert.deepEqual(projection.accountEffectiveNetEdge, {
    state: 'UNKNOWN',
    meanNetEdgePct: null,
    bestNetEdgePct: null,
    worstNetEdgePct: null,
    meanNetEdgeUsdPerOneThousandNotional: null,
    reasonCode: 'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN',
  });
  assert.deepEqual(projection.reasonCodes, [
    'PUBLIC_PROXY_NET_EDGE_PARTIAL',
    'PUBLIC_PROXY_NET_EDGE_ASSUMPTION_BOUND',
    'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN',
  ]);
});

test('large valid edge aggregates reduce exactly before per-$1,000 scaling', () => {
  const observedAtMs = FIXED_AS_OF_MS - 1_000;
  const slippagePct = `6${'0'.repeat(94)}`;
  const expectedEdge = `-5${'9'.repeat(94)}`;
  const expectedPerThousand = `${expectedEdge}0`;
  const first = buildObservation({
    tag: 'large-exact-first',
    observedAtMs,
    slippagePct,
  });
  const second = buildObservation({
    tag: 'large-exact-second',
    observedAtMs: observedAtMs + 1,
    slippagePct,
  });
  assert.equal(first.economics.configuredProxyNetEdgePct, expectedEdge);
  assert.equal(
    first.economics.configuredProxyNetEdgeUsdPerOneThousandNotional,
    expectedPerThousand,
  );

  const projection = readRolling24hEdgeStatistic(
    structuralLedger([
      row(1, FIXED_AS_OF_MS - 500, first),
      row(2, FIXED_AS_OF_MS - 400, second),
    ]),
    { asOfMs: FIXED_AS_OF_MS },
  );
  assert.equal(projection.state, 'COMPLETE');
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: expectedEdge,
    bestNetEdgePct: expectedEdge,
    worstNetEdgePct: expectedEdge,
    meanNetEdgeUsdPerOneThousandNotional: expectedPerThousand,
  });
});

test('a valid high-scale mean falls back to an exact reduced rational', () => {
  const observedAtMs = FIXED_AS_OF_MS - 1_000;
  const zero = buildObservation({
    tag: 'high-scale-zero',
    observedAtMs,
    perpetualBidPrice: '100',
  });
  const tinyNegative = buildObservation({
    tag: 'high-scale-tiny-negative',
    observedAtMs: observedAtMs + 1,
    perpetualBidPrice: '100',
    slippagePct: `0.${'0'.repeat(94)}1`,
  });
  assert.equal(zero.economics.configuredProxyNetEdgePct, '0');
  assert.equal(
    tinyNegative.economics.configuredProxyNetEdgePct,
    `-0.${'0'.repeat(94)}1`,
  );

  const projection = readRolling24hEdgeStatistic(
    structuralLedger([
      row(1, FIXED_AS_OF_MS - 500, zero),
      row(2, FIXED_AS_OF_MS - 400, tinyNegative),
    ]),
    { asOfMs: FIXED_AS_OF_MS },
  );
  assert.equal(projection.state, 'COMPLETE');
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: `-1/2${'0'.repeat(95)}`,
    bestNetEdgePct: '0',
    worstNetEdgePct: `-0.${'0'.repeat(94)}1`,
    meanNetEdgeUsdPerOneThousandNotional: `-0.${'0'.repeat(94)}5`,
  });
});

test('multi-page keyset scan is gap-free and fixed to the initial high-water mark', () => {
  const observation = buildObservation({
    tag: 'multipage',
    observedAtMs: FIXED_AS_OF_MS - 2_000,
  });
  const lateObservation = buildObservation({
    tag: 'multipage-late',
    observedAtMs: FIXED_AS_OF_MS - 1_000,
  });
  const initialRows = Array.from(
    { length: BASIS_EDGE_PAGE_SIZE + 1 },
    (_, index) => row(index + 1, FIXED_AS_OF_MS - 500, observation),
  );
  const ledger = structuralLedger(initialRows, {
    beforePage({ rows, pageCallCount }) {
      if (pageCallCount === 1) {
        rows.push(row(BASIS_EDGE_PAGE_SIZE + 2, FIXED_AS_OF_MS - 400, lateObservation));
      }
    },
  });

  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: FIXED_AS_OF_MS,
  });
  assert.equal(projection.state, 'COMPLETE');
  assert.equal(projection.highWaterLedgerEventId, BASIS_EDGE_PAGE_SIZE + 1);
  assert.equal(projection.highWaterReached, true);
  assert.equal(projection.scanComplete, true);
  assert.equal(projection.truncated, false);
  assert.equal(projection.rawRowCount, BASIS_EDGE_PAGE_SIZE + 1);
  assert.equal(projection.uniqueObservationCount, 1);
  assert.equal(projection.duplicateRetryCount, BASIS_EDGE_PAGE_SIZE);
  assert.equal(projection.distinctOpportunityIdCount, 1);

  const pageCalls = ledger.calls.filter((call) => call.afterId !== undefined);
  assert.equal(pageCalls.length, 2);
  assert.deepEqual(pageCalls.map((call) => call.afterId), [0, BASIS_EDGE_PAGE_SIZE]);
  assert.deepEqual(
    pageCalls.map((call) => call.beforeId),
    [BASIS_EDGE_PAGE_SIZE + 2, BASIS_EDGE_PAGE_SIZE + 2],
  );
  assert.ok(pageCalls.every((call) => call.since === undefined));
  assert.ok(pageCalls.every((call) => call.until === FIXED_AS_OF_MS + 1));
});

test('same semantic identity with conflicting valid content fails the projection UNKNOWN', () => {
  const common = {
    observedAtMs: FIXED_AS_OF_MS - 1_000,
    evaluatedAtMs: FIXED_AS_OF_MS - 1_000,
    opportunityId: 'opp.conflict',
    opportunityCreatedAtMs: FIXED_AS_OF_MS - 2_000,
    correlationId: 'corr.conflict',
    sourceCutId: 'cut.conflict',
  };
  const first = buildObservation({
    tag: 'conflict-first',
    ...common,
    perpetualBidPrice: '101',
    perpetualAskPrice: '101.5',
  });
  const conflicting = buildObservation({
    tag: 'conflict-second',
    ...common,
    perpetualBidPrice: '103',
    perpetualAskPrice: '103.5',
  });
  assert.equal(first.observationId, conflicting.observationId);
  assert.notEqual(first.contentDigestSha256, conflicting.contentDigestSha256);
  const ledger = structuralLedger([
    row(1, FIXED_AS_OF_MS - 500, first),
    row(2, FIXED_AS_OF_MS - 400, conflicting),
  ]);

  const projection = readRolling24hEdgeStatistic(ledger, {
    asOfMs: FIXED_AS_OF_MS,
  });
  assert.equal(projection.state, 'UNKNOWN');
  assert.equal(projection.uniqueObservationCount, 1);
  assert.equal(projection.conflictCount, 1);
  assert.equal(projection.malformedCount, 0);
  assert.deepEqual(projection.knownOnly, {
    meanNetEdgePct: null,
    bestNetEdgePct: null,
    worstNetEdgePct: null,
    meanNetEdgeUsdPerOneThousandNotional: null,
  });
  assert.ok(projection.reasonCodes.includes('OBSERVATION_ID_CONFLICT'));
});

test('malformed payload, row cap, and Ledger read failures each fail the projection UNKNOWN', () => {
  const observation = buildObservation({
    tag: 'integrity-failures',
    observedAtMs: FIXED_AS_OF_MS - 1_000,
  });

  const malformedLedger = structuralLedger([
    row(1, FIXED_AS_OF_MS - 900, observation),
    row(2, FIXED_AS_OF_MS - 800, observation, {
      data: { ...observation, contentDigestSha256: '0'.repeat(64) },
    }),
  ]);
  const malformed = readRolling24hEdgeStatistic(malformedLedger, {
    asOfMs: FIXED_AS_OF_MS,
  });
  assert.equal(malformed.state, 'UNKNOWN');
  assert.equal(malformed.malformedCount, 1);
  assert.ok(malformed.reasonCodes.includes('OBSERVATION_PAYLOAD_MALFORMED'));
  assert.equal(malformed.knownOnly.meanNetEdgePct, null);

  const cappedLedger = structuralLedger([
    row(1, FIXED_AS_OF_MS - 900, observation),
    row(2, FIXED_AS_OF_MS - 800, observation),
    row(3, FIXED_AS_OF_MS - 700, observation),
  ]);
  const capped = readRolling24hEdgeStatistic(cappedLedger, {
    asOfMs: FIXED_AS_OF_MS,
    maxRows: 2,
  });
  assert.equal(capped.state, 'UNKNOWN');
  assert.equal(capped.rawRowCount, 2);
  assert.equal(capped.truncated, true);
  assert.equal(capped.scanComplete, false);
  assert.ok(capped.reasonCodes.includes('LEDGER_SCAN_ROW_CAP_EXCEEDED'));
  assert.equal(capped.knownOnly.meanNetEdgePct, null);

  const exactCapacity = readRolling24hEdgeStatistic(
    structuralLedger([
      row(1, FIXED_AS_OF_MS - 900, observation),
      row(2, FIXED_AS_OF_MS - 800, observation),
    ]),
    { asOfMs: FIXED_AS_OF_MS, maxRows: 2 },
  );
  assert.equal(exactCapacity.state, 'COMPLETE');
  assert.equal(exactCapacity.rawRowCount, 2);
  assert.equal(exactCapacity.highWaterReached, true);
  assert.equal(exactCapacity.scanComplete, true);
  assert.equal(exactCapacity.truncated, false);

  const anchorFailure = readRolling24hEdgeStatistic(
    structuralLedger([], { throwOnAnchor: true }),
    { asOfMs: FIXED_AS_OF_MS },
  );
  assert.equal(anchorFailure.state, 'UNKNOWN');
  assert.equal(anchorFailure.highWaterLedgerEventId, null);
  assert.ok(anchorFailure.reasonCodes.includes('LEDGER_READ_FAILED'));

  const pageFailure = readRolling24hEdgeStatistic(
    structuralLedger(
      [row(1, FIXED_AS_OF_MS - 900, observation)],
      { throwOnPage: 1 },
    ),
    { asOfMs: FIXED_AS_OF_MS },
  );
  assert.equal(pageFailure.state, 'UNKNOWN');
  assert.equal(pageFailure.highWaterLedgerEventId, 1);
  assert.equal(pageFailure.highWaterReached, false);
  assert.ok(pageFailure.reasonCodes.includes('LEDGER_READ_FAILED'));
});

test('real Ledger close and reopen preserves a deterministic projection', (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-basis-live-edge-reopen-'));
  let ledger = new Ledger(dataDir);
  t.after(() => {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const observedAtMs = Date.now() - 2_000;
  const known = buildObservation({
    tag: 'reopen-known',
    observedAtMs,
    perpetualBidPrice: '101',
    perpetualAskPrice: '101.5',
  });
  const unknown = buildObservation({
    tag: 'reopen-unknown',
    observedAtMs: observedAtMs + 1,
    direction: 'short_spot_long_perp',
    perpetualBidPrice: '100.5',
    perpetualAskPrice: '101',
  });
  appendPublicOpportunityObservation(ledger, known);
  appendPublicOpportunityObservation(ledger, known);
  appendPublicOpportunityObservation(ledger, unknown);
  const asOfMs = Date.now() + 60_000;
  const beforeClose = readRolling24hEdgeStatistic(ledger, { asOfMs });

  ledger.close();
  ledger = new Ledger(dataDir);
  const afterReopen = readRolling24hEdgeStatistic(ledger, { asOfMs });

  assert.deepEqual(afterReopen, beforeClose);
  assert.equal(afterReopen.state, 'PARTIAL');
  assert.equal(afterReopen.rawRowCount, 3);
  assert.equal(afterReopen.uniqueObservationCount, 2);
  assert.equal(afterReopen.duplicateRetryCount, 1);
  assert.equal(afterReopen.highWaterReached, true);
  assert.equal(afterReopen.scanComplete, true);
});
