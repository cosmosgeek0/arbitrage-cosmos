import {
  capitalDigest,
  compareExactDecimals,
  normalizeNonNegativeExactDecimal,
  projectFoundationRiskVerdict,
  subtractExactDecimals,
  type BoundRiskDecisionReference,
  type NonNegativeDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  evaluateOperatorApproval,
  reduceOperatorApprovalState,
  type OperatorApprovalState,
  type ScopedApprovalValidationContext,
} from '../../capitalFoundation/approvals/index.js';
import {
  createStructuredFailure,
  deriveEventId,
  derivePlanId,
  evaluateFreshness,
  isValidUtcMillis,
  validateCanonicalOpportunity,
  type RiskVerdict,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import {
  createExecutionCoordinator,
  createExecutionPlanDefinition,
  recommendExecutionRecovery,
  type CreateExecutionPlanInput,
  type ExecutionClock,
  type ExecutionDeadlineScheduler,
  type ExecutionPlanDefinition,
} from '../../foundation/execution/index.js';
import {
  deriveRiskIntentDigest,
  evaluateMultiLegRisk,
  type PlanIntent,
  type RiskEvaluationInput,
} from '../../foundation/risk/index.js';
import { reconcileExecutionState } from '../../foundation/reconciliation/index.js';
import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
} from '../contracts/constants.js';
import { createSealedDryRunVenueHarness } from './dryRunVenue.js';
import { VALIDATE_ONLY_EXECUTOR_COMPONENT_IDS } from './types.js';
import type {
  ValidateOnlyDisposition,
  ValidateOnlyExecutorReadinessEvidence,
  ValidateOnlyOrchestratorInput,
  ValidateOnlyOwnerInvocations,
  ValidateOnlyPersistencePort,
  ValidateOnlyPersistenceRecord,
  ValidateOnlyRunResult,
  ValidateOnlyRunSnapshot,
  ValidateOnlyVenueAudit,
} from './types.js';

const COMPONENT = 'systemIntegration.verticalSlice';
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BLOCKED_REFERENCE = 'unavailable-mode-blocked';
const EMPTY_VENUE_AUDIT: Readonly<ValidateOnlyVenueAudit> = Object.freeze({
  sealed: true,
  identityClaims: 0,
  preflightCalls: 0,
  validationCalls: 0,
  submissionCalls: 0,
  lookupCalls: 0,
  reconciliationCalls: 0,
  callOrder: Object.freeze([]),
});

const SYSTEM_EXECUTION_TIMER: Readonly<ExecutionDeadlineScheduler> = Object.freeze({
  schedule(delayMs: number, task: () => void) {
    const handle = setTimeout(task, delayMs);
    return Object.freeze({ cancel: () => clearTimeout(handle) });
  },
});

export function createSystemExecutionClock(
  nowMs: number,
  timer: Readonly<ExecutionDeadlineScheduler> = SYSTEM_EXECUTION_TIMER,
): Readonly<ExecutionClock> {
  let logicalNowMs = nowMs;
  return Object.freeze({
    nowMs: () => logicalNowMs,
    schedule(delayMs: number, task: () => void) {
      const deadlineAtMs = logicalNowMs + delayMs;
      if (!Number.isSafeInteger(deadlineAtMs)) throw new RangeError('execution deadline clock overflow');
      return timer.schedule(delayMs, () => {
        logicalNowMs = Math.max(logicalNowMs, deadlineAtMs);
        task();
      });
    },
  });
}

interface MutableOwnerInvocations {
  approvalEvaluations: number;
  approvalUseReductions: number;
  riskEvaluations: number;
  executionDefinitionsCreated: number;
  coordinatorsCreated: number;
  coordinatorPreflights: number;
  reconciliationEvaluations: number;
  recoveryEvaluations: number;
  persistenceReads: number;
  persistenceWrites: number;
}

interface SnapshotParts {
  disposition: ValidateOnlyDisposition;
  approvalDecision?: ValidateOnlyRunSnapshot['approvalDecision'];
  approvalState?: ValidateOnlyRunSnapshot['approvalState'];
  riskVerdict?: ValidateOnlyRunSnapshot['riskVerdict'];
  boundRiskDecision?: ValidateOnlyRunSnapshot['boundRiskDecision'];
  riskPlanBinding?: ValidateOnlyRunSnapshot['riskPlanBinding'];
  executionPlan?: ValidateOnlyRunSnapshot['executionPlan'];
  executionState?: ValidateOnlyRunSnapshot['executionState'];
  reconciliation?: ValidateOnlyRunSnapshot['reconciliation'];
  recoveryRecommendations?: ValidateOnlyRunSnapshot['recoveryRecommendations'];
  supervision?: ValidateOnlyRunSnapshot['supervision'];
  failure?: ValidateOnlyRunSnapshot['failure'];
  venueAudit?: Readonly<ValidateOnlyVenueAudit>;
  persistenceId?: string | null;
}

function nonEmpty(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;
}

function freezeInvocations(input: MutableOwnerInvocations): Readonly<ValidateOnlyOwnerInvocations> {
  return Object.freeze({ ...input });
}

function hasOwnerSuppliedCapitalDialect(input: ValidateOnlyOrchestratorInput): boolean {
  const dialect = input.capital.reservationDialect;
  return dialect.owner === 'CAPITAL_SUPERVISION' &&
    dialect.considerationMode === 'MANUAL_ARMED' &&
    dialect.source === 'OWNER_SUPPLIED_PREBUILT' &&
    dialect.syntheticOnly === true &&
    dialect.executionAuthority === 'NONE';
}

function failure(
  input: Pick<ValidateOnlyOrchestratorInput, 'nowMs' | 'correlationId'>,
  stage: string,
  code: string,
  message: string,
  action: string,
): Readonly<StructuredFailure> {
  return createStructuredFailure({
    component: COMPONENT,
    stage,
    code,
    message,
    occurredAt: input.nowMs,
    retryable: false,
    safeCurrentState: 'VALIDATE_ONLY_NO_EXECUTION_AUTHORITY',
    recommendedOperatorAction: action,
    correlationId: input.correlationId,
  });
}

function recordId(input: ValidateOnlyOrchestratorInput, disposition: ValidateOnlyDisposition): string {
  return deriveEventId({
    streamId: `validate-only:${input.correlationId}`,
    sequence: disposition === 'MODE_BLOCKED'
      ? capitalDigest({ eventClass: 'MODE_BLOCKED', evaluatedAtMs: input.nowMs })
      : capitalDigest({
          mandateId: input.capital.mandate.id,
          mandateRevision: input.capital.mandate.revision,
          approvalId: input.capital.approval.id,
          approvalUseIdempotencyKey: input.approvalUse.idempotencyKey,
        }),
  });
}

