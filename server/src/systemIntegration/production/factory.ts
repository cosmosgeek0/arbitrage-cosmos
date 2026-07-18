import { types as utilTypes } from 'node:util';
import {
  evaluateFreshness,
  isValidUtcMillis,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import {
  stableId,
  type InstrumentIdentity,
  type NormalizedEvidence,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeFunding,
  normalizeLiquidation,
  normalizeMarkPrice,
  normalizeOpenInterest,
  normalizeTrade,
  type BinanceSourceFact,
} from '../../intelligenceFoundation/evidence/index.js';
import {
  buildUniverseGraph,
  type CoverageObservation,
  type ListingObservation,
  type UniverseSnapshotInput,
  type UniverseSourceKind,
  type UniverseSourceSlice,
  type UniverseSourceState,
} from '../../intelligenceFoundation/universe/index.js';
import {
  IntelligenceRuntimeBridge,
} from '../../intelligenceRuntime/bridge/index.js';
import {
  VolumeEvidenceRouter,
  type RegisteredEvidenceRouteReceipt,
} from '../../intelligenceRuntime/routing/index.js';
import {
  runtimeUniverseTruth,
  unavailableUniverseTruth,
} from '../../intelligenceRuntime/universe/index.js';
import type {
  ComponentStepContext,
} from '../../foundation/control/index.js';
import {
  createAcceptedQAbstentionBinding,
  createProductionQAdvisoryRuntime,
} from '../adapters/qAdvisory.js';
import type {
  SystemComponentSnapshot,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';
import type {
  RuntimeHealthEvidence,
} from '../composition/types.js';
import type {
  SystemCapitalSummary,
  SystemIntelligenceSummary,
  SystemStrategyRuntimeSummary,
  SystemSupervisorSummaries,
} from '../supervisor/types.js';
import {
  publicSourceMaxAgeMs,
  ReceiptObservationTracker,
  SourceObservationTracker,
  validUtcOrNull,
  weakestTemporalFact,
} from './temporal.js';
import { admitProductionSourceRegistry } from './sourceAdmission.js';
import { createProductionCapitalEligibilityPort } from './capitalEconomics.js';
import type {
  ProductionBasisConnectionStatus,
  ProductionBasisRuntimePort,
  ProductionMarketEnginePort,
  ProductionMarketRow,
  ProductionLiquidationEvidenceCut,
  ProductionLiquidationSourceClosedCut,
  ProductionTokenEvidenceFact,
  ProductionTokenEvidenceState,
  ProductionTokenIntelligenceReadModel,
  ProductionFeedStatus,
  ProductionStrategySnapshot,
  ProductionSystemIntegrationInput,
  ProductionSystemIntegrationPorts,
  ProductionVolumeConnectionStatus,
  ProductionVolumeEvidenceCut,
  ProductionVolumeRuntimePort,
} from './types.js';

const MAX_MARKET_ROWS = 8_192;
const MAX_STRATEGY_RECORDS = 2_000;
const SYMBOL = /^[A-Z0-9]{2,32}$/;

type PublicSourceKind = 'SPOT' | 'USDM';

interface MarketFacts {
  readonly valid: boolean;
  readonly universeSymbols: number | null;
  readonly spotObservedSymbols: number | null;
  readonly usdmObservedSymbols: number | null;
  readonly latestSpotSourceTimeMs: number | null;
  readonly latestUsdmSourceTimeMs: number | null;
}

interface LifecycleReadState {
  readonly active: boolean;
  readonly generation: number;
  readonly restartCount: number;
}

interface SourceProjectionEvidence {
  readonly connected: boolean;
  readonly feedState: ProductionFeedStatus | 'missing';
  readonly timestamp: Readonly<SourcedTimestamp> | null;
  readonly facts: Readonly<MarketFacts>;
}

interface MarketFactsCut {
  readonly facts: Readonly<MarketFacts>;
  readonly rows: readonly Readonly<ProductionMarketRow>[];
  readonly spotSourceTimes: ReadonlyMap<string, number | null>;
  readonly usdmSourceTimes: ReadonlyMap<string, number | null>;
}

interface IntelligenceSourceCut {
  readonly spot: Readonly<SourceProjectionEvidence>;
  readonly usdm: Readonly<SourceProjectionEvidence>;
  readonly market: Readonly<MarketFactsCut>;
}

function invalidMarketFactsCut(): Readonly<MarketFactsCut> {
  return Object.freeze({
    facts: Object.freeze({
      valid: false,
      universeSymbols: null,
      spotObservedSymbols: null,
      usdmObservedSymbols: null,
      latestSpotSourceTimeMs: null,
      latestUsdmSourceTimeMs: null,
    }),
    rows: Object.freeze([]),
    spotSourceTimes: new Map<string, number | null>(),
    usdmSourceTimes: new Map<string, number | null>(),
  });
}

function validateFactoryInput(input: Readonly<ProductionSystemIntegrationInput>): void {
  if (!input || typeof input !== 'object') throw new TypeError('production integration input is required');
  if (typeof input.clock?.nowMs !== 'function') throw new TypeError('clock.nowMs is required');
  if (input.intelligenceEvidenceMaximumBytes !== undefined
      && (!Number.isSafeInteger(input.intelligenceEvidenceMaximumBytes)
        || input.intelligenceEvidenceMaximumBytes < 512
        || input.intelligenceEvidenceMaximumBytes > MAX_PRODUCTION_INTELLIGENCE_EVIDENCE_BYTES)) {
    throw new RangeError(
      `intelligenceEvidenceMaximumBytes must be an integer in [512, ${MAX_PRODUCTION_INTELLIGENCE_EVIDENCE_BYTES}]`,
    );
  }
  for (const [name, value, methods] of [
    ['market', input.market, ['init', 'start', 'stop', 'allRows', 'priceUpdatedAt', 'markEventTimestamp']],
    ['basis', input.basis, ['start', 'stop', 'connectionStatus', 'integrationSnapshot']],
    ['volume', input.volume, ['start', 'stop', 'connectionStatus', 'integrationSnapshot']],
  ] as const) {
    if (!value || typeof value !== 'object') throw new TypeError(`${name} runtime is required`);
    for (const method of methods) {
      if (typeof (value as unknown as Record<string, unknown>)[method] !== 'function') {
        throw new TypeError(`${name}.${method} is required`);
      }
    }
  }
}

function latest(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function validFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validNonNegativeOrNull(value: unknown): number | null {
  const candidate = validFiniteOrNull(value);
  return candidate !== null && candidate >= 0 ? candidate : null;
}

function validPositiveOrNull(value: unknown): number | null {
  const candidate = validFiniteOrNull(value);
  return candidate !== null && candidate > 0 ? candidate : null;
}

function validFundingOrNull(value: unknown): number | null {
  const candidate = validFiniteOrNull(value);
  return candidate !== null && Math.abs(candidate) <= 1 ? candidate : null;
}

function validObservedAtOrNull(value: unknown, nowMs: number): number | null {
  const candidate = validUtcOrNull(value);
  return candidate !== null && candidate <= nowMs ? candidate : null;
}

const TOKEN_MARKET_FIELDS = Object.freeze([
  'symbol', 'base', 'hasSpot', 'hasPerp', 'perpMark', 'perpIndexPrice',
  'fundingRate', 'nextFundingTime', 'openInterest', 'openInterestUsd',
  'openInterestChangePct', 'openInterestUpdatedAt', 'liquidations15mUsd',
  'longLiquidations15mUsd', 'shortLiquidations15mUsd',
] as const);

function safeTokenMarketRow(
  market: ProductionMarketEnginePort,
  symbol: string,
): Readonly<ProductionMarketRow> | null {
  try {
    const rows = market.allRows();
    if (!Array.isArray(rows) || utilTypes.isProxy(rows) || rows.length > MAX_MARKET_ROWS) return null;
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || utilTypes.isProxy(raw)
          || Object.getPrototypeOf(raw) !== Object.prototype
          || Object.getOwnPropertySymbols(raw).length > 0) continue;
      const descriptors = Object.getOwnPropertyDescriptors(raw);
      const symbolDescriptor = descriptors.symbol;
      if (!symbolDescriptor || !Object.hasOwn(symbolDescriptor, 'value')
          || !symbolDescriptor.enumerable || symbolDescriptor.value !== symbol) continue;
      const captured: Record<string, unknown> = {};
      let valid = true;
      for (const field of TOKEN_MARKET_FIELDS) {
        const descriptor = descriptors[field];
        if (descriptor === undefined) {
          captured[field] = undefined;
          continue;
        }
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
          valid = false;
          break;
        }
        captured[field] = descriptor.value;
      }
      if (!valid || typeof captured.hasSpot !== 'boolean' || typeof captured.hasPerp !== 'boolean') return null;
      return Object.freeze(captured as unknown as ProductionMarketRow);
    }
    return null;
  } catch {
    return null;
  }
}

function frozenHealth(
  running: boolean,
  timestamp: Readonly<SourcedTimestamp> | null,
  heartbeatAt: number | null,
): Readonly<RuntimeHealthEvidence> {
  return Object.freeze({
    running,
    timestamp,
    heartbeatAt: validUtcOrNull(heartbeatAt),
    fatal: null,
  });
}

function safeBasisStatus(runtime: ProductionBasisRuntimePort): Readonly<ProductionBasisConnectionStatus> | null {
  try {
    const status = runtime.connectionStatus();
    return status && typeof status === 'object' && typeof status.running === 'boolean' ? status : null;
  } catch {
    return null;
  }
}

function safeVolumeStatus(runtime: ProductionVolumeRuntimePort): Readonly<ProductionVolumeConnectionStatus> | null {
  try {
    const status = runtime.connectionStatus();
    return status && typeof status === 'object' && typeof status.running === 'boolean' ? status : null;
  } catch {
    return null;
  }
}

function safeStrategySnapshot(runtime: {
  integrationSnapshot(): Readonly<ProductionStrategySnapshot>;
}): Readonly<ProductionStrategySnapshot> | null {
  try {
    const snapshot = runtime.integrationSnapshot();
    if (!snapshot || typeof snapshot !== 'object'
        || !Array.isArray(snapshot.decisions) || !Array.isArray(snapshot.proposals)
        || snapshot.decisions.length > MAX_STRATEGY_RECORDS
        || snapshot.proposals.length > MAX_STRATEGY_RECORDS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function safeStrategyOwnerSummary(
  snapshot: Readonly<ProductionStrategySnapshot>,
): Readonly<ProductionStrategySnapshot['ownerSummary']> | null {
  try {
    if (!snapshot || typeof snapshot !== 'object' || utilTypes.isProxy(snapshot)) return null;
    const snapshotDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'ownerSummary');
    if (!snapshotDescriptor || !Object.hasOwn(snapshotDescriptor, 'value')) return null;
    const summary = snapshotDescriptor.value as unknown;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)
        || utilTypes.isProxy(summary)
        || Object.getPrototypeOf(summary) !== Object.prototype
        || Object.getOwnPropertySymbols(summary).length !== 0) return null;
    const expected = ['candidateCount', 'cooldownCount', 'opportunityCount'];
    const descriptors = Object.getOwnPropertyDescriptors(summary);
    const keys = Object.keys(descriptors).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
    const values: Record<string, number> = {};
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')
          || !descriptor.enumerable) return null;
      const value = descriptor.value;
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MARKET_ROWS) return null;
      values[key] = value as number;
    }
    return Object.freeze({
      candidateCount: values.candidateCount as number,
      opportunityCount: values.opportunityCount as number,
      cooldownCount: values.cooldownCount as number,
    });
  } catch {
    return null;
  }
}

