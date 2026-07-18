import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchAllBookTickers, fetchKlineCandles } from '../binance/rest.js';
import { mapAggTrade, type RawAggTrade } from '../engine/volume/adapters.js';
import type { VolumeConfig } from '../engine/volume/config.js';
import { VolumeEngine } from '../engine/volume/engine.js';
import { systemClock } from '../engine/v0/clock.js';
import { MAX_ENGINE_SYMBOLS, finite, isCanonicalSymbol, positive } from '../engine/volume/validation.js';
import type { Decision, EngineEvent, EngineProposal } from '../engine/v0/types.js';
import type { AppConfig } from '../types.js';
import { compareExactDecimals, normalizeNonNegativeExactDecimal } from '../capitalFoundation/contracts/index.js';
import type { Ledger } from '../ledger.js';

interface MarketUniverseRow {
  symbol: string;
  base: string;
  quoteVolume24h: number | null;
  hasSpot: boolean;
  hasPerp: boolean;
}

export interface VolumeRuntimeIntegrationSnapshot {
  /** Capture time only. Never use this field as source-observation freshness. */
  capturedAtMs: number;
  lastTickTs: number | null;
  config: VolumeConfig;
  decisions: Decision[];
  proposals: EngineProposal[];
}

const STREAM_CHUNK = 140;
const UNIVERSE_REFRESH_MS = 15 * 60_000;
const BOOK_REFRESH_MS = 2_750;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

export class VolumeRuntime {
  private readonly engine: VolumeEngine;
  private streams: BinanceStream[] = [];
  private streamStatus = new Map<string, FeedStatus>();
  private eligibleSymbols: string[] = [];
  private eligibleSymbolSet = new Set<string>();
  private symbolSetKey = '';
  private running = false;
  private generation = 0;
  private streamEpoch = 0;
  private startPromise: Promise<void> | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private bookTimer: NodeJS.Timeout | null = null;
  private universeTimer: NodeJS.Timeout | null = null;
  private streamRetryTimer: NodeJS.Timeout | null = null;
  private streamRetryMs = 1_000;
  private bookBusyGeneration: number | null = null;
  private warmingSymbols = new Map<string, number>();
  private seeded = new Set<string>();
  private baselineTotal = 0;
  private baselineCompleted = 0;
  private baselineFailed = 0;
  private baselineFailures = new Set<string>();
  private lastBookTs: number | null = null;
  private lastTradeTs: number | null = null;
  private symbolLastTradeTs = new Map<string, number>();
  private lastAggTradeId = new Map<string, number>();
  private tradeMessages = 0;
  private configKey = '';
  private persistedEventKeys = new Set<string>();
  private persistedEventOrder: string[] = [];
  private ledgerFailureCount = 0;

  constructor(
    private readonly ledger: Ledger,
    private readonly getConfig: () => AppConfig,
    private readonly getUniverse: () => MarketUniverseRow[],
  ) {
    this.engine = new VolumeEngine(systemClock, undefined, {
      emit: (event) => this.persistEvent(event),
    });
  }

  async start(): Promise<void> {
    if (this.running) return this.startPromise ?? Promise.resolve();
    const generation = ++this.generation;
    this.running = true;
    this.engine.start();
    const promise = this.startGeneration(generation);
    this.startPromise = promise;
    await promise;
    if (this.startPromise === promise) this.startPromise = null;
  }

  stop(): void {
    if (!this.running && !this.startPromise && !this.engine.isRunning()) return;
    ++this.generation;
    ++this.streamEpoch;
    this.running = false;
    this.startPromise = null;
    for (const stream of this.streams) stream.stop();
    this.streams = [];
    // A subsequent start() must rebuild sockets even when the eligible symbol
    // universe is unchanged. Keeping the old key left the runtime running with
    // zero streams after an operator-initiated recovery.
    this.streamStatus.clear();
    this.symbolSetKey = '';
    this.eligibleSymbols = [];
    this.eligibleSymbolSet.clear();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.bookTimer) clearInterval(this.bookTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.tickTimer = null;
    this.bookTimer = null;
    this.universeTimer = null;
    this.streamRetryTimer = null;
    this.streamRetryMs = 1_000;
    this.bookBusyGeneration = null;
    this.warmingSymbols.clear();
    this.engine.stop();
  }

