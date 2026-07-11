import {
  canonicalJson,
  createSourcedTimestamp,
  deriveClientOrderId,
  deriveCorrelationId,
  deriveEventId,
  deriveLegId,
  findSecretLikePaths,
  findSerializabilityIssues,
  isValidUtcMillis,
  stableHash128Hex,
  type Completeness,
} from '../contracts/index.js';
import { createReplayEvent } from '../replay/event.js';
import type { ReplayEventInput } from '../replay/types.js';
import { createScenarioPrng, isValidScenarioSeed, SCENARIO_PRNG_ALGORITHM } from './prng.js';
import {
  SCENARIO_AUTHORITY,
  SCENARIO_EXECUTION_AUTHORITY,
  SCENARIO_FACT_KINDS,
  SCENARIO_GENERATOR_VERSION,
  SCENARIO_KINDS,
  SCENARIO_SCHEMA,
  SCENARIO_SCHEMA_VERSION,
  type BookPayload,
  type ExecutionLegStatePayload,
  type GenerateScenarioCatalogInput,
  type GenerateScenarioInput,
  type ScenarioBundle,
  type ScenarioFact,
  type ScenarioFactKind,
  type ScenarioKind,
  type ScenarioPayload,
  type ScenarioPayloadByKind,
} from './types.js';

/** Includes the funding timestamp carried inside FUNDING_CONTEXT payloads. */
export const MAX_SCENARIO_FUTURE_OFFSET_MS = 30_000_000;
export const MAX_SCENARIO_FACTS = 16;

const SCENARIO_TITLES: Readonly<Record<ScenarioKind, string>> = Object.freeze({
  SPOT_LEADS_PERP: 'Spot leads, perpetual catches up',
  PERP_LEADS_SPOT: 'Perpetual leads, spot catches up',
  GAP_WIDENS_THEN_CLOSES: 'Cross-venue gap widens then closes',
  FUNDING_CONSUMES_EDGE: 'Adverse funding consumes visible edge',
  STALE_SPOT_FRESH_FUTURES: 'Stale spot with fresh futures evidence',
  OUT_OF_ORDER_FRAME: 'Arrival order regresses source frame time',
  DEAD_VOLUME_WAKEUP: 'Dead volume wakes with sustained activity',
  ONE_PRINT_SPIKE: 'One print spikes and immediately normalizes',
  OPEN_BUT_SILENT_SOCKET: 'Socket stays open while messages stop',
  PROPOSAL_EXPIRY: 'Proposal reaches its declared expiry',
  KILL_SWITCH_DURING_TWO_LEG_PLAN: 'Kill switch interrupts a two-leg plan',
  PARTIAL_FILL_SECOND_LEG_REJECT: 'First leg partial, second leg rejected',
  CLOCK_DRIFT: 'Source clock drifts ahead of receipt time',
  CAPTURE_TRUNCATION: 'Bounded capture drops its oldest observations',
});

const SCENARIO_BUNDLE_KEYS = [
  'schema',
  'schemaVersion',
  'generatorVersion',
  'scenarioId',
  'kind',
  'title',
  'seed',
  'prngAlgorithm',
  'baseTimeMs',
  'symbol',
  'authority',
  'executionAuthority',
  'facts',
] as const;
const SCENARIO_FACT_KEYS = [
  'eventId',
  'streamId',
  'sequence',
  'kind',
  'timestamp',
  'correlationId',
  'payload',
] as const;

interface FactDraft<K extends ScenarioFactKind = ScenarioFactKind> {
  kind: K;
  sourceOffsetMs: number;
  receivedOffsetMs: number;
  maxAgeMs: number;
  sourceId: string;
  completeness: Completeness;
  payload: ScenarioPayloadByKind[K];
}

type DraftEmitter = <K extends ScenarioFactKind>(draft: FactDraft<K>) => void;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== 'string')) return null;
  const expected = new Set(expectedKeys);
  const output: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    if (!expected.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    output[key] = descriptor.value;
  }
  return output;
}

