import type {
  Decision,
  EngineProposal,
} from '../../engine/v0/types.js';
import type {
  VolumeFoundationRiskAttachmentInput,
  VolumeProposal,
  VolumeProposalRiskCut,
} from '../../engine/volume/types.js';
import type {
  ApplicationComponentReadPorts,
  ApplicationSummaryReadPort,
} from '../application/types.js';
import type {
  CoreRuntimePorts,
  UtcClock,
} from '../composition/types.js';
import type { QAdvisoryObservationBinding } from '../adapters/qAdvisory.js';
import type { SystemSourceRegistrySnapshot } from '../contracts/types.js';
import type { VolumeEvidenceRoutingSnapshot } from '../../intelligenceRuntime/routing/index.js';
import type {
  VolumeEvidenceSymbolRoutingSnapshot,
} from '../../intelligenceRuntime/routing/index.js';
import type { BridgeSymbolReadModel } from '../../intelligenceRuntime/bridge/index.js';
import type {
  ProductionCanonicalEconomicsOwners,
  ProductionCapitalEligibilityPort,
} from './capitalEconomics.js';
import type {
  ProductionVolumeRiskEvidenceOwner,
  ProductionVolumeRiskPort,
} from './volumeRisk.js';

export type ProductionFeedStatus = 'connecting' | 'open' | 'closed' | 'cooldown' | 'exhausted';

export interface ProductionMarketRow {
  readonly symbol: string;
  readonly base?: string;
  readonly hasSpot: boolean;
  readonly hasPerp: boolean;
  readonly perpMark?: number | null;
  readonly perpIndexPrice?: number | null;
  readonly fundingRate?: number | null;
  readonly nextFundingTime?: number | null;
  readonly openInterest?: number | null;
  readonly openInterestUsd?: number | null;
  readonly openInterestChangePct?: number | null;
  readonly openInterestUpdatedAt?: number | null;
  readonly liquidations15mUsd?: number | null;
  readonly longLiquidations15mUsd?: number | null;
  readonly shortLiquidations15mUsd?: number | null;
}

/**
 * Structural, read-mostly seam over the already constructed audited market
 * engine. No socket constructor, REST client, credential, or cache mutation is
 * reachable through this boundary.
 */
export interface ProductionMarketEnginePort {
  readonly feeds: Readonly<Record<string, ProductionFeedStatus>>;
  readonly pairCount: number;
  init(): Promise<void>;
  start(): void;
  stop(): void;
  allRows(): readonly Readonly<ProductionMarketRow>[];
  priceUpdatedAt(symbol: string): number | null;
  markEventTimestamp(symbol: string): number | null;
  liquidationEventTimestamp?(symbol: string): number | null;
  /** Optional only for legacy/test doubles; MarketEngine supplies this observer. */
  setLiquidationEvidenceObserver?(observer: ProductionLiquidationEvidenceObserver | null): void;
}

export interface ProductionLiquidationEvidenceCut {
  readonly kind: 'FORCE_ORDER';
  readonly generation: number;
  readonly revision: number;
  readonly receivedAtMs: number;
  readonly bootstrap: 'CURRENT_SNAPSHOT' | 'NONE';
  readonly baseAsset: string;
  readonly raw: Readonly<{
    readonly e: 'forceOrder';
    readonly E: number;
    readonly st: 1;
    readonly ps: string;
    readonly o: Readonly<{
      readonly s: string;
      readonly S: 'BUY' | 'SELL';
      readonly o: string;
      readonly f: string;
      readonly q: string;
      readonly ap: string;
      readonly z: string;
      readonly X: 'FILLED';
      readonly T: number;
    }>;
  }>;
}

export interface ProductionLiquidationSourceClosedCut {
  readonly kind: 'SOURCE_CLOSED';
  readonly generation: number;
  readonly revision: number;
  readonly observedAtMs: number;
}

export type ProductionLiquidationEvidenceObserver = (
  cut: Readonly<ProductionLiquidationEvidenceCut | ProductionLiquidationSourceClosedCut>,
) => void;

export type ProductionTokenEvidenceState = 'FRESH' | 'STALE' | 'MISSING' | 'UNAVAILABLE';

