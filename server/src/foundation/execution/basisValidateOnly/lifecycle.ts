/**
 * Pure, process-local validate-only Basis lifecycle.
 *
 * This reducer consumes nominal outputs from the inert Spot/USD-M adapters,
 * records only canonical data, resolves ambiguous outcomes by the same client
 * identity, and requires a nominal reconciliation-owned flatness proof before
 * completion. It has no clock, transport, key, signer, ledger, retry timer, or
 * external-action port.
 */
import { isProxy } from 'node:util/types';

import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type NonNegativeDecimal,
} from '../../../capitalFoundation/contracts/index.js';
import {
  canonicalJson,
  deriveStateRevisionId,
  stableHash128Hex,
} from '../../contracts/index.js';
import {
  isBinanceSpotQueryResolution,
  isBinanceSpotValidateOnlyPreparation,
  normalizeBinanceSpotInjectedQueryEvidence,
  prepareBinanceSpotValidateOnlyOrder,
  type BinanceSpotQueryResolution,
  type BinanceSpotValidateOnlyPreparation,
} from '../../exchange/binanceSpotValidateOnlyAdapter/index.js';
import {
  createBinanceUsdMBasisValidateOnlyAdapter,
  isBinanceUsdMBasisIntentResult,
  isBinanceUsdMBasisQueryDescriptorResult,
  isBinanceUsdMBasisQueryResolution,
  type BinanceUsdMBasisIntentResult,
  type BinanceUsdMBasisQueryResolution,
} from '../../exchange/binanceUsdMAdapter/index.js';
import {
  isBasisFlatnessResult,
  verifyBasisFlatness,
  type BasisFlatnessResult,
  type BasisFlatnessVerificationInput,
} from '../../reconciliation/basisFlatness.js';
import {
  isBasisValidateOnlyPlanBinding,
  type BasisValidateOnlyPlanBinding,
} from './planBinding.js';

export const BASIS_VALIDATE_ONLY_LIFECYCLE_SCHEMA =
  'cosmos.foundation.execution.basisValidateOnlyLifecycle' as const;
export const BASIS_VALIDATE_ONLY_LIFECYCLE_VERSION = 1 as const;
export const BASIS_VALIDATE_ONLY_CHECKPOINT_SCHEMA =
  'cosmos.foundation.execution.basisValidateOnlyCheckpoint' as const;
export const BASIS_VALIDATE_ONLY_CHECKPOINT_VERSION = 1 as const;
export const BASIS_VALIDATE_ONLY_MAX_JOURNAL_ENTRIES = 128;
export const BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES = 512 * 1_024;
export const BASIS_VALIDATE_ONLY_MAX_JOURNAL_BYTES = 384 * 1_024;

export const BASIS_VALIDATE_ONLY_STEPS = Object.freeze([
  'SPOT_OPEN',
  'PERP_OPEN',
  'PERP_CLOSE',
  'SPOT_CLOSE',
] as const);
export type BasisValidateOnlyStep =
  (typeof BASIS_VALIDATE_ONLY_STEPS)[number];
export type BasisValidateOnlyNext =
  | BasisValidateOnlyStep
  | 'FLATNESS'
  | 'COMPLETE';

export type BasisValidateOnlyDisposition =
  | 'VALIDATION_REQUIRED'
  | 'OUTCOME_RECORD_REQUIRED'
  | 'QUERY_REQUIRED'
  | 'AWAIT_TERMINAL'
  | 'RECOVERY_BLOCKED'
  | 'ATTEMPT_BUDGET_EXHAUSTED'
  | 'FLATNESS_REQUIRED'
  | 'COMPLETE';

export interface BasisValidateOnlyAction {
  readonly disposition: BasisValidateOnlyDisposition;
  readonly step: BasisValidateOnlyStep | null;
  readonly attempt: number | null;
  readonly clientOrderId: string | null;
  readonly quantityExact: string | null;
  readonly blockerCode: string | null;
  readonly sendEligible: false;
  readonly sendAuthorized: false;
  readonly authority: 'NONE';
}

export type BasisValidateOnlyTerminalStatus =
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'PROVEN_ABSENT';

export interface BasisValidateOnlyValidationJournalEntry {
  readonly kind: 'VALIDATION';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly quantityExact: string;
  readonly adapter: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly evidenceId: string;
  /** Bounded canonical inputs used to deterministically rerun the inert adapter. */
  readonly adapterInvocation: unknown;
}

export interface BasisValidateOnlyOutcomeJournalEntry {
  readonly kind: 'OUTCOME';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly state: 'WORKING' | 'AMBIGUOUS' | 'TERMINAL';
  readonly terminalStatus: BasisValidateOnlyTerminalStatus | null;
  readonly cumulativeFilledQuantityExact: string | null;
  readonly evidenceAuthority: 'SYNTHETIC_TEST' | 'RECORDED_REPLAY';
}

export interface BasisValidateOnlyQueryJournalEntry {
  readonly kind: 'QUERY';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly state: 'WORKING' | 'TERMINAL' | 'UNRESOLVED';
  readonly terminalStatus: BasisValidateOnlyTerminalStatus | null;
  readonly cumulativeFilledQuantityExact: string | null;
  readonly evidenceAuthority:
    | 'SYNTHETIC_TEST'
    | 'RECORDED_REPLAY'
    | 'UNKNOWN';
  /** Bounded canonical inputs used to deterministically rerun query recovery. */
  readonly queryInvocation: unknown;
}

export interface BasisValidateOnlyFlatnessJournalEntry {
  readonly kind: 'FLATNESS';
  readonly input: Readonly<BasisFlatnessVerificationInput>;
  readonly proofId: string;
}

export type BasisValidateOnlyJournalEntry =
  | BasisValidateOnlyValidationJournalEntry
  | BasisValidateOnlyOutcomeJournalEntry
  | BasisValidateOnlyQueryJournalEntry
  | BasisValidateOnlyFlatnessJournalEntry;

export interface BasisValidateOnlyLifecycleState {
  readonly schema: typeof BASIS_VALIDATE_ONLY_LIFECYCLE_SCHEMA;
  readonly version: typeof BASIS_VALIDATE_ONLY_LIFECYCLE_VERSION;
  readonly bindingId: string;
  readonly planId: string;
  readonly revision: number;
  readonly stateRevisionId: string;
  readonly journal: readonly Readonly<BasisValidateOnlyJournalEntry>[];
  readonly next: BasisValidateOnlyNext;
  readonly attempt: number | null;
  readonly expectedQuantityExact: string | null;
  readonly terminalFilledExact: Readonly<
    Record<BasisValidateOnlyStep, string | null>
  >;
  readonly activeClientOrderId: string | null;
  readonly validationEvidenceId: string | null;
  readonly action: Readonly<BasisValidateOnlyAction>;
  readonly flatnessProofId: string | null;
  readonly complete: boolean;
  readonly deliveryGuarantee:
    'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS';
  readonly executionAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly sendEligible: false;
  readonly sendsPerformed: 0;
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export interface BasisValidateOnlyValidationObservation {
  readonly kind: 'VALIDATION';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  /** Nominal preparation/result returned by the matching inert adapter. */
  readonly adapterResult: unknown;
  /** Exact inert adapter configuration and injected input used for the result. */
  readonly adapterInvocation: unknown;
}

export interface BasisValidateOnlyOutcomeObservation {
  readonly kind: 'OUTCOME';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly state: 'WORKING' | 'AMBIGUOUS' | 'TERMINAL';
  readonly terminalStatus: BasisValidateOnlyTerminalStatus | null;
  readonly cumulativeFilledQuantityExact: string | null;
  readonly evidenceAuthority: 'SYNTHETIC_TEST' | 'RECORDED_REPLAY';
}

export interface BasisValidateOnlyQueryObservation {
  readonly kind: 'QUERY';
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  /** The nominal preparation/result that fixed the immutable order identity. */
  readonly adapterResult: unknown;
  /**
   * Nominal USD-M query descriptor result for the same immutable identity.
   * Spot preparations already contain their nominal query descriptor, so Spot
   * observations must set this field to null.
   */
  readonly queryDescriptorResult: unknown;
  /** The nominal query resolution returned by that adapter. */
  readonly queryResolution: unknown;
  /** Exact inert adapter configuration, validation input, and query evidence. */
  readonly queryInvocation: unknown;
}

export interface BasisValidateOnlyFlatnessObservation {
  readonly kind: 'FLATNESS';
  readonly input: unknown;
  readonly result: unknown;
}

export type BasisValidateOnlyObservation =
  | BasisValidateOnlyValidationObservation
  | BasisValidateOnlyOutcomeObservation
  | BasisValidateOnlyQueryObservation
  | BasisValidateOnlyFlatnessObservation;

export type BasisValidateOnlyApplyCode =
  | 'BINDING_INVALID'
  | 'STATE_INVALID'
  | 'OBSERVATION_INVALID'
  | 'JOURNAL_FULL'
  | 'UNEXPECTED_EVENT'
  | 'IDENTITY_MISMATCH'
  | 'QUANTITY_INVALID'
  | 'TERMINAL_STATUS_INCOHERENT'
  | 'FLATNESS_INVALID';

export type BasisValidateOnlyApplyResult =
  | {
      readonly applied: true;
      readonly state: Readonly<BasisValidateOnlyLifecycleState>;
    }
  | {
      readonly applied: false;
      readonly code: BasisValidateOnlyApplyCode;
      readonly state: Readonly<BasisValidateOnlyLifecycleState> | null;
    };

export type BasisValidateOnlyReplayResult =
  | {
      readonly ok: true;
      readonly state: Readonly<BasisValidateOnlyLifecycleState>;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<
        BasisValidateOnlyApplyCode,
        'STATE_INVALID' | 'OBSERVATION_INVALID'
      >;
    };

export type BasisValidateOnlyRestoreResult =
  | {
      readonly ok: true;
      readonly state: Readonly<BasisValidateOnlyLifecycleState>;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'BINDING_INVALID'
        | 'CHECKPOINT_INVALID'
        | 'CHECKSUM_MISMATCH'
        | 'REPLAY_MISMATCH';
    };

const STATE_BRANDS = new WeakSet<object>();
const STEP_SET = new Set<string>(BASIS_VALIDATE_ONLY_STEPS);
const TERMINAL_STATUS_SET = new Set<string>([
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'PROVEN_ABSENT',
]);
const OUTCOME_AUTHORITY_SET = new Set<string>([
  'SYNTHETIC_TEST',
  'RECORDED_REPLAY',
]);

interface MutableProjection {
  next: BasisValidateOnlyNext;
  attempt: number | null;
  expectedQuantityExact: NonNegativeDecimal | null;
  terminalFilledExact: Record<BasisValidateOnlyStep, NonNegativeDecimal | null>;
  activeClientOrderId: string | null;
  validationEvidenceId: string | null;
  disposition: BasisValidateOnlyDisposition;
  blockerCode: string | null;
  flatnessProofId: string | null;
  complete: boolean;
}

class LifecycleProblem extends Error {
  constructor(readonly code: BasisValidateOnlyApplyCode) {
    super(code);
  }
}

function problem(code: BasisValidateOnlyApplyCode): never {
  throw new LifecycleProblem(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isProxy(value) &&
    !Array.isArray(value)
  );
}

function rawRecord(
  value: unknown,
  exactKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  // Protocol records are their JSON-visible own enumerable string projection.
  // Hidden and symbol metadata is neither enumerated nor retained.
  if (!isRecord(value)) return problem('OBSERVATION_INVALID');
  let prototype: object | null;
  let enumerableOwnKeyCount = 0;
  try {
    prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return problem('OBSERVATION_INVALID');
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      enumerableOwnKeyCount += 1;
      if (
        enumerableOwnKeyCount > exactKeys.length ||
        !exactKeys.includes(key)
      ) {
        return problem('OBSERVATION_INVALID');
      }
    }
  } catch {
    return problem('OBSERVATION_INVALID');
  }
  if (enumerableOwnKeyCount !== exactKeys.length) {
    return problem('OBSERVATION_INVALID');
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of exactKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return problem('OBSERVATION_INVALID');
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor.enumerable !== true
    ) {
      return problem('OBSERVATION_INVALID');
    }
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(output);
}