/** Dense arrays only: no holes, accessors, symbols, or named side-properties. */
function exactDenseArray(value: unknown, maximumLength: number): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumLength) return null;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    if (key === 'length') continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key)) return null;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
  }
  return value;
}

function assertSymbol(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{2,32}$/.test(value)) {
    throw new TypeError('scenario symbol must match /^[A-Z0-9]{2,32}$/');
  }
}

function assertBaseTime(value: unknown): asserts value is number {
  if (!isValidUtcMillis(value) || value > 4_102_444_800_000 - MAX_SCENARIO_FUTURE_OFFSET_MS) {
    throw new TypeError('scenario baseTimeMs must leave room for the bounded scenario horizon');
  }
}

function validateScenarioInput(input: GenerateScenarioInput): GenerateScenarioInput {
  const record = exactDataRecord(input, ['kind', 'seed', 'baseTimeMs', 'symbol']);
  if (record === null || !(SCENARIO_KINDS as readonly unknown[]).includes(record.kind)) {
    throw new TypeError('generateScenario: input must contain exactly one known scenario kind, seed, baseTimeMs, and symbol');
  }
  if (!isValidScenarioSeed(record.seed)) {
    throw new TypeError('generateScenario: seed must be a non-zero unsigned 32-bit integer');
  }
  assertBaseTime(record.baseTimeMs);
  assertSymbol(record.symbol);
  return {
    kind: record.kind as ScenarioKind,
    seed: record.seed,
    baseTimeMs: record.baseTimeMs,
    symbol: record.symbol,
  };
}

function at(baseTimeMs: number, offsetMs: number): number {
  if (!Number.isSafeInteger(offsetMs) || offsetMs < 0 || offsetMs > MAX_SCENARIO_FUTURE_OFFSET_MS) {
    throw new TypeError('scenario offset is outside its deterministic bound');
  }
  const value = baseTimeMs + offsetMs;
  if (!isValidUtcMillis(value)) throw new TypeError('scenario timestamp exceeds supported UTC range');
  return value;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value as object)) return value as Readonly<T>;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key], seen);
    }
  }
  return Object.freeze(value);
}

function scenarioIdFor(input: GenerateScenarioInput): string {
  return `scn_${stableHash128Hex(canonicalJson({
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    generatorVersion: SCENARIO_GENERATOR_VERSION,
    kind: input.kind,
    seed: input.seed,
    baseTimeMs: input.baseTimeMs,
    symbol: input.symbol,
  }))}`;
}

function localPlanIdentity(scenarioId: string): string {
  return `plan_${stableHash128Hex(`scenario-plan|${scenarioId}`)}`;
}

function executionLegPayload(
  scenarioId: string,
  legKey: 'SPOT' | 'PERP',
  outcome: ExecutionLegStatePayload['outcome'],
  submittedQuantity: number,
  cumulativeFilledQuantity: number,
  venueOrderId: string | null,
  failureCode: string | null,
): ExecutionLegStatePayload {
  const planId = localPlanIdentity(scenarioId);
  const legId = deriveLegId({ planId, legRole: `${legKey}_OPEN` });
  return {
    planId,
    phase: 'OPEN',
    legKey,
    outcome,
    submittedQuantity,
    cumulativeFilledQuantity,
    clientOrderId: deriveClientOrderId({ planId, legId, attempt: 0 }),
    venueOrderId,
    failureCode,
  };
}

