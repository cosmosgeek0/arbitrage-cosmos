/**
 * Test-only fixtures for the L01 frozen edge-protocol compatibility harness.
 *
 * The protocol schema and its fixtures remain owned by packages/edge-protocol.
 * This module reads those frozen artifacts without modifying them and owns only
 * L-lane test data. It performs no network, environment, timer, clock, secret,
 * account, exchange, capital, or execution work.
 */
import { readFileSync } from 'node:fs';

const PROTOCOL_SCHEMA_URL = new URL(
  '../../../../packages/edge-protocol/schema/edge-protocol-v1.schema.json',
  import.meta.url,
);
const PROTOCOL_FIXTURES_URL = new URL(
  '../../../../packages/edge-protocol/fixtures/fixtures-v1.json',
  import.meta.url,
);

const MIN_UTC_MILLIS = 1_262_304_000_000;
const MAX_UTC_MILLIS = 4_102_444_800_000;
const ACTIONABLE_TTL_MS = 60_000;

export const FROZEN_PROTOCOL_SCHEMA_TEXT = readFileSync(PROTOCOL_SCHEMA_URL, 'utf8');
export const FROZEN_PROTOCOL_FIXTURES_TEXT = readFileSync(PROTOCOL_FIXTURES_URL, 'utf8');

// Short aliases make the raw frozen inputs convenient in protocol-focused tests.
export const rawProtocolSchemaText = FROZEN_PROTOCOL_SCHEMA_TEXT;
export const rawProtocolFixturesText = FROZEN_PROTOCOL_FIXTURES_TEXT;

function compareByCodePoint(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function isPlainJsonObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Canonical JSON used only to produce deterministic raw test frames.
 * Object keys are ordered by Unicode code point and unsupported JSON values
 * fail rather than being silently omitted or converted.
 */
export function stableCanonicalJson(value) {
  const ancestors = new WeakSet();

  function visit(current, trail) {
    if (current === null || typeof current === 'boolean' || typeof current === 'string') {
      return JSON.stringify(current);
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(`${trail} contains a non-finite number`);
      return JSON.stringify(current);
    }
    if (typeof current !== 'object') {
      throw new TypeError(`${trail} contains a non-JSON value`);
    }
    if (ancestors.has(current)) throw new TypeError(`${trail} contains a cycle`);

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          throw new TypeError(`${trail} must be a plain array`);
        }
        if (Object.getOwnPropertySymbols(current).length > 0) {
          throw new TypeError(`${trail} contains symbol keys`);
        }
        const descriptors = Object.getOwnPropertyDescriptors(current);
        const elementKeys = Object.keys(descriptors).filter((key) => key !== 'length');
        if (elementKeys.length !== current.length) {
          throw new TypeError(`${trail} contains custom array keys`);
        }
        const items = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined) throw new TypeError(`${trail} contains a sparse array`);
          if (!Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${trail}[${index}] contains an accessor`);
          }
          if (!descriptor.enumerable) {
            throw new TypeError(`${trail}[${index}] must be enumerable JSON data`);
          }
          items.push(visit(descriptor.value, `${trail}[${index}]`));
        }
        return `[${items.join(',')}]`;
      }

      if (!isPlainJsonObject(current)) throw new TypeError(`${trail} must be a plain object`);
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new TypeError(`${trail} contains symbol keys`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Object.keys(descriptors).sort(compareByCodePoint);
      const members = keys.map((key) => {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(`${trail}.${key} contains an accessor`);
        }
        if (!descriptor.enumerable) {
          throw new TypeError(`${trail}.${key} must be enumerable JSON data`);
        }
        return `${JSON.stringify(key)}:${visit(descriptor.value, `${trail}.${key}`)}`;
      });
      return `{${members.join(',')}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, '$');
}

export function cloneJson(value) {
  return JSON.parse(stableCanonicalJson(value));
}

export const clone = cloneJson;

export function loadFrozenProtocolSchemaText() {
  return FROZEN_PROTOCOL_SCHEMA_TEXT;
}

export function loadFrozenProtocolSchema() {
  return JSON.parse(FROZEN_PROTOCOL_SCHEMA_TEXT);
}

export function loadFrozenProtocolFixtures() {
  return JSON.parse(FROZEN_PROTOCOL_FIXTURES_TEXT);
}

export const loadFrozenFixtures = loadFrozenProtocolFixtures;

export function cloneFrozenFixture(name, collection = 'valid') {
  if (collection !== 'valid' && collection !== 'invalid') {
    throw new TypeError('collection must be valid or invalid');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('fixture name is required');
  }
  const fixture = loadFrozenProtocolFixtures()[collection].find((entry) => entry.name === name);
  if (fixture === undefined) throw new RangeError(`unknown frozen ${collection} fixture ${name}`);
  return cloneJson(fixture);
}

function mergeJson(base, patch, trail = '$') {
  if (!isPlainJsonObject(patch)) return cloneJson(patch);
  if (!isPlainJsonObject(base)) return cloneJson(patch);

  const output = cloneJson(base);
  for (const [key, patchValue] of Object.entries(patch)) {
    const nextValue = isPlainJsonObject(patchValue) && isPlainJsonObject(output[key])
      ? mergeJson(output[key], patchValue, `${trail}.${key}`)
      : cloneJson(patchValue);
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: nextValue,
      writable: true,
    });
  }
  return output;
}

