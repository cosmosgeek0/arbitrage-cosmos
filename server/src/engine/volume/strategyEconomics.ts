/**
 * Volume strategy economics — pure, public-source, no-authority contracts.
 *
 * The accepted historical result is deliberately represented as a bounded
 * strategy-class calibration proxy. It is never projected into a proposal's
 * source-native gross/net edge. A separate, explicitly synthetic fixture is
 * available only to prove the validate-only record path in focused tests.
 *
 * Pure module: no I/O, clocks, timers, environment, credentials, providers,
 * private data, or order/submit capability.
 */
import { types as utilTypes } from 'node:util';

import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';

export const VOLUME_ECONOMICS_SCHEMAS = Object.freeze({
  conditionalProxy: 'VOLUME_CONDITIONAL_PROXY_ECONOMICS_V1',
  syntheticSourceNative: 'VOLUME_SYNTHETIC_SOURCE_NATIVE_ECONOMICS_V1',
  assessment: 'VOLUME_ECONOMICS_ASSESSMENT_V1',
} as const);

export type VolumeEconomicsEvidenceClass = 'CONDITIONAL_PROXY_ONLY' | 'SYNTHETIC_TEST';
export type VolumeEconomicsAdmissibility = 'REJECT_ONLY' | 'VALIDATE_ONLY_TEST';
export type VolumeEconomicsApplicability = 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';

export interface VolumeSourceNativeEconomics {
  readonly state: 'UNDEFINED' | 'DEFINED_SYNTHETIC_TEST';
  readonly grossEdgePer1000ValuationNotional: ExactDecimal | null;
  readonly netEdgePer1000ValuationNotional: ExactDecimal | null;
  readonly fillExitPnlPath: 'NOT_WIRED' | 'SYNTHETIC_TEST_FIXTURE';
}

export interface VolumeEconomicsCosts {
  readonly publicRegularFeeBpsPerSide: NonNegativeDecimal | null;
  readonly accountActualFeeBpsPerSide: NonNegativeDecimal | null;
  readonly accountFeeState: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly slippageBpsPerSide: NonNegativeDecimal;
  readonly slippageState: 'ASSUMED_UNVERIFIED' | 'SYNTHETIC_TEST_ONLY';
}

export interface VolumeEconomicsCapacity {
  readonly testedNotionalPerEvent: NonNegativeDecimal | null;
  readonly liquidityCapacity: NonNegativeDecimal | null;
  readonly state: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
}

export interface VolumeConditionalProxyDetail {
  readonly resultClass: 'CONDITIONAL_PROXY_ONLY';
  readonly measurementSemantics: 'PUBLISHED_ROUNDED_PROXY';
  readonly publishedPrecisionDp: 6;
  readonly unit: 'USD_PER_1000_AGGREGATE_ENTRY_NOTIONAL';
  readonly pointNetPnlUsdPer1000AggregateEntryNotional: ExactDecimal;
  readonly bootstrap95Low: ExactDecimal;
  readonly bootstrap95High: ExactDecimal;
  readonly bootstrapBlockDays: 7;
  readonly bootstrapReplicates: 2000;
  readonly bootstrapCoveragePerMyriad: 9500;
  readonly bootstrapSeed: '20260728';
  readonly uncertaintyScope: 'REPLAY_SAMPLING_ONLY_NOT_MODEL_UNCERTAINTY';
  readonly alternateTimerNetPnlUsdPer1000AggregateEntryNotional: ExactDecimal;
  readonly events: 4754;
  readonly alternateTimerEvents: 4862;
  readonly aggregateEntryNotionalUsd: NonNegativeDecimal;
  readonly alternateTimerAggregateEntryNotionalUsd: NonNegativeDecimal;
  readonly positiveSymbolSubsets: 0;
  readonly testedSymbolSubsets: 8;
  readonly measuredSymbols: 8;
  readonly currentEligibleSymbols: 87;
  readonly checksumBoundArchives: 120;
  readonly expectedArchives: 120;
  readonly cohortSelection: 'CURRENT_COHORT_SURVIVORSHIP_NOT_HISTORICAL_POINT_IN_TIME';
  readonly periodStartInclusive: '2025-07-01T00:00:00Z';
  readonly periodEndExclusive: '2026-07-01T00:00:00Z';
  readonly temporalValidation: 'RETROSPECTIVE_SPLIT_NOT_UNTOUCHED_HOLDOUT';
  readonly entryToExitFillExposureSeconds: 61;
  readonly sourceMapping: 'PARTIAL';
  readonly unknownGatePolicy: 'ASSUME_PASS';
  readonly historicalBookGateCoverage: NonNegativeDecimal;
  readonly historicalAggTradeCountGateCoverage: NonNegativeDecimal;
  readonly historicalRawTapeGateCoverage: NonNegativeDecimal;
  readonly operatorControlsNeutralized: true;
  readonly shortInventoryAssumption: 'PREOWNED_BASE_NO_BORROW_OR_LEVERAGE';
  readonly deployedMutableRuntime: 'UNKNOWN_OFFLINE';
  readonly single1000Capacity: 'UNKNOWN';
  readonly full87Capacity: 'UNKNOWN';
  readonly fullStrategyMeasurement: 'UNKNOWN';
  readonly symbolSpecific: false;
  readonly individualOutcomeInference: false;
  readonly generatedAt: '2026-07-28T02:34:00.302708+00:00';
  readonly measuredRepositoryHead:
    '5d5733a6c6748e7844df966535bc0d66708d3a7d';
}

