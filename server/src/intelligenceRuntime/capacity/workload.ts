import {
  stableId,
  type InstrumentIdentity,
} from '../../intelligenceFoundation/contracts/index.js';
import { FuturesRuntimeAdapter } from '../futures/index.js';
import {
  BoundedInboundQueue,
  BoundedProcessingLagMetrics,
  type BoundedQueueSnapshot,
  type InboundQueueMode,
} from '../lifecycle/index.js';
import { SpotBroadReducer } from '../spot/index.js';
import { measureRetainedStructures } from './memory.js';
import {
  CAPACITY_ATTENTION_CEILINGS,
  CAPACITY_CHANNELS,
  CAPACITY_MODEL_LIMITS,
  CAPACITY_OVERLOAD_STATES,
  CAPACITY_QUEUE_CLASSES,
  type CapacityBurstWindow,
  type CapacityChannel,
  type CapacityChannelStats,
  type CapacityFocusAllocation,
  type CapacityFocusSnapshot,
  type CapacityOverloadPolicy,
  type CapacityOverloadState,
  type CapacityQueueClass,
  type CapacityQueueStats,
  type CapacityTransition,
  type CapacityWorkloadPlan,
  type CapacityWorkloadPlanInput,
  type DeterministicCapacityReport,
} from './types.js';

const CONFIGURATION_VERSION = 'capacity-model-1' as const;
const DENOMINATOR = 10_000_000n;
const BASE_MULTIPLIER_BPS = 10_000n;
const RECENT_TRADES_PER_SYMBOL = 16;

const DEFAULT_RATES: Readonly<Record<CapacityChannel, number>> = Object.freeze({
  SPOT_MINI_TICKER: 20,
  USD_M_BOOK_TICKER: 500,
  USD_M_MARK_FUNDING: 20,
  SPOT_AGG_TRADE: 200,
  SPOT_DEPTH_DELTA: 200,
  OPTIONAL_LIQUIDATION: 50,
});

const DEFAULT_QUEUE_CAPACITIES: Readonly<Record<CapacityQueueClass, number>> = Object.freeze({
  CORE_BROAD: 512,
  PROTECTED_FOCUS: 128,
  FOCUS: 256,
  OPTIONAL: 128,
});

const DEFAULT_DRAIN: Readonly<Record<CapacityQueueClass, number>> = Object.freeze({
  CORE_BROAD: 40,
  PROTECTED_FOCUS: 20,
  FOCUS: 20,
  OPTIONAL: 10,
});

const DEFAULT_OVERLOAD: Readonly<CapacityOverloadPolicy> = Object.freeze({
  pressureQueueBps: 6_500,
  shedQueueBps: 8_000,
  criticalQueueBps: 9_500,
  recoveryQueueBps: 5_000,
  pressureLagMs: 250,
  shedLagMs: 750,
  criticalLagMs: 2_000,
  recoveryLagMs: 100,
  recoveryTicks: 5,
});

interface MutableChannelStats extends CapacityChannelStats {}

interface QueueAccumulator {
  evictedReplaceable: number;
  ignoredOlder: number;
}

interface CapacityEvent {
  id: string;
  channel: CapacityChannel;
  symbol: string;
  receiveTimeMs: number;
  payload: unknown;
  sequence: number | null;
}

interface DepthState {
  lastSequence: number;
  processed: number;
  protected: boolean;
}

