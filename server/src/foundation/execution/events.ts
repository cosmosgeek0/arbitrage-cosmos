import { deriveEventId, isValidUtcMillis, type PlanId } from '../contracts/index.js';
import type { ExecutionEvent, ExecutionEventType } from './types.js';

type EventDetails = Omit<
  ExecutionEvent,
  'eventId' | 'planId' | 'sequence' | 'occurredAtMs' | 'type'
>;

/** Deterministic event identity for one execution aggregate stream. */
export function createExecutionEvent(
  planId: PlanId,
  sequence: number,
  occurredAtMs: number,
  type: ExecutionEventType,
  details: EventDetails = {},
): Readonly<ExecutionEvent> {
  if (typeof planId !== 'string' || !planId.startsWith('plan_')) throw new TypeError('planId must be a PlanId');
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('sequence must be a non-negative safe integer');
  if (!isValidUtcMillis(occurredAtMs)) throw new TypeError('occurredAtMs must be valid UTC ms from an injected clock');
  const compactDetails: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) compactDetails[key] = value;
  }
  return Object.freeze({
    ...compactDetails,
    eventId: deriveEventId({ streamId: `execution:${planId}`, sequence }),
    planId,
    sequence,
    occurredAtMs,
    type,
  } as ExecutionEvent);
}