export interface ProductionTokenEvidenceFact<TValue> {
  readonly state: ProductionTokenEvidenceState;
  readonly sourceId: string;
  readonly dataset: string;
  readonly observedAtMs: number | null;
  /** Only FRESH facts may carry a current value. */
  readonly value: Readonly<TValue> | null;
  readonly reasonCodes: readonly string[];
}

export interface ProductionTokenBridgeReadModel extends BridgeSymbolReadModel {
  readonly currentState: 'CURRENT' | 'HISTORICAL_ONLY';
}

export interface ProductionTokenIntelligenceReadModel {
  readonly schemaVersion: 'token-intelligence-owner-read.v1';
  readonly symbol: string;
  readonly observedAtMs: number;
  readonly projection: Readonly<{
    readonly state: 'ACTIVE' | 'DEGRADED' | 'NOT_RUNNING';
    readonly usdm: Readonly<{
      readonly connected: boolean;
      readonly feedState: ProductionFeedStatus | 'missing';
    }>;
    readonly liquidation: Readonly<{
      readonly connected: boolean;
      readonly feedState: ProductionFeedStatus | 'missing';
    }>;
  }>;
  readonly markFunding: Readonly<ProductionTokenEvidenceFact<{
    readonly markPrice: number | null;
    readonly indexPrice: number | null;
    readonly fundingRate: number | null;
    readonly nextFundingTimeMs: number | null;
  }>>;
  readonly openInterest: Readonly<ProductionTokenEvidenceFact<{
    readonly base: number | null;
    readonly quoteUsd: number | null;
    readonly changePct: number | null;
  }>>;
  readonly liquidation: Readonly<ProductionTokenEvidenceFact<{
    readonly total15mUsd: number | null;
    readonly long15mUsd: number | null;
    readonly short15mUsd: number | null;
    readonly sampling: 'LATEST_PER_SYMBOL_LOWER_BOUND';
  }>>;
  readonly routing: Readonly<VolumeEvidenceSymbolRoutingSnapshot>;
  readonly bridge: Readonly<ProductionTokenBridgeReadModel>;
  readonly authority: 'EVIDENCE_ONLY';
  readonly liveMoneyAuthority: 'NONE';
}

export interface ProductionStrategySnapshot {
  /** Capture time is intentionally present only to prove it is never used. */
  readonly capturedAtMs?: number;
  readonly lastTickTs: number | null;
  readonly decisions: readonly Readonly<Decision>[];
  readonly proposals: readonly Readonly<EngineProposal>[];
  /** Exact strategy-owner counts; integration must not recount raw records. */
  readonly ownerSummary: Readonly<{
    readonly candidateCount: number;
    readonly opportunityCount: number;
    readonly cooldownCount: number;
  }>;
}

export interface ProductionVolumeStrategySnapshot {
  /** Capture time is intentionally present only to prove it is never used. */
  readonly capturedAtMs?: number;
  readonly lastTickTs: number | null;
  readonly decisions: readonly Readonly<Decision>[];
  readonly proposals: readonly Readonly<VolumeProposal>[];
  readonly ownerSummary: Readonly<{
    readonly candidateCount: number;
    readonly opportunityCount: number;
    readonly cooldownCount: number;
  }>;
}

export interface ProductionBasisConnectionStatus {
  readonly running: boolean;
  readonly lastBookTs: number | null;
  readonly lastMarkTs: number | null;
  readonly lastError: string | null;
}

export interface ProductionBasisRuntimePort {
  start(): Promise<void>;
  stop(): void;
  connectionStatus(): Readonly<ProductionBasisConnectionStatus>;
  integrationSnapshot(): Readonly<ProductionStrategySnapshot>;
  setIntakePaused(paused: boolean): boolean;
  intakePaused(): boolean;
  operatorBlockedSymbols(): readonly string[];
  setOperatorSymbolBlocked(symbol: string, blocked: boolean): boolean;
  symbolAllowedByPolicy(symbol: string): boolean;
  sizeCeiling(): string | null;
  setSizeCeiling(value: string): boolean;
  strategyThreshold(): string | null;
  setStrategyThreshold(value: string): boolean;
}

