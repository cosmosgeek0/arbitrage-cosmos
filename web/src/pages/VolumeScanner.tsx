import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  ChevronDown,
  Eye,
  Radio,
  Search,
  Star,
  X,
} from 'lucide-react';
import { TokenIcon } from '../components/TokenIcon';
import { fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import {
  parseTokenIntelligence,
  type TokenIntelligenceRead,
} from '../lib/tokenIntelligence';
import {
  projectVolumeWorkspaceTruth,
} from '../lib/volumeWorkspaceTruth';
import { projectPrivateRead } from '../lib/privateRead';
import { resolveMarketFreshness, useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import './VolumeScanner.css';

type Filter = 'all' | 'watching' | 'focus' | 'rejected' | 'warming';

interface WindowMetric {
  quoteVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  priceMovePct: number;
  takerBuyRatio: number | null;
  largeTradeCount: number;
}

interface BaselineMetric {
  ready: boolean;
  samples: number;
  confidence: number;
  quotePerSecNorm: number;
  tradesPerSecNorm: number;
  quotePerMinMedian: number;
  quotePerMinMad: number;
  isDead: boolean;
}

interface VolumeRow {
  symbol: string;
  base: string;
  state: 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';
  price: number | null;
  lastTradeTs: number | null;
  baseline: BaselineMetric;
  windows: Record<string, WindowMetric | undefined>;
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

interface VolumeSnapshot {
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
  rows: VolumeRow[];
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Symbols' },
  { id: 'watching', label: 'Watching' },
  { id: 'focus', label: 'Focused' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'warming', label: 'Warming' },
];

const VOLUME_RUNTIME_FRESH_MS = 10_000;
const VOLUME_OBSERVED_FRESH_MS = 60_000;
const VOLUME_MAX_FUTURE_SKEW_MS = 5_000;
const VOLUME_STATES = new Set<VolumeRow['state']>([
  'IDLE',
  'WATCHING',
  'FOCUS',
  'PROPOSED',
  'REJECTED',
  'ACTIVE',
  'COOLDOWN',
]);
const VOLUME_DECISIONS = new Set<VolumeRow['decisionKind']>([
  'ignore',
  'watch',
  'focus',
  'proposal',
  'reject',
  'warming',
]);
const VOLUME_PROPOSAL_STATUSES = new Set<NonNullable<VolumeRow['proposal']>['status']>([
  'open',
  'updated',
  'expired',
  'rejected',
  'approved_manual',
]);

export const VOLUME_RESEARCH_TRUTH = Object.freeze({
  evidenceKind: 'FROZEN_ACCEPTED_RESEARCH',
  sourceCommit: '88751475d2b4f30b080ac947f478a4bbc38cbbdf',
  terminalBlob: '26a8c1b068bdd9a63c0b1f9ea8e9b232c4b8aca8',
  testStatus: 'INVALID_TEST',
  measurementStatus: 'UNMEASURED',
  goNoGo: 'NOT_APPLICABLE',
  economics: Object.freeze({
    eventSample: null,
    netSyntheticUsdtPer1000: null,
    netUsdPer1000: null,
    confidenceInterval95: null,
    drawdown: null,
  }),
  accountEffectiveFees: 'UNKNOWN',
  capacity: 'UNKNOWN',
  executionAuthority: 'NONE',
  repairAuthority: 'NONE',
  rerunAuthority: 'NONE',
  reasonCodes: Object.freeze([
    'SOURCE_DUPLICATE_KLINE_OPEN_TIME_REPORTED',
    'SOURCE_OUT_OF_ORDER_KLINE_OPEN_TIME_REPORTED',
    'UNAUTHORIZED_SOURCE_CANONICALIZATION',
  ]),
});

type PlainRecord = Record<string, unknown>;

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

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0);
}

function unitInterval(value: unknown): value is number {
  return nonnegativeNumber(value) && value <= 1;
}

function unitIntervalOrNull(value: unknown): value is number | null {
  return value === null || unitInterval(value);
}

function timestampOrNull(value: unknown): value is number | null {
  return value === null || nonnegativeInteger(value);
}

function text(value: unknown, maximum = 2_048): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function textOrNull(value: unknown, maximum = 2_048): value is string | null {
  return value === null || text(value, maximum);
}

function volumeSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{1,32}$/.test(value);
}

function volumeBase(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 24;
}

function nonnegativeNumericMap(value: unknown): boolean {
  const candidate = record(value);
  return candidate !== null
    && Object.keys(candidate).length <= 64
    && Object.values(candidate).every((entry) => entry === null || nonnegativeNumber(entry));
}

function timestampAtOrBefore(timestamp: number | null, upperBound: number): boolean {
  return timestamp === null || timestamp <= upperBound;
}

function hasAttachedOpenProposal(row: Pick<VolumeRow, 'proposal'>): boolean {
  return row.proposal !== null
    && (row.proposal.status === 'open' || row.proposal.status === 'updated');
}

function volumeWindow(value: unknown): value is WindowMetric {
  const window = record(value);
  return window !== null
    && nonnegativeNumber(window.quoteVolume)
    && nonnegativeInteger(window.tradeCount)
    && nonnegativeNumber(window.avgTradeSize)
    && finiteNumber(window.priceMovePct)
    && unitIntervalOrNull(window.takerBuyRatio)
    && nonnegativeInteger(window.largeTradeCount);
}

