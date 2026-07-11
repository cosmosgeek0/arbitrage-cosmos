import {
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  deriveActivePositionId,
  deriveCapitalMandateId,
  deriveCapitalReservationId,
  deriveExecutionCorrelationReferenceId,
  deriveReconciliationReferenceId,
  isExactPositive,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ActivePosition,
  type AllocationDecision,
  type CapitalBudgetPolicy,
  type CapitalMandate,
  type CapitalReservation,
  type CapitalReservationId,
  type ExternalReconciliationReference,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import { validateCapitalBudgetPolicy } from '../budgets/index.js';
import { projectActivePosition } from '../positions/index.js';
import { allocateCapital } from './allocator.js';
import type { AllocationAuthorityReceipt, AllocationBatchInput } from './types.js';
import { isPlanLifecycle, isReconciliationStatus, isValidUtcMillis } from '../../foundation/contracts/index.js';

export const RESERVATION_COMMAND_KINDS = Object.freeze(['RESERVE', 'CONSUME', 'RENEW', 'RELEASE', 'EXPIRE', 'CLOSE_RELEASE'] as const);
export type ReservationCommandKind = (typeof RESERVATION_COMMAND_KINDS)[number];

interface CommandBase {
  readonly commandId: string;
  readonly nowMs: number;
}

export interface ReservationAuthorityInput {
  readonly policy: Readonly<CapitalBudgetPolicy>;
  readonly budgetTruth: Readonly<TruthMetadata>;
  readonly considerationTruth: Readonly<TruthMetadata>;
}

export interface ReserveCapitalCommand extends CommandBase {
  readonly kind: 'RESERVE';
  readonly allocation: Readonly<AllocationDecision>;
  readonly authority: Readonly<AllocationAuthorityReceipt>;
  readonly allocationInput: Readonly<AllocationBatchInput>;
  readonly capitalClaimKey: string;
}

export interface ReservationTargetCommand extends CommandBase {
  readonly reservationId: CapitalReservationId;
}

export interface ConsumeReservationCommand extends ReservationTargetCommand {
  readonly kind: 'CONSUME';
  readonly amount: NonNegativeDecimal;
}

export interface RenewReservationCommand extends ReservationTargetCommand, ReservationAuthorityInput {
  readonly kind: 'RENEW';
}

export interface ReleaseReservationCommand extends ReservationTargetCommand {
  readonly kind: 'RELEASE';
  readonly reasonCode: string;
}

export interface ExpireReservationCommand extends ReservationTargetCommand { readonly kind: 'EXPIRE' }

/** Backward-compatible name for the complete canonical Foundation reference. */
export type ReservationClosureReconciliationReference = Readonly<ExternalReconciliationReference>;

export interface ReservationClosureEvidence {
  readonly reservationId: CapitalReservationId;
  readonly allocationDecisionId: AllocationDecision['id'];
  readonly considerationId: AllocationDecision['considerationId'];
  readonly capitalClaimKey: string;
  readonly reservationRevision: number;
  readonly consumedAmount: NonNegativeDecimal;
  /** The complete content-addressed mandate which opened this reservation chain. */
  readonly mandate: Readonly<CapitalMandate>;
  /** The complete canonical position projection carrying execution and reconciliation truth. */
  readonly position: Readonly<ActivePosition>;
}

export interface CloseReleaseReservationCommand extends ReservationTargetCommand {
  readonly kind: 'CLOSE_RELEASE';
  readonly closure: Readonly<ReservationClosureEvidence>;
}

export type ReservationCommand =
  | ReserveCapitalCommand
  | ConsumeReservationCommand
  | RenewReservationCommand
  | ReleaseReservationCommand
  | ExpireReservationCommand
  | CloseReleaseReservationCommand;

export interface ManagedCapitalReservation {
  readonly reservation: Readonly<CapitalReservation>;
  readonly capitalClaimKey: string;
  readonly unconsumedReleased: boolean;
  readonly closedExposureReleased: boolean;
  readonly policyRevision: string;
  readonly policyReservationTtlMs: number;
  readonly decisionValidUntilMs: number;
  readonly allocationReplayReceiptDigest: string;
  readonly lastTransitionAtMs: number;
}

export const RESERVATION_OUTCOMES = Object.freeze(['APPLIED', 'IDEMPOTENT_REPLAY', 'REJECTED', 'NOOP_ALREADY_TERMINAL'] as const);
export type ReservationOutcomeStatus = (typeof RESERVATION_OUTCOMES)[number];

export interface ReservationMutation {
  readonly commandId: string;
  readonly commandDigest: string;
  readonly commandKind: ReservationCommandKind | 'UNKNOWN';
  readonly status: ReservationOutcomeStatus;
  readonly reservationId: CapitalReservationId | null;
  readonly revision: number | null;
  readonly releasedAmount: NonNegativeDecimal;
  readonly consumedAmount: NonNegativeDecimal;
  readonly reasonCodes: readonly string[];
  readonly appliedAtMs: number;
}

export interface ReservationBook {
  readonly reservations: readonly Readonly<ManagedCapitalReservation>[];
  readonly mutations: readonly Readonly<ReservationMutation>[];
}

export interface ReservationReduction {
  readonly book: Readonly<ReservationBook>;
  readonly mutation: Readonly<ReservationMutation>;
}

const ZERO = normalizeNonNegativeExactDecimal('0');
export const EMPTY_RESERVATION_BOOK: Readonly<ReservationBook> = Object.freeze({ reservations: Object.freeze([]), mutations: Object.freeze([]) });

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}
function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truthValidUntil(truth: Readonly<TruthMetadata>, nowMs: number): number | null {
  try {
    if (truth.completeness !== 'COMPLETE' || !isValidUtcMillis(truth.evaluatedAtMs)
        || truth.evaluatedAtMs > nowMs) return null;
    const current = assessCapitalTruth({
      source: truth.source,
      evaluatedAtMs: nowMs,
      requiredValuePresent: true,
      reasons: truth.reasons,
      evidenceReferences: truth.evidenceReferences,
      revision: truth.revision,
    });
    if (current.completeness !== 'COMPLETE' || current.freshness.state !== 'FRESH') return null;
    const basis = truth.source.sourceTimeMs ?? truth.source.receivedAtMs;
    const validUntil = basis + truth.source.maxAgeMs;
    return isValidUtcMillis(validUntil) && nowMs <= validUntil ? validUntil : null;
  } catch {
    return null;
  }
}

