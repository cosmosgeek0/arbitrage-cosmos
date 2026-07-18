/**
 * Basis engine — composition root.
 * Wires market state → features → scanner → lifecycle → proposals, all against
 * an injected Clock and EventSink. Zero network, zero express, zero timers:
 * callers (runner/replay/tests) push ticks in and call tick().
 *
 * Execution posture (ENGINE.md §13): this engine NEVER places orders. The only
 * exit is prepareOrderIntents(), which turns an open proposal into
 * OrderIntentStub metadata for the EXISTING risk gate — and refuses outright
 * when the kill switch is on.
 */
import type {
  BookTicker,
  Clock,
  Decision,
  MarkFunding,
  OrderIntentStub,
  RiskVerdictBridge,
  ScanContext,
  SymbolMeta,
} from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import { BasisFeatureBuilder } from './features.js';
import { GapTracker } from './gapTracker.js';
import { LifecycleManager } from './lifecycle.js';
import { BasisMarketState } from './marketState.js';
import { BasisProposalStore } from './proposals.js';
import { BasisScanner } from './scanner.js';
import { EventEmitter } from './events.js';
import { priorityFor } from './priority.js';
import { basisConfig, type BasisConfig } from './config.js';
import type { EventSink } from '../v0/types.js';
import type {
  BasisDirection,
  BasisFeatureSnapshot,
  BasisProposal,
  BorrowInfo,
  DepthLadder,
  FundingHistoryPoint,
  PriorityScore,
} from './types.js';

const DECISION_LOG_KEEP = 2_000;

export interface PreparedIntents {
  blocked: boolean;
  verdict: RiskVerdictBridge;
  intents: OrderIntentStub[];
}

export class BasisEngine {
  readonly cfg: BasisConfig;
  readonly market: BasisMarketState;
  readonly gaps: GapTracker;
  readonly features: BasisFeatureBuilder;
  readonly scanner: BasisScanner;
  readonly lifecycle: LifecycleManager;
  readonly proposals: BasisProposalStore;

  private emitter: EventEmitter;
  private decisionLog: Decision[] = [];
  private latestPriority = new Map<string, PriorityScore>();
  private running = false;
  private killSwitchOn = false;
  private intakePausedValue = false;
  private blocked = new Set<string>();
  private lastTickTs: number | null = null;
  private lastHeartbeatTs: number | null = null;
  private tickCount = 0;

  constructor(
    private clock: Clock,
    sink: EventSink,
    cfg?: Partial<BasisConfig>,
  ) {
    this.cfg = basisConfig(cfg);
    this.emitter = new EventEmitter(sink, clock, 'basis');
    this.market = new BasisMarketState(clock, this.cfg);
    this.gaps = new GapTracker(clock, this.cfg);
    this.features = new BasisFeatureBuilder(this.market, this.gaps, clock, this.cfg);
    this.scanner = new BasisScanner(this.cfg);
    this.lifecycle = new LifecycleManager(clock, this.cfg, this.emitter);
    this.proposals = new BasisProposalStore(clock, this.cfg, this.emitter);
  }

  // ---------- control ----------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emitter.emit('engine_started', newCorrelationId(this.clock, 'basis_sys'), 'basis engine started', {
      payload: { config: { ...this.cfg, stagedSizeFractions: [...this.cfg.stagedSizeFractions] } },
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emitter.emit('engine_stopped', newCorrelationId(this.clock, 'basis_sys'), 'basis engine stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Kill switch: observation continues, arming does not. (v0 EngineEventKind
   * has no kill_switch_changed — flagged for the Director; the toggle is
   * ledgered as an annotated heartbeat so it is never invisible.)
   */
  setKillSwitch(on: boolean): void {
    if (typeof on !== 'boolean') on = true;
    if (this.killSwitchOn === on) return;
    this.killSwitchOn = on;
    this.emitter.emit('heartbeat', newCorrelationId(this.clock, 'basis_sys'), `kill switch ${on ? 'ON' : 'off'}`, {
      payload: { killSwitchChanged: true, killSwitch: on },
    });
  }

  killSwitch(): boolean {
    return this.killSwitchOn;
  }