class ManualClock {
  #nowMs: number;
  constructor(nowMs: number) { this.#nowMs = nowMs; }
  nowMs(): number { return this.#nowMs; }
  set(nowMs: number): void { this.#nowMs = nowMs; }
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function generatedSymbols(): string[] {
  return Array.from({ length: CAPACITY_MODEL_LIMITS.symbolCount }, (_, index) => `S${String(index).padStart(4, '0')}USDT`);
}

function validateOverload(value: CapacityOverloadPolicy): void {
  for (const [name, threshold] of [
    ['recoveryQueueBps', value.recoveryQueueBps],
    ['pressureQueueBps', value.pressureQueueBps],
    ['shedQueueBps', value.shedQueueBps],
    ['criticalQueueBps', value.criticalQueueBps],
  ] as const) safeInteger(threshold, name, 0, 10_000);
  if (!(value.recoveryQueueBps < value.pressureQueueBps
    && value.pressureQueueBps < value.shedQueueBps
    && value.shedQueueBps < value.criticalQueueBps)) {
    throw new RangeError('queue overload thresholds must strictly increase from recovery to critical');
  }
  for (const [name, threshold] of [
    ['recoveryLagMs', value.recoveryLagMs],
    ['pressureLagMs', value.pressureLagMs],
    ['shedLagMs', value.shedLagMs],
    ['criticalLagMs', value.criticalLagMs],
  ] as const) safeInteger(threshold, name, 0, 86_400_000);
  if (!(value.recoveryLagMs <= value.pressureLagMs
    && value.pressureLagMs < value.shedLagMs
    && value.shedLagMs < value.criticalLagMs)) {
    throw new RangeError('lag overload thresholds must increase from recovery to critical');
  }
  safeInteger(value.recoveryTicks, 'recoveryTicks', 1, 10_000);
}

function validateBursts(
  input: readonly CapacityBurstWindow[],
  durationMs: number,
): readonly CapacityBurstWindow[] {
  if (!Array.isArray(input) || input.length > CAPACITY_MODEL_LIMITS.maximumBurstWindows) {
    throw new RangeError(`bursts exceed ${CAPACITY_MODEL_LIMITS.maximumBurstWindows}`);
  }
  const windows = input.map((window, index) => {
    if (!Array.isArray(window.channels) || window.channels.length === 0) throw new TypeError(`bursts[${index}].channels is required`);
    const channels = [...new Set<CapacityChannel>(window.channels as readonly CapacityChannel[])];
    if (channels.some((channel) => !CAPACITY_CHANNELS.includes(channel))) throw new TypeError(`bursts[${index}] has an invalid channel`);
    const startOffsetMs = safeInteger(window.startOffsetMs, `bursts[${index}].startOffsetMs`, 0, durationMs - 1);
    const windowDurationMs = safeInteger(window.durationMs, `bursts[${index}].durationMs`, 1, durationMs);
    if (startOffsetMs + windowDurationMs > durationMs) throw new RangeError(`bursts[${index}] exceeds workload duration`);
    const multiplierBps = safeInteger(
      window.multiplierBps,
      `bursts[${index}].multiplierBps`,
      10_000,
      CAPACITY_MODEL_LIMITS.maximumBurstMultiplierBps,
    );
    return Object.freeze({
      channels: Object.freeze(channels.sort()),
      startOffsetMs,
      durationMs: windowDurationMs,
      multiplierBps,
    });
  }).sort((left, right) => left.startOffsetMs - right.startOffsetMs
    || codePointCompare(left.channels.join(','), right.channels.join(',')));
  for (const channel of CAPACITY_CHANNELS) {
    const matching = windows.filter((window) => window.channels.includes(channel));
    for (let index = 1; index < matching.length; index += 1) {
      const prior = matching[index - 1] as CapacityBurstWindow;
      const current = matching[index] as CapacityBurstWindow;
      if (current.startOffsetMs < prior.startOffsetMs + prior.durationMs) {
        throw new RangeError(`burst windows for ${channel} must not overlap`);
      }
    }
  }
  return Object.freeze(windows);
}

function integratedMultiplierDurationBps(
  bursts: readonly CapacityBurstWindow[],
  channel: CapacityChannel,
  intervalStartOffsetMs: number,
  intervalEndOffsetMs: number,
): bigint {
  let weightedDurationBps = BigInt(intervalEndOffsetMs - intervalStartOffsetMs) * BASE_MULTIPLIER_BPS;
  for (const window of bursts) {
    if (!window.channels.includes(channel)) continue;
    const overlapStartMs = Math.max(intervalStartOffsetMs, window.startOffsetMs);
    const overlapEndMs = Math.min(intervalEndOffsetMs, window.startOffsetMs + window.durationMs);
    if (overlapEndMs <= overlapStartMs) continue;
    weightedDurationBps += BigInt(overlapEndMs - overlapStartMs)
      * (BigInt(window.multiplierBps) - BASE_MULTIPLIER_BPS);
  }
  return weightedDurationBps;
}

export function createCapacityWorkloadPlan(input: CapacityWorkloadPlanInput = {}): CapacityWorkloadPlan {
  const startTimeMs = safeInteger(input.startTimeMs ?? 1_720_000_000_000, 'startTimeMs', 0, Number.MAX_SAFE_INTEGER);
  const durationMs = safeInteger(input.durationMs ?? 5_000, 'durationMs', 1, CAPACITY_MODEL_LIMITS.maximumDurationMs);
  const tickMs = safeInteger(input.tickMs ?? 50, 'tickMs', 1, durationMs);
  if (durationMs % tickMs !== 0) throw new RangeError('durationMs must be exactly divisible by tickMs');
  if (durationMs / tickMs > CAPACITY_MODEL_LIMITS.maximumTicks) throw new RangeError('workload exceeds maximumTicks');
  if (!Number.isSafeInteger(startTimeMs + durationMs + 28_800_000)) throw new RangeError('workload timestamp range overflows');

  const ratesPerSecond = Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [
    channel,
    safeInteger(
      input.ratesPerSecond?.[channel] ?? DEFAULT_RATES[channel],
      `ratesPerSecond.${channel}`,
      0,
      CAPACITY_MODEL_LIMITS.maximumRatePerSecond,
    ),
  ])) as Record<CapacityChannel, number>;
  const bursts = validateBursts(input.bursts ?? [], durationMs);
  const queueCapacities = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [
    queueClass,
    safeInteger(
      input.queueCapacities?.[queueClass] ?? DEFAULT_QUEUE_CAPACITIES[queueClass],
      `queueCapacities.${queueClass}`,
      1,
      CAPACITY_MODEL_LIMITS.maximumQueueCapacity,
    ),
  ])) as Record<CapacityQueueClass, number>;
  const aggregateCapacity = Object.values(queueCapacities).reduce((sum, value) => sum + value, 0);
  if (aggregateCapacity > CAPACITY_MODEL_LIMITS.maximumAggregateQueueCapacity) throw new RangeError('aggregate queue capacity exceeds its hard bound');
  const drainPerTick = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [
    queueClass,
    safeInteger(
      input.drainPerTick?.[queueClass] ?? DEFAULT_DRAIN[queueClass],
      `drainPerTick.${queueClass}`,
      0,
      CAPACITY_MODEL_LIMITS.maximumQueueCapacity,
    ),
  ])) as Record<CapacityQueueClass, number>;

  const symbols = generatedSymbols();
  const protectedSymbols = [...new Set(input.focus?.protectedSymbols ?? [])].sort(codePointCompare);
  if (protectedSymbols.length > CAPACITY_MODEL_LIMITS.maximumProtectedSymbols) throw new RangeError('protected symbols exceed the hard bound');
  if (protectedSymbols.some((symbol) => !symbols.includes(symbol))) throw new TypeError('protected symbol is outside the synthetic 452-symbol universe');
  const focus = {
    watchCount: safeInteger(input.focus?.watchCount ?? 452, 'focus.watchCount', 0, CAPACITY_ATTENTION_CEILINGS.WATCH),
    candidateCount: safeInteger(input.focus?.candidateCount ?? 128, 'focus.candidateCount', 0, CAPACITY_ATTENTION_CEILINGS.CANDIDATE),
    focusRequestCount: safeInteger(input.focus?.focusRequestCount ?? 50, 'focus.focusRequestCount', 0, CAPACITY_MODEL_LIMITS.maximumFocusRequests),
    deepFocusCount: safeInteger(input.focus?.deepFocusCount ?? 10, 'focus.deepFocusCount', 0, CAPACITY_ATTENTION_CEILINGS.DEEP_FOCUS),
    focusCapacity: safeInteger(input.focus?.focusCapacity ?? 25, 'focus.focusCapacity', 1, CAPACITY_ATTENTION_CEILINGS.FOCUS),
    deepFocusCapacity: safeInteger(input.focus?.deepFocusCapacity ?? 10, 'focus.deepFocusCapacity', 0, CAPACITY_ATTENTION_CEILINGS.DEEP_FOCUS),
    protectedSymbols: Object.freeze(protectedSymbols),
  };
  if (focus.candidateCount > focus.watchCount || focus.focusRequestCount > focus.candidateCount) {
    throw new RangeError('focus counts must be cumulative within WATCH and CANDIDATE bounds');
  }
  if (focus.deepFocusCount > focus.focusRequestCount || focus.deepFocusCapacity > focus.focusCapacity) {
    throw new RangeError('deep-focus counts must fit the requested and delivered focus set');
  }
  if (protectedSymbols.length > focus.focusCapacity) {
    throw new RangeError('protected active capital exceeds focusCapacity');
  }
  const protectedOutsideRequested = protectedSymbols.filter((symbol) => symbols.indexOf(symbol) >= focus.focusRequestCount).length;
  if (focus.focusRequestCount + protectedOutsideRequested > CAPACITY_MODEL_LIMITS.maximumFocusRequests) {
    throw new RangeError('focus requests plus protected active capital exceed the hard bound');
  }
  const focusedRate = ratesPerSecond.SPOT_AGG_TRADE + ratesPerSecond.SPOT_DEPTH_DELTA;
  const focusedBurst = bursts.some((window) => window.channels.includes('SPOT_AGG_TRADE') || window.channels.includes('SPOT_DEPTH_DELTA'));
  if (focus.focusRequestCount === 0 && protectedSymbols.length === 0 && (focusedRate > 0 || focusedBurst)) {
    throw new RangeError('focused message rates require at least one requested or protected focus symbol');
  }
  const lagSamplesPerSource = safeInteger(
    input.lagSamplesPerSource ?? 4_096,
    'lagSamplesPerSource',
    1,
    CAPACITY_MODEL_LIMITS.maximumLagSamplesPerSource,
  );
  const overload = { ...DEFAULT_OVERLOAD, ...(input.overload ?? {}) };
  validateOverload(overload);

  let worstCaseMessages = 0n;
  for (const channel of CAPACITY_CHANNELS) {
    const integratedDurationBps = integratedMultiplierDurationBps(bursts, channel, 0, durationMs);
    worstCaseMessages += BigInt(ratesPerSecond[channel]) * integratedDurationBps / DENOMINATOR + 1n;
  }
  if (worstCaseMessages > BigInt(CAPACITY_MODEL_LIMITS.maximumSyntheticMessages)) {
    throw new RangeError('workload exceeds maximumSyntheticMessages');
  }

  const material = {
    configurationVersion: CONFIGURATION_VERSION,
    symbolCount: CAPACITY_MODEL_LIMITS.symbolCount,
    startTimeMs,
    durationMs,
    tickMs,
    ratesPerSecond,
    bursts,
    queueCapacities,
    drainPerTick,
    focus,
    lagSamplesPerSource,
    overload,
  };
  return deepFreeze({
    id: stableId('capacity-plan', material),
    ...material,
  } as CapacityWorkloadPlan);
}

