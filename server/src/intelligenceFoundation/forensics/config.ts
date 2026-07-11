export interface ForensicsConfig {
  schemaVersion: string;
  producerVersion: string;
  rulesVersion: string;
  shortWindowMs: number;
  confirmationWindowMs: number;
  mediumWindowMs: number;
  maxFreshAgeMs: number;
  maxEvidenceRecords: number;
  maxFeatureRecords: number;
  maxHistoryEpisodes: number;
  maxProvenanceIds: number;
  onePrintMaximumTrades: number;
  onePrintDominanceRatio: number;
  washMinimumTrades: number;
  washRepeatedSizeRatio: number;
  washAlternationRatio: number;
  washBuySellBalanceRatio: number;
  washKnownAggressorRatio: number;
  washMaximumPriceRangePct: number;
  washSizeToleranceRatio: number;
  abnormalVolumeMultiple: number;
  maximumNoResponsePct: number;
  minimumPriceJumpPct: number;
  maximumDepthSurvivalRatio: number;
  intendedDepthSupportRatio: number;
  exhaustionPeakMovePct: number;
  exhaustedCurrentMovePct: number;
  exhaustionFadeRatio: number;
  fakeFollowThroughInitialMovePct: number;
  fakeFollowThroughMinimumRetentionRatio: number;
  minimumHistoryEpisodes: number;
  historyFadeRate: number;
  historyFadeThresholdPct: number;
  marketMinimumMovePct: number;
  maximumSymbolSpecificResidualPct: number;
  minimumMarketShareRatio: number;
  liquidationDominanceRatio: number;
}

export const DEFAULT_FORENSICS_CONFIG: Readonly<ForensicsConfig> = Object.freeze({
  schemaVersion: '1',
  producerVersion: 'intelligence-forensics-1',
  rulesVersion: 'forensics-rules-1',
  shortWindowMs: 15_000,
  confirmationWindowMs: 60_000,
  mediumWindowMs: 300_000,
  maxFreshAgeMs: 30_000,
  maxEvidenceRecords: 20_000,
  maxFeatureRecords: 5_000,
  maxHistoryEpisodes: 256,
  maxProvenanceIds: 256,
  onePrintMaximumTrades: 2,
  onePrintDominanceRatio: 0.85,
  washMinimumTrades: 8,
  washRepeatedSizeRatio: 0.65,
  washAlternationRatio: 0.70,
  washBuySellBalanceRatio: 0.75,
  washKnownAggressorRatio: 0.80,
  washMaximumPriceRangePct: 0.15,
  washSizeToleranceRatio: 0.01,
  abnormalVolumeMultiple: 3,
  maximumNoResponsePct: 0.10,
  minimumPriceJumpPct: 0.50,
  maximumDepthSurvivalRatio: 0.50,
  intendedDepthSupportRatio: 1,
  exhaustionPeakMovePct: 3,
  exhaustedCurrentMovePct: 3,
  exhaustionFadeRatio: 0.35,
  fakeFollowThroughInitialMovePct: 0.50,
  fakeFollowThroughMinimumRetentionRatio: 0.25,
  minimumHistoryEpisodes: 3,
  historyFadeRate: 0.60,
  historyFadeThresholdPct: 0.50,
  marketMinimumMovePct: 0.40,
  maximumSymbolSpecificResidualPct: 0.15,
  minimumMarketShareRatio: 0.70,
  liquidationDominanceRatio: 0.70,
});

const POSITIVE_INTEGER_FIELDS: readonly (keyof ForensicsConfig)[] = [
  'shortWindowMs',
  'confirmationWindowMs',
  'mediumWindowMs',
  'maxFreshAgeMs',
  'maxEvidenceRecords',
  'maxFeatureRecords',
  'maxHistoryEpisodes',
  'maxProvenanceIds',
  'onePrintMaximumTrades',
  'washMinimumTrades',
  'minimumHistoryEpisodes',
];

const POSITIVE_FIELDS: readonly (keyof ForensicsConfig)[] = [
  'abnormalVolumeMultiple',
  'maximumNoResponsePct',
  'minimumPriceJumpPct',
  'intendedDepthSupportRatio',
  'exhaustionPeakMovePct',
  'exhaustedCurrentMovePct',
  'fakeFollowThroughInitialMovePct',
  'historyFadeThresholdPct',
  'marketMinimumMovePct',
  'maximumSymbolSpecificResidualPct',
];

const UNIT_INTERVAL_FIELDS: readonly (keyof ForensicsConfig)[] = [
  'onePrintDominanceRatio',
  'washRepeatedSizeRatio',
  'washAlternationRatio',
  'washBuySellBalanceRatio',
  'washKnownAggressorRatio',
  'washSizeToleranceRatio',
  'maximumDepthSurvivalRatio',
  'exhaustionFadeRatio',
  'fakeFollowThroughMinimumRetentionRatio',
  'historyFadeRate',
  'minimumMarketShareRatio',
  'liquidationDominanceRatio',
];

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

export function forensicsConfig(overrides: Partial<ForensicsConfig> = {}): Readonly<ForensicsConfig> {
  const config: ForensicsConfig = { ...DEFAULT_FORENSICS_CONFIG, ...overrides };
  for (const field of ['schemaVersion', 'producerVersion', 'rulesVersion'] as const) {
    if (!nonEmpty(config[field])) throw new TypeError(`${field} must be a non-empty bounded string`);
  }
  for (const field of POSITIVE_INTEGER_FIELDS) {
    const value = config[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${field} must be a positive safe integer`);
    }
  }
  for (const field of POSITIVE_FIELDS) {
    const value = config[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${field} must be finite and positive`);
    }
  }
  for (const field of UNIT_INTERVAL_FIELDS) {
    const value = config[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
      throw new RangeError(`${field} must be in (0, 1]`);
    }
  }
  if (!(config.shortWindowMs < config.confirmationWindowMs && config.confirmationWindowMs <= config.mediumWindowMs)) {
    throw new RangeError('forensics windows must be ordered short < confirmation <= medium');
  }
  if (config.minimumHistoryEpisodes > config.maxHistoryEpisodes) {
    throw new RangeError('minimumHistoryEpisodes cannot exceed maxHistoryEpisodes');
  }
  return Object.freeze(config);
}