function buildDrafts(input: GenerateScenarioInput, scenarioId: string): readonly FactDraft[] {
  const prng = createScenarioPrng(input.seed);
  const drafts: FactDraft[] = [];
  const emit: DraftEmitter = (draft) => {
    if (drafts.length >= MAX_SCENARIO_FACTS) throw new TypeError('scenario exceeds maximum fact count');
    drafts.push(draft as FactDraft);
  };
  const basePrice = round6(100 + prng.nextIntInclusive(-100, 100) / 1_000);
  const quantity = (): number => round6(5 + prng.nextIntInclusive(0, 5_000) / 1_000);
  const book = (mid: number): BookPayload => ({
    symbol: input.symbol,
    bid: round6(mid - 0.01),
    ask: round6(mid + 0.01),
    bidQuantity: quantity(),
    askQuantity: quantity(),
  });
  const market = <K extends 'SPOT_BOOK' | 'PERP_BOOK'>(
    kind: K,
    sourceOffsetMs: number,
    receivedOffsetMs: number,
    mid: number,
    maxAgeMs = 5_000,
  ): void => emit({
    kind,
    sourceOffsetMs,
    receivedOffsetMs,
    maxAgeMs,
    sourceId: kind === 'SPOT_BOOK' ? 'scenario.market.spot.book' : 'scenario.market.perp.book',
    completeness: 'COMPLETE',
    payload: book(mid),
  });
  const trade = (
    kind: 'SPOT_TRADE' | 'PERP_TRADE',
    offsetMs: number,
    price: number,
    tradeQuantity: number,
  ): void => emit({
    kind,
    sourceOffsetMs: offsetMs,
    receivedOffsetMs: offsetMs,
    maxAgeMs: 5_000,
    sourceId: kind === 'SPOT_TRADE' ? 'scenario.market.spot.trade' : 'scenario.market.perp.trade',
    completeness: 'COMPLETE',
    payload: {
      symbol: input.symbol,
      price: round6(price),
      quantity: round6(tradeQuantity),
      side: price >= basePrice ? 'BUY' : 'SELL',
    },
  });

  switch (input.kind) {
    case 'SPOT_LEADS_PERP':
      market('SPOT_BOOK', 0, 0, basePrice);
      market('PERP_BOOK', 0, 0, basePrice);
      market('SPOT_BOOK', 1_000, 1_000, basePrice + 0.6);
      market('PERP_BOOK', 2_500, 2_500, basePrice + 0.58);
      break;
    case 'PERP_LEADS_SPOT':
      market('SPOT_BOOK', 0, 0, basePrice);
      market('PERP_BOOK', 0, 0, basePrice);
      market('PERP_BOOK', 1_000, 1_000, basePrice - 0.6);
      market('SPOT_BOOK', 2_500, 2_500, basePrice - 0.58);
      break;
    case 'GAP_WIDENS_THEN_CLOSES':
      market('SPOT_BOOK', 0, 0, basePrice);
      market('PERP_BOOK', 0, 0, basePrice + 0.1);
      market('PERP_BOOK', 1_000, 1_000, basePrice + 0.4);
      market('PERP_BOOK', 2_000, 2_000, basePrice + 0.9);
      market('PERP_BOOK', 4_000, 4_000, basePrice + 0.05);
      break;
    case 'FUNDING_CONSUMES_EDGE':
      market('SPOT_BOOK', 0, 0, basePrice);
      market('PERP_BOOK', 0, 0, basePrice + 0.55);
      emit({
        kind: 'FUNDING_CONTEXT',
        sourceOffsetMs: 100,
        receivedOffsetMs: 100,
        maxAgeMs: 10_000,
        sourceId: 'scenario.market.perp.funding',
        completeness: 'COMPLETE',
        payload: {
          symbol: input.symbol,
          markPrice: round6(basePrice + 0.5),
          fundingRate: round6(-0.008 - prng.nextIntInclusive(0, 20) / 10_000),
          nextFundingAtMs: at(input.baseTimeMs, 28_800_000),
        },
      });
      break;
    case 'STALE_SPOT_FRESH_FUTURES':
      market('SPOT_BOOK', 0, 0, basePrice, 2_000);
      market('PERP_BOOK', 9_000, 9_000, basePrice + 0.2, 2_000);
      market('PERP_BOOK', 10_000, 10_000, basePrice + 0.25, 2_000);
      break;
    case 'OUT_OF_ORDER_FRAME':
      // Both frames arrive after their own source time; only their source
      // sequence regresses, so this scenario is not confounded with clock drift.
      market('PERP_BOOK', 2_000, 3_000, basePrice + 0.2);
      market('PERP_BOOK', 1_000, 4_000, basePrice + 0.1);
      market('SPOT_BOOK', 2_500, 4_500, basePrice);
      break;
    case 'DEAD_VOLUME_WAKEUP':
      emit({
        kind: 'VOLUME_WINDOW', sourceOffsetMs: 0, receivedOffsetMs: 0, maxAgeMs: 10_000,
        sourceId: 'scenario.market.volume', completeness: 'COMPLETE',
        payload: { symbol: input.symbol, windowMs: 60_000, tradeCount: 0, quoteVolume: 0 },
      });
      emit({
        kind: 'VOLUME_WINDOW', sourceOffsetMs: 2_000, receivedOffsetMs: 2_000, maxAgeMs: 10_000,
        sourceId: 'scenario.market.volume', completeness: 'COMPLETE',
        payload: { symbol: input.symbol, windowMs: 60_000, tradeCount: 0, quoteVolume: 0 },
      });
      emit({
        kind: 'VOLUME_WINDOW', sourceOffsetMs: 5_000, receivedOffsetMs: 5_000, maxAgeMs: 10_000,
        sourceId: 'scenario.market.volume', completeness: 'COMPLETE',
        payload: {
          symbol: input.symbol,
          windowMs: 60_000,
          tradeCount: 12 + prng.nextIntInclusive(0, 5),
          quoteVolume: 25_000 + prng.nextIntInclusive(0, 5_000),
        },
      });
      emit({
        kind: 'VOLUME_WINDOW', sourceOffsetMs: 6_000, receivedOffsetMs: 6_000, maxAgeMs: 10_000,
        sourceId: 'scenario.market.volume', completeness: 'COMPLETE',
        payload: {
          symbol: input.symbol,
          windowMs: 60_000,
          tradeCount: 14 + prng.nextIntInclusive(0, 5),
          quoteVolume: 27_000 + prng.nextIntInclusive(0, 5_000),
        },
      });
      break;
    case 'ONE_PRINT_SPIKE':
      trade('SPOT_TRADE', 0, basePrice, 0.5);
      trade('SPOT_TRADE', 1_000, basePrice * 1.08, 0.01);
      trade('SPOT_TRADE', 2_000, basePrice + 0.02, 0.6);
      break;
    case 'OPEN_BUT_SILENT_SOCKET':
      emit({
        kind: 'SOURCE_STATE', sourceOffsetMs: 0, receivedOffsetMs: 0, maxAgeMs: 5_000,
        sourceId: 'scenario.transport.spot', completeness: 'COMPLETE',
        payload: { source: 'SPOT', connectionState: 'OPEN', messageState: 'ACTIVE', lastMessageAtMs: input.baseTimeMs },
      });
      emit({
        kind: 'SOURCE_STATE', sourceOffsetMs: 12_000, receivedOffsetMs: 12_000, maxAgeMs: 5_000,
        sourceId: 'scenario.transport.spot', completeness: 'COMPLETE',
        payload: { source: 'SPOT', connectionState: 'OPEN', messageState: 'SILENT', lastMessageAtMs: input.baseTimeMs },
      });
      break;
    case 'PROPOSAL_EXPIRY': {
      const proposalId = `cprop_${stableHash128Hex(`scenario-proposal|${scenarioId}`)}`;
      emit({
        kind: 'PROPOSAL_STATE', sourceOffsetMs: 0, receivedOffsetMs: 0, maxAgeMs: 10_000,
        sourceId: 'scenario.proposal.lifecycle', completeness: 'COMPLETE',
        payload: { proposalId, lifecycle: 'OPEN', observedAtMs: input.baseTimeMs, expiresAtMs: at(input.baseTimeMs, 5_000) },
      });
      emit({
        kind: 'PROPOSAL_STATE', sourceOffsetMs: 5_000, receivedOffsetMs: 5_000, maxAgeMs: 10_000,
        sourceId: 'scenario.proposal.lifecycle', completeness: 'COMPLETE',
        payload: { proposalId, lifecycle: 'EXPIRED', observedAtMs: input.baseTimeMs, expiresAtMs: at(input.baseTimeMs, 5_000) },
      });
      break;
    }
    case 'KILL_SWITCH_DURING_TWO_LEG_PLAN':
      emit({
        kind: 'EXECUTION_LEG_STATE', sourceOffsetMs: 1_000, receivedOffsetMs: 1_000, maxAgeMs: 10_000,
        sourceId: 'scenario.execution', completeness: 'COMPLETE',
        payload: executionLegPayload(scenarioId, 'SPOT', 'FILLED', 1, 1, 'synthetic-order-spot', null),
      });
      emit({
        kind: 'KILL_SWITCH_STATE', sourceOffsetMs: 1_500, receivedOffsetMs: 1_500, maxAgeMs: 10_000,
        sourceId: 'scenario.control.kill-switch', completeness: 'COMPLETE',
        payload: { enabled: true, commandRevision: 2 },
      });
      emit({
        kind: 'EXECUTION_LEG_STATE', sourceOffsetMs: 1_600, receivedOffsetMs: 1_600, maxAgeMs: 10_000,
        sourceId: 'scenario.execution', completeness: 'COMPLETE',
        payload: executionLegPayload(scenarioId, 'PERP', 'BLOCKED', 0, 0, null, 'KILL_SWITCH_ON'),
      });
      break;
    case 'PARTIAL_FILL_SECOND_LEG_REJECT':
      emit({
        kind: 'EXECUTION_LEG_STATE', sourceOffsetMs: 1_000, receivedOffsetMs: 1_000, maxAgeMs: 10_000,
        sourceId: 'scenario.execution', completeness: 'COMPLETE',
        payload: executionLegPayload(scenarioId, 'SPOT', 'PARTIALLY_FILLED', 1, 0.4, 'synthetic-order-spot', null),
      });
      emit({
        kind: 'EXECUTION_LEG_STATE', sourceOffsetMs: 1_500, receivedOffsetMs: 1_500, maxAgeMs: 10_000,
        sourceId: 'scenario.execution', completeness: 'COMPLETE',
        payload: executionLegPayload(scenarioId, 'PERP', 'REJECTED', 0.8, 0, null, 'SECOND_LEG_REJECTED'),
      });
      break;
    case 'CLOCK_DRIFT':
      emit({
        kind: 'CLOCK_SAMPLE', sourceOffsetMs: 8_000, receivedOffsetMs: 1_000, maxAgeMs: 2_000,
        sourceId: 'scenario.clock.perp', completeness: 'COMPLETE',
        payload: { source: 'PERP', offsetMs: 7_000 },
      });
      emit({
        kind: 'CLOCK_SAMPLE', sourceOffsetMs: 3_000, receivedOffsetMs: 3_000, maxAgeMs: 2_000,
        sourceId: 'scenario.clock.perp', completeness: 'COMPLETE',
        payload: { source: 'PERP', offsetMs: 0 },
      });
      break;
    case 'CAPTURE_TRUNCATION':
      for (let index = 0; index < 5; index += 1) {
        trade('SPOT_TRADE', index * 500, basePrice + index * 0.01, 0.1 + index * 0.01);
      }
      emit({
        kind: 'CAPTURE_STATE', sourceOffsetMs: 3_000, receivedOffsetMs: 3_000, maxAgeMs: 10_000,
        sourceId: 'scenario.replay.capture', completeness: 'PARTIAL',
        payload: {
          capacity: 3,
          observedCount: 5,
          retainedCount: 3,
          droppedCount: 2,
          retainedSequences: [3, 4, 5],
          droppedSequences: [1, 2],
        },
      });
      break;
  }
  return Object.freeze(drafts);
}

