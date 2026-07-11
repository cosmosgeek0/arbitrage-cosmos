import type {
  BookScope,
  EvidenceKind,
  InstrumentIdentity,
  NormalizedEvidence,
  NormalizedOpenInterest,
  ProductFamily,
  SourceEndpointClass,
  StableFailure,
} from '../contracts/index.js';

export interface InstrumentSeed {
  venue?: InstrumentIdentity['venue'];
  productFamily: ProductFamily;
  symbol: string;
  pair: string | null;
  baseAsset: string;
  quoteAsset: string | null;
  contractType?: string | null;
}

export interface SequenceCursor {
  last: string;
  recentSourceRecordIds?: readonly string[];
}

export interface NormalizationContext {
  sourceKey: string;
  sourceId: string;
  endpointClass: SourceEndpointClass;
  instrument: InstrumentSeed;
  receivedTimeMs: number;
  evaluatedAtMs: number;
  maxAgeMs: number;
  maximumFutureSkewMs?: number;
  previousSequence?: SequenceCursor | null;
  schemaVersion?: string;
  producerVersion?: string;
  configurationVersion?: string;
}

export interface OpenInterestNormalizationContext extends NormalizationContext {
  /** A prior normalized observation is required so identity, truth, and provenance travel with the comparison. */
  previousOpenInterest?: NormalizedOpenInterest | null;
}

export interface FundingInfoFragment {
  symbol: string;
  adjustedFundingRateCap: string | number;
  adjustedFundingRateFloor: string | number;
  fundingIntervalHours: string | number;
  receivedTimeMs: number;
  recordId?: string;
}

export interface FundingNormalizationContext extends NormalizationContext {
  /** Separately received /fapi/v1/fundingInfo record; never copied from mark-price or funding-history payloads. */
  fundingInfo?: FundingInfoFragment | null;
}

export type EvidenceNormalizationSuccess<T extends NormalizedEvidence> = {
  ok: true;
  value: T;
  qualityFailures: StableFailure[];
};

export type EvidenceNormalizationFailure = {
  ok: false;
  failures: StableFailure[];
};

export type EvidenceNormalizationResult<T extends NormalizedEvidence> =
  | EvidenceNormalizationSuccess<T>
  | EvidenceNormalizationFailure;

export interface EvidenceSetAssessment {
  complete: boolean;
  observedKinds: EvidenceKind[];
  missingKinds: EvidenceKind[];
  failures: StableFailure[];
}

export interface BinanceSourceFact {
  sourceId: string;
  dataset: string;
  endpointClass: SourceEndpointClass;
  productFamily: ProductFamily | 'ANY';
  evidenceKinds: readonly EvidenceKind[];
  endpoint: string;
  channel: string | null;
  freshnessBasis: 'SOURCE_EVENT_TIME' | 'SOURCE_TRANSACTION_TIME' | 'RECEIVE_TIME';
  sourceEventTimeField: string | null;
  sourceTransactionTimeField: string | null;
  sequenceFields: readonly string[];
  bookScope: BookScope | null;
  sourceMarketType: 1 | null;
  samplingWindowMs: number | null;
  notes: readonly string[];
}

export interface BorrowCompositeRecord {
  asset: string;
  allAssets?: {
    assetName: string;
    isBorrowable: boolean;
    scope: 'CROSS' | 'ISOLATED';
    isolatedSymbol?: string | null;
    receivedTimeMs: number;
    recordId?: string;
  } | null;
  maxBorrowable?: {
    amount: string | number;
    borrowLimit: string | number;
    scope: 'CROSS' | 'ISOLATED';
    isolatedSymbol?: string | null;
    receivedTimeMs: number;
    recordId?: string;
  } | null;
  availableInventory?: {
    amount: string | number;
    /** Binance publishes this field in epoch seconds. */
    updateTime: number;
    scope: 'CROSS' | 'ISOLATED';
    isolatedSymbol?: string | null;
    receivedTimeMs: number;
    recordId?: string;
  } | null;
  nextHourlyInterestRate?: {
    nextHourlyInterestRate: string | number;
    scope: 'CROSS' | 'ISOLATED';
    isolatedSymbol?: string | null;
    receivedTimeMs: number;
    recordId?: string;
  } | null;
}