function baseSnapshot(
  input: ValidateOnlyOrchestratorInput,
  calls: MutableOwnerInvocations,
  parts: SnapshotParts,
): Readonly<ValidateOnlyRunSnapshot> {
  const modeBlocked = parts.disposition === 'MODE_BLOCKED';
  const dryRunObserved = parts.riskVerdict != null || parts.executionPlan != null || parts.supervision != null;
  const unavailableRiskTruth = parts.riskVerdict?.checks.some((check) => check.status === 'UNKNOWN') === true;
  const capitalDialectAvailable = !modeBlocked && hasOwnerSuppliedCapitalDialect(input);
  const blocked = parts.disposition !== 'READY';
  return Object.freeze({
    schema: 'cosmos.system-integration.validate-only.v2' as const,
    recordId: recordId(input, parts.disposition),
    disposition: parts.disposition,
    rootCorrelationId: input.correlationId,
    executionCorrelationId: parts.executionPlan?.correlationId ?? null,
    evaluatedAtMs: input.nowMs,
    operatorMode: 'VALIDATE_ONLY' as const,
    capitalReservationDialect: capitalDialectAvailable
      ? 'OWNER_SUPPLIED_MANUAL_ARMED_ENVELOPE' as const
      : 'UNAVAILABLE_OR_UNVALIDATED' as const,
    executionAuthority: 'NONE' as const,
    liveExecutionPermitted: false as const,
    truthLabels: dryRunObserved && !unavailableRiskTruth
      ? Object.freeze(['DRY_RUN', 'SYNTHETIC_ONLY'] as const)
      : Object.freeze(['UNAVAILABLE', 'SYNTHETIC_ONLY'] as const),
    releaseStatuses: blocked
      ? Object.freeze(['BUILT_AND_TESTED', 'SYNTHETIC_ONLY', 'BLOCKED'] as const)
      : Object.freeze(['BUILT_AND_TESTED', 'SYNTHETIC_ONLY'] as const),
    canonicalProposalId: modeBlocked ? BLOCKED_REFERENCE : input.canonicalProposal.canonicalId,
    sourceProposalId: modeBlocked ? BLOCKED_REFERENCE : input.canonicalProposal.sourceId,
    reservationId: modeBlocked ? BLOCKED_REFERENCE : input.capital.reservation.id,
    stagedPlanId: modeBlocked ? BLOCKED_REFERENCE : input.capital.stagedPlan.id,
    mandateId: modeBlocked ? BLOCKED_REFERENCE : input.capital.mandate.id,
    approvalId: modeBlocked ? BLOCKED_REFERENCE : input.capital.approval.id,
    approvalDecision: parts.approvalDecision ?? null,
    approvalState: parts.approvalState ?? null,
    riskVerdict: parts.riskVerdict ?? null,
    boundRiskDecision: parts.boundRiskDecision ?? null,
    riskPlanBinding: parts.riskPlanBinding ?? null,
    executionPlan: parts.executionPlan ?? null,
    executionState: parts.executionState ?? null,
    reconciliation: parts.reconciliation ?? null,
    recoveryRecommendations: Object.freeze([...(parts.recoveryRecommendations ?? [])]),
    supervision: parts.supervision ?? null,
    failure: parts.failure ?? null,
    ownerInvocations: freezeInvocations(calls),
    venueAudit: parts.venueAudit ?? EMPTY_VENUE_AUDIT,
    persistenceId: parts.persistenceId ?? null,
  });
}

export function classifyValidateOnlyRequestedMode(
  requestedMode: unknown,
): typeof LIVE_EXECUTION_NOT_IMPLEMENTED | 'VALIDATE_ONLY_REQUIRED' | null {
  const rawRequested = typeof requestedMode === 'string' ? requestedMode : '';
  const requested = rawRequested.length <= 128
    ? rawRequested.trim().toUpperCase()
    : rawRequested.slice(0, 128).trim().toUpperCase();
  const normalized = requested.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const requestsExecutionAuthority =
    (BLOCKED_EXECUTION_MODE_REQUESTS as readonly string[]).includes(normalized) ||
    normalized.split('_').some((token) => token === 'LIVE' || token === 'MANUAL' || token === 'AUTONOMOUS');
  if (requestsExecutionAuthority) {
    return LIVE_EXECUTION_NOT_IMPLEMENTED;
  }
  return requested === 'VALIDATE_ONLY' ? null : 'VALIDATE_ONLY_REQUIRED';
}

function modeFailure(input: ValidateOnlyOrchestratorInput): Readonly<StructuredFailure> | null {
  const classified = classifyValidateOnlyRequestedMode(input.requestedMode);
  if (classified === LIVE_EXECUTION_NOT_IMPLEMENTED) {
    return failure(
      input,
      'mode-gate',
      LIVE_EXECUTION_NOT_IMPLEMENTED,
      'A live, manual-armed, or autonomous execution mode is mechanically unavailable in the convergence slice.',
      'Use VALIDATE_ONLY. Live, manual-armed, and autonomous execution are not implemented.',
    );
  }
  return classified === 'VALIDATE_ONLY_REQUIRED'
    ? failure(
        input,
        'mode-gate',
        'VALIDATE_ONLY_REQUIRED',
        'This vertical slice runs only in VALIDATE_ONLY mode.',
        'Use the read/advisory surfaces without invoking the execution-validation slice.',
      )
    : null;
}

function exactAvailable(amount: NonNegativeDecimal, consumed: NonNegativeDecimal): NonNegativeDecimal | null {
  try {
    const normalizedAmount = normalizeNonNegativeExactDecimal(amount);
    const normalizedConsumed = normalizeNonNegativeExactDecimal(consumed);
    if (normalizedAmount !== amount || normalizedConsumed !== consumed || compareExactDecimals(consumed, amount) > 0) return null;
    return normalizeNonNegativeExactDecimal(subtractExactDecimals(amount, consumed));
  } catch {
    return null;
  }
}

function semanticDigest<T extends { readonly digest: string }>(value: Readonly<T>): string {
  const { digest: _digest, ...semantic } = value;
  return capitalDigest(semantic);
}

function syntheticReconciliationEvidence(input: ValidateOnlyOrchestratorInput): boolean {
  return ['orders', 'fills', 'positions'].every((key) => {
    const collection = input.reconciliationEvidence[key as keyof typeof input.reconciliationEvidence];
    return collection.metadata.authority === 'SYNTHETIC_TEST';
  });
}