function authorityValidity(command: ReservationAuthorityInput, nowMs: number): {
  readonly reasons: readonly string[];
  readonly validUntilMs: number | null;
} {
  if (!command?.policy || !command.budgetTruth || !command.considerationTruth) {
    return Object.freeze({ reasons: Object.freeze(['RESERVATION_AUTHORITY_MISSING']), validUntilMs: null });
  }
  let reasons: string[];
  try { reasons = [...validateCapitalBudgetPolicy(command.policy, nowMs).reasonCodes]; } catch { reasons = ['RESERVATION_POLICY_INVALID']; }
  if (command.policy.reservationTtlMs?.unit !== 'ms' && command.policy.reservationTtlMs?.unit !== 'MILLISECONDS') {
    reasons.push('RESERVATION_TTL_UNIT_INVALID');
  }
  const budgetUntil = truthValidUntil(command.budgetTruth, nowMs);
  const considerationUntil = truthValidUntil(command.considerationTruth, nowMs);
  if (budgetUntil === null) reasons.push('BUDGET_TRUTH_NOT_CURRENT');
  if (considerationUntil === null) reasons.push('CONSIDERATION_TRUTH_NOT_CURRENT');
  const validUntilMs = budgetUntil === null || considerationUntil === null
    ? null
    : Math.min(budgetUntil, considerationUntil, command.policy.authority.effectiveUntilMs ?? budgetUntil);
  return Object.freeze({ reasons: Object.freeze([...new Set(reasons)].sort()), validUntilMs });
}