function instrument(symbol: string): InstrumentIdentity {
  const baseAsset = symbol.slice(0, -4);
  const seed = {
    venue: 'BINANCE' as const,
    productFamily: 'SPOT' as const,
    symbol,
    pair: symbol,
    baseAsset,
    quoteAsset: 'USDT',
    contractType: null,
    sourceMarketType: null,
  };
  return Object.freeze({ instrumentId: stableId('instrument', seed), ...seed });
}

function price(symbolIndex: number, sequence: number): number {
  return 100 + symbolIndex / 100 + sequence / 10_000;
}

function decimal(value: number): string {
  return value.toFixed(8);
}

function spotTicker(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  const last = price(symbolIndex, sequence);
  return Object.freeze({
    e: '24hrMiniTicker', E: eventTimeMs, s: symbol,
    c: decimal(last), o: decimal(last - 1), h: decimal(last + 2), l: decimal(last - 2),
    v: decimal(1_000 + symbolIndex), q: decimal((1_000 + symbolIndex) * last),
  });
}

function futuresBook(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  const middle = price(symbolIndex, sequence);
  return Object.freeze({
    e: 'bookTicker', E: eventTimeMs, T: eventTimeMs, s: symbol, ps: symbol, st: 1,
    u: sequence, b: decimal(middle - 0.05), B: '2.00000000', a: decimal(middle + 0.05), A: '3.00000000',
  });
}

function futuresMark(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  const mark = price(symbolIndex, sequence);
  return Object.freeze({
    e: 'markPriceUpdate', E: eventTimeMs, s: symbol, ps: symbol, st: 1,
    p: decimal(mark), i: decimal(mark - 0.01), P: decimal(mark - 0.02), r: '0.00010000', T: eventTimeMs + 28_800_000,
  });
}

function spotTrade(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  return Object.freeze({
    e: 'aggTrade', E: eventTimeMs, s: symbol, a: String(sequence),
    p: decimal(price(symbolIndex, sequence)), q: '0.20000000', f: String(sequence), l: String(sequence),
    T: eventTimeMs, m: sequence % 2 === 0,
  });
}

function depthDelta(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  const middle = price(symbolIndex, sequence);
  return Object.freeze({
    e: 'depthUpdate', E: eventTimeMs, s: symbol,
    U: sequence, u: sequence,
    b: Object.freeze([[decimal(middle - 0.05), '2.00000000']]),
    a: Object.freeze([[decimal(middle + 0.05), '3.00000000']]),
  });
}

function liquidation(symbol: string, symbolIndex: number, eventTimeMs: number, sequence: number): Readonly<Record<string, unknown>> {
  const value = price(symbolIndex, sequence);
  return Object.freeze({
    e: 'forceOrder', E: eventTimeMs, ps: symbol, st: 1,
    o: Object.freeze({
      s: symbol, S: sequence % 2 === 0 ? 'BUY' : 'SELL', o: 'LIMIT', f: 'IOC',
      q: '1.00000000', p: decimal(value), ap: decimal(value), X: 'FILLED',
      l: '1.00000000', z: '1.00000000', T: eventTimeMs,
    }),
  });
}

