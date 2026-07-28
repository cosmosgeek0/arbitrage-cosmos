/**
 * Pure, shadow-only economic exit rule for the Volume strategy.
 *
 * This module owns no clock, timer, network, credential, provider, private
 * endpoint, exchange query, order sender, or submission port. It evaluates
 * immutable public observations supplied by its caller and records only a
 * hypothetical LIMIT+IOC exit. Current policy evidence is deliberately
 * reject-only: account-effective fees, symbol-filter proof, entry fills, and
 * production thresholds remain unknown.
 */
import { types as utilTypes } from 'node:util';
import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  maximumExactDecimal,
  minimumExactDecimal,
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
import {
  assessVolumeStrategyObservationSource,
  validateVolumeStrategyObservation,
  type VolumeStrategyObservation,
} from './strategyObservation.js';
import {
  validateVolumeStrategyEvaluation,
  type VolumeStrategyEvaluation,
} from './strategySlice.js';

export const VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION =
  'VOLUME_ECONOMIC_EXIT_RULE_V1' as const;
export const VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION =
  'VOLUME_FORWARD_EXIT_SAMPLE_V1' as const;
export const VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION =
  'VOLUME_ECONOMIC_EXIT_POLICY_V1' as const;
export const VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS = 60_000 as const;
export const VOLUME_ECONOMIC_EXIT_MODE = 'SHADOW_VALIDATE_ONLY' as const;

export const VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE = Object.freeze([
  'SOURCE_DEGRADED',
  'MAX_HOLD_REACHED',
  'NET_LIQUIDATION_STOP_REACHED',
  'TRAILING_DRAWDOWN_REACHED',
  'NET_LIQUIDATION_REVERSAL_LOSS_REACHED',
  'NO_EXIT_TRIGGER',
] as const);

export type VolumeEconomicExitPrimaryReason =
  | 'INPUT_REJECTED'
  | (typeof VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE)[number];

export const VOLUME_ECONOMIC_EXIT_REJECTION_CODES = Object.freeze([
  'EXIT_RULE_DISABLED',
  'EXIT_INPUT_INVALID',
  'EXIT_POLICY_INVALID',
  'EXIT_POLICY_REJECT_ONLY',
  'EXIT_POLICY_THRESHOLDS_UNKNOWN',
  'EXIT_ECONOMICS_UNKNOWN',
  'EXIT_ACCOUNT_FEE_UNKNOWN',
  'EXIT_ACCOUNT_FEE_PROOF_NOT_CURRENT',
  'EXIT_SLIPPAGE_UNKNOWN',
  'EXIT_ENTRY_EVALUATION_INVALID',
  'EXIT_ENTRY_NOT_RECORD_ONLY',
  'EXIT_ENTRY_BINDING_MISMATCH',
  'EXIT_ENTRY_FILL_UNPROVEN',
  'EXIT_SHORT_INVENTORY_UNPROVEN',
  'EXIT_SYMBOL_FILTER_PROOF_NOT_CURRENT',
  'EXIT_SOURCE_OBSERVATION_INVALID',
  'EXIT_SOURCE_PROPOSAL_MISMATCH',
  'EXIT_SOURCE_GENERATION_CHANGED',
  'EXIT_SOURCE_REVISION_REGRESSED',
  'EXIT_SOURCE_CLOCK_INVALID',
  'EXIT_SOURCE_STALE',
  'EXIT_SOURCE_CONTINUITY_DEGRADED',
  'EXIT_SOURCE_DEPTH_UNAVAILABLE',
  'EXIT_LIQUIDATION_CAPACITY_INSUFFICIENT',
  'EXIT_SAMPLE_CHAIN_INVALID',
  'EXIT_NO_EXECUTION_AUTHORITY',
] as const);

export type VolumeEconomicExitRejectionCode =
  (typeof VOLUME_ECONOMIC_EXIT_REJECTION_CODES)[number];

export interface SyntheticVolumeEconomicExitPolicyInput {
  readonly fixtureId: string;
  readonly modeledBaseQuantity: string;
  readonly accountFeeBpsPerSide: string;
  readonly slippageBpsPerSide: string;
  readonly netLiquidationStopLossPer1000: string;
  readonly trailingDrawdownPer1000: string;
  readonly netLiquidationReversalLossPer1000: string;
  readonly evaluatedAtMs: number;
  readonly expiresAtMs: number;
}

interface VolumeEconomicExitPolicyBase {
  readonly schemaVersion: typeof VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION;
  readonly policyId: `vexitpolicy_${string}`;
  readonly policyDigest: `vexitpolicyd_${string}`;
  readonly evidenceClass: 'UNVALIDATED_CURRENT' | 'SYNTHETIC_TEST';
  readonly admissibility: 'REJECT_ONLY' | 'VALIDATE_ONLY_TEST';
  readonly applicability: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly productionAdmissible: false;
  readonly continuationOnly: true;
  readonly fadeEnabled: false;
  readonly maxHoldMs: typeof VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS;
  readonly modeledBaseQuantity: NonNegativeDecimal | null;
  readonly accountFeeBpsPerSide: NonNegativeDecimal | null;
  readonly accountFeeState: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly slippageBpsPerSide: NonNegativeDecimal | null;
  readonly slippageState: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly symbolFilterState: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly netLiquidationStopLossPer1000: NonNegativeDecimal | null;
  readonly trailingDrawdownPer1000: NonNegativeDecimal | null;
  readonly netLiquidationReversalLossPer1000: NonNegativeDecimal | null;
  readonly evaluatedAtMs: number;
  readonly expiresAtMs: number | null;
  readonly fixtureId: string | null;
}

export type VolumeEconomicExitPolicy = Readonly<VolumeEconomicExitPolicyBase>;

export interface VolumeHypotheticalExitTerms {
  readonly termsId: `vexitterms_${string}`;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly exitSide: 'BUY' | 'SELL';
  readonly orderType: 'LIMIT';
  readonly timeInForce: 'IOC';
  readonly limitPrice: string;
  readonly baseQuantity: string;
  readonly quoteNotional: string;
  readonly capacityBasis: 'SYNCHRONIZED_CUMULATIVE';
  readonly levelCount: number;
  readonly entryObservationDigest: `vobs_${string}`;
  readonly currentObservationDigest: `vobs_${string}`;
  readonly unknownOutcomePolicy: 'BLOCK_UNTIL_QUERY_RECONCILED';
  readonly partialFillPolicy: 'RECONCILE_REMAINDER_BEFORE_NEXT_PLAN';
  readonly recoveryPolicy: 'RESTORE_DURABLE_LATEST_BEFORE_REEVALUATION';
}

export interface VolumeShadowExitPlan {
  readonly schemaVersion: 1;
  readonly planId: `vexitplan_${string}`;
  readonly decisionId: `vexitdecision_${string}`;
  readonly sampleId: `vfes_${string}`;
  readonly mode: typeof VOLUME_ECONOMIC_EXIT_MODE;
  readonly validation: 'REJECTED';
  readonly terms: Readonly<VolumeHypotheticalExitTerms> | null;
  readonly rejectionCodes: readonly VolumeEconomicExitRejectionCode[];
  readonly killSwitchEngaged: true;
  readonly executionAuthority: 'NONE';
  readonly submitAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly externalAuthority: 'NONE';
  readonly sendEligible: false;
  readonly sends: 0;
  readonly sideEffects: 0;
  readonly submitPortPresent: false;
  readonly queryPortPresent: false;
  readonly publicOnly: true;
  readonly privateCalls: false;
  readonly signedCalls: false;
  readonly providerCalls: false;
  readonly exchangeQueries: 0;
}