/** Verifies deterministic replay integrity; this is not signature verification. */
function verifyAllocationReplayReceipt(command: Readonly<ReserveCapitalCommand>): {
  readonly reasons: readonly string[];
  readonly validUntilMs: number | null;
} {
  const reasons: string[] = [];
  try {
    if (command.allocationInput.nowMs !== command.allocation.decidedAtMs) reasons.push('ALLOCATION_CLOCK_BINDING_INVALID');
    if (command.nowMs < command.allocation.decidedAtMs) reasons.push('ALLOCATION_DECISION_FROM_FUTURE');
    const replay = allocateCapital(command.allocationInput);
    const decision = replay.decisions.find((entry) => entry.id === command.allocation.id);
    const authority = replay.authorities.find((entry) => entry.allocationDecisionId === command.allocation.id);
    if (decision === undefined || authority === undefined
        || capitalDigest(decision) !== capitalDigest(command.allocation)
        || capitalDigest(authority) !== capitalDigest(command.authority)) {
      reasons.push('ALLOCATOR_AUTHORITY_RECEIPT_MISMATCH');
    }
    const { digest: _digest, ...authoritySemantic } = command.authority;
    if (command.authority.digest !== capitalDigest(authoritySemantic)) {
      reasons.push('ALLOCATOR_AUTHORITY_DIGEST_INVALID');
    }
    const candidate = command.allocationInput.candidates.find((entry) => entry.considerationId === command.allocation.considerationId
      && capitalDigest(entry) === command.authority.candidateDigest);
    if (candidate === undefined) reasons.push('ALLOCATION_CANDIDATE_BINDING_MISSING');
    else {
      const current = authorityValidity({
        policy: command.allocationInput.policy,
        budgetTruth: command.allocationInput.snapshot.truth,
        considerationTruth: candidate.truth,
      }, command.nowMs);
      reasons.push(...current.reasons);
    }
    if (!isValidUtcMillis(command.authority.validUntilMs) || command.nowMs >= command.authority.validUntilMs) {
      reasons.push('ALLOCATION_AUTHORITY_EXPIRED');
    }
    if (command.allocation.status === 'BLOCKED' || !isExactPositive(command.allocation.grantedAmount)) {
      reasons.push('ALLOCATION_NOT_GRANTING');
    }
    return Object.freeze({
      reasons: Object.freeze([...new Set(reasons)].sort()),
      validUntilMs: command.authority.validUntilMs,
    });
  } catch {
    return Object.freeze({ reasons: Object.freeze(['ALLOCATOR_AUTHORITY_RECEIPT_INVALID']), validUntilMs: null });
  }
}

function liveClaim(entry: Readonly<ManagedCapitalReservation>, nowMs: number): boolean {
  return (entry.reservation.state === 'ACTIVE' && nowMs < entry.reservation.expiresAtMs)
    || (!entry.closedExposureReleased && isExactPositive(entry.reservation.consumedAmount));
}

function mutation(
  command: ReservationCommand,
  status: ReservationOutcomeStatus,
  reservationId: CapitalReservationId | null,
  revision: number | null,
  releasedAmount: NonNegativeDecimal,
  consumedAmount: NonNegativeDecimal,
  reasons: readonly string[],
): Readonly<ReservationMutation> {
  return Object.freeze({
    commandId: command.commandId,
    commandDigest: capitalDigest(command),
    commandKind: command.kind,
    status,
    reservationId,
    revision,
    releasedAmount,
    consumedAmount,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    appliedAtMs: isValidUtcMillis(command.nowMs) ? command.nowMs : 0,
  });
}

function finalize(
  book: Readonly<ReservationBook>,
  entries: readonly Readonly<ManagedCapitalReservation>[],
  event: Readonly<ReservationMutation>,
): ReservationReduction {
  const next = Object.freeze({
    reservations: Object.freeze([...entries].sort((a, b) => compareText(a.reservation.id, b.reservation.id))),
    mutations: Object.freeze([...book.mutations, event]),
  });
  return Object.freeze({ book: next, mutation: event });
}

function withReservation(
  book: Readonly<ReservationBook>,
  updated: Readonly<ManagedCapitalReservation>,
  event: Readonly<ReservationMutation>,
): ReservationReduction {
  return finalize(book, book.reservations.map((entry) => entry.reservation.id === updated.reservation.id ? updated : entry), event);
}

function remaining(reservation: Readonly<CapitalReservation>): NonNegativeDecimal {
  return normalizeNonNegativeExactDecimal(subtractExactDecimals(reservation.amount, reservation.consumedAmount));
}

