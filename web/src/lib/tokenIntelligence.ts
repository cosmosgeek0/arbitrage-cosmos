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
    reasonCodes: string[];
  };
  authority: 'EVIDENCE_ONLY';
  liveMoneyAuthority: 'NONE';
}

export interface SymbolAccountContext {
  accountTruthState: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  orderTruthState: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  borrowTruthState: BorrowTruthState;
  openOrders: unknown[] | null;
  balances: { base: number; usdtFree: number } | null;
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

export type BorrowTruthState = 'UNKNOWN' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

type DataRecord = Readonly<Record<string, PropertyDescriptor>>;

function dataRecord(value: unknown, exactKeys?: readonly string[]): DataRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  try {
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
    if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype
        || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    }
    if (Object.keys(descriptors).filter((key) => key !== 'length').length !== value.length) return null;
    return value;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value;
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
  if (!['FRESH', 'STALE', 'MISSING', 'UNAVAILABLE'].includes(String(state))
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
      || !['FRESH', 'STALE', 'MISSING'].includes(String(freshness))
      || !['COMPLETE', 'PARTIAL', 'SAMPLED', 'MISSING'].includes(String(completeness))
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
  if (instrumentId !== expectedInstrumentId
      || !boundedString(hypothesis, 128) || !TOKEN_HYPOTHESES.includes(hypothesis)
      || !boundedString(stage, 128) || !TOKEN_MARKET_STAGES.includes(stage)
      || !(changedFirst === null || boundedString(changedFirst, 128))
      || !nullableTime(changedAtMs) || changedAtMs !== null && changedAtMs > observedAtMs
      || !['SPOT', 'PERPETUAL', 'NEITHER', 'UNKNOWN'].includes(String(leadMarket))
      || reasonCodes === null) return null;
  return {
    hypothesis,
    stage,
    changedFirst,
    changedAtMs,
    leadMarket: leadMarket as TokenThesisView['leadMarket'],
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
        || !['open', 'connecting', 'closed', 'cooldown', 'exhausted', 'missing'].includes(String(valueOf(record, 'feedState')))) return null;
    return { connected: valueOf(record, 'connected') as boolean, feedState: valueOf(record, 'feedState') as TokenIntelligenceRead['projection']['usdm']['feedState'] };
  };
  if (!projection || !['ACTIVE', 'DEGRADED', 'NOT_RUNNING'].includes(String(valueOf(projection, 'state')))) return null;
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
      || !['COMPLETE', 'TRUNCATED'].includes(String(valueOf(bridgeRecord, 'evidenceHistoryState')))
      || !['CURRENT', 'HISTORICAL_ONLY'].includes(String(valueOf(bridgeRecord, 'currentState')))
      || valueOf(bridgeRecord, 'authority') !== 'EVIDENCE_ONLY'
      || valueOf(bridgeRecord, 'liveMoneyAuthority') !== 'NONE') return null;
  const bridgeReasons = strings(valueOf(bridgeRecord, 'reasonCodes'));
  if (bridgeReasons === null) return null;
  const featureSnapshot = valueOf(bridgeRecord, 'featureSnapshot');
  const attentionValue = valueOf(bridgeRecord, 'attention');
  const artifactValue = valueOf(bridgeRecord, 'artifact');
  if (!(featureSnapshot === null || dataRecord(featureSnapshot))
      || !(attentionValue === null || dataRecord(attentionValue))
      || !(artifactValue === null || dataRecord(artifactValue))) return null;
  if (featureSnapshot !== null && valueOf(dataRecord(featureSnapshot)!, 'symbol') !== expectedSymbol) return null;
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
    if (thesis === null) return null;
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
      reasonCodes: bridgeReasons,
    },
    authority: 'EVIDENCE_ONLY',
    liveMoneyAuthority: 'NONE',
  };
}

export function parseSymbolAccountContext(value: unknown): SymbolAccountContext | null {
  const record = dataRecord(value);
  if (!record) return null;
  const accountTruthState = valueOf(record, 'accountTruthState');
  const orderTruthState = valueOf(record, 'orderTruthState');
  const borrowTruthState = valueOf(record, 'borrowTruthState');
  if (!['AVAILABLE', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(String(accountTruthState))
      || !['AVAILABLE', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(String(orderTruthState))
      || !['UNKNOWN', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(String(borrowTruthState))) return null;
  const rawOrders = valueOf(record, 'openOrders');
  const openOrders = rawOrders === null ? null : denseArray(rawOrders, 2_000);
  if (rawOrders !== null && openOrders === null) return null;
  const rawBalances = valueOf(record, 'balances');
  let balances: SymbolAccountContext['balances'] = null;
  if (rawBalances !== null) {
    const balanceRecord = dataRecord(rawBalances, ['base', 'usdtFree']);
    const base = balanceRecord ? valueOf(balanceRecord, 'base') : null;
    const usdtFree = balanceRecord ? valueOf(balanceRecord, 'usdtFree') : null;
    if (!balanceRecord || !finite(base) || base < 0 || !finite(usdtFree) || usdtFree < 0) return null;
    balances = { base, usdtFree };
  }
  if (accountTruthState !== 'AVAILABLE' && balances !== null) return null;
  if (orderTruthState !== 'AVAILABLE' && openOrders !== null) return null;
  return {
    accountTruthState: accountTruthState as SymbolAccountContext['accountTruthState'],
    orderTruthState: orderTruthState as SymbolAccountContext['orderTruthState'],
    borrowTruthState: borrowTruthState as BorrowTruthState,
    openOrders,
    balances,
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
    if (!boundedString(key) || !['live', 'delayed', 'error'].includes(String(status)) || !nullableTime(fetchedAt)
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
