import { types as nodeTypes } from 'node:util';

import {
  addExactDecimals,
  compareExactDecimals,
  isExactZero,
  negateExactDecimal,
  normalizeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import { deriveStateRevisionId } from '../contracts/identity.js';

export const BASIS_FLATNESS_SCHEMA =
  'cosmos.foundation.reconciliation.normalBasisFlatness' as const;
export const BASIS_FLATNESS_VERSION = 1 as const;
export const MAXIMUM_BASIS_FLATNESS_EVIDENCE_AGE_MS = 300_000;
export const MAXIMUM_BASIS_FLATNESS_AMBIGUITIES = 16;
export const MAXIMUM_BASIS_FLATNESS_OBJECT_KEYS = 24;

export const BASIS_FLATNESS_STEPS = Object.freeze([
  'SPOT_OPEN',
  'PERP_OPEN',
  'PERP_CLOSE',
  'SPOT_CLOSE',
] as const);
export type BasisFlatnessStep = (typeof BASIS_FLATNESS_STEPS)[number];

export const BASIS_FLATNESS_STATUSES = Object.freeze([
  'FLAT',
  'NOT_FLAT',
  'UNKNOWN',
  'BLOCKED',
] as const);
export type BasisFlatnessStatus = (typeof BASIS_FLATNESS_STATUSES)[number];

export const BASIS_FLATNESS_TERMINAL_ORDER_STATES = Object.freeze([
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'PROVEN_ABSENT',
] as const);
export type BasisFlatnessTerminalOrderState =
  (typeof BASIS_FLATNESS_TERMINAL_ORDER_STATES)[number];

export type BasisFlatnessEvidenceAuthority =
  | 'RECORDED_REPLAY'
  | 'SYNTHETIC_TEST';

export interface BasisFlatnessClientOrderIds {
  readonly SPOT_OPEN: string;
  readonly PERP_OPEN: string;
  readonly PERP_CLOSE: string;
  readonly SPOT_CLOSE: string;
}

export interface BasisFlatnessCloseAttemptClientOrderIds {
  readonly PERP_CLOSE: readonly string[];
  readonly SPOT_CLOSE: readonly string[];
}

/**
 * Compact immutable identity copied from the accepted Basis handoff, execution
 * aggregate, and normal-Basis binding. This record grants no authority.
 */
export interface BasisFlatnessPlanIdentity {
  readonly planId: string;
  readonly bindingId: string;
  readonly termsFingerprint: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly acceptedRevisionTs: number;
  readonly stateRevision: number;
  readonly stateRevisionId: string;
  readonly direction: 'LONG_SPOT_SHORT_PERP';
  readonly positionMode: 'ONE_WAY';
  readonly clientOrderIds: Readonly<BasisFlatnessClientOrderIds>;
  /** Every permitted re-close identity, indexed by its immutable attempt. */
  readonly closeAttemptClientOrderIds: Readonly<BasisFlatnessCloseAttemptClientOrderIds>;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly riskAuthority: 'NONE';
  readonly sendEligible: false;
}

export interface BasisFlatnessSourceMetadata {
  readonly sourceId: string;
  readonly authority: BasisFlatnessEvidenceAuthority;
  readonly completeness: 'COMPLETE';
  readonly sourceTimeMs: number;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
}

export interface BasisFlatnessOrderEvidence {
  readonly step: BasisFlatnessStep;
  readonly attempt: number;
  readonly planId: string;
  readonly bindingId: string;
  readonly termsFingerprint: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly acceptedRevisionTs: number;
  readonly stateRevision: number;
  readonly stateRevisionId: string;
  readonly venue: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly side: 'BUY' | 'SELL';
  readonly reduceOnly: boolean;
  readonly clientOrderId: string;
  readonly status: BasisFlatnessTerminalOrderState;
  readonly submittedQuantityExact: string;
  readonly cumulativeFilledQuantityExact: string;
  readonly ambiguous: false;
  readonly terminalObservedAtMs: number;
}

export interface BasisFlatnessOrderCollection {
  readonly metadata: Readonly<BasisFlatnessSourceMetadata>;
  readonly records: readonly Readonly<BasisFlatnessOrderEvidence>[];
}

export interface BasisFlatnessPositionEvidence {
  readonly venue: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly accountId: string;
  readonly symbol: string;
  readonly acceptedRevisionTs: number;
  readonly stateRevision: number;
  readonly stateRevisionId: string;
  readonly positionMode: 'CASH' | 'ONE_WAY';
  readonly baselineSignedBaseQuantityExact: string;
  readonly currentSignedBaseQuantityExact: string;
  readonly baselineMetadata: Readonly<BasisFlatnessSourceMetadata>;
  readonly currentMetadata: Readonly<BasisFlatnessSourceMetadata>;
}

export interface BasisFlatnessEvidence {
  readonly orders: Readonly<BasisFlatnessOrderCollection>;
  readonly positions: readonly Readonly<BasisFlatnessPositionEvidence>[];
  /** Normalizers preserve ambiguity explicitly. Flatness requires this to be empty. */
  readonly ambiguities: readonly string[];
}

export interface BasisFlatnessVerificationInput {
  readonly nowMs: number;
  readonly policy: Readonly<BasisFlatnessVerifierPolicy>;
  readonly plan: Readonly<BasisFlatnessPlanIdentity>;
  readonly evidence: Readonly<BasisFlatnessEvidence>;
}

export interface BasisFlatnessVerifierPolicy {
  /**
   * Verifier-owned ceiling. Venue/source metadata cannot widen this window.
   * The upper bound prevents a caller from turning stale truth into current
   * truth with an arbitrarily large value.
   */
  readonly maximumEvidenceAgeMs: number;
}

export interface BasisFlatnessIdentityProjection {
  readonly planId: string;
  readonly bindingId: string;
  readonly termsFingerprint: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly acceptedRevisionTs: number;
  readonly stateRevision: number;
  readonly stateRevisionId: string;
  readonly clientOrderIds: Readonly<BasisFlatnessClientOrderIds>;
  readonly closeAttemptClientOrderIds: Readonly<BasisFlatnessCloseAttemptClientOrderIds>;
}

export interface BasisFlatnessExactProjection {
  readonly spotOrderDeltaExact: string;
  readonly usdmOrderDeltaExact: string;
  readonly spotPositionDeltaExact: string;
  readonly usdmPositionDeltaExact: string;
  readonly spotOrderPositionDifferenceExact: string;
  readonly usdmOrderPositionDifferenceExact: string;
}

export interface BasisFlatnessResult {
  readonly schema: typeof BASIS_FLATNESS_SCHEMA;
  readonly version: typeof BASIS_FLATNESS_VERSION;
  readonly status: BasisFlatnessStatus;
  /** True only for fresh, complete, identity-bound, exact zero proof. */
  readonly flat: boolean;
  readonly identity: Readonly<BasisFlatnessIdentityProjection> | null;
  readonly exact: Readonly<BasisFlatnessExactProjection> | null;
  readonly evidenceAuthority: BasisFlatnessEvidenceAuthority | 'UNAVAILABLE';
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
  readonly executionAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

type ExpectedOrderShape = Readonly<{
  venue: BasisFlatnessOrderEvidence['venue'];
  side: BasisFlatnessOrderEvidence['side'];
  reduceOnly: boolean;
}>;

const EXPECTED_ORDER_SHAPES: Readonly<Record<BasisFlatnessStep, ExpectedOrderShape>> =
  Object.freeze({
    SPOT_OPEN: Object.freeze({
      venue: 'BINANCE_SPOT',
      side: 'BUY',
      reduceOnly: false,
    }),
    PERP_OPEN: Object.freeze({
      venue: 'BINANCE_USDM',
      side: 'SELL',
      reduceOnly: false,
    }),
    PERP_CLOSE: Object.freeze({
      venue: 'BINANCE_USDM',
      side: 'BUY',
      reduceOnly: true,
    }),
    SPOT_CLOSE: Object.freeze({
      venue: 'BINANCE_SPOT',
      side: 'SELL',
      reduceOnly: false,
    }),
  });

const TERMINAL_ORDER_STATES = new Set<string>(
  BASIS_FLATNESS_TERMINAL_ORDER_STATES,
);
const RESULT_BRANDS = new WeakSet<object>();
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CLOSE_ATTEMPTS = 4;

class BasisFlatnessInputProblem extends Error {
  constructor(
    readonly status: Extract<BasisFlatnessStatus, 'UNKNOWN' | 'BLOCKED'>,
    readonly code: string,
  ) {
    super(code);
  }
}

function problem(
  status: Extract<BasisFlatnessStatus, 'UNKNOWN' | 'BLOCKED'>,
  code: string,
): never {
  throw new BasisFlatnessInputProblem(status, code);
}

function descriptorValues(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_PLAIN_OBJECT_REQUIRED`);
  }
  if (nodeTypes.isProxy(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_PROXY_REJECTED`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return problem('BLOCKED', `${path.toUpperCase()}_PLAIN_OBJECT_REQUIRED`);
  }

  // Plain evidence objects in this contract are deliberately tiny (the
  // largest is one order record). Bound own-key materialization before
  // reading any descriptors, then inspect only the exact expected keys.
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAXIMUM_BASIS_FLATNESS_OBJECT_KEYS) {
    return problem('BLOCKED', `${path.toUpperCase()}_OWN_KEY_BUDGET_EXCEEDED`);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return problem('BLOCKED', `${path.toUpperCase()}_SYMBOL_FIELD_REJECTED`);
  }
  const actualKeys = (ownKeys as string[]).sort();
  const wantedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== wantedKeys.length ||
    actualKeys.some((key, index) => key !== wantedKeys[index])
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_SHAPE_INVALID`);
  }
  if (!Object.isFrozen(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_FROZEN_VALUE_REQUIRED`);
  }

  const projected: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return problem('BLOCKED', `${path.toUpperCase()}_ACCESSOR_REJECTED`);
    }
    projected[key] = descriptor.value;
  }
  return Object.freeze(projected);
}

