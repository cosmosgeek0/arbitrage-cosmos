import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from '../../foundation/contracts/index.js';
import {
  compareExactDecimals,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  assessVolumeStrategyObservationSource,
  validateVolumeStrategyObservation,
  type VolumeObservationCapacitySide,
  type VolumeStrategyObservation,
  type VolumeStrategyObservationSourceRejectionCode,
} from './strategyObservation.js';
import {
  assessVolumeEconomics,
  validateVolumeEconomics,
  VOLUME_ECONOMICS_REJECTION_CODES,
  VOLUME_ECONOMICS_VALIDATION_CODES,
  type VolumeEconomicsAssessment,
  type VolumeEconomicsEvidence,
  type VolumeEconomicsRejectionCode,
  type VolumeEconomicsValidationCode,
} from './strategyEconomics.js';

export const VOLUME_STRATEGY_SLICE_SCHEMA_VERSION = 1 as const;
export const VOLUME_STRATEGY_SLICE_MODE = 'VALIDATE_ONLY' as const;
export const VOLUME_STRATEGY_SLICE_SCOPE = 'LOCAL_LEDGER_ONLY' as const;
export const VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND =
  'VOLUME_VALIDATE_ONLY_OBSERVATION' as const;

const MAX_SNAPSHOT_DEPTH = 16;
const MAX_SNAPSHOT_NODES = 10_000;
const MAX_ARRAY_LENGTH = 512;
const MAX_OBJECT_KEYS = 128;
const MAX_STRING_LENGTH = 16_384;
const MAX_REASON_CODES = 128;

const PROPOSAL_KEYS = Object.freeze([
  'configurationRevision',
  'correlationId',
  'direction',
  'expiresAtMs',
  'featureObservedAtMs',
  'proposalDigest',
  'proposalId',
  'proposalRevision',
  'symbol',
  'updatedTs',
]);

const VALIDATE_ONLY_PROPOSAL_KEYS = Object.freeze([
  ...PROPOSAL_KEYS,
  'evidenceBindingDigest',
  'proposalKind',
]);

const VALIDATE_ONLY_PROPOSAL_INPUT_KEYS = Object.freeze([
  'configurationRevision',
  'decision',
  'expiresAtMs',
]);

const VERIFIED_KILL_SWITCH_DECISION_KEYS = Object.freeze([
  'correlationId',
  'evidence',
  'humanReason',
  'kind',
  'rejectCode',
  'strategy',
  'symbol',
  'ts',
]);

const PLAN_KEYS = Object.freeze([
  'economicsDigest',
  'evaluationId',
  'executionAuthority',
  'executionTerms',
  'externalAuthority',
  'killSwitchEngaged',
  'mode',
  'observationDigest',
  'planId',
  'privateCalls',
  'providerCalls',
  'proposal',
  'publicOnly',
  'rejectionCodes',
  'riskAuthority',
  'schemaVersion',
  'sendEligible',
  'sends',
  'sideEffects',
  'signedCalls',
  'submitAuthority',
  'submitPortPresent',
  'validation',
]);

const TERMS_KEYS = Object.freeze([
  'baseQuantity',
  'capacityBasis',
  'capacitySide',
  'direction',
  'economicsDigest',
  'economicsValuationAsset',
  'entrySide',
  'levelCount',
  'liquidityCapacity',
  'observationDigest',
  'price',
  'quoteAsset',
  'quoteNotional',
  'symbol',
  'termsId',
]);

const EVALUATION_KEYS = Object.freeze([
  'controls',
  'disposition',
  'economicsApplicability',
  'economicsDigest',
  'evaluatedAtMs',
  'evaluationId',
  'observationDigest',
  'plan',
  'proposal',
  'rejectionCodes',
  'schemaVersion',
]);

const CONTROL_KEYS = Object.freeze([
  'enabled',
  'killSwitchEngaged',
]);

const RECONCILIATION_KEYS = Object.freeze([
  'evaluatedAtMs',
  'exchangeReconciliation',
  'executionAuthority',
  'expectedEvaluationId',
  'expectedPlanId',
  'flatnessProven',
  'persistedEvaluationId',
  'persistedPlanId',
  'reasonCodes',
  'reconciliationId',
  'schemaVersion',
  'scope',
  'status',
]);

type LocalRejectionCode =
  | 'STRATEGY_DISABLED'
  | 'PROPOSAL_INVALID'
  | 'OBSERVATION_INVALID'
  | 'OBSERVATION_PROPOSAL_MISMATCH'
  | 'OBSERVATION_SOURCE_REJECTED'
  | 'OBSERVATION_CAPACITY_INVALID'
  | 'ECONOMICS_INVALID'
  | 'ECONOMICS_EXPIRED'
  | 'ECONOMICS_FUTURE_EVALUATION'
  | 'ECONOMICS_REJECTED'
  | 'ECONOMICS_NOT_POSITIVE'
  | 'ECONOMICS_VALUATION_ASSET_MISMATCH';

const LOCAL_REJECTION_CODES = Object.freeze([
  'STRATEGY_DISABLED',
  'PROPOSAL_INVALID',
  'OBSERVATION_INVALID',
  'OBSERVATION_PROPOSAL_MISMATCH',
  'OBSERVATION_SOURCE_REJECTED',
  'OBSERVATION_CAPACITY_INVALID',
  'ECONOMICS_INVALID',
  'ECONOMICS_EXPIRED',
  'ECONOMICS_FUTURE_EVALUATION',
  'ECONOMICS_REJECTED',
  'ECONOMICS_NOT_POSITIVE',
  'ECONOMICS_VALUATION_ASSET_MISMATCH',
] as const satisfies readonly LocalRejectionCode[]);

const OBSERVATION_SOURCE_REJECTION_CODES = Object.freeze([
  'VOLUME_SOURCE_OBSERVATION_INVALID',
  'VOLUME_SOURCE_CONTINUITY_GAP',
  'VOLUME_SOURCE_CONTINUITY_UNKNOWN',
  'VOLUME_SOURCE_RECONNECTING',
  'VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED',
  'VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY',
] as const satisfies readonly VolumeStrategyObservationSourceRejectionCode[]);

const KNOWN_REJECTION_CODES = new Set<string>([
  ...LOCAL_REJECTION_CODES,
  ...VOLUME_ECONOMICS_REJECTION_CODES,
  ...VOLUME_ECONOMICS_VALIDATION_CODES,
  ...OBSERVATION_SOURCE_REJECTION_CODES,
]);

export type VolumeStrategyRejectionCode =
  | LocalRejectionCode
  | VolumeEconomicsRejectionCode
  | VolumeEconomicsValidationCode
  | VolumeStrategyObservationSourceRejectionCode;

export interface VolumeStrategySliceControls {
  readonly enabled: boolean;
  /**
   * This slice has no arming API. A validate-only record can be evaluated while
   * the kill switch remains engaged, but it can never become send-eligible.
   */
  readonly killSwitchEngaged: true;
}

export interface VolumeStrategyProposalBinding {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly updatedTs: number;
  readonly featureObservedAtMs: number;
  readonly expiresAtMs: number;
  readonly proposalKind?: typeof VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND;
  readonly evidenceBindingDigest?: `vdecision_${string}`;
}

export interface VolumeValidateOnlyObservationProposalInput {
  readonly decision: Readonly<{
    readonly symbol: string;
    readonly ts: number;
    readonly strategy: 'volume_spike';
    readonly kind: 'reject';
    readonly rejectCode: 'kill_switch_on';
    readonly humanReason: string;
    readonly correlationId: string;
    readonly evidence: Readonly<Record<string, number | string | boolean | null>>;
  }>;
  readonly configurationRevision: string;
  readonly expiresAtMs: number;
}