/**
 * Builds a schema-valid, semantically actionable assessment at an explicit
 * injected time. Overrides are deep-merged for negative-case tests; arrays
 * and primitive values replace the base value.
 */
export function buildActionableAssessment(nowMs, overrides = {}) {
  if (
    !Number.isSafeInteger(nowMs)
    || nowMs < MIN_UTC_MILLIS
    || nowMs > MAX_UTC_MILLIS - ACTIONABLE_TTL_MS
  ) {
    throw new RangeError('nowMs must be a safe protocol UTC millisecond with future TTL capacity');
  }
  if (!isPlainJsonObject(overrides)) throw new TypeError('overrides must be a plain object');

  const expiresAtMs = nowMs + ACTIONABLE_TTL_MS;
  const assessment = {
    schema: 'EdgeAssessmentEnvelopeV1',
    version: 1,
    revision: 0,
    assessmentId: 'as_l01_actionable_0001',
    traceId: 'tr_l01_actionable_0001',
    parentEvidenceIds: ['ev_l01_spot_0001', 'ev_l01_perp_0001'],
    strategyFamily: 'BASIS_CONVERGENCE',
    hypothesisId: 'hyp_l01_basis_v1',
    instrumentGraph: {
      venue: 'BINANCE',
      product: 'USDM_PERP',
      symbol: 'BTCUSDT',
      canonicalAsset: 'BTC',
      spotSymbol: 'BTCUSDT',
      perpSymbol: 'BTCUSDT',
      borrowAsset: null,
      missingLegReason: null,
    },
    eventTimeMs: nowMs,
    receiveTimeMs: nowMs,
    generationTimeMs: nowMs,
    expiryTimeMs: expiresAtMs,
    marketStageProbabilities: {
      EARLY_CHANGE: 0.8,
      QUIET: 0.2,
    },
    regimeProbabilities: {
      RANGE_BOUND: 0.3,
      RISK_ON: 0.7,
    },
    predictions: [
      {
        target: 'basis_convergence_60s',
        horizonMs: 60_000,
        quantiles: {
          p10: '-0.00050000',
          p50: '0.00170000',
          p90: '0.00320000',
        },
      },
    ],
    uncertainty: {
      epistemic: 'LOW',
      model: 'LOW',
      data: 'LOW',
    },
    oodState: 'IN_DISTRIBUTION',
    driftState: 'STABLE',
    grossEstimate: '0.08000000',
    costEstimates: {
      fee: '0.00800000',
      spread: '0.00400000',
      slippage: '0.00300000',
      funding: '0.00100000',
      borrow: '0.00000000',
      latency: '0.00200000',
      recovery: '0.00200000',
    },
    netExpectedValue: {
      state: 'ESTIMATED',
      quantiles: {
        p10: '0.01000000',
        p50: '0.06000000',
        p90: '0.10000000',
      },
    },
    capacityEvidence: {
      intendedSize: '10.00000000',
      supportedSize: '10.00000000',
      quoteCurrency: 'USDT',
    },
    evidence: {
      supporting: ['fresh spot and perp public evidence agree'],
      conflicting: [],
      missing: [],
    },
    featureAttribution: [
      { feature: 'basis_z_score', contribution: '0.60000000' },
      { feature: 'book_depth', contribution: '0.40000000' },
    ],
    analogues: [
      { analogueId: 'analogue_l01_0001', laterOutcomeRef: null },
    ],
    lineage: {
      datasetVersion: 'ds_l01_v1',
      featureVersion: 'ft_l01_v1',
      labelVersion: 'lb_l01_v1',
      modelVersion: 'md_l01_v1',
      calibrationVersion: 'cal_l01_v1',
    },
    sourceQuality: {
      freshness: 'FRESH',
      completeness: 'COMPLETE',
      gapCount: 0,
      duplicate: false,
      reconstructed: false,
    },
    advisoryAction: 'PROPOSE_CONSIDERATION',
    abstentionReasonCodes: [],
    invalidationConditions: [
      'effective expiry reached',
      'source quality loses completeness or freshness',
      'model moves out of distribution or begins drifting',
    ],
    economicAssumptionContext: {
      asOfMs: nowMs,
      expiresAtMs,
      state: 'LIVE',
      intendedSize: '10.00000000',
      quoteCurrency: 'USDT',
      feeTier: {
        source: 'synthetic_test_complete_fixture',
        makerBps: '1.00000000',
        takerBps: '4.00000000',
        uncertainty: null,
      },
      spreadSlippageModel: {
        name: 'l01_complete_depth_model',
        version: '1.0.0',
      },
      funding: {
        rate: '0.00010000',
        intervalHours: 8,
        nextFundingTimeMs: nowMs + 30_000,
        source: 'synthetic_test_public_funding',
      },
      borrow: {
        availability: 'AVAILABLE',
        quantity: '1.00000000',
        rateHourly: '0.00001000',
        interestConvention: 'hourly_simple',
        expiresAtMs,
      },
      latencyScenarioMs: 100,
      recoveryCostScenario: '0.00200000',
      missingFields: [],
      sourceSnapshotIds: ['ev_l01_spot_0001', 'ev_l01_perp_0001'],
    },
  };

  return mergeJson(assessment, overrides);
}