function descriptorArray(
  value: unknown,
  path: string,
  minimumLength: number,
  maximumLength: number,
  lengthStatus: Extract<BasisFlatnessStatus, 'UNKNOWN' | 'BLOCKED'> = 'BLOCKED',
): readonly unknown[] {
  if (typeof value !== 'object' || value === null) {
    return problem('BLOCKED', `${path.toUpperCase()}_ARRAY_REQUIRED`);
  }
  if (nodeTypes.isProxy(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_PROXY_REJECTED`);
  }
  if (!Array.isArray(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_ARRAY_REQUIRED`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return problem('BLOCKED', `${path.toUpperCase()}_PLAIN_ARRAY_REQUIRED`);
  }

  // Read the non-enumerating built-in length descriptor first. An attacker
  // can provide a frozen dense/sparse array with billions of slots; no
  // array-wide operation is permitted until that declared size is bounded.
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    (lengthDescriptor.value as number) < 0
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_ARRAY_SHAPE_INVALID`);
  }
  const length = lengthDescriptor.value as number;
  if (length < minimumLength || length > maximumLength) {
    return problem(lengthStatus, `${path.toUpperCase()}_LENGTH_INVALID`);
  }

  // Mirror the USD-M passive-array gate. Bounded declared length is not
  // enough: a zero/short array can still carry arbitrarily many named own
  // properties. Reject that breadth before integrity scanning or cloning all
  // descriptors.
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > maximumLength + 1 ||
    ownKeys.length !== length + 1 ||
    ownKeys.some((key) => typeof key !== 'string')
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_ARRAY_SHAPE_INVALID`);
  }

  if (!Object.isFrozen(value)) {
    return problem('BLOCKED', `${path.toUpperCase()}_FROZEN_VALUE_REQUIRED`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const actualKeys = Object.keys(descriptors).sort();
  // Exact descriptor count plus the indexed-data-property loop below rejects
  // holes and extras after the bounded length gate.
  if (actualKeys.length !== length + 1 || descriptors.length === undefined) {
    return problem('BLOCKED', `${path.toUpperCase()}_ARRAY_SHAPE_INVALID`);
  }

  const projected: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return problem('BLOCKED', `${path.toUpperCase()}_ACCESSOR_REJECTED`);
    }
    projected.push(descriptor.value);
  }
  return Object.freeze(projected);
}

