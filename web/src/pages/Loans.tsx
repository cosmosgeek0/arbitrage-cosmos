import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { TokenIcon } from '../components/TokenIcon';
import { IconSearch } from '../components/Icons';
import { PillSelect, pageList, Star } from '../components/PillSelect';
import { tokenName } from '../lib/tokenNames';
import { fmtBasis, fmtMoney, fmtPct, fmtQty, timeAgo } from '../format';
import type { BasisRow, BasisSnapshot } from '../lib/basisRuntime';
import type { BorrowGuardConfig, LoansSnapshot } from '../types';
import './Markets.css';
import './Loans.css';

type LoanView = 'overview' | 'assets' | 'preflight' | 'activity';
type SortKey = 'asset' | 'hourly' | 'apr' | 'min' | 'max' | 'collateral' | 'perp';
type CatalogFilter = 'all' | 'perp' | 'collateral' | 'watchlist';
type OngoingLoan = LoansSnapshot['ongoing'][number];
type LoanActivity = LoansSnapshot['activity'][number];

const DEFAULT_GUARD: BorrowGuardConfig = {
  enabled: true,
  newBorrowPaused: true,
  repayOnly: true,
  maxLtvPct: 80,
  maxAprPct: 12,
  requireLiveCatalog: true,
  allowedCollateralCoins: ['USDT', 'USDC', 'FDUSD'],
  blockedLoanCoins: [],
};

interface BorrowRow {
  coin: string;
  hourly: number | null;
  apr: number | null;
  minUsd: number | null;
  maxUsd: number | null;
  collateralEligible: boolean;
  initialLtv: number | null;
  callLtv: number | null;
  liquidationLtv: number | null;
  perp: boolean;
  symbol: string | null;
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function fmtRate(value: number | null, digits = 4): string {
  return finite(value) ? `${value.toFixed(digits)}%` : '—';
}

function fmtUsd(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: Math.abs(value) >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 2 : 2,
  }).format(value);
}

function ltvPct(value: number | null | undefined, digits = 0): string {
  return finite(value) ? fmtPct(value * 100, digits, false) : '—';
}

function riskOf(ltv: number, callLtv: number, liquidationLtv: number): 'low' | 'call' | 'liq' {
  if (ltv >= liquidationLtv) return 'liq';
  if (ltv >= callLtv) return 'call';
  return 'low';
}

const RISK_LABEL = { low: 'Low Risk', call: 'Margin Call', liq: 'Liquidation' } as const;

function activityTone(kind: LoanActivity['kind']): 'ok' | 'warn' | 'idle' {
  if (kind === 'flex_repay' || kind === 'margin_repay') return 'ok';
  if (kind === 'flex_borrow' || kind === 'margin_borrow') return 'warn';
  return 'idle';
}

function activityTitle(event: LoanActivity): string {
  switch (event.kind) {
    case 'flex_borrow': return `Borrowed ${fmtQty(event.amount)} ${event.loanCoin}`;
    case 'flex_repay': return `Repaid ${fmtQty(event.amount)} ${event.loanCoin}`;
    case 'ltv_adjust': return `${event.detail?.startsWith('REDUCED') ? 'Removed' : 'Added'} ${fmtQty(event.amount)} ${event.collateralCoin ?? ''} Collateral`;
    case 'margin_borrow': return `Margin Borrowed ${fmtQty(event.amount)} ${event.loanCoin}`;
    case 'margin_repay': return `Margin Repaid ${fmtQty(event.amount)} ${event.loanCoin}`;
    case 'margin_interest': return `Margin Interest ${fmtQty(event.amount)} ${event.loanCoin}`;
  }
}

