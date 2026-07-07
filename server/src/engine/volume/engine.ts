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
import type { WakeupSnapshot } from './types.js';

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
  private decisionsRing: Decision[] = [];
  private ignoredDecisionCount = 0;
  private killSwitchOn = false;
  private running = false;
  private lastTickTs: number | null = null;
  private lastHeartbeatTs: number | null = null;
  /** symbol → correlationId of the currently-live signal path */
  private signalCorrelation = new Map<string, string>();

  constructor(clock: Clock, cfgPartial?: Partial<VolumeConfig>, externalSink?: EventSink) {
    this.cfg = volumeConfig(cfgPartial);
    this.clock = clock;
    this.memSink = new MemoryEventSink();
    this.sink = {
      emit: (ev) => {
        this.memSink.emit(ev);
        externalSink?.emit(ev);
      },
    };
    this.features = new VolumeFeatureEngine(this.cfg, clock);
    this.detector = new WakeupDetector(this.cfg);
    this.focusMgr = new FocusManager(this.cfg, clock, this.sink);
    this.proposalStore = new ProposalStore(this.cfg, clock, this.sink);
  }

  // ---- lifecycle ----
  start(): void {
    this.running = true;
    this.sink.emit(
      makeEvent('engine_started', this.clock.now(), newCorrelationId(this.clock, 've'), 'volume engine started'),
    );
  }

  stop(): void {
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
    this.killSwitchOn = on;
  }

  killSwitch(): boolean {
    return this.killSwitchOn;
  }

  blockSymbol(symbol: string, blocked = true): void {
    if (blocked) this.blocked.add(symbol);
    else this.blocked.delete(symbol);
  }

  pin(symbol: string, pinned = true): void {
    this.features.observe(symbol);
    this.focusMgr.pin(symbol, pinned);
    if (pinned) {
      this.focusMgr.promote(symbol, 'user_pin', 0, this.correlationFor(symbol), this.clock.now());
    }
  }

  markOpenPosition(symbol: string, open: boolean): void {
    this.features.observe(symbol);
    this.focusMgr.markOpenPosition(symbol, open);
    if (open) {
      this.focusMgr.promote(symbol, 'open_position', 0, this.correlationFor(symbol), this.clock.now());
    }
  }

  setUniverse(metas: SymbolMeta[]): void {
    this.universeMap.clear();
    for (const m of metas) {
      this.universeMap.set(m.symbol, m);
      if (m.eligible) this.features.observe(m.symbol);
    }
    this.sink.emit(
      makeEvent(
        'universe_refreshed',
        this.clock.now(),
        newCorrelationId(this.clock, 've'),
        `universe: ${metas.length} symbols, ${metas.filter((m) => m.eligible).length} eligible`,
        { payload: { size: metas.length } },
      ),
    );
  }

  // ---- market data ingestion ----
  onTrade(t: TradeTick, printCount = 1): void {
    this.features.onTrade(t, printCount);
  }

  onBook(b: BookTicker): void {
    this.features.onBook(b);
  }

  // ---- execution-path bridge (manual, risk-gated; never automatic) ----
  intentFor(proposalId: string): IntentResult {
    return this.proposalStore.intentFor(proposalId, this.killSwitchOn);
  }

  // ---- core tick ----
  tick(): void {
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
        nowTs: now,
        correlationId: this.correlationFor(symbol),
      };
      const d = this.detector.evaluate(f, ctx);
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
    if (this.lastHeartbeatTs === null || now - this.lastHeartbeatTs >= this.cfg.heartbeatMs) {
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
    const meta = this.universeMap.get(symbol);
    return meta ? meta.eligible : true; // unknown symbols default-allowed in synthetic runs
  }

  private recordDecision(d: Decision): void {
    if (d.kind === 'ignore') {
      // counted, not stored — 3000 quiet symbols must not flood the ring/ledger
      this.ignoredDecisionCount++;
      return;
    }
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
    return this.decisionsRing.slice(-limit);
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
    return this.features.snapshotEx(symbol, this.focusMgr.focusAgeMs(symbol));
  }
}
