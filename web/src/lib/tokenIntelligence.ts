export const TOKEN_EVIDENCE_CAPABILITIES = Object.freeze([
  'ROLLING_ACTIVITY_FLOW',
  'SPREAD_DEPTH_BOOK',
  'CROSS_MARKET_LEADERSHIP',
  'OPEN_INTEREST',
  'FUNDING',
  'VOLATILITY',
  'LIQUIDATION',
  'CONTEXT',
  'SOURCE_QUALITY',
] as const);

export type TokenEvidenceCapabilityId = (typeof TOKEN_EVIDENCE_CAPABILITIES)[number];
export type TokenEvidenceState = 'FRESH' | 'STALE' | 'MISSING' | 'UNAVAILABLE';

const TOKEN_FACT_AUTHORITIES = Object.freeze({
  markFunding: Object.freeze({ sourceId: 'binance-futures-market-stream', dataset: 'usd_m.mark_price' }),
  openInterest: Object.freeze({ sourceId: 'binance-futures-rest', dataset: 'usd_m.open_interest' }),
  liquidation: Object.freeze({ sourceId: 'binance-futures-market-stream', dataset: 'usd_m.liquidation' }),
});
const TOKEN_EVIDENCE_HISTORY_HARD_MAX = 2_048;
export const TOKEN_NEWS_MAX_AGE_MS = 5 * 60_000;
const TOKEN_MARKET_STAGES = Object.freeze([
  'QUIET', 'EARLY_CHANGE', 'BEFORE_VISIBLE_MOVE', 'VISIBLE_EXPANSION', 'CONTINUATION',
  'EXHAUSTION', 'REVERSAL', 'TOO_LATE', 'UNCLASSIFIED',
]);
const TOKEN_HYPOTHESES = Object.freeze([
  'DEAD_VOLUME_WAKEUP', 'ACCUMULATION_TO_EXPANSION', 'SPOT_LED_EXPANSION',
  'PERPETUAL_LED_SQUEEZE', 'LIQUIDATION_DRIVEN_MOVE', 'MARKET_WIDE_BETA_MOVE',
  'THIN_BOOK_DISLOCATION', 'CHURN_WITHOUT_FOLLOW_THROUGH', 'EXHAUSTED_MOVE',
  'UNCLASSIFIED_ANOMALY',
]);
const TOKEN_ATTENTION_TIERS = Object.freeze(['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS', 'RELEASED']);

export interface TokenEvidenceCapability {
  capability: TokenEvidenceCapabilityId;
  freshness: 'FRESH' | 'STALE' | 'MISSING';
  completeness: 'COMPLETE' | 'PARTIAL' | 'SAMPLED' | 'MISSING';
  lastEvidenceTimeMs: number | null;
  sourceIds: string[];
  reasonCodes: string[];
}

export interface TokenEvidenceFact<T> {
  state: TokenEvidenceState;
  sourceId: string;
  dataset: string;
  observedAtMs: number | null;
  value: T | null;
  reasonCodes: string[];
}

export interface TokenThesisView {
  hypothesis: string;
  stage: string;
  changedFirst: string | null;
  changedAtMs: number | null;
  leadMarket: 'SPOT' | 'PERPETUAL' | 'NEITHER' | 'UNKNOWN';
  evaluatedAtMs: number;
  freshness: 'FRESH' | 'STALE' | 'MISSING';
  completeness: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
  reasonCodes: string[];
}

export interface TokenForensicsView {
  evaluatedAtMs: number;
  freshness: 'FRESH' | 'STALE' | 'MISSING';
  state: 'CLEAR' | 'BLOCKED' | 'UNKNOWN';
  claimAllowed: boolean;
  checkCount: number;
  blockingCheckCount: number;
  warningCheckCount: number;
  unknownRequiredCheckCount: number;
  reasonCodes: string[];
}

export interface TokenIntelligenceRead {
  schemaVersion: 'token-intelligence-owner-read.v1';
  symbol: string;
  observedAtMs: number;
  projection: {
    state: 'ACTIVE' | 'DEGRADED' | 'NOT_RUNNING';
    usdm: { connected: boolean; feedState: 'open' | 'connecting' | 'closed' | 'cooldown' | 'exhausted' | 'missing' };
    liquidation: { connected: boolean; feedState: 'open' | 'connecting' | 'closed' | 'cooldown' | 'exhausted' | 'missing' };
  };
  markFunding: TokenEvidenceFact<{
    markPrice: number | null;
    indexPrice: number | null;
    fundingRate: number | null;
    nextFundingTimeMs: number | null;
  }>;
  openInterest: TokenEvidenceFact<{
    base: number | null;
    quoteUsd: number | null;
    changePct: number | null;
  }>;
  liquidation: TokenEvidenceFact<{
    total15mUsd: number | null;
    long15mUsd: number | null;
    short15mUsd: number | null;
    sampling: 'LATEST_PER_SYMBOL_LOWER_BOUND';
  }>;
  routing: {
    symbol: string;
    observedAtMs: number;
    capabilities: TokenEvidenceCapability[];
    authority: 'EVIDENCE_ONLY';
    liveMoneyAuthority: 'NONE';
  };
  bridge: {
    evaluatedAtMs: number;
    currentState: 'CURRENT' | 'HISTORICAL_ONLY';
    evidenceHistoryCount: number;
    evidenceHistoryState: 'COMPLETE' | 'TRUNCATED';
    attention: { priority: number | null; tier: string } | null;
    thesis: TokenThesisView | null;
    forensics: TokenForensicsView | null;
    reasonCodes: string[];
  };
  authority: 'EVIDENCE_ONLY';
  liveMoneyAuthority: 'NONE';
}