function activityDetail(event: LoanActivity): string {
  return [
    event.kind.startsWith('flex') || event.kind === 'ltv_adjust' ? 'Flexible Loan' : 'Cross Margin',
    event.collateralCoin ? `Collateral ${event.collateralCoin}` : null,
    event.detail && !event.detail.includes('Flexible loan') ? event.detail : null,
  ].filter(Boolean).join(' · ');
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return status.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function borrowStatusLabel(row: BasisRow): string {
  if (row.borrow.status === 'available') return 'Available';
  if (row.borrow.status === 'unavailable') return 'Unavailable';
  if (row.borrow.status === 'unknown') return 'Unknown';
  return 'Not Required';
}

function decisionLabel(row: BasisRow): string {
  if (row.rejectCode) return row.rejectCode.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (row.decisionKind === 'ignore') return 'Below Watch Gate';
  return row.decisionKind.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function Loans() {
  const { state, markets, openDetail, saveConfig, setPage, toggleWatch, prefs } = useStore();
  const [loans, setLoans] = useState<LoansSnapshot | null>(null);
  const [loansFetchError, setLoansFetchError] = useState<string | null>(null);
  const [basis, setBasis] = useState<BasisSnapshot | null>(null);
  const [basisError, setBasisError] = useState<string | null>(null);
  const [earnAprs, setEarnAprs] = useState<Map<string, number>>(new Map());
  const [earnStatus, setEarnStatus] = useState<{ fetchedAt: number | null; error: string | null }>({ fetchedAt: null, error: null });
  const [view, setView] = useState<LoanView>('overview');
  const [guardBusy, setGuardBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('hourly');
  const [sortDesc, setSortDesc] = useState(false);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((value) => value + 1));

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch('/api/loans', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(`Loan Source HTTP ${response.status}`);
          return response.json();
        })
        .then((next) => {
          if (!alive || !next) return;
          setLoans(next as LoansSnapshot);
          setLoansFetchError(null);
        })
        .catch((error) => {
          if (alive) setLoansFetchError(error instanceof Error ? error.message : 'Loan Source Unavailable');
        });
      void fetch('/api/earn', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(`Earn Source HTTP ${response.status}`);
          return response.json();
        })
        .then((next) => {
          if (!alive || !next) return;
          const snapshot = next as { rows?: { asset: string; apr: number }[]; fetchedAt?: number | null; error?: string | null };
          const rows = snapshot.rows ?? [];
          setEarnAprs(new Map(rows.map((row) => [row.asset, row.apr * 100])));
          setEarnStatus({ fetchedAt: snapshot.fetchedAt ?? null, error: snapshot.error ?? null });
        })
        .catch((error) => {
          if (alive) setEarnStatus((current) => ({ ...current, error: error instanceof Error ? error.message : 'Earn Source Unavailable' }));
        });
    };
    load();
    const timer = window.setInterval(load, Math.max(5, prefs.dataCadence?.account ?? 30) * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [refreshTick, prefs.dataCadence?.account]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch('/api/engine/basis', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Basis Runtime HTTP ${response.status}`);
        const next = await response.json() as BasisSnapshot;
        if (!alive) return;
        setBasis(next);
        setBasisError(null);
      } catch (error) {
        if (!alive) return;
        setBasisError(error instanceof Error ? error.message : 'Basis Runtime Unavailable');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const priceOf = (asset: string): number | null => {
    if (asset === 'USDT' || asset === 'USDC' || asset === 'FDUSD') return 1;
    return markets.find((market) => market.symbol === `${asset}USDT`)?.spot ?? null;
  };

  const perpBases = useMemo(() => new Set(markets.filter((market) => market.hasPerp).map((market) => market.base)), [markets]);
  const marketSymbols = useMemo(() => new Set(markets.map((market) => market.symbol)), [markets]);
  const collateralMap = useMemo(() => new Map((loans?.collateral ?? []).map((row) => [row.collateralCoin, row])), [loans?.collateral]);
  const watchlist = state?.config.watchlist ?? [];

  const catalogRows = useMemo<BorrowRow[]>(() => (loans?.loanable ?? []).map((product) => {
    const collateral = collateralMap.get(product.loanCoin);
    return {
      coin: product.loanCoin,
      hourly: product.hourlyRatePct,
      apr: product.yearlyRatePct,
      minUsd: product.minLimit,
      maxUsd: product.maxLimit,
      collateralEligible: !!collateral,
      initialLtv: collateral?.initialLTV ?? null,
      callLtv: collateral?.marginCallLTV ?? null,
      liquidationLtv: collateral?.liquidationLTV ?? null,
      perp: perpBases.has(product.loanCoin),
      symbol: marketSymbols.has(`${product.loanCoin}USDT`) ? `${product.loanCoin}USDT` : null,
    };
  }), [loans?.loanable, collateralMap, perpBases, marketSymbols]);

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toUpperCase();
    let rows = catalogRows;
    if (catalogFilter === 'perp') rows = rows.filter((row) => row.perp);
    if (catalogFilter === 'collateral') rows = rows.filter((row) => row.collateralEligible);
    if (catalogFilter === 'watchlist') rows = rows.filter((row) => row.symbol && watchlist.includes(row.symbol));
    if (query) rows = rows.filter((row) => row.coin.includes(query) || tokenName(row.coin).toUpperCase().includes(query));
    const direction = sortDesc ? -1 : 1;
    const number = (value: number | null) => finite(value) ? value : sortDesc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'asset': return a.coin.localeCompare(b.coin) * direction;
        case 'hourly': return (number(a.hourly) - number(b.hourly)) * direction;
        case 'apr': return (number(a.apr) - number(b.apr)) * direction;
        case 'min': return (number(a.minUsd) - number(b.minUsd)) * direction;
        case 'max': return (number(a.maxUsd) - number(b.maxUsd)) * direction;
        case 'collateral': return (number(a.initialLtv) - number(b.initialLtv)) * direction;
        case 'perp': return ((a.perp ? 1 : 0) - (b.perp ? 1 : 0)) * -direction;
      }
    });
  }, [catalogRows, catalogFilter, search, sortKey, sortDesc, watchlist]);

  useEffect(() => setPageN(0), [catalogFilter, search, sortKey, sortDesc, pageSize]);
  const pages = Math.max(1, Math.ceil(filteredCatalog.length / pageSize));
  const safePage = Math.min(pageN, pages - 1);
  const visibleCatalog = filteredCatalog.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const margin = loans?.margin ?? null;
  const guard = state?.config.borrowGuard ?? DEFAULT_GUARD;
  const ongoing = loans?.ongoing ?? [];
  const activity = loans?.activity ?? [];
  const marginDebts = (margin?.assets ?? []).filter((asset) => asset.borrowed > 0 || asset.interest > 0);
  const policyPaused = guard.enabled && (guard.newBorrowPaused || guard.repayOnly);
  const newLoansAllowed = guard.enabled && !guard.newBorrowPaused && !guard.repayOnly;
  const loanLive = !!loans?.available && !loans?.error && !loansFetchError;

  const valueItems = (items: { asset: string; amount: number }[]): number | null => {
    let total = 0;
    for (const item of items) {
      const price = priceOf(item.asset);
      if (!finite(price)) return null;
      total += item.amount * price;
    }
    return total;
  };

  const flexDebtUsd = valueItems(ongoing.map((loan) => ({ asset: loan.loanCoin, amount: loan.totalDebt })));
  const marginDebtUsd = valueItems(marginDebts.map((asset) => ({ asset: asset.asset, amount: asset.borrowed + asset.interest })));
  const totalDebtUsd = finite(flexDebtUsd) && finite(marginDebtUsd) ? flexDebtUsd + marginDebtUsd : null;
  const collateralUsd = valueItems(ongoing.map((loan) => ({ asset: loan.collateralCoin, amount: loan.collateralAmount })));
  const activeCount = ongoing.length + marginDebts.length;
  const highestLtvLoan = ongoing.reduce<OngoingLoan | null>((highest, loan) => !highest || loan.currentLTV > highest.currentLTV ? loan : highest, null);
  const highestTerms = highestLtvLoan ? collateralMap.get(highestLtvLoan.collateralCoin) ?? null : null;
  const highestRisk = highestLtvLoan && highestTerms ? riskOf(highestLtvLoan.currentLTV, highestTerms.marginCallLTV, highestTerms.liquidationLTV) : null;
  const ltvLimitLoan = guard.enabled ? ongoing.find((loan) => loan.currentLTV * 100 >= guard.maxLtvPct) ?? null : null;

  const gate = useMemo(() => {
    if (!state) return { label: 'Loading', reason: 'Waiting For Server State', tone: 'idle' };
    if (state.config.killSwitch) return { label: 'Blocked', reason: 'Kill Switch On', tone: 'bad' };
    if (state.config.fundsLocked) return { label: 'Blocked', reason: 'Funds Access Off', tone: 'bad' };
    if (!state.binance.keysPresent) return { label: 'Unavailable', reason: 'Binance Keys Missing', tone: 'bad' };
    if (state.binance.keyPermissions?.enableSpotAndMarginTrading === false) return { label: 'Read Only', reason: 'Margin Permission Off', tone: 'warn' };
    if (state.binance.keyPermissions?.enableSpotAndMarginTrading == null) return { label: 'Unknown', reason: 'Margin Permission Not Verified', tone: 'warn' };
    if (!guard.enabled) return { label: 'Unrestricted', reason: 'Borrow Guard Bypassed', tone: 'warn' };
    if (policyPaused) return { label: 'Blocked', reason: 'New Loans Paused', tone: 'bad' };
    if (ltvLimitLoan) return { label: 'Blocked', reason: `${ltvLimitLoan.loanCoin}/${ltvLimitLoan.collateralCoin} Above ${guard.maxLtvPct}% Guard`, tone: 'bad' };
    if (guard.requireLiveCatalog && !loanLive) return { label: 'Unavailable', reason: loansFetchError || loans?.error || 'Live Loan Catalog Required', tone: 'bad' };
    return { label: 'Policy Open', reason: 'Signed Preflight Still Required', tone: 'ok' };
  }, [state, guard, policyPaused, ltvLimitLoan, loanLive, loans?.error, loansFetchError]);

  const preflightRows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return (basis?.rows ?? [])
      .filter((row) => row.direction === 'short_spot_long_perp')
      .filter((row) => !query || row.base.includes(query) || row.symbol.includes(query))
      .sort((a, b) => (b.executableGapPct ?? Number.NEGATIVE_INFINITY) - (a.executableGapPct ?? Number.NEGATIVE_INFINITY));
  }, [basis?.rows, search]);

  const positionSearch = search.trim().toUpperCase();
  const visibleOngoing = ongoing.filter((loan) => !positionSearch || loan.loanCoin.includes(positionSearch) || loan.collateralCoin.includes(positionSearch));
  const visibleMarginDebts = marginDebts.filter((asset) => !positionSearch || asset.asset.includes(positionSearch));

  const assetTotals = (items: { coin: string; quantity: number }[]) => {
    const totals = new Map<string, { coin: string; quantity: number; usd: number | null; symbol: string | null }>();
    for (const { coin, quantity } of items) {
      const previous = totals.get(coin) ?? { coin, quantity: 0, usd: 0, symbol: marketSymbols.has(`${coin}USDT`) ? `${coin}USDT` : null };
      previous.quantity += quantity;
      const price = priceOf(coin);
      previous.usd = finite(previous.usd) && finite(price) ? previous.usd + quantity * price : null;
      totals.set(coin, previous);
    }
    return Array.from(totals.values()).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  };

  const debtAssets = useMemo(() => assetTotals([
    ...ongoing.map((loan) => ({ coin: loan.loanCoin, quantity: loan.totalDebt })),
    ...marginDebts.map((asset) => ({ coin: asset.asset, quantity: asset.borrowed + asset.interest })),
  ]), [ongoing, marginDebts, markets, marketSymbols]);
  const collateralAssets = useMemo(() => assetTotals(ongoing.map((loan) => ({ coin: loan.collateralCoin, quantity: loan.collateralAmount }))), [ongoing, markets, marketSymbols]);
  const assetRows = [...debtAssets.map((row) => ({ ...row, exposure: 'Debt' as const, total: totalDebtUsd })), ...collateralAssets.map((row) => ({ ...row, exposure: 'Collateral' as const, total: collateralUsd }))]
    .filter((row) => !positionSearch || row.coin.includes(positionSearch));
  const visibleActivity = activity.filter((event) => !positionSearch || event.loanCoin.includes(positionSearch) || (event.collateralCoin ?? '').includes(positionSearch));
  const visibleActiveCount = visibleOngoing.length + visibleMarginDebts.length;
  const collateralSummary = collateralAssets.length === 1
    ? `${collateralAssets[0].coin} · ${earnAprs.has(collateralAssets[0].coin) ? 'Earn Position Linked' : 'Flexible Loan Collateral'}`
    : collateralAssets.length > 1 ? `${collateralAssets.length} Collateral Assets` : 'No Flexible Collateral';

  const toggleLoanBlock = async () => {
    if (!state || guardBusy) return;
    setGuardBusy(true);
    try {
      const nextOpen = !newLoansAllowed;
      await saveConfig({ borrowGuard: { ...guard, enabled: true, newBorrowPaused: !nextOpen, repayOnly: !nextOpen } });
    } finally {
      setGuardBusy(false);
    }
  };

  const sortHead = (label: string, key: SortKey, align: 'l' | 'r' = 'r') => (
    <th className={`${align} ${sortKey === key ? 'sorted' : ''}`} aria-sort={sortKey === key ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => { if (sortKey === key) setSortDesc((value) => !value); else { setSortKey(key); setSortDesc(false); } }}>
        {label}<span>{sortKey === key ? (sortDesc ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  );

  const viewCount = view === 'overview' ? visibleActiveCount : view === 'assets' ? assetRows.length : view === 'preflight' ? preflightRows.length : visibleActivity.length;
  const basisRuntimeError = basisError ?? basis?.status.lastError ?? null;
  const basisLive = !!basis && !basisRuntimeError;
  const marginLive = !!margin?.available && !margin.error;
  const accountPartial = loanLive && (!marginLive || !!earnStatus.error);
  const sourceTone = view === 'preflight' ? (basisLive ? 'on' : basis ? 'partial' : '') : (loanLive && !accountPartial ? 'on' : accountPartial ? 'partial' : '');
  const sourceText = view === 'preflight'
    ? basisRuntimeError ? `Source Error · ${basis ? 'Cached' : 'No Data'}` : basis ? `Live · ${timeAgo(basis.updatedAt)}` : 'Loading'
    : loansFetchError || loans?.error ? `Source Error${loans ? ' · Cached' : ''}` : accountPartial ? 'Partial Sources' : loanLive ? `Live · ${loans?.fetchedAt ? timeAgo(loans.fetchedAt) : 'Now'}` : 'Loading';
  const accountSourceSummary = `Flexible ${loanLive ? loans?.fetchedAt ? timeAgo(loans.fetchedAt) : 'Live' : loansFetchError || loans?.error ? 'Error' : 'Loading'} · Margin ${marginLive ? 'Live' : margin?.error ? 'Error' : 'Unavailable'} · Earn ${earnStatus.error ? 'Error' : earnStatus.fetchedAt ? timeAgo(earnStatus.fetchedAt) : 'Unavailable'}`;

  return (
    <div className="container page borrowx-page">
      <section className="borrowx-frame" aria-label="Borrow Workspace">
        <header className="borrowx-toolbar">
          <div className="borrowx-identity">
            <span className="borrowx-source-mark"><img className="borrowx-page-mark" src="/borrow-money-bag.png" alt="" aria-hidden="true" /></span>
            <span><h1>Borrow</h1><small>Binance Flexible Loan + Cross Margin</small></span>
          </div>
          <div className="borrowx-tools">
            <label className="borrowx-search"><IconSearch size={15} /><input aria-label="Search Borrow" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false} />{search && <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>×</button>}</label>
            <div className="borrowx-guard">
              <span><b>New Loans</b><small className={!state || !guard.enabled ? 'warn' : newLoansAllowed ? 'ok' : 'bad'}>{!state ? 'Loading' : !guard.enabled ? 'Guard Bypassed' : newLoansAllowed ? 'Policy Open' : 'Paused'}</small></span>
              <button type="button" role="switch" aria-checked={newLoansAllowed} aria-label="New Loans" disabled={!state || guardBusy} className={newLoansAllowed ? 'open' : 'blocked'} onClick={() => void toggleLoanBlock()}><i /></button>
            </div>
          </div>
        </header>

        <div className="borrowx-summary" aria-label="Borrow Summary">
          <article><span>Total Debt</span><strong>{finite(totalDebtUsd) ? fmtMoney(totalDebtUsd) : '—'}</strong><small>{activeCount} Active {activeCount === 1 ? 'Position' : 'Positions'}</small></article>
          <article><span>Posted Collateral</span><strong>{finite(collateralUsd) ? fmtMoney(collateralUsd) : '—'}</strong><small>{collateralSummary}</small></article>
          <article><span>Highest LTV</span><strong>{highestLtvLoan ? ltvPct(highestLtvLoan.currentLTV, 2) : '—'}</strong><small className={highestRisk ? highestRisk : ''}>{highestTerms ? `${RISK_LABEL[highestRisk ?? 'low']} · ${ltvPct(highestTerms.marginCallLTV)} Call · ${ltvPct(highestTerms.liquidationLTV)} Liq` : highestLtvLoan ? 'Collateral Terms Unavailable' : 'No LTV Exposure'}</small></article>
          <article><span>Effective State</span><strong className={gate.tone}>{gate.label}</strong><small>{gate.reason}</small></article>
        </div>

        <nav className="borrowx-viewbar" aria-label="Borrow Views">
          <div role="tablist">
            {([
              ['overview', 'Overview', search ? visibleActiveCount : activeCount],
              ['assets', 'Assets', assetRows.length],
              ['preflight', 'Borrow Preflight', preflightRows.length],
              ['activity', 'Activity', search ? visibleActivity.length : activity.length],
            ] as [LoanView, string, number][]).map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>{label}<span>{count}</span></button>)}
          </div>
          <span className={`borrowx-live ${sourceTone}`} title={view === 'preflight' ? basisRuntimeError ?? '' : loansFetchError ?? loans?.error ?? margin?.error ?? earnStatus.error ?? ''}><i />{sourceText}</span>
        </nav>

        <div className="borrowx-workspace">
          {view === 'overview' && (<>
            <section className="borrowx-section" aria-labelledby="borrow-active-title">
              <header className="borrowx-section-head">
                <span><strong id="borrow-active-title">Active Positions</strong><small>Flexible Loan + Cross Margin</small></span>
                <span>{visibleActiveCount} {visibleActiveCount === 1 ? 'Position' : 'Positions'}</span>
              </header>
              <div className="borrowx-table-scroll"><table className="borrowx-table positions"><thead><tr><th /> <th className="l">Asset</th><th>Debt</th><th>Collateral</th><th>Current LTV</th><th>Margin Call</th><th>Liquidation</th><th>Borrow APR</th><th>Earn APR</th><th>Rate Spread</th></tr></thead><tbody>
              {visibleOngoing.map((loan) => {
                const terms = collateralMap.get(loan.collateralCoin) ?? null;
                const risk = terms ? riskOf(loan.currentLTV, terms.marginCallLTV, terms.liquidationLTV) : null;
                const borrowApr = (loans?.loanable ?? []).find((row) => row.loanCoin === loan.loanCoin)?.yearlyRatePct ?? null;
                const earnApr = earnAprs.get(loan.collateralCoin) ?? null;
                const netApr = finite(borrowApr) && finite(earnApr) ? borrowApr - earnApr : null;
                const symbol = marketSymbols.has(`${loan.loanCoin}USDT`) ? `${loan.loanCoin}USDT` : null;
                return <tr key={`${loan.loanCoin}-${loan.collateralCoin}`} tabIndex={symbol ? 0 : -1} className={symbol ? 'link' : ''} onClick={() => symbol && openDetail(symbol)} onKeyDown={(event) => { if (symbol && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetail(symbol); } }}>
                  <td>{symbol ? <Star on={watchlist.includes(symbol)} onClick={() => void toggleWatch(symbol)} /> : null}</td>
                  <td className="l borrowx-asset"><TokenIcon symbol={`${loan.loanCoin}USDT`} size={32} /><span><b>{tokenName(loan.loanCoin)}</b><small>{loan.loanCoin} · Flexible Loan</small></span></td>
                  <td><b>{fmtQty(loan.totalDebt)} {loan.loanCoin}</b><small>{finite(priceOf(loan.loanCoin)) ? fmtMoney(loan.totalDebt * (priceOf(loan.loanCoin) as number)) : 'Price Unavailable'}</small></td>
                  <td><b>{fmtQty(loan.collateralAmount)} {loan.collateralCoin}</b><small>{finite(priceOf(loan.collateralCoin)) ? fmtMoney(loan.collateralAmount * (priceOf(loan.collateralCoin) as number)) : 'Price Unavailable'}</small></td>
                  <td><b>{ltvPct(loan.currentLTV, 2)}</b><small className={risk ?? ''}>{risk ? RISK_LABEL[risk] : 'Terms Unavailable'}</small></td>
                  <td><b>{terms ? ltvPct(terms.marginCallLTV) : '—'}</b><small>{terms ? `Initial ${ltvPct(terms.initialLTV)}` : 'Binance Terms Missing'}</small></td>
                  <td><b>{terms ? ltvPct(terms.liquidationLTV) : '—'}</b><small>Threshold · Not Price Estimate</small></td>
                  <td><b>{fmtRate(borrowApr, 2)}</b><small>Annualized</small></td>
                  <td><b className={finite(earnApr) ? 'ok' : ''}>{fmtRate(earnApr, 2)}</b><small>{finite(earnApr) ? 'Linked Earn Position' : 'Earn Rate Unavailable'}</small></td>
                  <td><b>{fmtRate(netApr, 2)}</b><small>Rate Comparison · Not Carry</small></td>
                </tr>;
              })}
              {visibleMarginDebts.map((asset) => {
                const symbol = marketSymbols.has(`${asset.asset}USDT`) ? `${asset.asset}USDT` : null;
                const debt = asset.borrowed + asset.interest;
                return <tr key={`margin-${asset.asset}`} tabIndex={symbol ? 0 : -1} className={symbol ? 'link' : ''} onClick={() => symbol && openDetail(symbol)} onKeyDown={(event) => { if (symbol && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetail(symbol); } }}>
                  <td>{symbol ? <Star on={watchlist.includes(symbol)} onClick={() => void toggleWatch(symbol)} /> : null}</td>
                  <td className="l borrowx-asset"><TokenIcon symbol={`${asset.asset}USDT`} size={32} /><span><b>{tokenName(asset.asset)}</b><small>{asset.asset} · Cross Margin</small></span></td>
                  <td><b>{fmtQty(debt)} {asset.asset}</b><small>{finite(priceOf(asset.asset)) ? fmtMoney(debt * (priceOf(asset.asset) as number)) : 'Price Unavailable'}</small></td>
                  <td><b>Account Pool</b><small>Cross Margin</small></td><td><b>—</b><small>Margin Level {finite(margin?.marginLevel) ? margin?.marginLevel.toFixed(2) : '—'}</small></td><td><b>—</b><small>Account Level</small></td><td><b>—</b><small>Cross Margin</small></td><td><b>{fmtQty(asset.interest)} {asset.asset}</b><small>Accrued Interest</small></td><td><b>—</b><small>Not Applicable</small></td><td><b>—</b><small>Rate Unavailable</small></td>
                </tr>;
              })}
              </tbody></table>{visibleOngoing.length === 0 && visibleMarginDebts.length === 0 && <div className="borrowx-empty compact"><span><b>No Active Borrow Positions</b><small>Loan Market remains available below.</small></span></div>}</div>
            </section>

            <section className="borrowx-section borrowx-market-section" aria-labelledby="borrow-market-title">
              <header className="borrowx-section-head borrowx-market-head">
                <span><strong id="borrow-market-title">Loan Market</strong><small>Signed Binance Flexible Loan catalog</small></span>
                <div className="borrowx-market-tools">
                  <PillSelect value={catalogFilter} options={[{ id: 'all', label: 'All Products' }, { id: 'perp', label: 'Perpetual Market' }, { id: 'collateral', label: 'Collateral Eligible' }, { id: 'watchlist', label: 'Watchlist' }]} onChange={setCatalogFilter} ariaLabel="Loan Market Filter" testId="borrow-market-filter" />
                  <PillSelect value={String(pageSize)} options={[25, 50, 100].map((count) => ({ id: String(count), label: `${count} Rows` }))} onChange={(value) => setPageSize(Number(value))} ariaLabel="Rows Per Page" testId="borrow-page-size" />
                  {(catalogFilter !== 'all' || search) && <button type="button" onClick={() => { setCatalogFilter('all'); setSearch(''); }}>Reset</button>}
                </div>
                <span className="borrowx-market-count">{filteredCatalog.length} Products · {filteredCatalog.length ? `${safePage * pageSize + 1}-${safePage * pageSize + visibleCatalog.length}` : '0'}</span>
              </header>
              <div className="borrowx-table-scroll"><table className="borrowx-table market"><thead><tr><th />{sortHead('Asset', 'asset', 'l')}{sortHead('Hourly Rate', 'hourly')}{sortHead('APR', 'apr')}{sortHead('Minimum', 'min')}{sortHead('Maximum', 'max')}{sortHead('Collateral LTV', 'collateral')}{sortHead('Perpetual', 'perp')}</tr></thead><tbody>{visibleCatalog.map((row) => <tr key={row.coin} tabIndex={row.symbol ? 0 : -1} className={row.symbol ? 'link' : ''} onClick={() => row.symbol && openDetail(row.symbol)} onKeyDown={(event) => { if (row.symbol && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetail(row.symbol); } }}><td>{row.symbol ? <Star on={watchlist.includes(row.symbol)} onClick={() => void toggleWatch(row.symbol as string)} /> : null}</td><td className="l borrowx-asset"><TokenIcon symbol={row.symbol ?? `${row.coin}USDT`} size={32} /><span><b>{tokenName(row.coin)}</b><small>{row.coin} · Flexible Product</small></span></td><td><b>{fmtRate(row.hourly, 5)}</b><small>Catalog Conversion</small></td><td><b>{fmtRate(row.apr, 2)}</b><small>Annualized</small></td><td><b>{fmtUsd(row.minUsd)}</b><small>USD Product Limit</small></td><td><b>{fmtUsd(row.maxUsd)}</b><small>USD Product Limit</small></td><td><b>{row.collateralEligible ? ltvPct(row.initialLtv) : '—'}</b><small>{row.collateralEligible ? `${ltvPct(row.callLtv)} Call · ${ltvPct(row.liquidationLtv)} Liq` : 'Not Listed As Collateral'}</small></td><td><b className={row.perp ? 'ok' : ''}>{row.perp ? 'Available' : '—'}</b><small>{row.perp ? 'Binance USD-M' : 'No Perpetual Market'}</small></td></tr>)}</tbody></table>{filteredCatalog.length === 0 && <div className="borrowx-empty compact">No Loan Products Match</div>}</div>
              {pages > 1 && <nav className="borrowx-section-pages" aria-label="Loan Market Pagination"><button type="button" disabled={safePage === 0} onClick={() => setPageN(safePage - 1)}>‹</button>{pageList(safePage, pages).map((page, index) => page === '…' ? <span key={`e-${index}`}>…</span> : <button type="button" key={page} className={safePage === page ? 'current' : ''} onClick={() => setPageN(page)}>{page + 1}</button>)}<button type="button" disabled={safePage >= pages - 1} onClick={() => setPageN(safePage + 1)}>›</button></nav>}
            </section>
          </>)}

          {view === 'assets' && <div className="borrowx-table-scroll"><table className="borrowx-table assets"><thead><tr><th /><th className="l">Asset</th><th className="l">Exposure</th><th>Amount</th><th>Value</th><th>Class Share</th></tr></thead><tbody>{assetRows.map((row) => <tr key={`${row.exposure}-${row.coin}`} tabIndex={row.symbol ? 0 : -1} className={row.symbol ? 'link' : ''} onClick={() => row.symbol && openDetail(row.symbol)} onKeyDown={(event) => { if (row.symbol && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetail(row.symbol); } }}><td>{row.symbol ? <Star on={watchlist.includes(row.symbol)} onClick={() => void toggleWatch(row.symbol as string)} /> : null}</td><td className="l borrowx-asset"><TokenIcon symbol={row.symbol ?? `${row.coin}USDT`} size={32} /><span><b>{tokenName(row.coin)}</b><small>{row.coin}</small></span></td><td className="l"><span className={`borrowx-chip ${row.exposure.toLowerCase()}`}>{row.exposure}</span></td><td><b>{fmtQty(row.quantity)} {row.coin}</b></td><td><b>{finite(row.usd) ? fmtMoney(row.usd) : '—'}</b><small>{finite(row.usd) ? 'Live Spot Valuation' : 'Price Unavailable'}</small></td><td><b>{finite(row.usd) && finite(row.total) && row.total > 0 ? `${((row.usd / row.total) * 100).toFixed(1)}%` : '—'}</b></td></tr>)}</tbody></table>{assetRows.length === 0 && <div className="borrowx-empty">No Borrow Assets</div>}</div>}

          {view === 'preflight' && <div className="borrowx-table-scroll"><table className="borrowx-table preflight"><thead><tr><th className="l">Asset</th><th>Executable Gap</th><th>Intended Size</th><th>Borrow Status</th><th>Borrow Cost</th><th className="l">Decision</th><th>Age</th></tr></thead><tbody>{preflightRows.map((row) => <tr key={row.symbol} tabIndex={0} className="link" onClick={() => openDetail(row.symbol)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(row.symbol); } }}><td className="l borrowx-asset"><TokenIcon symbol={row.symbol} size={32} /><span><b>{row.base}</b><small>Sell Spot · Buy Perp</small></span></td><td><b>{fmtBasis(row.executableGapPct)}</b><small>Crossed Books</small></td><td><b>{fmtMoney(basis?.thresholds.intendedNotionalUsd)}</b><small>Engine Target</small></td><td><b className={`borrow-${row.borrow.status}`}>{borrowStatusLabel(row)}</b><small>{row.borrow.human}</small></td><td><b>{row.borrow.status === 'available' ? fmtBasis(row.borrow.costPctOverHold) : '—'}</b><small>{row.borrow.status === 'available' ? 'Expected Hold' : 'Signed Rate Required'}</small></td><td className="l"><b>{decisionLabel(row)}</b><small>{row.reason}</small></td><td><b>{row.decisionTs ? timeAgo(row.decisionTs) : '—'}</b><small>{Math.round(row.dataQuality.score * 100)}% Trust</small></td></tr>)}</tbody></table>{preflightRows.length === 0 && <div className="borrowx-empty">{basisRuntimeError ?? 'No Reverse-Basis Rows In The Current Eligible Universe'}</div>}</div>}

          {view === 'activity' && <div className="borrowx-table-scroll"><table className="borrowx-table activity"><thead><tr><th className="l">Event</th><th className="l">Loan Asset</th><th className="l">Collateral</th><th>Status</th><th>Time</th></tr></thead><tbody>{visibleActivity.map((event, index) => <tr key={`${event.kind}-${event.ts}-${event.loanCoin}-${index}`}><td className="l"><span className="borrowx-event"><i className={activityTone(event.kind)} /><span><b>{activityTitle(event)}</b><small>{activityDetail(event)}</small></span></span></td><td className="l"><b>{event.loanCoin || '—'}</b></td><td className="l"><b>{event.collateralCoin || '—'}</b></td><td><span className={`borrowx-chip ${activityTone(event.kind)}`}>{statusLabel(event.status)}</span></td><td><b>{timeAgo(event.ts)}</b></td></tr>)}</tbody></table>{visibleActivity.length === 0 && <div className="borrowx-empty">No Loan Activity Returned</div>}</div>}

        </div>

        <footer className="borrowx-footer">
          <span>{view === 'preflight' ? basisRuntimeError ? `Borrow Source Error: ${basisRuntimeError}` : `Borrow Source: ${basis?.status.borrowSource ?? 'Loading'}` : view === 'overview' || view === 'assets' ? accountSourceSummary : `Source: Binance Signed Flexible Loan${loans?.fetchedAt ? ` · ${timeAgo(loans.fetchedAt)}` : ''}`}</span>
          <span>{view === 'overview' ? `${viewCount} Positions · ${filteredCatalog.length} Products` : `${viewCount} ${view === 'activity' ? 'Events' : 'Rows'}`}</span>
          {view === 'preflight' && <button type="button" onClick={() => setPage('strategies')}>Open Basis</button>}
        </footer>
      </section>
    </div>
  );
}