export interface VolumeForwardExitSample {
  readonly schemaVersion: typeof VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION;
  readonly sampleId: `vfes_${string}`;
  readonly sampleDigest: `vfesd_${string}`;
  readonly sampleRevision: number;
  readonly previousSampleId: `vfes_${string}` | null;
  readonly entryEvaluationId: string;
  readonly entryPlanId: string;
  readonly entryProposalId: string;
  readonly entryProposalDigest: string;
  readonly entryObservationDigest: `vobs_${string}`;
  readonly currentObservationDigest: `vobs_${string}` | null;
  readonly policyDigest: `vexitpolicyd_${string}`;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly openedAtMs: number;
  readonly observedAtMs: number | null;
  readonly evaluatedAtMs: number;
  readonly holdAgeMs: number;
  readonly modeledBaseQuantity: string;
  readonly entryQuoteNotional: string;
  readonly exitQuoteNotional: string | null;
  readonly netLiquidationPnlPer1000: string | null;
  readonly priorFavorableExtremeNetPnlPer1000: string | null;
  readonly favorableExtremeNetPnlPer1000: string | null;
  readonly drawdownFromFavorableExtremePer1000: string | null;
  readonly sourceDisposition: 'ACCEPTED' | 'DEGRADED';
  readonly economicsApplicability: 'SYNTHETIC_TEST_ONLY' | 'UNKNOWN';
}

export interface VolumeEconomicExitDecision {
  readonly schemaVersion: typeof VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION;
  readonly decisionId: `vexitdecision_${string}`;
  readonly decisionDigest: `vexitdecisiond_${string}`;
  readonly sampleId: `vfes_${string}` | null;
  readonly evaluatedAtMs: number;
  readonly lifecyclePhase: 'REJECTED' | 'HOLDING' | 'TERMINAL_EXIT';
  readonly disposition: 'REJECTED' | 'HOLD_SHADOW' | 'EXIT_SHADOW';
  readonly primaryReason: VolumeEconomicExitPrimaryReason;
  readonly reasonCodes: readonly string[];
  readonly exitPlan: Readonly<VolumeShadowExitPlan> | null;
}

export interface VolumeEconomicExitEvaluationInput {
  readonly entryEvaluation: Readonly<VolumeStrategyEvaluation>;
  readonly entryObservation: Readonly<VolumeStrategyObservation>;
  readonly currentObservation: Readonly<VolumeStrategyObservation> | null;
  readonly policy: Readonly<VolumeEconomicExitPolicy>;
  readonly previousSample: Readonly<VolumeForwardExitSample> | null;
  readonly evaluatedAtMs: number;
}

export interface VolumeEconomicExitEvaluationResult {
  readonly sample: Readonly<VolumeForwardExitSample> | null;
  readonly decision: Readonly<VolumeEconomicExitDecision>;
}

const ZERO = normalizeExactDecimal('0');
const THOUSAND = normalizeExactDecimal('1000');
const TEN_THOUSAND = normalizeExactDecimal('10000');
const MAX_UTC_MILLIS = 4_102_444_800_000;
const INVALID = Symbol('invalid exit input');

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function pollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function snapshotData(
  input: unknown,
  state = { nodes: 0, seen: new Set<object>() },
  depth = 0,
): unknown | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 16) return INVALID;
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'string') return input.length <= 16_384 ? input : INVALID;
  if (typeof input === 'number') {
    return Number.isSafeInteger(input) && !Object.is(input, -0) ? input : INVALID;
  }
  if (typeof input !== 'object' || utilTypes.isProxy(input) || state.seen.has(input)) return INVALID;
  try {
    state.seen.add(input);
    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 512) return INVALID;
      const keys = Reflect.ownKeys(input);
      if (keys.length !== input.length + 1 || keys.some((key) => typeof key === 'symbol')) return INVALID;
      const output: unknown[] = [];
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return INVALID;
        const child = snapshotData(descriptor.value, state, depth + 1);
        if (child === INVALID) return INVALID;
        output.push(child);
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    const keys = Reflect.ownKeys(input);
    if (keys.length > 128 || keys.some((key) => typeof key === 'symbol' || pollutionKey(key as string))) {
      return INVALID;
    }
    // Downstream frozen Volume validators require ordinary plain-data records
    // with Object.prototype. Pollution keys were rejected above.
    const output: Record<string, unknown> = {};
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return INVALID;
      const child = snapshotData(descriptor.value, state, depth + 1);
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

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validTime(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MILLIS
    && !Object.is(value, -0);
}

function canonicalNonNegative(value: unknown, positive = false): NonNegativeDecimal | null {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    if (normalized !== value || (positive && compareExactDecimals(normalized, ZERO) <= 0)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function canonicalExact(value: unknown): ExactDecimal | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = normalizeExactDecimal(value);
    return normalized === value ? normalized : null;
  } catch {
    return null;
  }
}