function canonicalNonNegative(value: unknown): NonNegativeDecimal | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    return normalized === value ? normalized : null;
  } catch {
    return null;
  }
}

function canonicalPositive(value: unknown): NonNegativeDecimal | null {
  const normalized = canonicalNonNegative(value);
  return normalized !== null &&
    compareExactDecimals(normalized, normalizeNonNegativeExactDecimal('0')) > 0
    ? normalized
    : null;
}

function safeAttempt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) < 4;
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  );
}

function withinBindingWindow(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  value: unknown,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= binding.acceptedRevisionTs &&
    (value as number) <= binding.proposalExpiresAtMs
  );
}

function afterAcceptedRevision(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  value: unknown,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= binding.acceptedRevisionTs
  );
}

function validationTimeAllowed(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  step: BasisValidateOnlyStep,
  value: unknown,
): value is number {
  return step === 'SPOT_OPEN' || step === 'PERP_OPEN'
    ? withinBindingWindow(binding, value)
    : afterAcceptedRevision(binding, value);
}

function expectedClientOrderId(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  step: BasisValidateOnlyStep,
  attempt: number,
): string {
  const normal = binding.plan.normalBasisBinding;
  if (normal === undefined) return problem('BINDING_INVALID');
  if (step === 'SPOT_OPEN' || step === 'PERP_OPEN') {
    if (attempt !== 0) return problem('IDENTITY_MISMATCH');
    return normal.steps[step].clientOrderId;
  }
  const found = normal.closeAttempts.find(
    (candidate) =>
      candidate.step === step && candidate.attempt === attempt,
  );
  if (found === undefined) return problem('IDENTITY_MISMATCH');
  return found.clientOrderId;
}

function expectedLegId(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  step: BasisValidateOnlyStep,
): string {
  if (step === 'SPOT_OPEN') return binding.plan.openingLegs.SPOT.legId;
  if (step === 'PERP_OPEN') return binding.plan.openingLegs.PERP.legId;
  if (step === 'PERP_CLOSE') return binding.plan.closingLegs.PERP.legId;
  return binding.plan.closingLegs.SPOT.legId;
}

function actionFor(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  projection: MutableProjection,
): Readonly<BasisValidateOnlyAction> {
  const actionableStep =
    projection.next === 'FLATNESS' || projection.next === 'COMPLETE'
      ? null
      : projection.next;
  const clientOrderId =
    projection.activeClientOrderId ??
    (actionableStep !== null && projection.attempt !== null
      ? expectedClientOrderId(binding, actionableStep, projection.attempt)
      : null);
  return Object.freeze({
    disposition: projection.disposition,
    step: actionableStep,
    attempt: actionableStep === null ? null : projection.attempt,
    clientOrderId,
    quantityExact:
      actionableStep === null ? null : projection.expectedQuantityExact,
    blockerCode: projection.blockerCode,
    sendEligible: false as const,
    sendAuthorized: false as const,
    authority: 'NONE' as const,
  });
}

function freezeState(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  journal: readonly Readonly<BasisValidateOnlyJournalEntry>[],
  projection: MutableProjection,
): Readonly<BasisValidateOnlyLifecycleState> {
  const revision = journal.length;
  const state = Object.freeze({
    schema: BASIS_VALIDATE_ONLY_LIFECYCLE_SCHEMA,
    version: BASIS_VALIDATE_ONLY_LIFECYCLE_VERSION,
    bindingId: binding.bindingId,
    planId: binding.plan.planId,
    revision,
    stateRevisionId: deriveStateRevisionId({
      scope: `execution:${binding.plan.planId}`,
      revision,
    }),
    journal: Object.freeze([...journal]),
    next: projection.next,
    attempt: projection.attempt,
    expectedQuantityExact: projection.expectedQuantityExact,
    terminalFilledExact: Object.freeze({
      ...projection.terminalFilledExact,
    }),
    activeClientOrderId: projection.activeClientOrderId,
    validationEvidenceId: projection.validationEvidenceId,
    action: actionFor(binding, projection),
    flatnessProofId: projection.flatnessProofId,
    complete: projection.complete,
    deliveryGuarantee:
      'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS' as const,
    executionAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
    sendEligible: false as const,
    sendsPerformed: 0 as const,
    networkRequestsPerformed: 0 as const,
    privateRequestsPerformed: 0 as const,
    signedRequestsPerformed: 0 as const,
    ordersPerformed: 0 as const,
    sideEffectsPerformed: 0 as const,
  });
  STATE_BRANDS.add(state);
  return state;
}

function initialProjection(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
): MutableProjection {
  return {
    next: 'SPOT_OPEN',
    attempt: 0,
    expectedQuantityExact: binding.spotQuantityExact,
    terminalFilledExact: {
      SPOT_OPEN: null,
      PERP_OPEN: null,
      PERP_CLOSE: null,
      SPOT_CLOSE: null,
    },
    activeClientOrderId: null,
    validationEvidenceId: null,
    disposition: 'VALIDATION_REQUIRED',
    blockerCode: null,
    flatnessProofId: null,
    complete: false,
  };
}

function validateEventIdentity(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  projection: MutableProjection,
  event: Pick<
    BasisValidateOnlyValidationJournalEntry,
    'step' | 'attempt' | 'clientOrderId' | 'quantityExact'
  >,
): void {
  if (
    projection.next !== event.step ||
    projection.attempt !== event.attempt ||
    projection.expectedQuantityExact !== event.quantityExact ||
    expectedClientOrderId(binding, event.step, event.attempt) !==
      event.clientOrderId
  ) {
    return problem('IDENTITY_MISMATCH');
  }
}

function terminalStatusCoherent(
  status: BasisValidateOnlyTerminalStatus,
  submitted: NonNegativeDecimal,
  filled: NonNegativeDecimal,
): boolean {
  const versusZero = compareExactDecimals(
    filled,
    normalizeNonNegativeExactDecimal('0'),
  );
  const versusSubmitted = compareExactDecimals(filled, submitted);
  return (
    (status === 'FILLED' && versusSubmitted === 0) ||
    ((status === 'REJECTED' || status === 'PROVEN_ABSENT') &&
      versusZero === 0) ||
    ((status === 'CANCELLED' || status === 'EXPIRED') &&
      versusZero >= 0 &&
      versusSubmitted < 0)
  );
}

function exactResidual(
  total: NonNegativeDecimal,
  closed: NonNegativeDecimal,
): NonNegativeDecimal {
  if (compareExactDecimals(closed, total) > 0) {
    return problem('QUANTITY_INVALID');
  }
  return normalizeNonNegativeExactDecimal(subtractExactDecimals(total, closed));
}

function scaledPerpQuantityForSpotFill(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  spotFilled: NonNegativeDecimal,
): NonNegativeDecimal | null {
  try {
    const numerator = multiplyExactDecimals(
      binding.perpQuantityExact,
      spotFilled,
    );
    const quotient = normalizeNonNegativeExactDecimal(
      divideExactDecimals(
        numerator,
        binding.spotQuantityExact,
        24,
      ),
    );
    return compareExactDecimals(
      multiplyExactDecimals(quotient, binding.spotQuantityExact),
      numerator,
    ) === 0
      ? quotient
      : null;
  } catch {
    return null;
  }
}