function volumeRow(value: unknown): value is VolumeRow {
  const row = record(value);
  const baseline = record(row?.baseline);
  const windows = record(row?.windows);
  const volumeMultiple = record(row?.volumeMultiple);
  const tradeCountMultiple = record(row?.tradeCountMultiple);
  const proposal = row?.proposal === null ? null : record(row?.proposal);
  if (
    !row
    || !baseline
    || !windows
    || !volumeMultiple
    || !tradeCountMultiple
    || !Object.hasOwn(row, 'proposal')
    || (row.proposal !== null && proposal === null)
  ) return false;
  if (
    !volumeSymbol(row.symbol)
    || !volumeBase(row.base)
    || !VOLUME_STATES.has(row.state as VolumeRow['state'])
    || !nonnegativeOrNull(row.price)
    || !timestampOrNull(row.lastTradeTs)
    || !VOLUME_DECISIONS.has(row.decisionKind as VolumeRow['decisionKind'])
    || !text(row.reason)
    || !textOrNull(row.focusReason)
    || !textOrNull(row.rejectCode, 160)
    || !textOrNull(row.correlationId, 256)
    || !timestampOrNull(row.decisionTs)
    || !nonnegativeNumber(row.focusAgeMs)
  ) return false;
  if (
    typeof baseline.ready !== 'boolean'
    || !nonnegativeInteger(baseline.samples)
    || !unitInterval(baseline.confidence)
    || !nonnegativeNumber(baseline.quotePerSecNorm)
    || !nonnegativeNumber(baseline.tradesPerSecNorm)
    || !nonnegativeNumber(baseline.quotePerMinMedian)
    || !nonnegativeNumber(baseline.quotePerMinMad)
    || typeof baseline.isDead !== 'boolean'
    || (baseline.isDead && !baseline.ready)
  ) return false;
  if (
    Object.keys(windows).length > 64
    || !Object.values(windows).every((entry) => entry === undefined || volumeWindow(entry))
    || !nonnegativeNumericMap(volumeMultiple)
    || !nonnegativeNumericMap(tradeCountMultiple)
    || (!baseline.ready && (
      Object.values(volumeMultiple).some((entry) => entry !== null)
      || Object.values(tradeCountMultiple).some((entry) => entry !== null)
    ))
  ) return false;
  for (const key of ['spreadBps', 'topDepthUsd', 'depthVsNorm'] as const) {
    if (!nonnegativeOrNull(row[key])) return false;
  }
  if (
    !unitIntervalOrNull(row.depthScore)
    || !unitIntervalOrNull(row.takerBuyRatio)
    || !unitIntervalOrNull(row.washScore)
    || !finiteOrNull(row.accelerationPctPerMin)
    || (row.decisionKind === 'reject') !== (row.rejectCode !== null)
    || (row.decisionKind === 'warming' && baseline.ready)
  ) return false;
  if (
    proposal !== null
    && (
      !text(proposal.id, 256)
      || !VOLUME_PROPOSAL_STATUSES.has(proposal.status as NonNullable<VolumeRow['proposal']>['status'])
      || (proposal.direction !== 'long' && proposal.direction !== 'short')
      || !unitIntervalOrNull(proposal.confidence)
      || !text(proposal.reason)
    )
  ) return false;
  return true;
}

