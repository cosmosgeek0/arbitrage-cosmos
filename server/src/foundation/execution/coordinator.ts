import {
  checkExecutionModePermitted,
  createStructuredFailure,
  isTerminalPlanLifecycle,
  isValidUtcMillis,
  type PlanLifecycle,
  type StructuredFailure,
} from '../contracts/index.js';
import { restoreExecutionCheckpoint, serializeExecutionCheckpoint } from './checkpoint.js';
import { createExecutionEvent } from './events.js';
import { createExecutionPlanDefinition } from './plan.js';
import { hasActiveWorkingLeg, hasAmbiguousLeg, hasKnownOpenExposure, reduceExecutionEvent } from './reducer.js';
import {
  EXECUTION_LEG_KEYS,
  type CoordinatorResult,
  type CreateExecutionPlanInput,
  type ExecutionClock,
  type ExecutionCoordinatorPorts,
  type ExecutionEvent,
  type ExecutionEventType,
  type ExecutionLegKey,
  type ExecutionLegPhase,
  type ExecutionPlanState,
  type LegOperationRequest,
  type LookupOutcome,
  type PortFailure,
  type SubmissionOutcome,
} from './types.js';

type EventDetails = Omit<ExecutionEvent, 'eventId' | 'planId' | 'sequence' | 'occurredAtMs' | 'type'>;

export type CoordinatorRestoreResult =
  | { readonly ok: true; readonly coordinator: ExecutionCoordinator }
  | { readonly ok: false; readonly code: string; readonly message: string };

export class PlanTermsConflictError extends Error {
  readonly code = 'PLAN_TERMS_CONFLICT';

  constructor(planId: string) {
    super(`PlanId ${planId} is already bound to different execution terms; increment attempt when replanning.`);
    this.name = 'PlanTermsConflictError';
  }
}

function validPortCode(code: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(code);
}

function validPortText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function residualQuantity(state: ExecutionPlanState, key: ExecutionLegKey): number {
  return Math.max(
    0,
    state.openingLegs[key].cumulativeFilledQuantity - state.closingLegs[key].cumulativeFilledQuantity,
  );
}

const QUANTITY_EPSILON = 1e-12;

function portFailureIsValid(value: unknown): value is PortFailure {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const failure = value as Record<string, unknown>;
    return (
      typeof failure.code === 'string' &&
      validPortCode(failure.code) &&
      validPortText(failure.message, 10_000) &&
      typeof failure.retryable === 'boolean' &&
      validPortText(failure.recommendedOperatorAction, 500)
    );
  } catch {
    return false;
  }
}

function lookupEvidenceIsValid(request: LegOperationRequest, value: unknown): value is LookupOutcome {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const lookup = value as Record<string, unknown>;
    if (lookup.kind === 'PROVEN_ABSENT' || lookup.kind === 'UNRESOLVED') {
      return portFailureIsValid(lookup.failure);
    }
    if (lookup.kind !== 'FOUND') return false;
    if (
      (lookup.venueOrderId !== null && (typeof lookup.venueOrderId !== 'string' || lookup.venueOrderId.length === 0)) ||
      !Number.isFinite(lookup.cumulativeFilledQuantity) ||
      (lookup.failure !== undefined && !portFailureIsValid(lookup.failure))
    ) return false;
    const cumulative = lookup.cumulativeFilledQuantity as number;
    switch (lookup.status) {
      case 'ACKNOWLEDGED':
      case 'REJECTED':
        return cumulative === 0;
      case 'PARTIALLY_FILLED':
        return cumulative > 0 && cumulative < request.leg.quantity - QUANTITY_EPSILON;
      case 'FILLED':
        return Math.abs(cumulative - request.leg.quantity) <= QUANTITY_EPSILON;
      case 'CANCELLED':
        return cumulative >= 0 && cumulative <= request.leg.quantity + QUANTITY_EPSILON;
      default:
        return false;
    }
  } catch {
      return false;
  }
}

function requiresColdRestartRecovery(state: ExecutionPlanState): boolean {
  if (isTerminalPlanLifecycle(state.lifecycle)) return false;
  return (['OPEN', 'CLOSE'] as const).some((phase) => {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    return EXECUTION_LEG_KEYS.some((key) => record[key].submittedQuantity > 0);
  });
}

function hasWorkingOpeningLeg(state: ExecutionPlanState): boolean {
  return EXECUTION_LEG_KEYS.some((key) => {
    const lifecycle = state.openingLegs[key].lifecycle;
    return (
      lifecycle === 'SUBMITTING' ||
      lifecycle === 'ACKNOWLEDGED' ||
      lifecycle === 'PARTIALLY_FILLED' ||
      lifecycle === 'CANCEL_PENDING' ||
      lifecycle === 'AMBIGUOUS'
    );
  });
}

export class ExecutionCoordinator {
  private stateValue: ExecutionPlanState;
  private restartRecoveryPending: boolean;
  private restartRecoveryInFlight: Promise<CoordinatorResult> | null = null;
  private openingProgressInFlight: Promise<CoordinatorResult> | null = null;
  private readonly openingRefreshInFlight = new Map<ExecutionLegKey, Promise<CoordinatorResult>>();
  private readonly workingRefreshInFlight = new Map<string, Promise<CoordinatorResult>>();

  constructor(
    state: ExecutionPlanState,
    private readonly clock: ExecutionClock,
    private readonly ports: ExecutionCoordinatorPorts,
    restoredFromCheckpoint = false,
  ) {
    this.stateValue = state;
    this.restartRecoveryPending = restoredFromCheckpoint && requiresColdRestartRecovery(state);
    this.now();
    if (typeof this.ports.claimPlanIdentity !== 'function') {
      throw new TypeError('ExecutionCoordinatorPorts.claimPlanIdentity is required to prevent conflicting PlanId terms');
    }
    const claim = this.ports.claimPlanIdentity(state.plan.planId, state.plan.termsFingerprint);
    if (claim === 'CONFLICT') throw new PlanTermsConflictError(state.plan.planId);
    if (claim !== 'CLAIMED' && claim !== 'EXISTING_SAME') {
      throw new TypeError('claimPlanIdentity returned an invalid result');
    }
  }

  snapshot(): ExecutionPlanState {
    return this.stateValue;
  }

  checkpoint(): string {
    return serializeExecutionCheckpoint(this.stateValue);
  }

  private now(): number {
    const value = this.clock.nowMs();
    if (!isValidUtcMillis(value)) throw new TypeError('ExecutionClock.nowMs() must return valid UTC ms');
    return value;
  }

  private success(): CoordinatorResult {
    return Object.freeze({ ok: true as const, state: this.stateValue });
  }

  private failureResult(failure: StructuredFailure): CoordinatorResult {
    const finalized =
      failure.component === 'foundation.execution.coordinator' &&
      failure.safeCurrentState !== this.stateValue.lifecycle
        ? createStructuredFailure({
            ...failure,
            safeCurrentState: this.stateValue.lifecycle,
          })
        : failure;
    return Object.freeze({ ok: false as const, state: this.stateValue, failure: finalized });
  }

  private failure(
    stage: string,
    code: string,
    message: string,
    nowMs: number,
    retryable: boolean,
    recommendedOperatorAction: string,
    safeCurrentState = this.stateValue.lifecycle,
  ): Readonly<StructuredFailure> {
    return createStructuredFailure({
      component: 'foundation.execution.coordinator',
      stage,
      code: validPortCode(code) ? code : 'PORT_FAILURE',
      message,
      occurredAt: nowMs,
      retryable,
      safeCurrentState,
      recommendedOperatorAction,
      correlationId: this.stateValue.plan.correlationId,
    });
  }

