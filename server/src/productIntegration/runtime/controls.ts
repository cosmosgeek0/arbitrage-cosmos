import type { SystemSupervisorReadModel } from '../../systemIntegration/supervisor/types.js';
import {
  PRODUCT_RUNTIME_COMMAND_SCHEMA,
  PRODUCT_RUNTIME_SAFE_BACKEND_COMMANDS,
  ProductRuntimeError,
  type ProductRuntimeCommandIntent,
  type ProductRuntimeCommandOwnerPort,
  type ProductRuntimeCommandRequest,
  type ProductRuntimeCommandScalar,
  type ProductRuntimeControlPreview,
  type ProductRuntimeControlRegistryEntry,
  type ProductRuntimeControlResult,
  type ProductRuntimeOperator,
  type ProductRuntimeSafeBackendCommand,
} from './types.js';

const RESULT_STATUSES = new Set([
  'APPLIED', 'ACCEPTED_ASYNC', 'REJECTED_SCHEMA', 'REJECTED_BOUNDS', 'REJECTED_AUTHORITY',
  'REJECTED_STALE_REVISION', 'REJECTED_STATE', 'REJECTED_DEPENDENCY', 'REJECTED_EXPOSURE',
  'REJECTED_NOT_SUPPORTED', 'EXPIRED', 'ALREADY_APPLIED', 'FAILED_RECOVERABLE',
  'FAILED_ATTENTION_REQUIRED',
]);

function ownerBlocker(
  owner: Readonly<ProductRuntimeCommandOwnerPort> | undefined,
  command: ProductRuntimeSafeBackendCommand,
): string | null {
  if (!owner) return 'COMMAND_OWNER_NOT_CONFIGURED';
  const capability = owner.capability;
  if (!capability || typeof capability.ownerId !== 'string' || capability.ownerId.length === 0) return 'COMMAND_OWNER_ID_MISSING';
  if (!capability.serverDerivedActor) return 'SERVER_DERIVED_ACTOR_NOT_PROVEN';
  if (!capability.durableIdempotency) return 'DURABLE_IDEMPOTENCY_NOT_PROVEN';
  if (!capability.revisionCompareAndSet) return 'REVISION_CAS_NOT_PROVEN';
  if (!capability.durableReceipts) return 'DURABLE_RECEIPTS_NOT_PROVEN';
  if (typeof owner.readResult !== 'function') return 'DURABLE_RESULT_READBACK_NOT_PROVEN';
  if (!Array.isArray(capability.supportedBackendCommandIds)
      || capability.supportedBackendCommandIds.some((value) => !PRODUCT_RUNTIME_SAFE_BACKEND_COMMANDS.includes(value))) {
    return 'COMMAND_OWNER_CAPABILITY_INVALID';
  }
  if (!capability.supportedBackendCommandIds.includes(command)) return 'BACKEND_COMMAND_NOT_SUPPORTED';
  if (command === 'SET_PUBLIC_SOURCE_LIFECYCLE' && typeof owner.readSourceControlState !== 'function') {
    return 'SOURCE_CONTROL_READBACK_NOT_PROVEN';
  }
  if (command === 'RESTART_COMPONENT' && capability.managedRestartComponentId !== 'engine-supervisor') {
    return 'MANAGED_ROOT_RESTART_NOT_PROVEN';
  }
  return null;
}