function identifier(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_INVALID`);
  }
  return value;
}

function safeInteger(
  value: unknown,
  path: string,
  minimum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_INVALID`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return problem('BLOCKED', `${path.toUpperCase()}_INVALID`);
  }
  return value;
}

function exactDecimal(
  value: unknown,
  path: string,
  sign: 'POSITIVE' | 'NON_NEGATIVE' | 'SIGNED',
): ExactDecimal {
  if (typeof value !== 'string') {
    return problem('BLOCKED', `${path.toUpperCase()}_LOSSY_DECIMAL_REJECTED`);
  }
  let normalized: ExactDecimal;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    return problem('BLOCKED', `${path.toUpperCase()}_DECIMAL_INVALID`);
  }
  if (normalized !== value) {
    return problem('BLOCKED', `${path.toUpperCase()}_NON_CANONICAL_DECIMAL`);
  }
  const comparison = compareExactDecimals(
    normalized,
    normalizeExactDecimal('0'),
  );
  if (
    (sign === 'POSITIVE' && comparison <= 0) ||
    (sign === 'NON_NEGATIVE' && comparison < 0)
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_DECIMAL_SIGN_INVALID`);
  }
  return normalized;
}

function parseClientOrderIds(
  value: unknown,
): Readonly<BasisFlatnessClientOrderIds> {
  const record = descriptorValues(
    value,
    BASIS_FLATNESS_STEPS,
    'plan_client_order_ids',
  );
  const parsed = Object.freeze({
    SPOT_OPEN: identifier(
      record.SPOT_OPEN,
      'plan_client_order_ids_spot_open',
    ),
    PERP_OPEN: identifier(
      record.PERP_OPEN,
      'plan_client_order_ids_perp_open',
    ),
    PERP_CLOSE: identifier(
      record.PERP_CLOSE,
      'plan_client_order_ids_perp_close',
    ),
    SPOT_CLOSE: identifier(
      record.SPOT_CLOSE,
      'plan_client_order_ids_spot_close',
    ),
  });
  if (new Set(Object.values(parsed)).size !== BASIS_FLATNESS_STEPS.length) {
    return problem('BLOCKED', 'PLAN_CLIENT_ORDER_IDS_NOT_DISTINCT');
  }
  return parsed;
}

function parseCloseAttemptIds(
  value: unknown,
  base: Readonly<BasisFlatnessClientOrderIds>,
): Readonly<BasisFlatnessCloseAttemptClientOrderIds> {
  const record = descriptorValues(
    value,
    ['PERP_CLOSE', 'SPOT_CLOSE'],
    'plan_close_attempt_client_order_ids',
  );
  const parseIds = (
    candidate: unknown,
    step: 'PERP_CLOSE' | 'SPOT_CLOSE',
  ): readonly string[] => {
    const values = descriptorArray(
      candidate,
      `plan_close_attempt_client_order_ids_${step.toLowerCase()}`,
      MAX_CLOSE_ATTEMPTS,
      MAX_CLOSE_ATTEMPTS,
    );
    const ids = Object.freeze(
      values.map((item, index) =>
        identifier(item, `${step.toLowerCase()}_attempt_${index}_client_order_id`),
      ),
    );
    if (new Set(ids).size !== ids.length || ids[0] !== base[step]) {
      return problem('BLOCKED', `${step}_CLOSE_ATTEMPT_IDS_INVALID`);
    }
    return ids;
  };
  const parsed = Object.freeze({
    PERP_CLOSE: parseIds(record.PERP_CLOSE, 'PERP_CLOSE'),
    SPOT_CLOSE: parseIds(record.SPOT_CLOSE, 'SPOT_CLOSE'),
  });
  const everyBoundIdentity = [
    base.SPOT_OPEN,
    base.PERP_OPEN,
    ...parsed.PERP_CLOSE,
    ...parsed.SPOT_CLOSE,
  ];
  if (new Set(everyBoundIdentity).size !== everyBoundIdentity.length) {
    return problem('BLOCKED', 'PLAN_CLIENT_ORDER_IDS_NOT_DISTINCT');
  }
  return parsed;
}

function parsePlan(value: unknown): Readonly<BasisFlatnessPlanIdentity> {
  const record = descriptorValues(
    value,
    [
      'planId',
      'bindingId',
      'termsFingerprint',
      'accountId',
      'symbol',
      'acceptedRevisionTs',
      'stateRevision',
      'stateRevisionId',
      'direction',
      'positionMode',
      'clientOrderIds',
      'closeAttemptClientOrderIds',
      'actionAuthority',
      'riskAuthority',
      'sendEligible',
    ],
    'plan',
  );
  if (record.direction !== 'LONG_SPOT_SHORT_PERP') {
    return problem('BLOCKED', 'PLAN_DIRECTION_UNSUPPORTED');
  }
  if (record.positionMode !== 'ONE_WAY') {
    return problem('UNKNOWN', 'USDM_ONE_WAY_POSITION_MODE_UNPROVEN');
  }
  if (
    record.actionAuthority !== 'NONE_RECORD_ONLY' ||
    record.riskAuthority !== 'NONE' ||
    record.sendEligible !== false
  ) {
    return problem('BLOCKED', 'PLAN_ZERO_AUTHORITY_INVARIANT_VIOLATED');
  }
  const clientOrderIds = parseClientOrderIds(record.clientOrderIds);
  const planId = identifier(record.planId, 'plan_id');
  const stateRevision = safeInteger(record.stateRevision, 'state_revision', 1);
  const stateRevisionId = identifier(
    record.stateRevisionId,
    'state_revision_id',
  );
  if (
    stateRevisionId !== deriveStateRevisionId({
      scope: `execution:${planId}`,
      revision: stateRevision,
    })
  ) {
    return problem('BLOCKED', 'STATE_REVISION_ID_NOT_DETERMINISTIC');
  }
  return Object.freeze({
    planId,
    bindingId: identifier(record.bindingId, 'binding_id'),
    termsFingerprint: identifier(
      record.termsFingerprint,
      'terms_fingerprint',
    ),
    accountId: identifier(record.accountId, 'account_id'),
    symbol: identifier(record.symbol, 'symbol'),
    acceptedRevisionTs: safeInteger(
      record.acceptedRevisionTs,
      'accepted_revision_ts',
      0,
    ),
    stateRevision,
    stateRevisionId,
    direction: 'LONG_SPOT_SHORT_PERP',
    positionMode: 'ONE_WAY',
    clientOrderIds,
    closeAttemptClientOrderIds: parseCloseAttemptIds(
      record.closeAttemptClientOrderIds,
      clientOrderIds,
    ),
    actionAuthority: 'NONE_RECORD_ONLY',
    riskAuthority: 'NONE',
    sendEligible: false,
  });
}

function parsePolicy(value: unknown): Readonly<BasisFlatnessVerifierPolicy> {
  const record = descriptorValues(
    value,
    ['maximumEvidenceAgeMs'],
    'policy',
  );
  const maximumEvidenceAgeMs = safeInteger(
    record.maximumEvidenceAgeMs,
    'policy_maximum_evidence_age_ms',
    1,
  );
  if (maximumEvidenceAgeMs > MAXIMUM_BASIS_FLATNESS_EVIDENCE_AGE_MS) {
    return problem('BLOCKED', 'POLICY_MAXIMUM_EVIDENCE_AGE_EXCEEDS_BOUND');
  }
  return Object.freeze({ maximumEvidenceAgeMs });
}

function parseMetadata(
  value: unknown,
  evaluatedAtMs: number,
  maximumEvidenceAgeMs: number,
  path: string,
): Readonly<BasisFlatnessSourceMetadata> {
  const record = descriptorValues(
    value,
    [
      'sourceId',
      'authority',
      'completeness',
      'sourceTimeMs',
      'receivedAtMs',
      'maxAgeMs',
    ],
    path,
  );
  if (
    record.authority !== 'RECORDED_REPLAY' &&
    record.authority !== 'SYNTHETIC_TEST'
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_REPLAY_OR_SYNTHETIC_REQUIRED`);
  }
  if (record.completeness !== 'COMPLETE') {
    return problem('UNKNOWN', `${path.toUpperCase()}_INCOMPLETE`);
  }
  const sourceTimeMs = safeInteger(
    record.sourceTimeMs,
    `${path}_source_time_ms`,
    0,
  );
  const receivedAtMs = safeInteger(
    record.receivedAtMs,
    `${path}_received_at_ms`,
    0,
  );
  const maxAgeMs = safeInteger(record.maxAgeMs, `${path}_max_age_ms`, 1);
  if (
    sourceTimeMs > receivedAtMs ||
    receivedAtMs > evaluatedAtMs ||
    sourceTimeMs > evaluatedAtMs
  ) {
    return problem('UNKNOWN', `${path.toUpperCase()}_CLOCK_SKEWED`);
  }
  if (
    evaluatedAtMs - sourceTimeMs >
    Math.min(maxAgeMs, maximumEvidenceAgeMs)
  ) {
    return problem('UNKNOWN', `${path.toUpperCase()}_STALE`);
  }
  return Object.freeze({
    sourceId: identifier(record.sourceId, `${path}_source_id`),
    authority: record.authority,
    completeness: 'COMPLETE',
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs,
  });
}