function validIdentifier(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function cumulativeExitNotionalIsConservative(
  limitPrice: unknown,
  baseQuantity: unknown,
  quoteNotional: unknown,
  exitSide: unknown,
): boolean {
  const price = canonicalNonNegative(limitPrice, true);
  const quantity = canonicalNonNegative(baseQuantity, true);
  const quote = canonicalNonNegative(quoteNotional, true);
  if (price === null || quantity === null || quote === null
      || (exitSide !== 'BUY' && exitSide !== 'SELL')) return false;
  try {
    const parts = (value: string): Readonly<{ coefficient: bigint; scale: number }> => {
      const [whole, fraction = ''] = value.split('.');
      return Object.freeze({
        coefficient: BigInt(`${whole}${fraction}`),
        scale: fraction.length,
      });
    };
    const priceParts = parts(price);
    const quantityParts = parts(quantity);
    const quoteParts = parts(quote);
    const productCoefficient = priceParts.coefficient * quantityParts.coefficient;
    const productScale = priceParts.scale + quantityParts.scale;
    const comparisonScale = Math.max(productScale, quoteParts.scale);
    const scaledProduct = productCoefficient
      * (10n ** BigInt(comparisonScale - productScale));
    const scaledQuote = quoteParts.coefficient
      * (10n ** BigInt(comparisonScale - quoteParts.scale));
    return exitSide === 'BUY'
      ? scaledProduct >= scaledQuote
      : scaledProduct <= scaledQuote;
  } catch {
    return false;
  }
}

function identity(prefix: string, namespace: string, semantic: unknown): string {
  return `${prefix}_${stableHash128Hex(`${namespace}|${canonicalJson(semantic)}`)}`;
}

function withPolicyIdentity(
  semantic: Omit<VolumeEconomicExitPolicyBase, 'policyId' | 'policyDigest'>,
): VolumeEconomicExitPolicy {
  return deepFreeze({
    ...semantic,
    policyId: identity('vexitpolicy', 'volume.economic-exit.policy-id.v1', semantic),
    policyDigest: identity('vexitpolicyd', 'volume.economic-exit.policy-digest.v1', semantic),
  }) as VolumeEconomicExitPolicy;
}

export const VOLUME_CURRENT_ECONOMIC_EXIT_POLICY = withPolicyIdentity({
  schemaVersion: VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION,
  evidenceClass: 'UNVALIDATED_CURRENT',
  admissibility: 'REJECT_ONLY',
  applicability: 'UNKNOWN',
  productionAdmissible: false,
  continuationOnly: true,
  fadeEnabled: false,
  maxHoldMs: VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS,
  modeledBaseQuantity: null,
  accountFeeBpsPerSide: null,
  accountFeeState: 'UNKNOWN',
  slippageBpsPerSide: null,
  slippageState: 'UNKNOWN',
  symbolFilterState: 'UNKNOWN',
  netLiquidationStopLossPer1000: null,
  trailingDrawdownPer1000: null,
  netLiquidationReversalLossPer1000: null,
  evaluatedAtMs: 1_785_206_040_302,
  expiresAtMs: null,
  fixtureId: null,
});

const POLICY_KEYS = [
  'accountFeeBpsPerSide', 'accountFeeState', 'admissibility', 'applicability',
  'continuationOnly', 'evaluatedAtMs',
  'evidenceClass', 'expiresAtMs', 'fadeEnabled', 'fixtureId', 'maxHoldMs',
  'modeledBaseQuantity', 'netLiquidationReversalLossPer1000',
  'netLiquidationStopLossPer1000', 'policyDigest',
  'policyId', 'productionAdmissible', 'schemaVersion', 'slippageBpsPerSide',
  'slippageState', 'symbolFilterState', 'trailingDrawdownPer1000',
] as const;

const SYNTHETIC_POLICY_INPUT_KEYS = [
  'accountFeeBpsPerSide', 'evaluatedAtMs',
  'expiresAtMs', 'fixtureId', 'modeledBaseQuantity',
  'netLiquidationReversalLossPer1000', 'netLiquidationStopLossPer1000',
  'slippageBpsPerSide',
  'trailingDrawdownPer1000',
] as const;

export function buildSyntheticVolumeEconomicExitPolicy(
  input: unknown,
): VolumeEconomicExitPolicy {
  const snap = snapshotData(input);
  const value = snap === INVALID ? null : record(snap);
  if (value === null || !exactKeys(value, SYNTHETIC_POLICY_INPUT_KEYS)
      || typeof value.fixtureId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.fixtureId)
      || !validTime(value.evaluatedAtMs)
      || !validTime(value.expiresAtMs)
      || value.expiresAtMs <= value.evaluatedAtMs) {
    throw new TypeError('synthetic Volume economic exit policy is invalid');
  }
  const quantity = canonicalNonNegative(value.modeledBaseQuantity, true);
  const fee = canonicalNonNegative(value.accountFeeBpsPerSide);
  const slippage = canonicalNonNegative(value.slippageBpsPerSide);
  const stop = canonicalNonNegative(value.netLiquidationStopLossPer1000, true);
  const trail = canonicalNonNegative(value.trailingDrawdownPer1000, true);
  const reversal = canonicalNonNegative(value.netLiquidationReversalLossPer1000, true);
  if (quantity === null || fee === null || slippage === null
      || stop === null || trail === null || reversal === null) {
    throw new TypeError('synthetic Volume economic exit decimals are invalid');
  }
  return withPolicyIdentity({
    schemaVersion: VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION,
    evidenceClass: 'SYNTHETIC_TEST',
    admissibility: 'VALIDATE_ONLY_TEST',
    applicability: 'SYNTHETIC_TEST_ONLY',
    productionAdmissible: false,
    continuationOnly: true,
    fadeEnabled: false,
    maxHoldMs: VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS,
    modeledBaseQuantity: quantity,
    accountFeeBpsPerSide: fee,
    accountFeeState: 'SYNTHETIC_TEST_ONLY',
    slippageBpsPerSide: slippage,
    slippageState: 'SYNTHETIC_TEST_ONLY',
    symbolFilterState: 'SYNTHETIC_TEST_ONLY',
    netLiquidationStopLossPer1000: stop,
    trailingDrawdownPer1000: trail,
    netLiquidationReversalLossPer1000: reversal,
    evaluatedAtMs: value.evaluatedAtMs,
    expiresAtMs: value.expiresAtMs,
    fixtureId: value.fixtureId,
  });
}

export const createSyntheticVolumeEconomicExitPolicy =
  buildSyntheticVolumeEconomicExitPolicy;

export function validateVolumeEconomicExitPolicy(
  input: unknown,
): input is VolumeEconomicExitPolicy {
  const snap = snapshotData(input);
  const value = snap === INVALID ? null : record(snap);
  if (value === null || !exactKeys(value, POLICY_KEYS)
      || value.schemaVersion !== VOLUME_ECONOMIC_EXIT_POLICY_SCHEMA_VERSION
      || value.productionAdmissible !== false
      || value.continuationOnly !== true
      || value.fadeEnabled !== false
      || value.maxHoldMs !== VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS
      || !validTime(value.evaluatedAtMs)) return false;
  const { policyId, policyDigest, ...semantic } = value;
  if (policyId !== identity('vexitpolicy', 'volume.economic-exit.policy-id.v1', semantic)
      || policyDigest !== identity('vexitpolicyd', 'volume.economic-exit.policy-digest.v1', semantic)) return false;
  if (value.evidenceClass === 'UNVALIDATED_CURRENT') {
    return value.admissibility === 'REJECT_ONLY'
      && value.applicability === 'UNKNOWN'
      && value.modeledBaseQuantity === null
      && value.accountFeeBpsPerSide === null
      && value.accountFeeState === 'UNKNOWN'
      && value.slippageBpsPerSide === null
      && value.slippageState === 'UNKNOWN'
      && value.symbolFilterState === 'UNKNOWN'
      && value.netLiquidationStopLossPer1000 === null
      && value.trailingDrawdownPer1000 === null
      && value.netLiquidationReversalLossPer1000 === null
      && value.expiresAtMs === null
      && value.fixtureId === null;
  }
  return value.evidenceClass === 'SYNTHETIC_TEST'
    && value.admissibility === 'VALIDATE_ONLY_TEST'
    && value.applicability === 'SYNTHETIC_TEST_ONLY'
    && canonicalNonNegative(value.modeledBaseQuantity, true) !== null
    && canonicalNonNegative(value.accountFeeBpsPerSide) !== null
    && value.accountFeeState === 'SYNTHETIC_TEST_ONLY'
    && canonicalNonNegative(value.slippageBpsPerSide) !== null
    && value.slippageState === 'SYNTHETIC_TEST_ONLY'
    && value.symbolFilterState === 'SYNTHETIC_TEST_ONLY'
    && canonicalNonNegative(value.netLiquidationStopLossPer1000, true) !== null
    && canonicalNonNegative(value.trailingDrawdownPer1000, true) !== null
    && canonicalNonNegative(value.netLiquidationReversalLossPer1000, true) !== null
    && validTime(value.expiresAtMs)
    && value.expiresAtMs > value.evaluatedAtMs
    && typeof value.fixtureId === 'string';
}

interface DepthFill {
  readonly limitPrice: ExactDecimal;
  readonly baseQuantity: NonNegativeDecimal;
  readonly quoteNotional: NonNegativeDecimal;
  readonly levelCount: number;
}

function depthFill(
  observation: Readonly<VolumeStrategyObservation>,
  side: 'BUY' | 'SELL',
  requested: NonNegativeDecimal,
): Readonly<DepthFill> | null {
  if (observation.book.scope !== 'SYNCHRONIZED_DEPTH'
      || observation.book.numericFidelity !== 'SOURCE_TEXT_EXACT'
      || observation.book.depth === null) return null;
  const levels = side === 'BUY' ? observation.book.depth.asks : observation.book.depth.bids;
  let remaining: ExactDecimal = requested;
  let quote: ExactDecimal = ZERO;
  let count = 0;
  let limit: ExactDecimal | null = null;
  try {
    for (const level of levels) {
      if (compareExactDecimals(remaining, ZERO) <= 0) break;
      const price = normalizeNonNegativeExactDecimal(level.price);
      const available = normalizeNonNegativeExactDecimal(level.quantity);
      if (price !== level.price || available !== level.quantity
          || compareExactDecimals(price, ZERO) <= 0) return null;
      if (compareExactDecimals(available, ZERO) === 0) continue;
      const take = minimumExactDecimal(remaining, available);
      quote = addExactDecimals(quote, multiplyExactDecimals(price, take));
      remaining = subtractExactDecimals(remaining, take);
      limit = price;
      count += 1;
    }
    if (compareExactDecimals(remaining, ZERO) !== 0 || limit === null || count === 0) return null;
    return deepFreeze({
      limitPrice: limit,
      baseQuantity: requested,
      quoteNotional: normalizeNonNegativeExactDecimal(quote),
      levelCount: count,
    });
  } catch {
    return null;
  }
}

