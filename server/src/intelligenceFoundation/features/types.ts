import type {
  BaselineState,
  FeatureValue,
  InstrumentIdentity,
  NormalizedEvidence,
  StableFailure,
} from '../contracts/index.js';

export interface FeatureClock {
  now(): number;
}

export interface FeatureSnapshot {
  symbol: string;
  instrumentId: string;
  computedAtMs: number;
  baseline: BaselineState;
  features: FeatureValue[];
  sourceEvidenceIds: string[];
  completeness: 'COMPLETE' | 'PARTIAL' | 'MISSING';
  reasonCodes: string[];
}

export interface FeatureBankStats {
  symbolCount: number;
  maxSymbols: number;
  evidenceCount: number;
  maximumEvidenceCapacity: number;
  instrumentIdentityCount: number;
  maximumInstrumentIdentityCapacity: number;
  baselineBucketCount: number;
  maximumBaselineCapacity: number;
}

export interface FeatureIngestResult {
  accepted: number;
  rejected: number;
  failures: StableFailure[];
}

export interface ActivityBucket {
  startMs: number;
  endMs: number;
  sessionBucket: string;
  quoteVolume: number;
  baseVolume: number;
  tradeCount: number;
  maximumTradeQuote: number;
  evidenceIds: string[];
  sourceSet: string[];
  lastReceivedTimeMs: number;
  numericOverflow: boolean;
}

export type EvidenceByKind = {
  [K in NormalizedEvidence['kind']]: Extract<NormalizedEvidence, { kind: K }>[];
};

export interface SymbolFeatureState {
  symbol: string;
  instruments: InstrumentIdentity[];
  evidence: EvidenceByKind;
  activityBuckets: ActivityBucket[];
  lastTouchedMs: number;
}