  /** Pause proposal formation only; market observation and supervision continue. */
  setIntakePaused(paused: boolean): boolean {
    if (typeof paused !== 'boolean') throw new TypeError('basis intake posture must be boolean');
    if (paused === this.intakePausedValue) return false;
    this.intakePausedValue = paused;
    this.emitter.emit(
      'heartbeat',
      newCorrelationId(this.clock, 'basis_sys'),
      `basis proposal intake ${paused ? 'paused' : 'resumed'}`,
      { payload: { intakePaused: paused } },
    );
    return true;
  }

  intakePaused(): boolean {
    return this.intakePausedValue;
  }

  /** Apply a validated config revision and invalidate state derived under old thresholds. */
  updateConfig(partial: Partial<BasisConfig>): boolean {
    const merged = { ...this.cfg, ...partial };
    if (partial.stagedSizeFractions === undefined) merged.stagedSizeFractions = this.cfg.stagedSizeFractions;
    const next = basisConfig(merged);
    if (this.market.symbols().length > next.maxUniverseSize) {
      throw new RangeError(`basis maxUniverseSize ${next.maxUniverseSize} is below the active universe`);
    }
    if (sameConfig(this.cfg, next)) return false;
    Object.assign(this.cfg, next, { stagedSizeFractions: [...next.stagedSizeFractions] });
    this.market.reconcileConfigBounds();
    this.proposals.expireAll('config_changed');
    this.proposals.reconcileConfigBounds();
    this.lifecycle.resetSignals();
    this.gaps.clear();
    this.latestPriority.clear();
    this.decisionLog = [];
    this.lastTickTs = null;
    this.lastHeartbeatTs = null;
    if (this.blocked.size > this.cfg.maxUniverseSize) {
      this.blocked = new Set([...this.blocked].sort().slice(0, this.cfg.maxUniverseSize));
    }
    this.emitter.emit('heartbeat', newCorrelationId(this.clock, 'basis_sys'), 'basis config revised; signal state reset', {
      payload: { configChanged: true },
    });
    return true;
  }

  blockSymbol(symbol: string): void {
    if (!/^[A-Z0-9]{2,32}$/.test(symbol)) return;
    if (!this.blocked.has(symbol) && this.blocked.size >= this.cfg.maxUniverseSize) return;
    this.blocked.add(symbol);
    if (this.market.hasSymbol(symbol)) this.proposals.expireForSymbol(symbol, 'symbol_blocked');
  }

  unblockSymbol(symbol: string): void {
    this.blocked.delete(symbol);
  }

  replaceBlockedSymbols(symbols: Iterable<string>): void {
    const next = new Set([...symbols].filter((symbol) => this.market.hasSymbol(symbol)));
    for (const symbol of this.blocked) {
      if (!next.has(symbol)) this.blocked.delete(symbol);
    }
    for (const symbol of next) this.blockSymbol(symbol);
  }

  pin(symbol: string): void {
    if (!this.market.hasSymbol(symbol)) return;
    this.lifecycle.pin(symbol);
  }

  // ---------- ingest (the API future live adapters call) ----------

  setUniverse(symbols: SymbolMeta[]): void {
    this.market.setUniverse(symbols);
    const accepted = this.market.universe();
    const known = new Set(accepted.map((meta) => meta.symbol));
    const eligible = new Set(accepted.filter((meta) => meta.eligible).map((meta) => meta.symbol));
    this.gaps.retainSymbols(known);
    const expired = this.proposals.retainSymbols(
      eligible,
      (symbol) => known.has(symbol) ? 'symbol_ineligible' : 'symbol_left_universe',
    );
    for (const proposal of expired) {
      if (known.has(proposal.symbol)) this.lifecycle.onProposalExpired(proposal.symbol, proposal.why);
    }
    this.lifecycle.retainSymbols(known);
    for (const symbol of this.latestPriority.keys()) if (!known.has(symbol)) this.latestPriority.delete(symbol);
    for (const symbol of this.blocked) if (!known.has(symbol)) this.blocked.delete(symbol);
    this.decisionLog = this.decisionLog.filter((decision) => known.has(decision.symbol));
    this.emitter.emit('universe_refreshed', newCorrelationId(this.clock, 'basis_sys'), `universe: ${accepted.length} symbols`, {
      payload: { size: accepted.length, eligible: eligible.size },
    });
  }