interface VolumeEconomicsBase {
  readonly economicsId: `vecon_${string}`;
  readonly economicsDigest: `vecond_${string}`;
  readonly evidenceClass: VolumeEconomicsEvidenceClass;
  readonly admissibility: VolumeEconomicsAdmissibility;
  readonly applicability: VolumeEconomicsApplicability;
  readonly strategy: 'VOLUME';
  readonly valuationAsset: 'USD' | 'USDT';
  readonly productionAdmissible: false;
  /** Never populate a proposal edge by inference from a cohort proxy. */
  readonly proposalEdgeInference: false;
  readonly evaluatedAtMs: number;
  readonly expiresAtMs: number | null;
  readonly sourceNative: Readonly<VolumeSourceNativeEconomics>;
  readonly costs: Readonly<VolumeEconomicsCosts>;
  readonly capacity: Readonly<VolumeEconomicsCapacity>;
  readonly sourceBindings: readonly string[];
  readonly limitations: readonly string[];
}

export interface VolumeConditionalProxyEconomics extends VolumeEconomicsBase {
  readonly schema: typeof VOLUME_ECONOMICS_SCHEMAS.conditionalProxy;
  readonly evidenceClass: 'CONDITIONAL_PROXY_ONLY';
  readonly admissibility: 'REJECT_ONLY';
  readonly applicability: 'UNKNOWN';
  readonly valuationAsset: 'USD';
  readonly conditionalProxy: Readonly<VolumeConditionalProxyDetail>;
  readonly syntheticFixture: null;
}

export interface SyntheticVolumeEconomicsInput {
  readonly fixtureId: string;
  readonly valuationAsset: 'USDT';
  readonly grossEdgePer1000ValuationNotional: string;
  readonly accountFeeBpsPerSide: string;
  readonly slippageBpsPerSide: string;
  readonly liquidityCapacity: string;
  readonly evaluatedAtMs: number;
  readonly expiresAtMs: number;
}

export interface VolumeSyntheticFixtureDetail {
  readonly fixtureId: string;
  readonly valuationAsset: 'USDT';
  readonly grossEdgePer1000ValuationNotional: ExactDecimal;
  readonly netEdgePer1000ValuationNotional: ExactDecimal;
  readonly roundTripModeledCostPer1000ValuationNotional: NonNegativeDecimal;
  readonly accountFeeBpsPerSide: NonNegativeDecimal;
  readonly slippageBpsPerSide: NonNegativeDecimal;
  readonly liquidityCapacity: NonNegativeDecimal;
  readonly evaluatedAtMs: number;
  readonly expiresAtMs: number;
}

export interface VolumeSyntheticTestEconomics extends VolumeEconomicsBase {
  readonly schema: typeof VOLUME_ECONOMICS_SCHEMAS.syntheticSourceNative;
  readonly evidenceClass: 'SYNTHETIC_TEST';
  readonly admissibility: 'VALIDATE_ONLY_TEST';
  readonly applicability: 'SYNTHETIC_TEST_ONLY';
  readonly valuationAsset: 'USDT';
  readonly conditionalProxy: null;
  readonly syntheticFixture: Readonly<VolumeSyntheticFixtureDetail>;
}

export type VolumeEconomicsEvidence =
  | VolumeConditionalProxyEconomics
  | VolumeSyntheticTestEconomics;

export const VOLUME_ECONOMICS_VALIDATION_CODES = Object.freeze([
  'ECONOMICS_INPUT_INVALID',
  'ECONOMICS_SCHEMA_UNKNOWN',
  'ECONOMICS_CONDITIONAL_PROXY_MISMATCH',
  'ECONOMICS_SYNTHETIC_FIXTURE_INVALID',
  'ECONOMICS_DIGEST_MISMATCH',
] as const);
export type VolumeEconomicsValidationCode =
  (typeof VOLUME_ECONOMICS_VALIDATION_CODES)[number];

