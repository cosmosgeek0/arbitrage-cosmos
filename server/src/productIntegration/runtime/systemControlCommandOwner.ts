import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  IsolatablePublicSourceId,
  SourceIsolationAction,
  SourceIsolationOwnerPort,
  SourceReceipt,
  SourceIsolationSnapshot,
} from '../../intelligenceRuntime/lifecycle/index.js';
import type {
  SystemControlMutation,
  SystemControlMutationRequest,
  SystemControlState,
  SystemFocusPinReadback,
} from '../../systemIntegration/contracts/index.js';
import { controlRequestDigest, type SystemControlService } from '../../systemIntegration/controls/index.js';
import type {
  ProductIncidentAcknowledgementEvidence,
  ProductIncidentAcknowledgementRequest,
  ProductIncidentAcknowledgementResult,
  ProductIncidentCommandBinding,
} from '../incidents/index.js';
import type { ProductIncidentRecord } from '../../systemIntegration/persistence/types.js';
import { productIncidentAcknowledgementControlId } from './controls.js';
import {
  PRODUCT_RUNTIME_COMMAND_SCHEMA,
  type ProductRuntimeCommandIntent,
  type ProductRuntimeCommandOwnerCapability,
  type ProductRuntimeCommandOwnerPort,
  type ProductRuntimeCommandRequest,
  type ProductRuntimeCommandResultIdentity,
  type ProductRuntimeCommandResultReadback,
  type ProductRuntimeControlPreview,
  type ProductRuntimeControlResult,
  type ProductRuntimeControlResultStatus,
  type ProductRuntimeSafeBackendCommand,
} from './types.js';

const PREVIEW_SCHEMA = 'product-system-control-preview.v1' as const;
const PREVIEW_TTL_MS = 30_000;
const MAX_UTC_MS = 4_102_444_800_000;
const REVISION = /^(?:0|[1-9][0-9]{0,15})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PREVIEW_ID = /^prv_[a-f0-9]{64}$/;
const COMMAND_ID = /^sysctrl_[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const CONTROL_ID = /^[a-z0-9][a-z0-9.-]{0,159}$/;

type ResolvedControlIntent =
  | Readonly<{
      kind: 'SYSTEM';
      revision: number;
      mutation: Readonly<SystemControlMutation>;
      consequence: string;
    }>
  | Readonly<{
      kind: 'SOURCE';
      revision: number;
      sourceId: IsolatablePublicSourceId;
      action: SourceIsolationAction;
      mutation: Readonly<{
        command: 'SET_PUBLIC_SOURCE_LIFECYCLE';
        sourceId: IsolatablePublicSourceId;
        action: SourceIsolationAction;
      }>;
      consequence: string;
    }>
  | Readonly<{
      kind: 'INCIDENT';
      revision: number;
      incidentId: string;
      operation: Readonly<{
        command: 'ACK_INCIDENT';
        incidentId: string;
      }>;
      consequence: string;
    }>;

export interface ProductRuntimeSystemControlCommandOwnerDependencies {
  /** The one canonical service; this adapter owns no control state or receipt store. */
  readonly controls: Pick<SystemControlService, 'snapshot' | 'mutate' | 'readResult'>;
  /** Intelligence Runtime remains the source-lifecycle state and effect owner. */
  readonly sourceIsolation?: SourceIsolationOwnerPort;
  /** System Integration composes durable desired posture with strategy-owner effect readback. */
  readonly strategyIntake?: Readonly<{
    readState(strategy: 'basis' | 'volume'): Readonly<{
      strategy: 'basis' | 'volume';
      desiredPaused: boolean;
      effectivePaused: boolean | null;
      controlRevision: number;
      state: 'APPLIED' | 'EFFECT_UNAVAILABLE' | 'OWNER_NOT_WIRED';
    }>;
  }>;
  readonly attentionFocus?: Readonly<{
    readState(symbol: string): Readonly<SystemFocusPinReadback>;
    readPinnedSymbols(): readonly string[];
  }>;
  /** Product Integration owns ACK semantics; this adapter owns no incident state. */
  readonly incidents?: Readonly<{
    readIncident(incidentId: string): Readonly<ProductIncidentRecord> | null;
    acknowledge(
      request: unknown,
      command?: unknown,
    ): Readonly<ProductIncidentAcknowledgementResult>;
    readCommandAcknowledgement(
      idempotencyKey: string,
      controlId: string,
    ): Readonly<ProductIncidentAcknowledgementEvidence> | null;
  }>;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function utcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function validActor(value: unknown): value is ProductRuntimeCommandIntent['operator'] {
  if (!plainObject(value) || !exactKeys(value, ['id', 'email', 'source'])) return false;
  return typeof value.id === 'string'
    && value.id.trim().length > 0
    && value.id.length <= 160
    && (value.email === null || (typeof value.email === 'string' && value.email.length <= 320))
    && (value.source === 'loopback' || value.source === 'cloudflare-access');
}

function parsedRevision(value: unknown): number | null {
  if (typeof value !== 'string' || !REVISION.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function exactPayload(value: unknown, expected: Readonly<Record<string, string | boolean>>): boolean {
  return plainObject(value)
    && exactKeys(value, Object.keys(expected))
    && canonical(value) === canonical(expected);
}

function focusControlIdentity(controlId: unknown): Readonly<{ symbol: string; pinned: boolean }> | null {
  if (typeof controlId !== 'string') return null;
  const matched = controlId.match(/^attention\.focus\.([a-z0-9]{4,20})\.(pin|unpin)$/);
  if (!matched) return null;
  const symbol = matched[1].toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(symbol)
    ? Object.freeze({ symbol, pinned: matched[2] === 'pin' })
    : null;
}

function resolveIntent(value: unknown): ResolvedControlIntent | null {
  if (!plainObject(value) || !exactKeys(value, [
    'controlId', 'backendCommandId', 'targetType', 'targetId', 'payload',
    'expectedRevision', 'nowMs', 'operator',
  ])) return null;
  const revision = parsedRevision(value.expectedRevision);
  if (revision === null || !utcMillis(value.nowMs) || !validActor(value.operator)) return null;

  if (value.controlId === 'global.safe-mode.read-only'
    && value.backendCommandId === 'SET_SAFE_MODE'
    && value.targetType === 'SYSTEM'
    && value.targetId === 'machine'
    && exactPayload(value.payload, { safeMode: 'READ_ONLY' })) {
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      mutation: Object.freeze({ command: 'SET_SAFE_MODE', safeMode: 'READ_ONLY' }),
      consequence: 'The canonical system posture becomes READ_ONLY; no live authority is granted.',
    });
  }
  if (value.controlId === 'global.kill-switch.engage'
    && value.backendCommandId === 'SET_KILL_SWITCH'
    && value.targetType === 'SYSTEM'
    && value.targetId === 'machine'
    && exactPayload(value.payload, { engaged: true })) {
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      mutation: Object.freeze({ command: 'SET_KILL_SWITCH', engaged: true }),
      consequence: 'The canonical kill switch engages and new intake remains fail-closed.',
    });
  }
  if (value.controlId === 'global.intake.pause'
    && value.backendCommandId === 'SET_INTAKE_PAUSED'
    && value.targetType === 'SYSTEM'
    && value.targetId === 'machine'
    && exactPayload(value.payload, { paused: true })) {
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      mutation: Object.freeze({ command: 'SET_INTAKE_PAUSED', paused: true }),
      consequence: 'New intake pauses while reconciliation and supervision remain available.',
    });
  }
  if ((value.controlId === 'strategy.basis.intake' || value.controlId === 'strategy.volume.intake')
    && (value.backendCommandId === 'SET_BASIS_INTAKE' || value.backendCommandId === 'SET_VOLUME_INTAKE')
    && value.targetType === 'COMPONENT'
    && ((value.controlId === 'strategy.basis.intake'
      && value.backendCommandId === 'SET_BASIS_INTAKE'
      && value.targetId === 'basis-engine')
      || (value.controlId === 'strategy.volume.intake'
        && value.backendCommandId === 'SET_VOLUME_INTAKE'
        && value.targetId === 'volume-engine'))
    && plainObject(value.payload)
    && typeof value.payload.paused === 'boolean'
    && exactPayload(value.payload, { paused: value.payload.paused })) {
    const strategy = value.backendCommandId === 'SET_BASIS_INTAKE' ? 'Basis' : 'Volume';
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      mutation: Object.freeze({ command: value.backendCommandId, paused: value.payload.paused }),
      consequence: value.payload.paused
        ? `Only ${strategy} proposal intake pauses; supervision and risk reduction continue.`
        : `Only ${strategy} proposal intake resumes after stricter canonical gates pass.`,
    });
  }
  const focus = focusControlIdentity(value.controlId);
  if (focus !== null
    && value.backendCommandId === 'PIN_FOCUS'
    && value.targetType === 'SYMBOL'
    && value.targetId === focus.symbol
    && exactPayload(value.payload, { symbol: focus.symbol, pinned: focus.pinned })) {
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      mutation: Object.freeze({ command: 'PIN_FOCUS', symbol: focus.symbol, pinned: focus.pinned }),
      consequence: focus.pinned
        ? `The canonical attention owner requests bounded FOCUS for ${focus.symbol}; hard capacity remains authoritative.`
        : `Only the operator focus pin for ${focus.symbol} is released; other attention owners remain authoritative.`,
    });
  }
  if (value.controlId === 'component.engine-supervisor.restart'
    && value.backendCommandId === 'RESTART_COMPONENT'
    && value.targetType === 'COMPONENT'
    && value.targetId === 'engine-supervisor'
    && exactPayload(value.payload, { componentId: 'engine-supervisor' })) {
    return Object.freeze({
      kind: 'SYSTEM',
      revision,
      // System Integration names the one dependency-root lifecycle target
      // `market-universe`; its publication restarts the whole managed graph.
      mutation: Object.freeze({ command: 'RESTART_COMPONENT', componentId: 'market-universe' }),
      consequence: 'The canonical dependency-root managed runtime restarts as one supervised graph.',
    });
  }
  if (value.backendCommandId === 'SET_PUBLIC_SOURCE_LIFECYCLE'
    && value.targetType === 'COMPONENT'
    && (value.targetId === 'public-spot-source' || value.targetId === 'public-usdm-source')
    && value.controlId === `source.${value.targetId}.lifecycle`
    && plainObject(value.payload)
    && (value.payload.action === 'ISOLATE' || value.payload.action === 'RESTART')
    && exactPayload(value.payload, { sourceId: value.targetId, action: value.payload.action })) {
    const sourceId = value.targetId;
    const action = value.payload.action;
    return Object.freeze({
      kind: 'SOURCE',
      revision,
      sourceId,
      action,
      mutation: Object.freeze({ command: 'SET_PUBLIC_SOURCE_LIFECYCLE' as const, sourceId, action }),
      consequence: action === 'ISOLATE'
        ? `Only ${sourceId} is isolated; unrelated public sources remain supervised.`
        : `Only ${sourceId} is restarted from its durable isolated lifecycle.`,
    });
  }
  if (value.backendCommandId === 'ACK_INCIDENT'
    && value.targetType === 'INCIDENT'
    && typeof value.targetId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value.targetId)
    && value.controlId === productIncidentAcknowledgementControlId(value.targetId)
    && revision >= 1
    && exactPayload(value.payload, { incidentId: value.targetId })) {
    return Object.freeze({
      kind: 'INCIDENT',
      revision,
      incidentId: value.targetId,
      operation: Object.freeze({ command: 'ACK_INCIDENT', incidentId: value.targetId }),
      consequence: 'Acknowledgement is appended without clearing incident root cause, severity, health, or source evidence.',
    });
  }
  return null;
}

