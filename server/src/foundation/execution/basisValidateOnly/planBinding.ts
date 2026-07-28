/**
 * M1-I1 accepted Basis handoff -> immutable Foundation plan provenance.
 *
 * This module is deliberately a pure data boundary. It consumes an already
 * frozen P1 handoff, canonical Capital consideration + mandate truth, and the
 * real P2 plan/risk input. It never constructs a coordinator,
 * accepts a transport, reads a clock, persists, signs, queries, or sends.
 *
 * The outer execution mode is always VALIDATE_ONLY. Capital's canonical
 * allocator/staging dialect is deliberately different: the sealed synthetic
 * harness must use MANUAL_ARMED to obtain a genuine mandate, but that local
 * label is never exposed as execution authority. approvalId/riskDecision must
 * remain null: this is provenance, not permission to act.
 */
import { types as nodeTypes } from 'node:util';

import type { BasisHandoffRecord } from '../../../engine/basis/lifecycle.js';
import {
  EMPTY_RESERVATION_BOOK,
  allocateCapital,
  deriveAllocationSizingAuthorityRevision,
  reduceReservationBook,
  type AllocationAuthorityReceipt,
  type AllocationBatchInput,
  type AllocationCandidate,
} from '../../../capitalFoundation/allocation/index.js';
import {
  addExactDecimals,
  capitalDigest,
  compareExactDecimals,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
  truthAllowsNewExposure,
  type CapitalMandate,
  type CapitalReservation,
  type CapitalStage,
  type ExactDecimal,
  type NonNegativeDecimal,
  type OpportunityConsideration,
  type TruthMetadata,
} from '../../../capitalFoundation/contracts/index.js';
import {
  evaluateOpportunityEligibility,
  type OpportunityEligibilityCandidate,
  type OpportunityEligibilityPolicy,
} from '../../../capitalFoundation/opportunities/index.js';
import type {
  KeyedExactAmount,
  PortfolioBudgetSnapshot,
} from '../../../capitalFoundation/budgets/index.js';
import {
  buildCapitalMandate,
  buildStagedPlan,
  type GovernedStagedPlan,
  type GovernedStagedExposureStep,
  type StagedPlanConfiguration,
} from '../../../capitalFoundation/stages/index.js';
import {
  canonicalJson,
  DATA_AUTHORITIES,
  evaluateFreshness,
  stableHash128Hex,
  validateSourcedTimestamp,
} from '../../contracts/index.js';
import {
  createExecutionPlanDefinition,
  validateNormalBasisPlanBinding,
} from '../plan.js';
import {
  NORMAL_BASIS_STEP_ORDER,
  type CreateExecutionPlanInput,
  type ExecutionPlanDefinition,
} from '../types.js';

export const BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA =
  'cosmos.foundation.execution.basisValidateOnlyPlanBinding' as const;
export const BASIS_VALIDATE_ONLY_PLAN_BINDING_VERSION = 1 as const;

export interface BasisValidateOnlyControls {
  /** Explicit opt-in for deterministic validation only. Omitted means OFF. */
  readonly enabled?: boolean;
  /** Omitted means engaged. An engaged kill switch dominates all other input. */
  readonly killSwitchEngaged?: boolean;
}

export const DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS: Readonly<Required<BasisValidateOnlyControls>> =
  Object.freeze({
    enabled: false,
    killSwitchEngaged: true,
  });

/**
 * Nominal output of createBasisValidateOnlyCapitalProof. The proof retains the
 * complete owner graph needed to re-run canonical Capital eligibility and
 * mandate construction at bind time. A digest alone is only content integrity,
 * never producer provenance.
 */
export interface BasisValidateOnlyCapitalProof {
  readonly eligibilityCandidate: Readonly<OpportunityEligibilityCandidate>;
  readonly eligibilityPolicy: Readonly<OpportunityEligibilityPolicy>;
  readonly consideration: Readonly<OpportunityConsideration>;
  readonly considerationDigest: string;
  readonly eligibilityPolicyRevision: string;
  readonly allocationInput: Readonly<AllocationBatchInput>;
  readonly allocationDecision: Readonly<CapitalReservationOwnerDecision>;
  readonly allocationAuthority: Readonly<AllocationAuthorityReceipt>;
  readonly reservationCommandId: string;
  readonly capitalClaimKey: string;
  readonly reservation: Readonly<CapitalReservation>;
  readonly stagedPlan: Readonly<GovernedStagedPlan>;
  readonly stagedPlanConfiguration: Readonly<StagedPlanConfiguration>;
  readonly stagedPlanBuildCorrelationId: string;
  readonly mandateBuildCorrelationId: string;
  readonly mandate: Readonly<CapitalMandate>;
  readonly spotPriceExact: string;
  readonly spotQuantityExact: string;
  readonly perpPriceExact: string;
  readonly perpQuantityExact: string;
}

export interface CreateBasisValidateOnlyCapitalProofInput {
  readonly eligibilityCandidate: Readonly<OpportunityEligibilityCandidate>;
  readonly eligibilityPolicy: Readonly<OpportunityEligibilityPolicy>;
  readonly evaluatedAtMs: number;
  readonly allocationPolicy: Readonly<AllocationBatchInput['policy']>;
  readonly allocationSnapshot: Readonly<PortfolioBudgetSnapshot>;
  readonly allocationTerms: Readonly<BasisValidateOnlyAllocationTerms>;
  readonly reservationCommandId: string;
  readonly capitalClaimKey: string;
  readonly stagedPlanConfiguration: Readonly<StagedPlanConfiguration>;
  readonly stagedPlanStages: readonly Readonly<GovernedStagedExposureStep>[];
  readonly stagedPlanActiveStage: CapitalStage;
  readonly stagedPlanExpiresAtMs: number;
  readonly stagedPlanBuildCorrelationId: string;
  readonly mandateExpiresAtMs: number;
  readonly mandateBuildCorrelationId: string;
  readonly spotPriceExact: string;
  readonly spotQuantityExact: string;
  readonly perpPriceExact: string;
  readonly perpQuantityExact: string;
}

type CapitalReservationOwnerDecision = ReturnType<typeof allocateCapital>['decisions'][number];

/**
 * Exact allocation geometry supplied to Capital. Canonical eligibility fields
 * are deliberately absent: the proof constructor fills them only from the
 * evaluator output it just produced.
 */
export interface BasisValidateOnlyAllocationTerms {
  readonly sizingAuthoritySourceId: string;
  readonly grossExposureIncrease: NonNegativeDecimal;
  readonly netDirectionalExposureDelta: ExactDecimal;
  readonly collateralRequired: NonNegativeDecimal;
  readonly marginRequired: NonNegativeDecimal;
  readonly strategyRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly symbolRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly correlatedGroupRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly venueInstrumentRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly borrowRequired: boolean | null;
  readonly borrowRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly liquidityRequirements: readonly Readonly<KeyedExactAmount>[];
}

export type BasisValidateOnlyCapitalProofResult =
  | {
      readonly ok: true;
      readonly proof: Readonly<BasisValidateOnlyCapitalProof>;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'INPUT_NOT_PLAIN_DATA'
        | 'CAPITAL_PROOF_INVALID'
        | 'AUTHORITY_INVALID';
    };

export interface BasisValidateOnlyPlanInput {
  readonly handoff: Readonly<BasisHandoffRecord>;
  readonly capital: Readonly<BasisValidateOnlyCapitalProof> | null;
  readonly planInput: Readonly<CreateExecutionPlanInput>;
  /** Injected current time. No wall clock is read. */
  readonly nowMs: number;
}

export interface BasisValidateOnlyNonFireablePosture {
  readonly externalMode: 'VALIDATE_ONLY';
  readonly strategyAuthority: 'NONE';
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly executionAuthority: 'NONE';
  readonly actionAuthority: 'NONE';
  readonly sendEligible: false;
  readonly killSwitchDominant: true;
  readonly syntheticValidationOnly: true;
}

export const BASIS_VALIDATE_ONLY_NON_FIREABLE_POSTURE: Readonly<BasisValidateOnlyNonFireablePosture> =
  Object.freeze({
    externalMode: 'VALIDATE_ONLY',
    strategyAuthority: 'NONE',
    capitalAuthority: 'NONE',
    riskAuthority: 'NONE',
    executionAuthority: 'NONE',
    actionAuthority: 'NONE',
    sendEligible: false,
    killSwitchDominant: true,
    syntheticValidationOnly: true,
  });

