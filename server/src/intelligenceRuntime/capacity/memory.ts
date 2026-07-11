import { canonicalJson } from '../../intelligenceFoundation/contracts/index.js';
import { CAPACITY_CHANNELS, CAPACITY_MODEL_LIMITS } from './types.js';
import type {
  CapacityMemoryEstimate,
  CapacityMemoryRootEstimate,
} from './types.js';

export interface RetainedMemoryRoot {
  label: string;
  value: unknown;
}

export interface RetainedMemoryOptions {
  maximumNodes?: number;
  maximumDepth?: number;
  lagRetainedSamples?: number;
  queueAuditDestructive?: boolean;
}

interface Totals {
  nodeCount: number;
  sharedReferenceCount: number;
  stringUtf8Bytes: number;
  stringCodeUnits: number;
  modeledLowerBytes: number;
  modeledUpperBytes: number;
}

const encoder = new TextEncoder();

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function optionalOwnBoolean(
  options: RetainedMemoryOptions,
  key: 'queueAuditDestructive',
  defaultValue: boolean,
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (descriptor === undefined) return defaultValue;
  if (!Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${key} must be a data-only boolean`);
  }
  if (typeof descriptor.value !== 'boolean') {
    throw new TypeError(`${key} must be a boolean`);
  }
  return descriptor.value;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function addString(value: string, totals: Totals, countNode = true): void {
  if (value.length > CAPACITY_MODEL_LIMITS.maximumMeasuredStringCodeUnitsPerValue) {
    throw new RangeError('retained graph string exceeds its per-value hard bound');
  }
  if (totals.stringCodeUnits + value.length > CAPACITY_MODEL_LIMITS.maximumMeasuredStringCodeUnitsTotal) {
    throw new RangeError('retained graph strings exceed their aggregate hard bound');
  }
  if (countNode) totals.nodeCount += 1;
  const utf8 = byteLength(value);
  const utf16 = value.length * 2;
  totals.stringUtf8Bytes += utf8;
  totals.stringCodeUnits += value.length;
  totals.modeledLowerBytes += 16 + Math.min(utf8, utf16);
  totals.modeledUpperBytes += 32 + Math.max(utf8, utf16);
}

function delta(after: Totals, before: Totals): Omit<CapacityMemoryRootEstimate, 'label' | 'canonicalUtf8Bytes'> {
  return {
    nodeCount: after.nodeCount - before.nodeCount,
    modeledLowerBytes: after.modeledLowerBytes - before.modeledLowerBytes,
    modeledUpperBytes: after.modeledUpperBytes - before.modeledUpperBytes,
  };
}

function cloneTotals(value: Totals): Totals {
  return { ...value };
}

function canonicalBytes(value: unknown): number | null {
  try {
    return byteLength(canonicalJson(value));
  } catch {
    return null;
  }
}

/**
 * Deterministic logical retained-graph model over actual runtime snapshots and
 * destructively audited queue entries. It is deliberately not described as an
 * exact V8 heap measurement.
 */
export function measureRetainedStructures(
  roots: readonly RetainedMemoryRoot[],
  options: RetainedMemoryOptions = {},
): CapacityMemoryEstimate {
  if (!Array.isArray(roots) || roots.length === 0 || roots.length > CAPACITY_MODEL_LIMITS.maximumMemoryRoots) {
    throw new RangeError(`memory roots must contain between 1 and ${CAPACITY_MODEL_LIMITS.maximumMemoryRoots} entries`);
  }
  const queueAuditDestructive = optionalOwnBoolean(options, 'queueAuditDestructive', false);
  const maximumNodes = boundedInteger(
    options.maximumNodes ?? 500_000,
    'maximumNodes',
    1,
    CAPACITY_MODEL_LIMITS.maximumMemoryNodes,
  );
  const maximumDepth = boundedInteger(
    options.maximumDepth ?? 48,
    'maximumDepth',
    1,
    CAPACITY_MODEL_LIMITS.maximumMemoryDepth,
  );
  const lagRetainedSamples = boundedInteger(
    options.lagRetainedSamples ?? 0,
    'lagRetainedSamples',
    0,
    CAPACITY_MODEL_LIMITS.maximumLagSamplesPerSource * (CAPACITY_CHANNELS.length + 1),
  );
  const totals: Totals = {
    nodeCount: 0,
    sharedReferenceCount: 0,
    stringUtf8Bytes: 0,
    stringCodeUnits: 0,
    modeledLowerBytes: 0,
    modeledUpperBytes: 0,
  };
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): void => {
    if (depth > maximumDepth) throw new RangeError('retained graph exceeds maximumDepth');
    if (value === null) {
      totals.nodeCount += 1;
      totals.modeledLowerBytes += 4;
      totals.modeledUpperBytes += 8;
    } else if (typeof value === 'string') {
      addString(value, totals);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('retained graph contains a non-finite number');
      totals.nodeCount += 1;
      totals.modeledLowerBytes += 8;
      totals.modeledUpperBytes += 16;
    } else if (typeof value === 'boolean') {
      totals.nodeCount += 1;
      totals.modeledLowerBytes += 4;
      totals.modeledUpperBytes += 8;
    } else if (typeof value === 'bigint') {
      const digits = value.toString().length;
      totals.nodeCount += 1;
      totals.modeledLowerBytes += 16 + digits;
      totals.modeledUpperBytes += 32 + digits * 2;
    } else if (typeof value !== 'object') {
      throw new TypeError(`retained graph contains unsupported ${typeof value}`);
    } else {
      if (seen.has(value)) {
        totals.sharedReferenceCount += 1;
        return;
      }
      seen.add(value);
      totals.nodeCount += 1;
      if (Array.isArray(value)) {
        if (value.length > maximumNodes) throw new RangeError('retained graph array exceeds maximumNodes');
        if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('retained graph arrays cannot contain symbol keys');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Object.keys(descriptors);
        if (keys.some((key) => {
          if (key === 'length') return false;
          if (!/^(?:0|[1-9]\d*)$/.test(key)) return true;
          const index = Number(key);
          return !Number.isSafeInteger(index) || index >= value.length || String(index) !== key;
        })) throw new TypeError('retained graph arrays cannot contain custom properties');
        totals.modeledLowerBytes += 16 + value.length * 8;
        totals.modeledUpperBytes += 64 + value.length * 16;
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('retained graph arrays must be dense data-only values');
          }
          walk(descriptor.value, depth + 1);
        }
      } else if (value instanceof Map) {
        if (value.size > maximumNodes) throw new RangeError('retained graph map exceeds maximumNodes');
        if (Reflect.ownKeys(value).length > 0) throw new TypeError('retained graph maps cannot contain custom properties');
        totals.modeledLowerBytes += 32 + value.size * 16;
        totals.modeledUpperBytes += 96 + value.size * 48;
        for (const [key, entry] of value.entries()) {
          walk(key, depth + 1);
          walk(entry, depth + 1);
        }
      } else if (value instanceof Set) {
        if (value.size > maximumNodes) throw new RangeError('retained graph set exceeds maximumNodes');
        if (Reflect.ownKeys(value).length > 0) throw new TypeError('retained graph sets cannot contain custom properties');
        totals.modeledLowerBytes += 32 + value.size * 8;
        totals.modeledUpperBytes += 96 + value.size * 32;
        for (const entry of value.values()) walk(entry, depth + 1);
      } else if (ArrayBuffer.isView(value)) {
        if (!(value.buffer instanceof ArrayBuffer)) {
          throw new TypeError('retained graph supports only ArrayBuffer-backed binary views');
        }
        const indexedLength = 'length' in value && typeof value.length === 'number' ? value.length : 0;
        if (!Number.isSafeInteger(indexedLength) || indexedLength < 0 || indexedLength > maximumNodes) {
          throw new RangeError('retained binary view exceeds maximumNodes');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('retained binary views cannot contain symbol keys');
        const ownNames = Object.getOwnPropertyNames(value);
        if (ownNames.some((key) => {
          if (!/^(?:0|[1-9]\d*)$/.test(key)) return true;
          const index = Number(key);
          return !Number.isSafeInteger(index) || index >= indexedLength || String(index) !== key;
        })) throw new TypeError('retained binary views cannot contain custom properties');
        totals.modeledLowerBytes += 16;
        totals.modeledUpperBytes += 64;
        walk(value.buffer, depth + 1);
      } else if (value instanceof ArrayBuffer) {
        if (value.byteLength > CAPACITY_MODEL_LIMITS.maximumMeasuredBinaryBytes) throw new RangeError('retained binary backing exceeds its hard bound');
        if (Reflect.ownKeys(value).length > 0) throw new TypeError('retained binary backings cannot contain custom properties');
        totals.modeledLowerBytes += 16 + value.byteLength;
        totals.modeledUpperBytes += 64 + value.byteLength;
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError('retained graph supports only plain objects, arrays, maps, sets, and binary views');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('retained graph objects cannot contain symbol keys');
        const keys = Object.keys(descriptors).sort();
        if (keys.length > maximumNodes) throw new RangeError('retained graph object exceeds maximumNodes');
        totals.modeledLowerBytes += 16 + keys.length * 8;
        totals.modeledUpperBytes += 64 + keys.length * 24;
        for (const key of keys) {
          const descriptor = descriptors[key];
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('retained graph accessors are not measurable without executing code');
          }
          addString(key, totals, false);
          walk(descriptor.value, depth + 1);
        }
      }
    }
    if (totals.nodeCount > maximumNodes) throw new RangeError('retained graph exceeds maximumNodes');
  };

  const rootEstimates: CapacityMemoryRootEstimate[] = [];
  const labels = new Set<string>();
  for (const root of roots) {
    if (!root || typeof root.label !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(root.label)) {
      throw new TypeError('retained memory root label must be a bounded stable token');
    }
    if (labels.has(root.label)) throw new TypeError(`duplicate retained memory root ${root.label}`);
    labels.add(root.label);
    const before = cloneTotals(totals);
    walk(root.value, 0);
    rootEstimates.push(Object.freeze({
      label: root.label,
      canonicalUtf8Bytes: canonicalBytes(root.value),
      ...delta(totals, before),
    }));
  }
  const lagRetainedSampleBytes = lagRetainedSamples * 8;
  return Object.freeze({
    model: 'CAPACITY_RETAINED_GRAPH_V1',
    method: 'IDENTITY_DEDUPLICATED_GRAPH_WALK',
    roots: Object.freeze(rootEstimates),
    nodeCount: totals.nodeCount,
    sharedReferenceCount: totals.sharedReferenceCount,
    stringUtf8Bytes: totals.stringUtf8Bytes,
    stringCodeUnits: totals.stringCodeUnits,
    modeledLowerBytes: totals.modeledLowerBytes + lagRetainedSampleBytes,
    modeledUpperBytes: totals.modeledUpperBytes + lagRetainedSampleBytes,
    lagRetainedSampleBytes,
    queueAuditDestructive,
    caveat: 'Versioned logical graph estimate over actual retained roots; it is not an exact V8 heap measurement or a production capacity claim.',
  });
}