function exactDataRecord(
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype
        || Object.getOwnPropertySymbols(value).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const wanted = [...expected].sort();
    if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) return null;
    const snapshot: Record<string, unknown> = {};
    for (const key of wanted) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function boundedUniqueStrings(value: unknown, maximum: number, maximumLength: number): readonly string[] | null {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== value.length) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    const entry = descriptor.value;
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > maximumLength
        || entry.trim() !== entry || seen.has(entry)) return null;
    seen.add(entry);
    result.push(entry);
  }
  return Object.freeze(result);
}

type CapitalSummaryReadResult = Readonly<{
  kind: 'AVAILABLE' | 'UNAVAILABLE' | 'MALFORMED';
  summary: Readonly<SystemCapitalSummary> | null;
}>;

interface CapitalReadGuard {
  active: boolean;
  reentered: boolean;
}

function safeCapitalSummary(
  owner: ProductionSystemIntegrationInput['capitalSummary'],
  guard: CapitalReadGuard,
): CapitalSummaryReadResult {
  if (!owner) return Object.freeze({ kind: 'UNAVAILABLE', summary: null });
  if (guard.active) {
    guard.reentered = true;
    return Object.freeze({ kind: 'MALFORMED', summary: null });
  }
  guard.active = true;
  guard.reentered = false;
  try {
    const port = exactDataRecord(owner, ['readCapitalSummary']);
    const read = port?.readCapitalSummary;
    if (typeof read !== 'function') return Object.freeze({ kind: 'MALFORMED', summary: null });
    const raw = Reflect.apply(read, owner, []) as unknown;
    if (guard.reentered) return Object.freeze({ kind: 'MALFORMED', summary: null });
    if (raw === null) return Object.freeze({ kind: 'UNAVAILABLE', summary: null });
    if (typeof raw !== 'object' || utilTypes.isProxy(raw)) {
      return Object.freeze({ kind: 'MALFORMED', summary: null });
    }
    const availability = Object.getOwnPropertyDescriptor(raw, 'availability');
    const cut = exactDataRecord(raw, availability && Object.hasOwn(availability, 'value')
      && availability.value === 'UNAVAILABLE'
      ? ['availability', 'accountTruthState', 'reasonCodes']
      : ['availability', 'checkpoint', 'safety']);
    if (!cut) return Object.freeze({ kind: 'MALFORMED', summary: null });
    if (cut.availability === 'UNAVAILABLE') {
      const blockers = boundedUniqueStrings(cut.reasonCodes, 256, 256);
      if (!['OWNER_GATED', 'UNAVAILABLE', 'UNKNOWN'].includes(String(cut.accountTruthState))
          || blockers === null || blockers.length === 0) {
        return Object.freeze({ kind: 'MALFORMED', summary: null });
      }
      return Object.freeze({
        kind: 'UNAVAILABLE',
        summary: Object.freeze({
          truthLabel: 'UNAVAILABLE',
          accountTruthState: cut.accountTruthState as string,
          allocatableAmount: null,
          reservedAmount: null,
          activeExposureAmount: null,
          eligibleCount: null,
          reservationCount: null,
          stagedMandateCount: null,
          activeExposureCount: null,
          recoveryCount: null,
          checkpointRevision: null,
          blockerCodes: blockers,
        }),
      });
    }
    if (cut.availability !== 'AVAILABLE') return Object.freeze({ kind: 'MALFORMED', summary: null });
    const checkpoint = exactDataRecord(cut.checkpoint, ['id', 'revision']);
    const safety = exactDataRecord(cut.safety, [
      'canOpenOrIncrease', 'supervisionContinues', 'visiblePositionIds',
      'recoveryRequiredPositionIds', 'effectiveActiveReservationIds', 'reasonCodes',
    ]);
    if (!checkpoint || !safety) return Object.freeze({ kind: 'MALFORMED', summary: null });
    const checkpointId = checkpoint.id;
    const revision = checkpoint.revision;
    if (typeof checkpointId !== 'string' || checkpointId.length === 0 || checkpointId.length > 256
        || checkpointId.trim() !== checkpointId
        || !Number.isSafeInteger(revision) || (revision as number) < 0
        || typeof safety.canOpenOrIncrease !== 'boolean'
        || typeof safety.supervisionContinues !== 'boolean') {
      return Object.freeze({ kind: 'MALFORMED', summary: null });
    }
    const visible = boundedUniqueStrings(safety.visiblePositionIds, MAX_MARKET_ROWS, 256);
    const recovery = boundedUniqueStrings(safety.recoveryRequiredPositionIds, MAX_MARKET_ROWS, 256);
    const activeReservations = boundedUniqueStrings(safety.effectiveActiveReservationIds, MAX_MARKET_ROWS, 256);
    const blockers = boundedUniqueStrings(safety.reasonCodes, 256, 256);
    if (visible === null || recovery === null || activeReservations === null || blockers === null) {
      return Object.freeze({ kind: 'MALFORMED', summary: null });
    }
    const visibleIds = new Set(visible);
    if (recovery.some((id) => !visibleIds.has(id))) {
      return Object.freeze({ kind: 'MALFORMED', summary: null });
    }
    if ((safety.canOpenOrIncrease && blockers.length > 0)
        || (!safety.canOpenOrIncrease && blockers.length === 0)
        || (safety.supervisionContinues !== (visible.length > 0))) {
      return Object.freeze({ kind: 'MALFORMED', summary: null });
    }
    return Object.freeze({
      kind: 'AVAILABLE',
      summary: Object.freeze({
        truthLabel: 'RECORDED_REPLAY',
        accountTruthState: safety.canOpenOrIncrease ? 'RESTART_TRUTH_READY' : 'RESTART_TRUTH_BLOCKED',
        allocatableAmount: null,
        reservedAmount: null,
        activeExposureAmount: null,
        eligibleCount: null,
        reservationCount: activeReservations.length,
        stagedMandateCount: null,
        activeExposureCount: visible.length,
        recoveryCount: recovery.length,
        checkpointRevision: String(revision),
        blockerCodes: blockers,
      }),
    });
  } catch {
    return Object.freeze({ kind: 'MALFORMED', summary: null });
  } finally {
    guard.active = false;
  }
}

function unavailableCapitalRestartSummary(reason: string): Readonly<SystemCapitalSummary> {
  return Object.freeze({
    truthLabel: 'UNAVAILABLE',
    accountTruthState: 'UNAVAILABLE',
    allocatableAmount: null,
    reservedAmount: null,
    activeExposureAmount: null,
    eligibleCount: null,
    reservationCount: null,
    stagedMandateCount: null,
    activeExposureCount: null,
    recoveryCount: null,
    checkpointRevision: null,
    blockerCodes: Object.freeze([reason]),
  });
}

class MarketEvidenceReader {
  private readonly spotTracker = new SourceObservationTracker();
  private readonly usdmTracker = new SourceObservationTracker();

  constructor(
    private readonly clock: ProductionSystemIntegrationInput['clock'],
    private readonly market: ProductionMarketEnginePort,
    private readonly maxAgeMs: number,
    private readonly lifecycle: () => Readonly<LifecycleReadState>,
  ) {}

  beginGeneration(): void {
    const facts = this.readFacts();
    this.spotTracker.beginGeneration(facts.latestSpotSourceTimeMs);
    this.usdmTracker.beginGeneration(facts.latestUsdmSourceTimeMs);
  }

  stop(): void {
    this.spotTracker.stop();
    this.usdmTracker.stop();
  }

  readFacts(): Readonly<MarketFacts> {
    return this.readFactsCut().facts;
  }