  private fromPortFailure(
    stage: string,
    failure: PortFailure,
    nowMs: number,
    safeCurrentState = this.stateValue.lifecycle,
  ): Readonly<StructuredFailure> {
    return this.failure(
      stage,
      failure.code,
      failure.message,
      nowMs,
      failure.retryable,
      failure.recommendedOperatorAction,
      safeCurrentState,
    );
  }

  private portThrew(
    stage: string,
    nowMs: number,
    ambiguous: boolean,
    safeCurrentState = this.stateValue.lifecycle,
  ): Readonly<StructuredFailure> {
    return this.failure(
      stage,
      ambiguous ? 'SUBMISSION_RESPONSE_LOST' : 'INJECTED_PORT_THREW',
      ambiguous
        ? 'The injected submission port threw before returning a typed result; the venue outcome is unknown.'
        : 'An injected port threw before returning a typed result.',
      nowMs,
      false,
      ambiguous
        ? 'Query by deterministic client-order ID before retrying or changing exposure.'
        : 'Inspect the injected port and retry only after its state is understood.',
      safeCurrentState,
    );
  }

  private rejectedLegSafeState(phase: ExecutionLegPhase): PlanLifecycle {
    if (phase === 'CLOSE') return 'RECOVERY_REQUIRED';
    return hasKnownOpenExposure(this.stateValue) ? 'ONE_LEG_EXPOSED' : 'FAILED';
  }

  private enforceEntryWindow(stage: string, nowMs: number): CoordinatorResult | null {
    const proposal = this.stateValue.plan.proposal;
    let code: 'PROPOSAL_EXPIRED' | 'PROPOSAL_STALE' | 'APPROVAL_EXPIRED' | 'APPROVAL_REQUIRED' | null = null;
    if (nowMs >= proposal.expiresAtMs) code = 'PROPOSAL_EXPIRED';
    else if (nowMs - proposal.observedAtMs > proposal.maxAgeMs) code = 'PROPOSAL_STALE';
    else if (
      this.stateValue.plan.requiresApproval &&
      (this.stateValue.approval.status !== 'APPROVED' ||
        this.stateValue.approval.expiresAtMs === null ||
        nowMs >= this.stateValue.approval.expiresAtMs)
    ) code = this.stateValue.approval.status === 'APPROVED' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REQUIRED';
    if (code === null) return null;
    const safeCurrentState =
      hasKnownOpenExposure(this.stateValue) ||
      hasActiveWorkingLeg(this.stateValue) ||
      hasAmbiguousLeg(this.stateValue)
        ? 'RECOVERY_REQUIRED'
        : this.stateValue.lifecycle === 'OPENING'
          ? 'FAILED'
          : 'EXPIRED';
    const failure = this.failure(
      stage,
      code,
      'The proposal or approval entry window is no longer valid at the submission boundary.',
      nowMs,
      false,
      'Do not submit new entry risk; reconcile any exposure and create a fresh approved plan.',
      safeCurrentState,
    );
    const expired = this.emitAt(nowMs, 'ENTRY_WINDOW_EXPIRED', { failure });
    return expired.ok ? this.failureResult(failure) : expired;
  }

  private enforceNakedDeadline(stage: string, nowMs: number): CoordinatorResult | null {
    const exposedSinceMs = this.stateValue.exposedSinceMs;
    if (
      exposedSinceMs === null ||
      nowMs < exposedSinceMs + this.stateValue.plan.maxNakedDurationMs ||
      this.stateValue.lifecycle === 'RECOVERY_REQUIRED'
    ) return null;
    const escalated = this.emitAt(nowMs, 'NAKED_DURATION_EXPIRED');
    if (!escalated.ok) return escalated;
    return this.failureResult(
      this.failure(
        stage,
        'NAKED_DURATION_EXPIRED',
        'The maximum naked duration elapsed before the next entry leg could be submitted.',
        nowMs,
        false,
        'Use only an explicitly authorized risk-reducing recovery action.',
      ),
    );
  }

  private emitAt(
    nowMs: number,
    type: ExecutionEventType,
    details: EventDetails = {},
  ): CoordinatorResult {
    const event = createExecutionEvent(
      this.stateValue.plan.planId,
      this.stateValue.lastSequence + 1,
      nowMs,
      type,
      details,
    );
    const reduced = reduceExecutionEvent(this.stateValue, event);
    if (!reduced.applied) {
      return this.failureResult(
        this.failure(
          `reduce:${type}`,
          'REDUCER_REJECTED_EVENT',
          `The pure reducer rejected coordinator event ${type} (${reduced.reason}).`,
          nowMs,
          false,
          'Treat this as a coordinator invariant defect; do not retry the operation.',
        ),
      );
    }
    this.stateValue = reduced.state;
    return this.success();
  }