function privateRiskEvidenceIsSynthetic(input: ValidateOnlyOrchestratorInput): boolean {
  const stamps: unknown[] = [];
  const push = (stamp: unknown): void => { if (stamp !== null && stamp !== undefined) stamps.push(stamp); };
  push(input.capital.approvalObservedAt);
  push(input.capital.controlPosture?.truth?.source);
  push(input.riskEvidence.killSwitch?.observedAt);
  push(input.riskEvidence.account?.permissions?.observedAt);
  for (const row of input.riskEvidence.account?.spotInventory ?? []) push(row.observedAt);
  push(input.riskEvidence.account?.exposures?.observedAt);
  for (const row of input.riskEvidence.account?.exposures?.positions ?? []) push(row.observedAt);
  for (const row of input.riskEvidence.account?.marginHeadrooms ?? []) push(row.observedAt);
  for (const row of input.riskEvidence.account?.liquidations ?? []) push(row.observedAt);
  push(input.riskEvidence.account?.dailyStatsObservedAt);
  push(input.riskEvidence.account?.openOrders?.observedAt);
  push(input.riskEvidence.borrow?.observedAt);
  push(input.riskEvidence.existingPlans?.observedAt);
  push(input.riskEvidence.cooldown?.observedAt);
  return stamps.every((stamp) =>
    typeof stamp === 'object' && stamp !== null && (stamp as { readonly authority?: unknown }).authority === 'SYNTHETIC_TEST');
}

function projectedNotionalIsBound(
  exact: NonNegativeDecimal,
  intendedPrice: number,
  quantity: number,
  mandateMaximum: NonNegativeDecimal,
): boolean {
  try {
    if (!Number.isFinite(intendedPrice) || intendedPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) return false;
    const normalized = normalizeNonNegativeExactDecimal(exact);
    if (normalized !== exact || compareExactDecimals(exact, mandateMaximum) > 0) return false;
    const projected = Number(exact);
    if (!Number.isFinite(projected)) return false;
    const product = intendedPrice * quantity;
    const tolerance = Math.max(1e-12, Math.abs(projected) * 1e-12);
    return Number.isFinite(product) && Math.abs(product - projected) <= tolerance;
  } catch {
    return false;
  }
}

function inputFailure(input: ValidateOnlyOrchestratorInput): Readonly<StructuredFailure> | null {
  const proposal = input.canonicalProposal;
  const capital = input.capital;
  const reservation = capital.reservation;
  const plan = capital.stagedPlan;
  const mandate = capital.mandate;
  const approval = capital.approval;
  const sourceProposal = capital.sourceProposal;

  if (
    capitalDigest(capital.approvalState.approval) !== capitalDigest(approval) ||
    capital.approvalState.sourcePolicyDigest !== capital.approvalPolicy.authority.revision ||
    !Number.isSafeInteger(capital.approvalState.revision) ||
    capital.approvalState.revision < 1 ||
    !Array.isArray(capital.approvalState.uses)
  ) {
    return failure(input, 'input', 'APPROVAL_STATE_BINDING_INVALID', 'The supplied approval is not the exact revisioned Capital owner state for the supplied policy.', 'Restore the latest Capital approval state before validation or retry.');
  }

  const proposalIssues = validateCanonicalOpportunity(proposal);
  if (proposalIssues.length > 0 || proposal.kind !== 'PROPOSAL' || proposal.source !== 'BASIS') {
    return failure(input, 'input', 'CANONICAL_BASIS_PROPOSAL_REQUIRED', 'A valid canonical Basis proposal is required.', 'Refresh the canonical engine projection.');
  }
  if (
    sourceProposal.strategy !== 'BASIS' ||
    sourceProposal.sourceProposalId !== proposal.sourceId ||
    sourceProposal.canonicalProposalId !== proposal.canonicalId ||
    sourceProposal.sourceCorrelationId !== input.correlationId ||
    sourceProposal.symbol !== proposal.symbol ||
    sourceProposal.direction !== proposal.direction ||
    sourceProposal.sourceLifecycle !== proposal.sourceLifecycle ||
    sourceProposal.sourceConfigRevision !== proposal.configVersion ||
    sourceProposal.expiresAtMs !== proposal.expiresAtMs
  ) {
    return failure(input, 'input', 'CANONICAL_SOURCE_BINDING_INVALID', 'The canonical Basis projection is not exactly bound to the Capital owner source-proposal reference and root correlation.', 'Rebuild the directional proposal adapter from the unchanged Basis owner record.');
  }
  if (proposal.lifecycle !== 'OPEN' || proposal.expiresAtMs === null || input.nowMs >= proposal.expiresAtMs) {
    return failure(input, 'input', 'PROPOSAL_NOT_CURRENT', 'The canonical proposal is not open with a current machine expiry.', 'Obtain a fresh open Basis proposal.');
  }
  try {
    if (evaluateFreshness(proposal.observedAt, input.nowMs).state !== 'FRESH') {
      return failure(input, 'input', 'PROPOSAL_NOT_CURRENT', 'The canonical proposal observation is not fresh.', 'Refresh the Basis proposal before validation.');
    }
  } catch {
    return failure(input, 'input', 'PROPOSAL_NOT_CURRENT', 'The canonical proposal freshness contract is invalid.', 'Refresh the Basis proposal before validation.');
  }

  if (
    capital.reservationDialect.owner !== 'CAPITAL_SUPERVISION' ||
    capital.reservationDialect.considerationMode !== 'MANUAL_ARMED' ||
    capital.reservationDialect.source !== 'OWNER_SUPPLIED_PREBUILT' ||
    capital.reservationDialect.syntheticOnly !== true ||
    capital.reservationDialect.executionAuthority !== 'NONE'
  ) {
    return failure(input, 'input', 'CAPITAL_RESERVATION_DIALECT_INVALID', 'Capital reservation authority must be an owner-supplied synthetic MANUAL_ARMED envelope with no execution authority.', 'Supply the untouched Capital owner records; never translate VALIDATE_ONLY into MANUAL_ARMED.');
  }

  const available = exactAvailable(reservation.amount, reservation.consumedAmount);
  if (
    reservation.state !== 'ACTIVE' ||
    reservation.releasedAtMs !== null ||
    !isValidUtcMillis(reservation.createdAtMs) ||
    !isValidUtcMillis(reservation.expiresAtMs) ||
    reservation.createdAtMs > input.nowMs ||
    reservation.expiresAtMs <= input.nowMs ||
    available === null
  ) {
    return failure(input, 'input', 'CAPITAL_RESERVATION_NOT_CURRENT', 'The supplied Capital reservation is inactive, expired, released, or malformed.', 'Rebuild the reservation through Capital Supervision.');
  }

  if (
    semanticDigest(plan) !== plan.digest ||
    plan.activeStage !== 'OBSERVE' ||
    plan.reservationId !== reservation.id ||
    plan.reservationRevision !== reservation.revision ||
    plan.reservationConsiderationId !== reservation.considerationId ||
    plan.remainingReservedAmount !== available ||
    plan.expiresAtMs <= input.nowMs
  ) {
    return failure(input, 'input', 'STAGED_PLAN_BINDING_INVALID', 'The staged plan is not the current OBSERVE-stage projection of the supplied reservation.', 'Rebuild the staged plan through Capital Supervision.');
  }

  if (
    semanticDigest(mandate) !== mandate.digest ||
    mandate.reservationId !== reservation.id ||
    mandate.allocationDecisionId !== reservation.allocationDecisionId ||
    mandate.considerationId !== reservation.considerationId ||
    mandate.stagedPlanId !== plan.id ||
    mandate.stagedPlanRevision !== plan.revision ||
    mandate.stagedPlanDigest !== plan.digest ||
    mandate.proposalIntakeDigest !== plan.proposalIntakeDigest ||
    mandate.configRevision !== plan.configRevision ||
    mandate.valuationAsset !== reservation.valuationAsset ||
    mandate.approvalId !== null ||
    mandate.riskDecision !== null ||
    mandate.expiresAtMs <= input.nowMs
  ) {
    return failure(input, 'input', 'CAPITAL_MANDATE_BINDING_INVALID', 'The mandate is not the untouched content-bound projection of the reservation and staged plan.', 'Rebuild the mandate through Capital Supervision.');
  }

  if (
    approval.mode !== 'VALIDATE_ONLY' ||
    approval.proposalId !== sourceProposal.sourceProposalId ||
    approval.proposalRevision !== sourceProposal.sourceRevision ||
    approval.proposalIntakeDigest !== sourceProposal.intakeDigest ||
    sourceProposal.intakeDigest !== mandate.proposalIntakeDigest ||
    approval.mandateId !== mandate.id ||
    approval.mandateRevision !== mandate.revision ||
    approval.mandateDigest !== mandate.digest ||
    approval.stagedPlanId !== plan.id ||
    approval.stagedPlanRevision !== plan.revision ||
    approval.stagedPlanDigest !== plan.digest ||
    approval.configRevision !== mandate.configRevision ||
    approval.valuationAsset !== mandate.valuationAsset ||
    !nonEmpty(approval.useScopeKey) ||
    approval.expiresAtMs > mandate.expiresAtMs ||
    approval.expiresAtMs > plan.expiresAtMs ||
    approval.expiresAtMs > reservation.expiresAtMs
  ) {
    return failure(input, 'input', 'VALIDATE_ONLY_APPROVAL_BINDING_INVALID', 'The approval is not exact VALIDATE_ONLY authority for the supplied proposal, mandate, plan, and reservation.', 'Issue a fresh bounded VALIDATE_ONLY approval.');
  }

  if (
    capital.approvalPolicy.strategy !== 'BASIS' ||
    capital.approvalPolicy.configRevision !== mandate.configRevision ||
    !capital.approvalPolicy.symbols.includes(proposal.symbol) ||
    input.approvalUse.instrumentIds.length === 0 ||
    !input.approvalUse.instrumentIds.every((id) => nonEmpty(id) && approval.instruments.includes(id)) ||
    !nonEmpty(input.approvalUse.idempotencyKey) ||
    !nonEmpty(input.approvalUse.actionClass) ||
    (input.approvalUse.stage !== null && !nonEmpty(input.approvalUse.stage))
  ) {
    return failure(input, 'input', 'APPROVAL_USE_SCOPE_INVALID', 'The approval use is not a bounded exact Basis scope.', 'Supply the exact action, stage, instruments, and idempotency key.');
  }

  if (
    !projectedNotionalIsBound(input.executionTerms.spot.quoteNotional, input.executionTerms.spot.intendedPrice, input.executionTerms.spot.quantity, mandate.targetMaximumExposure) ||
    !projectedNotionalIsBound(input.executionTerms.perpetual.quoteNotional, input.executionTerms.perpetual.intendedPrice, input.executionTerms.perpetual.quantity, mandate.targetMaximumExposure)
  ) {
    return failure(input, 'input', 'EXECUTION_TERMS_OUTSIDE_MANDATE', 'Dry-run leg quantities/prices do not match their exact Capital notionals or exceed the mandate.', 'Rebuild bounded dry-run terms from the current mandate and public market evidence.');
  }

  if (
    !nonEmpty(input.executionTerms.accountId) ||
    !Number.isSafeInteger(input.executionTerms.attempt) ||
    input.executionTerms.attempt < 0 ||
    !Number.isSafeInteger(input.executionTerms.maxNakedDurationMs) ||
    input.executionTerms.maxNakedDurationMs <= 0
  ) {
    return failure(input, 'input', 'EXECUTION_TERMS_INVALID', 'Dry-run execution terms are malformed.', 'Supply bounded deterministic execution terms.');
  }

  if (!privateRiskEvidenceIsSynthetic(input) || !syntheticReconciliationEvidence(input)) {
    return failure(input, 'input', 'SYNTHETIC_ONLY_EVIDENCE_REQUIRED', 'The validation slice requires SYNTHETIC_TEST private/control/account and reconciliation evidence.', 'Supply injected SYNTHETIC_TEST evidence only for private/control/account and reconciliation truth.');
  }
  if (input.supervision !== null && (
    !CORRELATION_ID.test(input.supervision.rootCorrelationId) ||
    input.supervision.truthLabel !== 'SYNTHETIC_ONLY' ||
    input.supervision.executionAuthority !== 'NONE' ||
    !nonEmpty(input.supervision.state?.plan?.planId) ||
    !CORRELATION_ID.test(input.supervision.state?.plan?.correlationId ?? '') ||
    (input.supervision.state?.plan?.mode !== 'VALIDATE_ONLY' && input.supervision.state?.plan?.mode !== 'PAPER')
  )) {
    return failure(input, 'input', 'SUPERVISION_BINDING_INVALID', 'Prior execution supervision must be a separately correlated synthetic VALIDATE_ONLY/PAPER Foundation state with no execution authority.', 'Restore the exact prior Foundation checkpoint as a non-executable supervision reference.');
  }
  return null;
}