function previewMaterial(
  intent: Readonly<ProductRuntimeCommandIntent>,
  resolved: Readonly<ResolvedControlIntent>,
  expiresAtMs: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: PREVIEW_SCHEMA,
    controlId: intent.controlId,
    backendCommandId: intent.backendCommandId,
    targetType: intent.targetType,
    targetId: intent.targetId,
    payload: intent.payload,
    expectedRevision: intent.expectedRevision,
    ...(resolved.kind === 'INCIDENT'
      ? { operation: resolved.operation }
      : { mutation: resolved.mutation }),
    actor: Object.freeze({
      id: intent.operator.id,
      email: intent.operator.email,
      source: intent.operator.source,
    }),
    expiresAtMs,
    externalActionAuthorization: 'NONE',
  });
}

function buildPreview(
  intent: Readonly<ProductRuntimeCommandIntent>,
  resolved: Readonly<ResolvedControlIntent>,
  expiresAtMs: number,
): Readonly<ProductRuntimeControlPreview> {
  const digest = `sha256:${sha256(previewMaterial(intent, resolved, expiresAtMs))}`;
  return Object.freeze({
    previewId: `prv_${sha256({ schema: PREVIEW_SCHEMA, digest, expiresAtMs })}`,
    controlId: intent.controlId,
    expectedRevision: intent.expectedRevision,
    digest,
    consequence: resolved.consequence,
    expiresAtMs,
    synthetic: false,
  });
}

function validRequest(value: unknown): value is Readonly<ProductRuntimeCommandRequest> {
  if (!plainObject(value) || !exactKeys(value, [
    'schemaVersion', 'idempotencyKey', 'controlId', 'backendCommandId', 'targetType',
    'targetId', 'payload', 'currentRevision', 'expectedRevision', 'previewId',
    'previewDigest', 'expiresAtMs', 'reason',
  ])) return false;
  return value.schemaVersion === PRODUCT_RUNTIME_COMMAND_SCHEMA
    && ['idempotencyKey', 'controlId', 'backendCommandId', 'targetType', 'targetId',
      'currentRevision', 'expectedRevision', 'previewId', 'previewDigest', 'reason']
      .every((field) => typeof value[field] === 'string' && value[field].length > 0 && value[field].length <= 500)
    && plainObject(value.payload)
    && utcMillis(value.expiresAtMs);
}

function commandIdentity(request: Readonly<ProductRuntimeCommandRequest>): Readonly<{
  commandId: string;
  correlationId: string;
}> {
  return commandIdentityFromParts(request.idempotencyKey, request.controlId);
}

