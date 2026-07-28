import type { BasisRow, BasisSnapshot } from '../lib/basisRuntime';

export interface VolumeWindowMetric {
  quoteVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  priceMovePct: number;
  takerBuyRatio: number | null;
  largeTradeCount: number;
}

export interface VolumeBaselineMetric {
  ready: boolean;
  samples: number;
  confidence: number;
  quotePerSecNorm: number;
  tradesPerSecNorm: number;
  quotePerMinMedian: number;
  quotePerMinMad: number;
  isDead: boolean;
}

export interface VolumeRuntimeRow {
  symbol: string;
  base: string;
  state: 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';
  price: number | null;
  lastTradeTs: number | null;
  baseline: VolumeBaselineMetric;
  windows: Record<string, VolumeWindowMetric | undefined>;
  volumeMultiple: Record<string, number | null | undefined>;
  tradeCountMultiple: Record<string, number | null | undefined>;
  spreadBps: number | null;
  topDepthUsd: number | null;
  depthScore: number | null;
  depthVsNorm: number | null;
  takerBuyRatio: number | null;
  washScore: number | null;
  accelerationPctPerMin: number | null;
  focusReason: string | null;
  focusAgeMs: number;
  decisionKind: 'ignore' | 'watch' | 'focus' | 'proposal' | 'reject' | 'warming';
  rejectCode: string | null;
  reason: string;
  correlationId: string | null;
  decisionTs: number | null;
  proposal: {
    id: string;
    status: 'open' | 'updated' | 'expired' | 'rejected' | 'approved_manual';
    direction: 'long' | 'short';
    confidence: number | null;
    reason: string;
  } | null;
}

export interface VolumeRuntimeSnapshot {
  updatedAt: number;
  status: {
    running: boolean;
    streamState: 'starting' | 'connecting' | 'open' | 'degraded';
    streamConnections: number;
    openConnections: number;
    bookState: 'fresh' | 'stale';
    universeSize: number;
    eligibleSize: number;
    observedSymbols: number;
    baselineReady: number;
    baselineTotal: number;
    baselineCompleted: number;
    baselineFailed: number;
    watching: number;
    focused: number;
    openProposals: number;
    lastTradeTs: number | null;
    lastBookTs: number | null;
    tradeMessages: number;
    source: string;
    bookSource: string;
    baselineSource: string;
  };
  thresholds: {
    volume1s: number;
    volume5s: number;
    tradeCount: number;
    followthroughPct: number;
    maxSpreadBps: number;
    minDepthScore: number;
    baselineMinutes: number;
  };
  rows: VolumeRuntimeRow[];
}

export interface DashboardPnlData {
  realizedByDay: { day: string; usd: number }[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  integrity: {
    state: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
    complete: boolean;
    reasons: string[];
  };
}

export const MONEY_SURFACE_SOURCE_FRESH_MS = 10_000;
const VOLUME_OBSERVED_FRESH_MS = 60_000;
const VOLUME_MAX_FUTURE_SKEW_MS = 5_000;

type PlainRecord = Record<string, unknown>;

const BASIS_STATES = new Set<BasisRow['state']>([
  'IDLE', 'WATCHING', 'FOCUS', 'PROPOSED', 'REJECTED', 'ACTIVE', 'COOLDOWN',
]);
const BASIS_DIRECTIONS = new Set<BasisRow['direction']>([
  'long_spot_short_perp', 'short_spot_long_perp',
]);
const BASIS_DECISIONS = new Set<BasisRow['decisionKind']>([
  'ignore', 'watch', 'focus', 'proposal', 'reject',
]);
const VOLUME_DECISIONS = new Set<VolumeRuntimeRow['decisionKind']>([
  'ignore', 'watch', 'focus', 'proposal', 'reject', 'warming',
]);
const VOLUME_PROPOSAL_STATUSES = new Set<NonNullable<VolumeRuntimeRow['proposal']>['status']>([
  'open', 'updated', 'expired', 'rejected', 'approved_manual',
]);

export function hasAttachedOpenProposal(row: {
  proposal: { status: string } | null;
}): boolean {
  return row.proposal !== null
    && (row.proposal.status === 'open' || row.proposal.status === 'updated');
}

function record(value: unknown): PlainRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as PlainRecord
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || finiteNumber(value);
}

function nonnegativeNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && !Object.is(value, -0);
}

function nonnegativeOrNull(value: unknown): value is number | null {
  return value === null || nonnegativeNumber(value);
}

function unitInterval(value: unknown): value is number {
  return nonnegativeNumber(value) && value <= 1;
}

function unitIntervalOrNull(value: unknown): value is number | null {
  return value === null || unitInterval(value);
}

function timestampOrNull(value: unknown): value is number | null {
  return value === null || (
    Number.isSafeInteger(value)
    && (value as number) >= 0
    && !Object.is(value, -0)
  );
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0);
}

function text(value: unknown, maximum = 2_048): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function textOrNull(value: unknown, maximum = 2_048): value is string | null {
  return value === null || text(value, maximum);
}

function basisIdentity(symbol: unknown, base: unknown): boolean {
  return typeof base === 'string'
    && /^[A-Z0-9]{1,16}$/.test(base)
    && symbol === `${base}USDT`;
}

function volumeSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{1,32}$/.test(value);
}

function volumeBase(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 24;
}

function pnlSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{1,16}USDT$/.test(value);
}

function pnlFeeAsset(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && [...value].length <= 20
    && new TextEncoder().encode(value).byteLength <= 80
    && !/[\/\\\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(value);
}

function nonnegativeNumericMap(value: unknown): boolean {
  const candidate = record(value);
  return candidate !== null
    && Object.keys(candidate).length <= 64
    && Object.values(candidate).every((entry) => entry === null || nonnegativeNumber(entry));
}

function uniqueSymbols(rows: readonly { symbol: string }[]): boolean {
  return new Set(rows.map((row) => row.symbol)).size === rows.length;
}

function timestampAtOrBefore(timestamp: number | null, upperBound: number): boolean {
  return timestamp === null || timestamp <= upperBound;
}

function sourceFreshAt(timestamp: number | null, nowMs: number, maximumAgeMs = MONEY_SURFACE_SOURCE_FRESH_MS): boolean {
  if (timestamp === null || !timestampOrNull(timestamp) || !timestampOrNull(nowMs)) return false;
  const ageMs = nowMs - timestamp;
  return ageMs >= 0 && ageMs < maximumAgeMs;
}

function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function totalsCoherent(left: number, right: number): boolean {
  const tolerance = 1e-9 + 1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= tolerance;
}

function basisRow(value: unknown): value is BasisRow {
  const row = record(value);
  const costs = record(row?.costs);
  const quality = record(row?.dataQuality);
  const borrow = record(row?.borrow);
  const priority = row?.priority === null ? null : record(row?.priority);
  const proposal = row?.proposal === null ? null : record(row?.proposal);
  if (!row || !costs || !quality || !borrow) return false;
  if (!basisIdentity(row.symbol, row.base)
      || !BASIS_STATES.has(row.state as BasisRow['state'])
      || !BASIS_DIRECTIONS.has(row.direction as BasisRow['direction'])
      || !BASIS_DECISIONS.has(row.decisionKind as BasisRow['decisionKind'])
      || !text(row.reason)
      || !textOrNull(row.rejectCode, 160)
      || !textOrNull(row.correlationId, 256)
      || !timestampOrNull(row.decisionTs)
      || typeof row.ladderBacked !== 'boolean') return false;
  for (const key of ['spotBid', 'spotAsk', 'perpBid', 'perpAsk', 'markPrice'] as const) {
    if (!nonnegativeOrNull(row[key])) return false;
  }
  for (const key of [
    'spotSpreadBps', 'perpSpreadBps', 'quoteVolume24h', 'gapAgeMs',
    'gapStabilityCv', 'bookPressure',
  ] as const) if (!nonnegativeOrNull(row[key])) return false;
  for (const key of [
    'executableGapPct', 'alternateGapPct', 'gapSlopePctPerMin', 'fundingRate',
    'fundingCarryPct', 'netEdgePct',
  ] as const) if (!finiteOrNull(row[key])) return false;
  if (!timestampOrNull(row.nextFundingTs)
      || !unitIntervalOrNull(row.fundingFlipRisk)
      || !unitIntervalOrNull(row.depthScore)
      || !nonnegativeInteger(row.persistTicks)
      || !nonnegativeNumber(row.expectedHoldMs)
      || !nonnegativeNumber(row.slippagePct)) return false;
  for (const key of ['feesPct', 'slippagePct', 'fundingDragPct', 'borrowCostPct', 'totalPct'] as const) {
    if (!nonnegativeNumber(costs[key])) return false;
  }
  if (!unitInterval(quality.score)
      || !nonnegativeOrNull(quality.spotStalenessMs)
      || !nonnegativeOrNull(quality.perpStalenessMs)
      || !nonnegativeOrNull(quality.legSkewMs)
      || !nonnegativeOrNull(quality.markDivergenceBps)
      || !Array.isArray(quality.suspectReasons)
      || quality.suspectReasons.length > 128
      || !quality.suspectReasons.every((entry) => text(entry, 256))) return false;
  if (!new Set(['not_needed', 'unknown', 'available', 'unavailable']).has(String(borrow.status))
      || typeof borrow.ok !== 'boolean'
      || !textOrNull(borrow.rejectCode, 160)
      || !text(borrow.human)
      || !nonnegativeNumber(borrow.costPctOverHold)) return false;
  if ((row.decisionKind === 'reject') !== (row.rejectCode !== null)) return false;
  if (priority !== null && !nonnegativeNumber(priority.score)) return false;
  if (proposal !== null) {
    const stagedSizes = proposal.stagedSizes;
    if (!text(proposal.id, 256)
        || (proposal.status !== 'open' && proposal.status !== 'updated')
        || !finiteOrNull(proposal.netEdgePct)
        || !unitIntervalOrNull(proposal.confidence)
        || !textOrNull(proposal.invalidation)
        || !Array.isArray(stagedSizes)
        || stagedSizes.length > 64
        || !stagedSizes.every((entry) => {
          const stage = record(entry);
          return stage !== null
            && nonnegativeInteger(stage.stage)
            && unitInterval(stage.fraction)
            && stage.fraction > 0
            && nonnegativeNumber(stage.notionalUsd);
        })) return false;
  }
  return true;
}

function volumeWindow(value: unknown): value is VolumeWindowMetric {
  const window = record(value);
  return window !== null
    && nonnegativeNumber(window.quoteVolume)
    && nonnegativeInteger(window.tradeCount)
    && nonnegativeNumber(window.avgTradeSize)
    && finiteNumber(window.priceMovePct)
    && unitIntervalOrNull(window.takerBuyRatio)
    && nonnegativeInteger(window.largeTradeCount);
}

function volumeRow(value: unknown): value is VolumeRuntimeRow {
  const row = record(value);
  const baseline = record(row?.baseline);
  const windows = record(row?.windows);
  const volumeMultiple = record(row?.volumeMultiple);
  const tradeCountMultiple = record(row?.tradeCountMultiple);
  const proposal = row?.proposal === null ? null : record(row?.proposal);
  if (!row || !baseline || !windows || !volumeMultiple || !tradeCountMultiple) return false;
  if (!volumeSymbol(row.symbol)
      || !volumeBase(row.base)
      || !BASIS_STATES.has(row.state as BasisRow['state'])
      || !nonnegativeOrNull(row.price)
      || !timestampOrNull(row.lastTradeTs)
      || !VOLUME_DECISIONS.has(row.decisionKind as VolumeRuntimeRow['decisionKind'])
      || !text(row.reason)
      || !textOrNull(row.focusReason)
      || !textOrNull(row.rejectCode, 160)
      || !textOrNull(row.correlationId, 256)
      || !timestampOrNull(row.decisionTs)
      || !nonnegativeNumber(row.focusAgeMs)) return false;
  if (typeof baseline.ready !== 'boolean'
      || !nonnegativeInteger(baseline.samples)
      || !unitInterval(baseline.confidence)
      || !nonnegativeNumber(baseline.quotePerSecNorm)
      || !nonnegativeNumber(baseline.tradesPerSecNorm)
      || !nonnegativeNumber(baseline.quotePerMinMedian)
      || !nonnegativeNumber(baseline.quotePerMinMad)
      || typeof baseline.isDead !== 'boolean'
      || (baseline.isDead && !baseline.ready)) return false;
  if (Object.keys(windows).length > 64
      || !Object.values(windows).every((entry) => entry === undefined || volumeWindow(entry))
      || !nonnegativeNumericMap(volumeMultiple)
      || !nonnegativeNumericMap(tradeCountMultiple)
      || (!baseline.ready && (
        Object.values(volumeMultiple).some((entry) => entry !== null)
        || Object.values(tradeCountMultiple).some((entry) => entry !== null)
      ))) return false;
  for (const key of ['spreadBps', 'topDepthUsd', 'depthVsNorm'] as const) {
    if (!nonnegativeOrNull(row[key])) return false;
  }
  if (!unitIntervalOrNull(row.depthScore)
      || !unitIntervalOrNull(row.takerBuyRatio)
      || !unitIntervalOrNull(row.washScore)
      || !finiteOrNull(row.accelerationPctPerMin)
      || (row.decisionKind === 'reject') !== (row.rejectCode !== null)
      || (row.decisionKind === 'warming' && baseline.ready)) return false;
  if (proposal !== null
      && (!text(proposal.id, 256)
        || !VOLUME_PROPOSAL_STATUSES.has(proposal.status as NonNullable<VolumeRuntimeRow['proposal']>['status'])
        || (proposal.direction !== 'long' && proposal.direction !== 'short')
        || !unitIntervalOrNull(proposal.confidence)
        || !text(proposal.reason))) return false;
  return true;
}

export function decodeBasisRuntimeSnapshot(value: unknown): BasisSnapshot | null {
  const snapshot = record(value);
  const status = record(snapshot?.status);
  const thresholds = record(snapshot?.thresholds);
  if (!snapshot || !status || !thresholds || !timestampOrNull(snapshot.updatedAt) || snapshot.updatedAt === null) return null;
  const updatedAt = snapshot.updatedAt as number;
  if (typeof status.running !== 'boolean'
      || !new Set(['fresh', 'stale']).has(String(status.bookState))
      || !new Set(['fresh', 'stale']).has(String(status.markState))
      || !textOrNull(status.lastError)
      || !text(status.bookSource, 256)
      || !text(status.markSource, 256)
      || !text(status.borrowSource, 256)
      || !timestampOrNull(status.lastBookTs)
      || !timestampOrNull(status.lastMarkTs)
      || !timestampOrNull(status.lastTickTs)) return null;
  for (const key of [
      'universeSize', 'watching', 'focused', 'openProposals', 'rejected',
      'borrowBlocked', 'verifiedBorrow', 'dataQualityPassing', 'ticks',
  ] as const) if (!nonnegativeInteger(status[key])) return null;
  for (const key of ['watchGapPct', 'focusGapPct', 'minNetBasisPct', 'feesPct', 'maxSpreadBps', 'intendedNotionalUsd'] as const) {
    if (!nonnegativeNumber(thresholds[key])) return null;
  }
  if (!nonnegativeInteger(thresholds.persistTicks)
      || !unitInterval(thresholds.minDepthScore)
      || !unitInterval(thresholds.minDataQuality)
      || (thresholds.focusGapPct as number) < (thresholds.watchGapPct as number)
      || !(thresholds.minQuoteVolume24hUsd === undefined || nonnegativeNumber(thresholds.minQuoteVolume24hUsd))
      || !timestampAtOrBefore(status.lastBookTs as number | null, updatedAt)
      || !timestampAtOrBefore(status.lastMarkTs as number | null, updatedAt)
      || !timestampAtOrBefore(status.lastTickTs as number | null, updatedAt)
      || (status.bookState === 'fresh' && !sourceFreshAt(status.lastBookTs as number | null, updatedAt))
      || (status.markState === 'fresh' && !sourceFreshAt(status.lastMarkTs as number | null, updatedAt))
      || !Array.isArray(snapshot.rows)
      || snapshot.rows.length > 4_096
      || !snapshot.rows.every(basisRow)
      || status.universeSize !== snapshot.rows.length) return null;
  const rows = snapshot.rows as unknown as BasisRow[];
  if (!uniqueSymbols(rows)
      || rows.some((row) => !timestampAtOrBefore(row.decisionTs, updatedAt))
      || status.watching !== rows.filter((row) => row.state === 'WATCHING').length
      || status.focused !== rows.filter((row) => row.state === 'FOCUS').length
      || status.openProposals !== rows.filter((row) => row.state === 'PROPOSED').length
      || status.rejected !== rows.filter((row) => row.decisionKind === 'reject').length
      || status.borrowBlocked !== rows.filter((row) => row.rejectCode?.startsWith('borrow_')).length
      || status.verifiedBorrow !== rows.filter((row) => row.borrow.status === 'available' && row.borrow.ok).length
      || status.dataQualityPassing !== rows.filter((row) => row.dataQuality.score >= (thresholds.minDataQuality as number)).length) {
    return null;
  }
  return snapshot as unknown as BasisSnapshot;
}

export function decodeVolumeRuntimeSnapshot(value: unknown): VolumeRuntimeSnapshot | null {
  const snapshot = record(value);
  const status = record(snapshot?.status);
  const thresholds = record(snapshot?.thresholds);
  if (!snapshot || !status || !thresholds || !timestampOrNull(snapshot.updatedAt) || snapshot.updatedAt === null) return null;
  const updatedAt = snapshot.updatedAt as number;
  if (typeof status.running !== 'boolean'
      || !new Set(['starting', 'connecting', 'open', 'degraded']).has(String(status.streamState))
      || !new Set(['fresh', 'stale']).has(String(status.bookState))
      || !timestampOrNull(status.lastTradeTs)
      || !timestampOrNull(status.lastBookTs)
      || !text(status.source, 256)
      || !text(status.bookSource, 256)
      || !text(status.baselineSource, 256)) return null;
  for (const key of [
    'streamConnections', 'openConnections', 'universeSize', 'eligibleSize',
    'observedSymbols', 'baselineReady', 'baselineTotal', 'baselineCompleted',
      'baselineFailed', 'watching', 'focused', 'openProposals', 'tradeMessages',
  ] as const) if (!nonnegativeInteger(status[key])) return null;
  for (const key of ['volume1s', 'volume5s', 'tradeCount', 'followthroughPct', 'maxSpreadBps'] as const) {
    if (!nonnegativeNumber(thresholds[key])) return null;
  }
  if (!unitInterval(thresholds.minDepthScore)
      || !nonnegativeInteger(thresholds.baselineMinutes)
      || !timestampAtOrBefore(status.lastTradeTs as number | null, updatedAt + VOLUME_MAX_FUTURE_SKEW_MS)
      || !timestampAtOrBefore(status.lastBookTs as number | null, updatedAt)
      || (status.bookState === 'fresh' && !sourceFreshAt(status.lastBookTs as number | null, updatedAt))
      || !Array.isArray(snapshot.rows)
      || snapshot.rows.length > 4_096
      || !snapshot.rows.every(volumeRow)) return null;
  const rows = snapshot.rows as unknown as VolumeRuntimeRow[];
  const fullCoverage = rows.length === (status.eligibleSize as number);
  const observedRows = rows.filter((row) => (
    row.lastTradeTs !== null
    && updatedAt - row.lastTradeTs < VOLUME_OBSERVED_FRESH_MS
  )).length;
  const watchingRows = rows.filter((row) => row.state === 'WATCHING').length;
  const focusedRows = rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length;
  const activeRows = rows.filter((row) => row.state === 'ACTIVE').length;
  const hiddenRows = activeRows + Math.max(0, (status.eligibleSize as number) - rows.length);
  const openProposalRows = rows.filter(hasAttachedOpenProposal).length;
  if (!uniqueSymbols(rows)
      || rows.some((row) => (
        !timestampAtOrBefore(row.lastTradeTs, updatedAt + VOLUME_MAX_FUTURE_SKEW_MS)
        || !timestampAtOrBefore(row.decisionTs, updatedAt)
        || row.baseline.ready !== (row.baseline.samples >= (thresholds.baselineMinutes as number))
      ))
      || rows.length > (status.eligibleSize as number)
      || (status.baselineTotal as number) !== (status.eligibleSize as number)
      || (status.baselineReady as number) !== rows.filter((row) => row.baseline.ready).length
      || observedRows > (status.observedSymbols as number)
      || watchingRows > (status.watching as number)
      || focusedRows > (status.focused as number)
      || (
        (status.watching as number) - watchingRows
        + (status.focused as number) - focusedRows
        > activeRows + ((status.eligibleSize as number) - rows.length)
      )
      || (status.watching as number) > watchingRows + hiddenRows
      || (status.focused as number) > focusedRows + hiddenRows
      || openProposalRows > (status.openProposals as number)
      || (fullCoverage && (
        (status.observedSymbols as number) !== observedRows
        || (status.openProposals as number) !== openProposalRows
      ))
      || (status.openConnections as number) > (status.streamConnections as number)
      || (status.eligibleSize as number) > (status.universeSize as number)
      || (status.observedSymbols as number) > (status.eligibleSize as number)
      || (status.baselineReady as number) > (status.baselineTotal as number)
      || (status.baselineCompleted as number) > (status.baselineTotal as number)
      || (status.baselineFailed as number) > (status.baselineTotal as number)
      || (status.baselineCompleted as number) + (status.baselineFailed as number) > (status.baselineTotal as number)
      || (status.watching as number) > (status.eligibleSize as number)
      || (status.focused as number) > (status.eligibleSize as number)
      || (status.openProposals as number) > (status.eligibleSize as number)) return null;
  return snapshot as unknown as VolumeRuntimeSnapshot;
}

export function decodeDashboardPnlData(value: unknown): DashboardPnlData | null {
  const payload = record(value);
  const integrity = record(payload?.integrity);
  if (!payload
      || !integrity
      || !Array.isArray(payload.realizedByDay)
      || !Array.isArray(payload.realizedBySymbol)
      || !Array.isArray(payload.feesByAsset)
      || payload.realizedByDay.length > 10_000
      || payload.realizedBySymbol.length > 10_000
      || payload.feesByAsset.length > 1_000
      || !new Set(['COMPLETE', 'PARTIAL', 'UNKNOWN']).has(String(integrity.state))
      || typeof integrity.complete !== 'boolean'
      || !Array.isArray(integrity.reasons)
      || integrity.reasons.length > 1_000
      || !integrity.reasons.every((entry) => text(entry, 512))) return null;
  if ((integrity.state === 'COMPLETE') !== integrity.complete
      || (integrity.state === 'COMPLETE' && integrity.reasons.length !== 0)
      || (integrity.state !== 'COMPLETE' && integrity.reasons.length === 0)) return null;
  if (!payload.realizedByDay.every((entry) => {
    const row = record(entry);
    return row !== null
      && calendarDay(row.day)
      && finiteNumber(row.usd);
  })) return null;
  if (!payload.realizedBySymbol.every((entry) => {
    const row = record(entry);
    return row !== null && pnlSymbol(row.symbol) && finiteNumber(row.usd);
  })) return null;
  if (!payload.feesByAsset.every((entry) => {
    const row = record(entry);
    return row !== null
      && pnlFeeAsset(row.asset)
      && nonnegativeNumber(row.amount);
  })) return null;
  const days = payload.realizedByDay.map((entry) => (entry as PlainRecord).day);
  const symbols = payload.realizedBySymbol.map((entry) => (entry as PlainRecord).symbol);
  const assets = payload.feesByAsset.map((entry) => (entry as PlainRecord).asset);
  if (new Set(days).size !== days.length
      || new Set(symbols).size !== symbols.length
      || new Set(assets).size !== assets.length) return null;
  if ((payload.realizedByDay.length === 0) !== (payload.realizedBySymbol.length === 0)
      || (
        integrity.state === 'COMPLETE'
        && payload.realizedByDay.length === 0
        && payload.realizedBySymbol.length === 0
        && payload.feesByAsset.length === 0
      )) return null;
  if (payload.realizedByDay.length > 0 && payload.realizedBySymbol.length > 0) {
    const dayTotal = payload.realizedByDay.reduce(
      (sum, entry) => sum + ((entry as PlainRecord).usd as number),
      0,
    );
    const symbolTotal = payload.realizedBySymbol.reduce(
      (sum, entry) => sum + ((entry as PlainRecord).usd as number),
      0,
    );
    if (!finiteNumber(dayTotal) || !finiteNumber(symbolTotal) || !totalsCoherent(dayTotal, symbolTotal)) return null;
  }
  return payload as unknown as DashboardPnlData;
}

export function basisRuntimeCurrent(snapshot: BasisSnapshot, nowMs = Date.now()): boolean {
  return snapshot.rows.every((row) => (row.state === 'PROPOSED') === hasAttachedOpenProposal(row))
    && snapshot.status.running
    && snapshot.status.bookState === 'fresh'
    && snapshot.status.markState === 'fresh'
    && snapshot.status.lastError === null
    && timestampAtOrBefore(snapshot.status.lastBookTs, snapshot.updatedAt)
    && timestampAtOrBefore(snapshot.status.lastMarkTs, snapshot.updatedAt)
    && sourceFreshAt(snapshot.updatedAt, nowMs)
    && sourceFreshAt(snapshot.status.lastBookTs, nowMs)
    && sourceFreshAt(snapshot.status.lastMarkTs, nowMs);
}

export function volumeRuntimeCurrent(snapshot: VolumeRuntimeSnapshot, nowMs = Date.now()): boolean {
  return uniqueSymbols(snapshot.rows)
    && snapshot.rows.length === snapshot.status.eligibleSize
    && snapshot.rows.every((row) => (row.state === 'PROPOSED') === hasAttachedOpenProposal(row))
    && snapshot.rows.every((row) => timestampAtOrBefore(row.lastTradeTs, snapshot.updatedAt))
    && snapshot.status.running
    && snapshot.status.streamState === 'open'
    && snapshot.status.streamConnections > 0
    && snapshot.status.openConnections === snapshot.status.streamConnections
    && snapshot.status.bookState === 'fresh'
    && snapshot.status.eligibleSize > 0
    && snapshot.status.observedSymbols === snapshot.status.eligibleSize
    && snapshot.status.tradeMessages > 0
    && timestampAtOrBefore(snapshot.status.lastTradeTs, snapshot.updatedAt)
    && timestampAtOrBefore(snapshot.status.lastBookTs, snapshot.updatedAt)
    && sourceFreshAt(snapshot.updatedAt, nowMs)
    && sourceFreshAt(snapshot.status.lastTradeTs, nowMs)
    && sourceFreshAt(snapshot.status.lastBookTs, nowMs);
}
