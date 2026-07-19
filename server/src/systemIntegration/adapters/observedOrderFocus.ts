/**
 * Foundation reconciliation -> Volume focus, read-only and deliberately
 * lossy. This adapter accepts normalized owner truth only and emits symbols,
 * freshness, and authority—never order IDs, quantities, sides, prices,
 * credentials, a refresh method, or any other private transport capability.
 */
import { types as utilTypes } from 'node:util';
import {
  canonicalJson,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  normalizeObservedEvidence,
  type NormalizedObservedEvidence,
  type ObservedEvidenceInput,
} from '../../foundation/reconciliation/index.js';
import {
  OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
  OBSERVED_ORDER_FOCUS_MAX_AGE_MS,
  type ObservedOrderFocusAuthority,
  type ObservedOrderFocusSnapshot,
} from '../../engine/volume/observedOrderFocus.js';
import { MAX_ENGINE_SYMBOLS, isCanonicalSymbol } from '../../engine/volume/validation.js';

const ACTIVE_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED']);
const ACCEPTED_AUTHORITIES = new Set(['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST']);
const MAX_SNAPSHOT_DEPTH = 12;
const MAX_SNAPSHOT_NODES = 50_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 10_000;
const MAX_SNAPSHOT_OBJECT_KEYS = 64;
const MAX_SNAPSHOT_STRING_LENGTH = 10_000;
const MAX_SNAPSHOT_CHARACTERS = 2_000_000;

type PlainData = null | boolean | number | string | readonly PlainData[] | PlainRecord;
interface PlainRecord extends Readonly<Record<string, PlainData>> {}

interface SnapshotBudget {
  nodes: number;
  characters: number;
  readonly seen: WeakSet<object>;
}

const ROOT_KEYS = ['evaluatedAtMs', 'fills', 'issues', 'orders', 'positions', 'stats'];
const COLLECTION_KEYS = ['freshness', 'metadata', 'records'];

function acceptedAuthority(value: string): value is Exclude<ObservedOrderFocusAuthority, 'UNAVAILABLE'> {
  return ACCEPTED_AUTHORITIES.has(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(path: string): never {
  throw new TypeError(`${path} is not canonical normalized Foundation evidence`);
}

/**
 * Copy caller data from own data descriptors exactly once. Proxy detection is
 * deliberately first: descriptor/prototype operations on a Proxy can invoke
 * caller code. The resulting tree contains frozen ordinary data only.
 */
function snapshotPlainData(
  value: unknown,
  path: string,
  budget: SnapshotBudget,
  depth = 0,
): PlainData {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) fail(path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(path);
    return value;
  }
  if (typeof value === 'string') {
    budget.characters += value.length;
    if (value.length > MAX_SNAPSHOT_STRING_LENGTH || budget.characters > MAX_SNAPSHOT_CHARACTERS) fail(path);
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) fail(path);
  if (budget.seen.has(value)) fail(path);
  budget.seen.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail(path);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor
          || !('value' in lengthDescriptor)
          || lengthDescriptor.enumerable !== false
          || typeof lengthDescriptor.value !== 'number'
          || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
          || lengthDescriptor.value > MAX_SNAPSHOT_ARRAY_LENGTH) fail(path);
      const descriptorKeys = Reflect.ownKeys(value);
      if (descriptorKeys.length !== lengthDescriptor.value + 1
          || descriptorKeys.some((key) => typeof key === 'symbol')) fail(path);
      const out: PlainData[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) fail(`${path}[${index}]`);
        out.push(snapshotPlainData(descriptor.value, `${path}[${index}]`, budget, depth + 1));
      }
      return Object.freeze(out);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path);
    const descriptorKeys = Reflect.ownKeys(value);
    if (descriptorKeys.length > MAX_SNAPSHOT_OBJECT_KEYS
        || descriptorKeys.some((key) => typeof key === 'symbol')) fail(path);
    const out: Record<string, PlainData> = {};
    for (const key of descriptorKeys as string[]) {
      if (key.length === 0 || key.length > 200) fail(path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) fail(`${path}.${key}`);
      Object.defineProperty(out, key, {
        value: snapshotPlainData(descriptor.value, `${path}.${key}`, budget, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(out);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return fail(path);
  }
}

function exactRecord(value: PlainData, keys: readonly string[], path: string): PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) fail(path);
  return value as PlainRecord;
}