function commandIdentityFromParts(
  idempotencyKey: string,
  controlId: string,
): Readonly<{ commandId: string; correlationId: string }> {
  const identity = sha256({
    schema: PRODUCT_RUNTIME_COMMAND_SCHEMA,
    idempotencyKey,
    controlId,
  });
  return Object.freeze({
    commandId: `sysctrl_${identity}`,
    correlationId: `product.control.${identity.slice(0, 48)}`,
  });
}

function stateText(state: unknown): string {
  return canonical(state);
}

function receiptReference(value: number | string | null): string | null {
  return typeof value === 'number' ? `ledger-event:${value}` : value;
}

function validControlState(value: unknown): value is Readonly<SystemControlState> {
  if (!plainObject(value) || !exactKeys(value, [
    'revision', 'generation', 'safeMode', 'killSwitchEngaged', 'intakePaused',
    'updatedAtMs', 'correlationId',
  ])) return false;
  return Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
    && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(value.safeMode))
    && typeof value.killSwitchEngaged === 'boolean'
    && typeof value.intakePaused === 'boolean'
    && utcMillis(value.updatedAtMs)
    && typeof value.correlationId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.correlationId);
}

function sourceIdForControl(controlId: string): IsolatablePublicSourceId | null {
  if (controlId === 'source.public-spot-source.lifecycle') return 'public-spot-source';
  if (controlId === 'source.public-usdm-source.lifecycle') return 'public-usdm-source';
  return null;
}

function validSourceSnapshot(value: unknown, sourceId: IsolatablePublicSourceId): value is Readonly<SourceIsolationSnapshot> {
  if (!plainObject(value) || value.sourceId !== sourceId
    || !Number.isSafeInteger(value.sourceRevision) || Number(value.sourceRevision) < 0
    || (value.desiredLifecycle !== 'LIVE' && value.desiredLifecycle !== 'ISOLATED')
    || !['LIVE', 'WARMING', 'DEGRADED', 'ISOLATED', 'FAILED', 'STOPPED'].includes(String(value.observedLifecycle))
    || value.lifecycle !== value.observedLifecycle
    || !Number.isSafeInteger(value.generation) || Number(value.generation) < 0) return false;
  return true;
}

function resultFromSourceReceipt(
  identity: Readonly<ProductRuntimeCommandResultIdentity>,
  status: Extract<ProductRuntimeControlResultStatus, 'APPLIED' | 'ACCEPTED_ASYNC'>,
  receipt: Readonly<SourceReceipt>,
  snapshot: Readonly<SourceIsolationSnapshot>,
): Readonly<ProductRuntimeControlResult> {
  const expected = commandIdentityFromParts(identity.idempotencyKey, identity.controlId);
  return Object.freeze({
    ...expected,
    controlId: identity.controlId,
    status,
    before: stateText(receipt.before),
    after: stateText(receipt.after ?? snapshot),
    receiptId: receipt.receiptId,
    completedAtMs: receipt.completedAtMs ?? receipt.requestedAtMs,
    synthetic: false,
  });
}

function mutationMatchesControl(controlId: string, value: unknown): boolean {
  if (!plainObject(value)) return false;
  if (controlId === 'global.safe-mode.read-only') {
    return exactKeys(value, ['command', 'safeMode'])
      && value.command === 'SET_SAFE_MODE'
      && value.safeMode === 'READ_ONLY';
  }
  if (controlId === 'global.kill-switch.engage') {
    return exactKeys(value, ['command', 'engaged'])
      && value.command === 'SET_KILL_SWITCH'
      && value.engaged === true;
  }
  if (controlId === 'global.intake.pause') {
    return exactKeys(value, ['command', 'paused'])
      && value.command === 'SET_INTAKE_PAUSED'
      && value.paused === true;
  }
  if (controlId === 'strategy.basis.intake') {
    return exactKeys(value, ['command', 'paused'])
      && value.command === 'SET_BASIS_INTAKE'
      && typeof value.paused === 'boolean';
  }
  if (controlId === 'strategy.volume.intake') {
    return exactKeys(value, ['command', 'paused'])
      && value.command === 'SET_VOLUME_INTAKE'
      && typeof value.paused === 'boolean';
  }
  const focus = focusControlIdentity(controlId);
  if (focus !== null) {
    return exactKeys(value, ['command', 'symbol', 'pinned'])
      && value.command === 'PIN_FOCUS'
      && value.symbol === focus.symbol
      && value.pinned === focus.pinned;
  }
  return controlId === 'component.engine-supervisor.restart'
    && exactKeys(value, ['command', 'componentId'])
    && value.command === 'RESTART_COMPONENT'
    && value.componentId === 'market-universe';
}

function resultFromDurableReceipt(
  identity: Readonly<ProductRuntimeCommandResultIdentity>,
  status: ProductRuntimeControlResultStatus,
  before: Readonly<SystemControlState>,
  after: Readonly<SystemControlState>,
  completedAtMs: number,
  ledgerEventId: number | null,
): Readonly<ProductRuntimeControlResult> {
  const expected = commandIdentityFromParts(identity.idempotencyKey, identity.controlId);
  return Object.freeze({
    ...expected,
    controlId: identity.controlId,
    status,
    before: stateText(before),
    after: stateText(after),
    receiptId: receiptReference(ledgerEventId),
    completedAtMs,
    synthetic: false,
  });
}

function failClosedReadback(
  failureCode: string,
  result: Readonly<ProductRuntimeControlResult> | null = null,
): Readonly<ProductRuntimeCommandResultReadback> {
  return Object.freeze({ state: 'FAIL_CLOSED' as const, result, failureCode });
}

function result(
  request: Readonly<ProductRuntimeCommandRequest>,
  status: ProductRuntimeControlResultStatus,
  before: unknown,
  after: unknown,
  completedAtMs: number,
  receiptId: number | string | null = null,
): Readonly<ProductRuntimeControlResult> {
  const identity = commandIdentity(request);
  return Object.freeze({
    ...identity,
    controlId: request.controlId,
    status,
    before: stateText(before),
    after: stateText(after),
    receiptId: receiptReference(receiptId),
    completedAtMs,
    synthetic: false,
  });
}

function incidentCommandBinding(
  request: Readonly<ProductRuntimeCommandRequest>,
  operator: Readonly<ProductRuntimeCommandIntent['operator']>,
): Readonly<ProductIncidentCommandBinding> {
  const identity = commandIdentity(request);
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_COMMAND_SCHEMA,
    commandId: identity.commandId,
    controlId: request.controlId,
    backendCommandId: 'ACK_INCIDENT',
    targetType: 'INCIDENT',
    targetId: request.targetId,
    previewId: request.previewId,
    previewDigest: request.previewDigest,
    requestDigest: `sha256:${sha256({ request, operator })}`,
    expiresAtMs: request.expiresAtMs,
    correlationId: identity.correlationId,
  });
}

function incidentEvidenceMatchesCommand(
  evidence: Readonly<ProductIncidentAcknowledgementEvidence>,
  request: Readonly<ProductRuntimeCommandRequest>,
  operator: Readonly<ProductRuntimeCommandIntent['operator']>,
  binding: Readonly<ProductIncidentCommandBinding>,
): boolean {
  return evidence.command !== null
    && canonical(evidence.command) === canonical(binding)
    && evidence.incidentId === request.targetId
    && evidence.expectedLedgerEventId === Number(request.expectedRevision)
    && evidence.idempotencyKey === request.idempotencyKey
    && evidence.actor.id === operator.id
    && evidence.actor.source === operator.source
    && evidence.reason === request.reason
    && evidence.after.incidentId === request.targetId
    && evidence.after.ledgerEventId >= 1
    && evidence.receiptId === `ledger-event:${evidence.after.ledgerEventId}`;
}