  private readFactsCut(): Readonly<MarketFactsCut> {
    let rows: readonly Readonly<ProductionMarketRow>[];
    try {
      rows = this.market.allRows();
    } catch {
      return invalidMarketFactsCut();
    }
    if (!Array.isArray(rows) || rows.length > MAX_MARKET_ROWS) {
      return invalidMarketFactsCut();
    }
    const symbols = new Set<string>();
    const spotSourceTimes = new Map<string, number | null>();
    const usdmSourceTimes = new Map<string, number | null>();
    let spotObservedSymbols = 0;
    let usdmObservedSymbols = 0;
    let latestSpotSourceTimeMs: number | null = null;
    let latestUsdmSourceTimeMs: number | null = null;
    try {
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !SYMBOL.test(row.symbol)
            || typeof row.hasSpot !== 'boolean' || typeof row.hasPerp !== 'boolean'
            || symbols.has(row.symbol)) continue;
        symbols.add(row.symbol);
        if (row.hasSpot) {
          const sourceTime = validUtcOrNull(this.market.priceUpdatedAt(row.symbol));
          spotSourceTimes.set(row.symbol, sourceTime);
          if (sourceTime !== null) {
            spotObservedSymbols += 1;
            latestSpotSourceTimeMs = latest(latestSpotSourceTimeMs, sourceTime);
          }
        }
        if (row.hasPerp) {
          const sourceTime = validUtcOrNull(this.market.markEventTimestamp(row.symbol));
          usdmSourceTimes.set(row.symbol, sourceTime);
          if (sourceTime !== null) {
            usdmObservedSymbols += 1;
            latestUsdmSourceTimeMs = latest(latestUsdmSourceTimeMs, sourceTime);
          }
        }
      }
    } catch {
      return invalidMarketFactsCut();
    }
    return Object.freeze({
      facts: Object.freeze({
        valid: true,
        universeSymbols: symbols.size,
        spotObservedSymbols,
        usdmObservedSymbols,
        latestSpotSourceTimeMs,
        latestUsdmSourceTimeMs,
      }),
      rows: Object.freeze([...rows]),
      spotSourceTimes,
      usdmSourceTimes,
    });
  }

  readSource(kind: PublicSourceKind, nowMs = this.clock.nowMs()): Readonly<SourceProjectionEvidence> {
    const facts = this.readFacts();
    return this.sourceEvidence(kind, nowMs, facts);
  }

  readSourcesWithMarketCut(nowMs = this.clock.nowMs()): Readonly<IntelligenceSourceCut> {
    // Spot and USD-M belong to one supervisor step. Scanning the accepted
    // MarketEngine cache once both removes duplicate full-universe work and
    // prevents the two source projections from observing different row cuts.
    const market = this.readFactsCut();
    return Object.freeze({
      spot: this.sourceEvidence('SPOT', nowMs, market.facts),
      usdm: this.sourceEvidence('USDM', nowMs, market.facts),
      market,
    });
  }

  private sourceEvidence(
    kind: PublicSourceKind,
    nowMs: number,
    facts: Readonly<MarketFacts>,
  ): Readonly<SourceProjectionEvidence> {
    const sourceTime = kind === 'SPOT'
      ? facts.latestSpotSourceTimeMs
      : facts.latestUsdmSourceTimeMs;
    const tracker = kind === 'SPOT' ? this.spotTracker : this.usdmTracker;
    const timestamp = facts.valid
      ? tracker.read(
        sourceTime,
        nowMs,
        kind === 'SPOT' ? 'binance.spot.miniTicker.existing-cache' : 'binance.usdm.markPrice.existing-cache',
        this.maxAgeMs,
      )
      : null;
    const feedName = kind === 'SPOT' ? 'spot-miniticker' : 'futures-markprice';
    const feed = this.market.feeds[feedName];
    const feedState = (
      feed === 'open' || feed === 'connecting' || feed === 'closed' ||
      feed === 'cooldown' || feed === 'exhausted'
    ) ? feed : 'missing';
    return Object.freeze({
      connected: this.lifecycle().active && feedState === 'open',
      feedState,
      timestamp,
      facts,
    });
  }

  readComponent(kind: PublicSourceKind): Readonly<SystemComponentSnapshot> {
    const lifecycle = this.lifecycle();
    const nowMs = this.clock.nowMs();
    const evidence = this.readSource(kind, nowMs);
    const freshness = evidence.timestamp ? evaluateFreshness(evidence.timestamp, nowMs) : null;
    const ready = evidence.connected && freshness?.state === 'FRESH';
    const stopped = !lifecycle.active;
    const blockerCodes: string[] = [];
    if (stopped) blockerCodes.push('SOURCE_NOT_STARTED');
    else if (evidence.feedState === 'connecting') blockerCodes.push('SOURCE_TRANSPORT_CONNECTING');
    else if (evidence.feedState === 'cooldown') blockerCodes.push('SOURCE_TRANSPORT_COOLDOWN');
    else if (evidence.feedState === 'exhausted') blockerCodes.push('SOURCE_RETRY_BUDGET_EXHAUSTED');
    else if (evidence.feedState !== 'open') blockerCodes.push('SOURCE_TRANSPORT_DISCONNECTED');
    if (evidence.timestamp === null) blockerCodes.push('SOURCE_OBSERVATION_UNAVAILABLE');
    if (freshness?.state === 'STALE') blockerCodes.push('SOURCE_STALE');
    if (freshness?.state === 'CLOCK_SKEWED') blockerCodes.push('SOURCE_CLOCK_SKEWED');
    const phase = stopped
      ? 'STOPPED'
      : ready
        ? 'RUNNING'
        : evidence.feedState === 'connecting' || (evidence.feedState === 'open' && evidence.timestamp === null)
          ? 'STARTING'
          : evidence.feedState === 'exhausted'
            ? 'BLOCKED'
            : freshness?.state === 'STALE'
              ? 'DEGRADED'
              : 'BLOCKED';
    const readiness = stopped
      ? 'STOPPED'
      : ready
        ? 'READY'
        : evidence.feedState === 'connecting' || (evidence.feedState === 'open' && evidence.timestamp === null)
          ? 'WARMING'
          : evidence.feedState === 'exhausted'
            ? 'BLOCKED'
            : freshness?.state === 'STALE'
              ? 'DEGRADED'
              : 'BLOCKED';
    const sourceLifecycle = stopped
      ? 'STOPPED'
      : ready
        ? 'LIVE'
        : evidence.feedState === 'connecting'
          ? 'CONNECTING'
          : evidence.feedState === 'exhausted'
            ? 'FAILED'
            : evidence.feedState === 'open' && evidence.timestamp === null
              ? 'WARMING'
              : freshness?.state === 'STALE'
                ? 'STALE'
                : evidence.feedState !== 'open'
                  ? 'BACKING_OFF'
                  : 'DEGRADED';
    const component: SystemComponentSnapshot = Object.freeze({
      componentId: kind === 'SPOT' ? 'public-spot-source' : 'public-usdm-source',
      owner: 'INTELLIGENCE_RUNTIME',
      ownerPath: 'server/src/engine/marketData.ts',
      releaseStatuses: Object.freeze(ready
        ? ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC'] as const
        : ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED'] as const),
      truthLabel: ready ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
      desiredState: stopped ? 'STOPPED' : 'RUNNING',
      phase,
      domainObservedState: evidence.feedState.toUpperCase(),
      sourceLifecycle,
      readiness,
      authority: ready ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
      completeness: evidence.timestamp ? 'COMPLETE' : 'UNAVAILABLE',
      sourceTimestamp: evidence.timestamp,
      freshness,
      lastReceiveAtMs: evidence.timestamp?.receivedAtMs ?? null,
      lastProcessAtMs: null,
      lastSuccessAtMs: ready ? evidence.timestamp?.receivedAtMs ?? null : null,
      dependencies: Object.freeze([]),
      queue: null,
      lastFailure: null,
      blockerCodes: Object.freeze([...new Set(blockerCodes)].sort()),
      generation: lifecycle.generation,
      restartCount: lifecycle.restartCount,
      supportedControls: Object.freeze([]),
      capitalExposed: false,
      operatorAttentionRequired: readiness === 'BLOCKED' || readiness === 'DEGRADED',
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) {
      throw new TypeError(`invalid ${kind} production projection: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
    }
    return component;
  }
}

const PUBLIC_UNIVERSE_CONFIGURATION = 'i00-public-universe-v1';
const MAX_PUBLIC_INTELLIGENCE_PROJECTION_INTERVAL_MS = 5_000;
const MAX_PROJECTED_UNIVERSE_ROWS = 640;
const MAX_PROJECTED_MARK_EVIDENCE = 256;
const MAX_PROJECTED_OPEN_INTEREST_EVIDENCE = 256;
const MAX_PRODUCTION_INTELLIGENCE_EVIDENCE_BYTES = 2 * 1024 * 1024;

function unknownRateBudget() {
  return Object.freeze({
    state: 'UNKNOWN' as const,
    usedWeight: null,
    limit: null,
    intervalMs: null,
    resetsAtMs: null,
    retryAfterMs: null,
    observedAtMs: null,
  });
}

interface IntelligenceRefresh {
  readonly universeReady: boolean;
  readonly evidenceReady: boolean;
  readonly spotTimestamp: Readonly<SourcedTimestamp> | null;
  readonly usdmTimestamp: Readonly<SourcedTimestamp> | null;
}

interface IntelligenceRefreshHandoff {
  readonly nowMs: number;
  readonly generation: number;
  readonly correlationId: string;
  readonly value: Readonly<IntelligenceRefresh>;
}

function marketInstrument(
  row: Readonly<ProductionMarketRow>,
  productFamily: 'SPOT' | 'USD_M_PERPETUAL',
): Readonly<InstrumentIdentity> | null {
  if (!SYMBOL.test(row.symbol) || typeof row.base !== 'string' || !/^[A-Z0-9]{1,24}$/.test(row.base)) return null;
  const instrument: InstrumentIdentity = {
    instrumentId: '',
    venue: 'BINANCE',
    productFamily,
    symbol: row.symbol,
    pair: row.symbol,
    baseAsset: row.base,
    quoteAsset: 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
  instrument.instrumentId = stableId('instrument', {
    venue: instrument.venue,
    productFamily: instrument.productFamily,
    symbol: instrument.symbol,
    pair: instrument.pair,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    contractType: instrument.contractType,
    sourceMarketType: instrument.sourceMarketType,
  });
  return Object.freeze(instrument);
}

function publicUniverseTruth(input: Readonly<{
  nowMs: number;
  timestamp: Readonly<SourcedTimestamp>;
  sourceId: string;
  dataset: string;
  sourceRecordIds: readonly string[];
  observedFields: readonly string[];
  missingFields?: readonly string[];
}>): Readonly<TruthMetadata> {
  const missingFields = input.missingFields ?? Object.freeze([]);
  return runtimeUniverseTruth({
    configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
    sourceId: input.sourceId,
    dataset: input.dataset,
    endpointClass: 'MARKET',
    authorityKind: 'EXCHANGE_PRIMARY',
    evaluatedAtMs: input.nowMs,
    receivedTimeMs: input.timestamp.receivedAtMs,
    maxAgeMs: input.timestamp.maxAgeMs,
    sourceRecordIds: input.sourceRecordIds,
    transforms: ['project-existing-market-owner-v1'],
    completeness: missingFields.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: input.observedFields,
    missingFields,
    reasonCodes: missingFields.length === 0 ? [] : ['OWNER_FIELDS_NOT_EXPOSED'],
  });
}

function unavailableSlice<T>(source: UniverseSourceKind, nowMs: number): Readonly<UniverseSourceSlice<T>> {
  return Object.freeze({
    source,
    state: 'UNAVAILABLE' as const,
    records: Object.freeze([]) as readonly T[],
    truth: unavailableUniverseTruth({
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      sourceId: `i00.${source.toLowerCase()}.not-mounted`,
      dataset: `${source.toLowerCase()}-universe`,
      evaluatedAtMs: nowMs,
      missingField: `${source.toLowerCase()}SourceTruth`,
      reasonCode: `${source}_SOURCE_NOT_MOUNTED`,
    }),
  });
}

function listing(
  row: Readonly<ProductionMarketRow>,
  productFamily: 'SPOT' | 'USD_M_PERPETUAL',
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
): Readonly<ListingObservation> | null {
  const instrument = marketInstrument(row, productFamily);
  if (instrument === null) return null;
  const sourceId = productFamily === 'SPOT'
    ? 'binance.spot.miniTicker.existing-cache'
    : 'binance.usdm.markPrice.existing-cache';
  const dataset = productFamily === 'SPOT' ? 'spot-mini-ticker-universe' : 'usd-m-mark-price-universe';
  const sourceTime = productFamily === 'SPOT'
    ? timestamp.sourceTimeMs
    : timestamp.sourceTimeMs;
  const recordId = stableId('existing-market-listing', {
    productFamily,
    symbol: row.symbol,
    sourceTime,
  });
  return Object.freeze({
    id: recordId,
    kind: productFamily === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument,
    tradingStatus: 'TRADING',
    tradingAllowed: null,
    aliases: Object.freeze([row.symbol]),
    rules: Object.freeze({
      minimumPrice: null,
      maximumPrice: null,
      tickSize: null,
      minimumQuantity: null,
      maximumQuantity: null,
      quantityStep: null,
      minimumNotional: null,
      maximumNotional: null,
    }),
    quoteVolume: null,
    quoteVolume24hUsd: null,
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId,
      dataset,
      sourceRecordIds: [recordId],
      observedFields: ['symbol', 'baseAsset', 'quoteAsset', 'tradingStatus'],
      missingFields: ['tradingAllowed', 'tradingRules', 'quoteVolume24hUsd'],
    }),
  });
}

function coverage(
  listingRecord: Readonly<ListingObservation>,
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
): Readonly<CoverageObservation> {
  const evidenceKinds = listingRecord.kind === 'SPOT_LISTING'
    ? Object.freeze(['CONTEXT'] as const)
    : Object.freeze(['MARK_PRICE'] as const);
  const id = stableId('existing-market-coverage', {
    instrumentId: listingRecord.instrument.instrumentId,
    sourceTimeMs: timestamp.sourceTimeMs,
  });
  return Object.freeze({
    id,
    instrument: listingRecord.instrument,
    publicData: Object.freeze({ state: 'AVAILABLE' as const, evidenceKinds, reasonCodes: Object.freeze([]) }),
    focusedData: Object.freeze({
      state: 'UNKNOWN' as const,
      evidenceKinds: Object.freeze([]),
      reasonCodes: Object.freeze(['FOCUSED_TRANSPORT_NOT_OWNED']),
    }),
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId: timestamp.sourceId,
      dataset: 'existing-public-market-coverage',
      sourceRecordIds: [id],
      observedFields: ['publicData'],
      missingFields: ['focusedData'],
    }),
  });
}

function availableSlice<T>(
  source: UniverseSourceKind,
  nowMs: number,
  timestamp: Readonly<SourcedTimestamp>,
  records: readonly T[],
): Readonly<UniverseSourceSlice<T>> {
  const state: UniverseSourceState = records.length > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  if (state === 'UNAVAILABLE') return unavailableSlice<T>(source, nowMs);
  return Object.freeze({
    source,
    state,
    records: Object.freeze([...records]),
    truth: publicUniverseTruth({
      nowMs,
      timestamp,
      sourceId: timestamp.sourceId,
      dataset: `${source.toLowerCase()}-existing-owner-slice`,
      sourceRecordIds: records.flatMap((record) => {
        const id = (record as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      }),
      observedFields: ['records'],
      missingFields: ['independentCompletenessReceipt'],
    }),
  });
}

function coverageSlice(
  nowMs: number,
  spotTimestamp: Readonly<SourcedTimestamp>,
  usdmTimestamp: Readonly<SourcedTimestamp> | null,
  records: readonly Readonly<CoverageObservation>[],
): Readonly<UniverseSourceSlice<CoverageObservation>> {
  if (records.length === 0) return unavailableSlice('COVERAGE', nowMs);
  const receipts = [spotTimestamp.receivedAtMs, ...(usdmTimestamp === null ? [] : [usdmTimestamp.receivedAtMs])];
  const sourceSet = [spotTimestamp.sourceId, ...(usdmTimestamp === null ? [] : [usdmTimestamp.sourceId])];
  return Object.freeze({
    source: 'COVERAGE' as const,
    state: 'PARTIAL' as const,
    records: Object.freeze([...records]),
    truth: runtimeUniverseTruth({
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      sourceId: 'system-integration.existing-public-coverage-projection',
      dataset: 'existing-public-market-coverage',
      endpointClass: 'INJECTED',
      authorityKind: 'ENGINE_DERIVED',
      evaluatedAtMs: nowMs,
      receivedTimeMs: Math.min(...receipts),
      maxAgeMs: Math.min(spotTimestamp.maxAgeMs, usdmTimestamp?.maxAgeMs ?? spotTimestamp.maxAgeMs),
      sourceRecordIds: records.map((record) => record.id),
      sourceSet,
      transforms: ['join-existing-owner-coverage-v1'],
      completeness: 'PARTIAL',
      observedFields: ['publicData'],
      missingFields: ['focusedData', 'independentCompletenessReceipt'],
      reasonCodes: ['FOCUSED_TRANSPORT_NOT_OWNED'],
    }),
  });
}

/**
 * Serial, read-only projection into the accepted intelligence owners. It reads
 * the already-running MarketEngine cache and never constructs transport,
 * duplicates a source cache, computes a strategy score, or gains money-path
 * authority.
 */
class PublicIntelligenceLifecycle {
  private readonly bridge: IntelligenceRuntimeBridge;
  private readonly router: VolumeEvidenceRouter;
  private readonly projectionIntervalMs: number;
  private runtimeActive = false;
  private intelligenceActive = false;
  private lastProjectionKey: string | null = null;
  private lastProjectionAtMs: number | null = null;
  private lastProjectedSpotTimestamp: Readonly<SourcedTimestamp> | null = null;
  private lastProjectedUsdmTimestamp: Readonly<SourcedTimestamp> | null = null;
  private lastUniverseReady = false;
  private lastEvidenceReady = false;
  private siblingRefreshHandoff: Readonly<IntelligenceRefreshHandoff> | null = null;
  private publicationGeneration = 0;
  private readonly sourceRevisions = new Map<string, number>();

  constructor(
    private readonly clock: ProductionSystemIntegrationInput['clock'],
    private readonly market: ProductionMarketEnginePort,
    private readonly evidence: MarketEvidenceReader,
    private readonly volume: ProductionVolumeRuntimePort,
    private readonly maxAgeMs: number,
    maximumEvidenceBytes?: number,
  ) {
    this.bridge = new IntelligenceRuntimeBridge({
      clock,
      ...(maximumEvidenceBytes === undefined
        ? {}
        : { config: { maximumEvidenceBytes } }),
    });
    this.router = new VolumeEvidenceRouter({ clock, sink: this.bridge });
    this.volume.setEvidenceObserver?.((cut) => this.onVolumeEvidence(cut));
    this.market.setLiquidationEvidenceObserver?.((cut) => this.onLiquidationEvidence(cut));
    // Sampling may reduce allocation churn, but it must never outlive the
    // source contract. Re-project at least twice inside the configured
    // freshness window and immediately fail closed on the source reads below.
    this.projectionIntervalMs = Math.min(
      MAX_PUBLIC_INTELLIGENCE_PROJECTION_INTERVAL_MS,
      Math.max(1, Math.floor(maxAgeMs / 2)),
    );
  }

  readPinnedSymbols(): readonly string[] {
    return this.bridge.operatorFocusPins();
  }

  readSummary(nowMs: number): Readonly<SystemIntelligenceSummary> {
    const summary = this.focusTruthCurrent(nowMs) ? this.bridge.attentionFocusSummary() : null;
    return Object.freeze({
      truthLabel: summary === null ? 'UNAVAILABLE' : 'LIVE_PUBLIC',
      evidenceCount: null,
      attentionCount: null,
      focusRequestedCount: summary?.focusRequestedCount ?? null,
      focusActiveCount: summary?.focusActiveCount ?? null,
      thesisCount: null,
      insufficientEvidenceCount: null,
      lastUpdateAtMs: summary?.observedAtMs ?? null,
    });
  }

  readEvidenceRoutingSnapshot() {
    return this.router.snapshot();
  }

  readSymbol(symbol: string): Readonly<ProductionTokenIntelligenceReadModel> {
    if (!SYMBOL.test(symbol)) throw new TypeError('symbol must be a canonical bounded market symbol');
    const observedAtMs = this.clock.nowMs();
    if (!isValidUtcMillis(observedAtMs)) throw new TypeError('clock.nowMs returned invalid UTC ms');
    const row = safeTokenMarketRow(this.market, symbol);
    const routing = this.router.snapshotForSymbol(symbol);
    const capability = (name: string) => routing.capabilities.find((entry) => entry.capability === name) ?? null;
    const projectionRunning = this.runtimeActive && this.intelligenceActive;
    const projectionCurrent = projectionRunning && this.focusTruthCurrent(observedAtMs);
    let usdmSource: Pick<SourceProjectionEvidence, 'connected' | 'feedState'> = {
      connected: false,
      feedState: 'missing',
    };
    try {
      const source = this.evidence.readSource('USDM', observedAtMs);
      usdmSource = Object.freeze({ connected: source.connected, feedState: source.feedState });
    } catch { /* fail closed below */ }
    const rawLiquidationFeed = this.market.feeds['futures-liquidations'];
    const liquidationFeedState: ProductionFeedStatus | 'missing' = (
      rawLiquidationFeed === 'open' || rawLiquidationFeed === 'connecting'
      || rawLiquidationFeed === 'closed' || rawLiquidationFeed === 'cooldown'
      || rawLiquidationFeed === 'exhausted'
    ) ? rawLiquidationFeed : 'missing';
    const usdmAvailable = projectionCurrent && usdmSource.connected && usdmSource.feedState === 'open';
    const liquidationAvailable = projectionCurrent && liquidationFeedState === 'open';

    let markObservedAtMs: number | null = null;
    let liquidationObservedAtMs: number | null = null;
    try { markObservedAtMs = validObservedAtOrNull(this.market.markEventTimestamp(symbol), observedAtMs); } catch { /* unavailable */ }
    try {
      liquidationObservedAtMs = validObservedAtOrNull(
        this.market.liquidationEventTimestamp?.(symbol) ?? null,
        observedAtMs,
      );
    } catch { /* unavailable */ }

    const markCandidate = row?.hasPerp === true ? Object.freeze({
      markPrice: validPositiveOrNull(row.perpMark),
      indexPrice: validPositiveOrNull(row.perpIndexPrice),
      fundingRate: validFundingOrNull(row.fundingRate),
      nextFundingTimeMs: validUtcOrNull(row.nextFundingTime),
    }) : null;
    const markState: ProductionTokenEvidenceState = !usdmAvailable
      ? 'UNAVAILABLE'
      : markObservedAtMs === null || markCandidate === null
        ? 'MISSING'
        : observedAtMs - markObservedAtMs > this.maxAgeMs
          ? 'STALE'
          : [markCandidate.markPrice, markCandidate.indexPrice, markCandidate.fundingRate]
              .some((value) => value !== null)
            ? 'FRESH'
            : 'MISSING';

    const openInterestCapability = capability('OPEN_INTEREST');
    const openInterestObservedAtMs = validObservedAtOrNull(row?.openInterestUpdatedAt, observedAtMs);
    const openInterestCandidate = row?.hasPerp === true ? Object.freeze({
      base: validNonNegativeOrNull(row.openInterest),
      quoteUsd: validNonNegativeOrNull(row.openInterestUsd),
      changePct: validFiniteOrNull(row.openInterestChangePct),
    }) : null;
    const openInterestState: ProductionTokenEvidenceState = !usdmAvailable
      ? 'UNAVAILABLE'
      : openInterestCapability?.freshness === 'STALE'
        ? 'STALE'
        : openInterestObservedAtMs !== null && observedAtMs - openInterestObservedAtMs > this.maxAgeMs
          ? 'STALE'
        : openInterestCapability?.freshness === 'FRESH'
          && openInterestObservedAtMs !== null
          && openInterestCandidate !== null
          && Object.values(openInterestCandidate).some((value) => value !== null)
          ? 'FRESH'
          : 'MISSING';

    const liquidationCapability = capability('LIQUIDATION');
    const liquidationCandidate = row?.hasPerp === true
      && validPositiveOrNull(row.liquidations15mUsd) !== null
      ? Object.freeze({
          total15mUsd: validPositiveOrNull(row.liquidations15mUsd),
          long15mUsd: validNonNegativeOrNull(row.longLiquidations15mUsd),
          short15mUsd: validNonNegativeOrNull(row.shortLiquidations15mUsd),
          sampling: 'LATEST_PER_SYMBOL_LOWER_BOUND' as const,
        })
      : null;
    const liquidationState: ProductionTokenEvidenceState = !liquidationAvailable
      ? 'UNAVAILABLE'
      : liquidationCapability?.freshness === 'STALE'
        ? 'STALE'
        : liquidationObservedAtMs !== null && observedAtMs - liquidationObservedAtMs > this.maxAgeMs
          ? 'STALE'
        : liquidationCapability?.freshness === 'FRESH'
          && liquidationObservedAtMs !== null
          && liquidationCandidate !== null
          ? 'FRESH'
          : 'MISSING';

    const fact = <TValue>(input: {
      state: ProductionTokenEvidenceState;
      sourceId: string;
      dataset: string;
      observedAtMs: number | null;
      value: Readonly<TValue> | null;
      reasonCodes: readonly string[];
    }): Readonly<ProductionTokenEvidenceFact<TValue>> => Object.freeze({
      ...input,
      value: input.state === 'FRESH' ? input.value : null,
      reasonCodes: Object.freeze([...input.reasonCodes]),
    });

    const rawBridge = this.bridge.readSymbol(symbol);
    // The response observation time is an upper bound for every nested owner
    // evaluation. Bridge/router clocks may tick after the freshness cut used
    // above, so publish the maximum instead of exposing an apparently future
    // nested record to strict browser consumers.
    const readObservedAtMs = Math.max(observedAtMs, routing.observedAtMs, rawBridge.evaluatedAtMs);
    const bridge = Object.freeze({
      ...rawBridge,
      currentState: projectionCurrent ? 'CURRENT' as const : 'HISTORICAL_ONLY' as const,
      featureSnapshot: projectionCurrent ? rawBridge.featureSnapshot : null,
      attention: projectionCurrent ? rawBridge.attention : null,
      artifact: projectionCurrent ? rawBridge.artifact : null,
      reasonCodes: Object.freeze([
        ...rawBridge.reasonCodes,
        ...(projectionCurrent ? [] : ['CURRENT_PROJECTION_UNAVAILABLE']),
      ]),
    });
    const anyCurrentEvidence = projectionCurrent && (
      [markState, openInterestState, liquidationState].includes('FRESH')
      || routing.capabilities.some((entry) => entry.freshness === 'FRESH')
    );
    return Object.freeze({
      schemaVersion: 'token-intelligence-owner-read.v1' as const,
      symbol,
      observedAtMs: readObservedAtMs,
      projection: Object.freeze({
        state: !projectionRunning ? 'NOT_RUNNING' as const : anyCurrentEvidence ? 'ACTIVE' as const : 'DEGRADED' as const,
        usdm: Object.freeze({ connected: usdmSource.connected, feedState: usdmSource.feedState }),
        liquidation: Object.freeze({ connected: liquidationFeedState === 'open', feedState: liquidationFeedState }),
      }),
      markFunding: fact({
        state: markState,
        sourceId: BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId,
        dataset: BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.dataset,
        observedAtMs: markObservedAtMs,
        value: markCandidate,
        reasonCodes: markState === 'FRESH' ? [] : [`MARK_FUNDING_${markState}`],
      }),
      openInterest: fact({
        state: openInterestState,
        sourceId: BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST.sourceId,
        dataset: BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST.dataset,
        observedAtMs: openInterestObservedAtMs,
        value: openInterestCandidate,
        reasonCodes: openInterestCapability?.reasonCodes ?? [`OPEN_INTEREST_${openInterestState}`],
      }),
      liquidation: fact({
        state: liquidationState,
        sourceId: BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION.sourceId,
        dataset: BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION.dataset,
        observedAtMs: liquidationObservedAtMs,
        value: liquidationCandidate,
        reasonCodes: liquidationCapability?.reasonCodes ?? [`LIQUIDATION_${liquidationState}`],
      }),
      routing,
      bridge,
      authority: 'EVIDENCE_ONLY' as const,
      liveMoneyAuthority: 'NONE' as const,
    });
  }

  readFocusState(symbol: string): ReturnType<IntelligenceRuntimeBridge['focusPinState']> {
    const readback = this.bridge.focusPinState(symbol);
    if (this.focusTruthCurrent()) return readback;
    return Object.freeze({
      ...readback,
      eligible: null,
      canPin: false,
      // Absence of the desired operator pin is current owner truth even when
      // broader market eligibility/tier truth is unavailable. This does not
      // claim that strategy or protected-capital focus has been released.
      effectivePinned: readback.pinned ? null : false,
      effectiveTier: null,
      attentionPlanId: null,
      attentionPlanAtMs: null,
    });
  }

  setPinned(symbol: string, pinned: boolean): boolean {
    if (pinned && !this.readFocusState(symbol).canPin) {
      throw new RangeError('focus pin requires an eligible symbol and available FOCUS capacity');
    }
    return this.bridge.setOperatorFocusPinned(symbol, pinned);
  }

  restorePinnedSymbols(symbols: readonly string[]): boolean {
    return this.bridge.restoreOperatorFocusPins(symbols);
  }

  startRuntime(): Promise<void> {
    if (this.runtimeActive) return Promise.resolve();
    this.publicationGeneration += 1;
    this.sourceRevisions.clear();
    this.runtimeActive = true;
    return Promise.resolve();
  }

  stopRuntime(): void {
    this.runtimeActive = false;
    this.intelligenceActive = false;
    this.router.invalidate('INTELLIGENCE_RUNTIME_STOPPED');
    this.resetGenerationProjection();
  }

  startIntelligence(): Promise<void> {
    if (!this.runtimeActive) throw new TypeError('market intelligence requires the intelligence runtime');
    if (this.intelligenceActive) return Promise.resolve();
    this.siblingRefreshHandoff = null;
    this.intelligenceActive = true;
    return Promise.resolve();
  }

  stopIntelligence(): void {
    this.intelligenceActive = false;
    this.siblingRefreshHandoff = null;
    this.lastEvidenceReady = false;
  }

  runtimeHealth(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    if (!this.runtimeActive) return frozenHealth(false, null, null);
    const refreshed = this.refresh(ctx);
    // The canonical supervisor probes the runtime immediately before its
    // intelligence sibling. Hand off exactly one same-step result so that pair
    // observes one market cut without creating a cross-step cache.
    this.siblingRefreshHandoff = Object.freeze({
      nowMs: ctx.nowMs,
      generation: ctx.generation,
      correlationId: ctx.correlationId,
      value: refreshed,
    });
    return frozenHealth(
      true,
      refreshed.universeReady ? refreshed.spotTimestamp : null,
      refreshed.universeReady
        ? refreshed.spotTimestamp?.sourceTimeMs ?? refreshed.spotTimestamp?.receivedAtMs ?? null
        : null,
    );
  }

  intelligenceHealth(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    if (!this.intelligenceActive) return frozenHealth(false, null, null);
    const handoff = this.siblingRefreshHandoff;
    this.siblingRefreshHandoff = null;
    const refreshed = handoff !== null
        && handoff.nowMs === ctx.nowMs
        && handoff.generation === ctx.generation
        && handoff.correlationId === ctx.correlationId
      ? handoff.value
      : this.refresh(ctx);
    return frozenHealth(
      true,
      refreshed.universeReady && refreshed.evidenceReady ? refreshed.usdmTimestamp : null,
      refreshed.universeReady && refreshed.evidenceReady
        ? refreshed.usdmTimestamp?.sourceTimeMs ?? refreshed.usdmTimestamp?.receivedAtMs ?? null
        : null,
    );
  }

  private resetGenerationProjection(): void {
    this.siblingRefreshHandoff = null;
    this.lastProjectionKey = null;
    this.lastProjectionAtMs = null;
    this.lastProjectedSpotTimestamp = null;
    this.lastProjectedUsdmTimestamp = null;
    this.lastUniverseReady = false;
    this.lastEvidenceReady = false;
  }

  private focusTruthCurrent(evaluatedAtMs?: number): boolean {
    if (!this.runtimeActive || !this.intelligenceActive
        || !this.lastUniverseReady || !this.lastEvidenceReady
        || this.lastProjectedSpotTimestamp === null || this.lastProjectedUsdmTimestamp === null) return false;
    try {
      const nowMs = evaluatedAtMs ?? this.clock.nowMs();
      return isValidUtcMillis(nowMs)
        && this.market.feeds['spot-miniticker'] === 'open'
        && this.market.feeds['futures-markprice'] === 'open'
        && evaluateFreshness(this.lastProjectedSpotTimestamp, nowMs).state === 'FRESH'
        && evaluateFreshness(this.lastProjectedUsdmTimestamp, nowMs).state === 'FRESH';
    } catch {
      return false;
    }
  }

  private nextSourceRevision(sourceId: string, dataset: string): number {
    const key = `${this.publicationGeneration}\u0000${sourceId}\u0000${dataset}`;
    const prior = this.sourceRevisions.get(key) ?? 0;
    if (prior >= Number.MAX_SAFE_INTEGER) throw new RangeError('public evidence source revision exhausted');
    const next = prior + 1;
    this.sourceRevisions.set(key, next);
    return next;
  }

  private marketEvidenceCurrent(
    fact: BinanceSourceFact,
    revision: number,
    receipt: Readonly<RegisteredEvidenceRouteReceipt>,
    fundingProjected: boolean,
  ): boolean {
    if (receipt.state !== 'FRESH'
        || receipt.received < 1
        || receipt.rejected !== 0
        || receipt.routed + receipt.duplicate !== receipt.received) return false;
    try {
      const snapshot = this.router.snapshot();
      const exactSource = snapshot.sources.find((source) => (
        source.sourceId === fact.sourceId
        && source.dataset === fact.dataset
        && source.lifecycle === 'LIVE'
        && source.generation === this.publicationGeneration
        && source.revision === revision
      ));
      if (exactSource?.closed !== false || exactSource.bootstrapped !== true) return false;
      if (!fundingProjected) return true;
      return snapshot.capabilities.find((capability) => (
        capability.capability === 'FUNDING'
      ))?.freshness === 'FRESH';
    } catch {
      return false;
    }
  }

  private onVolumeEvidence(cut: Readonly<ProductionVolumeEvidenceCut>): void {
    const fact = BINANCE_SOURCE_FACTS.SPOT_AGG_TRADE;
    const nowMs = this.clock.nowMs();
    if (!isValidUtcMillis(nowMs)) {
      this.router.invalidate('PUBLICATION_CLOCK_INVALID');
      return;
    }
    if (cut.kind === 'SOURCE_CLOSED') {
      if (!Number.isSafeInteger(cut.observedAtMs) || cut.observedAtMs < 0 || cut.observedAtMs > nowMs) {
        this.router.invalidate('SOURCE_CLOSE_TIME_INVALID');
        return;
      }
      this.router.route({
        correlationId: stableId('existing-volume-source-close', {
          generation: cut.generation,
          revision: cut.revision,
          observedAtMs: cut.observedAtMs,
        }),
        scope: 'BROAD',
        source: Object.freeze({
          sourceId: fact.sourceId,
          dataset: fact.dataset,
          endpointClass: fact.endpointClass,
          lifecycle: 'STOPPED' as const,
          authority: 'UNAVAILABLE' as const,
          continuity: 'UNKNOWN' as const,
          generation: cut.generation,
          revision: cut.revision,
          bootstrap: 'NONE' as const,
          rateBudget: unknownRateBudget(),
          observedAtMs: cut.observedAtMs,
        }),
        evidence: Object.freeze([]),
      });
      return;
    }
    if (!this.runtimeActive
        || !Number.isSafeInteger(cut.receivedAtMs) || cut.receivedAtMs < 0 || cut.receivedAtMs > nowMs) return;
    const result = normalizeTrade(cut.raw, {
      sourceKey: 'SPOT_AGG_TRADE',
      sourceId: fact.sourceId,
      endpointClass: fact.endpointClass,
      instrument: {
        venue: 'BINANCE',
        productFamily: 'SPOT',
        symbol: cut.raw.s,
        pair: cut.raw.s,
        baseAsset: cut.baseAsset,
        quoteAsset: 'USDT',
        contractType: null,
      },
      receivedTimeMs: cut.receivedAtMs,
      evaluatedAtMs: nowMs,
      maxAgeMs: this.maxAgeMs,
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
    });
    this.router.route({
      correlationId: stableId('existing-volume-trade-ingest', {
        generation: cut.generation,
        revision: cut.revision,
        aggregateTradeId: cut.raw.a,
      }),
      scope: 'BROAD',
      source: Object.freeze({
        sourceId: fact.sourceId,
        dataset: fact.dataset,
        endpointClass: fact.endpointClass,
        lifecycle: 'LIVE' as const,
        authority: 'COMPLETE' as const,
        continuity: cut.continuity,
        generation: cut.generation,
        revision: cut.revision,
        bootstrap: cut.continuity === 'CONTIGUOUS' ? 'CONTIGUOUS_OWNER' as const : 'NONE' as const,
        rateBudget: unknownRateBudget(),
        observedAtMs: cut.receivedAtMs,
      }),
      evidence: result.ok ? Object.freeze([result.value]) : Object.freeze([]),
      qualityFailures: result.ok ? result.qualityFailures : result.failures,
    });
  }

  private onLiquidationEvidence(
    cut: Readonly<ProductionLiquidationEvidenceCut | ProductionLiquidationSourceClosedCut>,
  ): void {
    const fact = BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION;
    const nowMs = this.clock.nowMs();
    if (!isValidUtcMillis(nowMs)) {
      this.router.invalidate('PUBLICATION_CLOCK_INVALID');
      return;
    }
    if (cut.kind === 'SOURCE_CLOSED') {
      if (!Number.isSafeInteger(cut.observedAtMs) || cut.observedAtMs < 0 || cut.observedAtMs > nowMs) {
        this.router.invalidate('SOURCE_CLOSE_TIME_INVALID');
        return;
      }
      this.router.route({
        correlationId: stableId('existing-liquidation-source-close', {
          generation: cut.generation,
          revision: cut.revision,
          observedAtMs: cut.observedAtMs,
        }),
        scope: 'BROAD',
        source: Object.freeze({
          sourceId: fact.sourceId,
          dataset: fact.dataset,
          endpointClass: fact.endpointClass,
          lifecycle: 'STOPPED' as const,
          authority: 'UNAVAILABLE' as const,
          continuity: 'UNKNOWN' as const,
          generation: cut.generation,
          revision: cut.revision,
          bootstrap: 'NONE' as const,
          rateBudget: unknownRateBudget(),
          observedAtMs: cut.observedAtMs,
        }),
        evidence: Object.freeze([]),
      });
      return;
    }
    if (!this.runtimeActive
        || !Number.isSafeInteger(cut.receivedAtMs) || cut.receivedAtMs < 0 || cut.receivedAtMs > nowMs) return;
    const result = normalizeLiquidation(cut.raw, {
      sourceKey: 'USD_M_LIQUIDATION',
      sourceId: fact.sourceId,
      endpointClass: fact.endpointClass,
      instrument: {
        venue: 'BINANCE',
        productFamily: 'USD_M_PERPETUAL',
        symbol: cut.raw.o.s,
        pair: cut.raw.o.s,
        baseAsset: cut.baseAsset,
        quoteAsset: 'USDT',
        contractType: 'PERPETUAL',
      },
      receivedTimeMs: cut.receivedAtMs,
      evaluatedAtMs: nowMs,
      maxAgeMs: this.maxAgeMs,
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
    });
    this.router.route({
      correlationId: stableId('existing-liquidation-ingest', {
        generation: cut.generation,
        revision: cut.revision,
        symbol: cut.raw.o.s,
        transactionTimeMs: cut.raw.o.T,
      }),
      scope: 'BROAD',
      source: Object.freeze({
        sourceId: fact.sourceId,
        dataset: fact.dataset,
        endpointClass: fact.endpointClass,
        lifecycle: 'LIVE' as const,
        authority: 'SAMPLED' as const,
        continuity: 'UNKNOWN' as const,
        generation: cut.generation,
        revision: cut.revision,
        bootstrap: cut.bootstrap,
        rateBudget: unknownRateBudget(),
        observedAtMs: cut.receivedAtMs,
      }),
      evidence: result.ok ? Object.freeze([result.value]) : Object.freeze([]),
      qualityFailures: result.ok ? result.qualityFailures : result.failures,
    });
  }

  private markUsdMEvidenceUnavailable(nowMs: number): void {
    for (const fact of [BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE, BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST]) {
      this.router.route({
        correlationId: stableId('existing-market-source-unavailable', {
          sourceId: fact.sourceId,
          dataset: fact.dataset,
          generation: this.publicationGeneration,
          observedAtMs: nowMs,
        }),
        scope: 'BROAD',
        source: Object.freeze({
          sourceId: fact.sourceId,
          dataset: fact.dataset,
          endpointClass: fact.endpointClass,
          lifecycle: 'WARMING' as const,
          authority: 'UNAVAILABLE' as const,
          continuity: 'UNKNOWN' as const,
          generation: this.publicationGeneration,
          revision: this.nextSourceRevision(fact.sourceId, fact.dataset),
          bootstrap: 'NONE' as const,
          rateBudget: unknownRateBudget(),
          observedAtMs: nowMs,
        }),
        evidence: Object.freeze([]),
      });
    }
  }

  private refresh(ctx: ComponentStepContext): Readonly<IntelligenceRefresh> {
    // Receipt time and evaluation time belong to the same deterministic
    // supervisor step. Taking a second clock sample here can place a newly
    // accepted receipt after ctx.nowMs and manufacture a negative age.
    const sourceCut = this.evidence.readSourcesWithMarketCut(ctx.nowMs);
    const { spot, usdm } = sourceCut;
    const spotFresh = spot.timestamp !== null && evaluateFreshness(spot.timestamp, ctx.nowMs).state === 'FRESH';
    const usdmFresh = usdm.connected
      && usdm.timestamp !== null
      && evaluateFreshness(usdm.timestamp, ctx.nowMs).state === 'FRESH';
    if (!usdmFresh) this.markUsdMEvidenceUnavailable(ctx.nowMs);
    if (!spot.connected || !spotFresh) {
      this.lastUniverseReady = false;
      this.lastEvidenceReady = false;
      return Object.freeze({
        universeReady: false,
        evidenceReady: false,
        spotTimestamp: spot.timestamp,
        usdmTimestamp: usdm.timestamp,
      });
    }
    if (!usdmFresh) this.lastEvidenceReady = false;

    const key = `${spot.timestamp?.sourceTimeMs ?? 'receive'}:${usdmFresh ? usdm.timestamp?.sourceTimeMs ?? 'receive' : 'unavailable'}`;
    const projectionDue = this.lastProjectionAtMs === null
      || ctx.nowMs - this.lastProjectionAtMs >= this.projectionIntervalMs;
    const retryNeeded = !this.lastUniverseReady || (usdmFresh && !this.lastEvidenceReady);
    if (projectionDue && (key !== this.lastProjectionKey || retryNeeded)) {
      const projected = this.project(
        ctx.nowMs,
        spot.timestamp as Readonly<SourcedTimestamp>,
        usdmFresh ? usdm.timestamp : null,
        sourceCut.market,
      );
      this.lastProjectionKey = key;
      this.lastProjectionAtMs = ctx.nowMs;
      this.lastProjectedSpotTimestamp = spot.timestamp;
      this.lastProjectedUsdmTimestamp = usdmFresh ? usdm.timestamp : null;
      this.lastUniverseReady = projected.universeReady;
      this.lastEvidenceReady = projected.evidenceReady;
    }
    return Object.freeze({
      universeReady: this.lastUniverseReady,
      evidenceReady: this.lastEvidenceReady && usdmFresh,
      spotTimestamp: this.lastProjectedSpotTimestamp,
      usdmTimestamp: this.lastProjectedUsdmTimestamp,
    });
  }

  private project(
    nowMs: number,
    spotTimestamp: Readonly<SourcedTimestamp>,
    usdmTimestamp: Readonly<SourcedTimestamp> | null,
    marketCut: Readonly<MarketFactsCut>,
  ): Readonly<Pick<IntelligenceRefresh, 'universeReady' | 'evidenceReady'>> {
    if (!marketCut.facts.valid || marketCut.rows.length === 0 || marketCut.rows.length > MAX_MARKET_ROWS) {
      return Object.freeze({ universeReady: false, evidenceReady: false });
    }
    const boundedRows = marketCut.rows.slice(0, MAX_PROJECTED_UNIVERSE_ROWS);
    const spotListings = boundedRows
      .filter((row) => row.hasSpot
        && marketCut.spotSourceTimes.get(row.symbol) === spotTimestamp.sourceTimeMs)
      .map((row) => listing(row, 'SPOT', nowMs, spotTimestamp))
      .filter((record): record is Readonly<ListingObservation> => record !== null);
    const perpetualListings = usdmTimestamp === null
      ? []
      : boundedRows
        .filter((row) => row.hasPerp
          && marketCut.usdmSourceTimes.get(row.symbol) === usdmTimestamp.sourceTimeMs)
        .map((row) => listing(row, 'USD_M_PERPETUAL', nowMs, usdmTimestamp))
        .filter((record): record is Readonly<ListingObservation> => record !== null);
    const coverageRecords = [
      ...spotListings.map((record) => coverage(record, nowMs, spotTimestamp)),
      ...perpetualListings.map((record) => coverage(record, nowMs, usdmTimestamp as Readonly<SourcedTimestamp>)),
    ];
    const input: UniverseSnapshotInput = {
      observedAtMs: nowMs,
      spot: availableSlice('SPOT', nowMs, spotTimestamp, spotListings),
      usdMPerpetual: usdmTimestamp === null
        ? unavailableSlice('USD_M_PERPETUAL', nowMs)
        : availableSlice('USD_M_PERPETUAL', nowMs, usdmTimestamp, perpetualListings),
      margin: unavailableSlice('MARGIN', nowMs),
      borrow: unavailableSlice('BORROW', nowMs),
      coverage: coverageSlice(nowMs, spotTimestamp, usdmTimestamp, coverageRecords),
    };
    const graph = buildUniverseGraph(input, {
      configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      requireSpotForFocus: true,
      requirePerpetualForFocus: false,
      requirePublicDataForFocus: true,
      requireFocusedDataForFocus: false,
      maxRecordsPerSource: MAX_PROJECTED_UNIVERSE_ROWS * 2,
    });
    const universeReceipt = this.bridge.updateUniverse(graph);
    const universeReady = universeReceipt.accepted && universeReceipt.nodeCount > 0;
    if (!universeReady || usdmTimestamp === null) {
      if (universeReady) this.bridge.evaluate();
      return Object.freeze({ universeReady, evidenceReady: false });
    }

    const normalized: NormalizedEvidence[] = [];
    const qualityFailures = [];
    const fact = BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE;
    for (const row of boundedRows) {
      if (normalized.length >= MAX_PROJECTED_MARK_EVIDENCE || !row.hasPerp
          || typeof row.perpMark !== 'number' || !Number.isFinite(row.perpMark) || row.perpMark <= 0) continue;
      const sourceTimeMs = marketCut.usdmSourceTimes.get(row.symbol) ?? null;
      if (sourceTimeMs === null || sourceTimeMs !== usdmTimestamp.sourceTimeMs
          || sourceTimeMs > usdmTimestamp.receivedAtMs) continue;
      const rawMark = {
        e: 'markPriceUpdate',
        E: sourceTimeMs,
        s: row.symbol,
        ps: row.symbol,
        st: 1,
        p: String(row.perpMark),
        ...(typeof row.perpIndexPrice === 'number' && Number.isFinite(row.perpIndexPrice) && row.perpIndexPrice > 0
          ? { i: String(row.perpIndexPrice) }
          : {}),
        ...(typeof row.fundingRate === 'number' && Number.isFinite(row.fundingRate) && Math.abs(row.fundingRate) <= 1
          ? { r: String(row.fundingRate) }
          : {}),
        ...(validUtcOrNull(row.nextFundingTime) !== null ? { T: row.nextFundingTime } : {}),
      };
      const context = {
        sourceKey: 'USD_M_MARK_PRICE',
        sourceId: fact.sourceId,
        endpointClass: fact.endpointClass,
        instrument: {
          venue: 'BINANCE',
          productFamily: 'USD_M_PERPETUAL',
          symbol: row.symbol,
          pair: row.symbol,
          baseAsset: row.base,
          quoteAsset: 'USDT',
          contractType: 'PERPETUAL',
        },
        receivedTimeMs: usdmTimestamp.receivedAtMs,
        evaluatedAtMs: nowMs,
        maxAgeMs: this.maxAgeMs,
        configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      } as const;
      const mark = normalizeMarkPrice(rawMark, context);
      if (mark.ok) {
        normalized.push(mark.value);
        qualityFailures.push(...mark.qualityFailures);
      } else {
        qualityFailures.push(...mark.failures);
      }
      if (rawMark.r !== undefined && normalized.length < MAX_PROJECTED_MARK_EVIDENCE) {
        const funding = normalizeFunding(rawMark, context);
        if (funding.ok) {
          normalized.push(funding.value);
          qualityFailures.push(...funding.qualityFailures);
        } else {
          qualityFailures.push(...funding.failures);
        }
      }
    }
    const markSourceRevision = this.nextSourceRevision(fact.sourceId, fact.dataset);
    const fundingProjected = normalized.some((record) => record.kind === 'FUNDING');
    const receipt = this.router.route({
      correlationId: stableId('existing-market-intelligence-ingest', {
        sourceTimeMs: usdmTimestamp.sourceTimeMs,
        evidenceIds: normalized.map((record) => record.id),
      }),
      scope: 'BROAD',
      source: Object.freeze({
        sourceId: fact.sourceId,
        dataset: fact.dataset,
        endpointClass: fact.endpointClass,
        lifecycle: 'LIVE' as const,
        authority: 'COMPLETE' as const,
        continuity: 'UNKNOWN' as const,
        generation: this.publicationGeneration,
        revision: markSourceRevision,
        bootstrap: normalized.length > 0 ? 'CURRENT_SNAPSHOT' as const : 'NONE' as const,
        rateBudget: unknownRateBudget(),
        observedAtMs: nowMs,
      }),
      evidence: normalized,
      qualityFailures,
    });

    const openInterest: NormalizedEvidence[] = [];
    const openInterestQualityFailures = [];
    const openInterestFact = BINANCE_SOURCE_FACTS.USD_M_OPEN_INTEREST;
    for (const row of boundedRows) {
      if (openInterest.length >= MAX_PROJECTED_OPEN_INTEREST_EVIDENCE || !row.hasPerp
          || typeof row.openInterest !== 'number' || !Number.isFinite(row.openInterest) || row.openInterest < 0) continue;
      const sourceTimeMs = validUtcOrNull(row.openInterestUpdatedAt);
      if (sourceTimeMs === null || sourceTimeMs > nowMs) continue;
      const result = normalizeOpenInterest({
        symbol: row.symbol,
        openInterest: String(row.openInterest),
        time: sourceTimeMs,
      }, {
        sourceKey: 'USD_M_OPEN_INTEREST',
        sourceId: openInterestFact.sourceId,
        endpointClass: openInterestFact.endpointClass,
        instrument: {
          venue: 'BINANCE',
          productFamily: 'USD_M_PERPETUAL',
          symbol: row.symbol,
          pair: row.symbol,
          baseAsset: row.base,
          quoteAsset: 'USDT',
          contractType: 'PERPETUAL',
        },
        receivedTimeMs: nowMs,
        evaluatedAtMs: nowMs,
        maxAgeMs: this.maxAgeMs,
        configurationVersion: PUBLIC_UNIVERSE_CONFIGURATION,
      });
      if (result.ok) {
        openInterest.push(result.value);
        openInterestQualityFailures.push(...result.qualityFailures);
      } else {
        openInterestQualityFailures.push(...result.failures);
      }
    }
    this.router.route({
      correlationId: stableId('existing-market-open-interest-ingest', {
        evidenceIds: openInterest.map((record) => record.id),
      }),
      scope: 'BROAD',
      source: Object.freeze({
        sourceId: openInterestFact.sourceId,
        dataset: openInterestFact.dataset,
        endpointClass: openInterestFact.endpointClass,
        lifecycle: 'LIVE' as const,
        authority: 'COMPLETE' as const,
        continuity: 'UNKNOWN' as const,
        generation: this.publicationGeneration,
        revision: this.nextSourceRevision(openInterestFact.sourceId, openInterestFact.dataset),
        bootstrap: openInterest.length > 0 ? 'CURRENT_SNAPSHOT' as const : 'NONE' as const,
        rateBudget: unknownRateBudget(),
        observedAtMs: nowMs,
      }),
      evidence: openInterest,
      qualityFailures: openInterestQualityFailures,
    });
    const evaluation = this.bridge.evaluate();
    return Object.freeze({
      universeReady,
      evidenceReady: evaluation.attentionPlan !== null
        && this.marketEvidenceCurrent(fact, markSourceRevision, receipt, fundingProjected),
    });
  }
}

class MarketLifecyclePort {
  private active = false;
  private generation = 0;
  private startCount = 0;

  constructor(
    private readonly market: ProductionMarketEnginePort,
    private readonly evidence: MarketEvidenceReader,
  ) {}

  readState = (): Readonly<LifecycleReadState> => Object.freeze({
    active: this.active,
    generation: this.generation,
    restartCount: Math.max(0, this.startCount - 1),
  });

  async init(): Promise<void> {
    await this.market.init();
  }

  start(): void {
    if (this.active) return;
    this.evidence.beginGeneration();
    try {
      this.market.start();
    } catch (error) {
      try { this.market.stop(); } catch { /* preserve the first startup failure */ }
      this.evidence.stop();
      throw error;
    }
    this.active = true;
    this.generation += 1;
    this.startCount += 1;
  }

  stop(): void {
    let failure: unknown = null;
    try {
      this.market.stop();
    } catch (error) {
      failure ??= error;
    } finally {
      this.active = false;
      this.evidence.stop();
    }
    if (failure !== null) throw failure;
  }

  health(_ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const evidence = this.evidence.readSource('SPOT');
    const timestamp = evidence.connected ? evidence.timestamp : null;
    return frozenHealth(
      this.active,
      timestamp,
      timestamp?.sourceTimeMs ?? timestamp?.receivedAtMs ?? null,
    );
  }
}

class BasisLifecyclePort {
  private readonly markTracker = new SourceObservationTracker();
  private readonly bookTracker = new ReceiptObservationTracker();

  constructor(
    private readonly runtime: ProductionBasisRuntimePort,
    private readonly maxAgeMs: number,
  ) {}

  async start(): Promise<void> {
    const prior = safeBasisStatus(this.runtime);
    this.markTracker.beginGeneration(prior?.lastMarkTs ?? null);
    this.bookTracker.beginGeneration(prior?.lastBookTs ?? null);
    try {
      await this.runtime.start();
    } catch (error) {
      try { this.runtime.stop(); } catch { /* preserve the first startup failure */ }
      this.markTracker.stop();
      this.bookTracker.stop();
      throw error;
    }
  }

  stop(): void {
    try {
      this.runtime.stop();
    } finally {
      this.markTracker.stop();
      this.bookTracker.stop();
    }
  }

  health(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const status = safeBasisStatus(this.runtime);
    if (!status) return frozenHealth(false, null, null);
    const book = this.bookTracker.read(
      validUtcOrNull(status.lastBookTs),
      'binance.spot-usdm.bookTicker.rest-receipt',
      this.maxAgeMs,
    );
    const mark = this.markTracker.read(
      validUtcOrNull(status.lastMarkTs),
      ctx.nowMs,
      'binance.usdm.markPrice.existing-cache',
      this.maxAgeMs,
    );
    const timestamp = weakestTemporalFact([book, mark], ctx.nowMs);
    return frozenHealth(
      status.running,
      timestamp,
      latest(validUtcOrNull(status.lastBookTs), validUtcOrNull(status.lastMarkTs)),
    );
  }
}

class VolumeLifecyclePort {
  private readonly tradeTracker = new SourceObservationTracker();
  private readonly bookTracker = new ReceiptObservationTracker();

  constructor(
    private readonly runtime: ProductionVolumeRuntimePort,
    private readonly maxAgeMs: number,
  ) {}

  async start(): Promise<void> {
    const prior = safeVolumeStatus(this.runtime);
    this.tradeTracker.beginGeneration(prior?.lastTradeTs ?? null);
    this.bookTracker.beginGeneration(prior?.lastBookTs ?? null);
    try {
      await this.runtime.start();
    } catch (error) {
      try { this.runtime.stop(); } catch { /* preserve the first startup failure */ }
      this.tradeTracker.stop();
      this.bookTracker.stop();
      throw error;
    }
  }

  stop(): void {
    try {
      this.runtime.stop();
    } finally {
      this.tradeTracker.stop();
      this.bookTracker.stop();
    }
  }

  health(ctx: ComponentStepContext): Readonly<RuntimeHealthEvidence> {
    const status = safeVolumeStatus(this.runtime);
    if (!status) return frozenHealth(false, null, null);
    const transportOpen = status.streamState === 'open'
      && Number.isSafeInteger(status.streamConnections)
      && status.streamConnections > 0
      && status.openConnections === status.streamConnections;
    const book = this.bookTracker.read(
      validUtcOrNull(status.lastBookTs),
      'binance.spot.bookTicker.rest-receipt',
      this.maxAgeMs,
    );
    const trade = this.tradeTracker.read(
      validUtcOrNull(status.lastTradeTs),
      ctx.nowMs,
      'binance.spot.aggTrade.existing-runtime',
      this.maxAgeMs,
    );
    const timestamp = transportOpen ? weakestTemporalFact([book, trade], ctx.nowMs) : null;
    return frozenHealth(
      status.running,
      timestamp,
      latest(validUtcOrNull(status.lastBookTs), validUtcOrNull(status.lastTradeTs)),
    );
  }
}

function strategySummary(
  snapshot: Readonly<ProductionStrategySnapshot> | null,
  health: Readonly<RuntimeHealthEvidence>,
  nowMs: number,
): Readonly<SystemStrategyRuntimeSummary> {
  if (!snapshot) {
    return Object.freeze({
      truthLabel: 'UNAVAILABLE',
      heartbeatAtMs: null,
      candidateCount: null,
      proposalCount: null,
      cooldownCount: null,
      rejectionCount: null,
      acceptedCount: null,
      lastDecisionAtMs: null,
      sourceRevision: null,
    });
  }
  const timestamps = snapshot.decisions
    .map((decision) => validUtcOrNull(decision.ts))
    .filter((value): value is number => value !== null);
  const freshness = health.timestamp ? evaluateFreshness(health.timestamp, nowMs) : null;
  const live = health.running && freshness?.state === 'FRESH';
  const ownerSummary = safeStrategyOwnerSummary(snapshot);
  return Object.freeze({
    truthLabel: live ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
    heartbeatAtMs: validUtcOrNull(snapshot.lastTickTs),
    candidateCount: ownerSummary?.candidateCount ?? null,
    proposalCount: ownerSummary?.opportunityCount ?? null,
    cooldownCount: ownerSummary?.cooldownCount ?? null,
    rejectionCount: snapshot.decisions.filter((decision) => decision.kind === 'reject').length,
    acceptedCount: snapshot.decisions.filter((decision) => decision.kind === 'proposal').length,
    lastDecisionAtMs: timestamps.length > 0 ? Math.max(...timestamps) : null,
    sourceRevision: null,
  });
}

export function createProductionSystemIntegrationPorts(
  input: Readonly<ProductionSystemIntegrationInput>,
): Readonly<ProductionSystemIntegrationPorts> {
  validateFactoryInput(input);
  const sourceRegistry = admitProductionSourceRegistry(input.clock);
  const maxAgeMs = publicSourceMaxAgeMs(input.sourceMaxAgeMs);

  let marketLifecycle: MarketLifecyclePort;
  const evidence = new MarketEvidenceReader(
    input.clock,
    input.market,
    maxAgeMs,
    () => marketLifecycle.readState(),
  );
  marketLifecycle = new MarketLifecyclePort(input.market, evidence);
  const publicIntelligence = new PublicIntelligenceLifecycle(
    input.clock,
    input.market,
    evidence,
    input.volume,
    maxAgeMs,
    input.intelligenceEvidenceMaximumBytes,
  );
  const basisLifecycle = new BasisLifecyclePort(input.basis, maxAgeMs);
  const volumeLifecycle = new VolumeLifecyclePort(input.volume, maxAgeMs);
  const qAdvisory = createProductionQAdvisoryRuntime({
    clock: input.clock,
    binding: input.qAdvisory === undefined
      ? createAcceptedQAbstentionBinding()
      : input.qAdvisory,
  });
  const capitalReadGuard: CapitalReadGuard = { active: false, reentered: false };

  const runtimes = Object.freeze({
    market: Object.freeze({
      init: () => marketLifecycle.init(),
      start: () => marketLifecycle.start(),
      stop: () => marketLifecycle.stop(),
      health: (ctx: ComponentStepContext) => marketLifecycle.health(ctx),
    }),
    intelligenceRuntime: Object.freeze({
      start: () => publicIntelligence.startRuntime(),
      stop: () => publicIntelligence.stopRuntime(),
      health: (ctx: ComponentStepContext) => publicIntelligence.runtimeHealth(ctx),
    }),
    marketIntelligence: Object.freeze({
      start: () => publicIntelligence.startIntelligence(),
      stop: () => publicIntelligence.stopIntelligence(),
      health: (ctx: ComponentStepContext) => publicIntelligence.intelligenceHealth(ctx),
    }),
    q: Object.freeze({
      validate: (ctx: ComponentStepContext) => qAdvisory.validate?.(ctx),
      start: () => qAdvisory.start(),
      stop: () => qAdvisory.stop(),
      health: (ctx: ComponentStepContext) => qAdvisory.health(ctx),
    }),
    basis: Object.freeze({
      start: () => basisLifecycle.start(),
      stop: () => basisLifecycle.stop(),
      health: (ctx: ComponentStepContext) => basisLifecycle.health(ctx),
    }),
    volume: Object.freeze({
      start: () => volumeLifecycle.start(),
      stop: () => volumeLifecycle.stop(),
      health: (ctx: ComponentStepContext) => volumeLifecycle.health(ctx),
    }),
  });

  const components = Object.freeze({
    'public-spot-source': Object.freeze({
      readComponentSnapshot: () => evidence.readComponent('SPOT'),
    }),
    'public-usdm-source': Object.freeze({
      readComponentSnapshot: () => evidence.readComponent('USDM'),
    }),
    'q-inference': Object.freeze({
      readComponentSnapshot: () => qAdvisory.readComponentSnapshot(),
    }),
  });

  const summaries = Object.freeze({
    readSupervisorSummaries: () => {
      const nowMs = input.clock.nowMs();
      if (!isValidUtcMillis(nowMs)) throw new TypeError('clock.nowMs returned invalid UTC ms');
      const facts = evidence.readFacts();
      const spot = evidence.readComponent('SPOT');
      const usdm = evidence.readComponent('USDM');
      const marketLive = spot.truthLabel === 'LIVE_PUBLIC' && usdm.truthLabel === 'LIVE_PUBLIC';
      const ctx: ComponentStepContext = Object.freeze({
        nowMs,
        generation: marketLifecycle.readState().generation,
        correlationId: 'production-summary-read',
        runMode: 'INTELLIGENCE',
        privateKeysAvailable: false,
      });
      const basisHealth = basisLifecycle.health(ctx);
      const volumeHealth = volumeLifecycle.health(ctx);
      const capitalRead = safeCapitalSummary(input.capitalSummary, capitalReadGuard);
      const capital = capitalRead.summary
        ?? unavailableCapitalRestartSummary(capitalRead.kind === 'MALFORMED'
          ? 'CAPITAL_SUMMARY_OWNER_MALFORMED'
          : 'CAPITAL_SUMMARY_OWNER_UNAVAILABLE');
      const result: Partial<Pick<SystemSupervisorSummaries, 'sourceCoverage' | 'strategies' | 'intelligence' | 'capital'>> = {
        sourceCoverage: Object.freeze({
          truthLabel: marketLive ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
          universeSymbols: facts.universeSymbols,
          spotCoveredSymbols: facts.spotObservedSymbols,
          usdMCoveredSymbols: facts.usdmObservedSymbols,
          quietSymbolsRetained: null,
          materialGapCount: null,
          rateLimitedSourceCount: null,
          lastMaterialGapAtMs: null,
        }),
        strategies: Object.freeze({
          basis: strategySummary(safeStrategySnapshot(input.basis), basisHealth, nowMs),
          volume: strategySummary(safeStrategySnapshot(input.volume), volumeHealth, nowMs),
        }),
        intelligence: publicIntelligence.readSummary(nowMs),
        capital,
      };
      return Object.freeze(result);
    },
  });

  const intelligenceEvidence = Object.freeze({
    readRoutingSnapshot: () => publicIntelligence.readEvidenceRoutingSnapshot(),
    readSymbol: (symbol: string) => publicIntelligence.readSymbol(symbol),
  });

  const strategyIntake = Object.freeze({
    basis: Object.freeze({
      readPaused: () => input.basis.intakePaused(),
      setPaused: (paused: boolean) => input.basis.setIntakePaused(paused),
    }),
    volume: Object.freeze({
      readPaused: () => input.volume.intakePaused(),
      setPaused: (paused: boolean) => input.volume.setIntakePaused(paused),
    }),
  });

  const strategySymbolPolicy = Object.freeze({
    basis: Object.freeze({
      readBlockedSymbols: () => input.basis.operatorBlockedSymbols(),
      setBlocked: (symbol: string, blocked: boolean) => input.basis.setOperatorSymbolBlocked(symbol, blocked),
      isAllowed: (symbol: string) => input.basis.symbolAllowedByPolicy(symbol),
    }),
    volume: Object.freeze({
      readBlockedSymbols: () => input.volume.operatorBlockedSymbols(),
      setBlocked: (symbol: string, blocked: boolean) => input.volume.setOperatorSymbolBlocked(symbol, blocked),
      isAllowed: (symbol: string) => input.volume.symbolAllowedByPolicy(symbol),
    }),
  });

  const sizeCeilings = Object.freeze({
    BASIS: Object.freeze({
      readCeiling: () => input.basis.sizeCeiling(),
      setCeiling: (value: string) => input.basis.setSizeCeiling(value),
    }),
    VOLUME: Object.freeze({
      readCeiling: () => input.volume.sizeCeiling(),
      setCeiling: (value: string) => input.volume.setSizeCeiling(value),
    }),
  });

  const strategyThresholds = Object.freeze({
    BASIS: Object.freeze({
      readThreshold: () => input.basis.strategyThreshold(),
      setThreshold: (value: string) => input.basis.setStrategyThreshold(value),
    }),
    VOLUME: Object.freeze({
      readThreshold: () => input.volume.strategyThreshold(),
      setThreshold: (value: string) => input.volume.setStrategyThreshold(value),
    }),
  });

  const attentionFocus = Object.freeze({
    readPinnedSymbols: () => publicIntelligence.readPinnedSymbols(),
    readFocusState: (symbol: string) => publicIntelligence.readFocusState(symbol),
    setPinned: (symbol: string, pinned: boolean) => publicIntelligence.setPinned(symbol, pinned),
    restorePinnedSymbols: (symbols: readonly string[]) => publicIntelligence.restorePinnedSymbols(symbols),
  });

  const capitalEligibility = createProductionCapitalEligibilityPort({
    clock: input.clock,
    owners: input.capitalEconomicsOwners ?? null,
  });

  return Object.freeze({
    sourceRegistry, runtimes, components, summaries, intelligenceEvidence,
    strategyIntake, strategySymbolPolicy, sizeCeilings, strategyThresholds, attentionFocus,
    capitalEligibility,
  });
}
