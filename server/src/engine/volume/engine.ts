/**
 * Volume/wakeup engine orchestrator: wires features → detector → focus →
 * proposals → events, driven by an injected Clock. Deterministic; zero I/O.
 * Live stream wiring happens in a later pass through adapters.ts interfaces.
 */
import type {
  BookTicker,
  Clock,
  Decision,
  EventSink,
  SymbolMeta,
  TradeTick,
} from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import type { VolumeConfig } from './config.js';
import { volumeConfig } from './config.js';
import { VolumeFeatureEngine } from './features.js';
import { WakeupDetector, type VolumeScanContext } from './detector.js';
import { FocusManager } from './focus.js';
import { ProposalStore, type IntentResult } from './proposals.js';
import { MemoryEventSink, makeEvent } from './events.js';
import { priorityOf } from './priority.js';
import type {
  VolumeFoundationRiskAttachmentInput,
  VolumeProposalRiskCut,
  WakeupSnapshot,
} from './types.js';
import type { SeedMinute } from './rolling.js';
import { MAX_ENGINE_SYMBOLS, isCanonicalSymbol, positive, validSymbolMeta } from './validation.js';

export class VolumeEngine {
  readonly cfg: VolumeConfig;
  readonly clock: Clock;
  readonly features: VolumeFeatureEngine;
  readonly detector: WakeupDetector;
  readonly focusMgr: FocusManager;
  readonly proposalStore: ProposalStore;
  readonly memSink: MemoryEventSink;
  private sink: EventSink;

  private universeMap = new Map<string, SymbolMeta>();
  private blocked = new Set<string>();
  private policyAllowed: Set<string> | null = null;
  private policyBlocked = new Set<string>();
  private decisionsRing: Decision[] = [];
  private ignoredDecisionCount = 0;
  private killSwitchOn = false;
  private intakePausedValue = false;
  private running = false;
  private lastTickTs: number | null = null;
  private lastHeartbeatTs: number | null = null;
  /** symbol → correlationId of the currently-live signal path */
  private signalCorrelation = new Map<string, string>();
  private universeKey = '';
  private emittedKeys = new Set<string>();
  private emittedKeyOrder: string[] = [];
  private deliveredKeys = new Set<string>();
  private deliveredKeyOrder: string[] = [];
  private inFlightDeliveryKeys = new Set<string>();
  private sinkFailureCount = 0;
  private lastDecisionKey = new Map<string, string>();
  private lastDecisionPersistedAt = new Map<string, number>();

  constructor(clock: Clock, cfgPartial?: Partial<VolumeConfig>, externalSink?: EventSink) {
    this.cfg = volumeConfig(cfgPartial);
    this.clock = clock;
    this.memSink = new MemoryEventSink();
    this.sink = { emit: (event) => this.emitSafely(event, externalSink) };
    this.features = new VolumeFeatureEngine(this.cfg, clock);
    this.detector = new WakeupDetector(this.cfg);
    this.focusMgr = new FocusManager(this.cfg, clock, this.sink);
    this.proposalStore = new ProposalStore(this.cfg, clock, this.sink);
  }