export function decodeVolumeRuntimeSnapshot(value: unknown): VolumeSnapshot | null {
  const snapshot = record(value);
  const status = record(snapshot?.status);
  const thresholds = record(snapshot?.thresholds);
  if (
    !snapshot
    || !status
    || !thresholds
    || !timestampOrNull(snapshot.updatedAt)
    || snapshot.updatedAt === null
  ) return null;
  const updatedAt = snapshot.updatedAt as number;
  if (
    typeof status.running !== 'boolean'
    || !new Set(['starting', 'connecting', 'open', 'degraded']).has(String(status.streamState))
    || !new Set(['fresh', 'stale']).has(String(status.bookState))
    || !timestampOrNull(status.lastTradeTs)
    || !timestampOrNull(status.lastBookTs)
    || !text(status.source, 256)
    || !text(status.bookSource, 256)
    || !text(status.baselineSource, 256)
  ) return null;
  for (const key of [
    'streamConnections',
    'openConnections',
    'universeSize',
    'eligibleSize',
    'observedSymbols',
    'baselineReady',
    'baselineTotal',
    'baselineCompleted',
    'baselineFailed',
    'watching',
    'focused',
    'openProposals',
    'tradeMessages',
  ] as const) {
    if (!nonnegativeInteger(status[key])) return null;
  }
  for (const key of ['volume1s', 'volume5s', 'tradeCount', 'followthroughPct', 'maxSpreadBps'] as const) {
    if (!nonnegativeNumber(thresholds[key])) return null;
  }
  if (
    !unitInterval(thresholds.minDepthScore)
    || !nonnegativeInteger(thresholds.baselineMinutes)
    || !timestampAtOrBefore(status.lastTradeTs as number | null, updatedAt + VOLUME_MAX_FUTURE_SKEW_MS)
    || !timestampAtOrBefore(status.lastBookTs as number | null, updatedAt)
    || (
      status.bookState === 'fresh'
      && (
        status.lastBookTs === null
        || updatedAt - (status.lastBookTs as number) < 0
        || updatedAt - (status.lastBookTs as number) >= VOLUME_RUNTIME_FRESH_MS
      )
    )
    || !Array.isArray(snapshot.rows)
    || snapshot.rows.length > 4_096
    || !snapshot.rows.every(volumeRow)
  ) return null;

  const rows = snapshot.rows as unknown as VolumeRow[];
  const fullCoverage = rows.length === (status.eligibleSize as number);
  const observedRows = rows.filter((row) => (
    row.lastTradeTs !== null
    && updatedAt - row.lastTradeTs >= 0
    && updatedAt - row.lastTradeTs < VOLUME_OBSERVED_FRESH_MS
  )).length;
  const watchingRows = rows.filter((row) => row.state === 'WATCHING').length;
  const focusedRows = rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length;
  const activeRows = rows.filter((row) => row.state === 'ACTIVE').length;
  const hiddenRows = activeRows + Math.max(0, (status.eligibleSize as number) - rows.length);
  const openProposalRows = rows.filter(hasAttachedOpenProposal).length;
  if (
    new Set(rows.map((row) => row.symbol)).size !== rows.length
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
    || (
      fullCoverage
      && (
        (status.observedSymbols as number) !== observedRows
        || (status.openProposals as number) !== openProposalRows
      )
    )
    || (status.openConnections as number) > (status.streamConnections as number)
    || (status.eligibleSize as number) > (status.universeSize as number)
    || (status.observedSymbols as number) > (status.eligibleSize as number)
    || (status.baselineReady as number) > (status.baselineTotal as number)
    || (status.baselineCompleted as number) > (status.baselineTotal as number)
    || (status.baselineFailed as number) > (status.baselineTotal as number)
    || (status.baselineCompleted as number) + (status.baselineFailed as number) > (status.baselineTotal as number)
    || (status.watching as number) > (status.eligibleSize as number)
    || (status.focused as number) > (status.eligibleSize as number)
    || (status.openProposals as number) > (status.eligibleSize as number)
  ) return null;
  return snapshot as unknown as VolumeSnapshot;
}

export function volumeRowsCurrent(snapshot: VolumeSnapshot): boolean {
  return snapshot.rows.every(
    (row) => (row.state === 'PROPOSED') === hasAttachedOpenProposal(row),
  ) && snapshot.rows.every(
    (row) => timestampAtOrBefore(row.lastTradeTs, snapshot.updatedAt),
  );
}

function multiple(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) + '×' : '—';
}

function numberOrDash(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function windowCountLabel(
  windowMetric: WindowMetric | undefined,
  countKey: 'tradeCount' | 'largeTradeCount',
  suffix = '',
): string {
  const count = windowMetric?.[countKey];
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? `${count}${suffix}`
    : 'UNKNOWN';
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isRejectedVolumeRow(row: VolumeRow): boolean {
  return row.state === 'REJECTED' || row.state === 'COOLDOWN' || row.decisionKind === 'reject';
}

function stateLabel(row: VolumeRow): string {
  if (!row.baseline.ready) return 'Warming';
  if (row.state === 'PROPOSED') return 'Proposal';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (isRejectedVolumeRow(row)) return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: VolumeRow): string {
  if (!row.baseline.ready) return 'warming';
  if (row.state === 'PROPOSED') return 'proposal';
  if (row.state === 'FOCUS') return 'focus';
  if (row.state === 'WATCHING') return 'watching';
  if (isRejectedVolumeRow(row)) return 'rejected';
  return 'idle';
}

function ratioLabel(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '% Buy';
}

function fundingLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(4) + '%' : '—';
}

function countLabel(value: number | null | undefined): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : '—';
}

export function currentFactLabel<T extends string | number>(
  current: boolean,
  value: T | null | undefined,
): T | 'UNKNOWN' {
  return current && value !== null && value !== undefined ? value : 'UNKNOWN';
}

export type VolumeRuntimeTruth = Readonly<{
  current: boolean;
  state: 'STARTING' | 'CURRENT' | 'UNAVAILABLE';
  label: 'Engine Feeds Starting' | 'Engine Feeds Current' | 'Engine Feeds Unavailable';
  reason: string | null;
}>;