function resultFromIncidentEvidence(
  identity: Readonly<ProductRuntimeCommandResultIdentity>,
  evidence: Readonly<ProductIncidentAcknowledgementEvidence>,
  status: Extract<ProductRuntimeControlResultStatus, 'APPLIED' | 'ALREADY_APPLIED'>,
): Readonly<ProductRuntimeControlResult> {
  const expected = commandIdentityFromParts(identity.idempotencyKey, identity.controlId);
  return Object.freeze({
    ...expected,
    controlId: identity.controlId,
    status,
    before: stateText(evidence.before),
    after: stateText(evidence.after),
    receiptId: evidence.receiptId,
    completedAtMs: evidence.acknowledgedAtMs,
    synthetic: false,
  });
}

function failureStatus(code: string, retryable: boolean): ProductRuntimeControlResultStatus {
  if (code === 'STALE_COMMAND_REVISION' || code === 'COMMAND_REVISION_REUSED' || code === 'STALE_SOURCE_REVISION') {
    return 'REJECTED_STALE_REVISION';
  }
  if (code === 'OPERATOR_REQUIRED' || code === 'LIVE_EXECUTION_NOT_IMPLEMENTED') return 'REJECTED_AUTHORITY';
  if (code === 'FOCUS_SYMBOL_INELIGIBLE' || code === 'FOCUS_CAPACITY_UNAVAILABLE') return 'REJECTED_BOUNDS';
  if (code.includes('NOT_SUPPORTED') || code === 'COMMAND_NOT_APPLICABLE') return 'REJECTED_NOT_SUPPORTED';
  if (code === 'CONTROL_PERSISTENCE_UNAVAILABLE') return retryable ? 'FAILED_RECOVERABLE' : 'FAILED_ATTENTION_REQUIRED';
  if (code === 'CONTROL_COMMITTED_RUNTIME_PENDING' || code === 'SOURCE_CONTROL_EFFECT_PENDING') return 'FAILED_ATTENTION_REQUIRED';
  if (code.includes('INVALID') || code.includes('IDEMPOTENCY')) return 'REJECTED_SCHEMA';
  if (code.includes('UNAVAILABLE') || code.includes('DEPENDENCY')) return 'REJECTED_DEPENDENCY';
  return 'REJECTED_STATE';
}

function capability(
  sourceIsolationConfigured: boolean,
  strategyIntakeConfigured: boolean,
  attentionFocusConfigured: boolean,
  incidentAcknowledgementConfigured: boolean,
): Readonly<ProductRuntimeCommandOwnerCapability> {
  const supportedBackendCommandIds: ProductRuntimeSafeBackendCommand[] = [
    'SET_SAFE_MODE',
    'SET_KILL_SWITCH',
    'SET_INTAKE_PAUSED',
    'RESTART_COMPONENT',
    ...(sourceIsolationConfigured ? ['SET_PUBLIC_SOURCE_LIFECYCLE' as const] : []),
    ...(strategyIntakeConfigured ? ['SET_BASIS_INTAKE' as const, 'SET_VOLUME_INTAKE' as const] : []),
    ...(attentionFocusConfigured ? ['PIN_FOCUS' as const] : []),
    ...(incidentAcknowledgementConfigured ? ['ACK_INCIDENT' as const] : []),
  ];
  return Object.freeze({
    ownerId: 'systemIntegration.canonical-control-service',
    supportedBackendCommandIds: Object.freeze(supportedBackendCommandIds),
    serverDerivedActor: true,
    durableIdempotency: true,
    revisionCompareAndSet: true,
    durableReceipts: true,
    managedRestartComponentId: 'engine-supervisor',
  });
}

export class ProductRuntimeSystemControlCommandOwner implements ProductRuntimeCommandOwnerPort {
  readonly capability: Readonly<ProductRuntimeCommandOwnerCapability>;
  private readonly controls: ProductRuntimeSystemControlCommandOwnerDependencies['controls'];
  private readonly sourceIsolation: SourceIsolationOwnerPort | undefined;
  private readonly strategyIntake: ProductRuntimeSystemControlCommandOwnerDependencies['strategyIntake'];
  private readonly attentionFocus: ProductRuntimeSystemControlCommandOwnerDependencies['attentionFocus'];
  private readonly incidents: ProductRuntimeSystemControlCommandOwnerDependencies['incidents'];

  constructor(dependencies: Readonly<ProductRuntimeSystemControlCommandOwnerDependencies>) {
    if (!dependencies?.controls
      || typeof dependencies.controls.snapshot !== 'function'
      || typeof dependencies.controls.mutate !== 'function'
      || typeof dependencies.controls.readResult !== 'function') {
      throw new TypeError('Product command owner requires the canonical SystemControlService.');
    }
    if (dependencies.sourceIsolation && (
      typeof dependencies.sourceIsolation.canApply !== 'function'
      || typeof dependencies.sourceIsolation.apply !== 'function'
      || typeof dependencies.sourceIsolation.snapshot !== 'function'
      || typeof dependencies.sourceIsolation.readEffect !== 'function'
      || typeof dependencies.sourceIsolation.pendingAction !== 'function'
      || typeof dependencies.sourceIsolation.readResult !== 'function'
    )) throw new TypeError('Product command owner source lifecycle dependency is invalid.');
    if (dependencies.strategyIntake && typeof dependencies.strategyIntake.readState !== 'function') {
      throw new TypeError('Product command owner strategy intake dependency is invalid.');
    }
    if (dependencies.attentionFocus && (typeof dependencies.attentionFocus.readState !== 'function'
      || typeof dependencies.attentionFocus.readPinnedSymbols !== 'function')) {
      throw new TypeError('Product command owner focus dependency is invalid.');
    }
    if (dependencies.incidents && (
      typeof dependencies.incidents.readIncident !== 'function'
      || typeof dependencies.incidents.acknowledge !== 'function'
      || typeof dependencies.incidents.readCommandAcknowledgement !== 'function'
    )) throw new TypeError('Product command owner incident acknowledgement dependency is invalid.');
    this.controls = dependencies.controls;
    this.sourceIsolation = dependencies.sourceIsolation;
    this.strategyIntake = dependencies.strategyIntake;
    this.attentionFocus = dependencies.attentionFocus;
    this.incidents = dependencies.incidents;
    this.capability = capability(
      this.sourceIsolation !== undefined,
      this.strategyIntake !== undefined,
      this.attentionFocus !== undefined,
      this.incidents !== undefined,
    );
  }