function executionDirection(proposal: ValidateOnlyOrchestratorInput['canonicalProposal']): CreateExecutionPlanInput['direction'] | null {
  if (proposal.direction === 'long_spot_short_perp') return 'LONG_SPOT_SHORT_PERP';
  if (proposal.direction === 'short_spot_long_perp') return 'SHORT_SPOT_LONG_PERP';
  return null;
}

function planInput(input: ValidateOnlyOrchestratorInput): CreateExecutionPlanInput | null {
  const direction = executionDirection(input.canonicalProposal);
  if (direction === null || input.canonicalProposal.expiresAtMs === null) return null;
  return {
    strategy: 'BASIS',
    direction,
    symbol: input.canonicalProposal.symbol,
    proposal: {
      canonicalProposalId: input.canonicalProposal.canonicalId,
      observedAtMs: input.canonicalProposal.observedAt.sourceTimeMs ?? input.canonicalProposal.observedAt.receivedAtMs,
      maxAgeMs: input.canonicalProposal.observedAt.maxAgeMs,
      expiresAtMs: input.canonicalProposal.expiresAtMs,
    },
    attempt: input.executionTerms.attempt,
    mode: 'VALIDATE_ONLY',
    requiresApproval: true,
    maxNakedDurationMs: input.executionTerms.maxNakedDurationMs,
    spotQuantity: input.executionTerms.spot.quantity,
    perpQuantity: input.executionTerms.perpetual.quantity,
  };
}