function entry(
  snapshot: Readonly<SystemSupervisorReadModel>,
  owner: Readonly<ProductRuntimeCommandOwnerPort> | undefined,
  input: Readonly<{
    controlId: string;
    backendCommandId: ProductRuntimeSafeBackendCommand;
    targetType: 'SYSTEM' | 'COMPONENT';
    targetId: string;
    payload: Readonly<Record<string, ProductRuntimeCommandScalar>>;
    payloadSchema: string;
    payloadEnumeration: readonly ProductRuntimeCommandScalar[];
    defaultValue: ProductRuntimeCommandScalar;
    label: string;
    explanation: string;
    safeBounds: string;
    currentDesiredValue: string;
    currentEffectiveValue: string;
    effect: 'IMMEDIATE' | 'RESTART';
    reversibility: string;
    invariants: readonly string[];
    effectTelemetry: readonly string[];
    confirmationText: string;
    currentStateRevision?: string;
    forcedBlocker?: string;
  }>,
): Readonly<ProductRuntimeControlRegistryEntry> {
  const blocker = input.forcedBlocker ?? ownerBlocker(owner, input.backendCommandId);
  const { currentStateRevision, forcedBlocker: _forcedBlocker, ...publicInput } = input;
  return Object.freeze({
    ...publicInput,
    wiringState: blocker === null ? 'WIRED_LIVE' : `UNAVAILABLE:${blocker}`,
    owner: blocker === null ? owner!.capability.ownerId : 'systemIntegration canonical control owner',
    group: input.backendCommandId === 'SET_PUBLIC_SOURCE_LIFECYCLE'
      ? 'Source Lifecycle'
      : input.backendCommandId === 'RESTART_COMPONENT' ? 'Component Lifecycle' : 'Global Posture',
    authority: blocker === null ? 'SERVER_DERIVED_OPERATOR' : 'NOT_CONFIGURED',
    requiredPosture: input.backendCommandId === 'RESTART_COMPONENT' ? 'NO_CAPITAL_EXPOSED' : 'PROCESS_ALIVE',
    expiryPolicy: 'Canonical owner preview expiry is authoritative.',
    currentStateRevision: currentStateRevision ?? String(snapshot.control.revision),
    disabledReason: blocker === null ? null : blocker,
    preview: null,
    latestResult: null,
  });
}

type PublicSourceControlId = 'public-spot-source' | 'public-usdm-source';

function sourceLifecycleEntry(
  snapshot: Readonly<SystemSupervisorReadModel>,
  owner: Readonly<ProductRuntimeCommandOwnerPort> | undefined,
  sourceId: PublicSourceControlId,
): Readonly<ProductRuntimeControlRegistryEntry> {
  let state: ReturnType<NonNullable<ProductRuntimeCommandOwnerPort['readSourceControlState']>> = null;
  try { state = owner?.readSourceControlState?.(sourceId) ?? null; } catch { state = null; }
  const action = state?.desiredLifecycle === 'ISOLATED' ? 'RESTART' : 'ISOLATE';
  const sourceLabel = sourceId === 'public-spot-source' ? 'Spot' : 'USD-M';
  const configured = ownerBlocker(owner, 'SET_PUBLIC_SOURCE_LIFECYCLE') === null;
  return entry(snapshot, owner, {
    controlId: `source.${sourceId}.lifecycle`,
    backendCommandId: 'SET_PUBLIC_SOURCE_LIFECYCLE',
    targetType: 'COMPONENT',
    targetId: sourceId,
    payload: Object.freeze({ sourceId, action }),
    payloadSchema: '{ sourceId: public-spot-source | public-usdm-source, action: ISOLATE | RESTART }',
    payloadEnumeration: Object.freeze(['ISOLATE', 'RESTART']),
    defaultValue: action,
    label: `${action === 'ISOLATE' ? 'Isolate' : 'Restart'} ${sourceLabel} Public Source`,
    explanation: action === 'ISOLATE'
      ? `Stops only the selected ${sourceLabel} public-source stream group; unrelated sources remain supervised.`
      : `Restarts only the selected ${sourceLabel} public-source stream group from its durable isolated state.`,
    safeBounds: `${sourceId} only; source-local revision required`,
    currentDesiredValue: state?.desiredLifecycle ?? 'UNKNOWN',
    currentEffectiveValue: state?.observedLifecycle ?? 'UNKNOWN',
    effect: action === 'RESTART' ? 'RESTART' : 'IMMEDIATE',
    reversibility: 'The inverse transition requires the next exact source revision.',
    invariants: Object.freeze([
      'No signed or private exchange capability.',
      'No unrelated public-source stream is stopped or restarted.',
    ]),
    effectTelemetry: Object.freeze(['source revision', 'desired lifecycle', 'observed lifecycle', 'durable receipt']),
    confirmationText: `Confirm ${action} for ${sourceId} at source revision ${state?.sourceRevision ?? 'UNKNOWN'}.`,
    currentStateRevision: state === null ? 'UNKNOWN' : String(state.sourceRevision),
    ...(configured && state === null ? { forcedBlocker: 'SOURCE_CONTROL_STATE_UNAVAILABLE' } : {}),
  });
}