function advanceTerminal(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  projection: MutableProjection,
  step: BasisValidateOnlyStep,
  attempt: number,
  status: BasisValidateOnlyTerminalStatus,
  filled: NonNegativeDecimal,
): void {
  if (
    projection.next !== step ||
    projection.attempt !== attempt ||
    projection.expectedQuantityExact === null
  ) {
    return problem('UNEXPECTED_EVENT');
  }
  if (!terminalStatusCoherent(status, projection.expectedQuantityExact, filled)) {
    return problem('TERMINAL_STATUS_INCOHERENT');
  }
  projection.activeClientOrderId = null;
  projection.validationEvidenceId = null;
  projection.blockerCode = null;

  if (step === 'SPOT_OPEN') {
    projection.terminalFilledExact.SPOT_OPEN = filled;
    if (canonicalPositive(filled) === null) {
      projection.next = 'FLATNESS';
      projection.attempt = null;
      projection.expectedQuantityExact = null;
      projection.disposition = 'FLATNESS_REQUIRED';
      projection.blockerCode = 'SPOT_OPEN_ZERO_FILL_BASELINE_RECONCILIATION';
      return;
    }
    const scaledPerp = scaledPerpQuantityForSpotFill(binding, filled);
    if (scaledPerp === null || canonicalPositive(scaledPerp) === null) {
      projection.next = 'PERP_OPEN';
      projection.attempt = null;
      projection.expectedQuantityExact = null;
      projection.disposition = 'RECOVERY_BLOCKED';
      projection.blockerCode = 'PERP_RATIO_NOT_EXACTLY_REPRESENTABLE';
      return;
    }
    projection.next = 'PERP_OPEN';
    projection.attempt = 0;
    projection.expectedQuantityExact = scaledPerp;
    projection.disposition = 'VALIDATION_REQUIRED';
    return;
  }

  if (step === 'PERP_OPEN') {
    projection.terminalFilledExact.PERP_OPEN = filled;
    if (canonicalPositive(filled) === null) {
      const spotOpened = projection.terminalFilledExact.SPOT_OPEN;
      if (spotOpened === null || canonicalPositive(spotOpened) === null) {
        return problem('UNEXPECTED_EVENT');
      }
      projection.next = 'SPOT_CLOSE';
      projection.attempt = 0;
      projection.expectedQuantityExact = spotOpened;
      projection.disposition = 'VALIDATION_REQUIRED';
      projection.blockerCode = 'PERP_OPEN_ZERO_FILL_SPOT_UNWIND_REQUIRED';
      return;
    }
    projection.next = 'PERP_CLOSE';
    projection.attempt = 0;
    projection.expectedQuantityExact = filled;
    projection.disposition = 'VALIDATION_REQUIRED';
    return;
  }

  const previous =
    projection.terminalFilledExact[step] ??
    normalizeNonNegativeExactDecimal('0');
  const totalClosed = normalizeNonNegativeExactDecimal(
    addExactDecimals(previous, filled),
  );
  projection.terminalFilledExact[step] = totalClosed;
  const totalToClose =
    step === 'PERP_CLOSE'
      ? projection.terminalFilledExact.PERP_OPEN
      : projection.terminalFilledExact.SPOT_OPEN;
  if (totalToClose === null) return problem('UNEXPECTED_EVENT');
  const residual = exactResidual(totalToClose, totalClosed);
  if (compareExactDecimals(residual, normalizeNonNegativeExactDecimal('0')) > 0) {
    if (attempt + 1 >= 4) {
      projection.attempt = null;
      projection.expectedQuantityExact = residual;
      projection.disposition = 'ATTEMPT_BUDGET_EXHAUSTED';
      projection.blockerCode = `${step}_ATTEMPT_BUDGET_EXHAUSTED`;
      return;
    }
    projection.attempt = attempt + 1;
    projection.expectedQuantityExact = residual;
    projection.disposition = 'VALIDATION_REQUIRED';
    return;
  }

  if (step === 'PERP_CLOSE') {
    const spotOpened = projection.terminalFilledExact.SPOT_OPEN;
    if (spotOpened === null || canonicalPositive(spotOpened) === null) {
      return problem('UNEXPECTED_EVENT');
    }
    projection.next = 'SPOT_CLOSE';
    projection.attempt = 0;
    projection.expectedQuantityExact = spotOpened;
    projection.disposition = 'VALIDATION_REQUIRED';
    return;
  }

  projection.next = 'FLATNESS';
  projection.attempt = null;
  projection.expectedQuantityExact = null;
  projection.disposition = 'FLATNESS_REQUIRED';
}

function applyNormalizedEvent(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  projection: MutableProjection,
  event: Readonly<BasisValidateOnlyJournalEntry>,
  revisionBeforeEvent: number,
  journalBeforeEvent: readonly Readonly<BasisValidateOnlyJournalEntry>[],
): void {
  if (projection.complete) return problem('UNEXPECTED_EVENT');
  if (event.kind === 'VALIDATION') {
    if (projection.disposition !== 'VALIDATION_REQUIRED') {
      return problem('UNEXPECTED_EVENT');
    }
    const reproduced = reproduceValidationInvocation(
      event.adapterInvocation,
    );
    const expected = normalizeValidationObservation(
      binding,
      projection,
      Object.freeze({
        step: event.step,
        attempt: event.attempt,
        adapterResult: reproduced.result,
        adapterInvocation: reproduced.invocation,
      }),
    );
    if (canonicalJson(expected) !== canonicalJson(event)) {
      return problem('OBSERVATION_INVALID');
    }
    validateEventIdentity(binding, projection, event);
    projection.activeClientOrderId = event.clientOrderId;
    projection.validationEvidenceId = event.evidenceId;
    projection.disposition = 'OUTCOME_RECORD_REQUIRED';
    projection.blockerCode = null;
    return;
  }

  if (event.kind === 'OUTCOME') {
    if (
      projection.next !== event.step ||
      projection.attempt !== event.attempt ||
      projection.activeClientOrderId !== event.clientOrderId ||
      (projection.disposition !== 'OUTCOME_RECORD_REQUIRED' &&
        projection.disposition !== 'AWAIT_TERMINAL')
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    if (event.state === 'WORKING') {
      projection.disposition = 'AWAIT_TERMINAL';
      return;
    }
    if (event.state === 'AMBIGUOUS') {
      projection.disposition = 'QUERY_REQUIRED';
      return;
    }
    if (
      event.terminalStatus === null ||
      event.cumulativeFilledQuantityExact === null
    ) {
      return problem('OBSERVATION_INVALID');
    }
    advanceTerminal(
      binding,
      projection,
      event.step,
      event.attempt,
      event.terminalStatus,
      event.cumulativeFilledQuantityExact as NonNegativeDecimal,
    );
    return;
  }

  if (event.kind === 'QUERY') {
    if (
      projection.next !== event.step ||
      projection.attempt !== event.attempt ||
      projection.activeClientOrderId !== event.clientOrderId ||
      (projection.disposition !== 'QUERY_REQUIRED' &&
        projection.disposition !== 'RECOVERY_BLOCKED' &&
        projection.disposition !== 'AWAIT_TERMINAL')
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    const reproduced = reproduceQueryInvocation(event.queryInvocation);
    const expected = normalizeQueryObservation(
      binding,
      projection,
      Object.freeze({
        step: event.step,
        attempt: event.attempt,
        clientOrderId: event.clientOrderId,
        adapterResult: reproduced.adapterResult,
        queryDescriptorResult: reproduced.queryDescriptorResult,
        queryResolution: reproduced.queryResolution,
        queryInvocation: reproduced.invocation,
      }),
    );
    if (canonicalJson(expected) !== canonicalJson(event)) {
      return problem('OBSERVATION_INVALID');
    }
    if (event.state === 'UNRESOLVED') {
      projection.disposition = 'RECOVERY_BLOCKED';
      projection.blockerCode = 'SAME_ID_QUERY_UNRESOLVED';
      return;
    }
    if (event.state === 'WORKING') {
      projection.disposition = 'AWAIT_TERMINAL';
      projection.blockerCode = null;
      return;
    }
    if (
      event.terminalStatus === null ||
      event.cumulativeFilledQuantityExact === null
    ) {
      return problem('OBSERVATION_INVALID');
    }
    advanceTerminal(
      binding,
      projection,
      event.step,
      event.attempt,
      event.terminalStatus,
      event.cumulativeFilledQuantityExact as NonNegativeDecimal,
    );
    return;
  }

  if (
    projection.next !== 'FLATNESS' ||
    projection.disposition !== 'FLATNESS_REQUIRED'
  ) {
    return problem('UNEXPECTED_EVENT');
  }
  const verified = verifyBasisFlatness(event.input);
  if (
    !isBasisFlatnessResult(verified) ||
    verified.status !== 'FLAT' ||
    verified.flat !== true ||
    verified.identity === null ||
    verified.identity.planId !== binding.plan.planId ||
    verified.identity.bindingId !== binding.bindingId ||
    verified.identity.termsFingerprint !== binding.plan.termsFingerprint ||
    verified.identity.accountId !== binding.accountId ||
    verified.identity.symbol !== binding.symbol ||
    verified.identity.acceptedRevisionTs !== binding.acceptedRevisionTs ||
    verified.identity.stateRevision !== revisionBeforeEvent ||
    verified.identity.stateRevisionId !==
      deriveStateRevisionId({
        scope: `execution:${binding.plan.planId}`,
        revision: revisionBeforeEvent,
      }) ||
    !flatnessOrdersMatchJournal(event.input, journalBeforeEvent) ||
    event.proofId !== flatnessProofId(verified)
  ) {
    return problem('FLATNESS_INVALID');
  }
  projection.next = 'COMPLETE';
  projection.attempt = null;
  projection.expectedQuantityExact = null;
  projection.activeClientOrderId = null;
  projection.validationEvidenceId = null;
  projection.disposition = 'COMPLETE';
  projection.blockerCode = null;
  projection.flatnessProofId = event.proofId;
  projection.complete = true;
}

function flatnessProofId(result: Readonly<BasisFlatnessResult>): string {
  return `bflat_${stableHash128Hex(
    `basisValidateOnlyFlatness|${canonicalJson(result)}`,
  )}`;
}

function canonicalFrozenClone<T>(
  value: T,
  failureCode: BasisValidateOnlyApplyCode = 'FLATNESS_INVALID',
): Readonly<T> {
  // Snapshot only the JSON-visible protocol surface so an attacker cannot make
  // validation allocate an unbounded non-enumerable or symbol key vector.
  const budget = { nodes: 0, serializedCharUpperBound: 0 };
  const consumeJsonText = (text: string): void => {
    const remaining =
      BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES -
      budget.serializedCharUpperBound -
      2;
    if (remaining < 0 || text.length > Math.floor(remaining / 6)) {
      return problem(failureCode);
    }
    // A JSON string uses at most six characters per UTF-16 code unit, plus
    // quotes. This intentionally conservative bound avoids serializing first.
    budget.serializedCharUpperBound += text.length * 6 + 2;
  };
  const snapshot = (candidate: unknown, depth: number): unknown => {
    budget.nodes += 1;
    budget.serializedCharUpperBound += 8;
    if (
      budget.nodes > 4_096 ||
      depth > 32 ||
      budget.serializedCharUpperBound >
        BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES
    ) {
      return problem(failureCode);
    }
    if (
      candidate === null ||
      typeof candidate === 'boolean'
    ) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      consumeJsonText(candidate);
      return candidate;
    }
    if (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      !Object.is(candidate, -0)
    ) {
      return candidate;
    }
    if (
      typeof candidate !== 'object' ||
      isProxy(candidate)
    ) {
      return problem(failureCode);
    }
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(candidate);
    } catch {
      return problem(failureCode);
    }
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype) {
        return problem(failureCode);
      }
      const lengthDescriptor =
        Object.getOwnPropertyDescriptor(candidate, 'length');
      if (
        lengthDescriptor === undefined ||
        !Object.hasOwn(lengthDescriptor, 'value') ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 128 ||
        Object.getOwnPropertyDescriptor(candidate, Symbol.iterator) !==
          undefined
      ) {
        return problem(failureCode);
      }
      let enumerableOwnKeyCount = 0;
      for (const key in candidate) {
        if (!Object.hasOwn(candidate, key)) continue;
        enumerableOwnKeyCount += 1;
        if (
          enumerableOwnKeyCount > lengthDescriptor.value ||
          !/^(?:0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= lengthDescriptor.value
        ) {
          return problem(failureCode);
        }
      }
      if (enumerableOwnKeyCount !== lengthDescriptor.value) {
        return problem(failureCode);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          candidate,
          String(index),
        );
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, 'value') ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        ) {
          return problem(failureCode);
        }
        output.push(snapshot(descriptor.value, depth + 1));
      }
      return Object.freeze(output);
    }
    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return problem(failureCode);
    }
    const output = Object.create(null) as Record<string, unknown>;
    let enumerableOwnKeyCount = 0;
    for (const key in candidate) {
      if (!Object.hasOwn(candidate, key)) continue;
      enumerableOwnKeyCount += 1;
      if (enumerableOwnKeyCount > 128) {
        return problem(failureCode);
      }
      consumeJsonText(key);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.enumerable !== true
      ) {
        return problem(failureCode);
      }
      Object.defineProperty(output, key, {
        value: snapshot(descriptor.value, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  };
  const copied = snapshot(value, 0) as T;
  const bytes = canonicalJson(copied);
  if (bytes.length > BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES) {
    return problem(failureCode);
  }
  return copied as Readonly<T>;
}

interface ReproducedValidation {
  readonly adapter: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly invocation: Readonly<unknown>;
  readonly result: unknown;
  readonly evaluatedAtMs: unknown;
}

interface ReproducedQuery {
  readonly adapter: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly invocation: Readonly<unknown>;
  readonly adapterResult: unknown;
  readonly queryDescriptorResult: unknown;
  readonly queryResolution: unknown;
}

const FORBIDDEN_INVOCATION_KEY_FRAGMENTS = Object.freeze([
  'apikey',
  'secret',
  'token',
  'signature',
  'credential',
  'password',
  'cookie',
  'authorization',
  'passphrase',
  'listenkey',
]);

function assertSecretFreeInvocation(value: unknown): void {
  if (typeof value === 'string') {
    if (
      value === 'LIVE_PRIVATE' ||
      /BEGIN (?:RSA )?PRIVATE KEY|x-mbx-apikey|authorization\s*:/i.test(
        value,
      )
    ) {
      return problem('OBSERVATION_INVALID');
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSecretFreeInvocation(item);
    return;
  }
  for (const [key, item] of Object.entries(
    value as Readonly<Record<string, unknown>>,
  )) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      !(
        key === 'externalActionAuthorization' &&
        item === 'NONE'
      ) &&
      FORBIDDEN_INVOCATION_KEY_FRAGMENTS.some(
        (fragment) => normalizedKey.includes(fragment),
      )
    ) {
      return problem('OBSERVATION_INVALID');
    }
    assertSecretFreeInvocation(item);
  }
}

