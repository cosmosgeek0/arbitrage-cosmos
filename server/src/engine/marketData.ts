import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import {
  fetchExchangeUniverse,
  fetchOpenInterest as fetchBinanceOpenInterest,
  type ExchangeUniverse,
  type OpenInterest,
  type SymbolFilters,
} from '../binance/rest.js';
import type { Ledger } from '../ledger.js';
import type { SymbolRow } from '../types.js';

interface FeatureEntry {
  symbol: string;
  base: string;
  spotLast: number | null;
  spotOpen24h: number | null;
  spotHigh24h: number | null;
  spotLow24h: number | null;
  spotQuoteVol24h: number | null;
  perpMark: number | null;
  perpIndexPrice: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  openInterestUsd: number | null;
  openInterestChangePct: number | null;
  openInterestObservedAt: number | null;
  openInterestReceivedAt: number | null;
  openInterestBaselineUsd: number | null;
  openInterestBaselineObservedAt: number | null;
  openInterestBaselineReceivedAt: number | null;
  openInterestLastObservedAt: number | null;
  openInterestLastObservedValue: number | null;
  openInterestLastReceivedAt: number | null;
}

interface SpotMiniTicker {
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  q: string;
}

interface MarkPriceUpdate {
  E: number;
  s: string;
  p: string;
  i?: string;
  r?: string;
  T?: number;
}

interface ForceOrderUpdate {
  e?: string;
  E?: number;
  st?: number;
  ps?: string;
  o?: {
    s: string;
    S: 'BUY' | 'SELL';
    o?: string;
    f?: string;
    q: string;
    p: string;
    ap?: string;
    l?: string;
    z?: string;
    X?: string;
    T?: number;
  };
}

export interface MarketLiquidationEvidenceCut {
  readonly kind: 'FORCE_ORDER';
  readonly generation: number;
  readonly revision: number;
  readonly receivedAtMs: number;
  readonly bootstrap: 'CURRENT_SNAPSHOT' | 'NONE';
  readonly baseAsset: string;
  readonly raw: Readonly<{
    readonly e: 'forceOrder';
    readonly E: number;
    readonly st: 1;
    readonly ps: string;
    readonly o: Readonly<{
      readonly s: string;
      readonly S: 'BUY' | 'SELL';
      readonly o: string;
      readonly f: string;
      readonly q: string;
      readonly ap: string;
      readonly z: string;
      readonly X: 'FILLED';
      readonly T: number;
    }>;
  }>;
}

export interface MarketLiquidationSourceClosedCut {
  readonly kind: 'SOURCE_CLOSED';
  readonly generation: number;
  readonly revision: number;
  readonly observedAtMs: number;
}

export type MarketLiquidationEvidenceObserver = (
  cut: Readonly<MarketLiquidationEvidenceCut | MarketLiquidationSourceClosedCut>,
) => void;

interface LiquidationPrint {
  ts: number;
  side: 'LONG' | 'SHORT';
  notional: number;
}

export interface CanonicalMarketLiquidationPrint {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly notionalUsd: number;
  readonly eventTimeMs: number;
  readonly sourceEventKey: string;
}

export interface MarketLiquidationProjectionPort {
  start(): void;
  stop(): void;
  observeSourceStatus(status: FeedStatus): void;
  ingestPrint(print: Readonly<CanonicalMarketLiquidationPrint>): void;
}

export type MarketPublicSourceId = 'public-spot-source' | 'public-usdm-source';
export type MarketPublicSourceLifecycle = 'LIVE' | 'WARMING' | 'DEGRADED' | 'ISOLATED' | 'FAILED' | 'STOPPED';

export interface MarketEngineClock {
  nowMs(): number;
}

export type MarketOpenInterestFetcher = (symbol: string) => Promise<OpenInterest>;

// Minimal transport handle the engine owns. BinanceStream satisfies it; the
// factory seam mirrors BookStreamHub's established streamFactory pattern so
// lifecycle tests can drive statuses without sockets. The factory is a
// code-level composition option — no env var can reach it.
export interface MarketStreamHandle {
  readonly name: string;
  start(): void;
  stop(): void;
}

export type MarketStreamFactory = (
  name: string,
  url: string,
  onMessage: (data: unknown) => void,
  onStatus: (name: string, status: FeedStatus) => void,
) => MarketStreamHandle;

export interface MarketEngineOptions {
  readonly publicSourceStartupEgressAdmitted: boolean;
  readonly clock?: MarketEngineClock;
  readonly fetchOpenInterest?: MarketOpenInterestFetcher;
  readonly openInterestTtlMs?: number;
  readonly streamFactory?: MarketStreamFactory;
  // Test-time compression of the supervisory recovery schedule, mirroring
  // BinanceStream's injectable retryBaseMs. Bounded; production uses the
  // default.
  readonly sourceRecoveryBaseMs?: number;
  readonly random?: () => number;
}

const SPARK_CAP = 150; // sampled every 20s ≈ last 50 minutes
const SPARK_MS = 20_000;
const OI_SLICE_SIZE = 28;
const OI_REFRESH_MS = 10_000;
const DEFAULT_OI_TTL_MS = 75_000;
const MIN_OI_TTL_MS = 1_000;
const MAX_OI_TTL_MS = 5 * 60_000;
const LIQUIDATION_WINDOW_MS = 15 * 60_000;
const MAX_MARKET_SYMBOLS = 4_096;
const MARKET_EVENT_MAX_AGE_MS = 30_000;
// Supervisory source recovery: BinanceStream deliberately latches exhaustion
// after its bounded ~30s campaign and never self-rearms (pinned by
// stream-lifecycle tests) — so any outage longer than the deadline was silent
// permanent degradation needing a process restart. The engine, which owns the
// stream lifecycle (stop() then start(); start() alone is a no-op while a
// stream is not stopped), re-arms exhausted feeds on an exponential schedule:
// first at 2x the stream deadline, escalating to a 15-minute ceiling, so a
// genuinely dead upstream costs four connection attempts an hour, not a hot
// loop. Jitter de-synchronises the feeds.
const SOURCE_RECOVERY_BASE_MS = 60_000;
const SOURCE_RECOVERY_MAX_MS = 15 * 60_000;
const SOURCE_RECOVERY_JITTER_RATIO = 0.2;
const MAX_FUTURE_SKEW_MS = 5_000;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;
const SYSTEM_MARKET_CLOCK: MarketEngineClock = Object.freeze({ nowMs: () => Date.now() });

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function validSymbol(value: unknown): value is string {
  return typeof value === 'string' && SYMBOL_PATTERN.test(value);
}

