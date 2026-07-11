import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSystemSourceRegistry,
  captureEngineSnapshot,
  projectCachedAccountTruth,
  probeSystemComponent,
} from '../../../dist/systemIntegration/adapters/index.js';
import {
  projectIntelligenceTruthToSourcedTimestamp,
  translateRuntimeCoverage,
  translateRuntimeErrorToStructuredFailure,
  translateStableFailureToStructuredFailure,
} from '../../../dist/systemIntegration/contracts/index.js';
import { makeStableFailure } from '../../../dist/intelligenceFoundation/contracts/index.js';

const NOW = 1_800_000_000_000;
const CONTEXT = Object.freeze({
  nowMs: NOW,
  correlationId: 'cor-integration-adapters-test',
  safeCurrentState: 'READ_ONLY',
});

function truth(overrides = {}) {
  return {
    schemaVersion: '1',
    producerVersion: 'runtime-1',
    configurationVersion: 'cfg-1',
    featureVersion: null,
    authority: {
      kind: 'EXCHANGE_PRIMARY',
      sourceId: 'binance.spot.trade',
      dataset: 'aggregate-trades',
      endpointClass: 'MARKET',
    },
    provenance: {
      sourceRecordIds: ['trade-1'],
      sourceSet: ['binance.spot.trade'],
      transforms: ['decode'],
    },
    temporal: {
      sourceEventTimeMs: NOW - 100,
      sourceTransactionTimeMs: NOW - 90,
      receivedTimeMs: NOW - 80,
      sequence: { first: '10', last: '10', previous: '9' },
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: NOW,
      ageMs: 100,
      maxAgeMs: 1_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['price'],
      missingFields: [],
      reasonCodes: [],
    },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    ts: NOW - 200,
    strategy: 'basis',
    kind: 'proposal',
    rejectCode: null,
    humanReason: 'engine-owned exact decision',
    correlationId: 'basis-correlation-1',
    evidence: {
      direction: 'long_spot_short_perp',
      netEdgePct: 0.42,
      borrowStatus: 'not_needed',
    },
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'basis-proposal-opaque-1',
    correlationId: 'basis-correlation-1',
    strategy: 'basis',
    symbol: 'BTCUSDT',
    direction: 'long_spot_short_perp',
    createdTs: NOW - 300,
    updatedTs: NOW - 200,
    status: 'open',
    reason: 'engine-owned exact proposal',
    grossEdgePct: 0.6,
    netEdgePct: 0.42,
    fundingAdjPct: 0.01,
    borrowRequired: false,
    borrowStatus: 'not_needed',
    suggestedNotionalUsd: 100,
    confidence: 0.8,
    invalidation: 'expires or gap closes',
    evidence: { engineRevisionHint: 'not-a-contract-revision' },
    invalidationSpec: { expiresTs: NOW + 10_000 },
    stagedSizes: [{ stage: 1, fraction: 1, notionalUsd: 100 }],
    ...overrides,
  };
}

function sourceTimestamp(overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'account-cache-test',
    ...overrides,
  };
}

function provenance(pool) {
  return { accountId: 'acct-1', capitalPoolId: pool, coherentCutId: 'cut-1' };
}

function cached(value, pool, overrides = {}) {
  return {
    value,
    provenance: provenance(pool),
    source: sourceTimestamp(),
    revision: 'rev-1',
    evidenceReferences: ['cache-fixture'],
    ...overrides,
  };
}

function completeAccountCut(overrides = {}) {
  return {
    evaluatedAtMs: NOW - 1,
    valuationAsset: 'USDT',
    spot: cached({
      balances: [{ asset: 'USDT', total: '100', available: '100', locked: '0' }],
      positions: [{
        positionId: 'spot-btc-observed',
        instrumentId: 'BTCUSDT:SPOT',
        valuationAsset: 'USDT',
        longExposure: '10',
        shortExposure: '0',
      }],
    }, 'spot'),
    futures: cached({ wallets: [], positions: [] }, 'futures'),
    liabilities: cached([], 'liabilities'),
    orders: cached([], 'orders'),
    plans: cached([], 'plans'),
    reservations: cached([], 'reservations'),
    valuations: cached([], 'valuations'),
    hardReserves: cached([], 'hard-reserves'),
    borrowTruthReferences: [],
    ...overrides,
  };
}

