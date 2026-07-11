import {
  ATTENTION_TIERS,
  EVIDENCE_KINDS,
  stableId,
  sortedUnique,
  type AttentionTier,
  type EvidenceKind,
} from '../../intelligenceFoundation/contracts/index.js';
import type { AttentionAllocation } from '../../intelligenceFoundation/attention/index.js';
import { ControlMessageThrottle } from '../lifecycle/throttle.js';
import { focusAllocatorConfig } from './config.js';
import { buildFocusDemands, type FocusDemand } from './catalog.js';
import { FOCUS_ROUTES } from './types.js';
import type {
  FocusAllocatorConfig,
  FocusAllocatorConfigInput,
  FocusAllocatorPorts,
  FocusAllocatorSnapshot,
  FocusConnectionSnapshot,
  FocusConnectionUpdate,
  FocusControlAcknowledgement,
  FocusControlBatch,
  FocusProtectedSymbolSnapshot,
  FocusReasonCode,
  FocusReconcileResult,
  FocusRequirementSnapshot,
  FocusRoute,
  FocusStreamObservation,
  FocusStreamSnapshot,
  FocusStreamState,
} from './types.js';

const TIER_RANK: Record<AttentionTier, number> = {
  RELEASED: -1,
  UNIVERSE: 0,
  WATCH: 1,
  CANDIDATE: 2,
  FOCUS: 3,
  DEEP_FOCUS: 4,
};

interface InternalConnection {
  route: FocusRoute;
  connectionId: string;
  generation: number;
  state: 'UNAVAILABLE' | 'AVAILABLE';
  throttle: ControlMessageThrottle;
}

interface InternalAssignment {
  resourceKey: string;
  route: FocusRoute;
  stream: string;
  sourceId: string;
  connectionId: string;
  generation: number;
  state: FocusStreamState;
  protected: boolean;
  ownerDemands: Map<string, FocusDemand>;
  ownerSymbols: Set<string>;
  leaseUntilMs: number;
  lastObservedAtMs: number | null;
  subscriptionCreatedAtMs: number | null;
  observedBeforeAck: boolean;
  controlAttempts: Record<'SUBSCRIBE' | 'UNSUBSCRIBE', number>;
  controlFailure: Extract<FocusReasonCode, 'CONTROL_RETRY_EXHAUSTED'> | null;
  controlFailureMethod: 'SUBSCRIBE' | 'UNSUBSCRIBE' | null;
}

interface PhysicalDemand {
  resourceKey: string;
  route: FocusRoute;
  stream: string;
  sourceId: string;
  owners: FocusDemand[];
  protected: boolean;
}

interface PendingControl {
  batch: FocusControlBatch;
  resourceKeys: string[];
  previousStates: Map<string, FocusStreamState>;
}

function safeTime(value: unknown, name = 'focus time'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function safeGeneration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('connection generation must be a non-negative safe integer');
  }
  return value;
}

function validIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || !/^[A-Za-z0-9:._@/-]+$/.test(value)) {
    throw new TypeError(`invalid ${name}`);
  }
  return value;
}

function normalizedSymbol(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('focus symbol must be a string');
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(symbol)) throw new TypeError('invalid focus symbol');
  return symbol;
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descendingNullable(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left > right ? -1 : 1;
}

function compareDemandPriority(left: FocusDemand, right: FocusDemand): number {
  if (left.protected !== right.protected) return left.protected ? -1 : 1;
  if (TIER_RANK[left.tier] !== TIER_RANK[right.tier]) return TIER_RANK[right.tier] - TIER_RANK[left.tier];
  const priority = descendingNullable(left.priority, right.priority);
  if (priority !== 0) return priority;
  const signal = descendingNullable(left.lastSignalAtMs, right.lastSignalAtMs);
  if (signal !== 0) return signal;
  return 0;
}

function compareDemand(left: FocusDemand, right: FocusDemand): number {
  const priority = compareDemandPriority(left, right);
  if (priority !== 0) return priority;
  if (left.enteredAtMs !== right.enteredAtMs) return left.enteredAtMs - right.enteredAtMs;
  return compareString(left.attentionInstrumentId, right.attentionInstrumentId) ||
    compareString(left.evidenceKind, right.evidenceKind) || compareString(left.id, right.id);
}

function reasons(...values: Array<FocusReasonCode | readonly FocusReasonCode[] | undefined>): FocusReasonCode[] {
  const flattened: FocusReasonCode[] = [];
  for (const value of values) {
    if (value === undefined) continue;
    if (Array.isArray(value)) flattened.push(...value);
    else flattened.push(value as FocusReasonCode);
  }
  return sortedUnique(flattened) as FocusReasonCode[];
}

function connectionId(route: FocusRoute, oneBasedIndex: number): string {
  return `${route}:${oneBasedIndex}`;
}

function unavailableDemands(
  allocation: AttentionAllocation,
  reason: Extract<FocusReasonCode, 'CAPABILITY_UNAVAILABLE' | 'INVALID_CAPABILITY'>,
): FocusDemand[] {
  const symbol = normalizedSymbol(allocation.symbol);
  return sortedUnique(allocation.requestedEvidence).map((evidenceKind) => ({
    id: stableId('focus-requirement', {
      attentionInstrumentId: allocation.instrumentId,
      productFamily: null,
      evidenceKind,
    }),
    attentionInstrumentId: allocation.instrumentId,
    symbol,
    productFamily: null,
    evidenceKind: evidenceKind as EvidenceKind,
    tier: allocation.tier,
    priority: allocation.priority,
    protected: allocation.protected,
    enteredAtMs: allocation.enteredAtMs,
    lastSignalAtMs: allocation.lastSignalAtMs,
    transport: 'UNAVAILABLE',
    route: null,
    streamOrPath: null,
    resourceKey: null,
    sourceId: null,
    initialReason: evidenceKind === 'BORROW' ? 'PRIVATE_ENDPOINT_FORBIDDEN' : reason,
  }));
}