  onSpotBook(t: BookTicker): void {
    this.market.onSpotBook(t);
  }

  onPerpBook(t: BookTicker): void {
    this.market.onPerpBook(t);
  }

  onMarkFunding(t: MarkFunding): void {
    this.market.onMarkFunding(t);
  }

  onSpotDepth(d: DepthLadder): void {
    this.market.onSpotDepth(d);
  }

  onPerpDepth(d: DepthLadder): void {
    this.market.onPerpDepth(d);
  }

  onBorrowInfo(b: BorrowInfo): void {
    this.market.onBorrowInfo(b);
  }

  seedFundingHistory(symbol: string, points: FundingHistoryPoint[]): void {
    this.market.seedFundingHistory(symbol, points);
  }

  // ---------- the tick ----------

  /** One deterministic pass over every known symbol. Returns this tick's decisions. */
  tick(): Decision[] {
    const out: Decision[] = [];
    if (!this.running) return out;
    const now = this.clock.now();

    for (const symbol of this.market.symbols()) {
      if (this.lifecycle.inCooldown(symbol)) continue;

      const bf = this.features.build(symbol, true);
      if (!bf) continue;

      const meta = this.market.meta(symbol);
      const symbolAllowed = !this.blocked.has(symbol) && (meta ? meta.eligible : true);
      const borrow = this.market.borrowForSymbol(symbol);
      const ctx: ScanContext = {
        killSwitch: this.killSwitchOn,
        symbolAllowed,
        borrowStatus: borrow ? borrowCtxStatus(borrow) : 'unknown',
        nowTs: now,
      };

      const evaluated = this.scanner.evaluate(bf, ctx);
      const raw: Decision = this.intakePausedValue && evaluated.kind === 'proposal'
        ? {
            ...evaluated,
            kind: 'reject',
            rejectCode: 'intake_paused',
            humanReason: 'basis proposal intake is paused; observation remains active',
            evidence: { ...evaluated.evidence, intakePaused: true },
            correlationId: evaluated.correlationId,
          }
        : evaluated;
      const corr =
        raw.kind === 'ignore'
          ? (this.lifecycle.get(symbol).correlationId ?? newCorrelationId(this.clock, 'basis_idle'))
          : this.lifecycle.ensureCorrelation(symbol);
      const decision: Decision = { ...raw, correlationId: corr };

      const direction = directionOf(decision);
      const priority = priorityFor(bf, direction, this.cfg);
      this.latestPriority.set(symbol, priority);

      this.lifecycle.applyDecision(decision, priority);

      if (decision.kind === 'proposal' && direction) {
        this.proposals.upsert(bf, direction, corr, priority, decision.humanReason);
      }

      this.emitter.emit('strategy_decision', corr, decision.humanReason, {
        symbol,
        rejectCode: decision.rejectCode,
        payload: { kind: decision.kind, evidence: decision.evidence, priority: priority.score },
      });

      this.decisionLog.push(decision);
      out.push(decision);
    }

    if (this.decisionLog.length > DECISION_LOG_KEEP) {
      this.decisionLog.splice(0, this.decisionLog.length - DECISION_LOG_KEEP);
    }

    // enforce proposal invalidation against fresh (non-observing) snapshots
    const expired = this.proposals.sweep((s) => this.features.build(s, false));
    for (const e of expired) this.lifecycle.onProposalExpired(e.symbol, e.why);

    this.lifecycle.maintain();

    if (this.lastHeartbeatTs === null || now - this.lastHeartbeatTs >= this.cfg.heartbeatMs) {
      this.lastHeartbeatTs = now;
      this.emitter.emit('heartbeat', newCorrelationId(this.clock, 'basis_sys'), 'basis engine heartbeat', {
        payload: { tickCount: this.tickCount, openProposals: this.proposals.open().length },
      });
    }

    this.lastTickTs = now;
    this.tickCount += 1;
    return out;
  }

  // ---------- execution bridge (metadata only — never places orders) ----------

