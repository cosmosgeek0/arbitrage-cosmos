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
import type {
  ProductionCanonicalEconomicsOwners,
  ProductionCapitalEligibilityPort,
} from './capitalEconomics.js';
import type {
  ProductionVolumeRiskEvidenceOwner,
  ProductionVolumeRiskPort,
} from './volumeRisk.js';
import type {
  ProductionObservedOrderFocusEvidenceOwner,
  ProductionObservedOrderFocusPort,
} from './observedOrderFocus.js';
import type {
  ObservedOrderFocusApplyResult,
  ObservedOrderFocusSnapshot,
} from '../../engine/volume/observedOrderFocus.js';

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

export interface ProductionVolumeStrategySnapshot {
  /** Capture time is intentionally present only to prove it is never used. */
  readonly capturedAtMs?: number;
  readonly lastTickTs: number | null;
  readonly decisions: readonly Readonly<Decision>[];
  readonly proposals: readonly Readonly<VolumeProposal>[];
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
  integrationSnapshot(): Readonly<ProductionVolumeStrategySnapshot>;
  readProposalRiskCut(proposalId: string): Readonly<VolumeProposalRiskCut> | null;
  recordFoundationRiskResult(input: Readonly<VolumeFoundationRiskAttachmentInput>): boolean;
  applyObservedOrderFocus(
    snapshot: Readonly<ObservedOrderFocusSnapshot>,
  ): Readonly<ObservedOrderFocusApplyResult>;
  setIntakePaused(paused: boolean): boolean;
  intakePaused(): boolean;
}

export interface ProductionSystemIntegrationInput {
  readonly clock: UtcClock;
  readonly market: ProductionMarketEnginePort;
  readonly basis: ProductionBasisRuntimePort;
  readonly volume: ProductionVolumeRuntimePort;
  /** Read-only existing L01/Q evidence; omitted binds accepted ABSTAIN_UNKNOWN. */
  readonly qAdvisory?: QAdvisoryObservationBinding | null;
  /** Exact cached owners; absent in today's server assembly and therefore fail-closed. */
  readonly capitalEconomicsOwners?: ProductionCanonicalEconomicsOwners | null;
  /** Exact cached evidence owner; absent in today's real server assembly. */
  readonly volumeRiskEvidenceOwner?: ProductionVolumeRiskEvidenceOwner | null;
  /** Cached normalized Foundation owner; absent in today's real server assembly. */
  readonly observedOrderFocusEvidenceOwner?: ProductionObservedOrderFocusEvidenceOwner | null;
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
  /** Mounted Capital callsite; current real assembly reports NOT_CONFIGURED. */
  readonly capitalEligibility: Readonly<ProductionCapitalEligibilityPort>;
  /** Foundation-owned Volume risk callsite; current real assembly is NOT_CONFIGURED. */
  readonly volumeRisk: Readonly<ProductionVolumeRiskPort>;
  /** Foundation-observed open-order focus callsite; real assembly is NOT_CONFIGURED. */
  readonly observedOrderFocus: Readonly<ProductionObservedOrderFocusPort>;
}
