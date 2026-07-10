import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchAllBookTickers, fetchKlineCandles } from '../binance/rest.js';
import { mapAggTrade, type RawAggTrade } from '../engine/volume/adapters.js';
import { VolumeEngine } from '../engine/volume/engine.js';
import { systemClock } from '../engine/v0/clock.js';
import type { AppConfig } from '../types.js';
import type { Ledger } from '../ledger.js';

interface MarketUniverseRow {
  symbol: string;
  base: string;
  quoteVolume24h: number | null;
  hasSpot: boolean;
  hasPerp: boolean;
}

const STREAM_CHUNK = 140;
const UNIVERSE_REFRESH_MS = 15 * 60_000;
const BOOK_REFRESH_MS = 2_750;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export class VolumeRuntime {
  private readonly engine: VolumeEngine;
  private streams: BinanceStream[] = [];
  private streamStatus = new Map<string, FeedStatus>();
  private eligibleSymbols: string[] = [];
  private symbolSetKey = '';
  private running = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private bookTimer: NodeJS.Timeout | null = null;
  private universeTimer: NodeJS.Timeout | null = null;
  private bookBusy = false;
  private warmBusy = false;
  private seeded = new Set<string>();
  private baselineTotal = 0;
  private baselineCompleted = 0;
  private baselineFailed = 0;
  private lastBookTs: number | null = null;
  private lastTradeTs: number | null = null;
  private symbolLastTradeTs = new Map<string, number>();
  private tradeMessages = 0;

  constructor(
    private readonly ledger: Ledger,
    private readonly getConfig: () => AppConfig,
    private readonly getUniverse: () => MarketUniverseRow[],
  ) {
    this.engine = new VolumeEngine(systemClock, undefined, {
      emit: (event) => {
        this.ledger.logEvent(event.kind, event.symbol, {
          strategy: event.strategy,
          correlationId: event.correlationId,
          rejectCode: event.rejectCode,
          message: event.message,
          ...event.payload,
        });
      },
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.engine.start();
    await this.refreshUniverse();
    this.tickTimer = setInterval(() => {
      this.engine.setKillSwitch(this.getConfig().killSwitch);
      this.engine.tick();
    }, this.engine.cfg.tickMs);
    this.bookTimer = setInterval(() => void this.refreshBooks(), BOOK_REFRESH_MS);
    this.universeTimer = setInterval(() => void this.refreshUniverse(), UNIVERSE_REFRESH_MS);
    void this.refreshBooks();
  }

  stop(): void {
    this.running = false;
    for (const stream of this.streams) stream.stop();
    this.streams = [];
    // A subsequent start() must rebuild sockets even when the eligible symbol
    // universe is unchanged. Keeping the old key left the runtime running with
    // zero streams after an operator-initiated recovery.
    this.streamStatus.clear();
    this.symbolSetKey = '';
    this.eligibleSymbols = [];
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.bookTimer) clearInterval(this.bookTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    this.tickTimer = null;
    this.bookTimer = null;
    this.universeTimer = null;
    this.engine.stop();
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

  private async refreshUniverse(): Promise<void> {
    const sourceRows = this.getUniverse().filter((row) => row.hasSpot);
    const metas = sourceRows.map((row) => {
      const quoteVolume = finite(row.quoteVolume24h) ? row.quoteVolume24h : null;
      const eligible = quoteVolume !== null && quoteVolume >= this.engine.cfg.minQuoteVolume24hUsd;
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
    this.engine.setUniverse(metas);

    const nextSymbols = metas.filter((meta) => meta.eligible).map((meta) => meta.symbol).sort();
    const nextKey = nextSymbols.join(',');
    this.eligibleSymbols = nextSymbols;
    this.baselineTotal = nextSymbols.length;
    this.baselineCompleted = nextSymbols.filter((symbol) => this.seeded.has(symbol)).length;
    if (nextKey !== this.symbolSetKey) {
      this.symbolSetKey = nextKey;
      this.restartTradeStreams(nextSymbols);
    }
    void this.warmBaselines(nextSymbols.filter((symbol) => !this.seeded.has(symbol)));
  }

  private restartTradeStreams(symbols: string[]): void {
    for (const stream of this.streams) stream.stop();
    this.streams = [];
    this.streamStatus.clear();
    for (const [index, group] of chunks(symbols, STREAM_CHUNK).entries()) {
      if (!group.length) continue;
      const names = group.map((symbol) => symbol.toLowerCase() + '@aggTrade').join('/');
      const stream = new BinanceStream(
        'volume-aggtrade-' + String(index + 1),
        'wss://stream.binance.com:9443/stream?streams=' + names,
        (data) => this.onTradeMessage(data),
        (name, status) => this.onStreamStatus(name, status),
      );
      this.streams.push(stream);
      stream.start();
    }
  }

  private onTradeMessage(data: unknown): void {
    const raw = data && typeof data === 'object' && 'data' in data
      ? (data as { data: unknown }).data
      : data;
    if (!raw || typeof raw !== 'object' || (raw as { e?: string }).e !== 'aggTrade') return;
    const mapped = mapAggTrade(raw as RawAggTrade);
    this.engine.onTrade(mapped.tick, mapped.printCount);
    this.lastTradeTs = mapped.tick.ts;
    this.symbolLastTradeTs.set(mapped.tick.symbol, mapped.tick.ts);
    this.tradeMessages += 1;
  }

  private onStreamStatus(name: string, status: FeedStatus): void {
    const previous = this.streamStatus.get(name);
    this.streamStatus.set(name, status);
    if (previous === status || status === 'connecting') return;
    this.ledger.logEvent(status === 'open' ? 'ws.open' : 'ws.closed', null, {
      feed: name,
      source: 'volume-runtime',
    });
  }

  private async refreshBooks(): Promise<void> {
    if (this.bookBusy || !this.eligibleSymbols.length) return;
    this.bookBusy = true;
    try {
      const books = await fetchAllBookTickers('spot');
      const receivedTs = Date.now();
      for (const symbol of this.eligibleSymbols) {
        const book = books.get(symbol);
        if (!book) continue;
        this.engine.onBook({
          symbol,
          bid: book.bidPrice,
          ask: book.askPrice,
          bidQty: book.bidQty,
          askQty: book.askQty,
          ts: receivedTs,
        });
      }
      this.lastBookTs = receivedTs;
    } catch (error) {
      this.ledger.logEvent('error_event', null, {
        source: 'volume-runtime.book',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.bookBusy = false;
    }
  }

  private async warmBaselines(symbols: string[]): Promise<void> {
    if (this.warmBusy || !symbols.length) return;
    this.warmBusy = true;
    this.baselineFailed = 0;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(6, symbols.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= symbols.length) return;
        const symbol = symbols[index];
        try {
          const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
          const candles = (await fetchKlineCandles(symbol, '1m', 61, 'spot'))
            .filter((candle) => candle.t < currentMinute)
            .slice(-60);
          for (const candle of candles) {
            this.engine.seedMinute(symbol, {
              startMs: candle.t,
              quoteVolume: candle.qv,
              tradeCount: candle.trades,
              takerBuyQuote: candle.takerBuyQv,
              open: candle.o,
              close: candle.c,
              high: candle.h,
              low: candle.l,
            });
          }
          if (candles.length >= this.engine.cfg.baselineMinSamples) this.seeded.add(symbol);
        } catch {
          this.baselineFailed += 1;
        }
        this.baselineCompleted = this.eligibleSymbols.filter((item) => this.seeded.has(item)).length;
      }
    });
    await Promise.all(workers);
    this.warmBusy = false;
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