export interface BasisValidateOnlyPlanBinding extends BasisValidateOnlyNonFireablePosture {
  readonly schema: typeof BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA;
  readonly version: typeof BASIS_VALIDATE_ONLY_PLAN_BINDING_VERSION;
  readonly bindingId: string;
  readonly handoffId: string;
  readonly sourceProposalId: string;
  readonly canonicalProposalId: string;
  readonly handoffCorrelationId: string;
  readonly planCorrelationId: string;
  readonly acceptedRevisionTs: number;
  readonly acceptedNotionalUsdExact: NonNegativeDecimal;
  readonly considerationId: string;
  readonly considerationDigest: string;
  readonly mandateId: string;
  readonly mandateDigest: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly direction: 'LONG_SPOT_SHORT_PERP';
  readonly proposalExpiresAtMs: number;
  readonly spotPriceExact: NonNegativeDecimal;
  readonly spotQuantityExact: NonNegativeDecimal;
  readonly spotNotionalUsdExact: NonNegativeDecimal;
  readonly perpPriceExact: NonNegativeDecimal;
  readonly perpQuantityExact: NonNegativeDecimal;
  readonly perpNotionalUsdExact: NonNegativeDecimal;
  readonly validatedControls: Readonly<{
    readonly enabled: true;
    readonly killSwitchEngaged: false;
  }>;
  readonly plan: Readonly<ExecutionPlanDefinition>;
}

export const BASIS_VALIDATE_ONLY_REFUSAL_CODES = Object.freeze([
  'DISABLED',
  'KILL_SWITCH_ENGAGED',
  'CONTROL_INVALID',
  'INPUT_NOT_PLAIN_DATA',
  'HANDOFF_NOT_FROZEN',
  'HANDOFF_INVALID',
  'HANDOFF_NOT_READY',
  'CAPITAL_PROOF_REQUIRED',
  'CAPITAL_PROOF_NOT_FROZEN',
  'CAPITAL_PROOF_INVALID',
  'AUTHORITY_INVALID',
  'PROVENANCE_MISMATCH',
  'STALE_OR_EXPIRED',
  'EXACT_DECIMAL_REQUIRED',
  'PLAN_INVALID',
] as const);
export type BasisValidateOnlyRefusalCode =
  (typeof BASIS_VALIDATE_ONLY_REFUSAL_CODES)[number];

export type BasisValidateOnlyPlanResult =
  | ({
      readonly ok: true;
      readonly binding: Readonly<BasisValidateOnlyPlanBinding>;
    } & BasisValidateOnlyNonFireablePosture)
  | ({
      readonly ok: false;
      readonly code: BasisValidateOnlyRefusalCode;
    } & BasisValidateOnlyNonFireablePosture);

const HANDOFF_KEYS = Object.freeze([
  'handoffId',
  'proposalId',
  'correlationId',
  'symbol',
  'direction',
  'acceptedBy',
  'acceptedTs',
  'acceptedRevisionTs',
  'acceptedNetEdgePct',
  'acceptedNotionalUsd',
  'boundTs',
  'state',
  'terminalKind',
  'terminalTs',
  'cumulativeFilledQuantity',
  'lastSequence',
  'lastObservedAtMs',
  'ambiguousObservations',
] as const);

const CAPITAL_PROOF_KEYS = Object.freeze([
  'eligibilityCandidate',
  'eligibilityPolicy',
  'consideration',
  'considerationDigest',
  'eligibilityPolicyRevision',
  'allocationInput',
  'allocationDecision',
  'allocationAuthority',
  'reservationCommandId',
  'capitalClaimKey',
  'reservation',
  'stagedPlan',
  'stagedPlanConfiguration',
  'stagedPlanBuildCorrelationId',
  'mandateBuildCorrelationId',
  'mandate',
  'spotPriceExact',
  'spotQuantityExact',
  'perpPriceExact',
  'perpQuantityExact',
] as const);

const CAPITAL_PROOF_INPUT_KEYS = Object.freeze([
  'eligibilityCandidate',
  'eligibilityPolicy',
  'evaluatedAtMs',
  'allocationPolicy',
  'allocationSnapshot',
  'allocationTerms',
  'reservationCommandId',
  'capitalClaimKey',
  'stagedPlanConfiguration',
  'stagedPlanStages',
  'stagedPlanActiveStage',
  'stagedPlanExpiresAtMs',
  'stagedPlanBuildCorrelationId',
  'mandateExpiresAtMs',
  'mandateBuildCorrelationId',
  'spotPriceExact',
  'spotQuantityExact',
  'perpPriceExact',
  'perpQuantityExact',
] as const);

const ALLOCATION_TERMS_KEYS = Object.freeze([
  'sizingAuthoritySourceId',
  'grossExposureIncrease',
  'netDirectionalExposureDelta',
  'collateralRequired',
  'marginRequired',
  'strategyRequirements',
  'symbolRequirements',
  'correlatedGroupRequirements',
  'venueInstrumentRequirements',
  'borrowRequired',
  'borrowRequirements',
  'liquidityRequirements',
] as const);

const CONSIDERATION_KEYS = Object.freeze([
  'id',
  'proposal',
  'mode',
  'status',
  'reasons',
  'legs',
  'economics',
  'evidencePacketIds',
  'evidenceTruth',
  'truth',
  'conflictingConsiderationIds',
  'evaluatedAtMs',
] as const);

const CONSIDERATION_PROPOSAL_KEYS = Object.freeze([
  'sourceProposalId',
  'canonicalProposalId',
  'sourceCorrelationId',
  'strategy',
  'symbol',
  'direction',
  'sourceLifecycle',
  'sourceRevision',
  'sourceConfigRevision',
  'createdAtMs',
  'updatedAtMs',
  'expiresAtMs',
  'intakeDigest',
] as const);

const CONSIDERATION_ECONOMICS_KEYS = Object.freeze([
  'valuationAsset',
  'requestedCapital',
  'expectedGrossEdge',
  'expectedNetEdge',
  'estimatedFees',
  'estimatedFunding',
  'estimatedBorrowCost',
  'estimatedSpreadCost',
  'estimatedSlippage',
  'estimatedLatencyCost',
  'estimatedAdverseSelectionCost',
  'estimatedRecoveryCost',
  'estimatedCapitalOpportunityCost',
  'liquidityCapacity',
  'expectedBorrowScope',
  'fundingFact',
  'borrowFact',
  'capitalOpportunityFact',
  'exactSourceIds',
  'missingFields',
] as const);

const CONSIDERATION_LEG_KEYS = Object.freeze([
  'role',
  'instrumentId',
  'symbol',
  'side',
  'borrowRequired',
] as const);

const CAPITAL_MANDATE_KEYS = Object.freeze([
  'id',
  'revision',
  'digest',
  'considerationId',
  'allocationDecisionId',
  'reservationId',
  'stagedPlanId',
  'stagedPlanRevision',
  'stagedPlanDigest',
  'proposalIntakeDigest',
  'configRevision',
  'approvalId',
  'riskDecision',
  'targetMaximumExposure',
  'valuationAsset',
  'createdAtMs',
  'expiresAtMs',
] as const);

const PLAN_INPUT_KEYS = Object.freeze([
  'strategy',
  'direction',
  'symbol',
  'proposal',
  'attempt',
  'mode',
  'requiresApproval',
  'maxNakedDurationMs',
  'spotQuantity',
  'perpQuantity',
  'openingOrder',
  'normalBasis',
] as const);

const PROPOSAL_KEYS = Object.freeze([
  'canonicalProposalId',
  'observedAtMs',
  'maxAgeMs',
  'expiresAtMs',
] as const);

const NORMAL_BASIS_REQUEST_KEYS = Object.freeze(['version', 'evaluationInput'] as const);
const INPUT_KEYS = Object.freeze(['handoff', 'capital', 'planInput', 'nowMs'] as const);
const CONTROL_KEYS = new Set<string>(['enabled', 'killSwitchEngaged']);
const producedBindings = new WeakSet<object>();
const producedCapitalProofs = new WeakSet<object>();