function sameEntryBinding(
  evaluation: Readonly<VolumeStrategyEvaluation>,
  observation: Readonly<VolumeStrategyObservation>,
): boolean {
  return evaluation.proposal.proposalId === observation.proposal.proposalId
    && evaluation.proposal.proposalRevision === observation.proposal.proposalRevision
    && evaluation.proposal.proposalDigest === observation.proposal.proposalDigest
    && evaluation.proposal.configurationRevision === observation.proposal.configurationRevision
    && evaluation.proposal.symbol === observation.proposal.symbol
    && evaluation.observationDigest === observation.observationDigest;
}

function sampleSemantic(sample: Omit<VolumeForwardExitSample, 'sampleId' | 'sampleDigest'>): unknown {
  return sample;
}

function decisionSemantic(
  decision: Omit<VolumeEconomicExitDecision, 'decisionId' | 'decisionDigest' | 'exitPlan'>,
  exitPlan: Omit<VolumeShadowExitPlan, 'planId' | 'decisionId'> | null,
): unknown {
  return Object.freeze({ decision, exitPlan });
}

function buildRejectedDecision(
  evaluatedAtMs: number,
  reasonCodes: readonly string[],
): Readonly<VolumeEconomicExitDecision> {
  const base = deepFreeze({
    schemaVersion: VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION,
    sampleId: null,
    evaluatedAtMs: validTime(evaluatedAtMs) ? evaluatedAtMs : 0,
    lifecyclePhase: 'REJECTED' as const,
    disposition: 'REJECTED' as const,
    primaryReason: 'INPUT_REJECTED' as const,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort(compareText)),
  });
  const semantic = decisionSemantic(base, null);
  return deepFreeze({
    decisionId: identity('vexitdecision', 'volume.economic-exit.decision-id.v1', semantic),
    decisionDigest: identity('vexitdecisiond', 'volume.economic-exit.decision-digest.v1', semantic),
    ...base,
    exitPlan: null,
  }) as Readonly<VolumeEconomicExitDecision>;
}

function sourceDegraded(
  entry: Readonly<VolumeStrategyObservation>,
  current: Readonly<VolumeStrategyObservation> | null,
  evaluatedAtMs: number,
): boolean {
  if (current === null || !validateVolumeStrategyObservation(current)) return true;
  if (current.proposal.proposalId !== entry.proposal.proposalId
      || current.proposal.proposalRevision !== entry.proposal.proposalRevision
      || current.proposal.proposalDigest !== entry.proposal.proposalDigest
      || current.proposal.symbol !== entry.proposal.symbol
      || current.source.generation !== entry.source.generation
      || current.source.revision < entry.source.revision
      || current.evaluatedAtMs < entry.evaluatedAtMs
      || current.evaluatedAtMs > evaluatedAtMs
      || evaluatedAtMs - current.book.receivedAtMs > 10_000) return true;
  try {
    return assessVolumeStrategyObservationSource(current).accepted !== true;
  } catch {
    return true;
  }
}

function validPreviousChain(
  previous: Readonly<VolumeForwardExitSample> | null,
  evaluation: Readonly<VolumeStrategyEvaluation>,
  observation: Readonly<VolumeStrategyObservation>,
  policy: Readonly<VolumeEconomicExitPolicy>,
): boolean {
  if (previous === null) return true;
  return validateVolumeForwardExitSample(previous)
    && previous.entryEvaluationId === evaluation.evaluationId
    && previous.entryPlanId === evaluation.plan.planId
    && previous.entryProposalId === evaluation.proposal.proposalId
    && previous.entryProposalDigest === evaluation.proposal.proposalDigest
    && previous.entryObservationDigest === observation.observationDigest
    && previous.policyDigest === policy.policyDigest
    && previous.symbol === evaluation.proposal.symbol
    && previous.direction === evaluation.proposal.direction;
}