function exactUsdMConfig(value: unknown): Readonly<Record<string, unknown>> {
  return rawRecord(value, [
    'enabled',
    'sourceEnabled',
    'killSwitchEngaged',
    'authority',
    'allowedSymbols',
  ]);
}

function exactUsdMValidationInput(
  value: unknown,
): Readonly<Record<string, unknown>> {
  return rawRecord(value, [
    'nowMs',
    'leg',
    'symbol',
    'existingClientOrderId',
    'type',
    'quantity',
    'price',
    'positionModeEvidence',
    'positionSide',
    'publicEvidence',
  ]);
}

function reproduceValidationInvocation(
  value: unknown,
): Readonly<ReproducedValidation> {
  const invocation = canonicalFrozenClone(
    value,
    'OBSERVATION_INVALID',
  );
  assertSecretFreeInvocation(invocation);
  const root = rawRecord(invocation, ['adapter', 'config', 'input']);
  if (root.adapter === 'BINANCE_SPOT') {
    if (root.config !== null) return problem('OBSERVATION_INVALID');
    const input = rawRecord(root.input, [
      'evaluatedAtMs',
      'publicSnapshot',
      'order',
      'policy',
    ]);
    return Object.freeze({
      adapter: 'BINANCE_SPOT' as const,
      invocation,
      result: prepareBinanceSpotValidateOnlyOrder(input),
      evaluatedAtMs: input.evaluatedAtMs,
    });
  }
  if (root.adapter === 'BINANCE_USDM') {
    const input = exactUsdMValidationInput(root.input);
    const adapter = createBinanceUsdMBasisValidateOnlyAdapter(
      exactUsdMConfig(root.config) as never,
    );
    return Object.freeze({
      adapter: 'BINANCE_USDM' as const,
      invocation,
      result: adapter.buildOrderIntent(input as never),
      evaluatedAtMs: input.nowMs,
    });
  }
  return problem('OBSERVATION_INVALID');
}

function reproduceQueryInvocation(
  value: unknown,
): Readonly<ReproducedQuery> {
  const invocation = canonicalFrozenClone(
    value,
    'OBSERVATION_INVALID',
  );
  assertSecretFreeInvocation(invocation);
  const root = rawRecord(invocation, [
    'adapter',
    'config',
    'validationInput',
    'queryInput',
  ]);
  if (root.adapter === 'BINANCE_SPOT') {
    if (root.config !== null) return problem('OBSERVATION_INVALID');
    const validationInput = rawRecord(root.validationInput, [
      'evaluatedAtMs',
      'publicSnapshot',
      'order',
      'policy',
    ]);
    const queryInput = rawRecord(root.queryInput, [
      'evaluatedAtMs',
      'mutationKnowledge',
      'evidence',
    ]);
    const adapterResult = prepareBinanceSpotValidateOnlyOrder(
      validationInput,
    );
    return Object.freeze({
      adapter: 'BINANCE_SPOT' as const,
      invocation,
      adapterResult,
      queryDescriptorResult: null,
      queryResolution: normalizeBinanceSpotInjectedQueryEvidence(
        adapterResult,
        queryInput,
      ),
    });
  }
  if (root.adapter === 'BINANCE_USDM') {
    const config = exactUsdMConfig(root.config);
    const validationInput = exactUsdMValidationInput(
      root.validationInput,
    );
    const queryInputRecord = isRecord(root.queryInput)
      ? root.queryInput
      : problem('OBSERVATION_INVALID');
    const queryInput = rawRecord(
      queryInputRecord,
      Object.hasOwn(queryInputRecord, 'order')
        ? [
            'nowMs',
            'observedAtMs',
            'receivedAtMs',
            'maxAgeMs',
            'authority',
            'outcome',
            'order',
          ]
        : [
            'nowMs',
            'observedAtMs',
            'receivedAtMs',
            'maxAgeMs',
            'authority',
            'outcome',
          ],
    );
    const adapter = createBinanceUsdMBasisValidateOnlyAdapter(
      config as never,
    );
    const adapterResult = adapter.buildOrderIntent(
      validationInput as never,
    );
    if (
      !isBinanceUsdMBasisIntentResult(adapterResult) ||
      adapterResult.ok !== true ||
      adapterResult.intent === null
    ) {
      return problem('OBSERVATION_INVALID');
    }
    return Object.freeze({
      adapter: 'BINANCE_USDM' as const,
      invocation,
      adapterResult,
      queryDescriptorResult:
        adapter.buildOrderQueryDescriptor(adapterResult.intent),
      queryResolution: adapter.normalizeOrderQueryEvidence(
        adapterResult.intent,
        queryInput as never,
      ),
    });
  }
  return problem('OBSERVATION_INVALID');
}

