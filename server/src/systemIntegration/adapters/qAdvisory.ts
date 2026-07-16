import {
  createStructuredFailure,
  isValidUtcMillis,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import type { ComponentStepContext } from '../../foundation/control/index.js';
import { EDGE_PROTOCOL_V1_SCHEMA_SHA256 as L01_SCHEMA_SHA256 } from '../../liveEdge/adapters/edgeProtocol/schemaValidator.js';
import { EDGE_PROTOCOL_V1_PROTOCOL_SHA as L01_PROTOCOL_COMMIT } from '../../liveEdge/adapters/edgeProtocol/types.js';
import type { EdgeAssessmentBridgeSnapshot } from '../../liveEdge/integration/assessmentBridge.js';
import {
  EDGE_PROTOCOL_COMMIT,
  EDGE_PROTOCOL_SCHEMA_SHA256,
  EDGE_PROTOCOL_VERSION,
  evaluateQProtocolHandshake,
  type QProtocolHandshake,
} from '../../productIntegration/adapters/qProtocol.js';
import type { ApplicationComponentReadPort } from '../application/types.js';
import type {
  RuntimeHealthEvidence,
  QAdvisoryRuntimePort,
  UtcClock,
} from '../composition/types.js';
import type {
  SystemComponentSnapshot,
  SystemQueueSnapshot,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';

export const Q_ADVISORY_SAFE_FALLBACK = 'ABSTAIN_UNKNOWN' as const;
export const Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID = 'quant-inference-q16' as const;

export type QAdvisoryRuntimeState =
  | 'STOPPED'
  | 'NOT_CONFIGURED'
  | 'INCOMPATIBLE'
  | 'UNAVAILABLE'
  | 'STALE';

export type QAdvisoryClientState =
  | 'NOT_CONFIGURED'
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNAVAILABLE';

export type QAdvisoryTransportState =
  | 'NOT_CONFIGURED'
  | EdgeAssessmentBridgeSnapshot['transport']['state'];

/**
 * Read-only seam over an already-owned Q/L01 runtime. It deliberately exposes
 * no frame ingestion, strategy observation, score, proposal, capital, risk,
 * control, ticket, order, credential, endpoint, or process-construction API.
 */
export interface QAdvisoryObservationBinding {
  readHandshake(): Readonly<QProtocolHandshake> | null;
  readBridgeSnapshot(): Readonly<EdgeAssessmentBridgeSnapshot> | null;
}

/**
 * Accepted production-safe Q posture while no champion/transport owner is
 * mounted. It binds only the frozen protocol identity and deterministically
 * yields ABSTAIN_UNKNOWN; it has no transport, process, dispatch, strategy, or
 * money-path capability.
 */
export function createAcceptedQAbstentionBinding(): Readonly<QAdvisoryObservationBinding> {
  const handshake: Readonly<QProtocolHandshake> = Object.freeze({
    protocolCommit: EDGE_PROTOCOL_COMMIT,
    protocolVersion: EDGE_PROTOCOL_VERSION,
    schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256,
    producerBuild: null,
    championModelVersion: null,
  });
  return Object.freeze({
    readHandshake: () => handshake,
    readBridgeSnapshot: () => null,
  });
}

export interface QAdvisoryStatusSnapshot {
  readonly componentId: 'q-inference';
  readonly expectedRemoteComponentId: typeof Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID;
  readonly protocolCommit: typeof EDGE_PROTOCOL_COMMIT;
  readonly protocolVersion: typeof EDGE_PROTOCOL_VERSION;
  readonly schemaSha256: typeof EDGE_PROTOCOL_SCHEMA_SHA256;
  readonly adapterPolicy: 'L_ADAPTER_POLICY_V1';
  readonly runtimeState: QAdvisoryRuntimeState;
  readonly clientState: QAdvisoryClientState;
  readonly transportState: QAdvisoryTransportState;
  readonly bridgeState: EdgeAssessmentBridgeSnapshot['state'] | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly ownerObservationState: 'NOT_CONFIGURED';
  readonly advisoryAction: typeof Q_ADVISORY_SAFE_FALLBACK;
  readonly producerBuild: string | null;
  readonly championModelVersion: string | null;
  readonly remoteComponentId: string | null;
  readonly remoteGeneratedAtMs: number | null;
  readonly transportObservedAtMs: number | null;
  readonly queue: Readonly<SystemQueueSnapshot> | null;
  readonly blockerCodes: readonly string[];
}

export interface QAdvisoryRuntimeAdapter
  extends QAdvisoryRuntimePort, ApplicationComponentReadPort {
  readQAdvisoryStatus(): Readonly<QAdvisoryStatusSnapshot>;
}

const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const MAX_BLOCKER_CODES = 256;

interface BridgeObservation {
  readonly state: EdgeAssessmentBridgeSnapshot['state'];
  readonly advisoryReady: boolean;
  readonly reasonCodes: readonly string[];
  readonly transportState: EdgeAssessmentBridgeSnapshot['transport']['state'];
  readonly transportObservedAtMs: number | null;
  readonly remoteComponentId: string | null;
  readonly remoteGeneratedAtMs: number | null;
  readonly queueDepth: number;
  readonly queueCapacity: number;
  readonly queueDropped: number;
  readonly queueCoalesced: number;
}

function dataRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain data record`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} cannot contain symbol fields`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} must contain enumerable data fields only`);
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function exactFields(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (keys.length !== sortedExpected.length
      || keys.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} fields do not match the accepted contract`);
  }
}

function nonNegativeCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function optionalUtc(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be null or UTC milliseconds`);
  return value;
}

function parseHandshake(value: unknown): Readonly<QProtocolHandshake> {
  const record = dataRecord(value, 'Q protocol handshake');
  exactFields(record, [
    'protocolCommit',
    'protocolVersion',
    'schemaSha256',
    'producerBuild',
    'championModelVersion',
  ], 'Q protocol handshake');
  const producerBuild = own(record, 'producerBuild');
  const championModelVersion = own(record, 'championModelVersion');
  if (producerBuild !== null
      && (typeof producerBuild !== 'string' || producerBuild.length < 1 || producerBuild.length > 256)) {
    throw new TypeError('Q producerBuild is invalid');
  }
  if (championModelVersion !== null
      && (typeof championModelVersion !== 'string'
        || championModelVersion.trim().length < 1
        || championModelVersion.length > 256)) {
    throw new TypeError('Q championModelVersion is invalid');
  }
  return Object.freeze({
    protocolCommit: own(record, 'protocolCommit') as string,
    protocolVersion: own(record, 'protocolVersion') as number,
    schemaSha256: own(record, 'schemaSha256') as string,
    producerBuild: producerBuild as string | null,
    championModelVersion: championModelVersion as string | null,
  });
}

function parseBridgeSnapshot(value: unknown): Readonly<BridgeObservation> {
  const bridge = dataRecord(value, 'L01 assessment bridge snapshot');
  exactFields(bridge, [
    'adapterPolicy',
    'state',
    'advisoryReady',
    'researchRecordingReady',
    'reasonCodes',
    'queue',
    'identities',
    'transport',
    'remoteBrain',
    'recording',
    'counters',
  ], 'L01 assessment bridge snapshot');
  if (own(bridge, 'adapterPolicy') !== 'L_ADAPTER_POLICY_V1') {
    throw new TypeError('L01 adapter policy is incompatible');
  }
  const state = own(bridge, 'state');
  if (!['RUNNING', 'DEGRADED', 'STALE', 'BLOCKED', 'FAILED', 'UNKNOWN'].includes(String(state))) {
    throw new TypeError('L01 bridge state is invalid');
  }
  const advisoryReady = own(bridge, 'advisoryReady');
  if (typeof advisoryReady !== 'boolean') throw new TypeError('L01 advisoryReady is invalid');
  const reasonCodes = own(bridge, 'reasonCodes');
  if (!Array.isArray(reasonCodes) || reasonCodes.length > MAX_BLOCKER_CODES
      || reasonCodes.some((code) => typeof code !== 'string' || !CODE.test(code))) {
    throw new TypeError('L01 bridge reason codes are invalid');
  }

  const queue = dataRecord(own(bridge, 'queue'), 'L01 bridge queue');
  const queueDepth = nonNegativeCount(own(queue, 'depth'), 'L01 bridge queue depth');
  const queueCapacity = nonNegativeCount(own(queue, 'capacity'), 'L01 bridge queue capacity');
  const queueDropped = nonNegativeCount(own(queue, 'droppedCount'), 'L01 bridge queue dropped count');
  const queueCoalesced = nonNegativeCount(own(queue, 'coalescedCount'), 'L01 bridge queue coalesced count');
  if (queueCapacity < 1 || queueDepth > queueCapacity) throw new TypeError('L01 bridge queue bounds are invalid');

  const transport = dataRecord(own(bridge, 'transport'), 'L01 bridge transport');
  const transportState = own(transport, 'state');
  if (!['UNKNOWN', 'CONNECTED', 'DISCONNECTED', 'FAILED', 'TIMED_OUT'].includes(String(transportState))) {
    throw new TypeError('L01 bridge transport state is invalid');
  }
  const transportObservedAtMs = optionalUtc(own(transport, 'observedAtMs'), 'L01 bridge transport observedAtMs');

  const remote = dataRecord(own(bridge, 'remoteBrain'), 'L01 bridge remote brain');
  const remoteComponentId = own(remote, 'componentId');
  if (remoteComponentId !== null
      && (typeof remoteComponentId !== 'string' || remoteComponentId.length < 1 || remoteComponentId.length > 128)) {
    throw new TypeError('L01 bridge remote component ID is invalid');
  }
  const remoteGeneratedAtMs = optionalUtc(own(remote, 'generatedAtMs'), 'L01 bridge remote generatedAtMs');
  return Object.freeze({
    state: state as EdgeAssessmentBridgeSnapshot['state'],
    advisoryReady,
    reasonCodes: Object.freeze([...reasonCodes]),
    transportState: transportState as EdgeAssessmentBridgeSnapshot['transport']['state'],
    transportObservedAtMs,
    remoteComponentId: remoteComponentId as string | null,
    remoteGeneratedAtMs,
    queueDepth,
    queueCapacity,
    queueDropped,
    queueCoalesced,
  });
}

function boundedBlockers(values: readonly string[]): readonly string[] {
  const unique = [...new Set(values)];
  if (unique.length <= MAX_BLOCKER_CODES) return Object.freeze(unique);
  return Object.freeze([
    ...unique.slice(0, MAX_BLOCKER_CODES - 1),
    'Q_BLOCKER_LIST_TRUNCATED',
  ]);
}

function failure(
  code: string,
  nowMs: number,
  correlationId: string,
): Readonly<StructuredFailure> {
  return createStructuredFailure({
    component: 'q-inference',
    stage: 'advisory-observation',
    code,
    message: 'Q advisory evidence is unavailable; the integration remains fail-closed at ABSTAIN_UNKNOWN.',
    occurredAt: nowMs,
    retryable: false,
    safeCurrentState: Q_ADVISORY_SAFE_FALLBACK,
    recommendedOperatorAction: 'Configure and verify the accepted local Q client, transport, and owner observation contract.',
    correlationId,
  });
}

function transportBlocker(state: BridgeObservation['transportState']): string | null {
  if (state === 'CONNECTED') return null;
  if (state === 'UNKNOWN') return 'Q_TRANSPORT_NOT_CONFIGURED';
  return `Q_TRANSPORT_${state}`;
}

/**
 * Managed lifecycle for the internal observation mount, not for a Python
 * process or socket. Construction and start are inert. The adapter can only
 * read a binding injected by the serial composition owner.
 */
export class ProductionQAdvisoryRuntime implements QAdvisoryRuntimeAdapter {
  private active = false;
  private generation = 0;
  private restartCount = 0;

  constructor(
    private readonly clock: UtcClock,
    private readonly binding: QAdvisoryObservationBinding | null = null,
  ) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('Q advisory clock.nowMs is required');
    if (EDGE_PROTOCOL_COMMIT !== L01_PROTOCOL_COMMIT
        || EDGE_PROTOCOL_SCHEMA_SHA256 !== L01_SCHEMA_SHA256) {
      throw new TypeError('Q and L01 frozen protocol identities diverge');
    }
    if (binding !== null
        && (typeof binding?.readHandshake !== 'function'
          || typeof binding?.readBridgeSnapshot !== 'function')) {
      throw new TypeError('Q advisory observation binding is invalid');
    }
  }

  validate(ctx: ComponentStepContext): void {
    if (!isValidUtcMillis(ctx.nowMs)) throw new TypeError('Q advisory validation requires UTC milliseconds');
  }

  start(): Promise<void> {
    if (!this.active) {
      if (this.generation > 0) this.restartCount += 1;
      this.generation += 1;
      this.active = true;
    }
    return Promise.resolve();
  }

  stop(): void {
    this.active = false;
  }

  health(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    if (!this.active) {
      return Object.freeze({ running: false, heartbeatAt: null, timestamp: null, fatal: null });
    }
    const status = this.observe(ctx.nowMs);
    return Object.freeze({
      running: true,
      heartbeatAt: null,
      timestamp: null,
      fatal: failure(
        status.blockerCodes[0] ?? 'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
        ctx.nowMs,
        ctx.correlationId,
      ),
    });
  }

  readQAdvisoryStatus(): Readonly<QAdvisoryStatusSnapshot> {
    return this.observe(this.clock.nowMs());
  }

  readComponentSnapshot(): Readonly<SystemComponentSnapshot> {
    const nowMs = this.clock.nowMs();
    const status = this.observe(nowMs);
    const stopped = !this.active;
    const stale = status.runtimeState === 'STALE';
    const component: Readonly<SystemComponentSnapshot> = Object.freeze({
      componentId: 'q-inference',
      owner: 'Q_INFERENCE',
      ownerPath: 'quant/src/quant_edge/inference',
      releaseStatuses: Object.freeze(status.clientState === 'NOT_CONFIGURED'
        ? ['BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'] as const
        : ['BUILT_AND_TESTED', 'IMPORTED', 'BLOCKED'] as const),
      truthLabel: 'UNAVAILABLE',
      desiredState: stopped ? 'STOPPED' : 'RUNNING',
      phase: stopped ? 'STOPPED' : stale ? 'DEGRADED' : 'BLOCKED',
      domainObservedState: stopped
        ? 'STOPPED'
        : `Q_ADVISORY_${status.runtimeState}_${Q_ADVISORY_SAFE_FALLBACK}`,
      sourceLifecycle: null,
      readiness: stopped ? 'STOPPED' : stale ? 'DEGRADED' : 'BLOCKED',
      authority: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
      sourceTimestamp: null,
      freshness: null,
      lastReceiveAtMs: null,
      lastProcessAtMs: null,
      lastSuccessAtMs: null,
      dependencies: Object.freeze(['market-intelligence'] as const),
      queue: status.queue,
      lastFailure: stopped
        ? null
        : failure(
          status.blockerCodes[0] ?? 'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
          nowMs,
          'q-advisory-component-read',
        ),
      blockerCodes: stopped ? Object.freeze([]) : status.blockerCodes,
      generation: this.generation,
      restartCount: this.restartCount,
      supportedControls: Object.freeze([]),
      capitalExposed: false,
      operatorAttentionRequired: !stopped,
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) {
      throw new TypeError(`invalid Q advisory projection: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
    }
    return component;
  }

  private observe(nowMs: number): Readonly<QAdvisoryStatusSnapshot> {
    if (!isValidUtcMillis(nowMs)) throw new TypeError('Q advisory clock returned invalid UTC milliseconds');
    if (!this.active) return this.status({ runtimeState: 'STOPPED', blockerCodes: [] });
    if (this.binding === null) {
      return this.status({
        runtimeState: 'NOT_CONFIGURED',
        blockerCodes: [
          'Q_CLIENT_NOT_CONFIGURED',
          'Q_TRANSPORT_NOT_CONFIGURED',
          'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
          'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
        ],
      });
    }

    let handshake: Readonly<QProtocolHandshake>;
    try {
      const candidate = this.binding.readHandshake();
      if (candidate === null) {
        return this.status({
          runtimeState: 'UNAVAILABLE',
          clientState: 'UNAVAILABLE',
          blockerCodes: [
            'Q_HANDSHAKE_UNAVAILABLE',
            'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
            'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
          ],
        });
      }
      handshake = parseHandshake(candidate);
    } catch {
      return this.status({
        runtimeState: 'INCOMPATIBLE',
        clientState: 'INCOMPATIBLE',
        blockerCodes: [
          'Q_HANDSHAKE_MALFORMED',
          'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
          'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
        ],
      });
    }
    const compatibility = evaluateQProtocolHandshake(handshake);
    if (!compatibility.compatible) {
      return this.status({
        runtimeState: compatibility.reasonCode === 'CHAMPION_UNAVAILABLE' ? 'UNAVAILABLE' : 'INCOMPATIBLE',
        clientState: compatibility.reasonCode === 'CHAMPION_UNAVAILABLE' ? 'UNAVAILABLE' : 'INCOMPATIBLE',
        producerBuild: handshake.producerBuild,
        championModelVersion: handshake.championModelVersion,
        blockerCodes: [
          compatibility.reasonCode,
          'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
          'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
        ],
      });
    }

    let bridge: Readonly<BridgeObservation>;
    try {
      const candidate = this.binding.readBridgeSnapshot();
      if (candidate === null) {
        return this.status({
          runtimeState: 'UNAVAILABLE',
          clientState: 'COMPATIBLE',
          producerBuild: handshake.producerBuild,
          championModelVersion: handshake.championModelVersion,
          blockerCodes: [
            'Q_BRIDGE_SNAPSHOT_UNAVAILABLE',
            'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
            'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
          ],
        });
      }
      bridge = parseBridgeSnapshot(candidate);
    } catch {
      return this.status({
        runtimeState: 'UNAVAILABLE',
        clientState: 'COMPATIBLE',
        producerBuild: handshake.producerBuild,
        championModelVersion: handshake.championModelVersion,
        blockerCodes: [
          'Q_BRIDGE_SNAPSHOT_MALFORMED',
          'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
          'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
        ],
      });
    }

    const blockers: string[] = [];
    if (bridge.remoteComponentId === null) blockers.push('Q_REMOTE_COMPONENT_ID_UNAVAILABLE');
    else if (bridge.remoteComponentId !== Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID) {
      blockers.push('Q_REMOTE_COMPONENT_ID_MISMATCH');
    }
    const transportReason = transportBlocker(bridge.transportState);
    if (transportReason !== null) blockers.push(transportReason);
    if (bridge.state === 'STALE') blockers.push('Q_ADVISORY_STALE');
    else if (bridge.state === 'FAILED') blockers.push('Q_ADVISORY_FAILED');
    else if (bridge.state === 'BLOCKED') blockers.push('Q_ADVISORY_BLOCKED');
    else if (bridge.state === 'DEGRADED') blockers.push('Q_ADVISORY_DEGRADED');
    else if (bridge.state === 'UNKNOWN') blockers.push('Q_ADVISORY_UNKNOWN');
    if (!bridge.advisoryReady) blockers.push('Q_ADVISORY_NOT_READY');
    blockers.push(...bridge.reasonCodes);
    // No accepted Basis/Volume observation API exists on this branch. Even a
    // healthy compatible bridge therefore remains advisory-disabled.
    blockers.push('Q_OWNER_OBSERVATION_NOT_CONFIGURED', 'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN');

    const runtimeState: QAdvisoryRuntimeState = bridge.state === 'STALE'
      ? 'STALE'
      : ['FAILED', 'BLOCKED', 'UNKNOWN'].includes(bridge.state)
        ? 'UNAVAILABLE'
        : 'NOT_CONFIGURED';
    return this.status({
      runtimeState,
      clientState: 'COMPATIBLE',
      transportState: bridge.transportState,
      bridgeState: bridge.state,
      producerBuild: handshake.producerBuild,
      championModelVersion: handshake.championModelVersion,
      remoteComponentId: bridge.remoteComponentId,
      remoteGeneratedAtMs: bridge.remoteGeneratedAtMs,
      transportObservedAtMs: bridge.transportObservedAtMs,
      queue: Object.freeze({
        depth: bridge.queueDepth,
        capacity: bridge.queueCapacity,
        dropped: bridge.queueDropped,
        coalesced: bridge.queueCoalesced,
        observedAtMs: nowMs,
      }),
      blockerCodes: blockers,
    });
  }

  private status(input: Readonly<{
    runtimeState: QAdvisoryRuntimeState;
    clientState?: QAdvisoryClientState;
    transportState?: QAdvisoryTransportState;
    bridgeState?: QAdvisoryStatusSnapshot['bridgeState'];
    producerBuild?: string | null;
    championModelVersion?: string | null;
    remoteComponentId?: string | null;
    remoteGeneratedAtMs?: number | null;
    transportObservedAtMs?: number | null;
    queue?: Readonly<SystemQueueSnapshot> | null;
    blockerCodes: readonly string[];
  }>): Readonly<QAdvisoryStatusSnapshot> {
    return Object.freeze({
      componentId: 'q-inference',
      expectedRemoteComponentId: Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID,
      protocolCommit: EDGE_PROTOCOL_COMMIT,
      protocolVersion: EDGE_PROTOCOL_VERSION,
      schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256,
      adapterPolicy: 'L_ADAPTER_POLICY_V1',
      runtimeState: input.runtimeState,
      clientState: input.clientState ?? 'NOT_CONFIGURED',
      transportState: input.transportState ?? 'NOT_CONFIGURED',
      bridgeState: input.bridgeState ?? (input.runtimeState === 'STOPPED' ? 'UNAVAILABLE' : 'NOT_CONFIGURED'),
      ownerObservationState: 'NOT_CONFIGURED',
      advisoryAction: Q_ADVISORY_SAFE_FALLBACK,
      producerBuild: input.producerBuild ?? null,
      championModelVersion: input.championModelVersion ?? null,
      remoteComponentId: input.remoteComponentId ?? null,
      remoteGeneratedAtMs: input.remoteGeneratedAtMs ?? null,
      transportObservedAtMs: input.transportObservedAtMs ?? null,
      queue: input.queue ?? null,
      blockerCodes: boundedBlockers(input.blockerCodes),
    });
  }
}

export function createProductionQAdvisoryRuntime(input: Readonly<{
  clock: UtcClock;
  binding?: QAdvisoryObservationBinding | null;
}>): QAdvisoryRuntimeAdapter {
  return new ProductionQAdvisoryRuntime(input.clock, input.binding ?? null);
}
