import {
  findSecretLikePaths,
  findSerializabilityIssues,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import { canonicalProductJson, deepFreezeProductJson } from '../contracts/index.js';

export interface ProductOperatorEvent {
  readonly cursor: number;
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly persistedAtMs: number;
  readonly componentId: string;
  readonly correlationId: string;
  readonly material: boolean;
  readonly payload: unknown;
}

export interface ProductOperatorEventPage {
  readonly afterCursor: number;
  readonly nextCursor: number;
  readonly events: readonly Readonly<ProductOperatorEvent>[];
  readonly continuity: 'CONTINUOUS' | 'GAP_REQUIRES_BACKFILL' | 'TRUNCATED_REQUIRES_BACKFILL';
  readonly missingFromCursor: number | null;
  readonly missingToCursor: number | null;
  readonly hasMore: boolean;
}

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;

/**
 * Page an already durable monotonic stream. This is not an event store and
 * cannot repair missing ledger rows; it exposes gaps instead of hiding them.
 */
export function projectOperatorEventPage(input: Readonly<{
  afterCursor: number;
  durableFloorCursor: number;
  limit: number;
  events: readonly Readonly<ProductOperatorEvent>[];
}>): Readonly<ProductOperatorEventPage> {
  for (const [name, value] of [['afterCursor', input.afterCursor], ['durableFloorCursor', input.durableFloorCursor]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) throw new TypeError('limit must be 1..1000');
  if (!Array.isArray(input.events) || input.events.length > 100_000) throw new TypeError('events must be a bounded array');
  let previous = 0;
  const ids = new Set<string>();
  const safeEvents: ProductOperatorEvent[] = [];
  for (const event of input.events) {
    if (!Number.isSafeInteger(event.cursor) || event.cursor < 1 || event.cursor <= previous) throw new TypeError('event cursors must be strictly increasing positive integers');
    if (!ID.test(event.eventId) || ids.has(event.eventId)) throw new TypeError('event IDs must be unique bounded identifiers');
    if (!ID.test(event.componentId) || !ID.test(event.correlationId)) throw new TypeError('event component/correlation identifiers are invalid');
    if (!isValidUtcMillis(event.occurredAtMs) || !isValidUtcMillis(event.persistedAtMs)) throw new TypeError('event timestamps are invalid');
    if (typeof event.material !== 'boolean') throw new TypeError('event material flag is invalid');
    const serializability = findSerializabilityIssues(event.payload);
    if (serializability.length > 0) throw new TypeError(`event payload is not serializable: ${serializability.map((entry) => entry.code).join(',')}`);
    const secretPaths = findSecretLikePaths(event.payload);
    if (secretPaths.length > 0) throw new TypeError(`event payload contains secret-like keys: ${secretPaths.join(',')}`);
    const serializedPayload = canonicalProductJson(event.payload);
    if (new TextEncoder().encode(serializedPayload).byteLength > 262_144) throw new TypeError('event payload exceeds 262144 bytes');
    previous = event.cursor;
    ids.add(event.eventId);
    safeEvents.push(Object.freeze({ ...event, payload: deepFreezeProductJson(JSON.parse(serializedPayload)) }));
  }
  if (safeEvents.length > 0 && safeEvents[0].cursor < input.durableFloorCursor) throw new TypeError('events contain rows below durableFloorCursor');
  const available = safeEvents.filter((event) => event.cursor > input.afterCursor);
  let page = available.slice(0, input.limit);
  let continuity: ProductOperatorEventPage['continuity'] = 'CONTINUOUS';
  let missingFromCursor: number | null = null;
  let missingToCursor: number | null = null;
  if (input.afterCursor + 1 < input.durableFloorCursor) {
    continuity = 'TRUNCATED_REQUIRES_BACKFILL';
    missingFromCursor = input.afterCursor + 1;
    missingToCursor = input.durableFloorCursor - 1;
    page = [];
  } else {
    let expected = input.afterCursor + 1;
    for (let index = 0; index < page.length; index += 1) {
      const event = page[index];
      if (event.cursor > expected) {
        continuity = 'GAP_REQUIRES_BACKFILL';
        missingFromCursor = expected;
        missingToCursor = event.cursor - 1;
        page = page.slice(0, index);
        break;
      }
      expected = event.cursor + 1;
    }
  }
  return Object.freeze({
    afterCursor: input.afterCursor,
    nextCursor: page.at(-1)?.cursor ?? input.afterCursor,
    events: Object.freeze(page),
    continuity,
    missingFromCursor,
    missingToCursor,
    hasMore: available.length > page.length,
  });
}
