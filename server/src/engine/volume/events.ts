/**
 * Event plumbing. Production will adapt the real Ledger to the v0 EventSink;
 * this lane ships a memory sink (tests + snapshots) and a tiny emit helper so
 * every module writes identically-shaped EngineEvents.
 */
import type { EngineEvent, EngineEventKind, EventSink, RejectCode, StrategyId } from '../v0/types.js';

export class MemoryEventSink implements EventSink {
  private events: EngineEvent[] = [];
  constructor(private cap = 5_000) {}

  emit(ev: EngineEvent): void {
    this.events.push(ev);
    if (this.events.length > this.cap) this.events.splice(0, this.events.length - this.cap);
  }

  all(): EngineEvent[] {
    return [...this.events];
  }

  recent(limit = 100): EngineEvent[] {
    return this.events.slice(-limit);
  }

  byKind(kind: EngineEventKind): EngineEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  byCorrelation(correlationId: string): EngineEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  count(): number {
    return this.events.length;
  }
}

export function makeEvent(
  kind: EngineEventKind,
  ts: number,
  correlationId: string,
  message: string,
  opts: {
    symbol?: string | null;
    strategy?: StrategyId | null;
    rejectCode?: RejectCode | null;
    payload?: Record<string, unknown>;
  } = {},
): EngineEvent {
  return {
    kind,
    ts,
    symbol: opts.symbol ?? null,
    strategy: opts.strategy ?? 'volume_spike',
    correlationId,
    rejectCode: opts.rejectCode ?? null,
    message,
    payload: opts.payload ?? {},
  };
}
