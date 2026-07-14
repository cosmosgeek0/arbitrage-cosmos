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

export type ProductionFeedStatus = 'connecting' | 'open' | 'closed';

export interface ProductionMarketRow {
  readonly symbol: string;
  readonly base?: string;
  readonly hasSpot: boolean;
  readonly hasPerp: boolean;
  readonly perpMark?: number | null;
  readonly perpIndexPrice?: number | null;
  readonly fundingRate?: number | null;
  readonly nextFundingTime?: number | null;
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

/**
 * Narrow lifecycle seam for an already-owned public market auxiliary. The
 * integration root may start and stop it with the market graph, but cannot
 * construct its socket, read its cache, or claim authority over its records.
 */
export interface ProductionMarketAuxiliaryLifecyclePort {
  start(): void;
  stop(): void;
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
}

export interface ProductionVolumeConnectionStatus {
  readonly running: boolean;
  readonly streamState: 'starting' | 'open' | 'connecting' | 'degraded';
  readonly streamConnections: number;
  readonly openConnections: number;
  readonly lastBookTs: number | null;
  readonly lastTradeTs: number | null;
}

export interface ProductionVolumeRuntimePort {
  start(): Promise<void>;
  stop(): void;
  connectionStatus(): Readonly<ProductionVolumeConnectionStatus>;
  integrationSnapshot(): Readonly<ProductionStrategySnapshot>;
}

export interface ProductionSystemIntegrationInput {
  readonly clock: UtcClock;
  readonly market: ProductionMarketEnginePort;
  readonly marketAuxiliary?: ProductionMarketAuxiliaryLifecyclePort;
  readonly basis: ProductionBasisRuntimePort;
  readonly volume: ProductionVolumeRuntimePort;
  /** Read-only existing L01/Q evidence; omitted binds accepted ABSTAIN_UNKNOWN. */
  readonly qAdvisory?: QAdvisoryObservationBinding | null;
  /** One freshness law for existing public market observations. */
  readonly sourceMaxAgeMs?: number;
}

export interface ProductionSystemIntegrationPorts {
  readonly runtimes: CoreRuntimePorts;
  /** Only existing public Spot/USD-M projections are wired by this factory. */
  readonly components: ApplicationComponentReadPorts;
  /** Exact owner counts only; this adapter never computes strategy scores. */
  readonly summaries: ApplicationSummaryReadPort;
}
