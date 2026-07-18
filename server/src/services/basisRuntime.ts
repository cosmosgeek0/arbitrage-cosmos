import { fetchAllBookTickers } from '../binance/rest.js';
import type { BasisConfig } from '../engine/basis/config.js';
import { BasisEngine } from '../engine/basis/engine.js';
import type { BasisProposal } from '../engine/basis/types.js';
import { systemClock } from '../engine/v0/clock.js';
import type { Decision, EngineEvent, EventSink } from '../engine/v0/types.js';
import type { Ledger } from '../ledger.js';
import type { AppConfig } from '../types.js';
import { compareExactDecimals, normalizeNonNegativeExactDecimal } from '../capitalFoundation/contracts/index.js';

interface MarketUniverseRow {
  symbol: string;
  base: string;
  quoteVolume24h: number | null;
  hasSpot: boolean;
  hasPerp: boolean;
  perpMark: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  markUpdatedAt?: number | null;
}

export interface BasisRuntimeIntegrationSnapshot {
  /** Capture time only. Never use this field as source-observation freshness. */
  capturedAtMs: number;
  lastTickTs: number | null;
  config: BasisConfig;
  decisions: Decision[];
  proposals: BasisProposal[];
}

// The basis quality gate intentionally decays inside the 5s stale window.
// Refreshing at 1.5s keeps crossed legs comfortably inside that stricter
// trust curve while staying modest for the two all-symbol book endpoints.
const BOOK_REFRESH_MS = 1_500;
const UNIVERSE_REFRESH_MS = 15 * 60_000;
const LEDGER_REPEAT_MS = 60_000;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function usableBook(book: { bidPrice: number; askPrice: number; bidQty: number; askQty: number } | undefined): boolean {
  return Boolean(
    book &&
      finite(book.bidPrice) &&
      finite(book.askPrice) &&
      finite(book.bidQty) &&
      finite(book.askQty) &&
      book.bidPrice > 0 &&
      book.askPrice > 0 &&
      book.askPrice >= book.bidPrice &&
      book.bidQty > 0 &&
      book.askQty > 0,
  );
}

/**
 * Production adapter for the deterministic v2 basis engine. Public Binance
 * books and the existing mark/funding stream are the only market inputs.
 * Borrow remains UNKNOWN until a signed, account-specific provider can prove
 * both availability and cost; reverse-basis proposals therefore fail closed.
 */
export class BasisRuntime {
  private readonly engine: BasisEngine;
  private readonly fetchBookTickers: typeof fetchAllBookTickers;
  private eligibleSymbols: string[] = [];
  private running = false;
  private generation = 0;
  private starting: { generation: number; promise: Promise<void> } | null = null;
  private bookBusyGeneration: number | null = null;
  private bookTimer: NodeJS.Timeout | null = null;
  private universeTimer: NodeJS.Timeout | null = null;
  private lastBookTs: number | null = null;
  private lastMarkTs: number | null = null;
  private lastError: string | null = null;
  private errorRevision = 0;
  private universePolicyKey = '';
  private lastErrorLogAttemptTs = 0;
  private eventLastLogged = new Map<string, { ts: number; symbol: string | null }>();
  private operatorMinNetBasisPct: number | null = null;

  constructor(
    private readonly ledger: Ledger,
    private readonly getConfig: () => AppConfig,
    private readonly getUniverse: () => MarketUniverseRow[],
    fetchBookTickers: typeof fetchAllBookTickers = fetchAllBookTickers,
  ) {
    this.fetchBookTickers = fetchBookTickers;
    const config = getConfig();
    const sink: EventSink = {
      emit: (event) => {
        try {
          this.onEngineEvent(event);
        } catch (error) {
          // Persistence is outside the deterministic engine. Never let a
          // callback failure corrupt the tick, and never recursively log it.
          this.noteError('basis-runtime.event-sink', error);
        }
      },
    };
    this.engine = new BasisEngine(systemClock, sink, {
      feesPct: config.feesPct,
      minNetBasisPct: config.minNetBasisPct,
      persistTicks: config.persistTicks,
      minQuoteVolume24hUsd: config.minQuoteVolume24h,
      // Keep the existing 2:1 spot/perp fee split while preserving the
      // configured four-leg round-trip total.
      spotTakerFeePct: config.feesPct / 3,
      perpTakerFeePct: config.feesPct / 6,
    });
  }