export type VolumeEconomicsValidation =
  | Readonly<{
      valid: true;
      reasonCodes: readonly [];
      evidence: Readonly<VolumeEconomicsEvidence>;
    }>
  | Readonly<{
      valid: false;
      reasonCodes: readonly VolumeEconomicsValidationCode[];
      evidence: null;
    }>;

export const VOLUME_ECONOMICS_REJECTION_CODES = Object.freeze([
  'ECONOMICS_EVIDENCE_INVALID',
  'ECONOMICS_CONDITIONAL_PROXY_ONLY',
  'ECONOMICS_OPERATOR_CONTROLS_NEUTRALIZED',
  'ECONOMICS_UNKNOWN_GATES_ASSUMED_PASS',
  'ECONOMICS_PROXY_APPLICABILITY_UNKNOWN',
  'ECONOMICS_SOURCE_NATIVE_EDGE_UNDEFINED',
  'ECONOMICS_CONDITIONAL_PROXY_NET_NEGATIVE',
  'ECONOMICS_ACCOUNT_FEE_UNKNOWN',
  'ECONOMICS_CAPACITY_UNKNOWN',
  'ECONOMICS_SOURCE_MAPPING_PARTIAL',
  'ECONOMICS_FULL_STRATEGY_UNMEASURED',
  'ECONOMICS_OUT_OF_SAMPLE_VALIDATION_ABSENT',
  'ECONOMICS_SHORT_INVENTORY_ASSUMED',
  'ECONOMICS_HISTORICAL_BOOK_COVERAGE_MISSING',
  'ECONOMICS_HISTORICAL_RAW_TAPE_COVERAGE_MISSING',
  'ECONOMICS_RUNTIME_STATE_UNKNOWN_OFFLINE',
  'ECONOMICS_MODEL_UNCERTAINTY_UNBOUNDED',
  'ECONOMICS_NET_EDGE_NOT_POSITIVE',
] as const);
export type VolumeEconomicsRejectionCode =
  (typeof VOLUME_ECONOMICS_REJECTION_CODES)[number];

export interface VolumeEconomicsAssessment {
  readonly schema: typeof VOLUME_ECONOMICS_SCHEMAS.assessment;
  readonly assessmentId: `vecon_assess_${string}`;
  readonly assessmentDigest: `vecon_assessd_${string}`;
  readonly economicsId: `vecon_${string}` | null;
  readonly economicsDigest: `vecond_${string}` | null;
  readonly evidenceClass: VolumeEconomicsEvidenceClass | 'INVALID';
  readonly admissibility: VolumeEconomicsAdmissibility | 'NONE';
  readonly applicability: VolumeEconomicsApplicability;
  readonly valuationAsset: 'USD' | 'USDT' | null;
  readonly disposition: 'REJECTED' | 'SYNTHETIC_VALIDATE_ONLY';
  readonly productionAdmissible: false;
  readonly proposalEdgeInference: false;
  readonly evaluatedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly sourceNativeGrossEdgePer1000ValuationNotional: ExactDecimal | null;
  readonly sourceNativeNetEdgePer1000ValuationNotional: ExactDecimal | null;
  readonly accountActualFeeBpsPerSide: NonNegativeDecimal | null;
  readonly liquidityCapacity: NonNegativeDecimal | null;
  readonly rejectionCodes: readonly VolumeEconomicsRejectionCode[];
}

const ZERO = normalizeExactDecimal('0');
const MAX_UTC_MILLIS = 4_102_444_800_000;
const MAX_SNAPSHOT_DEPTH = 10;
const MAX_SNAPSHOT_NODES = 1_024;
const MAX_ARRAY_LENGTH = 64;
const MAX_OBJECT_KEYS = 64;
const MAX_STRING_LENGTH = 2_048;
const INVALID = Symbol('invalid economics input');

function exact(value: string): ExactDecimal {
  const normalized = normalizeExactDecimal(value);
  if (normalized !== value) throw new TypeError('economics decimal literal must be canonical');
  return normalized;
}

function nonNegative(value: string): NonNegativeDecimal {
  const normalized = normalizeNonNegativeExactDecimal(value);
  if (normalized !== value) throw new TypeError('economics decimal literal must be canonical');
  return normalized;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key], seen);
    }
  }
  return Object.freeze(value);
}

function withEconomicsIdentity<T extends Record<string, unknown>>(
  payload: T,
): Readonly<T & {
  economicsId: `vecon_${string}`;
  economicsDigest: `vecond_${string}`;
}> {
  const canonical = canonicalJson(payload);
  const economicsId =
    `vecon_${stableHash128Hex(`volume.economics.identity.v1|${canonical}`)}` as const;
  const economicsDigest =
    `vecond_${stableHash128Hex(`volume.economics.digest.v1|${canonical}`)}` as const;
  return deepFreeze({ ...payload, economicsId, economicsDigest });
}