function identityMatches(
  record: Readonly<Record<string, unknown>>,
  plan: Readonly<BasisFlatnessPlanIdentity>,
): boolean {
  return (
    record.planId === plan.planId &&
    record.bindingId === plan.bindingId &&
    record.termsFingerprint === plan.termsFingerprint &&
    record.accountId === plan.accountId &&
    record.symbol === plan.symbol &&
    record.acceptedRevisionTs === plan.acceptedRevisionTs &&
    record.stateRevision === plan.stateRevision &&
    record.stateRevisionId === plan.stateRevisionId
  );
}

interface ParsedOrder {
  readonly step: BasisFlatnessStep;
  readonly attempt: number;
  readonly submittedQuantityExact: ExactDecimal;
  readonly cumulativeFilledQuantityExact: ExactDecimal;
  readonly terminalObservedAtMs: number;
}

function parseOrder(
  value: unknown,
  plan: Readonly<BasisFlatnessPlanIdentity>,
  index: number,
  nowMs: number,
): Readonly<ParsedOrder> {
  const path = `order_${index}`;
  const record = descriptorValues(
    value,
    [
      'step',
      'attempt',
      'planId',
      'bindingId',
      'termsFingerprint',
      'accountId',
      'symbol',
      'acceptedRevisionTs',
      'stateRevision',
      'stateRevisionId',
      'venue',
      'side',
      'reduceOnly',
      'clientOrderId',
      'status',
      'submittedQuantityExact',
      'cumulativeFilledQuantityExact',
      'ambiguous',
      'terminalObservedAtMs',
    ],
    path,
  );
  if (!(BASIS_FLATNESS_STEPS as readonly unknown[]).includes(record.step)) {
    return problem('BLOCKED', `${path.toUpperCase()}_STEP_INVALID`);
  }
  const step = record.step as BasisFlatnessStep;
  const attempt = safeInteger(record.attempt, `${path}_attempt`, 0);
  if (
    ((step === 'SPOT_OPEN' || step === 'PERP_OPEN') && attempt !== 0) ||
    ((step === 'PERP_CLOSE' || step === 'SPOT_CLOSE') &&
      attempt >= MAX_CLOSE_ATTEMPTS)
  ) {
    return problem('BLOCKED', `${step}_ATTEMPT_OUTSIDE_BOUND_PLAN`);
  }
  if (!identityMatches(record, plan)) {
    return problem('BLOCKED', `${step}_IDENTITY_CONFLICT`);
  }
  const expected = EXPECTED_ORDER_SHAPES[step];
  const expectedClientOrderId =
    step === 'SPOT_OPEN' || step === 'PERP_OPEN'
      ? plan.clientOrderIds[step]
      : plan.closeAttemptClientOrderIds[step][attempt];
  if (
    record.venue !== expected.venue ||
    record.side !== expected.side ||
    boolean(record.reduceOnly, `${path}_reduce_only`) !== expected.reduceOnly ||
    record.clientOrderId !== expectedClientOrderId
  ) {
    return problem('BLOCKED', `${step}_ORDER_IDENTITY_CONFLICT`);
  }
  if (record.ambiguous !== false) {
    return problem('UNKNOWN', `${step}_ORDER_AMBIGUOUS`);
  }
  if (
    typeof record.status !== 'string' ||
    !TERMINAL_ORDER_STATES.has(record.status)
  ) {
    return problem('UNKNOWN', `${step}_ORDER_NOT_TERMINAL`);
  }
  const submitted = exactDecimal(
    record.submittedQuantityExact,
    `${path}_submitted_quantity`,
    'POSITIVE',
  );
  const filled = exactDecimal(
    record.cumulativeFilledQuantityExact,
    `${path}_cumulative_filled_quantity`,
    'NON_NEGATIVE',
  );
  if (compareExactDecimals(filled, submitted) > 0) {
    return problem('BLOCKED', `${step}_FILL_EXCEEDS_SUBMITTED`);
  }
  const fillComparison = compareExactDecimals(filled, submitted);
  if (record.status === 'FILLED' && fillComparison !== 0) {
    return problem('BLOCKED', `${step}_FILLED_QUANTITY_CONFLICT`);
  }
  if (
    (record.status === 'CANCELLED' || record.status === 'EXPIRED') &&
    fillComparison >= 0
  ) {
    return problem('BLOCKED', `${step}_CANCELLED_OR_EXPIRED_REMAINDER_REQUIRED`);
  }
  if (
    (record.status === 'PROVEN_ABSENT' || record.status === 'REJECTED') &&
    !isExactZero(filled)
  ) {
    return problem('BLOCKED', `${step}_${record.status}_FILL_MUST_BE_ZERO`);
  }
  const terminalObservedAtMs = safeInteger(
    record.terminalObservedAtMs,
    `${path}_terminal_observed_at_ms`,
    0,
  );
  if (
    terminalObservedAtMs < plan.acceptedRevisionTs ||
    terminalObservedAtMs > nowMs
  ) {
    return problem('UNKNOWN', `${step}_TERMINAL_TIME_OUTSIDE_ACCEPTED_WINDOW`);
  }
  return Object.freeze({
    step,
    attempt,
    submittedQuantityExact: submitted,
    cumulativeFilledQuantityExact: filled,
    terminalObservedAtMs,
  });
}

