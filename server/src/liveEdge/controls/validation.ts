import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  CONTROL_REASON_CODES,
  DURABLE_CONTROL_ACK_SCHEMA,
  DURABLE_CONTROL_ACTION_TYPES,
  DURABLE_CONTROL_EVENT_SCHEMA,
  DURABLE_CONTROL_PREVIEW_SCHEMA,
  DURABLE_CONTROL_SCHEMA,
  OPAQUE_OWNER_REFERENCE_SCHEMA,
  OPAQUE_REFERENCE_OWNERS,
  type AuthenticatedOperatorIdentity,
  type CanonicalOwnerApplication,
  type CanonicalOwnerInspection,
  type ControlCommandLookup,
  type ControlCommandRejectionReceipt,
  type ControlCommandReceipt,
  type ControlEventAppendAcknowledgement,
  type ControlPlaneSnapshot,
  type ControlPreviewRequest,
  type ControlReasonCode,
  type ControlSubmissionRequest,
  type DurableControlAction,
  type DurableControlPreview,
  type ExchangeTruthSnapshotV1,
  type OpaqueOwnerReferenceV1,
  type PreviewRiskWitnessV1,
  type RiskBoundDeclarationV1,
  type RiskOwnerDecision,
  type WaitingL08ReferenceV1,
} from './types.js';

export const CONTROL_LIMITS = Object.freeze({
  maximumReasonLength: 240,
  minimumTtlMs: 1_000,
  maximumTtlMs: 60_000,
  maximumIdentityLength: 160,
  maximumReferenceLength: 128,
  maximumRevisionLength: 128,
  maximumGateOrSourceLength: 96,
  maximumSnapshotAgeMs: 5_000,
  minimumTimeoutMs: 100,
  maximumTimeoutMs: 300_000,
} as const);

export type RuntimeValidation<T> =
  | { readonly ok: true; readonly value: Readonly<T> }
  | { readonly ok: false; readonly code: ControlReasonCode; readonly message: string };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHORT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const COMMAND_ID = /^cmd_[a-f0-9]{16,64}$/;
