import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchAllBookTickers, fetchKlineCandles } from '../binance/rest.js';
import { mapAggTrade, type RawAggTrade } from '../engine/volume/adapters.js';
import type { VolumeConfig } from '../engine/volume/config.js';
import { deriveVolumeConfigVersion } from '../engine/volume/config.js';
import { VolumeEngine } from '../engine/volume/engine.js';
import type { VolumeForwardDetectorSourceCut } from '../engine/volume/forwardMeasurementDetectorSource.js';
import {
  VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA,
  type VolumeRuntimeForwardDetectorCut,
} from '../engine/volume/forwardMeasurementRunner.js';
import {
  assessVolumeEconomics,
  VOLUME_CURRENT_CONDITIONAL_PROXY,
  type VolumeEconomicsAssessment,
} from '../engine/volume/strategyEconomics.js';
import {
  evaluateVolumeEconomicExit,
  VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
} from '../engine/volume/strategyEconomicExit.js';
import {
  createVolumeEconomicExitLedgerCoordinator,
  type VolumeEconomicExitCheckpoint,
  type VolumeEconomicExitLedgerCoordinator,
  type VolumeEconomicExitLedgerCoordinatorSnapshot,
} from '../engine/volume/strategyEconomicExitLedger.js';
import {
  createVolumeStrategyLedgerCoordinator,
  type VolumeStrategyLedgerCoordinator,
  type VolumeStrategyLedgerCoordinatorSnapshot,
} from '../engine/volume/strategyLedger.js';
import {
  buildVolumeStrategyObservation,
  VOLUME_PUBLIC_REST_BASE_URL,
  VOLUME_PUBLIC_SOURCE_ID,
  VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
  VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS,
  type VolumeObservationContinuity,
} from '../engine/volume/strategyObservation.js';
import {
  buildVolumeValidateOnlyObservationProposal,
  createVolumeStrategySlice,
  type VolumeStrategyEvaluation,
  type VolumeStrategyProposalBinding,
  type VolumeStrategySlice,
  type VolumeStrategySliceControls,
} from '../engine/volume/strategySlice.js';
import type {
  StrategyDecayCoordinatorRequest,
  StrategyDecayCoordinatorResult,
} from '../engine/decay/index.js';
import type {
  ObservedOrderFocusApplyResult,
} from '../engine/volume/observedOrderFocus.js';
import { systemClock } from '../engine/v0/clock.js';
import { MAX_ENGINE_SYMBOLS, finite, isCanonicalSymbol, positive } from '../engine/volume/validation.js';
import type { Decision, EngineEvent } from '../engine/v0/types.js';
import type {
  VolumeFoundationRiskAttachmentInput,
  VolumeProposal,
  VolumeProposalRiskCut,
} from '../engine/volume/types.js';
import type { AppConfig } from '../types.js';
import { compareExactDecimals, normalizeNonNegativeExactDecimal } from '../capitalFoundation/contracts/index.js';
import type { Ledger } from '../ledger.js';
import {
  createObservedOrderFocusPersistence,
  DurableObservedOrderFocusCoordinator,
} from './observedOrderFocus.js';

interface MarketUniverseRow {
  symbol: string;
  base: string;
  quoteVolume24h: number | null;
  hasSpot: boolean;
  hasPerp: boolean;
}

interface VolumeRuntimeStrategyTradeCut {
  readonly generation: number;
  readonly revision: number;
  readonly receivedAtMs: number;
  readonly continuity: VolumeObservationContinuity;
  readonly raw: Readonly<RawAggTrade>;
}

interface VolumeRuntimeStrategyBookCut {
  readonly symbol: string;
  readonly bidPrice: string;
  readonly askPrice: string;
  readonly bidQuantity: string;
  readonly askQuantity: string;
  readonly receivedAtMs: number;
}

interface VolumeRuntimeStrategyCandidate {
  readonly proposal: Readonly<VolumeStrategyProposalBinding>;
  readonly tradeCut: Readonly<VolumeRuntimeStrategyTradeCut>;
  readonly bookCut: Readonly<VolumeRuntimeStrategyBookCut>;
}

export interface VolumeRuntimeStrategySliceSnapshot {
  readonly controls: Readonly<VolumeStrategySliceControls>;
  readonly economics: Readonly<VolumeEconomicsAssessment>;
  readonly latestEvaluation: Readonly<VolumeStrategyEvaluation> | null;
  readonly lifecycle: Readonly<{
    mode: 'VALIDATE_ONLY_RECORD';
    checkpointScope: 'LATEST_ONLY';
    persistence: VolumeStrategyLedgerCoordinatorSnapshot;
    restoreAttempts: number;
    commitAttempts: number;
    durablePublications: number;
    directObservationMinIntervalMs: number;
    nextDirectObservationAtMs: number;
  }>;
}

export interface VolumeRuntimeEconomicExitSnapshot {
  readonly controls: Readonly<{
    enabled: false;
    killSwitch: 'ON';
    mode: 'SHADOW_ONLY';
    executionAuthority: 'NONE';
    submitAuthority: 'NONE';
    privateDataAuthority: 'NONE';
    providerAuthority: 'NONE';
  }>;
  readonly latestSample: Readonly<VolumeEconomicExitCheckpoint['latestSample']> | null;
  readonly latestDecision: Readonly<VolumeEconomicExitCheckpoint['latestDecision']> | null;
  readonly lifecycle: Readonly<{
    mode: 'SHADOW_ONLY_RECORD';
    checkpointScope: 'LATEST_ONLY';
    persistence: VolumeEconomicExitLedgerCoordinatorSnapshot;
    restoreAttempts: number;
    commitAttempts: number;
    durablePublications: number;
  }>;
}

export interface VolumeRuntimeIntegrationSnapshot {
  /** Capture time only. Never use this field as source-observation freshness. */
  capturedAtMs: number;
  lastTickTs: number | null;
  config: VolumeConfig;
  decisions: Decision[];
  proposals: VolumeProposal[];
  strategySlice: Readonly<VolumeRuntimeStrategySliceSnapshot>;
  economicExit: Readonly<VolumeRuntimeEconomicExitSnapshot>;
  ownerSummary: {
    candidateCount: number;
    opportunityCount: number;
    cooldownCount: number;
  };
}

export type VolumeRuntimeEvidenceCut = Readonly<{
  kind: 'SPOT_AGG_TRADE';
  generation: number;
  revision: number;
  receivedAtMs: number;
  continuity: 'CONTIGUOUS' | 'GAP' | 'UNKNOWN';
  baseAsset: string;
  raw: Readonly<RawAggTrade>;
} | {
  kind: 'SOURCE_CLOSED';
  generation: number;
  revision: number;
  observedAtMs: number;
}>;

export interface VolumeStrategyDecayCadencePort {
  tick(request: Readonly<StrategyDecayCoordinatorRequest>): StrategyDecayCoordinatorResult;
}

interface VolumeStreamHandle {
  readonly name: string;
  start(): void;
  stop(): void;
}

type VolumeStreamFactory = (
  name: string,
  url: string,
  onMessage: (data: unknown) => void,
  onStatus: (name: string, status: FeedStatus) => void,
) => VolumeStreamHandle;

export interface VolumeRuntimeOptions {
  /** Test-time compression only; production retains the bounded default. */
  sourceRecoveryBaseMs?: number;
  random?: () => number;
  streamFactory?: VolumeStreamFactory;
  /**
   * Explicit, synchronous, observation-only V-I3 seam. Production remains
   * unbound by default. The observer receives only sanitized public detector
   * cuts and has no submit, CAS, private-read, or mutable engine authority.
   */
  forwardMeasurementObserver?: (
    cut: Readonly<VolumeRuntimeForwardDetectorCut>,
  ) => void;
  /**
   * Accepted V-I3 capture-generation identity. Omitted production composition
   * continues to report the runtime's own generation.
   */
  forwardMeasurementRuntimeGeneration?: number;
  /** Deterministic test seam for the local monotonic receive clock. */
  forwardMeasurementMonotonicNowNs?: () => bigint;
}

const STREAM_CHUNK = 140;
const UNIVERSE_REFRESH_MS = 15 * 60_000;
const BOOK_REFRESH_MS = 2_750;
const DIRECT_PUBLIC_OBSERVATION_MIN_INTERVAL_MS = 60 * 60_000;
// BinanceStream deliberately latches after its bounded retry campaign. The
// runtime that owns the producer therefore re-arms it on a bounded,
// de-synchronised supervisory schedule until an open proves recovery.
const SOURCE_RECOVERY_BASE_MS = 60_000;
const SOURCE_RECOVERY_MAX_MS = 15 * 60_000;
const SOURCE_RECOVERY_JITTER_RATIO = 0.2;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

function positivePlainDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const source = String(value);
  const exponentIndex = source.search(/[eE]/);
  if (exponentIndex < 0) return source;
  const coefficient = source.slice(0, exponentIndex);
  const exponent = Number(source.slice(exponentIndex + 1));
  if (!Number.isSafeInteger(exponent)) return null;
  const sign = coefficient.startsWith('-') ? '-' : '';
  const unsigned = sign.length === 0 ? coefficient : coefficient.slice(1);
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = whole + fraction;
  const point = whole.length + exponent;
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function strategyProposalEvaluationKey(
  proposal: Readonly<Pick<
    VolumeProposalRiskCut,
    | 'proposalId'
    | 'proposalRevision'
    | 'proposalDigest'
    | 'configurationRevision'
    | 'correlationId'
  >>,
): string {
  return JSON.stringify([
    proposal.proposalId,
    proposal.proposalRevision,
    proposal.proposalDigest,
    proposal.configurationRevision,
    proposal.correlationId,
  ]);
}

