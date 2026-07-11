export const REQUIRED_WINDOWS_MS = [
  1_000,
  5_000,
  15_000,
  60_000,
  5 * 60_000,
  60 * 60_000,
  24 * 60 * 60_000,
] as const;

export interface FeatureBankConfig {
  schemaVersion: string;
  producerVersion: string;
  configurationVersion: string;
  featureVersion: string;
  windowsMs: readonly number[];
  maxSymbols: number;
  maxInstrumentsPerSymbol: number;
  maxRecordsPerKind: number;
  historyRetentionMs: number;
  baselineBucketMs: number;
  baselineCapacity: number;
  baselineMinSamples: number;
  baselineStaleAfterMs: number;
  sessionBucketMs: number;
  sourceStaleAfterMs: number;
  derivativeStaleAfterMs: number;
  largeTradeQuoteThreshold: number;
  largeTradeClusterGapMs: number;
  leadMoveThresholdPct: number;
  minimumMarketSymbols: number;
  maxProvenanceIds: number;
}

export const FEATURE_BANK_DEFAULTS: Readonly<FeatureBankConfig> = Object.freeze({
  schemaVersion: '1',
  producerVersion: 'intelligence-features-1',
  configurationVersion: 'intelligence-features-cfg-1',
  featureVersion: 'market-features-v1',
  windowsMs: REQUIRED_WINDOWS_MS,
  maxSymbols: 4_096,
  maxInstrumentsPerSymbol: 5,
  maxRecordsPerKind: 16_384,
  historyRetentionMs: 8 * 24 * 60 * 60_000,
  baselineBucketMs: 60_000,
  baselineCapacity: 7 * 24 * 60,
  baselineMinSamples: 12,
  baselineStaleAfterMs: 6 * 60 * 60_000,
  sessionBucketMs: 4 * 60 * 60_000,
  sourceStaleAfterMs: 15_000,
  derivativeStaleAfterMs: 30_000,
  largeTradeQuoteThreshold: 5_000,
  largeTradeClusterGapMs: 1_000,
  leadMoveThresholdPct: 0.05,
  minimumMarketSymbols: 3,
  maxProvenanceIds: 256,
});

function finiteInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function nonEmpty(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new TypeError(`${name} must be a non-empty bounded string`);
  }
  return value;
}

export function featureBankConfig(overrides: Partial<FeatureBankConfig> = {}): FeatureBankConfig {
  const merged = { ...FEATURE_BANK_DEFAULTS, ...overrides };
  const windows = [...new Set(merged.windowsMs)].sort((left, right) => left - right);
  if (windows.length === 0 || windows.length > 32) throw new RangeError('windowsMs must contain 1..32 windows');
  for (const windowMs of windows) finiteInteger(windowMs, 100, 30 * 24 * 60 * 60_000, 'windowMs');
  for (const required of REQUIRED_WINDOWS_MS) {
    if (!windows.includes(required)) throw new RangeError(`windowsMs must include ${required}`);
  }
  const config: FeatureBankConfig = {
    ...merged,
    schemaVersion: nonEmpty(merged.schemaVersion, 'schemaVersion'),
    producerVersion: nonEmpty(merged.producerVersion, 'producerVersion'),
    configurationVersion: nonEmpty(merged.configurationVersion, 'configurationVersion'),
    featureVersion: nonEmpty(merged.featureVersion, 'featureVersion'),
    windowsMs: Object.freeze(windows),
    maxSymbols: finiteInteger(merged.maxSymbols, 1, 20_000, 'maxSymbols'),
    maxInstrumentsPerSymbol: finiteInteger(merged.maxInstrumentsPerSymbol, 1, 32, 'maxInstrumentsPerSymbol'),
    maxRecordsPerKind: finiteInteger(merged.maxRecordsPerKind, 16, 100_000, 'maxRecordsPerKind'),
    historyRetentionMs: finiteInteger(merged.historyRetentionMs, windows[windows.length - 1], 60 * 24 * 60 * 60_000, 'historyRetentionMs'),
    baselineBucketMs: finiteInteger(merged.baselineBucketMs, 1_000, 24 * 60 * 60_000, 'baselineBucketMs'),
    baselineCapacity: finiteInteger(merged.baselineCapacity, 1, 100_000, 'baselineCapacity'),
    baselineMinSamples: finiteInteger(merged.baselineMinSamples, 1, merged.baselineCapacity, 'baselineMinSamples'),
    baselineStaleAfterMs: finiteInteger(merged.baselineStaleAfterMs, 1_000, 60 * 24 * 60 * 60_000, 'baselineStaleAfterMs'),
    sessionBucketMs: finiteInteger(merged.sessionBucketMs, 60_000, 24 * 60 * 60_000, 'sessionBucketMs'),
    sourceStaleAfterMs: finiteInteger(merged.sourceStaleAfterMs, 1, 24 * 60 * 60_000, 'sourceStaleAfterMs'),
    derivativeStaleAfterMs: finiteInteger(merged.derivativeStaleAfterMs, 1, 24 * 60 * 60_000, 'derivativeStaleAfterMs'),
    largeTradeQuoteThreshold: merged.largeTradeQuoteThreshold,
    largeTradeClusterGapMs: finiteInteger(merged.largeTradeClusterGapMs, 1, 60_000, 'largeTradeClusterGapMs'),
    leadMoveThresholdPct: merged.leadMoveThresholdPct,
    minimumMarketSymbols: finiteInteger(merged.minimumMarketSymbols, 1, 20_000, 'minimumMarketSymbols'),
    maxProvenanceIds: finiteInteger(merged.maxProvenanceIds, 1, 10_000, 'maxProvenanceIds'),
  };
  if (!Number.isFinite(config.largeTradeQuoteThreshold) || config.largeTradeQuoteThreshold <= 0) {
    throw new RangeError('largeTradeQuoteThreshold must be positive');
  }
  if (!Number.isFinite(config.leadMoveThresholdPct) || config.leadMoveThresholdPct <= 0) {
    throw new RangeError('leadMoveThresholdPct must be positive');
  }
  if (24 * 60 * 60_000 % config.sessionBucketMs !== 0) {
    throw new RangeError('sessionBucketMs must divide one UTC day exactly');
  }
  return Object.freeze(config);
}