class PlainDataError extends TypeError {}

const MAX_SNAPSHOT_ARRAY_LENGTH = 512;
const MAX_SNAPSHOT_OBJECT_KEYS = 128;
const MAX_SNAPSHOT_STRING_LENGTH = 262_144;
const MAX_SNAPSHOT_TOTAL_NODES = 4_096;
const MAX_SNAPSHOT_TOTAL_BYTES = 524_288;
const MAX_SNAPSHOT_DEPTH = 32;

interface SnapshotBudget {
  nodes: number;
  bytes: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copy data exclusively through property descriptors. Accessor properties are
 * rejected and never invoked. Node's nominal Proxy detector runs before any
 * prototype/own-key inspection, so hostile Proxy traps are likewise untouched.
 */
function snapshotPlainData(
  value: unknown,
  active: WeakSet<object> = new WeakSet<object>(),
  completed: WeakMap<object, unknown> = new WeakMap<object, unknown>(),
  budget: SnapshotBudget = { nodes: 0, bytes: 0 },
  depth = 0,
): unknown {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    throw new PlainDataError('input exceeds bounded snapshot depth');
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_TOTAL_NODES) {
    throw new PlainDataError('input exceeds bounded snapshot node capacity');
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    budget.bytes += value === null || typeof value === 'boolean' ? 1 : 8;
    if (budget.bytes > MAX_SNAPSHOT_TOTAL_BYTES) {
      throw new PlainDataError('input exceeds bounded snapshot byte capacity');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_SNAPSHOT_STRING_LENGTH) {
      throw new PlainDataError('string input exceeds bounded snapshot capacity');
    }
    budget.bytes += value.length * 2;
    if (budget.bytes > MAX_SNAPSHOT_TOTAL_BYTES) {
      throw new PlainDataError('input exceeds bounded snapshot byte capacity');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new PlainDataError('input must contain plain JSON-compatible data');
  }
  if (nodeTypes.isProxy(value)) {
    throw new PlainDataError('Proxy input is forbidden');
  }
  const cached = completed.get(value);
  if (cached !== undefined) return cached;
  if (active.has(value)) throw new PlainDataError('cyclic input is forbidden');
  active.add(value);

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new PlainDataError('input prototype cannot be inspected');
  }

  let copy: unknown;
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new PlainDataError('array subclass input is forbidden');
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    } catch {
      throw new PlainDataError('array length cannot be inspected');
    }
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_SNAPSHOT_ARRAY_LENGTH
    ) {
      throw new PlainDataError('invalid array length');
    }
    let keys: readonly (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw new PlainDataError('array keys cannot be inspected');
    }
    if (
      keys.length > MAX_SNAPSHOT_ARRAY_LENGTH + 1 ||
      keys.length !== lengthDescriptor.value + 1
    ) {
      throw new PlainDataError('array breadth is invalid');
    }
    for (const key of keys) {
      if (typeof key === 'symbol') throw new PlainDataError('symbol properties are forbidden');
      budget.bytes += key.length * 2;
      if (budget.bytes > MAX_SNAPSHOT_TOTAL_BYTES) {
        throw new PlainDataError('input exceeds bounded snapshot byte capacity');
      }
      if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)) {
        throw new PlainDataError('non-index array properties are forbidden');
      }
    }
    const output: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      } catch {
        throw new PlainDataError('array element cannot be inspected');
      }
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        throw new PlainDataError('sparse arrays are forbidden');
      }
      output.push(
        snapshotPlainData(
          descriptor.value,
          active,
          completed,
          budget,
          depth + 1,
        ),
      );
    }
    copy = Object.freeze(output);
  } else {
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PlainDataError('class instances are forbidden');
    }
    let keys: readonly (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw new PlainDataError('object keys cannot be inspected');
    }
    if (keys.length > MAX_SNAPSHOT_OBJECT_KEYS) {
      throw new PlainDataError('object input exceeds bounded snapshot capacity');
    }
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key === 'symbol') throw new PlainDataError('symbol properties are forbidden');
      budget.bytes += key.length * 2;
      if (budget.bytes > MAX_SNAPSHOT_TOTAL_BYTES) {
        throw new PlainDataError('input exceeds bounded snapshot byte capacity');
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        throw new PlainDataError('object property cannot be inspected');
      }
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        throw new PlainDataError('hidden data properties are forbidden');
      }
      output[key] = snapshotPlainData(
        descriptor.value,
        active,
        completed,
        budget,
        depth + 1,
      );
    }
    copy = Object.freeze(output);
  }

  active.delete(value);
  completed.set(value, copy);
  return copy;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedId(value: unknown, maxLength = 256): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function symbol(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Z0-9][A-Z0-9_]*$/.test(value)
  );
}

function utcMillis(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function canonicalPositiveDecimal(value: unknown): NonNegativeDecimal | null {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    return normalized === value && normalized !== '0' ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * P2 plan terms are still numbers. Until that frozen contract is migrated to
 * exact decimals, refuse any exact string that cannot make the full
 * exact-string -> number -> canonical-string round trip without changing.
 */
function losslessPlanNumber(exact: NonNegativeDecimal, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  if (Number(exact) !== value) return false;
  try {
    return normalizeNonNegativeExactDecimal(String(value)) === exact;
  } catch {
    return false;
  }
}

function rawDataProperty(container: unknown, key: string): unknown {
  if (
    typeof container !== 'object' ||
    container === null ||
    nodeTypes.isProxy(container) ||
    Array.isArray(container)
  ) {
    throw new PlainDataError('plain object required');
  }
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    throw new PlainDataError('own data property required');
  }
  return descriptor.value;
}

function fail(code: BasisValidateOnlyRefusalCode): BasisValidateOnlyPlanResult {
  return Object.freeze({
    ok: false as const,
    code,
    ...BASIS_VALIDATE_ONLY_NON_FIREABLE_POSTURE,
  });
}

function controlsSnapshot(value: unknown): Readonly<Required<BasisValidateOnlyControls>> | null {
  let copied: unknown;
  try {
    copied = snapshotPlainData(value);
  } catch {
    return null;
  }
  if (!isObject(copied) || Object.keys(copied).some((key) => !CONTROL_KEYS.has(key))) {
    return null;
  }
  const enabled = copied.enabled ?? false;
  const killSwitchEngaged = copied.killSwitchEngaged ?? true;
  if (typeof enabled !== 'boolean' || typeof killSwitchEngaged !== 'boolean') return null;
  return Object.freeze({ enabled, killSwitchEngaged });
}

/**
 * The milestone is a sealed synthetic harness. Inspect only fields whose names
 * carry the repository DataAuthority vocabulary; configuration-authority
 * objects are a different type and are intentionally ignored.
 */
function hasSyntheticOnlyEvidenceAuthority(value: unknown): boolean {
  let observed = 0;
  let invalid = false;
  const visit = (candidate: unknown, propertyName: string | null): void => {
    if (invalid) return;
    if (typeof candidate === 'string') {
      const authorityField =
        propertyName === 'authority' ||
        propertyName === 'effectiveAuthority' ||
        propertyName?.endsWith('EvidenceAuthority') === true;
      if (
        authorityField &&
        (DATA_AUTHORITIES as readonly string[]).includes(candidate)
      ) {
        observed += 1;
        if (candidate !== 'SYNTHETIC_TEST') invalid = true;
      }
      return;
    }
    if (candidate === null || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry, null);
      return;
    }
    for (const [key, entry] of Object.entries(candidate)) visit(entry, key);
  };
  visit(value, null);
  return observed > 0 && !invalid;
}

function canonicalAllocationTermsShape(value: unknown): value is BasisValidateOnlyAllocationTerms {
  return (
    exactKeys(value, ALLOCATION_TERMS_KEYS) &&
    boundedId(value.sizingAuthoritySourceId) &&
    typeof value.grossExposureIncrease === 'string' &&
    typeof value.netDirectionalExposureDelta === 'string' &&
    typeof value.collateralRequired === 'string' &&
    typeof value.marginRequired === 'string' &&
    Array.isArray(value.strategyRequirements) &&
    Array.isArray(value.symbolRequirements) &&
    Array.isArray(value.correlatedGroupRequirements) &&
    Array.isArray(value.venueInstrumentRequirements) &&
    (value.borrowRequired === true ||
      value.borrowRequired === false ||
      value.borrowRequired === null) &&
    Array.isArray(value.borrowRequirements) &&
    Array.isArray(value.liquidityRequirements)
  );
}