function focusSnapshot(plan: CapacityWorkloadPlan, symbols: readonly string[]): CapacityFocusSnapshot {
  const protectedSet = new Set(plan.focus.protectedSymbols);
  const requested = new Set(symbols.slice(0, plan.focus.focusRequestCount));
  for (const symbol of protectedSet) requested.add(symbol);
  const ranked = [...requested].sort((left, right) => {
    const protectedOrder = Number(protectedSet.has(right)) - Number(protectedSet.has(left));
    if (protectedOrder !== 0) return protectedOrder;
    return symbols.indexOf(left) - symbols.indexOf(right) || codePointCompare(left, right);
  });
  const focused = new Set(ranked.slice(0, plan.focus.focusCapacity));
  const deep = new Set([...focused].slice(0, Math.min(plan.focus.deepFocusCount, plan.focus.deepFocusCapacity)));
  const allocations: CapacityFocusAllocation[] = symbols.map((symbol, index) => {
    const isProtected = protectedSet.has(symbol);
    const focusRequested = requested.has(symbol);
    const focusDelivered = focused.has(symbol);
    const tier = deep.has(symbol)
      ? 'DEEP_FOCUS' as const
      : focusDelivered
        ? 'FOCUS' as const
        : index < plan.focus.candidateCount
          ? 'CANDIDATE' as const
          : index < plan.focus.watchCount
            ? 'WATCH' as const
            : 'UNIVERSE' as const;
    return Object.freeze({
      symbol,
      tier,
      protected: isProtected,
      focusRequested,
      focusDelivered,
      reasonCodes: Object.freeze([
        ...(isProtected ? ['PROTECTED_CAPITAL'] : []),
        ...(focusRequested && !focusDelivered ? ['FOCUS_CAPACITY_EXHAUSTED'] : []),
      ]),
    });
  });
  const tierCounts: Record<CapacityFocusAllocation['tier'], number> = {
    UNIVERSE: 0, WATCH: 0, CANDIDATE: 0, FOCUS: 0, DEEP_FOCUS: 0,
  };
  for (const allocation of allocations) tierCounts[allocation.tier] += 1;
  const protectedPreserved = allocations
    .filter((allocation) => allocation.protected)
    .every((allocation) => allocation.focusDelivered && (allocation.tier === 'FOCUS' || allocation.tier === 'DEEP_FOCUS'));
  return Object.freeze({
    allocations: Object.freeze(allocations),
    tierCounts: Object.freeze(tierCounts),
    focusCapacity: plan.focus.focusCapacity,
    deepFocusCapacity: plan.focus.deepFocusCapacity,
    rejectedFocusRequests: Math.max(0, requested.size - focused.size),
    protectedCount: protectedSet.size,
    protectedPreserved,
  });
}

function emptyChannelStats(): Record<CapacityChannel, MutableChannelStats> {
  return Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, {
    generated: 0, offered: 0, shed: 0, processed: 0, processingFailures: 0,
  }])) as Record<CapacityChannel, MutableChannelStats>;
}

function queueRatioBps(snapshot: BoundedQueueSnapshot): number {
  return Math.floor(snapshot.depth * 10_000 / snapshot.capacity);
}

function stateRank(state: CapacityOverloadState): number {
  return CAPACITY_OVERLOAD_STATES.indexOf(state);
}