  private async startGeneration(generation: number): Promise<void> {
    try {
      this.configKey = this.applyDynamicConfig();
      await this.refreshUniverse(generation);
      if (!this.isActive(generation)) return;
      this.tickTimer = setInterval(() => this.onTick(generation), this.engine.cfg.tickMs);
      this.bookTimer = setInterval(
        () => this.launch('book refresh', generation, () => this.refreshBooks(generation)),
        BOOK_REFRESH_MS,
      );
      this.universeTimer = setInterval(
        () => this.launch('universe refresh', generation, () => this.refreshUniverse(generation)),
        UNIVERSE_REFRESH_MS,
      );
      this.launch('initial book refresh', generation, () => this.refreshBooks(generation));
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.start',
        message: error instanceof Error ? error.message : String(error),
      });
      if (this.isActive(generation)) {
        this.stop();
      }
    }
  }

  private onTick(generation: number): void {
    if (!this.isActive(generation)) return;
    try {
      const previousKey = this.configKey;
      const nextKey = this.applyDynamicConfig();
      this.configKey = nextKey;
      if (nextKey !== previousKey) {
        this.launch('config universe refresh', generation, () => this.refreshUniverse(generation));
      }
      this.engine.tick();
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.tick',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  connectionStatus(): {
    running: boolean;
    streamState: 'starting' | 'open' | 'connecting' | 'degraded';
    streamConnections: number;
    openConnections: number;
    bookState: 'fresh' | 'stale';
    lastBookTs: number | null;
    lastTradeTs: number | null;
  } {
    const now = Date.now();
    const openConnections = [...this.streamStatus.values()].filter((status) => status === 'open').length;
    const streamState = this.streams.length === 0
      ? 'starting'
      : openConnections === this.streams.length
        ? 'open'
        : [...this.streamStatus.values()].some((status) => status === 'connecting')
          ? 'connecting'
          : 'degraded';
    return {
      running: this.running && this.engine.isRunning(),
      streamState,
      streamConnections: this.streams.length,
      openConnections,
      bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
      lastBookTs: this.lastBookTs,
      lastTradeTs: this.lastTradeTs,
    };
  }

  /**
   * Bounded, defensive read seam for system integration. It preserves the
   * engine's real proposal/correlation identity and raw tick time while
   * reusing the runtime's existing public Binance producers.
   */
  integrationSnapshot(): VolumeRuntimeIntegrationSnapshot {
    return structuredClone({
      capturedAtMs: Date.now(),
      lastTickTs: this.engine.lastTick(),
      config: this.engine.cfg,
      decisions: this.engine.decisions(2_000),
      proposals: this.engine.proposalStore.all().slice(-2_000),
    });
  }

  setIntakePaused(paused: boolean): boolean {
    return this.engine.setIntakePaused(paused);
  }

  intakePaused(): boolean {
    return this.engine.intakePaused();
  }

  operatorBlockedSymbols(): readonly string[] {
    return this.engine.operatorBlockedSymbols();
  }

  setOperatorSymbolBlocked(symbol: string, blocked: boolean): boolean {
    return this.engine.setOperatorSymbolBlocked(symbol, blocked);
  }

  symbolAllowedByPolicy(symbol: string): boolean {
    return this.engine.symbolAllowedByPolicy(symbol);
  }

  sizeCeiling(): string | null {
    try {
      return normalizeNonNegativeExactDecimal(String(this.engine.cfg.suggestedNotionalUsd));
    } catch {
      return null;
    }
  }

  setSizeCeiling(value: string): boolean {
    const canonical = normalizeNonNegativeExactDecimal(value);
    if (canonical !== value) throw new TypeError('volume size ceiling must be canonical');
    const numeric = Number(canonical);
    if (!Number.isFinite(numeric) || numeric <= 0 || String(numeric) !== canonical) {
      throw new RangeError('volume size ceiling cannot cross the legacy numeric boundary exactly');
    }
    const current = this.sizeCeiling();
    if (current === null || compareExactDecimals(canonical, normalizeNonNegativeExactDecimal(current)) > 0) {
      throw new RangeError('volume size ceiling is downward-only');
    }
    return this.engine.setSuggestedNotionalUsd(numeric);
  }

  private async refreshUniverse(generation: number): Promise<void> {
    if (!this.isActive(generation)) return;
    const config = this.readConfig();
    const threshold = config && positive(config.minQuoteVolume24h)
      ? config.minQuoteVolume24h
      : this.engine.cfg.minQuoteVolume24hUsd;
    const sourceRows: MarketUniverseRow[] = [];
    const seen = new Set<string>();
    let examined = 0;
    for (const row of this.getUniverse()) {
      if (++examined > MAX_ENGINE_SYMBOLS * 2) break;
      if (sourceRows.length >= MAX_ENGINE_SYMBOLS) break;
      if (!row.hasSpot || !isCanonicalSymbol(row.symbol) || seen.has(row.symbol)) continue;
      if (typeof row.base !== 'string' || row.base.length === 0 || row.base.length > 24) continue;
      seen.add(row.symbol);
      sourceRows.push(row);
    }
    const metas = sourceRows.map((row) => {
      const quoteVolume = finite(row.quoteVolume24h) && row.quoteVolume24h >= 0 ? row.quoteVolume24h : null;
      const eligible = quoteVolume !== null && quoteVolume >= threshold;
      return {
        symbol: row.symbol,
        base: row.base,
        quote: 'USDT',
        hasSpot: true,
        hasPerp: row.hasPerp,
        marginBorrowable: null,
        minNotionalUsd: null,
        tickSize: null,
        stepSize: null,
        quoteVolume24hUsd: quoteVolume,
        eligible,
        ineligibleReason: eligible
          ? null
          : quoteVolume === null
            ? '24h quote volume unavailable'
            : 'below volume universe floor',
      };
    });
    if (!this.isActive(generation)) return;
    this.engine.setUniverse(metas);

    const nextSymbols = metas.filter((meta) => meta.eligible).map((meta) => meta.symbol).sort();
    const nextKey = nextSymbols.join(',');
    this.eligibleSymbols = nextSymbols;
    this.eligibleSymbolSet = new Set(nextSymbols);
    for (const symbol of this.seeded) if (!this.eligibleSymbolSet.has(symbol)) this.seeded.delete(symbol);
    for (const symbol of this.symbolLastTradeTs.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.symbolLastTradeTs.delete(symbol);
    }
    for (const symbol of this.lastAggTradeId.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.lastAggTradeId.delete(symbol);
    }
    for (const symbol of this.warmingSymbols.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.warmingSymbols.delete(symbol);
    }
    for (const symbol of this.baselineFailures) {
      if (!this.eligibleSymbolSet.has(symbol)) this.baselineFailures.delete(symbol);
    }
    this.baselineTotal = nextSymbols.length;
    this.baselineCompleted = nextSymbols.filter((symbol) => this.seeded.has(symbol)).length;
    this.baselineFailed = this.baselineFailures.size;
    if (nextKey !== this.symbolSetKey) {
      try {
        this.restartTradeStreams(nextSymbols, generation);
        this.symbolSetKey = nextKey;
        this.clearStreamRetry();
      } catch (error) {
        this.scheduleStreamRetry(nextSymbols, nextKey, generation);
        throw error;
      }
    }
    this.launch(
      'baseline warmup',
      generation,
      () => this.warmBaselines(nextSymbols.filter((symbol) => !this.seeded.has(symbol)), generation),
    );
  }

  private restartTradeStreams(symbols: string[], generation: number): void {
    if (!this.isActive(generation)) return;
    const streamEpoch = ++this.streamEpoch;
    for (const stream of this.streams) stream.stop();
    this.streams = [];
    this.streamStatus.clear();
    const nextStreams: BinanceStream[] = [];
    for (const [index, group] of chunks(symbols, STREAM_CHUNK).entries()) {
      if (!group.length) continue;
      const names = group.map((symbol) => symbol.toLowerCase() + '@aggTrade').join('/');
      const stream = new BinanceStream(
        'volume-aggtrade-' + String(index + 1),
        'wss://stream.binance.com:9443/stream?streams=' + names,
        (data) => this.onTradeMessage(data, generation, streamEpoch),
        (name, status) => this.onStreamStatus(name, status, generation, streamEpoch),
      );
      nextStreams.push(stream);
    }
    try {
      for (const stream of nextStreams) stream.start();
      this.streams = nextStreams;
    } catch (error) {
      for (const stream of nextStreams) stream.stop();
      this.streamStatus.clear();
      throw error;
    }
  }

  private scheduleStreamRetry(symbols: string[], key: string, generation: number): void {
    if (!this.isActive(generation)) return;
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.streamRetryTimer = null;
    const delay = this.streamRetryMs;
    this.streamRetryMs = Math.min(this.streamRetryMs * 2, 30_000);
    this.streamRetryTimer = setTimeout(() => {
      this.streamRetryTimer = null;
      if (!this.isActive(generation) || key !== this.eligibleSymbols.join(',')) return;
      try {
        this.restartTradeStreams(symbols, generation);
        this.symbolSetKey = key;
        this.clearStreamRetry();
      } catch (error) {
        this.safeLog('error_event', null, {
          source: 'volume-runtime.stream-retry',
          message: error instanceof Error ? error.message : String(error),
        });
        this.scheduleStreamRetry(symbols, key, generation);
      }
    }, delay);
  }

  private clearStreamRetry(): void {
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.streamRetryTimer = null;
    this.streamRetryMs = 1_000;
  }

  private onTradeMessage(data: unknown, generation: number, streamEpoch: number): void {
    if (!this.isActive(generation) || streamEpoch !== this.streamEpoch) return;
    const raw = data && typeof data === 'object' && 'data' in data
      ? (data as { data: unknown }).data
      : data;
    if (!raw || typeof raw !== 'object' || (raw as { e?: string }).e !== 'aggTrade') return;
    const candidate = raw as Partial<RawAggTrade>;
    if (!isCanonicalSymbol(candidate.s) || !this.eligibleSymbolSet.has(candidate.s)) return;
    if (!Number.isSafeInteger(candidate.a) || (candidate.a as number) < 0) return;
    const previousId = this.lastAggTradeId.get(candidate.s);
    if (previousId !== undefined && (candidate.a as number) <= previousId) return;
    let mapped: ReturnType<typeof mapAggTrade>;
    try {
      mapped = mapAggTrade(raw as RawAggTrade);
    } catch {
      return;
    }
    if (!this.engine.onTrade(mapped.tick, mapped.printCount)) return;
    this.lastAggTradeId.set(mapped.tick.symbol, candidate.a as number);
    this.lastTradeTs = mapped.tick.ts;
    this.symbolLastTradeTs.set(mapped.tick.symbol, mapped.tick.ts);
    this.tradeMessages += 1;
  }

  private onStreamStatus(name: string, status: FeedStatus, generation: number, streamEpoch: number): void {
    if (!this.isActive(generation) || streamEpoch !== this.streamEpoch) return;
    const previous = this.streamStatus.get(name);
    this.streamStatus.set(name, status);
    if (previous === status || status === 'connecting') return;
    const event = status === 'open'
      ? 'ws.open'
      : status === 'cooldown'
        ? 'ws.cooldown'
        : status === 'exhausted'
          ? 'ws.exhausted'
          : 'ws.closed';
    this.safeLog(event, null, {
      feed: name,
      source: 'volume-runtime',
      status,
    });
  }

  private async refreshBooks(generation: number): Promise<void> {
    if (!this.isActive(generation) || this.bookBusyGeneration === generation) return;
    this.bookBusyGeneration = generation;
    try {
      if (!this.eligibleSymbols.length) {
        await this.refreshUniverse(generation);
        if (!this.isActive(generation) || !this.eligibleSymbols.length) return;
      }
      const books = await fetchAllBookTickers('spot');
      if (!this.isActive(generation)) return;
      const receivedTs = Date.now();
      let accepted = 0;
      for (const symbol of this.eligibleSymbols) {
        const book = books.get(symbol);
        if (!book) continue;
        if (this.engine.onBook({
          symbol,
          bid: book.bidPrice,
          ask: book.askPrice,
          bidQty: book.bidQty,
          askQty: book.askQty,
          ts: receivedTs,
        })) accepted += 1;
      }
      if (accepted > 0) this.lastBookTs = receivedTs;
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.book',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.bookBusyGeneration === generation) this.bookBusyGeneration = null;
    }
  }

  private async warmBaselines(symbols: string[], generation: number): Promise<void> {
    if (!this.isActive(generation) || !symbols.length) return;
    const pending = [...new Set(symbols)].filter((symbol) => (
      this.eligibleSymbolSet.has(symbol) &&
      !this.seeded.has(symbol) &&
      this.warmingSymbols.get(symbol) !== generation
    ));
    if (!pending.length) return;
    for (const symbol of pending) this.warmingSymbols.set(symbol, generation);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= pending.length) return;
        const symbol = pending[index];
        try {
          const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
          const candles = (await fetchKlineCandles(symbol, '1m', 61, 'spot'))
            .filter((candle) => candle.t < currentMinute)
            .slice(-60);
          if (!this.isActive(generation) || !this.eligibleSymbolSet.has(symbol)) continue;
          let accepted = 0;
          for (const candle of candles) {
            if (this.engine.seedMinute(symbol, {
              startMs: candle.t,
              quoteVolume: candle.qv,
              tradeCount: candle.trades,
              takerBuyQuote: candle.takerBuyQv,
              open: candle.o,
              close: candle.c,
              high: candle.h,
              low: candle.l,
            })) accepted += 1;
          }
          if (accepted >= this.engine.cfg.baselineMinSamples) {
            this.seeded.add(symbol);
            this.baselineFailures.delete(symbol);
          } else {
            this.baselineFailures.add(symbol);
          }
        } catch {
          if (this.isActive(generation)) this.baselineFailures.add(symbol);
        } finally {
          if (this.warmingSymbols.get(symbol) === generation) this.warmingSymbols.delete(symbol);
        }
        if (this.isActive(generation)) {
          this.baselineCompleted = this.eligibleSymbols.filter((item) => this.seeded.has(item)).length;
          this.baselineFailed = this.baselineFailures.size;
        }
      }
    });
    await Promise.all(workers);
  }

  private isActive(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private launch(label: string, generation: number, task: () => Promise<void>): void {
    if (!this.isActive(generation)) return;
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        if (!this.isActive(generation)) return;
        this.safeLog('error_event', null, {
          source: 'volume-runtime.background',
          task: label,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private readConfig(): AppConfig | null {
    try {
      const config = this.getConfig();
      return config && typeof config === 'object' ? config : null;
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.config',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Apply mutable operator controls on every engine tick, fail closed. */
  private applyDynamicConfig(): string {
    const config = this.readConfig();
    if (!config) {
      this.engine.setKillSwitch(true);
      this.engine.setSymbolPolicy([], []);
      return 'invalid';
    }

    const allowed = Array.isArray(config.allowedSymbols)
      ? [...new Set(config.allowedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol))]
        .slice(0, MAX_ENGINE_SYMBOLS)
      : [];
    const blocked = Array.isArray(config.blockedSymbols)
      ? [...new Set(config.blockedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol))]
        .slice(0, MAX_ENGINE_SYMBOLS)
      : [];
    this.engine.setKillSwitch(
      typeof config.killSwitch === 'boolean' && positive(config.maxOrderNotionalUsd)
        ? config.killSwitch
        : true,
    );
    this.engine.setSymbolPolicy(allowed, blocked);
    if (positive(config.maxOrderNotionalUsd)) this.engine.setSuggestedNotionalUsd(config.maxOrderNotionalUsd);

    const threshold = positive(config.minQuoteVolume24h)
      ? config.minQuoteVolume24h
      : this.engine.cfg.minQuoteVolume24hUsd;
    return String(threshold);
  }

  private persistEvent(event: EngineEvent): void {
    let key: string;
    try {
      key = JSON.stringify(event);
    } catch {
      return;
    }
    if (this.persistedEventKeys.has(key)) return;
    const persisted = this.safeLog(event.kind, event.symbol, {
      strategy: event.strategy,
      correlationId: event.correlationId,
      rejectCode: event.rejectCode,
      message: event.message,
      ...event.payload,
    });
    if (!persisted) throw new Error('volume runtime ledger unavailable');
    this.persistedEventKeys.add(key);
    this.persistedEventOrder.push(key);
    if (this.persistedEventOrder.length > 5_000) {
      const removed = this.persistedEventOrder.shift();
      if (removed !== undefined) this.persistedEventKeys.delete(removed);
    }
  }

  private safeLog(kind: string, symbol: string | null, payload: Record<string, unknown>): boolean {
    try {
      this.ledger.logEvent(kind, symbol, payload);
      return true;
    } catch {
      this.ledgerFailureCount += 1;
      // Ledger failures must degrade observability, never terminate market-data
      // ingestion or leave an interval with an unhandled rejection.
      return false;
    }
  }

  snapshot(): Record<string, unknown> {
    const now = Date.now();
    const decisions = this.engine.decisions(2_000);
    const latestDecision = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) latestDecision.set(decision.symbol, decision);
    const candidates = new Map(this.engine.focusMgr.candidateList().map((row) => [row.symbol, row]));
    const focus = new Map(this.engine.focusMgr.focusSessions().map((row) => [row.symbol, row]));
    const proposals = new Map(this.engine.proposalStore.all().map((row) => [row.symbol, row]));

    const rows = this.engine.universe().filter((meta) => meta.eligible).map((meta) => {
      const feature = this.engine.featureSnapshot(meta.symbol);
      if (!feature) return null;
      const decision = latestDecision.get(meta.symbol) ?? null;
      const state = this.engine.focusMgr.stateOf(meta.symbol);
      const candidate = candidates.get(meta.symbol);
      const focused = focus.get(meta.symbol);
      const proposal = proposals.get(meta.symbol);
      const price = feature.spotBid !== null && feature.spotAsk !== null
        ? (feature.spotBid + feature.spotAsk) / 2
        : null;
      const reason = decision
        ? decision.humanReason
        : feature.baseline.ready
          ? 'Volume within own baseline'
          : 'Baseline warming';
      return {
        symbol: meta.symbol,
        base: meta.base,
        state,
        price,
        lastTradeTs: this.symbolLastTradeTs.get(meta.symbol) ?? null,
        baseline: feature.baseline,
        windows: feature.windows,
        volumeMultiple: feature.volumeMultiple,
        tradeCountMultiple: feature.tradeCountMultiple,
        spreadBps: feature.book.spreadBps,
        topDepthUsd: feature.book.topDepthUsd,
        depthScore: feature.book.depthScore,
        depthVsNorm: feature.book.depthVsNorm,
        takerBuyRatio: feature.tape?.takerBuyRatio ?? feature.windows['15s']?.takerBuyRatio ?? null,
        washScore: feature.tape?.washScore ?? null,
        accelerationPctPerMin: feature.accelerationPctPerMin,
        focusReason: focused?.reason ?? candidate?.reason ?? null,
        focusAgeMs: focused ? now - focused.enteredTs : 0,
        decisionKind: decision?.kind ?? (feature.baseline.ready ? 'ignore' : 'warming'),
        rejectCode: decision?.rejectCode ?? null,
        reason,
        correlationId: decision?.correlationId ?? null,
        decisionTs: decision?.ts ?? null,
        proposal: proposal ? {
          id: proposal.id,
          status: proposal.status,
          direction: proposal.direction,
          confidence: proposal.confidence,
          reason: proposal.reason,
        } : null,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    const rank: Record<string, number> = {
      PROPOSED: 0,
      FOCUS: 1,
      WATCHING: 2,
      COOLDOWN: 3,
      ACTIVE: 4,
      REJECTED: 5,
      IDLE: 6,
    };
    rows.sort((left, right) => {
      const stateOrder = (rank[left.state] ?? 9) - (rank[right.state] ?? 9);
      if (stateOrder) return stateOrder;
      const leftMultiple = Math.max(left.volumeMultiple['1s'] ?? 0, left.volumeMultiple['5s'] ?? 0);
      const rightMultiple = Math.max(right.volumeMultiple['1s'] ?? 0, right.volumeMultiple['5s'] ?? 0);
      if (rightMultiple !== leftMultiple) return rightMultiple - leftMultiple;
      return (right.windows['60s']?.quoteVolume ?? 0) - (left.windows['60s']?.quoteVolume ?? 0);
    });

    const openConnections = [...this.streamStatus.values()].filter((status) => status === 'open').length;
    const streamState = this.streams.length === 0
      ? 'starting'
      : openConnections === this.streams.length
        ? 'open'
        : [...this.streamStatus.values()].some((status) => status === 'connecting')
          ? 'connecting'
          : 'degraded';
    return {
      updatedAt: now,
      status: {
        running: this.running && this.engine.isRunning(),
        streamState,
        streamConnections: this.streams.length,
        openConnections,
        bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
        universeSize: this.engine.universe().length,
        eligibleSize: this.eligibleSymbols.length,
        observedSymbols: [...this.symbolLastTradeTs.values()].filter((ts) => now - ts < 60_000).length,
        baselineReady: rows.filter((row) => row.baseline.ready).length,
        baselineTotal: this.baselineTotal,
        baselineCompleted: this.baselineCompleted,
        baselineFailed: this.baselineFailed,
        watching: candidates.size,
        focused: focus.size,
        openProposals: this.engine.proposalStore.openProposals().length,
        lastTradeTs: this.lastTradeTs,
        lastBookTs: this.lastBookTs,
        tradeMessages: this.tradeMessages,
        sinkFailures: this.engine.sinkFailures(),
        ledgerFailures: this.ledgerFailureCount,
        source: 'Binance Spot Aggregate Trade Streams',
        bookSource: 'Binance Spot All Book Tickers',
        baselineSource: 'Binance Spot 1m Klines',
      },
      thresholds: {
        volume1s: this.engine.cfg.vol1sMultiple,
        volume5s: this.engine.cfg.vol5sMultiple,
        tradeCount: this.engine.cfg.minTradeCountMultiple,
        followthroughPct: this.engine.cfg.minFollowthroughPct,
        maxSpreadBps: this.engine.cfg.maxSpreadBps,
        minDepthScore: this.engine.cfg.minDepthScore,
        baselineMinutes: this.engine.cfg.baselineMinSamples,
      },
      rows,
    };
  }
}