function registryRecord(sourceId, semanticStream, overrides = {}) {
  return {
    sourceId,
    semanticStream,
    dataset: `${semanticStream.toLowerCase()}-dataset`,
    productFamily: semanticStream.startsWith('USD_M') ? 'USD_M_PERPETUAL' : 'SPOT',
    endpointClass: 'MARKET',
    physicalProducer: {
      kind: 'EXISTING_AUDITED',
      producerId: `${sourceId}-producer`,
      ownerPath: 'server/src/services/marketData.ts',
      transport: 'INJECTED_EXISTING',
    },
    semanticPublisher: 'intelligence-runtime',
    consumers: ['market-intelligence'],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'],
    maximumAuthority: 'LIVE_PUBLIC',
    duplicatePolicy: 'SINGLE_PRODUCER_ONLY',
    notes: ['existing audited transport is the sole physical producer'],
    ...overrides,
  };
}

test('canonical contract translators preserve time authority and explicit losses', () => {
  const coverage = translateRuntimeCoverage('SAMPLED');
  assert.equal(coverage.foundationCompleteness, 'PARTIAL');
  assert.equal(coverage.sampled, true);
  assert.deepEqual(coverage.losses.map((entry) => entry.code), ['RUNTIME_SAMPLED_LOWER_BOUND']);

  const translated = projectIntelligenceTruthToSourcedTimestamp(truth(), {
    ...CONTEXT,
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(translated.ok, true);
  assert.equal(translated.value.sourceTimeMs, NOW - 100);
  assert.equal(translated.value.receivedAtMs, NOW - 80);
  assert.ok(translated.losses.some((entry) => entry.code === 'TRANSACTION_TIME_NOT_REPRESENTABLE'));
  assert.ok(translated.losses.some((entry) => entry.code === 'SEQUENCE_NOT_REPRESENTABLE'));

  const noBudget = projectIntelligenceTruthToSourcedTimestamp(truth({
    temporal: { sourceEventTimeMs: null, sourceTransactionTimeMs: null, receivedTimeMs: NOW - 10, sequence: null },
    freshness: { basis: 'UNAVAILABLE', evaluatedAtMs: NOW, ageMs: null, maxAgeMs: null, state: 'UNAVAILABLE' },
    completeness: { state: 'MISSING', observedFields: [], missingFields: ['price'], reasonCodes: ['MISSING'] },
  }), {
    ...CONTEXT,
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(noBudget.ok, true);
  assert.equal(noBudget.value, null);
  assert.ok(noBudget.losses.some((entry) => entry.code === 'MAX_AGE_MISSING'));
  assert.ok(noBudget.losses.some((entry) => entry.code === 'SOURCE_TIME_UNAVAILABLE'));
});

test('canonical failure translators retain dialect-only origin fields in typed sidecars', () => {
  const miFailure = translateStableFailureToStructuredFailure(
    makeStableFailure('SEQUENCE_GAP', 'intelligence.books', 'gap detected', 'sequence', ['ev-1']),
    { ...CONTEXT, stage: 'focused-book', recommendedOperatorAction: 'Resync the public book.' },
  );
  assert.equal(miFailure.failure.code, 'SEQUENCE_GAP');
  assert.equal(miFailure.origin.kind, 'MARKET_INTELLIGENCE');
  assert.deepEqual(miFailure.origin.evidenceIds, ['ev-1']);
  assert.ok(miFailure.losses.some((entry) => entry.code === 'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE'));

  const runtimeFailure = translateRuntimeErrorToStructuredFailure({
    code: 'socket-silent',
    message: 'raw runtime detail is retained only at its owner',
    retryable: true,
    observedAtMs: NOW - 50,
    recommendedAction: 'Reconnect public feed.',
  }, {
    ...CONTEXT,
    stage: 'public-source',
    recommendedOperatorAction: 'Inspect the public source.',
    sourceId: 'spot-source',
  });
  assert.equal(runtimeFailure.failure.code, 'RUNTIME_ERROR_CODE_INVALID');
  assert.equal(runtimeFailure.origin.rawCode, 'socket-silent');
  assert.ok(runtimeFailure.losses.some((entry) => entry.code === 'ORIGIN_FAILURE_DETAIL_REDACTED'));
});

test('engine capture preserves full records and opaque proposal IDs while naming missing revisions', () => {
  const sourceDecision = decision();
  const sourceProposal = proposal();
  const captured = captureEngineSnapshot({
    ...CONTEXT,
    family: 'BASIS',
    sourceId: 'engine.basis.snapshot',
    snapshotTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: 'basis-config-v7',
    port: {
      readDecisions: () => [sourceDecision],
      readProposals: () => [sourceProposal],
    },
  });
  assert.equal(captured.ok, true);
  assert.equal(captured.value.snapshot.proposals[0].id, sourceProposal.id);
  assert.equal(captured.value.snapshot.configVersion, 'basis-config-v7');
  assert.equal(captured.value.snapshot.proposals[0].expiresAtMs, NOW + 10_000);
  assert.equal(
    JSON.stringify(captured.value.snapshot.proposals[0].evidence.sourceRecord.stagedSizes),
    JSON.stringify(sourceProposal.stagedSizes),
  );
  assert.equal(captured.value.identities.find((entry) => entry.ownerId === sourceProposal.id).revisionDigest, null);
  assert.ok(captured.losses.some((entry) => entry.code === 'SOURCE_ID_DERIVED'));
  assert.ok(captured.losses.some((entry) => entry.code === 'REVISION_UNAVAILABLE'));
  assert.equal(captured.value.maximumActionAuthority, 'ADVISORY');
  assert.equal(captured.value.capitalReservationAuthority, 'NONE');
  assert.equal(captured.value.executionAuthority, 'NONE');
});

test('source registry rejects a competing producer for one semantic stream', () => {
  const result = buildSystemSourceRegistry({
    ...CONTEXT,
    revision: 1,
    records: [
      registryRecord('existing-spot-book', 'SPOT_BEST_BID_ASK'),
      registryRecord('second-spot-book', 'SPOT_BEST_BID_ASK', {
        physicalProducer: {
          kind: 'MANUAL_ACCEPTANCE_ONLY',
          producerId: 'manual-smoke',
          ownerPath: 'server/src/intelligenceRuntime/smoke',
          transport: 'MANUAL_PUBLIC_SMOKE',
        },
      }),
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'DUPLICATE_SEMANTIC_PRODUCER');
});

test('structural component probe reads once and fail-closes stale owner truth without lifecycle calls', () => {
  let reads = 0;
  let starts = 0;
  const result = probeSystemComponent({
    ...CONTEXT,
    componentId: 'basis-engine',
    owner: 'BASIS_ENGINE',
    ownerPath: 'server/src/engine/basis',
    dependencies: ['public-spot-source', 'public-usdm-source'],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC'],
    supportedControls: ['SET_COMPONENT_STATE', 'RESTART_COMPONENT'],
    port: {
      readComponentProbe() {
        reads += 1;
        return {
          desiredState: 'RUNNING',
          phase: 'RUNNING',
          domainObservedState: 'RUNNING',
          readiness: 'READY',
          authority: 'LIVE_PUBLIC',
          completeness: 'COMPLETE',
          sourceTimestamp: {
            sourceTimeMs: NOW - 5_000,
            receivedAtMs: NOW - 4_900,
            maxAgeMs: 1_000,
            authority: 'LIVE_PUBLIC',
            completeness: 'COMPLETE',
            sourceId: 'basis-engine-snapshot',
          },
          lastReceiveAtMs: NOW - 4_900,
          lastProcessAtMs: NOW - 4_800,
          lastSuccessAtMs: NOW - 4_800,
          queue: null,
          lastFailure: null,
          blockerCodes: [],
          generation: 1,
          restartCount: 0,
          capitalExposed: false,
          operatorAttentionRequired: false,
          truthLabel: 'LIVE_PUBLIC',
        };
      },
      start() {
        starts += 1;
        throw new Error('probe must never own lifecycle');
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
  assert.equal(starts, 0);
  assert.equal(result.value.readiness, 'DEGRADED');
  assert.equal(result.value.phase, 'DEGRADED');
  assert.equal(result.value.authority, 'UNAVAILABLE');
  assert.equal(result.value.truthLabel, 'UNAVAILABLE');
  assert.ok(result.value.blockerCodes.includes('SOURCE_STALE'));
  assert.equal(result.value.releaseStatuses.includes('LIVE_PUBLIC'), false);
});

test('cached account truth never invokes refresh/private methods and remains unavailable when incomplete', () => {
  let reads = 0;
  let refreshes = 0;
  const incomplete = completeAccountCut();
  incomplete.spot = cached(incomplete.spot.value, 'spot', {
    source: sourceTimestamp({ completeness: 'PARTIAL' }),
  });
  const port = {
    readCachedAccountTruth() {
      reads += 1;
      return incomplete;
    },
    refreshPrivateTruth() {
      refreshes += 1;
      throw new Error('private refresh must be unreachable');
    },
  };
  const result = projectCachedAccountTruth({ ...CONTEXT, port });
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
  assert.equal(refreshes, 0);
  assert.equal(result.value.state, 'UNAVAILABLE');
  assert.equal(result.value.availableForNewExposure, false);
  assert.equal(result.value.projection.allocatable.amount, null);
  assert.equal(result.value.supervisionVisible, true);
});