class OverloadController {
  readonly #policy: CapacityOverloadPolicy;
  readonly #transitions: CapacityTransition[] = [];
  readonly #lastDropped: Record<CapacityQueueClass, number> = {
    CORE_BROAD: 0, PROTECTED_FOCUS: 0, FOCUS: 0, OPTIONAL: 0,
  };
  #state: CapacityOverloadState = 'NOMINAL';
  #recoveryTicks = 0;
  #transitionOverflowCount = 0;

  constructor(policy: CapacityOverloadPolicy) { this.#policy = policy; }
  state(): CapacityOverloadState { return this.#state; }
  transitions(): readonly CapacityTransition[] { return Object.freeze([...this.#transitions]); }
  transitionOverflowCount(): number { return this.#transitionOverflowCount; }

  assess(
    atMs: number,
    queues: Readonly<Record<CapacityQueueClass, BoundedQueueSnapshot>>,
    lag: ReturnType<BoundedProcessingLagMetrics['snapshot']>,
    allowRecovery: boolean,
  ): void {
    const ratios = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [queueClass, queueRatioBps(queues[queueClass])])) as Record<CapacityQueueClass, number>;
    const droppedDelta = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => {
      const next = queues[queueClass].droppedCount;
      const value = Math.max(0, next - this.#lastDropped[queueClass]);
      this.#lastDropped[queueClass] = next;
      return [queueClass, value];
    })) as Record<CapacityQueueClass, number>;
    const p95 = lag.global.p95LagMs ?? 0;
    const p99 = lag.global.p99LagMs ?? 0;
    let target: CapacityOverloadState = 'NOMINAL';
    const reasons: string[] = [];
    if (
      droppedDelta.CORE_BROAD > 0 || droppedDelta.PROTECTED_FOCUS > 0
      || queues.CORE_BROAD.resyncRequired || queues.PROTECTED_FOCUS.resyncRequired
      || ratios.CORE_BROAD >= this.#policy.criticalQueueBps
      || ratios.PROTECTED_FOCUS >= this.#policy.criticalQueueBps
      || p99 >= this.#policy.criticalLagMs
    ) {
      target = 'CORE_DEGRADED';
      if (droppedDelta.CORE_BROAD > 0) reasons.push('CORE_BROAD_DROP');
      if (droppedDelta.PROTECTED_FOCUS > 0) reasons.push('PROTECTED_FOCUS_DROP');
      if (queues.CORE_BROAD.resyncRequired || queues.PROTECTED_FOCUS.resyncRequired) reasons.push('SEQUENCE_RESYNC_REQUIRED');
      if (p99 >= this.#policy.criticalLagMs) reasons.push('CRITICAL_PROCESSING_LAG');
      if (reasons.length === 0) reasons.push('CRITICAL_QUEUE_PRESSURE');
    } else if (
      droppedDelta.FOCUS > 0 || droppedDelta.OPTIONAL > 0 || queues.FOCUS.resyncRequired
      || Math.max(...Object.values(ratios)) >= this.#policy.shedQueueBps
      || p99 >= this.#policy.shedLagMs
    ) {
      target = 'OPTIONAL_SHED';
      if (droppedDelta.FOCUS > 0 || queues.FOCUS.resyncRequired) reasons.push('FOCUS_PRESSURE');
      if (droppedDelta.OPTIONAL > 0) reasons.push('OPTIONAL_DROP');
      if (p99 >= this.#policy.shedLagMs) reasons.push('SHEDDING_PROCESSING_LAG');
      if (reasons.length === 0) reasons.push('SHEDDING_QUEUE_PRESSURE');
    } else if (
      Math.max(...Object.values(ratios)) >= this.#policy.pressureQueueBps
      || p95 >= this.#policy.pressureLagMs
    ) {
      target = 'PRESSURED';
      reasons.push(p95 >= this.#policy.pressureLagMs ? 'PROCESSING_LAG_PRESSURE' : 'QUEUE_PRESSURE');
    }

    if (stateRank(target) > stateRank(this.#state)) {
      this.#transition(atMs, target, reasons);
      this.#recoveryTicks = 0;
      return;
    }
    if (!allowRecovery || stateRank(this.#state) === 0) return;
    const healthyForRecovery = Math.max(...Object.values(ratios)) <= this.#policy.recoveryQueueBps
      && p95 <= this.#policy.recoveryLagMs
      && !Object.values(queues).some((queue) => queue.resyncRequired)
      && Object.values(droppedDelta).every((count) => count === 0);
    this.#recoveryTicks = healthyForRecovery ? this.#recoveryTicks + 1 : 0;
    if (this.#recoveryTicks >= this.#policy.recoveryTicks) {
      const next = CAPACITY_OVERLOAD_STATES[stateRank(this.#state) - 1] as CapacityOverloadState;
      this.#transition(atMs, next, ['RECOVERY_HYSTERESIS_SATISFIED']);
      this.#recoveryTicks = 0;
    }
  }

  #transition(atMs: number, to: CapacityOverloadState, reasonCodes: readonly string[]): void {
    if (to === this.#state) return;
    const transition = Object.freeze({
      atMs,
      from: this.#state,
      to,
      reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    });
    if (this.#transitions.length < CAPACITY_MODEL_LIMITS.maximumTransitions) this.#transitions.push(transition);
    else this.#transitionOverflowCount += 1;
    this.#state = to;
  }
}

class EventFactory {
  readonly #planId: string;
  readonly #symbols: readonly string[];
  readonly #focusSymbols: readonly string[];
  readonly #ordinals: Record<CapacityChannel, number>;
  readonly #sequences: Record<CapacityChannel, number[]>;

  constructor(planId: string, symbols: readonly string[], focusSymbols: readonly string[]) {
    this.#planId = planId;
    this.#symbols = symbols;
    this.#focusSymbols = focusSymbols;
    this.#ordinals = Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, 0])) as Record<CapacityChannel, number>;
    this.#sequences = Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, Array(symbols.length).fill(0)])) as Record<CapacityChannel, number[]>;
  }

  next(channel: CapacityChannel, receiveTimeMs: number): CapacityEvent {
    const ordinal = ++this.#ordinals[channel];
    const pool = channel === 'SPOT_AGG_TRADE' || channel === 'SPOT_DEPTH_DELTA' ? this.#focusSymbols : this.#symbols;
    if (pool.length === 0) throw new Error('focused capacity event requested without an allocated focus symbol');
    const symbol = pool[(ordinal - 1) % pool.length] as string;
    const symbolIndex = this.#symbols.indexOf(symbol);
    const sequence = (this.#sequences[channel][symbolIndex] ?? 0) + 1;
    this.#sequences[channel][symbolIndex] = sequence;
    const payload = channel === 'SPOT_MINI_TICKER'
      ? Object.freeze([spotTicker(symbol, symbolIndex, receiveTimeMs, sequence)])
      : channel === 'USD_M_BOOK_TICKER'
        ? futuresBook(symbol, symbolIndex, receiveTimeMs, sequence + 1)
        : channel === 'USD_M_MARK_FUNDING'
          ? futuresMark(symbol, symbolIndex, receiveTimeMs, sequence)
          : channel === 'SPOT_AGG_TRADE'
            ? spotTrade(symbol, symbolIndex, receiveTimeMs, sequence)
            : channel === 'SPOT_DEPTH_DELTA'
              ? depthDelta(symbol, symbolIndex, receiveTimeMs, sequence)
              : liquidation(symbol, symbolIndex, receiveTimeMs, sequence);
    return Object.freeze({
      id: stableId('capacity-event', { planId: this.#planId, channel, ordinal, symbol, receiveTimeMs }),
      channel,
      symbol,
      receiveTimeMs,
      payload,
      sequence: channel === 'SPOT_MINI_TICKER' || channel === 'USD_M_MARK_FUNDING' ? null : sequence,
    });
  }

  retainedSequenceRoots(): Readonly<Record<CapacityChannel, readonly number[]>> {
    return Object.freeze(Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [
      channel,
      Object.freeze(this.#sequences[channel]),
    ])) as Record<CapacityChannel, readonly number[]>);
  }
}

function queueClassFor(channel: CapacityChannel, protectedSymbol: boolean): CapacityQueueClass {
  if (channel === 'SPOT_MINI_TICKER' || channel === 'USD_M_BOOK_TICKER' || channel === 'USD_M_MARK_FUNDING') return 'CORE_BROAD';
  if (channel === 'OPTIONAL_LIQUIDATION') return 'OPTIONAL';
  return protectedSymbol ? 'PROTECTED_FOCUS' : 'FOCUS';
}

function queueMode(channel: CapacityChannel): InboundQueueMode {
  return channel === 'USD_M_BOOK_TICKER' || channel === 'USD_M_MARK_FUNDING' || channel === 'OPTIONAL_LIQUIDATION'
    ? 'REPLACEABLE'
    : 'SEQUENCE_SENSITIVE';
}

function queueSnapshots(
  queues: Readonly<Record<CapacityQueueClass, BoundedInboundQueue<CapacityEvent>>>,
): Record<CapacityQueueClass, BoundedQueueSnapshot> {
  return Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [queueClass, queues[queueClass].snapshot()])) as Record<CapacityQueueClass, BoundedQueueSnapshot>;
}

export function runDeterministicCapacityWorkload(plan: CapacityWorkloadPlan): DeterministicCapacityReport {
  if (plan.configurationVersion !== CONFIGURATION_VERSION) {
    throw new TypeError('capacity plan configurationVersion is not supported');
  }
  if (plan.symbolCount !== CAPACITY_MODEL_LIMITS.symbolCount) {
    throw new TypeError('capacity plan symbolCount must remain the canonical 452-symbol scope');
  }
  const validated = createCapacityWorkloadPlan({
    startTimeMs: plan.startTimeMs,
    durationMs: plan.durationMs,
    tickMs: plan.tickMs,
    ratesPerSecond: plan.ratesPerSecond,
    bursts: plan.bursts,
    queueCapacities: plan.queueCapacities,
    drainPerTick: plan.drainPerTick,
    focus: plan.focus,
    lagSamplesPerSource: plan.lagSamplesPerSource,
    overload: plan.overload,
  });
  if (validated.id !== plan.id) throw new TypeError('capacity plan ID does not match its canonical contents');

  const symbols = Object.freeze(generatedSymbols());
  const instruments = Object.freeze(symbols.map(instrument));
  const clock = new ManualClock(plan.startTimeMs);
  const instrumentBySymbol = new Map(instruments.map((value) => [value.symbol, value]));
  const spot = new SpotBroadReducer({
    clock,
    universe: instruments,
    policy: {
      maximumSymbols: CAPACITY_MODEL_LIMITS.symbolCount,
      maximumFrameRecords: CAPACITY_MODEL_LIMITS.symbolCount,
      maximumRecentTradesPerSymbol: RECENT_TRADES_PER_SYMBOL,
      inboundCapacity: plan.queueCapacities.CORE_BROAD,
    },
  });
  spot.beginGeneration(1, plan.startTimeMs);
  const futures = new FuturesRuntimeAdapter(clock, {
    maximumSymbols: CAPACITY_MODEL_LIMITS.symbolCount,
    maximumLiquidations: Math.min(2_048, plan.queueCapacities.OPTIONAL),
    maximumRecordsPerMessage: CAPACITY_MODEL_LIMITS.symbolCount,
    instrumentResolver: {
      resolve(identity) {
        const resolved = instrumentBySymbol.get(identity.symbol);
        return resolved ? {
          venue: 'BINANCE' as const,
          productFamily: 'USD_M_PERPETUAL' as const,
          symbol: resolved.symbol,
          pair: resolved.pair as string,
          baseAsset: resolved.baseAsset,
          quoteAsset: resolved.quoteAsset as string,
          contractType: 'PERPETUAL' as const,
        } : null;
      },
    },
  });
  const generations = futures.startAll();
  for (const feed of ['BOOK_TICKER', 'MARK_FUNDING', 'CONTRACT_INFO', 'LIQUIDATION'] as const) {
    if (!futures.connected(feed, generations[feed], plan.startTimeMs)) throw new Error(`could not connect synthetic ${feed}`);
  }

  const initialSpot = spot.ingestMiniTickerFrame({
    generation: 1,
    receiveTimeMs: plan.startTimeMs,
    payload: symbols.map((symbol, index) => spotTicker(symbol, index, plan.startTimeMs, 0)),
    correlationId: 'capacity.initial.spot',
  });
  if (initialSpot.acceptedRecords !== CAPACITY_MODEL_LIMITS.symbolCount) throw new Error('synthetic Spot initialization was incomplete');
  const initialBook = futures.ingest('BOOK_TICKER', generations.BOOK_TICKER, symbols.map(
    (symbol, index) => futuresBook(symbol, index, plan.startTimeMs, 1),
  ), plan.startTimeMs);
  const initialMark = futures.ingest('MARK_FUNDING', generations.MARK_FUNDING, symbols.map(
    (symbol, index) => futuresMark(symbol, index, plan.startTimeMs, 0),
  ), plan.startTimeMs);
  if (initialBook.accepted !== CAPACITY_MODEL_LIMITS.symbolCount || initialMark.accepted !== CAPACITY_MODEL_LIMITS.symbolCount) {
    throw new Error('synthetic Futures initialization was incomplete');
  }

  const focus = focusSnapshot(plan, symbols);
  const focusSymbols = focus.allocations.filter((allocation) => allocation.focusDelivered).map((allocation) => allocation.symbol);
  const protectedSet = new Set(plan.focus.protectedSymbols);
  const eventFactory = new EventFactory(plan.id, symbols, focusSymbols);
  const queues = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [
    queueClass,
    new BoundedInboundQueue<CapacityEvent>(plan.queueCapacities[queueClass]),
  ])) as Record<CapacityQueueClass, BoundedInboundQueue<CapacityEvent>>;
  const queueAccumulators = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => [queueClass, {
    evictedReplaceable: 0,
    ignoredOlder: 0,
  }])) as Record<CapacityQueueClass, QueueAccumulator>;
  const channelStats = emptyChannelStats();
  const credits = Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [channel, 0n])) as Record<CapacityChannel, bigint>;
  const lagMetrics = new BoundedProcessingLagMetrics(CAPACITY_CHANNELS.length, plan.lagSamplesPerSource);
  const overload = new OverloadController(plan.overload);
  const miniTouched = new Set<string>();
  const tradeState = new Map<string, Readonly<Record<string, unknown>>[]>();
  const depthState = new Map<string, DepthState>();
  let depthSequenceGaps = 0;
  let optionalShedCount = 0;
  let nonProtectedFocusShedCount = 0;

  const offer = (event: CapacityEvent): void => {
    const stats = channelStats[event.channel];
    stats.generated += 1;
    const protectedSymbol = protectedSet.has(event.symbol);
    if (event.channel === 'OPTIONAL_LIQUIDATION'
      && (overload.state() === 'OPTIONAL_SHED' || overload.state() === 'CORE_DEGRADED')) {
      stats.shed += 1;
      optionalShedCount += 1;
      return;
    }
    if ((event.channel === 'SPOT_AGG_TRADE' || event.channel === 'SPOT_DEPTH_DELTA')
      && !protectedSymbol && overload.state() === 'CORE_DEGRADED') {
      stats.shed += 1;
      nonProtectedFocusShedCount += 1;
      return;
    }
    const queueClass = queueClassFor(event.channel, protectedSymbol);
    const mode = queueMode(event.channel);
    const result = queues[queueClass].offer({
      id: event.id,
      mode,
      coalescingKey: mode === 'REPLACEABLE' ? `${event.channel}:${event.symbol}` : null,
      receiveTimeMs: event.receiveTimeMs,
      value: event,
    });
    stats.offered += 1;
    if (result.action === 'EVICTED_REPLACEABLE') queueAccumulators[queueClass].evictedReplaceable += 1;
    if (result.action === 'IGNORED_OLDER') queueAccumulators[queueClass].ignoredOlder += 1;
  };

  const processEvent = (event: CapacityEvent): boolean => {
    if (event.channel === 'SPOT_MINI_TICKER') {
      const result = spot.ingestMiniTickerFrame({
        generation: 1,
        receiveTimeMs: event.receiveTimeMs,
        payload: event.payload,
        correlationId: event.id,
      });
      if (result.acceptedRecords > 0) miniTouched.add(event.symbol);
      return result.state === 'ACCEPTED' || result.state === 'PARTIAL';
    }
    if (event.channel === 'USD_M_BOOK_TICKER') {
      return futures.ingest('BOOK_TICKER', generations.BOOK_TICKER, event.payload, event.receiveTimeMs).accepted === 1;
    }
    if (event.channel === 'USD_M_MARK_FUNDING') {
      return futures.ingest('MARK_FUNDING', generations.MARK_FUNDING, event.payload, event.receiveTimeMs).accepted === 1;
    }
    if (event.channel === 'OPTIONAL_LIQUIDATION') {
      return futures.ingest('LIQUIDATION', generations.LIQUIDATION, event.payload, event.receiveTimeMs).accepted === 1;
    }
    const sequence = event.sequence as number;
    if (event.channel === 'SPOT_AGG_TRADE') {
      const retained = tradeState.get(event.symbol) ?? [];
      retained.push(event.payload as Readonly<Record<string, unknown>>);
      if (retained.length > RECENT_TRADES_PER_SYMBOL) retained.splice(0, retained.length - RECENT_TRADES_PER_SYMBOL);
      tradeState.set(event.symbol, retained);
      return true;
    }
    const prior = depthState.get(event.symbol);
    if (prior && sequence !== prior.lastSequence + 1) depthSequenceGaps += 1;
    depthState.set(event.symbol, {
      lastSequence: sequence,
      processed: (prior?.processed ?? 0) + 1,
      protected: protectedSet.has(event.symbol),
    });
    return true;
  };

  const drain = (queueClass: CapacityQueueClass, maximum: number): void => {
    for (let index = 0; index < maximum; index += 1) {
      const entry = queues[queueClass].shift();
      if (!entry) break;
      const event = entry.value;
      const accepted = processEvent(event);
      channelStats[event.channel].processed += 1;
      if (!accepted) channelStats[event.channel].processingFailures += 1;
      lagMetrics.record(event.channel, event.receiveTimeMs, clock.nowMs());
    }
  };

  const coreChannels = ['SPOT_MINI_TICKER', 'USD_M_BOOK_TICKER', 'USD_M_MARK_FUNDING'] as const;
  const focusChannels = ['SPOT_AGG_TRADE', 'SPOT_DEPTH_DELTA'] as const;
  const emitChannel = (
    channel: CapacityChannel,
    atMs: number,
    intervalStartOffsetMs: number,
    intervalEndOffsetMs: number,
  ): void => {
    const integratedDurationBps = integratedMultiplierDurationBps(
      plan.bursts,
      channel,
      intervalStartOffsetMs,
      intervalEndOffsetMs,
    );
    credits[channel] += BigInt(plan.ratesPerSecond[channel]) * integratedDurationBps;
    const count = Number(credits[channel] / DENOMINATOR);
    credits[channel] %= DENOMINATOR;
    for (let index = 0; index < count; index += 1) offer(eventFactory.next(channel, atMs));
  };

  const tickCount = plan.durationMs / plan.tickMs;
  for (let tick = 1; tick <= tickCount; tick += 1) {
    const intervalEndOffsetMs = tick * plan.tickMs;
    const intervalStartOffsetMs = intervalEndOffsetMs - plan.tickMs;
    const atMs = plan.startTimeMs + intervalEndOffsetMs;
    clock.set(atMs);
    for (const channel of coreChannels) emitChannel(channel, atMs, intervalStartOffsetMs, intervalEndOffsetMs);
    for (const channel of focusChannels) emitChannel(channel, atMs, intervalStartOffsetMs, intervalEndOffsetMs);
    overload.assess(atMs, queueSnapshots(queues), lagMetrics.snapshot(), false);
    emitChannel('OPTIONAL_LIQUIDATION', atMs, intervalStartOffsetMs, intervalEndOffsetMs);
    drain('CORE_BROAD', plan.drainPerTick.CORE_BROAD);
    drain('PROTECTED_FOCUS', plan.drainPerTick.PROTECTED_FOCUS);
    drain('FOCUS', plan.drainPerTick.FOCUS);
    drain('OPTIONAL', plan.drainPerTick.OPTIONAL);
    overload.assess(atMs, queueSnapshots(queues), lagMetrics.snapshot(), true);
  }

  const preAuditSnapshots = queueSnapshots(queues);
  const spotSnapshot = spot.snapshot(plan.startTimeMs + plan.durationMs);
  const futuresSnapshot = futures.snapshot(plan.startTimeMs + plan.durationMs);
  const lag = lagMetrics.snapshot();
  const auditedQueues = Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => {
    const entries = [];
    while (true) {
      const entry = queues[queueClass].shift();
      if (!entry) break;
      entries.push(entry);
    }
    return [queueClass, Object.freeze(entries)];
  })) as Record<CapacityQueueClass, readonly unknown[]>;
  const lagRetainedSamples = lag.global.retainedSamples
    + Object.values(lag.sources).reduce((sum, value) => sum + value.retainedSamples, 0);
  const modelState = Object.freeze({
    symbols,
    instrumentBySymbol,
    focus,
    focusSymbols: Object.freeze(focusSymbols),
    miniTouched,
    channelStats,
    queueAccumulators,
    queueSnapshots: preAuditSnapshots,
    credits,
    generatorSequences: eventFactory.retainedSequenceRoots(),
  });
  const memory = measureRetainedStructures([
    { label: 'spot.snapshot', value: spotSnapshot },
    { label: 'futures.snapshot', value: futuresSnapshot },
    { label: 'model.state', value: modelState },
    { label: 'focused.trades', value: tradeState },
    { label: 'focused.depth', value: depthState },
    { label: 'queue.core', value: auditedQueues.CORE_BROAD },
    { label: 'queue.protected', value: auditedQueues.PROTECTED_FOCUS },
    { label: 'queue.focus', value: auditedQueues.FOCUS },
    { label: 'queue.optional', value: auditedQueues.OPTIONAL },
  ], { lagRetainedSamples, queueAuditDestructive: true });

  const renderedChannelStats = Object.freeze(Object.fromEntries(CAPACITY_CHANNELS.map((channel) => [
    channel,
    Object.freeze({ ...channelStats[channel] }),
  ])) as Record<CapacityChannel, CapacityChannelStats>);
  const renderedQueues = Object.freeze(Object.fromEntries(CAPACITY_QUEUE_CLASSES.map((queueClass) => {
    const snapshot = preAuditSnapshots[queueClass];
    const stats: CapacityQueueStats = Object.freeze({
      queueClass,
      capacity: snapshot.capacity,
      depthBeforeAudit: snapshot.depth,
      highWatermark: snapshot.highWatermark,
      enqueued: snapshot.enqueuedCount,
      dequeuedBeforeAudit: snapshot.dequeuedCount,
      dropped: snapshot.droppedCount,
      coalesced: snapshot.coalescedCount,
      overflow: snapshot.overflowCount,
      resyncRequired: snapshot.resyncRequired,
      evictedReplaceable: queueAccumulators[queueClass].evictedReplaceable,
      ignoredOlder: queueAccumulators[queueClass].ignoredOlder,
    });
    return [queueClass, stats];
  })) as Record<CapacityQueueClass, CapacityQueueStats>);
  const generatedMessages = Object.values(renderedChannelStats).reduce((sum, value) => sum + value.generated, 0);
  const processedMessages = Object.values(renderedChannelStats).reduce((sum, value) => sum + value.processed, 0);
  const material = {
    planId: plan.id,
    generatedMessages,
    processedMessages,
    queues: renderedQueues,
    overloadState: overload.state(),
    optionalShedCount,
    nonProtectedFocusShedCount,
    broadState: {
      spotSymbols: spotSnapshot.symbols.length,
      futuresSymbols: futuresSnapshot.symbols.length,
      depthSymbols: depthState.size,
    },
    memory: { nodes: memory.nodeCount, lower: memory.modeledLowerBytes, upper: memory.modeledUpperBytes },
  };
  return deepFreeze({
    id: stableId('capacity-report', material),
    planId: plan.id,
    scope: 'SYNTHETIC_DETERMINISTIC_LOCAL_MODEL',
    productionCapacityClaim: null,
    hostTiming: null,
    assumptions: Object.freeze([
      'Logical time and service budgets are injected; wall-clock throughput is not measured.',
      'The first frame initializes 452 Spot and USD-M symbols; later Spot mini-ticker frames are changed-symbol-only.',
      'Source queues use the runtime bounded FIFO/coalescing implementation and are isolated by criticality.',
      'Protected capital preserves focus allocation, but sequence loss still degrades truth and requires resync.',
      'Memory is a versioned retained-graph estimate over actual snapshots and final queue entries, not exact V8 heap usage.',
    ]),
    generatedMessages,
    processedMessages,
    channelStats: renderedChannelStats,
    queues: renderedQueues,
    overloadState: overload.state(),
    transitions: overload.transitions(),
    transitionOverflowCount: overload.transitionOverflowCount(),
    optionalShedCount,
    nonProtectedFocusShedCount,
    lag,
    percentileAlgorithm: 'NEAREST_RANK_CEIL_NQ_ON_BOUNDED_RECENT_RING',
    broadState: Object.freeze({
      requestedSymbols: 452,
      spotSymbols: spotSnapshot.symbols.length,
      futuresSymbols: futuresSnapshot.symbols.length,
      quietSpotSymbolsRetained: spotSnapshot.symbols.filter((entry) => entry.ticker24h !== null && !miniTouched.has(entry.instrument.symbol)).length,
      spotRecentTrades: [...tradeState.values()].reduce((sum, trades) => sum + trades.length, 0),
      futuresLiquidations: futuresSnapshot.liquidations.length,
      depthSymbols: depthState.size,
      depthSequenceGaps,
    }),
    focus,
    memory,
    spot: spotSnapshot,
    futures: futuresSnapshot,
    upstreamBoundNotes: Object.freeze([
      'BoundedInboundQueue permits capacities up to 1,000,000 and uses linear find/splice for coalescing; this model tightens each queue to 16,384 and aggregate capacity to 65,536.',
      'BoundedProcessingLagMetrics caps source and sample counts independently; this model fixes six sources and at most 16,384 samples per source.',
      'Spot and Futures adapter policy knobs have explicit hard ceilings; this model tightens both to the 452-symbol workload.',
    ]),
    liveMoneyAuthority: 'NONE',
  } as DeterministicCapacityReport);
}
