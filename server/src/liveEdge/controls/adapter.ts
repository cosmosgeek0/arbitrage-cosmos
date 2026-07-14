import {
  createStructuredFailure,
  deriveCorrelationId,
  fail,
  isValidUtcMillis,
  isStructuredFailure,
  ok,
  type ControlCommand,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import {
  buildControlEvent,
  calculatePreviewDigest,
  confirmControlEventAppend,
  controlPreviewSeedDigest,
  deepFreeze,
  durableActionDigest,
  operatorActorBinding,
  prepareControlEventAppend,
} from './integrity.js';
import {
  DURABLE_CONTROL_PREVIEW_SCHEMA,
  type AuthenticatedOperatorIdentity,
  type CanonicalOwnerApplication,
  type ControlCommandLookup,
  type ControlCommandReceipt,
  type ControlPlaneSnapshot,
  type ControlPreviewRequest,
  type ControlPreviewResult,
  type ControlReasonCode,
  type ControlSubmissionResult,
  type DurableControlAction,
  type DurableControlAdapterDependencies,
  type DurableControlPreview,
  type PreviewRiskWitnessV1,
} from './types.js';
import {
  isCommandId,
  isRiskCheckedAction,
  isWaitingL08Action,
  validateControlPlaneSnapshot,
  validateExchangeTruth,
  validateLookup,
  validateOperatorIdentity,
  validateOwnerApplication,
  validateOwnerInspection,
  validatePreviewRequest,
  validateRiskDecision,
  validateRiskWitness,
  validateSubmissionRequest,
} from './validation.js';
import { compareJournalQuantities } from '../adapters/durableMutationJournal/exact.js';

const MAXIMUM_COMMAND_ID_SEED_BYTES = 8_192;

function reasonMessage(code: ControlReasonCode): string {
  const messages: Readonly<Record<ControlReasonCode, string>> = Object.freeze({
    CONTROL_APPLIED: 'The control was applied by its canonical owner.',
    CONTROL_NOOP: 'The canonical owner accepted the control as an idempotent no-op.',
    AWARENESS_RECORDED: 'Operator awareness was recorded without changing recovery state.',
    INVALID_CONTROL_REQUEST: 'The control request is invalid.',
    STRICT_SCHEMA_VIOLATION: 'The control request does not match its exact bounded schema.',
    SENSITIVE_MATERIAL_REJECTED: 'Sensitive-looking material is forbidden in control requests.',
    AUTHENTICATED_OPERATOR_REQUIRED: 'An authenticated operator is required.',
    OPERATOR_IDENTITY_INVALID: 'The injected operator identity is invalid or expired.',
    OPERATOR_MISMATCH: 'The final command operator does not match the preview operator.',
    PREVIEW_AUTHORITY_UNAVAILABLE: 'The server preview authority is unavailable.',
    PREVIEW_AUTHORITY_INVALID: 'The server preview authority returned an invalid result.',
    PREVIEW_DIGEST_MISMATCH: 'The final command does not match the server-generated preview digest.',
    PREVIEW_AUTHENTICATION_FAILED: 'The server preview authorization tag is invalid.',
    COMMAND_EXPIRED: 'The command expired before canonical application.',
    STALE_CONFIG_VERSION: 'The expected configuration version is stale.',
    STALE_CONTROL_REVISION: 'The expected control revision is stale.',
    IDEMPOTENCY_CONFLICT: 'The command ID was reused with different intent or operator identity.',
    COMMAND_IN_PROGRESS: 'The exact command is already durably pending.',
    PERSISTENCE_UNAVAILABLE: 'Canonical control persistence is unavailable.',
    PERSISTENCE_ACK_INVALID: 'Canonical persistence returned an invalid acknowledgement.',
    COMMAND_OUTCOME_UNCERTAIN: 'The owner outcome could not be durably finalized.',
    OWNER_SNAPSHOT_UNAVAILABLE: 'The canonical control snapshot is unavailable.',
    OWNER_SNAPSHOT_INVALID: 'The canonical control snapshot is invalid or stale.',
    OWNER_REJECTED: 'The canonical owner rejected the control.',
    OWNER_CONTRACT_INVALID: 'The canonical owner returned an invalid control result.',
    COMMAND_NOT_APPLICABLE: 'The control is not applicable in the current owner state.',
    KILL_SWITCH_ENGAGED: 'The halt posture blocks this risk-increasing control.',
    RECOVERY_REQUIRED: 'Recovery proof blocks this control.',
    RECOVERY_STATE_UNKNOWN: 'Recovery state is unknown and fails closed.',
    EXCHANGE_TRUTH_UNAVAILABLE: 'Current exchange truth is unavailable.',
    EXCHANGE_TRUTH_STALE: 'Current exchange truth is stale.',
    EXCHANGE_TRUTH_INCOMPLETE: 'Current exchange truth is incomplete.',
    EXCHANGE_TRUTH_MISMATCH: 'Exchange truth does not match the declared control target.',
    RISK_OWNER_UNAVAILABLE: 'The canonical risk owner is unavailable.',
    RISK_OWNER_CONTRACT_INVALID: 'The canonical risk owner returned an invalid result.',
    RISK_INCREASE_FORBIDDEN: 'The command would increase the predeclared risk measure.',
    WAITING_L08: 'The command requires an L08 owner type that is not accepted at this base.',
    CONFIGURATION_OWNER_NOT_WIRED: 'The bounded configuration owner is not wired at this base.',
    APPROVAL_OWNER_NOT_WIRED: 'The approval owner is not wired at this base.',
    LIVE_EXECUTION_NOT_IMPLEMENTED: 'Live execution remains mechanically unavailable.',
  });
  return messages[code];
}

function assertDependencies(deps: DurableControlAdapterDependencies): void {
  const required: ReadonlyArray<readonly [string, unknown]> = [
    ['clock.nowMs', deps?.clock?.nowMs],
    ['identity.resolve', deps?.identity?.resolve],
    ['previewAuthority.mintCommandId', deps?.previewAuthority?.mintCommandId],
    ['previewAuthority.seal', deps?.previewAuthority?.seal],
    ['previewAuthority.verify', deps?.previewAuthority?.verify],
    ['state.read', deps?.state?.read],
    ['exchangeTruth.read', deps?.exchangeTruth?.read],
    ['risk.preview', deps?.risk?.preview],
    ['risk.recheck', deps?.risk?.recheck],
    ['persistence.lookup', deps?.persistence?.lookup],
    ['persistence.append', deps?.persistence?.append],
    ['owner.inspect', deps?.owner?.inspect],
    ['owner.publishCommitted', deps?.owner?.publishCommitted],
    ['foundation.issue', deps?.foundation?.issue],
  ];
  for (const [name, value] of required) {
    if (typeof value !== 'function') throw new TypeError(`DurableControlCommandAdapter requires ${name}().`);
  }
}

function riskBoundFor(action: Readonly<DurableControlAction>): DurableControlAction extends infer Action
  ? Action extends { readonly riskBound: infer Bound } ? Bound : never
  : never {
  if (!('riskBound' in action)) throw new TypeError('riskBoundFor requires a risk-checked action');
  return action.riskBound as never;
}

function lifecycleCommand(
  action: Readonly<DurableControlAction>,
  snapshot: Readonly<ControlPlaneSnapshot>,
): ControlCommand | null {
  if (action.type === 'SAFE_RESTART_COMPONENT' && action.component.id === 'control-plane-runtime') return 'RESTART';
  if (action.type !== 'SET_COMPONENT_DESIRED_STATE' || action.component.id !== 'control-plane-runtime') return null;
  if (action.desiredState === 'STOPPED') return 'STOP';
  if (action.desiredState === 'PAUSED') return 'PAUSE';
  return snapshot.foundationRuntime.desiredState === 'PAUSED' || snapshot.foundationRuntime.phase === 'PAUSED'
    ? 'RESUME'
    : 'START';
}

function riskIncreasingByNature(action: Readonly<DurableControlAction>): boolean {
  return ['RESUME_INTAKE', 'UPDATE_BOUNDED_CONFIGURATION', 'APPROVE', 'ARM', 'REARM'].includes(action.type);
}

function recoveryBlocked(action: Readonly<DurableControlAction>, snapshot: Readonly<ControlPlaneSnapshot>): ControlReasonCode | null {
  const safeDuringRecovery = ['HALT', 'PAUSE_INTAKE', 'DISARM', 'REVOKE', 'RECONCILE', 'CANCEL', 'CLOSE', 'REDUCE', 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN', 'REPAY_LIABILITY', 'ACKNOWLEDGE_RECOVERY'].includes(action.type);
  if (snapshot.recoveryState === 'UNKNOWN') return safeDuringRecovery ? null : 'RECOVERY_STATE_UNKNOWN';
  if (snapshot.recoveryState !== 'RECOVERY_REQUIRED' && snapshot.recoveryState !== 'RECONCILING') return null;
  if (safeDuringRecovery) {
    return null;
  }
  return 'RECOVERY_REQUIRED';
}

function mapFoundationControlFailure(failure: Readonly<StructuredFailure>): ControlReasonCode {
  switch (failure.code) {
    case 'STALE_COMMAND_REVISION':
      return 'STALE_CONTROL_REVISION';
    case 'COMMAND_REVISION_REUSED':
      return 'IDEMPOTENCY_CONFLICT';
    case 'COMMAND_IN_PROGRESS':
      return 'COMMAND_IN_PROGRESS';
    case 'COMMAND_NOT_APPLICABLE':
      return 'COMMAND_NOT_APPLICABLE';
    default:
      return 'OWNER_REJECTED';
  }
}

export class DurableControlCommandAdapter {
  private readonly deps: DurableControlAdapterDependencies;

  constructor(deps: DurableControlAdapterDependencies) {
    assertDependencies(deps);
    this.deps = deps;
  }

  async preview(input: unknown): Promise<ControlPreviewResult> {
    const nowMs = this.now();
    const request = validatePreviewRequest(input);
    if (!request.ok) return fail(this.failure(request.code, nowMs));
    const identity = await this.resolveIdentity(nowMs);
    if (!identity.ok) return identity;
    const snapshot = await this.readSnapshot(nowMs);
    if (!snapshot.ok) return snapshot;
    if (snapshot.value.configVersion !== request.value.expectedConfigVersion) {
      return fail(this.failure('STALE_CONFIG_VERSION', nowMs));
    }
    const expiresAtMs = nowMs + request.value.ttlMs;
    if (!isValidUtcMillis(expiresAtMs) || expiresAtMs > identity.value.expiresAtMs) {
      return fail(this.failure('OPERATOR_IDENTITY_INVALID', nowMs));
    }

    let riskWitness: Readonly<PreviewRiskWitnessV1> | null = null;
    if (isRiskCheckedAction(request.value.action)) {
      const truth = await this.readExchangeTruth(request.value.action, nowMs);
      if (!truth.ok) return truth;
      let proposed: unknown;
      try {
        proposed = await this.deps.risk.preview(request.value.action, truth.value, nowMs);
      } catch {
        return fail(this.failure('RISK_OWNER_UNAVAILABLE', nowMs));
      }
      const checked = validateRiskWitness(proposed);
      const bound = riskBoundFor(request.value.action) as Readonly<{ measure: { revision: string }; maximumPostActionValue: string }>;
      if (!checked.ok
        || checked.value.truthRevision !== truth.value.truthRevision
        || checked.value.measureRevision !== bound.measure.revision
        || checked.value.currentValue !== truth.value.riskMeasure.value
        || checked.value.maximumPostActionValue !== bound.maximumPostActionValue) {
        return fail(this.failure('RISK_OWNER_CONTRACT_INVALID', nowMs));
      }
      riskWitness = checked.value;
    }

    const actorBinding = operatorActorBinding(identity.value);
    const actionDigest = durableActionDigest(request.value.action);
    const seedDigest = controlPreviewSeedDigest({
      actionDigest,
      expectedConfigVersion: request.value.expectedConfigVersion,
      expectedControlRevision: snapshot.value.controlRevision,
      actorBinding,
      reason: request.value.reason,
      generatedAtMs: nowMs,
      expiresAtMs,
      riskWitness,
    });
    if (Buffer.byteLength(seedDigest, 'utf8') > MAXIMUM_COMMAND_ID_SEED_BYTES) {
      return fail(this.failure('INVALID_CONTROL_REQUEST', nowMs));
    }
    let commandId: string;
    try {
      commandId = await this.deps.previewAuthority.mintCommandId(seedDigest);
    } catch {
      return fail(this.failure('PREVIEW_AUTHORITY_UNAVAILABLE', nowMs));
    }
    if (!isCommandId(commandId)) return fail(this.failure('PREVIEW_AUTHORITY_INVALID', nowMs));
    const unsigned = deepFreeze({
      schema: DURABLE_CONTROL_PREVIEW_SCHEMA,
      version: 1 as const,
      commandId,
      action: request.value.action,
      actionDigest,
      expectedConfigVersion: request.value.expectedConfigVersion,
      expectedControlRevision: snapshot.value.controlRevision,
      actorBinding,
      reason: request.value.reason,
      generatedAtMs: nowMs,
      expiresAtMs,
      riskWitness,
      externalActionAuthorization: 'NONE' as const,
    });
    const previewDigest = calculatePreviewDigest(unsigned);
    let authorizationTag: string;
    try {
      authorizationTag = await this.deps.previewAuthority.seal(previewDigest, actorBinding);
    } catch {
      return fail(this.failure('PREVIEW_AUTHORITY_UNAVAILABLE', nowMs, commandId));
    }
    const preview = deepFreeze({ ...unsigned, previewDigest, authorizationTag });
    const verified = validateSubmissionRequest({
      schema: 'LIVE_EDGE_DURABLE_CONTROL_V1',
      version: 1,
      preview,
    });
    if (!verified.ok) return fail(this.failure('PREVIEW_AUTHORITY_INVALID', nowMs, commandId));
    return ok(preview as Readonly<DurableControlPreview>);
  }

  async submit(input: unknown): Promise<ControlSubmissionResult> {
    const initialNow = this.now();
    const request = validateSubmissionRequest(input);
    if (!request.ok) return fail(this.failure(request.code, initialNow));
    const preview = request.value.preview;
    const identity = await this.resolveIdentity(initialNow, preview.commandId);
    if (!identity.ok) return identity;
    const actorBinding = operatorActorBinding(identity.value);
    const { previewDigest: suppliedDigest, authorizationTag, ...unsigned } = preview;
    const recalculatedDigest = calculatePreviewDigest(unsigned);
    if (recalculatedDigest !== suppliedDigest || durableActionDigest(preview.action) !== preview.actionDigest) {
      await this.auditRejection(preview, 'PREVIEW_DIGEST_MISMATCH', null, initialNow, actorBinding);
      return fail(this.failure('PREVIEW_DIGEST_MISMATCH', initialNow, preview.commandId));
    }
    let authorized: boolean;
    try {
      authorized = await this.deps.previewAuthority.verify(suppliedDigest, preview.actorBinding, authorizationTag);
    } catch {
      return fail(this.failure('PREVIEW_AUTHORITY_UNAVAILABLE', initialNow, preview.commandId));
    }
    if (authorized !== true) {
      await this.auditRejection(preview, 'PREVIEW_AUTHENTICATION_FAILED', null, initialNow, actorBinding);
      return fail(this.failure('PREVIEW_AUTHENTICATION_FAILED', initialNow, preview.commandId));
    }
    if (actorBinding !== preview.actorBinding) {
      await this.auditRejection(preview, 'OPERATOR_MISMATCH', null, initialNow, actorBinding);
      return fail(this.failure('OPERATOR_MISMATCH', initialNow, preview.commandId));
    }

    const lookup = await this.lookup(preview.commandId, initialNow);
    if (!lookup.ok) return lookup;
    const replay = this.replayResult(lookup.value, preview, initialNow);
    if (replay !== null) return replay;
    if (initialNow >= preview.expiresAtMs) {
      await this.auditRejection(preview, 'COMMAND_EXPIRED', lookup.value, initialNow);
      return fail(this.failure('COMMAND_EXPIRED', initialNow, preview.commandId));
    }

    const snapshot = await this.readSnapshot(this.now(), preview.commandId);
    if (!snapshot.ok) return snapshot;
    if (snapshot.value.configVersion !== preview.expectedConfigVersion) {
      await this.auditRejection(preview, 'STALE_CONFIG_VERSION', lookup.value, this.now());
      return fail(this.failure('STALE_CONFIG_VERSION', this.now(), preview.commandId));
    }
    if (snapshot.value.controlRevision !== preview.expectedControlRevision) {
      await this.auditRejection(preview, 'STALE_CONTROL_REVISION', lookup.value, this.now());
      return fail(this.failure('STALE_CONTROL_REVISION', this.now(), preview.commandId));
    }
    const blocked = recoveryBlocked(preview.action, snapshot.value);
    if (blocked !== null) {
      await this.auditRejection(preview, blocked, lookup.value, this.now());
      return fail(this.failure(blocked, this.now(), preview.commandId));
    }
    if (snapshot.value.halted && riskIncreasingByNature(preview.action)) {
      await this.auditRejection(preview, 'KILL_SWITCH_ENGAGED', lookup.value, this.now());
      return fail(this.failure('KILL_SWITCH_ENGAGED', this.now(), preview.commandId));
    }
    if (preview.action.type === 'RESUME_INTAKE' && snapshot.value.recoveryState !== 'CLEAR') {
      await this.auditRejection(preview, 'RECOVERY_REQUIRED', lookup.value, this.now());
      return fail(this.failure('RECOVERY_REQUIRED', this.now(), preview.commandId));
    }
    if (preview.action.type === 'ACKNOWLEDGE_RECOVERY'
      && snapshot.value.recoveryState !== 'RECOVERY_REQUIRED'
      && snapshot.value.recoveryState !== 'RECONCILING') {
      await this.auditRejection(preview, 'COMMAND_NOT_APPLICABLE', lookup.value, this.now());
      return fail(this.failure('COMMAND_NOT_APPLICABLE', this.now(), preview.commandId));
    }

    if (isRiskCheckedAction(preview.action)) {
      const risk = await this.recheckRisk(preview, this.now());
      if (!risk.ok) {
        await this.auditRejection(preview, risk.failure.code as ControlReasonCode, lookup.value, this.now());
        return risk;
      }
    }
    // Concrete order/recovery/repayment policy types do not exist at accepted
    // L06. They are validated opaque handles but never dispatched here.
    if (isWaitingL08Action(preview.action)) {
      await this.auditRejection(preview, 'WAITING_L08', lookup.value, this.now());
      return fail(this.failure('WAITING_L08', this.now(), preview.commandId));
    }

    let inspectionRaw: unknown;
    try {
      inspectionRaw = await this.deps.owner.inspect(preview.action, snapshot.value);
    } catch {
      await this.auditRejection(preview, 'OWNER_REJECTED', lookup.value, this.now());
      return fail(this.failure('OWNER_REJECTED', this.now(), preview.commandId));
    }
    const inspection = validateOwnerInspection(inspectionRaw);
    if (!inspection.ok) {
      await this.auditRejection(preview, 'OWNER_CONTRACT_INVALID', lookup.value, this.now());
      return fail(this.failure('OWNER_CONTRACT_INVALID', this.now(), preview.commandId));
    }
    if (!inspection.value.accepted) {
      await this.auditRejection(preview, inspection.value.reasonCode, lookup.value, this.now());
      return fail(this.failure(inspection.value.reasonCode, this.now(), preview.commandId));
    }
    if (inspection.value.riskIncreasing && snapshot.value.halted) {
      await this.auditRejection(preview, 'KILL_SWITCH_ENGAGED', lookup.value, this.now());
      return fail(this.failure('KILL_SWITCH_ENGAGED', this.now(), preview.commandId));
    }

    const beforeCommitNow = this.now();
    if (beforeCommitNow >= preview.expiresAtMs) {
      await this.auditRejection(preview, 'COMMAND_EXPIRED', lookup.value, beforeCommitNow);
      return fail(this.failure('COMMAND_EXPIRED', beforeCommitNow, preview.commandId));
    }
    const intent = buildControlEvent({
      schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
      version: 1,
      kind: 'CONTROL_INTENT_COMMITTED',
      commandId: preview.commandId,
      previewDigest: preview.previewDigest,
      actionType: preview.action.type,
      actorBinding: preview.actorBinding,
      expectedConfigVersion: preview.expectedConfigVersion,
      expectedControlRevision: preview.expectedControlRevision,
      occurredAtMs: beforeCommitNow,
      action: preview.action,
      expiresAtMs: preview.expiresAtMs,
      decisionCode: inspection.value.reasonCode,
      riskWitness: preview.riskWitness,
      externalActionAuthorization: 'NONE',
    });
    const intentRequest = prepareControlEventAppend(intent, lookup.value.journalVersion, lookup.value.headDigest);
    let intentAckRaw: unknown;
    try {
      intentAckRaw = await this.deps.persistence.append(intentRequest);
    } catch {
      return fail(this.failure('PERSISTENCE_UNAVAILABLE', this.now(), preview.commandId));
    }
    const intentAck = confirmControlEventAppend(intentRequest, intentAckRaw);
    if (!intentAck.ok) return fail(this.failure(intentAck.reasonCode, this.now(), preview.commandId));
    if (intentAck.replayed) return fail(this.failure('COMMAND_IN_PROGRESS', this.now(), preview.commandId));
    if (intentAck.currentConfigVersion !== preview.expectedConfigVersion) {
      return fail(this.failure('STALE_CONFIG_VERSION', this.now(), preview.commandId));
    }
    const committedControlRevision = preview.expectedControlRevision + 1;
    if (intentAck.currentControlRevision !== committedControlRevision) {
      return fail(this.failure('STALE_CONTROL_REVISION', this.now(), preview.commandId));
    }

    const applicationNow = this.now();
    if (applicationNow >= preview.expiresAtMs || intentAck.committedAtMs >= preview.expiresAtMs) {
      const finalized = await this.finalizeRejected(preview, 'COMMAND_EXPIRED', intentAck, applicationNow);
      if (!finalized) return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', applicationNow, preview.commandId));
      return fail(this.failure('COMMAND_EXPIRED', applicationNow, preview.commandId));
    }
    const committedSnapshot = await this.readSnapshot(applicationNow, preview.commandId);
    if (!committedSnapshot.ok) {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', this.now(), preview.commandId));
    }
    if (committedSnapshot.value.configVersion !== preview.expectedConfigVersion) {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', this.now(), preview.commandId));
    }
    if (committedSnapshot.value.controlRevision !== committedControlRevision) {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', this.now(), preview.commandId));
    }
    const application = await this.publish(
      preview,
      committedSnapshot.value,
      intentAck.committedAtMs,
      applicationNow,
      committedControlRevision,
    );
    if (!application.ok) {
      if (application.failure.code === 'COMMAND_OUTCOME_UNCERTAIN') return application;
      const finalized = await this.finalizeRejected(
        preview,
        application.failure.code as ControlReasonCode,
        intentAck,
        this.now(),
      );
      if (!finalized) return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', this.now(), preview.commandId));
      return application;
    }

    // The owner call may have crossed the deadline even when its returned
    // evaluation fields claim an earlier instant. Once publication was
    // attempted, expiry is an ambiguous outcome: keep the durable intent
    // pending for canonical reconciliation rather than recording success or a
    // terminal rejection.
    const afterApplicationNow = this.now();
    if (afterApplicationNow >= preview.expiresAtMs) {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', afterApplicationNow, preview.commandId));
    }

    const outcomeNow = this.now();
    const awareness = preview.action.type === 'ACKNOWLEDGE_RECOVERY';
    const outcome = awareness
      ? buildControlEvent({
          schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
          version: 1,
          kind: 'CONTROL_AWARENESS_RECORDED',
          commandId: preview.commandId,
          previewDigest: preview.previewDigest,
          actionType: preview.action.type,
          actorBinding: preview.actorBinding,
          expectedConfigVersion: preview.expectedConfigVersion,
          expectedControlRevision: preview.expectedControlRevision,
          occurredAtMs: outcomeNow,
          recoveryRevision: preview.action.observedRecoveryRevision,
          awarenessOnly: true,
          recoveryStateChanged: false,
          reasonCode: 'AWARENESS_RECORDED',
          externalActionAuthorization: 'NONE',
        })
      : buildControlEvent({
          schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
          version: 1,
          kind: 'CONTROL_APPLIED',
          commandId: preview.commandId,
          previewDigest: preview.previewDigest,
          actionType: preview.action.type,
          actorBinding: preview.actorBinding,
          expectedConfigVersion: preview.expectedConfigVersion,
          expectedControlRevision: preview.expectedControlRevision,
          occurredAtMs: outcomeNow,
          applied: application.value.applied,
          reasonCode: application.value.applied ? 'CONTROL_APPLIED' : 'CONTROL_NOOP',
          recoveryStateChanged: false,
          externalActionAuthorization: 'NONE',
        });
    const outcomeRequest = prepareControlEventAppend(
      outcome,
      intentAck.committedJournalVersion,
      intentAck.committedHeadDigest,
    );
    let outcomeAckRaw: unknown;
    try {
      outcomeAckRaw = await this.deps.persistence.append(outcomeRequest);
    } catch {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', outcomeNow, preview.commandId));
    }
    const outcomeAck = confirmControlEventAppend(outcomeRequest, outcomeAckRaw);
    if (!outcomeAck.ok) return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', outcomeNow, preview.commandId));
    const disposition = awareness ? 'AWARENESS_RECORDED' : application.value.applied ? 'APPLIED' : 'NOOP';
    const receipt = deepFreeze({
      schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1' as const,
      version: 1 as const,
      commandId: preview.commandId,
      previewDigest: preview.previewDigest,
      actionType: preview.action.type,
      disposition,
      reasonCode: awareness ? 'AWARENESS_RECORDED' as const : application.value.applied ? 'CONTROL_APPLIED' as const : 'CONTROL_NOOP' as const,
      actorBinding: preview.actorBinding,
      expectedConfigVersion: preview.expectedConfigVersion,
      committedControlRevision,
      applied: awareness ? false : application.value.applied,
      recordedAtMs: outcomeAck.committedAtMs,
      ledgerEventIds: [intentAck.ledgerEventId, outcomeAck.ledgerEventId] as const,
      recoveryStateChanged: false as const,
      externalActionAuthorization: 'NONE' as const,
    });
    return ok(receipt as Readonly<ControlCommandReceipt>);
  }

  private now(): number {
    const value = this.deps.clock.nowMs();
    if (!isValidUtcMillis(value)) throw new TypeError('Injected control clock returned invalid UTC milliseconds.');
    return value;
  }

  private failure(code: ControlReasonCode, nowMs: number, commandId?: string): Readonly<StructuredFailure> {
    const correlationId = deriveCorrelationId({ origin: 'l14-control', key: commandId ?? code });
    return createStructuredFailure({
      component: 'liveEdge.controls',
      stage: 'durable-control-command',
      code,
      message: reasonMessage(code),
      occurredAt: nowMs,
      retryable: ['PERSISTENCE_UNAVAILABLE', 'OWNER_SNAPSHOT_UNAVAILABLE', 'RISK_OWNER_UNAVAILABLE', 'COMMAND_IN_PROGRESS'].includes(code),
      safeCurrentState: 'UNCHANGED',
      recommendedOperatorAction: code === 'WAITING_L08'
        ? 'Wait for the accepted L08 owner contract; do not invent an order or recovery policy.'
        : 'Inspect canonical control truth and retry only with a new server preview when appropriate.',
      correlationId,
    });
  }

  private async resolveIdentity(
    nowMs: number,
    commandId?: string,
  ): Promise<{ readonly ok: true; readonly value: Readonly<AuthenticatedOperatorIdentity> } | { readonly ok: false; readonly failure: StructuredFailure }> {
    let raw: unknown;
    try {
      raw = await this.deps.identity.resolve();
    } catch {
      return fail(this.failure('AUTHENTICATED_OPERATOR_REQUIRED', nowMs, commandId));
    }
    if (raw === null) return fail(this.failure('AUTHENTICATED_OPERATOR_REQUIRED', nowMs, commandId));
    const checked = validateOperatorIdentity(raw, nowMs);
    return checked.ok ? ok(checked.value) : fail(this.failure(checked.code, nowMs, commandId));
  }

  private async readSnapshot(
    nowMs: number,
    commandId?: string,
  ): Promise<{ readonly ok: true; readonly value: Readonly<ControlPlaneSnapshot> } | { readonly ok: false; readonly failure: StructuredFailure }> {
    let raw: unknown;
    try {
      raw = await this.deps.state.read();
    } catch {
      return fail(this.failure('OWNER_SNAPSHOT_UNAVAILABLE', nowMs, commandId));
    }
    const checked = validateControlPlaneSnapshot(raw, nowMs);
    return checked.ok ? ok(checked.value) : fail(this.failure(checked.code, nowMs, commandId));
  }

  private async readExchangeTruth(
    action: Readonly<DurableControlAction>,
    nowMs: number,
  ): Promise<{ readonly ok: true; readonly value: Awaited<ReturnType<DurableControlAdapterDependencies['exchangeTruth']['read']>> } | { readonly ok: false; readonly failure: StructuredFailure }> {
    let raw: unknown;
    try {
      raw = await this.deps.exchangeTruth.read(action);
    } catch {
      return fail(this.failure('EXCHANGE_TRUTH_UNAVAILABLE', nowMs));
    }
    const checked = validateExchangeTruth(raw, nowMs);
    return checked.ok ? ok(checked.value) : fail(this.failure(checked.code, nowMs));
  }

  private async lookup(
    commandId: string,
    nowMs: number,
  ): Promise<{ readonly ok: true; readonly value: Readonly<ControlCommandLookup> } | { readonly ok: false; readonly failure: StructuredFailure }> {
    let raw: unknown;
    try {
      raw = await this.deps.persistence.lookup(commandId);
    } catch {
      return fail(this.failure('PERSISTENCE_UNAVAILABLE', nowMs, commandId));
    }
    const checked = validateLookup(raw);
    return checked.ok ? ok(checked.value) : fail(this.failure(checked.code, nowMs, commandId));
  }

  private replayResult(
    lookup: Readonly<ControlCommandLookup>,
    preview: Readonly<DurableControlPreview>,
    nowMs: number,
  ): ControlSubmissionResult | null {
    if (lookup.kind === 'NOT_FOUND') return null;
    if (lookup.previewDigest !== preview.previewDigest || lookup.actorBinding !== preview.actorBinding) {
      return fail(this.failure('IDEMPOTENCY_CONFLICT', nowMs, preview.commandId));
    }
    if (lookup.kind === 'PENDING') return fail(this.failure('COMMAND_IN_PROGRESS', nowMs, preview.commandId));
    if (lookup.kind === 'REJECTED') {
      if (lookup.rejection.commandId !== preview.commandId
        || lookup.rejection.actionType !== preview.action.type
        || lookup.rejection.expectedConfigVersion !== preview.expectedConfigVersion
        || lookup.rejection.committedControlRevision !== preview.expectedControlRevision + 1
        || lookup.rejection.externalActionAuthorization !== 'NONE') {
        return fail(this.failure('PERSISTENCE_ACK_INVALID', nowMs, preview.commandId));
      }
      return fail(this.failure(lookup.rejection.reasonCode, nowMs, preview.commandId));
    }
    if (lookup.receipt.commandId !== preview.commandId
      || lookup.receipt.actionType !== preview.action.type
      || lookup.receipt.expectedConfigVersion !== preview.expectedConfigVersion
      || lookup.receipt.committedControlRevision !== preview.expectedControlRevision + 1
      || lookup.receipt.externalActionAuthorization !== 'NONE') {
      return fail(this.failure('PERSISTENCE_ACK_INVALID', nowMs, preview.commandId));
    }
    return ok(lookup.receipt);
  }

  private async recheckRisk(
    preview: Readonly<DurableControlPreview>,
    nowMs: number,
  ): Promise<{ readonly ok: true; readonly value: true } | { readonly ok: false; readonly failure: StructuredFailure }> {
    if (preview.riskWitness === null) return fail(this.failure('RISK_OWNER_CONTRACT_INVALID', nowMs, preview.commandId));
    const truth = await this.readExchangeTruth(preview.action, nowMs);
    if (!truth.ok) return truth;
    let raw: unknown;
    try {
      raw = await this.deps.risk.recheck(preview.action, preview.riskWitness, truth.value, nowMs);
    } catch {
      return fail(this.failure('RISK_OWNER_UNAVAILABLE', nowMs, preview.commandId));
    }
    const checked = validateRiskDecision(raw, nowMs);
    if (!checked.ok) return fail(this.failure(checked.code, nowMs, preview.commandId));
    const bound = riskBoundFor(preview.action) as Readonly<{
      measure: { id: string; revision: string; digest: string };
      maximumPostActionValue: string;
    }>;
    if (!checked.value.allowed) {
      return fail(this.failure(checked.value.reasonCode, nowMs, preview.commandId));
    }
    if (checked.value.measureRevision !== bound.measure.revision
      || truth.value.riskMeasure.definition.id !== bound.measure.id
      || truth.value.riskMeasure.definition.revision !== bound.measure.revision
      || truth.value.riskMeasure.definition.digest !== bound.measure.digest
      || compareJournalQuantities(checked.value.projectedPostActionValue, truth.value.riskMeasure.value) > 0
      || compareJournalQuantities(checked.value.projectedPostActionValue, bound.maximumPostActionValue) > 0) {
      return fail(this.failure('RISK_INCREASE_FORBIDDEN', nowMs, preview.commandId));
    }
    return ok(true);
  }

  private async publish(
    preview: Readonly<DurableControlPreview>,
    snapshot: Readonly<ControlPlaneSnapshot>,
    committedAtMs: number,
    nowMs: number,
    committedControlRevision: number,
  ): Promise<{ readonly ok: true; readonly value: Readonly<CanonicalOwnerApplication> } | { readonly ok: false; readonly failure: StructuredFailure }> {
    if (preview.action.type === 'ACKNOWLEDGE_RECOVERY') {
      return ok({
        accepted: true,
        applied: false,
        reasonCode: 'AWARENESS_RECORDED',
        evaluatedAtMs: nowMs,
        deadlineAtMs: preview.expiresAtMs,
        deadlineHonored: true,
        observedConfigVersion: preview.expectedConfigVersion,
        observedControlRevision: committedControlRevision,
      });
    }
    const foundationCommand = lifecycleCommand(preview.action, snapshot);
    if (foundationCommand !== null) {
      const issued = {
        command: foundationCommand,
        revision: snapshot.foundationRuntime.revision + 1,
        nowMs,
      } as const;
      let result: ReturnType<DurableControlAdapterDependencies['foundation']['issue']>;
      try {
        result = this.deps.foundation.issue(issued);
      } catch {
        return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', nowMs, preview.commandId));
      }
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
        return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', nowMs, preview.commandId));
      }
      if (!result.ok) {
        const reasonCode = isStructuredFailure(result.failure)
          ? mapFoundationControlFailure(result.failure)
          : 'OWNER_CONTRACT_INVALID';
        return fail(this.failure(reasonCode, nowMs, preview.commandId));
      }
      const receipt = result.value;
      if (!receipt || typeof receipt !== 'object'
        || receipt.command !== issued.command || receipt.revision !== issued.revision
        || typeof receipt.commandId !== 'string' || !/^cmd_[a-f0-9]{16}$/.test(receipt.commandId)
        || typeof receipt.correlationId !== 'string' || !/^cor_[a-f0-9]{16}$/.test(receipt.correlationId)
        || typeof receipt.applied !== 'boolean' || typeof receipt.detail !== 'string'
        || receipt.detail.length < 1 || receipt.detail.length > 500) {
        return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', nowMs, preview.commandId));
      }
      return ok({
        accepted: true,
        applied: receipt.applied,
        reasonCode: receipt.applied ? 'CONTROL_APPLIED' : 'CONTROL_NOOP',
        evaluatedAtMs: nowMs,
        deadlineAtMs: preview.expiresAtMs,
        deadlineHonored: true,
        observedConfigVersion: preview.expectedConfigVersion,
        observedControlRevision: committedControlRevision,
      });
    }
    let raw: unknown;
    try {
      raw = await this.deps.owner.publishCommitted(preview.action, {
        commandId: preview.commandId,
        previewDigest: preview.previewDigest,
        actorBinding: preview.actorBinding,
        committedAtMs,
        invokedAtMs: nowMs,
        expiresAtMs: preview.expiresAtMs,
        expectedConfigVersion: preview.expectedConfigVersion,
        committedControlRevision,
      });
    } catch {
      return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', nowMs, preview.commandId));
    }
    const checked = validateOwnerApplication(raw);
    if (!checked.ok) return fail(this.failure('COMMAND_OUTCOME_UNCERTAIN', nowMs, preview.commandId));
    if (!checked.value.accepted) return fail(this.failure(checked.value.reasonCode, nowMs, preview.commandId));
    if (checked.value.deadlineAtMs !== preview.expiresAtMs
      || checked.value.observedConfigVersion !== preview.expectedConfigVersion
      || checked.value.observedControlRevision !== committedControlRevision) {
      return fail(this.failure('OWNER_CONTRACT_INVALID', nowMs, preview.commandId));
    }
    return ok(checked.value);
  }

  private async auditRejection(
    preview: Readonly<DurableControlPreview>,
    reasonCode: ControlReasonCode,
    lookup: Readonly<ControlCommandLookup> | null,
    occurredAtMs: number,
    actorBindingOverride?: string,
  ): Promise<void> {
    if (lookup !== null && lookup.kind !== 'NOT_FOUND') return;
    const event = buildControlEvent({
      schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
      version: 1,
      kind: 'CONTROL_REJECTED',
      commandId: preview.commandId,
      previewDigest: preview.previewDigest,
      actionType: preview.action.type,
      actorBinding: actorBindingOverride ?? preview.actorBinding,
      expectedConfigVersion: preview.expectedConfigVersion,
      expectedControlRevision: preview.expectedControlRevision,
      occurredAtMs,
      reasonCode,
      redacted: true,
      intentCommitted: false,
      recoveryStateChanged: false,
      externalActionAuthorization: 'NONE',
    });
    const request = prepareControlEventAppend(event, 0, null);
    try {
      const ack = await this.deps.persistence.append(request);
      confirmControlEventAppend(request, ack);
    } catch {
      // Rejection remains fail-closed. Canonical supervisor health must expose
      // the separately blocked persistence integration; no raw fallback log.
    }
  }

  private async finalizeRejected(
    preview: Readonly<DurableControlPreview>,
    reasonCode: ControlReasonCode,
    intent: Readonly<{
      committedJournalVersion: number;
      committedHeadDigest: string;
    }>,
    occurredAtMs: number,
  ): Promise<boolean> {
    const event = buildControlEvent({
      schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
      version: 1,
      kind: 'CONTROL_REJECTED',
      commandId: preview.commandId,
      previewDigest: preview.previewDigest,
      actionType: preview.action.type,
      actorBinding: preview.actorBinding,
      expectedConfigVersion: preview.expectedConfigVersion,
      expectedControlRevision: preview.expectedControlRevision,
      occurredAtMs,
      reasonCode,
      redacted: true,
      intentCommitted: true,
      recoveryStateChanged: false,
      externalActionAuthorization: 'NONE',
    });
    const request = prepareControlEventAppend(event, intent.committedJournalVersion, intent.committedHeadDigest);
    try {
      const ack = await this.deps.persistence.append(request);
      return confirmControlEventAppend(request, ack).ok;
    } catch {
      // Persisted intent already prevents duplicate owner publication.
      return false;
    }
  }
}