function normalizeValidationObservation(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<
    Pick<
      BasisValidateOnlyLifecycleState,
      'next' | 'attempt' | 'expectedQuantityExact'
    >
  >,
  root: Readonly<Record<string, unknown>>,
): Readonly<BasisValidateOnlyValidationJournalEntry> {
  const step = root.step;
  const attempt = root.attempt;
  if (!STEP_SET.has(String(step)) || !safeAttempt(attempt)) {
    return problem('OBSERVATION_INVALID');
  }
  const typedStep = step as BasisValidateOnlyStep;
  if (
    state.next !== typedStep ||
    state.attempt !== attempt ||
    state.expectedQuantityExact === null
  ) {
    return problem('UNEXPECTED_EVENT');
  }
  const clientOrderId = expectedClientOrderId(binding, typedStep, attempt);
  const suppliedResult = root.adapterResult;
  if (
    ((typedStep === 'SPOT_OPEN' || typedStep === 'SPOT_CLOSE') &&
      !isBinanceSpotValidateOnlyPreparation(suppliedResult)) ||
    ((typedStep === 'PERP_OPEN' || typedStep === 'PERP_CLOSE') &&
      !isBinanceUsdMBasisIntentResult(suppliedResult))
  ) {
    return problem('OBSERVATION_INVALID');
  }
  const reproduced = reproduceValidationInvocation(root.adapterInvocation);
  const expectedAdapter =
    typedStep === 'SPOT_OPEN' || typedStep === 'SPOT_CLOSE'
      ? 'BINANCE_SPOT'
      : 'BINANCE_USDM';
  if (
    reproduced.adapter !== expectedAdapter ||
    !validationTimeAllowed(
      binding,
      typedStep,
      reproduced.evaluatedAtMs,
    ) ||
    canonicalJson(reproduced.result) !== canonicalJson(suppliedResult)
  ) {
    return problem('OBSERVATION_INVALID');
  }
  const result = reproduced.result;

  if (typedStep === 'SPOT_OPEN' || typedStep === 'SPOT_CLOSE') {
    if (
      !isBinanceSpotValidateOnlyPreparation(result) ||
      result.status !== 'VALIDATED' ||
      result.wireIntent === null ||
      result.queryDescriptor === null ||
      result.authority !== 'NONE' ||
      result.sendEligible !== false ||
      result.transportCapability !== 'ABSENT' ||
      result.wireIntent.sendCapability !== 'ABSENT' ||
      result.wireIntent.sendEligible !== false ||
      result.wireIntent.planId !== binding.plan.planId ||
      result.wireIntent.legId !== expectedLegId(binding, typedStep) ||
      result.wireIntent.attempt !== attempt ||
      result.wireIntent.symbol !== binding.symbol ||
      result.wireIntent.clientOrderId !== clientOrderId ||
      result.wireIntent.quantity !== state.expectedQuantityExact ||
      result.wireIntent.type !== 'LIMIT' ||
      result.wireIntent.price !== binding.spotPriceExact ||
      result.wireIntent.timeInForce !== 'GTC' ||
      result.wireIntent.side !==
        binding.plan.normalBasisBinding?.steps[typedStep].side ||
      !validationTimeAllowed(binding, typedStep, result.evaluatedAtMs) ||
      result.filterObservedAt === null ||
      !validationTimeAllowed(
        binding,
        typedStep,
        result.filterObservedAt.receivedAtMs,
      ) ||
      result.venueEvidenceObservedAt === null ||
      !validationTimeAllowed(
        binding,
        typedStep,
        result.venueEvidenceObservedAt.receivedAtMs,
      )
    ) {
      return problem('OBSERVATION_INVALID');
    }
    return Object.freeze({
      kind: 'VALIDATION',
      step: typedStep,
      attempt,
      clientOrderId,
      quantityExact: state.expectedQuantityExact,
      adapter: 'BINANCE_SPOT',
      evidenceId: `spot_${stableHash128Hex(
        `basisSpotValidation|${canonicalJson({
          snapshotId: result.snapshotId,
          evaluatedAtMs: result.evaluatedAtMs,
          filterObservedAt: result.filterObservedAt,
          venueEvidenceObservedAt: result.venueEvidenceObservedAt,
          clientOrderId,
        })}`,
      )}`,
      adapterInvocation: reproduced.invocation,
    });
  }

  if (
    !isBinanceUsdMBasisIntentResult(result) ||
    result.ok !== true ||
    result.intent === null ||
    result.authority !== 'NONE' ||
    result.sendEligible !== false ||
    result.networkRequestsPerformed !== 0 ||
    result.privateRequestsPerformed !== 0 ||
    result.signedRequestsPerformed !== 0 ||
    result.ordersPerformed !== 0 ||
    result.sideEffectsPerformed !== 0 ||
    result.intent.leg !== typedStep ||
    result.intent.symbol !== binding.symbol ||
    result.intent.existingClientOrderId !== clientOrderId ||
    result.intent.quantity !== state.expectedQuantityExact ||
    result.intent.type !== 'LIMIT' ||
    result.intent.price !== binding.perpPriceExact ||
    result.intent.timeInForce !== 'GTC' ||
    result.intent.side !==
      binding.plan.normalBasisBinding?.steps[typedStep].side ||
    result.intent.reduceOnly !==
      binding.plan.normalBasisBinding?.steps[typedStep].reduceOnly ||
    result.intent.sendEligible !== false ||
    result.intent.authority !== 'NONE' ||
    !validationTimeAllowed(
      binding,
      typedStep,
      result.intent.localValidation.publicEvidenceReceivedAtMs,
    ) ||
    !validationTimeAllowed(
      binding,
      typedStep,
      result.intent.localValidation.referenceMarkPriceReceivedAtMs,
    ) ||
    !validationTimeAllowed(
      binding,
      typedStep,
      result.intent.localValidation.positionModeReceivedAtMs,
    )
  ) {
    return problem('OBSERVATION_INVALID');
  }
  return Object.freeze({
    kind: 'VALIDATION',
    step: typedStep,
    attempt,
    clientOrderId,
    quantityExact: state.expectedQuantityExact,
    adapter: 'BINANCE_USDM',
    evidenceId: `usdm_${stableHash128Hex(
      `basisUsdMValidation|${canonicalJson({
        evaluatedAtMs: reproduced.evaluatedAtMs,
        publicEvidenceSourceId:
          result.intent.localValidation.publicEvidenceSourceId,
        publicEvidenceReceivedAtMs:
          result.intent.localValidation.publicEvidenceReceivedAtMs,
        referenceMarkPriceRevision:
          result.intent.localValidation.referenceMarkPriceRevision,
        referenceMarkPriceReceivedAtMs:
          result.intent.localValidation.referenceMarkPriceReceivedAtMs,
        positionModeRevision:
          result.intent.localValidation.positionModeRevision,
        positionModeReceivedAtMs:
          result.intent.localValidation.positionModeReceivedAtMs,
        clientOrderId,
      })}`,
    )}`,
    adapterInvocation: reproduced.invocation,
  });
}

function normalizeOutcomeObservation(
  root: Readonly<Record<string, unknown>>,
): Readonly<BasisValidateOnlyOutcomeJournalEntry> {
  if (
    !STEP_SET.has(String(root.step)) ||
    !safeAttempt(root.attempt) ||
    !boundedId(root.clientOrderId) ||
    (root.state !== 'WORKING' &&
      root.state !== 'AMBIGUOUS' &&
      root.state !== 'TERMINAL') ||
    !OUTCOME_AUTHORITY_SET.has(String(root.evidenceAuthority))
  ) {
    return problem('OBSERVATION_INVALID');
  }
  if (root.state === 'TERMINAL') {
    if (
      !TERMINAL_STATUS_SET.has(String(root.terminalStatus)) ||
      canonicalNonNegative(root.cumulativeFilledQuantityExact) === null
    ) {
      return problem('OBSERVATION_INVALID');
    }
  } else if (
    root.terminalStatus !== null ||
    root.cumulativeFilledQuantityExact !== null
  ) {
    return problem('OBSERVATION_INVALID');
  }
  return Object.freeze({
    kind: 'OUTCOME',
    step: root.step as BasisValidateOnlyStep,
    attempt: root.attempt,
    clientOrderId: root.clientOrderId,
    state: root.state,
    terminalStatus:
      root.terminalStatus as BasisValidateOnlyTerminalStatus | null,
    cumulativeFilledQuantityExact:
      root.cumulativeFilledQuantityExact as string | null,
    evidenceAuthority:
      root.evidenceAuthority as 'SYNTHETIC_TEST' | 'RECORDED_REPLAY',
  });
}

function queryStatus(
  status: string,
): {
  state: 'WORKING' | 'TERMINAL';
  terminalStatus: BasisValidateOnlyTerminalStatus | null;
} {
  if (
    status === 'NEW' ||
    status === 'PARTIALLY_FILLED' ||
    status === 'PENDING_CANCEL'
  ) {
    return { state: 'WORKING', terminalStatus: null };
  }
  if (status === 'FILLED') {
    return { state: 'TERMINAL', terminalStatus: 'FILLED' };
  }
  if (status === 'CANCELED') {
    return { state: 'TERMINAL', terminalStatus: 'CANCELLED' };
  }
  if (status === 'REJECTED') {
    return { state: 'TERMINAL', terminalStatus: 'REJECTED' };
  }
  if (status === 'EXPIRED' || status === 'EXPIRED_IN_MATCH') {
    return { state: 'TERMINAL', terminalStatus: 'EXPIRED' };
  }
  return problem('OBSERVATION_INVALID');
}

