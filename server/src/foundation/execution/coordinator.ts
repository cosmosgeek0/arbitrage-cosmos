import {
  checkExecutionModePermitted,
  createStructuredFailure,
  isValidUtcMillis,
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

function residualQuantity(state: ExecutionPlanState, key: ExecutionLegKey): number {
  return Math.max(
    0,
    state.openingLegs[key].cumulativeFilledQuantity - state.closingLegs[key].cumulativeFilledQuantity,
  );
}

export class ExecutionCoordinator {
  private stateValue: ExecutionPlanState;

  constructor(
    state: ExecutionPlanState,
    private readonly clock: ExecutionClock,
    private readonly ports: ExecutionCoordinatorPorts,
  ) {
    this.stateValue = state;
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
    return Object.freeze({ ok: false as const, state: this.stateValue, failure });
  }

  private failure(
    stage: string,
    code: string,
    message: string,
    nowMs: number,
    retryable: boolean,
    recommendedOperatorAction: string,
  ): Readonly<StructuredFailure> {
    return createStructuredFailure({
      component: 'foundation.execution.coordinator',
      stage,
      code: validPortCode(code) ? code : 'PORT_FAILURE',
      message,
      occurredAt: nowMs,
      retryable,
      safeCurrentState: this.stateValue.lifecycle,
      recommendedOperatorAction,
      correlationId: this.stateValue.plan.correlationId,
    });
  }

  private fromPortFailure(stage: string, failure: PortFailure, nowMs: number): Readonly<StructuredFailure> {
    return this.failure(
      stage,
      failure.code,
      failure.message,
      nowMs,
      failure.retryable,
      failure.recommendedOperatorAction,
    );
  }

  private portThrew(stage: string, nowMs: number, ambiguous: boolean): Readonly<StructuredFailure> {
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
    );
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
    const failure = this.failure(
      stage,
      code,
      'The proposal or approval entry window is no longer valid at the submission boundary.',
      nowMs,
      false,
      'Do not submit new entry risk; reconcile any exposure and create a fresh approved plan.',
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
      const failure = this.portThrew('preflight', nowMs, false);
      this.emitAt(nowMs, 'PREFLIGHT_FAILED', { failure });
      return this.failureResult(failure);
    }
    if (!portResult.ok) {
      const failure = this.fromPortFailure('preflight', portResult.failure, nowMs);
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
        const failure = this.fromPortFailure(`preflight:${key}`, validation.failure, nowMs);
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

  async submitNextOpeningLeg(): Promise<CoordinatorResult> {
    const gate = this.beginOpen();
    if (!gate.ok) return gate;
    const deadline = this.enforceNakedDeadline('open:naked-deadline', this.now());
    if (deadline !== null) return deadline;
    const order = this.stateValue.plan.openingOrder;
    for (let index = 0; index < order.length; index += 1) {
      const key = order[index];
      const leg = this.stateValue.openingLegs[key];
      if (leg.lifecycle !== 'VALIDATED') continue;
      if (index > 0) {
        const prior = this.stateValue.openingLegs[order[index - 1]];
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

  async open(): Promise<CoordinatorResult> {
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
      const failure = this.fromPortFailure(`submit:${request.phase}:${request.leg.key}`, outcome.failure, nowMs);
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
    let lookup: LookupOutcome;
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
    if (lookup.kind === 'UNRESOLVED') {
      const failure = this.fromPortFailure(`lookup:${request.phase}:${request.leg.key}`, lookup.failure, nowMs);
      const unresolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_UNRESOLVED', { ...details, failure });
      return unresolved.ok ? this.failureResult(failure) : unresolved;
    }
    if (lookup.kind === 'PROVEN_ABSENT') {
      const failure = this.fromPortFailure(`lookup:${request.phase}:${request.leg.key}`, lookup.failure, nowMs);
      const resolved = this.emitAt(nowMs, 'LEG_AMBIGUITY_RESOLVED', {
        ...details,
        ambiguityResolution: 'REJECTED',
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
      const failure = this.fromPortFailure(`lookup:${request.phase}:${request.leg.key}`, portFailure, nowMs);
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

  async #refreshWorkingLeg(phase: ExecutionLegPhase, key: ExecutionLegKey): Promise<CoordinatorResult> {
    const leg = phase === 'OPEN' ? this.stateValue.openingLegs[key] : this.stateValue.closingLegs[key];
    if (leg.lifecycle !== 'ACKNOWLEDGED' && leg.lifecycle !== 'PARTIALLY_FILLED') return this.success();
    const request = this.requestFor(phase, key, leg.submittedQuantity);
    let lookup: LookupOutcome;
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
    if (
      lookup.kind === 'UNRESOLVED' ||
      lookup.kind === 'PROVEN_ABSENT' ||
      (lookup.kind === 'FOUND' && lookup.status === 'REJECTED') ||
      (lookup.kind === 'FOUND' && leg.lifecycle === 'PARTIALLY_FILLED' && lookup.status === 'ACKNOWLEDGED')
    ) {
      const portFailure = lookup.kind === 'FOUND'
        ? lookup.failure ?? {
            code: 'WORKING_ORDER_EVIDENCE_DIVERGED',
            message: 'Working-order evidence regressed or contradicted an acknowledged fill.',
            retryable: true,
            recommendedOperatorAction: 'Refresh order and fill history; do not resubmit.',
          }
        : lookup.failure;
      const failure = this.fromPortFailure(`refresh:${phase}:${key}`, portFailure, nowMs);
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

  async requestClose(emergency = false): Promise<CoordinatorResult> {
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
        const failure = this.fromPortFailure(`close-validate:${key}`, validation.failure, nowMs);
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
        const refreshed = await this.#refreshWorkingLeg('CLOSE', key);
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

  async reconcile(): Promise<CoordinatorResult> {
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
      const failure = this.fromPortFailure('reconcile', outcome.failure, nowMs);
      const resolved = this.emitAt(nowMs, 'RECONCILIATION_RESOLVED', {
        reconciliationOutcome: 'RECOVERY_REQUIRED',
        failure,
      });
      return resolved.ok ? this.failureResult(failure) : resolved;
    }
    return this.emitAt(nowMs, 'RECONCILIATION_RESOLVED', { reconciliationOutcome: outcome.kind });
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
    return Object.freeze({ ok: true as const, coordinator: new ExecutionCoordinator(restored.state, clock, ports) });
  } catch (error) {
    if (error instanceof PlanTermsConflictError) {
      return Object.freeze({ ok: false as const, code: error.code, message: error.message });
    }
    throw error;
  }
}