  readFocusPinnedSymbols(): readonly string[] {
    if (!this.attentionFocus) return Object.freeze([]);
    try {
      const symbols = this.attentionFocus.readPinnedSymbols();
      if (!Array.isArray(symbols) || symbols.length > 25
        || symbols.some((symbol) => typeof symbol !== 'string' || !/^[A-Z0-9]{4,20}$/.test(symbol))
        || new Set(symbols).size !== symbols.length) {
        return Object.freeze([]);
      }
      return Object.freeze([...symbols].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
    } catch {
      return Object.freeze([]);
    }
  }

  readFocusControlState(symbol: string): Readonly<SystemFocusPinReadback> | null {
    if (!this.attentionFocus || !/^[A-Z0-9]{4,20}$/.test(symbol)) return null;
    try {
      const state = this.attentionFocus.readState(symbol);
      if (!plainObject(state) || !exactKeys(state, [
        'symbol', 'desiredPinned', 'ownerPinned', 'eligible', 'canPin', 'effectivePinned',
        'effectiveTier', 'attentionPlanId', 'attentionPlanAtMs', 'pinCount', 'pinCapacity',
        'controlRevision', 'state',
      ]) || state.symbol !== symbol || typeof state.desiredPinned !== 'boolean'
        || !(state.ownerPinned === null || typeof state.ownerPinned === 'boolean')
        || !(state.eligible === null || typeof state.eligible === 'boolean')
        || !(state.canPin === null || typeof state.canPin === 'boolean')
        || (state.canPin === true && state.eligible !== true)
        || !(state.effectivePinned === null || typeof state.effectivePinned === 'boolean')
        || !(state.effectiveTier === null
          || ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS', 'RELEASED'].includes(String(state.effectiveTier)))
        || !(state.attentionPlanId === null
          || typeof state.attentionPlanId === 'string'
          && state.attentionPlanId.trim().length > 0
          && state.attentionPlanId.length <= 256)
        || !(state.attentionPlanAtMs === null || utcMillis(state.attentionPlanAtMs))
        || (state.attentionPlanId === null) !== (state.attentionPlanAtMs === null)
        || !(state.pinCount === null || Number.isSafeInteger(state.pinCount) && Number(state.pinCount) >= 0)
        || !(state.pinCapacity === null || Number.isSafeInteger(state.pinCapacity) && Number(state.pinCapacity) >= 1)
        || (state.pinCount === null) !== (state.pinCapacity === null)
        || (typeof state.pinCount === 'number' && typeof state.pinCapacity === 'number'
          && state.pinCount > state.pinCapacity)
        || (state.ownerPinned === true && typeof state.pinCount === 'number' && state.pinCount < 1)
        || (state.effectivePinned === true
          && (state.ownerPinned !== true || !['FOCUS', 'DEEP_FOCUS'].includes(String(state.effectiveTier))))
        || !Number.isSafeInteger(state.controlRevision) || state.controlRevision < 0
        || !['APPLIED', 'UNAVAILABLE', 'OWNER_NOT_WIRED'].includes(String(state.state))
        || (state.state === 'APPLIED' && (
          state.ownerPinned !== state.desiredPinned
          || (state.desiredPinned && (state.eligible !== true || state.effectivePinned !== true))
          || (!state.desiredPinned && state.effectivePinned === true)
        ))
        || (state.state === 'OWNER_NOT_WIRED' && [
          state.ownerPinned, state.eligible, state.canPin, state.effectivePinned,
          state.effectiveTier, state.attentionPlanId, state.attentionPlanAtMs,
          state.pinCount, state.pinCapacity,
        ].some((value) => value !== null))) return null;
      return Object.freeze({ ...state });
    } catch {
      return null;
    }
  }

  readIncidentControlState(incidentId: string): Readonly<{
    incidentId: string;
    ledgerEventId: number;
    state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    rootComponentId: string;
    eventCount: number;
    acknowledgedAtMs: number | null;
    resolvedAtMs: number | null;
  }> | null {
    if (!this.incidents) return null;
    try {
      const incident = this.incidents.readIncident(incidentId);
      if (incident === null || incident.incidentId !== incidentId
        || !Number.isSafeInteger(incident.ledgerEventId) || incident.ledgerEventId < 1
        || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(incident.state)
        || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(incident.severity)
        || typeof incident.rootComponentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(incident.rootComponentId)
        || !Number.isSafeInteger(incident.eventCount) || incident.eventCount < 1
        || !(incident.acknowledgedAtMs === null || utcMillis(incident.acknowledgedAtMs))
        || !(incident.resolvedAtMs === null || utcMillis(incident.resolvedAtMs))) return null;
      return Object.freeze({
        incidentId: incident.incidentId,
        ledgerEventId: incident.ledgerEventId,
        state: incident.state as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED',
        severity: incident.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
        rootComponentId: incident.rootComponentId,
        eventCount: incident.eventCount,
        acknowledgedAtMs: incident.acknowledgedAtMs,
        resolvedAtMs: incident.resolvedAtMs,
      });
    } catch {
      return null;
    }
  }

  readStrategyIntakeControlState(strategy: 'basis' | 'volume'): Readonly<{
    controlRevision: number;
    desiredPaused: boolean;
    effectivePaused: boolean | null;
    state: 'APPLIED' | 'EFFECT_UNAVAILABLE' | 'OWNER_NOT_WIRED';
  }> | null {
    if (!this.strategyIntake) return null;
    try {
      const readback = this.strategyIntake.readState(strategy);
      if (!readback || readback.strategy !== strategy
        || !Number.isSafeInteger(readback.controlRevision) || readback.controlRevision < 0
        || typeof readback.desiredPaused !== 'boolean'
        || !(readback.effectivePaused === null || typeof readback.effectivePaused === 'boolean')
        || !['APPLIED', 'EFFECT_UNAVAILABLE', 'OWNER_NOT_WIRED'].includes(readback.state)) return null;
      return Object.freeze({
        controlRevision: readback.controlRevision,
        desiredPaused: readback.desiredPaused,
        effectivePaused: readback.effectivePaused,
        state: readback.state,
      });
    } catch {
      return null;
    }
  }

  readSourceControlState(sourceId: IsolatablePublicSourceId): Readonly<{
    sourceRevision: number;
    desiredLifecycle: 'LIVE' | 'ISOLATED';
    observedLifecycle: string;
    pendingAction: SourceIsolationAction | null;
  }> | null {
    if (!this.sourceIsolation) return null;
    try {
      const snapshot = this.sourceIsolation.snapshot(sourceId);
      return Object.freeze({
        sourceRevision: snapshot.sourceRevision,
        desiredLifecycle: snapshot.desiredLifecycle,
        observedLifecycle: snapshot.observedLifecycle,
        pendingAction: this.sourceIsolation.pendingAction(sourceId),
      });
    } catch {
      return null;
    }
  }

  private currentState(
    resolved: Readonly<ResolvedControlIntent>,
  ): Readonly<SystemControlState> | Readonly<SourceIsolationSnapshot> | Readonly<ProductIncidentRecord> {
    if (resolved.kind === 'SYSTEM') return this.controls.snapshot();
    if (resolved.kind === 'INCIDENT') {
      if (!this.incidents) throw new Error('Product incident acknowledgement owner is not configured.');
      const incident = this.incidents.readIncident(resolved.incidentId);
      if (incident === null) throw new Error('Product incident does not exist.');
      return incident;
    }
    if (!this.sourceIsolation) throw new Error('Product source control owner is not configured.');
    return this.sourceIsolation.snapshot(resolved.sourceId);
  }

  async authorizePendingReplay(input: Readonly<{
    request: Readonly<ProductRuntimeCommandRequest>;
    intent: Readonly<ProductRuntimeCommandIntent>;
  }>): Promise<boolean> {
    if (!plainObject(input) || !exactKeys(input, ['request', 'intent']) || !validRequest(input.request)) return false;
    const { request, intent } = input;
    const resolved = resolveIntent(intent);
    if (resolved === null || resolved.kind !== 'SYSTEM'
      || !IDEMPOTENCY_KEY.test(request.idempotencyKey)
      || !CONTROL_ID.test(request.controlId)
      || request.controlId !== intent.controlId
      || request.backendCommandId !== intent.backendCommandId
      || request.targetType !== intent.targetType
      || request.targetId !== intent.targetId
      || canonical(request.payload) !== canonical(intent.payload)
      || request.currentRevision !== request.expectedRevision
      || request.expectedRevision !== intent.expectedRevision
      || !DIGEST.test(request.previewDigest)
      || !PREVIEW_ID.test(request.previewId)) return false;
    const previewIssuedAtMs = request.expiresAtMs - PREVIEW_TTL_MS;
    if (!utcMillis(previewIssuedAtMs)) return false;
    const expectedPreview = buildPreview(intent, resolved, request.expiresAtMs);
    if (!constantTimeTextEqual(request.previewDigest, expectedPreview.digest)
      || !constantTimeTextEqual(request.previewId, expectedPreview.previewId)) return false;

    let stored;
    try { stored = await this.controls.readResult(request.idempotencyKey); } catch { return false; }
    if (stored === null
      || stored.runtimePublication !== 'PENDING'
      || typeof stored.requestDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(stored.requestDigest)
      || stored.correlationId !== commandIdentity(request).correlationId
      || !utcMillis(stored.recordedAtMs)
      || stored.recordedAtMs < previewIssuedAtMs
      || stored.recordedAtMs >= request.expiresAtMs
      || stored.mutation === null
      || canonical(stored.mutation) !== canonical(resolved.mutation)
      || !mutationMatchesControl(request.controlId, stored.mutation)
      || stored.receipt.applied !== true
      || stored.receipt.before.revision !== resolved.revision
      || stored.receipt.after.revision !== resolved.revision + 1
      || stored.receipt.after.correlationId !== stored.correlationId
      || !Number.isSafeInteger(stored.receipt.ledgerEventId)
      || Number(stored.receipt.ledgerEventId) < 1) return false;
    const systemRequest: Readonly<SystemControlMutationRequest> = Object.freeze({
      idempotencyKey: request.idempotencyKey,
      expectedRevision: resolved.revision,
      reason: request.reason,
      requestedAtMs: stored.recordedAtMs,
      correlationId: stored.correlationId,
      mutation: resolved.mutation,
    });
    return constantTimeTextEqual(stored.requestDigest, controlRequestDigest(systemRequest));
  }

  async preview(intent: Readonly<ProductRuntimeCommandIntent>): Promise<Readonly<ProductRuntimeControlPreview>> {
    const resolved = resolveIntent(intent);
    if (!resolved) throw new TypeError('Product control preview intent is invalid or unsupported.');
    const current = this.currentState(resolved);
    const currentRevision = resolved.kind === 'SYSTEM'
      ? (current as SystemControlState).revision
      : resolved.kind === 'SOURCE'
        ? (current as SourceIsolationSnapshot).sourceRevision
        : (current as ProductIncidentRecord).ledgerEventId;
    if (resolved.revision !== currentRevision) throw new Error('Product control preview revision is stale.');
    if (resolved.kind === 'SOURCE') {
      if (!this.sourceIsolation) throw new Error('Product source control owner is not configured.');
      const applicable = this.sourceIsolation.canApply(resolved.sourceId, resolved.action, resolved.revision);
      if (!applicable.ok) throw new Error(`Product source control is not applicable: ${applicable.code}`);
    }
    if (resolved.kind === 'SYSTEM' && resolved.mutation.command === 'PIN_FOCUS') {
      const state = this.readFocusControlState(resolved.mutation.symbol);
      if (state === null || state.controlRevision !== resolved.revision
        || (resolved.mutation.pinned
          && (state.state !== 'APPLIED' || state.eligible !== true || state.canPin !== true))) {
        throw new Error('Product focus control is not applicable to current canonical attention truth.');
      }
    }
    if (resolved.kind === 'INCIDENT' && (current as ProductIncidentRecord).state !== 'OPEN') {
      throw new Error('Product incident acknowledgement is only previewable from OPEN.');
    }
    const expiresAtMs = intent.nowMs + PREVIEW_TTL_MS;
    if (!utcMillis(expiresAtMs)) throw new RangeError('Product control preview expiry exceeds its UTC bound.');
    return buildPreview(intent, resolved, expiresAtMs);
  }

  async submit(input: Readonly<{
    request: Readonly<ProductRuntimeCommandRequest>;
    intent: Readonly<ProductRuntimeCommandIntent>;
  }>): Promise<Readonly<ProductRuntimeControlResult>> {
    if (!plainObject(input) || !exactKeys(input, ['request', 'intent']) || !validRequest(input.request)) {
      throw new TypeError('Product control submission envelope is invalid.');
    }
    const request = input.request;
    const resolved = resolveIntent(input.intent);
    if (!resolved) throw new TypeError('Product control submission intent is invalid or unsupported.');
    const before = this.currentState(resolved);
    const pendingReplay = request.expiresAtMs <= input.intent.nowMs
      ? await this.authorizePendingReplay(input)
      : false;
    if (request.expiresAtMs <= input.intent.nowMs && !pendingReplay) {
      return result(request, 'EXPIRED', before, before, input.intent.nowMs);
    }
    if (request.expiresAtMs - input.intent.nowMs > PREVIEW_TTL_MS
      || request.controlId !== input.intent.controlId
      || request.backendCommandId !== input.intent.backendCommandId
      || request.targetType !== input.intent.targetType
      || request.targetId !== input.intent.targetId
      || canonical(request.payload) !== canonical(input.intent.payload)
      || request.currentRevision !== request.expectedRevision
      || request.expectedRevision !== input.intent.expectedRevision
      || !DIGEST.test(request.previewDigest)
      || !PREVIEW_ID.test(request.previewId)) {
      return result(request, 'REJECTED_AUTHORITY', before, before, input.intent.nowMs);
    }
    const expectedPreview = buildPreview(input.intent, resolved, request.expiresAtMs);
    if (!constantTimeTextEqual(request.previewDigest, expectedPreview.digest)
      || !constantTimeTextEqual(request.previewId, expectedPreview.previewId)) {
      return result(request, 'REJECTED_AUTHORITY', before, before, input.intent.nowMs);
    }

    if (resolved.kind === 'INCIDENT') {
      if (!this.incidents) throw new Error('Product incident acknowledgement owner is not configured.');
      const binding = incidentCommandBinding(request, input.intent.operator);
      let existing: Readonly<ProductIncidentAcknowledgementEvidence> | null;
      try {
        existing = this.incidents.readCommandAcknowledgement(request.idempotencyKey, request.controlId);
      } catch {
        return result(request, 'FAILED_ATTENTION_REQUIRED', before, before, input.intent.nowMs);
      }
      if (existing !== null) {
        if (!incidentEvidenceMatchesCommand(existing, request, input.intent.operator, binding)) {
          return result(request, 'REJECTED_SCHEMA', before, before, input.intent.nowMs);
        }
        return resultFromIncidentEvidence(
          Object.freeze({ ...commandIdentity(request), idempotencyKey: request.idempotencyKey, controlId: request.controlId }),
          existing,
          'ALREADY_APPLIED',
        );
      }

      const acknowledgementRequest: Readonly<ProductIncidentAcknowledgementRequest> = Object.freeze({
        incidentId: resolved.incidentId,
        expectedLedgerEventId: resolved.revision,
        idempotencyKey: request.idempotencyKey,
        actor: Object.freeze({ id: input.intent.operator.id, source: input.intent.operator.source }),
        acknowledgedAtMs: input.intent.nowMs,
        reason: request.reason,
      });
      let acknowledged: Readonly<ProductIncidentAcknowledgementResult>;
      try {
        acknowledged = this.incidents.acknowledge(acknowledgementRequest, binding);
      } catch {
        return result(request, 'FAILED_ATTENTION_REQUIRED', before, before, input.intent.nowMs);
      }
      if (!acknowledged.ok) {
        const status: ProductRuntimeControlResultStatus = acknowledged.code === 'INCIDENT_REVISION_CONFLICT'
          ? 'REJECTED_STALE_REVISION'
          : acknowledged.code === 'ACK_REQUEST_INVALID'
              || acknowledged.code === 'INCIDENT_ACK_IDEMPOTENCY_CONFLICT'
            ? 'REJECTED_SCHEMA'
            : acknowledged.code === 'INCIDENT_PERSISTENCE_UNAVAILABLE'
                || acknowledged.code === 'INCIDENT_ACK_READBACK_UNPROVEN'
              ? 'FAILED_ATTENTION_REQUIRED'
              : 'REJECTED_STATE';
        return result(request, status, before, before, input.intent.nowMs);
      }
      let evidence: Readonly<ProductIncidentAcknowledgementEvidence> | null;
      try {
        evidence = this.incidents.readCommandAcknowledgement(request.idempotencyKey, request.controlId);
      } catch {
        return result(request, 'FAILED_ATTENTION_REQUIRED', before, before, input.intent.nowMs);
      }
      if (evidence === null || !incidentEvidenceMatchesCommand(evidence, request, input.intent.operator, binding)) {
        return result(request, 'FAILED_ATTENTION_REQUIRED', before, before, input.intent.nowMs);
      }
      return resultFromIncidentEvidence(
        Object.freeze({ ...commandIdentity(request), idempotencyKey: request.idempotencyKey, controlId: request.controlId }),
        evidence,
        acknowledged.status === 'ALREADY_ACKNOWLEDGED' ? 'ALREADY_APPLIED' : 'APPLIED',
      );
    }

    if (resolved.kind === 'SOURCE') {
      if (!this.sourceIsolation) throw new Error('Product source control owner is not configured.');
      let sourceResult;
      try {
        sourceResult = await this.sourceIsolation.apply(Object.freeze({
          idempotencyKey: request.idempotencyKey,
          sourceId: resolved.sourceId,
          action: resolved.action,
          expectedSourceRevision: resolved.revision,
          requestedAtMs: input.intent.nowMs,
          reason: request.reason,
          actor: input.intent.operator,
        }));
      } catch {
        return result(request, 'FAILED_ATTENTION_REQUIRED', before, before, input.intent.nowMs);
      }
      if (!sourceResult.ok) {
        let after: Readonly<SourceIsolationSnapshot> | Readonly<SystemControlState> = before as Readonly<SourceIsolationSnapshot>;
        try { after = this.sourceIsolation.snapshot(resolved.sourceId); } catch { /* Fail closed on the before image. */ }
        const retryable = sourceResult.code.includes('PERSISTENCE')
          || sourceResult.code.includes('CAS')
          || sourceResult.code.includes('PENDING');
        return result(
          request,
          failureStatus(sourceResult.code, retryable),
          before,
          after,
          input.intent.nowMs,
          sourceResult.receiptId ?? null,
        );
      }
      return result(
        request,
        sourceResult.status === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED' : 'APPLIED',
        before,
        sourceResult.snapshot,
        input.intent.nowMs,
        sourceResult.receiptId,
      );
    }

    const identity = commandIdentity(request);
    const mutationResult = await this.controls.mutate(Object.freeze({
      idempotencyKey: request.idempotencyKey,
      expectedRevision: resolved.revision,
      reason: request.reason,
      requestedAtMs: input.intent.nowMs,
      correlationId: identity.correlationId,
      mutation: resolved.mutation,
    }), input.intent.operator);
    if (!mutationResult.ok) {
      const after = this.controls.snapshot();
      return result(
        request,
        failureStatus(mutationResult.failure.code, mutationResult.failure.retryable),
        before,
        after,
        input.intent.nowMs,
      );
    }
    const receipt = mutationResult.value;
    if (!Number.isSafeInteger(receipt.ledgerEventId) || (receipt.ledgerEventId as number) < 1) {
      return result(request, 'FAILED_ATTENTION_REQUIRED', receipt.before, receipt.after, receipt.after.updatedAtMs);
    }
    const replay = (before as SystemControlState).revision !== receipt.before.revision;
    const status: ProductRuntimeControlResultStatus = replay || !receipt.applied
      ? 'ALREADY_APPLIED'
      : resolved.mutation.command === 'RESTART_COMPONENT'
        ? 'ACCEPTED_ASYNC'
        : 'APPLIED';
    return result(
      request,
      status,
      receipt.before,
      receipt.after,
      receipt.after.updatedAtMs,
      receipt.ledgerEventId,
    );
  }

  async readResult(
    identity: Readonly<ProductRuntimeCommandResultIdentity>,
  ): Promise<Readonly<ProductRuntimeCommandResultReadback>> {
    if (!plainObject(identity) || !exactKeys(identity, ['commandId', 'idempotencyKey', 'controlId'])
      || typeof identity.commandId !== 'string' || !COMMAND_ID.test(identity.commandId)
      || typeof identity.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(identity.idempotencyKey)
      || typeof identity.controlId !== 'string' || !CONTROL_ID.test(identity.controlId)) {
      return failClosedReadback('COMMAND_RESULT_IDENTITY_INVALID');
    }
    const expected = commandIdentityFromParts(identity.idempotencyKey, identity.controlId);
    if (!constantTimeTextEqual(identity.commandId, expected.commandId)) {
      return failClosedReadback('COMMAND_RESULT_IDENTITY_MISMATCH');
    }

    if (/^incident\.ack\.[a-f0-9]{64}$/.test(identity.controlId)) {
      if (!this.incidents) return failClosedReadback('INCIDENT_RESULT_OWNER_NOT_CONFIGURED');
      let evidence: Readonly<ProductIncidentAcknowledgementEvidence> | null;
      try {
        evidence = this.incidents.readCommandAcknowledgement(identity.idempotencyKey, identity.controlId);
      } catch {
        return failClosedReadback('INCIDENT_RESULT_OWNER_UNAVAILABLE');
      }
      if (evidence === null) {
        return Object.freeze({ state: 'NOT_FOUND' as const, result: null, failureCode: null });
      }
      const command = evidence.command;
      if (command === null
        || command.schemaVersion !== PRODUCT_RUNTIME_COMMAND_SCHEMA
        || command.commandId !== expected.commandId
        || command.controlId !== identity.controlId
        || command.backendCommandId !== 'ACK_INCIDENT'
        || command.targetType !== 'INCIDENT'
        || command.controlId !== productIncidentAcknowledgementControlId(command.targetId)
        || command.correlationId !== expected.correlationId
        || evidence.idempotencyKey !== identity.idempotencyKey
        || evidence.incidentId !== command.targetId
        || evidence.after.incidentId !== command.targetId
        || evidence.after.acknowledgedAtMs !== evidence.acknowledgedAtMs
        || evidence.after.state !== 'ACKNOWLEDGED'
        || evidence.receiptId !== `ledger-event:${evidence.after.ledgerEventId}`) {
        return failClosedReadback('DURABLE_INCIDENT_RECEIPT_INVALID');
      }
      return Object.freeze({
        state: 'TERMINAL' as const,
        result: resultFromIncidentEvidence(identity, evidence, 'APPLIED'),
        failureCode: null,
      });
    }

    const sourceId = sourceIdForControl(identity.controlId);
    if (sourceId !== null) {
      if (!this.sourceIsolation) return failClosedReadback('SOURCE_RESULT_OWNER_NOT_CONFIGURED');
      let sourceReadback;
      try { sourceReadback = this.sourceIsolation.readResult(identity.idempotencyKey); } catch {
        return failClosedReadback('SOURCE_RESULT_OWNER_UNAVAILABLE');
      }
      if (sourceReadback.state === 'NOT_FOUND') {
        return Object.freeze({ state: 'NOT_FOUND' as const, result: null, failureCode: null });
      }
      if (sourceReadback.state === 'FAIL_CLOSED') {
        return failClosedReadback(sourceReadback.failureCode);
      }
      const receipt = sourceReadback.receipt;
      const snapshot = sourceReadback.snapshot;
      if (receipt.idempotencyKey !== identity.idempotencyKey
        || receipt.sourceId !== sourceId
        || typeof receipt.receiptId !== 'string' || !/^source-control:sha256:[a-f0-9]{64}$/.test(receipt.receiptId)
        || typeof receipt.requestDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(receipt.requestDigest)
        || !utcMillis(receipt.requestedAtMs)
        || !validSourceSnapshot(receipt.before, sourceId)
        || !validSourceSnapshot(snapshot, sourceId)
        || (sourceReadback.state === 'TERMINAL' && (
          receipt.effectState !== 'APPLIED'
          || receipt.after === null
          || !validSourceSnapshot(receipt.after, sourceId)
          || receipt.completedAtMs === null
          || !utcMillis(receipt.completedAtMs)
        ))
        || (sourceReadback.state === 'PENDING' && (
          receipt.effectState !== 'PENDING'
          || receipt.after !== null
          || receipt.completedAtMs !== null
        ))) {
        return failClosedReadback('DURABLE_SOURCE_RECEIPT_INVALID');
      }
      const readback = resultFromSourceReceipt(
        identity,
        sourceReadback.state === 'PENDING' ? 'ACCEPTED_ASYNC' : 'APPLIED',
        receipt,
        snapshot,
      );
      return Object.freeze({
        state: sourceReadback.state,
        result: readback,
        failureCode: null,
      });
    }

    let stored;
    try {
      stored = await this.controls.readResult(identity.idempotencyKey);
    } catch {
      return failClosedReadback('COMMAND_RESULT_PERSISTENCE_UNAVAILABLE');
    }
    if (stored === null) {
      return Object.freeze({ state: 'NOT_FOUND' as const, result: null, failureCode: null });
    }
    if (!plainObject(stored)
      || typeof stored.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(stored.requestDigest)
      || stored.correlationId !== expected.correlationId
      || !utcMillis(stored.recordedAtMs)
      || !mutationMatchesControl(identity.controlId, stored.mutation)
      || !['NOT_REQUIRED', 'PENDING', 'PUBLISHED', 'UNKNOWN'].includes(String(stored.runtimePublication))
      || !plainObject(stored.receipt)
      || typeof stored.receipt.applied !== 'boolean'
      || typeof stored.receipt.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(stored.receipt.code)
      || !validControlState(stored.receipt.before)
      || !validControlState(stored.receipt.after)
      || !(stored.receipt.ledgerEventId === null
        || (Number.isSafeInteger(stored.receipt.ledgerEventId) && Number(stored.receipt.ledgerEventId) >= 1))) {
      return failClosedReadback('DURABLE_COMMAND_RECEIPT_INVALID');
    }

    const receipt = stored.receipt;
    const mutation = stored.mutation as Readonly<SystemControlMutation>;
    const restartPublication = mutation.command === 'RESTART_COMPONENT';
    const requiresPublication = restartPublication
      || mutation.command === 'SET_BASIS_INTAKE'
      || mutation.command === 'SET_VOLUME_INTAKE'
      || mutation.command === 'PIN_FOCUS';
    const transitionValid = receipt.applied
      ? receipt.after.revision === receipt.before.revision + 1
        && receipt.after.correlationId === expected.correlationId
        && (restartPublication
          ? receipt.after.generation === receipt.before.generation + 1
          : receipt.after.generation === receipt.before.generation)
      : canonical(receipt.after) === canonical(receipt.before);
    const publicationValid = receipt.applied
      ? requiresPublication
        ? stored.runtimePublication !== 'NOT_REQUIRED'
        : stored.runtimePublication === 'NOT_REQUIRED'
      : stored.runtimePublication === 'NOT_REQUIRED';
    if (!transitionValid || !publicationValid) {
      return failClosedReadback('DURABLE_COMMAND_RECEIPT_INCONSISTENT');
    }

    const ledgerEventId = receipt.ledgerEventId as number | null;
    if (ledgerEventId === null) {
      return failClosedReadback(
        'DURABLE_COMMAND_RECEIPT_REFERENCE_MISSING',
        resultFromDurableReceipt(
          identity,
          'FAILED_ATTENTION_REQUIRED',
          receipt.before,
          receipt.after,
          stored.recordedAtMs,
          null,
        ),
      );
    }
    if (stored.runtimePublication === 'UNKNOWN') {
      return failClosedReadback(
        'COMMAND_RUNTIME_PUBLICATION_UNKNOWN',
        resultFromDurableReceipt(
          identity,
          'FAILED_ATTENTION_REQUIRED',
          receipt.before,
          receipt.after,
          stored.recordedAtMs,
          ledgerEventId,
        ),
      );
    }
    const pending = stored.runtimePublication === 'PENDING';
    const readback = resultFromDurableReceipt(
      identity,
      pending ? 'ACCEPTED_ASYNC' : receipt.applied ? 'APPLIED' : 'ALREADY_APPLIED',
      receipt.before,
      receipt.after,
      stored.recordedAtMs,
      ledgerEventId,
    );
    return Object.freeze({
      state: pending ? 'PENDING' as const : 'TERMINAL' as const,
      result: readback,
      failureCode: null,
    });
  }
}

export function createProductRuntimeSystemControlCommandOwner(
  dependencies: Readonly<ProductRuntimeSystemControlCommandOwnerDependencies>,
): ProductRuntimeSystemControlCommandOwner {
  return new ProductRuntimeSystemControlCommandOwner(dependencies);
}
