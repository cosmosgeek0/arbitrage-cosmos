import type { UtcClock } from '../composition/types.js';
import {
  SYSTEM_SEMANTIC_STREAMS,
  type SystemSemanticStream,
} from '../contracts/constants.js';
import type {
  SystemSourceRegistryRecord,
  SystemSourceRegistrySnapshot,
} from '../contracts/types.js';
import { buildSystemSourceRegistry } from '../adapters/sourceRegistry.js';

function record(
  sourceId: string,
  semanticStream: SystemSemanticStream,
  dataset: string,
  productFamily: 'ANY' | 'SPOT' | 'USD_M_PERPETUAL',
  endpointClass: SystemSourceRegistryRecord['endpointClass'],
  producerId: string,
  ownerPath: string,
  consumers: readonly SystemSourceRegistryRecord['consumers'][number][],
  transportPath: string,
): Readonly<SystemSourceRegistryRecord> {
  return Object.freeze({
    sourceId,
    semanticStream,
    dataset,
    productFamily,
    endpointClass,
    physicalProducer: Object.freeze({
      kind: 'EXISTING_AUDITED',
      producerId,
      ownerPath,
      transport: 'INJECTED_EXISTING',
    }),
    semanticPublisher: 'intelligence-runtime',
    consumers: Object.freeze([...consumers]),
    releaseStatuses: Object.freeze(['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'] as const),
    maximumAuthority: 'LIVE_PUBLIC',
    duplicatePolicy: 'SINGLE_PRODUCER_ONLY',
    notes: Object.freeze([
      'production composition admits exactly one audited physical producer',
      `transport owner: ${transportPath}`,
      'registry admission does not claim current runtime liveness',
    ]),
  });
}

export const PRODUCTION_SOURCE_REGISTRY_RECORDS = Object.freeze([
  record('market-universe', 'MARKET_UNIVERSE', 'market.universe', 'ANY', 'REST', 'MarketEngine', 'server/src/engine/marketData.ts', ['market-universe', 'market-intelligence', 'basis-engine', 'volume-engine', 'engine-supervisor'], 'server/src/binance/rest.ts'),
  record('spot-mini-ticker', 'SPOT_MINI_TICKER', 'spot.rolling_24h_mini_ticker', 'SPOT', 'PUBLIC', 'MarketEngine', 'server/src/engine/marketData.ts', ['market-universe', 'market-intelligence', 'basis-engine', 'volume-engine', 'engine-supervisor'], 'server/src/binance/ws.ts'),
  record('spot-aggregate-trade', 'SPOT_AGGREGATE_TRADE', 'spot.aggregate_trade', 'SPOT', 'PUBLIC', 'VolumeRuntime', 'server/src/services/volumeRuntime.ts', ['market-intelligence', 'volume-engine', 'engine-supervisor'], 'server/src/binance/ws.ts'),
  record('spot-best-bid-ask', 'SPOT_BEST_BID_ASK', 'spot.book_ticker', 'SPOT', 'REST', 'BasisRuntime', 'server/src/services/basisRuntime.ts', ['market-intelligence', 'basis-engine'], 'server/src/binance/rest.ts'),
  record('usdm-best-bid-ask', 'USD_M_BEST_BID_ASK', 'usd_m.book_ticker', 'USD_M_PERPETUAL', 'REST', 'BasisRuntime', 'server/src/services/basisRuntime.ts', ['market-intelligence', 'basis-engine'], 'server/src/binance/rest.ts'),
  record('usdm-mark-funding', 'USD_M_MARK_FUNDING', 'usd_m.mark_price', 'USD_M_PERPETUAL', 'MARKET', 'MarketEngine', 'server/src/engine/marketData.ts', ['market-intelligence', 'basis-engine', 'engine-supervisor'], 'server/src/binance/ws.ts'),
  record('usdm-liquidation', 'USD_M_LIQUIDATION', 'usd_m.liquidation', 'USD_M_PERPETUAL', 'MARKET', 'MarketEngine', 'server/src/engine/marketData.ts', ['market-intelligence', 'basis-engine', 'engine-supervisor'], 'server/src/binance/ws.ts'),
]);

/** Hostile-test validator for the immutable production authority catalog. */
export function validateProductionSourceRegistryRecords(
  clock: UtcClock,
  records: readonly Readonly<SystemSourceRegistryRecord>[],
): Readonly<SystemSourceRegistrySnapshot> {
  const result = buildSystemSourceRegistry({
    revision: 1,
    records,
    nowMs: clock.nowMs(),
    safeCurrentState: 'PRODUCTION_SOURCES_NOT_ADMITTED',
    correlationId: 'production-source-registry-admission-v1',
  });
  if (!result.ok) throw new TypeError(`${result.failure.code}: ${result.failure.message}`);

  const admitted = new Set(result.value.records.map((entry) => entry.semanticStream));
  if (result.value.records.length !== SYSTEM_SEMANTIC_STREAMS.length
      || SYSTEM_SEMANTIC_STREAMS.some((stream) => !admitted.has(stream))) {
    throw new TypeError('SOURCE_REGISTRY_INCOMPLETE: every canonical semantic stream requires one admitted producer');
  }
  if (JSON.stringify(result.value.records) !== JSON.stringify(PRODUCTION_SOURCE_REGISTRY_RECORDS)) {
    throw new TypeError('SOURCE_REGISTRY_CANONICAL_MISMATCH: production source authority must equal the immutable catalog');
  }
  return result.value;
}

/** Fail-closed source admission runs before any production lifecycle exists. */
export function admitProductionSourceRegistry(
  clock: UtcClock,
): Readonly<SystemSourceRegistrySnapshot> {
  return validateProductionSourceRegistryRecords(clock, PRODUCTION_SOURCE_REGISTRY_RECORDS);
}