interface ParsedPosition {
  readonly venue: BasisFlatnessPositionEvidence['venue'];
  readonly baseline: ExactDecimal;
  readonly current: ExactDecimal;
  readonly baselineAuthority: BasisFlatnessEvidenceAuthority;
  readonly currentAuthority: BasisFlatnessEvidenceAuthority;
}

function parsePosition(
  value: unknown,
  plan: Readonly<BasisFlatnessPlanIdentity>,
  nowMs: number,
  maximumEvidenceAgeMs: number,
  latestTerminalOrderAtMs: number,
  index: number,
): Readonly<ParsedPosition> {
  const path = `position_${index}`;
  const record = descriptorValues(
    value,
    [
      'venue',
      'accountId',
      'symbol',
      'acceptedRevisionTs',
      'stateRevision',
      'stateRevisionId',
      'positionMode',
      'baselineSignedBaseQuantityExact',
      'currentSignedBaseQuantityExact',
      'baselineMetadata',
      'currentMetadata',
    ],
    path,
  );
  if (
    record.accountId !== plan.accountId ||
    record.symbol !== plan.symbol ||
    record.acceptedRevisionTs !== plan.acceptedRevisionTs ||
    record.stateRevision !== plan.stateRevision ||
    record.stateRevisionId !== plan.stateRevisionId
  ) {
    return problem('BLOCKED', `${path.toUpperCase()}_IDENTITY_CONFLICT`);
  }
  if (record.venue !== 'BINANCE_SPOT' && record.venue !== 'BINANCE_USDM') {
    return problem('BLOCKED', `${path.toUpperCase()}_VENUE_INVALID`);
  }
  if (
    (record.venue === 'BINANCE_SPOT' && record.positionMode !== 'CASH') ||
    (record.venue === 'BINANCE_USDM' && record.positionMode !== 'ONE_WAY')
  ) {
    return problem(
      'UNKNOWN',
      record.venue === 'BINANCE_USDM'
        ? 'USDM_ONE_WAY_POSITION_MODE_UNPROVEN'
        : 'SPOT_POSITION_MODE_INVALID',
    );
  }
  const baselineMetadata = parseMetadata(
    record.baselineMetadata,
    plan.acceptedRevisionTs,
    maximumEvidenceAgeMs,
    `${path}_baseline_metadata`,
  );
  const currentMetadata = parseMetadata(
    record.currentMetadata,
    nowMs,
    maximumEvidenceAgeMs,
    `${path}_current_metadata`,
  );
  if (
    baselineMetadata.sourceTimeMs > plan.acceptedRevisionTs ||
    baselineMetadata.receivedAtMs > plan.acceptedRevisionTs
  ) {
    return problem('UNKNOWN', `${path.toUpperCase()}_BASELINE_AFTER_ACCEPTED_REVISION`);
  }
  if (
    currentMetadata.sourceTimeMs <
    Math.max(plan.acceptedRevisionTs, latestTerminalOrderAtMs)
  ) {
    return problem('UNKNOWN', `${path.toUpperCase()}_CURRENT_PRECEDES_TERMINAL_ORDER`);
  }
  return Object.freeze({
    venue: record.venue,
    baseline: exactDecimal(
      record.baselineSignedBaseQuantityExact,
      `${path}_baseline_signed_base_quantity`,
      'SIGNED',
    ),
    current: exactDecimal(
      record.currentSignedBaseQuantityExact,
      `${path}_current_signed_base_quantity`,
      'SIGNED',
    ),
    baselineAuthority: baselineMetadata.authority,
    currentAuthority: currentMetadata.authority,
  });
}

