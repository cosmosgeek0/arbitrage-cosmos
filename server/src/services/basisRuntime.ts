import { fetchAllBookTickers } from '../binance/rest.js';
import { BasisEngine } from '../engine/basis/engine.js';
import { systemClock } from '../engine/v0/clock.js';
import type { EngineEvent, EventSink } from '../engine/v0/types.js';
import type { Ledger } from '../ledger.js';
import type { AppConfig } from '../types.js';

interface MarketUniverseRow {
  symbol: string;
  base: string;
  quoteVolume24h: number | null;
  hasSpot: boolean;
  hasPerp: boolean;
  perpMark: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
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
  private eligibleSymbols: string[] = [];
  private running = false;
  private bookBusy = false;
  private bookTimer: NodeJS.Timeout | null = null;
  private universeTimer: NodeJS.Timeout | null = null;
  private lastBookTs: number | null = null;
  private lastMarkTs: number | null = null;
  private lastError: string | null = null;
  private eventLastLogged = new Map<string, number>();

  constructor(
    private readonly ledger: Ledger,
    private readonly getConfig: () => AppConfig,
    private readonly getUniverse: () => MarketUniverseRow[],
  ) {
    const config = getConfig();
    const sink: EventSink = { emit: (event) => this.onEngineEvent(event) };
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
    if (this.running) return;
    this.running = true;
    this.engine.start();
    this.refreshUniverse();
    await this.refreshBooks();
    this.bookTimer = setInterval(() => void this.refreshBooks(), BOOK_REFRESH_MS);
    this.universeTimer = setInterval(() => this.refreshUniverse(), UNIVERSE_REFRESH_MS);
  }

  stop(): void {
    this.running = false;
    if (this.bookTimer) clearInterval(this.bookTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    this.bookTimer = null;
    this.universeTimer = null;
    this.engine.stop();
  }

  private onEngineEvent(event: EngineEvent): void {
    const decisionKind = typeof event.payload.kind === 'string' ? event.payload.kind : null;
    if (event.kind === 'strategy_decision' && decisionKind === 'ignore') return;

    const signature = [event.kind, event.symbol ?? '', event.rejectCode ?? '', decisionKind ?? ''].join('|');
    const now = Date.now();
    const previous = this.eventLastLogged.get(signature) ?? 0;
    if (now - previous < LEDGER_REPEAT_MS) return;
    this.eventLastLogged.set(signature, now);
    this.ledger.logEvent(`basis.${event.kind}`, event.symbol, {
      strategy: event.strategy,
      correlationId: event.correlationId,
      rejectCode: event.rejectCode,
      message: event.message,
      ...event.payload,
    });
  }

  private refreshUniverse(): void {
    const floor = this.getConfig().minQuoteVolume24h;
    const eligible = this.getUniverse().filter(
      (row) => row.hasSpot && row.hasPerp && finite(row.quoteVolume24h) && row.quoteVolume24h >= floor,
    );
    const nextSymbols = eligible.map((row) => row.symbol).sort();
    const next = new Set(nextSymbols);
    for (const symbol of this.eligibleSymbols) {
      if (!next.has(symbol)) this.engine.blockSymbol(symbol);
    }
    for (const symbol of nextSymbols) this.engine.unblockSymbol(symbol);
    this.eligibleSymbols = nextSymbols;
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
  }

  private async refreshBooks(): Promise<void> {
    if (this.bookBusy || !this.eligibleSymbols.length) return;
    this.bookBusy = true;
    try {
      const [spotBooks, perpBooks] = await Promise.all([
        fetchAllBookTickers('spot'),
        fetchAllBookTickers('futures'),
      ]);
      const source = new Map(this.getUniverse().map((row) => [row.symbol, row]));
      const receivedTs = Date.now();
      let booksSeen = 0;
      let marksSeen = 0;

      for (const symbol of this.eligibleSymbols) {
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
        if (usableBook(spot) && usableBook(perp)) booksSeen += 1;

        const row = source.get(symbol);
        if (row && finite(row.perpMark) && row.perpMark > 0 && finite(row.fundingRate)) {
          this.engine.onMarkFunding({
            symbol,
            markPrice: row.perpMark,
            fundingRate: row.fundingRate,
            nextFundingTs: finite(row.nextFundingTime) ? row.nextFundingTime : null,
            ts: receivedTs,
          });
          marksSeen += 1;
        }
      }

      if (booksSeen > 0) this.lastBookTs = receivedTs;
      if (marksSeen > 0) this.lastMarkTs = receivedTs;
      // Tick in the same turn as ingestion so the feature numbers, named
      // decision, and evidence exposed by snapshot() are one coherent book.
      this.engine.setKillSwitch(this.getConfig().killSwitch);
      this.engine.tick();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.ledger.logEvent('error_event', null, {
        source: 'basis-runtime.book',
        message: this.lastError,
      });
    } finally {
      this.bookBusy = false;
    }
  }

  snapshot(): Record<string, unknown> {
    const now = Date.now();
    const decisions = this.engine.decisions(5_000);
    const latestDecision = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) latestDecision.set(decision.symbol, decision);
    const lifecycles = new Map(this.engine.lifecycle.all().map((row) => [row.symbol, row]));
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