const EVENT_ID = /^l14evt_[a-f0-9]{64}$/;
const ACTOR_BINDING = /^l14actor_[a-f0-9]{64}$/;
const AUTHORIZATION_TAG = /^l14tag_[A-Za-z0-9_-]{16,256}$/;
const HEAD_DIGEST = /^l14head_[a-f0-9]{64}$/;
const EXACT_NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,16})?$/;
const SENSITIVE_MATERIAL = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;
const REMOTE_OR_SHELL = /(?:[a-z][a-z0-9+.-]*:\/\/|\.\.[/\\]|^[/\\]|\$\(|`|&&|\|\||[<>]\s*[/\\])/i;

function invalid<T>(message: string, code: ControlReasonCode = 'STRICT_SCHEMA_VIOLATION'): RuntimeValidation<T> {
  return Object.freeze({ ok: false as const, code, message });
}

function success<T>(value: T): RuntimeValidation<T> {
  return Object.freeze({ ok: true as const, value: value as Readonly<T> });
}

/**
 * Copies one closed plain record without invoking accessors. Proxies and
 * inherited/symbol/accessor fields fail before canonicalization.
 */
function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): RuntimeValidation<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return invalid(`${label} must be a closed plain record.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(`${label} must not use an inherited prototype.`);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return invalid(`${label} must not contain symbol fields.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const actual = Object.keys(descriptors);
    if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
      return invalid(`${label} has missing or unknown fields.`);
    }
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        return invalid(`${label}.${key} must be a data field.`);
      }
      copy[key] = descriptor.value;
    }
    return success(copy);
  } catch {
    return invalid(`${label} could not be inspected safely.`);
  }
}

function boundedIdentifier(value: unknown, maximum = CONTROL_LIMITS.maximumReferenceLength): value is string {
  return typeof value === 'string' && value.length <= maximum && IDENTIFIER.test(value);
}

function boundedRevision(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= CONTROL_LIMITS.maximumRevisionLength
    && IDENTIFIER.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function validExactDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 49 && EXACT_NON_NEGATIVE_DECIMAL.test(value);
}

function validateReference(
  value: unknown,
  requiredOwner?: OpaqueOwnerReferenceV1['owner'],
): RuntimeValidation<OpaqueOwnerReferenceV1> {
  const checked = closedRecord(value, ['schema', 'owner', 'id', 'revision', 'digest'], 'owner reference');
  if (!checked.ok) return checked;
  const record = checked.value;
  if (record.schema !== OPAQUE_OWNER_REFERENCE_SCHEMA
    || typeof record.owner !== 'string'
    || !(OPAQUE_REFERENCE_OWNERS as readonly string[]).includes(record.owner)
    || (requiredOwner !== undefined && record.owner !== requiredOwner)
    || !boundedIdentifier(record.id)
    || !boundedRevision(record.revision)
    || !validDigest(record.digest)) {
    return invalid('Owner reference is invalid or belongs to the wrong owner.');
  }
  return success(record as unknown as OpaqueOwnerReferenceV1);
}

function validateWaitingL08(value: unknown): RuntimeValidation<WaitingL08ReferenceV1> {
  const checked = closedRecord(value, ['schema', 'owner', 'id', 'revision', 'digest', 'validation'], 'WAITING-L08 reference');
  if (!checked.ok) return checked;
  const record = checked.value;
  if (record.schema !== OPAQUE_OWNER_REFERENCE_SCHEMA
    || record.owner !== 'L08_RECOVERY'
    || record.validation !== 'WAITING_L08'
    || !boundedIdentifier(record.id)
    || !boundedRevision(record.revision)
    || !validDigest(record.digest)) {
    return invalid('Dependency reference must be an exact versioned WAITING-L08 reference.');
  }
  return success(record as unknown as WaitingL08ReferenceV1);
}

function validateRiskBound(value: unknown): RuntimeValidation<RiskBoundDeclarationV1> {
  const checked = closedRecord(value, ['measure', 'maximumPostActionValue'], 'risk bound');
  if (!checked.ok) return checked as RuntimeValidation<RiskBoundDeclarationV1>;
  const measure = validateReference(checked.value.measure, 'FOUNDATION_RISK');
  if (!measure.ok || !validExactDecimal(checked.value.maximumPostActionValue)) {
    return invalid('Risk bound must contain one Foundation Risk reference and a bounded exact decimal.');
  }
  return success({
    measure: measure.value as RiskBoundDeclarationV1['measure'],
    maximumPostActionValue: checked.value.maximumPostActionValue,
  });
}

function actionRecord(value: unknown): RuntimeValidation<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('Action must be a closed record.');
    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      return invalid('Action must contain one data-field discriminant.');
    }
    if (!(DURABLE_CONTROL_ACTION_TYPES as readonly string[]).includes(descriptor.value)) {
      return invalid('Action discriminant is unsupported.');
    }
    return success({ type: descriptor.value });
  } catch {
    return invalid('Action could not be inspected safely.');
  }
}

export function validateDurableControlAction(value: unknown): RuntimeValidation<DurableControlAction> {
  const discriminant = actionRecord(value);
  if (!discriminant.ok) return discriminant as RuntimeValidation<DurableControlAction>;
  const type = discriminant.value.type as DurableControlAction['type'];
  switch (type) {
    case 'SET_COMPONENT_DESIRED_STATE': {
      const row = closedRecord(value, ['type', 'component', 'desiredState'], type);
      const component = row.ok ? validateReference(row.value.component, 'FOUNDATION_CONTROL') : row;
      if (!row.ok || !component.ok || !['STOPPED', 'RUNNING', 'PAUSED'].includes(String(row.value.desiredState))) {
        return invalid('Component desired-state command is invalid.');
      }
      return success({ type, component: component.value, desiredState: row.value.desiredState } as DurableControlAction);
    }
    case 'PAUSE_INTAKE': {
      const row = closedRecord(value, ['type', 'scope'], type);
      return row.ok && row.value.scope === 'NEW_RISK'
        ? success({ type, scope: 'NEW_RISK' })
        : invalid('Pause-intake scope must be NEW_RISK.');
    }
    case 'RESUME_INTAKE': {
      const row = closedRecord(value, ['type', 'scope', 'reconciliation'], type);
      const reconciliation = row.ok ? validateReference(row.value.reconciliation, 'FOUNDATION_RECONCILIATION') : row;
      if (!row.ok || row.value.scope !== 'NEW_RISK' || !reconciliation.ok) return invalid('Resume-intake command is invalid.');
      return success({ type, scope: 'NEW_RISK', reconciliation: reconciliation.value } as DurableControlAction);
    }
    case 'UPDATE_BOUNDED_CONFIGURATION': {
      const row = closedRecord(value, ['type', 'change'], type);
      if (!row.ok) return row as RuntimeValidation<DurableControlAction>;
      const changeType = (() => {
        try {
          return Object.getOwnPropertyDescriptor(row.value.change as object, 'setting')?.value;
        } catch {
          return null;
        }
      })();
      if (changeType === 'COMPONENT_STEP_TIMEOUT_MS') {
        const change = closedRecord(row.value.change, ['setting', 'component', 'valueMs'], 'configuration change');
        const component = change.ok ? validateReference(change.value.component, 'FOUNDATION_CONTROL') : change;
        if (change.ok && component.ok && Number.isSafeInteger(change.value.valueMs)
          && Number(change.value.valueMs) >= CONTROL_LIMITS.minimumTimeoutMs
          && Number(change.value.valueMs) <= CONTROL_LIMITS.maximumTimeoutMs) {
          return success({ type, change: { setting: changeType, component: component.value, valueMs: change.value.valueMs } } as DurableControlAction);
        }
      } else if (changeType === 'PREFLIGHT_GATE_TIMEOUT_MS' || changeType === 'SOURCE_STALE_AFTER_MS') {
        const idField = changeType === 'PREFLIGHT_GATE_TIMEOUT_MS' ? 'gateId' : 'sourceId';
        const change = closedRecord(row.value.change, ['setting', idField, 'valueMs'], 'configuration change');
        if (change.ok && typeof change.value[idField] === 'string'
          && change.value[idField].length <= CONTROL_LIMITS.maximumGateOrSourceLength
          && SHORT_IDENTIFIER.test(change.value[idField] as string)
          && Number.isSafeInteger(change.value.valueMs)
          && Number(change.value.valueMs) >= CONTROL_LIMITS.minimumTimeoutMs
          && Number(change.value.valueMs) <= CONTROL_LIMITS.maximumTimeoutMs) {
          return success({ type, change: change.value } as unknown as DurableControlAction);
        }
      }
      return invalid('Configuration update is outside the closed bounded setting schema.');
    }
    case 'APPROVE': {
      const row = closedRecord(value, ['type', 'proposal', 'approvalPolicy', 'mode'], type);
      const proposal = row.ok ? validateReference(row.value.proposal) : row;
      const policy = row.ok ? validateWaitingL08(row.value.approvalPolicy) : row;
      if (!row.ok || !proposal.ok || !policy.ok || row.value.mode !== 'VALIDATE_ONLY') return invalid('Approval command is invalid.');
      return success({ type, proposal: proposal.value, approvalPolicy: policy.value, mode: 'VALIDATE_ONLY' } as DurableControlAction);
    }
    case 'ARM': {
      const row = closedRecord(value, ['type', 'approval', 'armingPolicy', 'mode'], type);
      const approval = row.ok ? validateReference(row.value.approval, 'CAPITAL_APPROVALS') : row;
      const policy = row.ok ? validateWaitingL08(row.value.armingPolicy) : row;
      if (!row.ok || !approval.ok || !policy.ok || row.value.mode !== 'VALIDATE_ONLY') return invalid('Arm command is invalid.');
      return success({ type, approval: approval.value, armingPolicy: policy.value, mode: 'VALIDATE_ONLY' } as DurableControlAction);
    }
    case 'DISARM': {
      const row = closedRecord(value, ['type', 'arm', 'cause'], type);
      const arm = row.ok ? validateReference(row.value.arm, 'CAPITAL_APPROVALS') : row;
      if (!row.ok || !arm.ok || !['OPERATOR_REQUEST', 'SAFETY'].includes(String(row.value.cause))) return invalid('Disarm command is invalid.');
      return success({ type, arm: arm.value, cause: row.value.cause } as DurableControlAction);
    }
    case 'REARM': {
      const row = closedRecord(value, ['type', 'priorArm', 'approval', 'armingPolicy', 'mode'], type);
      const prior = row.ok ? validateReference(row.value.priorArm, 'CAPITAL_APPROVALS') : row;
      const approval = row.ok ? validateReference(row.value.approval, 'CAPITAL_APPROVALS') : row;
      const policy = row.ok ? validateWaitingL08(row.value.armingPolicy) : row;
      if (!row.ok || !prior.ok || !approval.ok || !policy.ok || row.value.mode !== 'VALIDATE_ONLY') return invalid('Re-arm command is invalid.');
      return success({ type, priorArm: prior.value, approval: approval.value, armingPolicy: policy.value, mode: 'VALIDATE_ONLY' } as DurableControlAction);
    }
    case 'REVOKE': {
      const row = closedRecord(value, ['type', 'targetKind', 'target'], type);
      const target = row.ok ? validateReference(row.value.target) : row;
      if (!row.ok || !target.ok || !['APPROVAL', 'RESERVATION', 'ARM'].includes(String(row.value.targetKind))) return invalid('Revocation command is invalid.');
      const expected = row.value.targetKind === 'RESERVATION' ? 'CAPITAL_RESERVATIONS' : 'CAPITAL_APPROVALS';
      if (target.value.owner !== expected) return invalid('Revocation target does not belong to the declared owner.');
      return success({ type, targetKind: row.value.targetKind, target: target.value } as DurableControlAction);
    }
    case 'HALT': {
      const row = closedRecord(value, ['type', 'scope', 'retainSupervision'], type);
      return row.ok && row.value.scope === 'NEW_RISK' && row.value.retainSupervision === true
        ? success({ type, scope: 'NEW_RISK', retainSupervision: true })
        : invalid('Halt must retain supervision and apply only to NEW_RISK.');
    }
    case 'RECONCILE': {
      const row = closedRecord(value, ['type', 'scope', 'target'], type);
      const target = row.ok ? validateReference(row.value.target, 'FOUNDATION_RECONCILIATION') : row;
      if (!row.ok || !target.ok || row.value.scope !== 'ACCOUNT_AND_EXCHANGE') return invalid('Reconciliation command is invalid.');
      return success({ type, scope: 'ACCOUNT_AND_EXCHANGE', target: target.value } as DurableControlAction);
    }
    case 'CANCEL': {
      const row = closedRecord(value, ['type', 'order', 'orderPolicy', 'riskBound'], type);
      const order = row.ok ? validateReference(row.value.order, 'L06_MUTATION_JOURNAL') : row;
      const policy = row.ok ? validateWaitingL08(row.value.orderPolicy) : row;
      const risk = row.ok ? validateRiskBound(row.value.riskBound) : row;
      if (!row.ok || !order.ok || !policy.ok || !risk.ok) return invalid('Cancel command is invalid.');
      return success({ type, order: order.value, orderPolicy: policy.value, riskBound: risk.value } as DurableControlAction);
    }
    case 'CLOSE': {
      const row = closedRecord(value, ['type', 'position', 'orderPolicy', 'riskBound'], type);
      const position = row.ok ? validateReference(row.value.position, 'CAPITAL_POSITIONS') : row;
      const policy = row.ok ? validateWaitingL08(row.value.orderPolicy) : row;
      const risk = row.ok ? validateRiskBound(row.value.riskBound) : row;
      if (!row.ok || !position.ok || !policy.ok || !risk.ok) return invalid('Close command is invalid.');
      return success({ type, position: position.value, orderPolicy: policy.value, riskBound: risk.value } as DurableControlAction);
    }
    case 'REDUCE': {
      const row = closedRecord(value, ['type', 'position', 'reductionBps', 'orderPolicy', 'riskBound'], type);
      const position = row.ok ? validateReference(row.value.position, 'CAPITAL_POSITIONS') : row;
      const policy = row.ok ? validateWaitingL08(row.value.orderPolicy) : row;
      const risk = row.ok ? validateRiskBound(row.value.riskBound) : row;
      if (!row.ok || !position.ok || !policy.ok || !risk.ok
        || !Number.isSafeInteger(row.value.reductionBps)
        || Number(row.value.reductionBps) < 1 || Number(row.value.reductionBps) > 10_000) return invalid('Reduce command is invalid.');
      return success({ type, position: position.value, reductionBps: row.value.reductionBps, orderPolicy: policy.value, riskBound: risk.value } as DurableControlAction);
    }
    case 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN': {
      const row = closedRecord(value, ['type', 'recoveryPlan', 'riskBound'], type);
      const plan = row.ok ? validateWaitingL08(row.value.recoveryPlan) : row;
      const risk = row.ok ? validateRiskBound(row.value.riskBound) : row;
      if (!row.ok || !plan.ok || !risk.ok) return invalid('Recovery-plan command is invalid.');
      return success({ type, recoveryPlan: plan.value, riskBound: risk.value } as DurableControlAction);
    }
    case 'REPAY_LIABILITY': {
      const row = closedRecord(value, ['type', 'liability', 'repaymentPolicy', 'riskBound'], type);
      const liability = row.ok ? validateReference(row.value.liability) : row;
      const policy = row.ok ? validateWaitingL08(row.value.repaymentPolicy) : row;
      const risk = row.ok ? validateRiskBound(row.value.riskBound) : row;
      if (!row.ok || !liability.ok || !policy.ok || !risk.ok) return invalid('Liability-repayment command is invalid.');
      return success({ type, liability: liability.value, repaymentPolicy: policy.value, riskBound: risk.value } as DurableControlAction);
    }
    case 'SAFE_RESTART_COMPONENT': {
      const row = closedRecord(value, ['type', 'component', 'restartMode'], type);
      const component = row.ok ? validateReference(row.value.component, 'FOUNDATION_CONTROL') : row;
      if (!row.ok || !component.ok || row.value.restartMode !== 'SAFE_RECONCILE_FIRST') return invalid('Safe-restart command is invalid.');
      return success({ type, component: component.value, restartMode: 'SAFE_RECONCILE_FIRST' } as DurableControlAction);
    }
    case 'ACKNOWLEDGE_RECOVERY': {
      const row = closedRecord(value, ['type', 'recovery', 'observedRecoveryRevision', 'statement'], type);
      const recovery = row.ok ? validateReference(row.value.recovery, 'FOUNDATION_EXECUTION') : row;
      if (!row.ok || !recovery.ok || !boundedRevision(row.value.observedRecoveryRevision) || row.value.statement !== 'AWARENESS_ONLY') {
        return invalid('Recovery acknowledgement must be awareness-only and revision-bound.');
      }
      return success({ type, recovery: recovery.value, observedRecoveryRevision: row.value.observedRecoveryRevision, statement: 'AWARENESS_ONLY' } as DurableControlAction);
    }
  }
}

function validateReason(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= CONTROL_LIMITS.maximumReasonLength
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !SENSITIVE_MATERIAL.test(value)
    && !REMOTE_OR_SHELL.test(value);
}

export function validatePreviewRequest(value: unknown): RuntimeValidation<ControlPreviewRequest> {
  const row = closedRecord(value, ['schema', 'version', 'action', 'expectedConfigVersion', 'reason', 'ttlMs'], 'preview request');
  if (!row.ok) return row as RuntimeValidation<ControlPreviewRequest>;
  const action = validateDurableControlAction(row.value.action);
  if (row.value.schema !== DURABLE_CONTROL_SCHEMA || row.value.version !== 1 || !action.ok
    || !Number.isSafeInteger(row.value.expectedConfigVersion) || Number(row.value.expectedConfigVersion) < 0
    || !validateReason(row.value.reason)
    || !Number.isSafeInteger(row.value.ttlMs)
    || Number(row.value.ttlMs) < CONTROL_LIMITS.minimumTtlMs
    || Number(row.value.ttlMs) > CONTROL_LIMITS.maximumTtlMs) {
    const code = typeof row.value.reason === 'string' && SENSITIVE_MATERIAL.test(row.value.reason)
      ? 'SENSITIVE_MATERIAL_REJECTED'
      : 'INVALID_CONTROL_REQUEST';
    return invalid('Preview request failed its exact bounded schema.', code);
  }
  return success({
    schema: DURABLE_CONTROL_SCHEMA,
    version: 1,
    action: action.value,
    expectedConfigVersion: row.value.expectedConfigVersion,
    reason: row.value.reason,
    ttlMs: row.value.ttlMs,
  } as ControlPreviewRequest);
}

export function validateRiskWitness(value: unknown): RuntimeValidation<PreviewRiskWitnessV1> {
  const row = closedRecord(value, ['truthRevision', 'measureRevision', 'currentValue', 'maximumPostActionValue', 'evaluatedAtMs', 'authority'], 'risk witness');
  if (!row.ok) return row as RuntimeValidation<PreviewRiskWitnessV1>;
  if (!boundedRevision(row.value.truthRevision) || !boundedRevision(row.value.measureRevision)
    || !validExactDecimal(row.value.currentValue) || !validExactDecimal(row.value.maximumPostActionValue)
    || !isValidUtcMillis(row.value.evaluatedAtMs) || row.value.authority !== 'FOUNDATION_RISK') {
    return invalid('Risk witness is invalid.');
  }
  return success(row.value as unknown as PreviewRiskWitnessV1);
}

export function validatePreview(value: unknown): RuntimeValidation<DurableControlPreview> {
  const row = closedRecord(value, [
    'schema', 'version', 'commandId', 'action', 'actionDigest', 'expectedConfigVersion',
    'expectedControlRevision', 'actorBinding', 'reason', 'generatedAtMs', 'expiresAtMs',
    'riskWitness', 'previewDigest', 'authorizationTag', 'externalActionAuthorization',
  ], 'control preview');
  if (!row.ok) return row as RuntimeValidation<DurableControlPreview>;
  const action = validateDurableControlAction(row.value.action);
  const risk = row.value.riskWitness === null ? success<PreviewRiskWitnessV1 | null>(null) : validateRiskWitness(row.value.riskWitness);
  if (row.value.schema !== DURABLE_CONTROL_PREVIEW_SCHEMA || row.value.version !== 1
    || !COMMAND_ID.test(String(row.value.commandId)) || !action.ok || !validDigest(row.value.actionDigest)
    || !Number.isSafeInteger(row.value.expectedConfigVersion) || Number(row.value.expectedConfigVersion) < 0
    || !Number.isSafeInteger(row.value.expectedControlRevision) || Number(row.value.expectedControlRevision) < 0
    || typeof row.value.actorBinding !== 'string' || !ACTOR_BINDING.test(row.value.actorBinding)
    || !validateReason(row.value.reason) || !isValidUtcMillis(row.value.generatedAtMs)
    || !isValidUtcMillis(row.value.expiresAtMs) || Number(row.value.expiresAtMs) <= Number(row.value.generatedAtMs)
    || !risk.ok || !validDigest(row.value.previewDigest)
    || typeof row.value.authorizationTag !== 'string' || !AUTHORIZATION_TAG.test(row.value.authorizationTag)
    || row.value.externalActionAuthorization !== 'NONE') {
    return invalid('Control preview failed its exact bounded schema.');
  }
  return success({ ...row.value, action: action.value, riskWitness: risk.value } as unknown as DurableControlPreview);
}

export function validateSubmissionRequest(value: unknown): RuntimeValidation<ControlSubmissionRequest> {
  const row = closedRecord(value, ['schema', 'version', 'preview'], 'submission request');
  if (!row.ok) return row as RuntimeValidation<ControlSubmissionRequest>;
  const preview = validatePreview(row.value.preview);
  if (row.value.schema !== DURABLE_CONTROL_SCHEMA || row.value.version !== 1 || !preview.ok) {
    return invalid('Submission request failed its exact bounded schema.', 'INVALID_CONTROL_REQUEST');
  }
  return success({ schema: DURABLE_CONTROL_SCHEMA, version: 1, preview: preview.value });
}

export function validateOperatorIdentity(value: unknown, nowMs: number): RuntimeValidation<AuthenticatedOperatorIdentity> {
  const row = closedRecord(value, [
    'authenticated', 'subjectId', 'sessionId', 'source', 'audience', 'authenticatedAtMs', 'expiresAtMs',
  ], 'operator identity');
  if (!row.ok) return invalid('Authenticated operator identity is required.', 'OPERATOR_IDENTITY_INVALID');
  if (row.value.authenticated !== true
    || typeof row.value.subjectId !== 'string' || row.value.subjectId.length > CONTROL_LIMITS.maximumIdentityLength || !IDENTIFIER.test(row.value.subjectId)
    || typeof row.value.sessionId !== 'string' || row.value.sessionId.length > CONTROL_LIMITS.maximumIdentityLength || !IDENTIFIER.test(row.value.sessionId)
    || !['LOOPBACK', 'CLOUDFLARE_ACCESS'].includes(String(row.value.source))
    || row.value.audience !== 'L14_DURABLE_CONTROLS'
    || !isValidUtcMillis(row.value.authenticatedAtMs) || !isValidUtcMillis(row.value.expiresAtMs)
    || Number(row.value.authenticatedAtMs) > nowMs || nowMs >= Number(row.value.expiresAtMs)) {
    return invalid('Operator identity is malformed, foreign, or expired.', 'OPERATOR_IDENTITY_INVALID');
  }
  return success(row.value as unknown as AuthenticatedOperatorIdentity);
}

export function validateControlPlaneSnapshot(value: unknown, nowMs: number): RuntimeValidation<ControlPlaneSnapshot> {
  const row = closedRecord(value, [
    'configVersion', 'controlRevision', 'recoveryState', 'halted', 'intakePaused', 'observedAtMs', 'foundationRuntime',
  ], 'control-plane snapshot');
  if (!row.ok) return invalid('Control-plane snapshot is invalid.', 'OWNER_SNAPSHOT_INVALID');
  const runtime = closedRecord(row.value.foundationRuntime, ['revision', 'desiredState', 'phase'], 'Foundation runtime snapshot');
  if (!runtime.ok || !Number.isSafeInteger(row.value.configVersion) || Number(row.value.configVersion) < 0
    || !Number.isSafeInteger(row.value.controlRevision) || Number(row.value.controlRevision) < 0
    || !['CLEAR', 'RECOVERY_REQUIRED', 'RECONCILING', 'UNKNOWN'].includes(String(row.value.recoveryState))
    || typeof row.value.halted !== 'boolean' || typeof row.value.intakePaused !== 'boolean'
    || !isValidUtcMillis(row.value.observedAtMs) || Number(row.value.observedAtMs) > nowMs
    || nowMs - Number(row.value.observedAtMs) > CONTROL_LIMITS.maximumSnapshotAgeMs
    || !Number.isSafeInteger(runtime.value.revision) || Number(runtime.value.revision) < 0
    || !['STOPPED', 'RUNNING', 'PAUSED'].includes(String(runtime.value.desiredState))
    || !['STOPPED', 'VALIDATING', 'STARTING', 'RUNNING', 'DEGRADED', 'PAUSING', 'PAUSED', 'STOPPING', 'BLOCKED', 'FAILED'].includes(String(runtime.value.phase))) {
    return invalid('Control-plane snapshot is stale or malformed.', 'OWNER_SNAPSHOT_INVALID');
  }
  return success({ ...row.value, foundationRuntime: runtime.value } as unknown as ControlPlaneSnapshot);
}

export function validateExchangeTruth(value: unknown, nowMs: number): RuntimeValidation<ExchangeTruthSnapshotV1> {
  const row = closedRecord(value, ['status', 'truthRevision', 'accountRealmId', 'observedAtMs', 'riskMeasure'], 'exchange truth');
  if (!row.ok) return invalid('Exchange truth is unavailable.', 'EXCHANGE_TRUTH_UNAVAILABLE');
  const measure = closedRecord(row.value.riskMeasure, ['definition', 'value'], 'exchange risk measure');
  const definition = measure.ok ? validateReference(measure.value.definition, 'FOUNDATION_RISK') : measure;
  if (!['CURRENT_COMPLETE', 'STALE', 'PARTIAL', 'DIVERGED', 'UNAVAILABLE'].includes(String(row.value.status))
    || !boundedRevision(row.value.truthRevision) || !boundedIdentifier(row.value.accountRealmId)
    || !isValidUtcMillis(row.value.observedAtMs) || Number(row.value.observedAtMs) > nowMs
    || !measure.ok || !definition.ok || !validExactDecimal(measure.value.value)) {
    return invalid('Exchange truth is malformed.', 'EXCHANGE_TRUTH_UNAVAILABLE');
  }
  if (row.value.status === 'STALE') return invalid('Exchange truth is stale.', 'EXCHANGE_TRUTH_STALE');
  if (row.value.status === 'PARTIAL') return invalid('Exchange truth is incomplete.', 'EXCHANGE_TRUTH_INCOMPLETE');
  if (row.value.status === 'DIVERGED') return invalid('Exchange truth diverges from owner truth.', 'EXCHANGE_TRUTH_MISMATCH');
  if (row.value.status !== 'CURRENT_COMPLETE') return invalid('Exchange truth is unavailable.', 'EXCHANGE_TRUTH_UNAVAILABLE');
  return success({ ...row.value, riskMeasure: { definition: definition.value, value: measure.value.value } } as ExchangeTruthSnapshotV1);
}

export function validateOwnerInspection(value: unknown): RuntimeValidation<CanonicalOwnerInspection> {
  const row = closedRecord(value, ['accepted', 'reasonCode', 'riskIncreasing'], 'owner inspection');
  if (!row.ok || typeof row.value.accepted !== 'boolean' || typeof row.value.riskIncreasing !== 'boolean'
    || typeof row.value.reasonCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.value.reasonCode)) {
    return invalid('Canonical owner returned an invalid inspection.', 'OWNER_CONTRACT_INVALID');
  }
  const acceptedReason = row.value.reasonCode === 'CONTROL_APPLIED' || row.value.reasonCode === 'CONTROL_NOOP';
  if ((row.value.accepted && !acceptedReason) || (!row.value.accepted && acceptedReason)) {
    return invalid('Canonical owner inspection reason contradicts its decision.', 'OWNER_CONTRACT_INVALID');
  }
  return success(row.value as unknown as CanonicalOwnerInspection);
}

export function validateOwnerApplication(value: unknown): RuntimeValidation<CanonicalOwnerApplication> {
  const row = closedRecord(value, [
    'accepted', 'applied', 'reasonCode', 'evaluatedAtMs', 'deadlineAtMs',
    'deadlineHonored', 'observedConfigVersion', 'observedControlRevision',
  ], 'owner application');
  if (!row.ok || typeof row.value.accepted !== 'boolean' || typeof row.value.applied !== 'boolean'
    || typeof row.value.reasonCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.value.reasonCode)) {
    return invalid('Canonical owner returned an invalid application.', 'OWNER_CONTRACT_INVALID');
  }
  if (!isValidUtcMillis(row.value.evaluatedAtMs) || !isValidUtcMillis(row.value.deadlineAtMs)
    || Number(row.value.evaluatedAtMs) >= Number(row.value.deadlineAtMs)
    || row.value.deadlineHonored !== true
    || !Number.isSafeInteger(row.value.observedConfigVersion) || Number(row.value.observedConfigVersion) < 0
    || !Number.isSafeInteger(row.value.observedControlRevision) || Number(row.value.observedControlRevision) < 0) {
    return invalid('Canonical owner did not prove version-bound deadline enforcement.', 'OWNER_CONTRACT_INVALID');
  }
  const applicationConsistent = (row.value.accepted === true && row.value.applied === true && row.value.reasonCode === 'CONTROL_APPLIED')
    || (row.value.accepted === true && row.value.applied === false && row.value.reasonCode === 'CONTROL_NOOP')
    || (row.value.accepted === false && row.value.applied === false
      && !['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(String(row.value.reasonCode)));
  if (!applicationConsistent) {
    return invalid('Canonical owner application reason contradicts its outcome.', 'OWNER_CONTRACT_INVALID');
  }
  return success(row.value as unknown as CanonicalOwnerApplication);
}

export function validateControlReceipt(value: unknown): RuntimeValidation<ControlCommandReceipt> {
  const row = closedRecord(value, [
    'schema', 'version', 'commandId', 'previewDigest', 'actionType', 'disposition',
    'reasonCode', 'actorBinding', 'expectedConfigVersion', 'committedControlRevision',
    'applied', 'recordedAtMs', 'ledgerEventIds', 'recoveryStateChanged',
    'externalActionAuthorization',
  ], 'control receipt');
  if (!row.ok || row.value.schema !== 'LIVE_EDGE_CONTROL_RECEIPT_V1' || row.value.version !== 1
    || !COMMAND_ID.test(String(row.value.commandId)) || !validDigest(row.value.previewDigest)
    || typeof row.value.actionType !== 'string' || !(DURABLE_CONTROL_ACTION_TYPES as readonly string[]).includes(row.value.actionType)
    || !['APPLIED', 'NOOP', 'AWARENESS_RECORDED'].includes(String(row.value.disposition))
    || typeof row.value.reasonCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.value.reasonCode)
    || typeof row.value.actorBinding !== 'string' || !ACTOR_BINDING.test(row.value.actorBinding)
    || !Number.isSafeInteger(row.value.expectedConfigVersion) || Number(row.value.expectedConfigVersion) < 0
    || !Number.isSafeInteger(row.value.committedControlRevision) || Number(row.value.committedControlRevision) < 1
    || typeof row.value.applied !== 'boolean' || !isValidUtcMillis(row.value.recordedAtMs)
    || row.value.recoveryStateChanged !== false || row.value.externalActionAuthorization !== 'NONE') {
    return invalid('Completed control receipt is invalid.', 'PERSISTENCE_ACK_INVALID');
  }
  const ledgerIds = validateLedgerEventIdTuple(row.value.ledgerEventIds);
  if (!ledgerIds.ok) return ledgerIds;
  const consistent = (row.value.disposition === 'APPLIED' && row.value.applied === true && row.value.reasonCode === 'CONTROL_APPLIED')
    || (row.value.disposition === 'NOOP' && row.value.applied === false && row.value.reasonCode === 'CONTROL_NOOP')
    || (row.value.disposition === 'AWARENESS_RECORDED' && row.value.applied === false
      && row.value.reasonCode === 'AWARENESS_RECORDED' && row.value.actionType === 'ACKNOWLEDGE_RECOVERY');
  if (!consistent) return invalid('Completed control receipt is internally inconsistent.', 'PERSISTENCE_ACK_INVALID');
  return success({ ...row.value, ledgerEventIds: ledgerIds.value } as unknown as ControlCommandReceipt);
}

function validateLedgerEventIdTuple(value: unknown): RuntimeValidation<readonly [number, number]> {
  try {
    if (!Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length !== 0) {
      return invalid('Receipt ledger event identities are invalid.', 'PERSISTENCE_ACK_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const keys = Object.keys(descriptors);
    if (keys.length !== 3 || !keys.includes('0') || !keys.includes('1') || !keys.includes('length')) {
      return invalid('Receipt ledger event identities are invalid.', 'PERSISTENCE_ACK_INVALID');
    }
    const first = descriptors['0'];
    const second = descriptors['1'];
    const length = descriptors.length;
    if (!first || !second || !length
      || 'get' in first || 'set' in first || 'get' in second || 'set' in second
      || 'get' in length || 'set' in length
      || length.value !== 2
      || !Number.isSafeInteger(first.value) || first.value < 1
      || !Number.isSafeInteger(second.value) || second.value < 1
      || first.value === second.value) {
      return invalid('Receipt ledger event identities are invalid.', 'PERSISTENCE_ACK_INVALID');
    }
    return success(Object.freeze([first.value, second.value]) as readonly [number, number]);
  } catch {
    return invalid('Receipt ledger event identities are invalid.', 'PERSISTENCE_ACK_INVALID');
  }
}

export function validateControlRejectionReceipt(value: unknown): RuntimeValidation<ControlCommandRejectionReceipt> {
  const row = closedRecord(value, [
    'schema', 'version', 'commandId', 'previewDigest', 'actionType', 'actorBinding',
    'reasonCode', 'expectedConfigVersion', 'committedControlRevision', 'recordedAtMs',
    'ledgerEventIds', 'recoveryStateChanged', 'externalActionAuthorization',
  ], 'control rejection receipt');
  if (!row.ok || row.value.schema !== 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1' || row.value.version !== 1
    || !COMMAND_ID.test(String(row.value.commandId)) || !validDigest(row.value.previewDigest)
    || typeof row.value.actionType !== 'string' || !(DURABLE_CONTROL_ACTION_TYPES as readonly string[]).includes(row.value.actionType)
    || typeof row.value.actorBinding !== 'string' || !ACTOR_BINDING.test(row.value.actorBinding)
    || typeof row.value.reasonCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.value.reasonCode)
    || ['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(String(row.value.reasonCode))
    || !Number.isSafeInteger(row.value.expectedConfigVersion) || Number(row.value.expectedConfigVersion) < 0
    || !Number.isSafeInteger(row.value.committedControlRevision) || Number(row.value.committedControlRevision) < 1
    || !isValidUtcMillis(row.value.recordedAtMs)
    || row.value.recoveryStateChanged !== false || row.value.externalActionAuthorization !== 'NONE') {
    return invalid('Rejected control receipt is invalid.', 'PERSISTENCE_ACK_INVALID');
  }
  const ledgerIds = validateLedgerEventIdTuple(row.value.ledgerEventIds);
  if (!ledgerIds.ok) return ledgerIds;
  return success({ ...row.value, ledgerEventIds: ledgerIds.value } as unknown as ControlCommandRejectionReceipt);
}

export function validateRiskDecision(value: unknown, nowMs: number): RuntimeValidation<RiskOwnerDecision> {
  const row = closedRecord(value, ['allowed', 'reasonCode', 'projectedPostActionValue', 'measureRevision', 'evaluatedAtMs', 'authority'], 'risk-owner decision');
  if (!row.ok || typeof row.value.allowed !== 'boolean'
    || !['CONTROL_APPLIED', 'RISK_INCREASE_FORBIDDEN', 'EXCHANGE_TRUTH_MISMATCH'].includes(String(row.value.reasonCode))
    || !validExactDecimal(row.value.projectedPostActionValue) || !boundedRevision(row.value.measureRevision)
    || !isValidUtcMillis(row.value.evaluatedAtMs) || Number(row.value.evaluatedAtMs) > nowMs
    || row.value.authority !== 'FOUNDATION_RISK') {
    return invalid('Risk owner returned an invalid decision.', 'RISK_OWNER_CONTRACT_INVALID');
  }
  if (row.value.allowed && row.value.reasonCode !== 'CONTROL_APPLIED') {
    return invalid('Allowed risk decision must use CONTROL_APPLIED.', 'RISK_OWNER_CONTRACT_INVALID');
  }
  if (!row.value.allowed && row.value.reasonCode === 'CONTROL_APPLIED') {
    return invalid('Denied risk decision cannot use CONTROL_APPLIED.', 'RISK_OWNER_CONTRACT_INVALID');
  }
  return success(row.value as unknown as RiskOwnerDecision);
}

export function validateLookup(value: unknown): RuntimeValidation<ControlCommandLookup> {
  const kind = (() => {
    try { return Object.getOwnPropertyDescriptor(value as object, 'kind')?.value; } catch { return null; }
  })();
  if (kind === 'NOT_FOUND') {
    const row = closedRecord(value, ['kind', 'journalVersion', 'headDigest'], 'command lookup');
    return row.ok && row.value.journalVersion === 0 && row.value.headDigest === null
      ? success(row.value as unknown as ControlCommandLookup)
      : invalid('Command lookup is invalid.', 'PERSISTENCE_ACK_INVALID');
  }
  const fields = kind === 'COMPLETED'
    ? ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest', 'receipt']
    : kind === 'REJECTED'
      ? ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest', 'rejection']
      : ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest'];
  const row = closedRecord(value, fields, 'command lookup');
  if (!row.ok || !['PENDING', 'COMPLETED', 'REJECTED'].includes(String(kind)) || !validDigest(row.value.previewDigest)
    || typeof row.value.actorBinding !== 'string' || !ACTOR_BINDING.test(row.value.actorBinding)
    || !Number.isSafeInteger(row.value.journalVersion) || Number(row.value.journalVersion) < 1
    || typeof row.value.headDigest !== 'string' || !HEAD_DIGEST.test(row.value.headDigest)) {
    return invalid('Command lookup is invalid.', 'PERSISTENCE_ACK_INVALID');
  }
  if (kind === 'COMPLETED') {
    const receipt = validateControlReceipt(row.value.receipt);
    if (!receipt.ok
      || receipt.value.previewDigest !== row.value.previewDigest
      || receipt.value.actorBinding !== row.value.actorBinding) {
      return invalid('Completed command lookup carries a foreign or invalid receipt.', 'PERSISTENCE_ACK_INVALID');
    }
    return success({ ...row.value, receipt: receipt.value } as unknown as ControlCommandLookup);
  }
  if (kind === 'REJECTED') {
    const rejection = validateControlRejectionReceipt(row.value.rejection);
    if (!rejection.ok
      || rejection.value.previewDigest !== row.value.previewDigest
      || rejection.value.actorBinding !== row.value.actorBinding) {
      return invalid('Rejected command lookup carries a foreign or invalid receipt.', 'PERSISTENCE_ACK_INVALID');
    }
    return success({ ...row.value, rejection: rejection.value } as unknown as ControlCommandLookup);
  }
  return success(row.value as unknown as ControlCommandLookup);
}

export function validateAppendAcknowledgement(value: unknown): RuntimeValidation<ControlEventAppendAcknowledgement> {
  const row = closedRecord(value, [
    'schema', 'version', 'owner', 'disposition', 'commandId', 'eventId', 'idempotencyKey',
    'appendRequestDigest', 'expectedJournalVersion', 'committedJournalVersion', 'previousHeadDigest',
    'committedHeadDigest', 'appendedCount', 'ledgerEventId', 'committedAtMs', 'currentConfigVersion',
    'currentControlRevision', 'failureCode', 'externalActionAuthorization',
  ], 'control append acknowledgement');
  if (!row.ok || row.value.schema !== DURABLE_CONTROL_ACK_SCHEMA || row.value.version !== 1
    || row.value.owner !== 'SYSTEM_INTEGRATION_LEDGER'
    || !['COMMITTED_NEW', 'IDEMPOTENT_REPLAY', 'IDEMPOTENCY_CONFLICT', 'VERSION_CONFLICT', 'EXPIRED', 'FAILED'].includes(String(row.value.disposition))
    || !COMMAND_ID.test(String(row.value.commandId)) || !EVENT_ID.test(String(row.value.eventId))
    || typeof row.value.idempotencyKey !== 'string' || !IDENTIFIER.test(row.value.idempotencyKey)
    || !validDigest(row.value.appendRequestDigest)
    || !Number.isSafeInteger(row.value.expectedJournalVersion) || Number(row.value.expectedJournalVersion) < 0
    || (row.value.committedJournalVersion !== null && (!Number.isSafeInteger(row.value.committedJournalVersion) || Number(row.value.committedJournalVersion) < 1))
    || (row.value.previousHeadDigest !== null && (typeof row.value.previousHeadDigest !== 'string' || !HEAD_DIGEST.test(row.value.previousHeadDigest)))
    || (row.value.committedHeadDigest !== null && (typeof row.value.committedHeadDigest !== 'string' || !HEAD_DIGEST.test(row.value.committedHeadDigest)))
    || ![0, 1].includes(Number(row.value.appendedCount))
    || (row.value.ledgerEventId !== null && (!Number.isSafeInteger(row.value.ledgerEventId) || Number(row.value.ledgerEventId) < 1))
    || (row.value.committedAtMs !== null && !isValidUtcMillis(row.value.committedAtMs))
    || !Number.isSafeInteger(row.value.currentConfigVersion) || Number(row.value.currentConfigVersion) < 0
    || !Number.isSafeInteger(row.value.currentControlRevision) || Number(row.value.currentControlRevision) < 0
    || (row.value.failureCode !== null && (typeof row.value.failureCode !== 'string' || !(CONTROL_REASON_CODES as readonly string[]).includes(row.value.failureCode)))
    || row.value.externalActionAuthorization !== 'NONE') {
    return invalid('Control append acknowledgement is invalid.', 'PERSISTENCE_ACK_INVALID');
  }
  return success(row.value as unknown as ControlEventAppendAcknowledgement);
}

export function isRiskCheckedAction(action: Readonly<DurableControlAction>): boolean {
  return ['CANCEL', 'CLOSE', 'REDUCE', 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN', 'REPAY_LIABILITY'].includes(action.type);
}

export function isWaitingL08Action(action: Readonly<DurableControlAction>): boolean {
  return ['APPROVE', 'ARM', 'REARM', 'CANCEL', 'CLOSE', 'REDUCE', 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN', 'REPAY_LIABILITY'].includes(action.type);
}

export function isCommandId(value: unknown): value is string {
  return typeof value === 'string' && COMMAND_ID.test(value);
}

export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && EVENT_ID.test(value);
}

export function isActorBinding(value: unknown): value is string {
  return typeof value === 'string' && ACTOR_BINDING.test(value);
}

export function isHeadDigest(value: unknown): value is string {
  return typeof value === 'string' && HEAD_DIGEST.test(value);
}
