/**
 * Basis engine — event plumbing. All engine activity flows through the v0
 * EventSink as ledger-shaped EngineEvents; production adapts Ledger.logEvent,
 * tests use MemoryEventSink. Rejections are ledgered with the same fidelity
 * as proposals — hidden rejects are forbidden (ENGINE.md §14).
 */
import type { Clock, EngineEvent, EngineEventKind, EventSink, RejectCode, StrategyId } from '../v0/types.js';

export class MemoryEventSink implements EventSink {
  readonly events: EngineEvent[] = [];

  emit(ev: EngineEvent): void {
    this.events.push(ev);
  }

  byKind(kind: EngineEventKind): EngineEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  byCorrelation(correlationId: string): EngineEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** Small helper so call sites stay one-liners and never forget fields. */
export class EventEmitter {
  constructor(
    private sink: EventSink,
    private clock: Clock,
    private strategy: StrategyId,
  ) {}

  emit(
    kind: EngineEventKind,
    correlationId: string,
    message: string,
    opts?: {
      symbol?: string | null;
      rejectCode?: RejectCode | null;
      payload?: Record<string, unknown>;
    },
  ): void {
    this.sink.emit({
      kind,
      ts: this.clock.now(),
      symbol: opts?.symbol ?? null,
      strategy: this.strategy,
      correlationId,
      rejectCode: opts?.rejectCode ?? null,
      message,
      payload: opts?.payload ?? {},
    });
  }
}
