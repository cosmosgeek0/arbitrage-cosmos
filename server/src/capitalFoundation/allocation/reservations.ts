import {
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  deriveAllocationDecisionId,
  deriveCapitalReservationId,
  isExactPositive,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type AllocationDecision,
  type CapitalBudgetPolicy,
  type CapitalReservation,
  type CapitalReservationId,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import { validateCapitalBudgetPolicy } from '../budgets/index.js';

export const RESERVATION_COMMAND_KINDS = ['RESERVE', 'CONSUME', 'RENEW', 'RELEASE', 'EXPIRE', 'CLOSE_RELEASE'] as const;
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

export interface ReserveCapitalCommand extends CommandBase, ReservationAuthorityInput {
  readonly kind: 'RESERVE';
  readonly allocation: Readonly<AllocationDecision>;
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
export interface ReservationClosureEvidence {
  readonly positionId: string;
  readonly positionRevision: string;
  readonly positionState: 'CLOSED';
  readonly reconciliationId: string;
  readonly reconciliationRevision: string;
  readonly reconciliationState: 'MATCHED';
  readonly reconciledAtMs: number;
  readonly remainingExposure: NonNegativeDecimal;
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
  readonly lastTransitionAtMs: number;
}

export const RESERVATION_OUTCOMES = ['APPLIED', 'IDEMPOTENT_REPLAY', 'REJECTED', 'NOOP_ALREADY_TERMINAL'] as const;
export type ReservationOutcomeStatus = (typeof RESERVATION_OUTCOMES)[number];

export interface ReservationMutation {
  readonly commandId: string;
  readonly commandDigest: string;
  readonly commandKind: ReservationCommandKind;
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
function validTime(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

function truthValidUntil(truth: Readonly<TruthMetadata>, nowMs: number): number | null {
  try {
    if (truth.completeness !== 'COMPLETE') return null;
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
    return Number.isSafeInteger(validUntil) && nowMs <= validUntil ? validUntil : null;
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
  const policyUntil = command.policy.authority.effectiveUntilMs ?? Number.MAX_SAFE_INTEGER;
  const validUntilMs = budgetUntil === null || considerationUntil === null
    ? null
    : Math.min(budgetUntil, considerationUntil, policyUntil);
  return Object.freeze({ reasons: Object.freeze([...new Set(reasons)].sort()), validUntilMs });
}

function allocationIsCanonical(
  allocation: Readonly<AllocationDecision>,
  authority: Readonly<ReservationAuthorityInput>,
  nowMs: number,
): boolean {
  try {
    const { policy } = authority;
    const requested = normalizeNonNegativeExactDecimal(allocation.requestedAmount);
    const granted = normalizeNonNegativeExactDecimal(allocation.grantedAmount);
    if (requested !== allocation.requestedAmount || granted !== allocation.grantedAmount || !isExactPositive(granted)) return false;
    if (allocation.status === 'BLOCKED') return false;
    if (allocation.status === 'GRANTED' && compareExactDecimals(granted, requested) !== 0) return false;
    if (allocation.status === 'CAPPED' && compareExactDecimals(granted, requested) >= 0) return false;
    if (allocation.policyRevision !== policy.authority.revision || allocation.valuationAsset !== policy.valuationAsset) return false;
    if (authority.budgetTruth.evaluatedAtMs !== allocation.decidedAtMs
        || authority.considerationTruth.evaluatedAtMs !== allocation.decidedAtMs) return false;
    if (!validTime(allocation.decidedAtMs) || allocation.decidedAtMs > nowMs
        || allocation.decidedAtMs < policy.authority.effectiveFromMs
        || (policy.authority.effectiveUntilMs !== null && allocation.decidedAtMs >= policy.authority.effectiveUntilMs)) return false;
    return allocation.id === deriveAllocationDecisionId({
      considerationId: allocation.considerationId,
      policyRevision: allocation.policyRevision,
      nowMs: allocation.decidedAtMs,
      grant: allocation.grantedAmount,
    });
  } catch {
    return false;
  }
}

function liveClaim(entry: Readonly<ManagedCapitalReservation>): boolean {
  return entry.reservation.state === 'ACTIVE'
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
    appliedAtMs: command.nowMs,
  });
}

function finalize(
  book: Readonly<ReservationBook>,
  entries: readonly Readonly<ManagedCapitalReservation>[],
  event: Readonly<ReservationMutation>,
): ReservationReduction {
  const next = Object.freeze({
    reservations: Object.freeze([...entries].sort((a, b) => a.reservation.id.localeCompare(b.reservation.id))),
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
      lastTransitionAtMs: nowMs,
    }),
    released,
  });
}

export function reduceReservationBook(
  book: Readonly<ReservationBook>,
  command: Readonly<ReservationCommand>,
): ReservationReduction {
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
  if (!validId(command.commandId) || !validTime(command.nowMs)) {
    return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, ['COMMAND_INVALID']));
  }

  if (command.kind === 'RESERVE') {
    const reasons: string[] = [];
    const authority = authorityValidity(command, command.nowMs);
    reasons.push(...authority.reasons);
    if (!validId(command.capitalClaimKey)) reasons.push('CAPITAL_CLAIM_KEY_INVALID');
    if (!allocationIsCanonical(command.allocation, command, command.nowMs)) reasons.push('ALLOCATION_NOT_CURRENT_OR_CANONICAL');
    if (book.reservations.some((entry) => entry.reservation.allocationDecisionId === command.allocation.id)) reasons.push('ALLOCATION_ALREADY_RESERVED');
    if (book.reservations.some((entry) => liveClaim(entry) && entry.reservation.considerationId === command.allocation.considerationId)) {
      reasons.push('CONSIDERATION_ALREADY_RESERVED');
    }
    if (book.reservations.some((entry) => liveClaim(entry) && entry.capitalClaimKey === command.capitalClaimKey)) reasons.push('CAPITAL_CLAIM_ALREADY_RESERVED');
    if (reasons.length > 0) return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, reasons));
    const ttlExpiry = command.nowMs + command.policy.reservationTtlMs.value;
    if (!Number.isSafeInteger(ttlExpiry) || authority.validUntilMs === null) {
      return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, ['EXPIRY_INVALID']));
    }
    const expiresAtMs = Math.min(ttlExpiry, authority.validUntilMs);
    if (expiresAtMs <= command.nowMs) return finalize(book, book.reservations, mutation(command, 'REJECTED', null, null, ZERO, ZERO, ['DECISION_EXPIRED']));
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
    const managed = Object.freeze({
      reservation,
      capitalClaimKey: command.capitalClaimKey,
      unconsumedReleased: false,
      closedExposureReleased: false,
      policyRevision: command.policy.authority.revision,
      policyReservationTtlMs: command.policy.reservationTtlMs.value,
      decisionValidUntilMs: authority.validUntilMs,
      lastTransitionAtMs: command.nowMs,
    });
    return finalize(book, [...book.reservations, managed], mutation(command, 'APPLIED', id, 1, ZERO, ZERO, []));
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
    let remainingExposure: NonNegativeDecimal | null = null;
    try { remainingExposure = normalizeNonNegativeExactDecimal(closure?.remainingExposure); } catch { remainingExposure = null; }
    if (!closure || !validId(closure.positionId) || !validId(closure.positionRevision)
        || closure.positionState !== 'CLOSED' || !validId(closure.reconciliationId)
        || !validId(closure.reconciliationRevision) || closure.reconciliationState !== 'MATCHED'
        || !validTime(closure.reconciledAtMs) || closure.reconciledAtMs < managed.reservation.createdAtMs
        || closure.reconciledAtMs > command.nowMs || remainingExposure !== closure.remainingExposure || remainingExposure !== ZERO) {
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
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= managed.reservation.expiresAtMs) {
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

  if (command.reasonCode.trim().length === 0) {
    return finalize(book, book.reservations, mutation(command, 'REJECTED', managed.reservation.id, managed.reservation.revision, ZERO, ZERO, ['RELEASE_REASON_MISSING']));
  }

  const released = terminalize(managed, 'RELEASED', command.nowMs, false);
  return withReservation(book, released.managed, mutation(command, 'APPLIED', managed.reservation.id, released.managed.reservation.revision, released.released, ZERO,
    [command.reasonCode]));
}