function riskIntent(input: ValidateOnlyOrchestratorInput, externalPlanId: string): Readonly<PlanIntent> | null {
  const direction = executionDirection(input.canonicalProposal);
  if (direction === null) return null;
  const reverse = direction === 'SHORT_SPOT_LONG_PERP';
  return Object.freeze({
    planId: externalPlanId,
    accountId: input.executionTerms.accountId,
    proposalRef: input.canonicalProposal.canonicalId,
    riskClass: 'RISK_INCREASING' as const,
    legs: Object.freeze([
      Object.freeze({
        legKey: reverse ? 'SPOT_SELL' : 'SPOT_BUY',
        venue: 'BINANCE_SPOT' as const,
        symbol: input.canonicalProposal.symbol,
        positionBucket: reverse ? 'MARGIN_CROSS' as const : 'SPOT_CASH' as const,
        side: reverse ? 'SELL' as const : 'BUY' as const,
        intendedPrice: input.executionTerms.spot.intendedPrice,
        intendedQty: input.executionTerms.spot.quantity,
        requiredPermission: reverse ? 'MARGIN' as const : 'SPOT' as const,
        estimatedRequiredMarginUsd: input.executionTerms.spot.estimatedRequiredMarginUsd,
      }),
      Object.freeze({
        legKey: reverse ? 'PERP_BUY' : 'PERP_SELL',
        venue: 'BINANCE_USDM' as const,
        symbol: input.canonicalProposal.symbol,
        positionBucket: 'USDM_ONE_WAY' as const,
        side: reverse ? 'BUY' as const : 'SELL' as const,
        intendedPrice: input.executionTerms.perpetual.intendedPrice,
        intendedQty: input.executionTerms.perpetual.quantity,
        requiredPermission: 'FUTURES' as const,
        estimatedRequiredMarginUsd: input.executionTerms.perpetual.estimatedRequiredMarginUsd,
      }),
    ]),
    declaredMaxNakedDurationMs: input.executionTerms.maxNakedDurationMs,
    estimatedRequiredMarginUsd: input.executionTerms.estimatedRequiredMarginUsd,
    requiredBorrowUsd: input.executionTerms.requiredBorrowUsd,
  });
}

function approvalContext(
  input: ValidateOnlyOrchestratorInput,
): Readonly<ScopedApprovalValidationContext> {
  return Object.freeze({
    nowMs: input.nowMs,
    proposalId: input.capital.approval.proposalId,
    proposalRevision: input.capital.approval.proposalRevision,
    proposalIntakeDigest: input.capital.mandate.proposalIntakeDigest,
    mandateId: input.capital.mandate.id,
    mandateRevision: input.capital.mandate.revision,
    mandateDigest: input.capital.mandate.digest,
    stagedPlanId: input.capital.stagedPlan.id,
    stagedPlanRevision: input.capital.stagedPlan.revision,
    stagedPlanDigest: input.capital.stagedPlan.digest,
    configRevision: input.capital.mandate.configRevision,
    actionClass: input.approvalUse.actionClass,
    requestedNotional: input.capital.mandate.targetMaximumExposure,
    stage: input.approvalUse.stage,
    useScopeKey: input.capital.approval.useScopeKey,
    strategy: 'BASIS' as const,
    symbols: Object.freeze([input.canonicalProposal.symbol]),
    instruments: Object.freeze([...input.approvalUse.instrumentIds]),
    controlPosture: input.capital.controlPosture,
    correlationId: input.correlationId,
  });
}

function boundRiskDecision(
  input: ValidateOnlyOrchestratorInput,
  externalPlanId: string,
  executionCorrelationId: string,
  verdict: Readonly<RiskVerdict>,
): Readonly<BoundRiskDecisionReference> {
  return Object.freeze({
    decisionId: deriveEventId({
      streamId: `risk:${externalPlanId}`,
      sequence: `${input.capital.mandate.id}:${input.capital.mandate.revision}:${verdict.evaluatedAt}`,
    }),
    mandateId: input.capital.mandate.id,
    mandateRevision: input.capital.mandate.revision,
    mandateDigest: input.capital.mandate.digest,
    externalPlanId,
    correlationId: executionCorrelationId,
    verdict: projectFoundationRiskVerdict(verdict),
  });
}

function exactExecutionTermsDigest(input: ValidateOnlyOrchestratorInput): string {
  return capitalDigest({
    accountId: input.executionTerms.accountId,
    attempt: input.executionTerms.attempt,
    maxNakedDurationMs: input.executionTerms.maxNakedDurationMs,
    spot: {
      intendedPrice: input.executionTerms.spot.intendedPrice,
      quantity: input.executionTerms.spot.quantity,
      quoteNotional: input.executionTerms.spot.quoteNotional,
      estimatedRequiredMarginUsd: input.executionTerms.spot.estimatedRequiredMarginUsd,
    },
    perpetual: {
      intendedPrice: input.executionTerms.perpetual.intendedPrice,
      quantity: input.executionTerms.perpetual.quantity,
      quoteNotional: input.executionTerms.perpetual.quoteNotional,
      estimatedRequiredMarginUsd: input.executionTerms.perpetual.estimatedRequiredMarginUsd,
    },
    estimatedRequiredMarginUsd: input.executionTerms.estimatedRequiredMarginUsd,
    requiredBorrowUsd: input.executionTerms.requiredBorrowUsd,
  });
}

function bindRiskToPlan(
  input: ValidateOnlyOrchestratorInput,
  intent: Readonly<PlanIntent>,
  definition: Readonly<ExecutionPlanDefinition>,
  decision: Readonly<BoundRiskDecisionReference>,
): NonNullable<ValidateOnlyRunSnapshot['riskPlanBinding']> {
  return Object.freeze({
    planId: definition.planId,
    executionCorrelationId: definition.correlationId,
    foundationTermsFingerprint: definition.termsFingerprint,
    riskDecisionId: decision.decisionId,
    mandateDigest: input.capital.mandate.digest,
    riskIntentDigest: deriveRiskIntentDigest(intent),
    executionTermsDigest: exactExecutionTermsDigest(input),
  });
}

function riskInput(
  input: ValidateOnlyOrchestratorInput,
  intent: Readonly<PlanIntent>,
): RiskEvaluationInput {
  const intentDigest = deriveRiskIntentDigest(intent);
  return {
    ...input.riskEvidence,
    correlationId: input.correlationId,
    nowMs: input.nowMs,
    intent,
    proposal: {
      proposalId: input.canonicalProposal.canonicalId,
      entryIntentDigest: intentDigest,
      lifecycle: input.canonicalProposal.lifecycle,
      expiresAtMs: input.canonicalProposal.expiresAtMs,
      observedAt: input.canonicalProposal.observedAt,
    },
    approval: {
      approvalId: input.capital.approval.id,
      subjectPlanId: intent.planId,
      authorizedRiskClass: 'RISK_INCREASING',
      intentDigest,
      grantedAtMs: input.capital.approval.issuedAtMs,
      expiresAtMs: input.capital.approval.expiresAtMs,
      observedAt: input.capital.approvalObservedAt,
    },
  };
}