function terminalize(
  managed: Readonly<ManagedCapitalReservation>,
  state: 'RELEASED' | 'EXPIRED',
  nowMs: number,
  close: boolean,
): { readonly managed: Readonly<ManagedCapitalReservation>; readonly released: NonNegativeDecimal } {
  const releaseUnconsumed = managed.unconsumedReleased ? ZERO : remaining(managed.reservation);
  const releaseConsumed = close && !managed.closedExposureReleased ? managed.reservation.consumedAmount : ZERO;
  const released = normalizeNonNegativeExactDecimal(addExactDecimals(releaseUnconsumed, releaseConsumed));
  return Object.freeze({
    managed: Object.freeze({
      reservation: Object.freeze({
        ...managed.reservation,
        state,
        releasedAtMs: managed.reservation.releasedAtMs ?? nowMs,
        revision: managed.reservation.revision + 1,
      }),
      capitalClaimKey: managed.capitalClaimKey,
      unconsumedReleased: true,
      closedExposureReleased: managed.closedExposureReleased || close,
      policyRevision: managed.policyRevision,
      policyReservationTtlMs: managed.policyReservationTtlMs,
      decisionValidUntilMs: managed.decisionValidUntilMs,
      allocationReplayReceiptDigest: managed.allocationReplayReceiptDigest,
      lastTransitionAtMs: nowMs,
    }),
    released,
  });
}

function isReservationCommandKind(value: unknown): value is ReservationCommandKind {
  return typeof value === 'string' && (RESERVATION_COMMAND_KINDS as readonly string[]).includes(value);
}

function unknownMutation(command: unknown, reasons: readonly string[]): Readonly<ReservationMutation> {
  const raw = command as { readonly commandId?: unknown; readonly nowMs?: unknown };
  let commandDigest: string;
  try { commandDigest = capitalDigest(command); } catch { commandDigest = capitalDigest({ malformedReservationCommand: true }); }
  return Object.freeze({
    commandId: typeof raw?.commandId === 'string' ? raw.commandId : '',
    commandDigest,
    commandKind: 'UNKNOWN',
    status: 'REJECTED',
    reservationId: null,
    revision: null,
    releasedAmount: ZERO,
    consumedAmount: ZERO,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    appliedAtMs: isValidUtcMillis(raw?.nowMs) ? raw.nowMs : 0,
  });
}