export const actionableAssessment = buildActionableAssessment;

export function canonicalFrame(value) {
  return stableCanonicalJson(value);
}

export const frameFromEnvelope = canonicalFrame;

/** Clone a string or byte frame without decoding or changing its wire bytes. */
export function cloneFrame(frame) {
  if (typeof frame === 'string') return `${frame}`;
  if (Buffer.isBuffer(frame)) return Buffer.from(frame);
  if (frame instanceof Uint8Array) return frame.slice();
  throw new TypeError('frame must be a string, Buffer, or Uint8Array');
}

function decodeFrame(frame) {
  if (typeof frame === 'string') return { kind: 'string', text: frame };
  if (Buffer.isBuffer(frame)) {
    return {
      kind: 'buffer',
      text: new TextDecoder('utf-8', { fatal: true }).decode(frame),
    };
  }
  if (frame instanceof Uint8Array) {
    return {
      kind: 'uint8array',
      text: new TextDecoder('utf-8', { fatal: true }).decode(frame),
    };
  }
  throw new TypeError('frame must be a string, Buffer, or Uint8Array');
}

/**
 * Decode, detach, mutate, and canonically re-encode a raw test frame. The
 * returned representation matches the input representation.
 */
export function mutateFrame(frame, mutator) {
  if (typeof mutator !== 'function') throw new TypeError('mutator must be a function');
  const decoded = decodeFrame(frame);
  const draft = cloneJson(JSON.parse(decoded.text));
  const returned = mutator(draft);
  const value = returned === undefined ? draft : returned;
  const canonical = stableCanonicalJson(value);

  if (decoded.kind === 'string') return canonical;
  if (decoded.kind === 'buffer') return Buffer.from(canonical, 'utf8');
  return new TextEncoder().encode(canonical);
}

export function cloneAndMutate(value, mutator) {
  if (typeof mutator !== 'function') throw new TypeError('mutator must be a function');
  const draft = cloneJson(value);
  const returned = mutator(draft);
  return cloneJson(returned === undefined ? draft : returned);
}
