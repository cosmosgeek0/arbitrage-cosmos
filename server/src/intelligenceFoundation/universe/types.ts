import type {
  EvidenceKind,
  InstrumentIdentity,
  NormalizedBorrow,
  StableFailure,
  TruthMetadata,
} from '../contracts/index.js';

export const UNIVERSE_SOURCE_KINDS = [
  'SPOT',
  'USD_M_PERPETUAL',
  'MARGIN',
  'BORROW',
  'COVERAGE',
] as const;

export type UniverseSourceKind = (typeof UNIVERSE_SOURCE_KINDS)[number];
export type UniverseSourceState = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface UniverseSourceSlice<T> {
  source: UniverseSourceKind;
  state: UniverseSourceState;
  records: readonly T[];
  truth: TruthMetadata;
}

/** Exchange rule evidence. Explicit null means the source did not supply truth. */
export interface TradingRuleEvidence {
  minimumPrice: number | null;
  maximumPrice: number | null;
  tickSize: number | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  quantityStep: number | null;
  minimumNotional: number | null;
  maximumNotional: number | null;
}

/** Independent 24-hour ticker evidence. Exchange-info truth must never be reused as volume authority. */
export interface QuoteVolumeObservation {
  id: string;
  quoteAsset: string;
  quoteVolume24h: number;
  usdConversionRate: number | null;
  quoteVolume24hUsd: number | null;
  truth: TruthMetadata;
  /** Required whenever a USD conversion rate is supplied, including stable-asset conversion. */
  conversionTruth: TruthMetadata | null;
}

export interface ListingObservation {
  id: string;
  kind: 'SPOT_LISTING' | 'USD_M_PERPETUAL_LISTING';
  instrument: InstrumentIdentity;
  /** Raw exchange status is retained, including inactive and pre/delisted states. */
  tradingStatus: string;
  /** Null means the endpoint did not expose an independent trading-allowed flag. */
  tradingAllowed: boolean | null;
  aliases: readonly string[];
  rules: TradingRuleEvidence;
  /** Independent public 24-hour ticker evidence. Null means no authoritative volume fact. */
  quoteVolume: QuoteVolumeObservation | null;
  /** Usable USD value derived from fresh, complete quote-volume and conversion truth. */
  quoteVolume24hUsd: number | null;
  truth: TruthMetadata;
}

export interface MarginEligibilityObservation {
  id: string;
  instrument: InstrumentIdentity;
  marginTradingAllowed: boolean | null;
  buyAllowed: boolean | null;
  sellAllowed: boolean | null;
  isolatedMarginAllowed: boolean | null;
  aliases: readonly string[];
  truth: TruthMetadata;
}

export type CoverageAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'UNKNOWN';

export interface CoverageModeObservation {
  state: CoverageAvailability;
  evidenceKinds: readonly EvidenceKind[];
  reasonCodes: readonly string[];
}

export interface CoverageObservation {
  id: string;
  instrument: InstrumentIdentity;
  publicData: CoverageModeObservation;
  focusedData: CoverageModeObservation;
  truth: TruthMetadata;
}

export interface UniverseSnapshotInput {
  observedAtMs: number;
  spot: UniverseSourceSlice<ListingObservation>;
  usdMPerpetual: UniverseSourceSlice<ListingObservation>;
  margin: UniverseSourceSlice<MarginEligibilityObservation>;
  borrow: UniverseSourceSlice<NormalizedBorrow>;
  coverage: UniverseSourceSlice<CoverageObservation>;
}

export interface UniversePolicy {
  configurationVersion: string;
  activeSpotStatuses: readonly string[];
  activePerpetualStatuses: readonly string[];
  allowedQuoteAssetsForFocus: readonly string[] | null;
  minimumQuoteVolume24hUsdForFocus: number | null;
  requireSpotForFocus: boolean;
  requirePerpetualForFocus: boolean;
  requireMarginForFocus: boolean;
  requireBorrowEligibilityForFocus: boolean;
  requireBorrowAvailabilityForFocus: boolean;
  requirePublicDataForFocus: boolean;
  requireFocusedDataForFocus: boolean;
  maxRecordsPerSource: number;
  maxAliasesPerInstrument: number;
}

export type MarketAvailability = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';

export interface ListingView extends ListingObservation {
  aliases: string[];
  marketAvailability: MarketAvailability;
}

export interface MarginEligibilityView extends MarginEligibilityObservation {
  aliases: string[];
  state: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
}

export interface BorrowEligibilityView {
  id: string;
  instrument: InstrumentIdentity;
  asset: string;
  eligibility: NormalizedBorrow['eligibility'];
  availability: NormalizedBorrow['availability'];
  systemAvailableAmount: number | null;
  accountBorrowLimit: number | null;
  hourlyInterestRateDecimal: number | null;
  inventoryAmount: number | null;
  truth: TruthMetadata;
}

export interface CoverageView extends CoverageObservation {
  publicData: { state: CoverageAvailability; evidenceKinds: EvidenceKind[]; reasonCodes: string[] };
  focusedData: { state: CoverageAvailability; evidenceKinds: EvidenceKind[]; reasonCodes: string[] };
}

export interface CoverageSummary {
  state: CoverageAvailability | 'STALE';
  instrumentIds: string[];
  evidenceKinds: EvidenceKind[];
  reasonCodes: string[];
}

export interface FocusEligibility {
  state: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
  reasonCodes: string[];
}

export interface UniverseMarketNode {
  id: string;
  canonicalMarket: string;
  venue: InstrumentIdentity['venue'];
  baseAsset: string;
  quoteAsset: string;
  aliases: string[];
  spot: ListingView | null;
  usdMPerpetual: ListingView | null;
  margin: MarginEligibilityView | null;
  borrow: BorrowEligibilityView | null;
  coverage: CoverageView[];
  publicData: CoverageSummary;
  focusedData: CoverageSummary;
  quoteVolume24hUsd: number | null;
  quoteVolume: QuoteVolumeObservation | null;
  activity: 'DORMANT' | 'LOW_VOLUME' | 'ACTIVE' | 'UNKNOWN';
  visibility: { state: 'VISIBLE'; reasonCodes: string[] };
  focusEligibility: FocusEligibility;
  reasonCodes: string[];
  truth: TruthMetadata;
}

export interface UniverseAliasEntry {
  id: string;
  alias: string;
  nodeId: string;
  productFamilies: string[];
  sourceRecordIds: string[];
  truth: TruthMetadata;
}

export interface UniverseGraph {
  id: string;
  observedAtMs: number;
  configurationVersion: string;
  policy: UniversePolicy;
  sourceStates: Record<UniverseSourceKind, UniverseSourceState>;
  nodes: UniverseMarketNode[];
  aliases: UniverseAliasEntry[];
  failures: StableFailure[];
  truth: TruthMetadata;
}

export interface UniverseGraphChange {
  id: string;
  nodeId: string;
  kind: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  truth: TruthMetadata;
}

export interface UniverseGraphDiff {
  id: string;
  previousGraphId: string;
  nextGraphId: string;
  changes: UniverseGraphChange[];
  truth: TruthMetadata;
}

export interface UniverseGraphUpdate {
  graph: UniverseGraph;
  diff: UniverseGraphDiff;
}