function normalizeSpotQuery(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<
    Pick<BasisValidateOnlyLifecycleState, 'expectedQuantityExact'>
  >,
  step: Extract<BasisValidateOnlyStep, 'SPOT_OPEN' | 'SPOT_CLOSE'>,
  attempt: number,
  clientOrderId: string,
  adapterResult: unknown,
  queryDescriptorResult: unknown,
  queryResolution: unknown,
  queryInvocation: Readonly<unknown>,
): Readonly<BasisValidateOnlyQueryJournalEntry> {
  if (
    !isBinanceSpotValidateOnlyPreparation(adapterResult) ||
    adapterResult.wireIntent === null ||
    adapterResult.wireIntent.clientOrderId !== clientOrderId ||
    adapterResult.wireIntent.planId !== binding.plan.planId ||
    adapterResult.wireIntent.legId !== expectedLegId(binding, step) ||
    adapterResult.wireIntent.attempt !== attempt ||
    adapterResult.wireIntent.quantity !== state.expectedQuantityExact ||
    adapterResult.wireIntent.type !== 'LIMIT' ||
    adapterResult.wireIntent.price !== binding.spotPriceExact ||
    adapterResult.wireIntent.timeInForce !== 'GTC' ||
    adapterResult.wireIntent.side !==
      binding.plan.normalBasisBinding?.steps[step].side ||
    queryDescriptorResult !== null ||
    !isBinanceSpotQueryResolution(queryResolution) ||
    (queryResolution.clientOrderId !== null &&
      queryResolution.clientOrderId !== clientOrderId)
  ) {
    return problem('IDENTITY_MISMATCH');
  }
  if (queryResolution.state !== 'OBSERVED') {
    return Object.freeze({
      kind: 'QUERY',
      step,
      attempt,
      clientOrderId,
      state: 'UNRESOLVED',
      terminalStatus: null,
      cumulativeFilledQuantityExact: null,
      evidenceAuthority: 'UNKNOWN',
      queryInvocation,
    });
  }
  const observation = queryResolution.observation;
  if (
    observation === null ||
    observation.clientOrderId !== clientOrderId ||
    canonicalNonNegative(observation.executedQuantity) === null ||
    !afterAcceptedRevision(binding, observation.observedAt.receivedAtMs)
  ) {
    return problem('IDENTITY_MISMATCH');
  }
  const normalized = queryStatus(observation.status);
  const evidenceAuthority =
    observation.observedAt.authority === 'RECORDED_REPLAY'
      ? 'RECORDED_REPLAY'
      : observation.observedAt.authority === 'SYNTHETIC_TEST'
        ? 'SYNTHETIC_TEST'
        : 'UNKNOWN';
  if (evidenceAuthority === 'UNKNOWN') {
    return Object.freeze({
      kind: 'QUERY',
      step,
      attempt,
      clientOrderId,
      state: 'UNRESOLVED',
      terminalStatus: null,
      cumulativeFilledQuantityExact: null,
      evidenceAuthority,
      queryInvocation,
    });
  }
  return Object.freeze({
    kind: 'QUERY',
    step,
    attempt,
    clientOrderId,
    state: normalized.state,
    terminalStatus: normalized.terminalStatus,
    cumulativeFilledQuantityExact:
      normalized.state === 'TERMINAL'
        ? observation.executedQuantity
        : null,
    evidenceAuthority,
    queryInvocation,
  });
}

function normalizeUsdMQuery(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<
    Pick<BasisValidateOnlyLifecycleState, 'expectedQuantityExact'>
  >,
  step: Extract<BasisValidateOnlyStep, 'PERP_OPEN' | 'PERP_CLOSE'>,
  attempt: number,
  clientOrderId: string,
  adapterResult: unknown,
  queryDescriptorResult: unknown,
  queryResolution: unknown,
  queryInvocation: Readonly<unknown>,
): Readonly<BasisValidateOnlyQueryJournalEntry> {
  if (
    !isBinanceUsdMBasisIntentResult(adapterResult) ||
    adapterResult.ok !== true ||
    adapterResult.intent === null ||
    adapterResult.intent.existingClientOrderId !== clientOrderId ||
    adapterResult.intent.leg !== step ||
    adapterResult.intent.quantity !== state.expectedQuantityExact ||
    adapterResult.intent.type !== 'LIMIT' ||
    adapterResult.intent.price !== binding.perpPriceExact ||
    adapterResult.intent.timeInForce !== 'GTC' ||
    adapterResult.intent.side !==
      binding.plan.normalBasisBinding?.steps[step].side ||
    adapterResult.intent.reduceOnly !==
      binding.plan.normalBasisBinding?.steps[step].reduceOnly ||
    !isBinanceUsdMBasisQueryDescriptorResult(queryDescriptorResult) ||
    queryDescriptorResult.ok !== true ||
    queryDescriptorResult.descriptor === null ||
    queryDescriptorResult.authority !== 'NONE' ||
    queryDescriptorResult.networkRequestsPerformed !== 0 ||
    queryDescriptorResult.privateRequestsPerformed !== 0 ||
    queryDescriptorResult.signedRequestsPerformed !== 0 ||
    queryDescriptorResult.sideEffectsPerformed !== 0 ||
    queryDescriptorResult.descriptor.callable !== false ||
    queryDescriptorResult.descriptor.symbol !== binding.symbol ||
    queryDescriptorResult.descriptor.origClientOrderId !== clientOrderId ||
    queryDescriptorResult.descriptor.queryFields.symbol !== binding.symbol ||
    queryDescriptorResult.descriptor.queryFields.origClientOrderId !==
      clientOrderId ||
    !isBinanceUsdMBasisQueryResolution(queryResolution)
  ) {
    return problem('IDENTITY_MISMATCH');
  }
  if (queryResolution.state !== 'CONFIRMED') {
    return Object.freeze({
      kind: 'QUERY',
      step,
      attempt,
      clientOrderId,
      state: 'UNRESOLVED',
      terminalStatus: null,
      cumulativeFilledQuantityExact: null,
      evidenceAuthority:
        queryResolution.evidenceAuthority ?? 'UNKNOWN',
      queryInvocation,
    });
  }
  const order = queryResolution.order;
  if (
    order === null ||
    order.clientOrderId !== clientOrderId ||
    canonicalNonNegative(order.executedQty) === null ||
    !afterAcceptedRevision(binding, queryResolution.evaluatedAtMs) ||
    !afterAcceptedRevision(binding, queryResolution.observedAtMs) ||
    !afterAcceptedRevision(binding, queryResolution.receivedAtMs)
  ) {
    return problem('IDENTITY_MISMATCH');
  }
  const normalized = queryStatus(order.status);
  return Object.freeze({
    kind: 'QUERY',
    step,
    attempt,
    clientOrderId,
    state: normalized.state,
    terminalStatus: normalized.terminalStatus,
    cumulativeFilledQuantityExact:
      normalized.state === 'TERMINAL' ? order.executedQty : null,
    evidenceAuthority:
      queryResolution.evidenceAuthority ?? 'UNKNOWN',
    queryInvocation,
  });
}

function normalizeQueryObservation(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<
    Pick<
      BasisValidateOnlyLifecycleState,
      | 'next'
      | 'attempt'
      | 'activeClientOrderId'
      | 'expectedQuantityExact'
    >
  >,
  root: Readonly<Record<string, unknown>>,
): Readonly<BasisValidateOnlyQueryJournalEntry> {
  if (
    !STEP_SET.has(String(root.step)) ||
    !safeAttempt(root.attempt) ||
    !boundedId(root.clientOrderId)
  ) {
    return problem('OBSERVATION_INVALID');
  }
  const step = root.step as BasisValidateOnlyStep;
  if (
    state.next !== step ||
    state.attempt !== root.attempt ||
    state.activeClientOrderId !== root.clientOrderId
  ) {
    return problem('IDENTITY_MISMATCH');
  }
  const reproduced = reproduceQueryInvocation(root.queryInvocation);
  const expectedAdapter =
    step === 'SPOT_OPEN' || step === 'SPOT_CLOSE'
      ? 'BINANCE_SPOT'
      : 'BINANCE_USDM';
  if (reproduced.adapter !== expectedAdapter) {
    return problem('IDENTITY_MISMATCH');
  }
  if (step === 'SPOT_OPEN' || step === 'SPOT_CLOSE') {
    const supplied = normalizeSpotQuery(
      binding,
      state,
      step,
      root.attempt,
      root.clientOrderId,
      root.adapterResult,
      root.queryDescriptorResult,
      root.queryResolution,
      reproduced.invocation,
    );
    if (
      canonicalJson(root.adapterResult) !==
        canonicalJson(reproduced.adapterResult) ||
      root.queryDescriptorResult !== null ||
      canonicalJson(root.queryResolution) !==
        canonicalJson(reproduced.queryResolution)
    ) {
      return problem('OBSERVATION_INVALID');
    }
    const derived = normalizeSpotQuery(
      binding,
      state,
      step,
      root.attempt,
      root.clientOrderId,
      reproduced.adapterResult,
      reproduced.queryDescriptorResult,
      reproduced.queryResolution,
      reproduced.invocation,
    );
    return canonicalJson(supplied) === canonicalJson(derived)
      ? derived
      : problem('OBSERVATION_INVALID');
  }
  const supplied = normalizeUsdMQuery(
    binding,
    state,
    step,
    root.attempt,
    root.clientOrderId,
    root.adapterResult,
    root.queryDescriptorResult,
    root.queryResolution,
    reproduced.invocation,
  );
  if (
    canonicalJson(root.adapterResult) !==
      canonicalJson(reproduced.adapterResult) ||
    canonicalJson(root.queryDescriptorResult) !==
      canonicalJson(reproduced.queryDescriptorResult) ||
    canonicalJson(root.queryResolution) !==
      canonicalJson(reproduced.queryResolution)
  ) {
    return problem('OBSERVATION_INVALID');
  }
  const derived = normalizeUsdMQuery(
    binding,
    state,
    step,
    root.attempt,
    root.clientOrderId,
    reproduced.adapterResult,
    reproduced.queryDescriptorResult,
    reproduced.queryResolution,
    reproduced.invocation,
  );
  return canonicalJson(supplied) === canonicalJson(derived)
    ? derived
    : problem('OBSERVATION_INVALID');
}