export interface TokenNewsContext {
  fetchedAt: number;
  freshness: 'FRESH' | 'STALE';
  items: {
    id: string;
    title: string;
    source: string;
    sourceKey: string;
    channel: string;
    ts: number | null;
    symbols: string[];
  }[];
  sources: { key: string; status: 'live' | 'delayed' | 'error'; fetchedAt: number | null }[];
}

type DataRecord = Readonly<Record<string, PropertyDescriptor>>;

function dataRecord(value: unknown, exactKeys?: readonly string[]): DataRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  try {
    if (Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (exactKeys) {
      const expected = [...exactKeys].sort();
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
    }
    for (const descriptor of Object.values(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    }
    return descriptors;
  } catch {
    return null;
  }
}

function valueOf(record: DataRecord, key: string): unknown {
  return record[key]?.value;
}

function denseArray(value: unknown, maximum: number): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const length = descriptors['length']?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const detached: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      detached.push(descriptor.value);
    }
    if (Object.keys(descriptors).filter((key) => key !== 'length').length !== length) return null;
    return detached;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function stringIn<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableTime(value: unknown): value is number | null {
  return value === null || safeTime(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finite(value);
}

function nullablePositive(value: unknown): value is number | null {
  return value === null || finite(value) && value > 0;
}

function nullableNonNegative(value: unknown): value is number | null {
  return value === null || finite(value) && value >= 0;
}

function strings(value: unknown, maximum = 64): string[] | null {
  const rows = denseArray(value, maximum);
  if (!rows || rows.some((entry) => !boundedString(entry, 256))) return null;
  return [...rows] as string[];
}

function uniqueStrings(value: unknown, maximum = 64): string[] | null {
  const values = strings(value, maximum);
  return values === null || new Set(values).size !== values.length ? null : values;
}

const FORENSIC_CHECK_KINDS = Object.freeze([
  'ONE_PRINT_OR_CONCENTRATED_SPIKE',
  'WASH_LIKE_PING_PONG_CHURN',
  'VOLUME_WITHOUT_PRICE_RESPONSE',
  'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH',
  'ALREADY_EXHAUSTED_MOVE',
  'FAKE_FOLLOW_THROUGH',
  'REPEATED_WAKEUP_FADE',
  'MARKET_WIDE_MISCLASSIFICATION',
  'LIQUIDATION_ONLY_BURST',
  'STALE_OR_INCOMPLETE_EVIDENCE',
]);

type ParsedTruthFreshness = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'UNKNOWN';

interface ParsedTruthMetadata {
  evaluatedAtMs: number;
  freshness: ParsedTruthFreshness;
  authority: {
    kind: string;
    sourceId: string;
    dataset: string;
    endpointClass: string;
  };
  completeness: {
    state: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
    observedFields: string[];
    missingFields: string[];
    reasonCodes: string[];
  };
}

function parseTruthMetadata(
  value: unknown,
  upperBoundMs: number,
  bounds: Readonly<{ provenance: number; completeness: number }> = { provenance: 256, completeness: 256 },
): ParsedTruthMetadata | null {
  const record = dataRecord(value, [
    'schemaVersion', 'producerVersion', 'configurationVersion', 'featureVersion',
    'authority', 'provenance', 'temporal', 'freshness', 'completeness',
  ]);
  if (!record
      || !boundedString(valueOf(record, 'schemaVersion'))
      || !boundedString(valueOf(record, 'producerVersion'))
      || !boundedString(valueOf(record, 'configurationVersion'))
      || !(valueOf(record, 'featureVersion') === null || boundedString(valueOf(record, 'featureVersion')))) return null;

  const authority = dataRecord(valueOf(record, 'authority'), ['kind', 'sourceId', 'dataset', 'endpointClass']);
  if (!authority
      || !stringIn(valueOf(authority, 'kind'), ['EXCHANGE_PRIMARY', 'EXCHANGE_DERIVED', 'ENGINE_DERIVED', 'OPERATOR_SUPPLIED', 'REPLAY_SUPPLIED', 'CONTEXTUAL', 'UNKNOWN'])
      || !boundedString(valueOf(authority, 'sourceId'))
      || !boundedString(valueOf(authority, 'dataset'))
      || !stringIn(valueOf(authority, 'endpointClass'), ['PUBLIC', 'MARKET', 'REST', 'INJECTED', 'UNKNOWN'])) return null;

  const provenance = dataRecord(valueOf(record, 'provenance'), ['sourceRecordIds', 'sourceSet', 'transforms']);
  const sourceRecordIds = provenance ? uniqueStrings(valueOf(provenance, 'sourceRecordIds'), bounds.provenance) : null;
  const sourceSet = provenance ? uniqueStrings(valueOf(provenance, 'sourceSet'), bounds.provenance) : null;
  const transforms = provenance ? uniqueStrings(valueOf(provenance, 'transforms'), bounds.provenance) : null;
  if (!provenance || sourceRecordIds === null || sourceSet === null || sourceSet.length === 0 || transforms === null) return null;

  const temporal = dataRecord(valueOf(record, 'temporal'), [
    'sourceEventTimeMs', 'sourceTransactionTimeMs', 'receivedTimeMs', 'sequence',
  ]);
  if (!temporal) return null;
  const sourceEventTimeMs = valueOf(temporal, 'sourceEventTimeMs');
  const sourceTransactionTimeMs = valueOf(temporal, 'sourceTransactionTimeMs');
  const receivedTimeMs = valueOf(temporal, 'receivedTimeMs');
  if (!nullableTime(sourceEventTimeMs) || !nullableTime(sourceTransactionTimeMs) || !safeTime(receivedTimeMs)
      || sourceEventTimeMs !== null && sourceEventTimeMs > upperBoundMs
      || sourceTransactionTimeMs !== null && sourceTransactionTimeMs > upperBoundMs
      || receivedTimeMs > upperBoundMs) return null;
  const sequenceValue = valueOf(temporal, 'sequence');
  if (sequenceValue !== null) {
    const sequence = dataRecord(sequenceValue, ['first', 'last', 'previous']);
    const first = sequence ? valueOf(sequence, 'first') : null;
    const last = sequence ? valueOf(sequence, 'last') : null;
    const previous = sequence ? valueOf(sequence, 'previous') : undefined;
    if (!sequence || !boundedString(first, 128) || !/^\d+$/.test(first)
        || !boundedString(last, 128) || !/^\d+$/.test(last)
        || !(previous === null || boundedString(previous, 128) && /^\d+$/.test(previous))
        || BigInt(first) > BigInt(last)) return null;
  }

  const freshness = dataRecord(valueOf(record, 'freshness'), ['basis', 'evaluatedAtMs', 'ageMs', 'maxAgeMs', 'state']);
  if (!freshness) return null;
  const basis = valueOf(freshness, 'basis');
  const evaluatedAtMs = valueOf(freshness, 'evaluatedAtMs');
  const ageMs = valueOf(freshness, 'ageMs');
  const maxAgeMs = valueOf(freshness, 'maxAgeMs');
  const state = valueOf(freshness, 'state');
  if (!stringIn(basis, ['SOURCE_EVENT_TIME', 'SOURCE_TRANSACTION_TIME', 'RECEIVE_TIME', 'UNAVAILABLE'])
      || !safeTime(evaluatedAtMs) || evaluatedAtMs > upperBoundMs || evaluatedAtMs < receivedTimeMs
      || !(ageMs === null || finite(ageMs) && ageMs >= 0)
      || !(maxAgeMs === null || finite(maxAgeMs) && maxAgeMs >= 0)
      || !stringIn(state, ['FRESH', 'STALE', 'UNAVAILABLE', 'UNKNOWN'])) return null;
  const basisTime = basis === 'SOURCE_EVENT_TIME'
    ? sourceEventTimeMs
    : basis === 'SOURCE_TRANSACTION_TIME'
      ? sourceTransactionTimeMs
      : basis === 'RECEIVE_TIME'
        ? receivedTimeMs
        : null;
  if ((state === 'FRESH' || state === 'STALE')
      && (basisTime === null || ageMs === null || maxAgeMs === null || basis === 'UNAVAILABLE'
        || ageMs !== evaluatedAtMs - basisTime
        || state === 'FRESH' && ageMs > maxAgeMs
        || state === 'STALE' && ageMs <= maxAgeMs)
      || state === 'UNAVAILABLE' && ageMs !== null) return null;

  const completeness = dataRecord(valueOf(record, 'completeness'), [
    'state', 'observedFields', 'missingFields', 'reasonCodes',
  ]);
  const completenessState = completeness ? valueOf(completeness, 'state') : null;
  const observedFields = completeness ? uniqueStrings(valueOf(completeness, 'observedFields'), bounds.completeness) : null;
  const missingFields = completeness ? uniqueStrings(valueOf(completeness, 'missingFields'), bounds.completeness) : null;
  const reasonCodes = completeness ? uniqueStrings(valueOf(completeness, 'reasonCodes'), bounds.completeness) : null;
  if (!completeness || !stringIn(completenessState, ['COMPLETE', 'PARTIAL', 'MISSING', 'UNKNOWN'])
      || observedFields === null || missingFields === null || reasonCodes === null
      || observedFields.some((field) => missingFields.includes(field))
      || completenessState === 'COMPLETE' && missingFields.length > 0
      || completenessState === 'MISSING' && missingFields.length === 0
      || (completenessState === 'PARTIAL' || completenessState === 'MISSING')
        && (missingFields.length === 0 || reasonCodes.length === 0)) return null;
  return {
    evaluatedAtMs,
    freshness: state as ParsedTruthFreshness,
    authority: {
      kind: valueOf(authority, 'kind') as string,
      sourceId: valueOf(authority, 'sourceId') as string,
      dataset: valueOf(authority, 'dataset') as string,
      endpointClass: valueOf(authority, 'endpointClass') as string,
    },
    completeness: {
      state: completenessState as ParsedTruthMetadata['completeness']['state'],
      observedFields: [...observedFields],
      missingFields: [...missingFields],
      reasonCodes: [...reasonCodes],
    },
  };
}

function canonicalForensicsTruth(
  truth: ParsedTruthMetadata,
  evaluatedAtMs: number,
  dataset: string,
): boolean {
  return truth.evaluatedAtMs === evaluatedAtMs
    && truth.authority.kind === 'ENGINE_DERIVED'
    && truth.authority.sourceId === 'market-intelligence-false-positive-forensics'
    && truth.authority.dataset === dataset
    && truth.authority.endpointClass === 'INJECTED';
}

interface ParsedForensicCheck {
  id: string;
  kind: string;
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  severity: 'BLOCK' | 'WARN';
  required: boolean;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((entry) => actual.includes(entry));
}

function parseForensics(
  value: unknown,
  artifactEvaluatedAtMs: number,
  expectedSymbol: string,
  expectedInstrumentId: string,
): TokenForensicsView | null {
  const report = dataRecord(value, ['id', 'symbol', 'instrumentId', 'evaluatedAtMs', 'checks', 'tradeability', 'truth']);
  if (!report || !boundedString(valueOf(report, 'id'))
      || valueOf(report, 'symbol') !== expectedSymbol || valueOf(report, 'instrumentId') !== expectedInstrumentId
      || !safeTime(valueOf(report, 'evaluatedAtMs'))
      || valueOf(report, 'evaluatedAtMs') !== artifactEvaluatedAtMs) return null;
  const evaluatedAtMs = valueOf(report, 'evaluatedAtMs') as number;
  const rawChecks = denseArray(valueOf(report, 'checks'), 32);
  if (!rawChecks) return null;
  const checks: ParsedForensicCheck[] = [];
  for (const rawCheck of rawChecks) {
    const check = dataRecord(rawCheck, [
      'id', 'check', 'verdict', 'severity', 'required', 'reasonCodes', 'evidenceIds', 'featureIds',
      'observationStartMs', 'observationEndMs', 'metrics', 'truth',
    ]);
    if (!check) return null;
    const id = valueOf(check, 'id');
    const kind = valueOf(check, 'check');
    const verdict = valueOf(check, 'verdict');
    const severity = valueOf(check, 'severity');
    const required = valueOf(check, 'required');
    const repeatedWakeup = kind === 'REPEATED_WAKEUP_FADE';
    const reasonCodes = uniqueStrings(valueOf(check, 'reasonCodes'), 64);
    const evidenceIds = uniqueStrings(valueOf(check, 'evidenceIds'), 256);
    const featureIds = uniqueStrings(valueOf(check, 'featureIds'), 256);
    const observationStartMs = valueOf(check, 'observationStartMs');
    const observationEndMs = valueOf(check, 'observationEndMs');
    const checkTruth = parseTruthMetadata(valueOf(check, 'truth'), evaluatedAtMs);
    if (!boundedString(id) || !stringIn(kind, FORENSIC_CHECK_KINDS)
        || !stringIn(verdict, ['PASS', 'FAIL', 'UNKNOWN'])
        || !stringIn(severity, ['BLOCK', 'WARN']) || typeof required !== 'boolean'
        || severity !== (repeatedWakeup ? 'WARN' : 'BLOCK') || required !== !repeatedWakeup
        || reasonCodes === null || reasonCodes.length === 0 || evidenceIds === null || featureIds === null
        || !nullableTime(observationStartMs) || !nullableTime(observationEndMs)
        || (observationStartMs === null) !== (observationEndMs === null)
        || observationStartMs !== null && observationEndMs !== null
          && (observationStartMs > observationEndMs || observationEndMs > evaluatedAtMs)
        || checkTruth === null || !canonicalForensicsTruth(checkTruth, evaluatedAtMs, kind)) return null;
    const verdictField = `forensics.${kind}.verdict`;
    if (verdict === 'UNKNOWN') {
      const expectedCompleteness = checkTruth.completeness.observedFields.length === 0 ? 'MISSING' : 'PARTIAL';
      if (checkTruth.completeness.state !== expectedCompleteness
          || checkTruth.completeness.missingFields.length === 0
          || checkTruth.completeness.observedFields.some((field) => field !== verdictField)) return null;
    } else if (checkTruth.completeness.state !== 'COMPLETE'
        || !sameStringSet(checkTruth.completeness.observedFields, [verdictField])
        || checkTruth.completeness.missingFields.length !== 0) return null;
    if (!sameStringSet(checkTruth.completeness.reasonCodes, reasonCodes)) return null;
    const metrics = denseArray(valueOf(check, 'metrics'), 64);
    if (!metrics) return null;
    const metricNames = new Set<string>();
    for (const rawMetric of metrics) {
      const metric = dataRecord(rawMetric, ['name', 'value', 'unit']);
      const name = metric ? valueOf(metric, 'name') : null;
      const metricValue = metric ? valueOf(metric, 'value') : undefined;
      if (!metric || !boundedString(name) || metricNames.has(name) || !boundedString(valueOf(metric, 'unit'))
          || !(metricValue === null || typeof metricValue === 'string' && metricValue.length <= 256
            || typeof metricValue === 'boolean' || finite(metricValue))) return null;
      metricNames.add(name);
    }
    checks.push({
      id,
      kind: kind as string,
      verdict: verdict as ParsedForensicCheck['verdict'],
      severity: severity as ParsedForensicCheck['severity'],
      required,
    });
  }
  if (new Set(checks.map((check) => check.id)).size !== checks.length
      || checks.length !== FORENSIC_CHECK_KINDS.length
      || new Set(checks.map((check) => check.kind)).size !== checks.length
      || FORENSIC_CHECK_KINDS.some((kind) => !checks.some((check) => check.kind === kind))) return null;

  const tradeability = dataRecord(valueOf(report, 'tradeability'), [
    'state', 'claimAllowed', 'blockingCheckIds', 'warningCheckIds', 'unknownRequiredCheckIds', 'reasonCodes',
  ]);
  if (!tradeability) return null;
  const state = valueOf(tradeability, 'state');
  const claimAllowed = valueOf(tradeability, 'claimAllowed');
  const blockingCheckIds = uniqueStrings(valueOf(tradeability, 'blockingCheckIds'), 32);
  const warningCheckIds = uniqueStrings(valueOf(tradeability, 'warningCheckIds'), 32);
  const unknownRequiredCheckIds = uniqueStrings(valueOf(tradeability, 'unknownRequiredCheckIds'), 32);
  const reasonCodes = uniqueStrings(valueOf(tradeability, 'reasonCodes'), 64);
  const expectedBlocking = checks.filter((check) => check.severity === 'BLOCK' && check.verdict === 'FAIL').map((check) => check.id);
  const expectedWarnings = checks.filter((check) => check.severity === 'WARN' && check.verdict !== 'PASS').map((check) => check.id);
  const expectedUnknown = checks.filter((check) => check.required && check.verdict === 'UNKNOWN').map((check) => check.id);
  const expectedState = expectedBlocking.length > 0 ? 'BLOCKED' : expectedUnknown.length > 0 ? 'UNKNOWN' : 'CLEAR';
  const expectedReasons = [
    expectedState === 'BLOCKED'
      ? 'FORENSICS_BLOCKING_FALSE_POSITIVE_OBSERVED'
      : expectedState === 'UNKNOWN'
        ? 'FORENSICS_REQUIRED_CHECK_UNKNOWN'
        : 'FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR',
    ...(expectedWarnings.length > 0 ? ['FORENSICS_NON_BLOCKING_WARNING_PRESENT'] : []),
  ];
  if (!stringIn(state, ['CLEAR', 'BLOCKED', 'UNKNOWN']) || typeof claimAllowed !== 'boolean'
      || blockingCheckIds === null || warningCheckIds === null || unknownRequiredCheckIds === null || reasonCodes === null
      || !sameStringSet(blockingCheckIds, expectedBlocking) || !sameStringSet(warningCheckIds, expectedWarnings)
      || !sameStringSet(unknownRequiredCheckIds, expectedUnknown) || state !== expectedState
      || claimAllowed !== (state === 'CLEAR') || !sameStringSet(reasonCodes, expectedReasons)) return null;
  const reportTruth = parseTruthMetadata(valueOf(report, 'truth'), evaluatedAtMs);
  const expectedObservedFields = checks
    .filter((check) => check.verdict !== 'UNKNOWN')
    .map((check) => `forensics.${check.kind}.verdict`);
  const expectedMissingFields = checks
    .filter((check) => check.required && check.verdict === 'UNKNOWN')
    .map((check) => `forensics.${check.kind}.verdict`);
  const expectedCompleteness = expectedMissingFields.length === 0
    ? 'COMPLETE'
    : expectedObservedFields.length === 0
      ? 'MISSING'
      : 'PARTIAL';
  if (reportTruth === null
      || !canonicalForensicsTruth(reportTruth, evaluatedAtMs, 'false-positive-forensics-report')
      || reportTruth.completeness.state !== expectedCompleteness
      || !sameStringSet(reportTruth.completeness.observedFields, expectedObservedFields)
      || !sameStringSet(reportTruth.completeness.missingFields, expectedMissingFields)
      || !sameStringSet(reportTruth.completeness.reasonCodes, reasonCodes)) return null;
  return {
    evaluatedAtMs,
    freshness: reportTruth.freshness === 'FRESH' || reportTruth.freshness === 'STALE'
      ? reportTruth.freshness
      : 'MISSING',
    state: state as TokenForensicsView['state'],
    claimAllowed,
    checkCount: checks.length,
    blockingCheckCount: blockingCheckIds.length,
    warningCheckCount: warningCheckIds.length,
    unknownRequiredCheckCount: unknownRequiredCheckIds.length,
    reasonCodes: [...reasonCodes],
  };
}

function parseFact<T>(
  value: unknown,
  expected: Readonly<{ sourceId: string; dataset: string }>,
  parseValue: (candidate: unknown) => T | null,
): TokenEvidenceFact<T> | null {
  const record = dataRecord(value, ['state', 'sourceId', 'dataset', 'observedAtMs', 'value', 'reasonCodes']);
  if (!record) return null;
  const state = valueOf(record, 'state');
  const sourceId = valueOf(record, 'sourceId');
  const dataset = valueOf(record, 'dataset');
  const observedAtMs = valueOf(record, 'observedAtMs');
  const rawValue = valueOf(record, 'value');
  const reasonCodes = strings(valueOf(record, 'reasonCodes'));
  if (!stringIn(state, ['FRESH', 'STALE', 'MISSING', 'UNAVAILABLE'])
      || sourceId !== expected.sourceId || dataset !== expected.dataset
      || !nullableTime(observedAtMs) || reasonCodes === null) return null;
  const parsed = rawValue === null ? null : parseValue(rawValue);
  if ((rawValue !== null && parsed === null)
      || (state === 'FRESH' && (parsed === null || observedAtMs === null))
      || (state !== 'FRESH' && rawValue !== null)) return null;
  return { state: state as TokenEvidenceState, sourceId, dataset, observedAtMs, value: parsed, reasonCodes };
}

function parseCapability(value: unknown, observedAtMs: number): TokenEvidenceCapability | null {
  const record = dataRecord(value, [
    'capability', 'freshness', 'completeness', 'lastEvidenceTimeMs', 'sourceIds', 'reasonCodes',
  ]);
  if (!record) return null;
  const capability = valueOf(record, 'capability');
  const freshness = valueOf(record, 'freshness');
  const completeness = valueOf(record, 'completeness');
  const lastEvidenceTimeMs = valueOf(record, 'lastEvidenceTimeMs');
  const sourceIds = strings(valueOf(record, 'sourceIds'));
  const reasonCodes = strings(valueOf(record, 'reasonCodes'));
  if (!(TOKEN_EVIDENCE_CAPABILITIES as readonly unknown[]).includes(capability)
      || !stringIn(freshness, ['FRESH', 'STALE', 'MISSING'])
      || !stringIn(completeness, ['COMPLETE', 'PARTIAL', 'SAMPLED', 'MISSING'])
      || !nullableTime(lastEvidenceTimeMs) || sourceIds === null || reasonCodes === null
      || lastEvidenceTimeMs !== null && lastEvidenceTimeMs > observedAtMs
      || freshness !== 'MISSING' && (lastEvidenceTimeMs === null || sourceIds.length === 0 || completeness === 'MISSING')) return null;
  return {
    capability: capability as TokenEvidenceCapabilityId,
    freshness: freshness as TokenEvidenceCapability['freshness'],
    completeness: completeness as TokenEvidenceCapability['completeness'],
    lastEvidenceTimeMs,
    sourceIds,
    reasonCodes,
  };
}

function parseThesis(value: unknown, observedAtMs: number, expectedInstrumentId: string): TokenThesisView | null {
  const record = dataRecord(value);
  if (!record) return null;
  const instrumentId = valueOf(record, 'instrumentId');
  const hypothesis = valueOf(record, 'hypothesis');
  const stage = valueOf(record, 'stage');
  const changedFirst = valueOf(record, 'changedFirst');
  const changedAtMs = valueOf(record, 'changedAtMs');
  const leadMarket = valueOf(record, 'leadMarket');
  const reasonCodes = strings(valueOf(record, 'reasonCodes'));
  const truth = parseTruthMetadata(valueOf(record, 'truth'), observedAtMs, {
    provenance: 512,
    completeness: 4_096,
  });
  if (instrumentId !== expectedInstrumentId
      || !boundedString(hypothesis, 128) || !TOKEN_HYPOTHESES.includes(hypothesis)
      || !boundedString(stage, 128) || !TOKEN_MARKET_STAGES.includes(stage)
      || !(changedFirst === null || boundedString(changedFirst, 128))
      || !nullableTime(changedAtMs) || changedAtMs !== null && changedAtMs > observedAtMs
      || !stringIn(leadMarket, ['SPOT', 'PERPETUAL', 'NEITHER', 'UNKNOWN'])
      || reasonCodes === null || truth === null || truth.evaluatedAtMs !== observedAtMs
      || truth.authority.kind !== 'ENGINE_DERIVED'
      || truth.authority.sourceId !== 'market-intelligence-thesis-builder'
      || truth.authority.dataset !== 'thesis-packet'
      || truth.authority.endpointClass !== 'INJECTED') return null;
  return {
    hypothesis,
    stage,
    changedFirst,
    changedAtMs,
    leadMarket: leadMarket as TokenThesisView['leadMarket'],
    evaluatedAtMs: truth.evaluatedAtMs,
    freshness: truth.freshness === 'FRESH' || truth.freshness === 'STALE' ? truth.freshness : 'MISSING',
    completeness: truth.completeness.state,
    reasonCodes,
  };
}

export function parseTokenIntelligence(
  value: unknown,
  expectedSymbol: string,
  evaluatedAtMs: number,
): TokenIntelligenceRead | null {
  const root = dataRecord(value, [
    'schemaVersion', 'symbol', 'observedAtMs', 'projection', 'markFunding', 'openInterest',
    'liquidation', 'routing', 'bridge', 'authority', 'liveMoneyAuthority',
  ]);
  if (!root || !safeTime(evaluatedAtMs)
      || valueOf(root, 'schemaVersion') !== 'token-intelligence-owner-read.v1'
      || valueOf(root, 'symbol') !== expectedSymbol || !safeTime(valueOf(root, 'observedAtMs'))
      || (valueOf(root, 'observedAtMs') as number) > evaluatedAtMs
      || valueOf(root, 'authority') !== 'EVIDENCE_ONLY' || valueOf(root, 'liveMoneyAuthority') !== 'NONE') return null;
  const observedAtMs = valueOf(root, 'observedAtMs') as number;

  const projection = dataRecord(valueOf(root, 'projection'), ['state', 'usdm', 'liquidation']);
  const parseFeed = (candidate: unknown) => {
    const record = dataRecord(candidate, ['connected', 'feedState']);
    if (!record || typeof valueOf(record, 'connected') !== 'boolean'
        || !stringIn(valueOf(record, 'feedState'), ['open', 'connecting', 'closed', 'cooldown', 'exhausted', 'missing'])) return null;
    return { connected: valueOf(record, 'connected') as boolean, feedState: valueOf(record, 'feedState') as TokenIntelligenceRead['projection']['usdm']['feedState'] };
  };
  if (!projection || !stringIn(valueOf(projection, 'state'), ['ACTIVE', 'DEGRADED', 'NOT_RUNNING'])) return null;
  const usdm = parseFeed(valueOf(projection, 'usdm'));
  const liquidationProjection = parseFeed(valueOf(projection, 'liquidation'));
  if (!usdm || !liquidationProjection
      || usdm.connected !== (usdm.feedState === 'open')
      || liquidationProjection.connected !== (liquidationProjection.feedState === 'open')) return null;

  const markFunding = parseFact(valueOf(root, 'markFunding'), TOKEN_FACT_AUTHORITIES.markFunding, (candidate) => {
    const record = dataRecord(candidate, ['markPrice', 'indexPrice', 'fundingRate', 'nextFundingTimeMs']);
    const markPrice = record ? valueOf(record, 'markPrice') : undefined;
    const indexPrice = record ? valueOf(record, 'indexPrice') : undefined;
    const fundingRate = record ? valueOf(record, 'fundingRate') : undefined;
    const nextFundingTimeMs = record ? valueOf(record, 'nextFundingTimeMs') : undefined;
    if (!record || !nullablePositive(markPrice) || !nullablePositive(indexPrice)
        || !nullableFinite(fundingRate) || fundingRate !== null && Math.abs(fundingRate) > 1
        || !nullableTime(nextFundingTimeMs)
        || markPrice === null && indexPrice === null && fundingRate === null) return null;
    return {
      markPrice,
      indexPrice,
      fundingRate,
      nextFundingTimeMs,
    };
  });
  const openInterest = parseFact(valueOf(root, 'openInterest'), TOKEN_FACT_AUTHORITIES.openInterest, (candidate) => {
    const record = dataRecord(candidate, ['base', 'quoteUsd', 'changePct']);
    const base = record ? valueOf(record, 'base') : undefined;
    const quoteUsd = record ? valueOf(record, 'quoteUsd') : undefined;
    const changePct = record ? valueOf(record, 'changePct') : undefined;
    if (!record || !nullableNonNegative(base) || !nullableNonNegative(quoteUsd)
        || !nullableFinite(changePct) || base === null && quoteUsd === null && changePct === null) return null;
    return {
      base,
      quoteUsd,
      changePct,
    };
  });
  const liquidation = parseFact(valueOf(root, 'liquidation'), TOKEN_FACT_AUTHORITIES.liquidation, (candidate) => {
    const record = dataRecord(candidate, ['total15mUsd', 'long15mUsd', 'short15mUsd', 'sampling']);
    const total15mUsd = record ? valueOf(record, 'total15mUsd') : undefined;
    const long15mUsd = record ? valueOf(record, 'long15mUsd') : undefined;
    const short15mUsd = record ? valueOf(record, 'short15mUsd') : undefined;
    if (!record || !nullablePositive(total15mUsd) || !nullableNonNegative(long15mUsd)
        || !nullableNonNegative(short15mUsd)
        || total15mUsd === null
        || total15mUsd !== (long15mUsd ?? 0) + (short15mUsd ?? 0)
        || valueOf(record, 'sampling') !== 'LATEST_PER_SYMBOL_LOWER_BOUND') return null;
    return {
      total15mUsd,
      long15mUsd,
      short15mUsd,
      sampling: 'LATEST_PER_SYMBOL_LOWER_BOUND' as const,
    };
  });
  if (!markFunding || !openInterest || !liquidation
      || [markFunding, openInterest, liquidation].some((fact) => fact.observedAtMs !== null && fact.observedAtMs > observedAtMs)
      || markFunding.state === 'FRESH' && !usdm.connected
      || openInterest.state === 'FRESH' && !usdm.connected
      || liquidation.state === 'FRESH' && !liquidationProjection.connected) return null;

  const routingRecord = dataRecord(valueOf(root, 'routing'), [
    'symbol', 'observedAtMs', 'capabilities', 'authority', 'liveMoneyAuthority',
  ]);
  const routingObservedAtMs = routingRecord ? valueOf(routingRecord, 'observedAtMs') : null;
  const capabilityRows = routingRecord ? denseArray(valueOf(routingRecord, 'capabilities'), 16) : null;
  const capabilities = safeTime(routingObservedAtMs)
    ? capabilityRows?.map((candidate) => parseCapability(candidate, routingObservedAtMs)) ?? null
    : null;
  if (!routingRecord || valueOf(routingRecord, 'symbol') !== expectedSymbol
      || !safeTime(routingObservedAtMs)
      || routingObservedAtMs > observedAtMs
      || valueOf(routingRecord, 'authority') !== 'EVIDENCE_ONLY'
      || valueOf(routingRecord, 'liveMoneyAuthority') !== 'NONE'
      || capabilities === null || capabilities.some((entry) => entry === null)
      || capabilities.length !== TOKEN_EVIDENCE_CAPABILITIES.length
      || new Set(capabilities.map((entry) => entry!.capability)).size !== capabilities.length
      || TOKEN_EVIDENCE_CAPABILITIES.some((id) => !capabilities.some((entry) => entry?.capability === id))) return null;

  const bridgeRecord = dataRecord(valueOf(root, 'bridge'), [
    'symbol', 'evaluatedAtMs', 'featureSnapshot', 'evidenceHistoryCount', 'evidenceHistoryState',
    'attention', 'artifact', 'reasonCodes', 'authority', 'liveMoneyAuthority', 'currentState',
  ]);
  if (!bridgeRecord || valueOf(bridgeRecord, 'symbol') !== expectedSymbol
      || !safeTime(valueOf(bridgeRecord, 'evaluatedAtMs'))
      || (valueOf(bridgeRecord, 'evaluatedAtMs') as number) > observedAtMs
      || !Number.isSafeInteger(valueOf(bridgeRecord, 'evidenceHistoryCount'))
      || (valueOf(bridgeRecord, 'evidenceHistoryCount') as number) < 0
      || (valueOf(bridgeRecord, 'evidenceHistoryCount') as number) > TOKEN_EVIDENCE_HISTORY_HARD_MAX
      || !stringIn(valueOf(bridgeRecord, 'evidenceHistoryState'), ['COMPLETE', 'TRUNCATED'])
      || !stringIn(valueOf(bridgeRecord, 'currentState'), ['CURRENT', 'HISTORICAL_ONLY'])
      || valueOf(bridgeRecord, 'authority') !== 'EVIDENCE_ONLY'
      || valueOf(bridgeRecord, 'liveMoneyAuthority') !== 'NONE') return null;
  const bridgeReasons = strings(valueOf(bridgeRecord, 'reasonCodes'));
  if (bridgeReasons === null) return null;
  const featureSnapshot = valueOf(bridgeRecord, 'featureSnapshot');
  const attentionValue = valueOf(bridgeRecord, 'attention');
  const artifactValue = valueOf(bridgeRecord, 'artifact');
  const featureSnapshotRecord = featureSnapshot === null ? null : dataRecord(featureSnapshot);
  if (!(featureSnapshot === null || featureSnapshotRecord)
      || !(attentionValue === null || dataRecord(attentionValue))
      || !(artifactValue === null || dataRecord(artifactValue))) return null;
  if (featureSnapshotRecord !== null && valueOf(featureSnapshotRecord, 'symbol') !== expectedSymbol) return null;
  if (valueOf(bridgeRecord, 'currentState') === 'HISTORICAL_ONLY'
      && (featureSnapshot !== null || attentionValue !== null || artifactValue !== null)) return null;
  let attention: TokenIntelligenceRead['bridge']['attention'] = null;
  if (attentionValue !== null) {
    const record = dataRecord(attentionValue);
    const priority = record ? valueOf(record, 'priority') : undefined;
    const tier = record ? valueOf(record, 'tier') : undefined;
    if (!record || valueOf(record, 'symbol') !== expectedSymbol
        || !(priority === null || finite(priority) && priority >= 0)
        || !boundedString(tier, 64) || !TOKEN_ATTENTION_TIERS.includes(tier)) return null;
    attention = { priority, tier };
  }
  let thesis: TokenThesisView | null = null;
  let forensics: TokenForensicsView | null = null;
  if (artifactValue !== null) {
    const artifact = dataRecord(artifactValue);
    const artifactInstrumentId = artifact ? valueOf(artifact, 'instrumentId') : null;
    const artifactEvaluatedAtMs = artifact ? valueOf(artifact, 'evaluatedAtMs') : null;
    const bridgeEvaluatedAtMs = valueOf(bridgeRecord, 'evaluatedAtMs') as number;
    if (!artifact || valueOf(artifact, 'symbol') !== expectedSymbol
        || !boundedString(artifactInstrumentId)
        || !safeTime(artifactEvaluatedAtMs) || artifactEvaluatedAtMs > bridgeEvaluatedAtMs
        || valueOf(artifact, 'authority') !== 'EVIDENCE_ONLY') return null;
    thesis = parseThesis(valueOf(artifact, 'thesis'), artifactEvaluatedAtMs, artifactInstrumentId);
    forensics = parseForensics(
      valueOf(artifact, 'forensics'),
      artifactEvaluatedAtMs,
      expectedSymbol,
      artifactInstrumentId,
    );
    if (thesis === null || forensics === null) return null;
  }

  const anyFreshFact = markFunding.state === 'FRESH'
    || openInterest.state === 'FRESH'
    || liquidation.state === 'FRESH';
  const anyFreshCapability = capabilities.some((capability) => capability?.freshness === 'FRESH');
  const projectionState = valueOf(projection, 'state');
  const bridgeState = valueOf(bridgeRecord, 'currentState');
  if (projectionState === 'ACTIVE' && (!anyFreshFact && !anyFreshCapability || bridgeState !== 'CURRENT')
      || projectionState !== 'ACTIVE' && (anyFreshFact || anyFreshCapability)
      || projectionState === 'NOT_RUNNING' && (anyFreshCapability || bridgeState !== 'HISTORICAL_ONLY')) return null;

  return {
    schemaVersion: 'token-intelligence-owner-read.v1',
    symbol: expectedSymbol,
    observedAtMs,
    projection: {
      state: valueOf(projection, 'state') as TokenIntelligenceRead['projection']['state'],
      usdm,
      liquidation: liquidationProjection,
    },
    markFunding,
    openInterest,
    liquidation,
    routing: {
      symbol: expectedSymbol,
      observedAtMs: routingObservedAtMs,
      capabilities: capabilities as TokenEvidenceCapability[],
      authority: 'EVIDENCE_ONLY',
      liveMoneyAuthority: 'NONE',
    },
    bridge: {
      evaluatedAtMs: valueOf(bridgeRecord, 'evaluatedAtMs') as number,
      currentState: valueOf(bridgeRecord, 'currentState') as TokenIntelligenceRead['bridge']['currentState'],
      evidenceHistoryCount: valueOf(bridgeRecord, 'evidenceHistoryCount') as number,
      evidenceHistoryState: valueOf(bridgeRecord, 'evidenceHistoryState') as 'COMPLETE' | 'TRUNCATED',
      attention,
      thesis,
      forensics,
      reasonCodes: bridgeReasons,
    },
    authority: 'EVIDENCE_ONLY',
    liveMoneyAuthority: 'NONE',
  };
}

export function parseTokenNewsContext(value: unknown, evaluatedAtMs: number): TokenNewsContext | null {
  const record = dataRecord(value, ['source', 'fetchedAt', 'items', 'sources']);
  if (!record || valueOf(record, 'source') !== 'primary+venue+protocol+issuer+tree+rss+lookonchain'
      || !safeTime(evaluatedAtMs) || !safeTime(valueOf(record, 'fetchedAt'))
      || (valueOf(record, 'fetchedAt') as number) > evaluatedAtMs) return null;
  const rootFetchedAt = valueOf(record, 'fetchedAt') as number;
  const rawItems = denseArray(valueOf(record, 'items'), 600);
  const rawSources = denseArray(valueOf(record, 'sources'), 128);
  if (!rawItems || !rawSources) return null;
  const items: TokenNewsContext['items'] = [];
  for (const raw of rawItems) {
    const item = dataRecord(raw);
    if (!item) return null;
    const id = valueOf(item, 'id');
    const title = valueOf(item, 'title');
    const source = valueOf(item, 'source');
    const sourceKey = valueOf(item, 'sourceKey');
    const channel = valueOf(item, 'channel');
    const ts = valueOf(item, 'ts');
    const symbols = strings(valueOf(item, 'symbols'), 64);
    if (!boundedString(id) || !boundedString(title, 512) || !boundedString(source)
        || !boundedString(sourceKey) || !boundedString(channel, 64) || !nullableTime(ts)
        || ts !== null && ts > rootFetchedAt || symbols === null
        || symbols.some((symbol) => !/^[A-Z0-9]{2,20}$/.test(symbol))) return null;
    items.push({ id, title, source, sourceKey, channel, ts, symbols });
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) return null;
  const sources: TokenNewsContext['sources'] = [];
  for (const raw of rawSources) {
    const source = dataRecord(raw);
    if (!source) return null;
    const key = valueOf(source, 'key');
    const status = valueOf(source, 'status');
    const fetchedAt = valueOf(source, 'fetchedAt');
    if (!boundedString(key) || !stringIn(status, ['live', 'delayed', 'error']) || !nullableTime(fetchedAt)
        || fetchedAt !== null && fetchedAt > rootFetchedAt
        || status === 'live' && fetchedAt === null) return null;
    sources.push({ key, status: status as 'live' | 'delayed' | 'error', fetchedAt });
  }
  if (new Set(sources.map((source) => source.key)).size !== sources.length) return null;
  return {
    fetchedAt: rootFetchedAt,
    freshness: evaluatedAtMs - rootFetchedAt <= TOKEN_NEWS_MAX_AGE_MS ? 'FRESH' : 'STALE',
    items,
    sources,
  };
}