function finalizeScenario(input: GenerateScenarioInput, scenarioId: string, drafts: readonly FactDraft[]): Readonly<ScenarioBundle> {
  if (drafts.length === 0 || drafts.length > MAX_SCENARIO_FACTS) {
    throw new TypeError('scenario builder produced an invalid fact count');
  }
  const streamId = `scenario:${scenarioId}`;
  const correlationId = deriveCorrelationId({ origin: 'scenario', key: scenarioId });
  let priorReceivedAtMs = -1;
  const facts: ScenarioFact[] = drafts.map((draft, index) => {
    const sequence = index + 1;
    const sourceTimeMs = at(input.baseTimeMs, draft.sourceOffsetMs);
    const receivedAtMs = at(input.baseTimeMs, draft.receivedOffsetMs);
    if (receivedAtMs < priorReceivedAtMs) throw new TypeError('scenario facts must be emitted in stable receipt order');
    priorReceivedAtMs = receivedAtMs;
    const timestamp = createSourcedTimestamp({
      sourceTimeMs,
      receivedAtMs,
      maxAgeMs: draft.maxAgeMs,
      authority: SCENARIO_AUTHORITY,
      completeness: draft.completeness,
      sourceId: draft.sourceId,
    });
    return Object.freeze({
      eventId: deriveEventId({ streamId, sequence }),
      streamId,
      sequence,
      kind: draft.kind,
      timestamp,
      correlationId,
      payload: deepFreeze(draft.payload) as Readonly<ScenarioPayload>,
    }) as ScenarioFact;
  });

  const bundle = deepFreeze({
    schema: SCENARIO_SCHEMA,
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    generatorVersion: SCENARIO_GENERATOR_VERSION,
    scenarioId,
    kind: input.kind,
    title: SCENARIO_TITLES[input.kind],
    seed: input.seed,
    prngAlgorithm: SCENARIO_PRNG_ALGORITHM,
    baseTimeMs: input.baseTimeMs,
    symbol: input.symbol,
    authority: SCENARIO_AUTHORITY,
    executionAuthority: SCENARIO_EXECUTION_AUTHORITY,
    facts: Object.freeze(facts),
  }) as Readonly<ScenarioBundle>;
  const serializability = findSerializabilityIssues(bundle);
  if (serializability.length > 0) {
    throw new TypeError(`scenario builder emitted non-plain data: ${serializability.map((item) => item.code).join(',')}`);
  }
  const secrets = findSecretLikePaths(bundle);
  if (secrets.length > 0) throw new TypeError(`scenario builder emitted forbidden secret-like keys: ${secrets.join(',')}`);
  return bundle;
}