function validEventTime(value: unknown, now: number, maxAgeMs = MARKET_EVENT_MAX_AGE_MS): value is number {
  return (
    finite(value) && Number.isSafeInteger(value) && value >= 0 &&
    value <= now + MAX_FUTURE_SKEW_MS && now - value <= maxAgeMs
  );
}

export function openInterestToPerpVolumeRatio(
  openInterestUsd: number | null | undefined,
  perpVolume24h: number | null | undefined,
): number | null {
  return finite(openInterestUsd) && openInterestUsd >= 0 && positive(perpVolume24h)
    ? openInterestUsd / perpVolume24h
    : null;
}

export class MarketEngine {
  readonly feeds: Record<string, FeedStatus> = {};
  readonly filters = new Map<string, SymbolFilters>();
  /** Last spot price for EVERY USDT symbol seen on the mini-ticker feed (for valuations). */
  private spotPrices = new Map<string, number>();
  private spotChange = new Map<string, number>();
  private spotVol = new Map<string, number>();
  private spotRange = new Map<string, { high: number; low: number }>();
  private features = new Map<string, FeatureEntry>();
  private history = new Map<string, number[]>();
  private liquidations = new Map<string, LiquidationPrint[]>();
  private spotUpdatedAt = new Map<string, number>();
  private markUpdatedAt = new Map<string, number>();
  private liquidationUpdatedAt = new Map<string, number>();
  private liquidationEvidenceObserver: MarketLiquidationEvidenceObserver | null = null;
  private liquidationEvidenceGeneration = 0;
  private liquidationEvidenceRevision = 0;
  private liquidationEvidenceOpen = false;
  private streams = new Map<string, MarketStreamHandle>();
  private readonly recoveryTimers = new Map<string, NodeJS.Timeout>();
  private readonly recoveryAttempts = new Map<string, number>();
  private isolatedSources = new Set<MarketPublicSourceId>();
  private sourceControlGenerations: Record<MarketPublicSourceId, number> = {
    'public-spot-source': 0,
    'public-usdm-source': 0,
  };
  private sampler: NodeJS.Timeout | null = null;
  private oiTimer: NodeJS.Timeout | null = null;
  private oiCursor = 0;
  private oiRefreshToken = 0;
  private oiInFlight: Readonly<{
    token: number;
    engineGeneration: number;
    sourceGeneration: number;
    cursorStart: number;
  }> | null = null;
  private running = false;
  private generation = 0;
  private initGeneration = 0;
  private readonly clock: MarketEngineClock;
  private readonly openInterestFetcher: MarketOpenInterestFetcher;
  private readonly openInterestTtlMs: number;
  private readonly streamFactory: MarketStreamFactory;
  private readonly sourceRecoveryBaseMs: number;
  private readonly random: () => number;