export function evaluateVolumeEconomicExit(
  input: unknown,
  controls: Readonly<{ enabled?: boolean; killSwitchEngaged?: true }> = {},
): Readonly<VolumeEconomicExitEvaluationResult> {
  const controlSnap = snapshotData(controls);
  const control = controlSnap === INVALID ? null : record(controlSnap);
  const snap = snapshotData(input);
  const value = snap === INVALID ? null : record(snap);
  const evaluatedAtMs = value?.evaluatedAtMs;
  if (control === null
      || Object.keys(control).some((key) => key !== 'enabled' && key !== 'killSwitchEngaged')
      || (control.enabled !== undefined && typeof control.enabled !== 'boolean')
      || (control.killSwitchEngaged !== undefined && control.killSwitchEngaged !== true)
      || value === null
      || !exactKeys(value, [
        'currentObservation', 'entryEvaluation', 'entryObservation',
        'evaluatedAtMs', 'policy', 'previousSample',
      ])
      || !validTime(evaluatedAtMs)) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(0, ['EXIT_INPUT_INVALID']),
    });
  }
  if (control.enabled !== true) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_RULE_DISABLED']),
    });
  }
  const policy = value.policy as Readonly<VolumeEconomicExitPolicy>;
  if (!validateVolumeEconomicExitPolicy(policy)) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_POLICY_INVALID']),
    });
  }
  if (policy.admissibility === 'REJECT_ONLY') {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, [
        'EXIT_POLICY_REJECT_ONLY',
        'EXIT_POLICY_THRESHOLDS_UNKNOWN',
        'EXIT_ECONOMICS_UNKNOWN',
        'EXIT_ACCOUNT_FEE_UNKNOWN',
        'EXIT_SLIPPAGE_UNKNOWN',
        'EXIT_ENTRY_FILL_UNPROVEN',
      ]),
    });
  }
  const evaluation = value.entryEvaluation as Readonly<VolumeStrategyEvaluation>;
  const entry = value.entryObservation as Readonly<VolumeStrategyObservation>;
  const current = value.currentObservation as Readonly<VolumeStrategyObservation> | null;
  const previous = value.previousSample as Readonly<VolumeForwardExitSample> | null;
  if (!validateVolumeStrategyEvaluation(evaluation)
      || !validateVolumeStrategyObservation(entry)) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_ENTRY_EVALUATION_INVALID']),
    });
  }
  if (evaluation.disposition !== 'VALIDATED_RECORD_ONLY'
      || evaluation.plan.executionTerms === null) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_ENTRY_NOT_RECORD_ONLY']),
    });
  }
  if (!sameEntryBinding(evaluation, entry)
      || evaluatedAtMs < entry.evaluatedAtMs
      || evaluatedAtMs >= evaluation.proposal.expiresAtMs) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_ENTRY_BINDING_MISMATCH']),
    });
  }
  try {
    if (assessVolumeStrategyObservationSource(entry).accepted !== true) {
      return deepFreeze({
        sample: null,
        decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_SOURCE_OBSERVATION_INVALID']),
      });
    }
  } catch {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_SOURCE_OBSERVATION_INVALID']),
    });
  }
  if (!validPreviousChain(previous, evaluation, entry, policy)
      || (previous !== null && (previous.evaluatedAtMs > evaluatedAtMs
        || previous.sampleRevision >= Number.MAX_SAFE_INTEGER))) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_SAMPLE_CHAIN_INVALID']),
    });
  }
  if (current !== null
      && validateVolumeStrategyObservation(current)
      && current.evaluatedAtMs > evaluatedAtMs) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_SOURCE_CLOCK_INVALID']),
    });
  }
  const quantity = policy.modeledBaseQuantity as NonNegativeDecimal;
  const entrySide = evaluation.proposal.direction === 'long' ? 'BUY' : 'SELL';
  const exitSide = entrySide === 'BUY' ? 'SELL' : 'BUY';
  const entryFill = depthFill(entry, entrySide, quantity);
  if (entryFill === null) {
    return deepFreeze({
      sample: null,
      decision: buildRejectedDecision(evaluatedAtMs, ['EXIT_LIQUIDATION_CAPACITY_INSUFFICIENT']),
    });
  }
  const degraded = sourceDegraded(entry, current, evaluatedAtMs);
  const exitFill = !degraded && current !== null ? depthFill(current, exitSide, quantity) : null;
  const capacityDegraded = !degraded && exitFill === null;
  let netPer1000: ExactDecimal | null = null;
  if (!degraded && !capacityDegraded && exitFill !== null) {
    try {
      const gross = evaluation.proposal.direction === 'long'
        ? subtractExactDecimals(exitFill.quoteNotional, entryFill.quoteNotional)
        : subtractExactDecimals(entryFill.quoteNotional, exitFill.quoteNotional);
      const totalNotional = addExactDecimals(entryFill.quoteNotional, exitFill.quoteNotional);
      const costBps = addExactDecimals(
        policy.accountFeeBpsPerSide as NonNegativeDecimal,
        policy.slippageBpsPerSide as NonNegativeDecimal,
      );
      const costs = divideExactDecimals(
        multiplyExactDecimals(totalNotional, costBps),
        TEN_THOUSAND,
        24,
      );
      const net = subtractExactDecimals(gross, costs);
      netPer1000 = divideExactDecimals(
        multiplyExactDecimals(net, THOUSAND),
        entryFill.quoteNotional,
        24,
      );
    } catch {
      netPer1000 = null;
    }
  }
  const priorExtreme = previous?.favorableExtremeNetPnlPer1000 ?? null;
  const favorable = netPer1000 === null
    ? priorExtreme
    : priorExtreme === null
      ? netPer1000
      : maximumExactDecimal(
        normalizeExactDecimal(priorExtreme),
        normalizeExactDecimal(netPer1000),
      );
  const drawdown = netPer1000 !== null && favorable !== null
    ? subtractExactDecimals(normalizeExactDecimal(favorable), normalizeExactDecimal(netPer1000))
    : null;
  const holdAgeMs = evaluatedAtMs - entry.evaluatedAtMs;
  const sampleBase = {
    schemaVersion: VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION,
    sampleRevision: (previous?.sampleRevision ?? 0) + 1,
    previousSampleId: previous?.sampleId ?? null,
    entryEvaluationId: evaluation.evaluationId,
    entryPlanId: evaluation.plan.planId,
    entryProposalId: evaluation.proposal.proposalId,
    entryProposalDigest: evaluation.proposal.proposalDigest,
    entryObservationDigest: entry.observationDigest,
    currentObservationDigest: current?.observationDigest ?? null,
    policyDigest: policy.policyDigest,
    symbol: evaluation.proposal.symbol,
    direction: evaluation.proposal.direction,
    openedAtMs: entry.evaluatedAtMs,
    observedAtMs: current?.evaluatedAtMs ?? null,
    evaluatedAtMs,
    holdAgeMs,
    modeledBaseQuantity: quantity,
    entryQuoteNotional: entryFill.quoteNotional,
    exitQuoteNotional: exitFill?.quoteNotional ?? null,
    netLiquidationPnlPer1000: netPer1000,
    priorFavorableExtremeNetPnlPer1000: priorExtreme,
    favorableExtremeNetPnlPer1000: favorable,
    drawdownFromFavorableExtremePer1000: drawdown,
    sourceDisposition: degraded || capacityDegraded || netPer1000 === null
      ? 'DEGRADED' as const
      : 'ACCEPTED' as const,
    economicsApplicability: 'SYNTHETIC_TEST_ONLY' as const,
  };
  const sample = deepFreeze({
    sampleId: identity('vfes', 'volume.forward-exit.sample-id.v1', sampleSemantic(sampleBase)),
    sampleDigest: identity('vfesd', 'volume.forward-exit.sample-digest.v1', sampleSemantic(sampleBase)),
    ...sampleBase,
  }) as Readonly<VolumeForwardExitSample>;

  let primaryReason: VolumeEconomicExitPrimaryReason = 'NO_EXIT_TRIGGER';
  if (sample.sourceDisposition === 'DEGRADED') primaryReason = 'SOURCE_DEGRADED';
  else if (holdAgeMs >= VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS) primaryReason = 'MAX_HOLD_REACHED';
  else if (netPer1000 !== null && compareExactDecimals(
    netPer1000,
    subtractExactDecimals(ZERO, policy.netLiquidationStopLossPer1000 as NonNegativeDecimal),
  ) <= 0) primaryReason = 'NET_LIQUIDATION_STOP_REACHED';
  else if (drawdown !== null && compareExactDecimals(
    drawdown,
    policy.trailingDrawdownPer1000 as NonNegativeDecimal,
  ) >= 0) primaryReason = 'TRAILING_DRAWDOWN_REACHED';
  else if (netPer1000 !== null && compareExactDecimals(
    netPer1000,
    subtractExactDecimals(ZERO, policy.netLiquidationReversalLossPer1000 as NonNegativeDecimal),
  ) <= 0) primaryReason = 'NET_LIQUIDATION_REVERSAL_LOSS_REACHED';

  const disposition = primaryReason === 'NO_EXIT_TRIGGER' ? 'HOLD_SHADOW' as const : 'EXIT_SHADOW' as const;
  const lifecyclePhase = disposition === 'HOLD_SHADOW' ? 'HOLDING' as const : 'TERMINAL_EXIT' as const;
  const reasonCodes = Object.freeze([
    primaryReason,
    ...(capacityDegraded ? ['EXIT_LIQUIDATION_CAPACITY_INSUFFICIENT'] : []),
  ]);
  const decisionBase = deepFreeze({
    schemaVersion: VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION,
    sampleId: sample.sampleId,
    evaluatedAtMs,
    lifecyclePhase,
    disposition,
    primaryReason,
    reasonCodes,
  });
  let planCore: Omit<VolumeShadowExitPlan, 'planId' | 'decisionId'> | null = null;
  if (disposition === 'EXIT_SHADOW') {
    const termsBase = exitFill === null || current === null ? null : {
      symbol: sample.symbol,
      direction: sample.direction,
      exitSide,
      orderType: 'LIMIT' as const,
      timeInForce: 'IOC' as const,
      limitPrice: exitFill.limitPrice,
      baseQuantity: exitFill.baseQuantity,
      quoteNotional: exitFill.quoteNotional,
      capacityBasis: 'SYNCHRONIZED_CUMULATIVE' as const,
      levelCount: exitFill.levelCount,
      entryObservationDigest: entry.observationDigest,
      currentObservationDigest: current.observationDigest,
      unknownOutcomePolicy: 'BLOCK_UNTIL_QUERY_RECONCILED' as const,
      partialFillPolicy: 'RECONCILE_REMAINDER_BEFORE_NEXT_PLAN' as const,
      recoveryPolicy: 'RESTORE_DURABLE_LATEST_BEFORE_REEVALUATION' as const,
    };
    const terms = termsBase === null ? null : deepFreeze({
      termsId: identity('vexitterms', 'volume.economic-exit.terms.v1', termsBase),
      ...termsBase,
    }) as Readonly<VolumeHypotheticalExitTerms>;
    planCore = deepFreeze({
      schemaVersion: 1 as const,
      sampleId: sample.sampleId,
      mode: VOLUME_ECONOMIC_EXIT_MODE,
      validation: 'REJECTED' as const,
      terms,
      rejectionCodes: Object.freeze([
        'EXIT_ACCOUNT_FEE_PROOF_NOT_CURRENT',
        'EXIT_ENTRY_FILL_UNPROVEN',
        ...(sample.direction === 'short' ? ['EXIT_SHORT_INVENTORY_UNPROVEN'] as const : []),
        'EXIT_SYMBOL_FILTER_PROOF_NOT_CURRENT',
        'EXIT_NO_EXECUTION_AUTHORITY',
      ].sort(compareText) as VolumeEconomicExitRejectionCode[]),
      killSwitchEngaged: true as const,
      executionAuthority: 'NONE' as const,
      submitAuthority: 'NONE' as const,
      riskAuthority: 'NONE' as const,
      externalAuthority: 'NONE' as const,
      sendEligible: false as const,
      sends: 0 as const,
      sideEffects: 0 as const,
      submitPortPresent: false as const,
      queryPortPresent: false as const,
      publicOnly: true as const,
      privateCalls: false as const,
      signedCalls: false as const,
      providerCalls: false as const,
      exchangeQueries: 0 as const,
    });
  }
  const decisionIdentitySemantic = decisionSemantic(decisionBase, planCore);
  const decisionId = identity(
    'vexitdecision',
    'volume.economic-exit.decision-id.v1',
    decisionIdentitySemantic,
  ) as `vexitdecision_${string}`;
  const decisionDigest = identity(
    'vexitdecisiond',
    'volume.economic-exit.decision-digest.v1',
    decisionIdentitySemantic,
  ) as `vexitdecisiond_${string}`;
  let exitPlan: Readonly<VolumeShadowExitPlan> | null = null;
  if (planCore !== null) {
    const planBase = deepFreeze({ decisionId, ...planCore });
    exitPlan = deepFreeze({
      planId: identity('vexitplan', 'volume.economic-exit.plan.v1', planBase),
      ...planBase,
    }) as Readonly<VolumeShadowExitPlan>;
  }
  const decision = deepFreeze({
    decisionId,
    decisionDigest,
    ...decisionBase,
    exitPlan,
  }) as Readonly<VolumeEconomicExitDecision>;
  return deepFreeze({ sample, decision });
}