/** Six bounded non-money controls; fail-safe or source-local lifecycle directions only. */
export function buildProductRuntimeControlRegistry(
  snapshot: Readonly<SystemSupervisorReadModel>,
  owner?: Readonly<ProductRuntimeCommandOwnerPort>,
): readonly Readonly<ProductRuntimeControlRegistryEntry>[] {
  return Object.freeze([
    entry(snapshot, owner, {
      controlId: 'global.safe-mode.read-only', backendCommandId: 'SET_SAFE_MODE', targetType: 'SYSTEM', targetId: 'machine',
      payload: Object.freeze({ safeMode: 'READ_ONLY' }), payloadSchema: '{ safeMode: READ_ONLY }', payloadEnumeration: Object.freeze(['READ_ONLY']), defaultValue: 'READ_ONLY',
      label: 'Set Read Only', explanation: 'Requests the canonical control owner to remove risk-increasing posture.', safeBounds: 'READ_ONLY only',
      currentDesiredValue: snapshot.control.safeMode, currentEffectiveValue: snapshot.control.safeMode, effect: 'IMMEDIATE',
      reversibility: 'A separate canonical revision is required.', invariants: Object.freeze(['Never grants live authority.']),
      effectTelemetry: Object.freeze(['control revision', 'safe mode']), confirmationText: 'Confirm READ_ONLY at the current canonical revision.',
    }),
    entry(snapshot, owner, {
      controlId: 'global.kill-switch.engage', backendCommandId: 'SET_KILL_SWITCH', targetType: 'SYSTEM', targetId: 'machine',
      payload: Object.freeze({ engaged: true }), payloadSchema: '{ engaged: true }', payloadEnumeration: Object.freeze([true]), defaultValue: true,
      label: 'Engage Kill Switch', explanation: 'Requests the canonical fail-closed kill posture.', safeBounds: 'ENGAGED only',
      currentDesiredValue: snapshot.control.killSwitchEngaged ? 'ENGAGED' : 'CLEAR', currentEffectiveValue: snapshot.control.killSwitchEngaged ? 'ENGAGED' : 'CLEAR', effect: 'IMMEDIATE',
      reversibility: 'Release is intentionally not exposed here.', invariants: Object.freeze(['Engagement also blocks new intake.', 'No automatic release.']),
      effectTelemetry: Object.freeze(['kill posture', 'intake posture', 'control revision']), confirmationText: 'Confirm fail-closed kill-switch engagement.',
    }),
    entry(snapshot, owner, {
      controlId: 'global.intake.pause', backendCommandId: 'SET_INTAKE_PAUSED', targetType: 'SYSTEM', targetId: 'machine',
      payload: Object.freeze({ paused: true }), payloadSchema: '{ paused: true }', payloadEnumeration: Object.freeze([true]), defaultValue: true,
      label: 'Pause Intake', explanation: 'Stops new proposal intake without suppressing reconciliation or recovery.', safeBounds: 'PAUSED only',
      currentDesiredValue: snapshot.control.intakePaused ? 'PAUSED' : 'OPEN', currentEffectiveValue: snapshot.control.intakePaused ? 'PAUSED' : 'OPEN', effect: 'IMMEDIATE',
      reversibility: 'Resume is intentionally not exposed here.', invariants: Object.freeze(['Recovery remains visible and operable.']),
      effectTelemetry: Object.freeze(['intake posture', 'control revision']), confirmationText: 'Confirm intake pause at the current canonical revision.',
    }),
    entry(snapshot, owner, {
      controlId: 'component.engine-supervisor.restart', backendCommandId: 'RESTART_COMPONENT', targetType: 'COMPONENT', targetId: 'engine-supervisor',
      payload: Object.freeze({ componentId: 'engine-supervisor' }), payloadSchema: '{ componentId: engine-supervisor }', payloadEnumeration: Object.freeze(['engine-supervisor']), defaultValue: 'engine-supervisor',
      label: 'Restart Managed Root', explanation: 'Requests only the canonical managed-root restart path.', safeBounds: 'engine-supervisor only',
      currentDesiredValue: 'RUNNING', currentEffectiveValue: snapshot.phase, effect: 'RESTART',
      reversibility: 'Not reversible after canonical acceptance.', invariants: Object.freeze(['Managed root only.', 'No arbitrary process, path, URL, or command.']),
      effectTelemetry: Object.freeze(['runtime generation', 'component phase', 'durable receipt']), confirmationText: 'Confirm managed-root restart at the current canonical revision.',
    }),
    sourceLifecycleEntry(snapshot, owner, 'public-spot-source'),
    sourceLifecycleEntry(snapshot, owner, 'public-usdm-source'),
  ]);
}