function planMatchesRiskIntent(plan: Readonly<ExecutionPlanDefinition>, intent: Readonly<PlanIntent>): boolean {
  if (plan.planId !== intent.planId || plan.symbol !== intent.legs[0]?.symbol || plan.mode !== 'VALIDATE_ONLY') return false;
  const spot = intent.legs.find((leg) => leg.venue === 'BINANCE_SPOT');
  const perpetual = intent.legs.find((leg) => leg.venue === 'BINANCE_USDM');
  return Boolean(
    spot && perpetual &&
    plan.openingLegs.SPOT.side === spot.side &&
    plan.openingLegs.SPOT.quantity === spot.intendedQty &&
    plan.openingLegs.PERP.side === perpetual.side &&
    plan.openingLegs.PERP.quantity === perpetual.intendedQty,
  );
}

export interface ValidateOnlyExecutorOwnerReadinessFunctions {
  readonly approval: typeof evaluateOperatorApproval;
  readonly risk: typeof evaluateMultiLegRisk;
  readonly execution: typeof createExecutionCoordinator;
  readonly reconciliation: typeof reconcileExecutionState;
}

export const VALIDATE_ONLY_EXECUTOR_OWNER_READINESS_FUNCTIONS:
Readonly<ValidateOnlyExecutorOwnerReadinessFunctions> = Object.freeze({
  approval: evaluateOperatorApproval,
  risk: evaluateMultiLegRisk,
  execution: createExecutionCoordinator,
  reconciliation: reconcileExecutionState,
});

function rejectsWithExactOwnerContract(probe: () => unknown, message: RegExp): boolean {
  try {
    probe();
    return false;
  } catch (error) {
    return error instanceof TypeError && message.test(error.message);
  }
}

/**
 * Prove the readiness seam is bound to each canonical owner and that each
 * owner responds with its own deterministic malformed-input refusal. Function
 * identity prevents an arbitrary always-throwing substitute from attesting.
 */
export function probeValidateOnlyExecutorOwners(
  owners: Readonly<ValidateOnlyExecutorOwnerReadinessFunctions>,
): boolean {
  if (owners.approval !== evaluateOperatorApproval
      || owners.risk !== evaluateMultiLegRisk
      || owners.execution !== createExecutionCoordinator
      || owners.reconciliation !== reconcileExecutionState) return false;
  return rejectsWithExactOwnerContract(
    () => owners.approval({} as never, {} as never, {} as never),
    /^evaluateOperatorApproval: malformed input -/u,
  ) && rejectsWithExactOwnerContract(
    () => owners.risk({} as never),
    /^evaluateMultiLegRisk: invalid input —/u,
  ) && rejectsWithExactOwnerContract(
    () => owners.execution({} as never, {} as never, {} as never),
    /^strategy must be 'BASIS'$/u,
  ) && rejectsWithExactOwnerContract(
    () => owners.reconciliation(null as never, {} as never, -1, {} as never),
    /^reconcileExecutionState: nowMs must be valid UTC ms$/u,
  );
}

export class ValidateOnlyOrchestrator {
  constructor(
    private readonly persistence: ValidateOnlyPersistencePort,
    private readonly readinessOwners: Readonly<ValidateOnlyExecutorOwnerReadinessFunctions>
      = VALIDATE_ONLY_EXECUTOR_OWNER_READINESS_FUNCTIONS,
  ) {}

  /**
   * Read-only composition/readiness attestation. It invokes only deterministic
   * malformed-input owner refusals and the persistence readiness probe; it
   * never runs a validation, mutates an owner, or reaches a venue/network.
   */
  readExecutorReadinessEvidence(nowMs: number): Readonly<ValidateOnlyExecutorReadinessEvidence> {
    if (!isValidUtcMillis(nowMs)) throw new TypeError('Executor readiness requires injected valid UTC time.');
    const ownersResponsive = probeValidateOnlyExecutorOwners(this.readinessOwners);
    const persistenceWired = typeof this.persistence?.loadValidateOnlyApprovalState === 'function'
      && typeof this.persistence?.persistValidateOnly === 'function'
      && typeof this.persistence?.readValidateOnlyExecutorPersistenceReadiness === 'function';
    let persistenceResponsive = false;
    try {
      persistenceResponsive = persistenceWired
        && this.persistence.readValidateOnlyExecutorPersistenceReadiness() === true;
    } catch {
      persistenceResponsive = false;
    }
    const validateOnlyAccepted = classifyValidateOnlyRequestedMode('VALIDATE_ONLY') === null;
    const liveModesRefused = (BLOCKED_EXECUTION_MODE_REQUESTS as readonly string[]).every((mode) => (
      classifyValidateOnlyRequestedMode(mode) === LIVE_EXECUTION_NOT_IMPLEMENTED
    ));
    const unavailablePrivateModesRefused = ['PRIVATE', 'PRIVATE_READ', 'SIGNED', 'SIGNED_TEST']
      .every((mode) => classifyValidateOnlyRequestedMode(mode) !== null);
    if (!ownersResponsive
        || !persistenceResponsive
        || !validateOnlyAccepted
        || !liveModesRefused
        || !unavailablePrivateModesRefused) {
      throw new Error('Validate-only executor composition readiness is not proven.');
    }
    return Object.freeze({
      schema: 'cosmos.system-integration.executor-readiness.v1',
      evaluatedAtMs: nowMs,
      componentIds: VALIDATE_ONLY_EXECUTOR_COMPONENT_IDS,
      executorPresent: true,
      persistenceWired: true,
      responsive: ownersResponsive && persistenceResponsive,
      correctPrivateLiveRefusal: true,
      mode: 'VALIDATE_ONLY',
      privateCapability: 'NOT_CONFIGURED',
      tradeCapability: 'NOT_CONFIGURED',
      executionAuthority: 'NONE',
      liveExecutionPermitted: false,
      refusalCode: LIVE_EXECUTION_NOT_IMPLEMENTED,
      runResult: null,
      capitalState: null,
      riskVerdict: null,
      executionPlan: null,
      reconciliationResult: null,
    });
  }