/**
 * The only constructor for a bindable Capital proof.
 *
 * It runs the canonical evaluator, allocator, reservation reducer, staged-plan
 * builder, and mandate builder in sequence over one immutable snapshot. The
 * returned WeakSet brand records local producer provenance; public hashes and
 * IDs remain content-integrity checks only.
 */
export function createBasisValidateOnlyCapitalProof(
  input: Readonly<CreateBasisValidateOnlyCapitalProofInput>,
): BasisValidateOnlyCapitalProofResult {
  if (
    typeof input !== 'object' ||
    input === null ||
    nodeTypes.isProxy(input) ||
    !Object.isFrozen(input)
  ) {
    return Object.freeze({ ok: false as const, code: 'INPUT_NOT_PLAIN_DATA' as const });
  }
  let copied: unknown;
  try {
    copied = snapshotPlainData(input);
  } catch {
    return Object.freeze({ ok: false as const, code: 'INPUT_NOT_PLAIN_DATA' as const });
  }
  if (
    !exactKeys(copied, CAPITAL_PROOF_INPUT_KEYS) ||
    !utcMillis(copied.evaluatedAtMs) ||
    !utcMillis(copied.stagedPlanExpiresAtMs) ||
    !utcMillis(copied.mandateExpiresAtMs) ||
    !boundedId(copied.reservationCommandId) ||
    !boundedId(copied.capitalClaimKey) ||
    !boundedId(copied.stagedPlanBuildCorrelationId, 128) ||
    !boundedId(copied.mandateBuildCorrelationId, 128) ||
    !canonicalAllocationTermsShape(copied.allocationTerms) ||
    !isObject(copied.eligibilityCandidate) ||
    !isObject(copied.eligibilityPolicy) ||
    !isObject(copied.allocationPolicy) ||
    !isObject(copied.allocationSnapshot) ||
    !isObject(copied.stagedPlanConfiguration) ||
    !Array.isArray(copied.stagedPlanStages) ||
    typeof copied.spotPriceExact !== 'string' ||
    typeof copied.spotQuantityExact !== 'string' ||
    typeof copied.perpPriceExact !== 'string' ||
    typeof copied.perpQuantityExact !== 'string'
  ) {
    return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
  }
  if (
    copied.eligibilityPolicy.basisMode !== 'MANUAL_ARMED' ||
    !hasSyntheticOnlyEvidenceAuthority(copied)
  ) {
    return Object.freeze({ ok: false as const, code: 'AUTHORITY_INVALID' as const });
  }

  try {
    const evaluatedAtMs = copied.evaluatedAtMs;
    const batch = evaluateOpportunityEligibility(
      [copied.eligibilityCandidate as unknown as Readonly<OpportunityEligibilityCandidate>],
      copied.eligibilityPolicy as unknown as Readonly<OpportunityEligibilityPolicy>,
      evaluatedAtMs,
    );
    if (batch.considerations.length !== 1) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }
    const consideration = batch.considerations[0];
    if (
      consideration.mode !== 'MANUAL_ARMED' ||
      consideration.status !== 'ELIGIBLE' ||
      consideration.proposal.sourceRevision !== null ||
      canonicalJson(consideration.reasons) !==
        canonicalJson(['PROPOSAL_OPEN', 'PROPOSAL_REVISION_UNKNOWN'])
    ) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }
    const requestedAmount = canonicalPositiveDecimal(
      consideration.economics.requestedCapital,
    );
    if (requestedAmount === null) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }

    const terms = copied.allocationTerms;
    const candidateDraft = Object.freeze({
      consideration,
      considerationId: consideration.id,
      considerationDigest: capitalDigest(consideration),
      eligibilityPolicyRevision: batch.policyRevision,
      sizingAuthority: Object.freeze({
        revision: 'pending',
        sourceId: terms.sizingAuthoritySourceId,
      }),
      eligibilityStatus: consideration.status,
      considerationMode: consideration.mode,
      truth: consideration.truth,
      strategy: 'BASIS' as const,
      valuationAsset: consideration.economics.valuationAsset,
      primarySymbol: consideration.proposal.symbol,
      economicDirection: 'HEDGED' as const,
      requestedAmount,
      grossExposureIncrease: terms.grossExposureIncrease,
      netDirectionalExposureDelta: terms.netDirectionalExposureDelta,
      collateralRequired: terms.collateralRequired,
      marginRequired: terms.marginRequired,
      strategyRequirements: terms.strategyRequirements,
      symbolRequirements: terms.symbolRequirements,
      correlatedGroupRequirements: terms.correlatedGroupRequirements,
      venueInstrumentRequirements: terms.venueInstrumentRequirements,
      borrowRequired: terms.borrowRequired,
      borrowRequirements: terms.borrowRequirements,
      liquidityRequirements: terms.liquidityRequirements,
      conflictingConsiderationIds: consideration.conflictingConsiderationIds,
    });
    const allocationCandidate: Readonly<AllocationCandidate> = Object.freeze({
      ...candidateDraft,
      sizingAuthority: Object.freeze({
        sourceId: terms.sizingAuthoritySourceId,
        revision: deriveAllocationSizingAuthorityRevision(
          candidateDraft as unknown as Readonly<AllocationCandidate>,
        ),
      }),
    });
    const allocationInput: Readonly<AllocationBatchInput> = Object.freeze({
      policy: copied.allocationPolicy as unknown as AllocationBatchInput['policy'],
      snapshot: copied.allocationSnapshot as unknown as PortfolioBudgetSnapshot,
      candidates: Object.freeze([allocationCandidate]),
      nowMs: evaluatedAtMs,
    });
    const allocation = allocateCapital(allocationInput);
    const allocationDecision = allocation.decisions[0];
    const allocationAuthority = allocation.authorities[0];
    if (
      allocation.decisions.length !== 1 ||
      allocationDecision === undefined ||
      allocationAuthority === undefined ||
      (allocationDecision.status !== 'GRANTED' &&
        allocationDecision.status !== 'CAPPED') ||
      canonicalPositiveDecimal(allocationDecision.grantedAmount) === null
    ) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }

    const reservationReduction = reduceReservationBook(
      EMPTY_RESERVATION_BOOK,
      Object.freeze({
        kind: 'RESERVE' as const,
        commandId: copied.reservationCommandId,
        nowMs: evaluatedAtMs,
        allocation: allocationDecision,
        authority: allocationAuthority,
        allocationInput,
        capitalClaimKey: copied.capitalClaimKey,
      }),
    );
    const reservation = reservationReduction.book.reservations[0]?.reservation;
    if (
      reservationReduction.mutation.status !== 'APPLIED' ||
      reservationReduction.book.reservations.length !== 1 ||
      reservation === undefined
    ) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }

    const stagedPlanResult = buildStagedPlan({
      reservation,
      proposalIntakeDigest: consideration.proposal.intakeDigest,
      valuationAsset: consideration.economics.valuationAsset,
      configuration:
        copied.stagedPlanConfiguration as unknown as Readonly<StagedPlanConfiguration>,
      stages:
        copied.stagedPlanStages as unknown as readonly Readonly<GovernedStagedExposureStep>[],
      activeStage: copied.stagedPlanActiveStage as CapitalStage,
      createdAtMs: evaluatedAtMs,
      expiresAtMs: copied.stagedPlanExpiresAtMs,
      correlationId: copied.stagedPlanBuildCorrelationId,
    });
    if (!stagedPlanResult.ok) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }
    const stagedPlan = stagedPlanResult.value;
    const mandateResult = buildCapitalMandate({
      consideration,
      allocationDecisionId: allocationDecision.id,
      reservation,
      plan: stagedPlan,
      configuration:
        copied.stagedPlanConfiguration as unknown as Readonly<StagedPlanConfiguration>,
      targetMaximumExposure: allocationDecision.grantedAmount,
      createdAtMs: evaluatedAtMs,
      expiresAtMs: copied.mandateExpiresAtMs,
      correlationId: copied.mandateBuildCorrelationId,
    });
    if (!mandateResult.ok) {
      return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
    }
    const mandate = mandateResult.value;
    const proof: Readonly<BasisValidateOnlyCapitalProof> = Object.freeze({
      eligibilityCandidate:
        copied.eligibilityCandidate as unknown as Readonly<OpportunityEligibilityCandidate>,
      eligibilityPolicy:
        copied.eligibilityPolicy as unknown as Readonly<OpportunityEligibilityPolicy>,
      consideration,
      considerationDigest: capitalDigest(consideration),
      eligibilityPolicyRevision: batch.policyRevision,
      allocationInput,
      allocationDecision,
      allocationAuthority,
      reservationCommandId: copied.reservationCommandId,
      capitalClaimKey: copied.capitalClaimKey,
      reservation,
      stagedPlan,
      stagedPlanConfiguration:
        copied.stagedPlanConfiguration as unknown as Readonly<StagedPlanConfiguration>,
      stagedPlanBuildCorrelationId: copied.stagedPlanBuildCorrelationId,
      mandateBuildCorrelationId: copied.mandateBuildCorrelationId,
      mandate,
      spotPriceExact: copied.spotPriceExact,
      spotQuantityExact: copied.spotQuantityExact,
      perpPriceExact: copied.perpPriceExact,
      perpQuantityExact: copied.perpQuantityExact,
    });
    producedCapitalProofs.add(proof);
    return Object.freeze({ ok: true as const, proof });
  } catch {
    return Object.freeze({ ok: false as const, code: 'CAPITAL_PROOF_INVALID' as const });
  }
}