function expectedFlatnessIdentity(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<BasisValidateOnlyLifecycleState>,
  input: Readonly<BasisFlatnessVerificationInput>,
): boolean {
  const normal = binding.plan.normalBasisBinding;
  if (normal === undefined) return false;
  const closeIds = (step: 'PERP_CLOSE' | 'SPOT_CLOSE') =>
    normal.closeAttempts
      .filter((candidate) => candidate.step === step)
      .sort((left, right) => left.attempt - right.attempt)
      .map((candidate) => candidate.clientOrderId);
  return (
    input.plan.planId === binding.plan.planId &&
    input.plan.bindingId === binding.bindingId &&
    input.plan.termsFingerprint === binding.plan.termsFingerprint &&
    input.plan.accountId === binding.accountId &&
    input.plan.symbol === binding.symbol &&
    input.plan.acceptedRevisionTs === binding.acceptedRevisionTs &&
    input.plan.stateRevision === state.revision &&
    input.plan.stateRevisionId === state.stateRevisionId &&
    input.plan.direction === 'LONG_SPOT_SHORT_PERP' &&
    input.plan.positionMode === 'ONE_WAY' &&
    input.plan.actionAuthority === 'NONE_RECORD_ONLY' &&
    input.plan.riskAuthority === 'NONE' &&
    input.plan.sendEligible === false &&
    canonicalJson(input.plan.clientOrderIds) ===
      canonicalJson({
        SPOT_OPEN: normal.steps.SPOT_OPEN.clientOrderId,
        PERP_OPEN: normal.steps.PERP_OPEN.clientOrderId,
        PERP_CLOSE: normal.steps.PERP_CLOSE.clientOrderId,
        SPOT_CLOSE: normal.steps.SPOT_CLOSE.clientOrderId,
      }) &&
    canonicalJson(input.plan.closeAttemptClientOrderIds) ===
      canonicalJson({
        PERP_CLOSE: closeIds('PERP_CLOSE'),
        SPOT_CLOSE: closeIds('SPOT_CLOSE'),
      })
  );
}

interface TerminalJournalOrder {
  readonly step: BasisValidateOnlyStep;
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly status: BasisValidateOnlyTerminalStatus;
  readonly submittedQuantityExact: string;
  readonly cumulativeFilledQuantityExact: string;
}

function terminalJournalOrders(
  journal: readonly Readonly<BasisValidateOnlyJournalEntry>[],
): readonly Readonly<TerminalJournalOrder>[] {
  const validations = new Map<
    string,
    Readonly<BasisValidateOnlyValidationJournalEntry>
  >();
  const terminal: Readonly<TerminalJournalOrder>[] = [];
  for (const entry of journal) {
    const key =
      entry.kind === 'FLATNESS'
        ? null
        : `${entry.step}:${entry.attempt}:${entry.clientOrderId}`;
    if (entry.kind === 'VALIDATION') {
      if (validations.has(key as string)) return problem('FLATNESS_INVALID');
      validations.set(key as string, entry);
      continue;
    }
    if (
      (entry.kind === 'OUTCOME' || entry.kind === 'QUERY') &&
      entry.state === 'TERMINAL'
    ) {
      const validation = validations.get(key as string);
      if (
        validation === undefined ||
        entry.terminalStatus === null ||
        entry.cumulativeFilledQuantityExact === null
      ) {
        return problem('FLATNESS_INVALID');
      }
      terminal.push(Object.freeze({
        step: entry.step,
        attempt: entry.attempt,
        clientOrderId: entry.clientOrderId,
        status: entry.terminalStatus,
        submittedQuantityExact: validation.quantityExact,
        cumulativeFilledQuantityExact:
          entry.cumulativeFilledQuantityExact,
      }));
    }
  }
  return Object.freeze(terminal);
}

function flatnessOrdersMatchJournal(
  input: Readonly<BasisFlatnessVerificationInput>,
  journal: readonly Readonly<BasisValidateOnlyJournalEntry>[],
): boolean {
  const expected = terminalJournalOrders(journal);
  const actual = input.evidence.orders.records.map((record) =>
    Object.freeze({
      step: record.step,
      attempt: record.attempt,
      clientOrderId: record.clientOrderId,
      status: record.status,
      submittedQuantityExact: record.submittedQuantityExact,
      cumulativeFilledQuantityExact:
        record.cumulativeFilledQuantityExact,
    })
  );
  return canonicalJson(actual) === canonicalJson(expected);
}

function normalizeFlatnessObservation(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<BasisValidateOnlyLifecycleState>,
  root: Readonly<Record<string, unknown>>,
): Readonly<BasisValidateOnlyFlatnessJournalEntry> {
  if (
    state.next !== 'FLATNESS' ||
    state.action.disposition !== 'FLATNESS_REQUIRED' ||
    !isBasisFlatnessResult(root.result)
  ) {
    return problem('FLATNESS_INVALID');
  }
  const result = root.result as Readonly<BasisFlatnessResult>;
  const rerun = verifyBasisFlatness(root.input);
  if (
    !isBasisFlatnessResult(rerun) ||
    result.status !== 'FLAT' ||
    result.flat !== true ||
    rerun.status !== 'FLAT' ||
    rerun.flat !== true ||
    canonicalJson(result) !== canonicalJson(rerun)
  ) {
    return problem('FLATNESS_INVALID');
  }
  const input = root.input as Readonly<BasisFlatnessVerificationInput>;
  if (
    !expectedFlatnessIdentity(binding, state, input) ||
    !flatnessOrdersMatchJournal(input, state.journal)
  ) {
    return problem('FLATNESS_INVALID');
  }
  return Object.freeze({
    kind: 'FLATNESS',
    input: canonicalFrozenClone(input),
    proofId: flatnessProofId(rerun),
  });
}

function normalizeObservation(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<BasisValidateOnlyLifecycleState>,
  value: unknown,
): Readonly<BasisValidateOnlyJournalEntry> {
  if (!isRecord(value)) return problem('OBSERVATION_INVALID');
  let kind: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return problem('OBSERVATION_INVALID');
    }
    kind = descriptor.value;
  } catch {
    return problem('OBSERVATION_INVALID');
  }
  if (kind === 'VALIDATION') {
    return normalizeValidationObservation(
      binding,
      state,
      rawRecord(value, [
        'kind',
        'step',
        'attempt',
        'adapterResult',
        'adapterInvocation',
      ]),
    );
  }
  if (kind === 'OUTCOME') {
    return normalizeOutcomeObservation(
      rawRecord(value, [
        'kind',
        'step',
        'attempt',
        'clientOrderId',
        'state',
        'terminalStatus',
        'cumulativeFilledQuantityExact',
        'evidenceAuthority',
      ]),
    );
  }
  if (kind === 'QUERY') {
    return normalizeQueryObservation(
      binding,
      state,
      rawRecord(value, [
        'kind',
        'step',
        'attempt',
        'clientOrderId',
        'adapterResult',
        'queryDescriptorResult',
        'queryResolution',
        'queryInvocation',
      ]),
    );
  }
  if (kind === 'FLATNESS') {
    return normalizeFlatnessObservation(
      binding,
      state,
      rawRecord(value, ['kind', 'input', 'result']),
    );
  }
  return problem('OBSERVATION_INVALID');
}