  async execute(input: Readonly<ValidateOnlyOrchestratorInput>): Promise<Readonly<ValidateOnlyRunResult>> {
    if (!isValidUtcMillis(input.nowMs) || !CORRELATION_ID.test(input.correlationId)) {
      throw new TypeError('ValidateOnlyOrchestrator requires injected valid UTC time and a bounded correlation ID');
    }
    const calls: MutableOwnerInvocations = {
      approvalEvaluations: 0,
      approvalUseReductions: 0,
      riskEvaluations: 0,
      executionDefinitionsCreated: 0,
      coordinatorsCreated: 0,
      coordinatorPreflights: 0,
      reconciliationEvaluations: 0,
      recoveryEvaluations: 0,
      persistenceReads: 0,
      persistenceWrites: 0,
    };

    const blockedMode = modeFailure(input);
    if (blockedMode !== null) {
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'MODE_BLOCKED',
        failure: blockedMode,
      }));
    }

    const rejectedInput = inputFailure(input);
    if (rejectedInput !== null) {
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'INPUT_REJECTED',
        failure: rejectedInput,
      }));
    }

    calls.persistenceReads += 1;
    let latestApprovalState: Readonly<OperatorApprovalState> | null;
    try {
      latestApprovalState = await this.persistence.loadValidateOnlyApprovalState(input.capital.approval.id);
    } catch {
      const rejected = failure(input, 'persistence', 'APPROVAL_STATE_READ_FAILED', 'The trusted persistence owner could not load the latest revisioned Capital approval state.', 'Keep validation blocked and restore durable approval-state reads.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'PERSISTENCE_FAILED',
        approvalState: input.capital.approvalState,
        failure: rejected,
      }));
    }
    if (latestApprovalState !== null && capitalDigest(latestApprovalState) !== capitalDigest(input.capital.approvalState)) {
      const rejected = failure(input, 'approval', 'APPROVAL_STATE_STALE', 'The caller-supplied Capital approval state is not the latest state held by the trusted persistence owner.', 'Reload the latest Capital approval state before retrying validation.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalState: input.capital.approvalState,
        failure: rejected,
      }));
    }

    let approvalState: Readonly<OperatorApprovalState> = input.capital.approvalState;

    const context = approvalContext(input);
    calls.approvalEvaluations += 1;
    let approvalDecision: ReturnType<typeof evaluateOperatorApproval>;
    try {
      approvalDecision = evaluateOperatorApproval(approvalState, context, input.capital.approvalPolicy);
    } catch {
      const rejected = failure(input, 'approval', 'APPROVAL_CONTRACT_INVALID', 'The supplied approval state, scope, posture, or policy failed the Capital owner contract.', 'Restore a valid revisioned Capital approval state and exact bounded use context.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalState,
        failure: rejected,
      }));
    }
    if (!approvalDecision.ok) {
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalState,
        failure: approvalDecision.failure,
      }));
    }
    if (
      approvalDecision.value.mode !== 'VALIDATE_ONLY' ||
      !approvalDecision.value.allowedForExternalRiskEvaluation ||
      approvalDecision.value.executionReady !== false ||
      approvalDecision.value.requiresExternalExecutionOwner
    ) {
      const rejected = failure(input, 'approval', 'VALIDATE_ONLY_AUTHORITY_REQUIRED', 'Capital approval did not resolve to validation-only external-risk authority.', 'Issue a non-executable VALIDATE_ONLY approval.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        failure: rejected,
      }));
    }

    calls.approvalUseReductions += 1;
    let used: ReturnType<typeof reduceOperatorApprovalState>;
    try {
      used = reduceOperatorApprovalState(approvalState, {
        kind: 'USE_RECORDED',
        expectedRevision: approvalState.revision,
        idempotencyKey: input.approvalUse.idempotencyKey,
        context,
        recordedAtMs: input.nowMs,
        correlationId: input.correlationId,
      });
    } catch {
      const rejected = failure(input, 'approval', 'APPROVAL_USE_CONTRACT_INVALID', 'The approval-use event failed the Capital owner contract.', 'Correct the bounded idempotency and scoped approval-use fields.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        failure: rejected,
      }));
    }
    if (!used.ok) {
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'APPROVAL_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        failure: used.failure,
      }));
    }
    approvalState = used.value;

    const externalPlanId = derivePlanId({
      canonicalProposalId: input.canonicalProposal.canonicalId,
      attempt: input.executionTerms.attempt,
    });
    const intent = riskIntent(input, externalPlanId);
    if (intent === null) {
      const rejected = failure(input, 'risk-adapter', 'BASIS_DIRECTION_UNSUPPORTED', 'The canonical Basis direction cannot form a two-leg validation intent.', 'Use a supported Basis proposal direction.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'INPUT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        failure: rejected,
      }));
    }

    let verdict: Readonly<RiskVerdict>;
    calls.riskEvaluations += 1;
    try {
      verdict = evaluateMultiLegRisk(riskInput(input, intent));
    } catch {
      const rejected = failure(input, 'risk', 'RISK_INPUT_INVALID', 'The exact staged mandate could not be evaluated by the Foundation risk owner.', 'Correct the named risk evidence and rebuild the validation trace.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'RISK_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        failure: rejected,
      }));
    }

    if (!verdict.allowed) {
      if (input.supervision !== null) {
        calls.reconciliationEvaluations += 1;
        try {
          const reconciliation = reconcileExecutionState(
            input.supervision.state,
            input.reconciliationEvidence,
            input.nowMs,
            input.reconciliationPolicy,
          );
          calls.recoveryEvaluations += 1;
          const recoveryRecommendations = recommendExecutionRecovery(input.supervision.state, input.nowMs);
          return this.persist(input, calls, baseSnapshot(input, calls, {
            disposition: 'RISK_REJECTED',
            approvalDecision: approvalDecision.value,
            approvalState,
            riskVerdict: verdict,
            supervision: Object.freeze({
              rootCorrelationId: input.supervision.rootCorrelationId,
              executionCorrelationId: input.supervision.state.plan.correlationId,
              planId: input.supervision.state.plan.planId,
              truthLabel: 'SYNTHETIC_ONLY' as const,
              executionAuthority: 'NONE' as const,
              state: input.supervision.state,
              reconciliation,
            }),
            recoveryRecommendations,
          }));
        } catch {
          const rejected = failure(input, 'reconciliation', 'SUPERVISION_RECONCILIATION_INVALID', 'Existing execution supervision could not reconcile the supplied synthetic evidence.', 'Keep new exposure blocked and restore the prior Foundation checkpoint with complete reconciliation evidence.');
          return this.persist(input, calls, baseSnapshot(input, calls, {
            disposition: 'RISK_REJECTED',
            approvalDecision: approvalDecision.value,
            approvalState,
            riskVerdict: verdict,
            failure: rejected,
          }));
        }
      }
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'RISK_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
      }));
    }

    const definitionInput = planInput(input);
    if (definitionInput === null) {
      const rejected = failure(input, 'execution-plan', 'EXECUTION_PLAN_INPUT_INVALID', 'The accepted risk intent cannot form a deterministic VALIDATE_ONLY plan.', 'Refresh the proposal and rebuild the dry-run terms.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        failure: rejected,
      }));
    }

    let definition: Readonly<ExecutionPlanDefinition>;
    try {
      calls.executionDefinitionsCreated += 1;
      definition = createExecutionPlanDefinition(definitionInput);
    } catch {
      const rejected = failure(input, 'execution-plan', 'EXECUTION_PLAN_INPUT_INVALID', 'The accepted risk intent cannot form a deterministic VALIDATE_ONLY plan.', 'Refresh the proposal and rebuild the dry-run terms.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        failure: rejected,
      }));
    }
    if (!planMatchesRiskIntent(definition, intent)) {
      const rejected = failure(input, 'execution-plan', 'RISK_PLAN_BINDING_INVALID', 'Execution plan geometry drifted from the exact risk intent.', 'Discard the plan and rebuild the trace from owner records.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        failure: rejected,
      }));
    }

    const riskReference = boundRiskDecision(input, externalPlanId, definition.correlationId, verdict);
    const riskPlanBinding = bindRiskToPlan(input, intent, definition, riskReference);

    const venue = createSealedDryRunVenueHarness({ nowMs: input.nowMs, plan: definition, riskVerdict: verdict });
    let coordinator;
    try {
      calls.coordinatorsCreated += 1;
      coordinator = createExecutionCoordinator(definitionInput, createSystemExecutionClock(input.nowMs), venue.ports);
    } catch {
      const rejected = failure(input, 'coordinator', 'COORDINATOR_CREATION_FAILED', 'The VALIDATE_ONLY coordinator rejected the deterministic plan binding.', 'Inspect the plan identity and retry with the same owner records.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        failure: rejected,
        venueAudit: venue.audit(),
      }));
    }

    const approvalWindowMs = Math.min(
      input.capital.approval.expiresAtMs,
      input.capital.mandate.expiresAtMs,
      input.canonicalProposal.expiresAtMs as number,
      verdict.expiresAt,
    ) - input.nowMs;
    if (!Number.isSafeInteger(approvalWindowMs) || approvalWindowMs <= 0) {
      const rejected = failure(input, 'coordinator', 'VALIDATION_WINDOW_EXPIRED', 'The bounded approval/risk/proposal window elapsed before coordinator preflight.', 'Refresh approval and evidence.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        executionState: coordinator.snapshot(),
        failure: rejected,
        venueAudit: venue.audit(),
      }));
    }
    const requested = coordinator.requestApproval(approvalWindowMs);
    const approved = requested.ok ? coordinator.approve() : requested;
    if (!approved.ok) {
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        executionState: coordinator.snapshot(),
        failure: approved.failure,
        venueAudit: venue.audit(),
      }));
    }

    calls.coordinatorPreflights += 1;
    const preflight = await coordinator.preflight();
    if (!preflight.ok || preflight.state.lifecycle !== 'READY') {
      const rejected = preflight.ok
        ? failure(input, 'coordinator', 'COORDINATOR_NOT_READY', 'VALIDATE_ONLY preflight did not stop at READY.', 'Inspect the deterministic validation port results.')
        : preflight.failure;
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        executionState: coordinator.snapshot(),
        failure: rejected,
        venueAudit: venue.audit(),
      }));
    }

    const venueAudit = venue.audit();
    if (venueAudit.submissionCalls !== 0) {
      const rejected = failure(input, 'coordinator', 'VALIDATE_ONLY_SUBMISSION_ATTEMPTED', 'A submission seam was reached during VALIDATE_ONLY preflight.', 'Keep the system stopped and inspect the coordinator boundary.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'EXECUTION_PREFLIGHT_REJECTED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        executionState: coordinator.snapshot(),
        failure: rejected,
        venueAudit,
      }));
    }

    calls.reconciliationEvaluations += 1;
    let reconciliation;
    try {
      reconciliation = reconcileExecutionState(
        coordinator.snapshot(),
        input.reconciliationEvidence,
        input.nowMs,
        input.reconciliationPolicy,
      );
    } catch {
      const rejected = failure(input, 'reconciliation', 'RECONCILIATION_INPUT_INVALID', 'Synthetic reconciliation evidence failed the Foundation owner contract.', 'Correct the injected fixture and rerun validation.');
      return this.persist(input, calls, baseSnapshot(input, calls, {
        disposition: 'RECONCILIATION_BLOCKED',
        approvalDecision: approvalDecision.value,
        approvalState,
        riskVerdict: verdict,
        boundRiskDecision: riskReference,
        riskPlanBinding,
        executionPlan: definition,
        executionState: coordinator.snapshot(),
        failure: rejected,
        venueAudit,
      }));
    }

    const disposition: ValidateOnlyDisposition = reconciliation.status === 'EXACT' && reconciliation.executionAuthority === 'NONE'
      ? 'READY'
      : 'RECONCILIATION_BLOCKED';
    calls.recoveryEvaluations += 1;
    const recoveryRecommendations = recommendExecutionRecovery(coordinator.snapshot(), input.nowMs);
    const reconciliationFailure = disposition === 'READY'
      ? null
      : failure(input, 'reconciliation', 'RECONCILIATION_TRUTH_BLOCKS_NEW_EXPOSURE', `Reconciliation returned ${reconciliation.status}; no new exposure is permitted.`, 'Inspect the data-only risk-reducing recommendation and restore exact truth.');
    return this.persist(input, calls, baseSnapshot(input, calls, {
      disposition,
      approvalDecision: approvalDecision.value,
      approvalState,
      riskVerdict: verdict,
      boundRiskDecision: riskReference,
      riskPlanBinding,
      executionPlan: definition,
      executionState: coordinator.snapshot(),
      reconciliation,
      recoveryRecommendations,
      failure: reconciliationFailure,
      venueAudit,
    }));
  }

  private async persist(
    input: ValidateOnlyOrchestratorInput,
    calls: MutableOwnerInvocations,
    snapshot: Readonly<ValidateOnlyRunSnapshot>,
  ): Promise<Readonly<ValidateOnlyRunResult>> {
    calls.persistenceWrites += 1;
    const attemptedSnapshot = Object.freeze({
      ...snapshot,
      ownerInvocations: freezeInvocations(calls),
    });
    const { persistenceId: _persistenceId, ...record } = attemptedSnapshot;
    try {
      const persisted = await this.persistence.persistValidateOnly(record as Readonly<ValidateOnlyPersistenceRecord>);
      if (!nonEmpty(persisted?.persistenceId)) throw new TypeError('persistence ID missing');
      const finalized = Object.freeze({
        ...attemptedSnapshot,
        persistenceId: persisted.persistenceId,
      });
      return Object.freeze({ ok: finalized.disposition === 'READY', snapshot: finalized });
    } catch {
      const persistenceFailure = failure(input, 'persistence', 'PERSISTENCE_FAILED', 'The injected persistence port did not durably acknowledge the validation trace.', 'Keep execution blocked and restore the existing ledger/database adapter.');
      const failed = Object.freeze({
        ...attemptedSnapshot,
        disposition: 'PERSISTENCE_FAILED' as const,
        releaseStatuses: attemptedSnapshot.releaseStatuses.includes('BLOCKED')
          ? attemptedSnapshot.releaseStatuses
          : Object.freeze([...attemptedSnapshot.releaseStatuses, 'BLOCKED' as const]),
        failure: persistenceFailure,
        persistenceId: null,
      });
      return Object.freeze({ ok: false, snapshot: failed });
    }
  }
}