function handoffShapeValid(handoff: Record<string, unknown>): boolean {
  return (
    exactKeys(handoff, HANDOFF_KEYS) &&
    boundedId(handoff.handoffId) &&
    boundedId(handoff.proposalId) &&
    handoff.proposalId.startsWith('bp_') &&
    handoff.handoffId === `bh_${handoff.proposalId}` &&
    boundedId(handoff.correlationId, 128) &&
    symbol(handoff.symbol) &&
    (handoff.direction === 'long_spot_short_perp' ||
      handoff.direction === 'short_spot_long_perp') &&
    typeof handoff.acceptedBy === 'string' &&
    handoff.acceptedBy.length > 0 &&
    handoff.acceptedBy.length <= 64 &&
    handoff.acceptedBy.trim() === handoff.acceptedBy &&
    utcMillis(handoff.acceptedTs) &&
    utcMillis(handoff.acceptedRevisionTs) &&
    typeof handoff.acceptedNetEdgePct === 'number' &&
    Number.isFinite(handoff.acceptedNetEdgePct) &&
    typeof handoff.acceptedNotionalUsd === 'number' &&
    Number.isFinite(handoff.acceptedNotionalUsd) &&
    handoff.acceptedNotionalUsd > 0 &&
    utcMillis(handoff.boundTs) &&
    (handoff.state === 'AWAITING_FEEDBACK' || handoff.state === 'TERMINAL') &&
    (handoff.terminalKind === null ||
      handoff.terminalKind === 'TERMINAL_REPORTED' ||
      handoff.terminalKind === 'CANCEL_CONFIRMED') &&
    (handoff.terminalTs === null || utcMillis(handoff.terminalTs)) &&
    (handoff.cumulativeFilledQuantity === null ||
      typeof handoff.cumulativeFilledQuantity === 'string') &&
    (handoff.lastSequence === null ||
      (Number.isSafeInteger(handoff.lastSequence) && (handoff.lastSequence as number) >= 0)) &&
    (handoff.lastObservedAtMs === null || utcMillis(handoff.lastObservedAtMs)) &&
    Number.isSafeInteger(handoff.ambiguousObservations) &&
    (handoff.ambiguousObservations as number) >= 0
  );
}

function canonicalStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function capitalProofShapeValid(proof: Record<string, unknown>): boolean {
  return (
    exactKeys(proof, CAPITAL_PROOF_KEYS) &&
    isObject(proof.eligibilityCandidate) &&
    isObject(proof.eligibilityPolicy) &&
    isObject(proof.consideration) &&
    exactKeys(proof.consideration, CONSIDERATION_KEYS) &&
    boundedId(proof.considerationDigest) &&
    boundedId(proof.eligibilityPolicyRevision) &&
    isObject(proof.allocationInput) &&
    isObject(proof.allocationDecision) &&
    isObject(proof.allocationAuthority) &&
    boundedId(proof.reservationCommandId) &&
    boundedId(proof.capitalClaimKey) &&
    isObject(proof.reservation) &&
    isObject(proof.stagedPlan) &&
    isObject(proof.stagedPlanConfiguration) &&
    boundedId(proof.stagedPlanBuildCorrelationId, 128) &&
    boundedId(proof.mandateBuildCorrelationId, 128) &&
    isObject(proof.mandate) &&
    exactKeys(proof.mandate, CAPITAL_MANDATE_KEYS) &&
    typeof proof.spotPriceExact === 'string' &&
    typeof proof.spotQuantityExact === 'string' &&
    typeof proof.perpPriceExact === 'string' &&
    typeof proof.perpQuantityExact === 'string'
  );
}

function currentCompleteTruth(value: unknown, nowMs: number): value is Readonly<TruthMetadata> {
  if (
    !isObject(value) ||
    !isObject(value.source) ||
    !isObject(value.freshness) ||
    validateSourcedTimestamp(value.source).length > 0 ||
    !utcMillis(value.evaluatedAtMs) ||
    value.evaluatedAtMs > nowMs ||
    value.completeness !== 'COMPLETE' ||
    !canonicalStringArray(value.reasons) ||
    !Array.isArray(value.evidenceReferences) ||
    value.evidenceReferences.some((entry) => typeof entry !== 'string') ||
    (value.revision !== null && !boundedId(value.revision))
  ) {
    return false;
  }
  try {
    const truth = value as unknown as Readonly<TruthMetadata>;
    if (!truthAllowsNewExposure(truth)) return false;
    if (
      canonicalJson(evaluateFreshness(truth.source, truth.evaluatedAtMs)) !==
      canonicalJson(truth.freshness)
    ) {
      return false;
    }
    const basis = truth.source.sourceTimeMs ?? truth.source.receivedAtMs;
    return basis <= nowMs && nowMs - basis <= truth.source.maxAgeMs;
  } catch {
    return false;
  }
}

