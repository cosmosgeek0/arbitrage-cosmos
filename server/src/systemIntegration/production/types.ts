import type {
  Decision,
  EngineProposal,
} from '../../engine/v0/types.js';
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
}

export interface ProductionStrategySnapshot {
  /** Capture time is intentionally present only to prove it is never used. */
  readonly capturedAtMs?: number;
  readonly lastTickTs: number | null;
  readonly decisions: readonly Readonly<Decision>[];
  readonly proposals: readonly Readonly<EngineProposal>[];
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
  integrationSnapshot(): Readonly<ProductionStrategySnapshot>;
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

export interface ProductionSystemIntegrationInput {
  readonly clock: UtcClock;
  readonly market: ProductionMarketEnginePort;
  readonly basis: ProductionBasisRuntimePort;
  readonly volume: ProductionVolumeRuntimePort;
  /** Read-only existing L01/Q evidence; omitted binds accepted ABSTAIN_UNKNOWN. */
  readonly qAdvisory?: QAdvisoryObservationBinding | null;
  /** One freshness law for existing public market observations. */
  readonly sourceMaxAgeMs?: number;
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
}