  // ---- lifecycle ----
  start(): void {
    if (this.running) return;
    this.running = true;
    this.sink.emit(
      makeEvent('engine_started', this.clock.now(), newCorrelationId(this.clock, 've'), 'volume engine started'),
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.sink.emit(
      makeEvent('engine_stopped', this.clock.now(), newCorrelationId(this.clock, 've'), 'volume engine stopped'),
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  // ---- control ----
  setKillSwitch(on: boolean): void {
    // NOTE for Director: v0 EngineEventKind has no kill_switch_changed —
    // ENGINE.md §14 lists it. Flagged in the lane report; not ledgered here.
    this.killSwitchOn = on === true;
  }

  killSwitch(): boolean {
    return this.killSwitchOn;
  }

  /** Pause proposal formation only; all market observation and focus evidence continues. */
  setIntakePaused(paused: boolean): boolean {
    if (typeof paused !== 'boolean') throw new TypeError('volume intake posture must be boolean');
    if (paused === this.intakePausedValue) return false;
    this.intakePausedValue = paused;
    this.sink.emit(makeEvent(
      'heartbeat',
      this.clock.now(),
      newCorrelationId(this.clock, 've'),
      `volume proposal intake ${paused ? 'paused' : 'resumed'}`,
      { payload: { intakePaused: paused } },
    ));
    return true;
  }

  intakePaused(): boolean {
    return this.intakePausedValue;
  }

  blockSymbol(symbol: string, blocked = true): void {
    if (!isCanonicalSymbol(symbol)) return;
    if (blocked) {
      if (!this.universeMap.has(symbol) || this.blocked.size >= MAX_ENGINE_SYMBOLS) return;
      this.blocked.add(symbol);
    }
    else this.blocked.delete(symbol);
  }

  /** Apply the operator's current allow/block lists without rebuilding the engine. */
  setSymbolPolicy(allowedSymbols: readonly string[] | null, blockedSymbols: readonly string[]): void {
    this.policyAllowed = allowedSymbols === null
      ? null
      : new Set(allowedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol).slice(0, MAX_ENGINE_SYMBOLS));
    this.policyBlocked = new Set(
      blockedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol).slice(0, MAX_ENGINE_SYMBOLS),
    );
  }

  setSuggestedNotionalUsd(value: number): void {
    if (positive(value)) this.cfg.suggestedNotionalUsd = Math.min(value, 1_000_000);
  }

  pin(symbol: string, pinned = true): void {
    if (!this.universeMap.get(symbol)?.eligible || !this.features.observe(symbol)) return;
    this.focusMgr.pin(symbol, pinned);
    if (pinned) {
      this.focusMgr.promote(symbol, 'user_pin', 0, this.correlationFor(symbol), this.clock.now());
    }
  }

  markOpenPosition(symbol: string, open: boolean): void {
    if (!this.universeMap.get(symbol)?.eligible || !this.features.observe(symbol)) return;
    this.focusMgr.markOpenPosition(symbol, open);
    if (open) {
      this.focusMgr.promote(symbol, 'open_position', 0, this.correlationFor(symbol), this.clock.now());
    }
  }

  setUniverse(metas: SymbolMeta[]): void {
    const next = new Map<string, SymbolMeta>();
    for (const m of metas.slice(0, MAX_ENGINE_SYMBOLS * 2)) {
      if (next.size >= MAX_ENGINE_SYMBOLS) break;
      if (!validSymbolMeta(m) || next.has(m.symbol)) continue;
      const normalized = { ...m };
      next.set(normalized.symbol, normalized);
    }
    const eligible = new Set([...next.values()].filter((meta) => meta.eligible).map((meta) => meta.symbol));
    const nextKey = JSON.stringify([...next.values()]);

    this.proposalStore.reconcileSymbols(eligible);
    this.focusMgr.reconcileSymbols(eligible);
    this.features.reconcileSymbols(eligible);
    for (const symbol of eligible) this.features.observe(symbol);
    for (const symbol of this.blocked) if (!next.has(symbol)) this.blocked.delete(symbol);
    for (const symbol of this.signalCorrelation.keys()) if (!eligible.has(symbol)) this.signalCorrelation.delete(symbol);
    for (const symbol of this.lastDecisionKey.keys()) if (!eligible.has(symbol)) this.lastDecisionKey.delete(symbol);
    for (const symbol of this.lastDecisionPersistedAt.keys()) {
      if (!eligible.has(symbol)) this.lastDecisionPersistedAt.delete(symbol);
    }
    this.decisionsRing = this.decisionsRing.filter((decision) => eligible.has(decision.symbol));
    this.universeMap = next;

    if (nextKey === this.universeKey) return;
    this.universeKey = nextKey;
    this.sink.emit(
      makeEvent(
        'universe_refreshed',
        this.clock.now(),
        newCorrelationId(this.clock, 've'),
        `universe: ${next.size} symbols, ${eligible.size} eligible`,
        { payload: { size: next.size, eligible: eligible.size } },
      ),
    );
  }

  // ---- market data ingestion ----
  onTrade(t: TradeTick, printCount = 1): boolean {
    if (!this.universeMap.get(t.symbol)?.eligible) return false;
    return this.features.onTrade(t, printCount);
  }

  onBook(b: BookTicker): boolean {
    if (!this.universeMap.get(b.symbol)?.eligible) return false;
    return this.features.onBook(b);
  }

  seedMinute(symbol: string, sample: SeedMinute): boolean {
    if (!this.universeMap.get(symbol)?.eligible) return false;
    return this.features.seedMinute(symbol, sample);
  }

  // ---- execution-path bridge (manual, risk-gated; never automatic) ----
  intentFor(proposalId: string): IntentResult {
    return this.proposalStore.intentFor(proposalId, this.killSwitchOn);
  }

  readProposalRiskCut(proposalId: string): Readonly<VolumeProposalRiskCut> | null {
    return this.proposalStore.readProposalRiskCut(proposalId);
  }

  recordFoundationRiskResult(input: Readonly<VolumeFoundationRiskAttachmentInput>): boolean {
    return this.proposalStore.recordFoundationRiskResult(input);
  }

  // ---- core tick ----
  tick(): void {
    if (!this.running) return;
    const now = this.clock.now();
    for (const symbol of this.features.symbols()) {
      // COOLDOWN = temporarily ignored (ENGINE.md §5); protected symbols never cool down
      if (this.focusMgr.inCooldown(symbol)) {
        this.ignoredDecisionCount++;
        continue;
      }
      const f = this.features.snapshotEx(symbol, this.focusMgr.focusAgeMs(symbol));
      if (!f) continue;
      const ctx: VolumeScanContext = {
        killSwitch: this.killSwitchOn,
        symbolAllowed: this.symbolAllowed(symbol),
        borrowStatus: 'not_needed',
        // The detector decision and proposal owner fields must bind to the
        // exact feature cut, even when a production clock advances mid-tick.
        nowTs: f.ts,
        correlationId: this.correlationFor(symbol),
      };
      const evaluated = this.detector.evaluate(f, ctx);
      const d: Decision = this.intakePausedValue && evaluated.kind === 'proposal'
        ? {
            ...evaluated,
            kind: 'reject',
            rejectCode: 'intake_paused',
            humanReason: 'volume proposal intake is paused; observation remains active',
            evidence: { ...evaluated.evidence, intakePaused: true },
          }
        : evaluated;
      if (d.kind === 'ignore') this.signalCorrelation.delete(symbol);
      this.recordDecision(d);
      this.focusMgr.noteDecision(d, priorityOf(f, this.cfg).score);
      if (d.kind === 'proposal' && this.focusMgr.isFocused(symbol)) {
        this.proposalStore.upsertFromDecision(d, f);
        this.focusMgr.markProposed(symbol);
      }
    }
    // invalidation must outlive cooldown: re-check every open proposal even
    // when its symbol is no longer evaluated above
    for (const p of this.proposalStore.openProposals()) {
      const f = this.features.snapshotEx(p.symbol, this.focusMgr.focusAgeMs(p.symbol));
      if (f) this.proposalStore.refresh(f);
    }
    this.focusMgr.tick();
    if (
      this.lastHeartbeatTs === null ||
      now < this.lastHeartbeatTs ||
      now - this.lastHeartbeatTs >= this.cfg.heartbeatMs
    ) {
      this.lastHeartbeatTs = now;
      this.sink.emit(
        makeEvent('heartbeat', now, newCorrelationId(this.clock, 've'), 'volume engine heartbeat', {
          payload: { focused: this.focusMgr.focusSessions().length },
        }),
      );
    }
    this.lastTickTs = now;
  }

  private correlationFor(symbol: string): string {
    let cid = this.signalCorrelation.get(symbol);
    if (!cid) {
      cid = newCorrelationId(this.clock, 'vs');
      this.signalCorrelation.set(symbol, cid);
    }
    return cid;
  }

  private symbolAllowed(symbol: string): boolean {
    if (this.blocked.has(symbol)) return false;
    if (this.policyBlocked.has(symbol)) return false;
    if (this.policyAllowed !== null && !this.policyAllowed.has(symbol)) return false;
    const meta = this.universeMap.get(symbol);
    return meta?.eligible === true;
  }

  private recordDecision(d: Decision): void {
    if (d.kind === 'ignore') {
      // counted, not stored — 3000 quiet symbols must not flood the ring/ledger
      this.ignoredDecisionCount++;
      return;
    }
    const decisionKey = JSON.stringify({
      correlationId: d.correlationId,
      kind: d.kind,
      rejectCode: d.rejectCode,
      humanReason: d.humanReason,
      evidence: d.evidence,
    });
    const previousKey = this.lastDecisionKey.get(d.symbol);
    const previousAt = this.lastDecisionPersistedAt.get(d.symbol) ?? -Infinity;
    if (
      decisionKey === previousKey &&
      d.ts >= previousAt &&
      d.ts - previousAt < this.cfg.heartbeatMs
    ) return;
    this.lastDecisionKey.set(d.symbol, decisionKey);
    this.lastDecisionPersistedAt.set(d.symbol, d.ts);
    this.decisionsRing.push(d);
    if (this.decisionsRing.length > 2_000) this.decisionsRing.splice(0, this.decisionsRing.length - 2_000);
    this.sink.emit(
      makeEvent('strategy_decision', d.ts, d.correlationId, d.humanReason, {
        symbol: d.symbol,
        rejectCode: d.rejectCode,
        payload: { kind: d.kind, evidence: d.evidence },
      }),
    );
  }

  // ---- snapshot accessors ----
  decisions(limit = 100): Decision[] {
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, 2_000)) : 100;
    if (safeLimit === 0) return [];
    return this.decisionsRing.slice(-safeLimit);
  }

  ignoredCount(): number {
    return this.ignoredDecisionCount;
  }

  universe(): SymbolMeta[] {
    return [...this.universeMap.values()];
  }

  lastTick(): number | null {
    return this.lastTickTs;
  }

  featureSnapshot(symbol: string): WakeupSnapshot | null {
    if (!this.universeMap.get(symbol)?.eligible) return null;
    return this.features.snapshotEx(symbol, this.focusMgr.focusAgeMs(symbol));
  }

  sinkFailures(): number {
    return this.sinkFailureCount;
  }

  private emitSafely(event: Parameters<EventSink['emit']>[0], externalSink?: EventSink): void {
    let key: string;
    try {
      key = JSON.stringify(event);
    } catch {
      this.sinkFailureCount += 1;
      return;
    }
    if (!this.emittedKeys.has(key)) {
      this.emittedKeys.add(key);
      this.emittedKeyOrder.push(key);
      if (this.emittedKeyOrder.length > 5_000) {
        const removed = this.emittedKeyOrder.shift();
        if (removed !== undefined) this.emittedKeys.delete(removed);
      }
      this.memSink.emit(event);
    }
    if (!externalSink) return;
    if (this.deliveredKeys.has(key) || this.inFlightDeliveryKeys.has(key)) return;
    if (this.inFlightDeliveryKeys.size >= 5_000) {
      this.sinkFailureCount += 1;
      return;
    }
    try {
      const result = externalSink.emit(event) as unknown;
      if (result && typeof (result as PromiseLike<void>).then === 'function') {
        this.inFlightDeliveryKeys.add(key);
        void Promise.resolve(result).then(
          () => {
            this.inFlightDeliveryKeys.delete(key);
            this.rememberDelivered(key);
          },
          () => {
            this.inFlightDeliveryKeys.delete(key);
            this.sinkFailureCount += 1;
          },
        );
      } else {
        this.rememberDelivered(key);
      }
    } catch {
      this.sinkFailureCount += 1;
    }
  }

  private rememberDelivered(key: string): void {
    if (this.deliveredKeys.has(key)) return;
    this.deliveredKeys.add(key);
    this.deliveredKeyOrder.push(key);
    if (this.deliveredKeyOrder.length > 5_000) {
      const removed = this.deliveredKeyOrder.shift();
      if (removed !== undefined) this.deliveredKeys.delete(removed);
    }
  }
}
