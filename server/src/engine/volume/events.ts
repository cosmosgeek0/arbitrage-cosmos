/**
 * Event plumbing. Production will adapt the real Ledger to the v0 EventSink;
 * this lane ships a memory sink (tests + snapshots) and a tiny emit helper so
 * every module writes identically-shaped EngineEvents.
 */
import type { EngineEvent, EngineEventKind, EventSink, RejectCode, StrategyId } from '../v0/types.js';

const MAX_PAYLOAD_KEYS = 64;
const MAX_ARRAY_ITEMS = 64;
const MAX_STRING_LENGTH = 1_024;
const MAX_PAYLOAD_DEPTH = 4;

function boundedValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (depth >= MAX_PAYLOAD_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundedValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_PAYLOAD_KEYS)) {
      out[key.slice(0, 128)] = boundedValue(child, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function boundedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return boundedValue(payload, 0) as Record<string, unknown>;
}

export function boundedEvidence(
  evidence: Record<string, number | string | boolean | null>,
): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, value] of Object.entries(evidence).slice(0, MAX_PAYLOAD_KEYS)) {
    if (typeof value === 'number') out[key.slice(0, 128)] = Number.isFinite(value) ? value : null;
    else if (typeof value === 'string') out[key.slice(0, 128)] = value.slice(0, MAX_STRING_LENGTH);
    else if (typeof value === 'boolean' || value === null) out[key.slice(0, 128)] = value;
  }
  return out;
}

export class MemoryEventSink implements EventSink {
  private events: EngineEvent[] = [];
  constructor(private cap = 5_000) {
    this.cap = Number.isSafeInteger(cap) ? Math.max(100, Math.min(cap, 20_000)) : 5_000;
  }

  emit(ev: EngineEvent): void {
    this.events.push(ev);
    if (this.events.length > this.cap) this.events.splice(0, this.events.length - this.cap);
  }

  all(): EngineEvent[] {
    return [...this.events];
  }

  recent(limit = 100): EngineEvent[] {
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, this.cap)) : 100;
    if (safeLimit === 0) return [];
    return this.events.slice(-safeLimit);
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
    message: message.slice(0, MAX_STRING_LENGTH),
    payload: boundedPayload(opts.payload ?? {}),
  };
}