const CONDITIONAL_PROXY_PAYLOAD = {
  schema: VOLUME_ECONOMICS_SCHEMAS.conditionalProxy,
  evidenceClass: 'CONDITIONAL_PROXY_ONLY',
  admissibility: 'REJECT_ONLY',
  applicability: 'UNKNOWN',
  strategy: 'VOLUME',
  valuationAsset: 'USD',
  productionAdmissible: false,
  proposalEdgeInference: false,
  // Millisecond projection of the pinned result generation timestamp.
  evaluatedAtMs: 1_785_206_040_302,
  expiresAtMs: null,
  sourceNative: {
    state: 'UNDEFINED',
    grossEdgePer1000ValuationNotional: null,
    netEdgePer1000ValuationNotional: null,
    fillExitPnlPath: 'NOT_WIRED',
  },
  costs: {
    publicRegularFeeBpsPerSide: nonNegative('10'),
    accountActualFeeBpsPerSide: null,
    accountFeeState: 'UNKNOWN',
    slippageBpsPerSide: nonNegative('5'),
    slippageState: 'ASSUMED_UNVERIFIED',
  },
  capacity: {
    testedNotionalPerEvent: nonNegative('12'),
    liquidityCapacity: null,
    state: 'UNKNOWN',
  },
  sourceBindings: [
    'binance-public-data:https://github.com/binance/binance-public-data/blob/master/README.md',
    'binance-public-fee-schedule:https://www.binance.com/en/fee/trading',
    'sha256:4214ffb4158add08a659f05cac0d8b5dc5573ca74b2455b382f9ee4295760056',
    'sha256:4d8f21de0dad2c89b3c9d6dc51ca3d1bfa5a37f1d4dbe8936f7e88102246b193',
    'sha256:576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826',
    'sha256:8826021ada900746dfff9fff9c46722d7d65c74f5e9a1a0453e65f0480801179',
  ],
  limitations: [
    'ACCOUNT_ACTUAL_FEE_UNKNOWN',
    'CAPACITY_UNKNOWN',
    'FULL_STRATEGY_UNMEASURED',
    'HISTORICAL_BOOK_GATE_COVERAGE_ZERO',
    'HISTORICAL_RAW_TAPE_GATE_COVERAGE_ZERO',
    'MODEL_UNCERTAINTY_NOT_IN_BOOTSTRAP_INTERVAL',
    'NO_PROPOSAL_SPECIFIC_EDGE_INFERENCE',
    'OPERATOR_CONTROLS_NEUTRALIZED_FOR_REPLAY',
    'RETROSPECTIVE_SPLIT_NOT_UNTOUCHED_HOLDOUT',
    'SHORT_INVENTORY_PREOWNED_ASSUMPTION',
    'SOURCE_MAPPING_PARTIAL',
    'SOURCE_NATIVE_EDGE_UNDEFINED',
    'UNKNOWN_GATES_ASSUMED_PASS',
  ],
  conditionalProxy: {
    resultClass: 'CONDITIONAL_PROXY_ONLY',
    measurementSemantics: 'PUBLISHED_ROUNDED_PROXY',
    publishedPrecisionDp: 6,
    unit: 'USD_PER_1000_AGGREGATE_ENTRY_NOTIONAL',
    pointNetPnlUsdPer1000AggregateEntryNotional: exact('-2.962474'),
    bootstrap95Low: exact('-3.056512'),
    bootstrap95High: exact('-2.867808'),
    bootstrapBlockDays: 7,
    bootstrapReplicates: 2000,
    bootstrapCoveragePerMyriad: 9500,
    bootstrapSeed: '20260728',
    uncertaintyScope: 'REPLAY_SAMPLING_ONLY_NOT_MODEL_UNCERTAINTY',
    // Canonical exact-decimal form of the accepted six-place publication
    // "-2.935920"; publishedPrecisionDp above preserves its source precision.
    alternateTimerNetPnlUsdPer1000AggregateEntryNotional: exact('-2.93592'),
    events: 4754,
    alternateTimerEvents: 4862,
    aggregateEntryNotionalUsd: nonNegative('57048'),
    alternateTimerAggregateEntryNotionalUsd: nonNegative('58344'),
    positiveSymbolSubsets: 0,
    testedSymbolSubsets: 8,
    measuredSymbols: 8,
    currentEligibleSymbols: 87,
    checksumBoundArchives: 120,
    expectedArchives: 120,
    cohortSelection: 'CURRENT_COHORT_SURVIVORSHIP_NOT_HISTORICAL_POINT_IN_TIME',
    periodStartInclusive: '2025-07-01T00:00:00Z',
    periodEndExclusive: '2026-07-01T00:00:00Z',
    temporalValidation: 'RETROSPECTIVE_SPLIT_NOT_UNTOUCHED_HOLDOUT',
    entryToExitFillExposureSeconds: 61,
    sourceMapping: 'PARTIAL',
    unknownGatePolicy: 'ASSUME_PASS',
    historicalBookGateCoverage: nonNegative('0'),
    historicalAggTradeCountGateCoverage: nonNegative('0'),
    historicalRawTapeGateCoverage: nonNegative('0'),
    operatorControlsNeutralized: true,
    shortInventoryAssumption: 'PREOWNED_BASE_NO_BORROW_OR_LEVERAGE',
    deployedMutableRuntime: 'UNKNOWN_OFFLINE',
    single1000Capacity: 'UNKNOWN',
    full87Capacity: 'UNKNOWN',
    fullStrategyMeasurement: 'UNKNOWN',
    symbolSpecific: false,
    individualOutcomeInference: false,
    generatedAt: '2026-07-28T02:34:00.302708+00:00',
    measuredRepositoryHead: '5d5733a6c6748e7844df966535bc0d66708d3a7d',
  },
  syntheticFixture: null,
} as const;

