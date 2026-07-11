import { useEffect, useMemo, useRef, useState } from 'react';
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
  IconWallet,
} from '../components/Icons';
import { TokenIcon } from '../components/TokenIcon';
import { Star } from '../components/PillSelect';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, signClass, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { useRefreshSignal } from '../lib/refresh';
import { useStore } from '../store';
import type { FillRow, LoansSnapshot, OpenOrderRow } from '../types';
import './Account.css';

type AccountView = 'overview' | 'orders' | 'fills';
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
}: {
  points: { ts: number; v: number }[];
  rangeMs: number;
  hidden: boolean;
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

  // A normalized plotting plane intentionally fills the CSS-owned canvas.
  // Keeping axes outside the SVG prevents preserveAspectRatio from centering a
  // shrunken chart when the account surface becomes much wider than it is tall.
  const width = 1000;
  const height = 164;
  const plotWidth = width;
  const values = visible.map((point) => point.v);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.max(1, maximum * 0.02);
  const low = Math.max(0, minimum - span * 0.12);
  const high = maximum + span * 0.12;
  const x = (timestamp: number) => ((timestamp - start) / Math.max(1, end - start)) * (plotWidth - 8) + 4;
  const y = (value: number) => height - 24 - ((value - low) / Math.max(1e-9, high - low)) * (height - 38);
  const path = visible.reduce((commands, point, index) => {
    const px = x(point.ts).toFixed(1);
    const py = y(point.v).toFixed(1);
    if (index === 0) return `M${px} ${py}`;
    const previousY = y(visible[index - 1].v).toFixed(1);
    return `${commands} L${px} ${previousY} L${px} ${py}`;
  }, '');
  const grid = Array.from({ length: 3 }, (_, index) => low + ((2 - index) / 2) * (high - low));
  const ticks = Array.from({ length: 5 }, (_, index) => start + (index / 4) * (end - start));

  const onMove = (event: { clientX: number }) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = start + fraction * (end - start);
    let closest = visible[0];
    for (const point of visible) if (Math.abs(point.ts - target) < Math.abs(closest.ts - target)) closest = point;
    setHover({ x: x(closest.ts) / width, value: closest.v, ts: closest.ts });
  };

  return (
    <div className="accountx-chart">
      <div className="accountx-chart-canvas" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Spot balance history">
          {grid.map((value) => (
            <line key={value} x1="0" x2={plotWidth} y1={y(value)} y2={y(value)} className="accountx-gridline" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={path} className="accountx-chart-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover && (
          <>
            <span className="accountx-crosshair" style={{ left: `${hover.x * 100}%` }} />
            <span className={`accountx-chart-tip ${hover.x > 0.76 ? 'flip' : ''}`} style={{ left: `${hover.x * 100}%` }}>
              <b>{fmtPrice(hover.value)}</b>
              <em>{new Date(hover.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
            </span>
          </>
        )}
      </div>
      <div className="accountx-date-axis">{ticks.map((tick) => <span key={tick}>{compactDate(tick)}</span>)}</div>
    </div>
  );
}

export function Account() {
  const { state, markets, prefs, toggleWatch } = useStore();
  const [view, setView] = useState<AccountView>('overview');
  const [range, setRange] = useState<RangeId>('6M');
  const [expandedWallet, setExpandedWallet] = useState<string | null>('Spot');
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const [walletSource, setWalletSource] = useState<SourceState<WalletBalanceRow[]>>(EMPTY_SOURCE);
  const [earnSource, setEarnSource] = useState<SourceState<{ asset: string; amount: number; apr: number }[]>>(EMPTY_SOURCE);
  const [loanSource, setLoanSource] = useState<SourceState<LoansSnapshot>>(EMPTY_SOURCE);
  const [historySource, setHistorySource] = useState<SourceState<{
    rows: { ts: number; totalUsdt: number }[];
    reconstructedBefore: number | null;
    reconstruction: { complete: boolean; reasons: string[] };
  }>>(EMPTY_SOURCE);
  const [fills, setFills] = useState<FillRow[]>([]);
  const [fillsError, setFillsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((value) => value + 1));

  useEffect(() => {
    type WalletPayload = { rows?: WalletBalanceRow[]; fetchedAt?: number | null; error?: string };
    type EarnPayload = { rows?: { asset: string; amount: number; apr: number }[]; fetchedAt?: number | null; error?: string };
    type HistoryPayload = {
      rows?: { ts: number; totalUsdt: number }[];
      reconstructedBefore?: number | null;
      reconstruction?: { complete?: boolean; reasons?: string[] };
      fetchedAt?: number | null;
      error?: string;
    };
    const poll = createSettledPoll<[
      PromiseSettledResult<WalletPayload>,
      PromiseSettledResult<EarnPayload>,
      PromiseSettledResult<LoansSnapshot>,
      PromiseSettledResult<HistoryPayload>,
      PromiseSettledResult<FillRow[]>,
    ]>({
      intervalMs: Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000,
      request: (signal) => Promise.allSettled([
        fetchJson<WalletPayload>('/api/wallet-balances', { cache: 'no-store', signal }),
        fetchJson<EarnPayload>('/api/earn', { cache: 'no-store', signal }),
        fetchJson<LoansSnapshot>('/api/loans', { cache: 'no-store', signal }),
        fetchJson<HistoryPayload>('/api/equity-history', { cache: 'no-store', signal }),
        fetchJson<FillRow[]>('/api/fills', { cache: 'no-store', signal }),
      ]) as Promise<[
        PromiseSettledResult<WalletPayload>,
        PromiseSettledResult<EarnPayload>,
        PromiseSettledResult<LoansSnapshot>,
        PromiseSettledResult<HistoryPayload>,
        PromiseSettledResult<FillRow[]>,
      ]>,
      onSuccess: ([wallet, earn, loansResult, history, fillsResult]) => {
        if (wallet.status === 'fulfilled') setWalletSource({ data: wallet.value.rows ?? [], fetchedAt: wallet.value.fetchedAt ?? null, error: wallet.value.error ?? null });
        else setWalletSource((current) => ({ ...current, error: apiErrorMessage(wallet.reason) }));
        if (earn.status === 'fulfilled') setEarnSource({ data: earn.value.rows ?? [], fetchedAt: earn.value.fetchedAt ?? null, error: earn.value.error ?? null });
        else setEarnSource((current) => ({ ...current, error: apiErrorMessage(earn.reason) }));
        if (loansResult.status === 'fulfilled') setLoanSource({ data: loansResult.value, fetchedAt: loansResult.value.fetchedAt ?? null, error: loansResult.value.error ?? null });
        else setLoanSource((current) => ({ ...current, error: apiErrorMessage(loansResult.reason) }));
        if (history.status === 'fulfilled') setHistorySource({
          data: {
            rows: history.value.rows ?? [],
            reconstructedBefore: history.value.reconstructedBefore ?? null,
            reconstruction: {
              complete: history.value.reconstruction?.complete === true,
              reasons: Array.isArray(history.value.reconstruction?.reasons) ? history.value.reconstruction.reasons : [],
            },
          },
          fetchedAt: history.value.fetchedAt ?? null,
          error: history.value.error ?? null,
        });
        else setHistorySource((current) => ({ ...current, error: apiErrorMessage(history.reason) }));
        if (fillsResult.status === 'fulfilled') {
          setFills(fillsResult.value);
          setFillsError(null);
        } else {
          setFillsError(apiErrorMessage(fillsResult.reason));
        }
      },
      onError: (error) => {
        const message = apiErrorMessage(error);
        setWalletSource((current) => ({ ...current, error: message }));
        setEarnSource((current) => ({ ...current, error: message }));
        setLoanSource((current) => ({ ...current, error: message }));
        setHistorySource((current) => ({ ...current, error: message }));
        setFillsError(message);
      },
    });
    poll.start();
    return poll.stop;
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
  const valueOf = (asset: string, amount: number): number | null => {
    const price = priceOf(asset);
    return finite(price) ? amount * price : null;
  };
  const btcSpot = priceOf('BTC');
  const earnValues = earnRows.map((row) => valueOf(row.asset, row.amount));
  const earnHasSnapshot = earnSource.fetchedAt !== null;
  const earnValue = earnHasSnapshot && earnValues.every(finite)
    ? earnValues.reduce<number>((sum, value) => sum + value, 0)
    : null;
  const margin = loans?.margin ?? null;
  const marginLiability = margin?.fetchedAt !== null && margin?.fetchedAt !== undefined && finite(btcSpot)
    ? margin.totalLiabilityBtc * btcSpot
    : null;
  const loansHaveSnapshot = loans?.fetchedAt !== null && loans?.fetchedAt !== undefined;
  const flexibleDebtValues = (loans?.ongoing ?? []).map((loan) => valueOf(loan.loanCoin, loan.totalDebt));
  const flexibleCollateralValues = (loans?.ongoing ?? []).map((loan) => valueOf(loan.collateralCoin, loan.collateralAmount));
  const flexibleDebt = loansHaveSnapshot && flexibleDebtValues.every(finite)
    ? flexibleDebtValues.reduce<number>((sum, value) => sum + value, 0)
    : null;
  const flexibleCollateral = loansHaveSnapshot && flexibleCollateralValues.every(finite)
    ? flexibleCollateralValues.reduce<number>((sum, value) => sum + value, 0)
    : null;
  const officialWalletTotal = walletSource.data && walletSource.data.length > 0
    ? walletSource.data.reduce((sum, wallet) => sum + wallet.balance, 0)
    : null;
  const netCapital = officialWalletTotal;
  const btcEquivalent = finite(netCapital) && finite(btcSpot) && btcSpot > 0 ? netCapital / btcSpot : null;
  const totalLiability = finite(flexibleDebt) && finite(marginLiability) ? flexibleDebt + marginLiability : null;
  const realizedToday = account?.realizedTodayUsd ?? null;
  const spotChange = account?.dayChangeUsd ?? null;
  const spotChangePct = finite(spotChange) && finite(account?.dayOpenEquity) && account!.dayOpenEquity! > 0
    ? (spotChange / account!.dayOpenEquity!) * 100
    : null;

  const historyPoints = useMemo(() => {
    const rows = [...(historySource.data?.rows ?? [])]
      .filter((row) => finite(row.totalUsdt))
      .map((row) => ({ ts: row.ts, v: row.totalUsdt }));
    if (account?.complete && finite(account.totalUsdt)) rows.push({ ts: binance?.lastSyncTs ?? historySource.fetchedAt ?? Date.now(), v: account.totalUsdt });
    rows.sort((a, b) => a.ts - b.ts);
    const deduped: { ts: number; v: number }[] = [];
    for (const point of rows) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(last.ts - point.ts) < 1_000) deduped[deduped.length - 1] = point;
      else deduped.push(point);
    }
    return deduped;
  }, [account?.complete, account?.totalUsdt, binance?.lastSyncTs, historySource.data?.rows, historySource.fetchedAt]);

  const walletRows = useMemo(() => [...(walletSource.data ?? [])].sort((left, right) => {
    const leftIndex = WALLET_ORDER.indexOf(left.walletName);
    const rightIndex = WALLET_ORDER.indexOf(right.walletName);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  }), [walletSource.data]);
  const allocation = walletRows.filter((wallet) => wallet.balance > 0).map((wallet) => ({ label: wallet.walletName, value: wallet.balance }));
  const visibleWallets = walletRows;
  const openOrders = state?.openOrders ?? [];
  const visibleFills = fills;

  const toggleMask = () => {
    setMask((current) => {
      localStorage.setItem('cosmos-balance-mask', current ? '0' : '1');
      return !current;
    });
  };
  const money = (value: number | null | undefined) => mask ? '••••••' : fmtPrice(value);
  const quantity = (value: number | null | undefined) => mask ? '••••' : fmtQty(value);
  const shortQuantity = (value: number | null | undefined) => mask ? '••••' : finite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—';
  const share = (value: number) => mask ? '••' : finite(netCapital) && netCapital > 0 ? fmtPct((value / netCapital) * 100, 2, false) : '—';

  const currentRange = RANGES.find((item) => item.id === range) ?? RANGES[1];
  const sourceErrors = [walletSource.error, earnSource.error, loanSource.error, historySource.error, fillsError].filter(Boolean) as string[];
  const sourcesPending = walletSource.data === null || earnSource.data === null || loanSource.data === null || historySource.data === null;
  const streamOpen = binance?.userStream === 'open' || binance?.userStream === 'live';
  const sourceClass = sourceErrors.length > 0 ? 'partial' : sourcesPending ? 'loading' : 'on';
  const sourceLabel = sourceErrors.length > 0 || account?.complete === false ? 'Partial Source Coverage' : sourcesPending ? 'Sources Loading' : 'Signed Read Sources';
  const rowCount = view === 'orders' ? openOrders.length : visibleFills.length;
  const rowLabel = view === 'orders' ? 'Orders' : 'Fills';
  const displayCurrency = prefs.currency || 'USD';
  const watchlist = state?.config.watchlist ?? [];
  const marketSymbolFor = (asset: string): string | null => markets.some((market) => market.symbol === `${asset}USDT`) ? `${asset}USDT` : null;

  const walletPositionCount = (name: string): string | null => {
    if (name === 'Spot') return `${spotRows.length} Assets`;
    if (name === 'Earn') return earnHasSnapshot && loansHaveSnapshot ? `${earnRows.length} Earn · ${loans?.ongoing.length ?? 0} Loan` : null;
    if (name === 'Cross Margin') return margin?.fetchedAt ? `${margin.assets.length} Assets` : null;
    return null;
  };
  const walletLiability = (name: string): number | null => {
    if (name === 'Earn') return flexibleDebt;
    if (name === 'Cross Margin') return marginLiability;
    return null;
  };
  const hasDetails = (name: string): boolean => name === 'Spot' || name === 'Earn' || name === 'Cross Margin';
  const selectedWallet = expandedWallet && visibleWallets.some((wallet) => wallet.walletName === expandedWallet)
    ? expandedWallet
    : null;

  return (
    <div className="container page accountx-page">
      <section className="accountx-frame" aria-label="account workspace">
        <header className="accountx-toolbar">
          <div className="accountx-identity">
            <span className="accountx-source-mark"><img className="accountx-page-mark" src="/account-wallet.png" alt="" aria-hidden="true" /></span>
            <span><h1>Account</h1><small>Binance Capital And Signed Wallets</small></span>
          </div>
          <div className="accountx-tools">
            <button type="button" className="accountx-mask" onClick={toggleMask} title={mask ? 'Show Balances' : 'Hide Balances'} aria-label={mask ? 'Show Balances' : 'Hide Balances'}>
              <EyeIcon off={mask} />
            </button>
          </div>
        </header>

        <section className="accountx-summary" aria-label="Account Summary">
          <article>
            <span>Estimated Total Value</span>
            <strong>{money(netCapital)}</strong>
            <small>{btcEquivalent === null ? (walletSource.error ? 'Wallet Aggregate Unavailable' : 'Wallet Aggregate Loading') : `≈ ${mask ? '••••' : btcEquivalent.toFixed(8)} BTC`}</small>
          </article>
          <article>
            <span>Available Cash</span>
            <strong>{money(account?.availableUsdt)}</strong>
            <small>{`${shortQuantity(account?.availableUsdt)} USDT Free · ${finite(earnValue) ? `${money(earnValue)} Earn` : 'Earn Unavailable'}`}</small>
          </article>
          <article>
            <span>Liabilities</span>
            <strong>{money(totalLiability)}</strong>
            <small>{finite(totalLiability) ? `${loans?.ongoing.length ?? 0} Flexible Loan${(loans?.ongoing.length ?? 0) === 1 ? '' : 's'} · ${money(flexibleCollateral)} Collateral` : 'Loan Sources Unavailable'}</small>
          </article>
          <article>
            <span>Gross Realized</span>
            <strong className={signClass(realizedToday)}>{money(realizedToday)}</strong>
            <small>{streamOpen ? 'Before Fees · Ledgered Today UTC' : 'Before Fees · Partial Fill Coverage'}</small>
          </article>
        </section>

        <nav className="accountx-viewbar" aria-label="Account Views">
          <div role="tablist">
            {([
              ['overview', 'Overview', ''],
              ['orders', 'Open Orders', String(state?.openOrders.length ?? 0)],
              ['fills', 'Recent Fills', String(fills.length)],
            ] as [AccountView, string, string][]).map(([id, label, count]) => (
              <button type="button" role="tab" key={id} aria-selected={view === id} onClick={() => setView(id)}>
                {label}{count && <span>{count}</span>}
              </button>
            ))}
          </div>
          <span className={`accountx-source-state ${sourceClass}`} title={sourceErrors[0] ?? undefined}><i />{sourceLabel}</span>
        </nav>

        <div className="accountx-workspace">
          {view === 'overview' && (
            <section className="accountx-overview" aria-label="Portfolio Overview">
              <section className="accountx-portfolio-band" aria-label="Balance And Allocation">
                <div className="accountx-equity">
                  <div className="accountx-section-head">
                    <span><b>Spot Balance History</b><small title={historySource.data?.reconstruction.reasons.join(' · ') || undefined}>{historySource.data?.reconstruction.complete && historySource.data.reconstructedBefore ? 'Signed Binance snapshots · verified wallet-flow reconstruction' : historySource.data?.reconstruction.reasons.length ? 'Signed Binance snapshots · older reconstruction unavailable' : 'Signed Binance snapshots · balance movement, not PnL'}</small></span>
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
                  <SpotBalanceChart points={historyPoints} rangeMs={currentRange.ms} hidden={mask} />
                </div>
                <aside className="accountx-allocation">
                  <div className="accountx-section-head"><span><b>Wallet Allocation</b><small>Official Binance wallet valuation</small></span></div>
                  {mask ? (
                    <div className="accountx-private">Balances Hidden</div>
                  ) : allocation.length > 0 ? (
                    <Donut slices={allocation} size={128} topN={6} />
                  ) : walletSource.data === null && !walletSource.error ? (
                    <div className="accountx-empty compact"><b>Allocation Is Loading</b><span>The signed wallet aggregate is still being fetched.</span></div>
                  ) : walletSource.error ? (
                    <div className="accountx-empty compact"><b>Allocation Is Unavailable</b><span>No verified wallet aggregate is available yet.</span></div>
                  ) : (
                    <div className="accountx-empty compact"><b>No Wallet Balance</b><span>Binance returned no positive wallet allocation.</span></div>
                  )}
                </aside>
              </section>

              <section className="accountx-wallet-zone" aria-label="Capital Accounts">
              <header className="accountx-wallet-zone-head">
                <span><b>Capital Accounts</b><small>Expand a Binance wallet to inspect its complete signed balance and positions directly underneath</small></span>
                <em>{visibleWallets.filter((wallet) => wallet.active).length} Active · {walletRows.length} Total</em>
              </header>
              <div className="accountx-wallet-table">
                {visibleWallets.map((wallet) => {
                const expanded = selectedWallet === wallet.walletName;
                const positions = walletPositionCount(wallet.walletName);
                const liability = walletLiability(wallet.walletName);
                const stateLabel = walletSource.error ? 'Cached' : wallet.active ? 'Active' : 'Inactive';
                const rowContent = <>
                  <span className="accountx-wallet-name">
                    <i>{walletIcon(wallet.walletName)}</i>
                    <span><b>{wallet.walletName}</b><small>{hasDetails(wallet.walletName) ? 'Position Detail Available' : 'Binance Wallet'}</small></span>
                    <em className={walletSource.error ? 'warn' : wallet.active ? 'ok' : ''}>{stateLabel}</em>
                    {hasDetails(wallet.walletName) && <IconCaret size={10} />}
                  </span>
                  <span className="accountx-wallet-value"><small>Balance</small><b>{money(wallet.balance)}</b></span>
                  <span><small>Positions</small><b>{positions ?? '—'}</b></span>
                  <span><small>Liability</small><b>{liability === null ? '—' : money(liability)}</b></span>
                  <span><small>Wallet Share</small><b>{share(wallet.balance)}</b></span>
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
                        <div className="accountx-detail-title"><span><b>Spot Assets</b><small>Signed free and locked balances</small></span></div>
                        <div className="accountx-detail-head"><span>Asset</span><span>Total</span><span>Available</span><span>Locked</span><span>Price</span><span>Value</span><span aria-label="Watchlist" /></div>
                        {spotRows.map((row) => (
                          <div className="accountx-detail-row" key={`spot-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={36} /><span><b>{row.asset}</b><small>Spot</small></span></span>
                            <span><b>{quantity(row.free + row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.free)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{fmtPrice(row.priceUsdt)}</b><small>{displayCurrency}</small></span>
                            <span><b>{money(finite(row.priceUsdt) ? row.valueUsdt : null)}</b><small>{finite(row.priceUsdt) ? 'Market Value' : 'Price Unavailable'}</small></span>
                            <span className="accountx-watch">{marketSymbolFor(row.asset) ? <Star on={watchlist.includes(marketSymbolFor(row.asset)!)} onClick={() => void toggleWatch(marketSymbolFor(row.asset)!)} /> : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {expanded && wallet.walletName === 'Earn' && (
                      <div className="accountx-detail-table">
                        <div className="accountx-detail-title"><span><b>Earn and Flexible Loan Positions</b><small>Yield, collateral, debt, and net value</small></span></div>
                        <div className="accountx-detail-head"><span>Position</span><span>Amount</span><span>Rate / LTV</span><span>Collateral</span><span>Liability</span><span>Net Value</span><span aria-label="Watchlist" /></div>
                        {earnRows.map((row) => {
                          const value = valueOf(row.asset, row.amount);
                          return <div className="accountx-detail-row" key={`earn-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={36} /><span><b>{row.asset}</b><small>Flexible Earn</small></span></span>
                            <span><b>{quantity(row.amount)}</b><small>{row.asset}</small></span>
                            <span><b className="ok">{fmtPct(row.apr * 100, 2, false)}</b><small>Current APR</small></span>
                            <span><b>—</b><small>Redeemable Position</small></span>
                            <span><b>—</b><small>No Liability</small></span>
                            <span><b>{money(value)}</b><small>Market Value</small></span>
                            <span className="accountx-watch">{marketSymbolFor(row.asset) ? <Star on={watchlist.includes(marketSymbolFor(row.asset)!)} onClick={() => void toggleWatch(marketSymbolFor(row.asset)!)} /> : '—'}</span>
                          </div>;
                        })}
                        {(loans?.ongoing ?? []).map((loan) => {
                          const debtValue = valueOf(loan.loanCoin, loan.totalDebt);
                          const collateralValue = valueOf(loan.collateralCoin, loan.collateralAmount);
                          const netValue = finite(debtValue) && finite(collateralValue) ? collateralValue - debtValue : null;
                          return <div className="accountx-detail-row" key={`loan-${loan.loanCoin}-${loan.collateralCoin}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${loan.loanCoin}USDT`} size={36} /><span><b>{loan.loanCoin}</b><small>Flexible Loan</small></span></span>
                            <span><b>{quantity(loan.totalDebt)}</b><small>{loan.loanCoin} Borrowed</small></span>
                            <span><b>{fmtPct(loan.currentLTV * 100, 2, false)}</b><small>Current LTV</small></span>
                            <span><b>{money(collateralValue)}</b><small>{quantity(loan.collateralAmount)} {loan.collateralCoin}</small></span>
                            <span><b>{money(debtValue)}</b><small>Current Debt</small></span>
                            <span><b>{money(netValue)}</b><small>Collateral Minus Debt</small></span>
                            <span className="accountx-watch">{marketSymbolFor(loan.loanCoin) ? <Star on={watchlist.includes(marketSymbolFor(loan.loanCoin)!)} onClick={() => void toggleWatch(marketSymbolFor(loan.loanCoin)!)} /> : '—'}</span>
                          </div>;
                        })}
                      </div>
                    )}
                    {expanded && wallet.walletName === 'Cross Margin' && (
                      <div className="accountx-detail-table">
                        <div className="accountx-detail-title"><span><b>Cross Margin Assets</b><small>Signed balances, borrowings, and accrued interest</small></span></div>
                        <div className="accountx-detail-head"><span>Asset</span><span>Net</span><span>Available</span><span>Locked</span><span>Borrowed</span><span>Interest</span><span aria-label="Watchlist" /></div>
                        {(margin?.assets ?? []).map((row) => (
                          <div className="accountx-detail-row" key={`margin-${row.asset}`}>
                            <span className="accountx-asset"><TokenIcon symbol={`${row.asset}USDT`} size={36} /><span><b>{row.asset}</b><small>Cross Margin</small></span></span>
                            <span><b>{quantity(row.netAsset)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.free)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.locked)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.borrowed)}</b><small>{row.asset}</small></span>
                            <span><b>{quantity(row.interest)}</b><small>{row.asset}</small></span>
                            <span className="accountx-watch">{marketSymbolFor(row.asset) ? <Star on={watchlist.includes(marketSymbolFor(row.asset)!)} onClick={() => void toggleWatch(marketSymbolFor(row.asset)!)} /> : '—'}</span>
                          </div>
                        ))}
                        {margin?.available && margin.assets.length === 0 && <div className="accountx-empty compact"><b>No Cross Margin Balances</b><span>The signed source is readable and currently reports no assets or liabilities.</span></div>}
                        {!margin?.available && <div className="accountx-empty compact"><b>Cross Margin Is Unavailable</b><span>{margin?.error ?? 'The signed margin source has not returned yet.'}</span></div>}
                      </div>
                    )}
                  </div>
                );
                })}
                {walletSource.data === null && !walletSource.error && <div className="accountx-empty"><b>Loading Binance Wallets</b><span>The signed wallet aggregate is being fetched.</span></div>}
                {walletSource.error && visibleWallets.length === 0 && <div className="accountx-empty"><b>Binance Wallets Are Unavailable</b><span>No verified wallet snapshot is available yet.</span></div>}
                {!walletSource.error && walletSource.data !== null && walletRows.length === 0 && <div className="accountx-empty"><b>No Wallets Returned</b><span>The signed Binance source returned an empty wallet list.</span></div>}
              </div>
            </section>
            </section>
          )}

          {view === 'orders' && (
            <section className="accountx-table-view" aria-label="Open Orders">
              <header className="accountx-data-view-head"><span><b>Open Orders</b><small>Signed Binance orders currently working across the account</small></span><em>{openOrders.length} Orders</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table orders">
                <thead><tr><th className="l">Order</th><th>Price</th><th>Quantity</th><th>Filled</th><th>Status</th><th>Age</th></tr></thead>
                <tbody>{openOrders.map((order: OpenOrderRow) => (
                  <tr key={`${order.symbol}-${order.orderId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={order.symbol} size={36} /><span><b>{order.symbol}</b><small><em className={order.side === 'BUY' ? 'up' : 'down'}>{order.side}</em> · {order.type}</small></span></span></td>
                    <td><b>{fmtPrice(order.price)}</b><small>Limit Price</small></td>
                    <td><b>{quantity(order.origQty)}</b><small>{order.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{fmtPct(order.origQty > 0 ? (order.executedQty / order.origQty) * 100 : 0, 0, false)}</b><small>{quantity(order.executedQty)} Filled</small></td>
                    <td><b className={order.stale ? 'warn' : 'ok'}>{order.stale ? 'Stale' : order.status}</b><small>Binance Open Order</small></td>
                    <td><b>{timeAgo(order.time)}</b><small>Order {order.orderId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {openOrders.length === 0 && <div className="accountx-empty"><b>No Open Orders</b><span>{binance?.keysPresent ? 'Signed polling is current; any new Binance order will appear here.' : 'Read-only Binance keys are required for account orders.'}</span></div>}
              </div>
            </section>
          )}

          {view === 'fills' && (
            <section className="accountx-table-view" aria-label="Recent Fills">
              <header className="accountx-data-view-head"><span><b>Recent Fills</b><small>Ledgered Binance executions with price, size, value, and fee evidence</small></span><em>{visibleFills.length} Fills</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table fills">
                <thead><tr><th className="l">Fill</th><th>Price</th><th>Quantity</th><th>Value</th><th>Fee</th><th>Time</th></tr></thead>
                <tbody>{visibleFills.map((fill) => (
                  <tr key={`${fill.symbol}-${fill.tradeId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={fill.symbol} size={36} /><span><b>{fill.symbol}</b><small><em className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side}</em> · {fill.source.replaceAll('_', ' ')}</small></span></span></td>
                    <td><b>{fmtPrice(fill.price)}</b><small>Execution Price</small></td>
                    <td><b>{quantity(fill.qty)}</b><small>{fill.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{money(fill.quoteQty)}</b><small>Quote Value</small></td>
                    <td><b>{mask ? '••••' : fmtQty(fill.commission)}</b><small>{fill.commissionAsset ?? 'No Fee Asset'}</small></td>
                    <td><b>{timeAgo(fill.ts)}</b><small>Trade {fill.tradeId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {visibleFills.length === 0 && <div className="accountx-empty"><b>No Ledgered Fills</b><span>{streamOpen ? 'New Binance executions will be recorded here.' : 'The user stream is unavailable; only observed or imported Binance fills can appear.'}</span></div>}
              </div>
            </section>
          )}
        </div>

        <footer className="accountx-footer">
          <span>
            Spot {timeAgo(binance?.lastSyncTs)} · Wallets {timeAgo(walletSource.fetchedAt)} · Earn {timeAgo(earnSource.fetchedAt)} · Loans {timeAgo(loanSource.fetchedAt)}
          </span>
          {view !== 'overview' && <span>{rowCount} {rowLabel}</span>}
        </footer>
      </section>
    </div>
  );
}