function identityProjection(
  plan: Readonly<BasisFlatnessPlanIdentity>,
): Readonly<BasisFlatnessIdentityProjection> {
  return Object.freeze({
    planId: plan.planId,
    bindingId: plan.bindingId,
    termsFingerprint: plan.termsFingerprint,
    accountId: plan.accountId,
    symbol: plan.symbol,
    acceptedRevisionTs: plan.acceptedRevisionTs,
    stateRevision: plan.stateRevision,
    stateRevisionId: plan.stateRevisionId,
    clientOrderIds: Object.freeze({ ...plan.clientOrderIds }),
    closeAttemptClientOrderIds: Object.freeze({
      PERP_CLOSE: Object.freeze([...plan.closeAttemptClientOrderIds.PERP_CLOSE]),
      SPOT_CLOSE: Object.freeze([...plan.closeAttemptClientOrderIds.SPOT_CLOSE]),
    }),
  });
}

function makeResult(
  status: BasisFlatnessStatus,
  identity: Readonly<BasisFlatnessIdentityProjection> | null,
  exact: Readonly<BasisFlatnessExactProjection> | null,
  evidenceAuthority: BasisFlatnessResult['evidenceAuthority'],
  reasonCodes: readonly string[],
): Readonly<BasisFlatnessResult> {
  const result = Object.freeze({
    schema: BASIS_FLATNESS_SCHEMA,
    version: BASIS_FLATNESS_VERSION,
    status,
    flat: status === 'FLAT',
    identity,
    exact,
    evidenceAuthority,
    reasonCodes: Object.freeze([...reasonCodes]),
    authority: 'NONE' as const,
    executionAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
    networkRequestsPerformed: 0 as const,
    privateRequestsPerformed: 0 as const,
    signedRequestsPerformed: 0 as const,
    ordersPerformed: 0 as const,
    sideEffectsPerformed: 0 as const,
  });
  RESULT_BRANDS.add(result);
  return result;
}