export function resolveVolumeRuntimeTruth(input: Readonly<{
  canonicalState: 'LOADING' | 'READY' | 'UNAVAILABLE';
  canonicalReason: string | null;
  snapshotUpdatedAtMs: number | null;
  snapshotStatus: Pick<
    VolumeSnapshot['status'],
    | 'running'
    | 'streamState'
    | 'streamConnections'
    | 'openConnections'
    | 'bookState'
    | 'eligibleSize'
    | 'observedSymbols'
    | 'lastTradeTs'
    | 'lastBookTs'
    | 'tradeMessages'
  > | null;
  rowCount: number | null;
  rowContractCurrent: boolean | null;
  requestError: string | null;
  nowMs?: number;
}>): VolumeRuntimeTruth {
  if (input.requestError) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: input.requestError,
    });
  }
  if (input.snapshotStatus && typeof input.snapshotStatus.running !== 'boolean') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: 'VOLUME_RUNTIME_CONTRACT_INVALID',
    });
  }
  if (input.snapshotStatus && !input.snapshotStatus.running) {
    const canonicalSuffix = input.canonicalReason ? ` · ${input.canonicalReason}` : '';
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: `VOLUME_RUNTIME_STOPPED${canonicalSuffix}`,
    });
  }
  if (input.canonicalState === 'UNAVAILABLE') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: input.canonicalReason ?? 'VOLUME_ENGINE_CANONICAL_TRUTH_UNAVAILABLE',
    });
  }
  if (
    !input.snapshotStatus
    || input.snapshotUpdatedAtMs === null
    || input.rowCount === null
    || input.rowContractCurrent === null
  ) {
    return Object.freeze({
      current: false,
      state: 'STARTING',
      label: 'Engine Feeds Starting',
      reason: null,
    });
  }

  const status = input.snapshotStatus;
  const statusCounts = [
    status.streamConnections,
    status.openConnections,
    status.eligibleSize,
    status.observedSymbols,
    status.tradeMessages,
    input.rowCount,
  ];
  if (statusCounts.some((value) => !Number.isInteger(value) || value < 0)) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: 'VOLUME_RUNTIME_CONTRACT_INVALID',
    });
  }
  if (status.streamState !== 'open' || status.bookState !== 'fresh') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: `VOLUME_SOURCE_NOT_CURRENT: streams=${status.streamState}; books=${status.bookState}`,
    });
  }
  if (
    status.streamConnections <= 0
    || status.openConnections !== status.streamConnections
  ) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: `VOLUME_STREAM_COVERAGE_NOT_CURRENT: open=${status.openConnections}; expected=${status.streamConnections}`,
    });
  }
  if (
    status.eligibleSize <= 0
    || status.observedSymbols !== status.eligibleSize
    || input.rowCount !== status.eligibleSize
    || status.tradeMessages <= 0
  ) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: `VOLUME_SYMBOL_COVERAGE_NOT_CURRENT: rows=${input.rowCount}; observed=${status.observedSymbols}; eligible=${status.eligibleSize}`,
    });
  }
  if (!input.rowContractCurrent) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: 'VOLUME_ROW_CONTRACT_NOT_CURRENT',
    });
  }

  const nowMs = input.nowMs ?? Date.now();
  const sourceTimes = [
    input.snapshotUpdatedAtMs,
    status.lastTradeTs,
    status.lastBookTs,
  ];
  if (
    !Number.isFinite(nowMs)
    || sourceTimes.some((value) => value === null || !Number.isFinite(value) || value <= 0)
    || sourceTimes.some((value) => (value as number) > input.snapshotUpdatedAtMs!)
    || input.snapshotUpdatedAtMs > nowMs
    || sourceTimes.some((value) => nowMs - (value as number) >= VOLUME_RUNTIME_FRESH_MS)
  ) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Engine Feeds Unavailable',
      reason: 'VOLUME_SOURCE_TIMESTAMPS_NOT_CURRENT',
    });
  }
  if (input.canonicalState === 'LOADING') {
    return Object.freeze({
      current: false,
      state: 'STARTING',
      label: 'Engine Feeds Starting',
      reason: null,
    });
  }
  return Object.freeze({
    current: true,
    state: 'CURRENT',
    label: 'Engine Feeds Current',
    reason: null,
  });
}

