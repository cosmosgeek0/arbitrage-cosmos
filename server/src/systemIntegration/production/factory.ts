import {
  evaluateFreshness,
  isValidUtcMillis,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import type {
  ComponentStepContext,
} from '../../foundation/control/index.js';
import type {
  SystemComponentSnapshot,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';
import type {
  RuntimeHealthEvidence,
} from '../composition/types.js';
import type {
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
import type {
  ProductionBasisConnectionStatus,
  ProductionBasisRuntimePort,
  ProductionMarketEnginePort,
  ProductionMarketRow,
  ProductionStrategySnapshot,
  ProductionSystemIntegrationInput,
  ProductionSystemIntegrationPorts,
  ProductionVolumeConnectionStatus,
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
  readonly feedState: 'connecting' | 'open' | 'closed' | 'missing';
  readonly timestamp: Readonly<SourcedTimestamp> | null;
  readonly facts: Readonly<MarketFacts>;
}

function validateFactoryInput(input: Readonly<ProductionSystemIntegrationInput>): void {
  if (!input || typeof input !== 'object') throw new TypeError('production integration input is required');
  if (typeof input.clock?.nowMs !== 'function') throw new TypeError('clock.nowMs is required');
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
    let rows: readonly Readonly<ProductionMarketRow>[];
    try {
      rows = this.market.allRows();
    } catch {
      return Object.freeze({
        valid: false,
        universeSymbols: null,
        spotObservedSymbols: null,
        usdmObservedSymbols: null,
        latestSpotSourceTimeMs: null,
        latestUsdmSourceTimeMs: null,
      });
    }
    if (!Array.isArray(rows) || rows.length > MAX_MARKET_ROWS) {
      return Object.freeze({
        valid: false,
        universeSymbols: null,
        spotObservedSymbols: null,
        usdmObservedSymbols: null,
        latestSpotSourceTimeMs: null,
        latestUsdmSourceTimeMs: null,
      });
    }
    const symbols = new Set<string>();
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
          if (sourceTime !== null) {
            spotObservedSymbols += 1;
            latestSpotSourceTimeMs = latest(latestSpotSourceTimeMs, sourceTime);
          }
        }
        if (row.hasPerp) {
          const sourceTime = validUtcOrNull(this.market.markEventTimestamp(row.symbol));
          if (sourceTime !== null) {
            usdmObservedSymbols += 1;
            latestUsdmSourceTimeMs = latest(latestUsdmSourceTimeMs, sourceTime);
          }
        }
      }
    } catch {
      return Object.freeze({
        valid: false,
        universeSymbols: null,
        spotObservedSymbols: null,
        usdmObservedSymbols: null,
        latestSpotSourceTimeMs: null,
        latestUsdmSourceTimeMs: null,
      });
    }
    return Object.freeze({
      valid: true,
      universeSymbols: symbols.size,
      spotObservedSymbols,
      usdmObservedSymbols,
      latestSpotSourceTimeMs,
      latestUsdmSourceTimeMs,
    });
  }

  readSource(kind: PublicSourceKind): Readonly<SourceProjectionEvidence> {
    const nowMs = this.clock.nowMs();
    const facts = this.readFacts();
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
    const feedState = feed === 'open' || feed === 'connecting' || feed === 'closed' ? feed : 'missing';
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
    const evidence = this.readSource(kind);
    const freshness = evidence.timestamp ? evaluateFreshness(evidence.timestamp, nowMs) : null;
    const ready = evidence.connected && freshness?.state === 'FRESH';
    const stopped = !lifecycle.active;
    const blockerCodes: string[] = [];
    if (stopped) blockerCodes.push('SOURCE_NOT_STARTED');
    else if (evidence.feedState === 'connecting') blockerCodes.push('SOURCE_TRANSPORT_CONNECTING');
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
          : freshness?.state === 'STALE'
            ? 'DEGRADED'
            : 'BLOCKED';
    const readiness = stopped
      ? 'STOPPED'
      : ready
        ? 'READY'
        : evidence.feedState === 'connecting' || (evidence.feedState === 'open' && evidence.timestamp === null)
          ? 'WARMING'
          : freshness?.state === 'STALE'
            ? 'DEGRADED'
            : 'BLOCKED';
    const sourceLifecycle = stopped
      ? 'STOPPED'
      : ready
        ? 'LIVE'
        : evidence.feedState === 'connecting'
          ? 'CONNECTING'
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
      this.evidence.stop();
      throw error;
    }
    this.active = true;
    this.generation += 1;
    this.startCount += 1;
  }

  stop(): void {
    try {
      this.market.stop();
    } finally {
      this.active = false;
      this.evidence.stop();
    }
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
  return Object.freeze({
    truthLabel: live ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
    heartbeatAtMs: validUtcOrNull(snapshot.lastTickTs),
    candidateCount: snapshot.decisions.filter((decision) => decision.kind === 'watch' || decision.kind === 'focus').length,
    proposalCount: snapshot.proposals.length,
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
  const maxAgeMs = publicSourceMaxAgeMs(input.sourceMaxAgeMs);

  let marketLifecycle: MarketLifecyclePort;
  const evidence = new MarketEvidenceReader(
    input.clock,
    input.market,
    maxAgeMs,
    () => marketLifecycle.readState(),
  );
  marketLifecycle = new MarketLifecyclePort(input.market, evidence);
  const basisLifecycle = new BasisLifecyclePort(input.basis, maxAgeMs);
  const volumeLifecycle = new VolumeLifecyclePort(input.volume, maxAgeMs);

  const runtimes = Object.freeze({
    market: Object.freeze({
      init: () => marketLifecycle.init(),
      start: () => marketLifecycle.start(),
      stop: () => marketLifecycle.stop(),
      health: (ctx: ComponentStepContext) => marketLifecycle.health(ctx),
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
      const result: Partial<Pick<SystemSupervisorSummaries, 'sourceCoverage' | 'strategies'>> = {
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
      };
      return Object.freeze(result);
    },
  });

  return Object.freeze({ runtimes, components, summaries });
}