  constructor(
    private readonly ledger: Ledger,
    private readonly fetchUniverse: () => Promise<ExchangeUniverse> = fetchExchangeUniverse,
    private readonly liquidationProjection?: MarketLiquidationProjectionPort,
    private readonly startupOptions: Readonly<MarketEngineOptions> = Object.freeze({ publicSourceStartupEgressAdmitted: false }),
  ) {
    const ttlMs = startupOptions.openInterestTtlMs ?? DEFAULT_OI_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_OI_TTL_MS || ttlMs > MAX_OI_TTL_MS) {
      throw new RangeError(`OPEN_INTEREST_TTL_OUT_OF_BOUNDS:${String(ttlMs)}`);
    }
    this.clock = startupOptions.clock ?? SYSTEM_MARKET_CLOCK;
    this.openInterestFetcher = startupOptions.fetchOpenInterest ?? fetchBinanceOpenInterest;
    this.openInterestTtlMs = ttlMs;
    this.streamFactory = startupOptions.streamFactory
      ?? ((name, url, onMessage, onStatus) => new BinanceStream(name, url, onMessage, onStatus));
    const recoveryBaseMs = startupOptions.sourceRecoveryBaseMs ?? SOURCE_RECOVERY_BASE_MS;
    if (!Number.isSafeInteger(recoveryBaseMs) || recoveryBaseMs < 1 || recoveryBaseMs > SOURCE_RECOVERY_MAX_MS) {
      throw new RangeError(`SOURCE_RECOVERY_BASE_OUT_OF_BOUNDS:${String(recoveryBaseMs)}`);
    }
    this.sourceRecoveryBaseMs = recoveryBaseMs;
    this.random = startupOptions.random ?? Math.random;
  }

  get pairCount(): number {
    return this.features.size;
  }

  async init(): Promise<void> {
    this.assertPublicSourceStartupEgressAdmitted();
    const initGeneration = ++this.initGeneration;
    const { pairs, filters } = await this.fetchUniverse();
    const nextFilters = new Map<string, SymbolFilters>();
    const nextFeatures = new Map<string, FeatureEntry>();
    let examinedFilters = 0;
    for (const [key, value] of filters) {
      if (++examinedFilters > MAX_MARKET_SYMBOLS * 2) break;
      if (nextFilters.size >= MAX_MARKET_SYMBOLS) break;
      if (
        !validSymbol(key) || key !== value.symbol || !validSymbol(value.symbol) ||
        typeof value.base !== 'string' || value.base.length === 0 || value.base.length > 24 ||
        value.quote !== 'USDT' || value.status !== 'TRADING' ||
        !finite(value.stepSize) || value.stepSize < 0 ||
        !finite(value.minQty) || value.minQty < 0 ||
        !finite(value.tickSize) || value.tickSize < 0 ||
        !finite(value.minNotional) || value.minNotional < 0
      ) continue;
      nextFilters.set(key, value);
    }
    for (const p of pairs.slice(0, MAX_MARKET_SYMBOLS * 2)) {
      if (nextFeatures.size >= MAX_MARKET_SYMBOLS) break;
      const filter = nextFilters.get(p.symbol);
      if (!validSymbol(p.symbol) || !filter || nextFeatures.has(p.symbol)) continue;
      nextFeatures.set(p.symbol, {
        symbol: p.symbol,
        base: filter.base,
        spotLast: null,
        spotOpen24h: null,
        spotHigh24h: null,
        spotLow24h: null,
        spotQuoteVol24h: null,
        perpMark: null,
        perpIndexPrice: null,
        fundingRate: null,
        nextFundingTime: null,
        openInterest: null,
        openInterestUsd: null,
        openInterestChangePct: null,
        openInterestObservedAt: null,
        openInterestReceivedAt: null,
        openInterestBaselineUsd: null,
        openInterestBaselineObservedAt: null,
        openInterestBaselineReceivedAt: null,
        openInterestLastObservedAt: null,
        openInterestLastObservedValue: null,
        openInterestLastReceivedAt: null,
      });
    }
    // A managed timeout/stop may invalidate an in-flight public REST read. Its
    // eventual settlement is harmless: only the currently admitted generation
    // may publish the fully built universe, and publication is one atomic turn.
    if (initGeneration !== this.initGeneration) return;
    this.filters.clear();
    for (const [symbol, filter] of nextFilters) this.filters.set(symbol, filter);
    this.features.clear();
    for (const [symbol, feature] of nextFeatures) this.features.set(symbol, feature);
    this.reconcileSymbolState();
  }

  start(): void {
    this.assertPublicSourceStartupEgressAdmitted();
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    const onStatus = (name: string, status: FeedStatus) => {
      this.observeFeedStatus(name, status, generation);
    };

    const spotStream = this.streamFactory(
      'spot-miniticker',
      'wss://stream.binance.com:443/ws/!miniTicker@arr',
      (data) => this.onSpotMiniTickers(data, generation),
      onStatus
    );
    // NOTE: futures WS moved to tiered hosts in 2026 (/public, /market, /private).
    // Legacy wss://fstream.binance.com/ws/... opens but sends NO data since 2026-04-23.
    const markStream = this.streamFactory(
      'futures-markprice',
      'wss://fstream.binance.com/market/ws/!markPrice@arr@1s',
      (data) => this.onMarkPrices(data, generation),
      onStatus
    );
    const liquidationStream = this.streamFactory(
      'futures-liquidations',
      'wss://fstream.binance.com/market/ws/!forceOrder@arr',
      (data) => this.onLiquidationFrame(data, generation),
      onStatus
    );

    this.streams = new Map([
      [spotStream.name, spotStream],
      [markStream.name, markStream],
      [liquidationStream.name, liquidationStream],
    ]);
    try {
      this.liquidationProjection?.start();
      for (const [name, stream] of this.streams) {
        const sourceId = name === 'spot-miniticker' ? 'public-spot-source' : 'public-usdm-source';
        if (!this.isolatedSources.has(sourceId)) stream.start();
      }
    } catch (error) {
      for (const stream of this.streams.values()) stream.stop();
      this.liquidationProjection?.stop();
      this.streams.clear();
      this.running = false;
      ++this.generation;
      throw error;
    }

    this.sampler = setInterval(() => {
      if (!this.isActive(generation)) return;
      for (const sym of this.filters.keys()) {
        const p = this.spotPrices.get(sym);
        if (p === undefined) continue;
        let h = this.history.get(sym);
        if (!h) {
          h = [];
          this.history.set(sym, h);
        }
        h.push(p);
        if (h.length > SPARK_CAP) h.shift();
      }
    }, SPARK_MS);

    void this.refreshOpenInterestSlice(OI_SLICE_SIZE * 2, generation).catch((error) => {
      this.safeLog('error_event', null, {
        source: 'market-engine.open-interest',
        message: error instanceof Error ? error.message : String(error),
      });
    });
    this.oiTimer = setInterval(() => {
      void this.refreshOpenInterestSlice(OI_SLICE_SIZE, generation).catch((error) => {
        this.safeLog('error_event', null, {
          source: 'market-engine.open-interest',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, OI_REFRESH_MS);
  }

  stop(): void {
    // Invalidate public-universe reads even when start() has not yet activated.
    ++this.initGeneration;
    this.requeueOpenInterestInFlight();
    this.oiInFlight = null;
    if (!this.running) {
      this.clearAllOpenInterest();
      return;
    }
    this.closeLiquidationEvidence(this.clock.nowMs());
    this.running = false;
    ++this.generation;
    for (const s of this.streams.values()) s.stop();
    this.streams.clear();
    this.liquidationProjection?.stop();
    if (this.sampler) clearInterval(this.sampler);
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.sampler = null;
    this.oiTimer = null;
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.clearAllOpenInterest();
  }

  private sourceStreamNames(sourceId: MarketPublicSourceId): readonly string[] {
    return sourceId === 'public-spot-source'
      ? Object.freeze(['spot-miniticker'])
      : Object.freeze(['futures-markprice', 'futures-liquidations']);
  }

  private observeFeedStatus(name: string, status: FeedStatus, generation: number): void {
    if (!this.isActive(generation)) return;
    const prev = this.feeds[name];
    if (name === 'futures-liquidations') {
      this.liquidationProjection?.observeSourceStatus(status);
      this.observeLiquidationEvidenceStatus(prev, status);
    }
    this.feeds[name] = status;
    if (name === 'futures-markprice' && status !== 'open') {
      // Mark price is the valuation owner for USD-denominated OI. A known
      // transport loss invalidates both an in-flight REST slice and every
      // previously valued OI row immediately. Clearing the mark timestamps
      // forces recovery to observe a post-loss mark before a fresh OI sample
      // can establish a new baseline.
      this.requeueOpenInterestInFlight();
      this.oiInFlight = null;
      this.markUpdatedAt.clear();
      this.clearAllOpenInterest();
    }
    if (prev !== status && status !== 'connecting') {
      const event = status === 'open'
        ? 'ws.open'
        : status === 'cooldown'
          ? 'ws.cooldown'
          : status === 'exhausted'
            ? 'ws.exhausted'
            : 'ws.closed';
      this.safeLog(event, null, { feed: name, status });
    }
    if (status === 'exhausted') this.scheduleSourceRecovery(name, generation);
    if (status === 'open') this.clearSourceRecovery(name); // a healthy feed resets the escalation
  }

  private streamSourceId(name: string): MarketPublicSourceId {
    return name === 'spot-miniticker' ? 'public-spot-source' : 'public-usdm-source';
  }

  // One bounded supervisory campaign per exhausted feed. Safety properties:
  // never resurrects a stopped engine (isActive + running), never fights the
  // operator (isolated sources are skipped, preserving the
  // restartPublicSource contract), never stacks campaigns (one timer per
  // feed), and self-limits (exponential to the 15-minute ceiling). Every
  // rearm is ledgered as ws.rearm so recovery attempts stay attributable.
  private scheduleSourceRecovery(name: string, generation: number): void {
    if (this.recoveryTimers.has(name)) return;
    const attempt = (this.recoveryAttempts.get(name) ?? 0) + 1;
    this.recoveryAttempts.set(name, attempt);
    const base = Math.min(this.sourceRecoveryBaseMs * 2 ** (attempt - 1), SOURCE_RECOVERY_MAX_MS);
    const delay = Math.max(1, Math.round(base * (1 + ((this.random() * 2) - 1) * SOURCE_RECOVERY_JITTER_RATIO)));
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(name);
      if (!this.isActive(generation) || !this.running) return;
      if (this.isolatedSources.has(this.streamSourceId(name))) return;
      if (this.feeds[name] !== 'exhausted') return;
      const stream = this.streams.get(name);
      if (!stream) return;
      this.safeLog('ws.rearm', null, { feed: name, attempt, delayMs: delay });
      stream.stop();  // required: BinanceStream.start() no-ops while not stopped
      stream.start(); // one fresh bounded campaign
      this.scheduleSourceRecovery(name, generation); // keep escalating until 'open' clears it
    }, delay);
    timer.unref?.();
    this.recoveryTimers.set(name, timer);
  }

  private clearSourceRecovery(name: string): void {
    const timer = this.recoveryTimers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.recoveryTimers.delete(name);
    this.recoveryAttempts.delete(name);
  }

  readPublicSourceControl(sourceId: MarketPublicSourceId): Readonly<{
    lifecycle: MarketPublicSourceLifecycle;
    generation: number;
  }> {
    if (sourceId !== 'public-spot-source' && sourceId !== 'public-usdm-source') {
      throw new TypeError('public source control target is invalid');
    }
    if (this.isolatedSources.has(sourceId)) {
      return Object.freeze({ lifecycle: 'ISOLATED' as const, generation: this.sourceControlGenerations[sourceId] });
    }
    if (!this.running) return Object.freeze({ lifecycle: 'STOPPED' as const, generation: this.sourceControlGenerations[sourceId] });
    const statuses = this.sourceStreamNames(sourceId).map((name) => this.feeds[name] ?? 'closed');
    const lifecycle: MarketPublicSourceLifecycle = statuses.every((status) => status === 'open')
      ? 'LIVE'
      : statuses.some((status) => status === 'exhausted')
        ? 'FAILED'
        : statuses.some((status) => status === 'connecting')
          ? 'WARMING'
          : 'DEGRADED';
    return Object.freeze({ lifecycle, generation: this.sourceControlGenerations[sourceId] });
  }

  isolatePublicSource(sourceId: MarketPublicSourceId): void {
    if (!this.running) throw new Error('PUBLIC_SOURCE_RUNTIME_NOT_RUNNING');
    if (this.isolatedSources.has(sourceId)) return;
    const streams = this.sourceStreamNames(sourceId).map((name) => this.streams.get(name));
    if (streams.some((stream) => stream === undefined)) throw new Error('PUBLIC_SOURCE_STREAM_NOT_CONFIGURED');
    if (sourceId === 'public-usdm-source') this.requeueOpenInterestInFlight();
    for (const stream of streams) stream?.stop();
    this.isolatedSources.add(sourceId);
    this.sourceControlGenerations[sourceId] += 1;
    if (sourceId === 'public-usdm-source') this.clearAllOpenInterest();
  }

  restartPublicSource(sourceId: MarketPublicSourceId): void {
    if (!this.running) throw new Error('PUBLIC_SOURCE_RUNTIME_NOT_RUNNING');
    if (!this.isolatedSources.has(sourceId)) throw new Error('PUBLIC_SOURCE_NOT_ISOLATED');
    const streams = this.sourceStreamNames(sourceId).map((name) => this.streams.get(name));
    if (streams.some((stream) => stream === undefined)) throw new Error('PUBLIC_SOURCE_STREAM_NOT_CONFIGURED');
    this.isolatedSources.delete(sourceId);
    this.sourceControlGenerations[sourceId] += 1;
    for (const stream of streams) stream?.start();
  }

  private assertPublicSourceStartupEgressAdmitted(): void {
    if (this.startupOptions.publicSourceStartupEgressAdmitted !== true) {
      throw new Error('PUBLIC_SOURCE_STARTUP_EGRESS_NOT_ADMITTED');
    }
  }

  sparkOf(symbol: string, points = 40): number[] {
    if (!validSymbol(symbol) || !this.filters.has(symbol)) return [];
    const safePoints = Number.isSafeInteger(points) ? Math.max(2, Math.min(points, SPARK_CAP)) : 40;
    const h = this.history.get(symbol);
    if (!h || h.length < 2) return [];
    if (h.length <= safePoints) return [...h];
    const out: number[] = [];
    for (let i = 0; i < safePoints; i++) {
      out.push(h[Math.round((i / (safePoints - 1)) * (h.length - 1))]);
    }
    return out;
  }

  /** Spot price of any USDT symbol (e.g. for balance valuation). */
  priceOf(symbol: string): number | null {
    if (!this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotPrices.get(symbol) ?? null;
  }

  /** Timestamp paired with priceOf(), used to prove live order-price freshness. */
  priceUpdatedAt(symbol: string): number | null {
    if (!validSymbol(symbol) || !this.filters.has(symbol) || !this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotUpdatedAt.get(symbol) ?? null;
  }

  /** Exchange event timestamp paired with the current mark/funding values. */
  markEventTimestamp(symbol: string): number | null {
    if (!validSymbol(symbol) || !this.features.has(symbol) || !this.hasFreshUpdate(this.markUpdatedAt, symbol)) return null;
    return this.markUpdatedAt.get(symbol) ?? null;
  }

  /** Latest accepted sampled force-order transaction time from this owner. */
  liquidationEventTimestamp(symbol: string): number | null {
    if (!validSymbol(symbol) || !this.features.has(symbol) || !this.running
        || this.feeds['futures-liquidations'] !== 'open') return null;
    const now = this.clock.nowMs();
    const timestamp = this.liquidationUpdatedAt.get(symbol);
    return timestamp !== undefined && validEventTime(timestamp, now, LIQUIDATION_WINDOW_MS)
      ? timestamp
      : null;
  }

  setLiquidationEvidenceObserver(observer: MarketLiquidationEvidenceObserver | null): void {
    if (observer !== null && typeof observer !== 'function') {
      throw new TypeError('liquidation evidence observer must be a function or null');
    }
    this.liquidationEvidenceObserver = observer;
    if (observer !== null && this.running && this.feeds['futures-liquidations'] === 'open'
        && !this.liquidationEvidenceOpen) {
      this.openLiquidationEvidence();
    }
  }

  changeOf(symbol: string): number | null {
    if (!this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotChange.get(symbol) ?? null;
  }

  private onSpotMiniTickers(data: unknown, generation: number): void {
    if (!this.isActive(generation) || !Array.isArray(data)) return;
    const now = this.clock.nowMs();
    for (const raw of data.slice(0, MAX_MARKET_SYMBOLS)) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as SpotMiniTicker;
      if (!validSymbol(t.s) || !this.filters.has(t.s) || !validEventTime(t.E, now)) continue;
      const previousTs = this.spotUpdatedAt.get(t.s);
      if (previousTs !== undefined && t.E < previousTs) continue;
      const last = Number(t.c);
      const open = Number(t.o);
      const high = Number(t.h);
      const low = Number(t.l);
      const quoteVolume = Number(t.q);
      if (
        !positive(last) || !positive(open) || !positive(high) || !positive(low) ||
        !finite(quoteVolume) || quoteVolume < 0 || low > high || last < low || last > high
      ) continue;
      this.spotUpdatedAt.set(t.s, t.E);
      this.spotPrices.set(t.s, last);
      this.spotChange.set(t.s, ((last - open) / open) * 100);
      this.spotVol.set(t.s, quoteVolume);
      this.spotRange.set(t.s, { high, low });
      const f = this.features.get(t.s);
      if (!f) continue;
      f.spotLast = last;
      f.spotOpen24h = open;
      f.spotHigh24h = high > 0 ? high : null;
      f.spotLow24h = low > 0 ? low : null;
      f.spotQuoteVol24h = quoteVolume;
    }
  }

  private onMarkPrices(data: unknown, generation: number): void {
    if (!this.isActive(generation) || this.feeds['futures-markprice'] !== 'open' || !Array.isArray(data)) return;
    const now = this.clock.nowMs();
    for (const raw of data.slice(0, MAX_MARKET_SYMBOLS)) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as MarkPriceUpdate;
      if (!validSymbol(m.s) || !validEventTime(m.E, now)) continue;
      const f = this.features.get(m.s);
      if (!f) continue;
      const previousTs = this.markUpdatedAt.get(m.s);
      if (previousTs !== undefined && m.E < previousTs) continue;
      const mark = Number(m.p);
      if (!positive(mark)) continue;
      this.markUpdatedAt.set(m.s, m.E);
      f.perpMark = mark;
      const indexPrice = m.i === undefined ? Number.NaN : Number(m.i);
      f.perpIndexPrice = positive(indexPrice) ? indexPrice : null;
      const fundingRate = m.r === undefined ? Number.NaN : Number(m.r);
      f.fundingRate = finite(fundingRate) && Math.abs(fundingRate) <= 1 ? fundingRate : null;
      f.nextFundingTime = m.T !== undefined && Number.isSafeInteger(m.T) && m.T >= 0 ? m.T : null;
    }
  }

  private onLiquidationFrame(data: unknown, generation: number): void {
    if (!this.isActive(generation) || this.feeds['futures-liquidations'] !== 'open') return;
    this.onForceOrders(data);
  }

  private onForceOrders(data: unknown): void {
    const payload = (data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data) as unknown;
    const updates = (Array.isArray(payload) ? payload : [payload]).slice(0, 1_000);
    const now = this.clock.nowMs();
    for (const raw of updates) {
      if (!raw || typeof raw !== 'object') continue;
      const ev = raw as ForceOrderUpdate;
      const o = ev.o;
      if (ev.e !== 'forceOrder' || ev.st !== 1 || !o || !validSymbol(o.s)
          || ev.ps !== o.s || !this.features.has(o.s)
          || (o.S !== 'BUY' && o.S !== 'SELL') || o.X !== 'FILLED'
          || typeof o.o !== 'string' || o.o.length < 1 || o.o.length > 32
          || typeof o.f !== 'string' || o.f.length < 1 || o.f.length > 32) continue;
      // Conservatively admit completed liquidation-order snapshots only. The
      // executed notional is accumulated filled quantity `z` multiplied by
      // average fill price `ap`; `l` is only the final fill.
      const qty = Number(o.z);
      const price = Number(o.ap);
      const originalQty = Number(o.q);
      if (!(qty > 0) || !(price > 0) || !(originalQty > 0) || qty > originalQty) continue;
      const ts = Number(o.T);
      if (!validEventTime(ev.E, now, LIQUIDATION_WINDOW_MS)
          || !validEventTime(ts, now, LIQUIDATION_WINDOW_MS)
          || Number(ev.E) < ts) continue;
      const previousTs = this.liquidationUpdatedAt.get(o.s);
      if (previousTs !== undefined && ts <= previousTs) continue;
      const notional = qty * price;
      if (!positive(notional)) continue;
      const side = o.S === 'SELL' ? 'LONG' : 'SHORT';
      const sourceEventKey = `${o.s}:${ev.ps}:${ev.E}:${ts}:${o.S}:${originalQty}:${qty}:${price}`;
      const rows = this.liquidations.get(o.s) ?? [];
      rows.push({ ts, side, notional });
      this.liquidations.set(o.s, this.pruneLiquidations(rows));
      this.liquidationUpdatedAt.set(o.s, ts);
      this.liquidationProjection?.ingestPrint(Object.freeze({
        symbol: o.s,
        side,
        notionalUsd: notional,
        eventTimeMs: ts,
        sourceEventKey,
      }));
      this.publishLiquidationEvidence(Object.freeze({
        kind: 'FORCE_ORDER' as const,
        generation: this.liquidationEvidenceGeneration,
        revision: this.nextLiquidationEvidenceRevision(),
        receivedAtMs: now,
        // Each sampled force-order row is itself the current latest-per-symbol
        // snapshot. This lets a reconstructed consumer bootstrap from the next
        // physical event without pretending the sampled stream is contiguous.
        bootstrap: 'CURRENT_SNAPSHOT' as const,
        baseAsset: this.features.get(o.s)?.base ?? o.s,
        raw: Object.freeze({
          e: 'forceOrder' as const,
          E: Number(ev.E),
          st: 1 as const,
          ps: o.s,
          o: Object.freeze({
            s: o.s,
            S: o.S,
            o: o.o,
            f: o.f,
            q: o.q,
            ap: o.ap as string,
            z: o.z as string,
            X: 'FILLED' as const,
            T: ts,
          }),
        }),
      }));
    }
  }

  private observeLiquidationEvidenceStatus(previous: FeedStatus | undefined, status: FeedStatus): void {
    if (status === 'open' && previous !== 'open') {
      // A new physical generation has no current sampled row until its first
      // accepted force-order snapshot. Retained 15-minute history stays in the
      // projection, but it cannot impersonate a new-generation observation.
      this.liquidationUpdatedAt.clear();
      this.openLiquidationEvidence();
      return;
    }
    if (status !== 'open' && previous === 'open') {
      this.closeLiquidationEvidence(this.clock.nowMs());
      this.liquidationUpdatedAt.clear();
    }
  }

  private openLiquidationEvidence(): void {
    if (this.liquidationEvidenceOpen) return;
    if (this.liquidationEvidenceGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('liquidation evidence generation exhausted');
    }
    this.liquidationEvidenceGeneration += 1;
    this.liquidationEvidenceRevision = 0;
    this.liquidationEvidenceOpen = true;
  }

  private closeLiquidationEvidence(observedAtMs: number): void {
    if (!this.liquidationEvidenceOpen || this.liquidationEvidenceGeneration < 1) return;
    this.liquidationEvidenceOpen = false;
    this.publishLiquidationEvidence(Object.freeze({
      kind: 'SOURCE_CLOSED' as const,
      generation: this.liquidationEvidenceGeneration,
      revision: this.nextLiquidationEvidenceRevision(),
      observedAtMs,
    }));
  }

  private nextLiquidationEvidenceRevision(): number {
    if (this.liquidationEvidenceRevision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('liquidation evidence revision exhausted');
    }
    this.liquidationEvidenceRevision += 1;
    return this.liquidationEvidenceRevision;
  }

  private publishLiquidationEvidence(
    cut: Readonly<MarketLiquidationEvidenceCut | MarketLiquidationSourceClosedCut>,
  ): void {
    if (this.liquidationEvidenceObserver === null || cut.generation < 1) return;
    try {
      this.liquidationEvidenceObserver(cut);
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'market-engine.liquidation-evidence-observer',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private pruneLiquidations(rows: LiquidationPrint[], now = this.clock.nowMs()): LiquidationPrint[] {
    const minTs = now - LIQUIDATION_WINDOW_MS;
    return rows.filter((r) => r.ts >= minTs);
  }

  private liquidationStats(symbol: string): {
    liquidations15mUsd: number | null;
    longLiquidations15mUsd: number | null;
    shortLiquidations15mUsd: number | null;
  } {
    const rows = this.pruneLiquidations(this.liquidations.get(symbol) ?? []);
    if (rows.length === 0) {
      this.liquidations.delete(symbol);
      return { liquidations15mUsd: null, longLiquidations15mUsd: null, shortLiquidations15mUsd: null };
    }
    this.liquidations.set(symbol, rows);
    let long = 0;
    let short = 0;
    for (const r of rows) {
      if (r.side === 'LONG') long += r.notional;
      else short += r.notional;
    }
    return {
      liquidations15mUsd: long + short,
      longLiquidations15mUsd: long || null,
      shortLiquidations15mUsd: short || null,
    };
  }

  private async refreshOpenInterestSlice(size = OI_SLICE_SIZE, generation = this.generation): Promise<void> {
    if (
      !this.isActive(generation) || this.features.size === 0 ||
      this.isolatedSources.has('public-usdm-source') ||
      this.feeds['futures-markprice'] !== 'open'
    ) {
      this.clearAllOpenInterest();
      return;
    }
    const sourceGeneration = this.sourceControlGenerations['public-usdm-source'];
    if (
      this.oiInFlight?.engineGeneration === generation &&
      this.oiInFlight.sourceGeneration === sourceGeneration
    ) return;
    this.oiRefreshToken = this.oiRefreshToken === Number.MAX_SAFE_INTEGER ? 1 : this.oiRefreshToken + 1;
    const refreshToken = this.oiRefreshToken;
    const cursorStart = this.oiCursor;
    this.oiInFlight = Object.freeze({
      token: refreshToken,
      engineGeneration: generation,
      sourceGeneration,
      cursorStart,
    });
    try {
      const symbols = [...this.features.keys()];
      const slice: string[] = [];
      const safeSize = Number.isSafeInteger(size) ? Math.max(1, Math.min(size, symbols.length)) : OI_SLICE_SIZE;
      for (let i = 0; i < safeSize; i++) {
        slice.push(symbols[(this.oiCursor + i) % symbols.length]);
      }
      this.oiCursor = (this.oiCursor + slice.length) % symbols.length;
      let sourceUnavailable = false;
      const results = await Promise.allSettled(
        slice.map(async (symbol) => {
          const f = this.features.get(symbol);
          if (!f) return;
          const current = () => (
            !sourceUnavailable &&
            this.isCurrentOpenInterestRefresh(refreshToken, generation, sourceGeneration, symbol, f)
          );
          try {
            const oi = await this.openInterestFetcher(symbol);
            if (!current()) return;
            const sampleSymbol = oi.symbol;
            if (!current()) return;
            const sampleOpenInterest = oi.openInterest;
            if (!current()) return;
            const sampleObservedAt = oi.time;
            if (!current()) return;
            const receivedAt = this.clock.nowMs();
            if (!current()) return;
            if (
              sampleSymbol !== symbol || !finite(sampleOpenInterest) || sampleOpenInterest < 0 ||
              !validEventTime(sampleObservedAt, receivedAt, this.openInterestTtlMs) ||
              sampleObservedAt > receivedAt ||
              (f.openInterestLastReceivedAt !== null && receivedAt < f.openInterestLastReceivedAt)
            ) {
              this.clearOpenInterest(f);
              return;
            }
            if (f.openInterestLastObservedAt !== null) {
              if (sampleObservedAt < f.openInterestLastObservedAt) {
                this.clearOpenInterest(f);
                return;
              }
              if (sampleObservedAt === f.openInterestLastObservedAt) {
                if (sampleOpenInterest !== f.openInterestLastObservedValue) this.clearOpenInterest(f);
                return;
              }
            }
            if (!current()) return;
            f.openInterestLastObservedAt = sampleObservedAt;
            f.openInterestLastObservedValue = sampleOpenInterest;
            f.openInterestLastReceivedAt = receivedAt;
            if (!this.hasFreshUpdate(this.markUpdatedAt, symbol, receivedAt)) {
              this.clearOpenInterest(f);
              return;
            }
            const mark = f.perpMark;
            const openInterestUsd = positive(mark) ? sampleOpenInterest * mark : null;
            if (openInterestUsd === null || !finite(openInterestUsd)) {
              this.clearOpenInterest(f);
              return;
            }
            const baselineFresh = this.hasFreshOpenInterestBaseline(f, receivedAt);
            const changePct = baselineFresh && positive(f.openInterestBaselineUsd)
              ? ((openInterestUsd - f.openInterestBaselineUsd) / f.openInterestBaselineUsd) * 100
              : null;
            if (!current()) return;
            f.openInterest = sampleOpenInterest;
            f.openInterestUsd = openInterestUsd;
            f.openInterestChangePct = finite(changePct) ? changePct : null;
            f.openInterestObservedAt = sampleObservedAt;
            f.openInterestReceivedAt = receivedAt;
            f.openInterestBaselineUsd = openInterestUsd;
            f.openInterestBaselineObservedAt = sampleObservedAt;
            f.openInterestBaselineReceivedAt = receivedAt;
          } catch (error) {
            if (current()) {
              sourceUnavailable = true;
              this.oiCursor = cursorStart;
              this.clearAllOpenInterest();
              throw error;
            }
            return;
          }
        })
      );
      const failures = results.filter((result) => result.status === 'rejected').length;
      if (failures > 0) {
        if (!this.isCurrentOpenInterestRefresh(refreshToken, generation, sourceGeneration)) return;
        this.oiCursor = cursorStart;
        this.clearAllOpenInterest();
        throw new Error(`OPEN_INTEREST_SOURCE_UNAVAILABLE:${failures}`);
      }
    } finally {
      if (this.oiInFlight?.token === refreshToken) this.oiInFlight = null;
    }
  }

  private isActive(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private isCurrentOpenInterestRefresh(
    refreshToken: number,
    generation: number,
    sourceGeneration: number,
    symbol?: string,
    feature?: FeatureEntry,
  ): boolean {
    return (
      this.isActive(generation) &&
      this.sourceControlGenerations['public-usdm-source'] === sourceGeneration &&
      !this.isolatedSources.has('public-usdm-source') &&
      this.feeds['futures-markprice'] === 'open' &&
      this.oiInFlight?.token === refreshToken &&
      (symbol === undefined || (feature !== undefined && this.features.get(symbol) === feature))
    );
  }

  private requeueOpenInterestInFlight(): void {
    if (this.oiInFlight !== null) this.oiCursor = this.oiInFlight.cursorStart;
  }

  private safeLog(kind: string, symbol: string | null, payload: Record<string, unknown>): void {
    try {
      this.ledger.logEvent(kind, symbol, payload);
    } catch {
      // Market data must keep flowing even when observability storage is
      // temporarily unavailable.
    }
  }

  private reconcileSymbolState(): void {
    const spotSymbols = new Set(this.filters.keys());
    const perpSymbols = new Set(this.features.keys());
    const pruneMap = <T>(map: Map<string, T>, allowed: ReadonlySet<string>) => {
      for (const symbol of map.keys()) if (!allowed.has(symbol)) map.delete(symbol);
    };
    pruneMap(this.spotPrices, spotSymbols);
    pruneMap(this.spotChange, spotSymbols);
    pruneMap(this.spotVol, spotSymbols);
    pruneMap(this.spotRange, spotSymbols);
    pruneMap(this.history, spotSymbols);
    pruneMap(this.spotUpdatedAt, spotSymbols);
    pruneMap(this.liquidations, perpSymbols);
    pruneMap(this.markUpdatedAt, perpSymbols);
    pruneMap(this.liquidationUpdatedAt, perpSymbols);
  }

  private clearOpenInterest(feature: FeatureEntry): void {
    feature.openInterest = null;
    feature.openInterestUsd = null;
    feature.openInterestChangePct = null;
    feature.openInterestObservedAt = null;
    feature.openInterestReceivedAt = null;
    feature.openInterestBaselineUsd = null;
    feature.openInterestBaselineObservedAt = null;
    feature.openInterestBaselineReceivedAt = null;
  }

  private clearAllOpenInterest(): void {
    for (const feature of this.features.values()) this.clearOpenInterest(feature);
  }

  private hasFreshOpenInterestBaseline(feature: FeatureEntry, now: number): boolean {
    return (
      feature.openInterestBaselineObservedAt !== null &&
      feature.openInterestBaselineReceivedAt !== null &&
      feature.openInterestBaselineObservedAt <= now + MAX_FUTURE_SKEW_MS &&
      feature.openInterestBaselineReceivedAt <= now &&
      now - feature.openInterestBaselineObservedAt <= this.openInterestTtlMs &&
      now - feature.openInterestBaselineReceivedAt <= this.openInterestTtlMs
    );
  }

  private readOpenInterest(feature: FeatureEntry, now: number): Readonly<{
    openInterest: number | null;
    openInterestUsd: number | null;
    openInterestChangePct: number | null;
    openInterestUpdatedAt: number | null;
  }> {
    const fresh = (
      this.running && !this.isolatedSources.has('public-usdm-source') &&
      this.feeds['futures-markprice'] === 'open' &&
      feature.openInterest !== null && feature.openInterestUsd !== null &&
      feature.openInterestObservedAt !== null && feature.openInterestReceivedAt !== null &&
      feature.openInterestObservedAt <= now + MAX_FUTURE_SKEW_MS &&
      feature.openInterestReceivedAt <= now &&
      now - feature.openInterestObservedAt <= this.openInterestTtlMs &&
      now - feature.openInterestReceivedAt <= this.openInterestTtlMs &&
      this.hasFreshUpdate(this.markUpdatedAt, feature.symbol, now)
    );
    if (!fresh) {
      this.clearOpenInterest(feature);
      return Object.freeze({
        openInterest: null,
        openInterestUsd: null,
        openInterestChangePct: null,
        openInterestUpdatedAt: null,
      });
    }
    return Object.freeze({
      openInterest: feature.openInterest,
      openInterestUsd: feature.openInterestUsd,
      openInterestChangePct: feature.openInterestChangePct,
      openInterestUpdatedAt: feature.openInterestObservedAt,
    });
  }

  private hasFreshUpdate(updates: ReadonlyMap<string, number>, symbol: string, now = this.clock.nowMs()): boolean {
    const updatedAt = updates.get(symbol);
    return updatedAt !== undefined && updatedAt <= now + MAX_FUTURE_SKEW_MS && now - updatedAt <= MARKET_EVENT_MAX_AGE_MS;
  }

  /**
   * The full tradable USDT universe: every spot+perp pair (with basis/funding)
   * PLUS spot-only symbols — "do not miss symbols". The scanner keeps using
   * rows() (pairs only); this feeds the Markets page.
   */
  allRows(): (SymbolRow & { hasSpot: boolean; hasPerp: boolean })[] {
    const out: (SymbolRow & { hasSpot: boolean; hasPerp: boolean })[] = this.rows().map((r) => ({
      ...r,
      hasSpot: true,
      hasPerp: true,
    }));
    const now = this.clock.nowMs();
    for (const [sym, f] of this.filters) {
      if (this.features.has(sym)) continue;
      const spotFresh = this.hasFreshUpdate(this.spotUpdatedAt, sym, now);
      const last = spotFresh ? this.spotPrices.get(sym) : undefined;
      out.push({
        symbol: sym,
        base: f.base,
        spot: last ?? null,
        perpIndexPrice: null,
        markIndexBasisPct: null,
        perpMark: null,
        basisPct: null,
        openInterest: null,
        openInterestUsd: null,
        openInterestChangePct: null,
        openInterestUpdatedAt: null,
        liquidations15mUsd: null,
        longLiquidations15mUsd: null,
        shortLiquidations15mUsd: null,
        fundingRate: null,
        nextFundingTime: null,
        change24hPct: spotFresh ? this.spotChange.get(sym) ?? null : null,
        quoteVolume24h: spotFresh ? this.spotVol.get(sym) ?? null : null,
        high24h: spotFresh ? this.spotRange.get(sym)?.high ?? null : null,
        low24h: spotFresh ? this.spotRange.get(sym)?.low ?? null : null,
        status: 'idle',
        hasSpot: true,
        hasPerp: false,
      });
    }
    return out;
  }

  rows(): SymbolRow[] {
    const out: SymbolRow[] = [];
    const now = this.clock.nowMs();
    for (const f of this.features.values()) {
      const spotFresh = this.hasFreshUpdate(this.spotUpdatedAt, f.symbol, now);
      const markFresh = this.hasFreshUpdate(this.markUpdatedAt, f.symbol, now);
      const spotLast = spotFresh ? f.spotLast : null;
      const spotOpen = spotFresh ? f.spotOpen24h : null;
      const perpMark = markFresh ? f.perpMark : null;
      const perpIndexPrice = markFresh ? f.perpIndexPrice : null;
      const openInterest = this.readOpenInterest(f, now);
      const liq = this.liquidationStats(f.symbol);
      out.push({
        symbol: f.symbol,
        base: f.base,
        spot: spotLast,
        perpMark,
        perpIndexPrice,
        markIndexBasisPct:
          perpMark !== null && perpIndexPrice !== null && perpIndexPrice > 0
            ? ((perpMark - perpIndexPrice) / perpIndexPrice) * 100
            : null,
        basisPct:
          spotLast !== null && perpMark !== null && spotLast > 0
            ? ((perpMark - spotLast) / spotLast) * 100
            : null,
        openInterest: openInterest.openInterest,
        openInterestUsd: openInterest.openInterestUsd,
        openInterestChangePct: openInterest.openInterestChangePct,
        openInterestUpdatedAt: openInterest.openInterestUpdatedAt,
        liquidations15mUsd: liq.liquidations15mUsd,
        longLiquidations15mUsd: liq.longLiquidations15mUsd,
        shortLiquidations15mUsd: liq.shortLiquidations15mUsd,
        fundingRate: markFresh ? f.fundingRate : null,
        nextFundingTime: markFresh ? f.nextFundingTime : null,
        change24hPct:
          spotLast !== null && spotOpen !== null && spotOpen > 0
            ? ((spotLast - spotOpen) / spotOpen) * 100
            : null,
        quoteVolume24h: spotFresh ? f.spotQuoteVol24h : null,
        high24h: spotFresh ? f.spotHigh24h : null,
        low24h: spotFresh ? f.spotLow24h : null,
        status: 'idle',
      });
    }
    return out;
  }
}
