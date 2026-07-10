import { useEffect, useMemo, useRef, useState } from 'react';
import { BinanceMark } from '../components/BinanceMark';
import { Donut } from '../components/Donut';
import {
  IconBook,
  IconCaret,
  IconChart,
  IconCoins,
  IconExchange,
  IconGrid,
  IconLayers,
  IconPulse,
  IconReceipt,
  IconSearch,
  IconWallet,
} from '../components/Icons';
import { TokenIcon } from '../components/TokenIcon';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, signClass, timeAgo } from '../format';
import { useRefreshSignal } from '../lib/refresh';
import { useStore } from '../store';
import type { BalanceEntry, FillRow, LoansSnapshot, OpenOrderRow } from '../types';
import './Account.css';

type AccountView = 'overview' | 'wallets' | 'orders' | 'fills';
type RangeId = '1W' | '1M' | '3M' | '6M';

interface WalletBalanceRow {
  walletName: string;
  balance: number;
  active: boolean;
}

interface SourceState<T> {
  data: T | null;
  fetchedAt: number | null;
  error: string | null;
}

const EMPTY_SOURCE = <T,>(): SourceState<T> => ({ data: null, fetchedAt: null, error: null });
const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI']);
const WALLET_ORDER = [
  'Spot',
  'Earn',
  'Cross Margin',
  'Isolated Margin',
  'Funding',
  'USDⓈ-M Futures',
  'COIN-M Futures',
  'Options',
  'Trading Bots',
  'Copy Trading',
];
const RANGES: { id: RangeId; ms: number }[] = [
  { id: '1W', ms: 7 * 86_400_000 },
  { id: '1M', ms: 30 * 86_400_000 },
  { id: '3M', ms: 90 * 86_400_000 },
  { id: '6M', ms: 180 * 86_400_000 },
];

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.35" fill="none" stroke="currentColor" strokeWidth="1.45" />
      {off && <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />}
    </svg>
  );
}

function walletIcon(name: string): JSX.Element {
  if (name === 'Spot') return <IconWallet size={18} />;
  if (name === 'Earn') return <IconCoins size={18} />;
  if (name === 'Cross Margin') return <IconLayers size={18} />;
  if (name === 'Isolated Margin') return <IconExchange size={18} />;
  if (name === 'Funding') return <IconReceipt size={18} />;
  if (name === 'USDⓈ-M Futures') return <IconChart size={18} />;
  if (name === 'COIN-M Futures') return <IconPulse size={18} />;
  if (name === 'Options') return <IconBook size={18} />;
  return <IconGrid size={18} />;
}

function compactDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function samplePoints<T>(rows: T[], max = 54): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => rows[Math.round(index * step)]);
}

/** Spot-only history is intentionally named as such. Binance transfers,
 * borrowing, repayments, and wallet moves affect this line, so it must never
 * be presented as portfolio PnL. */
