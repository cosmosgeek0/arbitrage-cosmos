import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Gauge,
  Radio,
  ScanLine,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react';
import { EquityChart, PerfChart, type PerfDay } from '../components/PerfChart';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { TokenIcon } from '../components/TokenIcon';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { formatClockZone } from '../lib/time';
import { exactOrDash, projectPrivateRead, worstTone } from '../lib/privateRead';
import { resolveMarketFreshness, useStore, type Page } from '../store';
import { fmtBasis, fmtPrice, signClass, timeAgo } from '../format';
import type { SystemTraceDecision } from '../lib/systemIntegration';
import type { MarketRow } from '../types';
import './Dashboard.css';

type RangeId = '1W' | '1M' | '3M' | '6M';
type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const RANGES: { id: RangeId; ms: number }[] = [
  { id: '1W', ms: 7 * 86_400_000 },
  { id: '1M', ms: 31 * 86_400_000 },
  { id: '3M', ms: 93 * 86_400_000 },
  { id: '6M', ms: 186 * 86_400_000 },
];

const DASHBOARD_MARKET_VALUE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
const DASHBOARD_MARKET_VALUE_LIMIT = DASHBOARD_MARKET_VALUE_SYMBOLS.length;
type DashboardMarketValueRow = MarketRow & { spot: number };

interface Source<T> {
  data: T | null;
  error: string | null;
}

interface PnlData {
  realizedByDay: PerfDay[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
  integrity: {
    state: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
    complete: boolean;
    reasons: string[];
    days: {
      day: string;
      complete: boolean;
      reasons: string[];
      feeUsd: number;
      netUsd: number;
    }[];
  };
}

interface RuntimeRow {
  id: 'basis' | 'volume';
  name: string;
  source: string;
  tone: Tone;
  state: string;
  intake: string;
  coverage: string;
  watching: number | string;
  focused: number | string;
  proposals: number | string;
  constraint: string;
  updatedAt: number | null;
  page: Page;
}

interface IntegrityCheck {
  label: string;
  detail: string;
  tone: Tone;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function selectDashboardMarketValues(rows: readonly MarketRow[]) {
  const preferred = DASHBOARD_MARKET_VALUE_SYMBOLS
    .map((symbol) => rows.find((row) => row.symbol === symbol));
  const selected: DashboardMarketValueRow[] = [];
  const admittedSymbols = new Set<string>();

  for (const row of [...preferred, ...rows]) {
    const spot = row?.spot;
    if (
      !row
      || admittedSymbols.has(row.symbol)
      || !finite(spot)
      || spot <= 0
    ) continue;
    admittedSymbols.add(row.symbol);
    selected.push({ ...row, spot });
    if (selected.length === DASHBOARD_MARKET_VALUE_LIMIT) break;
  }

  return selected;
}

function finiteSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function formatCompactUsdtPrice(value: number): string {
  if (!finite(value) || value <= 0) return '—';
  const absolute = Math.abs(value);
  const digits = absolute >= 1_000 ? 2
    : absolute >= 100 ? 2
      : absolute >= 1 ? 3
        : absolute >= 0.1 ? 4
          : absolute >= 0.001 ? 6
            : 8;
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });
}

function source<T>(): Source<T> {
  return { data: null, error: null };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value)
    && value.length <= 10_000
    && value.every((item) => typeof item === 'string' && item.length <= 500)
    ? [...value]
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function uniqueBy<T>(rows: readonly T[], keyOf: (row: T) => string | number): boolean {
  return new Set(rows.map(keyOf)).size === rows.length;
}

function dayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function closeEnough(left: number, right: number): boolean {
  if (!finite(left) || !finite(right)) return false;
  const difference = Math.abs(left - right);
  const tolerance = Math.max(1e-9, Math.abs(left) * 1e-9, Math.abs(right) * 1e-9);
  return finite(difference) && finite(tolerance) && difference <= tolerance;
}

function equitySnapshotsRenderable(snapshots: readonly { ts: number; totalUsdt: number }[]): boolean {
  if (snapshots.length === 0) return true;
  let low = snapshots[0].totalUsdt;
  let high = snapshots[0].totalUsdt;
  for (const snapshot of snapshots.slice(1)) {
    low = Math.min(low, snapshot.totalUsdt);
    high = Math.max(high, snapshot.totalUsdt);
  }

  // Mirror the arithmetic used by EquityChart before admitting values. Finite
  // source leaves are insufficient when their range, padding, or grid
  // progression would overflow and turn a truthful chart into NaN/Infinity.
  const valueSpan = high - low;
  const padding = Math.max(valueSpan * 0.15, high * 0.0004, 1e-9);
  const chartMin = low - padding;
  const chartMax = high + padding;
  const chartRange = Math.max(1e-9, chartMax - chartMin);
  const rawStep = chartRange / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-9))));
  const normalizedStep = rawStep / magnitude;
  const stepMultiplier = normalizedStep >= 5 ? 10 : normalizedStep >= 2 ? 5 : normalizedStep >= 1 ? 2 : 1;
  const step = stepMultiplier * magnitude;
  const gridStart = Math.ceil(chartMin / step) * step;
  const gridLimit = chartMax + 1e-9;
  if (
    !finite(valueSpan)
    || !finite(padding)
    || !finite(chartMin)
    || !finite(chartMax)
    || !finite(chartRange)
    || !finite(step)
    || step <= 0
    || !finite(gridStart)
    || !finite(gridLimit)
    || (gridStart <= gridLimit && !(gridStart + step > gridStart))
  ) return false;

  const ordered = [...snapshots].sort((left, right) => left.ts - right.ts);
  const first = ordered[0].totalUsdt;
  const last = ordered[ordered.length - 1].totalUsdt;
  const change = last - first;
  const changePct = first > 0 ? ((last / first) - 1) * 100 : 0;
  return finite(change) && finite(changePct);
}