export class VolumeRuntime {
  private readonly engine: VolumeEngine;
  private readonly strategySlice: Readonly<VolumeStrategySlice>;
  private readonly strategyEconomics: Readonly<VolumeEconomicsAssessment>;
  private readonly strategyLedgerCoordinator: VolumeStrategyLedgerCoordinator | null;
  private readonly economicExitLedgerCoordinator: VolumeEconomicExitLedgerCoordinator | null;
  private latestStrategyEvaluation: Readonly<VolumeStrategyEvaluation> | null = null;
  private latestEconomicExitSample: Readonly<VolumeEconomicExitCheckpoint['latestSample']> | null = null;
  private latestEconomicExitDecision: Readonly<VolumeEconomicExitCheckpoint['latestDecision']> | null = null;
  private strategyRestoreAttempts = 0;
  private strategyCommitAttempts = 0;
  private strategyDurablePublications = 0;
  private strategyPersistenceBlocked = false;
  private economicExitRestoreAttempts = 0;
  private economicExitCommitAttempts = 0;
  private economicExitDurablePublications = 0;
  private economicExitPersistenceBlocked = false;
  private strategyNextDirectObservationAtMs = 0;
  private readonly observedOrderFocusCoordinator: DurableObservedOrderFocusCoordinator | null;
  private streams: VolumeStreamHandle[] = [];
  private readonly streamStopQuarantine = new Set<VolumeStreamHandle>();
  private streamStatus = new Map<string, FeedStatus>();
  private readonly streamRecoveryTimers = new Map<string, NodeJS.Timeout>();
  private readonly streamRecoveryAttempts = new Map<string, number>();
  private readonly sourceRecoveryBaseMs: number;
  private readonly recoveryRandom: () => number;
  private readonly streamFactory: VolumeStreamFactory;
  private eligibleSymbols: string[] = [];
  private eligibleSymbolSet = new Set<string>();
  private eligibleBaseBySymbol = new Map<string, string>();
  private symbolSetKey = '';
  private streamOwnershipKey: string | null = null;
  private running = false;
  private stopping = false;
  private generation = 0;
  private streamEpoch = 0;
  private startPromise: Promise<void> | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private bookTimer: NodeJS.Timeout | null = null;
  private universeTimer: NodeJS.Timeout | null = null;
  private streamRetryTimer: NodeJS.Timeout | null = null;
  private streamRetryMs = 1_000;
  private bookBusyGeneration: number | null = null;
  private warmingSymbols = new Map<string, number>();
  private seeded = new Set<string>();
  private baselineTotal = 0;
  private baselineCompleted = 0;
  private baselineFailed = 0;
  private baselineFailures = new Set<string>();
  private lastBookTs: number | null = null;
  private lastTradeTs: number | null = null;
  private symbolLastTradeTs = new Map<string, number>();
  private lastAggTradeId = new Map<string, number>();
  private lastRawTradeId = new Map<string, number>();
  private sourceContinuityLatch = new Map<
    string,
    Extract<VolumeObservationContinuity, 'GAP' | 'RECONNECTING'>
  >();
  private strategyTradeCuts = new Map<string, Readonly<VolumeRuntimeStrategyTradeCut>>();
  private strategyBookCuts = new Map<string, Readonly<VolumeRuntimeStrategyBookCut>>();
  private strategyEvaluationKeyBySymbol = new Map<string, string>();
  private tradeMessages = 0;
  private evidenceRevision = 0;
  private evidenceObserver: ((cut: VolumeRuntimeEvidenceCut) => void) | null = null;
  private readonly forwardMeasurementObserver:
    ((cut: Readonly<VolumeRuntimeForwardDetectorCut>) => void) | null;
  private readonly forwardMeasurementRuntimeGeneration: number | null;
  private readonly forwardMeasurementMonotonicNowNs: () => bigint;
  private forwardMeasurementTickRevision = 0;
  private forwardMeasurementObserverFailureCount = 0;
  private configKey = '';
  private persistedEventKeys = new Set<string>();
  private persistedEventOrder: string[] = [];
  private ledgerFailureCount = 0;

  private lastObservedNowMs = 0;

  /**
   * Non-regressing UTC read (F-080): freshness ages (`now - lastBookTs`) were
   * computed from the raw wall clock, so a backward NTP step made the age
   * negative and stale data reported 'fresh'. Latching mirrors
   * systemIntegration's createSystemUtcClock: a backward step freezes
   * observed time instead of inverting it.
   */
  private latchedNowMs(): number {
    const observed = this.nowSource();
    if (Number.isFinite(observed)) {
      this.lastObservedNowMs = Math.max(this.lastObservedNowMs, observed);
    }
    return this.lastObservedNowMs;
  }

  constructor(
    private readonly ledger: Ledger,
    private readonly getConfig: () => AppConfig,
    private readonly getUniverse: () => MarketUniverseRow[],
    private readonly strategyDecay: VolumeStrategyDecayCadencePort | null = null,
    private readonly nowSource: () => number = () => Date.now(),
    options: Readonly<VolumeRuntimeOptions> = Object.freeze({}),
  ) {
    const recoveryBaseMs = options.sourceRecoveryBaseMs ?? SOURCE_RECOVERY_BASE_MS;
    if (
      !Number.isSafeInteger(recoveryBaseMs)
      || recoveryBaseMs < 1
      || recoveryBaseMs > SOURCE_RECOVERY_MAX_MS
    ) {
      throw new RangeError(`VOLUME_SOURCE_RECOVERY_BASE_OUT_OF_BOUNDS:${String(recoveryBaseMs)}`);
    }
    if (options.random !== undefined && typeof options.random !== 'function') {
      throw new TypeError('VOLUME_SOURCE_RECOVERY_RANDOM_INVALID');
    }
    if (options.streamFactory !== undefined && typeof options.streamFactory !== 'function') {
      throw new TypeError('VOLUME_STREAM_FACTORY_INVALID');
    }
    if (
      options.forwardMeasurementObserver !== undefined
      && typeof options.forwardMeasurementObserver !== 'function'
    ) {
      throw new TypeError('VOLUME_FORWARD_MEASUREMENT_OBSERVER_INVALID');
    }
    if (
      options.forwardMeasurementMonotonicNowNs !== undefined
      && typeof options.forwardMeasurementMonotonicNowNs !== 'function'
    ) {
      throw new TypeError('VOLUME_FORWARD_MEASUREMENT_MONOTONIC_CLOCK_INVALID');
    }
    if (
      options.forwardMeasurementRuntimeGeneration !== undefined
      && (
        !Number.isSafeInteger(options.forwardMeasurementRuntimeGeneration)
        || options.forwardMeasurementRuntimeGeneration < 1
      )
    ) {
      throw new TypeError('VOLUME_FORWARD_MEASUREMENT_GENERATION_INVALID');
    }
    this.sourceRecoveryBaseMs = recoveryBaseMs;
    this.recoveryRandom = options.random ?? Math.random;
    this.streamFactory = options.streamFactory
      ?? ((name, url, onMessage, onStatus) => new BinanceStream(name, url, onMessage, onStatus));
    this.forwardMeasurementObserver =
      options.forwardMeasurementObserver ?? null;
    this.forwardMeasurementRuntimeGeneration =
      options.forwardMeasurementRuntimeGeneration ?? null;
    this.forwardMeasurementMonotonicNowNs =
      options.forwardMeasurementMonotonicNowNs ?? (() => process.hrtime.bigint());
    this.engine = new VolumeEngine(systemClock, undefined, {
      emit: (event) => this.persistEvent(event),
    });
    this.strategySlice = createVolumeStrategySlice();
    this.strategyEconomics = assessVolumeEconomics(VOLUME_CURRENT_CONDITIONAL_PROXY);
    this.strategyLedgerCoordinator = typeof ledger?.getConfigValue === 'function'
      && typeof ledger?.compareAndSetConfigValueAndLogEvents === 'function'
      ? createVolumeStrategyLedgerCoordinator(ledger)
      : null;
    this.economicExitLedgerCoordinator = typeof ledger?.getConfigValue === 'function'
      && typeof ledger?.compareAndSetConfigValueAndLogEvents === 'function'
      ? createVolumeEconomicExitLedgerCoordinator(ledger)
      : null;
    this.observedOrderFocusCoordinator = typeof ledger?.getConfigValue === 'function'
      && typeof ledger?.compareAndSetConfigValueAndLogEvents === 'function'
      ? new DurableObservedOrderFocusCoordinator(
          systemClock,
          createObservedOrderFocusPersistence(ledger),
          Object.freeze({
            applyObservedOrderFocus: (snapshot: unknown) => this.engine.applyObservedOrderFocus(snapshot),
            restoreObservedOrderFocus: (snapshot: unknown) => this.engine.restoreObservedOrderFocus(snapshot),
            observedOrderFocusReadback: (
              status: ObservedOrderFocusApplyResult['status'],
              applied: boolean,
              reasonCodes: readonly string[],
            ) => this.engine.observedOrderFocusReadback(status, applied, reasonCodes),
          }),
        )
      : null;
  }

  async start(): Promise<void> {
    if (this.stopping) return;
    if (this.running) return this.startPromise ?? Promise.resolve();
    this.restoreStrategySlice();
    this.restoreEconomicExitRule();
    const restoration = this.observedOrderFocusCoordinator?.restore();
    if (restoration !== undefined
        && (restoration.state === 'UNAVAILABLE'
          || restoration.state === 'CORRUPT'
          || restoration.state === 'CONFLICT')) {
      throw new Error(`volume observed-order focus restore failed: ${restoration.state}`);
    }
    const generation = ++this.generation;
    this.evidenceRevision = 0;
    this.forwardMeasurementTickRevision = 0;
    this.forwardMeasurementObserverFailureCount = 0;
    this.lastAggTradeId.clear();
    this.lastRawTradeId.clear();
    this.sourceContinuityLatch.clear();
    this.strategyTradeCuts.clear();
    this.strategyBookCuts.clear();
    this.strategyEvaluationKeyBySymbol.clear();
    this.running = true;
    this.engine.start();
    const promise = this.startGeneration(generation);
    this.startPromise = promise;
    await promise;
    if (this.startPromise === promise) this.startPromise = null;
  }