function canonicalCapitalIntegrity(
  proof: Record<string, unknown>,
  nowMs: number,
): boolean {
  if (!capitalProofShapeValid(proof)) return false;
  const consideration =
    proof.consideration as unknown as Readonly<OpportunityConsideration>;
  const mandate = proof.mandate as unknown as Readonly<CapitalMandate>;
  if (
    consideration.mode !== 'MANUAL_ARMED' ||
    consideration.status !== 'ELIGIBLE' ||
    !canonicalStringArray(consideration.reasons) ||
    canonicalJson(consideration.reasons) !==
      canonicalJson(['PROPOSAL_OPEN', 'PROPOSAL_REVISION_UNKNOWN']) ||
    !Array.isArray(consideration.conflictingConsiderationIds) ||
    consideration.conflictingConsiderationIds.length !== 0 ||
    !utcMillis(consideration.evaluatedAtMs) ||
    consideration.evaluatedAtMs > nowMs ||
    !currentCompleteTruth(consideration.truth, nowMs) ||
    !isObject(consideration.proposal) ||
    !exactKeys(consideration.proposal, CONSIDERATION_PROPOSAL_KEYS) ||
    !isObject(consideration.economics) ||
    !exactKeys(consideration.economics, CONSIDERATION_ECONOMICS_KEYS) ||
    !Array.isArray(consideration.legs) ||
    consideration.legs.length !== 2 ||
    consideration.legs.some((leg) => !exactKeys(leg, CONSIDERATION_LEG_KEYS))
  ) {
    return false;
  }
  if (
    !boundedId(consideration.id) ||
    !boundedId(consideration.proposal.sourceProposalId) ||
    !boundedId(consideration.proposal.canonicalProposalId) ||
    !boundedId(consideration.proposal.sourceCorrelationId, 128) ||
    consideration.proposal.strategy !== 'BASIS' ||
    !symbol(consideration.proposal.symbol) ||
    consideration.proposal.direction !== 'long_spot_short_perp' ||
    typeof consideration.proposal.sourceLifecycle !== 'string' ||
    consideration.proposal.sourceLifecycle.trim().toUpperCase() !== 'OPEN' ||
    consideration.proposal.sourceRevision !== null ||
    !boundedId(consideration.proposal.intakeDigest) ||
    !utcMillis(consideration.proposal.createdAtMs) ||
    !utcMillis(consideration.proposal.updatedAtMs) ||
    !utcMillis(consideration.proposal.expiresAtMs) ||
    consideration.proposal.createdAtMs > consideration.proposal.updatedAtMs ||
    consideration.proposal.expiresAtMs <= nowMs ||
    consideration.evaluatedAtMs !== consideration.truth.evaluatedAtMs ||
    typeof consideration.economics.requestedCapital !== 'string' ||
    typeof consideration.economics.expectedNetEdge !== 'string' ||
    consideration.economics.valuationAsset !== 'USDT'
  ) {
    return false;
  }
  const roles = consideration.legs.map((leg) => {
    if (!isObject(leg)) return '';
    return `${String(leg.role)}:${String(leg.side)}:${String(leg.symbol)}:${String(leg.borrowRequired)}`;
  });
  if (
    !roles.includes(`SPOT:LONG:${consideration.proposal.symbol}:false`) ||
    !roles.includes(`PERPETUAL:SHORT:${consideration.proposal.symbol}:false`)
  ) {
    return false;
  }
  try {
    if (proof.considerationDigest !== capitalDigest(consideration)) return false;
    const batch = evaluateOpportunityEligibility(
      [
        proof.eligibilityCandidate as unknown as Readonly<OpportunityEligibilityCandidate>,
      ],
      proof.eligibilityPolicy as unknown as Readonly<OpportunityEligibilityPolicy>,
      consideration.evaluatedAtMs,
    );
    if (
      batch.considerations.length !== 1 ||
      batch.policyRevision !== proof.eligibilityPolicyRevision ||
      canonicalJson(batch.considerations[0]) !== canonicalJson(consideration)
    ) {
      return false;
    }

    const allocationInput =
      proof.allocationInput as unknown as Readonly<AllocationBatchInput>;
    const allocationCandidate = allocationInput.candidates[0];
    if (
      allocationInput.nowMs !== consideration.evaluatedAtMs ||
      allocationInput.candidates.length !== 1 ||
      allocationCandidate === undefined ||
      canonicalJson(allocationCandidate.consideration) !==
        canonicalJson(consideration) ||
      allocationCandidate.considerationId !== consideration.id ||
      allocationCandidate.considerationDigest !== proof.considerationDigest ||
      allocationCandidate.eligibilityPolicyRevision !==
        proof.eligibilityPolicyRevision ||
      allocationCandidate.eligibilityStatus !== consideration.status ||
      allocationCandidate.considerationMode !== consideration.mode ||
      allocationCandidate.requestedAmount !==
        consideration.economics.requestedCapital
    ) {
      return false;
    }
    const allocation = allocateCapital(allocationInput);
    const allocationDecision =
      proof.allocationDecision as unknown as Readonly<CapitalReservationOwnerDecision>;
    const allocationAuthority =
      proof.allocationAuthority as unknown as Readonly<AllocationAuthorityReceipt>;
    const replayDecision = allocation.decisions.find(
      (entry) => entry.id === allocationDecision.id,
    );
    const replayAuthority = allocation.authorities.find(
      (entry) => entry.allocationDecisionId === allocationDecision.id,
    );
    if (
      allocation.decisions.length !== 1 ||
      replayDecision === undefined ||
      replayAuthority === undefined ||
      canonicalJson(replayDecision) !== canonicalJson(allocationDecision) ||
      canonicalJson(replayAuthority) !== canonicalJson(allocationAuthority) ||
      (allocationDecision.status !== 'GRANTED' &&
        allocationDecision.status !== 'CAPPED')
    ) {
      return false;
    }

    const reservationReplay = reduceReservationBook(
      EMPTY_RESERVATION_BOOK,
      Object.freeze({
        kind: 'RESERVE' as const,
        commandId: proof.reservationCommandId as string,
        nowMs: consideration.evaluatedAtMs,
        allocation: allocationDecision,
        authority: allocationAuthority,
        allocationInput,
        capitalClaimKey: proof.capitalClaimKey as string,
      }),
    );
    const replayReservation =
      reservationReplay.book.reservations[0]?.reservation;
    const reservation =
      proof.reservation as unknown as Readonly<CapitalReservation>;
    if (
      reservationReplay.mutation.status !== 'APPLIED' ||
      reservationReplay.book.reservations.length !== 1 ||
      replayReservation === undefined ||
      canonicalJson(replayReservation) !== canonicalJson(reservation) ||
      reservation.createdAtMs !== consideration.evaluatedAtMs ||
      reservation.amount !== allocationDecision.grantedAmount
    ) {
      return false;
    }

    const stagedPlan =
      proof.stagedPlan as unknown as Readonly<GovernedStagedPlan>;
    const stagedPlanConfiguration =
      proof.stagedPlanConfiguration as unknown as Readonly<StagedPlanConfiguration>;
    const stagedPlanReplay = buildStagedPlan({
      reservation,
      proposalIntakeDigest: consideration.proposal.intakeDigest,
      valuationAsset: consideration.economics.valuationAsset,
      configuration: stagedPlanConfiguration,
      stages: stagedPlan.stages,
      activeStage: stagedPlan.activeStage,
      createdAtMs: stagedPlan.createdAtMs,
      expiresAtMs: stagedPlan.expiresAtMs,
      correlationId: proof.stagedPlanBuildCorrelationId as string,
    });
    if (
      !stagedPlanReplay.ok ||
      canonicalJson(stagedPlanReplay.value) !== canonicalJson(stagedPlan)
    ) {
      return false;
    }

    const mandateReplay = buildCapitalMandate({
      consideration,
      allocationDecisionId: allocationDecision.id,
      reservation,
      plan: stagedPlan,
      configuration: stagedPlanConfiguration,
      targetMaximumExposure: allocationDecision.grantedAmount,
      createdAtMs: mandate.createdAtMs,
      expiresAtMs: mandate.expiresAtMs,
      correlationId: proof.mandateBuildCorrelationId as string,
    });
    if (
      !mandateReplay.ok ||
      canonicalJson(mandateReplay.value) !== canonicalJson(mandate)
    ) {
      return false;
    }

    if (
      !boundedId(mandate.id) ||
      !positiveSafeInteger(mandate.revision) ||
      !boundedId(mandate.digest) ||
      !boundedId(mandate.considerationId) ||
      !boundedId(mandate.allocationDecisionId) ||
      !boundedId(mandate.reservationId) ||
      !boundedId(mandate.stagedPlanId) ||
      !positiveSafeInteger(mandate.stagedPlanRevision) ||
      !boundedId(mandate.stagedPlanDigest) ||
      !boundedId(mandate.proposalIntakeDigest) ||
      !boundedId(mandate.configRevision) ||
      mandate.approvalId !== null ||
      mandate.riskDecision !== null ||
      typeof mandate.targetMaximumExposure !== 'string' ||
      mandate.valuationAsset !== consideration.economics.valuationAsset ||
      !utcMillis(mandate.createdAtMs) ||
      !utcMillis(mandate.expiresAtMs) ||
      mandate.createdAtMs !== consideration.evaluatedAtMs ||
      stagedPlan.createdAtMs !== consideration.evaluatedAtMs ||
      mandate.createdAtMs > nowMs ||
      mandate.expiresAtMs <= nowMs ||
      mandate.expiresAtMs > consideration.proposal.expiresAtMs ||
      mandate.considerationId !== consideration.id ||
      mandate.proposalIntakeDigest !== consideration.proposal.intakeDigest ||
      mandate.allocationDecisionId !== allocationDecision.id ||
      mandate.reservationId !== reservation.id ||
      mandate.stagedPlanId !== stagedPlan.id ||
      mandate.stagedPlanRevision !== stagedPlan.revision ||
      mandate.stagedPlanDigest !== stagedPlan.digest ||
      mandate.configRevision !== stagedPlan.configRevision
    ) {
      return false;
    }
    const requested = canonicalPositiveDecimal(consideration.economics.requestedCapital);
    const maximum = canonicalPositiveDecimal(mandate.targetMaximumExposure);
    return (
      requested !== null &&
      maximum !== null &&
      compareExactDecimals(maximum, requested) <= 0 &&
      maximum === allocationDecision.grantedAmount
    );
  } catch {
    return false;
  }
}