export interface ProductionVolumeConnectionStatus {
  readonly running: boolean;
  readonly streamState: 'starting' | 'open' | 'connecting' | 'degraded';
  readonly streamConnections: number;
  readonly openConnections: number;
  readonly lastBookTs: number | null;
  readonly lastTradeTs: number | null;
}

export interface ProductionVolumeTradeEvidenceCut {
  readonly kind: 'SPOT_AGG_TRADE';
  readonly generation: number;
  readonly revision: number;
  readonly receivedAtMs: number;
  readonly continuity: 'CONTIGUOUS' | 'GAP' | 'UNKNOWN';
  readonly baseAsset: string;
  readonly raw: Readonly<{
    e: 'aggTrade';
    E: number;
    s: string;
    a: number;
    p: string;
    q: string;
    f: number;
    l: number;
    T: number;
    m: boolean;
  }>;
}

export interface ProductionVolumeSourceClosedCut {
  readonly kind: 'SOURCE_CLOSED';
  readonly generation: number;
  readonly revision: number;
  readonly observedAtMs: number;
}

export type ProductionVolumeEvidenceCut = ProductionVolumeTradeEvidenceCut | ProductionVolumeSourceClosedCut;
export type ProductionVolumeEvidenceObserver = (cut: Readonly<ProductionVolumeEvidenceCut>) => void;

export interface ProductionVolumeRuntimePort {
  start(): Promise<void>;
  stop(): void;
  connectionStatus(): Readonly<ProductionVolumeConnectionStatus>;
  integrationSnapshot(): Readonly<ProductionVolumeStrategySnapshot>;
  readProposalRiskCut(proposalId: string): Readonly<VolumeProposalRiskCut> | null;
  recordFoundationRiskResult(input: Readonly<VolumeFoundationRiskAttachmentInput>): boolean;
  /** Optional only for legacy/test doubles; production VolumeRuntime supplies the sole physical feed. */
  setEvidenceObserver?(observer: ProductionVolumeEvidenceObserver | null): void;
  setIntakePaused(paused: boolean): boolean;
  intakePaused(): boolean;
  operatorBlockedSymbols(): readonly string[];
  setOperatorSymbolBlocked(symbol: string, blocked: boolean): boolean;
  symbolAllowedByPolicy(symbol: string): boolean;
  sizeCeiling(): string | null;
  setSizeCeiling(value: string): boolean;
  strategyThreshold(): string | null;
  setStrategyThreshold(value: string): boolean;
}

export interface ProductionCapitalRestartSummaryCut {
  readonly availability: 'AVAILABLE';
  /** The minimum exact checkpoint identity needed by the supervisor summary. */
  readonly checkpoint: Readonly<{
    readonly id: string;
    readonly revision: number;
  }>;
  /** Already-projected Capital owner truth; this adapter never replays state. */
  readonly safety: Readonly<{
    readonly canOpenOrIncrease: boolean;
    readonly supervisionContinues: boolean;
    readonly visiblePositionIds: readonly string[];
    readonly recoveryRequiredPositionIds: readonly string[];
    readonly effectiveActiveReservationIds: readonly string[];
    readonly reasonCodes: readonly string[];
  }>;
}

export interface ProductionCapitalUnavailableSummaryCut {
  readonly availability: 'UNAVAILABLE';
  readonly accountTruthState: 'OWNER_GATED' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
}

export type ProductionCapitalSummaryCut =
  | ProductionCapitalRestartSummaryCut
  | ProductionCapitalUnavailableSummaryCut;

/**
 * Lazy, passive readback from canonical L12/Capital owner evidence. The port
 * exposes no checkpoint mutation, capital-policy method, or private source.
 */
export interface ProductionCapitalSummaryReadPort {
  readCapitalSummary(): Readonly<ProductionCapitalSummaryCut> | null;
}