function sweepExpiredReservations(
  book: Readonly<ReservationBook>,
  command: Readonly<ReserveCapitalCommand>,
): Readonly<ReservationBook> {
  let current = book;
  const expiredEntries = [...book.reservations]
    .filter((entry) => entry.reservation.state === 'ACTIVE' && command.nowMs >= entry.reservation.expiresAtMs)
    .sort((left, right) => compareText(left.reservation.id, right.reservation.id));
  for (const entry of expiredEntries) {
    const expired = terminalize(entry, 'EXPIRED', command.nowMs, false);
    const expireCommand: Readonly<ExpireReservationCommand> = Object.freeze({
      kind: 'EXPIRE',
      commandId: `auto-expire:${capitalDigest({
        reservationId: entry.reservation.id,
        triggeredByCommandId: command.commandId,
        nowMs: command.nowMs,
      })}`,
      reservationId: entry.reservation.id,
      nowMs: command.nowMs,
    });
    current = withReservation(current, expired.managed, mutation(
      expireCommand,
      'APPLIED',
      entry.reservation.id,
      expired.managed.reservation.revision,
      expired.released,
      ZERO,
      ['RESERVATION_EXPIRED_BEFORE_RESERVE'],
    )).book;
  }
  return current;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validReferenceSequence(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function validReferenceRevision(value: unknown): value is string | null {
  return value === null || validId(value);
}

function canonicalZero(value: unknown): boolean {
  try {
    const normalized = normalizeExactDecimal(value);
    return normalized === value && normalized === ZERO;
  } catch {
    return false;
  }
}

/**
 * Validates the complete mandate rather than accepting caller-selected linkage
 * fields. The digest is a deterministic integrity binding, not a signature;
 * authority still comes from the upstream event/checkpoint owner.
 */
function validClosureMandate(
  value: unknown,
  managed: Readonly<ManagedCapitalReservation>,
  nowMs: number,
): value is Readonly<CapitalMandate> {
  try {
    if (!objectRecord(value)) return false;
    const mandate = value as unknown as Readonly<CapitalMandate>;
    const { digest, ...semantic } = mandate;
    const maximum = normalizeNonNegativeExactDecimal(mandate.targetMaximumExposure);
    if (!validId(mandate.id) || !Number.isSafeInteger(mandate.revision) || mandate.revision < 1
        || !validId(digest) || digest !== capitalDigest(semantic)
        || !validId(mandate.stagedPlanId) || !Number.isSafeInteger(mandate.stagedPlanRevision)
        || mandate.stagedPlanRevision < 1 || !validId(mandate.stagedPlanDigest)
        || !validId(mandate.proposalIntakeDigest) || !validId(mandate.configRevision)
        || maximum !== mandate.targetMaximumExposure || !isExactPositive(maximum)
        || !isValidUtcMillis(mandate.createdAtMs) || !isValidUtcMillis(mandate.expiresAtMs)
        || mandate.createdAtMs < managed.reservation.createdAtMs || mandate.createdAtMs > nowMs
        || mandate.expiresAtMs <= mandate.createdAtMs
        || mandate.expiresAtMs > managed.reservation.expiresAtMs
        || mandate.reservationId !== managed.reservation.id
        || mandate.allocationDecisionId !== managed.reservation.allocationDecisionId
        || mandate.considerationId !== managed.reservation.considerationId
        || mandate.valuationAsset !== managed.reservation.valuationAsset
        || compareExactDecimals(maximum, managed.reservation.amount) > 0
        || compareExactDecimals(maximum, managed.reservation.consumedAmount) < 0) return false;
    return mandate.id === deriveCapitalMandateId({
      considerationId: mandate.considerationId,
      allocationDecisionId: mandate.allocationDecisionId,
      reservationId: mandate.reservationId,
      proposalIntakeDigest: mandate.proposalIntakeDigest,
    });
  } catch {
    return false;
  }
}

function validClosurePosition(
  value: unknown,
  mandate: Readonly<CapitalMandate>,
  managed: Readonly<ManagedCapitalReservation>,
  nowMs: number,
): value is Readonly<ActivePosition> {
  try {
    if (!objectRecord(value)) return false;
    const position = value as unknown as Readonly<ActivePosition>;
    const execution = position.executionReference;
    const reconciliation = position.reconciliationReference;
    if (!validId(position.id) || !Number.isSafeInteger(position.revision) || position.revision < 1
        || position.id !== deriveActivePositionId({
          mandateId: position.mandateId,
          thesisId: position.thesis?.id,
          openedAtMs: position.openedAtMs,
        })
        || position.mandateId !== mandate.id || position.state !== 'CLOSED'
        || position.capitalLifecycle !== 'CLOSED'
        || !canonicalZero(position.totalGrossExposure)
        || !canonicalZero(position.netDirectionalExposure)
        || !canonicalZero(position.oneLegExposure)
        || position.hedgeRatio !== null || position.oneLegSinceMs !== null
        || !Array.isArray(position.legs) || position.legs.length === 0
        || !Array.isArray(position.outstandingActionIntentIds)
        || position.outstandingActionIntentIds.length !== 0
        || !isValidUtcMillis(position.openedAtMs) || !isValidUtcMillis(position.lastTransitionAtMs)
        || position.openedAtMs < mandate.createdAtMs || position.openedAtMs > position.lastTransitionAtMs
        || position.lastTransitionAtMs < managed.lastTransitionAtMs || position.lastTransitionAtMs > nowMs
        || !objectRecord(position.thesis) || !Number.isSafeInteger(position.thesis.revision)
        || position.thesis.revision < 1 || position.thesis.openedAtMs !== position.openedAtMs
        || position.thesis.configRevision !== mandate.configRevision
        || truthValidUntil(position.truth, nowMs) === null
        || execution === null || reconciliation === null) return false;

    const legIds = new Set<string>();
    for (const leg of position.legs) {
      if (!objectRecord(leg)) return false;
      const positionLeg = leg as unknown as ActivePosition['legs'][number];
      if (!validId(positionLeg.id) || legIds.has(positionLeg.id)
          || !validId(positionLeg.instrumentId) || !validId(positionLeg.symbol)
          || positionLeg.valuationAsset !== mandate.valuationAsset
          || !canonicalZero(positionLeg.quantity) || !canonicalZero(positionLeg.quoteExposure)
          || truthValidUntil(positionLeg.truth, nowMs) === null) return false;
      legIds.add(positionLeg.id);
    }

    if (!validId(execution.id) || !validId(execution.externalPlanId)
        || !validId(execution.correlationId) || !isPlanLifecycle(execution.lifecycle)
        || execution.lifecycle !== 'CLOSED' || !isValidUtcMillis(execution.observedAtMs)
        || execution.observedAtMs < position.lastTransitionAtMs || execution.observedAtMs > nowMs
        || !validReferenceSequence(execution.sequence) || !validReferenceRevision(execution.revision)
        || truthValidUntil(execution.truth, nowMs) === null
        || execution.id !== deriveExecutionCorrelationReferenceId({
          externalPlanId: execution.externalPlanId,
          correlationId: execution.correlationId,
          revision: execution.revision,
          sequence: execution.sequence,
        })) return false;

    if (!validId(reconciliation.id) || !validId(reconciliation.externalPlanId)
        || !validId(reconciliation.correlationId) || !isReconciliationStatus(reconciliation.status)
        || reconciliation.status !== 'EXACT' || !isValidUtcMillis(reconciliation.observedAtMs)
        || reconciliation.observedAtMs < execution.observedAtMs || reconciliation.observedAtMs > nowMs
        || !validReferenceSequence(reconciliation.sequence) || !validReferenceRevision(reconciliation.revision)
        || truthValidUntil(reconciliation.truth, nowMs) === null
        || reconciliation.externalPlanId !== execution.externalPlanId
        || reconciliation.correlationId !== execution.correlationId
        || (execution.sequence !== null && reconciliation.sequence !== null
          && reconciliation.sequence < execution.sequence)
        || reconciliation.id !== deriveReconciliationReferenceId({
          externalPlanId: reconciliation.externalPlanId,
          correlationId: reconciliation.correlationId,
          revision: reconciliation.revision,
          sequence: reconciliation.sequence,
        })) return false;

    const projected = projectActivePosition({
      id: position.id,
      revision: position.revision,
      mandateId: position.mandateId,
      thesis: position.thesis,
      sourceState: position.state,
      sourceCapitalLifecycle: position.capitalLifecycle,
      legs: position.legs,
      oneLegSinceMs: position.oneLegSinceMs,
      executionState: {
        externalPlanId: execution.externalPlanId,
        correlationId: execution.correlationId,
        lifecycle: execution.lifecycle,
        observedAtMs: execution.observedAtMs,
        sequence: execution.sequence,
        revision: execution.revision,
        truth: execution.truth,
      },
      reconciliationState: {
        externalPlanId: reconciliation.externalPlanId,
        correlationId: reconciliation.correlationId,
        status: reconciliation.status,
        observedAtMs: reconciliation.observedAtMs,
        sequence: reconciliation.sequence,
        revision: reconciliation.revision,
        reasonCodes: reconciliation.reasonCodes,
        truth: reconciliation.truth,
      },
      outstandingActionIntentIds: position.outstandingActionIntentIds,
      openedAtMs: position.openedAtMs,
      lastTransitionAtMs: position.lastTransitionAtMs,
      truth: position.truth,
      projectedAtMs: position.truth.evaluatedAtMs,
    });
    return capitalDigest(projected.position) === capitalDigest(position);
  } catch {
    return false;
  }
}

export function reduceReservationBook(
  book: Readonly<ReservationBook>,
  command: Readonly<ReservationCommand>,
): ReservationReduction {
  if (!isReservationCommandKind((command as { readonly kind?: unknown })?.kind)) {
    const event = unknownMutation(command, ['COMMAND_KIND_UNKNOWN']);
    const priorUnknown = validId(event.commandId)
      ? book.mutations.find((entry) => entry.commandId === event.commandId)
      : undefined;
    if (priorUnknown !== undefined) {
      if (priorUnknown.commandDigest !== event.commandDigest) {
        return Object.freeze({ book, mutation: Object.freeze({ ...event, reasonCodes: Object.freeze(['IDEMPOTENCY_KEY_REUSE_MISMATCH']) }) });
      }
      return Object.freeze({ book, mutation: Object.freeze({ ...priorUnknown, status: 'IDEMPOTENT_REPLAY' }) });
    }
    return finalize(book, book.reservations, event);
  }
  const prior = book.mutations.find((entry) => entry.commandId === command.commandId);
  if (prior !== undefined) {
    if (prior.commandDigest !== capitalDigest(command)) {
      return Object.freeze({
        book,
        mutation: mutation(command, 'REJECTED', prior.reservationId, prior.revision, ZERO, ZERO, ['IDEMPOTENCY_KEY_REUSE_MISMATCH']),
      });
    }
    return Object.freeze({ book, mutation: Object.freeze({ ...prior, status: 'IDEMPOTENT_REPLAY' }) });
  }
  if (!validId(command.commandId) || !isValidUtcMillis(command.nowMs)) {
    return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, ['COMMAND_INVALID']));
  }

  if (command.kind === 'RESERVE') {
    const reasons: string[] = [];
    const authority = verifyAllocationReplayReceipt(command);
    reasons.push(...authority.reasons);
    if (!validId(command.capitalClaimKey)) reasons.push('CAPITAL_CLAIM_KEY_INVALID');
    if (reasons.length > 0) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, reasons));
    }
    if (book.reservations.some((entry) => entry.reservation.allocationDecisionId === command.allocation.id)) reasons.push('ALLOCATION_ALREADY_RESERVED');
    if (book.reservations.some((entry) => liveClaim(entry, command.nowMs)
        && entry.reservation.considerationId === command.allocation.considerationId)) {
      reasons.push('CONSIDERATION_ALREADY_RESERVED');
    }
    if (book.reservations.some((entry) => liveClaim(entry, command.nowMs)
        && entry.capitalClaimKey === command.capitalClaimKey)) reasons.push('CAPITAL_CLAIM_ALREADY_RESERVED');
    const allocationPolicy = command.allocationInput.policy;
    const ttlExpiry = command.nowMs + allocationPolicy.reservationTtlMs.value;
    if (!isValidUtcMillis(ttlExpiry) || authority.validUntilMs === null) {
      reasons.push('EXPIRY_INVALID');
    }
    const expiresAtMs = authority.validUntilMs === null ? null : Math.min(ttlExpiry, authority.validUntilMs);
    if (expiresAtMs !== null && expiresAtMs <= command.nowMs) reasons.push('DECISION_EXPIRED');
    if (reasons.length > 0) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, reasons));
    }
    if (expiresAtMs === null || authority.validUntilMs === null) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, ['EXPIRY_INVALID']));
    }
    // No reservation state changes, including expiry sweeping, occur until the
    // entire command, replay receipt, claim, collision set, and event window
    // have been validated. Rejected future-dated commands remain audit-only.
    const currentBook = sweepExpiredReservations(book, command);
    const id = deriveCapitalReservationId({ allocationDecisionId: command.allocation.id, capitalClaimKey: command.capitalClaimKey });
    const reservation: Readonly<CapitalReservation> = Object.freeze({
      id,
      allocationDecisionId: command.allocation.id,
      considerationId: command.allocation.considerationId,
      amount: command.allocation.grantedAmount,
      consumedAmount: ZERO,
      valuationAsset: command.allocation.valuationAsset,
      state: 'ACTIVE',
      createdAtMs: command.nowMs,
      expiresAtMs,
      releasedAtMs: null,
      revision: 1,
      idempotencyKey: command.commandId,
    });
    const managed: Readonly<ManagedCapitalReservation> = Object.freeze({
      reservation,
      capitalClaimKey: command.capitalClaimKey,
      unconsumedReleased: false,
      closedExposureReleased: false,
      policyRevision: allocationPolicy.authority.revision,
      policyReservationTtlMs: allocationPolicy.reservationTtlMs.value,
      decisionValidUntilMs: authority.validUntilMs,
      allocationReplayReceiptDigest: command.authority.digest,
      lastTransitionAtMs: command.nowMs,
    });
    return finalize(currentBook, [...currentBook.reservations, managed], mutation(command, 'APPLIED', id, 1, ZERO, ZERO, []));
  }

  const managed = book.reservations.find((entry) => entry.reservation.id === command.reservationId);
  if (managed === undefined) return finalize(book, book.reservations, mutation(command, 'REJECTED', command.reservationId, null, ZERO, ZERO, ['RESERVATION_NOT_FOUND']));
  if (command.nowMs < managed.reservation.createdAtMs || command.nowMs < managed.lastTransitionAtMs) {
    return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['COMMAND_TIME_NOT_MONOTONIC']));
  }

  if (command.kind !== 'CLOSE_RELEASE' && managed.reservation.state === 'ACTIVE' && command.nowMs >= managed.reservation.expiresAtMs) {
    const expired = terminalize(managed, 'EXPIRED', command.nowMs, false);
    return withReservation(book, expired.managed, mutation(command, 'APPLIED', managed.reservation.id, expired.managed.reservation.revision, expired.released, ZERO, ['RESERVATION_EXPIRED_BEFORE_COMMAND']));
  }

  if (command.kind === 'CLOSE_RELEASE') {
    if (managed.closedExposureReleased) {
      return finalize(book, book.reservations, mutation(command, 'NOOP_ALREADY_TERMINAL', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['CLOSED_CAPITAL_ALREADY_RELEASED']));
    }
    const closure = command.closure;
    let consumedAmount: NonNegativeDecimal | null = null;
    try { consumedAmount = normalizeNonNegativeExactDecimal(closure?.consumedAmount); } catch { consumedAmount = null; }
    if (!closure || closure.reservationId !== managed.reservation.id
        || closure.allocationDecisionId !== managed.reservation.allocationDecisionId
        || closure.considerationId !== managed.reservation.considerationId
        || closure.capitalClaimKey !== managed.capitalClaimKey
        || !Number.isSafeInteger(closure.reservationRevision)
        || closure.reservationRevision !== managed.reservation.revision
        || consumedAmount !== closure.consumedAmount
        || consumedAmount !== managed.reservation.consumedAmount
        || !validClosureMandate(closure.mandate, managed, command.nowMs)
        || !validClosurePosition(closure.position, closure.mandate, managed, command.nowMs)) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['CLOSURE_RECONCILIATION_PROOF_REQUIRED']));
    }
    const closed = terminalize(managed, 'RELEASED', command.nowMs, true);
    return withReservation(book, closed.managed, mutation(command, 'APPLIED', managed.reservation.id, closed.managed.reservation.revision, closed.released, ZERO, ['CLOSED_CAPITAL_RELEASED']));
  }

  if (managed.reservation.state !== 'ACTIVE') {
    return finalize(book, book.reservations, mutation(command, 'NOOP_ALREADY_TERMINAL', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, [`RESERVATION_${managed.reservation.state}`]));
  }

  if (command.kind === 'CONSUME') {
    let amount: NonNegativeDecimal;
    try { amount = normalizeNonNegativeExactDecimal(command.amount); } catch {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['CONSUME_AMOUNT_INVALID']));
    }
    if (amount !== command.amount || !isExactPositive(amount) || compareExactDecimals(amount, remaining(managed.reservation)) > 0) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['CONSUME_AMOUNT_EXCEEDS_AVAILABLE']));
    }
    const consumed = normalizeNonNegativeExactDecimal(addExactDecimals(managed.reservation.consumedAmount, amount));
    const updated = Object.freeze({
      ...managed,
      lastTransitionAtMs: command.nowMs,
      reservation: Object.freeze({ ...managed.reservation, consumedAmount: consumed, revision: managed.reservation.revision + 1 }),
    });
    return withReservation(book, updated, mutation(command, 'APPLIED', managed.reservation.id, updated.reservation.revision, ZERO, amount, []));
  }

  if (command.kind === 'RENEW') {
    const authority = authorityValidity(command, command.nowMs);
    if (authority.reasons.length > 0 || authority.validUntilMs === null
        || command.policy.authority.revision !== managed.policyRevision
        || command.policy.reservationTtlMs.value !== managed.policyReservationTtlMs) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO,
        [...authority.reasons, 'RENEWAL_AUTHORITY_INVALID']));
    }
    const ttlExpiry = command.nowMs + managed.policyReservationTtlMs;
    const expiresAtMs = Math.min(ttlExpiry, managed.decisionValidUntilMs, authority.validUntilMs);
    if (!isValidUtcMillis(expiresAtMs) || expiresAtMs <= managed.reservation.expiresAtMs) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['RENEWAL_MUST_EXTEND']));
    }
    const updated = Object.freeze({
      ...managed,
      lastTransitionAtMs: command.nowMs,
      reservation: Object.freeze({ ...managed.reservation, expiresAtMs, revision: managed.reservation.revision + 1 }),
    });
    return withReservation(book, updated, mutation(command, 'APPLIED', managed.reservation.id, updated.reservation.revision, ZERO, ZERO, []));
  }

  if (command.kind === 'EXPIRE') {
    return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['RESERVATION_NOT_EXPIRED']));
  }

  if (command.kind === 'RELEASE') {
    if (command.reasonCode.trim().length === 0) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['RELEASE_REASON_MISSING']));
    }

    const released = terminalize(managed, 'RELEASED', command.nowMs, false);
    return withReservation(book, released.managed, mutation(command, 'APPLIED', managed.reservation.id, released.managed.reservation.revision, released.released, ZERO,
      [command.reasonCode]));
  }

  return finalize(book, book.reservations, unknownMutation(command, ['COMMAND_KIND_UNKNOWN']));
}
