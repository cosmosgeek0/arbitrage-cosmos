import { createHash } from 'node:crypto';
import {
  type SystemControlMutation,
  type SystemControlMutationReceipt,
  type SystemControlMutationRequest,
  type SystemControlMutationResult,
  type SystemControlState,
} from '../contracts/index.js';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import {
  SYSTEM_CONTROL_CANONICAL_ALARM_ACTOR,
  SYSTEM_CONTROL_FAILURE_CODES,
  type SystemControlActor,
  type SystemControlCompositionDecision,
  type SystemControlRouteRejection,
  type SystemControlServiceOptions,
} from './types.js';
import {
  CORRELATION_ID_PATTERN,
  containsSensitiveMaterial,
  IDEMPOTENCY_KEY_PATTERN,
  validReason,
  validateControlMutation,
} from './validation.js';

function safeDecisionMessage(value: string): string {
  return value.length > 0
    && value.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !containsSensitiveMaterial(value)
    ? value
    : 'Control is not applicable in the current system state.';
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function requiresRuntimePublication(mutation: Readonly<SystemControlMutation>): boolean {
  return mutation.command === 'RESTART_COMPONENT'
    || mutation.command === 'SET_COMPONENT_STATE'
    || mutation.command === 'CLEAR_DEPLOYMENT_FREEZE'
    || mutation.command === 'SET_BASIS_SYMBOL_POLICY'
    || mutation.command === 'SET_VOLUME_SYMBOL_POLICY'
    || mutation.command === 'REDUCE_SIZE_CEILING'
    || mutation.command === 'SET_STRATEGY_THRESHOLD'
    || mutation.command === 'PIN_FOCUS';
}

export function controlRequestDigest(request: Readonly<SystemControlMutationRequest>): string {
  return digest({
    expectedRevision: request.expectedRevision,
    reason: request.reason,
    mutation: request.mutation,
  });
}

function freezeState(state: Readonly<SystemControlState>): Readonly<SystemControlState> {
  return Object.freeze({ ...state });
}

function validControlState(state: Readonly<SystemControlState>): boolean {
  return Number.isSafeInteger(state.revision)
    && state.revision >= 0
    && Number.isSafeInteger(state.generation)
    && state.generation >= 0
    && typeof state.killSwitchEngaged === 'boolean'
    && typeof state.intakePaused === 'boolean'
    && isValidUtcMillis(state.updatedAtMs)
    && CORRELATION_ID_PATTERN.test(state.correlationId)
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(state.safeMode);
}

function validActor(actor: Readonly<SystemControlActor>): boolean {
  const canonicalAlarm = actor?.source === 'canonical-alarm';
  return typeof actor?.id === 'string'
    && actor.id.trim().length > 0
    && actor.id.length <= 160
    && (actor.email === null || (typeof actor.email === 'string' && actor.email.length <= 320))
    && (actor.source === 'loopback' || actor.source === 'cloudflare-access' || canonicalAlarm)
    && (!canonicalAlarm || (
      actor.id === SYSTEM_CONTROL_CANONICAL_ALARM_ACTOR.id
      && actor.email === null
    ));
}

export class SystemControlService {
  private stateValue: Readonly<SystemControlState>;
  private readonly persistence: SystemControlServiceOptions['persistence'];
  private readonly composition: SystemControlServiceOptions['composition'];

  constructor(options: SystemControlServiceOptions) {
    if (!options || !validControlState(options.initialState)) {
      throw new TypeError('SystemControlService requires one valid fail-closed initial state.');
    }
    if (
      typeof options.persistence?.findControlMutation !== 'function'
      || typeof options.persistence?.recordControlRejection !== 'function'
      || typeof options.persistence?.commitControlMutation !== 'function'
    ) {
      throw new TypeError('SystemControlService requires a persistence port.');
    }
    if (
      typeof options.composition?.inspectMutation !== 'function'
      || typeof options.composition?.publishCommitted !== 'function'
    ) throw new TypeError('SystemControlService requires a composition port.');
    this.stateValue = freezeState(options.initialState);
    this.persistence = options.persistence;
    this.composition = options.composition;
  }

  snapshot(): Readonly<SystemControlState> {
    return this.stateValue;
  }

  /** Read-only access to the one durable control receipt owner. */
  readResult(idempotencyKey: string): ReturnType<SystemControlServiceOptions['persistence']['findControlMutation']> {
    return this.persistence.findControlMutation(idempotencyKey);
  }

  /**
   * Synchronizes only a durability-proven L14 revision reservation. It cannot
   * change mode, kill, intake, generation, or skip a revision, and therefore
   * cannot act as a second control mutation path.
   */
  synchronizeReservedRevision(state: Readonly<SystemControlState>): boolean {
    if (!validControlState(state)) return false;
    const current = this.stateValue;
    const unchangedProjection = state.generation === current.generation
      && state.safeMode === current.safeMode
      && state.killSwitchEngaged === current.killSwitchEngaged
      && state.intakePaused === current.intakePaused;
    const exactReplay = unchangedProjection
      && state.revision === current.revision
      && state.updatedAtMs === current.updatedAtMs
      && state.correlationId === current.correlationId;
    if (exactReplay) return true;
    if (!unchangedProjection
      || state.revision !== current.revision + 1
      || state.updatedAtMs < current.updatedAtMs
      || !/^l14\.cmd_[a-f0-9]{16,64}$/.test(state.correlationId)) return false;
    this.stateValue = freezeState(state);
    return true;
  }

  private async recordRejection(
    rejection: Readonly<SystemControlRouteRejection>,
    actor: Readonly<SystemControlActor>,
    operatorReason = '',
  ): Promise<void> {
    if (!validActor(actor)) return;
    const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(rejection.code) ? rejection.code : 'CONTROL_REJECTED';
    const message = safeDecisionMessage(rejection.message);
    const idempotencyKey = typeof rejection.idempotencyKey === 'string'
      && IDEMPOTENCY_KEY_PATTERN.test(rejection.idempotencyKey)
      ? rejection.idempotencyKey
      : null;
    const expectedRevision = Number.isSafeInteger(rejection.expectedRevision)
      && (rejection.expectedRevision as number) >= 0
      ? rejection.expectedRevision
      : null;
    const command = typeof rejection.command === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(rejection.command)
      ? rejection.command
      : null;
    const occurredAtMs = isValidUtcMillis(rejection.requestedAtMs)
      ? rejection.requestedAtMs
      : this.stateValue.updatedAtMs;
    const correlationId = CORRELATION_ID_PATTERN.test(rejection.correlationId)
      ? rejection.correlationId
      : this.stateValue.correlationId;
    const requestDigest = digest({
      idempotencyKey,
      expectedRevision,
      command,
      code,
      operatorReasonDigest: validReason(operatorReason) ? digest(operatorReason) : null,
    });
    const dedupeKey = digest({ actorId: actor.id, idempotencyKey, correlationId, requestDigest });
    try {
      await this.persistence.recordControlRejection(Object.freeze({
        dedupeKey,
        idempotencyKey,
        requestDigest,
        command,
        expectedRevision,
        currentRevision: this.stateValue.revision,
        code,
        message,
        correlationId,
        occurredAtMs,
        actor,
        applied: false as const,
      }));
    } catch {
      // The rejected mutation remains fail-closed. Persistence degradation is
      // exposed by the supervisor; raw hostile input is never logged as a fallback.
    }
  }

  async auditRejectedRequest(
    rejection: Readonly<SystemControlRouteRejection>,
    actor: Readonly<SystemControlActor>,
  ): Promise<void> {
    await this.recordRejection(rejection, actor);
  }

  private async rejected(
    request: Readonly<SystemControlMutationRequest>,
    actor: Readonly<SystemControlActor>,
    failure: Readonly<StructuredFailure>,
  ): Promise<SystemControlMutationResult> {
    const rawMutation = request.mutation as unknown;
    const command = rawMutation !== null && typeof rawMutation === 'object' && !Array.isArray(rawMutation)
      ? (rawMutation as Record<string, unknown>).command
      : null;
    await this.recordRejection({
      idempotencyKey: typeof request.idempotencyKey === 'string' ? request.idempotencyKey : null,
      expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : null,
      command: typeof command === 'string' ? command : null,
      requestedAtMs: request.requestedAtMs,
      correlationId: request.correlationId,
      code: failure.code,
      message: failure.message,
    }, actor, request.reason);
    return fail(failure);
  }

  private failure(
    request: Partial<SystemControlMutationRequest>,
    code: string,
    message: string,
    retryable = false,
    action = 'Correct the request and retry with the current control revision.',
  ): Readonly<StructuredFailure> {
    const occurredAt = isValidUtcMillis(request.requestedAtMs) ? request.requestedAtMs : this.stateValue.updatedAtMs;
    const correlationId = typeof request.correlationId === 'string' && CORRELATION_ID_PATTERN.test(request.correlationId)
      ? request.correlationId
      : this.stateValue.correlationId;
    return createStructuredFailure({
      component: 'systemIntegration.controls',
      stage: 'mutate',
      code,
      message,
      occurredAt,
      retryable,
      safeCurrentState: this.stateValue.safeMode,
      recommendedOperatorAction: action,
      correlationId,
    });
  }

  private runtimePublicationPendingFailure(
    request: Readonly<SystemControlMutationRequest>,
  ): Readonly<StructuredFailure> {
    return this.failure(
      request,
      SYSTEM_CONTROL_FAILURE_CODES.CONTROL_COMMITTED_RUNTIME_PENDING,
      'The control intent is durable, but managed runtime publication is not yet durably confirmed.',
      true,
      'Retry the exact request with the same Idempotency-Key after canonical effect readback is available.',
    );
  }

  private async publishPendingRuntimeEffect(
    request: Readonly<SystemControlMutationRequest>,
    actor: Readonly<SystemControlActor>,
    receipt: Readonly<SystemControlMutationReceipt>,
    requestDigest: string,
    newlyCommitted: boolean,
  ): Promise<SystemControlMutationResult> {
    if (!receipt.applied || !requiresRuntimePublication(request.mutation)) return ok(receipt);
    try {
      let readback = newlyCommitted
        ? 'NOT_APPLIED'
        : await this.composition.inspectCommittedPublication?.(request, receipt) ?? 'UNKNOWN';
      if (readback === 'UNKNOWN') return fail(this.runtimePublicationPendingFailure(request));
      if (readback === 'NOT_APPLIED') {
        // The new commit was already admitted by the exact inspection that
        // produced its durable receipt. Only a later replay needs a fresh
        // applicability check before reissuing a proven-absent effect.
        if (!newlyCommitted) {
          const decision = await this.composition.inspectMutation(request.mutation, this.stateValue);
          if (!decision || decision.ok !== true || decision.applied !== true) {
            return fail(this.runtimePublicationPendingFailure(request));
          }
        }
        await this.composition.publishCommitted(request, actor, receipt);
        readback = await this.composition.inspectCommittedPublication?.(request, receipt) ?? 'UNKNOWN';
        if (readback !== 'APPLIED') return fail(this.runtimePublicationPendingFailure(request));
      }
      if (typeof this.persistence.markControlRuntimePublished !== 'function') {
        return fail(this.runtimePublicationPendingFailure(request));
      }
      await this.persistence.markControlRuntimePublished({
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        correlationId: receipt.after.correlationId,
        occurredAtMs: receipt.after.updatedAtMs,
      });
      return ok(receipt);
    } catch {
      return fail(this.runtimePublicationPendingFailure(request));
    }
  }

  private validateRequest(
    request: Readonly<SystemControlMutationRequest>,
    actor: Readonly<SystemControlActor>,
  ): Readonly<StructuredFailure> | null {
    if (!validActor(actor)) {
      return this.failure(request, 'OPERATOR_REQUIRED', 'A verified operator identity is required.');
    }
    if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      return this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key is required.');
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) {
      return this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.IDEMPOTENCY_KEY_INVALID, 'Idempotency-Key is invalid.');
    }
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
      return this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.INVALID_CONTROL_REQUEST, 'expectedRevision must be a non-negative safe integer.');
    }
    if (!validReason(request.reason)) {
      return this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.INVALID_CONTROL_REQUEST, 'reason must contain 1-240 bounded printable characters.');
    }
    if (!isValidUtcMillis(request.requestedAtMs) || !CORRELATION_ID_PATTERN.test(request.correlationId)) {
      return this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.INVALID_CONTROL_REQUEST, 'Request time or correlation ID is invalid.');
    }
    const mutation = validateControlMutation(request.mutation);
    if (!mutation.ok) return this.failure(request, mutation.code, mutation.message);
    if (actor.source === 'canonical-alarm' && !(
      mutation.mutation.command === 'SET_KILL_SWITCH'
      && mutation.mutation.engaged === true
    )) {
      return this.failure(
        request,
        'OPERATOR_REQUIRED',
        'The canonical alarm actor can only engage the kill switch; an operator is required for every other control.',
      );
    }
    return null;
  }

  private nextState(
    request: Readonly<SystemControlMutationRequest>,
    decision: Readonly<SystemControlCompositionDecision>,
  ): { readonly applied: boolean; readonly code: string; readonly state: Readonly<SystemControlState> } {
    const mutation = request.mutation;
    let applied = decision.applied;
    let safeMode = this.stateValue.safeMode;
    let killSwitchEngaged = this.stateValue.killSwitchEngaged;
    let intakePaused = this.stateValue.intakePaused;
    let generation = this.stateValue.generation;
    let code = decision.code || 'CONTROL_APPLIED';

    if (mutation.command === 'SET_SAFE_MODE') {
      applied = mutation.safeMode !== safeMode;
      safeMode = mutation.safeMode;
    } else if (mutation.command === 'SET_KILL_SWITCH') {
      applied = mutation.engaged !== killSwitchEngaged || (mutation.engaged && !intakePaused);
      killSwitchEngaged = mutation.engaged;
      // Fail-closed asymmetry: engaging kill also drains intake; releasing it
      // never silently resumes intake or creates new exposure.
      if (mutation.engaged) intakePaused = true;
    } else if (mutation.command === 'SET_INTAKE_PAUSED') {
      applied = mutation.paused !== intakePaused;
      intakePaused = mutation.paused;
    } else if (mutation.command === 'RESTART_COMPONENT' && applied) {
      generation += 1;
    }

    if (!applied) code = 'CONTROL_NOOP';
    const state = applied
      ? freezeState({
          revision: this.stateValue.revision + 1,
          generation,
          safeMode,
          killSwitchEngaged,
          intakePaused,
          updatedAtMs: request.requestedAtMs,
          correlationId: request.correlationId,
        })
      : this.stateValue;
    return { applied, code, state };
  }

  async mutate(
    request: Readonly<SystemControlMutationRequest>,
    actor: Readonly<SystemControlActor>,
  ): Promise<SystemControlMutationResult> {
    const requestFailure = this.validateRequest(request, actor);
    if (requestFailure) return this.rejected(request, actor, requestFailure);

    const checkedMutation = validateControlMutation(request.mutation);
    if (!checkedMutation.ok) {
      return this.rejected(request, actor, this.failure(request, checkedMutation.code, checkedMutation.message));
    }
    const requestDigest = controlRequestDigest(request);
    try {
      const existing = await this.persistence.findControlMutation(request.idempotencyKey);
      if (existing) {
        if (existing.requestDigest !== requestDigest) {
          return this.rejected(request, actor, this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.IDEMPOTENCY_KEY_CONFLICT, 'Idempotency-Key was already used for different control intent.'));
        }
        if (requiresRuntimePublication(request.mutation)
          && existing.receipt.applied
          && existing.runtimePublication !== 'PUBLISHED') {
          return this.publishPendingRuntimeEffect(request, actor, existing.receipt, requestDigest, false);
        }
        return ok(existing.receipt);
      }
    } catch {
      return fail(this.failure(
        request,
        SYSTEM_CONTROL_FAILURE_CODES.CONTROL_PERSISTENCE_UNAVAILABLE,
        'Control persistence is unavailable; idempotency could not be verified.',
        true,
      ));
    }
    // The persistence transaction remains the final revision comparison and
    // closes the race between this lookup and the atomic commit.
    if (
      request.mutation.command === 'SET_INTAKE_PAUSED'
      && request.mutation.paused === false
      && this.stateValue.killSwitchEngaged
    ) {
      return this.rejected(request, actor, this.failure(
        request,
        SYSTEM_CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED,
        'New strategy intake cannot resume while the kill switch is engaged.',
      ));
    }

    let decision: SystemControlCompositionDecision;
    const safetyReducing = (
      checkedMutation.mutation.command === 'SET_KILL_SWITCH' && checkedMutation.mutation.engaged
    ) || (
      checkedMutation.mutation.command === 'SET_INTAKE_PAUSED' && checkedMutation.mutation.paused
    );
    if (safetyReducing) {
      decision = {
        ok: true,
        applied: true,
        riskIncreasing: false,
        code: checkedMutation.mutation.command === 'SET_KILL_SWITCH' ? 'KILL_SWITCH_ENGAGED' : 'INTAKE_PAUSED',
        message: '',
      };
    } else try {
      decision = await this.composition.inspectMutation(checkedMutation.mutation, this.stateValue);
    } catch {
      return this.rejected(request, actor, this.failure(request, 'COMPOSITION_CHECK_UNAVAILABLE', 'Control applicability could not be verified.', true));
    }
    if (
      !decision
      || typeof decision.ok !== 'boolean'
      || typeof decision.applied !== 'boolean'
      || typeof decision.riskIncreasing !== 'boolean'
      || typeof decision.code !== 'string'
      || typeof decision.message !== 'string'
    ) return this.rejected(request, actor, this.failure(request, 'COMPOSITION_CONTRACT_INVALID', 'Composition returned an invalid control decision.'));
    if (!decision.ok) {
      const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(decision.code)
        ? decision.code
        : SYSTEM_CONTROL_FAILURE_CODES.COMMAND_NOT_APPLICABLE;
      return this.rejected(request, actor, this.failure(request, code, safeDecisionMessage(decision.message)));
    }
    if (decision.riskIncreasing && this.stateValue.killSwitchEngaged) {
      return this.rejected(request, actor, this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED, 'Kill switch blocks risk-increasing control activity.'));
    }

    const transition = this.nextState(request, decision);
    let persisted;
    try {
      persisted = await this.persistence.commitControlMutation({
        request,
        actor,
        requestDigest,
        before: this.stateValue,
        after: transition.state,
        applied: transition.applied,
        code: transition.code,
      });
    } catch {
      return fail(this.failure(
        request,
        SYSTEM_CONTROL_FAILURE_CODES.CONTROL_PERSISTENCE_UNAVAILABLE,
        'Control persistence is unavailable; no in-memory mutation was applied.',
        true,
      ));
    }

    if (persisted.kind === 'IDEMPOTENCY_CONFLICT' || (
      persisted.kind === 'IDEMPOTENT_REPLAY' && persisted.requestDigest !== requestDigest
    )) {
      return this.rejected(request, actor, this.failure(request, SYSTEM_CONTROL_FAILURE_CODES.IDEMPOTENCY_KEY_CONFLICT, 'Idempotency-Key was already used for different control intent.'));
    }
    if (persisted.kind === 'REVISION_CONFLICT') {
      return this.rejected(request, actor, this.failure(
        request,
        SYSTEM_CONTROL_FAILURE_CODES.STALE_COMMAND_REVISION,
        `Control revision changed durably; current revision is ${persisted.current.revision}.`,
      ));
    }
    if (persisted.kind === 'IDEMPOTENT_REPLAY') {
      if (requiresRuntimePublication(request.mutation)
        && persisted.receipt.applied
        && persisted.runtimePublication !== 'PUBLISHED') {
        return this.publishPendingRuntimeEffect(request, actor, persisted.receipt, requestDigest, false);
      }
      return ok(persisted.receipt);
    }

    this.stateValue = freezeState(persisted.receipt.after);
    if (requiresRuntimePublication(request.mutation)
      && persisted.receipt.applied
      && persisted.runtimePublication !== 'PUBLISHED') {
      return this.publishPendingRuntimeEffect(request, actor, persisted.receipt, requestDigest, true);
    }
    try {
      await this.composition.publishCommitted(request, actor, persisted.receipt);
    } catch {
      // Persistence is authoritative. A failed notification cannot turn a
      // committed mutation into a retry that would duplicate its ledger row.
    }
    return ok(persisted.receipt);
  }
}