function findWiredControl(
  registry: readonly Readonly<ProductRuntimeControlRegistryEntry>[],
  controlId: string,
): Readonly<ProductRuntimeControlRegistryEntry> {
  const control = registry.find((candidate) => candidate.controlId === controlId);
  if (!control) throw new ProductRuntimeError('CONTROL_NOT_FOUND', 'The requested control is not registered.', 404);
  if (control.wiringState !== 'WIRED_LIVE') {
    throw new ProductRuntimeError('CONTROL_NOT_CONFIGURED', control.disabledReason ?? 'The control owner is not configured.', 409);
  }
  return control;
}

function intent(
  control: Readonly<ProductRuntimeControlRegistryEntry>,
  expectedRevision: string,
  nowMs: number,
  operator: Readonly<ProductRuntimeOperator>,
): Readonly<ProductRuntimeCommandIntent> {
  return Object.freeze({
    controlId: control.controlId,
    backendCommandId: control.backendCommandId,
    targetType: control.targetType,
    targetId: control.targetId,
    payload: control.payload,
    expectedRevision,
    nowMs,
    operator,
  });
}

export async function previewProductRuntimeControl(input: Readonly<{
  registry: readonly Readonly<ProductRuntimeControlRegistryEntry>[];
  owner: Readonly<ProductRuntimeCommandOwnerPort> | undefined;
  controlId: string;
  expectedRevision: string;
  nowMs: number;
  operator: Readonly<ProductRuntimeOperator>;
}>): Promise<Readonly<ProductRuntimeControlPreview>> {
  const control = findWiredControl(input.registry, input.controlId);
  if (!input.owner) throw new ProductRuntimeError('CONTROL_NOT_CONFIGURED', 'The canonical command owner is not configured.', 409);
  if (input.expectedRevision !== control.currentStateRevision) {
    throw new ProductRuntimeError('REJECTED_STALE_REVISION', 'expectedRevision does not match canonical control state.', 409);
  }
  let preview: Readonly<ProductRuntimeControlPreview>;
  try {
    preview = await input.owner.preview(intent(control, input.expectedRevision, input.nowMs, input.operator));
  } catch {
    throw new ProductRuntimeError('COMMAND_OWNER_UNAVAILABLE', 'The canonical command owner could not produce a preview.', 503);
  }
  if (!preview || preview.controlId !== control.controlId || preview.expectedRevision !== input.expectedRevision
      || typeof preview.previewId !== 'string' || preview.previewId.length === 0 || preview.previewId.length > 160
      || typeof preview.digest !== 'string' || preview.digest.length === 0 || preview.digest.length > 500
      || typeof preview.consequence !== 'string' || preview.consequence.length === 0 || preview.consequence.length > 1_000
      || typeof preview.expiresAtMs !== 'number' || !Number.isFinite(preview.expiresAtMs) || preview.expiresAtMs <= input.nowMs
      || preview.synthetic !== false) {
    throw new ProductRuntimeError('COMMAND_OWNER_PREVIEW_INVALID', 'The canonical command owner returned an invalid preview.', 503);
  }
  return Object.freeze({ ...preview });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarRecord(value: unknown): value is Readonly<Record<string, ProductRuntimeCommandScalar>> {
  return record(value) && Object.keys(value).length <= 20 && Object.values(value).every((entry) => (
    entry === null || typeof entry === 'string' || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
  ));
}

function samePayload(left: Readonly<Record<string, ProductRuntimeCommandScalar>>, right: Readonly<Record<string, ProductRuntimeCommandScalar>>): boolean {
  const stable = (value: Readonly<Record<string, ProductRuntimeCommandScalar>>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return stable(left) === stable(right);
}

export function parseProductRuntimeCommandRequest(value: unknown): Readonly<ProductRuntimeCommandRequest> {
  if (!record(value)) throw new ProductRuntimeError('REJECTED_SCHEMA', 'Command body must be an object.', 400);
  const keys = Object.keys(value).sort();
  const expectedKeys = ['backendCommandId', 'controlId', 'currentRevision', 'expectedRevision', 'expiresAtMs', 'idempotencyKey', 'payload', 'previewDigest', 'previewId', 'reason', 'schemaVersion', 'targetId', 'targetType'].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new ProductRuntimeError('REJECTED_SCHEMA', 'Command body contains missing or unknown fields.', 400);
  }
  const bounded = ['idempotencyKey', 'controlId', 'backendCommandId', 'targetType', 'targetId', 'currentRevision', 'expectedRevision', 'previewId', 'previewDigest', 'reason'] as const;
  if (value.schemaVersion !== PRODUCT_RUNTIME_COMMAND_SCHEMA
      || bounded.some((field) => typeof value[field] !== 'string' || value[field].length === 0 || value[field].length > 500)
      || !scalarRecord(value.payload)
      || typeof value.expiresAtMs !== 'number' || !Number.isFinite(value.expiresAtMs)) {
    throw new ProductRuntimeError('REJECTED_SCHEMA', 'Command authority fields are invalid.', 400);
  }
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_COMMAND_SCHEMA,
    idempotencyKey: value.idempotencyKey as string,
    controlId: value.controlId as string,
    backendCommandId: value.backendCommandId as string,
    targetType: value.targetType as string,
    targetId: value.targetId as string,
    payload: Object.freeze({ ...(value.payload as Record<string, ProductRuntimeCommandScalar>) }),
    currentRevision: value.currentRevision as string,
    expectedRevision: value.expectedRevision as string,
    previewId: value.previewId as string,
    previewDigest: value.previewDigest as string,
    expiresAtMs: value.expiresAtMs,
    reason: value.reason as string,
  });
}