export const evaluateVolumeEconomicExitRule = evaluateVolumeEconomicExit;

const SAMPLE_KEYS = [
  'currentObservationDigest', 'direction', 'drawdownFromFavorableExtremePer1000',
  'economicsApplicability', 'entryEvaluationId', 'entryObservationDigest',
  'entryPlanId', 'entryProposalDigest', 'entryProposalId', 'entryQuoteNotional',
  'evaluatedAtMs', 'exitQuoteNotional', 'favorableExtremeNetPnlPer1000',
  'holdAgeMs', 'modeledBaseQuantity', 'netLiquidationPnlPer1000', 'observedAtMs',
  'openedAtMs', 'policyDigest', 'previousSampleId',
  'priorFavorableExtremeNetPnlPer1000', 'sampleDigest', 'sampleId',
  'sampleRevision', 'schemaVersion', 'sourceDisposition', 'symbol',
] as const;

export function validateVolumeForwardExitSample(
  input: unknown,
): input is Readonly<VolumeForwardExitSample> {
  const snap = snapshotData(input);
  const value = snap === INVALID ? null : record(snap);
  if (value === null || !exactKeys(value, SAMPLE_KEYS)
      || value.schemaVersion !== VOLUME_FORWARD_EXIT_SAMPLE_SCHEMA_VERSION
      || typeof value.sampleId !== 'string' || !/^vfes_[a-f0-9]{32}$/.test(value.sampleId)
      || typeof value.sampleDigest !== 'string' || !/^vfesd_[a-f0-9]{32}$/.test(value.sampleDigest)
      || !Number.isSafeInteger(value.sampleRevision)
      || (value.sampleRevision as number) < 1
      || (value.sampleRevision === 1) !== (value.previousSampleId === null)
      || (value.previousSampleId !== null
        && (typeof value.previousSampleId !== 'string'
          || !/^vfes_[a-f0-9]{32}$/.test(value.previousSampleId)))
      || typeof value.entryEvaluationId !== 'string'
      || !/^vevaluation_[a-f0-9]{64}$/.test(value.entryEvaluationId)
      || typeof value.entryPlanId !== 'string'
      || !/^vplan_[a-f0-9]{64}$/.test(value.entryPlanId)
      || !validIdentifier(value.entryProposalId, 128)
      || !validIdentifier(value.entryProposalDigest)
      || typeof value.entryObservationDigest !== 'string'
      || !/^vobs_[a-f0-9]{64}$/.test(value.entryObservationDigest)
      || (value.currentObservationDigest !== null
        && (typeof value.currentObservationDigest !== 'string'
          || !/^vobs_[a-f0-9]{64}$/.test(value.currentObservationDigest)))
      || typeof value.policyDigest !== 'string'
      || !/^vexitpolicyd_[a-f0-9]{32}$/.test(value.policyDigest)
      || typeof value.symbol !== 'string'
      || !/^[A-Z0-9]{1,20}$/.test(value.symbol)
      || !validTime(value.openedAtMs) || !validTime(value.evaluatedAtMs)
      || value.evaluatedAtMs < value.openedAtMs
      || value.holdAgeMs !== value.evaluatedAtMs - value.openedAtMs
      || (value.observedAtMs !== null && !validTime(value.observedAtMs))
      || (value.currentObservationDigest === null) !== (value.observedAtMs === null)
      || (value.observedAtMs !== null
        && value.observedAtMs > value.evaluatedAtMs)
      || (value.direction !== 'long' && value.direction !== 'short')
      || (value.sourceDisposition !== 'ACCEPTED' && value.sourceDisposition !== 'DEGRADED')
      || value.economicsApplicability !== 'SYNTHETIC_TEST_ONLY'
      || canonicalNonNegative(value.modeledBaseQuantity, true) === null
      || canonicalNonNegative(value.entryQuoteNotional, true) === null) return false;

  const exitQuoteNotional = value.exitQuoteNotional === null
    ? null
    : canonicalNonNegative(value.exitQuoteNotional, true);
  const netLiquidationPnlPer1000 = value.netLiquidationPnlPer1000 === null
    ? null
    : canonicalExact(value.netLiquidationPnlPer1000);
  const priorFavorableExtremeNetPnlPer1000 =
    value.priorFavorableExtremeNetPnlPer1000 === null
      ? null
      : canonicalExact(value.priorFavorableExtremeNetPnlPer1000);
  const favorableExtremeNetPnlPer1000 = value.favorableExtremeNetPnlPer1000 === null
    ? null
    : canonicalExact(value.favorableExtremeNetPnlPer1000);
  const drawdownFromFavorableExtremePer1000 =
    value.drawdownFromFavorableExtremePer1000 === null
      ? null
      : canonicalNonNegative(value.drawdownFromFavorableExtremePer1000);
  if ((value.exitQuoteNotional !== null && exitQuoteNotional === null)
      || (value.netLiquidationPnlPer1000 !== null && netLiquidationPnlPer1000 === null)
      || (value.priorFavorableExtremeNetPnlPer1000 !== null
        && priorFavorableExtremeNetPnlPer1000 === null)
      || (value.favorableExtremeNetPnlPer1000 !== null
        && favorableExtremeNetPnlPer1000 === null)
      || (value.drawdownFromFavorableExtremePer1000 !== null
        && drawdownFromFavorableExtremePer1000 === null)
      || (value.sampleRevision === 1 && priorFavorableExtremeNetPnlPer1000 !== null)
      || (exitQuoteNotional !== null && value.currentObservationDigest === null)
      || (netLiquidationPnlPer1000 !== null && exitQuoteNotional === null)
      || ((value.sourceDisposition === 'ACCEPTED')
        !== (netLiquidationPnlPer1000 !== null))) {
    return false;
  }
  if (netLiquidationPnlPer1000 === null) {
    if (drawdownFromFavorableExtremePer1000 !== null
        || favorableExtremeNetPnlPer1000 !== priorFavorableExtremeNetPnlPer1000) return false;
  } else {
    const expectedFavorable = priorFavorableExtremeNetPnlPer1000 === null
      ? netLiquidationPnlPer1000
      : maximumExactDecimal(
        priorFavorableExtremeNetPnlPer1000,
        netLiquidationPnlPer1000,
      );
    if (favorableExtremeNetPnlPer1000 !== expectedFavorable
        || drawdownFromFavorableExtremePer1000 === null
        || drawdownFromFavorableExtremePer1000 !== subtractExactDecimals(
          expectedFavorable,
          netLiquidationPnlPer1000,
        )) return false;
  }

  const { sampleId, sampleDigest, ...semantic } = value;
  return sampleId === identity('vfes', 'volume.forward-exit.sample-id.v1', semantic)
    && sampleDigest === identity('vfesd', 'volume.forward-exit.sample-digest.v1', semantic);
}