export const VOLUME_CURRENT_CONDITIONAL_PROXY =
  withEconomicsIdentity(CONDITIONAL_PROXY_PAYLOAD) as Readonly<VolumeConditionalProxyEconomics>;

function validTime(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MILLIS
    && !Object.is(value, -0);
}

function prototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Descriptor-based snapshot. It rejects proxies, accessors, sparse arrays,
 * symbols, exotic prototypes, cycles, negative zero, and unbounded shapes
 * before canonical hashing can invoke caller behavior.
 */
function snapshotCanonicalData(
  input: unknown,
  state = { nodes: 0, seen: new Set<object>() },
  depth = 0,
): unknown | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) return INVALID;
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    return input.length <= MAX_STRING_LENGTH ? input : INVALID;
  }
  if (typeof input === 'number') {
    return Number.isSafeInteger(input) && !Object.is(input, -0) ? input : INVALID;
  }
  if (typeof input !== 'object' || utilTypes.isProxy(input) || state.seen.has(input)) return INVALID;

  try {
    state.seen.add(input);
    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype) return INVALID;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) return INVALID;
      const ownKeys = Reflect.ownKeys(input);
      if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key === 'symbol')) return INVALID;
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
          return INVALID;
        }
        const child = snapshotCanonicalData(descriptor.value, state, depth + 1);
        if (child === INVALID) return INVALID;
        output.push(child);
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length > MAX_OBJECT_KEYS
        || ownKeys.some((key) => typeof key === 'symbol'
          || prototypePollutionKey(key as string))) return INVALID;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of (ownKeys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
        return INVALID;
      }
      const child = snapshotCanonicalData(descriptor.value, state, depth + 1);
      if (child === INVALID) return INVALID;
      Object.defineProperty(output, key, {
        value: child,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  } finally {
    state.seen.delete(input);
  }
}

const SYNTHETIC_INPUT_KEYS = Object.freeze([
  'accountFeeBpsPerSide',
  'evaluatedAtMs',
  'expiresAtMs',
  'fixtureId',
  'grossEdgePer1000ValuationNotional',
  'liquidityCapacity',
  'slippageBpsPerSide',
  'valuationAsset',
] as const);

const SYNTHETIC_DETAIL_KEYS = Object.freeze([
  'accountFeeBpsPerSide',
  'evaluatedAtMs',
  'expiresAtMs',
  'fixtureId',
  'grossEdgePer1000ValuationNotional',
  'liquidityCapacity',
  'netEdgePer1000ValuationNotional',
  'roundTripModeledCostPer1000ValuationNotional',
  'slippageBpsPerSide',
  'valuationAsset',
] as const);

