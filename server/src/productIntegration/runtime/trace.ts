import type { SystemTraceEvent, SystemTraceSnapshot } from '../../systemIntegration/contracts/types.js';
import { productTruthLabel } from './events.js';
import { ProductRuntimeError, type ProductRuntimeCorrelationTrace, type ProductRuntimeTraceStage } from './types.js';

export const PRODUCT_RUNTIME_TRACE_STAGES = Object.freeze([
  'Market Source',
  'Normalized Evidence',
  'Attention / Focus',
  'Q Assessment',
  'Basis / Volume Decision',
  'Capital Verdict',
  'Risk Verdict',
  'Ticket / Plan',
  'Reconciliation',
  'Position / Recovery',
  'PnL / Cost Attribution',
  'Outcome Feedback',
] as const);

const STAGE_OWNERS = Object.freeze([
  'intelligenceRuntime public source adapter',
  'intelligenceRuntime',
  'intelligenceFoundation',
  'Q advisory owner',
  'Basis / Volume engine owner',
  'capitalFoundation',
  'foundation risk owner',
  'foundation execution owner',
  'foundation reconciliation owner',
  'capitalFoundation recovery owner',
  'capitalFoundation economics owner',
  'outcome feedback owner',
] as const);

const TRACE_ID = /^[A-Za-z0-9_.:\-]{1,160}$/;

export function isProductRuntimeTraceId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_ID.test(value);
}

function qMarker(event: Readonly<SystemTraceEvent>): boolean {
  const values = [event.ownerId, event.canonicalProjectionId, ...event.referenceIds].filter((value): value is string => value !== null);
  return values.some((value) => /(^|[_.:\/-])q([_.:\/-]|$)|assessment/i.test(value));
}

function stageIndex(event: Readonly<SystemTraceEvent>): number | null {
  if (event.kind === 'SOURCE') return 0;
  if (event.kind === 'INTELLIGENCE') {
    if (qMarker(event)) return 3;
    return event.componentId === 'market-intelligence' ? 2 : 1;
  }
  if (event.kind === 'STRATEGY') return 4;
  if (event.kind === 'CAPITAL') return 5;
  if (event.kind === 'RISK') return 6;
  if (event.kind === 'EXECUTION') return 7;
  if (event.kind === 'RECONCILIATION') return 8;
  return null;
}

function newer(left: Readonly<SystemTraceEvent>, right: Readonly<SystemTraceEvent>): boolean {
  return left.occurredAtMs > right.occurredAtMs
    || (left.occurredAtMs === right.occurredAtMs && left.sequence > right.sequence)
    || (left.occurredAtMs === right.occurredAtMs && left.sequence === right.sequence && left.id > right.id);
}

function missingStage(index: number, truncated: boolean): Readonly<ProductRuntimeTraceStage> {
  return Object.freeze({
    stage: PRODUCT_RUNTIME_TRACE_STAGES[index]!,
    owner: STAGE_OWNERS[index]!,
    referenceId: null,
    occurredAtMs: null,
    // A source-level truncation bit cannot prove which canonical stage was
    // omitted. Preserve uncertainty and never infer owner configuration from
    // the absence of a correlation event.
    outcome: truncated ? 'UNKNOWN_DUE_TO_TRACE_TRUNCATION' : 'NO_EVENT_PUBLISHED',
    truthLabel: truncated ? 'UNKNOWN' : 'MISSING',
    evidenceState: truncated ? 'UNKNOWN_DUE_TO_TRUNCATION' : 'ABSENT',
  });
}

export function projectProductCorrelationTrace(
  correlationId: string,
  snapshot: Readonly<SystemTraceSnapshot>,
): Readonly<ProductRuntimeCorrelationTrace> {
  if (!isProductRuntimeTraceId(correlationId)) {
    throw new ProductRuntimeError('INVALID_TRACE_ID', 'correlationId is invalid.', 400);
  }
  if (!snapshot || snapshot.correlationId !== correlationId || !Array.isArray(snapshot.events)
      || typeof snapshot.truncated !== 'boolean') {
    throw new ProductRuntimeError('TRACE_SOURCE_INVALID', 'Trace owner returned an invalid correlation snapshot.', 503);
  }
  const selected = new Map<number, Readonly<SystemTraceEvent>>();
  for (const event of snapshot.events) {
    if (!event || event.correlationId !== correlationId) {
      throw new ProductRuntimeError('TRACE_SOURCE_INVALID', 'Trace owner returned mismatched correlation evidence.', 503);
    }
    const index = stageIndex(event);
    if (index === null) continue;
    const prior = selected.get(index);
    if (!prior || newer(event, prior)) selected.set(index, event);
  }
  const stages = PRODUCT_RUNTIME_TRACE_STAGES.map((_stage, index) => {
    const event = selected.get(index);
    if (!event) return missingStage(index, snapshot.truncated);
    return Object.freeze({
      stage: PRODUCT_RUNTIME_TRACE_STAGES[index]!,
      owner: event.ownerId ?? STAGE_OWNERS[index]!,
      referenceId: event.canonicalProjectionId ?? event.referenceIds[0] ?? event.id,
      occurredAtMs: event.occurredAtMs,
      outcome: event.failure?.code ?? event.domainLifecycle ?? event.kind,
      truthLabel: productTruthLabel(event.truthLabel),
      evidenceState: 'PRESENT' as const,
    });
  });
  return Object.freeze({
    correlationId,
    symbol: null,
    truncated: snapshot.truncated,
    completeness: snapshot.truncated ? 'TRUNCATED' : 'COMPLETE',
    stages: Object.freeze(stages),
  });
}