/**
 * Bind a frozen accepted handoff to the one immutable four-step P2 plan.
 *
 * Disabled and kill-switch refusals happen before `input` is inspected. This
 * makes default OFF and kill dominance mechanically observable even when a
 * caller passes hostile objects.
 */
function bindBasisValidateOnlyPlanUnsafe(
  input: Readonly<BasisValidateOnlyPlanInput>,
  controls: Readonly<BasisValidateOnlyControls> = DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS,
): BasisValidateOnlyPlanResult {
  const effectiveControls = controlsSnapshot(controls);
  if (effectiveControls === null) return fail('CONTROL_INVALID');
  if (!effectiveControls.enabled) return fail('DISABLED');
  if (effectiveControls.killSwitchEngaged) return fail('KILL_SWITCH_ENGAGED');

  let rawHandoff: unknown;
  let rawCapital: unknown;
  let copied: unknown;
  try {
    rawHandoff = rawDataProperty(input, 'handoff');
    rawCapital = rawDataProperty(input, 'capital');
    copied = snapshotPlainData(input);
  } catch {
    return fail('INPUT_NOT_PLAIN_DATA');
  }
  if (!exactKeys(copied, INPUT_KEYS)) return fail('INPUT_NOT_PLAIN_DATA');
  const snapshot = copied;

  if (
    typeof rawHandoff !== 'object' ||
    rawHandoff === null ||
    nodeTypes.isProxy(rawHandoff) ||
    !Object.isFrozen(rawHandoff)
  ) {
    return fail('HANDOFF_NOT_FROZEN');
  }
  if (!isObject(snapshot.handoff) || !handoffShapeValid(snapshot.handoff)) {
    return fail('HANDOFF_INVALID');
  }
  const handoff = snapshot.handoff;
  if (
    handoff.direction !== 'long_spot_short_perp' ||
    handoff.state !== 'AWAITING_FEEDBACK' ||
    handoff.terminalKind !== null ||
    handoff.terminalTs !== null ||
    handoff.cumulativeFilledQuantity !== null ||
    handoff.lastSequence !== null ||
    handoff.lastObservedAtMs !== null ||
    handoff.ambiguousObservations !== 0
  ) {
    return fail('HANDOFF_NOT_READY');
  }

  if (snapshot.capital === null) return fail('CAPITAL_PROOF_REQUIRED');
  if (
    typeof rawCapital !== 'object' ||
    rawCapital === null ||
    nodeTypes.isProxy(rawCapital) ||
    !Object.isFrozen(rawCapital)
  ) {
    return fail('CAPITAL_PROOF_NOT_FROZEN');
  }
  if (!producedCapitalProofs.has(rawCapital)) {
    return fail('CAPITAL_PROOF_INVALID');
  }
  let rawConsideration: unknown;
  let rawMandate: unknown;
  try {
    rawConsideration = rawDataProperty(rawCapital, 'consideration');
    rawMandate = rawDataProperty(rawCapital, 'mandate');
  } catch {
    return fail('CAPITAL_PROOF_INVALID');
  }
  if (
    typeof rawConsideration !== 'object' ||
    rawConsideration === null ||
    nodeTypes.isProxy(rawConsideration) ||
    !Object.isFrozen(rawConsideration) ||
    typeof rawMandate !== 'object' ||
    rawMandate === null ||
    nodeTypes.isProxy(rawMandate) ||
    !Object.isFrozen(rawMandate)
  ) {
    return fail('CAPITAL_PROOF_NOT_FROZEN');
  }
  if (!isObject(snapshot.capital) || !capitalProofShapeValid(snapshot.capital)) {
    return fail('CAPITAL_PROOF_INVALID');
  }
  const capital =
    snapshot.capital as unknown as Readonly<BasisValidateOnlyCapitalProof>;
  const consideration = capital.consideration;
  const mandate = capital.mandate;

  if (!utcMillis(snapshot.nowMs)) return fail('STALE_OR_EXPIRED');
  const nowMs = snapshot.nowMs;
  if (
    consideration.mode !== 'MANUAL_ARMED' ||
    mandate.approvalId !== null ||
    mandate.riskDecision !== null ||
    !hasSyntheticOnlyEvidenceAuthority(snapshot.capital) ||
    !hasSyntheticOnlyEvidenceAuthority(snapshot.planInput)
  ) {
    return fail('AUTHORITY_INVALID');
  }
  if (!canonicalCapitalIntegrity(capital as unknown as Record<string, unknown>, nowMs)) {
    return fail('CAPITAL_PROOF_INVALID');
  }
  if (
    handoff.handoffId !== `bh_${String(handoff.proposalId)}` ||
    !(handoff.proposalId as string).startsWith('bp_') ||
    (handoff.acceptedBy as string).trim() !== handoff.acceptedBy ||
    (handoff.acceptedRevisionTs as number) < 0 ||
    (handoff.acceptedRevisionTs as number) > (handoff.acceptedTs as number) ||
    (handoff.acceptedTs as number) > (handoff.boundTs as number) ||
    (handoff.boundTs as number) > nowMs ||
    (mandate.createdAtMs as number) < (handoff.boundTs as number) ||
    (mandate.expiresAtMs as number) <= nowMs
  ) {
    return fail('STALE_OR_EXPIRED');
  }

  if (
    consideration.proposal.sourceProposalId !== handoff.proposalId ||
    consideration.proposal.sourceCorrelationId !== handoff.correlationId ||
    consideration.proposal.sourceRevision !== null ||
    consideration.proposal.updatedAtMs !== handoff.acceptedRevisionTs ||
    consideration.proposal.symbol !== handoff.symbol ||
    consideration.proposal.direction !== handoff.direction ||
    consideration.proposal.sourceProposalId ===
      consideration.proposal.canonicalProposalId ||
    !consideration.proposal.canonicalProposalId.startsWith('cprop_')
  ) {
    return fail('PROVENANCE_MISMATCH');
  }

  const requestedCapitalExact = canonicalPositiveDecimal(
    consideration.economics.requestedCapital,
  );
  const acceptedNetEdgeExact = canonicalPositiveDecimal(
    consideration.economics.expectedNetEdge,
  );
  const spotPriceExact = canonicalPositiveDecimal(capital.spotPriceExact);
  const spotQuantityExact = canonicalPositiveDecimal(capital.spotQuantityExact);
  const perpPriceExact = canonicalPositiveDecimal(capital.perpPriceExact);
  const perpQuantityExact = canonicalPositiveDecimal(capital.perpQuantityExact);
  if (
    requestedCapitalExact === null ||
    acceptedNetEdgeExact === null ||
    spotPriceExact === null ||
    spotQuantityExact === null ||
    perpPriceExact === null ||
    perpQuantityExact === null ||
    !losslessPlanNumber(
      requestedCapitalExact,
      handoff.acceptedNotionalUsd,
    ) ||
    !losslessPlanNumber(
      acceptedNetEdgeExact,
      handoff.acceptedNetEdgePct,
    )
  ) {
    return fail('EXACT_DECIMAL_REQUIRED');
  }
  const acceptedNotionalUsdExact = requestedCapitalExact;

  if (
    !isObject(snapshot.planInput) ||
    !exactKeys(snapshot.planInput, PLAN_INPUT_KEYS) ||
    snapshot.planInput.strategy !== 'BASIS' ||
    snapshot.planInput.direction !== 'LONG_SPOT_SHORT_PERP' ||
    snapshot.planInput.mode !== 'VALIDATE_ONLY' ||
    snapshot.planInput.symbol !== handoff.symbol ||
    !isObject(snapshot.planInput.proposal) ||
    !exactKeys(snapshot.planInput.proposal, PROPOSAL_KEYS) ||
    snapshot.planInput.proposal.canonicalProposalId !==
      consideration.proposal.canonicalProposalId ||
    snapshot.planInput.proposal.observedAtMs !== handoff.acceptedRevisionTs ||
    !positiveSafeInteger(snapshot.planInput.proposal.maxAgeMs) ||
    snapshot.planInput.proposal.expiresAtMs !==
      consideration.proposal.expiresAtMs ||
    !isObject(snapshot.planInput.normalBasis) ||
    !exactKeys(snapshot.planInput.normalBasis, NORMAL_BASIS_REQUEST_KEYS) ||
    snapshot.planInput.normalBasis.version !== 1 ||
    !isObject(snapshot.planInput.normalBasis.evaluationInput)
  ) {
    return fail('PROVENANCE_MISMATCH');
  }

  const proposalObservedAtMs = snapshot.planInput.proposal.observedAtMs;
  const proposalMaxAgeMs = snapshot.planInput.proposal.maxAgeMs;
  const proposalExpiresAtMs = snapshot.planInput.proposal.expiresAtMs;
  if (
    !utcMillis(proposalObservedAtMs) ||
    !utcMillis(proposalExpiresAtMs) ||
    proposalObservedAtMs > nowMs ||
    nowMs - proposalObservedAtMs > proposalMaxAgeMs ||
    proposalExpiresAtMs <= nowMs
  ) {
    return fail('STALE_OR_EXPIRED');
  }

  const evaluationInput = snapshot.planInput.normalBasis.evaluationInput;
  if (
    evaluationInput.nowMs !== nowMs ||
    !isObject(evaluationInput.intent) ||
    !boundedId(evaluationInput.intent.accountId, 128) ||
    evaluationInput.intent.proposalRef !== consideration.proposal.canonicalProposalId
  ) {
    return fail('PROVENANCE_MISMATCH');
  }

  if (
    !losslessPlanNumber(spotQuantityExact, snapshot.planInput.spotQuantity) ||
    !losslessPlanNumber(perpQuantityExact, snapshot.planInput.perpQuantity)
  ) {
    return fail('EXACT_DECIMAL_REQUIRED');
  }

  let plan: Readonly<ExecutionPlanDefinition>;
  try {
    plan = createExecutionPlanDefinition(
      snapshot.planInput as unknown as CreateExecutionPlanInput,
    );
    if (plan.normalBasisBinding === undefined) return fail('PLAN_INVALID');
    validateNormalBasisPlanBinding(plan, plan.normalBasisBinding);
  } catch {
    return fail('PLAN_INVALID');
  }

  const normalBasis = plan.normalBasisBinding;
  if (
    normalBasis === undefined ||
    normalBasis.risk.accountId !== evaluationInput.intent.accountId ||
    normalBasis.risk.proposalRef !== consideration.proposal.canonicalProposalId ||
    normalBasis.risk.verdictEvaluatedAtMs !== nowMs ||
    normalBasis.entryExpiresAtMs <= nowMs ||
    normalBasis.entryExpiresAtMs > mandate.expiresAtMs ||
    !losslessPlanNumber(spotPriceExact, normalBasis.risk.spot.intendedPrice) ||
    !losslessPlanNumber(perpPriceExact, normalBasis.risk.perp.intendedPrice) ||
    normalBasis.actionAuthority !== 'NONE_RECORD_ONLY' ||
    normalBasis.riskAuthority !== 'NONE' ||
    normalBasis.sendEligible !== false ||
    canonicalJson(normalBasis.stepOrder) !== canonicalJson(NORMAL_BASIS_STEP_ORDER) ||
    normalBasis.steps.SPOT_OPEN.clientOrderId !== plan.openingLegs.SPOT.clientOrderId ||
    normalBasis.steps.PERP_OPEN.clientOrderId !== plan.openingLegs.PERP.clientOrderId ||
    normalBasis.steps.PERP_CLOSE.clientOrderId !== plan.closingLegs.PERP.clientOrderId ||
    normalBasis.steps.SPOT_CLOSE.clientOrderId !== plan.closingLegs.SPOT.clientOrderId
  ) {
    return fail('PROVENANCE_MISMATCH');
  }
  if (
    plan.correlationId === handoff.correlationId ||
    !plan.correlationId.startsWith('cor_')
  ) {
    return fail('PROVENANCE_MISMATCH');
  }

  let spotNotionalUsdExact: NonNegativeDecimal;
  let perpNotionalUsdExact: NonNegativeDecimal;
  try {
    spotNotionalUsdExact = normalizeNonNegativeExactDecimal(
      multiplyExactDecimals(spotPriceExact, spotQuantityExact),
    );
    perpNotionalUsdExact = normalizeNonNegativeExactDecimal(
      multiplyExactDecimals(perpPriceExact, perpQuantityExact),
    );
    const grossNotional = normalizeNonNegativeExactDecimal(
      addExactDecimals(spotNotionalUsdExact, perpNotionalUsdExact),
    );
    const approvedGross = normalizeNonNegativeExactDecimal(
      normalBasis.risk.approvedEntryGrossNotionalExact,
    );
    const capitalMaximum = normalizeNonNegativeExactDecimal(
      mandate.targetMaximumExposure,
    );
    if (
      compareExactDecimals(capitalMaximum, acceptedNotionalUsdExact) > 0 ||
      compareExactDecimals(spotNotionalUsdExact, capitalMaximum) > 0 ||
      compareExactDecimals(perpNotionalUsdExact, capitalMaximum) > 0 ||
      compareExactDecimals(grossNotional, capitalMaximum) > 0 ||
      compareExactDecimals(grossNotional, approvedGross) > 0
    ) {
      return fail('PROVENANCE_MISMATCH');
    }
  } catch {
    return fail('EXACT_DECIMAL_REQUIRED');
  }

  const validatedControls = Object.freeze({
    enabled: true as const,
    killSwitchEngaged: false as const,
  });
  const semantic = {
    schema: BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA,
    version: BASIS_VALIDATE_ONLY_PLAN_BINDING_VERSION,
    handoffId: handoff.handoffId as string,
    sourceProposalId: handoff.proposalId as string,
    canonicalProposalId: consideration.proposal.canonicalProposalId as string,
    handoffCorrelationId: handoff.correlationId as string,
    planCorrelationId: plan.correlationId,
    acceptedRevisionTs: handoff.acceptedRevisionTs as number,
    acceptedNotionalUsdExact,
    considerationId: consideration.id as string,
    considerationDigest: capital.considerationDigest as string,
    mandateId: mandate.id as string,
    mandateDigest: mandate.digest as string,
    accountId: evaluationInput.intent.accountId as string,
    symbol: handoff.symbol as string,
    direction: 'LONG_SPOT_SHORT_PERP' as const,
    proposalExpiresAtMs,
    spotPriceExact,
    spotQuantityExact,
    spotNotionalUsdExact,
    perpPriceExact,
    perpQuantityExact,
    perpNotionalUsdExact,
    validatedControls,
    plan,
    ...BASIS_VALIDATE_ONLY_NON_FIREABLE_POSTURE,
  };
  const binding: Readonly<BasisValidateOnlyPlanBinding> = Object.freeze({
    ...semantic,
    bindingId: `bvopb${BASIS_VALIDATE_ONLY_PLAN_BINDING_VERSION}_${stableHash128Hex(
      `basisValidateOnlyPlanBinding|${canonicalJson(semantic)}`,
    )}`,
  });
  producedBindings.add(binding);
  return Object.freeze({
    ok: true as const,
    binding,
    ...BASIS_VALIDATE_ONLY_NON_FIREABLE_POSTURE,
  });
}

/**
 * Total public boundary: malformed scalars, unexpected canonical-owner
 * exceptions, and adversarial plain data always become a typed refusal.
 */
export function bindBasisValidateOnlyPlan(
  input: Readonly<BasisValidateOnlyPlanInput>,
  controls: Readonly<BasisValidateOnlyControls> = DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS,
): BasisValidateOnlyPlanResult {
  try {
    return bindBasisValidateOnlyPlanUnsafe(input, controls);
  } catch {
    return fail('INPUT_NOT_PLAIN_DATA');
  }
}

/**
 * Nominal, side-effect-free brand guard. It does not inspect or dereference the
 * candidate, so arbitrary objects, accessors, Proxies, and revoked Proxies are
 * rejected without invoking user code.
 */
export function isBasisValidateOnlyPlanBinding(
  value: unknown,
): value is Readonly<BasisValidateOnlyPlanBinding> {
  return typeof value === 'object' && value !== null && producedBindings.has(value);
}