function parseSyntheticInput(input: unknown): Readonly<VolumeSyntheticFixtureDetail> | null {
  const snapshot = snapshotCanonicalData(input);
  if (snapshot === INVALID
      || typeof snapshot !== 'object'
      || snapshot === null
      || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== SYNTHETIC_INPUT_KEYS.length
      || keys.some((key, index) => key !== SYNTHETIC_INPUT_KEYS[index])) return null;

  const fixtureId = record.fixtureId;
  if (typeof fixtureId !== 'string'
      || fixtureId.length === 0
      || fixtureId.length > 128
      || fixtureId.trim() !== fixtureId
      || !/^[A-Za-z0-9._:-]+$/.test(fixtureId)) return null;
  if (record.valuationAsset !== 'USDT') return null;

  let gross: ExactDecimal;
  let accountFee: NonNegativeDecimal;
  let slippage: NonNegativeDecimal;
  let capacity: NonNegativeDecimal;
  try {
    gross = normalizeExactDecimal(record.grossEdgePer1000ValuationNotional);
    accountFee = normalizeNonNegativeExactDecimal(record.accountFeeBpsPerSide);
    slippage = normalizeNonNegativeExactDecimal(record.slippageBpsPerSide);
    capacity = normalizeNonNegativeExactDecimal(record.liquidityCapacity);
  } catch {
    return null;
  }
  if (gross !== record.grossEdgePer1000ValuationNotional
      || accountFee !== record.accountFeeBpsPerSide
      || slippage !== record.slippageBpsPerSide
      || capacity !== record.liquidityCapacity
      || compareExactDecimals(capacity, ZERO) <= 0
      || !validTime(record.evaluatedAtMs)
      || !validTime(record.expiresAtMs)
      || record.expiresAtMs <= record.evaluatedAtMs) return null;

  let roundTripModeledCost: ExactDecimal;
  let net: ExactDecimal;
  try {
    const totalBps = multiplyExactDecimals(
      addExactDecimals(accountFee, slippage),
      exact('2'),
    );
    // Per 1,000 units of the declared valuation asset, one basis point is
    // 0.10 valuation units. Requiring an exact multiply-back prevents
    // divideExactDecimals' toward-zero rule from manufacturing a smaller
    // cost for over-precise hostile inputs.
    roundTripModeledCost = divideExactDecimals(totalBps, exact('10'), 24);
    if (compareExactDecimals(
      multiplyExactDecimals(roundTripModeledCost, exact('10')),
      totalBps,
    ) !== 0) return null;
    net = subtractExactDecimals(gross, roundTripModeledCost);
  } catch {
    return null;
  }

  return deepFreeze({
    fixtureId,
    valuationAsset: 'USDT',
    grossEdgePer1000ValuationNotional: gross,
    netEdgePer1000ValuationNotional: net,
    roundTripModeledCostPer1000ValuationNotional:
      roundTripModeledCost as NonNegativeDecimal,
    accountFeeBpsPerSide: accountFee,
    slippageBpsPerSide: slippage,
    liquidityCapacity: capacity,
    evaluatedAtMs: record.evaluatedAtMs,
    expiresAtMs: record.expiresAtMs,
  });
}

function buildSyntheticVolumeEconomics(
  fixture: Readonly<VolumeSyntheticFixtureDetail>,
): Readonly<VolumeSyntheticTestEconomics> {
  return withEconomicsIdentity({
    schema: VOLUME_ECONOMICS_SCHEMAS.syntheticSourceNative,
    evidenceClass: 'SYNTHETIC_TEST',
    admissibility: 'VALIDATE_ONLY_TEST',
    applicability: 'SYNTHETIC_TEST_ONLY',
    strategy: 'VOLUME',
    valuationAsset: fixture.valuationAsset,
    productionAdmissible: false,
    proposalEdgeInference: false,
    evaluatedAtMs: fixture.evaluatedAtMs,
    expiresAtMs: fixture.expiresAtMs,
    sourceNative: {
      state: 'DEFINED_SYNTHETIC_TEST',
      grossEdgePer1000ValuationNotional: fixture.grossEdgePer1000ValuationNotional,
      netEdgePer1000ValuationNotional: fixture.netEdgePer1000ValuationNotional,
      fillExitPnlPath: 'SYNTHETIC_TEST_FIXTURE',
    },
    costs: {
      publicRegularFeeBpsPerSide: null,
      accountActualFeeBpsPerSide: fixture.accountFeeBpsPerSide,
      accountFeeState: 'SYNTHETIC_TEST_ONLY',
      slippageBpsPerSide: fixture.slippageBpsPerSide,
      slippageState: 'SYNTHETIC_TEST_ONLY',
    },
    capacity: {
      testedNotionalPerEvent: null,
      liquidityCapacity: fixture.liquidityCapacity,
      state: 'SYNTHETIC_TEST_ONLY',
    },
    sourceBindings: [`synthetic-fixture:${fixture.fixtureId}`],
    limitations: [
      'NOT_PRODUCTION_ADMISSIBLE',
      'SYNTHETIC_TEST_ONLY',
    ],
    conditionalProxy: null,
    syntheticFixture: fixture,
  }) as Readonly<VolumeSyntheticTestEconomics>;
}