/** Generate one deterministic, dormant synthetic fact stream. */
export function generateScenario(rawInput: GenerateScenarioInput): Readonly<ScenarioBundle> {
  const input = validateScenarioInput(rawInput);
  const scenarioId = scenarioIdFor(input);
  return finalizeScenario(input, scenarioId, buildDrafts(input, scenarioId));
}

/** Generate the complete fixed catalog in directive order. */
export function generateScenarioCatalog(rawInput: GenerateScenarioCatalogInput): readonly Readonly<ScenarioBundle>[] {
  const record = exactDataRecord(rawInput, ['seed', 'baseTimeMs', 'symbol']);
  if (record === null) throw new TypeError('generateScenarioCatalog: input contains missing or unknown fields');
  if (!isValidScenarioSeed(record.seed)) throw new TypeError('generateScenarioCatalog: invalid seed');
  assertBaseTime(record.baseTimeMs);
  assertSymbol(record.symbol);
  return Object.freeze(SCENARIO_KINDS.map((kind) => generateScenario({
    kind,
    seed: record.seed as number,
    baseTimeMs: record.baseTimeMs as number,
    symbol: record.symbol as string,
  })));
}

function assertScenarioBundle(bundle: ScenarioBundle): void {
  const record = exactDataRecord(bundle, SCENARIO_BUNDLE_KEYS);
  if (
    record === null ||
    record.schema !== SCENARIO_SCHEMA ||
    record.schemaVersion !== SCENARIO_SCHEMA_VERSION ||
    record.generatorVersion !== SCENARIO_GENERATOR_VERSION ||
    record.authority !== SCENARIO_AUTHORITY ||
    record.executionAuthority !== SCENARIO_EXECUTION_AUTHORITY ||
    record.prngAlgorithm !== SCENARIO_PRNG_ALGORITHM ||
    !(SCENARIO_KINDS as readonly unknown[]).includes(record.kind) ||
    !isValidScenarioSeed(record.seed)
  ) {
    throw new TypeError('scenario bundle schema/authority/identity is invalid');
  }
  assertBaseTime(record.baseTimeMs);
  assertSymbol(record.symbol);
  const typedInput: GenerateScenarioInput = {
    kind: record.kind as ScenarioKind,
    seed: record.seed,
    baseTimeMs: record.baseTimeMs,
    symbol: record.symbol,
  };
  const expectedScenarioId = scenarioIdFor(typedInput);
  if (
    record.scenarioId !== expectedScenarioId ||
    record.title !== SCENARIO_TITLES[typedInput.kind]
  ) {
    throw new TypeError('scenario bundle identity/title does not match its bound inputs');
  }

  const facts = exactDenseArray(record.facts, MAX_SCENARIO_FACTS);
  if (facts === null) throw new TypeError('scenario fact array is malformed or unbounded');
  const expectedStreamId = `scenario:${expectedScenarioId}`;
  const expectedCorrelationId = deriveCorrelationId({ origin: 'scenario', key: expectedScenarioId });
  let priorReceipt = -1;
  for (let index = 0; index < facts.length; index += 1) {
    const fact = exactDataRecord(facts[index], SCENARIO_FACT_KEYS);
    if (
      fact === null ||
      fact.streamId !== expectedStreamId ||
      fact.sequence !== index + 1 ||
      !(SCENARIO_FACT_KINDS as readonly unknown[]).includes(fact.kind) ||
      fact.correlationId !== expectedCorrelationId
    ) {
      throw new TypeError(`scenario fact ${index} has malformed identity/order`);
    }
    const replayValidated = createReplayEvent(
      {
        streamId: fact.streamId as string,
        sequence: fact.sequence as number,
        kind: fact.kind as string,
        timestamp: fact.timestamp as ScenarioFact['timestamp'],
        correlationId: fact.correlationId as string,
        payload: fact.payload,
      },
      'PRE_TRIGGER',
      typedInput.baseTimeMs,
    );
    if (
      !replayValidated.ok ||
      replayValidated.value.eventId !== fact.eventId ||
      replayValidated.value.timestamp.authority !== SCENARIO_AUTHORITY ||
      replayValidated.value.timestamp.receivedAtMs < priorReceipt
    ) {
      throw new TypeError(`scenario fact ${index} is not safe deterministic replay evidence`);
    }
    priorReceipt = replayValidated.value.timestamp.receivedAtMs;
  }
}