function parseJournalEntry(
  value: unknown,
): Readonly<BasisValidateOnlyJournalEntry> {
  if (!isRecord(value)) return problem('UNEXPECTED_EVENT');
  let kind: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    kind = descriptor.value;
  } catch {
    return problem('UNEXPECTED_EVENT');
  }
  if (kind === 'VALIDATION') {
    const root = rawRecord(value, [
      'kind',
      'step',
      'attempt',
      'clientOrderId',
      'quantityExact',
      'adapter',
      'evidenceId',
      'adapterInvocation',
    ]);
    if (
      !STEP_SET.has(String(root.step)) ||
      !safeAttempt(root.attempt) ||
      !boundedId(root.clientOrderId) ||
      canonicalPositive(root.quantityExact) === null ||
      (root.adapter !== 'BINANCE_SPOT' &&
        root.adapter !== 'BINANCE_USDM') ||
      ((root.step === 'SPOT_OPEN' || root.step === 'SPOT_CLOSE')
        ? root.adapter !== 'BINANCE_SPOT'
        : root.adapter !== 'BINANCE_USDM') ||
      !boundedId(root.evidenceId)
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    return Object.freeze({
      kind: 'VALIDATION' as const,
      step: root.step as BasisValidateOnlyStep,
      attempt: root.attempt,
      clientOrderId: root.clientOrderId,
      quantityExact: root.quantityExact,
      adapter: root.adapter,
      evidenceId: root.evidenceId,
      adapterInvocation: canonicalFrozenClone(
        root.adapterInvocation,
        'OBSERVATION_INVALID',
      ),
    }) as Readonly<BasisValidateOnlyValidationJournalEntry>;
  }
  if (kind === 'OUTCOME') {
    return normalizeOutcomeObservation(
      rawRecord(value, [
        'kind',
        'step',
        'attempt',
        'clientOrderId',
        'state',
        'terminalStatus',
        'cumulativeFilledQuantityExact',
        'evidenceAuthority',
      ]),
    );
  }
  if (kind === 'QUERY') {
    const root = rawRecord(value, [
      'kind',
      'step',
      'attempt',
      'clientOrderId',
      'state',
      'terminalStatus',
      'cumulativeFilledQuantityExact',
      'evidenceAuthority',
      'queryInvocation',
    ]);
    if (
      !STEP_SET.has(String(root.step)) ||
      !safeAttempt(root.attempt) ||
      !boundedId(root.clientOrderId) ||
      (root.state !== 'WORKING' &&
        root.state !== 'TERMINAL' &&
        root.state !== 'UNRESOLVED') ||
      (root.evidenceAuthority !== 'SYNTHETIC_TEST' &&
        root.evidenceAuthority !== 'RECORDED_REPLAY' &&
        root.evidenceAuthority !== 'UNKNOWN')
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    if (
      root.state === 'TERMINAL' &&
      (!TERMINAL_STATUS_SET.has(String(root.terminalStatus)) ||
        canonicalNonNegative(root.cumulativeFilledQuantityExact) === null)
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    if (
      root.state !== 'TERMINAL' &&
      (root.terminalStatus !== null ||
        root.cumulativeFilledQuantityExact !== null)
    ) {
      return problem('UNEXPECTED_EVENT');
    }
    return Object.freeze({
      kind: 'QUERY' as const,
      step: root.step as BasisValidateOnlyStep,
      attempt: root.attempt,
      clientOrderId: root.clientOrderId,
      state: root.state,
      terminalStatus:
        root.terminalStatus as BasisValidateOnlyTerminalStatus | null,
      cumulativeFilledQuantityExact:
        root.cumulativeFilledQuantityExact as string | null,
      evidenceAuthority: root.evidenceAuthority,
      queryInvocation: canonicalFrozenClone(
        root.queryInvocation,
        'OBSERVATION_INVALID',
      ),
    }) as Readonly<BasisValidateOnlyQueryJournalEntry>;
  }
  if (kind === 'FLATNESS') {
    const root = rawRecord(value, ['kind', 'input', 'proofId']);
    if (!boundedId(root.proofId)) return problem('UNEXPECTED_EVENT');
    const input = canonicalFrozenClone(
      root.input,
    ) as Readonly<BasisFlatnessVerificationInput>;
    const verified = verifyBasisFlatness(input);
    if (
      !isBasisFlatnessResult(verified) ||
      verified.status !== 'FLAT' ||
      verified.flat !== true ||
      flatnessProofId(verified) !== root.proofId
    ) {
      return problem('FLATNESS_INVALID');
    }
    return Object.freeze({
      kind: 'FLATNESS',
      input,
      proofId: root.proofId,
    });
  }
  return problem('UNEXPECTED_EVENT');
}

function plainDenseJournalValues(value: unknown): readonly unknown[] | null {
  // Journal transport is a dense JSON array. Non-JSON metadata is ignored,
  // while an own iterator is rejected explicitly without invoking it.
  if (
    typeof value !== 'object' ||
    value === null ||
    isProxy(value) ||
    !Array.isArray(value)
  ) {
    return null;
  }
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > BASIS_VALIDATE_ONLY_MAX_JOURNAL_ENTRIES
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    let enumerableOwnKeyCount = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      enumerableOwnKeyCount += 1;
      if (
        enumerableOwnKeyCount > length ||
        !/^(?:0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= length
      ) {
        return null;
      }
    }
    if (
      enumerableOwnKeyCount !== length ||
      Object.getOwnPropertyDescriptor(value, Symbol.iterator) !== undefined
    ) {
      return null;
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

export function isBasisValidateOnlyLifecycleState(
  value: unknown,
): value is Readonly<BasisValidateOnlyLifecycleState> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    STATE_BRANDS.has(value as object)
  );
}

export function createBasisValidateOnlyLifecycle(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
): Readonly<BasisValidateOnlyLifecycleState> {
  if (!isBasisValidateOnlyPlanBinding(binding)) {
    throw new TypeError('nominal Basis validate-only plan binding required');
  }
  return freezeState(binding, Object.freeze([]), initialProjection(binding));
}

export function replayBasisValidateOnlyLifecycle(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  journal: readonly unknown[],
): BasisValidateOnlyReplayResult {
  if (!isBasisValidateOnlyPlanBinding(binding)) {
    return Object.freeze({ ok: false as const, code: 'BINDING_INVALID' });
  }
  const candidates = plainDenseJournalValues(journal);
  if (candidates === null) {
    return Object.freeze({ ok: false as const, code: 'JOURNAL_FULL' });
  }
  const projection = initialProjection(binding);
  const normalized: Readonly<BasisValidateOnlyJournalEntry>[] = [];
  let normalizedBytes = 2;
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      if (normalized.length >= BASIS_VALIDATE_ONLY_MAX_JOURNAL_ENTRIES) {
        return Object.freeze({ ok: false as const, code: 'JOURNAL_FULL' });
      }
      const candidate = candidates[index];
      const event = parseJournalEntry(candidate);
      const eventBytes = canonicalJson(event).length;
      normalizedBytes += eventBytes + (normalized.length === 0 ? 0 : 1);
      if (normalizedBytes > BASIS_VALIDATE_ONLY_MAX_JOURNAL_BYTES) {
        return Object.freeze({ ok: false as const, code: 'JOURNAL_FULL' });
      }
      applyNormalizedEvent(
        binding,
        projection,
        event,
        normalized.length,
        normalized,
      );
      normalized.push(event);
    }
    return Object.freeze({
      ok: true as const,
      state: freezeState(binding, normalized, projection),
    });
  } catch (error) {
    const code =
      error instanceof LifecycleProblem
        ? error.code
        : 'UNEXPECTED_EVENT';
    return Object.freeze({
      ok: false as const,
      code:
        code === 'STATE_INVALID' || code === 'OBSERVATION_INVALID'
          ? 'UNEXPECTED_EVENT'
          : code,
    });
  }
}

export function applyBasisValidateOnlyObservation(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<BasisValidateOnlyLifecycleState>,
  observation: unknown,
): BasisValidateOnlyApplyResult {
  if (!isBasisValidateOnlyPlanBinding(binding)) {
    return Object.freeze({
      applied: false as const,
      code: 'BINDING_INVALID',
      state: isBasisValidateOnlyLifecycleState(state) ? state : null,
    });
  }
  if (
    !isBasisValidateOnlyLifecycleState(state) ||
    state.bindingId !== binding.bindingId ||
    state.planId !== binding.plan.planId
  ) {
    return Object.freeze({
      applied: false as const,
      code: 'STATE_INVALID',
      state: createBasisValidateOnlyLifecycle(binding),
    });
  }
  if (state.journal.length >= BASIS_VALIDATE_ONLY_MAX_JOURNAL_ENTRIES) {
    return Object.freeze({
      applied: false as const,
      code: 'JOURNAL_FULL',
      state,
    });
  }
  try {
    const event = normalizeObservation(binding, state, observation);
    const replay = replayBasisValidateOnlyLifecycle(binding, [
      ...state.journal,
      event,
    ]);
    if (!replay.ok) {
      return Object.freeze({
        applied: false as const,
        code: replay.code,
        state,
      });
    }
    return Object.freeze({
      applied: true as const,
      state: replay.state,
    });
  } catch (error) {
    return Object.freeze({
      applied: false as const,
      code:
        error instanceof LifecycleProblem
          ? error.code
          : 'OBSERVATION_INVALID',
      state,
    });
  }
}

function checkpointProjection(
  state: Readonly<BasisValidateOnlyLifecycleState>,
): Omit<BasisValidateOnlyLifecycleState, 'journal'> {
  const { journal: _journal, ...projection } = state;
  return projection;
}

export function serializeBasisValidateOnlyCheckpoint(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  state: Readonly<BasisValidateOnlyLifecycleState>,
): string {
  if (
    !isBasisValidateOnlyPlanBinding(binding) ||
    !isBasisValidateOnlyLifecycleState(state) ||
    state.bindingId !== binding.bindingId
  ) {
    throw new TypeError('nominal matching binding/state required');
  }
  const payload = Object.freeze({
    schema: BASIS_VALIDATE_ONLY_CHECKPOINT_SCHEMA,
    version: BASIS_VALIDATE_ONLY_CHECKPOINT_VERSION,
    bindingId: binding.bindingId,
    journal: state.journal,
    projection: checkpointProjection(state),
  });
  const checksum = stableHash128Hex(
    `basisValidateOnlyCheckpoint|${canonicalJson(payload)}`,
  );
  const serialized = canonicalJson({ ...payload, checksum });
  if (serialized.length > BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES) {
    throw new RangeError('Basis validate-only checkpoint exceeds byte bound');
  }
  return serialized;
}

export function restoreBasisValidateOnlyCheckpoint(
  binding: Readonly<BasisValidateOnlyPlanBinding>,
  serialized: string,
): BasisValidateOnlyRestoreResult {
  if (!isBasisValidateOnlyPlanBinding(binding)) {
    return Object.freeze({ ok: false as const, code: 'BINDING_INVALID' });
  }
  if (
    typeof serialized !== 'string' ||
    serialized.length === 0 ||
    serialized.length > BASIS_VALIDATE_ONLY_MAX_CHECKPOINT_BYTES
  ) {
    return Object.freeze({ ok: false as const, code: 'CHECKPOINT_INVALID' });
  }
  try {
    const decoded = JSON.parse(serialized) as unknown;
    const root = rawRecord(decoded, [
      'schema',
      'version',
      'bindingId',
      'journal',
      'projection',
      'checksum',
    ]);
    if (
      root.schema !== BASIS_VALIDATE_ONLY_CHECKPOINT_SCHEMA ||
      root.version !== BASIS_VALIDATE_ONLY_CHECKPOINT_VERSION ||
      root.bindingId !== binding.bindingId ||
      typeof root.checksum !== 'string' ||
      !Array.isArray(root.journal) ||
      root.journal.length > BASIS_VALIDATE_ONLY_MAX_JOURNAL_ENTRIES
    ) {
      return Object.freeze({
        ok: false as const,
        code: 'CHECKPOINT_INVALID',
      });
    }
    const payload = {
      schema: root.schema,
      version: root.version,
      bindingId: root.bindingId,
      journal: root.journal,
      projection: root.projection,
    };
    if (
      root.checksum !==
      stableHash128Hex(
        `basisValidateOnlyCheckpoint|${canonicalJson(payload)}`,
      )
    ) {
      return Object.freeze({
        ok: false as const,
        code: 'CHECKSUM_MISMATCH',
      });
    }
    const replay = replayBasisValidateOnlyLifecycle(
      binding,
      root.journal as readonly unknown[],
    );
    if (!replay.ok) {
      return Object.freeze({ ok: false as const, code: 'REPLAY_MISMATCH' });
    }
    if (
      canonicalJson(checkpointProjection(replay.state)) !==
      canonicalJson(root.projection)
    ) {
      return Object.freeze({ ok: false as const, code: 'REPLAY_MISMATCH' });
    }
    return Object.freeze({ ok: true as const, state: replay.state });
  } catch {
    return Object.freeze({ ok: false as const, code: 'CHECKPOINT_INVALID' });
  }
}