export interface VolumeValidateOnlyObservationProposal
  extends VolumeStrategyProposalBinding {
  readonly proposalKind: typeof VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND;
  readonly evidenceBindingDigest: `vdecision_${string}`;
  readonly proposalRevision: 1;
}

export interface VolumeValidateOnlyExecutionTerms {
  readonly termsId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly entrySide: 'BUY' | 'SELL';
  readonly capacitySide: VolumeObservationCapacitySide;
  readonly capacityBasis: 'BEST_LEVEL_ONLY' | 'SYNCHRONIZED_CUMULATIVE';
  readonly price: string;
  readonly baseQuantity: string;
  readonly quoteAsset: 'USDT';
  readonly quoteNotional: string;
  readonly levelCount: number;
  readonly economicsValuationAsset: 'USDT';
  readonly liquidityCapacity: string;
  readonly observationDigest: VolumeStrategyObservation['observationDigest'];
  readonly economicsDigest: VolumeEconomicsEvidence['economicsDigest'];
}

export interface VolumeValidateOnlyPlan {
  readonly schemaVersion: typeof VOLUME_STRATEGY_SLICE_SCHEMA_VERSION;
  readonly planId: string;
  readonly evaluationId: string;
  readonly mode: typeof VOLUME_STRATEGY_SLICE_MODE;
  readonly validation: 'REJECTED' | 'VALIDATED_RECORD_ONLY';
  readonly proposal: Readonly<VolumeStrategyProposalBinding>;
  readonly observationDigest: VolumeStrategyObservation['observationDigest'];
  readonly economicsDigest: VolumeEconomicsEvidence['economicsDigest'];
  readonly rejectionCodes: readonly VolumeStrategyRejectionCode[];
  readonly executionTerms: Readonly<VolumeValidateOnlyExecutionTerms> | null;
  readonly killSwitchEngaged: true;
  readonly executionAuthority: 'NONE';
  readonly submitAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly externalAuthority: 'NONE';
  readonly sendEligible: false;
  readonly sends: 0;
  readonly sideEffects: 0;
  readonly submitPortPresent: false;
  readonly publicOnly: true;
  readonly privateCalls: false;
  readonly signedCalls: false;
  readonly providerCalls: false;
}

export interface VolumeStrategyEvaluationInput {
  readonly proposal: Readonly<VolumeStrategyProposalBinding>;
  readonly observation: Readonly<VolumeStrategyObservation>;
  readonly economics: Readonly<VolumeEconomicsEvidence>;
}

export interface VolumeStrategyEvaluation {
  readonly schemaVersion: typeof VOLUME_STRATEGY_SLICE_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly evaluatedAtMs: number;
  readonly disposition: VolumeValidateOnlyPlan['validation'];
  readonly economicsApplicability: 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY';
  readonly controls: Readonly<VolumeStrategySliceControls>;
  readonly proposal: Readonly<VolumeStrategyProposalBinding>;
  readonly observationDigest: VolumeStrategyObservation['observationDigest'];
  readonly economicsDigest: VolumeEconomicsEvidence['economicsDigest'];
  readonly rejectionCodes: readonly VolumeStrategyRejectionCode[];
  readonly plan: Readonly<VolumeValidateOnlyPlan>;
}

export type VolumeStrategyReplayResult = Readonly<
  | {
      status: 'EXACT';
      evaluation: Readonly<VolumeStrategyEvaluation>;
      reasonCodes: readonly [];
    }
  | {
      status: 'INVALID' | 'DIVERGED';
      evaluation: null;
      reasonCodes: readonly string[];
    }
>;

export type VolumeStrategyLocalReconciliationStatus =
  | 'EXACT'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'AMBIGUOUS'
  | 'DIVERGED';

export interface VolumeStrategyLocalReconciliation {
  readonly schemaVersion: typeof VOLUME_STRATEGY_SLICE_SCHEMA_VERSION;
  readonly reconciliationId: string;
  readonly scope: typeof VOLUME_STRATEGY_SLICE_SCOPE;
  readonly status: VolumeStrategyLocalReconciliationStatus;
  readonly evaluatedAtMs: number | null;
  readonly expectedEvaluationId: string | null;
  readonly expectedPlanId: string | null;
  readonly persistedEvaluationId: string | null;
  readonly persistedPlanId: string | null;
  readonly reasonCodes: readonly string[];
  readonly executionAuthority: 'NONE';
  readonly exchangeReconciliation: false;
  readonly flatnessProven: false;
}