function hardUnfulfilled(reasonCodes: readonly FocusReasonCode[]): boolean {
  return reasonCodes.some((code) => (
    code === 'SOURCE_UNAVAILABLE' ||
    code === 'STREAM_BUDGET_EXHAUSTED' ||
    code === 'CONNECTION_BUDGET_EXHAUSTED' ||
    code === 'LEASE_HYSTERESIS_ACTIVE' ||
    code === 'CONTROL_RETRY_EXHAUSTED'
  ));
}

/**
 * Purely plans public subscriptions. The caller owns sockets, timers, and message I/O.
 * Every state transition is driven through reconcile/acknowledge/observe with an injected clock.
 */
export class FocusSubscriptionAllocator {
  readonly #ports: FocusAllocatorPorts;
  readonly #config: FocusAllocatorConfig;
  readonly #connections = new Map<string, InternalConnection>();
  readonly #assignments = new Map<string, InternalAssignment>();
  readonly #pending = new Map<number, PendingControl>();
  readonly #releasedAtMs = new Map<string, number>();
  #nextControlId = 1;
  #lastPlanId: string | null = null;
  #lastDemands: FocusDemand[] = [];

  constructor(ports: FocusAllocatorPorts, configInput: FocusAllocatorConfigInput = {}) {
    if (typeof ports?.clock?.nowMs !== 'function') throw new TypeError('focus runtime clock is required');
    if (typeof ports?.attentionPlans?.readAttentionPlan !== 'function') throw new TypeError('attention plan port is required');
    if (typeof ports?.capabilities?.readCapabilities !== 'function') throw new TypeError('focus capability port is required');
    if (typeof ports?.deliveries?.readDeliveredEvidence !== 'function') throw new TypeError('focus delivery port is required');
    if (typeof ports?.protectedSymbols?.protectedSymbols !== 'function') throw new TypeError('protected symbol port is required');
    this.#ports = ports;
    this.#config = focusAllocatorConfig(configInput);
    for (const route of FOCUS_ROUTES) {
      for (let index = 1; index <= this.#config.routes[route].maximumConnections; index += 1) {
        const id = connectionId(route, index);
        this.#connections.set(id, {
          route,
          connectionId: id,
          generation: 0,
          state: 'UNAVAILABLE',
          throttle: new ControlMessageThrottle(this.#ports.clock, {
            maximumMessages: this.#config.routes[route].maximumControlMessagesPerInterval,
            intervalMs: this.#config.controlIntervalMs,
          }),
        });
      }
    }
  }

  connectionIds(route: FocusRoute): readonly string[] {
    if (!FOCUS_ROUTES.includes(route)) throw new TypeError('invalid focus route');
    return Object.freeze([...this.#connections.values()]
      .filter((entry) => entry.route === route)
      .map((entry) => entry.connectionId)
      .sort(compareString));
  }

  updateConnection(update: FocusConnectionUpdate): void {
    if (!FOCUS_ROUTES.includes(update.route)) throw new TypeError('invalid focus route');
    const id = validIdentifier(update.connectionId, 'focus connection id');
    const connection = this.#connections.get(id);
    if (connection === undefined || connection.route !== update.route) {
      throw new RangeError('focus connection is not a configured slot');
    }
    const generation = safeGeneration(update.generation);
    if (generation < connection.generation) throw new RangeError('focus connection generation cannot move backwards');
    if (update.state === 'AVAILABLE' && generation === 0) {
      throw new RangeError('available focus connection requires a positive generation');
    }
    if (update.state !== 'AVAILABLE' && update.state !== 'UNAVAILABLE') throw new TypeError('invalid focus connection state');

    const invalidated = generation !== connection.generation || update.state === 'UNAVAILABLE';
    connection.generation = generation;
    connection.state = update.state;
    if (invalidated) {
      connection.throttle.reset();
      this.#invalidateConnection(connection);
    }
  }

  acknowledge(input: FocusControlAcknowledgement): boolean {
    const observedAtMs = safeTime(input.observedAtMs, 'control acknowledgement time');
    const now = safeTime(this.#ports.clock.nowMs(), 'focus runtime clock');
    if (observedAtMs > now) throw new RangeError('control acknowledgement time cannot be in the future');
    safeGeneration(input.generation);
    if (!Number.isSafeInteger(input.id) || input.id < 1) throw new TypeError('control acknowledgement id is invalid');
    const pending = this.#pending.get(input.id);
    if (
      pending === undefined || pending.batch.route !== input.route ||
      pending.batch.connectionId !== input.connectionId || pending.batch.generation !== input.generation
    ) return false;
    if (observedAtMs < pending.batch.createdAtMs) {
      throw new RangeError('control acknowledgement cannot precede its command');
    }
    const matchedAssignments = pending.resourceKeys.map((key) => this.#assignments.get(key)).filter((assignment): assignment is InternalAssignment => (
      assignment !== undefined && assignment.connectionId === input.connectionId && assignment.generation === input.generation
    ));
    if (matchedAssignments.some((assignment) => assignment.lastObservedAtMs !== null
      && observedAtMs < assignment.lastObservedAtMs)) {
      throw new RangeError('control acknowledgement cannot regress readiness time');
    }
    this.#pending.delete(input.id);
    for (const key of pending.resourceKeys) {
      const assignment = this.#assignments.get(key);
      if (
        assignment === undefined || assignment.connectionId !== input.connectionId ||
        assignment.generation !== input.generation
      ) continue;
      if (pending.batch.method === 'SUBSCRIBE') {
        if (input.accepted) {
          assignment.state = assignment.observedBeforeAck ? 'READY' : 'WARMING';
          assignment.controlAttempts.SUBSCRIBE = 0;
          assignment.controlFailure = null;
          assignment.controlFailureMethod = null;
        } else {
          assignment.state = 'DESIRED';
          assignment.observedBeforeAck = false;
          assignment.lastObservedAtMs = null;
          assignment.subscriptionCreatedAtMs = null;
          if (this.#retriesExhausted(assignment, 'SUBSCRIBE')) {
            assignment.controlFailure = 'CONTROL_RETRY_EXHAUSTED';
            assignment.controlFailureMethod = 'SUBSCRIBE';
          }
        }
      } else if (input.accepted) {
        if (assignment.protected || assignment.ownerDemands.size > 0) {
          assignment.state = 'DESIRED';
          assignment.observedBeforeAck = false;
          assignment.lastObservedAtMs = null;
          assignment.subscriptionCreatedAtMs = null;
          assignment.controlAttempts.UNSUBSCRIBE = 0;
          assignment.controlFailure = null;
          assignment.controlFailureMethod = null;
        } else {
          this.#rememberRelease(key, observedAtMs);
          this.#assignments.delete(key);
        }
      } else {
        assignment.state = pending.previousStates.get(key) ?? 'DESIRED';
        if (this.#retriesExhausted(assignment, 'UNSUBSCRIBE')) {
          assignment.controlFailure = 'CONTROL_RETRY_EXHAUSTED';
          assignment.controlFailureMethod = 'UNSUBSCRIBE';
        }
      }
    }
    return true;
  }

  observe(input: FocusStreamObservation): boolean {
    const observedAtMs = safeTime(input.observedAtMs, 'focus stream observation time');
    const now = safeTime(this.#ports.clock.nowMs(), 'focus runtime clock');
    if (observedAtMs > now) throw new RangeError('focus stream observation cannot be in the future');
    safeGeneration(input.generation);
    const stream = validIdentifier(input.stream, 'focus stream');
    const assignment = [...this.#assignments.values()].find((entry) => (
      entry.route === input.route && entry.connectionId === input.connectionId &&
      entry.generation === input.generation && entry.stream === stream
    ));
    if (assignment === undefined) return false;
    if (assignment.subscriptionCreatedAtMs === null || observedAtMs < assignment.subscriptionCreatedAtMs) {
      throw new RangeError('focus stream observation cannot precede its subscribe command');
    }
    if (assignment.lastObservedAtMs !== null && observedAtMs < assignment.lastObservedAtMs) {
      throw new RangeError('focus stream readiness observation cannot regress');
    }
    if (assignment.state === 'SUBSCRIBING') {
      assignment.observedBeforeAck = true;
      assignment.lastObservedAtMs = observedAtMs;
      return true;
    }
    if (assignment.state !== 'WARMING' && assignment.state !== 'READY') return false;
    assignment.state = 'READY';
    assignment.lastObservedAtMs = observedAtMs;
    return true;
  }

  reconcile(): FocusReconcileResult {
    const observedAtMs = safeTime(this.#ports.clock.nowMs());
    this.#pruneReleased(observedAtMs);
    const expiredControlReasons = this.#expirePendingControls(observedAtMs);
    const protectedSymbols = this.#readProtectedSymbols(observedAtMs);
    const plan = this.#ports.attentionPlans.readAttentionPlan(observedAtMs);
    if (plan === null) {
      for (const assignment of this.#assignments.values()) {
        if ([...assignment.ownerSymbols].some((symbol) => protectedSymbols.has(symbol))) assignment.protected = true;
      }
      const resourceReasons = new Map<string, FocusReasonCode[]>(expiredControlReasons);
      for (const demand of this.#lastDemands) {
        if (demand.resourceKey !== null) {
          resourceReasons.set(demand.resourceKey, reasons(
            resourceReasons.get(demand.resourceKey), 'ATTENTION_PLAN_UNAVAILABLE',
          ));
        }
      }
      return {
        snapshot: this.#snapshot(
          observedAtMs,
          null,
          this.#lastDemands,
          resourceReasons,
          ['ATTENTION_PLAN_UNAVAILABLE'],
          this.#protectedSnapshot(protectedSymbols, new Set<string>(), this.#lastDemands),
          0,
          0,
        ),
        commands: Object.freeze([]),
      };
    }

    if (typeof plan.id !== 'string' || plan.id.length < 1 || plan.id.length > 160) throw new TypeError('invalid attention plan id');
    safeTime(plan.atMs, 'attention plan time');
    if (plan.atMs > observedAtMs) throw new RangeError('attention plan time cannot be in the future');
    if (plan.allocations.length > this.#config.maximumAttentionAllocations) {
      throw new RangeError('attention allocation input exceeds focus safety bound');
    }
    const capabilities = this.#ports.capabilities.readCapabilities(observedAtMs);
    if (capabilities.length > this.#config.maximumCapabilities) {
      throw new RangeError('focus capability input exceeds safety bound');
    }
    const deliveries = this.#ports.deliveries.readDeliveredEvidence(observedAtMs);
    if (deliveries.length > this.#config.maximumRequirements) {
      throw new RangeError('focus delivery input exceeds safety bound');
    }
    for (const delivery of deliveries) {
      validIdentifier(delivery.attentionInstrumentId, 'focus delivery instrument id');
      validIdentifier(delivery.sourceId, 'focus delivery source id');
      if (delivery.productFamily !== 'SPOT' && delivery.productFamily !== 'USD_M_PERPETUAL') {
        throw new TypeError('focus delivery product family is invalid');
      }
      if (!EVIDENCE_KINDS.includes(delivery.evidenceKind)) throw new TypeError('focus delivery evidence kind is invalid');
      if (!['FRESH', 'WARMING', 'STALE', 'UNAVAILABLE'].includes(delivery.state)) {
        throw new TypeError('focus delivery state is invalid');
      }
      safeTime(delivery.observedAtMs, 'focus delivery observation time');
      if (delivery.observedAtMs > observedAtMs) throw new RangeError('focus delivery observation cannot be in the future');
    }
    const capabilityByInstrument = new Map<string, (typeof capabilities)[number]>();
    for (const capability of capabilities) {
      const instrumentId = validIdentifier(capability.attentionInstrumentId, 'focus capability instrument id');
      if (capabilityByInstrument.has(instrumentId)) throw new TypeError('duplicate focus capability instrument id');
      capabilityByInstrument.set(instrumentId, capability);
    }

    const allocationSymbols = new Set<string>();
    const allocationIds = new Set<string>();
    const demands: FocusDemand[] = [];
    const allocations = [...plan.allocations].sort((left, right) => compareString(left.instrumentId, right.instrumentId));
    for (const allocation of allocations) {
      validIdentifier(allocation.instrumentId, 'attention allocation instrument id');
      if (allocationIds.has(allocation.instrumentId)) throw new TypeError('duplicate attention allocation instrument id');
      allocationIds.add(allocation.instrumentId);
      const symbol = normalizedSymbol(allocation.symbol);
      allocationSymbols.add(symbol);
      safeTime(allocation.enteredAtMs, 'allocation entered time');
      if (allocation.enteredAtMs > plan.atMs) throw new RangeError('allocation entered time cannot exceed plan time');
      if (allocation.lastSignalAtMs !== null) safeTime(allocation.lastSignalAtMs, 'allocation signal time');
      if (allocation.lastSignalAtMs !== null && allocation.lastSignalAtMs > plan.atMs) {
        throw new RangeError('allocation signal time cannot exceed plan time');
      }
      if (allocation.priority !== null && !Number.isFinite(allocation.priority)) throw new TypeError('allocation priority must be finite or null');
      if (!ATTENTION_TIERS.includes(allocation.tier)) throw new TypeError('allocation tier is invalid');
      if (allocation.requestedEvidence.length > this.#config.maximumRequirementsPerAllocation) {
        throw new RangeError('allocation evidence profile exceeds focus safety bound');
      }
      if (new Set(allocation.requestedEvidence).size !== allocation.requestedEvidence.length) {
        throw new TypeError('allocation evidence profile contains duplicates');
      }
      if (!allocation.requestedEvidence.every((kind) => EVIDENCE_KINDS.includes(kind))) {
        throw new TypeError('allocation evidence profile contains an unknown kind');
      }
      if (allocation.tier === 'RELEASED') continue;
      const effective: AttentionAllocation = protectedSymbols.has(symbol) && !allocation.protected
        ? { ...allocation, protected: true }
        : allocation;
      const capability = capabilityByInstrument.get(allocation.instrumentId);
      let produced: FocusDemand[];
      if (capability === undefined) {
        produced = unavailableDemands(effective, 'CAPABILITY_UNAVAILABLE');
      } else {
        try {
          if (normalizedSymbol(capability.symbol) !== symbol) throw new TypeError('focus capability symbol mismatch');
          produced = buildFocusDemands(effective, capability, deliveries);
        } catch {
          produced = unavailableDemands(effective, 'INVALID_CAPABILITY');
        }
      }
      if (produced.length > this.#config.maximumRequirementsPerAllocation) {
        throw new RangeError('mapped focus requirements exceed per-allocation safety bound');
      }
      if (demands.length + produced.length > this.#config.maximumRequirements) {
        throw new RangeError('mapped focus requirements exceed safety bound');
      }
      demands.push(...produced);
    }

    const physical = this.#physicalDemands(demands);
    for (const assignment of this.#assignments.values()) {
      const desired = physical.get(assignment.resourceKey);
      assignment.protected = desired?.protected === true || [...assignment.ownerSymbols].some((symbol) => protectedSymbols.has(symbol));
      if (desired === undefined) {
        assignment.ownerDemands.clear();
      }
    }

    const resourceReasons = new Map<string, FocusReasonCode[]>(expiredControlReasons);
    const selected = new Set<string>();
    const routeSelected = new Map<FocusRoute, number>(FOCUS_ROUTES.map((route) => [route, 0]));
    let retainedByHysteresis = 0;

    for (const assignment of [...this.#assignments.values()].sort((left, right) => compareString(left.resourceKey, right.resourceKey))) {
      const routeAvailable = this.#availableConnections(assignment.route).length > 0;
      const pinForLease = observedAtMs < assignment.leaseUntilMs;
      if (assignment.protected || pinForLease || !routeAvailable) {
        selected.add(assignment.resourceKey);
        routeSelected.set(assignment.route, (routeSelected.get(assignment.route) ?? 0) + 1);
        if (!physical.has(assignment.resourceKey) && pinForLease && !assignment.protected) retainedByHysteresis += 1;
        if (!routeAvailable && physical.has(assignment.resourceKey)) {
          resourceReasons.set(assignment.resourceKey, ['SOURCE_UNAVAILABLE']);
        }
      }
    }

    const ranked = [...physical.values()].sort((left, right) => this.#comparePhysical(left, right));
    for (const candidate of ranked) {
      if (selected.has(candidate.resourceKey)) continue;
      const releasedAtMs = this.#releasedAtMs.get(candidate.resourceKey);
      if (
        !candidate.protected && releasedAtMs !== undefined &&
        observedAtMs - releasedAtMs < this.#config.resubscribeCooldownMs
      ) {
        resourceReasons.set(candidate.resourceKey, ['LEASE_HYSTERESIS_ACTIVE']);
        continue;
      }
      const available = this.#availableConnections(candidate.route);
      if (available.length === 0) {
        resourceReasons.set(candidate.resourceKey, ['SOURCE_UNAVAILABLE']);
        continue;
      }
      const routeCapacity = available.length * this.#config.routes[candidate.route].maximumStreamsPerConnection;
      if (selected.size >= this.#config.maximumTotalStreams || (routeSelected.get(candidate.route) ?? 0) >= routeCapacity) {
        resourceReasons.set(candidate.resourceKey, ['STREAM_BUDGET_EXHAUSTED']);
        continue;
      }
      selected.add(candidate.resourceKey);
      this.#releasedAtMs.delete(candidate.resourceKey);
      routeSelected.set(candidate.route, (routeSelected.get(candidate.route) ?? 0) + 1);
    }

    const unsubscribe = new Map<string, string[]>();
    for (const assignment of [...this.#assignments.values()].sort((left, right) => compareString(left.resourceKey, right.resourceKey))) {
      if (selected.has(assignment.resourceKey) || this.#hasPendingFor(assignment.resourceKey)) continue;
      const assignmentConnection = this.#connections.get(assignment.connectionId);
      if (assignment.state === 'DESIRED' || assignmentConnection?.state !== 'AVAILABLE') {
        this.#rememberRelease(assignment.resourceKey, observedAtMs);
        this.#assignments.delete(assignment.resourceKey);
        continue;
      }
      if (assignment.controlFailure !== null) {
        resourceReasons.set(assignment.resourceKey, reasons(
          resourceReasons.get(assignment.resourceKey), assignment.controlFailure,
        ));
        continue;
      }
      const list = unsubscribe.get(assignment.connectionId) ?? [];
      list.push(assignment.resourceKey);
      unsubscribe.set(assignment.connectionId, list);
    }

    for (const candidate of ranked) {
      if (!selected.has(candidate.resourceKey)) continue;
      const existing = this.#assignments.get(candidate.resourceKey);
      if (existing !== undefined) {
        existing.protected = candidate.protected;
        existing.ownerDemands = new Map(candidate.owners.map((owner) => [owner.id, owner]));
        existing.ownerSymbols = new Set(candidate.owners.map((owner) => owner.symbol));
        if (existing.controlFailureMethod === 'UNSUBSCRIBE') {
          existing.state = 'DESIRED';
          existing.controlAttempts.UNSUBSCRIBE = 0;
          existing.controlFailure = null;
          existing.controlFailureMethod = null;
          existing.subscriptionCreatedAtMs = null;
          existing.lastObservedAtMs = null;
          existing.observedBeforeAck = false;
        }
        const currentConnection = this.#connections.get(existing.connectionId);
        if (currentConnection?.state !== 'AVAILABLE') {
          const replacement = this.#chooseConnection(candidate.route, existing.resourceKey);
          if (replacement !== null) {
            existing.connectionId = replacement.connectionId;
            existing.generation = replacement.generation;
            existing.state = 'DESIRED';
            existing.observedBeforeAck = false;
            existing.lastObservedAtMs = null;
            existing.subscriptionCreatedAtMs = null;
            existing.controlAttempts = { SUBSCRIBE: 0, UNSUBSCRIBE: 0 };
            existing.controlFailure = null;
            existing.controlFailureMethod = null;
          }
        }
        continue;
      }
      if (this.#assignments.size >= this.#config.maximumTotalStreams) {
        resourceReasons.set(candidate.resourceKey, reasons(
          resourceReasons.get(candidate.resourceKey), 'CONNECTION_BUDGET_EXHAUSTED',
        ));
        continue;
      }
      const connection = this.#chooseConnection(candidate.route);
      if (connection === null) {
        resourceReasons.set(candidate.resourceKey, reasons(
          resourceReasons.get(candidate.resourceKey), 'CONNECTION_BUDGET_EXHAUSTED',
        ));
        continue;
      }
      this.#assignments.set(candidate.resourceKey, {
        resourceKey: candidate.resourceKey,
        route: candidate.route,
        stream: candidate.stream,
        sourceId: candidate.sourceId,
        connectionId: connection.connectionId,
        generation: connection.generation,
        state: 'DESIRED',
        protected: candidate.protected,
        ownerDemands: new Map(candidate.owners.map((owner) => [owner.id, owner])),
        ownerSymbols: new Set(candidate.owners.map((owner) => owner.symbol)),
        leaseUntilMs: observedAtMs + this.#config.minimumLeaseMs,
        lastObservedAtMs: null,
        subscriptionCreatedAtMs: null,
        observedBeforeAck: false,
        controlAttempts: { SUBSCRIBE: 0, UNSUBSCRIBE: 0 },
        controlFailure: null,
        controlFailureMethod: null,
      });
    }

    const subscribe = new Map<string, string[]>();
    for (const assignment of [...this.#assignments.values()].sort((left, right) => compareString(left.resourceKey, right.resourceKey))) {
      if (!selected.has(assignment.resourceKey)
        || (!physical.has(assignment.resourceKey) && !assignment.protected)
        || assignment.state !== 'DESIRED') continue;
      if (assignment.controlFailure !== null) {
        resourceReasons.set(assignment.resourceKey, reasons(
          resourceReasons.get(assignment.resourceKey), assignment.controlFailure,
        ));
        continue;
      }
      if (this.#hasPendingFor(assignment.resourceKey)) continue;
      const connection = this.#connections.get(assignment.connectionId);
      if (connection?.state !== 'AVAILABLE' || connection.generation !== assignment.generation) {
        resourceReasons.set(assignment.resourceKey, reasons(resourceReasons.get(assignment.resourceKey), 'SOURCE_UNAVAILABLE'));
        continue;
      }
      const list = subscribe.get(assignment.connectionId) ?? [];
      list.push(assignment.resourceKey);
      subscribe.set(assignment.connectionId, list);
    }

    const deferred = new Map<string, FocusReasonCode[]>();
    const commands = this.#emitControlBatches(observedAtMs, unsubscribe, subscribe, deferred);
    for (const [key, value] of deferred) {
      resourceReasons.set(key, reasons(resourceReasons.get(key), value));
    }

    this.#lastPlanId = plan.id;
    this.#lastDemands = [...demands].sort((left, right) => compareString(left.id, right.id));
    const protectedSnapshot = this.#protectedSnapshot(protectedSymbols, allocationSymbols, demands);
    const snapshot = this.#snapshot(
      observedAtMs,
      plan.id,
      this.#lastDemands,
      resourceReasons,
      [],
      protectedSnapshot,
      plan.allocations.length,
      retainedByHysteresis,
    );
    return { snapshot, commands: Object.freeze(commands) };
  }

  #readProtectedSymbols(observedAtMs: number): Set<string> {
    const values = this.#ports.protectedSymbols.protectedSymbols(observedAtMs);
    if (values.length > this.#config.maximumProtectedSymbols) {
      throw new RangeError('protected symbol input exceeds focus safety bound');
    }
    return new Set(values.map(normalizedSymbol));
  }

  #physicalDemands(demands: readonly FocusDemand[]): Map<string, PhysicalDemand> {
    const output = new Map<string, PhysicalDemand>();
    for (const demand of demands) {
      if (
        demand.transport !== 'WEBSOCKET' || demand.resourceKey === null || demand.route === null ||
        demand.streamOrPath === null || demand.sourceId === null
      ) continue;
      const existing = output.get(demand.resourceKey);
      if (existing === undefined) {
        output.set(demand.resourceKey, {
          resourceKey: demand.resourceKey,
          route: demand.route,
          stream: demand.streamOrPath,
          sourceId: demand.sourceId,
          owners: [demand],
          protected: demand.protected,
        });
      } else {
        if (existing.route !== demand.route || existing.stream !== demand.streamOrPath || existing.sourceId !== demand.sourceId) {
          throw new TypeError('focus physical stream identity collision');
        }
        existing.owners.push(demand);
        existing.protected ||= demand.protected;
      }
    }
    for (const entry of output.values()) entry.owners.sort(compareDemand);
    return output;
  }

  #comparePhysical(left: PhysicalDemand, right: PhysicalDemand): number {
    const demand = compareDemandPriority(left.owners[0], right.owners[0]);
    if (demand !== 0) return demand;
    const leftIncumbent = this.#assignments.has(left.resourceKey);
    const rightIncumbent = this.#assignments.has(right.resourceKey);
    if (leftIncumbent !== rightIncumbent) return leftIncumbent ? -1 : 1;
    if (left.owners[0].enteredAtMs !== right.owners[0].enteredAtMs) {
      return left.owners[0].enteredAtMs - right.owners[0].enteredAtMs;
    }
    return compareString(left.owners[0].attentionInstrumentId, right.owners[0].attentionInstrumentId) ||
      compareString(left.resourceKey, right.resourceKey);
  }

  #availableConnections(route: FocusRoute): InternalConnection[] {
    return [...this.#connections.values()]
      .filter((entry) => entry.route === route && entry.state === 'AVAILABLE')
      .sort((left, right) => compareString(left.connectionId, right.connectionId));
  }

  #chooseConnection(route: FocusRoute, movingResourceKey?: string): InternalConnection | null {
    const counts = new Map<string, number>();
    for (const assignment of this.#assignments.values()) {
      if (assignment.resourceKey === movingResourceKey) continue;
      counts.set(assignment.connectionId, (counts.get(assignment.connectionId) ?? 0) + 1);
    }
    const maximum = this.#config.routes[route].maximumStreamsPerConnection;
    return this.#availableConnections(route)
      .filter((entry) => (counts.get(entry.connectionId) ?? 0) < maximum)
      .sort((left, right) => (
        (counts.get(left.connectionId) ?? 0) - (counts.get(right.connectionId) ?? 0) ||
        compareString(left.connectionId, right.connectionId)
      ))[0] ?? null;
  }

  #hasPendingFor(resourceKey: string): boolean {
    for (const pending of this.#pending.values()) if (pending.resourceKeys.includes(resourceKey)) return true;
    return false;
  }

  #retriesExhausted(assignment: InternalAssignment, method: 'SUBSCRIBE' | 'UNSUBSCRIBE'): boolean {
    return assignment.controlAttempts[method] > this.#config.maximumControlRetries;
  }

  #expirePendingControls(observedAtMs: number): Map<string, FocusReasonCode[]> {
    const output = new Map<string, FocusReasonCode[]>();
    for (const [id, pending] of [...this.#pending].sort((left, right) => left[0] - right[0])) {
      if (observedAtMs - pending.batch.createdAtMs < this.#config.controlAcknowledgementTimeoutMs) continue;
      this.#pending.delete(id);
      for (const key of pending.resourceKeys) {
        const assignment = this.#assignments.get(key);
        if (assignment === undefined || assignment.connectionId !== pending.batch.connectionId
          || assignment.generation !== pending.batch.generation) continue;
        if (pending.batch.method === 'SUBSCRIBE' && assignment.observedBeforeAck
          && assignment.lastObservedAtMs !== null) {
          assignment.state = 'READY';
          assignment.controlAttempts.SUBSCRIBE = 0;
          assignment.controlFailure = null;
          assignment.controlFailureMethod = null;
          continue;
        }
        output.set(key, reasons(output.get(key), 'CONTROL_ACK_TIMEOUT'));
        if (pending.batch.method === 'SUBSCRIBE') {
          assignment.state = 'DESIRED';
          assignment.observedBeforeAck = false;
          assignment.lastObservedAtMs = null;
          assignment.subscriptionCreatedAtMs = null;
        } else if (assignment.protected || assignment.ownerDemands.size > 0) {
          assignment.state = 'DESIRED';
          assignment.observedBeforeAck = false;
          assignment.lastObservedAtMs = null;
          assignment.subscriptionCreatedAtMs = null;
        } else {
          assignment.state = pending.previousStates.get(key) ?? 'DESIRED';
        }
        if (this.#retriesExhausted(assignment, pending.batch.method)) {
          assignment.controlFailure = 'CONTROL_RETRY_EXHAUSTED';
          assignment.controlFailureMethod = pending.batch.method;
          output.set(key, reasons(output.get(key), 'CONTROL_RETRY_EXHAUSTED'));
        }
      }
    }
    return output;
  }

  #emitControlBatches(
    observedAtMs: number,
    unsubscribe: ReadonlyMap<string, string[]>,
    subscribe: ReadonlyMap<string, string[]>,
    deferred: Map<string, FocusReasonCode[]>,
  ): FocusControlBatch[] {
    const commands: FocusControlBatch[] = [];
    for (const method of ['UNSUBSCRIBE', 'SUBSCRIBE'] as const) {
      const groups = method === 'UNSUBSCRIBE' ? unsubscribe : subscribe;
      for (const connectionIdValue of [...groups.keys()].sort(compareString)) {
        const connection = this.#connections.get(connectionIdValue);
        if (connection === undefined || connection.state !== 'AVAILABLE') {
          for (const key of groups.get(connectionIdValue) ?? []) deferred.set(key, ['SOURCE_UNAVAILABLE']);
          continue;
        }
        const keys = [...(groups.get(connectionIdValue) ?? [])].sort(compareString);
        for (let offset = 0; offset < keys.length; offset += this.#config.maximumStreamsPerControlMessage) {
          const chunk = keys.slice(offset, offset + this.#config.maximumStreamsPerControlMessage);
          if (this.#pending.size >= this.#config.maximumPendingControlMessages) {
            for (const key of chunk) deferred.set(key, reasons(deferred.get(key), 'PENDING_CONTROL_QUEUE_FULL'));
            continue;
          }
          const decision = connection.throttle.acquire(1, observedAtMs);
          if (!decision.allowed) {
            for (const key of chunk) deferred.set(key, reasons(deferred.get(key), 'CONTROL_RATE_DEFERRED'));
            continue;
          }
          const id = this.#allocateControlId();
          const params = chunk.map((key) => this.#assignments.get(key)?.stream)
            .filter((value): value is string => value !== undefined)
            .sort(compareString);
          if (params.length === 0) continue;
          const batch: FocusControlBatch = Object.freeze({
            id,
            route: connection.route,
            connectionId: connection.connectionId,
            generation: connection.generation,
            method,
            params: Object.freeze(params),
            createdAtMs: observedAtMs,
          });
          const previousStates = new Map<string, FocusStreamState>();
          for (const key of chunk) {
            const assignment = this.#assignments.get(key);
            if (assignment === undefined) continue;
            previousStates.set(key, assignment.state);
            assignment.state = method === 'SUBSCRIBE' ? 'SUBSCRIBING' : 'UNSUBSCRIBING';
            assignment.controlAttempts[method] += 1;
            if (method === 'SUBSCRIBE') {
              assignment.subscriptionCreatedAtMs = observedAtMs;
              assignment.lastObservedAtMs = null;
              assignment.observedBeforeAck = false;
            }
          }
          this.#pending.set(id, { batch, resourceKeys: chunk, previousStates });
          commands.push(batch);
        }
      }
    }
    return commands;
  }

  #allocateControlId(): number {
    for (let attempts = 0; attempts <= this.#config.maximumPendingControlMessages; attempts += 1) {
      const candidate = this.#nextControlId;
      this.#nextControlId = candidate === Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
      if (!this.#pending.has(candidate)) return candidate;
    }
    throw new RangeError('no bounded focus control id is available');
  }

  #rememberRelease(resourceKey: string, observedAtMs: number): void {
    if (this.#config.resubscribeCooldownMs === 0) return;
    this.#releasedAtMs.set(resourceKey, observedAtMs);
    if (this.#releasedAtMs.size <= this.#config.maximumTotalStreams) return;
    const oldest = [...this.#releasedAtMs]
      .sort((left, right) => left[1] - right[1] || compareString(left[0], right[0]))[0];
    if (oldest !== undefined) this.#releasedAtMs.delete(oldest[0]);
  }

  #pruneReleased(observedAtMs: number): void {
    if (this.#config.resubscribeCooldownMs === 0) {
      this.#releasedAtMs.clear();
      return;
    }
    for (const [key, releasedAtMs] of this.#releasedAtMs) {
      if (observedAtMs - releasedAtMs >= this.#config.resubscribeCooldownMs) this.#releasedAtMs.delete(key);
    }
  }

  #invalidateConnection(connection: InternalConnection): void {
    for (const [id, pending] of [...this.#pending]) {
      if (pending.batch.connectionId === connection.connectionId) this.#pending.delete(id);
    }
    for (const assignment of this.#assignments.values()) {
      if (assignment.connectionId !== connection.connectionId) continue;
      assignment.generation = connection.generation;
      assignment.state = 'DESIRED';
      assignment.lastObservedAtMs = null;
      assignment.subscriptionCreatedAtMs = null;
      assignment.observedBeforeAck = false;
      assignment.controlAttempts = { SUBSCRIBE: 0, UNSUBSCRIBE: 0 };
      assignment.controlFailure = null;
      assignment.controlFailureMethod = null;
    }
  }

  #protectedSnapshot(
    protectedSymbols: ReadonlySet<string>,
    allocationSymbols: ReadonlySet<string>,
    demands: readonly FocusDemand[],
  ): FocusProtectedSymbolSnapshot[] {
    const union = new Set(protectedSymbols);
    for (const demand of demands) if (demand.protected) union.add(demand.symbol);
    return [...union].sort(compareString).map((symbol) => {
      const assigned = [...this.#assignments.values()].some((entry) => entry.ownerSymbols.has(symbol));
      const inPlan = allocationSymbols.has(symbol);
      const staticallyAllocated = demands.some((demand) => (
        demand.symbol === symbol && (demand.transport === 'REUSED_BROAD' || demand.transport === 'REST')
      ));
      if (assigned || staticallyAllocated) {
        return Object.freeze({
          symbol,
          state: inPlan ? 'ALLOCATED' : 'PRESERVED',
          reasonCodes: Object.freeze(inPlan ? [] : ['PROTECTED_SYMBOL_NOT_IN_ATTENTION_PLAN'] as FocusReasonCode[]),
        });
      }
      return Object.freeze({
        symbol,
        state: 'UNRESOLVED',
        reasonCodes: Object.freeze(['PROTECTED_SYMBOL_UNRESOLVED'] as FocusReasonCode[]),
      });
    });
  }

  #requirementSnapshot(
    demand: FocusDemand,
    resourceReasons: ReadonlyMap<string, FocusReasonCode[]>,
    globalReasons: readonly FocusReasonCode[],
  ): FocusRequirementSnapshot {
    if (demand.transport === 'REUSED_BROAD') {
      return Object.freeze({
        ...this.#requirementBase(demand),
        state: 'REUSED_BROAD',
        reasonCodes: Object.freeze(reasons(demand.initialReason, globalReasons)),
        connectionId: null,
      });
    }
    if (demand.transport === 'REST') {
      return Object.freeze({
        ...this.#requirementBase(demand),
        state: 'REST_INTENT',
        reasonCodes: Object.freeze(reasons(demand.initialReason, globalReasons)),
        connectionId: null,
      });
    }
    if (demand.transport === 'UNAVAILABLE' || demand.resourceKey === null) {
      return Object.freeze({
        ...this.#requirementBase(demand),
        state: 'UNFULFILLED',
        reasonCodes: Object.freeze(reasons(demand.initialReason, globalReasons)),
        connectionId: null,
      });
    }
    const assignment = this.#assignments.get(demand.resourceKey);
    const dynamicReasons = reasons(
      resourceReasons.get(demand.resourceKey), assignment?.controlFailure ?? undefined, globalReasons,
    );
    if (assignment === undefined || hardUnfulfilled(dynamicReasons)) {
      return Object.freeze({
        ...this.#requirementBase(demand),
        state: 'UNFULFILLED',
        reasonCodes: Object.freeze(reasons(
          dynamicReasons.length > 0 ? dynamicReasons : ['CONNECTION_BUDGET_EXHAUSTED'],
        )),
        connectionId: null,
      });
    }
    const state = assignment.state === 'SUBSCRIBING'
      ? 'SUBSCRIBING'
      : assignment.state === 'WARMING'
        ? 'WARMING'
        : assignment.state === 'READY'
          ? 'READY'
          : 'DESIRED';
    const lifecycleReason: FocusReasonCode = state === 'SUBSCRIBING'
      ? 'WAITING_FOR_SUBSCRIBE_ACK'
      : state === 'WARMING'
        ? 'WARMING_FIRST_MESSAGE'
        : 'WEBSOCKET_ALLOCATED';
    return Object.freeze({
      ...this.#requirementBase(demand),
      state,
      reasonCodes: Object.freeze(reasons(lifecycleReason, dynamicReasons)),
      connectionId: assignment.connectionId,
    });
  }

  #requirementBase(demand: FocusDemand): Omit<FocusRequirementSnapshot, 'state' | 'reasonCodes' | 'connectionId'> {
    return {
      id: demand.id,
      attentionInstrumentId: demand.attentionInstrumentId,
      symbol: demand.symbol,
      productFamily: demand.productFamily,
      evidenceKind: demand.evidenceKind,
      tier: demand.tier,
      priority: demand.priority,
      protected: demand.protected,
      transport: demand.transport,
      route: demand.route,
      streamOrPath: demand.streamOrPath,
      sourceId: demand.sourceId,
    };
  }

  #snapshot(
    observedAtMs: number,
    planId: string | null,
    demands: readonly FocusDemand[],
    resourceReasons: ReadonlyMap<string, FocusReasonCode[]>,
    globalReasons: readonly FocusReasonCode[],
    protectedSymbols: readonly FocusProtectedSymbolSnapshot[],
    allocationsRead: number,
    retainedByHysteresis: number,
  ): FocusAllocatorSnapshot {
    const requirements = demands
      .map((demand) => this.#requirementSnapshot(demand, resourceReasons, globalReasons))
      .sort((left, right) => compareString(left.id, right.id));
    const streams: FocusStreamSnapshot[] = [...this.#assignments.values()]
      .sort((left, right) => compareString(left.resourceKey, right.resourceKey))
      .map((assignment) => Object.freeze({
        resourceKey: assignment.resourceKey,
        route: assignment.route,
        stream: assignment.stream,
        sourceId: assignment.sourceId,
        connectionId: assignment.connectionId,
        generation: assignment.generation,
        state: assignment.state,
        protected: assignment.protected,
        ownerRequirementIds: Object.freeze([...assignment.ownerDemands.keys()].sort(compareString)),
        leaseUntilMs: assignment.leaseUntilMs,
        lastObservedAtMs: assignment.lastObservedAtMs,
      }));
    const connections: FocusConnectionSnapshot[] = [...this.#connections.values()]
      .sort((left, right) => compareString(left.connectionId, right.connectionId))
      .map((connection) => Object.freeze({
        route: connection.route,
        connectionId: connection.connectionId,
        generation: connection.generation,
        state: connection.state,
        allocatedStreams: streams.filter((entry) => entry.connectionId === connection.connectionId).length,
        maximumStreams: this.#config.routes[connection.route].maximumStreamsPerConnection,
        throttle: connection.throttle.snapshot(observedAtMs),
      }));
    const pending = [...this.#pending.values()].map((entry) => entry.batch).sort((left, right) => left.id - right.id);
    return Object.freeze({
      planId,
      lastAppliedPlanId: this.#lastPlanId,
      observedAtMs,
      reasonCodes: Object.freeze(reasons(globalReasons)),
      protectedSymbols: Object.freeze([...protectedSymbols]),
      requirements: Object.freeze(requirements),
      streams: Object.freeze(streams),
      connections: Object.freeze(connections),
      pendingControlMessages: Object.freeze(pending),
      counts: Object.freeze({
        allocationsRead,
        requirements: requirements.length,
        reusedBroad: requirements.filter((entry) => entry.state === 'REUSED_BROAD').length,
        restIntents: requirements.filter((entry) => entry.state === 'REST_INTENT').length,
        websocketStreams: streams.length,
        readyRequirements: requirements.filter((entry) => entry.state === 'READY' || entry.state === 'REUSED_BROAD').length,
        warmingRequirements: requirements.filter((entry) => entry.state === 'WARMING' || entry.state === 'SUBSCRIBING').length,
        unfulfilledRequirements: requirements.filter((entry) => entry.state === 'UNFULFILLED').length,
        pendingControlMessages: pending.length,
        retainedByHysteresis,
        cooldownDeferredRequirements: requirements.filter((entry) => (
          entry.reasonCodes.includes('LEASE_HYSTERESIS_ACTIVE')
        )).length,
      }),
    });
  }
}