export function VolumeScanner() {
  const { binding } = useProductControlRoomContext();
  const {
    state,
    openDetail,
    openLedger,
    toggleWatch,
    privateRead,
    privateReadSource,
    privateReadError,
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    marketsError,
    connected,
    prefs,
  } = useStore();
  const [snapshot, setSnapshot] = useState<VolumeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedIntelligence, setExpandedIntelligence] = useState<TokenIntelligenceRead | null>(null);
  const [expandedIntelligenceError, setExpandedIntelligenceError] = useState<string | null>(null);

  useEffect(() => {
    const poll = createSettledPoll<VolumeSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const raw = await fetchJson<unknown>('/api/engine/volume', { cache: 'no-store', signal });
        const decoded = decodeVolumeRuntimeSnapshot(raw);
        if (decoded === null) throw new Error('Volume runtime owner contract mismatch');
        return decoded;
      },
      onSuccess: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onError: (reason) => setError(apiErrorMessage(reason, 'Volume runtime unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  useEffect(() => {
    setExpandedIntelligence(null);
    setExpandedIntelligenceError(null);
    if (expanded === null) return;
    const symbol = expanded;
    const poll = createSettledPoll<TokenIntelligenceRead>({
      intervalMs: 2_000,
      request: async (signal) => {
        const raw = await fetchJson<unknown>(`/api/intelligence/token?symbol=${encodeURIComponent(symbol)}`, {
          cache: 'no-store',
          signal,
        });
        const parsed = parseTokenIntelligence(raw, symbol, Date.now());
        if (parsed === null) throw new Error('Volume intelligence owner contract mismatch');
        return parsed;
      },
      onSuccess: (next) => {
        if (next.symbol !== symbol) return;
        setExpandedIntelligence(next);
        setExpandedIntelligenceError(null);
      },
      onError: (reason) => {
        setExpandedIntelligence(null);
        setExpandedIntelligenceError(apiErrorMessage(reason, 'Exact-symbol intelligence unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [expanded]);

  const volumeComponent = binding.snapshot?.components.find((component) => component.componentId === 'volume-engine');
  const volumeCanonicalReason = binding.continuity !== 'PROVEN'
    ? binding.error ?? `CANONICAL_CONTINUITY_${binding.continuity}`
    : volumeComponent
      ? `VOLUME_ENGINE_${volumeComponent.observedLifecycle}: ${[
        volumeComponent.blockerCode,
        volumeComponent.canonicalPresentation.stateLabel,
      ].filter(Boolean).join(' · ')}`
      : 'VOLUME_ENGINE_CANONICAL_TRUTH_MISSING';
  const volumeCanonicalReady = Boolean(
    binding.continuity === 'PROVEN'
    && volumeComponent?.observedLifecycle === 'READY'
    && volumeComponent.canonicalPresentation.status === 'operational',
  );
  const volumeCanonicalLoading = Boolean(
    binding.loading && binding.snapshot === null && binding.error === null
    || binding.continuity === 'PROVEN'
      && volumeComponent
      && ['START_REQUESTED', 'STARTING', 'WARMING'].includes(volumeComponent.observedLifecycle),
  );
  const nowMs = Date.now();
  const volumeTruth = resolveVolumeRuntimeTruth({
    canonicalState: volumeCanonicalReady ? 'READY' : volumeCanonicalLoading ? 'LOADING' : 'UNAVAILABLE',
    canonicalReason: volumeCanonicalReason,
    snapshotUpdatedAtMs: snapshot?.updatedAt ?? null,
    snapshotStatus: snapshot?.status ?? null,
    rowCount: Array.isArray(snapshot?.rows) ? snapshot.rows.length : null,
    rowContractCurrent: snapshot ? volumeRowsCurrent(snapshot) : null,
    requestError: error,
    nowMs,
  });
  const rows = volumeTruth.current && Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: rows.length,
    watching: rows.filter((row) => row.state === 'WATCHING').length,
    focus: rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    rejected: rows.filter(isRejectedVolumeRow).length,
    warming: rows.filter((row) => !row.baseline.ready).length,
  }), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (query && !row.symbol.includes(query) && !row.base.includes(query) && !row.reason.toUpperCase().includes(query)) return false;
    if (filter === 'watching') return row.state === 'WATCHING';
    if (filter === 'focus') return row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'rejected') return isRejectedVolumeRow(row);
    if (filter === 'warming') return !row.baseline.ready;
    return true;
  }), [filter, query, rows]);

  const watchlist = state?.config.watchlist ?? [];
  const marketFreshness = resolveMarketFreshness({
    connected,
    error: marketsError,
    sourceTimeMs: marketsUpdatedAt,
    nowMs,
    staleAfterMs: Math.max(12_000, (prefs.dataCadence?.market ?? prefs.refreshSec) * 2_500),
  });
  const marketCurrent = marketStatus === 'CURRENT'
    && marketsLastSuccessAtMs !== null
    && marketFreshness.live;
  const marketLabel = marketCurrent
    ? 'LIVE'
    : marketStatus === 'LOADING'
      ? 'LOADING'
      : marketStatus === 'STALE'
        ? 'STALE LAST-KNOWN'
        : marketStatus === 'UNAVAILABLE'
          ? 'UNAVAILABLE'
          : marketsLastSuccessAtMs === null
            ? 'UNKNOWN'
            : marketFreshness.status === 'STALE'
              ? 'STALE LAST-KNOWN'
              : marketFreshness.status === 'ERROR'
                ? 'UNAVAILABLE'
                : marketFreshness.status;
  const accountPresentation = projectPrivateRead(privateRead, nowMs);
  const accountCurrent = privateReadSource !== 'PENDING'
    && privateReadError === null
    && accountPresentation.state !== 'UNAVAILABLE'
    && accountPresentation.freshness.state === 'CURRENT';
  const volumeUnassertedDetail = volumeTruth.state === 'STARTING'
    ? 'Runtime starting'
    : 'Canonical runtime unavailable';

  return (
    <div className="container page volx-page">
      <section className="volx-frame" aria-label="volume workspace">
        <header className="volx-toolbar">
          <div className="volx-title">
            <img className="volx-page-mark" src="/volume-bars.png" alt="" aria-hidden="true" />
            <h1>Volume</h1>
            <span
              className={'volx-live ' + (volumeTruth.state === 'CURRENT' ? 'active' : volumeTruth.state === 'UNAVAILABLE' ? 'degraded' : 'starting')}
              title={volumeTruth.reason ?? undefined}
            >
              <i aria-hidden="true" />
              {volumeTruth.label}
            </span>
            <span className="volx-updated">
              {volumeTruth.current && snapshot
                ? 'Updated ' + timeAgo(snapshot.updatedAt)
                : volumeTruth.reason ?? 'Connecting'}
            </span>
          </div>
          <label className="volx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Volume"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpanded(null);
              }}
              spellCheck={false}
            />
            {search ? (
              <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="volx-summary" aria-label="Volume Summary">
          <div className="volx-summary-cell">
            <span>Observed Symbols</span>
            <strong>{volumeTruth.current ? snapshot?.status.observedSymbols ?? 'UNKNOWN' : 'UNKNOWN'} <em>/ {volumeTruth.current ? snapshot?.status.eligibleSize ?? 'UNKNOWN' : 'UNKNOWN'}</em></strong>
            <small>{volumeTruth.current ? 'Exact aggregate-trade streams' : volumeUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Baselines Ready</span>
            <strong>{volumeTruth.current ? snapshot?.status.baselineReady ?? 'UNKNOWN' : 'UNKNOWN'} <em>/ {volumeTruth.current ? snapshot?.status.baselineTotal ?? 'UNKNOWN' : 'UNKNOWN'}</em></strong>
            <small>{volumeTruth.current && snapshot ? snapshot.thresholds.baselineMinutes + ' completed minutes required' : volumeUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Focus Queue</span>
            <strong>{volumeTruth.current && snapshot ? snapshot.status.watching + snapshot.status.focused : 'UNKNOWN'}</strong>
            <small>{volumeTruth.current && snapshot ? snapshot.status.watching + ' watching · ' + snapshot.status.focused + ' focused' : volumeUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Open Proposals</span>
            <strong>{volumeTruth.current ? snapshot?.status.openProposals ?? 'UNKNOWN' : 'UNKNOWN'}</strong>
            <small>{volumeTruth.current && snapshot?.status.openProposals ? 'Volume proposals in engine' : volumeTruth.current ? 'No verified wakeup staged' : volumeUnassertedDetail}</small>
          </div>
        </div>

        <ProductSurfaceAdapter surfaceId="volume" />

        <section className="volx-owner-evidence" aria-label="Volume Truth Ledger">
          <header>
            <span>
              <strong>Volume Truth Ledger</strong>
              <small>Runtime, market, account, and frozen research retain independent evidence gates.</small>
            </span>
            <em className={volumeTruth.current ? 'fresh' : volumeTruth.state === 'UNAVAILABLE' ? 'degraded' : 'missing'}>
              {volumeTruth.state}
            </em>
          </header>
          <div className="volx-owner-grid">
            <article>
              <span>Canonical Volume Engine</span>
              <strong>{volumeTruth.state}</strong>
              <small>{volumeTruth.current && snapshot
                ? `${snapshot.status.source} · ${snapshot.status.openConnections}/${snapshot.status.streamConnections} streams · ${snapshot.rows.length} exact rows`
                : `${volumeTruth.reason ?? 'Awaiting current runtime evidence'} · values withheld`}</small>
            </article>
            <article>
              <span>Live Market Read</span>
              <strong>{marketLabel}</strong>
              <small>{marketCurrent && marketsUpdatedAt !== null
                ? `${currentFactLabel(true, markets.length)} current rows · source updated ${timeAgo(marketsUpdatedAt)}`
                : `${marketsError ?? `MARKET_${marketStatus} · SOURCE_${marketFreshness.status}`} · values withheld`}</small>
            </article>
            <article>
              <span>Existing Account Read</span>
              <strong>{accountCurrent
                ? `${currentFactLabel(true, accountPresentation.spotAvailableUsdt)} USDT`
                : accountPresentation.stateLabel}</strong>
              <small>{accountCurrent
                ? `${currentFactLabel(true, accountPresentation.counts.openOrders)} open orders · ${accountPresentation.freshness.label} · source ${privateReadSource}`
                : `${accountPresentation.freshness.label} · ${privateReadError ?? `source ${privateReadSource}`} · values withheld`}</small>
            </article>
            <article>
              <span>Frozen Research Verdict · …bbdf</span>
              <strong>{VOLUME_RESEARCH_TRUTH.testStatus}</strong>
              <strong>{VOLUME_RESEARCH_TRUTH.measurementStatus}</strong>
              <small>Economics NULL · account-effective fees {VOLUME_RESEARCH_TRUTH.accountEffectiveFees} · capacity {VOLUME_RESEARCH_TRUTH.capacity} · GO/NO_GO {VOLUME_RESEARCH_TRUTH.goNoGo} · execution {VOLUME_RESEARCH_TRUTH.executionAuthority} · repair/rerun {VOLUME_RESEARCH_TRUTH.repairAuthority} · blob …aca8</small>
            </article>
          </div>
        </section>

        <div className="volx-filters">
          <div className="volx-segments" role="tablist" aria-label="Volume Views">
            {FILTERS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setFilter(item.id);
                  setExpanded(null);
                }}
              >
                {item.label}
                <span>{volumeTruth.current ? counts[item.id] : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="volx-view-note">
            {volumeTruth.current && snapshot
              ? snapshot.status.openConnections + '/' + snapshot.status.streamConnections + ' trade streams · book ' + snapshot.status.bookState
              : volumeTruth.reason ?? 'Runtime starting'}
          </span>
        </div>

        <div className="volx-table" role="region" aria-label="Volume Scanner Decisions">
          <div className="volx-head" aria-hidden="true">
            <span>State</span>
            <span>Asset</span>
            <span>Price</span>
            <span>Volume Vs Baseline</span>
            <span>Trade Flow</span>
            <span>Market Quality</span>
            <span>Price Move</span>
            <span>Decision</span>
            <span aria-hidden="true" />
          </div>

          {volumeTruth.state === 'UNAVAILABLE' ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Volume Runtime Unavailable</strong>
              <span>{volumeTruth.reason}</span>
            </div>
          ) : volumeTruth.state === 'STARTING' || !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Volume Runtime</strong>
              <span>Waiting for public Binance trade and book sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const one = row.windows['1s'];
            const five = row.windows['5s'];
            const minute = row.windows['60s'];
            const isExpanded = expanded === row.symbol;
            const detailId = `volume-${row.symbol.toLowerCase()}-detail`;
            const watching = watchlist.includes(row.symbol);
            const ownerTruth = projectVolumeWorkspaceTruth(
              expandedIntelligence?.symbol === row.symbol ? expandedIntelligence : null,
              row.symbol,
            );
            return (
              <div className="volx-item" key={row.symbol}>
                <button
                  type="button"
                  className="volx-row"
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                  onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                >
                  <span className={'volx-state ' + stateTone(row)}>
                    <i aria-hidden="true" />
                    {stateLabel(row)}
                  </span>
                  <span className="volx-asset">
                    <TokenIcon symbol={row.symbol} size={28} />
                    <span><strong>{row.base}</strong><small>{row.symbol}</small></span>
                  </span>
                  <span className="volx-number">
                    <strong>{fmtPrice(row.price)}</strong>
                    <small>{row.lastTradeTs ? timeAgo(row.lastTradeTs) : 'No recent trade'}</small>
                  </span>
                  <span className="volx-window-stack">
                    <span><em>1s</em><strong>{multiple(row.volumeMultiple['1s'])}</strong><small>{fmtMoney(one?.quoteVolume ?? null)}</small></span>
                    <span><em>5s</em><strong>{multiple(row.volumeMultiple['5s'])}</strong><small>{fmtMoney(five?.quoteVolume ?? null)}</small></span>
                    <span><em>1m</em><strong>{multiple(row.volumeMultiple['60s'])}</strong><small>{fmtMoney(minute?.quoteVolume ?? null)}</small></span>
                  </span>
                  <span className="volx-tape">
                    <strong>{windowCountLabel(five, 'tradeCount', ' Trades')}</strong>
                    <small>{ratioLabel(row.takerBuyRatio)} · {fmtMoney(five?.avgTradeSize ?? null)} Avg</small>
                  </span>
                  <span className="volx-quality">
                    <strong>{row.spreadBps === null ? '—' : row.spreadBps.toFixed(1) + ' bps'}</strong>
                    <small>{fmtMoney(row.topDepthUsd)} Top Depth</small>
                  </span>
                  <span className="volx-move">
                    <strong>{fmtPct(five?.priceMovePct ?? null, 3)}</strong>
                    <small>{row.accelerationPctPerMin === null ? '—' : fmtPct(row.accelerationPctPerMin, 2) + '/min'}</small>
                  </span>
                  <span className="volx-decision">
                    <strong>{row.rejectCode ? titleCase(row.rejectCode) : titleCase(row.decisionKind)}</strong>
                    <small>{row.reason}</small>
                  </span>
                  <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                </button>

                {isExpanded ? (
                  <div className="volx-detail" id={detailId}>
                    <div className="volx-reason">
                      <span>Scanner Decision</span>
                      <p>{row.reason}</p>
                      <small><Radio size={13} />{snapshot.status.source} · {snapshot.status.bookSource}</small>
                    </div>
                    <dl className="volx-facts">
                      <div><dt>Baseline</dt><dd>{row.baseline.samples}/{snapshot.thresholds.baselineMinutes} min</dd></div>
                      <div><dt>Normal Volume</dt><dd>{fmtMoney(row.baseline.quotePerMinMedian)}/min</dd></div>
                      <div><dt>1s Trades</dt><dd>{windowCountLabel(one, 'tradeCount')}</dd></div>
                      <div><dt>5s Trade Multiple</dt><dd>{multiple(row.tradeCountMultiple['5s'])}</dd></div>
                      <div><dt>Average Trade</dt><dd>{fmtMoney(five?.avgTradeSize ?? null)}</dd></div>
                      <div><dt>Taker Aggression</dt><dd>{ratioLabel(row.takerBuyRatio)}</dd></div>
                      <div><dt>Large Trades · 1m</dt><dd>{windowCountLabel(minute, 'largeTradeCount')}</dd></div>
                      <div><dt>Depth Score</dt><dd>{numberOrDash(row.depthScore, 2)}</dd></div>
                      <div><dt>Depth Vs Norm</dt><dd>{row.depthVsNorm === null ? '—' : Math.round(row.depthVsNorm * 100) + '%'}</dd></div>
                      <div><dt>Focus Reason</dt><dd>{row.focusReason ? titleCase(row.focusReason) : 'Not Focused'}</dd></div>
                      <div><dt>Reject Code</dt><dd>{row.rejectCode ? titleCase(row.rejectCode) : 'None'}</dd></div>
                      <div><dt>Proposal</dt><dd>{row.proposal ? titleCase(row.proposal.status) : 'None'}</dd></div>
                    </dl>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button type="button" className={watching ? 'active' : ''} onClick={() => void toggleWatch(row.symbol)}>
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />{watching ? 'Watching' : 'Watch'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                    </div>
                    <section className="volx-owner-evidence" aria-label={`${row.symbol} Volume Intelligence Evidence`}>
                      <header>
                        <span><strong>Canonical Intelligence Evidence</strong><small>Exact symbol · MarketEngine → router → Bridge</small></span>
                        <em className={ownerTruth?.projectionState === 'ACTIVE' ? 'fresh' : ownerTruth ? 'degraded' : 'missing'}>
                          {ownerTruth?.projectionState ?? (expandedIntelligenceError ? 'UNAVAILABLE' : 'READING')}
                        </em>
                      </header>
                      {ownerTruth ? (
                        <>
                          <div className="volx-owner-grid">
                            <article>
                              <span>Latest Owner Thesis · Stage</span>
                              <strong>{ownerTruth.stage.marketStage ?? 'UNKNOWN'}</strong>
                              <small>{ownerTruth.stage.freshness === 'MISSING' ? 'MISSING' : ownerTruth.stage.freshness + '_AT_CUT'} · {ownerTruth.stage.completeness} · {ownerTruth.stage.hypothesis ?? 'stage withheld'} · {ownerTruth.stage.evaluatedAtMs === null ? 'cut unknown' : timeAgo(ownerTruth.stage.evaluatedAtMs)}</small>
                            </article>
                            <article>
                              <span>Cross-market Capability</span>
                              <strong>{ownerTruth.leadership.leadMarket}</strong>
                              <small>{ownerTruth.leadership.freshness} · {ownerTruth.leadership.completeness} · {ownerTruth.leadership.lastEvidenceTimeMs === null ? 'source time missing' : timeAgo(ownerTruth.leadership.lastEvidenceTimeMs)}</small>
                            </article>
                            <article>
                              <span>Latest Owner Thesis Lead</span>
                              <strong>{ownerTruth.stage.leadMarket}</strong>
                              <small>{ownerTruth.stage.freshness === 'MISSING' ? 'MISSING' : ownerTruth.stage.freshness + '_AT_CUT'} · {ownerTruth.stage.completeness} · {ownerTruth.stage.evaluatedAtMs === null ? 'cut unknown' : timeAgo(ownerTruth.stage.evaluatedAtMs)}</small>
                            </article>
                            <article>
                              <span>Open Interest</span>
                              <strong>{fmtMoney(ownerTruth.openInterest.value?.quoteUsd)}</strong>
                              <small>{ownerTruth.openInterest.state} · {ownerTruth.openInterest.value?.changePct === null || ownerTruth.openInterest.value?.changePct === undefined ? 'change unknown' : fmtPct(ownerTruth.openInterest.value.changePct, 2)}</small>
                            </article>
                            <article>
                              <span>Funding</span>
                              <strong>{fundingLabel(ownerTruth.markFunding.value?.fundingRate)}</strong>
                              <small>{ownerTruth.markFunding.state} · {ownerTruth.markFunding.dataset}</small>
                            </article>
                            <article>
                              <span>Sampled Liquidations · 15m</span>
                              <strong>{fmtMoney(ownerTruth.liquidation.value?.total15mUsd)}</strong>
                              <small>{ownerTruth.liquidation.state} · latest-per-symbol lower bound</small>
                            </article>
                            <article>
                              <span>Wash-Like Churn Score</span>
                              <strong>{numberOrDash(row.washScore, 2)}</strong>
                              <small>Scanner owner heuristic · not Bridge forensics or an empirical outcome</small>
                            </article>
                            <article>
                              <span>Latest Owner Forensics</span>
                              <strong>{ownerTruth.forensics
                                ? (ownerTruth.forensics.freshness === 'MISSING' ? 'MISSING' : ownerTruth.forensics.freshness + '_AT_CUT') + ' · ' + ownerTruth.forensics.state
                                : 'UNAVAILABLE'}</strong>
                              <small>{ownerTruth.forensics
                                ? ownerTruth.forensics.checkCount + ' checks · ' + ownerTruth.forensics.blockingCheckCount + ' blocking · ' + ownerTruth.forensics.unknownRequiredCheckCount + ' unknown required'
                                : 'No current exact-symbol Bridge artifact'}</small>
                            </article>
                            <article>
                              <span>Retained Evidence Timeline</span>
                              <strong>{ownerTruth.retainedEvidence.count} records</strong>
                              <small>{ownerTruth.retainedEvidence.state} · history count is not outcome truth</small>
                            </article>
                            <article>
                              <span>Production Outcomes</span>
                              <strong>{ownerTruth.outcomeOwner.state}</strong>
                              <small>Pre-move freeze and empirical false-positive outcome owner not mounted</small>
                            </article>
                          </div>
                          <div className="volx-capabilities" aria-label={`${row.symbol} Intelligence Capabilities`}>
                            {ownerTruth.capabilities.map((entry) => (
                              <span key={entry.capability}>
                                <strong>{titleCase(entry.capability)}</strong>
                                <em className={entry.freshness.toLowerCase()}>{entry.freshness}</em>
                                <small>{entry.completeness} · {entry.sourceIds.length ? entry.sourceIds.join(', ') : entry.reasonCodes.join(', ') || 'NO APPROVED SOURCE'}</small>
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="volx-owner-unavailable">
                          {expandedIntelligenceError ?? 'Reading the exact-symbol owner contract. No evidence value is inferred while it is unavailable.'}
                        </p>
                      )}
                    </section>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Volume Rows Match</strong>
              <span>Change the filter or search term. No rows are simulated.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