export interface ProductionSystemIntegrationInput {
  readonly clock: UtcClock;
  readonly market: ProductionMarketEnginePort;
  readonly basis: ProductionBasisRuntimePort;
  readonly volume: ProductionVolumeRuntimePort;
  /** Omitted while canonical L12/Capital owner evidence is not mounted. */
  readonly capitalSummary?: ProductionCapitalSummaryReadPort | null;
  /** Read-only existing L01/Q evidence; omitted binds accepted ABSTAIN_UNKNOWN. */
  readonly qAdvisory?: QAdvisoryObservationBinding | null;
  /** Exact cached owners; absent in today's server assembly and therefore fail-closed. */
  readonly capitalEconomicsOwners?: ProductionCanonicalEconomicsOwners | null;
  /** Exact cached evidence owner; absent in today's real server assembly. */
  readonly volumeRiskEvidenceOwner?: ProductionVolumeRiskEvidenceOwner | null;
  /** One freshness law for existing public market observations. */
  readonly sourceMaxAgeMs?: number;
  /**
   * Optional stricter per-record bound for the existing canonical evidence
   * Bridge. It can only reduce the production default and makes resource
   * pressure explicit and fail-closed.
   */
  readonly intelligenceEvidenceMaximumBytes?: number;
}

export interface ProductionSystemIntegrationPorts {
  readonly sourceRegistry: Readonly<SystemSourceRegistrySnapshot>;
  readonly runtimes: CoreRuntimePorts;
  /** Only existing public Spot/USD-M projections are wired by this factory. */
  readonly components: ApplicationComponentReadPorts;
  /** Exact owner counts only; this adapter never computes strategy scores. */
  readonly summaries: ApplicationSummaryReadPort;
  /** Read-only truth from the one production router; no strategy or transport authority. */
  readonly intelligenceEvidence: Readonly<{
    readRoutingSnapshot(): Readonly<VolumeEvidenceRoutingSnapshot>;
    readSymbol(symbol: string): Readonly<ProductionTokenIntelligenceReadModel>;
  }>;
  readonly strategyIntake: Readonly<{
    basis: Readonly<{
      readPaused(): boolean;
      setPaused(paused: boolean): boolean;
    }>;
    volume: Readonly<{
      readPaused(): boolean;
      setPaused(paused: boolean): boolean;
    }>;
  }>;
  readonly strategySymbolPolicy: Readonly<{
    basis: Readonly<{
      readBlockedSymbols(): readonly string[];
      setBlocked(symbol: string, blocked: boolean): boolean;
      isAllowed(symbol: string): boolean;
    }>;
    volume: Readonly<{
      readBlockedSymbols(): readonly string[];
      setBlocked(symbol: string, blocked: boolean): boolean;
      isAllowed(symbol: string): boolean;
    }>;
  }>;
  readonly sizeCeilings: Readonly<{
    BASIS: Readonly<{ readCeiling(): string | null; setCeiling(value: string): boolean }>;
    VOLUME: Readonly<{ readCeiling(): string | null; setCeiling(value: string): boolean }>;
  }>;
  readonly strategyThresholds: Readonly<{
    BASIS: Readonly<{ readThreshold(): string | null; setThreshold(value: string): boolean }>;
    VOLUME: Readonly<{ readThreshold(): string | null; setThreshold(value: string): boolean }>;
  }>;
  readonly attentionFocus: Readonly<{
    readPinnedSymbols(): readonly string[];
    readFocusState(symbol: string): Readonly<{
      symbol: string;
      pinned: boolean;
      eligible: boolean | null;
      canPin: boolean;
      effectivePinned: boolean | null;
      effectiveTier: 'UNIVERSE' | 'WATCH' | 'CANDIDATE' | 'FOCUS' | 'DEEP_FOCUS' | 'RELEASED' | null;
      attentionPlanId: string | null;
      attentionPlanAtMs: number | null;
      pinCount: number;
      pinCapacity: number;
    }>;
    setPinned(symbol: string, pinned: boolean): boolean;
    restorePinnedSymbols(symbols: readonly string[]): boolean;
  }>;
  /** Mounted Capital callsite; current real assembly reports NOT_CONFIGURED. */
  readonly capitalEligibility: Readonly<ProductionCapitalEligibilityPort>;
  /** Foundation-owned Volume risk callsite; current real assembly is NOT_CONFIGURED. */
  readonly volumeRisk: Readonly<ProductionVolumeRiskPort>;
}