/**
 * Nominal guard for verifier-produced values. WeakSet membership does not
 * inspect caller-controlled properties and therefore does not trigger Proxy
 * traps or accessors.
 */
export function isBasisFlatnessResult(
  value: unknown,
): value is Readonly<BasisFlatnessResult> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    RESULT_BRANDS.has(value)
  );
}

/**
 * Reconcile exact order deltas and fresh baseline/current account positions.
 *
 * The function consumes frozen replay/synthetic plain data only. It performs
 * no query, request, signing, submission, cancellation, or other side effect.
 * Any unsafe/missing/stale/conflicting fact fails closed; flatness is never
 * inferred from the donor number/epsilon BASELINE seam.
 */
export function verifyBasisFlatness(
  input: unknown,
): Readonly<BasisFlatnessResult> {
  let plan: Readonly<BasisFlatnessPlanIdentity> | null = null;
  let identity: Readonly<BasisFlatnessIdentityProjection> | null = null;
  try {
    const root = descriptorValues(
      input,
      ['nowMs', 'policy', 'plan', 'evidence'],
      'input',
    );
    const nowMs = safeInteger(root.nowMs, 'now_ms', 0);
    const policy = parsePolicy(root.policy);
    plan = parsePlan(root.plan);
    identity = identityProjection(plan);

    const evidence = descriptorValues(
      root.evidence,
      ['orders', 'positions', 'ambiguities'],
      'evidence',
    );
    const ambiguityRecords = descriptorArray(
      evidence.ambiguities,
      'evidence_ambiguities',
      0,
      MAXIMUM_BASIS_FLATNESS_AMBIGUITIES,
    );
    if (ambiguityRecords.length !== 0) {
      return makeResult(
        'UNKNOWN',
        identity,
        null,
        'UNAVAILABLE',
        ['NORMALIZED_EVIDENCE_AMBIGUOUS'],
      );
    }

    const orderCollection = descriptorValues(
      evidence.orders,
      ['metadata', 'records'],
      'orders',
    );
    const orderMetadata = parseMetadata(
      orderCollection.metadata,
      nowMs,
      policy.maximumEvidenceAgeMs,
      'orders_metadata',
    );
    const orderRecords = descriptorArray(
      orderCollection.records,
      'orders_records',
      BASIS_FLATNESS_STEPS.length,
      2 + (MAX_CLOSE_ATTEMPTS * 2),
      'UNKNOWN',
    );
    const orders = orderRecords.map((record, index) =>
      parseOrder(
        record,
        plan as Readonly<BasisFlatnessPlanIdentity>,
        index,
        nowMs,
      ),
    );
    const latestTerminalOrderAtMs = orders.reduce(
      (latest, order) => Math.max(latest, order.terminalObservedAtMs),
      plan.acceptedRevisionTs,
    );
    if (orderMetadata.sourceTimeMs < latestTerminalOrderAtMs) {
      return makeResult(
        'UNKNOWN',
        identity,
        null,
        orderMetadata.authority,
        ['ORDER_SOURCE_PRECEDES_LATEST_TERMINAL_ORDER'],
      );
    }
    const byIdentity = new Map<string, Readonly<ParsedOrder>>();
    const byStep = new Map<BasisFlatnessStep, Readonly<ParsedOrder>[]>();
    let priorStepIndex = -1;
    let priorAttempt = -1;
    let priorTerminalObservedAtMs = plan.acceptedRevisionTs;
    for (const order of orders) {
      const identityKey = `${order.step}:${order.attempt}`;
      if (byIdentity.has(identityKey)) {
        return makeResult(
          'BLOCKED',
          identity,
          null,
          orderMetadata.authority,
          ['DUPLICATE_ORDER_ATTEMPT_CONFLICT'],
        );
      }
      byIdentity.set(identityKey, order);
      const stepIndex = BASIS_FLATNESS_STEPS.indexOf(order.step);
      if (
        stepIndex < priorStepIndex ||
        (stepIndex === priorStepIndex && order.attempt !== priorAttempt + 1) ||
        order.terminalObservedAtMs < priorTerminalObservedAtMs
      ) {
        return makeResult(
          'BLOCKED',
          identity,
          null,
          orderMetadata.authority,
          ['ORDER_ATTEMPTS_NOT_IN_BOUND_SEQUENCE'],
        );
      }
      priorStepIndex = stepIndex;
      priorAttempt = order.attempt;
      priorTerminalObservedAtMs = order.terminalObservedAtMs;
      const grouped = byStep.get(order.step) ?? [];
      grouped.push(order);
      byStep.set(order.step, grouped);
    }
    if (BASIS_FLATNESS_STEPS.some((step) => !byStep.has(step))) {
      return makeResult(
        'UNKNOWN',
        identity,
        null,
        orderMetadata.authority,
        ['FOUR_STEPS_AND_ALL_USED_CLOSE_ATTEMPTS_REQUIRED'],
      );
    }
    if (
      byStep.get('SPOT_OPEN')!.length !== 1 ||
      byStep.get('PERP_OPEN')!.length !== 1
    ) {
      return makeResult(
        'BLOCKED',
        identity,
        null,
        orderMetadata.authority,
        ['OPEN_STEPS_REQUIRE_EXACTLY_ATTEMPT_ZERO'],
      );
    }

    const closeTotal = (
      step: 'PERP_CLOSE' | 'SPOT_CLOSE',
      openStep: 'PERP_OPEN' | 'SPOT_OPEN',
    ): ExactDecimal => {
      const openFill = byStep.get(openStep)![0].cumulativeFilledQuantityExact;
      let residual = openFill;
      let total = normalizeExactDecimal('0');
      const attempts = byStep.get(step)!;
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        if (
          attempt.attempt !== index ||
          compareExactDecimals(attempt.submittedQuantityExact, residual) !== 0
        ) {
          return problem('BLOCKED', `${step}_RECLOSE_RESIDUAL_NOT_EXACT`);
        }
        total = addExactDecimals(
          total,
          attempt.cumulativeFilledQuantityExact,
        );
        residual = subtractExactDecimals(
          residual,
          attempt.cumulativeFilledQuantityExact,
        );
        if (compareExactDecimals(residual, normalizeExactDecimal('0')) < 0) {
          return problem('BLOCKED', `${step}_AGGREGATE_FILL_EXCEEDS_OPEN`);
        }
      }
      return total;
    };
    const perpCloseTotal = closeTotal('PERP_CLOSE', 'PERP_OPEN');
    const spotCloseTotal = closeTotal('SPOT_CLOSE', 'SPOT_OPEN');

    const positionRecords = descriptorArray(
      evidence.positions,
      'positions',
      2,
      2,
      'UNKNOWN',
    );
    const positions = positionRecords.map((record, index) =>
      parsePosition(
        record,
        plan as Readonly<BasisFlatnessPlanIdentity>,
        nowMs,
        policy.maximumEvidenceAgeMs,
        latestTerminalOrderAtMs,
        index,
      ),
    );
    const byVenue = new Map<
      BasisFlatnessPositionEvidence['venue'],
      Readonly<ParsedPosition>
    >();
    for (const position of positions) {
      if (byVenue.has(position.venue)) {
        return makeResult(
          'BLOCKED',
          identity,
          null,
          orderMetadata.authority,
          ['CONFLICTING_POSITION_EVIDENCE'],
        );
      }
      byVenue.set(position.venue, position);
    }
    const spotPosition = byVenue.get('BINANCE_SPOT');
    const usdmPosition = byVenue.get('BINANCE_USDM');
    if (spotPosition === undefined || usdmPosition === undefined) {
      return makeResult(
        'UNKNOWN',
        identity,
        null,
        orderMetadata.authority,
        ['SPOT_AND_USDM_POSITION_EVIDENCE_REQUIRED'],
      );
    }

    const spotOrderDelta = subtractExactDecimals(
      byStep.get('SPOT_OPEN')![0].cumulativeFilledQuantityExact,
      spotCloseTotal,
    );
    const usdmOrderDelta = addExactDecimals(
      negateExactDecimal(
        byStep.get('PERP_OPEN')![0].cumulativeFilledQuantityExact,
      ),
      perpCloseTotal,
    );
    const spotPositionDelta = subtractExactDecimals(
      spotPosition.current,
      spotPosition.baseline,
    );
    const usdmPositionDelta = subtractExactDecimals(
      usdmPosition.current,
      usdmPosition.baseline,
    );
    const spotDifference = subtractExactDecimals(
      spotPositionDelta,
      spotOrderDelta,
    );
    const usdmDifference = subtractExactDecimals(
      usdmPositionDelta,
      usdmOrderDelta,
    );
    const exact = Object.freeze({
      spotOrderDeltaExact: spotOrderDelta,
      usdmOrderDeltaExact: usdmOrderDelta,
      spotPositionDeltaExact: spotPositionDelta,
      usdmPositionDeltaExact: usdmPositionDelta,
      spotOrderPositionDifferenceExact: spotDifference,
      usdmOrderPositionDifferenceExact: usdmDifference,
    });
    const authorities = new Set<BasisFlatnessEvidenceAuthority>([
      orderMetadata.authority,
      spotPosition.baselineAuthority,
      spotPosition.currentAuthority,
      usdmPosition.baselineAuthority,
      usdmPosition.currentAuthority,
    ]);
    if (authorities.size !== 1) {
      return makeResult(
        'BLOCKED',
        identity,
        exact,
        'UNAVAILABLE',
        ['MIXED_EVIDENCE_AUTHORITY_REJECTED'],
      );
    }
    const evidenceAuthority = [...authorities][0];
    if (!isExactZero(spotDifference) || !isExactZero(usdmDifference)) {
      return makeResult(
        'BLOCKED',
        identity,
        exact,
        evidenceAuthority,
        ['ORDER_POSITION_EVIDENCE_CONFLICT'],
      );
    }
    if (
      !isExactZero(spotOrderDelta) ||
      !isExactZero(usdmOrderDelta) ||
      !isExactZero(spotPositionDelta) ||
      !isExactZero(usdmPositionDelta)
    ) {
      return makeResult(
        'NOT_FLAT',
        identity,
        exact,
        evidenceAuthority,
        ['EXACT_NON_ZERO_RESIDUAL'],
      );
    }
    return makeResult(
      'FLAT',
      identity,
      exact,
      evidenceAuthority,
      ['EXACT_BASELINE_FLAT'],
    );
  } catch (error) {
    if (error instanceof BasisFlatnessInputProblem) {
      return makeResult(
        error.status,
        identity,
        null,
        'UNAVAILABLE',
        [error.code],
      );
    }
    return makeResult(
      'BLOCKED',
      identity,
      null,
      'UNAVAILABLE',
      ['BASIS_FLATNESS_INPUT_REJECTED'],
    );
  }
}