function SpotBalanceChart({
  points,
  rangeMs,
  hidden,
  rebuiltBefore,
}: {
  points: { ts: number; v: number }[];
  rangeMs: number;
  hidden: boolean;
  rebuiltBefore: number | null;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number; ts: number } | null>(null);

  if (hidden) return <div className="accountx-private">Balances Hidden</div>;

  const sorted = [...points].filter((point) => finite(point.v)).sort((a, b) => a.ts - b.ts);
  const end = Math.max(Date.now(), sorted[sorted.length - 1]?.ts ?? 0);
  const requestedStart = end - rangeMs;
  const first = sorted[0]?.ts ?? end;
  const start = Math.max(requestedStart, first);
  const visible = samplePoints(sorted.filter((point) => point.ts >= start));
  if (visible.length < 2) return <div className="accountx-empty compact"><b>History Is Warming Up</b><span>Spot snapshots appear after the signed account source records enough points.</span></div>;

  const width = 1000;
  const height = 236;
  const axisWidth = 68;
  const plotWidth = width - axisWidth;
  const values = visible.map((point) => point.v);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.max(1, maximum * 0.02);
  const low = Math.max(0, minimum - span * 0.12);
  const high = maximum + span * 0.12;
  const x = (timestamp: number) => ((timestamp - start) / Math.max(1, end - start)) * (plotWidth - 8) + 4;
  const y = (value: number) => height - 24 - ((value - low) / Math.max(1e-9, high - low)) * (height - 38);
  const path = visible.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.ts).toFixed(1)} ${y(point.v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(visible[visible.length - 1].ts).toFixed(1)} ${height - 22} L${x(visible[0].ts).toFixed(1)} ${height - 22} Z`;
  const grid = Array.from({ length: 4 }, (_, index) => low + ((3 - index) / 3) * (high - low));
  const ticks = Array.from({ length: 5 }, (_, index) => start + (index / 4) * (end - start));

  const onMove = (event: { clientX: number }) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = start + fraction * (end - start);
    let closest = visible[0];
    for (const point of visible) if (Math.abs(point.ts - target) < Math.abs(closest.ts - target)) closest = point;
    setHover({ x: x(closest.ts) / plotWidth, value: closest.v, ts: closest.ts });
  };

  return (
    <div className="accountx-chart" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Spot balance history">
        {grid.map((value) => (
          <g key={value}>
            <line x1="0" x2={plotWidth} y1={y(value)} y2={y(value)} className="accountx-gridline" vectorEffect="non-scaling-stroke" />
            <text x={width - 2} y={y(value) + 4} textAnchor="end" className="accountx-axis-label">{fmtMoney(value)}</text>
          </g>
        ))}
        <path d={area} className="accountx-chart-area" />
        <path d={path} className="accountx-chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="accountx-date-axis">{ticks.map((tick) => <span key={tick}>{compactDate(tick)}</span>)}</div>
      {hover && (
        <>
          <span className="accountx-crosshair" style={{ left: `${hover.x * 100}%` }} />
          <span className={`accountx-chart-tip ${hover.x > 0.76 ? 'flip' : ''}`} style={{ left: `${hover.x * 100}%` }}>
            <b>{fmtPrice(hover.value)}</b>
            <em>{new Date(hover.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
          </span>
        </>
      )}
      {rebuiltBefore !== null && start < rebuiltBefore && (
        <span className="accountx-history-note">Earlier values are reconstructed from real deposits and withdrawals; recent values use Binance Spot snapshots.</span>
      )}
    </div>
  );
}

export function Account() {
  const { state, markets, prefs } = useStore();
  const [view, setView] = useState<AccountView>('overview');
  const [range, setRange] = useState<RangeId>('1M');
  const [query, setQuery] = useState('');
  const [expandedWallet, setExpandedWallet] = useState<string | null>('Spot');
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const [walletSource, setWalletSource] = useState<SourceState<WalletBalanceRow[]>>(EMPTY_SOURCE);
  const [earnSource, setEarnSource] = useState<SourceState<{ asset: string; amount: number; apr: number }[]>>(EMPTY_SOURCE);
  const [loanSource, setLoanSource] = useState<SourceState<LoansSnapshot>>(EMPTY_SOURCE);
  const [historySource, setHistorySource] = useState<SourceState<{ rows: { ts: number; totalUsdt: number }[]; reconstructedBefore: number | null }>>(EMPTY_SOURCE);
  const [fills, setFills] = useState<FillRow[]>([]);
  const [fillsError, setFillsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((value) => value + 1));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const read = async <T,>(url: string): Promise<T> => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json() as Promise<T>;
      };
      void read<{ rows?: WalletBalanceRow[]; fetchedAt?: number | null; error?: string }>('/api/wallet-balances')
        .then((payload) => alive && setWalletSource({ data: payload.rows ?? [], fetchedAt: payload.fetchedAt ?? null, error: payload.error ?? null }))
        .catch((error) => alive && setWalletSource((current) => ({ ...current, error: String(error instanceof Error ? error.message : error) })));
      void read<{ rows?: { asset: string; amount: number; apr: number }[]; fetchedAt?: number | null; error?: string }>('/api/earn')
        .then((payload) => alive && setEarnSource({ data: payload.rows ?? [], fetchedAt: payload.fetchedAt ?? null, error: payload.error ?? null }))
        .catch((error) => alive && setEarnSource((current) => ({ ...current, error: String(error instanceof Error ? error.message : error) })));
      void read<LoansSnapshot>('/api/loans')
        .then((payload) => alive && setLoanSource({ data: payload, fetchedAt: payload.fetchedAt ?? null, error: payload.error ?? null }))
        .catch((error) => alive && setLoanSource((current) => ({ ...current, error: String(error instanceof Error ? error.message : error) })));
      void read<{ rows?: { ts: number; totalUsdt: number }[]; reconstructedBefore?: number | null; fetchedAt?: number | null; error?: string }>('/api/equity-history')
        .then((payload) => alive && setHistorySource({
          data: { rows: payload.rows ?? [], reconstructedBefore: payload.reconstructedBefore ?? null },
          fetchedAt: payload.fetchedAt ?? null,
          error: payload.error ?? null,
        }))
        .catch((error) => alive && setHistorySource((current) => ({ ...current, error: String(error instanceof Error ? error.message : error) })));
      void read<FillRow[]>('/api/fills')
        .then((payload) => { if (alive) { setFills(payload); setFillsError(null); } })
        .catch((error) => { if (alive) setFillsError(String(error instanceof Error ? error.message : error)); });
    };
    void load();
    const timer = window.setInterval(load, Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [prefs.dataCadence?.account, refreshTick]);

  const account = state?.account ?? null;
  const binance = state?.binance ?? null;
  const loans = loanSource.data;
  const earnRows = earnSource.data ?? [];
  const spotRows = useMemo(
    () => (account?.entries ?? []).filter((entry) => !(entry.asset.startsWith('LD') && entry.asset.length > 3)),
    [account?.entries],
  );
  const priceOf = (asset: string): number | null => {
    if (STABLE_ASSETS.has(asset)) return 1;
    return markets.find((market) => market.symbol === `${asset}USDT`)?.spot ?? null;
  };
  const btcSpot = priceOf('BTC');
  const earnValue = earnRows.reduce((sum, row) => sum + row.amount * (priceOf(row.asset) ?? 0), 0);
  const weightedEarnApr = earnValue > 0
    ? earnRows.reduce((sum, row) => sum + row.amount * (priceOf(row.asset) ?? 0) * row.apr, 0) / earnValue
    : null;
  const margin = loans?.margin ?? null;
  const marginNet = margin?.available && finite(btcSpot) ? margin.totalNetAssetBtc * btcSpot : null;
  const marginLiability = margin?.available && finite(btcSpot) ? margin.totalLiabilityBtc * btcSpot : null;
  const flexibleDebt = (loans?.ongoing ?? []).reduce((sum, loan) => sum + loan.totalDebt * (priceOf(loan.loanCoin) ?? 0), 0);
  const flexibleCollateral = (loans?.ongoing ?? []).reduce((sum, loan) => sum + loan.collateralAmount * (priceOf(loan.collateralCoin) ?? 0), 0);
  const flexibleNet = flexibleCollateral - flexibleDebt;
  const fallbackCapital = account
    ? account.totalUsdt + earnValue + (marginNet ?? 0) + flexibleNet
    : null;
  const officialWalletTotal = walletSource.data === null
    ? null
    : walletSource.data.reduce((sum, wallet) => sum + wallet.balance, 0);
  const netCapital = officialWalletTotal ?? fallbackCapital;
  const btcEquivalent = finite(netCapital) && finite(btcSpot) && btcSpot > 0 ? netCapital / btcSpot : null;
  const totalLiability = flexibleDebt + (marginLiability ?? 0);
  const realizedToday = account?.realizedTodayUsd ?? null;
  const spotChange = account?.dayChangeUsd ?? null;
  const spotChangePct = finite(spotChange) && finite(account?.dayOpenEquity) && account!.dayOpenEquity! > 0
    ? (spotChange / account!.dayOpenEquity!) * 100
    : null;

  const historyPoints = useMemo(() => {
    const rows = [...(historySource.data?.rows ?? [])]
      .filter((row) => finite(row.totalUsdt))
      .map((row) => ({ ts: row.ts, v: row.totalUsdt }));
    if (account && finite(account.totalUsdt)) rows.push({ ts: Date.now(), v: account.totalUsdt });
    rows.sort((a, b) => a.ts - b.ts);
    const deduped: { ts: number; v: number }[] = [];
    for (const point of rows) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(last.ts - point.ts) < 1_000) deduped[deduped.length - 1] = point;
      else deduped.push(point);
    }
    return deduped;
  }, [account?.totalUsdt, historySource.data?.rows]);

  const walletRows = useMemo(() => [...(walletSource.data ?? [])].sort((left, right) => {
    const leftIndex = WALLET_ORDER.indexOf(left.walletName);
    const rightIndex = WALLET_ORDER.indexOf(right.walletName);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  }), [walletSource.data]);
  const allocation = walletRows.filter((wallet) => wallet.balance > 0).map((wallet) => ({ label: wallet.walletName, value: wallet.balance }));
  const queryText = query.trim().toLowerCase();
  const walletMatches = (walletName: string) => {
    if (!queryText) return true;
    if (walletName.toLowerCase().includes(queryText)) return true;
    if (walletName === 'Spot') return spotRows.some((row) => row.asset.toLowerCase().includes(queryText));
    if (walletName === 'Earn') {
      return earnRows.some((row) => row.asset.toLowerCase().includes(queryText))
        || (loans?.ongoing ?? []).some((loan) => `${loan.loanCoin} ${loan.collateralCoin} flexible loan`.toLowerCase().includes(queryText));
    }
    if (walletName === 'Cross Margin') return (margin?.assets ?? []).some((row) => row.asset.toLowerCase().includes(queryText));
    return false;
  };
  const visibleWallets = walletRows.filter((wallet) => walletMatches(wallet.walletName));
  const openOrders = (state?.openOrders ?? []).filter((order) => !queryText || `${order.symbol} ${order.side} ${order.type} ${order.status} ${order.orderId}`.toLowerCase().includes(queryText));
  const visibleFills = fills.filter((fill) => !queryText || `${fill.symbol} ${fill.side} ${fill.source} ${fill.tradeId} ${fill.orderId ?? ''}`.toLowerCase().includes(queryText));

  const toggleMask = () => {
    setMask((current) => {
      localStorage.setItem('cosmos-balance-mask', current ? '0' : '1');
      return !current;
    });
  };
  const money = (value: number | null | undefined) => mask ? '••••••' : fmtPrice(value);
  const quantity = (value: number | null | undefined) => mask ? '••••' : fmtQty(value);
  const share = (value: number) => mask ? '••' : finite(netCapital) && netCapital > 0 ? fmtPct((value / netCapital) * 100, 2, false) : '—';

  const currentRange = RANGES.find((item) => item.id === range) ?? RANGES[1];
  const sourceErrors = [walletSource.error, earnSource.error, loanSource.error, historySource.error, fillsError].filter(Boolean) as string[];
  const streamOpen = binance?.userStream === 'open' || binance?.userStream === 'live';
  const syncClass = !binance?.keysPresent || !binance.connected ? 'bad' : streamOpen ? 'live' : 'partial';
  const syncLabel = !binance?.keysPresent
    ? 'Not Connected'
    : !binance.connected
      ? 'Sync Failed'
      : `${streamOpen ? 'Live' : 'Polling'} · ${timeAgo(binance.lastSyncTs)}`;
  const rowCount = view === 'wallets' ? visibleWallets.length : view === 'orders' ? openOrders.length : view === 'fills' ? visibleFills.length : historyPoints.length;
  const rowLabel = view === 'wallets' ? 'Wallets' : view === 'orders' ? 'Orders' : view === 'fills' ? 'Fills' : 'History Points';

  const walletPositionCount = (name: string): string => {
    if (name === 'Spot') return `${spotRows.length} Assets`;
    if (name === 'Earn') return `${earnRows.length} Earn · ${loans?.ongoing.length ?? 0} Loan`;
    if (name === 'Cross Margin') return `${margin?.assets.length ?? 0} Assets`;
    return 'Wallet Total';
  };
  const walletLiability = (name: string): number | null => {
    if (name === 'Earn') return flexibleDebt;
    if (name === 'Cross Margin') return marginLiability;
    return null;
  };
  const hasDetails = (name: string): boolean => name === 'Spot' || name === 'Earn' || name === 'Cross Margin';

  return (
    <div className="container page accountx-page">
      <section className="accountx-frame" aria-label="account workspace">
        <header className="accountx-toolbar">
          <div className="accountx-identity">
            <span className="accountx-source-mark"><BinanceMark size={22} /></span>
            <span className="accountx-title-copy"><h1>Account</h1><small>Binance Wallets and Capital</small></span>
            <span className={`accountx-live ${syncClass}`}><i />{syncLabel}</span>
          </div>
          <div className="accountx-tools">
            <label className="accountx-search">
              <IconSearch size={15} />
              <input
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  if (value && view === 'overview') setView('wallets');
                }}
                placeholder="Search"
                spellCheck={false}
              />
              {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
            </label>
            <button type="button" className="accountx-mask" onClick={toggleMask} title={mask ? 'Show Balances' : 'Hide Balances'} aria-label={mask ? 'Show Balances' : 'Hide Balances'}>
              <EyeIcon off={mask} />
            </button>
          </div>
        </header>

        {binance?.keyPosture.level === 'unsafe' && (
          <div className="accountx-alert bad">{binance.keyPosture.label}. The cockpit has no withdrawal route, but the Binance key should still be recreated without withdrawal or transfer permission.</div>
        )}
        {sourceErrors.length > 0 && (
          <div className="accountx-alert warn">Some account sources are using cached or partial data. The last known values remain visible and are not replaced with zero.</div>
        )}

        <section className="accountx-summary" aria-label="Account Summary">
          <article>
            <span>Net Capital</span>
            <strong>{money(netCapital)}</strong>
            <small>{btcEquivalent === null ? 'Binance wallet aggregate loading' : `≈ ${mask ? '••••' : btcEquivalent.toFixed(8)} BTC`}</small>
          </article>
          <article>
            <span>Available USDT</span>
            <strong>{money(account?.availableUsdt)}</strong>
            <small>{earnSource.data === null ? 'Earn source loading' : `${money(earnValue)} Flexible Earn`}</small>
          </article>
          <article>
            <span>Liabilities</span>
            <strong>{money(totalLiability)}</strong>
            <small>{`${loans?.ongoing.length ?? 0} Flexible Loan${(loans?.ongoing.length ?? 0) === 1 ? '' : 's'} · ${money(flexibleCollateral)} Collateral`}</small>
          </article>
          <article>
            <span>Realized PnL</span>
            <strong className={signClass(realizedToday)}>{money(realizedToday)}</strong>
            <small>Ledgered Fills · Today UTC</small>
          </article>
        </section>

        <nav className="accountx-viewbar" aria-label="Account Views">
          <div role="tablist">
            {([
              ['overview', 'Overview', ''],
              ['wallets', 'Wallets', String(walletRows.length)],
              ['orders', 'Open Orders', String(state?.openOrders.length ?? 0)],
              ['fills', 'Recent Fills', String(fills.length)],
            ] as [AccountView, string, string][]).map(([id, label, count]) => (
              <button type="button" role="tab" key={id} aria-selected={view === id} onClick={() => setView(id)}>
                {label}{count && <span>{count}</span>}
              </button>
            ))}
          </div>
          <span className={`accountx-source-state ${sourceErrors.length ? 'partial' : 'on'}`}><i />{sourceErrors.length ? 'Partial Source Coverage' : 'Signed Read Sources'}</span>
        </nav>

        <div className="accountx-workspace">
          {view === 'overview' && (
            <section className="accountx-overview" aria-label="Portfolio Overview">
              <div className="accountx-equity">
                <div className="accountx-section-head">
                  <span><b>Spot Balance History</b><small>Transfers and borrowing are included · this is not PnL</small></span>
                  <div className="accountx-equity-tools">
                    <span className={`accountx-spot-change ${signClass(spotChange)}`}>
                      <em>Spot Change</em>
                      <b>{mask ? '••••' : `${finite(spotChange) && spotChange > 0 ? '+' : ''}${fmtPrice(spotChange)}${spotChangePct === null ? '' : ` · ${fmtPct(spotChangePct, 2)}`}`}</b>
                    </span>
                    <div className="accountx-ranges" role="tablist" aria-label="History Range">
                      {RANGES.map((item) => <button type="button" role="tab" aria-selected={range === item.id} key={item.id} onClick={() => setRange(item.id)}>{item.id}</button>)}
                    </div>
                  </div>
                </div>
                <SpotBalanceChart points={historyPoints} rangeMs={currentRange.ms} hidden={mask} rebuiltBefore={historySource.data?.reconstructedBefore ?? null} />
              </div>
              <aside className="accountx-allocation">
                <div className="accountx-section-head"><span><b>Wallet Allocation</b><small>Official Binance wallet valuation</small></span></div>
                {mask ? (
                  <div className="accountx-private">Balances Hidden</div>
                ) : allocation.length > 0 ? (
                  <Donut slices={allocation} size={168} topN={6} />
                ) : (
                  <div className="accountx-empty compact"><b>Allocation Is Loading</b><span>Wallet totals appear after the signed aggregate returns.</span></div>
                )}
              </aside>
            </section>
          )}

          {view === 'wallets' && (
            <section className="accountx-wallet-table" aria-label="Binance Wallets">
              <div className="accountx-wallet-head">
                <span>Wallet</span><span>Balance</span><span>Positions</span><span>Liability</span><span>State</span><span>Share</span>
              </div>
              {visibleWallets.map((wallet) => {
                const expanded = expandedWallet === wallet.walletName || (!!queryText && hasDetails(wallet.walletName));
                const rowContent = <>
                  <span className="accountx-wallet-name"><i>{walletIcon(wallet.walletName)}</i><b>{wallet.walletName}</b>{hasDetails(wallet.walletName) && <IconCaret size={10} />}</span>
                  <span className="accountx-wallet-value"><b>{money(wallet.balance)}</b><small>USDT Valuation</small></span>
                  <span><b>{walletPositionCount(wallet.walletName)}</b><small>{wallet.walletName === 'Earn' && weightedEarnApr !== null ? `${fmtPct(weightedEarnApr * 100, 2, false)} Weighted APR` : 'Signed Wallet Source'}</small></span>
                  <span><b>{walletLiability(wallet.walletName) === null ? '—' : money(walletLiability(wallet.walletName))}</b><small>{wallet.walletName === 'Earn' ? 'Flexible Loan Debt' : wallet.walletName === 'Cross Margin' ? 'Cross Margin Debt' : 'No Liability Source'}</small></span>
                  <span><b className={walletSource.error ? 'warn' : wallet.active ? 'ok' : ''}>{walletSource.error ? 'Cached' : wallet.active ? 'Active' : 'Inactive'}</b><small>{wallet.active ? 'Binance Enabled' : 'Not Activated'}</small></span>
                  <span><b>{share(wallet.balance)}</b><small>Net Capital</small></span>
                </>;
                return (
                  <div className={`accountx-wallet-item ${expanded ? 'expanded' : ''}`} key={wallet.walletName}>
                    {hasDetails(wallet.walletName) ? (
                      <button type="button" className="accountx-wallet-row" aria-expanded={expanded} onClick={() => setExpandedWallet((current) => current === wallet.walletName ? null : wallet.walletName)}>{rowContent}</button>
                    ) : (
                      <div className="accountx-wallet-row">{rowContent}</div>
                    )}
                    {expanded && wallet.walletName === 'Spot' && (
                      <div className="accountx-detail-table">
                        <div className="accountx-detail-head"><span>Asset</span><span>Total</span><span>Available</span><span>Locked</span><span>Price</span><span>Value</span></div>
                        {spotRows.filter((row) => !queryText || row.asset.toLowerCase().includes(queryText)).map((row) => (
                          <div className="accountx-detail-row" key={`spot-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={28} /><b>{row.asset}</b><small>Spot</small></span>
                            <span><b>{quantity(row.free + row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.free)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{fmtPrice(row.priceUsdt)}</b><small>USDT</small></span>
                            <span><b>{money(row.valueUsdt)}</b><small>Market Value</small></span>
                          </div>
                        ))}
                      </div>
                    )}
                    {expanded && wallet.walletName === 'Earn' && (
                      <div className="accountx-detail-table">
                        <div className="accountx-detail-head"><span>Position</span><span>Amount</span><span>Rate / LTV</span><span>Collateral</span><span>Liability</span><span>Net Value</span></div>
                        {earnRows.filter((row) => !queryText || row.asset.toLowerCase().includes(queryText)).map((row) => {
                          const value = row.amount * (priceOf(row.asset) ?? 0);
                          return <div className="accountx-detail-row" key={`earn-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={28} /><b>{row.asset}</b><small>Flexible Earn</small></span>
                            <span><b>{quantity(row.amount)}</b><small>{row.asset}</small></span>
                            <span><b className="ok">{fmtPct(row.apr * 100, 2, false)}</b><small>Current APR</small></span>
                            <span><b>—</b><small>Redeemable Position</small></span>
                            <span><b>—</b><small>No Liability</small></span>
                            <span><b>{money(value)}</b><small>Market Value</small></span>
                          </div>;
                        })}
                        {(loans?.ongoing ?? []).filter((loan) => !queryText || `${loan.loanCoin} ${loan.collateralCoin} flexible loan`.toLowerCase().includes(queryText)).map((loan) => {
                          const debtValue = loan.totalDebt * (priceOf(loan.loanCoin) ?? 0);
                          const collateralValue = loan.collateralAmount * (priceOf(loan.collateralCoin) ?? 0);
                          return <div className="accountx-detail-row" key={`loan-${loan.loanCoin}-${loan.collateralCoin}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${loan.loanCoin}USDT`} size={28} /><b>{loan.loanCoin}</b><small>Flexible Loan</small></span>
                            <span><b>{quantity(loan.totalDebt)}</b><small>{loan.loanCoin} Borrowed</small></span>
                            <span><b>{fmtPct(loan.currentLTV * 100, 2, false)}</b><small>Current LTV</small></span>
                            <span><b>{money(collateralValue)}</b><small>{quantity(loan.collateralAmount)} {loan.collateralCoin}</small></span>
                            <span><b>{money(debtValue)}</b><small>Current Debt</small></span>
                            <span><b>{money(collateralValue - debtValue)}</b><small>Collateral Minus Debt</small></span>
                          </div>;
                        })}
                      </div>
                    )}
                    {expanded && wallet.walletName === 'Cross Margin' && (
                      <div className="accountx-detail-table">
                        <div className="accountx-detail-head"><span>Asset</span><span>Net</span><span>Available</span><span>Locked</span><span>Borrowed</span><span>Interest</span></div>
                        {(margin?.assets ?? []).filter((row) => !queryText || row.asset.toLowerCase().includes(queryText)).map((row) => (
                          <div className="accountx-detail-row" key={`margin-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={28} /><b>{row.asset}</b><small>Cross Margin</small></span>
                            <span><b>{quantity(row.netAsset)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.free)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.borrowed)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.interest)}</b><small>{row.asset}</small></span>
                          </div>
                        ))}
                        {margin?.available && margin.assets.length === 0 && <div className="accountx-empty compact"><b>No Cross Margin Balances</b><span>The signed source is readable and currently reports no assets or liabilities.</span></div>}
                        {!margin?.available && <div className="accountx-empty compact"><b>Cross Margin Is Unavailable</b><span>{margin?.error ?? 'The signed margin source has not returned yet.'}</span></div>}
                      </div>
                    )}
                  </div>
                );
              })}
              {walletSource.data === null && <div className="accountx-empty"><b>Loading Binance Wallets</b><span>The signed wallet aggregate is cached server-side and never replaced with made-up balances.</span></div>}
              {walletSource.data !== null && visibleWallets.length === 0 && <div className="accountx-empty"><b>No Wallets Match Search</b><span>Clear Search to restore the complete Binance wallet list.</span></div>}
            </section>
          )}

          {view === 'orders' && (
            <section className="accountx-table-scroll" aria-label="Open Orders">
              <table className="accountx-table orders">
                <thead><tr><th className="l">Order</th><th>Price</th><th>Quantity</th><th>Filled</th><th>Status</th><th>Age</th></tr></thead>
                <tbody>{openOrders.map((order: OpenOrderRow) => (
                  <tr key={`${order.symbol}-${order.orderId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={order.symbol} size={30} /><span><b>{order.symbol}</b><small><em className={order.side === 'BUY' ? 'up' : 'down'}>{order.side}</em> · {order.type}</small></span></span></td>
                    <td><b>{fmtPrice(order.price)}</b><small>Limit Price</small></td>
                    <td><b>{quantity(order.origQty)}</b><small>{order.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{fmtPct(order.origQty > 0 ? (order.executedQty / order.origQty) * 100 : 0, 0, false)}</b><small>{quantity(order.executedQty)} Filled</small></td>
                    <td><b className={order.stale ? 'warn' : 'ok'}>{order.stale ? 'Stale' : order.status}</b><small>Binance Open Order</small></td>
                    <td><b>{timeAgo(order.time)}</b><small>Order {order.orderId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {openOrders.length === 0 && <div className="accountx-empty"><b>No Open Orders</b><span>{binance?.keysPresent ? 'Signed polling is current; any new Binance order will appear here.' : 'Read-only Binance keys are required for account orders.'}</span></div>}
            </section>
          )}

          {view === 'fills' && (
            <section className="accountx-table-scroll" aria-label="Recent Fills">
              <table className="accountx-table fills">
                <thead><tr><th className="l">Fill</th><th>Price</th><th>Quantity</th><th>Value</th><th>Fee</th><th>Time</th></tr></thead>
                <tbody>{visibleFills.map((fill) => (
                  <tr key={`${fill.symbol}-${fill.tradeId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={fill.symbol} size={30} /><span><b>{fill.symbol}</b><small><em className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side}</em> · {fill.source.replaceAll('_', ' ')}</small></span></span></td>
                    <td><b>{fmtPrice(fill.price)}</b><small>Execution Price</small></td>
                    <td><b>{quantity(fill.qty)}</b><small>{fill.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{money(fill.quoteQty)}</b><small>Quote Value</small></td>
                    <td><b>{mask ? '••••' : fmtQty(fill.commission)}</b><small>{fill.commissionAsset ?? 'No Fee Asset'}</small></td>
                    <td><b>{timeAgo(fill.ts)}</b><small>Trade {fill.tradeId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {visibleFills.length === 0 && <div className="accountx-empty"><b>{queryText ? 'No Fills Match Search' : 'No Ledgered Fills'}</b><span>{queryText ? 'Clear Search or use a different symbol.' : streamOpen ? 'New Binance executions will be recorded here.' : 'The user stream is unavailable; only observed or imported Binance fills can appear.'}</span></div>}
            </section>
          )}
        </div>

        <footer className="accountx-footer">
          <span>
            Spot {timeAgo(binance?.lastSyncTs)} · Wallets {timeAgo(walletSource.fetchedAt)} · Earn {timeAgo(earnSource.fetchedAt)} · Loans {timeAgo(loanSource.fetchedAt)}
          </span>
          <span>{rowCount} {rowLabel}</span>
        </footer>
      </section>
    </div>
  );
}