export function decodeDashboardPnlData(value: unknown): PnlData | null {
  const root = record(value);
  const integrity = record(root?.integrity);
  if (!root || !integrity) return null;
  const realizedByDay = Array.isArray(root.realizedByDay) ? root.realizedByDay.map(record) : [];
  const realizedBySymbol = Array.isArray(root.realizedBySymbol) ? root.realizedBySymbol.map(record) : [];
  const feesByAsset = Array.isArray(root.feesByAsset) ? root.feesByAsset.map(record) : [];
  const equitySnapshots = Array.isArray(root.equitySnapshots) ? root.equitySnapshots.map(record) : [];
  const integrityDays = Array.isArray(integrity.days) ? integrity.days.map(record) : [];
  const reasons = stringArray(integrity.reasons);
  const state = integrity.state;
  if (
    !exactKeys(root, ['realizedByDay', 'realizedBySymbol', 'feesByAsset', 'equitySnapshots', 'integrity'])
    || !exactKeys(integrity, ['state', 'complete', 'reasons', 'days'])
    || !Array.isArray(root.realizedByDay)
    || !Array.isArray(root.realizedBySymbol)
    || !Array.isArray(root.feesByAsset)
    || !Array.isArray(root.equitySnapshots)
    || !Array.isArray(integrity.days)
    || reasons === null
    || !['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(String(state))
    || typeof integrity.complete !== 'boolean'
    || [realizedByDay, realizedBySymbol, feesByAsset, equitySnapshots, integrityDays].some((rows) => rows.length > 10_000 || rows.includes(null))
  ) return null;

  const days: PerfDay[] = [];
  for (const row of realizedByDay) {
    if (!row || !exactKeys(row, ['day', 'usd']) || !dayKey(row.day) || !finite(row.usd)) return null;
    days.push({ day: row.day, usd: row.usd });
  }
  const symbols: { symbol: string; usd: number }[] = [];
  for (const row of realizedBySymbol) {
    if (!row || !exactKeys(row, ['symbol', 'usd']) || typeof row.symbol !== 'string' || row.symbol.length === 0 || row.symbol.length > 64 || !finite(row.usd)) return null;
    symbols.push({ symbol: row.symbol, usd: row.usd });
  }
  const fees: { asset: string; amount: number }[] = [];
  for (const row of feesByAsset) {
    if (!row || !exactKeys(row, ['asset', 'amount']) || typeof row.asset !== 'string' || row.asset.length === 0 || row.asset.length > 32 || !finite(row.amount) || row.amount < 0) return null;
    fees.push({ asset: row.asset, amount: row.amount });
  }
  const snapshots: { ts: number; totalUsdt: number }[] = [];
  for (const row of equitySnapshots) {
    if (!row || !exactKeys(row, ['ts', 'totalUsdt']) || !finite(row.ts) || !Number.isSafeInteger(row.ts) || row.ts <= 0 || !finite(new Date(row.ts).getTime()) || !finite(row.totalUsdt)) return null;
    snapshots.push({ ts: row.ts, totalUsdt: row.totalUsdt });
  }
  const admittedIntegrityDays: PnlData['integrity']['days'] = [];
  for (const row of integrityDays) {
    const rowReasons = stringArray(row?.reasons);
    if (!row || !exactKeys(row, ['day', 'complete', 'reasons', 'feeUsd', 'netUsd']) || !dayKey(row.day) || typeof row.complete !== 'boolean' || rowReasons === null || !finite(row.feeUsd) || row.feeUsd < 0 || !finite(row.netUsd)) return null;
    if (row.complete !== (rowReasons.length === 0)) return null;
    admittedIntegrityDays.push({
      day: row.day,
      complete: row.complete,
      reasons: rowReasons,
      feeUsd: row.feeUsd,
      netUsd: row.netUsd,
    });
  }
  if (
    !uniqueBy(days, (row) => row.day)
    || !uniqueBy(symbols, (row) => row.symbol)
    || !uniqueBy(fees, (row) => row.asset)
    || !uniqueBy(snapshots, (row) => row.ts)
    || !uniqueBy(admittedIntegrityDays, (row) => row.day)
    || !equitySnapshotsRenderable(snapshots)
  ) return null;

  const grossByDay = new Map(days.map((row) => [row.day, row.usd]));
  if (days.some((row) => !admittedIntegrityDays.some((integrityDay) => integrityDay.day === row.day))) return null;
  if (admittedIntegrityDays.some((row) => !closeEnough((grossByDay.get(row.day) ?? 0) - row.feeUsd, row.netUsd))) return null;
  const netValues = admittedIntegrityDays.map((row) => row.netUsd);
  const grossProfit = finiteSum(netValues.filter((value) => value > 0));
  const grossLoss = finiteSum(netValues.filter((value) => value < 0));
  const profitFactor = grossProfit !== null && grossLoss !== null && grossLoss < 0
    ? grossProfit / Math.abs(grossLoss)
    : null;
  const expectedReasons = admittedIntegrityDays.length === 0
    ? ['NO_DURABLE_PNL_EVIDENCE']
    : [...new Set(admittedIntegrityDays.flatMap((row) => row.reasons))];
  if (
    !uniqueBy(reasons, (reason) => reason)
    || reasons.length !== expectedReasons.length
    || expectedReasons.some((reason) => !reasons.includes(reason))
    || finiteSum(days.map((row) => row.usd)) === null
    || finiteSum(netValues) === null
    || grossProfit === null
    || grossLoss === null
    || (profitFactor !== null && !finite(profitFactor))
    || finiteSum(admittedIntegrityDays.map((row) => row.feeUsd)) === null
  ) return null;
  const complete = admittedIntegrityDays.length > 0 && admittedIntegrityDays.every((row) => row.complete);
  const expectedState = admittedIntegrityDays.length === 0 ? 'UNKNOWN' : complete ? 'COMPLETE' : 'PARTIAL';
  if (state !== expectedState || integrity.complete !== complete) return null;

  return {
    realizedByDay: days,
    realizedBySymbol: symbols,
    feesByAsset: fees,
    equitySnapshots: snapshots,
    integrity: {
      state: expectedState,
      complete,
      reasons,
      days: admittedIntegrityDays,
    },
  };
}

function traceTone(event: SystemTraceDecision): Tone {
  if (event.failureCode) return 'bad';
  if (event.truthLabel === 'LIVE_PUBLIC') return 'ok';
  if (event.truthLabel === 'UNAVAILABLE') return 'bad';
  return 'warn';
}

function sourceAge(updatedAt: number | null): string {
  return updatedAt ? timeAgo(updatedAt) : 'Unavailable';
}

function latestKnown(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter(finite);
  return known.length ? Math.max(...known) : null;
}

function useDashboardSources(
  refreshTick: number,
  pnlReadEnabled: boolean,
  pnlReadBlocker: string,
) {
  const [pnl, setPnl] = useState<Source<PnlData>>(source);

  useEffect(() => {
    if (!pnlReadEnabled) {
      setPnl({ data: null, error: pnlReadBlocker });
      return;
    }
    const slow = createSettledPoll<PnlData>({
      intervalMs: 30_000,
      request: async (signal) => {
        const payload = await fetchJson<unknown>('/api/pnl', { cache: 'no-store', signal });
        const decoded = decodeDashboardPnlData(payload);
        if (decoded === null) throw new Error('INVALID_DASHBOARD_PNL_RESPONSE');
        return decoded;
      },
      onSuccess: (next) => setPnl({ data: next, error: null }),
      onError: (error) => setPnl({ data: null, error: apiErrorMessage(error, 'PnL truth unavailable') }),
    });
    slow.start();
    return slow.stop;
  }, [pnlReadBlocker, pnlReadEnabled, refreshTick]);

  return { pnl };
}

function StatusMark({ tone }: { tone: Tone }) {
  return <span className={`dcx-status-mark ${tone}`} aria-hidden="true">{tone === 'ok' ? <Check size={11} /> : tone === 'bad' ? <X size={10} /> : <CircleAlert size={11} />}</span>;
}

function Metric({ label, value, detail, tone = 'idle' }: { label: string; value: string; detail: string; tone?: Tone }) {
  return (
    <div className={`dcx-summary-cell ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function Dashboard() {
  const {
    state,
    stateStatus,
    stateLastSuccessAtMs,
    stateError,
    privateRead,
    privateReadError,
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    marketsError,
    connected,
    prefs,
    setPage,
  } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
  const [refreshTick, setRefreshTick] = useState(0);
  const [range, setRange] = useState<RangeId>('1M');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useRefreshSignal(() => setRefreshTick((value) => value + 1));
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const privatePresentation = projectPrivateRead(privateRead, nowMs);
  const privateValuesCurrent = privatePresentation.freshness.state === 'CURRENT';
  const pnlReadEnabled = stateStatus === 'CURRENT'
    && state?.privateAccountTruth === 'AVAILABLE'
    && privateReadError === null
    && privateValuesCurrent;
  const pnlReadBlocker = stateStatus !== 'CURRENT'
    ? `Compatibility ${stateStatus} · account PnL read not admitted`
    : state?.privateAccountTruth !== 'AVAILABLE'
      ? `Private account ${state?.privateAccountTruth ?? 'UNKNOWN'} · account PnL read not admitted`
      : privateReadError
        ? `${privateReadError} · account PnL read not admitted`
        : `Private account ${privatePresentation.freshness.label} · account PnL read not admitted`;
  const sources = useDashboardSources(refreshTick, pnlReadEnabled, pnlReadBlocker);
  const admittedPnl = pnlReadEnabled ? sources.pnl.data : null;

  const historyPoints = useMemo(() => {
    const rows = [...(admittedPnl?.equitySnapshots ?? [])]
      .filter((row) => finite(row.totalUsdt) && finite(row.ts))
      .map((row) => ({ ts: row.ts, totalUsdt: row.totalUsdt }));
    rows.sort((left, right) => left.ts - right.ts);
    const deduped: { ts: number; totalUsdt: number }[] = [];
    for (const point of rows) {
      const previous = deduped[deduped.length - 1];
      if (previous && Math.abs(previous.ts - point.ts) < 1_000) deduped[deduped.length - 1] = point;
      else deduped.push(point);
    }
    const rangeMs = RANGES.find((item) => item.id === range)?.ms ?? RANGES[1].ms;
    const cutoff = nowMs - rangeMs;
    const selected = deduped.filter((point) => point.ts >= cutoff);
    const previous = [...deduped].reverse().find((point) => point.ts < cutoff);
    if (previous) selected.unshift(previous);
    return selected;
  }, [admittedPnl?.equitySnapshots, nowMs, range]);

  const historyStats = useMemo(() => {
    if (historyPoints.length < 2) return null;
    const first = historyPoints[0].totalUsdt;
    const last = historyPoints[historyPoints.length - 1].totalUsdt;
    const values = historyPoints.map((point) => point.totalUsdt);
    return {
      first,
      last,
      change: last - first,
      changePct: first > 0 ? ((last / first) - 1) * 100 : null,
      high: Math.max(...values),
      low: Math.min(...values),
    };
  }, [historyPoints]);
  const historyCoverage = !pnlReadEnabled
    ? pnlReadBlocker
    : sources.pnl.error
      ? sources.pnl.error
      : admittedPnl === null
        ? 'Account snapshots pending'
        : historyPoints.length < 2
          ? `UNMEASURED · ${historyPoints.length} complete durable account snapshot${historyPoints.length === 1 ? '' : 's'}`
          : `${historyPoints.length} complete durable account snapshots`;

  // A retained supervisor snapshot is diagnostic only while continuity is
  // broken. Native runtime values re-enter the page only after continuity is
  // proven again.
  const retainedProductSnapshot = productBinding.snapshot;
  const productCurrent = retainedProductSnapshot !== null && productBinding.continuity === 'PROVEN';
  const productSnapshot = productCurrent ? retainedProductSnapshot : null;
  const dashboard = productSnapshot?.dashboard;
  const ledger = dashboard?.summaries.ledger;
  const componentById = (componentId: string) => productSnapshot?.components.find((component) => component.componentId === componentId);
  const spotSource = componentById('public-spot-source');
  const usdMSource = componentById('public-usdm-source');
  const basisComponent = componentById('basis-engine');
  const volumeComponent = componentById('volume-engine');
  const unavailablePosture = { tone: 'bad' as const, statusLabel: 'Unavailable' };
  const supervisorPosture = (component: typeof spotSource) => component?.canonicalPresentation ?? unavailablePosture;
  const basisPosture = supervisorPosture(basisComponent);
  const volumePosture = supervisorPosture(volumeComponent);
  const runtimePresentation = productSnapshot
    ? productSnapshot.canonicalCockpit.strategyRuntime
    // F-061: absence of supervisor truth must not be presented as a measured
    // count of zero live engines. null renders as UNKNOWN.
    : { tone: 'bad' as const, label: 'Canonical Runtime Unavailable', livePublicCount: null };
  const marketFeedReadiness = productSnapshot
    ? productSnapshot.canonicalCockpit.marketFeedReadiness
    : null;
  const rawBasisStrategy = dashboard?.summaries.strategies.basis;
  const rawVolumeStrategy = dashboard?.summaries.strategies.volume;
  const engineValuesCurrent = (
    component: typeof basisComponent,
    summary: typeof rawBasisStrategy,
  ) => Boolean(
    productCurrent
    && summary?.truthLabel === 'LIVE_PUBLIC'
    && component?.canonicalPresentation.status === 'operational'
    && component.freshnessState === 'FRESH',
  );
  const basisStrategy = engineValuesCurrent(basisComponent, rawBasisStrategy) ? rawBasisStrategy : null;
  const volumeStrategy = engineValuesCurrent(volumeComponent, rawVolumeStrategy) ? rawVolumeStrategy : null;

  const marketSurfaceFreshness = productSnapshot?.surfaces.markets.evidence
    .find((datum) => datum.fieldId === 'source-freshness');
  const marketFreshness = resolveMarketFreshness({
    connected,
    error: marketsError,
    sourceTimeMs: marketsUpdatedAt,
    nowMs,
    staleAfterMs: Math.max(12_000, prefs.refreshSec * 2_500),
  });
  const canonicalMarketSourcesCurrent = Boolean(
    marketFeedReadiness?.proven === true
    && (
      (
        marketSurfaceFreshness?.truthLabel === 'LIVE_PUBLIC'
        && marketSurfaceFreshness.value !== null
        && marketSurfaceFreshness.unavailableReason === null
      )
      || (
        marketStatus === 'CURRENT'
        && marketsLastSuccessAtMs !== null
        && marketFreshness.live
      )
    ),
  );
  const marketValuesCurrent = Boolean(
    canonicalMarketSourcesCurrent
    && marketStatus === 'CURRENT'
    && marketsLastSuccessAtMs !== null
    && marketFreshness.live,
  );
  const liveMarkets = useMemo(
    () => selectDashboardMarketValues(markets),
    [markets],
  );
  const liveMarketValues = liveMarkets.map((row) => (
    `${row.base} ${formatCompactUsdtPrice(row.spot)}`
  ));
  const marketValueDetail = marketValuesCurrent && liveMarketValues.length > 0
    ? `Spot · ${liveMarketValues.join(' · ')} USDT`
    : null;
  const leadMarket = liveMarkets[0] ?? null;
  const leadMarketPerp = leadMarket?.perpMark;
  const leadMarketBasis = leadMarket?.basisPct;
  const leadMarketStructureValues = leadMarket
    ? [
        finite(leadMarketPerp) ? `Perp ${formatCompactUsdtPrice(leadMarketPerp)} USDT` : null,
        finite(leadMarketBasis) ? `Basis ${fmtBasis(leadMarketBasis)}` : null,
      ].filter((value): value is string => value !== null)
    : [];
  const leadMarketStructureDetail = leadMarket && leadMarketStructureValues.length > 0
    ? `${leadMarket.symbol} · ${leadMarketStructureValues.join(' · ')}`
    : null;
  const marketStateDetail = !productCurrent
    ? `Product continuity ${productBinding.continuity}`
    : marketFeedReadiness?.proven !== true
      ? marketFeedReadiness?.detail ?? 'Canonical market readiness unproven'
      : !canonicalMarketSourcesCurrent
        ? marketSurfaceFreshness?.unavailableReason ?? 'Canonical market source freshness unavailable'
        : marketStatus === 'STALE'
          ? 'STALE LAST-KNOWN · numeric market values withheld'
          : marketStatus === 'UNAVAILABLE'
            ? `Market feed unavailable${marketsError ? ` · ${marketsError}` : ''}`
            : marketStatus === 'LOADING'
              ? 'Market feed loading'
              : marketFreshness.status === 'STALE'
                ? 'Market source stale · numeric values withheld'
                : marketFreshness.status === 'DISCONNECTED'
                  ? 'Market stream disconnected · numeric values withheld'
                  : marketFreshness.status === 'ERROR'
                    ? `Market source error${marketsError ? ` · ${marketsError}` : ''}`
                    : marketFreshness.status === 'UNKNOWN'
                      ? 'Market source freshness unknown'
                      : 'No positive finite Spot market row is available';
  const publicSourceTone: Tone = marketValueDetail
    ? 'ok'
    : marketStatus === 'STALE' || marketFreshness.status === 'STALE'
      ? 'warn'
      : 'bad';
  const canonicalPublicSourceDetail = [spotSource, usdMSource].filter(Boolean).map((component) => (
    `${component!.componentId} · ${component!.observedLifecycle} · ${component!.capability} · ${component!.truthLabel}`
  )).join(' / ') || 'UNKNOWN · canonical public-source components are unavailable';
  const publicSourceDetail = [
    marketValueDetail ?? marketStateDetail,
    marketValueDetail ? leadMarketStructureDetail : null,
    canonicalPublicSourceDetail,
  ].filter((value): value is string => value !== null).join(' / ');
  const ledgerReady = Boolean(
    ledger?.writable === true
    && ledger.schemaCompatibilityState === 'AVAILABLE',
  );
  const integrityChecks: IntegrityCheck[] = [
    {
      label: 'Account Sync',
      detail: privateReadError
        ?? `${privatePresentation.stateLabel} · ${privatePresentation.freshness.label} · ${privatePresentation.observedLabel} · ${privatePresentation.reconciliationLabel}`,
      tone: privatePresentation.guardTone,
    },
    {
      label: 'Public Market Feeds',
      detail: publicSourceDetail,
      tone: publicSourceTone,
    },
    {
      label: 'Basis Runtime',
      detail: basisComponent
        ? `${basisComponent.observedLifecycle} · ${basisComponent.capability} · ${basisComponent.truthLabel}${basisComponent.blockerCode ? ` · ${basisComponent.blockerCode}` : ''}`
        : 'UNKNOWN · canonical Basis component is unavailable',
      tone: basisPosture.tone,
    },
    {
      label: 'Volume Runtime',
      detail: volumeComponent
        ? `${volumeComponent.observedLifecycle} · ${volumeComponent.capability} · ${volumeComponent.truthLabel}${volumeComponent.blockerCode ? ` · ${volumeComponent.blockerCode}` : ''}`
        : 'UNKNOWN · canonical Volume component is unavailable',
      tone: volumePosture.tone,
    },
    {
      label: 'Ledger Database',
      detail: ledgerReady
        ? `Writable · schema ${ledger?.currentSchemaVersion ?? 'UNKNOWN'}`
        : ledger?.schemaCompatibilityReason ?? productBinding.error ?? 'UNKNOWN · canonical Ledger evidence unavailable',
      tone: ledgerReady ? 'ok' : 'bad',
    },
    {
      label: 'API Key Posture',
      detail: `${privatePresentation.postureLabel} · ${privatePresentation.identityLabel}`,
      tone: worstTone(privatePresentation.postureTone, privatePresentation.freshness.tone),
    },
  ];
  const passingChecks = integrityChecks.filter((check) => check.tone === 'ok').length;

  const runtimeRows: RuntimeRow[] = [
    {
      id: 'basis',
      name: 'Basis Engine',
      source: basisComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: basisPosture.tone,
      state: basisPosture.statusLabel,
      intake: basisComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: basisComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: basisStrategy?.candidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: basisStrategy?.proposalCount ?? 'UNKNOWN',
      constraint: basisComponent?.blockerCode ?? 'UNKNOWN · canonical blocker not published',
      updatedAt: basisStrategy
        ? latestKnown([basisComponent?.lastAdvanceAtMs, basisComponent?.heartbeatAtMs, basisStrategy.lastDecisionAtMs])
        : null,
      page: 'strategies',
    },
    {
      id: 'volume',
      name: 'Volume Engine',
      source: volumeComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: volumePosture.tone,
      state: volumePosture.statusLabel,
      intake: volumeComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: volumeComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: volumeStrategy?.candidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: volumeStrategy?.proposalCount ?? 'UNKNOWN',
      constraint: volumeComponent?.blockerCode ?? 'UNKNOWN · canonical blocker not published',
      updatedAt: volumeStrategy
        ? latestKnown([volumeComponent?.lastAdvanceAtMs, volumeComponent?.heartbeatAtMs, volumeStrategy.lastDecisionAtMs])
        : null,
      page: 'volume',
    },
  ];

  const recentDecisions = productCurrent
    ? dashboard?.recentCorrelatedDecisions.slice(0, 6).map((event) => ({
        ...event,
        ts: event.occurredAtMs,
      })) ?? []
    : [];

  const pnlTruthState = admittedPnl?.integrity.state ?? 'UNKNOWN';
  const pnlEvidenceAvailable = pnlTruthState !== 'UNKNOWN';
  const pnlDays = pnlEvidenceAvailable
    ? admittedPnl?.integrity.days.map((day) => ({ day: day.day, usd: day.netUsd })) ?? []
    : [];
  const netTotal = pnlEvidenceAvailable
    ? pnlDays.reduce((sum, day) => sum + day.usd, 0)
    : null;
  const winningDays = pnlDays.filter((day) => day.usd > 0);
  const losingDays = pnlDays.filter((day) => day.usd < 0);
  const grossProfit = winningDays.reduce((sum, day) => sum + day.usd, 0);
  const grossLoss = Math.abs(losingDays.reduce((sum, day) => sum + day.usd, 0));
  const dailyProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : winningDays.length ? Infinity : null;
  const totalFeesUsd = pnlEvidenceAvailable
    ? admittedPnl?.integrity.days.reduce((sum, day) => sum + day.feeUsd, 0) ?? null
    : null;

  const executionSummary = productCurrent ? dashboard?.summaries.execution : null;
  const controlState = {
    label: executionSummary?.mode ?? 'OWNER_GATED',
    detail: executionSummary?.barrier ?? 'LIVE_EXECUTION_NOT_IMPLEMENTED',
    tone: (executionSummary ? 'warn' : 'bad') as Tone,
  };
  const pipelineCounts = productSnapshot?.surfaces.dashboard.evidence
    .find((datum) => datum.fieldId === 'pipeline-counts');
  const capitalSummary = productCurrent ? dashboard?.summaries.capital : null;
  const riskSummary = productCurrent ? dashboard?.summaries.risk : null;
  const latestUpdate = productSnapshot?.evaluatedAtMs ?? 0;

  if (!state) {
    return (
      <div className="container page dash-page dcx-page">
        <section className="dcx-frame dcx-loading" aria-label="dashboard workspace">
          <Radio size={18} />
          <span><b>Connecting Dashboard</b><small>Waiting for public engine and ledger state.</small></span>
        </section>
      </div>
    );
  }

  const open = (page: Page) => setPage(page);

  return (
    <div className="container page dash-page dcx-page">
      <section className="dcx-frame" aria-label="dashboard workspace">
        <header className="dcx-toolbar">
          <div className="dcx-title">
            <span className="dcx-source-mark"><img className="dcx-page-mark" src="/dashboard-blocks.png" alt="" aria-hidden="true" /></span>
            <span className="dcx-title-content">
              <h1>Dashboard</h1>
              <span className={`dcx-live ${runtimePresentation.tone === 'ok' ? 'active' : 'degraded'}`}><i aria-hidden="true" />{runtimePresentation.label}</span>
              <span className="dcx-updated">{latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : 'Connecting Sources'}</span>
            </span>
          </div>
          <div className="dcx-toolbar-actions">
            <button type="button" onClick={() => open('account')}><WalletCards size={14} />Account</button>
            <button type="button" onClick={() => open('risk')}><ShieldCheck size={14} />Risk</button>
          </div>
        </header>

        {stateStatus !== 'CURRENT' && (
          <div className="dcx-state-truth" role="alert">
            {stateStatus === 'STALE' ? 'STALE LAST-KNOWN' : 'UNAVAILABLE'} · Compatibility state
            {stateLastSuccessAtMs === null ? ' has no successful read.' : ` last succeeded ${timeAgo(stateLastSuccessAtMs)}.`}
            {stateError ? ` ${stateError}` : ''}
          </div>
        )}

        <div className="dcx-summary" aria-label="Executive Summary">
          <Metric
            label="Private Account"
            value={privatePresentation.stateLabel}
            detail={`${privatePresentation.coverageLabel} · ${privatePresentation.freshness.label}`}
            tone={privatePresentation.guardTone}
          />
          <Metric
            label="Today’s Account Change"
            value="—"
            detail="Day-open valuation is outside private-read v1"
            tone="warn"
          />
          <Metric
            label="Available USDT"
            value={exactOrDash(privateValuesCurrent ? privatePresentation.spotAvailableUsdt : null)}
            detail={`${privateRead.spot.state} · Spot free balance only · ${privatePresentation.freshness.label}`}
            tone={privateValuesCurrent && privatePresentation.spotAvailableUsdt !== null ? privatePresentation.guardTone : 'warn'}
          />
          <Metric
            label="Active Exposure"
            value={capitalSummary?.activeExposureAmount ?? '—'}
            detail={capitalSummary?.activeExposureCount === null || capitalSummary?.activeExposureCount === undefined
              ? `${capitalSummary?.truthLabel ?? 'UNKNOWN'} · exposure count unavailable`
              : `${capitalSummary.activeExposureCount} canonical exposure${capitalSummary.activeExposureCount === 1 ? '' : 's'} · ${capitalSummary.truthLabel}`}
            tone={capitalSummary?.activeExposureAmount === null || capitalSummary?.activeExposureAmount === undefined
              ? 'warn'
              : capitalSummary.truthLabel === 'LIVE_PUBLIC' && capitalSummary.activeExposureCount === 0
                ? 'idle'
                : 'warn'}
          />
          <Metric
            label="Engine Pipeline"
            value={pipelineCounts?.value ?? 'UNKNOWN'}
            detail={pipelineCounts?.unavailableReason ?? `${pipelineCounts?.truthLabel ?? 'UNKNOWN'} · canonical owner projection`}
            tone={pipelineCounts?.truthLabel === 'LIVE_PUBLIC' && pipelineCounts.value !== null ? 'idle' : 'warn'}
          />
          <Metric label="Execution Authority" value={controlState.label} detail={controlState.detail} tone={controlState.tone} />
        </div>

        <ProductSurfaceAdapter surfaceId="dashboard" />

        <section className="dcx-section dcx-capital-section">
          <header className="dcx-section-head">
            <span><b>Account Progress</b><small title={admittedPnl?.integrity.reasons.join(' · ') || undefined}>{historyCoverage}</small></span>
            <div className="dcx-range" role="tablist" aria-label="Account History Range">
              {RANGES.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={range === item.id} onClick={() => setRange(item.id)}>{item.id}</button>
              ))}
            </div>
          </header>
          <div className="dcx-capital-grid">
            <div className="dcx-chart-wrap">
              {historyPoints.length >= 2 ? (
                <EquityChart snaps={historyPoints} height={230} />
              ) : (
                <div className="dcx-empty"><BarChart3 size={18} /><span><b>Account History Unmeasured</b><small>Two complete durable account snapshots are required; absence is not interpreted as zero.</small></span></div>
              )}
              <div className="dcx-chart-facts">
                <span><small>Range Open</small><b>{historyStats ? fmtPrice(historyStats.first) : '—'}</b></span>
                <span><small>Range Change</small><b className={historyStats ? signClass(historyStats.change) : ''}>{historyStats ? `${historyStats.change > 0 ? '+' : ''}${fmtPrice(historyStats.change)}` : '—'}</b></span>
                <span><small>Range High</small><b>{historyStats ? fmtPrice(historyStats.high) : '—'}</b></span>
                <span><small>Range Low</small><b>{historyStats ? fmtPrice(historyStats.low) : '—'}</b></span>
              </div>
            </div>
            <aside className="dcx-integrity" aria-label="Core Systems">
              <div className="dcx-integrity-head">
                <span><b>Core Systems</b><small>{passingChecks} Of {integrityChecks.length} Core Checks Passing</small></span>
                <strong>{passingChecks}/{integrityChecks.length}</strong>
              </div>
              <div className="dcx-integrity-list">
                {integrityChecks.map((check) => (
                  <div key={check.label} className="dcx-integrity-row">
                    <StatusMark tone={check.tone} />
                    <span><b>{check.label}</b><small>{check.detail}</small></span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="dcx-section dcx-runtime-section">
          <header className="dcx-section-head">
            <span><b>Strategy Runtime</b><small>Canonical Lifecycle · Capability · Truth</small></span>
            <em>{runtimePresentation.livePublicCount === null ? 'UNKNOWN' : runtimePresentation.livePublicCount}/{runtimeRows.length} Engines Live Public</em>
          </header>
          <div className="dcx-runtime-scroll">
            <div className="dcx-runtime-canvas" role="table" aria-label="Strategy Runtime">
              <div className="dcx-runtime-header" role="row">
                <span role="columnheader">Engine</span><span role="columnheader">Capability</span><span role="columnheader">Truth</span><span role="columnheader">Candidates</span><span role="columnheader">Focused</span><span role="columnheader">Proposals</span><span role="columnheader">Primary Constraint</span><span role="columnheader">Updated</span>
              </div>
              {runtimeRows.map((row) => (
                <button className="dcx-runtime-row" type="button" role="row" key={row.id} onClick={() => open(row.page)}>
                  <span className="dcx-runtime-engine" role="cell">
                    <i className={`dcx-runtime-icon ${row.id}`}>{row.id === 'basis' ? <Gauge size={17} /> : <ScanLine size={17} />}</i>
                    <span><b>{row.name}</b><small>{row.source}</small></span>
                    <em className={row.tone}><i />{row.state}</em>
                  </span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.intake}</b><small>Canonical Capability</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.coverage}</b><small>Canonical Truth</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.watching}</b><small>Canonical Candidates</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.focused}</b><small>Not Published</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.proposals}</b><small>Canonical Proposals</small></span>
                  <span className="dcx-runtime-constraint" role="cell"><b>{row.constraint}</b><small>{row.id === 'basis' ? `Private Liabilities ${privateRead.reconciliation.liabilities.state}` : 'Canonical Component Blocker'}</small></span>
                  <span className="dcx-runtime-open" role="cell"><b>{sourceAge(row.updatedAt)}</b><ChevronRight size={14} /></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="dcx-operations">
          <div className="dcx-attention">
            <header className="dcx-section-head">
              <span><b>Attention Queue</b><small>Current Constraints And Highest-Signal Work</small></span>
            </header>
            <div className="dcx-attention-list">
              <button type="button" onClick={() => open('loans')}>
                <StatusMark tone={privateValuesCurrent && privatePresentation.guardTone === 'ok' && privateRead.reconciliation.liabilities.state === 'RECONCILED' ? 'ok' : privateRead.reconciliation.liabilities.state === 'PARTIAL' ? 'warn' : 'bad'} />
                <span><b>Borrow Verification</b><small>{privateRead.reconciliation.liabilities.state} · {privatePresentation.freshness.label} · loan catalog and maximum-borrowable remain outside private-read v1</small></span>
                <em>{!privateValuesCurrent || privatePresentation.counts.liabilities === null ? '—' : `${privatePresentation.counts.liabilities} Assets`}</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('strategies')}>
                <StatusMark tone={basisPosture.tone} />
                <span><b>Basis Decision Queue</b><small>{basisComponent?.blockerCode ?? `${basisComponent?.truthLabel ?? 'UNKNOWN'} · ${basisStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{basisStrategy?.proposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('volume')}>
                <StatusMark tone={volumePosture.tone} />
                <span><b>Volume Decision Queue</b><small>{volumeComponent?.blockerCode ?? `${volumeComponent?.truthLabel ?? 'UNKNOWN'} · ${volumeStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{volumeStrategy?.proposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('risk')}>
                <StatusMark tone="warn" />
                <span><b>Execution Guard</b><small>OWNER_GATED · live execution is mechanically unavailable</small></span>
                <em>{riskSummary?.rejectionCount === null || riskSummary?.rejectionCount === undefined ? 'UNKNOWN Rejections' : `${riskSummary.rejectionCount} Canonical Rejections`}</em><ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="dcx-decisions">
            <header className="dcx-section-head">
              <span><b>Recent Decisions</b><small>Ledgered Engine And Risk Evidence</small></span>
              <button type="button" onClick={() => open('ledger')}>Open Logs <ArrowUpRight size={13} /></button>
            </header>
            <div className="dcx-decision-list">
              {recentDecisions.length ? recentDecisions.map((event) => (
                <button type="button" key={event.eventId} onClick={() => open('ledger')}>
                  <span className="dcx-decision-time">{formatClockZone(event.ts, prefs.clockZone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, 'en-GB')}</span>
                  <StatusMark tone={traceTone(event)} />
                  <span className="dcx-decision-source"><b>{event.componentId}</b><small>{event.truthLabel}</small></span>
                  <span className="dcx-decision-message">{event.kind}</span>
                  <em>{event.failureCode ?? 'RECORDED'}</em>
                </button>
              )) : (
                <div className="dcx-empty compact"><Activity size={17} /><span><b>{productCurrent ? 'No Recent Canonical Decisions' : 'Canonical Decisions Unavailable'}</b><small>{productCurrent ? 'The supervisor has no correlated decision evidence in its current window.' : `Product continuity ${productBinding.continuity}; retained decisions are withheld.`}</small></span></div>
              )}
            </div>
          </div>
        </section>

        <section className="dcx-section dcx-performance">
          <header className="dcx-section-head">
            <span>
              <b>{pnlTruthState === 'UNKNOWN' ? 'Account PnL Context Unavailable' : pnlTruthState === 'PARTIAL' ? 'Partial Account PnL Context' : 'Validated Account PnL Context'}</b>
              <small title={admittedPnl?.integrity.reasons.join(' · ') || undefined}>{pnlTruthState === 'UNKNOWN' ? !pnlReadEnabled ? pnlReadBlocker : sources.pnl.error ?? 'UNKNOWN · no durable account PnL evidence is available' : pnlTruthState === 'PARTIAL' ? 'Missing Cost Basis Or Fee Valuation · not attributed to Basis or Volume' : 'Net closed-fill outcomes · not attributed to Basis or Volume'}</small>
            </span>
            <em>{pnlTruthState === 'UNKNOWN' ? 'UNKNOWN' : `${pnlDays.length} Account Day${pnlDays.length === 1 ? '' : 's'}`}</em>
          </header>
          {pnlEvidenceAvailable && pnlDays.length > 0 && netTotal !== null ? (
            <>
              <div className="dcx-performance-summary">
                <Metric label={pnlTruthState === 'PARTIAL' ? 'Partial Net Account PnL' : 'Net Account PnL'} value={`${netTotal > 0 ? '+' : ''}${fmtPrice(netTotal)}`} detail={pnlTruthState === 'PARTIAL' ? 'Incomplete account fill evidence' : 'Realized less USD-valued fees'} tone={pnlTruthState === 'PARTIAL' ? 'warn' : netTotal >= 0 ? 'ok' : 'bad'} />
                <Metric label="Account Days" value={String(pnlDays.length)} detail="With durable net outcomes" />
                <Metric label="Winning Days" value={String(winningDays.length)} detail={`${pnlDays.length ? ((winningDays.length / pnlDays.length) * 100).toFixed(0) : 0}% Day Win Rate`} />
                <Metric label="Losing Days" value={String(losingDays.length)} detail="Net Account-Day Outcomes" />
                <Metric label="Daily Profit Factor" value={dailyProfitFactor === null ? '—' : dailyProfitFactor === Infinity ? '∞' : dailyProfitFactor.toFixed(2)} detail="Gross Winning Days / Losing Days" />
                <Metric label="USD-Valued Fees" value={totalFeesUsd === null ? 'UNKNOWN' : fmtPrice(totalFeesUsd)} detail="Server-valued daily fee evidence" />
              </div>
              {pnlDays.length >= 2 ? <div className="dcx-performance-chart"><PerfChart days={pnlDays} /></div> : null}
            </>
          ) : (
            <div className="dcx-empty-performance">
              <BarChart3 size={20} />
              <span><b>{pnlEvidenceAvailable ? 'Account PnL Context Is Waiting For The First Durable Outcome' : 'Account PnL Evidence Is Unavailable'}</b><small>{pnlEvidenceAvailable ? 'Account win rate and profit factor remain unreported until the ledger has real net outcomes. Strategy attribution remains UNKNOWN.' : 'UNKNOWN · unavailable private/account truth is not converted into validated zero PnL.'}</small></span>
              <button type="button" onClick={() => open('account')}>Review Fills <ChevronRight size={14} /></button>
            </div>
          )}
        </section>

        <footer className="dcx-source-footer">
          <span><Database size={13} />Sources: {marketValueDetail ? 'Current Public Market Values' : 'Public Market Values Unavailable'}, {productCurrent ? 'Canonical Engine Snapshot' : 'Engine Snapshot Withheld'}, SQLite Ledger · Private Account {privatePresentation.stateLabel}</span>
          <span>{productSnapshot
            ? `${productSnapshot.revision} · Machine ${productSnapshot.ownerView.machineReady} · ${productSnapshot.opsIntakeInterlock.state}`
            : `Product Integration ${productBinding.continuity}`}</span>
        </footer>
      </section>
    </div>
  );
}