  async start(): Promise<void> {
    if (this.running) {
      await (this.starting?.promise ?? Promise.resolve());
      return;
    }
    const generation = ++this.generation;
    this.running = true;
    this.lastBookTs = null;
    this.lastMarkTs = null;
    this.engine.start();
    const promise = this.startGeneration(generation);
    this.starting = { generation, promise };
    try {
      await promise;
    } finally {
      if (this.starting?.generation === generation) this.starting = null;
    }
  }

  stop(): void {
    ++this.generation;
    this.running = false;
    if (this.bookTimer) clearInterval(this.bookTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    this.bookTimer = null;
    this.universeTimer = null;
    this.eligibleSymbols = [];
    this.engine.stop();
  }

  connectionStatus(): {
    running: boolean;
    bookState: 'fresh' | 'stale';
    markState: 'fresh' | 'stale';
    lastBookTs: number | null;
    lastMarkTs: number | null;
    lastError: string | null;
  } {
    const now = Date.now();
    return {
      running: this.running && this.engine.isRunning(),
      bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
      markState: this.lastMarkTs !== null && now - this.lastMarkTs < 10_000 ? 'fresh' : 'stale',
      lastBookTs: this.lastBookTs,
      lastMarkTs: this.lastMarkTs,
      lastError: this.lastError,
    };
  }

  /**
   * Bounded, defensive read seam for system integration. It preserves the
   * engine's real proposal IDs, exact evidence, decision correlation IDs, and
   * raw tick time without opening another market feed. Missing revisions stay
   * missing for the directional adapter to report explicitly.
   */
  integrationSnapshot(): BasisRuntimeIntegrationSnapshot {
    return structuredClone({
      capturedAtMs: Date.now(),
      lastTickTs: this.engine.lastTick(),
      config: this.engine.cfg,
      decisions: this.engine.decisions(2_000),
      proposals: this.engine.openProposals(),
    });
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
    if (canonical !== value) throw new TypeError('basis size ceiling must be canonical');
    const numeric = Number(canonical);
    if (!Number.isFinite(numeric) || numeric <= 0 || String(numeric) !== canonical) {
      throw new RangeError('basis size ceiling cannot cross the legacy numeric boundary exactly');
    }
    const current = this.sizeCeiling();
    if (current === null || compareExactDecimals(canonical, normalizeNonNegativeExactDecimal(current)) > 0) {
      throw new RangeError('basis size ceiling is downward-only');
    }
    return this.engine.setSuggestedNotionalUsd(numeric);
  }

  strategyThreshold(): string | null {
    try { return normalizeNonNegativeExactDecimal(String(this.engine.cfg.minNetBasisPct)); } catch { return null; }
  }

  setStrategyThreshold(value: string): boolean {
    const canonical = normalizeNonNegativeExactDecimal(value);
    const numeric = Number(canonical);
    if (canonical !== value || !Number.isFinite(numeric) || numeric < 0.01 || numeric > 100 || String(numeric) !== canonical) {
      throw new RangeError('Basis minimum-net threshold is invalid or inexact at the legacy boundary');
    }
    const ownerChanged = this.operatorMinNetBasisPct !== numeric;
    this.operatorMinNetBasisPct = numeric;
    return this.engine.updateConfig({ minNetBasisPct: numeric }) || ownerChanged;
  }

  setIntakePaused(paused: boolean): boolean {
    return this.engine.setIntakePaused(paused);
  }

  intakePaused(): boolean {
    return this.engine.intakePaused();
  }

  private onEngineEvent(event: EngineEvent): void {
    const decisionKind = typeof event.payload.kind === 'string' ? event.payload.kind : null;
    if (event.kind === 'strategy_decision' && decisionKind === 'ignore') return;

    const signature = [event.kind, event.symbol ?? '', event.rejectCode ?? '', decisionKind ?? ''].join('|');
    const now = Date.now();
    const previous = this.eventLastLogged.get(signature)?.ts ?? 0;
    if (now - previous < LEDGER_REPEAT_MS) return;
    try {
      this.ledger.logEvent(`basis.${event.kind}`, event.symbol, {
        ...event.payload,
        strategy: event.strategy,
        correlationId: event.correlationId,
        rejectCode: event.rejectCode,
        message: event.message,
      });
      this.eventLastLogged.set(signature, { ts: now, symbol: event.symbol });
      this.pruneEventDedupe(now);
    } catch (error) {
      this.eventLastLogged.set(signature, { ts: now, symbol: event.symbol });
      this.noteError('basis-runtime.ledger', error);
    }
  }

  private async startGeneration(generation: number): Promise<void> {
    this.refreshUniverse(generation);
    await this.refreshBooks(generation);
    if (!this.owns(generation)) return;
    this.bookTimer = setInterval(() => void this.refreshBooks(generation), BOOK_REFRESH_MS);
    this.universeTimer = setInterval(() => this.refreshUniverse(generation), UNIVERSE_REFRESH_MS);
  }

  private refreshUniverse(generation = this.generation): void {
    if (!this.owns(generation)) return;
    try {
      const config = this.getConfig();
      this.engine.updateConfig({
        feesPct: config.feesPct,
        minNetBasisPct: this.operatorMinNetBasisPct ?? config.minNetBasisPct,
        persistTicks: config.persistTicks,
        minQuoteVolume24hUsd: config.minQuoteVolume24h,
        spotTakerFeePct: config.feesPct / 3,
        perpTakerFeePct: config.feesPct / 6,
      });
      this.engine.setKillSwitch(config.killSwitch);
      const floor = config.minQuoteVolume24h;
      const universe = this.getUniverse();
      if (!Array.isArray(universe) || universe.length > this.engine.cfg.maxUniverseSize) {
        throw new RangeError(`basis runtime universe exceeds ${this.engine.cfg.maxUniverseSize} rows`);
      }
      const eligible = universe.filter(
        (row) => row.hasSpot && row.hasPerp && finite(row.quoteVolume24h) && row.quoteVolume24h >= floor,
      );
      this.engine.setUniverse(eligible.map((row) => ({
        symbol: row.symbol,
        base: row.base,
        quote: 'USDT',
        hasSpot: true,
        hasPerp: true,
        marginBorrowable: null,
        minNotionalUsd: null,
        tickSize: null,
        stepSize: null,
        quoteVolume24hUsd: row.quoteVolume24h,
        eligible: true,
        ineligibleReason: null,
      })));
      this.engine.replaceSymbolPolicy(
        Array.isArray(config.allowedSymbols) ? config.allowedSymbols : [],
        Array.isArray(config.blockedSymbols) ? config.blockedSymbols : [],
      );
      this.eligibleSymbols = this.engine.market.universe().filter((meta) => meta.eligible).map((meta) => meta.symbol).sort();
      this.universePolicyKey = this.policyKey(config);
      if (this.eligibleSymbols.length === 0) {
        this.lastBookTs = null;
        this.lastMarkTs = null;
      }
      this.pruneEventDedupe(Date.now(), new Set(this.eligibleSymbols));
    } catch (error) {
      this.noteError('basis-runtime.universe', error);
      this.engine.setKillSwitch(true);
      this.eligibleSymbols = [];
      this.lastBookTs = null;
      this.lastMarkTs = null;
      try {
        this.engine.setUniverse([]);
      } catch {
        // An empty universe is valid; if this ever fails, preserve the first
        // error and remain stopped from producing fresh proposals.
      }
      this.safeLogError('basis-runtime.universe');
    }
  }

  private async refreshBooks(generation = this.generation): Promise<void> {
    if (!this.owns(generation) || this.bookBusyGeneration === generation) return;
    this.bookBusyGeneration = generation;
    const errorRevision = this.errorRevision;
    try {
      let config = this.getConfig();
      const configChanged = this.engine.updateConfig({
        feesPct: config.feesPct,
        minNetBasisPct: this.operatorMinNetBasisPct ?? config.minNetBasisPct,
        persistTicks: config.persistTicks,
        minQuoteVolume24hUsd: config.minQuoteVolume24h,
        spotTakerFeePct: config.feesPct / 3,
        perpTakerFeePct: config.feesPct / 6,
      });
      if (configChanged || this.universePolicyKey !== this.policyKey(config)) this.refreshUniverse(generation);
      // A process can start before MarketEngine has received its first public
      // ticker payload. Recheck the universe on the short book cadence until
      // at least one eligible pair exists instead of waiting 15 minutes.
      if (this.owns(generation) && this.eligibleSymbols.length === 0) this.refreshUniverse(generation);
      if (!this.owns(generation) || !this.eligibleSymbols.length) return;
      const [spotBooks, perpBooks] = await Promise.all([
        this.fetchBookTickers('spot'),
        this.fetchBookTickers('futures'),
      ]);
      if (!this.owns(generation)) return;
      config = this.getConfig();
      const changedDuringFetch = this.engine.updateConfig({
        feesPct: config.feesPct,
        minNetBasisPct: this.operatorMinNetBasisPct ?? config.minNetBasisPct,
        persistTicks: config.persistTicks,
        minQuoteVolume24hUsd: config.minQuoteVolume24h,
        spotTakerFeePct: config.feesPct / 3,
        perpTakerFeePct: config.feesPct / 6,
      });
      if (changedDuringFetch || this.universePolicyKey !== this.policyKey(config)) this.refreshUniverse(generation);
      if (!this.owns(generation) || !this.eligibleSymbols.length) return;
      const universe = this.getUniverse();
      if (!Array.isArray(universe) || universe.length > this.engine.cfg.maxUniverseSize) {
        throw new RangeError(`basis runtime universe exceeds ${this.engine.cfg.maxUniverseSize} rows`);
      }
      const source = new Map(universe.map((row) => [row.symbol, row]));
      const receivedTs = Date.now();
      let booksSeen = 0;
      let marksSeen = 0;
      const active = new Set(this.eligibleSymbols);

      for (const symbol of active) {
        const spot = spotBooks.get(symbol);
        const perp = perpBooks.get(symbol);
        if (usableBook(spot)) {
          this.engine.onSpotBook({
            symbol,
            bid: spot!.bidPrice,
            ask: spot!.askPrice,
            bidQty: spot!.bidQty,
            askQty: spot!.askQty,
            ts: receivedTs,
          });
        }
        if (usableBook(perp)) {
          this.engine.onPerpBook({
            symbol,
            bid: perp!.bidPrice,
            ask: perp!.askPrice,
            bidQty: perp!.bidQty,
            askQty: perp!.askQty,
            ts: receivedTs,
          });
        }
        if (this.engine.market.spotBook(symbol)?.ts === receivedTs && this.engine.market.perpBook(symbol)?.ts === receivedTs) {
          booksSeen += 1;
        }

        const row = source.get(symbol);
        if (
          row &&
          finite(row.perpMark) &&
          row.perpMark > 0 &&
          finite(row.fundingRate) &&
          Number.isSafeInteger(row.markUpdatedAt) &&
          row.markUpdatedAt! > 0
        ) {
          const sourceTs = row.markUpdatedAt!;
          this.engine.onMarkFunding({
            symbol,
            markPrice: row.perpMark,
            fundingRate: row.fundingRate,
            nextFundingTs: finite(row.nextFundingTime) ? row.nextFundingTime : null,
            ts: sourceTs,
          });
          if (this.engine.market.markFunding(symbol)?.ts === sourceTs) {
            marksSeen += 1;
            this.lastMarkTs = Math.max(this.lastMarkTs ?? 0, sourceTs);
          }
        }
      }

      if (booksSeen > 0) this.lastBookTs = receivedTs;
      if (marksSeen === 0 && this.lastMarkTs !== null && receivedTs - this.lastMarkTs > this.engine.cfg.fundingStaleMs) {
        this.lastMarkTs = null;
      }
      // Tick in the same turn as ingestion so the feature numbers, named
      // decision, and evidence exposed by snapshot() are one coherent book.
      this.engine.setKillSwitch(config.killSwitch);
      this.engine.tick();
      if (this.errorRevision === errorRevision) this.lastError = null;
    } catch (error) {
      if (this.owns(generation)) {
        this.noteError('basis-runtime.book', error);
        this.safeLogError('basis-runtime.book');
      }
    } finally {
      if (this.bookBusyGeneration === generation) this.bookBusyGeneration = null;
    }
  }

  private owns(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private policyKey(config: AppConfig): string {
    const blocked = Array.isArray(config.blockedSymbols)
      ? config.blockedSymbols.slice(0, this.engine.cfg.maxUniverseSize).filter((symbol): symbol is string => typeof symbol === 'string').sort()
      : [];
    return JSON.stringify([config.minQuoteVolume24h, blocked]);
  }

  private noteError(source: string, error: unknown): void {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 400);
    this.lastError = `${source}: ${message || 'unknown error'}`;
    this.errorRevision += 1;
  }

  private safeLogError(source: string): void {
    const now = Date.now();
    if (now - this.lastErrorLogAttemptTs < LEDGER_REPEAT_MS) return;
    this.lastErrorLogAttemptTs = now;
    try {
      this.ledger.logEvent('error_event', null, { source, message: this.lastError });
    } catch (error) {
      // Do not recurse through the same failing persistence callback.
      this.noteError('basis-runtime.ledger', error);
    }
  }

  private pruneEventDedupe(now: number, symbols?: ReadonlySet<string>): void {
    const maxEntries = Math.max(256, this.engine.cfg.maxUniverseSize * 8);
    for (const [signature, entry] of this.eventLastLogged) {
      if (now - entry.ts > LEDGER_REPEAT_MS * 2 || (symbols && entry.symbol && !symbols.has(entry.symbol))) {
        this.eventLastLogged.delete(signature);
      }
    }
    if (this.eventLastLogged.size <= maxEntries) return;
    const oldest = [...this.eventLastLogged.entries()].sort((left, right) => left[1].ts - right[1].ts);
    for (let index = 0; index < oldest.length - maxEntries; index += 1) {
      this.eventLastLogged.delete(oldest[index][0]);
    }
  }

  snapshot(): Record<string, unknown> {
    const now = Date.now();
    const lifecycleRows = this.engine.lifecycle.all();
    const latestDecision = new Map<string, Decision>();
    for (const lifecycle of lifecycleRows) {
      if (lifecycle.lastDecision) latestDecision.set(lifecycle.symbol, lifecycle.lastDecision);
    }
    const lifecycles = new Map(lifecycleRows.map((row) => [row.symbol, row]));
    const proposals = new Map(this.engine.openProposals().map((row) => [row.symbol, row]));

    const rows = this.engine.market.universe().filter((meta) => meta.eligible).map((meta) => {
      const feature = this.engine.featureSnapshot(meta.symbol);
      if (!feature) return null;
      const decision = latestDecision.get(meta.symbol) ?? null;
      const lifecycle = lifecycles.get(meta.symbol);
      const direction = decision?.evidence.direction === 'short_spot_long_perp' || decision?.evidence.direction === 'long_spot_short_perp'
        ? decision.evidence.direction
        : (feature.basis.gapB.gapPct ?? -Infinity) > (feature.basis.gapA.gapPct ?? -Infinity)
          ? 'short_spot_long_perp'
          : 'long_spot_short_perp';
      const isReverse = direction === 'short_spot_long_perp';
      const gap = isReverse ? feature.basis.gapB : feature.basis.gapA;
      const otherGap = isReverse ? feature.basis.gapA : feature.basis.gapB;
      const edge = isReverse ? feature.basis.edge.B : feature.basis.edge.A;
      const funding = isReverse ? feature.basis.funding.B : feature.basis.funding.A;
      const liquidity = isReverse ? feature.basis.liquidity.B : feature.basis.liquidity.A;
      const proposal = proposals.get(meta.symbol) ?? null;
      return {
        symbol: meta.symbol,
        base: meta.base,
        state: lifecycle?.state ?? 'IDLE',
        direction,
        spotBid: feature.spotBid,
        spotAsk: feature.spotAsk,
        perpBid: feature.perpBid,
        perpAsk: feature.perpAsk,
        markPrice: feature.markPrice,
        spotSpreadBps: feature.spotSpreadBps,
        perpSpreadBps: feature.perpSpreadBps,
        quoteVolume24h: meta.quoteVolume24hUsd,
        executableGapPct: gap.gapPct,
        alternateGapPct: otherGap.gapPct,
        gapAgeMs: gap.gapAgeMs,
        persistTicks: gap.persistTicks,
        gapSlopePctPerMin: gap.slopePctPerMin,
        gapStabilityCv: gap.stabilityCv,
        fundingRate: funding.fundingRate,
        nextFundingTs: funding.nextFundingTs,
        fundingCarryPct: funding.carryPctOverHold,
        fundingFlipRisk: funding.flipRisk,
        expectedHoldMs: funding.expectedHoldMs,
        costs: edge.costs,
        netEdgePct: edge.netEdgePct,
        depthScore: liquidity.depthScore,
        slippagePct: liquidity.slippagePct,
        ladderBacked: liquidity.ladderBacked,
        bookPressure: liquidity.bookPressure,
        dataQuality: feature.basis.dq,
        borrow: isReverse ? feature.basis.borrowVerdictB : {
          status: 'not_needed',
          ok: true,
          rejectCode: null,
          human: 'No borrow needed for buy spot / sell perp',
          costPctOverHold: 0,
        },
        decisionKind: decision?.kind ?? 'ignore',
        rejectCode: decision?.rejectCode ?? null,
        reason: decision?.humanReason ?? 'Waiting for scanner decision',
        correlationId: decision?.correlationId ?? null,
        decisionTs: decision?.ts ?? null,
        priority: this.engine.priorityOf(meta.symbol),
        proposal: proposal ? {
          id: proposal.id,
          status: proposal.status,
          netEdgePct: proposal.netEdgePct,
          confidence: proposal.confidence,
          invalidation: proposal.invalidation,
          stagedSizes: proposal.stagedSizes,
        } : null,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    const rank: Record<string, number> = {
      PROPOSED: 0,
      FOCUS: 1,
      WATCHING: 2,
      REJECTED: 3,
      COOLDOWN: 4,
      ACTIVE: 5,
      IDLE: 6,
    };
    rows.sort((left, right) => {
      const stateOrder = (rank[left.state] ?? 9) - (rank[right.state] ?? 9);
      if (stateOrder) return stateOrder;
      const netOrder = (right.netEdgePct ?? -Infinity) - (left.netEdgePct ?? -Infinity);
      if (netOrder) return netOrder;
      return (right.executableGapPct ?? -Infinity) - (left.executableGapPct ?? -Infinity);
    });

    const rejected = rows.filter((row) => row.decisionKind === 'reject').length;
    const borrowBlocked = rows.filter((row) => row.rejectCode?.startsWith('borrow_')).length;
    const verifiedBorrow = rows.filter((row) => row.borrow.status === 'available' && row.borrow.ok).length;
    const dataQualityPassing = rows.filter((row) => row.dataQuality.score >= this.engine.cfg.minDataQuality).length;
    return {
      updatedAt: now,
      status: {
        running: this.running && this.engine.isRunning(),
        bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
        markState: this.lastMarkTs !== null && now - this.lastMarkTs < 10_000 ? 'fresh' : 'stale',
        universeSize: rows.length,
        watching: rows.filter((row) => row.state === 'WATCHING').length,
        focused: rows.filter((row) => row.state === 'FOCUS').length,
        openProposals: rows.filter((row) => row.state === 'PROPOSED').length,
        rejected,
        borrowBlocked,
        verifiedBorrow,
        dataQualityPassing,
        lastBookTs: this.lastBookTs,
        lastMarkTs: this.lastMarkTs,
        lastTickTs: this.engine.lastTick(),
        ticks: this.engine.ticks(),
        lastError: this.lastError,
        bookSource: 'Binance Spot + USD-M Best Bid/Ask',
        markSource: 'Binance USD-M Mark Price + Funding',
        borrowSource: 'Binance signed margin preflight not connected',
      },
      thresholds: {
        watchGapPct: this.engine.cfg.watchGapPct,
        focusGapPct: this.engine.cfg.focusGapPct,
        minNetBasisPct: this.engine.cfg.minNetBasisPct,
        feesPct: this.engine.cfg.feesPct,
        persistTicks: this.engine.cfg.persistTicks,
        maxSpreadBps: this.engine.cfg.maxSpreadBps,
        minDepthScore: this.engine.cfg.minDepthScore,
        minDataQuality: this.engine.cfg.minDataQuality,
        intendedNotionalUsd: this.engine.cfg.suggestedNotionalUsd,
      },
      rows,
    };
  }
}