const DECISION_KEYS = [
  'decisionDigest', 'decisionId', 'disposition', 'evaluatedAtMs', 'exitPlan',
  'lifecyclePhase', 'primaryReason', 'reasonCodes', 'sampleId', 'schemaVersion',
] as const;

const EXIT_TERMS_KEYS = [
  'baseQuantity', 'capacityBasis', 'currentObservationDigest', 'direction',
  'entryObservationDigest', 'exitSide', 'levelCount', 'limitPrice',
  'orderType', 'partialFillPolicy', 'quoteNotional', 'recoveryPolicy',
  'symbol', 'termsId', 'timeInForce', 'unknownOutcomePolicy',
] as const;

const EXIT_PLAN_KEYS = [
  'decisionId', 'exchangeQueries', 'executionAuthority', 'externalAuthority',
  'killSwitchEngaged', 'mode', 'planId', 'privateCalls', 'providerCalls',
  'publicOnly', 'queryPortPresent', 'rejectionCodes', 'riskAuthority',
  'sampleId', 'schemaVersion', 'sendEligible', 'sends', 'sideEffects',
  'signedCalls', 'submitAuthority', 'submitPortPresent', 'terms', 'validation',
] as const;

function validateExitTerms(value: unknown): value is Readonly<VolumeHypotheticalExitTerms> {
  const terms = record(value);
  if (terms === null || !exactKeys(terms, EXIT_TERMS_KEYS)
      || typeof terms.termsId !== 'string' || !/^vexitterms_[a-f0-9]{32}$/.test(terms.termsId)
      || typeof terms.symbol !== 'string' || !/^[A-Z0-9]{1,20}$/.test(terms.symbol)
      || (terms.direction !== 'long' && terms.direction !== 'short')
      || terms.exitSide !== (terms.direction === 'long' ? 'SELL' : 'BUY')
      || terms.orderType !== 'LIMIT'
      || terms.timeInForce !== 'IOC'
      || terms.capacityBasis !== 'SYNCHRONIZED_CUMULATIVE'
      || canonicalNonNegative(terms.limitPrice, true) === null
      || canonicalNonNegative(terms.baseQuantity, true) === null
      || canonicalNonNegative(terms.quoteNotional, true) === null
      || !cumulativeExitNotionalIsConservative(
        terms.limitPrice,
        terms.baseQuantity,
        terms.quoteNotional,
        terms.exitSide,
      )
      || !Number.isSafeInteger(terms.levelCount) || (terms.levelCount as number) < 1
      || typeof terms.entryObservationDigest !== 'string'
      || !/^vobs_[a-f0-9]{64}$/.test(terms.entryObservationDigest)
      || typeof terms.currentObservationDigest !== 'string'
      || !/^vobs_[a-f0-9]{64}$/.test(terms.currentObservationDigest)
      || terms.unknownOutcomePolicy !== 'BLOCK_UNTIL_QUERY_RECONCILED'
      || terms.partialFillPolicy !== 'RECONCILE_REMAINDER_BEFORE_NEXT_PLAN'
      || terms.recoveryPolicy !== 'RESTORE_DURABLE_LATEST_BEFORE_REEVALUATION') return false;
  const { termsId, ...semantic } = terms;
  return termsId === identity('vexitterms', 'volume.economic-exit.terms.v1', semantic);
}

function parseExitPlan(
  value: unknown,
  decisionId: unknown,
  sampleId: unknown,
): Readonly<VolumeShadowExitPlan> | null {
  const plan = record(value);
  if (plan === null || !exactKeys(plan, EXIT_PLAN_KEYS)
      || typeof plan.planId !== 'string' || !/^vexitplan_[a-f0-9]{32}$/.test(plan.planId)
      || plan.decisionId !== decisionId
      || plan.sampleId !== sampleId
      || plan.schemaVersion !== 1
      || plan.mode !== VOLUME_ECONOMIC_EXIT_MODE
      || plan.validation !== 'REJECTED'
      || plan.killSwitchEngaged !== true
      || plan.executionAuthority !== 'NONE'
      || plan.submitAuthority !== 'NONE'
      || plan.riskAuthority !== 'NONE'
      || plan.externalAuthority !== 'NONE'
      || plan.sendEligible !== false
      || plan.sends !== 0
      || plan.sideEffects !== 0
      || plan.submitPortPresent !== false
      || plan.queryPortPresent !== false
      || plan.publicOnly !== true
      || plan.privateCalls !== false
      || plan.signedCalls !== false
      || plan.providerCalls !== false
      || plan.exchangeQueries !== 0
      || !Array.isArray(plan.rejectionCodes)
      || plan.rejectionCodes.length < 4
      || plan.rejectionCodes.some((code) => (
        typeof code !== 'string'
        || !VOLUME_ECONOMIC_EXIT_REJECTION_CODES.includes(code as VolumeEconomicExitRejectionCode)
      ))) return null;
  const codes = plan.rejectionCodes as string[];
  if (new Set(codes).size !== codes.length
      || [...codes].sort(compareText).some((code, index) => code !== codes[index])
      || !codes.includes('EXIT_ACCOUNT_FEE_PROOF_NOT_CURRENT')
      || !codes.includes('EXIT_ENTRY_FILL_UNPROVEN')
      || !codes.includes('EXIT_SYMBOL_FILTER_PROOF_NOT_CURRENT')
      || !codes.includes('EXIT_NO_EXECUTION_AUTHORITY')) return null;
  if (plan.terms !== null && !validateExitTerms(plan.terms)) return null;
  if (plan.terms !== null
      && (plan.terms as Readonly<VolumeHypotheticalExitTerms>).direction === 'short'
      && !codes.includes('EXIT_SHORT_INVENTORY_UNPROVEN')) return null;
  const { planId, ...semantic } = plan;
  if (planId !== identity('vexitplan', 'volume.economic-exit.plan.v1', semantic)) return null;
  return plan as unknown as Readonly<VolumeShadowExitPlan>;
}