interface SnapshotState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function isPollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function snapshotValue(value: unknown, state: SnapshotState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    throw new TypeError('Volume strategy input exceeds its bounded data envelope');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new TypeError('Volume strategy string exceeds its bound');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('Volume strategy numbers must be finite canonical values');
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new TypeError('Volume strategy input must contain ordinary data only');
  }
  if (state.seen.has(value)) throw new TypeError('Volume strategy input must be acyclic');
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError('Volume strategy arrays must be ordinary arrays');
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || length > MAX_ARRAY_LENGTH) {
      throw new TypeError('Volume strategy array length is invalid');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.some((key) => typeof key === 'symbol')) {
      throw new TypeError('Volume strategy arrays must be dense own data');
    }
    const out: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError('Volume strategy arrays must be dense own data');
      }
      out.push(snapshotValue(descriptor.value, state, depth + 1));
    }
    state.seen.delete(value);
    return Object.freeze(out);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Volume strategy records must be plain objects');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_KEYS
      || keys.some((key) => typeof key === 'symbol' || isPollutionKey(key as string))) {
    throw new TypeError('Volume strategy record keys are invalid');
  }
  const out: Record<string, unknown> = {};
  for (const key of (keys as string[]).sort(compareText)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('Volume strategy records must expose own data only');
    }
    Object.defineProperty(out, key, {
      value: snapshotValue(descriptor.value, state, depth + 1),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  state.seen.delete(value);
  return Object.freeze(out);
}

function snapshot<T>(value: unknown): Readonly<T> | null {
  try {
    return snapshotValue(value, { nodes: 0, seen: new WeakSet<object>() }) as Readonly<T>;
  } catch {
    return null;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareText);
  const sortedExpected = [...expected].sort(compareText);
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function validUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 4_102_444_800_000
    && !Object.is(value, -0);
}

function validIdentifier(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function validObservationDigest(
  value: unknown,
): value is VolumeStrategyObservation['observationDigest'] {
  return typeof value === 'string' && /^vobs_[a-f0-9]{64}$/.test(value);
}

function validEconomicsDigest(
  value: unknown,
): value is VolumeEconomicsEvidence['economicsDigest'] {
  return typeof value === 'string' && /^vecond_[a-f0-9]{32}$/.test(value);
}

function validDecisionBindingDigest(value: unknown): value is `vdecision_${string}` {
  return typeof value === 'string' && /^vdecision_[a-f0-9]{64}$/.test(value);
}

function validPositiveExactDecimal(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    const zero = normalizeNonNegativeExactDecimal('0');
    return normalized === value && compareExactDecimals(normalized, zero) > 0;
  } catch {
    return false;
  }
}

function exactProductMatches(left: string, right: string, expected: string): boolean {
  try {
    const normalizedLeft = normalizeNonNegativeExactDecimal(left);
    const normalizedRight = normalizeNonNegativeExactDecimal(right);
    const normalizedExpected = normalizeNonNegativeExactDecimal(expected);
    return normalizedLeft === left
      && normalizedRight === right
      && normalizedExpected === expected
      && multiplyExactDecimals(normalizedLeft, normalizedRight) === normalizedExpected;
  } catch {
    return false;
  }
}

function exactCumulativeCapacityIsConservative(
  price: string,
  quantity: string,
  quoteNotional: string,
  side: 'BUY' | 'SELL',
): boolean {
  try {
    const normalizedPrice = normalizeNonNegativeExactDecimal(price);
    const normalizedQuantity = normalizeNonNegativeExactDecimal(quantity);
    const normalizedNotional = normalizeNonNegativeExactDecimal(quoteNotional);
    if (normalizedPrice !== price
        || normalizedQuantity !== quantity
        || normalizedNotional !== quoteNotional) return false;
    const worstPriceNotional = multiplyExactDecimals(normalizedPrice, normalizedQuantity);
    const comparison = compareExactDecimals(worstPriceNotional, normalizedNotional);
    return side === 'BUY' ? comparison >= 0 : comparison <= 0;
  } catch {
    return false;
  }
}

function supportedQuoteAsset(symbol: string): 'USDT' | null {
  return symbol.length > 4 && symbol.endsWith('USDT') ? 'USDT' : null;
}

function isKnownRejectionCode(value: unknown): value is VolumeStrategyRejectionCode {
  return typeof value === 'string' && KNOWN_REJECTION_CODES.has(value);
}

function hash(namespace: string, value: unknown): string {
  return createHash('sha256').update(`${namespace}|${canonicalJson(value)}`).digest('hex');
}

function contentId(prefix: string, namespace: string, value: unknown): string {
  return `${prefix}_${hash(namespace, value)}`;
}

function validateOnlyProposalSemantic(
  value: Omit<
    VolumeValidateOnlyObservationProposal,
    'proposalId' | 'proposalDigest'
  >,
): unknown {
  return value;
}

export function buildVolumeValidateOnlyObservationProposal(
  value: unknown,
): Readonly<VolumeValidateOnlyObservationProposal> {
  const input = snapshot<Record<string, unknown>>(value);
  if (input === null || !exactKeys(input, VALIDATE_ONLY_PROPOSAL_INPUT_KEYS)) {
    throw new TypeError('validate-only Volume observation proposal input is invalid');
  }
  const decision = record(input.decision);
  const evidence = decision === null ? null : record(decision.evidence);
  if (decision === null
      || evidence === null
      || !exactKeys(decision, VERIFIED_KILL_SWITCH_DECISION_KEYS)
      || decision.strategy !== 'volume_spike'
      || decision.kind !== 'reject'
      || decision.rejectCode !== 'kill_switch_on'
      || typeof decision.symbol !== 'string'
      || !/^[A-Z0-9]{1,20}$/.test(decision.symbol)
      || !validUtcMs(decision.ts)
      || !validIdentifier(decision.correlationId, 128)
      || typeof decision.humanReason !== 'string'
      || decision.humanReason.trim().length === 0
      || decision.humanReason.length > 1_024
      || /[\u0000-\u001f\u007f]/.test(decision.humanReason)
      || (evidence.direction !== 'long' && evidence.direction !== 'short')
      || Object.values(evidence).some((item) => {
        if (item === null || typeof item === 'boolean') return false;
        if (typeof item === 'number') {
          return !Number.isFinite(item) || Object.is(item, -0);
        }
        return typeof item !== 'string' || item.length > MAX_STRING_LENGTH;
      })
      || !validIdentifier(input.configurationRevision)
      || !validUtcMs(input.expiresAtMs)
      || (input.expiresAtMs as number) <= (decision.ts as number)) {
    throw new TypeError('verified kill-switch Volume decision is invalid');
  }
  const evidenceBindingDigest =
    `vdecision_${hash('volume.validate-only-observation.decision.v1', decision)}` as const;
  const semantic = Object.freeze({
    proposalRevision: 1 as const,
    configurationRevision: input.configurationRevision as string,
    correlationId: decision.correlationId as string,
    symbol: decision.symbol as string,
    direction: evidence.direction as 'long' | 'short',
    updatedTs: decision.ts as number,
    featureObservedAtMs: decision.ts as number,
    expiresAtMs: input.expiresAtMs as number,
    proposalKind: VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND,
    evidenceBindingDigest,
  });
  return Object.freeze({
    proposalId: contentId(
      'vvop',
      'volume.validate-only-observation.proposal-id.v1',
      validateOnlyProposalSemantic(semantic),
    ),
    proposalDigest: contentId(
      'vvopd',
      'volume.validate-only-observation.proposal-digest.v1',
      validateOnlyProposalSemantic(semantic),
    ),
    ...semantic,
  });
}

export function validateVolumeValidateOnlyObservationProposal(
  value: unknown,
): value is Readonly<VolumeValidateOnlyObservationProposal> {
  const proposal = snapshot<Record<string, unknown>>(value);
  if (proposal === null
      || !exactKeys(proposal, VALIDATE_ONLY_PROPOSAL_KEYS)
      || proposal.proposalKind !== VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND
      || !validDecisionBindingDigest(proposal.evidenceBindingDigest)
      || typeof proposal.proposalId !== 'string'
      || !/^vvop_[a-f0-9]{64}$/.test(proposal.proposalId)
      || typeof proposal.proposalDigest !== 'string'
      || !/^vvopd_[a-f0-9]{64}$/.test(proposal.proposalDigest)
      || proposal.proposalRevision !== 1
      || !validIdentifier(proposal.configurationRevision)
      || !validIdentifier(proposal.correlationId, 128)
      || typeof proposal.symbol !== 'string'
      || !/^[A-Z0-9]{1,20}$/.test(proposal.symbol)
      || (proposal.direction !== 'long' && proposal.direction !== 'short')
      || !validUtcMs(proposal.updatedTs)
      || !validUtcMs(proposal.featureObservedAtMs)
      || !validUtcMs(proposal.expiresAtMs)
      || proposal.featureObservedAtMs !== proposal.updatedTs
      || proposal.updatedTs >= proposal.expiresAtMs) return false;
  const semantic = Object.freeze({
    proposalRevision: 1 as const,
    configurationRevision: proposal.configurationRevision as string,
    correlationId: proposal.correlationId as string,
    symbol: proposal.symbol as string,
    direction: proposal.direction as 'long' | 'short',
    updatedTs: proposal.updatedTs as number,
    featureObservedAtMs: proposal.featureObservedAtMs as number,
    expiresAtMs: proposal.expiresAtMs as number,
    proposalKind: VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND,
    evidenceBindingDigest: proposal.evidenceBindingDigest as `vdecision_${string}`,
  });
  return proposal.proposalId === contentId(
    'vvop',
    'volume.validate-only-observation.proposal-id.v1',
    validateOnlyProposalSemantic(semantic),
  ) && proposal.proposalDigest === contentId(
    'vvopd',
    'volume.validate-only-observation.proposal-digest.v1',
    validateOnlyProposalSemantic(semantic),
  );
}

function proposalBinding(value: unknown): Readonly<VolumeStrategyProposalBinding> | null {
  const proposal = snapshot<Record<string, unknown>>(value);
  if (proposal === null
      || (!exactKeys(proposal, PROPOSAL_KEYS)
        && !exactKeys(proposal, VALIDATE_ONLY_PROPOSAL_KEYS))) return null;
  if (exactKeys(proposal, VALIDATE_ONLY_PROPOSAL_KEYS)
      && !validateVolumeValidateOnlyObservationProposal(proposal)) return null;
  if (!validIdentifier(proposal.proposalId, 128)
      || !Number.isSafeInteger(proposal.proposalRevision)
      || (proposal.proposalRevision as number) < 1
      || !validIdentifier(proposal.proposalDigest)
      || !validIdentifier(proposal.configurationRevision)
      || !validIdentifier(proposal.correlationId, 128)
      || typeof proposal.symbol !== 'string'
      || !/^[A-Z0-9]{1,20}$/.test(proposal.symbol)
      || (proposal.direction !== 'long' && proposal.direction !== 'short')
      || !validUtcMs(proposal.updatedTs)
      || !validUtcMs(proposal.featureObservedAtMs)
      || !validUtcMs(proposal.expiresAtMs)
      || proposal.featureObservedAtMs > proposal.updatedTs
      || proposal.updatedTs >= proposal.expiresAtMs) return null;
  return proposal as unknown as Readonly<VolumeStrategyProposalBinding>;
}

function sameObservationProposal(
  proposal: Readonly<VolumeStrategyProposalBinding>,
  observation: Readonly<VolumeStrategyObservation>,
): boolean {
  return observation.proposal.proposalId === proposal.proposalId
    && observation.proposal.proposalRevision === proposal.proposalRevision
    && observation.proposal.proposalDigest === proposal.proposalDigest
    && observation.proposal.configurationRevision === proposal.configurationRevision
    && observation.proposal.correlationId === proposal.correlationId
    && observation.proposal.symbol === proposal.symbol
    && observation.proposal.direction === proposal.direction
    && observation.proposal.expiresAtMs === proposal.expiresAtMs;
}

function readCodes(value: unknown): readonly string[] {
  const source = record(value);
  if (source === null) return Object.freeze([]);
  for (const key of ['rejectionCodes', 'reasonCodes']) {
    const candidate = source[key];
    if (Array.isArray(candidate)
        && candidate.length <= MAX_REASON_CODES
        && candidate.every((code) => typeof code === 'string'
          && /^[A-Z][A-Z0-9_]{0,127}$/.test(code))) {
      return sortedUnique(candidate as string[]);
    }
  }
  return Object.freeze([]);
}

function assessmentDisposition(value: unknown): 'REJECTED' | 'SYNTHETIC_VALIDATE_ONLY' | null {
  const source = record(value);
  return source?.disposition === 'REJECTED' || source?.disposition === 'SYNTHETIC_VALIDATE_ONLY'
    ? source.disposition
    : null;
}

function assessmentApplicability(value: unknown): 'UNKNOWN' | 'SYNTHETIC_TEST_ONLY' | null {
  const source = record(value);
  return source?.applicability === 'UNKNOWN' || source?.applicability === 'SYNTHETIC_TEST_ONLY'
    ? source.applicability
    : null;
}

function planSemantic(plan: Omit<VolumeValidateOnlyPlan, 'planId'>): unknown {
  return plan;
}

function termsSemantic(terms: Omit<VolumeValidateOnlyExecutionTerms, 'termsId'>): unknown {
  return terms;
}

function evaluationSemantic(
  evaluation: Omit<VolumeStrategyEvaluation, 'evaluationId' | 'plan'>,
  executionTerms: Readonly<VolumeValidateOnlyExecutionTerms> | null,
): unknown {
  return Object.freeze({ evaluation, executionTerms });
}

function buildTerms(
  proposal: Readonly<VolumeStrategyProposalBinding>,
  observation: Readonly<VolumeStrategyObservation>,
  observationDigest: VolumeStrategyObservation['observationDigest'],
  economicsDigest: VolumeEconomicsEvidence['economicsDigest'],
  economicsValuationAsset: VolumeEconomicsEvidence['valuationAsset'],
  liquidityCapacity: string,
): Readonly<VolumeValidateOnlyExecutionTerms> | null {
  const capacity = observation.book.capacity;
  const expectedSide = proposal.direction === 'long' ? 'BUY' : 'SELL';
  const quoteAsset = supportedQuoteAsset(proposal.symbol);
  if (quoteAsset === null
      || economicsValuationAsset !== quoteAsset
      || typeof capacity.basis !== 'string'
      || (capacity.basis !== 'BEST_LEVEL_ONLY'
        && capacity.basis !== 'SYNCHRONIZED_CUMULATIVE')
      || capacity.side !== expectedSide
      || !validPositiveExactDecimal(capacity.price)
      || !validPositiveExactDecimal(capacity.baseQuantity)
      || !validPositiveExactDecimal(capacity.quoteNotional)
      || !Number.isSafeInteger(capacity.levelCount)
      || capacity.levelCount < 1
      || (capacity.basis === 'BEST_LEVEL_ONLY' && capacity.levelCount !== 1)
      || !validPositiveExactDecimal(liquidityCapacity)
      || (capacity.basis === 'BEST_LEVEL_ONLY' && !exactProductMatches(
        capacity.price,
        capacity.baseQuantity,
        capacity.quoteNotional,
      ))
      || (capacity.basis === 'SYNCHRONIZED_CUMULATIVE'
        && !exactCumulativeCapacityIsConservative(
          capacity.price,
          capacity.baseQuantity,
          capacity.quoteNotional,
          capacity.side,
        ))) return null;
  try {
    const quoteNotional = normalizeNonNegativeExactDecimal(capacity.quoteNotional);
    const normalizedLiquidityCapacity = normalizeNonNegativeExactDecimal(liquidityCapacity);
    if (compareExactDecimals(quoteNotional, normalizedLiquidityCapacity) > 0) return null;
  } catch {
    return null;
  }
  const withoutId = Object.freeze({
    symbol: proposal.symbol,
    direction: proposal.direction,
    entrySide: proposal.direction === 'long' ? 'BUY' as const : 'SELL' as const,
    capacitySide: capacity.side,
    capacityBasis: capacity.basis,
    price: capacity.price,
    baseQuantity: capacity.baseQuantity,
    quoteAsset,
    quoteNotional: capacity.quoteNotional,
    levelCount: capacity.levelCount,
    economicsValuationAsset,
    liquidityCapacity,
    observationDigest,
    economicsDigest,
  });
  return Object.freeze({
    termsId: contentId('vterms', 'volume.strategy.terms.v1', termsSemantic(withoutId)),
    ...withoutId,
  });
}

function invalidEvaluation(reasonCodes: readonly string[]): Readonly<VolumeStrategyEvaluation> {
  const proposal = Object.freeze({
    proposalId: 'invalid',
    proposalRevision: 1,
    proposalDigest: 'invalid',
    configurationRevision: 'invalid',
    correlationId: 'invalid',
    symbol: 'INVALID',
    direction: 'long' as const,
    updatedTs: 0,
    featureObservedAtMs: 0,
    expiresAtMs: 1,
  });
  const controls = Object.freeze({ enabled: false, killSwitchEngaged: true as const });
  const rejectionCodes = sortedUnique([
    'PROPOSAL_INVALID',
    'STRATEGY_DISABLED',
    ...reasonCodes.filter(isKnownRejectionCode),
  ] as VolumeStrategyRejectionCode[]);
  const observationDigest =
    `vobs_${hash('volume.strategy.invalid-observation.v1', null)}` as const;
  const economicsDigest =
    `vecond_${hash('volume.strategy.invalid-economics.v1', null).slice(0, 32)}` as const;
  const base = Object.freeze({
    schemaVersion: VOLUME_STRATEGY_SLICE_SCHEMA_VERSION,
    evaluatedAtMs: 0,
    disposition: 'REJECTED' as const,
    economicsApplicability: 'UNKNOWN' as const,
    controls,
    proposal,
    observationDigest,
    economicsDigest,
    rejectionCodes,
  });
  const evaluationId = contentId(
    'vevaluation',
    'volume.strategy.evaluation.v1',
    evaluationSemantic(base, null),
  );
  const planWithoutId = Object.freeze({
    schemaVersion: VOLUME_STRATEGY_SLICE_SCHEMA_VERSION,
    evaluationId,
    mode: VOLUME_STRATEGY_SLICE_MODE,
    validation: 'REJECTED' as const,
    proposal,
    observationDigest: base.observationDigest,
    economicsDigest: base.economicsDigest,
    rejectionCodes,
    executionTerms: null,
    killSwitchEngaged: true as const,
    executionAuthority: 'NONE' as const,
    submitAuthority: 'NONE' as const,
    riskAuthority: 'NONE' as const,
    externalAuthority: 'NONE' as const,
    sendEligible: false as const,
    sends: 0 as const,
    sideEffects: 0 as const,
    submitPortPresent: false as const,
    publicOnly: true as const,
    privateCalls: false as const,
    signedCalls: false as const,
    providerCalls: false as const,
  });
  const plan = Object.freeze({
    planId: contentId('vplan', 'volume.strategy.plan.v1', planSemantic(planWithoutId)),
    ...planWithoutId,
  });
  return Object.freeze({ evaluationId, ...base, plan });
}

export function evaluateVolumeStrategy(
  input: Readonly<VolumeStrategyEvaluationInput>,
  controlsInput: Readonly<{ enabled?: boolean; killSwitchEngaged?: true }> = {},
): Readonly<VolumeStrategyEvaluation> {
  const controlsRecord = snapshot<Record<string, unknown>>(controlsInput);
  if (controlsRecord === null
      || Object.keys(controlsRecord).some((key) => key !== 'enabled' && key !== 'killSwitchEngaged')
      || (controlsRecord.enabled !== undefined && typeof controlsRecord.enabled !== 'boolean')
      || (controlsRecord.killSwitchEngaged !== undefined && controlsRecord.killSwitchEngaged !== true)) {
    return invalidEvaluation(['STRATEGY_DISABLED']);
  }
  const controls = Object.freeze({
    enabled: controlsRecord.enabled === true,
    killSwitchEngaged: true as const,
  });

  const inputRecord = snapshot<Record<string, unknown>>(input);
  if (inputRecord === null
      || !exactKeys(inputRecord, ['economics', 'observation', 'proposal'])) {
    return invalidEvaluation(['PROPOSAL_INVALID']);
  }
  const proposal = proposalBinding(inputRecord.proposal);
  if (proposal === null) return invalidEvaluation(['PROPOSAL_INVALID']);

  const rejectionCodes: string[] = [];
  if (!controls.enabled) rejectionCodes.push('STRATEGY_DISABLED');

  const observationSnapshot = snapshot<VolumeStrategyObservation>(inputRecord.observation);
  const observationValid = observationSnapshot !== null
    && validateVolumeStrategyObservation(observationSnapshot);
  const observationDigest = observationValid
      && validObservationDigest(observationSnapshot.observationDigest)
    ? observationSnapshot.observationDigest
    : `vobs_${hash('volume.strategy.invalid-observation.v1', null)}` as const;
  if (!observationValid) {
    rejectionCodes.push('OBSERVATION_INVALID');
  } else {
    if (!sameObservationProposal(proposal, observationSnapshot)) {
      rejectionCodes.push('OBSERVATION_PROPOSAL_MISMATCH');
    }
    try {
      const sourceAssessment = assessVolumeStrategyObservationSource(observationSnapshot);
      const sourceCodes = readCodes(sourceAssessment);
      rejectionCodes.push(...sourceCodes);
      const source = record(sourceAssessment);
      if (sourceCodes.length > 0
          || source?.disposition === 'REJECTED'
          || source?.accepted === false) rejectionCodes.push('OBSERVATION_SOURCE_REJECTED');
    } catch {
      rejectionCodes.push('OBSERVATION_SOURCE_REJECTED');
    }
  }

  const economicsSnapshot = snapshot<VolumeEconomicsEvidence>(inputRecord.economics);
  const suppliedEconomicsDigest = record(economicsSnapshot)?.economicsDigest;
  const economicsDigest = validEconomicsDigest(suppliedEconomicsDigest)
    ? suppliedEconomicsDigest
    : `vecond_${hash('volume.strategy.invalid-economics.v1', null).slice(0, 32)}` as const;
  let economicsAssessment: Readonly<VolumeEconomicsAssessment> | null = null;
  let applicability: VolumeStrategyEvaluation['economicsApplicability'] = 'UNKNOWN';
  if (economicsSnapshot === null) {
    rejectionCodes.push('ECONOMICS_INVALID');
  } else {
    try {
      const validation = validateVolumeEconomics(economicsSnapshot);
      const validationRecord = record(validation);
      if (validationRecord?.valid === false
          || validationRecord?.status === 'INVALID') {
        rejectionCodes.push('ECONOMICS_INVALID');
        rejectionCodes.push(...readCodes(validation));
      }
      economicsAssessment = assessVolumeEconomics(economicsSnapshot);
      const disposition = assessmentDisposition(economicsAssessment);
      const assessedApplicability = assessmentApplicability(economicsAssessment);
      if (assessedApplicability !== null) applicability = assessedApplicability;
      rejectionCodes.push(...readCodes(economicsAssessment));
      if (disposition === null) {
        rejectionCodes.push('ECONOMICS_INVALID');
      } else if (disposition === 'REJECTED') {
        rejectionCodes.push('ECONOMICS_REJECTED');
        if (readCodes(economicsAssessment).length === 0) {
          rejectionCodes.push('ECONOMICS_NOT_POSITIVE');
        }
      } else if (observationValid) {
        if (economicsAssessment.evaluatedAtMs === null
            || economicsAssessment.evaluatedAtMs > observationSnapshot.evaluatedAtMs) {
          rejectionCodes.push('ECONOMICS_FUTURE_EVALUATION');
        }
        if (economicsAssessment.expiresAtMs === null
            || economicsAssessment.expiresAtMs <= observationSnapshot.evaluatedAtMs) {
          rejectionCodes.push('ECONOMICS_EXPIRED');
        }
      }
    } catch {
      rejectionCodes.push('ECONOMICS_INVALID');
    }
  }

  const quoteAsset = supportedQuoteAsset(proposal.symbol);
  if (quoteAsset === null
      || economicsSnapshot?.valuationAsset !== quoteAsset
      || economicsAssessment?.valuationAsset !== quoteAsset) {
    rejectionCodes.push('ECONOMICS_VALUATION_ASSET_MISMATCH');
  }

  const uniqueRejections = sortedUnique(
    rejectionCodes.filter(isKnownRejectionCode),
  );
  let terms: Readonly<VolumeValidateOnlyExecutionTerms> | null = null;
  if (uniqueRejections.length === 0
      && observationValid
      && economicsAssessment !== null
      && assessmentDisposition(economicsAssessment) === 'SYNTHETIC_VALIDATE_ONLY'
      && applicability === 'SYNTHETIC_TEST_ONLY'
      && economicsAssessment.valuationAsset === 'USDT'
      && economicsAssessment.liquidityCapacity !== null) {
    terms = buildTerms(
      proposal,
      observationSnapshot,
      observationDigest,
      economicsDigest,
      economicsAssessment.valuationAsset,
      economicsAssessment.liquidityCapacity,
    );
    if (terms === null) rejectionCodes.push('OBSERVATION_CAPACITY_INVALID');
  }

  const finalRejections = sortedUnique(
    rejectionCodes.filter(isKnownRejectionCode),
  );
  const disposition = finalRejections.length === 0 && terms !== null
    ? 'VALIDATED_RECORD_ONLY' as const
    : 'REJECTED' as const;
  if (disposition === 'REJECTED') terms = null;

  const evaluationWithoutIdentity = Object.freeze({
    schemaVersion: VOLUME_STRATEGY_SLICE_SCHEMA_VERSION,
    evaluatedAtMs: observationValid ? observationSnapshot.evaluatedAtMs : proposal.updatedTs,
    disposition,
    economicsApplicability: applicability,
    controls,
    proposal,
    observationDigest,
    economicsDigest,
    rejectionCodes: finalRejections,
  });
  const evaluationId = contentId(
    'vevaluation',
    'volume.strategy.evaluation.v1',
    evaluationSemantic(evaluationWithoutIdentity, terms),
  );
  const planWithoutId = Object.freeze({
    schemaVersion: VOLUME_STRATEGY_SLICE_SCHEMA_VERSION,
    evaluationId,
    mode: VOLUME_STRATEGY_SLICE_MODE,
    validation: disposition,
    proposal,
    observationDigest,
    economicsDigest,
    rejectionCodes: finalRejections,
    executionTerms: terms,
    killSwitchEngaged: true as const,
    executionAuthority: 'NONE' as const,
    submitAuthority: 'NONE' as const,
    riskAuthority: 'NONE' as const,
    externalAuthority: 'NONE' as const,
    sendEligible: false as const,
    sends: 0 as const,
    sideEffects: 0 as const,
    submitPortPresent: false as const,
    publicOnly: true as const,
    privateCalls: false as const,
    signedCalls: false as const,
    providerCalls: false as const,
  });
  const plan = Object.freeze({
    planId: contentId('vplan', 'volume.strategy.plan.v1', planSemantic(planWithoutId)),
    ...planWithoutId,
  });
  return Object.freeze({
    evaluationId,
    ...evaluationWithoutIdentity,
    plan,
  });
}

export class VolumeStrategySlice {
  readonly controls: Readonly<VolumeStrategySliceControls>;

  constructor(input: Readonly<{ enabled?: boolean; killSwitchEngaged?: true }> = {}) {
    const inspected = snapshot<Record<string, unknown>>(input);
    if (inspected === null
        || Object.keys(inspected).some((key) => key !== 'enabled' && key !== 'killSwitchEngaged')
        || (inspected.enabled !== undefined && typeof inspected.enabled !== 'boolean')
        || (inspected.killSwitchEngaged !== undefined && inspected.killSwitchEngaged !== true)) {
      throw new TypeError('Volume strategy controls must keep the kill switch engaged');
    }
    this.controls = Object.freeze({
      enabled: inspected.enabled === true,
      killSwitchEngaged: true,
    });
    Object.freeze(this);
  }

  evaluate(input: Readonly<VolumeStrategyEvaluationInput>): Readonly<VolumeStrategyEvaluation> {
    return evaluateVolumeStrategy(input, this.controls);
  }
}

export function createVolumeStrategySlice(
  controls: Readonly<{ enabled?: boolean; killSwitchEngaged?: true }> = {},
): Readonly<VolumeStrategySlice> {
  return new VolumeStrategySlice(controls);
}

function parseTerms(value: unknown): Readonly<VolumeValidateOnlyExecutionTerms> | null {
  const terms = snapshot<Record<string, unknown>>(value);
  if (terms === null || !exactKeys(terms, TERMS_KEYS)) return null;
  if (!validIdentifier(terms.termsId)
      || typeof terms.symbol !== 'string'
      || !/^[A-Z0-9]{1,20}$/.test(terms.symbol)
      || supportedQuoteAsset(terms.symbol) !== 'USDT'
      || (terms.direction !== 'long' && terms.direction !== 'short')
      || (terms.entrySide !== 'BUY' && terms.entrySide !== 'SELL')
      || (terms.capacitySide !== 'BUY' && terms.capacitySide !== 'SELL')
      || (terms.capacityBasis !== 'BEST_LEVEL_ONLY'
        && terms.capacityBasis !== 'SYNCHRONIZED_CUMULATIVE')
      || !validPositiveExactDecimal(terms.price)
      || !validPositiveExactDecimal(terms.baseQuantity)
      || terms.quoteAsset !== 'USDT'
      || !validPositiveExactDecimal(terms.quoteNotional)
      || !Number.isSafeInteger(terms.levelCount)
      || (terms.levelCount as number) < 1
      || (terms.capacityBasis === 'BEST_LEVEL_ONLY' && terms.levelCount !== 1)
      || terms.economicsValuationAsset !== 'USDT'
      || terms.economicsValuationAsset !== terms.quoteAsset
      || !validPositiveExactDecimal(terms.liquidityCapacity)
      || (terms.capacityBasis === 'BEST_LEVEL_ONLY' && !exactProductMatches(
        terms.price as string,
        terms.baseQuantity as string,
        terms.quoteNotional as string,
      ))
      || (terms.capacityBasis === 'SYNCHRONIZED_CUMULATIVE'
        && !exactCumulativeCapacityIsConservative(
          terms.price as string,
          terms.baseQuantity as string,
          terms.quoteNotional as string,
          terms.capacitySide as 'BUY' | 'SELL',
        ))
      || !validObservationDigest(terms.observationDigest)
      || !validEconomicsDigest(terms.economicsDigest)) return null;
  try {
    const quoteNotional = normalizeNonNegativeExactDecimal(terms.quoteNotional as string);
    const liquidityCapacity = normalizeNonNegativeExactDecimal(
      terms.liquidityCapacity as string,
    );
    if (compareExactDecimals(quoteNotional, liquidityCapacity) > 0) return null;
  } catch {
    return null;
  }
  const { termsId, ...semantic } = terms;
  if (termsId !== contentId('vterms', 'volume.strategy.terms.v1', termsSemantic(
    semantic as unknown as Omit<VolumeValidateOnlyExecutionTerms, 'termsId'>,
  ))) return null;
  return terms as unknown as Readonly<VolumeValidateOnlyExecutionTerms>;
}

function parseCodes(value: unknown): readonly VolumeStrategyRejectionCode[] | null {
  if (!Array.isArray(value)
      || value.length > MAX_REASON_CODES
      || value.some((code) => !isKnownRejectionCode(code))) return null;
  const codes = value as string[];
  const sorted = sortedUnique(codes);
  return sorted.length === codes.length
      && sorted.every((code, index) => code === codes[index])
    ? codes as VolumeStrategyRejectionCode[]
    : null;
}

function parsePlan(value: unknown, verifyIdentity: boolean): Readonly<VolumeValidateOnlyPlan> | null {
  const plan = snapshot<Record<string, unknown>>(value);
  if (plan === null || !exactKeys(plan, PLAN_KEYS)) return null;
  const proposal = proposalBinding(plan.proposal);
  const codes = parseCodes(plan.rejectionCodes);
  const terms = plan.executionTerms === null ? null : parseTerms(plan.executionTerms);
  if (proposal === null
      || codes === null
      || !validIdentifier(plan.planId)
      || !validIdentifier(plan.evaluationId)
      || plan.schemaVersion !== VOLUME_STRATEGY_SLICE_SCHEMA_VERSION
      || plan.mode !== VOLUME_STRATEGY_SLICE_MODE
      || (plan.validation !== 'REJECTED' && plan.validation !== 'VALIDATED_RECORD_ONLY')
      || !validObservationDigest(plan.observationDigest)
      || !validEconomicsDigest(plan.economicsDigest)
      || (plan.executionTerms !== null && terms === null)
      || plan.killSwitchEngaged !== true
      || plan.executionAuthority !== 'NONE'
      || plan.submitAuthority !== 'NONE'
      || plan.riskAuthority !== 'NONE'
      || plan.externalAuthority !== 'NONE'
      || plan.sendEligible !== false
      || plan.sends !== 0
      || plan.sideEffects !== 0
      || plan.submitPortPresent !== false
      || plan.publicOnly !== true
      || plan.privateCalls !== false
      || plan.signedCalls !== false
      || plan.providerCalls !== false) return null;
  if ((plan.validation === 'REJECTED' && (codes.length === 0 || terms !== null))
      || (plan.validation === 'VALIDATED_RECORD_ONLY' && (codes.length !== 0 || terms === null))) return null;
  if (terms !== null
      && (terms.symbol !== proposal.symbol
        || terms.direction !== proposal.direction
        || terms.entrySide !== (proposal.direction === 'long' ? 'BUY' : 'SELL')
        || terms.capacitySide !== terms.entrySide
        || terms.observationDigest !== plan.observationDigest
        || terms.economicsDigest !== plan.economicsDigest)) return null;
  if (verifyIdentity) {
    const { planId, ...semantic } = plan;
    if (planId !== contentId(
      'vplan',
      'volume.strategy.plan.v1',
      planSemantic(semantic as unknown as Omit<VolumeValidateOnlyPlan, 'planId'>),
    )) return null;
  }
  return plan as unknown as Readonly<VolumeValidateOnlyPlan>;
}

export function validateVolumeValidateOnlyPlan(value: unknown): value is Readonly<VolumeValidateOnlyPlan> {
  return parsePlan(value, true) !== null;
}

function parseEvaluation(
  value: unknown,
  verifyIdentity: boolean,
): Readonly<VolumeStrategyEvaluation> | null {
  const evaluation = snapshot<Record<string, unknown>>(value);
  if (evaluation === null || !exactKeys(evaluation, EVALUATION_KEYS)) return null;
  const controls = record(evaluation.controls);
  const proposal = proposalBinding(evaluation.proposal);
  const codes = parseCodes(evaluation.rejectionCodes);
  const plan = parsePlan(evaluation.plan, verifyIdentity);
  if (controls === null
      || !exactKeys(controls, CONTROL_KEYS)
      || typeof controls.enabled !== 'boolean'
      || controls.killSwitchEngaged !== true
      || proposal === null
      || codes === null
      || plan === null
      || evaluation.schemaVersion !== VOLUME_STRATEGY_SLICE_SCHEMA_VERSION
      || !validIdentifier(evaluation.evaluationId)
      || !validUtcMs(evaluation.evaluatedAtMs)
      || (evaluation.disposition !== 'REJECTED'
        && evaluation.disposition !== 'VALIDATED_RECORD_ONLY')
      || (evaluation.economicsApplicability !== 'UNKNOWN'
        && evaluation.economicsApplicability !== 'SYNTHETIC_TEST_ONLY')
      || !validObservationDigest(evaluation.observationDigest)
      || !validEconomicsDigest(evaluation.economicsDigest)) return null;
  if ((controls.enabled === false) !== codes.includes('STRATEGY_DISABLED')
      || (evaluation.evaluatedAtMs as number) >= proposal.expiresAtMs
      || (evaluation.disposition === 'VALIDATED_RECORD_ONLY'
        && (controls.enabled !== true
          || evaluation.economicsApplicability !== 'SYNTHETIC_TEST_ONLY'
          || codes.length !== 0))
      || (evaluation.disposition === 'REJECTED' && codes.length === 0)) return null;
  if (evaluation.disposition !== plan.validation
      || evaluation.evaluationId !== plan.evaluationId
      || evaluation.observationDigest !== plan.observationDigest
      || evaluation.economicsDigest !== plan.economicsDigest
      || canonicalJson(proposal) !== canonicalJson(plan.proposal)
      || canonicalJson(codes) !== canonicalJson(plan.rejectionCodes)) return null;
  if (verifyIdentity) {
    const {
      evaluationId,
      plan: _plan,
      ...semantic
    } = evaluation;
    if (evaluationId !== contentId(
      'vevaluation',
      'volume.strategy.evaluation.v1',
      evaluationSemantic(
        semantic as unknown as Omit<VolumeStrategyEvaluation, 'evaluationId' | 'plan'>,
        plan.executionTerms,
      ),
    )) return null;
  }
  return evaluation as unknown as Readonly<VolumeStrategyEvaluation>;
}

export function validateVolumeStrategyEvaluation(
  value: unknown,
): value is Readonly<VolumeStrategyEvaluation> {
  return parseEvaluation(value, true) !== null;
}

export function replayVolumeStrategyEvaluation(value: unknown): VolumeStrategyReplayResult {
  const structural = parseEvaluation(value, false);
  if (structural === null) {
    return Object.freeze({
      status: 'INVALID',
      evaluation: null,
      reasonCodes: Object.freeze(['VOLUME_STRATEGY_EVALUATION_INVALID']),
    });
  }
  const exact = parseEvaluation(structural, true);
  if (exact === null) {
    return Object.freeze({
      status: 'DIVERGED',
      evaluation: null,
      reasonCodes: Object.freeze(['VOLUME_STRATEGY_EVALUATION_DIGEST_DIVERGED']),
    });
  }
  return Object.freeze({
    status: 'EXACT',
    evaluation: exact,
    reasonCodes: Object.freeze([]) as readonly [],
  });
}

function reconciliationSemantic(
  value: Omit<VolumeStrategyLocalReconciliation, 'reconciliationId'>,
): unknown {
  return value;
}

export function reconcileVolumeStrategyLocal(
  expectedValue: unknown,
  persistedValue: unknown,
): Readonly<VolumeStrategyLocalReconciliation> {
  const expected = expectedValue === null || expectedValue === undefined
    ? null
    : replayVolumeStrategyEvaluation(expectedValue);
  const persisted = persistedValue === null || persistedValue === undefined
    ? null
    : replayVolumeStrategyEvaluation(persistedValue);

  let status: VolumeStrategyLocalReconciliationStatus;
  let reasons: readonly string[];
  if (expected === null || persisted === null) {
    status = 'UNAVAILABLE';
    reasons = Object.freeze([
      expected === null ? 'EXPECTED_EVALUATION_UNAVAILABLE' : 'PERSISTED_EVALUATION_UNAVAILABLE',
    ]);
  } else if (expected.status === 'INVALID' || persisted.status === 'INVALID') {
    status = 'AMBIGUOUS';
    reasons = sortedUnique([
      ...(expected.status === 'INVALID' ? expected.reasonCodes : []),
      ...(persisted.status === 'INVALID' ? persisted.reasonCodes : []),
    ]);
  } else if (expected.status === 'DIVERGED' || persisted.status === 'DIVERGED') {
    status = 'AMBIGUOUS';
    reasons = sortedUnique([
      ...(expected.status === 'DIVERGED' ? expected.reasonCodes : []),
      ...(persisted.status === 'DIVERGED' ? persisted.reasonCodes : []),
      'VOLUME_STRATEGY_REPLAY_DIVERGED_AMBIGUOUS',
    ]);
  } else {
    const expectedEvaluation = expected.evaluation;
    const persistedEvaluation = persisted.evaluation;
    if (expectedEvaluation === null || persistedEvaluation === null) {
      status = 'AMBIGUOUS';
      reasons = Object.freeze(['VOLUME_STRATEGY_REPLAY_STATE_AMBIGUOUS']);
    } else if (expectedEvaluation.evaluationId === persistedEvaluation.evaluationId
        && expectedEvaluation.plan.planId === persistedEvaluation.plan.planId) {
      status = 'EXACT';
      reasons = Object.freeze([]);
    } else if (expectedEvaluation.proposal.proposalId === persistedEvaluation.proposal.proposalId
        && (persistedEvaluation.proposal.proposalRevision < expectedEvaluation.proposal.proposalRevision
          || (persistedEvaluation.proposal.proposalRevision
              === expectedEvaluation.proposal.proposalRevision
            && persistedEvaluation.evaluatedAtMs < expectedEvaluation.evaluatedAtMs))) {
      status = 'STALE';
      reasons = Object.freeze(['PERSISTED_EVALUATION_STALE']);
    } else {
      status = 'DIVERGED';
      reasons = Object.freeze(['PERSISTED_EVALUATION_DIVERGED']);
    }
  }

  const expectedEvaluation = expected?.status === 'EXACT' ? expected.evaluation : null;
  const persistedEvaluation = persisted?.status === 'EXACT' ? persisted.evaluation : null;
  const withoutId = Object.freeze({
    schemaVersion: VOLUME_STRATEGY_SLICE_SCHEMA_VERSION,
    scope: VOLUME_STRATEGY_SLICE_SCOPE,
    status,
    evaluatedAtMs: expectedEvaluation?.evaluatedAtMs ?? persistedEvaluation?.evaluatedAtMs ?? null,
    expectedEvaluationId: expectedEvaluation?.evaluationId ?? null,
    expectedPlanId: expectedEvaluation?.plan.planId ?? null,
    persistedEvaluationId: persistedEvaluation?.evaluationId ?? null,
    persistedPlanId: persistedEvaluation?.plan.planId ?? null,
    reasonCodes: reasons,
    executionAuthority: 'NONE' as const,
    exchangeReconciliation: false as const,
    flatnessProven: false as const,
  });
  return Object.freeze({
    reconciliationId: contentId(
      'vreconciliation',
      'volume.strategy.local-reconciliation.v1',
      reconciliationSemantic(withoutId),
    ),
    ...withoutId,
  });
}

export function validateVolumeStrategyLocalReconciliation(
  value: unknown,
): value is Readonly<VolumeStrategyLocalReconciliation> {
  const reconciliation = snapshot<Record<string, unknown>>(value);
  if (reconciliation === null || !exactKeys(reconciliation, RECONCILIATION_KEYS)) return false;
  const codes = readCodes(reconciliation);
  if (reconciliation.schemaVersion !== VOLUME_STRATEGY_SLICE_SCHEMA_VERSION
      || !validIdentifier(reconciliation.reconciliationId)
      || reconciliation.scope !== VOLUME_STRATEGY_SLICE_SCOPE
      || !['EXACT', 'STALE', 'UNAVAILABLE', 'AMBIGUOUS', 'DIVERGED'].includes(
        reconciliation.status as string,
      )
      || (reconciliation.evaluatedAtMs !== null && !validUtcMs(reconciliation.evaluatedAtMs))
      || (reconciliation.expectedEvaluationId !== null
        && !validIdentifier(reconciliation.expectedEvaluationId))
      || (reconciliation.expectedPlanId !== null
        && !validIdentifier(reconciliation.expectedPlanId))
      || (reconciliation.persistedEvaluationId !== null
        && !validIdentifier(reconciliation.persistedEvaluationId))
      || (reconciliation.persistedPlanId !== null
        && !validIdentifier(reconciliation.persistedPlanId))
      || !Array.isArray(reconciliation.reasonCodes)
      || canonicalJson(codes) !== canonicalJson(reconciliation.reasonCodes)
      || reconciliation.executionAuthority !== 'NONE'
      || reconciliation.exchangeReconciliation !== false
      || reconciliation.flatnessProven !== false) return false;
  const status = reconciliation.status as VolumeStrategyLocalReconciliationStatus;
  const expectedPairPresent = reconciliation.expectedEvaluationId !== null
    && reconciliation.expectedPlanId !== null;
  const expectedPairAbsent = reconciliation.expectedEvaluationId === null
    && reconciliation.expectedPlanId === null;
  const persistedPairPresent = reconciliation.persistedEvaluationId !== null
    && reconciliation.persistedPlanId !== null;
  const persistedPairAbsent = reconciliation.persistedEvaluationId === null
    && reconciliation.persistedPlanId === null;
  if ((!expectedPairPresent && !expectedPairAbsent)
      || (!persistedPairPresent && !persistedPairAbsent)) return false;
  if (status === 'EXACT') {
    if (!expectedPairPresent
        || !persistedPairPresent
        || reconciliation.evaluatedAtMs === null
        || reconciliation.expectedEvaluationId !== reconciliation.persistedEvaluationId
        || reconciliation.expectedPlanId !== reconciliation.persistedPlanId
        || codes.length !== 0) return false;
  } else if (status === 'STALE') {
    if (!expectedPairPresent
        || !persistedPairPresent
        || reconciliation.evaluatedAtMs === null
        || reconciliation.expectedEvaluationId === reconciliation.persistedEvaluationId
        || reconciliation.expectedPlanId === reconciliation.persistedPlanId
        || codes.length !== 1
        || codes[0] !== 'PERSISTED_EVALUATION_STALE') return false;
  } else if (status === 'DIVERGED') {
    if (!expectedPairPresent
        || !persistedPairPresent
        || reconciliation.evaluatedAtMs === null
        || (reconciliation.expectedEvaluationId === reconciliation.persistedEvaluationId
          && reconciliation.expectedPlanId === reconciliation.persistedPlanId)
        || codes.length !== 1
        || codes[0] !== 'PERSISTED_EVALUATION_DIVERGED') return false;
  } else if (status === 'UNAVAILABLE') {
    if ((!expectedPairAbsent && !persistedPairAbsent)
        || codes.length !== 1
        || (expectedPairAbsent && codes[0] !== 'EXPECTED_EVALUATION_UNAVAILABLE')
        || (expectedPairPresent
          && persistedPairAbsent
          && codes[0] !== 'PERSISTED_EVALUATION_UNAVAILABLE')) return false;
    if ((expectedPairPresent || persistedPairPresent)
        && reconciliation.evaluatedAtMs === null) return false;
    if (expectedPairAbsent
        && persistedPairAbsent
        && reconciliation.evaluatedAtMs !== null) return false;
  } else if (codes.length === 0) {
    return false;
  }
  const {
    reconciliationId,
    ...semantic
  } = reconciliation;
  return reconciliationId === contentId(
    'vreconciliation',
    'volume.strategy.local-reconciliation.v1',
    reconciliationSemantic(
      semantic as unknown as Omit<VolumeStrategyLocalReconciliation, 'reconciliationId'>,
    ),
  );
}
