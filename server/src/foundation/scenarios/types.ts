import type {
  EventId,
  SourcedTimestamp,
} from '../contracts/index.js';

export const SCENARIO_SCHEMA = 'cosmos.foundation.scenario' as const;
export const SCENARIO_SCHEMA_VERSION = 1 as const;
export const SCENARIO_GENERATOR_VERSION = 'scenario-generator-v1' as const;
export const SCENARIO_EXECUTION_AUTHORITY = 'NONE' as const;
export const SCENARIO_AUTHORITY = 'SYNTHETIC_TEST' as const;

/** Exactly the fourteen deterministic scenarios required by directive section 17. */
export const SCENARIO_KINDS = Object.freeze([
  'SPOT_LEADS_PERP',
  'PERP_LEADS_SPOT',
  'GAP_WIDENS_THEN_CLOSES',
  'FUNDING_CONSUMES_EDGE',
  'STALE_SPOT_FRESH_FUTURES',
  'OUT_OF_ORDER_FRAME',
  'DEAD_VOLUME_WAKEUP',
  'ONE_PRINT_SPIKE',
  'OPEN_BUT_SILENT_SOCKET',
  'PROPOSAL_EXPIRY',
  'KILL_SWITCH_DURING_TWO_LEG_PLAN',
  'PARTIAL_FILL_SECOND_LEG_REJECT',
  'CLOCK_DRIFT',
  'CAPTURE_TRUNCATION',
] as const);
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_FACT_KINDS = Object.freeze([
  'SPOT_BOOK',
  'PERP_BOOK',
  'FUNDING_CONTEXT',
  'SPOT_TRADE',
  'PERP_TRADE',
  'VOLUME_WINDOW',
  'SOURCE_STATE',
  'PROPOSAL_STATE',
  'KILL_SWITCH_STATE',
  'EXECUTION_LEG_STATE',
  'CLOCK_SAMPLE',
  'CAPTURE_STATE',
] as const);
export type ScenarioFactKind = (typeof SCENARIO_FACT_KINDS)[number];

export interface GenerateScenarioInput {
  kind: ScenarioKind;
  /** Non-zero unsigned 32-bit state for XORSHIFT32_V1. */
  seed: number;
  /** Explicit UTC-ms origin. The generator never reads a clock. */
  baseTimeMs: number;
  symbol: string;
}

export interface GenerateScenarioCatalogInput {
  seed: number;
  baseTimeMs: number;
  symbol: string;
}

export interface BookPayload {
  symbol: string;
  bid: number;
  ask: number;
  bidQuantity: number;
  askQuantity: number;
}

export interface FundingContextPayload {
  symbol: string;
  markPrice: number;
  fundingRate: number;
  nextFundingAtMs: number;
}

export interface TradePayload {
  symbol: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
}

export interface VolumeWindowPayload {
  symbol: string;
  windowMs: number;
  tradeCount: number;
  quoteVolume: number;
}

export interface SourceStatePayload {
  source: 'SPOT' | 'PERP' | 'VOLUME' | 'USER_DATA';
  connectionState: 'OPEN' | 'CLOSED';
  messageState: 'ACTIVE' | 'SILENT';
  lastMessageAtMs: number | null;
}

export interface ProposalStatePayload {
  proposalId: string;
  lifecycle: 'OPEN' | 'EXPIRED';
  observedAtMs: number;
  expiresAtMs: number;
}

export interface KillSwitchStatePayload {
  enabled: boolean;
  commandRevision: number;
}

export interface ExecutionLegStatePayload {
  planId: string;
  phase: 'OPEN' | 'CLOSE';
  legKey: 'SPOT' | 'PERP';
  outcome: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'BLOCKED';
  submittedQuantity: number;
  cumulativeFilledQuantity: number;
  clientOrderId: string;
  venueOrderId: string | null;
  failureCode: string | null;
}

export interface ClockSamplePayload {
  source: 'SPOT' | 'PERP' | 'USER_DATA';
  offsetMs: number;
}

export interface CaptureStatePayload {
  capacity: number;
  observedCount: number;
  retainedCount: number;
  droppedCount: number;
  retainedSequences: readonly number[];
  droppedSequences: readonly number[];
}

export interface ScenarioPayloadByKind {
  SPOT_BOOK: BookPayload;
  PERP_BOOK: BookPayload;
  FUNDING_CONTEXT: FundingContextPayload;
  SPOT_TRADE: TradePayload;
  PERP_TRADE: TradePayload;
  VOLUME_WINDOW: VolumeWindowPayload;
  SOURCE_STATE: SourceStatePayload;
  PROPOSAL_STATE: ProposalStatePayload;
  KILL_SWITCH_STATE: KillSwitchStatePayload;
  EXECUTION_LEG_STATE: ExecutionLegStatePayload;
  CLOCK_SAMPLE: ClockSamplePayload;
  CAPTURE_STATE: CaptureStatePayload;
}

export type ScenarioPayload = ScenarioPayloadByKind[ScenarioFactKind];

export interface ScenarioFact<K extends ScenarioFactKind = ScenarioFactKind> {
  eventId: EventId;
  streamId: string;
  sequence: number;
  kind: K;
  timestamp: Readonly<SourcedTimestamp>;
  correlationId: string;
  payload: Readonly<ScenarioPayloadByKind[K]>;
}

export interface ScenarioBundle {
  schema: typeof SCENARIO_SCHEMA;
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  generatorVersion: typeof SCENARIO_GENERATOR_VERSION;
  scenarioId: string;
  kind: ScenarioKind;
  title: string;
  seed: number;
  prngAlgorithm: 'XORSHIFT32_V1';
  baseTimeMs: number;
  symbol: string;
  authority: typeof SCENARIO_AUTHORITY;
  executionAuthority: typeof SCENARIO_EXECUTION_AUTHORITY;
  facts: readonly Readonly<ScenarioFact>[];
}