export function createSyntheticVolumeEconomics(
  input: unknown,
): Readonly<VolumeSyntheticTestEconomics> {
  const fixture = parseSyntheticInput(input);
  if (fixture === null) {
    throw new TypeError('synthetic Volume economics fixture is invalid');
  }
  return buildSyntheticVolumeEconomics(fixture);
}

function invalidValidation(
  ...reasonCodes: VolumeEconomicsValidationCode[]
): VolumeEconomicsValidation {
  const ordered = VOLUME_ECONOMICS_VALIDATION_CODES.filter((code) => reasonCodes.includes(code));
  return deepFreeze({ valid: false, reasonCodes: ordered, evidence: null });
}

export function validateVolumeEconomics(input: unknown): VolumeEconomicsValidation {
  const snapshot = snapshotCanonicalData(input);
  if (snapshot === INVALID
      || typeof snapshot !== 'object'
      || snapshot === null
      || Array.isArray(snapshot)) {
    return invalidValidation('ECONOMICS_INPUT_INVALID');
  }
  const record = snapshot as Record<string, unknown>;
  if (record.schema === VOLUME_ECONOMICS_SCHEMAS.conditionalProxy) {
    if (canonicalJson(snapshot) !== canonicalJson(VOLUME_CURRENT_CONDITIONAL_PROXY)) {
      return invalidValidation('ECONOMICS_CONDITIONAL_PROXY_MISMATCH', 'ECONOMICS_DIGEST_MISMATCH');
    }
    return deepFreeze({
      valid: true,
      reasonCodes: [] as const,
      evidence: VOLUME_CURRENT_CONDITIONAL_PROXY,
    });
  }
  if (record.schema === VOLUME_ECONOMICS_SCHEMAS.syntheticSourceNative) {
    const detail = record.syntheticFixture;
    if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
      return invalidValidation('ECONOMICS_SYNTHETIC_FIXTURE_INVALID');
    }
    const detailRecord = detail as Record<string, unknown>;
    const detailKeys = Object.keys(detailRecord).sort();
    if (detailKeys.length !== SYNTHETIC_DETAIL_KEYS.length
        || detailKeys.some((key, index) => key !== SYNTHETIC_DETAIL_KEYS[index])) {
      return invalidValidation('ECONOMICS_SYNTHETIC_FIXTURE_INVALID');
    }
    const fixture = parseSyntheticInput({
      fixtureId: detailRecord.fixtureId,
      valuationAsset: detailRecord.valuationAsset,
      grossEdgePer1000ValuationNotional:
        detailRecord.grossEdgePer1000ValuationNotional,
      accountFeeBpsPerSide: detailRecord.accountFeeBpsPerSide,
      slippageBpsPerSide: detailRecord.slippageBpsPerSide,
      liquidityCapacity: detailRecord.liquidityCapacity,
      evaluatedAtMs: detailRecord.evaluatedAtMs,
      expiresAtMs: detailRecord.expiresAtMs,
    });
    if (fixture === null) return invalidValidation('ECONOMICS_SYNTHETIC_FIXTURE_INVALID');
    const rebuilt = buildSyntheticVolumeEconomics(fixture);
    if (canonicalJson(snapshot) !== canonicalJson(rebuilt)) {
      return invalidValidation('ECONOMICS_DIGEST_MISMATCH');
    }
    return deepFreeze({
      valid: true,
      reasonCodes: [] as const,
      evidence: rebuilt,
    });
  }
  return invalidValidation('ECONOMICS_SCHEMA_UNKNOWN');
}

function buildAssessment(
  payload: Omit<
    VolumeEconomicsAssessment,
    'schema' | 'assessmentId' | 'assessmentDigest'
  >,
): Readonly<VolumeEconomicsAssessment> {
  const semantic = {
    schema: VOLUME_ECONOMICS_SCHEMAS.assessment,
    ...payload,
  };
  const canonical = canonicalJson(semantic);
  const assessmentId =
    `vecon_assess_${stableHash128Hex(`volume.economics.assessment.id.v1|${canonical}`)}` as const;
  const assessmentDigest =
    `vecon_assessd_${stableHash128Hex(`volume.economics.assessment.digest.v1|${canonical}`)}` as const;
  return deepFreeze({
    ...semantic,
    assessmentId,
    assessmentDigest,
  }) as Readonly<VolumeEconomicsAssessment>;
}