export function validateVolumeEconomicExitDecision(
  input: unknown,
): input is Readonly<VolumeEconomicExitDecision> {
  const snap = snapshotData(input);
  const value = snap === INVALID ? null : record(snap);
  if (value === null || !exactKeys(value, DECISION_KEYS)
      || value.schemaVersion !== VOLUME_ECONOMIC_EXIT_RULE_SCHEMA_VERSION
      || typeof value.decisionId !== 'string' || !/^vexitdecision_[a-f0-9]{32}$/.test(value.decisionId)
      || typeof value.decisionDigest !== 'string' || !/^vexitdecisiond_[a-f0-9]{32}$/.test(value.decisionDigest)
      || !validTime(value.evaluatedAtMs)
      || (value.sampleId !== null
        && (typeof value.sampleId !== 'string' || !/^vfes_[a-f0-9]{32}$/.test(value.sampleId)))
      || !Array.isArray(value.reasonCodes)
      || value.reasonCodes.length > 16
      || value.reasonCodes.some((code) => typeof code !== 'string')) return false;
  const parsedPlan = value.exitPlan === null
    ? null
    : parseExitPlan(value.exitPlan, value.decisionId, value.sampleId);
  if (value.exitPlan !== null && parsedPlan === null) return false;
  const base = {
    schemaVersion: value.schemaVersion,
    sampleId: value.sampleId,
    evaluatedAtMs: value.evaluatedAtMs,
    lifecyclePhase: value.lifecyclePhase,
    disposition: value.disposition,
    primaryReason: value.primaryReason,
    reasonCodes: value.reasonCodes,
  };
  const planCore = parsedPlan === null
    ? null
    : (({ planId: _planId, decisionId: _decisionId, ...semantic }) => semantic)(parsedPlan);
  const semantic = decisionSemantic(
    base as Omit<VolumeEconomicExitDecision, 'decisionId' | 'decisionDigest' | 'exitPlan'>,
    planCore,
  );
  if (value.decisionId !== identity('vexitdecision', 'volume.economic-exit.decision-id.v1', semantic)
      || value.decisionDigest !== identity(
        'vexitdecisiond',
        'volume.economic-exit.decision-digest.v1',
        semantic,
      )) return false;
  if (value.disposition === 'REJECTED') {
    const codes = value.reasonCodes as string[];
    const sorted = [...new Set(codes)].sort(compareText);
    return value.lifecyclePhase === 'REJECTED'
      && value.primaryReason === 'INPUT_REJECTED'
      && value.sampleId === null
      && value.exitPlan === null
      && codes.length > 0
      && codes.every((code, index) => (
        VOLUME_ECONOMIC_EXIT_REJECTION_CODES.includes(code as VolumeEconomicExitRejectionCode)
        && code === sorted[index]
      ));
  }
  const codes = value.reasonCodes as string[];
  return (value.disposition === 'HOLD_SHADOW'
      && value.lifecyclePhase === 'HOLDING'
      && value.primaryReason === 'NO_EXIT_TRIGGER'
      && typeof value.sampleId === 'string'
      && value.exitPlan === null
      && codes.length === 1
      && codes[0] === 'NO_EXIT_TRIGGER')
    || (value.disposition === 'EXIT_SHADOW'
      && value.lifecyclePhase === 'TERMINAL_EXIT'
      && VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE.includes(
        value.primaryReason as (typeof VOLUME_ECONOMIC_EXIT_TRIGGER_PRECEDENCE)[number],
      )
      && value.primaryReason !== 'NO_EXIT_TRIGGER'
      && typeof value.sampleId === 'string'
      && parsedPlan !== null
      && codes[0] === value.primaryReason
      && (codes.length === 1
        || (codes.length === 2
          && value.primaryReason === 'SOURCE_DEGRADED'
          && codes[1] === 'EXIT_LIQUIDATION_CAPACITY_INSUFFICIENT')));
}

/** Cross-validates the two objects that form one durable shadow-exit state. */
export function validateVolumeEconomicExitState(
  input: unknown,
): input is Readonly<{
  sample: Readonly<VolumeForwardExitSample>;
  decision: Readonly<VolumeEconomicExitDecision>;
}> {
  const snap = snapshotData(input);
  const state = snap === INVALID ? null : record(snap);
  if (state === null || !exactKeys(state, ['decision', 'sample'])
      || !validateVolumeForwardExitSample(state.sample)
      || !validateVolumeEconomicExitDecision(state.decision)) return false;
  const sample = state.sample;
  const decision = state.decision;
  if (decision.sampleId !== sample.sampleId
      || decision.evaluatedAtMs !== sample.evaluatedAtMs
      || decision.disposition === 'REJECTED') return false;
  if (decision.disposition === 'HOLD_SHADOW') {
    return sample.sourceDisposition === 'ACCEPTED'
      && sample.holdAgeMs < VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS
      && decision.primaryReason === 'NO_EXIT_TRIGGER'
      && decision.exitPlan === null;
  }
  if (sample.sourceDisposition === 'DEGRADED') {
    if (decision.primaryReason !== 'SOURCE_DEGRADED') return false;
  } else if (sample.holdAgeMs >= VOLUME_ECONOMIC_EXIT_MAX_HOLD_MS) {
    if (decision.primaryReason !== 'MAX_HOLD_REACHED') return false;
  } else if (decision.primaryReason === 'NET_LIQUIDATION_STOP_REACHED'
      || decision.primaryReason === 'NET_LIQUIDATION_REVERSAL_LOSS_REACHED') {
    const net = canonicalExact(sample.netLiquidationPnlPer1000);
    if (net === null || compareExactDecimals(net, ZERO) >= 0) return false;
  } else if (decision.primaryReason === 'TRAILING_DRAWDOWN_REACHED') {
    const drawdown = canonicalNonNegative(sample.drawdownFromFavorableExtremePer1000);
    if (drawdown === null || compareExactDecimals(drawdown, ZERO) <= 0) return false;
  } else {
    return false;
  }
  const plan = decision.exitPlan;
  if (plan === null) return false;
  const requiredPlanRejections = [
    'EXIT_ACCOUNT_FEE_PROOF_NOT_CURRENT',
    'EXIT_ENTRY_FILL_UNPROVEN',
    'EXIT_NO_EXECUTION_AUTHORITY',
    ...(sample.direction === 'short' ? ['EXIT_SHORT_INVENTORY_UNPROVEN'] : []),
    'EXIT_SYMBOL_FILTER_PROOF_NOT_CURRENT',
  ].sort(compareText);
  if (plan.rejectionCodes.length !== requiredPlanRejections.length
      || plan.rejectionCodes.some((code, index) => code !== requiredPlanRejections[index])) {
    return false;
  }
  const terms = decision.exitPlan?.terms;
  if (terms === null || terms === undefined) {
    return decision.primaryReason === 'SOURCE_DEGRADED'
      && sample.sourceDisposition === 'DEGRADED';
  }
  if (decision.reasonCodes.includes('EXIT_LIQUIDATION_CAPACITY_INSUFFICIENT')) return false;
  return terms.symbol === sample.symbol
    && terms.direction === sample.direction
    && terms.baseQuantity === sample.modeledBaseQuantity
    && terms.quoteNotional === sample.exitQuoteNotional
    && terms.entryObservationDigest === sample.entryObservationDigest
    && terms.currentObservationDigest === sample.currentObservationDigest;
}

export function replayVolumeEconomicExitDecision(
  input: unknown,
): Readonly<{
  status: 'EXACT' | 'INVALID';
  decision: Readonly<VolumeEconomicExitDecision> | null;
}> {
  if (!validateVolumeEconomicExitDecision(input)) {
    return Object.freeze({ status: 'INVALID', decision: null });
  }
  const snap = snapshotData(input);
  return deepFreeze({
    status: 'EXACT' as const,
    decision: snap as Readonly<VolumeEconomicExitDecision>,
  });
}