function inspectNormalizedEvidence(value: unknown): Readonly<NormalizedObservedEvidence> {
  const snapshot = snapshotPlainData(value, 'evidence', {
    nodes: 0,
    characters: 0,
    seen: new WeakSet<object>(),
  });
  const evidence = exactRecord(snapshot, ROOT_KEYS, 'evidence');
  if (!isValidUtcMillis(evidence.evaluatedAtMs) || Object.is(evidence.evaluatedAtMs, -0)) {
    fail('evidence.evaluatedAtMs');
  }
  const evaluatedAtMs = evidence.evaluatedAtMs;
  const orders = exactRecord(evidence.orders, COLLECTION_KEYS, 'evidence.orders');
  const fills = exactRecord(evidence.fills, COLLECTION_KEYS, 'evidence.fills');
  const positions = exactRecord(evidence.positions, COLLECTION_KEYS, 'evidence.positions');
  const input = {
    orders: { metadata: orders.metadata, records: orders.records },
    fills: { metadata: fills.metadata, records: fills.records },
    positions: { metadata: positions.metadata, records: positions.records },
  } as unknown as ObservedEvidenceInput;
  const canonical = normalizeObservedEvidence(input, evaluatedAtMs);
  if (canonicalJson(canonical) !== canonicalJson(evidence)) fail('evidence');
  return canonical;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function unavailable(
  evidence: Readonly<NormalizedObservedEvidence>,
  reasons: readonly string[],
): Readonly<ObservedOrderFocusSnapshot> {
  const metadata = evidence.orders.metadata;
  return Object.freeze({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: metadata.sourceId,
    authority: acceptedAuthority(metadata.authority) ? metadata.authority : 'UNAVAILABLE',
    state: 'UNAVAILABLE',
    observedAtMs: metadata.sourceTimeMs ?? metadata.receivedAtMs,
    validUntilMs: null,
    openSymbols: null,
    reasonCodes: sortedUnique(reasons),
  });
}

function projectInspectedObservedOrderFocus(
  evidence: Readonly<NormalizedObservedEvidence>,
): Readonly<ObservedOrderFocusSnapshot> {
  const orders = evidence.orders;
  const reasons: string[] = [];
  if (orders.metadata.completeness !== 'COMPLETE') reasons.push('OPEN_ORDER_TRUTH_NOT_COMPLETE');
  if (orders.freshness !== 'FRESH') reasons.push(`OPEN_ORDER_TRUTH_${orders.freshness}`);
  if (!acceptedAuthority(orders.metadata.authority)) reasons.push('OPEN_ORDER_PRIVATE_AUTHORITY_REQUIRED');
  if (orders.records === null) reasons.push('OPEN_ORDER_RECORDS_UNAVAILABLE');
  if (evidence.issues.some((issue) => issue.evidenceKind === 'ORDERS')) reasons.push('OPEN_ORDER_IDENTITY_CONFLICT');
  if (orders.records?.some((order) => order.status === 'UNKNOWN')) reasons.push('OPEN_ORDER_STATUS_UNKNOWN');
  const activeSymbols = orders.records === null
    ? null
    : orders.records.filter((order) => ACTIVE_STATUSES.has(order.status)).map((order) => order.symbol);
  if (activeSymbols?.some((symbol) => !isCanonicalSymbol(symbol))) reasons.push('OPEN_ORDER_SYMBOL_INVALID');
  const openSymbols = activeSymbols === null ? null : sortedUnique(activeSymbols);
  if (openSymbols !== null && openSymbols.length > MAX_ENGINE_SYMBOLS) {
    reasons.push('OPEN_ORDER_SYMBOL_CAP_EXCEEDED');
  }

  const observedAtMs = orders.metadata.sourceTimeMs ?? orders.metadata.receivedAtMs;
  const validUntilMs = observedAtMs + orders.metadata.maxAgeMs;
  if (!Number.isSafeInteger(validUntilMs) || validUntilMs > 4_102_444_800_000) {
    reasons.push('OPEN_ORDER_VALIDITY_HORIZON_INVALID');
  }
  if (orders.metadata.maxAgeMs > OBSERVED_ORDER_FOCUS_MAX_AGE_MS) reasons.push('OPEN_ORDER_MAX_AGE_EXCEEDED');
  if (reasons.length > 0 || openSymbols === null) return unavailable(evidence, reasons);
  return Object.freeze({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: orders.metadata.sourceId,
    authority: orders.metadata.authority as Exclude<ObservedOrderFocusAuthority, 'UNAVAILABLE'>,
    state: 'AVAILABLE',
    observedAtMs,
    validUntilMs,
    openSymbols,
    reasonCodes: Object.freeze([]),
  });
}

export interface ObservedOrderFocusEvidenceProjection {
  readonly evaluatedAtMs: number;
  readonly snapshot: Readonly<ObservedOrderFocusSnapshot>;
}

/** Inspect once, then project only the frozen local owner cut. */
export function inspectObservedOrderFocusEvidence(
  evidence: unknown,
): Readonly<ObservedOrderFocusEvidenceProjection> {
  const inspected = inspectNormalizedEvidence(evidence);
  return Object.freeze({
    evaluatedAtMs: inspected.evaluatedAtMs,
    snapshot: projectInspectedObservedOrderFocus(inspected),
  });
}

export function projectObservedOrderFocus(
  evidence: Readonly<NormalizedObservedEvidence>,
): Readonly<ObservedOrderFocusSnapshot> {
  return inspectObservedOrderFocusEvidence(evidence).snapshot;
}
