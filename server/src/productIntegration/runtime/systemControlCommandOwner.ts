import { createHash, timingSafeEqual } from 'node:crypto';

import type { SystemControlMutation, SystemControlState } from '../../systemIntegration/contracts/index.js';
import type { SystemControlService } from '../../systemIntegration/controls/index.js';
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

interface ResolvedControlIntent {
  readonly revision: number;
  readonly mutation: Readonly<SystemControlMutation>;
  readonly consequence: string;
}

export interface ProductRuntimeSystemControlCommandOwnerDependencies {
  /** The one canonical service; this adapter owns no control state or receipt store. */
  readonly controls: Pick<SystemControlService, 'snapshot' | 'mutate' | 'readResult'>;
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
      revision,
      mutation: Object.freeze({ command: 'SET_INTAKE_PAUSED', paused: true }),
      consequence: 'New intake pauses while reconciliation and supervision remain available.',
    });
  }
  if (value.controlId === 'component.engine-supervisor.restart'
    && value.backendCommandId === 'RESTART_COMPONENT'
    && value.targetType === 'COMPONENT'
    && value.targetId === 'engine-supervisor'
    && exactPayload(value.payload, { componentId: 'engine-supervisor' })) {
    return Object.freeze({
      revision,
      // System Integration names the one dependency-root lifecycle target
      // `market-universe`; its publication restarts the whole managed graph.
      mutation: Object.freeze({ command: 'RESTART_COMPONENT', componentId: 'market-universe' }),
      consequence: 'The canonical dependency-root managed runtime restarts as one supervised graph.',
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
    mutation: resolved.mutation,
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

function stateText(state: Readonly<SystemControlState>): string {
  return canonical(state);
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
    receiptId: ledgerEventId === null ? null : `ledger-event:${ledgerEventId}`,
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
  before: Readonly<SystemControlState>,
  after: Readonly<SystemControlState>,
  completedAtMs: number,
  ledgerEventId: number | null = null,
): Readonly<ProductRuntimeControlResult> {
  const identity = commandIdentity(request);
  return Object.freeze({
    ...identity,
    controlId: request.controlId,
    status,
    before: stateText(before),
    after: stateText(after),
    receiptId: ledgerEventId === null ? null : `ledger-event:${ledgerEventId}`,
    completedAtMs,
    synthetic: false,
  });
}

function failureStatus(code: string, retryable: boolean): ProductRuntimeControlResultStatus {
  if (code === 'STALE_COMMAND_REVISION' || code === 'COMMAND_REVISION_REUSED') return 'REJECTED_STALE_REVISION';
  if (code === 'OPERATOR_REQUIRED' || code === 'LIVE_EXECUTION_NOT_IMPLEMENTED') return 'REJECTED_AUTHORITY';
  if (code.includes('NOT_SUPPORTED') || code === 'COMMAND_NOT_APPLICABLE') return 'REJECTED_NOT_SUPPORTED';
  if (code === 'CONTROL_PERSISTENCE_UNAVAILABLE') return retryable ? 'FAILED_RECOVERABLE' : 'FAILED_ATTENTION_REQUIRED';
  if (code === 'CONTROL_COMMITTED_RUNTIME_PENDING') return 'FAILED_ATTENTION_REQUIRED';
  if (code.includes('INVALID') || code.includes('IDEMPOTENCY')) return 'REJECTED_SCHEMA';
  if (code.includes('UNAVAILABLE') || code.includes('DEPENDENCY')) return 'REJECTED_DEPENDENCY';
  return 'REJECTED_STATE';
}

const CAPABILITY: Readonly<ProductRuntimeCommandOwnerCapability> = Object.freeze({
  ownerId: 'systemIntegration.canonical-control-service',
  supportedBackendCommandIds: Object.freeze([
    'SET_SAFE_MODE',
    'SET_KILL_SWITCH',
    'SET_INTAKE_PAUSED',
    'RESTART_COMPONENT',
  ] as const),
  serverDerivedActor: true,
  durableIdempotency: true,
  revisionCompareAndSet: true,
  durableReceipts: true,
  managedRestartComponentId: 'engine-supervisor',
});

export class ProductRuntimeSystemControlCommandOwner implements ProductRuntimeCommandOwnerPort {
  readonly capability = CAPABILITY;
  private readonly controls: ProductRuntimeSystemControlCommandOwnerDependencies['controls'];

  constructor(dependencies: Readonly<ProductRuntimeSystemControlCommandOwnerDependencies>) {
    if (!dependencies?.controls
      || typeof dependencies.controls.snapshot !== 'function'
      || typeof dependencies.controls.mutate !== 'function'
      || typeof dependencies.controls.readResult !== 'function') {
      throw new TypeError('Product command owner requires the canonical SystemControlService.');
    }
    this.controls = dependencies.controls;
  }

  async preview(intent: Readonly<ProductRuntimeCommandIntent>): Promise<Readonly<ProductRuntimeControlPreview>> {
    const resolved = resolveIntent(intent);
    if (!resolved) throw new TypeError('Product control preview intent is invalid or unsupported.');
    const current = this.controls.snapshot();
    if (resolved.revision !== current.revision) throw new Error('Product control preview revision is stale.');
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
    const before = this.controls.snapshot();
    if (request.expiresAtMs <= input.intent.nowMs) {
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
    const replay = before.revision !== receipt.before.revision;
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
    const requiresPublication = mutation.command === 'RESTART_COMPONENT';
    const transitionValid = receipt.applied
      ? receipt.after.revision === receipt.before.revision + 1
        && receipt.after.correlationId === expected.correlationId
        && (requiresPublication
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
