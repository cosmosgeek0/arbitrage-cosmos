import type {
  JsonValue,
  StableFailure,
  TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  FocusEligibility,
  MarketAvailability,
  UniverseGraph,
  UniverseGraphDiff,
  UniversePolicy,
  UniverseSourceState,
} from '../../intelligenceFoundation/universe/index.js';
import type {
  PublicRestTransport,
  RuntimeClock,
} from '../contracts/index.js';

export type RuntimeUniverseSource = 'SPOT' | 'USD_M_PERPETUAL';

export interface RuntimeUniverseConfig {
  /** Stable fingerprint of every effective adapter and universe-policy setting. */
  readonly configurationVersion: string;
  requestTimeoutMs: number;
  maximumResponseBytes: number;
  maximumSymbolsPerSource: number;
  maximumFiltersPerSymbol: number;
  maximumFilterBytes: number;
  maximumAliasesPerListing: number;
  sourceStaleAfterMs: number;
  maximumFutureSkewMs: number;
  universePolicy: UniversePolicy;
}

export interface RuntimeUniverseAdapterOptions {
  transport: PublicRestTransport;
  clock: RuntimeClock;
  config?: Partial<Omit<RuntimeUniverseConfig, 'configurationVersion' | 'universePolicy'>> & {
    universePolicy?: Partial<UniversePolicy>;
  };
}

export interface RuntimeExchangeFilterMetadata {
  readonly filterType: string;
  readonly values: Readonly<Record<string, JsonValue>>;
}

/**
 * Exact exchange-info metadata that the narrower intelligenceFoundation
 * ListingObservation cannot represent. Values remain evidence, not defaults.
 */
export interface RuntimeListingMetadata {
  readonly id: string;
  readonly fingerprint: string;
  readonly source: RuntimeUniverseSource;
  readonly symbol: string;
  readonly pair: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: string;
  readonly tradingAllowed: boolean | null;
  readonly contractType: string | null;
  readonly onboardDateMs: number | null;
  readonly deliveryDateMs: number | null;
  readonly marginAsset: string | null;
  readonly underlyingType: string | null;
  readonly underlyingSubType: readonly string[];
  readonly orderTypes: readonly string[];
  readonly timeInForce: readonly string[];
  readonly permissionSets: readonly (readonly string[])[];
  readonly precisions: Readonly<Record<string, number>>;
  readonly filters: readonly RuntimeExchangeFilterMetadata[];
  readonly includedInUniverse: boolean;
  readonly exclusionReasonCodes: readonly string[];
  readonly receivedTimeMs: number;
  readonly truth: TruthMetadata;
}

export interface RuntimeListingChange {
  readonly id: string;
  readonly source: RuntimeUniverseSource;
  readonly symbol: string;
  readonly kind: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
  readonly beforeFingerprint: string | null;
  readonly afterFingerprint: string | null;
  readonly reasonCodes: readonly string[];
}

export interface RuntimeUniverseSourceSnapshot {
  readonly source: RuntimeUniverseSource;
  readonly state: UniverseSourceState;
  readonly attemptedAtMs: number;
  readonly lastResponseTimeMs: number | null;
  readonly lastCompleteResponseTimeMs: number | null;
  readonly retainedListingCount: number;
  readonly stale: boolean;
  readonly failures: readonly StableFailure[];
  readonly truth: TruthMetadata;
}

export interface RuntimeUniverseTradeability {
  /** Exchange information alone can block an inactive leg but cannot prove live tradeability. */
  readonly state: 'BLOCKED' | 'UNKNOWN';
  readonly spot: MarketAvailability | 'MISSING';
  readonly usdMPerpetual: MarketAvailability | 'MISSING';
  readonly reasonCodes: readonly string[];
}

export interface RuntimeUniverseNodeView {
  readonly nodeId: string;
  readonly canonicalMarket: string;
  readonly aliases: readonly string[];
  readonly visibility: { readonly state: 'VISIBLE'; readonly reasonCodes: readonly string[] };
  readonly coverage: {
    readonly publicData: UniverseGraph['nodes'][number]['publicData'];
    readonly focusedData: UniverseGraph['nodes'][number]['focusedData'];
  };
  readonly focusEligibility: FocusEligibility;
  readonly tradeability: RuntimeUniverseTradeability;
}

export interface RuntimeUniverseSnapshot {
  readonly id: string;
  readonly observedAtMs: number;
  readonly graph: UniverseGraph;
  readonly diff: UniverseGraphDiff;
  readonly sources: Readonly<Record<RuntimeUniverseSource, RuntimeUniverseSourceSnapshot>>;
  readonly metadata: readonly RuntimeListingMetadata[];
  readonly listingChanges: readonly RuntimeListingChange[];
  readonly nodes: readonly RuntimeUniverseNodeView[];
  readonly failures: readonly StableFailure[];
}