export function assessVolumeEconomics(input: unknown): Readonly<VolumeEconomicsAssessment> {
  const validation = validateVolumeEconomics(input);
  if (!validation.valid) {
    return buildAssessment({
      economicsId: null,
      economicsDigest: null,
      evidenceClass: 'INVALID',
      admissibility: 'NONE',
      applicability: 'UNKNOWN',
      valuationAsset: null,
      disposition: 'REJECTED',
      productionAdmissible: false,
      proposalEdgeInference: false,
      evaluatedAtMs: null,
      expiresAtMs: null,
      sourceNativeGrossEdgePer1000ValuationNotional: null,
      sourceNativeNetEdgePer1000ValuationNotional: null,
      accountActualFeeBpsPerSide: null,
      liquidityCapacity: null,
      rejectionCodes: ['ECONOMICS_EVIDENCE_INVALID'],
    });
  }

  const evidence = validation.evidence;
  if (evidence.evidenceClass === 'CONDITIONAL_PROXY_ONLY') {
    const proxy = evidence.conditionalProxy;
    const codes: VolumeEconomicsRejectionCode[] = [
      'ECONOMICS_CONDITIONAL_PROXY_ONLY',
      'ECONOMICS_OPERATOR_CONTROLS_NEUTRALIZED',
      'ECONOMICS_UNKNOWN_GATES_ASSUMED_PASS',
      'ECONOMICS_PROXY_APPLICABILITY_UNKNOWN',
      'ECONOMICS_SOURCE_NATIVE_EDGE_UNDEFINED',
      'ECONOMICS_ACCOUNT_FEE_UNKNOWN',
      'ECONOMICS_CAPACITY_UNKNOWN',
      'ECONOMICS_SOURCE_MAPPING_PARTIAL',
      'ECONOMICS_FULL_STRATEGY_UNMEASURED',
      'ECONOMICS_OUT_OF_SAMPLE_VALIDATION_ABSENT',
      'ECONOMICS_SHORT_INVENTORY_ASSUMED',
      'ECONOMICS_HISTORICAL_BOOK_COVERAGE_MISSING',
      'ECONOMICS_HISTORICAL_RAW_TAPE_COVERAGE_MISSING',
      'ECONOMICS_RUNTIME_STATE_UNKNOWN_OFFLINE',
      'ECONOMICS_MODEL_UNCERTAINTY_UNBOUNDED',
    ];
    if (compareExactDecimals(proxy.pointNetPnlUsdPer1000AggregateEntryNotional, ZERO) < 0
        && compareExactDecimals(proxy.bootstrap95High, ZERO) < 0) {
      codes.push('ECONOMICS_CONDITIONAL_PROXY_NET_NEGATIVE');
    }
    const rejectionCodes = VOLUME_ECONOMICS_REJECTION_CODES.filter((code) => codes.includes(code));
    return buildAssessment({
      economicsId: evidence.economicsId,
      economicsDigest: evidence.economicsDigest,
      evidenceClass: evidence.evidenceClass,
      admissibility: evidence.admissibility,
      applicability: evidence.applicability,
      valuationAsset: evidence.valuationAsset,
      disposition: 'REJECTED',
      productionAdmissible: false,
      proposalEdgeInference: false,
      evaluatedAtMs: evidence.evaluatedAtMs,
      expiresAtMs: evidence.expiresAtMs,
      sourceNativeGrossEdgePer1000ValuationNotional: null,
      sourceNativeNetEdgePer1000ValuationNotional: null,
      accountActualFeeBpsPerSide: null,
      liquidityCapacity: null,
      rejectionCodes,
    });
  }

  const rejectionCodes = compareExactDecimals(
    evidence.sourceNative.netEdgePer1000ValuationNotional as ExactDecimal,
    ZERO,
  ) > 0
    && compareExactDecimals(
      evidence.sourceNative.grossEdgePer1000ValuationNotional as ExactDecimal,
      ZERO,
    ) > 0
    ? []
    : ['ECONOMICS_NET_EDGE_NOT_POSITIVE'] as const;
  return buildAssessment({
    economicsId: evidence.economicsId,
    economicsDigest: evidence.economicsDigest,
    evidenceClass: evidence.evidenceClass,
    admissibility: evidence.admissibility,
    applicability: evidence.applicability,
    valuationAsset: evidence.valuationAsset,
    disposition: rejectionCodes.length === 0 ? 'SYNTHETIC_VALIDATE_ONLY' : 'REJECTED',
    productionAdmissible: false,
    proposalEdgeInference: false,
    evaluatedAtMs: evidence.evaluatedAtMs,
    expiresAtMs: evidence.expiresAtMs,
    sourceNativeGrossEdgePer1000ValuationNotional:
      evidence.sourceNative.grossEdgePer1000ValuationNotional,
    sourceNativeNetEdgePer1000ValuationNotional:
      evidence.sourceNative.netEdgePer1000ValuationNotional,
    accountActualFeeBpsPerSide: evidence.costs.accountActualFeeBpsPerSide,
    liquidityCapacity: evidence.capacity.liquidityCapacity,
    rejectionCodes,
  });
}
