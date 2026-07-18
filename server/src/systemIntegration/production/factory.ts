import {
  evaluateFreshness,
  isValidUtcMillis,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import {
  stableId,
  type InstrumentIdentity,
  type NormalizedEvidence,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeMarkPrice,
} from '../../intelligenceFoundation/evidence/index.js';
import {
  buildUniverseGraph,
  type CoverageObservation,
  type ListingObservation,
  type UniverseSnapshotInput,
  type UniverseSourceKind,
  type UniverseSourceSlice,
  type UniverseSourceState,
} from '../../intelligenceFoundation/universe/index.js';
import {
  IntelligenceRuntimeBridge,
} from '../../intelligenceRuntime/bridge/index.js';
import {
  runtimeUniverseTruth,
  unavailableUniverseTruth,
} from '../../intelligenceRuntime/universe/index.js';
import type {
  ComponentStepContext,
} from '../../foundation/control/index.js';
import {
  createAcceptedQAbstentionBinding,
  createProductionQAdvisoryRuntime,
} from '../adapters/qAdvisory.js';
import type {
  SystemComponentSnapshot,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';
import type {
  RuntimeHealthEvidence,
} from '../composition/types.js';
import type {
  SystemStrategyRuntimeSummary,
  SystemSupervisorSummaries,
} from '../supervisor/types.js';
import {
  publicSourceMaxAgeMs,
  ReceiptObservationTracker,
  SourceObservationTracker,
  validUtcOrNull,
  weakestTemporalFact,
} from './temporal.js';
import { admitProductionSourceRegistry } from './sourceAdmission.js';
import type {
  ProductionBasisConnectionStatus,
  ProductionBasisRuntimePort,
  ProductionMarketEnginePort,
  ProductionMarketRow,
  ProductionFeedStatus,
  ProductionStrategySnapshot,
  ProductionSystemIntegrationInput,
  ProductionSystemIntegrationPorts,
  ProductionVolumeConnectionStatus,
  ProductionVolumeRuntimePort,
} from './types.js';

const MAX_MARKET_ROWS = 8_192;
const MAX_STRATEGY_RECORDS = 2_000;
const SYMBOL = /^[A-Z0-9]{2,32}$/;

type PublicSourceKind = 'SPOT' | 'USDM';

interface MarketFacts {
  readonly valid: boolean;
  readonly universeSymbols: number | null;
  readonly spotObservedSymbols: number | null;
  readonly usdmObservedSymbols: number | null;
  readonly latestSpotSourceTimeMs: number | null;
  readonly latestUsdmSourceTimeMs: number | null;
}

interface LifecycleReadState {
  readonly active: boolean;
  readonly generation: number;
  readonly restartCount: number;
}

interface SourceProjectionEvidence {
  readonly connected: boolean;
  readonly feedState: ProductionFeedStatus | 'missing';
  readonly timestamp: Readonly<SourcedTimestamp> | null;
  readonly facts: Readonly<MarketFacts>;
}

interface MarketFactsCut {
  readonly facts: Readonly<MarketFacts>;
  readonly rows: readonly Readonly<ProductionMarketRow>[];
  readonly spotSourceTimes: ReadonlyMap<string, number | null>;
  readonly usdmSourceTimes: ReadonlyMap<string, number | null>;
}

interface IntelligenceSourceCut {
  readonly spot: Readonly<SourceProjectionEvidence>;
  readonly usdm: Readonly<SourceProjectionEvidence>;
  readonly market: Readonly<MarketFactsCut>;
}

function invalidMarketFactsCut(): Readonly<MarketFactsCut> {
  return Object.freeze({
    facts: Object.freeze({
      valid: false,
      universeSymbols: null,
      spotObservedSymbols: null,
      usdmObservedSymbols: null,
      latestSpotSourceTimeMs: null,
      latestUsdmSourceTimeMs: null,
    }),
    rows: Object.freeze([]),
    spotSourceTimes: new Map<string, number | null>(),
    usdmSourceTimes: new Map<string, number | null>(),
  });
}

function validateFactoryInput(input: Readonly<ProductionSystemIntegrationInput>): void {
  if (!input || typeof input !== 'object') throw new TypeError('production integration input is required');
  if (typeof input.clock?.nowMs !== 'function') throw new TypeError('clock.nowMs is required');
  for (const [name, value, methods] of [
    ['market', input.market, ['init', 'start', 'stop', 'allRows', 'priceUpdatedAt', 'markEventTimestamp']],
    ['basis', input.basis, ['start', 'stop', 'connectionStatus', 'integrationSnapshot']],
    ['volume', input.volume, ['start', 'stop', 'connectionStatus', 'integrationSnapshot']],
  ] as const) {
    if (!value || typeof value !== 'object') throw new TypeError(`${name} runtime is required`);
    for (const method of methods) {
      if (typeof (value as unknown as Record<string, unknown>)[method] !== 'function') {
        throw new TypeError(`${name}.${method} is required`);
      }
    }
  }
}

function latest(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function frozenHealth(
  running: boolean,
  timestamp: Readonly<SourcedTimestamp> | null,
  heartbeatAt: number | null,
): Readonly<RuntimeHealthEvidence> {
  return Object.freeze({
    running,
    timestamp,
    heartbeatAt: validUtcOrNull(heartbeatAt),
    fatal: null,
  });
}

function safeBasisStatus(runtime: ProductionBasisRuntimePort): Readonly<ProductionBasisConnectionStatus> | null {
  try {
    const status = runtime.connectionStatus();
    return status && typeof status === 'object' && typeof status.running === 'boolean' ? status : null;
  } catch {
    return null;
  }
}

function safeVolumeStatus(runtime: ProductionVolumeRuntimePort): Readonly<ProductionVolumeConnectionStatus> | null {
  try {
    const status = runtime.connectionStatus();
    return status && typeof status === 'object' && typeof status.running === 'boolean' ? status : null;
  } catch {
    return null;
  }
}

function safeStrategySnapshot(runtime: {
  integrationSnapshot(): Readonly<ProductionStrategySnapshot>;
}): Readonly<ProductionStrategySnapshot> | null {
  try {
    const snapshot = runtime.integrationSnapshot();
    if (!snapshot || typeof snapshot !== 'object'
        || !Array.isArray(snapshot.decisions) || !Array.isArray(snapshot.proposals)
        || snapshot.decisions.length > MAX_STRATEGY_RECORDS
        || snapshot.proposals.length > MAX_STRATEGY_RECORDS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

class MarketEvidenceReader {
  private readonly spotTracker = new SourceObservationTracker();
  private readonly usdmTracker = new SourceObservationTracker();

  constructor(
    private readonly clock: ProductionSystemIntegrationInput['clock'],
    private readonly market: ProductionMarketEnginePort,
    private readonly maxAgeMs: number,
    private readonly lifecycle: () => Readonly<LifecycleReadState>,
  ) {}

  beginGeneration(): void {
    const facts = this.readFacts();
    this.spotTracker.beginGeneration(facts.latestSpotSourceTimeMs);
    this.usdmTracker.beginGeneration(facts.latestUsdmSourceTimeMs);
  }

  stop(): void {
    this.spotTracker.stop();
    this.usdmTracker.stop();
  }

  readFacts(): Readonly<MarketFacts> {
    return this.readFactsCut().facts;
  }

  private readFactsCut(): Readonly<MarketFactsCut> {
    let rows: readonly Readonly<ProductionMarketRow>[];
    try {
      rows = this.market.allRows();
    } catch {
      return invalidMarketFactsCut();
    }
    if (!Array.isArray(rows) || rows.length > MAX_MARKET_ROWS) {
      return invalidMarketFactsCut();
    }
    const symbols = new Set<string>();
    const spotSourceTimes = new Map<string, number | null>();
    const usdmSourceTimes = new Map<string, number | null>();
    let spotObservedSymbols = 0;
    let usdmObservedSymbols = 0;
    let latestSpotSourceTimeMs: number | null = null;
    let latestUsdmSourceTimeMs: number | null = null;
    try {
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !SYMBOL.test(row.symbol)
            || typeof row.hasSpot !== 'boolean' || typeof row.hasPerp !== 'boolean'
            || symbols.has(row.symbol)) continue;
        symbols.add(row.symbol);
        if (row.hasSpot) {
          const sourceTime = validUtcOrNull(this.market.priceUpdatedAt(row.symbol));
          spotSourceTimes.set(row.symbol, sourceTime);
          if (sourceTime !== null) {
            spotObservedSymbols += 1;
            latestSpotSourceTimeMs = latest(latestSpotSourceTimeMs, sourceTime);
          }
        }
        if (row.hasPerp) {
          const sourceTime = validUtcOrNull(this.market.markEventTimestamp(row.symbol));
          usdmSourceTimes.set(row.symbol, sourceTime);
          if (sourceTime !== null) {
            usdmObservedSymbols += 1;
            latestUsdmSourceTimeMs = latest(latestUsdmSourceTimeMs, sourceTime);
          }
        }
      }
    } catch {
      return invalidMarketFactsCut();
    }
    return Object.freeze({
      facts: Object.freeze({
        valid: true,
        universeSymbols: symbols.size,
        spotObservedSymbols,
        usdmObservedSymbols,
        latestSpotSourceTimeMs,
        latestUsdmSourceTimeMs,
      }),
      rows: Object.freeze([...rows]),
      spotSourceTimes,
      usdmSourceTimes,
    });
  }

  readSource(kind: PublicSourceKind, nowMs = this.clock.nowMs()): Readonly<SourceProjectionEvidence> {
    const facts = this.readFacts();
    return this.sourceEvidence(kind, nowMs, facts);
  }

  readSourcesWithMarketCut(nowMs = this.clock.nowMs()): Readonly<IntelligenceSourceCut> {
    // Spot and USD-M belong to one supervisor step. Scanning the accepted
    // MarketEngine cache once both removes duplicate full-universe work and
    // prevents the two source projections from observing different row cuts.
    const market = this.readFactsCut();
    return Object.freeze({
      spot: this.sourceEvidence('SPOT', nowMs, market.facts),
      usdm: this.sourceEvidence('USDM', nowMs, market.facts),
      market,
    });
  }

  private sourceEvidence(
    kind: PublicSourceKind,
    nowMs: number,
    facts: Readonly<MarketFacts>,
  ): Readonly<SourceProjectionEvidence> {
    const sourceTime = kind === 'SPOT'
      ? facts.latestSpotSourceTimeMs
      : facts.latestUsdmSourceTimeMs;
    const tracker = kind === 'SPOT' ? this.spotTracker : this.usdmTracker;
    const timestamp = facts.valid
      ? tracker.read(
        sourceTime,
        nowMs,
        kind === 'SPOT' ? 'binance.spot.miniTicker.existing-cache' : 'binance.usdm.markPrice.existing-cache',
        this.maxAgeMs,
      )
      : null;
    const feedName = kind === 'SPOT' ? 'spot-miniticker' : 'futures-markprice';
    const feed = this.market.feeds[feedName];
    const feedState = (
      feed === 'open' || feed === 'connecting' || feed === 'closed' ||
      feed === 'cooldown' || feed === 'exhausted'
    ) ? feed : 'missing';
    return Object.freeze({
      connected: this.lifecycle().active && feedState === 'open',
      feedState,
      timestamp,
      facts,
    });
  }

  readComponent(kind: PublicSourceKind): Readonly<SystemComponentSnapshot> {
    const lifecycle = this.lifecycle();
    const nowMs = this.clock.nowMs();
    const evidence = this.readSource(kind, nowMs);
    const freshness = evidence.timestamp ? evaluateFreshness(evidence.timestamp, nowMs) : null;
    const ready = evidence.connected && freshness?.state === 'FRESH';
    const stopped = !lifecycle.active;
    const blockerCodes: string[] = [];
    if (stopped) blockerCodes.push('SOURCE_NOT_STARTED');
    else if (evidence.feedState === 'connecting') blockerCodes.push('SOURCE_TRANSPORT_CONNECTING');
    else if (evidence.feedState === 'cooldown') blockerCodes.push('SOURCE_TRANSPORT_COOLDOWN');
    else if (evidence.feedState === 'exhausted') blockerCodes.push('SOURCE_RETRY_BUDGET_EXHAUSTED');
    else if (evidence.feedState !== 'open') blockerCodes.push('SOURCE_TRANSPORT_DISCONNECTED');
    if (evidence.timestamp === null) blockerCodes.push('SOURCE_OBSERVATION_UNAVAILABLE');
    if (freshness?.state === 'STALE') blockerCodes.push('SOURCE_STALE');
    if (freshness?.state === 'CLOCK_SKEWED') blockerCodes.push('SOURCE_CLOCK_SKEWED');
    const phase = stopped
      ? 'STOPPED'
      : ready
        ? 'RUNNING'
        : evidence.feedState === 'connecting' || (evidence.feedState === 'open' && evidence.timestamp === null)
          ? 'STARTING'
          : evidence.feedState === 'exhausted'
            ? 'BLOCKED'
            : freshness?.state === 'STALE'
              ? 'DEGRADED'
              : 'BLOCKED';
    const readiness = stopped
      ? 'STOPPED'
      : ready
        ? 'READY'
        : evidence.feedState === 'connecting' || (evidence.feedState === 'open' && evidence.timestamp === null)
          ? 'WARMING'
          : evidence.feedState === 'exhausted'
            ? 'BLOCKED'
            : freshness?.state === 'STALE'
              ? 'DEGRADED'
              : 'BLOCKED';
    const sourceLifecycle = stopped
      ? 'STOPPED'
      : ready
        ? 'LIVE'
        : evidence.feedState === 'connecting'
          ? 'CONNECTING'
          : evidence.feedState === 'exhausted'
            ? 'FAILED'
            : evidence.feedState === 'open' && evidence.timestamp === null
              ? 'WARMING'
              : freshness?.state === 'STALE'
                ? 'STALE'
                : evidence.feedState !== 'open'
                  ? 'BACKING_OFF'
                  : 'DEGRADED';
    const component: SystemComponentSnapshot = Object.freeze({
      componentId: kind === 'SPOT' ? 'public-spot-source' : 'public-usdm-source',
      owner: 'INTELLIGENCE_RUNTIME',
      ownerPath: 'server/src/engine/marketData.ts',
      releaseStatuses: Object.freeze(ready
        ? ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC'] as const
        : ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'] as const),
      truthLabel: ready ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
      desiredState: stopped ? 'STOPPED' : 'RUNNING',
      phase,
      domainObservedState: evidence.feedState.toUpperCase(),
      sourceLifecycle,
      readiness,
      authority: ready ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
      completeness: evidence.timestamp ? 'COMPLETE' : 'UNAVAILABLE',
      sourceTimestamp: evidence.timestamp,
      freshness,
      lastReceiveAtMs: evidence.timestamp?.receivedAtMs ?? null,
      lastProcessAtMs: null,
      lastSuccessAtMs: ready ? evidence.timestamp?.receivedAtMs ?? null : null,
      dependencies: Object.freeze([]),
      queue: null,
      lastFailure: null,
      blockerCodes: Object.freeze([...new Set(blockerCodes)].sort()),
      generation: lifecycle.generation,
      restartCount: lifecycle.restartCount,
      supportedControls: Object.freeze([]),
      capitalExposed: false,
      operatorAttentionRequired: readiness === 'BLOCKED' || readiness === 'DEGRADED',
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) {
      throw new TypeError(`invalid ${kind} production projection: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
    }
    return component;
  }
}

const PUBLIC_UNIVERSE_CONFIGURATION = 'i00-public-universe-v1';
const MAX_PUBLIC_INTELLIGENCE_PROJECTION_INTERVAL_MS = 5_000;
const MAX_PROJECTED_UNIVERSE_ROWS = 640;
const MAX_PROJECTED_MARK_EVIDENCE = 256;

interface IntelligenceRefresh {
  readonly universeReady: boolean;
  readonly evidenceReady: boolean;
  readonly spotTimestamp: Readonly<SourcedTimestamp> | null;
  readonly usdmTimestamp: Readonly<SourcedTimestamp> | null;
}

interface IntelligenceRefreshHandoff {
  readonly nowMs: number;
  readonly generation: number;
  readonly correlationId: string;
  readonly value: Readonly<IntelligenceRefresh>;
}

function marketInstrument(
  row: Readonly<ProductionMarketRow>,
  productFamily: 'SPOT' | 'USD_M_PERPETUAL',
): Readonly<InstrumentIdentity> | null {
  if (!SYMBOL.test(row.symbol) || typeof row.base !== 'string' || !/^[A-Z0-9]{1,24}$/.test(row.base)) return null;
  const instrument: InstrumentIdentity = {
    instrumentId: '',
    venue: 'BINANCE',
    productFamily,
    symbol: row.symbol,
    pair: row.symbol,
    baseAsset: row.base,
    quoteAsset: 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
  instrument.instrumentId = stableId('instrument', {
    venue: instrument.venue,
    productFamily: instrument.productFamily,
    symbol: instrument.symbol,
    pair: instrument.pair,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    contractType: instrument.contractType,
    sourceMarketType: instrument.sourceMarketType,
  });
  return Object.freeze(instrument);
}

function publicUniverseTruth(input: Readonly<{
  nowMs: number;
  timestamp: Readonly<SourcedTimestamp>;
  sourceId: string;
  dataset: string;
  sourceRecordIds: readonly string[];
  observedFields: readonly string[];
  missingFields?: readonly string[];
}>): Readonly<TruthMetadata> {
  const missingFields = input.missingFields ?? Object.freeze([]);
  return runtimeUniverseTruth({
    configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
    sourceId: input.sourceId,
    dataset: input.dataset,
    endpointClass: 'MARKET',
    authorityKind: 'EXCHANGE_PRIMARY',
    evaluatedAtMs: input.nowMs,
    receivedTimeMs: input.timestamp.receivedAtMs,
    maxAgeMs: input.timestamp.maxAgeMs,
    sourceRecordIds: input.sourceRecordIds,
    transforms: ['project-existing-market-owner-v1'],
    completeness: missingFields.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: input.observedFields,
    missingFields,
    reasonCodes: missingFields.length === 0 ? [] : ['OWNER_FIELDS_NOT_EXPOSED'],
  });
}

function unavailableSlice<T>(source: UniverseSourceKind, nowMs: number): Readonly<UniverseSourceSlice<T>> {
  return Object.freeze({
    source,
    state: 'UNAVAILABLE' as const,
    records: Object.freeze([]) as readonly T[],
    truth: unavailableUniverseTruth({
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      sourceId: `i00.${source.toLowerCase()}.not-mounted`,
      dataset: `${source.toLowerCase()}-universe`,
      evaluatedAtMs: nowMs,
      missingField: `${source.toLowerCase()}SourceTruth`,
      reasonCode: `${source}_SOURCE_NOT_MOUNTED`,
    }),
  });
}

function listing(
  row: Readonly<ProductionMarketRow>,
  productFamily: 'SPOT' | 'USD_M_PERPETUAL',
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
): Readonly<ListingObservation> | null {
  const instrument = marketInstrument(row, productFamily);
  if (instrument === null) return null;
  const sourceId = productFamily === 'SPOT'
    ? 'binance.spot.miniTicker.existing-cache'
    : 'binance.usdm.markPrice.existing-cache';
  const dataset = productFamily === 'SPOT' ? 'spot-mini-ticker-universe' : 'usd-m-mark-price-universe';
  const sourceTime = productFamily === 'SPOT'
    ? timestamp.sourceTimeMs
    : timestamp.sourceTimeMs;
  const recordId = stableId('existing-market-listing', {
    productFamily,
    symbol: row.symbol,
    sourceTime,
  });
  return Object.freeze({
    id: recordId,
    kind: productFamily === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument,
    tradingStatus: 'TRADING',
    tradingAllowed: null,
    aliases: Object.freeze([row.symbol]),
    rules: Object.freeze({
      minimumPrice: null,
      maximumPrice: null,
      tickSize: null,
      minimumQuantity: null,
      maximumQuantity: null,
      quantityStep: null,
      minimumNotional: null,
      maximumNotional: null,
    }),
    quoteVolume: null,
    quoteVolume24hUsd: null,
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId,
      dataset,
      sourceRecordIds: [recordId],
      observedFields: ['symbol', 'baseAsset', 'quoteAsset', 'tradingStatus'],
      missingFields: ['tradingAllowed', 'tradingRules', 'quoteVolume24hUsd'],
    }),
  });
}

function coverage(
  listingRecord: Readonly<ListingObservation>,
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
): Readonly<CoverageObservation> {
  const evidenceKinds = listingRecord.kind === 'SPOT_LISTING'
    ? Object.freeze(['CONTEXT'] as const)
    : Object.freeze(['MARK_PRICE'] as const);
  const id = stableId('existing-market-coverage', {
    instrumentId: listingRecord.instrument.instrumentId,
    sourceTimeMs: timestamp.sourceTimeMs,
  });
  return Object.freeze({
    id,
    instrument: listingRecord.instrument,
    publicData: Object.freeze({ state: 'AVAILABLE' as const, evidenceKinds, reasonCodes: Object.freeze([]) }),
    focusedData: Object.freeze({
      state: 'UNKNOWN' as const,
      evidenceKinds: Object.freeze([]),
      reasonCodes: Object.freeze(['FOCUSED_TRANSPORT_NOT_OWNED']),
    }),
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId: timestamp.sourceId,
      dataset: 'existing-public-market-coverage',
      sourceRecordIds: [id],
      observedFields: ['publicData'],
      missingFields: ['focusedData'],
    }),
  });
}

function availableSlice<T>(
  source: UniverseSourceKind,
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
  records: readonly T[],
): Readonly<UniverseSourceSlice<T>> {
  const state: UniverseSourceState = records.length > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  if (state === 'UNAVAILABLE') return unavailableSlice<T>(source, nowMs);
  return Object.freeze({
    source,
    state,
    records: Object.freeze([...records]),
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId: timestamp.sourceId,
      dataset: `${source.toLowerCase()}-existing-owner-slice`,
      sourceRecordIds: records.flatMap((record) => {
        const id = (record as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      }),
      observedFields: ['records'],
      missingFields: ['independentCompletenessReceipt'],
    }),
  });
}

function coverageSlice(
  nowMs: number,
  spotTimestamp: Readonly<SourcedTimestamp>,
  usdmTimestamp: Readonly<SourcedTimestamp> | null,
  records: readonly Readonly<CoverageObservation>[],
): Readonly<UniverseSourceSlice<CoverageObservation>> {
  if (records.length === 0) return unavailableSlice('COVERAGE', nowMs);
  const receipts = [spotTimestamp.receivedAtMs, ...(usdmTimestamp === null ? [] : [usdmTimestamp.receivedAtMs])];
  const sourceSet = [spotTimestamp.sourceId, ...(usdmTimestamp === null ? [] : [usdmTimestamp.sourceId])];
  return Object.freeze({
    source: 'COVERAGE' as const,
    state: 'PARTIAL' as const,
    records: Object.freeze([...records]),
    truth: runtimeUniverseTruth({
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      sourceId: 'system-integration.existing-public-coverage-projection',
      dataset: 'existing-public-market-coverage',
      endpointClass: 'INJECTED',
      authorityKind: 'ENGINE_DERIVED',
      evaluatedAtMs: nowMs,
      receivedTimeMs: Math.min(...receipts),
      maxAgeMs: Math.min(spotTimestamp.maxAgeMs, usdmTimestamp?.maxAgeMs ?? spotTimestamp.maxAgeMs),
      sourceRecordIds: records.map((record) => record.id),
      sourceSet,
      transforms: ['join-existing-owner-coverage-v1'],
      completeness: 'PARTIAL',
      observedFields: ['publicData'],
      missingFields: ['focusedData', 'independentCompletenessReceipt'],
      reasonCodes: ['FOCUSED_TRANSPORT_NOT_OWNED'],
    }),
  });
}

/**
 * Serial, read-only projection into the accepted intelligence owners. It reads
 * the already-running MarketEngine cache and never constructs transport,
 * duplicates a source cache, computes a strategy score, or gains money-path
 * authority.
 */
class PublicIntelligenceLifecycle {
  private readonly bridge: IntelligenceRuntimeBridge;
  private readonly projectionIntervalMs: number;
  private runtimeActive = false;
  private intelligenceActive = false;
  private lastProjectionKey: string | null = null;
  private lastProjectionAtMs: number | null = null;
  private lastProjectedSpotTimestamp: Readonly<SourcedTimestamp> | null = null;
  private lastProjectedUsdmTimestamp: Readonly<SourcedTimestamp> | null = null;
  private lastUniverseReady = false;
  private lastEvidenceReady = false;
  private siblingRefreshHandoff: Readonly<IntelligenceRefreshHandoff> | null = null;

  constructor(
    private readonly clock: ProductionSystemIntegrationInput['clock'],
    private readonly market: ProductionMarketEnginePort,
    private readonly evidence: MarketEvidenceReader,
    private readonly maxAgeMs: number,
  ) {
    this.bridge = new IntelligenceRuntimeBridge({ clock });
    // Sampling may reduce allocation churn, but it must never outlive the
    // source contract. Re-project at least twice inside the configured
    // freshness window and immediately fail closed on the source reads below.
    this.projectionIntervalMs = Math.min(
      MAX_PUBLIC_INTELLIGENCE_PROJECTION_INTERVAL_MS,
      Math.max(1, Math.floor(maxAgeMs / 2)),
    );
  }

  startRuntime(): Promise<void> {
    this.runtimeActive = true;
    return Promise.resolve();
  }

  stopRuntime(): void {
    this.runtimeActive = false;
    this.intelligenceActive = false;
    this.resetGenerationProjection();
  }

  startIntelligence(): Promise<void> {
    if (!this.runtimeActive) throw new TypeError('market intelligence requires the intelligence runtime');
    this.siblingRefreshHandoff = null;
    this.intelligenceActive = true;
    return Promise.resolve();
  }

  stopIntelligence(): void {
    this.intelligenceActive = false;
    this.siblingRefreshHandoff = null;
    this.lastEvidenceReady = false;
  }

  runtimeHealth(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    if (!this.runtimeActive) return frozenHealth(false, null, null);
    const refreshed = this.refresh(ctx);
    // The canonical supervisor probes the runtime immediately before its
    // intelligence sibling. Hand off exactly one same-step result so that pair
    // observes one market cut without creating a cross-step cache.
    this.siblingRefreshHandoff = Object.freeze({
      nowMs: ctx.nowMs,
      generation: ctx.generation,
      correlationId: ctx.correlationId,
      value: refreshed,
    });
    return frozenHealth(
      true,
      refreshed.universeReady ? refreshed.spotTimestamp : null,
      refreshed.universeReady
        ? refreshed.spotTimestamp?.sourceTimeMs ?? refreshed.spotTimestamp?.receivedAtMs ?? null
        : null,
    );
  }

  intelligenceHealth(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    if (!this.intelligenceActive) return frozenHealth(false, null, null);
    const handoff = this.siblingRefreshHandoff;
    this.siblingRefreshHandoff = null;
    const refreshed = handoff !== null
        && handoff.nowMs === ctx.nowMs
        && handoff.generation === ctx.generation
        && handoff.correlationId === ctx.correlationId
      ? handoff.value
      : this.refresh(ctx);
    return frozenHealth(
      true,
      refreshed.universeReady && refreshed.evidenceReady ? refreshed.usdmTimestamp : null,
      refreshed.universeReady && refreshed.evidenceReady
        ? refreshed.usdmTimestamp?.sourceTimeMs ?? refreshed.usdmTimestamp?.receivedAtMs ?? null
        : null,
    );
  }

  private resetGenerationProjection(): void {
    this.siblingRefreshHandoff = null;
    this.lastProjectionKey = null;
    this.lastProjectionAtMs = null;
    this.lastProjectedSpotTimestamp = null;
    this.lastProjectedUsdmTimestamp = null;
    this.lastUniverseReady = false;
    this.lastEvidenceReady = false;
  }

  private refresh(ctx: ComponentStepContext): Readonly<IntelligenceRefresh> {
    // Receipt time and evaluation time belong to the same deterministic
    // supervisor step. Taking a second clock sample here can place a newly
    // accepted receipt after ctx.nowMs and manufacture a negative age.
    const sourceCut = this.evidence.readSourcesWithMarketCut(ctx.nowMs);
    const { spot, usdm } = sourceCut;
    const spotFresh = spot.timestamp !== null && evaluateFreshness(spot.timestamp, ctx.nowMs).state === 'FRESH';
    const usdmFresh = usdm.connected
      && usdm.timestamp !== null
      && evaluateFreshness(usdm.timestamp, ctx.nowMs).state === 'FRESH';
    if (!spot.connected || !spotFresh) {
      this.lastUniverseReady = false;
      this.lastEvidenceReady = false;
      return Object.freeze({
        universeReady: false,
        evidenceReady: false,
        spotTimestamp: spot.timestamp,
        usdmTimestamp: usdm.timestamp,
      });
    }

    const key = `${spot.timestamp?.sourceTimeMs ?? 'receive'}:${usdmFresh ? usdm.timestamp?.sourceTimeMs ?? 'receive' : 'unavailable'}`;
    const projectionDue = this.lastProjectionAtMs === null
      || ctx.nowMs - this.lastProjectionAtMs >= this.projectionIntervalMs;
    const retryNeeded = !this.lastUniverseReady || (usdmFresh && !this.lastEvidenceReady);
    if (projectionDue && (key !== this.lastProjectionKey || retryNeeded)) {
      const projected = this.project(
        ctx.nowMs,
        spot.timestamp as Readonly<SourcedTimestamp>,
        usdmFresh ? usdm.timestamp : null,
        sourceCut.market,
      );
      this.lastProjectionKey = key;
      this.lastProjectionAtMs = ctx.nowMs;
      this.lastProjectedSpotTimestamp = spot.timestamp;
      this.lastProjectedUsdmTimestamp = usdmFresh ? usdm.timestamp : null;
      this.lastUniverseReady = projected.universeReady;
      this.lastEvidenceReady = projected.evidenceReady;
    }
    return Object.freeze({
      universeReady: this.lastUniverseReady,
      evidenceReady: this.lastEvidenceReady && usdmFresh,
      spotTimestamp: this.lastProjectedSpotTimestamp,
      usdmTimestamp: this.lastProjectedUsdmTimestamp,
    });
  }

  private project(
    nowMs: number,
    spotTimestamp: Readonly<SourcedTimestamp>,
    usdmTimestamp: Readonly<SourcedTimestamp> | null,
    marketCut: Readonly<MarketFactsCut>,
  ): Readonly<Pick<IntelligenceRefresh, 'universeReady' | 'evidenceReady'>> {
    if (!marketCut.facts.valid || marketCut.rows.length === 0 || marketCut.rows.length > MAX_MARKET_ROWS) {
      return Object.freeze({ universeReady: false, evidenceReady: false });
    }
    const boundedRows = marketCut.rows.slice(0, MAX_PROJECTED_UNIVERSE_ROWS);
    const spotListings = boundedRows
      .filter((row) => row.hasSpot
        && marketCut.spotSourceTimes.get(row.symbol) === spotTimestamp.sourceTimeMs)
      .map((row) => listing(row, 'SPOT', nowMs, spotTimestamp))
      .filter((record): record is Readonly<ListingObservation> => record !== null);
    const perpetualListings = usdmTimestamp === null
      ? []
      : boundedRows
        .filter((row) => row.hasPerp
          && marketCut.usdmSourceTimes.get(row.symbol) === usdmTimestamp.sourceTimeMs)
        .map((row) => listing(row, 'USD_M_PERPETUAL', nowMs, usdmTimestamp))
        .filter((record): record is Readonly<ListingObservation> => record !== null);
    const coverageRecords = [
      ...spotListings.map((record) => coverage(record, nowMs, spotTimestamp)),
      ...perpetualListings.map((record) => coverage(record, nowMs, usdmTimestamp as Readonly<SourcedTimestamp>)),
    ];
    const input: UniverseSnapshotInput = {
      observedAtMs: nowMs,
      spot: availableSlice('SPOT', nowMs, spotTimestamp, spotListings),
      usdMPerpetual: usdmTimestamp === null
        ? unavailableSlice('USD_M_PERPETUAL', nowMs)
        : availableSlice('USD_M_PERPETUAL', nowMs, usdmTimestamp, perpetualListings),
      margin: unavailableSlice('MARGIN', nowMs),
      borrow: unavailableSlice('BORROW', nowMs),
      coverage: coverageSlice(nowMs, spotTimestamp, usdmTimestamp, coverageRecords),
    };
    const graph = buildUniverseGraph(input, {
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      requireSpotForFocus: true,
      requirePerpetualForFocus: false,
      requirePublicDataForFocus: true,
      requireFocusedDataForFocus: false,
      maxRecordsPerSource: MAX_PROJECTED_UNIVERSE_ROWS * 2,
    });
    const universeReceipt = this.bridge.updateUniverse(graph);
    const universeReady = universeReceipt.accepted && universeReceipt.nodeCount > 0;
    if (!universeReady || usdmTimestamp === null) {
      return Object.freeze({ universeReady, evidenceReady: false });
    }

    const normalized: NormalizedEvidence[] = [];
    const qualityFailures = [];
    const fact = BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE;
    for (const row of boundedRows) {
      if (normalized.length >= MAX_PROJECTED_MARK_EVIDENCE || !row.hasPerp
          || typeof row.perpMark !== 'number' || !Number.isFinite(row.perpMark) || row.perpMark <= 0) continue;
      const sourceTimeMs = marketCut.usdmSourceTimes.get(row.symbol) ?? null;
      if (sourceTimeMs === null || sourceTimeMs !== usdmTimestamp.sourceTimeMs
          || sourceTimeMs > usdmTimestamp.receivedAtMs) continue;
      const result = normalizeMarkPrice({
        e: 'markPriceUpdate',
        E: sourceTimeMs,
        s: row.symbol,
        ps: row.symbol,
        st: 1,
        p: String(row.perpMark),
        ...(typeof row.perpIndexPrice === 'number' && Number.isFinite(row.perpIndexPrice) && row.perpIndexPrice > 0
          ? { i: String(row.perpIndexPrice) }
          : {}),
      }, {
        sourceKey: 'USD_M_MARK_PRICE',
        sourceId: fact.sourceId,
        endpointClass: fact.endpointClass,
        instrument: {
          venue: 'BINANCE',
          productFamily: 'USD_M_PERPETUAL',
          symbol: row.symbol,
          pair: row.symbol,
          baseAsset: row.base,
          quoteAsset: 'USDT',
          contractType: 'PERPETUAL',
        },
        receivedTimeMs: usdmTimestamp.receivedAtMs,
        evaluatedAtMs: nowMs,
        maxAgeMs: this.maxAgeMs,
        configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      });
      if (result.ok) {
        normalized.push(result.value);
        qualityFailures.push(...result.qualityFailures);
      } else {
        qualityFailures.push(...result.failures);
      }
    }
    if (normalized.length === 0) return Object.freeze({ universeReady, evidenceReady: false });
    const receipt = this.bridge.ingest({
      correlationId: stableId('existing-market-intelligence-ingest', {
        sourceTimeMs: usdmTimestamp.sourceTimeMs,
        evidenceIds: normalized.map((record) => record.id),
      }),
      scope: 'BROAD',
      evidence: normalized,
      qualityFailures,
    });
    return Object.freeze({
      universeReady,
      evidenceReady: receipt.accepted + receipt.duplicate > 0,
    });
  }
}

class MarketLifecyclePort {
  private active = false;
  private generation = 0;
  private startCount = 0;

  constructor(
    private readonly market: ProductionMarketEnginePort,
    private readonly evidence: MarketEvidenceReader,
  ) {}

  readState = (): Readonly<LifecycleReadState> => Object.freeze({
    active: this.active,
    generation: this.generation,
    restartCount: Math.max(0, this.startCount - 1),
  });

  async init(): Promise<void> {
    await this.market.init();
  }

  start(): void {
    if (this.active) return;
    this.evidence.beginGeneration();
    try {
      this.market.start();
    } catch (error) {
      try { this.market.stop(); } catch { /* preserve the first startup failure */ }
      this.evidence.stop();
      throw error;
    }
    this.active = true;
    this.generation += 1;
    this.startCount += 1;
  }

  stop(): void {
    let failure: unknown = null;
    try {
      this.market.stop();
    } catch (error) {
      failure ??= error;
    } finally {
      this.active = false;
      this.evidence.stop();
    }
    if (failure !== null) throw failure;
  }

  health(_ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const evidence = this.evidence.readSource('SPOT');
    const timestamp = evidence.connected ? evidence.timestamp : null;
    return frozenHealth(
      this.active,
      timestamp,
      timestamp?.sourceTimeMs ?? timestamp?.receivedAtMs ?? null,
    );
  }
}

class BasisLifecyclePort {
  private readonly markTracker = new SourceObservationTracker();
  private readonly bookTracker = new ReceiptObservationTracker();

  constructor(
    private readonly runtime: ProductionBasisRuntimePort,
    private readonly maxAgeMs: number,
  ) {}

  async start(): Promise<void> {
    const prior = safeBasisStatus(this.runtime);
    this.markTracker.beginGeneration(prior?.lastMarkTs ?? null);
    this.bookTracker.beginGeneration(prior?.lastBookTs ?? null);
    try {
      await this.runtime.start();
    } catch (error) {
      try { this.runtime.stop(); } catch { /* preserve the first startup failure */ }
      this.markTracker.stop();
      this.bookTracker.stop();
      throw error;
    }
  }

  stop(): void {
    try {
      this.runtime.stop();
    } finally {
      this.markTracker.stop();
      this.bookTracker.stop();
    }
  }

  health(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const status = safeBasisStatus(this.runtime);
    if (!status) return frozenHealth(false, null, null);
    const book = this.bookTracker.read(
      validUtcOrNull(status.lastBookTs),
      'binance.spot-usdm.bookTicker.rest-receipt',
      this.maxAgeMs,
    );
    const mark = this.markTracker.read(
      validUtcOrNull(status.lastMarkTs),
      ctx.nowMs,
      'binance.usdm.markPrice.existing-cache',
      this.maxAgeMs,
    );
    const timestamp = weakestTemporalFact([book, mark], ctx.nowMs);
    return frozenHealth(
      status.running,
      timestamp,
      latest(validUtcOrNull(status.lastBookTs), validUtcOrNull(status.lastMarkTs)),
    );
  }
}

class VolumeLifecyclePort {
  private readonly tradeTracker = new SourceObservationTracker();
  private readonly bookTracker = new ReceiptObservationTracker();

  constructor(
    private readonly runtime: ProductionVolumeRuntimePort,
    private readonly maxAgeMs: number,
  ) {}

  async start(): Promise<void> {
    const prior = safeVolumeStatus(this.runtime);
    this.tradeTracker.beginGeneration(prior?.lastTradeTs ?? null);
    this.bookTracker.beginGeneration(prior?.lastBookTs ?? null);
    try {
      await this.runtime.start();
    } catch (error) {
      try { this.runtime.stop(); } catch { /* preserve the first startup failure */ }
      this.tradeTracker.stop();
      this.bookTracker.stop();
      throw error;
    }
  }

  stop(): void {
    try {
      this.runtime.stop();
    } finally {
      this.tradeTracker.stop();
      this.bookTracker.stop();
    }
  }

  health(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const status = safeVolumeStatus(this.runtime);
    if (!status) return frozenHealth(false, null, null);
    const transportOpen = status.streamState === 'open'
      && Number.isSafeInteger(status.streamConnections)
      && status.streamConnections > 0
      && status.openConnections === status.streamConnections;
    const book = this.bookTracker.read(
      validUtcOrNull(status.lastBookTs),
      'binance.spot.bookTicker.rest-receipt',
      this.maxAgeMs,
    );
    const trade = this.tradeTracker.read(
      validUtcOrNull(status.lastTradeTs),
      ctx.nowMs,
      'binance.spot.aggTrade.existing-runtime',
      this.maxAgeMs,
    );
    const timestamp = transportOpen ? weakestTemporalFact([book, trade], ctx.nowMs) : null;
    return frozenHealth(
      status.running,
      timestamp,
      latest(validUtcOrNull(status.lastBookTs), validUtcOrNull(status.lastTradeTs)),
    );
  }
}

function strategySummary(
  snapshot: Readonly<ProductionStrategySnapshot> | null,
  health: Readonly<RuntimeHealthEvidence>,
  nowMs: number,
): Readonly<SystemStrategyRuntimeSummary> {
  if (!snapshot) {
    return Object.freeze({
      truthLabel: 'UNAVAILABLE',
      heartbeatAtMs: null,
      candidateCount: null,
      proposalCount: null,
      rejectionCount: null,
      acceptedCount: null,
      lastDecisionAtMs: null,
      sourceRevision: null,
    });
  }
  const timestamps = snapshot.decisions
    .map((decision) => validUtcOrNull(decision.ts))
    .filter((value): value is number => value !== null);
  const freshness = health.timestamp ? evaluateFreshness(health.timestamp, nowMs) : null;
  const live = health.running && freshness?.state === 'FRESH';
  return Object.freeze({
    truthLabel: live ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
    heartbeatAtMs: validUtcOrNull(snapshot.lastTickTs),
    candidateCount: snapshot.decisions.filter((decision) => decision.kind === 'watch' || decision.kind === 'focus').length,
    proposalCount: snapshot.proposals.length,
    rejectionCount: snapshot.decisions.filter((decision) => decision.kind === 'reject').length,
    acceptedCount: snapshot.decisions.filter((decision) => decision.kind === 'proposal').length,
    lastDecisionAtMs: timestamps.length > 0 ? Math.max(...timestamps) : null,
    sourceRevision: null,
  });
}

export function createProductionSystemIntegrationPorts(
  input: Readonly<ProductionSystemIntegrationInput>,
): Readonly<ProductionSystemIntegrationPorts> {
  validateFactoryInput(input);
  const sourceRegistry = admitProductionSourceRegistry(input.clock);
  const maxAgeMs = publicSourceMaxAgeMs(input.sourceMaxAgeMs);

  let marketLifecycle: MarketLifecyclePort;
  const evidence = new MarketEvidenceReader(
    input.clock,
    input.market,
    maxAgeMs,
    () => marketLifecycle.readState(),
  );
  marketLifecycle = new MarketLifecyclePort(input.market, evidence);
  const publicIntelligence = new PublicIntelligenceLifecycle(
    input.clock,
    input.market,
    evidence,
    maxAgeMs,
  );
  const basisLifecycle = new BasisLifecyclePort(input.basis, maxAgeMs);
  const volumeLifecycle = new VolumeLifecyclePort(input.volume, maxAgeMs);
  const qAdvisory = createProductionQAdvisoryRuntime({
    clock: input.clock,
    binding: input.qAdvisory === undefined
      ? createAcceptedQAbstentionBinding()
      : input.qAdvisory,
  });

  const runtimes = Object.freeze({
    market: Object.freeze({
      init: () => marketLifecycle.init(),
      start: () => marketLifecycle.start(),
      stop: () => marketLifecycle.stop(),
      health: (ctx: ComponentStepContext) => marketLifecycle.health(ctx),
    }),
    intelligenceRuntime: Object.freeze({
      start: () => publicIntelligence.startRuntime(),
      stop: () => publicIntelligence.stopRuntime(),
      health: (ctx: ComponentStepContext) => publicIntelligence.runtimeHealth(ctx),
    }),
    marketIntelligence: Object.freeze({
      start: () => publicIntelligence.startIntelligence(),
      stop: () => publicIntelligence.stopIntelligence(),
      health: (ctx: ComponentStepContext) => publicIntelligence.intelligenceHealth(ctx),
    }),
    q: Object.freeze({
      validate: (ctx: ComponentStepContext) => qAdvisory.validate?.(ctx),
      start: () => qAdvisory.start(),
      stop: () => qAdvisory.stop(),
      health: (ctx: ComponentStepContext) => qAdvisory.health(ctx),
    }),
    basis: Object.freeze({
      start: () => basisLifecycle.start(),
      stop: () => basisLifecycle.stop(),
      health: (ctx: ComponentStepContext) => basisLifecycle.health(ctx),
    }),
    volume: Object.freeze({
      start: () => volumeLifecycle.start(),
      stop: () => volumeLifecycle.stop(),
      health: (ctx: ComponentStepContext) => volumeLifecycle.health(ctx),
    }),
  });

  const components = Object.freeze({
    'public-spot-source': Object.freeze({
      readComponentSnapshot: () => evidence.readComponent('SPOT'),
    }),
    'public-usdm-source': Object.freeze({
      readComponentSnapshot: () => evidence.readComponent('USDM'),
    }),
    'q-inference': Object.freeze({
      readComponentSnapshot: () => qAdvisory.readComponentSnapshot(),
    }),
  });

  const summaries = Object.freeze({
    readSupervisorSummaries: () => {
      const nowMs = input.clock.nowMs();
      if (!isValidUtcMillis(nowMs)) throw new TypeError('clock.nowMs returned invalid UTC ms');
      const facts = evidence.readFacts();
      const spot = evidence.readComponent('SPOT');
      const usdm = evidence.readComponent('USDM');
      const marketLive = spot.truthLabel === 'LIVE_PUBLIC' && usdm.truthLabel === 'LIVE_PUBLIC';
      const ctx: ComponentStepContext = Object.freeze({
        nowMs,
        generation: marketLifecycle.readState().generation,
        correlationId: 'production-summary-read',
        runMode: 'INTELLIGENCE',
        privateKeysAvailable: false,
      });
      const basisHealth = basisLifecycle.health(ctx);
      const volumeHealth = volumeLifecycle.health(ctx);
      const result: Partial<Pick<SystemSupervisorSummaries, 'sourceCoverage' | 'strategies'>> = {
        sourceCoverage: Object.freeze({
          truthLabel: marketLive ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
          universeSymbols: facts.universeSymbols,
          spotCoveredSymbols: facts.spotObservedSymbols,
          usdMCoveredSymbols: facts.usdmObservedSymbols,
          quietSymbolsRetained: null,
          materialGapCount: null,
          rateLimitedSourceCount: null,
          lastMaterialGapAtMs: null,
        }),
        strategies: Object.freeze({
          basis: strategySummary(safeStrategySnapshot(input.basis), basisHealth, nowMs),
          volume: strategySummary(safeStrategySnapshot(input.volume), volumeHealth, nowMs),
        }),
      };
      return Object.freeze(result);
    },
  });

  const strategyIntake = Object.freeze({
    basis: Object.freeze({
      readPaused: () => input.basis.intakePaused(),
      setPaused: (paused: boolean) => input.basis.setIntakePaused(paused),
    }),
  });

  return Object.freeze({ sourceRegistry, runtimes, components, summaries, strategyIntake });
}