export async function submitProductRuntimeControl(input: Readonly<{
  registry: readonly Readonly<ProductRuntimeControlRegistryEntry>[];
  owner: Readonly<ProductRuntimeCommandOwnerPort> | undefined;
  request: Readonly<ProductRuntimeCommandRequest>;
  nowMs: number;
  operator: Readonly<ProductRuntimeOperator>;
}>): Promise<Readonly<ProductRuntimeControlResult>> {
  const control = findWiredControl(input.registry, input.request.controlId);
  if (!input.owner) throw new ProductRuntimeError('CONTROL_NOT_CONFIGURED', 'The canonical command owner is not configured.', 409);
  if (input.request.expiresAtMs <= input.nowMs) throw new ProductRuntimeError('EXPIRED', 'Command preview has expired.', 409);
  if (input.request.backendCommandId !== control.backendCommandId
      || input.request.targetType !== control.targetType || input.request.targetId !== control.targetId
      || input.request.currentRevision !== input.request.expectedRevision
      || !samePayload(input.request.payload, control.payload)) {
    throw new ProductRuntimeError('REJECTED_STALE_REVISION', 'Command is not bound to the current registered control.', 409);
  }
  const ownerIntent = intent(control, input.request.expectedRevision, input.nowMs, input.operator);
  let result: Readonly<ProductRuntimeControlResult>;
  try {
    result = await input.owner.submit(Object.freeze({ request: input.request, intent: ownerIntent }));
  } catch {
    throw new ProductRuntimeError('COMMAND_OWNER_UNAVAILABLE', 'The canonical command owner could not submit the command.', 503);
  }
  const durableReceiptRequired = ['APPLIED', 'ACCEPTED_ASYNC', 'ALREADY_APPLIED'].includes(result?.status);
  if (!result || result.controlId !== control.controlId || !RESULT_STATUSES.has(result.status)
      || typeof result.commandId !== 'string' || result.commandId.length === 0 || result.commandId.length > 160
      || typeof result.before !== 'string' || typeof result.after !== 'string'
      || !(result.receiptId === null || (typeof result.receiptId === 'string' && result.receiptId.length > 0))
      || (durableReceiptRequired && result.receiptId === null)
      || typeof result.correlationId !== 'string' || result.correlationId.length === 0
      || typeof result.completedAtMs !== 'number' || !Number.isFinite(result.completedAtMs)
      || result.synthetic !== false) {
    throw new ProductRuntimeError('COMMAND_OWNER_RESULT_INVALID', 'The canonical command owner returned an invalid result.', 503);
  }
  return Object.freeze({ ...result });
}