/** Byte-stable serialization using the frozen foundation canonical JSON kernel. */
export function serializeScenario(bundle: ScenarioBundle): string {
  assertScenarioBundle(bundle);
  return canonicalJson(bundle);
}

/**
 * Adapter seam for Lane G: each returned object has exactly ReplayEventInput
 * fields. Scenario facts remain SYNTHETIC_TEST until replay capture explicitly
 * relabels the replay dispatch as RECORDED_REPLAY.
 */
export function scenarioToReplayInputs(bundle: ScenarioBundle): readonly Readonly<ReplayEventInput>[] {
  assertScenarioBundle(bundle);
  return Object.freeze(bundle.facts.map((fact) => Object.freeze({
    streamId: fact.streamId,
    sequence: fact.sequence,
    kind: fact.kind,
    timestamp: fact.timestamp,
    correlationId: fact.correlationId,
    payload: fact.payload,
  })));
}

/** Stable code-unit ordering helper for consumers composing multiple bundles. */
export function compareScenarioFacts(left: ScenarioFact, right: ScenarioFact): number {
  const receipt = left.timestamp.receivedAtMs - right.timestamp.receivedAtMs;
  if (receipt !== 0) return receipt;
  const stream = compareCodeUnits(left.streamId, right.streamId);
  if (stream !== 0) return stream;
  return left.sequence - right.sequence;
}