  stop(): void {
    if (this.stopping) return;
    if (
      !this.running
      && !this.startPromise
      && !this.engine.isRunning()
      && this.streams.length === 0
      && this.streamStopQuarantine.size === 0
    ) return;
    this.stopping = true;
    try {
      const closingGeneration = this.generation;
      const observedAtMs = this.latchedNowMs();
      this.publishEvidence(Object.freeze({
        kind: 'SOURCE_CLOSED' as const,
        generation: closingGeneration,
        revision: this.nextEvidenceRevision(),
        observedAtMs,
      }));
      ++this.generation;
      ++this.streamEpoch;
      this.running = false;
      this.startPromise = null;
      this.streamOwnershipKey = null;
      this.symbolSetKey = '';
      this.clearAllStreamRecoveries();
      const stopCandidates = new Set([...this.streams, ...this.streamStopQuarantine]);
      for (const stream of stopCandidates) {
        try {
          stream.stop();
          this.streamStopQuarantine.delete(stream);
        } catch {
          this.streamStopQuarantine.add(stream);
        }
      }
      this.streams = [...this.streamStopQuarantine];
      // A subsequent start() must rebuild sockets even when the eligible symbol
      // universe is unchanged. Keeping the old key left the runtime running with
      // zero streams after an operator-initiated recovery.
      this.streamStatus.clear();
      this.eligibleSymbols = [];
      this.eligibleSymbolSet.clear();
      this.eligibleBaseBySymbol.clear();
      this.lastAggTradeId.clear();
      this.lastRawTradeId.clear();
      this.sourceContinuityLatch.clear();
      this.strategyTradeCuts.clear();
      this.strategyBookCuts.clear();
      this.strategyEvaluationKeyBySymbol.clear();
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.bookTimer) clearInterval(this.bookTimer);
      if (this.universeTimer) clearInterval(this.universeTimer);
      if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
      this.tickTimer = null;
      this.bookTimer = null;
      this.universeTimer = null;
      this.streamRetryTimer = null;
      this.streamRetryMs = 1_000;
      this.bookBusyGeneration = null;
      this.warmingSymbols.clear();
      this.engine.stop();
    } finally {
      this.stopping = false;
    }
  }

  private async startGeneration(generation: number): Promise<void> {
    try {
      this.configKey = this.applyDynamicConfig();
      await this.refreshUniverse(generation);
      if (!this.isActive(generation)) return;
      this.tickTimer = setInterval(() => this.onTick(generation), this.engine.cfg.tickMs);
      this.bookTimer = setInterval(
        () => this.launch('book refresh', generation, () => this.refreshBooks(generation)),
        BOOK_REFRESH_MS,
      );
      this.universeTimer = setInterval(
        () => this.launch('universe refresh', generation, () => this.refreshUniverse(generation)),
        UNIVERSE_REFRESH_MS,
      );
      this.launch('initial book refresh', generation, () => this.refreshBooks(generation));
    } catch (error) {
      const failedEpoch = this.streamEpoch;
      const failedStreams = this.streams;
      const staleRetryTimer = this.streamRetryTimer;
      this.safeLog('error_event', null, {
        source: 'volume-runtime.start',
        message: error instanceof Error ? error.message : String(error),
      });
      if (
        this.isActive(generation)
        && this.streamEpoch === failedEpoch
        && this.streams === failedStreams
      ) {
        this.stop();
        return;
      }
      if (
        staleRetryTimer !== null
        && this.streamRetryTimer === staleRetryTimer
      ) {
        this.clearStreamRetry();
      }
    }
  }

  private onTick(generation: number): void {
    if (!this.isActive(generation)) return;
    try {
      const previousKey = this.configKey;
      const nextKey = this.applyDynamicConfig();
      this.configKey = nextKey;
      if (nextKey !== previousKey) {
        this.launch('config universe refresh', generation, () => this.refreshUniverse(generation));
      }
      const detectorSourceCut = this.engine.tick(
        this.forwardMeasurementObserver !== null,
      );
      this.publishForwardMeasurementDetectorCut(
        generation,
        detectorSourceCut,
      );
      const tickAtMs = this.engine.lastTick();
      if (tickAtMs !== null) {
        this.evaluateStrategySlice();
        this.tickStrategyDecay(tickAtMs);
      }
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.tick',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private tickStrategyDecay(evaluatedAtMs: number): void {
    if (this.strategyDecay === null) return;
    let configVersion: string;
    try {
      configVersion = deriveVolumeConfigVersion(this.engine.cfg);
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.strategy-decay.config',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const direction of ['long', 'short'] as const) {
      try {
        const result = this.strategyDecay.tick({ strategy: 'VOLUME', configVersion, direction, evaluatedAtMs });
        if (result.disposition === 'BLOCKED') {
          this.safeLog('error_event', null, {
            source: 'volume-runtime.strategy-decay',
            direction,
            reasonCodes: result.reasonCodes,
          });
        }
      } catch (error) {
        this.safeLog('error_event', null, {
          source: 'volume-runtime.strategy-decay',
          direction,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private publishForwardMeasurementDetectorCut(
    generation: number,
    sourceCut: Readonly<VolumeForwardDetectorSourceCut> | null,
  ): void {
    if (this.forwardMeasurementObserver === null) return;
    if (sourceCut === null || generation !== this.generation) {
      this.forwardMeasurementObserverFailureCount += 1;
      return;
    }
    let localMonotonicNs: bigint;
    try {
      localMonotonicNs = this.forwardMeasurementMonotonicNowNs();
      if (typeof localMonotonicNs !== 'bigint' || localMonotonicNs < 0n) {
        throw new TypeError('invalid forward measurement monotonic clock');
      }
      if (
        !Number.isSafeInteger(this.forwardMeasurementTickRevision)
        || this.forwardMeasurementTickRevision >= Number.MAX_SAFE_INTEGER
      ) {
        throw new RangeError('forward measurement tick revision exhausted');
      }
      this.forwardMeasurementTickRevision += 1;
      const cut: Readonly<VolumeRuntimeForwardDetectorCut> = Object.freeze({
        schemaVersion: VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA,
        runtimeGeneration:
          this.forwardMeasurementRuntimeGeneration ?? generation,
        detectorTickRevision: this.forwardMeasurementTickRevision,
        localReceivedAtMs: this.latchedNowMs(),
        localMonotonicNs: String(localMonotonicNs),
        observerFailureCount:
          this.forwardMeasurementObserverFailureCount,
        sourceCut,
      });
      const result = this.forwardMeasurementObserver(cut) as unknown;
      if (
        result !== null
        && (
          typeof result === 'object'
          || typeof result === 'function'
        )
        && typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        throw new TypeError('forward measurement observer must be synchronous');
      }
    } catch (error) {
      this.forwardMeasurementObserverFailureCount += 1;
      this.safeLog('error_event', null, {
        source: 'volume-runtime.forward-measurement-observer',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  connectionStatus(): {
    running: boolean;
    streamState: 'starting' | 'open' | 'connecting' | 'degraded';
    streamConnections: number;
    openConnections: number;
    bookState: 'fresh' | 'stale';
    lastBookTs: number | null;
    lastTradeTs: number | null;
  } {
    const now = this.latchedNowMs();
    const openConnections = [...this.streamStatus.values()].filter((status) => status === 'open').length;
    const streamState = this.streams.length === 0
      ? 'starting'
      : openConnections === this.streams.length
        ? 'open'
        : [...this.streamStatus.values()].some((status) => status === 'connecting')
          ? 'connecting'
          : 'degraded';
    return {
      running: this.running && this.engine.isRunning(),
      streamState,
      streamConnections: this.streams.length,
      openConnections,
      bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
      lastBookTs: this.lastBookTs,
      lastTradeTs: this.lastTradeTs,
    };
  }

  /**
   * Bounded, defensive read seam for system integration. It preserves the
   * engine's real proposal/correlation identity and raw tick time while
   * reusing the runtime's existing public Binance producers.
   */
  integrationSnapshot(): VolumeRuntimeIntegrationSnapshot {
    return structuredClone({
      capturedAtMs: this.latchedNowMs(),
      lastTickTs: this.engine.lastTick(),
      config: this.engine.cfg,
      decisions: this.engine.decisions(2_000),
      proposals: this.engine.proposalStore.all().slice(-2_000),
      strategySlice: this.strategySliceSnapshot(),
      economicExit: this.economicExitSnapshot(),
      ownerSummary: {
        candidateCount: this.engine.focusMgr.candidateList().length,
        opportunityCount: this.engine.proposalStore.openProposals().length,
        cooldownCount: this.engine.focusMgr.activeCooldownCount(),
      },
    });
  }

  private restoreStrategySlice(): void {
    // The production slice remains OFF with its kill switch engaged, but its
    // rejected record-only plans still require exact durability/reconciliation.
    // Legacy test ledgers without the canonical CAS surface cannot publish.
    if (this.strategyLedgerCoordinator === null) return;
    this.strategyRestoreAttempts += 1;
    const restoration = this.strategyLedgerCoordinator.restore();
    if (restoration.status === 'CORRUPT' || restoration.status === 'UNAVAILABLE') {
      this.latestStrategyEvaluation = null;
      this.strategyEvaluationKeyBySymbol.clear();
      this.strategyPersistenceBlocked = true;
      return;
    }
    this.strategyPersistenceBlocked = false;
    this.latestStrategyEvaluation = restoration.status === 'RESTORED'
      ? restoration.checkpoint.lastEvaluation
      : null;
    const restoredDirectEvaluation = this.latestStrategyEvaluation?.proposal.correlationId
      .startsWith('vroc:') === true
      ? this.latestStrategyEvaluation
      : null;
    this.strategyNextDirectObservationAtMs = restoredDirectEvaluation === null
      ? 0
      : Math.min(
          4_102_444_800_000,
          restoredDirectEvaluation.evaluatedAtMs
            + DIRECT_PUBLIC_OBSERVATION_MIN_INTERVAL_MS,
        );
  }

  private restoreEconomicExitRule(): void {
    // The successor checkpoint is independent from the V-I1 record. A corrupt
    // or unavailable exit checkpoint blocks only this shadow-only lane.
    if (this.economicExitLedgerCoordinator === null) return;
    this.economicExitRestoreAttempts += 1;
    const restoration = this.economicExitLedgerCoordinator.restore();
    if (restoration.status === 'CORRUPT' || restoration.status === 'UNAVAILABLE') {
      this.latestEconomicExitSample = null;
      this.latestEconomicExitDecision = null;
      this.economicExitPersistenceBlocked = true;
      return;
    }
    this.economicExitPersistenceBlocked = false;
    this.latestEconomicExitSample = restoration.status === 'RESTORED'
      ? restoration.checkpoint.latestSample
      : null;
    this.latestEconomicExitDecision = restoration.status === 'RESTORED'
      ? restoration.checkpoint.latestDecision
      : null;
  }

  private evaluateStrategySlice(): void {
    // Evaluation is record-only. OFF and kill-ON are immutable rejection
    // inputs; no provider, private endpoint, signer, submitter, or order port
    // exists in this path.
    if (this.strategyLedgerCoordinator === null || this.strategyPersistenceBlocked) return;
    const evaluatedAtMs = this.latchedNowMs();
    if (
      !Number.isSafeInteger(evaluatedAtMs)
      || evaluatedAtMs < 0
    ) return;

    const candidates: VolumeRuntimeStrategyCandidate[] = [];
    const addCandidate = (
      proposal: Readonly<VolumeStrategyProposalBinding>,
    ): void => {
      const tradeCut = this.strategyTradeCuts.get(proposal.symbol);
      const bookCut = this.strategyBookCuts.get(proposal.symbol);
      if (
        tradeCut === undefined
        || bookCut === undefined
        || tradeCut.generation !== this.generation
        || tradeCut.revision < 1
        || tradeCut.raw.s !== proposal.symbol
        || this.lastAggTradeId.get(proposal.symbol) !== tradeCut.raw.a
        || this.lastRawTradeId.get(proposal.symbol) !== tradeCut.raw.l
        || bookCut.symbol !== proposal.symbol
        || proposal.updatedTs > evaluatedAtMs
        || evaluatedAtMs - proposal.updatedTs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
        || proposal.expiresAtMs <= evaluatedAtMs
      ) return;
      const sourceTimes = [
        tradeCut.raw.E,
        tradeCut.raw.T,
        tradeCut.receivedAtMs,
        bookCut.receivedAtMs,
      ];
      if (sourceTimes.some((value) => (
        !Number.isSafeInteger(value)
        || value < 0
        || value > evaluatedAtMs
        || evaluatedAtMs - value > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
      ))) return;
      candidates.push(Object.freeze({ proposal, tradeCut, bookCut }));
    };

    for (const proposal of this.engine.proposalStore.openProposals().slice(-2_000)) {
      const proposalCut = this.engine.readProposalRiskCut(proposal.id);
      if (proposalCut !== null) addCandidate(proposalCut);
    }

    let configurationRevision: string | null = null;
    try {
      configurationRevision = deriveVolumeConfigVersion(this.engine.cfg);
    } catch {
      // A non-canonical mutable configuration cannot produce a proposal record.
    }
    if (configurationRevision !== null) {
      for (const decision of this.engine.decisions(2_000)) {
        const direction = decision.evidence.direction;
        if (
          decision.strategy !== 'volume_spike'
          || decision.kind !== 'reject'
          || decision.rejectCode !== 'kill_switch_on'
          || !isCanonicalSymbol(decision.symbol)
          || (direction !== 'long' && direction !== 'short')
          || decision.ts > evaluatedAtMs
          || evaluatedAtMs - decision.ts > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
        ) continue;
        const expiresAtMs = decision.ts + this.engine.cfg.proposalTtlMs;
        if (
          !Number.isSafeInteger(expiresAtMs)
          || expiresAtMs <= decision.ts
          || expiresAtMs > 4_102_444_800_000
        ) continue;
        try {
          addCandidate(buildVolumeValidateOnlyObservationProposal({
            decision,
            configurationRevision,
            expiresAtMs,
          }));
        } catch {
          // The builder owns strict verified-decision validation.
        }
      }

      for (
        const tradeCut of evaluatedAtMs >= this.strategyNextDirectObservationAtMs
          ? this.strategyTradeCuts.values()
          : []
      ) {
        const symbol = tradeCut.raw.s;
        const continuity = this.sourceContinuityLatch.get(symbol) ?? tradeCut.continuity;
        if (
          tradeCut.generation !== this.generation
          || tradeCut.revision < 1
          || this.lastAggTradeId.get(symbol) !== tradeCut.raw.a
          || this.lastRawTradeId.get(symbol) !== tradeCut.raw.l
          || tradeCut.raw.E > tradeCut.receivedAtMs
          || tradeCut.raw.T > tradeCut.receivedAtMs
          || tradeCut.receivedAtMs > evaluatedAtMs
          || evaluatedAtMs - tradeCut.receivedAtMs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
        ) continue;
        const expiresAtMs = tradeCut.receivedAtMs + this.engine.cfg.proposalTtlMs;
        if (
          !Number.isSafeInteger(expiresAtMs)
          || expiresAtMs <= tradeCut.receivedAtMs
          || expiresAtMs > 4_102_444_800_000
        ) continue;
        try {
          addCandidate(buildVolumeValidateOnlyObservationProposal({
            decision: {
              symbol,
              ts: tradeCut.receivedAtMs,
              strategy: 'volume_spike',
              kind: 'reject',
              rejectCode: 'kill_switch_on',
              humanReason: 'public aggregate trade observed under default-OFF validate-only posture',
              correlationId: [
                'vroc',
                tradeCut.generation,
                tradeCut.revision,
                symbol,
                tradeCut.raw.a,
              ].join(':'),
              evidence: {
                direction: tradeCut.raw.m ? 'short' : 'long',
                sourceId: VOLUME_PUBLIC_SOURCE_ID,
                authentication: 'NONE',
                publicOnly: true,
                transport: 'SPOT_AGG_TRADE',
                generation: tradeCut.generation,
                revision: tradeCut.revision,
                aggregateTradeId: tradeCut.raw.a,
                firstTradeId: tradeCut.raw.f,
                lastTradeId: tradeCut.raw.l,
                eventTimeMs: tradeCut.raw.E,
                tradeTimeMs: tradeCut.raw.T,
                receivedAtMs: tradeCut.receivedAtMs,
                continuity,
                buyerIsMaker: tradeCut.raw.m,
              },
            },
            configurationRevision,
            expiresAtMs,
          }));
        } catch {
          // The builder owns exact data-only decision identity.
        }
      }
    }

    candidates.sort((left, right) => {
      if (left.proposal.updatedTs !== right.proposal.updatedTs) {
        return right.proposal.updatedTs - left.proposal.updatedTs;
      }
      return left.proposal.proposalId < right.proposal.proposalId
        ? -1
        : left.proposal.proposalId > right.proposal.proposalId
          ? 1
          : 0;
    });
    const candidate = candidates[0];
    if (candidate === undefined) return;

    const { proposal, tradeCut, bookCut } = candidate;
    const evaluationKey = strategyProposalEvaluationKey(proposal);
    if (
      this.latestStrategyEvaluation !== null
      && strategyProposalEvaluationKey(this.latestStrategyEvaluation.proposal) === evaluationKey
    ) {
      this.strategyEvaluationKeyBySymbol.set(proposal.symbol, evaluationKey);
      return;
    }
    if (this.strategyEvaluationKeyBySymbol.get(proposal.symbol) === evaluationKey) return;
    const continuity = this.sourceContinuityLatch.get(proposal.symbol) ?? tradeCut.continuity;
    let observation: ReturnType<typeof buildVolumeStrategyObservation>;
    try {
      observation = buildVolumeStrategyObservation({
        proposal: {
          proposalId: proposal.proposalId,
          proposalRevision: proposal.proposalRevision,
          proposalDigest: proposal.proposalDigest,
          configurationRevision: proposal.configurationRevision,
          correlationId: proposal.correlationId,
          symbol: proposal.symbol,
          direction: proposal.direction,
          expiresAtMs: proposal.expiresAtMs,
        },
        source: {
          sourceId: VOLUME_PUBLIC_SOURCE_ID,
          restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
          websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
          authentication: 'NONE',
          timeUnit: 'MILLISECOND',
          generation: tradeCut.generation,
          revision: tradeCut.revision,
          continuity,
        },
        aggregateTrade: {
          symbol: tradeCut.raw.s,
          aggregateTradeId: tradeCut.raw.a,
          firstTradeId: tradeCut.raw.f,
          lastTradeId: tradeCut.raw.l,
          eventTimeMs: tradeCut.raw.E,
          tradeTimeMs: tradeCut.raw.T,
          receivedAtMs: tradeCut.receivedAtMs,
        },
        book: {
          symbol: bookCut.symbol,
          bidPrice: bookCut.bidPrice,
          askPrice: bookCut.askPrice,
          bidQuantity: bookCut.bidQuantity,
          askQuantity: bookCut.askQuantity,
          sourceTimeMs: null,
          receivedAtMs: bookCut.receivedAtMs,
          freshnessBasis: 'RECEIVE_TIME',
          numericFidelity: 'NORMALIZED_FROM_PARSED_NUMBER',
          scope: 'TOP_OF_BOOK',
          depth: null,
        },
        evaluatedAtMs,
      });
    } catch {
      return;
    }
    const evaluation = this.strategySlice.evaluate({
      proposal,
      observation,
      economics: VOLUME_CURRENT_CONDITIONAL_PROXY,
    });
    this.strategyCommitAttempts += 1;
    const committed = this.strategyLedgerCoordinator.commit({ evaluation });
    if (
      committed.disposition !== 'COMMITTED_NEW'
      && committed.disposition !== 'ALREADY_COMMITTED'
    ) {
      this.latestStrategyEvaluation = null;
      this.strategyPersistenceBlocked = true;
      throw new Error(`volume strategy ledger commit failed: ${committed.disposition}`);
    }
    this.latestStrategyEvaluation = committed.checkpoint.lastEvaluation;
    this.strategyEvaluationKeyBySymbol.set(proposal.symbol, evaluationKey);
    if (proposal.correlationId.startsWith('vroc:')) {
      this.strategyNextDirectObservationAtMs = Math.min(
        4_102_444_800_000,
        evaluatedAtMs + DIRECT_PUBLIC_OBSERVATION_MIN_INTERVAL_MS,
      );
      if (committed.disposition === 'COMMITTED_NEW') {
        this.evaluateEconomicExitRule(
          committed.checkpoint.lastEvaluation,
          observation,
          evaluatedAtMs,
        );
      }
    }
    if (committed.disposition === 'COMMITTED_NEW') {
      this.strategyDurablePublications += 1;
    }
  }

  private evaluateEconomicExitRule(
    entryEvaluation: Readonly<VolumeStrategyEvaluation>,
    entryObservation: Readonly<ReturnType<typeof buildVolumeStrategyObservation>>,
    evaluatedAtMs: number,
  ): void {
    // A fresh, exact direct-public V-I1 commit is the only production input to
    // this successor. The runtime remains immutable OFF/KILL-ON, so the pure
    // rule can publish a named in-memory non-admission but cannot create a
    // HOLDING sample or reach the exit ledger. Synthetic entry assumptions are
    // confined to the pure rule's focused tests.
    if (
      this.economicExitLedgerCoordinator === null
      || this.economicExitPersistenceBlocked
    ) return;
    const result = evaluateVolumeEconomicExit({
      entryEvaluation,
      entryObservation,
      currentObservation: entryObservation,
      policy: VOLUME_CURRENT_ECONOMIC_EXIT_POLICY,
      previousSample: null,
      evaluatedAtMs,
    }, {
      enabled: false,
      killSwitchEngaged: true,
    });
    this.latestEconomicExitDecision = result.decision;
    // Fail closed even if a future rule implementation regresses its controls:
    // an OFF runtime never publishes or persists a modeled active sample.
    this.latestEconomicExitSample = null;
  }

  private strategySliceSnapshot(): Readonly<VolumeRuntimeStrategySliceSnapshot> {
    return Object.freeze({
      controls: this.strategySlice.controls,
      economics: this.strategyEconomics,
      latestEvaluation: this.latestStrategyEvaluation,
      lifecycle: Object.freeze({
        mode: 'VALIDATE_ONLY_RECORD' as const,
        checkpointScope: 'LATEST_ONLY' as const,
        persistence: this.strategyLedgerCoordinator?.snapshot() ?? Object.freeze({
          status: 'BLOCKED' as const,
          checkpoint: null,
          reasonCode: 'VOLUME_STRATEGY_LEDGER_UNAVAILABLE',
        }),
        restoreAttempts: this.strategyRestoreAttempts,
        commitAttempts: this.strategyCommitAttempts,
        durablePublications: this.strategyDurablePublications,
        directObservationMinIntervalMs: DIRECT_PUBLIC_OBSERVATION_MIN_INTERVAL_MS,
        nextDirectObservationAtMs: this.strategyNextDirectObservationAtMs,
      }),
    });
  }

  private economicExitSnapshot(): Readonly<VolumeRuntimeEconomicExitSnapshot> {
    return Object.freeze({
      controls: Object.freeze({
        enabled: false as const,
        killSwitch: 'ON' as const,
        mode: 'SHADOW_ONLY' as const,
        executionAuthority: 'NONE' as const,
        submitAuthority: 'NONE' as const,
        privateDataAuthority: 'NONE' as const,
        providerAuthority: 'NONE' as const,
      }),
      latestSample: this.latestEconomicExitSample,
      latestDecision: this.latestEconomicExitDecision,
      lifecycle: Object.freeze({
        mode: 'SHADOW_ONLY_RECORD' as const,
        checkpointScope: 'LATEST_ONLY' as const,
        persistence: this.economicExitLedgerCoordinator?.snapshot() ?? Object.freeze({
          status: 'BLOCKED' as const,
          checkpoint: null,
          reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_UNAVAILABLE',
        }),
        restoreAttempts: this.economicExitRestoreAttempts,
        commitAttempts: this.economicExitCommitAttempts,
        durablePublications: this.economicExitDurablePublications,
      }),
    });
  }

  /** Passive exact-cut read used only by the production Foundation risk composer. */
  readProposalRiskCut(proposalId: string): Readonly<VolumeProposalRiskCut> | null {
    return this.engine.readProposalRiskCut(proposalId);
  }

  /** Exact compare-and-record; Volume remains the sole proposal mutation owner. */
  recordFoundationRiskResult(input: Readonly<VolumeFoundationRiskAttachmentInput>): boolean {
    return this.engine.recordFoundationRiskResult(input);
  }

  setEvidenceObserver(observer: ((cut: VolumeRuntimeEvidenceCut) => void) | null): void {
    if (observer !== null && typeof observer !== 'function') {
      throw new TypeError('volume evidence observer must be a function or null');
    }
    if (observer !== null && this.evidenceObserver !== null && observer !== this.evidenceObserver) {
      throw new TypeError('volume evidence observer already bound');
    }
    this.evidenceObserver = observer;
  }

  operatorBlockedSymbols(): readonly string[] {
    return this.engine.operatorBlockedSymbols();
  }

  setOperatorSymbolBlocked(symbol: string, blocked: boolean): boolean {
    return this.engine.setOperatorSymbolBlocked(symbol, blocked);
  }

  symbolAllowedByPolicy(symbol: string): boolean {
    return this.engine.symbolAllowedByPolicy(symbol);
  }

  sizeCeiling(): string | null {
    try {
      return normalizeNonNegativeExactDecimal(String(this.engine.cfg.suggestedNotionalUsd));
    } catch {
      return null;
    }
  }

  setSizeCeiling(value: string): boolean {
    const canonical = normalizeNonNegativeExactDecimal(value);
    if (canonical !== value) throw new TypeError('volume size ceiling must be canonical');
    const numeric = Number(canonical);
    if (!Number.isFinite(numeric) || numeric <= 0 || String(numeric) !== canonical) {
      throw new RangeError('volume size ceiling cannot cross the legacy numeric boundary exactly');
    }
    const current = this.sizeCeiling();
    if (current === null || compareExactDecimals(canonical, normalizeNonNegativeExactDecimal(current)) > 0) {
      throw new RangeError('volume size ceiling is downward-only');
    }
    return this.engine.setSuggestedNotionalUsd(numeric);
  }

  strategyThreshold(): string | null {
    try { return normalizeNonNegativeExactDecimal(String(this.engine.cfg.vol1sMultiple)); } catch { return null; }
  }

  setStrategyThreshold(value: string): boolean {
    const canonical = normalizeNonNegativeExactDecimal(value);
    const numeric = Number(canonical);
    if (canonical !== value || !Number.isFinite(numeric) || numeric < 1 || numeric > 100 || String(numeric) !== canonical) {
      throw new RangeError('Volume 1s threshold is invalid or inexact at the legacy boundary');
    }
    return this.engine.setVolume1sMultiple(numeric);
  }

  setIntakePaused(paused: boolean): boolean {
    return this.engine.setIntakePaused(paused);
  }

  intakePaused(): boolean {
    return this.engine.intakePaused();
  }

  /**
   * Pure cached-owner injection only. The runtime exposes no private refresh
   * or signed transport through this seam.
   */
  applyObservedOrderFocus(snapshot: unknown): Readonly<ObservedOrderFocusApplyResult> {
    return this.observedOrderFocusCoordinator === null
      ? this.engine.observedOrderFocusReadback(
          'REJECTED_PERSISTENCE_UNAVAILABLE',
          false,
          ['OBSERVED_ORDER_FOCUS_PERSISTENCE_UNAVAILABLE'],
        )
      : this.observedOrderFocusCoordinator.apply(snapshot);
  }

  private async refreshUniverse(generation: number): Promise<void> {
    if (!this.isActive(generation)) return;
    const config = this.readConfig();
    const threshold = config && positive(config.minQuoteVolume24h)
      ? config.minQuoteVolume24h
      : this.engine.cfg.minQuoteVolume24hUsd;
    const sourceRows: MarketUniverseRow[] = [];
    const seen = new Set<string>();
    let examined = 0;
    for (const row of this.getUniverse()) {
      if (++examined > MAX_ENGINE_SYMBOLS * 2) break;
      if (sourceRows.length >= MAX_ENGINE_SYMBOLS) break;
      if (!row.hasSpot || !isCanonicalSymbol(row.symbol) || seen.has(row.symbol)) continue;
      if (typeof row.base !== 'string' || row.base.length === 0 || row.base.length > 24) continue;
      seen.add(row.symbol);
      sourceRows.push(row);
    }
    const metas = sourceRows.map((row) => {
      const quoteVolume = finite(row.quoteVolume24h) && row.quoteVolume24h >= 0 ? row.quoteVolume24h : null;
      const eligible = quoteVolume !== null && quoteVolume >= threshold;
      return {
        symbol: row.symbol,
        base: row.base,
        quote: 'USDT',
        hasSpot: true,
        hasPerp: row.hasPerp,
        marginBorrowable: null,
        minNotionalUsd: null,
        tickSize: null,
        stepSize: null,
        quoteVolume24hUsd: quoteVolume,
        eligible,
        ineligibleReason: eligible
          ? null
          : quoteVolume === null
            ? '24h quote volume unavailable'
            : 'below volume universe floor',
      };
    });
    if (!this.isActive(generation)) return;
    this.engine.setUniverse(metas);

    const nextSymbols = metas.filter((meta) => meta.eligible).map((meta) => meta.symbol).sort();
    const nextKey = nextSymbols.join(',');
    this.eligibleSymbols = nextSymbols;
    this.eligibleSymbolSet = new Set(nextSymbols);
    this.eligibleBaseBySymbol = new Map(
      metas.filter((meta) => meta.eligible).map((meta) => [meta.symbol, meta.base]),
    );
    for (const symbol of this.seeded) if (!this.eligibleSymbolSet.has(symbol)) this.seeded.delete(symbol);
    for (const symbol of this.symbolLastTradeTs.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.symbolLastTradeTs.delete(symbol);
    }
    for (const symbol of this.lastAggTradeId.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.lastAggTradeId.delete(symbol);
    }
    for (const symbol of this.lastRawTradeId.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.lastRawTradeId.delete(symbol);
    }
    for (const symbol of this.sourceContinuityLatch.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.sourceContinuityLatch.delete(symbol);
    }
    for (const symbol of this.strategyTradeCuts.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.strategyTradeCuts.delete(symbol);
    }
    for (const symbol of this.strategyBookCuts.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.strategyBookCuts.delete(symbol);
    }
    for (const symbol of this.strategyEvaluationKeyBySymbol.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.strategyEvaluationKeyBySymbol.delete(symbol);
    }
    for (const symbol of this.warmingSymbols.keys()) {
      if (!this.eligibleSymbolSet.has(symbol)) this.warmingSymbols.delete(symbol);
    }
    for (const symbol of this.baselineFailures) {
      if (!this.eligibleSymbolSet.has(symbol)) this.baselineFailures.delete(symbol);
    }
    this.baselineTotal = nextSymbols.length;
    this.baselineCompleted = nextSymbols.filter((symbol) => this.seeded.has(symbol)).length;
    this.baselineFailed = this.baselineFailures.size;
    const expectedStreamCount = Math.ceil(nextSymbols.length / STREAM_CHUNK);
    const streamOwnershipIncomplete = (
      this.streamStopQuarantine.size > 0
      || this.streams.length !== expectedStreamCount
      || new Set(this.streams).size !== expectedStreamCount
      || this.streamOwnershipKey !== nextKey
    );
    if (nextKey !== this.symbolSetKey || streamOwnershipIncomplete) {
      try {
        const restarted = this.restartTradeStreams(nextSymbols, generation);
        if (!restarted || !this.isActive(generation)) return;
        this.symbolSetKey = nextKey;
        this.clearStreamRetry();
      } catch (error) {
        this.scheduleStreamRetry(nextSymbols, nextKey, generation);
        throw error;
      }
    } else {
      this.clearStreamRetry();
    }
    this.launch(
      'baseline warmup',
      generation,
      () => this.warmBaselines(nextSymbols.filter((symbol) => !this.seeded.has(symbol)), generation),
    );
  }

  private restartTradeStreams(symbols: string[], generation: number): boolean {
    if (!this.isActive(generation)) return false;
    const requestedKey = symbols.join(',');
    // A physical producer replacement within one runtime generation cannot
    // prove that no aggregate trade was missed. Preserve GAP precedence and
    // latch every previously-cursored requested symbol RECONNECTING until the
    // next explicit generation; brand-new symbols retain UNKNOWN bootstrap.
    for (const symbol of symbols) {
      if (
        (this.lastAggTradeId.has(symbol) || this.lastRawTradeId.has(symbol))
        && this.sourceContinuityLatch.get(symbol) !== 'GAP'
      ) {
        this.sourceContinuityLatch.set(symbol, 'RECONNECTING');
      }
    }
    const previousStreams = [...this.streams];
    const turnEpoch = ++this.streamEpoch;
    const turn: VolumeStreamHandle[] = [];
    this.streams = turn;
    this.streamOwnershipKey = null;
    this.clearAllStreamRecoveries();
    this.streamStatus.clear();
    const captured = new Set<VolumeStreamHandle>([
      ...previousStreams,
      ...this.streamStopQuarantine,
    ]);
    const owns = (epoch: number, streams: VolumeStreamHandle[]): boolean => (
      this.isActive(generation)
      && this.streamEpoch === epoch
      && this.streams === streams
    );
    const cleanupCaptured = (
      expectedEpoch: number,
      expectedStreams: VolumeStreamHandle[],
    ): {
      retainedOwnership: boolean;
      failedStreams: VolumeStreamHandle[];
      cleanupError: unknown;
    } => {
      let retainedOwnership = owns(expectedEpoch, expectedStreams);
      const failedStreams: VolumeStreamHandle[] = [];
      let cleanupError: unknown = null;
      for (const stream of captured) {
        const ownedBeforeStop = owns(expectedEpoch, expectedStreams);
        retainedOwnership = retainedOwnership && ownedBeforeStop;
        if (this.streams.includes(stream)) continue;
        try {
          stream.stop();
          this.streamStopQuarantine.delete(stream);
        } catch (error) {
          this.streamStopQuarantine.add(stream);
          failedStreams.push(stream);
          if (failedStreams.length === 1) cleanupError = error;
        }
        const ownedAfterStop = owns(expectedEpoch, expectedStreams);
        retainedOwnership = retainedOwnership && ownedAfterStop;
      }
      return {
        retainedOwnership: retainedOwnership && owns(expectedEpoch, expectedStreams),
        failedStreams,
        cleanupError,
      };
    };

    const predecessorCleanup = cleanupCaptured(turnEpoch, turn);
    if (!predecessorCleanup.retainedOwnership) return false;
    if (predecessorCleanup.failedStreams.length > 0) {
      const rollbackEpoch = ++this.streamEpoch;
      const rollback = [...predecessorCleanup.failedStreams];
      this.streams = rollback;
      this.streamOwnershipKey = null;
      this.clearAllStreamRecoveries();
      this.streamStatus.clear();
      if (!owns(rollbackEpoch, rollback)) return false;
      throw predecessorCleanup.cleanupError;
    }
    try {
      for (const [index, group] of chunks(symbols, STREAM_CHUNK).entries()) {
        if (!group.length) continue;
        if (!owns(turnEpoch, turn)) {
          cleanupCaptured(turnEpoch, turn);
          return false;
        }
        const names = group.map((symbol) => symbol.toLowerCase() + '@aggTrade').join('/');
        const stream = this.streamFactory(
          'volume-aggtrade-' + String(index + 1),
          VOLUME_PUBLIC_WEBSOCKET_BASE_URL + '/stream?streams=' + names,
          (data) => this.onTradeMessage(data, generation, turnEpoch),
          (name, status) => this.onStreamStatus(name, status, generation, turnEpoch),
        );
        captured.add(stream);
        if (turn.includes(stream)) {
          throw new TypeError('volume stream factory returned a duplicate handle');
        }
        if (!owns(turnEpoch, turn)) {
          cleanupCaptured(turnEpoch, turn);
          return false;
        }
        turn.push(stream);
        if (!owns(turnEpoch, turn)) {
          cleanupCaptured(turnEpoch, turn);
          return false;
        }
        stream.start();
        if (!owns(turnEpoch, turn)) {
          cleanupCaptured(turnEpoch, turn);
          return false;
        }
      }
      if (!owns(turnEpoch, turn)) return false;
      this.streamOwnershipKey = requestedKey;
      return owns(turnEpoch, turn) && this.streamOwnershipKey === requestedKey;
    } catch (error) {
      if (!owns(turnEpoch, turn)) {
        cleanupCaptured(turnEpoch, turn);
        return false;
      }
      const rollbackEpoch = ++this.streamEpoch;
      const rollback: VolumeStreamHandle[] = [];
      this.streams = rollback;
      this.streamOwnershipKey = null;
      this.clearAllStreamRecoveries();
      this.streamStatus.clear();
      const rollbackCleanup = cleanupCaptured(rollbackEpoch, rollback);
      if (!rollbackCleanup.retainedOwnership) return false;
      for (const stream of rollbackCleanup.failedStreams) {
        if (!rollback.includes(stream)) rollback.push(stream);
      }
      if (!owns(rollbackEpoch, rollback)) return false;
      throw error;
    }
  }

  private scheduleStreamRetry(symbols: string[], key: string, generation: number): void {
    if (!this.isActive(generation)) return;
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.streamRetryTimer = null;
    const delay = this.streamRetryMs;
    this.streamRetryMs = Math.min(this.streamRetryMs * 2, 30_000);
    this.streamRetryTimer = setTimeout(() => {
      this.streamRetryTimer = null;
      if (!this.isActive(generation) || key !== this.eligibleSymbols.join(',')) return;
      try {
        const restarted = this.restartTradeStreams(symbols, generation);
        if (!restarted || !this.isActive(generation)) return;
        this.symbolSetKey = key;
        this.clearStreamRetry();
      } catch (error) {
        const failedEpoch = this.streamEpoch;
        const failedStreams = this.streams;
        const failedRetryTimer = this.streamRetryTimer;
        this.safeLog('error_event', null, {
          source: 'volume-runtime.stream-retry',
          message: error instanceof Error ? error.message : String(error),
        });
        if (
          this.isActive(generation)
          && this.streamEpoch === failedEpoch
          && this.streams === failedStreams
          && this.streamRetryTimer === failedRetryTimer
        ) {
          this.scheduleStreamRetry(symbols, key, generation);
        }
      }
    }, delay);
  }

  private clearStreamRetry(): void {
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.streamRetryTimer = null;
    this.streamRetryMs = 1_000;
  }

  private onTradeMessage(data: unknown, generation: number, streamEpoch: number): void {
    if (!this.isActive(generation) || streamEpoch !== this.streamEpoch) return;
    const raw = data && typeof data === 'object' && 'data' in data
      ? (data as { data: unknown }).data
      : data;
    if (!raw || typeof raw !== 'object' || (raw as { e?: string }).e !== 'aggTrade') return;
    const candidate = raw as Partial<RawAggTrade>;
    if (!isCanonicalSymbol(candidate.s) || !this.eligibleSymbolSet.has(candidate.s)) return;
    if (!Number.isSafeInteger(candidate.a) || (candidate.a as number) < 0) return;
    if (!Number.isSafeInteger(candidate.E) || (candidate.E as number) < 0) return;
    if (
      !Number.isSafeInteger(candidate.T)
      || (candidate.T as number) < 0
      || (candidate.E as number) < (candidate.T as number)
    ) return;
    const previousId = this.lastAggTradeId.get(candidate.s);
    if (previousId !== undefined && (candidate.a as number) <= previousId) return;
    let mapped: ReturnType<typeof mapAggTrade>;
    try {
      mapped = mapAggTrade(raw as RawAggTrade);
    } catch {
      return;
    }
    const previousRawTradeId = this.lastRawTradeId.get(mapped.tick.symbol);
    const latchedContinuity = this.sourceContinuityLatch.get(mapped.tick.symbol);
    let continuity: VolumeObservationContinuity;
    if (latchedContinuity !== undefined) {
      continuity = latchedContinuity;
    } else if (previousId === undefined || previousRawTradeId === undefined) {
      continuity = 'UNKNOWN';
    } else if (
      candidate.a === previousId + 1
      && candidate.f === previousRawTradeId + 1
    ) {
      continuity = 'CONTIGUOUS';
    } else {
      continuity = 'GAP';
      this.sourceContinuityLatch.set(mapped.tick.symbol, 'GAP');
    }
    this.lastAggTradeId.set(mapped.tick.symbol, candidate.a as number);
    this.lastRawTradeId.set(mapped.tick.symbol, candidate.l as number);
    // A GAP or RECONNECTING cut can update the diagnostic cursor but cannot
    // enter the proposal-bearing feature engine. With no public backfill in
    // this milestone, the latch remains fail-closed for this generation.
    if (continuity === 'CONTIGUOUS') {
      if (!this.engine.onTrade(mapped.tick, mapped.printCount)) return;
    }
    this.lastTradeTs = mapped.tick.ts;
    this.symbolLastTradeTs.set(mapped.tick.symbol, mapped.tick.ts);
    this.tradeMessages += 1;
    const baseAsset = this.eligibleBaseBySymbol.get(mapped.tick.symbol);
    if (baseAsset !== undefined) {
      const receivedAtMs = this.latchedNowMs();
      const revision = this.nextEvidenceRevision();
      const rawCut = Object.freeze({ ...(raw as RawAggTrade) });
      this.strategyTradeCuts.set(mapped.tick.symbol, Object.freeze({
        generation,
        revision,
        receivedAtMs,
        continuity,
        raw: rawCut,
      }));
      this.publishEvidence(Object.freeze({
        kind: 'SPOT_AGG_TRADE' as const,
        generation,
        revision,
        receivedAtMs,
        continuity: continuity === 'RECONNECTING' ? 'GAP' : continuity,
        baseAsset,
        raw: rawCut,
      }));
    }
  }

  private nextEvidenceRevision(): number {
    if (!Number.isSafeInteger(this.evidenceRevision) || this.evidenceRevision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('volume evidence revision exhausted');
    }
    this.evidenceRevision += 1;
    return this.evidenceRevision;
  }

  private publishEvidence(cut: VolumeRuntimeEvidenceCut): void {
    try {
      this.evidenceObserver?.(cut);
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.evidence-observer',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private onStreamStatus(name: string, status: FeedStatus, generation: number, streamEpoch: number): void {
    if (!this.isActive(generation) || streamEpoch !== this.streamEpoch) return;
    const stream = this.streams.find((candidate) => candidate.name === name);
    if (!stream) return;
    const previous = this.streamStatus.get(name);
    this.streamStatus.set(name, status);
    if (previous === status) {
      if (status === 'exhausted') this.scheduleStreamRecovery(name, generation, streamEpoch);
      return;
    }
    if (previous === 'open' && status !== 'open') {
      this.latchStreamReconnecting(name);
    }
    if (status === 'connecting') return;
    const event = status === 'open'
      ? 'ws.open'
      : status === 'cooldown'
        ? 'ws.cooldown'
        : status === 'exhausted'
          ? 'ws.exhausted'
          : 'ws.closed';
    this.safeLog(event, null, {
      feed: name,
      source: 'volume-runtime',
      status,
    });
    if (
      !this.isActive(generation)
      || streamEpoch !== this.streamEpoch
      || this.streams.find((candidate) => candidate.name === name) !== stream
    ) return;
    const currentStatus = this.streamStatus.get(name);
    if (currentStatus === 'open') this.clearStreamRecovery(name);
    if (currentStatus === 'exhausted') this.scheduleStreamRecovery(name, generation, streamEpoch);
  }

  private latchStreamReconnecting(name: string): void {
    const match = /^volume-aggtrade-(\d+)$/.exec(name);
    if (match === null) return;
    const index = Number(match[1]) - 1;
    if (!Number.isSafeInteger(index) || index < 0) return;
    const group = chunks(this.eligibleSymbols, STREAM_CHUNK)[index] ?? [];
    for (const symbol of group) {
      if (this.sourceContinuityLatch.get(symbol) !== 'GAP') {
        this.sourceContinuityLatch.set(symbol, 'RECONNECTING');
      }
    }
  }

  private scheduleStreamRecovery(name: string, generation: number, streamEpoch: number): void {
    const stream = this.streams.find((candidate) => candidate.name === name);
    if (
      !this.isActive(generation)
      || streamEpoch !== this.streamEpoch
      || !stream
      || this.streamStatus.get(name) !== 'exhausted'
      || this.streamRecoveryTimers.has(name)
    ) return;
    const attempt = (this.streamRecoveryAttempts.get(name) ?? 0) + 1;
    const exponent = Math.min(attempt - 1, 30);
    const base = Math.min(this.sourceRecoveryBaseMs * 2 ** exponent, SOURCE_RECOVERY_MAX_MS);
    let random = 0.5;
    try {
      const observed = this.recoveryRandom();
      if (Number.isFinite(observed)) random = Math.min(1, Math.max(0, observed));
    } catch {
      // Deterministic midpoint jitter is the fail-closed fallback.
    }
    const delay = Math.max(
      1,
      Math.round(base * (1 + ((random * 2) - 1) * SOURCE_RECOVERY_JITTER_RATIO)),
    );
    if (
      !this.isActive(generation)
      || streamEpoch !== this.streamEpoch
      || this.streams.find((candidate) => candidate.name === name) !== stream
      || this.streamStatus.get(name) !== 'exhausted'
      || this.streamRecoveryTimers.has(name)
    ) return;
    const timer = setTimeout(() => {
      if (this.streamRecoveryTimers.get(name) !== timer) return;
      this.streamRecoveryTimers.delete(name);
      if (!this.isActive(generation) || streamEpoch !== this.streamEpoch) return;
      if (this.streamStatus.get(name) !== 'exhausted') return;
      if (this.streams.find((candidate) => candidate.name === name) !== stream) return;
      this.safeLog('ws.rearm', null, {
        feed: name,
        source: 'volume-runtime',
        attempt,
        delayMs: delay,
      });
      if (
        !this.isActive(generation)
        || streamEpoch !== this.streamEpoch
        || this.streamStatus.get(name) !== 'exhausted'
        || this.streams.find((candidate) => candidate.name === name) !== stream
        || this.streamRecoveryTimers.has(name)
      ) return;
      const recoveryStatus = this.streamStatus.get(name);
      try {
        stream.stop();
        if (
          !this.isActive(generation)
          || streamEpoch !== this.streamEpoch
          || this.streams.find((candidate) => candidate.name === name) !== stream
          || this.streamRecoveryTimers.has(name)
          || (
            this.streamStatus.get(name) !== 'closed'
            && this.streamStatus.get(name) !== recoveryStatus
          )
        ) return;
        stream.start();
      } catch (error) {
        this.safeLog('error_event', null, {
          source: 'volume-runtime.stream-rearm',
          feed: name,
          message: error instanceof Error ? error.message : String(error),
        });
        if (
          this.isActive(generation)
          && streamEpoch === this.streamEpoch
          && this.streams.find((candidate) => candidate.name === name) === stream
          && this.streamStatus.get(name) !== 'open'
          && !this.streamRecoveryTimers.has(name)
        ) {
          this.onStreamStatus(name, 'exhausted', generation, streamEpoch);
        }
      }
      if (
        this.isActive(generation)
        && streamEpoch === this.streamEpoch
        && this.streamStatus.get(name) === 'exhausted'
        && this.streams.find((candidate) => candidate.name === name) === stream
      ) {
        this.scheduleStreamRecovery(name, generation, streamEpoch);
      }
    }, delay);
    this.streamRecoveryAttempts.set(name, attempt);
    this.streamRecoveryTimers.set(name, timer);
    timer.unref?.();
  }

  private clearStreamRecovery(name: string): void {
    const timer = this.streamRecoveryTimers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.streamRecoveryTimers.delete(name);
    this.streamRecoveryAttempts.delete(name);
  }

  private clearAllStreamRecoveries(): void {
    for (const timer of this.streamRecoveryTimers.values()) clearTimeout(timer);
    this.streamRecoveryTimers.clear();
    this.streamRecoveryAttempts.clear();
  }

  private async refreshBooks(generation: number): Promise<void> {
    if (!this.isActive(generation) || this.bookBusyGeneration === generation) return;
    this.bookBusyGeneration = generation;
    try {
      if (!this.eligibleSymbols.length) {
        await this.refreshUniverse(generation);
        if (!this.isActive(generation) || !this.eligibleSymbols.length) return;
      }
      const books = await fetchAllBookTickers('spot');
      if (!this.isActive(generation)) return;
      const receivedTs = this.latchedNowMs();
      let accepted = 0;
      for (const symbol of this.eligibleSymbols) {
        const book = books.get(symbol);
        if (!book) continue;
        if (this.engine.onBook({
          symbol,
          bid: book.bidPrice,
          ask: book.askPrice,
          bidQty: book.bidQty,
          askQty: book.askQty,
          ts: receivedTs,
        })) {
          const bidPrice = positivePlainDecimal(book.bidPrice);
          const askPrice = positivePlainDecimal(book.askPrice);
          const bidQuantity = positivePlainDecimal(book.bidQty);
          const askQuantity = positivePlainDecimal(book.askQty);
          if (
            bidPrice !== null
            && askPrice !== null
            && bidQuantity !== null
            && askQuantity !== null
          ) {
            this.strategyBookCuts.set(symbol, Object.freeze({
              symbol: book.symbol,
              bidPrice,
              askPrice,
              bidQuantity,
              askQuantity,
              receivedAtMs: receivedTs,
            }));
          }
          accepted += 1;
        }
      }
      if (accepted > 0) this.lastBookTs = receivedTs;
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.book',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.bookBusyGeneration === generation) this.bookBusyGeneration = null;
    }
  }

  private async warmBaselines(symbols: string[], generation: number): Promise<void> {
    if (!this.isActive(generation) || !symbols.length) return;
    const pending = [...new Set(symbols)].filter((symbol) => (
      this.eligibleSymbolSet.has(symbol) &&
      !this.seeded.has(symbol) &&
      this.warmingSymbols.get(symbol) !== generation
    ));
    if (!pending.length) return;
    for (const symbol of pending) this.warmingSymbols.set(symbol, generation);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= pending.length) return;
        const symbol = pending[index];
        try {
          const currentMinute = Math.floor(this.latchedNowMs() / 60_000) * 60_000;
          const candles = (await fetchKlineCandles(symbol, '1m', 61, 'spot'))
            .filter((candle) => candle.t < currentMinute)
            .slice(-60);
          if (!this.isActive(generation) || !this.eligibleSymbolSet.has(symbol)) continue;
          let accepted = 0;
          for (const candle of candles) {
            if (this.engine.seedMinute(symbol, {
              startMs: candle.t,
              quoteVolume: candle.qv,
              tradeCount: candle.trades,
              takerBuyQuote: candle.takerBuyQv,
              open: candle.o,
              close: candle.c,
              high: candle.h,
              low: candle.l,
            })) accepted += 1;
          }
          if (accepted >= this.engine.cfg.baselineMinSamples) {
            this.seeded.add(symbol);
            this.baselineFailures.delete(symbol);
          } else {
            this.baselineFailures.add(symbol);
          }
        } catch {
          if (this.isActive(generation)) this.baselineFailures.add(symbol);
        } finally {
          if (this.warmingSymbols.get(symbol) === generation) this.warmingSymbols.delete(symbol);
        }
        if (this.isActive(generation)) {
          this.baselineCompleted = this.eligibleSymbols.filter((item) => this.seeded.has(item)).length;
          this.baselineFailed = this.baselineFailures.size;
        }
      }
    });
    await Promise.all(workers);
  }

  private isActive(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private launch(label: string, generation: number, task: () => Promise<void>): void {
    if (!this.isActive(generation)) return;
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        if (!this.isActive(generation)) return;
        const failedEpoch = this.streamEpoch;
        const failedStreams = this.streams;
        const staleRetryTimer = this.streamRetryTimer;
        this.safeLog('error_event', null, {
          source: 'volume-runtime.background',
          task: label,
          message: error instanceof Error ? error.message : String(error),
        });
        if (
          this.isActive(generation)
          && this.streamEpoch === failedEpoch
          && this.streams === failedStreams
        ) return;
        if (
          staleRetryTimer !== null
          && this.streamRetryTimer === staleRetryTimer
        ) {
          this.clearStreamRetry();
        }
      });
  }

  private readConfig(): AppConfig | null {
    try {
      const config = this.getConfig();
      return config && typeof config === 'object' ? config : null;
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'volume-runtime.config',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Apply mutable operator controls on every engine tick, fail closed. */
  private applyDynamicConfig(): string {
    const config = this.readConfig();
    if (!config) {
      this.engine.setKillSwitch(true);
      this.engine.setSymbolPolicy([], []);
      return 'invalid';
    }

    const allowed = Array.isArray(config.allowedSymbols)
      ? [...new Set(config.allowedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol))]
        .slice(0, MAX_ENGINE_SYMBOLS)
      : [];
    const blocked = Array.isArray(config.blockedSymbols)
      ? [...new Set(config.blockedSymbols.slice(0, MAX_ENGINE_SYMBOLS * 2).filter(isCanonicalSymbol))]
        .slice(0, MAX_ENGINE_SYMBOLS)
      : [];
    this.engine.setKillSwitch(
      typeof config.killSwitch === 'boolean' && positive(config.maxOrderNotionalUsd)
        ? config.killSwitch
        : true,
    );
    this.engine.setSymbolPolicy(allowed, blocked);
    if (positive(config.maxOrderNotionalUsd)) this.engine.setSuggestedNotionalUsd(config.maxOrderNotionalUsd);

    const threshold = positive(config.minQuoteVolume24h)
      ? config.minQuoteVolume24h
      : this.engine.cfg.minQuoteVolume24hUsd;
    this.engine.setMinimumQuoteVolume24hUsd(threshold);
    return String(threshold);
  }

  private persistEvent(event: EngineEvent): void {
    let key: string;
    try {
      key = JSON.stringify(event);
    } catch {
      return;
    }
    if (this.persistedEventKeys.has(key)) return;
    const persisted = this.safeLog(event.kind, event.symbol, {
      strategy: event.strategy,
      correlationId: event.correlationId,
      rejectCode: event.rejectCode,
      message: event.message,
      ...event.payload,
    });
    if (!persisted) throw new Error('volume runtime ledger unavailable');
    this.persistedEventKeys.add(key);
    this.persistedEventOrder.push(key);
    if (this.persistedEventOrder.length > 5_000) {
      const removed = this.persistedEventOrder.shift();
      if (removed !== undefined) this.persistedEventKeys.delete(removed);
    }
  }

  private safeLog(kind: string, symbol: string | null, payload: Record<string, unknown>): boolean {
    try {
      this.ledger.logEvent(kind, symbol, payload);
      return true;
    } catch {
      this.ledgerFailureCount += 1;
      // Ledger failures must degrade observability, never terminate market-data
      // ingestion or leave an interval with an unhandled rejection.
      return false;
    }
  }

  snapshot(): Record<string, unknown> {
    const now = this.latchedNowMs();
    const decisions = this.engine.decisions(2_000);
    const latestDecision = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) latestDecision.set(decision.symbol, decision);
    const candidates = new Map(this.engine.focusMgr.candidateList().map((row) => [row.symbol, row]));
    const focus = new Map(this.engine.focusMgr.focusSessions().map((row) => [row.symbol, row]));
    const proposals = new Map(this.engine.proposalStore.all().map((row) => [row.symbol, row]));

    const rows = this.engine.universe().filter((meta) => meta.eligible).map((meta) => {
      const feature = this.engine.featureSnapshot(meta.symbol);
      if (!feature) return null;
      const decision = latestDecision.get(meta.symbol) ?? null;
      const state = this.engine.focusMgr.stateOf(meta.symbol);
      const candidate = candidates.get(meta.symbol);
      const focused = focus.get(meta.symbol);
      const proposal = proposals.get(meta.symbol);
      const price = feature.spotBid !== null && feature.spotAsk !== null
        ? (feature.spotBid + feature.spotAsk) / 2
        : null;
      const reason = decision
        ? decision.humanReason
        : feature.baseline.ready
          ? 'Volume within own baseline'
          : 'Baseline warming';
      return {
        symbol: meta.symbol,
        base: meta.base,
        state,
        price,
        lastTradeTs: this.symbolLastTradeTs.get(meta.symbol) ?? null,
        baseline: feature.baseline,
        windows: feature.windows,
        volumeMultiple: feature.volumeMultiple,
        tradeCountMultiple: feature.tradeCountMultiple,
        spreadBps: feature.book.spreadBps,
        topDepthUsd: feature.book.topDepthUsd,
        depthScore: feature.book.depthScore,
        depthVsNorm: feature.book.depthVsNorm,
        takerBuyRatio: feature.tape?.takerBuyRatio ?? feature.windows['15s']?.takerBuyRatio ?? null,
        washScore: feature.tape?.washScore ?? null,
        accelerationPctPerMin: feature.accelerationPctPerMin,
        focusReason: focused?.reason ?? candidate?.reason ?? null,
        focusAgeMs: focused ? now - focused.enteredTs : 0,
        decisionKind: decision?.kind ?? (feature.baseline.ready ? 'ignore' : 'warming'),
        rejectCode: decision?.rejectCode ?? null,
        reason,
        correlationId: decision?.correlationId ?? null,
        decisionTs: decision?.ts ?? null,
        proposal: proposal ? {
          id: proposal.id,
          status: proposal.status,
          direction: proposal.direction,
          confidence: proposal.confidence,
          reason: proposal.reason,
          proposalRevision: proposal.proposalRevision,
          proposalDigest: proposal.proposalDigest,
          configurationRevision: proposal.configurationRevision,
          featureObservedAtMs: proposal.featureObservedAtMs,
          expiresAtMs: proposal.expiresAtMs,
          baselineVolume: proposal.baselineVolume,
          currentVolume1m: proposal.currentVolume1m,
          tradeCountMultiple: proposal.tradeCountMultiple,
          riskResult: proposal.riskResult,
        } : null,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    const rank: Record<string, number> = {
      PROPOSED: 0,
      FOCUS: 1,
      WATCHING: 2,
      COOLDOWN: 3,
      ACTIVE: 4,
      REJECTED: 5,
      IDLE: 6,
    };
    rows.sort((left, right) => {
      const stateOrder = (rank[left.state] ?? 9) - (rank[right.state] ?? 9);
      if (stateOrder) return stateOrder;
      const leftMultiple = Math.max(left.volumeMultiple['1s'] ?? 0, left.volumeMultiple['5s'] ?? 0);
      const rightMultiple = Math.max(right.volumeMultiple['1s'] ?? 0, right.volumeMultiple['5s'] ?? 0);
      if (rightMultiple !== leftMultiple) return rightMultiple - leftMultiple;
      return (right.windows['60s']?.quoteVolume ?? 0) - (left.windows['60s']?.quoteVolume ?? 0);
    });

    const openConnections = [...this.streamStatus.values()].filter((status) => status === 'open').length;
    const streamState = this.streams.length === 0
      ? 'starting'
      : openConnections === this.streams.length
        ? 'open'
        : [...this.streamStatus.values()].some((status) => status === 'connecting')
          ? 'connecting'
          : 'degraded';
    return {
      updatedAt: now,
      status: {
        running: this.running && this.engine.isRunning(),
        streamState,
        streamConnections: this.streams.length,
        openConnections,
        bookState: this.lastBookTs !== null && now - this.lastBookTs < 10_000 ? 'fresh' : 'stale',
        universeSize: this.engine.universe().length,
        eligibleSize: this.eligibleSymbols.length,
        observedSymbols: [...this.symbolLastTradeTs.values()].filter((ts) => now - ts < 60_000).length,
        baselineReady: rows.filter((row) => row.baseline.ready).length,
        baselineTotal: this.baselineTotal,
        baselineCompleted: this.baselineCompleted,
        baselineFailed: this.baselineFailed,
        watching: candidates.size,
        focused: focus.size,
        openProposals: this.engine.proposalStore.openProposals().length,
        lastTradeTs: this.lastTradeTs,
        lastBookTs: this.lastBookTs,
        tradeMessages: this.tradeMessages,
        sinkFailures: this.engine.sinkFailures(),
        ledgerFailures: this.ledgerFailureCount,
        source: 'Binance Spot Aggregate Trade Streams',
        bookSource: 'Binance Spot All Book Tickers',
        baselineSource: 'Binance Spot 1m Klines',
      },
      thresholds: {
        volume1s: this.engine.cfg.vol1sMultiple,
        volume5s: this.engine.cfg.vol5sMultiple,
        tradeCount: this.engine.cfg.minTradeCountMultiple,
        followthroughPct: this.engine.cfg.minFollowthroughPct,
        maxSpreadBps: this.engine.cfg.maxSpreadBps,
        minDepthScore: this.engine.cfg.minDepthScore,
        baselineMinutes: this.engine.cfg.baselineMinSamples,
      },
      strategySlice: this.strategySliceSnapshot(),
      economicExit: this.economicExitSnapshot(),
      rows,
    };
  }
}