  /**
   * Turn an open proposal into two-leg OrderIntentStubs for the EXISTING risk
   * gate. Kill switch or a non-open proposal blocks here with a named reason.
   */
  prepareOrderIntents(proposalId: string): PreparedIntents {
    const now = this.clock.now();
    const expired = this.proposals.sweep((symbol) => this.features.build(symbol, false));
    for (const item of expired) this.lifecycle.onProposalExpired(item.symbol, item.why);
    const p = this.proposals.get(proposalId);

    if (!p || (p.status !== 'open' && p.status !== 'updated')) {
      const corr = p?.correlationId ?? newCorrelationId(this.clock, 'basis_sys');
      return {
        blocked: true,
        verdict: { allowed: false, reasons: ['proposal_not_open'], correlationId: corr, ts: now },
        intents: [],
      };
    }

    const proposalValid =
      (p.direction === 'long_spot_short_perp' || p.direction === 'short_spot_long_perp') &&
      this.market.meta(p.symbol)?.eligible === true &&
      !this.blocked.has(p.symbol) &&
      p.suggestedNotionalUsd !== null &&
      Number.isFinite(p.suggestedNotionalUsd) &&
      p.suggestedNotionalUsd > 0;
    if (!proposalValid) {
      this.proposals.expire(p.id, 'proposal_invalid');
      return {
        blocked: true,
        verdict: { allowed: false, reasons: ['proposal_invalid'], correlationId: p.correlationId, ts: now },
        intents: [],
      };
    }

    if (this.killSwitchOn) {
      this.emitter.emit('risk_rejected', p.correlationId, 'execution path blocked: kill switch on', {
        symbol: p.symbol,
        rejectCode: 'kill_switch_on',
        payload: { proposalId: p.id },
      });
      return {
        blocked: true,
        verdict: { allowed: false, reasons: ['kill_switch_on'], correlationId: p.correlationId, ts: now },
        intents: [],
      };
    }

    const notional = p.suggestedNotionalUsd ?? this.cfg.suggestedNotionalUsd;
    const legs: Array<{ side: 'BUY' | 'SELL' }> =
      p.direction === 'long_spot_short_perp'
        ? [{ side: 'BUY' }, { side: 'SELL' }] // buy spot, short perp
        : [{ side: 'SELL' }, { side: 'BUY' }]; // sell spot, long perp
    const intents: OrderIntentStub[] = legs.map((leg) => ({
      correlationId: p.correlationId,
      proposalId: p.id,
      symbol: p.symbol,
      side: leg.side,
      notionalUsd: notional,
      source: 'proposal',
    }));

    // stubs go to the existing services/risk.ts gate — approval is ITS event
    return {
      blocked: false,
      verdict: { allowed: true, reasons: [], correlationId: p.correlationId, ts: now },
      intents,
    };
  }

  // ---------- reads for snapshots ----------

  decisions(limit = 100): Decision[] {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(0, Math.min(DECISION_LOG_KEEP, Math.trunc(limit)))
      : 0;
    return safeLimit === 0 ? [] : this.decisionLog.slice(-safeLimit);
  }

  priorities(): PriorityScore[] {
    return [...this.latestPriority.values()].sort((a, b) => b.score - a.score);
  }

  priorityOf(symbol: string): PriorityScore | null {
    return this.latestPriority.get(symbol) ?? null;
  }

  openProposals(): BasisProposal[] {
    return this.proposals.open();
  }

  featureSnapshot(symbol: string): BasisFeatureSnapshot | null {
    return this.features.build(symbol, false);
  }

  lastTick(): number | null {
    return this.lastTickTs;
  }

  ticks(): number {
    return this.tickCount;
  }
}

function borrowCtxStatus(b: BorrowInfo): ScanContext['borrowStatus'] {
  return b.status;
}

function directionOf(d: Decision): BasisDirection | null {
  const dir = d.evidence['direction'];
  return dir === 'long_spot_short_perp' || dir === 'short_spot_long_perp' ? dir : null;
}

function sameConfig(left: BasisConfig, right: BasisConfig): boolean {
  const keys = Object.keys(left) as Array<keyof BasisConfig>;
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    return Array.isArray(a) && Array.isArray(b)
      ? a.length === b.length && a.every((value, index) => value === b[index])
      : a === b;
  });
}