  requestApproval(windowMs: number): CoordinatorResult {
    if (!this.stateValue.plan.requiresApproval) return this.success();
    if (this.stateValue.approval.status === 'PENDING' || this.stateValue.approval.status === 'APPROVED') return this.success();
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new TypeError('approval windowMs must be a positive safe integer');
    }
    const nowMs = this.now();
    const expiresAtMs = nowMs + windowMs;
    if (!isValidUtcMillis(expiresAtMs)) throw new TypeError('approval expiry exceeds supported UTC range');
    return this.emitAt(nowMs, 'APPROVAL_REQUESTED', { approvalExpiresAtMs: expiresAtMs });
  }

  approve(): CoordinatorResult {
    if (!this.stateValue.plan.requiresApproval || this.stateValue.approval.status === 'APPROVED') return this.success();
    const nowMs = this.now();
    if (this.stateValue.approval.status !== 'PENDING' || this.stateValue.approval.expiresAtMs === null) {
      return this.failureResult(
        this.failure('approve', 'APPROVAL_NOT_PENDING', 'No approval request is pending.', nowMs, false, 'Request a new bounded approval window.'),
      );
    }
    if (nowMs >= this.stateValue.approval.expiresAtMs) {
      const expired = this.emitAt(nowMs, 'APPROVAL_EXPIRED');
      if (!expired.ok) return expired;
      return this.failureResult(
        this.failure('approve', 'APPROVAL_EXPIRED', 'Approval arrived at or after its expiry.', nowMs, false, 'Create a new plan and request fresh approval.'),
      );
    }
    return this.emitAt(nowMs, 'APPROVAL_GRANTED');
  }

  async preflight(): Promise<CoordinatorResult> {
    if (this.stateValue.preflight.status === 'PASSED') return this.success();
    const nowMs = this.now();
    const mode = checkExecutionModePermitted(this.stateValue.plan.mode, {
      nowMs,
      correlationId: this.stateValue.plan.correlationId,
    });
    if (!mode.ok) return this.failureResult(mode.failure);

    const proposal = this.stateValue.plan.proposal;
    if (nowMs >= proposal.expiresAtMs || nowMs - proposal.observedAtMs > proposal.maxAgeMs) {
      const expired = this.emitAt(nowMs, 'PROPOSAL_EXPIRED');
      if (!expired.ok) return expired;
      return this.failureResult(
        this.failure(
          'preflight:proposal',
          nowMs >= proposal.expiresAtMs ? 'PROPOSAL_EXPIRED' : 'PROPOSAL_STALE',
          'The source proposal is no longer usable at preflight time.',
          nowMs,
          false,
          'Obtain a fresh canonical proposal; never execute this stale plan.',
        ),
      );
    }

    if (this.stateValue.plan.requiresApproval && this.stateValue.approval.status !== 'APPROVED') {
      if (
        this.stateValue.approval.status === 'PENDING' &&
        this.stateValue.approval.expiresAtMs !== null &&
        nowMs >= this.stateValue.approval.expiresAtMs
      ) {
        const expired = this.emitAt(nowMs, 'APPROVAL_EXPIRED');
        if (!expired.ok) return expired;
        return this.failureResult(
          this.failure('preflight:approval', 'APPROVAL_EXPIRED', 'Approval expired before preflight.', nowMs, false, 'Create a fresh plan and approval.'),
        );
      }
      return this.failureResult(
        this.failure('preflight:approval', 'APPROVAL_REQUIRED', 'A valid approval is required before preflight.', nowMs, false, 'Request and grant bounded approval.'),
      );
    }

    const started = this.emitAt(nowMs, 'PREFLIGHT_STARTED');
    if (!started.ok) return started;
    let portResult;
    try {
      portResult = await this.ports.preflight(this.stateValue.plan);
    } catch {
      const failure = this.portThrew('preflight', nowMs, false, 'FAILED');
      const failed = this.emitAt(nowMs, 'PREFLIGHT_FAILED', { failure });
      return failed.ok ? this.failureResult(failure) : failed;
    }
    if (!portResult.ok) {
      const failure = this.fromPortFailure('preflight', portResult.failure, nowMs, 'FAILED');
      const failed = this.emitAt(nowMs, 'PREFLIGHT_FAILED', { failure });
      return failed.ok ? this.failureResult(failure) : failed;
    }

    for (const key of this.stateValue.plan.openingOrder) {
      const request = this.requestFor('OPEN', key);
      let validation;
      try {
        validation = await this.ports.validateLeg(request);
      } catch {
        validation = { ok: false as const, failure: {
          code: 'INJECTED_PORT_THREW',
          message: 'The injected validation port threw before returning a typed result.',
          retryable: false,
          recommendedOperatorAction: 'Inspect the validation port before retrying.',
        } };
      }
      if (!validation.ok) {
        const failure = this.fromPortFailure(`preflight:${key}`, validation.failure, nowMs, 'FAILED');
        const rejected = this.emitAt(nowMs, 'LEG_REJECTED', { phase: 'OPEN', legKey: key, failure });
        if (!rejected.ok) return rejected;
        const failed = this.emitAt(nowMs, 'PREFLIGHT_FAILED', { failure });
        return failed.ok ? this.failureResult(failure) : failed;
      }
      const validated = this.emitAt(nowMs, 'LEG_VALIDATED', { phase: 'OPEN', legKey: key });
      if (!validated.ok) return validated;
    }
    return this.emitAt(nowMs, 'PREFLIGHT_PASSED');
  }

  beginOpen(): CoordinatorResult {
    const nowMs = this.now();
    if (this.stateValue.lifecycle === 'HEDGED_OPEN') return this.success();
    if (this.stateValue.plan.mode === 'VALIDATE_ONLY') {
      return this.failureResult(
        this.failure(
          'open',
          'VALIDATE_ONLY_SUBMISSION_BLOCKED',
          'VALIDATE_ONLY can validate but cannot submit an order-like request.',
          nowMs,
          false,
          'Use validation output only. PAPER requires a separately created PAPER plan.',
        ),
      );
    }
    const mode = checkExecutionModePermitted(this.stateValue.plan.mode, {
      nowMs,
      correlationId: this.stateValue.plan.correlationId,
    });
    if (!mode.ok) return this.failureResult(mode.failure);
    const entryWindow = this.enforceEntryWindow('open:entry-window', nowMs);
    if (entryWindow !== null) return entryWindow;
    if (
      this.stateValue.lifecycle === 'OPENING' ||
      this.stateValue.lifecycle === 'ONE_LEG_EXPOSED'
    ) return this.success();
    if (this.stateValue.lifecycle !== 'READY') {
      return this.failureResult(
        this.failure('open', 'PLAN_NOT_READY', 'The plan is not READY for opening.', nowMs, false, 'Complete preflight first.'),
      );
    }
    return this.emitAt(nowMs, 'OPENING_STARTED');
  }

  private requestFor(
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
    quantityOverride?: number,
  ): LegOperationRequest {
    const definition = phase === 'OPEN' ? this.stateValue.plan.openingLegs[key] : this.stateValue.plan.closingLegs[key];
    return Object.freeze({
      planId: this.stateValue.plan.planId,
      correlationId: this.stateValue.plan.correlationId,
      symbol: this.stateValue.plan.symbol,
      direction: this.stateValue.plan.direction,
      mode: this.stateValue.plan.mode as 'VALIDATE_ONLY' | 'PAPER',
      phase,
      leg: quantityOverride === undefined ? definition : Object.freeze({ ...definition, quantity: quantityOverride }),
    });
  }

  async #submitNextOpeningLegCurrent(): Promise<CoordinatorResult> {
    if (this.restartRecoveryPending) {
      const recovered = await this.recoverAfterRestart();
      if (!recovered.ok) return recovered;
    }
    const gate = this.beginOpen();
    if (!gate.ok) return gate;
    const deadline = this.enforceNakedDeadline('open:naked-deadline', this.now());
    if (deadline !== null) return deadline;
    const order = this.stateValue.plan.openingOrder;
    for (let index = 0; index < order.length; index += 1) {
      const key = order[index];
      let leg = this.stateValue.openingLegs[key];
      if (leg.lifecycle !== 'VALIDATED') continue;
      if (index > 0) {
        const priorKey = order[index - 1];
        let prior = this.stateValue.openingLegs[priorKey];
        if (
          prior.lifecycle === 'ACKNOWLEDGED' ||
          prior.lifecycle === 'PARTIALLY_FILLED' ||
          prior.lifecycle === 'CANCEL_PENDING'
        ) {
          const refreshed = await this.refreshOpeningLeg(priorKey);
          if (!refreshed.ok) return refreshed;
          prior = this.stateValue.openingLegs[priorKey];
          leg = this.stateValue.openingLegs[key];
        }
        if (leg.lifecycle !== 'VALIDATED') {
          const nowMs = this.now();
          return this.failureResult(
            this.failure(
              `open:${key}`,
              'DEPENDENT_LEG_STATE_CHANGED',
              'The dependent leg changed while predecessor truth was being refreshed.',
              nowMs,
              false,
              'Reconcile the plan before any further submission.',
            ),
          );
        }
        if (prior.lifecycle !== 'FILLED' && prior.lifecycle !== 'CANCELLED') {
          const nowMs = this.now();
          return this.failureResult(
            this.failure(
              `open:${key}`,
              'PREVIOUS_LEG_NOT_FINAL',
              'The preceding opening leg is not terminal, so its fill cannot safely size the dependent hedge.',
              nowMs,
              true,
              'Refresh and terminalize the preceding client-order ID before progression.',
            ),
          );
        }
        if (this.stateValue.lifecycle !== 'OPENING' && this.stateValue.lifecycle !== 'ONE_LEG_EXPOSED') {
          const nowMs = this.now();
          return this.failureResult(
            this.failure(
              `open:${key}`,
              'OPENING_PROGRESS_STATE_CHANGED',
              'The plan lifecycle changed while predecessor truth was being refreshed.',
              nowMs,
              false,
              'Reconcile the current lifecycle and do not submit the dependent opening leg.',
            ),
          );
        }
        if (prior.cumulativeFilledQuantity <= 0) {
          const nowMs = this.now();
          return this.failureResult(
            this.failure(
              `open:${key}`,
              'PREVIOUS_LEG_NOT_FILLED',
              'The preceding leg has no evidence-backed fill; the next risk-increasing leg is blocked.',
              nowMs,
              true,
              'Wait for fill evidence or reconcile the preceding client-order ID.',
            ),
          );
        }
        const hedgeQuantity = leg.definition.quantity * (
          prior.cumulativeFilledQuantity / prior.definition.quantity
        );
        if (!Number.isFinite(hedgeQuantity) || hedgeQuantity <= 0 || hedgeQuantity > leg.definition.quantity) {
          const nowMs = this.now();
          return this.failureResult(
            this.failure(
              `open:${key}`,
              'HEDGE_QUANTITY_INVALID',
              'The evidence-backed hedge quantity is outside the planned leg bounds.',
              nowMs,
              false,
              'Do not submit; reconcile the first-leg fill quantity.',
            ),
          );
        }
        return this.#submitLeg(this.requestFor('OPEN', key, hedgeQuantity));
      }
      return this.#submitLeg(this.requestFor('OPEN', key));
    }
    return this.success();
  }

  async submitNextOpeningLeg(): Promise<CoordinatorResult> {
    if (this.openingProgressInFlight !== null) return this.openingProgressInFlight;
    const run = Promise.resolve().then(() => this.#submitNextOpeningLegCurrent());
    this.openingProgressInFlight = run;
    try {
      return await run;
    } finally {
      if (this.openingProgressInFlight === run) this.openingProgressInFlight = null;
    }
  }

  async open(): Promise<CoordinatorResult> {
    if (this.restartRecoveryPending) {
      const recovered = await this.recoverAfterRestart();
      if (!recovered.ok) return recovered;
    }
    const begun = this.beginOpen();
    if (!begun.ok) return begun;
    for (let i = 0; i < 2; i += 1) {
      const before = this.stateValue.revision;
      const result = await this.submitNextOpeningLeg();
      if (!result.ok) return result;
      if (this.stateValue.revision === before) break;
    }
    return this.success();
  }

  async #submitLeg(request: LegOperationRequest): Promise<CoordinatorResult> {
    const expected = request.phase === 'OPEN'
      ? this.stateValue.plan.openingLegs[request.leg.key]
      : this.stateValue.plan.closingLegs[request.leg.key];
    if (
      this.stateValue.plan.mode !== 'PAPER' ||
      request.mode !== this.stateValue.plan.mode ||
      request.planId !== this.stateValue.plan.planId ||
      request.correlationId !== this.stateValue.plan.correlationId ||
      request.symbol !== this.stateValue.plan.symbol ||
      request.direction !== this.stateValue.plan.direction ||
      request.leg.phase !== request.phase ||
      request.leg.legId !== expected.legId ||
      request.leg.clientOrderId !== expected.clientOrderId ||
      request.leg.side !== expected.side ||
      request.leg.venue !== expected.venue ||
      request.leg.riskEffect !== expected.riskEffect ||
      request.leg.quantity <= 0 ||
      request.leg.quantity > expected.quantity
    ) {
      const nowMs = this.now();
      return this.failureResult(
        this.failure('submit', 'SUBMISSION_REQUEST_INVARIANT_FAILED', 'The submission request does not match the PAPER aggregate plan.', nowMs, false, 'Do not invoke the submission port.'),
      );
    }
    const nowMs = this.now();
    if (request.phase === 'OPEN') {
      const entryWindow = this.enforceEntryWindow('submit:entry-window', nowMs);
      if (entryWindow !== null) return entryWindow;
      const deadline = this.enforceNakedDeadline('submit:naked-deadline', nowMs);
      if (deadline !== null) return deadline;
    }
    const started = this.emitAt(nowMs, 'LEG_SUBMISSION_STARTED', {
      phase: request.phase,
      legKey: request.leg.key,
      submittedQuantity: request.leg.quantity,
    });
    if (!started.ok) return started;
    let outcome: SubmissionOutcome;
    try {
      outcome = await this.ports.submitPaper(request);
    } catch {
      const outcomeAtMs = this.now();
      const failure = this.portThrew(`submit:${request.phase}:${request.leg.key}`, outcomeAtMs, true);
      const ambiguous = this.emitAt(outcomeAtMs, 'LEG_RESPONSE_AMBIGUOUS', {
        phase: request.phase,
        legKey: request.leg.key,
        failure,
      });
      if (!ambiguous.ok) return ambiguous;
      return this.resolveAmbiguity(request, failure);
    }
    return this.applySubmissionOutcome(request, outcome, this.now());
  }

  private async applySubmissionOutcome(
    request: LegOperationRequest,
    outcome: SubmissionOutcome,
    nowMs: number,
  ): Promise<CoordinatorResult> {
    const details = { phase: request.phase, legKey: request.leg.key } as const;
    if (outcome.kind === 'REJECTED') {
      const failure = this.fromPortFailure(
        `submit:${request.phase}:${request.leg.key}`,
        outcome.failure,
        nowMs,
        this.rejectedLegSafeState(request.phase),
      );
      const rejected = this.emitAt(nowMs, 'LEG_REJECTED', { ...details, failure });
      return rejected.ok ? this.failureResult(failure) : rejected;
    }
    if (outcome.kind === 'AMBIGUOUS') {
      const failure = this.fromPortFailure(`submit:${request.phase}:${request.leg.key}`, outcome.failure, nowMs);
      const ambiguous = this.emitAt(nowMs, 'LEG_RESPONSE_AMBIGUOUS', { ...details, failure });
      if (!ambiguous.ok) return ambiguous;
      return this.resolveAmbiguity(request, failure);
    }
    if (outcome.kind === 'ACKNOWLEDGED') {
      return this.emitAt(nowMs, 'LEG_ACKNOWLEDGED', { ...details, venueOrderId: outcome.venueOrderId });
    }

    const cumulative = outcome.cumulativeFilledQuantity;
    if (
      typeof cumulative !== 'number' ||
      !Number.isFinite(cumulative) ||
      cumulative <= 0 ||
      cumulative > request.leg.quantity
    ) {
      const failure = this.failure(
        `submit:${request.phase}:${request.leg.key}`,
        'SUBMISSION_OUTCOME_INVALID',
        'The submission port returned an impossible cumulative fill quantity; outcome is treated as ambiguous.',
        nowMs,
        false,
        'Reconcile order and fill evidence by deterministic client-order ID.',
        'RECOVERY_REQUIRED',
      );
      const ambiguous = this.emitAt(nowMs, 'LEG_RESPONSE_AMBIGUOUS', { ...details, failure });
      if (!ambiguous.ok) return ambiguous;
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    const eventType = outcome.kind === 'FILLED' ? 'LEG_FILLED' : 'LEG_PARTIALLY_FILLED';
    return this.emitAt(nowMs, eventType, {
      ...details,
      venueOrderId: outcome.venueOrderId,
      cumulativeFilledQuantity: cumulative,
    });
  }

  private async resolveAmbiguity(
    request: LegOperationRequest,
    originalFailure: StructuredFailure,
  ): Promise<CoordinatorResult> {
    let lookup: unknown;
    try {
      lookup = await this.ports.lookupByClientOrderId(request);
    } catch {
      lookup = {
        kind: 'UNRESOLVED',
        failure: {
          code: 'AMBIGUITY_LOOKUP_FAILED',
          message: 'The injected lookup port threw; order existence remains unknown.',
          retryable: true,
          recommendedOperatorAction: 'Retry read-only lookup by client-order ID; do not resubmit.',
        },
      };
    }
    const nowMs = this.now();
    const details = { phase: request.phase, legKey: request.leg.key } as const;
    if (!lookupEvidenceIsValid(request, lookup)) {
      const failure = this.failure(
        `lookup:${request.phase}:${request.leg.key}`,
        'LOOKUP_OUTCOME_INVALID',
        'Read-only lookup returned a status and cumulative-fill pair that cannot both be true.',
        nowMs,
        false,
        'Refresh exact order and fill evidence; do not infer zero exposure or resubmit.',
        'RECOVERY_REQUIRED',
      );
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    if (lookup.kind === 'UNRESOLVED') {
      const failure = this.fromPortFailure(
        `lookup:${request.phase}:${request.leg.key}`,
        lookup.failure,
        nowMs,
        'RECOVERY_REQUIRED',
      );
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    if (lookup.kind === 'PROVEN_ABSENT') {
      const leg = request.phase === 'OPEN'
        ? this.stateValue.openingLegs[request.leg.key]
        : this.stateValue.closingLegs[request.leg.key];
      if (leg.cumulativeFilledQuantity > QUANTITY_EPSILON || leg.venueOrderId !== null) {
        const failure = this.failure(
          `lookup:${request.phase}:${request.leg.key}`,
          'ORDER_PRESENCE_EVIDENCE_DIVERGED',
          'Lookup claimed absence after durable fill or venue-order evidence already existed.',
          nowMs,
          false,
          'Reconcile order and fill history; never erase the existing exposure evidence.',
          'RECOVERY_REQUIRED',
        );
        const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
        return unresolved.ok ? this.failureResult(failure) : unresolved;
      }
      const failure = this.fromPortFailure(
        `lookup:${request.phase}:${request.leg.key}`,
        lookup.failure,
        nowMs,
        this.rejectedLegSafeState(request.phase),
      );
      const resolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_RESOLVED', {
        ...details,
        ambiguityResolution: 'PROVEN_ABSENT',
        failure,
      });
      return resolved.ok ? this.failureResult(failure) : resolved;
    }
    if (lookup.status === 'REJECTED') {
      const portFailure = lookup.failure ?? {
        code: 'ORDER_REJECTED_AFTER_LOOKUP',
        message: 'Read-only lookup proved the ambiguous order was rejected.',
        retryable: false,
        recommendedOperatorAction: 'Inspect rejection evidence before creating a new plan.',
      };
      const failure = this.fromPortFailure(
        `lookup:${request.phase}:${request.leg.key}`,
        portFailure,
        nowMs,
        this.rejectedLegSafeState(request.phase),
      );
      const resolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_RESOLVED', {
        ...details,
        ambiguityResolution: 'REJECTED',
        failure,
        venueOrderId: lookup.venueOrderId,
      });
      return resolved.ok ? this.failureResult(failure) : resolved;
    }
    const resolution = lookup.status;
    const carriesFill = resolution === 'PARTIALLY_FILLED' || resolution === 'FILLED' || resolution === 'CANCELLED';
    const resolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_RESOLVED', {
      ...details,
      ambiguityResolution: resolution,
      venueOrderId: lookup.venueOrderId,
      cumulativeFilledQuantity:
        carriesFill
          ? lookup.cumulativeFilledQuantity
          : undefined,
    });
    if (!resolved.ok) return resolved;
    // The original ambiguity remains retained in failures/event history even
    // after lookup resolves it; it is evidence, not erased history.
    void originalFailure;
    return this.success();
  }

  async resolveOutstandingAmbiguity(phase: ExecutionLegPhase, key: ExecutionLegKey): Promise<CoordinatorResult> {
    const leg = phase === 'OPEN' ? this.stateValue.openingLegs[key] : this.stateValue.closingLegs[key];
    const nowMs = this.now();
    if (leg.lifecycle !== 'AMBIGUOUS') return this.success();
    return this.resolveAmbiguity(
      this.requestFor(phase, key, leg.submittedQuantity > 0 ? leg.submittedQuantity : undefined),
      leg.lastFailure ?? this.failure('lookup', 'AMBIGUOUS_ORDER', 'Order outcome remains ambiguous.', nowMs, true, 'Query by client-order ID.'),
    );
  }

  restartRecoveryRequired(): boolean {
    return this.restartRecoveryPending;
  }

  private recordRestartRecoveryFailure(
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
    failure: StructuredFailure,
    nowMs: number,
  ): CoordinatorResult {
    const blocked = this.emitAt(nowMs, 'RESTART_RECOVERY_BLOCKED', {
      phase,
      legKey: key,
      failure,
    });
    return blocked.ok ? this.failureResult(failure) : blocked;
  }

  private async verifyTerminalLegAfterRestart(
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
  ): Promise<CoordinatorResult> {
    const leg = phase === 'OPEN' ? this.stateValue.openingLegs[key] : this.stateValue.closingLegs[key];
    const request = this.requestFor(phase, key, leg.submittedQuantity);
    let lookup: unknown;
    try {
      lookup = await this.ports.lookupByClientOrderId(request);
    } catch {
      const nowMs = this.now();
      return this.recordRestartRecoveryFailure(
        phase,
        key,
        this.failure(
          `restart-lookup:${phase}:${key}`,
          'RESTART_LOOKUP_PORT_THREW',
          'The cold-restart lookup port threw before terminal checkpoint truth could be verified.',
          nowMs,
          true,
          'Restore read-only owner lookup and retry recovery; do not progress the plan.',
          'RECOVERY_REQUIRED',
        ),
        nowMs,
      );
    }
    if (!lookupEvidenceIsValid(request, lookup)) {
      const nowMs = this.now();
      return this.recordRestartRecoveryFailure(
        phase,
        key,
        this.failure(
          `restart-lookup:${phase}:${key}`,
          'LOOKUP_OUTCOME_INVALID',
          'Cold-restart lookup returned a status and cumulative-fill pair that cannot both be true.',
          nowMs,
          false,
          'Refresh exact owner order and fill evidence; preserve checkpoint exposure and do not progress.',
          'RECOVERY_REQUIRED',
        ),
        nowMs,
      );
    }
    if (lookup.kind === 'UNRESOLVED') {
      const nowMs = this.now();
      return this.recordRestartRecoveryFailure(
        phase,
        key,
        this.fromPortFailure(
          `restart-lookup:${phase}:${key}`,
          lookup.failure,
          nowMs,
          'RECOVERY_REQUIRED',
        ),
        nowMs,
      );
    }
    if (lookup.kind === 'PROVEN_ABSENT') {
      if (
        leg.lifecycle === 'REJECTED' &&
        leg.lastAmbiguityResolution === 'PROVEN_ABSENT' &&
        leg.cumulativeFilledQuantity <= QUANTITY_EPSILON &&
        leg.venueOrderId === null
      ) return this.success();
      const nowMs = this.now();
      return this.recordRestartRecoveryFailure(
        phase,
        key,
        this.failure(
          `restart-lookup:${phase}:${key}`,
          'RESTART_TERMINAL_EVIDENCE_DIVERGED',
          'Fresh proven-absence evidence contradicted the checkpointed terminal disposition.',
          nowMs,
          false,
          'Reconcile exact owner order history; do not relabel a venue rejection as pre-venue absence.',
          'RECOVERY_REQUIRED',
        ),
        nowMs,
      );
    }
    const consistent = lookup.kind === 'FOUND' && (
      (leg.lifecycle === 'FILLED' &&
        lookup.status === 'FILLED' &&
        Math.abs(lookup.cumulativeFilledQuantity - leg.cumulativeFilledQuantity) <= QUANTITY_EPSILON) ||
      (leg.lifecycle === 'CANCELLED' &&
        lookup.status === 'CANCELLED' &&
        Math.abs(lookup.cumulativeFilledQuantity - leg.cumulativeFilledQuantity) <= QUANTITY_EPSILON) ||
      (leg.lifecycle === 'REJECTED' &&
        lookup.status === 'REJECTED' &&
        leg.lastAmbiguityResolution !== 'PROVEN_ABSENT' &&
        leg.cumulativeFilledQuantity <= QUANTITY_EPSILON)
    ) && lookup.venueOrderId === leg.venueOrderId;
    if (consistent) return this.success();
    const nowMs = this.now();
    return this.recordRestartRecoveryFailure(
      phase,
      key,
      this.failure(
        `restart-lookup:${phase}:${key}`,
        'RESTART_TERMINAL_EVIDENCE_DIVERGED',
        'Fresh owner lookup contradicted the checkpointed terminal order observation.',
        nowMs,
        false,
        'Reconcile private order and fill history; do not progress or resubmit.',
        'RECOVERY_REQUIRED',
      ),
      nowMs,
    );
  }

  private async recoverLegAfterRestart(
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
  ): Promise<CoordinatorResult> {
    const leg = phase === 'OPEN' ? this.stateValue.openingLegs[key] : this.stateValue.closingLegs[key];
    if (leg.submittedQuantity <= 0) return this.success();
    if (leg.lifecycle === 'SUBMITTING') {
      const nowMs = this.now();
      const failure = this.failure(
        `restart-pre-ack:${phase}:${key}`,
        'RESTART_PRE_ACK_OUTCOME_UNKNOWN',
        'The checkpoint was captured after submission started but before an acknowledgement became durable.',
        nowMs,
        true,
        'Look up the deterministic client-order ID with fresh owner truth before any progression.',
      );
      const ambiguous = this.emitAt(nowMs, 'LEG_RESPONSE_AMBIGUOUS', { phase, legKey: key, failure });
      if (!ambiguous.ok) return ambiguous;
      return this.resolveAmbiguity(this.requestFor(phase, key, leg.submittedQuantity), failure);
    }
    if (leg.lifecycle === 'AMBIGUOUS') return this.resolveOutstandingAmbiguity(phase, key);
    if (
      leg.lifecycle === 'ACKNOWLEDGED' ||
      leg.lifecycle === 'PARTIALLY_FILLED' ||
      leg.lifecycle === 'CANCEL_PENDING'
    ) return phase === 'OPEN' ? this.refreshOpeningLeg(key) : this.#refreshWorkingLegSingleFlight(phase, key);
    if (leg.lifecycle === 'FILLED' || leg.lifecycle === 'CANCELLED' || leg.lifecycle === 'REJECTED') {
      return this.verifyTerminalLegAfterRestart(phase, key);
    }
    return this.success();
  }

  /**
   * Restored coordinators cannot reuse pre-crash observations. Every submitted
   * leg is looked up through the newly injected owner ports, then the aggregate
   * is reconciled before any hedge or close progression is permitted.
   */
  async #recoverAfterRestartCurrent(): Promise<CoordinatorResult> {
    for (const phase of ['OPEN', 'CLOSE'] as const) {
      for (const key of EXECUTION_LEG_KEYS) {
        const recovered = await this.recoverLegAfterRestart(phase, key);
        if (!recovered.ok) {
          if (isTerminalPlanLifecycle(this.stateValue.lifecycle)) this.restartRecoveryPending = false;
          return recovered;
        }
      }
    }
    const reconciled = await this.#reconcileCurrent();
    if (reconciled.ok) this.restartRecoveryPending = false;
    return reconciled;
  }

  async recoverAfterRestart(): Promise<CoordinatorResult> {
    if (!this.restartRecoveryPending) return this.success();
    if (this.restartRecoveryInFlight !== null) return this.restartRecoveryInFlight;
    const run = Promise.resolve().then(() => this.#recoverAfterRestartCurrent());
    this.restartRecoveryInFlight = run;
    try {
      return await run;
    } finally {
      if (this.restartRecoveryInFlight === run) this.restartRecoveryInFlight = null;
    }
  }

  async #refreshWorkingLeg(phase: ExecutionLegPhase, key: ExecutionLegKey): Promise<CoordinatorResult> {
    const leg = phase === 'OPEN' ? this.stateValue.openingLegs[key] : this.stateValue.closingLegs[key];
    if (
      leg.lifecycle !== 'ACKNOWLEDGED' &&
      leg.lifecycle !== 'PARTIALLY_FILLED' &&
      leg.lifecycle !== 'CANCEL_PENDING'
    ) return this.success();
    const request = this.requestFor(phase, key, leg.submittedQuantity);
    let lookup: unknown;
    try {
      lookup = await this.ports.lookupByClientOrderId(request);
    } catch {
      lookup = {
        kind: 'UNRESOLVED',
        failure: {
          code: 'WORKING_ORDER_LOOKUP_FAILED',
          message: 'The read-only working-order lookup threw.',
          retryable: true,
          recommendedOperatorAction: 'Retry lookup by deterministic client-order ID; do not submit another order.',
        },
      };
    }
    const nowMs = this.now();
    const details = { phase, legKey: key } as const;
    if (!lookupEvidenceIsValid(request, lookup)) {
      const failure = this.failure(
        `refresh:${phase}:${key}`,
        'LOOKUP_OUTCOME_INVALID',
        'Read-only lookup returned a malformed or contradictory outcome.',
        nowMs,
        false,
        'Refresh exact order and fill evidence; do not size another leg.',
        'RECOVERY_REQUIRED',
      );
      const ambiguous = this.emitAt(nowMs, 'LEG_RESPONSE_AMBIGUOUS', { ...details, failure });
      if (!ambiguous.ok) return ambiguous;
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    const venueOrderDiverged =
      lookup.kind === 'FOUND' &&
      leg.venueOrderId !== null &&
      lookup.venueOrderId !== null &&
      lookup.venueOrderId !== leg.venueOrderId;
    const cumulativeRegressed =
      lookup.kind === 'FOUND' &&
      (lookup.status === 'PARTIALLY_FILLED' || lookup.status === 'FILLED' || lookup.status === 'CANCELLED') &&
      lookup.cumulativeFilledQuantity + QUANTITY_EPSILON < leg.cumulativeFilledQuantity;
    if (
      leg.lifecycle === 'CANCEL_PENDING' &&
      lookup.kind === 'FOUND' &&
      lookup.status === 'PARTIALLY_FILLED' &&
      !venueOrderDiverged &&
      !cumulativeRegressed
    ) {
      const updated = this.emitAt(nowMs, 'LEG_PARTIALLY_FILLED', {
        ...details,
        venueOrderId: lookup.venueOrderId,
        cumulativeFilledQuantity: lookup.cumulativeFilledQuantity,
      });
      if (!updated.ok) return updated;
      return this.failureResult(
        this.failure(
          `refresh:${phase}:${key}`,
          'WORKING_ORDER_FINALIZATION_PENDING',
          'The cancellation/fill race is still working and has no terminal cumulative fill.',
          nowMs,
          true,
          'Repeat read-only lookup until owner evidence is FILLED or CANCELLED; do not size another leg.',
        ),
      );
    }
    if (
      leg.lifecycle === 'CANCEL_PENDING' &&
      leg.cumulativeFilledQuantity <= QUANTITY_EPSILON &&
      lookup.kind === 'FOUND' &&
      lookup.status === 'ACKNOWLEDGED' &&
      !venueOrderDiverged
    ) {
      return this.failureResult(
        this.failure(
          `refresh:${phase}:${key}`,
          'WORKING_ORDER_FINALIZATION_PENDING',
          'The cancellation/fill race is still acknowledged and has no terminal cumulative fill.',
          nowMs,
          true,
          'Repeat read-only lookup until owner evidence is FILLED or CANCELLED; do not size another leg.',
        ),
      );
    }
    if (
      lookup.kind === 'UNRESOLVED' ||
      lookup.kind === 'PROVEN_ABSENT' ||
      venueOrderDiverged ||
      cumulativeRegressed ||
      (lookup.kind === 'FOUND' && lookup.status === 'REJECTED') ||
      (lookup.kind === 'FOUND' && leg.cumulativeFilledQuantity > QUANTITY_EPSILON && lookup.status === 'ACKNOWLEDGED')
    ) {
      const portFailure = lookup.kind === 'FOUND'
        ? lookup.failure ?? {
              code: 'WORKING_ORDER_EVIDENCE_DIVERGED',
              message: 'Working-order evidence regressed or contradicted an acknowledged fill.',
              retryable: true,
              recommendedOperatorAction: 'Refresh order and fill history; do not resubmit.',
          }
        : lookup.failure;
      const failure = this.fromPortFailure(
        `refresh:${phase}:${key}`,
        portFailure,
        nowMs,
        'RECOVERY_REQUIRED',
      );
      const ambiguous = this.emitAt(nowMs, 'LEG_RESPONSE_AMBIGUOUS', { ...details, failure });
      if (!ambiguous.ok) return ambiguous;
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    if (lookup.status === 'ACKNOWLEDGED') {
      return this.emitAt(nowMs, 'LEG_ACKNOWLEDGED', { ...details, venueOrderId: lookup.venueOrderId });
    }
    if (lookup.status === 'CANCELLED') {
      return this.emitAt(nowMs, 'LEG_CANCELLED', {
        ...details,
        venueOrderId: lookup.venueOrderId,
        cumulativeFilledQuantity: lookup.cumulativeFilledQuantity,
      });
    }
    return this.emitAt(nowMs, lookup.status === 'FILLED' ? 'LEG_FILLED' : 'LEG_PARTIALLY_FILLED', {
      ...details,
      venueOrderId: lookup.venueOrderId,
      cumulativeFilledQuantity: lookup.cumulativeFilledQuantity,
    });
  }

  async #refreshWorkingLegSingleFlight(
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
  ): Promise<CoordinatorResult> {
    const identity = `${phase}:${key}`;
    const existing = this.workingRefreshInFlight.get(identity);
    if (existing !== undefined) return existing;
    const run = Promise.resolve().then(() => this.#refreshWorkingLeg(phase, key));
    this.workingRefreshInFlight.set(identity, run);
    try {
      return await run;
    } finally {
      if (this.workingRefreshInFlight.get(identity) === run) this.workingRefreshInFlight.delete(identity);
    }
  }

  /**
   * Accepted read-only lifecycle seam for an opening order that can still add
   * exposure. It records cancellation intent but has no cancel/send port. A
   * dependent hedge remains blocked until lookup proves FILLED or CANCELLED.
   */
  async #refreshOpeningLegCurrent(key: ExecutionLegKey): Promise<CoordinatorResult> {
    const before = this.stateValue.openingLegs[key];
    if (
      before.lifecycle !== 'ACKNOWLEDGED' &&
      before.lifecycle !== 'PARTIALLY_FILLED' &&
      before.lifecycle !== 'CANCEL_PENDING'
    ) return this.success();
    const refreshed = await this.#refreshWorkingLegSingleFlight('OPEN', key);
    if (!refreshed.ok) return refreshed;
    const current = this.stateValue.openingLegs[key];
    if (current.lifecycle === 'ACKNOWLEDGED' || current.lifecycle === 'PARTIALLY_FILLED') {
      const requested = this.emitAt(this.now(), 'LEG_CANCEL_REQUESTED', { phase: 'OPEN', legKey: key });
      if (!requested.ok) return requested;
    }
    const final = this.stateValue.openingLegs[key];
    if (final.lifecycle === 'FILLED' || final.lifecycle === 'CANCELLED') return this.success();
    const nowMs = this.now();
    return this.failureResult(
      this.failure(
        `open-finalize:${key}`,
        'OPENING_REMAINDER_FINALIZATION_REQUIRED',
        'The opening predecessor can still fill, so its final cumulative quantity is not stable for hedge sizing.',
        nowMs,
        true,
        'Use the separately authorized cancellation owner, then repeat read-only lookup; no send capability exists here.',
      ),
    );
  }

  async refreshOpeningLeg(key: ExecutionLegKey): Promise<CoordinatorResult> {
    const existing = this.openingRefreshInFlight.get(key);
    if (existing !== undefined) return existing;
    const run = Promise.resolve().then(() => this.#refreshOpeningLegCurrent(key));
    this.openingRefreshInFlight.set(key, run);
    try {
      return await run;
    } finally {
      if (this.openingRefreshInFlight.get(key) === run) this.openingRefreshInFlight.delete(key);
    }
  }

  async requestClose(emergency = false): Promise<CoordinatorResult> {
    if (this.restartRecoveryPending) {
      const recovered = await this.recoverAfterRestart();
      if (!recovered.ok) return recovered;
    }
    if (this.stateValue.lifecycle === 'CLOSED') return this.success();
    const nowMs = this.now();
    if (this.stateValue.plan.mode !== 'PAPER') {
      return this.failureResult(
        this.failure('close', 'NON_PAPER_SUBMISSION_BLOCKED', 'Only PAPER plans can use the submission port.', nowMs, false, 'No live/manual transport exists.'),
      );
    }
    if (hasAmbiguousLeg(this.stateValue)) {
      return this.failureResult(
        this.failure(
          'close',
          'AMBIGUOUS_EXPOSURE_REQUIRES_LOOKUP',
          'A close cannot be sized safely while an order outcome is ambiguous.',
          nowMs,
          true,
          'Resolve every ambiguous client-order ID with read-only evidence first.',
        ),
      );
    }
    if (hasWorkingOpeningLeg(this.stateValue)) {
      return this.failureResult(
        this.failure(
          'close',
          'OPENING_ORDER_NOT_FINAL',
          'A working opening order can still change exposure, so a close cannot be sized from the current partial.',
          nowMs,
          true,
          'Terminalize every opening client-order ID with owner evidence before sizing a close.',
        ),
      );
    }
    if (!hasKnownOpenExposure(this.stateValue)) {
      return this.failureResult(
        this.failure('close', 'NO_KNOWN_EXPOSURE', 'No known open exposure exists to close.', nowMs, false, 'Reconcile rather than fabricate a close quantity.'),
      );
    }
    if (!['HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'CLOSE_REQUESTED', 'CLOSING'].includes(this.stateValue.lifecycle)) {
      return this.failureResult(
        this.failure('close', 'CLOSE_NOT_ALLOWED', 'The current lifecycle does not permit close.', nowMs, false, 'Inspect lifecycle and reconcile.'),
      );
    }
    if (this.stateValue.lifecycle !== 'CLOSE_REQUESTED' && this.stateValue.lifecycle !== 'CLOSING') {
      const requested = this.emitAt(nowMs, 'CLOSE_REQUESTED', { emergency });
      if (!requested.ok) return requested;
    }

    for (const key of EXECUTION_LEG_KEYS) {
      const quantity = residualQuantity(this.stateValue, key);
      if (quantity <= 1e-12) continue;
      if (this.stateValue.closingLegs[key].lifecycle !== 'PLANNED') continue;
      const request = this.requestFor('CLOSE', key, quantity);
      let validation;
      try {
        validation = await this.ports.validateLeg(request);
      } catch {
        validation = { ok: false as const, failure: {
          code: 'INJECTED_PORT_THREW',
          message: 'The injected close validation port threw.',
          retryable: false,
          recommendedOperatorAction: 'Inspect close validation before retrying.',
        } };
      }
      if (!validation.ok) {
        const failure = this.fromPortFailure(
          `close-validate:${key}`,
          validation.failure,
          nowMs,
          'RECOVERY_REQUIRED',
        );
        const rejected = this.emitAt(nowMs, 'LEG_REJECTED', { phase: 'CLOSE', legKey: key, failure });
        return rejected.ok ? this.failureResult(failure) : rejected;
      }
      const validated = this.emitAt(nowMs, 'LEG_VALIDATED', { phase: 'CLOSE', legKey: key });
      if (!validated.ok) return validated;
    }
    return this.success();
  }

  async close(emergency = false): Promise<CoordinatorResult> {
    const requested = await this.requestClose(emergency);
    if (!requested.ok) return requested;
    if (this.stateValue.lifecycle === 'CLOSE_REQUESTED') {
      const started = this.emitAt(this.now(), 'CLOSING_STARTED');
      if (!started.ok) return started;
    }
    for (const key of EXECUTION_LEG_KEYS) {
      const quantity = residualQuantity(this.stateValue, key);
      if (quantity <= 1e-12) continue;
      const lifecycle = this.stateValue.closingLegs[key].lifecycle;
      if (lifecycle === 'ACKNOWLEDGED' || lifecycle === 'PARTIALLY_FILLED') {
        const refreshed = await this.#refreshWorkingLegSingleFlight('CLOSE', key);
        if (!refreshed.ok) return refreshed;
        continue;
      }
      if (lifecycle !== 'VALIDATED') continue;
      const submitted = await this.#submitLeg(this.requestFor('CLOSE', key, quantity));
      if (!submitted.ok) return submitted;
    }
    if (!hasKnownOpenExposure(this.stateValue) && !hasAmbiguousLeg(this.stateValue)) {
      return this.reconcile();
    }
    const nowMs = this.now();
    return this.failureResult(
      this.failure(
        'close',
        'CLOSE_INCOMPLETE',
        'Known exposure remains after the close attempt.',
        nowMs,
        true,
        'Reconcile fills and evaluate an authorized risk-reducing recovery.',
      ),
    );
  }

  async #reconcileCurrent(): Promise<CoordinatorResult> {
    if (this.stateValue.lifecycle === 'CLOSED') return this.success();
    const nowMs = this.now();
    if (this.stateValue.lifecycle !== 'RECONCILING') {
      const started = this.emitAt(nowMs, 'RECONCILIATION_STARTED');
      if (!started.ok) return started;
    }
    let outcome;
    try {
      outcome = await this.ports.reconcile(this.stateValue);
    } catch {
      outcome = {
        kind: 'UNRESOLVED' as const,
        failure: {
          code: 'RECONCILIATION_PORT_THREW',
          message: 'The injected reconciliation port threw.',
          retryable: true,
          recommendedOperatorAction: 'Refresh read-only evidence and retry reconciliation.',
        },
      };
    }
    if (outcome.kind === 'UNRESOLVED') {
      const failure = this.fromPortFailure('reconcile', outcome.failure, nowMs, 'RECOVERY_REQUIRED');
      const resolved = this.emitAt(nowMs, 'RECONCILIATION_RESOLVED', {
        reconciliationOutcome: 'RECOVERY_REQUIRED',
        failure,
      });
      return resolved.ok ? this.failureResult(failure) : resolved;
    }
    return this.emitAt(nowMs, 'RECONCILIATION_RESOLVED', { reconciliationOutcome: outcome.kind });
  }

  async reconcile(): Promise<CoordinatorResult> {
    if (this.restartRecoveryPending) return this.recoverAfterRestart();
    return this.#reconcileCurrent();
  }

  evaluateNakedDuration(): CoordinatorResult {
    if (this.stateValue.lifecycle === 'RECOVERY_REQUIRED') return this.success();
    const nowMs = this.now();
    if (
      this.stateValue.exposedSinceMs === null ||
      nowMs < this.stateValue.exposedSinceMs + this.stateValue.plan.maxNakedDurationMs
    ) return this.success();
    return this.emitAt(nowMs, 'NAKED_DURATION_EXPIRED');
  }

  cancel(): CoordinatorResult {
    if (this.stateValue.lifecycle === 'CANCELLED') return this.success();
    const nowMs = this.now();
    if (this.restartRecoveryPending) {
      return this.failureResult(
        this.failure(
          'cancel',
          'RESTART_RECOVERY_REQUIRED',
          'Cold-restart owner lookup and reconciliation have not completed.',
          nowMs,
          true,
          'Run recoverAfterRestart before any lifecycle progression.',
        ),
      );
    }
    if (hasKnownOpenExposure(this.stateValue) || hasAmbiguousLeg(this.stateValue) || hasActiveWorkingLeg(this.stateValue)) {
      return this.failureResult(
        this.failure(
          'cancel',
          'UNRESOLVED_EXPOSURE',
          'Cancellation cannot discard known, ambiguous, submitting, acknowledged, or otherwise working order state.',
          nowMs,
          false,
          'Use reconciliation and an authorized risk-reducing close.',
        ),
      );
    }
    return this.emitAt(nowMs, 'PLAN_CANCELLED');
  }
}

export function createExecutionCoordinator(
  input: CreateExecutionPlanInput,
  clock: ExecutionClock,
  ports: ExecutionCoordinatorPorts,
): ExecutionCoordinator {
  const plan = createExecutionPlanDefinition(input);
  const nowMs = clock.nowMs();
  if (!isValidUtcMillis(nowMs)) throw new TypeError('ExecutionClock.nowMs() must return valid UTC ms');
  const created = reduceExecutionEvent(
    null,
    createExecutionEvent(plan.planId, 1, nowMs, 'PLAN_CREATED', { plan }),
  );
  if (!created.applied) throw new TypeError(`Unable to create execution aggregate (${created.reason})`);
  return new ExecutionCoordinator(created.state, clock, ports);
}

export function restoreExecutionCoordinator(
  checkpoint: string,
  clock: ExecutionClock,
  ports: ExecutionCoordinatorPorts,
): CoordinatorRestoreResult {
  const restored = restoreExecutionCheckpoint(checkpoint);
  if (!restored.ok) return Object.freeze({ ok: false as const, code: restored.code, message: restored.message });
  try {
    return Object.freeze({
      ok: true as const,
      coordinator: new ExecutionCoordinator(restored.state, clock, ports, true),
    });
  } catch (error) {
    if (error instanceof PlanTermsConflictError) {
      return Object.freeze({ ok: false as const, code: error.code, message: error.message });
    }
    throw error;
  }
}
